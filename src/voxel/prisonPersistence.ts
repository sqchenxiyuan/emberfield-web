import { at, type VoxelSave } from './types';
import { validPrisonerState, validWardenTask } from './prisoners';
import { healthSummary } from './survival';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
function fail(reason: string): never { throw new Error('俘虏存档无效：' + reason); }
/** Run before any historical migration can replace pawn defaults. */
export function rejectLegacyPrisonerFields(old: Record<string, any>, sourceVersion = old.version): void {
  if (sourceVersion >= 24) return;
  if (old.pawns?.some((p: any) => record(p) &&
      (Object.hasOwn(p, 'prisoner') || Object.hasOwn(p, 'wardenTask') ||
        Object.hasOwn(p.priorities ?? {}, 'warden') || p.faction === 'prisoner' || ['warden', 'prisoner'].includes(p.phase))) ||
      old.beds?.some((b: any) => record(b) && Object.hasOwn(b, 'prisoner')))
    fail('旧版本包含新版俘虏或看守字段');
}
/** Called after the historical migrations finish. Version promotion belongs to
 * the loader. Existing identity, injuries, skills, jobs and resources survive. */
export function migratePrisoners(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 24) return;
  rejectLegacyPrisonerFields(old, sourceVersion);
  if (!Array.isArray(old.pawns) || !Array.isArray(old.beds) ||
      old.pawns.some((p: unknown) => !record(p) || !record(p.priorities)) ||
      old.beds.some((b: unknown) => !record(b))) fail('旧版本人物或床位数据缺失');
  for (const p of old.pawns) {
    p.prisoner = null; p.wardenTask = null;
    p.priorities.warden = p.faction === 'colony' ? 1 : 0;
  }
  for (const b of old.beds) b.prisoner = false;
}

/** Cross-entity checks only. General identity, position, health, work and care
 * validation still belongs to the main loader. Invalidated cells/removed beds
 * may leave a waiting prisoner with bedId=null; fabricated dangling ids may not. */
