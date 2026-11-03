import type { Trauma } from './injuries';
import type { WeaponPiece, WeaponKind, WeaponBenchKind } from './weapons';
import type { SkillSet } from './skills';
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
  Masonry: 7,
  RichSoil: 8,
  Sand: 9,
  Gravel: 10,
} as const;
export type Biome = 'temperate' | 'boreal' | 'desert';
export type Hilliness = 'flat' | 'small' | 'large' | 'mountainous';
export interface WorldSettings {
  biome: Biome;
  hilliness: Hilliness;
  meanTemperature: number;
  rainfall: number;
  latitude: number;
}
export type TreeSpecies = 'poplar' | 'pine' | 'saguaro';
export interface WorldSummary {
  elevation: { min: number; max: number };
  surfaceCounts: { soil: number; richSoil: number; sand: number; gravel: number; stone: number };
  resources: { stone: number; steel: number; components: number };
  trees: { poplar: number; pine: number; saguaro: number; total: number; wood: number };
  /** Terrain potential with crop fertility >= 0.7 and no tree; not reserved building space. */
  fertileCells: number;
  /** Surface heightfield component at spawn, excluding trees; not underground/facility navigation. */
  reachableSurfaceCells: number;
  growingDays: number;
}
export interface WorldPreview {
  generator: 2;
  seed: number;
  settings: WorldSettings;
  spawn: Pos;
  heightMap: Uint8Array;
  surfaceMap: Uint8Array;
  trees: Omit<Tree, 'id'>[];
  summary: WorldSummary;
}
export type Resource =
  | 'wood'
  | 'stone'
  | 'steel'
  | 'components'
  | 'food'
  | 'grain'
  | 'meal'
  | 'chunk'
  | 'cloth'
  | 'apparel'
  | 'weapon';
