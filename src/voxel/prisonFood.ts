import { HEIGHT, inside, type Pos } from './types';
import { FOOD_POLICY_RESOURCES, type FoodResource } from './foodPolicies';
import { carryLimit } from './logistics';

export interface PrisonFoodTask {
  prisonerId: number;
  sourceId: number | null;
  resource: FoodResource;
  amount: number;
  target: Pos;
  stage: 'fetch' | 'deliver';
}
/** Native room-food supply uses Preferability > RawBad. These are the
 * implemented kinds that qualify; policy still controls the delivered meal. */
export const PRISON_ROOM_FOOD_RESOURCES: readonly FoodResource[] = ['meal', 'food', 'milk'];
export const PRISON_FOOD_RULES = { hungryAt: 26, nutritionMargin: .5 } as const;

const id = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const exact = (value: unknown, keys: readonly string[]): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

/** Pure shape validation. Actual source/recipient ownership, global identity
 * bounds, shared reservations and traversable cell checks belong to callers. */
export function validPrisonFoodTask(value: unknown): value is PrisonFoodTask {
  return exact(value, ['prisonerId', 'sourceId', 'resource', 'amount', 'target', 'stage']) &&
    id(value.prisonerId) && FOOD_POLICY_RESOURCES.includes(value.resource) &&
    Number.isSafeInteger(value.amount) && value.amount >= 1 && value.amount <= carryLimit(value.resource) &&
    exact(value.target, ['x', 'y', 'z']) && inside(value.target as Pos) && value.target.z >= 1 && value.target.z < HEIGHT - 1 &&
    ((value.stage === 'fetch' && id(value.sourceId)) || (value.stage === 'deliver' && value.sourceId === null));
}
