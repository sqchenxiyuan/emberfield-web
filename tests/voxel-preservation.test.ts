import { describe, expect, it } from 'vitest';
import { advanceRot, compatibleBatches, freshBatch, mergeBatch, portion, remainingRotDays, ROT_DAYS, rotLimit, rotRateAtTemperature, validBatch } from '../src/voxel/preservation';
import { DAY, type Cargo } from '../src/voxel/types';

describe('source-derived food preservation rules', () => {
  it('preserves the native temperature curve and converts elapsed time by game days', () => {
    expect([-100, -1, 0, 2, 5, 9, 10, 40].map(rotRateAtTemperature)).toEqual([0, 0, 0, .2, .5, .9, 1, 1]);
    expect(ROT_DAYS).toEqual({ rice: 40, potato: 30, corn: 60, meal: 4, herb: 150 });
    for (const crop of ['rice', 'potato', 'corn'] as const) expect(rotLimit(freshBatch('grain', 1, crop))).toBe(ROT_DAYS[crop] * DAY);
    expect(rotLimit(freshBatch('meal', 1))).toBe(4 * DAY);
  });
  it('freezes without resetting accumulated progress and resumes when warmed', () => {
    const meal = freshBatch('meal', 3); meal.rotProgress = 2 * DAY;
    expect(advanceRot(meal, -5, 100 * DAY)).toBe(false); expect(meal.rotProgress).toBe(2 * DAY);
    expect(advanceRot(meal, 5, DAY)).toBe(false); expect(meal.rotProgress).toBe(2.5 * DAY);
    expect(remainingRotDays(meal)).toBe(1.5);
    expect(advanceRot(meal, 20, 1.5 * DAY)).toBe(true); expect(remainingRotDays(meal)).toBe(0);
  });
  it('expires the whole batch at threshold and keeps packaged survival food nonperishable', () => {
    const meal = freshBatch('meal', 9);
    expect(advanceRot(meal, 20, 4 * DAY - 1)).toBe(false);
    expect(advanceRot(meal, 20)).toBe(true); expect(meal.amount).toBe(9);
    const ration = freshBatch('food', 60);
    expect(advanceRot(ration, 1000, 10_000 * DAY)).toBe(false);
    expect(ration).toEqual({ resource: 'food', amount: 60 }); expect(remainingRotDays(ration)).toBeNull();
  });
  it('splits without changing age and merges by transferred quantity, not source pile size', () => {
    const receiving: Cargo = { resource: 'grain', crop: 'rice', amount: 30, rotProgress: 100 };
    const source: Cargo = { resource: 'grain', crop: 'rice', amount: 50, rotProgress: 500 };
    const transferred = portion(source, 10);
    expect(transferred.rotProgress).toBe(500);
    mergeBatch(receiving, transferred);
    expect(receiving).toEqual({ resource: 'grain', crop: 'rice', amount: 40, rotProgress: 200 });
    expect(source).toEqual({ resource: 'grain', crop: 'rice', amount: 50, rotProgress: 500 });
    expect(compatibleBatches(receiving, freshBatch('grain', 10, 'potato'))).toBe(false);
    expect(() => mergeBatch(receiving, freshBatch('grain', 10, 'corn'))).toThrow();
  });
  it('requires valid species/age only for foods that actually rot', () => {
    const invalid: unknown[] = [null, [], { resource: 'grain', amount: 4 },
      { resource: 'grain', amount: 4, crop: 'wheat', rotProgress: 0 },
      { resource: 'grain', amount: 4, crop: 'rice', rotProgress: NaN },
      { resource: 'meal', amount: 2, rotProgress: -1 }, { resource: 'meal', amount: 2, rotProgress: 4 * DAY },
      { resource: 'meal', amount: 2, crop: 'rice', rotProgress: 0 },
      { resource: 'wood', amount: 2, rotProgress: 0 }, { resource: 'food', amount: 2, rotProgress: 0 },
      { resource: 'grain', amount: 0, crop: 'rice', rotProgress: 0 }];
    for (const batch of invalid) expect(validBatch(batch)).toBe(false);
    for (const batch of [freshBatch('grain', 4, 'potato'), freshBatch('meal', 1), freshBatch('food', 60), freshBatch('wood', 3)])
      expect(validBatch(batch)).toBe(true);
  });
});
