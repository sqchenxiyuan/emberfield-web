import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT =
  process.env.VOXEL_APPAREL_TEMPERATURE_OUT ?? 'test-results/voxel-apparel-temperature';
const SEED = 73129;
const END_TICK = 3600;
const RELOAD_TICK = 1800;
await mkdir(OUT, { recursive: true });
const bundled = await build({
  stdin: {
    contents:
      "export { VoxelSimulation } from './src/voxel/world.ts'; export { healthSummary } from './src/voxel/survival.ts';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { VoxelSimulation, healthSummary } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const point = (p) => ({ x: p.x, y: p.y, z: p.z });
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Two independently generated, initially identical worlds per climate, with the same seed and absolute tick. All workers are disabled through public priority commands in both worlds. One retains its actual initial cloth shirts and pants; the other removes those same garment identities through timed removeApparel commands. All advancement uses step; checkpoint restoration uses unmodified save/load. Read-only position, temperature, needs, health, garment identity and healthSummary inspection establishes actual condition progression and capacity penalties. No injected weather, time, health, needs, items, apparel, terrain, pawn positions or room heat. This is a bounded project-runtime comparison of initial shirts and pants, not native RimWorld runtime evidence, crafted parka/duster exposure evidence, or long-term climate balance.',
  seed: SEED,
  endTick: END_TICK,
  reloadTick: RELOAD_TICK,
  branches: [],
  errors: [],
  status: 'running',
};

function allPieces(sim) {
  return [
    ...sim.items.flatMap((item) => (item.apparel ? [item.apparel] : [])),
    ...sim.pawns.flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
  ];
}

async function pairedExposure(kind, settings) {
  let clothed = new VoxelSimulation(SEED, settings);
  let naked = new VoxelSimulation(SEED, settings);
  assert.deepEqual(clothed.save(), naked.save(), 'fresh independent worlds are initially identical');
  const initial = clothed.counts();
  const initialIds = allPieces(clothed).map((p) => p.id).sort((a, b) => a - b);
  const initialPositions = new Map(clothed.pawns.map((p) => [p.id, point(p)]));
  const record = {
    kind,
    settings: structuredClone(clothed.settings),
    initialSaveSha256: sha256(JSON.stringify(clothed.save())),
    commands: [],
    checks: [],
    readings: [],
    fixtures: {},
    environment: { minimum: Infinity, maximum: -Infinity, matchedPawnTicks: 0 },
    nakedExposurePawnTicks: 0,
    firstConditionTick: null,
    firstCapacityPenaltyTick: null,
    minimumFood: 100,
    minimumRest: 100,
    fullyNakedTick: null,
  };
  report.branches.push(record);
  function check(name, details = {}) {
    record.checks.push({ name, tick: clothed.tick, ...details });
    console.log('PASS', kind, name, clothed.tick);
  }
  function command(sim, branch, c) {
    const result = sim.command(c);
    record.commands.push({ branch, tick: sim.tick, command: c, result });
    assert(result.ok, JSON.stringify({ branch, c, result }));
  }
  function snapshot(sim) {
    return {
      tick: sim.tick,
      pawns: sim.pawns.map((p) => ({
        id: p.id,
        position: point(p),
        temperature: sim.temperature(p),
        food: p.food,
        rest: p.rest,
        worn: structuredClone(p.worn),
        health: structuredClone(p.health),
        summary: healthSummary(p),
        downed: p.downed,
        dead: p.dead,
      })),
    };
  }
  function reading(label) {
    record.readings.push({ label, tick: clothed.tick, clothed: snapshot(clothed), naked: snapshot(naked) });
  }
  function auditInventory(sim) {
    const counts = sim.counts();
    for (const r of Object.keys(initial))
      assert.equal(
        counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r] + sim.stats.destroyed[r],
        initial[r] + sim.stats.produced[r],
        `${kind}: ${r} conservation at tick ${sim.tick}`,
      );
    const ids = allPieces(sim).map((p) => p.id).sort((a, b) => a - b);
    assert.deepEqual(ids, initialIds, 'normal removal preserves every real garment exactly once');
    assert.equal(counts.apparel, initialIds.length);
    assert.equal(new Set(ids).size, ids.length);
  }
  function auditPair() {
    assert.equal(clothed.tick, naked.tick, 'paired worlds have the same absolute simulation tick');
    assert.equal(clothed.seed, naked.seed);
    assert.deepEqual(clothed.settings, naked.settings);
    for (const dressed of clothed.pawns) {
      const bare = naked.pawns.find((p) => p.id === dressed.id);
      assert(bare);
      assert.deepEqual(point(dressed), initialPositions.get(dressed.id));
      assert.deepEqual(point(bare), initialPositions.get(dressed.id));
      const temperature = clothed.temperature(dressed);
      assert.equal(temperature, naked.temperature(bare), 'paired exposure temperatures match exactly');
      record.environment.minimum = Math.min(record.environment.minimum, temperature);
      record.environment.maximum = Math.max(record.environment.maximum, temperature);
      record.environment.matchedPawnTicks++;
      assert.equal(dressed.food, bare.food, 'paired food needs match');
      assert.equal(dressed.rest, bare.rest, 'paired rest needs match');
      assert(dressed.food > 30 && bare.food > 30, 'no hunger-driven trips confound the exposure');
      for (const p of [dressed, bare]) {
        assert(!p.dead && !p.downed, 'bounded nonfatal exposure');
        assert.equal(p.health.malnutrition, 0, 'no starvation confound');
        assert.equal(p.health[kind === 'hypothermia' ? 'heatstroke' : 'hypothermia'], 0);
        record.minimumFood = Math.min(record.minimumFood, p.food);
        record.minimumRest = Math.min(record.minimumRest, p.rest);
      }
      const dressedSummary = healthSummary(dressed);
      const bareSummary = healthSummary(bare);
      assert.equal(dressed.health[kind], 0, 'actual retained clothing prevents this condition');
      assert.equal(dressedSummary.consciousness, 1);
      assert.equal(dressedSummary.moving, 1);
      assert.equal(dressedSummary.manipulation, 1);
      assert(
        kind === 'hypothermia'
          ? temperature >= dressedSummary.safeMin
          : temperature <= dressedSummary.safeMax,
        'retained garments keep the actual environment within their relevant safe limit',
      );
      if (
        record.fullyNakedTick !== null &&
        (kind === 'hypothermia' ? temperature < bareSummary.safeMin : temperature > bareSummary.safeMax)
      )
        record.nakedExposurePawnTicks++;
      if (bare.health[kind] > 0 && record.firstConditionTick === null)
        record.firstConditionTick = naked.tick;
      if (bareSummary.consciousness < 1 && record.firstCapacityPenaltyTick === null)
        record.firstCapacityPenaltyTick = naked.tick;
    }
  }
  function stepPair() {
    clothed.step();
    naked.step();
    auditPair();
    if (clothed.tick % 120 === 0) reading('synchronized exposure');
    if (clothed.tick % 60 === 0) {
      auditInventory(clothed);
      auditInventory(naked);
    }
  }
  async function save(sim, name) {
    const bytes = JSON.stringify(sim.save());
    const file = `${OUT}/${kind}-${name}.json`;
    await writeFile(file, bytes);
    record.fixtures[name] = { file, sha256: sha256(bytes), tick: sim.tick };
    return JSON.parse(bytes);
  }

  assert.equal(initial.apparel, 6);
  assert(clothed.pawns.every((p) => p.worn.length === 2));
  for (const [branch, sim] of [['clothed', clothed], ['naked', naked]])
    for (const p of sim.pawns)
      for (const work of Object.keys(p.priorities))
        command(sim, branch, { type: 'priority', pawnId: p.id, work, value: 0 });
  check('independent fresh worlds match before public commands');
  reading('initial clothes in both worlds');
  // Start each garment layer together; advance BOTH worlds during every removal tick.
  for (const garment of ['shirt', 'pants']) {
    const removing = naked.pawns.map((p) => ({ pawnId: p.id, piece: p.worn.find((a) => a.kind === garment) }));
    for (const { pawnId, piece } of removing) {
      assert(piece);
      command(naked, 'naked', { type: 'removeApparel', pawnId, apparelId: piece.id });
    }
    const start = naked.tick;
    const done = () => removing.every(({ pawnId, piece }) =>
      !naked.pawns.find((p) => p.id === pawnId).worn.some((a) => a.id === piece.id));
    assert(!done(), 'removal is a timed task, not an instant state change');
    while (!done() && naked.tick - start < 200) stepPair();
    assert(done(), `normal ${garment} removal completes`);
    assert(naked.tick > start);
    for (const { piece } of removing)
      assert(naked.items.some((item) => item.apparel?.id === piece.id), 'removed identity is on the map');
    check(`three ${garment} identities removed through timed tasks`, { elapsed: naked.tick - start });
  }
  record.fullyNakedTick = naked.tick;
  assert(naked.pawns.every((p) => p.worn.length === 0));
  assert(clothed.pawns.every((p) => p.worn.length === 2));
  auditInventory(clothed);
  auditInventory(naked);
  reading('normal removal complete');

  while (clothed.tick < RELOAD_TICK) stepPair();
  const before = { clothed: snapshot(clothed), naked: snapshot(naked) };
  clothed = VoxelSimulation.load(await save(clothed, 'clothed-checkpoint'));
  naked = VoxelSimulation.load(await save(naked, 'naked-checkpoint'));
  assert.deepEqual(snapshot(clothed), before.clothed);
  assert.deepEqual(snapshot(naked), before.naked);
  check('unmodified save/load preserves health, needs, position and real worn identities in both worlds');
  while (clothed.tick < END_TICK) stepPair();
  auditInventory(clothed);
  auditInventory(naked);
  assert(record.nakedExposurePawnTicks > 0);
  assert(record.firstConditionTick !== null && record.firstCapacityPenaltyTick !== null);
  const threshold = kind === 'hypothermia' ? 0.2 : 0.04;
  for (const bare of naked.pawns) {
    const dressed = clothed.pawns.find((p) => p.id === bare.id);
    assert(bare.health[kind] >= threshold, 'naked colonist reaches a real health stage');
    assert.equal(dressed.health[kind], 0);
    assert(healthSummary(bare).consciousness < healthSummary(dressed).consciousness);
    assert(healthSummary(bare).moving < healthSummary(dressed).moving);
  }
  reading('final matched exposure');
  await save(clothed, 'clothed-final');
  await save(naked, 'naked-final');
  record.final = { clothed: snapshot(clothed), naked: snapshot(naked) };
  check('same-tick, same-temperature naked exposure causes a health stage and capacity penalty; clothing prevents it', {
    nakedSeverity: naked.pawns.map((p) => p.health[kind]),
    clothedSeverity: clothed.pawns.map((p) => p.health[kind]),
    firstConditionTick: record.firstConditionTick,
    firstCapacityPenaltyTick: record.firstCapacityPenaltyTick,
  });
  check('all six physical garment identities and resource accounting survive the entire comparison');
}

try {
  await pairedExposure('hypothermia', {
    biome: 'boreal', hilliness: 'flat', meanTemperature: 0, rainfall: 850, latitude: 0,
  });
  await pairedExposure('heatstroke', {
    biome: 'desert', hilliness: 'flat', meanTemperature: 33, rainfall: 0, latitude: 0,
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.errors.push(String(error.stack ?? error));
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
