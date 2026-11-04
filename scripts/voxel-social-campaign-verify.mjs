import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_SOCIAL_OUT ?? 'test-results/voxel-social';
await mkdir(OUT, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) files.push(file);
  }
  return files.sort();
}
const manifest = JSON.stringify(await Promise.all((await sourceFiles('src')).map(async file => ({ file, sha256: sha(await readFile(file)) }))), null, 2);
await writeFile(`${OUT}/source-manifest.json`, manifest);
const bundle = await build({ stdin: { contents: "export { VoxelSimulation } from './src/voxel/world'; export { opinionOf, socialMemoryView, SOCIAL_RULES } from './src/voxel/social';", resolveDir: process.cwd(), sourcefile: 'social-campaign-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(`${OUT}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation, opinionOf, socialMemoryView, SOCIAL_RULES } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
let sim = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, rainfall: 1500, latitude: 0 });
const DAY = 12000, initial = sim.counts();
const point = p => ({ x: p.x, y: p.y, z: p.z }), key = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const eventKey = e => `${e.tick}:${e.initiatorId}`;
const colonists = () => sim.pawns.filter(p => p.faction === 'colony');
const pawn = id => sim.pawns.find(p => p.id === id);
const arrived = p => p.psyche.recreation?.kind === 'social' && !p.path.length && key(p) === key(p.psyche.recreation.target);
const report = { version: 32, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Fresh seed 73129. Only public player commands, ordinary simulation ticks and exact save/load mutate the colony. Terrain and simulation state are read to choose real construction sites and record outcomes. Real timber, tables, chairs and beds; automatic recreation scheduling and naturally selected social events. No position, need, opinion, event, memory, clock or RNG injection. Threats/fire hazards are disabled through ordinary player controls. Bounded play demonstrates integration; rare event coverage belongs to mechanism tests.',
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await readFile(new URL(import.meta.url))), sourceManifestSha256: sha(manifest) },
  checks: [], commands: [], observations: [], events: [], fixtures: {}, browser: {} };
