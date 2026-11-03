import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  APPAREL_DEFS,
  APPAREL_KINDS,
  ARMOR_KINDS,
  TAILOR_KINDS,
  apparelCoversPart,
  apparelHasPartsToWear,
  apparelMoveFactor,
  apparelStats,
  compatibleApparel,
  makeApparel,
  sortApparelByLayer,
  validApparel,
} from '../src/voxel/apparel';
import { resolveArmor, type ArmorInput } from '../src/voxel/armor';
import { BODY_PARTS, BODY_PART_LIST, damageHitWeight, type BodyPartId } from '../src/voxel/anatomy';
import { applyBodyDamage, applyInjury, initialTrauma, validTrauma } from '../src/voxel/injuries';
import type { ApparelQuality } from '../src/voxel/types';

const rolls = (...values: number[]) => {
  let index = 0;
  return vi.fn(() => values[index++] ?? 0.99);
};
const input = (changes: Partial<ArmorInput> = {}): ArmorInput => ({
  worn: [makeApparel(1, 'plateArmor')],
  part: 'torso',
  damageDef: 'Cut',
  amount: 10,
  armorPenetration: 0,
  ...changes,
});
const midpoint = (parts: readonly BodyPartId[], target: BodyPartId) => {
  const weights = parts.map((p) => damageHitWeight(p, 'Stab')),
    index = parts.indexOf(target);
  return (
    (weights.slice(0, index).reduce((a, b) => a + b, 0) + weights[index] / 2) /
    weights.reduce((a, b) => a + b, 0)
  );
};

