import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, index, type Cargo, type Pos, type Resource, type VoxelCommand } from '../src/voxel/types';
import { FOOD_PREFERENCE, NUTRITION, canSelectGroundFood, foodUnitsForHunger, foodUnitsForNutrition, validSimpleMealIngredients } from '../src/voxel/farming';
import { defaultProductionPolicy, productionPolicyAllowsIngredient, validProductionPolicy } from '../src/voxel/productionPolicies';
import { freshBatch } from '../src/voxel/preservation';
import { batchMaxHitPoints, deteriorationRate, setBatchHitPoints } from '../src/voxel/deterioration';
import { cargoMarketValue } from '../src/voxel/wealth';
import { makeTraderStock, traderAccepts } from '../src/voxel/trade';
import { fireFuelAt } from '../src/voxel/fireWorld';
import { freshFertilizedEggs } from '../src/voxel/animalEggs';

const pos = (x: number, y = 16): Pos => ({ x, y, z: 8 });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c); expect(result.ok, result.message).toBe(true);
}
/** Controlled geometry and input stacks exercise actual transport, cooking,
 * dining and medical feeding; this is not evidence of a natural egg campaign. */
function fixture(cooking = false) {
  let s = new VoxelSimulation(73129, { biome: 'boreal', hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.grass = []; s.items = []; s.trees = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 28; x++) for (let y = 10; y <= 22; y++)
    for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  for (const [i, pawn] of s.pawns.entries()) {
    Object.assign(pawn, pos(12, 16 + i)); pawn.schedule.fill('work'); pawn.food = 100; pawn.rest = 100;
    for (const work of Object.keys(pawn.priorities)) pawn.priorities[work as keyof typeof pawn.priorities] = 0;
  }
  if (cooking) {
    s.pawns[0].priorities.cook = 1;
    s.stoves.push({ ...pos(12, 14), id: s.nextId++, target: 0, paused: false });
  }
  s = VoxelSimulation.load(s.save());
  command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
  return s;
}
function material(s: VoxelSimulation, resource: Resource, amount: number, point = pos(15)): Cargo {
  const batch: Cargo = resource === 'eggFertilized' ? freshFertilizedEggs(amount, 'colony') : freshBatch(resource, amount);
  s.items.push({ ...point, ...batch, id: s.nextId++ }); return batch;
}
function startBill(s: VoxelSimulation, allowedFood = defaultProductionPolicy().allowedFood) {
  const benchId = s.stoves[0].id;
  for (const bill of s.snapshot().productionQueues.find(q => q.benchId === benchId)!.bills)
    command(s, { type: 'productionBillDelete', benchId, billId: bill.id });
  command(s, { type: 'productionBillAdd', benchId, recipe: 'cook' });
  const bill = s.productionQueues.find(q => q.benchId === benchId)!.bills[0];
  command(s, { type: 'productionBillUpdate', benchId, billId: bill.id,
    patch: { policy: { ...bill.policy, allowedFood }, mode: 'count', remaining: 1 } });
  return bill.id;
}
function until(s: VoxelSimulation, done: () => boolean, max = 2500) {
  for (let tick = 0; tick < max && !done(); tick++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, jobs: s.jobs,
    pawns: s.pawns.map(p => ({ reason: p.reason, cargo: p.cargo, carePhase: p.carePhase })) })).toBe(true);
}

