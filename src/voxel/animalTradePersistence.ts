import { ANIMAL_HUSBANDRY, HUSBANDRY_RULES, isAnimalAdult } from './husbandry';
import { validateAnimalHusbandryShape } from './husbandryPersistence';
import { validateWildlife } from './wildlifePersistence';
import { validateMilk } from './animalMilkPersistence';
import { validateWool } from './animalWoolPersistence';
import { validateEggs } from './animalEggPersistence';
import { validateAnimalMedicalState } from './animalMedicalPersistence';
import { eggLayerActive } from './animalEggs';
import { isPenMapEdge } from './pens';
import { HEIGHT, inside, position, type AnimalSpecies, type VoxelSave, type WildAnimal } from './types';
import type { TradeReceipt } from './tradeTypes';

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const exact = (value: unknown, keys: readonly string[]): value is Record<string, any> =>
  record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const species = Object.keys(ANIMAL_HUSBANDRY) as AnimalSpecies[];
const emptyCounts = () => Object.fromEntries(species.map(kind => [kind, 0])) as Record<AnimalSpecies, number>;
function fail(reason: string): never { throw new Error('活畜交易存档无效：' + reason); }

/** Inspect original data before any previous migration constructs today's trade
 * defaults. Human trader faction predates this schema and remains legal. */
export function rejectLegacyAnimalTrade(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 53) return;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (record(node) && (['animalIds', 'animalLedger', 'animalTransfers', 'animalOffers'].some(key => Object.hasOwn(node, key)) ||
        (Object.hasOwn(node, 'species') && node.faction === 'trader') || node.goal?.kind === 'caravan'))
      fail('旧版本混入活畜商队、账本、回执或跟随目标');
    Object.values(node).forEach(visit);
  };
  if (Array.isArray(old.animals) && old.animals.some(a => record(a) && a.faction === 'trader'))
    fail('旧版本混入商队动物');
  visit(old);
}

export function migrateAnimalTrade(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 53) return;
  if (!record(old.trade) || !Array.isArray(old.trade.caravans) || !Array.isArray(old.trade.receipts) ||
      old.trade.caravans.some(c => !record(c)) || old.trade.receipts.some(r => !record(r))) fail('旧贸易列表缺失');
  for (const caravan of old.trade.caravans) caravan.animalIds = [];
  for (const receipt of old.trade.receipts) receipt.animalTransfers = [];
  old.trade.animalLedger = { bought: emptyCounts(), sold: emptyCounts() };
}

const snapshotFields = ['x', 'y', 'z', 'allowedAreaId', 'ropePaused', 'requestedPenId', 'nextRoamTick',
  'faction', 'sex', 'ageTicks', 'growth', 'tame', 'slaughter', 'releaseMarked', 'malnutrition', 'milkFullness',
  'woolGrowth', 'eggProgress', 'fertilizationCount', 'eggFatherId', 'layProgress', 'pregnancy', 'mateId',
  'mateProgress', 'nextMateTick', 'tameness', 'nextTamenessDecayTick', 'nextInteractionTick', 'path', 'goal',
  'eatProgress', 'reason', 'id', 'species', 'name', 'health', 'hunger', 'dead', 'phase', 'hunt', 'moveTick',
  'decisionTick', 'fleeUntil', 'threatId', 'retryTick', 'rotProgress', 'medical'] as const;

function traderDirectives(a: WildAnimal): void {
  if (a.dead || a.allowedAreaId !== null || a.requestedPenId !== null || a.ropePaused !== false ||
      a.tame || a.hunt || a.slaughter || a.releaseMarked || a.mateId !== null || a.mateProgress !== 0 ||
      ['rope', 'interact', 'mate'].includes(a.phase) || ['area', 'exit', 'mate'].includes(a.goal?.kind ?? ''))
    fail('商队动物仍含殖民地指派、标记或照料活动');
}

/** Historical references are bounded identities, not live actor registrations.
 * Their old area, pen, parents and caravan may have disappeared since handover. */
function validateSnapshot(a: WildAnimal, side: 'colony' | 'trader', receipt: TradeReceipt, nextId: number): void {
  const id = (value: unknown) => integer(value, 1, nextId - 1);
  if (!exact(a, snapshotFields) || !inside(a) || a.z < 1 || a.z >= HEIGHT - 1 || a.dead !== false ||
      a.faction !== side || typeof a.ropePaused !== 'boolean' || !integer(a.nextRoamTick) ||
      (a.allowedAreaId !== null && (!id(a.allowedAreaId) || a.faction !== 'colony' || a.species !== 'hare')) ||
      (a.requestedPenId !== null && (!id(a.requestedPenId) || a.faction !== 'colony' || !ANIMAL_HUSBANDRY[a.species]?.penAnimal)))
    fail('回执活体快照字段、位置或归属无效');
  validateAnimalHusbandryShape(a, nextId);
  validateAnimalMedicalState(a, nextId, receipt.tick);
  // Reuse the existing biological validators with no live-world references.
  // This context deliberately contains no current animal, handler or building.
  const context = { nextId, animals: [a], pawns: [], items: [], jobs: [], butcherSpots: [] } as unknown as VoxelSave;
  validateWildlife(context, new Set(), new Set()); validateMilk(context); validateWool(context); validateEggs(context);
  if (a.mateId !== null) {
    if (!id(a.mateId) || a.mateId === a.id || a.sex !== 'male' || a.faction !== 'colony' || !isAnimalAdult(a) ||
        a.goal?.kind !== 'mate' || a.goal.id !== a.mateId) fail('回执配偶快照无效');
  } else if (a.mateProgress !== 0 || a.goal?.kind === 'mate') fail('回执交配进度缺少配偶');
  if (a.eatProgress > 0 && !['grass', 'crop', 'food'].includes(a.goal?.kind ?? '')) fail('回执进食进度缺少目标');
  if (a.goal?.kind === 'area' && (a.allowedAreaId === null || a.goal.id !== a.allowedAreaId)) fail('回执返区目标无效');
  if (a.goal?.kind === 'exit' && (a.faction !== 'colony' || !ANIMAL_HUSBANDRY[a.species].penAnimal ||
      !isPenMapEdge(position(a.goal.id)))) fail('回执漫游离图目标无效');
  if (a.goal?.kind === 'layEggBox' && (!eggLayerActive(a) || a.eggProgress !== 1 || a.phase !== 'layEgg' ||
      a.mateId !== null || a.eatProgress !== 0)) fail('回执蛋箱产蛋状态无效');
  if (a.goal?.kind === 'caravan' && (side !== 'trader' || a.goal.id !== receipt.caravanId)) fail('回执商队目标无效');
  if (side === 'trader') traderDirectives(a);
}

