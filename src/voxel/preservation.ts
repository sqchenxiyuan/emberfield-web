import { DAY, type Cargo, type FoodCropKind, type Resource } from './types';
import { validApparel } from './apparel';
import { validWeapon } from './weapons';
import { validFurniturePiece } from './relocation';
import { WILDLIFE } from './wildlife';
import { batchHitPoints, setBatchHitPoints, validBatchHitPoints } from './deterioration';
import { validateUnfinishedPiece } from './unfinishedProduction';
import { ANIMAL_HUSBANDRY } from './husbandry';

// RimWorld 1.7 source/Defs: 60000 original ticks/day, rate * elapsed ticks.
// We preserve days, using this simulation's DAY=12000 instead. Unlike the native
// rare-tick scheduler, world containers advance once per simulation tick.
export const ROT_DAYS = Object.freeze({ rice: 40, potato: 30, corn: 60, meal: 4, herb: 150, milk: 14 });
export const isPerishable = (resource: Resource) => ['grain', 'meat', 'carcass', 'meal', 'herb', 'milk'].includes(resource);
export function rotRateAtTemperature(temperature: number): number {
  if (!Number.isFinite(temperature)) throw new RangeError('Temperature must be finite');
  return temperature <= 0 ? 0 : temperature >= 10 ? 1 : temperature / 10;
}
export function rotLimit(batch: Pick<Cargo, 'resource' | 'crop'>): number | null {
  // Animal food durations are provisional local values, not native calibration.
  if (batch.resource === 'meat') return WILDLIFE.meatRotDays * DAY;
  if (batch.resource === 'carcass') return WILDLIFE.carcassRotDays * DAY;
  if (batch.resource === 'meal') return ROT_DAYS.meal * DAY;
  if (batch.resource === 'herb') return ROT_DAYS.herb * DAY;
  if (batch.resource === 'milk') return ROT_DAYS.milk * DAY;
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
  if (resource === 'apparel' || resource === 'weapon' || resource === 'furniture' || resource === 'unfinished') throw new Error('装备、家具和未完成品需要独立实例信息');
  if (resource === 'carcass') throw new Error('动物尸体需要独立动物身份信息');
  return {
    resource,
    amount,
    ...(resource === 'grain'
      ? { crop: crop ?? 'rice', rotProgress: 0 }
      : isPerishable(resource)
        ? { rotProgress: 0 }
        : {}),
  };
}
/** A physical split inherits current age and condition exactly. */
export function portion(batch: Cargo, amount: number): Cargo {
  if (batch.resource === 'unfinished' && (batch.amount !== 1 || amount !== 1 || !validateUnfinishedPiece(batch.unfinished)))
    throw new RangeError('未完成品只能整件转移');
  if (batch.resource === 'furniture' && (batch.amount !== 1 || amount !== 1 || !validFurniturePiece(batch.furniture)))
    throw new RangeError('打包家具只能整件转移');
  return {
    resource: batch.resource,
    amount,
    ...(batch.hitPoints !== undefined ? { hitPoints: batch.hitPoints } : {}),
    ...(batch.crop !== undefined ? { crop: batch.crop } : {}),
    ...(batch.apparel !== undefined ? { apparel: { ...batch.apparel } } : {}),
    ...(batch.weapon !== undefined ? { weapon: { ...batch.weapon } } : {}),
    ...(batch.furniture !== undefined ? { furniture: 'settings' in batch.furniture
      ? { ...batch.furniture, settings: { ...batch.furniture.settings, accepts: [...batch.furniture.settings.accepts] } }
      : { ...batch.furniture } } : {}),
    ...(batch.unfinished !== undefined ? { unfinished: structuredClone(batch.unfinished) } : {}),
    ...(batch.carcass !== undefined ? { carcass: { ...batch.carcass } } : {}),
    ...(batch.forbidden !== undefined ? { forbidden: batch.forbidden } : {}),
    ...(batch.rotProgress !== undefined ? { rotProgress: batch.rotProgress } : {}),
    ...(batch.poisonChance !== undefined ? { poisonChance: batch.poisonChance } : {}),
  };
}
export function compatibleBatches(a: Cargo, b: Cargo): boolean {
  return (
    a.resource === b.resource &&
    a.crop === b.crop &&
    (a.resource !== 'weapon' || (!!a.weapon && !!b.weapon && a.weapon.id === b.weapon.id)) &&
    (a.resource !== 'apparel' || (!!a.apparel && !!b.apparel && a.apparel.id === b.apparel.id)) &&
    (a.resource !== 'furniture' || (!!a.furniture && !!b.furniture && a.furniture.id === b.furniture.id)) &&
    (a.resource !== 'unfinished' || (!!a.unfinished && !!b.unfinished && a.unfinished.id === b.unfinished.id)) &&
    (a.resource !== 'carcass' || (!!a.carcass && !!b.carcass &&
      a.carcass.animalId === b.carcass.animalId && a.carcass.species === b.carcass.species))
  );
}
/** Merge only the transferred amount, weighted by actual quantities. */
export function mergeBatch(target: Cargo, incoming: Cargo): void {
  if (
    ['apparel', 'weapon', 'carcass', 'furniture', 'unfinished'].includes(target.resource) ||
    ['apparel', 'weapon', 'carcass', 'furniture', 'unfinished'].includes(incoming.resource)
  )
    throw new Error('装备、家具和动物尸体实例不能合并');
  if (!compatibleBatches(target, incoming) || incoming.amount <= 0 || target.amount <= 0)
    throw new Error('Only positive compatible batches can merge');
  const hitPoints = batchHitPoints(target), incomingHitPoints = batchHitPoints(incoming);
  if (hitPoints !== null && incomingHitPoints !== null)
    // Native Thing.TryAbsorbStack weights only the actual transferred amount,
    // then rounds upward. Repeated splitting/merging may regain fractional HP.
    setBatchHitPoints(target, Math.ceil((hitPoints * target.amount + incomingHitPoints * incoming.amount) /
      (target.amount + incoming.amount)));
  if (isPerishable(target.resource)) {
    const total = target.amount + incoming.amount;
    target.rotProgress =
      ((target.rotProgress ?? 0) * target.amount + (incoming.rotProgress ?? 0) * incoming.amount) /
      total;
  }
  if (target.resource === 'meal' && (target.poisonChance !== undefined || incoming.poisonChance !== undefined))
    target.poisonChance = ((target.poisonChance ?? 0) * target.amount + (incoming.poisonChance ?? 0) * incoming.amount) /
      (target.amount + incoming.amount);
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
  if (b.poisonChance !== undefined && (b.resource !== 'meal' || !Number.isFinite(b.poisonChance) ||
      b.poisonChance < 0 || b.poisonChance > 1)) return false;
  if (
    ![
      'silver',
      'wood',
      'stone',
      'chunk',
      'steel',
      'components',
      'food',
      'grain',
      'meat',
      'milk',
      'carcass',
      'meal',
      'cloth',
      'herb',
      'apparel',
      'weapon',
      'furniture',
      'unfinished',
    ].includes(b.resource) ||
    !Number.isSafeInteger(b.amount) ||
    b.amount <= 0 ||
    b.amount > 10_000_000
  )
    return false;
  if (!validBatchHitPoints(b)) return false;
  if (b.resource === 'furniture' ? b.amount !== 1 || !validFurniturePiece(b.furniture) : b.furniture !== undefined)
    return false;
  if (b.resource === 'unfinished' ? b.amount !== 1 || !validateUnfinishedPiece(b.unfinished) : b.unfinished !== undefined)
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
        !validWeapon(b.weapon)
      : b.weapon !== undefined
  )
    return false;
  if (b.forbidden !== undefined && typeof b.forbidden !== 'boolean') return false;
  if (b.resource === 'carcass') {
    if (b.amount !== 1 || !b.carcass || typeof b.carcass !== 'object' || Array.isArray(b.carcass) ||
        !Number.isSafeInteger(b.carcass.animalId) || b.carcass.animalId <= 0 ||
        !Object.hasOwn(ANIMAL_HUSBANDRY, b.carcass.species) || (b.carcass.bodySize !== undefined &&
          (!Number.isFinite(b.carcass.bodySize) || b.carcass.bodySize <= 0 ||
            b.carcass.bodySize > ANIMAL_HUSBANDRY[b.carcass.species].bodySize))) return false;
  } else if (b.carcass !== undefined) return false;
  const limit = rotLimit(b);
  return limit === null
    ? b.rotProgress === undefined
    : Number.isFinite(b.rotProgress) && b.rotProgress! >= 0 && b.rotProgress! < limit;
}
