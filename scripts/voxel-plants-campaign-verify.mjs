import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_PLANTS_OUT ?? 'test-results/voxel-plants-campaign';
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
const DAY = 12000;
let sim = new VoxelSimulation(73129, {
  biome: 'desert',
  hilliness: 'flat',
  meanTemperature: 24,
  rainfall: 1500,
  latitude: 0,
});
const initial = sim.counts();
const initialTrees = new Set(sim.trees.map((t) => t.id));
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Fresh generator-2 desert colony with selected warm/wet climate. Public command/step/save/load only; read-only terrain/path inspection chooses actual sites. No injected materials, trees, maturity, terrain, pawn needs or clock. This verifies one bounded planting lifecycle with food production, not all-biome long-term balance.',
  settings: sim.settings,
  seed: sim.seed,
  checks: [],
  commands: [],
  fixtures: {},
  daily: [],
  minimumFood: 100,
  naturalTreesObserved: [],
  errors: [],
  status: 'running',
};
const point = (p) => ({ x: p.x, y: p.y, z: p.z });
const key = (p) => `${p.x}/${p.y}/${p.z}`;
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const dirs = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const block = (p) => sim.blocks[(p.z * 64 + p.y) * 64 + p.x];
const reachable = (p) => sim.standable(p) && sim.path(sim.pawns[0], p) !== null;
const check = (name, details = {}) => {
  report.checks.push({ name, tick: sim.tick, ...details });
  console.log('PASS', name, sim.tick);
};
function command(c) {
  const result = sim.command(c);
  report.commands.push({ tick: sim.tick, command: c, result });
  assert(result.ok, JSON.stringify({ c, result }));
  return result;
}
const designate = (tool, p, extra = {}) =>
  command({ type: 'designate', tool, from: point(p), ...extra });
