import { useState } from 'react';
import type { Pawn, Pos, VoxelCommand, VoxelSnapshot } from './types';
import { DAY, TPS, BLOCK_NAMES } from './types';
import { weaponName } from './weapons';
import { isRangedKind } from './ranged';
import { snapshotShotReport } from './rangedView';

export function ThreatControl({
  snapshot: s,
  command,
}: {
  snapshot: VoxelSnapshot;
  command: (c: VoxelCommand) => void;
}) {
  const enemies = s.pawns.filter((p) => p.faction === 'raider' && !p.dead && !p.downed);
  return (
    <section className="voxel-bill" data-testid="threat-controls">
      <b>营地安全 · {enemies.length ? `${enemies.length} 名敌人` : '暂无活动敌人'}</b>
      <label>
        <input
          type="checkbox"
          aria-label="允许袭击"
          checked={s.combat.enabled}
          onChange={(e) => command({ type: 'threats', enabled: e.target.checked })}
        />
        允许袭击
      </label>
      <small>
        {s.combat.enabled
          ? `距离下一次来袭约 ${Math.max(0, (s.combat.nextRaid - s.tick) / DAY).toFixed(2)} 天`
          : '和平经营。开启后有三天准备时间；关闭不会移除已经到场的敌人。'}
      </small>
    </section>
  );
}

