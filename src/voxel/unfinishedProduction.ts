import { APPAREL_DEFS, ARMOR_KINDS, TAILOR_KINDS, apparelCost, type TextileMaterial } from './apparel';
import { WEAPON_DEFS, WEAPON_KINDS, weaponWork, type WeaponKind } from './weapons';
import { emptyCounts, type ApparelKind, type ApparelPiece, type Cargo, type Counts, type UnfinishedPiece, type VoxelSave } from './types';
import { productionJobRecipe, productionQueues, type ProductionRecipe } from './productionBills';
import { validProductionPolicy } from './productionPolicies';
import { validBatch } from './preservation';

const recipes = new Set<string>([
  ...TAILOR_KINDS.map(kind => `tailoring:${kind}`),
  ...WEAPON_KINDS.map(kind => `smith:${kind}`),
  ...ARMOR_KINDS.map(kind => `armorsmith:${kind}`),
]);
const materials = ['wood', 'steel', 'components', 'cloth', 'alpacaWool'] as const;
const fields = ['id', 'recipe', 'creatorId', 'creatorName', 'boundBillId', 'workTotal', 'progress', 'workTicks', 'ingredients', 'policy'];
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const owns = (value: unknown, key: string) => record(value) && Object.hasOwn(value, key);

/** Only the thirteen currently supported apparel, weapon and armor recipes.
 * Meals, butchering and stonecutting keep their existing non-UFT lifecycles. */
export function recipeUsesUnfinished(recipe: unknown): recipe is ProductionRecipe {
  return typeof recipe === 'string' && recipes.has(recipe);
}

/** A defensive copy: callers must not mutate global recipe definitions. */
export function unfinishedRecipeCost(recipe: ProductionRecipe, material?: ApparelPiece['material']): Partial<Counts> | null {
  if (!recipeUsesUnfinished(recipe)) return null;
  return { ...(recipe.startsWith('smith:') ? WEAPON_DEFS[recipe.slice(6) as WeaponKind].cost
    : apparelCost(recipe.slice(recipe.indexOf(':') + 1) as ApparelKind, material)) };
}

/** Material identity comes from the physical inputs enclosed by this UFT.
 * Split batches of one material are valid; cloth/wool mixtures are not. Smith
 * recipes have fixed materials and intentionally return null from this helper. */
export function unfinishedApparelMaterial(piece: Pick<UnfinishedPiece, 'recipe' | 'ingredients'>): ApparelPiece['material'] | null {
  if (!recipeUsesUnfinished(piece.recipe) || piece.recipe.startsWith('smith:') ||
      !Array.isArray(piece.ingredients) || !piece.ingredients.length) return null;
  if (piece.recipe.startsWith('armorsmith:'))
    return piece.ingredients.every(batch => batch?.resource === 'steel') ? 'steel' : null;
  const material = piece.ingredients[0]?.resource;
  return (material === 'cloth' || material === 'alpacaWool') && piece.ingredients.every(batch => batch?.resource === material)
    ? material as TextileMaterial : null;
}

/** Existing weapon recipes include the selected worktable's speed in their
 * stored work total. A moved UFT retains that original valid total. */
export function unfinishedRecipeWorkTotals(recipe: ProductionRecipe): readonly number[] {
  if (!recipeUsesUnfinished(recipe)) return [];
  if (!recipe.startsWith('smith:')) return [APPAREL_DEFS[recipe.slice(recipe.indexOf(':') + 1) as ApparelKind].work];
  const kind = recipe.slice(6) as WeaponKind;
  return [...new Set(WEAPON_DEFS[kind].benches.map(bench => weaponWork(kind, bench)))];
}

/** Material conservation only. The wrapper is counted by its physical owner;
 * these quantities never mean that the enclosed material is freely available. */
export function unfinishedMaterialCounts(piece: Pick<UnfinishedPiece, 'ingredients'>): Counts {
  const counts = emptyCounts();
  for (const batch of piece.ingredients) counts[batch.resource] += batch.amount;
  return counts;
}

