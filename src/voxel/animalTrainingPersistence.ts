import { TRAINABLES, TRAINING_STEPS, TRAINING_PREREQUISITES,
  initialAnimalTraining, animalTrainable, animalSkillAvailable, animalMasterEligible,
  animalCanTrainWithResource, canTrainAnimal, validAnimalTrainTask, validAnimalWork } from './animalTraining';
import { defaultProductionQueue, productionJobRecipe, type ProductionHost } from './productionBills';
import { validBatch } from './preservation';
import { carryLimit } from './logistics';
import { healthSummary } from './survival';
import { type VoxelSave, type WildAnimal } from './types';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const exact = (v: unknown, keys: readonly string[]): v is Record<string, any> => record(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const same = (a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}) => a.x === b.x && a.y === b.y && a.z === b.z;
const adjacent = (a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}) => a.z === b.z && Math.abs(a.x-b.x) + Math.abs(a.y-b.y) === 1;
const phases = ['follow', 'attack', 'rescue', 'haul'];
function fail(reason: string): never { throw new Error('动物训练与协作存档无效：' + reason); }

/** Inspect untouched old input before auto-slaughter or species migrations add
 * defaults. Generic human cargo and job work fields are not animal fields. */
export function rejectLegacyAnimalTraining(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 59) return;
  if (old.husbandryLog?.some((e:any) => e?.kind === 'training')) fail('旧版本混入训练记录');
  const visit = (v: unknown, animal = false): void => {
    if (Array.isArray(v)) { if (v.includes('labrador')) fail('旧版本混入犬种筛选'); v.forEach(x => visit(x, animal)); return; }
    if (!record(v)) return;
    if (Object.hasOwn(v, 'labrador') || v.species === 'labrador' ||
        (animal && (['training', 'work', 'cargo'].some(k => Object.hasOwn(v, k)) || phases.includes(v.phase))) ||
        Object.hasOwn(v, 'animalTrainTask') || Object.hasOwn(v, 'animalsReleased') || v.phase === 'animalTrain')
      fail('旧版本混入犬种、训练或协作字段');
    for (const [key, value] of Object.entries(v)) visit(value, key === 'animals' || key === 'animal');
  };
  visit(old);
}
function allAnimals(d: Record<string, any>): Record<string, any>[] {
  if (!Array.isArray(d.animals) || d.animals.some(a => !record(a)) ||
      !record(d.trade) || !Array.isArray(d.trade.receipts)) fail('动物或贸易历史缺失');
  const animals: Record<string, any>[] = [...d.animals];
  for (const receipt of d.trade.receipts) {
    if (!record(receipt) || !Array.isArray(receipt.animalTransfers)) fail('贸易动物历史缺失');
    for (const row of receipt.animalTransfers) {
      if (!record(row) || !record(row.animal)) fail('贸易动物快照缺失');
      animals.push(row.animal);
    }
  }
  return animals;
}
/** Defaults never grant training, create actors, consume food or roll RNG.
 * Freeze implicit bills so adding a species cannot widen old butcher choices. */
export function migrateAnimalTraining(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 59) return;
  const animals = allAnimals(old);
  if (!integer(old.tick) || !Array.isArray(old.pawns) || old.pawns.some(p => !record(p)) ||
      !Array.isArray(old.productionQueues) || !Array.isArray(old.jobs)) fail('旧人物或生产数据缺失');
  const benches = ['stoves', 'butcherSpots', 'stonecutters', 'tailors', 'weaponBenches'];
  if (benches.some(key => !Array.isArray(old[key]))) fail('旧生产设施缺失');
  const queues = [];
  for (const bench of benches.flatMap(key => old[key])) {
    if (old.productionQueues.some((q:any) => q?.benchId === bench.id)) continue;
    const queue = defaultProductionQueue(old as ProductionHost, bench.id);
    if (!queue) fail('旧隐式生产账单缺失');
    for (const bill of queue.bills) bill.policy.allowedCarcasses = bill.policy.allowedCarcasses.filter(s => s !== 'labrador');
    queues.push(queue);
  }
  for (const animal of animals) Object.assign(animal, { training: initialAnimalTraining(animal.species, old.tick), work: null, cargo: null });
  for (const p of old.pawns) p.animalsReleased = false;
  old.productionQueues.push(...queues);
  for (const queue of queues) {
    const bench = benches.flatMap(key => old[key]).find(b => b.id === queue.benchId)!;
    for (const job of old.jobs) if (!job.cancelled && job.billId === undefined && same(job, bench)) {
      const recipe = productionJobRecipe(job); if (recipe) job.billId = `legacy:${bench.id}:${recipe}`;
    }
  }
  // Earlier migrations may construct today's policy factory. Do not introduce
  // the newly known species into their reconstructed historical defaults.
  const strip = (node:any):void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.allowedCarcasses)) node.allowedCarcasses = node.allowedCarcasses.filter((s:string) => s !== 'labrador');
    Object.values(node).forEach(strip);
  };
  strip(old);
}

