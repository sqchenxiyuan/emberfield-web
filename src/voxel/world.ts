import { rejectLegacyWool, migrateWool, validateWool } from './animalWoolPersistence';
import { rejectLegacyMilk, migrateMilk, validateMilk } from './animalMilkPersistence';
import { WeightedNavigation } from './navigation';
import { isConstructionFrame, constructionFrameCells, frameBuildingKind } from './constructionFrames';
import { constructionSuccessChance, constructionFailureChance, isFailableConstruction,
  constructionRandom, constructionSalvage, validateConstructionFailure } from './construction';
import { itemForbiddenTo, rejectLegacyItemAccess } from './itemAccess';
import { allowedAreaCells, effectivePawnArea, pawnAreaAllows, validatePawnAreas } from './allowedAreas';
import { effectiveShelfSettings, reconcileStorageGroups, storageGroupCommand, rejectLegacyStorageGroups,
  migrateStorageGroups, validateStorageGroups, type StorageGroup } from './storageGroups';
import {
  Block,
  CELLS,
  CHUNK,
  DEPTH,
  HEIGHT,
  TPS,
  DAY,
  SURFACE,
  WIDTH,
  at,
  emptyCounts,
  index,
  inside,
  position,
  JOB_NAMES,
  RESOURCE_NAMES,
  bedCells,
  deviceCells,
  stonecutterCells,
  stonecutterInteraction,
  tailorCells,
  tailorInteraction,
  weaponBenchCells,
  weaponBenchInteraction,
  researchBenchCells,
  researchBenchInteraction,
} from './types';
import {
  APPAREL_DEFS,
  apparelCost,
  APPAREL_KINDS,
  TAILOR_KINDS,
  ARMOR_KINDS,
  APPAREL_NAMES,
  TAILOR_COST,
  TAILOR_WORK,
  makeApparel,
  validApparel,
  compatibleApparel,
  apparelDelay,
  apparelWearDamage,
  APPAREL_WEAR_INTERVAL,
  apparelMoveFactor,
  apparelHasPartsToWear,
  sortApparelByLayer,
} from './apparel';
import {
  WEAPON_DEFS,
  WEAPON_KINDS,
  WEAPON_NAMES,
  WEAPON_DROP_TICKS,
  makeWeapon,
  validWeapon,
  weaponWork,
  selectMeleeAttack,
  meleeBodyFromTrauma,
  type WeaponKind,
  type WeaponPiece,
  type WeaponBenchKind,
} from './weapons';
import {
  SMITHY_COST,
  SMITHY_WORK,
  MACHINING_COST,
  MACHINING_WORK,
  MACHINING_POWER,
  machiningWorkFactor,
  SANDBAG_COST,
  SANDBAG_WORK,
  SANDBAG_HP,
  SMITHY_FUEL_CAPACITY,
  SMITHY_REFUEL_AT,
  SMITHY_FUEL_PER_TICK,
  isWeaponBenchKind,
  makeWeaponBench,
} from './weaponProduction';
import {
  initialResearch,
  validResearch,
  researchBlockReason,
  researchComplete,
  toolResearchReason,
  weaponResearchReason,
  armorResearchReason,
  RESEARCH_DEFS,
  RESEARCH_KEYS,
  RESEARCH_BENCH_COST,
  RESEARCH_BENCH_WORK,
  RESEARCH_SESSION_TICKS,
  researchPointsPerTick,
  simpleBenchFactor,
} from './research';
import { VoxelRooms } from './rooms';
import { initialExploration, revealExploration, rejectLegacyExploration, loadExploration } from './exploration';
import { ANIMAL_DEFS, WILDLIFE, isAnimal } from './wildlife';
import { migrateWildlife, validateWildlife } from './wildlifePersistence';
import { initialAnimalState, HUSBANDRY_RULES, ANIMAL_HUSBANDRY } from './husbandry';
import { rejectLegacyHusbandryFields, migrateHusbandry, validateHusbandry } from './husbandryPersistence';
import { seedGrass, updateHusbandry, tryHandle, handleTick, animalOrder, releaseAnimalHandlers, reconcileAutoSlaughter } from './husbandryWorld';
import { defaultAutoSlaughter, autoSlaughterSelection, validAutoSlaughterPolicy, AUTO_SLAUGHTER_SPECIES } from './autoSlaughter';
import { migrateAutoSlaughter, validateAutoSlaughter } from './autoSlaughterPersistence';
import { PEN_RULES, PEN_BUILDINGS, initialPenFilter, isAnimalGroundStep, type Fence, type FenceGate, type PenMarker, type AnimalArea } from './pens';
import { pensCommand, penSummaries, penCells, tryRope, ropeTick, cancelAnimalRopes, removePenMarker } from './pensWorld';
import { rejectLegacyPensFields, migratePens, validatePens } from './pensPersistence';
import type { GrassPatch, HusbandryEvent } from './types';
import type { WildAnimal, ButcherSpot, HorseshoePin } from './types';
import { initialLiving, tableCells, LIVING_RULES, LIVING_BUILDINGS, advanceLiving, rememberMeal, rememberSleep, roomLivingSummary, type DiningTable, type DiningChair, type RoomLivingSummary } from './living';
import { rejectLegacyLivingFields, migrateLiving, validateLiving } from './livingPersistence';
import { initialSocial, rememberDeparture, type SocialIdentity, type SocialEvent } from './social';
import { rejectLegacySocialFields, migrateSocial, validateSocial } from './socialPersistence';
import { furnitureStats, isFurnitureKind, type FurnitureKind } from './furniture';
import { RELOCATION_RULES, makeFurniturePiece, furnitureFromPiece, relocationMaxHP } from './relocation';
import { SHELF_DEFS, SHELF_STACKS, isShelfKind, isRelocatableKind, shelfCells, shelfAllows, defaultShelfSettings,
  type Shelf, type StorageCell, type StorageSpill, type RelocatableKind } from './shelves';
import { rejectLegacyShelves, migrateShelves, validateShelves } from './shelvesPersistence';
import { rejectLegacyRelocationFields, migrateRelocation, validateRelocation } from './relocationPersistence';
import { resolveWorldSite, type WorldSite } from './regions';
import { rejectLegacyWorldSite, validateWorldSiteIdentity } from './regionPersistence';
import { rejectLegacyFurnitureFields, migrateFurniture, validateFurniture } from './furniturePersistence';
import { updateSocial } from './socialWorld';
import { constructedMarketValue, structureMarketValue, furnitureMarketValue } from './wealth';
import { initialPsyche, remember, advancePsyche, recreationGain, shouldRecreate, validatePsyche, MOOD_RULES, RECREATION_NAMES, type RecreationKind } from './mood';
import { HORSESHOE_COST, HORSESHOE_WORK } from './recreation';
import { startCapture, setPrisonerPolicy, tryWarden, wardenTick, prisonerTick, releaseWarden } from './prisonWorld';
import { rejectLegacyPrisonerFields, migratePrisoners, validatePrisoners } from './prisonPersistence';
import { FILTH_NAMES, SANITATION_RULES, cookingOutcome, exposeFoodPoisoning, poisoningStage, sanitationRandom,
  type Filth, type FilthKind, type RoomCleanliness } from './sanitation';
import { rejectLegacySanitationFields, migrateSanitation, validateSanitation } from './sanitationPersistence';
import { initialFireHazards, fireDamageCells, FIRE_RULES, FIRE_MAX_HP, fireDamageKey,
  type Fire, type FireDamage, type FireHazards, type FireLogEntry, type BurnTargetKind } from './fire';
import { updateFires, fireFuelAt, findFireDamageTarget, fireLog, removeFire, startFirefight, startRepair,
  tryFirefight, tryRepair, validFirefight, validRepair, firefightTick, repairTick, touchesFire, FIRE_DIRECTIONS } from './fireWorld';
import { rejectLegacyFireFields, migrateFire, validateFire } from './firePersistence';
import { colonyWealth, summaryHealthPercent } from './wealth';
import { STORY_INTERVAL, threatPoints, growAdaptation, adaptationAfterLoss } from './storytellerRules';
import {
  ADAPTATION_INTERVAL, DIFFICULTIES, DIFFICULTY, DIFFICULTY_NAMES, INTRO_INTERVAL,
  initialStoryteller, cycleAt, cycleHits, nextOpportunity, livingColonists,
  planRaid, raidWeapon, storyRandom, RAID_COST, RAID_NAMES,
  type StoryEvent, type StorytellerState,
} from './storyteller';
import { rejectLegacyStorytellerFields, validateStoryteller } from './storytellerPersistence';
import { initialTrade, makeTraderStock, merchantStayTicks, TRADER_NAMES, visitorGroup, visitorWeapon, VISITOR_KINDS } from './trade';
import { applyTradeCommand, quoteTrade, updateTrade, tradeHostile, tradeHarmed, type Placement } from './tradeWorld';
import type { TradeState } from './tradeTypes';
import { rejectLegacyTradeFields, migrateTradeFields, validateTrade } from './tradePersistence';
import {
  MEDICAL_POLICIES,
  MEDICAL_POLICY_NAMES,
  MEDICAL_CARE_WORK,
  advanceMedical,
  needsMedicalTending,
  medicalNeedsRest,
  tendMedical,
  medicineNeeded,
  infectionRoomFactor,
  trackInfectionRisks,
} from './medicine';
import {
  rejectLegacyMedicineFields,
  migrateMedicineFields,
  validateMedicineState,
} from './medicinePersistence';
import {
  rejectLegacyRangedFields,
  migrateRangedFields,
  validateRangedState,
} from './rangedPersistence';
import {
  isRangedKind,
  rangedStats,
  rangedShotReport,
  resolveRangedLaunch,
  projectileFlightTicks,
  traceVoxelRay,
  pawnInterceptChance,
  interceptDistanceFactor,
  projectilePostureChance,
  type RangedCover,
} from './ranged';
import {
  initialSkills,
  validSkills,
  tickSkills,
  craftedQuality,
  learnSkill,
  workSpeed,
  jobSkill,
  jobXP,
  tendSpeed,
  tendQuality,
  meleeHitChance,
  meleeDodgeChance,
  miningYield,
  plantYield,
} from './skills';
import { VoxelPower, DEVICE_COSTS, DEVICE_WORK, isDeviceKind } from './power';
import { VoxelThermal } from './thermal';
import {
  DEFAULT_WORLD_SETTINGS,
  TREE_DATA,
  generateWorld,
  sanitizeWorldSettings,
  summarizeWorld,
  validWorldSettings,
} from './worldgen';
import { outdoorTemperature } from './climate';
import { initialWeather, advanceWeather, weatherEffects, snowDepthAfter, snowPathCost,
  type WeatherState, type SnowCover } from './weather';
import { rejectLegacyWeatherFields, migrateWeather, validateWeather } from './weatherPersistence';
import { ENVIRONMENT_RULES, RAIN_WASHES, wettingWeather, natureWeatherAllowed, carcassBatch,
  type EnvironmentView } from './environment';
import { advanceDeterioration, batchHitPoints, batchMaxHitPoints, deteriorationRate, deteriorationRandom,
  type DeteriorationEnvironment } from './deterioration';
import { rejectLegacyEnvironmentFields, migrateEnvironment } from './environmentPersistence';
import {
  TREE_NAMES,
  treeYield,
  treeGrowth,
  treeWorkSpeed,
  treeCutWork,
  treeSowWork,
  treeDamage,
  treeCover,
  naturalSpecies,
  plantRandom,
  PLANTED_GROWTH,
  NATURAL_GROWTH,
  ECOLOGY_INTERVAL,
  ECOLOGY_SAMPLES,
  NATURAL_TREE_CAP,
} from './plants';
import {
  advanceRot,
  compatibleBatches,
  freshBatch,
  isPerishable,
  mergeBatch,
  portion,
  validBatch,
} from './preservation';
import { carryLimit, stackLimit, cellSpaceAfterReservations, planCellInsertion, DROP_DISTANCE, MIGRATION_DISTANCE, type BatchKind } from './logistics';
import {
  STONECUTTER_COST,
  STONECUTTER_WORK,
  STONECUTTING,
  STONE_CONSTRUCTION,
  naturalChunkDrop,
} from './crafting';
import {
  initialSurvival,
  healthSummary,
  legacyHealthState,
  updateHealth,
  healthDeathReason,
  FEED_WORK,
  hungerMultiplier,
} from './survival';
import { defaultSchedule, assignmentAt, restLoss, restGain, wantsSleep } from './rest';
import {
  initialTrauma,
  advanceTrauma,
  traumaSummary,
  validTrauma,
  tendOne,
  applyBodyDamage,
  needsTending,
  migrateLegacyTrauma,
  traumaIds,
} from './injuries';
import { BODY_PARTS, chooseHitPart } from './anatomy';
import {
  CROPS,
  SIMPLE_MEAL,
  NUTRITION,
  FOOD_FALL_PER_TICK,
  hourAt,
  fertilityOf,
  MIN_CROP_FERTILITY,
  daylight,
  cropGrowth,
} from './farming';
import type {
  ChunkUpdate,
  CommandResult,
  Counts,
  Job,
  JobKind,
  Pawn,
  Pos,
  Resource,
  Stack,
  Tree,
  VoxelCommand,
  VoxelSave,
  VoxelSnapshot,
  VoxelStats,
  WorldSettings,
  WorldSummary,
  Work,
  Crop,
  CropKind,
  FarmPlot,
  Stove,
  Bed,
  Door,
  Axis,
  Device,
  Cargo,
  Stockpile,
  StorageCapacity,
  Stonecutter,
  ConstructionMaterial,
  TreeSpecies,
  TreePlot,
  TreeCondition,
  ApparelKind,
  ApparelPiece,
  Tailor,
  WeaponBench,
  Sandbag,
  Projectile,
  CombatEvent,
  ResearchBench,
} from './types';

import { WATER_RULES, waterBelow, bridgeSupports, validateWater } from './water';
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const resting = (p: Pawn | WildAnimal) => p.phase === 'rest' ||
  (!isAnimal(p) && p.faction === 'prisoner' && p.sleepingSince !== null);
const horizontal = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const resources = Object.keys(emptyCounts()) as Resource[];
const costOf = (
  kind: JobKind,
  material: ConstructionMaterial = 'wood',
  apparelKind?: ApparelKind,
  weaponKind?: WeaponKind,
  weaponBenchKind?: WeaponBenchKind,
): Partial<Counts> =>
  kind === 'bridge' ? { wood: WATER_RULES.bridgeWood } :
  kind === 'install' ? { furniture: 1 } :
  isShelfKind(kind) ? { ...SHELF_DEFS[kind].cost } :
  kind === 'table' || kind === 'chair' ? { ...LIVING_BUILDINGS[kind].cost } :
  kind === 'fence' || kind === 'fenceGate' || kind === 'penMarker' ? {...PEN_BUILDINGS[kind].cost} :
  kind === 'horseshoePin' ? { ...HORSESHOE_COST } : kind === 'butcher' ? { carcass: 1 } : kind === 'machining'
    ? { ...MACHINING_COST }
    : kind === 'sandbag'
      ? { ...SANDBAG_COST }
      : kind === 'researchBench'
        ? { ...RESEARCH_BENCH_COST }
        : kind === 'smithy'
          ? { ...SMITHY_COST }
          : kind === 'smith'
            ? { ...WEAPON_DEFS[weaponKind!].cost }
            : kind === 'tailor'
              ? { ...TAILOR_COST }
              : kind === 'tailoring' || kind === 'armorsmith'
                ? { ...APPAREL_DEFS[apparelKind ?? 'shirt'].cost }
                : kind === 'stonecutter'
                  ? { ...STONECUTTER_COST }
                  : kind === 'stonecut'
                    ? { chunk: STONECUTTING.input }
                    : material === 'stone' && (kind === 'wall' || kind === 'floor')
                      ? { stone: STONE_CONSTRUCTION[kind].cost }
                      : isDeviceKind(kind)
                        ? { ...DEVICE_COSTS[kind] }
                        : kind === 'wire'
                          ? { steel: 1 }
                          : kind === 'cook'
                            ? { grain: SIMPLE_MEAL.ingredients, wood: SIMPLE_MEAL.wood }
                            : (
                                  {
                                    floor: 3,
                                    wall: 6,
                                    ladder: 2,
                                    digLadder: 2,
                                    stove: 20,
                                    bed: 45,
                                    door: 25,
                                  } as Partial<Record<JobKind, number>>
                                )[kind]
                              ? {
                                  wood: (
                                    {
                                      floor: 3,
                                      wall: 6,
                                      ladder: 2,
                                      digLadder: 2,
                                      stove: 20,
                                      bed: 45,
                                      door: 25,
                                    } as Partial<Record<JobKind, number>>
                                  )[kind]!,
                                }
                              : {};
const workOf = (
  kind: JobKind,
  material: ConstructionMaterial = 'wood',
  species: TreeSpecies = 'poplar',
  legacyCut = false,
  apparelKind?: ApparelKind,
  weaponKind?: WeaponKind,
  weaponBenchKind?: WeaponBenchKind,
  cropKind: CropKind = 'rice',
) =>
  kind === 'bridge' ? WATER_RULES.bridgeWork :
  kind === 'uninstall' ? RELOCATION_RULES.uninstallWork : kind === 'install' ? RELOCATION_RULES.installWork :
  kind === 'fence' || kind === 'fenceGate' || kind === 'penMarker' ? PEN_BUILDINGS[kind].work : kind === 'machining'
    ? MACHINING_WORK
    : kind === 'sandbag'
      ? SANDBAG_WORK
      : kind === 'researchBench'
        ? RESEARCH_BENCH_WORK
        : kind === 'research'
          ? RESEARCH_SESSION_TICKS
          : kind === 'smithy'
            ? SMITHY_WORK
            : kind === 'craftingSpot'
              ? 1
              : kind === 'smith'
                ? weaponWork(weaponKind!, weaponBenchKind!)
                : kind === 'tailor'
                  ? TAILOR_WORK
                  : kind === 'tailoring' || kind === 'armorsmith'
                    ? APPAREL_DEFS[apparelKind ?? 'shirt'].work
                    : kind === 'cut'
                      ? legacyCut
                        ? 60
                        : treeCutWork(species)
                      : kind === 'plantTree'
                        ? treeSowWork(species)
                        : material === 'stone' && (kind === 'wall' || kind === 'floor')
                          ? STONE_CONSTRUCTION[kind].work
                          : {
                              ...DEVICE_WORK,
                              wire: 12,
                              refuel: 80,
                              mine: 70,
                              cut: 60,
                              floor: 45,
                              wall: 80,
                              ladder: 40,
                              digLadder: 90,
                              remove: 40,
                              sow: CROPS[cropKind].sowWork,
                              harvest: CROPS[cropKind].harvestWork,
                              stove: 120,
                              table: LIVING_BUILDINGS.table.work, chair: LIVING_BUILDINGS.chair.work,
                              shelf: SHELF_DEFS.shelf.work, smallShelf: SHELF_DEFS.smallShelf.work,
                              bed: 187,
                              door: 199,
                              cook: SIMPLE_MEAL.work,
                              butcher: WILDLIFE.butcherWork,
                              butcherSpot: 1,
                              horseshoePin: HORSESHOE_WORK,
                              stonecutter: STONECUTTER_WORK,
                              stonecut: STONECUTTING.work,
                            }[kind];
const workType = (kind: JobKind): Work =>
  kind === 'research'
    ? 'research'
    : kind === 'stonecut' || kind === 'tailoring' || kind === 'smith' || kind === 'armorsmith'
      ? 'craft'
      : kind === 'refuel'
        ? 'haul'
        : kind === 'sow' || kind === 'harvest' || kind === 'plantTree'
          ? 'grow'
          : kind === 'cook' || kind === 'butcher'
            ? 'cook'
            : kind === 'mine' || kind === 'digLadder'
              ? 'dig'
              : kind === 'cut'
                ? 'cut'
                : 'build';
const missing = (j: Job) => j.unfinishedId === undefined
  ? resources.find((r) => (j.cost[r] ?? 0) > (j.delivered[r] ?? 0)) : undefined;
function encode(a: Uint8Array) {
  const out: number[] = [];
  let last = a[0],
    n = 0;
  for (const b of a) {
    if (b !== last) {
      out.push(last, n);
      last = b;
      n = 0;
    }
    n++;
  }
  out.push(last, n);
  return out;
}
function decode(raw: unknown, max: number): Uint8Array<ArrayBuffer> {
  if (!Array.isArray(raw) || raw.length > CELLS * 2 || raw.length % 2)
    throw new Error('体素编码无效');
  const out = new Uint8Array(CELLS);
  let cursor = 0;
  for (let i = 0; i < raw.length; i += 2) {
    const v = raw[i],
      n = raw[i + 1];
    if (
      !Number.isInteger(v) ||
      v < 0 ||
      v > max ||
      !Number.isInteger(n) ||
      n < 1 ||
      cursor + n > CELLS
    )
      throw new Error('体素区段无效');
    out.fill(v, cursor, cursor + n);
    cursor += n;
  }
  if (cursor !== CELLS) throw new Error('体素尺寸不匹配');
  return out;
}

import { defaultProductionQueue, productionQueues, productionJobRecipe, canStartProduction,
  finishProductionBill, makeProductionBill, recipeAllowed, validateProductionQueues,
  type ProductionBill, type ProductionQueue, type ProductionRecipe } from './productionBills';
import { defaultProductionPolicy, productionPolicyWorkerReason, productionPolicyAllowsIngredient } from './productionPolicies';
import { recipeUsesUnfinished, validateUnfinishedProduction } from './unfinishedProduction';
import { defaultProductionOutput, productionOutputTargetCells, productionOutputTargetExists, productionOutputTargetName,
  reconcileProductionOutputs, validateProductionOutputState, type ProductionDelivery } from './productionOutput';
import { migrateStockpileZones, reconcileStockpileZones, createStockpileZone, expandStockpileZone,
  renameStockpileZone, stockpileZoneAt, validateStockpileZones, type StockpileZone } from './stockpileZones';

export class VoxelSimulation {
  stockpileZones: StockpileZone[] = [];
  /** Sparse overrides: untouched legacy recipes retain their published defaults. */
  productionQueues: ProductionQueue[] = [];
  weather: WeatherState;
  snow: SnowCover[] = [];
  private weatherRoof = new Uint8Array(WIDTH * DEPTH);
  private weatherRoofRevision = -1;
  private snowLookup = new Map<number, number>();
  fires: Fire[] = [];
  fireDamage: FireDamage[] = [];
  autoRebuild = false;
  fireHazards: FireHazards;
  fireLog: FireLogEntry[] = [];
  filth: Filth[] = [];
  private cleanlinessRevision = -1;
  private cleanlinessBase = new Map<number, { total: number; count: number }>();
  animals: WildAnimal[] = [];
  fences: Fence[] = [];
  fenceGates: FenceGate[] = [];
  penMarkers: PenMarker[] = [];
  animalAreas: AnimalArea[] = [];
  private areaReturnRetry = new Map<number, { tick: number; revision: number }>();

  pawnAllowed(p: Pawn, target: Pos): boolean {
    return pawnAreaAllows(p, target, this.animalAreas, this.tick);
  }
  /** Inspect semantic targets, never intermediate path cells or carried patients. */
  private pawnTaskInArea(p: Pawn): boolean {
    if (!effectivePawnArea(p, this.animalAreas, this.tick)) return true;
    const targets: (Pos | undefined)[] = [];
    const job = this.jobs.find(j => j.id === p.jobId);
    targets.push(job);
    if (job?.unfinishedId !== undefined) targets.push(this.items.find(i => i.unfinished?.id === job.unfinishedId));
    const fetch = this.fetchReservations.get(p.id), storage = this.storageReservations.get(p.id);
    if (fetch) targets.push(this.items.find(i => i.id === fetch.sourceId));
    if (storage) {
      targets.push(position(storage.cell));
      if (storage.sourceId !== null) targets.push(this.items.find(i => i.id === storage.sourceId));
    }
    if (p.productionDelivery && p.productionDelivery.state !== 'dropping') targets.push(position(p.productionDelivery.cell));
    if (p.sleepBedId !== null) targets.push(this.beds.find(b => b.id === p.sleepBedId));
    else if (p.phase === 'rest') targets.push(p);
    if (p.phase === 'travel' && p.destination !== null) targets.push(position(p.destination));
    if (p.living.mealTask) targets.push(p.living.mealTask.target);
    if (p.psyche.recreation) targets.push(p.psyche.recreation.target);
    if (p.cleanTask) targets.push(this.filth.find(f => f.id === p.cleanTask!.filthId));
    if (p.carePhase) {
      if (p.carePhase !== 'rescueCarry') targets.push(this.pawns.find(q => q.id === p.patientId));
      targets.push(this.beds.find(b => b.id === p.careBedId));
      if (p.carePhase.endsWith('Fetch')) targets.push(this.items.find(i => i.id === (p.careFoodId ?? p.careMedicineId)));
    }
    if (p.weaponTask?.stage === 'fetch') targets.push(this.items.find(i => i.weapon?.id === p.weaponTask!.weaponId));
    if (p.apparelTask?.stage === 'fetch') targets.push(this.items.find(i => i.apparel?.id === p.apparelTask!.apparelId));
    if (p.phase === 'hunt') targets.push(this.animals.find(a => a.id === p.attackTargetId));
    return targets.every(t => !t || this.pawnAllowed(p,t));
  }
  private reconcilePawnArea(p: Pawn, assignmentChanged = false) {
    const check = assignmentChanged ? { ...p, weaponTask:null, apparelTask:null } : p;
    const equipment = assignmentChanged ? this.items.find(i =>
      (p.weaponTask?.stage === 'fetch' && i.weapon?.id === p.weaponTask.weaponId) ||
      (p.apparelTask?.stage === 'fetch' && i.apparel?.id === p.apparelTask.apparelId)) : undefined;
    if (p.dead || p.downed || p.carriedBy !== null ||
        (this.pawnTaskInArea(check) && (!equipment || this.pawnAllowed(check,equipment)))) return;
    if (p.productionDelivery) this.interruptProductionDelivery(p);
    else this.release(p);
    p.reason = '任务目标在允许区域外，保留物资并重新安排';
  }
  private tryReturnToArea(p: Pawn): boolean {
    const area = effectivePawnArea(p, this.animalAreas, this.tick);
    if (!area || this.pawnAllowed(p,p) || p.dead || p.downed || p.carriedBy !== null) return false;
    const retry = this.areaReturnRetry.get(p.id);
    if (retry && retry.revision === this.revision && retry.tick > this.tick) {
      p.reason = '允许区域内没有可达落脚点，等待通路'; return true;
    }
    this.search(p);
    let best = -1;
    for (const cell of allowedAreaCells(area)) if (this.explored[cell] && this.canStop(position(cell)) &&
        this.distance[cell] >= 0 && (best < 0 || this.distance[cell] < this.distance[best])) best = cell;
    if (best < 0) {
      this.areaReturnRetry.set(p.id, { tick: this.tick + 100, revision: this.revision });
      p.reason = '允许区域内没有可达落脚点，等待通路'; return true;
    }
    this.release(p);
    this.search(p);
    this.go(p,best,'travel'); p.reason = `返回允许区域：${area.name}`;
    this.areaReturnRetry.delete(p.id);
    return true;
  }
  private penLookupRevision = -1;
  private fenceLookup = new Map<number, Fence>();
  private gateLookup = new Map<number, FenceGate>();
  private markerLookup = new Map<number, PenMarker>();
  grass: GrassPatch[] = [];
  husbandryLog: HusbandryEvent[] = [];
  autoSlaughter = defaultAutoSlaughter();
  butcherSpots: ButcherSpot[] = [];
  tables: DiningTable[] = [];
  chairs: DiningChair[] = [];
  private livingFloorRevision = -1;
  private livingFloors = new Map<number, {wealth:number; beauty:number}>();
  horseshoePins: HorseshoePin[] = [];
  trade: TradeState;
  homeArea = new Set<number>();
  combat = { enabled: false, nextRaid: 0, wave: 0 };
  storyteller: StorytellerState;
  structureKinds = new Uint8Array(CELLS);
  private pendingAdaptation = new Map<number, 'downed' | 'lost'>();
  projectiles: Projectile[] = [];
  combatEvents: CombatEvent[] = [];
  sandbags: Sandbag[] = [];
  blocks = new Uint8Array(CELLS);
  water: Uint8Array = new Uint8Array(CELLS);
  /** Water never changes during play; rebuild this dry-map fast path on creation/load. */
  private waterPresent = false;
  bridges = new Uint8Array(CELLS);
  explored: Uint8Array = new Uint8Array(CELLS);
  private exploredCount = 0;
  private visibleRoomsRevision = -1;
  private visibleRoomsCache = new Set<number>();
  ladders = new Uint8Array(CELLS);
  pawns: Pawn[] = [];
  socialHistory: SocialIdentity[] = [];
  socialLog: SocialEvent[] = [];
  items: Stack[] = [];
  trees: Tree[] = [];
  treePlots: TreePlot[] = [];
  jobs: Job[] = [];
  farms: FarmPlot[] = [];
  crops: Crop[] = [];
  stoves: Stove[] = [];
  stonecutters: Stonecutter[] = [];
  tailors: Tailor[] = [];
  weaponBenches: WeaponBench[] = [];
  researchBenches: ResearchBench[] = [];
  research = initialResearch();
  beds: Bed[] = [];
  doors: Door[] = [];
  devices: Device[] = [];
  wires: Pos[] = [];
  power = new VoxelPower();
  thermal = new VoxelThermal();
  private powerDirty = true;
  private deviceBlocks = new Set<number>();
  rooms = new VoxelRooms();
  roomRevision = 0;
  private roomsDirty = true;
  stockpiles: Stockpile[] = [];
  shelves: Shelf[] = [];
  storageGroups: StorageGroup[] = [];
  storageSpills: StorageSpill[] = [];
  private shelfLookup = new Map<number, Shelf>();
  generator: 1 | 2 | 3 | 4 = 4;
  worldSite: WorldSite | null = null;
  settings: WorldSettings;
  spawn: Pos = { x: 32, y: 34, z: SURFACE };
  private summaryCache?: WorldSummary;
  private summaryRevision = -1;
  stats: VoxelStats = {
    mined: 0,
    cut: 0,
    built: 0,
    hauled: 0,
    sown: 0,
    harvested: 0,
    cooked: 0,
    stonecut: 0,
    tailored: 0,
    weaponsMade: 0,
    destroyed: emptyCounts(),
    treesPlanted: 0,
    treesRegrown: 0,
    treesDied: 0,
    eaten: 0,
    consumed: emptyCounts(),
    produced: emptyCounts(),
    spoiled: emptyCounts(),
  };
  tick = 0;
  nextId = 1;
  revision = 0;
  notice = '先采木，再向下开凿梯井，或向上搭梯建设二层。';
  private dirty = new Set<number>();
  private distance = new Int32Array(CELLS);
  private parents = new Int32Array(CELLS);
  private queue = new Int32Array(CELLS);
  private navigation = new WeightedNavigation(CELLS);
  private searchOrigin: Pos | null = null;
  private searchAllowed: Set<number> | undefined;
  private treeCells = new Set<number>();
  private stoveCells = new Set<number>();
  private skyCache = new Map<number, boolean>();
  private storageReservations = new Map<
    number,
    { cell: number; batch: Cargo; sourceId: number | null }
  >();
  /** Transient fetch plans are rebuilt after load. Both cooking/building inputs
   * and meals reserve a specific physical batch and quantity before walking. */
  private fetchReservations = new Map<number, { sourceId: number; amount: number }>();
  private ecologySurface: Pos[] = [];
  private ecologyRevision = -1;
  private treeRouteSeen = new Uint8Array(CELLS);
  private treeRouteQueue = new Int32Array(CELLS);
  constructor(
    public seed = 73129,
    settings?: Partial<WorldSettings>,
    restoreOnly = false,
    generator: 2 | 3 | 4 = 4,
  ) {
    if (!Number.isSafeInteger(seed)) throw new Error('种子必须是安全整数');
    if (generator !== 2 && generator !== 3 && generator !== 4) throw new Error('地图生成器无效');
    this.generator = generator;
    this.fireHazards = initialFireHazards(seed);
    this.storyteller = initialStoryteller(seed);
    this.trade = initialTrade(seed);
    this.settings = sanitizeWorldSettings(settings);
    this.weather = initialWeather(seed, this.settings);
    if (!restoreOnly) this.generate();
  }
  private id() {
    return this.nextId++;
  }
  /** A region controls all local generation inputs; callers cannot override
   * climate or the derived local seed while retaining the region's identity. */
  static fromWorldSite(site: unknown): VoxelSimulation {
    const resolved = resolveWorldSite(site);
    const next = new VoxelSimulation(resolved.seed, resolved.settings, true, resolved.generator);
    next.worldSite = structuredClone(resolved.site);
    next.generate();
    return next;
  }
  private generate() {
    const generated = generateWorld(this.seed, this.settings, this.generator >= 3 ? this.generator as 3 | 4 : 2,
      this.worldSite ? resolveWorldSite(this.worldSite).riverRoute : undefined);
    this.blocks = generated.blocks;
    this.water = generated.water;
    this.waterPresent = this.water.some(value=>value!==0);
    this.explored = initialExploration(this.blocks, this.generator);
    this.exploredCount = this.explored.reduce((n, value) => n + value, 0);
    this.spawn = generated.spawn;
    this.trees = generated.trees.map((tree) => ({ ...tree, id: this.id() }));
    this.summaryCache = generated.summary;
    this.summaryRevision = this.revision;
    this.stockpiles = [-1, 0].map((dx) => ({
      x: this.spawn.x + dx,
      y: this.spawn.y - 1,
      z: this.spawn.z,
      priority: 1,
      accepts: [...resources],
    }));
    for (let i = 0; i < 3; i++)
      this.pawns.push({
        id: this.id(),
        name: ['林澈', '温岚', '阿砾'][i],
        color: [0xe7b66b, 0x91b7a1, 0x9faec8][i],
        x: this.spawn.x - 1 + i,
        y: this.spawn.y + 1,
        z: this.spawn.z,
        food: 100,
        rest: 100,
        skills: initialSkills(i),
        prisoner: null, wardenTask: null, handleTask: null, ropeTask: null,
        living: initialLiving(), psyche: initialPsyche(), social: initialSocial(0, this.nextId - 1),
        priorities: {
          handle: 2,
          firefight: 1,
          clean: 3,
          warden: 1,
          hunt: 2,
          dig: 1,
          build: 1,
          cut: 1,
          haul: 2,
          grow: 1,
          cook: 1,
          craft: 1,
          care: 1,
          research: 4,
        },
        ...initialSurvival(this.seed, this.nextId - 1),
        worn: [],
        apparelTask: null,
        apparelWearTicks: 0,
        jobId: null,
        path: [],
        destination: null,
        phase: 'idle',
        cargo: null,
        reason: '等待安排',
        moveTick: 0,
        workTarget: null,
        eating: null,
        sleepBedId: null,
        sleepingSince: null,
        schedule: defaultSchedule(),
      });
    for (const p of this.pawns)
      p.worn = [makeApparel(this.id(), 'shirt'), makeApparel(this.id(), 'pants')];
    this.rebuildTrees();
    if (
      !this.addItem('wood', 90, this.stockpiles[0]) ||
      !this.addItem('food', 60, this.stockpiles[1])
    )
      throw new Error('开局物资缺少合法放置空间');
    if (!this.addItem('silver', 800, this.spawn)) throw new Error('开局银币缺少落地空间');
    for (let y = this.spawn.y - 4; y <= this.spawn.y + 4; y++)
      for (let x = this.spawn.x - 4; x <= this.spawn.x + 4; x++) {
        const cell = { x, y, z: this.spawn.z };
        if (inside(cell)) this.homeArea.add(at(cell));
      }
    this.markAll();
    this.seedWildlife();
    seedGrass(this);
  }
  private rebuildTrees() {
    this.treeCells = new Set(this.trees.flatMap((t) => [at(t), index(t.x, t.y, t.z + 1)]));
  }
  private seedWildlife(target: number = WILDLIFE.population, edge = false) {
    let wild = this.animals.filter(a => a.faction === 'wild').length;
    if (wild >= target || this.animals.length >= HUSBANDRY_RULES.maxAnimals) return;
    this.search(this.spawn);
    const sites: Pos[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (this.distance[i] < 0) continue;
      const p = position(i), distance = Math.hypot(p.x - this.spawn.x, p.y - this.spawn.y);
      if (distance < 8 || (!edge && distance > 22) ||
          (edge && p.x !== 0 && p.y !== 0 && p.x !== WIDTH - 1 && p.y !== DEPTH - 1) ||
          !this.skyAt(p) || this.ladders[i] || this.furnitureAt(p) ||
          this.animals.some(a => same(a, p))) continue;
      sites.push(p);
    }
    while (sites.length && wild < Math.min(target, WILDLIFE.cap) && this.animals.length < HUSBANDRY_RULES.maxAnimals) {
      const id = this.id(), choice = Math.floor(plantRandom(this.seed, id, this.tick, 970) * sites.length);
      const site = sites.splice(choice, 1)[0], species = this.settings.biome === 'desert' && wild % 3 === 0 ? 'dromedary' : this.settings.biome === 'temperate' && wild % 3 === 0 ? 'alpaca' : id % 2 ? 'hare' : 'deer';
      this.animals.push({ ...site, ...initialAnimalState(id, species, this.tick), id, species, name: ANIMAL_DEFS[species].name,
        health: ANIMAL_DEFS[species].health, hunger: 75, dead: false, phase: 'roam', hunt: false,
        moveTick: this.tick, decisionTick: this.tick, fleeUntil: 0, threatId: null,
        retryTick: 0, rotProgress: 0 });
      wild++;
    }
  }
  private updateWildlife() {
    updateHusbandry(this);
    for (const a of [...this.animals]) {
      if (a.dead) {
        const batch = carcassBatch(a);
        if (advanceRot(batch, this.temperature(a))) {
          this.stats.spoiled.carcass++;
          this.animals = this.animals.filter(other => other !== a);
          continue;
        }
        a.rotProgress = batch.rotProgress!;
        const plan = this.planPlacement([{ batch, origin: a }]);
        if (plan) {
          this.commitPlacement(plan);
          this.animals = this.animals.filter(other => other !== a);
        }
        continue;
      }
    }
    const wild = this.animals.filter(a => a.faction === 'wild').length;
    if (this.tick % (DAY * 2) === 0 && wild < WILDLIFE.population)
      this.seedWildlife(wild + 1, true);
  }
  private damageAnimal(shot: Projectile, animal: WildAnimal) {
    animal.health = Math.max(0, animal.health - shot.damage);
    animal.threatId = shot.shooterId;
    animal.fleeUntil = this.tick + 200;
    cancelAnimalRopes(this,animal.id);
    animal.phase = 'flee';
    this.combatEvent(animal, shot.shooterId, animal.id, 'hit', shot.damage, `击中${animal.name}`);
    if (animal.health > 0) return;
    this.killAnimal(animal, '狩猎或流弹');
  }
  killAnimal(animal: WildAnimal, reason: string) {
    if (animal.dead) return;
    animal.health = 0;
    animal.dead = true;
    animal.phase = 'dead';
    animal.hunt = false;
    animal.threatId = null;
    animal.tame = false; animal.slaughter = false; animal.releaseMarked = false;
    animal.pregnancy = null; animal.path = []; animal.goal = null; animal.mateId = null; animal.mateProgress = 0;
    animal.eatProgress = 0; animal.reason = reason;
    animal.allowedAreaId = null; animal.requestedPenId = null; animal.ropePaused = false;
    releaseAnimalHandlers(this, animal);
    for (const other of this.animals) if (other.mateId === animal.id) {
      other.mateId = null; other.mateProgress = 0; other.goal = null; other.path = []; other.phase = 'roam';
    }
    this.stats.produced.carcass++;
    for (const p of this.pawns) if (p.attackTargetId === animal.id) this.release(p);
    this.notice = `${animal.name}倒下，尸体可搬运至屠宰点加工`;
  }
  private tryHunt(p: Pawn): boolean {
    if (!p.priorities.hunt || !p.weapon || !isRangedKind(p.weapon.kind) || p.weaponDropPending || p.cargo) return false;
    const targets = this.animals.filter(a => this.pawnAllowed(p,a) && a.faction === 'wild' && a.hunt && !a.dead && a.retryTick <= this.tick &&
      !this.pawns.some(other => other.id !== p.id && other.phase === 'hunt' && other.attackTargetId === a.id))
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z) - Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z));
    for (const animal of targets) {
      const stand = this.shootingStand(p, animal);
      if (stand < 0) { animal.retryTick = this.tick + WILDLIFE.huntRetryTicks; continue; }
      this.release(p);
      p.phase = 'hunt'; p.attackTargetId = animal.id;
      if (stand !== at(p)) { this.search(p); this.go(p, stand, 'hunt'); }
      p.reason = `狩猎${animal.name}`;
      return true;
    }
    return false;
  }
  private huntTick(p: Pawn) {
    const animal = this.animals.find(a => a.id === p.attackTargetId && a.hunt && !a.dead);
    if (!animal || !this.pawnAllowed(p,animal) || !p.priorities.hunt || !p.weapon || !isRangedKind(p.weapon.kind) || p.weaponDropPending) {
      this.release(p); return;
    }
    this.rangedCombat(p, animal);
    if (!p.shooting && !p.path.length && !this.shotReport(p, animal)?.canShoot) {
      animal.retryTick = this.tick + WILDLIFE.huntRetryTicks;
      this.release(p); p.reason = '猎物暂不可达，稍后重试';
    }
  }
  markAll() {
    for (let i = 0; i < 16; i++) this.dirty.add(i);
  }
  private changed(p: Pos, finishingJobId?: number) {
    this.roomsDirty = true;
    this.skyCache.clear();
    this.revision++;
    this.pruneSnow();
    this.dirtyCell(p);
    if (this.generator >= 3) {
      const revealed = revealExploration(this.blocks, this.explored, [at(p)]);
      this.exploredCount += revealed.length;
      for (const cell of revealed) this.dirtyCell(position(cell));
      if (revealed.length) {
        // Native unfog removes empty mining designations. A blind plan remains
        // until both of its two cells are known, so planning cannot probe air.
        for (const job of [...this.jobs]) if (job.id !== finishingJobId && job.kind === 'mine' &&
            this.footprint(job).every(q => this.exploredAt(q)) &&
            this.placementReason('mine', job)) this.cancel(job);
      }
    }
  }
  private dirtyCell(p: Pos) {
    const cx = Math.floor(p.x / CHUNK),
      cy = Math.floor(p.y / CHUNK);
    this.dirty.add(cy * 4 + cx);
    for (const [dx, dy] of horizontal) {
      const nx = p.x + dx,
        ny = p.y + dy;
      if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < DEPTH)
        this.dirty.add(Math.floor(ny / CHUNK) * 4 + Math.floor(nx / CHUNK));
    }
  }
  chunks(): ChunkUpdate[] {
    const out: ChunkUpdate[] = [];
    for (const id of this.dirty) {
      const blocks = new Uint8Array(CHUNK ** 3),
        ladders = new Uint8Array(CHUNK ** 3), explored = new Uint8Array(CHUNK ** 3),
        water = new Uint8Array(CHUNK ** 3), bridges = new Uint8Array(CHUNK ** 3);
      const ox = (id % 4) * CHUNK,
        oy = Math.floor(id / 4) * CHUNK;
      for (let z = 0; z < 16; z++)
        for (let y = 0; y < 16; y++) {
          const src = index(ox, oy + y, z),
            dst = (z * 16 + y) * 16;
          for (let x = 0; x < 16; x++) {
            explored[dst + x] = this.explored[src + x];
            blocks[dst + x] = explored[dst + x] ? this.blocks[src + x] : Block.Stone;
            ladders[dst + x] = explored[dst + x] ? this.ladders[src + x] : 0;
            water[dst + x] = explored[dst + x] ? this.water[src + x] : 0;
            bridges[dst + x] = explored[dst + x] ? this.bridges[src + x] : 0;
          }
        }
      out.push({ id, blocks, ladders, explored, water, bridges });
    }
    this.dirty.clear();
    return out;
  }
  exploredAt(p: Pos): boolean { return inside(p) && this.explored[at(p)] === 1; }
  visibleRoomIds(): Int32Array {
    const ids = this.rooms.roomIds.slice();
    for (let i = 0; i < CELLS; i++) if (!this.explored[i]) ids[i] = -1;
    return ids;
  }
  solid(p: Pos) {
    return !inside(p) || this.blocks[at(p)] !== Block.Air;
  }
  standable(p: Pos) {
    if (!inside(p) || p.z < 1 || p.z + 1 >= HEIGHT) return false;
    const i = at(p);
    return (
      this.blocks[i] === 0 &&
      this.blocks[i + WIDTH * DEPTH] === 0 &&
      (!this.waterPresent || (!this.water[i] && !this.water[i + WIDTH * DEPTH] &&
        !(this.water[i - WIDTH * DEPTH] === 2 && this.blocks[i - WIDTH * DEPTH] === Block.Air))) &&
      !this.treeCells.has(i) &&
      !this.treeCells.has(i + WIDTH * DEPTH) &&
      !this.stoveCells.has(i) &&
      !this.deviceBlocks.has(i) &&
      !this.deviceBlocks.has(i + WIDTH * DEPTH) &&
      this.gateAt(p)?.mode !== 'locked' &&
      !this.doors.some(
        (d) =>
          d.mode === 'locked' &&
          d.x === p.x &&
          d.y === p.y &&
          (d.z === p.z || d.z + 1 === p.z || d.z === p.z + 1),
      ) &&
      (this.blocks[i - WIDTH * DEPTH] !== 0 || this.water[i - WIDTH * DEPTH] === 1 || this.ladders[i] === 1)
    );
  }
  private canStop(p: Pos) {
    return this.exploredAt(p) && this.exploredAt({ ...p, z: p.z + 1 }) && this.standable(p) && !this.shelfAt(p) && !this.fenceAt(p) && !this.sandbags.some((b) => same(b, p));
  }
  private refreshPens() {
    if (this.penLookupRevision === this.revision) return;
    this.fenceLookup = new Map(this.fences.map(f => [at(f), f]));
    this.gateLookup = new Map(this.fenceGates.map(g => [at(g), g]));
    this.markerLookup = new Map(this.penMarkers.map(m => [at(m), m]));
    this.penLookupRevision = this.revision;
  }
  private fenceAt(p: Pos) { this.refreshPens(); return this.fenceLookup.get(at(p)); }
  private gateAt(p: Pos) { this.refreshPens(); return this.gateLookup.get(at(p)); }
  private markerAt(p: Pos) { this.refreshPens(); return this.markerLookup.get(at(p)); }
  penStandable(p: Pos): boolean {
    return this.standable(p) && !!this.blocks[at(p) - WIDTH * DEPTH] && !this.ladders[at(p)] &&
      !this.fenceAt(p) && (!this.furnitureAt(p) || !!this.markerAt(p) || !!this.gateAt(p) || this.doors.some(d => same(d,p)));
  }
  penNeighbors(p: Pos, mode: 'enclosure' | 'rope'): number[] {
    const pass = (q: Pos) => {
      if (!this.penStandable(q)) return false;
      const gate = this.gateAt(q) ?? this.doors.find(d => same(d,q));
      return !gate || gate.mode === 'open' || (mode === 'rope' && gate.mode === 'auto');
    };
    if (!pass(p)) return [];
    return this.neighbors(p).filter(n => isAnimalGroundStep(p, position(n)) && pass(position(n)));
  }
  private neighbors(p: Pos): number[] {
    const out: number[] = [];
    for (const [dx, dy] of horizontal) {
      for (const dz of [0, 1, -1]) {
        const n = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
        if (!this.standable(n)) continue;
        // Step up needs clearance over the old head; descending needs the inverse.
        if (dz === 1 && this.solid({ x: p.x, y: p.y, z: p.z + 2 })) continue;
        if (dz === -1 && this.solid({ x: n.x, y: n.y, z: n.z + 2 })) continue;
        out.push(at(n));
      }
    }
    if (this.ladders[at(p)])
      for (const dz of [-1, 1]) {
        const n = { ...p, z: p.z + dz };
        if (this.standable(n) && this.ladders[at(n)]) out.push(at(n));
      }
    return out;
  }
  private search(p: Pos, allowed?: Set<number>) {
    // Keep hop distances for work scanning and geometric limits such as dining
    // range. Once a destination is chosen, route() plans the actual weighted trip.
    this.searchOrigin = p;
    this.searchAllowed = allowed;
    this.distance.fill(-1);
    this.parents.fill(-1);
    let head = 0,
      tail = 1;
    const start = at(p);
    this.queue[0] = start;
    this.distance[start] = 0;
    while (head < tail) {
      const current = this.queue[head++];
      for (const n of this.neighbors(position(current))) {
        if (allowed && !allowed.has(n)) continue;
        if (this.distance[n] >= 0) continue;
        this.distance[n] = this.distance[current] + 1;
        this.parents[n] = current;
        this.queue[tail++] = n;
      }
    }
  }
  private route(target: number) {
    return this.searchOrigin ? this.travelRoute(this.searchOrigin, target, this.searchAllowed) ?? [] : [];
  }
  private pawnBaseMoveTicks(p?: Pawn) {
    return p ? (p.cargo || p.carryingPawnId !== null ? 6 : 4) /
      (apparelMoveFactor(p.worn, healthSummary(p).moving) * (p.staggerUntil > this.tick ? .17 : 1)) : 4;
  }
  private crossingTicks(from: Pos, to: Pos) {
    return (this.fenceAt(to) && !this.fenceAt(from)) ||
      (this.sandbags.some(b => same(b,to)) && !this.sandbags.some(b => same(b,from))) ||
      this.shelfAt(to) ? 14 : 0;
  }
  private doorWaitTicks(to: Pos) {
    const door = this.gateAt(to) ?? this.doors.find(d => same(d,to));
    if (!door || door.mode !== 'auto') return 0;
    return door.openUntil === 0 || door.openUntil < this.tick ? 13 : Math.max(0, door.openUntil - 37 - this.tick);
  }
  private travelRoute(from: Pos, target: number, allowed?: Set<number>): number[] | null {
    const pawn = this.pawns.includes(from as Pawn) ? from as Pawn : undefined;
    const area = pawn && effectivePawnArea(pawn,this.animalAreas,this.tick);
    const areaCells = area ? allowedAreaCells(area) : undefined;
    const base = this.pawnBaseMoveTicks(pawn), destination = position(target);
    // One horizontal step may also change elevation; this lower bound supports
    // both those steps and the vertical ladder edges without overestimating.
    const minimum = Math.max(1, Math.floor(base));
    return this.navigation.find(at(from), n => n === target,
      n => this.neighbors(position(n)).filter(next => !allowed || allowed.has(next)),
      (a,b) => this.weatherMoveTicks(position(a),base,position(b),this.crossingTicks(position(a),position(b))) +
        this.doorWaitTicks(position(b)) + (areaCells && !areaCells.has(b) ? base * 10 : 0),
      n => { const p = position(n); return minimum * Math.max(Math.abs(p.x-destination.x)+Math.abs(p.y-destination.y),Math.abs(p.z-destination.z)); });
  }
  path(from: Pos, to: Pos) {
    if (!inside(from) || !inside(to) || !this.standable(from) || !this.canStop(to)) return null;
    return this.travelRoute(from,at(to));
  }
  private stands(j: Job): number[] {
    const shelf = j.kind === 'remove' ? this.shelfAt(j) : undefined;
    if (isShelfKind(j.kind) || shelf) {
      const cells = shelfCells(shelf ?? { ...j, kind: j.kind as Shelf['kind'], axis: j.axis ?? 'x' });
      return cells.flatMap(c => horizontal.map(([dx,dy]) => ({ x:c.x+dx, y:c.y+dy, z:c.z })))
        .filter(q => this.canStop(q) && !cells.some(c => same(c,q))).map(at);
    }
    if (j.kind === 'install' || j.kind === 'uninstall') {
      const cells = this.furnitureCells(j.furnitureKind!, j, j.axis ?? 'x');
      return cells.flatMap(c => horizontal.map(([dx,dy]) => ({x:c.x+dx,y:c.y+dy,z:c.z})))
        .filter(q => this.canStop(q) && !cells.some(c => same(c,q))).map(at);
    }
    const table = j.kind === 'remove' ? this.tableAt(j) : undefined;
    if (j.kind === 'table' || table) {
      const cells = tableCells(table ?? {...j,axis:j.axis ?? 'x'});
      return cells.flatMap(c=>horizontal.map(([dx,dy])=>({x:c.x+dx,y:c.y+dy,z:c.z})))
        .filter(q=>this.canStop(q) && !cells.some(c=>same(c,q))).map(at);
    }
    if (j.kind === 'research') {
      const bench = this.researchBenches.find((b) => same(b, j));
      if (!bench) return [];
      const point = researchBenchInteraction(bench);
      return this.canStop(point) ? [at(point)] : [];
    }
    const researchBench = j.kind === 'remove' ? this.researchBenchAt(j) : undefined;
    if (j.kind === 'researchBench' || researchBench) {
      const cells = researchBenchCells(researchBench ?? { ...j, axis: j.axis ?? 'x' });
      return cells
        .flatMap((v) => horizontal.map(([dx, dy]) => ({ x: v.x + dx, y: v.y + dy, z: v.z })))
        .filter((q) => this.canStop(q) && !cells.some((c) => same(c, q)))
        .map(at);
    }
    if (j.kind === 'smith' || j.kind === 'armorsmith') {
      const bench = this.weaponBenches.find((b) => same(b, j));
      if (!bench) return [];
      const point = weaponBenchInteraction(bench);
      return this.canStop(point) ? [at(point)] : [];
    }
    if (j.kind === 'tailoring') {
      const bench = this.tailors.find((b) => same(b, j));
      if (!bench) return [];
      const point = tailorInteraction(bench);
      return this.canStop(point) ? [at(point)] : [];
    }
    if (j.kind === 'stonecut') {
      const bench = this.stonecutters.find((b) => same(b, j));
      if (!bench) return [];
      const point = stonecutterInteraction(bench);
      return this.canStop(point) ? [at(point)] : [];
    }
    const device = j.kind === 'refuel' || j.kind === 'remove' ? this.deviceAt(j) : undefined;
    const bench =
      j.kind === 'remove' || j.kind === 'refuel'
        ? (this.stonecutterAt(j) ?? this.tailorAt(j) ?? this.weaponBenchAt(j))
        : undefined;
    const cells =
      j.kind === 'stonecutter' ||
      j.kind === 'tailor' ||
      j.kind === 'smithy' ||
      j.kind === 'machining'
        ? stonecutterCells({ ...j, axis: j.axis ?? 'x' })
        : bench
          ? 'kind' in bench
            ? weaponBenchCells(bench)
            : stonecutterCells(bench)
          : isDeviceKind(j.kind)
            ? deviceCells({ ...j, kind: j.kind, axis: j.axis ?? 'x' })
            : device
              ? deviceCells(device)
              : [j];
    const candidates: Pos[] = cells.flatMap((v) =>
      horizontal.map(([dx, dy]) => ({ x: v.x + dx, y: v.y + dy, z: v.z })),
    );
    if (j.kind === 'wire') candidates.push(j, { ...j, z: j.z - 1 }, { ...j, z: j.z + 1 });
    if (j.kind === 'floor' || j.kind === 'bridge' || j.kind === 'sow' || j.kind === 'harvest') candidates.push({ ...j });
    if (j.kind === 'ladder' || j.kind === 'digLadder')
      candidates.push({ ...j, z: j.z + 1 }, { ...j, z: j.z - 1 });
    if (j.kind === 'remove' && this.ladders[at(j)])
      candidates.push({ ...j, z: j.z - 1 }, { ...j, z: j.z + 1 });
    return candidates
      .filter(
        (p) =>
          this.exploredAt(p) && this.exploredAt({ ...p, z: p.z + 1 }) &&
          this.canStop(p) &&
          !this.fenceAt(p) &&
          !this.sandbags.some((b) => same(b, p)) &&
          (!(
            isDeviceKind(j.kind) ||
            j.kind === 'stonecutter' ||
            j.kind === 'tailor' ||
            j.kind === 'smithy' ||
            j.kind === 'machining'
          ) ||
            !cells.some((c) => same(c, p))),
      )
      .map(at);
  }
  private reachableStand(j: Job, pawn?: Pawn) {
    if (pawn && !this.pawnAllowed(pawn,j)) return -1;
    let best = -1;
    for (const n of this.stands(j))
      if (this.distance[n] >= 0 && (best < 0 || this.distance[n] < this.distance[best])) best = n;
    return best;
  }
  private groundAllowed(p: Pos): boolean {
    return (
      (this.canStop(p) || (!!this.shelfAt(p) && this.standable(p))) &&
      (this.blocks[at(p) - WIDTH * DEPTH] !== 0 || waterBelow(this.water,this.blocks,p) === 1) &&
      !this.ladders[at(p)] &&
      !this.chairs.some(c => same(c,p)) &&
      !this.bedAt(p)
    );
  }
  shelfAt(p: Pos) { return this.shelfLookup.get(at(p)); }
  storageCells(): StorageCell[] {
    return [...this.stockpiles.map(s => ({ ...s, provider:'stockpile' as const, shelfId:null, maxStacks:1 })),
      ...this.shelves.flatMap(s => shelfCells(s).map(p => ({ ...p, ...this.shelfSettings(s),
        provider:'shelf' as const, shelfId:s.id, maxStacks:SHELF_STACKS })))];
  }
  /** A shelf is traversable, but picking/placing happens from a cardinal,
   * same-floor stopping cell. Walls and floor changes cannot be touched through. */
  itemStands(item: Pos): Pos[] {
    return (this.shelfAt(item) ? horizontal.map(([dx,dy]) => ({ x:item.x+dx, y:item.y+dy, z:item.z })) : [item])
      .filter(p => inside(p) && this.canStop(p));
  }
  itemTouch(actor: Pos, item: Pos): boolean { return this.itemStands(item).some(p => same(p, actor)); }
  private reachableItemStand(item: Pos): number {
    let best = -1;
    for (const p of this.itemStands(item)) {
      const cell = at(p);
      if (this.distance[cell] >= 0 && (best < 0 || this.distance[cell] < this.distance[best])) best = cell;
    }
    return best;
  }
  itemPath(from: Pos, item: Pos, allowed?: Set<number>): number[] | null {
    if (!inside(from) || !inside(item) || !this.standable(from) ||
        (allowed && (!allowed.has(at(from)) || !allowed.has(at(item))))) return null;
    this.search(from, allowed);
    const target = this.reachableItemStand(item);
    return target < 0 ? null : this.route(target);
  }
  /** A bounded walk, never a straight-line jump through a wall or another floor. */
  private nearby(origin: Pos, distance = DROP_DISTANCE): Pos[] {
    if (!this.standable(origin)) return [];
    const cells = [at(origin)],
      depths = [0],
      seen = new Set(cells);
    for (let n = 0; n < cells.length; n++) {
      if (depths[n] === distance) continue;
      for (const cell of this.neighbors(position(cells[n])))
        if (!seen.has(cell)) {
          seen.add(cell);
          cells.push(cell);
          depths.push(depths[n] + 1);
        }
    }
    return cells.map(position);
  }
  /** Operation-local indexes: item mutations elsewhere cannot leave a cached
   * capacity behind. A placement trial updates its own indexed copies. */
  private storageContext(items = this.items, ignorePawnId?: number) {
    const stacks = new Map<number, Stack[]>(), reservations = new Map<number, Cargo[]>();
    for (const item of items) {
      const cell = at(item), group = stacks.get(cell);
      if (group) group.push(item);
      else stacks.set(cell, [item]);
    }
    for (const [id, r] of this.storageReservations) if (id !== ignorePawnId) {
      const group = reservations.get(r.cell);
      if (group) group.push(r.batch);
      else reservations.set(r.cell, [r.batch]);
    }
    return { stacks, reservations };
  }
  private reservedSpace(cell: number, batch: BatchKind, context: ReturnType<VoxelSimulation['storageContext']>, mergeForbidden = true): number {
    return cellSpaceAfterReservations(context.stacks.get(cell) ?? [], context.reservations.get(cell) ?? [], batch,
      this.shelfLookup.has(cell) ? SHELF_STACKS : 1, mergeForbidden);
  }
  /** Trial placement is atomic: no ids, amounts, ages or containers mutate on failure. */
  private planPlacement(
    entries: { batch: Cargo; origin: Pos; cells?: Pos[]; sourceId?: number }[],
    base = this.items,
    distance = DROP_DISTANCE,
    forbidden = new Set<number>(),
    ignorePawnId?: number,
    additionalReservation?: { cell: number; batch: Cargo },
    mergeForbidden = true,
  ) {
    const items = base.map((i) => ({ ...i })), context = this.storageContext(items, ignorePawnId);
    if (additionalReservation) context.reservations.set(additionalReservation.cell,
      [...(context.reservations.get(additionalReservation.cell) ?? []), additionalReservation.batch]);
    let nextId = this.nextId;
    for (const { batch, origin, cells, sourceId } of entries) {
      let left = batch.amount;
      for (const p of cells ?? this.nearby(origin, distance)) {
        const cell = at(p);
        if (forbidden.has(cell) || !this.groundAllowed(p)) continue;
        const shelf = this.shelfAt(p);
        if (shelf && (!shelfAllows(batch) || !this.shelfSettings(shelf).accepts.includes(batch.resource))) continue;
        const n = Math.min(left, this.reservedSpace(cell, batch, context, mergeForbidden));
        if (!n) continue;
        const stacks = context.stacks.get(cell) ?? [], placed = planCellInsertion(stacks, { ...batch, amount: n }, shelf ? SHELF_STACKS : 1, mergeForbidden);
        for (const merge of placed.merges) mergeBatch(stacks[merge.index], portion(batch, merge.amount));
        for (const amount of placed.additions) {
          const preserve = sourceId !== undefined && amount === batch.amount && !items.some(i => i.id === sourceId);
          const added = { ...portion(batch, amount), x: p.x, y: p.y, z: p.z, id: preserve ? sourceId : nextId++ };
          stacks.push(added); items.push(added);
        }
        context.stacks.set(cell, stacks);
        left -= placed.accepted;
        if (!left) break;
      }
      if (left) return null;
    }
    if (items.length > 10000 || nextId >= 10000000) return null;
    return { items, nextId };
  }
  private commitPlacement(plan: NonNullable<ReturnType<VoxelSimulation['planPlacement']>>) {
    const existing = new Map(this.items.map((item) => [item.id, item]));
    this.items = plan.items.map((item) => {
      const previous = existing.get(item.id);
      if (!previous) return item;
      // A merge can restore canonical full HP (no optional field). Assignment
      // alone would retain the old damaged HP on the existing object.
      for (const key of Object.keys(previous) as (keyof Stack)[])
        if (!Object.hasOwn(item, key)) delete previous[key];
      return Object.assign(previous, item);
    });
    this.nextId = plan.nextId;
    this.pruneStorageSpills();
    this.revision++;
  }
  animalWoolPlace(p: Pawn, amount: number, commit: boolean): boolean {
    const plan = this.planPlacement([{batch:freshBatch('alpacaWool',amount),origin:p}],this.items,DROP_DISTANCE,new Set(),p.id);
    if (!plan) return false;
    if (commit) { this.commitPlacement(plan); this.stats.produced.alpacaWool += amount; }
    return true;
  }
  animalMilkPlace(p: Pawn, amount: number, commit: boolean): boolean {
    const plan = this.planPlacement([{batch:freshBatch('milk',amount),origin:p}],this.items,DROP_DISTANCE,new Set(),p.id);
    if (!plan) return false;
    if (commit) { this.commitPlacement(plan); this.stats.produced.milk += amount; }
    return true;
  }
  private addItem(resource: Resource, amount: number, p: Pos, source?: Cargo): boolean {
    if (amount <= 0) return true;
    const plan = this.planPlacement([
      { batch: source ? portion(source, amount) : freshBatch(resource, amount), origin: p },
    ]);
    if (!plan) return false;
    this.commitPlacement(plan);
    return true;
  }
  private dropCargo(p: Pawn): boolean {
    if (!p.cargo) return true;
    const plan = this.planPlacement(
      [{ batch: p.cargo, origin: p }],
      this.items,
      DROP_DISTANCE,
      new Set(),
      p.id,
    );
    if (!plan) return false;
    this.commitPlacement(plan);
    p.cargo = null;
    this.storageReservations.delete(p.id);
    return true;
  }
  private deliverBatch(job: Job, source: Cargo, amount: number) {
    const incoming = portion(source, amount),
      old = job.deliveredBatches.find((batch) => compatibleBatches(batch, incoming));
    if (old) mergeBatch(old, incoming);
    else job.deliveredBatches.push(incoming);
  }
  private storagePriority(item: Cargo & Pos): number {
    const shelf = this.shelfAt(item);
    if (shelf) { const settings=this.shelfSettings(shelf); return settings.accepts.includes(item.resource) && shelfAllows(item) ? settings.priority : -1; }
    return (
      this.stockpiles.find((s) => same(s, item) && s.accepts.includes(item.resource))?.priority ??
      -1
    );
  }
  storageSpace(p: Pos, batch: BatchKind, ignorePawnId?: number, context = this.storageContext(this.items, ignorePawnId)): number {
    const shelf = this.shelfAt(p), stock = shelf ? this.shelfSettings(shelf) : this.stockpiles.find((s) => same(s, p));
    return stock?.accepts.includes(batch.resource) && (!shelf || shelfAllows(batch)) && this.groundAllowed(p)
      ? this.reservedSpace(at(p), batch, context, false)
      : 0;
  }
  storageCapacity(): StorageCapacity[] {
    const context = this.storageContext();
    return this.storageCells().map((p) => {
      const stacks = context.stacks.get(at(p)) ?? [], item = stacks[0],
        available = emptyCounts();
      const virtual = stacks.map(i => ({ ...i }));
      for (const batch of context.reservations.get(at(p)) ?? []) {
        const plan = planCellInsertion(virtual, batch, p.maxStacks, false);
        for (const m of plan.merges) virtual[m.index].amount += m.amount;
        for (const amount of plan.additions) virtual.push({ ...batch, amount } as Stack);
      }
      const availableGrain = { rice: 0, potato: 0, corn: 0 };
      for (const crop of ['rice', 'potato', 'corn'] as const)
        availableGrain[crop] = this.storageSpace(p, { resource: 'grain', crop }, undefined, context);
      for (const resource of resources)
        available[resource] =
          resource === 'grain'
            ? Math.max(...Object.values(availableGrain))
            : this.storageSpace(p, { resource }, undefined, context);
      return {
        x: p.x,
        y: p.y,
        z: p.z,
        provider: p.provider, shelfId: p.shelfId, maxStacks: p.maxStacks,
        occupiedSlots: stacks.length, reservedSlots: virtual.length - stacks.length,
        stacks: stacks.map(i => ({ id:i.id, resource:i.resource, amount:i.amount, limit:stackLimit(i.resource) })),
        occupied: !!item,
        resource: item?.resource ?? null,
        crop: item?.crop ?? null,
        amount: item?.amount ?? 0,
        limit: item ? stackLimit(item.resource) : 0,
        reserved: (context.reservations.get(at(p)) ?? []).reduce((n, batch) => n + batch.amount, 0),
        available,
        availableGrain,
      };
    });
  }
  /** Requires search(origin) first; prefer strictly higher priority, then distance. */
  private storageDestination(
    batch: Cargo,
    minimumPriority = -1,
    ignorePawnId?: number,
    allowedCells?: Set<number>,
    items = this.items,
  ): (StorageCell & { stand: number }) | undefined {
    const context = this.storageContext(items, ignorePawnId);
    const worker = this.pawns.find(p => p.id === ignorePawnId);
    let best: (StorageCell & { stand: number }) | undefined;
    for (const s of this.storageCells()) {
      const stand = this.reachableItemStand(s);
      if (
        (worker && !this.pawnAllowed(worker,s)) || (allowedCells && !allowedCells.has(at(s))) || s.priority <= minimumPriority ||
        this.storageSpace(s, batch, ignorePawnId, context) <= 0 ||
        stand < 0
      )
        continue;
      if (
        !best ||
        s.priority > best.priority ||
        (s.priority === best.priority && this.distance[stand] < this.distance[best.stand])
      )
        best = { ...s, stand };
    }
    return best;
  }
  private reconcileProductionStorage() {
    reconcileStockpileZones(this);
    reconcileProductionOutputs(this);
  }
  private interruptProductionDelivery(p: Pawn) {
    const task = p.productionDelivery;
    this.release(p);
    if (task && p.cargo && !p.dead && !p.downed && !p.drafted && p.faction === 'colony') {
      p.productionDelivery = { ...task, state: 'dropping' };
      // A caller may still hold a pending shelf-removal placement plan. Dropping
      // here would create goods that its later commit overwrites. Keep ownership
      // on the pawn until the transaction has ended and normal ticks can drop it.
      p.reason = '送货目标或通路改变，保留成品等待就近放下';
    }
  }
  /** A completed producer delivers its own cargo without entering the work
   * scheduler or reusing that cargo as another job's ingredients. */
  private continueProductionDelivery(p: Pawn) {
    const task = p.productionDelivery;
    if (!task || !p.cargo) { this.release(p); return; }
    const drop = () => {
      task.state = 'dropping';
      this.storageReservations.delete(p.id); p.path = []; p.destination = null; p.phase = 'idle';
      if (this.dropCargo(p)) { this.release(p); p.reason = '成品送货中断，已放在附近'; }
      else p.reason = '附近没有落点，保留成品等待空间';
    };
    if (task.state === 'dropping') { drop(); return; }
    this.search(p);
    const target = this.storageCells().find(s => at(s) === task.cell);
    const stand = target ? this.reachableItemStand(target) : -1;
    if (!target || !this.pawnAllowed(p,target) || stand < 0 || this.storageSpace(target, p.cargo, p.id) < p.cargo.amount ||
        (task.mode === 'specific' && !productionOutputTargetCells(this, task.target!).includes(task.cell))) {
      drop(); return;
    }
    if (this.reserveStorage(p, p.cargo, target, null) !== p.cargo.amount) { drop(); return; }
    if (!this.itemTouch(p, target)) {
      this.go(p, stand, 'haul');
      p.reason = `制作完成，送往${productionOutputTargetName(this, task.target)}`;
      return;
    }
    const amount = p.cargo.amount;
    const plan = this.planPlacement([{batch:p.cargo, origin:target, cells:[target]}], this.items, 0, new Set(), p.id, undefined, false);
    if (!plan) { drop(); return; }
    this.commitPlacement(plan); this.stats.hauled += amount; p.cargo = null;
    this.release(p); p.reason = '成品已送入仓库';
  }
  private canImproveStorage(item: Stack): boolean {
    const priority = this.storagePriority(item), context = this.storageContext();
    return this.storageCells().some((s) => s.priority > priority && this.storageSpace(s, item, undefined, context) > 0);
  }
  private reserveStorage(
    p: Pawn,
    batch: Cargo,
    target: Stockpile,
    sourceId: number | null,
  ): number {
    const source = sourceId === null ? null : this.items.find(i => i.id === sourceId);
    if (!this.pawnAllowed(p,target) || (source && !this.pawnAllowed(p,source)) || (sourceId !== null && !source)) { this.storageReservations.delete(p.id); return 0; }
    const n = Math.min(
      batch.amount,
      carryLimit(batch.resource),
      this.storageSpace(target, batch, p.id),
      source ? this.availableStack(source, p.id) : batch.amount,
    );
    if (n > 0)
      this.storageReservations.set(p.id, { cell: at(target), batch: portion(batch, n), sourceId });
    else this.storageReservations.delete(p.id);
    return n;
  }
  private refreshReservations() {
    if (!this.storageReservations.size) return;
    // Re-admit reservations once in stable order. Testing each one against all
    // the others can evict both when one slot was lost or a filter changed.
    const previous = [...this.storageReservations].sort(([a], [b]) => a - b);
    this.storageReservations.clear();
    for (const [id, r] of previous) {
      const pawn = this.pawns.find((p) => p.id === id);
      const source = r.sourceId === null ? pawn?.cargo : this.items.find(i => i.id === r.sourceId);
      if (!pawn || pawn.phase !== 'haul' || !source || !compatibleBatches(source, r.batch) || !this.pawnAllowed(pawn,position(r.cell)) || (r.sourceId !== null && !this.pawnAllowed(pawn,source as Stack))) continue;
      const amount = Math.min(r.batch.amount, source.amount,
        r.sourceId === null ? source.amount : this.availableStack(source as Stack, id),
        this.storageSpace(position(r.cell), source, id));
      if (amount > 0) this.storageReservations.set(id, { ...r, batch: portion(source, amount) });
    }
  }
  private acceptsJobCargo(j: Job, cargo: Cargo, source?: Pos): boolean {
    if (cargo.unfinished) return cargo.unfinished.id === j.unfinishedId;
    if (j.unfinishedId !== undefined) return false;
    const recipe = productionJobRecipe(j);
    if (recipe && !productionPolicyAllowsIngredient(this.productionPolicyFor(j), recipe, cargo, source, j)) return false;
    return cargo.resource !== 'furniture' || (j.kind === 'install' && !!cargo.furniture && cargo.furniture.id === j.furnitureId && cargo.furniture.kind === j.furnitureKind);
  }
  private pileFor(p: Pawn, resource?: Resource, job?: Job) {
    let best: Stack | undefined;
    for (const item of this.items) {
      if (
        !this.pawnAllowed(p,item) || this.availableStack(item, p.id) < 1 ||
        (resource && item.resource !== resource) ||
        (job && !this.acceptsJobCargo(job, item, item)) ||
        this.chunkReserved(item, p.id)
      )
        continue;
      const stand = this.reachableItemStand(item), d = stand < 0 ? -1 : this.distance[stand];
      if (d < 0) continue;
      if (!best || d < this.distance[this.reachableItemStand(best)]) best = item;
    }
    return best;
  }
  private chunkReserved(item: Stack, pawnId: number): boolean {
    if (itemForbiddenTo(this.pawns.find(p => p.id === pawnId), item, this.tick)) return true;
    if (item.unfinished && (item.forbidden || this.jobs.some(j => j.unfinishedId === item.unfinished!.id &&
      j.owner !== null && j.owner !== pawnId && !j.cancelled))) return true;
    if (item.weapon) {
      const assigned = this.pawns.find((p) => p.weaponTask?.weaponId === item.weapon!.id);
      if ((item.forbidden && assigned?.id !== pawnId) || (assigned && assigned.id !== pawnId))
        return true;
    }
    if (
      item.apparel &&
      this.pawns.some((p) => p.id !== pawnId && p.apparelTask?.apparelId === item.apparel!.id)
    )
      return true;
    return (
      (item.resource === 'chunk' || item.resource === 'carcass' || item.resource === 'furniture' || item.resource === 'unfinished') &&
      ([...this.fetchReservations].some(([id, source]) => id !== pawnId && source.sourceId === item.id) ||
        [...this.storageReservations].some(([id, r]) => id !== pawnId && r.sourceId === item.id))
    );
  }
  private go(p: Pawn, target: number, phase: Pawn['phase']) {
    p.destination = target;
    p.path = this.route(target);
    p.phase = phase;
  }
  private footprint(j: Pos & { kind: JobKind; axis?: Axis; furnitureKind?: RelocatableKind }): Pos[] {
    if (isShelfKind(j.kind)) return shelfCells({ ...j, kind:j.kind, axis:j.axis ?? 'x' }).flatMap(q => [q, {...q,z:q.z+1}]);
    if (j.kind === 'install' || j.kind === 'uninstall')
      return this.furnitureCells(j.furnitureKind!, j, j.axis ?? 'x').flatMap(q => [q, {...q,z:q.z+1}]);
    if (j.kind === 'researchBench' || j.kind === 'research') {
      const bench =
        j.kind === 'research' ? this.researchBenches.find((b) => same(b, j)) : undefined;
      return researchBenchCells(bench ?? { ...j, axis: j.axis ?? 'x' }).flatMap((p) => [
        p,
        { ...p, z: p.z + 1 },
      ]);
    }
    if (
      j.kind === 'stonecutter' ||
      j.kind === 'tailor' ||
      j.kind === 'smithy' ||
      j.kind === 'machining'
    )
      return stonecutterCells({ ...j, axis: j.axis ?? 'x' }).flatMap((p) => [
        p,
        { ...p, z: p.z + 1 },
      ]);
    if (isDeviceKind(j.kind))
      return deviceCells({ ...j, kind: j.kind, axis: j.axis ?? 'x' }).flatMap((p) => [
        p,
        { ...p, z: p.z + 1 },
      ]);
    if (j.kind === 'table') return tableCells({ ...j, axis: j.axis ?? 'x' }).flatMap(p => [p, { ...p, z: p.z + 1 }]);
    if (j.kind === 'bed') return bedCells({ ...j, axis: j.axis ?? 'x' });
    if (j.kind === 'floor' || j.kind === 'bridge') return [{ ...j, z: j.z - 1 }];
    if (['wall', 'mine', 'door'].includes(j.kind)) return [j, { ...j, z: j.z + 1 }];
    return [j];
  }
  private jobCellConflict(
    j: Pos & { kind: JobKind; axis?: Axis; furnitureKind?: RelocatableKind },
    k: Pos & { kind: JobKind; axis?: Axis; furnitureKind?: RelocatableKind },
  ) {
    if ((j.kind === 'wire') !== (k.kind === 'wire')) return false;
    return this.footprint(j).some((a) => this.footprint(k).some((b) => same(a, b)));
  }
  private deviceAt(p: Pos) {
    return this.devices.find((d) =>
      deviceCells(d).some((q) => q.x === p.x && q.y === p.y && (q.z === p.z || q.z + 1 === p.z)),
    );
  }
  private rebuildDevices() {
    this.shelfLookup = new Map(this.shelves.flatMap(s => shelfCells(s).map(p => [at(p), s] as const)));
    this.deviceBlocks = new Set(
      [
        ...this.tables.flatMap(tableCells),
        ...this.devices.flatMap(deviceCells),
        ...this.stonecutters.flatMap(stonecutterCells),
        ...this.tailors.flatMap(tailorCells),
        ...this.researchBenches.flatMap(researchBenchCells),
        ...this.weaponBenches.filter((b) => b.kind !== 'craftingSpot').flatMap(weaponBenchCells),
      ].flatMap((p) => [at(p), at({ ...p, z: p.z + 1 })]),
    );
    this.skyCache.clear();
  }
  private tableAt(p: Pos) {
    return this.tables.find(t => tableCells(t).some(q => q.x === p.x && q.y === p.y && (q.z === p.z || q.z + 1 === p.z)));
  }
  private bedAt(p: Pos) {
    return this.beds.find((b) => bedCells(b).some((c) => same(c, p)));
  }
  private stonecutterAt(p: Pos) {
    return this.stonecutters.find((b) =>
      stonecutterCells(b).some(
        (q) => q.x === p.x && q.y === p.y && (p.z === q.z || p.z === q.z + 1),
      ),
    );
  }
  private tailorAt(p: Pos) {
    return this.tailors.find((b) =>
      tailorCells(b).some((q) => q.x === p.x && q.y === p.y && (p.z === q.z || p.z === q.z + 1)),
    );
  }
  private weaponBenchAt(p: Pos) {
    return this.weaponBenches.find((b) =>
      weaponBenchCells(b).some(
        (q) =>
          q.x === p.x &&
          q.y === p.y &&
          (q.z === p.z || (b.kind !== 'craftingSpot' && q.z + 1 === p.z)),
      ),
    );
  }
  private researchBenchAt(p: Pos) {
    return this.researchBenches.find((b) =>
      researchBenchCells(b).some(
        (q) => q.x === p.x && q.y === p.y && (q.z === p.z || q.z + 1 === p.z),
      ),
    );
  }
  researchBenchFactor(bench: ResearchBench): number {
    this.updateRooms();
    return simpleBenchFactor(this.rooms.roomAt(bench)?.outdoor ?? true, this.temperature(bench));
  }
  private furnitureAt(p: Pos) {
    return (
      this.shelfAt(p) || this.shelfAt({ ...p, z:p.z-1 }) ||
      this.fenceAt(p) || this.gateAt(p) || this.markerAt(p) ||
      this.tableAt(p) || this.chairs.find(c => c.x === p.x && c.y === p.y && (c.z === p.z || c.z + 1 === p.z)) ||
      this.horseshoePins.find(b => same(b, p)) ||
      this.butcherSpots.find(b => same(b, p)) ||
      this.sandbags.find((b) => same(b, p)) ||
      this.researchBenchAt(p) ||
      this.deviceAt(p) ||
      this.stonecutterAt(p) ||
      this.tailorAt(p) ||
      this.weaponBenchAt(p) ||
      this.beds.find((b) =>
        bedCells(b).some((q) => q.x === p.x && q.y === p.y && (p.z === q.z || p.z === q.z + 1)),
      ) ||
      this.doors.find((d) => d.x === p.x && d.y === p.y && (p.z === d.z || p.z === d.z + 1))
    );
  }
  private farmable(p: Pos) {
    return (
      this.standable(p) &&
      fertilityOf(this.blocks[at(p) - WIDTH * DEPTH]) >= MIN_CROP_FERTILITY &&
      !this.ladders[at(p)] &&
      !this.furnitureAt(p)
    );
  }
  private skyAt(p: Pos, tree = false) {
    const key = at(p) + (tree ? CELLS : 0);
    let sky = this.skyCache.get(key);
    if (sky === undefined) {
      sky = true;
      for (let z = p.z + (tree ? 2 : 0); z < HEIGHT; z++) {
        const i = index(p.x, p.y, z);
        if (
          this.blocks[i] ||
          this.treeCells.has(i) ||
          this.stoveCells.has(i) ||
          this.deviceBlocks.has(i)
        ) {
          sky = false;
          break;
        }
      }
      this.skyCache.set(key, sky);
    }
    return sky;
  }
  private treeEnvironment(tree: Tree) {
    const fertility = fertilityOf(this.blocks[at(tree) - WIDTH * DEPTH]);
    const hour = hourAt(this.tick),
      sky = this.skyAt(tree, true),
      light = sky ? daylight(hour) : 0;
    const temperature = this.temperature(tree);
    return {
      fertility,
      hour,
      sky,
      light,
      temperature,
      growthRate:
        tree.growth >= 1 ? 0 : treeGrowth(tree.species, fertility, light, temperature, hour),
    };
  }
  treeCondition(tree: Tree): TreeCondition {
    const e = this.treeEnvironment(tree);
    return {
      id: tree.id,
      fertility: e.fertility,
      light: e.light,
      temperature: e.temperature,
      growthRate: e.growthRate,
      yield: treeYield(tree, this.seed),
      mature: tree.growth > 0.999,
      ageDays: tree.age / DAY,
      reason:
        tree.health < 1
          ? '衰老或长期缺光损伤'
          : tree.growth > 0.999
            ? '成熟，可手动采伐'
            : e.fertility < TREE_DATA[tree.species].minFertility
              ? '土壤肥力不足'
              : !e.sky
                ? '上方遮挡，无阳光'
                : e.hour < 6 || e.hour > 19.2
                  ? '夜间休眠'
                  : e.light <= 0.51
                    ? '光照不足'
                    : e.growthRate > 0
                      ? '生长中'
                      : '温度不适',
    };
  }
  private treeSiteReason(p: Pos, species: TreeSpecies, ownJob?: number, natural = false) {
    if (
      !this.standable(p) ||
      fertilityOf(this.blocks[at(p) - WIDTH * DEPTH]) < TREE_DATA[species].minFertility
    )
      return '需要适生土壤、支撑和两格净空';
    if (!this.skyAt(p)) return '树苗需要露天位置';
    if (
      this.ladders[at(p)] ||
      this.ladders[at(p) + WIDTH * DEPTH] ||
      this.furnitureAt(p) ||
      this.stoves.some((s) => same(s, p)) ||
      this.farms.some((f) => same(f, p)) ||
      this.stockpiles.some((s) => same(s, p)) ||
      this.items.some((i) => same(i, p)) ||
      this.wires.some((w) => same(w, p)) ||
      (natural && this.treePlots.some((f) => same(f, p)))
    )
      return '与物资、区域或设施重叠';
    if (
      this.jobs.some(
        (j) =>
          j.id !== ownJob &&
          this.footprint(j).some((q) => q.x === p.x && q.y === p.y && Math.abs(q.z - p.z) < 2),
      )
    )
      return '与现有工作规划重叠';
    const adjacent = (q: Pos) =>
      Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1 && Math.abs(q.z - p.z) <= 1;
    if (
      this.trees.some(adjacent) ||
      this.treePlots.some((q) => !same(q, p) && adjacent(q)) ||
      this.crops.some(adjacent) ||
      this.farms.some(adjacent)
    )
      return '与相邻树木或作物至少间隔一格';
    return '';
  }
  private treeCanAppear(p: Pos, species: TreeSpecies, ownJob?: number, natural = false) {
    if (this.trees.length >= 4096 || this.treeSiteReason(p, species, ownJob, natural)) return false;
    const overlap = (q: Pos) => p.x === q.x && p.y === q.y && Math.abs(p.z - q.z) < 2;
    if (
      this.animals.some(overlap) ||
      this.pawns.some(
        (pawn) =>
          overlap(pawn) ||
          (pawn.destination !== null && overlap(position(pawn.destination))) ||
          pawn.path.some((i) => overlap(position(i))) ||
          (pawn.jobId !== ownJob && pawn.workTarget && overlap(pawn.workTarget)),
      ) ||
      this.jobs.some((j) => j.id !== ownJob && this.stands(j).some((i) => overlap(position(i)))) ||
      this.stonecutters.some((b) => overlap(stonecutterInteraction(b))) ||
      this.tailors.some((b) => overlap(tailorInteraction(b))) ||
      this.researchBenches.some((b) => overlap(researchBenchInteraction(b))) ||
      this.weaponBenches.some((b) => overlap(weaponBenchInteraction(b)))
    )
      return false;
    // A tree removes one walking vertex. It may not split any previously joined
    // neighbors, even if no pawn is currently using that narrow route.
    const neighbors = this.neighbors(p),
      lower = at(p),
      upper = lower + WIDTH * DEPTH;
    this.treeCells.add(lower);
    this.treeCells.add(upper);
    try {
      if (neighbors.length <= 1) return true;
      const seen = this.treeRouteSeen,
        queue = this.treeRouteQueue,
        remaining = new Set(neighbors.slice(1));
      seen.fill(0);
      queue[0] = neighbors[0];
      seen[neighbors[0]] = 1;
      let head = 0,
        tail = 1;
      while (head < tail && remaining.size) {
        for (const next of this.neighbors(position(queue[head++])))
          if (!seen[next]) {
            seen[next] = 1;
            queue[tail++] = next;
            remaining.delete(next);
          }
      }
      return remaining.size === 0;
    } finally {
      this.treeCells.delete(lower);
      this.treeCells.delete(upper);
    }
  }
  private createTree(p: Pos, species: TreeSpecies, planted: boolean) {
    this.trees.push({
      id: this.id(),
      x: p.x,
      y: p.y,
      z: p.z,
      species,
      wood: TREE_DATA[species].wood,
      growth: planted ? PLANTED_GROWTH : NATURAL_GROWTH,
      age: 0,
      health: 1,
      unlitTicks: 0,
      planted,
    });
    this.rebuildTrees();
    this.skyCache.clear();
    this.revision++;
    if (planted) this.stats.treesPlanted++;
    else this.stats.treesRegrown++;
  }
  private updateTrees() {
    const dead = new Set<number>();
    for (const tree of this.trees) {
      const e = this.treeEnvironment(tree);
      tree.age++;
      tree.unlitTicks = e.light <= 0.001 ? tree.unlitTicks + 1 : 0;
      tree.growth = Math.min(1, tree.growth + e.growthRate);
      tree.health = Math.max(0, tree.health - treeDamage(tree));
      if (tree.health <= 0) dead.add(tree.id);
    }
    if (dead.size) {
      for (const job of [...this.jobs])
        if (job.kind === 'cut' && this.trees.some((t) => dead.has(t.id) && same(t, job)))
          this.cancel(job);
      this.trees = this.trees.filter((t) => !dead.has(t.id));
      this.stats.treesDied += dead.size;
      this.rebuildTrees();
      this.skyCache.clear();
      this.revision++;
    }
    if (this.tick % ECOLOGY_INTERVAL !== 0 || this.trees.length >= NATURAL_TREE_CAP) return;
    const species = naturalSpecies(this.settings),
      data = TREE_DATA[species];
    if (this.ecologyRevision !== this.revision) {
      this.ecologySurface = [];
      for (let y = 0; y < DEPTH; y++)
        for (let x = 0; x < WIDTH; x++) {
          let z = HEIGHT - 1;
          while (z > 0 && !this.blocks[index(x, y, z)]) z--;
          if (z < HEIGHT - 2 && fertilityOf(this.blocks[index(x, y, z)]) >= data.minFertility)
            this.ecologySurface.push({ x, y, z: z + 1 });
        }
      this.ecologyRevision = this.revision;
    }
    const area = this.ecologySurface.length,
      cover = treeCover(this.settings);
    const capacity = Math.min(NATURAL_TREE_CAP, Math.ceil(area * cover * 1.25));
    if (!area || this.trees.length >= capacity) return;
    // Explicit 3D cadence/density adaptation: 16 sampled surface cells per 200
    // local ticks; scan-interval-normalized MTB of 20/25/35 days, bounded capacity.
    const mtbDays =
      this.settings.biome === 'desert' ? 35 : this.settings.biome === 'boreal' ? 25 : 20;
    const mtb = Math.min(1, (ECOLOGY_INTERVAL * area) / (ECOLOGY_SAMPLES * mtbDays * DAY));
    const epoch = this.tick / ECOLOGY_INTERVAL;
    for (let sample = 0; sample < ECOLOGY_SAMPLES && this.trees.length < capacity; sample++) {
      const p = this.ecologySurface[Math.floor(plantRandom(this.seed, epoch, sample, 8100) * area)];
      const fertility = fertilityOf(this.blocks[at(p) - WIDTH * DEPTH]);
      const chance =
        mtb * cover * (species === 'saguaro' ? 1 : Math.min(1.5, fertility * fertility));
      if (
        plantRandom(this.seed, epoch, sample, 8101) >= chance ||
        !this.skyAt(p) ||
        treeGrowth(
          species,
          fertility,
          daylight(hourAt(this.tick)),
          this.temperature(p),
          hourAt(this.tick),
        ) <= 0 ||
        !this.treeCanAppear(p, species, undefined, true)
      )
        continue;
      this.createTree(p, species, false);
    }
  }
  cropCondition(p: Pos, kind: CropKind) {
    const i = at(p);
    let sky = this.skyCache.get(i);
    if (sky === undefined) {
      sky = true;
      for (let z = p.z; z < HEIGHT; z++) {
        if (
          this.blocks[index(p.x, p.y, z)] ||
          this.treeCells.has(index(p.x, p.y, z)) ||
          this.stoveCells.has(index(p.x, p.y, z)) ||
          this.deviceBlocks.has(index(p.x, p.y, z))
        ) {
          sky = false;
          break;
        }
      }
      this.skyCache.set(i, sky);
    }
    const fertility = fertilityOf(this.blocks[i - WIDTH * DEPTH]);
    const hour = hourAt(this.tick),
      light = sky ? daylight(hour) : 0,
      temperature = this.temperature(p);
    const growthRate =
      fertility >= MIN_CROP_FERTILITY ? cropGrowth(kind, fertility, light, temperature, hour) : 0;
    const reason =
      fertility < MIN_CROP_FERTILITY
        ? '需要肥力至少 0.7 的土壤'
        : !sky
          ? '上方遮挡，无阳光'
          : hour < 6 || hour >= 19.2
            ? '夜间休眠'
            : light <= 0.51
              ? '光照不足'
              : growthRate > 0
                ? '生长中'
                : '温度不适';
    return { fertility, light, temperature, growthRate, reason };
  }
  private chooseMealIngredients(job: Job, worker?: Pawn) {
    if (job.productionPolicy) return;
    // Lock real ingredients; delivered batches retain their identity and age.
    const policy = this.productionPolicyFor(job);
    const cost: Partial<Counts> = { wood: SIMPLE_MEAL.wood };
    let remaining = SIMPLE_MEAL.ingredients;
    const order = (['meat', 'milk', 'grain'] as const).filter(r => policy.allowedFood.includes(r));
    for (const resource of order) {
      const reserved = this.jobs.filter(j => j !== job && !j.cancelled && j.owner !== null).reduce((n,j) => {
        const owner = this.pawns.find(p => p.id === j.owner);
        const carried = owner?.jobId === j.id && owner.cargo?.resource === resource ? owner.cargo.amount : 0;
        return n + Math.max(0, (j.cost[resource] ?? 0) - (j.delivered[resource] ?? 0) - carried);
      },0);
      const available = this.items.filter(i => i.resource === resource && !i.forbidden && this.exploredAt(i) &&
        this.acceptsJobCargo(job,i,i) && (!worker || this.pawnAllowed(worker,i) && this.reachableItemStand(i) >= 0))
        .reduce((n,i) => n + (worker ? this.availableStack(i,worker.id) : i.amount),0);
      const amount = Math.min(remaining, Math.max(0, available-reserved));
      if (amount) { cost[resource] = amount; remaining -= amount; }
    }
    // Keep an unmet cost, so an incomplete bill waits for a permitted resource.
    // No-filter bills cannot find an accepted ingredient and never consume it.
    const missing = order.at(-1) ?? 'grain';
    if (remaining) cost[missing] = (cost[missing] ?? 0) + remaining;
    job.cost = cost;
  }
  /** A garment is made from one textile. Only unclaimed batches can select a
   * material; carried inputs, frozen policies and unfinished pieces keep it. */
  private chooseTailorIngredients(job: Job, worker?: Pawn, replacing?: Job) {
    if (job.kind !== 'tailoring' || job.productionPolicy || job.unfinishedId !== undefined ||
        job.owner !== null || Object.values(job.delivered).some(n => n! > 0)) return;
    const policy = this.productionPolicyFor(job), needed = APPAREL_DEFS[job.apparelKind!].cloth;
    const material = policy.allowedTextiles.find(resource => {
      const reserved = this.jobs.filter(j => j !== job && j !== replacing && !j.cancelled &&
        j.owner !== null && j.unfinishedId === undefined).reduce((n,j) => {
        const owner = this.pawns.find(p => p.id === j.owner);
        const carried = owner?.jobId === j.id && owner.cargo?.resource === resource ? owner.cargo.amount : 0;
        return n + Math.max(0, (j.cost[resource] ?? 0) - (j.delivered[resource] ?? 0) - carried);
      },0);
      const available = this.items.filter(i => i.resource === resource && !i.forbidden && this.exploredAt(i) &&
        this.acceptsJobCargo(job,i,i) && (!worker || this.pawnAllowed(worker,i) && this.reachableItemStand(i) >= 0))
        .reduce((n,i) => n + (worker ? this.availableStack(i,worker.id) : i.amount),0);
      return available - reserved >= needed;
    }) ?? policy.allowedTextiles[0] ?? 'cloth';
    job.cost = apparelCost(job.apparelKind!, material);
  }
  private productionBenches() {
    return [...this.stoves, ...this.butcherSpots, ...this.stonecutters, ...this.tailors, ...this.weaponBenches];
  }
  private unfinishedCargo(id: number): Cargo | undefined {
    return this.items.find(i => i.unfinished?.id === id) ?? this.pawns.find(p => p.cargo?.unfinished?.id === id)?.cargo ?? undefined;
  }
  private reconcileUnfinishedBindings() {
    const billIds = new Set(productionQueues(this, this.productionQueues).flatMap(q => q.bills.map(b => b.id)));
    for (const batch of [...this.items, ...this.pawns.flatMap(p => p.cargo ? [p.cargo] : [])]) {
      const u = batch.unfinished;
      if (!u?.boundBillId || billIds.has(u.boundBillId)) continue;
      u.boundBillId = null;
      for (const j of [...this.jobs]) if (j.unfinishedId === u.id) this.cancel(j);
    }
    this.productionQueues = this.productionQueues.filter(q => this.productionBenches().some(b=>b.id===q.benchId));
  }
  /** A physical wrapper owns materials; jobs hold only a resumable reference. */
  private unfinishedForWorker(j: Job, p: Pawn): Cargo | undefined {
    const recipe = productionJobRecipe(j);
    if (!recipe || !recipeUsesUnfinished(recipe)) return;
    const bound = [...this.items, ...this.pawns.flatMap(q => q.cargo ? [q.cargo] : [])]
      .find(b => b.unfinished?.boundBillId === j.billId && j.billId !== undefined);
    const candidates = j.unfinishedId !== undefined ? [this.unfinishedCargo(j.unfinishedId)] : bound ? [bound]
      : [p.cargo, ...this.items].filter(b => b?.unfinished?.recipe === recipe)
        .sort((a, b) => Number(b?.unfinished?.boundBillId === j.billId) - Number(a?.unfinished?.boundBillId === j.billId));
    return candidates.find(batch => {
      const u = batch?.unfinished;
      if (!batch || !u || batch.forbidden || u.creatorId !== p.id || u.recipe !== recipe ||
          this.jobs.some(k => k.id !== j.id && k.unfinishedId === u.id && k.owner !== null && !k.cancelled)) return false;
      if (batch === p.cargo) return true;
      const stack = this.items.find(i => i.unfinished?.id === u.id);
      return !!stack && this.pawnAllowed(p,stack) && this.exploredAt(stack) && this.availableStack(stack, p.id) > 0 &&
        !this.chunkReserved(stack, p.id) && this.reachableItemStand(stack) >= 0;
    }) ?? undefined;
  }
  private claimUnfinished(j: Job, batch: Cargo) {
    const u = batch.unfinished!;
    // An idle batch may be resumed at another compatible workbench by its author.
    for (const old of [...this.jobs]) if (old !== j && old.unfinishedId === u.id) this.cancel(old);
    j.unfinishedId = u.id;
    if (j.kind === 'tailoring') j.cost = apparelCost(j.apparelKind!, u.ingredients.some(b => b.resource === 'alpacaWool') ? 'alpacaWool' : 'cloth');
    u.boundBillId = j.billId ?? this.productionBillFor(j)?.id ?? null;
    j.productionPolicy = structuredClone(u.policy);
    j.work = u.workTotal; j.progress = u.progress; j.workTicks = u.workTicks;
    if (u.productQuality) j.productQuality = { ...u.productQuality };
    else delete j.productQuality;
  }
  private syncUnfinishedProgress(j: Job) {
    const u = j.unfinishedId === undefined ? undefined : this.unfinishedCargo(j.unfinishedId)?.unfinished;
    if (!u) return;
    u.progress = j.progress; u.workTicks = j.workTicks;
    if (j.productQuality) u.productQuality = { ...j.productQuality };
  }
  /** Work can reach a piece beside the worker; fetching ground items still
   * requires walking onto their cell. Do not reach through walls or floors. */
  private unfinishedWorkTouch(actor: Pos, item: Pos): boolean {
    return this.itemTouch(actor, item) || (inside(actor) && inside(item) && actor.z === item.z &&
      Math.abs(actor.x - item.x) + Math.abs(actor.y - item.y) === 1 &&
      this.canStop(actor) && this.groundAllowed(item));
  }
  private unfinishedPlacementCells(p: Pawn) {
    return [p, ...horizontal.map(([dx,dy])=>({x:p.x+dx,y:p.y+dy,z:p.z}))]
      .filter(q=>inside(q) && this.pawnAllowed(p,q) && this.unfinishedWorkTouch(p,q));
  }
  private createUnfinished(p: Pawn, j: Job): boolean {
    const recipe = productionJobRecipe(j);
    if (!recipe || !recipeUsesUnfinished(recipe) || j.unfinishedId !== undefined) return true;
    const nextId = this.nextId;
    const batch: Cargo = { resource: 'unfinished', amount: 1, unfinished: {
      id: this.id(), recipe, creatorId: p.id, creatorName: p.name,
      boundBillId: j.billId ?? this.productionBillFor(j)?.id ?? null,
      workTotal: j.work, progress: j.progress, workTicks: j.workTicks,
      ingredients: j.deliveredBatches.map(b => portion(b, b.amount)),
      policy: structuredClone(this.productionPolicyFor(j)),
      ...(j.productQuality ? { productQuality: { ...j.productQuality } } : {}),
    } };
    const plan = this.planPlacement([{ batch, origin: p, cells: this.unfinishedPlacementCells(p) }]);
    if (!plan) {
      this.nextId = nextId;
      j.reason = '工作位置没有放置未完成品的空间，材料保留等待';
      this.release(p); return false;
    }
    this.commitPlacement(plan);
    j.billId ??= batch.unfinished!.boundBillId ?? undefined;
    j.unfinishedId = batch.unfinished!.id;
    j.delivered = {}; j.deliveredBatches = [];
    this.stats.produced.unfinished++;
    this.revision++;
    return true;
  }
  private continueUnfinished(p: Pawn, j: Job) {
    this.search(p);
    const batch = this.unfinishedForWorker(j, p);
    const stand = this.reachableStand(j, p);
    if (!batch || stand < 0) {
      j.reason = '未完成品被禁止、搬运中或不可达，等待原作者续作';
      this.release(p); return;
    }
    if (p.cargo && p.cargo !== batch) { this.release(p); this.deliverCargo(p); return; }
    if (p.cargo === batch) {
      this.go(p, stand, 'work'); p.reason = '把未完成品送往工作台'; return;
    }
    const item = batch as Stack;
    if (this.unfinishedWorkTouch(position(stand), item)) {
      this.go(p, stand, 'work'); p.reason = '前往继续加工'; return;
    }
    this.go(p, this.reachableItemStand(item), 'fetch');
    this.fetchReservations.set(p.id, { sourceId: item.id, amount: 1 });
    p.reason = '取回未完成品';
  }
  private unfinishedCommand(c: Extract<VoxelCommand, { type: 'unfinishedCancel' | 'unfinishedForbid' }>): CommandResult {
    const batch = this.unfinishedCargo(c.unfinishedId);
    const ground = this.items.find(i => i.unfinished?.id === c.unfinishedId);
    const carrier = this.pawns.find(p => p.cargo?.unfinished?.id === c.unfinishedId);
    const origin = ground ?? carrier;
    if (!batch?.unfinished || !origin || !this.exploredAt(origin)) return { ok: false, message: '未完成品已不存在或不可见' };
    if (c.type === 'unfinishedForbid') {
      if (typeof c.forbidden !== 'boolean') return { ok: false, message: '禁止状态无效' };
      batch.forbidden = c.forbidden;
      if (c.forbidden) for (const pawn of this.pawns) {
        const j = this.jobs.find(k => k.id === pawn.jobId);
        if (j?.unfinishedId === c.unfinishedId || pawn.cargo?.unfinished?.id === c.unfinishedId ||
            (ground && this.fetchReservations.get(pawn.id)?.sourceId === ground.id) ||
            (ground && this.storageReservations.get(pawn.id)?.sourceId === ground.id)) this.release(pawn);
      }
      this.revision++;
      return { ok: true, message: c.forbidden ? '已禁止搬运与续作' : '已允许搬运与原作者续作' };
    }
    const plan = this.planPlacement(batch.unfinished.ingredients.map(material => ({ batch: material, origin })),
      this.items.filter(i => i !== ground));
    if (!plan) return { ok: false, message: '附近没有足够退料空间，未完成品保持原状' };
    // Refund first validates the entire placement. No partial cancellation or loss.
    for (const j of [...this.jobs]) if (j.unfinishedId === c.unfinishedId) this.cancel(j);
    this.commitPlacement(plan);
    if (carrier) { carrier.cargo = null; this.release(carrier); }
    this.stats.consumed.unfinished++;
    this.revision++;
    return { ok: true, message: '加工已取消，内含材料已退回地面' };
  }
  private recordDestroyedCargo(batch: Cargo, amount = batch.amount) {
    this.stats.destroyed[batch.resource] += amount;
    if (batch.unfinished) {
      for (const material of batch.unfinished.ingredients) this.stats.destroyed[material.resource] += material.amount;
      for (const j of [...this.jobs]) if (j.unfinishedId === batch.unfinished.id) this.cancel(j);
    }
  }
  private productionQueue(benchId: number) {
    return this.productionQueues.find(q => q.benchId === benchId) ?? defaultProductionQueue(this, benchId);
  }
  private productionBillFor(j: Job) {
    const recipe = productionJobRecipe(j);
    const bench = recipe && this.productionBenches().find(b => same(b, j));
    if (!bench) return undefined;
    const bills = this.productionQueue(bench.id)?.bills ?? [];
    return j.billId ? bills.find(b => b.id === j.billId && b.recipe === recipe)
      : bills.find(b => b.recipe === recipe);
  }
  private productionPolicyFor(j: Job) {
    return j.productionPolicy ?? this.productionBillFor(j)?.policy ?? defaultProductionPolicy();
  }
  /** Worker restrictions apply when a worker takes over; input rules stay with a started batch. */
  private productionWorkerFailure(p: Pawn, j: Job): string | null {
    const recipe = productionJobRecipe(j);
    if (!recipe) return null;
    const piece = !recipeUsesUnfinished(recipe) ? undefined : j.unfinishedId === undefined ? [...this.items, ...this.pawns.flatMap(q => q.cargo ? [q.cargo] : [])]
      .find(b => j.billId !== undefined && b.unfinished?.boundBillId === j.billId)?.unfinished
      : this.unfinishedCargo(j.unfinishedId)?.unfinished;
    if (piece && piece.creatorId !== p.id) return `等待原作者${piece.creatorName}继续加工`;
    const bill = this.productionBillFor(j);
    return recipe && bill ? productionPolicyWorkerReason(bill.policy, recipe, p) : null;
  }
  private bindProductionInputs(j: Job) {
    if (productionJobRecipe(j) && !j.productionPolicy)
      j.productionPolicy = structuredClone(this.productionPolicyFor(j));
  }
  private validateProductionWorkers() {
    for (const queue of this.productionQueues) for (const bill of queue.bills) {
      if (bill.policy.workerId === null) continue;
      const pawn = this.pawns.find(p => p.id === bill.policy.workerId);
      if (!pawn || pawn.dead || pawn.faction !== 'colony') {
        bill.policy.workerId = null;
        this.notice = '指定生产工人已离开营地或死亡，账单恢复为任意工人';
      }
    }
  }
  private productionCommand(c: Extract<VoxelCommand, { type: 'productionBillAdd' | 'productionBillUpdate' | 'productionBillMove' | 'productionBillDelete' }>): CommandResult {
    const original = this.productionQueue(c.benchId);
    if (!original) return { ok: false, message: '工作台不存在' };
    const queue = structuredClone(original);
    if (c.type === 'productionBillAdd') {
      if (queue.bills.length >= 32 || !recipeAllowed(this, c.benchId, c.recipe))
        return { ok: false, message: '工作台不支持此配方，或账单已达32张' };
      queue.bills.push(makeProductionBill(`bill:${this.nextId}`, c.recipe));
    } else {
      const at = queue.bills.findIndex(b => b.id === c.billId);
      if (at < 0) return { ok: false, message: '账单已不存在' };
      if (c.type === 'productionBillDelete') queue.bills.splice(at, 1);
      else if (c.type === 'productionBillMove') {
        if ((c.direction !== -1 && c.direction !== 1) || !queue.bills[at + c.direction])
          return { ok: false, message: '账单已在队列边缘' };
        [queue.bills[at], queue.bills[at + c.direction]] = [queue.bills[at + c.direction], queue.bills[at]];
      } else {
        const patch = c.patch;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k =>
          !['mode', 'remaining', 'target', 'suspended', 'pauseWhenSatisfied', 'resumeBelow', 'policy', 'output'].includes(k)))
          return { ok: false, message: '账单设置无效' };
        if (patch.policy?.workerId != null && !this.pawns.some(p => p.id === patch.policy!.workerId && !p.dead && p.faction === 'colony'))
          return { ok: false, message: '只能指定仍在营地的殖民者' };
        Object.assign(queue.bills[at], structuredClone(patch));
        if (queue.bills[at].mode !== 'target' || !queue.bills[at].pauseWhenSatisfied)
          queue.bills[at].waiting = false;
      }
    }
    const overrides = [...this.productionQueues.filter(q => q.benchId !== c.benchId), queue];
    try { validateProductionQueues(overrides, this, this.nextId + (c.type === 'productionBillAdd' ? 1 : 0), []); }
    catch { return { ok: false, message: '账单数量、生产模式或恢复阈值无效' }; }
    if (queue.bills.some(b => b.output.target && !productionOutputTargetExists(this, b.output.target)))
      return { ok: false, message: '指定仓库已不存在，请重新选择' };
    // Bind any in-flight legacy job before the queue changes, including deletion.
    const bench = this.productionBenches().find(b => b.id === c.benchId)!;
    for (const j of this.jobs) if (same(j, bench) && productionJobRecipe(j) && !j.billId)
      j.billId = original.bills.find(b => b.recipe === productionJobRecipe(j))?.id;
    this.productionQueues = overrides;
    if (c.type === 'productionBillAdd') this.nextId++;
    this.syncProduction();
    this.revision++;
    return { ok: true, message: c.type === 'productionBillDelete' ? '账单已删除；未完成品保留，未开工材料退回' :
      c.type === 'productionBillMove' ? '已调整生产顺序，当前批次继续完成' : '生产账单已更新' };
  }
  /** Old SDK commands address the first matching recipe; all later duplicates retain identity. */
  private legacyProductionUpdate(benchId: number, recipe: ProductionRecipe, target: number | null, paused: boolean) {
    const queue = this.productionQueues.find(q => q.benchId === benchId);
    if (!queue) return;
    let bill = queue.bills.find(b => b.recipe === recipe);
    if (!bill) {
      bill = makeProductionBill(`bill:${this.id()}`, recipe);
      queue.bills.push(bill);
    }
    bill.mode = target === null ? 'forever' : 'target';
    if (target !== null) bill.target = target;
    bill.suspended = paused;
    bill.waiting = false;
    bill.pauseWhenSatisfied = false;
    bill.resumeBelow = Math.min(bill.resumeBelow, bill.target);
  }
  private productionCount(recipe: ProductionRecipe) {
    if (recipe === 'cook') return this.counts().meal;
    if (recipe === 'stonecut') return this.counts().stone;
    if (recipe === 'butcher') return this.counts().meat;
    const kind = recipe.slice(recipe.indexOf(':') + 1);
    return recipe.startsWith('smith:') ? this.weaponPieces().filter(p => p.kind === kind).length
      : this.apparelPieces().filter(p => p.kind === kind).length;
  }
  private productionPreview(bench: Pos & {id:number}, bill: ProductionBill): Job {
    const [kind, product] = bill.recipe.split(':');
    const weaponBench = this.weaponBenches.find(b => b.id === bench.id);
    const axis = 'axis' in bench ? bench.axis as Axis : 'x';
    const before = this.nextId;
    const j = this.makeJob(kind as JobKind, bench, axis, 'wood',
      kind === 'tailoring' || kind === 'armorsmith' ? product as ApparelKind : undefined,
      kind === 'smith' ? product as WeaponKind : undefined,
      kind === 'smith' ? weaponBench!.kind : undefined);
    this.nextId = before; // Previews reserve neither an identity nor any materials.
    j.billId = bill.id;
    if (j.kind === 'cook') this.chooseMealIngredients(j);
    this.chooseTailorIngredients(j);
    return j;
  }
  private productionFeasible(j: Job, replacing?: Job, worker?: Pawn): boolean {
    const eligible = (worker ? [worker] : this.pawns).filter(p => p.faction === 'colony' && !p.dead &&
      !p.downed && !p.drafted && p.carriedBy === null && p.psyche.breakUntil <= this.tick &&
      p.priorities[workType(j.kind)] > 0 && !this.skillFailure(p, j) && !this.productionWorkerFailure(p, j));
    if (!eligible.length) return false;
    return eligible.some(p => {
      // assign() already searched from this worker. Scheduler probes are independent.
      if (!worker) this.search(p);
      if (this.reachableStand(j, p) < 0) return false;
      if (this.unfinishedForWorker(j, p)) return true;
      if (j.unfinishedId !== undefined || (j.billId !== undefined &&
          [...this.items, ...this.pawns.flatMap(q=>q.cargo?[q.cargo]:[])].some(b=>b.unfinished?.boundBillId===j.billId))) return false;
      if (j.kind === 'cook' && j.owner === null && !Object.values(j.delivered).some(n => n! > 0))
        this.chooseMealIngredients(j, p);
      this.chooseTailorIngredients(j, p, replacing);
      return Object.entries(j.cost).every(([resource, amount]) => {
        const r = resource as Resource;
        // Waiting jobs do not reserve hypothetical stock against one another.
        // Count owned work only, excluding inputs already carried or delivered.
        const committed = this.jobs.filter(k => k !== j && k !== replacing && !k.cancelled && k.owner !== null && k.unfinishedId === undefined)
          .reduce((n, k) => {
            const owner = this.pawns.find(q => q.id === k.owner);
            const carried = owner?.jobId === k.id && owner.cargo?.resource === r ? owner.cargo.amount : 0;
            return n + Math.max(0, (k.cost[r] ?? 0) - (k.delivered[r] ?? 0) - carried);
          }, 0);
        const items = this.items.filter(i => this.pawnAllowed(p,i) && i.resource === r && !i.forbidden && this.exploredAt(i) && this.acceptsJobCargo(j, i, i));
        if (items.reduce((n, i) => n + i.amount, 0) - committed < amount) return false;
        return items.reduce((n, i) => n + (this.reachableItemStand(i) >= 0 && !this.chunkReserved(i, p.id)
          ? this.availableStack(i, p.id) : 0), 0) >= amount;
      });
    });
  }
  private productionOutput(j: Job) {
    if (j.kind === 'cook') return SIMPLE_MEAL.output;
    if (j.kind === 'stonecut') return STONECUTTING.output;
    if (j.kind !== 'butcher') return 1;
    const carcass = j.deliveredBatches.find(b => b.carcass)?.carcass;
    return carcass ? ANIMAL_DEFS[carcass.species].meat : Math.min(...Object.values(ANIMAL_DEFS).map(a => a.meat));
  }
  /** A waiting order for another worker must not hide a later order this worker can do. */
  private chooseProductionForWorker(p: Pawn) {
    const waiting = this.jobs.filter(j => productionJobRecipe(j) && !j.cancelled && j.owner === null &&
      !j.productionPolicy && j.progress === 0 && !Object.values(j.delivered).some(n => n! > 0) &&
      p.priorities[workType(j.kind)] > 0);
    if (!waiting.length) return;
    this.search(p);
    for (const existing of waiting) {
      if (this.productionFeasible(existing, undefined, p)) continue;
      const bench = this.productionBenches().find(b => same(b, existing));
      if (!bench) continue;
      for (const bill of this.productionQueue(bench.id)!.bills) {
        if (bill.id === existing.billId) continue;
        const pending = this.jobs.filter(j => j !== existing && !j.cancelled && productionJobRecipe(j) === bill.recipe)
          .reduce((n, j) => n + this.productionOutput(j), 0);
        if (!canStartProduction(bill, this.productionCount(bill.recipe), pending)) continue;
        const candidate = this.productionPreview(bench, bill);
        if (!this.supported(candidate) || !this.productionFeasible(candidate, existing, p)) continue;
        if (!this.cancel(existing)) break;
        candidate.id = this.id();
        this.jobs.push(candidate);
        break;
      }
    }
  }
  private scheduleProduction() {
    const benches = this.productionBenches();
    const completed = new Map<ProductionRecipe, number>();
    const pending = new Map<ProductionRecipe, number>();
    const track = (j: Job, sign: number) => {
      const recipe = productionJobRecipe(j);
      if (recipe && !j.cancelled) pending.set(recipe, (pending.get(recipe) ?? 0) + sign * this.productionOutput(j));
    };
    for (const j of this.jobs) track(j, 1);
    this.productionQueues = this.productionQueues.filter(q => benches.some(b => b.id === q.benchId));
    for (const bench of benches) {
      const queue = this.productionQueue(bench.id)!;
      // Update the hysteresis from physical stock even while this bench is busy.
      const desired = queue.bills.filter(b => {
        if (!completed.has(b.recipe)) completed.set(b.recipe, this.productionCount(b.recipe));
        return canStartProduction(b, completed.get(b.recipe)!, pending.get(b.recipe) ?? 0);
      });
      if (this.jobs.length >= 512) continue;
      const weaponBench = this.weaponBenches.find(b => b.id === bench.id);
      if (weaponBench?.kind === 'smithy' && weaponBench.fuel <= SMITHY_REFUEL_AT &&
        !this.jobs.some(j => same(j, bench) && j.kind === 'refuel')) {
        const j = this.makeJob('refuel', bench);
        j.cost = { wood: Math.ceil(SMITHY_FUEL_CAPACITY - weaponBench.fuel) };
        this.jobs.push(j);
      }
      const existing = this.jobs.find(j => same(j, bench) && j.kind !== 'refuel');
      // Never replace materials, partial work, owned jobs, or cancelled refund containers.
      if (existing && (!productionJobRecipe(existing) || existing.cancelled || existing.owner !== null || existing.productionPolicy ||
        existing.progress > 0 || Object.values(existing.delivered).some(n => n! > 0))) continue;
      if (existing && this.productionFeasible(existing)) continue;
      let fallback: Job | undefined, selected: Job | undefined;
      for (const bill of desired) {
        const j = existing?.billId === bill.id ? existing : this.productionPreview(bench, bill);
        if (j.kind === 'smith' && weaponResearchReason(this.research,j.weaponKind!)) continue;
        if (j.kind === 'armorsmith' && armorResearchReason(this.research,j.apparelKind!)) continue;
        if (j.kind === 'butcher' && this.counts().carcass <= 0) continue;
        fallback ??= j;
        if (this.productionFeasible(j, existing)) { selected = j; break; }
      }
      // An already selected batch continues after target/mode changes.
      selected ??= existing ?? fallback;
      if (selected === existing || !selected) continue;
      if (existing) {
        track(existing, -1);
        if (!this.cancel(existing)) { track(existing, 1); continue; }
      }
      if (this.jobs.length >= 512) continue;
      selected.id = this.id();
      this.jobs.push(selected);
      track(selected, 1);
    }
  }
  private syncProduction() {
    this.reconcileProductionStorage();
    this.validateProductionWorkers();
    this.reconcileUnfinishedBindings();
    for (const j of [...this.jobs])
      if (j.kind === 'research' && (!this.supported(j) || j.cancelled)) this.cancel(j);
    for (const j of [...this.jobs]) {
      if (j.cancelled) {
        this.cancel(j);
        continue;
      }
      if (j.constructionFailure) {
        this.finishConstructionFailure(j);
        continue;
      }
      if (
        j.kind === 'sow' &&
        (!this.farms.some((f) => same(f, j)) ||
          !this.farmable(j) ||
          this.crops.some((v) => same(v, j)))
      )
        this.cancel(j);
      if (j.kind === 'harvest' && !this.crops.some((v) => same(v, j) && v.growth >= 1))
        this.cancel(j);
      if (
        j.kind === 'plantTree' &&
        (!this.treePlots.some((f) => same(f, j) && f.species === j.treeSpecies) ||
          this.trees.some((t) => same(t, j)))
      )
        this.cancel(j);
      if (j.kind === 'cut' && !this.trees.some((t) => same(t, j))) this.cancel(j);
      if (productionJobRecipe(j) && !this.supported(j)) this.cancel(j);
      if (j.kind === 'cook' && !j.cancelled && j.owner === null && !j.productionPolicy && !(j.delivered.grain || j.delivered.meat || j.delivered.milk))
        this.chooseMealIngredients(j);
      if (
        j.kind === 'refuel' &&
        !this.devices.some((d) => d.kind === 'generator' && same(d, j)) &&
        !this.weaponBenches.some((b) => b.kind === 'smithy' && same(b, j))
      )
        this.cancel(j);
    }
    if (this.research.current)
      for (const b of this.researchBenches) {
        if (this.jobs.length >= 512 || this.jobs.some((j) => same(j, b))) continue;
        const job = this.makeJob('research', b);
        job.researchProject = this.research.current;
        this.jobs.push(job);
      }
    for (const f of this.farms) {
      if (this.jobs.length >= 512 || this.jobs.some((j) => same(j, f)) || !this.farmable(f))
        continue;
      const c = this.crops.find((c) => same(c, f));
      if (!c) this.jobs.push(this.makeJob('sow', f));
      else if (c.growth >= 1) this.jobs.push(this.makeJob('harvest', f));
    }
    for (const plot of this.treePlots) {
      if (
        this.jobs.length >= 512 ||
        this.jobs.some((j) => same(j, plot)) ||
        this.trees.some((t) => same(t, plot))
      )
        continue;
      if (!this.treeSiteReason(plot, plot.species)) this.jobs.push(this.makeJob('plantTree', plot));
    }
    this.scheduleProduction();
    for (const d of this.devices) {
      if (
        d.kind !== 'generator' ||
        d.fuel > 22.5 ||
        this.jobs.length >= 512 ||
        this.jobs.some((j) => same(j, d))
      )
        continue;
      const j = this.makeJob('refuel', d);
      j.cost = { wood: Math.ceil(75 - d.fuel) };
      this.jobs.push(j);
    }
  }
  private shelfSettings(shelf: Shelf) {
    return effectiveShelfSettings(this.storageGroups,shelf.id,shelf.settings);
  }
  command(c: VoxelCommand): CommandResult {
    // Keep the animal-area API as a compatible alias for one shared mask pool.
    if (c && typeof c === 'object') {
      if (c.type === 'allowedAreaCreate') c = { ...c, type: 'animalAreaCreate' };
      else if (c.type === 'allowedAreaRename') c = { ...c, type: 'animalAreaRename' };
      else if (c.type === 'allowedAreaDelete') c = { ...c, type: 'animalAreaDelete' };
      else if (c.type === 'allowedAreaPaint') c = { ...c, type: 'animalAreaPaint' };
    }
    const result=this.dispatchCommand(c);
    if(result.ok) {
      reconcileStorageGroups(this); this.reconcileProductionStorage();
      if (['pawnAreaAssign','animalAreaPaint','animalAreaDelete','draft'].includes(c.type)) {
        this.areaReturnRetry.clear();
        for (const p of this.pawns) {
          if (p.allowedAreaId !== null && !this.animalAreas.some(a => a.id === p.allowedAreaId)) p.allowedAreaId = null;
          this.reconcilePawnArea(p,true);
        }
        this.reconcileFireState();
      }
    }
    return result;
  }
  private dispatchCommand(c: VoxelCommand): CommandResult {
    if (!c || typeof c !== 'object') return { ok: false, message: '命令格式无效' };
    if (c.type === 'itemForbidden' || c.type === 'itemForbiddenArea') {
      if (typeof c.forbidden !== 'boolean') return { ok:false, message:'物品禁止状态无效' };
      let items: Stack[];
      if (c.type === 'itemForbidden') {
        const item=this.items.find(i => i.id === c.itemId && this.exploredAt(i));
        if (!item) return { ok:false, message:'地面物品已不存在或尚未发现' };
        items=[item];
      } else {
        const end=c.to ?? c.from;
        if (!inside(c.from) || !inside(end) || c.from.z !== end.z)
          return { ok:false, message:'请在同一工作层选择有效范围' };
        items=this.items.filter(i => this.exploredAt(i) && i.z === c.from.z &&
          i.x >= Math.min(c.from.x,end.x) && i.x <= Math.max(c.from.x,end.x) &&
          i.y >= Math.min(c.from.y,end.y) && i.y <= Math.max(c.from.y,end.y));
      }
      return this.setItemsForbidden(items,c.forbidden);
    }
    if (c.type === 'pawnAreaAssign') {
      const p = this.pawns.find(p => p.id === c.pawnId && p.faction === 'colony' && !p.dead);
      const area = this.animalAreas.find(a => a.id === c.areaId);
      if (!p || (c.areaId !== null && !area)) return { ok:false, message:'居民或允许区域无效' };
      p.allowedAreaId = c.areaId;
      this.revision++;
      return { ok:true, message:area ? `已分配${area.name}${area.cells.length ? '' : '（空区域暂不限制活动）'}` : '已解除活动区域限制' };
    }
    if (c.type === 'stockpileZoneRename') {
      const result = renameStockpileZone(this, c.zoneId, c.name);
      if (result.ok) this.revision++;
      return result;
    }
    if (c.type === 'unfinishedCancel' || c.type === 'unfinishedForbid') return this.unfinishedCommand(c);
    const groupResult=storageGroupCommand(this,c);
    if(groupResult) {
      if(groupResult.ok){this.refreshReservations();this.revision++;}
      return groupResult;
    }
    if ('target' in c && c.target && typeof c.target === 'object' && !this.exploredAt(c.target))
      return { ok: false, message: '目标区域尚未探索' };
    // A player-authored mask reveals no terrain; painting does not require a floor.
    if ('from' in c && c.type !== 'animalAreaPaint' && !(c.type === 'designate' && ['inspect', 'mine', 'cancel'].includes(c.tool))) {
      const to = c.to ?? c.from;
      if (!inside(c.from) || !inside(to)) return { ok: false, message: '请选择世界内的有效工作层' };
      for (let y = Math.min(c.from.y, to.y); y <= Math.max(c.from.y, to.y); y++)
        for (let x = Math.min(c.from.x, to.x); x <= Math.max(c.from.x, to.x); x++)
          if (!this.exploredAt({ x, y, z: c.from.z })) return { ok: false, message: '目标区域尚未探索' };
    }
    const penResult = pensCommand(this, c);
    if (penResult) return penResult;
    const nextId = this.nextId;
    if (c.type === 'benchPower') {
      const bench = this.weaponBenches.find((b) => b.id === c.benchId && b.kind === 'machining');
      if (!bench?.power || typeof c.on !== 'boolean')
        return { ok: false, message: '机械台开关无效' };
      bench.power.on = c.on;
      if (!c.on) {
        bench.power.powered = false;
        bench.power.active = false;
      }
      return { ok: true, message: c.on ? '机械台已开启' : '机械台已关闭，保留加工进度' };
    }
    const result = this.applyCommand(c);
    if (!result.ok) this.nextId = nextId;
    else {
      this.pruneFilth();
      this.reconcileFireState();
      for (const p of this.pawns) {
        if (p.carePhase && !this.validCare(p)) this.release(p);
        if (p.cleanTask && !this.validClean(p)) this.release(p);
      }
    }
    return result;
  }
  private applyCommand(c: VoxelCommand): CommandResult {
    if (c.type === 'productionBillAdd' || c.type === 'productionBillUpdate' || c.type === 'productionBillMove' || c.type === 'productionBillDelete')
      return this.productionCommand(c);
    const legacy = c.type === 'bill' ? { id: c.stoveId, recipe: 'cook' } :
      c.type === 'stoneBill' ? { id: c.stonecutterId, recipe: 'stonecut' } :
      c.type === 'butcherBill' ? { id: c.spotId, recipe: 'butcher' } :
      c.type === 'tailorBill' ? { id: c.tailorId, recipe: `tailoring:${c.kind}` } :
      c.type === 'weaponBill' ? { id: c.benchId, recipe: `smith:${c.kind}` } :
      c.type === 'armorBill' ? { id: c.benchId, recipe: `armorsmith:${c.kind}` } : null;
    const configured = legacy && this.productionQueues.find(q => q.benchId === legacy.id);
    if (configured && configured.bills.length >= 32 && !configured.bills.some(b => b.recipe === legacy!.recipe))
      return { ok: false, message: '该工作台已达32张账单，请先删除一张' };
    if (c.type === 'uninstallFurniture' || c.type === 'installFurniture' || c.type === 'cancelFurnitureMove')
      return this.relocationCommand(c);
    if (c.type === 'autoRebuild') {
      if (typeof c.enabled !== 'boolean') return { ok: false, message: '自动重建设置无效' };
      this.autoRebuild = c.enabled; this.revision++;
      return { ok: true, message: c.enabled ? '已开启家园建筑自动重建；重建仍需材料与施工' : '已关闭自动重建；现有施工计划保留' };
    }
    if (c.type === 'fireHazards') {
      if (typeof c.enabled !== 'boolean') return { ok: false, message: '火灾事件设置无效' };
      this.fireHazards.enabled = c.enabled;
      return { ok: true, message: c.enabled ? '已开启雷击与电气火灾事件，保留既定日程' : '后续火灾事件已关闭，现有火焰继续燃烧并可扑灭' };
    }
    if (c.type === 'firefight' || c.type === 'cancelFirefight' || c.type === 'repair' || c.type === 'cancelRepair') {
      const p = this.pawns.find(p => p.id === c.pawnId && p.faction === 'colony');
      if (!p || p.dead || p.downed || p.drafted || p.carriedBy !== null || p.psyche.breakUntil > this.tick)
        return { ok: false, message: '需要可自由行动的殖民者' };
      if (c.type === 'cancelFirefight' || c.type === 'cancelRepair') {
        if (c.type === 'cancelFirefight' ? !p.firefightTask : !p.repairTask)
          return { ok: false, message: '当前没有对应的灭火或修理任务' };
        this.release(p); p.reason = '任务已取消，等待重新安排'; return { ok: true, message: p.reason };
      }
      if (c.type === 'firefight') {
        const f = this.fires.find(f => f.id === c.fireId), ok = !!f && startFirefight(this, p, f);
        return { ok, message: ok || p.reason.includes('允许区域') ? p.reason : '需要家园区域内可到达并且无人预约的火焰；携带物资需有卸货位置' };
      }
      const damage = this.fireDamage.find(d => d.key === c.damageKey), ok = !!damage && startRepair(this, p, damage);
      return { ok, message: ok || p.reason.includes('允许区域') ? p.reason : '需要家园区域内可到达、无人预约且未在燃烧的受损结构' };
    }
    if (c.type === 'prisonerPolicy') {
      const patient = this.pawns.find(p => p.id === c.prisonerId);
      return patient ? setPrisonerPolicy(this, patient, c.policy) : { ok: false, message: '俘虏不存在' };
    }
    if (c.type === 'capture') {
      const p = this.pawns.find(p => p.id === c.pawnId), target = this.pawns.find(p => p.id === c.targetId);
      return p && target ? startCapture(this, p, target) : { ok: false, message: '执行者或待俘获者不存在' };
    }
    if (c.type === 'bedPrisoner') {
      const bed = this.beds.find(b => b.id === c.bedId);
      if (!bed || typeof c.prisoner !== 'boolean') return { ok: false, message: '囚犯床设置无效' };
      this.updateRooms();
      const room = this.rooms.roomAt(bed);
      const affected = this.beds.filter(b => b.id === bed.id || (room && !room.outdoor && this.rooms.roomAt(b)?.id === room.id));
      for (const b of affected) if (b.prisoner !== c.prisoner) {
        this.invalidatePrisonBed(b);
        b.prisoner = c.prisoner; b.owner = null;
      }
      return { ok: true, count: affected.length, message: `已将${affected.length}张床设为${c.prisoner ? '囚犯床；捕获需要有屋顶的封闭牢房' : '殖民者床位'}` };
    }
    // Management settings remain editable during a break; direct pawn control does not.
    if ('pawnId' in c && c.pawnId !== null &&
        ['clean', 'cancelClean', 'draft', 'attack', 'move', 'rest', 'care', 'wear', 'removeApparel', 'equipWeapon', 'dropWeapon', 'tradeTalk', 'recreate', 'cancelRecreation'].includes(c.type) &&
        this.pawns.some(p => p.id === c.pawnId && p.psyche.breakUntil > this.tick))
      return { ok: false, message: '精神崩溃中，暂时无法接受指令；恢复后会重新工作' };
    if (c.type === 'clean' || c.type === 'cancelClean') {
      const p = this.pawns.find(p => p.id === c.pawnId && p.faction === 'colony');
      if (!p || p.dead || p.downed || p.drafted || p.carriedBy !== null)
        return { ok: false, message: '需要可自由行动的殖民者' };
      if (c.type === 'cancelClean') {
        if (!p.cleanTask) return { ok: false, message: '当前没有清扫任务' };
        this.release(p); p.reason = '清扫已取消，等待工作安排';
        return { ok: true, message: p.reason };
      }
      const f = this.filth.find(f => f.id === c.filthId);
      const ok = !!f && this.startClean(p, f);
      return { ok, message: ok ? p.reason : '需要家园区域内可达、未被预约的污物，以及可卸货的空间' };
    }
    if (c.type === 'tableGathering') {
      const table = this.tables.find(t => t.id === c.tableId);
      if (!table || typeof c.enabled !== 'boolean') return { ok: false, message: '请选择有效餐桌与聚会设置' };
      table.gathering = c.enabled;
      if (!table.gathering) for (const p of this.pawns) if (p.psyche.recreation?.kind === 'social' && p.psyche.recreation.spotId === table.id) {
        this.release(p); p.reason = '餐桌已停止聚会，重新安排活动';
      }
      return { ok: true, message: table.gathering ? '允许在此桌边休闲' : '已停止聚会，仍可正常用餐' };
    }
    if (c.type === 'recreate' || c.type === 'cancelRecreation') {
      const p = this.pawns.find(p => p.id === c.pawnId && p.faction === 'colony');
      if (!p || p.dead || p.downed || p.drafted || p.carriedBy !== null)
        return { ok: false, message: '需要可自由行动的殖民者' };
      if (c.type === 'cancelRecreation') {
        if (!p.psyche.recreation) return { ok: false, message: '当前没有娱乐活动' };
        this.release(p); p.reason = '娱乐已结束，等待重新安排';
        return { ok: true, message: p.reason };
      }
      if (c.kind !== undefined && !Object.hasOwn(RECREATION_NAMES, c.kind)) return { ok: false, message: '娱乐类别无效' };
      const ok = this.startRecreation(p, true, c.kind);
      return { ok, message: ok ? p.reason : c.kind === 'social'
        ? '没有允许聚会、可达且舒适的空闲桌边位置'
        : '暂无所选活动的可达空位；检查天气、温度、设施和预约' };
    }
    if (c.type === 'autoSlaughter') {
      if (!AUTO_SLAUGHTER_SPECIES.includes(c.species) || !validAutoSlaughterPolicy(c.policy))
        return { ok: false, message: '自动宰杀配额无效：空白表示不限，数量必须为 0～128 的整数' };
      this.autoSlaughter[c.species] = { ...c.policy };
      reconcileAutoSlaughter(this); this.revision++;
      return { ok: true, message: '自动宰杀配额已应用，超额动物等待驯养员现场处理' };
    }
    if (c.type === 'animalOrder') return animalOrder(this, c.animalId, c.order, c.enabled);
    if (c.type === 'hunt') {
      const animal = this.animals.find(a => a.id === c.animalId && !a.dead && a.faction === 'wild');
      if (!animal || typeof c.enabled !== 'boolean') return { ok: false, message: '请选择存活的野生动物' };
      animal.hunt = c.enabled;
      if (c.enabled) { animal.tame = false; releaseAnimalHandlers(this, animal); }
      animal.retryTick = 0;
      if (!c.enabled) for (const p of this.pawns) if (p.attackTargetId === animal.id) this.release(p);
      return { ok: true, message: c.enabled ? '已标记狩猎；猎人需要装备短弓或枪械并开启狩猎工作' : '已取消狩猎；已发射的弹丸仍会飞行' };
    }
    if (c.type === 'butcherBill') {
      const spot = this.butcherSpots.find(b => b.id === c.spotId);
      if (!spot || typeof c.paused !== 'boolean') return { ok: false, message: '屠宰点或开关无效' };
      spot.paused = c.paused;
      this.legacyProductionUpdate(spot.id, 'butcher', null, c.paused);
      this.syncProduction();
      return { ok: true, message: spot.paused ? '屠宰已暂停，尸体原样退回；无空间时保留在任务内' : '屠宰已开启，将自动加工可达的新鲜动物尸体' };
    }
    if (c.type === 'tradeTalk' || c.type === 'tradeCancel' || c.type === 'tradeCommit' || c.type === 'homeArea')
      return applyTradeCommand(this, c);
    if (
      'pawnId' in c &&
      c.pawnId !== null &&
      !(['medicalPolicy', 'medicalRest'].includes(c.type) && this.pawns.some(p => p.id === c.pawnId && p.faction === 'prisoner')) &&
      this.pawns.some((p) => p.id === c.pawnId && p.faction !== 'colony')
    )
      return { ok: false, message: '无法指挥其他派系人物' };
    if (c.type === 'research') {
      if (c.project !== null && !RESEARCH_KEYS.includes(c.project))
        return { ok: false, message: '未知研究项目' };
      const reason = c.project === null ? null : researchBlockReason(this.research, c.project);
      if (reason) return { ok: false, message: reason };
      if (c.project !== this.research.current) {
        for (const job of [...this.jobs]) if (job.kind === 'research') this.cancel(job);
        this.research.current = c.project;
        this.syncProduction();
      }
      this.revision++;
      this.notice = c.project
        ? `开始研究${RESEARCH_DEFS[c.project].name}；需要研究员在科研台工作`
        : '已停止研究，已有进度保留';
      return { ok: true, message: this.notice };
    }
    if (c.type === 'armorBill') {
      const bench = this.weaponBenches.find((b) => b.id === c.benchId && b.kind === 'smithy');
      const bill = bench?.armorBills.find((b) => b.kind === c.kind);
      if (
        !bench ||
        !bill ||
        !Number.isInteger(c.target) ||
        c.target < 0 ||
        c.target > 100 ||
        typeof c.paused !== 'boolean'
      )
        return { ok: false, message: '护甲配方或目标无效' };
      const reason = !c.paused && c.target > 0 ? armorResearchReason(this.research, c.kind) : null;
      if (reason) return { ok: false, message: reason };
      bill.target = c.target;
      bill.paused = c.paused;
      this.legacyProductionUpdate(bench.id, `armorsmith:${c.kind}`, c.target, c.paused);
      this.syncProduction();
      return {
        ok: true,
        message: c.paused ? '已暂停护甲配方，已运原料会退回' : '护甲制作目标已更新',
      };
    }
    if (c.type === 'weaponBill') {
      const bench = this.weaponBenches.find((b) => b.id === c.benchId);
      const bill = bench?.bills.find((b) => b.kind === c.kind);
      if (
        !bench ||
        !bill ||
        !Number.isInteger(c.target) ||
        c.target < 0 ||
        c.target > 100 ||
        typeof c.paused !== 'boolean'
      )
        return { ok: false, message: '武器配方或目标无效' };
      const reason = !c.paused && c.target > 0 ? weaponResearchReason(this.research, c.kind) : null;
      if (reason) return { ok: false, message: reason };
      bill.target = c.target;
      bill.paused = c.paused;
      this.legacyProductionUpdate(bench.id, `smith:${c.kind}`, c.target, c.paused);
      this.syncProduction();
      return { ok: true, message: c.paused ? '已暂停配方，已运原料会退回' : '武器制作目标已更新' };
    }
    if (c.type === 'equipWeapon' || c.type === 'dropWeapon') {
      const pawn = this.pawns.find((p) => p.id === c.pawnId);
      const ok =
        !!pawn &&
        this.startWeapon(
          pawn,
          c.type === 'equipWeapon' ? c.weaponId : (pawn.weapon?.id ?? -1),
          c.type === 'equipWeapon' ? 'equip' : 'drop',
        );
      return { ok, message: ok ? pawn!.reason : '当前无法取用武器，请检查通路、预约与人物状态' };
    }
    if (c.type === 'weaponForbidden') {
      const item = this.items.find((i) => i.weapon?.id === c.weaponId);
      if (!item || typeof c.forbidden !== 'boolean')
        return { ok: false, message: '地面武器不存在' };
      if (!this.exploredAt(item)) return { ok:false, message:'地面武器尚未发现' };
      return this.setItemsForbidden([item],c.forbidden);
    }
    if (c.type === 'difficulty') {
      if (!DIFFICULTIES.includes(c.difficulty)) return { ok: false, message: '难度设置无效' };
      this.storyteller.difficulty = c.difficulty;
      return { ok: true, message: `难度已设为${DIFFICULTY_NAMES[c.difficulty]}；事件日历与伤亡适应保持原进度` };
    }
    if (c.type === 'threats') {
      if (typeof c.enabled !== 'boolean') return { ok: false, message: '袭击设置无效' };
      if (c.enabled !== this.combat.enabled) {
        this.combat.enabled = c.enabled;
        this.combat.nextRaid = c.enabled ? (Math.floor(this.tick / STORY_INTERVAL) + 1) * STORY_INTERVAL : 0;
      }
      return {
        ok: true,
        message: c.enabled
          ? '已开启袭击；按殖民地事件日历调度，不重置准备时间'
          : '已关闭后续袭击，场上的敌人仍然存在',
      };
    }
    if (c.type === 'draft') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (!p || p.dead || p.downed || p.carriedBy !== null || typeof c.drafted !== 'boolean')
        return { ok: false, message: '人物当前无法征召' };
      p.drafted = c.drafted;
      this.release(p);
      if (p.drafted && p.cargo?.furniture) this.dropCargo(p);
      p.reason = p.drafted ? '已征召，等待战斗指令' : '解除征召，恢复工作';
      return { ok: true, message: p.reason };
    }
    if (c.type === 'attack') {
      const p = this.pawns.find((p) => p.id === c.pawnId),
        target = this.pawns.find((p) => p.id === c.targetId);
      if (
        !p ||
        !target ||
        p === target ||
        !p.drafted ||
        p.dead ||
        p.downed ||
        target.dead ||
        target.downed ||
        target.carriedBy !== null
      )
        return { ok: false, message: '需要可行动的征召人物和有效攻击目标' };
      this.search(p);
      const ranged = p.weapon && isRangedKind(p.weapon.kind) && !p.weaponDropPending;
      const stand = ranged ? this.shootingStand(p, target) : this.careStand(target);
      if (stand < 0)
        return {
          ok: false,
          message: ranged ? '没有可达且无遮挡的射击位置' : '目标附近没有可达近战位置',
        };
      this.release(p);
      p.attackTargetId = target.id;
      this.go(p, stand, 'combat');
      p.reason = (ranged ? '前往射击' : '前往近战攻击') + target.name;
      return { ok: true, message: p.reason };
    }
    if (c.type === 'storage') {
      if (
        !inside(c.from) ||
        (c.to !== undefined && !inside(c.to)) ||
        (c.connected !== undefined && typeof c.connected !== 'boolean') ||
        (c.connected && c.to !== undefined) ||
        !Number.isInteger(c.priority) ||
        c.priority < 0 ||
        c.priority > 3 ||
        !Array.isArray(c.accepts) ||
        c.accepts.length > resources.length ||
        new Set(c.accepts).size !== c.accepts.length ||
        c.accepts.some((resource) => !resources.includes(resource))
      )
        return { ok: false, message: '仓储设置无效：优先级 0～3，物资种类不能重复' };
      let selected: Stockpile[];
      if (c.connected) {
        const seed = this.stockpiles.find((s) => same(s, c.from));
        if (!seed) return { ok: false, message: '这里没有仓储区' };
        const byCell = new Map(
          this.stockpiles.filter((s) => s.z === seed.z).map((s) => [at(s), s]),
        );
        selected = [seed];
        const seen = new Set([at(seed)]);
        for (let n = 0; n < selected.length; n++)
          for (const [dx, dy] of horizontal) {
            const p = { x: selected[n].x + dx, y: selected[n].y + dy, z: seed.z };
            if (!inside(p)) continue;
            const adjacent = byCell.get(at(p));
            if (adjacent && !seen.has(at(adjacent))) {
              seen.add(at(adjacent));
              selected.push(adjacent);
            }
          }
      } else {
        const to = c.to ?? c.from;
        selected = this.stockpiles.filter(
          (s) =>
            s.x >= Math.min(c.from.x, to.x) &&
            s.x <= Math.max(c.from.x, to.x) &&
            s.y >= Math.min(c.from.y, to.y) &&
            s.y <= Math.max(c.from.y, to.y) &&
            s.z >= Math.min(c.from.z, to.z) &&
            s.z <= Math.max(c.from.z, to.z),
        );
      }
      if (!selected.length || selected.some((s) => !this.standable(s) || this.ladders[at(s)]))
        return { ok: false, message: '请选择有支撑、两格净空的现有仓储区' };
      for (const s of selected) {
        s.priority = c.priority;
        s.accepts = resources.filter((resource) => c.accepts.includes(resource));
      }
      this.refreshReservations();
      this.revision++;
      return {
        ok: true,
        count: selected.length,
        message: `已更新 ${selected.length} 格仓储；搬运会优先选择更高优先级区域`,
      };
    }
    if (c.type === 'device') {
      const d = this.devices.find((d) => d.id === c.deviceId);
      if (
        !d ||
        typeof c.on !== 'boolean' ||
        !Number.isInteger(c.target) ||
        c.target < -50 ||
        c.target > 50
      )
        return { ok: false, message: '设备设置无效，目标温度范围 -50～50°C' };
      d.on = c.on;
      d.target = c.target;
      if (!d.on) {
        d.powered = false;
        d.active = false;
      }
      return { ok: true, message: d.on ? '设备已启用' : '设备已关闭' };
    }
    if (c.type === 'bedMedical') {
      const bed = this.beds.find((b) => b.id === c.bedId);
      if (!bed || typeof c.medical !== 'boolean') return { ok: false, message: '医疗床设置无效' };
      if (bed.medical !== c.medical) {
        for (const p of this.pawns)
          if (p.sleepBedId === bed.id || p.careBedId === bed.id) this.release(p);
        bed.medical = c.medical;
        if (!bed.prisoner) bed.owner = null;
      }
      return {
        ok: true,
        message: bed.medical ? '已设为医疗床，医护会优先救援倒地者' : '已恢复普通床位',
      };
    }
    if (c.type === 'care') {
      const p = this.pawns.find((p) => p.id === c.pawnId),
        patient = this.pawns.find((p) => p.id === c.patientId);
      if (
        !p ||
        !patient ||
        !['rescue', 'feed', 'tend'].includes(c.action) ||
        p.dead ||
        p.downed ||
        p.carriedBy !== null
      )
        return { ok: false, message: '医护或病人无效' };
      if (c.action === 'tend' && patient.medical.policy === 'none')
        return { ok: false, message: `${patient.name}的医疗政策为不接受护理` };
      if (c.action === 'tend' && !needsMedicalTending(patient, this.tick))
        return { ok: false, message: '目前没有需要护理的伤口或感染；已有护理尚未进入续治时间' };
      const ok = this.startCare(p, patient, c.action);
      return {
        ok,
        message: ok
          ? p.reason
          : '无法护理：检查医护操作能力、征召、患者预定、通路与卸货空间；救援另需医疗床，喂食另需实物食物',
      };
    }
    if (c.type === 'medicalPolicy' || c.type === 'medicalRest') {
      const patient = this.pawns.find(
        (p) => p.id === c.pawnId && ['colony', 'prisoner'].includes(p.faction) && !p.dead,
      );
      if (
        !patient ||
        (c.type === 'medicalPolicy'
          ? !MEDICAL_POLICIES.includes(c.policy)
          : typeof c.enabled !== 'boolean')
      )
        return { ok: false, message: '医疗设置无效' };
      if (c.type === 'medicalPolicy') {
        patient.medical.policy = c.policy;
        for (const doctor of this.pawns)
          if (doctor.patientId === patient.id && doctor.carePhase?.startsWith('tend'))
            this.release(doctor);
      } else {
        patient.medical.bedRest = c.enabled;
        if (!c.enabled && !patient.downed && ['rest', 'sleepTravel'].includes(patient.phase))
          this.release(patient);
      }
      this.revision++;
      return {
        ok: true,
        message:
          c.type === 'medicalPolicy'
            ? `医疗政策：${MEDICAL_POLICY_NAMES[c.policy]}`
            : c.enabled
              ? '感染时优先前往床位休养'
              : '取消感染卧床优先',
      };
    }
    if (c.type === 'bedOwner') {
      const b = this.beds.find((b) => b.id === c.bedId);
      if (
        !b ||
        b.medical ||
        b.prisoner ||
        (c.pawnId !== null && !this.pawns.some((p) => p.id === c.pawnId && !p.dead))
      )
        return { ok: false, message: '床位或人物无效' };
      const affected = this.beds.filter(
        (v) => v.id === b.id || (c.pawnId !== null && v.owner === c.pawnId),
      );
      for (const p of this.pawns) if (affected.some((v) => v.id === p.sleepBedId)) this.release(p);
      for (const v of affected) v.owner = null;
      b.owner = c.pawnId;
      return {
        ok: true,
        message: c.pawnId === null ? '床位已取消分配；无人床可自动认领' : '床位已分配',
      };
    }
    if (c.type === 'door') {
      const d = this.doors.find((v) => v.id === c.doorId);
      if (!d || !['auto', 'open', 'locked'].includes(c.mode))
        return { ok: false, message: '门设置无效' };
      if (
        c.mode === 'locked' &&
        (this.pawns.some((p) => same(p, d)) || this.animals.some(a=>same(a,d)) || this.items.some((p) => same(p, d)))
      )
        return { ok: false, message: '门口有人或物资，请移开后再锁门' };
      d.mode = c.mode;
      d.openUntil = c.mode === 'open' ? this.tick + 37 : 0;
      this.revision++;cancelAnimalRopes(this);
      return {
        ok: true,
        message:
          c.mode === 'locked'
            ? '门已锁定，重新规划通路'
            : c.mode === 'open'
              ? '门保持敞开'
              : '门恢复自动开关',
      };
    }
    if (c.type === 'schedule') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (
        !p ||
        !Number.isInteger(c.hour) ||
        c.hour < 0 ||
        c.hour > 23 ||
        !['anything', 'work', 'sleep', 'recreation'].includes(c.assignment)
      )
        return { ok: false, message: '作息安排无效' };
      p.schedule[c.hour] = c.assignment;
      return { ok: true, message: `${c.hour}:00 作息已更新` };
    }
    if (c.type === 'rest') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (!p || p.dead || p.downed || p.drafted || p.carriedBy !== null || p.rest >= 75)
        return { ok: false, message: '精力低于 75% 时可安排入睡' };
      this.startSleep(p);
      return { ok: true, message: p.reason };
    }
    if (c.type === 'priority') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (
        !p ||
        p.dead ||
        !['handle', 'firefight', 'clean', 'warden', 'hunt', 'dig', 'build', 'cut', 'haul', 'grow', 'cook', 'craft', 'care', 'research'].includes(
          c.work,
        ) ||
        !Number.isInteger(c.value) ||
        c.value < 0 ||
        c.value > 4
      )
        return { ok: false, message: '工作优先级无效' };
      p.priorities[c.work] = c.value;
      if (p.psyche.breakUntil <= this.tick) this.release(p);
      return { ok: true, message: '工作优先级已更新；0 为禁用' };
    }
    if (c.type === 'bill') {
      const stove = this.stoves.find((v) => v.id === c.stoveId);
      if (
        !stove ||
        !Number.isInteger(c.target) ||
        c.target < 0 ||
        c.target > 100 ||
        typeof c.paused !== 'boolean'
      )
        return { ok: false, message: '简餐目标需为 0–100 的整数' };
      Object.assign(stove, { target: c.target, paused: c.paused });
      this.legacyProductionUpdate(stove.id, 'cook', c.target, c.paused);
      // Target changes affect the next batch; suspension returns current inputs.
      this.syncProduction();
      return {
        ok: true,
        message: stove.paused
          ? '烹饪已暂停；无落地空间时材料保留原任务等待退回'
          : `简餐不足 ${stove.target} 份时制作`,
      };
    }
    if (c.type === 'wear' || c.type === 'removeApparel') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      const ok = !!p && this.startApparel(p, c.apparelId, c.type === 'wear' ? 'wear' : 'remove');
      return {
        ok,
        message: ok ? p!.reason : '无法换装：需要可行动人物、可达且未被预定的衣物及卸货空间',
      };
    }
    if (c.type === 'tailorBill') {
      const bench = this.tailors.find((b) => b.id === c.tailorId);
      if (
        !bench ||
        !bench.bills.some(b => b.kind === c.kind) ||
        !Number.isInteger(c.target) ||
        c.target < 0 ||
        c.target > 100 ||
        typeof c.paused !== 'boolean'
      )
        return { ok: false, message: '衣物目标需为0～100，配方必须有效' };
      const bill = bench.bills.find((b) => b.kind === c.kind)!;
      bill.target = c.target;
      bill.paused = c.paused;
      this.legacyProductionUpdate(bench.id, `tailoring:${c.kind}`, c.target, c.paused);
      this.syncProduction();
      return {
        ok: true,
        message: c.paused
          ? '此配方已暂停，实物材料保留或安全退回'
          : '衣物目标已更新，当前批次完成后重新计算',
      };
    }
    if (c.type === 'stoneBill') {
      const bench = this.stonecutters.find((b) => b.id === c.stonecutterId);
      if (
        !bench ||
        !Number.isInteger(c.target) ||
        c.target < 0 ||
        c.target > 2000 ||
        typeof c.paused !== 'boolean'
      )
        return { ok: false, message: '石砖目标需为 0～2000 的整数' };
      bench.target = c.target;
      bench.paused = c.paused;
      this.legacyProductionUpdate(bench.id, 'stonecut', c.target, c.paused);
      // A target change only affects the next batch. Pausing interrupts this one.
      this.syncProduction();
      return {
        ok: true,
        message: bench.paused
          ? '切石已暂停；无退料空间则保留岩块等待'
          : `石砖不足 ${bench.target} 块时，每份岩块切出 20 砖`,
      };
    }
    if (c.type === 'move') {
      if (!this.exploredAt(c.target)) return { ok: false, message: '目标区域尚未探索' };
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (
        !p ||
        p.dead ||
        p.downed ||
        p.carriedBy !== null ||
        !inside(c.target) ||
        !this.standable(c.target) ||
        this.sandbags.some((b) => same(b, c.target))
      )
        return { ok: false, message: '目标没有支撑或两格净空' };
      if (!this.pawnAllowed(p,c.target)) return { ok:false, message:'目标在允许区域外；征召后可直接指挥移动' };
      const path = this.path(p, c.target);
      if (!path) return { ok: false, message: '没有可达通路；检查梯子和楼板' };
      this.release(p);
      p.path = path;
      p.destination = at(c.target);
      p.phase = p.drafted ? 'combat' : 'travel';
      p.reason = '前往指定位置';
      return { ok: true, message: '已安排移动' };
    }
    if (c.type !== 'designate' || !inside(c.from) || c.from.z < 1 || c.from.z > HEIGHT - 2)
      return { ok: false, message: '请选择世界内的有效工作层' };
    if (
      c.treeSpecies !== undefined &&
      (c.tool !== 'grove' || !Object.hasOwn(TREE_DATA, c.treeSpecies))
    )
      return { ok: false, message: '林地区需要有效树种' };
    if (
      c.material !== undefined &&
      (!['wood', 'stone'].includes(c.material) || !['wall', 'floor'].includes(c.tool))
    )
      return { ok: false, message: '只有墙壁和楼板可选择木材或石砖' };
    const to = c.to ?? c.from;
    if (!inside(to) || to.z !== c.from.z)
      return { ok: false, message: '一次规划必须锁定同一工作层' };
    const positions: Pos[] = [];
    const x0 = Math.min(c.from.x, to.x),
      x1 = Math.max(c.from.x, to.x),
      y0 = Math.min(c.from.y, to.y),
      y1 = Math.max(c.from.y, to.y);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 128)
      return { ok: false, message: '一次最多安排 128 格，请分批规划' };
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) positions.push({ x, y, z: c.from.z });
    const technologyReason = toolResearchReason(this.research, c.tool);
    if (technologyReason) return { ok: false, message: technologyReason };
    if (c.tool === 'inspect') return { ok: true, message: '选择查看' };
    if (!['mine', 'cancel'].includes(c.tool) && positions.some(p => !this.exploredAt(p)))
      return { ok: false, message: '目标区域尚未探索' };
    if (c.tool === 'clearZone') {
      for (const pos of positions) {
        this.farms = this.farms.filter((f) => !same(f, pos));
        this.treePlots = this.treePlots.filter((f) => !same(f, pos));
        this.stockpiles = this.stockpiles.filter((f) => !same(f, pos));
        this.crops = this.crops.filter((f) => !same(f, pos));
        for (const j of [...this.jobs])
          if ((j.kind === 'sow' || j.kind === 'harvest' || j.kind === 'plantTree') && same(j, pos))
            this.cancel(j);
      }
      this.revision++;
      return {
        ok: true,
        message: '区域已擦除；粮食作物清理，现有树木保留',
        count: positions.length,
      };
    }
    if (c.tool === 'grove') {
      const species = c.treeSpecies ?? naturalSpecies(this.settings);
      let count = 0,
        reason = '';
      // Greedy row order leaves one empty cell between planned tree centers.
      for (const p of positions) {
        const old = this.treePlots.find((f) => same(f, p));
        if (old) {
          if (fertilityOf(this.blocks[at(p) - WIDTH * DEPTH]) < TREE_DATA[species].minFertility) {
            reason = `${TREE_NAMES[species]}所需土壤肥力至少${TREE_DATA[species].minFertility}`;
            continue;
          }
          old.species = species;
          for (const j of [...this.jobs])
            if (j.kind === 'plantTree' && same(j, p) && j.treeSpecies !== species) this.cancel(j);
          count++;
          continue;
        }
        const invalid = this.treeSiteReason(p, species);
        if (invalid || this.treePlots.length >= 512) {
          reason = invalid || '林地上限512个种植点';
          continue;
        }
        this.treePlots.push({ ...p, species });
        count++;
      }
      if (!count) return { ok: false, message: reason || '没有适合栽树的位置' };
      this.syncProduction();
      this.revision++;
      return {
        ok: true,
        count,
        message: `安排${count}个${TREE_NAMES[species]}种植点，间隔一格；成熟后手动伐木，采后自动补植${positions.length > count ? `；跳过${positions.length - count}格：${reason}` : ''}`,
      };
    }
    if (c.tool === 'farm') {
      const kind = c.crop ?? 'rice';
      if (!Object.hasOwn(CROPS, kind)) return { ok: false, message: '未知作物' };
      if (
        positions.some(
          (p) =>
            !this.farmable(p) ||
            this.treePlots.some((f) => same(f, p)) ||
            this.stockpiles.some((s) => same(s, p)) ||
            this.jobs.some(
              (j) =>
                this.footprint(j).some((q) => same(q, p)) &&
                j.kind !== 'sow' &&
                j.kind !== 'harvest',
            ),
        )
      )
        return { ok: false, message: '种植区需要肥力至少 0.7、两格净空，不能与仓储或施工重叠' };
      if (
        this.farms.length + positions.filter((p) => !this.farms.some((f) => same(f, p))).length >
        512
      )
        return { ok: false, message: '种植区最多 512 格' };
      for (const p of positions) {
        const old = this.farms.find((f) => same(f, p));
        if (old) {
          if (old.crop !== kind)
            for (const job of this.jobs.filter((j) => j.kind === 'sow' && same(j, p)))
              this.cancel(job);
          old.crop = kind;
        } else this.farms.push({ ...p, crop: kind });
      }
      this.syncProduction();
      this.revision++;
      return {
        ok: true,
        message: `安排 ${positions.length} 格${CROPS[kind].name}；更换作物在下一次播种生效`,
        count: positions.length,
      };
    }
    if (c.tool === 'cancel') {
      let n = 0;
      for (const p of positions)
        for (const j of [...this.jobs])
          if (same(j,p) || this.footprint(j).some((q) => same(q, p))) {
            this.cancel(j);
            n++;
          }
      return {
        ok: n > 0,
        message: n ? `取消 ${n} 项规划；无落地空间时材料保留原任务等待退回` : '这里没有规划',
        count: n,
      };
    }
    if (c.tool === 'stock') {
      if (new Set(positions.map(p => p.z)).size !== 1 ||
          (c.zoneId !== undefined && !this.stockpileZones.some(z => z.id === c.zoneId)))
        return { ok: false, message: '仓库需要在同一楼层划定，扩展目标必须仍然存在' };
      if (
        positions.some(
          (p) =>
            !this.standable(p) ||
            this.ladders[at(p)] ||
            this.farms.some((f) => same(f, p)) ||
            this.treePlots.some((f) => same(f, p)) ||
            this.furnitureAt(p) ||
            this.jobs.some(
              (j) =>
                ([
                  'shelf', 'smallShelf', 'table', 'chair', 'install',
                  'bed',
                  'door',
                  'stove',
                  'stonecutter',
                  'tailor',
                  'smithy',
                  'machining',
                  'sandbag',
                  'craftingSpot',
                  'researchBench',
                ].includes(j.kind) ||
                  isDeviceKind(j.kind)) &&
                this.footprint(j).some((q) => same(q, p)),
            ),
        )
      )
        return { ok: false, message: '仓储需要有支撑、两格净空的地板，不能设在梯井内' };
      if (
        this.stockpiles.length +
          positions.filter((p) => !this.stockpiles.some((s) => same(s, p))).length >
        4096
      )
        return { ok: false, message: '仓储最多 4096 格，请缩小范围' };
      this.reconcileProductionStorage();
      const newCells = positions.filter(p => !this.stockpiles.some(s => same(s, p)));
      const trial = {stockpiles:[...this.stockpiles, ...newCells.map(p => ({...p,priority:1,accepts:[...resources]}))],
        stockpileZones:structuredClone(this.stockpileZones), nextId:this.nextId};
      const zoneId = c.zoneId ?? stockpileZoneAt(this.stockpileZones, at(c.from))?.id;
      if (newCells.length) {
        const result = zoneId ? expandStockpileZone(trial, zoneId, newCells.map(at)) : createStockpileZone(trial, newCells.map(at));
        if (!result.ok) return result;
        this.stockpiles = trial.stockpiles; this.stockpileZones = trial.stockpileZones; this.nextId = trial.nextId;
      }
      this.revision++;
      return {
        ok: true,
        message: `划定 ${positions.length} 格仓储；可搬运的物资将送往最近仓储`,
        count: positions.length,
      };
    }
    if (c.tool === 'butcherSpot') {
      const p = positions[0];
      if (positions.length !== 1 || this.butcherSpots.length >= 128 ||
          this.placementReason('butcherSpot', p) ||
          this.jobs.some(j => this.footprint(j).some(q => same(p, q))))
        return { ok: false, message: '屠宰点需要一格有支撑的空地，不能与区域或设施重叠' };
      this.butcherSpots.push({ ...p, id: this.id(), paused: false });
      this.syncProduction(); this.revision++;
      return { ok: true, count: 1, message: '已划定屠宰点；厨师会搬来新鲜动物尸体并加工成肉' };
    }
    if (c.tool === 'craftingSpot') {
      const p = positions[0];
      if (
        positions.length !== 1 ||
        this.weaponBenches.length >= 128 ||
        this.placementReason('craftingSpot', p) ||
        this.jobs.some((j) => this.footprint(j).some((q) => same(p, q)))
      )
        return { ok: false, message: '制作点需要一格有支撑的空地，不能重叠区域或已有设施' };
      this.weaponBenches.push(makeWeaponBench(this.id(), 'craftingSpot', p, 'x'));
      this.revision++;
      return { ok: true, message: '已划定制作点，点击设置木棒、匕首或短弓配方', count: 1 };
    }
    const plans: Job[] = [];
    const errors: string[] = [];
    if (c.axis !== undefined && c.axis !== 'x' && c.axis !== 'y')
      return { ok: false, message: '朝向无效' };
    if (
      (['shelf', 'smallShelf', 'table', 'chair', 'bed', 'door', 'fenceGate', 'stonecutter', 'tailor', 'smithy', 'machining', 'researchBench'].includes(
        c.tool,
      ) ||
        isDeviceKind(c.tool)) &&
      positions.length !== 1
    )
      return { ok: false, message: '设施每次放置一件，R 切换朝向' };
    for (const p of positions) {
      if (c.tool === 'shaft' || c.tool === 'up') {
        if (positions.length !== 1) return { ok: false, message: '梯井每次规划一个竖直入口' };
        if (!this.standable(p) || this.treeCells.has(at(p)))
          return { ok: false, message: '请从有两格净空的可站立位置开设梯井' };
        const dir = c.tool === 'shaft' ? -1 : 1;
        if ([0,1,2,3].some(n => { const q = { ...p, z:p.z+dir*n };
          return inside(q) && (this.water[at(q)] || this.water[at(q) - WIDTH*DEPTH] || this.water[at(q) + WIDTH*DEPTH]); }))
          return {ok:false,message:'水域和河床不能开设梯井，请选择干地入口'};
        if (p.z + dir * 3 < 1 || p.z + dir * 3 > HEIGHT - 2)
          return { ok: false, message: '三格梯井超出世界高度' };
        if (!this.ladders[at(p)]) plans.push(this.makeJob('ladder', p));
        for (let i = 1; i <= 3; i++) {
          const q = { ...p, z: p.z + dir * i };
          if (!this.exploredAt(q)) {
            if (dir > 0) return { ok: false, message: '目标区域尚未探索' };
            plans.push(this.makeJob('digLadder', q));
            continue;
          }
          if (this.ladders[at(q)]) continue;
          const b = this.blocks[at(q)];
          if (
            dir < 0 &&
            (
              [
                Block.Stone,
                Block.Soil,
                Block.Steel,
                Block.Components,
                Block.RichSoil,
                Block.Sand,
                Block.Gravel,
              ] as number[]
            ).includes(b)
          )
            plans.push(this.makeJob('digLadder', q));
          else if (!b) plans.push(this.makeJob('ladder', q));
          else return { ok: false, message: '梯井遇到建筑或基岩；请更换位置' };
        }
      } else {
        const kind = c.tool as JobKind;
        const target = kind === 'remove' ? (this.furnitureAt(p) ?? p) : p;
        const reason = this.placementReason(kind, target, c.axis, c.material);
        if (reason) {
          errors.push(reason);
          continue;
        }
        if (!plans.some((j) => same(j, target)))
          plans.push(this.makeJob(kind, target, c.axis, c.material));
      }
    }
    // Natural-resource drags skip empty cells; construction rejects the whole invalid stroke.
    if (
      plans.some(
        (j) =>
          (j.kind === 'ladder' || j.kind === 'digLadder') &&
          (this.farms.some((f) => same(f, j)) ||
            this.treePlots.some((f) => same(f, j)) ||
            this.furnitureAt(j) ||
            this.stoves.some((s) => same(s, j))),
      )
    )
      return { ok: false, message: '梯井与种植区重叠，请先擦除区域' };
    if (errors.length && c.tool !== 'mine' && c.tool !== 'cut')
      return { ok: false, message: errors[0] };
    if (
      plans.some((j) =>
        this.jobs.some(
          (k) =>
            this.jobCellConflict(j, k) &&
            !(
              j.kind === 'remove' &&
              [
                'cook',
                'butcher',
                'refuel',
                'stonecut',
                'tailoring',
                'smith',
                'armorsmith',
                'research',
              ].includes(k.kind)
            ),
        ),
      )
    )
      return { ok: false, message: '规划与已有任务重叠，请先取消原规划' };
    if (!plans.length) return { ok: false, message: errors[0] ?? '没有可安排的目标' };
    if (this.fences.length + [...this.jobs, ...plans].filter(j => j.kind === 'fence').length > PEN_RULES.maxFences ||
        this.fenceGates.length + [...this.jobs, ...plans].filter(j => j.kind === 'fenceGate').length > PEN_RULES.maxGates ||
        this.penMarkers.length + [...this.jobs, ...plans].filter(j => j.kind === 'penMarker').length > PEN_RULES.maxMarkers)
      return {ok:false,message:'围栏、栏门或圈地标记数量已达到上限'};
    if (this.jobs.length + plans.length > 512)
      return { ok: false, message: '规划上限为 512 项，请等部分任务完成' };
    if (
      this.devices.length + [...this.jobs, ...plans].filter((j) => isDeviceKind(j.kind)).length >
        256 ||
      this.wires.length + [...this.jobs, ...plans].filter((j) => j.kind === 'wire').length > 4096
    )
      return { ok: false, message: '电力设施或线路数量达到上限' };
    if (
      this.shelves.length + this.packedFurnitureCount('shelf') + this.packedFurnitureCount('smallShelf') + [...this.jobs,...plans].filter(j=>isShelfKind(j.kind)&&!j.cancelled).length > 256 ||
      this.tables.length + this.packedFurnitureCount('table') + [...this.jobs, ...plans].filter(j => j.kind === 'table').length > 128 ||
      this.chairs.length + this.packedFurnitureCount('chair') + [...this.jobs, ...plans].filter(j => j.kind === 'chair').length > 256 ||
      this.horseshoePins.length + [...this.jobs, ...plans].filter(j => j.kind === 'horseshoePin').length > 128 ||
      this.researchBenches.length +
        [...this.jobs, ...plans].filter((j) => j.kind === 'researchBench').length >
        128 ||
      this.beds.length + this.packedFurnitureCount('bed') + [...this.jobs, ...plans].filter((j) => j.kind === 'bed').length > 128 ||
      this.doors.length + [...this.jobs, ...plans].filter((j) => j.kind === 'door').length > 512 ||
      this.stonecutters.length +
        [...this.jobs, ...plans].filter((j) => j.kind === 'stonecutter').length >
        128 ||
      this.tailors.length + [...this.jobs, ...plans].filter((j) => j.kind === 'tailor').length >
        128 ||
      this.weaponBenches.length +
        [...this.jobs, ...plans].filter((j) => j.kind === 'smithy' || j.kind === 'machining')
          .length >
        128 ||
      this.sandbags.length + [...this.jobs, ...plans].filter((j) => j.kind === 'sandbag').length >
        512
    )
      return { ok: false, message: '设施数量已达到上限' };
    for (const j of plans)
      if (j.kind === 'remove')
        for (const k of [...this.jobs])
          if (
            ['cook', 'butcher', 'refuel', 'stonecut', 'tailoring', 'smith', 'armorsmith', 'research'].includes(
              k.kind,
            ) &&
            same(k, j)
          )
            this.cancel(k);
    this.jobs.push(...plans);
    this.notice = `安排 ${plans.length} 项工作，需求木材 ${plans.reduce((n, j) => n + (j.cost.wood ?? 0), 0)}；缺料和不可达任务会等待`;
    return { ok: true, message: this.notice, count: plans.length };
  }
  private makeJob(
    kind: JobKind,
    p: Pos,
    axis: Axis = 'x',
    material: ConstructionMaterial = 'wood',
    apparelKind?: ApparelKind,
    weaponKind?: WeaponKind,
    weaponBenchKind?: WeaponBenchKind,
  ): Job {
    const species =
      kind === 'cut'
        ? this.trees.find((t) => same(t, p))?.species
        : kind === 'plantTree'
          ? this.treePlots.find((f) => same(f, p))?.species
          : undefined;
    return {
      id: this.id(),
      kind,
      x: p.x,
      y: p.y,
      z: p.z,
      work: workOf(
        kind,
        material,
        species,
        false,
        apparelKind,
        weaponKind,
        weaponBenchKind,
        kind === 'sow'
          ? this.farms.find((f) => same(f, p))?.crop
          : this.crops.find((c) => same(c, p))?.kind,
      ),
      progress: 0,
      workTicks: 0,
      ...(kind === 'cook' ? { cookTraining: [] } : {}),
      ...(isShelfKind(kind) ? { storageSettings: defaultShelfSettings() } : {}),
      ...(['mine', 'digLadder'].includes(kind) ? { miningYieldWork: 0 } : {}),
      owner: null,
      delivered: {},
      deliveredBatches: [],
      cancelled: false,
      cost: costOf(kind, material, apparelKind, weaponKind, weaponBenchKind),
      reason: '等待可达工人',
      ...(['shelf', 'smallShelf', 'table', 'chair', 'bed', 'door', 'fenceGate', 'stonecutter', 'tailor', 'smithy', 'machining', 'researchBench'].includes(
        kind,
      ) || isDeviceKind(kind)
        ? { axis }
        : {}),
      ...(['wall', 'floor'].includes(kind) ? { material } : {}),
      ...(species ? { treeSpecies: species } : {}),
      ...(['sow', 'harvest'].includes(kind)
        ? {
            cropKind:
              kind === 'sow'
                ? this.farms.find((f) => same(f, p))!.crop
                : this.crops.find((c) => same(c, p))!.kind,
          }
        : {}),
      ...(apparelKind ? { apparelKind } : {}),
      ...(weaponKind ? { weaponKind, weaponBenchKind } : {}),
    };
  }
  private placementReason(kind: JobKind, p: Pos, axis: Axis = 'x', material: ConstructionMaterial = 'wood') {
    const footprint = this.footprint({ ...p, kind, axis });
    if (kind === 'mine' && footprint.some(q => !this.exploredAt(q))) return '';
    if (kind !== 'mine' && (!this.exploredAt(p) || footprint.some(q => !this.exploredAt(q))))
      return '目标区域尚未探索';
    if (kind === 'bridge') {
      const foot = at(p) - WIDTH * DEPTH;
      return !inside(p) || p.z < 2 || p.z >= HEIGHT - 1 || this.water[foot] !== 1 ||
        this.blocks[foot] !== Block.Air || this.blocks[at(p)] || this.blocks[at(p) + WIDTH * DEPTH] ||
        this.ladders[at(p)] || !!this.furnitureAt(p) || this.treeCells.has(at(p))
        ? '木桥只能建在浅水上，深水不可架设；桥面需要两格净空' : '';
    }
    if (kind !== 'remove' && footprint.some(q => inside(q) && (this.water[at(q)] ||
      (kind === 'mine' && this.water[at(q) + WIDTH * DEPTH]))))
      return '水域与河床不能直接开挖或填筑，请在浅水上架木桥';
    if (!['mine', 'cut', 'remove', 'uninstall'].includes(kind) && footprint.some(q =>
      inside(q) && waterBelow(this.water, this.blocks, q))) return '水面不能直接建造，请先架木桥';
    if (!bridgeSupports(kind, material) && footprint.some(q => inside(q) && q.z > 0 &&
      this.bridges[at(q) - WIDTH * DEPTH])) return '木桥仅提供轻型承载，不能支撑该建筑';
    if (isShelfKind(kind)) return shelfCells({ ...p, kind, axis }).some(q =>
      !inside(q) || !this.standable(q) || !this.blocks[at(q)-WIDTH*DEPTH] || !!this.ladders[at(q)] ||
      !!this.furnitureAt(q) || this.farms.some(f=>same(f,q)) || this.treePlots.some(f=>same(f,q)) ||
      this.stockpiles.some(s=>same(s,q))) ? '货架需要完整地板和净空，不能重叠设施、种植区或地面仓储' : '';
    if (kind === 'fence' || kind === 'fenceGate' || kind === 'penMarker')
      return !this.standable(p) || !this.blocks[at(p) - WIDTH * DEPTH] || this.ladders[at(p)] ||
        this.furnitureAt(p) || this.farms.some(f=>same(f,p)) || this.treePlots.some(f=>same(f,p)) ||
        this.stockpiles.some(f=>same(f,p)) ? '圈养建筑需要有完整支撑的空地，不能重叠设施、种植区或仓储' : '';
    if (kind === 'researchBench') {
      const cells = researchBenchCells({ ...p, axis });
      if (!this.canStop(researchBenchInteraction({ ...p, axis })))
        return '科研台正面需要有支撑、两格净空的工作位置';
      return cells.some(
        (q) =>
          !inside(q) ||
          !this.standable(q) ||
          !this.blocks[at(q) - WIDTH * DEPTH] ||
          this.ladders[at(q)] ||
          this.farms.some((f) => same(f, q)) ||
          this.treePlots.some((f) => same(f, q)) ||
          this.stockpiles.some((f) => same(f, q)) ||
          this.furnitureAt(q),
      )
        ? '科研台需要3×2空地、完整支撑与两格净空，不能重叠区域或设施'
        : '';
    }
    if (kind === 'craftingSpot' || kind === 'sandbag' || kind === 'butcherSpot' || kind === 'horseshoePin')
      return !this.standable(p) ||
        this.ladders[at(p)] ||
        this.furnitureAt(p) ||
        this.farms.some((f) => same(f, p)) ||
        this.stockpiles.some((f) => same(f, p)) ||
        this.treePlots.some((f) => same(f, p))
        ? '制作点或沙袋需要有支撑的空地'
        : '';
    if (
      !['cut', 'remove', 'plantTree'].includes(kind) &&
      this.treePlots.some((f) => this.footprint({ ...p, kind, axis }).some((q) => same(q, f)))
    )
      return '请先擦除林地区';
    if (kind === 'wire')
      return this.wires.some((q) => same(q, p))
        ? '这里已有电线'
        : !this.standable(p) && !this.solid(p) && !this.deviceAt(p) && !this.furnitureAt(p)
          ? '电线需要地面、墙体或梯井支撑'
          : '';
    if (kind !== 'remove' && this.footprint({ ...p, kind, axis }).some((q) => this.furnitureAt(q)))
      return '这里已有床或门，请先拆除';
    if (
      isDeviceKind(kind) ||
      kind === 'stonecutter' ||
      kind === 'tailor' ||
      kind === 'smithy' ||
      kind === 'machining'
    ) {
      const cells =
        kind === 'stonecutter' || kind === 'tailor' || kind === 'smithy' || kind === 'machining'
          ? stonecutterCells({ ...p, axis })
          : deviceCells({ ...p, kind, axis });
      if (
        (kind === 'stonecutter' ||
          kind === 'tailor' ||
          kind === 'smithy' ||
          kind === 'machining') &&
        !this.canStop(stonecutterInteraction({ ...p, axis }))
      )
        return '切石台正面需要有支撑、两格净空的工作位置';
      return cells.some(
        (q) =>
          !inside(q) ||
          !this.standable(q) ||
          !this.blocks[at(q) - WIDTH * DEPTH] ||
          this.ladders[at(q)] ||
          this.farms.some((f) => same(f, q)) ||
          this.stockpiles.some((s) => same(s, q)) ||
          this.furnitureAt(q),
      )
        ? '设备占地需要完整支撑与两格净空，不能重叠区域、梯井或设施'
        : '';
    }
    if (kind === 'table' || kind === 'chair' || kind === 'bed' || kind === 'door') {
      const cells = kind === 'table' ? tableCells({ ...p, axis }) : kind === 'bed' ? bedCells({ ...p, axis }) : [p];
      return cells.some(
        (q) =>
          !this.standable(q) ||
          this.ladders[at(q)] ||
          !this.blocks[at(q) - WIDTH * DEPTH] ||
          this.farms.some((f) => same(f, q)) ||
          this.stockpiles.some((s) => same(s, q)) ||
          this.furnitureAt(q),
      )
        ? '床和门需要有支撑的空置地板与两格净空，不能重叠区域或设施'
        : '';
    }
    if (kind !== 'remove' && this.stoves.some((s) => same(s, p))) return '这里已有灶台';
    if (
      this.farms.some((f) => f.x === p.x && f.y === p.y && Math.abs(f.z - p.z) <= 1) &&
      ['wall', 'floor', 'ladder', 'stove'].includes(kind)
    )
      return '先用擦除区域工具清理种植区';
    const b = this.blocks[at(p)],
      above = this.blocks[index(p.x, p.y, p.z + 1)];
    if (kind === 'mine')
      return [b, above].some((b) =>
        (
          [
            Block.Soil,
            Block.Stone,
            Block.Steel,
            Block.Components,
            Block.RichSoil,
            Block.Sand,
            Block.Gravel,
          ] as number[]
        ).includes(b),
      )
        ? ''
        : '此处没有可开挖的自然方块';
    if (kind === 'cut') return this.trees.some((t) => same(t, p)) ? '' : '此处没有树木';
    if (kind === 'stove')
      return !this.standable(p) || this.ladders[at(p)] || this.stockpiles.some((s) => same(s, p))
        ? '灶台需要有支撑的空置地板，不能与仓储重叠'
        : '';
    if (kind === 'floor')
      return this.water[index(p.x, p.y, p.z - 1)] || this.blocks[index(p.x, p.y, p.z - 1)] || b || above || this.treeCells.has(at(p))
        ? '楼板位置需为空，楼面上方保留两格净空'
        : '';
    if (kind === 'wall')
      return b || above || this.ladders[at(p)] || this.treeCells.has(at(p))
        ? '墙壁需要空置的两格空间'
        : '';
    if (kind === 'ladder')
      return b || above || this.ladders[at(p)] || this.treeCells.has(at(p))
        ? '梯子需要空置的两格空间'
        : '';
    if (kind === 'remove')
      return this.wires.some((q) => same(q, p)) ||
        this.furnitureAt(p) ||
        this.stoves.some((s) => same(s, p)) ||
        b === Block.Wood ||
        b === Block.Masonry ||
        this.ladders[at(p)] ||
        [Block.Wood, Block.Masonry].includes(this.blocks[index(p.x, p.y, p.z - 1)] as 4 | 7)
        ? ''
        : '只能拆除建造的墙、楼板、梯子或设施';
    return '未知的规划类型';
  }
  /** Reservations reference physical stacks; no shadow food inventory exists. */
  private availableStack(item: Stack, ignorePawnId?: number): number {
    if (itemForbiddenTo(this.pawns.find(p => p.id === ignorePawnId), item, this.tick)) return 0;
    if (item.unfinished && (item.forbidden || this.jobs.some(j => j.unfinishedId === item.unfinished!.id &&
      j.owner !== null && j.owner !== ignorePawnId && !j.cancelled))) return 0;
    let available = item.amount;
    for (const p of this.pawns) if (p.id !== ignorePawnId) {
      if (p.careFoodId === item.id || p.careMedicineId === item.id) available -= p.careAmount;
      if (p.handleTask?.stage === 'fetch' && p.handleTask.foodId === item.id) available -= p.handleTask.amount;
      if (p.living.mealTask?.sourceId === item.id) available -= p.living.mealTask.amount;
      const fetch = this.fetchReservations.get(p.id), haul = this.storageReservations.get(p.id);
      if (fetch?.sourceId === item.id) available -= fetch.amount;
      if (haul?.sourceId === item.id) available -= haul.batch.amount;
    }
    return Math.max(0, available);
  }
  private releaseCare(p: Pawn) {
    if (p.carryingPawnId !== null) {
      const patient = this.pawns.find((q) => q.id === p.carryingPawnId);
      if (patient) {
        Object.assign(patient, { x: p.x, y: p.y, z: p.z });
        patient.carriedBy = null;
        patient.phase = patient.dead ? 'dead' : patient.downed ? 'downed' : patient.faction === 'prisoner' ? 'prisoner' : 'idle';
        patient.reason = patient.dead
          ? patient.deathReason!
          : patient.downed
            ? '救援中断，原地等待医护'
            : '已恢复行动';
      }
    }
    p.carryingPawnId = null;
    p.patientId = null;
    p.careBedId = null;
    p.careFoodId = null;
    p.careMedicineId = null;
    p.careAmount = 0;
    p.carePhase = null;
    p.careProgress = 0;
  }
  private patientBed(p: Pawn): Bed | undefined {
    return this.beds.find((b) => same(b, p) && b.prisoner === (p.faction === 'prisoner') &&
      (p.faction === 'prisoner' ? b.owner === p.id : b.medical || b.owner === p.id));
  }
  private restingGain(p: Pawn): number {
    const bed = this.patientBed(p);
    return restGain(!!bed, bed ? furnitureStats('bed', bed.quality).restEffectiveness! : 1);
  }
  private furnitureCells(kind: RelocatableKind, pos: Pos, axis: Axis): Pos[] {
    return isShelfKind(kind) ? shelfCells({...pos,kind,axis}) : kind === 'bed' ? bedCells({...pos,axis}) : kind === 'table' ? tableCells({...pos,axis}) : [{x:pos.x,y:pos.y,z:pos.z}];
  }
  private installedFurniture(kind: RelocatableKind, id: number): Bed | DiningTable | DiningChair | Shelf | undefined {
    return (isShelfKind(kind) ? this.shelves.filter(s => s.kind === kind) : kind === 'bed' ? this.beds : kind === 'table' ? this.tables : this.chairs).find(b => b.id === id);
  }
  private packedFurniture(id: number): Cargo | undefined {
    return [...this.items, ...this.pawns.flatMap(p => p.cargo ? [p.cargo] : []),
      ...this.jobs.flatMap(j => j.deliveredBatches)].find(b => b.furniture?.id === id);
  }
  private packedFurnitureCount(kind: RelocatableKind): number {
    return [...this.items, ...this.pawns.flatMap(p => p.cargo ? [p.cargo] : []),
      ...this.jobs.flatMap(j => j.deliveredBatches)].filter(b => b.furniture?.kind === kind).length;
  }
  /** Placement trials change only geometry caches, never a furniture instance. */
  private withoutFurniture<T>(kind: RelocatableKind, id: number, trial: () => T): T {
    const original = {beds:this.beds,tables:this.tables,chairs:this.chairs,shelves:this.shelves};
    if (isShelfKind(kind)) this.shelves = this.shelves.filter(s => s.id !== id);
    else if (kind === 'bed') this.beds = this.beds.filter(b => b.id !== id);
    else if (kind === 'table') this.tables = this.tables.filter(b => b.id !== id);
    else this.chairs = this.chairs.filter(b => b.id !== id);
    this.rebuildDevices();
    try { return trial(); } finally { Object.assign(this,original); this.rebuildDevices(); }
  }
  private pruneStorageSpills() {
    if (!this.storageSpills.length) return;
    const counts = new Map<number,number>();
    for (const item of this.items) counts.set(at(item),(counts.get(at(item)) ?? 0)+1);
    this.storageSpills = this.storageSpills.filter(p => !this.shelfAt(p) && (counts.get(at(p)) ?? 0) > 1);
  }
  private planShelfRemoval(shelf: Shelf, extra: Cargo[] = []) {
    const cells = new Set(shelfCells(shelf).map(at)), originalReservations = this.storageReservations;
    const excess: Stack[] = [];
    for (const cell of cells) excess.push(...this.items.filter(i => at(i) === cell).sort((a,b)=>a.id-b.id).slice(1));
    const ids = new Set(excess.map(i=>i.id));
    this.storageReservations = new Map([...originalReservations].filter(([,r])=>!cells.has(r.cell)));
    try {
      return this.withoutFurniture(shelf.kind,shelf.id,() => this.planPlacement([
        ...excess.map(batch => ({ batch, origin:batch, sourceId:batch.id })),
        ...extra.map(batch => ({ batch, origin:shelf })),
      ],this.items.filter(i=>!ids.has(i.id))));
    } finally { this.storageReservations = originalReservations; }
  }
  private releaseShelfUsers(shelf: Shelf) {
    const cells = new Set(shelfCells(shelf).map(at));
    this.invalidateStackPlans(this.items.filter(i=>cells.has(at(i))),'货架已改变，重新安排取放');
    for (const [id,r] of [...this.storageReservations]) if (cells.has(r.cell)) {
      const p = this.pawns.find(p=>p.id===id); if (p) this.interruptProductionDelivery(p); else this.storageReservations.delete(id);
    }
  }
  private relocationCommand(c: Extract<VoxelCommand,{type:'uninstallFurniture'|'installFurniture'|'cancelFurnitureMove'}>): CommandResult {
    if (!Number.isSafeInteger(c.furnitureId) || c.furnitureId < 1) return {ok:false,message:'家具身份无效'};
    const current = this.jobs.filter(j => j.furnitureId === c.furnitureId);
    if (c.type === 'cancelFurnitureMove') {
      if (!current.length) return {ok:false,message:'这件家具没有搬装任务'};
      for (const j of current) if (this.jobs.includes(j)) this.cancel(j);
      return {ok:true,message:'已取消搬装；已经卸下的家具保留为实体，等待安全落地或搬入仓储'};
    }
    if (!isRelocatableKind(c.kind)) return {ok:false,message:'请选择可卸装的家具或货架'};
    const installed = this.installedFurniture(c.kind,c.furnitureId), packed = this.packedFurniture(c.furnitureId);
    if (!installed && (!packed || packed.furniture?.kind !== c.kind)) return {ok:false,message:'这件家具已不存在'};
    if (current.some(j => j.cancelled)) return {ok:false,message:'原搬装任务正在退还实物，请先清理附近地面'};
    if (c.type === 'uninstallFurniture' && (!installed || current.length)) return {ok:false,message:'家具已卸下或已有搬装任务'};
    if (c.type === 'installFurniture' && current.some(j => j.kind === 'install')) return {ok:false,message:'已有重装位置，请先取消原搬装任务'};
    if (installed) {
      const cells = this.furnitureCells(c.kind,installed,installed.axis);
      if (this.fires.some(f => cells.some(q => same(f,q)))) return {ok:false,message:'家具正在燃烧，请先灭火'};
      if (this.jobs.some(j => !j.cancelled && j.furnitureId !== c.furnitureId && cells.some(q => this.footprint(j).some(r => same(q,r)))))
        return {ok:false,message:'原位置已有其他施工，请先取消冲突任务'};
    }
    if (c.type === 'installFurniture') {
      if (!inside(c.target) || !['x','y'].includes(c.axis)) return {ok:false,message:'安装位置或朝向无效'};
      const reason = installed ? this.withoutFurniture(c.kind,installed.id,() => this.placementReason(c.kind,c.target,c.axis)) : this.placementReason(c.kind,c.target,c.axis);
      if (reason) return {ok:false,message:reason};
      const plan = {...c.target,kind:'install' as const,axis:c.axis,furnitureKind:c.kind};
      if (this.jobs.some(j => !j.cancelled && j.furnitureId !== c.furnitureId && this.jobCellConflict(plan,j)))
        return {ok:false,message:'重装位置与其他规划重叠'};
      if (this.fires.some(f => this.furnitureCells(c.kind,c.target,c.axis).some(q => same(f,q))))
        return {ok:false,message:'目标位置正在燃烧，请先灭火'};
    }
    const needsUninstall = installed && !current.some(j => j.kind === 'uninstall');
    if (this.jobs.length + Number(!!needsUninstall) + Number(c.type === 'installFurniture') > 512)
      return {ok:false,message:'规划上限为512项，请先完成部分工作'};
    if (needsUninstall) this.jobs.push({...this.makeJob('uninstall',installed),axis:installed.axis,furnitureId:installed.id,furnitureKind:c.kind});
    if (c.type === 'installFurniture') this.jobs.push({...this.makeJob('install',c.target),axis:c.axis,furnitureId:c.furnitureId,furnitureKind:c.kind});
    this.notice = c.type === 'uninstallFurniture' ? '已安排卸下；保留家具品质和耐久，不返还建材' : '已安排实体搬运与重装；品质和耐久保持，床的医疗/囚犯标记在卸下时重置';
    return {ok:true,message:this.notice};
  }
  private treatmentRoomFactor(patient: Pawn): number {
    this.updateRooms();
    const room = this.rooms.roomAt(patient);
    if (!room || room.outdoor) return 1;
    return infectionRoomFactor(this.cleanlinessAt(patient));
  }
  /** Cache the costly floor scan until the room topology changes. Filth and
   * loose chunks are small dynamic lists, aggregated only when a consumer asks. */
  private roomCleanliness(): RoomCleanliness[] {
    this.updateRooms();
    if (this.cleanlinessRevision !== this.roomRevision) {
      this.cleanlinessBase.clear();
      for (const room of this.rooms.snapshot()) this.cleanlinessBase.set(room.id, { total: 0, count: 0 });
      for (let i = WIDTH * DEPTH; i < CELLS - WIDTH * DEPTH; i++) {
        const base = this.cleanlinessBase.get(this.rooms.roomIds[i]);
        if (!base || !this.blocks[i - WIDTH * DEPTH] || this.blocks[i + WIDTH * DEPTH]) continue;
        base.count++;
        if (this.dirtyGround(this.blocks[i - WIDTH * DEPTH])) base.total--;
      }
      this.cleanlinessRevision = this.roomRevision;
    }
    const totals = new Map([...this.cleanlinessBase].map(([id, base]) => [id, { ...base, filthAmount: 0 }]));
    for (const f of this.filth) {
      const room = totals.get(this.rooms.roomIds[at(f)]);
      if (room) {
        // Thickness extends cleaning work; a filth Thing contributes its cleanliness once.
        room.total -= SANITATION_RULES.filthPenalty[f.kind]; room.filthAmount += f.amount;
      }
    }
    for (const item of this.items) if (item.resource === 'chunk') {
      const room = totals.get(this.rooms.roomIds[at(item)]);
      if (room) room.total -= 2 * item.amount;
    }
    return [...totals].map(([roomId, v]) => ({ roomId, cleanliness: v.count ? v.total / v.count : 0,
      filthAmount: v.filthAmount, floorCells: v.count }));
  }
  cleanlinessAt(pos: Pos): number {
    if (!inside(pos)) return 0;
    this.updateRooms();
    return this.roomCleanliness().find(r => r.roomId === this.rooms.roomIds[at(pos)])?.cleanliness ?? 0;
  }
  private dirtyGround(block: number): boolean {
    return ([Block.Soil, Block.RichSoil, Block.Sand, Block.Gravel] as readonly number[]).includes(block);
  }
  private filthSupported(p: Pos): boolean {
    return inside(p) && p.z > 0 && p.z < HEIGHT - 1 && this.blocks[at(p)] === Block.Air &&
      this.blocks[at(p) + WIDTH * DEPTH] === Block.Air && this.blocks[at(p) - WIDTH * DEPTH] !== Block.Air;
  }
  private addFilth(kind: FilthKind, pos: Pos, amount = 1) {
    if (!this.filthSupported(pos)) return;
    const existing = this.filth.find(f => f.kind === kind && same(f, pos));
    if (existing) existing.amount = Math.min(SANITATION_RULES.maxLayers, existing.amount + amount);
    else if (this.filth.length < SANITATION_RULES.maxFilth)
      this.filth.push({ id: this.id(), x: pos.x, y: pos.y, z: pos.z, kind, amount, createdTick: this.tick });
  }
  private pruneFilth() {
    this.filth = this.filth.filter(f => this.filthSupported(f));
    for (const p of this.pawns) if (p.cleanTask && !this.validClean(p)) this.release(p);
  }
  private trackDirt(p: Pawn, from: Pos) {
    const oldFloor = from.z > 0 ? this.blocks[at(from) - WIDTH * DEPTH] : Block.Air;
    const foot = at(p) - WIDTH * DEPTH, newFloor = this.blocks[foot];
    if (this.dirtyGround(oldFloor) || this.dirtyGround(newFloor)) p.dirtCarry = SANITATION_RULES.dirtCarry;
    if ((newFloor === Block.Wood || newFloor === Block.Masonry) &&
        [0, 1].includes(this.structureKinds[foot]) && p.dirtCarry > 0 && this.filthSupported(p)) {
      this.addFilth('dirt', p); p.dirtCarry--;
    }
  }
  private validClean(p: Pawn): boolean {
    const f = this.filth.find(f => f.id === p.cleanTask?.filthId);
    return !!f && p.phase === 'clean' && p.faction === 'colony' && !p.dead && !p.downed &&
      !p.drafted && p.carriedBy === null && p.carryingPawnId === null && p.cargo === null &&
      p.jobId === null && p.carePhase === null && p.wardenTask === null && p.psyche.breakUntil <= this.tick &&
      healthSummary(p).manipulation > 0 && this.pawnAllowed(p,f) && this.homeArea.has(at(f)) && this.filthSupported(f) && this.canStop(f) &&
      !this.pawns.some(other => other !== p && other.cleanTask?.filthId === f.id);
  }
  private startClean(p: Pawn, f: Filth): boolean {
    if (p.faction !== 'colony' || p.dead || p.downed || p.drafted || p.carriedBy !== null ||
        p.carryingPawnId !== null || p.psyche.breakUntil > this.tick || healthSummary(p).manipulation <= 0 ||
        !this.pawnAllowed(p,f) || !this.homeArea.has(at(f)) || !this.canStop(f) || !this.filthSupported(f) ||
        this.pawns.some(other => other !== p && other.cleanTask?.filthId === f.id)) return false;
    const route = this.path(p, f);
    if (route === null || !this.dropCargo(p)) return false;
    this.release(p);
    p.cleanTask = { filthId: f.id, progress: 0 }; p.phase = 'clean';
    p.path = route; p.destination = route.length ? at(f) : null;
    p.reason = `清扫${FILTH_NAMES[f.kind]}`;
    return true;
  }
  private tryClean(p: Pawn): boolean {
    if (!p.priorities.clean || p.cargo || !this.homeArea.size || !this.filth.length) return false;
    const candidates = this.filth.filter(f => this.pawnAllowed(p,f) && this.homeArea.has(at(f)) && this.canStop(f) &&
      !this.pawns.some(other => other.cleanTask?.filthId === f.id));
    if (!candidates.length) return false;
    this.search(p);
    const f = candidates.filter(f => this.distance[at(f)] >= 0)
      .sort((a, b) => this.distance[at(a)] - this.distance[at(b)] || a.id - b.id)[0];
    return !!f && this.startClean(p, f);
  }
  private cleanTick(p: Pawn) {
    if (!this.validClean(p)) { this.release(p); return; }
    const f = this.filth.find(f => f.id === p.cleanTask!.filthId)!;
    if (!same(p, f)) { this.release(p); return; }
    p.destination = null;
    p.cleanTask!.progress += healthSummary(p).manipulation;
    if (p.cleanTask!.progress < SANITATION_RULES.cleanWork) return;
    p.cleanTask!.progress = 0; f.amount--;
    if (f.amount === 0) {
      this.filth = this.filth.filter(other => other.id !== f.id);
      this.release(p); p.reason = '已清扫污物';
    }
  }
  private startMedicalRest(p: Pawn): boolean {
    if (
      !medicalNeedsRest(p) ||
      p.drafted ||
      p.dead ||
      p.downed ||
      p.faction !== 'colony' ||
      p.carePhase !== null ||
      p.eating
    )
      return false;
    this.search(p);
    const bed = this.beds
      .filter(
        (b) =>
          this.pawnAllowed(p,b) && !b.prisoner && (b.medical || b.owner === p.id) &&
          this.distance[at(b)] >= 0 &&
          !this.pawns.some(
            (q) =>
              q.id !== p.id &&
              (q.sleepBedId === b.id ||
                q.careBedId === b.id ||
                bedCells(b).some((c) => same(c, q))),
          ),
      )
      .sort(
        (a, b) =>
          Number(b.medical) - Number(a.medical) || this.distance[at(a)] - this.distance[at(b)],
      )[0];
    if (!bed || !this.dropCargo(p)) return false;
    this.release(p);
    this.search(p);
    p.sleepBedId = bed.id;
    this.go(p, at(bed), 'sleepTravel');
    p.reason = '前往床位休养感染';
    return true;
  }
  /** search(origin) must precede this call; helpers share the navigation workspace. */
  private careStand(patient: Pawn, worker?: Pawn): number {
    const candidates = horizontal.map(([dx, dy]) => ({
      x: patient.x + dx,
      y: patient.y + dy,
      z: patient.z,
    }));
    return (
      candidates
        .filter((q) => this.canStop(q) && this.distance[at(q)] >= 0 && (!worker || this.pawnAllowed(worker,q)))
        .sort((a, b) => this.distance[at(a)] - this.distance[at(b)])
        .map(at)[0] ?? -1
    );
  }
  private freeMedicalBed(p: Pawn, patient: Pawn): Bed | undefined {
    return this.beds
      .filter(
        (b) =>
          b.medical && this.pawnAllowed(p,b) &&
          b.prisoner === (patient.faction === 'prisoner') &&
          (!b.prisoner || b.owner === patient.id) &&
          this.distance[at(b)] >= 0 &&
          !this.pawns.some(
            (q) =>
              q.id !== patient.id &&
              q.id !== p.id &&
              (bedCells(b).some((cell) => same(cell, q)) ||
                q.sleepBedId === b.id ||
                q.careBedId === b.id),
          ),
      )
      .sort((a, b) => this.distance[at(a)] - this.distance[at(b)])[0];
  }
  private startCare(p: Pawn, patient: Pawn, action: 'rescue' | 'feed' | 'tend'): boolean {
    if (
      p === patient || !this.pawnAllowed(p,patient) ||
      healthSummary(p).manipulation <= 0 ||
      p.dead ||
      p.downed ||
      p.drafted ||
      p.faction !== 'colony' ||
      !['colony', 'prisoner'].includes(patient.faction) ||
      p.carriedBy !== null ||
      patient.dead ||
      patient.prisoner?.releasing ||
      (action !== 'tend' && !patient.downed && !(action === 'feed' && patient.faction === 'prisoner')) ||
      patient.carriedBy !== null ||
      this.pawns.some((q) => q.id !== p.id && q.patientId === p.id) ||
      this.pawns.some((q) => q.id !== p.id && (q.patientId === patient.id || q.wardenTask?.prisonerId === patient.id))
    )
      return false;
    const patientBed = this.patientBed(patient);
    if (action === 'tend') {
      if (
        patient.drafted ||
        patient.medical.policy === 'none' ||
        !needsMedicalTending(patient, this.tick)
      )
        return false;
    } else if (action === 'rescue' ? !!patientBed : !patientBed || patient.food > 26) return false;
    this.search(p);
    const stand = this.careStand(patient);
    if (stand < 0) return false;
    const bed = action === 'rescue' ? this.freeMedicalBed(p, patient) : undefined;
    if (action === 'rescue' && !bed) return false;
    const carriedFood = action === 'feed' && p.cargo && NUTRITION[p.cargo.resource];
    const carriedMedicine =
      action === 'tend' && patient.medical.policy === 'herbal' && p.cargo?.resource === 'herb';
    const medicine =
      action === 'tend' && patient.medical.policy === 'herbal' && !carriedMedicine
        ? this.pileFor(p, 'herb')
        : undefined;
    const food =
      action === 'feed' && !carriedFood
        ? (['meal', 'food', 'milk', 'grain', 'meat'] as Resource[]).map((r) => this.pileFor(p, r)).find(Boolean)
        : undefined;
    if (action === 'feed' && !carriedFood && !food) return false;
    // A full ground never destroys existing cargo to make room for a rescue.
    if (!carriedFood && !carriedMedicine && !this.dropCargo(p)) return false;
    this.release(p);
    this.search(p);
    p.patientId = patient.id;
    p.careBedId = bed?.id ?? null;
    p.careProgress = 0;
    if (action === 'tend') {
      // The patient waits at the actual treatment site. No teleport or instant healing.
      const sleeping = patient.phase === 'rest' || (patient.faction === 'prisoner' && patient.sleepingSince !== null);
      const sleepBedId = patient.sleepBedId,
        sleepingSince = patient.sleepingSince;
      this.release(patient);
      if (patient.downed && patientBed) patient.sleepBedId = patientBed.id;
      else if (sleeping) Object.assign(patient, { phase: patient.faction === 'prisoner' ? 'prisoner' : 'rest', sleepBedId, sleepingSince });
      if (medicine) {
        p.careMedicineId = medicine.id;
        p.careAmount = Math.min(
          this.availableStack(medicine, p.id),
          medicineNeeded(patient, this.tick),
          carryLimit('herb'),
        );
        p.carePhase = 'tendFetch';
        this.go(p, this.reachableItemStand(medicine), 'care');
        p.reason = `为${patient.name}取${p.careAmount}份草药`;
      } else {
        p.carePhase = 'tendApproach';
        this.go(p, this.careStand(patient), 'care');
        p.reason =
          (carriedMedicine
            ? '携带草药前往护理'
            : patient.medical.policy === 'herbal'
              ? '无可达草药，前往无药护理'
              : '前往无药护理') + patient.name;
      }
    } else if (action === 'rescue') {
      p.carePhase = 'rescueApproach';
      this.go(p, this.careStand(patient), 'care');
      p.reason = '前往救援' + patient.name;
    } else if (carriedFood) {
      p.carePhase = 'feedApproach';
      this.go(p, this.careStand(patient), 'care');
      p.reason = '携带食物前往' + patient.name;
    } else {
      p.careFoodId = food!.id;
      p.careAmount = Math.min(
        this.availableStack(food!, p.id),
        ['grain', 'meat', 'milk'].includes(food!.resource) ? Math.ceil((100 - patient.food) / (100 * NUTRITION.grain!)) : 1,
      );
      p.carePhase = 'feedFetch';
      this.go(p, this.reachableItemStand(food!), 'care');
      p.reason = '为' + patient.name + '取食物';
    }
    return true;
  }
  private tryCare(p: Pawn): boolean {
    const patients = this.pawns
      .filter(
        (q) =>
          (q.downed || (q.medical.policy !== 'none' && needsMedicalTending(q, this.tick))) &&
          ['colony', 'prisoner'].includes(q.faction) &&
          !q.drafted &&
          q.carePhase === null &&
          !q.dead &&
          q.carriedBy === null &&
          q.id !== p.id &&
          !this.pawns.some((r) => r.id !== p.id && r.patientId === q.id),
      )
      .sort(
        (a, b) =>
          Math.max(b.health.malnutrition, b.health.hypothermia, b.health.heatstroke) -
          Math.max(a.health.malnutrition, a.health.hypothermia, a.health.heatstroke),
      );
    for (const patient of patients)
      if (
        this.startCare(
          p,
          patient,
          patient.medical.policy !== 'none' && needsMedicalTending(patient, this.tick)
            ? 'tend'
            : this.patientBed(patient)
              ? 'feed'
              : 'rescue',
        )
      )
        return true;
    return false;
  }
  private validCare(p: Pawn): boolean {
    if (healthSummary(p).manipulation <= 0 || !this.pawnTaskInArea(p)) return false;
    const patient = this.pawns.find((q) => q.id === p.patientId);
    if (!patient || patient.dead || patient.prisoner?.releasing || !['colony', 'prisoner'].includes(patient.faction) || patient.drafted || !p.carePhase)
      return false;
    if (p.carePhase.startsWith('tend'))
      return (
        patient.carriedBy === null &&
        patient.medical.policy !== 'none' &&
        needsMedicalTending(patient, this.tick) &&
        (p.carePhase !== 'tendFetch' ||
          (patient.medical.policy === 'herbal' &&
            this.items.some(
              (i) =>
                i.id === p.careMedicineId &&
                i.resource === 'herb' &&
                this.availableStack(i, p.id) >= p.careAmount,
            )))
      );
    if (!patient.downed && !(patient.faction === 'prisoner' && p.carePhase.startsWith('feed'))) return false;
    if (p.carePhase === 'rescueApproach' || p.carePhase === 'rescueCarry')
      return (
        this.beds.some((b) => b.id === p.careBedId && b.medical && b.prisoner === (patient.faction === 'prisoner')) &&
        (p.carePhase === 'rescueCarry' ? patient.carriedBy === p.id : patient.carriedBy === null)
      );
    return (
      patient.carriedBy === null &&
      !!this.patientBed(patient) &&
      patient.food <= 26 &&
      (p.carePhase === 'feedFetch'
        ? this.items.some(
            (i) => i.id === p.careFoodId && this.availableStack(i, p.id) >= p.careAmount,
          )
        : !!p.cargo && !!NUTRITION[p.cargo.resource])
    );
  }
  private arriveCare(p: Pawn) {
    if (!this.validCare(p)) {
      this.release(p);
      p.reason = '护理条件改变，重新安排';
      return;
    }
    const patient = this.pawns.find((q) => q.id === p.patientId)!;
    if (p.carePhase === 'feedFetch' || p.carePhase === 'tendFetch') {
      const fetchingMedicine = p.carePhase === 'tendFetch';
      const food = this.items.find(
        (i) => i.id === (fetchingMedicine ? p.careMedicineId : p.careFoodId),
      );
      if (!food || !this.itemTouch(p,food) || !this.take(p, food.resource, p.careAmount, food.id)) {
        this.release(p);
        return;
      }
      p.careFoodId = null;
      p.careMedicineId = null;
      p.careAmount = 0;
      this.search(p);
      const stand = this.careStand(patient);
      if (stand < 0) {
        this.release(p);
        p.reason = '病人通路中断，保留携带物资';
        return;
      }
      p.carePhase = fetchingMedicine ? 'tendApproach' : 'feedApproach';
      this.go(p, stand, 'care');
      p.reason = (fetchingMedicine ? '把草药送到' : '把食物送到') + patient.name;
      return;
    }
    if (p.carePhase === 'rescueCarry') {
      const bed = this.beds.find((b) => b.id === p.careBedId && b.medical)!;
      if (!same(p, bed)) {
        this.release(p);
        return;
      }
      Object.assign(patient, { x: bed.x, y: bed.y, z: bed.z });
      patient.carriedBy = null;
      patient.sleepBedId = bed.id;
      patient.phase = 'downed';
      patient.reason = '卧床等待喂食或适宜温度恢复';
      p.carryingPawnId = null;
      this.release(p);
      p.reason = '已把' + patient.name + '送到医疗床';
      return;
    }
    if (p.z !== patient.z || Math.abs(p.x - patient.x) + Math.abs(p.y - patient.y) !== 1) {
      this.release(p);
      p.reason = '病人位置改变，重新安排';
      return;
    }
    if (p.carePhase === 'rescueApproach') {
      this.search(p);
      const bed = this.beds.find((b) => b.id === p.careBedId && b.medical)!;
      if (this.distance[at(bed)] < 0) {
        this.release(p);
        p.reason = '医疗床通路中断';
        return;
      }
      patient.carriedBy = p.id;
      patient.sleepBedId = null;
      Object.assign(patient, { x: p.x, y: p.y, z: p.z });
      p.carryingPawnId = patient.id;
      p.carePhase = 'rescueCarry';
      this.go(p, at(bed), 'care');
      p.reason = '抱起' + patient.name + '前往医疗床';
      patient.reason = '由' + p.name + '抱往医疗床';
      return;
    }
    if (p.carePhase === 'tendApproach' || p.carePhase === 'tend') {
      if (healthSummary(p).manipulation <= 0) {
        this.release(p);
        p.reason = '操作能力不足，无法护理';
        return;
      }
      p.carePhase = 'tend';
      p.destination = null;
      p.careProgress += tendSpeed(p.skills, healthSummary(p).manipulation, healthSummary(p).sight);
      const usingMedicine = patient.medical.policy === 'herbal' && p.cargo?.resource === 'herb';
      p.reason = (usingMedicine ? '草药护理' : '无药护理') + patient.name;
      if (p.careProgress < MEDICAL_CARE_WORK) return;
      learnSkill(p.skills.medicine, 250);
      const treatment = tendMedical(patient, {
        seed: this.seed,
        pawnId: patient.id,
        doctorId: p.id,
        tick: this.tick,
        doctorQuality: tendQuality(p.skills, healthSummary(p).manipulation, healthSummary(p).sight),
        medicine: usingMedicine,
        roomFactor: this.treatmentRoomFactor(patient),
      });
      if (treatment && usingMedicine) {
        this.stats.consumed.herb++;
        p.cargo!.amount--;
        if (p.cargo!.amount === 0) p.cargo = null;
      }
      p.careProgress = 0;
      if (!needsMedicalTending(patient, this.tick)) {
        this.release(p);
        p.reason = '已完成护理，伤口与感染继续恢复';
      } else if (patient.medical.policy === 'herbal' && !p.cargo) {
        this.release(p);
        this.startCare(p, patient, 'tend');
      }
      return;
    }
    p.carePhase = 'feed';
    p.destination = null;
    p.careProgress += healthSummary(p).manipulation;
    p.reason = '喂食' + patient.name;
    if (p.careProgress < FEED_WORK) return;
    const amount = this.consume(patient, p.cargo!, p.cargo!.amount);
    p.cargo!.amount -= amount;
    if (p.cargo!.amount === 0) p.cargo = null;
    this.reconcileHealth(patient);
    this.release(p);
    p.reason = '已喂食' + patient.name;
    patient.reason = '已进食，营养不良逐步恢复';
  }
  private updateSurvival() {
    for (const p of this.pawns) {
      if (p.dead) continue;
      if (p.foodPoisoning) {
        if (this.tick >= p.foodPoisoning.endsTick) {
          p.foodPoisoning = null;
          this.notice = `${p.name}已从食物中毒中恢复`;
        } else {
          p.foodPoisoning.stage = poisoningStage(p.foodPoisoning, this.tick);
          if (this.tick >= p.foodPoisoning.nextVomitTick) {
            p.foodPoisoning.nextVomitTick += SANITATION_RULES.vomitInterval;
            p.food = Math.max(0, p.food - SANITATION_RULES.vomitFoodLoss);
            p.rest = Math.max(0, p.rest - SANITATION_RULES.vomitRestLoss);
            this.addFilth('vomit', p);
            if (!p.downed && p.carriedBy === null && p.faction === 'colony') {
              this.release(p); p.reason = '食物中毒引起呕吐，等待重新安排';
            }
          }
        }
      }
      const factor = p.food <= 0 ? 0 : p.food < 12 ? 0.25 : p.food < 24 ? 0.5 : 1;
      p.food = Math.max(0, p.food - FOOD_FALL_PER_TICK * factor * hungerMultiplier(p.health) *
        (p.foodPoisoning ? SANITATION_RULES.hungerFactor : 1));
      updateHealth(p.health, p.food, this.temperature(p), this.tick, p.worn);
      advanceTrauma(p.trauma, this.tick, {
        seed: this.seed,
        pawnId: p.id,
        starving: p.food <= 0,
        resting: p.phase === 'rest' || (p.faction === 'prisoner' && p.sleepingSince !== null) || p.downed,
        inBed: !!this.patientBed(p),
      });
      const medicallyInBed = (p.phase === 'rest' || (p.faction === 'prisoner' && p.sleepingSince !== null) || p.downed) && !!this.patientBed(p);
      advanceMedical(p, this.tick, {
        seed: this.seed,
        pawnId: p.id,
        food: p.food,
        rest: p.rest,
        resting: p.phase === 'rest' || (p.faction === 'prisoner' && p.sleepingSince !== null) || (p.downed && medicallyInBed),
        inBed: medicallyInBed,
        bloodFiltration: healthSummary(p).bloodFiltration,
        allocId: () => this.id(),
      });
      this.reconcileHealth(p);
      if (!p.dead && this.tick % SANITATION_RULES.bloodInterval === 0 &&
          healthSummary(p).bleedRate >= SANITATION_RULES.bloodMinRate) this.addFilth('blood', p);
      if (
        !p.dead &&
        !p.downed &&
        p.faction !== 'prisoner' && p.sleepBedId !== null &&
        !medicalNeedsRest(p) &&
        this.beds.some((b) => b.id === p.sleepBedId && b.medical)
      )
        this.release(p);
    }
  }
  private reconcileHealth(p: Pawn, externalViolence = false) {
    const wasDead = p.dead, wasDowned = p.downed;
    trackInfectionRisks(p, this.seed, p.id, this.tick);
    const death = healthDeathReason(p.health, p.trauma, p.medical),
      summary = healthSummary(p);
    const downed =
      !death && (summary.pain >= 0.8 || summary.consciousness < 0.3 || summary.moving <= 0.15);
    // Damage can occur after a warden already acted this tick. Clear invalid
    // reservations immediately so a paused snapshot is safe to load.
    for (const other of this.pawns) if (other.wardenTask?.prisonerId === p.id &&
      (death || (!other.wardenTask.stage.startsWith('capture') &&
        (downed || summary.talking <= 0 || summary.hearing <= 0)))) this.release(other);
    if (p.wardenTask && !p.wardenTask.stage.startsWith('capture') &&
      (summary.talking <= 0 || summary.hearing <= 0)) this.release(p);
    const inBed = this.beds.some((b) => b.id === p.sleepBedId && same(b, p));
    if (p.weapon && (death || summary.manipulation <= 0 || (downed && !inBed)))
      p.weaponDropPending = true;
    if (p.shooting && (death || downed || summary.manipulation <= 0)) this.cancelShooting(p);
    // Capacity loss can leave a conscious pawn standing. Release reservations
    // before another tick can perform labor, hauling or care with unusable hands.
    if (
      summary.manipulation <= 0 &&
      (p.weaponTask || p.jobId !== null || p.carePhase !== null || p.phase === 'haul' || p.wardenTask?.stage.startsWith('capture'))
    ) {
      this.release(p);
      p.reason = '操作能力不足，已中止劳动';
    }
    if (death || p.downed !== downed) {
      const bed = this.beds.find((b) => b.id === p.sleepBedId && same(b, p)) ?? this.patientBed(p);
      for (const q of this.pawns) if (q.patientId === p.id) this.release(q);
      p.dead = !!death;
      p.downed = downed;
      p.deathReason = death;
      if (downed && p.faction === 'raider') p.retreating = true;
      if (death || downed) p.drafted = false;
      if (death || downed)
        for (const q of this.pawns) if (q.attackTargetId === p.id) this.release(q);
      this.release(p);
      if (p.downed && bed) p.sleepBedId = bed.id;
      p.reason = death ?? (p.downed ? summary.reason + '，倒地等待救援' : '恢复行动');
      if (p.dead) {
        for (const b of this.beds) if (b.owner === p.id) b.owner = null;
        if (p.prisoner) { p.prisoner.bedId = null; p.sleepBedId = null; p.sleepingSince = null; }
      }
    }
    if (p.faction === 'colony' && !wasDead) {
      if (p.dead) this.pendingAdaptation.set(p.id, 'lost');
      else if (!wasDowned && p.downed && externalViolence && this.pendingAdaptation.get(p.id) !== 'lost')
        this.pendingAdaptation.set(p.id, 'downed');
    }
  }
  private updateRaids() {
    const state = this.storyteller, interval = Math.floor(this.tick / STORY_INTERVAL);
    const due: StoryEvent['source'][] = [];
    if (state.legacyRaidAt !== null && this.tick >= state.legacyRaidAt) {
      due.push('legacy');
      state.legacyRaidAt = null;
    }
    if (interval > state.lastInterval) {
      state.lastInterval = interval;
      const cycle = cycleAt(interval);
      if (cycle !== state.cycle) {
        state.cycle = cycle;
        state.cycleHits = cycleHits(this.seed, cycle);
      }
      if (!state.introHandled && interval >= INTRO_INTERVAL) {
        state.introHandled = true;
        if (interval === INTRO_INTERVAL) due.push('intro');
      }
      if (state.cycleHits.includes(interval)) due.push('cycle');
    }
    this.combat.nextRaid = this.combat.enabled ? (interval + 1) * STORY_INTERVAL : 0;
    for (const source of due) this.tryRaid(source);
  }
  threatBreakdown() {
    return threatPoints(colonyWealth(this), livingColonists(this.pawns).map(p => ({ id: p.id, health: summaryHealthPercent(p) })),
      this.storyteller.adaptationDays, this.tick / DAY, DIFFICULTY[this.storyteller.difficulty],
      plantRandom(this.seed, Math.floor(this.tick / (DAY / 24)), 0, 8703));
  }
  private updateAdaptation() {
    const state = this.storyteller, population = livingColonists(this.pawns).length;
    for (const [pawnId, kind] of this.pendingAdaptation) {
      const before = state.adaptationDays;
      state.adaptationDays = adaptationAfterLoss(before, kind, population);
      state.losses.push({ tick: this.tick, pawnId, kind, population, before, after: state.adaptationDays });
    }
    state.losses = state.losses.slice(-32);
    this.pendingAdaptation.clear();
    if (this.tick % ADAPTATION_INTERVAL === 0)
      state.adaptationDays = growAdaptation(state.adaptationDays, this.tick / DAY, DIFFICULTY[state.difficulty].adaptationGrowth);
  }
  private tryRaid(source: StoryEvent['source']) {
    const threat = this.threatBreakdown(), random = storyRandom(this.seed, this.tick + (source === 'legacy' ? 51 : 0));
    const event: StoryEvent = { tick: this.tick, source, outcome: 'skipped', reason: '', threat,
      budget: source === 'intro' ? 40 : Math.max(35 * 1.05, threat.points), spent: 0, remainder: 0, members: [] };
    event.remainder = event.budget;
    const record = (reason: string) => {
      event.reason = reason;
      this.storyteller.events.push(event);
      this.storyteller.events = this.storyteller.events.slice(-32);
      if (this.combat.enabled && DIFFICULTY[this.storyteller.difficulty].allowThreats) this.notice = reason;
    };
    if (!this.combat.enabled || !DIFFICULTY[this.storyteller.difficulty].allowThreats) {
      record('和平设置：跳过本次袭击机会');
      return;
    }
    if (source !== 'legacy' && this.storyteller.legacyRaidAt !== null) {
      record('旧存档已有待发生袭击，本次新日历机会跳过');
      return;
    }
    const colonists = this.pawns.filter((p) => p.faction === 'colony' && !p.dead && !p.downed);
    if (
      !colonists.length ||
      this.pawns.some((p) => p.faction === 'raider' && !p.dead && !p.downed)
    ) {
      record(!colonists.length ? '没有可行动的殖民者，本次袭击跳过' : '场上仍有活动敌人，本次袭击跳过');
      return;
    }
    // Do not grow an unbounded retained corpse list. No existing body or gear is deleted.
    if (this.pawns.length >= 64) {
      this.combat.enabled = false;
      this.combat.nextRaid = 0;
      record('地图上的人物与遗体已达上限，后续袭击暂停');
      this.notice = event.reason;
      return;
    }
    const entries = new Map<number, Pos>();
    for (const colonist of colonists) {
      this.search(colonist);
      for (let y = 0; y < DEPTH; y++)
        for (let x = 0; x < WIDTH; x++) {
          if (x > 1 && y > 1 && x < WIDTH - 2 && y < DEPTH - 2) continue;
          for (let z = HEIGHT - 2; z > 0; z--) {
            const candidate = { x, y, z };
            if (!this.standable(candidate) || this.distance[at(candidate)] < 0) continue;
            const distance = Math.min(
              ...colonists.map((p) => Math.abs(x - p.x) + Math.abs(y - p.y) + Math.abs(z - p.z)),
            );
            if (distance >= 16 && !this.pawns.some(p => same(p, candidate))) entries.set(at(candidate), candidate);
            break;
          }
        }
    }
    const distance = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
    const available = [...entries.values()].sort((a, b) => Math.min(...colonists.map(p => distance(p, b))) - Math.min(...colonists.map(p => distance(p, a))) || at(a) - at(b));
    const entry = available[0];
    if (!entry) {
      record('袭击者找不到通往营地的地图边缘入口，本次袭击跳过');
      return;
    }
    const placements = available.filter(p => distance(p, entry) <= 8).sort((a, b) => distance(a, entry) - distance(b, entry) || at(a) - at(b));
    const plan = planRaid(event.budget, Math.min(64 - this.pawns.length, placements.length), random);
    Object.assign(event, { budget: plan.budget, spent: plan.spent, remainder: plan.remainder });
    for (const [i, kind] of plan.kinds.entries()) {
    const id = this.id(), weapon = raidWeapon(kind, this.id(), random);
    this.pawns.push({
      ...placements[i],
      id,
      name: `${RAID_NAMES[kind]} ${this.combat.wave + 1}-${i + 1}`,
      color: 0xc65b52,
      food: 100,
      rest: 100,
      skills: initialSkills(0, true),
      ...initialSurvival(this.seed, id),
      prisoner: null, wardenTask: null, handleTask: null, ropeTask: null,
      living: initialLiving(), psyche: initialPsyche(this.tick), social: initialSocial(this.tick, id),
      faction: 'raider',
      weapon,
      priorities: {
        handle: 0,
        firefight: 0, clean: 0, warden: 0,
        hunt: 0,
        dig: 0,
        build: 0,
        cut: 0,
        haul: 0,
        grow: 0,
        cook: 0,
        craft: 0,
        care: 0,
        research: 0,
      },
      worn: [],
      apparelTask: null,
      apparelWearTicks: 0,
      jobId: null,
      path: [],
      destination: null,
      phase: 'combat',
      cargo: null,
      reason: '正在袭击营地',
      moveTick: this.tick,
      workTarget: null,
      eating: null,
      sleepBedId: null,
      sleepingSince: null,
      schedule: defaultSchedule(),
    });
    event.members.push({ pawnId: id, kind, cost: RAID_COST[kind], weapon: { ...weapon } });
    }
    if (!event.members.length) { record('本次预算或入口容量无法生成袭击者'); return; }
    this.combat.wave++;
    event.outcome = 'spawned';
    record(`${event.members.length} 名袭击者从地图边缘逼近。征召同伴，利用掩体、门与多层通路防守。`);
  }
  private shotBlocked(cell: Pos) {
    return (
      !!this.blocks[at(cell)] ||
      this.doors.some(
        (d) =>
          d.x === cell.x &&
          d.y === cell.y &&
          cell.z >= d.z &&
          cell.z <= d.z + 1 &&
          d.mode !== 'open' &&
          (d.mode === 'locked' || d.openUntil <= this.tick || this.tick < d.openUntil - 37),
      )
    );
  }
  private rangedCovers(target?: Pos): RangedCover[] {
    const near = (p: Pos) =>
      !target ||
      (p.z === target.z && Math.max(Math.abs(p.x - target.x), Math.abs(p.y - target.y)) <= 1);
    return [
      ...this.sandbags
        .filter(near)
        .map((b) => ({ id: b.id, position: b, fillPercent: 0.55, height: 0.75 })),
      ...this.trees.filter(near).map((t) => ({
        id: t.id,
        position: t,
        fillPercent: t.species === 'saguaro' ? 0.35 : 0.25,
        height: 2,
      })),
    ];
  }
  shotReport(p: Pawn, target: Pawn | WildAnimal, origin: Pos = p) {
    if (!p.weapon || !isRangedKind(p.weapon.kind)) return null;
    const health = healthSummary(p),
      prone = (!isAnimal(target) && target.downed) || resting(target);
    return rangedShotReport({
      shooter: origin,
      target,
      weapon: { kind: p.weapon.kind, quality: p.weapon.quality },
      shootingLevel: p.skills.shooting.level,
      sight: health.sight,
      manipulation: health.manipulation,
      shooterRoofed: !this.weatherExposed(origin),
      targetRoofed: !this.weatherExposed(target),
      weatherAccuracy: weatherEffects(this.weather, this.tick).accuracyFactor,
      targetProne: prone,
      canBenefitFromCover: true,
      canHitOthers: true,
      covers: this.rangedCovers(target),
      bounds: { width: WIDTH, depth: DEPTH, height: HEIGHT },
      blocked: (cell) => this.shotBlocked(cell),
    });
  }
  private shootingStand(p: Pawn, target: Pawn | WildAnimal) {
    if (!this.sandbags.some((b) => same(b, p)) && this.shotReport(p, target)?.canShoot)
      return at(p);
    this.search(p);
    const range =
      p.weapon && isRangedKind(p.weapon.kind)
        ? rangedStats({ ...p.weapon, kind: p.weapon.kind }).range
        : 0;
    // Search all reachable cells in path-distance order. A failed early sample
    // must never be reported as an unreachable firing position.
    const candidates: number[] = [];
    for (let i = 0; i < CELLS; i++)
      if (this.distance[i] >= 0) {
        const q = position(i),
          length = Math.hypot(q.x - target.x, q.y - target.y, q.z - target.z);
        if (
          length >= 1.421 &&
          length <= range &&
          this.standable(q) &&
          !this.sandbags.some((b) => same(b, q))
        )
          candidates.push(i);
      }
    candidates.sort((a, b) => this.distance[a] - this.distance[b] || a - b);
    return candidates.find((i) => this.shotReport(p, target, position(i))?.canShoot) ?? -1;
  }
  private combatEvent(
    p: Pos,
    shooterId: number,
    targetId: number | null,
    kind: CombatEvent['kind'],
    damage: number,
    message: string,
  ) {
    this.combatEvents.push({
      x: Math.floor(p.x),
      y: Math.floor(p.y),
      z: Math.floor(p.z),
      tick: this.tick,
      shooterId,
      targetId,
      kind,
      damage,
      message,
    });
    if (this.combatEvents.length > 64) this.combatEvents.splice(0, this.combatEvents.length - 64);
  }
  private cancelShooting(p: Pawn) {
    if (p.shooting?.phase === 'burst' && p.weapon && isRangedKind(p.weapon.kind))
      p.nextAttackTick = Math.max(
        p.nextAttackTick,
        this.tick + rangedStats({ ...p.weapon, kind: p.weapon.kind }).cooldownTicks,
      );
    p.shooting = null;
  }
  private rangedCombat(p: Pawn, target: Pawn | WildAnimal) {
    if (p.faction === 'prisoner') return;
    const weapon = p.weapon!;
    if (!isRangedKind(weapon.kind)) return;
    const stats = rangedStats({ ...weapon, kind: weapon.kind }),
      report = this.shotReport(p, target)!;
    if (
      !report.canShoot ||
      healthSummary(p).manipulation <= 0 ||
      p.weaponDropPending ||
      this.sandbags.some((b) => same(b, p))
    ) {
      this.cancelShooting(p);
      if (!p.path.length || (this.tick + p.id) % 20 === 0) {
        const stand = this.shootingStand(p, target);
        if (stand >= 0) this.go(p, stand, p.phase === 'hunt' ? 'hunt' : 'combat');
        else {
          p.path = [];
          p.destination = null;
        }
        p.reason = stand >= 0 ? '寻找射击位置：' + target.name : '射程或视线受阻，等待通路';
      }
      return;
    }
    p.path = [];
    p.destination = null;
    if (this.tick < p.nextAttackTick) {
      p.reason = '射击冷却';
      return;
    }
    if (
      p.shooting &&
      (p.shooting.weaponId !== weapon.id ||
        p.shooting.targetId !== target.id ||
        !same(p, p.shooting.origin))
    )
      this.cancelShooting(p);
    if (!p.shooting) {
      p.shooting = {
        weaponId: weapon.id,
        targetId: target.id,
        phase: 'aim',
        startedTick: this.tick,
        nextShotTick: this.tick + stats.warmupTicks,
        shotsLeft: stats.burstCount,
        origin: { x: p.x, y: p.y, z: p.z },
      };
    }
    const state = p.shooting;
    p.reason = (state.phase === 'aim' ? '瞄准' : '连发射击') + target.name;
    if (this.tick < state.nextShotTick) return;
    if (this.projectiles.length >= 256) {
      p.reason = '等待在飞弹丸结算';
      return;
    }
    if (state.phase === 'aim') {
      state.phase = 'burst';
      state.startedTick = this.tick;
      if (isAnimal(target) || !target.downed)
        learnSkill(
          p.skills.shooting,
          (!isAnimal(target) && tradeHostile(target, p, this.trade.goodwill) ? 170 : 20) * stats.fullCycleSeconds,
        );
    }
    let stream = 180;
    const launch = resolveRangedLaunch(report, () =>
      plantRandom(this.seed, p.id, this.tick, stream++),
    );
    const id = this.id();
    this.projectiles.push({
      id,
      shooterId: p.id,
      shooterFaction: p.faction,
      targetId: target.id,
      quality: weapon.quality,
      kind: weapon.kind,
      from: report.origin,
      destination: launch.destination,
      launchedTick: this.tick,
      impactTick: this.tick + projectileFlightTicks(launch.launchDistance, stats.speed),
      damage: stats.damage,
      armorPenetration: stats.armorPenetration,
      canHitIntended: launch.canHitIntended,
      canHitOthers: launch.canHitOthers,
      canHitWorld: launch.canHitWorld,
      coverId: launch.outcome === 'cover' ? launch.coverId : null,
      postureImpactChance: launch.postureImpactChance,
    });
    this.combatEvent(p, p.id, target.id, 'fire', 0, WEAPON_NAMES[weapon.kind] + '发射');
    state.shotsLeft--;
    if (!state.shotsLeft) {
      p.nextAttackTick = this.tick + stats.cooldownTicks;
      p.shooting = null;
    } else
      state.nextShotTick =
        state.startedTick + stats.burstOffsetsTicks[stats.burstCount - state.shotsLeft];
  }
  private projectileHitPawn(shot: Projectile, target: Pawn) {
    tradeHarmed(this, { faction: shot.shooterFaction }, target, this.pawns.find(p => p.id === shot.targetId), shot.damage);
    const def = shot.kind === 'shortBow' ? 'Arrow' : 'Bullet';
    let stream = 300;
    const random = () => plantRandom(this.seed, shot.id, this.tick, stream++);
    const part = chooseHitPart(target.trauma, def, random());
    if (part === null) return;
    const result = applyBodyDamage(target.trauma, def, part, shot.damage, {
      random,
      allocId: () => this.id(),
      armor: { worn: target.worn, armorPenetration: shot.armorPenetration },
    });
    if (result.armor) {
      this.stats.destroyed.apparel += result.armor.destroyedIds.length;
      target.worn = result.armor.worn;
      if (target.apparelTask && result.armor.destroyedIds.includes(target.apparelTask.apparelId))
        this.release(target);
    }
    // Native Bullet notifies stagger after TakeDamage, including a full armor deflection.
    if (rangedStats(shot).stoppingPower >= 1 - 0.001)
      target.staggerUntil = Math.max(target.staggerUntil, this.tick + 32);
    this.combatEvent(
      target,
      shot.shooterId,
      target.id,
      result.armor?.deflected ? 'deflect' : 'hit',
      result.totalDamage,
      result.armor?.deflected
        ? target.name + '的护甲挡下弹丸'
        : target.name + '被' + WEAPON_NAMES[shot.kind] + '击中',
    );
    this.reconcileHealth(target, true);
  }
  private projectileHitCover(shot: Projectile, id: number) {
    const bag = this.sandbags.find((b) => b.id === id),
      tree = this.trees.find((t) => t.id === id);
    const cover = bag ?? tree;
    if (!cover) return false;
    const remainingHp = bag ? bag.hitPoints : tree!.health * TREE_DATA[tree!.species].maxHitPoints;
    const actualDamage = Math.min(shot.damage, remainingHp);
    this.combatEvent(
      cover,
      shot.shooterId,
      id,
      'cover',
      actualDamage,
      bag ? '弹丸击中沙袋' : '弹丸击中树木',
    );
    if (bag) bag.hitPoints = Math.max(0, remainingHp - actualDamage);
    if (tree)
      tree.health = Math.max(0, remainingHp - actualDamage) / TREE_DATA[tree.species].maxHitPoints;
    if ((bag && bag.hitPoints <= 0) || (tree && tree.health <= 0)) {
      for (const j of [...this.jobs])
        if (same(j, cover) && (j.kind === 'remove' || j.kind === 'cut')) this.cancel(j);
      if (bag) {
        this.sandbags = this.sandbags.filter((b) => b.id !== id);
        this.planAutoRebuild({ ...bag, kind:'sandbag' });
      }
      if (tree) {
        this.trees = this.trees.filter((t) => t.id !== id);
        this.stats.treesDied++;
        this.rebuildTrees();
        this.skyCache.clear();
      }
      this.revision++;
    }
    return true;
  }
  private updateProjectiles() {
    const remaining: Projectile[] = [],
      bounds = { width: WIDTH, depth: DEPTH, height: HEIGHT };
    for (const shot of this.projectiles) {
      const duration = shot.impactTick - shot.launchedTick,
        previous = Math.max(0, (this.tick - 1 - shot.launchedTick) / duration),
        progress = Math.min(1, (this.tick - shot.launchedTick) / duration),
        destination = {
          x: Math.floor(shot.destination.x),
          y: Math.floor(shot.destination.y),
          z: Math.floor(shot.destination.z),
        };
      let consumed = false,
        stream = 500;
      const random = () => plantRandom(this.seed, shot.id, this.tick, stream++);
      for (const entry of traceVoxelRay(shot.from, shot.destination, bounds)) {
        if (entry.tEnter <= previous || entry.tEnter > progress) continue;
        const cell = entry.cell;
        // Explicit 3D extension: a real wall/floor also blocks a well-aimed shot.
        if (this.shotBlocked(cell)) {
          this.combatEvent(
            cell,
            shot.shooterId,
            null,
            'terrain',
            0,
            '弹丸被墙体、楼板或关闭的门挡住',
          );
          consumed = true;
          break;
        }
        if (same(cell, destination)) continue;
        if (shot.canHitOthers || shot.canHitIntended)
          for (const pawn of [...this.pawns, ...this.animals]) {
            if (
              pawn.id === shot.shooterId ||
              (pawn.id === shot.targetId ? !shot.canHitIntended : !shot.canHitOthers) ||
              pawn.dead ||
              (!isAnimal(pawn) && pawn.carriedBy !== null) ||
              !same(pawn, cell)
            )
              continue;
            if (
              random() <
              pawnInterceptChance({
                origin: shot.from,
                cell,
                prone: (!isAnimal(pawn) && pawn.downed) || resting(pawn),
                friendly: !isAnimal(pawn) && !tradeHostile(pawn, { faction: shot.shooterFaction }, this.trade.goodwill),
              })
            ) {
              if (isAnimal(pawn)) this.damageAnimal(shot, pawn);
              else this.projectileHitPawn(shot, pawn);
              consumed = true;
              break;
            }
          }
        if (consumed) break;
        if (shot.canHitWorld)
          for (const cover of this.rangedCovers(cell).filter((c) => same(c.position, cell))) {
            const height = shot.from.z + (shot.destination.z - shot.from.z) * entry.tEnter;
            if (height < cell.z || height > cell.z + cover.height || cover.fillPercent <= 0.2)
              continue;
            const adjacent =
              destination.z === cell.z &&
              Math.max(Math.abs(cell.x - destination.x), Math.abs(cell.y - destination.y)) <= 1;
            if (
              random() <
              cover.fillPercent * (adjacent ? 1 : 0.15) * interceptDistanceFactor(shot.from, cell)
            ) {
              this.projectileHitCover(shot, cover.id);
              consumed = true;
              break;
            }
          }
        if (consumed) break;
      }
      if (consumed) continue;
      if (this.tick < shot.impactTick) {
        remaining.push(shot);
        continue;
      }
      // Native usedTarget is an identity. Moving away from the original endpoint
      // does not itself cancel a targeted projectile; posture is read at impact.
      const intended = [...this.pawns, ...this.animals].find(
        (p) => p.id === shot.targetId && !p.dead && (isAnimal(p) || p.carriedBy === null),
      );
      const length = Math.hypot(
        shot.destination.x - shot.from.x,
        shot.destination.y - shot.from.y,
        shot.destination.z - shot.from.z,
      );
      if (shot.canHitIntended && intended) {
        if (
          random() < projectilePostureChance(length, (!isAnimal(intended) && intended.downed) || resting(intended))
        )
          { if (isAnimal(intended)) this.damageAnimal(shot, intended);
            else this.projectileHitPawn(shot, intended); }
        else this.combatEvent(destination, shot.shooterId, null, 'miss', 0, '弹丸越过倒卧目标');
        continue;
      }
      if (shot.coverId !== null && shot.canHitWorld && this.projectileHitCover(shot, shot.coverId))
        continue;
      const candidates: ({ pawn: Pawn | WildAnimal } | { cover: RangedCover })[] = [
        ...(shot.canHitOthers
          ? [...this.pawns, ...this.animals]
              .filter(
                (p) =>
                  p.id !== shot.shooterId &&
                  p.id !== shot.targetId &&
                  !p.dead &&
                  (isAnimal(p) || p.carriedBy === null) &&
                  same(p, destination),
              )
              .map((pawn) => ({ pawn }))
          : []),
        ...(shot.canHitWorld
          ? this.rangedCovers(destination)
              .filter((c) => same(c.position, destination))
              .map((cover) => ({ cover }))
          : []),
      ];
      // Native terminal fallback shuffles candidates before testing their chance.
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      for (const candidate of candidates) {
        const chance =
          'pawn' in candidate
            ? 0.5 *
              projectilePostureChance(
                length,
                (!isAnimal(candidate.pawn) && candidate.pawn.downed) || resting(candidate.pawn),
              ) *
              (!isAnimal(candidate.pawn) && !tradeHostile(candidate.pawn, { faction: shot.shooterFaction }, this.trade.goodwill)
                ? interceptDistanceFactor(shot.from, destination)
                : 1)
            : 1.5 * candidate.cover.fillPercent;
        if (random() >= chance) continue;
        if ('pawn' in candidate) {
          if (isAnimal(candidate.pawn)) this.damageAnimal(shot, candidate.pawn);
          else this.projectileHitPawn(shot, candidate.pawn);
        }
        else this.projectileHitCover(shot, candidate.cover.id);
        consumed = true;
        break;
      }
      if (!consumed) this.combatEvent(destination, shot.shooterId, null, 'miss', 0, '弹丸落地');
    }
    this.projectiles = remaining;
  }
  private combatTick(p: Pawn) {
    if (p.retreating) {
      this.cancelShooting(p);
      p.attackTargetId = null;
      if (p.x === 0 || p.y === 0 || p.x === WIDTH - 1 || p.y === DEPTH - 1) {
        for (const q of this.pawns) if (q.attackTargetId === p.id) this.release(q);
        this.socialDepart(p);
        this.pawns = this.pawns.filter((q) => q.id !== p.id);
        this.notice = p.name + '已撤离地图';
        return;
      }
      if (!p.path.length) {
        this.search(p);
        let destination = -1,
          distance = Infinity;
        for (let y = 0; y < DEPTH; y++)
          for (let x = 0; x < WIDTH; x++) {
            if (x !== 0 && y !== 0 && x !== WIDTH - 1 && y !== DEPTH - 1) continue;
            for (let z = 1; z < HEIGHT - 1; z++) {
              const q = { x, y, z },
                i = at(q);
              if (this.distance[i] >= 0 && this.distance[i] < distance && this.standable(q)) {
                destination = i;
                distance = this.distance[i];
              }
            }
          }
        if (destination >= 0) this.go(p, destination, 'combat');
      }
      p.reason = p.path.length ? '负伤撤离' : '撤离通路受阻';
      return;
    }
    // An explicit move order takes precedence over automatic adjacent retaliation.
    if (p.faction === 'colony' && p.attackTargetId === null && p.path.length > 0) return;
    const ranged = !!p.weapon && isRangedKind(p.weapon.kind) && !p.weaponDropPending;
    let target = this.pawns.find((q) => q.id === p.attackTargetId);
    const adjacent = this.pawns.find(
      (q) =>
        tradeHostile(q, p, this.trade.goodwill) &&
        !q.dead &&
        !q.downed &&
        q.carriedBy === null &&
        q.z === p.z &&
        Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1,
    );
    if (adjacent) {
      target = adjacent;
      p.attackTargetId = target.id;
    }
    if (!target || target.dead || target.downed || target.carriedBy !== null) {
      p.attackTargetId = null;
      target = undefined;
      if (p.faction !== 'colony') {
        if ((this.tick + p.id) % 20 !== 0) return;
        this.search(p);
        target = this.pawns
          .filter((q) => tradeHostile(q, p, this.trade.goodwill) && !q.dead && !q.downed)
          .map((q) => ({ pawn: q, stand: ranged ? this.shootingStand(p, q) : this.careStand(q) }))
          .filter((q) => q.stand >= 0)
          .sort((a, b) => this.distance[a.stand] - this.distance[b.stand])[0]?.pawn;
      } else if (p.drafted) {
        target = this.pawns.find(
          (q) =>
            tradeHostile(q, p, this.trade.goodwill) &&
            !q.dead &&
            !q.downed &&
            ((q.z === p.z && Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1) ||
              (ranged && (this.tick + p.id) % 20 === 0 && this.shotReport(p, q)?.canShoot)),
        );
      }
      if (target) p.attackTargetId = target.id;
    }
    if (!target) {
      this.cancelShooting(p);
      if (!p.path.length) p.reason = p.drafted ? '征召待命' : '没有可攻击目标';
      return;
    }
    if (p.faction === 'trader') p.phase = 'combat';
    if (p.z === target.z && Math.abs(p.x - target.x) + Math.abs(p.y - target.y) === 1) {
      this.cancelShooting(p);
      p.path = [];
      p.destination = null;
      if (this.tick < p.nextAttackTick) return;
      const strike = selectMeleeAttack(
        p.weaponDropPending ? null : p.weapon,
        plantRandom(this.seed, p.id, this.tick, 11),
        meleeBodyFromTrauma(p.trauma),
      );
      if (!strike) {
        p.reason = '没有可用近战动作';
        return;
      }
      p.nextAttackTick = this.tick + strike.cooldown;
      // Rest is this model's non-standing posture. Native immobile targets
      // provide no melee practice and bypass both the miss and dodge rolls.
      const targetImmobile = resting(target);
      if (!targetImmobile) learnSkill(p.skills.melee, (200 * strike.cooldown) / TPS);
      if (
        !targetImmobile &&
        plantRandom(this.seed, p.id, this.tick, 12) >=
          meleeHitChance(p.skills, healthSummary(p).manipulation, healthSummary(p).sight)
      ) {
        p.reason = '近战落空：' + target.name;
        return;
      }
      if (
        !targetImmobile &&
        plantRandom(this.seed, p.id, this.tick, 15) <
          meleeDodgeChance(target.skills, healthSummary(target).moving, healthSummary(target).sight)
      ) {
        p.reason = target.name + '躲开了近战攻击';
        return;
      }
      const part = chooseHitPart(
        target.trauma,
        strike.damageDef,
        plantRandom(this.seed, p.id, this.tick, 13),
      );
      if (part === null) return;
      const damage = Math.max(
        1,
        Math.round(strike.damage * (0.8 + plantRandom(this.seed, p.id, this.tick, 14) * 0.4)),
      );
      let damageStream = 20;
      const result = applyBodyDamage(target.trauma, strike.damageDef, part, damage, {
        random: () => plantRandom(this.seed, p.id, this.tick, damageStream++),
        allocId: () => this.id(),
        armor: { worn: target.worn, armorPenetration: strike.armorPenetration },
      });
      tradeHarmed(this, p, target, target, damage);
      if (result.armor) {
        this.stats.destroyed.apparel += result.armor.destroyedIds.length;
        target.worn = result.armor.worn;
        if (target.apparelTask && result.armor.destroyedIds.includes(target.apparelTask.apparelId))
          this.release(target);
      }
      p.reason = result.hits.length
        ? '击中' +
          target.name +
          '的' +
          [...new Set(result.hits.map((hit) => BODY_PARTS[hit.part].name))].join('、')
        : result.armor?.deflected
          ? target.name + '的护甲挡下了攻击'
          : '攻击' + target.name + '，未造成新的伤口';
      if (result.armor && result.hits.length && result.armor.amount < damage)
        p.reason +=
          result.armor.damageDef === 'Blunt' && strike.damageDef !== 'Blunt'
            ? '（护甲减半，转为钝伤）'
            : '（护甲减半）';
      if (result.armor?.destroyedIds.length)
        p.reason += `；${result.armor.destroyedIds.length} 件衣物损毁`;
      this.reconcileHealth(target, true);
      if (target.dead || target.downed) {
        p.attackTargetId = null;
        this.notice = target.name + '：' + target.reason;
      }
    } else if (ranged) {
      this.rangedCombat(p, target);
    } else if (!p.path.length || (this.tick + p.id) % 20 === 0) {
      this.search(p);
      const stand = this.careStand(target);
      if (stand >= 0) {
        this.go(p, stand, 'combat');
        p.reason = '接近' + target.name;
      } else {
        p.path = [];
        p.destination = null;
        p.reason = '目标不可达，等待通路';
        if (p.faction === 'raider') p.attackTargetId = null;
      }
    }
  }
  private apparelPieces(): ApparelPiece[] {
    return [
      ...this.items.flatMap((i) => (i.apparel ? [i.apparel] : [])),
      ...this.pawns.filter(p => p.faction === 'colony').flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
    ];
  }
  private weaponPieces(): WeaponPiece[] {
    return [
      ...this.items.flatMap((i) => (i.weapon ? [i.weapon] : [])),
      ...this.pawns.filter(p => p.faction === 'colony').flatMap((p) => [
        ...(p.weapon ? [p.weapon] : []),
        ...(p.cargo?.weapon ? [p.cargo.weapon] : []),
      ]),
    ];
  }
  private dropPrimary(p: Pawn, forbidden: boolean): boolean {
    this.cancelShooting(p);
    if (!p.weapon) {
      p.weaponDropPending = false;
      return true;
    }
    if (p.carriedBy !== null) return false;
    const plan = this.planPlacement(
      [{ batch: { resource: 'weapon', amount: 1, weapon: { ...p.weapon }, forbidden }, origin: p }],
      this.items,
      DROP_DISTANCE,
      new Set(),
      p.id,
    );
    if (!plan) return false;
    this.commitPlacement(plan);
    if (p.faction !== 'colony') this.trade.imported.weapon++;
    p.weapon = null;
    p.weaponDropPending = false;
    return true;
  }
  private startWeapon(p: Pawn, weaponId: number, action: 'equip' | 'drop'): boolean {
    if (
      p.dead ||
      p.downed ||
      p.carriedBy !== null ||
      p.weaponDropPending ||
      healthSummary(p).manipulation <= 0 ||
      !Number.isSafeInteger(weaponId)
    )
      return false;
    if (this.pawns.some((q) => q.id !== p.id && q.weaponTask?.weaponId === weaponId)) return false;
    if (action === 'drop') {
      if (p.weapon?.id !== weaponId) return false;
      this.release(p);
      p.weaponTask = { action, weaponId, stage: 'work', progress: 0 };
      p.phase = 'weapon';
      p.reason = '准备放下武器';
      return true;
    }
    const item = this.items.find((i) => i.weapon?.id === weaponId),
      own = p.cargo?.weapon?.id === weaponId;
    if (!item && !own) return false;
    if (item && this.itemPath(p, item) === null) return false;
    if (!own && !this.dropCargo(p)) return false;
    this.release(p);
    // Native player Equip removes forbidden before the physical job starts.
    if (item) item.forbidden = false;
    p.weaponTask = { action, weaponId, stage: own ? 'work' : 'fetch', progress: 0 };
    if (item) {
      this.search(p);
      this.go(p, this.reachableItemStand(item), 'weapon');
    } else p.phase = 'weapon';
    p.reason = '前往装备' + WEAPON_NAMES[(item?.weapon ?? p.cargo!.weapon)!.kind];
    return true;
  }
  private arriveWeapon(p: Pawn) {
    const task = p.weaponTask;
    if (!task) {
      this.release(p);
      return;
    }
    if (task.action === 'drop') {
      task.progress = Math.min(WEAPON_DROP_TICKS, task.progress + 1);
      if (task.progress < WEAPON_DROP_TICKS) return;
      if (!this.dropPrimary(p, true)) {
        p.reason = '附近没有武器落地空间，保留武器等待';
        return;
      }
      this.release(p);
      p.reason = '已放下武器，标为禁止自动搬运';
      return;
    }
    if (task.stage === 'fetch') {
      const item = this.items.find((i) => i.weapon?.id === task.weaponId);
      if (!item || !this.itemTouch(p,item) || !this.take(p, 'weapon', 1, item.id)) {
        this.release(p);
        p.reason = '目标武器已移动，请重新安排';
        return;
      }
      task.stage = 'work';
      p.path = [];
      p.destination = null;
    }
    const piece = p.cargo?.weapon;
    if (!piece || piece.id !== task.weaponId) {
      this.release(p);
      return;
    }
    if (!this.dropPrimary(p, false)) {
      p.reason = '旧武器无处放下，保留新旧武器等待';
      return;
    }
    p.weapon = piece;
    p.cargo = null;
    this.release(p);
    p.reason = '已装备' + WEAPON_NAMES[piece.kind];
  }
  private updateApparelWear() {
    for (const p of this.pawns) {
      if (p.dead) continue;
      p.apparelWearTicks++;
      for (const piece of p.worn) {
        piece.wearTicks++;
        if (p.apparelWearTicks % APPAREL_WEAR_INTERVAL === 0)
          piece.hitPoints -= apparelWearDamage(
            this.seed,
            piece.id,
            p.apparelWearTicks / APPAREL_WEAR_INTERVAL,
          );
      }
      const lost = p.worn.filter((piece) => piece.hitPoints <= 0);
      if (lost.length) {
        p.worn = p.worn.filter((piece) => piece.hitPoints > 0);
        this.stats.destroyed.apparel += lost.length;
        if (p.apparelTask && lost.some((piece) => piece.id === p.apparelTask!.apparelId))
          this.release(p);
        p.reason = '衣物磨损耗尽，已失去对应保温';
        this.revision++;
      }
    }
  }
  private startApparel(p: Pawn, apparelId: number, action: 'wear' | 'remove'): boolean {
    if (p.dead || p.downed || p.drafted || p.carriedBy !== null || !Number.isSafeInteger(apparelId))
      return false;
    if (this.pawns.some((q) => q.id !== p.id && q.apparelTask?.apparelId === apparelId))
      return false;
    if (action === 'remove') {
      if (!p.worn.some((piece) => piece.id === apparelId)) return false;
      this.release(p);
      p.apparelTask = { action, apparelId, stage: 'work', progress: 0 };
      p.phase = 'apparel';
      p.reason = '脱下衣物';
      return true;
    }
    const own = p.cargo?.apparel?.id === apparelId;
    const item = this.items.find((i) => i.apparel?.id === apparelId);
    if (!own && !item) return false;
    const piece = own ? p.cargo!.apparel! : item!.apparel!;
    if (!apparelHasPartsToWear(piece, p.trauma)) return false;
    if (item && !this.itemPath(p, item)) return false;
    if (!own && !this.dropCargo(p)) return false;
    this.release(p);
    p.apparelTask = { action, apparelId, stage: own ? 'work' : 'fetch', progress: 0 };
    if (item) item.forbidden = false;
    if (own) {
      p.phase = 'apparel';
      p.reason = '穿上' + APPAREL_NAMES[p.cargo!.apparel!.kind];
    } else {
      this.search(p);
      this.go(p, this.reachableItemStand(item!), 'apparel');
      p.reason = '前往取用' + APPAREL_NAMES[item!.apparel!.kind];
    }
    return true;
  }
  private arriveApparel(p: Pawn) {
    const task = p.apparelTask;
    if (!task) {
      this.release(p);
      return;
    }
    if (task.stage === 'fetch') {
      const item = this.items.find((i) => i.apparel?.id === task.apparelId);
      if (!item || !this.itemTouch(p,item) || !this.take(p, 'apparel', 1, item.id)) {
        this.release(p);
        p.reason = '衣物已移动，重新安排';
        return;
      }
      task.stage = 'work';
      p.destination = null;
      p.path = [];
      p.reason = '穿上' + APPAREL_NAMES[p.cargo!.apparel!.kind];
      return;
    }
    const piece =
      task.action === 'wear'
        ? p.cargo?.apparel
        : p.worn.find((piece) => piece.id === task.apparelId);
    if (!piece || piece.id !== task.apparelId) {
      this.release(p);
      return;
    }
    if (task.action === 'wear' && !apparelHasPartsToWear(piece, p.trauma)) {
      this.release(p);
      p.reason = '缺少可穿戴的身体部位，衣物仍在携带中';
      return;
    }
    const removed =
      task.action === 'remove' ? [piece] : p.worn.filter((old) => !compatibleApparel(old, piece));
    const work =
      apparelDelay(piece) +
      (task.action === 'wear' ? removed.reduce((n, old) => n + apparelDelay(old), 0) : 0);
    task.progress = Math.min(work, task.progress + 1);
    if (task.progress < work) return;
    const plan = this.planPlacement(
      removed.map((old) => ({
        batch: { resource: 'apparel' as const, amount: 1, apparel: { ...old } },
        origin: p,
      })),
      this.items,
      DROP_DISTANCE,
      new Set(),
      p.id,
    );
    if (!plan) {
      p.reason = '附近无衣物落地空间，保留当前穿戴和携带衣物';
      return;
    }
    this.commitPlacement(plan);
    p.worn = p.worn.filter((old) => !removed.some((piece) => piece.id === old.id));
    if (task.action === 'wear') {
      p.worn = sortApparelByLayer([...p.worn, piece]);
      p.cargo = null;
    }
    const message = task.action === 'wear' ? '已穿上' : '已脱下';
    this.release(p);
    p.reason = message + APPAREL_NAMES[piece.kind];
  }
  private leisureCell(p: Pos) {
    return inside(p) && this.canStop(p) && !this.ladders[at(p)] && !this.furnitureAt(p) &&
      !this.jobs.some(j => !j.cancelled && this.footprint(j).some(q => same(q, p))) &&
      this.temperature(p) >= 6 && this.temperature(p) <= 32;
  }
  private gatheringCell(table: DiningTable, target: Pos) {
    return table.gathering && this.canStop(target) && !this.ladders[at(target)] &&
      tableCells(table).some(c => c.z === target.z && Math.abs(c.x-target.x)+Math.abs(c.y-target.y) === 1) &&
      this.chairs.some(c => same(c,target)) &&
      !this.fires.some(f => same(f,target)) &&
      !this.jobs.some(j => !j.cancelled && this.footprint(j).some(c => same(c,target))) &&
      this.temperature(target) >= 6 && this.temperature(target) <= 32;
  }
  socialRelaxing(p: Pawn) {
    return p.phase === 'recreation' && p.psyche.recreation?.kind === 'social' &&
      same(p,p.psyche.recreation.target) && p.path.length === 0 && this.validRecreation(p);
  }
  socialLineOfSight(from: Pos, to: Pos) {
    const mouth = (p:Pos) => ({x:p.x+.5,y:p.y+.5,z:Math.min(HEIGHT-.01,p.z+1.2)});
    return traceVoxelRay(mouth(from),mouth(to),{width:WIDTH,depth:DEPTH,height:HEIGHT})
      .every(entry => !this.shotBlocked(entry.cell));
  }
  socialDepart(p: Pawn) {
    rememberDeparture(this.socialHistory,p,this.tick,this.pawns,this.socialLog);
  }
  private leisureReserved(p: Pawn, target: Pos) {
    return this.pawns.some(q => q !== p && !q.dead &&
      ((q.psyche.recreation && same(q.psyche.recreation.target,target)) ||
       (q.living.mealTask && same(q.living.mealTask.target,target))));
  }
  private validRecreation(p: Pawn) {
    const activity = p.psyche.recreation;
    if (!activity || !this.pawnAllowed(p,activity.target) || this.tick >= activity.endTick || p.food < 12 || p.rest < 1 ||
        this.leisureReserved(p,activity.target)) return false;
    if (!activity.forced && ['work', 'sleep'].includes(assignmentAt(p.schedule, this.tick))) return false;
    if (activity.kind === 'social') {
      const table = this.tables.find(t => t.id === activity.spotId);
      return !!table && this.pawnAllowed(p,table) && this.gatheringCell(table,activity.target);
    }
    if (!this.leisureCell(activity.target)) return false;
    if (activity.kind === 'walk') return this.skyAt(activity.target) && natureWeatherAllowed(this.weather, this.tick);
    if (healthSummary(p).manipulation <= 0) return false;
    const pin = this.horseshoePins.find(b => b.id === activity.spotId);
    if (!pin || !this.pawnAllowed(p,pin) || pin.z !== activity.target.z) return false;
    const middle = { x: (pin.x + activity.target.x) / 2, y: (pin.y + activity.target.y) / 2, z: pin.z };
    return inside(middle) && this.canStop(middle) && !this.furnitureAt(middle) &&
      !this.jobs.some(j => !j.cancelled && same(j, pin));
  }
  private startRecreation(p: Pawn, forced = false, preferred?: RecreationKind): boolean {
    if (p.dead || p.downed || p.drafted || p.carriedBy !== null || p.faction !== 'colony' ||
        p.psyche.breakUntil > this.tick || p.food < 12 || p.rest < 1) return false;
    // Never replace an existing job until a reachable activity is known.
    this.search(p);
    const candidates: { kind: RecreationKind; target: Pos; spotId: number | null; score: number }[] = [];
    const occupied = (q: Pos) => this.pawns.some(other => other !== p && !other.dead &&
      same(other, q)) || this.leisureReserved(p,q);
    if (!preferred || preferred === 'social') for (const table of this.tables) {
      if (!this.pawnAllowed(p,table) || !table.gathering || this.jobs.some(j => !j.cancelled && j.kind === 'remove' && this.tableAt(j)?.id === table.id)) continue;
      const cells = new Map<number,Pos>();
      for (const cell of tableCells(table)) for (const [dx,dy] of horizontal) {
        const target = {x:cell.x+dx,y:cell.y+dy,z:cell.z};
        if (inside(target)) cells.set(at(target),target);
      }
      for (const target of cells.values()) {
        if (!this.pawnAllowed(p,target) || !this.gatheringCell(table,target) || occupied(target) || this.distance[at(target)] < 0) continue;
        candidates.push({kind:'social',target,spotId:table.id,
          score:recreationGain('social',p.psyche.tolerance.social)*DAY - this.distance[at(target)]});
      }
    }
    if (!preferred || preferred === 'horseshoes') for (const pin of this.horseshoePins) {
      if (!this.pawnAllowed(p,pin) || this.pawns.some(other => other !== p && other.psyche.recreation?.spotId === pin.id) ||
          this.jobs.some(j => !j.cancelled && same(j, pin))) continue;
      for (const [dx, dy] of horizontal) {
        const target = { x: pin.x + dx * 2, y: pin.y + dy * 2, z: pin.z },
          middle = { x: pin.x + dx, y: pin.y + dy, z: pin.z };
        if (!this.pawnAllowed(p,target) || !this.leisureCell(target) || !this.canStop(middle) || this.furnitureAt(middle) ||
            occupied(target) || this.distance[at(target)] < 0 || healthSummary(p).manipulation <= 0) continue;
        candidates.push({ kind: 'horseshoes', target, spotId: pin.id,
          score: recreationGain('horseshoes', p.psyche.tolerance.horseshoes) * DAY - this.distance[at(target)] });
      }
    }
    // Nature watching is outdoors, reachable and distinct from the physical game.
    if (!preferred || preferred === 'walk') for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
      if (Math.abs(dx) + Math.abs(dy) < 2) continue;
      for (const dz of [0, 1, -1]) {
        const target = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
        if (!this.pawnAllowed(p,target) || !natureWeatherAllowed(this.weather, this.tick) || !this.leisureCell(target) ||
          !this.skyAt(target) || occupied(target) || this.distance[at(target)] < 0) continue;
        candidates.push({ kind: 'walk', target, spotId: null,
          score: recreationGain('walk', p.psyche.tolerance.walk) * DAY - this.distance[at(target)] });
      }
    }
    candidates.sort((a, b) => b.score - a.score || at(a.target) - at(b.target));
    const choice = candidates[0];
    if (!choice) return false;
    if (!this.dropCargo(p)) { p.reason = '暂无卸货空间，保留物资后再安排娱乐'; return false; }
    this.release(p);
    this.search(p); // Drop planning changes the navigation tree.
    if (this.distance[at(choice.target)] < 0) return false;
    p.psyche.recreation = { kind: choice.kind, target: choice.target, spotId: choice.spotId, forced,
      startedTick: this.tick, endTick: this.tick + MOOD_RULES.recreationDurationTicks };
    this.go(p, at(choice.target), 'recreation');
    p.reason = choice.kind === 'walk' ? '前往户外散步观景' : choice.kind === 'social' ? '前往餐桌休闲' : '前往马蹄铁桩';
    p.workTarget = choice.kind === 'social' ? this.tables.find(t => t.id === choice.spotId)! :
      choice.spotId === null ? choice.target : this.horseshoePins.find(b => b.id === choice.spotId)!;
    return true;
  }
  private recreationTick(p: Pawn) {
    const activity = p.psyche.recreation;
    if (!activity || !same(p, activity.target) || !this.validRecreation(p) || p.psyche.joy >= MOOD_RULES.recreationStopJoy) {
      this.release(p); p.reason = '娱乐结束，等待重新安排'; return;
    }
    p.destination = null;
    p.psyche.joy = Math.min(100, p.psyche.joy + recreationGain(activity.kind, p.psyche.tolerance[activity.kind]));
    p.psyche.tolerance[activity.kind] = Math.min(1, p.psyche.tolerance[activity.kind] + MOOD_RULES.toleranceGainPerTick);
    p.reason = activity.kind === 'walk' ? '户外散步观景' : activity.kind === 'social' ? '在桌边休闲，附近有人时可能交谈' : '投掷马蹄铁';
  }
  private updatePsychology() {
    for (const p of this.pawns) {
      if (p.faction === 'colony' && !p.dead && (this.tick + p.id) % ENVIRONMENT_RULES.wetInterval === 0 &&
          this.weatherExposed(p) && wettingWeather(this.weather, this.tick)) remember(p.psyche, 'wet', this.tick);
      if (p.phase === 'rest' && p.sleepBedId === null && p.sleepingSince !== null && this.tick - p.sleepingSince >= 120)
        remember(p.psyche, 'sleptGround', this.tick);
      const event = advancePsyche(p, this.tick, this.temperature(p));
      if (event === 'started') {
        p.drafted = false;
        this.release(p);
        this.dropCargo(p); // On a full map keep physical cargo until space becomes available.
        p.phase = 'mental'; p.reason = '精神崩溃：失落游荡';
        this.notice = `${p.name}持续低落，暂时放下工作。改善生活条件可以降低再次崩溃的风险。`;
      } else if (event === 'ended' && !p.dead && !p.downed && p.carriedBy === null) {
        this.release(p); p.reason = '情绪平复，重新安排工作';
        this.notice = `${p.name}已恢复行动。`;
      }
    }
  }
  private mentalTick(p: Pawn) {
    p.rest = Math.max(0, p.rest - restLoss(p.rest));
    if (p.cargo) this.dropCargo(p);
    p.phase = 'mental';
    p.reason = '精神崩溃：失落游荡';
    if (this.tick < p.moveTick) return;
    const candidates = this.neighbors(p).filter(i => !this.furnitureAt(position(i)) && !this.ladders[i]);
    // Short, deterministic local steps never teleport through a closed door.
    const eligible = candidates.filter(i => {
      const door = this.doors.find(d => same(d, position(i)));
      return !door || door.mode === 'open' || door.openUntil >= this.tick;
    });
    const previous = { x: p.x, y: p.y, z: p.z };
    if (eligible.length) {
      Object.assign(p, position(eligible[(Math.floor(this.tick / 60) + p.id) % eligible.length]));
      this.trackDirt(p, previous);
    }
    p.moveTick = this.tick + this.weatherMoveTicks(previous, 60, p);
  }
  fireRelease(p: Pawn) { this.release(p); }
  fireDropCargo(p: Pawn) { return this.dropCargo(p); }
  fireRoute(p: Pawn, targets: Pos[]): number[] | null {
    if (!this.standable(p)) return null;
    this.search(p);
    let best = -1;
    for (const target of targets) for (const [dx, dy, dz] of [[0, 0, 0], ...FIRE_DIRECTIONS]) {
      const q = { x: target.x + dx, y: target.y + dy, z: target.z + dz };
      if (!inside(q) || !this.canStop(q)) continue;
      const cell = at(q);
      if (this.distance[cell] >= 0 && (best < 0 || this.distance[cell] < this.distance[best])) best = cell;
    }
    return best < 0 ? null : this.route(best);
  }
  private reconcileFireState() {
    for (const f of [...this.fires]) if (!fireFuelAt(this, f).length) removeFire(this, f, '可燃物已移除，火焰熄灭');
    this.fireDamage = this.fireDamage.filter(d => !!findFireDamageTarget(this, d));
    for (const p of this.pawns) if ((p.firefightTask && !validFirefight(this, p)) || (p.repairTask && !validRepair(this, p))) this.release(p);
  }
  fireBurnGround(id: number, amount: number) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    const lost = Math.min(item.amount, amount);
    const items = this.items.flatMap(i => i.id !== id ? [i] : i.amount > lost ? [{ ...i, amount: i.amount - lost }] : []);
    this.tradeApplyPlacement({ items, nextId: this.nextId }, '预留物品已烧毁，重新安排任务');
    this.recordDestroyedCargo(item, lost);
    fireLog(this, 'destroyed', item, `${lost}单位${RESOURCE_NAMES[item.resource]}被烧毁`);
  }
  fireBurnFurniture(id: number, damage: number) {
    const ground = this.items.find(i => i.furniture?.id === id);
    const job = this.jobs.find(j => j.deliveredBatches.some(b => b.furniture?.id === id));
    const batch = ground ?? job?.deliveredBatches.find(b => b.furniture?.id === id);
    if (!batch?.furniture || !Number.isFinite(damage) || damage <= 0) return;
    batch.furniture.hitPoints = Math.max(0,batch.furniture.hitPoints-damage);
    if (batch.furniture.hitPoints > 0) { this.revision++; return; }
    const position = ground ?? job!;
    if (ground) this.tradeApplyPlacement({items:this.items.filter(i=>i.id!==ground.id),nextId:this.nextId},'指定家具已烧毁');
    if (job) { job.deliveredBatches = job.deliveredBatches.filter(b=>b!==batch); delete job.delivered.furniture; }
    this.stats.destroyed.furniture++;
    for (const j of [...this.jobs]) if (j.furnitureId === id) this.cancel(j);
    fireLog(this,'destroyed',position,'打包家具被烧毁，原品质家具已损失');
  }
  private reconcileRelocationJobs() {
    for (const j of [...this.jobs]) if (!j.cancelled && j.furnitureId !== undefined &&
        !this.installedFurniture(j.furnitureKind!,j.furnitureId) && !this.packedFurniture(j.furnitureId)) this.cancel(j);
    reconcileStorageGroups(this);
  }
  /** Delivered inputs are still physical, unlike already consumed construction
   * materials. Destroy their container exactly once, leaving carried inputs intact. */
  private fireDestroyJob(j: Job) {
    for (const p of this.pawns) if (p.jobId === j.id) this.release(p);
    for (const r of resources) this.stats.destroyed[r] += j.delivered[r] ?? 0;
    this.jobs = this.jobs.filter(k => k.id !== j.id);
    this.fireDamage = this.fireDamage.filter(d => !(d.kind === 'frame' && d.targetId === j.id));
  }
  /** Failure destroys part of the actual delivered material exactly once.
   * Unplaced survivors stay in a bounded container, never disappear or become
   * free credit toward the replacement's construction cost. */
  private failConstruction(p: Pawn, j: Job) {
    if (j.constructionFailure || !isFailableConstruction(j)) return;
    const lost: Partial<Counts> = {};
    j.deliveredBatches = j.deliveredBatches.map((batch,n) => {
      const remaining = constructionSalvage(batch.amount, constructionRandom(this.seed,j.id,j.workTicks,p.id,100 + n));
      const destroyed = batch.amount - remaining;
      lost[batch.resource] = (lost[batch.resource] ?? 0) + destroyed;
      this.stats.destroyed[batch.resource] += destroyed;
      j.delivered[batch.resource] = (j.delivered[batch.resource] ?? 0) - destroyed;
      return portion(batch,remaining);
    });
    j.constructionFailure = { workerId:p.id,lost };
    this.fireDamage = this.fireDamage.filter(d => !(d.kind === 'frame' && d.targetId === j.id));
    for (const pawn of this.pawns) if (pawn.jobId === j.id) this.release(pawn);
    j.owner = null;
    const loss = Object.entries(lost).filter(([,n]) => n! > 0)
      .map(([r,n]) => `${n} ${RESOURCE_NAMES[r as Resource]}`).join('、') || '无';
    const replaced = this.finishConstructionFailure(j);
    this.notice = `${p.name}施工失败；损失：${loss}。${replaced ? '余料已放下，重新安排搬料施工' : '附近地面已满，余料保留在工地等待清理'}`;
    p.reason = '施工失败，已释放工作预约';
    this.reconcileFireState(); this.revision++;
  }
  private finishConstructionFailure(j: Job): boolean {
    if (!j.constructionFailure || j.cancelled) return false;
    // Upper ladder segments have no same-level item support before completion.
    // Their surviving inputs fall locally to a legal lower/adjacent landing.
    const origin = this.dropPoint(j) ?? this.fireLanding(j) ?? undefined;
    const plan = !j.deliveredBatches.length ? {items:this.items,nextId:this.nextId} :
      origin ? this.planPlacement(j.deliveredBatches.map(batch => ({batch,origin}))) : null;
    if (!plan) {
      j.reason = '施工失败：剩余材料保留在工地，等待附近腾出落点后重新规划';
      return false;
    }
    this.commitPlacement(plan);
    const replacement = this.makeJob(j.kind,j,j.axis,j.material);
    if (j.storageSettings) replacement.storageSettings = structuredClone(j.storageSettings);
    replacement.reason = '施工失败后重新规划，等待重新搬料';
    this.jobs = this.jobs.map(job => job === j ? replacement : job);
    for (const group of this.storageGroups) group.memberIds = group.memberIds.map(id => id === j.id ? replacement.id : id);
    this.revision++;
    return true;
  }
  fireBurnConstruction(id: number, resource: Resource) {
    const job = this.jobs.find(j => j.id === id && j.constructionFailure);
    const batch = job?.deliveredBatches.find(b => b.resource === resource);
    if (!job || !batch || !['wood','cloth','components'].includes(resource)) return;
    batch.amount--;
    job.delivered[resource] = (job.delivered[resource] ?? 0) - 1;
    if (!job.delivered[resource]) delete job.delivered[resource];
    job.deliveredBatches = job.deliveredBatches.filter(b => b.amount > 0);
    const burned = job.constructionFailure!.burned ??= {};
    burned[resource] = (burned[resource] ?? 0) + 1;
    this.stats.destroyed[resource]++;
    fireLog(this,'destroyed',job,`施工余料中的 1 单位${RESOURCE_NAMES[resource]}被烧毁`);
    this.revision++;
  }
  /** Destruction makes a new ordinary plan. It never reuses the destroyed
   * entity, its paid materials, work, quality, owner, fuel or production bills. */
  private planAutoRebuild(plan: Pick<Job, 'kind' | 'x' | 'y' | 'z' | 'axis' | 'material' | 'storageSettings'> & { id?: number }) {
    if (!this.autoRebuild || !this.homeArea.has(at(plan))) return;
    const firstId = this.nextId;
    const result = this.dispatchCommand({ type: 'designate', tool: plan.kind as import('./types').Tool,
      from: { x: plan.x, y: plan.y, z: plan.z }, axis: plan.axis, material: plan.material });
    if (!result.ok) return;
    const job = this.jobs.find(j => j.id >= firstId && j.kind === plan.kind && same(j, plan));
    if (job && isShelfKind(job.kind) && plan.storageSettings) {
      job.storageSettings = structuredClone(plan.storageSettings);
      const group = this.storageGroups.find(g => g.memberIds.includes(plan.id!));
      if (group) group.memberIds = group.memberIds.map(id => id === plan.id ? job.id : id);
    }
  }
  /** Finishing construction preserves this frame's remaining HP ratio. A
   * replacement blueprint starts afresh, but subsequent damage is not healed. */
  private finishFrameDamage(job: Job) {
    const frame = this.fireDamage.find(d => d.kind === 'frame' && d.targetId === job.id);
    if (!frame) return;
    const ratio = frame.hitPoints / frame.maxHitPoints;
    if (job.kind === 'sandbag') {
      const bag = this.sandbags.find(b => same(b, job));
      if (bag) bag.hitPoints = Math.max(1, Math.round(SANDBAG_HP * ratio));
    } else {
      const kind = frameBuildingKind(job);
      const properties = { shelf:'shelves', smallShelf:'shelves', table:'tables', chair:'chairs', bed:'beds', door:'doors',
        stove:'stoves', stonecutter:'stonecutters', tailor:'tailors', weaponBench:'weaponBenches', researchBench:'researchBenches',
        horseshoePin:'horseshoePins', butcherSpot:'butcherSpots', device:'devices', fence:'fences', fenceGate:'fenceGates', penMarker:'penMarkers' } as const;
      const property = properties[kind as keyof typeof properties];
      const id = property ? this[property].find(o => same(o,job))?.id : null;
      if (id !== undefined) {
        const actual = findFireDamageTarget(this, { ...job, kind, targetId:id, key:fireDamageKey(kind,id,job),
          hitPoints:FIRE_MAX_HP[kind], maxHitPoints:FIRE_MAX_HP[kind] });
        if (actual) {
          const hitPoints = Math.max(1, Math.round(actual.maxHitPoints * ratio));
          if (hitPoints < actual.maxHitPoints) this.fireDamage.push({ ...actual, hitPoints });
        }
      }
    }
    this.fireDamage = this.fireDamage.filter(d => d !== frame);
  }
  fireBurnTree(id: number, damage: number) {
    const tree = this.trees.find(t => t.id === id);
    if (!tree) return;
    tree.health = Math.max(0, tree.health - damage / TREE_DATA[tree.species].maxHitPoints);
    if (tree.health > 0) return;
    for (const j of [...this.jobs]) if (same(j, tree) && ['cut', 'remove'].includes(j.kind)) this.fireDestroyJob(j);
    this.trees = this.trees.filter(t => t.id !== id); this.stats.treesDied++;
    this.rebuildTrees(); this.changed(tree);
    fireLog(this, 'destroyed', tree, '树木被烧毁，没有产出木材');
  }
  fireBurnCrop(id: number) {
    const crop = this.crops.find(c => c.id === id);
    if (!crop) return;
    for (const j of [...this.jobs]) if (same(j, crop) && ['harvest', 'sow'].includes(j.kind)) this.fireDestroyJob(j);
    this.crops = this.crops.filter(c => c.id !== id); this.revision++;
    fireLog(this, 'destroyed', crop, '作物被烧毁，没有收获产物');
  }
  /** Gravity never searches a remote reachable region. The first legal support
   * below is preferred; adjacent columns are considered only if it has none. */
  private fireLanding(from: Pos): Pos | null {
    const column = (x: number, y: number): Pos | null => {
      for (let z = from.z; z >= 1; z--) {
        const q = { x, y, z };
        if (!inside(q)) return null;
        if (this.canStop(q)) return q;
        if (this.blocks[at(q)] !== Block.Air) break;
      }
      return null;
    };
    const straight = column(from.x, from.y);
    if (straight) return straight;
    for (const [dx, dy] of horizontal) {
      const q = column(from.x + dx, from.y + dy);
      if (q) return q;
    }
    return null;
  }
  /** Fire bypasses demolition refunds/access rollback. Only a physically
   * impossible actor landing rejects the tentative destruction. */
  fireDestroy(target: FireDamage, reason: string): boolean {
    if (!findFireDamageTarget(this, target)) return true;
    if (target.kind === 'frame') {
      const job = this.jobs.find(j => j.id === target.targetId)!;
      this.fireDestroyJob(job);
      this.planAutoRebuild(job);
      this.reconcileRelocationJobs(); this.reconcileFireState(); this.changed(job);
      this.notice = reason;
      return true;
    }
    const cell = at(target), oldBlock = this.blocks[cell], oldLadder = this.ladders[cell];
    const layer = WIDTH * DEPTH;
    const wallBase = target.kind === 'block' && this.structureKinds[cell] === 2 ? cell :
      target.kind === 'block' && this.structureKinds[cell] === 3 && cell >= layer && this.structureKinds[cell-layer] === 2 ? cell-layer : null;
    // A Web wall occupies two blocks. Destroy and roll back the complete wall,
    // including when its bridge foundation burns; never infer legacy kind-0 walls.
    const wallCells = wallBase !== null ? [wallBase, wallBase+layer] :
      target.kind === 'block' && this.bridges[cell] && this.structureKinds[cell+layer] === 2 ? [cell+layer,cell+2*layer] : [];
    const bridgeWalls = wallCells.filter(i => i < CELLS && (this.blocks[i] === Block.Wood || this.blocks[i] === Block.Masonry)).map(i => ({i, block:this.blocks[i]}));
    const structuralPlan = target.kind === 'ladder' || target.kind === 'wire' ? { ...target, kind:target.kind } :
      wallBase !== null ? { ...position(wallBase), kind:'wall' as const, material:(oldBlock === Block.Masonry ? 'stone' : 'wood') as ConstructionMaterial } :
      target.kind === 'block' && this.bridges[cell] ? { ...target, z:target.z+1, kind:'bridge' as const } : null;
    const properties = { table: 'tables', chair: 'chairs', bed: 'beds', door: 'doors', stove: 'stoves', stonecutter: 'stonecutters', tailor: 'tailors',
      weaponBench: 'weaponBenches', researchBench: 'researchBenches', horseshoePin: 'horseshoePins',
      butcherSpot: 'butcherSpots', device: 'devices', fence:'fences', fenceGate:'fenceGates', penMarker:'penMarkers' } as const;
    const originals = { shelves: this.shelves, tables: this.tables, chairs: this.chairs, beds: this.beds, doors: this.doors, stoves: this.stoves, stonecutters: this.stonecutters,
      tailors: this.tailors, weaponBenches: this.weaponBenches, researchBenches: this.researchBenches,
      horseshoePins: this.horseshoePins, butcherSpots: this.butcherSpots, devices: this.devices,
      wires: this.wires, sandbags: this.sandbags, trees: this.trees,
      fences:this.fences,fenceGates:this.fenceGates,penMarkers:this.penMarkers };
    if (target.kind === 'block') this.blocks[cell] = Block.Air;
    for (const wall of bridgeWalls) this.blocks[wall.i] = Block.Air;
    if (target.kind === 'ladder') this.ladders[cell] = 0;
    const support = (p: Pos) => inside(p) && p.z > 0 && p.z + 1 < HEIGHT &&
      !!this.blocks[at(p) - WIDTH * DEPTH] && !this.blocks[at(p)] && !this.blocks[at(p) + WIDTH * DEPTH];
    const removed: FireDamage[] = [];
    const removedShelves = this.shelves.filter(s => (isShelfKind(target.kind) && s.id === target.targetId) || shelfCells(s).some(p=>!support(p)));
    this.shelves = this.shelves.filter(s=>!removedShelves.includes(s));
    for (const s of removedShelves) removed.push({ kind:s.kind,targetId:s.id,x:s.x,y:s.y,z:s.z,
      key:fireDamageKey(s.kind,s.id,s),hitPoints:SHELF_DEFS[s.kind].maxHitPoints,maxHitPoints:SHELF_DEFS[s.kind].maxHitPoints });
    for (const [kind, property] of Object.entries(properties) as [keyof typeof properties, typeof properties[keyof typeof properties]][]) {
      const objects = this[property];
      const keep = objects.filter(object => {
        const d: FireDamage = { kind, targetId: object.id, x: object.x, y: object.y, z: object.z,
          key: fireDamageKey(kind, object.id, object), hitPoints: FIRE_MAX_HP[kind], maxHitPoints: FIRE_MAX_HP[kind] };
        const cells = kind === 'door' ? [object] : fireDamageCells(d, this);
        if ((kind === target.kind && object.id === target.targetId) || cells.some(p => !support(p))) { removed.push(d); return false; }
        return true;
      });
      // All collections here contain positioned entities with ids; preserve their own richer records.
      (this[property] as typeof keep) = keep;
    }
    this.wires = this.wires.filter(w => !(target.kind === 'wire' && same(w, target)) &&
      (this.blocks[at(w)] || this.blocks[at(w) - WIDTH * DEPTH] || this.ladders[at(w)]));
    this.sandbags = this.sandbags.filter(support);
    this.trees = this.trees.filter(t => t.z > 0 && this.blocks[at(t) - WIDTH * DEPTH] && !this.blocks[at(t)]);
    this.stoveCells = new Set(this.stoves.map(at)); this.rebuildDevices(); this.rebuildTrees();
    this.penLookupRevision = -1;
    const falling = new Map<Pawn | WildAnimal, Pos>();
    for (const actor of [...this.pawns, ...this.animals]) if (!this.standable(actor)) {
      const landing = this.fireLanding(actor);
      if (!landing) {
        this.blocks[cell] = oldBlock; this.ladders[cell] = oldLadder;
        for (const wall of bridgeWalls) this.blocks[wall.i] = wall.block;
        Object.assign(this, originals); this.penLookupRevision = -1; this.stoveCells = new Set(this.stoves.map(at)); this.rebuildDevices(); this.rebuildTrees();
        return false;
      }
      falling.set(actor, landing);
    }
    cancelAnimalRopes(this);
    if (target.kind === 'block') { this.structureKinds[cell] = 0; this.bridges[cell] = 0; }
    for (const wall of bridgeWalls) {
      this.structureKinds[wall.i] = 0;
      const q=position(wall.i);
      for (const job of [...this.jobs]) if (job.kind !== 'wire' && !isConstructionFrame(job) &&
          this.footprint(job).some(p=>at(p)===wall.i)) this.fireDestroyJob(job);
      this.changed(q);
    }
    for (const d of removed) {
      if (d.kind === 'penMarker') removePenMarker(this,d.targetId!);
      if (d.kind === 'bed') { const bed = originals.beds.find(b => b.id === d.targetId)!; this.invalidatePrisonBed(bed); }
      for (const p of this.pawns) if (p.psyche.recreation?.spotId === d.targetId || p.repairTask?.damageKey === d.key ||
        p.living.mealTask?.chairId === d.targetId || p.living.mealTask?.tableId === d.targetId ||
        (p.psyche.recreation?.kind === 'social' && d.kind === 'chair' && same(p.psyche.recreation.target,d))) this.release(p);
      const cells = new Set(fireDamageCells(d, originals).map(at));
      // A wire/frame can share a cell with the destroyed object. Its own
      // support, not coordinate overlap, determines whether its inputs are lost.
      for (const j of [...this.jobs]) if (j.kind !== 'wire' && !isConstructionFrame(j) && cells.has(at(j))) this.fireDestroyJob(j);
      if (d.key !== target.key) fireLog(this, 'destroyed', d, '设施失去地面支撑而损毁；没有退还建筑材料');
    }
    for (const tree of originals.trees) if (!this.trees.includes(tree)) {
      this.stats.treesDied++; fireLog(this, 'destroyed', tree, '树木失去地面支撑而损毁');
      for (const j of [...this.jobs]) if (same(j, tree)) this.fireDestroyJob(j);
    }
    // Release carriers first; their patients are included in the precomputed landing map.
    for (const p of this.pawns) if (falling.has(p) || (p.carryingPawnId !== null && falling.has(this.pawns.find(q => q.id === p.carryingPawnId)!))) this.release(p);
    for (const [actor, landing] of falling) {
      const adjacent = actor.x !== landing.x || actor.y !== landing.y;
      Object.assign(actor, landing);
      actor.path = []; actor.reason = '支撑烧毁后落到下方地面';
      if (isAnimal(actor)) { actor.goal = null; actor.mateId = null; actor.mateProgress = 0; actor.eatProgress = 0; }
      else actor.destination = null;
      fireLog(this, 'fell', landing, `${actor.name}${adjacent ? '原列无合法净空，落到相邻列' : '支撑烧毁，沿原列落下'}；已到达最近合法地面`);
    }
    this.stockpiles = this.stockpiles.filter(p => this.standable(p) && !this.ladders[at(p)]);
    const changedSupports = new Set(target.kind === 'block' || target.kind === 'ladder' ? [cell,...bridgeWalls.map(w => w.i)] : []);
    for (const job of [...this.jobs]) if ((isConstructionFrame(job) || !!job.constructionFailure) &&
        constructionFrameCells(job).some(q => [at(q)-layer,at(q),at(q)+layer].some(i => changedSupports.has(i))) &&
        !(job.kind === 'wire' ? !this.placementReason('wire',job) : this.supported(job))) this.fireDestroyJob(job);
    this.farms = this.farms.filter(support); this.treePlots = this.treePlots.filter(support);
    for (const crop of [...this.crops]) if (!support(crop) || !this.farms.some(f => same(f, crop))) this.fireBurnCrop(crop.id);
    for (const j of [...this.jobs]) if (!support(j) && ['sow', 'plantTree', 'harvest', 'floor'].includes(j.kind)) this.fireDestroyJob(j);
    // An installation's delivered original is a physical object at its site.
    // Losing support cancels the plan and applies the same local gravity rule
    // as loose goods; it must never remain suspended in a hidden container.
    for (const j of [...this.jobs]) if (j.kind === 'install' &&
        this.furnitureCells(j.furnitureKind!,j,j.axis!).some(q => !support(q))) {
      for (const p of this.pawns) if (p.jobId === j.id) this.release(p);
      const landing = this.fireLanding(j);
      const plan = landing ? this.planPlacement(j.deliveredBatches.map(batch =>
        ({batch,origin:landing,cells:[landing]})),this.items,0) : null;
      if (plan) this.tradeApplyPlacement(plan);
      else for (const batch of j.deliveredBatches) this.stats.destroyed[batch.resource] += batch.amount;
      this.jobs = this.jobs.filter(k => k.id !== j.id);
      if (j.deliveredBatches.length) fireLog(this,plan ? 'fell' : 'destroyed',landing ?? j,
        plan ? '待安装家具失去支撑，保留原实体落到最近合法地面' : '待安装家具坠落后没有合法容纳位置而损毁');
      for (const linked of [...this.jobs]) if (linked.furnitureId === j.furnitureId) this.cancel(linked);
    }
    for (const item of [...this.items]) if (!this.groundAllowed(item)) {
      const landing = this.fireLanding(item);
      const base = this.items.filter(i => i.id !== item.id);
      const plan = landing ? this.planPlacement([{ batch: item, origin: landing, cells: [landing] }], base, 0) : null;
      this.tradeApplyPlacement(plan ?? { items: base, nextId: this.nextId });
      if (plan) fireLog(this, 'fell', landing!, `${RESOURCE_NAMES[item.resource]}失去支撑并落到${landing!.x === item.x && landing!.y === item.y ? '原列' : '相邻列'}地面`);
      else { this.recordDestroyedCargo(item); fireLog(this, 'destroyed', item, `${item.amount}单位${RESOURCE_NAMES[item.resource]}坠落后没有合法容纳位置而损毁`); }
    }
    for (const shelf of removedShelves) {
      this.releaseShelfUsers(shelf);
      const plan = this.planShelfRemoval(shelf);
      if (plan) this.tradeApplyPlacement(plan,'货架烧毁，重新安排取放');
      else for (const p of shelfCells(shelf)) if (this.groundAllowed(p) && this.items.filter(i=>same(i,p)).length > 1) {
        this.storageSpills = this.storageSpills.filter(s=>!same(s,p));
        this.storageSpills.push({ ...p,shelfId:shelf.id,reason:'destroyedShelf' });
        fireLog(this,'fell',p,'货架已毁；附近无空间，货物保留为可搬运的应急散货');
      }
    }
    this.pruneStorageSpills();
    this.storageReservations.clear(); this.fetchReservations.clear();
    for (const p of this.pawns) if (p.phase === 'haul' || p.phase === 'fetch') this.interruptProductionDelivery(p);
    this.roomsDirty = true; this.powerDirty = true; this.changed(target); this.pruneFilth();
    // Plan only after the complete destruction/falling transaction commits,
    // before storage cleanup can dissolve a two-member shelf group.
    if (structuralPlan) this.planAutoRebuild(structuralPlan);
    for (const shelf of removedShelves) this.planAutoRebuild({ ...shelf,
      storageSettings: effectiveShelfSettings(this.storageGroups, shelf.id, shelf.settings) });
    for (const d of removed) {
      if (isShelfKind(d.kind)) continue;
      const property = properties[d.kind as keyof typeof properties];
      const object = property ? originals[property].find(o => o.id === d.targetId) : undefined;
      if (!object) continue;
      const kind = d.kind === 'device' || d.kind === 'weaponBench' ? (object as Device | WeaponBench).kind : d.kind;
      this.planAutoRebuild({ ...object, kind:kind as JobKind });
    }
    this.reconcileRelocationJobs();
    this.reconcileFireState(); this.updateRooms(); this.updatePower();
    this.notice = reason;
    return true;
  }
  private release(p: Pawn) {
    delete p.productionDelivery;
    if (p.phase === 'rest' && p.sleepingSince !== null && this.tick - p.sleepingSince >= LIVING_RULES.sleepThoughtDelay &&
        !p.dead && !p.downed && this.beds.some(b => b.id === p.sleepBedId && b.owner === p.id && !b.medical && !b.prisoner))
      rememberSleep(p.living, this.livingRoomAt(p), this.tick);
    p.living.mealTask = null; p.living.sleepThoughtAt = null;
    const roped = this.animals.find(a => a.id === p.ropeTask?.animalId);
    if (roped && roped.phase === 'rope') { roped.phase = 'roam'; roped.decisionTick = this.tick; }
    p.ropeTask = null;
    const animal = this.animals.find(a => a.id === p.handleTask?.animalId);
    if (animal && animal.phase === 'interact') { animal.phase = 'roam'; animal.decisionTick = this.tick; }
    p.handleTask = null;
    releaseWarden(this, p);
    p.firefightTask = null; p.repairTask = null;
    p.cleanTask = null;
    p.psyche.recreation = null;
    if (this.trade.session?.pawnId === p.id) this.trade.session = null;
    this.cancelShooting(p);
    p.attackTargetId = null;
    this.releaseCare(p);
    p.apparelTask = null;
    p.weaponTask = null;
    this.fetchReservations.delete(p.id);
    this.storageReservations.delete(p.id);
    const j = this.jobs.find((j) => j.id === p.jobId);
    if (j?.owner === p.id) j.owner = null;
    p.jobId = null;
    p.path = [];
    p.destination = null;
    p.phase = p.dead
      ? 'dead'
      : p.downed
        ? 'downed'
        : p.drafted || p.faction === 'raider'
          ? 'combat'
          : p.faction === 'prisoner' ? 'prisoner' : 'idle';
    p.workTarget = null;
    p.eating = null;
    p.sleepBedId = null;
    p.sleepingSince = null;
  }
  private invalidatePrisonBed(bed: Bed) {
    const affectedPrisoners = new Set(this.pawns.filter(p => p.prisoner?.bedId === bed.id).map(p => p.id));
    for (const p of this.pawns) if (p.wardenTask && affectedPrisoners.has(p.wardenTask.prisonerId)) this.release(p);
    for (const p of this.pawns) {
      if (p.sleepBedId === bed.id || p.careBedId === bed.id || p.wardenTask?.bedId === bed.id) this.release(p);
      if (p.prisoner?.bedId === bed.id) {
        p.prisoner.bedId = null;
        this.release(p);
        p.reason = '囚犯床已撤销，等待转移';
      }
    }
  }
  prisonRelease(p: Pawn) { this.release(p); }
  animalAvailable(item: Stack, pawnId?: number) { return this.availableStack(item, pawnId); }
  animalTake(p: Pawn, id: number, amount: number) { return this.take(p, undefined, amount, id); }
  animalCanStop(p: Pos) { return this.canStop(p); }
  animalMoveTicks(a: WildAnimal, from: Pos, to: Pos = a) {
    return this.weatherMoveTicks(from, ANIMAL_DEFS[a.species].moveTicks * (a.phase === 'flee' ? .65 : 1) *
      (1 + a.malnutrition), to, (this.fenceAt(to) && !this.fenceAt(from)) || this.shelfAt(to) ? 14 : 0);
  }
  animalRoute(a: WildAnimal, targets: Set<number>): number[] | null {
    if (!targets.size) return null;
    return this.navigation.find(at(a), n => targets.has(n), n => this.animalNeighbors(a,position(n)),
      (from,to) => this.animalMoveTicks(a,position(from),position(to)));
  }
  animalNeighbors(a: WildAnimal, p: Pos) {
    return this.neighbors(p).filter(n => {
      const target = position(n);
      const door = this.gateAt(target) ?? this.doors.find(d => same(d, target));
      const fence = this.fenceAt(target);
      if (!isAnimalGroundStep(p,target) || this.ladders[n] || (fence && ANIMAL_HUSBANDRY[a.species].penAnimal) ||
          (!door && !fence && !this.markerAt(target) && !this.shelfAt(target) && this.furnitureAt(target)) || this.fires.some(f => same(f, target))) return false;
      return !door || door.mode === 'open' || door.openUntil > this.tick ||
        (a.faction === 'colony' && a.species === 'hare' && door.mode !== 'locked');
    });
  }
  animalGrassSite(p: Pos) {
    return p.z > 0 && this.standable(p) && !this.ladders[at(p)] && !this.furnitureAt(p) &&
      fertilityOf(this.blocks[at(p) - WIDTH * DEPTH]) >= .7 && this.skyAt(p) &&
      !this.farms.some(f => same(f,p)) && !this.fires.some(f => same(f,p));
  }
  animalEatCrop(id: number) {
    const crop = this.crops.find(c => c.id === id); if (!crop) return;
    this.crops = this.crops.filter(c => c.id !== id);
    for (const job of [...this.jobs]) if (job.kind === 'harvest' && same(job, crop)) this.cancel(job);
    this.revision++;
  }
  prisonDropCargo(p: Pawn) { return this.dropCargo(p); }
  prisonPath(from: Pos, to: Pos, allowed?: Set<number>): number[] | null {
    if (!inside(from) || !inside(to) || !this.standable(from) || !this.canStop(to) ||
        (allowed && (!allowed.has(at(from)) || !allowed.has(at(to))))) return null;
    this.search(from, allowed);
    return this.distance[at(to)] < 0 ? null : this.route(at(to));
  }
  prisonApproach(p: Pawn, target: Pos): number[] | null {
    this.search(p);
    if (!this.pawnAllowed(p,target)) return null;
    const stand = this.careStand(target as Pawn);
    return stand < 0 ? null : this.route(stand);
  }
  prisonCells(p: Pawn): Set<number> | null {
    const bed = this.beds.find(b => b.id === p.prisoner?.bedId && b.prisoner);
    if (!bed || !this.standable(bed)) return null;
    this.updateRooms();
    const room = this.rooms.roomAt(bed);
    // Voxel rooms flood-fill in 3D, so this first version also requires a roof.
    // Native ProperRoom has a different region test; see research/73 and implementation notes.
    if (!room || room.outdoor) return null;
    const cells = new Set<number>([at(bed)]), queue = [at(bed)];
    for (let head = 0; head < queue.length; head++) for (const next of this.neighbors(position(queue[head]))) {
      if (cells.has(next) || this.rooms.roomIds[next] !== room.id) continue;
      cells.add(next); queue.push(next);
    }
    return cells;
  }
  prisonTakeFood(p: Pawn, allowed: Set<number>): boolean {
    const foods = this.items.filter(i => NUTRITION[i.resource] && allowed.has(at(i)) && this.availableStack(i) > 0);
    if (!foods.length) return false;
    this.search(p, allowed);
    const order = ['meal', 'food', 'milk', 'grain', 'meat'];
    const food = foods.filter(i => this.reachableItemStand(i) >= 0).sort((a, b) =>
      order.indexOf(a.resource) - order.indexOf(b.resource) || this.distance[this.reachableItemStand(a)] - this.distance[this.reachableItemStand(b)] || a.id - b.id)[0];
    if (!food) return false;
    if (this.itemTouch(p,food)) {
      food.amount -= this.consume(p, food, this.availableStack(food));
      this.items = this.items.filter(i => i.amount > 0);
      this.reconcileHealth(p);
      p.path = []; p.destination = null; p.reason = '已吃过牢房内的食物';
    } else { this.go(p, this.reachableItemStand(food), 'prisoner'); p.reason = '前往牢房内取食'; }
    return true;
  }
  prisonFeed(p: Pawn, patient: Pawn) { return this.startCare(p, patient, 'feed'); }
  prisonBeginCapture(p: Pawn, _bed: Bed): boolean {
    if (!this.dropCargo(p)) return false;
    this.release(p);
    if (p.weapon) { p.weaponDropPending = true; this.dropPrimary(p, true); }
    // An already launched projectile keeps its original faction; stop only future attacks.
    for (const other of this.pawns) if (other.attackTargetId === p.id || other.shooting?.targetId === p.id) this.release(other);
    return true;
  }
  prisonBecomeColonist(p: Pawn) {
    this.release(p);
    p.faction = 'colony'; p.prisoner = null; p.retreating = false;
    p.psyche = initialPsyche(this.tick);
    for (const work of Object.keys(p.priorities) as Work[]) p.priorities[work] = work === 'hunt' ? 0 : 2;
    p.schedule = defaultSchedule(); p.phase = 'idle'; p.reason = '已加入殖民地，等待工作安排';
    this.revision++;
  }
  prisonExit(p: Pawn) { return this.tradeExit(p); }
  /** Common movement preserves doors, health/gear speed and carried-pawn coordinates. */
  private moveAlongPath(p: Pawn) {
    if (!p.path.length) return;
    // Reconsider changing snow/weather/door costs at bounded deterministic
    // intervals. Replan blocked paths immediately while retaining the task.
    if (p.path.length > 1 && ((this.tick + p.id) % 80 === 0 ||
        (this.tick >= p.moveTick && !this.neighbors(p).includes(p.path[0])))) {
      const allowed = p.faction === 'prisoner' && !p.prisoner?.releasing ? this.prisonCells(p) : undefined;
      const route = allowed === null ? null : this.travelRoute(p,p.path[p.path.length - 1],allowed);
      if (route) p.path = route;
    }
    if (this.tick < p.moveTick) return;
    const next = p.path[0];
    if (!this.neighbors(p).includes(next)) {
      this.interruptProductionDelivery(p); p.reason = '通路改变，等待重新规划'; return;
    }
    const door = this.gateAt(position(next)) ?? this.doors.find(d => same(d, position(next)));
    if (door?.mode === 'auto') {
      if (door.openUntil < this.tick) door.openUntil = this.tick + 13 + 37;
      if (this.tick < door.openUntil - 37) { p.reason = '等待木门打开'; return; }
      door.openUntil = this.tick + 37;
    }
    const previous = { x: p.x, y: p.y, z: p.z };
    const ticks = this.weatherMoveTicks(previous,this.pawnBaseMoveTicks(p),position(next),this.crossingTicks(previous,position(next)));
    Object.assign(p, position(next)); p.path.shift();
    this.trackDirt(p, previous);
    p.moveTick = this.tick + ticks;
    if (p.carryingPawnId !== null) {
      const patient = this.pawns.find(q => q.id === p.carryingPawnId);
      if (patient) Object.assign(patient, { x: p.x, y: p.y, z: p.z });
    }
  }
  tradeRelease(p: Pawn) { this.release(p); }
  penMoveHandler(p: Pawn, next: number): boolean {
    if (!this.penNeighbors(p,'rope').includes(next)) return false;
    const before = at(p);
    p.path = [next]; this.moveAlongPath(p); p.path = []; p.destination = null;
    return at(p) !== before;
  }
  penApproach(p: Pawn, target: Pos): number[] | null { return this.path(p,target); }
  tradeDropCargo(p: Pawn) { return this.dropCargo(p); }
  tradePlace(entries: { batch: Cargo; origin: Pos }[], base: Stack[]) { return this.planPlacement(entries, base); }
  tradeApplyPlacement(plan: Placement, reason = '预留物品已交易，重新安排任务') {
    // Selling a reserved stack invalidates its consumers in the same atomic
    // operation, before a snapshot can preserve a dangling fetch reference.
    const remainingItems = new Map(plan.items.map(item => [item.id, item]));
    const changed = this.items.filter(item => {
      const remaining = remainingItems.get(item.id);
      return !remaining || remaining.amount < item.amount || !same(remaining, item);
    });
    this.commitPlacement(plan);
    this.invalidateStackPlans(changed, reason);
  }
  private invalidateStackPlans(stacks: Stack[], reason: string) {
    if (!stacks.length) return;
    const changed = new Set(stacks.map(item => item.id));
    for (const p of this.pawns) if (
      changed.has(this.fetchReservations.get(p.id)?.sourceId ?? -1) ||
      changed.has(this.storageReservations.get(p.id)?.sourceId ?? -1) ||
      (p.living.mealTask !== null && !this.validDining(p)) ||
      (p.careFoodId !== null && changed.has(p.careFoodId)) ||
      (p.careMedicineId !== null && changed.has(p.careMedicineId)) ||
      (p.handleTask?.stage === 'fetch' && p.handleTask.foodId !== null && changed.has(p.handleTask.foodId)) ||
      (p.weaponTask?.stage === 'fetch' && stacks.some(i => i.weapon?.id === p.weaponTask!.weaponId)) ||
      (p.apparelTask?.stage === 'fetch' && stacks.some(i => i.apparel?.id === p.apparelTask!.apparelId))
    ) { this.release(p); p.reason = reason; }
  }
  private setItemsForbidden(items: Stack[], forbidden: boolean): CommandResult {
    for (const item of items) item.forbidden=forbidden;
    if (forbidden) {
      this.invalidateStackPlans(items,'物品已禁止，保留已取物资并重新安排');
      const workpieces=new Set(items.flatMap(i => i.unfinished ? [i.unfinished.id] : []));
      for (const p of this.pawns) {
        const job=this.jobs.find(j => j.id === p.jobId);
        if (job?.unfinishedId !== undefined && workpieces.has(job.unfinishedId)) {
          this.release(p); p.reason='未完成品已禁止，保留加工进度';
        }
      }
    }
    this.refreshReservations(); this.revision++;
    return { ok:true, count:items.length, message:items.length
      ? `已${forbidden ? '禁止' : '允许'}${items.length}堆物品；库存与实物保留`
      : '范围内没有已发现的地面物品' };
  }
  tradeTemperature(pawn: Pawn) { return this.temperature(pawn); }
  tradeReachable(pawn: Pawn): Set<number> {
    this.search(pawn);
    return new Set(this.items.filter(i => this.exploredAt(i) && this.reachableItemStand(i) >= 0).map(at));
  }
  tradeExit(pawn: Pawn): number[] | null {
    this.search(pawn);
    let best = -1, distance = Infinity;
    for (let i = 0; i < CELLS; i++) {
      const p = position(i);
      if (p.x !== 0 && p.x !== WIDTH - 1 && p.y !== 0 && p.y !== DEPTH - 1) continue;
      if (this.distance[i] >= 0 && this.distance[i] < distance) { best = i; distance = this.distance[i]; }
    }
    return best < 0 ? null : this.path(pawn, position(best));
  }
  tradeSpawn() {
    if (this.trade.goodwill <= -75 || this.trade.caravans.some(c => c.pawnIds.some(id => this.pawns.some(p => p.id === id && !p.dead)))) return;
    const colonist = this.pawns.find(p => p.faction === 'colony' && !p.dead && !p.downed);
    if (!colonist) return;
    const random = storyRandom(this.seed ^ 0x3cf790d, this.tick), kinds = visitorGroup(random);
    if (this.pawns.length + kinds.length > 64) { this.notice = '人物与遗体已达容量，商队本次未入场'; return; }
    this.search(colonist);
    const edges: Pos[] = [];
    for (let i = 0; i < CELLS; i++) {
      const p = position(i);
      if ((p.x === 0 || p.x === WIDTH - 1 || p.y === 0 || p.y === DEPTH - 1) &&
          this.distance[i] >= 0 && !this.pawns.some(q => same(p, q))) edges.push(p);
    }
    if (!edges.length) { this.notice = '商队找不到通往营地的边缘入口'; return; }
    const entry = edges[Math.floor(random() * edges.length)];
    edges.sort((a, b) => Math.abs(a.x - entry.x) + Math.abs(a.y - entry.y) + Math.abs(a.z - entry.z) -
      Math.abs(b.x - entry.x) - Math.abs(b.y - entry.y) - Math.abs(b.z - entry.z) || at(a) - at(b));
    if (edges.length < kinds.length) return;
    const meeting = this.standable(this.spawn) && this.distance[at(this.spawn)] >= 0 ? this.spawn : colonist;
    const caravanId = this.id(), kind = random() < 2 / 3 ? 'bulk' : 'combat';
    const pawnIds: number[] = [];
    for (const [i, role] of kinds.entries()) {
      const def = VISITOR_KINDS[role], id = this.id();
      const weapon = visitorWeapon(role, () => this.id(), random);
      const p: Pawn = { ...structuredClone(colonist), prisoner: null, wardenTask: null, handleTask: null, ropeTask: null, living: initialLiving(), psyche: initialPsyche(this.tick), social: initialSocial(this.tick, id), ...initialSurvival(this.seed, id), ...edges[i],
        id, name: `${def.name} ${this.trade.visits + 1}-${i + 1}`, color: role === 'trader' ? 0xd8bf79 : 0x96b5cc,
        food: 100, rest: 100, skills: initialSkills(i, true), faction: 'trader', weapon,
        priorities: Object.fromEntries(Object.keys(colonist.priorities).map(key => [key, 0])) as Pawn['priorities'],
        worn: [], apparelTask: null, apparelWearTicks: 0, jobId: null, path: [], destination: null,
        phase: 'idle', cargo: null, reason: '商队前往营地', moveTick: this.tick, workTarget: null,
        eating: null, sleepBedId: null, sleepingSince: null, schedule: defaultSchedule() };
      this.pawns.push(p); pawnIds.push(id);
    }
    const traderId = pawnIds[0];
    this.trade.caravans.push({ id: caravanId, kind, name: TRADER_NAMES[kind], pawnIds, traderId,
      stock: makeTraderStock(kind, traderId, () => this.id(), random), meeting: { x: meeting.x, y: meeting.y, z: meeting.z },
      stage: 'arriving', arrivedAt: this.tick, visitingAt: null, stayTicks: merchantStayTicks(random), reason: '商队正在前往营地' });
    this.trade.visits++; this.revision++;
    this.notice = `${TRADER_NAMES[kind]}从地图边缘抵达；安排殖民者前往交谈`;
  }
  private cancel(j: Job) {
    const wasCancelled = j.cancelled;
    j.cancelled = true;
    this.fireDamage = this.fireDamage.filter(d => !(d.kind === 'frame' && d.targetId === j.id));
    if (!wasCancelled && j.furnitureId !== undefined)
      for (const other of [...this.jobs]) if (other.id !== j.id && !other.cancelled && other.furnitureId === j.furnitureId) this.cancel(other);
    for (const p of this.pawns) if (p.jobId === j.id) {
      this.release(p);
      // Cancellation returns fetched inputs too, even when the bill's new
      // filter excludes them. A full floor safely leaves the cargo on its pawn.
      if (productionJobRecipe(j)) this.dropCargo(p);
    }
    j.cancelled = true;
    if (j.unfinishedId !== undefined) {
      this.jobs = this.jobs.filter(k => k !== j);
      return true;
    }
    const origin = this.dropPoint(j) ?? (j.constructionFailure ? this.fireLanding(j) ?? undefined : undefined);
    const batches = j.deliveredBatches;
    const plan = origin
      ? this.planPlacement(batches.map((batch) => ({ batch, origin })))
      : batches.length
        ? null
        : { items: this.items, nextId: this.nextId };
    if (!plan) {
      j.reason = '已取消，现场没有退料空间；材料保留原任务等待';
      return false;
    }
    this.commitPlacement(plan);
    this.jobs = this.jobs.filter((k) => k.id !== j.id);
    return true;
  }
  private dropPoint(p: Pos): Pos | undefined {
    if (this.standable(p)) return p;
    for (const [dx, dy] of horizontal) {
      const q = { x: p.x + dx, y: p.y + dy, z: p.z };
      if (this.standable(q)) return q;
    }
    return undefined;
  }
  private supported(j: Job) {
    if ((j.kind === 'mine' || j.kind === 'digLadder') && this.footprint(j).some(q => inside(q) &&
      (this.water[at(q)] || this.water[at(q) + WIDTH*DEPTH]))) return false;
    if (productionJobRecipe(j)) {
      const bill = this.productionBillFor(j);
      return !!bill && !bill.suspended &&
        !(j.kind === 'smith' && weaponResearchReason(this.research, j.weaponKind!)) &&
        !(j.kind === 'armorsmith' && armorResearchReason(this.research, j.apparelKind!));
    }
    if (j.kind === 'uninstall') return !!this.installedFurniture(j.furnitureKind!,j.furnitureId!);
    if (j.kind === 'install') return !this.placementReason(j.furnitureKind!,j,j.axis);
    if (isShelfKind(j.kind) || j.kind === 'table' || j.kind === 'chair') return !this.placementReason(j.kind,j,j.axis);
    if (j.kind === 'fence' || j.kind === 'fenceGate' || j.kind === 'penMarker') return !this.placementReason(j.kind,j,j.axis);
    if (j.kind === 'butcher') return this.butcherSpots.some(b => same(b, j) && !b.paused);
    if (j.kind === 'research')
      return (
        !!j.researchProject &&
        this.research.current === j.researchProject &&
        !researchBlockReason(this.research, j.researchProject) &&
        this.researchBenches.some((b) => same(b, j)) &&
        !this.jobs.some((k) => k.kind === 'remove' && !k.cancelled && same(k, j))
      );
    if (j.kind === 'researchBench') return !this.placementReason(j.kind, j, j.axis);
    if (j.kind === 'smith' && weaponResearchReason(this.research, j.weaponKind!)) return false;
    if (j.kind === 'armorsmith' && armorResearchReason(this.research, j.apparelKind!)) return false;
    if (
      j.kind !== 'remove' &&
      toolResearchReason(
        this.research,
        j.kind === 'plantTree' ? 'grove' : (j.kind as import('./types').Tool),
      )
    )
      return false;
    if (j.kind === 'plantTree')
      return (
        this.treePlots.some((f) => same(f, j) && f.species === j.treeSpecies) &&
        !this.treeSiteReason(j, j.treeSpecies!, j.id)
      );
    if (j.kind === 'cut') return this.trees.some((t) => same(t, j) && t.species === j.treeSpecies);
    if (
      isDeviceKind(j.kind) ||
      j.kind === 'stonecutter' ||
      j.kind === 'tailor' ||
      j.kind === 'smithy' ||
      j.kind === 'machining' ||
      j.kind === 'sandbag'
    )
      return !this.placementReason(j.kind, j, j.axis);
    if (j.kind === 'smith')
      return this.weaponBenches.some(
        (b) =>
          same(b, j) &&
          b.kind === j.weaponBenchKind &&
          b.bills.some((v) => v.kind === j.weaponKind && (j.billId !== undefined || !v.paused)),
      );
    if (j.kind === 'armorsmith')
      return this.weaponBenches.some(
        (b) =>
          b.kind === 'smithy' &&
          same(b, j) &&
          b.armorBills.some((bill) => bill.kind === j.apparelKind && (j.billId !== undefined || !bill.paused)),
      );
    if (j.kind === 'tailoring')
      return this.tailors.some(
        (b) => same(b, j) && b.bills.some((bill) => bill.kind === j.apparelKind && !bill.paused),
      );
    if (j.kind === 'stonecut') return this.stonecutters.some((b) => same(b, j) && !b.paused);
    if (j.kind === 'refuel')
      return (
        this.devices.some(
          (d) => d.kind === 'generator' && same(d, j) && (j.cost.wood ?? 0) <= 75,
        ) ||
        this.weaponBenches.some(
          (b) => b.kind === 'smithy' && same(b, j) && (j.cost.wood ?? 0) <= 50,
        )
      );
    if (j.kind === 'bed' || j.kind === 'door') return !this.placementReason(j.kind, j, j.axis);
    if (j.kind === 'bridge') return !this.placementReason(j.kind, j);
    if (j.kind === 'wall' || j.kind === 'stove') return this.blocks[index(j.x, j.y, j.z - 1)] !== 0 && !this.placementReason(j.kind, j, j.axis, j.material);
    if (j.kind === 'cook') return this.stoves.some((s) => same(s, j) && !s.paused);
    if (j.kind === 'sow')
      return (
        this.farms.some((f) => same(f, j)) &&
        this.farmable(j) &&
        !this.crops.some((c) => same(c, j))
      );
    if (j.kind === 'harvest') return this.crops.some((c) => same(c, j) && c.growth >= 1);
    if (j.kind === 'floor')
      return horizontal.some(([dx, dy]) => {
        const q = { x: j.x + dx, y: j.y + dy, z: j.z - 1 };
        return inside(q) && (this.blocks[at(q)] !== 0 || this.ladders[at(q)] !== 0);
      });
    if (j.kind === 'ladder')
      return (
        this.blocks[index(j.x, j.y, j.z - 1)] !== 0 ||
        this.ladders[index(j.x, j.y, j.z - 1)] !== 0 ||
        this.ladders[index(j.x, j.y, j.z + 1)] !== 0
      );
    if (j.kind === 'digLadder') return this.ladders[index(j.x, j.y, j.z + 1)] !== 0;
    return true;
  }
  private assign(p: Pawn) {
    this.assignWork(p);
    // Try valid inside-target jobs first: their interaction cell may be outside.
    if (p.phase === 'idle' && !p.productionDelivery) this.tryReturnToArea(p);
  }
  private assignWork(p: Pawn) {
    if (p.food < 30 && this.tryFood(p)) return;
    if (this.startMedicalRest(p)) return;
    if (p.priorities.care > 0 && this.tryCare(p)) return;
    if (wantsSleep(p.rest, assignmentAt(p.schedule, this.tick))) {
      this.startSleep(p);
      return;
    }
    if (healthSummary(p).manipulation <= 0) {
      this.dropCargo(p);
      p.reason = '操作能力不足，无法劳动';
      return;
    }
    if (p.cargo) {
      this.deliverCargo(p);
      return;
    }
    if (shouldRecreate(p, assignmentAt(p.schedule, this.tick)) && this.startRecreation(p)) return;
    this.chooseProductionForWorker(p);
    const jobs = this.jobs
      .filter((j) => !j.cancelled && !j.constructionFailure && j.owner === null && this.pawnAllowed(p,j) && p.priorities[workType(j.kind)] > 0)
      .sort(
        (a, b) =>
          p.priorities[workType(a.kind)] - p.priorities[workType(b.kind)] ||
          Number(a.kind === 'research') - Number(b.kind === 'research') ||
          (a.kind === 'research' && b.kind === 'research'
            ? this.researchBenchFactor(this.researchBenches.find((v) => same(v, b))!) -
              this.researchBenchFactor(this.researchBenches.find((v) => same(v, a))!)
            : 0) ||
          a.id - b.id,
      );
    const loose =
      p.priorities.haul > 0 &&
      (this.stockpiles.length > 0 || this.shelves.length > 0) &&
      this.items.some((i) => this.canImproveStorage(i));
    // These work types are generated from world state instead of Job objects.
    // Use the same priority ordering in the jobless branch and around regular
    // jobs; each failed option is attempted at most once in this assignment.
    const triedExtras = new Set<string>();
    const tryExtras = (through: number, includeHaul: boolean, restoreSearch = false): boolean => {
      const priority = (work: Work | 'repair') => p.priorities[work === 'repair' ? 'build' : work];
      const options = (['firefight', 'warden', 'handle', 'hunt', 'haul', 'clean', 'repair'] as const)
        .filter(work => (includeHaul || work !== 'haul') && !triedExtras.has(work) &&
          priority(work) > 0 && priority(work) <= through)
        .sort((a, b) => priority(a) - priority(b));
      for (const work of options) {
        triedExtras.add(work);
        if (work === 'haul') this.search(p);
        if (work === 'firefight' ? tryFirefight(this, p) : work === 'repair' ? tryRepair(this, p) :
            work === 'warden' ? tryWarden(this, p) : work === 'handle' ? (tryHandle(this, p) || tryRope(this,p)) : work === 'hunt' ? this.tryHunt(p) :
            work === 'clean' ? this.tryClean(p) : this.tryHaul(p)) return true;
      }
      // Each helper can replace the shared BFS tree. Restore it only when the
      // caller will inspect a normal Job, not during empty idle assignments.
      if (restoreSearch && options.length) this.search(p);
      return false;
    };
    // Most growing ticks have no work. Avoid traversing the full 3D map for idle people.
    if (
      !loose &&
      !jobs.some(
        (j) =>
          this.supported(j) &&
          (j.unfinishedId !== undefined || recipeUsesUnfinished(productionJobRecipe(j)) &&
            this.items.some(i => i.unfinished?.recipe === productionJobRecipe(j) && i.unfinished.creatorId === p.id) || !missing(j) ||
            (j.kind === 'refuel' && (j.delivered.wood ?? 0) > 0) ||
            this.items.some((i) => i.resource === missing(j) && this.acceptsJobCargo(j,i,i))),
      )
    ) {
      if (tryExtras(4, false)) return;
      for (const j of jobs) {
        const needed = missing(j);
        j.reason = !this.supported(j)
          ? '等待支撑或相邻梯子施工'
          : needed
            ? `缺少${RESOURCE_NAMES[needed]}`
            : '等待工作面';
      }
      p.reason =
        p.food < 30
          ? '饥饿，暂无可用食物'
          : jobs.length
            ? '等待材料或支撑'
            : p.priorities.haul > 0 && this.items.some((i) => this.storagePriority(i) < 3)
              ? '仓储已满或不可达，等待可用仓位'
              : '暂无工作';
      return;
    }
    this.search(p);
    for (const j of jobs) {
      if (tryExtras(p.priorities[workType(j.kind)], j.kind === 'research', true)) return;
      const skillFailure = this.skillFailure(p, j) ?? this.productionWorkerFailure(p, j);
      if (skillFailure) {
        j.reason = skillFailure;
        continue;
      }
      if (this.fires.some(f => touchesFire(f, j))) { j.reason = '工作位置起火，等待灭火'; continue; }
      if (this.waitingForFuel(j)) {
        j.reason = j.weaponBenchKind === 'machining' ? '机械加工台等待供电' : '等待补充燃料';
        continue;
      }
      if (!this.supported(j)) {
        j.reason = '等待支撑或相邻梯子施工';
        continue;
      }
      if (productionJobRecipe(j) && j.progress === 0 && !Object.values(j.delivered).some(n => n! > 0) &&
        !this.productionFeasible(j, undefined, p)) {
        j.reason = '本批材料尚未齐备，等待补料或其他可执行账单';
        continue;
      }
      const stand = this.reachableStand(j, p);
      if (stand < 0) {
        j.reason = '无可达工作面；需要两格净空与层间通路';
        continue;
      }
      if (
        ['stonecut', 'research', 'tailoring', 'smith', 'armorsmith'].includes(j.kind) &&
        this.jobs.some(
          (other) =>
            other.id !== j.id &&
            ['stonecut', 'research', 'tailoring', 'smith', 'armorsmith'].includes(other.kind) &&
            other.owner !== null &&
            this.stands(other).includes(stand),
        )
      ) {
        j.reason = '切石工作位置已被占用';
        continue;
      }
      this.allowPartialRefuel(j, p);
      const unfinished = j.unfinishedId !== undefined || (!j.progress && !Object.values(j.delivered).some(n=>n!>0))
        ? this.unfinishedForWorker(j, p) : undefined;
      if (j.unfinishedId !== undefined && !unfinished) { j.reason = '等待可达的未完成品和原作者'; continue; }
      const needed = missing(j);
      if (!unfinished && needed && !this.pileFor(p, needed, j)) {
        j.reason = `缺少可达${RESOURCE_NAMES[needed]}`;
        continue;
      }
      if (unfinished) this.claimUnfinished(j, unfinished);
      j.owner = p.id;
      this.bindProductionInputs(j);
      p.jobId = j.id;
      p.workTarget = { x: j.x, y: j.y, z: j.z };
      this.continueJob(p, j);
      return;
    }
    if (tryExtras(4, true)) return;
    p.phase = 'idle';
    p.reason =
      jobs.length && jobs.every((j) => this.skillFailure(p, j) ?? this.productionWorkerFailure(p, j))
        ? (this.skillFailure(p, jobs[0]) ?? this.productionWorkerFailure(p, jobs[0]))!
        : jobs.length
          ? '等待材料或可达通路'
          : '暂无工作';
  }
  /** Uses the current navigation search; shared by idle and research preemption. */
  private tryHaul(p: Pawn): boolean {
    if (p.priorities.haul > 0 && healthSummary(p).manipulation > 0) {
      let best: Stack | undefined;
      let priority = -1;
      for (const i of this.items)
        if (this.pawnAllowed(p,i) && this.reachableItemStand(i) >= 0 && this.availableStack(i, p.id) > 0 && !this.chunkReserved(i, p.id)) {
          const destination = this.storageDestination(i, this.storagePriority(i), p.id);
          if (
            destination &&
            (!best ||
              destination.priority > priority ||
              (destination.priority === priority && this.distance[this.reachableItemStand(i)] < this.distance[this.reachableItemStand(best)]))
          ) {
            best = i;
            priority = destination.priority;
          }
        }
      if (best) {
        const target = this.storageDestination(best, this.storagePriority(best), p.id)!;
        if (!this.reserveStorage(p, best, target, best.id)) return false;
        this.go(p, this.reachableItemStand(best), 'haul');
        p.reason = '收集散落物资';
        return true;
      }
    }
    return false;
  }
  private skillFailure(p: Pawn, j: Job): string | null {
    if (healthSummary(p).manipulation <= 0) return '操作能力不足，无法劳动';
    if (j.kind === 'sow') {
      const crop = CROPS[j.cropKind ?? this.farms.find((f) => same(f, j))?.crop ?? 'rice'];
      if (p.skills.plants.level < crop.minSkill)
        return `播种${crop.name}需要植物 ${crop.minSkill} 级；${p.name} 当前 ${p.skills.plants.level} 级`;
    }
    if (j.kind === 'smith') {
      const level = WEAPON_DEFS[j.weaponKind!].sourceCraftingLevel;
      if (p.skills.crafting.level < level)
        return `需要工艺 ${level} 级；${p.name} 当前 ${p.skills.crafting.level} 级`;
    }
    if (j.kind === 'armorsmith') {
      const level = APPAREL_DEFS[j.apparelKind!].sourceCraftingLevel;
      if (p.skills.crafting.level < level)
        return `需要工艺 ${level} 级；${p.name} 当前 ${p.skills.crafting.level} 级`;
    }
    if (j.kind === 'plantTree' && p.skills.plants.level < 6)
      return `播种树木需要种植 6 级；${p.name} 当前 ${p.skills.plants.level} 级`;
    const construction =
      j.kind === 'floor' && j.material === 'stone'
        ? 3
        : ((
            { smithy: 4, machining: 4, generator: 4, solar: 6, heater: 5, cooler: 5 } as Partial<
              Record<JobKind, number>
            >
          )[j.kind] ?? 0);
    if (p.skills.construction.level < construction)
      return `需要建造 ${construction} 级；${p.name} 当前 ${p.skills.construction.level} 级`;
    return null;
  }
  private waitingForFuel(j: Job): boolean {
    return (
      (j.kind === 'smith' || j.kind === 'armorsmith') &&
      j.progress < j.work &&
      this.weaponBenches.some(
        (b) =>
          same(b, j) &&
          ((b.kind === 'smithy' && b.fuel <= 0) ||
            (b.kind === 'machining' && (!b.power?.on || !b.power.powered))),
      )
    );
  }
  private startSleep(p: Pawn) {
    this.release(p);
    const retainedCargo = !this.dropCargo(p);
    this.search(p);
    const available = this.beds
      .filter(
        (b) =>
          !b.medical && this.pawnAllowed(p,b) &&
          !b.prisoner &&
          (b.owner === null || b.owner === p.id) &&
          this.distance[at(b)] >= 0 &&
          !this.pawns.some(
            (other) =>
              other.id !== p.id &&
              (other.sleepBedId === b.id ||
                ((other.dead || other.downed) && bedCells(b).some((cell) => same(cell, other)))),
          ),
      )
      .sort(
        (a, b) =>
          Number(b.owner === p.id) - Number(a.owner === p.id) ||
          this.distance[at(a)] - this.distance[at(b)],
      );
    const bed = available[0];
    if (bed) {
      if (bed.owner === null) {
        for (const b of this.beds) if (b.owner === p.id) b.owner = null;
        bed.owner = p.id;
      }
      p.sleepBedId = bed.id;
      this.go(p, at(bed), 'sleepTravel');
      p.reason = retainedCargo ? '无卸货空间，保留随身物资前往床位' : '前往床位睡觉';
    } else {
      if (this.tryReturnToArea(p)) return;
      p.phase = 'rest';
      p.sleepingSince = this.tick;
      p.reason = retainedCargo ? '无卸货空间，保留随身物资地面睡眠' : '地面睡眠（无可达空床）';
    }
  }
  private continueJob(p: Pawn, j: Job) {
    if (j.cancelled || j.constructionFailure || !this.pawnAllowed(p,j)) {
      this.release(p);
      return;
    }
    const skillFailure = this.skillFailure(p, j);
    if (skillFailure) {
      j.reason = skillFailure;
      this.release(p);
      p.reason = skillFailure;
      return;
    }
    if (j.unfinishedId !== undefined) { this.continueUnfinished(p, j); return; }
    if (p.cargo) {
      this.deliverCargo(p);
      return;
    }
    this.search(p);
    this.allowPartialRefuel(j, p);
    const needed = missing(j);
    if (needed) {
      const stack = this.pileFor(p, needed, j);
      if (!stack) {
        j.reason = `等待可达${RESOURCE_NAMES[needed]}`;
        this.release(p);
        return;
      }
      this.go(p, this.reachableItemStand(stack), 'fetch');
      this.fetchReservations.set(p.id, { sourceId: stack.id, amount: Math.min(
        this.availableStack(stack, p.id), carryLimit(stack.resource), (j.cost[needed] ?? 0) - (j.delivered[needed] ?? 0),
      ) });
      p.reason = `搬运${RESOURCE_NAMES[needed]}`;
      return;
    }
    const stand = this.reachableStand(j, p);
    if (stand < 0) {
      j.reason = '通路已改变，等待重新连通';
      this.release(p);
      return;
    }
    this.go(p, stand, 'work');
    p.reason = '前往工作面';
    j.reason = JOB_NAMES[j.kind] + '中';
  }
  private allowPartialRefuel(j: Job, p: Pawn) {
    if (j.kind !== 'refuel') return;
    // Ordinary (non-atomic) refuelling may use the wood actually reachable now.
    // Other construction recipes still require every ingredient before work starts.
    const available =
      (j.delivered.wood ?? 0) +
      this.items.reduce(
        (n, i) => n + (i.resource === 'wood' && this.pawnAllowed(p,i) && this.reachableItemStand(i) >= 0 ? i.amount : 0),
        0,
      );
    if (available > 0) j.cost.wood = Math.min(j.cost.wood ?? 75, available);
  }
  private deliverCargo(p: Pawn) {
    if (!p.cargo) return;
    if (p.productionDelivery) { this.continueProductionDelivery(p); return; }
    if (p.cargo.unfinished && p.cargo.forbidden) {
      this.release(p); this.dropCargo(p); p.reason = '未完成品已禁止搬运和续作'; return;
    }
    this.search(p);
    let j = this.jobs.find((j) => j.id === p.jobId && !j.cancelled && !j.constructionFailure);
    if (j?.unfinishedId !== undefined && p.cargo.unfinished?.id === j.unfinishedId) { this.continueUnfinished(p, j); return; }
    if (!j && p.cargo.unfinished && !p.cargo.forbidden && p.cargo.unfinished.creatorId === p.id) {
      j = this.jobs.find(k => !k.cancelled && k.owner === null && !this.productionWorkerFailure(p,k) &&
        !this.skillFailure(p,k) && p.priorities[workType(k.kind)] > 0 && this.supported(k) &&
        productionJobRecipe(k) === p.cargo!.unfinished!.recipe &&
        (k.unfinishedId === p.cargo!.unfinished!.id || (k.progress === 0 && !Object.values(k.delivered).some(n=>n!>0))) &&
        this.reachableStand(k, p) >= 0 && this.unfinishedForWorker(k,p) === p.cargo);
      if (j) {
        this.claimUnfinished(j, p.cargo); j.owner = p.id; p.jobId = j.id;
        p.workTarget = { x:j.x, y:j.y, z:j.z }; this.continueUnfinished(p,j); return;
      }
    }
    if (j && (!this.pawnAllowed(p,j) || !this.acceptsJobCargo(j,p.cargo))) { this.release(p); j = undefined; }
    // Loading deliberately clears reservations, but the carried physical input
    // can be rebound to a reachable job before requiring a stockpile detour.
    if (!j) {
      j = this.jobs.find(
        (k) =>
          !k.cancelled &&
          !k.constructionFailure &&
          k.owner === null &&
          p.priorities[workType(k.kind)] > 0 &&
          !this.skillFailure(p, k) && !this.productionWorkerFailure(p, k) &&
          (k.cost[p.cargo!.resource] ?? 0) > (k.delivered[p.cargo!.resource] ?? 0) &&
          this.acceptsJobCargo(k,p.cargo!,p) &&
          this.supported(k) &&
          this.reachableStand(k, p) >= 0,
      );
      if (j) {
        j.owner = p.id;
        this.bindProductionInputs(j);
        p.jobId = j.id;
        p.workTarget = { x: j.x, y: j.y, z: j.z };
      }
    }
    if (j && (j.delivered[p.cargo.resource] ?? 0) < (j.cost[p.cargo.resource] ?? 0)) {
      const stand = this.reachableStand(j, p);
      if (stand >= 0) {
        this.storageReservations.delete(p.id);
        this.go(p, stand, 'work');
        p.reason = '把材料送往工作面';
        return;
      }
    }
    const best = this.storageDestination(p.cargo, -1, p.id);
    if (!best) {
      this.storageReservations.delete(p.id);
      // A former producer must not hold the only ingredients forever after a
      // policy change. Return them through bounded physical placement so the
      // newly eligible worker can collect them; full ground remains lossless.
      const handoff = !j && this.jobs.some(k => !k.cancelled && k.productionPolicy &&
        this.productionWorkerFailure(p, k) && this.acceptsJobCargo(k, p.cargo!) &&
        (k.cost[p.cargo!.resource] ?? 0) > (k.delivered[p.cargo!.resource] ?? 0));
      const dropped = (handoff || !!p.cargo.unfinished) && this.dropCargo(p);
      p.reason = dropped ? '生产分工已改变，放下原料供其他工人接手'
        : '仓储已满或不可达，保留随身物资等待可用仓位';
      p.phase = 'idle';
      p.path = [];
      p.destination = null;
      return;
    }
    this.reserveStorage(p, p.cargo, best, null);
    this.go(p, best.stand, 'haul');
    p.reason = '运往仓储';
  }
  private take(p: Pawn, resource: Resource | undefined, amount: number, stackId: number) {
    const item = this.items.find(
      (i) =>
        this.itemTouch(p, i) &&
        (!resource || i.resource === resource) &&
        i.id === stackId,
    );
    if (!item || !this.pawnAllowed(p,item) || amount <= 0 || p.cargo || this.chunkReserved(item, p.id)) return false;
    const n = Math.min(amount, this.availableStack(item, p.id), carryLimit(item.resource));
    if (n <= 0) return false;
    p.cargo = portion(item, n);
    this.fetchReservations.delete(p.id);
    item.amount -= n;
    this.items = this.items.filter((i) => i.amount > 0);
    return true;
  }
  private consume(p: Pawn, batch: Cargo, available: number) {
    const resource = batch.resource;
    const nutrition = NUTRITION[resource];
    if (!nutrition) return 0;
    const amount =
      (resource === 'grain' || resource === 'meat' || resource === 'milk')
        ? Math.min(available, Math.ceil((100 - p.food) / (nutrition * 100)))
        : Math.min(1, available);
    p.food = Math.min(100, p.food + amount * nutrition * 100);
    this.stats.consumed[resource] += amount;
    this.stats.eaten += amount;
    if (amount > 0 && (resource === 'grain' || resource === 'meat')) remember(p.psyche, 'ateRaw', this.tick);
    const poisonChance = resource === 'milk' ? .02 : resource === 'meal' ? batch.poisonChance ?? 0 : 0;
    if (amount > 0 && poisonChance > 0 &&
        sanitationRandom(this.seed, p.id, this.tick, 26) < poisonChance) {
      p.foodPoisoning = exposeFoodPoisoning(p.foodPoisoning, this.tick);
      this.notice = `${p.name}吃过食物后出现中毒症状`;
    }
    return amount;
  }
  private tryFood(p: Pawn) {
    if (p.dead || p.downed || p.carriedBy !== null) return false;
    if (p.cargo && NUTRITION[p.cargo.resource]) {
      this.release(p);
      this.startDining(p);
      return true;
    }
    if (!this.items.some((i) => NUTRITION[i.resource])) return false;
    this.search(p);
    const food = (['meal', 'food', 'milk', 'grain', 'meat'] as Resource[])
      .map((r) => this.pileFor(p, r))
      .find(Boolean);
    if (!food) return false;
    this.release(p);
    const retainedCargo = !this.dropCargo(p);
    // Drop planning uses bounded navigation; restore the path tree to the food.
    this.search(p);
    p.eating = food.resource;
    this.fetchReservations.set(p.id, { sourceId: food.id, amount: Math.min(this.mealAmount(p, food), this.availableStack(food, p.id)) });
    this.go(p, this.reachableItemStand(food), 'fetch');
    p.reason = `${retainedCargo ? '无卸货空间，保留随身物资；' : ''}寻找${RESOURCE_NAMES[food.resource]}`;
    return true;
  }
  private mealAmount(p: Pawn, batch: Cargo) {
    return Math.min(batch.amount, batch.resource === 'grain' || batch.resource === 'meat' || batch.resource === 'milk'
      ? Math.max(1, Math.ceil((100 - p.food) / (NUTRITION[batch.resource]! * 100))) : 1);
  }
  private adjacentDiningTable(pos: Pos) {
    return this.tables.find(t => tableCells(t).some(q => q.z === pos.z && Math.abs(q.x - pos.x) + Math.abs(q.y - pos.y) === 1));
  }
  /** Only the picked physical batch is carried. The rare full-hands fallback
   * reserves food at the pawn's feet and leaves the other cargo intact. */
  private startDining(p: Pawn, ground?: Stack) {
    const batch = ground ?? p.cargo;
    if (!batch || !NUTRITION[batch.resource]) { this.release(p); return; }
    let chair: DiningChair | undefined, table: DiningTable | undefined;
    this.search(p);
    if (!ground) {
      const choices = this.chairs.flatMap(c => {
        const t = this.adjacentDiningTable(c), distance = this.distance[at(c)];
        if (!t || !this.pawnAllowed(p,c) || !this.pawnAllowed(p,t) || distance < 0 || distance > LIVING_RULES.maxSeatDistance || !this.canStop(c) || this.leisureReserved(p,c) ||
            this.fires.some(f => same(f, c)) || this.pawns.some(q => q !== p &&
              (same(q, c) || q.living.mealTask?.chairId === c.id))) return [];
        return [{ chair:c, table:t, distance }];
      }).sort((a,b) => a.distance - b.distance || a.chair.id - b.chair.id);
      chair = choices[0]?.chair; table = choices[0]?.table;
    }
    if (!chair && !ground && this.tryReturnToArea(p)) return;
    table ??= this.adjacentDiningTable(p);
    if (table && !this.pawnAllowed(p,table)) table = undefined;
    const target = chair ? {x:chair.x,y:chair.y,z:chair.z} : {x:p.x,y:p.y,z:p.z};
    const amount = Math.min(this.mealAmount(p, batch), ground ? this.availableStack(ground, p.id) : batch.amount);
    if (amount <= 0) { this.release(p); return; }
    this.fetchReservations.delete(p.id);
    p.living.mealTask = { stage: same(p,target) ? 'chew' : 'travel', chairId: chair?.id ?? null,
      tableId:table?.id ?? null, target, progress:0, sourceId:ground?.id ?? null, amount };
    p.eating = batch.resource;
    this.go(p, at(target), 'dine');
    if (same(p,target)) p.destination = null;
    p.workTarget = table ? tableCells(table).find(q => q.z === target.z && Math.abs(q.x-target.x)+Math.abs(q.y-target.y)===1)! : null;
    p.reason = chair ? '拿着餐食前往座位' : '原地进食';
  }
  private validDining(p: Pawn) {
    const task = p.living.mealTask;
    if (!task || !this.pawnAllowed(p,task.target) || p.dead || p.downed || p.drafted || p.carriedBy !== null || !this.canStop(task.target) ||
        this.fires.some(f => same(f,task.target))) return false;
    const batch = task.sourceId === null ? p.cargo : this.items.find(i => i.id === task.sourceId && this.itemTouch(p,i));
    if (!batch || (task.sourceId !== null && itemForbiddenTo(p,batch,this.tick)) ||
        batch.resource !== p.eating || !NUTRITION[batch.resource] || batch.amount < task.amount) return false;
    const table = this.tables.find(t => t.id === task.tableId);
    if (task.tableId !== null && (!table || !this.pawnAllowed(p,table) || !tableCells(table).some(q => q.z === task.target.z &&
      Math.abs(q.x-task.target.x)+Math.abs(q.y-task.target.y) === 1))) return false;
    if (task.chairId !== null && (!table || !this.chairs.some(c => c.id === task.chairId && same(c,task.target)) ||
      this.pawns.some(q => q !== p && q.living.mealTask?.chairId === task.chairId))) return false;
    return task.stage !== 'chew' || same(p,task.target);
  }
  private diningTick(p: Pawn) {
    const task = p.living.mealTask!;
    if (!this.validDining(p) || !same(p,task.target)) { this.release(p); return; }
    task.stage = 'chew'; p.destination = null;
    p.reason = task.chairId !== null ? '坐在餐椅上吃饭' : task.tableId !== null ? '站在桌边吃饭' : '没有餐桌，原地吃饭';
    task.progress += Math.max(.1, healthSummary(p).eating);
    if (task.progress < LIVING_RULES.chewTicks) return;
    const batch = task.sourceId === null ? p.cargo! : this.items.find(i => i.id === task.sourceId)!;
    const amount = this.consume(p, batch, task.amount);
    batch.amount -= amount;
    if (amount > 0) rememberMeal(p.living, this.livingRoomAt(p), this.tick, task.tableId !== null,
      batch.resource === 'meal' || batch.resource === 'food');
    if (task.sourceId === null && batch.amount === 0) p.cargo = null;
    this.items = this.items.filter(i => i.amount > 0);
    this.release(p); this.reconcileHealth(p); p.reason = '吃完饭了';
  }
  private arrive(p: Pawn) {
    if (p.phase === 'combat') {
      p.destination = null;
      return;
    }
    if (p.phase === 'weapon') {
      this.arriveWeapon(p);
      return;
    }
    if (p.phase === 'apparel') {
      this.arriveApparel(p);
      return;
    }
    const j = this.jobs.find((j) => j.id === p.jobId);
    if (p.phase === 'care') {
      this.arriveCare(p);
      return;
    }
    if (p.phase === 'sleepTravel') {
      const b = this.beds.find(
        (b) =>
          b.id === p.sleepBedId &&
          (b.owner === p.id || (b.medical && medicalNeedsRest(p))) &&
          same(b, p),
      );
      if (!b) {
        this.release(p);
        return;
      }
      p.phase = 'rest';
      p.sleepingSince = this.tick;
      p.reason = medicalNeedsRest(p) ? '卧床休养感染' : '在床上睡觉';
      return;
    }
    if (p.phase === 'fetch') {
      const reserved = this.fetchReservations.get(p.id);
      if (j?.unfinishedId !== undefined) {
        const source = this.items.find(i => i.id === reserved?.sourceId && i.unfinished?.id === j.unfinishedId);
        if (source && this.take(p, 'unfinished', 1, source.id)) this.continueUnfinished(p,j);
        else this.continueJob(p,j);
        return;
      }
      if (!j) {
        const food = this.items.find((i) => i.id === reserved?.sourceId && this.itemTouch(p,i) && i.resource === p.eating);
        if (!food || this.availableStack(food, p.id) <= 0) { this.release(p); return; }
        if (p.cargo && !this.dropCargo(p)) { this.startDining(p,food); return; }
        if (!this.take(p, food.resource, this.mealAmount(p, food), food.id)) { this.release(p); return; }
        this.startDining(p);
        return;
      }
      const needed = missing(j);
      const source = reserved && this.items.find(i => i.id === reserved.sourceId);
      if (needed && reserved && source && this.acceptsJobCargo(j, source, source) &&
        this.take(p, needed, Math.min(reserved.amount, (j.cost[needed] ?? 0) - (j.delivered[needed] ?? 0)), reserved.sourceId))
        this.deliverCargo(p);
      else this.continueJob(p, j);
      return;
    }
    if (p.phase === 'haul') {
      if (p.productionDelivery) { this.continueProductionDelivery(p); return; }
      if (p.cargo) {
        this.search(p);
        const reservation = this.storageReservations.get(p.id);
        const current = this.storageCells().find(s => at(s) === reservation?.cell && this.itemTouch(p,s) && s.accepts.includes(p.cargo!.resource));
        if (
          !current ||
          this.storageSpace(current, p.cargo, p.id) <= 0 ||
          this.storageDestination(p.cargo, current.priority, p.id)
        ) {
          this.deliverCargo(p);
          return;
        }
        const n = Math.min(p.cargo.amount, this.storageSpace(current, p.cargo, p.id));
        const plan = this.planPlacement(
          [{ batch: portion(p.cargo, n), origin: current, cells: [current] }],
          this.items,
          0,
          new Set(),
          p.id,
          undefined,
          false,
        )!;
        this.commitPlacement(plan);
        this.stats.hauled += n;
        p.cargo.amount -= n;
        if (!p.cargo.amount) p.cargo = null;
        this.release(p);
        if (p.cargo) this.deliverCargo(p);
      } else {
        this.search(p);
        const reservation = this.storageReservations.get(p.id);
        const item = this.items.find(
          (i) => this.itemTouch(p,i) && reservation?.sourceId === i.id,
        );
        const target = item && this.storageDestination(item, this.storagePriority(item), p.id);
        const n = item && target ? this.reserveStorage(p, item, target, item.id) : 0;
        if (item && n && this.take(p, item.resource, n, item.id)) {
          this.storageReservations.get(p.id)!.sourceId = null;
          this.deliverCargo(p);
        } else this.release(p);
      }
      return;
    }
    if (p.phase === 'travel') {
      this.release(p);
      p.reason = '已到达';
      return;
    }
    if (p.phase === 'work' && j) {
      const skillFailure = this.skillFailure(p, j);
      if (skillFailure) {
        j.reason = skillFailure;
        this.release(p);
        p.reason = skillFailure;
        return;
      }
      if (!this.stands(j).includes(at(p))) {
        this.continueJob(p, j);
        return;
      }
      if (j.unfinishedId !== undefined) {
        if (p.cargo?.unfinished?.id === j.unfinishedId) {
          const plan = this.planPlacement([{ batch:p.cargo, origin:p, cells:this.unfinishedPlacementCells(p) }]);
          if (!plan) { j.reason = '工作位置没有未完成品放置空间'; this.release(p); return; }
          this.commitPlacement(plan); p.cargo = null;
        }
        const item = this.items.find(i => i.unfinished?.id === j.unfinishedId);
        if (!item || item.forbidden || item.unfinished!.creatorId !== p.id || !this.unfinishedWorkTouch(p,item)) {
          this.continueUnfinished(p,j); return;
        }
      }
      if (p.cargo) {
        const resource = p.cargo.resource,
          needed = (j.cost[resource] ?? 0) - (j.delivered[resource] ?? 0);
        if (needed <= 0 || !this.acceptsJobCargo(j,p.cargo)) {
          this.deliverCargo(p);
          return;
        }
        const n = Math.min(p.cargo.amount, needed);
        this.deliverBatch(j, p.cargo, n);
        j.delivered[resource] = (j.delivered[resource] ?? 0) + n;
        p.cargo.amount -= n;
        if (p.cargo.amount === 0) p.cargo = null;
      }
      if (missing(j)) {
        this.continueJob(p, j);
        return;
      }
      if (j.kind === 'research') {
        if (!this.supported(j)) {
          this.cancel(j);
          return;
        }
        const project = j.researchProject!,
          bench = this.researchBenches.find((b) => same(b, j))!;
        const cost = RESEARCH_DEFS[project].cost;
        // Native order: gain points with the current stat, then learn Intellectual.
        this.research.progress[project] = Math.min(
          cost,
          this.research.progress[project] +
            researchPointsPerTick(
              p.skills,
              healthSummary(p).manipulation,
              this.researchBenchFactor(bench),
              healthSummary(p).sight,
            ),
        );
        learnSkill(p.skills.intellectual, jobXP('research'));
        j.workTicks++;
        j.progress++;
        p.reason = '正在研究' + RESEARCH_DEFS[project].name;
        if (researchComplete(this.research, project)) {
          this.research.current = null;
          for (const other of [...this.jobs]) if (other.kind === 'research') this.cancel(other);
          this.notice = `研究完成：${RESEARCH_DEFS[project].name}`;
          this.revision++;
        } else if (j.progress >= j.work) this.cancel(j);
        return;
      }
      if (j.kind === 'smith' || j.kind === 'armorsmith') {
        const bench = this.weaponBenches.find((b) => same(b, j))!;
        if (bench.kind === 'machining' && (!bench.power?.on || !bench.power.powered)) {
          j.reason = '机械加工台供电中断，保留原料和进度';
          this.release(p);
          return;
        }
        if (bench.kind === 'smithy') {
          if (j.progress < j.work && bench.fuel <= 0) {
            j.reason = '缺少燃料，保留加工进度';
            this.release(p);
            return;
          }
          if (j.progress < j.work) bench.fuel = Math.max(0, bench.fuel - SMITHY_FUEL_PER_TICK);
        }
      }
      if (!this.createUnfinished(p, j)) return;
      p.reason = '正在' + JOB_NAMES[j.kind];
      const cutting =
        j.kind === 'cut' && !j.legacyCut ? this.trees.find((t) => same(t, j)) : undefined;
      if (j.progress < j.work) {
        j.workTicks++;
        if (j.kind === 'cook') {
          const credit = j.cookTraining!.find((c) => c.pawnId === p.id);
          if (credit) credit.ticks++;
          else j.cookTraining!.push({ pawnId: p.id, ticks: 1 });
        } else {
          const skill = jobSkill(j.kind);
          const tree = j.kind === 'cut' ? this.trees.find((t) => same(t, j)) : undefined;
          const eligible =
            j.kind === 'cut'
              ? !!tree && tree.growth > TREE_DATA[tree.species].minGrowth && tree.health > 0
              : j.kind === 'remove'
                ? this.weaponBenchAt(j)?.kind !== 'craftingSpot'
                : true;
          if (skill && eligible) learnSkill(p.skills[skill], jobXP(j.kind));
        }
        const previousProgress = j.progress;
        const workDelta = (j.weaponBenchKind === 'machining'
              ? machiningWorkFactor(this.rooms.roomAt(j)?.outdoor ?? true, this.temperature(j))
              : 1) *
              (cutting ? treeWorkSpeed(cutting.growth) : 1) *
              (j.material === 'stone' && ['wall', 'floor'].includes(j.kind) ? 0.8 : 1) *
              workSpeed(p.skills, j.kind, healthSummary(p).manipulation, healthSummary(p).sight);
        if (p.faction === 'colony' && isFailableConstruction(j)) {
          const capability = healthSummary(p);
          const risk = constructionFailureChance(constructionSuccessChance(p.skills,capability.manipulation,capability.sight),workDelta,j.work);
          if (constructionRandom(this.seed,j.id,j.workTicks,p.id) < risk) {
            this.failConstruction(p,j);
            return;
          }
        }
        j.progress = Math.min(j.work, j.progress + workDelta);
        if (j.kind === 'mine' || j.kind === 'digLadder')
          j.miningYieldWork! +=
            (j.progress - previousProgress) *
            miningYield(p.skills, healthSummary(p).manipulation, healthSummary(p).sight);
      }
      if (j.progress >= j.work) {
        this.lockWorkOutcome(p, j);
        this.syncUnfinishedProgress(j);
        this.finish(p, j);
      } else this.syncUnfinishedProgress(j);
    }
  }
  private lockWorkOutcome(p: Pawn, j: Job) {
    if ((j.kind === 'cut' || j.kind === 'harvest') && !j.harvestResult) {
      const tree = j.kind === 'cut' ? this.trees.find((t) => same(t, j)) : undefined;
      const crop = j.kind === 'harvest' ? this.crops.find((c) => same(c, j)) : undefined;
      const base = tree ? treeYield(tree, this.seed) : crop ? CROPS[crop.kind].yield : 0;
      const factor = plantYield(p.skills, healthSummary(p).manipulation, healthSummary(p).sight);
      const fails = j.kind === 'harvest' && plantRandom(this.seed, j.id, p.id, 4702) > factor;
      const exact = fails ? 0 : base * Math.max(1, factor);
      j.harvestResult = {
        amount: Math.floor(exact) + (plantRandom(this.seed, j.id, p.id, 4703) < exact % 1 ? 1 : 0),
        skill: p.skills.plants.level,
        workerId: p.id,
      };
    }
    if (
      j.productQuality ||
      !(
        j.kind === 'tailoring' ||
        j.kind === 'armorsmith' ||
        (j.kind === 'smith' && WEAPON_DEFS[j.weaponKind!].hasQuality)
      )
    )
      return;
    // A stable, per-job random stream is an adaptation of the original global
    // RNG. Saving or retrying a blocked output never changes a completed roll.
    let draw = 0;
    const skill = p.skills.crafting.level;
    j.productQuality = {
      value: craftedQuality(skill, () => plantRandom(this.seed ^ (j.unfinishedId ?? j.id), p.id, ++draw, 4701)),
      skill,
      workerId: p.id,
    };
  }
  /** Roll only after all placement and material checks have committed. The
   * colonist completing construction supplies the skill. A per-job draw stream
   * keeps save/reload independent of unrelated simulation and rendering work. */
  private finishedFurnitureQuality(p: Pawn, j: Job) {
    let draw = 0;
    return craftedQuality(p.skills.construction.level,
      () => plantRandom(this.seed ^ j.id, p.id, ++draw, 33001));
  }
  private finishRelocation(p: Pawn, j: Job) {
    const kind = j.furnitureKind!, id = j.furnitureId!;
    const wait = (message: string) => { j.reason = message; this.release(p); };
    const cells = this.furnitureCells(kind,j,j.axis!);
    if (this.fires.some(f => cells.some(q => same(f,q)))) { wait('家具或安装位置正在燃烧，等待灭火'); return; }
    if (j.kind === 'uninstall') {
      const original = this.installedFurniture(kind,id);
      if (!original) { this.cancel(j); return; }
      const damage = this.fireDamage.find(d => d.kind === kind && d.targetId === id);
      const piece = makeFurniturePiece(kind,original,damage?.hitPoints);
      const packed: Cargo = { resource:'furniture',amount:1,furniture:piece };
      const plan = 'settings' in original ? this.planShelfRemoval(original,[packed]) :
        this.withoutFurniture(kind,id,() => this.planPlacement([{batch:packed,origin:original}]));
      if (!plan) { wait('卸下后没有附近可达落点，保留原家具等待清理'); return; }
      if (kind === 'bed') this.invalidatePrisonBed(original as Bed);
      for (const pawn of this.pawns) if ((damage && pawn.repairTask?.damageKey === damage.key) ||
          pawn.living.mealTask?.tableId === id || pawn.living.mealTask?.chairId === id ||
          (pawn.psyche.recreation?.kind === 'social' && (pawn.psyche.recreation.spotId === id ||
            (kind === 'chair' && same(pawn.psyche.recreation.target,original))))) this.release(pawn);
      if ('settings' in original) { this.releaseShelfUsers(original); this.shelves = this.shelves.filter(s=>s.id!==id); }
      else if (kind === 'bed') this.beds = this.beds.filter(b => b.id !== id);
      else if (kind === 'table') this.tables = this.tables.filter(b => b.id !== id);
      else this.chairs = this.chairs.filter(b => b.id !== id);
      this.fireDamage = this.fireDamage.filter(d => !(d.kind === kind && d.targetId === id));
      this.rebuildDevices(); this.commitPlacement(plan); this.stats.produced.furniture++;
      this.notice = isShelfKind(kind) ? '货架已卸下，货物留在附近；收纳设置与耐久保留' : '家具已完整卸下，品质和耐久保留；可搬入仓储或重装';
    } else {
      const batch = j.deliveredBatches.find(b => b.furniture?.id === id && b.furniture.kind === kind);
      if (!batch?.furniture) { wait('等待指定的原家具送达，不会改用其他家具'); return; }
      const reason = this.placementReason(kind,j,j.axis);
      if (reason) { wait(reason); return; }
      if ([...this.pawns,...this.animals].some(actor => cells.some(q => same(actor,q)))) {
        wait('重装位置被人物或动物占用，等待腾空'); return;
      }
      const piece = batch.furniture;
      const entity = furnitureFromPiece(piece,j,j.axis);
      if (piece.kind === 'bed') {
        this.updateRooms();
        const room = this.rooms.roomAt(j);
        const prison = !!room && !room.outdoor && this.beds.some(b => b.prisoner && this.rooms.roomAt(b)?.id === room.id);
        const bed = entity as Bed;
        bed.prisoner = prison;
        if (!prison && piece.owner !== null && this.pawns.some(q => q.id === piece.owner && !q.dead && q.faction === 'colony') &&
            !this.beds.some(b => b.owner === piece.owner)) bed.owner = piece.owner;
      }
      const old = {beds:this.beds,tables:this.tables,chairs:this.chairs,shelves:this.shelves};
      if (isShelfKind(kind)) this.shelves = [...this.shelves,entity as Shelf];
      else if (kind === 'bed') this.beds = [...this.beds,entity as Bed];
      else if (kind === 'table') this.tables = [...this.tables,entity as DiningTable];
      else this.chairs = [...this.chairs,entity as DiningChair];
      this.rebuildDevices();
      const rollback = (message: string) => { Object.assign(this,old); this.rebuildDevices(); wait(message); };
      if ([...this.pawns,...this.animals].some(q => !this.standable(q) || (isShelfKind(kind) && cells.some(c=>same(c,q))))) { rollback('家具会占用人物或动物的位置，等待腾空'); return; }
      this.search(p);
      const displaced = this.items.filter(item => !this.groundAllowed(item) || (this.shelfAt(item) && !shelfAllows(item)));
      const plan = this.planPlacement(displaced.map(item => ({batch:item,origin:item,
        cells:horizontal.map(([dx,dy])=>({x:item.x+dx,y:item.y+dy,z:item.z})).filter(q=>inside(q)&&this.distance[at(q)]>=0)})),
        this.items.filter(item=>!displaced.includes(item)),DROP_DISTANCE,new Set(cells.map(at)));
      if (!plan) { rollback('目标物资没有相邻落地空间，保留原家具等待清理'); return; }
      this.commitPlacement(plan);
      if (piece.hitPoints < relocationMaxHP(kind))
        this.fireDamage.push({key:fireDamageKey(kind,id,j),kind,targetId:id,x:j.x,y:j.y,z:j.z,
          hitPoints:piece.hitPoints,maxHitPoints:relocationMaxHP(kind)});
      this.stats.consumed.furniture++;
      this.notice = isShelfKind(kind) ? '原货架已重装，保留收纳设置与耐久' : '原家具已重装，保留品质与耐久；需要时可重新设置床的用途';
    }
    this.jobs = this.jobs.filter(k => k.id !== j.id);
    this.release(p); this.roomsDirty = true; this.changed(j); this.pruneFilth(); this.reconcileFireState();
  }
  private finishShelf(p: Pawn, j: Job) {
    const wait = (reason: string) => { j.reason=reason; this.release(p); };
    if (j.kind === 'remove') {
      const shelf = this.shelfAt(j); if (!shelf) { this.cancel(j); return; }
      const refund = Math.floor(SHELF_DEFS[shelf.kind].cost.wood/2);
      const plan = this.planShelfRemoval(shelf,[freshBatch('wood',refund)]);
      if (!plan) { wait('附近没有足够的散货空间，保留货架及全部货物等待清理'); return; }
      this.releaseShelfUsers(shelf); this.shelves=this.shelves.filter(s=>s.id!==shelf.id);
      this.rebuildDevices(); this.tradeApplyPlacement(plan); this.stats.produced.wood+=refund;
    } else if (isShelfKind(j.kind)) {
      const reason=this.placementReason(j.kind,j,j.axis); if(reason){wait(reason);return;}
      const shelf: Shelf={id:j.id,kind:j.kind,x:j.x,y:j.y,z:j.z,axis:j.axis ?? 'x',settings:structuredClone(j.storageSettings!)};
      const cells=new Set(shelfCells(shelf).map(at));
      if ([...this.pawns,...this.animals].some(a=>cells.has(at(a)))) {wait('货架占地有人或动物，等待离开');return;}
      const previous=this.shelves;
      this.shelves=[...previous,shelf]; this.rebuildDevices();
      const displaced=this.items.filter(i=>cells.has(at(i))&&!shelfAllows(i));
      const plan=this.planPlacement(displaced.map(batch=>({batch,origin:batch,sourceId:batch.id})),this.items.filter(i=>!displaced.includes(i)),DROP_DISTANCE,cells);
      if(!plan){this.shelves=previous;this.rebuildDevices();wait('原位置物品没有附近落点，等待清理');return;}
      this.releaseShelfUsers(shelf); this.tradeApplyPlacement(plan);
      for(const r of resources)this.stats.consumed[r]+=j.delivered[r]??0;
      this.stats.built++;
      this.finishFrameDamage(j);
    }
    this.jobs=this.jobs.filter(k=>k.id!==j.id); this.release(p);
    this.roomsDirty=true;this.changed(j);this.pruneStorageSpills();this.reconcileFireState();this.reconcileRelocationJobs();
  }
  private finish(p: Pawn, j: Job) {
    const unfinished = j.unfinishedId === undefined ? undefined : this.unfinishedCargo(j.unfinishedId)?.unfinished;
    if (j.unfinishedId !== undefined && !unfinished) { this.cancel(j); return; }
    if (j.cancelled || j.constructionFailure || !this.pawnAllowed(p,j)) {
      this.release(p);
      return;
    }
    if (j.kind === 'uninstall' || j.kind === 'install') { this.finishRelocation(p,j); return; }
    if (isShelfKind(j.kind) || (j.kind === 'remove' && this.shelfAt(j))) { this.finishShelf(p,j); return; }
    if (j.kind === 'fence' && [...this.pawns,...this.animals].some(a=>same(a,j))) {
      j.reason='围栏位置被占用，等待人物或动物离开';this.release(p);return;
    }
    if (j.kind === 'plantTree' && !this.treeCanAppear(j, j.treeSpecies!, j.id)) {
      j.reason = '树苗会阻挡人物、工作位置或唯一通路，等待位置腾空';
      this.release(p);
      return;
    }
    const devicePlan =
      j.kind === 'table' ? tableCells({ ...j, axis: j.axis ?? 'x' }) : j.kind === 'researchBench'
        ? researchBenchCells({ ...j, axis: j.axis ?? 'x' })
        : j.kind === 'stonecutter' ||
            j.kind === 'tailor' ||
            j.kind === 'smithy' ||
            j.kind === 'machining'
          ? stonecutterCells({ ...j, axis: j.axis ?? 'x' })
          : isDeviceKind(j.kind)
            ? deviceCells({ ...j, kind: j.kind, axis: j.axis ?? 'x' })
            : [];
    const changes: { pos: Pos; block?: number; ladder?: number }[] = [];
    const yields: Partial<Counts> = {};
    let harvestedCrop: CropKind | undefined;
    const reward = (b: number, p: Pos) => {
      const resource =
        b === Block.Steel
          ? 'steel'
          : b === Block.Components
            ? 'components'
            : b === Block.Stone
              ? 'chunk'
              : null;
      if (resource)
        yields[resource] =
          (yields[resource] ?? 0) +
          (resource === 'chunk'
            ? naturalChunkDrop(this.seed, p)
            : (() => {
                const exact = ((resource === 'steel' ? 40 : 2) * j.miningYieldWork!) / j.work;
                return Math.max(
                  1,
                  Math.floor(exact) +
                    (plantRandom(this.seed ^ j.id, p.x, p.y, p.z + 4704) < exact % 1 ? 1 : 0),
                );
              })());
    };
    if (j.kind === 'mine' || j.kind === 'digLadder') {
      for (const z of j.kind === 'mine' ? [j.z, j.z + 1] : [j.z]) {
        const q = { x: j.x, y: j.y, z },
          b = this.blocks[at(q)];
        if (b === Block.Bedrock || b === Block.Wood || b === Block.Masonry) continue;
        if (b) {
          reward(b, q);
          changes.push({ pos: q, block: 0 });
        }
      }
      if (j.kind === 'digLadder') changes.push({ pos: j, ladder: 1 });
    } else if (j.kind === 'floor' || j.kind === 'bridge')
      changes.push({
        pos: { ...j, z: j.z - 1 },
        block: j.material === 'stone' ? Block.Masonry : Block.Wood,
      });
    else if (j.kind === 'wall')
      for (const z of [j.z, j.z + 1])
        changes.push({
          pos: { ...j, z },
          block: j.material === 'stone' ? Block.Masonry : Block.Wood,
        });
    else if (j.kind === 'ladder') changes.push({ pos: j, ladder: 1 });
    else if (j.kind === 'remove') {
      const device = this.deviceAt(j);
      if (this.fenceAt(j) || this.gateAt(j) || this.markerAt(j)) {
        const kind = this.fenceAt(j) ? 'fence' : this.gateAt(j) ? 'fenceGate' : 'penMarker';
        yields.wood = Math.floor(PEN_BUILDINGS[kind].cost.wood / 2);
      } else if (device) {
        for (const [r, n] of Object.entries(DEVICE_COSTS[device.kind]))
          yields[r as Resource] = Math.floor(n / 2);
        if (device.kind === 'generator') yields.wood = Math.floor(device.fuel);
      } else if (this.researchBenchAt(j)) {
        yields.wood = Math.floor(RESEARCH_BENCH_COST.wood / 2);
        yields.steel = Math.floor(RESEARCH_BENCH_COST.steel / 2);
      } else if (this.weaponBenchAt(j)) {
        const bench = this.weaponBenchAt(j)!;
        if (bench.kind === 'smithy') {
          yields.steel = 50;
          yields.wood = Math.floor(bench.fuel);
        } else if (bench.kind === 'machining') {
          yields.steel = 75;
          yields.components = 2;
        }
      } else if (this.tableAt(j)) {
        yields.wood = Math.floor(LIVING_BUILDINGS.table.cost.wood / 2);
      } else if (this.chairs.some(c => same(c, j))) {
        yields.wood = Math.floor(LIVING_BUILDINGS.chair.cost.wood / 2);
      } else if (this.horseshoePins.some(b => same(b, j))) {
        yields.wood = Math.floor(HORSESHOE_COST.wood / 2);
      } else if (this.sandbags.some((b) => same(b, j))) {
        yields.cloth = 2;
      } else if (this.tailorAt(j)) {
        yields.wood = Math.floor(TAILOR_COST.wood! / 2);
      } else if (this.stonecutterAt(j)) {
        for (const [resource, n] of Object.entries(STONECUTTER_COST))
          yields[resource as Resource] = Math.floor(n / 2);
      } else if (this.wires.some((w) => same(w, j))) {
        yields.steel = 1;
      } else if (this.bedAt(j)) {
        yields.wood = 22;
      } else if (this.doors.some((d) => same(d, j))) {
        yields.wood = 12;
      } else if (this.stoves.some((s) => same(s, j))) {
        yields.wood = 10;
      } else if (this.butcherSpots.some(b => same(b, j))) {
        // Ground designation has no construction materials to refund.
      } else if (this.ladders[at(j)]) {
        changes.push({ pos: j, ladder: 0 });
        yields.wood = 1;
      } else {
        const start = [Block.Wood, Block.Masonry].includes(this.blocks[at(j)] as 4 | 7)
          ? j.z
          : j.z - 1;
        for (const z of start === j.z ? [start, start + 1] : [start]) {
          const block = this.blocks[index(j.x, j.y, z)];
          if (block === Block.Wood || block === Block.Masonry) {
            changes.push({ pos: { ...j, z }, block: 0 });
            const resource = block === Block.Masonry ? 'stone' : 'wood';
            yields[resource] = (yields[resource] ?? 0) + (this.bridges[index(j.x,j.y,z)] ? Math.floor(WATER_RULES.bridgeWood / 2) : resource === 'stone' ? 2 : 1);
          }
        }
      }
    }
    if (!this.supported(j)) {
      j.reason = '支撑已改变，等待恢复';
      this.release(p);
      return;
    }
    // Determine every output before mutating its physical source. A full local
    // floor keeps the tree, ore, crop or delivered recipe intact for a retry.
    if (j.kind === 'cut') {
      yields.wood = j.harvestResult!.amount;
    }
    if (j.kind === 'harvest') {
      harvestedCrop = this.crops.find((c) => same(c, j))!.kind;
      yields[
        harvestedCrop === 'cotton' ? 'cloth' : harvestedCrop === 'healroot' ? 'herb' : 'grain'
      ] = j.harvestResult!.amount;
    }
    if (j.kind === 'cook') {
      yields.meal = SIMPLE_MEAL.output;
      const cleanliness = this.cleanlinessAt(p), room = this.rooms.roomAt(p);
      j.cookingOutcome ??= cookingOutcome(this.seed, j.id, p.id, p.skills.cooking.level, cleanliness, !room || room.outdoor);
    }
    if (j.kind === 'butcher') {
      const carcass = j.deliveredBatches.find(b => b.resource === 'carcass')?.carcass;
      if (!carcass) { j.reason = '等待新鲜动物尸体'; this.release(p); return; }
      yields.meat = ANIMAL_DEFS[carcass.species].meat;
    }
    if (j.kind === 'stonecut') yields.stone = STONECUTTING.output;
    if (j.kind === 'tailoring' || j.kind === 'armorsmith') yields.apparel = 1;
    if (j.kind === 'smith') yields.weapon = 1;
    const previous = changes.map((c) => ({
      i: at(c.pos),
      block: this.blocks[at(c.pos)],
      ladder: this.ladders[at(c.pos)],
    }));
    const supportedItems = this.items.filter((i) => this.standable(i));
    // Demolition must not strand an otherwise supported upper platform. Preserve
    // existing access to the camp for people and loose goods, not just foot support.
    const exit = this.stockpiles.find((q) => this.standable(q)) ?? this.spawn;
    let mustKeepExit: Pos[] = [];
    if (j.kind === 'remove' && changes.length && this.standable(exit)) {
      this.search(exit);
      mustKeepExit = [...this.pawns, ...supportedItems].filter((q) => this.distance[at(q)] >= 0);
    }
    const rollback = (reason: string) => {
      if (j.kind === 'stove') this.stoveCells.delete(at(j));
      if (devicePlan.length) this.rebuildDevices();
      for (let i = previous.length - 1; i >= 0; i--) {
        const c = previous[i];
        this.blocks[c.i] = c.block;
        this.ladders[c.i] = c.ladder;
      }
      j.reason = reason;
      this.release(p);
    };
    for (const c of changes) {
      if (c.block !== undefined) this.blocks[at(c.pos)] = c.block;
      if (c.ladder !== undefined) this.ladders[at(c.pos)] = c.ladder;
    }
    if (j.kind === 'stove') this.stoveCells.add(at(j));
    for (const q of devicePlan) {
      this.deviceBlocks.add(at(q));
      this.deviceBlocks.add(at({ ...q, z: q.z + 1 }));
    }
    if (
      [...this.pawns, ...this.animals].some((p) => !this.standable(p)) ||
      this.stockpiles.some((s) => !this.standable(s) || this.ladders[at(s)]) ||
      [...this.stoves, ...this.horseshoePins, ...this.butcherSpots, ...this.weaponBenches.filter((b) => b.kind === 'craftingSpot')].some(
        (s) =>
          !this.blocks[at(s) - WIDTH * DEPTH] ||
          this.blocks[at(s)] ||
          this.blocks[at(s) + WIDTH * DEPTH],
      ) ||
      [
        ...this.tables.flatMap(tableCells), ...this.chairs, ...this.shelves.flatMap(shelfCells),
        ...this.beds.flatMap(bedCells),
        ...this.sandbags,
        ...this.doors, ...this.fences, ...this.fenceGates, ...this.penMarkers,
        ...this.devices.flatMap(deviceCells),
        ...this.stonecutters.flatMap(stonecutterCells),
        ...this.tailors.flatMap(tailorCells),
        ...this.researchBenches.flatMap(researchBenchCells),
        ...this.weaponBenches.filter((b) => b.kind !== 'craftingSpot').flatMap(weaponBenchCells),
      ].some(
        (s) =>
          !this.blocks[at(s) - WIDTH * DEPTH] ||
          this.blocks[at(s)] ||
          this.blocks[at(s) + WIDTH * DEPTH],
      )
    ) {
      rollback('有人占用或依赖这处支撑，请先移开人物');
      return;
    }
    if (mustKeepExit.length) {
      this.search(exit);
      if (!this.standable(exit) || mustKeepExit.some((q) => this.distance[at(q)] < 0)) {
        rollback('拆除会切断人物或物资返回营地的通路，请从远端逐步拆除');
        return;
      }
    }
    // Construction nudges loose stacks one horizontal cell, never buries them or
    // silently teleports them to distant storage. Validate every displacement before committing.
    const forbidden = new Set(
      j.kind === 'bed'
        ? bedCells({ ...j, axis: j.axis ?? 'x' }).map(at)
        : j.kind === 'sandbag' || j.kind === 'fence' || j.kind === 'chair'
          ? [at(j)]
          : [],
    );
    const displaced: { batch: Cargo; origin: Pos; cells: Pos[] }[] = [];
    const displacedIds = new Set<number>();
    this.search(p);
    for (const item of supportedItems)
      if (!this.groundAllowed(item) || forbidden.has(at(item))) {
        const cells = horizontal
          .map(([dx, dy]) => ({ x: item.x + dx, y: item.y + dy, z: item.z }))
          .filter((q) => inside(q) && this.distance[at(q)] >= 0);
        displaced.push({ batch: item, origin: item, cells });
        displacedIds.add(item.id);
      }
    const output = Object.entries(yields)
      .filter(([, n]) => n > 0)
      .map(([resource, n]) => ({
        batch:
          resource === 'weapon'
            ? {
                resource: 'weapon' as const,
                amount: 1,
                weapon: makeWeapon(j.id, j.weaponKind!, j.productQuality?.value ?? 2),
              }
            : resource === 'apparel'
              ? {
                  resource: 'apparel' as const,
                  amount: 1,
                  apparel: makeApparel(j.id, j.apparelKind!, j.productQuality!.value, j.cost.alpacaWool ? 'alpacaWool' : undefined),
                }
              : freshBatch(
                  resource as Resource,
                  n,
                  resource === 'grain' && harvestedCrop !== 'cotton' && harvestedCrop !== 'healroot'
                    ? harvestedCrop
                    : undefined,
                ),
        origin: p,
      }));
    for (const entry of output) if (entry.batch.resource === 'meal' && j.cookingOutcome)
      (entry.batch as Cargo).poisonChance = j.cookingOutcome.poisonChance;
    const baseItems = this.items.filter(i => !displacedIds.has(i.id) && (j.unfinishedId === undefined || i.unfinished?.id !== j.unfinishedId));
    const completedProductionBill = this.productionBillFor(j);
    let productionDelivery: { batch: Cargo; task: ProductionDelivery } | undefined;
    const floorOutput = output.map(entry => ({...entry, batch:entry.batch as Cargo}));
    if (completedProductionBill && completedProductionBill.output.mode !== 'drop' && floorOutput.length && !p.cargo) {
      const option = completedProductionBill.output, first = floorOutput[0];
      const allowed = option.mode === 'specific' ? new Set(productionOutputTargetCells(this, option.target!)) : undefined;
      this.search(p);
      const target = this.storageDestination(first.batch, -1, p.id, allowed, baseItems);
      if (target) {
        const amount = Math.min(first.batch.amount, carryLimit(first.batch.resource),
          this.storageSpace(target, first.batch, p.id, this.storageContext(baseItems, p.id)));
        if (amount > 0) {
          productionDelivery = { batch:portion(first.batch, amount), task:{
            billId:completedProductionBill.id, recipe:completedProductionBill.recipe, mode:option.mode === 'specific' ? 'specific' : 'best',
            target:structuredClone(option.target), cell:at(target), state:'carrying',
          } };
          floorOutput.splice(0, 1, ...(amount < first.batch.amount
            ? [{...first,batch:portion(first.batch, first.batch.amount - amount)}] : []));
        }
      }
    }
    const placement = this.planPlacement(
      [...displaced, ...floorOutput],
      baseItems,
      DROP_DISTANCE,
      forbidden,
      p.id,
      productionDelivery ? {cell:productionDelivery.task.cell,batch:productionDelivery.batch} : undefined,
    );
    if (!placement) {
      rollback(
        displaced.length
          ? '散落物资无相邻空位或容量，请先搬走再施工'
          : '产物没有附近可达落地空间，保留原料等待清理',
      );
      return;
    }
    this.commitPlacement(placement);
    if (j.kind === 'butcher') this.addFilth('butcher', p, SANITATION_RULES.butcherLayers);
    // Identity is committed only after all support, access and item-placement
    // checks succeed. A failed build never leaves valued phantom structures.
    for (const c of changes) if (c.block !== undefined) {
      this.structureKinds[at(c.pos)] = !c.block ? 0 : j.kind === 'floor' || j.kind === 'bridge' ? 1 : j.kind === 'wall' ? (c.pos.z === j.z ? 2 : 3) : 0;
      this.bridges[at(c.pos)] = c.block && j.kind === 'bridge' ? 1 : 0;
    }
    // Project tasks can be resumed by another cook; reward each actual worker
    // only after the physical meal exists. Cancellation and blocked retries pay nothing.
    if (j.kind === 'cook')
      for (const credit of j.cookTraining!) {
        const cook = this.pawns.find((p) => p.id === credit.pawnId && !p.dead);
        if (cook) learnSkill(cook.skills.cooking, credit.ticks * jobXP('cook'));
      }
    if (j.kind === 'cut') {
      const tree = this.trees.find((t) => same(t, j));
      if (tree) {
        this.trees = this.trees.filter((t) => t.id !== tree.id);
        this.rebuildTrees();
        this.skyCache.clear();
        this.revision++;
        this.stats.cut++;
      }
    }
    if (j.kind === 'plantTree') this.createTree(j, j.treeSpecies!, true);
    if (j.kind === 'fence' || j.kind === 'fenceGate' || j.kind === 'penMarker') {
      const base = {id:this.id(),x:j.x,y:j.y,z:j.z};
      if (j.kind === 'fence') this.fences.push(base);
      else if (j.kind === 'fenceGate') this.fenceGates.push({...base,axis:j.axis ?? 'x',mode:'auto',openUntil:0});
      else this.penMarkers.push({...base,name:`圈地 ${this.penMarkers.length+1}`,filter:initialPenFilter()});
      this.revision++;
    } else if (j.kind === 'remove' && (this.fenceAt(j) || this.gateAt(j) || this.markerAt(j))) {
      const marker = this.markerAt(j);
      if (marker) removePenMarker(this,marker.id);
      this.fences = this.fences.filter(f=>!same(f,j)); this.fenceGates = this.fenceGates.filter(g=>!same(g,j));
      cancelAnimalRopes(this); this.revision++;
    }
    if (j.kind === 'researchBench') {
      this.researchBenches.push({ id: this.id(), x: j.x, y: j.y, z: j.z, axis: j.axis ?? 'x' });
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'remove' && this.researchBenchAt(j)) {
      const bench = this.researchBenchAt(j)!;
      for (const job of [...this.jobs])
        if (job.kind === 'research' && same(job, bench)) this.cancel(job);
      this.researchBenches = this.researchBenches.filter((b) => b.id !== bench.id);
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'sandbag') {
      this.sandbags.push({ id: this.id(), x: j.x, y: j.y, z: j.z, hitPoints: SANDBAG_HP });
      this.revision++;
    } else if (j.kind === 'remove' && this.sandbags.some((b) => same(b, j))) {
      this.sandbags = this.sandbags.filter((b) => !same(b, j));
      this.revision++;
    } else if (j.kind === 'smithy' || j.kind === 'machining') {
      this.weaponBenches.push(makeWeaponBench(this.id(), j.kind, j, j.axis ?? 'x'));
      this.rebuildDevices();
      this.powerDirty = true;
      this.revision++;
    } else if (j.kind === 'smith') {
      this.stats.weaponsMade++;
    } else if (j.kind === 'remove' && this.weaponBenchAt(j)) {
      const bench = this.weaponBenchAt(j)!;
      this.weaponBenches = this.weaponBenches.filter((b) => b.id !== bench.id);
      this.powerDirty = true;
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'tailor') {
      this.tailors.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        axis: j.axis ?? 'x',
        bills: TAILOR_KINDS.map((kind) => ({ kind, target: 0, paused: false })),
      });
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'tailoring' || j.kind === 'armorsmith') {
      this.stats.tailored++;
    } else if (j.kind === 'remove' && this.tailorAt(j)) {
      const bench = this.tailorAt(j)!;
      this.tailors = this.tailors.filter((b) => b.id !== bench.id);
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'stonecutter') {
      this.stonecutters.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        axis: j.axis ?? 'x',
        target: 80,
        paused: false,
      });
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'stonecut') {
      this.stats.stonecut++;
    } else if (j.kind === 'remove' && this.stonecutterAt(j)) {
      const bench = this.stonecutterAt(j)!;
      this.stonecutters = this.stonecutters.filter((b) => b.id !== bench.id);
      this.rebuildDevices();
      this.revision++;
    } else if (isDeviceKind(j.kind)) {
      this.devices.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        kind: j.kind,
        axis: j.axis ?? 'x',
        on: true,
        fuel: 0,
        energy: 0,
        target: 21,
        powered: false,
        active: false,
        networkId: null,
        watts: 0,
        reason: '等待接入电网',
      });
      this.rebuildDevices();
      this.powerDirty = true;
      this.roomsDirty = true;
      this.revision++;
    } else if (j.kind === 'wire') {
      if (!this.wires.some((w) => same(w, j))) this.wires.push({ x: j.x, y: j.y, z: j.z });
      this.powerDirty = true;
      this.revision++;
    } else if (j.kind === 'refuel') {
      const bench = this.weaponBenchAt(j);
      if (bench?.kind === 'smithy') bench.fuel = Math.min(50, bench.fuel + (j.delivered.wood ?? 0));
      else {
        const device = this.deviceAt(j)!;
        device.fuel = Math.min(75, device.fuel + (j.delivered.wood ?? 0));
      }
    } else if (j.kind === 'remove' && this.deviceAt(j)) {
      const device = this.deviceAt(j)!;
      this.devices = this.devices.filter((d) => d.id !== device.id);
      this.rebuildDevices();
      this.powerDirty = true;
      this.roomsDirty = true;
      this.revision++;
    } else if (j.kind === 'remove' && this.wires.some((w) => same(w, j))) {
      this.wires = this.wires.filter((w) => !same(w, j));
      this.powerDirty = true;
      this.revision++;
    } else if (j.kind === 'sow') {
      const plot = this.farms.find((f) => same(f, j))!;
      this.crops.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        kind: plot.crop,
        growth: 0,
        sownAt: this.tick,
      });
      this.stats.sown++;
      this.revision++;
    } else if (j.kind === 'harvest') {
      const crop = this.crops.find((c) => same(c, j))!;
      this.crops = this.crops.filter((c) => c.id !== crop.id);
      this.stats.harvested++;
      this.revision++;
    } else if (j.kind === 'stove') {
      this.stoves.push({ id: this.id(), x: j.x, y: j.y, z: j.z, target: 10, paused: false });
      this.skyCache.clear();
      this.revision++;
    } else if (j.kind === 'bed') {
      this.beds.push({
        quality: this.finishedFurnitureQuality(p, j),
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        axis: j.axis ?? 'x',
        owner: null,
        medical: false,
        prisoner: this.beds.some(b => b.prisoner && this.rooms.roomAt(b)?.id === this.rooms.roomAt(j)?.id && !this.rooms.roomAt(b)?.outdoor),
      });
      this.revision++;
    } else if (j.kind === 'door') {
      this.doors.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        axis: j.axis ?? 'x',
        mode: 'auto',
        openUntil: 0,
      });
      this.roomsDirty = true;
      this.revision++;
    } else if (j.kind === 'remove' && this.bedAt(j)) {
      const bed = this.bedAt(j)!;
      this.invalidatePrisonBed(bed);
      for (const p of this.pawns)
        if (p.sleepBedId === bed.id || p.careBedId === bed.id) this.release(p);
      this.beds = this.beds.filter((b) => b.id !== bed.id);
      this.revision++;
    } else if (j.kind === 'remove' && this.doors.some((d) => same(d, j))) {
      this.doors = this.doors.filter((d) => !same(d, j));
      this.roomsDirty = true;
      this.revision++;
    } else if (j.kind === 'cook') {
      yields.meal = SIMPLE_MEAL.output;
      this.stats.cooked++;
    } else if (j.kind === 'table' || j.kind === 'chair') {
      const target = { id: this.id(), x:j.x, y:j.y, z:j.z, axis:j.axis ?? 'x', quality:this.finishedFurnitureQuality(p,j) };
      if (j.kind === 'table') this.tables.push({...target,gathering:true});
      else this.chairs.push(target);
      this.rebuildDevices(); this.revision++;
    } else if (j.kind === 'remove' && (this.tableAt(j) || this.chairs.some(c => same(c, j)))) {
      const target = this.tableAt(j) ?? this.chairs.find(c => same(c, j))!;
      for (const pawn of this.pawns) if (pawn.living.mealTask?.tableId === target.id || pawn.living.mealTask?.chairId === target.id ||
        (pawn.psyche.recreation?.kind === 'social' && (pawn.psyche.recreation.spotId === target.id || same(pawn.psyche.recreation.target,target)))) this.release(pawn);
      this.tables = this.tables.filter(t => t.id !== target.id); this.chairs = this.chairs.filter(c => c.id !== target.id);
      this.rebuildDevices(); this.revision++;
    } else if (j.kind === 'horseshoePin') {
      this.horseshoePins.push({ id: this.id(), x: j.x, y: j.y, z: j.z });
      this.revision++;
    } else if (j.kind === 'remove' && this.horseshoePins.some(b => same(b, j))) {
      const pin = this.horseshoePins.find(b => same(b, j))!;
      for (const pawn of this.pawns) if (pawn.psyche.recreation?.spotId === pin.id) this.release(pawn);
      this.horseshoePins = this.horseshoePins.filter(b => b !== pin);
      this.revision++;
    } else if (j.kind === 'remove' && this.butcherSpots.some(b => same(b, j))) {
      this.butcherSpots = this.butcherSpots.filter(b => !same(b, j));
      this.revision++;
    } else if (j.kind === 'remove' && this.stoves.some((s) => same(s, j))) {
      this.stoves = this.stoves.filter((s) => !same(s, j));
      this.stoveCells.delete(at(j));
      this.skyCache.clear();
      this.revision++;
    }
    for (const c of changes) this.changed(c.pos, j.id);
    for (const [resource, n] of Object.entries(yields)) {
      this.stats.produced[resource as Resource] += n;
    }
    for (const r of resources) this.stats.consumed[r] += j.delivered[r] ?? 0;
    if (unfinished) {
      this.stats.consumed.unfinished++;
      for (const material of unfinished.ingredients) this.stats.consumed[material.resource] += material.amount;
    }
    const completedBill = this.productionBillFor(j);
    if (completedBill) finishProductionBill(completedBill);
    if (
      (j.cost.wood && !['cook', 'refuel', 'smith', 'armorsmith', 'tailoring'].includes(j.kind)) ||
      (j.material === 'stone' && ['wall', 'floor'].includes(j.kind)) ||
      isDeviceKind(j.kind) ||
      j.kind === 'wire' ||
      j.kind === 'smithy' ||
      j.kind === 'machining' ||
      j.kind === 'sandbag'
    )
      this.stats.built++;
    if (j.kind === 'mine' || j.kind === 'digLadder')
      this.stats.mined += changes.filter((c) => c.block === 0).length;
    this.finishFrameDamage(j);
    this.jobs = this.jobs.filter((k) => k.id !== j.id);
    this.release(p);
    if (productionDelivery) {
      p.cargo = productionDelivery.batch; p.productionDelivery = productionDelivery.task;
      this.continueProductionDelivery(p);
    }
    this.pruneFilth();
    this.reconcileFireState();
  }
  step(count = 1) {
    for (let n = 0; n < count; n++) {
      this.tick++;
      advanceWeather(this.weather, this.seed, this.settings, this.tick, this.generator);
      for (const pawn of this.pawns) if (!pawn.dead) tickSkills(pawn.skills, this.tick, DAY);
      this.updateEnvironment();
      if (this.tick % 100 === 0) this.updateSnow();
      if (this.tick % ENVIRONMENT_RULES.interval === 0) this.updateEnvironmentalEffects();
      updateFires(this);
      this.updatePreservation();
      this.reconcileRelocationJobs();
      this.updateTrees();
      this.refreshReservations();
      this.updateApparelWear();
      this.updateSurvival();
      this.pruneFilth();
      this.updateLiving();
      this.updatePsychology();
      this.updateProjectiles();
      this.updateWildlife();
      reconcileAutoSlaughter(this);
      updateTrade(this);
      for (const pawn of this.pawns) if (pawn.weaponDropPending) this.dropPrimary(pawn, true);
      this.updateRaids();
      // Only temperature/daylight change each tick; occlusion is cached until terrain changes.
      for (const c of this.crops)
        if (c.growth < 1)
          c.growth = Math.min(1, c.growth + this.cropCondition(c, c.kind).growthRate);
      if (this.tick % 20 === 0) this.syncProduction();
      for (const p of this.pawns) {
        // Interrupted furniture hauling releases the bulky original for another
        // worker. Full floors retry safely; existing corpse supplies stay intact.
        if ((p.dead || p.downed || p.drafted) && p.carriedBy === null && p.cargo?.furniture) this.dropCargo(p);
        if (p.dead || p.downed || p.carriedBy !== null) continue;
        const job = this.jobs.find(j => j.id === p.jobId);
        if (job && this.fires.some(f => touchesFire(f, job))) { this.release(p); p.reason = '工作位置起火，先处理火灾'; }
        if (p.psyche.breakUntil > this.tick) { this.mentalTick(p); continue; }
        if (p.faction === 'prisoner') { prisonerTick(this, p); this.moveAlongPath(p); continue; }
        this.reconcilePawnArea(p);
        const combatant = (p.drafted || p.faction === 'raider' || p.faction === 'trader') && p.weaponTask === null;
        if (combatant) this.combatTick(p);
        else if (p.phase === 'hunt') this.huntTick(p);
        else if (p.phase === 'handle') handleTick(this, p);
        else if (p.phase === 'rope') ropeTick(this,p);
        else if (p.phase === 'warden') wardenTick(this, p);
        if (
          !combatant &&
          !p.drafted &&
          this.pawns.some((q) => q.patientId === p.id && q.carePhase?.startsWith('tend'))
        ) {
          p.reason = '等待同伴护理';
          if (p.phase === 'rest') p.rest = Math.min(100, p.rest + this.restingGain(p));
          continue;
        }
        if (p.phase === 'care' && !this.validCare(p)) {
          this.release(p);
          p.reason = '护理条件改变，重新安排';
        }
        if (
          p.phase !== 'care' &&
          !combatant &&
          !p.drafted &&
          p.phase !== 'travel' &&
          !p.eating &&
          p.food >= 30 &&
          p.rest > 14 &&
          p.priorities.care > 0 &&
          !medicalNeedsRest(p) &&
          (this.tick + p.id) % 20 === 0 &&
          this.tryCare(p)
        )
          continue;
        if (
          p.food < 30 &&
          !combatant &&
          !p.drafted &&
          p.phase !== 'idle' &&
          p.phase !== 'travel' &&
          !p.eating &&
          (p.phase !== 'rest' || (p.food < 12 && p.rest > 14)) &&
          (this.tick + p.id) % 20 === 0 &&
          this.tryFood(p)
        )
          continue;
        if (!p.path.length && this.shelfAt(p) && !p.downed && !p.dead && p.carriedBy === null) {
          this.search(p);
          const target = this.reachableItemStand(p);
          if (target >= 0) { this.release(p); this.go(p,target,'travel'); this.moveAlongPath(p); continue; }
        }
        if (p.phase === 'rest') {
          p.rest = Math.min(100, p.rest + this.restingGain(p));
          if (
            !medicalNeedsRest(p) &&
            (p.rest >= 100 || (assignmentAt(p.schedule, this.tick) === 'work' && p.rest >= 20))
          ) {
            this.release(p);
            p.reason = '醒来';
          }
          continue;
        }
        p.rest = Math.max(0, p.rest - restLoss(p.rest));
        if (
          !combatant &&
          !['sleepTravel', 'travel', 'care'].includes(p.phase) &&
          !p.eating &&
          p.food >= 12 &&
          (this.tick + p.id) % 20 === 0 &&
          this.startMedicalRest(p)
        )
          continue;
        if (
          !['rest', 'sleepTravel', 'travel', 'care'].includes(p.phase) &&
          !combatant &&
          !p.drafted &&
          !p.eating &&
          (this.tick + p.id) % 20 === 0 &&
          wantsSleep(p.rest, assignmentAt(p.schedule, this.tick))
        ) {
          this.startSleep(p);
          continue;
        }
        if (p.phase === 'recreation' && !this.validRecreation(p)) {
          this.release(p); p.reason = '娱乐场地不可用，重新安排';
        }
        if (!combatant && !p.drafted && !p.eating && !p.cargo &&
            !['rest', 'sleepTravel', 'travel', 'care', 'apparel', 'weapon', 'recreation', 'trade', 'warden', 'handle', 'rope'].includes(p.phase) &&
            p.food >= 30 && p.rest >= 20 && (this.tick + p.id) % 20 === 0 &&
            shouldRecreate(p, assignmentAt(p.schedule, this.tick)) && this.startRecreation(p)) continue;
        if (!combatant && p.jobId !== null && this.tick % 10 === 0) {
          const current = this.jobs.find((j) => j.id === p.jobId);
          if (current?.kind === 'research') {
            this.search(p);
            const higher = this.jobs.some(
              (j) =>
                j !== current &&
                !j.cancelled &&
                !j.constructionFailure &&
                j.owner === null &&
                j.kind !== 'research' &&
                p.priorities[workType(j.kind)] > 0 &&
                p.priorities[workType(j.kind)] <= p.priorities.research &&
                !this.skillFailure(p, j) &&
                !this.productionWorkerFailure(p, j) &&
                !this.waitingForFuel(j) &&
                this.supported(j) &&
                this.reachableStand(j, p) >= 0 &&
                (!missing(j) || !!this.pileFor(p, missing(j)!, j)),
            );
            const hauling =
              p.priorities.haul > 0 &&
              p.priorities.haul <= p.priorities.research &&
              this.items.some(
                (i) =>
                  this.pawnAllowed(p,i) && this.distance[at(i)] >= 0 &&
                  !this.chunkReserved(i, p.id) &&
                  !!this.storageDestination(i, this.storagePriority(i), p.id),
              );
            if (higher || hauling) {
              this.release(p);
              this.assign(p);
              continue;
            }
          }
        }
        if (p.phase === 'dine' && !this.validDining(p)) { this.release(p); p.reason = '用餐位置或食物改变，保留携带物重新安排'; continue; }
        if (p.path.length) { this.moveAlongPath(p); continue; }
        if (p.phase === 'dine') { this.diningTick(p); continue; }
        if (p.phase === 'firefight') { firefightTick(this, p); continue; }
        if (p.phase === 'repair') { repairTick(this, p); continue; }
        if (p.phase === 'clean') { this.cleanTick(p); continue; }
        if (p.phase === 'recreation') { this.recreationTick(p); continue; }
        if (combatant || p.phase === 'trade' || p.phase === 'hunt' || p.phase === 'warden' || p.phase === 'handle' || p.phase === 'rope') continue;
        if (p.phase === 'idle') {
          if ((this.tick + p.id) % 20 === 0) this.assign(p);
        } else this.arrive(p);
      }
      // Resolve invalid activities, arrival and work scheduling before deciding
      // social eligibility. A stale recreation phase must not survive a load
      // or a schedule change just long enough to earn another interaction.
      updateSocial(this);
      for (const d of [...this.doors, ...this.fenceGates])
        if (
          d.mode !== 'locked' &&
          (this.pawns.some((p) => same(p, d)) || this.animals.some(a => same(a,d)) || this.items.some((i) => same(i, d)))
        )
          d.openUntil = this.tick + 37;
      this.pruneStorageSpills();
      reconcileStorageGroups(this);
      this.updateAdaptation();
      this.reconcileFireState();
      this.updateRooms();
    }
  }
  updateRooms() {
    if (this.roomsDirty) {
      const coolers = this.devices.filter((d) => d.kind === 'cooler');
      this.rooms.rebuild(this.blocks, [...this.doors, ...coolers]);
      this.thermal.sync(
        this.blocks,
        this.rooms,
        [
          ...this.doors.map((d) => ({ ...d, kind: 'door' as const })),
          ...coolers.map((d) => ({ ...d, kind: 'cooler' as const })),
        ],
        this.outdoorTemperature(),
      );
      this.roomsDirty = false;
      this.roomRevision++;
    }
  }
  /** Derived room statistics are never saved. A terrain scan is shared across
   * all residents and invalidated by topology; dynamic furniture/filth lists
   * are aggregated only for an inspection or an actual meal/sleep event. */
  livingRooms(): RoomLivingSummary[] {
    this.updateRooms();
    const rooms = this.rooms.snapshot();
    if (this.livingFloorRevision !== this.roomRevision) {
      this.livingFloors.clear();
      for (const r of rooms) this.livingFloors.set(r.id,{wealth:0,beauty:0});
      const counted = new Set<string>();
      for (let i = WIDTH * DEPTH; i < CELLS - WIDTH * DEPTH; i++) {
        const id = this.rooms.roomIds[i], base = this.livingFloors.get(id);
        if (!base || this.blocks[i] || !this.blocks[i-WIDTH*DEPTH] || this.blocks[i+WIDTH*DEPTH]) continue;
        const floor = this.blocks[i-WIDTH*DEPTH];
        base.beauty += floor === Block.Masonry ? 1 : floor === Block.Wood ? 0 : -1;
        const pos = position(i);
        for (const cell of [i-WIDTH*DEPTH,...horizontal.map(([dx,dy]) => {
          const q={x:pos.x+dx,y:pos.y+dy,z:pos.z}; return inside(q) ? at(q) : -1;
        })]) {
          if (cell < 0 || ![Block.Wood,Block.Masonry].includes(this.blocks[cell] as 4|7)) continue;
          const key = `${id}:${cell}`; if (counted.has(key)) continue; counted.add(key);
          base.wealth += structureMarketValue(this.blocks[cell] === Block.Wood ? 'wood' : 'stone',
            this.structureKinds[cell] === 1 ? 'floor' : this.structureKinds[cell] === 2 ? 'wallHalf' : 'legacyUnknown');
        }
      }
      this.livingFloorRevision = this.roomRevision;
    }
    const cleanliness = new Map(this.roomCleanliness().map(r => [r.roomId,r.cleanliness]));
    const inputs = new Map(rooms.map(r => [r.id,{id:r.id,outdoor:r.outdoor,floorCells:r.floorCells,
      standableCells:r.floorCells,passThroughCells:0,wealth:this.livingFloors.get(r.id)?.wealth ?? 0,
      beautyTotal:this.livingFloors.get(r.id)?.beauty ?? 0,cleanliness:cleanliness.get(r.id) ?? 0,
      ordinaryBeds:0,medicalBeds:0,prisonerBeds:0,tables:0}]));
    const add = (pos:Pos,kind:JobKind,cells:Pos[],beauty=0,pass=false,value=constructedMarketValue(costOf(kind),workOf(kind))) => {
      const groups = new Map<number,number>();
      for (const c of cells) { const id=this.rooms.roomIds[at(c)]; groups.set(id,(groups.get(id)??0)+1); }
      for (const [id,count] of groups) {
        const v=inputs.get(id); if (!v) continue;
        v.wealth += value * count/cells.length;
        v.beautyTotal += beauty * count/cells.length;
        if (kind!=='chair' && kind!=='door' && kind!=='horseshoePin') {
          const occupied=Math.min(v.standableCells,count); v.standableCells-=occupied;
          if(pass)v.passThroughCells+=occupied;
        }
      }
    };
    const value = (kind: FurnitureKind, target: Bed | DiningTable | DiningChair) => {
      const damage = this.fireDamage.find(d => d.kind === kind && d.targetId === target.id);
      return furnitureMarketValue(kind,target.quality,damage ? damage.hitPoints/damage.maxHitPoints : 1);
    };
    for (const shelf of this.shelves) add(shelf,shelf.kind,shelfCells(shelf),SHELF_DEFS[shelf.kind].beauty,true);
    for (const t of this.tables) { add(t,'table',tableCells(t),furnitureStats('table',t.quality).beauty,false,value('table',t)); const r=inputs.get(this.rooms.roomIds[at(t)]); if(r)r.tables++; }
    for (const c of this.chairs) add(c,'chair',[c],furnitureStats('chair',c.quality).beauty,false,value('chair',c));
    for (const b of this.beds) {
      add(b,'bed',bedCells(b),furnitureStats('bed',b.quality).beauty,true,value('bed',b)); const r=inputs.get(this.rooms.roomIds[at(b)]);
      if(r) { if(b.prisoner)r.prisonerBeds++; else if(b.medical)r.medicalBeds++; else r.ordinaryBeds++; }
    }
    for (const t of this.stoves) add(t,'stove',[t]);
    for (const t of this.stonecutters) add(t,'stonecutter',stonecutterCells(t));
    for (const t of this.tailors) add(t,'tailor',tailorCells(t));
    for (const t of this.researchBenches) add(t,'researchBench',researchBenchCells(t));
    for (const t of this.weaponBenches) add(t,t.kind,weaponBenchCells(t));
    for (const t of this.devices) add(t,t.kind,deviceCells(t));
    for (const t of this.horseshoePins) add(t,'horseshoePin',[t]);
    for (const f of this.filth) { const r=inputs.get(this.rooms.roomIds[at(f)]); if(r)r.beautyTotal-=2; }
    return [...inputs.values()].map(roomLivingSummary);
  }
  private livingRoomAt(pos:Pos) { return this.livingRooms().find(r=>r.id===this.rooms.roomIds[at(pos)]) ?? null; }
  private updateLiving() {
    for (const p of this.pawns) {
      if (p.dead) continue;
      const bed = this.patientBed(p);
      const resting = !!bed && (p.phase==='rest' || p.downed || (p.faction==='prisoner' && p.sleepingSince!==null));
      const seated = (p.phase==='dine' && p.living.mealTask?.stage==='chew' &&
        p.living.mealTask.chairId!==null && this.validDining(p)) ||
        (p.phase==='recreation' && p.psyche.recreation?.kind==='social' && same(p,p.psyche.recreation.target) &&
         this.validRecreation(p) && this.chairs.some(c=>same(c,p)));
      const chair = seated ? this.chairs.find(c=>same(c,p)) : undefined;
      const comfort = resting ? furnitureStats('bed',bed.quality).comfort :
        chair ? furnitureStats('chair',chair.quality).comfort : null;
      advanceLiving(p.living,this.tick,comfort === null ? null : Math.min(100,comfort));
      if (resting && p.phase==='rest' && p.sleepingSince!==null && bed.owner===p.id && !bed.medical && !bed.prisoner) {
        p.living.sleepThoughtAt ??= p.sleepingSince! + LIVING_RULES.sleepThoughtDelay;
        if (this.tick >= p.living.sleepThoughtAt) rememberSleep(p.living,this.livingRoomAt(p),this.tick);
      } else p.living.sleepThoughtAt=null;
    }
  }
  temperature(p: Pos) {
    this.updateRooms();
    return this.thermal.temperatureAt(p, this.outdoorTemperature());
  }
  outdoorTemperature() {
    return outdoorTemperature(this.tick, this.settings, this.generator);
  }
  /** Roof exposure is vertical world geometry, independent of cutaway, trees,
   * room connectivity and whether a door is open. A burning wall may be exposed
   * above its own block; only higher solid blocks shelter it from precipitation. */
  private refreshWeatherRoof() {
    if (this.weatherRoofRevision === this.revision) return;
    for (let y = 0; y < DEPTH; y++) for (let x = 0; x < WIDTH; x++) {
      let z = HEIGHT - 1;
      while (z > 0 && this.blocks[index(x, y, z)] === Block.Air) z--;
      this.weatherRoof[y * WIDTH + x] = z;
    }
    this.weatherRoofRevision = this.revision;
  }
  weatherExposed(p: Pos): boolean {
    this.refreshWeatherRoof();
    return inside(p) && p.z >= this.weatherRoof[p.y * WIDTH + p.x];
  }
  private deteriorationEnvironment(p: Pos): DeteriorationEnvironment {
    return { exposed: this.weatherExposed(p), outdoors: this.rooms.roomAt(p)?.outdoor ?? true,
      rainRate: weatherEffects(this.weather, this.tick).rainRate, ...(this.shelfAt(p) ? { protected:true } : {}) };
  }
  private environmentView(): EnvironmentView {
    const view = (id: number, entity: 'stack' | 'carcass', p: Pos, batch: Cargo) => {
      const environment = this.deteriorationEnvironment(p);
      return { id, entity, environment, hitPoints: batchHitPoints(batch),
        maxHitPoints: batchMaxHitPoints(batch), rate: deteriorationRate(batch, environment) };
    };
    const rain = weatherEffects(this.weather, this.tick).rainRate;
    return {
      items: [...this.items.filter(p => this.exploredAt(p)).map(i => view(i.id, 'stack', i, i)),
        ...this.animals.filter(a => a.dead && this.exploredAt(a)).map(a => view(a.id, 'carcass', a, carcassBatch(a)))],
      filth: this.filth.filter(p => this.exploredAt(p)).map(f => ({ id: f.id, exposed: this.weatherExposed(f), rainWashes: RAIN_WASHES[f.kind],
        washing: this.weatherExposed(f) && RAIN_WASHES[f.kind] && rain > 0 })),
      wetPawnIds: wettingWeather(this.weather, this.tick)
        ? this.pawns.filter(p => p.faction === 'colony' && !p.dead && this.weatherExposed(p)).map(p => p.id) : [],
      natureAvailable: natureWeatherAllowed(this.weather, this.tick),
    };
  }
  /** Environment acts on spawned physical containers. A stockpile designation
   * changes logistics only; carried and delivered inputs are not ground stacks. */
  private updateEnvironmentalEffects() {
    this.updateRooms();
    for (const item of [...this.items]) {
      if (!advanceDeterioration(item, this.deteriorationEnvironment(item), this.seed, item.id, this.tick)) continue;
      this.tradeApplyPlacement({ items: this.items.filter(i => i.id !== item.id), nextId: this.nextId },
        '预留物品已劣化损毁，重新安排任务');
      this.recordDestroyedCargo(item);
      this.notice = `${item.amount}单位${RESOURCE_NAMES[item.resource]}因环境劣化损毁。屋顶和封闭仓库可以保护物资。`;
    }
    for (const animal of [...this.animals]) if (animal.dead) {
      const batch = carcassBatch(animal);
      if (advanceDeterioration(batch, this.deteriorationEnvironment(animal), this.seed, animal.id, this.tick)) {
        this.animals = this.animals.filter(a => a.id !== animal.id); this.stats.destroyed.carcass++;
      } else if (batch.hitPoints !== undefined) animal.carcassHitPoints = batch.hitPoints;
    }
    const rain = weatherEffects(this.weather, this.tick).rainRate;
    for (const f of this.filth) if (RAIN_WASHES[f.kind] && this.weatherExposed(f) &&
        deteriorationRandom(this.seed ^ 0x61e245f, f.id, this.tick) <
          rain * ENVIRONMENT_RULES.filthVisitsPerDay * ENVIRONMENT_RULES.interval / DAY) f.amount--;
    const removed = new Set(this.filth.filter(f => f.amount === 0).map(f => f.id));
    if (removed.size) {
      this.filth = this.filth.filter(f => !removed.has(f.id));
      for (const p of this.pawns) if (p.cleanTask && removed.has(p.cleanTask.filthId)) {
        this.release(p); p.reason = '雨水已冲净污物';
      }
    }
  }
  /** Base move time uses weather at departure, while terrain entry uses the
   * greater of snow or an obstacle cost. Costs are converted from native TPS. */
  weatherMoveTicks(from: Pos, baseTicks: number, to: Pos = from, obstacleTicks = 0): number {
    const factor = this.weatherExposed(from) ? weatherEffects(this.weather, this.tick).moveFactor : 1;
    return Math.ceil(baseTicks / factor + Math.max(obstacleTicks, this.waterPresent && waterBelow(this.water,this.blocks,to) ? WATER_RULES.shallowPathTicks : 0,
      snowPathCost(this.snowLookup.get(at(to)) ?? 0) * TPS / 60));
  }
  private validSnowSupport(p: Pos): boolean {
    return inside(p) && p.z > 0 && !this.water[at(p)] && this.blocks[at(p)] === Block.Air && this.blocks[at(p) - WIDTH * DEPTH] !== Block.Air;
  }
  private pruneSnow() {
    this.snow = this.snow.filter(p => this.validSnowSupport(p));
    this.snowLookup = new Map(this.snow.map(p => [at(p), p.depth]));
  }
  private updateSnow() {
    this.refreshWeatherRoof();
    const rate = weatherEffects(this.weather, this.tick).snowRate, cells = new Map(this.snow.map(p => [at(p), p]));
    if (rate > 0) for (let y = 0; y < DEPTH; y++) for (let x = 0; x < WIDTH; x++) {
      const p = { x, y, z: this.weatherRoof[y * WIDTH + x] + 1 };
      if (this.validSnowSupport(p) && !cells.has(at(p))) cells.set(at(p), { ...p, depth: 0 });
    }
    const result: SnowCover[] = [];
    for (const p of cells.values()) {
      if (!this.validSnowSupport(p)) continue;
      const room = this.rooms.roomAt(p);
      const depth = snowDepthAfter(p.depth, rate, this.temperature(p), this.weatherExposed(p), room?.outdoor ?? true, 100 / TPS);
      if (depth > 0) result.push({ x: p.x, y: p.y, z: p.z, depth });
    }
    this.snow = result.sort((a, b) => at(a) - at(b));
    this.snowLookup = new Map(this.snow.map(p => [at(p), p.depth]));
  }
  get worldSummary(): WorldSummary {
    if (!this.summaryCache || this.summaryRevision !== this.revision) {
      this.summaryCache = summarizeWorld(this.blocks, this.trees, this.spawn, this.settings, this.explored, this.water);
      this.summaryRevision = this.revision;
    }
    return this.summaryCache;
  }
  private updatePower() {
    if (this.powerDirty) {
      this.power.rebuild(
        this.wires,
        this.devices,
        this.weaponBenches.flatMap((b) => (b.power ? [b.power] : [])),
      );
      this.powerDirty = false;
    }
  }
  private solarLight(d: Device) {
    let clear = 0;
    for (const p of deviceCells(d)) {
      let open = true;
      for (let z = p.z + 2; z < HEIGHT; z++) {
        const i = index(p.x, p.y, z);
        if (
          this.blocks[i] ||
          this.treeCells.has(i) ||
          this.stoveCells.has(i) ||
          this.deviceBlocks.has(i)
        ) {
          open = false;
          break;
        }
      }
      if (open) clear++;
    }
    return (daylight(hourAt(this.tick)) * clear) / deviceCells(d).length;
  }
  private thermalIntent(d: Device) {
    const cold = { x: d.x - (d.axis === 'x' ? 1 : 0), y: d.y - (d.axis === 'y' ? 1 : 0), z: d.z };
    const hot = { x: d.x + (d.axis === 'x' ? 1 : 0), y: d.y + (d.axis === 'y' ? 1 : 0), z: d.z };
    if (d.kind === 'heater') {
      const t = this.temperature(d),
        eff = Math.max(0, Math.min(1, (120 - t) / 100));
      return {
        cold: d,
        hot: d,
        heat: (21 / TPS) * eff,
        active: t < d.target && eff > 0,
        reason: t >= d.target ? '达到目标，低功耗待机' : '加热中',
      };
    }
    const blocked =
      !inside(cold) ||
      !inside(hot) ||
      this.solid(cold) ||
      this.solid(hot) ||
      this.deviceBlocks.has(at(cold)) ||
      this.deviceBlocks.has(at(hot)) ||
      this.rooms.roomAt(cold) === null ||
      this.rooms.roomAt(hot) === null;
    const c = this.temperature(cold),
      h = this.temperature(hot),
      eff = Math.max(0, 1 - (h - Math.min(c, 40)) / 130);
    return {
      cold,
      hot,
      heat: (21 / TPS) * eff,
      active: !blocked && c > d.target && eff > 0,
      reason: blocked
        ? '进风口或排热口被堵住'
        : c <= d.target
          ? '达到目标，低功耗待机'
          : eff <= 0
            ? '排热侧过热'
            : '制冷中',
    };
  }
  private updateEnvironment() {
    this.updateRooms();
    this.updatePower();
    const intents = new Map<number, ReturnType<VoxelSimulation['thermalIntent']>>();
    for (const d of this.devices)
      if (d.kind === 'heater' || d.kind === 'cooler') {
        const intent = this.thermalIntent(d);
        intents.set(d.id, intent);
        d.active = d.on && intent.active;
      }
    this.power.step(this.tick, this.devices, (d) => this.solarLight(d));
    for (const d of this.devices) {
      if (d.kind === 'generator' && d.powered)
        this.thermal.pushHeat(d, (6 / TPS) * (d.watts / 1000));
      const intent = intents.get(d.id);
      if (!intent) continue;
      d.active = d.powered && d.on && intent.active;
      if (d.powered) d.reason = intent.reason;
      if (!d.active) continue;
      if (d.kind === 'heater') this.thermal.pushHeat(d, intent.heat, d.target);
      else {
        this.thermal.pushHeat(intent.cold, -intent.heat, d.target);
        // Native cooler exhaust uses available energy before cold-side target clipping.
        this.thermal.pushHeat(intent.hot, intent.heat * 1.25);
      }
    }
    this.thermal.step(1 / TPS, this.outdoorTemperature(), this.doors, this.tick);
  }
  private updatePreservation() {
    // Ground stacks, carried food, and delivered recipe inputs are all physical
    // containers. Their current cell determines temperature; moving is not a
    // freshness reset. Food expires before the tick's eating/cooking actions.
    let removed = false;
    const spoiled: Stack[] = [];
    this.items = this.items.filter((item) => {
      if (!isPerishable(item.resource) || !advanceRot(item, this.temperature(item))) return true;
      this.stats.spoiled[item.resource] += item.amount;
      spoiled.push(item);
      removed = true;
      return false;
    });
    this.invalidateStackPlans(spoiled, '预留物品已腐坏，重新安排任务');
    for (const pawn of this.pawns)
      if (
        pawn.cargo &&
        isPerishable(pawn.cargo.resource) &&
        advanceRot(pawn.cargo, this.temperature(pawn))
      ) {
        this.stats.spoiled[pawn.cargo.resource] += pawn.cargo.amount;
        pawn.cargo = null;
        this.release(pawn);
        pawn.reason = '携带的易腐物资已腐坏';
        removed = true;
      }
    for (const job of this.jobs)
      if (job.deliveredBatches.length) {
        const temperature = this.temperature(job);
        job.deliveredBatches = job.deliveredBatches.filter((batch) => {
          if (!advanceRot(batch, temperature)) return true;
          this.stats.spoiled[batch.resource] += batch.amount;
          const remaining = (job.delivered[batch.resource] ?? 0) - batch.amount;
          if (remaining) job.delivered[batch.resource] = remaining;
          else delete job.delivered[batch.resource];
          job.progress = 0;
          job.workTicks = 0;
          if (job.kind === 'cook') { job.cookTraining = []; delete job.cookingOutcome; }
          job.reason = '已配送食材腐坏，等待新原料';
          removed = true;
          return false;
        });
      }
    if (removed) this.revision++;
  }
  counts(visibleOnly = false): Counts {
    const out = emptyCounts();
    const countCargo = (batch: Cargo) => {
      out[batch.resource] += batch.amount;
      if (batch.unfinished) for (const material of batch.unfinished.ingredients) out[material.resource] += material.amount;
    };
    for (const i of this.items) if (!visibleOnly || this.exploredAt(i)) countCargo(i);
    for (const p of this.pawns) {
      if (p.faction !== 'colony' || (visibleOnly && !this.exploredAt(p))) continue;
      if (p.cargo) countCargo(p.cargo);
      out.apparel += p.worn.length;
      out.weapon += p.weapon ? 1 : 0;
    }
    for (const j of this.jobs) for (const r of resources) out[r] += j.delivered[r] ?? 0;
    out.carcass += this.animals.filter(a => a.dead && (!visibleOnly || this.exploredAt(a))).length;
    return out;
  }
  snapshot(speed = 0, tickMs = 0): VoxelSnapshot {
    this.reconcileProductionStorage();
    this.reconcileUnfinishedBindings();
    this.updateRooms();
    this.updatePower();
    this.refreshWeatherRoof();
    const visible = (p: Pos) => this.exploredAt(p);
    if (this.visibleRoomsRevision !== this.roomRevision) {
      this.visibleRoomsCache.clear();
      for (let cell = 0; cell < CELLS; cell++) if (this.explored[cell] && this.rooms.roomIds[cell] >= 0) this.visibleRoomsCache.add(this.rooms.roomIds[cell]);
      this.visibleRoomsRevision = this.roomRevision;
    }
    const visibleRooms = this.visibleRoomsCache;
    const stored = emptyCounts();
    for (const i of this.items.filter(visible))
      if (this.storagePriority(i) >= 0)
        stored[i.resource] += i.amount;
    return structuredClone({
      wallDamageKeys: this.fireDamage.filter(d => d.kind === 'block' && this.structureKinds[at(d)] === 2 && visible(d)).map(d => d.key),
      productionQueues: productionQueues(this, this.productionQueues).filter(q => this.productionBenches().some(b => b.id === q.benchId && visible(b))),
      socialHistory: this.socialHistory, socialLog: this.socialLog,
      weather: { ...this.weather, effects: weatherEffects(this.weather, this.tick) },
      environment: this.environmentView(),
      snow: this.snow.filter(visible), weatherRoof: this.weatherRoof,
      weatherBytes: this.weatherRoof.byteLength + this.snow.length * 32,
      fires: this.fires.filter(visible), fireDamage: this.fireDamage.filter(visible), fireHazards: this.fireHazards, autoRebuild: this.autoRebuild, fireLog: this.fireLog.filter(e => visible(e.position)),
      filth: this.filth.filter(visible),
      roomCleanliness: this.roomCleanliness().filter(r => visibleRooms.has(r.roomId)),
      roomLiving: this.livingRooms().filter(r => visibleRooms.has(r.id)),
      penSummaries: penSummaries(this).filter(r => this.penMarkers.some(m => m.id === r.markerId && visible(m)) && r.cells.every(i => this.explored[i])),
      trade: { ...this.trade, quote: quoteTrade(this) },
      homeArea: [...this.homeArea].filter(i => this.explored[i]),
      combat: this.combat,
      storyteller: {
        ...this.storyteller, threat: this.threatBreakdown(),
        nextOpportunity: this.combat.enabled ? nextOpportunity(this.storyteller, this.seed, this.tick) : null,
        legacyStructureCells: this.blocks.reduce((n, b, i) => n + Number(this.explored[i] && (b === Block.Wood || b === Block.Masonry) && this.structureKinds[i] === 0), 0),
      },
      projectiles: this.projectiles.filter(p => visible(p.from) && visible(p.destination)),
      combatEvents: this.combatEvents.filter(visible),
      sandbags: this.sandbags.filter(visible),
      animals: this.animals.filter(visible),
      autoSlaughter: structuredClone(this.autoSlaughter), autoSlaughterStatus: autoSlaughterSelection(this.autoSlaughter, this.animals),
      grass: this.grass.filter(visible), husbandryLog: this.husbandryLog,
      fences: this.fences.filter(visible), fenceGates: this.fenceGates.filter(visible), penMarkers: this.penMarkers.filter(visible), animalAreas: this.animalAreas.map(a => ({ ...a, cells: [...a.cells] })),
      butcherSpots: this.butcherSpots.filter(visible),
      tables: this.tables.filter(visible), chairs: this.chairs.filter(visible),
      horseshoePins: this.horseshoePins.filter(visible),
      seed: this.seed,
      generator: this.generator,
      exploration: { known: this.exploredCount, total: CELLS },
      worldSite: this.worldSite,
      settings: this.settings,
      spawn: this.spawn,
      worldSummary: this.worldSummary,
      tick: this.tick,
      revision: this.revision,
      speed,
      pawns: this.pawns.filter(visible),
      items: this.items.filter(visible),
      trees: this.trees.filter(visible),
      treePlots: this.treePlots.filter(visible),
      treeConditions: this.trees.filter(visible).map((tree) => ({
        x: tree.x,
        y: tree.y,
        z: tree.z,
        ...this.treeCondition(tree),
      })),
      jobs: this.jobs,
      stockpiles: this.stockpiles.filter(visible),
      stockpileZones: this.stockpileZones.map(z => ({...z,cells:z.cells.filter(cell => visible(position(cell)))})).filter(z => z.cells.length > 0),
      shelves: this.shelves.filter(visible), storageSpills: this.storageSpills.filter(visible), storageGroups:this.storageGroups,
      storageCapacity: this.storageCapacity().filter(visible),
      farms: this.farms.filter(visible),
      crops: this.crops.filter(visible),
      stoves: this.stoves.filter(visible),
      stonecutters: this.stonecutters.filter(visible),
      tailors: this.tailors.filter(visible),
      weaponBenches: this.weaponBenches.filter(visible),
      researchBenches: this.researchBenches.filter(visible),
      research: this.research,
      beds: this.beds.filter(visible),
      doors: this.doors.filter(visible),
      rooms: this.rooms.snapshot().filter(r => visibleRooms.has(r.id)),
      roomRevision: this.roomRevision,
      roomBytes: this.rooms.memoryBytes,
      devices: this.devices.filter(visible),
      wires: this.wires.filter(visible),
      networks: this.power.snapshot().filter(n => n.devices.every(id => [...this.devices, ...this.weaponBenches].some(d => d.id === id && visible(d)))),
      roomTemperatures: this.thermal.snapshot().filter(r => visibleRooms.has(r.roomId)),
      thermalBytes: this.thermal.memoryBytes,
      powerBytes: this.power.memoryBytes,
      cropConditions: this.farms.filter(visible).map((f) => ({
        ...f,
        ...this.cropCondition(f, this.crops.find((c) => same(c, f))?.kind ?? f.crop),
      })),
      hour: hourAt(this.tick),
      temperature: this.outdoorTemperature(),
      inventory: this.counts(true),
      stored,
      stats: this.stats,
      notice: this.notice,
      gridBytes: this.blocks.byteLength + this.water.byteLength + this.bridges.byteLength + this.ladders.byteLength + this.structureKinds.byteLength + this.explored.byteLength,
      navigationBytes:
        this.distance.byteLength +
        this.parents.byteLength +
        this.queue.byteLength +
        this.navigation.byteLength +
        this.treeRouteSeen.byteLength +
        this.treeRouteQueue.byteLength,
      tickMs,
    });
  }
  save(): VoxelSave {
    this.reconcileProductionStorage();
    this.validateProductionWorkers();
    this.reconcileUnfinishedBindings();
    this.pruneStorageSpills();
    this.updateRooms();
    return structuredClone({
      format: 'emberfield-voxel',
      version: 50,
      autoSlaughter: this.autoSlaughter,
      stockpileZones: this.stockpileZones,
      productionQueues: this.productionQueues.filter(q => this.productionBenches().some(b => b.id === q.benchId)),
      socialHistory: this.socialHistory, socialLog: this.socialLog,
      weather: this.weather, snow: this.snow,
      fires: this.fires, fireDamage: this.fireDamage, fireHazards: this.fireHazards, autoRebuild: this.autoRebuild, fireLog: this.fireLog,
      filth: this.filth,
      trade: this.trade,
      homeArea: [...this.homeArea],
      combat: this.combat,
      storyteller: this.storyteller,
      structureKinds: encode(this.structureKinds),
      projectiles: this.projectiles,
      combatEvents: this.combatEvents,
      sandbags: this.sandbags,
      animals: this.animals,
      grass: this.grass, husbandryLog: this.husbandryLog,
      fences: this.fences, fenceGates: this.fenceGates, penMarkers: this.penMarkers, animalAreas: this.animalAreas,
      butcherSpots: this.butcherSpots,
      tables: this.tables, chairs: this.chairs,
      horseshoePins: this.horseshoePins,
      generator: this.generator,
      worldSite: this.worldSite,
      settings: this.settings,
      spawn: this.spawn,
      seed: this.seed,
      tick: this.tick,
      nextId: this.nextId,
      blocks: encode(this.blocks),
      water: encode(this.water),
      bridges: encode(this.bridges),
      explored: Array.from(this.explored),
      ladders: encode(this.ladders),
      pawns: this.pawns,
      items: this.items,
      trees: this.trees,
      treePlots: this.treePlots,
      jobs: this.jobs,
      stockpiles: this.stockpiles,
      shelves: this.shelves, storageSpills: this.storageSpills, storageGroups:this.storageGroups,
      farms: this.farms,
      crops: this.crops,
      stoves: this.stoves,
      stonecutters: this.stonecutters,
      tailors: this.tailors,
      weaponBenches: this.weaponBenches,
      researchBenches: this.researchBenches,
      research: this.research,
      beds: this.beds,
      doors: this.doors,
      devices: this.devices,
      wires: this.wires,
      thermal: this.thermal.save(),
      stats: this.stats,
    });
  }
  static load(raw: unknown) {
    if (!raw || typeof raw !== 'object') throw new Error('存档无效');
    const old = structuredClone(raw) as Record<string, any>;
    if (
      old.format !== 'emberfield-voxel' ||
      ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50].includes(old.version) ||
      (old.version < 8 ? old.generator !== 1 : !(old.version < 36 ? [1, 2] : old.version < 43 ? [1, 2, 3] : [1, 2, 3, 4]).includes(old.generator))
    )
      throw new Error('请使用体素版存档；二维存档仍在原营地入口读取');
    const sourceVersion = old.version;
    rejectLegacyWool(old,sourceVersion);
    rejectLegacyMilk(old,sourceVersion);
    migrateAutoSlaughter(old, sourceVersion);
    if (sourceVersion < 47 && old.jobs?.some((j:any) => Object.hasOwn(j,'constructionFailure')))
      throw new Error('旧版本存档混入施工失败记录');
    if (sourceVersion < 46) {
      if (Object.hasOwn(old, 'autoRebuild') || old.fireDamage?.some((d:any) => d.kind === 'frame'))
        throw new Error('旧版本存档混入自动重建或施工框架损伤字段');
      old.autoRebuild = false;
    }
    if (typeof old.autoRebuild !== 'boolean') throw new Error('自动重建设置无效');
    rejectLegacyItemAccess(old,sourceVersion);
    if (sourceVersion < 44 && old.pawns?.some((p:any) => Object.hasOwn(p,'allowedAreaId')))
      throw new Error('旧版本存档混入居民允许区域字段');
    if (sourceVersion < 43 && (Object.hasOwn(old,'water') || Object.hasOwn(old,'bridges') ||
      Object.hasOwn(old.settings ?? {},'river') || old.jobs?.some((j:any)=>j.kind==='bridge')))
      throw new Error('旧版本存档混入水域或桥梁字段');
    if (sourceVersion < 42 && (Object.hasOwn(old, 'stockpileZones') ||
        old.pawns?.some((p:any) => Object.hasOwn(p, 'productionDelivery')) ||
        old.productionQueues?.some((q:any) => q.bills?.some((b:any) => Object.hasOwn(b, 'output')))))
      throw new Error('旧版存档混入成品去向或仓库区域字段');
    if (sourceVersion < 41) {
      const containers = [...(old.items ?? []), ...(old.pawns ?? []).map((p:any) => p.cargo),
        ...(old.jobs ?? []).flatMap((j:any) => j.deliveredBatches ?? []),
        ...(old.trade?.caravans ?? []).flatMap((c:any) => c.stock ?? [])];
      const ledgers = [old.stats?.produced, old.stats?.consumed, old.stats?.destroyed, old.stats?.spoiled,
        old.trade?.imported, old.trade?.exported];
      if (containers.some(b => b && (b.resource === 'unfinished' || Object.hasOwn(b,'unfinished'))) ||
          old.jobs?.some((j:any) => Object.hasOwn(j,'unfinishedId') || Object.hasOwn(j.cost ?? {},'unfinished') ||
            Object.hasOwn(j.delivered ?? {},'unfinished')) ||
          ledgers.some(l => l && Object.hasOwn(l,'unfinished')) ||
          old.stockpiles?.some((s:any) => s.accepts?.includes('unfinished')) ||
          old.shelves?.some((s:any) => s.settings?.accepts?.includes('unfinished')) ||
          old.storageGroups?.some((s:any) => s.settings?.accepts?.includes('unfinished')))
        throw new Error('旧版存档混入未完成品字段');
    }
    rejectLegacyStorageGroups(old,sourceVersion);
    rejectLegacyShelves(old,sourceVersion);
    rejectLegacyRelocationFields(old,sourceVersion);
    rejectLegacyFurnitureFields(old);
    rejectLegacySocialFields(old);
    rejectLegacyLivingFields(old);
    rejectLegacyPensFields(old);
    rejectLegacyEnvironmentFields(old);
    rejectLegacyWeatherFields(old);
    rejectLegacyFireFields(old);
    rejectLegacySanitationFields(old);
    rejectLegacyPrisonerFields(old);
    if (sourceVersion < 23 && (old.horseshoePins !== undefined || old.pawns?.some((p: any) =>
        p?.psyche !== undefined || ['recreation', 'mental'].includes(p?.phase) || p?.schedule?.includes('recreation')) ||
        old.jobs?.some((j: any) => j?.kind === 'horseshoePin')))
      throw new Error('旧存档包含新版心情娱乐字段');
    rejectLegacyTradeFields(old);
    rejectLegacyStorytellerFields(old);
    rejectLegacyRangedFields(old);
    rejectLegacyMedicineFields(old);
    rejectLegacyHusbandryFields(old);
    rejectLegacyWorldSite(old, sourceVersion);
    rejectLegacyExploration(old, sourceVersion);
    const explored = sourceVersion < 36 ? new Uint8Array(CELLS).fill(1) : loadExploration(old.explored);
    if (old.generator < 3 && explored.some(value => value !== 1))
      throw new Error('旧地图生成器的探索记录必须全部可见');
    if (old.version === 1) {
      if (!Array.isArray(old.jobs) || !Array.isArray(old.pawns) || !old.stats)
        throw new Error('旧存档数据无效');
      for (const j of old.jobs) {
        if (!j || typeof j.cost !== 'number' || typeof j.delivered !== 'number')
          throw new Error('旧存档任务数据无效');
        j.cost = j.cost === 0 ? {} : { wood: j.cost };
        j.delivered = j.delivered === 0 ? {} : { wood: j.delivered };
      }
      for (const p of old.pawns) {
        if (!p) throw new Error('人物数据无效');
        p.priorities = { ...p.priorities, grow: 1, cook: 1 };
        p.eating = null;
      }
      old.farms = [];
      old.crops = [];
      old.stoves = [];
      old.stats = {
        ...old.stats,
        sown: 0,
        harvested: 0,
        cooked: 0,
        eaten: 0,
        produced: { ...old.stats.produced, grain: 0, meal: 0 },
        consumed: { ...old.stats.consumed, grain: 0, meal: 0 },
      };
      old.version = 2;
    }
    if (old.version === 2) {
      if (!Array.isArray(old.pawns)) throw new Error('旧存档人物无效');
      old.beds = [];
      old.doors = [];
      for (const p of old.pawns) {
        if (!p) throw new Error('人物数据无效');
        p.schedule = defaultSchedule();
        p.sleepBedId = null;
        p.sleepingSince = null;
        if (p.phase === 'rest') p.phase = 'idle';
      }
      old.version = 3;
    }
    if (old.version === 3) {
      old.devices = [];
      old.wires = [];
      old.thermal = [];
      old.version = 4;
    }
    if (old.version === 4) {
      if (![old.items, old.pawns, old.jobs, old.stockpiles].every(Array.isArray) || !old.stats)
        throw new Error('旧存档食物或库存数据无效');
      // Earlier saves did not retain species or age. Fresh rice is an explicit
      // compatibility boundary, not recovered historical freshness information.
      for (const item of old.items) {
        if (!item) throw new Error('旧存档物资无效');
        delete item.crop;
        delete item.rotProgress;
        Object.assign(item, freshBatch(item.resource, item.amount));
      }
      for (const pawn of old.pawns)
        if (pawn?.cargo) pawn.cargo = freshBatch(pawn.cargo.resource, pawn.cargo.amount);
      for (const job of old.jobs) {
        if (!job || !job.delivered) throw new Error('旧存档配送物资无效');
        job.deliveredFood = ['grain', 'meal'].flatMap((resource) =>
          job.delivered[resource] > 0
            ? [freshBatch(resource as Resource, job.delivered[resource])]
            : [],
        );
      }
      old.stockpiles = old.stockpiles.map((s: Pos) => ({
        ...s,
        priority: 1,
        accepts: resources.filter(
          (r) => !['silver', 'chunk', 'cloth', 'apparel', 'weapon', 'herb', 'furniture', 'unfinished'].includes(r),
        ),
      }));
      old.stats.spoiled = emptyCounts();
      old.version = 5;
    }
    const migrateLogistics = old.version === 5;
    if (migrateLogistics) {
      if (!Array.isArray(old.jobs)) throw new Error('旧存档任务无效');
      for (const job of old.jobs) {
        if (!job) throw new Error('旧存档任务无效');
        job.cancelled = false;
      }
      old.version = 6;
    }
    const migrateCrafting = old.version === 6;
    if (migrateCrafting) {
      if (
        !Array.isArray(old.jobs) ||
        !Array.isArray(old.pawns) ||
        !old.stats ||
        !['produced', 'consumed', 'spoiled'].every(
          (key) => old.stats[key] && typeof old.stats[key] === 'object',
        )
      )
        throw new Error('旧存档加工数据无效');
      old.stonecutters = [];
      old.stats.stonecut = 0;
      for (const key of ['produced', 'consumed', 'spoiled']) old.stats[key].chunk = 0;
      for (const pawn of old.pawns) {
        if (!pawn?.priorities) throw new Error('旧存档工作优先级无效');
        pawn.priorities.craft = 1;
      }
      for (const job of old.jobs)
        if (job && ['wall', 'floor'].includes(job.kind)) job.material = 'wood';
      // Legacy stone already represented usable building material. Preserve its
      // quantity; old storage filters remain explicit and do not gain chunk.
      old.version = 7;
    }
    if (old.version === 7) {
      if (!Array.isArray(old.trees)) throw new Error('旧存档树木数据无效');
      old.settings = {
        ...DEFAULT_WORLD_SETTINGS,
        hilliness: 'flat',
        meanTemperature: 21,
        latitude: 0,
      };
      old.spawn = { x: 32, y: 34, z: SURFACE };
      for (const tree of old.trees) {
        if (!tree) throw new Error('旧存档树木数据无效');
        tree.species = 'poplar';
      }
      old.version = 8;
    }
    if (old.version === 8) {
      if (!Array.isArray(old.trees) || !Array.isArray(old.jobs) || !old.stats)
        throw new Error('旧存档植被数据无效');
      old.treePlots = [];
      for (const tree of old.trees) {
        if (!tree) throw new Error('旧存档树木数据无效');
        Object.assign(tree, { growth: 1, age: 0, health: 1, unlitTicks: 0, planted: false });
      }
      for (const job of old.jobs)
        if (job?.kind === 'cut') {
          const tree = old.trees.find((t: Tree) => same(t, job));
          if (!tree && !job.cancelled) throw new Error('旧存档采伐对象不存在');
          job.treeSpecies = tree?.species ?? 'poplar';
          job.legacyCut = true;
        }
      old.stats.treesPlanted = 0;
      old.stats.treesRegrown = 0;
      old.stats.treesDied = 0;
      old.version = 9;
    }
    if (old.version === 9) {
      if (!Array.isArray(old.pawns) || !Array.isArray(old.beds))
        throw new Error('旧存档生存数据无效');
      for (const p of old.pawns) {
        if (!p?.priorities) throw new Error('旧存档工作优先级无效');
        Object.assign(p, initialSurvival(old.seed, p.id));
        p.priorities.care = 1;
      }
      for (const bed of old.beds) {
        if (!bed) throw new Error('旧存档床位数据无效');
        bed.medical = false;
      }
      old.version = 10;
    }
    if (old.version === 10) {
      if (!Array.isArray(old.pawns) || !old.stats) throw new Error('旧存档衣物数据无效');
      old.tailors = [];
      for (const p of old.pawns) {
        p.worn = [];
        p.apparelTask = null;
        p.weaponTask = null;
        p.apparelWearTicks = 0;
      }
      for (const key of ['produced', 'consumed', 'spoiled']) {
        old.stats[key].cloth = 0;
        old.stats[key].apparel = 0;
      }
      old.stats.tailored = 0;
      old.stats.destroyed = emptyCounts();
      old.version = 11;
    }
    if (old.version === 11) {
      old.combat = { enabled: false, nextRaid: 0, wave: 0 };
      if (!Array.isArray(old.pawns)) throw new Error('旧人物数据无效');
      for (const p of old.pawns)
        Object.assign(p, {
          trauma: { wounds: [], bloodLoss: 0, brokenParts: [] },
          faction: 'colony',
          drafted: false,
          retreating: false,
          attackTargetId: null,
          nextAttackTick: 0,
          weapon: 'fists',
        });
      old.version = 12;
    }
    if (old.version === 12) {
      if (!Array.isArray(old.pawns) || !old.stats || !Number.isSafeInteger(old.nextId))
        throw new Error('旧武器数据无效');
      old.weaponBenches = [];
      for (const p of old.pawns) {
        if (!['fists', 'steelKnife'].includes(p.weapon)) throw new Error('旧武器种类无效');
        p.weapon = p.weapon === 'steelKnife' ? makeWeapon(old.nextId++, 'steelKnife') : null;
        p.weaponTask = null;
        p.weaponDropPending = !!p.weapon && (p.dead || p.downed);
      }
      for (const key of ['produced', 'consumed', 'spoiled', 'destroyed']) old.stats[key].weapon = 0;
      old.stats.weaponsMade = 0;
      old.version = 13;
    }
    if (old.version === 13) {
      if (!Array.isArray(old.pawns) || !Array.isArray(old.jobs)) throw new Error('旧技能数据无效');
      let profile = 0;
      for (const p of old.pawns) p.skills = initialSkills(profile++, p.faction === 'raider');
      // The old format did not measure elapsed work. Preserve progress, but do
      // not invent historical training or change an existing item's quality.
      for (const j of old.jobs) {
        j.workTicks = 0;
        if (j.kind === 'cook') j.cookTraining = [];
        else delete j.cookTraining;
        if (j.kind === 'mine' || j.kind === 'digLadder') j.miningYieldWork = j.progress;
        else delete j.miningYieldWork;
        delete j.harvestResult;
        delete j.productQuality;
      }
      old.version = 14;
    }
    if (old.version === 14) {
      if (!Array.isArray(old.pawns)) throw new Error('旧研究数据无效');
      let profile = 0;
      for (const p of old.pawns) {
        const initial = initialSkills(profile++, p.faction === 'raider');
        if (!p.skills || !p.priorities) throw new Error('旧技能或优先级无效');
        if (
          sourceVersion === 14 &&
          (Object.keys(p.skills).length !== 7 ||
            Object.hasOwn(p.skills, 'intellectual') ||
            Object.keys(p.priorities).length !== 8 ||
            Object.hasOwn(p.priorities, 'research'))
        )
          throw new Error('旧技能字段无效');
        p.skills.intellectual = initial.intellectual;
        p.priorities.research = p.faction === 'raider' ? 0 : 4;
      }
      old.researchBenches = [];
      old.research = initialResearch(true);
      old.version = 15;
    }
    const migrateAnatomy = old.version === 15;
    const oldHealth = new Map<
      number,
      ReturnType<typeof legacyHealthState> & { needsTending: boolean }
    >();
    if (migrateAnatomy) {
      if (!Array.isArray(old.pawns) || !Number.isSafeInteger(old.nextId) || old.nextId <= 0)
        throw new Error('旧人体存档无效');
      for (const p of old.pawns) {
        const previous = p.trauma;
        const trauma = migrateLegacyTrauma(previous, old.tick, () => old.nextId++);
        oldHealth.set(p.id, {
          ...legacyHealthState(p.health, previous),
          needsTending: previous.wounds.some(
            (w: { tendQuality: number | null }) => w.tendQuality === null,
          ),
        });
        p.trauma = trauma;
      }
      old.version = 16;
    }
    const migrateArmor = old.version === 16;
    if (migrateArmor) {
      if (
        !Array.isArray(old.weaponBenches) ||
        !Array.isArray(old.items) ||
        !Array.isArray(old.pawns) ||
        !Array.isArray(old.jobs) ||
        !old.research?.progress ||
        typeof old.research.progress !== 'object' ||
        (sourceVersion >= 15 &&
          (Object.hasOwn(old.research.progress, 'PlateArmor') ||
            old.research.current === 'PlateArmor'))
      )
        throw new Error('旧护甲或研究数据无效');
      if (old.jobs.some((j: Job) => j.kind === 'armorsmith'))
        throw new Error('旧存档包含新护甲任务');
      const pieces = [
        ...old.items.flatMap((i: Stack) => (i.apparel ? [i.apparel] : [])),
        ...old.pawns.flatMap((p: Pawn) => [
          ...p.worn,
          ...(p.cargo?.apparel ? [p.cargo.apparel] : []),
        ]),
      ];
      if (
        pieces.some((p: ApparelPiece) => !TAILOR_KINDS.includes(p.kind) || p.material !== 'cloth')
      )
        throw new Error('旧存档包含未知衣物');
      for (const bench of old.weaponBenches) {
        if (Object.hasOwn(bench, 'armorBills')) throw new Error('旧存档包含新护甲配方');
        bench.armorBills = (bench.kind === 'smithy' ? ARMOR_KINDS : []).map((kind) => ({
          kind,
          target: 0,
          paused: false,
        }));
      }
      old.research.progress.PlateArmor = 0;
      old.version = 17;
    }
    migrateRangedFields(old);
    migrateMedicineFields(old);
    if (old.version === 19) {
      old.storyteller = initialStoryteller(old.seed, old.tick, old.combat?.enabled ? old.combat.nextRaid : null);
      old.structureKinds = [0, CELLS];
      old.version = 20;
    }
    migrateTradeFields(old, sourceVersion);
    migrateWildlife(old);
    if (old.version === 22) {
      old.horseshoePins = [];
      for (const p of old.pawns) p.psyche = initialPsyche(old.tick);
      old.version = 23;
    }
    migratePrisoners(old, sourceVersion);
    migrateSanitation(old, sourceVersion);
    migrateFire(old, sourceVersion);
    migrateWeather(old, sourceVersion);
    migrateEnvironment(old, sourceVersion);
    migrateHusbandry(old, sourceVersion);
    migratePens(old, sourceVersion);
    migrateLiving(old, sourceVersion);
    migrateSocial(old, sourceVersion);
    migrateFurniture(old, sourceVersion);
    migrateRelocation(old,sourceVersion);
    if (sourceVersion < 35) old.worldSite = null;
    migrateShelves(old,sourceVersion);
    migrateStorageGroups(old,sourceVersion);
    if (sourceVersion < 39) {
      if (old.productionQueues !== undefined || old.jobs?.some((j: any) => j.billId !== undefined))
        throw new Error('旧版存档混入生产账单字段');
      old.productionQueues = [];
    }
    if (sourceVersion < 40) {
      if (old.jobs?.some((j: any) => Object.hasOwn(j, 'productionPolicy')) ||
          (Array.isArray(old.productionQueues) && old.productionQueues.some((q: any) =>
            Array.isArray(q?.bills) && q.bills.some((b: any) => b && Object.hasOwn(b, 'policy')))))
        throw new Error('旧版存档混入生产分工与原料策略字段');
      if (Array.isArray(old.productionQueues)) for (const queue of old.productionQueues) {
        if (Array.isArray(queue?.bills)) for (const bill of queue.bills)
          if (bill && typeof bill === 'object') bill.policy = defaultProductionPolicy();
      }
      for (const job of old.jobs ?? []) if (productionJobRecipe(job) &&
          (job.owner !== null || job.progress > 0 || Object.values(job.delivered ?? {}).some(n => Number(n) > 0)))
        job.productionPolicy = defaultProductionPolicy();
    }
    if (sourceVersion < 41) {
      for (const ledger of [old.stats?.produced, old.stats?.consumed, old.stats?.destroyed, old.stats?.spoiled,
        old.trade?.imported, old.trade?.exported]) {
        if (!ledger || typeof ledger !== 'object') throw new Error('旧版资源账本缺失');
        ledger.unfinished = 0;
      }
    }
    if (sourceVersion < 42) {
      old.stockpileZones = migrateStockpileZones(old.stockpiles);
      for (const queue of old.productionQueues ?? []) for (const bill of queue.bills ?? [])
        bill.output = defaultProductionOutput('drop');
    }
    if (sourceVersion < 43) { old.water = [0, CELLS]; old.bridges = [0, CELLS]; }
    if (sourceVersion < 44) for (const p of old.pawns ?? []) p.allowedAreaId = null;
    migrateMilk(old, sourceVersion);
    migrateWool(old, sourceVersion);
    old.version = 50;
    if(!Array.isArray(old.storageGroups))throw new Error('储存组列表无效');
    const worldSite = validateWorldSiteIdentity(old);
    const d = old as VoxelSave;
    const loadHealth = (p: Pawn) =>
      oldHealth.get(p.id) ?? {
        ...healthSummary(p),
        dead: healthDeathReason(p.health, p.trauma, p.medical) !== null,
        deathReason: healthDeathReason(p.health, p.trauma, p.medical),
      };
    const loadNeedsTending = (p: Pawn) =>
      oldHealth.get(p.id)?.needsTending ?? needsMedicalTending(p, d.tick);
    if (!validResearch(d.research)) throw new Error('研究进度、前置或当前项目无效');
    if (
      !validWorldSettings(d.settings) ||
      !inside(d.spawn) ||
      d.spawn.z < 1 ||
      d.spawn.z >= HEIGHT - 1
    )
      throw new Error('世界配置或出生点无效');
    if (
      !Number.isSafeInteger(d.seed) ||
      !Number.isSafeInteger(d.tick) ||
      d.tick < 0 ||
      !Number.isSafeInteger(d.nextId) ||
      d.nextId < 1
    )
      throw new Error('存档计时或种子无效');
    const arrays: [unknown, number][] = [
      [d.fires, FIRE_RULES.maxFires],
      [d.fireDamage, FIRE_RULES.maxDamage],
      [d.filth, SANITATION_RULES.maxFilth],
      [d.pawns, 64],
      [d.animals, HUSBANDRY_RULES.maxAnimals],
      [d.grass, HUSBANDRY_RULES.maxGrass],
      [d.butcherSpots, 128],
      [d.tables, 128], [d.chairs, 256],
      [d.shelves, 256], [d.storageSpills, 4096],
      [d.horseshoePins, 128],
      [d.items, 10000],
      [d.trees, 4096],
      [d.treePlots, 512],
      [d.jobs, 512],
      [d.stockpiles, 4096],
      [d.farms, 512],
      [d.crops, 512],
      [d.stoves, 512],
      [d.stonecutters, 128],
      [d.tailors, 128],
      [d.weaponBenches, 128],
      [d.sandbags, 512],
      [d.researchBenches, 128],
      [d.beds, 128],
      [d.doors, 512],
      [d.fences,PEN_RULES.maxFences], [d.fenceGates,PEN_RULES.maxGates], [d.penMarkers,PEN_RULES.maxMarkers],
      [d.devices, 256],
      [d.wires, 4096],
    ];
    for (const [a, max] of arrays)
      if (!Array.isArray(a) || a.length > max || (a as Pos[]).some((p) => !p || !inside(p)))
        throw new Error('存档对象数量或坐标无效');
    if (
      !Array.isArray(d.projectiles) ||
      d.projectiles.length > 256 ||
      d.projectiles.some((p) => !p)
    )
      throw new Error('弹丸数组无效');
    if (d.pawns.length > 64 || d.pawns.filter((p) => p.faction === 'colony').length < 3)
      throw new Error('存档需保留初始三名殖民者（含遗体），人物与遗体上限64');
    if (
      !d.combat ||
      typeof d.combat.enabled !== 'boolean' ||
      !Number.isSafeInteger(d.combat.nextRaid) ||
      d.combat.nextRaid < 0 ||
      !Number.isSafeInteger(d.combat.wave) ||
      d.combat.wave < 0 ||
      (!d.combat.enabled && d.combat.nextRaid !== 0)
    )
      throw new Error('袭击日程无效');
    const positive = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 10000000;
    const zero = (n: number) => Number.isFinite(n) && n >= 0 && n <= 10000000;
    const ids = new Set<number>();
    for (const e of [
      ...d.fires,
      ...d.filth,
      ...d.pawns,
      ...d.animals,
      ...d.butcherSpots,
      ...d.tables, ...d.chairs, ...d.shelves,
      ...d.horseshoePins,
      ...d.items,
      ...d.trees,
      ...d.jobs,
      ...d.crops,
      ...d.stoves,
      ...d.stonecutters,
      ...d.tailors,
      ...d.weaponBenches,
      ...d.researchBenches,
      ...d.beds,
      ...d.doors, ...d.fences, ...d.fenceGates, ...d.penMarkers,
      ...d.devices,
      ...d.sandbags,
      ...d.projectiles, ...d.animalAreas, ...d.storageGroups,
    ]) {
      if (!positive(e.id) || ids.has(e.id) || e.id >= d.nextId)
        throw new Error('重复或无效的对象编号');
      ids.add(e.id);
    }
    for (const i of d.items) if (!validBatch(i)) throw new Error('物资种类、数量或腐坏进度无效');
    if (
      !migrateLogistics &&
      (d.items.some(
        (i) =>
          i.amount > stackLimit(i.resource) ||
          Object.keys(i).some(
            (key) =>
              ![
                'id',
                'resource',
                'amount',
                'crop',
                'rotProgress',
                'apparel',
                'weapon',
                'forbidden',
                'carcass',
                'poisonChance',
                'hitPoints',
                'furniture',
                'unfinished',
                'x',
                'y',
                'z',
              ].includes(key),
          ),
      ))
    )
      throw new Error('物品字段或单堆上限无效');
    for (const t of d.trees)
      if (
        !positive(t.wood) ||
        t.z < 1 ||
        t.z + 1 >= HEIGHT ||
        !Object.hasOwn(TREE_DATA, t.species) ||
        !Number.isFinite(t.growth) ||
        t.growth < 0 ||
        t.growth > 1 ||
        !Number.isSafeInteger(t.age) ||
        t.age < 0 ||
        !Number.isSafeInteger(t.unlitTicks) ||
        t.unlitTicks < 0 ||
        t.unlitTicks > t.age ||
        !Number.isFinite(t.health) ||
        t.health <= 0 ||
        t.health > 1 ||
        typeof t.planted !== 'boolean'
      )
        throw new Error('树木数据无效');
    const uniqueCells = (a: Pos[]) => new Set(a.map(at)).size === a.length;
    if (
      ![
        d.trees,
        d.treePlots,
        d.farms,
        d.crops,
        d.stoves,
        d.butcherSpots,
        d.horseshoePins,
        d.stonecutters,
        d.tailors,
        d.weaponBenches,
        d.researchBenches,
        d.stockpiles,
        d.doors,
        d.wires,
        d.sandbags,
      ].every(uniqueCells)
    )
      throw new Error('区域或设施位置重复');
    for (const plot of d.treePlots)
      if (
        !Object.hasOwn(TREE_DATA, plot.species) ||
        plot.z < 1 ||
        plot.z >= HEIGHT - 1 ||
        d.farms.some((f) => same(f, plot)) ||
        d.stockpiles.some((s) => same(s, plot)) ||
        d.treePlots.some(
          (other) =>
            other !== plot &&
            Math.abs(other.x - plot.x) <= 1 &&
            Math.abs(other.y - plot.y) <= 1 &&
            Math.abs(other.z - plot.z) <= 1,
        )
      )
        throw new Error('林地区树种、间距或位置无效');
    for (const stock of d.stockpiles)
      if (
        !Number.isInteger(stock.priority) ||
        stock.priority < 0 ||
        stock.priority > 3 ||
        !Array.isArray(stock.accepts) ||
        stock.accepts.length > resources.length ||
        new Set(stock.accepts).size !== stock.accepts.length ||
        stock.accepts.some((resource) => !resources.includes(resource))
      )
        throw new Error('仓储优先级或接收规则无效');
    for (const f of d.farms)
      if (
        !Object.hasOwn(CROPS, f.crop) ||
        f.z < 1 ||
        f.z >= HEIGHT - 1 ||
        d.stockpiles.some((s) => same(s, f))
      )
        throw new Error('种植区数据无效');
    for (const c of d.crops)
      if (
        !Object.hasOwn(CROPS, c.kind) ||
        !zero(c.growth) ||
        c.growth > 1 ||
        !Number.isSafeInteger(c.sownAt) ||
        c.sownAt < 0 ||
        c.sownAt > d.tick ||
        !d.farms.some((f) => same(c, f))
      )
        throw new Error('作物数据无效');
    for (const s of d.stoves)
      if (
        !Number.isInteger(s.target) ||
        s.target < 0 ||
        s.target > 100 ||
        typeof s.paused !== 'boolean' ||
        s.z < 1 ||
        s.z >= HEIGHT - 1 ||
        d.farms.some((f) => same(f, s))
      )
        throw new Error('灶台数据无效');
    for (const b of d.beds)
      if (
        typeof b.medical !== 'boolean' ||
        (b.medical && !b.prisoner && b.owner !== null) ||
        !['x', 'y'].includes(b.axis) ||
        bedCells(b).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        (b.owner !== null && !d.pawns.some((p) => p.id === b.owner))
      )
        throw new Error('床位数据无效');
    for (const b of d.researchBenches)
      if (
        !['x', 'y'].includes(b.axis) ||
        Object.keys(b).length !== 5 ||
        researchBenchCells(b).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        !inside(researchBenchInteraction(b))
      )
        throw new Error('科研台数据无效');
    for (const b of d.tailors) {
      if (
        !['x', 'y'].includes(b.axis) ||
        tailorCells(b).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        !inside(tailorInteraction(b)) ||
        !Array.isArray(b.bills) ||
        b.bills.length !== TAILOR_KINDS.length ||
        new Set(b.bills.map((bill) => bill.kind)).size !== TAILOR_KINDS.length ||
        b.bills.some(
          (bill) =>
            !TAILOR_KINDS.includes(bill.kind) ||
            !Number.isInteger(bill.target) ||
            bill.target < 0 ||
            bill.target > 100 ||
            typeof bill.paused !== 'boolean',
        )
      )
        throw new Error('裁缝台或衣物配方无效');
    }
    for (const bench of d.weaponBenches) {
      if (
        !isWeaponBenchKind(bench.kind) ||
        !['x', 'y'].includes(bench.axis) ||
        !zero(bench.fuel) ||
        bench.fuel > SMITHY_FUEL_CAPACITY ||
        (bench.kind !== 'smithy' && bench.fuel !== 0) ||
        weaponBenchCells(bench).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        !inside(weaponBenchInteraction(bench)) ||
        !Array.isArray(bench.bills)
      )
        throw new Error('武器工作台数据无效');
      if (bench.kind === 'machining') {
        const power = bench.power;
        if (
          !power ||
          power.id !== bench.id ||
          !same(power, bench) ||
          power.kind !== 'workbench' ||
          power.consumption !== MACHINING_POWER ||
          typeof power.on !== 'boolean' ||
          typeof power.powered !== 'boolean'
        )
          throw new Error('机械台电源数据无效');
        power.active = false;
        power.watts = -MACHINING_POWER;
        power.networkId = null;
        power.reason = '等待电网更新';
      } else if (bench.power !== undefined) throw new Error('非电力工作台不能包含电源');
      const kinds = WEAPON_KINDS.filter((k) => WEAPON_DEFS[k].benches.includes(bench.kind));
      if (
        bench.bills.length !== kinds.length ||
        new Set(bench.bills.map((b) => b.kind)).size !== kinds.length ||
        bench.bills.some(
          (b) =>
            !kinds.includes(b.kind) ||
            !Number.isInteger(b.target) ||
            b.target < 0 ||
            b.target > 100 ||
            typeof b.paused !== 'boolean',
        )
      )
        throw new Error('武器配方无效');
      const armorKinds = bench.kind === 'smithy' ? ARMOR_KINDS : [];
      if (
        !Array.isArray(bench.armorBills) ||
        bench.armorBills.length !== armorKinds.length ||
        new Set(bench.armorBills.map((b) => b.kind)).size !== armorKinds.length ||
        bench.armorBills.some(
          (b) =>
            !armorKinds.includes(b.kind) ||
            !Number.isInteger(b.target) ||
            b.target < 0 ||
            b.target > 100 ||
            typeof b.paused !== 'boolean',
        )
      )
        throw new Error('护甲配方无效');
    }
    for (const bench of d.stonecutters)
      if (
        !['x', 'y'].includes(bench.axis) ||
        !Number.isInteger(bench.target) ||
        bench.target < 0 ||
        bench.target > 2000 ||
        typeof bench.paused !== 'boolean' ||
        stonecutterCells(bench).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        !inside(stonecutterInteraction(bench))
      )
        throw new Error('切石台数据无效');
    const owners = d.beds.flatMap((b) => (b.owner === null ? [] : [b.owner]));
    if (new Set(owners).size !== owners.length) throw new Error('人物拥有多个床位');
    for (const device of d.devices) {
      if (
        !isDeviceKind(device.kind) ||
        !['x', 'y'].includes(device.axis) ||
        typeof device.on !== 'boolean' ||
        !zero(device.fuel) ||
        device.fuel > 75 ||
        !zero(device.energy) ||
        device.energy > 600 ||
        !Number.isInteger(device.target) ||
        device.target < -50 ||
        device.target > 50 ||
        deviceCells(device).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        (device.kind !== 'generator' && device.fuel !== 0) ||
        (device.kind !== 'battery' && device.energy !== 0)
      )
        throw new Error('电力设备数据无效');
      if (typeof device.powered !== 'boolean') throw new Error('供电状态无效');
      device.active = false;
      device.watts = 0;
      device.networkId = null;
      device.reason = '存档恢复，等待电网更新';
    }
    for (const bag of d.sandbags)
      if (
        !Number.isInteger(bag.hitPoints) ||
        bag.hitPoints <= 0 ||
        bag.hitPoints > SANDBAG_HP ||
        bag.z < 1 ||
        bag.z >= HEIGHT - 1
      )
        throw new Error('沙袋生命或高度无效');
    const furniture = [
      ...d.butcherSpots,
      ...d.tables.flatMap(tableCells), ...d.chairs, ...d.shelves.flatMap(shelfCells),
      ...d.horseshoePins,
      ...d.sandbags,
      ...d.beds.flatMap(bedCells),
      ...d.doors, ...d.fences, ...d.fenceGates, ...d.penMarkers,
      ...d.stoves,
      ...d.stonecutters.flatMap(stonecutterCells),
      ...d.tailors.flatMap(tailorCells),
      ...d.researchBenches.flatMap(researchBenchCells),
      ...d.weaponBenches.flatMap(weaponBenchCells),
      ...d.devices.flatMap(deviceCells),
    ];
    if (
      !uniqueCells(furniture.flatMap((p) => [p, { ...p, z: p.z + 1 }])) ||
      furniture.some(
        (v) =>
          d.farms.some((f) => same(f, v)) ||
          d.stockpiles.some((s) => same(s, v)) ||
          d.treePlots.some((f) => same(f, v)),
      )
    )
      throw new Error('设施位置重叠');
    for (const door of d.doors)
      if (
        !['x', 'y'].includes(door.axis) ||
        !['auto', 'open', 'locked'].includes(door.mode) ||
        !Number.isSafeInteger(door.openUntil) ||
        door.openUntil < 0 ||
        door.z < 1 ||
        door.z >= HEIGHT - 1
      )
        throw new Error('门数据无效');
    const materialMap = (m: Partial<Counts>) =>
      m &&
      typeof m === 'object' &&
      !Array.isArray(m) &&
      Object.entries(m).every(
        ([r, n]) =>
          resources.includes(r as Resource) && Number.isSafeInteger(n) && n >= 0 && n <= 10000000,
      );
    const plainCargo = (batch: Cargo) =>
      validBatch(batch) &&
      Object.keys(batch).every((key) =>
        ['resource', 'amount', 'crop', 'rotProgress', 'apparel', 'weapon', 'forbidden', 'carcass', 'poisonChance', 'hitPoints', 'furniture', 'unfinished'].includes(
          key,
        ),
      );
    for (const j of d.jobs) {
      if (!Number.isSafeInteger(j.workTicks) || j.workTicks < 0 || j.workTicks > d.tick)
        throw new Error('实际劳动计时无效');
      if (j.kind === 'cook') {
        if (
          !Array.isArray(j.cookTraining) ||
          j.cookTraining.length > 64 ||
          j.cookTraining.some(
            (c) =>
              !c ||
              typeof c !== 'object' ||
              Object.keys(c).length !== 2 ||
              !Number.isSafeInteger(c.pawnId) ||
              c.pawnId <= 0 ||
              c.pawnId >= d.nextId ||
              !Number.isSafeInteger(c.ticks) ||
              c.ticks <= 0,
          ) ||
          new Set(j.cookTraining.map((c) => c.pawnId)).size !== j.cookTraining.length ||
          j.cookTraining.reduce((n, c) => n + c.ticks, 0) !== j.workTicks
        )
          throw new Error('烹饪学习记录无效');
      } else if (j.cookTraining !== undefined) throw new Error('非烹饪任务含烹饪学习记录');
      if (j.kind === 'mine' || j.kind === 'digLadder') {
        if (
          !Number.isFinite(j.miningYieldWork) ||
          j.miningYieldWork! < 0 ||
          j.miningYieldWork! > j.progress * 1.25 + 1e-7
        )
          throw new Error('采矿贡献记录无效');
      } else if (j.miningYieldWork !== undefined) throw new Error('非采矿任务含采矿贡献记录');
      if (j.harvestResult !== undefined) {
        const h = j.harvestResult;
        if (
          !h ||
          typeof h !== 'object' ||
          Array.isArray(h) ||
          Object.keys(h).length !== 3 ||
          !['cut', 'harvest'].includes(j.kind) ||
          j.progress !== j.work ||
          !Number.isSafeInteger(h.amount) ||
          h.amount < 0 ||
          h.amount > 100 ||
          !Number.isInteger(h.skill) ||
          h.skill < 0 ||
          h.skill > 20 ||
          !Number.isSafeInteger(h.workerId) ||
          h.workerId <= 0 ||
          h.workerId >= d.nextId
        )
          throw new Error('收获结果记录无效');
      }
      if (j.productQuality !== undefined) {
        const q = j.productQuality;
        if (
          !q ||
          typeof q !== 'object' ||
          Array.isArray(q) ||
          Object.keys(q).length !== 3 ||
          !(
            j.kind === 'tailoring' ||
            j.kind === 'armorsmith' ||
            (j.kind === 'smith' && WEAPON_DEFS[j.weaponKind!]?.hasQuality)
          ) ||
          j.progress !== j.work ||
          !Number.isInteger(q.value) ||
          q.value < 0 ||
          q.value > 5 ||
          !Number.isInteger(q.skill) ||
          q.skill < 0 ||
          q.skill > 20 ||
          !Number.isSafeInteger(q.workerId) ||
          q.workerId <= 0 ||
          q.workerId >= d.nextId
        )
          throw new Error('制作完成品质记录无效');
      }
      if (
        j.kind === 'smith'
          ? !WEAPON_KINDS.includes(j.weaponKind!) ||
            !isWeaponBenchKind(j.weaponBenchKind!) ||
            !WEAPON_DEFS[j.weaponKind!].benches.includes(j.weaponBenchKind!) ||
            (!j.cancelled &&
              !d.weaponBenches.some(
                (b) =>
                  same(b, j) &&
                  b.kind === j.weaponBenchKind &&
                  b.bills.some((v) => v.kind === j.weaponKind && (j.billId !== undefined || !v.paused)),
              ))
          : j.weaponKind !== undefined || j.weaponBenchKind !== undefined
      )
        throw new Error('武器加工任务无效');
      if (
        ['smith', 'armorsmith', 'refuel', 'research'].includes(j.kind) &&
        d.jobs.some(
          (other) =>
            other !== j &&
            !other.cancelled &&
            !j.cancelled &&
            (other.kind === j.kind ||
              (['smith', 'armorsmith'].includes(j.kind) &&
                ['smith', 'armorsmith'].includes(other.kind))) &&
            same(other, j),
        )
      )
        throw new Error('工作台存在重复加工或加油任务');
      if (
        j.kind === 'research'
          ? !RESEARCH_KEYS.includes(j.researchProject!) ||
            j.researchProject !== d.research.current ||
            !d.researchBenches.some((b) => same(b, j)) ||
            j.progress !== j.workTicks ||
            j.progress >= j.work ||
            j.cancelled
          : j.researchProject !== undefined
      )
        throw new Error('研究任务与全局项目不一致');
      if (
        !Object.hasOwn(JOB_NAMES, j.kind) ||
        j.z < 1 ||
        j.z >= HEIGHT - 1 ||
        !zero(j.progress) ||
        !positive(j.work) ||
        typeof j.cancelled !== 'boolean' ||
        (j.kind === 'tailoring'
          ? !TAILOR_KINDS.includes(j.apparelKind!)
          : j.kind === 'armorsmith'
            ? !(ARMOR_KINDS as readonly ApparelKind[]).includes(j.apparelKind!)
            : j.apparelKind !== undefined) ||
        (j.unfinishedId === undefined && j.work !==
          workOf(
            j.kind,
            j.material,
            j.treeSpecies,
            j.legacyCut,
            j.apparelKind,
            j.weaponKind,
            j.weaponBenchKind,
            j.cropKind,
          )) ||
        (j.cropKind !== undefined &&
          (!['sow', 'harvest'].includes(j.kind) || !Object.hasOwn(CROPS, j.cropKind))) ||
        (!j.cancelled &&
          j.kind === 'sow' &&
          j.cropKind !== undefined &&
          !d.farms.some((f) => same(f, j) && f.crop === j.cropKind)) ||
        (!j.cancelled &&
          j.kind === 'harvest' &&
          j.cropKind !== undefined &&
          !d.crops.some((c) => same(c, j) && c.kind === j.cropKind)) ||
        (['cut', 'plantTree'].includes(j.kind)
          ? !Object.hasOwn(TREE_DATA, j.treeSpecies ?? '')
          : j.treeSpecies !== undefined) ||
        (j.legacyCut !== undefined && (j.legacyCut !== true || j.kind !== 'cut')) ||
        (!j.cancelled &&
          j.kind === 'cut' &&
          !d.trees.some((t) => same(t, j) && t.species === j.treeSpecies)) ||
        (!j.cancelled &&
          j.kind === 'plantTree' &&
          !d.treePlots.some((f) => same(f, j) && f.species === j.treeSpecies)) ||
        (['wall', 'floor'].includes(j.kind)
          ? !['wood', 'stone'].includes(j.material ?? '')
          : j.material !== undefined) ||
        ((['shelf', 'smallShelf', 'table', 'chair', 'bed', 'door', 'fenceGate', 'stonecutter', 'tailor', 'smithy', 'machining', 'researchBench'].includes(
          j.kind,
        ) ||
          isDeviceKind(j.kind)) &&
          (!['x', 'y'].includes(j.axis ?? '') ||
            (j.kind === 'researchBench' &&
              (researchBenchCells({ ...j, axis: j.axis! }).some((p) => !inside(p)) ||
                !inside(researchBenchInteraction({ ...j, axis: j.axis! })))) ||
            (isShelfKind(j.kind) && shelfCells({ ...j, kind:j.kind, axis:j.axis! }).some(p=>!inside(p))) ||
            (j.kind === 'bed' && bedCells({ ...j, axis: j.axis! }).some((p) => !inside(p))) ||
            (j.kind === 'table' && tableCells({ ...j, axis: j.axis! }).some((p) => !inside(p))) ||
            ((j.kind === 'stonecutter' ||
              j.kind === 'tailor' ||
              j.kind === 'smithy' ||
              j.kind === 'machining') &&
              (stonecutterCells({ ...j, axis: j.axis! }).some((p) => !inside(p)) ||
                !inside(stonecutterInteraction({ ...j, axis: j.axis! })))) ||
            (isDeviceKind(j.kind) &&
              deviceCells({ ...j, kind: j.kind, axis: j.axis! }).some((p) => !inside(p))))) ||
        !materialMap(j.cost) ||
        !materialMap(j.delivered) ||
        (j.kind === 'cook' && (j.cost.grain ?? 0) + (j.cost.meat ?? 0) + (j.cost.milk ?? 0) !== SIMPLE_MEAL.ingredients) ||
        resources.some(
          (r) =>
            (j.cost[r] ?? 0) !==
              (j.kind === 'cook' && (r === 'grain' || r === 'meat' || r === 'milk') ? (j.cost[r] ?? 0) : j.kind === 'refuel'
                ? r === 'wood'
                  ? j.cost.wood
                  : 0
                : ((j.kind === 'tailoring' ? apparelCost(j.apparelKind!, j.cost.alpacaWool ? 'alpacaWool' : 'cloth') : costOf(j.kind, j.material, j.apparelKind, j.weaponKind, j.weaponBenchKind))[r] ??
                  0)) || (j.delivered[r] ?? 0) > (j.cost[r] ?? 0),
        ) ||
        (!j.cancelled && j.kind === 'butcher' && !d.butcherSpots.some(s => same(s, j) && (j.billId !== undefined || !s.paused))) ||
        (!j.cancelled && j.kind === 'cook' && !d.stoves.some((s) => same(s, j))) ||
        (!j.cancelled && j.kind === 'stonecut' && !d.stonecutters.some((b) => same(b, j))) ||
        (!j.cancelled && j.kind === 'tailoring' && !d.tailors.some((b) => same(b, j))) ||
        (!j.cancelled &&
          j.kind === 'armorsmith' &&
          (!!armorResearchReason(d.research, j.apparelKind!) ||
            !d.weaponBenches.some(
              (b) =>
                b.kind === 'smithy' &&
                same(b, j) &&
                b.armorBills.some((bill) => bill.kind === j.apparelKind && (j.billId !== undefined || !bill.paused)),
            ))) ||
        (j.kind === 'refuel' &&
          (!positive(j.cost.wood!) ||
            j.cost.wood! > 75 ||
            (!j.cancelled &&
              !d.devices.some((v) => v.kind === 'generator' && same(v, j)) &&
              !d.weaponBenches.some(
                (b) => b.kind === 'smithy' && same(b, j) && j.cost.wood! <= 50,
              ))))
      )
        throw new Error('任务数据无效');
      if (
        !Array.isArray(j.deliveredBatches) ||
        j.deliveredBatches.length > 18 ||
        j.deliveredBatches.some(
          (batch) =>
            !(migrateLogistics ? validBatch(batch) : plainCargo(batch)),
        ) ||
        new Set(j.deliveredBatches.map((batch) => `${batch.resource}/${batch.crop ?? ''}`)).size !==
          j.deliveredBatches.length ||
        resources.some(
          (resource) =>
            j.deliveredBatches
              .filter((batch) => batch.resource === resource)
              .reduce((sum, batch) => sum + batch.amount, 0) !== (j.delivered[resource] ?? 0),
        )
      )
        throw new Error('配送实物批次与任务数量不一致');
      validateConstructionFailure(j,d.nextId);
    }
    validateMedicineState(d);
    for (const p of d.pawns) {
      if (!validSkills(p.skills)) throw new Error('人物技能数据无效');
      if (
        !validTrauma(p.trauma, d.tick) ||
        !['colony', 'raider', 'trader', 'prisoner'].includes(p.faction) ||
        (p.weapon !== null && !validWeapon(p.weapon)) ||
        typeof p.weaponDropPending !== 'boolean' ||
        (p.weaponDropPending && !p.weapon) ||
        typeof p.drafted !== 'boolean' ||
        typeof p.retreating !== 'boolean' ||
        (p.retreating && (p.faction !== 'raider' || p.attackTargetId !== null)) ||
        (p.faction === 'raider' && (p.cargo !== null || p.worn.length !== 0)) ||
        (p.drafted && (p.faction !== 'colony' || p.dead || p.downed)) ||
        !Number.isSafeInteger(p.nextAttackTick) ||
        p.nextAttackTick < 0 ||
        p.nextAttackTick > d.tick + 200 ||
        (p.attackTargetId !== null &&
          (p.phase === 'hunt'
            ? !d.animals.some(a => a.id === p.attackTargetId && a.hunt && !a.dead)
            : (!d.pawns.some(q => q.id === p.attackTargetId && q.id !== p.id && !q.dead && !q.downed) ||
              (!p.drafted && p.faction === 'colony')))) ||
        (!p.dead &&
          !p.downed &&
          (p.drafted || p.faction === 'raider') &&
          p.phase !== 'combat' &&
          p.phase !== 'weapon')
      )
        throw new Error('人物外伤或战斗状态无效');
      for (const id of traumaIds(p.trauma)) {
        if (ids.has(id) || id >= d.nextId) throw new Error('伤情身份重复或无效');
        ids.add(id);
      }
      for (const infection of p.medical.infections) {
        if (ids.has(infection.id) || infection.id >= d.nextId)
          throw new Error('感染身份重复或无效');
        ids.add(infection.id);
      }
      if (
        !Array.isArray(p.worn) ||
        p.worn.length > 5 ||
        p.worn.some((piece) => !validApparel(piece)) ||
        p.worn.some((piece, i) =>
          p.worn.slice(i + 1).some((other) => !compatibleApparel(piece, other)),
        ) ||
        !Number.isSafeInteger(p.apparelWearTicks) ||
        p.apparelWearTicks < 0 ||
        p.apparelWearTicks > d.tick ||
        (p.apparelTask === null) !== (p.phase !== 'apparel')
      )
        throw new Error('人物衣物或穿戴任务无效');
      if ((p.weaponTask === null) !== (p.phase !== 'weapon')) throw new Error('武器任务阶段无效');
      if (p.weaponTask !== null) {
        const task = p.weaponTask;
        if (
          !task ||
          !['equip', 'drop'].includes(task.action) ||
          !['fetch', 'work'].includes(task.stage) ||
          !positive(task.weaponId) ||
          !Number.isInteger(task.progress) ||
          task.progress < 0 ||
          task.progress > (task.action === 'drop' ? WEAPON_DROP_TICKS : 0) ||
          p.dead ||
          p.downed ||
          p.carriedBy !== null ||
          p.weaponDropPending ||
          loadHealth(p).manipulation <= 0 ||
          p.faction !== 'colony' ||
          p.jobId !== null ||
          p.eating !== null ||
          p.carePhase !== null ||
          p.apparelTask !== null ||
          d.pawns.some((q) => q !== p && q.weaponTask?.weaponId === task.weaponId)
        )
          throw new Error('武器预定无效');
        const piece =
          task.action === 'drop'
            ? p.weapon
            : task.stage === 'fetch'
              ? d.items.find((i) => i.weapon?.id === task.weaponId)?.weapon
              : p.cargo?.weapon;
        if (
          !piece ||
          piece.id !== task.weaponId ||
          (task.action === 'drop' && task.stage !== 'work') ||
          (task.stage === 'fetch' && (p.cargo !== null || task.progress !== 0))
        )
          throw new Error('武器实例不存在或取用阶段无效');
      }
      if (p.apparelTask !== null) {
        const task = p.apparelTask;
        if (
          !task ||
          !['wear', 'remove'].includes(task.action) ||
          !['fetch', 'work'].includes(task.stage) ||
          !Number.isSafeInteger(task.apparelId) ||
          task.apparelId <= 0 ||
          !Number.isFinite(task.progress) ||
          task.progress < 0 ||
          (task.stage === 'fetch' && task.progress !== 0) ||
          p.dead ||
          p.downed ||
          p.carriedBy !== null ||
          d.pawns.some((q) => q.id !== p.id && q.apparelTask?.apparelId === task.apparelId)
        )
          throw new Error('穿脱衣物预定无效');
        const piece =
          task.action === 'remove'
            ? p.worn.find((piece) => piece.id === task.apparelId)
            : task.stage === 'fetch'
              ? d.items.find((i) => i.apparel?.id === task.apparelId)?.apparel
              : p.cargo?.apparel;
        if (
          !piece ||
          piece.id !== task.apparelId ||
          (task.action === 'remove' && task.stage !== 'work') ||
          (task.stage === 'fetch' && p.cargo !== null) ||
          task.progress >
            apparelDelay(piece) +
              (task.action === 'wear'
                ? p.worn
                    .filter((old) => !compatibleApparel(old, piece))
                    .reduce((n, old) => n + apparelDelay(old), 0)
                : 0)
        )
          throw new Error('穿戴衣物实例不存在或进度无效');
      }
      if (
        !p.health ||
        Object.keys(p.health).length !== 4 ||
        !['malnutrition', 'hypothermia', 'heatstroke'].every(
          (key) =>
            Number.isFinite(p.health[key as 'malnutrition']) &&
            p.health[key as 'malnutrition'] >= 0 &&
            p.health[key as 'malnutrition'] <= 1,
        ) ||
        !Number.isFinite(p.health.starvationFactor) ||
        p.health.starvationFactor < 0.8 ||
        p.health.starvationFactor > 1.2 ||
        typeof p.dead !== 'boolean' ||
        typeof p.downed !== 'boolean' ||
        p.dead !== loadHealth(p).dead ||
        p.deathReason !== (p.dead ? loadHealth(p).deathReason : null) ||
        p.downed !==
          (!p.dead &&
            (loadHealth(p).pain >= 0.8 ||
              loadHealth(p).consciousness < 0.3 ||
              loadHealth(p).moving <= 0.15)) ||
        ![
          'dine',
          'idle',
          'travel',
          'work',
          'fetch',
          'haul',
          'rest',
          'sleepTravel',
          'care',
          'apparel',
          'combat',
          'hunt',
          'handle', 'rope',
          'firefight',
          'repair',
          'clean',
          'recreation',
          'mental',
          'warden',
          'prisoner',
          'weapon',
          'trade',
          'downed',
          'dead',
        ].includes(p.phase) ||
        (p.dead
          ? p.phase !== 'dead'
          : p.downed
            ? p.phase !== 'downed'
            : ['dead', 'downed'].includes(p.phase)) ||
        !Array.isArray(p.path) ||
        p.path.length > CELLS ||
        p.path.some((v) => !Number.isInteger(v) || v < 0 || v >= CELLS) ||
        (p.destination !== null &&
          (!Number.isInteger(p.destination) || p.destination < 0 || p.destination >= CELLS)) ||
        !Number.isFinite(p.careProgress) ||
        p.careProgress < 0 ||
        p.careProgress >= (p.carePhase === 'tend' ? MEDICAL_CARE_WORK : FEED_WORK) ||
        !Number.isSafeInteger(p.careAmount) ||
        p.careAmount < 0 ||
        p.careAmount > 75 ||
        ![
          null,
          'rescueApproach',
          'rescueCarry',
          'feedFetch',
          'feedApproach',
          'feed',
          'tendFetch',
          'tendApproach',
          'tend',
        ].includes(p.carePhase) ||
        (p.carePhase === null) !== (p.patientId === null) ||
        (p.carePhase === null) !== (p.phase !== 'care') ||
        (p.carePhase === null &&
          (p.careBedId !== null ||
            p.careFoodId !== null ||
            p.careMedicineId !== null ||
            p.careAmount !== 0 ||
            p.careProgress !== 0 ||
            (p.carryingPawnId !== null && p.wardenTask?.stage !== 'captureCarry'))) ||
        (!['feed', 'tend'].includes(p.carePhase ?? '') && p.careProgress !== 0) ||
        (p.carePhase !== 'feedFetch' && p.careFoodId !== null) ||
        (p.carePhase !== 'tendFetch' && p.careMedicineId !== null) ||
        (!['feedFetch', 'tendFetch'].includes(p.carePhase ?? '') && p.careAmount !== 0) ||
        (p.downed &&
          p.sleepBedId !== null &&
          !d.beds.some((b) => b.id === p.sleepBedId && same(b, p))) ||
        ((p.dead || p.downed) &&
          (p.jobId !== null ||
            p.path.length !== 0 ||
            p.destination !== null ||
            p.eating !== null ||
            p.carePhase !== null))
      )
        throw new Error('人物生存状态无效');
      const patient = d.pawns.find((q) => q.id === p.patientId);
      if (
        p.carePhase !== null &&
        ((!migrateAnatomy && loadHealth(p).manipulation <= 0) ||
          !patient ||
          patient === p ||
          patient.dead ||
          (!p.carePhase.startsWith('tend') && !patient.downed && !(p.carePhase.startsWith('feed') && patient.faction === 'prisoner')) ||
          !['colony', 'prisoner'].includes(patient.faction) ||
          p.faction !== 'colony' ||
          p.drafted ||
          patient.drafted ||
          d.pawns.some((q) => q.id !== p.id && q.patientId === patient.id))
      )
        throw new Error('病人护理预定无效');
      if (
        p.carePhase?.startsWith('tend') &&
        (!patient ||
          patient.medical.policy === 'none' ||
          !loadNeedsTending(patient) ||
          patient.carriedBy !== null)
      )
        throw new Error('包扎目标无有效伤口');
      if (p.carePhase === 'tendFetch') {
        const source = d.items.find((i) => i.id === p.careMedicineId);
        const reserved = d.pawns.reduce(
          (n, q) => n + (q.careMedicineId === p.careMedicineId ? q.careAmount : 0),
          0,
        );
        if (
          patient?.medical.policy !== 'herbal' ||
          !source ||
          source.resource !== 'herb' ||
          p.careAmount < 1 ||
          p.careAmount > 25 ||
          reserved > source.amount ||
          p.cargo !== null
        )
          throw new Error('护理药物预留无效');
      } else if (
        p.carePhase?.startsWith('tend') &&
        p.cargo !== null &&
        (p.cargo.resource !== 'herb' || patient?.medical.policy !== 'herbal')
      )
        throw new Error('护理携带药物无效');
      if (p.carriedBy !== null) {
        const carrier = d.pawns.find((q) => q.id === p.carriedBy);
        if (
          !carrier ||
          carrier === p ||
          carrier.dead ||
          carrier.downed ||
          carrier.carryingPawnId !== p.id ||
          !((p.downed && carrier.patientId === p.id && carrier.carePhase === 'rescueCarry') ||
            (p.faction === 'prisoner' && carrier.wardenTask?.prisonerId === p.id && carrier.wardenTask.stage === 'captureCarry')) ||
          !same(p, carrier) ||
          p.sleepBedId !== null
        )
          throw new Error('被救援人物状态无效');
      }
      if (
        p.carryingPawnId !== null &&
        !((p.carePhase === 'rescueCarry' && patient?.id === p.carryingPawnId && patient.carriedBy === p.id) ||
          (p.wardenTask?.stage === 'captureCarry' && p.wardenTask.prisonerId === p.carryingPawnId &&
            d.pawns.some(q => q.id === p.carryingPawnId && q.carriedBy === p.id)))
      )
        throw new Error('救援携带关系无效');
      if (p.carePhase === 'rescueCarry' && p.carryingPawnId === null)
        throw new Error('救援缺少被搬运者');
      if (p.carePhase === 'rescueApproach' || p.carePhase === 'rescueCarry') {
        if (
          !d.beds.some((b) => b.id === p.careBedId && b.medical && b.prisoner === (patient?.faction === 'prisoner') &&
            (!b.prisoner || b.owner === patient?.id)) ||
          d.pawns.some((q) => q.id !== p.id && q.careBedId === p.careBedId) ||
          (p.carePhase === 'rescueApproach' &&
            (patient?.carriedBy !== null ||
              d.beds.some((b) => same(b, patient!) && b.prisoner === (patient!.faction === 'prisoner') &&
                (b.prisoner ? b.owner === patient!.id : b.medical || b.owner === patient!.id)))) ||
          p.cargo !== null
        )
          throw new Error('救援医疗床预定无效');
      } else if (p.careBedId !== null) throw new Error('护理床位引用无效');
      if (p.carePhase?.startsWith('feed')) {
        if (
          !patient ||
          patient.food > 26 ||
          patient.carriedBy !== null ||
          !d.beds.some((b) => same(b, patient) && b.prisoner === (patient.faction === 'prisoner') &&
            (b.prisoner ? b.owner === patient.id : b.medical || b.owner === patient.id))
        )
          throw new Error('喂食病人不在床上');
        if (p.carePhase === 'feedFetch') {
          const source = d.items.find((i) => i.id === p.careFoodId);
          const reserved = d.pawns.reduce(
            (n, q) => n + (q.careFoodId === p.careFoodId ? q.careAmount : 0),
            0,
          );
          if (
            !source ||
            !NUTRITION[source.resource] ||
            p.careAmount < 1 ||
            reserved > source.amount ||
            p.cargo !== null
          )
            throw new Error('喂食食物预留无效');
        } else if (!p.cargo || !NUTRITION[p.cargo.resource]) throw new Error('喂食缺少携带食物');
      }
      if (
        typeof p.name !== 'string' ||
        p.name.length > 40 ||
        !Number.isFinite(p.color) ||
        !zero(p.food) ||
        p.food > 100 ||
        !zero(p.rest) ||
        p.rest > 100 ||
        !Array.isArray(p.schedule) ||
        p.schedule.length !== 24 ||
        p.schedule.some((a) => !['anything', 'work', 'sleep', 'recreation'].includes(a)) ||
        (p.sleepBedId !== null &&
          !d.beds.some(
            (b) =>
              b.id === p.sleepBedId &&
              b.prisoner === (p.faction === 'prisoner') &&
              (b.owner === p.id ||
                (b.medical && (p.downed || p.dead ? same(b, p) : medicalNeedsRest(p)))),
          )) ||
        (p.sleepingSince !== null &&
          (!Number.isSafeInteger(p.sleepingSince) ||
            p.sleepingSince < 0 ||
            p.sleepingSince > d.tick)) ||
        !p.priorities ||
        Object.values(p.priorities).length !== 14 ||
        (
          ['handle', 'firefight', 'clean', 'warden', 'hunt', 'dig', 'cut', 'build', 'haul', 'grow', 'cook', 'craft', 'care', 'research'] as Work[]
        ).some(
          (k) => !Number.isInteger(p.priorities[k]) || p.priorities[k] < 0 || p.priorities[k] > 4,
        ) ||
        (p.cargo !== null && !(migrateLogistics ? validBatch(p.cargo) : plainCargo(p.cargo))) ||
        (!migrateLogistics && p.cargo !== null && p.cargo.amount > carryLimit(p.cargo.resource)) ||
        (p.eating !== null && !NUTRITION[p.eating])
      )
        throw new Error('人物数据无效');
    }
    const apparelInstances = [
      ...d.items.flatMap((i) => (i.apparel ? [i.apparel] : [])),
      ...d.pawns.flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
    ];
    const apparelIds = new Set<number>();
    for (const piece of apparelInstances) {
      if (
        !validApparel(piece) ||
        piece.wearTicks > d.tick ||
        piece.id >= d.nextId ||
        ids.has(piece.id) ||
        apparelIds.has(piece.id)
      )
        throw new Error('衣物实例身份重复或无效');
      apparelIds.add(piece.id);
    }
    const weaponIds = new Set<number>();
    for (const piece of [
      ...d.items.flatMap((i) => (i.weapon ? [i.weapon] : [])),
      ...d.pawns.flatMap((p) => [
        ...(p.weapon ? [p.weapon] : []),
        ...(p.cargo?.weapon ? [p.cargo.weapon] : []),
      ]),
    ]) {
      if (
        !validWeapon(piece) ||
        piece.id >= d.nextId ||
        ids.has(piece.id) ||
        apparelIds.has(piece.id) ||
        weaponIds.has(piece.id)
      )
        throw new Error('武器实例身份重复或无效');
      weaponIds.add(piece.id);
    }
    if (
      !d.stats ||
      ![
        'mined',
        'cut',
        'built',
        'hauled',
        'sown',
        'harvested',
        'cooked',
        'stonecut',
        'tailored',
        'weaponsMade',
        'treesPlanted',
        'treesRegrown',
        'treesDied',
        'eaten',
      ].every((k) => zero(d.stats[k as 'mined'])) ||
      !['produced', 'consumed', 'spoiled', 'destroyed'].every((k) =>
        resources.every((r) => zero(d.stats[k as 'produced']?.[r as Resource])),
      ) ||
      !resources.every(
        (r) =>
          Number.isSafeInteger(d.stats.destroyed[r]) &&
          (sourceVersion >= 26 || r === 'apparel' || d.stats.destroyed[r] === 0),
      ) ||
      !['stonecut', 'tailored', 'weaponsMade', 'treesPlanted', 'treesRegrown', 'treesDied'].every(
        (key) => Number.isSafeInteger(d.stats[key as 'stonecut']),
      ) ||
      !resources.every(
        (r) =>
          Number.isSafeInteger(d.stats.spoiled[r]) && (isPerishable(r) || d.stats.spoiled[r] === 0),
      )
    )
      throw new Error('统计数据无效');
    validateSanitation(d);
    validatePrisoners(d);
    validateRangedState(d);
    validateTrade(d, ids, apparelIds, weaponIds);
    validateWildlife(d, ids, new Set([...apparelIds, ...weaponIds]));
    validateHusbandry(d);
    validateMilk(d);
    validateWool(d);
    validateAutoSlaughter(d);
    validatePens(d);
    validatePawnAreas(d);
    validateLiving(d);
    validateFurniture(d);
    validateRelocation(d);
    validateProductionQueues(d.productionQueues, d, d.nextId, d.jobs);
    validateUnfinishedProduction(d);
    validateStockpileZones(d.stockpileZones, d.stockpiles, d.nextId);
    for (const zone of d.stockpileZones) if (zone.id.startsWith('zone:')) {
      const id = Number(zone.id.slice(5));
      if (ids.has(id) || apparelIds.has(id) || weaponIds.has(id) ||
          [...d.items, ...d.pawns.flatMap(p => p.cargo ? [p.cargo] : []), ...d.jobs.flatMap(j => j.deliveredBatches)]
            .some(b => b.furniture?.id === id || b.unfinished?.id === id))
        throw new Error('仓库区域身份与其他实体重复');
      ids.add(id);
    }
    validateProductionOutputState(d);
    for (const job of d.jobs) {
      if (!job.cancelled && productionJobRecipe(job) &&
          (job.owner !== null || job.progress > 0 || Object.values(job.delivered).some(n => n! > 0)) && !job.productionPolicy)
        throw new Error('已领取生产批次缺少原料策略');
      if (job.productionPolicy?.workerId != null && job.productionPolicy.workerId >= d.nextId)
        throw new Error('生产批次中的历史工人身份超出上界');
    }
    for (const queue of d.productionQueues) for (const bill of queue.bills) {
      if (!bill.id.startsWith('bill:')) continue;
      const id = Number(bill.id.slice(5));
      if (ids.has(id) || apparelIds.has(id) || weaponIds.has(id) ||
        [...d.items, ...d.pawns.flatMap(p => p.cargo ? [p.cargo] : []), ...d.jobs.flatMap(j => j.deliveredBatches)]
          .some(b => b.furniture?.id === id)) throw new Error('生产账单与实体身份冲突');
      ids.add(id);
    }
    validateShelves(d, !migrateLogistics);
    validateStorageGroups(d);
    validateSocial(d);
    const recreationPins = new Set<number>();
    const recreationCells = new Set<number>();
    for (const p of d.pawns) {
      if (!validatePsyche(p, d.tick)) throw new Error('心情或娱乐状态无效');
      const activity = p.psyche.recreation;
      if ((activity !== null) !== (p.phase === 'recreation') || (p.phase === 'mental' && p.psyche.breakUntil <= d.tick) ||
          (p.psyche.breakUntil > d.tick && !p.dead && !p.downed && p.carriedBy === null && p.phase !== 'mental') ||
          ((activity || p.phase === 'mental') && (p.faction !== 'colony' || p.dead || p.downed || p.drafted || p.jobId !== null || p.carePhase !== null || p.eating || p.sleepingSince !== null || p.sleepBedId !== null)) ||
          (activity && (p.cargo !== null || recreationCells.has(at(activity.target)))))
        throw new Error('心情活动与人物阶段不符');
      if (activity) recreationCells.add(at(activity.target));
      if (activity?.kind === 'horseshoes') {
        const pin = d.horseshoePins.find(b => b.id === activity.spotId);
        if (!pin || recreationPins.has(pin.id) || pin.z !== activity.target.z ||
            Math.abs(pin.x - activity.target.x) + Math.abs(pin.y - activity.target.y) !== 2)
          throw new Error('娱乐场地预留无效');
        recreationPins.add(pin.id);
      }
      if (activity?.kind === 'social') {
        const table = d.tables.find(t => t.id === activity.spotId);
        if (!table || !table.gathering || !d.chairs.some(c => same(c,activity.target)) || !tableCells(table).some(c => c.z === activity.target.z &&
            Math.abs(c.x-activity.target.x)+Math.abs(c.y-activity.target.y) === 1) ||
            d.pawns.some(q => q.id !== p.id && q.living.mealTask && same(q.living.mealTask.target,activity.target)))
          throw new Error('桌边休闲目标或共享座位预约无效');
      }
    }
    // Restore into empty state. Never rerun generation over an existing colony.
    const s = new VoxelSimulation(d.seed, d.settings, true, d.generator >= 3 ? d.generator as 3 | 4 : 2);
    s.generator = d.generator;
    s.explored = explored;
    s.exploredCount = explored.reduce((n, value) => n + value, 0);
    s.worldSite = structuredClone(worldSite);
    s.spawn = structuredClone(d.spawn);
    s.blocks = decode(d.blocks, sourceVersion <= 6 ? 6 : sourceVersion === 7 ? 7 : 10);
    s.water = decode(d.water, 2); s.bridges = decode(d.bridges, 1);
    s.waterPresent = s.water.some(value=>value!==0);
    s.ladders = decode(d.ladders, 1);
    s.structureKinds = decode(d.structureKinds, 3);
    validateWater(s.water, s.bridges, s.blocks, s.ladders, s.structureKinds);
    for (const object of [
      ...d.stoves.map(p=>({...p,kind:'stove' as const})),
      ...d.stonecutters.map(p=>({...p,kind:'stonecutter' as const})),
      ...d.tailors.map(p=>({...p,kind:'tailor' as const})),
      ...d.researchBenches.map(p=>({...p,kind:'researchBench' as const})),
      ...d.weaponBenches, ...d.devices,
    ]) if (!bridgeSupports(object.kind) && s.footprint(object).some(q=>q.z>0 && s.bridges[at(q)-WIDTH*DEPTH]))
      throw new Error('存档建筑超过木桥的轻型承载');
    for (let cell=0; cell<CELLS-WIDTH*DEPTH; cell++) if(s.bridges[cell] && s.blocks[cell+WIDTH*DEPTH] === Block.Masonry)
      throw new Error('木桥不能支撑石砌墙体');
    validateStoryteller(d, s.blocks, s.structureKinds);
    Object.assign(
      s,
      structuredClone({
        tick: d.tick,
        productionQueues: d.productionQueues,
        socialHistory: d.socialHistory, socialLog: d.socialLog,
        weather: d.weather, snow: d.snow,
        fires: d.fires, fireDamage: d.fireDamage, fireHazards: d.fireHazards, autoRebuild: d.autoRebuild, fireLog: d.fireLog,
        filth: d.filth,
        combat: d.combat,
        storyteller: d.storyteller,
        trade: d.trade,
        projectiles: d.projectiles,
        combatEvents: d.combatEvents,
        sandbags: d.sandbags,
        animals: d.animals, autoSlaughter: d.autoSlaughter,
        grass: d.grass, husbandryLog: d.husbandryLog,
        fences: d.fences, fenceGates: d.fenceGates, penMarkers: d.penMarkers, animalAreas: d.animalAreas,
        butcherSpots: d.butcherSpots,
        tables: d.tables, chairs: d.chairs,
        horseshoePins: d.horseshoePins,
        nextId: d.nextId,
        pawns: d.pawns,
        items: d.items,
        trees: d.trees,
        treePlots: d.treePlots,
        jobs: d.jobs,
        stockpiles: d.stockpiles,
        stockpileZones: d.stockpileZones,
        shelves: d.shelves, storageSpills: d.storageSpills, storageGroups:d.storageGroups,
        farms: d.farms,
        crops: d.crops,
        stoves: d.stoves,
        stonecutters: d.stonecutters,
        tailors: d.tailors,
        weaponBenches: d.weaponBenches,
        researchBenches: d.researchBenches,
        research: d.research,
        beds: d.beds,
        doors: d.doors,
        devices: d.devices,
        wires: d.wires,
        stats: d.stats,
      }),
    );
    s.homeArea = new Set(d.homeArea);
    s.rebuildTrees();
    s.stoveCells = new Set(s.stoves.map(at));
    s.rebuildDevices();
    validateWeather(d, s.blocks, s.water);
    s.pruneSnow();
    validateFire(d, s, sourceVersion);
    if (s.filth.some(f => !s.filthSupported(f))) throw new Error('污物没有合法地面支撑或净空');
    if (
      [
        ...s.tables.flatMap(tableCells), ...s.chairs, ...s.shelves.flatMap(shelfCells),
        ...s.beds.flatMap(bedCells),
        ...s.sandbags,
        ...s.doors, ...s.fences, ...s.fenceGates, ...s.penMarkers,
        ...s.devices.flatMap(deviceCells),
        ...s.stonecutters.flatMap(stonecutterCells),
        ...s.tailors.flatMap(tailorCells),
        ...s.researchBenches.flatMap(researchBenchCells),
        ...s.weaponBenches.filter((b) => b.kind !== 'craftingSpot').flatMap(weaponBenchCells),
      ].some(
        (p) =>
          !s.blocks[at(p) - WIDTH * DEPTH] ||
          s.blocks[at(p)] ||
          s.blocks[at(p) + WIDTH * DEPTH] ||
          s.ladders[at(p)] ||
          s.treeCells.has(at(p)) ||
          s.treeCells.has(at(p) + WIDTH * DEPTH),
      )
    )
      throw new Error('床或门没有合法支撑或净空');
    if (
      [...s.stoves, ...s.horseshoePins, ...s.butcherSpots, ...s.weaponBenches.filter((b) => b.kind === 'craftingSpot')].some(
        (p) =>
          s.blocks[at(p)] ||
          s.blocks[at(p) + WIDTH * DEPTH] ||
          !s.blocks[at(p) - WIDTH * DEPTH] ||
          s.treeCells.has(at(p)),
      )
    )
      throw new Error('灶台没有合法支撑或净空');
    if ([...s.pawns, ...s.animals].some((p) => !s.standable(p))) throw new Error('人物没有合法支撑或净空');
    if (migrateLogistics) {
      // All work happens on the isolated clone. Reachable bounded spill is stable
      // in original stack order and preserves age using the actual transferred amount.
      let items: Stack[] = [];
      for (const item of s.items) {
        const origin = s.dropPoint(item);
        if (!origin) throw new Error('旧存档物资无法安全迁移到附近地面');
        const plan = s.planPlacement([{ batch: item, origin }], items, MIGRATION_DISTANCE);
        if (!plan) throw new Error('旧存档附近容量不足，不能安全拆分物资');
        items = plan.items;
        s.nextId = plan.nextId;
      }
      s.items = items;
      for (const job of s.jobs)
        job.deliveredBatches = job.deliveredBatches.map((batch) => portion(batch, batch.amount));
      for (const pawn of s.pawns)
        if (pawn.cargo) pawn.cargo = portion(pawn.cargo, pawn.cargo.amount);
      for (const pawn of s.pawns)
        if (pawn.cargo && pawn.cargo.amount > carryLimit(pawn.cargo.resource)) {
          const keep = carryLimit(pawn.cargo.resource);
          const plan = s.planPlacement(
            [{ batch: portion(pawn.cargo, pawn.cargo.amount - keep), origin: pawn }],
            s.items,
            MIGRATION_DISTANCE,
          );
          if (!plan) throw new Error('旧存档超量随身物资无法安全卸下');
          s.commitPlacement(plan);
          pawn.cargo.amount = keep;
        }
    }
    validateShelves({ ...d, items:s.items, storageSpills:s.storageSpills });
    if (s.items.some((i) => !s.groundAllowed(i))) throw new Error('物资没有合法地面支撑或净空');
    if (s.stockpiles.some((p) => !s.standable(p) || s.ladders[at(p)]))
      throw new Error('仓储没有合法支撑或净空');
    if (s.wires.some((w) => w.z < 1 || w.z >= HEIGHT - 1)) throw new Error('线路高度无效');
    s.updateRooms();
    s.thermal.restore(d.thermal, s.rooms, s.outdoorTemperature());
    s.updatePower();
    // Keep the validated association of already collected production inputs.
    // A route can leave the search radius after a legal pickup; it is not a new
    // ingredient source. Worker eligibility is rechecked below before rebinding.
    const carriedProduction = new Map(s.pawns.flatMap(p => {
      const job = s.jobs.find(j => j.id === p.jobId && j.owner === p.id && !j.cancelled && j.productionPolicy);
      return job && p.cargo && s.acceptsJobCargo(job, p.cargo) &&
        (job.cost[p.cargo.resource] ?? 0) > (job.delivered[p.cargo.resource] ?? 0) ? [[p.id, job.id] as const] : [];
    }));
    // Persist work progress, delivered and carried resources; rebuild transient paths and ownership.
    for (const j of s.jobs) {
      j.owner = null;
      j.reason = j.cancelled ? '已取消，保留原任务材料等待退回' : j.constructionFailure
        ? '施工失败：剩余材料保留在工地，等待附近腾出落点后重新规划' : '回读后等待重新安排';
    }
    for (const p of s.pawns) {
      // Prison tasks carry explicit destinations and progress. Movement rechecks every edge.
      if (p.productionDelivery) { s.continueProductionDelivery(p); continue; }
      if (p.ropeTask) {
        const task=p.ropeTask, a=s.animals.find(a=>a.id===task.animalId)!;
        const cells=penCells(s,task.penId);
        let animal=a as Pos,handler=p as Pos;
        let valid=!!cells && (task.stage!=='detach'||cells.has(at(a)));
        if(task.stage!=='approach') {
          valid=valid&&s.penNeighbors(animal,'rope').includes(at(handler));
          for(const next of task.path) {
            if(!s.penNeighbors(handler,'rope').includes(next)||!s.penNeighbors(animal,'rope').includes(at(handler))) {valid=false;break;}
            animal=handler;handler=position(next);
          }
        }
        if(!valid)s.release(p);
        continue;
      }
      if (p.wardenTask || p.handleTask || p.ropeTask || p.faction === 'prisoner') continue;
      if (p.firefightTask || p.repairTask) {
        const targets = p.firefightTask ? [s.fires.find(f => f.id === p.firefightTask!.fireId)!] :
          fireDamageCells(s.fireDamage.find(d => d.key === p.repairTask!.damageKey)!, s);
        const route = s.fireRoute(p, targets);
        if (route === null || (p.firefightTask ? !validFirefight(s, p) : !validRepair(s, p))) s.release(p);
        else { p.path = route; p.destination = route.at(-1) ?? null; }
        continue;
      }
      if (p.cleanTask) {
        const target = s.filth.find(f => f.id === p.cleanTask!.filthId)!;
        const route = s.path(p, target);
        if (!s.validClean(p) || route === null) s.release(p);
        else { p.path = route; p.destination = route.length ? at(target) : null; }
        continue;
      }
      if (p.phase === 'mental') { p.path = []; p.destination = null; continue; }
      if (p.phase === 'recreation') {
        const activity = p.psyche.recreation!;
        const route = s.path(p, activity.target);
        if (!s.validRecreation(p) || route === null) s.release(p);
        else { p.path = route; p.destination = route.length ? at(activity.target) : null; }
        continue;
      }
      if (p.phase === 'hunt') {
        // Preserve warmup/burst timers; travel paths can be rebuilt against current terrain.
        if (p.shooting) continue;
        p.path = []; p.destination = null;
        s.huntTick(p);
        continue;
      }
      if (p.phase === 'trade' || p.faction === 'trader') continue;
      if (p.weaponTask !== null) {
        p.jobId = null;
        p.path = [];
        p.destination = null;
        p.workTarget = null;
        p.eating = null;
        p.moveTick = s.tick;
        p.phase = 'weapon';
        if (p.weaponTask.stage === 'fetch') {
          const item = s.items.find((i) => i.weapon?.id === p.weaponTask!.weaponId)!;
          const route = s.itemPath(p, item);
          if (route === null) {
            s.release(p);
            p.reason = '回读后武器通路中断，保留物品';
          } else {
            p.path = route;
            p.destination = route.at(-1) ?? at(p);
          }
        }
        continue;
      }
      if (!p.dead && !p.downed && (p.drafted || p.faction === 'raider') && p.weaponTask === null) {
        // The trajectory and shot timers are persisted simulation state. Keep
        // a valid aim/burst intact rather than replanning it into melee travel.
        if (p.shooting !== null) continue;
        const destination = p.destination;
        p.path = [];
        p.destination = null;
        p.jobId = null;
        p.phase = 'combat';
        if (p.attackTargetId !== null) {
          const target = s.pawns.find((q) => q.id === p.attackTargetId)!;
          s.search(p);
          const stand =
            p.weapon && isRangedKind(p.weapon.kind)
              ? s.shootingStand(p, target)
              : s.careStand(target);
          if (stand >= 0) s.go(p, stand, 'combat');
        } else if (destination !== null) {
          const route = s.path(p, position(destination));
          if (route) {
            p.path = route;
            p.destination = destination;
          }
        }
        continue;
      }
      if (p.apparelTask !== null) {
        p.jobId = null;
        p.path = [];
        p.destination = null;
        p.workTarget = null;
        p.eating = null;
        p.moveTick = s.tick;
        if (p.apparelTask.stage === 'fetch') {
          const item = s.items.find((i) => i.apparel?.id === p.apparelTask!.apparelId)!;
          const route = s.itemPath(p, item);
          if (route === null) {
            s.release(p);
            p.reason = '回读后衣物通路中断';
          } else {
            p.path = route;
            p.destination = route.at(-1) ?? at(p);
            p.phase = 'apparel';
          }
        } else p.phase = 'apparel';
        continue;
      }
      if (p.dead || p.downed || p.carePhase !== null) {
        p.jobId = null;
        p.path = [];
        p.destination = null;
        p.workTarget = null;
        p.eating = null;
        p.moveTick = s.tick;
        if (p.dead || p.downed) {
          p.phase = p.dead ? 'dead' : 'downed';
          p.sleepingSince = null;
          continue;
        }
        const patient = s.pawns.find((q) => q.id === p.patientId)!;
        s.search(p);
        const target =
          p.carePhase === 'rescueCarry'
            ? at(s.beds.find((b) => b.id === p.careBedId)!)
            : p.carePhase === 'feedFetch'
              ? s.reachableItemStand(s.items.find((i) => i.id === p.careFoodId)!)
              : p.carePhase === 'tendFetch'
                ? s.reachableItemStand(s.items.find((i) => i.id === p.careMedicineId)!)
                : s.careStand(patient);
        if (target < 0 || s.distance[target] < 0) {
          s.release(p);
          p.reason = '回读后护理通路中断，保留所有携带物';
        } else if (
          (p.carePhase === 'feed' || p.carePhase === 'tend') &&
          p.z === patient.z &&
          Math.abs(p.x - patient.x) + Math.abs(p.y - patient.y) === 1
        ) {
          p.phase = 'care';
        } else {
          if (p.carePhase === 'feed' || p.carePhase === 'tend') {
            p.carePhase = p.carePhase === 'feed' ? 'feedApproach' : 'tendApproach';
            p.careProgress = 0;
          }
          s.go(p, target, 'care');
        }
        continue;
      }
      if (p.phase === 'travel' && p.destination !== null) {
        const route = s.path(p,position(p.destination));
        if (route === null) { s.release(p); p.reason = '回读后移动目标不可达，保留携带物'; }
        else p.path = route;
        continue;
      }
      if (p.phase === 'dine') {
        const task = p.living.mealTask!;
        if (!s.validDining(p)) { s.release(p); p.reason = '回读后餐桌或食物条件改变'; }
        else if (task.stage === 'travel') {
          const route = s.path(p, task.target);
          if (route === null) { s.release(p); p.reason = '回读后座位不可达，保留餐食'; }
          else { p.path = route; p.destination = at(task.target); p.moveTick = s.tick; }
        }
        continue;
      }
      const sleepTarget =
        p.phase === 'sleepTravel'
          ? s.beds.find(
              (b) =>
                b.id === p.sleepBedId && (b.owner === p.id || (b.medical && medicalNeedsRest(p))),
            )
          : undefined;
      const sleeping =
        p.phase === 'rest' &&
        p.sleepingSince !== null &&
        (p.sleepBedId === null || s.beds.some((b) => b.id === p.sleepBedId && same(b, p)));
      p.jobId = null;
      p.path = [];
      p.destination = null;
      p.phase = sleeping ? 'rest' : 'idle';
      if (!sleeping) {
        p.sleepBedId = null;
        p.sleepingSince = null;
      }
      p.workTarget = null;
      p.moveTick = s.tick;
      p.eating = null;
      p.reason = sleeping
        ? p.sleepBedId === null
          ? '地面睡眠'
          : '在床上睡觉'
        : '存档已恢复，正在重新安排工作';
      if (sleepTarget) {
        const path = s.path(p, sleepTarget);
        if (path) {
          p.path = path;
          p.destination = at(sleepTarget);
          p.phase = 'sleepTravel';
          p.sleepBedId = sleepTarget.id;
          p.reason = '继续前往床位睡觉';
        }
      }
    }
    if (migrateAnatomy) {
      for (const p of s.pawns) s.reconcileHealth(p);
      for (const p of s.pawns) if (p.carePhase !== null && !s.validCare(p)) s.release(p);
    }
    s.pendingAdaptation.clear();
    s.markAll();
    s.notice = migrateAnatomy
      ? '旧存档已升级：伤势保留，身体能力按新规则重算；请在暂停中检查人物'
      : migrateArmor
        ? '旧存档已升级：衣物、伤势与科研保留；护甲结算已启用，板甲需研究后制作'
        : '体素存档已恢复；路径与任务预定重新建立';
    if (sourceVersion < 22) s.seedWildlife();
    if (sourceVersion < 29) seedGrass(s);
    s.validateProductionWorkers();
    for (const [pawnId, jobId] of carriedProduction) {
      const p = s.pawns.find(p => p.id === pawnId)!, j = s.jobs.find(j => j.id === jobId)!;
      if (!p.cargo || p.phase !== 'idle' || p.dead || p.downed || p.drafted || p.carriedBy !== null ||
          p.faction !== 'colony' || p.psyche.breakUntil > s.tick || p.priorities[workType(j.kind)] <= 0 ||
          j.owner !== null || !s.supported(j) || s.skillFailure(p, j) || s.productionWorkerFailure(p, j)) continue;
      s.search(p);
      if (s.reachableStand(j, p) < 0) continue;
      j.owner = p.id;
      p.jobId = j.id;
      p.workTarget = { x: j.x, y: j.y, z: j.z };
      s.continueJob(p, j);
    }
    for (const p of s.pawns) s.reconcilePawnArea(p);
    reconcileAutoSlaughter(s);
    return s;
  }
}