export function validateUnfinishedPiece(value: unknown): value is UnfinishedPiece {
  if (!record(value) || fields.some(key => !owns(value, key)) ||
      Object.keys(value).some(key => !fields.includes(key) && key !== 'productQuality') ||
      !integer(value.id, 1) || !recipeUsesUnfinished(value.recipe) || !integer(value.creatorId, 1) ||
      value.creatorId === value.id || typeof value.creatorName !== 'string' || !value.creatorName.trim() || value.creatorName.length > 80 ||
      (value.boundBillId !== null && (typeof value.boundBillId !== 'string' ||
        !(/^bill:[1-9]\d*$/.test(value.boundBillId) || /^legacy:[1-9]\d*:[a-zA-Z]+:[a-zA-Z]+$/.test(value.boundBillId)))) ||
      !unfinishedRecipeWorkTotals(value.recipe).includes(value.workTotal) ||
      !finite(value.progress) || value.progress < 0 || value.progress > value.workTotal ||
      !integer(value.workTicks) || !validProductionPolicy(value.policy) ||
      !Array.isArray(value.ingredients) || !value.ingredients.length || value.ingredients.length > 18)
    return false;
  // Full original condition is kept, but nested instances/containers are never
  // inputs. Check the resource before validBatch so recursive UFTs cannot recurse.
  if (value.ingredients.some((batch: unknown) => !record(batch) || !materials.includes(batch.resource) ||
      Object.keys(batch).some(key => !['resource', 'amount', 'hitPoints', 'forbidden'].includes(key)) || !validBatch(batch))) return false;
  const material = unfinishedApparelMaterial(value as UnfinishedPiece);
  if (!value.recipe.startsWith('smith:') && material === null) return false;
  if (value.recipe.startsWith('tailoring:') && !value.policy.allowedTextiles.includes(material as TextileMaterial)) return false;
  const actual = unfinishedMaterialCounts(value as UnfinishedPiece), expected = unfinishedRecipeCost(value.recipe, material ?? undefined)!;
  if (materials.some(resource => actual[resource] !== (expected[resource] ?? 0))) return false;
  if (owns(value, 'productQuality')) {
    const quality = value.productQuality;
    if (!record(quality) || Object.keys(quality).length !== 3 ||
        !['value', 'skill', 'workerId'].every(key => owns(quality, key)) ||
        value.progress !== value.workTotal ||
        (value.recipe.startsWith('smith:') && !WEAPON_DEFS[value.recipe.slice(6) as WeaponKind].hasQuality) ||
        !integer(quality.value, 0, 5) || !integer(quality.skill, 0, 20) || !integer(quality.workerId, 1)) return false;
  }
  return true;
}

/** Native unfinished guns explicitly use .5. UnfinishedApparel has no
 * Flammability override: stat default 0 stays zero regardless of textile Stuff.
 * Other recipes retain the existing Web fire material adaptation. */
export function unfinishedFlammability(piece: Pick<UnfinishedPiece, 'recipe' | 'ingredients'>): number {
  if (piece.recipe === 'smith:revolver' || piece.recipe === 'smith:machinePistol') return .5;
  if (piece.recipe.startsWith('tailoring:')) return 0;
  return piece.ingredients.some(batch => ['wood', 'cloth', 'components'].includes(batch.resource)) ? 1 : 0;
}

const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
function fail(reason: string): never { throw new Error('未完成品存档无效：' + reason); }
const policyKey = (policy: UnfinishedPiece['policy']) => JSON.stringify([
  policy.workerId, policy.skillMin, policy.skillMax, policy.ingredientRadius, policy.allowedFood, policy.allowedCarcasses, policy.allowedTextiles,
]);
const qualityKey = (quality: UnfinishedPiece['productQuality']) => quality
  ? JSON.stringify([quality.value, quality.skill, quality.workerId]) : null;

/** Run after the ordinary world/queue validators. Scan identities independently:
 * ground items and human/animal cargo own UFTs; jobs hold checked references.
 * Historical authors need not still exist, but their ids are never reused. */
