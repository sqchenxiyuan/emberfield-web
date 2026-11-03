import { initialSkills } from './skills';
import { isRangedKind, rangedStats, projectileFlightTicks } from './ranged';
import { DEPTH, HEIGHT, WIDTH, inside, type VoxelSave } from './types';

const technologies = ['Machining', 'Gunsmithing', 'BlowbackOperation'];
/** Inspect the original schema before any intermediate migration adds defaults. */
export function rejectLegacyRangedFields(old: Record<string, any>) {
  if (old.version >= 18) return;
  if (
    ['projectiles', 'combatEvents', 'sandbags'].some((key) => Object.hasOwn(old, key)) ||
    technologies.some(
      (key) => Object.hasOwn(old.research?.progress ?? {}, key) || old.research?.current === key,
    )
  )
    throw new Error('旧存档包含新版射击或研究字段');
  const pawns = Array.isArray(old.pawns) ? old.pawns : [],
    items = Array.isArray(old.items) ? old.items : [],
    benches = Array.isArray(old.weaponBenches) ? old.weaponBenches : [],
    jobs = Array.isArray(old.jobs) ? old.jobs : [];
  if (
    pawns.some(
      (p) =>
        p &&
        (Object.hasOwn(p, 'shooting') ||
          Object.hasOwn(p, 'staggerUntil') ||
          Object.hasOwn(p.skills ?? {}, 'shooting') ||
          p.trauma?.wounds?.some((w: any) => w?.kind === 'gunshot')),
    ) ||
    [...items, ...pawns, ...pawns.flatMap((p) => (p?.cargo ? [p.cargo] : []))].some((p) =>
      isRangedKind(p?.weapon?.kind),
    ) ||
    benches.some(
      (b) =>
        b &&
        (b.kind === 'machining' ||
          Object.hasOwn(b, 'power') ||
          b.bills?.some((bill: any) => isRangedKind(bill?.kind))),
    ) ||
    jobs.some(
      (j) =>
        j &&
        (['machining', 'sandbag'].includes(j.kind) ||
          isRangedKind(j.weaponKind) ||
          j.weaponBenchKind === 'machining'),
    )
  )
    throw new Error('旧存档包含新版远程装备或任务');
}
export function migrateRangedFields(old: Record<string, any>) {
  if (old.version !== 17) return;
  if (![old.pawns, old.weaponBenches].every(Array.isArray) || !old.research?.progress)
    throw new Error('旧射击迁移数据无效');
  old.projectiles = [];
  old.combatEvents = [];
  old.sandbags = [];
  let profile = 0;
  for (const p of old.pawns) {
    if (!p?.skills) throw new Error('旧人物技能无效');
    p.skills.shooting = initialSkills(profile++, p.faction === 'raider').shooting;
    p.shooting = null;
    p.staggerUntil = 0;
  }
  for (const b of old.weaponBenches) {
    if (!b || !['craftingSpot', 'smithy'].includes(b.kind) || !Array.isArray(b.bills))
      throw new Error('旧武器台无效');
    b.bills.push({ kind: 'shortBow', target: 0, paused: false });
  }
  for (const key of technologies) old.research.progress[key] = 0;
  old.version = 18;
}
export function validateRangedState(d: VoxelSave) {
  const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const identity = (n: number) => integer(n) && n > 0 && n < d.nextId;
  const same = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    a.x === b.x && a.y === b.y && a.z === b.z;
  if (
    !Array.isArray(d.projectiles) ||
    d.projectiles.length > 256 ||
    !Array.isArray(d.combatEvents) ||
    d.combatEvents.length > 64
  )
    throw new Error('射击历史或弹丸数量无效');
  for (const p of d.pawns) {
    if (!integer(p.staggerUntil) || p.staggerUntil > d.tick + 32)
      throw new Error('命中减速计时无效');
    if (p.shooting === null) continue;
    const s = p.shooting;
    if (
      !s ||
      !p.weapon ||
      !isRangedKind(p.weapon.kind) ||
      p.dead ||
      p.downed ||
      p.retreating ||
      p.carriedBy !== null ||
      p.weaponDropPending ||
      (p.phase !== 'combat' && p.phase !== 'hunt') ||
      p.path.length ||
      p.weaponTask !== null ||
      p.apparelTask !== null ||
      p.jobId !== null ||
      p.carePhase !== null ||
      p.destination !== null ||
      p.nextAttackTick > d.tick ||
      s.weaponId !== p.weapon.id ||
      s.targetId !== p.attackTargetId ||
      !(p.phase === 'hunt'
        ? d.animals.some(a => a.id === s.targetId && !a.dead && a.hunt)
        : d.pawns.some((q) => q.id === s.targetId && q !== p && !q.dead && !q.downed)) ||
      !s.origin ||
      !inside(s.origin) ||
      !same(s.origin, p) ||
      !['aim', 'burst'].includes(s.phase) ||
      !integer(s.startedTick) ||
      s.startedTick > d.tick ||
      !integer(s.nextShotTick) ||
      !Number.isInteger(s.shotsLeft)
    )
      throw new Error('瞄准或连发状态无效');
    const stats = rangedStats({ ...p.weapon, kind: p.weapon.kind });
    if (
      s.shotsLeft < 1 ||
      s.shotsLeft > stats.burstCount ||
      (s.phase === 'aim'
        ? s.shotsLeft !== stats.burstCount || s.nextShotTick !== s.startedTick + stats.warmupTicks
        : s.shotsLeft >= stats.burstCount ||
          s.nextShotTick !==
            s.startedTick + stats.burstOffsetsTicks[stats.burstCount - s.shotsLeft]) ||
      s.nextShotTick <= d.tick
    )
      throw new Error('射击阶段与计时不一致');
  }
  const center = (p: { x: number; y: number; z: number }) =>
    !!p &&
    [p.x, p.y, p.z].every(
      (n, i) => Number.isFinite(n) && n % 1 === 0.5 && n >= 0.5 && n < [WIDTH, DEPTH, HEIGHT][i],
    );
  for (const shot of d.projectiles) {
    if (
      !shot ||
      !identity(shot.id) ||
      !identity(shot.shooterId) ||
      !identity(shot.targetId) ||
      shot.shooterId === shot.targetId ||
      !['colony', 'raider', 'trader'].includes(shot.shooterFaction) ||
      !isRangedKind(shot.kind) ||
      !integer(shot.quality) ||
      shot.quality > 6 ||
      !center(shot.from) ||
      !center(shot.destination) ||
      !integer(shot.launchedTick) ||
      shot.launchedTick > d.tick ||
      !integer(shot.impactTick) ||
      shot.impactTick <= d.tick ||
      ['canHitIntended', 'canHitOthers', 'canHitWorld'].some(
        (k) => typeof shot[k as keyof typeof shot] !== 'boolean',
      ) ||
      (shot.coverId !== null && !identity(shot.coverId)) ||
      (shot.coverId !== null && (!shot.canHitWorld || shot.canHitIntended)) ||
      ![0.5, 1].includes(shot.postureImpactChance)
    )
      throw new Error('在飞弹丸数据无效');
    const stats = rangedStats(shot),
      length = Math.hypot(
        shot.from.x - shot.destination.x,
        shot.from.y - shot.destination.y,
        shot.from.z - shot.destination.z,
      );
    if (
      shot.damage !== stats.damage ||
      shot.armorPenetration !== stats.armorPenetration ||
      shot.impactTick !== shot.launchedTick + projectileFlightTicks(length, stats.speed)
    )
      throw new Error('弹丸伤害、穿甲或飞行计时不一致');
    const shooter = d.pawns.find((p) => p.id === shot.shooterId);
    if (shooter && shooter.faction !== shot.shooterFaction) throw new Error('发射者阵营不一致');
  }
  let priorTick = 0;
  for (const e of d.combatEvents) {
    if (
      !e ||
      !inside(e) ||
      !integer(e.tick) ||
      e.tick < priorTick ||
      e.tick > d.tick ||
      !identity(e.shooterId) ||
      (e.targetId !== null && !identity(e.targetId)) ||
      !['fire', 'hit', 'miss', 'cover', 'terrain', 'deflect'].includes(e.kind) ||
      !Number.isFinite(e.damage) ||
      e.damage < 0 ||
      e.damage > 1000 ||
      typeof e.message !== 'string' ||
      e.message.length > 300
    )
      throw new Error('战斗事件无效');
    priorTick = e.tick;
  }
}
