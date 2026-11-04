import { describe, expect, it } from 'vitest';
import { furnitureStats, isFurnitureKind, type FurnitureKind } from '../src/voxel/furniture';
import { furnitureMarketValue, constructedMarketValue } from '../src/voxel/wealth';
import { FIRE_MAX_HP } from '../src/voxel/fire';
import { LIVING_BUILDINGS, LIVING_RULES } from '../src/voxel/living';
import type { ApparelQuality } from '../src/voxel/types';

const qualities: ApparelQuality[] = [0, 1, 2, 3, 4, 5, 6];
describe('furniture quality mechanics and established Web bases', () => {
  it('preserves Normal furniture and keeps HP identical at every quality', () => {
    expect(furnitureStats('bed', 2)).toEqual({ qualityName: '普通', maxHitPoints: FIRE_MAX_HP.bed,
      beauty: 1, comfort: LIVING_RULES.bedComfort, restEffectiveness: 1 });
    expect(furnitureStats('table', 2)).toEqual({ qualityName: '普通', maxHitPoints: FIRE_MAX_HP.table,
      beauty: LIVING_BUILDINGS.table.beauty, comfort: null, restEffectiveness: null });
    expect(furnitureStats('chair', 2)).toEqual({ qualityName: '普通', maxHitPoints: FIRE_MAX_HP.chair,
      beauty: LIVING_BUILDINGS.chair.beauty, comfort: LIVING_RULES.chairComfort, restEffectiveness: null });
    for (const kind of ['bed', 'table', 'chair'] as FurnitureKind[])
      expect(qualities.map(q => furnitureStats(kind, q).maxHitPoints)).toEqual(qualities.map(() => FIRE_MAX_HP[kind]));
  });
  it('applies native comfort and bed-rest parts without confusing rated comfort with the capped need', () => {
    expect(qualities.map(q => furnitureStats('bed', q).restEffectiveness)).toEqual([.86, .92, 1, 1.08, 1.14, 1.25, 1.6]);
    const comfort = [.76, .88, 1, 1.12, 1.24, 1.45, 1.7];
    for (const q of qualities) {
      expect(furnitureStats('bed', q).comfort).toBeCloseTo(75 * comfort[q]);
      expect(furnitureStats('chair', q).comfort).toBeCloseTo(70 * comfort[q]);
    }
    expect(furnitureStats('bed', 6).comfort).toBe(127.5);
    expect(furnitureStats('chair', 6).comfort).toBe(119);
    expect(furnitureStats('table', 6).comfort).toBeNull();
  });
  it('uses native positive-beauty quality parts and ties-to-even on current furniture bases', () => {
    expect(qualities.map(q => furnitureStats('bed', q).beauty)).toEqual([0, 0, 1, 2, 3, 5, 8]);
    expect(qualities.map(q => furnitureStats('chair', q).beauty)).toEqual([0, 0, 1, 2, 3, 5, 8]);
    expect(qualities.map(q => furnitureStats('table', q).beauty)).toEqual([0, 1, 2, 4, 6, 10, 16]);
  });
  it('retains the old material/work value at Normal and applies quality before condition', () => {
    expect(furnitureMarketValue('bed', 2)).toBe(constructedMarketValue({ wood: 45 }, 187));
    expect(furnitureMarketValue('table', 2)).toBe(constructedMarketValue(LIVING_BUILDINGS.table.cost, LIVING_BUILDINGS.table.work));
    expect(furnitureMarketValue('chair', 2)).toBe(constructedMarketValue(LIVING_BUILDINGS.chair.cost, LIVING_BUILDINGS.chair.work));
    expect(furnitureMarketValue('bed', 6)).toBe(280);
    // Raw 56.016 * legendary5 * half-condition.1 = 28.008. Rounding the
    // full-health legendary price first would incorrectly return 28.
    expect(furnitureMarketValue('bed', 6, .5)).toBeCloseTo(28.008, 9);
    expect(furnitureMarketValue('table', 3, .5)).toBeCloseTo(4.362, 9);
    expect(furnitureMarketValue('chair', 0, .5)).toBeCloseTo(.9486, 9);
    expect(furnitureMarketValue('bed', 6, 0)).toBe(0);
  });
  it('does not invent quality for horseshoes or accept malformed kinds, qualities or condition', () => {
    expect(isFurnitureKind('horseshoePin')).toBe(false);
    for (const quality of [-1, 7, .5, NaN, Infinity]) {
      expect(() => furnitureStats('bed', quality as ApparelQuality)).toThrow();
      expect(() => furnitureMarketValue('table', quality as ApparelQuality)).toThrow();
    }
    expect(() => furnitureStats('horseshoePin' as FurnitureKind, 2)).toThrow();
    for (const hp of [-.1, 1.1, NaN, Infinity]) expect(() => furnitureMarketValue('chair', 2, hp)).toThrow();
  });
});
