import { useState } from 'react';
import type { Pawn, VoxelCommand, VoxelSnapshot } from './types';
import { DAY } from './types';

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
  command,
}: {
  pawn: Pawn;
  pawns: Pawn[];
  command: (c: VoxelCommand) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const targets = pawns
    .filter((p) => p.id !== pawn.id && !p.dead && !p.downed && p.carriedBy === null)
    .sort((a, b) => Number(b.faction === 'raider') - Number(a.faction === 'raider'));
  const target = targets.find((p) => p.id === selected) ?? targets[0];
  return (
    <section className="voxel-bill" data-testid="combat-controls">
      <div className="voxel-info-row">
        <b>{pawn.faction === 'raider' ? '敌对袭击者' : '战斗'}</b>
        <span>{pawn.weapon === 'steelKnife' ? '钢匕首' : '徒手'}</span>
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
                征召期间停止工作和进食；可移动到指定格，或命令近战攻击。相邻敌人会自动反击。
              </small>
              <label>
                攻击目标
                <select
                  aria-label="近战目标"
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
                近战攻击
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
