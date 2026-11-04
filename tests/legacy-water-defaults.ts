import { expect } from 'vitest';
import { CELLS } from '../src/voxel/types';
/** Synthetic migration fixtures only; never erase water from an actual colony. */
export function stripWaterFields(raw: Record<string, any>) {
  for (const p of raw.pawns ?? []) {
    if (Object.hasOwn(p, 'allowedAreaId')) expect(p.allowedAreaId).toBeNull();
    delete p.allowedAreaId;
  }
  if (Object.hasOwn(raw,'water')) expect(raw.water).toEqual([0,CELLS]);
  if (Object.hasOwn(raw,'bridges')) expect(raw.bridges).toEqual([0,CELLS]);
  expect(raw.settings?.river).toBeUndefined();
  expect(raw.jobs?.some((j:any)=>j.kind==='bridge')).not.toBe(true);
  delete raw.water; delete raw.bridges;
  if (raw.generator === 4) raw.generator = 3;
}
