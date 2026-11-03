import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BODY_PART_LIST,
  BODY_PARTS,
  bodyFunctions,
  chooseHitPart,
  damageHitWeight,
  isPartMissing,
  partEfficiency,
  partHealth,
  roundedCapacity,
  type BodyPartId,
} from '../src/voxel/anatomy';
import {
  advanceTrauma,
  applyBodyDamage,
  applyInjury,
  initialTrauma,
  injuryBleedRate,
  injuryKindForDamagePart,
  isFreshStump,
  migrateLegacyTrauma,
  needsTending,
  STUMP_FRESH_TICKS,
  tendOne,
  traumaIds,
  traumaSummary,
  validLegacyTrauma,
  validTrauma,
  type LegacyTrauma,
  type Trauma,
} from '../src/voxel/injuries';
import { healthDeathReason, healthSummary, legacyHealthState } from '../src/voxel/survival';
import { meleeBodyFromTrauma } from '../src/voxel/weapons';
import { DAY, type SurvivalHealth } from '../src/voxel/types';

const health: SurvivalHealth = {
  malnutrition: 0,
  hypothermia: 0,
  heatstroke: 0,
  starvationFactor: 1,
};
const summary = (trauma: Trauma, h = health) =>
  healthSummary({ health: h, trauma, dead: false, deathReason: null });
const context = { seed: 17, pawnId: 2, starving: false, resting: true, inBed: true };
const lose = (t: Trauma, part: BodyPartId, id = 1) =>
  applyInjury(t, id, part, 'cut', BODY_PARTS[part].hitPoints + 1);
const rolls = (...values: number[]) => {
  let index = 0;
  return () => values[index++] ?? 0.99;
};
const midpoint = (parts: readonly BodyPartId[], target: BodyPartId) => {
  const weights = parts.map((p) => damageHitWeight(p, 'Stab')),
    index = parts.indexOf(target);
  return (
    (weights.slice(0, index).reduce((a, b) => a + b, 0) + weights[index] / 2) /
    weights.reduce((a, b) => a + b, 0)
  );
};

