import { DAY, type WildAnimal } from './types';
import { animalHungerMultiplier } from './husbandry';

/** Native milk interval/amount and gather formulas; Web day length and the
 * existing simplified animal lifecycle remain explicit prototype tuning. */
export const MILK_RULES = Object.freeze({ intervalTicks: 2 * DAY, amount: 18, work: 400, xpPerTick: .13 });
export function milkActive(a: WildAnimal): boolean {
  return a.species === 'dromedary' && !a.dead && a.health > 0 && a.faction === 'colony' && a.sex === 'female' && a.growth >= 1;
}
export function advanceMilk(a: WildAnimal): void {
  if (milkActive(a)) a.milkFullness = Math.min(1, a.milkFullness + animalHungerMultiplier(a.hunger) / MILK_RULES.intervalTicks);
}
/** Work eligibility includes current player intent. Rope reservation and daily
 * interaction cooldown are checked by the host, just as other handler tasks. */
export function milkReady(a: WildAnimal): boolean {
  return milkActive(a) && a.milkFullness === 1 && !a.slaughter && !a.releaseMarked && !a.hunt;
}
const YIELD = [.6,.7,.75,.8,.85,.9,.95,.975,1,1.01,1.02,1.03,1.04,1.05,1.06,1.07,1.08,1.09,1.10,1.12,1.13];
function inputs(skill: number, manipulation: number, sight: number) {
  if (!Number.isInteger(skill) || skill < 0 || skill > 20 || !Number.isFinite(manipulation) || manipulation < 0 || !Number.isFinite(sight) || sight < 0)
    throw new RangeError('挤奶能力参数无效');
}
export function milkGatherSpeed(skill: number, manipulation = 1, sight = 1): number {
  inputs(skill, manipulation, sight);
  return Math.max(.1, (.04 + .12 * skill) * manipulation * (.5 + .5 * Math.min(sight,1)));
}
/** Probability, never a multiplier on the physical amount. */
export function milkGatherChance(skill: number, manipulation = 1, sight = 1): number {
  inputs(skill, manipulation, sight);
  return Math.min(1, YIELD[skill] * (.7 + .3 * manipulation) * (.8 + .2 * Math.min(sight,1)));
}
