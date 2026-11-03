import type { Cargo, Resource } from './types';
import { compatibleBatches } from './preservation';

/** Native Def stack limits. Stone denotes cut stone blocks, not rock chunks. */
export const STACK_LIMITS: Readonly<Record<Resource, number>> = Object.freeze({
  silver: 500,
  wood: 75,
  stone: 75,
  steel: 75,
  components: 50,
  food: 10,
  grain: 75,
  meat: 75,
  carcass: 1,
  meal: 10,
  chunk: 1,
  cloth: 75,
  herb: 25,
  apparel: 1,
  weapon: 1,
});
export const stackLimit = (resource: Resource) => STACK_LIMITS[resource];
/** Healthy adult ordinary hauling: one stack, at most 75 units. */
export const carryLimit = (resource: Resource) => Math.min(75, stackLimit(resource));
export function stackSpace(
  existing: Cargo | undefined,
  incoming: Pick<Cargo, 'resource' | 'crop' | 'apparel' | 'weapon' | 'carcass'>,
): number {
  return existing && !compatibleBatches(existing, { ...incoming, amount: 1 })
    ? 0
    : Math.max(0, stackLimit(incoming.resource) - (existing?.amount ?? 0));
}

// Immediate output/refund placement stays close to the physical container.
export const DROP_DISTANCE = 3;
export const MIGRATION_DISTANCE = 12;
