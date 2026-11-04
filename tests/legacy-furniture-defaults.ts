import { expect } from 'vitest';
/** Synthetic historical inputs only. Genuine captured save bytes are immutable.
 * A non-Normal new item cannot be relabelled as a genuine pre-quality object. */
export function stripFurnitureFields(raw: Record<string, any>) {
  for (const key of ['beds', 'tables', 'chairs']) for (const item of raw[key] ?? []) {
    if (Object.hasOwn(item, 'quality')) expect(item.quality).toBe(2);
    delete item.quality;
  }
}
