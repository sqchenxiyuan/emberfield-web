import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { at, bedCells, Block, index, position, type Pawn, type Pos, type Stack, type VoxelCommand } from '../src/voxel/types';
import { initialSurvival } from '../src/voxel/survival';
import { initialSkills } from '../src/voxel/skills';
import { initialPsyche } from '../src/voxel/mood';
import { initialApparelControl } from '../src/voxel/apparelPolicies';
import { freshBatch } from '../src/voxel/preservation';
import { stackLimit } from '../src/voxel/logistics';
import type { FoodResource } from '../src/voxel/foodPolicies';
import { FIRE_MAX_HP, fireDamageKey } from '../src/voxel/fire';

const pos = (x: number, y = 14, z = 8): Pos => ({ x, y, z });
function cmd(s: VoxelSimulation, command: VoxelCommand) {
  const result = s.command(command); expect(result.ok, result.message).toBe(true); return result;
}
function until(s: VoxelSimulation, done: () => boolean, max = 3000) {
  for (let n = 0; n < max && !done(); n++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, pawns: s.pawns.map(p => ({ id: p.id, phase: p.phase, food: p.food,
    x: p.x, y: p.y, cargo: p.cargo, delivery: p.prisonFoodTask, meal: p.living.mealTask, care: p.carePhase, reason: p.reason })) })).toBe(true);
}
/** Explicit controlled terrain, stock and incapacitated enemies. Capture,
 * supply, movement, pickup, placement and dining use actual simulation work. */
function captured(count = 1, recover = true) {
  let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.grass = []; s.trees = []; s.treePlots = []; s.items = []; s.stockpiles = [];
  s.beds = []; s.tables = []; s.chairs = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 0; x <= 35; x++) for (let y = 8; y <= 28; y++) for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  for (let x = 20; x <= 28; x++) for (let y = 18; y <= 25; y++) {
    s.blocks[index(x, y, 10)] = Block.Stone;
    if (x === 20 || x === 28 || y === 18 || y === 25) for (let z = 8; z <= 9; z++) s.blocks[index(x, y, z)] = Block.Stone;
  }
  s.blocks[index(24, 18, 8)] = s.blocks[index(24, 18, 9)] = Block.Air;
  s.doors.push({ ...pos(24, 18), id: s.nextId++, axis: 'x', mode: 'auto', openUntil: 0 });
  s.tables.push({ ...pos(26, 23), id: s.nextId++, axis: 'y', quality: 2, gathering: true });
  s.chairs.push({ ...pos(25, 23), id: s.nextId++, axis: 'x', quality: 2 });
  s.spawn = pos(11);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(11, 12 + i)); p.schedule.fill('work'); p.food = 95; p.rest = 95;
    p.apparelControl = initialApparelControl(s.tick);
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof Pawn['priorities']] = 0;
  }
  const inmateIds: number[] = [];
  for (let n = 0; n < count; n++) {
    s.beds.push({ ...pos(23, 20 + n * 2), id: s.nextId++, axis: 'x', owner: null, quality: 2, medical: false, prisoner: false });
    const id = s.nextId++, enemy: Pawn = { ...structuredClone(s.pawns[0]), ...initialSurvival(s.seed, id), ...pos(16, 15 + n),
      id, name: `俘虏 ${n + 1}`, faction: 'raider', downed: true, phase: 'downed', foodPolicyId: null,
      apparelControl: initialApparelControl(s.tick), food: 90, rest: 90, psyche: initialPsyche(), skills: initialSkills(0, true),
      worn: [], prisoner: null, wardenTask: null };
    delete enemy.prisonFoodTask;
    enemy.health.malnutrition = .9; s.pawns.push(enemy); inmateIds.push(id);
  }
  s = VoxelSimulation.load(s.save()); cmd(s, { type: 'threats', enabled: false }); cmd(s, { type: 'fireHazards', enabled: false });
  cmd(s, { type: 'bedPrisoner', bedId: s.beds[0].id, prisoner: true });
  const w = s.pawns[0];
  for (const id of inmateIds) {
    const q = s.pawns.find(p => p.id === id)!;
    cmd(s, { type: 'capture', pawnId: w.id, targetId: q.id });
    until(s, () => q.faction === 'prisoner' && q.carriedBy === null && s.beds.some(b => b.owner === q.id && at(b) === at(q)));
    cmd(s, { type: 'pawnFoodPolicy', pawnId: q.id, policyId: 1 });
  }
  // Keep the earlier captive in bed until every capture finishes: their
  // ordinary roaming could otherwise occupy the next recipient's reserved bed.
  if (recover) {
    for (const id of inmateIds) s.pawns.find(p => p.id === id)!.health.malnutrition = 0;
    s.step(); for (const id of inmateIds) expect(s.pawns.find(p => p.id === id)!.downed).toBe(false);
  }
  return { s, w, q: s.pawns.find(p => p.id === inmateIds[0])!, prisoners: inmateIds.map(id => s.pawns.find(p => p.id === id)!) };
}
function food(s: VoxelSimulation, resource: Exclude<FoodResource, 'eggFertilized'> = 'meal', amount = 3, where = pos(13, 15), extra: Partial<Stack> = {}) {
  const item: Stack = { ...freshBatch(resource, amount), ...where, id: s.nextId++, ...extra }; s.items.push(item); return item;
}
function policy(s: VoxelSimulation, resources: FoodResource[]) {
  cmd(s, { type: 'foodPolicyUpdate', policy: { ...structuredClone(s.foodPolicies.policies[0]), allowedResources: resources } });
}
function total(s: VoxelSimulation, resource: FoodResource) {
  return s.items.filter(i => i.resource === resource).reduce((n, i) => n + i.amount, 0) +
    s.pawns.reduce((n, p) => n + (p.cargo?.resource === resource ? p.cargo.amount : 0), 0) + s.stats.consumed[resource];
}
function clutter(s: VoxelSimulation, q: Pawn, only?: Pos) {
  const occupiedBeds = new Set(s.beds.flatMap(b => bedCells(b).map(at)));
  const cells = only ? [only] : [...s.prisonCells(q)!].map(position);
  const items: Stack[] = [];
  for (const cell of cells) if (s.standable(cell) && !occupiedBeds.has(at(cell)) && !s.chairs.some(c => at(c) === at(cell))) {
    const item: Stack = { ...cell, id: s.nextId++, resource: 'wood', amount: stackLimit('wood') }; s.items.push(item); items.push(item);
  }
  return items;
}

