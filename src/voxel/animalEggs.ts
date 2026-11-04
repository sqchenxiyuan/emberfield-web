import { DAY, type Cargo, type WildAnimal } from './types';
import { animalHungerMultiplier } from './husbandry';

/** Native days and temperature damage are converted to the Web day clock.
 * Laying's native 500-tick wait is 100 Web ticks. Adult age remains Web tuning. */
export const EGG_RULES = Object.freeze({ intervalTicks: DAY, layWork: 100, fertilizationMax: 1,
  hatchTicks: 3.5 * DAY, minimumTemperature: 0, maximumTemperature: 50,
  damagePerDegreeTick: .00003 * 60000 / DAY, rotDays: 15 });
export function eggLayerActive(a: WildAnimal): boolean {
  return a.species === 'chicken' && a.sex === 'female' && !a.dead && a.health > 0 && a.growth >= 1;
}
export function advanceEggLayer(a: WildAnimal): void {
  if (eggLayerActive(a)) a.eggProgress = Math.min(1, a.eggProgress + animalHungerMultiplier(a.hunger) / EGG_RULES.intervalTicks);
}
export function freshFertilizedEggs(amount: number, faction: 'wild' | 'colony' = 'wild', motherId: number | null = null,
  fatherId: number | null = null): Cargo {
  return { resource: 'eggFertilized', amount, hatcher: { progress: 0, temperatureDamage: 0, faction, motherId, fatherId } };
}
export function validHatcher(value: unknown): value is NonNullable<Cargo['hatcher']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as NonNullable<Cargo['hatcher']>;
  const id = (n: number | null) => n === null || (Number.isSafeInteger(n) && n > 0);
  return Object.keys(v).length === 5 && ['progress','temperatureDamage','faction','motherId','fatherId'].every(k => Object.hasOwn(v,k)) &&
    Number.isFinite(v.progress) && v.progress >= 0 && v.progress <= 1 &&
    Number.isFinite(v.temperatureDamage) && v.temperatureDamage >= 0 && v.temperatureDamage < 1 &&
    ['wild','colony'].includes(v.faction) && id(v.motherId) && id(v.fatherId) &&
    (v.motherId === null || v.fatherId === null || v.motherId !== v.fatherId);
}
/** Container owner performs conversion/hatching atomically. Below full thermal
 * damage, incubation proceeds even outside the safe temperature interval. */
export function advanceHatcher(batch: Cargo, temperature: number, ticks = 1): 'none' | 'ruined' | 'ready' {
  if (batch.resource !== 'eggFertilized' || !batch.hatcher) return 'none';
  if (!Number.isFinite(temperature) || !Number.isFinite(ticks) || ticks < 0) throw new RangeError('孵化温度或时长无效');
  const h = batch.hatcher;
  const excess = Math.max(0, EGG_RULES.minimumTemperature - temperature, temperature - EGG_RULES.maximumTemperature);
  h.temperatureDamage = Math.min(1, h.temperatureDamage + excess * EGG_RULES.damagePerDegreeTick * ticks);
  if (h.temperatureDamage >= 1) return 'ruined';
  h.progress = Math.min(1, h.progress + ticks / EGG_RULES.hatchTicks);
  return h.progress >= 1 ? 'ready' : 'none';
}
