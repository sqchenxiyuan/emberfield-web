import { furnitureStats, type FurnitureKind } from './furniture';
import { furnitureMarketValue } from './wealth';
import type { ApparelQuality, Pawn, Pos, VoxelSnapshot } from './types';

type Furniture = Pos & { id: number; quality: ApparelQuality };
const NAMES: Record<FurnitureKind, string> = { bed: '木床', table: '木制餐桌', chair: '木制餐椅' };
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;

export function FurnitureDetails({ kind, item, snapshot }: {
  kind: FurnitureKind; item: Furniture; snapshot: VoxelSnapshot;
}) {
  const stats = furnitureStats(kind, item.quality);
  const damage = snapshot.fireDamage.find(d => d.kind === kind && d.targetId === item.id);
  const hp = damage?.hitPoints ?? stats.maxHitPoints;
  const value = furnitureMarketValue(kind, item.quality, hp / stats.maxHitPoints);
  return <section className="voxel-furniture-quality" data-testid="furniture-quality" data-kind={kind} data-furniture-id={item.id} data-quality={item.quality}>
    <div className="voxel-info-row"><b>{NAMES[kind]}</b><strong data-testid="furniture-quality-name">{stats.qualityName}</strong></div>
    <dl>
      <div><dt>耐久</dt><dd data-testid="furniture-hit-points" data-current={hp} data-max={stats.maxHitPoints}>{number(hp)} / {number(stats.maxHitPoints)}</dd></div>
      <div><dt>美观</dt><dd data-testid="furniture-beauty" data-value={stats.beauty}>{number(stats.beauty)}</dd></div>
      {stats.comfort !== null && <div><dt>额定舒适度</dt><dd data-testid="furniture-comfort" data-value={stats.comfort}>{number(stats.comfort)}%</dd></div>}
      {stats.restEffectiveness !== null && <div><dt>睡眠恢复</dt><dd data-testid="furniture-rest" data-value={stats.restEffectiveness}>{number(stats.restEffectiveness * 100)}%</dd></div>}
      <div><dt>当前市值</dt><dd data-testid="furniture-value" data-value={value}>{number(value)} 银</dd></div>
    </dl>
    <small>{kind === 'table' ? '餐桌的美观会影响所在房间。' : '实际使用时，舒适度会逐渐向家具提供的水平恢复；舒适需求最高100%。'}{kind === 'bed' ? '睡眠恢复越高，同样时间内恢复的精力越多。' : ''}</small>
    <small>损伤影响当前市值；营地建筑财富按完好状态计算。</small>
    <details><summary>品质与施工</summary><small>完工者的建造水平越高，越容易做出高品质家具；品质在完工时确定。</small></details>
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
