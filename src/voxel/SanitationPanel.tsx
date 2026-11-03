import { useState } from 'react';
import { at, type Pawn, type Pos, type VoxelCommand, type VoxelSnapshot } from './types';
import { FILTH_NAMES, SANITATION_RULES } from './sanitation';
import { healthSummary } from './survival';

type Command = (command: VoxelCommand) => void;
function RainWashStatus({ snapshot, id }: { snapshot: VoxelSnapshot; id: number }) {
  const condition = snapshot.environment.filth.find(f => f.id === id);
  if (!condition) return null;
  return <small data-testid="rain-wash-status" data-filth-id={id} data-washing={condition.washing} data-exposed={condition.exposed}>
    {condition.washing ? '雨水正在冲洗，污物会逐渐减少。' : !condition.rainWashes ? '这类污物不会被雨水冲走。'
      : !condition.exposed ? '上方有屋顶，雨水不能冲洗此处。' : '当前没有有效的雨水冲洗，仍可安排清扫。'}
  </small>;
}
const amount = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const available = (p: Pawn, tick: number) => p.faction === 'colony' && !p.dead && !p.downed && !p.drafted &&
  p.carriedBy === null && p.carryingPawnId === null && p.psyche.breakUntil <= tick &&
  healthSummary(p).moving > .15 && healthSummary(p).manipulation > 0;

export function CleaningStatus({ pawn, snapshot, command }: { pawn: Pawn; snapshot: VoxelSnapshot; command: Command }) {
  const task = pawn.cleanTask, filth = snapshot.filth.find(f => f.id === task?.filthId);
  if (!task || !filth) return null;
  const reached = at(pawn) === at(filth) && !pawn.path.length;
  return <section className="voxel-cleaning-status" data-testid="cleaning-status" data-filth-id={filth.id}>
    <b>{reached ? '正在清扫' : '前往清扫'} · {FILTH_NAMES[filth.kind]}</b>
    <small>位置 {filth.x}, {filth.y} · Z {filth.z} · 剩余 {amount(filth.amount)} 层</small>
    <progress aria-label="本层清扫进度" value={task.progress} max={SANITATION_RULES.cleanWork} />
    <small>到达污物所在格后才开始清扫；清完一层会继续处理剩余污物。</small>
    <button onClick={() => command({ type: 'cancelClean', pawnId: pawn.id })}>取消本次清扫</button>
    <small>取消后，开启清洁分工的殖民者仍可能自动安排下一项清扫。</small>
  </section>;
}

