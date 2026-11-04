import { FOOD_PREFERENCE } from './farming';
import type { Resource } from './types';

export type FoodResource = Extract<Resource, 'meal' | 'food' | 'milk' | 'eggUnfertilized' | 'grain' | 'meat' | 'eggFertilized'>;
/** Same ordering as actual food selection; this filter applies to the food
 * itself, not ingredients that a meal may have contained. */
export const FOOD_POLICY_RESOURCES = FOOD_PREFERENCE as readonly FoodResource[];
export interface FoodPolicy { id: number; name: string; allowedResources: FoodResource[] }
export interface FoodPoliciesState { nextId: number; policies: FoodPolicy[] }
export const FOOD_POLICY_LIMIT = 16;
export const FOOD_POLICY_NAME_LIMIT = 40;

export function createDefaultFoodPolicies(): FoodPoliciesState {
  return { nextId: 2, policies: [{ id: 1, name: '不限制', allowedResources: [...FOOD_POLICY_RESOURCES] }] };
}

/** Contextual exceptions such as mental states belong to the eater's search
 * context. Keep the shared definition's direct item filter unambiguous. */
export function policyAllowsFood(policy: FoodPolicy, resource: Resource): boolean {
  return (policy.allowedResources as readonly Resource[]).includes(resource);
}

/** Commands may trim a name and canonicalize a list. Persisted definitions
 * must already have this exact form; unknown fields are never discarded. */
export function normalizeFoodPolicy(raw: unknown): FoodPolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as FoodPolicy;
  const keys = ['id', 'name', 'allowedResources'];
  if (Object.keys(p).length !== keys.length || !keys.every(key => Object.hasOwn(p, key)) ||
    !Number.isSafeInteger(p.id) || p.id <= 0 || typeof p.name !== 'string' ||
    !p.name.trim() || p.name.trim().length > FOOD_POLICY_NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(p.name) ||
    !Array.isArray(p.allowedResources) || Array.from(p.allowedResources).some(resource => !FOOD_POLICY_RESOURCES.includes(resource)))
    return null;
  return { id: p.id, name: p.name.trim(), allowedResources: FOOD_POLICY_RESOURCES.filter(resource => p.allowedResources.includes(resource)) };
}
