import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_MEDICINE_OUT ?? 'test-results/voxel-medicine-exploratory';
const formal = process.env.VOXEL_MEDICINE_FINAL === '1';
const resume = process.env.VOXEL_MEDICINE_RESUME;
assert(!formal || !resume, 'Final evidence must start from a fresh new colony');
const DAY = 12000;
const sha = (v) => createHash('sha256').update(v).digest('hex');
await mkdir(OUT, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      "export { VoxelSimulation } from './src/voxel/world.ts'; export { needsMedicalTending } from './src/voxel/medicine.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const executedBytes = Buffer.from(bundle.outputFiles[0].text);
const execution = {
  bundle: `${OUT}/executed-world${resume ? '-resumed' : ''}.mjs`,
  script: `${OUT}/executed-campaign${resume ? '-resumed' : ''}.mjs`,
  sha256: sha(executedBytes),
  scriptSha256: sha(await readFile(new URL(import.meta.url))),
};
await writeFile(execution.bundle, executedBytes, { flag: 'wx' });
await writeFile(execution.script, await readFile(new URL(import.meta.url)), { flag: 'wx' });
const { VoxelSimulation, needsMedicalTending } = await import(
  'data:text/javascript;base64,' + executedBytes.toString('base64')
);
let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
const point = ({ x, y, z }) => ({ x, y, z });
const key = (p) => `${p.x}/${p.y}/${p.z}`;
const at = (p) => (p.z * 64 + p.y) * 64 + p.x;
const same = (a, b) => key(a) === key(b);
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const colonists = () => s.pawns.filter((p) => p.faction === 'colony');
const person = (id) => s.pawns.find((p) => p.id === id);
let branch = 'opening';
const ledger = () =>
  Object.fromEntries(
    Object.entries(s.counts()).map(([r, n]) => [
      r,
      n + s.stats.consumed[r] + s.stats.spoiled[r] + s.stats.destroyed[r] - s.stats.produced[r],
    ]),
  );
let report = {
  status: 'running',
  startedAt: new Date().toISOString(),
  formal,
  scope:
    'Fresh seed 73129. Only construction, work, farming, storage, medical, movement and combat commands, step, save and load change the simulation. Terrain, paths and state are read to plan. No injected items, resources, injuries, skills, knowledge, infection timers, clock, random state, temperatures or enemies. Delayed untreated, no-medicine and herbal-care branches explicitly reload recorded ordinary-play saves. Natural noninfection and deaths are retained, not rerolled. This is a gameplay case study, not an infection-probability experiment.',
  execution,
  commands: [],
  checks: [],
  fixtures: {},
  branches: [],
  externalTransfers: [],
  carriedLayers: {},
  samples: [],
  battles: [],
  errors: [],
  coverage: {
    herbs: false,
    coldStore: false,
    fetch: false,
    tend: false,
    naturalInfection: false,
    bedRest: false,
    recovery: false,
  },
};
function beginBranch(name, origin = null) {
  branch = name;
  report.branches.push({ name, startTick: s.tick, origin, initialLedger: ledger() });
}
beginBranch(branch);
if (resume) {
  assert.equal(resume, 'prepared');
  report = JSON.parse(await readFile(`${OUT}/report.json`, 'utf8'));
  const bytes = await readFile(`${OUT}/prepared.json`);
  assert.equal(sha(bytes), report.fixtures.prepared.sha256);
  s = VoxelSimulation.load(JSON.parse(bytes));
  report.resume = {
    checkpoint: report.fixtures.prepared,
    previousExecution: report.execution,
    at: new Date().toISOString(),
  };
  report.execution = execution;
  report.formal = false;
  report.errors = [];
  report.status = 'running';
  beginBranch('development-resume', report.fixtures.prepared);
}
function command(c) {
  const result = s.command(c);
  report.commands.push({ branch, tick: s.tick, command: c, result });
  assert(result.ok, JSON.stringify({ c, result }));
  return result;
}
const place = (tool, p, extra = {}) =>
  command({ type: 'designate', tool, from: point(p), ...extra });
function check(name, detail = {}) {
  report.checks.push({ branch, tick: s.tick, name, ...detail });
  console.log('PASS', branch, s.tick, name);
}
function audit() {
  const baseline = report.branches.findLast((b) => b.name === branch).initialLedger;
  for (const [r, n] of Object.entries(ledger())) {
    const transfers = report.externalTransfers
      .filter((t) => t.branch === branch && t.resource === r)
      .reduce((a, b) => a + b.amount, 0);
    assert.equal(n, baseline[r] + transfers, `${branch}: ${r} conservation at ${s.tick}`);
  }
  assert(
    s.items.every((i) => i.amount > 0),
    'positive physical stacks',
  );
}
function step() {
  const before = s.pawns
    .filter((p) => p.faction === 'raider')
    .map((p) => ({ id: p.id, weapon: p.weapon ? structuredClone(p.weapon) : null }));
  s.step();
  for (const p of s.pawns.filter((p) => p.faction === 'raider')) {
    if (!before.some((q) => q.id === p.id) && p.weapon)
      report.externalTransfers.push({
        branch,
        tick: s.tick,
        pawnId: p.id,
        resource: 'weapon',
        amount: 1,
        itemId: p.weapon.id,
        reason: 'normally scheduled raider enters carrying weapon',
      });
  }
  for (const p of before)
    if (!person(p.id) && p.weapon)
      report.externalTransfers.push({
        branch,
        tick: s.tick,
        pawnId: p.id,
        resource: 'weapon',
        amount: -1,
        itemId: p.weapon.id,
        reason: 'raider retreats carrying weapon',
      });
  for (const p of s.pawns)
    if (p.cargo) {
      const name = `${branch}:${p.cargo.resource}@${p.z}`;
      report.carriedLayers[name] = (report.carriedLayers[name] ?? 0) + 1;
    }
  if (s.tick % 100 === 0) audit();
}
function diagnostics() {
  return {
    tick: s.tick,
    counts: s.counts(),
    jobs: s.jobs.filter((j) => !['sow', 'harvest', 'cook', 'haul'].includes(j.kind)),
    people: colonists().map((p) => ({
      id: p.id,
      position: point(p),
      phase: p.phase,
      reason: p.reason,
      food: p.food,
      dead: p.dead,
      medical: p.medical,
    })),
    devices: s.devices,
  };
}
function until(name, done, max = DAY * 6) {
  const start = s.tick;
  while (!done() && s.tick - start < max) step();
  assert(done(), JSON.stringify({ name, ...diagnostics() }));
  audit();
  check(name, { elapsed: s.tick - start });
}
async function save(name) {
  const data = s.save(),
    bytes = JSON.stringify(data) + '\n',
    file = `${OUT}/${name}.json`;
  await writeFile(file, bytes, { flag: 'wx' });
  report.fixtures[name] = { file, branch, tick: s.tick, version: data.version, sha256: sha(bytes) };
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n');
  return data;
}
async function loadBranch(name, fixture) {
  const record = report.fixtures[fixture],
    bytes = await readFile(record.file);
  assert.equal(sha(bytes), record.sha256);
  s = VoxelSimulation.load(JSON.parse(bytes));
  beginBranch(name, { fixture, ...record });
}
function occupied(p) {
  return (
    !!s.ladders[at(p)] ||
    [s.farms, s.stockpiles, s.items, s.jobs, s.trees, s.beds, s.stoves, s.devices, s.doors].some(
      (list) => list.some((q) => same(q, p)),
    )
  );
}
function surface() {
  const out = [];
  for (let y = 3; y < 60; y++)
    for (let x = 3; x < 60; x++) {
      let z = 14;
      while (z > 0 && !s.blocks[at({ x, y, z })]) z--;
      const p = { x, y, z: z + 1 };
      if (s.standable(p) && !occupied(p)) out.push(p);
    }
  return out.sort((a, b) => dist(a, s.spawn) - dist(b, s.spawn));
}
const reachable = (p) => s.standable(p) && s.path(s.pawns[0], p) !== null;
function forestry(target) {
  let rounds = 0;
  while (s.counts().wood < target && rounds++ < 16) {
    const trees = s.trees
      .filter(
        (t) =>
          t.growth >= 0.8 &&
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dy]) => reachable({ ...t, x: t.x + dx, y: t.y + dy })),
      )
      .sort((a, b) => dist(a, s.spawn) - dist(b, s.spawn))
      .slice(0, 12);
    assert(trees.length, 'mature reachable timber');
    for (const t of trees) place('cut', t);
    until(
      'mature trees supply actual timber and fuel',
      () => !s.jobs.some((j) => j.kind === 'cut'),
    );
  }
  assert(s.counts().wood >= target);
}
function constructionDone(name, kinds) {
  until(name, () => !s.jobs.some((j) => kinds.includes(j.kind)));
}
function mineTo(resource, block, target) {
  const shaft = report.layout.shaft,
    z = shaft.z - 3;
  const ores = [];
  for (let y = 3; y < 61; y++)
    for (let x = 3; x < 61; x++)
      if (s.blocks[at({ x, y, z })] === block || s.blocks[at({ x, y, z: z + 1 })] === block)
        ores.push({ x, y, z });
  ores.sort((a, b) => dist(a, { ...shaft, z }) - dist(b, { ...shaft, z }));
  for (const ore of ores) {
    if (s.counts()[resource] >= target) break;
    const line = [];
    for (let x = shaft.x; x !== ore.x; x += Math.sign(ore.x - shaft.x))
      line.push({ x, y: shaft.y, z });
    for (let y = shaft.y; y !== ore.y; y += Math.sign(ore.y - shaft.y))
      line.push({ x: ore.x, y, z });
    line.push(ore);
    for (const p of line) if (s.blocks[at(p)] || s.blocks[at({ ...p, z: z + 1 })]) place('mine', p);
    constructionDone(`finite underground ${resource} is excavated`, ['mine']);
  }
  assert(s.counts()[resource] >= target, `${resource} excavation target`);
}
async function opening() {
  assert.equal(s.save().version, 19);
  assert.equal(s.counts().herb, 0);
  const free = surface(),
    reserved = new Set();
  // Reserve the entire footprint before agriculture so later building never erases a crop.
  const base = free.find(
    (p) =>
      p.z >= 4 &&
      p.z <= 8 &&
      reachable(p) &&
      Array.from({ length: 9 }, (_, dx) => dx).every((dx) =>
        Array.from({ length: 7 }, (_, n) => n - 1).every((dy) => {
          const q = { ...p, x: p.x + dx, y: p.y + dy };
          return q.x < 61 && q.y > 1 && q.y < 61 && s.standable(q) && !occupied(q);
        }),
      ),
  );
  assert(base, 'free hospital and cold-store footprint');
  for (let dx = 0; dx <= 8; dx++)
    for (let dy = -1; dy <= 5; dy++) reserved.add(key({ ...base, x: base.x + dx, y: base.y + dy }));
  const shaft = free.find((p) => !reserved.has(key(p)) && p.z >= 4 && reachable(p));
  reserved.add(key(shaft));
  const stove = free.find((p) => !reserved.has(key(p)) && reachable(p));
  reserved.add(key(stove));
  place('stove', stove);
  const field = free
    .filter((p) => !reserved.has(key(p)) && [1, 8, 10].includes(s.blocks[at({ ...p, z: p.z - 1 })]))
    .slice(0, 184);
  assert.equal(field.length, 184);
  for (const [i, p] of field.entries()) {
    place('farm', p, { crop: i < 160 ? 'rice' : 'healroot' });
    reserved.add(key(p));
  }
  const warehouse = free.filter((p) => !reserved.has(key(p))).slice(0, 90 - s.stockpiles.length);
  for (const p of warehouse) {
    place('stock', p);
    reserved.add(key(p));
  }
  report.layout = {
    base,
    shaft,
    stove,
    herbs: field.slice(160),
    rice: field.slice(0, 160),
    groundStorage: warehouse,
  };
  forestry(600);
  until(
    'food and medicine are sown by colonists with their real plant skills',
    () =>
      s.stoves.length &&
      s.crops.filter((c) => c.kind === 'healroot').length >= 16 &&
      s.crops.filter((c) => c.kind === 'rice').length >= 120,
    DAY * 10,
  );
  command({ type: 'bill', stoveId: s.stoves[0].id, target: 12, paused: false });
  check('initial skills and real healroot planting', {
    skills: colonists().map((p) => ({ id: p.id, plants: p.skills.plants })),
    healrootPlots: 24,
  });
  await save('herb-growing');
  place('shaft', shaft);
  constructionDone('miners descend by a real three-level ladder', ['digLadder', 'ladder']);
  mineTo('steel', 3, 220);
  mineTo('components', 6, 5);
  if (s.counts().wood < 500) forestry(500);
  const upperZ = base.z + 3,
    upper = (dx, dy, z = upperZ) => ({ x: base.x + dx, y: base.y + dy, z });
  place('up', base);
  constructionDone('hospital ladder links the upper floor', ['ladder']);
  // The first row touches the physical ladder, and later rows grow from constructed support.
  for (let dx = 1; dx <= 8; dx++) {
    for (let dy = -1; dy <= 5; dy++) place('floor', upper(dx, dy));
    constructionDone('upper platform is built with carried timber', ['floor']);
  }
  const medicalBed = upper(1, 3);
  place('bed', medicalBed, { axis: 'y' });
  constructionDone('a real upper-floor medical bed is built', ['bed']);
  const bed = s.beds.find((b) => same(b, medicalBed));
  command({ type: 'bedMedical', bedId: bed.id, medical: true });
  report.layout.medicalBed = { ...point(bed), id: bed.id };
  // Build the roof from an exterior ladder first; walls never trap a roof builder.
  place('up', upper(1, -1));
  constructionDone('roof ladder is built outside the cold room', ['ladder']);
  place('floor', upper(2, -1, upperZ + 3));
  constructionDone('roof landing is supported', ['floor']);
  for (let dx = 3; dx <= 7; dx++) {
    for (let dy = -1; dy <= 4; dy++) place('floor', upper(dx, dy, upperZ + 3));
    constructionDone('roof closes the upper cold room', ['floor']);
  }
  for (let dx = 3; dx <= 7; dx++)
    for (let dy = 0; dy <= 4; dy++) {
      if (dx > 3 && dx < 7 && dy > 0 && dy < 4) continue;
      if (dy === 2 && (dx === 3 || dx === 7)) continue;
      place('wall', upper(dx, dy));
    }
  constructionDone('cold-store walls are physically assembled', ['wall']);
  place('door', upper(3, 2), { axis: 'y' });
  place('cooler', upper(7, 2), { axis: 'x' });
  const gen = { ...base, y: base.y + 3 };
  place('generator', gen, { axis: 'x' });
  constructionDone('door, cooler and generator consume mined materials', [
    'door',
    'cooler',
    'generator',
  ]);
  for (let dy = 0; dy <= 2; dy++) place('wire', { ...base, y: base.y + dy });
  for (let z = base.z + 1; z <= upperZ; z++) place('wire', { ...base, z });
  place('wire', upper(1, 0));
  constructionDone('actual vertical wiring powers the hospital level', ['wire']);
  const cooler = s.devices.find((d) => d.kind === 'cooler');
  const generator = s.devices.find((d) => d.kind === 'generator');
  command({ type: 'device', deviceId: generator.id, on: false, target: generator.target });
  command({ type: 'device', deviceId: cooler.id, on: true, target: -5 });
  const cold = upper(5, 2);
  report.layout.cold = cold;
  report.layout.coolerId = cooler.id;
  report.layout.generatorId = s.devices.find((d) => d.kind === 'generator').id;
  const herbStorage = [];
  for (let dx = 4; dx <= 6; dx++)
    for (let dy = 1; dy <= 3; dy++) {
      const p = upper(dx, dy);
      herbStorage.push(p);
      place('stock', p);
    }
  command({
    type: 'storage',
    from: herbStorage[0],
    connected: true,
    priority: 3,
    accepts: ['herb'],
  });
  report.layout.herbStorage = herbStorage;
  until(
    'normally grown healroot yields physical nonfood herbs',
    () => s.stats.produced.herb >= 8,
    DAY * 20,
  );
  await save('herb-grown');
  report.coverage.herbs = true;
  forestry(250);
  command({ type: 'device', deviceId: generator.id, on: true, target: generator.target });
  until(
    'herbs are physically hauled upstairs into the powered frozen store',
    () =>
      s.temperature(cold) < 0 &&
      s.items.some((i) => i.resource === 'herb' && herbStorage.some((p) => same(p, i))),
    DAY * 4,
  );
  report.coverage.coldStore = true;
  const stored = s.items.filter(
    (i) => i.resource === 'herb' && herbStorage.some((p) => same(p, i)),
  );
  assert(stored.every((i) => i.amount <= 25 && i.rotProgress >= 0));
  assert(s.devices.find((d) => d.kind === 'cooler').powered);
  check('upper herb inventory is finite, perishable and cold', {
    herbs: stored,
    temperature: s.temperature(cold),
    z: upperZ,
  });
  await save('herb-cold');
  // Do not let a nearer newly harvested ground herb undermine the cross-level retrieval case.
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'grow', value: 0 });
  until(
    'all harvested herbs are hauled into upper storage before medical exercise',
    () =>
      s.items
        .filter((i) => i.resource === 'herb')
        .every((i) => herbStorage.some((p) => same(p, i))) &&
      !s.pawns.some((p) => p.cargo?.resource === 'herb'),
    DAY * 3,
  );
  for (const p of colonists()) {
    command({ type: 'priority', pawnId: p.id, work: 'care', value: 0 });
    command({ type: 'medicalPolicy', pawnId: p.id, policy: 'none' });
  }
  assert(colonists().every((p) => !p.dead));
  await save('prepared');
}
function patientSummary(p) {
  return {
    id: p.id,
    dead: p.dead,
    downed: p.downed,
    position: point(p),
    bloodLoss: p.trauma.bloodLoss,
    wounds: structuredClone(p.trauma.wounds),
    infections: structuredClone(p.medical.infections),
    immunity: p.medical.immunity,
  };
}
async function delayedBranch(attempt, woundedFixture, patientId) {
  await loadBranch(`battle-${attempt}-delayed`, woundedFixture);
  const start = s.tick;
  while (
    s.tick - start < 9200 &&
    !person(patientId).dead &&
    !person(patientId).medical.infections.length
  )
    step();
  const patient = person(patientId);
  report.battles.at(-1).delayed = { elapsed: s.tick - start, patient: patientSummary(patient) };
  if (!patient.dead && patient.medical.infections.length) {
    report.coverage.naturalInfection = true;
    report.infectedPatientId = patientId;
    await save('infected-untreated');
    report.fixtures.infected = {
      ...report.fixtures['infected-untreated'],
      aliasOf: 'infected-untreated',
    };
    check('an untreated real battle wound naturally develops delayed infection', {
      patient: patientSummary(patient),
    });
    const onset = s.tick;
    while (
      !person(patientId).dead &&
      person(patientId).medical.infections.length &&
      s.tick - onset < DAY * 3
    )
      step();
    await save('untreated-infection-outcome');
    report.battles.at(-1).delayedOutcome = patientSummary(person(patientId));
    check('the untreated infection branch retains its actual subsequent outcome', {
      patient: patientSummary(person(patientId)),
      elapsed: s.tick - onset,
    });
    return true;
  }
  await save(`battle-${attempt}-delayed-${patient.dead ? 'death' : 'no-infection'}`);
  check('untreated branch outcome is retained without manipulating random state', {
    patient: patientSummary(patient),
    elapsed: s.tick - start,
  });
  return false;
}
async function treatment(patientId, capture) {
  const patient = person(patientId);
  const doctor = colonists()
    .filter((p) => p.id !== patientId && !p.dead && !p.downed)
    .sort((a, b) => b.skills.medicine.level - a.skills.medicine.level)[0];
  assert(doctor, 'a real mobile doctor survives');
  const doctorId = doctor.id;
  if (capture) {
    report.patientId = patientId;
    report.doctorId = doctorId;
  }
  command({ type: 'medicalPolicy', pawnId: patientId, policy: 'herbal' });
  // Manual care is an ordinary command. The doctor must fetch medicine from actual stocks.
  command({ type: 'care', pawnId: doctorId, patientId, action: 'tend' });
  if (capture) {
    assert.equal(person(doctorId).carePhase, 'tendFetch');
    await save('fetching');
    report.coverage.fetch = true;
    const saved = s.save();
    s = VoxelSimulation.load(saved);
    for (const field of ['carePhase', 'careMedicineId', 'careAmount', 'careProgress', 'cargo'])
      assert.deepEqual(person(doctorId)[field], saved.pawns.find((p) => p.id === doctorId)[field]);
    check('real herb reservation survives a normal save/load');
  }
  until(
    'doctor carries real medicine before treatment',
    () => person(doctorId).cargo?.resource === 'herb',
    DAY,
  );
  if (capture) {
    report.herbFetchZ = person(doctorId).z;
    assert.equal(
      person(doctorId).z,
      report.layout.cold.z,
      'doctor physically climbs to upper medicine storage',
    );
    await save('herb-carried');
  }
  until(
    'doctor performs elapsed treatment work at the patient',
    () => person(doctorId).carePhase === 'tend' && person(doctorId).careProgress > 50,
    DAY,
  );
  if (capture) {
    await save('tending');
    report.coverage.tend = true;
    const old = s.save();
    s = VoxelSimulation.load(old);
    assert.equal(
      person(doctorId).careProgress,
      old.pawns.find((p) => p.id === doctorId).careProgress,
    );
  }
  const before = s.stats.consumed.herb,
    last = person(patientId).medical.lastTend?.tick ?? -1;
  until(
    'completed treatment consumes physical herb and records its actual quality',
    () => (person(patientId).medical.lastTend?.tick ?? -1) > last,
    DAY,
  );
  assert(s.stats.consumed.herb > before);
  assert.equal(person(patientId).medical.lastTend.medicine, 'herb');
  if (capture) await save('tended');
  return doctorId;
}
async function noMedicineBranch(woundedFixture, patientId) {
  await loadBranch('no-medicine-comparison', woundedFixture);
  const doctor = colonists().find((p) => p.id !== patientId && !p.dead && !p.downed);
  assert(doctor);
  command({ type: 'medicalPolicy', pawnId: patientId, policy: 'noMedicine' });
  const before = s.stats.consumed.herb;
  command({ type: 'care', pawnId: doctor.id, patientId, action: 'tend' });
  until(
    'no-medicine policy performs real care without consuming herbs',
    () => person(patientId).medical.lastTend !== null,
    DAY,
  );
  assert.equal(person(patientId).medical.lastTend.medicine, null);
  assert.equal(s.stats.consumed.herb, before);
  await save('no-medicine');
}
async function recovery(patientId) {
  const patient = person(patientId);
  command({ type: 'medicalRest', pawnId: patientId, enabled: true });
  for (const p of colonists()) {
    command({ type: 'priority', pawnId: p.id, work: 'grow', value: 3 });
    command({ type: 'medicalPolicy', pawnId: p.id, policy: 'herbal' });
    if (!p.dead && !p.downed) command({ type: 'priority', pawnId: p.id, work: 'care', value: 1 });
  }
  const start = s.tick;
  let savedBed = false,
    savedRenewal = false;
  const originalTreatment = patient.medical.lastTend?.tick ?? -1;
  while (
    !person(patientId).dead &&
    person(patientId).medical.infections.length &&
    s.tick - start < DAY * 8
  ) {
    step();
    const p = person(patientId);
    if (!savedBed && p.sleepBedId === report.layout.medicalBed.id && p.phase === 'rest') {
      assert.equal(p.z, report.layout.medicalBed.z);
      await save('medical-bed');
      savedBed = true;
      report.coverage.bedRest = true;
      check('the infected patient reaches and rests in the actual upper medical bed');
    }
    if (
      !savedRenewal &&
      p.medical.lastTend?.tick > originalTreatment &&
      p.medical.lastTend.recordIds.some((id) => p.medical.infections.some((i) => i.id === id))
    ) {
      await save('infection-tended');
      savedRenewal = true;
    }
    if (s.tick % 1000 === 0)
      report.samples.push({ branch, tick: s.tick, patient: patientSummary(p) });
  }
  if (!person(patientId).dead && !person(patientId).medical.infections.length) {
    assert(person(patientId).medical.immunity > 0);
    await save('recovered');
    report.coverage.recovery = true;
    check('real infection resolves while shared immunity remains', {
      patient: patientSummary(person(patientId)),
    });
  } else {
    await save('infection-care-outcome');
    check('infection-care outcome retained without forcing recovery', {
      patient: patientSummary(person(patientId)),
    });
  }
}
try {
  if (!resume) await opening();
  if (process.argv.includes('--prepare-only')) {
    report.status = 'prepared';
  } else {
    for (let attempt = 1; attempt <= 4 && !report.coverage.naturalInfection; attempt++) {
      beginBranch(`battle-${attempt}-continuation`, { previousBranch: branch, tick: s.tick });
      forestry(180);
      for (const p of colonists()) {
        if (p.dead) continue;
        command({ type: 'priority', pawnId: p.id, work: 'grow', value: 0 });
        command({ type: 'medicalPolicy', pawnId: p.id, policy: 'none' });
        command({ type: 'priority', pawnId: p.id, work: 'care', value: 0 });
      }
      until(
        'harvested medicines are stored upstairs before the next battle',
        () =>
          s.items
            .filter((i) => i.resource === 'herb')
            .every((i) => report.layout.herbStorage.some((p) => same(p, i))) &&
          !s.pawns.some((p) => p.cargo?.resource === 'herb'),
        DAY * 2,
      );
      command({ type: 'threats', enabled: true });
      const wave = s.combat.wave;
      until(
        'three actual preparation days pass before the next scheduled raid',
        () => s.combat.wave > wave,
        DAY * 4,
      );
      command({ type: 'threats', enabled: false });
      const raider = s.pawns.findLast((p) => p.faction === 'raider' && !p.dead && !p.downed);
      assert(raider);
      for (const p of colonists().filter((p) => !p.dead && !p.downed)) {
        command({ type: 'draft', pawnId: p.id, drafted: true });
        command({ type: 'attack', pawnId: p.id, targetId: raider.id });
      }
      until(
        'normal defenders incapacitate the scheduled opponent',
        () =>
          !person(raider.id) ||
          person(raider.id).dead ||
          person(raider.id).downed ||
          colonists().every((p) => p.dead || p.downed),
        DAY,
      );
      for (const p of colonists().filter((p) => p.drafted))
        command({ type: 'draft', pawnId: p.id, drafted: false });
      const candidate = colonists()
        .filter(
          (p) =>
            !p.dead &&
            p.trauma.wounds.some(
              (w) => ['cut', 'stab', 'gunshot', 'bite'].includes(w.kind) && w.tendQuality === null,
            ),
        )
        .sort((a, b) => b.trauma.wounds.length - a.trauma.wounds.length)[0];
      const woundedFixture = `battle-${attempt}-wounded`;
      await save(woundedFixture);
      report.battles.push({
        attempt,
        wave: s.combat.wave,
        raiderId: raider.id,
        weapon: raider.weapon?.kind,
        patientId: candidate?.id ?? null,
        fixture: woundedFixture,
        colonists: colonists().map(patientSummary),
      });
      if (
        !candidate ||
        colonists().some((p) => p.dead) ||
        colonists().filter((p) => !p.downed).length < 1
      ) {
        report.battles.at(-1).outcome = 'no surviving sharp-wound treatment case';
        check('battle outcome retained without fabricated wounds', { attempt });
        if (colonists().some((p) => p.dead)) break;
        continue;
      }
      const patientId = candidate.id;
      if (!report.fixtures.wounded) await save('wounded');
      await delayedBranch(attempt, woundedFixture, patientId);
      if (!report.fixtures['no-medicine']) await noMedicineBranch(woundedFixture, patientId);
      // Both care policies begin from an identical normal wounded save, without rerolling that wound.
      await loadBranch(`battle-${attempt}-herbal`, woundedFixture);
      await treatment(patientId, !report.coverage.tend);
      for (const p of colonists()) {
        if (!p.dead) command({ type: 'priority', pawnId: p.id, work: 'grow', value: 3 });
        if (!p.dead) command({ type: 'medicalPolicy', pawnId: p.id, policy: 'herbal' });
        if (!p.dead && !p.downed)
          command({ type: 'priority', pawnId: p.id, work: 'care', value: 1 });
      }
      await save(`battle-${attempt}-early-herbal`);
      // Continue ordinary early treatment. Delaying until an untreated casualty is
      // almost exsanguinated cannot promise enough time for a doctor to fetch medicine.
      // The same injury's existing eligibility and second-trial roll remain unchanged.
      const start = s.tick;
      while (s.tick - start < DAY * 3 && !colonists().some((p) => p.dead)) {
        step();
        const infected = colonists().find((p) => p.medical.infections.length && !p.dead);
        if (infected) {
          report.coverage.naturalInfection = true;
          report.infectedPatientId = infected.id;
          await save('infected');
          await recovery(infected.id);
          break;
        }
      }
      await save(`battle-${attempt}-care-outcome`);
      if (colonists().some((p) => p.dead)) break;
    }
    audit();
    assert(
      report.coverage.herbs &&
        report.coverage.coldStore &&
        report.coverage.fetch &&
        report.coverage.tend,
      'ordinary herb production, preservation and care must be observed',
    );
    await save('final');
    report.finalTick = s.tick;
    report.final = { tick: s.tick, counts: s.counts(), people: colonists().map(patientSummary) };
    report.status = 'passed';
    report.limitations = [
      'Normal-care and delayed-care comparison branches explicitly reload the same real wound. They are counterfactual gameplay branches, not independent trials.',
      ...(!report.coverage.naturalInfection
        ? [
            'No living-colonist infection occurred within the retained normal battles; infection UI and recovery are not established by this campaign.',
          ]
        : []),
      ...(report.coverage.naturalInfection && !report.coverage.recovery
        ? [
            'A natural infection occurred but recovery was not observed; the real adverse outcome is retained.',
          ]
        : []),
    ];
  }
} catch (error) {
  report.status = 'failed';
  report.errors.push(String(error.stack ?? error));
  await save(`failure-${Date.now()}`);
  process.exitCode = 1;
  console.error(error);
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
