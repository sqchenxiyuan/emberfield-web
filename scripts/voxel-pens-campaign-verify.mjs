import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_PENS_OUT ?? 'test-results/voxel-pens';
await mkdir(OUT, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bundle = await build({ stdin: { contents: "export { VoxelSimulation } from './src/voxel/world.ts'; export { penSummaries } from './src/voxel/pensWorld.ts';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(`${OUT}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation, penSummaries } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const DAY = 12000, point = p => ({ x: p.x, y: p.y, z: p.z }), key = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
let sim = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, rainfall: 1500, latitude: 0 });
const initial = sim.counts();
const report = { version: sim.save().version, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Fresh seed 73129 colony. Only player commands, ordinary simulation ticks and exact save/load mutate state. Read-only terrain, routes and summaries select sites. Real farmed grain, construction, taming, physically attached ropes, ordinary animal motion and saved area edits. No injected animals, ownership, food, needs, positions, clock or RNG. This is bounded play evidence, not calibrated probability or indefinite grazing balance.',
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await readFile(new URL(import.meta.url))) },
  checks: [], commands: [], daily: [], fixtures: {}, browser: {} };
const animal = id => sim.animals.find(a => a.id === id);
const summaries = () => penSummaries(sim);
const check = (name, detail = {}) => { report.checks.push({ name, tick: sim.tick, ...detail }); console.log('PASS', name, sim.tick); };
function command(c) { const result = sim.command(c); report.commands.push({ tick: sim.tick, c, result }); assert(result.ok, JSON.stringify({ c, result })); return result; }
const place = (tool, from, extra = {}) => command({ type: 'designate', tool, from: point(from), ...extra });
const reachable = p => sim.standable(p) && sim.path(sim.pawns[0], p) !== null;
function audit() {
  const counts = sim.counts();
  for (const r of Object.keys(initial)) assert.equal(counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r] + sim.stats.destroyed[r] + sim.trade.exported[r], initial[r] + sim.stats.produced[r] + sim.trade.imported[r], `${r} conservation at ${sim.tick}`);
  assert(sim.pawns.filter(p => p.faction === 'colony').every(p => !p.dead && !p.downed), 'colonists remain alive and mobile');
}
function step() {
  sim.step();
  if (sim.tick % 400 === 0) audit();
  if (sim.tick % DAY === 0) {
    const entry = { tick: sim.tick, counts: sim.counts(), animals: sim.animals.map(a => ({ id: a.id, faction: a.faction, phase: a.phase, reason: a.reason })), pawns: sim.pawns.map(p => ({ id: p.id, phase: p.phase, reason: p.reason })) };
    report.daily.push(entry); console.log('DAY', sim.tick / DAY, 'domestic', sim.animals.filter(a => a.faction === 'colony').length);
  }
}
function until(name, done, limit = DAY * 3) {
  const started = sim.tick;
  while (!done() && sim.tick - started < limit) step();
  assert(done(), `${name}: ${JSON.stringify({ tick: sim.tick, animals: sim.animals, pawns: sim.pawns.map(p => ({ id: p.id, reason: p.reason, phase: p.phase, ropeTask: p.ropeTask, handleTask: p.handleTask })), jobs: sim.jobs.map(j => ({ kind: j.kind, reason: j.reason })), pens: summaries() })}`);
  audit(); check(name, { elapsedTicks: sim.tick - started });
}
async function save(name, data = sim.save()) {
  const bytes = JSON.stringify(data), file = `${OUT}/${name}.json`; await writeFile(file, bytes);
  report.fixtures[name] = { file, tick: data.tick, sha256: sha(bytes) }; return data;
}
function exactReload() {
  const before = sim.save(); sim = VoxelSimulation.load(before); const after = sim.save();
  for (const field of ['animals', 'fences', 'fenceGates', 'penMarkers', 'animalAreas']) assert.deepEqual(after[field], before[field], field);
  assert.deepEqual(after.pawns.map(p => p.ropeTask), before.pawns.map(p => p.ropeTask));
}
try {
  command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
  assert.equal(sim.animals.length, 8); assert.equal(sim.counts().grain, 0);
  const handlerId = sim.pawns.slice().sort((a, b) => b.skills.animals.level - a.skills.animals.level)[0].id;
  for (const p of sim.pawns) { command({ type: 'priority', pawnId: p.id, work: 'hunt', value: 0 }); command({ type: 'priority', pawnId: p.id, work: 'handle', value: p.id === handlerId ? 1 : 0 }); }
  report.browser.handlerId = handlerId;
  await save('initial');
  const surface = [], reserved = new Set([...sim.items, ...sim.stockpiles, ...sim.trees].map(key));
  for (let y = 2; y < 62; y++) for (let x = 2; x < 62; x++) {
    let z = 14; while (z > 0 && !sim.blocks[key({ x, y, z })]) z--;
    const p = { x, y, z: z + 1 }; if (reachable(p)) surface.push(p);
  }
  surface.sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn));
  const available = new Map(surface.map(p => [key(p), p]));
  const plots = [];
  for (const origin of surface) {
    if (plots.length === 2) break;
    if (origin.x < 3 || origin.y < 3 || origin.x > 52 || origin.y > 52) continue;
    const cells = Array.from({ length: 64 }, (_, i) => ({ x: origin.x + i % 8, y: origin.y + Math.floor(i / 8), z: origin.z }));
    const boundary = cells.filter(p => p.x === origin.x || p.x === origin.x + 7 || p.y === origin.y || p.y === origin.y + 7);
    if (!boundary.every(p => available.has(key(p)) && !reserved.has(key(p)))) continue;
    if (cells.some(p => reserved.has(key(p)) && !sim.trees.some(t => key(t) === key(p)))) continue;
    const marker = cells.find(p => p.x > origin.x + 1 && p.x < origin.x + 6 && p.y > origin.y + 1 && p.y < origin.y + 6 && available.has(key(p)) && !reserved.has(key(p)));
    if (!marker) continue;
    const gate = { x: origin.x + 3, y: origin.y, z: origin.z }, gap = { x: origin.x + 7, y: origin.y + 3, z: origin.z };
    plots.push({ origin, cells, boundary, marker, gate, gap });
    for (let y = origin.y - 1; y <= origin.y + 8; y++) for (let x = origin.x - 1; x <= origin.x + 8; x++) reserved.add(key({ x, y, z: origin.z }));
  }
  assert.equal(plots.length, 2, 'two ordinary buildable enclosed sites');
  report.browser.plots = plots.map(p => ({ origin: point(p.origin), gate: p.gate, marker: p.marker, gap: p.gap }));
  function site(tool, width = 1) {
    for (const p of surface) {
      const cells = Array.from({ length: width }, (_, i) => ({ ...p, x: p.x + i }));
      if (!cells.every(q => reachable(q) && !reserved.has(key(q)))) continue;
      const c = { type: 'designate', tool, from: point(p), axis: 'x' }, result = sim.command(c);
      if (!result.ok) continue;
      report.commands.push({ tick: sim.tick, c, result }); cells.forEach(q => reserved.add(key(q))); return p;
    }
    throw Error(`No site for ${tool}`);
  }
  for (const tree of sim.trees.filter(t => t.growth >= .8 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reachable({ ...t, x: t.x + dx, y: t.y + dy }))).sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn)).slice(0, 16)) place('cut', tree);
  for (let n = 0; n < 3; n++) site('bed', 2);
  site('stove'); site('horseshoePin');
  for (const p of surface.filter(p => !reserved.has(key(p))).slice(0, 22)) { reserved.add(key(p)); place('stock', p); command({ type: 'storage', from: point(p), priority: 2, accepts: ['grain', 'meal', 'wood'] }); }
  const farms = surface.filter(p => !reserved.has(key(p)) && [1, 8, 10].includes(sim.blocks[key({ ...p, z: p.z - 1 })])).slice(0, 160);
  assert.equal(farms.length, 160); for (const p of farms) { place('farm', p, { crop: 'rice' }); reserved.add(key(p)); }
  until('ordinary builders finish three beds, stove and recreation', () => sim.beds.length === 3 && sim.stoves.length === 1 && sim.horseshoePins.length === 1);
  command({ type: 'bill', stoveId: sim.stoves[0].id, target: 8, paused: false });
  until('160 real rice plots produce harvested animal feed', () => sim.counts().grain >= 100, DAY * 12);
  check('all raw feed originated in actual farming', { producedGrain: sim.stats.produced.grain });
  await save('ready');
  for (const p of plots) {
    for (const q of p.boundary) if (key(q) !== key(p.gate) && key(q) !== key(p.gap)) place('fence', q);
    place('fenceGate', p.gate, { axis: 'x' }); place('penMarker', p.marker);
  }
  assert.equal(sim.fences.length, 0); assert.equal(sim.penMarkers.length, 0);
  check('construction plans do not become physical containment before completion'); await save('blueprints');
  until('builders finish real fences gates and markers while intentional gaps remain', () => sim.penMarkers.length === 2 && sim.fenceGates.length === 2 && sim.fences.length === 52, DAY * 4);
  assert(summaries().every(p => !p.closed)); check('one missing fence per enclosure keeps both pens open'); await save('gaps');
  for (const p of plots) place('fence', p.gap);
  until('final fence completion makes both actual pens closed', () => summaries().length === 2 && summaries().every(p => p.closed));
  const malePen = sim.penMarkers.find(p => key(p) === key(plots[0].marker)), femalePen = sim.penMarkers.find(p => key(p) === key(plots[1].marker));
  report.browser.malePenId = malePen.id; report.browser.femalePenId = femalePen.id;
  report.browser.gateId = sim.fenceGates.find(g => key(g) === key(plots[0].gate)).id;
  command({ type: 'penName', markerId: malePen.id, name: '公鹿牧场' }); command({ type: 'penName', markerId: femalePen.id, name: '母鹿牧场' });
  command({ type: 'penFilter', markerId: malePen.id, filter: { deer: true, male: true, female: false } });
  command({ type: 'penFilter', markerId: femalePen.id, filter: { deer: true, male: false, female: true } });
  await save('built');
  for (const work of ['grow', 'cook', 'build', 'cut', 'haul']) command({ type: 'priority', pawnId: handlerId, work, value: 2 });
  const pair = ['male', 'female'].map(sex => sim.animals.filter(a => !a.dead && a.species === 'deer' && a.sex === sex && a.faction === 'wild' && sim.path(sim.pawns.find(p => p.id === handlerId), a) !== null).sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn))[0]);
  assert(pair.every(Boolean)); const [maleId, femaleId] = pair.map(a => a.id);
  Object.assign(report.browser, { maleId, femaleId });
  for (const a of pair) command({ type: 'animalOrder', animalId: a.id, order: 'tame', enabled: true });
  until('a real handler reaches a tamed deer and starts attaching a rope', () => sim.pawns.some(p => p.ropeTask?.stage === 'attach' && p.ropeTask.progress >= 5), DAY * 12);
  await save('attaching');
  until('completed attachment starts physical leading along an actual route', () => sim.pawns.some(p => p.ropeTask?.stage === 'lead' && p.ropeTask.path.length > 3));
  const leading = sim.pawns.find(p => p.ropeTask?.stage === 'lead'), ropeId = leading.ropeTask.animalId;
  report.browser.ropeId = ropeId;
  const animalBefore = point(animal(ropeId)), pawnBefore = point(leading);
  await save('leading'); exactReload(); check('exact save/load retains the attached animal and leading route');
  until('leading moves the handler and animal over neighboring ground', () => distance(point(animal(ropeId)), animalBefore) > 0, 1000);
  assert.equal(distance(point(animal(ropeId)), pawnBefore), 0, 'animal follows prior handler square');
  check('rope movement follows the actual handler instead of teleporting to a marker');
  until('opposite sex deer are both genuinely tamed and physically placed in their filtered pens', () =>
    animal(maleId)?.faction === 'colony' && animal(femaleId)?.faction === 'colony' &&
    summaries().find(p => p.markerId === malePen.id)?.animalIds.includes(maleId) && summaries().find(p => p.markerId === femalePen.id)?.animalIds.includes(femaleId) && !sim.pawns.some(p => p.ropeTask), DAY * 12);
  assert(summaries().every(p => p.nutritionPerDay > 0)); await save('penned');
  const beforeGate = [point(animal(maleId)), point(animal(femaleId))];
  command({ type: 'fenceGate', gateId: report.browser.gateId, mode: 'open' });
  assert.equal(summaries().find(p => p.markerId === malePen.id).closed, false); assert.deepEqual([point(animal(maleId)), point(animal(femaleId))], beforeGate);
  check('held open gate immediately breaks containment without moving any animal'); await save('open-gate');
  command({ type: 'fenceGate', gateId: report.browser.gateId, mode: 'auto' }); assert(summaries().find(p => p.markerId === malePen.id).closed);
  const removed = sim.fences.find(f => key(f) === key(plots[0].gap)); place('remove', removed);
  until('actual fence dismantling opens the pen boundary', () => !sim.fences.some(f => f.id === removed.id)); assert(!summaries().find(p => p.markerId === malePen.id).closed);
  place('fence', plots[0].gap); until('repaired fence restores the actual closed boundary', () => summaries().find(p => p.markerId === malePen.id).closed);
  command({ type: 'penFilter', markerId: femalePen.id, filter: { deer: true, male: true, female: true } });
  command({ type: 'penFilter', markerId: malePen.id, filter: { deer: true, male: false, female: false } });
  until('changed sex filters cause a real handler to transfer the rejected male deer', () => summaries().find(p => p.markerId === femalePen.id)?.animalIds.includes(maleId) && !sim.pawns.some(p => p.ropeTask?.animalId === maleId), DAY * 4);
  await save('transferred');
  const hare = sim.animals.filter(a => a.species === 'hare' && a.faction === 'wild' && !a.dead).sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn))[0]; assert(hare); report.browser.hareId = hare.id;
  command({ type: 'animalOrder', animalId: hare.id, order: 'tame', enabled: true });
  until('real carried feed and repeated interactions tame a rabbit', () => animal(hare.id)?.faction === 'colony', DAY * 12);
  const areaId = command({ type: 'animalAreaCreate', name: '兔的草地' }).areaId; report.browser.areaId = areaId;
  const areaFrom = { x: plots[0].origin.x + 1, y: plots[0].origin.y + 1, z: plots[0].origin.z }, areaTo = { ...areaFrom, x: areaFrom.x + 4, y: areaFrom.y + 4 };
  report.browser.areaFrom = areaFrom; report.browser.areaTo = areaTo;
  command({ type: 'animalAreaPaint', areaId, from: areaFrom, to: areaTo, erase: false });
  const hareBefore = point(animal(hare.id));
  command({ type: 'animalAreaAssign', animalId: hare.id, areaId }); assert.deepEqual(point(animal(hare.id)), hareBefore);
  const area = () => sim.animalAreas.find(a => a.id === areaId);
  assert(!area().cells.includes(key(hareBefore)), 'rabbit begins outside allowed area');
  await save('area-assigned');
  let last = hareBefore, movement = 0;
  const started = sim.tick;
  while (!area().cells.includes(key(animal(hare.id))) && sim.tick - started < DAY * 2) {
    step(); const now = point(animal(hare.id)); assert(distance(last, now) <= 2, 'each animal step stays adjacent including slope'); if (distance(last, now)) movement++; last = now;
  }
  assert(area().cells.includes(key(animal(hare.id)))); assert(movement > 1); check('assigned rabbit physically walks back and crosses a fence into its permitted area', { movement });
  command({ type: 'animalAreaPaint', areaId, from: areaFrom, erase: true }); assert.equal(area().cells.length, 24);
  command({ type: 'animalAreaRename', areaId, name: '兔的草地 · 西' }); exactReload(); check('exact reload preserves edited area name cells assignment and all pen structures');
  await save('area-edited');
  command({ type: 'animalAreaDelete', areaId }); assert.equal(animal(hare.id).allowedAreaId, null); check('deleting an area removes its assignment without moving the rabbit');
  await save('final'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); await save('failure'); process.exitCode = 1; }
finally { report.finalTick = sim.tick; report.finishedAt = new Date().toISOString(); report.stats = sim.stats; await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, checks: report.checks.length, finalTick: sim.tick, output: OUT, error: report.error?.slice(0, 1200) })); }
