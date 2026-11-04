import { furnitureStats, type FurnitureKind } from './furniture';
import { furnitureMarketValue } from './wealth';
import type { ApparelQuality, Axis, Pawn, Pos, VoxelSnapshot, VoxelCommand } from './types';

type Furniture = { id: number; quality: ApparelQuality; hitPoints?: number };
export const FURNITURE_NAMES: Record<FurnitureKind, string> = { bed: '木床', table: '木制餐桌', chair: '木制餐椅' };
const NAMES = FURNITURE_NAMES;
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;

export function FurnitureDetails({ kind, item, snapshot, packed = false }: {
  kind: FurnitureKind; item: Furniture; snapshot: VoxelSnapshot; packed?: boolean;
}) {
  const stats = furnitureStats(kind, item.quality);
  const damage = snapshot.fireDamage.find(d => d.kind === kind && d.targetId === item.id);
  const hp = item.hitPoints ?? damage?.hitPoints ?? stats.maxHitPoints;
  const value = furnitureMarketValue(kind, item.quality, hp / stats.maxHitPoints);
  return <section className="voxel-furniture-quality" data-testid="furniture-quality" data-kind={kind} data-furniture-id={item.id} data-quality={item.quality}>
    <div className="voxel-info-row"><b>{NAMES[kind]}{packed ? '（已打包）' : ''}</b><strong data-testid="furniture-quality-name">{stats.qualityName}</strong></div>
    <dl>
      <div><dt>耐久</dt><dd data-testid="furniture-hit-points" data-current={hp} data-max={stats.maxHitPoints}>{number(hp)} / {number(stats.maxHitPoints)}</dd></div>
      <div><dt>美观</dt><dd data-testid="furniture-beauty" data-value={stats.beauty}>{number(stats.beauty)}</dd></div>
      {stats.comfort !== null && <div><dt>额定舒适度</dt><dd data-testid="furniture-comfort" data-value={stats.comfort}>{number(stats.comfort)}%</dd></div>}
      {stats.restEffectiveness !== null && <div><dt>睡眠恢复</dt><dd data-testid="furniture-rest" data-value={stats.restEffectiveness}>{number(stats.restEffectiveness * 100)}%</dd></div>}
      <div><dt>当前市值</dt><dd data-testid="furniture-value" data-value={value}>{number(value)} 银</dd></div>
    </dl>
    <small>{kind === 'table' ? '餐桌的美观会影响所在房间。' : '实际使用时，舒适度会逐渐向家具提供的水平恢复；舒适需求最高100%。'}{kind === 'bed' ? '睡眠恢复越高，同样时间内恢复的精力越多。' : ''}</small>
    <small>{packed ? '打包状态下按物品计入财富；安装后才提供家具效果。' : '损伤影响当前市值；营地建筑财富按完好状态计算。'}</small>
    <details><summary>品质与搬装</summary><small>完工者的建造水平越高，越容易做出高品质家具；品质在建造完工时确定。卸下、搬运和重新安装保留同一件家具的品质与耐久，不会重新抽取品质。</small></details>
  </section>;
}

