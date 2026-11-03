import { DAY, type Pawn } from './types';
import { plantRandom } from './plants';
import { WEAPON_DEFS, type WeaponKind, type WeaponPiece } from './weapons';
import { unityRound } from './wealth';
import { evaluateCurve, generateIncidentCycle, STORY_INTERVAL, type ThreatBreakdown, type ThreatTuning } from './storytellerRules';

export const DIFFICULTIES = ['peaceful', 'easy', 'medium', 'rough', 'hard', 'extreme'] as const;
export type Difficulty = typeof DIFFICULTIES[number];
export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  peaceful: '和平', easy: '社区建设者', medium: '冒险故事', rough: '求生挑战', hard: '冷酷无情', extreme: '嗜血成性',
};
export const DIFFICULTY: Record<Difficulty, ThreatTuning & { allowThreats: boolean }> = {
  peaceful: { threatScale: .1, adaptationEffect: 1, adaptationGrowth: 0, minimumCeiling: 45, allowThreats: false },
  easy: { threatScale: .3, adaptationEffect: 1, adaptationGrowth: .25, minimumCeiling: 45, allowThreats: true },
  medium: { threatScale: .6, adaptationEffect: 1, adaptationGrowth: .75, minimumCeiling: 70, allowThreats: true },
  rough: { threatScale: 1, adaptationEffect: .9, adaptationGrowth: 1, minimumCeiling: 70, allowThreats: true },
  hard: { threatScale: 1.55, adaptationEffect: .7, adaptationGrowth: 1, minimumCeiling: 70, allowThreats: true },
  extreme: { threatScale: 2.2, adaptationEffect: .4, adaptationGrowth: 1, minimumCeiling: 70, allowThreats: true },
};
export const CASSANDRA_TIMING = { onDays: 4.6, offDays: 6, minimumSpacingDays: 1.9, minIncidents: 1, maxIncidents: 2 };
export const CASSANDRA_START = 660, CASSANDRA_CYCLE = 636, INTRO_INTERVAL = 324;
export type RaidKind = 'drifter' | 'thrasher' | 'scavenger';
export interface RaidMember { pawnId: number; kind: RaidKind; cost: number; weapon: WeaponPiece }
export interface StoryEvent {
  tick: number;
  source: 'intro' | 'cycle' | 'legacy';
  outcome: 'spawned' | 'skipped';
  reason: string;
  threat: ThreatBreakdown;
  budget: number;
  spent: number;
  remainder: number;
  members: RaidMember[];
}
export interface AdaptationLoss {
  tick: number; pawnId: number; kind: 'downed' | 'lost'; population: number; before: number; after: number;
}
export interface StorytellerState {
  kind: 'cassandra';
  difficulty: Difficulty;
  adaptationDays: number;
  /** Last consumed calendar interval; disabling threats never resets this clock. */
  lastInterval: number;
  cycle: number;
  cycleHits: number[];
  introHandled: boolean;
  /** One original pre-v20 appointment, preserved without rerolling. */
  legacyRaidAt: number | null;
  events: StoryEvent[];
  losses: AdaptationLoss[];
}
export interface StorytellerView extends StorytellerState {
  threat: ThreatBreakdown;
  nextOpportunity: number | null;
  legacyStructureCells: number;
}

