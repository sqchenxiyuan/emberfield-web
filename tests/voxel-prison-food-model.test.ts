import { describe, expect, it } from 'vitest';
import { initialSurvival } from '../src/voxel/survival';
import { initialPsyche } from '../src/voxel/mood';
import { initialLiving } from '../src/voxel/living';
import { initialPrisoner } from '../src/voxel/prisoners';
import { initialSkills } from '../src/voxel/skills';
import { initialSocial } from '../src/voxel/social';
import { initialApparelControl } from '../src/voxel/apparelPolicies';
import { FOOD_POLICY_RESOURCES } from '../src/voxel/foodPolicies';
import { carryLimit } from '../src/voxel/logistics';
import { PRISON_FOOD_RULES, PRISON_ROOM_FOOD_RESOURCES, validPrisonFoodTask } from '../src/voxel/prisonFood';
import { rejectLegacyPrisonFood, migratePrisonFood, validatePrisonFood } from '../src/voxel/prisonFoodPersistence';
import { validateLiving } from '../src/voxel/livingPersistence';
import { validatePrisoners } from '../src/voxel/prisonPersistence';
import { type Pawn, type VoxelSave } from '../src/voxel/types';
import { stripPrisonFoodFields } from './legacy-prison-food-defaults';
import { stripFoodPoliciesFields } from './legacy-food-policies-defaults';
import { stripApparelPoliciesFields } from './legacy-apparel-policies-defaults';

function person(id: number, extra: Partial<Pawn> = {}): Pawn {
  return { ...initialSurvival(73129, id), id, name: `人物${id}`, x: 10 + id, y: 10, z: 8, color: 0,
    food: 20, rest: 90, skills: initialSkills(id), social: initialSocial(), psyche: initialPsyche(), living: initialLiving(),
    worn: [], apparelControl: initialApparelControl(100), foodPolicyId: null, apparelTask: null, apparelWearTicks: 0,
    prisoner: null, wardenTask: null, handleTask: null, ropeTask: null, jobId: null, phase: 'idle',
    path: [], destination: null, cargo: null, eating: null, reason: '', moveTick: 100, workTarget: null,
    sleepingSince: null, sleepBedId: null, schedule: Array(24).fill('work'), priorities: { handle: 0, firefight: 0,
      clean: 0, warden: 1, care: 0, hunt: 0, dig: 0, build: 0, cut: 0, haul: 0, grow: 0, cook: 0, craft: 0, research: 0 }, ...extra };
}
/** Pure persistence graphs. Terrain/path validity remains the world's contract. */
function graph(): VoxelSave {
  const prisoner = person(2, { faction: 'prisoner', prisoner: initialPrisoner(80), phase: 'prisoner' });
  prisoner.priorities.warden = 0;
  return { version: 59, tick: 100, nextId: 100, pawns: [person(1), prisoner, person(3)], beds: [], tables: [], chairs: [],
    items: [{ id: 40, x: 20, y: 12, z: 8, resource: 'meal', amount: 2 }] } as unknown as VoxelSave;
}
function delivery(stage: 'fetch' | 'deliver' = 'fetch'): VoxelSave {
  const d = graph(), p = d.pawns[0]; p.phase = 'prisonFood';
  p.prisonFoodTask = { prisonerId: 2, sourceId: stage === 'fetch' ? 40 : null, resource: 'meal', amount: 1,
    target: { x: 20, y: 10, z: 8 }, stage };
  if (stage === 'deliver') { p.cargo = { resource: 'meal', amount: 2 }; d.items = []; }
  return d;
}
function dining(): VoxelSave {
  const d = graph(), p = d.pawns[1];
  Object.assign(p, { phase: 'dine', eating: 'meal', cargo: { resource: 'meal', amount: 1 }, x: 20, y: 9 });
  d.tables.push({ id: 50, x: 20, y: 10, z: 8, axis: 'x', quality: 2, gathering: true });
  d.chairs.push({ id: 51, x: 20, y: 9, z: 8, axis: 'y', quality: 2 });
  p.living.mealTask = { stage: 'chew', sourceId: null, chairId: 51, tableId: 50,
    target: { x: 20, y: 9, z: 8 }, amount: 1, progress: 20 };
  return d;
}

