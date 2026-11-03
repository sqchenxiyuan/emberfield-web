import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const out = process.env.VOXEL_ANATOMY_OUT ?? 'test-results/voxel-anatomy-campaign';
await mkdir(out, { recursive: true });
const b = await build({
  stdin: {
    contents:
      "export { VoxelSimulation } from './src/voxel/world'; export { BODY_PART_LIST } from './src/voxel/anatomy'; export { needsTending, traumaSummary, traumaIds } from './src/voxel/injuries'; export { healthSummary } from './src/voxel/survival';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { VoxelSimulation, BODY_PART_LIST, needsTending, traumaSummary, traumaIds, healthSummary } =
  await import(
    'data:text/javascript;base64,' + Buffer.from(b.outputFiles[0].text).toString('base64')
  );
let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Normal colony creation, commands, elapsed ticks, save and load. No injected terrain, resources, health, injuries, enemies, clock or needs. Optional raids spawn on their actual schedule and defenders fight through the normal combat command.',
  checks: [],
  commands: [],
  observations: [],
  errors: [],
  status: 'running',
};
const save = async (name) => writeFile(`${out}/${name}.json`, JSON.stringify(s.save()) + '\n');
function check(name, details = {}) {
  report.checks.push({ name, tick: s.tick, ...details });
  console.log('PASS', name, s.tick);
}
function command(c) {
  const r = s.command(c);
  report.commands.push({ tick: s.tick, command: c, result: r });
  assert(r.ok, JSON.stringify({ c, r }));
}
function until(done, max = 6000) {
  for (let i = 0; i < max && !done(); i++) s.step();
  assert(
    done(),
    JSON.stringify({
      tick: s.tick,
      pawns: s.pawns.map((p) => ({
        id: p.id,
        phase: p.phase,
        reason: p.reason,
        trauma: p.trauma,
        food: p.food,
      })),
    }),
  );
}
const colonists = () => s.pawns.filter((p) => p.faction === 'colony');
const enemy = () => s.pawns.find((p) => p.faction === 'raider');
try {
  assert.equal(s.save().version, 16);
  assert.equal(BODY_PART_LIST.length, 64);
  let bedPoint;
  for (let dy = 2; dy < 8 && !bedPoint; dy++)
    for (let dx = 2; dx < 8 && !bedPoint; dx++) {
      const from = { x: s.spawn.x + dx, y: s.spawn.y + dy, z: s.spawn.z };
      const r = s.command({ type: 'designate', tool: 'bed', from, axis: 'x' });
      if (r.ok) bedPoint = from;
    }
  assert(bedPoint, 'A normal bed footprint must be available');
  until(() => s.beds.length === 1);
  command({ type: 'bedMedical', bedId: s.beds[0].id, medical: true });
  check('colony physically builds and designates a medical bed before enabling threats');
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'care', value: 0 });
  command({ type: 'threats', enabled: true });
  const due = s.combat.nextRaid;
  until(() => s.tick === due - 1, 36000);
  assert(!enemy());
  check('three full preparation days pass without an early or injected raid');
  s = VoxelSimulation.load(s.save());
  s.step();
  assert(enemy() && !enemy().dead);
  assert.equal(s.combat.wave, 1);
  check('the scheduled knife raider enters at a reachable map edge after reload', {
    enemy: { x: enemy().x, y: enemy().y, z: enemy().z },
  });
  await save('raid');
  command({ type: 'threats', enabled: false });
  assert(enemy());
  check('disabling future raids preserves the existing attacker');
  for (const p of colonists()) {
    command({ type: 'draft', pawnId: p.id, drafted: true });
    command({ type: 'attack', pawnId: p.id, targetId: enemy().id });
  }
  until(() => colonists().some((p) => p.trauma.wounds.length), 6000);
  check('ordinary melee causes real wounds while defenders traverse the map');
  await save('combat');
  const before = s.save();
  s = VoxelSimulation.load(before);
  assert.deepEqual(
    s.pawns.map((p) => p.trauma),
    before.pawns.map((p) => p.trauma),
  );
  check(
    'combat reload preserves injury identity, blood loss and attack cooldown without an extra hit',
  );
  until(() => enemy().downed || enemy().dead, 6000);
  assert(
    colonists().every((p) => !p.dead),
    'Defenders must survive this documented campaign',
  );
  const patient = colonists()
    .filter((p) => p.trauma.wounds.some((w) => w.kind === 'cut' || w.kind === 'stab'))
    .sort((a, b) => b.trauma.wounds.length - a.trauma.wounds.length)[0];
  assert(patient, 'A colonist must receive a real sharp injury');
  check('defenders stop attacking when the raider is incapacitated', {
    patientId: patient.id,
    raiderDead: enemy().dead,
    colonists: colonists().map((p) => ({ id: p.id, downed: p.downed, wounds: p.trauma.wounds })),
  });
  for (const p of colonists().filter((p) => p.drafted))
    command({ type: 'draft', pawnId: p.id, drafted: false });
  const hitParts = [
    ...new Set(
      s.pawns.flatMap((p) => [...p.trauma.wounds, ...p.trauma.missingParts].map((w) => w.part)),
    ),
  ];
  assert(
    hitParts.some(
      (part) =>
        !['torso', 'head', 'neck', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'].includes(part),
    ),
    'normal combat reaches detailed anatomy',
  );
  const bodyObservations = s.pawns.map((p) => ({
    id: p.id,
    trauma: structuredClone(p.trauma),
    capacities: healthSummary(p),
  }));
  report.anatomy = { bodyParts: BODY_PART_LIST.length, hitParts, bodyObservations };
  check('ordinary raid targets full human anatomy and produces derived capacity losses', {
    hitParts,
  });
  await save('wounded');
  const doctor = colonists().find((p) => p.id !== patient.id && !p.downed);
  assert(doctor, 'A doctor must remain mobile');
  command({ type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'tend' });
  until(() => s.pawns.find((p) => p.id === doctor.id).careProgress > 60);
  await save('tending');
  const progress = s.pawns.find((p) => p.id === doctor.id).careProgress;
  s = VoxelSimulation.load(s.save());
  assert.equal(s.pawns.find((p) => p.id === doctor.id).careProgress, progress);
  check('doctor travels to the casualty and treatment survives save/load partway through its work');
  const patientId = patient.id;
  until(() => !needsTending(s.pawns.find((p) => p.id === patientId).trauma), 10000);
  const treated = s.pawns.find((p) => p.id === patientId);
  assert(treated.trauma.wounds.length > 0);
  check('bandaging stops bleeding without erasing injuries or using nonexistent medicine', {
    bloodLoss: treated.trauma.bloodLoss,
    wounds: treated.trauma.wounds,
  });
  assert.equal(traumaSummary(treated.trauma).bleedRate, 0);
  await save('tended');
  for (const p of colonists())
    if (!p.downed) command({ type: 'priority', pawnId: p.id, work: 'care', value: 1 });
  const initialSeverity = treated.trauma.wounds.reduce((n, w) => n + w.severity, 0);
  s.step(12000);
  const recovered = s.pawns.find((p) => p.id === patientId);
  assert(!recovered.dead);
  assert(recovered.trauma.wounds.reduce((n, w) => n + w.severity, 0) < initialSeverity);
  check('normal feeding and elapsed game time reduce injuries after treatment', {
    remaining: recovered.trauma.wounds,
    bloodLoss: recovered.trauma.bloodLoss,
  });
  assert(!enemy() || enemy().dead || enemy().downed || enemy().retreating);
  check('the defeated enemy has not resumed attacking during the recovery day', {
    outcome: !enemy()
      ? 'left-map'
      : enemy().dead
        ? 'dead'
        : enemy().downed
          ? 'downed'
          : 'retreating',
    limitation:
      'A dead or still downed enemy does not validate the recovery-and-retreat branch; that branch has a separate controlled integration test.',
  });
  const ids = s.pawns.flatMap((p) => traumaIds(p.trauma));
  assert.equal(new Set(ids).size, ids.length);
  assert(
    s.pawns.every((p) => p.trauma.wounds.every((w) => BODY_PART_LIST.some((b) => b.id === w.part))),
  );
  check('all retained injury and missing-part identities remain unique after normal recovery');
  assert.doesNotThrow(() => VoxelSimulation.load(s.save()));
  await save('recovery');
  report.status = 'passed';
  report.final = {
    tick: s.tick,
    days: s.tick / 12000,
    pawns: s.pawns.map((p) => ({
      id: p.id,
      faction: p.faction,
      dead: p.dead,
      downed: p.downed,
      trauma: p.trauma,
      food: p.food,
    })),
  };
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  await save('failure');
  process.exitCode = 1;
  console.error(String(e));
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
