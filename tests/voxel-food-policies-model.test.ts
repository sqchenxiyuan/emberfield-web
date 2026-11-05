import { describe, expect, it } from 'vitest';
import { createDefaultApparelPolicies, initialApparelControl } from '../src/voxel/apparelPolicies';
import { FOOD_PREFERENCE } from '../src/voxel/farming';
import { FOOD_POLICY_RESOURCES, createDefaultFoodPolicies, normalizeFoodPolicy, policyAllowsFood } from '../src/voxel/foodPolicies';
import { migrateFoodPolicies, rejectLegacyFoodPolicies, validateFoodPolicies } from '../src/voxel/foodPoliciesPersistence';
import type { VoxelSave } from '../src/voxel/types';
import { stripAnimalEnvironmentFields } from './legacy-animal-environment-defaults';
import { apparelPoliciesExpectedField, stripApparelPoliciesFields } from './legacy-apparel-policies-defaults';
import { foodPoliciesExpectedField, stripFoodPoliciesFields } from './legacy-food-policies-defaults';

const graph = () => ({ version: 57, tick: 100, nextId: 1, foodPolicies: createDefaultFoodPolicies(),
  apparelPolicies: createDefaultApparelPolicies(),
  pawns: ['colony', 'prisoner', 'trader', 'raider'].map((faction, i) => ({ id: i + 1, faction,
    foodPolicyId: faction === 'colony' ? 1 : null, apparelTask: null,
    apparelControl: initialApparelControl(100, faction === 'colony' ? 1 : null) })) } as unknown as VoxelSave);

function manualGraph(stage: 'fetch' | 'ground' | 'carried') {
  const d = graph(); d.nextId = 20;
  d.foodPolicies.policies[0].allowedResources = []; // A deliberate player order overrides the policy.
  d.items = stage === 'carried' ? [] : [{ id: 19, x: 12, y: 12, z: 8, resource: 'meal', amount: 2, forbidden: true }];
  Object.assign(d.pawns[0], { phase: stage === 'fetch' ? 'fetch' : 'dine', dead: false, downed: false, drafted: false,
    carriedBy: null, eating: 'meal', jobId: null, psyche: { breakUntil: 0 },
    manualFoodOrder: { sourceId: 19, resource: 'meal' }, cargo: stage === 'carried' ? { resource: 'meal', amount: 1 } : null,
    living: { mealTask: stage === 'fetch' ? null : { sourceId: stage === 'carried' ? null : 19, amount: 1,
      stage: 'chew', chairId: null, tableId: null, target: { x: 12, y: 12, z: 8 }, progress: 20 } } });
  return d;
}

describe('shared food policy model', () => {
  it('starts unrestricted, follows actual food ordering and owns fresh collections', () => {
    const a = createDefaultFoodPolicies(), b = createDefaultFoodPolicies();
    expect(FOOD_POLICY_RESOURCES).toEqual(FOOD_PREFERENCE);
    expect(FOOD_POLICY_RESOURCES).toEqual(['meal', 'food', 'milk', 'eggUnfertilized', 'grain', 'meat', 'eggFertilized']);
    expect(a).toEqual({ nextId: 2, policies: [{ id: 1, name: '不限制', allowedResources: [...FOOD_PREFERENCE] }] });
    a.policies[0].allowedResources.pop(); a.policies[0].name = 'Changed'; a.policies.push({ id: 2, name: 'None', allowedResources: [] });
    expect(b).toEqual(createDefaultFoodPolicies()); expect(FOOD_POLICY_RESOURCES).toHaveLength(7);
  });
  it('canonicalizes valid commands without mutating user input and permits an empty filter', () => {
    const raw = { id: 12, name: '  仅储备餐  ', allowedResources: ['food', 'meal', 'food'] };
    const before = structuredClone(raw);
    expect(normalizeFoodPolicy(raw)).toEqual({ id: 12, name: '仅储备餐', allowedResources: ['meal', 'food'] });
    expect(raw).toEqual(before);
    expect(normalizeFoodPolicy({ id: 1, name: '不自动进食', allowedResources: [] })?.allowedResources).toEqual([]);
  });
  it('rejects malformed command data instead of silently repairing it', () => {
    const policy = createDefaultFoodPolicies().policies[0];
    const patches = [{ id: 0 }, { id: -1 }, { id: .5 }, { id: NaN }, { id: Infinity }, { id: Number.MAX_SAFE_INTEGER + 1 },
      { name: '' }, { name: '  ' }, { name: 'a'.repeat(41) }, { name: '\tfood' }, { name: 'bad\nname' },
      { name: 7 }, { allowedResources: null }, { allowedResources: 'meal' }, { allowedResources: ['wood'] },
      { allowedResources: [undefined] }, { allowedResources: new Array(2) }, { provenance: 'vegetarian' }];
    for (const patch of patches) expect(normalizeFoodPolicy({ ...policy, ...patch })).toBeNull();
    for (const value of [null, undefined, [], 1, 'policy', { id: 1, name: 'Missing list' }]) expect(normalizeFoodPolicy(value)).toBeNull();
  });
  it('filters the direct food kind without inferring meal ingredients or starvation exceptions', () => {
    const policy = { id: 2, name: '只吃成品', allowedResources: ['meal', 'food'] as ('meal' | 'food')[] };
    expect(FOOD_POLICY_RESOURCES.filter(resource => policyAllowsFood(policy, resource))).toEqual(['meal', 'food']);
    expect(policyAllowsFood(policy, 'wood')).toBe(false);
    expect(policyAllowsFood({ ...policy, allowedResources: [] }, 'meal')).toBe(false);
    expect(policyAllowsFood(createDefaultFoodPolicies().policies[0], 'eggFertilized')).toBe(true);
  });
});