describe('egg nutrition, physical values and meal policies', () => {
  it('counts physical units using each food nutrition instead of treating an egg as five-hundredths', () => {
    expect(NUTRITION.eggUnfertilized).toBe(.25); expect(NUTRITION.eggFertilized).toBe(.25);
    expect(foodUnitsForNutrition('eggUnfertilized', .5)).toBe(2);
    expect(foodUnitsForNutrition('grain', .5)).toBe(10);
    expect(foodUnitsForNutrition('grain', .5000000000000001)).toBe(10);
    expect(foodUnitsForHunger('eggUnfertilized', 35)).toBe(3);
    expect(foodUnitsForHunger('eggFertilized', 0)).toBe(4);
    expect(foodUnitsForHunger('grain', 35)).toBe(13);
    expect(foodUnitsForHunger('eggUnfertilized', 100)).toBe(0);
  });
  it('allows only enough whole ingredients to reach the nutrition target with bounded overshoot', () => {
    for (const cost of [{ grain: 10 }, { eggUnfertilized: 2 }, { eggFertilized: 2 },
      { meat: 1, eggUnfertilized: 2 }, { milk: 4, eggUnfertilized: 1, grain: 1 }, { grain: 9, eggFertilized: 1 }])
      expect(validSimpleMealIngredients(cost), JSON.stringify(cost)).toBe(true);
    for (const cost of [{ eggUnfertilized: 1 }, { grain: 9 }, { eggUnfertilized: 3 },
      { grain: 10, eggFertilized: 1 }, { eggUnfertilized: Infinity }, { grain: 10.1 }, { milk: -1 }])
      expect(validSimpleMealIngredients(cost), JSON.stringify(cost)).toBe(false);
  });
  it('allows unfertilized eggs by default and protects fertilized eggs until explicitly selected', () => {
    const policy = defaultProductionPolicy(); expect(validProductionPolicy(policy)).toBe(true);
    expect(productionPolicyAllowsIngredient(policy, 'cook', { resource: 'eggUnfertilized' })).toBe(true);
    expect(productionPolicyAllowsIngredient(policy, 'cook', { resource: 'eggFertilized' })).toBe(false);
    policy.allowedFood = ['eggFertilized']; expect(validProductionPolicy(policy)).toBe(true);
    expect(productionPolicyAllowsIngredient(policy, 'cook', { resource: 'eggFertilized' })).toBe(true);
    expect(defaultProductionPolicy().allowedFood).not.toContain('eggFertilized');
    expect(FOOD_PREFERENCE.at(-1)).toBe('eggFertilized');
    expect(canSelectGroundFood('eggFertilized', .001)).toBe(false);
    expect(canSelectGroundFood('eggFertilized', 0)).toBe(true);
    expect(canSelectGroundFood('eggUnfertilized', 35)).toBe(true);
  });
  it.each(['eggUnfertilized', 'eggFertilized'] as const)('gives %s physical HP, environmental damage, trade and fire identity', resource => {
    const s = fixture(), batch = material(s, resource, 2), item = s.items[0];
    expect(batchMaxHitPoints(batch)).toBe(20);
    expect(deteriorationRate(batch, { exposed: true, outdoors: true, rainRate: 0 })).toBe(2);
    expect(deteriorationRate(batch, { exposed: true, outdoors: true, rainRate: 1 })).toBe(10);
    expect(cargoMarketValue(batch)).toBe(14);
    setBatchHitPoints(batch, 1); expect(cargoMarketValue(batch)).toBe(14);
    expect(traderAccepts('bulk', batch)).toBe(resource === 'eggUnfertilized'); expect(traderAccepts('combat', batch)).toBe(false);
    expect(fireFuelAt(s, item).find(f => f.kind === 'stack' && f.id === item.id)?.flammability).toBe(.7);
  });
  it('keeps item-stock RNG while moving chicken acquisition to actual live animals', () => {
    let nextId = 10, calls = 0;
    const stock = makeTraderStock('bulk', 1, () => nextId++, () => { calls++; return .5; });
    expect(calls).toBe(37); expect(stock).toHaveLength(17);
    expect(stock.some(item => item.resource === 'eggFertilized')).toBe(false);
    expect(stock.filter(item => item.resource === 'apparel')).toHaveLength(10);
    expect(makeTraderStock('combat', 1, () => nextId++, () => .5).some(item => item.resource === 'eggFertilized')).toBe(false);
  });
});

