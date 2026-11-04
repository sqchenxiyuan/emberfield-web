import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { at, Block, index, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { initialSurvival } from '../src/voxel/survival';
import { initialSkills } from '../src/voxel/skills';
import { initialPsyche } from '../src/voxel/mood';
import { freshBatch } from '../src/voxel/preservation';
import { applyInjury } from '../src/voxel/injuries';
import { BODY_PARTS } from '../src/voxel/anatomy';
import { makeWeapon } from '../src/voxel/weapons';

const pos = (x: number, y = 14): Pos => ({ x, y, z: 8 });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c); expect(result.ok, result.message).toBe(true); return result;
}
function until(s: VoxelSimulation, done: () => boolean, limit = 4500) {
  for (let i = 0; i < limit && !done(); i++) s.step();
  expect(done(), JSON.stringify(s.pawns.map(p => ({ id: p.id, phase: p.phase, faction: p.faction,
    x: p.x, y: p.y, task: p.wardenTask, care: p.carePhase, reason: p.reason })))).toBe(true);
}
/** Controlled integration fixture. A single explicitly created injured enemy
 * exercises recruitment; normal spawning/combat is verified by the campaign. */
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  s.animals = []; s.trees = []; s.treePlots = []; s.items = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 0; x <= 35; x++) for (let y = 8; y <= 28; y++)
    for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  for (let x = 20; x <= 28; x++) for (let y = 18; y <= 25; y++) {
    s.blocks[index(x, y, 10)] = Block.Stone;
    if (x === 20 || x === 28 || y === 18 || y === 25)
      for (let z = 8; z <= 9; z++) s.blocks[index(x, y, z)] = Block.Stone;
  }
  s.blocks[index(24, 18, 8)] = s.blocks[index(24, 18, 9)] = Block.Air;
  s.doors.push({ ...pos(24, 18), id: s.nextId++, axis: 'x', mode: 'auto', openUntil: 0 });
  s.beds.push({ ...pos(23, 21), id: s.nextId++, axis: 'x', owner: null, medical: false, prisoner: false });
  s.spawn = pos(11);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(11, 12 + i)); p.schedule.fill('work'); p.food = 95; p.rest = 95;
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof Pawn['priorities']] = 0;
  }
  const id = s.nextId++, enemy: Pawn = { ...structuredClone(s.pawns[0]), ...initialSurvival(s.seed, id),
    ...pos(16, 15), id, name: '受伤袭击者', faction: 'raider', downed: true, phase: 'downed',
    food: 90, rest: 90, psyche: initialPsyche(), skills: initialSkills(0, true), worn: [],
    prisoner: null, wardenTask: null };
  // Keep incapacity through fetch/feed/tend; recovery itself has separate cases.
  enemy.health.malnutrition = .9; s.pawns.push(enemy);
  s.items.push({ ...freshBatch('meal', 10), ...pos(23, 23), id: s.nextId++ },
    { ...freshBatch('meal', 10), ...pos(13, 15), id: s.nextId++ },
    { ...freshBatch('herb', 10), ...pos(12, 15), id: s.nextId++ });
  const restored = VoxelSimulation.load(s.save());
  command(restored, { type: 'threats', enabled: false });
  command(restored, { type: 'bedPrisoner', bedId: restored.beds[0].id, prisoner: true });
  return restored;
}
function captured() {
  const s = fixture(), w = s.pawns[0], q = s.pawns[3];
  command(s, { type: 'capture', pawnId: w.id, targetId: q.id });
  until(s, () => q.faction === 'prisoner' && q.carriedBy === null && at(q) === at(s.beds[0]));
  return { s, w, q };
}
function recovered() {
  const f = captured(); f.q.health.malnutrition = 0; f.s.step();
  expect(f.q.downed).toBe(false); return f;
}

