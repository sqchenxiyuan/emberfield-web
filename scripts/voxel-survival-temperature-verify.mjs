import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_SURVIVAL_TEMPERATURE_OUT ?? 'test-results/voxel-survival-temperature';
const BASELINE =
  process.env.VOXEL_SURVIVAL_POWER_SAVE ?? 'test-results/voxel-power-campaign/final.json';
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
const bytes = await readFile(BASELINE),
  baseline = JSON.parse(bytes);
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Physical cooling/heating in facilities built by the normal power campaign, then fresh extreme-climate colonies without shelter. Public command/step/load/save and read-only temperature inspection. No injected health, needs, heat, fuel, resources or time. This establishes environmental consequences and recovery in selected conditions, not all-biome long-term balance.',
  baseline: {
    file: BASELINE,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    version: baseline.version,
    tick: baseline.tick,
  },
  branches: [],
  errors: [],
  status: 'running',
};
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
async function temperatureBranch(kind) {
  let sim = VoxelSimulation.load(baseline);
  const initial = sim.counts(),
    startConsumed = structuredClone(sim.stats.consumed),
    startProduced = structuredClone(sim.stats.produced),
    startSpoiled = structuredClone(sim.stats.spoiled);
  const record = { kind, commands: [], checks: [], readings: [] };
  report.branches.push(record);
  const patientId = sim.pawns[0].id,
    patient = () => sim.pawns.find((p) => p.id === patientId);
  const heater = sim.devices.find((d) => d.kind === 'heater'),
    cooler = sim.devices.find((d) => d.kind === 'cooler');
  const door = sim.doors.find((d) => d.x === 36 && d.y === 31 && d.z === 5);
  assert(heater && cooler && door, 'normal power campaign provides the constructed test rooms');
  const command = (c) => {
    const result = sim.command(c);
    record.commands.push({ tick: sim.tick, command: c, result });
    assert(result.ok, JSON.stringify({ c, result }));
  };
  const check = (name, detail = {}) => {
    record.checks.push({ name, tick: sim.tick, ...detail });
    console.log('PASS', kind, name, sim.tick);
  };
  function audit() {
    const counts = sim.counts();
    for (const r of Object.keys(initial))
      assert.equal(
        counts[r] +
          sim.stats.consumed[r] -
          startConsumed[r] +
          sim.stats.spoiled[r] -
          startSpoiled[r],
        initial[r] + sim.stats.produced[r] - startProduced[r],
        `${r} temperature branch conservation`,
      );
    assert(
      sim.pawns.every((p) => !p.dead),
      'controlled temperature exposure remains nonfatal',
    );
    if (sim.tick % 200 === 0)
      record.readings.push({
        tick: sim.tick,
        temperature: sim.temperature(patient()),
        food: patient().food,
        health: { ...patient().health },
      });
  }
  function until(name, fn, limit = 24000) {
    const start = sim.tick;
    while (!fn() && sim.tick - start < limit) {
      sim.step();
      if (sim.tick % 20 === 0) audit();
    }
    assert(
      fn(),
      `${name} timed out ${JSON.stringify({ tick: sim.tick, pawn: patient(), devices: sim.devices })}`,
    );
    audit();
    check(name, { elapsed: sim.tick - start, temperature: sim.temperature(patient()) });
  }
  for (const w of Object.keys(patient().priorities))
    command({ type: 'priority', pawnId: patientId, work: w, value: 0 });
  command({ type: 'device', deviceId: cooler.id, on: kind === 'hypothermia', target: -15 });
  command({ type: 'device', deviceId: heater.id, on: kind === 'heatstroke', target: 50 });
  command({ type: 'move', pawnId: patientId, target: { x: 35, y: 30, z: 5 } });
  until('colonist walks into the actual controlled room', () =>
    same(patient(), { x: 35, y: 30, z: 5 }),
  );
  until(
    'doorway is free to close',
    () => !sim.pawns.some((p) => same(p, door)) && !sim.items.some((p) => same(p, door)),
  );
  command({ type: 'door', doorId: door.id, mode: 'locked' });
  until(
    'powered equipment causes a measurable health condition',
    () => patient().health[kind] >= 0.21,
    24000,
  );
  assert(kind === 'hypothermia' ? sim.temperature(patient()) < 6 : sim.temperature(patient()) > 36);
  await writeFile(`${OUT}/${kind}-exposed.json`, JSON.stringify(sim.save()));
  const exposed = patient().health[kind];
  command({ type: 'device', deviceId: heater.id, on: true, target: 21 });
  command({ type: 'device', deviceId: cooler.id, on: true, target: 21 });
  until(
    'normal room control reaches recovery temperature',
    () => sim.temperature(patient()) > 16 && sim.temperature(patient()) < 26,
  );
  until(
    'corrected environment naturally removes the condition',
    () => patient().health[kind] === 0,
    12000,
  );
  assert(exposed > 0.2);
  command({ type: 'door', doorId: door.id, mode: 'auto' });
  command({ type: 'move', pawnId: patientId, target: { x: 33, y: 32, z: 8 } });
  until('recovered colonist leaves the room by the actual ladder', () => patient().z === 8);
  await writeFile(`${OUT}/${kind}-recovered.json`, JSON.stringify(sim.save()));
}
async function untreated(kind, settings) {
  let sim = new VoxelSimulation(73129, settings);
  const record = { kind: `untreated-${kind}`, settings: sim.settings, checks: [] };
  report.branches.push(record);
  const initial = sim.counts();
  let collapseTick = null;
  while (!sim.pawns.every((p) => p.dead) && sim.tick < 4 * 12000) {
    sim.step();
    if (collapseTick === null && sim.pawns.some((p) => p.downed)) collapseTick = sim.tick;
  }
  assert(
    collapseTick !== null && sim.pawns.every((p) => p.dead),
    `extreme ${kind} has real consequences`,
  );
  assert(sim.pawns.every((p) => p.health[kind] === 1));
  const final = sim.save();
  await writeFile(`${OUT}/${kind}-fatal.json`, JSON.stringify(final));
  const deceased = final.pawns.map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
    z: p.z,
    deathReason: p.deathReason,
    health: p.health,
    cargo: p.cargo,
  }));
  sim = VoxelSimulation.load(final);
  const refused = sim.command({ type: 'move', pawnId: sim.pawns[0].id, target: sim.spawn });
  assert.equal(refused.ok, false);
  sim.step(1200);
  assert(sim.pawns.every((p) => p.dead && p.phase === 'dead'));
  assert.deepEqual(
    sim.pawns.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      z: p.z,
      deathReason: p.deathReason,
      health: p.health,
      cargo: p.cargo,
    })),
    deceased,
  );
  const counts = sim.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r],
      initial[r] + sim.stats.produced[r],
    );
  record.checks.push({
    name: 'natural exposure causes collapse then death',
    collapseTick,
    deathTick: final.tick,
    deceased,
  });
  record.checks.push({
    name: 'save-load preserves death, bodies and cargo; movement rejected',
    tick: sim.tick,
  });
  console.log(
    'PASS',
    kind,
    'untreated collapse/death and permanent saved consequences',
    final.tick,
  );
}
try {
  await temperatureBranch('hypothermia');
  await temperatureBranch('heatstroke');
  await untreated('hypothermia', {
    biome: 'boreal',
    hilliness: 'flat',
    meanTemperature: -30,
    rainfall: 850,
    latitude: 0,
  });
  await untreated('heatstroke', {
    biome: 'desert',
    hilliness: 'flat',
    meanTemperature: 45,
    rainfall: 0,
    latitude: 0,
  });
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  throw e;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
