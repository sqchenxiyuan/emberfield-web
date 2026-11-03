import { useState } from 'react';
import { APPAREL_DEFS, APPAREL_NAMES } from './apparel';
import { armorResearchReason } from './research';
import {
  TPS,
  RESOURCE_NAMES,
  type ArmorKind,
  type WeaponBench,
  type VoxelSnapshot,
  type VoxelCommand,
} from './types';

export function ArmorBenchPanel({
  bench,
  snapshot,
  command,
}: {
  bench: WeaponBench;
  snapshot: VoxelSnapshot;
  command: (c: VoxelCommand) => void;
}) {
  const [selected, select] = useState<ArmorKind>('simpleHelmet');
  const bill = bench.armorBills.find((b) => b.kind === selected) ?? bench.armorBills[0];
  if (!bill) return null;
  const kind = bill.kind,
    recipe = APPAREL_DEFS[kind];
  const reason = armorResearchReason(snapshot.research, kind);
  const pieces = [
    ...snapshot.items.flatMap((i) => (i.apparel ? [i.apparel] : [])),
    ...snapshot.pawns.flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
  ];
  const update = (target: number, paused: boolean) =>
    command({ type: 'armorBill', benchId: bench.id, kind, target, paused });
  return (
    <section className="voxel-bill voxel-tailor" data-testid="armor-bills">
      <b>锻造护甲</b>
      <label>
        护甲配方
        <select
          aria-label="护甲配方"
          value={kind}
          onChange={(e) => select(e.target.value as ArmorKind)}
        >
          {bench.armorBills.map((b) => (
            <option key={b.kind} value={b.kind}>
              {APPAREL_NAMES[b.kind]}
            </option>
          ))}
        </select>
      </label>
      <p>
        {Object.entries(recipe.cost)
          .map(([r, n]) => `${n} ${RESOURCE_NAMES[r as keyof typeof RESOURCE_NAMES]}`)
          .join(' + ')}{' '}
        · 基础加工 {(recipe.work / TPS).toFixed(1)} 秒
      </p>
      <small>
        全营地已有 {pieces.filter((p) => p.kind === kind).length} 件（含穿戴、携带及地面）
      </small>
      <label>
        制作到目标数量
        <select
          aria-label="护甲目标数量"
          value={bill.target}
          disabled={!!reason}
          title={reason ?? undefined}
          onChange={(e) => update(Number(e.target.value), bill.paused)}
        >
          {[...new Set([0, 1, 2, 3, 5, 10, 20, bill.target])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {n === 0 ? '不安排新制作' : `${n} 件`}
              </option>
            ))}
        </select>
      </label>
      {reason && <p data-testid="armor-research-lock">{reason}</p>}
      <button disabled={!!reason} onClick={() => update(bill.target, !bill.paused)}>
        {bill.paused ? '恢复护甲配方' : '暂停护甲配方'}
      </button>
      <small>
        需要「加工」分工
        {recipe.sourceCraftingLevel ? `与工艺 ${recipe.sourceCraftingLevel} 级` : ''}
        。钢材实际运达后开工，与武器共用锻造台及燃料；品质由完工者决定。
      </small>
      <small>降低目标保留当前批次，暂停会退回已运原料。完成后在地面选择护甲安排穿戴。</small>
    </section>
  );
}
