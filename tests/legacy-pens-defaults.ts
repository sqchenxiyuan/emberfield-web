import { expect } from 'vitest';
/** Synthetic fixtures only. Genuine historical save bytes stay unchanged. */
export function stripPensFields(raw: Record<string, any>) {
  for(const key of ['fences','fenceGates','penMarkers','animalAreas']) {
    expect(raw[key] ?? []).toEqual([]);delete raw[key];
  }
  for(const p of raw.pawns ?? []) {expect(p.ropeTask ?? null).toBeNull();delete p.ropeTask;}
  for(const a of raw.animals ?? []) {
    expect(a.allowedAreaId ?? null).toBeNull();expect(a.requestedPenId ?? null).toBeNull();
    for(const key of ['allowedAreaId','requestedPenId','ropePaused','nextRoamTick'])delete a[key];
  }
}
