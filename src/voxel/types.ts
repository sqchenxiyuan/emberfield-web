// Voxel rules are Emberfield designs. See research/10 for source boundaries.
export const WIDTH = 64,
  DEPTH = 64,
  HEIGHT = 16,
  CHUNK = 16,
  SURFACE = 8,
  TPS = 20;
export const CELLS = WIDTH * DEPTH * HEIGHT;
export const DAY = 12000;
export const Block = {
  Air: 0,
  Soil: 1,
  Stone: 2,
  Steel: 3,
  Wood: 4,
  Bedrock: 5,
  Components: 6,
} as const;
export type Resource = 'wood' | 'stone' | 'steel' | 'components' | 'food' | 'grain' | 'meal';
export type Work = 'dig' | 'build' | 'cut' | 'haul' | 'grow' | 'cook';
export type CropKind = 'rice' | 'potato' | 'corn';
export type Axis = 'x' | 'y';
export type Assignment = 'anything' | 'work' | 'sleep';
export interface Bed extends Pos {
  id: number;
  axis: Axis;
  owner: number | null;
}
export interface Door extends Pos {
  id: number;
  axis: Axis;
  mode: 'auto' | 'open' | 'locked';
  openUntil: number;
}
export const bedCells = (bed: Pos & { axis: Axis }): Pos[] => [
  { x: bed.x, y: bed.y, z: bed.z },
  { x: bed.x + (bed.axis === 'x' ? 1 : 0), y: bed.y + (bed.axis === 'y' ? 1 : 0), z: bed.z },
];
export interface RoomSummary {
  id: number;
  outdoor: boolean;
  volume: number;
  floorCells: number;
  minZ: number;
  maxZ: number;
}
export type Tool =
  | 'inspect'
  | 'mine'
  | 'cut'
  | 'floor'
  | 'wall'
  | 'ladder'
  | 'shaft'
  | 'up'
  | 'stock'
  | 'farm'
  | 'stove'
  | 'bed'
  | 'door'
  | 'clearZone'
  | 'remove'
  | 'cancel';
export interface Pos {
  x: number;
  y: number;
  z: number;
}
export const index = (x: number, y: number, z: number) => (z * DEPTH + y) * WIDTH + x;
export function position(i: number): Pos {
  return { x: i % WIDTH, y: Math.floor(i / WIDTH) % DEPTH, z: Math.floor(i / (WIDTH * DEPTH)) };
}
export const inside = (p: Pos | null | undefined): p is Pos =>
  !!p &&
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  Number.isInteger(p.z) &&
  p.x >= 0 &&
  p.x < WIDTH &&
  p.y >= 0 &&
  p.y < DEPTH &&
  p.z >= 0 &&
  p.z < HEIGHT;
export const at = (p: Pos) => index(p.x, p.y, p.z);
export interface Stack extends Pos {
  id: number;
  resource: Resource;
  amount: number;
}
export interface Tree extends Pos {
  id: number;
  wood: number;
}
export interface Cargo {
  resource: Resource;
  amount: number;
}
export interface FarmPlot extends Pos {
  crop: CropKind;
}
export interface Crop extends Pos {
  id: number;
  kind: CropKind;
  growth: number;
  sownAt: number;
}
export interface Stove extends Pos {
  id: number;
  target: number;
  paused: boolean;
}
export interface CropCondition {
  fertility: number;
  light: number;
  temperature: number;
  growthRate: number;
  reason: string;
}
export type JobKind =
  | 'mine'
  | 'cut'
  | 'floor'
  | 'wall'
  | 'ladder'
  | 'digLadder'
  | 'remove'
  | 'sow'
  | 'harvest'
  | 'stove'
  | 'bed'
  | 'door'
  | 'cook';