describe('native human anatomy and capacity dependencies', () => {
  it('matches the independent local XML evidence for every stable part and weighted outside record', () => {
    const evidence = JSON.parse(
      readFileSync('docs/research/rimworld/evidence/anatomy-human.json', 'utf8'),
    );
    expect(BODY_PART_LIST).toHaveLength(64);
    expect(new Set(BODY_PART_LIST.map((p) => p.id)).size).toBe(64);
    const camel = (id: string | null) =>
      id?.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) ?? null;
    for (const native of evidence.nodes) {
      const p = BODY_PARTS[camel(native.id) as BodyPartId];
      expect({
        parent: p.parent,
        hp: p.hitPoints,
        weight: p.weight,
        skin: p.skinCovered,
        solid: p.solid,
        tags: p.tags,
      }).toEqual({
        parent: camel(native.parentId),
        hp: native.hitPoints,
        weight: native.coverageAbs,
        skin: native.skinCovered,
        solid: native.solid,
        tags: native.tags,
      });
      for (const child of p.children) expect(BODY_PARTS[child].parent).toBe(p.id);
    }
    expect(BODY_PART_LIST.reduce((n, p) => n + p.weight, 0)).toBeCloseTo(1, 12);
    const outside = BODY_PART_LIST.filter((p) => p.depth === 'Outside' && p.weight > 0);
    expect(outside).toHaveLength(39);
    expect(outside.reduce((n, p) => n + p.weight, 0)).toBeCloseTo(0.619631, 12);
  });
  it('uses actual coverage and damage-specific eye exclusions without selecting missing descendants', () => {
    const t = initialTrauma();
    lose(t, 'leftArm');
    expect(damageHitWeight('leftEye', 'Blunt')).toBe(0);
    expect(damageHitWeight('leftEye', 'Cut')).toBeGreaterThan(0);
    for (let i = 0; i < 2000; i++) {
      const p = chooseHitPart(t, 'Blunt', (i + 0.5) / 2000)!;
      expect(BODY_PARTS[p].depth).toBe('Outside');
      expect(isPartMissing(t, p)).toBe(false);
      expect(['leftEye', 'rightEye']).not.toContain(p);
    }
    expect(() => chooseHitPart(t, 'Cut', 1)).toThrow();
    expect(() => chooseHitPart(t, 'Cut', NaN)).toThrow();
  });
  it('retains native integer part HP, non-destructible bone floor and outside 10%-100% efficiency', () => {
    const t = initialTrauma();
    applyInjury(t, 1, 'leftArm', 'bruise', 15);
    expect(partHealth(t, 'leftArm')).toBe(15);
    expect(partEfficiency(t, 'leftArm')).toBeCloseTo(4 / 9);
    expect(partEfficiency(t, 'leftHand')).toBe(1);
    applyInjury(t, 2, 'ribcage', 'crack', 31);
    expect(partHealth(t, 'ribcage')).toBe(1);
    expect(isPartMissing(t, 'ribcage')).toBe(false);
    expect(roundedCapacity(0.125)).toBe(0.12);
    expect(roundedCapacity(0.135)).toBe(0.14);
  });
  it('multiplies all connected shoulder, bone and hand segments before averaging limbs', () => {
    const t = initialTrauma();
    (
      ['leftShoulder', 'leftClavicle', 'leftArm', 'leftHumerus', 'leftRadius', 'leftHand'] as const
    ).forEach((part, index) =>
      applyInjury(t, index + 1, part, 'bruise', [3, 5, 6, 5, 4, 4][index]),
    );
    const left = (8 / 9) * 0.8 * (7 / 9) * 0.8 * 0.8 * (7 / 9);
    expect(bodyFunctions(t).manipulationFactor).toBeCloseTo((left + 1) / 2);
    expect(summary(t).capacityReasons.manipulation.join(' ')).toContain('锁骨');
    expect(summary(t).capacityReasons.manipulation.join(' ')).toContain('桡骨');
  });
  it('weights individual digits by 80% for hands and 40% for feet', () => {
    const hand = initialTrauma();
    lose(hand, 'leftPinky');
    expect(bodyFunctions(hand).manipulationFactor).toBeCloseTo(0.92);
    const foot = initialTrauma();
    lose(foot, 'leftLittleToe');
    expect(bodyFunctions(foot).movingFactor).toBeCloseTo(0.96);
    expect(bodyFunctions(hand).movingFactor).toBe(1);
  });
  it('uses pelvis and spine plus organ and consciousness dependencies for moving', () => {
    const t = initialTrauma();
    applyInjury(t, 1, 'pelvis', 'crack', 5);
    applyInjury(t, 2, 'spine', 'crack', 5);
    expect(bodyFunctions(t).movingFactor).toBeCloseTo(0.8 * 0.8);
    lose(t, 'leftLung', 3);
    expect(bodyFunctions(t).breathing).toBe(0.5);
    expect(bodyFunctions(t).movingFactor).toBeCloseTo(0.8 * 0.8 * 0.9);
    expect(summary(t).moving).toBe(roundedCapacity(0.8 * 0.8 * 0.9 * summary(t).consciousness));
  });
  it('weights the better eye and ear at 75% and keeps sight independent of wakefulness', () => {
    const injuredEye = initialTrauma();
    applyInjury(injuredEye, 1, 'leftEye', 'cut', 5);
    expect(partHealth(injuredEye, 'leftEye')).toBe(5);
    expect(summary(injuredEye).sight).toBe(0.86);
    const t = initialTrauma();
    lose(t, 'leftEye');
    tendOne(t, 1, 2, 0);
    lose(t, 'leftEar', 2);
    tendOne(t, 1, 2, 0);
    expect(summary(t).sight).toBe(0.75);
    expect(summary(t).hearing).toBe(0.75);
    t.bloodLoss = 0.6;
    expect(summary(t).consciousness).toBe(0.1);
    expect(summary(t).moving).toBe(0);
    expect(summary(t).manipulation).toBe(0);
    expect(summary(t).sight).toBe(0.75);
    expect(summary(t).eating).toBe(0);
    expect(summary(t).talking).toBe(0);
  });
  it('models kidney/liver, lungs/cage/neck, heart and brain dependencies and lethal zero capacities', () => {
    const lung = initialTrauma();
    lose(lung, 'leftLung');
    expect(summary(lung).breathing).toBe(0.5);
    expect(summary(lung).consciousness).toBe(0.9);
    expect(summary(lung).moving).toBe(0.81);
    const kidney = initialTrauma();
    lose(kidney, 'leftKidney');
    expect(summary(kidney).bloodFiltration).toBe(0.5);
    expect(summary(kidney).consciousness).toBe(0.95);
    for (const part of ['heart', 'brain', 'liver', 'head', 'neck'] as const) {
      const t = initialTrauma();
      lose(t, part);
      expect(healthDeathReason(health, t)).toContain('致死');
    }
    lose(lung, 'rightLung', 2);
    expect(healthDeathReason(health, lung)).toBe('呼吸停止致死');
    lose(kidney, 'rightKidney', 2);
    expect(healthDeathReason(health, kidney)).toBe('血液过滤功能丧失致死');
  });
  it('includes metabolism, jaw and tongue with the native eating minimum', () => {
    const t = initialTrauma();
    lose(t, 'stomach');
    expect(summary(t).metabolism).toBe(0.5);
    expect(healthDeathReason(health, t)).toBeNull();
    lose(t, 'tongue', 2);
    expect(summary(t).talking).toBe(0);
    expect(summary(t).eating).toBe(0.5);
    lose(t, 'jaw', 3);
    expect(summary(t).eating).toBe(0.1);
    expect(summary(t).talking).toBe(0);
  });
  it('maps natural melee tools to native groups rather than coarse arm/head proxies', () => {
    const t = initialTrauma();
    applyInjury(t, 1, 'leftArm', 'bruise', 15);
    expect(meleeBodyFromTrauma(t).leftHand).toBe(1);
    applyInjury(t, 2, 'leftPinky', 'bruise', 4);
    expect(meleeBodyFromTrauma(t).leftHand).toBeCloseTo((4 + 4 / 9) / 5);
    lose(t, 'jaw', 3);
    expect(meleeBodyFromTrauma(t).teeth).toBe(0);
    expect(meleeBodyFromTrauma(t).head).toBe(1);
  });
});

