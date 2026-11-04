import { expect } from 'vitest';
import { stripFurnitureFields } from './legacy-furniture-defaults';
/** Synthetic historical inputs only; never rewrite captured fixture bytes. */
export function stripSocialFields(raw: Record<string, any>) {
  stripFurnitureFields(raw);
  expect(raw.socialHistory ?? []).toEqual([]); expect(raw.socialLog ?? []).toEqual([]);
  delete raw.socialHistory; delete raw.socialLog;
  for (const p of raw.pawns ?? []) {
    expect(p.social?.memories ?? []).toEqual([]);
    expect(p.psyche?.recreation?.kind).not.toBe('social');
    delete p.social;
    if (p.psyche?.tolerance) delete p.psyche.tolerance.social;
  }
  for (const table of raw.tables ?? []) delete table.gathering;
}
