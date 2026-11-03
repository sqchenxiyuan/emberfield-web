import { at, inside, position, type VoxelSave } from './types';
import { FIRE_RULES, FIRE_MAX_HP, initialFireHazards, nextFireIncident, fireDamageKey,
  fireDamageCells, fireDamageHomeCells, fireDamageBurning } from './fire';
import { fireFuelAt, findFireDamageTarget, touchesFire, type FireHost } from './fireWorld';
import { healthSummary } from './survival';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v: unknown, low = 0, high = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= low && v <= high;
const finite = (v: unknown, low: number, high: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high;
const pos = (p: any) => record(p) && inside(p as any);
function fail(reason: string): never { throw new Error('火灾存档无效：' + reason); }
export function rejectLegacyFireFields(old: Record<string, any>) {
  if (old.version >= 26) return;
  if (['fires', 'fireDamage', 'fireHazards', 'fireLog'].some(k => Object.hasOwn(old, k)) ||
      (Array.isArray(old.pawns) && old.pawns.some(p => record(p) &&
        (Object.hasOwn(p, 'firefightTask') || Object.hasOwn(p, 'repairTask') ||
          Object.hasOwn(p.priorities ?? {}, 'firefight') || ['firefight', 'repair'].includes(p.phase)))))
    fail('旧版本包含新版火焰、损伤、火灾日程或消防任务');
}
export function migrateFire(old: Record<string, any>, sourceVersion: number) {
  if (sourceVersion >= 26) return;
  if (!Array.isArray(old.pawns) || old.pawns.some(p => !record(p) || !record(p.priorities))) fail('旧人物或优先级缺失');
  old.fires = []; old.fireDamage = []; old.fireLog = []; old.fireHazards = initialFireHazards(old.seed, old.tick);
  for (const p of old.pawns) { p.firefightTask = null; p.repairTask = null; p.priorities.firefight = p.faction === 'colony' ? 1 : 0; }
}
/** Called after the complete geometry and global id union have been restored. */
export function validateFire(d: VoxelSave, host: FireHost) {
  if (!Array.isArray(d.fires) || d.fires.length > FIRE_RULES.maxFires || !Array.isArray(d.fireDamage) ||
      d.fireDamage.length > FIRE_RULES.maxDamage || !Array.isArray(d.fireLog) || d.fireLog.length > FIRE_RULES.maxLog)
    fail('列表容量无效');
  const cells = new Set<number>(), damageKeys = new Set<string>();
  for (const fire of d.fires) {
    if (!exact(fire, ['id', 'x', 'y', 'z', 'size', 'startedTick', 'nextDamageTick', 'nextSpreadTick', 'source']) || !pos(fire) ||
        !integer(fire.startedTick, 0, d.tick) || !finite(fire.size, FIRE_RULES.minSize, FIRE_RULES.maxSize) ||
        !['lightning', 'shortCircuit', 'spread'].includes(fire.source) ||
        !integer(fire.nextDamageTick, d.tick + 1, d.tick + FIRE_RULES.damageInterval) ||
        !integer(fire.nextSpreadTick, d.tick + 1, d.tick + FIRE_RULES.spreadInterval) ||
        (fire.nextDamageTick - fire.startedTick) % FIRE_RULES.damageInterval !== 0 ||
        (fire.nextSpreadTick - fire.startedTick) % FIRE_RULES.spreadInterval !== 0 ||
        cells.has(at(fire)) || !fireFuelAt(host, fire).length) fail('火焰大小、日程、燃料或格位无效');
    cells.add(at(fire));
  }
  for (const damage of d.fireDamage) {
    if (!exact(damage, ['key', 'kind', 'targetId', 'hitPoints', 'maxHitPoints', 'x', 'y', 'z']) || !pos(damage) ||
        !Object.hasOwn(FIRE_MAX_HP, damage.kind) || damage.maxHitPoints !== FIRE_MAX_HP[damage.kind] ||
        !finite(damage.hitPoints, Number.MIN_VALUE, damage.maxHitPoints) || damage.hitPoints >= damage.maxHitPoints ||
        (['block', 'ladder', 'wire'].includes(damage.kind) ? damage.targetId !== null : !integer(damage.targetId, 1, d.nextId - 1)) ||
        damage.key !== fireDamageKey(damage.kind, damage.targetId, damage) || damageKeys.has(damage.key)) fail('结构损伤形状、耐久或身份无效');
    const actual = findFireDamageTarget(host, damage);
    if (!actual || actual.key !== damage.key || at(actual) !== at(damage)) fail('结构损伤目标已经不存在或位置不符');
    damageKeys.add(damage.key);
  }
  const h = d.fireHazards;
  if (!exact(h, ['enabled', 'epoch', 'cycle', 'nextIncidentTick', 'events']) || typeof h.enabled !== 'boolean' ||
      !integer(h.epoch, 0, d.tick) || !integer(h.cycle) || !integer(h.nextIncidentTick, d.tick + 1) ||
      h.nextIncidentTick !== nextFireIncident(d.seed, h.epoch, h.cycle) ||
      (h.cycle > 0 && nextFireIncident(d.seed, h.epoch, h.cycle - 1) > d.tick) ||
      !Array.isArray(h.events) || h.events.length !== Math.min(h.cycle, FIRE_RULES.maxEvents)) fail('火灾机会日程无效');
  for (let i = 0; i < h.events.length; i++) {
    const e = h.events[i], cycle = h.cycle - h.events.length + i;
    if (!exact(e, ['tick', 'source', 'outcome', 'position', 'networkId', 'reason']) || !integer(e.tick, 0, d.tick) ||
        e.tick !== nextFireIncident(d.seed, h.epoch, cycle) || !['lightning', 'shortCircuit'].includes(e.source) ||
        !['ignited', 'skipped'].includes(e.outcome) || (e.outcome === 'ignited' ? !pos(e.position) : e.position !== null) ||
        (e.networkId !== null && (!integer(e.networkId, 0) || e.source !== 'shortCircuit' || e.outcome !== 'ignited')) ||
        typeof e.reason !== 'string' || !e.reason.length || e.reason.length > 240) fail('火灾机会历史无效');
  }
  let lastTick = -1;
  for (const e of d.fireLog) {
    if (!exact(e, ['tick', 'type', 'position', 'message']) || !integer(e.tick, 0, d.tick) || e.tick < lastTick ||
        !['ignited', 'extinguished', 'destroyed', 'fell', 'failed'].includes(e.type) || !pos(e.position) ||
        typeof e.message !== 'string' || !e.message.length || e.message.length > 240) fail('火灾操作日志无效');
    lastTick = e.tick;
  }
  const reservations = new Set<string>(), home = new Set(d.homeArea);
  for (const p of d.pawns) {
    if (!Object.hasOwn(p, 'firefightTask') || !Object.hasOwn(p, 'repairTask') ||
        !integer(p.priorities.firefight, 0, 4) || (p.faction !== 'colony' && p.priorities.firefight !== 0) ||
        (p.firefightTask !== null) !== (p.phase === 'firefight') || (p.repairTask !== null) !== (p.phase === 'repair'))
      fail('人物消防或修理字段缺失或阶段不符');
    if (p.firefightTask === null && p.repairTask === null) continue;
    if (p.faction !== 'colony' || p.dead || p.downed || p.drafted || p.carriedBy !== null || p.carryingPawnId !== null ||
        p.jobId !== null || p.carePhase !== null || p.patientId !== null || p.wardenTask !== null || p.cleanTask !== null || p.cargo !== null ||
        p.eating !== null || p.sleepBedId !== null || p.sleepingSince !== null || p.workTarget !== null ||
        p.weaponTask !== null || p.apparelTask !== null || p.attackTargetId !== null || p.shooting !== null ||
        p.psyche.recreation !== null || p.psyche.breakUntil > d.tick || healthSummary(p).manipulation <= 0) fail('人物工作条件冲突');
    let key: string, targets;
    const task = p.firefightTask ?? p.repairTask!;
    if (p.firefightTask) {
      const f = d.fires.find(f => f.id === p.firefightTask!.fireId);
      if (!exact(task, ['fireId', 'progress']) || !f || !home.has(at(f))) fail('消防任务目标或Home无效');
      key = `fire:${f.id}`; targets = [f];
    } else {
      const damage = d.fireDamage.find(q => q.key === p.repairTask!.damageKey);
      if (!exact(task, ['damageKey', 'progress']) || !damage ||
          !fireDamageHomeCells(damage, d).some(q => home.has(at(q))) || fireDamageBurning(damage, d.fires, d)) fail('修理目标或Home无效');
      key = damage.key; targets = fireDamageCells(damage, d);
    }
    const limit = p.firefightTask ? FIRE_RULES.beatWork : FIRE_RULES.repairPointWork;
    if (reservations.has(key) || !finite(task.progress, 0, limit) || task.progress >= limit ||
        (task.progress > 0 && !targets.some(q => touchesFire(p, q))) ||
        (p.path.length ? p.destination !== p.path.at(-1) || !targets.some(q => touchesFire(position(p.path.at(-1)!), q))
          : p.destination !== null || !targets.some(q => touchesFire(p, q)))) fail('消防修理进度、Touch位置或独占预约无效');
    reservations.add(key);
  }
}
