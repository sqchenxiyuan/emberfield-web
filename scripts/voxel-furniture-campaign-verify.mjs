import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_FURNITURE_OUT ?? 'test-results/voxel-furniture';
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
const bundle = await build({ stdin: { contents: "export { VoxelSimulation } from './src/voxel/world'; export { furnitureStats } from './src/voxel/furniture'; export { furnitureMarketValue, colonyWealthDetails } from './src/voxel/wealth'; export { restGain } from './src/voxel/rest';", resolveDir: process.cwd(), sourcefile: 'furniture-campaign-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(`${OUT}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation, furnitureStats, furnitureMarketValue, colonyWealthDetails, restGain } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
let sim = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, rainfall: 1500, latitude: 0 });
const DAY = 12000, initial = sim.counts();
const point = p => ({ x: p.x, y: p.y, z: p.z }), key = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const colonists = () => sim.pawns.filter(p => p.faction === 'colony'), pawn = id => sim.pawns.find(p => p.id === id);
const objects = kind => sim[{ bed: 'beds', table: 'tables', chair: 'chairs' }[kind]];
const furnishing = () => ['bed', 'table', 'chair'].flatMap(kind => objects(kind).map(item => ({ kind, ...item })));
const inBed = (id, bedId) => { const p = pawn(id), b = sim.beds.find(b => b.id === bedId); return p.phase === 'rest' && p.sleepBedId === bedId && key(p) === key(b); };
const arrived = p => p.psyche.recreation?.kind === 'social' && !p.path.length && key(p) === key(p.psyche.recreation.target);
const report = { version: 33, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Fresh seed 73129. Only public player commands, ordinary simulation ticks and exact save/load mutate the colony. Terrain, paths, jobs and simulation state are read to select sites and record outcomes. Real timber, delivery, excavation, beds, table and chairs. Actual finishers are selected by normal build priorities. Naturally produced qualities are recorded without demanding different or high qualities. Actual sleep in two beds, actual seated dining and social recreation, room and colony wealth, and exact persistence. No need, skill, quality, furniture, position, terrain, clock or RNG injection. Threats and fire hazards are disabled with ordinary player controls. Controlled quality comparisons belong to mechanism tests.',
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await readFile(new URL(import.meta.url))), sourceManifestSha256: sha(manifest) },
  checks: [], commands: [], completions: [], observations: [], fixtures: {}, browser: {} };
