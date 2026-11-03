import { researchSpeed, type SkillSet } from './skills';

export const RESEARCH_KEYS = [
  'ComplexFurniture',
  'PassiveCooler',
  'Stonecutting',
  'ComplexClothing',
  'Electricity',
  'NutrientPaste',
  'AirConditioning',
  'TreeSowing',
  'Smithing',
  'LongBlades',
  'Batteries',
  'SolarPanels',
] as const;
export type ResearchKey = (typeof RESEARCH_KEYS)[number];
export interface ResearchState {
  origin: 'industrial-start' | 'legacy-unlocked';
  current: ResearchKey | null;
  progress: Record<ResearchKey, number>;
}
export interface ResearchDef {
  name: string;
  cost: number;
  prerequisites: readonly ResearchKey[];
  unlocks: readonly string[];
  techLevel: 2 | 3 | 4;
}
export const RESEARCH_DEFS: Record<ResearchKey, ResearchDef> = {
  ComplexFurniture: {
    name: '复杂家具',
    cost: 300,
    prerequisites: [],
    unlocks: ['木床'],
    techLevel: 3,
  },
  PassiveCooler: {
    name: '被动式冷却',
    cost: 400,
    prerequisites: [],
    unlocks: ['被动式冷却器（尚未开放）'],
    techLevel: 2,
  },
  Stonecutting: {
    name: '切石',
    cost: 300,
    prerequisites: [],
    unlocks: ['木制切石台'],
    techLevel: 3,
  },
  ComplexClothing: {
    name: '复杂衣物',
    cost: 600,
    prerequisites: [],
    unlocks: ['手工裁缝台'],
    techLevel: 3,
  },
  Electricity: {
    name: '电力',
    cost: 1600,
    prerequisites: [],
    unlocks: ['燃木发电机', '电线', '电暖器'],
    techLevel: 4,
  },
  NutrientPaste: {
    name: '营养膏',
    cost: 400,
    prerequisites: ['Electricity'],
    unlocks: ['营养膏分配器（尚未开放）'],
    techLevel: 4,
  },
  AirConditioning: {
    name: '空调',
    cost: 500,
    prerequisites: ['Electricity'],
    unlocks: ['冷气机'],
    techLevel: 4,
  },
  TreeSowing: {
    name: '树木播种',
    cost: 1000,
    prerequisites: [],
    unlocks: ['林地区与种树'],
    techLevel: 2,
  },
  Smithing: { name: '锻造', cost: 700, prerequisites: [], unlocks: ['燃料锻造台'], techLevel: 3 },
  LongBlades: {
    name: '长刃武器',
    cost: 400,
    prerequisites: ['Smithing'],
    unlocks: ['钢长剑配方'],
    techLevel: 3,
  },
  Batteries: {
    name: '蓄电池',
    cost: 400,
    prerequisites: ['Electricity'],
    unlocks: ['蓄电池'],
    techLevel: 4,
  },
  SolarPanels: {
    name: '太阳能',
    cost: 600,
    prerequisites: ['Electricity'],
    unlocks: ['太阳能发电板'],
    techLevel: 4,
  },
};
const STARTING_RESEARCH: readonly ResearchKey[] = RESEARCH_KEYS.slice(0, 7);
export const RESEARCH_BENCH_COST = { wood: 75, steel: 25 } as const;
export const RESEARCH_BENCH_WORK = Math.ceil(2800 / 3);
export const RESEARCH_SESSION_TICKS = Math.ceil(4000 / 3);

