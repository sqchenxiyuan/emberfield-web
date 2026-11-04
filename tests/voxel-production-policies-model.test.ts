import { describe, expect, it } from 'vitest';
import {
  defaultProductionPolicy, makeProductionBill, productionPolicyAllowsIngredient,
  productionPolicyWorkerReason, validProductionPolicy, validateProductionQueues,
  type ProductionHost, type ProductionPolicy,
} from '../src/voxel/productionBills';
import { initialSkills } from '../src/voxel/skills';
import type { Job, Pawn } from '../src/voxel/types';

const policy = (patch: Partial<ProductionPolicy> = {}): ProductionPolicy => ({ ...defaultProductionPolicy(), ...patch });
const bench = { x: 10, y: 10, z: 8 };
function host(): ProductionHost {
  return {
    pawns: [], stoves: [{ id: 1, ...bench, target: 10, paused: false }],
    butcherSpots: [], stonecutters: [], tailors: [], weaponBenches: [],
  };
}
const queues = (value = policy()) => [{ benchId: 1, bills: [{ ...makeProductionBill('bill:20', 'cook'), policy: value }] }];
type ModelJob = Pick<Job, 'kind' | 'apparelKind' | 'weaponKind' | 'x' | 'y' | 'z' | 'cancelled'> & {
  billId?: string; productionPolicy?: ProductionPolicy;
};
const job = (patch: Partial<ModelJob> = {}): ModelJob => ({ kind: 'cook', ...bench, cancelled: false, billId: 'bill:20', ...patch });

