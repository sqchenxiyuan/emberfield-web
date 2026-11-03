import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { researchOpening } from './voxel-research-opening.mjs';

const OUT = process.env.VOXEL_STORYTELLER_OUT ?? 'test-results/voxel-storyteller-exploratory';
const formal = process.env.VOXEL_STORYTELLER_FINAL === '1';
const resume = process.env.VOXEL_STORYTELLER_RESUME;
assert(!formal || !resume || process.env.VOXEL_STORYTELLER_RESUME_FROM, 'Formal continuations name their unchanged predecessor report');
const DAY = 12000, sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(OUT, { recursive: true });
const bundle = await build({
  stdin: {
    contents: "export { VoxelSimulation } from './src/voxel/world.ts'; export { colonyWealthDetails } from './src/voxel/wealth.ts';",
    resolveDir: process.cwd(),
  }, bundle: true, platform: 'node', format: 'esm', write: false,
});
const bytes = Buffer.from(bundle.outputFiles[0].text);
if (process.env.VOXEL_STORYTELLER_EXPECT_SOURCE)
  assert.equal(sha(bytes), process.env.VOXEL_STORYTELLER_EXPECT_SOURCE, 'campaign uses the reviewed frozen source');
const execution = {
  bundle: `${OUT}/executed-world${resume ? '-resumed' : ''}.mjs`, sha256: sha(bytes),
  script: `${OUT}/executed-campaign${resume ? '-resumed' : ''}.mjs`,
  scriptSha256: sha(await readFile(new URL(import.meta.url))),
  openingSha256: sha(await readFile(new URL('./voxel-research-opening.mjs', import.meta.url))),
};
await writeFile(execution.bundle, bytes, { flag: 'wx' });
await writeFile(execution.script, await readFile(new URL(import.meta.url)), { flag: 'wx' });
const { VoxelSimulation, colonyWealthDetails } = await import('data:text/javascript;base64,' + bytes.toString('base64'));
let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
let branch = 'ordinary-main';
const point = ({ x, y, z }) => ({ x, y, z }), key = (p) => `${p.x}/${p.y}/${p.z}`;
const at = (p) => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const people = () => s.pawns.filter((p) => p.faction === 'colony');
const person = (id) => s.pawns.find((p) => p.id === id);
const alive = () => people().filter((p) => !p.dead && !p.downed);
const enemies = () => s.pawns.filter((p) => p.faction === 'raider' && !p.dead && !p.downed);
const stock = () => ({ ...s.counts() });
const ledger = () => Object.fromEntries(Object.entries(stock()).map(([r, n]) => [r,
  n + s.stats.consumed[r] + s.stats.spoiled[r] + s.stats.destroyed[r] - s.stats.produced[r],
]));
let report = {
  status: 'running', formal, startedAt: new Date().toISOString(), execution,
  scope: 'Fresh seed 73129. Only public ordinary commands, step, save and load mutate the colony. Read-only terrain/path/state inspection plans sites. No granted wealth, resources, equipment, skills, knowledge, injuries, events, clocks or random state. Threats are enabled once after actual food, research, equipment and expansion. Extreme is an explicit ordinary difficulty selection; saved-state comparisons are labelled branches, not independent trials.',
  commands: [], checks: [], fixtures: {}, branches: [], events: [], losses: [], samples: [], externalTransfers: [], errors: [], injuryHistory: [],
  coverage: { expansion: false, rawCargo: false, delivered: false, multiRaid: false, healthLoss: false, adaptationLoss: false, recovery: false, deterministicReload: false, difficultyComparison: false },
  rawAudits: { ground: 0, cargo: 0, delivered: 0 },
};
function beginBranch(name, origin = null) {
  branch = name;
  report.branches.push({ name, tick: s.tick, origin, initialLedger: ledger() });
}
beginBranch(branch);
if (resume) {
  assert(['armed', 'components', 'powered'].includes(resume));
  const reportFile = process.env.VOXEL_STORYTELLER_RESUME_FROM ?? `${OUT}/report.json`;
  const reportBytes = await readFile(reportFile), old = JSON.parse(reportBytes);
  const fixture = old.fixtures[resume === 'armed' ? 'armed' : 'failure'];
  const savedBytes = await readFile(fixture.file);
  assert.equal(sha(savedBytes), fixture.sha256);
  if (formal) {
    assert.equal(old.formal, true);
    assert.equal(old.execution.sha256, execution.sha256, 'formal segments execute the identical frozen game source');
    assert.equal(old.fixtures.initial.tick, 0);
    assert.equal(old.status, 'failed', 'formal continuation retains an honest terminal failure checkpoint');
    assert.equal(fixture.tick, old.finalTick, 'continue at the actual terminal tick without rewinding');
    assert.equal(sha(await readFile(old.execution.bundle)), old.execution.sha256);
    assert.equal(sha(await readFile(old.execution.script)), old.execution.scriptSha256);
  }
  s = VoxelSimulation.load(JSON.parse(savedBytes));
  report = { ...old, status: 'running', formal, execution, previousExecution: old.execution, errors: [], injuryHistory: old.injuryHistory ?? [],
    executionSegments: [...(old.executionSegments ?? []), { report: { file: reportFile, sha256: sha(reportBytes) }, execution: old.execution, status: old.status, terminalTick: old.finalTick, resumedFixture: fixture, mode: resume }],
  };
  beginBranch(`${formal ? 'ordinary' : 'development'}-resume-${resume}`, fixture);
}
function check(name, detail = {}) {
  report.checks.push({ branch, tick: s.tick, name, ...detail });
  console.log('PASS', branch, s.tick, name);
}
function command(c) {
  const result = s.command(c);
  report.commands.push({ branch, tick: s.tick, command: c, result });
  assert(result.ok, JSON.stringify({ c, result }));
  return result;
}
const place = (tool, p, extra = {}) => command({ type: 'designate', tool, from: point(p), ...extra });
const rawPrices = { wood: 1.2, stone: .9, steel: 1.9, components: 32, food: 24, grain: 1.1, meal: 15, chunk: 0, cloth: 1.5, herb: 10 };
const close = (a, b, label) => assert(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
function ownership() {
  const result = [], seen = new Set();
  const record = (piece, holder) => {
    if (!piece) return;
    assert(!seen.has(piece.id), `equipment ${piece.id} has two physical owners`);
    seen.add(piece.id);
    result.push({ id: piece.id, holder, kind: piece.kind, quality: piece.quality, hitPoints: piece.hitPoints });
  };
  for (const item of s.items) { record(item.weapon, `ground:${item.id}`); record(item.apparel, `ground:${item.id}`); }
  for (const pawn of s.pawns) {
    record(pawn.weapon, `pawn:${pawn.id}`);
    for (const piece of pawn.worn) record(piece, `worn:${pawn.id}`);
    record(pawn.cargo?.weapon, `cargo:${pawn.id}`);
    record(pawn.cargo?.apparel, `cargo:${pawn.id}`);
  }
  return result.sort((a, b) => a.id - b.id);
}
function audit() {
  const baseline = report.branches.findLast((b) => b.name === branch).initialLedger;
  for (const [resource, amount] of Object.entries(ledger())) {
    const transfers = report.externalTransfers.filter((t) => t.branch === branch && t.resource === resource).reduce((sum, t) => sum + t.amount, 0);
    assert.equal(amount, baseline[resource] + transfers, `${branch} ${resource} conservation at ${s.tick}`);
  }
  const before = { ownership: ownership(), counts: stock() };
  const snapshot = s.snapshot(), value = colonyWealthDetails(s);
  assert.deepEqual({ ownership: ownership(), counts: stock() }, before, 'wealth/snapshot reads preserve physical ownership and amounts');
  close(snapshot.storyteller.threat.totalWealth, value.items + value.buildings + value.pawns, 'total breakdown');
  close(snapshot.storyteller.threat.storytellerWealth, value.items + value.buildings * .5 + value.pawns, 'storyteller breakdown');
  const raw = (batch) => Object.hasOwn(rawPrices, batch.resource);
  const amount = (batch) => batch.amount * rawPrices[batch.resource];
  if (s.items.every(raw)) {
    close(value.itemSources.ground, s.items.reduce((sum, item) => sum + amount(item), 0), 'ground native unit prices');
    report.rawAudits.ground++;
  }
  const carried = people().flatMap((p) => p.cargo ? [p.cargo] : []);
  if (carried.length && carried.every(raw)) {
    close(value.itemSources.cargo, carried.reduce((sum, item) => sum + amount(item), 0), 'carried native unit prices');
    report.rawAudits.cargo++;
    report.coverage.rawCargo = true;
  }
  const delivered = s.jobs.flatMap((j) => Object.entries(j.delivered));
  if (delivered.length && delivered.every(([resource]) => Object.hasOwn(rawPrices, resource))) {
    close(value.itemSources.delivered, delivered.reduce((sum, [resource, count]) => sum + count * rawPrices[resource], 0), 'delivered native prices; food metadata counted once');
    report.rawAudits.delivered++;
    report.coverage.delivered = true;
  }
}
const recordedEvents = new Set(), recordedLosses = new Set(), captures = new Map();
let autoDefense = false, sawCombat = false;
function step() {
  const prior = s.pawns.filter((p) => p.faction === 'raider').map((p) => ({ id: p.id, weapon: p.weapon ? structuredClone(p.weapon) : null }));
  s.step();
  for (const p of s.pawns.filter((p) => p.faction === 'raider')) if (!prior.some((q) => q.id === p.id) && p.weapon)
    report.externalTransfers.push({ branch, tick: s.tick, pawnId: p.id, resource: 'weapon', itemId: p.weapon.id, amount: 1, reason: 'scheduled enemy enters with real gear' });
  for (const p of prior) if (!person(p.id) && p.weapon)
    report.externalTransfers.push({ branch, tick: s.tick, pawnId: p.id, resource: 'weapon', itemId: p.weapon.id, amount: -1, reason: 'enemy leaves carrying its real gear' });
  for (const event of s.storyteller.events) {
    const id = `${branch}/${event.tick}/${event.source}`;
    if (recordedEvents.has(id)) continue;
    recordedEvents.add(id); report.events.push({ branch, ...structuredClone(event) });
    if (event.outcome === 'spawned') {
      close(event.spent, event.members.reduce((sum, m) => sum + m.cost, 0), 'actual member costs');
      close(event.budget, event.spent + event.remainder, 'raid budget identity');
      assert(event.members.length > 0 && event.members.length <= 16);
      assert(event.members.every((m) => person(m.pawnId)?.faction === 'raider'));
      if (event.members.length > 1 && !captures.has('multi-raid')) {
        captures.set('multi-raid', s.save()); report.coverage.multiRaid = true;
      }
      sawCombat = true;
    }
  }
  for (const loss of s.storyteller.losses) {
    const id = `${branch}/${loss.tick}/${loss.pawnId}/${loss.kind}`;
    if (recordedLosses.has(id)) continue;
    recordedLosses.add(id); report.losses.push({ branch, ...structuredClone(loss) });
    assert(loss.after <= loss.before);
    report.coverage.adaptationLoss = true;
    if (!captures.has('adaptation-loss')) captures.set('adaptation-loss', s.save());
  }
  if (autoDefense && s.tick % 20 === 0) {
    const targets = enemies();
    for (const p of alive()) {
      if (targets.length) {
        if (!p.drafted) command({ type: 'draft', pawnId: p.id, drafted: true });
        const target = targets.sort((a, b) => distance(a, p) - distance(b, p))[0];
        if (p.attackTargetId === null || !targets.some((q) => q.id === p.attackTargetId))
          command({ type: 'attack', pawnId: p.id, targetId: target.id });
      } else if (p.drafted) command({ type: 'draft', pawnId: p.id, drafted: false });
    }
    if (!targets.length && sawCombat) {
      const patients = people().filter((p) => !p.dead && (p.trauma.wounds.length || p.medical.infections.length));
      const doctor = alive().filter((p) => patients.some((patient) => patient.id !== p.id))
        .sort((a, b) => Number(patients.some((p) => p.id === a.id)) - Number(patients.some((p) => p.id === b.id)) ||
          b.skills.medicine.level - a.skills.medicine.level)[0];
      for (const p of alive()) {
        const rest = p.id !== doctor?.id;
        if (p.medical.bedRest !== rest) command({ type: 'medicalRest', pawnId: p.id, enabled: rest });
      }
    }
  }
  if (s.tick % 100 === 0) audit();
  if (s.tick % (DAY / 2) === 0) report.samples.push({ branch, tick: s.tick, threat: s.threatBreakdown(), counts: stock(), people: people().map((p) => ({ id: p.id, dead: p.dead, downed: p.downed, wounds: p.trauma.wounds.length })) });
  if (sawCombat && !captures.has('injured') && s.threatBreakdown().population.some((p) => p.health < .999)) {
    captures.set('injured', s.save()); report.coverage.healthLoss = true;
  }
  if (sawCombat) for (const p of people()) if (!report.injuryHistory.some((h) => h.id === p.id) &&
    (p.trauma.wounds.length || p.medical.infections.length)) {
    const fixture = `injured-pawn-${p.id}`;
    captures.set(fixture, s.save());
    report.injuryHistory.push({
      id: p.id, tick: s.tick, fixture, health: s.threatBreakdown().population.find((value) => value.id === p.id)?.health,
      wounds: structuredClone(p.trauma.wounds), infections: structuredClone(p.medical.infections), missingParts: structuredClone(p.trauma.missingParts),
    });
  }
}
function diagnostics() {
  return { tick: s.tick, counts: stock(), jobs: s.jobs, storyteller: s.storyteller, people: people().map((p) => ({ id: p.id, phase: p.phase, reason: p.reason, food: p.food, dead: p.dead, downed: p.downed })) };
}
function until(name, done, maximum = DAY * 8) {
  const start = s.tick;
  while (!done() && s.tick - start < maximum && people().some((p) => !p.dead)) step();
  assert(done(), JSON.stringify({ name, ...diagnostics() }));
  audit(); check(name, { elapsed: s.tick - start });
}
async function save(name, data = s.save()) {
  const file = `${OUT}/${name}.json`, bytes = Buffer.from(JSON.stringify(data) + '\n');
  await writeFile(file, bytes, { flag: 'wx' });
  report.fixtures[name] = { file, branch, tick: data.tick, version: data.version, sha256: sha(bytes) };
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n');
  return data;
}
function occupied(p) {
  const inBed = (bed) => key(bed) === key(p) || key({ ...bed,
    x: bed.x + (bed.axis === 'x' ? 1 : 0), y: bed.y + (bed.axis === 'y' ? 1 : 0),
  }) === key(p);
  // Keep both the operating tile and a one-cell aisle around each existing workbench free.
  const benchAisle = (b) => b.z === p.z && p.x >= b.x - 1 && p.y >= b.y - 1 &&
    p.x <= b.x + (b.axis === 'x' ? 3 : 2) && p.y <= b.y + (b.axis === 'x' ? 2 : 3);
  return !!s.ladders[at(p)] || s.beds.some(inBed) || s.jobs.some((j) => j.kind === 'bed' && inBed(j)) ||
    [...s.weaponBenches, ...s.researchBenches].some(benchAisle) ||
    [s.items, s.trees, s.treePlots, s.jobs, s.farms, s.stockpiles, s.stoves, s.doors, s.sandbags,
    s.weaponBenches, s.researchBenches, s.devices].some((list) => list.some((q) => key(q) === key(p)));
}
function surface() {
  const cells = [];
  for (let y = 3; y < 60; y++) for (let x = 3; x < 60; x++) {
    let z = 14; while (z > 0 && !s.blocks[at({ x, y, z })]) z--;
    const p = { x, y, z: z + 1 };
    if (s.standable(p) && !occupied(p)) cells.push(p);
  }
  return cells.sort((a, b) => distance(a, s.spawn) - distance(b, s.spawn));
}
function site(width = 3, depth = 3) {
  const p = surface().find((p) => Array.from({ length: width }, (_, x) => x).every((x) =>
    Array.from({ length: depth }, (_, y) => y).every((y) => {
      const q = { x: p.x + x, y: p.y + y, z: p.z };
      return s.standable(q) && !occupied(q) && s.path(alive()[0], q) !== null;
    })));
  assert(p, 'reachable empty construction footprint');
  return p;
}
function forestry(target = 350) {
  const trees = s.trees.filter((t) => t.growth >= .8 && !s.jobs.some((j) => j.kind === 'cut' && key(j) === key(t)) &&
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => s.path(alive()[0], { ...t, x: t.x + dx, y: t.y + dy }) !== null))
    .sort((a, b) => distance(a, s.spawn) - distance(b, s.spawn));
  let index = 0;
  while (s.counts().wood < target && index < trees.length) {
    for (const t of trees.slice(index, index + 12)) place('cut', t);
    index += 12;
    until('finite forestry supplies construction, cooking and fuel', () => !s.jobs.some((j) => j.kind === 'cut'));
  }
  assert(s.counts().wood >= target);
}
function mineComponents(target) {
  const shaft = report.layout.shaft, z = shaft.z - 3, ores = [];
  for (let x = 3; x < 61; x++) for (let y = 3; y < 61; y++)
    if (s.blocks[at({ x, y, z })] === 6 || s.blocks[at({ x, y, z: z + 1 })] === 6) ores.push({ x, y, z });
  ores.sort((a, b) => distance(a, { ...shaft, z }) - distance(b, { ...shaft, z }));
  for (const ore of ores) {
    if (s.counts().components >= target) break;
    const line = [];
    for (let x = shaft.x; x !== ore.x; x += Math.sign(ore.x - shaft.x)) line.push({ x, y: shaft.y, z });
    for (let y = shaft.y; y !== ore.y; y += Math.sign(ore.y - shaft.y)) line.push({ x: ore.x, y, z });
    line.push(ore);
    for (const p of line) if (s.blocks[at(p)] || s.blocks[at({ ...p, z: z + 1 })]) place('mine', p);
    until('finite mining supplies actual components', () => !s.jobs.some((j) => j.kind === 'mine'));
  }
  assert(s.counts().components >= target);
}
const gear = (kind) => s.items.find((item) => item.weapon?.kind === kind || item.apparel?.kind === kind);
async function opening(resumeStage = null) {
  assert.equal(s.save().version, 21);
  if (resumeStage !== 'powered') {
  if (resumeStage !== 'components') {
    report.initialThreat = s.threatBreakdown();
    await save('initial');
    report.layout = await researchOpening({ getSim: () => s, command, until, check,
      projects: ['Smithing', 'Machining', 'Gunsmithing', 'BlowbackOperation', 'PlateArmor'],
      steelTarget: 1000, foodPlots: 160,
      fixture: async (name, layout) => { report.layout = layout; await save(name); },
    });
  }
  // Actual recipes: machining bench 5 + generator 2 + three machine pistols 9.
  mineComponents(16);
  forestry(650);
  const crops = surface().filter((p) => [1, 8, 10].includes(s.blocks[at({ ...p, z: p.z - 1 })])).slice(0, 44);
  assert.equal(crops.length, 44);
  for (const [i, p] of crops.entries()) place('farm', p, { crop: i < 24 ? 'healroot' : 'cotton' });
  for (const p of surface().slice(0, Math.max(0, 90 - s.stockpiles.length))) place('stock', p);
  for (const kind of ['machining', 'smithy']) {
    const p = site(); place(kind, p, { axis: 'x' });
    until(`finite materials build the actual ${kind}`, () => s.weaponBenches.some((b) => b.kind === kind));
    report.layout[kind] = point(s.weaponBenches.find((b) => b.kind === kind));
  }
  const generatorSite = site(); place('generator', generatorSite, { axis: 'x' });
  until('real generator is built and fuelled', () => s.devices.some((d) => d.kind === 'generator' && d.fuel > 0));
  const generator = s.devices.find((d) => d.kind === 'generator'), machine = s.weaponBenches.find((b) => b.kind === 'machining');
  report.layout.generator = point(generator);
  // Wires are real positions; the generator and factory sites are at a common surface level.
  assert.equal(generator.z, machine.z);
  for (let x = generator.x; x !== machine.x; x += Math.sign(machine.x - generator.x)) place('wire', { x, y: generator.y, z: generator.z });
  for (let y = generator.y; y !== machine.y; y += Math.sign(machine.y - generator.y)) place('wire', { x: machine.x, y, z: machine.z });
  place('wire', machine);
  until('physical wires power the actual machining bench', () => !!machine.power.powered);
  }
  const machine = s.weaponBenches.find((b) => b.kind === 'machining'); assert(machine);
  if (resumeStage === 'powered') {
    const oldSmith = s.weaponBenches.find((b) => b.kind === 'smithy'); assert(oldSmith);
    place('remove', oldSmith);
    until('ordinary deconstruction clears the obstructed machining operating aisle', () => !s.weaponBenches.some((b) => b.id === oldSmith.id));
    const replacement = site(); place('smithy', replacement, { axis: 'x' });
    until('ordinary reconstruction places the smithy outside the machining aisle', () => s.weaponBenches.some((b) => b.kind === 'smithy'));
    report.layout.smithy = point(s.weaponBenches.find((b) => b.kind === 'smithy'));
  }
  const crafter = people().sort((a, b) => b.skills.crafting.level - a.skills.crafting.level)[0];
  for (const p of people()) command({ type: 'priority', pawnId: p.id, work: 'craft', value: p.id === crafter.id ? 1 : 0 });
  command({ type: 'weaponBill', benchId: machine.id, kind: 'machinePistol', target: 3, paused: false });
  until('physical gun inputs and partial work exist', () => s.jobs.some((j) => j.weaponKind === 'machinePistol' && j.progress > 20));
  await save('working');
  until('three real machine pistols are manufactured', () => s.stats.weaponsMade >= 3, DAY * 16);
  command({ type: 'weaponBill', benchId: machine.id, kind: 'machinePistol', target: 3, paused: true });
  const smith = s.weaponBenches.find((b) => b.kind === 'smithy');
  for (const kind of ['simpleHelmet', 'plateArmor']) {
    forestry(300);
    command({ type: 'armorBill', benchId: smith.id, kind, target: 1, paused: false });
    until(`real ${kind} forging completes`, () => s.items.some((i) => i.apparel?.kind === kind) || people().some((p) => p.cargo?.apparel?.kind === kind), DAY * 16);
    command({ type: 'armorBill', benchId: smith.id, kind, target: 1, paused: true });
  }
  for (const p of people()) command({ type: 'priority', pawnId: p.id, work: 'haul', value: 0 });
  until('equipment is physically available for pickup', () => !people().some((p) => p.cargo?.weapon || p.cargo?.apparel));
  for (const p of people()) {
    const weapon = gear('machinePistol')?.weapon; assert(weapon);
    command({ type: 'equipWeapon', pawnId: p.id, weaponId: weapon.id });
    until('real machine pistol transfers from ground to colonist', () => person(p.id).weapon?.id === weapon.id);
  }
  const defender = people().sort((a, b) => b.skills.melee.level - a.skills.melee.level)[0];
  report.defenderId = defender.id;
  for (const kind of ['simpleHelmet', 'plateArmor']) {
    const apparel = gear(kind)?.apparel; assert(apparel);
    command({ type: 'wear', pawnId: defender.id, apparelId: apparel.id });
    until('real armor is fetched and worn', () => person(defender.id).worn.some((a) => a.id === apparel.id));
  }
  for (const p of people()) command({ type: 'priority', pawnId: p.id, work: 'haul', value: 3 });
  for (let n = 0; n < 3; n++) {
    const p = site(2, 3); place('bed', p, { axis: 'y' });
    until('actual bed construction finishes', () => s.beds.some((b) => key(b) === key(p)));
    const bed = s.beds.find((b) => key(b) === key(p));
    if (n === 0) command({ type: 'bedMedical', bedId: bed.id, medical: true });
    else command({ type: 'bedOwner', bedId: bed.id, pawnId: people()[n].id });
  }
  until('normal healroot harvest supplies finite medical herbs', () => s.counts().herb >= 8, DAY * 20);
  const platform = site(2, 2);
  place('up', platform);
  until('physical ladders reach a new upper platform', () => s.ladders[at({ ...platform, z: platform.z + 3 })] === 1);
  const upper = { x: platform.x + 1, y: platform.y, z: platform.z + 3 };
  place('floor', upper);
  until('new floor retains its distinct construction identity', () => s.structureKinds[at({ ...upper, z: upper.z - 1 })] === 1);
  const structure = site(5, 3), before = colonyWealthDetails(s).buildings;
  for (let x = 0; x < 5; x++) place('wall', { ...structure, x: structure.x + x });
  until('new defensive structure consumes wood and finishes', () => !s.jobs.some((j) => j.kind === 'wall'));
  assert(colonyWealthDetails(s).buildings > before);
  assert(s.structureKinds.some((v) => v === 2) && s.structureKinds.some((v) => v === 3));
  report.coverage.expansion = true;
  report.expandedThreat = s.threatBreakdown();
  assert(report.expandedThreat.totalWealth > report.initialThreat.totalWealth);
  for (const p of people()) {
    command({ type: 'medicalPolicy', pawnId: p.id, policy: 'herbal' });
    command({ type: 'medicalRest', pawnId: p.id, enabled: true });
    command({ type: 'priority', pawnId: p.id, work: 'care', value: 1 });
  }
  forestry(350);
  await save('armed');
}
try {
  if (!resume || resume !== 'armed') await opening(resume);
  if (process.argv.includes('--prepare-only')) {
    report.status = 'prepared';
  } else {
    const armed = s.save(), comparisons = [];
    for (const difficulty of ['peaceful', 'easy', 'medium', 'rough', 'hard', 'extreme']) {
      s = VoxelSimulation.load(armed); beginBranch(`difficulty-${difficulty}`, report.fixtures.armed);
      const before = ownership(); command({ type: 'difficulty', difficulty });
      assert.deepEqual(ownership(), before);
      comparisons.push({ difficulty, threat: s.threatBreakdown(), storyteller: structuredClone(s.storyteller) });
    }
    report.difficultyComparisons = comparisons;
    report.coverage.difficultyComparison = true;
    s = VoxelSimulation.load(armed); beginBranch('extreme-main', report.fixtures.armed);
    command({ type: 'difficulty', difficulty: 'extreme' });
    command({ type: 'threats', enabled: true });
    assert.equal(report.commands.filter((r) => r.command.type === 'threats' && r.command.enabled).length, 1);
    const waiting = await save('enabled');
    const opportunity = s.snapshot().storyteller.nextOpportunity;
    assert(opportunity !== null && opportunity > s.tick);
    check('enabling threats retains the existing calendar without adding three preparation days', { opportunity, calendar: s.storyteller });
    const duration = opportunity - waiting.tick;
    autoDefense = true;
    until('ordinary time reaches the existing opportunity without moving its timestamp', () => s.tick >= opportunity - 120, duration + 1);
    const eventReady = await save('event-ready');
    const a = VoxelSimulation.load(eventReady), b = VoxelSimulation.load(eventReady);
    const replaySteps = opportunity - eventReady.tick;
    a.step(replaySteps); b.step(replaySteps);
    assert.deepEqual(a.storyteller, b.storyteller);
    assert.deepEqual(a.pawns.filter((p) => p.faction === 'raider'), b.pawns.filter((p) => p.faction === 'raider'));
    report.coverage.deterministicReload = true;
    check('identical saved calendar produces identical actual budget and enemy group', { origin: report.fixtures['event-ready'], steps: replaySteps, events: a.storyteller.events.slice(-1) });
    until('a scheduled budget produces an actual multi-person raid', () => report.coverage.multiRaid, DAY * 20);
    await save('multi-raid', captures.get('multi-raid'));
    until('ordinary defense resolves the first multi-person encounter', () => enemies().length === 0 || alive().length === 0, DAY * 4);
    assert(alive().length > 0, 'at least one defender survives and can provide care');
    await save('battle-after');
    const recoverStart = s.tick;
    const recoveredPatients = () => report.injuryHistory.filter((history) => {
      const p = person(history.id);
      return p && !p.dead && !p.downed && p.trauma.wounds.length === 0 && p.medical.infections.length === 0 &&
        p.medical.lastTend?.tick >= history.tick;
    }).map((history) => ({ ...history, recoveredAt: s.tick, lastTend: structuredClone(person(history.id).medical.lastTend) }));
    until('ordinary medical care and food restore survivors after actual injury', () =>
      report.coverage.healthLoss && recoveredPatients().length > 0 && s.stats.consumed.herb > armed.stats.consumed.herb &&
      people().filter((p) => !p.dead).every((p) => !p.downed && p.trauma.wounds.length === 0 && p.medical.infections.length === 0), DAY * 14);
    report.recoveredPatients = recoveredPatients();
    report.recoveryProof = report.recoveredPatients.map((history) => {
      const p = person(history.id);
      return { pawnId: p.id, injury: history, recovery: {
        tick: s.tick, alive: !p.dead, downed: p.downed,
        health: s.threatBreakdown().population.find((value) => value.id === p.id)?.health,
        wounds: structuredClone(p.trauma.wounds), infections: structuredClone(p.medical.infections),
        missingParts: structuredClone(p.trauma.missingParts), lastTend: structuredClone(p.medical.lastTend),
      }, herbConsumedSinceArmed: s.stats.consumed.herb - armed.stats.consumed.herb };
    });
    report.colonistOutcomes = people().map((p) => ({ id: p.id, dead: p.dead, downed: p.downed, missingParts: p.trauma.missingParts, wounds: p.trauma.wounds.length, infections: p.medical.infections.length }));
    report.coverage.recovery = true;
    await save('recovered');
    check('actual recovery is observed with retained calendar and injury history', { elapsed: s.tick - recoverStart });
    if (report.coverage.adaptationLoss) {
      const before = s.storyteller.adaptationDays, target = Math.floor(s.tick / (DAY / 2) + 1) * (DAY / 2);
      until('adaptation advances at its next real half-day boundary', () => s.tick >= target, DAY);
      check('post-loss adaptation progression is retained', { before, after: s.storyteller.adaptationDays });
    }
    for (const [name, data] of captures) if (!report.fixtures[name]) await save(name, data);
    const final = await save('final');
    const loaded = VoxelSimulation.load(final);
    assert.deepEqual(loaded.storyteller, final.storyteller);
    assert.deepEqual(loaded.save().structureKinds, final.structureKinds);
    audit();
    assert(report.coverage.expansion && report.coverage.rawCargo && report.coverage.delivered && report.coverage.multiRaid && report.coverage.healthLoss && report.coverage.recovery);
    report.status = 'passed';
  }
} catch (error) {
  report.status = 'failed'; report.errors.push(String(error.stack ?? error));
  for (const [name, data] of captures) if (!report.fixtures[name]) await save(name, data);
  await save('failure'); process.exitCode = 1; console.error(String(error));
} finally {
  report.finalTick = s.tick; report.final = { threat: s.threatBreakdown(), storyteller: s.storyteller, counts: stock(), ownership: ownership() };
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