describe('native steel and cloth apparel definitions', () => {
  it('matches separately extracted source declarations and complete Human coverage', () => {
    const evidence = JSON.parse(
      readFileSync('docs/research/rimworld/evidence/armor-data.json', 'utf8'),
    );
    const nativeNames = {
      tuque: 'Apparel_Tuque',
      parka: 'Apparel_Parka',
      duster: 'Apparel_Duster',
      shirt: 'Apparel_BasicShirt',
      pants: 'Apparel_Pants',
      simpleHelmet: 'Apparel_SimpleHelmet',
      plateArmor: 'Apparel_PlateArmor',
    };
    const camel = (part: string) => part.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const kind of APPAREL_KINDS) {
      const native = evidence.garments.find((g: { id: string }) => g.id === nativeNames[kind]);
      const material = evidence.materials.find(
        (m: { id: string }) =>
          m.id === (APPAREL_DEFS[kind].material === 'steel' ? 'Steel' : 'Cloth'),
      );
      const piece = makeApparel(1, kind),
        stats = apparelStats(piece),
        def = APPAREL_DEFS[kind];
      expect(def.cost).toEqual({ [def.material]: native.cost });
      expect(def.sourceWork).toBe(native.work);
      expect(def.sourceResearch).toBe(native.research);
      expect(def.sourceCraftingLevel).toBe(native.craftingMin ?? 0);
      expect(def.maxHitPoints).toBe(native.maxHP * material.hpFactor);
      expect(def.equipDelay).toBe(native.equipDelay);
      expect(def.layers).toEqual(native.layers);
      expect(def.bodyParts).toEqual(native.groups);
      expect(stats.moveSpeedOffset).toBe(native.moveOffset);
      expect(stats.cold).toBeCloseTo(native.coldMultiplier * material.cold);
      expect(stats.heat).toBeCloseTo(native.heatMultiplier * material.heat);
      for (const [index, stat] of (['armorSharp', 'armorBlunt', 'armorHeat'] as const).entries())
        expect(stats[stat]).toBeCloseTo(
          native.armorBase[index] + material.armor[index] * native.armorMultiplier,
        );
      expect(BODY_PART_LIST.filter((p) => apparelCoversPart(piece, p.id)).map((p) => p.id)).toEqual(
        native.coveredParts.map(camel),
      );
    }
  });
  it('separates tailor/smithy recipes and preserves original work, costs and requirements', () => {
    expect(APPAREL_KINDS).toHaveLength(7);
    expect(TAILOR_KINDS).toEqual(['tuque', 'parka', 'duster', 'shirt', 'pants']);
    expect(ARMOR_KINDS).toEqual(['simpleHelmet', 'plateArmor']);
    expect(APPAREL_DEFS.simpleHelmet).toMatchObject({
      cost: { steel: 40 },
      sourceWork: 3200,
      work: 1067,
      sourceResearch: 'Smithing',
      sourceCraftingLevel: 0,
      maxHitPoints: 100,
      equipDelay: 1.5,
    });
    expect(APPAREL_DEFS.plateArmor).toMatchObject({
      cost: { steel: 170 },
      sourceWork: 38000,
      work: 12667,
      sourceResearch: 'PlateArmor',
      sourceCraftingLevel: 7,
      maxHitPoints: 290,
      equipDelay: 15,
      layers: ['Middle', 'Shell'],
      moveSpeedOffset: -0.8,
    });
    expect(APPAREL_DEFS.parka.sourceResearch).toBeNull();
    expect(APPAREL_DEFS.tuque.work).toBe(800);
    expect(APPAREL_DEFS.duster.work).toBe(Math.ceil(10000 / 3 / 0.5));
  });
  it('uses armor-specific quality factors and never scales rating or max HP by current HP', () => {
    const factors = [0.6, 0.8, 1, 1.15, 1.3, 1.45, 1.8];
    for (let q = 0; q < factors.length; q++) {
      for (const [kind, sharp, blunt, heat, hp] of [
        ['simpleHelmet', 0.45, 0.225, 0.3, 100],
        ['plateArmor', 0.81, 0.405, 0.54, 290],
        ['shirt', 0.072, 0, 0.036, 100],
        ['duster', 0.108, 0, 0.054, 200],
      ] as const) {
        const piece = makeApparel(1, kind, q as ApparelQuality),
          full = apparelStats(piece);
        expect(full.armorSharp).toBeCloseTo(sharp * factors[q]);
        expect(full.armorBlunt).toBeCloseTo(blunt * factors[q]);
        expect(full.armorHeat).toBeCloseTo(heat * factors[q]);
        expect(full.maxHitPoints).toBe(hp);
        piece.hitPoints = 1;
        expect(apparelStats(piece)).toEqual(full);
        expect(validApparel(piece)).toBe(true);
      }
    }
    expect(apparelStats(makeApparel(1, 'plateArmor', 6)).cold).toBeCloseTo(5.4);
  });
  it('checks material, six-field identity and positive surviving HP strictly', () => {
    for (const kind of APPAREL_KINDS) {
      const piece = makeApparel(1, kind);
      expect(validApparel(piece)).toBe(true);
      expect(
        validApparel({ ...piece, material: piece.material === 'cloth' ? 'steel' : 'cloth' }),
      ).toBe(false);
      for (const hp of [0, -1, Infinity, NaN, 0.5, piece.hitPoints + 1])
        expect(validApparel({ ...piece, hitPoints: hp })).toBe(false);
      expect(validApparel({ ...piece, cachedArmor: 1 })).toBe(false);
      expect(validApparel({ ...piece, quality: 7 })).toBe(false);
    }
  });
  it('covers actual groups, including internal organs, without extending to hands, feet or face', () => {
    const plate = makeApparel(1, 'plateArmor'),
      helmet = makeApparel(2, 'simpleHelmet');
    for (const part of [
      'torso',
      'leftLung',
      'heart',
      'leftArm',
      'leftHumerus',
      'leftLeg',
      'neck',
    ] as const)
      expect(apparelCoversPart(plate, part), part).toBe(true);
    for (const part of ['head', 'leftHand', 'leftFoot', 'nose', 'leftEye'] as const)
      expect(apparelCoversPart(plate, part), part).toBe(false);
    expect(apparelCoversPart(helmet, 'head')).toBe(true);
    expect(apparelCoversPart(helmet, 'brain')).toBe(true);
    expect(apparelCoversPart(helmet, 'leftEye')).toBe(false);
    const t = initialTrauma();
    expect(apparelHasPartsToWear(makeApparel(3, 'pants'), t)).toBe(true);
    applyInjury(t, 1, 'leftLeg', 'cut', 40);
    expect(apparelHasPartsToWear(makeApparel(3, 'pants'), t)).toBe(true);
    applyInjury(t, 2, 'rightLeg', 'cut', 40);
    expect(apparelHasPartsToWear(makeApparel(3, 'pants'), t)).toBe(false);
  });
  it('uses all occupied layers for conflicts and sorts by the last native layer', () => {
    const plate = makeApparel(1, 'plateArmor'),
      helmet = makeApparel(2, 'simpleHelmet'),
      shirt = makeApparel(3, 'shirt'),
      pants = makeApparel(4, 'pants');
    expect(compatibleApparel(plate, makeApparel(5, 'parka'))).toBe(false);
    expect(compatibleApparel(plate, makeApparel(5, 'duster'))).toBe(false);
    expect(compatibleApparel(helmet, makeApparel(5, 'tuque'))).toBe(false);
    expect(compatibleApparel(plate, shirt)).toBe(true);
    expect(compatibleApparel(plate, pants)).toBe(true);
    expect(compatibleApparel(shirt, pants)).toBe(true);
    const worn = [helmet, plate, shirt, pants];
    expect(sortApparelByLayer(worn).map((p) => p.id)).toEqual([3, 4, 1, 2]);
    expect(worn.map((p) => p.id)).toEqual([2, 1, 3, 4]);
  });
  it('applies equipped movement offset before Moving and the native minimum, relative to grid speed', () => {
    const worn = [makeApparel(1, 'plateArmor'), makeApparel(2, 'simpleHelmet')];
    expect(apparelMoveFactor([], 1)).toBe(1);
    expect(apparelMoveFactor(worn, 1)).toBeCloseTo(3.8 / 4.6);
    expect(apparelMoveFactor(worn, 0.5)).toBeCloseTo(1.9 / 4.6);
    expect(apparelMoveFactor(worn, 0)).toBeCloseTo(0.15 / 4.6);
    expect(() => apparelMoveFactor(worn, NaN)).toThrow();
  });
});

