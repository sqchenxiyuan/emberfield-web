import { useState } from 'react';
import { defaultShelfSettings, isShelfKind, shelfCells, SHELF_DEFS, type Shelf } from './shelves';
import { at, emptyCounts, RESOURCE_NAMES, type FurniturePiece, type Pos, type Resource, type VoxelCommand, type VoxelSnapshot } from './types';

interface ShelfMember extends Shelf {
  stage: 'built' | 'blueprint' | 'packed';
  status: string;
}

/** A packed shelf can be on the ground, in a pawn's hands, or at an installation site. */
function shelfMembers(snapshot: VoxelSnapshot): ShelfMember[] {
  const members = new Map<number, ShelfMember>();
  const packed = (piece: FurniturePiece | undefined, pos: Pos, status: string) => {
    if (piece && isShelfKind(piece.kind) && 'settings' in piece && !members.has(piece.id)) {
      members.set(piece.id, { x: pos.x, y: pos.y, z: pos.z, ...piece, kind: piece.kind, stage: 'packed', status });
    }
  };
  for (const shelf of snapshot.shelves) members.set(shelf.id, { ...shelf, stage: 'built', status: '已建成' });
  for (const job of snapshot.jobs) {
    if (!job.cancelled && isShelfKind(job.kind)) members.set(job.id, {
      id: job.id, x: job.x, y: job.y, z: job.z, kind: job.kind, axis: job.axis ?? 'x',
      settings: job.storageSettings ?? defaultShelfSettings(), stage: 'blueprint', status: '施工蓝图',
    });
  }
  for (const item of snapshot.items) packed(item.furniture, item, '已打包');
  for (const pawn of snapshot.pawns) packed(pawn.cargo?.furniture, pawn, `由 ${pawn.name} 搬运`);
  for (const job of snapshot.jobs) for (const batch of job.deliveredBatches) {
    packed(batch.furniture, job, job.cancelled ? '已打包 · 等待取回' : '已送达安装位置');
  }
  return [...members.values()].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x || a.id - b.id);
}

const memberName = (shelf: ShelfMember) => `${SHELF_DEFS[shelf.kind].name} #${shelf.id} · ${shelf.status}`;
const memberLocation = (shelf: ShelfMember, base: number) => {
  const level = shelf.z === base ? '营地基准层' : shelf.z < base ? `基准层下 ${base - shelf.z}` : `基准层上 +${shelf.z - base}`;
  return `(${shelf.x}, ${shelf.y}) · Z ${shelf.z} · ${level}`;
};

function GroupName({ groupId, name, command }: { groupId: number; name: string; command: (c: VoxelCommand) => void }) {
  const [draft, setDraft] = useState(name);
  return <form className="voxel-storage-group-name" onSubmit={event => {
    event.preventDefault();
    if (draft.trim() && draft.trim() !== name) command({ type: 'shelfGroupRename', groupId, name: draft.trim() });
  }}>
    <label>储存组名称<input aria-label="储存组名称" value={draft} maxLength={40} required
      onChange={event => setDraft(event.target.value)} /></label>
    <button type="submit" data-testid="shelf-group-rename" disabled={!draft.trim() || draft.trim() === name}>保存组名</button>
  </form>;
}