describe('permanent losses, treatment and strict v15 migration', () => {
  it('replaces a destroyed subtree by one fresh root and never regenerates descendants', () => {
    const t = initialTrauma();
    applyInjury(t, 1, 'leftArm', 'cut', 2);
    lose(t, 'leftPinky', 2);
    lose(t, 'leftShoulder', 3);
    expect(t.wounds).toEqual([]);
    expect(t.missingParts.map((m) => m.part)).toEqual(['leftShoulder']);
    expect(isPartMissing(t, 'leftThumb')).toBe(true);
    expect(partHealth(t, 'leftHand')).toBe(0);
    expect(applyInjury(t, 4, 'leftHand', 'cut', 1)).toBeNull();
    expect(traumaSummary(t).bleedRate).toBeCloseTo(3.6);
    expect(traumaSummary(t).pain).toBeCloseTo(0.375);
    expect(needsTending(t)).toBe(true);
    tendOne(t, 1, 2, 0, 0);
    expect(traumaSummary(t).bleedRate).toBe(0);
    expect(traumaSummary(t).pain).toBe(0);
    for (let tick = 1; tick <= DAY * 2; tick++) advanceTrauma(t, tick, context);
    expect(t.missingParts).toHaveLength(1);
    expect(bodyFunctions(t).manipulationFactor).toBe(0.5);
    expect(needsTending(t)).toBe(false);
    expect(validTrauma(t, DAY * 2)).toBe(true);
  });
  it('only fresh nonsolid outside roots bleed, and freshness expires at 1.5 days', () => {
    const t = initialTrauma();
    lose(t, 'leftPinky');
    const m = t.missingParts[0];
    m.ageTicks = STUMP_FRESH_TICKS - 1;
    expect(isFreshStump(m)).toBe(true);
    advanceTrauma(t, STUMP_FRESH_TICKS, { ...context, starving: true });
    expect(m.isFresh).toBe(false);
    expect(injuryBleedRate(m)).toBe(0);
    for (const part of ['nose', 'leftKidney'] as const) {
      const other = initialTrauma();
      lose(other, part);
      expect(traumaSummary(other).bleedRate).toBe(0);
      expect(needsTending(other)).toBe(false);
    }
  });
  it('uses crack and crush pain/bleeding with part-specific physical damage selection', () => {
    expect(injuryKindForDamagePart('Blunt', 'torso')).toBe('bruise');
    expect(injuryKindForDamagePart('Blunt', 'leftLung')).toBe('crush');
    for (const damage of ['Blunt', 'Poke', 'Cut', 'Stab', 'Bite'] as const)
      expect(injuryKindForDamagePart(damage, 'nose')).toBe('crack');
    const t = initialTrauma(),
      crush = applyInjury(t, 1, 'leftLung', 'crush', 2)!,
      crack = applyInjury(t, 2, 'ribcage', 'crack', 2)!;
    expect(injuryBleedRate(crush)).toBeCloseTo(2 * 0.01 * BODY_PARTS.leftLung.bleedRate);
    expect(injuryBleedRate(crack)).toBe(0);
    expect(traumaSummary(t).pain).toBeCloseTo(2 * 0.0125 + 2 * 0.01);
  });
  it('archives original irreversible loss records with IDs/age/quality and adds no bleeding', () => {
    const legacy: LegacyTrauma = {
      wounds: [
        { id: 7, part: 'leftArm', kind: 'cut', severity: 32.25, ageTicks: 123, tendQuality: 0.2 },
        {
          id: 8,
          part: 'rightLeg',
          kind: 'bruise',
          severity: 3.75,
          ageTicks: 15,
          tendQuality: null,
        },
      ],
      bloodLoss: 0.2,
      brokenParts: ['leftArm'],
    };
    const t = migrateLegacyTrauma(legacy, 123, () => 9);
    expect(t.missingParts[0].legacyWounds).toEqual([legacy.wounds[0]]);
    expect(t.wounds).toEqual([legacy.wounds[1]]);
    expect(traumaIds(t).sort()).toEqual([7, 8, 9]);
    expect(t.missingParts[0].isFresh).toBe(false);
    expect(traumaSummary(t).bleedRate).toBe(0);
    expect(legacy.brokenParts).toEqual(['leftArm']);
    expect(validTrauma(t, 123)).toBe(true);
  });
  it('does not amputate old reversible wounds merely because integer native HP rounds to zero', () => {
    const legacy: LegacyTrauma = {
      wounds: [
        { id: 1, part: 'leftArm', kind: 'bruise', severity: 29.8, ageTicks: 0, tendQuality: null },
      ],
      bloodLoss: 0,
      brokenParts: [],
    };
    const old = legacyHealthState(health, legacy);
    expect(old.manipulation).toBeGreaterThan(0);
    expect(old.dead).toBe(false);
    const t = migrateLegacyTrauma(legacy, 0, () => {
      throw Error('must not allocate');
    });
    expect(t.missingParts).toEqual([]);
    expect(partHealth(t, 'leftArm')).toBe(0);
    expect(validTrauma(t, 0)).toBe(true);
    for (let tick = 1; tick <= 600; tick++) advanceTrauma(t, tick, context);
    expect(partHealth(t, 'leftArm')).toBeGreaterThan(0);
    expect(t.missingParts).toEqual([]);
  });
  it('rejects impossible trees, IDs, archive records, times and foreign versions before conversion', () => {
    const t = initialTrauma();
    lose(t, 'leftArm');
    const missing = t.missingParts[0];
    const invalid = [
      { ...t, unknown: true },
      { ...t, missingParts: [{ ...missing, isFresh: 'yes' }] },
      { ...t, missingParts: [{ ...missing, ageTicks: STUMP_FRESH_TICKS, isFresh: true }] },
      { ...t, missingParts: [{ ...missing, tendQuality: 0 }] },
      { ...t, missingParts: [missing, { ...missing, id: 2, part: 'leftHand' }] },
      {
        ...t,
        missingParts: [
          {
            ...missing,
            legacyWounds: [
              { id: 2, part: 'rightArm', kind: 'cut', severity: 3, ageTicks: 0, tendQuality: null },
            ],
          },
        ],
      },
      {
        ...t,
        wounds: [
          { id: 2, part: 'leftHand', kind: 'cut', severity: 3, ageTicks: 0, tendQuality: null },
        ],
      },
    ];
    for (const value of invalid) expect(validTrauma(value, STUMP_FRESH_TICKS)).toBe(false);
    expect(validLegacyTrauma(t, 0)).toBe(false);
    expect(() => migrateLegacyTrauma(t, 0, () => 3)).toThrow();
    expect(() =>
      migrateLegacyTrauma({ wounds: [], bloodLoss: 0, brokenParts: ['brain'] }, 0, () => 3),
    ).toThrow();
  });
  it('continues wounds, fresh losses and keyed treatment identically after JSON restore', () => {
    const a = initialTrauma();
    lose(a, 'leftPinky');
    applyInjury(a, 2, 'rightLeg', 'cut', 5);
    for (let tick = 1; tick <= 240; tick++) advanceTrauma(a, tick, context);
    const b: Trauma = JSON.parse(JSON.stringify(a));
    expect(validTrauma(b, 240)).toBe(true);
    expect(tendOne(a, 17, 2, 240)).toEqual(tendOne(b, 17, 2, 240));
    for (let tick = 241; tick <= 1200; tick++) {
      advanceTrauma(a, tick, context);
      advanceTrauma(b, tick, context);
    }
    expect(b).toEqual(a);
    expect(summary(b)).toEqual(summary(a));
  });
});

