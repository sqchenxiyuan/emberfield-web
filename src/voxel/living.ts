import { DAY, type ApparelQuality, type Axis, type Pos } from './types';

export interface DiningTable extends Pos { id: number; axis: Axis; gathering: boolean; quality: ApparelQuality }
export interface DiningChair extends Pos { id: number; axis: Axis; quality: ApparelQuality }
export interface MealTask {
  stage: 'travel' | 'chew'; chairId: number | null; tableId: number | null;
  target: Pos; progress: number; sourceId: number | null; amount: number;
}
export type LivingMemoryKind = 'ateWithoutTable' | 'diningRoom' | 'bedroom' | 'barracks';
export interface LivingMemory { kind: LivingMemoryKind; stage: number; expires: number }
export interface LivingState {
  comfort: number; mealTask: MealTask | null; memories: LivingMemory[];
  /** Next eligible sleep thought tick. The world clears it when leaving bed. */
  sleepThoughtAt: number | null;
}
export type LivingRoomRole = 'outdoor' | 'room' | 'bedroom' | 'barracks' | 'diningRoom' |
  'hospital' | 'prisonCell' | 'prisonBarracks';
export interface RoomLivingSummary {
  id: number; outdoor: boolean; role: LivingRoomRole; floorCells: number;
  space: number; wealth: number; beauty: number; cleanliness: number; impressiveness: number; stage: number;
}
export interface RoomLivingInput {
  id: number; outdoor: boolean; floorCells: number;
  standableCells?: number; passThroughCells?: number;
  /** Buildings/plants/floors only, excluding loose cargo and pawn market value. */
  wealth: number;
  /** Count each object once, then sum terrain and filth contributions. */
  beautyTotal: number;
  /** Already normalized per supported floor cell by the sanitation model. */
  cleanliness: number;
  ordinaryBeds: number; medicalBeds: number; prisonerBeds: number; tables: number;
}

/** Native day-relative seeker rates, need thresholds, memory duration and room
 * formula; meal duration, sleep qualification and limits are Web tuning.
 * A deterministic 1-hour sleep threshold replaces native random 1-4 hours. */
export const LIVING_RULES = Object.freeze({
  initialComfort: 50, bedComfort: 75, chairComfort: 70,
  comfortRisePerTick: 60 * 24 / DAY, comfortFallPerTick: 4 * 24 / DAY,
  chewTicks: 100, maxSeatDistance: 32,
  sleepThoughtDelay: 500, sleepThoughtInterval: DAY,
  memoryDuration: DAY, maxTables: 128, maxChairs: 256,
});
/** Provisional Web furniture tuning, not native costs or final balance.
 * Quality multipliers are applied by furniture.ts. Material alternatives and
 * ComplexFurniture prerequisites remain outside this tier. Both footprints are physical. */
export const LIVING_BUILDINGS = Object.freeze({
  table: Object.freeze({ cost: Object.freeze({ wood: 28 }), work: 120, maxHitPoints: 100, beauty: 2 }),
  chair: Object.freeze({ cost: Object.freeze({ wood: 15 }), work: 90, maxHitPoints: 80, beauty: 1 }),
});
export const LIVING_ROLE_NAMES: Readonly<Record<LivingRoomRole, string>> = Object.freeze({
  outdoor: '室外', room: '房间', bedroom: '卧室', barracks: '宿舍', diningRoom: '餐厅',
  hospital: '病房', prisonCell: '囚室', prisonBarracks: '集体囚室',
});
export const IMPRESSIVENESS_NAMES = ['糟糕', '简陋', '平庸', '体面', '略显气派', '气派',
  '非常气派', '极其气派', '令人惊叹', '美妙绝伦'] as const;
