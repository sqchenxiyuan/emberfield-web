import { loadLegacyStart, LEGACY_START } from './voxel-legacy-start.mjs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = process.env.VOXEL_STONECUTTING_OUT ?? 'test-results/voxel-stonecutting-campaign';
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
const sha = (b) => createHash('sha256').update(b).digest('hex');
const p = (x, y, z = 8) => ({ x, y, z });
const at = (q) => (q.z * 64 + q.y) * 64 + q.x;
const key = (q) => `${q.x}/${q.y}/${q.z}`;
const limits = {
  wood: 75,
  stone: 75,
  chunk: 1,
  steel: 75,
  components: 50,
  food: 10,
  grain: 75,
  meal: 10,
};
let sim = await loadLegacyStart(VoxelSimulation);
const initial = sim.counts();
const report = {
  baseline: LEGACY_START,
  scope:
    'Normal commands, step, save and load. No injected resources, blocks, needs, pawn positions, task progress or time. Excavate native-inspired probabilistic chunks, carry them up actual ladders, build and operate a stonecutter, then deliver its bricks into upper-floor construction. Separately migrate unchanged published v6 gameplay bytes.',
  commands: [],
  checks: [],
  fixtures: {},
  minimumFood: 100,
  carriedLayers: {},
  errors: [],
};
function audit() {
  const c = sim.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      c[r] + sim.stats.consumed[r] + sim.stats.spoiled[r],
      initial[r] + sim.stats.produced[r],
      `${r} balance at ${sim.tick}`,
    );
  assert.equal(new Set(sim.items.map(key)).size, sim.items.length);
  for (const item of sim.items)
    assert(item.amount > 0 && item.amount <= limits[item.resource] && sim.standable(item));
  for (const pawn of sim.pawns) {
    assert(sim.standable(pawn));
    report.minimumFood = Math.min(report.minimumFood, pawn.food);
    if (pawn.cargo) {
      assert(pawn.cargo.amount <= limits[pawn.cargo.resource]);
      const k = `${pawn.cargo.resource}@${pawn.z}`;
      report.carriedLayers[k] = (report.carriedLayers[k] ?? 0) + 1;
    }
  }
}
function command(c) {
  const result = sim.command(c);
  report.commands.push({ tick: sim.tick, command: c, result });
  assert(result.ok, JSON.stringify({ c, result }));
  return result;
}
function place(tool, from, to, extra = {}) {
  return command({ type: 'designate', tool, from, to, ...extra });
}
function check(name, data = {}) {
  report.checks.push({ name, tick: sim.tick, ...data });
  console.log('PASS', name, sim.tick);
}
function advance(n) {
  for (let i = 0; i < n; i++) {
    sim.step();
    audit();
  }
}
function until(name, fn, limit = 24000) {
  const start = sim.tick;
  while (!fn() && sim.tick - start < limit) advance(1);
  assert(
    fn(),
    `${name}: ${JSON.stringify({ tick: sim.tick, counts: sim.counts(), jobs: sim.jobs, pawns: sim.pawns })}`,
  );
  check(name, { elapsed: sim.tick - start });
}
async function save(name) {
  const bytes = JSON.stringify(sim.save()),
    file = `${OUT}/${name}.json`;
  await writeFile(file, bytes);
  report.fixtures[name] = { file, sha256: sha(bytes), tick: sim.tick };
}
const bill = (target, paused = false) =>
  command({ type: 'stoneBill', stonecutterId: sim.stonecutters[0].id, target, paused });
