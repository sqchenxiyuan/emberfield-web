import type { AnimalSpecies, Cargo, Pawn, Pos } from './types';
import type { ProductionRecipe } from './productionBills';
import { jobSkill, SKILL_NAMES } from './skills';
import { ANIMAL_DEFS } from './wildlife';

export interface ProductionPolicy {
  workerId: number | null;
  skillMin: number;
  skillMax: number;
  ingredientRadius: number | null;
  allowedFood: Array<'grain' | 'meat'>;
  allowedCarcasses: AnimalSpecies[];
}

const animalSpecies = Object.keys(ANIMAL_DEFS) as AnimalSpecies[];
const keys = ['workerId', 'skillMin', 'skillMax', 'ingredientRadius', 'allowedFood', 'allowedCarcasses'];
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

/** New independent arrays are required: editing one bill must not change another. */
export function defaultProductionPolicy(): ProductionPolicy {
  return {
    workerId: null, skillMin: 0, skillMax: 20, ingredientRadius: null,
    allowedFood: ['grain', 'meat'], allowedCarcasses: [...animalSpecies],
  };
}

/** Policy structure is independent of current pawn existence. Queue validation
 * checks live references; a frozen job may name a pawn that has since left. */
export function validProductionPolicy(value: unknown): value is ProductionPolicy {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).length !== keys.length || !keys.every(key => Object.hasOwn(p, key))) return false;
  const subset = (raw: unknown, allowed: readonly string[]) => Array.isArray(raw) &&
    raw.length <= allowed.length && new Set(raw).size === raw.length &&
    Array.from(raw).every(entry => typeof entry === 'string' && allowed.includes(entry));
  return (p.workerId === null || integer(p.workerId, 1, Number.MAX_SAFE_INTEGER)) &&
    integer(p.skillMin, 0, 20) && integer(p.skillMax, 0, 20) && p.skillMin <= p.skillMax &&
    (p.ingredientRadius === null || integer(p.ingredientRadius, 3, 100)) &&
    subset(p.allowedFood, ['grain', 'meat']) && subset(p.allowedCarcasses, animalSpecies);
}

/** Native named-worker selection bypasses the player skill range. Recipe hard
 * skill requirements and the pawn's ability to work remain world decisions. */
export function productionPolicyWorkerReason(
  policy: ProductionPolicy, recipe: ProductionRecipe, pawn: Pick<Pawn, 'id' | 'skills'>,
): string | null {
  if (policy.workerId !== null) return pawn.id === policy.workerId ? null : '账单仅允许指定工人';
  const skill = jobSkill(recipe.split(':')[0]);
  if (!skill) return null;
  const level = pawn.skills[skill].level;
  return level < policy.skillMin || level > policy.skillMax
    ? `账单要求${SKILL_NAMES[skill]} ${policy.skillMin}～${policy.skillMax} 级；当前 ${level} 级`
    : null;
}

/** The caller selects the recipe's actual cost slot. Native fixed-definition
 * slots bypass player ingredient filters; only cook food and butcher species
 * are variable in this build. Radius still applies to fixed-slot ingredients.
 * Native uses strict horizontal distance from the workbench anchor. Emberfield
 * adapts it to strict 3D Euclidean distance so different floors cost distance.
 * Already carried/delivered inputs have no source point and keep their identity. */
export function productionPolicyAllowsIngredient(
  policy: ProductionPolicy, recipe: ProductionRecipe, cargo: Pick<Cargo, 'resource' | 'carcass'>,
  source?: Pos, bench?: Pos,
): boolean {
  if (policy.ingredientRadius !== null && source && bench) {
    const squared = (source.x - bench.x) ** 2 + (source.y - bench.y) ** 2 + (source.z - bench.z) ** 2;
    if (!(squared < policy.ingredientRadius ** 2)) return false;
  }
  if (recipe === 'cook' && (cargo.resource === 'grain' || cargo.resource === 'meat'))
    return policy.allowedFood.includes(cargo.resource);
  if (recipe === 'butcher' && cargo.resource === 'carcass')
    return !!cargo.carcass && policy.allowedCarcasses.includes(cargo.carcass.species);
  return true;
}
