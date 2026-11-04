import { describe, expect, it } from 'vitest';
import { NUTRITION } from '../src/voxel/farming';
import { DAY, type Cargo } from '../src/voxel/types';
import {
  advanceRot, compatibleBatches, freshBatch, isPerishable, mergeBatch, portion,
  remainingRotDays, rotLimit, validBatch,
} from '../src/voxel/preservation';
import {
  batchHitPoints, batchMaxHitPoints, deteriorationRate, setBatchHitPoints,
} from '../src/voxel/deterioration';
import { cargoMarketValue } from '../src/voxel/wealth';
import { carryLimit, simulateCellInsert, stackLimit } from '../src/voxel/logistics';
import { traderAccepts } from '../src/voxel/trade';
import { carcassBatch } from '../src/voxel/environment';
import { shelfAllows } from '../src/voxel/shelves';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { fireFuelAt } from '../src/voxel/fireWorld';
import { VoxelSimulation } from '../src/voxel/world';
import {
  defaultProductionPolicy, productionPolicyAllowsIngredient, validProductionPolicy,
} from '../src/voxel/productionPolicies';

describe('milk as a physical raw-food resource', () => {
  it('starts fresh, retains native nutrition and expires at fourteen warm days', () => {
    const milk = freshBatch('milk', 12);
    expect(milk).toEqual({ resource: 'milk', amount: 12, rotProgress: 0 });
    expect(validBatch(milk)).toBe(true);
    expect(isPerishable('milk')).toBe(true);
    expect(NUTRITION.milk).toBe(.05);
    expect(rotLimit(milk)).toBe(14 * DAY);
    expect(advanceRot(milk, 20, 14 * DAY - 1)).toBe(false);
    expect(advanceRot(milk, 20)).toBe(true);
    expect(remainingRotDays(milk)).toBe(0);
    expect(validBatch(milk)).toBe(false);
  });

  it('freezing pauses accumulated spoilage and thawing resumes the same batch', () => {
    const milk = freshBatch('milk', 12);
    advanceRot(milk, 20, 5 * DAY);
    expect(advanceRot(milk, -10, 100 * DAY)).toBe(false);
    expect(remainingRotDays(milk)).toBe(9);
    advanceRot(milk, 5, 2 * DAY);
    expect(remainingRotDays(milk)).toBe(8);
  });

  it('preserves age and physical damage through splits and weighted partial merges', () => {
    const source: Cargo = { resource: 'milk', amount: 60, rotProgress: 8 * DAY, hitPoints: 20 };
    const target: Cargo = { resource: 'milk', amount: 20, rotProgress: 2 * DAY, hitPoints: 50 };
    const transfer = portion(source, 10);
    expect(transfer).toEqual({ ...source, amount: 10 });
    mergeBatch(target, transfer);
    expect(target).toEqual({ resource: 'milk', amount: 30, rotProgress: 4 * DAY, hitPoints: 40 });
    expect(source).toEqual({ resource: 'milk', amount: 60, rotProgress: 8 * DAY, hitPoints: 20 });
    expect(compatibleBatches(target, freshBatch('meat', 3))).toBe(false);
    expect(() => mergeBatch(target, freshBatch('grain', 3, 'rice'))).toThrow();
  });

  it('requires its own complete unexpired metadata and rejects foreign crop or corpse metadata', () => {
    const fresh = freshBatch('milk', 2);
    for (const invalid of [
      { resource: 'milk', amount: 2 },
      { ...fresh, rotProgress: -1 },
      { ...fresh, rotProgress: Infinity },
      { ...fresh, rotProgress: 14 * DAY },
      { ...fresh, crop: 'rice' },
      { ...fresh, carcass: { species: 'hare', animalId: 1 } },
      { ...fresh, hitPoints: 61 },
    ]) expect(validBatch(invalid)).toBe(false);
  });

  it('deteriorates physically while its native market value ignores surviving condition', () => {
    const milk = freshBatch('milk', 10);
    expect(batchMaxHitPoints(milk)).toBe(60);
    expect(batchHitPoints(milk)).toBe(60);
    expect(deteriorationRate(milk, { exposed: true, outdoors: true, rainRate: 0 })).toBe(6);
    expect(deteriorationRate(milk, { exposed: true, outdoors: true, rainRate: 1 })).toBe(30);
    expect(deteriorationRate(milk, { exposed: false, outdoors: false, rainRate: 1 })).toBe(0);
    expect(cargoMarketValue(milk)).toBe(19);
    setBatchHitPoints(milk, 1);
    expect(validBatch(milk)).toBe(true);
    expect(cargoMarketValue(milk)).toBe(19);
  });

  it('obeys real stack capacity and transfers only the accepted aged portion', () => {
    const source: Cargo = { resource: 'milk', amount: 80, rotProgress: 4 * DAY };
    const target: Cargo = { resource: 'milk', amount: 70, rotProgress: DAY };
    expect(stackLimit('milk')).toBe(75);
    expect(carryLimit('milk')).toBe(75);
    const oneSlot = simulateCellInsert([target], source, 1);
    expect(oneSlot.accepted).toBe(5);
    expect(oneSlot.stacks[0]).toMatchObject({ amount: 75, rotProgress: 1.2 * DAY });
    expect(oneSlot.additions).toEqual([]);
    const shelf = simulateCellInsert([target], source, 3);
    expect(shelf.accepted).toBe(80);
    expect(shelf.additions).toEqual([{ resource: 'milk', amount: 75, rotProgress: 4 * DAY }]);
    expect(source.amount).toBe(80);
    expect(target.amount).toBe(70);
    expect(traderAccepts('bulk', source)).toBe(true);
    expect(traderAccepts('combat', source)).toBe(false);
  });

  it('recognizes milk as weak fuel at its actual physical cell', () => {
    const simulation = new VoxelSimulation(7351);
    const { x, y, z } = simulation.pawns[0];
    const item = { ...freshBatch('milk', 12), id: simulation.nextId++, x, y, z };
    simulation.items.push(item);
    expect(fireFuelAt(simulation, item).find(fuel => fuel.kind === 'stack' && fuel.id === item.id))
      .toEqual({ kind: 'stack', id: item.id, flammability: .2 });
    expect(fireFuelAt(simulation, { x: x + 1, y, z }).some(fuel => fuel.kind === 'stack' && fuel.id === item.id)).toBe(false);
  });

  it('uses the added species actual corpse size and shelf restrictions at each life stage', () => {
    const adult = carcassBatch({ id: 45, species: 'dromedary', rotProgress: DAY });
    const baby = carcassBatch({ id: 46, species: 'dromedary', rotProgress: DAY, growth: 0 });
    const juvenile = carcassBatch({ id: 47, species: 'dromedary', rotProgress: DAY, growth: .5 });
    expect(adult.carcass?.bodySize).toBe(2.1);
    expect(baby.carcass?.bodySize).toBeCloseTo(.42);
    expect(juvenile.carcass?.bodySize).toBe(1.05);
    for (const body of [adult, baby, juvenile]) expect(validBatch(body)).toBe(true);
    expect(shelfAllows(adult)).toBe(false);
    expect(shelfAllows(baby)).toBe(true);
    expect(shelfAllows(juvenile)).toBe(false);
    expect(shelfAllows({ resource: 'carcass', carcass: { animalId: 48, species: 'dromedary' } })).toBe(false);
    expect(validBatch({ ...adult, carcass: { ...adult.carcass!, bodySize: 2.2 } })).toBe(false);
    expect(defaultProductionPolicy().allowedCarcasses).toEqual(Object.keys(ANIMAL_DEFS));
    expect(productionPolicyAllowsIngredient(defaultProductionPolicy(), 'butcher', adult)).toBe(true);
  });

  it('allows milk in new meal bills and respects explicit older or milk-only filters', () => {
    const policy = defaultProductionPolicy();
    expect(validProductionPolicy(policy)).toBe(true);
    expect(productionPolicyAllowsIngredient(policy, 'cook', { resource: 'milk' })).toBe(true);
    const legacy = { ...policy, allowedFood: ['grain', 'meat'] as const };
    expect(validProductionPolicy(legacy)).toBe(true);
    const oldPolicy = { ...policy, allowedFood: ['grain', 'meat'] as Array<'grain' | 'meat' | 'milk'> };
    expect(productionPolicyAllowsIngredient(oldPolicy, 'cook', { resource: 'milk' })).toBe(false);
    const milkOnly = { ...policy, allowedFood: ['milk'] as Array<'grain' | 'meat' | 'milk'> };
    expect(validProductionPolicy(milkOnly)).toBe(true);
    expect(productionPolicyAllowsIngredient(milkOnly, 'cook', { resource: 'milk' })).toBe(true);
    expect(productionPolicyAllowsIngredient(milkOnly, 'cook', { resource: 'grain' })).toBe(false);
    expect(productionPolicyAllowsIngredient(milkOnly, 'cook', { resource: 'meat' })).toBe(false);
    milkOnly.ingredientRadius = 3;
    expect(productionPolicyAllowsIngredient(milkOnly, 'cook', { resource: 'milk' },
      { x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 0 })).toBe(false);
    expect(productionPolicyAllowsIngredient(milkOnly, 'cook', { resource: 'milk' },
      { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(defaultProductionPolicy().allowedFood).toContain('milk');
    policy.allowedFood.length = 0;
    expect(defaultProductionPolicy().allowedFood).toContain('milk');
  });
});
