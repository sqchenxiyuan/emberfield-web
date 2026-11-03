import { DAY } from './types';

export const PRISON_POLICIES = ['maintain', 'reduceResistance', 'recruit', 'release'] as const;
export type PrisonerPolicy = (typeof PRISON_POLICIES)[number];
export const PRISON_POLICY_NAMES: Record<PrisonerPolicy, string> = {
  maintain: '仅维持照料', reduceResistance: '降低抵抗', recruit: '尝试招募', release: '释放',
};
export interface PrisonerState {
  originalFaction: 'raider';
  bedId: number | null;
  resistance: number;
  policy: PrisonerPolicy;
  nextInteractionTick: number;
  lastInteraction: string;
  capturedTick: number;
  releasing: boolean;
}
export interface WardenTask {
  prisonerId: number;
  bedId: number | null;
  stage: 'captureApproach' | 'captureCarry' | 'talkApproach' | 'talk' | 'releaseApproach';
  progress: number;
}
/** Provisional Emberfield tuning. The two separate conversations at resistance
 * zero follow the observed ordinary-human recruitment branch; none of these
 * amounts, durations or capacity factors claims native numeric calibration. */
export const PRISON_RULES = {
  initialResistance: 24,
  maxResistance: 100,
  talkWork: 240,
  interactionInterval: DAY / 8,
  baseResistanceReduction: 8,
  socialXpPerTalk: 150,
  hungryAt: 30,
  sleepAt: 25,
  wakeAt: 90,
  replanTicks: 40,
} as const;

const validTick = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const validId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const nullableId = (v: unknown) => v === null || validId(v);
const finiteRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const shape = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

export function initialPrisoner(tick: number, bedId: number | null = null): PrisonerState {
  if (!validTick(tick) || !nullableId(bedId) || !validTick(tick + PRISON_RULES.interactionInterval))
    throw new RangeError('俘虏初始化时间或床位无效');
  return { originalFaction: 'raider', bedId, resistance: PRISON_RULES.initialResistance, policy: 'maintain',
    nextInteractionTick: tick, lastInteraction: '已被俘获，等待照料', capturedTick: tick, releasing: false };
}
export function validPrisonerState(value: unknown, tick: number): value is PrisonerState {
  if (!validTick(tick) || !shape(value, ['originalFaction', 'bedId', 'resistance', 'policy', 'nextInteractionTick',
    'lastInteraction', 'capturedTick', 'releasing'])) return false;
  return value.originalFaction === 'raider' && nullableId(value.bedId) && finiteRange(value.resistance, 0, PRISON_RULES.maxResistance) &&
    PRISON_POLICIES.includes(value.policy as PrisonerPolicy) && validTick(value.nextInteractionTick) &&
    value.nextInteractionTick <= tick + PRISON_RULES.interactionInterval &&
    validTick(value.capturedTick) && value.capturedTick <= tick &&
    value.nextInteractionTick >= value.capturedTick &&
    typeof value.lastInteraction === 'string' && value.lastInteraction.length <= 180 &&
    typeof value.releasing === 'boolean' && (!value.releasing || (value.policy === 'release' && value.bedId === null));
}
export function validWardenTask(value: unknown): value is WardenTask {
  if (!shape(value, ['prisonerId', 'bedId', 'stage', 'progress'])) return false;
  const capture = value.stage === 'captureApproach' || value.stage === 'captureCarry';
  return validId(value.prisonerId) && nullableId(value.bedId) &&
    ['captureApproach', 'captureCarry', 'talkApproach', 'talk', 'releaseApproach'].includes(value.stage as string) &&
    (capture ? validId(value.bedId) : value.bedId === null) &&
    finiteRange(value.progress, 0, PRISON_RULES.talkWork) && (value.stage === 'talk' || value.progress === 0);
}

export interface PrisonInteractionFactors {
  social: number;
  talking: number;
  hearing: number;
  inmateConsciousness: number;
  inmateHearing: number;
  inmateTalking: number;
  inmatePain: number;
  food: number;
  rest: number;
  mood: number;
}
function validFactors(f: PrisonInteractionFactors) {
  return finiteRange(f.social, 0, 20) &&
    [f.talking, f.hearing, f.inmateConsciousness, f.inmateHearing, f.inmateTalking].every(n => finiteRange(n, 0, 2)) &&
    finiteRange(f.inmatePain, 0, 1) && [f.food, f.rest, f.mood].every(n => finiteRange(n, 0, 100));
}
export function prisonTalkSpeed(talking: number, hearing: number): number {
  if (![talking, hearing].every(n => finiteRange(n, 0, 2))) throw new RangeError('交谈能力无效');
  return Math.min(talking, hearing, 1.5);
}
/** Evaluate only at the END of one complete face-to-face conversation.
 * Crossing zero cannot recruit in that conversation. Inputs are not mutated. */
export function interactionOutcome(state: PrisonerState, factors: PrisonInteractionFactors): {
  kind: 'none' | 'reduce' | 'recruit'; resistance: number; reduction: number;
} {
  if (!finiteRange(state.resistance, 0, PRISON_RULES.maxResistance) || !validFactors(factors))
    throw new RangeError('招募状态或交谈参数无效');
  const none = { kind: 'none' as const, resistance: state.resistance, reduction: 0 };
  if (state.releasing || !['reduceResistance', 'recruit'].includes(state.policy) ||
      factors.inmateConsciousness < .3 || Math.min(factors.talking, factors.hearing,
        factors.inmateHearing, factors.inmateTalking) <= 0) return none;
  if (state.resistance === 0)
    return state.policy === 'recruit' ? { kind: 'recruit', resistance: 0, reduction: 0 } : none;
  const social = .6 + factors.social * .075;
  const capacities = Math.min(factors.talking, factors.hearing, factors.inmateConsciousness,
    factors.inmateHearing, factors.inmateTalking, 1.5);
  const condition = (.25 + .75 * (factors.food + factors.rest + factors.mood) / 300) * (1 - .5 * factors.inmatePain);
  const reduction = Math.min(state.resistance, PRISON_RULES.baseResistanceReduction * social * capacities * condition);
  return { kind: 'reduce', resistance: Math.max(0, state.resistance - reduction), reduction };
}
