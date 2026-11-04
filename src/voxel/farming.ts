import { Block, DAY, type CropKind, type Resource } from './types';

export function fertilityOf(block: number): number {
  return block === Block.Soil
    ? 1
    : block === Block.RichSoil
      ? 1.4
      : block === Block.Gravel
        ? 0.7
        : block === Block.Sand
          ? 0.1
          : 0;
}
// Rice/potato inherit 0.7; corn explicitly sets 0.70 in the inspected Core defs.
export const MIN_CROP_FERTILITY = 0.7;

// Reference fields are documented separately from the 3D and time-scale design in chapter 12.
export const CROPS: Record<
  CropKind,
  {
    name: string;
    days: number;
    yield: number;
    fertilitySensitivity: number;
    sowWork: number;
    harvestWork: number;
    minSkill: number;
  }
> = {
  rice: {
    name: '稻米',
    days: 3,
    yield: 6,
    fertilitySensitivity: 1,
    sowWork: 57,
    harvestWork: 67,
    minSkill: 0,
  },
  potato: {
    name: '土豆',
    days: 5.8,
    yield: 11,
    fertilitySensitivity: 0.4,
    sowWork: 57,
    harvestWork: 67,
    minSkill: 0,
  },
  corn: {
    name: '玉米',
    days: 11.3,
    yield: 22,
    fertilitySensitivity: 1,
    sowWork: 57,
    harvestWork: 67,
    minSkill: 0,
  },
  cotton: {
    name: '棉花',
    days: 8,
    yield: 10,
    fertilitySensitivity: 1,
    sowWork: 57,
    harvestWork: 67,
    minSkill: 0,
  },
  healroot: {
    name: '药根',
    days: 7,
    yield: 1,
    fertilitySensitivity: 1,
    sowWork: 267,
    harvestWork: 134,
    minSkill: 8,
  },
};
export const SIMPLE_MEAL = { ingredients: 10, nutrition: 0.5, wood: 1, output: 1, work: 100 };
export const FOOD_INGREDIENTS = ['grain', 'meat', 'milk', 'eggUnfertilized', 'eggFertilized'] as const;
export type FoodIngredient = typeof FOOD_INGREDIENTS[number];
export const FOOD_PREFERENCE: readonly Resource[] = ['meal', 'food', 'milk', 'eggUnfertilized', 'grain', 'meat', 'eggFertilized'];
export const NUTRITION: Partial<Record<Resource, number>> = {
  meal: 0.9, food: 0.9, grain: 0.05, meat: 0.05, milk: 0.05, eggUnfertilized: 0.25, eggFertilized: 0.25,
};
export function isFoodIngredient(resource: Resource): resource is FoodIngredient {
  return (FOOD_INGREDIENTS as readonly Resource[]).includes(resource);
}
/** Native normal human ground-food search allows DesperateOnly at Starving,
 * whose food level is zero. Native inventory fallback may select it earlier;
 * Web carried-food handling deliberately stays separate from ground search. */
export function canSelectGroundFood(resource: Resource, food: number): boolean {
  return !!NUTRITION[resource] && (resource !== 'eggFertilized' || food <= 0);
}
/** Real stack units are indivisible. Subtract a numerical tolerance before
 * ceil so mixed .05/.25 inputs cannot request a spurious extra item. */
export function foodUnitsForNutrition(resource: FoodIngredient, nutrition: number): number {
  return Math.max(0, Math.ceil((nutrition - 1e-9) / NUTRITION[resource]!));
}
export function foodUnitsForHunger(resource: Resource, food: number): number {
  if (!NUTRITION[resource]) return 0;
  return isFoodIngredient(resource) ? foodUnitsForNutrition(resource, (100 - food) / 100) : 1;
}
/** A final indivisible ingredient may overshoot the target by less than its
 * nutrition. Reject batches that still reach the target after removing their
 * largest ingredient unit. Integer hundredths keep save validation stable. */
export function validSimpleMealIngredients(cost: Partial<Record<Resource, number>>): boolean {
  let units = 0, largest = 0;
  for (const resource of FOOD_INGREDIENTS) {
    const amount = cost[resource] ?? 0, nutrition = Math.round(NUTRITION[resource]! * 100);
    if (!Number.isSafeInteger(amount) || amount < 0) return false;
    units += amount * nutrition;
    if (amount) largest = Math.max(largest, nutrition);
  }
  const target = Math.round(SIMPLE_MEAL.nutrition * 100);
  return units >= target && units - largest < target;
}
export const FOOD_FALL_PER_TICK = (1.6 * 100) / DAY;
export const hourAt = (tick: number) => (8 + (tick / DAY) * 24) % 24;
export const temperatureAt = (tick: number) =>
  21 + 7 * Math.sin(((hourAt(tick) - 8) / 24) * Math.PI * 2);
export function temperatureGrowth(t: number) {
  if (t <= 0 || t >= 58) return 0;
  if (t < 6) return t / 6;
  if (t <= 42) return 1;
  return (58 - t) / 16;
}
// Saturated daylight is a local sky model; the original also saturates sunlight, with latitude/season/weather.
export function daylight(hour: number) {
  return hour >= 6 && hour <= 18 ? Math.min(1, 2 * Math.sin(((hour - 6) / 12) * Math.PI)) : 0;
}
export function fertilityGrowth(kind: CropKind, fertility: number) {
  return Math.max(0, 1 + (fertility - 1) * CROPS[kind].fertilitySensitivity);
}
export function lightGrowth(light: number) {
  return Math.max(0, Math.min(1, (light - 0.51) / 0.49));
}
export function cropGrowth(
  kind: CropKind,
  fertility: number,
  light: number,
  temperature: number,
  hour: number,
) {
  if (hour < 6 || hour >= 19.2) return 0;
  return (
    (fertilityGrowth(kind, fertility) * lightGrowth(light) * temperatureGrowth(temperature)) /
    (CROPS[kind].days * DAY)
  );
}
