import { useState } from 'react';
import { at, DAY, type Pawn, type Pos, type VoxelCommand, type VoxelSnapshot } from './types';
import { FIRE_RULES, FIRE_TARGET_NAMES, fireDamageCells, fireDamageHomeCells, fireDamageBurning, type FireDamage } from './fire';
import { healthSummary } from './survival';

type Command = (command: VoxelCommand) => void;
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const touch = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) <= 1;
const available = (p: Pawn, tick: number) => p.faction === 'colony' && !p.dead && !p.downed && !p.drafted &&
  p.carriedBy === null && p.carryingPawnId === null && p.psyche.breakUntil <= tick &&
  healthSummary(p).moving > 0 && healthSummary(p).manipulation > 0;
const sourceNames = { lightning: '雷击', shortCircuit: '电气起火', spread: '蔓延' } as const;

export function FireWorkStatus({ pawn, snapshot: s, command }: { pawn: Pawn; snapshot: VoxelSnapshot; command: Command }) {
  const fire = s.fires.find(f => f.id === pawn.firefightTask?.fireId);
  const damage = s.fireDamage.find(d => d.key === pawn.repairTask?.damageKey);
  if (pawn.firefightTask && fire) {
    const working = !pawn.path.length && touch(pawn, fire);
    return <section className="voxel-fire-work" data-testid="firefight-status" data-fire-id={fire.id}>
      <b>{working ? '正在拍打灭火' : '前往灭火'} · 火势 {number(fire.size)}</b>
      <small>火点 {fire.x}, {fire.y} · Z {fire.z}。到达可接触火焰的位置后才开始拍打。</small>
      <progress aria-label="本次灭火拍打进度" value={pawn.firefightTask.progress} max={FIRE_RULES.beatWork} />
      <small>每次拍打完成后削弱实际火势；火仍可能继续增长或蔓延。</small>
      <button onClick={() => command({ type: 'cancelFirefight', pawnId: pawn.id })}>取消本次灭火</button>
      <small>开启灭火分工时，取消后仍可能自动安排下一处火点。</small>
    </section>;
  }
  if (pawn.repairTask && damage) {
    const working = !pawn.path.length && fireDamageCells(damage, s).some(cell => touch(pawn, cell));
    return <section className="voxel-fire-work" data-testid="repair-status" data-damage-key={damage.key}>
      <b>{working ? '正在修理' : '前往修理'} · {FIRE_TARGET_NAMES[damage.kind]}</b>
      <small>耐久 {number(damage.hitPoints)} / {number(damage.maxHitPoints)} · {damage.x}, {damage.y} · Z {damage.z}</small>
      <progress aria-label="本点耐久修理进度" value={pawn.repairTask.progress} max={FIRE_RULES.repairPointWork} />
      <small>到场后逐点恢复耐久，不消耗建材；着火时先灭火，已烧毁的结构需要重建。</small>
      <button onClick={() => command({ type: 'cancelRepair', pawnId: pawn.id })}>取消本次修理</button>
      <small>开启施工分工时，取消后仍可能自动安排修理。</small>
    </section>;
  }
  return null;
}

