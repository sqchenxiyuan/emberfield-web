import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_PRESERVATION_OUT ?? 'test-results/voxel-preservation-campaign';
const SOURCE =
  process.env.VOXEL_PRESERVATION_SOURCE ?? 'test-results/voxel-preservation-power/final.json';
const DAY = 12000;
const sha = (v) => createHash('sha256').update(v).digest('hex');
await mkdir(OUT, { recursive: true });
const bundle = await build({
  entryPoints: ['src/voxel/world.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { VoxelSimulation } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const bytes = await readFile(SOURCE);
let sim = VoxelSimulation.load(JSON.parse(bytes));
const report = {
  scope:
    'Normal command/step/save/load only. Continues a freshly generated normal power campaign with mined finite resources; no injected food, age, temperature, fuel, energy, position or time. Crops grow through natural calendar cycles, ingredients are hauled and cooked. Frozen and power-off branches start from the same physical save. Accelerated Node ticks are not real-time native observations.',
  source: { file: SOURCE, sha256: sha(bytes), tick: sim.tick },
  commands: [],
  checks: [],
  samples: [],
  fixtures: {},
  minimumFood: 100,
  errors: [],
};
const pos = (x, y, z = 8) => ({ x, y, z });
const key = (p) => `${p.x},${p.y},${p.z}`;
const same = (a, b) => key(a) === key(b);
const initial = Object.fromEntries(
  Object.entries(sim.counts()).map(([r, n]) => [
    r,
    n + sim.stats.consumed[r] + sim.stats.spoiled[r] - sim.stats.produced[r],
  ]),
);
const cold = pos(36, 28, 5);
const check = (name, data = {}) => {
  report.checks.push({ name, tick: sim.tick, ...data });
  console.log('PASS', name, sim.tick);
};
function temperature(world, p) {
  return world.thermal.temperatureAt(p, world.snapshot().temperature);
}
function audit(world = sim) {
  const counts = world.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      counts[r] + world.stats.consumed[r] + world.stats.spoiled[r],
      initial[r] + world.stats.produced[r],
      `${r} ledger at ${world.tick}`,
    );
  for (const pawn of world.pawns) {
    assert.ok(world.standable(pawn), 'supported colonist');
    report.minimumFood = Math.min(report.minimumFood, pawn.food);
  }
  assert.ok(world.items.every((i) => i.amount > 0));
}
function command(c, world = sim) {
  const result = world.command(c);
  report.commands.push({
    tick: world.tick,
    branch: world === sim ? 'primary' : 'warm',
    command: c,
    result,
  });
  assert.ok(result.ok, JSON.stringify({ c, result }));
  return result;
}
const place = (tool, from, to, crop) =>
  command({ type: 'designate', tool, from, to, ...(crop ? { crop } : {}) });
function until(name, predicate, limit = DAY * 3) {
  const start = sim.tick;
  while (!predicate() && sim.tick - start < limit) {
    sim.step();
    if (sim.tick % 40 === 0) audit();
  }
  assert.ok(
    predicate(),
    `${name} at ${sim.tick}: ${JSON.stringify({ counts: sim.counts(), jobs: sim.jobs, pawns: sim.pawns, devices: sim.devices, temperatures: sim.snapshot().roomTemperatures })}`,
  );
  audit();
  check(name, { elapsed: sim.tick - start });
}
async function save(name, world = sim) {
  const bytes = JSON.stringify(world.save());
  await writeFile(`${OUT}/${name}.json`, bytes);
  report.fixtures[name] = { file: `${OUT}/${name}.json`, sha256: sha(bytes), tick: world.tick };
}
try {
  audit();
  // Open only the exhaust room's roof via a real shaft to outdoor air.
  place('shaft', pos(40, 30));
  until(
    'workers excavate a real exhaust shaft to outdoors',
    () => !sim.jobs.some((j) => j.kind !== 'refuel'),
  );
  const generator = sim.devices.find((d) => d.kind === 'generator');
  const heater = sim.devices.find((d) => d.kind === 'heater');
  const cooler = sim.devices.find((d) => d.kind === 'cooler');
  const solar = sim.devices.find((d) => d.kind === 'solar');
  const battery = sim.devices.find((d) => d.kind === 'battery');
  for (const d of [solar, battery, cooler])
    command({
      type: 'device',
      deviceId: d.id,
      on: true,
      target: d.kind === 'cooler' ? -20 : d.target,
    });
  for (const d of [generator, heater])
    command({ type: 'device', deviceId: d.id, on: false, target: d.target });
  until(
    'solar and battery cool the sealed room below freezing',
    () => temperature(sim, cold) < -1,
    DAY * 2,
  );
  check('frozen room and outdoor exhaust', {
    cold: temperature(sim, cold),
    exhaust: temperature(sim, pos(39, 29, 5)),
    devices: sim.devices,
  });

  // Grow food instead of seeding a demonstration inventory.
  for (const tree of [...sim.trees]
    .sort(
      (a, b) => Math.abs(a.x - 32) + Math.abs(a.y - 32) - Math.abs(b.x - 32) - Math.abs(b.y - 32),
    )
    .slice(0, 6))
    place('cut', tree);
  until('additional cooking wood is cut and hauled', () => sim.stats.cut >= 12);
  const stovePos = pos(32, 31);
  place('stove', stovePos);
  until('wood-fired stove constructed', () => sim.stoves.length > 0);
  const stoveId = sim.stoves[0].id;
  command({ type: 'bill', stoveId, target: 40, paused: false });
  const reserved = new Set(
    [
      stovePos,
      pos(33, 32),
      pos(40, 30),
      ...sim.stockpiles,
      ...sim.devices.flatMap((d) => {
        const dims = {
            generator: [2, 2],
            solar: [4, 4],
            battery: [1, 2],
            heater: [1, 1],
            cooler: [1, 1],
          }[d.kind],
          out = [];
        for (let y = 0; y < dims[1]; y++)
          for (let x = 0; x < dims[0]; x++)
            out.push(pos(d.x + (d.axis === 'x' ? x : y), d.y + (d.axis === 'x' ? y : x), d.z));
        return out;
      }),
    ].map(key),
  );
  const candidates = [];
  for (let y = 24; y <= 41; y++)
    for (let x = 24; x <= 41; x++) {
      const p = pos(x, y);
      if (!reserved.has(key(p)) && sim.standable(p) && sim.cropCondition(p, 'rice').fertility === 1)
        candidates.push(p);
    }
  candidates.sort((a, b) => Math.hypot(a.x - 32, a.y - 32) - Math.hypot(b.x - 32, b.y - 32));
  const needed = Math.max(0, 120 - sim.farms.length);
  const unplanted = candidates.filter((p) => !sim.farms.some((f) => same(p, f)));
  assert.ok(unplanted.length >= needed);
  for (const p of unplanted.slice(0, needed)) place('farm', p, undefined, 'rice');
  until(
    'normal harvest and cooking accumulate forty meals',
    () => sim.counts().meal >= 40,
    DAY * 20,
  );
  command({ type: 'bill', stoveId, target: 40, paused: true });
  check('warm food ages before cold storage', {
    meals: sim.items.filter((i) => i.resource === 'meal'),
    stats: structuredClone(sim.stats),
  });
  await save('warm-stock');

  place('stock', pos(35, 29, 5), pos(37, 30, 5));
  place('stock', pos(35, 27, 5), pos(37, 27, 5));
  place('stock', pos(36, 28, 5), pos(37, 28, 5));
  command({
    type: 'storage',
    from: pos(35, 29, 5),
    connected: true,
    priority: 3,
    accepts: ['food', 'grain', 'meal'],
  });
  until(
    'all meals physically reach the higher-priority underground cold store',
    () =>
      sim.items.filter((i) => i.resource === 'meal').every((i) => i.z === 5) &&
      !sim.pawns.some((p) => p.cargo?.resource === 'meal'),
  );
  assert.ok(sim.items.some((i) => i.resource === 'meal' && i.z === 5));
  until('cold store recovers below zero after hauling', () => temperature(sim, cold) < -1, DAY);
  check('cold inventory keeps its pre-existing age', {
    items: sim.items.filter((i) => i.resource === 'meal'),
    temperature: temperature(sim, cold),
  });
  assert.ok(sim.items.filter((i) => i.resource === 'meal').some((i) => i.rotProgress > 0));
  await save('cold-stock');
  const saved = sim.save(),
    before = JSON.stringify(saved);
  sim = VoxelSimulation.load(JSON.parse(before));
  const restored = sim.save();
  for (const field of ['items', 'stockpiles', 'stats', 'thermal'])
    assert.deepEqual(restored[field], saved[field], `save preserves ${field}`);
  assert.deepEqual(
    restored.pawns.map((p) => p.cargo),
    saved.pawns.map((p) => p.cargo),
    'save preserves carried food',
  );
  assert.deepEqual(
    restored.jobs.map((j) => [j.id, j.delivered, j.deliveredBatches]),
    saved.jobs.map((j) => [j.id, j.delivered, j.deliveredBatches]),
    'save preserves delivered ingredients',
  );
  const warm = VoxelSimulation.load(JSON.parse(before));
  command({ type: 'device', deviceId: cooler.id, on: false, target: -20 }, warm);
  const spoiledBefore = warm.stats.spoiled.meal,
    start = sim.tick;
  let nearSaved = false;
  while (warm.counts().meal > 0 && sim.tick - start < DAY * 8) {
    sim.step();
    warm.step();
    if (sim.tick % 40 === 0) {
      audit(sim);
      audit(warm);
    }
    const warmMeal = warm.items
      .filter((i) => i.resource === 'meal')
      .sort((a, b) => b.rotProgress - a.rotProgress)[0];
    if (
      !nearSaved &&
      warmMeal &&
      DAY * 4 - warmMeal.rotProgress <= 300 &&
      temperature(warm, warmMeal) >= 10
    ) {
      await save('near-spoilage', warm);
      nearSaved = true;
    }
    if (sim.tick % (DAY / 4) === 0)
      report.samples.push({
        tick: sim.tick,
        cold: temperature(sim, cold),
        warm: temperature(warm, cold),
        frozenMeals: sim.counts().meal,
        warmMeals: warm.counts().meal,
        frozenSpoiled: sim.stats.spoiled.meal,
        warmSpoiled: warm.stats.spoiled.meal,
      });
  }
  assert.ok(nearSaved, 'naturally aged near-spoilage fixture recorded');
  assert.ok(warm.stats.spoiled.meal > spoiledBefore, 'unpowered warm stock spoils');
  assert.equal(warm.counts().meal, 0, 'all unpowered meals eventually spoil or are eaten');
  assert.equal(
    sim.stats.spoiled.meal,
    saved.stats.spoiled.meal,
    'powered cold store preserves meals',
  );
  assert.ok(sim.counts().meal > 0, 'frozen meals remain available after the warm branch spoiled');
  assert.ok(report.minimumFood > 0, 'colony does not starve during preservation campaign');
  check('power-off food spoils while the identical powered cold store keeps food', {
    elapsed: sim.tick - start,
    cold: temperature(sim, cold),
    warm: temperature(warm, cold),
    frozenMeals: sim.counts().meal,
    warmSpoiled: warm.stats.spoiled.meal - spoiledBefore,
  });
  await save('frozen-final');
  await save('warm-final', warm);
  report.final = {
    tick: sim.tick,
    counts: sim.counts(),
    spoiled: sim.stats.spoiled,
    warmCounts: warm.counts(),
    warmSpoiled: warm.stats.spoiled,
    minimumFood: report.minimumFood,
  };
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.errors.push(String(error.stack ?? error));
  await save('failed');
  throw error;
} finally {
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
