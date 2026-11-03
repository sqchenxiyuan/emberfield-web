import { loadLegacyStart, LEGACY_START } from './voxel-legacy-start.mjs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = process.env.VOXEL_LOGISTICS_OUT ?? 'test-results/voxel-logistics-campaign';
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
const p = (x, y, z = 8) => ({ x, y, z });
const key = (p) => `${p.x}/${p.y}/${p.z}`;
const same = (a, b) => key(a) === key(b);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
let sim = await loadLegacyStart(VoxelSimulation);
const initial = sim.counts();
const report = {
  baseline: LEGACY_START,
  scope:
    'Normal command/step/save/load only, no injected resources, terrain, needs, items or time. Finite ground stacks, physical hauling, full storage, changed filters, expansion and cross-level transfer. Separately imports an unchanged save from the previously published v5 normal preservation campaign.',
  checks: [],
  commands: [],
  fixtures: {},
  errors: [],
  minimumFood: 100,
};
function audit(world = sim, initialCounts = initial) {
  const counts = world.counts();
  for (const r of Object.keys(initialCounts))
    assert.equal(
      counts[r] + world.stats.consumed[r] + world.stats.spoiled[r],
      initialCounts[r] + world.stats.produced[r],
      `${r} ledger at ${world.tick}`,
    );
  assert.equal(
    new Set(world.items.map(key)).size,
    world.items.length,
    'one physical stack per cell',
  );
  for (const item of world.items) {
    assert(
      Object.keys(item).every((k) =>
        ['id', 'resource', 'amount', 'crop', 'rotProgress', 'x', 'y', 'z'].includes(k),
      ),
      'ground stacks contain only item data, never copied pawn state',
    );
    assert(
      Number.isSafeInteger(item.amount) && item.amount > 0 && item.amount <= limits[item.resource],
    );
    assert(world.standable(item), 'item rests on supported reachable-height ground');
  }
  for (const pawn of world.pawns) {
    assert(world.standable(pawn));
    if (pawn.cargo) assert(pawn.cargo.amount <= Math.min(75, limits[pawn.cargo.resource]));
    report.minimumFood = Math.min(report.minimumFood, pawn.food);
  }
  for (const row of world.storageCapacity()) {
    assert(row.reserved >= 0);
    assert(row.amount <= row.limit || row.amount === 0);
    assert(Object.values(row.available).every((n) => n >= 0));
  }
}
function check(name, details = {}) {
  report.checks.push({ name, tick: sim.tick, ...details });
  console.log('PASS', name, JSON.stringify(details));
}
function command(c) {
  const result = sim.command(c);
  report.commands.push({ tick: sim.tick, command: c, result });
  assert(result.ok, JSON.stringify({ c, result }));
  return result;
}
function place(tool, from, to) {
  return command({ type: 'designate', tool, from, ...(to ? { to } : {}) });
}
function storage(from, accepts, priority = 3, to) {
  return command({ type: 'storage', from, accepts, priority, ...(to ? { to } : {}) });
}
function step(n = 1) {
  for (let i = 0; i < n; i++) {
    sim.step();
    audit();
  }
}
function until(name, predicate, limit = 10000) {
  const start = sim.tick;
  while (!predicate() && sim.tick - start < limit) step();
  assert(
    predicate(),
    `${name}: ${JSON.stringify({ tick: sim.tick, items: sim.items, jobs: sim.jobs, pawns: sim.pawns, capacity: sim.storageCapacity() })}`,
  );
  check(name, { elapsed: sim.tick - start });
}
async function save(name, world = sim) {
  const bytes = JSON.stringify(world.save()),
    file = `${OUT}/${name}.json`;
  await writeFile(file, bytes);
  report.fixtures[name] = { file, sha256: sha(bytes), tick: world.tick };
}
const itemAt = (q, resource) =>
  sim.items.find((i) => same(i, q) && (!resource || i.resource === resource));