describe('prison meal delivery shape and persistence', () => {
  it('distinguishes room food sufficient for ordinary supply from all edible delivery resources', () => {
    expect(PRISON_ROOM_FOOD_RESOURCES).toEqual(['meal', 'food', 'milk']);
    expect(PRISON_FOOD_RULES).toEqual({ hungryAt: 26, nutritionMargin: .5 });
    for (const resource of FOOD_POLICY_RESOURCES) {
      const task = { ...delivery().pawns[0].prisonFoodTask!, resource, amount: carryLimit(resource) };
      expect(validPrisonFoodTask(task)).toBe(true);
      expect(validPrisonFoodTask({ ...task, amount: carryLimit(resource) + 1 })).toBe(false);
    }
  });
  it('rejects malformed phases, ids, quantities, extra fields and fractional or unsupported target cells', () => {
    const task = delivery().pawns[0].prisonFoodTask!;
    for (const patch of [{ stage: 'chew' }, { stage: 'deliver' }, { sourceId: null }, { prisonerId: 0 }, { sourceId: -.5 },
      { resource: 'wood' }, { amount: 0 }, { amount: Infinity }, { amount: 1.1 }, { progress: 0 },
      { target: { x: 1, y: 2, z: 0 } }, { target: { x: 1, y: 2, z: 15 } }, { target: { x: 64, y: 2, z: 8 } },
      { target: { x: 1.2, y: 2, z: 8 } }, { target: { x: 1, y: 2, z: 8, extra: 1 } }])
      expect(validPrisonFoodTask({ ...task, ...patch })).toBe(false);
    for (const invalid of [null, undefined, [], {}, 'task']) expect(validPrisonFoodTask(invalid)).toBe(false);
  });
  it.each(['fetch', 'deliver'] as const)('preserves real %s state and allows excess carried food without duplicating it', stage => {
    const d = delivery(stage), before = structuredClone(d);
    expect(() => validatePrisonFood(d)).not.toThrow(); expect(() => validateLiving(d)).not.toThrow();
    expect(() => validatePrisoners(d)).not.toThrow(); expect(d).toEqual(before);
  });
  it('requires exact task/phase pairing and globally bounded reference ids', () => {
    for (const change of [(d: any) => { delete d.pawns[0].prisonFoodTask; },
      (d: any) => { d.pawns[0].prisonFoodTask = undefined; }, (d: any) => { d.pawns[0].phase = 'idle'; },
      (d: any) => { d.pawns[0].prisonFoodTask.sourceId = 100; }, (d: any) => { d.pawns[0].prisonFoodTask.prisonerId = 100; }]) {
      const d = delivery(); change(d); const before = structuredClone(d);
      expect(() => validatePrisonFood(d)).toThrow(/囚犯送餐存档/); expect(d).toEqual(before);
    }
  });
  it('rejects incapable workers and every conflicting activity, including optional markers', () => {
    const patches = [{ faction: 'prisoner' }, { dead: true }, { downed: true }, { drafted: true }, { carriedBy: 2 },
      { carryingPawnId: 2 }, { jobId: 4 }, { patientId: 2 }, { carePhase: 'feed' }, { careFoodId: 40 },
      { careMedicineId: 40 }, { careBedId: 50 }, { eating: 'meal' }, { sleepBedId: 50 }, { sleepingSince: 90 },
      ...['wardenTask', 'handleTask', 'ropeTask', 'cleanTask', 'firefightTask', 'repairTask', 'weaponTask', 'apparelTask',
        'manualFoodOrder', 'animalCareTask', 'eggBoxTask', 'productionDelivery'].map(key => ({ [key]: {} })),
      { attackTargetId: 2 }, { shooting: {} }, { psyche: { recreation: {}, breakUntil: 0 } },
      { psyche: { recreation: null, breakUntil: 101 } }, { living: { mealTask: {} } }];
    for (const patch of patches) { const d = delivery(); Object.assign(d.pawns[0], patch);
      expect(() => validatePrisonFood(d)).toThrow(/其他活动/); }
  });
  it('requires a real source for fetch and the delivered portion in the worker hands', () => {
    for (const change of [(d: any) => { d.items = []; }, (d: any) => { d.items[0].resource = 'food'; },
      (d: any) => { d.items[0].amount = 0; }, (d: any) => { d.pawns[0].cargo = { resource: 'meal', amount: 1 }; }]) {
      const d = delivery(); change(d); expect(() => validatePrisonFood(d)).toThrow(/来源或携带物/);
    }
    for (const cargo of [null, { resource: 'food', amount: 2 }, { resource: 'meal', amount: 0 }, { resource: 'meal', amount: .5 }]) {
      const d: any = delivery('deliver'); d.pawns[0].cargo = cargo;
      expect(() => validatePrisonFood(d)).toThrow(/实际食物/);
    }
  });
  it('rejects missing, released and multiply claimed recipients without rejecting dynamic illness', () => {
    for (const change of [(d: any) => { d.pawns.splice(1, 1); }, (d: any) => { d.pawns[1].dead = true; },
      (d: any) => { d.pawns[1].faction = 'colony'; }, (d: any) => { d.pawns[1].prisoner.policy = 'release'; },
      (d: any) => { d.pawns[1].prisoner.releasing = true; },
      (d: any) => { d.pawns[2].prisonFoodTask = structuredClone(d.pawns[0].prisonFoodTask); d.pawns[2].phase = 'prisonFood'; },
      (d: any) => { d.pawns[2].wardenTask = { prisonerId: 2 }; }, (d: any) => { d.pawns[2].patientId = 2; }]) {
      const d = delivery(); change(d); expect(() => validatePrisonFood(d)).toThrow(/囚犯不存在/);
    }
    const d = delivery(); d.pawns[1].downed = true; d.pawns[1].phase = 'downed';
    expect(() => validatePrisonFood(d)).not.toThrow(); // World cancels a changed recipient without deleting cargo.
  });
  it('aggregates exact ground reservations shared with care, handling, animal care and dining', () => {
    const claims = [(p: any) => { p.careFoodId = 40; p.careAmount = 2; },
      (p: any) => { p.handleTask = { stage: 'fetch', foodId: 40, amount: 2 }; },
      (p: any) => { p.animalCareTask = { stage: 'fetch', sourceId: 40, amount: 2 }; },
      (p: any) => { p.living.mealTask = { sourceId: 40, amount: 2 }; }];
    for (const claim of claims) { const d = delivery(); claim(d.pawns[2]);
      expect(() => validatePrisonFood(d)).toThrow(/重复预约/);
      d.items[0].amount = 3; expect(() => validatePrisonFood(d)).not.toThrow(); }
    const d = delivery(), q = person(4, { faction: 'prisoner', prisoner: initialPrisoner(80), phase: 'prisoner' });
    d.pawns.push(q); d.pawns[2].phase = 'prisonFood';
    d.pawns[2].prisonFoodTask = { ...d.pawns[0].prisonFoodTask!, prisonerId: 4, amount: 2 };
    expect(() => validatePrisonFood(d)).toThrow(/重复预约/);
    d.items[0].amount = 3; expect(() => validatePrisonFood(d)).not.toThrow();
  });
});

