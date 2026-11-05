import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Pawn, type Pos, type Stack, type VoxelCommand } from '../src/voxel/types';
import { createDefaultFoodPolicies, type FoodResource } from '../src/voxel/foodPolicies';
import { freshBatch } from '../src/voxel/preservation';
import { initialApparelControl } from '../src/voxel/apparelPolicies';
import { initialSurvival } from '../src/voxel/survival';
import { initialPsyche } from '../src/voxel/mood';
import { initialSkills } from '../src/voxel/skills';
import { stripFoodPoliciesFields } from './legacy-food-policies-defaults';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
function cmd(s: VoxelSimulation, command: VoxelCommand) {
  const result = s.command(command); expect(result.ok, result.message).toBe(true); return result;
}
/** Controlled terrain and initial stock isolate food decisions. Every order,
 * reservation, route, pickup and consumption below uses the simulation loop. */
function fixture(options: { dining?: boolean; prison?: boolean } = {}) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.grass = []; s.trees = []; s.items = []; s.stockpiles = []; s.beds = []; s.chairs = []; s.tables = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 9; x <= 34; x++) for (let y = 10; y <= 27; y++) for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(12, 16 + i)); p.schedule.fill('work'); p.food = 95; p.rest = 95;
    p.apparelControl = initialApparelControl(s.tick);
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof Pawn['priorities']] = 0;
  }
  if (options.dining) {
    s.tables.push({ ...pos(28), id: s.nextId++, axis: 'x', quality: 2, gathering: true });
    s.chairs.push({ ...pos(27), id: s.nextId++, axis: 'y', quality: 2 });
  }
  if (options.prison) {
    for (let x = 21; x <= 29; x++) for (let y = 19; y <= 25; y++) {
      s.blocks[index(x, y, 10)] = Block.Stone;
      if (x === 21 || x === 29 || y === 19 || y === 25) for (let z = 8; z <= 9; z++) s.blocks[index(x, y, z)] = Block.Stone;
    }
    s.blocks[index(25, 19, 8)] = s.blocks[index(25, 19, 9)] = Block.Air;
    s.doors.push({ ...pos(25, 19), id: s.nextId++, axis: 'x', mode: 'auto', openUntil: 0 });
    s.beds.push({ ...pos(24, 22), id: s.nextId++, axis: 'x', quality: 2, medical: false, prisoner: false, owner: null });
  }
  cmd(s, { type: 'threats', enabled: false }); cmd(s, { type: 'fireHazards', enabled: false });
  return VoxelSimulation.load(s.save());
}
function food(s: VoxelSimulation, resource: Exclude<FoodResource, 'eggFertilized'> = 'meal', amount = 3, where = pos(22), extra: Partial<Stack> = {}) {
  const item: Stack = { ...freshBatch(resource, amount), ...where, id: s.nextId++, ...extra };
  s.items.push(item); return item;
}
function policy(s: VoxelSimulation, allowedResources: FoodResource[], id = 1) {
  cmd(s, { type: 'foodPolicyUpdate', policy: { ...structuredClone(s.foodPolicies.policies.find(p => p.id === id)!), allowedResources } });
}
function until(s: VoxelSimulation, done: () => boolean, max = 2000) {
  for (let tick = 0; tick < max && !done(); tick++) s.step();
  expect(done(), JSON.stringify(s.pawns.map(p => ({ id: p.id, phase: p.phase, eating: p.eating, care: p.carePhase,
    food: p.food, cargo: p.cargo, mealTask: p.living.mealTask, reason: p.reason })))).toBe(true);
}
function patientFixture() {
  let s = fixture();
  const patient = s.pawns[1], bed = { ...pos(26, 14), id: s.nextId++, axis: 'x' as const, quality: 2 as const, medical: true, prisoner: false, owner: null };
  s.beds.push(bed); Object.assign(patient, pos(26, 14)); patient.health.malnutrition = .9;
  patient.downed = true; patient.phase = 'downed'; patient.food = 10; patient.sleepBedId = bed.id;
  s = VoxelSimulation.load(s.save());
  return { s, doctor: s.pawns[0], patient: s.pawns[1] };
}
function capturedFixture() {
  const s = fixture({ prison: true }), warden = s.pawns[0], id = s.nextId++;
  const prisoner: Pawn = { ...structuredClone(s.pawns[2]), ...initialSurvival(s.seed, id), ...pos(18, 17), id,
    name: '受伤袭击者', faction: 'raider', foodPolicyId: null, apparelControl: initialApparelControl(s.tick),
    worn: [], psyche: initialPsyche(s.tick), skills: initialSkills(0, true) };
  s.pawns.push(prisoner);
  prisoner.health.malnutrition = .9; prisoner.downed = true; prisoner.phase = 'downed';
  cmd(s, { type: 'bedPrisoner', bedId: s.beds[0].id, prisoner: true });
  cmd(s, { type: 'capture', pawnId: warden.id, targetId: prisoner.id });
  until(s, () => prisoner.faction === 'prisoner' && prisoner.carriedBy === null && at(prisoner) === at(s.beds[0]));
  prisoner.health.malnutrition = 0; s.step(); expect(prisoner.downed).toBe(false);
  cmd(s, { type: 'pawnFoodPolicy', pawnId: prisoner.id, policyId: 1 });
  return { s, warden, prisoner };
}

