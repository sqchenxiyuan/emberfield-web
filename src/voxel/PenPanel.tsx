import { useEffect, useState } from 'react';
import { type CommandResult, type Pos, type Tool, type VoxelCommand, type VoxelSnapshot, type WildAnimal } from './types';
import { PEN_RULES, penAcceptsAnimal, type FenceGate, type PenMarker } from './pens';
import { ANIMAL_HUSBANDRY } from './husbandry';
import { ANIMAL_DEFS } from './wildlife';

export type PenCommand = (command: VoxelCommand) => Promise<CommandResult>;
export interface PenControls {
  selectedPenId: number | null;
  selectedAreaId: number | null;
  editingArea: boolean;
  showPen: (id: number | null) => void;
  showArea: (id: number | null) => void;
  editArea: (id: number, erase?: boolean) => void;
}

function NameField({ value, label, ariaLabel = label, save }: { value: string; label: string; ariaLabel?: string; save: (name: string) => void }) {
  const [name, setName] = useState(value);
  useEffect(() => setName(value), [value]);
  const commit = () => { const trimmed = name.trim(); if (trimmed && trimmed !== value) save(trimmed); else setName(value); };
  return <label>{label}<input aria-label={ariaLabel} maxLength={PEN_RULES.maxNameLength} value={name}
    onChange={e => setName(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); }} /></label>;
}

export function PenDetails({ marker, snapshot: s, command, focus, controls }: {
  marker: PenMarker; snapshot: VoxelSnapshot; command: PenCommand; focus: (pos: Pos) => void; controls: PenControls;
}) {
  const summary = s.penSummaries.find(p => p.markerId === marker.id);
  const visible = controls.selectedPenId === marker.id;
  return <section className="voxel-pen-card" data-testid="pen-detail" data-pen-id={marker.id} data-closed={summary?.closed ?? false}>
    <div className="voxel-info-row"><b>{marker.name}</b><span className={summary?.closed ? '' : 'voxel-pen-warning'}>{summary?.closed ? '已封闭' : '未封闭'}</span></div>
    <NameField key={marker.id} value={marker.name} label="圈地名称" ariaLabel={`圈地名称 ${marker.id}`} save={name => void command({ type: 'penName', markerId: marker.id, name })} />
    <p>{summary?.reason ?? '正在检查圈地边界'}</p>
    {!summary?.closed && <small className="voxel-pen-warning">先修补围栏、关闭保持敞开的栏门，再让饲养员把鹿、单峰驼、羊驼和鸡牵回。单独的标记无法拦住动物。</small>}
    {!!summary?.sharedWith.length && <small>与 {summary.sharedWith.map(id => s.penMarkers.find(m => m.id === id)?.name ?? `标记 ${id}`).join('、')} 共用围栏；以下动物和草料是同一片圈地的统计。</small>}
    <div className="voxel-pen-numbers">
      <span>圈内动物 <b>{summary?.closed ? summary.animalIds.length : '—'}</b></span><span>正在安排牵入 <b>{summary?.pendingAnimalIds.length ?? 0}</b></span>
      <span>现有草料营养 <b>{summary?.closed ? summary.grassNutrition.toFixed(2) : '—'}</b></span>
      <span>圈内日耗营养 <b>{summary?.closed ? summary.nutritionPerDay.toFixed(2) : '—'}</b></span>
    </div>
    <small>草料为当前实际可食用的草，不包含地面谷物和作物，也不保证长期足够。圈地无需屋顶。</small>
    <fieldset><legend>接纳动物</legend>{([['deer', '鹿'], ['dromedary', '单峰驼'], ['alpaca', '羊驼'], ['chicken', '鸡'], ['male', '雄性'], ['female', '雌性']] as const).map(([key, label]) =>
      <label key={key}><input type="checkbox" aria-label={`${marker.name} 接纳${label}`} checked={marker.filter[key]}
        onChange={e => void command({ type: 'penFilter', markerId: marker.id, filter: { ...marker.filter, [key]: e.target.checked } })} />{label}</label>)}</fieldset>
    <div className="voxel-pen-actions"><button aria-pressed={visible} onClick={() => { controls.showPen(visible ? null : marker.id); if (!visible) focus(marker); }}>{visible ? '隐藏圈地范围' : '显示圈地范围'}</button>
      <button onClick={() => focus(marker)}>定位标记</button></div>
  </section>;
}