describe('ArmorUtility ordered impact rules', () => {
  it.each([
    [0.404999, 'deflect', 0, 'Cut'],
    [0.405, 'diminish', 5, 'Blunt'],
    [0.809999, 'diminish', 5, 'Blunt'],
    [0.81, 'penetrate', 10, 'Cut'],
  ] as const)('uses strict threshold at armor roll %s', (roll, outcome, amount, def) => {
    const r = resolveArmor(input(), rolls(0.9, roll, 0.9, 0.9));
    expect(r.steps[0].outcome).toBe(outcome);
    expect(r.amount).toBe(amount);
    expect(r.damageDef).toBe(def);
    expect(r.worn[0].hitPoints).toBe(288);
    expect(r.deflected).toBe(amount === 0);
    expect(r.deflectedByMetalArmor).toBe(amount === 0);
    expect(r.diminishedByMetalArmor).toBe(amount === 5);
  });
  it('subtracts penetration but still damages apparel and samples zero-rating layers', () => {
    const rand = rolls(0, 0, 0);
    const r = resolveArmor(input({ armorPenetration: 10 }), rand);
    expect(r.amount).toBe(10);
    expect(r.steps.map((s) => s.effectiveArmor)).toEqual([0, 0]);
    expect(r.worn[0].hitPoints).toBe(287);
    expect(rand).toHaveBeenCalledTimes(3);
    const cloth = resolveArmor(
      input({ worn: [makeApparel(2, 'shirt')], damageDef: 'Blunt' }),
      rolls(0, 0, 0),
    );
    expect(cloth.amount).toBe(10);
    expect(cloth.worn[0].hitPoints).toBe(97);
  });
  it('uses ordered apparel, one check for multilayer plate, and cached original Sharp stat after conversion', () => {
    const plate = makeApparel(1, 'plateArmor'),
      shirt = makeApparel(2, 'shirt');
    const rand = rolls(0.9, 0.6, 0.9, 0.9, 0.04, 0, 0.9);
    const r = resolveArmor(input({ worn: [plate, shirt], armorPenetration: 0.02 }), rand);
    expect(r.steps.map((s) => s.apparelId)).toEqual([1, 2, null]);
    expect(r.steps.map((s) => s.armorCategory)).toEqual(['Sharp', 'Sharp', 'Sharp']);
    expect(r.steps[1]).toMatchObject({
      armorRating: 0.072,
      armorPenetration: 0.02,
      beforeDamageDef: 'Blunt',
      beforeAmount: 5,
      afterAmount: 3,
      hitPointDamage: 1,
      outcome: 'diminish',
    });
    expect(r.amount).toBe(3);
    expect(r.damageDef).toBe('Blunt');
    expect(rand).toHaveBeenCalledTimes(7);
    expect([plate.hitPoints, shirt.hitPoints]).toEqual([290, 100]);
    expect(r.worn.map((p) => p.id)).toEqual([2, 1]);
  });
  it('uses pre-impact rating when the garment is destroyed, then removes it from later hits', () => {
    const plate = makeApparel(1, 'plateArmor');
    plate.hitPoints = 1;
    const r = resolveArmor(input({ worn: [plate] }), rolls(0.9, 0));
    expect(r.amount).toBe(0);
    expect(r.steps[0]).toMatchObject({
      armorRating: 0.81,
      hitPointsBefore: 1,
      hitPointsAfter: 0,
      hitPointDamage: 1,
    });
    expect(r.worn).toEqual([]);
    expect(r.destroyedIds).toEqual([1]);
    expect(plate.hitPoints).toBe(1);
    const next = resolveArmor(input({ worn: r.worn }), rolls(0));
    expect(next.amount).toBe(10);
    expect(next.steps).toHaveLength(1);
  });
  it('consumes random rounding for integral durability/half damage and reports zero rounded half damage', () => {
    const rand = rolls(0.1, 0.6, 0.1, 0.9);
    expect(resolveArmor(input({ amount: 8 }), rand).amount).toBe(4);
    expect(rand).toHaveBeenCalledTimes(4);
    const zero = resolveArmor(input({ amount: 0.5 }), rolls(0.9, 0.6, 0.9));
    expect(zero.steps[0].outcome).toBe('diminish');
    expect(zero.deflected).toBe(true);
    expect(zero.deflectedByMetalArmor).toBe(true);
    expect(zero.diminishedByMetalArmor).toBe(false);
  });
  it('does not damage uncovered apparel and consumes only natural armor for a bare hit', () => {
    const rand = rolls(0.5);
    const r = resolveArmor(input({ part: 'leftHand' }), rand);
    expect(r.amount).toBe(10);
    expect(r.worn[0].hitPoints).toBe(290);
    expect(r.steps.map((s) => s.apparelId)).toEqual([null]);
    expect(rand).toHaveBeenCalledTimes(1);
  });
  it('validates all inputs and random values without mutating original garments', () => {
    const base = input(),
      before = structuredClone(base);
    for (const bad of [NaN, Infinity, -0.1, 1]) {
      expect(() => resolveArmor(base, rolls(0, bad))).toThrow();
      expect(base).toEqual(before);
    }
    for (const bad of [
      { amount: 0 },
      { amount: Infinity },
      { armorPenetration: -1 },
      { armorPenetration: NaN },
      { worn: [base.worn[0], base.worn[0]] },
      { worn: [{ ...base.worn[0], hitPoints: 0 }] },
      { part: 'not-a-part' },
      { damageDef: 'Bullet' },
    ])
      expect(() => resolveArmor({ ...base, ...bad } as ArmorInput, rolls(0))).toThrow();
    expect(base).toEqual(before);
  });
});