function audit() {
  const counts = sim.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r],
      initial[r] + sim.stats.produced[r],
      `${r} conservation at ${sim.tick}`,
    );
  for (const p of sim.pawns) {
    assert(sim.standable(p), `unsupported pawn ${key(p)}`);
    report.minimumFood = Math.min(report.minimumFood, p.food);
  }
  assert.equal(new Set(sim.items.map(key)).size, sim.items.length);
  for (const t of sim.trees) {
    assert(t.growth >= 0 && t.growth <= 1 && t.health > 0 && t.health <= 1);
    if (
      !initialTrees.has(t.id) &&
      !t.planted &&
      !report.naturalTreesObserved.some((v) => v.id === t.id)
    )
      report.naturalTreesObserved.push({
        id: t.id,
        firstSeen: sim.tick,
        ...point(t),
        growth: t.growth,
      });
  }
}
function step() {
  sim.step();
  if (sim.tick % 100 === 0) audit();
  if (sim.tick % DAY === 0) {
    report.daily.push({
      tick: sim.tick,
      trees: sim.trees.length,
      planted: sim.trees.filter((t) => t.planted).map((t) => ({ id: t.id, growth: t.growth })),
      counts: sim.counts(),
      food: sim.pawns.map((p) => p.food),
    });
    console.log('DAY', sim.tick / DAY);
  }
}
function until(name, predicate, limit = DAY) {
  const start = sim.tick;
  while (!predicate() && sim.tick - start < limit) step();
  assert(
    predicate(),
    `${name}: ${JSON.stringify({ tick: sim.tick, jobs: sim.jobs, pawns: sim.pawns, trees: sim.trees.filter((t) => t.planted) })}`,
  );
  audit();
  check(name);
}
async function save(name) {
  const bytes = JSON.stringify(sim.save()),
    file = `${OUT}/${name}.json`;
  await writeFile(file, bytes);
  report.fixtures[name] = {
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    tick: sim.tick,
  };
  return JSON.parse(bytes);
}
try {
  const surface = [];
  for (let y = 1; y < 63; y++)
    for (let x = 1; x < 63; x++) {
      let z = 14;
      while (z > 0 && !block({ x, y, z })) z--;
      const p = { x, y, z: z + 1 };
      if (reachable(p)) surface.push(p);
    }
  surface.sort((a, b) => dist(a, sim.spawn) - dist(b, sim.spawn) || a.y - b.y || a.x - b.x);
  const stock = surface.filter((p) => dist(p, sim.spawn) >= 3).slice(0, 50);
  for (const p of stock) designate('stock', p);
  const reserved = new Set([...sim.stockpiles, ...sim.items].map(key));
  const stove = surface.find((p) => !reserved.has(key(p)) && dist(p, sim.spawn) >= 2);
  assert(stove);
  reserved.add(key(stove));
  designate('stove', stove);
  const plot = surface.find(
    (p) =>
      !reserved.has(key(p)) &&
      dist(p, sim.spawn) >= 4 &&
      !sim.trees.some((t) => t.z === p.z && Math.abs(t.x - p.x) <= 2 && Math.abs(t.y - p.y) <= 2),
  );
  assert(plot);
  reserved.add(key(plot));
  // Keep the tree's immediate neighbors as accessible work space.
  for (const p of surface)
    if (p.z === plot.z && Math.abs(p.x - plot.x) <= 1 && Math.abs(p.y - plot.y) <= 1)
      reserved.add(key(p));
  const farms = surface
    .filter((p) => !reserved.has(key(p)) && [1, 8, 10].includes(block({ ...p, z: p.z - 1 })))
    .slice(0, 160);
  assert.equal(farms.length, 160, 'enough real fertile soil');
  for (const p of farms) designate('farm', p, { crop: 'rice' });
  const cutTrees = sim.trees
    .filter(
      (t) =>
        t.growth >= 1 && dirs.some(([dx, dy]) => reachable({ ...t, x: t.x + dx, y: t.y + dy })),
    )
    .sort((a, b) => dist(a, sim.spawn) - dist(b, sim.spawn))
    .slice(0, 8);
  assert.equal(cutTrees.length, 8);
  for (const t of cutTrees) designate('cut', t);
  designate('grove', plot, { treeSpecies: 'saguaro' });
  until(
    'workers build a stove, sow food and plant the chosen tree',
    () =>
      sim.stoves.length === 1 &&
      sim.crops.length === 160 &&
      sim.trees.some((t) => t.planted && key(t) === key(plot)),
    DAY * 2,
  );
  command({ type: 'bill', stoveId: sim.stoves[0].id, target: 6, paused: false });
  const planted = sim.trees.find((t) => t.planted && key(t) === key(plot));
  const treeId = planted.id;
  assert(planted.growth < 0.2);
  assert.equal(planted.species, 'saguaro');
  await save('sapling');
  until(
    'the planted tree grows under the actual day and night cycle',
    () => sim.trees.find((t) => t.id === treeId)?.growth >= 0.15,
    DAY * 5,
  );
  const middle = await save('growing');
  sim = VoxelSimulation.load(middle);
  assert.deepEqual(sim.trees, middle.trees);
  assert.deepEqual(sim.treePlots, middle.treePlots);
  check('save migration and reload retain growth, health, age and planting zones');
  until(
    'food is harvested, cooked and eaten while the tree grows',
    () => sim.stats.harvested > 0 && sim.stats.cooked > 0 && sim.stats.consumed.meal > 0,
    DAY * 15,
  );
  until(
    'the planted tree reaches maturity without changing its growth or clock',
    () => sim.trees.find((t) => t.id === treeId)?.growth === 1,
    DAY * 15,
  );
  const mature = sim.trees.find((t) => t.id === treeId);
  const condition = sim.snapshot().treeConditions.find((c) => c.id === treeId);
  assert.equal(condition.yield, 15);
  assert(condition.mature);
  await save('mature');
  const woodBefore = sim.stats.produced.wood;
  designate('cut', mature);
  until(
    'mature tree is physically cut and its exact wood output is accounted',
    () => !sim.trees.some((t) => t.id === treeId),
  );
  assert.equal(sim.stats.produced.wood - woodBefore, 15);
  until('the same maintained plot is replanted after manual cutting', () =>
    sim.trees.some((t) => t.planted && key(t) === key(plot) && t.id !== treeId),
  );
  const replacement = sim.trees.find((t) => t.planted && key(t) === key(plot));
  assert(replacement.growth < 0.1);
  await save('replanted');
  designate('clearZone', plot);
  assert(sim.trees.some((t) => t.id === replacement.id));
  assert(!sim.treePlots.some((t) => key(t) === key(plot)));
  check('removing the planting zone preserves the living tree');
  const before = sim.stats.produced.wood;
  designate('cut', replacement);
  until(
    'clearing the young replacement produces no free wood',
    () => !sim.trees.some((t) => t.id === replacement.id),
  );
  assert.equal(sim.stats.produced.wood, before);
  assert(!sim.jobs.some((j) => j.kind === 'plantTree' && key(j) === key(plot)));
  until(
    'natural seedlings appear outside reserved colony cells',
    () => report.naturalTreesObserved.length > 0,
    DAY * 20,
  );
  for (const t of sim.trees.filter((t) => !initialTrees.has(t.id) && !t.planted)) {
    assert(!sim.farms.some((f) => key(f) === key(t)));
    assert(!sim.stockpiles.some((f) => key(f) === key(t)));
    assert(!sim.pawns.some((p) => key(p) === key(t)));
    assert(!sim.items.some((p) => key(p) === key(t)));
  }
  assert(report.minimumFood > 0, 'colony must remain fed through the real calendar cycle');
  await save('final');
  report.final = {
    tick: sim.tick,
    days: sim.tick / DAY,
    counts: sim.counts(),
    stats: sim.stats,
    trees: sim.trees.length,
    minimumFood: report.minimumFood,
    naturalSeedlings: report.naturalTreesObserved.length,
  };
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e));
  await save('failure');
  throw e;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
