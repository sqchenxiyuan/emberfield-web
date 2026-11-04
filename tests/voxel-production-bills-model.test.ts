import { describe, expect, it } from 'vitest';
import { ARMOR_KINDS, TAILOR_KINDS } from '../src/voxel/apparel';
import {
  canStartProduction, defaultProductionQueue, finishProductionBill, makeProductionBill,
  MAX_PRODUCTION_BILLS, productionJobRecipe, productionQueues, recipeAllowed, validateProductionQueues,
  type ProductionBill, type ProductionHost, type ProductionQueue,
} from '../src/voxel/productionBills';
import type { Job } from '../src/voxel/types';
import { WEAPON_DEFS, WEAPON_KINDS, type WeaponBenchKind } from '../src/voxel/weapons';

const pos = (x: number) => ({ x, y: 12, z: 8 });
function fixture(): ProductionHost {
  const kinds: WeaponBenchKind[] = ['craftingSpot', 'smithy', 'machining'];
  return {
    pawns: [],
    stoves: [{ id: 1, ...pos(10), target: 12, paused: false }],
    butcherSpots: [{ id: 2, ...pos(15), paused: true }],
    stonecutters: [{ id: 3, ...pos(20), axis: 'x', target: 80, paused: false }],
    tailors: [{ id: 4, ...pos(25), axis: 'x', bills: TAILOR_KINDS.map(kind => ({ kind, target: 2, paused: kind === 'parka' })) }],
    weaponBenches: kinds.map((kind, index) => ({
      id: 5 + index, ...pos(30 + index * 5), kind, axis: 'x', fuel: 10,
      bills: WEAPON_KINDS.filter(weapon => WEAPON_DEFS[weapon].benches.includes(kind))
        .map(weapon => ({ kind: weapon, target: 1, paused: false })),
      armorBills: kind === 'smithy' ? ARMOR_KINDS.map(armor => ({ kind: armor, target: 0, paused: true })) : [],
    })),
  };
}
const bill = (patch: Partial<ProductionBill> = {}): ProductionBill => ({ ...makeProductionBill('bill:100', 'cook'), ...patch });
const queue = (patch: Partial<ProductionBill> = {}): ProductionQueue => ({ benchId: 1, bills: [bill(patch)] });
type ModelJob = Pick<Job, 'kind' | 'apparelKind' | 'weaponKind' | 'x' | 'y' | 'z' | 'cancelled'> & { billId?: string };
const job = (patch: Partial<ModelJob> = {}): ModelJob => ({ ...pos(10), kind: 'cook', cancelled: false, billId: 'bill:100', ...patch });
const valid = (queues: unknown, host = fixture(), jobs: ModelJob[] = []) => validateProductionQueues(queues, host, 1000, jobs);

