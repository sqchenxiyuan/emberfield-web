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
import { weaponResearchReason } from './research';
import { isRangedKind, rangedStats } from './ranged';
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
  const ranged = isRangedKind(piece.kind)
    ? rangedStats({ kind: piece.kind, quality: piece.quality })
    : null;
  return (
    <div className="voxel-apparel-detail" data-testid="weapon-detail">
      <b>{weaponName(piece)}</b>
      <span>
        耐久 {piece.hitPoints} / {stats.maxHitPoints}
      </span>
      {ranged && (
        <div className="voxel-ranged-stats" data-testid="ranged-weapon-detail">
          <span>
            射程 <b>{ranged.range} 格</b> ·{' '}
            {ranged.burstCount > 1 ? `${ranged.burstCount} 发连射` : '单发'}
          </span>
          <span>
            每发伤害 <b>{ranged.damage}</b> · 穿透 {(ranged.armorPenetration * 100).toFixed(1)}%
          </span>
          <span>
            瞄准 {(ranged.warmupTicks / TPS).toFixed(2)} 秒 · 冷却{' '}
            {(ranged.cooldownTicks / TPS).toFixed(2)} 秒
          </span>
          <small>
            武器精度（3 / 12 / 25 / 40 格）：
            {ranged.accuracy.map((n) => `${Math.round(n * 100)}%`).join(' / ')}
          </small>
          <small>
            实际命中还受射击技能、视力、操作能力、姿态与掩体影响。贴身会使用武器或身体进行近战。
          </small>
        </div>
      )}
      {attacks.map((a) => (
        <small key={a.id}>
          {ranged ? '近战 · ' : ''}
          {a.label}：基础伤害 {a.damage.toFixed(1)} · 穿透 {(a.armorPenetration * 100).toFixed(1)}%
          · 间隔 {a.cooldownSeconds.toFixed(1)} 秒
        </small>
      ))}
      {!ranged && (
        <small>
          实际攻击还会使用可用的身体部位；命中后伤害有波动，穿透参与命中部位的逐层护甲结算。
        </small>
      )}
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
      <small>明确安排装备会解除这件武器的禁止，并允许前往区域外取用；旧武器保留在附近地面。</small>
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
  const researchReason = weaponResearchReason(snapshot.research, kind);
  const activeJob = snapshot.jobs.find(
    (j) =>
      j.kind === 'smith' && !j.cancelled && j.x === bench.x && j.y === bench.y && j.z === bench.z,
  );
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
      {bench.kind === 'machining' && (
        <div className="voxel-bench-power" data-testid="machining-power">
          <div className="voxel-info-row">
            <b>{bench.power?.reason ?? '等待供电'}</b>
            <span>{bench.power?.powered ? '350 W' : '未供电'}</span>
          </div>
          <small>
            {bench.power?.networkId == null ? '未连接电网' : `电网 ${bench.power.networkId + 1}`} ·
            停电时保留当前批次，恢复供电后继续加工。
          </small>
          <button
            aria-pressed={!!bench.power?.on}
            onClick={() => command({ type: 'benchPower', benchId: bench.id, on: !bench.power?.on })}
          >
            {bench.power?.on ? '关闭机械台电源' : '打开机械台电源'}
          </button>
        </div>
      )}
      {activeJob && (
        <div className="voxel-aim-status" data-testid="weapon-production-progress">
          <b>
            {activeJob.weaponKind ? WEAPON_NAMES[activeJob.weaponKind] : '武器'} · 加工{' '}
            {Math.floor((activeJob.progress / Math.max(1, activeJob.work)) * 100)}%
          </b>
          <progress
            aria-label="武器制作进度"
            value={activeJob.progress}
            max={Math.max(1, activeJob.work)}
          />
          {activeJob.reason && <small>{activeJob.reason}</small>}
        </div>
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
        · 基础加工 {(weaponWork(kind, bench.kind) / TPS).toFixed(1)} 秒 · 工艺{' '}
        {recipe.sourceCraftingLevel} 级
      </p>
      <small>
        全营地已有 {pieces.filter((p) => p.kind === kind).length} 件（含装备、携带及地面）
      </small>
      <label>
        制作到目标数量
        <select
          aria-label="武器目标数量"
          value={bill.target}
          disabled={!!researchReason}
          title={researchReason ?? undefined}
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
      {researchReason && <p data-testid="weapon-research-lock">{researchReason}</p>}
      <button disabled={!!researchReason} onClick={() => update(bill.target, !bill.paused)}>
        {bill.paused ? '恢复此配方' : '暂停此配方'}
      </button>
      <small>
        需要「加工」分工，原料运达后开工。操作位 {stand.x}, {stand.y} · Z {stand.z}。
      </small>
      <small>
        武器品质由完工者的工艺等级决定，木棒无品质等级。降低目标保留当前批次，暂停则退回原料。
      </small>
    </section>
  );
}
