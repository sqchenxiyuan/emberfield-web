import { useEffect, useState } from 'react';
import { PEN_RULES } from './pens';
import type { PenCommand, PenControls } from './PenPanel';
import { WIDTH, DEPTH, type Pawn, type Pos, type VoxelSnapshot } from './types';

export function PawnAllowedArea({ pawn, snapshot, command, controls, manage }: {
  pawn: Pawn; snapshot: VoxelSnapshot; command: PenCommand; controls: PenControls; manage?: () => void;
}) {
  if (pawn.faction !== 'colony' || pawn.dead) return null;
  const area = snapshot.animalAreas.find(area => area.id === pawn.allowedAreaId);
  const bypass = pawn.drafted || pawn.psyche.breakUntil > snapshot.tick;
  return <section className="voxel-pawn-area" data-testid="pawn-allowed-area" data-pawn-id={pawn.id} data-area-id={pawn.allowedAreaId ?? ''}>
    <label>允许区域<select aria-label={`${pawn.name} 允许区域`} value={pawn.allowedAreaId ?? ''}
      onChange={event => void command({ type: 'pawnAreaAssign', pawnId: pawn.id, areaId: event.target.value === '' ? null : Number(event.target.value) })}>
      <option value="">不限制</option>
      {snapshot.animalAreas.map(area => <option key={area.id} value={area.id}>{area.name}{area.cells.length ? '' : ' · 空区域，不限制'}</option>)}
    </select></label>
    <small>{bypass ? '征召或精神状态期间忽略区域限制，设置会保留。' : area?.cells.length ? `工作与日常需求在“${area.name}”内选目标；区外会寻找通路返回。` : '当前没有区域限制。空区域也等同于不限制。'}</small>
    <div className="voxel-allowed-area-actions">
      {area && <button onClick={() => controls.showArea(controls.selectedAreaId === area.id ? null : area.id)} aria-pressed={controls.selectedAreaId === area.id}>显示区域</button>}
      {manage && <button onClick={manage}>管理允许区域</button>}
    </div>
  </section>;
}

function AreaName({ id, name, command }: { id: number; name: string; command: PenCommand }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => { const next = draft.trim(); if (next && next !== name) void command({ type: 'allowedAreaRename', areaId: id, name: next }); else setDraft(name); };
  return <label>区域名称<input aria-label={`允许区域名称 ${id}`} maxLength={PEN_RULES.maxNameLength} value={draft}
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur(); }} /></label>;
}

export function AllowedAreaPanel({ snapshot, command, controls, level, focus, close, edit }: {
  snapshot: VoxelSnapshot; command: PenCommand; controls: PenControls; level: number;
  focus: (pos: Pos) => void; close: () => void; edit: (id: number, erase?: boolean) => void;
}) {
  const [name, setName] = useState(''), [creating, setCreating] = useState(false);
  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const result = await command({ type: 'allowedAreaCreate', name: name.trim() || `允许区域 ${snapshot.animalAreas.length + 1}` });
      if (result.ok && result.areaId !== undefined) { setName(''); controls.showArea(result.areaId); }
    } finally { setCreating(false); }
  };
  const cellPosition = (cell: number) => ({ x: cell % WIDTH, y: Math.floor(cell / WIDTH) % DEPTH, z: Math.floor(cell / (WIDTH * DEPTH)) });
  return <aside className="voxel-allowed-area-panel" aria-label="允许区域管理" data-testid="allowed-area-panel">
    <div className="voxel-panel-title"><h2>允许区域</h2><button aria-label="关闭允许区域" onClick={close}>×</button></div>
    <p>为居民安排日常活动与工作目标。区域与兔共享，修改会同时影响所有使用者。</p>
    <details className="voxel-allowed-area-help" open><summary>区域怎样生效</summary>
      <p>把工作目标、所需材料、食物和床都包含在内。区域只筛选目的地，行走路线可能经过区外；它不会形成围墙。</p>
      <p>空区域等同于不限制。征召与精神状态期间忽略限制，区域设置会保留。</p>
      <p>手动装备武器可以越区，完成后会返回。需要直接指挥区外移动时，可先征召居民。</p>
      <p>左键拖动增添或擦除，右键结束。可以切换楼层继续绘制，区域本身不会建造地面，也不会揭开未探索地形。</p>
    </details>
    <form className="voxel-allowed-area-create" onSubmit={event => { event.preventDefault(); void create(); }}>
      <label>新区域名称<input aria-label="新允许区域名称" placeholder="例如：室内安全区" maxLength={PEN_RULES.maxNameLength}
        value={name} onChange={event => setName(event.target.value)} /></label>
      <button disabled={creating || snapshot.animalAreas.length >= PEN_RULES.maxAreas}>创建允许区域</button>
    </form>
    <div className="voxel-allowed-area-list" aria-label="允许区域列表">
      {!snapshot.animalAreas.length && <p>还没有允许区域。先创建，再涂绘并分配给居民。</p>}
      {snapshot.animalAreas.map(area => {
        const layers = [...new Set(area.cells.map(cell => Math.floor(cell / (WIDTH * DEPTH))))].sort((a, b) => a - b);
        const residents = snapshot.pawns.filter(pawn => !pawn.dead && pawn.faction === 'colony' && pawn.allowedAreaId === area.id);
        const animals = snapshot.animals.filter(animal => !animal.dead && animal.allowedAreaId === area.id);
        const target = area.cells.find(cell => Math.floor(cell / (WIDTH * DEPTH)) === level) ?? area.cells[0];
        return <section className="voxel-allowed-area-card" data-testid="allowed-area-row" data-area-id={area.id} key={area.id}>
          <div className="voxel-info-row"><b><i className="voxel-area-swatch" style={{ background: `#${area.color.toString(16).padStart(6, '0')}` }} />{area.name}</b><span>{area.cells.length} 格</span></div>
          <AreaName id={area.id} name={area.name} command={command} />
          <small>{residents.length} 位居民 · {animals.length} 只动物使用{layers.length ? ` · 楼层 Z ${layers.join('、')}` : ' · 空区域，不限制'}</small>
          <div className="voxel-allowed-area-actions">
            <button aria-pressed={controls.selectedAreaId === area.id} onClick={() => controls.showArea(controls.selectedAreaId === area.id ? null : area.id)}>{controls.selectedAreaId === area.id ? '隐藏区域' : '显示区域'}</button>
            <button onClick={() => edit(area.id)}>增添区域</button><button onClick={() => edit(area.id, true)}>擦除区域</button>
            <button disabled={target === undefined} onClick={() => { controls.showArea(area.id); focus(cellPosition(target)); }}>定位区域</button>
            <button onClick={() => void command({ type: 'allowedAreaDelete', areaId: area.id })}>删除区域</button>
          </div>
          <small>删除后，使用此区域的居民与动物恢复不限制。</small>
        </section>;
      })}
    </div>
    <h3>居民分配</h3>
    {snapshot.pawns.filter(pawn => pawn.faction === 'colony' && !pawn.dead).map(pawn => <div key={pawn.id} className="voxel-allowed-area-resident">
      <button onClick={() => focus(pawn)}>{pawn.name}</button>
      <PawnAllowedArea pawn={pawn} snapshot={snapshot} command={command} controls={controls} />
    </div>)}
  </aside>;
}
