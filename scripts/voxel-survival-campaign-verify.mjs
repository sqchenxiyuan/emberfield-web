import { loadLegacyStart, LEGACY_START } from './voxel-legacy-start.mjs';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_SURVIVAL_OUT ?? 'test-results/voxel-survival-campaign';
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
let sim = await loadLegacyStart(VoxelSimulation);
const initial = sim.counts();
const report = {
  startedAt: new Date().toISOString(),
  baseline: LEGACY_START,
  scope:
    'Public commands, elapsed-calendar step and normal save/load only. A genuinely published colony builds an underground isolation room and upstairs medical bed. A locked door prevents one colonist from reaching food; after natural collapse, unlocking permits real cross-level rescue and feeding. No health, terrain, food, need, temperature or clock injection. Temperature consequences are verified by the separate temperature campaign.',
  commands: [],
  checks: [],
  fixtures: {},
  observations: [],
  errors: [],
  status: 'running',
};
const point = (p) => ({ x: p.x, y: p.y, z: p.z });
const p = (x, y, z = 8) => ({ x, y, z });
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const check = (name, details = {}) => {
  report.checks.push({ name, tick: sim.tick, ...details });
  console.log('PASS', name, sim.tick);
};
const command = (c) => {
  const result = sim.command(c);
  report.commands.push({ tick: sim.tick, command: c, result });
  assert(result.ok, JSON.stringify({ c, result }));
  return result;
};
const place = (tool, from, to, axis) => command({ type: 'designate', tool, from, to, axis });
const id = sim.pawns[0].id;
const patient = () => sim.pawns.find((v) => v.id === id);
const carriedLayers = new Set();
let lastCare = '';
function audit() {
  const counts = sim.counts();
  for (const resource of Object.keys(initial))
    assert.equal(
      counts[resource] + sim.stats.consumed[resource] + sim.stats.spoiled[resource],
      initial[resource] + sim.stats.produced[resource],
      `${resource} conserved at ${sim.tick}`,
    );
  const currentCare = sim.pawns
    .map((v) => `${v.id}:${v.carePhase}:${v.sleepBedId}:${v.downed}:${v.dead}`)
    .join('|');
  if (currentCare !== lastCare) {
    report.observations.push({
      tick: sim.tick,
      pawns: sim.pawns.map((v) => ({
        id: v.id,
        ...point(v),
        phase: v.phase,
        carePhase: v.carePhase,
        carriedBy: v.carriedBy,
        carryingPawnId: v.carryingPawnId,
        sleepBedId: v.sleepBedId,
        food: v.food,
        health: { ...v.health },
        downed: v.downed,
        dead: v.dead,
      })),
    });
    lastCare = currentCare;
  }
  for (const actor of sim.pawns) {
    assert(sim.standable(actor), `supported actor ${actor.id}`);
    if (actor.carriedBy !== null) {
      const carrier = sim.pawns.find((v) => v.id === actor.carriedBy);
      assert(carrier && carrier.carryingPawnId === actor.id);
      assert(same(actor, carrier), 'patient follows carrier through actual cells');
      carriedLayers.add(actor.z);
    }
  }
}
function until(name, predicate, limit = 24000) {
  const start = sim.tick;
  while (!predicate() && sim.tick - start < limit) {
    sim.step();
    if (sim.tick % 10 === 0) audit();
  }
  assert(
    predicate(),
    `${name} timed out: ${JSON.stringify({ tick: sim.tick, pawns: sim.pawns, jobs: sim.jobs })}`,
  );
  audit();
  check(name, { elapsed: sim.tick - start });
}
async function save(name) {
  const bytes = JSON.stringify(sim.save());
  const file = `${OUT}/${name}.json`;
  await writeFile(file, bytes);
  report.fixtures[name] = {
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    tick: sim.tick,
  };
  return JSON.parse(bytes);
}
try {
  place('stock', p(28, 32), p(31, 36));
  for (const [x, y] of [
    [27, 29],
    [28, 27],
    [36, 28],
    [38, 31],
    [36, 37],
    [27, 36],
  ])
    place('cut', p(x, y));
  until(
    'trees physically supply wood for treatment facilities',
    () => sim.stats.cut === 6 && !sim.jobs.length,
  );
  place('shaft', p(33, 32));
  until('real excavation opens the lower level', () => !sim.jobs.length);
  place('mine', p(34, 32, 5));
  until('a narrow entrance is excavated', () => !sim.jobs.length);
  place('mine', p(35, 31, 5), p(36, 33, 5));
  until('underground isolation room is excavated', () => !sim.jobs.length);
  place('door', p(34, 32, 5), undefined, 'y');
  place('up', p(31, 30));
  until('door and upper ladder are completed', () => !sim.jobs.length);
  place('floor', p(32, 29, 11), p(35, 31, 11));
  until('upstairs treatment platform is built', () => !sim.jobs.length);
  place('bed', p(33, 30, 11), undefined, 'y');
  until(
    'a real upper-level wooden bed is completed',
    () => sim.beds.length === 1 && !sim.jobs.length,
  );
  const bedId = sim.beds[0].id;
  const doorId = sim.doors[0].id;
  command({ type: 'bedMedical', bedId, medical: true });
  for (const w of Object.keys(patient().priorities))
    command({ type: 'priority', pawnId: id, work: w, value: 0 });
  command({ type: 'move', pawnId: id, target: p(36, 32, 5) });
  until('one colonist voluntarily enters the room', () => same(patient(), p(36, 32, 5)));
  for (const actor of sim.pawns.filter((v) => v.id !== id))
    command({ type: 'move', pawnId: actor.id, target: p(30, 30) });
  until(
    'helpers and hauled items clear the sole doorway',
    () =>
      sim.pawns.filter((v) => v.id !== id).every((v) => v.z === 8) &&
      !sim.items.some((v) => same(v, sim.doors[0])),
  );
  command({ type: 'door', doorId, mode: 'locked' });
  assert.equal(sim.path(patient(), p(33, 32, 8)), null);
  await save('isolated');
  until(
    'inaccessible food leads to actual starvation',
    () => patient().food === 0 && patient().health.malnutrition > 0,
    4 * 12000,
  );
  until('malnutrition naturally causes collapse', () => patient().downed, 3 * 12000);
  assert(!patient().dead);
  assert(sim.pawns.filter((v) => v.id !== id).every((v) => !v.downed && !v.dead));
  const collapsed = await save('collapsed');
  const rejection = sim.command({ type: 'move', pawnId: id, target: p(33, 32, 8) });
  assert.equal(rejection.ok, false);
  sim = VoxelSimulation.load(collapsed);
  assert.deepEqual(patient().health, collapsed.pawns.find((v) => v.id === id).health);
  assert(patient().downed);
  check('collapsed save persists disease and refuses self-directed walking');
  command({ type: 'door', doorId, mode: 'auto' });
  await save('rescue-ready');
  until(
    'helper reaches the patient and physically picks them up',
    () => patient().carriedBy !== null,
  );
  const inTransit = await save('carrying');
  sim = VoxelSimulation.load(inTransit);
  assert(patient().carriedBy !== null, 'in-transit save retains carried patient');
  audit();
  check('in-transit load retains both sides of the rescue relationship');
  until(
    'patient is carried up both ladders into the medical bed',
    () => patient().sleepBedId === bedId && patient().carriedBy === null,
  );
  assert.equal(patient().z, 11);
  assert(carriedLayers.has(5) && carriedLayers.has(8) && carriedLayers.has(11));
  await save('bed-patient');
  const consumedBefore = sim.stats.consumed.food;
  until('helper collects real food and performs feeding work', () =>
    sim.pawns.some((v) => v.patientId === id && v.carePhase === 'feed'),
  );
  const feeding = await save('feeding');
  sim = VoxelSimulation.load(feeding);
  assert(sim.pawns.some((v) => v.patientId === id && v.carePhase === 'feed'));
  const severityBefore = patient().health.malnutrition;
  until('feeding consumes one real ration and restores nutrition', () => patient().food > 0);
  assert(sim.stats.consumed.food > consumedBefore);
  assert(patient().health.malnutrition > 0.7, 'feeding does not erase malnutrition');
  await save('fed');
  until('normal health progression restores the ability to stand', () => !patient().downed, 12000);
  assert(patient().health.malnutrition < severityBefore);
  until(
    'sustained access to food removes malnutrition',
    () => patient().health.malnutrition === 0,
    3 * 12000,
  );
  assert(sim.pawns.every((v) => !v.dead && !v.downed));
  check('entire colony survives the rescue without injected resources', {
    carriedLayers: [...carriedLayers],
    consumedFood: sim.stats.consumed.food,
  });
  await save('recovered');
  report.final = {
    tick: sim.tick,
    counts: sim.counts(),
    stats: sim.stats,
    pawns: sim.pawns.map((v) => ({ id: v.id, food: v.food, health: v.health })),
  };
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  await save('failed-state');
  throw e;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
