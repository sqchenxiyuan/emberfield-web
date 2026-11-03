import { DAY, type Pos } from './types';

export const FILTH_NAMES = { dirt: '泥土', blood: '血迹', butcher: '屠宰污物', vomit: '呕吐物' } as const;
export type FilthKind = keyof typeof FILTH_NAMES;
export interface Filth extends Pos { id: number; kind: FilthKind; amount: number; createdTick: number }
export interface CleanTask { filthId: number; progress: number }
export type PoisoningStage = 'initial' | 'major' | 'recovering';
export interface FoodPoisoning { startedTick: number; endsTick: number; nextVomitTick: number; stage: PoisoningStage }
export interface RoomCleanliness { roomId: number; cleanliness: number; filthAmount: number; floorCells: number }
export interface CookingOutcome {
  poisonChance: number; risk: number; roll: number; skill: number; cleanliness: number; cookId: number;
  roomless: boolean;
}
/** Temporary Emberfield tuning. No native numeric calibration is claimed. */
export const SANITATION_RULES = {
  maxFilth: 4096, maxLayers: 12, cleanWork: 60, dirtCarry: 3,
  bloodInterval: 120, bloodMinRate: .01, butcherLayers: 4,
  filthPenalty: { dirt: .6, blood: 1, butcher: 3, vomit: 2.5 },
  dirtyThreshold: -.5, dirtyRiskPerPoint: .08, maxDirtyRisk: .5, roomlessRisk: .02,
  poisonDuration: DAY / 2, vomitInterval: DAY / 8, vomitFoodLoss: 8, vomitRestLoss: 3,
  hungerFactor: 1.25,
  initialFraction: .2, recoveringFraction: .8,
  capacity: { initial: { moving: .8, manipulation: .9 }, major: { moving: .5, manipulation: .8 },
    recovering: { moving: .8, manipulation: .9 } },
} as const;
const finite = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
export function sanitationRandom(seed: number, id: number, tick: number, stream: number): number {
  let h = Math.imul(seed ^ id, 0x45d9f3b) ^ Math.imul(tick, 0x27d4eb2d) ^ Math.imul(stream, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function cookingPoisonRisk(skill: number, cleanliness: number, roomless = false): number {
  if (!finite(skill, 0, 20) || !finite(cleanliness, -1000, 10)) throw new RangeError('厨房洁净或烹饪技能无效');
  const skillRisk = .005 + .135 * Math.pow(1 - skill / 20, 3);
  const dirtRisk = roomless ? SANITATION_RULES.roomlessRisk : Math.min(SANITATION_RULES.maxDirtyRisk,
    Math.max(0, SANITATION_RULES.dirtyThreshold - cleanliness) * SANITATION_RULES.dirtyRiskPerPoint);
  return 1 - (1 - skillRisk) * (1 - dirtRisk);
}
/** Call once on first completed work; persist this even when output placement fails. */
export function cookingOutcome(seed: number, jobId: number, cookId: number, skill: number, cleanliness: number, roomless = false): CookingOutcome {
  const risk = cookingPoisonRisk(skill, cleanliness, roomless), roll = sanitationRandom(seed, jobId, 0, 25);
  return { poisonChance: roll < risk ? 1 : 0, risk, roll, skill, cleanliness, cookId, roomless };
}
export function initialFoodPoisoning(tick: number): FoodPoisoning {
  if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isSafeInteger(tick + SANITATION_RULES.poisonDuration))
    throw new RangeError('食物中毒起始时间无效');
  return { startedTick: tick, endsTick: tick + SANITATION_RULES.poisonDuration,
    nextVomitTick: tick + SANITATION_RULES.vomitInterval, stage: 'initial' };
}
export function poisoningStage(p: Pick<FoodPoisoning, 'startedTick' | 'endsTick'>, tick: number): PoisoningStage {
  const fraction = (tick - p.startedTick) / (p.endsTick - p.startedTick);
  return fraction < SANITATION_RULES.initialFraction ? 'initial' :
    fraction < SANITATION_RULES.recoveringFraction ? 'major' : 'recovering';
}
/** Native structure: initial exposure does not stack; later exposure returns to major onset. */
export function exposeFoodPoisoning(existing: FoodPoisoning | null, tick: number): FoodPoisoning {
  if (!existing) return initialFoodPoisoning(tick);
  if (existing.stage === 'initial') return existing;
  const startedTick = tick - Math.ceil(SANITATION_RULES.poisonDuration * SANITATION_RULES.initialFraction);
  return { startedTick, endsTick: startedTick + SANITATION_RULES.poisonDuration, stage: 'major',
    nextVomitTick: startedTick + (Math.floor((tick - startedTick) / SANITATION_RULES.vomitInterval) + 1) * SANITATION_RULES.vomitInterval };
}
export function validFoodPoisoning(p: unknown, tick: number): p is FoodPoisoning {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  const q = p as FoodPoisoning;
  return Object.keys(q).length === 4 && ['initial', 'major', 'recovering'].includes(q.stage) &&
    [q.startedTick, q.endsTick, q.nextVomitTick].every(Number.isSafeInteger) &&
    q.startedTick >= 0 && q.startedTick <= tick && q.endsTick === q.startedTick + SANITATION_RULES.poisonDuration &&
    q.nextVomitTick > q.startedTick && q.nextVomitTick <= q.endsTick &&
    (q.nextVomitTick - q.startedTick) % SANITATION_RULES.vomitInterval === 0;
}