describe('production bill defaults and recipe ownership', () => {
  it('adapts every legacy bench without losing its targets, suspension or order', () => {
    const host = fixture(), resolved = productionQueues(host, []);
    expect(resolved.map(value => value.benchId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(resolved[0].bills).toEqual([bill({ id: 'legacy:1:cook', mode: 'target', target: 12 })]);
    expect(resolved[1].bills[0]).toMatchObject({ id: 'legacy:2:butcher', mode: 'forever', suspended: true });
    expect(resolved[2].bills[0]).toMatchObject({ mode: 'target', target: 80 });
    expect(resolved[3].bills.map(value => value.recipe)).toEqual(TAILOR_KINDS.map(kind => `tailoring:${kind}`));
    expect(resolved[3].bills.find(value => value.recipe === 'tailoring:parka')?.suspended).toBe(true);
    expect(resolved[5].bills.slice(-2).map(value => value.recipe)).toEqual(['armorsmith:simpleHelmet', 'armorsmith:plateArmor']);
    expect(resolved[5].bills.slice(-2).every(value => value.resumeBelow === 0)).toBe(true);
    expect(() => valid(resolved, host)).not.toThrow();
    expect(defaultProductionQueue(host, 999)).toBeUndefined();
  });

  it('preserves an intentionally empty queue and keeps override identity for state updates', () => {
    const host = fixture(), configured = { benchId: 1, bills: [] };
    const resolved = productionQueues(host, [configured]);
    expect(resolved[0]).toBe(configured);
    expect(resolved[0].bills).toEqual([]);
    const legacy = productionQueues(host, []);
    legacy[0].bills[0].target = 400;
    expect(host.stoves[0].target).toBe(12);
    expect(productionQueues(host, [configured, { benchId: 999, bills: [] }])).toHaveLength(7);
    expect(() => valid([{ benchId: 999, bills: [] }], host)).toThrow();
  });

  it('allows recipes by bench type independently of current bills or research', () => {
    const host = fixture();
    host.weaponBenches[2].bills = [];
    expect(recipeAllowed(host, 7, 'smith:machinePistol')).toBe(true);
    expect(recipeAllowed(host, 5, 'smith:machinePistol')).toBe(false);
    expect(recipeAllowed(host, 6, 'armorsmith:plateArmor')).toBe(true);
    expect(recipeAllowed(host, 7, 'armorsmith:plateArmor')).toBe(false);
    expect(recipeAllowed(host, 4, 'tailoring:shirt')).toBe(true);
    expect(recipeAllowed(host, 4, 'tailoring:plateArmor')).toBe(false);
    expect(recipeAllowed(host, 1, 'butcher')).toBe(false);
    expect(recipeAllowed(host, 99, 'cook')).toBe(false);
  });

  it('maps only production jobs to valid recipes', () => {
    expect(productionJobRecipe({ kind: 'cook' })).toBe('cook');
    expect(productionJobRecipe({ kind: 'butcher' })).toBe('butcher');
    expect(productionJobRecipe({ kind: 'stonecut' })).toBe('stonecut');
    expect(productionJobRecipe({ kind: 'tailoring', apparelKind: 'parka' })).toBe('tailoring:parka');
    expect(productionJobRecipe({ kind: 'smith', weaponKind: 'revolver' })).toBe('smith:revolver');
    expect(productionJobRecipe({ kind: 'armorsmith', apparelKind: 'simpleHelmet' })).toBe('armorsmith:simpleHelmet');
    expect(productionJobRecipe({ kind: 'armorsmith', apparelKind: 'parka' })).toBeNull();
    expect(productionJobRecipe({ kind: 'smith' })).toBeNull();
    expect(productionJobRecipe({ kind: 'mine' })).toBeNull();
  });
});

describe('production iteration and inventory hysteresis', () => {
  it('keeps finite and infinite production independent of existing stock', () => {
    const finite = bill({ remaining: 2 });
    expect(canStartProduction(finite, 10000, 10000)).toBe(true);
    finishProductionBill(finite);
    expect(finite.remaining).toBe(1);
    expect(canStartProduction(finite, 10000, 0)).toBe(true);
    finishProductionBill(finite);
    expect(canStartProduction(finite, 0, 0)).toBe(false);
    finishProductionBill(finite);
    expect(finite.remaining).toBe(0);
    const infinite = bill({ mode: 'forever', remaining: 0 });
    expect(canStartProduction(infinite, 10000, 10000)).toBe(true);
    finishProductionBill(infinite);
    expect(infinite.remaining).toBe(0);
  });

  it('blocks overproduction from pending output without falsely entering the waiting latch', () => {
    const value = bill({ mode: 'target', target: 10, pauseWhenSatisfied: true, resumeBelow: 3 });
    expect(canStartProduction(value, 7, 3)).toBe(false);
    expect(value.waiting).toBe(false);
    // Another batch was cancelled: physical count never satisfied the target.
    expect(canStartProduction(value, 7, 0)).toBe(true);
    expect(canStartProduction(value, 10, 0)).toBe(false);
    expect(value.waiting).toBe(true);
    expect(canStartProduction(value, 7, 0)).toBe(false);
    expect(canStartProduction(value, 4, 0)).toBe(false);
    expect(canStartProduction(value, 3, 0)).toBe(true);
    expect(value.waiting).toBe(false);
    finishProductionBill(value);
    expect(value.remaining).toBe(1);
  });

  it('keeps manual suspension independent of automatically waiting for stock to fall', () => {
    const value = bill({ mode: 'target', pauseWhenSatisfied: true, waiting: true, suspended: true, resumeBelow: 3 });
    expect(canStartProduction(value, 6, 0)).toBe(false);
    expect(value.waiting).toBe(true);
    value.suspended = false;
    expect(canStartProduction(value, 6, 0)).toBe(false);
    value.suspended = true;
    expect(canStartProduction(value, 3, 0)).toBe(false);
    expect(value.waiting).toBe(false);
    expect(value.suspended).toBe(true);
    value.suspended = false;
    expect(canStartProduction(value, 3, 0)).toBe(true);
  });

  it('clears the latch when hysteresis is disabled and treats zero target as satisfied', () => {
    const value = bill({ mode: 'target', waiting: true });
    expect(canStartProduction(value, 9, 0)).toBe(true);
    expect(value.waiting).toBe(false);
    const zero = bill({ mode: 'target', target: 0, resumeBelow: 0, pauseWhenSatisfied: true });
    expect(canStartProduction(zero, 0, 0)).toBe(false);
    expect(zero.waiting).toBe(true);
    const equal = bill({ mode: 'target', target: 5, resumeBelow: 5, pauseWhenSatisfied: true });
    expect(canStartProduction(equal, 5, 0)).toBe(false);
    expect(canStartProduction(equal, 4, 0)).toBe(true);
  });
});

describe('strict production queue persistence', () => {
  it('accepts duplicate recipes with distinct identities, a zero-bill queue, and the exact bill limit', () => {
    expect(() => valid([{ benchId: 1, bills: [bill(), bill({ id: 'bill:101' })] }])).not.toThrow();
    expect(() => valid([{ benchId: 1, bills: [] }])).not.toThrow();
    const many = Array.from({ length: MAX_PRODUCTION_BILLS }, (_, i) => bill({ id: `bill:${100 + i}` }));
    expect(() => valid([{ benchId: 1, bills: many }])).not.toThrow();
    expect(() => valid([{ benchId: 1, bills: [...many, bill({ id: 'bill:200' })] }])).toThrow();
  });

  it('rejects duplicate queue or global bill identities, unknown benches and incorrect legacy ownership', () => {
    expect(() => valid([queue(), queue()])).toThrow();
    expect(() => valid([queue(), { benchId: 2, bills: [bill({ recipe: 'butcher' })] }])).toThrow();
    expect(() => valid([{ benchId: 999, bills: [] }])).toThrow();
    expect(() => valid([queue({ id: 'legacy:2:cook' })])).toThrow();
    expect(() => valid([queue({ id: 'legacy:1:butcher' })])).toThrow();
    expect(() => valid([queue({ recipe: 'butcher' })])).toThrow();
    expect(() => valid([queue({ id: 'legacy:1:cook' })])).not.toThrow();
  });

  it.each(['bill:0', 'bill:1', 'bill:-1', 'bill:01', 'bill:1.5', 'bill:1000', 'bill:9007199254740992', 'other:100', 'legacy:0:cook', 'legacy:1:unknown'])(
    'rejects malformed or unallocated bill id %s', id => expect(() => valid([queue({ id })])).toThrow(),
  );

  it('rejects missing, extra, mistyped, nonintegral and out-of-range fields without mutation', () => {
    const corruptions: ((value: any) => void)[] = [
      value => { delete value.bills[0].waiting; },
      value => { value.bills[0].surprise = true; },
      value => { value.surprise = true; },
      value => { value.bills[0].remaining = -1; },
      value => { value.bills[0].remaining = 1.5; },
      value => { value.bills[0].remaining = 100001; },
      value => { value.bills[0].target = NaN; },
      value => { value.bills[0].resumeBelow = 11; },
      value => { value.bills[0].suspended = 0; },
      value => { value.bills[0].pauseWhenSatisfied = 'false'; },
      value => { value.bills[0].waiting = true; },
      value => { value.bills[0].mode = 'target'; value.bills[0].waiting = true; },
      value => { value.bills[0].mode = 'unknown'; },
      value => { value.bills[0].recipe = 'cook:extra'; },
      value => { value.bills = {}; },
    ];
    for (const corrupt of corruptions) {
      const value = queue(); corrupt(value);
      const before = structuredClone(value);
      expect(() => valid([value])).toThrow();
      expect(value).toEqual(before);
    }
    for (const value of [null, {}, false, [null], [['not a queue']]]) expect(() => valid(value)).toThrow();
  });

  it('validates active job identity, recipe, position and suspension', () => {
    expect(() => valid([queue()], fixture(), [job()])).not.toThrow();
    expect(() => valid([queue()], fixture(), [job({ billId: 'bill:101' })])).toThrow();
    expect(() => valid([queue()], fixture(), [job({ kind: 'butcher' })])).toThrow();
    expect(() => valid([queue()], fixture(), [job({ x: 11 })])).toThrow();
    expect(() => valid([queue({ suspended: true })], fixture(), [job()])).toThrow();
    expect(() => valid([], fixture(), [job({ kind: 'mine' })])).toThrow();
    expect(() => valid([queue()], fixture(), [job({ billId: undefined })])).toThrow();
  });

  it('allows an existing iteration after count zero or target satisfaction, and after reordering', () => {
    expect(() => valid([queue({ remaining: 0 })], fixture(), [job()])).not.toThrow();
    expect(() => valid([queue({ mode: 'target', target: 0, resumeBelow: 0, pauseWhenSatisfied: true, waiting: true })], fixture(), [job()])).not.toThrow();
    const reordered = { benchId: 1, bills: [bill({ id: 'bill:101' }), bill()] };
    expect(() => valid([reordered], fixture(), [job()])).not.toThrow();
  });

  it('accepts missing job identities only for legacy benches without an explicit queue', () => {
    const old = job(); delete old.billId;
    expect(() => valid([], fixture(), [old])).not.toThrow();
    expect(() => valid([queue()], fixture(), [old])).toThrow();
    expect(() => valid([{ benchId: 1, bills: [] }], fixture(), [old])).toThrow();
    expect(() => valid([], fixture(), [job({ billId: 'legacy:1:cook' })])).not.toThrow();
    expect(() => valid([], fixture(), [job({ billId: 'legacy:2:butcher' })])).toThrow();
  });

  it('keeps cancelled input-refund jobs loadable after deleting their bill or bench', () => {
    const host = fixture(); host.stoves = [];
    expect(() => valid([], host, [job({ cancelled: true })])).not.toThrow();
    expect(() => valid([], host, [job({ cancelled: true, billId: 'legacy:1:cook' })])).not.toThrow();
    const old = job({ cancelled: true }); delete old.billId;
    expect(() => valid([], host, [old])).not.toThrow();
    expect(() => valid([], host, [job({ cancelled: true, billId: 'bill:1000' })])).toThrow();
    expect(() => valid([], host, [job({ cancelled: true, billId: 'garbage' })])).toThrow();
  });
});