export function initialResearch(legacy = false): ResearchState {
  return {
    origin: legacy ? 'legacy-unlocked' : 'industrial-start',
    current: null,
    progress: Object.fromEntries(
      RESEARCH_KEYS.map((key) => [
        key,
        legacy || STARTING_RESEARCH.includes(key) ? RESEARCH_DEFS[key].cost : 0,
      ]),
    ) as Record<ResearchKey, number>,
  };
}
export function researchComplete(state: ResearchState, key: ResearchKey): boolean {
  return state.progress[key] >= RESEARCH_DEFS[key].cost;
}
export function researchBlockReason(state: ResearchState, key: ResearchKey): string | null {
  if (researchComplete(state, key)) return '这项研究已经完成';
  const missing = RESEARCH_DEFS[key].prerequisites.filter((p) => !researchComplete(state, p));
  return missing.length
    ? `前置研究未完成：${missing.map((p) => RESEARCH_DEFS[p].name).join('、')}`
    : null;
}
export function validResearch(value: unknown): value is ResearchState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as ResearchState;
  if (
    Object.keys(state).length !== 3 ||
    !['origin', 'current', 'progress'].every((k) => Object.hasOwn(state, k))
  )
    return false;
  if (state.origin !== 'industrial-start' && state.origin !== 'legacy-unlocked') return false;
  if (
    !state.progress ||
    typeof state.progress !== 'object' ||
    Array.isArray(state.progress) ||
    Object.keys(state.progress).length !== RESEARCH_KEYS.length
  )
    return false;
  if (
    !RESEARCH_KEYS.every(
      (key) =>
        Object.hasOwn(state.progress, key) &&
        Number.isFinite(state.progress[key]) &&
        state.progress[key] >= 0 &&
        state.progress[key] <= RESEARCH_DEFS[key].cost,
    )
  )
    return false;
  if (!STARTING_RESEARCH.every((key) => researchComplete(state, key))) return false;
  if (
    state.origin === 'legacy-unlocked' &&
    !RESEARCH_KEYS.every((key) => researchComplete(state, key))
  )
    return false;
  if (
    !RESEARCH_KEYS.every(
      (key) =>
        state.progress[key] === 0 ||
        RESEARCH_DEFS[key].prerequisites.every((p) => researchComplete(state, p)),
    )
  )
    return false;
  return (
    state.current === null ||
    (RESEARCH_KEYS.includes(state.current) && researchBlockReason(state, state.current) === null)
  );
}
const TOOL_RESEARCH: Readonly<Record<string, ResearchKey>> = {
  grove: 'TreeSowing',
  smithy: 'Smithing',
  tailor: 'ComplexClothing',
  stonecutter: 'Stonecutting',
  solar: 'SolarPanels',
  battery: 'Batteries',
  generator: 'Electricity',
  wire: 'Electricity',
  heater: 'Electricity',
  cooler: 'AirConditioning',
  bed: 'ComplexFurniture',
};
export function toolResearchReason(state: ResearchState, tool: string): string | null {
  const key = TOOL_RESEARCH[tool];
  return key && !researchComplete(state, key) ? `需要研究「${RESEARCH_DEFS[key].name}」` : null;
}
export function weaponResearchReason(state: ResearchState, kind: string): string | null {
  return kind === 'steelLongsword' && !researchComplete(state, 'LongBlades')
    ? '需要研究「长刃武器」'
    : null;
}
/** Scoped simple-bench model: proper indoor rooms use neutral cleanliness,
 * role and bookcase modifiers. Outdoor rooms use native roomlessScore .75 in
 * addition to the outdoor .75 penalty; temperature thresholds remain native.
 */
export function simpleBenchFactor(outdoor: boolean, temperature: number): number {
  if (!Number.isFinite(temperature)) throw new RangeError('研究台温度无效');
  return Math.max(
    0.25,
    0.75 * (outdoor ? 0.75 * 0.75 : 1) * (temperature < 9 || temperature > 35 ? 0.7 : 1),
  );
}
/** Native .00825 per 60-Hz tick converted to this world's 20-Hz work tick.
 * Industrial starters research only tech levels <=4, so native cost factor is 1.
 * Caller grants Intellectual XP after settling this tick's research points.
 */
export function researchPointsPerTick(
  skills: SkillSet,
  manipulation: number,
  benchFactor: number,
  sight = 1,
): number {
  if (!Number.isFinite(benchFactor) || benchFactor < 0) throw new RangeError('研究台效率无效');
  return 0.02475 * researchSpeed(skills, manipulation, sight) * benchFactor;
}
