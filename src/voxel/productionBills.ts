import { ARMOR_KINDS, TAILOR_KINDS } from './apparel';
import type { ApparelKind, ArmorKind, Job, VoxelSave } from './types';
import { WEAPON_DEFS, WEAPON_KINDS, type WeaponKind } from './weapons';

export type ProductionRecipe =
  | 'cook'
  | 'butcher'
  | 'stonecut'
  | `tailoring:${ApparelKind}`
  | `smith:${WeaponKind}`
  | `armorsmith:${ArmorKind}`;

export interface ProductionBill {
  id: string;
  recipe: ProductionRecipe;
  mode: 'count' | 'forever' | 'target';
  remaining: number;
  target: number;
  suspended: boolean;
  pauseWhenSatisfied: boolean;
  resumeBelow: number;
  waiting: boolean;
}
export interface ProductionQueue { benchId: number; bills: ProductionBill[] }
export type ProductionHost = Pick<VoxelSave, 'stoves' | 'butcherSpots' | 'stonecutters' | 'tailors' | 'weaponBenches'>;
export const MAX_PRODUCTION_BILLS = 32;
export const MAX_PRODUCTION_AMOUNT = 100000;

const allBenches = (host: ProductionHost) => [
  ...host.stoves, ...host.butcherSpots, ...host.stonecutters, ...host.tailors, ...host.weaponBenches,
];
const recipes = new Set<string>([
  'cook', 'butcher', 'stonecut',
  ...TAILOR_KINDS.map(kind => `tailoring:${kind}`),
  ...WEAPON_KINDS.map(kind => `smith:${kind}`),
  ...ARMOR_KINDS.map(kind => `armorsmith:${kind}`),
]);
const productionKinds = new Set(['cook', 'butcher', 'stonecut', 'tailoring', 'smith', 'armorsmith']);

/** Research and worker eligibility are scheduling decisions, not recipe ownership. */
export function recipeAllowed(host: ProductionHost, benchId: number, recipe: ProductionRecipe): boolean {
  if (!recipes.has(recipe)) return false;
  if (host.stoves.some(bench => bench.id === benchId)) return recipe === 'cook';
  if (host.butcherSpots.some(bench => bench.id === benchId)) return recipe === 'butcher';
  if (host.stonecutters.some(bench => bench.id === benchId)) return recipe === 'stonecut';
  if (host.tailors.some(bench => bench.id === benchId)) return recipe.startsWith('tailoring:');
  const bench = host.weaponBenches.find(value => value.id === benchId);
  if (!bench) return false;
  if (recipe.startsWith('armorsmith:')) return bench.kind === 'smithy';
  if (!recipe.startsWith('smith:')) return false;
  return WEAPON_DEFS[recipe.slice(6) as WeaponKind].benches.includes(bench.kind);
}

export function makeProductionBill(id: string, recipe: ProductionRecipe): ProductionBill {
  return {
    id, recipe, mode: 'count', remaining: 1, target: 10, suspended: false,
    pauseWhenSatisfied: false, resumeBelow: 5, waiting: false,
  };
}

/** Legacy fields remain an adapter until a player edits this bench's queue. */
export function defaultProductionQueue(host: ProductionHost, benchId: number): ProductionQueue | undefined {
  const bill = (recipe: ProductionRecipe, target: number, suspended: boolean): ProductionBill => ({
    ...makeProductionBill(`legacy:${benchId}:${recipe}`, recipe),
    mode: recipe === 'butcher' ? 'forever' : 'target', target, suspended,
    resumeBelow: Math.min(5, target),
  });
  const stove = host.stoves.find(value => value.id === benchId);
  if (stove) return { benchId, bills: [bill('cook', stove.target, stove.paused)] };
  const butcher = host.butcherSpots.find(value => value.id === benchId);
  if (butcher) return { benchId, bills: [bill('butcher', 10, butcher.paused)] };
  const stonecutter = host.stonecutters.find(value => value.id === benchId);
  if (stonecutter) return { benchId, bills: [bill('stonecut', stonecutter.target, stonecutter.paused)] };
  const tailor = host.tailors.find(value => value.id === benchId);
  if (tailor) return { benchId, bills: tailor.bills.map(value => bill(`tailoring:${value.kind}`, value.target, value.paused)) };
  const weaponBench = host.weaponBenches.find(value => value.id === benchId);
  if (weaponBench) return {
    benchId,
    bills: [
      ...weaponBench.bills.map(value => bill(`smith:${value.kind}`, value.target, value.paused)),
      ...weaponBench.armorBills.map(value => bill(`armorsmith:${value.kind}`, value.target, value.paused)),
    ],
  };
  return undefined;
}

/** Explicit queues retain identity so hysteresis and remaining iterations persist.
 * An intentionally empty queue must not regenerate the legacy recipes. */
export function productionQueues(host: ProductionHost, overrides: readonly ProductionQueue[]): ProductionQueue[] {
  const configured = new Map(overrides.map(queue => [queue.benchId, queue]));
  return allBenches(host).map(bench => configured.get(bench.id) ?? defaultProductionQueue(host, bench.id)!);
}

export function productionJobRecipe(job: Pick<Job, 'kind' | 'apparelKind' | 'weaponKind'>): ProductionRecipe | null {
  if (job.kind === 'cook' || job.kind === 'butcher' || job.kind === 'stonecut') return job.kind;
  const recipe = job.kind === 'tailoring' || job.kind === 'armorsmith'
    ? `${job.kind}:${job.apparelKind}`
    : job.kind === 'smith' ? `smith:${job.weaponKind}` : '';
  return recipes.has(recipe) ? recipe as ProductionRecipe : null;
}

