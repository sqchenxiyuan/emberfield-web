import { expect } from 'vitest';
import { initialAnimalTraining } from '../src/voxel/animalTraining';
import { defaultAutoSlaughterPolicy } from '../src/voxel/autoSlaughter';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';

const animals = (raw: Record<string,any>): any[] => [...(raw.animals ?? []),
  ...(raw.trade?.receipts ?? []).flatMap((r:any) => (r.animalTransfers ?? []).map((row:any) => row.animal))];
const visit = (node:any, check:(value:any)=>void):void => {
  if (!node || typeof node !== 'object') return; check(node); Object.values(node).forEach(value => visit(value,check));
};
/** Synthetic old fixtures can shed only exact unused defaults. Validate every
 * carrier and historical snapshot before deleting anything from the graph. */
export function assertAnimalTrainingDefaults(raw: Record<string,any>): void {
  for (const a of animals(raw)) {
    if (a.species === 'labrador' || ['follow','attack','rescue','haul'].includes(a.phase))
      throw new Error('Cannot downgrade a Labrador or active animal work');
    if (Object.hasOwn(a,'training')) expect(a.training).toEqual(initialAnimalTraining(a.species));
    if (Object.hasOwn(a,'work')) expect(a.work).toBeNull();
    if (Object.hasOwn(a,'cargo')) expect(a.cargo).toBeNull();
  }
  for (const p of raw.pawns ?? []) {
    if (Object.hasOwn(p,'animalTrainTask') || p.phase === 'animalTrain') throw new Error('Cannot downgrade active animal training');
    if (Object.hasOwn(p,'animalsReleased')) expect(p.animalsReleased).toBe(false);
  }
  if (raw.husbandryLog?.some((e:any) => e.kind === 'training')) throw new Error('Cannot downgrade animal training history');
  if (Object.hasOwn(raw.autoSlaughter ?? {},'labrador')) expect(raw.autoSlaughter.labrador).toEqual(defaultAutoSlaughterPolicy());
  for (const side of ['bought','sold']) if (Object.hasOwn(raw.trade?.animalLedger?.[side] ?? {},'labrador'))
    expect(raw.trade.animalLedger[side].labrador).toBe(0);
  visit(raw, v => {
    if (v.species === 'labrador') throw new Error('Cannot downgrade Labrador identity or carcass');
    if (Array.isArray(v.allowedCarcasses) && v.allowedCarcasses.includes('labrador'))
      expect([...v.allowedCarcasses].sort()).toEqual(Object.keys(ANIMAL_DEFS).sort());
  });
}
export function stripAnimalTrainingFields(raw: Record<string,any>): void {
  assertAnimalTrainingDefaults(raw);
  for (const a of animals(raw)) { delete a.training; delete a.work; delete a.cargo; }
  for (const p of raw.pawns ?? []) delete p.animalsReleased;
  if (raw.autoSlaughter) delete raw.autoSlaughter.labrador;
  for (const side of ['bought','sold']) if (raw.trade?.animalLedger?.[side]) delete raw.trade.animalLedger[side].labrador;
  visit(raw, v => {
    if (Array.isArray(v.allowedCarcasses)) v.allowedCarcasses = v.allowedCarcasses.filter((s:string) => s !== 'labrador');
  });
}
export function animalTrainingExpectedField(key:string,value:any):any {
  const copy = structuredClone(value);
  const add = (a:any) => Object.assign(a, {training:initialAnimalTraining(a.species),work:null,cargo:null});
  if (key === 'animals') copy.forEach(add);
  if (key === 'pawns') for (const p of copy) p.animalsReleased = false;
  if (key === 'autoSlaughter') copy.labrador = defaultAutoSlaughterPolicy();
  if (key === 'trade') {
    for (const r of copy.receipts ?? []) for (const row of r.animalTransfers ?? []) add(row.animal);
    for (const side of ['bought','sold']) if (copy.animalLedger?.[side]) copy.animalLedger[side].labrador = 0;
  }
  return copy;
}
