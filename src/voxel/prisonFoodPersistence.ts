import { validPrisonFoodTask } from './prisonFood';
import { healthSummary } from './survival';
import type { VoxelSave } from './types';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
function fail(reason: string): never { throw new Error('囚犯送餐存档无效：' + reason); }

export function rejectLegacyPrisonFood(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 58) return;
  if (Array.isArray(old.pawns) && old.pawns.some(p => record(p) &&
    (Object.hasOwn(p, 'prisonFoodTask') || p.phase === 'prisonFood' ||
      (p.faction === 'prisoner' && (p.phase === 'dine' || p.eating != null || p.living?.mealTask != null)))))
    fail('旧版本混入送餐任务或囚犯自主用餐');
}

/** No default task is created: historical one-off feeding jobs retain their
 * original fields until the world completes or safely cancels them. */
export function migratePrisonFood(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 58) return;
  rejectLegacyPrisonFood(old, sourceVersion);
  if (!Array.isArray(old.pawns) || Array.from(old.pawns).some(p => !record(p))) fail('旧人物无效');
}

export function validatePrisonFood(d: VoxelSave): void {
  if (!integer(d.tick) || !integer(d.nextId, 1) || !Array.isArray(d.pawns) || !Array.isArray(d.items) ||
    Array.from(d.pawns).some(p => !record(p))) fail('人物、物品或时间无效');
  const id = (v: unknown): v is number => integer(v, 1) && v < d.nextId;
  const targets = new Set<number>(), reserved = new Map<number, number>();
  const reserve = (sourceId: unknown, amount: unknown) => {
    if (id(sourceId) && integer(amount, 1)) reserved.set(sourceId, (reserved.get(sourceId) ?? 0) + amount);
  };
  // Only exact persisted quantities can be aggregated here. Ordinary/manual
  // fetch reservations have no saved amount and are rebuilt by the loader.
  for (const p of d.pawns) {
    reserve(p.careFoodId, p.careAmount);
    if (p.handleTask?.stage === 'fetch') reserve(p.handleTask.foodId, p.handleTask.amount);
    if (p.animalCareTask?.stage === 'fetch') reserve(p.animalCareTask.sourceId, p.animalCareTask.amount);
    if (p.living?.mealTask?.sourceId !== null) reserve(p.living?.mealTask?.sourceId, p.living?.mealTask?.amount);
  }
  const deliverySources = new Set<number>();
  for (const p of d.pawns) {
    const hasTask = Object.hasOwn(p, 'prisonFoodTask'), task = p.prisonFoodTask;
    if (hasTask !== (p.phase === 'prisonFood')) fail('任务与人物阶段不符');
    if (!hasTask) continue;
    if (!validPrisonFoodTask(task) || !id(task.prisonerId) || (task.sourceId !== null && !id(task.sourceId)))
      fail('任务字段、编号或数量无效');
    if (p.faction !== 'colony' || p.dead !== false || p.downed !== false || p.drafted !== false ||
      p.carriedBy !== null || p.carryingPawnId !== null || p.jobId !== null || p.patientId !== null || p.carePhase !== null ||
      p.careFoodId !== null || p.careMedicineId !== null || p.careBedId !== null || p.eating !== null ||
      p.sleepBedId !== null || p.sleepingSince !== null || p.wardenTask !== null || p.handleTask !== null || p.ropeTask !== null ||
      p.cleanTask !== null || p.firefightTask !== null || p.repairTask !== null || p.weaponTask !== null || p.apparelTask !== null ||
      p.attackTargetId !== null || p.shooting !== null || !record(p.psyche) || p.psyche.recreation !== null ||
      p.psyche.breakUntil > d.tick || !record(p.living) || p.living.mealTask !== null ||
      ['manualFoodOrder', 'animalCareTask', 'eggBoxTask', 'productionDelivery'].some(key => Object.hasOwn(p, key)) ||
      healthSummary(p).moving <= 0 || healthSummary(p).manipulation <= 0)
      fail('送餐与人物其他活动冲突');
    const recipient = d.pawns.find(q => q.id === task.prisonerId);
    if (!recipient || recipient === p || recipient.faction !== 'prisoner' || recipient.dead || !record(recipient.prisoner) ||
      recipient.prisoner.releasing || recipient.prisoner.policy === 'release' || targets.has(recipient.id) ||
      d.pawns.some(q => q.wardenTask?.prisonerId === recipient.id || q.patientId === recipient.id))
      fail('囚犯不存在、已释放或被重复预约');
    targets.add(recipient.id);
    if (task.stage === 'fetch') {
      const source = d.items.find(item => item.id === task.sourceId);
      if (!source || source.resource !== task.resource ||
        !integer(source.amount, task.amount) || p.cargo !== null) fail('取食来源或携带物无效');
      reserve(source.id, task.amount); deliverySources.add(source.id);
    } else if (!record(p.cargo) || p.cargo.resource !== task.resource || !integer(p.cargo.amount, task.amount))
      fail('送餐没有对应实际食物');
  }
  for (const sourceId of deliverySources) {
    const source = d.items.find(item => item.id === sourceId)!;
    if (reserved.get(sourceId)! > source.amount) fail('地面食物重复预约超出数量');
  }
}
