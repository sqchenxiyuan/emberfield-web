import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const out = process.env.VOXEL_SANITATION_OUT ?? 'test-results/voxel-sanitation';
await fs.mkdir(out, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
await fs.writeFile(`${out}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
const initialInventory = s.counts();
const point = p => ({ x: p.x, y: p.y, z: p.z });
const at = p => (p.z * 64 + p.y) * 64 + p.x;
const report = { version: 25, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Fresh world; public commands, elapsed ticks and save/load only. Spatial and disease state reads are observations. No injected filth, illness, food, skills, terrain, positions, clocks or RNG; this is a deterministic gameplay example, not a probability calibration.',
  baseline: { seed: 73129, settings: s.settings, initialInventory }, checks: [], commands: [], observations: [], fixtures: {},
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await fs.readFile(new URL(import.meta.url))) } };
const command = c => { const r = s.command(c); report.commands.push({ tick: s.tick, c, r }); assert(r.ok, JSON.stringify({ c, r })); return r; };
const check = (name, ok = true, detail = {}) => { report.checks.push({ name, ok: !!ok, tick: s.tick, detail }); assert(ok, name + ': ' + JSON.stringify(detail)); console.log('PASS', name, s.tick); };
function audit() {
  const counts = s.counts();
  for (const resource of Object.keys(initialInventory)) assert.equal(
    counts[resource] + s.stats.consumed[resource] + s.stats.spoiled[resource] + s.stats.destroyed[resource] + s.trade.exported[resource],
    initialInventory[resource] + s.stats.produced[resource] + s.trade.imported[resource], `${resource} physical ledger at ${s.tick}`);
}
const save = async name => { audit(); const bytes = JSON.stringify(s.save()); await fs.writeFile(`${out}/${name}.json`, bytes); report.fixtures[name] = { tick: s.tick, sha256: sha(bytes) }; };
function step() {
  s.step();
  assert(s.pawns.filter(p => p.faction === 'colony').every(p => !p.dead), 'The ordinary colony must survive');
  if (s.tick % 400 === 0) { audit(); report.observations.push({ tick: s.tick, filth: s.filth.length,
    cooked: s.stats.cooked, inventory: s.counts(), pawns: s.pawns.filter(p => p.faction === 'colony').map(p => ({ id: p.id,
      phase: p.phase, reason: p.reason, food: p.food, rest: p.rest, foodPoisoning: p.foodPoisoning })) }); }
}
function until(name, done, limit = 12000) {
  const start = s.tick;
  while (s.tick - start < limit && !done()) step();
  check(name, done(), { elapsed: s.tick - start, pawns: s.pawns.map(p => ({ id: p.id, phase: p.phase, reason: p.reason })),
    jobs: s.jobs.map(j => ({ kind: j.kind, reason: j.reason })) });
}
function site(tool) {
  for (let radius = 2; radius <= 8; radius++) for (let dx = -radius; dx <= radius; dx++) for (const dy of [-radius, radius]) {
    const from = { x: s.spawn.x + dx, y: s.spawn.y + dy, z: s.spawn.z };
    if (!s.standable(from)) continue;
    const c = { type: 'designate', tool, from }, r = s.command(c);
    if (r.ok) { report.commands.push({ tick: s.tick, c, r }); return from; }
  }
  throw Error('No valid site: ' + tool);
}
try {
  await save('initial'); command({ type: 'threats', enabled: false });
  for (const p of s.pawns) {
    command({ type: 'priority', pawnId: p.id, work: 'clean', value: 0 });
    command({ type: 'priority', pawnId: p.id, work: 'hunt', value: 0 });
  }
  // Gather actual timber before starting the underground kitchen and normal beds.
  for (let n = 0; s.counts().wood < 280 && n < 24; n++) {
    const tree = s.trees.filter(t => t.wood >= 8 && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) =>
      s.path(s.pawns[0], { x: t.x + dx, y: t.y + dy, z: t.z }) !== null))
      .sort((a, b) => Math.hypot(a.x-s.spawn.x,a.y-s.spawn.y)-Math.hypot(b.x-s.spawn.x,b.y-s.spawn.y))[0];
    assert(tree, 'Reachable timber'); command({ type: 'designate', tool: 'cut', from: point(tree) });
    until('harvest real construction timber', () => !s.trees.some(t => t.id === tree.id));
  }
  let shaft;
  for (let x = s.spawn.x - 3; x <= s.spawn.x + 3 && !shaft; x++) for (let y = s.spawn.y - 3; y <= s.spawn.y + 3 && !shaft; y++) {
    const p = { x, y, z: s.spawn.z }, z = p.z - 3;
    if (!s.standable(p) || s.path(s.pawns[0], p) === null || s.trees.some(q => at(q) === at(p))) continue;
    if (!Array.from({ length: 4 }, (_, dx) => [0, 1, 2].every(dy => [z, z+1, z+2].every(h => s.blocks[at({ x: x+1+dx, y: y-1+dy, z: h })] > 0))).every(Boolean)) continue;
    const c = { type: 'designate', tool: 'shaft', from: p }, r = s.command(c);
    if (r.ok) { shaft = p; report.commands.push({ tick: s.tick, c, r }); }
  }
  assert(shaft, 'Supported shaft site');
  const entrance = { x: shaft.x + 1, y: shaft.y, z: shaft.z - 3 };
  const corner = { x: shaft.x + 2, y: shaft.y - 1, z: entrance.z };
  const far = { x: shaft.x + 3, y: shaft.y + 1, z: entrance.z };
  until('excavate three-level shaft', () => !s.jobs.some(j => ['digLadder', 'ladder'].includes(j.kind)));
  command({ type: 'designate', tool: 'mine', from: entrance });
  until('excavate kitchen entrance', () => !s.jobs.some(j => j.kind === 'mine'));
  command({ type: 'designate', tool: 'mine', from: corner, to: far });
  until('excavate real six-cell underground kitchen', () => !s.jobs.some(j => j.kind === 'mine'));
  command({ type: 'designate', tool: 'door', from: entrance });
  command({ type: 'designate', tool: 'stove', from: corner });
  command({ type: 'designate', tool: 'butcherSpot', from: far });
  until('construct kitchen from real delivered timber', () => s.stoves.length === 1 && s.doors.length === 1);
  check('kitchen is an enclosed room', !s.rooms.roomAt(corner)?.outdoor);
  report.kitchen = { corner, far, entrance, stoveId: s.stoves[0].id, butcherId: s.butcherSpots[0].id };
  command({ type: 'homeArea', from: corner, to: far, enabled: false });
  for (let i = 0; i < 3; i++) site('bed');
  until('build beds for ordinary rest', () => s.beds.length === 3);
  site('craftingSpot');
  command({ type: 'weaponBill', benchId: s.weaponBenches[0].id, kind: 'shortBow', target: 1, paused: false });
  until('craft a physical hunting bow', () => s.items.some(i => i.weapon?.kind === 'shortBow'));
  const hunterId = s.pawns[0].id, cookId = s.pawns[2].id, cleanerId = s.pawns[1].id;
  report.people = { hunterId, cookId, cleanerId };
  const bowId = s.items.find(i => i.weapon?.kind === 'shortBow').weapon.id;
  command({ type: 'equipWeapon', pawnId: hunterId, weaponId: bowId });
  until('hunter actually equips bow', () => s.pawns.find(p => p.id === hunterId).weapon?.id === bowId);
  for (const p of s.pawns) {
    command({ type: 'priority', pawnId: p.id, work: 'hunt', value: p.id === hunterId ? 1 : 0 });
    command({ type: 'priority', pawnId: p.id, work: 'cook', value: p.id === cookId ? 1 : 0 });
  }
  command({ type: 'bill', stoveId: s.stoves[0].id, target: 10, paused: false });
  // Sustainable food follows the same actual farming loop as player colonies.
  for (let dy = -12; dy <= 14 && s.farms.length < 128; dy++) for (let dx = -12; dx <= 14 && s.farms.length < 128; dx++) {
    for (let z = 14; z >= 1; z--) {
      const from = { x: s.spawn.x + dx, y: s.spawn.y + dy, z };
      if (!s.standable(from) || s.trees.some(t => at(t) === at(from)) || s.path(s.pawns[1], from) === null) continue;
      const c = { type: 'designate', tool: 'farm', crop: 'rice', from }, r = s.command(c);
      if (r.ok) report.commands.push({ tick: s.tick, c, r });
      break;
    }
  }
  check('ordinary rice plots provide follow-up food', s.farms.length >= 100, { plots: s.farms.length });
  const prey = s.animals.filter(a => !a.dead).sort((a, b) => (a.species === 'deer' ? -1 : 1) - (b.species === 'deer' ? -1 : 1));
  for (const a of prey.slice(0, 4)) command({ type: 'hunt', animalId: a.id, enabled: true });
  until('real hunting and butchery leave kitchen filth', () => s.filth.some(f => f.kind === 'butcher' && f.z === corner.z), 24000);
  await save('dirty-kitchen');
  const dirtyIds = s.filth.filter(f => f.z === corner.z).map(f => f.id);
  command({ type: 'priority', pawnId: cleanerId, work: 'clean', value: 1 });
  const waitUntil = s.tick + 300;
  until('cleaning work respects excluded home area', () => s.tick >= waitUntil);
  check('excluded kitchen dirt was not automatically removed', dirtyIds.some(id => s.filth.some(f => f.id === id)));
  command({ type: 'priority', pawnId: cleanerId, work: 'clean', value: 0 });
  await save('ready');
  until('a naturally cooked and eaten meal produces food poisoning', () => s.pawns.some(p => p.faction === 'colony' && p.foodPoisoning), 12000 * 22);
  const patientId = s.pawns.find(p => p.faction === 'colony' && p.foodPoisoning).id;
  report.patientId = patientId;
  const illness = structuredClone(s.pawns.find(p => p.id === patientId).foodPoisoning);
  check('illness follows actual meal consumption', s.stats.consumed.meal > 0 && s.stats.cooked > 0, { illness });
  await save('poisoned');
  s = VoxelSimulation.load(s.save());
  check('illness deadline survives save without reroll', JSON.stringify(s.pawns.find(p => p.id === patientId).foodPoisoning) === JSON.stringify(illness));
  command({ type: 'bill', stoveId: s.stoves[0].id, target: 10, paused: true });
  until('ordinary time approaches the first vomiting episode', () => s.tick >= illness.nextVomitTick - 120);
  await save('vomit-ready');
  command({ type: 'butcherBill', spotId: s.butcherSpots[0].id, paused: true });
  command({ type: 'homeArea', from: corner, to: far, enabled: true });
  command({ type: 'priority', pawnId: cleanerId, work: 'clean', value: 1 });
  const beforeClean = s.cleanlinessAt(corner);
  until('cleaner physically reaches and works on dirt', () => s.pawns.some(p => p.cleanTask?.progress > 0));
  await save('cleaning');
  const cleaning = structuredClone(s.pawns.find(p => p.cleanTask?.progress > 0).cleanTask);
  s = VoxelSimulation.load(s.save());
  check('in-progress cleaning survives save', s.pawns.some(p => p.cleanTask?.filthId === cleaning.filthId && p.cleanTask.progress === cleaning.progress));
  until('cleaning removes the actual kitchen stains', () => !s.filth.some(f => f.z === corner.z && f.x >= corner.x && f.x <= far.x && f.y >= corner.y && f.y <= far.y), 24000);
  check('physical cleaning improves the same room cleanliness', s.cleanlinessAt(corner) > beforeClean, { before: beforeClean, after: s.cleanlinessAt(corner) });
  await save('cleaned');
  // Existing meals are still physical food. Reingestion can prolong illness;
  // stopping production does not retroactively turn those meals into safe food.
  const recoveryLimit = Math.max(36000, illness.endsTick - s.tick + 6000);
  until('ordinary time reaches the final recovery window', () => {
    const q = s.pawns.find(p => p.id === patientId);
    return q.foodPoisoning === null || q.foodPoisoning.endsTick - s.tick <= 240;
  }, recoveryLimit);
  await save('recovery-ready');
  until('patient naturally recovers from the consumed meal', () => !s.pawns.find(p => p.id === patientId).foodPoisoning, recoveryLimit);
  check('three-person colony remains alive after illness and cleanup', s.pawns.filter(p => p.faction === 'colony').every(p => !p.dead && !p.downed));
  await save('recovered');
  s = VoxelSimulation.load(s.save()); s.step(100);
  check('saved colony continues after recovery', s.pawns.filter(p => p.faction === 'colony').every(p => !p.dead));
  await save('final'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); await save('failure'); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); report.finalTick = s.tick; await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, checks: report.checks.length, tick: s.tick, error: report.error })); }
