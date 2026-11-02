import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const OUT = process.env.VOXEL_HOUSING_CAMPAIGN_OUT ?? 'test-results/voxel-housing-campaign';
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
let sim = new VoxelSimulation(73129);
const initial = sim.counts(),
  report = {
    scope:
      'Normal command/step/save/load only; no world, resource, need or time injection. Headless elapsed calendar simulation, not real-time native play.',
    commands: [],
    checkpoints: [],
    sleepEvents: [],
    doorEvents: [],
    minimumFood: 100,
    errors: [],
  };
const p = (x, y, z = 8) => ({ x, y, z }),
  same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
let lastPhases = new Map(),
  opened = false;
function audit() {
  const counts = sim.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r],
      initial[r] + sim.stats.produced[r],
      `${r} ledger at ${sim.tick}`,
    );
  for (const pawn of sim.pawns) {
    assert.ok(sim.standable(pawn), 'supported pawn');
    report.minimumFood = Math.min(report.minimumFood, pawn.food);
    if (pawn.phase === 'rest' && lastPhases.get(pawn.id) !== 'rest')
      report.sleepEvents.push({
        tick: sim.tick,
        pawnId: pawn.id,
        bedId: pawn.sleepBedId,
        rest: pawn.rest,
        position: p(pawn.x, pawn.y, pawn.z),
      });
    lastPhases.set(pawn.id, pawn.phase);
  }
  const sleepers = sim.pawns.filter((p) => p.sleepBedId !== null).map((p) => p.sleepBedId);
  assert.equal(new Set(sleepers).size, sleepers.length, 'exclusive beds');
  const d = sim.doors[0];
  const open = d && d.openUntil >= sim.tick;
  if (open && !opened) report.doorEvents.push({ tick: sim.tick, door: d.id });
  opened = open;
}
function until(label, predicate, limit = 24000) {
  const start = sim.tick;
  while (!predicate() && sim.tick - start < limit) {
    sim.step();
    audit();
  }
  assert.ok(
    predicate(),
    `${label}: ${JSON.stringify({ tick: sim.tick, pawns: sim.pawns, jobs: sim.jobs })}`,
  );
  report.checkpoints.push({ label, tick: sim.tick, elapsed: sim.tick - start });
  console.log('PASS', label, sim.tick);
}
function command(c) {
  const r = sim.command(c);
  report.commands.push({ tick: sim.tick, command: c, result: r });
  assert.ok(r.ok, JSON.stringify({ c, r }));
  return r;
}
const place = (tool, from, to, axis) => command({ type: 'designate', tool, from, to, axis });
async function save(name) {
  await writeFile(`${OUT}/${name}.json`, JSON.stringify(sim.save()));
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
    'six trees supply physical construction wood',
    () => sim.stats.cut === 6 && !sim.jobs.length,
  );
  place('shaft', p(33, 32));
  until('excavated shaft connects surface and underground', () => !sim.jobs.length);
  place('mine', p(34, 32, 5));
  until('underground entrance excavated', () => !sim.jobs.length);
  place('mine', p(35, 31, 5), p(36, 33, 5));
  until('six-cell underground bedroom excavated', () => !sim.jobs.length);
  place('bed', p(35, 31, 5), undefined, 'x');
  place('door', p(34, 32, 5), undefined, 'y');
  until(
    'underground bed and doorway built from delivered wood',
    () => sim.beds.length === 1 && sim.doors.length === 1 && !sim.jobs.length,
  );
  const underground = sim.beds[0];
  const door = sim.doors[0];
  sim.updateRooms();
  const room = sim.rooms.roomAt(underground);
  assert.ok(room && !room.outdoor);
  assert.equal(room.volume, 12);
  const closedRoom = structuredClone(room);
  command({ type: 'door', doorId: door.id, mode: 'open' });
  sim.updateRooms();
  assert.deepEqual(sim.rooms.roomAt(underground), closedRoom, 'open door preserves room');
  command({ type: 'door', doorId: door.id, mode: 'auto' });
  place('up', p(31, 30));
  until('upper ladder completed', () => !sim.jobs.length);
  place('floor', p(32, 29, 11), p(35, 31, 11));
  until('upper platform completed', () => !sim.jobs.length);
  place('bed', p(33, 30, 11), undefined, 'y');
  place('bed', p(29, 29), undefined, 'y');
  until(
    'three beds exist on underground surface and upstairs',
    () => sim.beds.length === 3 && !sim.jobs.length,
  );
  const upper = sim.beds.find((b) => b.z === 11),
    ground = sim.beds.find((b) => b.z === 8);
  for (const [i, b] of [underground, upper, ground].entries())
    command({ type: 'bedOwner', bedId: b.id, pawnId: sim.pawns[i].id });
  await save('housing-built');
  until('natural default bedtime sends all three pawns into their owned beds', () =>
    sim.pawns.every((p) => p.phase === 'rest' && p.sleepBedId !== null),
  );
  assert.ok(sim.pawns.some((p) => p.z === 5) && sim.pawns.some((p) => p.z === 11));
  await save('sleeping-save');
  const before = sim.save(),
    counts = sim.counts();
  sim = VoxelSimulation.load(before);
  assert.deepEqual(sim.counts(), counts);
  assert.ok(sim.pawns.every((p) => p.phase === 'rest'));
  assert.deepEqual(
    sim.pawns.map((p) => p.sleepBedId),
    before.pawns.map((p) => p.sleepBedId),
  );
  const needs = sim.pawns.map((p) => p.rest);
  sim.step(20);
  audit();
  assert.ok(sim.pawns.every((p, i) => p.rest > needs[i]));
  until(
    'all colonists naturally wake from restored rest',
    () => sim.pawns.every((p) => p.phase !== 'rest' && p.phase !== 'sleepTravel'),
    12000,
  );
  assert.ok(sim.pawns.every((p) => p.rest > 95));
  const pawn = sim.pawns[0];
  command({ type: 'move', pawnId: pawn.id, target: p(33, 32, 8) });
  until('underground sleeper exits via door and shaft', () => same(sim.pawns[0], p(33, 32, 8)));
  // Move other inhabitants clear before locking; command rejects occupied doors instead of trapping them.
  until(
    'doorway is clear',
    () => !sim.pawns.some((p) => same(p, door)) && !sim.items.some((p) => same(p, door)),
  );
  command({ type: 'door', doorId: door.id, mode: 'locked' });
  assert.equal(sim.path(pawn, underground), null, 'locked door blocks sole entrance');
  command({ type: 'door', doorId: door.id, mode: 'auto' });
  assert.ok(sim.path(pawn, underground));
  assert.ok(report.doorEvents.length > 0);
  sim.updateRooms();
  assert.equal(sim.rooms.roomAt(underground)?.outdoor,false);
  assert.equal(sim.rooms.roomAt(upper)?.outdoor,true);
  report.rooms = {
    underground: sim.rooms.roomAt(underground),
    upstairs: sim.rooms.roomAt(upper),
    bytes: sim.rooms.memoryBytes,
  };
  report.final = {
    tick: sim.tick,
    beds: sim.beds,
    doors: sim.doors,
    counts: sim.counts(),
    stats: sim.stats,
    pawns: sim.pawns.map((p) => ({ id: p.id, rest: p.rest, food: p.food })),
  };
  report.status = 'passed';
  await save('final');
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  await save('failed-state');
  throw e;
} finally {
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
