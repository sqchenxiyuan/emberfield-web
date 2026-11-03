import { useState } from 'react';
import { APPAREL_DEFS, APPAREL_NAMES, TAILOR_KINDS } from './apparel';
import { tailorInteraction, type ApparelKind, type Tailor, type VoxelSnapshot } from './types';

export function TailorPanel({
  tailor,
  snapshot,
  update,
}: {
  tailor: Tailor;
  snapshot: VoxelSnapshot;
  update: (kind: ApparelKind, target: number, paused: boolean) => void;
}) {
  const [kind, select] = useState<ApparelKind>('parka');
  const bill = tailor.bills.find((b) => b.kind === kind) ?? { kind, target: 0, paused: false };
  const recipe = APPAREL_DEFS[kind],
    stand = tailorInteraction(tailor);
  const pieces = [
    ...snapshot.items.flatMap((i) => (i.apparel ? [i.apparel] : [])),
    ...snapshot.pawns.flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
  ];
  const count = new Set(pieces.filter((p) => p.kind === kind).map((p) => p.id)).size;
  return (
    <div className="voxel-bill voxel-tailor" data-testid="tailor-bills">
      <b>手工裁缝</b>
      <label>
        配方
        <select
          aria-label="裁缝配方"
          value={kind}
          onChange={(e) => select(e.target.value as ApparelKind)}
        >
          {TAILOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {APPAREL_NAMES[k]}
            </option>
          ))}
        </select>
      </label>
      <p>
        每件 {recipe.cloth} 布料 · 全营地已有 {count} 件（含穿戴与携带）
      </p>
      <label>
        制作到目标数量
        <select
          aria-label="衣物目标数量"
          value={bill.target}
          onChange={(e) => update(kind, Number(e.target.value), bill.paused)}
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
      <button onClick={() => update(kind, bill.target, !bill.paused)}>
        {bill.paused ? '恢复此配方' : '暂停此配方'}
      </button>
      <small>
        需要「加工」分工，实际运来布料后开工。操作位 {stand.x}, {stand.y} · Z {stand.z}。
      </small>
      <small>
        降低目标不打断当前衣物，暂停此配方才中止并退料。工艺等级影响成品品质；操作能力影响制作速度。
      </small>
      {tailor.bills.some((b) => b.target > 0) && (
        <div className="voxel-tailor-queue">
          {tailor.bills
            .filter((b) => b.target > 0)
            .map((b) => (
              <span key={b.kind}>
                {APPAREL_NAMES[b.kind]} × {b.target}
                {b.paused ? ' · 暂停' : ''}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