describe('prisoner dining and historical compatibility', () => {
  it('allows prisoners to carry and chew their physical meal in the shared dining system', () => {
    const d = dining(), before = structuredClone(d);
    expect(() => validateLiving(d)).not.toThrow(); expect(() => validatePrisoners(d)).not.toThrow();
    expect(() => validatePrisonFood(d)).not.toThrow(); expect(d).toEqual(before);
  });
  it('requires the prisoner dining phase, food and meal task to agree', () => {
    for (const patch of [{ phase: 'prisoner' }, { eating: null }, { eating: 'wood' }, { downed: true }, { dead: true }, { carriedBy: 1 }]) {
      const d = dining(); Object.assign(d.pawns[1], patch); expect(() => validatePrisoners(d)).toThrow(/不相容活动/);
    }
    const d = dining(); d.pawns[1].living.mealTask = null;
    expect(() => validatePrisoners(d)).toThrow(/不相容活动/);
  });
  it('rejects shared seat claims across prisoner and colony diners', () => {
    const d = dining(), p = structuredClone(d.pawns[1]);
    p.id = 4; p.faction = 'colony'; p.prisoner = null; d.pawns.push(p);
    expect(() => validateLiving(d)).toThrow(/座位引用/);
  });
  it('rejects delivery or animal nursing reservations that exceed a ground dining source', () => {
    for (const kind of ['prisonFoodTask', 'animalCareTask'] as const) {
      const d = dining(), p = d.pawns[1]; p.cargo = { resource: 'wood', amount: 3 };
      p.living.mealTask!.sourceId = 40; p.living.mealTask!.chairId = null;
      Object.assign(d.pawns[0], { [kind]: { stage: 'fetch', sourceId: 40, amount: 2 } });
      expect(() => validateLiving(d)).toThrow(/重复预约/);
      d.items[0].amount = 3; expect(() => validateLiving(d)).not.toThrow();
    }
  });
  it('rejects delivery conflicts with warden reservations even when warden is serialized first', () => {
    const d = delivery(), p = d.pawns[2];
    p.phase = 'warden'; p.wardenTask = { prisonerId: 2, bedId: null, stage: 'talkApproach', progress: 0 };
    d.pawns.reverse(); expect(() => validatePrisoners(d)).toThrow(/重复预约/);
  });
  it('never manufactures tasks or rewrites one-off historical feeding work', () => {
    const d: any = graph(); d.version = 57;
    Object.assign(d.pawns[0], { phase: 'care', carePhase: 'feed', patientId: 2, careAmount: 1, cargo: { resource: 'meal', amount: 1 } });
    const before = structuredClone(d); rejectLegacyPrisonFood(d, 57); migratePrisonFood(d, 57);
    expect(d).toEqual(before); expect(d.pawns.every((p: any) => !Object.hasOwn(p, 'prisonFoodTask'))).toBe(true);
    const current = delivery(), copy = structuredClone(current); migratePrisonFood(current, 58); expect(current).toEqual(copy);
  });
  it('guards historical versions against marker, phase and prisoner dining injection before changes', () => {
    for (const version of [24, 31, 56, 57]) for (const change of [
      (d: any) => { d.pawns[0].prisonFoodTask = undefined; }, (d: any) => { d.pawns[0].prisonFoodTask = null; },
      (d: any) => { d.pawns[0].phase = 'prisonFood'; }, (d: any) => { d.pawns[1].phase = 'dine'; },
      (d: any) => { d.pawns[1].eating = 'meal'; }, (d: any) => { d.pawns[1].living.mealTask = {}; }]) {
      const d: any = graph(); d.version = version; change(d); const before = structuredClone(d);
      expect(() => rejectLegacyPrisonFood(d, version)).toThrow(/旧版本混入/);
      expect(() => migratePrisonFood(d, version)).toThrow(/旧版本混入/); expect(d).toEqual(before);
    }
  });
  it('preserves old colonist dining and rejects malformed migration carriers atomically', () => {
    const d: any = dining(); d.pawns[1].faction = 'colony'; d.pawns[1].prisoner = null; d.version = 57;
    const before = structuredClone(d); expect(() => migratePrisonFood(d, 57)).not.toThrow(); expect(d).toEqual(before);
    for (const bad of [null, [], 3, undefined]) { const old: any = graph(); old.pawns.push(bad); const copy = structuredClone(old);
      expect(() => migratePrisonFood(old, 57)).toThrow(); expect(old).toEqual(copy); }
  });
  it('downgrade helpers reject live tasks or prisoner meals without deleting older policy fields', () => {
    for (const strip of [stripPrisonFoodFields, stripFoodPoliciesFields, stripApparelPoliciesFields]) {
      for (const d of [delivery(), dining()]) { const before = structuredClone(d);
        expect(() => strip(d)).toThrow(/Cannot downgrade/); expect(d).toEqual(before); }
    }
    const d = graph(), before = structuredClone(d); stripPrisonFoodFields(d);
    for (const p of before.pawns) delete (p as Partial<Pawn>).animalsReleased;
    expect(d).toEqual(before);
  });
});