export function CombatPanel({
  pawn,
  pawns,
  snapshot,
  blockAt,
  command,
}: {
  pawn: Pawn;
  pawns: Pawn[];
  snapshot: VoxelSnapshot;
  blockAt: (cell: Pos) => number;
  command: (c: VoxelCommand) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const targets = pawns
    .filter((p) => p.id !== pawn.id && !p.dead && !p.downed && p.carriedBy === null)
    .sort((a, b) => Number(b.faction !== pawn.faction) - Number(a.faction !== pawn.faction));
  const target =
    targets.find((p) => p.id === selected) ??
    targets.find((p) => p.id === pawn.attackTargetId) ??
    targets[0];
  const ranged = !!pawn.weapon && isRangedKind(pawn.weapon.kind);
  const report = ranged && target ? snapshotShotReport(snapshot, pawn, target, blockAt) : null;
  const closeMelee =
    !!target &&
    target.z === pawn.z &&
    Math.abs(target.x - pawn.x) + Math.abs(target.y - pawn.y) === 1;
  const shooting = pawn.shooting;
  const events = snapshot.combatEvents
    .filter((e) => e.shooterId === pawn.id || e.targetId === pawn.id)
    .slice(-5)
    .reverse();
  const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
  const blocker = report?.firstBlocker;
  const blockedReason = blocker
    ? `${blockAt(blocker) ? BLOCK_NAMES[blockAt(blocker)] : '关闭的门'}遮挡（${blocker.x}, ${blocker.y}, Z ${blocker.z}）`
    : report && !report.inRange
      ? report.distance < report.minRange
        ? '目标过近，需要调整位置'
        : '超出射程，需要靠近目标'
      : null;
  return (
    <section className="voxel-bill" data-testid="combat-controls">
      <div className="voxel-info-row">
        <b>{pawn.faction === 'raider' ? '敌对袭击者' : '战斗'}</b>
        <span>{pawn.weapon ? weaponName(pawn.weapon) : '徒手'}</span>
      </div>
      {pawn.faction === 'colony' && !pawn.dead && !pawn.downed && (
        <>
          <button
            aria-pressed={pawn.drafted}
            onClick={() => command({ type: 'draft', pawnId: pawn.id, drafted: !pawn.drafted })}
          >
            {pawn.drafted ? '解除征召' : '征召'}
          </button>
          {pawn.drafted && (
            <>
              <small>
                征召期间停止工作和进食。装备远程武器可射击，贴身时改用近战；可先移动到掩体后方。
              </small>
              <label>
                攻击目标
                <select
                  aria-label={ranged ? '射击目标' : '近战目标'}
                  value={target?.id ?? ''}
                  disabled={!targets.length}
                  onChange={(e) => setSelected(Number(e.target.value))}
                >
                  {!targets.length && <option value="">没有目标</option>}
                  {targets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.faction === 'colony' ? '（同伴）' : '（敌人）'}
                    </option>
                  ))}
                </select>
              </label>
              {target?.faction === 'colony' && (
                <small className="danger">强制攻击同伴会造成实际伤害。</small>
              )}
              <button
                disabled={!target}
                onClick={() =>
                  target && command({ type: 'attack', pawnId: pawn.id, targetId: target.id })
                }
              >
                {ranged && !closeMelee ? '射击目标' : '近战攻击'}
              </button>
            </>
          )}
        </>
      )}
      {ranged && report && target && (
        <div className="voxel-shot-report" data-testid="shot-report">
          <div className="voxel-info-row">
            <b>对 {target.name}</b>
            <strong>
              {report.canShoot && !closeMelee ? percent(report.estimatedHitChance) : '—'}
            </strong>
          </div>
          <small>
            距离 {report.distance.toFixed(1)} / 射程 {report.stats.range} 格 · 高差{' '}
            {target.z - pawn.z >= 0 ? '+' : ''}
            {target.z - pawn.z}
          </small>
          {(blockedReason || closeMelee) && (
            <p className="voxel-shot-blocked" data-testid="shot-blocked">
              {closeMelee ? '相邻目标将使用近战攻击' : blockedReason}
            </p>
          )}
          <dl className="voxel-shot-factors">
            <dt>射手 · 距离衰减</dt>
            <dd>{percent(report.shooterFactor)}</dd>
            <dt>武器精度</dt>
            <dd>{percent(report.weaponFactor)}</dd>
            <dt>天气</dt>
            <dd>{percent(report.weatherFactor)}</dd>
            <dt>目标体型</dt>
            <dd>×{report.targetSizeFactor.toFixed(2)}</dd>
            <dt>近距倒地目标</dt>
            <dd>×{report.executionFactor.toFixed(1)}</dd>
            <dt>姿态</dt>
            <dd>{percent(report.postureFactor)}</dd>
            <dt>穿过目标身边掩体</dt>
            <dd>{percent(report.passCover)}</dd>
          </dl>
          {report.covers
            .filter((c) => c.blockChance > 0 || !c.heightEligible)
            .map((cover) => (
              <small key={cover.id}>
                掩体 {cover.position.x}, {cover.position.y}：
                {cover.heightEligible ? `拦挡 ${percent(cover.blockChance)}` : '弹道未经过掩体高度'}
              </small>
            ))}
          <small>
            射击 {pawn.skills.shooting.level} 级 · 每格精度 {percent(report.shooterAccuracyPerCell)}
            。预估值不包含途中误伤与额外拦截；护甲在命中后结算。
          </small>
        </div>
      )}
      {shooting && (
        <div className="voxel-aim-status" data-testid="shooting-status">
          <b>{shooting.phase === 'aim' ? '正在瞄准' : `连射中 · 剩余 ${shooting.shotsLeft} 发`}</b>
          <span>
            {pawns.find((p) => p.id === shooting.targetId)?.name ?? '目标'} · 距下一发{' '}
            {Math.max(0, (shooting.nextShotTick - snapshot.tick) / TPS).toFixed(2)} 秒
          </span>
          {shooting.phase === 'aim' && (
            <progress
              aria-label="瞄准进度"
              max={Math.max(1, shooting.nextShotTick - shooting.startedTick)}
              value={Math.max(0, snapshot.tick - shooting.startedTick)}
            />
          )}
        </div>
      )}
      {events.length > 0 && (
        <div className="voxel-combat-events" data-testid="combat-events">
          {events.map((event, i) => (
            <small key={`${event.tick}-${i}`} data-kind={event.kind}>
              {event.message}
              <span>{Math.max(0, (snapshot.tick - event.tick) / TPS).toFixed(1)} 秒前</span>
            </small>
          ))}
        </div>
      )}
    </section>
  );
}
