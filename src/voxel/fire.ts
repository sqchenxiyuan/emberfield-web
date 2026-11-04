import { tableCells, LIVING_BUILDINGS } from './living';
import { PEN_BUILDINGS } from './pens';
import { SHELF_DEFS, isShelfKind, shelfCells } from './shelves';
import { DAY, CELLS, HEIGHT, at, inside, bedCells, deviceCells, stonecutterCells, tailorCells,
  weaponBenchCells, researchBenchCells, type Pos, type VoxelSave } from './types';

export type FireSource = 'lightning' | 'shortCircuit' | 'spread';
export interface Fire extends Pos {
  id: number; size: number; startedTick: number; nextDamageTick: number; nextSpreadTick: number; source: FireSource;
}
export type BurnTargetKind = 'shelf' | 'smallShelf' | 'table' | 'chair' | 'block' | 'ladder' | 'bed' | 'door' | 'stove' | 'stonecutter' |
  'tailor' | 'weaponBench' | 'researchBench' | 'horseshoePin' | 'butcherSpot' | 'device' | 'wire' | 'fence' | 'fenceGate' | 'penMarker';
export interface FireDamage extends Pos {
  key: string; kind: BurnTargetKind; targetId: number | null; hitPoints: number; maxHitPoints: number;
}
export interface FirefightTask { fireId: number; progress: number }
export interface RepairTask { damageKey: string; progress: number }
export interface FireEvent { tick: number; source: 'lightning' | 'shortCircuit'; outcome: 'ignited' | 'skipped'; position: Pos | null; networkId: number | null; reason: string }
export interface FireHazards { enabled: boolean; epoch: number; cycle: number; nextIncidentTick: number; events: FireEvent[] }
export interface FireLogEntry { tick: number; type: 'ignited' | 'extinguished' | 'destroyed' | 'fell' | 'failed'; position: Pos; message: string }

/** Provisional Web tuning. Entity growth, physical fuel loss, touch beating,
 * persistent damage and material-free repair follow researched mechanisms. */
