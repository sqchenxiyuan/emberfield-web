import { DAY, type WildAnimal } from './types';
import { animalHungerMultiplier } from './husbandry';

/** Shearing and milking use the same native animal-gather skill/capacity chain. */
export { milkGatherSpeed as woolGatherSpeed, milkGatherChance as woolGatherChance } from './animalMilk';
export const WOOL_RULES = Object.freeze({ intervalTicks: 10 * DAY, amount: 45, work: 1700, xpPerTick: .13 });

export function woolActive(a: WildAnimal): boolean {
  return a.species === 'alpaca' && !a.dead && a.health > 0 && a.faction === 'colony' && a.growth >= 1;
}
export function advanceWool(a: WildAnimal): void {
  if (woolActive(a)) a.woolGrowth = Math.min(1, a.woolGrowth + animalHungerMultiplier(a.hunger) / WOOL_RULES.intervalTicks);
}
export function woolReady(a: WildAnimal): boolean {
  return woolActive(a) && a.woolGrowth === 1 && !a.slaughter && !a.releaseMarked && !a.hunt;
}
