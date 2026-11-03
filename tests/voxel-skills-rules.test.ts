import { describe, expect, it } from 'vitest';
import {
  SKILL_KEYS,
  initialSkills,
  xpToNextLevel,
  learnSkill,
  learningRate,
  tickSkills,
  validSkills,
  jobSkill,
  jobXP,
  workSpeed,
  miningYield,
  plantYield,
  tendSpeed,
  tendQuality,
  meleeHitChance,
  meleeDodgeChance,
  craftedQuality,
  type SkillState,
} from '../src/voxel/skills';

const record = (extra: Partial<SkillState> = {}): SkillState => ({
  level: 5,
  xp: 0,
  passion: 1,
  dailyXp: 0,
  ...extra,
});
function setLevel(level: number) {
  const set = initialSkills(0);
  for (const key of SKILL_KEYS) set[key] = record({ level });
  return set;
}
function sequence(values: number[]) {
  let calls = 0;
  return {
    random: () => {
      if (calls >= values.length) throw new Error('unexpected extra random draw');
      return values[calls++];
    },
    calls: () => calls,
  };
}

describe('native bounded skill records and learning', () => {
  it('uses three fixed starter profiles and independently owned zero-XP records', () => {
    expect(SKILL_KEYS.map((k) => initialSkills(0)[k].level)).toEqual([8, 6, 3, 4, 5, 3, 6, 6]);
    expect(SKILL_KEYS.map((k) => initialSkills(1)[k].level)).toEqual([3, 3, 8, 6, 4, 8, 4, 8]);
    expect(SKILL_KEYS.map((k) => initialSkills(2)[k].level)).toEqual([5, 7, 4, 3, 8, 4, 5, 4]);
    expect(SKILL_KEYS.map((k) => initialSkills(0)[k].passion)).toEqual([2, 1, 0, 0, 0, 0, 1, 0]);
    expect(SKILL_KEYS.map((k) => initialSkills(1)[k].passion)).toEqual([0, 0, 2, 1, 0, 1, 0, 1]);
    expect(SKILL_KEYS.map((k) => initialSkills(2)[k].passion)).toEqual([0, 1, 0, 0, 2, 0, 0, 0]);
    const a = initialSkills(0),
      b = initialSkills(0);
    a.mining.xp = 9;
    expect(b.mining.xp).toBe(0);
    expect(a.construction.xp).toBe(0);
    expect(
      Object.values(initialSkills(999, true)).every(
        (s) => s.xp === 0 && s.dailyXp === 0 && s.passion === 0,
      ),
    ).toBe(true);
  });

  it('uses the piecewise upgrade curve, including its clamped level-20 endpoint', () => {
    expect([0, 1, 8, 9, 10, 15, 18, 19, 20].map(xpToNextLevel)).toEqual([
      1000, 2000, 9000, 10000, 12000, 22000, 28000, 30000, 30000,
    ]);
    const s = record({ level: 8, xp: 8990 });
    expect(learnSkill(s, 20)).toBe(20);
    expect(s).toMatchObject({ level: 9, xp: 10, dailyXp: 20 });
    expect(() => xpToNextLevel(20.5)).toThrow();
  });

  it('applies passion and saturates only when the event starts above 4000 effective daily XP', () => {
    for (const [passion, expected] of [
      [0, 35],
      [1, 100],
      [2, 150],
    ] as const) {
      const s = record({ passion });
      expect(learnSkill(s, 100)).toBe(expected);
      expect(s.xp).toBe(expected);
      expect(s.dailyXp).toBe(expected);
    }
    const s = record({ passion: 2, dailyXp: 3999 });
    expect(learnSkill(s, 100)).toBe(150); // One event is not split at the threshold.
    expect(s.dailyXp).toBe(4149);
    expect(learnSkill(s, 100)).toBeCloseTo(30);
    expect(s.xp).toBeCloseTo(180);
    const boundary = record({ dailyXp: 4000 });
    expect(learningRate(boundary)).toBe(1);
    expect(learnSkill(boundary, 1)).toBe(1);
    expect(learningRate(boundary)).toBe(0.2);
  });

  it('keeps negative progress until -1000, subtracts decay from daily XP, and downgrades correctly', () => {
    const s = record({ level: 10, xp: -999.9, passion: 2, dailyXp: 6000 });
    expect(learnSkill(s, -0.1)).toBe(-0.1);
    expect(s.level).toBe(9);
    expect(s.xp).toBeCloseTo(9000);
    expect(s.dailyXp).toBeCloseTo(5999.9);
    const a = record({ level: 1, xp: -999 });
    learnSkill(a, -1);
    expect(a).toMatchObject({ level: 0, xp: 0, dailyXp: -1 });
    expect(learnSkill(a, -100)).toBe(0);
    expect(a).toMatchObject({ level: 0, xp: 0, dailyXp: -1 });
  });

  it('caps level-20 progress without discarding earned daily XP and supports crossing several levels', () => {
    const s = record({ level: 19, xp: 29990 });
    learnSkill(s, 40000);
    expect(s).toMatchObject({ level: 20, xp: 29999, dailyXp: 40000 });
    const young = record({ level: 0 });
    learnSkill(young, 6000);
    expect(young).toMatchObject({ level: 3, xp: 0, dailyXp: 6000 });
  });

  it('decays only on the 40-tick clock, preserves negative progress through JSON and resets daily learning', () => {
    const set = setLevel(10);
    set.construction.level = 20;
    set.plants.level = 9;
    set.mining.dailyXp = 4500;
    tickSkills(set, 39, 12000);
    expect(set.mining.xp).toBe(0);
    tickSkills(set, 40, 12000);
    expect(set.mining).toMatchObject({ xp: -0.1, dailyXp: 4499.9 });
    expect(set.construction.xp).toBe(-12);
    expect(set.plants.xp).toBe(0);
    const restored = JSON.parse(JSON.stringify(set));
    expect(validSkills(restored)).toBe(true);
    tickSkills(restored, 12000, 12000);
    expect(restored.mining.dailyXp).toBe(-0.1); // Reset, then this tick's native decay.
    expect(restored.construction.dailyXp).toBe(-12);
    expect(learningRate(restored.mining)).toBe(1);
    expect(restored.mining.xp).toBeCloseTo(-0.2);
  });

  it('strictly validates serialized keys, finite values, legal negative progress and normalized level bounds', () => {
    const good = setLevel(10);
    good.mining.xp = -999.99;
    good.mining.dailyXp = -123;
    expect(validSkills(good)).toBe(true);
    for (const mutate of [
      (s: any) => {
        delete s.melee;
      },
      (s: any) => {
        s.extra = {};
      },
      (s: any) => {
        s.mining.extra = 1;
      },
      (s: any) => {
        s.mining.level = 21;
      },
      (s: any) => {
        s.mining.level = 1.5;
      },
      (s: any) => {
        s.mining.passion = 3;
      },
      (s: any) => {
        s.mining.xp = -1000;
      },
      (s: any) => {
        s.mining.xp = 12000;
      },
      (s: any) => {
        s.mining.dailyXp = Infinity;
      },
      (s: any) => {
        s.mining.xp = NaN;
      },
      (s: any) => {
        s.mining.level = 0;
        s.mining.xp = -0.1;
      },
      (s: any) => {
        s.mining.level = 20;
        s.mining.xp = 29999.5;
      },
    ]) {
      const bad = structuredClone(good);
      mutate(bad);
      expect(validSkills(bad)).toBe(false);
    }
    expect(validSkills(null)).toBe(false);
    expect(() => learnSkill(record(), Infinity)).toThrow();
  });
});

