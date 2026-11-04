import { useEffect, useState } from 'react';
import type { ProductionBill } from './productionBills';
import {
  productionOutputDestinations, productionOutputResources, productionOutputTargetCells,
  productionOutputTargetName, sameProductionOutputTarget,
  type ProductionOutput, type ProductionOutputDestination, type ProductionOutputTarget,
} from './productionOutput';
import { effectiveShelfSettings } from './storageGroups';
import { position, RESOURCE_NAMES, type Pawn, type Pos, type VoxelSnapshot } from './types';

const targetKey = (target: ProductionOutputTarget) => `${target.kind}:${target.id}`;
const targetKinds = [
  { kind: 'stockpile', name: '地面仓库区' },
  { kind: 'shelf', name: '独立货架' },
  { kind: 'group', name: '联动储存组' },
] as const;

export function ProductionOutputPanel({ bill, snapshot, update, focus }: {
  bill: ProductionBill; snapshot: VoxelSnapshot;
  update: (output: ProductionOutput) => void; focus?: (pos: Pos) => void;
}) {
  // Choosing a mode must not silently assign the first destination. A specific
  // destination is committed only after the player actually selects one.
  const [choosing, setChoosing] = useState(false);
  const output = bill.output, mode = choosing ? 'specific' : output.mode;
  useEffect(() => setChoosing(false), [output.mode, output.target?.kind, output.target?.id]);
  const firstProduct = productionOutputResources(bill.recipe)[0];
  const productName = firstProduct ? RESOURCE_NAMES[firstProduct] : '成品';
  const destinations = productionOutputDestinations(snapshot);
  const target = output.mode === 'specific' ? output.target : null;
  let selected = target ? destinations.find(entry => sameProductionOutputTarget(entry.target, target)) : undefined;
  // A shelf picked while independent retains that exact identity after joining
  // a group. Show it as the current setting without duplicating group members
  // among newly selectable destinations.
  if (target && !selected) {
    const shelf = target.kind === 'shelf' ? snapshot.shelves.find(shelf => shelf.id === target.id) : undefined;
    selected = {
      target, label: productionOutputTargetName(snapshot, target),
      cells: productionOutputTargetCells(snapshot, target),
      accepts: shelf ? effectiveShelfSettings(snapshot.storageGroups, shelf.id, shelf.settings).accepts : [],
    };
  }
  const accepts = (entry: ProductionOutputDestination) => !!firstProduct && entry.accepts.includes(firstProduct);
  const options = destinations.filter(entry => accepts(entry) || sameProductionOutputTarget(entry.target, target));
  const selectedListed = target && options.some(entry => sameProductionOutputTarget(entry.target, target));
  const selectedAccepts = selected && accepts(selected);
  const selectedCell = selected?.cells[0];
  const label = (entry: ProductionOutputDestination) => `${entry.label}${!entry.cells.length ? ' · 暂无仓位'
    : !accepts(entry) ? ` · 当前不接纳${productName}` : ''}`;
  return <section className="voxel-production-output" data-testid="bill-output" data-output-mode={output.mode}>
    <label>成品去向<select aria-label="成品去向" value={mode} onChange={event => {
      const next = event.target.value as ProductionOutput['mode'];
      if (next === 'specific') setChoosing(output.mode !== 'specific');
      else { setChoosing(false); if (next !== output.mode) update({ mode: next, target: null }); }
    }}>
      <option value="drop">就地放下</option>
      <option value="best">送往最佳仓库</option>
      <option value="specific">送往指定仓库</option>
    </select></label>
    {mode === 'specific' && <>
      <label className="voxel-production-output-target">目标仓库<select aria-label="成品目标仓库"
        value={target ? targetKey(target) : ''} onChange={event => {
          const entry = options.find(value => targetKey(value.target) === event.target.value);
          if (!entry || !accepts(entry)) return;
          setChoosing(false); update({ mode: 'specific', target: entry.target });
        }}>
        <option value="" disabled>请选择目标仓库</option>
        {selected && !selectedListed && <optgroup label="当前指定目标">
          <option value={targetKey(selected.target)} disabled>{label(selected)} · 保留原指定</option>
        </optgroup>}
        {targetKinds.map(kind => {
          const entries = options.filter(entry => entry.target.kind === kind.kind);
          return entries.length ? <optgroup key={kind.kind} label={kind.name}>{entries.map(entry =>
            <option key={targetKey(entry.target)} value={targetKey(entry.target)} disabled={!accepts(entry) || !entry.cells.length}>
              {label(entry)}
            </option>)}</optgroup> : null;
        })}
      </select></label>
      {choosing && <div className="voxel-production-output-draft" data-testid="bill-output-draft">
        <small>选择目标后生效；目前仍为「{output.mode === 'drop' ? '就地放下' : '送往最佳仓库'}」。</small>
        <button type="button" onClick={() => setChoosing(false)}>取消选择</button>
      </div>}
      {selected && <small data-testid="bill-output-target-status" className={!selectedAccepts || !selected.cells.length ? 'voxel-production-output-warning' : undefined}>
        已指定：{selected.label}。{!selected.cells.length ? '当前暂无可用仓位。'
          : !selectedAccepts ? `当前筛选不接纳${productName}，保留此去向；成品先放在附近。`
          : `接纳${productName}；完工时还需有空位和可达通路。`}
      </small>}
      {focus && selectedCell !== undefined ? <button type="button" data-testid="bill-output-focus"
        onClick={() => focus(position(selectedCell))}>查看目标仓库</button> : null}
      {!destinations.some(accepts) && <small data-testid="bill-output-no-destination">暂无接纳{productName}的仓库。可先划仓储或调整收纳筛选。</small>}
    </>}
    <small data-testid="bill-output-rule">{mode === 'drop' ? '完工后把成品放在附近，之后可由搬运工收纳。'
      : mode === 'best' ? '完工后优先送往接纳该成品的高优先级仓库。没有合适仓位时就地放下。'
      : '只送往指定仓库；筛选不符、满仓或无法到达时就地放下。'}</small>
    <details className="voxel-production-output-help"><summary>配送与库存规则</summary>
      <small>由制作者运送第一种产品的一次携带量，其余成品留在附近，之后由搬运工收纳。</small>
      <small>成品去向不改变库存目标的统计范围，也不会把其他仓库的成品搬过来。</small>
      <small>调整去向影响后续完工批次，已经开始的配送继续执行原任务。</small>
    </details>
  </section>;
}

