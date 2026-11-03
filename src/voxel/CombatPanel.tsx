import { useState } from 'react';
import type { Pawn, Pos, VoxelCommand, VoxelSnapshot } from './types';
import { DAY, TPS, BLOCK_NAMES } from './types';
import { weaponName } from './weapons';
import { isRangedKind } from './ranged';
import { snapshotShotReport } from './rangedView';
import {
  CASSANDRA_CYCLE,
  CASSANDRA_START,
  CASSANDRA_TIMING,
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  RAID_NAMES,
  type Difficulty,
} from './storyteller';
import { STORY_INTERVAL } from './storytellerRules';

const number = (value: number) =>
  value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

export function storyOpportunityText(s: VoxelSnapshot) {
  if (!s.combat.enabled) return '后续袭击已关闭，事件日历继续推进';
  if (s.storyteller.difficulty === 'peaceful') return '和平难度不安排袭击';
  if (s.storyteller.nextOpportunity === null) return '目前没有待检查的袭击机会';
  return `下次袭击机会约 ${Math.max(0, (s.storyteller.nextOpportunity - s.tick) / DAY).toFixed(2)} 天后，届时检查是否可入场`;
}

function storyWindow(s: VoxelSnapshot) {
  const start = CASSANDRA_START * STORY_INTERVAL;
  if (s.tick < start) return '开局阶段';
  const elapsed = (s.tick - start) % (CASSANDRA_CYCLE * STORY_INTERVAL);
  return elapsed < CASSANDRA_TIMING.onDays * DAY ? '活动窗口' : '休息窗口';
}

export function StorytellerPanel({ snapshot: s }: { snapshot: VoxelSnapshot }) {
  const story = s.storyteller,
    threat = story.threat,
    recent = story.events.slice(-3).reverse(),
    losses = story.losses.slice(-3).reverse();
  return (
    <details className="voxel-storyteller-details" data-testid="storyteller-details">
      <summary>财富与压力 · 估值 {number(threat.totalWealth)}</summary>
      <div className="voxel-storyteller-body">
        <dl className="voxel-storyteller-values" data-testid="wealth-breakdown">
          <div><dt>物品</dt><dd>{number(threat.wealth.items)}</dd></div>
          <div><dt>建筑</dt><dd>{number(threat.wealth.buildings)}</dd></div>
          <div><dt>殖民者</dt><dd>{number(threat.wealth.pawns)}</dd></div>
          <div><dt>总财富</dt><dd>{number(threat.totalWealth)}</dd></div>
          <div><dt>叙事财富</dt><dd>{number(threat.storytellerWealth)}</dd></div>
        </dl>
        <small>叙事财富按物品＋建筑的 50%＋殖民者估值计算；这里的估值不是交易报价。</small>
        {story.legacyStructureCells > 0 && (
          <small data-testid="legacy-structure-note">
            {story.legacyStructureCells} 格旧结构无法恢复原始墙体或楼板身份，使用兼容估值。
          </small>
        )}
        <div className="voxel-storyteller-pressure" data-testid="threat-breakdown">
          <b>当前威胁估算 {number(threat.points)} 点</b>
          <small>当前营地条件的估算；事件发生时重新计算，并受组队预算与入场条件影响。</small>
          {story.difficulty === 'peaceful' && <small>和平难度下，这个估算值不会用于生成袭击。</small>}
          <dl className="voxel-storyteller-values">
            <div><dt>财富点</dt><dd>{number(threat.wealthPoints)}</dd></div>
            <div><dt>健康人口点</dt><dd>{number(threat.populationPoints)}</dd></div>
            <div><dt>适应倍率</dt><dd>× {threat.adaptationFactor.toFixed(3)}</dd></div>
            <div><dt>难度倍率</dt><dd>× {number(threat.difficultyFactor)}</dd></div>
            <div><dt>营地年龄倍率</dt><dd>× {threat.settlementFactor.toFixed(3)}</dd></div>
            <div><dt>当前最低威胁点</dt><dd>{number(threat.minimumPoints)}</dd></div>
          </dl>
          <small>财富点与人口点相加后乘以上述倍率，再限制在最低威胁点至 10,000 点之间。</small>
          {threat.population.map((person) => (
            <small key={person.id} data-population-pawn={person.id}>
              {s.pawns.find((p) => p.id === person.id)?.name ?? '殖民者'} · 健康 {(person.health * 100).toFixed(1)}% · {number(person.points)} 点
            </small>
          ))}
          <small data-testid="adaptation-state">适应值 {number(story.adaptationDays)}；近期伤亡会降低压力，之后随时间恢复。</small>
          {losses.map((loss, index) => (
            <small key={`${loss.tick}-${loss.pawnId}-${index}`}>
              第 {number(loss.tick / DAY)} 天 · {s.pawns.find((p) => p.id === loss.pawnId)?.name ?? '殖民者'}
              {loss.kind === 'lost' ? '死亡' : '遭暴力击倒'} · 适应值 {number(loss.before)} → {number(loss.after)}
            </small>
          ))}
        </div>
        <section className="voxel-storyteller-events" data-testid="storyteller-events">
          <b>最近事件</b>
          {!recent.length && <small>尚无袭击事件记录。</small>}
          {recent.map((event, index) => (
            <div key={`${event.tick}-${event.source}-${index}`} data-story-event={event.tick}>
              <strong>第 {number(event.tick / DAY)} 天 · {event.outcome === 'spawned' ? `${event.members.length} 名袭击者入场` : '本次机会跳过'}</strong>
              <small>{event.reason}</small>
              {event.outcome === 'spawned' && (
                <>
                  <small>实际预算 {number(event.budget)} · 已用 {number(event.spent)} · 剩余 {number(event.remainder)}</small>
                  <small>{event.members.map((member) => `${RAID_NAMES[member.kind]} ${number(member.cost)} 点`).join('、')}</small>
                </>
              )}
            </div>
          ))}
        </section>
      </div>
    </details>
  );
}

export function ThreatControl({
  snapshot: s,
  command,
}: {
  snapshot: VoxelSnapshot;
  command: (c: VoxelCommand) => void;
}) {
  const enemies = s.pawns.filter((p) => p.faction === 'raider' && !p.dead && !p.downed);
  return (
    <section className="voxel-bill voxel-storyteller" data-testid="threat-controls">
      <b>营地安全 · {enemies.length ? `${enemies.length} 名敌人` : '暂无活动敌人'}</b>
      <small data-testid="storyteller-window">Cassandra · {storyWindow(s)}</small>
      <label>
        难度
        <select
          aria-label="叙事难度"
          value={s.storyteller.difficulty}
          onChange={(e) => command({ type: 'difficulty', difficulty: e.target.value as Difficulty })}
        >
          {DIFFICULTIES.map((difficulty) => <option key={difficulty} value={difficulty}>{DIFFICULTY_NAMES[difficulty]}</option>)}
        </select>
      </label>
      <label className="voxel-threat-toggle">
        <input
          type="checkbox"
          aria-label="允许袭击"
          checked={s.combat.enabled}
          onChange={(e) => command({ type: 'threats', enabled: e.target.checked })}
        />
        允许袭击
      </label>
      <small data-testid="storyteller-opportunity">{storyOpportunityText(s)}</small>
      <small>第 11 天起按 4.6 天活动、6 天休息推进，每周期安排 1–2 次机会。开局第 5.4 天另有一次初始机会。</small>
      <small>关闭不会移除场上敌人；重新开启不会重置日历，也不会补发错过的事件。</small>
      <StorytellerPanel snapshot={s} />
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
