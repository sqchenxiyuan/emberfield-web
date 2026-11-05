import type { Resource } from './types';

/** Native Def stack limits. Kept independent of placement/production imports so
 * animal initial-state factories can validate physical portions without cycles. */
export const STACK_LIMITS: Readonly<Record<Resource, number>> = Object.freeze({
  silver: 500, wood: 75, stone: 75, steel: 75, components: 50, food: 10,
  grain: 75, meat: 75, milk: 75, eggUnfertilized: 75, eggFertilized: 75,
  carcass: 1, meal: 10, chunk: 1, cloth: 75, alpacaWool: 100, herb: 25,
  apparel: 1, weapon: 1, furniture: 1, unfinished: 1,
});
export const stackLimit = (resource: Resource) => STACK_LIMITS[resource];
/** Healthy adult ordinary hauling: one stack, at most 75 units. */
export const carryLimit = (resource: Resource) => Math.min(75, stackLimit(resource));
