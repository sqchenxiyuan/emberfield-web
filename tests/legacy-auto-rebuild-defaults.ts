import { expect } from 'vitest';
/** Only remove unused new defaults from synthetic old-schema fixtures. */
export function stripAutoSlaughterFields(raw: Record<string, any>) {
  const policy = { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
  if (Object.hasOwn(raw, 'autoSlaughter')) expect(raw.autoSlaughter).toEqual({ hare: policy, deer: policy });
  expect(raw.pawns?.some((p: any) => p.handleTask?.action === 'autoSlaughter')).not.toBe(true);
  delete raw.autoSlaughter;
}
/** Synthetic historical fixtures only. Never rewrite real historical saves. */
export function stripAutoRebuildFields(raw: Record<string, any>) {
  stripAutoSlaughterFields(raw);
  if (Object.hasOwn(raw, 'autoRebuild')) expect(raw.autoRebuild).toBe(false);
  expect(raw.fireDamage?.some((d:any) => d.kind === 'frame')).not.toBe(true);
  delete raw.autoRebuild;
}
