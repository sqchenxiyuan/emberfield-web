import { compatibleApparel } from './apparel';
import { APPAREL_POLICY_LIMIT, createDefaultApparelPolicies, initialApparelControl,
  normalizeApparelPolicy, policyAllowsApparel } from './apparelPolicies';
import type { VoxelSave } from './types';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, any> => record(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
function fail(reason: string): never { throw new Error('服装政策存档无效：' + reason); }

export function rejectLegacyApparelPolicies(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 56) return;
  if (Object.hasOwn(old, 'apparelPolicies') || (Array.isArray(old.pawns) && old.pawns.some(p =>
    record(p) && (Object.hasOwn(p, 'apparelControl') ||
      (record(p.apparelTask) && Object.hasOwn(p.apparelTask, 'automatic'))))))
    fail('旧版本混入服装政策、强制穿戴或自动任务');
}

/** Preflight all carriers before assigning anything. Earlier migration stages
 * must not invent this schema; all historical pawns retain manual management. */
export function migrateApparelPolicies(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 56) return;
  rejectLegacyApparelPolicies(old, sourceVersion);
  if (!Number.isSafeInteger(old.tick) || old.tick < 0 || !Array.isArray(old.pawns) || old.pawns.some(p => !record(p)))
    fail('迁移人物或时间无效');
  old.apparelPolicies = createDefaultApparelPolicies();
  for (const p of old.pawns) p.apparelControl = initialApparelControl(old.tick);
}

export function validateApparelPolicies(d: VoxelSave): void {
  const state = d.apparelPolicies;
  if (!exact(state, ['nextId', 'policies']) || !id(state.nextId) || !Array.isArray(state.policies) ||
    state.policies.length < 1 || state.policies.length > APPAREL_POLICY_LIMIT) fail('政策集合无效');
  const ids = new Set<number>();
  for (const policy of state.policies) {
    const canonical = normalizeApparelPolicy(policy);
    if (!canonical || canonical.name !== policy.name ||
      canonical.allowedKinds.length !== policy.allowedKinds.length ||
      canonical.allowedKinds.some((kind, i) => policy.allowedKinds[i] !== kind) ||
      ids.has(policy.id) || policy.id >= state.nextId) fail('政策字段、顺序或编号无效');
    ids.add(policy.id);
  }
  if (!Array.isArray(d.pawns)) fail('人物列表无效');
  for (const p of d.pawns) {
    if (!record(p)) fail('人物无效');
    const control = p.apparelControl;
    if (!exact(control, ['policyId', 'forcedIds', 'nextCheckTick']) ||
      (control.policyId !== null && !ids.has(control.policyId)) ||
      !Array.isArray(control.forcedIds) || control.forcedIds.some(value => !id(value)) ||
      new Set(control.forcedIds).size !== control.forcedIds.length ||
      !Number.isSafeInteger(control.nextCheckTick) || control.nextCheckTick < 0 ||
      !Array.isArray(p.worn) || control.forcedIds.some(value => !p.worn.some(piece => piece.id === value)) ||
      (p.faction !== 'colony' && (control.policyId !== null || control.forcedIds.length > 0)))
      fail('人物政策引用、强制衣物或检查时间无效');
    const task = p.apparelTask;
    if (task !== null) {
      const automatic = record(task) && Object.hasOwn(task, 'automatic');
      if (!exact(task, ['action', 'apparelId', 'stage', 'progress', ...(automatic ? ['automatic'] : [])]) ||
        (automatic && task.automatic !== true)) fail('穿衣任务字段无效');
      if (automatic) {
        const policy = state.policies.find(policy => policy.id === control.policyId);
        if (!policy || p.faction !== 'colony') fail('自动任务没有有效政策');
        const piece = task.action === 'remove' ? p.worn.find(piece => piece.id === task.apparelId)
          : task.stage === 'fetch' ? d.items.find(item => item.apparel?.id === task.apparelId)?.apparel : p.cargo?.apparel;
        if (!piece || (task.action === 'remove' &&
          (control.forcedIds.includes(piece.id) || policyAllowsApparel(policy, piece))) ||
          (task.action === 'wear' && (!policyAllowsApparel(policy, piece) || p.worn.some(old =>
            control.forcedIds.includes(old.id) && !compatibleApparel(old, piece))))) fail('自动任务违反政策或强制穿戴');
      }
    }
  }
}