export function validatePrisoners(d: VoxelSave): void {
  if (!Array.isArray(d.pawns) || !Array.isArray(d.beds)) fail('人物或床位列表缺失');
  const pawnById = new Map(d.pawns.map(p => [p.id, p]));
  const bedById = new Map(d.beds.map(b => [b.id, b]));
  const prisonerBeds = new Set<number>(), targets = new Set<number>(), carryBeds = new Set<number>();
  for (const bed of d.beds) {
    if (typeof bed.prisoner !== 'boolean') fail('床位缺少俘虏标志');
    if (bed.owner !== null) {
      const owner = pawnById.get(bed.owner);
      if (!owner || (bed.prisoner ? owner.faction !== 'prisoner' || owner.prisoner?.bedId !== bed.id
        : owner.faction !== 'colony')) fail('床位主人与用途不符');
    }
  }
  for (const p of d.pawns) {
    if (!Object.hasOwn(p, 'prisoner') || !Object.hasOwn(p, 'wardenTask') ||
        !p.priorities || !Number.isInteger(p.priorities.warden) || p.priorities.warden < 0 || p.priorities.warden > 4)
      fail('人物缺少合法俘虏或看守字段');
    if ((p.faction === 'prisoner') !== (p.prisoner !== null)) fail('身份与俘虏状态不符');
    if (p.faction !== 'colony' && p.priorities.warden !== 0) fail('非殖民者不能安排看守工作');
    if (p.prisoner !== null) {
      if (!validPrisonerState(p.prisoner, d.tick)) fail('俘虏状态或交谈期限无效');
      if (p.drafted || p.retreating || p.jobId !== null || p.carePhase !== null || p.patientId !== null ||
          p.carryingPawnId !== null || p.attackTargetId !== null || p.shooting !== null ||
          p.weaponTask !== null || p.apparelTask !== null || p.psyche.recreation !== null ||
          p.psyche.breakUntil > d.tick || p.eating !== null || !['prisoner', 'downed', 'dead'].includes(p.phase))
        fail('俘虏含自由工作、战斗或不相容活动');
      const bedId = p.prisoner.bedId;
      if (bedId !== null) {
        const bed = bedById.get(bedId);
        if (!bed || !bed.prisoner || bed.owner !== p.id || prisonerBeds.has(bedId)) fail('俘虏床位重复或不属于本人');
        prisonerBeds.add(bedId);
      }
      if (p.sleepBedId !== null && p.sleepBedId !== bedId) fail('俘虏休息床不是所分配的床');
      if (p.sleepingSince !== null) {
        const bed = bedId === null ? undefined : bedById.get(bedId);
        if (!bed || p.sleepBedId !== bed.id || at(p) !== at(bed) || p.carriedBy !== null || p.prisoner.releasing)
          fail('俘虏未在本人的床上休息');
      }
    } else if (p.phase === 'prisoner') fail('普通人物使用俘虏阶段');
    if ((p.wardenTask !== null) !== (p.phase === 'warden')) fail('看守任务与人物阶段不符');
    const task = p.wardenTask;
    if (task === null) continue;
    if (!validWardenTask(task) || p.faction !== 'colony' || p.dead || p.downed || p.drafted ||
        p.carriedBy !== null || p.jobId !== null || p.carePhase !== null || p.patientId !== null ||
        p.cargo !== null || p.eating !== null || p.sleepBedId !== null || p.sleepingSince !== null ||
        p.weaponTask !== null || p.apparelTask !== null || p.attackTargetId !== null || p.shooting !== null ||
        p.psyche.recreation !== null || p.psyche.breakUntil > d.tick) fail('看守工作条件或阶段无效');
    const q = pawnById.get(task.prisonerId);
    if (!q || q === p || q.dead || targets.has(q.id) || d.pawns.some(other => other.patientId === q.id))
      fail('目标不存在或被重复预约');
    targets.add(q.id);
    if (task.stage === 'captureApproach' || task.stage === 'captureCarry') {
      const bed = bedById.get(task.bedId!);
      if (!bed || !bed.prisoner || (bed.owner !== null && bed.owner !== q.id) ||
          carryBeds.has(bed.id) || healthSummary(p).manipulation <= 0 ||
          d.pawns.some(other => other.id !== q.id && (other.prisoner?.bedId === bed.id || other.careBedId === bed.id)))
        fail('搬运床位或搬运能力无效');
      carryBeds.add(bed.id);
      if (task.stage === 'captureApproach') {
        if (q.carriedBy !== null || p.carryingPawnId !== null ||
            !((q.faction === 'raider' && q.downed && q.prisoner === null) ||
              (q.faction === 'prisoner' && q.prisoner !== null && !q.prisoner.releasing)))
          fail('待俘获或转移目标无效');
      } else if (q.faction !== 'prisoner' || !q.prisoner || q.prisoner.releasing ||
          q.prisoner.bedId !== bed.id || bed.owner !== q.id || q.carriedBy !== p.id || p.carryingPawnId !== q.id ||
          at(p) !== at(q) || q.sleepBedId !== null || q.sleepingSince !== null)
        fail('俘虏搬运双方关系不符');
    } else {
      if (q.faction !== 'prisoner' || !q.prisoner || q.prisoner.releasing || q.downed ||
          q.carriedBy !== null || p.carryingPawnId !== null) fail('交谈或释放目标无效');
      if (task.stage === 'releaseApproach') {
        if (q.prisoner.policy !== 'release') fail('释放任务与策略不符');
      } else {
        const wh = healthSummary(p), qh = healthSummary(q);
        if (!['recruit', 'reduceResistance'].includes(q.prisoner.policy) ||
            (q.prisoner.policy === 'reduceResistance' && q.prisoner.resistance === 0) ||
            q.prisoner.nextInteractionTick > d.tick || q.prisoner.bedId === null || q.sleepingSince !== null ||
            Math.min(wh.talking, wh.hearing, qh.talking, qh.hearing) <= 0)
          fail('交谈策略、冷却或沟通能力无效');
        if (task.stage === 'talk' && (p.z !== q.z || Math.abs(p.x - q.x) + Math.abs(p.y - q.y) !== 1 ||
            p.path.length !== 0 || p.destination !== null)) fail('交谈双方尚未面对面停下');
      }
    }
  }
  // A capture carrier must be uniquely paired even when validating the patient
  // before the warden in serialized array order.
  for (const p of d.pawns) if (p.prisoner && p.carriedBy !== null) {
    const carrier = pawnById.get(p.carriedBy);
    if (carrier?.wardenTask && (carrier.wardenTask.stage !== 'captureCarry' ||
        carrier.wardenTask.prisonerId !== p.id || carrier.carryingPawnId !== p.id)) fail('俘虏搬运引用不对称');
  }
}
