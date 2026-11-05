import { WOOL_RULES, woolReady } from './animalWool';
import { MILK_RULES, milkReady } from './animalMilk';
import { at, CELLS, HEIGHT, WIDTH, DEPTH, inside, position, type Pos, type VoxelSave, type WildAnimal } from './types';
import { HUSBANDRY_RULES, ANIMAL_HUSBANDRY, initialAnimalState, animalFeedAmount, isAnimalAdult } from './husbandry';
import { animalCanEatResource } from './animalTraining';
import { initialSkills, validSkills } from './skills';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const fraction = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const exact = (v: unknown, keys: string[]): v is Record<string, any> =>
  record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const ANIMAL_FIELDS = ['faction', 'sex', 'ageTicks', 'growth', 'tame', 'slaughter', 'releaseMarked',
  'malnutrition', 'pregnancy', 'mateId', 'mateProgress', 'nextMateTick', 'tameness',
  'nextTamenessDecayTick', 'nextInteractionTick', 'path', 'goal', 'eatProgress', 'reason'];
function fail(reason: string): never { throw new Error('驯养存档无效：' + reason); }

/** Local biological shape also applies to historical trade snapshots. References
 * to currently living actors and structures are checked by the world validator. */
export function validateAnimalHusbandryShape(a: WildAnimal, nextId: number): void {
  const id = (v: unknown) => integer(v, 1, nextId - 1);
  if (!record(a) || !id(a.id) || !Object.hasOwn(ANIMAL_HUSBANDRY, a.species) ||
      !ANIMAL_FIELDS.every(k => Object.hasOwn(a, k)) || !['wild', 'colony', 'trader'].includes(a.faction) ||
      !['male', 'female'].includes(a.sex) || !integer(a.ageTicks) || !fraction(a.growth) ||
      !fraction(a.malnutrition) || !integer(a.tameness, 0, HUSBANDRY_RULES.tamenessMax) ||
      ![a.tame, a.slaughter, a.releaseMarked].every(v => typeof v === 'boolean') ||
      !integer(a.nextMateTick) || !integer(a.nextInteractionTick) || !integer(a.nextTamenessDecayTick) ||
      !integer(a.mateProgress, 0, HUSBANDRY_RULES.mateWork - 1) ||
      !integer(a.eatProgress, 0, HUSBANDRY_RULES.eatWork - 1) ||
      typeof a.reason !== 'string' || a.reason.length > 500 ||
      !Array.isArray(a.path) || a.path.length > CELLS || a.path.some(n => !integer(n, 0, CELLS - 1)) ||
      new Set(a.path).size !== a.path.length) fail('动物字段、进度或路径无效');
  if ([a.tame, a.slaughter, a.releaseMarked, a.hunt].filter(Boolean).length > 1 ||
      (a.faction === 'wild' ? a.slaughter || a.releaseMarked || a.tameness !== 0 : a.tame || a.hunt || a.tameness < 1) ||
      (a.faction === 'trader' && (a.slaughter || a.releaseMarked))) fail('动物归属与标记不符');
  if (a.dead && (a.pregnancy !== null || a.mateId !== null || a.goal !== null || a.path.length ||
      a.eatProgress || a.mateProgress || a.tame || a.slaughter || a.releaseMarked)) fail('尸体仍含活动');
  let previous: Pos = a;
  for (const cell of a.path) {
    const next = position(cell);
    if (Math.abs(next.x - previous.x) + Math.abs(next.y - previous.y) !== 1 || Math.abs(next.z - previous.z) > 1)
      fail('动物路径包含跳跃或垂直爬梯');
    previous = next;
  }
  if (a.pregnancy !== null && (!exact(a.pregnancy, ['fatherId', 'progress']) || !id(a.pregnancy.fatherId) ||
      a.pregnancy.fatherId === a.id || !fraction(a.pregnancy.progress) || a.sex !== 'female' ||
      !isAnimalAdult(a) || a.dead)) fail('怀孕字段或母体无效');
  if (a.goal !== null && (!exact(a.goal, ['kind', 'id']) ||
      !['grass', 'crop', 'food', 'mate', 'area', 'exit', 'layEgg', 'layEggBox', 'caravan', 'shelter', 'climateExit'].includes(a.goal.kind) ||
      (['grass', 'exit', 'layEgg', 'shelter', 'climateExit'].includes(a.goal.kind) ? !integer(a.goal.id, 0, CELLS - 1) : !id(a.goal.id))))
    fail('动物目标无效');
  if ((a.phase === 'shelter') !== ['shelter', 'climateExit'].includes(a.goal?.kind ?? '') ||
      (a.phase === 'shelter' && (a.medical.downed || a.medical.carriedBy !== null || a.medical.bedId !== null ||
        a.mateId !== null || a.mateProgress || a.eatProgress || a.layProgress ||
        (a.path.length && a.path.at(-1) !== a.goal!.id))) ||
      (a.goal?.kind === 'climateExit' && (a.faction !== 'wild' ||
        ![0, WIDTH - 1].includes(position(a.goal.id).x) && ![0, DEPTH - 1].includes(position(a.goal.id).y))))
    fail('动物环境避险阶段或路径无效');
  if (a.path.length && a.goal === null && !a.work && !(a.phase === 'medicalRest' && a.medical?.bedId !== null && a.medical?.bedId !== undefined))
    fail('动物路径缺少目标');
}