const check = (name, detail = {}) => { report.checks.push({ name, tick: sim.tick, ...detail }); console.log('PASS', name, sim.tick); };
function command(c) { const r = sim.command(c); report.commands.push({ tick: sim.tick, c, r }); assert(r.ok, JSON.stringify({ c, r })); return r; }
const place = (tool, from, extra = {}) => command({ type: 'designate', tool, from: point(from), ...extra });
function audit() {
  const counts = sim.counts();
  for (const r of Object.keys(initial)) assert.equal(counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r] + sim.stats.destroyed[r] + sim.trade.exported[r], initial[r] + sim.stats.produced[r] + sim.trade.imported[r], `${r} ledger at ${sim.tick}`);
  assert(colonists().every(p => !p.dead && !p.downed), 'colonists remain alive and mobile');
  for (const item of furnishing()) assert(Number.isInteger(item.quality) && item.quality >= 0 && item.quality <= 6);
}
function step() {
  const before = sim.jobs.filter(j => ['bed', 'table', 'chair'].includes(j.kind)).map(j => ({ ...j, finisherBefore: j.owner === null ? null : structuredClone(pawn(j.owner)?.skills.construction) }));
  const known = new Set(furnishing().map(f => f.id)); sim.step();
  for (const item of furnishing().filter(f => !known.has(f.id))) {
    const job = before.find(j => j.kind === item.kind && key(j) === key(item));
    assert(job && job.owner !== null, 'completed furniture has a real final worker');
    report.completions.push({ tick: sim.tick, jobId: job.id, kind: item.kind, itemId: item.id, quality: item.quality,
      workerId: job.owner, before: job.finisherBefore, after: structuredClone(pawn(job.owner).skills.construction),
      previousProgress: job.progress, work: job.work, delivered: job.delivered, stats: furnitureStats(item.kind, item.quality), value: furnitureMarketValue(item.kind, item.quality) });
  }
  if (sim.tick % 300 === 0) { audit(); report.observations.push({ tick: sim.tick, pawns: colonists().map(p => ({ id: p.id, reason: p.reason, rest: p.rest, food: p.food, comfort: p.living.comfort })) }); }
  if (sim.tick % 6000 === 0) console.log('TIME', sim.tick, colonists().map(p => p.reason).join(' / '));
}
function until(name, done, limit = DAY * 3) {
  const start = sim.tick; while (!done() && sim.tick - start < limit) step();
  assert(done(), `${name}: ${JSON.stringify({ tick: sim.tick, people: colonists().map(p => ({ id: p.id, reason: p.reason, food: p.food, rest: p.rest })), jobs: sim.jobs.map(j => ({ kind: j.kind, reason: j.reason })) })}`);
  audit(); check(name, { elapsedTicks: sim.tick - start });
}
async function save(name) {
  const data = sim.save(), raw = JSON.stringify(data), file = `${OUT}/${name}.json`;
  await writeFile(file, raw); report.fixtures[name] = { file, tick: data.tick, sha256: sha(raw) }; return data;
}
function reloadExact() {
  const before = sim.save(); sim = VoxelSimulation.load(before); const after = sim.save();
  for (const field of ['beds', 'tables', 'chairs', 'fireDamage', 'items', 'stats']) assert.deepEqual(after[field], before[field], field);
  for (const field of ['living', 'psyche', 'cargo', 'skills']) assert.deepEqual(after.pawns.map(p => p[field]), before.pawns.map(p => p[field]), field);
  audit(); check('save and load preserve individual furniture quality settings and actual use');
}
const reserved = new Set();
function surfaceSite(tool, width = 1) {
  const sites = [];
  for (let y = 3; y < 61; y++) for (let x = 3; x < 61; x++) {
    let z = 14; while (z > 0 && !sim.blocks[key({ x, y, z })]) z--;
    const p = { x, y, z: z + 1 }; if (sim.standable(p)) sites.push(p);
  }
  sites.sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn));
  for (const p of sites) {
    const cells = Array.from({ length: width }, (_, i) => ({ ...p, x: p.x + i }));
    if (!cells.every(c => !reserved.has(key(c)) && sim.standable(c)) || sim.path(colonists()[0], p) === null) continue;
    const c = { type: 'designate', tool, from: p, axis: 'x' }, r = sim.command(c); if (!r.ok) continue;
    report.commands.push({ tick: sim.tick, c, r }); cells.forEach(c => reserved.add(key(c))); return p;
  }
  throw Error(`No surface site for ${tool}`);
}
function chooseBuilder(id) { for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'build', value: p.id === id ? 1 : 0 }); }
async function construct(kind, pos, axis, builderId) {
  chooseBuilder(builderId); const before = structuredClone(pawn(builderId).skills.construction); place(kind, pos, { axis });
  until(`selected builder completes actual ${kind}`, () => objects(kind).some(f => key(f) === key(pos)));
  const item = objects(kind).find(f => key(f) === key(pos)), receipt = report.completions.find(r => r.itemId === item.id);
  assert.equal(receipt.workerId, builderId); assert(pawn(builderId).skills.construction.xp > before.xp || pawn(builderId).skills.construction.level > before.level);
  check('actual finisher earns construction XP and fixes persisted quality', { ...receipt, skillAtDesignation: before }); return item;
}
try {
  await save('initial'); command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'hunt', value: 0 });
  for (const p of [...sim.items, ...sim.stockpiles, ...sim.trees]) reserved.add(key(p));
  for (let n = 0; sim.counts().wood < 300 && n < 32; n++) {
    const tree = sim.trees.filter(t => t.wood >= 8 && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => sim.path(colonists()[0], { ...t, x: t.x + dx, y: t.y + dy }) !== null)).sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn))[0];
    assert(tree, 'reachable timber'); place('cut', tree); until('ordinary worker harvests construction timber', () => !sim.trees.some(t => t.id === tree.id));
  }
  assert(sim.counts().wood >= 300);
  for (let i = 0; i < 16; i++) { const cell = surfaceSite('stock'); command({ type: 'storage', from: cell, priority: 2, accepts: ['chunk'] }); }
  for (let i = 0; i < 8; i++) { const cell = surfaceSite('stock'); command({ type: 'storage', from: cell, priority: 2, accepts: ['wood', 'food', 'meal'] }); }
  let shaft;
  for (let dx = -5; dx <= 4 && !shaft; dx++) for (let dy = -5; dy <= 4 && !shaft; dy++) {
    const p = { x: sim.spawn.x + dx, y: sim.spawn.y + dy, z: sim.spawn.z }, z = p.z - 3;
    if (reserved.has(key(p)) || !sim.standable(p) || sim.path(colonists()[0], p) === null) continue;
    const solid = Array.from({ length: 6 }, (_, x) => Array.from({ length: 5 }, (_, y) => [z - 1, z, z + 1, z + 2].every(h => sim.blocks[key({ x: p.x + x + 1, y: p.y + y - 2, z: h })] > 0))).flat().every(Boolean);
    if (!solid) continue; const c = { type: 'designate', tool: 'shaft', from: p }, r = sim.command(c);
    if (r.ok) { shaft = p; report.commands.push({ tick: sim.tick, c, r }); reserved.add(key(p)); }
  }
  assert(shaft, 'solid supported underground room site');
  const entrance = { x: shaft.x + 1, y: shaft.y, z: shaft.z - 3 }, corner = { x: shaft.x + 2, y: shaft.y - 2, z: entrance.z }, far = { x: corner.x + 4, y: corner.y + 4, z: corner.z };
  until('normal workers excavate the shaft', () => !sim.jobs.some(j => ['digLadder', 'ladder'].includes(j.kind)));
  place('mine', entrance); until('normal workers open the doorway', () => !sim.jobs.some(j => j.kind === 'mine'));
  place('mine', corner, { to: far }); until('normal workers excavate the room', () => !sim.jobs.some(j => j.kind === 'mine'));
  place('door', entrance, { axis: 'y' }); until('door encloses the naturally roofed chamber', () => sim.doors.some(d => key(d) === key(entrance)));
  const room = sim.rooms.roomAt(corner); assert(room && !room.outdoor); report.browser.roomPos = corner;
  const roomBefore = sim.livingRooms().find(r => r.id === room.id), wealthBefore = colonyWealthDetails(sim), filthBefore = sim.filth.filter(f => sim.rooms.roomAt(f)?.id === room.id).length;
  await save('room-ready');
  const builders = colonists().slice().sort((a, b) => a.skills.construction.level - b.skills.construction.level), low = builders[0].id, high = builders.at(-1).id;
  const bedA = await construct('bed', { ...corner, y: corner.y + 3 }, 'y', low);
  const bedB = await construct('bed', { ...corner, x: corner.x + 2, y: corner.y + 3 }, 'y', high);
  await construct('bed', { ...corner, x: corner.x + 4, y: corner.y + 3 }, 'y', high);
  const tablePos = { ...corner, x: corner.x + 1, y: corner.y + 1 }, table = await construct('table', tablePos, 'x', high);
  for (const c of [{ ...tablePos, y: tablePos.y - 1 }, { ...tablePos, y: tablePos.y + 1 }, { ...tablePos, x: tablePos.x + 1, y: tablePos.y + 1 }]) await construct('chair', c, 'x', high);
  for (const [i, b] of sim.beds.entries()) command({ type: 'bedOwner', bedId: b.id, pawnId: colonists()[i].id });
  const qualities = furnishing().map(f => ({ kind: f.kind, id: f.id, quality: f.quality, stats: furnitureStats(f.kind, f.quality), value: furnitureMarketValue(f.kind, f.quality) }));
  Object.assign(report.browser, { qualities, bedAId: bedA.id, bedBId: bedB.id, tableId: table.id, tablePos, chairIds: sim.chairs.map(c => c.id), pawnIds: colonists().map(p => p.id) });
  const roomAfter = sim.livingRooms().find(r => r.id === room.id), wealthAfter = colonyWealthDetails(sim), expectedValue = qualities.reduce((sum, f) => sum + f.value, 0);
  assert(Math.abs(roomAfter.wealth - roomBefore.wealth - expectedValue) < 1e-7);
  assert(Math.abs(wealthAfter.buildingSources.facilities - wealthBefore.buildingSources.facilities - expectedValue) < 1e-7);
  const filthAfter = sim.filth.filter(f => sim.rooms.roomAt(f)?.id === room.id).length, divisor = roomAfter.floorCells < 40 ? 20 + roomAfter.floorCells * .5 : roomAfter.floorCells;
  assert(Math.abs((roomAfter.beauty - roomBefore.beauty) * divisor - qualities.reduce((sum, f) => sum + f.stats.beauty, 0) + 2 * (filthAfter - filthBefore)) < 1e-7);
  check('natural individual quality contributes to real room beauty and room and colony value', { qualities, roomBefore, roomAfter, expectedValue });
  await save('furnished'); reloadExact();
  const sleeperId = colonists()[0].id; report.browser.sleeperId = sleeperId;
  until('ordinary activity lowers the sleep subject below manual-rest threshold', () => pawn(sleeperId).rest < 68 && pawn(sleeperId).phase !== 'rest');
  for (let hour = 0; hour < 24; hour++) command({ type: 'schedule', pawnId: sleeperId, hour, assignment: 'anything' });
  for (const [label, bedId] of [['a', bedA.id], ['b', bedB.id]]) {
    command({ type: 'bedOwner', bedId, pawnId: sleeperId }); command({ type: 'rest', pawnId: sleeperId });
    until(`same colonist reaches actual bed ${label}`, () => inBed(sleeperId, bedId));
    await save(`sleep-${label}`); reloadExact();
    const b = sim.beds.find(b => b.id === bedId), start = sim.tick, rest = pawn(sleeperId).rest, comfort = pawn(sleeperId).living.comfort, stats = furnitureStats('bed', b.quality);
    until(`actual bed ${label} sustains sleep`, () => sim.tick >= start + 30, 100);
    assert(inBed(sleeperId, bedId)); const gain = pawn(sleeperId).rest - rest;
    assert(Math.abs(gain - restGain(true, stats.restEffectiveness) * 30) < 1e-7);
    assert(Math.abs(pawn(sleeperId).living.comfort - Math.min(100, stats.comfort)) <= Math.abs(comfort - Math.min(100, stats.comfort)));
    check('actual sleep gain uses that particular bed quality', { label, bedId, quality: b.quality, restBefore: rest, restAfter: pawn(sleeperId).rest, comfortBefore: comfort, comfortAfter: pawn(sleeperId).living.comfort, stats });
  }
  // A normal work schedule wakes the person; explicit leisure still requires walking to a real chair.
  for (let hour = 0; hour < 24; hour++) command({ type: 'schedule', pawnId: sleeperId, hour, assignment: 'work' });
  until('ordinary work schedule wakes the actual sleeper', () => pawn(sleeperId).phase !== 'rest');
  command({ type: 'recreate', pawnId: sleeperId, kind: 'social' });
  until('actual chair is reached for table recreation', () => arrived(pawn(sleeperId)) && sim.chairs.some(c => key(c) === key(pawn(sleeperId))));
  report.browser.socialPawnId = sleeperId; report.browser.socialChairId = sim.chairs.find(c => key(c) === key(pawn(sleeperId))).id;
  await save('seated-social'); reloadExact();
  const socialStart = sim.tick, socialComfort = pawn(sleeperId).living.comfort;
  until('actual chair remains in use while comfort changes', () => sim.tick >= socialStart + 30, 100);
  assert(arrived(pawn(sleeperId))); const chair = sim.chairs.find(c => c.id === report.browser.socialChairId), cap = Math.min(100, furnitureStats('chair', chair.quality).comfort);
  assert(Math.abs(pawn(sleeperId).living.comfort - cap) <= Math.abs(socialComfort - cap));
  check('actual seated recreation applies its chair quality', { chairId: chair.id, quality: chair.quality, before: socialComfort, after: pawn(sleeperId).living.comfort, cap });
  command({ type: 'tableGathering', tableId: table.id, enabled: false });
  until('ordinary hunger brings a real meal to a real chair with gathering disabled', () => colonists().some(p => p.living.mealTask?.stage === 'chew' && p.living.mealTask.tableId === table.id && p.living.mealTask.chairId !== null));
  const diner = colonists().find(p => p.living.mealTask?.stage === 'chew' && p.living.mealTask.tableId === table.id && p.living.mealTask.chairId !== null);
  report.browser.dinerId = diner.id; report.browser.diningChairId = diner.living.mealTask.chairId;
  assert.equal(key(diner), key(sim.chairs.find(c => c.id === diner.living.mealTask.chairId)));
  await save('seated-meal'); reloadExact();
  const unchanged = furnishing().map(f => [f.id, f.quality]);
  command({ type: 'bedMedical', bedId: bedA.id, medical: true }); command({ type: 'bedMedical', bedId: bedA.id, medical: false });
  command({ type: 'bedPrisoner', bedId: bedA.id, prisoner: true }); command({ type: 'bedPrisoner', bedId: bedA.id, prisoner: false });
  command({ type: 'tableGathering', tableId: table.id, enabled: true }); command({ type: 'tableGathering', tableId: table.id, enabled: false });
  assert.deepEqual(furnishing().map(f => [f.id, f.quality]), unchanged);
  check('bed purpose prisoner designation and gathering controls preserve furniture quality');
  await save('final'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); await save('failure'); process.exitCode = 1; }
finally { report.finalTick = sim.tick; report.finishedAt = new Date().toISOString(); report.stats = sim.stats;
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, checks: report.checks.length, finalTick: sim.tick, output: OUT, error: report.error?.slice(0, 1800) })); }
