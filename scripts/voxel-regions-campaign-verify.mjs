import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_REGIONS_OUT ?? 'test-results/voxel-regions';
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
const bundle = await build({ stdin: { contents: "export { VoxelSimulation } from './src/voxel/world'; export { generateRegions, resolveWorldSite, recommendedRegion } from './src/voxel/regions'; export { previewWorld } from './src/voxel/worldgen';", resolveDir: process.cwd(), sourcefile: 'regions-campaign-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(`${OUT}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation, generateRegions, resolveWorldSite, recommendedRegion, previewWorld } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const report = { version: 35, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Direct simulation API verification, not browser gameplay. Fresh world sites produce actual local maps. Public designate/step/save/load performs tree work and preserves region identity. Read-only state/path inspection chooses reachable trees. No injected terrain, resources, pawns, time, RNG or prior fixtures. Browser evidence separately creates regions using visible map controls.',
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await readFile(new URL(import.meta.url))), sourceManifestSha256: sha(manifest) },
  checks: [], worlds: [], browser: {}, errors: [] };
const check = (name, detail = {}) => { report.checks.push({ name, ...detail }); console.log('PASS', name); };
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const point = p => ({ x: p.x, y: p.y, z: p.z });
const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
async function fixture(sim, name) {
  const data = sim.save(), raw = JSON.stringify(data), file = `${OUT}/${name}.json`;
  await writeFile(file, raw); return { file, tick: data.tick, sha256: sha(raw) };
}
try {
  const map = generateRegions(73129), recommended = recommendedRegion(map);
  assert.equal(map.width, 48); assert.equal(map.height, 24); assert.equal(map.tiles.length, 1152);
  assert.deepEqual(generateRegions(map.seed), map);
  const ocean = map.tiles.find(t => t.biome === 'ocean'), peaks = map.tiles.find(t => t.hilliness === 'impassable');
  assert(ocean && peaks && recommended);
  report.browser = { worldSeed: map.seed, recommendedId: recommended.id, oceanId: ocean.id, peaksId: peaks.id, width: map.width, height: map.height, sites: [] };
  for (const t of [ocean, peaks]) {
    assert(!t.settleable && t.reason);
    assert.throws(() => resolveWorldSite({ version: 1, worldSeed: map.seed, tileId: t.id }));
    assert.throws(() => VoxelSimulation.fromWorldSite({ version: 1, worldSeed: map.seed, tileId: t.id }));
  }
  check('48 by 24 deterministic world rejects ocean and impassable peak settlement', { ocean: ocean.id, peaks: peaks.id });
  const selected = [recommended, ...['boreal', 'desert'].map(biome => map.tiles.filter(t => t.settleable && t.biome === biome)
    .sort((a, b) => Math.abs(a.temperature - 18) - Math.abs(b.temperature - 18) || b.rainfall - a.rainfall)[0])];
  assert(selected.every(Boolean)); assert.equal(new Set(selected.map(t => t.id)).size, 3);
  for (const tile of selected) {
    const site = { version: 1, worldSeed: map.seed, tileId: tile.id }, resolved = resolveWorldSite(site);
    const preview = previewWorld(resolved.seed, resolved.settings);
    let sim = VoxelSimulation.fromWorldSite(site);
    const first = sim.save(), initial = sim.counts(), snapshot = sim.snapshot();
    const result = { site, tile, preview: { seed: preview.seed, settings: preview.settings, summary: preview.summary }, commands: [], checks: [], fixtures: {} };
    report.worlds.push(result); report.browser.sites.push({ ...result.preview, site, tile });
    assert.equal(first.version, 35); assert.equal(sim.generator, 2); assert.equal(sim.tick, 0);
    assert.equal(sim.seed, preview.seed); assert.deepEqual(sim.settings, preview.settings);
    assert.deepEqual(sim.spawn, preview.spawn); assert.deepEqual(snapshot.worldSummary, preview.summary);
    assert.deepEqual(sim.trees.map(({ id, ...tree }) => tree), preview.trees);
    assert.deepEqual(sim.worldSite, site); assert.deepEqual(first.worldSite, site);
    assert.deepEqual(VoxelSimulation.fromWorldSite(site).save(), first, 'same immutable world site gives same complete starting colony');
    const currentHash = sha(JSON.stringify(sim.save())); previewWorld(resolved.seed + 1, resolved.settings);
    assert.equal(sha(JSON.stringify(sim.save())), currentHash, 'preview does not mutate the running colony');
    result.fixtures.initial = await fixture(sim, `site-${tile.id}-initial`);
    result.initialTerrainSha256 = sha(sim.blocks);
    check('region preview matches actual seed climate terrain summary trees and deterministic starting colony', { tileId: tile.id, mapSeed: sim.seed, biome: tile.biome });
    const tree = [...sim.trees].filter(t => t.growth === 1 && dirs.some(([dx, dy]) => {
      const p = { x: t.x + dx, y: t.y + dy, z: t.z };
      return sim.standable(p) && sim.path(sim.pawns[0], p) !== null;
    })).sort((a, b) => dist(a, sim.spawn) - dist(b, sim.spawn))[0];
    assert(tree, `reachable mature tree in region ${tile.id}`);
    const expectedWood = sim.snapshot().treeConditions.find(t => t.id === tree.id).yield;
    const c = { type: 'designate', tool: 'cut', from: point(tree) }, r = sim.command(c);
    result.commands.push({ tick: sim.tick, c, r }); assert(r.ok);
    assert(sim.jobs.some(j => j.kind === 'cut' && j.x === tree.x && j.y === tree.y && j.z === tree.z));
    const queued = sim.save(); result.fixtures.queued = await fixture(sim, `site-${tile.id}-queued`);
    sim = VoxelSimulation.load(queued);
    for (const field of ['worldSite', 'seed', 'settings', 'spawn', 'blocks', 'items', 'trees']) assert.deepEqual(sim.save()[field], queued[field]);
    const jobData = jobs => jobs.map(({ owner, reason, ...job }) => job);
    assert.deepEqual(jobData(sim.jobs), jobData(queued.jobs), 'queued work survives save/load');
    while (sim.trees.some(t => t.id === tree.id) && sim.tick < 15000) sim.step();
    assert(!sim.trees.some(t => t.id === tree.id), 'actual pawn cuts the designated local tree');
    assert.equal(sim.stats.produced.wood, expectedWood); assert(sim.stats.cut >= 1);
    const counts = sim.counts();
    for (const resource of Object.keys(initial)) assert.equal(counts[resource] + sim.stats.consumed[resource] + sim.stats.spoiled[resource] + sim.stats.destroyed[resource] + sim.trade.exported[resource], initial[resource] + sim.stats.produced[resource] + sim.trade.imported[resource], `${resource} conservation`);
    const completed = sim.save(); sim = VoxelSimulation.load(completed);
    for (const field of ['worldSite', 'seed', 'settings', 'spawn', 'blocks', 'items', 'trees', 'stats']) assert.deepEqual(sim.save()[field], completed[field]);
    assert(sim.pawns.filter(p => p.faction === 'colony').every(p => !p.dead && !p.downed));
    result.fixtures.completed = await fixture(sim, `site-${tile.id}-completed`);
    result.work = { treeId: tree.id, position: point(tree), expectedWood, producedWood: sim.stats.produced.wood, tick: sim.tick };
    check('actual local tree job produces conserved timber and world identity survives queued and completed save/load', { tileId: tile.id, ...result.work });
  }
  assert.equal(new Set(report.worlds.map(w => w.preview.seed)).size, 3);
  assert.equal(new Set(report.worlds.map(w => w.initialTerrainSha256)).size, 3);
  const secondMap = generateRegions(73130), secondTile = recommendedRegion(secondMap);
  assert(secondTile); const secondSite = { version: 1, worldSeed: secondMap.seed, tileId: secondTile.id };
  const second = VoxelSimulation.fromWorldSite(secondSite);
  report.browser.changedSeed = { worldSeed: secondMap.seed, recommendedId: secondTile.id, localSeed: second.seed };
  assert.notEqual(sha(JSON.stringify(secondMap)), sha(JSON.stringify(map)));
  assert.notEqual(second.seed, report.worlds[0].preview.seed);
  assert.deepEqual(second.worldSite, secondSite);
  const custom = new VoxelSimulation(42, { biome: 'temperate', hilliness: 'flat' });
  assert.equal(custom.save().worldSite, null); assert.equal(VoxelSimulation.load(custom.save()).worldSite, null);
  check('different regions and world seeds produce distinct physical maps while custom maps remain unbound');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.errors.push(error.stack ?? String(error)); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