export function validateUnfinishedProduction(d: VoxelSave): void {
  if (!integer(d.nextId, 1) || !integer(d.tick) || !Array.isArray(d.items) || !Array.isArray(d.pawns) || !Array.isArray(d.jobs))
    fail('实体列表或身份上界无效');
  const otherIds = new Set<number>();
  const entityLists = ['fires', 'filth', 'pawns', 'animals', 'butcherSpots', 'tables', 'chairs', 'horseshoePins',
    'items', 'trees', 'jobs', 'crops', 'stoves', 'stonecutters', 'tailors', 'weaponBenches', 'researchBenches',
    'beds', 'doors', 'fences', 'fenceGates', 'penMarkers', 'devices', 'sandbags', 'projectiles', 'animalAreas', 'shelves', 'storageGroups'];
  for (const key of entityLists) for (const entity of list((d as any)[key])) if (integer(entity?.id, 1)) otherIds.add(entity.id);
  const cargo = [...d.items, ...d.pawns.flatMap(pawn => pawn.cargo ? [pawn.cargo] : []),
    ...(d.animals ?? []).flatMap(animal => animal.cargo ? [animal.cargo] : []),
    ...d.jobs.flatMap(job => job.deliveredBatches)];
  for (const batch of cargo) for (const piece of [batch.apparel, batch.weapon, batch.furniture]) if (piece) otherIds.add(piece.id);
  for (const pawn of d.pawns) for (const piece of [...pawn.worn, ...(pawn.weapon ? [pawn.weapon] : [])]) otherIds.add(piece.id);
  for (const caravan of d.trade.caravans) {
    otherIds.add(caravan.id);
    for (const stock of caravan.stock) {
      if (stock.resource === 'unfinished' || owns(stock, 'unfinished')) fail('未完成品不能进入商队存货');
      for (const entry of [stock, stock.apparel, stock.weapon, stock.furniture]) if (entry) otherIds.add(entry.id);
    }
  }
  if (d.trade.session) otherIds.add(d.trade.session.id);
  for (const receipt of d.trade.receipts) {
    otherIds.add(receipt.id);
    if (receipt.transferred.some(row => row.batch.resource === 'unfinished' || owns(row.batch, 'unfinished')))
      fail('未完成品不能出现在贸易回执中');
  }
  const bills = new Map(productionQueues(d, d.productionQueues).flatMap(queue => queue.bills.map(bill => [bill.id, bill] as const)));
  for (const bill of bills.values()) if (bill.id.startsWith('bill:')) otherIds.add(Number(bill.id.slice(5)));
  const pieces = new Map<number, UnfinishedPiece>();
  const boundBills = new Set<string>();
  const carriers = new Map<number, VoxelSave['pawns'][number] | VoxelSave['animals'][number]>();
  for (const batch of cargo) {
    if (batch.resource !== 'unfinished') {
      if (owns(batch, 'unfinished')) fail('普通物资包含未完成品字段');
      continue;
    }
    const piece = batch.unfinished;
    if (batch.amount !== 1 || !validateUnfinishedPiece(piece) || piece.id >= d.nextId || piece.creatorId >= d.nextId ||
        piece.workTicks > d.tick || (piece.policy.workerId !== null && piece.policy.workerId >= d.nextId) ||
        (piece.productQuality !== undefined && piece.productQuality.workerId >= d.nextId) ||
        pieces.has(piece.id) || otherIds.has(piece.id)) fail('实体重复、材料、作者或工量无效');
    if (piece.boundBillId !== null && bills.get(piece.boundBillId)?.recipe !== piece.recipe)
      fail('绑定账单不存在或配方不符');
    if (piece.boundBillId !== null) {
      if (boundBills.has(piece.boundBillId)) fail('同一账单绑定了多个未完成品');
      boundBills.add(piece.boundBillId);
    }
    pieces.set(piece.id, piece);
  }
  for (const pawn of d.pawns) if (pawn.cargo?.unfinished) {
    if (pawn.faction !== 'colony') fail('非殖民者携带未完成品');
    carriers.set(pawn.cargo.unfinished.id, pawn);
  }
  for (const animal of d.animals ?? []) if (animal.cargo?.unfinished) {
    if (animal.faction !== 'colony') fail('非殖民地动物携带未完成品');
    carriers.set(animal.cargo.unfinished.id, animal);
  }
  const referenced = new Set<number>();
  for (const job of d.jobs) {
    if (job.deliveredBatches.some(batch => batch.resource === 'unfinished' || owns(batch, 'unfinished')) ||
        owns(job.delivered, 'unfinished') || owns(job.cost, 'unfinished')) fail('作业只能引用未完成品，不能拥有副本或把它当原料');
    if (!owns(job, 'unfinishedId')) continue;
    const piece = pieces.get(job.unfinishedId!), carrier = carriers.get(job.unfinishedId!);
    if (!integer(job.unfinishedId, 1, d.nextId - 1) || !piece || referenced.has(piece.id) || job.cancelled ||
        productionJobRecipe(job) !== piece.recipe || job.billId !== piece.boundBillId ||
        Object.keys(job.delivered).length || job.deliveredBatches.length ||
        job.work !== piece.workTotal || job.progress !== piece.progress || job.workTicks !== piece.workTicks ||
        !job.productionPolicy || policyKey(job.productionPolicy) !== policyKey(piece.policy) ||
        qualityKey(job.productQuality) !== qualityKey(piece.productQuality) ||
        (job.owner !== null && job.owner !== piece.creatorId) ||
        (carrier && job.owner !== null && (!('jobId' in carrier) || job.owner !== carrier.id || carrier.jobId !== job.id))) fail('作业引用、作者或进度副本不一致');
    const expected = unfinishedRecipeCost(piece.recipe, unfinishedApparelMaterial(piece) ?? undefined)!;
    if (Object.keys(job.cost).length !== Object.keys(expected).length ||
        Object.entries(expected).some(([resource, amount]) => job.cost[resource as keyof Counts] !== amount))
      fail('作业原配方成本不一致');
    referenced.add(piece.id);
  }
  for (const ledger of [d.stats.produced, d.stats.consumed, d.stats.spoiled, d.stats.destroyed, d.trade.imported, d.trade.exported])
    if (!integer(ledger.unfinished)) fail('未完成品账本无效');
  if (d.stats.spoiled.unfinished !== 0 || d.trade.imported.unfinished !== 0 || d.trade.exported.unfinished !== 0)
    fail('未完成品不能腐坏或交易');
}
