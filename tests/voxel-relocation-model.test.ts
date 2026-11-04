import { describe, expect, it } from 'vitest';
import { makeFurniturePiece, furnitureFromPiece, validFurniturePiece } from '../src/voxel/relocation';
import { compatibleBatches, freshBatch, mergeBatch, portion, validBatch } from '../src/voxel/preservation';
import { batchHitPoints, batchHpFraction, batchMaxHitPoints, setBatchHitPoints } from '../src/voxel/deterioration';
import { carryLimit, stackLimit, stackSpace } from '../src/voxel/logistics';
import { cargoMarketValue, furnitureMarketValue } from '../src/voxel/wealth';
import { traderAccepts } from '../src/voxel/trade';
import type { Bed, Cargo } from '../src/voxel/types';

const bed: Bed = { id: 30, x: 2, y: 3, z: 8, axis: 'x', quality: 6, owner: 3, medical: true, prisoner: true };
const cargo = (): Cargo => ({ resource: 'furniture', amount: 1, furniture: makeFurniturePiece('bed', bed, 32.375) });
describe('packed furniture identity and physical condition', () => {
  it('preserves the original identity, quality and fractional HP while separating former bed settings', () => {
    const before = structuredClone(bed), piece = makeFurniturePiece('bed', bed, 32.375);
    expect(piece).toEqual({ id: 30, kind: 'bed', quality: 6, hitPoints: 32.375, axis: 'x', owner: null });
    expect(makeFurniturePiece('bed', { ...bed, medical: false, prisoner: false })).toMatchObject({ owner: 3 });
    expect(bed).toEqual(before);
    expect(furnitureFromPiece(piece, { x: 8, y: 9, z: 10 }, 'y')).toEqual({
      id: 30, quality: 6, x: 8, y: 9, z: 10, axis: 'y', owner: null, medical: false, prisoner: false,
    });
    expect(piece.hitPoints).toBe(32.375);
  });
  it('preserves table gathering and chair payloads without generating another identity', () => {
    const table = makeFurniturePiece('table', { id: 40, x: 2, y: 3, z: 8, axis: 'y', quality: 4, gathering: false }, 77.5);
    const chair = makeFurniturePiece('chair', { id: 41, x: 2, y: 4, z: 8, axis: 'x', quality: 1 }, 12.125);
    expect(furnitureFromPiece(table, { x: 6, y: 7, z: 8 })).toMatchObject({ id: 40, quality: 4, axis: 'y', gathering: false });
    expect(chair).toEqual({ id: 41, kind: 'chair', axis: 'x', quality: 1, hitPoints: 12.125 });
  });
  it('rejects incomplete, fabricated or zero-HP furniture and duplicate outer HP', () => {
    for (const patch of [{ hitPoints: 0 }, { hitPoints: 101 }, { hitPoints: NaN }, { quality: 7 },
      { id: 0 }, { owner: -1 }, { axis: 'z' }, { medical: true }, { prisoner: false }, { maxHitPoints: 100 }])
      expect(validFurniturePiece({ ...cargo().furniture, ...patch })).toBe(false);
    for (const bad of [{ ...cargo(), amount: 2 }, { ...cargo(), hitPoints: 10 }, { ...cargo(), resource: 'wood' },
      { resource: 'furniture', amount: 1 }, { ...cargo(), rotProgress: 1 }, { ...cargo(), forbidden: 'yes' }])
      expect(validBatch(bad)).toBe(false);
    expect(validBatch(cargo())).toBe(true);
    expect(validBatch({ ...cargo(), forbidden: true })).toBe(true);
    expect(() => freshBatch('furniture', 1)).toThrow(/实例/);
  });
  it('uses single-item storage and copied payloads for whole-item transfer without merges', () => {
    const a = cargo(), b = portion(a, 1), other = cargo(); other.furniture!.id++;
    expect(b).toEqual(a); expect(b.furniture).not.toBe(a.furniture);
    b.furniture!.hitPoints = 2.5; expect(a.furniture!.hitPoints).toBe(32.375);
    expect(compatibleBatches(a, b)).toBe(true); expect(compatibleBatches(a, other)).toBe(false);
    expect(stackLimit('furniture')).toBe(1); expect(carryLimit('furniture')).toBe(1);
    expect(stackSpace(undefined, a)).toBe(1); expect(stackSpace(a, b)).toBe(0); expect(stackSpace(a, other)).toBe(0);
    expect(() => portion(a, .5)).toThrow(); expect(() => portion(a, 2)).toThrow();
    expect(() => mergeBatch(a, b)).toThrow(/不能合并/);
  });
  it('owns one continuous HP pool and preserves exact condition in market value', () => {
    const batch = cargo();
    expect(batchMaxHitPoints(batch)).toBe(100); expect(batchHitPoints(batch)).toBe(32.375);
    expect(batchHpFraction(batch)).toBe(.32375);
    expect(cargoMarketValue(batch)).toBe(furnitureMarketValue('bed', 6, .32375));
    setBatchHitPoints(batch, .375); expect(batch.furniture!.hitPoints).toBe(.375); expect(batch.hitPoints).toBeUndefined();
    setBatchHitPoints(batch, 0); expect(validBatch(batch)).toBe(false);
    expect(() => setBatchHitPoints(batch, -.1)).toThrow();
  });
  it('keeps packed furniture outside both currently supported trader inventories', () => {
    expect(traderAccepts('bulk', cargo())).toBe(false); expect(traderAccepts('combat', cargo())).toBe(false);
  });
});