describe('task learning and native work stats', () => {
  it('separates work type from learnable skill and never teaches through stonecutting, refuel or equipment handling', () => {
    expect(jobSkill('stonecut')).toBe('crafting');
    expect(jobXP('stonecut')).toBe(0);
    expect(jobXP('mine')).toBe(0.21);
    expect(jobXP('sow')).toBe(0.255);
    expect(jobXP('remove')).toBe(0.75);
    expect(jobXP('tailoring')).toBe(0.3);
    expect(jobXP('smith')).toBe(0.3);
    expect(jobXP('cook')).toBe(0.3);
    for (const kind of ['refuel', 'craftingSpot', 'haul', 'equip', 'drop', 'tend'])
      expect(jobXP(kind)).toBe(0);
  });

  it('uses mining/plants/construction curves and both construction drivers include the native 1.7 factor', () => {
    const set = setLevel(8);
    expect(workSpeed(set, 'mine')).toBeCloseTo(1);
    expect(workSpeed(set, 'sow')).toBeCloseTo(1);
    expect(workSpeed(set, 'cut', 0.5)).toBeCloseTo(0.5);
    expect(workSpeed(set, 'wall')).toBeCloseTo(1.7);
    expect(workSpeed(set, 'remove')).toBeCloseTo(1.7);
    expect(workSpeed(setLevel(0), 'mine')).toBe(0.1);
    expect(workSpeed(setLevel(0), 'wall', 0)).toBeCloseTo(0.17);
  });

  it('keeps Crafting level out of GeneralLaborSpeed and applies cooking capacity as skill offset', () => {
    const novice = setLevel(0),
      master = setLevel(20);
    for (const kind of ['tailoring', 'smith', 'stonecut']) {
      expect(workSpeed(novice, kind)).toBe(1);
      expect(workSpeed(master, kind)).toBe(1);
      expect(workSpeed(master, kind, 0.6)).toBe(0.6);
    }
    expect(workSpeed(setLevel(10), 'cook')).toBeCloseTo(1);
    expect(workSpeed(setLevel(10), 'cook', 0.5)).toBeCloseTo(0.52); // Effective skill 2.
    expect(workSpeed(setLevel(0), 'cook', 0.5)).toBeCloseTo(0.244); // Curve -20..0.
    expect(workSpeed(master, 'cook', 2)).toBe(1.6);
  });

  it('keeps medical speed and doctor quality as distinct native stats', () => {
    expect(tendSpeed(setLevel(10))).toBe(1);
    expect(tendSpeed(setLevel(10), 0.5)).toBe(0.5);
    expect(tendQuality(setLevel(8))).toBe(1);
    expect(tendQuality(setLevel(8), 0.5)).toBe(0.5);
    expect(tendQuality(setLevel(18))).toBe(1.5);
    expect(tendQuality(setLevel(20), 2)).toBeCloseTo(1.77);
    expect(workSpeed(setLevel(10), 'tend')).toBe(1);
  });

  it('uses distinct low-skill mineral yield and crop success curves, then shared expert yield bonuses', () => {
    expect([0, 2, 3, 5, 8, 19, 20].map((level) => miningYield(setLevel(level)))).toEqual([
      0.6, 0.8, 0.85, 0.925, 1, 1.12, 1.13,
    ]);
    expect([0, 2, 3, 5, 8, 19, 20].map((level) => plantYield(setLevel(level)))).toEqual([
      0.6, 0.75, 0.8, 0.9, 1, 1.12, 1.13,
    ]);
  });

  it('weights yield capacities additively around their importance and caps mineral capacities at 100%', () => {
    expect(miningYield(setLevel(8), 0.5, 0.5)).toBeCloseTo(0.765);
    expect(plantYield(setLevel(8), 0.5, 0.5)).toBeCloseTo(0.765);
    expect(miningYield(setLevel(0), 0, 0)).toBeCloseTo(0.336);
    expect(plantYield(setLevel(0), 0, 0)).toBeCloseTo(0.336);
    expect(miningYield(setLevel(20), 4, 4)).toBe(1.13);
    expect(plantYield(setLevel(20), 1, 4)).toBe(1.13);
  });

  it('allows enhanced manipulation to improve plant yield up to 150% and rejects invalid capacities', () => {
    expect(plantYield(setLevel(20), 2)).toBeCloseTo(1.469);
    expect(plantYield(setLevel(20), 3)).toBe(1.5);
    expect(plantYield(setLevel(20), 100, 100)).toBe(1.5);
    for (const yieldStat of [miningYield, plantYield]) {
      expect(() => yieldStat(setLevel(8), -1)).toThrow();
      expect(() => yieldStat(setLevel(8), NaN)).toThrow();
      expect(() => yieldStat(setLevel(8), 1, Infinity)).toThrow();
    }
  });

  it('evaluates melee accuracy and dodge with their separate capacity offsets and capped sight terms', () => {
    expect(meleeHitChance(setLevel(0))).toBe(0.5);
    expect(meleeHitChance(setLevel(10))).toBe(0.8);
    expect(meleeHitChance(setLevel(20))).toBe(0.9);
    expect(meleeHitChance(setLevel(10), 0.5)).toBeCloseTo(0.62);
    expect(meleeDodgeChance(setLevel(5))).toBe(0);
    expect(meleeDodgeChance(setLevel(20))).toBe(0.3);
    expect(meleeDodgeChance(setLevel(20), 0.5)).toBeCloseTo(0.12);
    expect(meleeHitChance(setLevel(20), 2, 2)).toBeCloseTo(0.936);
    expect(meleeDodgeChance(setLevel(20), 4, 2)).toBe(0.5);
  });
});

