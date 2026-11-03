import { describe, expect, it } from 'vitest';
import { cookingOutcome, cookingPoisonRisk, exposeFoodPoisoning, initialFoodPoisoning,
  poisoningStage, SANITATION_RULES, validFoodPoisoning } from '../src/voxel/sanitation';
import { freshBatch, mergeBatch, portion, validBatch } from '../src/voxel/preservation';
import { initialSurvival, healthSummary } from '../src/voxel/survival';

describe('sanitation batch and illness rules', () => {
  it('separates room cleanliness and cook skill while outdoor risk ignores map-wide stains', () => {
    expect(cookingPoisonRisk(0, 0)).toBeGreaterThan(cookingPoisonRisk(20, 0));
    expect(cookingPoisonRisk(10, -4)).toBeGreaterThan(cookingPoisonRisk(10, 0));
    expect(cookingPoisonRisk(10, -.2)).toBe(cookingPoisonRisk(10, 0));
    expect(cookingPoisonRisk(10, -100, true)).toBe(cookingPoisonRisk(10, 0, true));
    expect(cookingPoisonRisk(20, 0, true)).toBeGreaterThan(cookingPoisonRisk(20, 0));
    for (const value of [NaN, Infinity, -1, 21]) expect(() => cookingPoisonRisk(value, 0)).toThrow();
    expect(() => cookingPoisonRisk(1, NaN)).toThrow();
  });
  it('locks a single batch outcome independently of reload time or prospective eater', () => {
    const outcome = cookingOutcome(73129, 100, 5, 4, -1.5);
    expect(cookingOutcome(73129, 100, 5, 4, -1.5)).toEqual(outcome);
    expect([0, 1]).toContain(outcome.poisonChance);
    expect(outcome.poisonChance).toBe(Number(outcome.roll < outcome.risk));
    expect(cookingOutcome(73129, 101, 5, 4, -1.5).roll).not.toBe(outcome.roll);
  });
  it('conserves contamination through multiple partial transfers and weighted merges', () => {
    const original = { ...freshBatch('meal', 9), poisonChance: .75 };
    const safe = freshBatch('meal', 3), first = portion(original, 2);
    original.amount -= first.amount; mergeBatch(safe, first);
    const second = portion(original, 3); original.amount -= second.amount; mergeBatch(safe, second);
    expect(original.amount + safe.amount).toBe(12);
    expect(original.amount * original.poisonChance + safe.amount * safe.poisonChance!).toBeCloseTo(9 * .75, 12);
    expect(portion(safe, 1).poisonChance).toBe(safe.poisonChance);
    expect(original.poisonChance).toBe(.75);
    expect(freshBatch('meal', 1).poisonChance).toBeUndefined();
  });
  it('rejects pollution metadata on non-meals and nonfinite or out-of-range values', () => {
    for (const value of [-.01, 1.01, NaN, Infinity])
      expect(validBatch({ ...freshBatch('meal', 1), poisonChance: value })).toBe(false);
    for (const resource of ['grain', 'meat', 'food', 'wood'] as const)
      expect(validBatch({ ...freshBatch(resource, 1), poisonChance: 0 })).toBe(false);
    expect(validBatch({ ...freshBatch('meal', 1), poisonChance: .4 })).toBe(true);
  });
  it('has initial, major and recovery phases with corresponding capacity changes', () => {
    const episode = initialFoodPoisoning(100), p = initialSurvival(1, 1);
    p.foodPoisoning = episode;
    const initial = healthSummary(p).moving;
    episode.stage = poisoningStage(episode, 100 + SANITATION_RULES.poisonDuration * .4);
    expect(episode.stage).toBe('major'); expect(healthSummary(p).moving).toBeLessThan(initial);
    episode.stage = poisoningStage(episode, 100 + SANITATION_RULES.poisonDuration * .9);
    expect(episode.stage).toBe('recovering'); expect(healthSummary(p).moving).toBe(initial);
    p.foodPoisoning = null; expect(healthSummary(p).moving).toBe(1);
  });
  it('does not stack initial exposure, but returns later exposure to one finite major episode', () => {
    const episode = initialFoodPoisoning(100);
    expect(exposeFoodPoisoning(episode, 200)).toBe(episode);
    const tick = 100 + Math.floor(SANITATION_RULES.poisonDuration * .9);
    episode.stage = poisoningStage(episode, tick);
    const repeated = exposeFoodPoisoning(episode, tick);
    expect(repeated.stage).toBe('major'); expect(poisoningStage(repeated, tick)).toBe('major');
    expect(repeated.endsTick).toBeGreaterThan(episode.endsTick);
    expect(repeated.endsTick - tick).toBeLessThan(SANITATION_RULES.poisonDuration);
    expect(repeated.nextVomitTick).toBeGreaterThan(tick);
    expect(validFoodPoisoning(repeated, tick)).toBe(true);
    expect(validFoodPoisoning({ ...repeated, endsTick: repeated.endsTick + 1 }, tick)).toBe(false);
  });
});