export function FenceGateDetails({ gate, tick, command }: { gate: FenceGate; tick: number; command: PenCommand }) {
  const open = gate.mode === 'open' || (gate.mode === 'auto' && tick <= gate.openUntil);
  return <section className="voxel-pen-card" data-testid="fence-gate-detail" data-gate-id={gate.id}>
    <b>木制栏门 · {open ? '当前打开' : '当前关闭'}</b>
    <label>栏门状态<select aria-label="栏门状态" value={gate.mode} onChange={e => void command({ type: 'fenceGate', gateId: gate.id, mode: e.target.value as FenceGate['mode'] })}>
      <option value="auto">自动开关</option><option value="open">保持敞开</option><option value="locked">锁定</option>
    </select></label>
    <small>{gate.mode === 'open' ? '保持敞开会打开圈地边界，鹿、单峰驼、羊驼和鸡可能走失。' : gate.mode === 'locked' ? '锁定拦住饲养员和牵引路线，请为牵入留出可用栏门。' : '饲养员经过时临时打开，仍视作封闭边界。自由活动的鹿、单峰驼、羊驼和鸡不能穿过关闭的栏门。'}</small>
  </section>;
}

export function AnimalPenControls({ animal: a, snapshot: s, command, controls }: {
  animal: WildAnimal; snapshot: VoxelSnapshot; command: PenCommand; controls: PenControls;
}) {
  if (a.dead || a.faction !== 'colony') return null;
  const inside = s.penSummaries.filter(p => p.closed && p.animalIds.includes(a.id));
  return <div className="voxel-animal-pen" data-testid="animal-pen-controls" data-animal-id={a.id}>
    {ANIMAL_HUSBANDRY[a.species].penAnimal ? <>
      <small>当前圈地：{inside.map(p => s.penMarkers.find(m => m.id === p.markerId)?.name).filter(Boolean).join(' / ') || '圈外'}{a.ropePaused ? ' · 已暂停牵引' : ''}</small>
      <label>牵引目的地<select aria-label={`${a.name} 牵引目的地`} value={a.requestedPenId ?? ''}
        onChange={e => void command({ type: 'ropeAnimal', animalId: a.id, penId: e.target.value === '' ? null : Number(e.target.value), paused: a.ropePaused })}>
        <option value="">自动选择合适圈地</option>{s.penMarkers.map(m => <option key={m.id} value={m.id}>{m.name}{!penAcceptsAnimal(m, a) ? ' · 筛选不接纳' : !s.penSummaries.find(p => p.markerId === m.id)?.closed ? ' · 未封闭' : ''}</option>)}
      </select></label>
      <div className="voxel-pen-actions"><button aria-label={`${a.ropePaused ? '恢复牵引' : '暂停牵引'} ${a.name}`} aria-pressed={a.ropePaused}
        onClick={() => void command({ type: 'ropeAnimal', animalId: a.id, penId: a.requestedPenId, paused: !a.ropePaused })}>{a.ropePaused ? '恢复牵引' : '暂停牵引'}</button>
        {!!inside.length && <button onClick={() => controls.showPen(inside[0].markerId)}>显示所在圈地</button>}</div>
      {!inside.length && <small>{ANIMAL_DEFS[a.species].name}需要围栏圈养；开启饲养分工并保留栏门。长时间未圈养可能自行走到地图边缘离开。</small>}
    </> : <>
      <label>活动范围<select aria-label={`${a.name} 活动范围`} value={a.allowedAreaId ?? ''}
        onChange={e => void command({ type: 'animalAreaAssign', animalId: a.id, areaId: e.target.value === '' ? null : Number(e.target.value) })}>
        <option value="">不限制</option>{s.animalAreas.map(area => <option key={area.id} value={area.id}>{area.name}{area.cells.length ? '' : ' · 空区域，不限制'}</option>)}
      </select></label>
      {a.allowedAreaId !== null && <div className="voxel-pen-actions"><button onClick={() => controls.showArea(a.allowedAreaId)}>显示活动范围</button><button onClick={() => controls.editArea(a.allowedAreaId!)}>涂绘范围</button></div>}
      <small>兔可越过围栏。允许区域与居民共享，用来寻找食物和休息，范围外的兔会步行返回；路径可能途经区外，逃避威胁时可离开范围。空区域不限制。</small>
    </>}
  </div>;
}

