import type { EggBox, EggBoxTask } from './eggBoxes';
import type { AnimalMedicalState, AnimalCareTask, AnimalBed } from './animalMedical';
import type { AnimalEnvironmentState } from './animalEnvironment';
import type { ApparelControl, ApparelPoliciesState, ApparelPolicy } from './apparelPolicies';
import type { FoodPoliciesState, FoodPolicy, FoodResource } from './foodPolicies';
import type { PrisonFoodTask } from './prisonFood';
import type { Trauma } from './injuries';
import type { MedicalState, MedicalPolicy } from './medicine';
import type { WeaponPiece, WeaponKind, WeaponBenchKind } from './weapons';
import type { SkillSet } from './skills';
import type { ResearchKey, ResearchState } from './research';
import type { Difficulty, StorytellerState, StorytellerView } from './storyteller';
import type { TradeCommand, TradeState, TradeView } from './tradeTypes';
import type { Psyche } from './mood';
import type { SocialState, SocialIdentity, SocialEvent } from './social';
import type { DiningTable, DiningChair, LivingState, RoomLivingSummary } from './living';
import type { RelocatableKind, Shelf, ShelfKind, StorageSettings, StorageSpill } from './shelves';
import type { StorageGroup } from './storageGroups';
import type { WorldSite } from './regions';
import type { PrisonerState, PrisonerPolicy, WardenTask } from './prisoners';
import type { Filth, CleanTask, FoodPoisoning, RoomCleanliness, CookingOutcome } from './sanitation';
import type { Fire, FireDamage, FireHazards, FireLogEntry, FirefightTask, RepairTask } from './fire';
import type { WeatherState, WeatherView, SnowCover } from './weather';
import type { EnvironmentView } from './environment';
import type { Fence, FenceGate, PenMarker, AnimalArea, PenSummary, RopeTask } from './pens';
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
  river?: 'none' | 'creek' | 'river';
  biome: Biome;
  hilliness: Hilliness;
  meanTemperature: number;
  rainfall: number;
  latitude: number;
}
export type TreeSpecies = 'poplar' | 'pine' | 'saguaro';
export interface WorldSummary {
  water?: { shallow: number; deep: number; bridgeable: number };
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
  generator: 2 | 3 | 4;
  waterMap: Uint8Array;
  seed: number;
  settings: WorldSettings;
  spawn: Pos;
  heightMap: Uint8Array;
  surfaceMap: Uint8Array;
  trees: Omit<Tree, 'id'>[];
  summary: WorldSummary;
}
export type Resource =
  | 'silver'
  | 'wood'
  | 'stone'
  | 'steel'
  | 'components'
  | 'food'
  | 'grain'
  | 'meat'
  | 'milk'
  | 'eggUnfertilized'
  | 'eggFertilized'
  | 'carcass'
  | 'meal'
  | 'chunk'
  | 'cloth'
  | 'alpacaWool'
  | 'herb'
  | 'apparel'
  | 'weapon'
  | 'furniture'
  | 'unfinished';
export type Work =
  | 'handle'
  | 'firefight'
  | 'clean'
  | 'warden'
  | 'hunt'
  | 'dig'
  | 'build'
  | 'cut'
  | 'haul'
  | 'grow'
  | 'cook'
  | 'craft'
  | 'care'
  | 'research';
export type ConstructionMaterial = 'wood' | 'stone';
export type FoodCropKind = 'rice' | 'potato' | 'corn';
export type CropKind = FoodCropKind | 'cotton' | 'healroot';
export type ArmorKind = 'simpleHelmet' | 'plateArmor';
export type ApparelKind = 'tuque' | 'parka' | 'duster' | 'shirt' | 'pants' | ArmorKind;
export type ApparelQuality = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** Stable inner building identity survives every ground/carry/install container.
 * Bed owner is only a recovery candidate; packed beds have no active occupant. */