/** Snapshot-safe shape checks. Live references and shared reservations are
 * verified separately; historical master IDs need not still be alive. */
export function validateAnimalTrainingState(a: WildAnimal, nextId: number, tick = Number.MAX_SAFE_INTEGER): void {
  const id = (v:unknown) => integer(v, 1, nextId - 1), s = a.training;
  if (!exact(s, ['wanted', 'steps', 'learned', 'countDecayFrom', 'masterId', 'followDrafted', 'followFieldwork', 'nextHaulTick']) ||
      !exact(s.wanted, TRAINABLES) || !exact(s.steps, TRAINABLES) || !exact(s.learned, TRAINABLES) ||
      TRAINABLES.some(k => typeof s.wanted[k] !== 'boolean' || typeof s.learned[k] !== 'boolean' ||
        !integer(s.steps[k], 0, TRAINING_STEPS[k]) || (s.learned[k] && s.steps[k] === 0) ||
        (!s.learned[k] && s.steps[k] === TRAINING_STEPS[k])) ||
      (s.countDecayFrom !== null && !integer(s.countDecayFrom, 0, tick)) ||
      (s.masterId !== null && !id(s.masterId)) || typeof s.followDrafted !== 'boolean' ||
      typeof s.followFieldwork !== 'boolean' || !integer(s.nextHaulTick) ||
      !Object.hasOwn(a, 'work') || !Object.hasOwn(a, 'cargo')) fail('训练字段、进度、时间或指派无效');
  for (const skill of TRAINABLES) {
    const prerequisite = TRAINING_PREREQUISITES[skill];
    if (prerequisite && ((s.wanted[skill] && !s.wanted[prerequisite]) ||
        (s.steps[skill] > 0 && (!s.learned[prerequisite] || s.steps[prerequisite] !== TRAINING_STEPS[prerequisite]))))
      fail('训练前置进度或意愿无效');
  }
  if (!animalTrainable(a.species)) {
    if (TRAINABLES.some(k => s.wanted[k] || s.learned[k] || s.steps[k] !== 0) || s.countDecayFrom !== null ||
        s.masterId !== null || s.followDrafted || s.followFieldwork || s.nextHaulTick !== 0 || a.work !== null || a.cargo !== null)
      fail('不支持训练的物种包含训练或协作');
  }
  if (s.masterId !== null && (!s.learned.obedience || a.faction !== 'colony' || a.dead)) fail('主人指派缺少服从或殖民地归属');
  if ((s.followDrafted || s.followFieldwork) && !s.learned.obedience) fail('跟随设置缺少服从');
  if (a.cargo !== null && (!validBatch(a.cargo) || a.cargo.amount > carryLimit(a.cargo.resource) ||
      Object.keys(a.cargo).some(key => !['resource','amount','crop','rotProgress','apparel','weapon','forbidden','carcass',
        'poisonChance','hitPoints','furniture','unfinished','hatcher'].includes(key)))) fail('动物携带实物无效');
  if (a.work !== null) {
    const w = a.work;
    if (!validAnimalWork(w) || a.phase !== w.kind || a.dead || a.faction !== 'colony' ||
        a.medical.downed || a.medical.carriedBy !== null || a.medical.bedId !== null || a.goal !== null ||
        a.mateId !== null || a.mateProgress !== 0 || a.eatProgress !== 0 || a.layProgress !== 0 ||
        (w.kind === 'follow' && (!id(w.masterId) || w.masterId !== s.masterId || !animalSkillAvailable(a, 'obedience'))) ||
        (w.kind === 'attack' && (!id(w.targetId) || !animalSkillAvailable(a, 'obedience') || s.masterId === null)) ||
        (w.kind === 'rescue' && (!id(w.patientId) || !id(w.bedId) || !animalSkillAvailable(a, 'rescue') || a.cargo !== null)) ||
        (w.kind === 'haul' && (!animalSkillAvailable(a, 'haul') ||
          (w.stage === 'fetch' ? !id(w.sourceId) || a.cargo !== null :
            a.cargo === null || a.cargo.resource !== w.resource || a.cargo.amount < w.amount)))) fail('动物工作与训练、阶段或实物不符');
  } else if (phases.includes(a.phase)) fail('动物工作阶段缺少任务');
  if (a.dead && (a.work !== null || s.masterId !== null || s.followDrafted || s.followFieldwork)) fail('死亡动物仍有指派');
}

