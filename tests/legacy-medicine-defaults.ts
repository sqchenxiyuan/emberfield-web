import { expect } from 'vitest';
import { initialMedical } from '../src/voxel/medicine';

/** Synthetic schema fixtures only; original historical bytes are never edited. */
export function stripMedicineDefaults(raw: Record<string, any>) {
  for (const p of raw.pawns) {
    expect(p.medical).toEqual(initialMedical());
    expect(p.careMedicineId).toBeNull();
    expect(p.carePhase).not.toBe('tendFetch');
    expect(p.cargo?.resource).not.toBe('herb');
    delete p.medical;
    delete p.careMedicineId;
  }
  for (const k of ['produced', 'consumed', 'spoiled', 'destroyed']) {
    expect(raw.stats[k].herb).toBe(0);
    delete raw.stats[k].herb;
  }
  for (const item of raw.items) expect(item.resource).not.toBe('herb');
  for (const c of [...raw.farms, ...raw.crops]) expect(c.crop ?? c.kind).not.toBe('healroot');
  for (const stock of raw.stockpiles)
    stock.accepts = stock.accepts.filter((r: string) => r !== 'herb');
  for (const job of raw.jobs) {
    expect(job.cropKind).not.toBe('healroot');
    delete job.cropKind;
  }
}

export function withMedicineLedgers(stats: Record<string, any>) {
  const result = structuredClone(stats);
  for (const k of ['produced', 'consumed', 'spoiled', 'destroyed'])
    result[k] = { ...result[k], herb: 0 };
  return result;
}
