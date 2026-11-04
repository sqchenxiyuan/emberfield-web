import { DAY, type Cargo, type Resource } from './types';
import { APPAREL_DEFS } from './apparel';
import { WEAPON_DEFS } from './weapons';
import { furnitureStats } from './furniture';

export interface DeteriorationEnvironment {
  exposed: boolean;
  outdoors: boolean;
  rainRate: number;
  protected?: boolean;
}
export interface ResourceConditionDefinition {
  maxHitPoints: number | null;
  /** Native base HP loss per game day, before quality and environmental factors. */
  ratePerDay: number;
}
/** Core 1.7 selected definitions, with generated meat/corpse values confirmed
 * from ThingDefGenerator_Meat/Corpses. Steel, silver and stone blocks disable
 * useHitPoints; rock chunks have HP but no environmental deterioration rate. */
export const RESOURCE_CONDITION_DEFS: Readonly<Record<Exclude<Resource, 'apparel' | 'weapon' | 'furniture'>, Readonly<ResourceConditionDefinition>>> = {
  silver: { maxHitPoints: null, ratePerDay: 0 },
  wood: { maxHitPoints: 150, ratePerDay: .5 },
  stone: { maxHitPoints: null, ratePerDay: 0 },
  steel: { maxHitPoints: null, ratePerDay: 0 },
  components: { maxHitPoints: 70, ratePerDay: 2 },
  food: { maxHitPoints: 50, ratePerDay: .25 },
  grain: { maxHitPoints: 60, ratePerDay: 6 },
  meat: { maxHitPoints: 60, ratePerDay: 6 },
  carcass: { maxHitPoints: 100, ratePerDay: 1 },
  meal: { maxHitPoints: 50, ratePerDay: 10 },
  chunk: { maxHitPoints: 300, ratePerDay: 0 },
  cloth: { maxHitPoints: 80, ratePerDay: 4 },
  herb: { maxHitPoints: 60, ratePerDay: 6 },
};
export const DETERIORATION_QUALITY = [2, 1.5, 1, .8, .6, .3, .1] as const;
export const DETERIORATION_RULES = Object.freeze({ interval: 100, equipmentRatePerDay: 2 });

export function batchMaxHitPoints(batch: Cargo): number | null {
  if (batch.resource === 'apparel') return batch.apparel ? APPAREL_DEFS[batch.apparel.kind]?.maxHitPoints ?? null : null;
  if (batch.resource === 'weapon') return batch.weapon ? WEAPON_DEFS[batch.weapon.kind]?.maxHitPoints ?? null : null;
  if (batch.resource === 'furniture') return batch.furniture ? furnitureStats(batch.furniture.kind, batch.furniture.quality).maxHitPoints : null;
  return RESOURCE_CONDITION_DEFS[batch.resource]?.maxHitPoints ?? null;
}
/** Missing ordinary HP is the canonical full-condition representation. Equipment
 * always keeps its existing nested HP; there is never a second equipment pool. */
export function batchHitPoints(batch: Cargo): number | null {
  if (batch.resource === 'apparel') return batch.apparel?.hitPoints ?? null;
  if (batch.resource === 'weapon') return batch.weapon?.hitPoints ?? null;
  if (batch.resource === 'furniture') return batch.furniture?.hitPoints ?? null;
  const maximum = batchMaxHitPoints(batch);
  return maximum === null ? null : batch.hitPoints ?? maximum;
}
export function batchHpFraction(batch: Cargo): number {
  const maximum = batchMaxHitPoints(batch), hitPoints = batchHitPoints(batch);
  return maximum === null || hitPoints === null ? 1 : Math.max(0, Math.min(1, hitPoints / maximum));
}
/** Zero is transient: the owning physical container must remove/count the batch
 * immediately. Persisted living batches must have strictly positive HP. */
