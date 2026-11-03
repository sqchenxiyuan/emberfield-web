import { expect } from 'vitest';
/** Synthetic historical fixtures only. Captured saves are never rewritten. */
export function stripLivingFields(raw: Record<string, any>) {
  expect(raw.tables ?? []).toEqual([]); expect(raw.chairs ?? []).toEqual([]);
  delete raw.tables; delete raw.chairs;
  for (const p of raw.pawns ?? []) {
    expect(p.living?.mealTask ?? null).toBeNull();
    delete p.living;
  }
}
