import { useState } from 'react';
import {
  FOOD_POLICY_LIMIT,
  FOOD_POLICY_NAME_LIMIT,
  FOOD_POLICY_RESOURCES,
  normalizeFoodPolicy,
  type FoodPolicy,
  type FoodPoliciesState,
} from './foodPolicies';
import { RESOURCE_NAMES, type Pawn, type VoxelCommand } from './types';

type Command = (command: VoxelCommand) => void;
export interface FoodPolicyPanelProps {
  pawn: Pawn;
  policies: FoodPoliciesState;
  pawns: Pawn[];
  command: Command;
}

function FoodPolicyEditor({ policy, users, canDelete, disabled, command }: {
  policy: FoodPolicy; users: Pawn[]; canDelete: boolean; disabled: boolean; command: Command;
}) {
  const [draft, setDraft] = useState<FoodPolicy>(() => ({ ...policy, allowedResources: [...policy.allowedResources] }));
  const normalized = normalizeFoodPolicy(draft);
  const valid = normalized !== null;
  return <form className="voxel-food-policy-editor" data-testid="food-policy-editor" onSubmit={event => {
    event.preventDefault();
    if (!disabled && normalized) command({ type: 'foodPolicyUpdate', policy: normalized });
  }}>
    <small>共享政策，保存后影响使用者：{users.length ? users.map(p => `${p.name}${p.dead ? '（已死亡，保留引用）' : ''}`).join('、') : '暂无'}。</small>
    <fieldset disabled={disabled}>
      <legend>饮食政策设置</legend>
      <label>名称<input aria-label="饮食政策名称" maxLength={FOOD_POLICY_NAME_LIMIT} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <div className="voxel-food-policy-resources" role="group" aria-label="允许的食物类型">
        {FOOD_POLICY_RESOURCES.map(resource => <label key={resource}>
          <input type="checkbox" checked={draft.allowedResources.includes(resource)} onChange={event => setDraft({ ...draft,
            allowedResources: FOOD_POLICY_RESOURCES.filter(r => r === resource ? event.target.checked : draft.allowedResources.includes(r)),
          })} />{RESOURCE_NAMES[resource]}
        </label>)}
      </div>
      {!valid && <small role="status">请输入 1～{FOOD_POLICY_NAME_LIMIT} 个字符的政策名称。</small>}
      {!draft.allowedResources.length && <small>此政策未允许任何食物；即使饥荒也不会解除限制。</small>}
      <div className="voxel-food-policy-buttons">
        <button type="submit" disabled={disabled || !valid}>保存饮食政策</button>
        <button type="button" disabled={disabled || !canDelete} title={canDelete ? '删除未使用的饮食政策' : '仍有角色使用或只剩最后一份政策，无法删除'} onClick={() => command({ type: 'foodPolicyDelete', policyId: policy.id })}>删除饮食政策</button>
      </div>
    </fieldset>
  </form>;
}

export function FoodPolicyPanel({ pawn, policies, pawns, command }: FoodPolicyPanelProps) {
  const [editingId, setEditingId] = useState<number | null>(() => pawn.foodPolicyId ?? policies.policies[0]?.id ?? null);
  if (pawn.faction !== 'colony' && pawn.faction !== 'prisoner') return null;
  const editing = policies.policies.find(policy => policy.id === editingId) ?? policies.policies[0];
  const users = editing ? pawns.filter(p => p.foodPolicyId === editing.id) : [];
  return <section className="voxel-food-policy-panel" data-testid="food-policy-controls" aria-label={`${pawn.name} 的饮食管理`}>
    <label>饮食政策<select aria-label={`${pawn.name} 的饮食政策`} disabled={pawn.dead} value={pawn.foodPolicyId ?? ''} onChange={event => {
      const policyId = event.target.value === '' ? null : Number(event.target.value);
      if (policyId !== null) setEditingId(policyId);
      command({ type: 'pawnFoodPolicy', pawnId: pawn.id, policyId });
    }}>
      <option value="">不限制（无共享政策）</option>
      {policies.policies.map(policy => <option key={policy.id} value={policy.id}>{policy.name}</option>)}
    </select></label>
    <small>{pawn.foodPolicyId === null ? '不使用共享政策，允许所有食物类型。' : '按共享饮食政策选择食物。'}</small>
    {pawn.manualFoodOrder && <small className="voxel-food-order-status" data-testid="manual-food-order">手动食用中：{RESOURCE_NAMES[pawn.manualFoodOrder.resource]}。本次指令覆盖饮食政策，政策本身保持不变。</small>}
    <small>{pawn.faction === 'prisoner' ? '狱卒供餐遵守囚犯政策；囚犯自己吃牢房食物时不受政策限制。' : '自行进食和同伴喂食遵守本人政策；即使饥荒也不会解除限制。精神崩溃时忽略政策。'}</small>
    <small>按食物类型筛选；简餐不区分制作食材。允许某类食物不代表当前有可用的食物。</small>
    <details className="voxel-food-policy-management">
      <summary>编辑共享饮食政策</summary>
      <small>更改政策会取消不符合政策的取食或喂食安排，已携带的食物仍保留。</small>
      <label>编辑政策<select aria-label="编辑饮食政策" value={editing?.id ?? ''} disabled={pawn.dead || !editing} onChange={event => setEditingId(Number(event.target.value))}>
        {policies.policies.map(policy => <option key={policy.id} value={policy.id}>{policy.name}</option>)}
      </select></label>
      <button type="button" disabled={pawn.dead || policies.policies.length >= FOOD_POLICY_LIMIT} title={policies.policies.length >= FOOD_POLICY_LIMIT ? `最多保留 ${FOOD_POLICY_LIMIT} 份饮食政策` : undefined} onClick={() => {
        setEditingId(policies.nextId);
        command({ type: 'foodPolicyCreate', ...(editing ? { sourceId: editing.id } : {}) });
      }}>{editing ? '克隆为新饮食政策' : '新建饮食政策'}</button>
      {editing && <FoodPolicyEditor key={JSON.stringify(editing)} policy={editing} users={users} canDelete={policies.policies.length > 1 && users.length === 0} disabled={pawn.dead} command={command} />}
    </details>
  </section>;
}