export const IMPRESSIVENESS_THRESHOLDS = [20, 30, 40, 50, 65, 85, 120, 170, 240] as const;
export const LIVING_MEMORY_VALUES: Readonly<Record<LivingMemoryKind, readonly (number | null)[]>> = Object.freeze({
  ateWithoutTable: [-3], diningRoom: [null, null, null, 2, 3, 4, 5, 6, 7, 8],
  bedroom: [-2, null, 1, 2, 3, 4, 5, 6, 7, 8], barracks: [-7, -5, -4, -3, -2, -1, 1, 2, 3, 4],
});
const finite = (n: number) => Number.isFinite(n);
const validTick = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('居住时钟无效');
};
export function tableCells(t: Pick<DiningTable, 'x' | 'y' | 'z' | 'axis'>): Pos[] {
  return [{ x: t.x, y: t.y, z: t.z },
    { x: t.x + (t.axis === 'x' ? 1 : 0), y: t.y + (t.axis === 'y' ? 1 : 0), z: t.z }];
}
export function initialLiving(): LivingState {
  return { comfort: LIVING_RULES.initialComfort, mealTask: null, memories: [], sleepThoughtAt: null };
}
export function impressivenessScore(wealth: number, beauty: number, space: number, cleanliness: number): number {
  if (![wealth, beauty, space, cleanliness].every(finite) || wealth < 0 || space < 0)
    throw new RangeError('房间统计无效');
  const factor = (n: number) => Math.abs(n) < 1 ? n : Math.sign(n) * (1 + Math.log(Math.abs(n)));
  const factors = [factor(wealth / 1500), factor(beauty / 3), factor(space / 125), factor(1 + Math.min(cleanliness, 0) / 2.5)];
  let value = factors.reduce((a, b) => a + b, 0) / 4 * .65 + Math.min(...factors) * .35;
  const smallRoomLimit = factors[2] * 5;
  if (value > smallRoomLimit) value = value * .25 + smallRoomLimit * .75;
  return value * 100;
}
export function impressivenessStage(score: number): number {
  if (!finite(score)) throw new RangeError('房间印象值无效');
  return IMPRESSIVENESS_THRESHOLDS.filter(n => score >= n).length;
}
/** Native room-role competition is reduced to available furniture. Without
 * kinship or double beds, one ordinary bed is a bedroom and multiple are a
 * barracks. Bed roles outrank tables; table count does not require chairs. */
export function roomLivingSummary(input: RoomLivingInput): RoomLivingSummary {
  const { id, outdoor, floorCells, wealth, beautyTotal, cleanliness, ordinaryBeds, medicalBeds, prisonerBeds, tables } = input;
  const pass = input.passThroughCells ?? 0, stand = input.standableCells ?? floorCells - pass;
  if (!Number.isSafeInteger(id) || id < 0 || typeof outdoor !== 'boolean' ||
      ![floorCells, stand, pass, ordinaryBeds, medicalBeds, prisonerBeds, tables].every(n => Number.isSafeInteger(n) && n >= 0) ||
      stand + pass > floorCells || ![wealth, beautyTotal, cleanliness].every(finite) || wealth < 0)
    throw new RangeError('房间统计输入无效');
  const space = outdoor ? 350 : Math.min(350, stand * 1.4 + pass * .5);
  const beauty = floorCells ? beautyTotal / (floorCells < 40 ? 20 + floorCells * .5 : floorCells) : 0;
  const impressiveness = outdoor ? 0 : impressivenessScore(wealth, beauty, space, cleanliness);
  const role: LivingRoomRole = outdoor ? 'outdoor' : prisonerBeds > 0 ? (prisonerBeds > 1 ? 'prisonBarracks' : 'prisonCell') :
    medicalBeds > 0 ? 'hospital' : ordinaryBeds > 0 ? (ordinaryBeds > 1 ? 'barracks' : 'bedroom') : tables > 0 ? 'diningRoom' : 'room';
  return { id, outdoor, floorCells, space, wealth, beauty, cleanliness, impressiveness, stage: impressivenessStage(impressiveness), role };
}
/** Source is actual furniture currently used, in 0..100 units. Passing no
 * source decays comfort; merely standing or walking across a chair is no use. */