describe('armor occurs once between actual part selection and original damage worker', () => {
  it('protects the actual forced internal Stab target and retains Stab propagation after conversion', () => {
    const t = initialTrauma(),
      children = BODY_PARTS.torso.children.filter((p) => BODY_PARTS[p].depth === 'Inside');
    const rand = rolls(0, midpoint(children, 'leftLung'), 0.9, 0.6, 0.9, 0.9);
    let id = 10;
    const r = applyBodyDamage(t, 'Stab', 'torso', 10, {
      random: rand,
      allocId: () => id++,
      armor: { worn: [makeApparel(1, 'plateArmor')], armorPenetration: 0 },
    });
    expect(r.armor?.steps.map((s) => s.part)).toEqual(['leftLung', 'leftLung']);
    expect(r.hits.map((w) => [w.part, w.kind, w.severity])).toEqual([
      ['leftLung', 'crush', 2],
      ['torso', 'bruise', 3.75],
    ]);
    expect(r.armor?.worn[0].hitPoints).toBe(288);
    expect(rand).toHaveBeenCalledTimes(6);
    expect(validTrauma(t, 0)).toBe(true);
  });
  it('retains original Stab outside-preservation thresholds after Sharp becomes Blunt', () => {
    const t = initialTrauma();
    const r = applyBodyDamage(t, 'Stab', 'leftArm', 64, {
      random: rolls(0.9, 0.9, 0.6, 0.9, 0.9, 0.5),
      allocId: () => 10,
      armor: { worn: [makeApparel(1, 'plateArmor')], armorPenetration: 0 },
    });
    expect(r.hits.map((w) => [w.kind, w.severity])).toEqual([['bruise', 29]]);
    expect(t.missingParts).toEqual([]);
  });
  it('retains Cut cleave after conversion, without rerunning armor on propagated body parts', () => {
    const rand = rolls(0.9, 0.6, 0.9, 0.9, 0.8, 0.2, 0, 0.1, 0.2, 0.3, 0.4);
    let id = 10;
    const r = applyBodyDamage(initialTrauma(), 'Cut', 'leftArm', 10, {
      random: rand,
      allocId: () => id++,
      armor: { worn: [makeApparel(1, 'plateArmor')], armorPenetration: 0 },
    });
    expect(r.hits.map((w) => [w.part, w.kind])).toEqual([
      ['leftHumerus', 'crack'],
      ['leftRadius', 'crack'],
      ['leftArm', 'bruise'],
    ]);
    expect(r.hits.every((w) => Math.abs(w.severity - 12 / 4.4) < 1e-9)).toBe(true);
    expect(r.armor?.steps).toHaveLength(2);
    expect(r.armor?.worn[0].hitPoints).toBe(288);
  });
  it('uses effective damage Def for Bite duplicate-to-outside instead of switching workers', () => {
    const r = applyBodyDamage(initialTrauma(), 'Bite', 'leftLung', 10, {
      random: rolls(0.9, 0.6, 0.9, 0.9),
      allocId: () => 10,
      armor: { worn: [makeApparel(1, 'plateArmor')], armorPenetration: 0 },
    });
    expect(r.hits.map((w) => [w.part, w.kind, w.severity])).toEqual([['leftLung', 'crush', 5]]);
  });
  it('returns armor durability on a full block without creating wounds or allocating injury IDs', () => {
    const t = initialTrauma(),
      allocId = vi.fn(() => 10),
      plate = makeApparel(1, 'plateArmor');
    const r = applyBodyDamage(t, 'Cut', 'torso', 10, {
      random: rolls(0.9, 0),
      allocId,
      armor: { worn: [plate], armorPenetration: 0 },
    });
    expect(r.hits).toEqual([]);
    expect(r.totalDamage).toBe(0);
    expect(r.armor?.worn[0].hitPoints).toBe(288);
    expect(t).toEqual(initialTrauma());
    expect(allocId).not.toHaveBeenCalled();
    expect(plate.hitPoints).toBe(290);
  });
  it('keeps trauma and clothing atomic on failed armor, propagation RNG or allocated IDs', () => {
    for (const [random, allocId] of [
      [rolls(0, NaN), () => 10],
      [rolls(0.9, 0.6, 0.9, 0.9, NaN), () => 10],
      [rolls(0.9, 0.6, 0.9, 0.9, 0, 0), () => 0],
    ] as const) {
      const t = initialTrauma(),
        worn = [makeApparel(1, 'plateArmor')],
        before = structuredClone(worn);
      expect(() =>
        applyBodyDamage(t, 'Cut', 'torso', 10, {
          random,
          allocId,
          armor: { worn, armorPenetration: 0 },
        }),
      ).toThrow();
      expect(t).toEqual(initialTrauma());
      expect(worn).toEqual(before);
    }
  });
});
