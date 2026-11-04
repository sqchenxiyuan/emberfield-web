import { expect } from 'vitest';
/** Synthetic old-schema tests only. Captured historical files stay untouched. */
export function stripRegionFields(raw: Record<string, any>) {
  if (Object.hasOwn(raw, 'productionQueues')) expect(raw.productionQueues).toEqual([]);
  delete raw.productionQueues;
  for (const job of raw.jobs ?? []) { delete job.billId; delete job.productionPolicy; }
  // Exploration did not exist before v36. Synthetic history must remove it.
  delete raw.explored;
  if (Object.hasOwn(raw,'storageGroups')) expect(raw.storageGroups).toEqual([]);
  delete raw.storageGroups;
  for (const job of raw.jobs ?? []) expect(job.storageSettings).toBeUndefined();
  if (Object.hasOwn(raw,'shelves')) expect(raw.shelves).toEqual([]);
  if (Object.hasOwn(raw,'storageSpills')) expect(raw.storageSpills).toEqual([]);
  delete raw.shelves; delete raw.storageSpills;
  if (Object.hasOwn(raw, 'worldSite')) {
    expect(raw.worldSite).toBeNull();
    delete raw.worldSite;
  }
}
