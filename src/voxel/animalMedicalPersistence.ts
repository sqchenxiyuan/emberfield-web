import { ANIMAL_MEDICAL_RULES, animalBodyParts, animalMedicalSummary, initialAnimalMedical } from './animalMedical';
import { ANIMAL_DEFS } from './wildlife';
import { MEDICAL_POLICIES } from './medicine';
import { healthSummary } from './survival';
import { HUSBANDRY_RULES } from './husbandry';
import { animalEnvironmentEffects } from './animalEnvironment';
import { at, HEIGHT, inside, type VoxelSave, type WildAnimal } from './types';

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const range = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const exact = (value: unknown, keys: readonly string[]): value is Record<string, any> =>
  record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const same = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  a.x === b.x && a.y === b.y && a.z === b.z;
function fail(reason: string): never { throw new Error('动物医疗存档无效：' + reason); }

export function rejectLegacyAnimalMedical(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 54) return;
  if (Object.hasOwn(old, 'animalBeds') || old.pawns?.some((p: any) =>
    record(p) && (Object.hasOwn(p, 'animalCareTask') || p.phase === 'animalCare')) ||
      old.animals?.some((a: any) => record(a) && (Object.hasOwn(a, 'medical') || ['medicalRest','downed','carried'].includes(a.phase))))
    fail('旧版本混入动物病床、伤口或护理任务');
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (record(node) && Object.hasOwn(node, 'species') &&
        (Object.hasOwn(node, 'medical') || ['medicalRest','downed','carried'].includes(node.phase)))
      fail('旧版本混入动物医疗历史');
    Object.values(node).forEach(visit);
  };
  visit(old);
}

export function migrateAnimalMedical(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 54) return;
  if (!Array.isArray(old.animals) || old.animals.some(a => !record(a)) ||
      !Array.isArray(old.trade?.receipts)) fail('旧动物或交易历史缺失');
  const snapshots: Record<string, any>[] = [];
  for (const r of old.trade.receipts) {
    if (!record(r) || !Array.isArray(r.animalTransfers)) fail('旧交易动物历史缺失');
    for (const row of r.animalTransfers) {
      if (!record(row) || !record(row.animal)) fail('旧交易动物快照无效');
      snapshots.push(row.animal);
    }
  }
  for (const a of [...old.animals, ...snapshots]) a.medical = initialAnimalMedical();
  old.animalBeds = [];
}

/** Wound IDs belong to this animal's local history, not the world's identity
 * counter. Historical trade references are bounded but need not still exist. */
export function validateAnimalMedicalState(a: WildAnimal, nextId: number, tick = Number.MAX_SAFE_INTEGER): void {
  const m = a.medical, id = (value: unknown) => integer(value, 1, nextId - 1);
  if (!Object.hasOwn(ANIMAL_DEFS, a.species) || !exact(m,
      ['policy', 'wounds', 'nextWoundId', 'bloodLoss', 'downed', 'bedId', 'carriedBy', 'rescue']) ||
      !MEDICAL_POLICIES.includes(m.policy) || !Array.isArray(m.wounds) || m.wounds.length > ANIMAL_MEDICAL_RULES.maxWounds ||
      !integer(m.nextWoundId, 1) || !range(m.bloodLoss, 0, 1) || typeof m.downed !== 'boolean' || typeof m.rescue !== 'boolean' ||
      (m.bedId !== null && !id(m.bedId)) || (m.carriedBy !== null && !id(m.carriedBy)) ||
      (m.bedId !== null && m.carriedBy !== null)) fail('医疗字段、数量或历史身份无效');
  const maximum = ANIMAL_DEFS[a.species].health, ids = new Set<number>();
  let damage = 0;
  for (const w of m.wounds) {
    if (!exact(w, ['id', 'part', 'kind', 'severity', 'tended', 'ageTicks']) ||
        !integer(w.id, 1, m.nextWoundId - 1) || ids.has(w.id) || !animalBodyParts(a.species).includes(w.part) ||
        !['cut', 'bruise', 'burn'].includes(w.kind) || !range(w.severity, Number.MIN_VALUE, maximum) ||
        (w.tended !== null && !range(w.tended, 0, .7)) || !integer(w.ageTicks, 0, tick)) fail('伤口部位、局部身份或进度无效');
    ids.add(w.id); damage += w.severity;
  }
  if (!range(a.health, 0, maximum) || damage > maximum - a.health + 1e-6) fail('伤口总量超过原有生命缺口');
  if (a.dead && (m.downed || m.bedId !== null || m.carriedBy !== null || m.rescue)) fail('遗体仍占用医疗活动');
  if (!a.dead && m.bloodLoss >= 1) fail('活体失血已致命');
  const downed = animalMedicalSummary(a).downed;
  // Genuine old scalar damage has no wound history. Its initial downed=false
  // remains untouched until an ordinary simulation tick recomputes capacity.
  if ((m.downed && !downed) || (!m.downed && downed && (m.wounds.length > 0 || m.bloodLoss > 0 || animalEnvironmentEffects(a).downed)))
    fail('倒地与已记录伤情不符');
}

