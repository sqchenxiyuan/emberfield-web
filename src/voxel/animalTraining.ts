import { DAY, HEIGHT, inside, type AnimalSpecies, type Pawn, type Pos, type Resource, type WildAnimal } from './types';
import { FOOD_POLICY_RESOURCES, type FoodResource } from './foodPolicies';
import { ANIMAL_HUSBANDRY, animalNutritionCapacity, animalLifeStage } from './husbandry';
import { NUTRITION } from './farming';
import { carryLimit } from './stackLimits';

export const TRAINABLES = ['obedience', 'release', 'rescue', 'haul'] as const;
export type Trainable = typeof TRAINABLES[number];
export interface AnimalTrainingState {
  wanted: Record<Trainable, boolean>;
  steps: Record<Trainable, number>;
  learned: Record<Trainable, boolean>;
  countDecayFrom: number | null;
  masterId: number | null;
  followDrafted: boolean;
  followFieldwork: boolean;
  nextHaulTick: number;
}
export type AnimalWork =
  | { kind: 'follow'; masterId: number }
  | { kind: 'attack'; targetId: number; nextAttackTick: number }
  | { kind: 'rescue'; patientId: number; bedId: number; stage: 'approach' | 'carry' }
  | { kind: 'haul'; sourceId: number | null; resource: Resource; amount: number; target: Pos; stage: 'fetch' | 'deliver' };
export interface AnimalTrainTask {
  animalId: number; trainable: Trainable; sourceId: number | null; resource: FoodResource;
  amount: number; stage: 'fetch' | 'approach' | 'work'; progress: number;
}
export const TRAINABLE_NAMES: Readonly<Record<Trainable, string>> = {
  obedience: '服从', release: '释放攻击', rescue: '救援', haul: '搬运',
};
export const TRAINING_STEPS: Readonly<Record<Trainable, number>> = Object.freeze({ obedience: 3, release: 2, rescue: 2, haul: 7 });
export const TRAINING_PREREQUISITES: Readonly<Record<Trainable, Trainable | null>> = Object.freeze({
  obedience: null, release: 'obedience', rescue: 'obedience', haul: 'obedience',
});
/** Native game-day intervals mapped to Emberfield's DAY. Interaction timing and
 * integer food portions remain explicit Web adaptations; balancing is deferred. */
export const ANIMAL_TRAINING_RULES = Object.freeze({
  work: 3 * 270 * DAY / 60000, interactionCooldown: DAY / 4, decayTicks: 12 * DAY,
  haulCheckTicks: DAY / 24, haulMtbTicks: 1.5 * DAY / 24,
  rescueRadius: 75, rescueBodySize: .65, haulBodySize: .4,
  followDistance: 3, releasedFollowDistance: 50, defendRadius: 5, releasedDefendRadius: 50,
});
const flags = () => ({ obedience: false, release: false, rescue: false, haul: false });
const counts = () => ({ obedience: 0, release: 0, rescue: 0, haul: 0 });
export function initialAnimalTraining(species: AnimalSpecies = 'hare', tick = 0): AnimalTrainingState {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('动物训练时钟无效');
  return { wanted: flags(), steps: counts(), learned: flags(), countDecayFrom: species === 'labrador' ? tick : null,
    masterId: null, followDrafted: false, followFieldwork: false, nextHaulTick: 0 };
}
export const animalTrainable = (species: AnimalSpecies): boolean => species === 'labrador';
export function animalMasterEligible(p: Pick<Pawn, 'faction' | 'dead' | 'skills'>, a: Pick<WildAnimal, 'species'>): boolean {
  return p.faction === 'colony' && !p.dead && p.skills.animals.level >= ANIMAL_HUSBANDRY[a.species].minSkill;
}
export const animalGrazes = (species: AnimalSpecies): boolean => species !== 'labrador';
export function animalCanEatResource(species: AnimalSpecies, resource: Resource): resource is FoodResource {
  return (species === 'labrador' ? FOOD_POLICY_RESOURCES : ['grain', 'food', 'meal']).includes(resource as FoodResource);
}
/** Raw edible training supplies; meals and prepared survival food stay available
 * for ordinary feeding. No medicine, live crop, dispenser or corpse is food here. */
export function animalCanTrainWithResource(species: AnimalSpecies, resource: Resource): resource is FoodResource {
  return animalCanEatResource(species, resource) && !['meal', 'food'].includes(resource);
}
export function animalBodySize(a: Pick<WildAnimal, 'species' | 'growth'>): number {
  const stage = animalLifeStage(a);
  return ANIMAL_HUSBANDRY[a.species].bodySize * (stage === 'baby' ? .2 : stage === 'juvenile' ? .5 : 1);
}
export function animalSkillAvailable(a: Pick<WildAnimal, 'species' | 'growth' | 'training'>, skill: Trainable): boolean {
  return animalTrainable(a.species) && a.training.learned[skill] &&
    (skill !== 'rescue' || animalBodySize(a) >= ANIMAL_TRAINING_RULES.rescueBodySize) &&
    (skill !== 'haul' || animalBodySize(a) >= ANIMAL_TRAINING_RULES.haulBodySize);
}
/** The prerequisite must be learned AND at full steps before training a child.
 * Previously learned partial skills remain usable until their final step fades. */
