import { expect } from 'vitest';
/** Synthetic old-schema tests only. Captured historical files stay untouched. */
export function stripRegionFields(raw: Record<string, any>) {
  if (Object.hasOwn(raw, 'worldSite')) {
    expect(raw.worldSite).toBeNull();
    delete raw.worldSite;
  }
}
