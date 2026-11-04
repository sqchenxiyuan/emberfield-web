import { describe, expect, it } from 'vitest';
import { migrateRelocation, rejectLegacyRelocationFields, validateRelocation } from '../src/voxel/relocationPersistence';
import { makeFurniturePiece } from '../src/voxel/relocation';
import { relocationV33 } from './relocation-fixtures';

const current = () => { const d = relocationV33(); migrateRelocation(d, 33); d.version = 34; return d; };
function packed() {
  const d = current(), bed = d.beds.shift(), piece = makeFurniturePiece('bed', bed, 61.125);
  const item = { resource: 'furniture', amount: 1, furniture: piece, id: d.nextId++, x: bed.x, y: bed.y, z: bed.z };
  d.items.push(item); return { d, item, bed };
}
const install = (d: any, piece: any): Record<string, any> => ({ id: d.nextId++, kind: 'install', furnitureId: piece.id,
  furnitureKind: piece.kind, x: 20, y: 20, z: 8, axis: 'y', cost: { furniture: 1 }, delivered: {}, deliveredBatches: [], cancelled: false });
describe('relocation persistence and unique physical ownership', () => {
  it.each(['furnished', 'sleeping', 'during-meal'] as const)('only adds ledger zeros to the exact published v33 %s checkpoint', name => {
    const d = relocationV33(name), before = structuredClone(d);
    rejectLegacyRelocationFields(d); migrateRelocation(d, 33); expect(() => validateRelocation(d)).not.toThrow();
    for (const ledger of [d.stats.produced, d.stats.consumed, d.stats.spoiled, d.stats.destroyed, d.trade.imported, d.trade.exported]) {
      expect(ledger.furniture).toBe(0); delete ledger.furniture;
    }
    expect(d).toEqual(before);
  });
  it('rejects new fields in every old container and ledger before any migration can mask them', () => {
    for (const inject of [
      (d: any) => d.items.push({ resource: 'furniture' }),
      (d: any) => d.pawns[0].cargo = { furniture: {} },
      (d: any) => d.jobs.push({ kind: 'install' }),
      (d: any) => d.jobs.push({ cost: { furniture: 0 } }),
      (d: any) => d.jobs.push({ deliveredBatches: [{ furniture: {} }] }),
      (d: any) => d.trade.receipts.push({ transferred: [{ batch: { resource: 'furniture' } }] }),
      (d: any) => d.trade.caravans.push({ stock: [{ furniture: {} }] }),
      (d: any) => d.trade.imported.furniture = 0,
      (d: any) => d.stats.produced.furniture = 0,
      (d: any) => d.stockpiles[0].accepts.push('furniture'),
    ]) { const d = relocationV33(); inject(d); const before = structuredClone(d);
      expect(() => rejectLegacyRelocationFields(d)).toThrow(/旧版本/); expect(d).toEqual(before); }
  });
  it('validates each unique ground, carried or delivered location without requiring a new furniture identity', () => {
    const { d, item } = packed(); expect(() => validateRelocation(d)).not.toThrow();
    const job = install(d, item.furniture); d.jobs.push(job); expect(() => validateRelocation(d)).not.toThrow();
    d.items = d.items.filter((i: any) => i !== item);
    const cargo = { resource: item.resource, amount: 1, furniture: item.furniture };
    d.pawns[0].cargo = cargo; expect(() => validateRelocation(d)).not.toThrow();
    d.pawns[0].cargo = null; job.delivered = { furniture: 1 }; job.deliveredBatches = [cargo];
    expect(() => validateRelocation(d)).not.toThrow(); job.cancelled = true;
    expect(() => validateRelocation(d)).not.toThrow();
  });
  it('rejects duplicates across installed, ground, carried, delivered and existing entity IDs', () => {
    for (const mutate of [
      (d: any, item: any, bed: any) => d.beds.push(bed),
      (d: any, item: any) => d.pawns[0].cargo = { resource: 'furniture', amount: 1, furniture: { ...item.furniture } },
      (d: any, item: any) => { const j = install(d, item.furniture); j.delivered = { furniture: 1 };
        j.deliveredBatches = [{ resource: 'furniture', amount: 1, furniture: { ...item.furniture } }]; d.jobs.push(j); },
      (d: any, item: any) => item.furniture.id = d.pawns[0].id,
      (d: any, item: any) => item.furniture.id = item.id,
      (d: any, item: any) => item.furniture.id = d.nextId,
    ]) { const { d, item, bed } = packed(); mutate(d, item, bed); expect(() => validateRelocation(d)).toThrow(/实例/); }
  });
  it('binds orders to the exact item and permits one uninstall/install pair for installed furniture', () => {
    const d = current(), bed = d.beds[0];
    const uninstall = { id: d.nextId++, kind: 'uninstall', furnitureId: bed.id, furnitureKind: 'bed', x: bed.x, y: bed.y, z: bed.z, axis: bed.axis,
      cost: {}, delivered: {}, deliveredBatches: [], cancelled: false };
    d.jobs.push(uninstall, install(d, { ...bed, kind: 'bed' })); expect(() => validateRelocation(d)).not.toThrow();
    d.jobs.push({ ...uninstall, id: d.nextId++ }); expect(() => validateRelocation(d)).toThrow(/重复搬装/);
    const p = packed(), job = install(p.d, p.item.furniture); job.furnitureKind = 'chair'; p.d.jobs.push(job);
    expect(() => validateRelocation(p.d)).toThrow(/不存在/);
  });
  it('rejects hidden furniture in nonrelocation jobs and unsupported trade containers', () => {
    const { d, item } = packed(); d.jobs.push({ kind: 'bed', furnitureId: item.furniture.id });
    expect(() => validateRelocation(d)).toThrow(/非搬装/); d.jobs.pop();
    d.trade.caravans.push({ stock: [item] }); expect(() => validateRelocation(d)).toThrow(/贸易/);
  });
  it('rejects uninstall position/axis substitutions and out-of-world installation footprints', () => {
    for (const patch of [{ x: 0 }, { axis: 'invalid' }, { z: 0 }]) {
      const d = current(), bed = d.beds[0];
      d.jobs.push({ id: d.nextId++, kind: 'uninstall', furnitureId: bed.id, furnitureKind: 'bed',
        x: bed.x, y: bed.y, z: bed.z, axis: bed.axis, cost: {}, delivered: {}, deliveredBatches: [], cancelled: false, ...patch });
      expect(() => validateRelocation(d)).toThrow();
    }
    for (const patch of [{ x: 63, axis: 'x' }, { y: 63, axis: 'y' }, { z: 15 }, { x: 1.5 }]) {
      const { d, item } = packed(); d.jobs.push({ ...install(d, item.furniture), ...patch });
      expect(() => validateRelocation(d)).toThrow(/占地|位置/);
    }
  });
  it.each([['bed', 128], ['table', 128], ['chair', 256]] as const)('bounds combined installed and packed %s quantity at %s', (kind, limit) => {
    const d = current(), key = kind === 'bed' ? 'beds' : kind === 'table' ? 'tables' : 'chairs';
    const exemplar = d[key][0], base = d[key].length;
    const add = () => {
      const piece = makeFurniturePiece(kind, { ...exemplar, id: d.nextId++ });
      d.items.push({ id: d.nextId++, resource: 'furniture', amount: 1, furniture: piece, x: 10, y: 10, z: 8 });
    };
    for (let i = base; i < limit; i++) add();
    expect(() => validateRelocation(d)).not.toThrow();
    add(); expect(() => validateRelocation(d)).toThrow(/总量超过上限/);
  });
  it('validates all migration ledgers before writing and leaves current saves untouched', () => {
    const old = relocationV33(); delete old.trade.exported; const before = structuredClone(old);
    expect(() => migrateRelocation(old, 33)).toThrow(); expect(old).toEqual(before);
    const d = current(); d.stats.produced.furniture = 5; const exact = structuredClone(d);
    migrateRelocation(d, 34); expect(d).toEqual(exact);
    d.stats.spoiled.furniture = 1; expect(() => validateRelocation(d)).toThrow(/不可腐坏/);
  });
});