describe('ordinary melee damage worker propagation', () => {
  it('forces Stab and Poke into a direct internal child, then applies 40% inside and 75% outside', () => {
    const children = BODY_PARTS.torso.children.filter((p) => BODY_PARTS[p].depth === 'Inside');
    for (const damage of ['Stab', 'Poke'] as const) {
      const t = initialTrauma();
      let id = 1;
      const r = applyBodyDamage(t, damage, 'torso', 10, {
        random: rolls(0, midpoint(children, 'leftLung')),
        allocId: () => id++,
      });
      expect(r.hits.map((w) => [w.part, w.severity])).toEqual([
        ['leftLung', 4],
        ['torso', 7.5],
      ]);
      expect(r.hits[0].kind).toBe(damage === 'Stab' ? 'stab' : 'crush');
      expect(r.hits[1].kind).toBe(damage === 'Stab' ? 'stab' : 'bruise');
      expect(validTrauma(t, 0)).toBe(true);
    }
  });
  it('preserves 1 HP on failed outside severing rolls while cleave shares bonus damage across adjacent targets', () => {
    const t = initialTrauma();
    let id = 1;
    const protectedHit = applyBodyDamage(t, 'Cut', 'leftHand', 20, {
      random: rolls(0, 0, 0.9),
      allocId: () => id++,
    });
    expect(protectedHit.hits[0].severity).toBe(19);
    expect(partHealth(t, 'leftHand')).toBe(1);
    expect(isPartMissing(t, 'leftHand')).toBe(false);
    const cleave = initialTrauma();
    const r = applyBodyDamage(cleave, 'Cut', 'leftArm', 10, {
      random: rolls(0.8, 0.2, 0, 0.1, 0.2, 0.3, 0.4),
      allocId: () => id++,
    });
    expect(r.hits.map((w) => w.part)).toEqual(['leftHumerus', 'leftRadius', 'leftArm']);
    expect(r.hits.every((w) => Math.abs(w.severity - (10 * 2.4) / 4.4) < 1e-9)).toBe(true);
  });
  it('propagates Blunt overkill up the missing branch and converts selected damage into an internal bone', () => {
    const t = initialTrauma();
    let id = 1;
    const r = applyBodyDamage(t, 'Blunt', 'leftPinky', 20, {
      random: rolls(0.9),
      allocId: () => id++,
    });
    expect(r.hits.map((w) => [w.part, w.severity])).toEqual([
      ['leftPinky', 20],
      ['leftHand', 12],
    ]);
    expect(r.totalDamage).toBe(20);
    expect(t.missingParts[0].part).toBe('leftPinky');
    const internal = initialTrauma();
    const hit = applyBodyDamage(internal, 'Blunt', 'torso', 10, {
      random: rolls(0, 0, 0, 0),
      allocId: () => id++,
    });
    expect(hit.hits.map((w) => [w.part, w.kind, w.severity])).toEqual([
      ['torso', 'bruise', 9],
      ['ribcage', 'crack', 3],
    ]);
  });
  it('does not partly mutate state or allocate IDs for invalid random input or nonexistent targets', () => {
    const t = initialTrauma(),
      before = structuredClone(t);
    let allocated = 0;
    expect(() =>
      applyBodyDamage(t, 'Blunt', 'torso', 10, {
        random: rolls(0, 0, NaN),
        allocId: () => ++allocated,
      }),
    ).toThrow();
    expect(t).toEqual(before);
    expect(allocated).toBe(0);
    lose(t, 'leftArm', 5);
    const lost = structuredClone(t);
    expect(
      applyBodyDamage(t, 'Cut', 'leftHand', 5, { random: () => 0, allocId: () => ++allocated })
        .hits,
    ).toEqual([]);
    expect(t).toEqual(lost);
    expect(allocated).toBe(0);
    const good = initialTrauma();
    expect(() =>
      applyBodyDamage(good, 'Stab', 'leftArm', 5, { random: rolls(0.9), allocId: () => NaN }),
    ).toThrow();
    expect(good).toEqual(initialTrauma());
  });
  it('keeps Bite as one protected outside injury and conserves IDs when protection reduces damage to zero', () => {
    const t = initialTrauma();
    let id = 1;
    const result = applyBodyDamage(t, 'Bite', 'leftHand', 20, {
      random: () => 0.99,
      allocId: () => id++,
    });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].kind).toBe('bite');
    expect(partHealth(t, 'leftHand')).toBe(1);
    const before = structuredClone(t),
      next = id;
    expect(
      applyBodyDamage(t, 'Bite', 'leftHand', 1, { random: () => 0.99, allocId: () => id++ }).hits,
    ).toEqual([]);
    expect(id).toBe(next);
    expect(t).toEqual(before);
  });
});