describe('non-inspired crafted quality', () => {
  it('truncates the native skill centers instead of rounding and uses asymmetric Gaussian widths', () => {
    for (const [level, quality] of [
      [0, 0],
      [3, 1],
      [9, 2],
      [10, 3],
      [18, 4],
      [20, 4],
    ]) {
      const s = sequence([0.5, 0]);
      expect(craftedQuality(level, s.random)).toBe(quality);
      expect(s.calls()).toBe(2);
    }
    const positive = sequence([Math.exp(-2), 0.25]); // z=+2, 2.8+1.6=4.4.
    const negative = sequence([Math.exp(-2), 0.75]); // z=-2, 2.8-1.2=1.6.
    expect(craftedQuality(8, positive.random)).toBe(4);
    expect(craftedQuality(8, negative.random)).toBe(1);
  });

  it('can replace Masterwork with a lower second result and makes no extra draws at the 50% boundary', () => {
    const reroll = sequence([Math.exp(-2), 0.25, 0.49, Math.exp(-2), 0.75]);
    expect(craftedQuality(20, reroll.random)).toBe(3); // 4.2 - .6*2 = 3.
    expect(reroll.calls()).toBe(5);
    const retain = sequence([Math.exp(-2), 0.25, 0.5]);
    expect(craftedQuality(20, retain.random)).toBe(5);
    expect(retain.calls()).toBe(3);
    const widerSecond = sequence([Math.exp(-2), 0.25, 0, Math.exp(-0.405), 0.25]);
    expect(craftedQuality(20, widerSecond.random)).toBe(5); // 4.2+.95*.9; a .8 width would yield 4.
  });

  it('is reproducible across JSON-held RNG state and never yields Legendary without inspiration', () => {
    const run = (seed: number) => {
      let state = seed;
      const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
      };
      return Array.from({ length: 1000 }, () => craftedQuality(20, random));
    };
    const first = run(123456);
    expect(run(JSON.parse('123456'))).toEqual(first);
    expect(Math.max(...first)).toBe(5);
    expect(Math.min(...first)).toBeLessThan(4);
    expect(() => craftedQuality(21, () => 0.5)).toThrow();
    expect(() => craftedQuality(5, () => NaN)).toThrow();
    expect(() => craftedQuality(5, () => 1)).toThrow();
  });
});