export function FireDetails({ snapshot: s, pos, preferredPawnId, temperature, command }: {
  snapshot: VoxelSnapshot; pos: Pos; preferredPawnId: number | null; temperature: number; command: Command;
}) {
  const [chosen, setChosen] = useState<number | null>(null), fires = s.fires.filter(f => at(f) === at(pos));
  const home = s.homeArea.includes(at(pos)), workers = s.pawns.filter(p => available(p, s.tick));
  const worker = workers.find(p => p.id === chosen) ?? workers.find(p => p.id === preferredPawnId) ?? workers[0];
  if (!fires.length) return null;
  return <section className="voxel-fire-detail" data-testid="fire-detail">
    <div className="voxel-info-row"><b>正在燃烧</b><span>{home ? '家园范围内' : '家园范围外'}</span></div>
    <small>当前环境 {temperature.toFixed(1)}°C。火焰会影响实际物资、结构和房间温度。</small>
    <label>灭火执行者<select aria-label="灭火执行者" value={worker?.id ?? ''} disabled={!workers.length} onChange={e => setChosen(Number(e.target.value))}>
      {!workers.length && <option value="">暂无可行动的殖民者</option>}
      {workers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    {fires.map(f => {
      const assigned = s.pawns.find(p => p.firefightTask?.fireId === f.id);
      return <div key={f.id} data-fire-id={f.id}>
        <div className="voxel-info-row"><b>火势 {number(f.size)}</b><span>{sourceNames[f.source]}</span></div>
        <progress aria-label={`火点 #${f.id} 火势`} value={f.size} max={FIRE_RULES.maxSize} />
        <small>{assigned ? `${assigned.name} · ${assigned.reason}` : home ? '可开启灭火分工，也可优先处理。' : '先将火点所在格加入家园范围。'}</small>
        <button aria-label={`优先灭火 #${f.id}`} disabled={!worker || !home || !!assigned}
          onClick={() => worker && command({ type: 'firefight', pawnId: worker.id, fireId: f.id })}>{assigned ? '已安排灭火' : '优先扑灭这处火焰'}</button>
      </div>;
    })}
    {!home && <button onClick={() => command({ type: 'homeArea', from: pos, to: pos, enabled: true })}>将火点加入家园范围</button>}
    <small>自动灭火需开启灭火分工；停用分工时仍可手动安排。两者都需要家园内的火点和可达灭火位置。</small>
  </section>;
}

export function FireDamageDetails({ snapshot: s, pos, preferredPawnId, command }: {
  snapshot: VoxelSnapshot; pos: Pos; preferredPawnId: number | null; command: Command;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const targets = s.fireDamage.filter(d => fireDamageHomeCells(d, s).some(cell => at(cell) === at(pos)));
  const workers = s.pawns.filter(p => available(p, s.tick)), home = new Set(s.homeArea);
  const worker = workers.find(p => p.id === chosen) ?? workers.find(p => p.id === preferredPawnId) ?? workers[0];
  if (!targets.length) return null;
  return <section className="voxel-fire-damage" data-testid="fire-damage-detail">
    <b>受损结构</b>
    <label>修理执行者<select aria-label="修理执行者" value={worker?.id ?? ''} disabled={!workers.length} onChange={e => setChosen(Number(e.target.value))}>
      {!workers.length && <option value="">暂无可行动的殖民者</option>}
      {workers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    {targets.map(d => {
      const inside = fireDamageHomeCells(d, s).some(cell => home.has(at(cell)));
      const burning = fireDamageBurning(d, s.fires, s), assigned = s.pawns.find(p => p.repairTask?.damageKey === d.key);
      return <div key={d.key} data-damage-key={d.key} data-hit-points={d.hitPoints}>
        <div className="voxel-info-row"><b>{FIRE_TARGET_NAMES[d.kind]}</b><span>{number(d.hitPoints)} / {number(d.maxHitPoints)}</span></div>
        <small>{d.x}, {d.y} · Z {d.z}{d.kind === 'block' && d.z < pos.z ? ' · 脚下结构' : ''}</small>
        <progress aria-label={`结构 ${d.key} 耐久`} value={d.hitPoints} max={d.maxHitPoints} />
        <small>{burning ? '仍在燃烧，先扑灭火焰。' : !inside ? '需要先将结构所在格或木结构上方活动格加入家园。' : assigned ? `${assigned.name} · ${assigned.reason}` : '可开启施工分工自动修理，也可手动优先处理。'}</small>
        <button aria-label={`优先修理 ${d.key}`} disabled={!worker || !inside || burning || !!assigned || d.hitPoints >= d.maxHitPoints}
          onClick={() => worker && command({ type: 'repair', pawnId: worker.id, damageKey: d.key })}>{assigned ? '已安排修理' : '优先修理这处结构'}</button>
        {!inside && <button aria-label={`将受损结构加入家园 ${d.key}`} onClick={() => {
          const cell = fireDamageHomeCells(d, s).find(cell => at(cell) === at(pos)) ?? d;
          command({ type: 'homeArea', from: cell, to: cell, enabled: true });
        }}>将此处加入家园范围</button>}
      </div>;
    })}
    <small>修理沿用施工分工，实际到场后恢复耐久，不消耗建材。已烧毁的对象需要重新建造。</small>
  </section>;
}

export function FirePanel({ snapshot: s, selectedPos, focus, selectPawn, command, close }: {
  snapshot: VoxelSnapshot; selectedPos: Pos | null; focus: (pos: Pos) => void; selectPawn: (pawn: Pawn) => void;
  command: Command; close: () => void;
}) {
  const [anchor, setAnchor] = useState<Pos | null>(null), home = new Set(s.homeArea);
  const from = anchor ?? selectedPos, validArea = !!from && !!selectedPos && from.z === selectedPos.z;
  const fires = [...s.fires].sort((a, b) => Number(home.has(at(b))) - Number(home.has(at(a))) || b.size - a.size || a.id - b.id);
  const damaged = [...s.fireDamage].sort((a, b) => a.hitPoints / a.maxHitPoints - b.hitPoints / b.maxHitPoints);
  const inHome = fires.filter(f => home.has(at(f))).length;
  const focusDamage = (d: FireDamage) => focus(d);
  return <aside className="voxel-fire-drawer" aria-label="火灾与修理" data-testid="fire-panel">
    <div className="voxel-fire-heading"><h2>火灾与修理</h2><button aria-label="关闭火灾面板" onClick={close}>×</button></div>
    <p className={fires.length ? 'voxel-fire-warning' : ''}>{fires.length ? `${fires.length} 处正在燃烧 · ${inHome} 处在家园内` : '当前没有火情'} · {damaged.length} 处受损结构</p>
    <div className="voxel-fire-guide">
      <b>先灭火，再修理</b>
      <p>火焰会蔓延、消耗实物并加热环境。将需要保护的火点划入家园，安排能行动的殖民者实际靠近拍打灭火。</p>
      <small>灭火后保留已有损伤；施工分工负责修理仍存在的结构，烧毁的对象需要重建。</small>
      <label><input type="checkbox" aria-label="允许新的火灾事件" checked={s.fireHazards.enabled}
        onChange={e => command({ type: 'fireHazards', enabled: e.target.checked })} />允许新的火灾事件</label>
      <small>关闭后停止新的雷击或电气起火事件，已有火焰仍会燃烧和蔓延。</small>
    </div>
    <details className="voxel-fire-home"><summary>家园范围 · {s.homeArea.length} 格</summary>
      <small>用查看工具选格，可先设矩形起点，再选择同层终点；未设起点时只修改当前格。</small>
      <div><button disabled={!selectedPos} onClick={() => setAnchor(selectedPos && { ...selectedPos })}>设为防火家园起点</button><button disabled={!anchor} onClick={() => setAnchor(null)}>清除防火家园起点</button></div>
      <small>{anchor ? `起点 ${anchor.x}, ${anchor.y} · Z ${anchor.z}` : '尚未设置起点。'}</small>
      {selectedPos && <small>选中 {selectedPos.x}, {selectedPos.y} · Z {selectedPos.z}{validArea ? '' : ' · 请在起点同层选择终点'}</small>}
      <div><button disabled={!validArea} onClick={() => from && selectedPos && command({ type: 'homeArea', from, to: selectedPos, enabled: true })}>加入防火家园范围</button>
        <button disabled={!validArea} onClick={() => from && selectedPos && command({ type: 'homeArea', from, to: selectedPos, enabled: false })}>移出防火家园范围</button></div>
      <small>这是同一个家园范围，也用于清扫、修理和落地物资的贸易资格；划区本身不会阻止燃烧。</small>
    </details>
    <details className="voxel-fire-workers" open><summary>灭火与施工分工</summary>
      {s.pawns.filter(p => p.faction === 'colony' && !p.dead).map(p => <div key={p.id}>
        <button onClick={() => selectPawn(p)}>{p.name}</button>
        <label>灭火<select aria-label={`${p.name} 火灾面板灭火优先级`} value={p.priorities.firefight} onChange={e => command({ type: 'priority', pawnId: p.id, work: 'firefight', value: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 0 ? '停用' : n}</option>)}
        </select></label>
        <label>施工与修理<select aria-label={`${p.name} 火灾面板施工优先级`} value={p.priorities.build} onChange={e => command({ type: 'priority', pawnId: p.id, work: 'build', value: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 0 ? '停用' : n}</option>)}
        </select></label>
        <small>{p.firefightTask || p.repairTask ? p.reason : p.drafted ? '解除征召后才能自动工作。' : p.downed ? '倒地，无法工作。' : '按分工、需要与身体状态安排工作。'}</small>
      </div>)}
    </details>
    <section className="voxel-fire-list" aria-label="火情名单"><h3>当前火点</h3>
      {!fires.length && <p>没有正在燃烧的火点。</p>}
      {fires.slice(0, 30).map(f => <div key={f.id} data-list-fire-id={f.id}>
        <div className="voxel-info-row"><b>火势 {number(f.size)}</b><span>{home.has(at(f)) ? '家园内' : '家园外'}</span></div>
        <small>{sourceNames[f.source]} · {f.x}, {f.y} · Z {f.z}</small>
        <button aria-label={`查看火点 #${f.id}`} onClick={() => focus(f)}>查看与安排灭火</button>
      </div>)}
      {fires.length > 30 && <small>这里列出家园内优先、火势较大的前 30 处；其余火点也可在地图点选。</small>}
    </section>
    <section className="voxel-fire-list" aria-label="受损结构名单"><h3>受损结构</h3>
      {!damaged.length && <p>没有记录中的受损结构；已毁对象不会出现在可修名单中。</p>}
      {damaged.slice(0, 30).map(d => <div key={d.key} data-list-damage-key={d.key}>
        <div className="voxel-info-row"><b>{FIRE_TARGET_NAMES[d.kind]}</b><span>{number(d.hitPoints)} / {number(d.maxHitPoints)}</span></div>
        <small>{d.x}, {d.y} · Z {d.z}{fireDamageBurning(d, s.fires, s) ? ' · 仍在燃烧' : ''}</small>
        <button aria-label={`查看受损结构 ${d.key}`} onClick={() => focusDamage(d)}>查看与安排修理</button>
      </div>)}
      {damaged.length > 30 && <small>这里列出耐久比例最低的前 30 处受损结构。</small>}
    </section>
    <details className="voxel-fire-history"><summary>最近火情记录</summary>
      {!s.fireLog.length && <p>暂无火情记录。</p>}
      {[...s.fireLog].slice(-12).reverse().map((entry, i) => <div key={`${entry.tick}-${i}`}>
        <small>第 {Math.floor(entry.tick / DAY) + 1} 日 · {entry.message}</small>
        <button aria-label={`定位火情记录 ${entry.tick} ${i}`} onClick={() => focus(entry.position)}>定位记录位置</button>
      </div>)}
    </details>
  </aside>;
}