try {
  place('stock', p(28, 32), p(31, 36));
  place('stock', p(34, 35), p(37, 36));
  for (const [x, y] of [
    [27, 29],
    [28, 27],
    [36, 28],
  ])
    place('cut', p(x, y));
  until('normal trees supply the wooden workbench', () => sim.stats.cut === 3 && !sim.jobs.length);
  place('shaft', p(33, 32));
  until('a real shaft connects the three-level underground', () => !sim.jobs.length);
  place('mine', p(34, 32, 5));
  until(
    'the guaranteed steel cell supplies workbench metal',
    // Skill affects ore yield; the actual bench recipe needs 30 steel.
    () => !sim.jobs.length && sim.counts().steel >= 30,
  );
  place('mine', p(35, 30, 5), p(39, 33, 5));
  until('first granite chamber is excavated', () => !sim.jobs.length);
  for (const x of [40, 45, 50]) {
    if (sim.counts().chunk >= 4) break;
    place('mine', p(x, 30, 5), p(x + 4, 33, 5));
    until('miners extend the chamber while raw chunks remain insufficient', () => !sim.jobs.length);
  }
  until(
    'excavating natural granite creates individual chunks instead of construction bricks',
    () => !sim.jobs.length && sim.counts().chunk >= 4,
  );
  assert.equal(sim.counts().stone, 0);
  until(
    'workers physically carry chunks out of the underground to finite storage',
    () => sim.snapshot().stored.chunk === sim.counts().chunk && sim.pawns.every((q) => !q.cargo),
  );
  assert(report.carriedLayers['chunk@5'] > 0 && report.carriedLayers['chunk@8'] > 0);
  await save('before-table');
  place('stonecutter', p(34, 34), undefined, { axis: 'x' });
  until(
    'three-cell stonecutter is built from delivered seventy-five wood and thirty steel',
    () => sim.stonecutters.length === 1 && !sim.jobs.some((j) => j.kind === 'stonecutter'),
  );
  assert.equal(sim.stats.consumed.steel, 30);
  bill(20, true);
  await save('ready');
  bill(20);
  until('a normal worker delivers one chunk and begins actual cutting', () =>
    sim.jobs.some(
      (j) =>
        j.kind === 'stonecut' && j.delivered.chunk === 1 && j.progress > 30 && j.progress < j.work,
    ),
  );
  await save('working');
  const beforePause = sim.counts();
  bill(20, true);
  advance(80);
  assert.deepEqual(sim.counts(), beforePause);
  assert.equal(sim.stats.stonecut, 0);
  assert(!sim.jobs.some((j) => j.kind === 'stonecut' && !j.cancelled));
  check('bill suspension refunds the chunk without producing bricks');
  bill(20);
  until('resumed bill obtains a real input and performs new work', () =>
    sim.jobs.some((j) => j.kind === 'stonecut' && j.progress > 40),
  );
  const active = sim.jobs.find((j) => j.kind === 'stonecut'),
    progress = active.progress,
    counts = sim.counts();
  for (const target of [100, 0]) {
    bill(target);
    assert.equal(sim.jobs.find((j) => j.kind === 'stonecut').id, active.id);
    assert.equal(sim.jobs.find((j) => j.kind === 'stonecut').progress, progress);
    assert.deepEqual(sim.counts(), counts);
  }
  check('raising and lowering the target preserves the current cutting batch');
  await save('mid-work');
  sim = VoxelSimulation.load(sim.save());
  assert.equal(sim.jobs.find((j) => j.kind === 'stonecut').progress, progress);
  assert.deepEqual(sim.counts(), counts);
  until(
    'loading an in-progress cutting job completes exactly one chunk into twenty bricks',
    () => sim.stats.stonecut === 1 && sim.counts().stone === 20,
  );
  advance(40);
  assert.equal(sim.stats.stonecut, 1);
  assert(!sim.jobs.some((j) => j.kind === 'stonecut'));
  check('a lowered target lets the current batch finish and prevents the next batch');
  bill(20, true);
  assert.equal(sim.stats.consumed.chunk, 1);
  assert.equal(sim.stats.produced.stone, 20);
  await save('first-batch');
  place('up', p(31, 30));
  until('the upper construction route is built normally', () => !sim.jobs.length);
  place('floor', p(32, 30, 11), undefined, { material: 'stone' });
  until(
    'processed bricks are carried upstairs into a physical stone floor',
    () => sim.blocks[at(p(32, 30, 10))] === 7 && !sim.jobs.length,
  );
  place('wall', p(32, 30, 11), undefined, { material: 'stone' });
  until(
    'ten processed bricks create a two-voxel-high masonry wall',
    () =>
      sim.blocks[at(p(32, 30, 11))] === 7 &&
      sim.blocks[at(p(32, 30, 12))] === 7 &&
      !sim.jobs.length,
  );
  assert.equal(sim.stats.consumed.stone, 14);
  assert.equal(sim.counts().stone, 6);
  assert(report.carriedLayers['stone@11'] > 0);
  await save('masonry');
  bill(60);
  until(
    'target-count bill replenishes bricks in complete batches',
    () => sim.counts().stone >= 60 && !sim.jobs.some((j) => j.kind === 'stonecut'),
  );
  assert.equal(sim.counts().stone, 66);
  assert.equal(sim.stats.stonecut, 4);
  bill(60, true);
  const beforeRemoval = sim.counts().stone;
  place('remove', p(32, 30, 11));
  until(
    'masonry removal returns bricks and never turns stone into wood',
    () =>
      sim.blocks[at(p(32, 30, 11))] === 0 &&
      sim.blocks[at(p(32, 30, 12))] === 0 &&
      !sim.jobs.length,
  );
  assert.equal(sim.counts().stone, beforeRemoval + 4);
  await save('final');
  const fixture = 'tests/fixtures/voxel-v6-logistics.json',
    bytes = await readFile(fixture),
    old = JSON.parse(bytes);
  assert.equal(sha(bytes), '8063226ef027897139f295a02e8b53963c94f1c48853c2c83e36edf1d628d36d');
  const migrated = VoxelSimulation.load(old);
  const after = migrated.save();
  assert.equal(after.version, 15);
  assert.equal(migrated.counts().stone, 15);
  assert.equal(migrated.counts().chunk, 0);
  assert.deepEqual(after.stockpiles, old.stockpiles);
  assert.deepEqual(after.items, old.items);
  assert(after.pawns.every((q) => q.priorities.craft === 1));
  assert.deepEqual(after.stonecutters, []);
  check(
    'unchanged published v6 save keeps old stone as processed bricks and preserves storage filters',
    { sha256: sha(bytes), sourceTick: old.tick },
  );
  report.final = {
    tick: sim.tick,
    counts: sim.counts(),
    stats: sim.stats,
    minimumFood: report.minimumFood,
  };
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  await writeFile(`${OUT}/failed.json`, JSON.stringify(sim.save()));
  throw e;
} finally {
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
