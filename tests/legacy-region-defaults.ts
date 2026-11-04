import { expect } from 'vitest';
/** Synthetic old-schema tests only. Captured historical files stay untouched. */
export function stripRegionFields(raw: Record<string, any>) {
  // Exploration did not exist before v36. Synthetic history must remove it.
  delete raw.explored;
  if (Object.hasOwn(raw, 'worldSite')) {
    expect(raw.worldSite).toBeNull();
    delete raw.worldSite;
  }
}
