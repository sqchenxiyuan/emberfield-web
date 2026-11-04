import { initialAnimalPenState } from './pens';
import { DAY, type AnimalSpecies, type Resource, type WildAnimal } from './types';
import { NUTRITION } from './farming';

/** Web prototype tuning, not a native timing/AI reproduction. The source model
 * supplies the mechanisms (food, growth, pregnancy and tameness); short growth
 * and gestation periods keep the first husbandry loop playable. */
export const HUSBANDRY_RULES = Object.freeze({
  adultTicks: 4 * DAY, gestationTicks: 2 * DAY, juvenileGrowth: .4,
  handleWork: 80, feedings: 2, eatWork: 60, mateWork: 100, slaughterWork: 100,
  interactionCooldown: DAY / 4, mateInterval: DAY / 3, mateChance: .5,
  tamenessMax: 5, tamenessDecayTicks: 7.5 * DAY,
  wantFood: 45, hungry: 36, urgentlyHungry: 18,
  malnutritionPerDay: .453, miscarriageSeverity: .35,
  grassNutrition: .3, grassRegrowTicks: 2 * DAY, grassMinGrowth: .2,
  foodSearchDistance: 16, maxAnimals: 128, maxGrass: 8192, maxLog: 128,
});
/** Native food/body/wildness and pen distinctions inform these concentrated
 * parameters. Work, conception odds, and the world AI remain Web adaptations. */
export const ANIMAL_HUSBANDRY: Readonly<Record<AnimalSpecies, {
  wildness: number; minSkill: number; nutritionCapacity: number; nutritionPerDay: number;
  penAnimal: boolean; tamenessDecays: boolean; litterMin: number; litterMax: number;
  bodySize: number;
}>> = Object.freeze({
  hare: Object.freeze({ wildness: .75, minSkill: 8, nutritionCapacity: .2, nutritionPerDay: .184,
    bodySize: .2, penAnimal: false, tamenessDecays: true, litterMin: 1, litterMax: 2 }),
  deer: Object.freeze({ wildness: .75, minSkill: 8, nutritionCapacity: 1.2, nutritionPerDay: .32,
    bodySize: 1.2, penAnimal: true, tamenessDecays: false, litterMin: 1, litterMax: 1 }),
  dromedary: Object.freeze({ wildness: .25, minSkill: 2, nutritionCapacity: 2.1, nutritionPerDay: .856,
    bodySize: 2.1, penAnimal: true, tamenessDecays: false, litterMin: 1, litterMax: 1 }),
});
export type AnimalLifeStage = 'baby' | 'juvenile' | 'adult';
export type AnimalHusbandryState = Pick<WildAnimal,
  'allowedAreaId' | 'ropePaused' | 'requestedPenId' | 'nextRoamTick' |
  'faction' | 'sex' | 'ageTicks' | 'growth' | 'tame' | 'slaughter' | 'releaseMarked' |
  'malnutrition' | 'milkFullness' | 'pregnancy' | 'mateId' | 'mateProgress' | 'nextMateTick' | 'tameness' |
  'nextTamenessDecayTick' | 'nextInteractionTick' | 'path' | 'goal' | 'eatProgress' | 'reason'>;

/** Existing and newly immigrating wildlife are adults. Birth explicitly sets
 * ageTicks/growth to zero and inherits ownership; load never invents a baby. */