export function storyRandom(seed: number, salt: number): () => number {
  let draw = 0;
  return () => plantRandom(seed, salt, draw++, 8731);
}
export function cycleAt(interval: number): number {
  return interval < CASSANDRA_START ? -1 : Math.floor((interval - CASSANDRA_START) / CASSANDRA_CYCLE);
}
export function cycleHits(seed: number, cycle: number): number[] {
  if (cycle < 0) return [];
  // Cassandra's 6-day off window exceeds its 1.9-day spacing. Even a relaxed
  // hit at the prior window's end cannot constrain this cycle. Other timing
  // presets must pass the real previous hit instead of using this shortcut.
  return generateIncidentCycle(CASSANDRA_TIMING, CASSANDRA_START + cycle * CASSANDRA_CYCLE, -9999999, storyRandom(seed, cycle));
}
export function initialStoryteller(seed: number, tick = 0, legacyRaidAt: number | null = null): StorytellerState {
  const lastInterval = Math.floor(tick / STORY_INTERVAL), cycle = cycleAt(lastInterval);
  return { kind: 'cassandra', difficulty: 'rough', adaptationDays: 0, lastInterval, cycle,
    cycleHits: cycleHits(seed, cycle), introHandled: lastInterval >= INTRO_INTERVAL,
    legacyRaidAt, events: [], losses: [] };
}
/** Returns an opportunity, never a promise that a raid can enter the map. */
export function nextOpportunity(state: StorytellerState, seed: number, tick: number): number | null {
  if (!DIFFICULTY[state.difficulty].allowThreats) return null;
  if (state.legacyRaidAt !== null) return Math.max(tick, state.legacyRaidAt);
  const interval = Math.floor(tick / STORY_INTERVAL);
  const candidates = [state.legacyRaidAt,
    !state.introHandled && interval < INTRO_INTERVAL ? INTRO_INTERVAL * STORY_INTERVAL : null,
    ...state.cycleHits.filter(i => i > interval).map(i => i * STORY_INTERVAL)];
  if (!candidates.some(i => i !== null && i > tick)) {
    const next = cycleHits(seed, Math.max(0, cycleAt(interval) + 1));
    candidates.push(...next.map(i => i * STORY_INTERVAL));
  }
  return candidates.filter((i): i is number => i !== null && i >= tick).sort((a, b) => a - b)[0] ?? null;
}
export const RAID_NAMES: Record<RaidKind, string> = { drifter: '流浪袭击者', thrasher: '近战打手', scavenger: '拾荒枪手' };
export const RAID_COST: Record<RaidKind, number> = { drifter: 35, thrasher: 50, scavenger: 50 };
const RAID_WEIGHT: Record<RaidKind, number> = { drifter: 10, thrasher: 3, scavenger: 10 };
const PAWN_MAX = [[0, 35], [70, 50], [700, 100], [1300, 150], [100000, 10000]] as const;
const WEIGHT_CURVE = [[.2, .01], [.3, .3], [.5, 1]] as const;
const weighted = <T>(items: readonly T[], weight: (item: T) => number, random: () => number): T => {
  let remaining = random() * items.reduce((n, item) => n + weight(item), 0);
  for (const item of items) { remaining -= weight(item); if (remaining < 0) return item; }
  return items[items.length - 1];
};
export interface RaidPlan { budget: number; spent: number; remainder: number; kinds: RaidKind[] }
/** Pirate low-tier subset; unavailable native kinds are omitted and weights
 * renormalized. Walk-in / ImmediateAttack, no xenotypes, child groups or siege.
 * The 16-person group cap is an explicit project capacity limit. */
export function planRaid(points: number, capacity: number, random: () => number): RaidPlan {
  const budget = Math.max(points, 35 * 1.05);
  const maximum = Math.max(42, Math.min(budget, evaluateCurve(PAWN_MAX, budget)));
  let remainder = budget, highestCost = -1;
  const kinds: RaidKind[] = [];
  while (kinds.length < Math.min(16, capacity)) {
    const options = (Object.keys(RAID_COST) as RaidKind[]).filter(k => RAID_COST[k] <= remainder && RAID_COST[k] <= maximum);
    if (!options.length) break;
    highestCost = Math.max(highestCost, ...options.map(k => RAID_COST[k]));
    const kind = weighted(options, k => RAID_WEIGHT[k] * evaluateCurve(WEIGHT_CURVE, RAID_COST[k] / highestCost), random);
    kinds.push(kind);
    remainder -= RAID_COST[kind];
  }
  return { budget, spent: budget - remainder, remainder, kinds };
}
// Full-health Normal abstract prices, after native final rounding; weapon
// money filters precede the Poor-centered quality distribution / health roll.
// Each supported weapon has one material; pair commonality is renormalized to
// its native generateCommonality=1 within this explicitly reduced catalogue.
const GEAR_PRICE = { woodClub: 51.024, steelKnife: 63.48, revolver: 135.4, machinePistol: 220 };
export function raidWeapon(kind: RaidKind, id: number, random: () => number): WeaponPiece {
  const [min, max] = kind === 'drifter' ? [60, 200] : kind === 'thrasher' ? [100, 160] : [200, 300];
  const money = min + (max - min) * random();
  const options = (kind === 'scavenger' ? ['revolver', 'machinePistol'] : ['woodClub', 'steelKnife']) as (keyof typeof GEAR_PRICE)[];
  const eligible = options.filter(k => GEAR_PRICE[k] <= money);
  const weapon: WeaponKind = weighted(eligible, k => GEAR_PRICE[k], random);
  const qualityRoll = WEAPON_DEFS[weapon].hasQuality ? random() : null;
  const quality = qualityRoll === null ? 2 : qualityRoll < .1 ? 0 : qualityRoll < .2 ? 2 : 1;
  const health = kind === 'drifter' ? .2 + .4 * random() : .4 + .7 * random();
  return { id, kind: weapon, quality,
    hitPoints: Math.max(1, Math.min(WEAPON_DEFS[weapon].maxHitPoints, unityRound(WEAPON_DEFS[weapon].maxHitPoints * health))) };
}

export function livingColonists(pawns: readonly Pawn[]) { return pawns.filter(p => p.faction === 'colony' && !p.dead); }
export const ADAPTATION_INTERVAL = DAY / 2;