export type FurniturePiece = {
  id: number;
  hitPoints: number;
  axis: Axis;
} & (({ quality: ApparelQuality } & ({ kind: 'bed'; owner: number | null } | { kind: 'table'; gathering: boolean } | { kind: 'chair' })) |
  { kind: ShelfKind; settings: StorageSettings });
export interface ApparelPiece {
  id: number;
  kind: ApparelKind;
  material: 'cloth' | 'alpacaWool' | 'steel';
  quality: ApparelQuality;
  hitPoints: number;
  /** Actual worn ticks; daily damage is scheduled by the pawn tracker. */
  wearTicks: number;
}
export interface ApparelTask {
  automatic?: true;
  action: 'wear' | 'remove';
  apparelId: number;
  stage: 'fetch' | 'work';
  progress: number;
}
export type Axis = 'x' | 'y';
export type Assignment = 'anything' | 'work' | 'sleep' | 'recreation';
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
/** A physical workbench load; its id and position are the owning bench's. */
export interface WorkbenchPower extends Pos {
  id: number;
  kind: 'workbench';
  consumption: number;
  on: boolean;
  powered: boolean;
  active: boolean;
  networkId: number | null;
  watts: number;
  reason: string;
}
export interface Sandbag extends Pos {
  id: number;
  hitPoints: number;
}
export interface ShootingState {
  weaponId: number;
  targetId: number;
  phase: 'aim' | 'burst';
  startedTick: number;
  nextShotTick: number;
  shotsLeft: number;
  origin: Pos;
}
export interface Projectile {
  id: number;
  shooterId: number;
  shooterFaction: 'colony' | 'raider' | 'trader';
  quality: number;
  targetId: number;
  kind: 'shortBow' | 'revolver' | 'machinePistol';
  from: Pos;
  destination: Pos;
  launchedTick: number;
  impactTick: number;
  damage: number;
  armorPenetration: number;
  canHitIntended: boolean;
  canHitOthers: boolean;
  canHitWorld: boolean;
  coverId: number | null;
  postureImpactChance: number;
}
export interface CombatEvent extends Pos {
  tick: number;
  shooterId: number;
  targetId: number | null;
  kind: 'fire' | 'hit' | 'miss' | 'cover' | 'terrain' | 'deflect';
  damage: number;
  message: string;
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
  quality: ApparelQuality;
  prisoner: boolean;
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
  | 'animalBed'
  | 'forbidItems'
  | 'allowItems'
  | 'bridge'
  | ShelfKind
  | 'table'
  | 'chair'
  | 'fence'
  | 'fenceGate'
  | 'penMarker'
  | 'animalArea'
  | 'eggBox'
  | 'horseshoePin'
  | 'butcherSpot'
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
  | 'machining'
  | 'sandbag'
  | 'researchBench'
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
  /** Ordinary item's HP; omitted means full. Equipment owns HP on its instance. */
  hitPoints?: number;
  /** Required for grain; rice/potato/corn remain one aggregate inventory resource. */
  crop?: FoodCropKind;
  apparel?: ApparelPiece;
  weapon?: WeaponPiece;
  furniture?: FurniturePiece;
  unfinished?: UnfinishedPiece;
  carcass?: { animalId: number; species: AnimalSpecies; bodySize?: number };
  /** One fertilized stack shares its incubation state; physical splits copy it. */
  hatcher?: { progress: number; temperatureDamage: number; motherId: number | null; fatherId: number | null; faction: 'wild' | 'colony' };
  /** Player prohibition for physical items; specific direct orders may allow them. */
  forbidden?: boolean;
  /** Equivalent unfrozen age in our simulation ticks; required for grain/meal. */
  rotProgress?: number;
  /** Hidden contaminated fraction. Missing means safe; only cooked meals carry it. */
  poisonChance?: number;
}
/** One physical unfinished object keeps its identity across ground and carried
 * containers. Jobs only reference id; the actual inputs belong to this object. */