describe('production policy worker and input rules', () => {
  it('defaults to unrestricted workers, skills and inputs without sharing mutable lists', () => {
    const a = defaultProductionPolicy(), b = defaultProductionPolicy();
    expect(a).toEqual({ workerId: null, skillMin: 0, skillMax: 20, ingredientRadius: null,
      allowedFood: ['grain', 'meat', 'milk'], allowedCarcasses: ['hare', 'deer', 'alpaca', 'dromedary'],
      allowedTextiles: ['cloth', 'alpacaWool'] });
    expect(validProductionPolicy(a)).toBe(true);
    a.allowedFood.length = 0; a.allowedCarcasses.length = 0; a.allowedTextiles.length = 0;
    expect(b.allowedFood).toHaveLength(3); expect(b.allowedCarcasses).toHaveLength(4);
    expect(b.allowedTextiles).toEqual(['cloth', 'alpacaWool']);
    const first = makeProductionBill('bill:20', 'cook'), second = makeProductionBill('bill:21', 'cook');
    first.policy.allowedFood.length = 0;
    expect(second.policy.allowedFood).toEqual(['grain', 'meat', 'milk']);
  });

  it('uses the recipe main skill and accepts both ends of the player interval', () => {
    const pawn = { id: 10, skills: initialSkills(0) };
    pawn.skills.cooking.level = 4; pawn.skills.crafting.level = 8;
    const range = policy({ skillMin: 4, skillMax: 8 });
    for (const recipe of ['cook', 'butcher', 'stonecut', 'tailoring:shirt', 'smith:woodClub', 'armorsmith:plateArmor'] as const)
      expect(productionPolicyWorkerReason(range, recipe, pawn)).toBeNull();
    pawn.skills.cooking.level = 3;
    expect(productionPolicyWorkerReason(range, 'cook', pawn)).toContain('烹饪');
    expect(productionPolicyWorkerReason(range, 'stonecut', pawn)).toBeNull();
    pawn.skills.crafting.level = 9;
    expect(productionPolicyWorkerReason(range, 'smith:woodClub', pawn)).toContain('工艺');
  });

  it('lets a named worker bypass the player range but rejects other workers', () => {
    const pawn = { id: 10, skills: initialSkills(0) }, named = policy({ workerId: 10, skillMin: 20, skillMax: 20 });
    pawn.skills.cooking.level = 0; pawn.skills.crafting.level = 0;
    expect(productionPolicyWorkerReason(named, 'cook', pawn)).toBeNull();
    expect(productionPolicyWorkerReason(named, 'smith:steelLongsword', pawn)).toBeNull();
    expect(productionPolicyWorkerReason(named, 'smith:steelLongsword', { ...pawn, id: 11 })).not.toBeNull();
    // Recipe hard requirements are deliberately not implemented in this helper.
    expect(productionPolicyWorkerReason(policy(), 'smith:steelLongsword', pawn)).toBeNull();
  });

  it('filters only variable food/carcass slots, leaving fixed-cost inputs enabled', () => {
    const none = policy({ allowedFood: [], allowedCarcasses: [] });
    expect(productionPolicyAllowsIngredient(none, 'cook', { resource: 'grain' })).toBe(false);
    expect(productionPolicyAllowsIngredient(none, 'cook', { resource: 'meat' })).toBe(false);
    expect(productionPolicyAllowsIngredient(none, 'cook', { resource: 'wood' })).toBe(true);
    expect(productionPolicyAllowsIngredient(none, 'tailoring:shirt', { resource: 'cloth' })).toBe(true);
    expect(productionPolicyAllowsIngredient(none, 'smith:steelKnife', { resource: 'steel' })).toBe(true);
    expect(productionPolicyAllowsIngredient(none, 'stonecut', { resource: 'chunk' })).toBe(true);
    const meatOnly = policy({ allowedFood: ['meat'] });
    expect(productionPolicyAllowsIngredient(meatOnly, 'cook', { resource: 'meat' })).toBe(true);
    expect(productionPolicyAllowsIngredient(meatOnly, 'cook', { resource: 'grain' })).toBe(false);
  });

  it('checks the actual corpse species and rejects carcasses without species data', () => {
    const deerOnly = policy({ allowedCarcasses: ['deer'] });
    expect(productionPolicyAllowsIngredient(deerOnly, 'butcher', { resource: 'carcass', carcass: { animalId: 50, species: 'deer' } })).toBe(true);
    expect(productionPolicyAllowsIngredient(deerOnly, 'butcher', { resource: 'carcass', carcass: { animalId: 51, species: 'hare' } })).toBe(false);
    expect(productionPolicyAllowsIngredient(deerOnly, 'butcher', { resource: 'carcass' })).toBe(false);
  });

  it('uses strict 3D anchor distance and still limits fixed-slot ingredients', () => {
    const limited = policy({ ingredientRadius: 5 });
    const wood = { resource: 'wood' as const };
    expect(productionPolicyAllowsIngredient(limited, 'cook', wood, { x: 13, y: 13, z: 8 }, bench)).toBe(true);
    expect(productionPolicyAllowsIngredient(limited, 'cook', wood, { x: 13, y: 14, z: 8 }, bench)).toBe(false);
    expect(productionPolicyAllowsIngredient(limited, 'cook', wood, { x: 13, y: 10, z: 12 }, bench)).toBe(false);
    expect(productionPolicyAllowsIngredient(limited, 'cook', wood, { x: 10, y: 10, z: 13 }, bench)).toBe(false);
    expect(productionPolicyAllowsIngredient(limited, 'cook', wood, { x: 10, y: 10, z: 12 }, bench)).toBe(true);
    expect(productionPolicyAllowsIngredient(policy(), 'cook', wood, { x: 500, y: 500, z: 500 }, bench)).toBe(true);
  });

  it('skips radius when a carried/delivered input has no source while retaining its category filter', () => {
    const limited = policy({ ingredientRadius: 3, allowedFood: ['meat'] });
    expect(productionPolicyAllowsIngredient(limited, 'cook', { resource: 'wood' }, undefined, bench)).toBe(true);
    expect(productionPolicyAllowsIngredient(limited, 'cook', { resource: 'meat' })).toBe(true);
    expect(productionPolicyAllowsIngredient(limited, 'cook', { resource: 'grain' })).toBe(false);
  });
});