export function validateAnimalMedical(d: VoxelSave): void {
  const id = (value: unknown) => integer(value, 1, d.nextId - 1);
  if (!integer(d.nextId, 1) || !integer(d.tick) || !Array.isArray(d.animals) || !Array.isArray(d.pawns) ||
      !Array.isArray(d.animalBeds) || d.animalBeds.length > ANIMAL_MEDICAL_RULES.maxBeds) fail('时钟或医疗床列表无效');
  const beds = new Map<number, VoxelSave['animalBeds'][number]>(), cells = new Set<number>();
  const otherIds = new Set(Object.entries(d).filter(([key, value]) => key !== 'animalBeds' && Array.isArray(value))
    .flatMap(([, value]) => (value as any[]).filter(record).map(v => v.id).filter(id)));
  for (const bed of d.animalBeds) {
    if (!exact(bed, ['x', 'y', 'z', 'id']) || !id(bed.id) || beds.has(bed.id) || otherIds.has(bed.id) ||
        !inside(bed) || bed.z < 1 || bed.z >= HEIGHT - 1 || cells.has(at(bed))) fail('医疗床身份或位置无效');
    beds.set(bed.id, bed); cells.add(at(bed));
  }
  const reservedBeds = new Map<number, number>(), patients = new Set<number>(), reservedItems = new Map<number, number>();
  const reserveBed = (bedId: number, animalId: number) => {
    if (!beds.has(bedId) || (reservedBeds.has(bedId) && reservedBeds.get(bedId) !== animalId)) fail('医疗床预约冲突或缺失');
    reservedBeds.set(bedId, animalId);
  };
  for (const a of d.animals) {
    validateAnimalMedicalState(a, d.nextId, d.tick);
    const m = a.medical;
    if (m.bedId !== null) {
      reserveBed(m.bedId, a.id);
      if (!['medicalRest','downed'].includes(a.phase) || a.goal !== null || (a.faction !== 'colony' && !m.rescue)) fail('医疗床动物的休养阶段或授权无效');
    } else if (a.phase === 'medicalRest' && !d.pawns.some(p=>p.animalCareTask?.animalId===a.id&&p.animalCareTask.action!=='rescue'))
      fail('医疗休养缺少医疗床或现场护理员');
    if ((a.phase === 'carried') !== (m.carriedBy !== null) || (a.phase === 'downed' && !m.downed))
      fail('动物倒地或搬运阶段不符');
    if (m.carriedBy !== null && (a.path.length || a.goal !== null || a.mateId !== null || a.mateProgress || a.eatProgress || a.layProgress))
      fail('被搬运动物仍在自主活动');
    if (m.downed && (a.path.length || a.mateId !== null || a.mateProgress || a.eatProgress || a.layProgress)) fail('倒地动物仍在自主活动');
  }
  for (const p of d.pawns) {
    const hasTask = Object.hasOwn(p, 'animalCareTask'), task = p.animalCareTask;
    if (hasTask !== (p.phase === 'animalCare')) fail('人物动物护理阶段不符');
    if (!hasTask) continue;
    if (!exact(task, ['animalId', 'action', 'stage', 'bedId', 'sourceId', 'amount', 'progress']) ||
        !id(task.animalId) || !['rescue', 'tend', 'feed'].includes(task.action) || !['fetch', 'approach', 'carry', 'work'].includes(task.stage) ||
        (task.bedId !== null && !id(task.bedId)) || (task.sourceId !== null && !id(task.sourceId)) ||
        !integer(task.amount, 0, 100) || !range(task.progress, 0, task.action === 'feed' ? ANIMAL_MEDICAL_RULES.feedWork : ANIMAL_MEDICAL_RULES.work) ||
        task.progress >= (task.action === 'feed' ? ANIMAL_MEDICAL_RULES.feedWork : ANIMAL_MEDICAL_RULES.work) ||
        (task.stage !== 'work' && task.progress !== 0)) fail('护理任务字段或工作进度无效');
    const a = d.animals.find(a => a.id === task.animalId);
    if (!a || a.dead || a.hunt || a.slaughter || a.releaseMarked || patients.has(a.id) || (a.faction !== 'colony' && !a.medical.rescue) ||
        d.pawns.some(q => q.handleTask?.animalId === a.id || q.ropeTask?.animalId === a.id)) fail('护理患者重复、缺失或缺少救助授权');
    patients.add(a.id);
    if (p.faction !== 'colony' || p.dead || p.downed || p.drafted || healthSummary(p).manipulation <= 0 ||
        (task.action === 'tend' ? p.priorities.care <= 0 : p.priorities.care <= 0 && p.priorities.handle <= 0) ||
        p.carriedBy !== null || p.carryingPawnId !== null || p.jobId !== null || p.carePhase !== null || p.patientId !== null ||
        p.careBedId !== null || p.careFoodId !== null || p.careMedicineId !== null || p.eating !== null || p.sleepBedId !== null ||
        p.sleepingSince !== null || p.handleTask !== null || p.ropeTask !== null || p.wardenTask !== null || p.cleanTask !== null ||
        p.firefightTask !== null || p.repairTask !== null || p.weaponTask !== null || p.apparelTask !== null ||
        p.attackTargetId !== null || p.shooting !== null || p.psyche.recreation !== null || p.psyche.breakUntil > d.tick ||
        p.living.mealTask !== null || p.eggBoxTask !== undefined || p.productionDelivery !== undefined) fail('护理任务与人物其他活动冲突');
    if (task.action === 'rescue') {
      if (!['approach', 'carry'].includes(task.stage) || task.bedId === null || task.sourceId !== null ||
          task.amount !== 0 || task.progress !== 0 || p.cargo !== null || a.medical.bedId !== null)
        fail('救助阶段、床位或携带物无效');
      reserveBed(task.bedId, a.id);
      if (task.stage === 'carry' ? a.medical.carriedBy !== p.id || !same(a, p) : a.medical.carriedBy !== null)
        fail('救助携带双方不匹配');
    } else {
      if (task.stage === 'carry' || task.bedId !== null || a.medical.carriedBy !== null) fail('治疗或喂食含救助携带状态');
      if (task.action === 'tend' && (a.medical.policy === 'none' || !a.medical.wounds.some(w => w.tended === null)))
        fail('治疗策略或待处理伤口无效');
      if (task.action === 'feed' && (a.medical.bedId === null || !same(a,beds.get(a.medical.bedId)!) || a.hunger >= HUSBANDRY_RULES.wantFood))
        fail('喂食动物不在床上或无需进食');
      if (task.stage === 'fetch') {
        const item = d.items.find(i => i.id === task.sourceId);
        if (!item || p.cargo !== null || task.amount < 1 ||
            (task.action === 'tend' ? item.resource !== 'herb' || a.medical.policy !== 'herbal' || task.amount !== 1 :
              !['food', 'grain', 'meal'].includes(item.resource))) fail('护理取料源或数量无效');
        const reserved = (reservedItems.get(item.id) ?? 0) + task.amount;
        const otherReservations = d.pawns.reduce((sum,q) => sum +
          (q.careFoodId === item.id || q.careMedicineId === item.id ? q.careAmount : 0) +
          (q.handleTask?.stage === 'fetch' && q.handleTask.foodId === item.id ? q.handleTask.amount : 0) +
          (q.living.mealTask?.sourceId === item.id ? q.living.mealTask.amount : 0), 0);
        if (reserved + otherReservations > item.amount) fail('动物护理物资重复预约');
        reservedItems.set(item.id, reserved);
      } else {
        if (task.sourceId !== null || task.amount !== 0) fail('已取料任务仍引用地面物资');
        if (task.action === 'tend' ? p.cargo !== null && (p.cargo.resource !== 'herb' || !integer(p.cargo.amount,1) ||
            a.medical.policy !== 'herbal') : !p.cargo || !['food', 'grain', 'meal'].includes(p.cargo.resource) ||
            !integer(p.cargo.amount,1)) fail('护理携带实物与任务不符');
      }
      if (task.stage === 'work' && (p.z !== a.z || Math.abs(p.x - a.x) + Math.abs(p.y - a.y) !== 1 ||
          p.path.length || p.destination !== null)) fail('护理工作双方尚未相邻停下');
    }
  }
  for (const a of d.animals) if (a.medical.carriedBy !== null) {
    const p = d.pawns.find(p => p.id === a.medical.carriedBy), t = p?.animalCareTask;
    if (!p || !t || t.animalId !== a.id || t.action !== 'rescue' || t.stage !== 'carry' || !same(a, p))
      fail('被搬运动物缺少唯一对应护理员');
  }
}