describe('voxel capture, care, recruitment and release integration', () => {
  it('physically captures one downed raider and reloads approach, carry and bed arrival without new people', () => {
    let s = fixture(); const wId = s.pawns[0].id, qId = s.pawns[3].id;
    const skills = structuredClone(s.pawns[3].skills);
    command(s, { type: 'capture', pawnId: wId, targetId: qId });
    expect(s.pawns[3].faction).toBe('raider');
    s = VoxelSimulation.load(s.save());
    until(s, () => s.pawns.find(p => p.id === wId)?.wardenTask?.stage === 'captureCarry');
    expect(s.pawns.find(p => p.id === qId)?.carriedBy).toBe(wId);
    s = VoxelSimulation.load(s.save());
    until(s, () => s.pawns.find(p => p.id === wId)?.wardenTask === null);
    const q = s.pawns.find(p => p.id === qId)!;
    expect(q).toMatchObject({ faction: 'prisoner', carriedBy: null, id: qId, skills });
    expect(at(q)).toBe(at(s.beds[0])); expect(q.prisoner?.originalFaction).toBe('raider');
    expect(s.beds[0].owner).toBe(qId); expect(s.pawns).toHaveLength(4);
    expect(VoxelSimulation.load(s.save()).pawns).toHaveLength(4);
  });
  it('interrupts a carry by drafting and subsequently transfers the same prisoner back to the assigned bed', () => {
    const s = fixture(), w = s.pawns[0], q = s.pawns[3];
    command(s, { type: 'capture', pawnId: w.id, targetId: q.id });
    until(s, () => w.wardenTask?.stage === 'captureCarry');
    const point = at(w);
    command(s, { type: 'draft', pawnId: w.id, drafted: true });
    expect(w.wardenTask).toBeNull(); expect(w.carryingPawnId).toBeNull();
    expect(q.carriedBy).toBeNull(); expect(at(q)).toBe(point); expect(q.faction).toBe('prisoner');
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    command(s, { type: 'draft', pawnId: w.id, drafted: false });
    command(s, { type: 'priority', pawnId: w.id, work: 'warden', value: 1 });
    until(s, () => at(q) === at(s.beds[0]) && q.carriedBy === null);
    expect(s.pawns).toHaveLength(4);
  });
  it('uses real meals and medicine for a downed prisoner and can save while carrying the supplies', () => {
    const { s, w, q } = captured(); q.food = 10;
    command(s, { type: 'care', pawnId: w.id, patientId: q.id, action: 'feed' });
    until(s, () => w.cargo?.resource === 'meal');
    expect(q.food).toBeLessThan(11); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    until(s, () => q.food > 80);
    expect(s.stats.consumed.meal).toBe(1);
    applyInjury(q.trauma, s.nextId++, 'leftArm', 'cut', 6); s.step();
    command(s, { type: 'care', pawnId: w.id, patientId: q.id, action: 'tend' });
    until(s, () => q.medical.lastTend !== null);
    expect(s.stats.consumed.herb).toBe(1); expect(q.medical.lastTend?.recordIds.length).toBeGreaterThan(0);
    expect(q.trauma.wounds.length).toBeGreaterThan(0); expect(q.faction).toBe('prisoner');
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('returns a hungry healthy inmate to bed for delivered food while respecting the cell boundary', () => {
    const { s, w, q } = recovered();
    s.items = s.items.filter(i => !s.prisonCells(q)!.has(at(i)));
    Object.assign(q, pos(26, 23)); q.food = 20;
    command(s, { type: 'priority', pawnId: w.id, work: 'warden', value: 1 });
    const allowed = s.prisonCells(q)!;
    for (let n = 0; n < 2000 && q.food < 80; n++) {
      s.step(); expect(allowed.has(at(q))).toBe(true);
    }
    expect(q.food).toBeGreaterThan(80); expect(s.stats.consumed.meal).toBe(1);
    expect(q.faction).toBe('prisoner'); expect(q.jobId).toBeNull(); expect(q.attackTargetId).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('reduces the last resistance without recruiting, then requires the next complete cooled-down conversation', () => {
    const { s, w, q } = recovered(); q.prisoner!.resistance = .1;
    const id = q.id, skills = structuredClone(q.skills);
    command(s, { type: 'prisonerPolicy', prisonerId: q.id, policy: 'recruit' });
    command(s, { type: 'priority', pawnId: w.id, work: 'warden', value: 1 });
    until(s, () => q.prisoner?.resistance === 0);
    expect(q.faction).toBe('prisoner'); expect(w.wardenTask).toBeNull();
    const deadline = q.prisoner!.nextInteractionTick;
    s.step(40); expect(q.faction).toBe('prisoner'); expect(w.wardenTask).toBeNull();
    const loaded = VoxelSimulation.load(s.save()), recruited = loaded.pawns.find(p => p.id === id)!;
    until(loaded, () => recruited.faction === 'colony', deadline - loaded.tick + 2000);
    expect(loaded.tick).toBeGreaterThan(deadline + 200);
    expect(recruited).toMatchObject({ id, skills, prisoner: null });
    expect(loaded.beds[0].owner).toBeNull(); expect(loaded.pawns.filter(p => p.faction === 'colony')).toHaveLength(4);
    expect(recruited.priorities.build).toBeGreaterThan(0); expect(() => VoxelSimulation.load(loaded.save())).not.toThrow();
  });
  it('releases face-to-face and persists departure until the former prisoner walks off the map', () => {
    const { s, w, q } = recovered();
    command(s, { type: 'prisonerPolicy', prisonerId: q.id, policy: 'release' });
    command(s, { type: 'priority', pawnId: w.id, work: 'warden', value: 1 });
    until(s, () => q.prisoner!.releasing);
    expect(s.pawns).toContain(q); expect(q.prisoner!.bedId).toBeNull(); expect(s.beds[0].owner).toBeNull();
    const loaded = VoxelSimulation.load(s.save());
    until(loaded, () => !loaded.pawns.some(p => p.id === q.id));
    expect(loaded.pawns).toHaveLength(3); expect(() => VoxelSimulation.load(loaded.save())).not.toThrow();
  });
  it('cancels bed ownership without freeing a prisoner into work or leaving dangling save references', () => {
    const { s, q } = recovered();
    command(s, { type: 'bedPrisoner', bedId: s.beds[0].id, prisoner: false });
    expect(q.prisoner?.bedId).toBeNull(); expect(q.sleepBedId).toBeNull();
    const before = at(q); s.step(100);
    expect(at(q)).toBe(before); expect(q.faction).toBe('prisoner'); expect(q.jobId).toBeNull();
    expect(q.reason).toContain('等待看守转移'); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('lets an infected prisoner return to their bed and remain at medical rest after full sleep recovery', () => {
    const { s, q } = recovered(); Object.assign(q, pos(26, 23)); q.rest = 95;
    q.medical.infections.push({ id: s.nextId++, part: 'leftArm', createdTick: s.tick,
      severity: .1, immunityFactor: 1, tendQuality: null, tendUntil: 0 });
    until(s, () => q.sleepingSince !== null && at(q) === at(s.beds[0]));
    const immunity = q.medical.immunity; s.step(350);
    expect(q.rest).toBe(100); expect(q.sleepingSince).not.toBeNull();
    expect(at(q)).toBe(at(s.beds[0])); expect(q.medical.immunity).toBeGreaterThan(immunity);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('takes a real meal inside the cell without any warden delivery or door escape', () => {
    const { s, q } = recovered(); Object.assign(q, pos(26, 23)); q.food = 20;
    const allowed = s.prisonCells(q)!, meal = s.items.find(i => i.resource === 'meal' && allowed.has(at(i)))!;
    const before = meal.amount;
    for (let n = 0; n < 500 && q.food < 80; n++) { s.step(); expect(allowed.has(at(q))).toBe(true); }
    expect(q.food).toBeGreaterThan(80); expect(meal.amount).toBe(before - 1);
    expect(s.stats.consumed.meal).toBe(1); expect(s.pawns.every(p => p.patientId === null)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('drops a carried prisoner safely when both hands fail and preserves a reloadable paired state', () => {
    const s = fixture(), w = s.pawns[0], q = s.pawns[3];
    command(s, { type: 'capture', pawnId: w.id, targetId: q.id });
    until(s, () => w.wardenTask?.stage === 'captureCarry');
    for (const hand of ['leftHand', 'rightHand'] as const)
      applyInjury(w.trauma, s.nextId++, hand, 'cut', BODY_PARTS[hand].hitPoints + 1);
    const point = at(w); s.step();
    expect(w.wardenTask).toBeNull(); expect(w.carryingPawnId).toBeNull(); expect(q.carriedBy).toBeNull();
    expect(at(q)).toBe(point); expect(q.faction).toBe('prisoner');
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('releases the reserved bed when an inmate dies and keeps the original corpse identity', () => {
    const { s, q } = recovered(), id = q.id;
    q.health.malnutrition = 1; q.food = 0; s.step();
    expect(q.dead).toBe(true); expect(q.id).toBe(id); expect(q.prisoner?.bedId).toBeNull();
    expect(q.sleepBedId).toBeNull(); expect(s.beds[0].owner).toBeNull();
    expect(s.pawns).toHaveLength(4); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('migrates the frozen genuine v23 checkpoint without changing resources, identities, skills or psyche', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v23-prison-initial.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('3eac88560e5bf8460e91517998c80fe501ce5be1eeac088e9c0cb3703db216b3');
    const old = JSON.parse(bytes.toString()), s = VoxelSimulation.load(old), upgraded = s.save();
    expect(old.version).toBe(23); expect(upgraded.version).toBe(32);
    expect(upgraded.items).toEqual(old.items); expect(upgraded.stats).toEqual(old.stats);
    expect(upgraded.nextId).toBe(old.nextId); expect(upgraded.animals).toMatchObject(old.animals);
    expect(upgraded.pawns).toHaveLength(old.pawns.length);
    for (const p of upgraded.pawns) {
      const before = old.pawns.find((q: Pawn) => q.id === p.id);
      for (const key of ['id', 'name', 'faction', 'psyche', 'trauma', 'medical', 'health', 'worn', 'weapon', 'cargo'] as const)
        expect(p[key], `${p.id}/${key}`).toEqual(key === 'psyche' ? { ...before.psyche, tolerance: { ...before.psyche.tolerance, social: 0 } } : before[key]);
      expect(p.skills).toMatchObject(before.skills);
      expect(p.prisoner).toBeNull(); expect(p.wardenTask).toBeNull();
      expect(p.priorities.warden).toBe(p.faction === 'colony' ? 1 : 0);
    }
    expect(upgraded.beds.every(b => b.prisoner === false)).toBe(true);
  });
  it('preserves an already launched enemy projectile across capture and rejects forged launch allegiance', () => {
    const s = fixture(), w = s.pawns[0], q = s.pawns[3];
    for (const [i, p] of s.pawns.slice(0, 3).entries()) Object.assign(p, pos(8, 14 - i * 2));
    Object.assign(q, pos(30, 14)); q.health.malnutrition = 0;
    q.weapon = makeWeapon(s.nextId++, 'shortBow'); q.skills.shooting.level = 20;
    until(s, () => s.projectiles.some(shot => shot.shooterId === q.id), 200);
    const shot = s.projectiles.find(shot => shot.shooterId === q.id)!;
    Object.assign(w, pos(q.x - 1, q.y)); q.health.malnutrition = .9; s.step();
    expect(q.downed).toBe(true); expect(shot.impactTick).toBeGreaterThan(s.tick + 1);
    command(s, { type: 'capture', pawnId: w.id, targetId: q.id }); s.step();
    expect(q.faction).toBe('prisoner'); expect(s.projectiles).toContain(shot);
    expect(shot.shooterFaction).toBe('raider');
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    const badFaction = s.save(); badFaction.projectiles.find(p => p.id === shot.id)!.shooterFaction = 'trader';
    expect(() => VoxelSimulation.load(badFaction)).toThrow('发射者阵营不一致');
    const futureShot = s.save(); futureShot.pawns.find(p => p.id === q.id)!.prisoner!.capturedTick = shot.launchedTick - 1;
    expect(() => VoxelSimulation.load(futureShot)).toThrow('发射者阵营不一致');
  });
  it('cancels an active conversation immediately when the prisoner bed is disabled, before another tick', () => {
    const { s, w, q } = recovered();
    command(s, { type: 'prisonerPolicy', prisonerId: q.id, policy: 'recruit' });
    command(s, { type: 'priority', pawnId: w.id, work: 'warden', value: 1 });
    until(s, () => w.wardenTask?.stage === 'talk');
    const tick = s.tick;
    command(s, { type: 'bedPrisoner', bedId: s.beds[0].id, prisoner: false });
    expect(s.tick).toBe(tick); expect(w.wardenTask).toBeNull(); expect(q.prisoner!.bedId).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('rescues a colonist lying on a prisoner medical bed to a colony bed and rejects a forged wrong-purpose destination', () => {
    const { s, w, q } = recovered(), patient = s.pawns[1], prisonBed = s.beds[0];
    command(s, { type: 'bedMedical', bedId: prisonBed.id, medical: true });
    const medicalBed = { ...pos(15, 20), id: s.nextId++, axis: 'x' as const,
      prisoner: false, medical: true, owner: null };
    s.beds.push(medicalBed); Object.assign(q, pos(26, 23));
    Object.assign(patient, { x: prisonBed.x, y: prisonBed.y, z: prisonBed.z });
    patient.health.malnutrition = .9; patient.food = 90; s.step();
    expect(patient.downed).toBe(true);
    command(s, { type: 'care', pawnId: w.id, patientId: patient.id, action: 'rescue' });
    expect(w.careBedId).toBe(medicalBed.id);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    const forged = s.save(); forged.pawns.find(p => p.id === w.id)!.careBedId = prisonBed.id;
    expect(() => VoxelSimulation.load(forged)).toThrow('救援医疗床预定无效');
    until(s, () => patient.carriedBy === null && at(patient) === at(medicalBed));
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('clears a talk reservation immediately when its patient is downed after the warden has acted', () => {
    const { s, w, q } = recovered();
    command(s, { type: 'prisonerPolicy', prisonerId: q.id, policy: 'recruit' });
    command(s, { type: 'priority', pawnId: w.id, work: 'warden', value: 1 });
    until(s, () => w.wardenTask?.stage === 'talk');
    // Controlled post-action injury boundary: reconcile before another scheduler tick.
    q.health.malnutrition = .9;
    (s as unknown as { reconcileHealth(p: Pawn): void }).reconcileHealth(q);
    expect(q.downed).toBe(true); expect(w.wardenTask).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('uses lying posture for a sleeping prisoner in the actual ranged shot report', () => {
    const { s, w, q } = recovered();
    Object.assign(q, pos(23, 21)); q.sleepBedId = s.beds[0].id; q.sleepingSince = s.tick;
    Object.assign(w, pos(27, 24)); w.weapon = makeWeapon(s.nextId++, 'shortBow');
    const sleeping = s.shotReport(w, q)!;
    q.sleepingSince = null;
    const standing = s.shotReport(w, q)!;
    expect(sleeping.postureFactor).toBe(.5);
    expect(standing.postureFactor).toBe(1);
  });
  it('preserves a sleeping prisoner’s medical rest during medicine fetching and treatment', () => {
    const { s, w, q } = recovered();
    q.medical.infections.push({ id: s.nextId++, part: 'leftArm', createdTick: s.tick,
      severity: .1, immunityFactor: 1, tendQuality: null, tendUntil: 0 });
    until(s, () => q.sleepingSince !== null);
    const sleepingSince = q.sleepingSince;
    command(s, { type: 'care', pawnId: w.id, patientId: q.id, action: 'tend' });
    expect(q.phase).toBe('prisoner'); expect(q.sleepingSince).toBe(sleepingSince);
    until(s, () => w.cargo?.resource === 'herb');
    expect(q.sleepingSince).toBe(sleepingSince); expect(q.sleepBedId).toBe(s.beds[0].id);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    until(s, () => q.medical.lastTend !== null);
    expect(q.sleepingSince).toBe(sleepingSince); expect(q.phase).toBe('prisoner');
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
});
