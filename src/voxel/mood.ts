import { DAY, inside, type Assignment, type Pawn, type Pos } from './types';
import { healthSummary } from './survival';
import { livingThoughts } from './living';
import { socialThoughts } from './social';

export type MemoryKind = 'ateRaw' | 'sleptGround' | 'catharsis' | 'wet';
export type RecreationKind = 'walk' | 'horseshoes' | 'social';
export interface Psyche {
  level: number;
  joy: number;
  lowTicks: number;
  breakUntil: number;
  cooldownUntil: number;
  memories: { kind: MemoryKind; expires: number }[];
  tolerance: Record<RecreationKind, number>;
  recreation: {
    kind: RecreationKind;
    target: Pos;
    spotId: number | null;
    startedTick: number;
    endTick: number;
    forced: boolean;
  } | null;
}

/** Provisional Emberfield tuning. These are not calibrated RimWorld values. */
export const MOOD_RULES = Object.freeze({
  initialLevel: 65, initialJoy: 70, baseMood: 62,
  moodChangePerTick: 60 / DAY,
  joyFallPerTick: 30 / DAY,
  hungryBelow: 25, starvingBelow: 10, hungerPenalty: 16, starvationPenalty: 26,
  tiredBelow: 25, exhaustedBelow: 10, tiredPenalty: 12, exhaustedPenalty: 20,
  painPenalty: 24, temperaturePenaltyPerDegree: 1.2, maxTemperaturePenalty: 14,
  joyDeprivedBelow: 20, joyLowBelow: 40, joyHighAbove: 80,
  joyDeprivedPenalty: 18, joyLowPenalty: 8, joyHighBonus: 5,
  lowThreshold: 25, lowDurationTicks: DAY / 12,
  breakDurationTicks: DAY / 10, recoveryLevel: 40, cooldownTicks: DAY / 2,
  memoryDuration: Object.freeze({ ateRaw: DAY / 2, sleptGround: DAY, catharsis: DAY, wet: DAY / 10 }),
  memoryValue: Object.freeze({ ateRaw: -5, sleptGround: -6, catharsis: 16, wet: -3 }),
  freeJoyThreshold: 45, scheduledJoyThreshold: 90, recreationStopJoy: 95,
  recreationMinFood: 20, recreationMinRest: 20, recreationDurationTicks: 600,
  recreationBaseGain: Object.freeze({ walk: .07, horseshoes: .11, social: .09 }),
  minimumRecreationFactor: .2,
  toleranceGainPerTick: .4 / 600, toleranceDecayPerTick: .6 / DAY,
});
export const RECREATION_NAMES: Readonly<Record<RecreationKind, string>> = {
  walk: '户外散步', horseshoes: '马蹄铁投掷', social: '桌边休闲',
};
const MEMORY_NAMES: Readonly<Record<MemoryKind, string>> = {
  ateRaw: '吃了生食', sleptGround: '睡在地上', catharsis: '发泄后的平静', wet: '淋湿了',
};
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const finiteBetween = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
function validTick(tick: number) {
  if (!integer(tick)) throw new RangeError('心情时刻必须是非负安全整数');
}

export function initialPsyche(tick = 0): Psyche {
  validTick(tick);
  return { level: MOOD_RULES.initialLevel, joy: MOOD_RULES.initialJoy,
    lowTicks: 0, breakUntil: 0, cooldownUntil: tick, memories: [],
    tolerance: { walk: 0, horseshoes: 0, social: 0 }, recreation: null };
}

/** Repeated events refresh one memory; they never stack duplicate penalties. */
export function remember(psyche: Psyche, kind: MemoryKind, tick: number): void {
  validTick(tick);
  if (!Object.hasOwn(MOOD_RULES.memoryDuration, kind)) throw new RangeError('未知心情记忆');
  const expires = tick + MOOD_RULES.memoryDuration[kind];
  if (!integer(expires)) throw new RangeError('心情记忆时刻超出范围');
  const old = psyche.memories.find(m => m.kind === kind);
  if (old) old.expires = Math.max(old.expires, expires);
  else psyche.memories.push({ kind, expires });
}