describe('real prisoner delivery, dining and interruption integration', () => {
  it('fetches, carries, drops, walks to a chair and chews before nutrition, preserving every stage through saves', () => {
    let { s, w, q } = captured(); q.food = 20; const source = food(s, 'meal', 3, pos(13, 15), { poisonChance: .23 });
    const workerId = w.id, prisonerId = q.id;
    const reload = () => { s = VoxelSimulation.load(s.save()); w = s.pawns.find(p => p.id === workerId)!; q = s.pawns.find(p => p.id === prisonerId)!; };
    cmd(s, { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id });
    expect(w.prisonFoodTask).toMatchObject({ stage: 'fetch', sourceId: source.id, resource: 'meal', amount: 1 });
    expect(w.cargo).toBeNull(); expect(w.path.length).toBeGreaterThan(0); reload();
    until(s, () => w.prisonFoodTask?.stage === 'deliver');
    expect(w.cargo).toMatchObject({ resource: 'meal', amount: 1, poisonChance: .23 });
    expect(s.items.find(i => i.id === source.id)?.amount).toBe(2); expect(q.food).toBeLessThan(21); expect(s.stats.eaten).toBe(0);
    reload(); const target = structuredClone(w.prisonFoodTask!.target);
    until(s, () => !w.prisonFoodTask);
    expect(w.cargo).toBeNull(); expect(s.stats.eaten).toBe(0); expect(q.food).toBeLessThan(21);
    expect(s.items.some(i => at(i) === at(target) && i.resource === 'meal' && i.amount === 1 && i.poisonChance === .23)).toBe(true);
    until(s, () => q.living.mealTask?.stage === 'travel');
    expect(q.cargo).toMatchObject({ resource: 'meal', amount: 1, poisonChance: .23 }); expect(q.living.mealTask?.chairId).toBe(s.chairs[0].id);
    expect(q.path.length).toBeGreaterThan(0); expect(s.stats.eaten).toBe(0); reload();
    until(s, () => q.living.mealTask?.stage === 'chew'); expect(at(q)).toBe(at(s.chairs[0])); s.step(7);
    const progress = q.living.mealTask!.progress; expect(progress).toBeGreaterThan(0); expect(s.stats.eaten).toBe(0);
    reload(); expect(q.living.mealTask!.progress).toBe(progress); until(s, () => s.stats.consumed.meal === 1);
    expect(q.food).toBeGreaterThan(90); expect(total(s, 'meal')).toBe(3); expect(q.cargo).toBeNull(); expect(q.living.mealTask).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('uses prisoner policy for delivered food, then permits self-eating even after that policy forbids the meal', () => {
    const { s, w, q } = captured(); q.food = 20; const meal = food(s), ration = food(s, 'food', 2, pos(12, 15)); policy(s, ['food']);
    cmd(s, { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }); expect(w.prisonFoodTask?.sourceId).toBe(ration.id);
    until(s, () => q.living.mealTask !== null); policy(s, []);
    expect(q.living.mealTask).not.toBeNull(); expect(q.eating).toBe('food');
    until(s, () => s.stats.consumed.food === 1); expect(s.stats.consumed.meal).toBe(0);
    expect(s.items.find(i => i.id === meal.id)?.amount).toBe(3); expect(total(s, 'food')).toBe(2);
  });

  it('starts automatic real delivery through warden priorities and does not send extra meals into a stocked cell', () => {
    const { s, w, q } = captured(); q.food = 20; const source = food(s); food(s, 'meal', 2, pos(22, 23));
    const before = s.save(); expect(s.command({ type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }).ok).toBe(false); expect(s.save()).toEqual(before);
    cmd(s, { type: 'priority', pawnId: w.id, work: 'warden', value: 1 });
    until(s, () => q.living.mealTask !== null); expect(w.prisonFoodTask).toBeUndefined();
    expect(s.items.find(i => i.id === source.id)?.amount).toBe(3);
    const whileCarried = s.save(); expect(s.command({ type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }).ok).toBe(false); expect(s.save()).toEqual(whileCarried);
    until(s, () => s.stats.eaten === 1);
    s.items = s.items.filter(i => !s.prisonCells(q)!.has(at(i))); q.food = 20;
    until(s, () => w.prisonFoodTask !== undefined); expect(w.carePhase).toBeNull();
    until(s, () => s.stats.eaten === 2); expect(total(s, 'meal')).toBe(4);
  });

  it('retains direct bedside feeding for downed and medically resting prisoners', () => {
    const { s, w, q } = captured(1, false); q.food = 10; food(s);
    expect(s.command({ type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }).ok).toBe(false);
    cmd(s, { type: 'care', pawnId: w.id, patientId: q.id, action: 'feed' });
    expect(w.carePhase).toBe('feedFetch'); expect(w.prisonFoodTask).toBeUndefined();
    until(s, () => s.stats.eaten === 1); expect(q.food).toBeGreaterThan(90); expect(q.living.mealTask).toBeNull();
    q.health.malnutrition = 0; q.food = 10; q.medical.bedRest = true;
    q.medical.infections.push({ id: s.nextId++, part: 'leftArm', createdTick: s.tick, severity: .1, immunityFactor: 1, tendQuality: null, tendUntil: 0 }); s.step();
    expect(q.downed).toBe(false); expect(s.command({ type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }).ok).toBe(false);
    cmd(s, { type: 'care', pawnId: w.id, patientId: q.id, action: 'feed' }); expect(w.prisonFoodTask).toBeUndefined();
    until(s, () => s.stats.eaten === 2); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('reserves both the recipient and scarce actual source against competing wardens', () => {
    const { s, w, q, prisoners } = captured(2), second = s.pawns[1]; for (const inmate of prisoners) inmate.food = 20;
    const source = food(s, 'meal', 1); cmd(s, { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id });
    for (const prisonerId of [q.id, prisoners[1].id]) {
      const before = s.save(); expect(s.command({ type: 'prisonFoodDeliver', pawnId: second.id, prisonerId }).ok).toBe(false); expect(s.save()).toEqual(before);
    }
    expect(second.prisonFoodTask).toBeUndefined(); expect(source.amount).toBe(1);
    cmd(s, { type: 'draft', pawnId: w.id, drafted: true }); expect(w.prisonFoodTask).toBeUndefined();
    cmd(s, { type: 'prisonFoodDeliver', pawnId: second.id, prisonerId: prisoners[1].id });
    expect(second.prisonFoodTask?.sourceId).toBe(source.id); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('cancels forbidden fetches immediately and retains an already picked meal when drafting interrupts delivery', () => {
    let { s, w, q } = captured(); q.food = 20; const source = food(s, 'meal', 2, pos(13, 15), { poisonChance: .42 });
    cmd(s, { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id });
    cmd(s, { type: 'itemForbidden', itemId: source.id, forbidden: true });
    expect(w.prisonFoodTask).toBeUndefined(); expect(s.items.find(i => i.id === source.id)?.amount).toBe(2);
    cmd(s, { type: 'itemForbidden', itemId: source.id, forbidden: false });
    cmd(s, { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }); until(s, () => w.prisonFoodTask?.stage === 'deliver');
    const cargo = structuredClone(w.cargo); cmd(s, { type: 'draft', pawnId: w.id, drafted: true });
    expect(w.prisonFoodTask).toBeUndefined(); expect(w.cargo).toEqual(cargo); expect(s.stats.eaten).toBe(0); expect(total(s, 'meal')).toBe(2);
    s = VoxelSimulation.load(s.save()); expect(s.pawns.find(p => p.id === w.id)?.cargo).toEqual(cargo);
  });

  it.each(['policy', 'release', 'bed', 'area'] as const)('interrupts delivery after %s changes without consuming or losing the carried batch', change => {
    const { s, w, q } = captured(); q.food = 20; food(s, 'meal', 2, pos(13, 15), { poisonChance: .38 });
    cmd(s, { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }); until(s, () => w.prisonFoodTask?.stage === 'deliver');
    const cargo = structuredClone(w.cargo);
    if (change === 'policy') policy(s, []);
    if (change === 'release') cmd(s, { type: 'prisonerPolicy', prisonerId: q.id, policy: 'release' });
    if (change === 'bed') cmd(s, { type: 'bedPrisoner', bedId: q.prisoner!.bedId!, prisoner: false });
    if (change === 'area') {
      const areaId = cmd(s, { type: 'allowedAreaCreate', name: '牢外' }).areaId!;
      cmd(s, { type: 'allowedAreaPaint', areaId, from: pos(0, 8), to: pos(19, 28), erase: false });
      cmd(s, { type: 'pawnAreaAssign', pawnId: w.id, areaId });
    }
    expect(w.prisonFoodTask).toBeUndefined(); expect(w.cargo).toEqual(cargo);
    expect(s.stats.eaten).toBe(0); expect(total(s, 'meal')).toBe(2);
    expect(VoxelSimulation.load(s.save()).pawns.find(p => p.id === w.id)?.cargo).toEqual(cargo);
  });

  it('fails atomically when the cell has no food landing space and reroutes when a selected landing spot fills en route', () => {
    const { s, w, q } = captured(); q.food = 20; food(s, 'meal', 2);
    const full = clutter(s, q), before = s.save();
    expect(s.command({ type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }).ok).toBe(false); expect(s.save()).toEqual(before);
    // Controlled competing stock placement changes capacity, never the food.
    const fillerIds = new Set(full.map(i => i.id)); s.items = s.items.filter(i => !fillerIds.has(i.id));
    cmd(s, { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }); until(s, () => w.prisonFoodTask?.stage === 'deliver');
    const target = structuredClone(w.prisonFoodTask!.target); clutter(s, q, target);
    until(s, () => !!w.prisonFoodTask && at(w.prisonFoodTask.target) !== at(target));
    expect(w.cargo?.amount).toBe(1); expect(s.stats.eaten).toBe(0); expect(total(s, 'meal')).toBe(2);
    until(s, () => s.stats.eaten === 1); expect(total(s, 'meal')).toBe(2);
  });

  it('waits with the original carried meal if every landing spot fills during delivery, including across reload', () => {
    let { s, w, q } = captured(); q.food = 20; food(s, 'meal', 2, pos(13, 15), { poisonChance: .61 });
    cmd(s, { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }); until(s, () => w.prisonFoodTask?.stage === 'deliver');
    clutter(s, q); until(s, () => w.reason.includes('没有放餐空间'));
    expect(w.prisonFoodTask?.stage).toBe('deliver'); expect(w.cargo).toMatchObject({ amount: 1, poisonChance: .61 }); expect(s.stats.eaten).toBe(0);
    const workerId = w.id, prisonerId = q.id; s = VoxelSimulation.load(s.save()); w = s.pawns.find(p => p.id === workerId)!; q = s.pawns.find(p => p.id === prisonerId)!;
    expect(w.prisonFoodTask?.stage).toBe('deliver'); expect(total(s, 'meal')).toBe(2);
    const target = w.prisonFoodTask!.target, blocker = s.items.find(i => at(i) === at(target) && i.resource === 'wood')!;
    expect(blocker).toBeDefined(); s.items = s.items.filter(i => i.id !== blocker.id);
    until(s, () => s.stats.eaten === 1); expect(total(s, 'meal')).toBe(2);
  });

  it('keeps a copied trader free of the donor colonist delivery task', () => {
    const { s, w, q } = captured(); q.food = 20; food(s); cmd(s, { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id });
    const task = structuredClone(w.prisonFoodTask);
    // Public trade scheduler entry isolates template copying from its arrival timer.
    s.tradeSpawn(); const visitors = s.pawns.filter(p => p.faction === 'trader'); expect(visitors.length).toBeGreaterThan(0);
    expect(visitors.every(p => !Object.hasOwn(p, 'prisonFoodTask') && p.phase !== 'prisonFood')).toBe(true);
    expect(w.prisonFoodTask).toEqual(task); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('keeps a prisoner inside a connected two-door cell after loading a dining route even when the outdoor shortcut is shorter', () => {
    let { s, q } = captured();
    const prisonerId = q.id, bed = s.beds.find(b => b.owner === q.id)!;
    // A partition reaches from the north wall to one cell short of the south
    // wall. Two open north doors make an unrestricted outdoor route cheaper.
    Object.assign(bed, pos(21, 21), { axis: 'y' });
    Object.assign(q, pos(21, 21), { phase: 'prisoner', path: [], destination: null, sleepBedId: null, sleepingSince: null });
    s.doors = [];
    s.blocks[index(24, 18, 8)] = s.blocks[index(24, 18, 9)] = Block.Stone;
    for (let y = 19; y <= 23; y++) for (let z = 8; z <= 9; z++) s.blocks[index(24, y, z)] = Block.Stone;
    for (const x of [22, 26]) {
      s.blocks[index(x, 18, 8)] = s.blocks[index(x, 18, 9)] = Block.Air;
      s.doors.push({ ...pos(x, 18), id: s.nextId++, axis: 'x', mode: 'open', openUntil: s.tick + 37 });
    }
    Object.assign(s.tables[0], pos(27, 20), { axis: 'y' });
    Object.assign(s.chairs[0], pos(26, 20), { axis: 'x' });
    s = VoxelSimulation.load(s.save()); q = s.pawns.find(p => p.id === prisonerId)!;
    food(s, 'meal', 1, pos(22, 20)); q.food = 20;
    until(s, () => q.living.mealTask?.stage === 'travel');
    const cells = s.prisonCells(q)!, target = q.living.mealTask!.target;
    expect(at(target)).toBe(at(s.chairs[0])); expect(q.path.every(cell => cells.has(cell))).toBe(true);
    const outside = s.prisonPath(q, target)!;
    expect(outside.some(cell => !cells.has(cell))).toBe(true);
    expect(outside.length).toBeLessThan(q.path.length);
    const before = structuredClone(q.cargo); s = VoxelSimulation.load(s.save()); q = s.pawns.find(p => p.id === prisonerId)!;
    expect(q.living.mealTask?.stage).toBe('travel'); expect(q.cargo).toEqual(before);
    expect(q.path.every(cell => cells.has(cell))).toBe(true);
    until(s, () => {
      expect(cells.has(at(q))).toBe(true); expect(q.path.every(cell => cells.has(cell))).toBe(true);
      return s.stats.consumed.meal === 1;
    });
    expect(q.food).toBeGreaterThan(90); expect(total(s, 'meal')).toBe(1);
  });

  it.each(['bed designation', 'broken outer door'] as const)('retains food when %s invalidates a prisoner cell during chewing', interruption => {
    const { s, q } = captured(); q.food = 20; food(s, 'meal', 1, pos(22, 23), { poisonChance: .57 });
    until(s, () => q.living.mealTask?.stage === 'chew'); s.step(7);
    const cargo = structuredClone(q.cargo); expect(s.stats.eaten).toBe(0);
    if (interruption === 'bed designation') {
      cmd(s, { type: 'bedPrisoner', bedId: q.prisoner!.bedId!, prisoner: false });
      expect(q.living.mealTask).toBeNull(); expect(q.cargo).toEqual(cargo);
    } else {
      // Public environmental destruction opens the doorway into outdoors;
      // the next simulation step must invalidate the existing dining route.
      const door = s.doors[0];
      expect(s.fireDestroy({ ...door, kind: 'door', targetId: door.id, key: fireDamageKey('door', door.id, door),
        hitPoints: 1, maxHitPoints: FIRE_MAX_HP.door }, '牢房外门损毁')).toBe(true);
      s.step(); expect(s.prisonCells(q)).toBeNull(); expect(q.living.mealTask).toBeNull();
    }
    expect(q.eating).toBeNull(); expect(q.cargo).toMatchObject({ resource: 'meal', amount: 1, poisonChance: .57 });
    expect(s.stats.eaten).toBe(0); expect(total(s, 'meal')).toBe(1);
    expect(VoxelSimulation.load(s.save()).pawns.find(p => p.id === q.id)?.cargo).toEqual(q.cargo);
  });

  it('cleans up a delivery when the recipient dies through the health simulation and keeps its carried food reloadable', () => {
    const { s, w, q } = captured(); q.food = 20; food(s, 'meal', 2, pos(13, 15), { poisonChance: .49 });
    cmd(s, { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }); until(s, () => w.prisonFoodTask?.stage === 'deliver');
    q.food = 0; q.health.malnutrition = 1; s.step();
    expect(q.dead).toBe(true); expect(q.deathReason).not.toBeNull(); expect(w.prisonFoodTask).toBeUndefined();
    expect(w.cargo).toMatchObject({ resource: 'meal', amount: 1, poisonChance: .49 });
    expect(s.stats.eaten).toBe(0); expect(total(s, 'meal')).toBe(2);
    const loaded = VoxelSimulation.load(s.save());
    expect(loaded.pawns.find(p => p.id === q.id)?.dead).toBe(true);
    expect(loaded.pawns.find(p => p.id === w.id)?.cargo).toEqual(w.cargo);
  });

  it('rejects malformed or unavailable delivery commands without changing physical or policy state', () => {
    const { s, w, q } = captured(); q.food = 20; food(s);
    for (const order of [
      { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id, extra: true },
      { type: 'prisonFoodDeliver', pawnId: q.id, prisonerId: q.id },
      { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: w.id },
      { type: 'prisonFoodDeliver', pawnId: NaN, prisonerId: q.id },
      { type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id + 999 },
    ]) {
      const before = s.save(); expect(s.command(order as VoxelCommand).ok).toBe(false); expect(s.save()).toEqual(before);
    }
    q.food = 95; const before = s.save(); expect(s.command({ type: 'prisonFoodDeliver', pawnId: w.id, prisonerId: q.id }).ok).toBe(false); expect(s.save()).toEqual(before);
  });
});
