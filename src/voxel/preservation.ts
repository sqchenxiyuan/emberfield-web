import { DAY, type Cargo, type FoodCropKind, type Resource } from './types';
import { validApparel } from './apparel';
import { validWeapon } from './weapons';

// RimWorld 1.7 source/Defs: 60000 original ticks/day, rate * elapsed ticks.
// We preserve days, using this simulation's DAY=12000 instead. Unlike the native
// rare-tick scheduler, world containers advance once per simulation tick.
export const ROT_DAYS = Object.freeze({ rice: 40, potato: 30, corn: 60, meal: 4, herb: 150 });
export const isPerishable = (resource: Resource) => ['grain', 'meal', 'herb'].includes(resource);
export function rotRateAtTemperature(temperature: number): number {
  if (!Number.isFinite(temperature)) throw new RangeError('Temperature must be finite');
  return temperature <= 0 ? 0 : temperature >= 10 ? 1 : temperature / 10;
}
export function rotLimit(batch: Pick<Cargo, 'resource' | 'crop'>): number | null {
  if (batch.resource === 'meal') return ROT_DAYS.meal * DAY;
  if (batch.resource === 'herb') return ROT_DAYS.herb * DAY;
  if (batch.resource === 'grain' && batch.crop && Object.hasOwn(ROT_DAYS, batch.crop))
    return ROT_DAYS[batch.crop] * DAY;
  return null;
}
/** Remaining days at full rot rate, not a forecast of future room temperature. */
export function remainingRotDays(batch: Cargo): number | null {
  const limit = rotLimit(batch);
  return limit === null ? null : Math.max(0, (limit - (batch.rotProgress ?? 0)) / DAY);
}
export function freshBatch(resource: Resource, amount: number, crop?: FoodCropKind): Cargo {
  if (resource === 'apparel' || resource === 'weapon') throw new Error('装备需要独立实例信息');
  return {
    resource,
    amount,
    ...(resource === 'grain'
      ? { crop: crop ?? 'rice', rotProgress: 0 }
      : resource === 'meal' || resource === 'herb'
        ? { rotProgress: 0 }
        : {}),
  };
}
/** A physical split inherits the current age exactly. */
export function portion(batch: Cargo, amount: number): Cargo {
  return {
    resource: batch.resource,
    amount,
    ...(batch.crop !== undefined ? { crop: batch.crop } : {}),
    ...(batch.apparel !== undefined ? { apparel: { ...batch.apparel } } : {}),
    ...(batch.weapon !== undefined ? { weapon: { ...batch.weapon } } : {}),
    ...(batch.forbidden !== undefined ? { forbidden: batch.forbidden } : {}),
    ...(batch.rotProgress !== undefined ? { rotProgress: batch.rotProgress } : {}),
  };
}
export function compatibleBatches(a: Cargo, b: Cargo): boolean {
  return (
    a.resource === b.resource &&
    a.crop === b.crop &&
    (a.resource !== 'weapon' || (!!a.weapon && !!b.weapon && a.weapon.id === b.weapon.id)) &&
    (a.resource !== 'apparel' || (!!a.apparel && !!b.apparel && a.apparel.id === b.apparel.id))
  );
}
/** Merge only the transferred amount, weighted by actual quantities. */
export function mergeBatch(target: Cargo, incoming: Cargo): void {
  if (
    ['apparel', 'weapon'].includes(target.resource) ||
    ['apparel', 'weapon'].includes(incoming.resource)
  )
    throw new Error('衣物实例不能合并');
  if (!compatibleBatches(target, incoming) || incoming.amount <= 0 || target.amount <= 0)
    throw new Error('Only positive compatible batches can merge');
  if (isPerishable(target.resource)) {
    const total = target.amount + incoming.amount;
    target.rotProgress =
      ((target.rotProgress ?? 0) * target.amount + (incoming.rotProgress ?? 0) * incoming.amount) /
      total;
  }
  target.amount += incoming.amount;
}
/** True means the entire stack expires now. The owner removes/counts it once. */
export function advanceRot(batch: Cargo, temperature: number, ticks = 1): boolean {
  const limit = rotLimit(batch);
  if (limit === null) return false;
  if (!Number.isFinite(ticks) || ticks < 0) throw new RangeError('Invalid rot duration');
  batch.rotProgress = (batch.rotProgress ?? 0) + rotRateAtTemperature(temperature) * ticks;
  return batch.rotProgress >= limit;
}
/** v5 must not silently repair missing/mismatched food metadata. */
export function validBatch(batch: unknown): batch is Cargo {
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return false;
  const b = batch as Cargo;
  if (
    ![
      'wood',
      'stone',
      'chunk',
      'steel',
      'components',
      'food',
      'grain',
      'meal',
      'cloth',
      'herb',
      'apparel',
      'weapon',
    ].includes(b.resource) ||
    !Number.isSafeInteger(b.amount) ||
    b.amount <= 0 ||
    b.amount > 10_000_000
  )
    return false;
  if (
    b.resource === 'grain'
      ? !['rice', 'potato', 'corn'].includes(b.crop ?? '')
      : b.crop !== undefined
  )
    return false;
  if (
    b.resource === 'apparel' ? b.amount !== 1 || !validApparel(b.apparel) : b.apparel !== undefined
  )
    return false;
  if (
    b.resource === 'weapon'
      ? b.amount !== 1 ||
        !validWeapon(b.weapon) ||
        (b.forbidden !== undefined && typeof b.forbidden !== 'boolean')
      : b.weapon !== undefined || b.forbidden !== undefined
  )
    return false;
  const limit = rotLimit(b);
  return limit === null
    ? b.rotProgress === undefined
    : Number.isFinite(b.rotProgress) && b.rotProgress! >= 0 && b.rotProgress! < limit;
}