describe('strict production policy persistence', () => {
  it('requires exactly the policy fields and valid bounded integer values and unique filter entries', () => {
    const mutate: Array<(value: any) => void> = [
      p => { delete p.workerId; }, p => { p.extra = false; }, p => { p.workerId = 0; },
      p => { p.workerId = 1.1; }, p => { p.workerId = '10'; }, p => { p.workerId = Infinity; },
      p => { p.skillMin = -1; }, p => { p.skillMax = 21; }, p => { p.skillMin = 10; p.skillMax = 9; },
      p => { p.skillMin = 1.5; }, p => { p.ingredientRadius = 0; }, p => { p.ingredientRadius = 2; },
      p => { p.ingredientRadius = 101; }, p => { p.ingredientRadius = 3.1; }, p => { p.ingredientRadius = NaN; },
      p => { p.allowedFood = ['grain', 'grain']; }, p => { p.allowedFood = ['wood']; },
      p => { p.allowedFood = new Array(1); }, p => { p.allowedFood = null; },
      p => { p.allowedCarcasses = ['deer', 'deer']; }, p => { p.allowedCarcasses = ['rabbit']; },
      p => { p.allowedCarcasses = new Array(1); },
    ];
    for (const change of mutate) {
      const value = policy(); change(value);
      expect(validProductionPolicy(value), JSON.stringify(value)).toBe(false);
      expect(() => validateProductionQueues(queues(value), host(), 100, [])).toThrow();
    }
    for (const radius of [null, 3, 100])
      expect(validProductionPolicy(policy({ ingredientRadius: radius, skillMin: 20, skillMax: 20, allowedFood: [], allowedCarcasses: [] }))).toBe(true);
    for (const value of [null, [], false, {}, undefined]) expect(validProductionPolicy(value)).toBe(false);
  });

  it('requires policy on current bills and a currently existing referenced worker without silently repairing data', () => {
    const missing = queues() as any; delete missing[0].bills[0].policy;
    expect(() => validateProductionQueues(missing, host(), 100, [])).toThrow();
    const current = queues(policy({ workerId: 10 })), before = structuredClone(current), h = host();
    expect(() => validateProductionQueues(current, h, 100, [])).toThrow();
    expect(current).toEqual(before);
    // Death and faction change are world cleanup decisions; the ID still exists.
    h.pawns = [{ id: 10, dead: true, faction: 'raider' } as Pawn];
    expect(() => validateProductionQueues(current, h, 100, [])).not.toThrow();
    expect(current).toEqual(before);
  });

  it('validates optional frozen job policies independently of the current queue and historical worker existence', () => {
    const frozen = policy({ workerId: 70, ingredientRadius: 3, allowedFood: ['grain'], skillMin: 7, skillMax: 9 });
    expect(() => validateProductionQueues(queues(), host(), 100, [job({ productionPolicy: frozen })])).not.toThrow();
    expect(() => validateProductionQueues(queues(), host(), 100, [job()])).not.toThrow();
    const cancelled = job({ billId: 'bill:21', cancelled: true, productionPolicy: frozen });
    expect(() => validateProductionQueues([], host(), 100, [cancelled])).not.toThrow();
    expect(() => validateProductionQueues(queues(), host(), 100, [job({ productionPolicy: undefined })])).toThrow();
    expect(() => validateProductionQueues([], host(), 100, [{ ...cancelled, productionPolicy: { ...frozen, ingredientRadius: 1 } }])).toThrow();
  });

  it('rejects productionPolicy on every non-production job, including undefined and cancelled properties', () => {
    const nonProduction = job({ kind: 'mine' }); delete nonProduction.billId;
    expect(() => validateProductionQueues([], host(), 100, [nonProduction])).not.toThrow();
    expect(() => validateProductionQueues([], host(), 100, [{ ...nonProduction, productionPolicy: policy() }])).toThrow();
    expect(() => validateProductionQueues([], host(), 100, [{ ...nonProduction, cancelled: true, productionPolicy: undefined }])).toThrow();
  });
});