export function FurnitureMoveControls({ kind, item, snapshot, packed = false, begin, command, focus }: {
  kind: FurnitureKind; item: Furniture & { axis: Axis }; snapshot: VoxelSnapshot; packed?: boolean;
  begin: (kind: FurnitureKind, item: Furniture & { axis: Axis }, packed: boolean) => void;
  command: (command: VoxelCommand) => void; focus: (p: Pos) => void;
}) {
  const jobs = snapshot.jobs.filter(j => !j.cancelled && j.furnitureId === item.id);
  const uninstall = jobs.find(j => j.kind === 'uninstall'), install = jobs.find(j => j.kind === 'install');
  const carrier = snapshot.pawns.find(p => p.cargo?.furniture?.id === item.id);
  return <section className="voxel-furniture-move" data-testid="furniture-move" data-furniture-id={item.id} data-packed={packed}>
    <b>{packed ? '安装打包家具' : '搬移与卸下'}</b>
    <small>家具 #{item.id} · 保留品质与耐久。{kind === 'bed' ? '卸下时释放当前使用者，并清除医疗和囚犯用途；安装后可重新设置。' : ''}</small>
    <div className="voxel-furniture-actions">
      <button data-testid="furniture-move-target" disabled={!!install} onClick={() => begin(kind, item, packed)}>{packed ? '安装' : '搬移'}</button>
      {!packed && <button data-testid="furniture-uninstall" disabled={jobs.length > 0} onClick={() => command({ type: 'uninstallFurniture', kind, furnitureId: item.id })}>卸下</button>}
    </div>
    {jobs.length > 0 && <div data-testid="furniture-move-status" data-furniture-id={item.id}>
      <b>{uninstall ? '卸下阶段' : carrier ? `搬运阶段 · ${carrier.name}` : install?.progress ? '安装阶段' : '等待搬运与安装'}</b>
      {jobs.map(j => <div key={j.id} className="voxel-furniture-stage" data-stage={j.kind}>
        <span>{j.kind === 'uninstall' ? '卸下' : '安装'} · {Math.min(100, Math.floor(j.progress / j.work * 100))}%</span>
        <small>{j.reason || '等待可用工人'}</small>
        <button onClick={() => focus(j)}>查看{j.kind === 'uninstall' ? '原位置' : '安装位置'}（{j.x}, {j.y}, {j.z}层）</button>
      </div>)}
      <button data-testid="furniture-move-cancel" onClick={() => command({ type: 'cancelFurnitureMove', furnitureId: item.id })}>取消搬装任务</button>
    </div>}
  </section>;
}

export function CurrentFurniture({ pawn, snapshot, focus }: {
  pawn: Pawn; snapshot: VoxelSnapshot; focus: (p: Pos) => void;
}) {
  if (pawn.dead || pawn.carriedBy !== null) return null;
  const bed = pawn.sleepBedId !== null && (pawn.phase === 'rest' || pawn.downed ||
    (pawn.faction === 'prisoner' && pawn.sleepingSince !== null))
    ? snapshot.beds.find(b => b.id === pawn.sleepBedId && same(b, pawn)) : undefined;
  const meal = pawn.phase === 'dine' && pawn.living.mealTask?.stage === 'chew' && !pawn.path.length
    && same(pawn, pawn.living.mealTask.target) ? pawn.living.mealTask : null;
  const leisure = pawn.phase === 'recreation' && pawn.psyche.recreation?.kind === 'social' && !pawn.path.length
    && same(pawn, pawn.psyche.recreation.target) ? pawn.psyche.recreation : null;
  const chair = meal?.chairId != null ? snapshot.chairs.find(c => c.id === meal.chairId && same(c, pawn))
    : leisure ? snapshot.chairs.find(c => same(c, pawn)) : undefined;
  const tableId = meal?.tableId ?? leisure?.spotId;
  const table = tableId != null ? snapshot.tables.find(t => t.id === tableId) : undefined;
  const item = bed ?? chair ?? table;
  if (!item) return null;
  const kind: FurnitureKind = bed ? 'bed' : chair ? 'chair' : 'table';
  const stats = furnitureStats(kind, item.quality);
  return <section className="voxel-current-furniture" data-testid="current-furniture" data-pawn-id={pawn.id} data-furniture-id={item.id} data-kind={kind} data-quality={item.quality}>
    <b>{bed ? pawn.downed ? '当前床位' : '正在床上睡觉' : meal ? '正在用餐' : '正在桌边休闲'} · {NAMES[kind]}（{stats.qualityName}）</b>
    {stats.comfort !== null && <small>当前舒适 {number(pawn.living.comfort)}% · 家具额定舒适 {number(stats.comfort)}%（需求最高100%）</small>}
    {stats.restEffectiveness !== null && <small>这张床的睡眠恢复为 {number(stats.restEffectiveness * 100)}%。</small>}
    <button onClick={() => focus(item)}>查看当前{bed ? '床' : chair ? '餐椅' : '餐桌'}品质</button>
    {table && chair && <button onClick={() => focus(table)}>查看餐桌品质（{furnitureStats('table', table.quality).qualityName}）</button>}
  </section>;
}
