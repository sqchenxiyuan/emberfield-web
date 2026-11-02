// Voxel rules are Emberfield designs. See research/10 for source boundaries.
export const WIDTH = 64,
  DEPTH = 64,
  HEIGHT = 16,
  CHUNK = 16,
  SURFACE = 8,
  TPS = 20;
export const CELLS = WIDTH * DEPTH * HEIGHT;
export const Block = {
  Air: 0,
  Soil: 1,
  Stone: 2,
  Steel: 3,
  Wood: 4,
  Bedrock: 5,
  Components: 6,
} as const;
export type Resource = 'wood' | 'stone' | 'steel' | 'components' | 'food';
export type Work = 'dig' | 'build' | 'cut' | 'haul';
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
export type JobKind = 'mine' | 'cut' | 'floor' | 'wall' | 'ladder' | 'digLadder' | 'remove';
export interface Job extends Pos {
  id: number;
  kind: JobKind;
  progress: number;
  work: number;
  owner: number | null;
  delivered: number;
  cost: number;
  reason: string;
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
  phase: 'idle' | 'travel' | 'work' | 'fetch' | 'haul' | 'rest';
  cargo: Cargo | null;
  reason: string;
  moveTick: number;
  workTarget: Pos | null;
}
export interface Counts {
  wood: number;
  stone: number;
  steel: number;
  components: number;
  food: number;
}
export interface VoxelStats {
  mined: number;
  cut: number;
  built: number;
  hauled: number;
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
  | { type: 'designate'; tool: Tool; from: Pos; to?: Pos }
  | { type: 'priority'; pawnId: number; work: Work; value: number }
  | { type: 'move'; pawnId: number; target: Pos };
export interface CommandResult {
  ok: boolean;
  message: string;
  count?: number;
}
export interface VoxelSave {
  format: 'emberfield-voxel';
  version: 1;
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
  stats: VoxelStats;
}
export const BLOCK_NAMES = ['空气', '土层', '花岗岩', '钢矿', '木结构', '基岩', '机械矿'];
export const RESOURCE_NAMES: Record<Resource, string> = {
  wood: '木材',
  stone: '石料',
  steel: '钢材',
  components: '零件',
  food: '口粮',
};
export const JOB_NAMES: Record<JobKind, string> = {
  mine: '挖掘',
  cut: '伐木',
  floor: '铺楼板',
  wall: '造墙',
  ladder: '造梯子',
  digLadder: '开凿梯井',
  remove: '拆除',
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
  remove: '拆除',
  cancel: '取消规划',
};
export const emptyCounts = (): Counts => ({ wood: 0, stone: 0, steel: 0, components: 0, food: 0 });