export function PenPanel({ snapshot: s, command, choose, focus, controls }: {
  snapshot: VoxelSnapshot; command: PenCommand; choose: (tool: Tool) => void; focus: (pos: Pos) => void; controls: PenControls;
}) {
  const [name, setName] = useState(''), [creating, setCreating] = useState(false);
  const create = async () => {
    if (creating) return;
    setCreating(true);
    try { const result = await command({ type: 'allowedAreaCreate', name: name.trim() || `允许区域 ${s.animalAreas.length + 1}` });
      if (result.ok && result.areaId !== undefined) { setName(''); controls.editArea(result.areaId); }
    } finally { setCreating(false); }
  };
  return <div className="voxel-pen-panel" data-testid="pen-panel">
    <p>围栏拦住鹿、单峰驼、羊驼和鸡；活动范围引导兔。每只动物都按实际通路移动。</p>
    <details className="voxel-wildlife-guide" open><summary>建造一处圈地</summary>
      <ol><li>拖动围栏画直线，围成闭合边界，给栏门留一格。</li><li>放置栏门，再在里面建造圈地标记。</li><li>确认显示“已封闭”，设置接纳种类和性别；饲养员会实际套绳并牵入。</li></ol>
      <div><button onClick={() => choose('fence')}>建造围栏</button><button onClick={() => choose('fenceGate')}>建造栏门</button><button onClick={() => choose('penMarker')}>建造圈地标记</button></div>
      <small>人和兔可缓慢跨越围栏，鹿、单峰驼、羊驼和鸡需要栏门。蓝图完成前不形成边界；栏门设为保持敞开会使圈地失效。</small>
    </details>
    <h3>圈地 · {s.penMarkers.length}</h3>
    {!s.penMarkers.length && <p>尚无圈地标记。先完成围栏和栏门，再在内部放置标记。</p>}
    {s.penMarkers.map(marker => <PenDetails key={marker.id} marker={marker} snapshot={s} command={command} focus={focus} controls={controls} />)}
    <h3>共享允许区域 · {s.animalAreas.length}</h3>
    <form className="voxel-pen-create" onSubmit={e => { e.preventDefault(); void create(); }}>
      <input aria-label="新活动范围名称" placeholder="新活动范围名称" maxLength={PEN_RULES.maxNameLength} value={name} onChange={e => setName(e.target.value)} />
      <button type="submit" disabled={creating || s.animalAreas.length >= PEN_RULES.maxAreas}>创建并涂绘</button>
    </form>
    <small>居民与兔使用同一份区域。左键拖动涂绘当前楼层，右键结束；请包含食物与可达位置。空区域等于不限制，修改会影响所有使用者。</small>
    {s.animalAreas.map(area => <section className="voxel-pen-card" key={area.id} data-area-id={area.id}>
      <div className="voxel-info-row"><b><i className="voxel-area-swatch" style={{ background: `#${area.color.toString(16).padStart(6, '0')}` }} />{area.name}</b><span>{area.cells.length} 格</span></div>
      <NameField value={area.name} label="活动范围名称" ariaLabel={`活动范围名称 ${area.id}`} save={name => void command({ type: 'allowedAreaRename', areaId: area.id, name })} />
      <small>{s.pawns.filter(p => !p.dead && p.faction === 'colony' && p.allowedAreaId === area.id).length} 位居民 · {s.animals.filter(a => !a.dead && a.allowedAreaId === area.id).length} 只兔使用{area.cells.length ? '' : ' · 空区域，不限制'}</small>
      <div className="voxel-pen-actions"><button aria-pressed={controls.selectedAreaId === area.id} onClick={() => controls.showArea(controls.selectedAreaId === area.id ? null : area.id)}>显示范围</button>
        <button onClick={() => controls.editArea(area.id)}>涂绘</button><button onClick={() => controls.editArea(area.id, true)}>擦除</button>
        <button onClick={() => void command({ type: 'allowedAreaDelete', areaId: area.id })}>删除范围</button></div>
    </section>)}
    {controls.editingArea && <button onClick={() => choose('inspect')}>结束涂绘</button>}
  </div>;
}