export interface Job extends Pos {
  id: number;
  kind: JobKind;
  progress: number;
  work: number;
  owner: number | null;
  delivered: Partial<Counts>;
  cost: Partial<Counts>;
  reason: string;
  axis?: Axis;
}
export interface Pawn extends Pos {
  id: number;
  name: string;
  color: number;
  food: number;
  rest: number;
  priorities: Record<Work, number>;
  jobId: number | null;
  path: number[];
  destination: number | null;
  phase: 'idle' | 'travel' | 'work' | 'fetch' | 'haul' | 'rest' | 'sleepTravel';
  cargo: Cargo | null;
  reason: string;
  moveTick: number;
  workTarget: Pos | null;
  eating: Resource | null;
  sleepBedId: number | null;
  schedule: Assignment[];
  sleepingSince: number | null;
}
export interface Counts {
  wood: number;
  stone: number;
  steel: number;
  components: number;
  food: number;
  grain: number;
  meal: number;
}
export interface VoxelStats {
  mined: number;
  cut: number;
  built: number;
  hauled: number;
  sown: number;
  harvested: number;
  cooked: number;
  eaten: number;
  consumed: Counts;
  produced: Counts;
}
export interface VoxelSnapshot {
  seed: number;
  tick: number;
  revision: number;
  speed: number;
  pawns: Pawn[];
  items: Stack[];
  trees: Tree[];
  jobs: Job[];
  stockpiles: Pos[];
  farms: FarmPlot[];
  crops: Crop[];
  stoves: Stove[];
  beds: Bed[];
  doors: Door[];
  rooms: RoomSummary[];
  roomRevision: number;
  roomBytes: number;
  cropConditions: (CropCondition & Pos)[];
  hour: number;
  temperature: number;
  inventory: Counts;
  stored: Counts;
  stats: VoxelStats;
  notice: string;
  gridBytes: number;
  navigationBytes: number;
  tickMs: number;
}
export interface ChunkUpdate {
  id: number;
  blocks: Uint8Array;
  ladders: Uint8Array;
}
export type VoxelCommand =
  | { type: 'designate'; tool: Tool; from: Pos; to?: Pos; crop?: CropKind; axis?: Axis }
  | { type: 'priority'; pawnId: number; work: Work; value: number }
  | { type: 'bill'; stoveId: number; target: number; paused: boolean }
  | { type: 'bedOwner'; bedId: number; pawnId: number | null }
  | { type: 'door'; doorId: number; mode: Door['mode'] }
  | { type: 'schedule'; pawnId: number; hour: number; assignment: Assignment }
  | { type: 'rest'; pawnId: number }
  | { type: 'move'; pawnId: number; target: Pos };
export interface CommandResult {
  ok: boolean;
  message: string;
  count?: number;
}
export interface VoxelSave {
  format: 'emberfield-voxel';
  version: 3;
  generator: 1;
  seed: number;
  tick: number;
  nextId: number;
  // RLE pairs keep terrain compact; separate format never overwrites 2D v1 saves.
  blocks: number[];
  ladders: number[];
  pawns: Pawn[];
  items: Stack[];
  trees: Tree[];
  jobs: Job[];
  stockpiles: Pos[];
  farms: FarmPlot[];
  crops: Crop[];
  stoves: Stove[];
  beds: Bed[];
  doors: Door[];
  stats: VoxelStats;
}
export const BLOCK_NAMES = ['空气', '土层', '花岗岩', '钢矿', '木结构', '基岩', '机械矿'];
export const RESOURCE_NAMES: Record<Resource, string> = {
  wood: '木材',
  stone: '石料',
  steel: '钢材',
  components: '零件',
  food: '口粮',
  grain: '生食材',
  meal: '简餐',
};
export const JOB_NAMES: Record<JobKind, string> = {
  mine: '挖掘',
  cut: '伐木',
  floor: '铺楼板',
  wall: '造墙',
  ladder: '造梯子',
  digLadder: '开凿梯井',
  remove: '拆除',
  sow: '播种',
  harvest: '收获',
  stove: '造灶台',
  bed: '造床',
  door: '造门',
  cook: '烹饪简餐',
};
export const TOOL_NAMES: Record<Tool, string> = {
  inspect: '查看',
  mine: '挖掘',
  cut: '伐木',
  floor: '楼板',
  wall: '墙壁',
  ladder: '梯子',
  shaft: '下挖梯井',
  up: '向上搭梯',
  stock: '仓储',
  farm: '种植区',
  stove: '灶台',
  bed: '床',
  door: '门',
  clearZone: '擦除区域',
  remove: '拆除',
  cancel: '取消规划',
};
export const emptyCounts = (): Counts => ({
  wood: 0,
  stone: 0,
  steel: 0,
  components: 0,
  food: 0,
  grain: 0,
  meal: 0,
});
