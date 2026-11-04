import { useState } from 'react';
import { APPAREL_KINDS, APPAREL_NAMES, QUALITY_NAMES } from './apparel';
import { APPAREL_POLICY_LIMIT, APPAREL_POLICY_NAME_LIMIT, type ApparelPolicy } from './apparelPolicies';
import type { ApparelQuality, Pawn, VoxelCommand } from './types';

type Command = (command: VoxelCommand) => void;
export interface ApparelPolicyPanelProps {
  pawn: Pawn;
  policies: { nextId: number; policies: ApparelPolicy[] };
  pawns: Pawn[];
  command: Command;
}

function PolicyEditor({ policy, users, canDelete, disabled, command }: {
  policy: ApparelPolicy; users: Pawn[]; canDelete: boolean; disabled: boolean; command: Command;
}) {
  const [draft, setDraft] = useState<ApparelPolicy>(() => ({ ...policy, allowedKinds: [...policy.allowedKinds] }));
  const valid = draft.name.trim().length > 0 && draft.name.trim().length <= APPAREL_POLICY_NAME_LIMIT &&
    Number.isInteger(draft.minQuality) && Number.isInteger(draft.maxQuality) &&
    draft.minQuality >= 0 && draft.maxQuality <= 6 && draft.minQuality <= draft.maxQuality &&
    Number.isFinite(draft.minCondition) && Number.isFinite(draft.maxCondition) &&
    draft.minCondition >= 0 && draft.maxCondition <= 1 && draft.minCondition <= draft.maxCondition;
  return <form className="voxel-apparel-policy-editor" data-testid="apparel-policy-editor" onSubmit={(event) => {
    event.preventDefault();
    if (!disabled && valid) command({ type: 'apparelPolicyUpdate', policy: { ...draft, name: draft.name.trim(), allowedKinds: [...draft.allowedKinds] } });
  }}>
    <small>共享政策，保存后影响使用者：{users.length ? users.map(p => `${p.name}${p.dead ? '（已死亡，保留引用）' : ''}`).join('、') : '暂无'}。</small>
    <fieldset disabled={disabled}>
      <legend>政策设置</legend>
      <label>名称<input aria-label="服装政策名称" maxLength={APPAREL_POLICY_NAME_LIMIT} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <div className="voxel-apparel-policy-kinds" role="group" aria-label="允许的服装种类">
        {APPAREL_KINDS.map(kind => <label key={kind}>
          <input type="checkbox" checked={draft.allowedKinds.includes(kind)} onChange={event => setDraft({ ...draft,
            allowedKinds: APPAREL_KINDS.filter(k => k === kind ? event.target.checked : draft.allowedKinds.includes(k)),
          })} />{APPAREL_NAMES[kind]}
        </label>)}
      </div>
      <div className="voxel-apparel-policy-range">
        <label>最低品质<select aria-label="最低服装品质" value={draft.minQuality} onChange={event => setDraft({ ...draft, minQuality: Number(event.target.value) as ApparelQuality })}>
          {QUALITY_NAMES.map((name, value) => <option value={value} key={value}>{name}</option>)}
        </select></label>
        <label>最高品质<select aria-label="最高服装品质" value={draft.maxQuality} onChange={event => setDraft({ ...draft, maxQuality: Number(event.target.value) as ApparelQuality })}>
          {QUALITY_NAMES.map((name, value) => <option value={value} key={value}>{name}</option>)}
        </select></label>
      </div>
      <div className="voxel-apparel-policy-range">
        <label>最低耐久 %<input aria-label="最低服装耐久百分比" type="number" min={0} max={100} step="any" value={Number.isFinite(draft.minCondition) ? Number((draft.minCondition * 100).toFixed(6)) : ''} onChange={event => setDraft({ ...draft, minCondition: event.target.value === '' ? Number.NaN : Number(event.target.value) / 100 })} /></label>
        <label>最高耐久 %<input aria-label="最高服装耐久百分比" type="number" min={0} max={100} step="any" value={Number.isFinite(draft.maxCondition) ? Number((draft.maxCondition * 100).toFixed(6)) : ''} onChange={event => setDraft({ ...draft, maxCondition: event.target.value === '' ? Number.NaN : Number(event.target.value) / 100 })} /></label>
      </div>
      {!valid && <small role="status">请输入名称；品质和耐久下限不能高于上限，耐久范围为 0～100%。</small>}
      {!draft.allowedKinds.length && <small>未允许任何种类；自动换装会脱下未强制保留的衣物。</small>}
      <div className="voxel-apparel-policy-buttons">
        <button type="submit" disabled={disabled || !valid}>保存政策</button>
        <button type="button" disabled={disabled || !canDelete} title={canDelete ? '删除未使用的政策' : '仍有居民使用或只剩最后一份政策，无法删除'} onClick={() => command({ type: 'apparelPolicyDelete', policyId: policy.id })}>删除政策</button>
      </div>
    </fieldset>
  </form>;
}

export function ApparelPolicyPanel({ pawn, policies, pawns, command }: ApparelPolicyPanelProps) {
  const [editingId, setEditingId] = useState<number | null>(() => pawn.apparelControl.policyId ?? policies.policies[0]?.id ?? null);
  if (pawn.faction !== 'colony') return null;
  const editing = policies.policies.find(p => p.id === editingId) ?? policies.policies[0];
  const users = editing ? pawns.filter(p => p.apparelControl.policyId === editing.id) : [];
  return <div className="voxel-apparel-policy-panel" data-testid="apparel-policy-controls">
    <label>穿衣政策<select aria-label={`${pawn.name} 的穿衣政策`} disabled={pawn.dead} value={pawn.apparelControl.policyId ?? ''} onChange={event => {
      const policyId = event.target.value === '' ? null : Number(event.target.value);
      if (policyId !== null) setEditingId(policyId);
      command({ type: 'pawnApparelPolicy', pawnId: pawn.id, policyId });
    }}>
      <option value="">手动管理</option>
      {policies.policies.map(policy => <option key={policy.id} value={policy.id}>{policy.name}</option>)}
    </select></label>
    <small>{pawn.apparelControl.policyId === null ? '手动管理：由你安排穿脱衣物。' : '自动换装：先脱下政策不允许的普通衣物，再从储存区选择合适衣物。'}</small>
    <small>自动选择参考季节冷暖与防护。候选衣物须已入库，允许取用且能够到达；强制穿戴的衣物会保留。</small>
    <details className="voxel-apparel-policy-management">
      <summary>编辑共享政策</summary>
      <label>编辑政策<select aria-label="编辑服装政策" value={editing?.id ?? ''} disabled={pawn.dead || !editing} onChange={event => setEditingId(Number(event.target.value))}>
        {policies.policies.map(policy => <option key={policy.id} value={policy.id}>{policy.name}</option>)}
      </select></label>
      <button type="button" disabled={pawn.dead || policies.policies.length >= APPAREL_POLICY_LIMIT} title={policies.policies.length >= APPAREL_POLICY_LIMIT ? `最多保留 ${APPAREL_POLICY_LIMIT} 份政策` : undefined} onClick={() => {
        setEditingId(policies.nextId);
        command({ type: 'apparelPolicyCreate', ...(editing ? { sourceId: editing.id } : {}) });
      }}>{editing ? '克隆为新政策' : '新建政策'}</button>
      {editing && <PolicyEditor key={JSON.stringify(editing)} policy={editing} users={users} canDelete={policies.policies.length > 1 && users.length === 0} disabled={pawn.dead} command={command} />}
    </details>
  </div>;
}
