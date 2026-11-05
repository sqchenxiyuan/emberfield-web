import { at, HEIGHT, inside, type Pos, type Resource } from './types';
import { NUTRITION } from './farming';
import { carryLimit } from './logistics';
import { LIVING_MEMORY_VALUES, LIVING_RULES, initialLiving, tableCells } from './living';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const exact = (v: unknown, keys: string[]): v is Record<string, any> =>
  record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const newLists = ['tables', 'chairs'] as const;
const buildingKinds = ['table', 'chair'];
const food = (resource: unknown): resource is Resource => typeof resource === 'string' &&
  Object.hasOwn(NUTRITION, resource) && !!NUTRITION[resource as Resource];
function fail(reason: string): never { throw new Error('居住存档无效：' + reason); }

/** Run against untouched source input before older migrations initialize a pawn
 * with current defaults. Version relabelling must not erase current actions. */
export function rejectLegacyLivingFields(old: Record<string, any>, sourceVersion = old.version): void {
  if (sourceVersion >= 31) return;
  if ([...newLists, 'diningTables', 'diningChairs'].some(k => Object.hasOwn(old, k)) ||
      list(old.pawns).some(p => record(p) && (Object.hasOwn(p, 'living') || p.phase === 'dine')) ||
      list(old.jobs).some(j => record(j) && buildingKinds.includes(j.kind)) ||
      list(old.fireDamage).some(v => record(v) && buildingKinds.includes(v.kind)))
    fail('旧版本包含新版餐桌、座椅或居住字段');
}
export function migrateLiving(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 31) return;
  if (!integer(old.tick) || !Array.isArray(old.pawns) || old.pawns.some(p => !record(p)))
    fail('旧人物或时钟无效');
  for (const p of old.pawns) p.living = initialLiving();
  for (const key of newLists) old[key] = [];
}

/** Validate owned field shapes, entity IDs, references, mutually exclusive
 * activities and ground-food reservations. World owns physical terrain, routes,
 * seat/table adjacency and current pawn positioning reconciliation. */