export function validateAnimalTrade(d: VoxelSave): void {
  const t = d.trade, id = (value: unknown) => integer(value, 1, d.nextId - 1);
  if (!record(t) || !integer(d.nextId, 1) || !Array.isArray(d.animals) || !Array.isArray(d.pawns) ||
      !Array.isArray(t.caravans) || !Array.isArray(t.receipts) ||
      !exact(t.animalLedger, ['bought', 'sold']) || Object.hasOwn(t, 'animalOffers')) fail('必需字段缺失或混入临时报价');
  for (const ledger of [t.animalLedger.bought, t.animalLedger.sold])
    if (!exact(ledger, species) || species.some(kind => !integer(ledger[kind], 0, 1e12))) fail('动物账本物种或数量无效');
  const animals = new Map(d.animals.map(a => [a.id, a])), owners = new Map<number, number>();
  for (const caravan of t.caravans) {
    if (!record(caravan) || !id(caravan.id) || !Array.isArray(caravan.animalIds) ||
        caravan.animalIds.length > HUSBANDRY_RULES.maxAnimals) fail('商队动物列表缺失或超限');
    for (const animalId of caravan.animalIds) {
      const a = animals.get(animalId);
      if (!id(animalId) || owners.has(animalId) || !a || a.dead || a.faction !== 'trader') fail('商队动物身份重复、缺失或归属不符');
      owners.set(animalId, caravan.id);
    }
  }
  for (const a of d.animals) {
    if (a.faction === 'trader') {
      if (!owners.has(a.id)) fail('商队活体缺少唯一所属商队');
      traderDirectives(a);
      if (d.pawns.some(p => p.handleTask?.animalId === a.id || p.ropeTask?.animalId === a.id)) fail('商队动物被殖民地驯养员预约');
    }
    if (a.goal?.kind === 'caravan' && (a.faction !== 'trader' || a.dead || a.goal.id !== owners.get(a.id)))
      fail('动物跟随目标与真实商队不符');
  }

  const otherIds = new Set<number>();
  const collect = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (record(node) && id(node.id)) otherIds.add(node.id);
    for (const [key, value] of Object.entries(node)) if (!['animals', 'animalTransfers'].includes(key)) collect(value);
  };
  // No historical animal snapshot is ever added to a live identity registry.
  for (const [key, value] of Object.entries(d)) if (key !== 'animals' && Array.isArray(value))
    for (const entry of value) if (record(entry)) collect(entry);
  collect(t);
  const identities = new Map<number, { species: AnimalSpecies; sex: WildAnimal['sex'] }>(
    d.animals.map(a => [a.id, { species: a.species, sex: a.sex }]));
  const retained = { bought: emptyCounts(), sold: emptyCounts() };
  for (const receipt of t.receipts) {
    if (!record(receipt) || !id(receipt.id) || !id(receipt.caravanId) || !integer(receipt.tick, 0, d.tick) ||
        typeof receipt.gift !== 'boolean' || !Array.isArray(receipt.animalTransfers) ||
        receipt.animalTransfers.length > HUSBANDRY_RULES.maxAnimals) fail('回执活体列表缺失或超限');
    const transferredIds = new Set<number>();
    for (const row of receipt.animalTransfers) {
      if (!exact(row, ['side', 'animal']) || !['colony', 'trader'].includes(row.side) ||
          (receipt.gift && row.side !== 'colony')) fail('回执方向或赠礼无效');
      validateSnapshot(row.animal, row.side, receipt, d.nextId);
      const a = row.animal, known = identities.get(a.id);
      if (transferredIds.has(a.id) || otherIds.has(a.id) ||
          (known && (known.species !== a.species || known.sex !== a.sex))) fail('回执个体身份重复或生物身份冲突');
      transferredIds.add(a.id); identities.set(a.id, { species: a.species, sex: a.sex });
      retained[row.side === 'trader' ? 'bought' : 'sold'][a.species]++;
    }
  }
  for (const receipt of t.receipts) for (const { animal: a } of receipt.animalTransfers) {
    for (const fatherId of [a.pregnancy?.fatherId ?? null, a.eggFatherId]) {
      if (fatherId === null) continue;
      const father = identities.get(fatherId);
      if (otherIds.has(fatherId) || (father && (father.sex !== 'male' || father.species !== a.species))) fail('回执父代生物身份冲突');
    }
    if (a.mateId !== null) {
      const mate = identities.get(a.mateId);
      if (otherIds.has(a.mateId) || (mate && (mate.sex !== 'female' || mate.species !== a.species))) fail('回执配偶生物身份冲突');
    }
  }
  for (const side of ['bought', 'sold'] as const) for (const kind of species)
    if (t.animalLedger[side][kind] < retained[side][kind]) fail('动物账本小于保留回执中的实物转移次数');
}
