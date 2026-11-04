import { expect } from 'vitest';
import { createDefaultApparelPolicies, initialApparelControl } from '../src/voxel/apparelPolicies';

/** Synthetic older-schema fixtures may drop only the untouched default
 * policy, empty forced list and inactive automatic clothing work. */
export function assertApparelPoliciesDefaults(raw: Record<string, any>): void {
  if (Object.hasOwn(raw, 'apparelPolicies')) expect(raw.apparelPolicies).toEqual(createDefaultApparelPolicies());
  for (const p of raw.pawns ?? []) {
    if (p.apparelTask && Object.hasOwn(p.apparelTask, 'automatic')) throw new Error('Cannot downgrade automatic apparel task');
    if (!Object.hasOwn(p, 'apparelControl')) continue;
    const c = p.apparelControl;
    expect([null, ...(p.faction === 'colony' ? [1] : [])]).toContain(c.policyId);
    expect(Number.isSafeInteger(c.nextCheckTick) && c.nextCheckTick >= 0).toBe(true);
    expect(c).toEqual(initialApparelControl(c.nextCheckTick, c.policyId));
  }
}
export function stripApparelPoliciesFields(raw: Record<string, any>): void {
  assertApparelPoliciesDefaults(raw);
  delete raw.apparelPolicies;
  for (const p of raw.pawns ?? []) delete p.apparelControl;
}
export function apparelPoliciesExpectedField(key: string, value: any, tick = 0): any {
  const copy = structuredClone(value);
  if (key === 'pawns') for (const p of copy) p.apparelControl ??= initialApparelControl(tick);
  return copy;
}