describe('food policy save validation and migration', () => {
  it('validates independent policy ids and references without mutating saved tasks', () => {
    const d = graph(); d.pawns[1].foodPolicyId = 1;
    Object.assign(d.pawns[0], { eating: { resource: 'meat', amount: 1 }, food: 0, drafted: true });
    d.foodPolicies.policies[0].allowedResources = ['meal'];
    const before = structuredClone(d); expect(() => validateFoodPolicies(d)).not.toThrow(); expect(d).toEqual(before);
    expect(d.nextId).toBe(1); // Policy ids do not consume physical entity ids.
  });
  it('allows any valid shared id, unused definitions and all-unrestricted pawns', () => {
    const d = graph();
    d.foodPolicies = { nextId: 13, policies: [{ id: 12, name: 'Special', allowedResources: [] }] };
    for (const p of d.pawns) p.foodPolicyId = null;
    expect(() => validateFoodPolicies(d)).not.toThrow();
    d.pawns[0].foodPolicyId = 12; d.pawns[1].foodPolicyId = 12;
    expect(() => validateFoodPolicies(d)).not.toThrow();
  });
  it('rejects malformed collections and noncanonical policy definitions atomically', () => {
    const mutations = [
      (d: any) => { delete d.foodPolicies; }, (d: any) => { d.foodPolicies = null; },
      (d: any) => { d.foodPolicies.extra = 1; }, (d: any) => { d.foodPolicies.nextId = 1; },
      (d: any) => { d.foodPolicies.nextId = Infinity; }, (d: any) => { d.foodPolicies.policies = []; },
      (d: any) => { d.foodPolicies.policies = new Array(2); },
      (d: any) => { d.foodPolicies.policies[0].allowedResources.reverse(); },
      (d: any) => { d.foodPolicies.policies[0].allowedResources.push('meal'); },
      (d: any) => { d.foodPolicies.policies[0].allowedResources.push('wood'); },
      (d: any) => { d.foodPolicies.policies[0].name = ' leading'; },
      (d: any) => { d.foodPolicies.policies[0].id = 0; },
      (d: any) => { d.foodPolicies.policies[0].extra = true; },
      (d: any) => { d.foodPolicies.policies.push(structuredClone(d.foodPolicies.policies[0])); },
      (d: any) => { d.foodPolicies.policies = Array.from({ length: 17 }, (_, i) => ({ id: i + 1, name: 'Policy', allowedResources: [] })); d.foodPolicies.nextId = 18; },
    ];
    for (const mutate of mutations) { const d = graph(); mutate(d); const before = structuredClone(d);
      expect(() => validateFoodPolicies(d)).toThrow(/饮食政策存档/); expect(d).toEqual(before); }
  });
  it('requires explicit valid references and forbids policies on external pawns', () => {
    for (const value of [undefined, 0, -1, 2, '1', NaN, Infinity]) {
      const d = graph(); Object.assign(d.pawns[0], { foodPolicyId: value });
      expect(() => validateFoodPolicies(d)).toThrow(/人物政策/);
    }
    for (const i of [2, 3]) { const d = graph(); d.pawns[i].foodPolicyId = 1;
      expect(() => validateFoodPolicies(d)).toThrow(/人物政策/); }
    const missing: any = graph(); delete missing.pawns[0].foodPolicyId;
    expect(() => validateFoodPolicies(missing)).toThrow(/人物政策/);
    for (const pawns of [undefined, null, [null], [3], new Array(1)]) {
      const d: any = graph(); d.pawns = pawns; expect(() => validateFoodPolicies(d)).toThrow(/饮食政策存档/);
    }
  });
  it('rejects every old-version injection even if the new value is empty or undefined', () => {
    for (const version of [1, 50, 55, 56]) {
      for (const mutate of [(d: any) => { d.foodPolicies = undefined; }, (d: any) => { d.foodPolicies = null; },
        (d: any) => { d.pawns[1].foodPolicyId = null; }, (d: any) => { d.pawns[1].foodPolicyId = undefined; },
        (d: any) => { d.pawns[1].manualFoodOrder = undefined; },
        (d: any) => { d.pawns[1].manualFoodOrder = { sourceId: 19, resource: 'meal' }; }]) {
        const d: any = { version, pawns: [{ faction: 'colony' }, { faction: 'prisoner' }] };
        mutate(d); const before = structuredClone(d);
        expect(() => rejectLegacyFoodPolicies(d, version)).toThrow(/旧版本混入/);
        expect(() => migrateFoodPolicies(d, version)).toThrow(/旧版本混入/); expect(d).toEqual(before);
      }
    }
  });
  it('migrates all historical factions to unrestricted and preserves physical food and work', () => {
    const old: any = { version: 56, nextId: 1, pawns: ['colony', 'prisoner', 'trader', 'raider'].map(faction => ({ faction,
      eating: { resource: 'meal', amount: 1 }, carePhase: 'fetchFood', careFoodId: 19, cargo: { resource: 'grain', amount: 7 } })) };
    const before = structuredClone(old); migrateFoodPolicies(old, 56);
    expect(old).toEqual({ ...before, foodPolicies: createDefaultFoodPolicies(),
      pawns: before.pawns.map((p: any) => ({ ...p, foodPolicyId: null })) });
    expect(old.pawns.every((p: any) => !Object.hasOwn(p, 'manualFoodOrder'))).toBe(true);
    const current = graph(), copy = structuredClone(current);
    migrateFoodPolicies(current, 57); rejectLegacyFoodPolicies(current, 57); expect(current).toEqual(copy);
  });
  it('preflights malformed late carriers before creating any defaults', () => {
    for (const bad of [null, [], 1, 'pawn', undefined]) {
      const old: any = { version: 56, pawns: [{ faction: 'colony' }, bad] }, before = structuredClone(old);
      expect(() => migrateFoodPolicies(old, 56)).toThrow(/迁移人物/); expect(old).toEqual(before);
    }
    const sparse: any = { version: 56, pawns: new Array(1) }, before = structuredClone(sparse);
    expect(() => migrateFoodPolicies(sparse, 56)).toThrow(/迁移人物/); expect(sparse).toEqual(before);
  });
  it('limits synthetic downgrades to unchanged defaults across the full predecessor helper chain', () => {
    for (const strip of [stripFoodPoliciesFields, stripApparelPoliciesFields, stripAnimalEnvironmentFields]) {
      for (const mutate of [(d: any) => { d.foodPolicies.policies[0].name = 'Custom'; },
        (d: any) => { d.foodPolicies.policies[0].allowedResources = ['meal']; },
        (d: any) => { d.foodPolicies.nextId = 3; }, (d: any) => { d.pawns[0].foodPolicyId = 2; },
        (d: any) => { d.pawns[2].foodPolicyId = 1; }]) {
        const d = graph(); mutate(d); const before = structuredClone(d);
        expect(() => strip(d)).toThrow(); expect(d).toEqual(before);
      }
      const d: any = graph(); strip(d);
      expect(Object.hasOwn(d, 'foodPolicies')).toBe(false); expect(d.pawns.every((p: any) => !Object.hasOwn(p, 'foodPolicyId'))).toBe(true);
    }
  });
  it('expected-value adapters add only missing historical fields without rewriting current assignments', () => {
    const pawns = [{ faction: 'colony' }, { faction: 'prisoner', foodPolicyId: 7 }], before = structuredClone(pawns);
    expect(foodPoliciesExpectedField('pawns', pawns)).toEqual([
      { faction: 'colony', foodPolicyId: null, animalsReleased: false }, { ...pawns[1], animalsReleased: false },
    ]);
    expect(apparelPoliciesExpectedField('pawns', pawns, 80)[0]).toEqual({ faction: 'colony', foodPolicyId: null,
      apparelControl: initialApparelControl(80), animalsReleased: false });
    expect(pawns).toEqual(before);
  });
});

