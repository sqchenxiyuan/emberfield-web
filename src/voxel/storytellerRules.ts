import { DAY } from './types';
import { unityRound } from './wealth';

/** Core 1.7 economy evidence, chapters 04/63. Time and random streams are
 * explicit project adaptations; these functions do not execute native RNG. */
export type Curve = readonly (readonly [number, number])[];
export function evaluateCurve(points: Curve, value: number): number {
  if (value <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [right, y] = points[i], [left, previous] = points[i - 1];
    if (value <= right) return previous + ((value - left) / (right - left)) * (y - previous);
  }
  return points[points.length - 1][1];
}
export const WEALTH_POINTS: Curve = [[0, 0], [14000, 0], [400000, 2400], [700000, 3600], [1000000, 4200]];
export const COLONIST_POINTS: Curve = [[0, 15], [10000, 15], [400000, 140], [1000000, 200]];
export const ADAPTATION_FACTOR: Curve = [[-30, .4], [0, .8], [30, 1], [60, 1.2], [120, 1.6], [180, 2]];
export const ADAPTATION_GROWTH: Curve = [[-30.01, 6], [-30, 3], [-.01, 3], [0, 1], [59.99, 1], [60, .5], [119.99, .5], [120, .25]];
export const DOWNED_LOSS: Curve = [[1, 8], [2, 6], [3, 6], [11, 5], [20, 3.5]];
export const LOST_LOSS: Curve = [[0, 30], [11, 30], [20, 20]];
export const SETTLEMENT_FACTOR: Curve = [[10, .7], [40, 1]];
export const STORY_INTERVAL = DAY / 60;

export interface ThreatTuning {
  threatScale: number;
  adaptationEffect: number;
  adaptationGrowth: number;
  minimumCeiling: number;
}
export interface WealthTotals {
  items: number;
  buildings: number;
  pawns: number;
}
export interface ThreatBreakdown {
  wealth: WealthTotals;
  totalWealth: number;
  storytellerWealth: number;
  wealthPoints: number;
  populationPoints: number;
  population: { id: number; health: number; points: number }[];
  adaptationDays: number;
  adaptationRawFactor: number;
  adaptationFactor: number;
  difficultyFactor: number;
  settlementFactor: number;
  minimumPoints: number;
  unclampedPoints: number;
  points: number;
}
/** Ordinary player-home map, adult free humans. Other target/population kinds
 * must supply their own native branches when those entities are implemented. */
export function threatPoints(
  wealth: WealthTotals,
  population: readonly { id: number; health: number }[],
  adaptationDays: number,
  daysSinceSettle: number,
  tuning: ThreatTuning,
  minimumRoll: number,
): ThreatBreakdown {
  const storytellerWealth = wealth.items + .5 * wealth.buildings + wealth.pawns;
  const perColonist = evaluateCurve(COLONIST_POINTS, storytellerWealth);
  const details = population.map(p => ({ ...p, points: perColonist * (.35 + .65 * p.health) }));
  const wealthPoints = evaluateCurve(WEALTH_POINTS, storytellerWealth);
  const populationPoints = details.reduce((n, p) => n + p.points, 0);
  const adaptationRawFactor = evaluateCurve(ADAPTATION_FACTOR, adaptationDays);
  const adaptationFactor = 1 + tuning.adaptationEffect * (adaptationRawFactor - 1);
  const settlementFactor = evaluateCurve(SETTLEMENT_FACTOR, Math.floor(daysSinceSettle));
  const ceiling = evaluateCurve([[12, 35], [35, tuning.minimumCeiling]], daysSinceSettle);
  const minimumPoints = 35 + (ceiling - 35) * minimumRoll;
  const unclampedPoints = (wealthPoints + populationPoints) * adaptationFactor * tuning.threatScale * settlementFactor;
  return {
    wealth: { ...wealth }, totalWealth: wealth.items + wealth.buildings + wealth.pawns,
    storytellerWealth, wealthPoints, populationPoints, population: details,
    adaptationDays, adaptationRawFactor, adaptationFactor, difficultyFactor: tuning.threatScale,
    settlementFactor, minimumPoints, unclampedPoints,
    points: Math.min(10000, Math.max(minimumPoints, unclampedPoints)),
  };
}

/** Called only on half-day boundaries, after actual loss notifications. */
export function growAdaptation(value: number, daysSinceSettle: number, positiveGrowthFactor: number): number {
  if (value >= 0 && daysSinceSettle < 30) return value;
  const delta = .5 * evaluateCurve(ADAPTATION_GROWTH, value) * (value > 0 ? positiveGrowthFactor : 1);
  return Math.min(100, value + delta);
}
export function adaptationAfterLoss(value: number, kind: 'downed' | 'lost', population: number): number {
  return Math.max(-60, value - evaluateCurve(kind === 'downed' ? DOWNED_LOSS : LOST_LOSS, population));
}

export interface OnOffTiming {
  onDays: number;
  offDays: number;
  minimumSpacingDays: number;
  minIncidents: number;
  maxIncidents: number;
}
const randomRound = (value: number, random: () => number) => Math.floor(value) + (random() < value % 1 ? 1 : 0);
/** This deliberately retains native <= end acceptance: relaxation can place a
 * hit on the first off interval. A caller must not clamp that hit backwards. */
export function relaxIncidentSpacing(hits: number[], spacing: number, previousHit: number, end: number): boolean {
  for (let i = 0; i < hits.length; i++) {
    const difference = Math.abs(hits[i] - (i === 0 ? previousHit : hits[i - 1]));
    if (difference >= spacing) continue;
    hits[i] += spacing - difference;
    for (let j = i + 1; j < hits.length; j++) hits[j] = Math.max(hits[j], hits[i] + j);
  }
  return !hits.length || hits[hits.length - 1] <= end;
}
/** Cycle generation consumes its own stable random stream, never frame time.
 * start/previousHit/result are 1/60-day interval indices, not simulation ticks. */
export function generateIncidentCycle(
  timing: OnOffTiming,
  start: number,
  previousHit: number,
  random: () => number,
  acceptFraction = 1,
): number[] {
  const length = unityRound(timing.onDays * 60);
  const spacing = unityRound(timing.minimumSpacingDays * 60);
  const count = randomRound(timing.minIncidents + (timing.maxIncidents - timing.minIncidents) * random(), random);
  for (let attempt = 0; attempt <= 100; attempt++) {
    const hits = Array.from({ length: count }, () => start + Math.floor(random() * length)).sort((a, b) => a - b);
    if (!relaxIncidentSpacing(hits, spacing, previousHit, start + length)) continue;
    if (acceptFraction < 1) {
      const accepted = randomRound(hits.length * acceptFraction, random);
      for (let i = hits.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [hits[i], hits[j]] = [hits[j], hits[i]];
      }
      // Native acceptance shuffles then truncates without restoring order.
      hits.length = accepted;
    }
    return hits;
  }
  return [];
}