/** Must inspect the original source before older migrations add current defaults. */
export function rejectLegacyHusbandryFields(old: Record<string, any>, sourceVersion = old.version): void {
  if (sourceVersion >= 29) return;
  if (Object.hasOwn(old, 'grass') || Object.hasOwn(old, 'husbandryLog') ||
      list(old.animals).some(a => record(a) && (ANIMAL_FIELDS.some(k => Object.hasOwn(a, k)) ||
        ['eat', 'mate', 'interact'].includes(a.phase))) ||
      list(old.pawns).some(p => record(p) && (Object.hasOwn(p, 'handleTask') || p.phase === 'handle' ||
        Object.hasOwn(p.priorities ?? {}, 'handle') || Object.hasOwn(p.skills ?? {}, 'animals'))))
    fail('旧版本包含新版动物、驯养或草地字段');
}

/** Original physical state, timers and human skill progress remain untouched.
 * Earlier migrations may have called today's initialSkills; that is why the
 * anti-smuggling guard is separate and is never rerun against migrated data. */
export function migrateHusbandry(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 29) return;
  if (!Array.isArray(old.animals) || !Array.isArray(old.pawns) || !integer(old.tick) ||
      old.pawns.some(p => !record(p) || !record(p.priorities) || !record(p.skills)))
    fail('旧动物或人物数据缺失');
  const states = old.animals.map(a => {
    if (!record(a) || !integer(a.id, 1) || !Object.hasOwn(ANIMAL_HUSBANDRY, a.species)) fail('旧动物身份无效');
    return initialAnimalState(a.id, a.species, old.tick);
  });
  const skills = old.pawns.map((p, i) => {
    const animals = Object.hasOwn(p.skills, 'animals') ? p.skills.animals : initialSkills(i, p.faction !== 'colony').animals;
    if (!validSkills({ ...initialSkills(0), animals })) fail('旧迁移产生了无效驯养技能');
    return animals;
  });
  old.animals.forEach((a, i) => Object.assign(a, states[i]));
  old.pawns.forEach((p, i) => {
    p.handleTask = null; p.priorities.handle = p.faction === 'colony' ? 2 : 0;
    p.skills.animals = skills[i];
  });
  // The world seeds terrain-valid grass exactly once after a legacy load.
  old.grass = []; old.husbandryLog = [];
}

/** Schema and cross-entity checks, without consulting terrain or consuming RNG.
 * Resource goals may become stale later in a tick; the AI resolves them on its
 * next update. Father and event IDs are historical and need not remain alive. */