describe('explicit ingestion order persistence', () => {
  it.each(['fetch', 'ground', 'carried'] as const)('accepts real %s food despite policy and forbidden flags', stage => {
    const d = manualGraph(stage), before = structuredClone(d);
    expect(() => validateFoodPolicies(d)).not.toThrow(); expect(d).toEqual(before);
    if (stage === 'carried') expect(d.items).toEqual([]); // The original id is retained after the stack disappears.
  });
  it('rejects malformed orders, non-food kinds and ids outside the physical namespace without mutation', () => {
    const mutations = [
      (d: any) => { d.pawns[0].manualFoodOrder = null; }, (d: any) => { d.pawns[0].manualFoodOrder = undefined; },
      (d: any) => { d.pawns[0].manualFoodOrder = []; }, (d: any) => { d.pawns[0].manualFoodOrder.extra = true; },
      (d: any) => { delete d.pawns[0].manualFoodOrder.resource; },
      ...[0, -1, .5, NaN, Infinity, '19', 20, 21].map(value => (d: any) => { d.pawns[0].manualFoodOrder.sourceId = value; }),
      (d: any) => { d.nextId = Infinity; },
      (d: any) => { d.pawns[0].manualFoodOrder.resource = 'wood'; d.pawns[0].eating = 'wood'; },
    ];
    for (const mutate of mutations) { const d = manualGraph('carried'); mutate(d); const before = structuredClone(d);
      expect(() => validateFoodPolicies(d)).toThrow(/手动进食/); expect(d).toEqual(before); }
  });
  it('rejects orders outside active, eligible colony eating states', () => {
    const patches = [{ phase: 'idle' }, { phase: 'mental' }, { phase: 'work' }, { eating: null }, { eating: 'food' },
      { faction: 'prisoner' }, { faction: 'raider', foodPolicyId: null }, { faction: 'trader', foodPolicyId: null },
      { dead: true }, { downed: true }, { drafted: true }, { carriedBy: 2 }, { carriedBy: undefined },
      { psyche: null }, { psyche: { breakUntil: 101 } }, { psyche: { breakUntil: Infinity } }];
    for (const patch of patches) { const d = manualGraph('fetch'); Object.assign(d.pawns[0], patch);
      expect(() => validateFoodPolicies(d)).toThrow(/手动进食/); }
    const d = manualGraph('fetch'); d.pawns[0].psyche.breakUntil = d.tick;
    expect(() => validateFoodPolicies(d)).not.toThrow();
  });
  it('requires the exact fetch source rather than another edible stack or unrelated work', () => {
    const mutations = [(d: any) => { d.items = []; }, (d: any) => { d.items[0].id = 18; },
      (d: any) => { d.items[0].resource = 'food'; }, (d: any) => { d.items[0].amount = 0; },
      (d: any) => { d.pawns[0].jobId = 18; }];
    for (const mutate of mutations) { const d = manualGraph('fetch'); mutate(d);
      expect(() => validateFoodPolicies(d)).toThrow(/取食来源/); }
  });
  it('requires the dining source to match actual carried food or the originally ordered ground stack', () => {
    for (const stage of ['ground', 'carried'] as const) {
      for (const mealTask of [null, undefined, {}, { sourceId: 18 }]) { const d: any = manualGraph(stage); d.pawns[0].living.mealTask = mealTask;
        expect(() => validateFoodPolicies(d)).toThrow(/用餐来源/); }
    }
    for (const cargo of [null, { resource: 'food', amount: 1 }, { resource: 'meal', amount: 0 }]) {
      const d: any = manualGraph('carried'); d.pawns[0].cargo = cargo;
      expect(() => validateFoodPolicies(d)).toThrow(/用餐来源/);
    }
    for (const change of [(d: any) => { d.items = []; }, (d: any) => { d.items[0].resource = 'food'; },
      (d: any) => { d.pawns[0].living.mealTask.sourceId = null; }]) {
      const d = manualGraph('ground'); change(d); expect(() => validateFoodPolicies(d)).toThrow(/用餐来源/);
    }
  });
  it('never strips even an undefined manual marker from a synthetic historical fixture', () => {
    for (const strip of [stripFoodPoliciesFields, stripApparelPoliciesFields, stripAnimalEnvironmentFields]) {
      for (const value of [undefined, null, { sourceId: 19, resource: 'meal' }]) {
        const d: any = graph(); d.pawns[0].manualFoodOrder = value; const before = structuredClone(d);
        expect(() => strip(d)).toThrow(/manual food order/); expect(d).toEqual(before);
      }
    }
  });
});
