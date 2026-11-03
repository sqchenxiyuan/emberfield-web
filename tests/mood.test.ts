import { initialLiving } from '../src/voxel/living';
import { describe, expect, it } from 'vitest';
import { advancePsyche, initialPsyche, moodView, MOOD_RULES, recreationGain,
  remember, shouldRecreate, validatePsyche, type Psyche } from '../src/voxel/mood';
import { DAY, type Pawn } from '../src/voxel/types';
import { initialSurvival } from '../src/voxel/survival';
import { applyInjury } from '../src/voxel/injuries';
import { makeApparel } from '../src/voxel/apparel';

// Pure-rule fixture: no world, scheduling, physical jobs or resource simulation.
function person(extra: Partial<Pawn> = {}): Pawn {
  return { ...initialSurvival(73129, 1), id: 1, name: '测试殖民者', x: 10, y: 10, z: 8,
    food: 80, rest: 80, worn: [], living: initialLiving(), psyche: initialPsyche(), phase: 'idle', sleepingSince: null,
    sleepBedId: null, jobId: null, cargo: null, eating: null, ...extra } as Pawn;
}
const session = (kind: 'walk' | 'horseshoes' = 'walk'): NonNullable<Psyche['recreation']> => ({
  kind, target: { x: 12, y: 12, z: 8 }, spotId: kind === 'walk' ? null : 50,
  startedTick: 1000, endTick: 1600, forced: false,
});

