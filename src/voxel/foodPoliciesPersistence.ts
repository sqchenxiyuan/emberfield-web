import { FOOD_POLICY_LIMIT, FOOD_POLICY_RESOURCES, createDefaultFoodPolicies, normalizeFoodPolicy } from './foodPolicies';
import type { VoxelSave } from './types';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, any> => record(v) &&
  Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
function fail(reason: string): never { throw new Error('饮食政策存档无效：' + reason); }

export function rejectLegacyFoodPolicies(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 57) return;
  if (Object.hasOwn(old, 'foodPolicies') || (Array.isArray(old.pawns) && old.pawns.some(p =>
    record(p) && (Object.hasOwn(p, 'foodPolicyId') || Object.hasOwn(p, 'manualFoodOrder'))))) fail('旧版本混入饮食政策或手动进食');
}

/** Inspect every carrier before adding any fields. Historical colonies
 * keep their unrestricted behavior without assigning a mutable policy. */
export function migrateFoodPolicies(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 57) return;
  rejectLegacyFoodPolicies(old, sourceVersion);
  if (!Array.isArray(old.pawns) || Array.from(old.pawns).some(p => !record(p))) fail('迁移人物无效');
  old.foodPolicies = createDefaultFoodPolicies();
  for (const p of old.pawns) p.foodPolicyId = null;
}

export function validateFoodPolicies(d: VoxelSave): void {
  const state = d.foodPolicies;
  if (!exact(state, ['nextId', 'policies']) || !id(state.nextId) || !Array.isArray(state.policies) ||
    state.policies.length < 1 || state.policies.length > FOOD_POLICY_LIMIT) fail('政策集合无效');
  const ids = new Set<number>();
  for (const policy of state.policies) {
    const canonical = normalizeFoodPolicy(policy);
    if (!canonical || canonical.name !== policy.name || canonical.allowedResources.length !== policy.allowedResources.length ||
      canonical.allowedResources.some((resource, i) => policy.allowedResources[i] !== resource) ||
      ids.has(policy.id) || policy.id >= state.nextId) fail('政策字段、顺序或编号无效');
    ids.add(policy.id);
  }
  if (!Array.isArray(d.pawns)) fail('人物列表无效');
  for (const p of d.pawns) {
    if (!record(p) || !Object.hasOwn(p, 'foodPolicyId') ||
      (p.foodPolicyId !== null && (!ids.has(p.foodPolicyId) || !['colony', 'prisoner'].includes(p.faction))))
      fail('人物政策引用无效');
    if (!Object.hasOwn(p, 'manualFoodOrder')) continue;
    const order = p.manualFoodOrder;
    if (!exact(order, ['sourceId', 'resource']) || !id(order.sourceId) || !id(d.nextId) || order.sourceId >= d.nextId ||
      !FOOD_POLICY_RESOURCES.includes(order.resource) || p.eating !== order.resource ||
      !['fetch', 'dine'].includes(p.phase) || p.faction !== 'colony' || p.dead !== false ||
      p.downed !== false || p.drafted !== false || p.carriedBy !== null || !record(p.psyche) ||
      !Number.isSafeInteger(p.psyche.breakUntil) || p.psyche.breakUntil < 0 || p.psyche.breakUntil > d.tick)
      fail('手动进食状态无效');
    const source = Array.isArray(d.items) ? d.items.find(item => record(item) && item.id === order.sourceId) : undefined;
    const groundSource = !!source && source.resource === order.resource && source.amount > 0;
    if (p.phase === 'fetch') {
      if (p.jobId !== null || !groundSource) fail('手动进食取食来源无效');
    } else {
      const task = p.living?.mealTask;
      if (!record(task) || (task.sourceId === null
        ? !record(p.cargo) || p.cargo.resource !== order.resource || !(p.cargo.amount > 0)
        : task.sourceId !== order.sourceId || !groundSource)) fail('手动进食用餐来源无效');
    }
  }
}
