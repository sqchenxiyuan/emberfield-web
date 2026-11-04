import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_EXPLORATION_OUT ?? 'test-results/voxel-exploration';
try { await access(`${OUT}/report.json`); throw Error(`Refusing to overwrite prior evidence: ${OUT}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
await mkdir(OUT, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) files.push(file);
  }
  return files.sort();
}
const manifest = JSON.stringify(await Promise.all((await sourceFiles('src')).map(async file => ({ file, sha256: sha(await readFile(file)) }))), null, 2);
await writeFile(`${OUT}/source-manifest.json`, manifest);
const bundle = await build({ stdin: { contents: "export { VoxelSimulation } from './src/voxel/world'; export { generateRegions, resolveWorldSite } from './src/voxel/regions'; export { previewWorld } from './src/voxel/worldgen';", resolveDir: process.cwd(), sourcefile: 'exploration-campaign-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(`${OUT}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation, resolveWorldSite, previewWorld } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const report = { version: 36, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Direct simulation API, not screen-only play. Fresh site-v2 generator-3 map; read-only authoritative terrain and exploration mask choose a sealed cave and short excavation route. Ordinary commands/ticks create surface storage, excavate ladder shaft, designate unknown rock, open cave, mine finite ore and physically carry it back. No injected map, resources, needs, position, time or RNG. Historic published gen1/gen2 saves test migration. Browser separately repeats the disclosed route with UI controls.',
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await readFile(new URL(import.meta.url))), sourceManifestSha256: sha(manifest) },
  checks: [], commands: [], fixtures: {}, browser: {}, errors: [] };