describe('provisional mood, recreation and bounded sad wandering', () => {
  it('starts with independent defaults and does not break a fed rested colony just for lacking recreation', () => {
    const p = person(), other = initialPsyche();
    expect(p.psyche).toMatchObject({ level: 65, joy: 70, lowTicks: 0, breakUntil: 0 });
    p.psyche.tolerance.walk = .2;
    expect(other.tolerance.walk).toBe(0);
    const before = p.psyche.level;
    expect(advancePsyche(p, 1, 21)).toBeNull();
    expect(before - p.psyche.level).toBeCloseTo(MOOD_RULES.moodChangePerTick);
    for (let tick = 2; tick <= 2 * DAY; tick++) expect(advancePsyche(p, tick, 21)).toBeNull();
    expect(p.psyche.level).toBeGreaterThan(MOOD_RULES.lowThreshold);
    expect(validatePsyche(p, 2 * DAY)).toBe(true);
  });

  it('reports separate needs, pain, clothing-aware temperature and active memories without changing state', () => {
    const p = person({ food: 0, rest: 0 }); p.psyche.joy = 0;
    applyInjury(p.trauma, 3, 'leftArm', 'cut', 12);
    remember(p.psyche, 'ateRaw', 0);
    const before = structuredClone(p), view = moodView(p, 100, -20);
    expect(view.thoughts.map(t => t.label)).toEqual(expect.arrayContaining([
      '饥肠辘辘', '精疲力尽', '疼痛', '太冷了', '缺乏娱乐', '吃了生食',
    ]));
    expect(view.target).toBe(0);
    expect(p).toEqual(before);
    const dressed = person(); dressed.worn = [makeApparel(20, 'parka')];
    expect(moodView(dressed, 0, 5).thoughts.some(t => t.label === '太冷了')).toBe(false);
    expect(moodView(person(), 0, 5).thoughts.some(t => t.label === '太冷了')).toBe(true);
  });

  it('refreshes one memory, ignores expired thoughts and prunes them during advancement', () => {
    const p = person();
    remember(p.psyche, 'ateRaw', 10); remember(p.psyche, 'ateRaw', 20);
    expect(p.psyche.memories).toEqual([{ kind: 'ateRaw', expires: 20 + MOOD_RULES.memoryDuration.ateRaw }]);
    const expires = p.psyche.memories[0].expires;
    expect(moodView(p, expires - 1, 21).thoughts.some(t => t.label === '吃了生食')).toBe(true);
    expect(moodView(p, expires, 21).thoughts.some(t => t.label === '吃了生食')).toBe(false);
    expect(validatePsyche(p, expires)).toBe(true);
    advancePsyche(p, expires, 21);
    expect(p.psyche.memories).toEqual([]);
  });

  it('preserves joy during sleep or incapacitation and does not advance visitors or dead pawns', () => {
    for (const extra of [{ phase: 'rest' as const, sleepingSince: 0 }, { downed: true }]) {
      const p = person(extra), joy = p.psyche.joy;
      p.psyche.level = 0; p.psyche.lowTicks = MOOD_RULES.lowDurationTicks - 1;
      expect(advancePsyche(p, 1000, 21)).toBeNull();
      expect(p.psyche.joy).toBe(joy);
      expect(p.psyche.lowTicks).toBe(0);
    }
    for (const extra of [{ faction: 'trader' as const }, { faction: 'raider' as const }, { dead: true }]) {
      const p = person(extra), before = structuredClone(p);
      expect(advancePsyche(p, 1000, 21)).toBeNull();
      expect(p).toEqual(before);
    }
  });

  it('requires sustained low mood, then ends once with catharsis and a real cooldown even when downed', () => {
    const p = person({ food: 0, rest: 0, drafted: true });
    p.psyche.level = 5; p.psyche.joy = 0;
    p.psyche.lowTicks = MOOD_RULES.lowDurationTicks - 2;
    p.jobId = 27; p.cargo = { resource: 'wood', amount: 3 };
    const physical = { phase: p.phase, drafted: p.drafted, jobId: p.jobId, cargo: structuredClone(p.cargo) };
    expect(advancePsyche(p, 1000, 21)).toBeNull();
    expect(advancePsyche(p, 1001, 21)).toBe('started');
    expect(moodView(p, 1001, 21)).toMatchObject({ risk: 'break', breakRemaining: MOOD_RULES.breakDurationTicks });
    expect(p).toMatchObject(physical);
    const end = p.psyche.breakUntil;
    expect(advancePsyche(p, end - 1, 21)).toBeNull();
    p.downed = true;
    expect(advancePsyche(p, end, 21)).toBe('ended');
    expect(p.psyche).toMatchObject({ breakUntil: 0, lowTicks: 0, level: MOOD_RULES.recoveryLevel,
      cooldownUntil: end + MOOD_RULES.cooldownTicks });
    expect(p.psyche.memories).toContainEqual({ kind: 'catharsis', expires: end + MOOD_RULES.memoryDuration.catharsis });
    expect(advancePsyche(p, end, 21)).toBeNull();
    p.downed = false; p.psyche.level = 0;
    expect(advancePsyche(p, p.psyche.cooldownUntil - 1, 21)).toBeNull();
    expect(p.psyche.lowTicks).toBe(0);
    expect(advancePsyche(p, p.psyche.cooldownUntil, 21)).toBeNull();
    expect(p.psyche.lowTicks).toBe(1);
  });

  it('drops accumulated risk after recovery and clears only the activity record on break start', () => {
    const p = person();
    p.psyche.lowTicks = 12;
    advancePsyche(p, 1000, 21);
    expect(p.psyche.lowTicks).toBe(0);
    p.food = 0; p.rest = 0; p.psyche.level = 0; p.psyche.joy = 0;
    p.psyche.lowTicks = MOOD_RULES.lowDurationTicks - 1;
    p.psyche.recreation = session();
    expect(advancePsyche(p, 1001, 21)).toBe('started');
    expect(p.psyche.recreation).toBeNull();
    expect(p.phase).toBe('idle');
  });

  it('reduces repeated recreation gains independently and decays unused kinds without touching joy gains', () => {
    for (const kind of ['walk', 'horseshoes'] as const) {
      expect(recreationGain(kind, 0)).toBeGreaterThan(recreationGain(kind, .5));
      expect(recreationGain(kind, .5)).toBeGreaterThan(recreationGain(kind, 1));
      expect(recreationGain(kind, 1)).toBeGreaterThan(0);
    }
    const p = person(); p.psyche.tolerance = { walk: .5, horseshoes: .5 };
    p.psyche.recreation = session();
    advancePsyche(p, 1001, 21);
    expect(p.psyche.tolerance.walk).toBe(.5);
    expect(p.psyche.tolerance.horseshoes).toBeCloseTo(.5 - MOOD_RULES.toleranceDecayPerTick);
    expect(p.psyche.joy).toBeCloseTo(MOOD_RULES.initialJoy - MOOD_RULES.joyFallPerTick);
  });

  it('uses explicit schedule thresholds and keeps urgent or forced states out of automatic recreation', () => {
    const p = person(); p.psyche.joy = 60;
    expect(shouldRecreate(p, 'anything')).toBe(false);
    expect(shouldRecreate(p, 'recreation')).toBe(true);
    p.psyche.joy = 0;
    expect(shouldRecreate(p, 'anything')).toBe(true);
    expect(shouldRecreate(p, 'work')).toBe(false);
    expect(shouldRecreate(p, 'sleep')).toBe(false);
    for (const extra of [{ drafted: true }, { downed: true }, { dead: true }, { food: 0 },
      { rest: 0 }, { carriedBy: 2 }, { faction: 'trader' as const }, { eating: 'meal' as const }]) {
      const blocked = person(extra); blocked.psyche.joy = 0;
      expect(shouldRecreate(blocked, 'recreation')).toBe(false);
    }
  });

  it('validates finite fields, bounded activity dates, physical targets and kind-specific identities', () => {
    const p = person(); p.psyche.recreation = session('horseshoes');
    expect(validatePsyche(p, 1100)).toBe(true);
    const mutations: ((q: any) => void)[] = [
      q => q.level = NaN, q => q.joy = 101, q => q.lowTicks = -1,
      q => q.lowTicks = MOOD_RULES.lowDurationTicks + 1,
      q => q.breakUntil = 1101 + MOOD_RULES.breakDurationTicks,
      q => q.cooldownUntil = Infinity, q => q.tolerance.walk = 1.01,
      q => q.tolerance.horseshoes = -.01,
      q => q.memories = [{ kind: 'unknown', expires: 1100 }],
      q => q.memories = [{ kind: 'ateRaw', expires: 1100 }, { kind: 'ateRaw', expires: 1101 }],
      q => q.memories = [{ kind: 'ateRaw', expires: 1101 + MOOD_RULES.memoryDuration.ateRaw }],
      q => q.recreation.kind = 'chess', q => q.recreation.target.x = 64,
      q => q.recreation.target.z = 1.5, q => q.recreation.startedTick = 1101,
      q => q.recreation.endTick = 999, q => q.recreation.endTick = 1601,
      q => q.recreation.spotId = null, q => q.recreation.spotId = 1.5,
      q => delete q.recreation.forced, q => q.recreation.forced = 1,
      q => { q.recreation.kind = 'walk'; q.recreation.spotId = 50; },
      q => q.breakUntil = 1200,
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(p); mutate(bad.psyche);
      expect(validatePsyche(bad, 1100)).toBe(false);
    }
    p.psyche.recreation = { ...session(), forced: true };
    expect(validatePsyche(p, 1100)).toBe(true);
    expect(validatePsyche(p, -1)).toBe(false);
  });

  it('rejects invalid public timing and gain inputs without writing invalid state', () => {
    expect(() => initialPsyche(-1)).toThrow(RangeError);
    expect(() => remember(initialPsyche(), 'ateRaw', Infinity)).toThrow(RangeError);
    expect(() => moodView(person(), 0, NaN)).toThrow(RangeError);
    expect(() => recreationGain('walk', 2)).toThrow(RangeError);
  });
});
