import { expect } from 'vitest';
import { initialAnimalMedical } from '../src/voxel/animalMedical';

/** Synthetic schema downgrades may remove only untouched medical defaults. */
export function stripAnimalMedicalFields(raw: Record<string, any>) {
  if (Object.hasOwn(raw, 'animalBeds')) expect(raw.animalBeds).toEqual([]);
  for (const p of raw.pawns ?? []) {
    expect(Object.hasOwn(p, 'animalCareTask')).toBe(false); expect(p.phase).not.toBe('animalCare');
  }
  const animals = [...(raw.animals ?? []), ...(raw.trade?.receipts ?? []).flatMap((r: any) =>
    (r.animalTransfers ?? []).map((row: any) => row.animal))];
  for (const a of animals) {
    expect(['medicalRest','downed','carried']).not.toContain(a.phase);
    if (Object.hasOwn(a, 'medical')) expect(a.medical).toEqual(initialAnimalMedical());
  }
  for (const a of animals) delete a.medical;
  delete raw.animalBeds;
}

export function animalMedicalExpectedField(key: string, value: any): any {
  const copy = structuredClone(value);
  if (key === 'animals') for (const a of copy) a.medical = initialAnimalMedical();
  if (key === 'trade') for (const r of copy.receipts ?? []) for (const row of r.animalTransfers ?? [])
    row.animal.medical = initialAnimalMedical();
  return copy;
}
