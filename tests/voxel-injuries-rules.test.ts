import { describe, expect, it } from 'vitest';
import { DAY } from '../src/voxel/types';
import {
  applyInjury, advanceTrauma, bleedingStopsAt, BODY_REGIONS, initialTrauma,
  injuryBleedRate, tendOne, traumaSummary, validTrauma, type Trauma, type TraumaContext,
} from '../src/voxel/injuries';

const context: TraumaContext = { seed: 1123, pawnId: 7, starving: false, resting: false, inBed: false };
const total = (t: Trauma) => t.wounds.reduce((sum, w) => sum + w.severity, 0);
function days(t: Trauma, count: number, c: Partial<TraumaContext> = {}, start = 1) {
  for (let tick = start; tick < start + DAY * count; tick++) advanceTrauma(t, tick, { ...context, ...c });
}

describe('voxel injury rules and evidence boundaries', () => {
  it('keeps independent initial state and declares the actual 64-part body with normalized coverage', () => {
    const a = initialTrauma(), b = initialTrauma();
    applyInjury(a, 1, 'leftArm', 'bruise', 8.2);
    expect(b).toEqual({ wounds: [], bloodLoss: 0, missingParts: [] });
    expect(Object.keys(BODY_REGIONS)).toHaveLength(64);
    expect(Object.values(BODY_REGIONS).reduce((sum, p) => sum + p.weight, 0)).toBeCloseTo(1);
    expect(['torso', 'head', 'neck', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'].map(p => BODY_REGIONS[p as keyof typeof BODY_REGIONS].hitPoints)).toEqual([40, 25, 25, 30, 30, 30, 30]);
  });
  it('normal punching produces pain without invented bleeding; cuts use actual part bleed factors', () => {
    const t = initialTrauma();
    const bruise = applyInjury(t, 1, 'leftArm', 'bruise', 8.2)!;
    expect(traumaSummary(t).pain).toBeCloseTo(8.2 * 0.0125);
    expect(injuryBleedRate(bruise)).toBe(0);
    const neck = applyInjury(t, 2, 'neck', 'cut', 5)!;
    const head = applyInjury(t, 3, 'head', 'stab', 5)!;
    const arm = applyInjury(t, 4, 'rightArm', 'bite', 5)!;
    expect(injuryBleedRate(neck)).toBeCloseTo(1.2);
    expect(injuryBleedRate(head)).toBeCloseTo(0.6);
    expect(injuryBleedRate(arm)).toBeCloseTo(0.3);
    expect(traumaSummary(t).bleedRate).toBeCloseTo(2.1);
  });
  it('maps age-based spontaneous bleeding stop to game days using current wound severity', () => {
    const t = initialTrauma(), w = applyInjury(t, 1, 'leftLeg', 'cut', 1)!;
    expect(bleedingStopsAt(w)).toBe(DAY * 1.5);
    w.ageTicks = DAY * 1.5 - 1;
    expect(injuryBleedRate(w)).toBeGreaterThan(0);
    w.ageTicks++;
    expect(injuryBleedRate(w)).toBe(0);
    w.severity = 30;
    expect(bleedingStopsAt(w)).toBe(DAY * 3);
    expect(injuryBleedRate(w)).toBeGreaterThan(0);
  });
  it('applies the blood loss threshold and recovery independently from starvation', () => {
    const t = initialTrauma();
    applyInjury(t, 1, 'leftLeg', 'cut', 10);
    advanceTrauma(t, DAY / 1000 - 1, { ...context, starving: true });
    expect(t.bloodLoss).toBe(0);
    advanceTrauma(t, DAY / 1000, { ...context, starving: true });
    expect(t.bloodLoss).toBeCloseTo(0.0006);
    t.wounds[0].tendQuality = 0;
    advanceTrauma(t, DAY / 500, { ...context, starving: true });
    expect(t.bloodLoss).toBeCloseTo(0.0006 - 1 / 3000);
    const tiny = initialTrauma(); tiny.bloodLoss = 0.4;
    applyInjury(tiny, 2, 'rightLeg', 'cut', 1);
    advanceTrauma(tiny, 12, { ...context, starving: true });
    expect(tiny.bloodLoss).toBeCloseTo(0.4 - 1 / 3000);
  });
  it.each([[0, 0, 1], [0.1499, 0, 1], [0.15, -0.1, 1], [0.3, -0.2, 1],
    [0.45, -0.4, 1], [0.6, -0.4, 0.1]])('preserves blood-loss stage %s', (level, offset, max) => {
    const t = initialTrauma(); t.bloodLoss = level;
    expect(traumaSummary(t).consciousnessOffset).toBe(offset);
    expect(traumaSummary(t).consciousnessMax).toBe(max);
  });
  it('allows overflow fatal core damage and preserves death rather than healing it away', () => {
    for (const part of ['torso', 'head', 'neck'] as const) {
      const t = initialTrauma();
      applyInjury(t, 1, part, 'bruise', BODY_REGIONS[part].hitPoints + 3);
      if (part === 'torso') expect(t.wounds[0].severity).toBe(BODY_REGIONS[part].hitPoints + 3);
      else expect(t.missingParts[0].part).toBe(part);
      expect(traumaSummary(t).deathReason).toContain('致死');
      const before = structuredClone(t); days(t, 1);
      expect(t).toEqual(before);
      expect(tendOne(t, 1, 1, 10)).toBeNull();
    }
    const t = initialTrauma();t.bloodLoss = 1;
    expect(traumaSummary(t).deathReason).toBe('失血致死');
  });
  it('shares one natural budget across all injuries and distinguishes standing, lying and normal bed', () => {
    for (const [resting, inBed, daily] of [[false, false, 8], [false, true, 8],
      [true, false, 12], [true, true, 16]] as const) {
      const t = initialTrauma();
      applyInjury(t, 1, 'leftArm', 'bruise', 20);
      applyInjury(t, 2, 'rightArm', 'bruise', 20);
      days(t, 1, { resting, inBed });
      expect(total(t)).toBeCloseTo(40 - daily, 8);
      expect(t.wounds.every((w) => w.severity < 20)).toBe(true);
    }
  });
  it('uses an independent shared tended budget and pauses both healing budgets while starving', () => {
    const t = initialTrauma();
    applyInjury(t, 1, 'leftArm', 'bruise', 20)!.tendQuality = 0.5;
    applyInjury(t, 2, 'rightArm', 'bruise', 20)!.tendQuality = 0.5;
    const starved = structuredClone(t);
    days(t, 1);
    expect(total(t)).toBeCloseTo(40 - 8 - 8, 8);
    days(starved, 1, { starving: true, resting: true, inBed: true });
    expect(total(starved)).toBe(40);
    expect(starved.wounds[0].ageTicks).toBe(DAY);
  });
  it('tends one highest-bleeding wound per completion, with severity tie-break and no instant healing', () => {
    const t = initialTrauma();
    applyInjury(t, 1, 'leftArm', 'bruise', 20);
    applyInjury(t, 2, 'rightArm', 'cut', 10);
    applyInjury(t, 3, 'neck', 'cut', 3);
    const before = total(t), treated = tendOne(t, 1, 7, 200)!;
    expect(treated.id).toBe(3);
    expect(total(t)).toBe(before);
    expect(injuryBleedRate(treated)).toBe(0);
    expect(t.wounds.filter((w) => w.tendQuality !== null)).toHaveLength(1);
    expect(tendOne(t, 1, 7, 400)!.id).toBe(2);
    expect(tendOne(t, 1, 7, 600)!.id).toBe(1);
    expect(tendOne(t, 1, 7, 800)).toBeNull();
    const bruises = initialTrauma();
    applyInjury(bruises, 10, 'leftArm', 'bruise', 3);
    applyInjury(bruises, 11, 'rightArm', 'bruise', 8);
    expect(tendOne(bruises, 1, 1, 1)!.id).toBe(11);
  });
  it('keeps no-medicine quality in bounds, deterministic, and limited by actual doctor base', () => {
    for (let seed = 0; seed < 100; seed++) {
      const a = initialTrauma();applyInjury(a, 1, 'leftArm', 'cut', 5);
      const b = structuredClone(a);
      expect(tendOne(a, seed, 7, 200)).toEqual(tendOne(b, seed, 7, 200));
      expect(a.wounds[0].tendQuality).toBeGreaterThanOrEqual(0);
      expect(a.wounds[0].tendQuality).toBeLessThanOrEqual(0.475);
      const high = initialTrauma();applyInjury(high, 2, 'leftArm', 'cut', 5);
      expect(tendOne(high, seed, 7, 200, 10)!.tendQuality).toBeLessThanOrEqual(0.7);
    }
  });
  it('preserves permanently broken paired-limb function after injuries fully heal', () => {
    const t = initialTrauma();
    applyInjury(t, 1, 'leftLeg', 'bruise', 35);
    expect(traumaSummary(t).movingFactor).toBe(0.5);
    expect(traumaSummary(t).deathReason).toBeNull();
    tendOne(t, 1, 7, 0);
    days(t, 5, { resting: true, inBed: true });
    expect(t.wounds).toEqual([]);
    expect(t.missingParts.map(m => m.part)).toEqual(['leftLeg']);
    expect(traumaSummary(t).movingFactor).toBe(0.5);
    applyInjury(t, 2, 'rightLeg', 'bruise', 30);
    applyInjury(t, 3, 'leftArm', 'bruise', 30);
    expect(traumaSummary(t).movingFactor).toBe(0);
    expect(traumaSummary(t).manipulationFactor).toBe(0.5);
    expect(validTrauma(t, DAY * 5)).toBe(true);
  });
  it('continues healing and keyed tending identically after JSON save/read', () => {
    const a = initialTrauma();
    applyInjury(a, 1, 'leftArm', 'cut', 15);
    applyInjury(a, 2, 'rightLeg', 'bruise', 20);
    tendOne(a, 19, 7, 100);
    days(a, 0.5, { seed: 19 });
    const b: Trauma = JSON.parse(JSON.stringify(a));
    expect(validTrauma(b, DAY / 2)).toBe(true);
    tendOne(a, 19, 7, DAY / 2); tendOne(b, 19, 7, DAY / 2);
    days(a, 1, { seed: 19 }, DAY / 2 + 1);days(b, 1, { seed: 19 }, DAY / 2 + 1);
    expect(b).toEqual(a);
  });
  it('rejects malformed, duplicate, nonfinite and contradictory persisted injury states', () => {
    const t = initialTrauma();applyInjury(t, 1, 'leftArm', 'cut', 5);
    expect(validTrauma(t, 0)).toBe(true);
    const invalid: unknown[] = [null, [], { ...t, extra: true }, { ...t, bloodLoss: NaN },
      { ...t, bloodLoss: -1 }, { ...t, bloodLoss: 1.1 }, { ...t, brokenParts: ['brain'] },
      { ...t, brokenParts: ['leftArm', 'leftArm'] }, { ...t, wounds: [...t.wounds, ...t.wounds] }];
    for (const field of [{ id: -1 }, { part: 'not-a-body-part' }, { kind: 'fire' }, { severity: Infinity },
      { severity: 0 }, { severity: 30 }, { ageTicks: -1 }, { ageTicks: 11 },
      { tendQuality: NaN }, { tendQuality: -0.1 }, { tendQuality: 0.71 }, { extra: true }])
      invalid.push({ ...t, wounds: [{ ...t.wounds[0], ...field }] });
    for (const value of invalid) expect(validTrauma(value, 10)).toBe(false);
    expect(validTrauma(t, -1)).toBe(false);
    expect(() => applyInjury(t, 1, 'head', 'bruise', 5)).toThrow();
    expect(() => applyInjury(t, 2, 'head', 'bruise', Infinity)).toThrow();
    expect(() => tendOne(t, 1, 1, 1, NaN)).toThrow();
  });
});