/** Mutates only the automatic waiting latch. Physical inventory controls the
 * latch; projected output only prevents another batch from being scheduled.
 * Colony-wide counting plus pending output is an Emberfield adaptation. */
export function canStartProduction(bill: ProductionBill, completedCount: number, pendingCount: number): boolean {
  if (bill.mode !== 'target') {
    bill.waiting = false;
    return !bill.suspended && (bill.mode === 'forever' || bill.remaining > 0);
  }
  if (!bill.pauseWhenSatisfied) bill.waiting = false;
  else if (completedCount >= bill.target) bill.waiting = true;
  else if (bill.waiting && completedCount <= bill.resumeBelow) bill.waiting = false;
  return !bill.suspended && !bill.waiting && completedCount + pendingCount < bill.target;
}

/** Call exactly once, after both physical output placement and input consumption
 * commit. A blocked output, cancellation or retry is not an iteration. */
export function finishProductionBill(bill: ProductionBill): void {
  if (bill.mode === 'count' && bill.remaining > 0) bill.remaining--;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
function fail(why: string): never { throw new Error(`生产账单存档无效：${why}`); }
const billKeys = ['id', 'recipe', 'mode', 'remaining', 'target', 'suspended', 'pauseWhenSatisfied', 'resumeBelow', 'waiting'];

function validId(id: unknown, nextId: number): id is string {
  if (typeof id !== 'string') return false;
  const dynamic = /^bill:([1-9]\d*)$/.exec(id);
  if (dynamic) return integer(Number(dynamic[1]), 1, nextId - 1);
  const legacy = /^legacy:([1-9]\d*):(.+)$/.exec(id);
  return !!legacy && integer(Number(legacy[1]), 1, nextId - 1) && recipes.has(legacy[2]);
}

type ProductionJob = Pick<Job, 'kind' | 'apparelKind' | 'weaponKind' | 'x' | 'y' | 'z' | 'cancelled'> & { billId?: string };

/** Current saves are validated as written. Migration belongs to the caller and
 * must not turn malformed v39 data into valid defaults. */
export function validateProductionQueues(
  raw: unknown, host: ProductionHost, nextId: number, jobs: readonly ProductionJob[],
): asserts raw is ProductionQueue[] {
  if (!Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(raw)) fail('列表或身份上界无效');
  const benches = allBenches(host), byBench = new Map(benches.map(bench => [bench.id, bench]));
  if (raw.length > benches.length) fail('账单列表超过现有工作台数量');
  const queueIds = new Set<number>(), billIds = new Set<string>();
  for (const queue of raw) {
    if (!record(queue) || !exactKeys(queue, ['benchId', 'bills']) ||
        !integer(queue.benchId, 1, nextId - 1) || !byBench.has(queue.benchId) || queueIds.has(queue.benchId) ||
        !Array.isArray(queue.bills) || queue.bills.length > MAX_PRODUCTION_BILLS) fail('工作台身份、重复列表或账单数量无效');
    queueIds.add(queue.benchId);
    for (const value of queue.bills) {
      if (!record(value) || !exactKeys(value, billKeys) || !validId(value.id, nextId) || billIds.has(value.id) ||
          (value.id.startsWith('bill:') && byBench.has(Number(value.id.slice(5)))) ||
          typeof value.recipe !== 'string' || !recipeAllowed(host, queue.benchId, value.recipe as ProductionRecipe) ||
          (value.id.startsWith('legacy:') && value.id !== `legacy:${queue.benchId}:${value.recipe}`) ||
          !['count', 'forever', 'target'].includes(value.mode as string) ||
          !integer(value.remaining, 0, MAX_PRODUCTION_AMOUNT) || !integer(value.target, 0, MAX_PRODUCTION_AMOUNT) ||
          !integer(value.resumeBelow, 0, MAX_PRODUCTION_AMOUNT) || value.resumeBelow > value.target ||
          typeof value.suspended !== 'boolean' || typeof value.pauseWhenSatisfied !== 'boolean' ||
          typeof value.waiting !== 'boolean' || (value.waiting && (value.mode !== 'target' || !value.pauseWhenSatisfied)))
        fail('账单身份、配方、模式或数值无效');
      billIds.add(value.id);
    }
  }
  const resolved = new Map(productionQueues(host, raw as ProductionQueue[]).map(queue => [queue.benchId, queue]));
  for (const job of jobs) {
    const hasId = Object.hasOwn(job, 'billId');
    if (!productionKinds.has(job.kind)) {
      if (hasId) fail('非生产作业包含账单身份');
      continue;
    }
    if (hasId && !validId(job.billId, nextId)) fail('作业账单身份格式无效');
    // Cancelled jobs only retain physical inputs until they can be refunded;
    // their bench or bill may already have been removed.
    if (job.cancelled) continue;
    const recipe = productionJobRecipe(job);
    const bench = benches.find(value => value.x === job.x && value.y === job.y && value.z === job.z);
    if (!recipe || !bench || !recipeAllowed(host, bench.id, recipe)) fail('生产作业与工作台或配方不符');
    if (!hasId) {
      if (queueIds.has(bench.id)) fail('已配置账单的生产作业缺少账单身份');
      continue;
    }
    const bill = resolved.get(bench.id)?.bills.find(value => value.id === job.billId);
    if (!bill || bill.recipe !== recipe || bill.suspended) fail('生产作业引用了缺失、不同配方或手动暂停的账单');
  }
}