export function ShelfPanel({ shelfId, snapshot, command, focus }: {
  shelfId: number; snapshot: VoxelSnapshot; command: (c: VoxelCommand) => void; focus?: (pos: Pos) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [joinGroupId, setJoinGroupId] = useState('');
  const members = shelfMembers(snapshot);
  const shelf = members.find(member => member.id === shelfId);
  if (!shelf) return null;
  const group = snapshot.storageGroups.find(group => group.memberIds.includes(shelfId));
  const settings = group?.settings ?? shelf.settings;
  const memberIds = new Set(group?.memberIds ?? [shelfId]);
  const candidates = members.filter(member => !memberIds.has(member.id));
  const selectedMembers = candidates.filter(member => selected.includes(member.id));
  const otherGroups = snapshot.storageGroups.filter(other => other.id !== group?.id);
  const joinGroup = otherGroups.find(other => String(other.id) === joinGroupId);
  const joinSource = joinGroup?.memberIds.find(id => members.some(member => member.id === id));
  const cells = new Set(shelfCells(shelf).map(at));
  const capacity = snapshot.storageCapacity.filter(cell => cell.shelfId === shelfId);
  const items = shelf.stage === 'built'
    ? snapshot.items.filter(item => cells.has(at(item))).sort((a, b) => at(a) - at(b) || a.id - b.id)
    : [];
  const set = (priority: number, accepts: Resource[]) => command({ type: 'shelfStorage', shelfId, priority, accepts });
  return <section className="voxel-bill voxel-storage voxel-shelf-storage" data-testid="shelf-storage" data-shelf-id={shelfId}
    data-storage-group-id={group?.id} data-shelf-stage={shelf.stage}>
    <b>{group ? `共享收纳 · ${group.name}` : '整座货架的收纳设置'}</b>
    <small>{memberName(shelf)} · {memberLocation(shelf, snapshot.spawn.z)}</small>
    {shelf.stage === 'built'
      ? <small data-testid="shelf-capacity">已用 {items.length} / {cells.size * 3} 堆位 · 预约 {capacity.reduce((n, cell) => n + cell.reservedSlots, 0)} 堆位</small>
      : <small data-testid="shelf-storage-pending">{shelf.stage === 'blueprint' ? '可提前设置收纳规则；完工后生效。' : '打包期间不提供仓位；重新安装后沿用这些设置。'}</small>}
    <p className="voxel-storage-group-scope" data-testid="shelf-group-scope">{group
      ? `修改以下优先级或筛选，会同步到“${group.name}”的全部 ${group.memberIds.length} 座货架，包括蓝图和打包货架。`
      : '这座货架独立收纳，以下修改只影响它。'}</p>
    <label>优先级 <select aria-label="货架优先级" value={settings.priority} onChange={event => set(Number(event.target.value), settings.accepts)}>
      {['低', '普通', '优先', '最高'].map((name, i) => <option key={i} value={i}>{name}</option>)}
    </select></label>
    <details><summary>接纳物品（{settings.accepts.length} 类）</summary><div className="voxel-storage-filters">
      {(Object.keys(emptyCounts()) as Resource[]).filter(resource => resource !== 'chunk' && resource !== 'furniture').map(resource => <label className="voxel-check" key={resource}>
        <input type="checkbox" checked={settings.accepts.includes(resource)} onChange={event => set(settings.priority,
          event.target.checked ? [...settings.accepts, resource] : settings.accepts.filter(value => value !== resource))} />
        {RESOURCE_NAMES[resource]}{resource === 'carcass' ? '（仅小型）' : ''}
      </label>)}
    </div></details>
    <small>修改筛选后，现有货物会等待搬往其他可用仓位。</small>

    {group && <details className="voxel-storage-group" data-testid="shelf-group" open>
      <summary>储存组：{group.name} · {group.memberIds.length} 座</summary>
      <GroupName key={`${group.id}:${group.name}`} groupId={group.id} name={group.name} command={command} />
      <ul className="voxel-storage-members" aria-label="当前储存组成员">
        {group.memberIds.map(id => {
          const member = members.find(member => member.id === id);
          return <li key={id} data-testid="shelf-group-member" data-shelf-id={id}>
            <span>{member ? memberName(member) : `货架 #${id}`}{id === shelfId ? ' · 当前' : ''}</span>
            {member && <small>{memberLocation(member, snapshot.spawn.z)}</small>}
            {member && focus && id !== shelfId && <button type="button" aria-label={`定位货架 #${id}`} onClick={() => focus(member)}>定位</button>}
          </li>;
        })}
      </ul>
      <button data-testid="shelf-group-unlink" onClick={() => command({ type: 'shelfUnlink', shelfId })}>解除当前货架联动</button>
      <small>解除后保留当前收纳规则，可独立修改。组内不足两座时，其余货架也恢复独立。</small>
    </details>}

    <details className="voxel-storage-group" data-testid="shelf-group-link-options">
      <summary>{group ? '添加其他货架到本组' : '联动其他货架'}</summary>
      <small>选择要联动的货架、施工蓝图或打包货架。它们将采用当前货架的优先级和筛选，并保持同步。</small>
      {candidates.length > 0 ? <>
        <div className="voxel-storage-member-choices" role="group" aria-label="选择联动货架">
          {candidates.map(member => {
            const fromGroup = snapshot.storageGroups.find(group => group.memberIds.includes(member.id));
            return <label key={member.id} className="voxel-check" data-testid="shelf-link-candidate" data-shelf-id={member.id}>
              <input type="checkbox" aria-label={`联动${SHELF_DEFS[member.kind].name} #${member.id}`} checked={selected.includes(member.id)}
                onChange={event => setSelected(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))} />
              <span>{memberName(member)}<small>{memberLocation(member, snapshot.spawn.z)}</small>
                <small>{fromGroup ? `目前属于“${fromGroup.name}”` : '目前独立收纳'}</small></span>
            </label>;
          })}
        </div>
        <small>只转入勾选的货架，它们原组的其他成员不变。</small>
        <button data-testid="shelf-group-link" disabled={selectedMembers.length === 0} onClick={() => {
          command({ type: 'shelfLink', sourceId: shelfId, memberIds: selectedMembers.map(member => member.id) });
          setSelected([]);
        }}>{group ? `将所选 ${selectedMembers.length} 座加入本组` : `联动所选 ${selectedMembers.length} 座货架`}</button>
      </> : <small>当前没有其他可联动的货架。可先规划一座新货架。</small>}
    </details>

    {otherGroups.length > 0 && <details className="voxel-storage-group" data-testid="shelf-group-join-options">
      <summary>将当前货架加入已有组</summary>
      <label>选择储存组<select aria-label="加入储存组" value={joinGroup ? joinGroupId : ''} onChange={event => setJoinGroupId(event.target.value)}>
        <option value="">请选择</option>
        {otherGroups.map(other => <option key={other.id} value={other.id}>{other.name} · {other.memberIds.length} 座</option>)}
      </select></label>
      <small>只转入当前货架，采用所选组的优先级和筛选；当前组的其他成员保持原状。</small>
      <button data-testid="shelf-group-join" disabled={joinSource === undefined} onClick={() => {
        if (joinSource !== undefined) command({ type: 'shelfLink', sourceId: joinSource, memberIds: [shelfId] });
        setJoinGroupId('');
      }}>{joinGroup ? `加入“${joinGroup.name}”` : '加入所选储存组'}</button>
    </details>}
    {items.map(item => <div key={item.id} data-testid="shelf-stack" data-stack-id={item.id}>#{item.id} · {RESOURCE_NAMES[item.resource]} × {item.amount} · ({item.x}, {item.y}, {item.z})</div>)}
  </section>;
}
