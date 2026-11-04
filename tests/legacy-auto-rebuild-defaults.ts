import { expect } from 'vitest';
/** Synthetic historical fixtures only. Never rewrite real historical saves. */
export function stripAutoRebuildFields(raw: Record<string, any>) {
  if (Object.hasOwn(raw, 'autoRebuild')) expect(raw.autoRebuild).toBe(false);
  expect(raw.fireDamage?.some((d:any) => d.kind === 'frame')).not.toBe(true);
  delete raw.autoRebuild;
}