export function initialAnimalState(id: number, species: AnimalSpecies, tick: number): AnimalHusbandryState {
  if (!Number.isSafeInteger(id) || id <= 0 || !Object.hasOwn(ANIMAL_HUSBANDRY, species) ||
      !Number.isSafeInteger(tick) || tick < 0 || !Number.isSafeInteger(tick + HUSBANDRY_RULES.tamenessDecayTicks))
    throw new RangeError('动物初始状态无效');
  return { ...initialAnimalPenState(tick),
    faction: 'wild', sex: Math.floor(id / 2) % 2 ? 'male' : 'female',
    ageTicks: HUSBANDRY_RULES.adultTicks, growth: 1, tame: false, slaughter: false, releaseMarked: false,
    malnutrition: 0, milkFullness: 0, pregnancy: null, mateId: null, mateProgress: 0,
    nextMateTick: tick + HUSBANDRY_RULES.mateInterval,
    tameness: 0, nextTamenessDecayTick: tick + HUSBANDRY_RULES.tamenessDecayTicks,
    nextInteractionTick: tick, path: [], goal: null, eatProgress: 0, reason: '野生动物' };
}
export function animalLifeStage(animal: Pick<WildAnimal, 'growth'>): AnimalLifeStage {
  return animal.growth >= 1 ? 'adult' : animal.growth >= HUSBANDRY_RULES.juvenileGrowth ? 'juvenile' : 'baby';
}
export function isAnimalAdult(animal: Pick<WildAnimal, 'growth'>): boolean { return animalLifeStage(animal) === 'adult'; }
export function animalNutritionCapacity(animal: AnimalSpecies | Pick<WildAnimal, 'species' | 'growth'>): number {
  const species = typeof animal === 'string' ? animal : animal.species;
  const stage = typeof animal === 'string' ? 'adult' : animalLifeStage(animal);
  // Native bodySize*foodMax: baby .2*3, juvenile .5*1.5, adult1.
  return ANIMAL_HUSBANDRY[species].nutritionCapacity * (stage === 'baby' ? .6 : stage === 'juvenile' ? .75 : 1);
}
export function animalFeedAmount(species: AnimalSpecies, resource: Resource): number {
  if (!['grain', 'meal', 'food'].includes(resource)) return 0;
  const nutrition = NUTRITION[resource];
  return nutrition ? Math.max(1, Math.ceil(Math.min(animalNutritionCapacity(species) * .15, .3) / nutrition)) : 0;
}
/** Native hunger categories affect bodily growth; mapping percentages is shared
 * with the model's herbivore appetite thresholds. */
export function animalHungerMultiplier(hunger: number): number {
  return hunger <= 0 ? 0 : hunger < HUSBANDRY_RULES.urgentlyHungry ? .25 : hunger < HUSBANDRY_RULES.hungry ? .5 : 1;
}
export function tameChance(animal: Pick<WildAnimal, 'species' | 'dead' | 'faction'>, skill: number): number {
  if (!Number.isInteger(skill) || skill < 0 || skill > 20) throw new RangeError('驯养技能无效');
  const def = ANIMAL_HUSBANDRY[animal.species];
  if (animal.dead || animal.faction !== 'wild' || skill < def.minSkill) return 0;
  // Deliberately provisional chance; not a fitted copy of the native stat chain.
  return Math.min(.9, (.25 + .03 * skill) * (1 - .5 * def.wildness));
}
export function animalReproductionEligible(animal: WildAnimal): boolean {
  return !animal.dead && animal.health > 0 && animal.faction === 'colony' && isAnimalAdult(animal) &&
    animal.pregnancy === null && !animal.hunt && !animal.slaughter && !animal.releaseMarked &&
    animal.hunger >= HUSBANDRY_RULES.hungry && animal.malnutrition < .8;
}
export interface AnimalNeedsResult { starved: boolean; miscarried: boolean; birthReady: boolean }
/** Only mutate this animal's needs and biological progress. The world owns
 * actual ingestion/accounting, death/carcass conversion, birth IDs and logs. */
export function advanceAnimalNeeds(animal: WildAnimal): AnimalNeedsResult {
  if (animal.dead) return { starved: false, miscarried: false, birthReady: false };
  const stage = animalLifeStage(animal), multiplier = animalHungerMultiplier(animal.hunger);
  const hungerFactor = stage === 'baby' ? .4 : stage === 'juvenile' ? .75 : 1;
  const nutrition = Math.max(0, animal.hunger / 100 * animalNutritionCapacity(animal) -
    ANIMAL_HUSBANDRY[animal.species].nutritionPerDay * hungerFactor * multiplier / DAY);
  animal.ageTicks++;
  animal.growth = Math.min(1, animal.growth + multiplier / HUSBANDRY_RULES.adultTicks);
  // Stage growth changes capacity without creating food inside the animal.
  animal.hunger = Math.max(0, Math.min(100, nutrition / animalNutritionCapacity(animal) * 100));
  animal.malnutrition = Math.max(0, Math.min(1, animal.malnutrition +
    (animal.hunger <= 0 ? 1 : -1) * HUSBANDRY_RULES.malnutritionPerDay / DAY));
  let miscarried = false;
  if (animal.pregnancy) {
    // Deterministic threshold is a stated Web simplification of native random
    // malnutrition/wound miscarriage checks. It never creates a carcass item.
    if (animal.malnutrition >= HUSBANDRY_RULES.miscarriageSeverity) {
      animal.pregnancy = null; miscarried = true;
    } else animal.pregnancy.progress = Math.min(1, animal.pregnancy.progress + multiplier / HUSBANDRY_RULES.gestationTicks);
  }
  return { starved: animal.malnutrition >= 1, miscarried, birthReady: animal.pregnancy?.progress === 1 };
}
