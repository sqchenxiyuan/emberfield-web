import { expect } from 'vitest';
import { createDefaultFoodPolicies } from '../src/voxel/foodPolicies';
import { assertPrisonFoodDefaults, stripPrisonFoodFields } from './legacy-prison-food-defaults';

/** Synthetic downgrades may only discard untouched unrestricted policies.
 * Preflight precedes every deletion in the predecessor helper chain. */
export function assertFoodPoliciesDefaults(raw: Record<string, any>): void {
  assertPrisonFoodDefaults(raw);
  if (Object.hasOwn(raw, 'foodPolicies')) expect(raw.foodPolicies).toEqual(createDefaultFoodPolicies());
  for (const p of raw.pawns ?? []) {
    if (Object.hasOwn(p, 'manualFoodOrder')) throw new Error('Cannot downgrade manual food order');
    if (!Object.hasOwn(p, 'foodPolicyId')) continue;
    expect([null, ...(['colony', 'prisoner'].includes(p.faction) ? [1] : [])]).toContain(p.foodPolicyId);
  }
}
export function stripFoodPoliciesFields(raw: Record<string, any>): void {
  assertFoodPoliciesDefaults(raw);
  stripPrisonFoodFields(raw);
  delete raw.foodPolicies;
  for (const p of raw.pawns ?? []) delete p.foodPolicyId;
}
export function foodPoliciesExpectedField(key: string, value: any): any {
  const copy = structuredClone(value);
  if (key === 'pawns') for (const p of copy) p.foodPolicyId ??= null;
  return copy;
}