export function canTrainAnimal(a: WildAnimal, skill: Trainable): boolean {
  if (!animalTrainable(a.species) || a.dead || a.faction !== 'colony' || a.tameness < 1 ||
      a.training.steps[skill] >= TRAINING_STEPS[skill] ||
      (skill === 'rescue' && animalBodySize(a) < ANIMAL_TRAINING_RULES.rescueBodySize) ||
      (skill === 'haul' && animalBodySize(a) < ANIMAL_TRAINING_RULES.haulBodySize)) return false;
  const prerequisite = TRAINING_PREREQUISITES[skill];
  return prerequisite === null || a.training.learned[prerequisite] && a.training.steps[prerequisite] === TRAINING_STEPS[prerequisite];
}
export function setAnimalTrainingWanted(state: AnimalTrainingState, skill: Trainable, wanted: boolean): void {
  if (!TRAINABLES.includes(skill) || typeof wanted !== 'boolean') throw new RangeError('动物训练指派无效');
  state.wanted[skill] = wanted;
  if (wanted) {
    const prerequisite = TRAINING_PREREQUISITES[skill];
    if (prerequisite) setAnimalTrainingWanted(state, prerequisite, true);
  } else for (const child of TRAINABLES) if (TRAINING_PREREQUISITES[child] === skill)
    setAnimalTrainingWanted(state, child, false);
}
export function advanceAnimalTraining(state: AnimalTrainingState, skill: Trainable): boolean {
  if (state.steps[skill] >= TRAINING_STEPS[skill]) return false;
  state.steps[skill]++;
  if (state.steps[skill] === TRAINING_STEPS[skill]) state.learned[skill] = true;
  return true; // Training does not reset countDecayFrom in the native tracker.
}
/** Caller supplies deterministic entropy. Only a leaf with real progress loses
 * one step; never decrease every skill or reset the timer upon successful work. */
export function decayAnimalTraining(a: WildAnimal, tick: number, roll: number): Trainable | null {
  if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isFinite(roll) || roll < 0 || roll >= 1)
    throw new RangeError('动物训练遗忘参数无效');
  const state = a.training;
  if (!animalTrainable(a.species) || a.dead) return null;
  if (!a.tameness || state.countDecayFrom === null) { state.countDecayFrom = tick; return null; }
  if (tick < state.countDecayFrom + ANIMAL_TRAINING_RULES.decayTicks) return null;
  state.countDecayFrom = tick;
  const leaves = TRAINABLES.filter(skill => state.steps[skill] > 0 &&
    !TRAINABLES.some(child => TRAINING_PREREQUISITES[child] === skill && state.steps[child] > 0));
  if (!leaves.length) return null; // Labrador's Tameness itself never decays.
  const skill = leaves[Math.floor(roll * leaves.length)];
  if (--state.steps[skill] === 0) state.learned[skill] = false;
  return skill;
}
export function animalTrainingFoodAmount(a: Pick<WildAnimal, 'species' | 'growth'>, resource: Resource): number {
  if (!animalCanTrainWithResource(a.species, resource)) return 0;
  return 2 * Math.max(1, Math.ceil(Math.min(animalNutritionCapacity(a) * .15, .3) / NUTRITION[resource]!));
}
/** Core Animals stat and wildness factor. Capacity composition is the compact
 * Web model; bond bonuses are omitted until individual animal bonds exist. */
export function animalTrainingChance(skill: number, wildness = 0, capacity = 1): number {
  if (!Number.isInteger(skill) || skill < 0 || skill > 20 || !Number.isFinite(wildness) || wildness < 0 || wildness > 1 ||
      !Number.isFinite(capacity) || capacity < 0) throw new RangeError('动物训练成功率参数无效');
  return Math.min(1, (.1 + .05 * skill) * (1.5 - wildness) * capacity);
}
const exact = (v: unknown, keys: readonly string[]): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
export function validAnimalTrainTask(v: unknown): v is AnimalTrainTask {
  return exact(v, ['animalId', 'trainable', 'sourceId', 'resource', 'amount', 'stage', 'progress']) &&
    integer(v.animalId, 1) && TRAINABLES.includes(v.trainable) && FOOD_POLICY_RESOURCES.includes(v.resource) &&
    integer(v.amount, 1) && v.amount <= carryLimit(v.resource) && integer(v.progress) && v.progress <= ANIMAL_TRAINING_RULES.work &&
    (v.stage === 'fetch' ? integer(v.sourceId, 1) && v.progress === 0 :
      ['approach', 'work'].includes(v.stage) && v.sourceId === null && (v.stage === 'work' || v.progress === 0));
}
export function validAnimalWork(v: unknown): v is AnimalWork {
  if (exact(v, ['kind', 'masterId']) && v.kind === 'follow') return integer(v.masterId, 1);
  if (exact(v, ['kind', 'targetId', 'nextAttackTick']) && v.kind === 'attack') return integer(v.targetId, 1) && integer(v.nextAttackTick);
  if (exact(v, ['kind', 'patientId', 'bedId', 'stage']) && v.kind === 'rescue')
    return integer(v.patientId, 1) && integer(v.bedId, 1) && ['approach', 'carry'].includes(v.stage);
  return exact(v, ['kind', 'sourceId', 'resource', 'amount', 'target', 'stage']) && v.kind === 'haul' &&
    typeof v.resource === 'string' && Number.isFinite(carryLimit(v.resource as Resource)) && integer(v.amount, 1) &&
    v.amount <= carryLimit(v.resource as Resource) && exact(v.target, ['x', 'y', 'z']) && inside(v.target as Pos) &&
    v.target.z >= 1 && v.target.z < HEIGHT - 1 &&
    (v.stage === 'fetch' ? integer(v.sourceId, 1) : v.stage === 'deliver' && v.sourceId === null);
}
