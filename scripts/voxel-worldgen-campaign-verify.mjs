import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_WORLDGEN_OUT ?? 'test-results/voxel-worldgen-campaign';
await mkdir(OUT, { recursive: true });
const bundled = await build({
  entryPoints: ['src/voxel/world.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { VoxelSimulation } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Fresh generator-2 worlds. Public command/step/save/load; read-only block/path/standability inspection chooses actual work sites. No terrain, resource, pawn, progress or time injection. Three bounded opening campaigns, not long-term survival proof.',
  worlds: [],
  errors: [],
};
const key = (p) => `${p.x}/${p.y}/${p.z}`;
const index = (p) => (p.z * 64 + p.y) * 64 + p.x;
const block = (sim, p) => sim.blocks[index(p)];
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const point = (p) => ({ x: p.x, y: p.y, z: p.z });
const dirs = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const hash = (b) => createHash('sha256').update(b).digest('hex');
async function campaign(biome, hilliness, seed) {
  let sim = new VoxelSimulation(seed, { biome, hilliness });
  const initial = sim.counts(),
    start = { ...sim.spawn };
  const result = {
    biome,
    hilliness,
    seed,
    settings: sim.settings,
    spawn: start,
    initialSummary: sim.snapshot().worldSummary,
    checks: [],
    commands: [],
    fixtures: {},
    carriedLayers: {},
    minimumFood: 100,
  };
  report.worlds.push(result);
  function check(name, details = {}) {
    result.checks.push({ name, tick: sim.tick, ...details });
    console.log('PASS', biome, name, sim.tick);
  }
  function audit() {
    const counts = sim.counts();
    for (const r of Object.keys(initial))
      assert.equal(
        counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r],
        initial[r] + sim.stats.produced[r],
        `${biome} ${r} conservation`,
      );
    for (const pawn of sim.pawns) {
      assert(sim.standable(pawn), `unsupported pawn ${key(pawn)}`);
      result.minimumFood = Math.min(result.minimumFood, pawn.food);
      if (pawn.cargo) {
        const k = `${pawn.cargo.resource}@${pawn.z}`;
        result.carriedLayers[k] = (result.carriedLayers[k] ?? 0) + 1;
      }
    }
    assert.equal(new Set(sim.items.map(key)).size, sim.items.length);
  }
  function until(name, predicate, limit = 20000) {
    const begin = sim.tick;
    while (!predicate() && sim.tick - begin < limit) {
      sim.step();
      if (sim.tick % 10 === 0) audit();
    }
    assert(
      predicate(),
      `${name} timed out: ${JSON.stringify({ tick: sim.tick, jobs: sim.jobs, pawns: sim.pawns })}`,
    );
    audit();
    check(name);
  }
  function command(c) {
    const r = sim.command(c);
    result.commands.push({ tick: sim.tick, command: c, result: r });
    assert(r.ok, JSON.stringify({ c, r }));
    return r;
  }
  const place = (tool, p, extra = {}) =>
    command({ type: 'designate', tool, from: point(p), ...extra });
  const reachable = (p) => sim.standable(p) && sim.path(sim.pawns[0], p) !== null;
  const surface = [];
  for (let y = 1; y < 63; y++)
    for (let x = 1; x < 63; x++) {
      let z = 14;
      while (z > 0 && !block(sim, { x, y, z })) z--;
      const p = { x, y, z: z + 1 };
      if (sim.standable(p)) surface.push(p);
    }
  surface.sort((a, b) => dist(a, start) - dist(b, start));
  async function save(name) {
    const bytes = JSON.stringify(sim.save()),
      file = `${OUT}/${biome}-${name}.json`;
    await writeFile(file, bytes);
    result.fixtures[name] = { file, sha256: hash(bytes), tick: sim.tick };
  }
  assert.equal(sim.generator, 2);
  assert.equal(sim.save().version, 10);
  audit();
  await save('start');
  for (const p of surface
    .filter((p) => dist(p, start) >= 3 && dist(p, start) <= 9 && reachable(p))
    .slice(0, 20))
    place('stock', p);
  const availableTrees = [...sim.trees]
    .filter((t) => t.growth === 1)
    .sort((a, b) => dist(a, start) - dist(b, start))
    .filter((t) => dirs.some(([dx, dy]) => reachable({ x: t.x + dx, y: t.y + dy, z: t.z })));
  assert(availableTrees.length >= 3);
  const treeIds = availableTrees.slice(0, 3).map((t) => t.id);
  const expectedWood = availableTrees.slice(0, 3).reduce((sum, t) => sum + t.wood, 0);
  for (const tree of availableTrees.slice(0, 3)) place('cut', tree);
  until(
    'three actual local trees are cut and wood is carried into storage',
    () =>
      treeIds.every((id) => !sim.trees.some((t) => t.id === id)) &&
      sim.snapshot().stored.wood === initial.wood + expectedWood,
  );
  assert.equal(sim.stats.produced.wood, expectedWood);

  const farmSites = surface
    .filter(
      (p) =>
        !sim.stockpiles.some((s) => key(s) === key(p)) &&
        [1, 8, 10].includes(block(sim, { ...p, z: p.z - 1 })) &&
        reachable(p),
    )
    .slice(0, 4);
  assert.equal(farmSites.length, 4);
  for (const p of farmSites) place('farm', p, { crop: 'potato' });
  until('workers sow four plots on real fertile terrain', () => sim.crops.length === 4);
  const sand = surface.find((p) => block(sim, { ...p, z: p.z - 1 }) === 9 && reachable(p));
  if (sand) {
    const denied = sim.command({ type: 'designate', tool: 'farm', from: sand, crop: 'potato' });
    assert(!denied.ok);
    check('sand rejects ordinary crop zoning through the public command');
  }
  // Find a generated ore face adjacent to a surface-reachable three-level shaft.
  let site;
  for (const p of [...surface].sort((a, b) => dist(a, start) - dist(b, start))) {
    if (
      p.z < 4 ||
      p.z > 11 ||
      !reachable(p) ||
      sim.stockpiles.some((q) => key(q) === key(p)) ||
      farmSites.some((q) => key(q) === key(p))
    )
      continue;
    for (const [dx, dy] of dirs) {
      const ore = { x: p.x + dx, y: p.y + dy, z: p.z - 3 };
      if ([ore, { ...ore, z: ore.z + 1 }].some((q) => block(sim, q) === 3)) {
        site = { entry: p, ore };
        break;
      }
    }
    if (site) break;
  }
  assert(site, `${biome} has no tested reachable ore opening`);
  result.oreSite = site;
  place('shaft', site.entry);
  until(
    'a real shaft reaches three levels below its local surface',
    () =>
      [0, 1, 2, 3].every((n) => sim.ladders[index({ ...site.entry, z: site.entry.z - n })]) &&
      !sim.jobs.some((j) => j.kind === 'digLadder'),
  );
  assert(sim.path(sim.pawns[0], { ...site.entry, z: site.entry.z - 3 }));
  place('mine', site.ore);
  until(
    'finite generated steel is mined and hauled back to surface stores',
    () =>
      sim.stats.produced.steel > 0 &&
      sim.snapshot().stored.steel === sim.counts().steel &&
      !sim.jobs.some((j) => j.kind === 'mine'),
  );
  assert(result.carriedLayers[`steel@${site.ore.z}`] > 0);
  await save('mined');
  const before = sim.save();
  sim = VoxelSimulation.load(before);
  assert.equal(sim.generator, 2);
  assert.deepEqual(sim.settings, before.settings);
  assert.deepEqual(sim.blocks, VoxelSimulation.load(before).blocks);
  assert.deepEqual(
    sim.counts(),
    Object.fromEntries(
      Object.entries(initial).map(([r, n]) => [
        r,
        n + before.stats.produced[r] - before.stats.consumed[r] - before.stats.spoiled[r],
      ]),
    ),
  );
  check('save reload preserves climate, finite mined terrain and material balances');

  place('up', site.entry);
  until(
    'the same shaft extends upward from the actual local surface',
    () =>
      [0, 1, 2, 3].every((n) => sim.ladders[index({ ...site.entry, z: site.entry.z + n })]) &&
      !sim.jobs.some((j) => j.kind === 'ladder'),
  );
  const upper = dirs
    .map(([dx, dy]) => ({ x: site.entry.x + dx, y: site.entry.y + dy, z: site.entry.z + 3 }))
    .find((p) => !block(sim, p) && !block(sim, { ...p, z: p.z - 1 }));
  assert(upper);
  place('floor', upper);
  until(
    'a worker builds a supported upper floor on generated terrain',
    () =>
      block(sim, { ...upper, z: upper.z - 1 }) === 4 && !sim.jobs.some((j) => j.kind === 'floor'),
  );
  assert(sim.path({ ...site.entry, z: site.entry.z - 3 }, upper));
  await save('final');
  audit();
  result.finalTick = sim.tick;
  result.finalStats = sim.stats;
  result.finalTemperature = sim.snapshot().temperature;
}
try {
  await campaign('temperate', 'small', 73129);
  await campaign('boreal', 'large', 2718);
  await campaign('desert', 'mountainous', 42);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.errors.push(String(error));
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