export function moodView(p: Pawn, tick: number, temperature: number): {
  target: number;
  thoughts: { label: string; value: number }[];
  risk: 'stable' | 'low' | 'break';
  /** Remaining simulation ticks, not days or real seconds. */
  breakRemaining: number;
} {
  validTick(tick);
  if (!Number.isFinite(temperature)) throw new RangeError('心情温度必须是有限数值');
  const q = p.psyche, health = healthSummary(p);
  const thoughts: { label: string; value: number }[] = [{ label: '基础心情', value: MOOD_RULES.baseMood }];
  const add = (label: string, value: number) => { if (value) thoughts.push({ label, value }); };
  if (p.food < MOOD_RULES.starvingBelow) add('饥肠辘辘', -MOOD_RULES.starvationPenalty);
  else if (p.food < MOOD_RULES.hungryBelow) add('饥饿', -MOOD_RULES.hungerPenalty);
  if (p.rest < MOOD_RULES.exhaustedBelow) add('精疲力尽', -MOOD_RULES.exhaustedPenalty);
  else if (p.rest < MOOD_RULES.tiredBelow) add('疲倦', -MOOD_RULES.tiredPenalty);
  add('疼痛', -Math.round(clamp(health.pain, 0, 1) * MOOD_RULES.painPenalty));
  const cold = Math.max(0, health.comfortableMin - temperature);
  const hot = Math.max(0, temperature - health.comfortableMax);
  add(cold > 0 ? '太冷了' : '太热了', -Math.round(Math.min(MOOD_RULES.maxTemperaturePenalty,
    (cold + hot) * MOOD_RULES.temperaturePenaltyPerDegree)));
  if (q.joy < MOOD_RULES.joyDeprivedBelow) add('缺乏娱乐', -MOOD_RULES.joyDeprivedPenalty);
  else if (q.joy < MOOD_RULES.joyLowBelow) add('有些无聊', -MOOD_RULES.joyLowPenalty);
  else if (q.joy > MOOD_RULES.joyHighAbove) add('娱乐充足', MOOD_RULES.joyHighBonus);
  for (const memory of q.memories) if (memory.expires > tick)
    add(MEMORY_NAMES[memory.kind], MOOD_RULES.memoryValue[memory.kind]);
  for (const thought of livingThoughts(p.living, tick)) add(thought.label, thought.value);
  for (const thought of socialThoughts(p.social, tick)) add(thought.label, thought.value);
  const breakRemaining = Math.max(0, q.breakUntil - tick);
  return { target: clamp(thoughts.reduce((sum, t) => sum + t.value, 0)), thoughts,
    risk: breakRemaining > 0 ? 'break' : q.level < MOOD_RULES.lowThreshold ? 'low' : 'stable',
    breakRemaining };
}

/** Call once per simulation tick. Only psyche changes here; the world handles
 * physical travel, work interruption, forced drafting cancellation and joy gain. */
export function advancePsyche(p: Pawn, tick: number, temperature: number): 'started' | 'ended' | null {
  if (p.faction !== 'colony' || p.dead) return null;
  const q = p.psyche;
  const { target } = moodView(p, tick, temperature);
  q.memories = q.memories.filter(m => m.expires > tick);
  const awake = !p.downed && p.phase !== 'rest' && p.sleepingSince === null;
  if (awake) q.joy = clamp(q.joy - MOOD_RULES.joyFallPerTick);
  for (const kind of ['walk', 'horseshoes', 'social'] as const)
    if (q.recreation?.kind !== kind)
      q.tolerance[kind] = clamp(q.tolerance[kind] - MOOD_RULES.toleranceDecayPerTick, 0, 1);
  q.level = clamp(q.level + clamp(target - q.level, -MOOD_RULES.moodChangePerTick, MOOD_RULES.moodChangePerTick));
  if (q.breakUntil > 0) {
    q.lowTicks = 0;
    if (tick < q.breakUntil) return null;
    q.breakUntil = 0;
    q.level = Math.max(q.level, MOOD_RULES.recoveryLevel);
    q.cooldownUntil = tick + MOOD_RULES.cooldownTicks;
    remember(q, 'catharsis', tick);
    return 'ended';
  }
  if (!awake || tick < q.cooldownUntil || q.level >= MOOD_RULES.lowThreshold) {
    q.lowTicks = 0;
    return null;
  }
  q.lowTicks++;
  if (q.lowTicks < MOOD_RULES.lowDurationTicks) return null;
  q.lowTicks = 0;
  q.breakUntil = tick + MOOD_RULES.breakDurationTicks;
  q.recreation = null;
  return 'started';
}