export function validateHusbandry(d: VoxelSave): void {
  if (!integer(d.tick) || !integer(d.nextId, 1) || !Array.isArray(d.animals) ||
      d.animals.length > HUSBANDRY_RULES.maxAnimals || !Array.isArray(d.pawns) ||
      !Array.isArray(d.items) || !Array.isArray(d.grass) || d.grass.length > HUSBANDRY_RULES.maxGrass ||
      !Array.isArray(d.husbandryLog) || d.husbandryLog.length > HUSBANDRY_RULES.maxLog)
    fail('时钟或列表无效');
  const id = (v: unknown) => integer(v, 1, d.nextId - 1);
  const animalById = new Map(d.animals.map(a => [a?.id, a]));
  const nonAnimalIds = new Set(Object.entries(d).filter(([key, value]) => key !== 'animals' && Array.isArray(value))
    .flatMap(([, value]) => list(value).filter(record).map(v => v.id).filter(v => id(v))));
  const mates = new Set<number>();
  if (animalById.size !== d.animals.length) fail('动物身份重复');
  for (const a of d.animals) {
    validateAnimalHusbandryShape(a, d.nextId);
    if (nonAnimalIds.has(a.id)) fail('动物身份与现有对象重复');
    if (a.pregnancy !== null) {
      if (nonAnimalIds.has(a.pregnancy.fatherId)) fail('怀孕字段或母体无效');
      const father = animalById.get(a.pregnancy.fatherId);
      if (father && (father.sex !== 'male' || father.species !== a.species)) fail('父代身份不符');
    }
    if (a.mateId !== null) {
      const mate = animalById.get(a.mateId);
      if (!id(a.mateId) || !mate || mate === a || mates.has(a.mateId) || a.sex !== 'male' || mate.sex !== 'female' || a.faction !== 'colony' ||
          a.species !== mate.species || !isAnimalAdult(a) || !isAnimalAdult(mate) || a.dead || mate.dead ||
          a.goal?.kind !== 'mate' || a.goal.id !== a.mateId) fail('配偶引用无效');
      mates.add(a.mateId);
    } else if (a.mateProgress !== 0 || a.goal?.kind === 'mate') fail('交配进度缺少配偶');
    if (a.eatProgress > 0 && (!a.goal || !['grass','crop','food'].includes(a.goal.kind))) fail('进食进度缺少食物目标');
  }
  const grassCells = new Set<number>();
  for (const g of d.grass) {
    if (!exact(g, ['x', 'y', 'z', 'growth']) || !inside(g) || g.z < 1 || g.z >= HEIGHT - 1 ||
        !fraction(g.growth) || grassCells.has(at(g))) fail('草地位置、数量或生长值无效');
    grassCells.add(at(g));
  }
  let previousTick = -1;
  for (const e of d.husbandryLog) {
    if (!exact(e, ['tick', 'kind', 'animalId', 'otherId', 'message']) || !integer(e.tick, previousTick, d.tick) ||
        !['training', 'tame', 'failed', 'fed', 'pregnancy', 'birth', 'miscarriage', 'rewild', 'slaughter', 'release', 'starved', 'escaped', 'milked', 'milkFailed', 'sheared', 'shearFailed', 'fertilized', 'laidEgg', 'hatched'].includes(e.kind) ||
        !id(e.animalId) || (e.otherId !== null && !id(e.otherId)) || typeof e.message !== 'string' || e.message.length > 500)
      fail('动物事件记录无效');
    previousTick = e.tick;
  }
  const targets = new Set<number>(), reservedFood = new Map<number, number>();
  for (const p of d.pawns) {
    if (!record(p) || !Object.hasOwn(p, 'handleTask') || !record(p.priorities) ||
        !integer(p.priorities.handle, 0, 4) || !validSkills(p.skills) ||
        (p.faction !== 'colony' && p.priorities.handle !== 0) ||
        ((p.handleTask !== null) !== (p.phase === 'handle'))) fail('人物驯养字段或阶段无效');
    const t = p.handleTask;
    if (t === null) continue;
    if (!exact(t, ['animalId', 'action', 'stage', 'foodId', 'amount', 'feedings', 'progress']) ||
        !id(t.animalId) || !['tame', 'maintain', 'feed', 'slaughter', 'autoSlaughter', 'release', 'milk', 'shear'].includes(t.action) ||
        !['fetch', 'approach', 'interact'].includes(t.stage) || !integer(t.amount, 0, 100) ||
        !integer(t.feedings, 0, HUSBANDRY_RULES.feedings - 1) ||
        !(['milk','shear'].includes(t.action) ? Number.isFinite(t.progress) && t.progress >= 0 && t.progress <= (t.action === 'milk' ? MILK_RULES.work : WOOL_RULES.work) :
          integer(t.progress, 0, (['slaughter', 'autoSlaughter', 'release'].includes(t.action) ? HUSBANDRY_RULES.slaughterWork : HUSBANDRY_RULES.handleWork) - 1)) ||
        (t.stage !== 'interact' && t.progress !== 0) ||
        p.faction !== 'colony' || p.dead || p.downed || p.drafted || !p.priorities.handle ||
        p.carriedBy !== null || p.carryingPawnId !== null || p.jobId !== null || p.carePhase !== null || p.patientId !== null ||
        p.eating !== null || p.sleepBedId !== null || p.sleepingSince !== null || p.wardenTask !== null ||
        p.cleanTask !== null || p.firefightTask !== null || p.repairTask !== null || p.weaponTask !== null ||
        p.apparelTask !== null || p.attackTargetId !== null || p.shooting !== null || !Array.isArray(p.path) ||
        p.psyche?.recreation !== null || p.psyche.breakUntil > d.tick) fail('驯养任务或工作条件无效');
    const a = animalById.get(t.animalId);
    if (!a || a.dead || targets.has(a.id) ||
        (t.action === 'tame' ? a.faction !== 'wild' || !a.tame : a.faction !== 'colony') ||
        (t.action === 'slaughter' && !a.slaughter) || (t.action === 'release' && !a.releaseMarked) ||
        (t.action === 'maintain' && !ANIMAL_HUSBANDRY[a.species].tamenessDecays) ||
        (t.action === 'shear' && (!woolReady(a) || d.tick < a.nextInteractionTick)) ||
        (t.action === 'milk' && (!milkReady(a) || d.tick < a.nextInteractionTick)) ||
        (['tame', 'maintain'].includes(t.action) && p.skills.animals.level < ANIMAL_HUSBANDRY[a.species].minSkill))
      fail('照料目标或预约无效');
    targets.add(a.id);
    if (t.stage === 'interact' && (p.z !== a.z || Math.abs(p.x - a.x) + Math.abs(p.y - a.y) !== 1 ||
        p.path.length !== 0 || p.destination !== null)) fail('照料双方尚未相邻停下');
    const foodAction = ['tame', 'maintain', 'feed'].includes(t.action);
    if (!foodAction) {
      if (t.stage === 'fetch' || t.foodId !== null || t.amount !== 0 || t.feedings !== 0 || p.cargo !== null)
        fail('无饲料任务含取食或携带状态');
      continue;
    }
    const source = t.stage === 'fetch' ? d.items.find(i => i.id === t.foodId) : p.cargo;
    if (!source || !integer(source.amount, 1) || !animalCanEatResource(a.species, source.resource) ||
        (t.action !== 'feed' && source.resource !== 'grain') || (t.action === 'feed' && t.feedings !== 0))
      fail('照料食物或喂食次数无效');
    const portion = animalFeedAmount(a.species, source.resource);
    if (t.amount !== portion * (t.action === 'feed' ? 1 : HUSBANDRY_RULES.feedings)) fail('照料食物数量不符');
    if (t.stage === 'fetch') {
      if (!id(t.foodId) || p.cargo !== null || t.feedings !== 0) fail('取食阶段引用无效');
      const total = (reservedFood.get(t.foodId!) ?? 0) + t.amount;
      if (total > source.amount) fail('饲料预约超过实物');
      reservedFood.set(t.foodId!, total);
    } else if (t.foodId !== null || source.amount !== t.amount - t.feedings * portion) fail('携带饲料与已喂次数不符');
  }
}
