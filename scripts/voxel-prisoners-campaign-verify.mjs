import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const out = 'test-results/voxel-prisoners';
await fs.mkdir(out, { recursive: true });
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
await fs.writeFile(`${out}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
const report = { scope: 'Fresh v24 world; public commands, elapsed ticks and save/load only. No injected enemies, health, items, buildings, positions or resistance.', baseline: { seed:73129, settings: s.settings }, checks: [], commands: [], observations: [], fixtures: {} };
report.execution = { bundleSha256: createHash('sha256').update(bundle.outputFiles[0].contents).digest('hex'),
  scriptSha256: createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex') };
let prisonerId = null;
const prisoner = () => s.pawns.find(p => p.id === prisonerId);
const point = p => ({ x: p.x, y: p.y, z: p.z });
const at = p => (p.z * 64 + p.y) * 64 + p.x;
const command = c => { const r = s.command(c); report.commands.push({ tick: s.tick, c, r }); assert(r.ok, JSON.stringify({ c, r })); return r; };
const check = (name, ok = true, detail = {}) => { report.checks.push({ name, ok: !!ok, tick: s.tick, detail }); assert(ok, name); console.log('PASS', name, s.tick); };
const save = async name => { const bytes = JSON.stringify(s.save()); await fs.writeFile(`${out}/${name}.json`, bytes); report.fixtures[name] = { tick: s.tick, sha256: createHash('sha256').update(bytes).digest('hex') }; };
function until(name, done, limit = 12000) {
  for (let t = 0; t < limit && !done(); t++) {
    s.step();
    if (s.tick % 400 === 0) report.observations.push({ tick: s.tick, pawns: s.pawns.map(p => ({ id: p.id, faction: p.faction, dead: p.dead, downed: p.downed, phase: p.phase, reason: p.reason, food: p.food, rest: p.rest, resistance: p.prisoner?.resistance })) });
    if (prisonerId !== null) assert(prisoner() && !prisoner().dead, 'The actual raider must survive the scenario');
  }
  check(name, done(), { people: s.pawns.map(p => ({ id: p.id, phase: p.phase, reason: p.reason })), jobs: s.jobs.map(j => ({ kind: j.kind, reason: j.reason, progress: j.progress })) });
}
try {
  await save('initial');
  command({ type: 'threats', enabled: false });
  for (const p of s.pawns.filter(p => p.faction === 'colony')) {
    if (p.drafted) command({ type: 'draft', pawnId: p.id, drafted: false });
    for (const work of Object.keys(p.priorities)) command({ type: 'priority', pawnId: p.id, work, value: ['dig', 'build'].includes(work) ? 1 : 0 });
  }
  // Build a small real underground cell. Read-only spatial inspection chooses a clear shaft site.
  let shaft;
  for (let x = s.spawn.x - 3; x <= s.spawn.x + 3 && !shaft; x++) for (let y = s.spawn.y - 3; y <= s.spawn.y + 3 && !shaft; y++) {
    const p = { x, y, z: s.spawn.z }, z = p.z - 3;
    if (!s.standable(p) || s.path(s.pawns.find(p => !p.downed), p) === null || s.trees.some(q => at(q) === at(p))) continue;
    if (!Array.from({ length: 4 }, (_, dx) => [0, 1, 2].every(dy => [z, z + 1, z + 2].every(h => s.blocks[at({ x: x + 1 + dx, y: y - 1 + dy, z: h })] > 0))).every(Boolean)) continue;
    const r = s.command({ type: 'designate', tool: 'shaft', from: p });
    if (r.ok) { shaft = p; report.commands.push({ tick: s.tick, c: { type: 'designate', tool: 'shaft', from: p }, r }); }
  }
  assert(shaft, 'Reachable supported shaft site');
  const entrance = { x: shaft.x + 1, y: shaft.y, z: shaft.z - 3 };
  until('excavate a real three-level shaft', () => !s.jobs.some(j => ['digLadder', 'ladder'].includes(j.kind)));
  command({ type: 'designate', tool: 'mine', from: entrance });
  until('excavate cell entrance', () => !s.jobs.some(j => j.kind === 'mine'));
  command({ type: 'designate', tool: 'mine', from: { x: shaft.x + 2, y: shaft.y - 1, z: entrance.z }, to: { x: shaft.x + 3, y: shaft.y + 1, z: entrance.z } });
  until('excavate six-cell prison', () => !s.jobs.some(j => j.kind === 'mine'));
  command({ type: 'designate', tool: 'door', from: entrance });
  command({ type: 'designate', tool: 'bed', from: { x: shaft.x + 2, y: shaft.y - 1, z: entrance.z }, axis: 'x' });
  until('build actual prison bed and door', () => s.beds.some(b => b.z === entrance.z) && s.doors.some(d => at(d) === at(entrance)));
  const bed = s.beds.find(b => b.z === entrance.z);
  command({ type: 'bedPrisoner', bedId: bed.id, prisoner: true });
  check('cell is enclosed before enabling ordinary raids', !s.rooms.roomAt(bed).outdoor);
  command({ type: 'threats', enabled: true });
  until('storyteller spawns an ordinary raid', () => s.pawns.some(p => p.faction === 'raider' && !p.dead), 100000);
  command({ type: 'threats', enabled: false });
  const target = s.pawns.find(p => p.faction === 'raider' && !p.dead);
  prisonerId = target.id;
  for (const p of s.pawns.filter(p => p.faction === 'colony')) {
    command({ type: 'draft', pawnId: p.id, drafted: true });
    command({ type: 'attack', pawnId: p.id, targetId: prisonerId });
  }
  until('actual combat downs raider', () => prisoner().downed, 12000);
  for (const p of s.pawns.filter(p => p.faction === 'colony' && p.drafted)) command({ type: 'draft', pawnId: p.id, drafted: false });
  const wardenId = s.pawns.filter(p => p.faction === 'colony' && !p.dead && !p.downed).sort((a, b) => b.rest - a.rest)[0].id;
  await save('ready');
  command({ type: 'capture', pawnId: wardenId, targetId: prisonerId });
  until('capture is performed after actually reaching raider', () => prisoner().faction === 'prisoner');
  await save('carrying');
  s = VoxelSimulation.load(s.save());
  check('carried prisoner and warden continue after load', prisoner().carriedBy === wardenId);
  until('prisoner physically reaches assigned underground bed', () => prisoner().carriedBy === null && at(prisoner()) === at(bed));
  await save('settled');
  command({ type: 'medicalPolicy', pawnId: prisonerId, policy: 'herbal' });
  command({ type: 'prisonerPolicy', prisonerId, policy: 'recruit' });
  for (const p of s.pawns.filter(p => p.faction === 'colony')) {
    command({ type: 'priority', pawnId: p.id, work: 'care', value: 1 });
    command({ type: 'priority', pawnId: p.id, work: 'warden', value: 1 });
  }
  until('treatment and rest restore prisoner mobility', () => !prisoner().downed, 30000);
  await save('recovered');
  until('warden reaches and begins the first physical conversation', () => s.pawns.some(p => p.wardenTask?.prisonerId === prisonerId && p.wardenTask.stage === 'talk'), 30000);
  await save('talk-ready');
  until('resistance reaches zero through completed conversations', () => prisoner().prisoner?.resistance === 0, 60000);
  check('zero resistance does not recruit in same conversation', prisoner().faction === 'prisoner');
  await save('zero-resistance');
  const stableId = prisonerId, skill = structuredClone(prisoner().skills), wounds = prisoner().trauma.missingParts;
  s = VoxelSimulation.load(s.save());
  until('next eligible conversation recruits same person', () => prisoner().faction === 'colony', 15000);
  check('recruit retains identity, own skills and missing body parts', prisoner().id === stableId && JSON.stringify(prisoner().skills) === JSON.stringify(skill) && JSON.stringify(prisoner().trauma.missingParts) === JSON.stringify(wounds));
  check('colony now has four people and prison bed is unassigned', s.pawns.filter(p => p.faction === 'colony').length === 4 && s.beds.find(b => b.id === bed.id).owner === null);
  await save('recruited');
  s = VoxelSimulation.load(s.save());
  s.step(400);
  check('four-person colony remains loadable and active', s.pawns.filter(p => p.faction === 'colony').length === 4 && s.pawns.filter(p => p.faction === 'colony').every(p => !p.dead && !p.downed));
  await save('final'); report.status = 'passed';
} catch (e) { report.status = 'failed'; report.error = String(e); await save('failure'); throw e; }
finally { await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); }