export function SanitationDetails({ snapshot: s, pos, roomId, preferredPawnId, command }: {
  snapshot: VoxelSnapshot; pos: Pos; roomId?: number; preferredPawnId: number | null; command: Command;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const filth = s.filth.filter(f => at(f) === at(pos)), home = s.homeArea.includes(at(pos));
  const room = s.roomCleanliness.find(r => r.roomId === roomId);
  const cleaners = s.pawns.filter(p => available(p, s.tick));
  const cleaner = cleaners.find(p => p.id === chosen) ?? cleaners.find(p => p.id === preferredPawnId) ?? cleaners[0];
  return <details className="voxel-sanitation-detail" data-testid="sanitation-detail" open={filth.length > 0}>
    <summary>卫生与清洁 · {home ? '家园范围内' : '家园范围外'}</summary>
    {room && <div className="voxel-room-cleanliness" data-testid="room-cleanliness" data-room-id={room.roomId} data-value={room.cleanliness}>
      <div className="voxel-info-row"><span>房间洁净度</span><b>{room.cleanliness.toFixed(2)}</b></div>
      <small>{room.floorCells} 格地面 · 污物总量 {amount(room.filthAmount)}。数值越低越脏，干净铺装地面为 0。</small>
      <small>清扫移除污物；天然地面本身的洁净度不会因此变成铺装地面。</small>
    </div>}
    {!filth.length ? <small>当前格没有可清扫的污物。</small> : <>
      <label>安排清扫<select aria-label="清扫执行者" value={cleaner?.id ?? ''} disabled={!cleaners.length} onChange={e => setChosen(Number(e.target.value))}>
        {!cleaners.length && <option value="">暂无可行动的殖民者</option>}
        {cleaners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      {filth.map(f => {
        const worker = s.pawns.find(p => p.cleanTask?.filthId === f.id);
        return <div key={f.id} className="voxel-filth-row" data-filth-id={f.id}>
          <div className="voxel-info-row"><b>{FILTH_NAMES[f.kind]}</b><span>{amount(f.amount)} 层</span></div>
          <RainWashStatus snapshot={s} id={f.id} />
          {worker ? <small>{worker.name} · {worker.reason}</small> : <small>{home ? '开启清洁分工后自动安排，也可优先清扫。' : '需要先把这格加入家园范围。'}</small>}
          <button aria-label={`清扫${FILTH_NAMES[f.kind]} #${f.id}`} disabled={!cleaner || !home || !!worker}
            onClick={() => cleaner && command({ type: 'clean', pawnId: cleaner.id, filthId: f.id })}>{worker ? '已安排清扫' : '优先清扫这处污物'}</button>
        </div>;
      })}
    </>}
    <button onClick={() => command({ type: 'homeArea', from: pos, to: pos, enabled: !home })}>
      {home ? '将此格移出家园范围' : '将此格加入家园范围'}
    </button>
    <small>清扫只在家园范围内进行，并需要可达通路。自动清扫需开启清洁分工；停用分工时仍可优先清扫。饥饿、疲劳和伤病可能打断工作。</small>
  </details>;
}

export function SanitationPanel({ snapshot: s, selectedPos, focus, selectPawn, command, close }: {
  snapshot: VoxelSnapshot; selectedPos: Pos | null; focus: (pos: Pos) => void; selectPawn: (pawn: Pawn) => void;
  command: Command; close: () => void;
}) {
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const home = new Set(s.homeArea), inside = s.filth.filter(f => home.has(at(f)));
  const from = anchor ?? selectedPos, validArea = !!from && !!selectedPos && from.z === selectedPos.z;
  const areaCount = validArea ? (Math.abs(from!.x - selectedPos!.x) + 1) * (Math.abs(from!.y - selectedPos!.y) + 1) : 0;
  const visibleFilth = [...s.filth].sort((a, b) => Number(home.has(at(b))) - Number(home.has(at(a))) || b.amount - a.amount || a.id - b.id).slice(0, 30);
  const patients = s.pawns.filter(p => p.foodPoisoning && !p.dead);
  return <aside className="voxel-sanitation-drawer" aria-label="卫生与清洁" data-testid="sanitation-panel">
    <div className="voxel-sanitation-heading"><h2>卫生与清洁</h2><button aria-label="关闭卫生面板" onClick={close}>×</button></div>
    <p>{inside.length} 处家园污物 · {s.filth.length - inside.length} 处范围外污物 · {patients.length} 人食物中毒</p>
    {s.environment.filth.some(f => f.washing) && <p data-testid="rain-washing-summary">{s.environment.filth.filter(f => f.washing).length} 处露天污物正在被雨水冲洗；屋顶下仍需清扫。</p>}
    <div className="voxel-sanitation-guide">
      <b>先控制厨房环境，再安排清洁</b>
      <p>把厨房和经常活动的地面划入家园范围，开启殖民者的清洁分工。泥土、血迹、屠宰残渣和呕吐物会降低洁净度。</p>
      <small>清扫者会实际走到污物处逐层处理。清洁地面与厨师水平影响后续烹饪风险；清扫不会改变已经做好的餐食。</small>
    </div>
    <details className="voxel-sanitation-home" open><summary>清洁范围 · {s.homeArea.length} 格家园</summary>
      <small>使用查看工具选择地图。可先设矩形起点，再在同层选择终点；未设起点时只改当前格。</small>
      <div><button disabled={!selectedPos} onClick={() => setAnchor(selectedPos && { ...selectedPos })}>设为清洁范围起点</button><button disabled={!anchor} onClick={() => setAnchor(null)}>清除清洁范围起点</button></div>
      <small>{anchor ? `起点 ${anchor.x}, ${anchor.y} · Z ${anchor.z}` : '尚未设置起点。'}</small>
      {selectedPos && <small>选中 {selectedPos.x}, {selectedPos.y} · Z {selectedPos.z}{validArea ? ` · ${areaCount} 格` : ' · 请在起点同层选择终点'}</small>}
      <div><button disabled={!validArea} onClick={() => from && selectedPos && command({ type: 'homeArea', from, to: selectedPos, enabled: true })}>加入清洁家园范围</button>
        <button disabled={!validArea} onClick={() => from && selectedPos && command({ type: 'homeArea', from, to: selectedPos, enabled: false })}>移出清洁家园范围</button></div>
      <small>这里修改的就是家园范围，也用于灭火、修理和家园内落地物资的贸易资格。</small>
    </details>
    <details className="voxel-sanitation-workers"><summary>清洁分工</summary>
      {s.pawns.filter(p => p.faction === 'colony' && !p.dead).map(p => <div key={p.id}>
        <button onClick={() => selectPawn(p)}>{p.name}</button>
        <label>清洁优先级<select aria-label={`${p.name} 卫生面板清洁优先级`} value={p.priorities.clean}
          onChange={e => command({ type: 'priority', pawnId: p.id, work: 'clean', value: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 0 ? '停用' : n}</option>)}
        </select></label>
        <small>{p.cleanTask ? p.reason : p.drafted ? '解除征召后才能清扫。' : p.downed ? '倒地，无法清扫。' : p.priorities.clean === 0 ? '已停用自动清扫。' : '按分工、作息与身体状态安排清扫。'}</small>
      </div>)}
    </details>
    <section className="voxel-sanitation-list" aria-label="污物名单">
      <h3>地面污物</h3>
      {!visibleFilth.length && <p>目前没有可见污物。</p>}
      {visibleFilth.map(f => <div key={f.id} data-sanitation-filth={f.id}>
        <div className="voxel-info-row"><b>{FILTH_NAMES[f.kind]} · {amount(f.amount)} 层</b><span>{home.has(at(f)) ? '家园内' : '家园外'}</span></div>
        <small>{f.x}, {f.y} · Z {f.z}</small>
        <RainWashStatus snapshot={s} id={f.id} />
        <button aria-label={`查看${FILTH_NAMES[f.kind]} #${f.id}`} onClick={() => focus(f)}>查看与安排清扫</button>
      </div>)}
      {s.filth.length > visibleFilth.length && <small>这里列出家园内优先的前 30 处污物；地图上的其余污物也可点选。</small>}
    </section>
    {patients.length > 0 && <section className="voxel-sanitation-list"><h3>食物中毒者</h3>
      {patients.map(p => <button key={p.id} onClick={() => selectPawn(p)}>{p.name} · 查看健康与恢复</button>)}
    </section>}
  </aside>;
}