export function advanceLiving(state: LivingState, tick: number, comfortSource: number | null, delta = 1): void {
  validTick(tick);
  if (!Number.isSafeInteger(delta) || delta < 0 || !finite(state.comfort) || state.comfort < 0 || state.comfort > 100 ||
      (comfortSource !== null && (!finite(comfortSource) || comfortSource < 0 || comfortSource > 100)))
    throw new RangeError('舒适度或时间步无效');
  const target = comfortSource ?? 0;
  state.comfort = target > state.comfort
    ? Math.min(target, state.comfort + LIVING_RULES.comfortRisePerTick * delta)
    : Math.max(target, state.comfort - LIVING_RULES.comfortFallPerTick * delta);
  state.memories = state.memories.filter(m => m.expires > tick);
}
function remember(state: LivingState, kind: LivingMemoryKind, stage: number, tick: number): void {
  validTick(tick);
  const expires = tick + LIVING_RULES.memoryDuration;
  if (!Number.isSafeInteger(expires)) throw new RangeError('居住记忆时钟溢出');
  if (LIVING_MEMORY_VALUES[kind][stage] === null) return;
  const memory = state.memories.find(m => m.kind === kind);
  if (memory) { memory.stage = stage; memory.expires = expires; }
  else state.memories.push({ kind, stage, expires });
}
/** Completed ingestion only. A table meal does not erase yesterday's no-table
 * memory. Dining quality applies to the room where eating finished, regardless
 * of the room-role label, as in the inspected native ingestion code. */
export function rememberMeal(state: LivingState, room: RoomLivingSummary | null, tick: number,
  hasTable: boolean, tableDesired = true): void {
  validTick(tick);
  if (tableDesired && !hasTable) remember(state, 'ateWithoutTable', 0, tick);
  if (room && !room.outdoor) remember(state, 'diningRoom', room.stage, tick);
}
/** Caller verifies owned nonmedical bed and sufficient actual sleep, then calls
 * at the due tick and on qualified wakeup. Unlike dining, a new sleep replaces
 * previous bedroom/barracks memories even when its room yields no thought. */
export function rememberSleep(state: LivingState, room: RoomLivingSummary | null, tick: number): void {
  validTick(tick);
  if (!Number.isSafeInteger(tick + LIVING_RULES.sleepThoughtInterval)) throw new RangeError('睡眠时钟溢出');
  state.memories = state.memories.filter(m => m.kind !== 'bedroom' && m.kind !== 'barracks');
  if (room && !room.outdoor && (room.role === 'bedroom' || room.role === 'barracks'))
    remember(state, room.role, room.stage, tick);
  state.sleepThoughtAt = tick + LIVING_RULES.sleepThoughtInterval;
}
export function livingThoughts(state: LivingState, tick: number): { label: string; value: number }[] {
  validTick(tick);
  const thoughts: { label: string; value: number }[] = [];
  const comfort = state.comfort;
  if (comfort < 10) thoughts.push({ label: '不太舒服', value: -3 });
  else if (comfort >= 60) thoughts.push(comfort < 70 ? { label: '舒适', value: 4 } :
    comfort < 80 ? { label: '非常舒适', value: 6 } : comfort < 90 ? { label: '极其舒适', value: 8 } : { label: '享尽舒适', value: 10 });
  for (const m of state.memories) {
    if (m.expires <= tick) continue;
    const value = LIVING_MEMORY_VALUES[m.kind][m.stage];
    if (value === null || value === undefined) continue;
    const label = m.kind === 'ateWithoutTable' ? '没有桌子吃饭' :
      `${IMPRESSIVENESS_NAMES[m.stage]}的${m.kind === 'diningRoom' ? '用餐环境' : m.kind === 'bedroom' ? '卧室' : '宿舍'}`;
    thoughts.push({ label, value });
  }
  return thoughts;
}