const check = (name, detail = {}) => { report.checks.push({ name, tick: sim.tick, ...detail }); console.log('PASS', name, sim.tick); };
function command(c, expected = true) { const r = sim.command(c); report.commands.push({ tick: sim.tick, c, r }); assert.equal(r.ok, expected, JSON.stringify({ c, r })); return r; }
const place = (tool, from, extra = {}) => command({ type: 'designate', tool, from: point(from), ...extra });
function audit() {
  const counts = sim.counts();
  for (const resource of Object.keys(initial)) assert.equal(counts[resource] + sim.stats.consumed[resource] + sim.stats.spoiled[resource] + sim.stats.destroyed[resource] + sim.trade.exported[resource], initial[resource] + sim.stats.produced[resource] + sim.trade.imported[resource], `${resource} ledger at ${sim.tick}`);
  assert(colonists().every(p => !p.dead && !p.downed), 'colonists stay alive and mobile');
  const seats = colonists().flatMap(p => p.psyche.recreation?.kind === 'social' ? [key(p.psyche.recreation.target)] : p.living.mealTask?.chairId != null ? [key(p.living.mealTask.target)] : []);
  assert.equal(seats.length, new Set(seats).size, 'dining and social activity reserve distinct positions');
}
function step() {
  const known = new Set(sim.socialLog.map(eventKey)); sim.step();
  for (const event of sim.socialLog.filter(e => !known.has(eventKey(e)))) report.events.push({ ...event,
    parties: [event.initiatorId, event.recipientId].map(id => { const p = pawn(id); return { id, pos: point(p), phase: p.phase, arrived: arrived(p), recreation: structuredClone(p.psyche.recreation), social: structuredClone(p.social) }; }) });
  if (sim.tick % 300 === 0) { audit(); report.observations.push({ tick: sim.tick, pawns: colonists().map(p => ({ id: p.id, pos: point(p), phase: p.phase, reason: p.reason, joy: p.psyche.joy, recreation: p.psyche.recreation, memories: p.social.memories.length })) }); }
  if (sim.tick % 6000 === 0) console.log('TIME', sim.tick, colonists().map(p => p.reason).join(' / '));
}
function until(name, done, limit = DAY * 3) {
  const start = sim.tick; while (!done() && sim.tick - start < limit) step();
  assert(done(), `${name}: ${JSON.stringify({ tick: sim.tick, pawns: colonists().map(p => ({ id: p.id, reason: p.reason, food: p.food, rest: p.rest, psyche: p.psyche })), jobs: sim.jobs.map(j => ({ kind: j.kind, reason: j.reason })) })}`);
  audit(); check(name, { elapsedTicks: sim.tick - start });
}
async function save(name) {
  const data = sim.save(), raw = JSON.stringify(data), file = `${OUT}/${name}.json`;
  await writeFile(file, raw); report.fixtures[name] = { file, tick: data.tick, sha256: sha(raw) }; return data;
}
function reloadExact() {
  const before = sim.save(); sim = VoxelSimulation.load(before); const after = sim.save();
  for (const field of ['tables', 'chairs', 'socialHistory', 'socialLog', 'items', 'stats']) assert.deepEqual(after[field], before[field], field);
  for (const field of ['social', 'psyche', 'living', 'cargo']) assert.deepEqual(after.pawns.map(p => p[field]), before.pawns.map(p => p[field]), field);
  audit(); check('save and load preserve social identities memories events and activity exactly');
}
const reserved = new Set();
const allSurface = () => {
  const sites = [];
  for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) {
    let z = 14; while (z > 0 && !sim.blocks[key({ x, y, z })]) z--;
    const p = { x, y, z: z + 1 }; if (sim.standable(p)) sites.push(p);
  }
  return sites.sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn));
};
function surfaceSite(tool, width = 1) {
  for (const p of allSurface()) {
    const cells = Array.from({ length: width }, (_, i) => ({ ...p, x: p.x + i }));
    if (!cells.every(c => !reserved.has(key(c)) && sim.standable(c)) || sim.path(colonists()[0], p) === null) continue;
    const c = { type: 'designate', tool, from: p, axis: 'x' }, r = sim.command(c);
    if (!r.ok) continue; report.commands.push({ tick: sim.tick, c, r }); cells.forEach(c => reserved.add(key(c))); return p;
  }
  throw Error(`No surface site for ${tool}`);
}
try {
  await save('initial'); command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'hunt', value: 0 });
  for (const p of [...sim.items, ...sim.stockpiles, ...sim.trees]) reserved.add(key(p));
  for (let n = 0; sim.counts().wood < 260 && n < 32; n++) {
    const tree = sim.trees.filter(t => t.wood >= 8 && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => sim.path(colonists()[0], { ...t, x: t.x + dx, y: t.y + dy }) !== null)).sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn))[0];
    assert(tree, 'reachable timber'); place('cut', tree); until('ordinary worker harvests construction timber', () => !sim.trees.some(t => t.id === tree.id));
  }
  assert(sim.counts().wood >= 260);
  let tablePos, chairPositions;
  for (const p of allSurface()) {
    const area = Array.from({ length: 4 }, (_, x) => Array.from({ length: 3 }, (_, y) => ({ x: p.x + x - 1, y: p.y + y - 1, z: p.z }))).flat();
    if (!area.every(c => !reserved.has(key(c)) && sim.standable(c)) || sim.path(colonists()[0], p) === null) continue;
    const c = { type: 'designate', tool: 'table', from: p, axis: 'x' }, r = sim.command(c); if (!r.ok) continue;
    report.commands.push({ tick: sim.tick, c, r }); tablePos = p;
    chairPositions = [{ ...p, y: p.y - 1 }, { ...p, y: p.y + 1 }, { ...p, x: p.x + 1, y: p.y + 1 }];
    area.forEach(c => reserved.add(key(c))); break;
  }
  assert(tablePos, 'supported accessible table with circulation space');
  for (const p of chairPositions) place('chair', p, { axis: 'x' });
  for (let i = 0; i < 3; i++) surfaceSite('bed', 2);
  until('real timber becomes one table three chairs and three beds', () => sim.tables.length === 1 && sim.chairs.length === 3 && sim.beds.length === 3);
  for (const [i, bed] of sim.beds.entries()) command({ type: 'bedOwner', bedId: bed.id, pawnId: colonists()[i].id });
  const tableId = sim.tables[0].id;
  assert.equal(sim.tables[0].gathering, true);
  Object.assign(report.browser, { tableId, tablePos, chairPositions, pawnIds: colonists().map(p => p.id), bubbleTicks: SOCIAL_RULES.bubbleTicks });
  await save('furnished'); reloadExact();
  for (const p of colonists()) for (let hour = 6; hour < 22; hour++) command({ type: 'schedule', pawnId: p.id, hour, assignment: 'recreation' });
  await save('before-gathering');
  until('shared recreation schedules bring two people to the actual table automatically', () => colonists().filter(p => arrived(p) && !p.psyche.recreation.forced).length >= 2);
  await save('gathering');
  const a = colonists().find(arrived), joy = a.psyche.joy, comfort = a.living.comfort, start = sim.tick;
  until('real table relaxation raises joy after arrival', () => sim.tick >= start + 12 && pawn(a.id).psyche.joy > joy, 100);
  if (sim.chairs.some(c => key(c) === key(pawn(a.id)))) assert(pawn(a.id).living.comfort >= comfort, 'actual chair supports comfort');
  const after = sim.tick;
  until('two actual table users naturally interact', () => report.events.some(e => e.tick > after && e.parties.every(p => p.arrived && p.recreation.spotId === tableId)), DAY * 2);
  const event = report.events.findLast(e => e.tick > after && e.parties.every(p => p.arrived && p.recreation.spotId === tableId));
  report.browser.event = { tick: event.tick, kind: event.kind, initiatorId: event.initiatorId, recipientId: event.recipientId };
  assert(event.parties.every(p => distance(p.pos, event.parties[0].pos) <= SOCIAL_RULES.radius));
  const from = pawn(event.initiatorId), to = pawn(event.recipientId);
  assert(socialMemoryView(to.social, sim.tick, from.id).length > 0, 'recipient holds source-linked memory');
  check('event records real identities and directional opinion', { event: report.browser.event, forward: opinionOf(from.social, to.id, sim.tick), reverse: opinionOf(to.social, from.id, sim.tick) });
  await save('interaction'); reloadExact();
  const originalCount = sim.socialLog.filter(e => eventKey(e) === eventKey(event)).length;
  const savedTick = sim.tick; until('simulation advances past the short interaction receipt', () => sim.tick >= savedTick + SOCIAL_RULES.bubbleTicks + 1, 100);
  assert.equal(sim.socialLog.filter(e => eventKey(e) === eventKey(event)).length, originalCount);
  check('loading does not replay the old social event');
  const memoryBefore = structuredClone(colonists().map(p => p.social));
  command({ type: 'tableGathering', tableId, enabled: false });
  assert(colonists().every(p => p.psyche.recreation?.spotId !== tableId || p.psyche.recreation?.kind !== 'social'));
  assert.deepEqual(colonists().map(p => p.social), memoryBefore);
  command({ type: 'recreate', pawnId: from.id, kind: 'social' }, false);
  check('closing gathering ends table leisure and rejects unavailable explicit leisure without changing memories');
  await save('no-gathering');
  command({ type: 'tableGathering', tableId, enabled: true });
  for (const p of colonists()) {
    if (p.psyche.recreation) command({ type: 'cancelRecreation', pawnId: p.id });
    for (let hour = 6; hour < 22; hour++) command({ type: 'schedule', pawnId: p.id, hour, assignment: 'work' });
  }
  const away = allSurface().find(p => distance(p, tablePos) >= 8 && distance(p, tablePos) <= 12 && !reserved.has(key(p)) && sim.path(pawn(from.id), p) !== null);
  assert(away, 'reachable position away from the gathering table');
  command({ type: 'move', pawnId: from.id, target: away });
  until('ordinary movement takes the manual participant away from the table', () => key(pawn(from.id)) === key(away) && !pawn(from.id).path.length);
  report.browser.manualPawnId = from.id;
  await save('manual-ready');
  command({ type: 'recreate', pawnId: from.id, kind: 'social' });
  assert(pawn(from.id).path.length > 0, 'explicit table choice produces a real travel path');
  await save('manual-travel');
  until('explicit activity selection still requires actual arrival', () => arrived(pawn(from.id)));
  assert(pawn(from.id).psyche.recreation.forced); check('manual choice controls activity and never directly assigns opinion');
  await save('manual-arrived');
  command({ type: 'tableGathering', tableId, enabled: false });
  until('ordinary hunger still uses the dining table while gathering is disabled', () => colonists().some(p => p.living.mealTask?.stage === 'chew' && p.living.mealTask.tableId === tableId), DAY * 2);
  const diner = colonists().find(p => p.living.mealTask?.stage === 'chew' && p.living.mealTask.tableId === tableId);
  report.browser.dinerId = diner.id; const meal = structuredClone(diner.living.mealTask), cargo = structuredClone(diner.cargo);
  command({ type: 'tableGathering', tableId, enabled: true }); command({ type: 'tableGathering', tableId, enabled: false });
  assert.deepEqual(pawn(diner.id).living.mealTask, meal); assert.deepEqual(pawn(diner.id).cargo, cargo);
  check('gathering toggle preserves an ongoing physical meal'); await save('during-meal'); reloadExact();
  await save('final'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); await save('failure'); process.exitCode = 1; }
finally { report.finalTick = sim.tick; report.finishedAt = new Date().toISOString(); report.stats = sim.stats;
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, checks: report.checks.length, finalTick: sim.tick, output: OUT, error: report.error?.slice(0, 1800) })); }