export function ProductionDeliveryStatus({ pawn, snapshot, focus, showWorker = false }: {
  pawn: Pawn; snapshot: VoxelSnapshot; focus?: (pos: Pos) => void; showWorker?: boolean;
}) {
  const delivery = pawn.productionDelivery;
  if (!delivery) return null;
  const target = position(delivery.cell);
  return <section className="voxel-production-delivery" data-testid="production-delivery"
    data-pawn-id={pawn.id} data-bill-id={delivery.billId} data-delivery-state={delivery.state}>
    <b>{showWorker ? `${pawn.name} · ` : ''}{delivery.state === 'dropping' ? '正在就近放下成品' : '正在运送成品'}</b>
    <small>{pawn.reason}</small>
    {pawn.cargo && <small>{RESOURCE_NAMES[pawn.cargo.resource]} × {pawn.cargo.amount} · 已完成加工</small>}
    <small data-testid="production-delivery-target">{delivery.state === 'carrying'
      ? `送往：${productionOutputTargetName(snapshot, delivery.target)} · (${target.x}, ${target.y}) · Z ${target.z}`
      : '先把成品放在附近，之后再由搬运工收纳。'}</small>
    {focus && <div className="voxel-production-delivery-actions">
      {showWorker && <button type="button" onClick={() => focus(pawn)}>查看制作者</button>}
      {delivery.state === 'carrying' && <button type="button" onClick={() => focus(target)}>查看配送位置</button>}
    </div>}
  </section>;
}