export function setBatchHitPoints(batch: Cargo, hitPoints: number): void {
  const maximum = batchMaxHitPoints(batch);
  if (maximum === null || !Number.isFinite(hitPoints) ||
      (batch.resource !== 'furniture' && !Number.isInteger(hitPoints)) || hitPoints < 0 || hitPoints > maximum)
    throw new RangeError('物资耐久无效');
  if (batch.resource === 'apparel') batch.apparel!.hitPoints = hitPoints;
  else if (batch.resource === 'weapon') batch.weapon!.hitPoints = hitPoints;
  else if (batch.resource === 'furniture') batch.furniture!.hitPoints = hitPoints;
  else if (hitPoints === maximum) delete batch.hitPoints;
  else batch.hitPoints = hitPoints;
}
/** Nested apparel/weapon structure is validated by their existing validators. */
export function validBatchHitPoints(batch: Cargo): boolean {
  if (batch.hitPoints === undefined) return true;
  if (batch.resource === 'apparel' || batch.resource === 'weapon' || batch.resource === 'furniture') return false;
  const maximum = batchMaxHitPoints(batch);
  return maximum !== null && Number.isInteger(batch.hitPoints) && batch.hitPoints > 0 && batch.hitPoints <= maximum;
}
export function deteriorationEnvironmentFactor(env: DeteriorationEnvironment): number {
  if (typeof env.exposed !== 'boolean' || typeof env.outdoors !== 'boolean' ||
      (env.protected !== undefined && typeof env.protected !== 'boolean') ||
      !Number.isFinite(env.rainRate) || env.rainRate < 0 || env.rainRate > 1)
    throw new RangeError('物资劣化环境无效');
  if (env.protected) return 0;
  // A roofed open-sided shed still uses outdoor temperature and keeps the .5
  // outdoor term. Rain multiplies the total only when this actual cell is exposed.
  return ((env.exposed ? .5 : 0) + (env.outdoors ? .5 : 0)) * (env.exposed ? 1 + 4 * env.rainRate : 1);
}
export function deteriorationRate(batch: Cargo, env: DeteriorationEnvironment): number {
  let base: number;
  if (batch.resource === 'apparel') base = batch.apparel
    ? DETERIORATION_RULES.equipmentRatePerDay * DETERIORATION_QUALITY[batch.apparel.quality] : 0;
  else if (batch.resource === 'weapon') base = batch.weapon
    ? DETERIORATION_RULES.equipmentRatePerDay * (WEAPON_DEFS[batch.weapon.kind].hasQuality ? DETERIORATION_QUALITY[batch.weapon.quality] : 1) : 0;
  // Native MinifiedThing has no DeteriorationRate override or inheritance of
  // the inner building for this stat: its default is zero, not equipment's 2.
  else if (batch.resource === 'furniture') base = 0;
  else base = RESOURCE_CONDITION_DEFS[batch.resource]?.ratePerDay ?? 0;
  return base * deteriorationEnvironmentFactor(env);
}
/** Separate stateless stream: sampling never consumes weather/fire RNG and
 * save/load preserves a given seed, physical identity and scheduled tick. */
export function deteriorationRandom(seed: number, id: number, tick: number): number {
  let h = Math.imul((seed | 0) ^ Math.floor(seed / 4294967296), 0x45d9f3b) ^
    Math.imul((id | 0) ^ Math.floor(id / 4294967296), 0x27d4eb2d) ^
    Math.imul((tick | 0) ^ Math.floor(tick / 4294967296), 0x85ebca6b) ^ 0x7d3c6a91;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Web scheduling samples ground containers every 100 ticks; native shuffled
 * cell visits are not reproduced. Expected HP/day and integer damage are kept.
 * Return true only when the whole physical batch reaches zero HP; quantity,
 * spoilage and accounting belong to the owner and are never changed here. */
export function advanceDeterioration(batch: Cargo, env: DeteriorationEnvironment,
  seed: number, id: number, tick: number, elapsedTicks: number = DETERIORATION_RULES.interval): boolean {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(id) || id <= 0 ||
      !Number.isSafeInteger(tick) || tick < 0 || !Number.isFinite(elapsedTicks) ||
      elapsedTicks < 0 || elapsedTicks > DETERIORATION_RULES.interval)
    throw new RangeError('物资劣化采样无效');
  const hitPoints = batchHitPoints(batch), rate = deteriorationRate(batch, env);
  if (hitPoints === null || rate === 0 || elapsedTicks === 0) return false;
  if (hitPoints <= 0) return true;
  if (deteriorationRandom(seed, id, tick) >= rate * elapsedTicks / DAY) return false;
  setBatchHitPoints(batch, Math.max(0, hitPoints - 1));
  return hitPoints <= 1;
}