export const FIRE_RULES = {
  maxFires: 256, maxDamage: CELLS + 4096, maxLog: 64, maxEvents: 32,
  minSize: .1, maxSize: 1.75, initialSize: .6, growth: .06,
  damageInterval: 30, spreadInterval: 60, spreadSize: 1, spreadChance: .4,
  damagePerSize: 6, heatPerSecond: 180,
  beatWork: 60, beatReduction: .32, repairPointWork: 20,
  firstIncidentDelay: DAY * 2, incidentInterval: DAY * 2, incidentJitter: DAY / 2,
} as const;
export const FIRE_MAX_HP: Readonly<Record<BurnTargetKind, number>> = {
  shelf: SHELF_DEFS.shelf.maxHitPoints, smallShelf: SHELF_DEFS.smallShelf.maxHitPoints,
  table: LIVING_BUILDINGS.table.maxHitPoints, chair: LIVING_BUILDINGS.chair.maxHitPoints,
  block: 100, ladder: 60, bed: 100, door: 120, stove: 120, stonecutter: 140,
  tailor: 120, weaponBench: 160, researchBench: 140, horseshoePin: 80, butcherSpot: 60,
  device: 150, wire: 40,
  fence:PEN_BUILDINGS.fence.maxHitPoints, fenceGate:PEN_BUILDINGS.fenceGate.maxHitPoints, penMarker:PEN_BUILDINGS.penMarker.maxHitPoints,
};
export const FIRE_TARGET_NAMES: Readonly<Record<BurnTargetKind, string>> = {
  shelf: '货架', smallShelf: '小货架',
  table: '餐桌', chair: '餐椅',
  block: '木结构', ladder: '木梯', bed: '床', door: '木门', stove: '灶台', stonecutter: '切石台',
  tailor: '裁缝台', weaponBench: '武器工作台', researchBench: '研究台', horseshoePin: '马蹄铁桩',
  butcherSpot: '屠宰点', device: '电力设备', wire: '电线', fence:'木围栏', fenceGate:'栏门', penMarker:'圈地标记',
};
export function fireRandom(seed: number, identity: number, tick: number, stream = 0): number {
  let h = Math.imul(seed ^ identity, 0x45d9f3b) ^ Math.imul(tick, 0x27d4eb2d) ^ Math.imul(stream + 41, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function nextFireIncident(seed: number, epoch: number, cycle: number): number {
  return epoch + FIRE_RULES.firstIncidentDelay + cycle * FIRE_RULES.incidentInterval +
    Math.floor(fireRandom(seed, cycle, epoch, 1) * FIRE_RULES.incidentJitter);
}
export function initialFireHazards(seed: number, tick = 0): FireHazards {
  return { enabled: true, epoch: tick, cycle: 0, nextIncidentTick: nextFireIncident(seed, tick, 0), events: [] };
}
export function makeFire(id: number, pos: Pos, tick: number, source: FireSource, size: number = FIRE_RULES.initialSize): Fire {
  if (!Number.isSafeInteger(id) || id < 1 || !inside(pos) || !Number.isSafeInteger(tick) || tick < 0 ||
      !Number.isFinite(size) || size < FIRE_RULES.minSize || size > FIRE_RULES.maxSize ||
      !['lightning', 'shortCircuit', 'spread'].includes(source)) throw new RangeError('火焰参数无效');
  return { id, x: pos.x, y: pos.y, z: pos.z, size, source, startedTick: tick,
    nextDamageTick: tick + FIRE_RULES.damageInterval, nextSpreadTick: tick + FIRE_RULES.spreadInterval };
}
export function fireDamageKey(kind: BurnTargetKind, targetId: number | null, pos: Pos): string {
  return `${kind}:${targetId ?? at(pos)}`;
}
type FireGeometry = Pick<VoxelSave, 'shelves' | 'tables' | 'chairs' | 'beds' | 'doors' | 'stoves' | 'stonecutters' | 'tailors' | 'weaponBenches' |
  'researchBenches' | 'horseshoePins' | 'butcherSpots' | 'devices'>;
/** Shared by simulation and UI; no inferred floor/wall identity is necessary. */
export function fireDamageCells(d: FireDamage, geometry: FireGeometry): Pos[] {
  if (isShelfKind(d.kind)) { const s = geometry.shelves.find(s => s.id === d.targetId); if (s) return shelfCells(s); }
  if (d.kind === 'table') { const t = geometry.tables.find(t => t.id === d.targetId); if (t) return tableCells(t); }
  if (d.kind === 'bed') { const b = geometry.beds.find(b => b.id === d.targetId); if (b) return bedCells(b); }
  if (d.kind === 'door') return [d, { x: d.x, y: d.y, z: d.z + 1 }].filter(inside);
  if (d.kind === 'device') { const b = geometry.devices.find(b => b.id === d.targetId); if (b) return deviceCells(b); }
  if (d.kind === 'stonecutter') { const b = geometry.stonecutters.find(b => b.id === d.targetId); if (b) return stonecutterCells(b); }
  if (d.kind === 'tailor') { const b = geometry.tailors.find(b => b.id === d.targetId); if (b) return tailorCells(b); }
  if (d.kind === 'weaponBench') { const b = geometry.weaponBenches.find(b => b.id === d.targetId); if (b) return weaponBenchCells(b); }
  if (d.kind === 'researchBench') { const b = geometry.researchBenches.find(b => b.id === d.targetId); if (b) return researchBenchCells(b); }
  return [{ x: d.x, y: d.y, z: d.z }];
}
export function fireDamageHomeCells(d: FireDamage, geometry: FireGeometry): Pos[] {
  const cells = fireDamageCells(d, geometry);
  return d.kind === 'block' && d.z + 1 < HEIGHT ? [...cells, { x: d.x, y: d.y, z: d.z + 1 }] : cells;
}
export function fireDamageBurning(d: FireDamage, fires: readonly Fire[], geometry: FireGeometry): boolean {
  const cells = new Set(fireDamageHomeCells(d, geometry).map(at));
  return fires.some(f => cells.has(at(f)));
}
