import { expect } from 'vitest';
import { emptyAnimalTradeCounts } from '../src/voxel/animalTrade';
import { animalMedicalExpectedField, stripAnimalMedicalFields } from './legacy-animal-medical-defaults';
/** Synthetic defaults only; never discard live visitors or transaction history. */
export function stripAnimalTradeFields(raw: Record<string,any>) {
  stripAnimalMedicalFields(raw);
  expect(raw.animals?.some((a:any)=>a.faction==='trader'||a.goal?.kind==='caravan')).not.toBe(true);
  const previousCounts = Object.fromEntries(Object.entries(emptyAnimalTradeCounts()).filter(([kind]) => kind !== 'labrador'));
  if(raw.trade?.animalLedger)expect(raw.trade.animalLedger).toEqual({bought:previousCounts,sold:previousCounts});
  for(const c of raw.trade?.caravans??[])if(Object.hasOwn(c,'animalIds'))expect(c.animalIds).toEqual([]);
  for(const r of raw.trade?.receipts??[])if(Object.hasOwn(r,'animalTransfers'))expect(r.animalTransfers).toEqual([]);
  if(raw.trade)delete raw.trade.animalLedger;
  for(const c of raw.trade?.caravans??[])delete c.animalIds;
  for(const r of raw.trade?.receipts??[])delete r.animalTransfers;
}
export function animalTradeExpectedField(key:string,value:any):any {
  const copy=animalMedicalExpectedField(key,value);
  if(key!=='trade')return copy;
  return {...copy,animalLedger:{bought:emptyAnimalTradeCounts(),sold:emptyAnimalTradeCounts()},
    caravans:copy.caravans.map((c:any)=>({...c,animalIds:[]})),receipts:copy.receipts.map((r:any)=>({...r,animalTransfers:[]}))};
}
