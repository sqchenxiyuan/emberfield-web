import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_LIVING_OUT ?? 'test-results/voxel-living';
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
const sourceManifest = await Promise.all((await sourceFiles('src')).map(async file => ({ file, sha256: sha(await readFile(file)) })));
const manifestBytes = JSON.stringify(sourceManifest, null, 2);
await writeFile(`${OUT}/source-manifest.json`, manifestBytes);
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(`${OUT}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
let sim = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, rainfall: 1500, latitude: 0 });
const initial = sim.counts(), DAY = 12000;
const point = p => ({ x: p.x, y: p.y, z: p.z }), key = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const report = { version: 31, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Fresh seed 73129. Only public player commands, ordinary ticks and exact save/load mutate the colony. Terrain, paths and simulation state are read to choose construction sites and record outcomes. Real timber, crafted hunting bow, hunted carcasses, butchered meat and cooked meals. No food, need, comfort, thought, terrain, pawn-position, clock or RNG injection. Bounded deterministic play, not numerical calibration.',
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await readFile(new URL(import.meta.url))), sourceManifestSha256: sha(manifestBytes) },
  checks: [], commands: [], fixtures: {}, observations: [], browser: {} };
const colonists = () => sim.pawns.filter(p => p.faction === 'colony');
const pawn = id => sim.pawns.find(p => p.id === id);
const check = (name, detail = {}) => { report.checks.push({ name, tick: sim.tick, ...detail }); console.log('PASS', name, sim.tick); };
function command(c) { const r = sim.command(c); report.commands.push({ tick: sim.tick, c, r }); assert(r.ok, JSON.stringify({ c, r })); return r; }
const place = (tool, from, extra = {}) => command({ type: 'designate', tool, from: point(from), ...extra });
function audit() {
  const counts = sim.counts();
  for (const r of Object.keys(initial)) assert.equal(counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r] + sim.stats.destroyed[r] + sim.trade.exported[r], initial[r] + sim.stats.produced[r] + sim.trade.imported[r], `${r} ledger at ${sim.tick}`);
  assert(colonists().every(p => !p.dead && !p.downed), 'colonists stay alive and mobile');
  const claims = colonists().map(p => p.living.mealTask?.chairId).filter(id => id != null);
  assert.equal(claims.length, new Set(claims).size, 'meal travel and chewing reserve exclusive chairs');
}
function step() {
  sim.step();
  if (sim.tick % 6000 === 0) console.log('TIME', sim.tick, JSON.stringify({ tables: sim.tables.length, chairs: sim.chairs.length, beds: sim.beds.length, cooked: sim.stats.cooked, jobs: sim.jobs.map(j => ({ kind: j.kind, reason: j.reason })), people: colonists().map(p => p.reason) }));
  if (sim.tick % 300 === 0) { audit(); report.observations.push({ tick: sim.tick, cooked: sim.stats.cooked,
    pawns: colonists().map(p => ({ id: p.id, phase: p.phase, food: p.food, rest: p.rest, comfort: p.living.comfort, meal: p.living.mealTask, memories: p.living.memories })) }); }
}
function until(name, done, limit = DAY * 3) {
  const start = sim.tick;
  while (!done() && sim.tick - start < limit) step();
  assert(done(), `${name}: ${JSON.stringify({ tick: sim.tick, pawns: colonists().map(p => ({ id: p.id, reason: p.reason, living: p.living })), jobs: sim.jobs.map(j => ({ kind: j.kind, reason: j.reason })) })}`);
  audit(); check(name, { elapsedTicks: sim.tick - start });
}
async function save(name) {
  const data = sim.save(), raw = JSON.stringify(data), file = `${OUT}/${name}.json`;
  await writeFile(file, raw); report.fixtures[name] = { file, tick: data.tick, sha256: sha(raw) }; return data;
}
function reloadExact() {
  const before = sim.save(); sim = VoxelSimulation.load(before); const after = sim.save();
  for (const field of ['tables', 'chairs', 'items', 'stats']) assert.deepEqual(after[field], before[field], field);
  assert.deepEqual(after.pawns.map(p => p.living), before.pawns.map(p => p.living), 'living state exact on load');
  assert.deepEqual(after.pawns.map(p => p.cargo), before.pawns.map(p => p.cargo), 'physical meal exact on load'); audit();
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
    const c = { type: 'designate', tool, from: p, axis: 'x' }, r = sim.command(c);
    if (!r.ok) continue;
    report.commands.push({ tick: sim.tick, c, r }); cells.forEach(c => reserved.add(key(c))); return p;
  }
  throw Error(`No surface site for ${tool}`);
}
try {
  await save('initial'); command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'hunt', value: 0 });
  for (const p of [...sim.items, ...sim.stockpiles, ...sim.trees]) reserved.add(key(p));
  for (let n = 0; sim.counts().wood < 420 && n < 32; n++) {
    const tree = sim.trees.filter(t => t.wood >= 8 && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) =>
      sim.path(colonists()[0], { ...t, x: t.x + dx, y: t.y + dy }) !== null))
      .sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn))[0];
    assert(tree, 'reachable timber'); place('cut', tree);
    until('ordinary worker harvests construction timber', () => !sim.trees.some(t => t.id === tree.id));
  }
  assert(sim.counts().wood >= 420);
  // Leave tables absent until one real meal has been eaten, without altering needs.
  until('ordinary hunger starts sustained no-table eating', () => colonists().some(p => p.living.mealTask?.stage === 'chew' && p.living.mealTask.tableId === null));
  report.browser.noTablePawnId = colonists().find(p => p.living.mealTask?.stage === 'chew').id;
  const oldNoTableExpiry = pawn(report.browser.noTablePawnId).living.memories.find(m => m.kind === 'ateWithoutTable')?.expires ?? 0;
  await save('no-table-chewing');
  until('finished meal creates or refreshes the actual no-table memory', () => pawn(report.browser.noTablePawnId).living.memories.some(m => m.kind === 'ateWithoutTable' && m.expires > oldNoTableExpiry));
  await save('without-table'); reloadExact();
  for (let i = 0; i < 16; i++) {
    const cell = surfaceSite('stock'); command({ type: 'storage', from: cell, priority: 2, accepts: ['chunk'] });
  }
  for (let i = 0; i < 8; i++) {
    const cell = surfaceSite('stock'); command({ type: 'storage', from: cell, priority: 2, accepts: ['wood', 'meat', 'carcass', 'meal'] });
  }

  let shaft;
  for (let dx = -5; dx <= 4 && !shaft; dx++) for (let dy = -5; dy <= 4 && !shaft; dy++) {
    const p = { x: sim.spawn.x + dx, y: sim.spawn.y + dy, z: sim.spawn.z }, z = p.z - 3;
    if (reserved.has(key(p)) || !sim.standable(p) || sim.path(colonists()[0], p) === null) continue;
    const solid = Array.from({ length: 6 }, (_, x) => Array.from({ length: 5 }, (_, y) =>
      [z - 1, z, z + 1, z + 2].every(h => sim.blocks[key({ x: p.x + x + 1, y: p.y + y - 2, z: h })] > 0))).flat().every(Boolean);
    if (!solid) continue;
    const c = { type: 'designate', tool: 'shaft', from: p }, r = sim.command(c);
    if (r.ok) { shaft = p; report.commands.push({ tick: sim.tick, c, r }); reserved.add(key(p)); }
  }
  assert(shaft, 'solid supported underground room site');
  const entrance = { x: shaft.x + 1, y: shaft.y, z: shaft.z - 3 };
  const corner = { x: shaft.x + 2, y: shaft.y - 2, z: entrance.z };
  const far = { x: corner.x + 4, y: corner.y + 4, z: corner.z };
  until('normal workers excavate the shaft', () => !sim.jobs.some(j => ['digLadder', 'ladder'].includes(j.kind)));
  place('mine', entrance); until('normal workers open the doorway', () => !sim.jobs.some(j => j.kind === 'mine'));
  place('mine', corner, { to: far }); until('normal workers excavate the room', () => !sim.jobs.some(j => j.kind === 'mine'));
  place('door', entrance, { axis: 'y' }); until('door encloses the naturally roofed chamber', () => sim.doors.some(d => key(d) === key(entrance)));
  const room = sim.rooms.roomAt(corner); assert(room && !room.outdoor);
  check('physical room is enclosed and roofed', { room }); report.browser.roomPos = corner;
  const tablePos = { ...corner, x: corner.x + 1, y: corner.y + 1 };
  const chairPositions = [{ ...tablePos, y: tablePos.y - 1 }, { ...tablePos, y: tablePos.y + 1 }, { ...tablePos, x: tablePos.x + 1, y: tablePos.y + 1 }];
  report.browser.tablePos = tablePos; report.browser.chairPositions = chairPositions;
  report.browser.previewPos = { ...corner, x: corner.x + 3, y: corner.y + 1 };
  await save('ready');
  place('table', tablePos, { axis: 'x' }); for (const c of chairPositions) place('chair', c, { axis: 'x' });
  for (let i = 0; i < 3; i++) place('bed', { ...corner, x: corner.x + i * 2, y: corner.y + 3 }, { axis: 'y' });
  until('delivered wood becomes a table three chairs and beds', () => sim.tables.length === 1 && sim.chairs.length === 3 && sim.beds.length === 3);
  report.browser.tableId = sim.tables[0].id; report.browser.chairIds = sim.chairs.map(c => c.id);
  for (const [i, bed] of sim.beds.entries()) command({ type: 'bedOwner', bedId: bed.id, pawnId: colonists()[i].id });
  await save('furnished'); reloadExact();

  surfaceSite('craftingSpot'); surfaceSite('butcherSpot'); surfaceSite('stove'); surfaceSite('horseshoePin');
  command({ type: 'weaponBill', benchId: sim.weaponBenches.find(b => b.kind === 'craftingSpot').id, kind: 'shortBow', target: 1, paused: false });
  until('ordinary crafter completes a physical hunting bow', () => sim.items.some(i => i.weapon?.kind === 'shortBow'));
  const hunterId = colonists().slice().sort((a, b) => b.skills.shooting.level - a.skills.shooting.level)[0].id;
  const bowId = sim.items.find(i => i.weapon?.kind === 'shortBow').weapon.id;
  command({ type: 'equipWeapon', pawnId: hunterId, weaponId: bowId }); until('hunter fetches and equips bow', () => pawn(hunterId).weapon?.id === bowId);
  until('ordinary builders complete the stove', () => sim.stoves.length === 1);
  command({ type: 'bill', stoveId: sim.stoves[0].id, target: 8, paused: false });
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'hunt', value: p.id === hunterId ? 1 : 0 });
  for (const a of sim.animals.filter(a => !a.dead).sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn)).slice(0, 3)) command({ type: 'hunt', animalId: a.id, enabled: true });
  until('hunting butchery and cooking produce real meals', () => sim.stats.produced.carcass > 0 && sim.stats.produced.meat > 0 && sim.stats.cooked > 0);
  until('colonist physically carries a cooked meal toward a reserved seat', () => colonists().some(p => p.eating === 'meal' && p.cargo?.resource === 'meal' && p.living.mealTask?.stage === 'travel' && p.living.mealTask.chairId !== null));
  const dinerId = colonists().find(p => p.eating === 'meal' && p.living.mealTask?.stage === 'travel').id; report.browser.dinerId = dinerId;
  await save('carrying-meal'); reloadExact();
  until('diner arrives at chair with the same physical meal', () => pawn(dinerId).living.mealTask?.stage === 'chew' && pawn(dinerId).living.mealTask.chairId !== null);
  const beforeComfort = pawn(dinerId).living.comfort, mealBefore = sim.stats.consumed.meal;
  const occupiedChair = pawn(dinerId).living.mealTask.chairId;
  assert.equal(key(pawn(dinerId)), key(sim.chairs.find(c => c.id === occupiedChair)));
  await save('seated-meal'); reloadExact();
  const seatedTick = sim.tick; until('sustained seated eating advances before consumption', () => sim.tick >= seatedTick + 30);
  assert(pawn(dinerId).living.comfort > beforeComfort, 'using chair raises actual comfort');
  assert(pawn(dinerId).living.mealTask?.stage === 'chew');
  until('meal is consumed only after the chewing interval', () => sim.stats.consumed.meal > mealBefore);
  await save('after-meal');
  until('normal sleep creates a bedroom or barracks memory', () => colonists().some(p => p.living.memories.some(m => ['bedroom', 'barracks'].includes(m.kind))));
  const sleeper = colonists().find(p => p.living.memories.some(m => ['bedroom', 'barracks'].includes(m.kind))); report.browser.sleeperId = sleeper.id;
  await save('sleep-memory'); reloadExact();
  assert(sim.snapshot().roomLiving.some(r => r.id === sim.rooms.roomAt(corner)?.id && ['bedroom', 'barracks'].includes(r.role)));
  check('room role and experience derive from built furniture and actual sleep');
  until('another actual seat reservation is available for dismantling', () => colonists().some(p => p.living.mealTask?.chairId != null));
  await save('before-removal');
  const victim = colonists().find(p => p.living.mealTask?.chairId != null), removedId = victim.living.mealTask.chairId;
  place('remove', sim.chairs.find(c => c.id === removedId));
  until('ordinary worker dismantles the reserved chair', () => !sim.chairs.some(c => c.id === removedId));
  assert(colonists().every(p => p.living.mealTask?.chairId !== removedId));
  check('removed chair leaves no stale seat ownership and preserves physical inventory');
  await save('final'); report.status = 'passed';
} catch (error) { report.error = String(error.stack ?? error); report.status = 'failed'; await save('failure'); process.exitCode = 1; }
finally { report.finalTick = sim.tick; report.finishedAt = new Date().toISOString(); report.stats = sim.stats;
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, checks: report.checks.length, finalTick: sim.tick, output: OUT, error: report.error?.slice(0, 1600) })); }