export function validateLiving(d: Record<string, any>): void {
  if (!integer(d.tick) || !integer(d.nextId, 1) || !Array.isArray(d.pawns) || !Array.isArray(d.items) ||
      ['diningTables', 'diningChairs'].some(k => Object.hasOwn(d, k)) ||
      !newLists.every(k => Array.isArray(d[k])) || d.tables.length > LIVING_RULES.maxTables ||
      d.chairs.length > LIVING_RULES.maxChairs) fail('时钟或家具列表无效');
  const identity = (v: unknown) => integer(v, 1, d.nextId - 1);
  const ids = new Set<number>();
  for (const [key, value] of Object.entries(d)) if (!(newLists as readonly string[]).includes(key))
    for (const v of list(value)) if (record(v) && identity(v.id)) ids.add(v.id);
  const occupied = new Set<number>();
  const claim = (v: unknown, table: boolean) => {
    if (!exact(v, table ? ['id', 'x', 'y', 'z', 'axis', 'gathering', 'quality'] : ['id', 'x', 'y', 'z', 'axis', 'quality']) || !identity(v.id) || ids.has(v.id) ||
        !['x', 'y'].includes(v.axis) || (table && typeof v.gathering !== 'boolean')) fail('家具身份重复或字段无效');
    ids.add(v.id);
    const cells = table ? tableCells(v as any) : [v as Pos];
    for (const cell of cells) {
      if (!inside(cell) || cell.z < 1 || cell.z >= HEIGHT - 1 || occupied.has(at(cell))) fail('家具范围重叠或越界');
      occupied.add(at(cell));
    }
  };
  for (const table of d.tables) claim(table, true);
  for (const chair of d.chairs) claim(chair, false);
  const tables = new Map<number, any>(d.tables.map((t: any) => [t.id, t]));
  const chairs = new Map<number, any>(d.chairs.map((c: any) => [c.id, c]));
  const items = new Map<number, any>(d.items.filter(record).map((i: any) => [i.id, i]));
  const reservedChairs = new Set<number>(), reservedGround = new Map<number, number>();
  // Care and animal handling reserve these same physical edible stacks. Their
  // own validators establish task legality; availability must sum all users,
  // matching world.availableStack rather than allowing one allowance per AI.
  const reserveOtherFood = (id: unknown, amount: unknown) => {
    if (identity(id) && integer(amount, 1) && food(items.get(id)?.resource))
      reservedGround.set(id, (reservedGround.get(id) ?? 0) + amount);
  };
  for (const p of d.pawns) if (record(p)) {
    reserveOtherFood(p.careFoodId, p.careAmount);
    if (p.handleTask?.stage === 'fetch') reserveOtherFood(p.handleTask.foodId, p.handleTask.amount);
    if (p.animalCareTask?.stage === 'fetch') reserveOtherFood(p.animalCareTask.sourceId, p.animalCareTask.amount);
    if (p.prisonFoodTask?.stage === 'fetch') reserveOtherFood(p.prisonFoodTask.sourceId, p.prisonFoodTask.amount);
  }
  for (const p of d.pawns) {
    if (!record(p) || !exact(p.living, ['comfort', 'mealTask', 'memories', 'sleepThoughtAt'])) fail('人物居住字段缺失或多余');
    const state = p.living;
    if (!finite(state.comfort, 0, 100) ||
        (state.sleepThoughtAt !== null && !integer(state.sleepThoughtAt, 0, d.tick + LIVING_RULES.sleepThoughtInterval)) ||
        !Array.isArray(state.memories) || state.memories.length > 3 ||
        new Set(state.memories.map((m: any) => m?.kind)).size !== state.memories.length)
      fail('舒适度、睡眠时钟或记忆列表无效');
    for (const memory of state.memories) {
      if (!exact(memory, ['kind', 'stage', 'expires']) || !Object.hasOwn(LIVING_MEMORY_VALUES, memory.kind) ||
          !integer(memory.stage, 0, memory.kind === 'ateWithoutTable' ? 0 : 9) ||
          LIVING_MEMORY_VALUES[memory.kind as keyof typeof LIVING_MEMORY_VALUES][memory.stage] === null ||
          !integer(memory.expires, 0, d.tick + LIVING_RULES.memoryDuration)) fail('居住记忆档位或期限无效');
    }
    if (state.memories.some((m: any) => m.kind === 'bedroom') && state.memories.some((m: any) => m.kind === 'barracks'))
      fail('卧室与宿舍记忆不能同时存在');
    if ((state.mealTask !== null) !== (p.phase === 'dine')) fail('用餐任务与人物阶段不符');
    const task = state.mealTask;
    if (task === null) continue;
    if (!exact(task, ['stage', 'chairId', 'tableId', 'target', 'progress', 'sourceId', 'amount']) ||
        !['travel', 'chew'].includes(task.stage) || !exact(task.target, ['x', 'y', 'z']) ||
        !inside(task.target as Pos) || task.target.z < 1 || task.target.z >= HEIGHT - 1 ||
        !finite(task.progress, 0, LIVING_RULES.chewTicks) || task.progress >= LIVING_RULES.chewTicks ||
        (task.stage === 'travel' && task.progress !== 0) ||
        !integer(task.amount, 1) || !food(p.eating) || task.amount > carryLimit(p.eating) ||
        (task.sourceId !== null && !identity(task.sourceId)) ||
        (task.chairId !== null && task.tableId === null) ||
        (task.chairId !== null && (!identity(task.chairId) || !chairs.has(task.chairId) || reservedChairs.has(task.chairId))) ||
        (task.tableId !== null && (!identity(task.tableId) || !tables.has(task.tableId)))) fail('用餐任务字段、进度或座位引用无效');
    if (task.chairId !== null) {
      const chair = chairs.get(task.chairId), table = tables.get(task.tableId);
      if (at(chair) !== at(task.target as Pos) || !tableCells(table).some(cell => cell.z === task.target.z &&
          Math.abs(cell.x - task.target.x) + Math.abs(cell.y - task.target.y) === 1))
        fail('座位目标没有紧邻餐桌');
      reservedChairs.add(task.chairId);
    }
    if (!['colony', 'prisoner'].includes(p.faction) || p.dead || p.downed || p.drafted || p.carriedBy !== null ||
        p.carryingPawnId !== null || p.jobId !== null || p.carePhase !== null || p.patientId !== null ||
        p.sleepingSince !== null || p.sleepBedId !== null || p.ropeTask !== null || p.handleTask !== null ||
        p.wardenTask !== null || p.cleanTask !== null || p.firefightTask !== null || p.repairTask !== null ||
        p.weaponTask !== null || p.apparelTask !== null || p.attackTargetId !== null || p.shooting !== null ||
        p.prisonFoodTask !== undefined || p.animalCareTask !== undefined || p.eggBoxTask !== undefined || p.productionDelivery !== undefined ||
        !record(p.psyche) || p.psyche.recreation !== null || p.psyche.breakUntil > d.tick || !Array.isArray(p.path) ||
        (task.stage === 'chew' && (p.path.length !== 0 || p.destination !== null))) fail('用餐与人物其他活动冲突');
    if (task.sourceId === null) {
      if (!record(p.cargo) || p.cargo.resource !== p.eating || !food(p.cargo.resource) ||
          !integer(p.cargo.amount, task.amount)) fail('用餐随身食物不足或不符');
    } else {
      const source = items.get(task.sourceId);
      if (!source || source.resource !== p.eating || !food(source.resource) || !integer(source.amount, task.amount) ||
          !record(p.cargo) || food(p.cargo.resource) || task.stage !== 'chew' || task.chairId !== null)
        fail('原地用餐食物、货物或阶段无效');
      const reserved = (reservedGround.get(task.sourceId) ?? 0) + task.amount;
      if (reserved > source.amount) fail('原地用餐、护理或驯养重复预约超出食物数量');
      reservedGround.set(task.sourceId, reserved);
    }
  }
  for (const [id, amount] of reservedGround) if (amount > items.get(id)!.amount)
    fail('原地用餐、护理或驯养重复预约超出食物数量');
}
