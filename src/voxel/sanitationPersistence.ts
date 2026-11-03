import { at, inside, type VoxelSave } from './types';
import { FILTH_NAMES, SANITATION_RULES, cookingOutcome, poisoningStage, validFoodPoisoning } from './sanitation';
import { healthSummary } from './survival';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
function fail(message: string): never { throw new Error('卫生存档无效：' + message); }
const exact = (v: unknown, keys: string[]) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

/** Check authentic old data before historical migrations add current pawn defaults. */
export function rejectLegacySanitationFields(old: Record<string, any>, sourceVersion = old.version) {
  if (sourceVersion >= 25) return;
  const pawns = list(old.pawns), jobs = list(old.jobs);
  const cargo = [...list(old.items), ...pawns.map(p => p?.cargo), ...jobs.flatMap(j => list(j?.deliveredFood)),
    ...list(old.trade?.caravans).flatMap(c => list(c?.stock)),
    ...list(old.trade?.receipts).flatMap(r => list(r?.transferred).map(t => t?.batch))];
  if (Object.hasOwn(old, 'filth') || pawns.some(p => record(p) &&
      (['cleanTask', 'dirtCarry', 'foodPoisoning'].some(k => Object.hasOwn(p, k)) ||
        Object.hasOwn(p.priorities ?? {}, 'clean') || p.phase === 'clean')) ||
      jobs.some(j => record(j) && Object.hasOwn(j, 'cookingOutcome')) ||
      cargo.some(b => record(b) && Object.hasOwn(b, 'poisonChance')))
    fail('旧版本包含新版污物、清扫、中毒或污染字段');
}
export function migrateSanitation(old: Record<string, any>, sourceVersion: number) {
  if (sourceVersion >= 25) return;
  if (!Array.isArray(old.pawns) || old.pawns.some((p: unknown) => !record(p) || !record(p.priorities)))
    fail('旧存档人物或优先级缺失');
  old.filth = [];
  for (const p of old.pawns) {
    p.cleanTask = null; p.dirtCarry = 0; p.foodPoisoning = null;
    p.priorities.clean = p.faction === 'colony' ? 3 : 0;
  }
  // Do not touch existing meals or completed production. Their age, amounts,
  // recipe inputs and the absence of poisonChance remain exactly as saved.
}
export function validateSanitation(d: VoxelSave) {
  if (!Array.isArray(d.filth) || d.filth.length > SANITATION_RULES.maxFilth) fail('污物列表无效');
  const cells = new Set<string>(), targets = new Set<number>(), home = new Set(d.homeArea);
  for (const f of d.filth) {
    if (!exact(f, ['id', 'kind', 'amount', 'createdTick', 'x', 'y', 'z']) || !inside(f) ||
        !Object.hasOwn(FILTH_NAMES, f.kind) || !Number.isSafeInteger(f.amount) || f.amount < 1 ||
        f.amount > SANITATION_RULES.maxLayers || !Number.isSafeInteger(f.createdTick) ||
        f.createdTick < 0 || f.createdTick > d.tick) fail('污物形状、层数或时间无效');
    const cell = `${at(f)}:${f.kind}`;
    if (cells.has(cell)) fail('同一格同类污物必须合并');
    cells.add(cell);
  }
  for (const p of d.pawns) {
    if (!Object.hasOwn(p, 'cleanTask') || !Object.hasOwn(p, 'foodPoisoning') ||
        !Number.isInteger(p.dirtCarry) || p.dirtCarry < 0 || p.dirtCarry > SANITATION_RULES.dirtCarry ||
        !p.priorities || !Number.isInteger(p.priorities.clean) || p.priorities.clean < 0 || p.priorities.clean > 4 ||
        (p.faction !== 'colony' && p.priorities.clean !== 0)) fail('人物清扫或携泥字段缺失或无效');
    const illness = p.foodPoisoning;
    if (illness !== null && (!validFoodPoisoning(illness, d.tick) || (!p.dead &&
        (illness.endsTick <= d.tick || illness.nextVomitTick <= d.tick || illness.stage !== poisoningStage(illness, d.tick)))))
      fail('中毒期限或阶段不符');
    if ((p.cleanTask !== null) !== (p.phase === 'clean')) fail('清扫阶段与任务不符');
    if (p.cleanTask === null) continue;
    const task = p.cleanTask, f = d.filth.find(f => f.id === task.filthId);
    if (!exact(task, ['filthId', 'progress']) || !f || !home.has(at(f)) || targets.has(f.id) ||
        !Number.isFinite(task.progress) || task.progress < 0 || task.progress >= SANITATION_RULES.cleanWork ||
        p.faction !== 'colony' || p.dead || p.downed || p.drafted || p.carriedBy !== null || p.carryingPawnId !== null ||
        p.jobId !== null || p.carePhase !== null || p.patientId !== null || p.wardenTask !== null || p.cargo !== null ||
        p.eating !== null || p.sleepBedId !== null || p.sleepingSince !== null || p.workTarget !== null ||
        p.weaponTask !== null || p.apparelTask !== null || p.attackTargetId !== null || p.shooting !== null ||
        p.psyche.recreation !== null || p.psyche.breakUntil > d.tick || healthSummary(p).manipulation <= 0 ||
        (task.progress > 0 && at(p) !== at(f)) ||
        (p.path.length ? p.destination !== at(f) || p.path.at(-1) !== at(f) : at(p) !== at(f)))
      fail('清扫条件、进度或独占预约无效');
    targets.add(f.id);
  }
  for (const j of d.jobs) if (j.cookingOutcome !== undefined) {
    const o = j.cookingOutcome;
    if (j.kind !== 'cook' || j.progress !== j.work ||
        !exact(o, ['poisonChance', 'risk', 'roll', 'skill', 'cleanliness', 'cookId', 'roomless']) || typeof o.roomless !== 'boolean' ||
        !Number.isInteger(o.skill) || o.skill < 0 || o.skill > 20 ||
        !Number.isFinite(o.cleanliness) || o.cleanliness < -1000 || o.cleanliness > 10 ||
        !d.pawns.some(p => p.id === o.cookId)) fail('烹饪结果来源或时机无效');
    const expected = cookingOutcome(d.seed, j.id, o.cookId, o.skill, o.cleanliness, o.roomless);
    if (o.poisonChance !== expected.poisonChance || o.risk !== expected.risk || o.roll !== expected.roll)
      fail('烹饪结果不符合既定批次判定');
  }
}