export interface UnfinishedPiece {
  id: number;
  recipe: import('./productionBills').ProductionRecipe;
  creatorId: number;
  creatorName: string;
  boundBillId: string | null;
  workTotal: number;
  progress: number;
  workTicks: number;
  ingredients: Cargo[];
  policy: import('./productionPolicies').ProductionPolicy;
  productQuality?: Job['productQuality'];
}
export interface Stockpile extends Pos {
  /** 0 low, 1 normal, 2 preferred, 3 critical. Empty accepts disables storage. */
  priority: number;
  accepts: Resource[];
}
export interface StorageCapacity extends Pos {
  provider: 'stockpile' | 'shelf'; shelfId: number | null;
  maxStacks: number; occupiedSlots: number; reservedSlots: number;
  stacks: { id: number; resource: Resource; amount: number; limit: number }[];
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
export type AnimalSpecies = 'hare' | 'deer' | 'dromedary' | 'alpaca' | 'chicken';
export interface GrassPatch extends Pos { growth: number }
export interface AnimalGoal { kind: 'grass' | 'crop' | 'food' | 'mate' | 'area' | 'exit' | 'layEgg' | 'layEggBox' | 'caravan' | 'shelter' | 'climateExit'; id: number }
export interface HandleTask {
  animalId: number;
  action: 'tame' | 'maintain' | 'feed' | 'slaughter' | 'autoSlaughter' | 'release' | 'milk' | 'shear';
  stage: 'fetch' | 'approach' | 'interact';
  foodId: number | null;
  amount: number;
  feedings: number;
  progress: number;
}
export interface HusbandryEvent {
  tick: number;
  kind: 'tame' | 'failed' | 'fed' | 'pregnancy' | 'birth' | 'miscarriage' | 'rewild' | 'slaughter' | 'release' | 'starved' | 'escaped' | 'milked' | 'milkFailed' | 'sheared' | 'shearFailed' | 'fertilized' | 'laidEgg' | 'hatched';
  animalId: number;
  otherId: number | null;
  message: string;
}
/** Wildlife uses its own small state machine, separate from human anatomy. */
export interface WildAnimal extends Pos {
  medical: AnimalMedicalState;
  environment: AnimalEnvironmentState;
  allowedAreaId: number | null;
  ropePaused: boolean;
  requestedPenId: number | null;
  nextRoamTick: number;
  faction: 'wild' | 'colony' | 'trader';
  sex: 'male' | 'female';
  ageTicks: number;
  growth: number;
  tame: boolean;
  slaughter: boolean;
  releaseMarked: boolean;
  malnutrition: number;
  milkFullness: number;
  woolGrowth: number;
  eggProgress: number;
  fertilizationCount: number;
  eggFatherId: number | null;
  layProgress: number;
  pregnancy: { fatherId: number; progress: number } | null;
  mateId: number | null;
  mateProgress: number;
  nextMateTick: number;
  tameness: number;
  nextTamenessDecayTick: number;
  nextInteractionTick: number;
  path: number[];
  goal: AnimalGoal | null;
  eatProgress: number;
  reason: string;
  id: number;
  species: AnimalSpecies;
  name: string;
  health: number;
  hunger: number;
  dead: boolean;
  phase: 'roam' | 'graze' | 'rest' | 'flee' | 'dead' | 'eat' | 'mate' | 'interact' | 'rope' | 'layEgg' | 'downed' | 'medicalRest' | 'carried' | 'shelter';
  hunt: boolean;
  moveTick: number;
  decisionTick: number;
  fleeUntil: number;
  threatId: number | null;
  retryTick: number;
  rotProgress: number;
  /** Dead animal's physical carcass HP, inherited when placed as a Cargo. */
  carcassHitPoints?: number;
}
export interface ButcherSpot extends Pos {
  id: number;
  paused: boolean;
}
export interface HorseshoePin extends Pos { id: number }
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
export interface ResearchBench extends Pos {
  id: number;
  axis: Axis;
}
/** Native 3x2 footprint, represented by a corner anchor and two orientations. */
export function researchBenchCells(bench: Pos & { axis: Axis }): Pos[] {
  return Array.from({ length: 6 }, (_, i) => {
    const x = i % 3,
      y = Math.floor(i / 3);
    return {
      x: bench.x + (bench.axis === 'x' ? x : y),
      y: bench.y + (bench.axis === 'x' ? y : x),
      z: bench.z,
    };
  });
}
export function researchBenchInteraction(bench: Pos & { axis: Axis }): Pos {
  return {
    x: bench.x + (bench.axis === 'x' ? 1 : -1),
    y: bench.y + (bench.axis === 'x' ? 2 : 1),
    z: bench.z,
  };
}
export interface WeaponBench extends Pos {
  id: number;
  kind: WeaponBenchKind;
  axis: Axis;
  fuel: number;
  bills: { kind: WeaponKind; target: number; paused: boolean }[];
  armorBills: { kind: ArmorKind; target: number; paused: boolean }[];
  power?: WorkbenchPower;
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
  | 'bridge'
  | ShelfKind
  | 'uninstall'
  | 'install'
  | 'table'
  | 'chair'
  | 'fence'
  | 'fenceGate'
  | 'penMarker'
  | 'eggBox'
  | 'horseshoePin'
  | 'butcherSpot'
  | 'butcher'
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
  | 'machining'
  | 'sandbag'
  | 'smith'
  | 'armorsmith'
  | 'researchBench'
  | 'research'
  | 'bed'
  | 'door'
  | 'cook';
export interface Job extends Pos {
  /** Failed work keeps only surviving physical inputs until they can be placed. */
  constructionFailure?: import('./construction').ConstructionFailure;
  /** Reference to one items/pawn.cargo unfinished object, never another copy. */
  unfinishedId?: number;
  /** Stable production order identity; absent only for migrated legacy jobs. */
  billId?: string;
  /** Ingredient rules selected when this physical batch was first claimed. */
  productionPolicy?: import('./productionPolicies').ProductionPolicy;
  /** Independent settings before construction, overridden while linked. */
  storageSettings?: StorageSettings;
  cookingOutcome?: CookingOutcome;
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
  deliveredBatches: Cargo[];
  cost: Partial<Counts>;
  reason: string;
  /** Cancelled inputs remain in this finite job container until safely refunded. */
  cancelled: boolean;
  axis?: Axis;
  material?: ConstructionMaterial;
  treeSpecies?: TreeSpecies;
  /** Crop identity fixes per-crop work even after a zone is changed or removed. */
  cropKind?: CropKind;
  apparelKind?: ApparelKind;
  weaponKind?: WeaponKind;
  weaponBenchKind?: WeaponBenchKind;
  researchProject?: ResearchKey;
  /** Exact existing furniture identity, never a generic interchangeable material. */
  furnitureId?: number;
  furnitureKind?: RelocatableKind;
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
  | 'tendFetch'
  | 'tendApproach'
  | 'tend';
export interface CombatState {
  enabled: boolean;
  nextRaid: number;
  wave: number;
}
export interface Pawn extends Pos {
  prisonFoodTask?: PrisonFoodTask;
  animalCareTask?: AnimalCareTask;
  eggBoxTask?: EggBoxTask;
  allowedAreaId: number | null;
  productionDelivery?: import('./productionOutput').ProductionDelivery;
  social: SocialState;
  living: LivingState;
  ropeTask: RopeTask | null;
  handleTask: HandleTask | null;
  firefightTask: FirefightTask | null;
  repairTask: RepairTask | null;
  cleanTask: CleanTask | null;
  dirtCarry: number;
  foodPoisoning: FoodPoisoning | null;
  prisoner: PrisonerState | null;
  wardenTask: WardenTask | null;
  psyche: Psyche;
  id: number;
  name: string;
  color: number;
  food: number;
  rest: number;
  skills: SkillSet;
  health: SurvivalHealth;
  trauma: Trauma;
  medical: MedicalState;
  faction: 'colony' | 'raider' | 'trader' | 'prisoner';
  drafted: boolean;
  retreating: boolean;
  attackTargetId: number | null;
  nextAttackTick: number;
  shooting: ShootingState | null;
  staggerUntil: number;
  weapon: WeaponPiece | null;
  weaponTask: WeaponTask | null;
  /** Retain the physical weapon if a forced drop has no space; retry without using it. */
  weaponDropPending: boolean;
  worn: ApparelPiece[];
  apparelControl: ApparelControl;
  /** Null retains unrestricted eating independently of shared policies. */
  foodPolicyId: number | null;
  /** Explicit player ingestion order; retain original stack identity after pickup. */
  manualFoodOrder?: { sourceId: number; resource: FoodResource };
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
  careMedicineId: number | null;
  careAmount: number;
  priorities: Record<Work, number>;
  jobId: number | null;
  path: number[];
  destination: number | null;
  phase:
    | 'prisonFood'
    | 'animalCare'
    | 'eggBox'
    | 'dine'
    | 'rope'
    | 'handle'
    | 'firefight'
    | 'repair'
    | 'clean'
    | 'warden'
    | 'prisoner'
    | 'recreation'
    | 'mental'
    | 'hunt'
    | 'trade'
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
  silver: number;
  wood: number;
  stone: number;
  steel: number;
  components: number;
  food: number;
  grain: number;
  meat: number;
  milk: number;
  eggUnfertilized: number;
  eggFertilized: number;
  carcass: number;
  meal: number;
  chunk: number;
  cloth: number;
  alpacaWool: number;
  herb: number;
  apparel: number;
  weapon: number;
  furniture: number;
  unfinished: number;
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
  foodPolicies: FoodPoliciesState;
  apparelPolicies: ApparelPoliciesState;
  animalBeds: AnimalBed[];
  autoSlaughter: import('./autoSlaughter').AutoSlaughterSettings;
  autoSlaughterStatus: import('./autoSlaughter').AutoSlaughterStatus;
  /** Derived geometry for damaged typed walls; no dense world array in snapshots. */
  wallDamageKeys: string[];
  stockpileZones: import('./stockpileZones').StockpileZone[];
  productionQueues: import('./productionBills').ProductionQueue[];
  socialHistory: SocialIdentity[];
  socialLog: SocialEvent[];
  tables: DiningTable[];
  chairs: DiningChair[];
  roomLiving: RoomLivingSummary[];
  fences: Fence[];
  fenceGates: FenceGate[];
  penMarkers: PenMarker[];
  animalAreas: AnimalArea[];
  penSummaries: PenSummary[];
  grass: GrassPatch[];
  husbandryLog: HusbandryEvent[];
  environment: EnvironmentView;
  weather: WeatherView;
  snow: SnowCover[];
  weatherRoof: Uint8Array;
  weatherBytes: number;
  fires: Fire[];
  fireDamage: FireDamage[];
  fireHazards: FireHazards;
  autoRebuild: boolean;
  fireLog: FireLogEntry[];
  filth: Filth[];
  roomCleanliness: RoomCleanliness[];
  eggBoxes: EggBox[];
  horseshoePins: HorseshoePin[];
  animals: WildAnimal[];
  butcherSpots: ButcherSpot[];
  trade: TradeView;
  homeArea: number[];
  combat: CombatState;
  storyteller: StorytellerView;
  projectiles: Projectile[];
  combatEvents: CombatEvent[];
  sandbags: Sandbag[];
  seed: number;
  generator: 1 | 2 | 3 | 4;
  exploration: { known: number; total: number };
  worldSite: WorldSite | null;
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
  shelves: Shelf[];
  storageGroups: StorageGroup[];
  storageSpills: StorageSpill[];
  farms: FarmPlot[];
  crops: Crop[];
  stoves: Stove[];
  stonecutters: Stonecutter[];
  tailors: Tailor[];
  weaponBenches: WeaponBench[];
  researchBenches: ResearchBench[];
  research: ResearchState;
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
  water?: Uint8Array;
  bridges?: Uint8Array;
  id: number;
  blocks: Uint8Array;
  ladders: Uint8Array;
  explored: Uint8Array;
}
export type VoxelCommand =
  | { type: 'animalMedicalPolicy'; animalId: number; policy: MedicalPolicy }
  | { type: 'animalRescue'; animalId: number; enabled: boolean }
  | { type: 'animalCare'; pawnId: number; animalId: number; action: 'rescue' | 'tend' | 'feed' }
  | { type: 'animalBedRemove'; bedId: number }
  | { type: 'eggBoxEmpty'; boxId: number; enabled: boolean }
  | { type: 'eggBoxForbid'; boxId: number; forbidden: boolean }
  | { type: 'itemForbidden'; itemId: number; forbidden: boolean }
  | { type: 'itemForbiddenArea'; from: Pos; to?: Pos; forbidden: boolean }
  | { type: 'productionBillAdd'; benchId: number; recipe: import('./productionBills').ProductionRecipe }
  | { type: 'productionBillUpdate'; benchId: number; billId: string; patch: Partial<Pick<import('./productionBills').ProductionBill, 'mode' | 'remaining' | 'target' | 'suspended' | 'pauseWhenSatisfied' | 'resumeBelow' | 'policy' | 'output'>> }
  | { type: 'stockpileZoneRename'; zoneId: string; name: string }
  | { type: 'productionBillMove'; benchId: number; billId: string; direction: -1 | 1 }
  | { type: 'productionBillDelete'; benchId: number; billId: string }
  | { type: 'unfinishedCancel'; unfinishedId: number }
  | { type: 'unfinishedForbid'; unfinishedId: number; forbidden: boolean }
  | { type: 'shelfStorage'; shelfId: number; priority: number; accepts: Resource[] }
  | { type: 'shelfLink'; sourceId: number; memberIds: number[] }
  | { type: 'shelfUnlink'; shelfId: number }
  | { type: 'shelfGroupRename'; groupId: number; name: string }
  | { type: 'uninstallFurniture'; kind: RelocatableKind; furnitureId: number }
  | { type: 'installFurniture'; kind: RelocatableKind; furnitureId: number; target: Pos; axis: Axis }
  | { type: 'cancelFurnitureMove'; furnitureId: number }
  | { type: 'tableGathering'; tableId: number; enabled: boolean }
  | { type: 'fenceGate'; gateId: number; mode: FenceGate['mode'] }
  | { type: 'penFilter'; markerId: number; filter: PenMarker['filter'] }
  | { type: 'penName'; markerId: number; name: string }
  | { type: 'ropeAnimal'; animalId: number; penId: number | null; paused: boolean }
  | { type: 'animalAreaCreate'; name: string }
  | { type: 'allowedAreaCreate'; name: string }
  | { type: 'allowedAreaRename'; areaId: number; name: string }
  | { type: 'allowedAreaDelete'; areaId: number }
  | { type: 'allowedAreaPaint'; areaId: number; from: Pos; to?: Pos; erase: boolean }
  | { type: 'pawnAreaAssign'; pawnId: number; areaId: number | null }
  | { type: 'animalAreaRename'; areaId: number; name: string }
  | { type: 'animalAreaDelete'; areaId: number }
  | { type: 'animalAreaPaint'; areaId: number; from: Pos; to?: Pos; erase: boolean }
  | { type: 'animalAreaAssign'; animalId: number; areaId: number | null }
  | { type: 'animalOrder'; animalId: number; order: 'tame' | 'slaughter' | 'release'; enabled: boolean }
  | { type: 'autoSlaughter'; species: AnimalSpecies; policy: import('./autoSlaughter').AutoSlaughterPolicy }
  | { type: 'firefight'; pawnId: number; fireId: number }
  | { type: 'cancelFirefight'; pawnId: number }
  | { type: 'repair'; pawnId: number; damageKey: string }
  | { type: 'cancelRepair'; pawnId: number }
  | { type: 'fireHazards'; enabled: boolean }
  | { type: 'autoRebuild'; enabled: boolean }
  | { type: 'clean'; pawnId: number; filthId: number }
  | { type: 'cancelClean'; pawnId: number }
  | { type: 'bedPrisoner'; bedId: number; prisoner: boolean }
  | { type: 'capture'; pawnId: number; targetId: number }
  | { type: 'prisonerPolicy'; prisonerId: number; policy: PrisonerPolicy }
  | { type: 'recreate'; pawnId: number; kind?: 'walk' | 'horseshoes' | 'social' }
  | { type: 'cancelRecreation'; pawnId: number }
  | { type: 'hunt'; animalId: number; enabled: boolean }
  | { type: 'butcherBill'; spotId: number; paused: boolean }
  | TradeCommand
  | { type: 'research'; project: ResearchKey | null }
  | { type: 'difficulty'; difficulty: Difficulty }
  | { type: 'threats'; enabled: boolean }
  | { type: 'draft'; pawnId: number; drafted: boolean }
  | { type: 'attack'; pawnId: number; targetId: number }
  | { type: 'weaponBill'; benchId: number; kind: WeaponKind; target: number; paused: boolean }
  | { type: 'benchPower'; benchId: number; on: boolean }
  | { type: 'armorBill'; benchId: number; kind: ArmorKind; target: number; paused: boolean }
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
      zoneId?: string;
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
  | { type: 'apparelPolicyCreate'; sourceId?: number }
  | { type: 'apparelPolicyUpdate'; policy: ApparelPolicy }
  | { type: 'apparelPolicyDelete'; policyId: number }
  | { type: 'pawnApparelPolicy'; pawnId: number; policyId: number | null }
  | { type: 'apparelUnforce'; pawnId: number; apparelId?: number }
  | { type: 'foodPolicyCreate'; sourceId?: number }
  | { type: 'foodPolicyUpdate'; policy: FoodPolicy }
  | { type: 'foodPolicyDelete'; policyId: number }
  | { type: 'pawnFoodPolicy'; pawnId: number; policyId: number | null }
  | { type: 'ingest'; pawnId: number; stackId: number }
  | { type: 'prisonFoodDeliver'; pawnId: number; prisonerId: number }
  | { type: 'bedOwner'; bedId: number; pawnId: number | null }
  | { type: 'bedMedical'; bedId: number; medical: boolean }
  | { type: 'care'; pawnId: number; patientId: number; action: 'rescue' | 'feed' | 'tend' }
  | { type: 'medicalPolicy'; pawnId: number; policy: MedicalPolicy }
  | { type: 'medicalRest'; pawnId: number; enabled: boolean }
  | { type: 'door'; doorId: number; mode: Door['mode'] }
  | { type: 'schedule'; pawnId: number; hour: number; assignment: Assignment }
  | { type: 'rest'; pawnId: number }
  | { type: 'move'; pawnId: number; target: Pos };
export interface CommandResult {
  policyId?: number;
  areaId?: number;
  ok: boolean;
  message: string;
  count?: number;
}
export interface VoxelSave {
  foodPolicies: FoodPoliciesState;
  apparelPolicies: ApparelPoliciesState;
  animalBeds: AnimalBed[];
  stockpileZones: import('./stockpileZones').StockpileZone[];
  productionQueues: import('./productionBills').ProductionQueue[];
  shelves: Shelf[];
  storageGroups: StorageGroup[];
  storageSpills: StorageSpill[];
  socialHistory: SocialIdentity[];
  socialLog: SocialEvent[];
  tables: DiningTable[];
  chairs: DiningChair[];
  fences: Fence[];
  fenceGates: FenceGate[];
  penMarkers: PenMarker[];
  animalAreas: AnimalArea[];
  grass: GrassPatch[];
  husbandryLog: HusbandryEvent[];
  weather: WeatherState;
  snow: SnowCover[];
  fires: Fire[];
  fireDamage: FireDamage[];
  fireHazards: FireHazards;
  autoRebuild: boolean;
  fireLog: FireLogEntry[];
  filth: Filth[];
  eggBoxes: EggBox[];
  horseshoePins: HorseshoePin[];
  format: 'emberfield-voxel';
  version: 58;
  autoSlaughter: import('./autoSlaughter').AutoSlaughterSettings;
  animals: WildAnimal[];
  butcherSpots: ButcherSpot[];
  trade: TradeState;
  homeArea: number[];
  combat: CombatState;
  storyteller: StorytellerState;
  structureKinds: number[];
  projectiles: Projectile[];
  combatEvents: CombatEvent[];
  sandbags: Sandbag[];
  generator: 1 | 2 | 3 | 4;
  worldSite: WorldSite | null;
  settings: WorldSettings;
  spawn: Pos;
  seed: number;
  tick: number;
  nextId: number;
  // RLE pairs keep terrain compact; separate format never overwrites 2D v1 saves.
  blocks: number[];
  water: number[];
  bridges: number[];
  explored: number[];
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
  researchBenches: ResearchBench[];
  research: ResearchState;
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
  silver: '银币',
  wood: '木材',
  stone: '花岗岩砖',
  chunk: '花岗岩块',
  cloth: '布料',
  alpacaWool: '羊驼毛',
  herb: '草药',
  apparel: '衣物',
  weapon: '武器',
  furniture: '打包家具',
  unfinished: '未完成品',
  steel: '钢材',
  components: '零件',
  food: '包装生存口粮',
  grain: '生食材',
  meat: '生肉',
  milk: '奶',
  eggUnfertilized: '鸡蛋（未受精）',
  eggFertilized: '鸡蛋（受精）',
  carcass: '动物尸体',
  meal: '简餐',
};
export const JOB_NAMES: Record<JobKind, string> = {
  bridge: '架木桥',
  shelf: '建货架', smallShelf: '建小货架',
  uninstall: '卸下家具', install: '重装家具',
  table: '造餐桌', chair: '造餐椅',
  fence: '建围栏', fenceGate: '建栏门', penMarker: '建圈地标记',
  eggBox: '建蛋箱',
  horseshoePin: '建马蹄铁桩',
  butcherSpot: '划定屠宰点',
  butcher: '屠宰动物',
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
  armorsmith: '锻造护甲',
  craftingSpot: '划定制作点',
  smithy: '造燃料锻造台',
  machining: '造机械加工台',
  sandbag: '建沙袋',
  smith: '制作武器',
  researchBench: '造简易科研台',
  research: '研究',
  bed: '造床',
  door: '造门',
  cook: '烹饪简餐',
};
export const TOOL_NAMES: Record<Tool, string> = {
  animalBed: '动物医疗睡眠点',
  forbidItems: '禁止物品', allowItems: '允许物品',
  bridge: '木桥',
  shelf: '货架', smallShelf: '小货架',
  table: '餐桌', chair: '餐椅',
  fence: '围栏', fenceGate: '栏门', penMarker: '圈地标记', animalArea: '允许区域',
  eggBox: '蛋箱',
  horseshoePin: '马蹄铁桩',
  butcherSpot: '屠宰点',
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
  machining: '机械加工台',
  sandbag: '沙袋掩体',
  researchBench: '简易科研台',
  bed: '床',
  door: '门',
  clearZone: '擦除区域',
  remove: '拆除',
  cancel: '取消规划',
};
export const emptyCounts = (): Counts => ({
  silver: 0,
  wood: 0,
  stone: 0,
  steel: 0,
  components: 0,
  food: 0,
  grain: 0,
  meat: 0,
  milk: 0,
  eggUnfertilized: 0,
  eggFertilized: 0,
  carcass: 0,
  meal: 0,
  chunk: 0,
  cloth: 0,
  alpacaWool: 0,
  herb: 0,
  apparel: 0,
  weapon: 0,
  furniture: 0,
  unfinished: 0,
});