describe('physical egg cooking, eating and feeding', () => {
  it('delivers two real eggs, reloads the working recipe and consumes them once for one meal', () => {
    let s = fixture(true); material(s, 'eggUnfertilized', 2); material(s, 'wood', 1, pos(16)); startBill(s);
    until(s, () => s.jobs.some(j => j.kind === 'cook' && j.progress > 10));
    const job = s.jobs.find(j => j.kind === 'cook')!;
    expect(job.cost).toEqual({ wood: 1, eggUnfertilized: 2 }); expect(job.delivered.eggUnfertilized).toBe(2);
    const saved = s.save(); s = VoxelSimulation.load(saved);
    expect(s.jobs.find(j => j.id === job.id)?.progress).toBe(job.progress);
    until(s, () => s.stats.cooked === 1); s.step(60);
    expect(s.stats.cooked).toBe(1); expect(s.stats.consumed.eggUnfertilized).toBe(2);
    expect(s.stats.consumed.wood).toBe(1); expect(s.counts().meal).toBe(1);
  });
  it('handles mixed ingredient overfill without requesting ten eggs or fractional items', () => {
    let s = fixture(true); material(s, 'meat', 1, pos(14)); material(s, 'eggUnfertilized', 2);
    material(s, 'wood', 1, pos(16)); startBill(s);
    until(s, () => s.jobs.some(j => j.kind === 'cook' && j.progress > 10));
    expect(s.jobs.find(j => j.kind === 'cook')?.cost).toEqual({ wood: 1, meat: 1, eggUnfertilized: 2 });
    s = VoxelSimulation.load(s.save()); until(s, () => s.stats.cooked === 1);
    expect(s.stats.consumed.meat).toBe(1); expect(s.stats.consumed.eggUnfertilized).toBe(2);
  });
  it('waits with only one egg and rejects underfilled or unnecessarily oversized persisted costs', () => {
    const s = fixture(true); material(s, 'eggUnfertilized', 1); material(s, 'wood', 1, pos(16)); startBill(s, ['eggUnfertilized']);
    s.step(100); expect(s.stats.cooked).toBe(0); expect(s.stats.consumed.eggUnfertilized).toBe(0);
    expect(s.counts().eggUnfertilized).toBe(1);
    const saved = s.save(), job = saved.jobs.find(j => j.kind === 'cook')!; expect(job).toBeDefined();
    for (const amount of [1, 3, 100]) {
      const bad = structuredClone(saved); bad.jobs.find(j => j.id === job.id)!.cost = { wood: 1, eggUnfertilized: amount };
      expect(() => VoxelSimulation.load(bad)).toThrow();
    }
  });
  it('keeps fertilized eggs out of an ordinary meal bill and cooks them after explicit permission', () => {
    let s = fixture(true); material(s, 'eggFertilized', 2); material(s, 'wood', 1, pos(16));
    const billId = startBill(s); s.step(80);
    expect(s.stats.cooked).toBe(0); expect(s.counts().eggFertilized).toBe(2);
    const bill = s.productionQueues[0].bills.find(b => b.id === billId)!;
    command(s, { type: 'productionBillUpdate', benchId: s.stoves[0].id, billId,
      patch: { policy: { ...bill.policy, allowedFood: ['eggFertilized'] } } });
    until(s, () => s.jobs.some(j => j.kind === 'cook' && (j.delivered.eggFertilized ?? 0) === 2));
    s = VoxelSimulation.load(s.save()); until(s, () => s.stats.cooked === 1);
    expect(s.stats.consumed.eggFertilized).toBe(2); expect(s.counts().eggFertilized).toBe(0);
  });
  it('eats three eggs to fill a hungry pawn and preserves fertilized eggs when ordinary eggs are available', () => {
    const s = fixture(); s.pawns[0].food = 35;
    material(s, 'eggUnfertilized', 5, pos(14)); material(s, 'eggFertilized', 5, pos(13));
    until(s, () => s.stats.consumed.eggUnfertilized > 0);
    expect(s.stats.consumed.eggUnfertilized).toBe(3); expect(s.stats.consumed.eggFertilized).toBe(0);
    expect(s.pawns[0].food).toBe(100); expect(s.counts().eggUnfertilized).toBe(2);
    expect(s.pawns[0].psyche.memories.some(m => m.kind === 'ateRaw')).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('protects ground fertilized eggs until starvation, then eats only four to restore one nutrition', () => {
    const s = fixture(); s.pawns[0].food = 35; material(s, 'eggFertilized', 5, pos(14));
    s.step(500); expect(s.pawns[0].food).toBeLessThan(30); expect(s.pawns[0].food).toBeGreaterThan(0);
    expect(s.stats.consumed.eggFertilized).toBe(0); expect(s.counts().eggFertilized).toBe(5);
    s.pawns[0].food = 0; until(s, () => s.stats.consumed.eggFertilized > 0);
    expect(s.stats.consumed.eggFertilized).toBe(4); expect(s.pawns[0].food).toBe(100);
    expect(s.counts().eggFertilized).toBe(1);
    expect(s.pawns[0].psyche.memories.some(m => m.kind === 'ateRaw')).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('keeps the native inventory fallback distinction for fertilized eggs already carried by a hungry pawn', () => {
    const s = fixture(); const pawn = s.pawns[0]; pawn.food = 29;
    pawn.cargo = freshFertilizedEggs(5, 'colony');
    until(s, () => s.stats.consumed.eggFertilized > 0);
    expect(s.stats.consumed.eggFertilized).toBe(3); expect(pawn.food).toBe(100);
    expect(s.counts().eggFertilized).toBe(2);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('feeds a downed patient four real eggs through reservation, delivery and a saved feeding action', () => {
    let s = fixture(); let [doctor, patient] = s.pawns;
    const bed = { ...pos(22), id: s.nextId++, prisoner: false, quality: 2 as const, medical: true, owner: null, axis: 'x' as const };
    s.beds.push(bed); Object.assign(patient, pos(22)); patient.food = 0;
    patient.health.malnutrition = .82; patient.downed = true; patient.phase = 'downed'; patient.sleepBedId = bed.id;
    material(s, 'eggUnfertilized', 5, pos(16)); s = VoxelSimulation.load(s.save()); [doctor, patient] = s.pawns;
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    expect(doctor.careAmount).toBe(4);
    s = VoxelSimulation.load(s.save()); [doctor, patient] = s.pawns;
    until(s, () => doctor.carePhase === 'feed' && doctor.careProgress > 10);
    expect(doctor.cargo?.amount).toBe(4); s = VoxelSimulation.load(s.save()); [doctor, patient] = s.pawns;
    until(s, () => s.stats.consumed.eggUnfertilized === 4);
    expect(patient.food).toBe(100); expect(doctor.cargo).toBeNull(); expect(s.counts().eggUnfertilized).toBe(1);
  });
});
