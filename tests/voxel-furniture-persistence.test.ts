import { describe, expect, it } from 'vitest';
import { migrateFurniture, rejectLegacyFurnitureFields, validateFurniture } from '../src/voxel/furniturePersistence';
import { furnitureV32 } from './furniture-fixtures';

describe('furniture quality persistence and pure migration', () => {
  it.each(['furnished', 'during-meal', 'sleeping'] as const)('adds Normal to the genuine %s source without changing any historical value', name => {
    const data = furnitureV32(name), before = structuredClone(data);
    rejectLegacyFurnitureFields(data); migrateFurniture(data, 32);
    expect(() => validateFurniture(data)).not.toThrow();
    for (const key of ['beds', 'tables', 'chairs']) for (const item of data[key]) {
      expect(item.quality).toBe(2); delete item.quality;
    }
    expect(data).toEqual(before);
  });
  it('rejects forged quality in old furniture without altering the supplied data', () => {
    for (const key of ['beds', 'tables', 'chairs']) {
      const data = furnitureV32(); data[key][0].quality = 2; const before = structuredClone(data);
      expect(() => rejectLegacyFurnitureFields(data)).toThrow(/旧版本包含新版家具品质/);
      expect(data).toEqual(before);
    }
  });
  it('validates all seven values and does not normalize invalid current quality', () => {
    for (const quality of [0, 1, 2, 3, 4, 5, 6]) {
      const data = furnitureV32(); migrateFurniture(data, 32);
      for (const key of ['beds', 'tables', 'chairs']) for (const item of data[key]) item.quality = quality;
      expect(() => validateFurniture(data)).not.toThrow();
    }
    for (const quality of [undefined, null, -1, 7, .5, '2', NaN, Infinity]) for (const key of ['beds', 'tables', 'chairs']) {
      const data = furnitureV32(); migrateFurniture(data, 32); data[key][0].quality = quality;
      expect(() => validateFurniture(data)).toThrow(/品质/);
    }
  });
  it('checks all migration input first and never changes already-current furniture', () => {
    const broken = furnitureV32(); broken.tables.push(null); const before = structuredClone(broken);
    expect(() => migrateFurniture(broken, 32)).toThrow(); expect(broken).toEqual(before);
    const current = furnitureV32(); migrateFurniture(current, 32); current.version = 33; current.beds[0].quality = 6;
    const currentBefore = structuredClone(current); migrateFurniture(current, 33); expect(current).toEqual(currentBefore);
  });
});