const site = { version: 2, worldSeed: 73129, tileId: 714 };
let sim;
const idx = p => (p.z * 64 + p.y) * 64 + p.x, pos = i => ({ x: i % 64, y: Math.floor(i / 64) % 64, z: Math.floor(i / 4096) });
const point = p => ({ x: p.x, y: p.y, z: p.z }), dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], block = p => sim.blocks[idx(p)], known = p => sim.explored[idx(p)] === 1;
const natural = b => [1, 2, 3, 6, 8, 9, 10].includes(b), walkable = p => p.x > 1 && p.x < 62 && p.y > 1 && p.y < 62 && block(p) === 0 && block({ ...p, z: p.z + 1 }) === 0 && block({ ...p, z: p.z - 1 }) !== 0;
const check = (name, detail = {}) => { report.checks.push({ name, tick: sim?.tick ?? 0, ...detail }); console.log('PASS', name, sim?.tick ?? 0); };
function command(c, expect = true) { const r = sim.command(c); report.commands.push({ tick: sim.tick, c, r }); if (expect) assert(r.ok, JSON.stringify({ c, r })); return r; }
const place = (tool, from, extra = {}) => command({ type: 'designate', tool, from: point(from), ...extra });
async function fixture(name) { const data = sim.save(), bytes = JSON.stringify(data), file = `${OUT}/${name}.json`; await writeFile(file, bytes); report.fixtures[name] = { file, sha256: sha(bytes), tick: data.tick }; return data; }
function chooseRoute() {
  const visited = new Set(), candidates = [];
  for (let z = 2; z <= 6; z++) for (let y = 2; y < 62; y++) for (let x = 2; x < 62; x++) {
    const start = { x, y, z }; if (known(start) || visited.has(idx(start)) || !walkable(start)) continue;
    const cells = [start]; visited.add(idx(start));
    for (let n = 0; n < cells.length; n++) for (const [dx, dy] of dirs) {
      const p = { x: cells[n].x + dx, y: cells[n].y + dy, z };
      if (!known(p) && !visited.has(idx(p)) && walkable(p)) { cells.push(p); visited.add(idx(p)); }
    }
    const ores = [];
    for (const air of cells) for (const [dx, dy] of dirs) {
      const p = { x: air.x + dx, y: air.y + dy, z };
      if (p.x < 2 || p.x >= 62 || p.y < 2 || p.y >= 62) continue;
      if ([block(p), block({ ...p, z: z + 1 })].includes(3)) ores.push({ target: p, standing: air });
    }
    if (!ores.length) continue;
    for (const entry of cells) for (const [dx, dy] of dirs) for (let distance = 3; distance <= 5; distance++) {
      const walls = Array.from({ length: distance }, (_, n) => ({ x: entry.x + dx * (n + 1), y: entry.y + dy * (n + 1), z }));
      if (!walls.every(p => p.x > 2 && p.x < 61 && p.y > 2 && p.y < 61 && natural(block(p)) && natural(block({ ...p, z: z + 1 })) && block({ ...p, z: z - 1 }) !== 0)) continue;
      const shaft = walls.at(-1); let height = 14; while (height > 0 && !block({ ...shaft, z: height })) height--;
      const surface = { ...shaft, z: height + 1 };
      if ((surface.z - z) % 3 || surface.z - z < 3 || surface.z - z > 9 || !sim.standable(surface) || sim.path(sim.pawns[0], surface) === null) continue;
      if (sim.trees.some(t => t.x === surface.x && t.y === surface.y)) continue;
      if (!Array.from({ length: surface.z - z }, (_, n) => block({ ...shaft, z: z + n })).every(natural)) continue;
      const ore = ores.filter(o => !walls.some(w => idx(w) === idx(o.target))).sort((a, b) => dist(a.standing, entry) - dist(b.standing, entry))[0]; if (!ore) continue;
      candidates.push({ entry, surface, bottom: shaft, passage: walls.slice(0, -1).reverse(), caveCells: cells, ore,
        score: dist(surface, sim.spawn) + distance * 3 + (surface.z - z) * 2 });
    }
  }
  candidates.sort((a, b) => a.score - b.score); assert(candidates.length, 'sealed walkable cave, reachable solid shaft and finite ore route exist'); return candidates[0];
}
try {
  sim = VoxelSimulation.fromWorldSite(site); assert.equal(sim.generator, 3); assert.equal(sim.save().version, 36);
  const initial = sim.counts(), resolved = resolveWorldSite(site), preview = previewWorld(resolved.seed, resolved.settings, resolved.generator);
  assert.deepEqual(sim.snapshot().worldSummary, preview.summary); assert.deepEqual(sim.worldSite, site);
  assert(sim.explored.some(v => v === 0)); const originalMask = sha(sim.explored);
  const route = chooseRoute();
  const hiddenAir = point(route.entry);
  const hiddenOre = block(route.ore.target) === 3 ? point(route.ore.target) : { ...route.ore.target, z: route.ore.target.z + 1 };
  assert(idx(hiddenAir) >= 0 && idx(hiddenOre) >= 0);
  for (const chunk of sim.chunks()) for (let i = 0; i < chunk.blocks.length; i++) if (!chunk.explored[i]) { assert.equal(chunk.blocks[i], 2); assert.equal(chunk.ladders[i], 0); }
  for (const p of [hiddenAir, hiddenOre]) {
    assert(!command({ type: 'designate', tool: 'wall', from: p }, false).ok);
    assert(!command({ type: 'move', pawnId: sim.pawns[0].id, target: p }, false).ok);
    place('mine', p); assert.equal(sha(sim.explored), originalMask); place('cancel', p);
  }
  report.browser = { site, seed: sim.seed, settings: sim.settings, initialSummary: preview.summary, hiddenAir, hiddenOre, route, storage: [] };
  await fixture('initial'); check('fresh gen3 map masks hidden air and ore identically and rejects hidden construction without revealing planned excavation', { known: sim.snapshot().exploration.known, total: sim.snapshot().exploration.total, hiddenAir, hiddenOre });
  const audit = () => {
    const counts = sim.counts(); for (const resource of Object.keys(initial)) assert.equal(counts[resource] + sim.stats.consumed[resource] + sim.stats.spoiled[resource] + sim.stats.destroyed[resource] + sim.trade.exported[resource], initial[resource] + sim.stats.produced[resource] + sim.trade.imported[resource], `${resource} conservation`);
    assert(sim.pawns.filter(p => p.faction === 'colony').every(p => !p.dead && !p.downed));
  };
  const carriedLayers = new Set();
  const until = (name, done, limit = 22000) => {
    const tick = sim.tick; while (!done() && sim.tick - tick < limit) {
      sim.step(); for (const p of sim.pawns) if (p.cargo?.resource === 'steel') carriedLayers.add(p.z);
      if (sim.tick % 300 === 0) audit();
    }
    assert(done(), `${name}: ${JSON.stringify({ tick: sim.tick, jobs: sim.jobs.map(j => ({ kind: j.kind, p: point(j), reason: j.reason })), people: sim.pawns.map(p => ({ name: p.name, reason: p.reason, food: p.food, rest: p.rest })) })}`); audit(); check(name, { elapsedTicks: sim.tick - tick });
  };
  const stockSites = [];
  for (let y = 2; y < 62; y++) for (let x = 2; x < 62; x++) {
    let z = 14; while (z && !block({ x, y, z })) z--; const p = { x, y, z: z + 1 };
    if (sim.standable(p) && known(p) && !sim.stockpiles.some(s => idx(s) === idx(p)) && sim.path(sim.pawns[0], p) !== null) stockSites.push(p);
  }
  stockSites.sort((a, b) => dist(a, sim.spawn) - dist(b, sim.spawn));
  for (const p of stockSites) { if (report.browser.storage.length >= 10) break; const r = command({ type: 'designate', tool: 'stock', from: p }, false); if (r.ok) report.browser.storage.push(p); }
  assert.equal(report.browser.storage.length, 10);
  for (let z = route.surface.z; z > route.bottom.z; z -= 3) {
    place('shaft', { ...route.surface, z });
    until('real workers excavate a connected three-level ladder segment', () => sim.ladders[idx({ ...route.bottom, z: z - 3 })] === 1 && !sim.jobs.some(j => ['digLadder', 'ladder'].includes(j.kind)));
  }
  assert(!known(route.entry)); assert(known(route.bottom)); await fixture('shaft');
  const beforePlan = sha(sim.explored), unknownPassage = route.passage.filter(p => !known(p)); assert(unknownPassage.length);
  for (const p of route.passage) place('mine', p);
  assert.equal(block(route.entry), 0); assert(!known(route.entry)); place('mine', route.entry);
  assert(sim.jobs.some(j => j.kind === 'mine' && idx(j) === idx(route.entry)), 'unknown air accepts the same blind excavation planning');
  assert.equal(sha(sim.explored), beforePlan); const planned = await fixture('planned');
  sim = VoxelSimulation.load(planned); assert.deepEqual([...sim.explored], planned.explored); assert.deepEqual(sim.worldSite, site);
  check('unknown rock can be planned and queued work roundtrips without disclosing cave or changing exploration', { unknownPassage });
  const beforeOpen = sim.explored.reduce((n, v) => n + v, 0);
  until('actual excavation breaches the sealed cave and permanently reveals connected air and adjacent rock', () => known(route.entry) && route.passage.every(p => block(p) === 0 && block({ ...p, z: p.z + 1 }) === 0) && !sim.jobs.some(j => j.kind === 'mine'));
  assert(route.caveCells.every(known)); const revealed = sim.explored.reduce((n, v) => n + v, 0) - beforeOpen; assert(revealed > 30);
  assert(!sim.jobs.some(j => j.kind === 'mine' && idx(j) === idx(route.entry)), 'revealed empty air automatically removes redundant excavation plan');
  check('blind plan extending into hidden cave air is removed after the real breach reveals empty space');
  assert(sim.path(sim.pawns[0], route.ore.standing) !== null); assert(known(route.ore.target)); await fixture('opened');
  const minedBefore = sim.stats.produced.steel; place('mine', route.ore.target);
  until('discovered finite steel is mined from its physical cave wall', () => block(route.ore.target) === 0 && block({ ...route.ore.target, z: route.ore.target.z + 1 }) === 0 && sim.stats.produced.steel > minedBefore);
  await fixture('mined');
  until('real haulers carry discovered steel back through the ladder into surface stores', () => sim.snapshot().stored.steel === sim.counts().steel && !sim.pawns.some(p => p.cargo?.resource === 'steel'));
  assert(carriedLayers.has(route.bottom.z)); assert(carriedLayers.has(route.surface.z));
  const final = await fixture('delivered'); sim = VoxelSimulation.load(final);
  for (const field of ['worldSite', 'seed', 'settings', 'blocks', 'explored', 'items', 'stats']) assert.deepEqual(sim.save()[field], final[field]);
  report.browser.work = { revealed, producedSteel: sim.stats.produced.steel - minedBefore, totalProducedSteel: sim.stats.produced.steel, carriedLayers: [...carriedLayers], tick: sim.tick };
  audit(); check('completed excavation resource balances and permanent explored mask survive save/load', report.browser.work);
  report.browser.legacy = [];
  for (const file of ['tests/fixtures/voxel-v7-start.json', 'tests/fixtures/voxel-v35-exploration-active.json']) {
    const bytes = await readFile(file), original = JSON.parse(bytes), old = VoxelSimulation.load(original), restored = old.save();
    assert([1, 2].includes(old.generator)); assert(old.explored.every(v => v === 1));
    assert.deepEqual(restored.blocks, original.blocks);
    if (original.version >= 35) assert.deepEqual(restored.items, original.items);
    else {
      const totals = items => items.reduce((all, item) => ({ ...all, [item.resource]: (all[item.resource] ?? 0) + item.amount }), {});
      assert.deepEqual(totals(restored.items), totals(original.items));
    }
    if (original.worldSite) assert.deepEqual(restored.worldSite, original.worldSite);
    report.browser.legacy.push({ file, sha256: sha(bytes), version: original.version, generator: original.generator, tick: original.tick });
  }
  check('genuine gen1 and gen2 historical saves keep terrain items and full known view'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.errors.push(error.stack ?? String(error)); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