export type Work = 'dig' | 'build' | 'cut' | 'haul' | 'grow' | 'cook' | 'craft' | 'care';
export type ConstructionMaterial = 'wood' | 'stone';
export type FoodCropKind = 'rice' | 'potato' | 'corn';
export type CropKind = FoodCropKind | 'cotton';
export type ApparelKind = 'tuque' | 'parka' | 'duster' | 'shirt' | 'pants';
export type ApparelQuality = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export interface ApparelPiece {
  id: number;
  kind: ApparelKind;
  material: 'cloth';
  quality: ApparelQuality;
  hitPoints: number;
  /** Actual worn ticks; daily damage is scheduled by the pawn tracker. */
  wearTicks: number;
}
export interface ApparelTask {
  action: 'wear' | 'remove';
  apparelId: number;
  stage: 'fetch' | 'work';
  progress: number;
}
export type Axis = 'x' | 'y';
export type Assignment = 'anything' | 'work' | 'sleep';
export type DeviceKind = 'generator' | 'solar' | 'battery' | 'heater' | 'cooler';
export interface Device extends Pos {
  id: number;
  kind: DeviceKind;
  axis: Axis;
  on: boolean;
  fuel: number;
  energy: number;
  target: number;
  powered: boolean;
  active: boolean;
  networkId: number | null;
  watts: number;
  reason: string;
}
export interface PowerNetwork {
  id: number;
  generatedW: number;
  demandW: number;
  usedW: number;
  storedWd: number;
  capacityWd: number;
  surplusW: number;
  devices: number[];
}
export interface RoomTemperature {
  roomId: number;
  temperature: number;
  capacity: number;
}
export interface SavedTemperature {
  cell: number;
  temperature: number;
}
export const DEVICE_NAMES: Record<DeviceKind, string> = {
  generator: '木燃发电机',
  solar: '太阳能板',
  battery: '蓄电池',
  heater: '加热器',
  cooler: '冷气机',
};
export const DEVICE_SIZES: Record<DeviceKind, [number, number]> = {
  generator: [2, 2],
  solar: [4, 4],
  battery: [1, 2],
  heater: [1, 1],
  cooler: [1, 1],
};
export function deviceCells(d: Pos & { kind: DeviceKind; axis: Axis }): Pos[] {
  const [w, h] = DEVICE_SIZES[d.kind],
    out: Pos[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      out.push({ x: d.x + (d.axis === 'x' ? x : y), y: d.y + (d.axis === 'x' ? y : x), z: d.z });
  return out;
}
export interface Bed extends Pos {
  id: number;
  axis: Axis;
  owner: number | null;
  medical: boolean;
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
  | DeviceKind
  | 'wire'
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
  | 'grove'
  | 'stove'
  | 'stonecutter'
  | 'tailor'
  | 'craftingSpot'
  | 'smithy'
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
export interface Stack extends Pos, Cargo {
  id: number;
}
export interface Tree extends Pos {
  id: number;
  wood: number;
  species: TreeSpecies;
  growth: number;
  age: number;
  planted: boolean;
  health: number;
  unlitTicks: number;
}
export interface TreePlot extends Pos {
  species: TreeSpecies;
}
export interface TreeCondition extends CropCondition {
  id: number;
  yield: number;
  mature: boolean;
  ageDays: number;
}
export interface Cargo {
  resource: Resource;
  amount: number;
  /** Required for grain; rice/potato/corn remain one aggregate inventory resource. */
  crop?: FoodCropKind;
  apparel?: ApparelPiece;
  weapon?: WeaponPiece;
  /** Ground weapon forbidden state; manual equip overrides it. */
  forbidden?: boolean;
  /** Equivalent unfrozen age in our simulation ticks; required for grain/meal. */
  rotProgress?: number;
}
export interface Stockpile extends Pos {
  /** 0 low, 1 normal, 2 preferred, 3 critical. Empty accepts disables storage. */
  priority: number;
  accepts: Resource[];
}
export interface StorageCapacity extends Pos {
  occupied: boolean;
  resource: Resource | null;
  crop: CropKind | null;
  amount: number;
  /** Empty cells have no assigned resource and therefore no single numeric limit. */
  limit: number;
  reserved: number;
  available: Counts;
  availableGrain: Record<FoodCropKind, number>;
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
export interface Stonecutter extends Pos {
  id: number;
  axis: Axis;
  target: number;
  paused: boolean;
}
export function stonecutterCells(bench: Pos & { axis: Axis }): Pos[] {
  return [0, 1, 2].map((n) => ({
    x: bench.x + (bench.axis === 'x' ? n : 0),
    y: bench.y + (bench.axis === 'y' ? n : 0),
    z: bench.z,
  }));
}
/** Anchor is the first footprint cell; two orthogonal orientations in this voxel build. */
export function stonecutterInteraction(bench: Pos & { axis: Axis }): Pos {
  return { x: bench.x + (bench.axis === 'x' ? 1 : -1), y: bench.y + 1, z: bench.z };
}
export interface Tailor extends Pos {
  id: number;
  axis: Axis;
  bills: { kind: ApparelKind; target: number; paused: boolean }[];
}
export const tailorCells = stonecutterCells;
export const tailorInteraction = stonecutterInteraction;
export interface WeaponBench extends Pos {
  id: number;
  kind: WeaponBenchKind;
  axis: Axis;
  fuel: number;
  bills: { kind: WeaponKind; target: number; paused: boolean }[];
}
export const weaponBenchCells = (bench: Pos & { kind: WeaponBenchKind; axis: Axis }): Pos[] =>
  bench.kind === 'craftingSpot'
    ? [{ x: bench.x, y: bench.y, z: bench.z }]
    : stonecutterCells(bench);
export const weaponBenchInteraction = (bench: Pos & { kind: WeaponBenchKind; axis: Axis }): Pos =>
  bench.kind === 'craftingSpot'
    ? { x: bench.x, y: bench.y, z: bench.z }
    : stonecutterInteraction(bench);
export interface WeaponTask {
  action: 'equip' | 'drop';
  weaponId: number;
  stage: 'fetch' | 'work';
  progress: number;
}
export interface CropCondition {
  fertility: number;
  light: number;
  temperature: number;
  growthRate: number;
  reason: string;
}
export type JobKind =
  | DeviceKind
  | 'wire'
  | 'refuel'
  | 'mine'
  | 'cut'
  | 'floor'
  | 'wall'
  | 'ladder'
  | 'digLadder'
  | 'remove'
  | 'sow'
  | 'plantTree'
  | 'harvest'
  | 'stove'
  | 'stonecutter'
  | 'stonecut'
  | 'tailor'
  | 'tailoring'
  | 'craftingSpot'
  | 'smithy'
  | 'smith'
  | 'bed'
  | 'door'
  | 'cook';
export interface Job extends Pos {
  id: number;
  kind: JobKind;
  progress: number;
  work: number;
  /** Actual local work ticks; excludes travel, fuel waits and blocked finished output. */
  workTicks: number;
  /** No unfinished meal entity: defer cooking XP until the meal transaction commits. */
  cookTraining?: { pawnId: number; ticks: number }[];
  /** Mining yield weighted by actual progress contributions, not by the last worker. */
  miningYieldWork?: number;
  /** Harvest outcome is fixed on completion, before attempting physical placement. */
  harvestResult?: { amount: number; skill: number; workerId: number };
  /** First completion locks a quality roll even while physical output is blocked. */
  productQuality?: { value: ApparelQuality; skill: number; workerId: number };
  owner: number | null;
  delivered: Partial<Counts>;
  /** Perishable physical inputs; quantities must match delivered grain/meal. */
  deliveredFood: Cargo[];
  cost: Partial<Counts>;
  reason: string;
  /** Cancelled inputs remain in this finite job container until safely refunded. */
  cancelled: boolean;
  axis?: Axis;
  material?: ConstructionMaterial;
  treeSpecies?: TreeSpecies;
  apparelKind?: ApparelKind;
  weaponKind?: WeaponKind;
  weaponBenchKind?: WeaponBenchKind;
  /** Existing pre-v9 cutting jobs retain their original 60-tick work/progress. */
  legacyCut?: true;
}
export interface SurvivalHealth {
  malnutrition: number;
  hypothermia: number;
  heatstroke: number;
  /** Fixed individual severity rate, sampled once; not rerolled on load. */
  starvationFactor: number;
}
export type CarePhase =
  | 'rescueApproach'
  | 'rescueCarry'
  | 'feedFetch'
  | 'feedApproach'
  | 'feed'
  | 'tendApproach'
  | 'tend';
export interface CombatState {
  enabled: boolean;
  nextRaid: number;
  wave: number;
}
export interface Pawn extends Pos {
  id: number;
  name: string;
  color: number;
  food: number;
  rest: number;
  skills: SkillSet;
  health: SurvivalHealth;
  trauma: Trauma;
  faction: 'colony' | 'raider';
  drafted: boolean;
  retreating: boolean;
  attackTargetId: number | null;
  nextAttackTick: number;
  weapon: WeaponPiece | null;
  weaponTask: WeaponTask | null;
  /** Retain the physical weapon if a forced drop has no space; retry without using it. */
  weaponDropPending: boolean;
  worn: ApparelPiece[];
  apparelTask: ApparelTask | null;
  apparelWearTicks: number;
  downed: boolean;
  dead: boolean;
  deathReason: string | null;
  carriedBy: number | null;
  carryingPawnId: number | null;
  patientId: number | null;
  careBedId: number | null;
  carePhase: CarePhase | null;
  careProgress: number;
  careFoodId: number | null;
  careAmount: number;
  priorities: Record<Work, number>;
  jobId: number | null;
  path: number[];
  destination: number | null;
  phase:
    | 'idle'
    | 'travel'
    | 'work'
    | 'fetch'
    | 'haul'
    | 'rest'
    | 'sleepTravel'
    | 'care'
    | 'apparel'
    | 'combat'
    | 'weapon'
    | 'downed'
    | 'dead';
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
  chunk: number;
  cloth: number;
  apparel: number;
  weapon: number;
}
export interface VoxelStats {
  mined: number;
  cut: number;
  built: number;
  hauled: number;
  sown: number;
  harvested: number;
  cooked: number;
  stonecut: number;
  tailored: number;
  weaponsMade: number;
  destroyed: Counts;
  treesPlanted: number;
  treesRegrown: number;
  treesDied: number;
  eaten: number;
  consumed: Counts;
  produced: Counts;
  spoiled: Counts;
}
export interface VoxelSnapshot {
  combat: CombatState;
  seed: number;
  generator: 1 | 2;
  settings: WorldSettings;
  spawn: Pos;
  worldSummary: WorldSummary;
  tick: number;
  revision: number;
  speed: number;
  pawns: Pawn[];
  items: Stack[];
  trees: Tree[];
  treePlots: TreePlot[];
  treeConditions: (TreeCondition & Pos)[];
  jobs: Job[];
  stockpiles: Stockpile[];
  storageCapacity: StorageCapacity[];
  farms: FarmPlot[];
  crops: Crop[];
  stoves: Stove[];
  stonecutters: Stonecutter[];
  tailors: Tailor[];
  weaponBenches: WeaponBench[];
  beds: Bed[];
  doors: Door[];
  rooms: RoomSummary[];
  roomRevision: number;
  roomBytes: number;
  devices: Device[];
  wires: Pos[];
  networks: PowerNetwork[];
  roomTemperatures: RoomTemperature[];
  thermalBytes: number;
  powerBytes: number;
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
  | { type: 'threats'; enabled: boolean }
  | { type: 'draft'; pawnId: number; drafted: boolean }
  | { type: 'attack'; pawnId: number; targetId: number }
  | { type: 'weaponBill'; benchId: number; kind: WeaponKind; target: number; paused: boolean }
  | { type: 'equipWeapon'; pawnId: number; weaponId: number }
  | { type: 'dropWeapon'; pawnId: number }
  | { type: 'weaponForbidden'; weaponId: number; forbidden: boolean }
  | {
      type: 'storage';
      from: Pos;
      to?: Pos;
      connected?: boolean;
      priority: number;
      accepts: Resource[];
    }
  | { type: 'device'; deviceId: number; on: boolean; target: number }
  | {
      type: 'designate';
      tool: Tool;
      from: Pos;
      to?: Pos;
      crop?: CropKind;
      axis?: Axis;
      material?: ConstructionMaterial;
      treeSpecies?: TreeSpecies;
    }
  | { type: 'priority'; pawnId: number; work: Work; value: number }
  | { type: 'bill'; stoveId: number; target: number; paused: boolean }
  | { type: 'stoneBill'; stonecutterId: number; target: number; paused: boolean }
  | { type: 'tailorBill'; tailorId: number; kind: ApparelKind; target: number; paused: boolean }
  | { type: 'wear'; pawnId: number; apparelId: number }
  | { type: 'removeApparel'; pawnId: number; apparelId: number }
  | { type: 'bedOwner'; bedId: number; pawnId: number | null }
  | { type: 'bedMedical'; bedId: number; medical: boolean }
  | { type: 'care'; pawnId: number; patientId: number; action: 'rescue' | 'feed' | 'tend' }
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
  version: 14;
  combat: CombatState;
  generator: 1 | 2;
  settings: WorldSettings;
  spawn: Pos;
  seed: number;
  tick: number;
  nextId: number;
  // RLE pairs keep terrain compact; separate format never overwrites 2D v1 saves.
  blocks: number[];
  ladders: number[];
  pawns: Pawn[];
  items: Stack[];
  trees: Tree[];
  treePlots: TreePlot[];
  jobs: Job[];
  stockpiles: Stockpile[];
  farms: FarmPlot[];
  crops: Crop[];
  stoves: Stove[];
  stonecutters: Stonecutter[];
  tailors: Tailor[];
  weaponBenches: WeaponBench[];
  beds: Bed[];
  doors: Door[];
  devices: Device[];
  wires: Pos[];
  thermal: SavedTemperature[];
  stats: VoxelStats;
}
export const BLOCK_NAMES = [
  '空气',
  '土层',
  '花岗岩',
  '钢矿',
  '木结构',
  '基岩',
  '机械矿',
  '石砌结构',
  '沃土',
  '沙地',
  '砾石地',
];
export const RESOURCE_NAMES: Record<Resource, string> = {
  wood: '木材',
  stone: '花岗岩砖',
  chunk: '花岗岩块',
  cloth: '布料',
  apparel: '衣物',
  weapon: '武器',
  steel: '钢材',
  components: '零件',
  food: '包装生存口粮',
  grain: '生食材',
  meal: '简餐',
};
export const JOB_NAMES: Record<JobKind, string> = {
  generator: '造发电机',
  solar: '造太阳能板',
  battery: '造蓄电池',
  heater: '造加热器',
  cooler: '造冷气机',
  wire: '铺电线',
  refuel: '补充燃料',
  mine: '挖掘',
  cut: '伐木',
  floor: '铺楼板',
  wall: '造墙',
  ladder: '造梯子',
  digLadder: '开凿梯井',
  remove: '拆除',
  sow: '播种',
  plantTree: '栽种树苗',
  harvest: '收获',
  stove: '造灶台',
  stonecutter: '造切石台',
  stonecut: '切割岩块',
  tailor: '造手工裁缝台',
  tailoring: '缝制衣物',
  craftingSpot: '划定制作点',
  smithy: '造燃料锻造台',
  smith: '制作武器',
  bed: '造床',
  door: '造门',
  cook: '烹饪简餐',
};
export const TOOL_NAMES: Record<Tool, string> = {
  ...DEVICE_NAMES,
  wire: '电线',
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
  grove: '林地区',
  stove: '灶台',
  stonecutter: '切石台',
  tailor: '手工裁缝台',
  craftingSpot: '制作点',
  smithy: '燃料锻造台',
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
  chunk: 0,
  cloth: 0,
  apparel: 0,
  weapon: 0,
});
