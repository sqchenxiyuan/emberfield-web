import { useState } from 'react';
import {
  WEAPON_DEFS,
  WEAPON_NAMES,
  weaponName,
  weaponStats,
  meleeOptions,
  weaponWork,
  type WeaponKind,
  type WeaponPiece,
} from './weapons';
import { WEAPON_BENCH_NAMES } from './weaponProduction';
import {
  RESOURCE_NAMES,
  TPS,
  weaponBenchInteraction,
  type Pawn,
  type Stack,
  type VoxelCommand,
  type VoxelSnapshot,
  type WeaponBench,
} from './types';

export function WeaponDetails({ piece }: { piece: WeaponPiece }) {
  const stats = weaponStats(piece),
    attacks = meleeOptions(piece).filter((a) => a.source === 'weapon');
  return (
    <div className="voxel-apparel-detail" data-testid="weapon-detail">
      <b>{weaponName(piece)}</b>
      <span>
        耐久 {piece.hitPoints} / {stats.maxHitPoints}
      </span>
      {attacks.map((a) => (
        <small key={a.id}>
          {a.label}：基础伤害 {a.damage.toFixed(1)} · 间隔 {a.cooldownSeconds.toFixed(1)} 秒
        </small>
      ))}
      <small>实际攻击还会使用可用的身体部位；命中后伤害有波动。当前未实现护甲减伤。</small>
    </div>
  );
}

export function WeaponPanel({ pawn, command }: { pawn: Pawn; command: (c: VoxelCommand) => void }) {
  return (
    <details className="voxel-apparel-panel" open data-testid="pawn-weapon">
      <summary>武器 · {pawn.weapon ? WEAPON_NAMES[pawn.weapon.kind] : '徒手'}</summary>
      {pawn.weapon && (
        <>
          <WeaponDetails piece={pawn.weapon} />
          <button
            disabled={
              pawn.dead || pawn.downed || pawn.weaponDropPending || pawn.faction !== 'colony'
            }
            onClick={() => command({ type: 'dropWeapon', pawnId: pawn.id })}
          >
            放下武器
          </button>
        </>
      )}
      {pawn.weaponTask && (
        <small>{pawn.weaponTask.action === 'drop' ? '正在放下武器' : '正在取用武器'}</small>
      )}
      {pawn.weaponDropPending && <small>正在等待可用地面放下武器；暂时无法使用。</small>}
      {pawn.cargo?.weapon && pawn.faction === 'colony' && (
        <button
          disabled={pawn.dead || pawn.downed || pawn.weaponDropPending}
          onClick={() =>
            command({ type: 'equipWeapon', pawnId: pawn.id, weaponId: pawn.cargo!.weapon!.id })
          }
        >
          装备携带的武器
        </button>
      )}
      <small>点击地面武器可安排取用。替换的旧武器会落地；主动放下的武器会禁止自动搬运。</small>
    </details>
  );
}

export function EquipWeapon({
  item,
  pawns,
  preferredPawnId,
  command,
}: {
  item: Stack;
  pawns: Pawn[];
  preferredPawnId?: number | null;
  command: (c: VoxelCommand) => void;
}) {
  const [chosen, choose] = useState(preferredPawnId ?? null);
  const eligible = pawns.filter(
    (p) =>
      p.faction === 'colony' &&
      !p.dead &&
      !p.downed &&
      !p.weaponDropPending &&
      p.carriedBy === null,
  );
  const pawn = eligible.find((p) => p.id === chosen) ?? eligible[0],
    piece = item.weapon!;
  return (
    <div className="voxel-wear-actions" data-testid="weapon-actions">
      <WeaponDetails piece={piece} />
      <label>
        <input
          type="checkbox"
          aria-label="允许搬运武器"
          checked={!item.forbidden}
          onChange={(e) =>
            command({ type: 'weaponForbidden', weaponId: piece.id, forbidden: !e.target.checked })
          }
        />
        允许自动搬运
      </label>
      <label>
        装备者
        <select
          aria-label="武器装备者"
          value={pawn?.id ?? ''}
          disabled={!pawn}
          onChange={(e) => choose(Number(e.target.value))}
        >
          {!pawn && <option value="">暂无可行动同伴</option>}
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!pawn}
        onClick={() =>
          pawn && command({ type: 'equipWeapon', pawnId: pawn.id, weaponId: piece.id })
        }
      >
        前往装备
      </button>
      <small>明确安排装备会解除禁止；人物到达后取用，旧武器保留在附近地面。</small>
    </div>
  );
}

export function WeaponBenchPanel({
  bench,
  snapshot,
  command,
}: {
  bench: WeaponBench;
  snapshot: VoxelSnapshot;
  command: (c: VoxelCommand) => void;
}) {
  const [selected, select] = useState<WeaponKind>(bench.bills[0].kind);
  const bill = bench.bills.find((b) => b.kind === selected) ?? bench.bills[0],
    kind = bill.kind;
  const recipe = WEAPON_DEFS[kind],
    stand = weaponBenchInteraction(bench);
  const pieces = [
    ...snapshot.items.flatMap((i) => (i.weapon ? [i.weapon] : [])),
    ...snapshot.pawns.flatMap((p) => [
      ...(p.weapon ? [p.weapon] : []),
      ...(p.cargo?.weapon ? [p.cargo.weapon] : []),
    ]),
  ];
  const update = (target: number, paused: boolean) =>
    command({ type: 'weaponBill', benchId: bench.id, kind, target, paused });
  return (
    <section className="voxel-bill voxel-tailor" data-testid="weapon-bills">
      <b>{WEAPON_BENCH_NAMES[bench.kind]}</b>
      {bench.kind === 'smithy' && (
        <small data-testid="smithy-fuel">
          燃料 {bench.fuel.toFixed(1)} / 50 木材 · 加工时消耗，低于 15 自动补充
        </small>
      )}
      <label>
        配方
        <select
          aria-label="武器配方"
          value={kind}
          onChange={(e) => select(e.target.value as WeaponKind)}
        >
          {bench.bills.map((b) => (
            <option key={b.kind} value={b.kind}>
              {WEAPON_NAMES[b.kind]}
            </option>
          ))}
        </select>
      </label>
      <p>
        {Object.entries(recipe.cost)
          .map(([r, n]) => `${n} ${RESOURCE_NAMES[r as keyof typeof RESOURCE_NAMES]}`)
          .join(' + ')}{' '}
        · 基础加工 {weaponWork(kind, bench.kind) / TPS} 秒
      </p>
      <small>
        全营地已有 {pieces.filter((p) => p.kind === kind).length} 件（含装备、携带及地面）
      </small>
      <label>
        制作到目标数量
        <select
          aria-label="武器目标数量"
          value={bill.target}
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
      <button onClick={() => update(bill.target, !bill.paused)}>
        {bill.paused ? '恢复此配方' : '暂停此配方'}
      </button>
      <small>
        需要「加工」分工，原料运达后开工。操作位 {stand.x}, {stand.y} · Z {stand.z}。
      </small>
      <small>
        钢制武器品质由完工者的工艺等级决定，木棒无品质等级。钢长剑需要工艺5级；当前没有研究系统。降低目标保留当前批次，暂停则退回原料。
      </small>
    </section>
  );
}