/** Exact persisted reservations only. Human ordinary fetch/storage amounts are
 * rebuilt by the world loader and must not be inferred from changing hunger. */
export function animalTrainingReservations(d: VoxelSave): Map<number, number> {
  const result = new Map<number, number>();
  const add = (id: unknown, n: unknown) => { if (integer(id,1) && integer(n,1)) result.set(id, (result.get(id) ?? 0) + n); };
  for (const p of d.pawns) {
    if (p.careFoodId !== null) add(p.careFoodId, p.careAmount);
    if (p.careMedicineId !== null) add(p.careMedicineId, p.careAmount);
    if (p.handleTask?.stage === 'fetch') add(p.handleTask.foodId, p.handleTask.amount);
    if (p.animalCareTask?.stage === 'fetch') add(p.animalCareTask.sourceId, p.animalCareTask.amount);
    if (p.prisonFoodTask?.stage === 'fetch') add(p.prisonFoodTask.sourceId, p.prisonFoodTask.amount);
    if (p.living?.mealTask?.sourceId !== null) add(p.living?.mealTask?.sourceId, p.living?.mealTask?.amount);
    if (p.animalTrainTask?.stage === 'fetch') add(p.animalTrainTask.sourceId, p.animalTrainTask.amount);
  }
  for (const a of d.animals) if (a.work?.kind === 'haul' && a.work.stage === 'fetch') add(a.work.sourceId, a.work.amount);
  return result;
}
export function validateAnimalTraining(d: VoxelSave): void {
  if (!integer(d.tick) || !integer(d.nextId,1) || !Array.isArray(d.animals) || !Array.isArray(d.pawns) ||
      !Array.isArray(d.items) || !Array.isArray(d.beds)) fail('世界列表或时钟无效');
  const id = (v:unknown) => integer(v,1,d.nextId-1);
  const animalById = new Map(d.animals.map(a => [a.id,a])), pawnById = new Map(d.pawns.map(p => [p.id,p]));
  const targets = new Set<number>(), patients = new Set<number>(), beds = new Set<number>();
  for (const p of d.pawns) {
    if (typeof p.animalsReleased !== 'boolean' || (p.animalsReleased && (p.faction !== 'colony' || p.dead || !p.drafted)))
      fail('居民动物释放指令无效');
    const has = Object.hasOwn(p,'animalTrainTask'), t = p.animalTrainTask;
    if (has !== (p.phase === 'animalTrain')) fail('训练任务与人物阶段不符');
    if (!has) continue;
    if (!validAnimalTrainTask(t) || !id(t.animalId) || (t.sourceId !== null && !id(t.sourceId))) fail('训练任务字段无效');
    const a = animalById.get(t.animalId);
    if (!a || targets.has(a.id) || !a.training.wanted[t.trainable] || !canTrainAnimal(a,t.trainable) ||
        a.medical.downed || a.medical.carriedBy !== null || a.medical.bedId !== null || a.work !== null ||
        d.pawns.some(q => q.handleTask?.animalId === a.id || q.ropeTask?.animalId === a.id || q.animalCareTask?.animalId === a.id))
      fail('训练动物不合格或被重复预约');
    if (p.faction !== 'colony' || p.dead || p.downed || p.drafted || !p.priorities.handle ||
        p.carriedBy !== null || p.carryingPawnId !== null || p.jobId !== null || p.patientId !== null || p.carePhase !== null ||
        p.careFoodId !== null || p.careMedicineId !== null || p.careBedId !== null || p.eating !== null ||
        p.sleepBedId !== null || p.sleepingSince !== null || p.wardenTask !== null || p.handleTask !== null || p.ropeTask !== null ||
        p.cleanTask !== null || p.firefightTask !== null || p.repairTask !== null || p.weaponTask !== null || p.apparelTask !== null ||
        p.attackTargetId !== null || p.shooting !== null || p.psyche.recreation !== null || p.psyche.breakUntil > d.tick ||
        p.living.mealTask !== null || ['manualFoodOrder','animalCareTask','eggBoxTask','productionDelivery','prisonFoodTask'].some(k => Object.hasOwn(p,k)) ||
        healthSummary(p).moving <= 0 || healthSummary(p).manipulation <= 0 || !animalMasterEligible(p,a)) fail('训练员与其他活动冲突');
    if (!animalCanTrainWithResource(a.species,t.resource)) fail('训练食物不适合动物');
    const food = t.stage === 'fetch' ? d.items.find(i => i.id === t.sourceId) : p.cargo;
    if (!food || food.resource !== t.resource || food.amount < t.amount || (t.stage === 'fetch' && p.cargo !== null))
      fail('训练缺少实际食物');
    if (t.stage === 'work' && (!adjacent(p,a) || p.path.length || p.destination !== null)) fail('训练双方没有相邻停下');
    targets.add(a.id);
  }
  for (const a of d.animals) {
    validateAnimalTrainingState(a,d.nextId,d.tick);
    const master = a.training.masterId === null ? undefined : pawnById.get(a.training.masterId);
    if (a.training.masterId !== null && (!master || !animalMasterEligible(master,a))) fail('动物主人不存在或不合格');
    const w = a.work;
    if (!w) continue;
    if (targets.has(a.id) || d.pawns.some(p => p.handleTask?.animalId === a.id || p.ropeTask?.animalId === a.id || p.animalCareTask?.animalId === a.id))
      fail('协作动物同时被驯养员或医护占用');
    if ((w.kind === 'follow' || w.kind === 'attack') && (!master || master.dead || master.downed || master.carriedBy !== null ||
        !(master.drafted ? a.training.followDrafted : a.training.followFieldwork))) fail('跟随或防御缺少有效主人与跟随设置');
    if (w.kind === 'attack') {
      const target = pawnById.get(w.targetId);
      if (!target || target.faction !== 'raider' || target.dead || target.downed || target.carriedBy !== null)
        fail('协作攻击缺少敌对目标');
    }
    if (w.kind === 'rescue') {
      const patient = pawnById.get(w.patientId), bed = d.beds.find(b => b.id === w.bedId);
      if (!patient || patient.faction !== 'colony' || patient.dead || !patient.downed || patients.has(patient.id) ||
          !bed || bed.prisoner || (!bed.medical && bed.owner !== patient.id) || beds.has(bed.id) ||
          d.pawns.some(p => p.patientId === patient.id || p.careBedId === bed.id || (p.id !== patient.id && p.sleepBedId === bed.id)) ||
          (w.stage === 'carry' ? patient.carriedBy !== a.id || !same(patient,a) || patient.sleepBedId !== null : patient.carriedBy !== null))
        fail('动物救援患者、床位或携带关系无效');
      patients.add(patient.id); beds.add(bed.id);
    }
    if (w.kind === 'haul' && w.stage === 'fetch') {
      const item = d.items.find(i => i.id === w.sourceId);
      if (!item || item.resource !== w.resource || item.amount < w.amount) fail('动物搬运缺少地面实物');
      if (item.unfinished && d.jobs.some(j => j.unfinishedId === item.unfinished!.id && j.owner !== null && !j.cancelled))
        fail('动物不能抢走正在加工的未完成品');
    }
  }
  for (const p of d.pawns) if (p.carriedBy !== null && animalById.has(p.carriedBy)) {
    const a = animalById.get(p.carriedBy)!, w = a.work;
    if (!w || w.kind !== 'rescue' || w.stage !== 'carry' || w.patientId !== p.id || !same(a,p)) fail('被救援者缺少对应动物');
  }
  for (const [sourceId, amount] of animalTrainingReservations(d)) {
    const source = d.items.find(i => i.id === sourceId);
    if (!source || amount > source.amount) fail('训练、搬运或其他工作重复预约超过实物');
  }
}