/** The world adds this gain and toleranceGainPerTick only while actually playing. */
export function recreationGain(kind: RecreationKind, tolerance: number): number {
  if (!Object.hasOwn(MOOD_RULES.recreationBaseGain, kind) || !finiteBetween(tolerance, 0, 1))
    throw new RangeError('娱乐类型或耐受度无效');
  return MOOD_RULES.recreationBaseGain[kind] *
    (1 - (1 - MOOD_RULES.minimumRecreationFactor) * tolerance);
}

/** Automatic recreation only. Manual requests may override the schedule in world.
 * Sleep blocks are intentionally simplified to prohibit automatic recreation. */
export function shouldRecreate(p: Pawn, assignment: Assignment): boolean {
  if (p.faction !== 'colony' || p.dead || p.downed || p.drafted || p.carriedBy !== null ||
      p.phase === 'rest' || p.sleepingSince !== null || p.carePhase !== null ||
      p.attackTargetId !== null || p.eating !== null || p.psyche.breakUntil > 0 ||
      p.psyche.recreation !== null || p.food < MOOD_RULES.recreationMinFood ||
      p.rest < MOOD_RULES.recreationMinRest) return false;
  if (assignment === 'recreation') return p.psyche.joy < MOOD_RULES.scheduledJoyThreshold;
  return assignment === 'anything' && p.psyche.joy < MOOD_RULES.freeJoyThreshold;
}

/** Expired memories/break dates may await the next active pawn tick (or belong to
 * a frozen deceased pawn). Future dates and recreation durations remain bounded. */
export function validatePsyche(p: Pawn, tick: number): boolean {
  if (!integer(tick) || !record(p) || !record(p.psyche)) return false;
  const q = p.psyche;
  if (Object.keys(q).length !== 8 || !finiteBetween(q.level, 0, 100) || !finiteBetween(q.joy, 0, 100) ||
      !integer(q.lowTicks) || q.lowTicks > MOOD_RULES.lowDurationTicks ||
      !integer(q.breakUntil) || q.breakUntil > tick + MOOD_RULES.breakDurationTicks ||
      !integer(q.cooldownUntil) || q.cooldownUntil > tick + MOOD_RULES.cooldownTicks ||
      !record(q.tolerance) || Object.keys(q.tolerance).length !== 3 ||
      !finiteBetween(q.tolerance.walk, 0, 1) || !finiteBetween(q.tolerance.horseshoes, 0, 1) || !finiteBetween(q.tolerance.social, 0, 1) ||
      !Array.isArray(q.memories) || q.memories.length > 4 ||
      new Set(q.memories.map(m => m?.kind)).size !== q.memories.length) return false;
  for (const m of q.memories) if (!record(m) || Object.keys(m).length !== 2 ||
      !Object.hasOwn(MOOD_RULES.memoryDuration, m.kind) || !integer(m.expires) ||
      m.expires > tick + MOOD_RULES.memoryDuration[m.kind as MemoryKind]) return false;
  const r = q.recreation;
  if (r !== null && (!record(r) || Object.keys(r).length !== 6 ||
      !Object.hasOwn(RECREATION_NAMES, r.kind) || typeof r.forced !== 'boolean' ||
      !record(r.target) || Object.keys(r.target).length !== 3 || !inside(r.target) ||
      !integer(r.startedTick) || r.startedTick > tick || !integer(r.endTick) ||
      r.endTick < r.startedTick || r.endTick - r.startedTick > MOOD_RULES.recreationDurationTicks ||
      (r.kind === 'walk' ? r.spotId !== null : !integer(r.spotId) || r.spotId === 0))) return false;
  return q.breakUntil <= tick || (q.lowTicks === 0 && r === null);
}