describe('shared food policy decisions with physical items and simulation ticks', () => {
  it('assigns new colonists the shared unrestricted policy and leaves a controlled v56 migration unassigned', () => {
    const s = fixture(); expect(s.foodPolicies).toEqual(createDefaultFoodPolicies());
    expect(s.pawns.every(p => p.foodPolicyId === 1)).toBe(true);
    const old: any = s.save(); stripFoodPoliciesFields(old); old.version = 56;
    const before = structuredClone(old), restored = VoxelSimulation.load(old);
    expect(old).toEqual(before); expect(restored.pawns.every(p => p.foodPolicyId === null)).toBe(true);
    expect(restored.foodPolicies).toEqual(createDefaultFoodPolicies());
    expect(restored.items).toEqual(s.items); expect(restored.nextId).toBe(s.nextId);
  });

  it('clones policies in their own namespace and rejects malformed, referenced and final deletions atomically', () => {
    const s = fixture(), nextId = s.nextId;
    cmd(s, { type: 'foodPolicyCreate', sourceId: 1 }); expect(s.nextId).toBe(nextId);
    expect(s.foodPolicies.policies[1].id).toBe(2); policy(s, ['food'], 2);
    expect(s.foodPolicies.policies[0].allowedResources).toEqual(createDefaultFoodPolicies().policies[0].allowedResources);
    cmd(s, { type: 'pawnFoodPolicy', pawnId: s.pawns[0].id, policyId: 2 });
    const malformed = [
      { type: 'foodPolicyDelete', policyId: 2 }, { type: 'foodPolicyDelete', policyId: 1 },
      { type: 'foodPolicyCreate', sourceId: 999 }, { type: 'foodPolicyCreate', extra: true },
      { type: 'foodPolicyUpdate', policy: { ...s.foodPolicies.policies[0], allowedResources: ['wood'] } },
      { type: 'foodPolicyUpdate', policy: { ...s.foodPolicies.policies[0], name: ' ' } },
      { type: 'pawnFoodPolicy', pawnId: s.pawns[0].id, policyId: NaN },
      { type: 'pawnFoodPolicy', pawnId: s.pawns[0].id, policyId: null, unexpected: true },
    ];
    for (const command of malformed) {
      const before = s.save(); expect(s.command(command as VoxelCommand).ok).toBe(false); expect(s.save()).toEqual(before);
    }
    cmd(s, { type: 'pawnFoodPolicy', pawnId: s.pawns[0].id, policyId: null });
    cmd(s, { type: 'foodPolicyDelete', policyId: 2 });
    for (const p of s.pawns) cmd(s, { type: 'pawnFoodPolicy', pawnId: p.id, policyId: null });
    expect(s.command({ type: 'foodPolicyDelete', policyId: 1 }).ok).toBe(false);
    const snapshot = s.snapshot(); snapshot.foodPolicies.policies[0].allowedResources.length = 0;
    expect(s.foodPolicies.policies[0].allowedResources).toHaveLength(7);
  });

  it('filters automatic ground choices before preference scoring and consumes an allowed loose stack after actual fetch and reload', () => {
    let s = fixture(), rejected = food(s, 'meal', 3, pos(13)), allowed = food(s, 'food', 2, pos(24));
    policy(s, ['food']); s.pawns[0].food = 20;
    until(s, () => s.pawns[0].phase === 'fetch');
    expect(s.pawns[0].eating).toBe('food'); expect(s.pawns[0].path.length).toBeGreaterThan(0);
    expect(s.stats.eaten).toBe(0); expect(s.stockpiles).toHaveLength(0);
    s = VoxelSimulation.load(s.save()); until(s, () => s.pawns[0].living.mealTask !== null);
    expect(s.pawns[0].cargo?.resource).toBe('food'); expect(s.pawns[0].cargo?.amount).toBe(1); expect(s.stats.eaten).toBe(0);
    s = VoxelSimulation.load(s.save()); until(s, () => s.stats.consumed.food === 1);
    expect(s.items.find(i => i.id === rejected.id)?.amount).toBe(3);
    expect(s.items.find(i => i.id === allowed.id)?.amount).toBe(1);
    expect(s.pawns[0].food).toBeGreaterThan(90); expect(s.counts().food + s.stats.consumed.food).toBe(2);
  });

  it('applies the policy to carried food, including starvation, and can eat it once the shared policy permits it', () => {
    const s = fixture(), p = s.pawns[0]; p.food = 0; p.cargo = { ...freshBatch('meal', 1), poisonChance: .37 };
    food(s, 'food', 1); policy(s, []); s.step(80);
    expect(s.stats.eaten).toBe(0); expect(p.food).toBe(0); expect(p.eating).toBeNull();
    expect(s.counts().meal).toBe(1); expect(s.counts().food).toBe(1);
    policy(s, ['meal']); until(s, () => s.stats.consumed.meal === 1);
    expect(s.stats.consumed.food).toBe(0); expect(p.food).toBeGreaterThan(85);
    expect(s.counts().meal + s.stats.consumed.meal).toBe(1);
  });

  it('releases a canceled fetch reservation so a different eligible resident can take the same stack', () => {
    const s = fixture(), first = s.pawns[0], second = s.pawns[1], item = food(s, 'meal', 1, pos(25));
    first.food = 20; until(s, () => first.phase === 'fetch');
    cmd(s, { type: 'foodPolicyCreate', sourceId: 1 }); policy(s, [], 2);
    cmd(s, { type: 'pawnFoodPolicy', pawnId: first.id, policyId: 2 });
    expect(first.eating).toBeNull(); expect(first.phase).toBe('idle'); expect(first.path).toHaveLength(0);
    expect(s.items.find(i => i.id === item.id)?.amount).toBe(1);
    second.food = 20; until(s, () => second.phase === 'fetch');
    expect(second.eating).toBe('meal'); until(s, () => s.stats.consumed.meal === 1);
    expect(second.food).toBeGreaterThan(90); expect(first.food).toBeLessThan(20); expect(s.counts().meal).toBe(0);
  });

  it('interrupts policy-invalid dining without consuming or discarding the carried meal and releases its seat', () => {
    const s = fixture({ dining: true }), p = s.pawns[0], item = food(s, 'meal', 3, pos(14), { poisonChance: .43 });
    p.food = 20; until(s, () => p.living.mealTask?.stage === 'chew'); s.step(5);
    const cargo = structuredClone(p.cargo); expect(p.living.mealTask?.chairId).toBe(s.chairs[0].id);
    policy(s, []); expect(p.eating).toBeNull(); expect(p.living.mealTask).toBeNull(); expect(p.cargo).toEqual(cargo);
    expect(p.cargo?.poisonChance).toBe(.43); expect(s.stats.eaten).toBe(0); expect(s.counts().meal).toBe(3);
    expect(VoxelSimulation.load(s.save()).pawns[0].cargo).toEqual(cargo);
    // Cancellation releases the reservation, but the former diner still
    // physically occupies the chair until they walk away.
    cmd(s, { type: 'move', pawnId: p.id, target: pos(26, 18) }); until(s, () => at(p) === at(pos(26, 18)));
    cmd(s, { type: 'pawnFoodPolicy', pawnId: s.pawns[1].id, policyId: null }); s.pawns[1].food = 20;
    until(s, () => s.pawns[1].living.mealTask?.chairId === s.chairs[0].id);
    expect(s.items.find(i => i.id === item.id)?.amount).toBe(1);
  });

  it('keeps allowed-area and forbidden checks when food is permitted, without requiring stockpile storage', () => {
    const s = fixture(), p = s.pawns[0], outside = food(s, 'meal', 1, pos(25)), inside = food(s, 'meal', 1, pos(16), { forbidden: true });
    const areaId = cmd(s, { type: 'allowedAreaCreate', name: '用餐区' }).areaId!;
    cmd(s, { type: 'allowedAreaPaint', areaId, from: pos(11, 15), to: pos(18, 19), erase: false });
    cmd(s, { type: 'pawnAreaAssign', pawnId: p.id, areaId }); policy(s, ['meal']); p.food = 20; s.step(50);
    expect(p.eating).toBeNull(); expect(s.stats.eaten).toBe(0); expect(inside.forbidden).toBe(true);
    cmd(s, { type: 'itemForbidden', itemId: inside.id, forbidden: false }); until(s, () => s.stats.consumed.meal === 1);
    expect(s.items.some(i => i.id === outside.id)).toBe(true); expect(s.items.some(i => i.id === inside.id)).toBe(false);
    expect(s.stockpiles).toHaveLength(0); expect(s.pawnAllowed(p, p)).toBe(true);
  });

  it('feeds from ground according to the patient policy even when the doctor has different food preferences', () => {
    const { s, doctor, patient } = patientFixture(); policy(s, ['food']);
    cmd(s, { type: 'foodPolicyCreate', sourceId: 1 }); policy(s, ['meal'], 2);
    cmd(s, { type: 'pawnFoodPolicy', pawnId: doctor.id, policyId: 2 });
    doctor.cargo = { ...freshBatch('meal', 1), poisonChance: .31 };
    const meal = food(s, 'meal', 2, pos(13)), ration = food(s, 'food', 2, pos(20));
    cmd(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    expect(doctor.carePhase).toBe('feedFetch'); expect(doctor.careFoodId).toBe(ration.id);
    expect(doctor.cargo).toBeNull(); expect(s.counts().meal).toBe(3);
    until(s, () => doctor.cargo?.resource === 'food'); expect(patient.food).toBeLessThan(11);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow(); until(s, () => patient.food > 90);
    expect(s.stats.consumed.food).toBe(1); expect(s.stats.consumed.meal).toBe(0);
    expect(s.items.find(i => i.id === meal.id)?.amount).toBe(2);
    expect(s.items.some(i => i.resource === 'meal' && i.poisonChance === .31 && i.amount === 1)).toBe(true);
  });

  it('uses a carried meal permitted for the patient even if forbidden by the doctor policy', () => {
    const { s, doctor, patient } = patientFixture(); policy(s, ['meal']);
    cmd(s, { type: 'foodPolicyCreate', sourceId: 1 }); policy(s, [], 2);
    cmd(s, { type: 'pawnFoodPolicy', pawnId: doctor.id, policyId: 2 });
    doctor.cargo = freshBatch('meal', 2);
    cmd(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    expect(doctor.carePhase).toBe('feedApproach'); expect(doctor.careFoodId).toBeNull();
    until(s, () => patient.food > 90); expect(s.stats.consumed.meal).toBe(1);
    expect(doctor.cargo?.amount).toBe(1); expect(s.counts().meal).toBe(1);
  });

  it('cancels a now-disallowed feed both before and after pickup and preserves batch identity and poison chance', () => {
    let { s, doctor, patient } = patientFixture(); const item = food(s, 'meal', 2, pos(18), { poisonChance: .67 });
    cmd(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    expect(doctor.carePhase).toBe('feedFetch'); policy(s, ['food']);
    expect(doctor.carePhase).toBeNull(); expect(doctor.patientId).toBeNull(); expect(s.items.find(i => i.id === item.id)?.amount).toBe(2);
    policy(s, ['meal']); cmd(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    until(s, () => doctor.carePhase === 'feedApproach');
    const cargo = structuredClone(doctor.cargo); expect(cargo?.poisonChance).toBe(.67);
    policy(s, []); expect(doctor.carePhase).toBeNull(); expect(doctor.patientId).toBeNull(); expect(doctor.cargo).toEqual(cargo);
    expect(s.stats.consumed.meal).toBe(0); expect(s.counts().meal).toBe(2);
    s = VoxelSimulation.load(s.save()); doctor = s.pawns.find(p => p.id === doctor.id)!; patient = s.pawns.find(p => p.id === patient.id)!;
    expect(doctor.cargo).toEqual(cargo); expect(patient.food).toBeLessThan(11); expect(s.counts().meal).toBe(2);
  });

  it('honors the mental-state exception for the eater during actual medical feeding without treating hunger as an exception', () => {
    const { s, doctor, patient } = patientFixture(); policy(s, []); patient.food = 0; doctor.cargo = freshBatch('meal', 1);
    expect(s.command({ type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' }).ok).toBe(false);
    // The existing mental behavior is wandering. An incapacitated patient
    // isolates the eater exception while the doctor still performs real care.
    patient.psyche.breakUntil = s.tick + 1000;
    cmd(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    until(s, () => s.stats.consumed.meal === 1); expect(patient.food).toBeGreaterThan(85);
    expect(patient.foodPolicyId).toBe(1); expect(s.foodPolicies.policies[0].allowedResources).toEqual([]);
  });

  it('lets a recovered prisoner eat actual cell food despite a policy that forbids it', () => {
    const { s, prisoner } = capturedFixture(); policy(s, []); const item = food(s, 'meal', 2, pos(26, 23));
    prisoner.food = 20; const cells = s.prisonCells(prisoner)!;
    until(s, () => { expect(cells.has(at(prisoner))).toBe(true); return s.stats.consumed.meal === 1; });
    expect(prisoner.food).toBeGreaterThan(90); expect(item.amount).toBe(1);
    expect(s.pawns.every(p => p.patientId === null)).toBe(true); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('makes the warden respect a healthy prisoner policy when fetching food outside the cell', () => {
    const { s, warden, prisoner } = capturedFixture(); policy(s, []); prisoner.food = 20;
    const meal = food(s, 'meal', 2, pos(13)), ration = food(s, 'food', 2, pos(18));
    expect(s.command({ type: 'care', pawnId: warden.id, patientId: prisoner.id, action: 'feed' }).ok).toBe(false);
    policy(s, ['food']); cmd(s, { type: 'care', pawnId: warden.id, patientId: prisoner.id, action: 'feed' });
    expect(warden.prisonFoodTask?.sourceId).toBe(ration.id); until(s, () => prisoner.food > 90);
    expect(s.stats.consumed.food).toBe(1); expect(s.stats.consumed.meal).toBe(0);
    expect(s.items.find(i => i.id === meal.id)?.amount).toBe(2); expect(prisoner.faction).toBe('prisoner');
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
});