try {
  assert.equal(initial.wood, 90);
  assert.equal(initial.food, 60);
  audit();
  assert.equal(sim.items.filter((i) => i.resource === 'food').length, 6);
  check('new colony retains ninety wood and sixty rations in legal finite stacks');
  for (const stock of [...sim.stockpiles]) storage(stock, [], 0);
  await save('before-single');
  const single = p(36, 34),
    woodOverflow = p(37, 34);
  place('stock', single);
  storage(single, ['wood']);
  until(
    'three haulers cannot exceed one seventy-five-unit wood slot',
    () => itemAt(single, 'wood')?.amount === 75 && sim.pawns.every((p) => !p.cargo),
  );
  assert.equal(sim.counts().wood, 90);
  const hauled = sim.stats.hauled;
  step(240);
  assert.equal(sim.stats.hauled, hauled);
  assert.equal(itemAt(single).amount, 75);
  assert.equal(sim.storageSpace(single, { resource: 'wood' }), 0);
  check('full warehouse remains stable while fifteen wood stays outside');
  await save('full-single');

  storage(single, ['food']);
  step(120);
  assert.equal(itemAt(single).resource, 'wood');
  assert.equal(itemAt(single).amount, 75);
  assert.equal(sim.storageSpace(single, { resource: 'food' }), 0);
  check('changing a full cell filter never overwrites its existing wood');
  await save('blocked-filter');
  place('stock', woodOverflow);
  storage(woodOverflow, ['wood']);
  until(
    'new wood storage frees the rejected cell and rations physically move in',
    () =>
      itemAt(woodOverflow, 'wood')?.amount === 75 &&
      itemAt(single, 'food')?.amount === 10 &&
      sim.pawns.every((p) => !p.cargo),
  );

  place('stock', p(37, 35));
  storage(p(37, 35), ['wood']);
  place('stock', p(34, 34), p(36, 35));
  storage(p(34, 34), ['food'], 3, p(36, 35));
  until('expanding real ground storage admits the remaining wood and rations', () => {
    const s = sim.snapshot();
    return (
      s.stored.wood === sim.counts().wood &&
      s.stored.food === sim.counts().food &&
      sim.pawns.every((p) => !p.cargo)
    );
  });
  assert.equal(sim.items.filter((i) => i.resource === 'wood').length, 2);
  check('ground inventory occupies separate finite stacks', {
    items: sim.items.map((i) => ({
      id: i.id,
      resource: i.resource,
      amount: i.amount,
      x: i.x,
      y: i.y,
      z: i.z,
    })),
    capacity: sim.storageCapacity(),
  });
  await save('expanded');

  // These cells are ordinary supported ground next to the starter clearing.
  // Mineral stock is deliberately separate from the food and wood filters.
  place('stock', p(28, 34), p(30, 36));
  storage(p(28, 34), ['stone', 'chunk', 'steel', 'components'], 1, p(30, 36));
  place('shaft', p(33, 32));
  until('workers excavate a real three-level shaft', () => sim.jobs.length === 0);
  place('mine', p(34, 32, 5), p(36, 33, 5));
  until(
    'finite ore stacks are mined and transported away from future storage',
    () =>
      sim.jobs.length === 0 &&
      !sim.items.some((i) => i.z === 5) &&
      sim.pawns.every((p) => !p.cargo),
  );
  place('stock', p(34, 32, 5), p(34, 33, 5));
  storage(p(34, 32, 5), ['wood'], 3, p(34, 33, 5));
  storage(woodOverflow, ['wood'], 2);
  storage(p(37, 35), ['wood'], 2);
  until('a finite wood cargo physically travels down the ladder', () =>
    sim.pawns.some((p) => p.cargo?.resource === 'wood' && p.z < 8),
  );
  await save('in-transit');
  const before = sim.save(),
    beforeCounts = sim.counts();
  sim = VoxelSimulation.load(before);
  assert.deepEqual(sim.counts(), beforeCounts);
  audit();
  until(
    'save reload rebuilds reservations and completes cross-level storage',
    () =>
      sim.items.filter((i) => i.resource === 'wood').every((i) => i.z === 5) &&
      sim.pawns.every((p) => !p.cargo),
  );
  assert.equal(
    sim.items.filter((i) => i.resource === 'wood').length,
    Math.ceil(sim.counts().wood / 75),
  );
  await save('final');

  const legacyBytes = await readFile('tests/fixtures/voxel-v5-cold-store.json');
  assert.equal(
    sha(legacyBytes),
    '0f239085ebd34f8ff6f17da4716cc875e908255f82d527746847f28f543a9f20',
  );
  const legacy = JSON.parse(legacyBytes);
  assert.equal(legacy.version, 5);
  function containers(save) {
    return [
      ...save.items,
      ...save.pawns.flatMap((p) => (p.cargo ? [p.cargo] : [])),
      ...save.jobs.flatMap((j) => j.deliveredFood),
    ];
  }
  function foodAges(save) {
    const out = {};
    for (const b of containers(save))
      if (b.rotProgress !== undefined) {
        const k = `${b.resource}/${b.crop ?? ''}`;
        out[k] ??= { amount: 0, ageSum: 0 };
        out[k].amount += b.amount;
        out[k].ageSum += b.amount * b.rotProgress;
      }
    return out;
  }
  const migrated = VoxelSimulation.load(legacy),
    newSave = migrated.save();
  assert.equal(newSave.version, 14);
  const oldAges = foodAges(legacy),
    newAges = foodAges(newSave);
  assert.deepEqual(Object.keys(newAges).sort(), Object.keys(oldAges).sort());
  for (const k of Object.keys(oldAges)) {
    assert.equal(newAges[k].amount, oldAges[k].amount);
    assert(
      Math.abs(newAges[k].ageSum - oldAges[k].ageSum) < 1e-6,
      'migration preserves weighted age',
    );
  }
  const legacyCounts = Object.fromEntries(
    Object.keys(initial).map((r) => [
      r,
      legacy.items.filter((i) => i.resource === r).reduce((n, i) => n + i.amount, 0) +
        legacy.pawns.reduce((n, p) => n + (p.cargo?.resource === r ? p.cargo.amount : 0), 0) +
        legacy.jobs.reduce((n, j) => n + (j.delivered[r] ?? 0), 0),
    ]),
  );
  assert.deepEqual(migrated.counts(), legacyCounts);
  const legacyInitial = Object.fromEntries(
    Object.keys(initial).map((r) => [
      r,
      legacyCounts[r] +
        (legacy.stats.consumed[r] ?? 0) +
        (legacy.stats.spoiled[r] ?? 0) -
        (legacy.stats.produced[r] ?? 0),
    ]),
  );
  audit(migrated, legacyInitial);
  for (let n = 0; n < 240; n++) {
    migrated.step();
    audit(migrated, legacyInitial);
  }
  await save('migrated-v5', migrated);
  check(
    'unchanged published v5 cold-store save migrates and continues without losing food age or materials',
    {
      sourceSha256: sha(legacyBytes),
      sourceTick: legacy.tick,
      migratedTick: migrated.tick,
      oldAges,
      migratedInitialAges: newAges,
    },
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
  await save('failed');
  throw e;
} finally {
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
