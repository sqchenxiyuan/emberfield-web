import { ANIMAL_HUSBANDRY } from './husbandry';
import { at, CELLS, HEIGHT, inside, position, type Pos, type VoxelSave } from './types';
import { PEN_RULES, initialAnimalPenState, isAnimalGroundStep, isPenMapEdge, penAcceptsAnimal } from './pens';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const exact = (v: unknown, keys: string[]): v is Record<string, any> =>
  record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const newLists = ['fences', 'fenceGates', 'penMarkers', 'animalAreas'] as const;
const animalFields = ['allowedAreaId', 'ropePaused', 'requestedPenId', 'nextRoamTick'];
function fail(reason: string): never { throw new Error('圈养存档无效：' + reason); }

/** Original input only, before any historical migration can initialize a new
 * animal using current defaults. A legacy version cannot hide v30 actions. */
export function rejectLegacyPensFields(old: Record<string, any>, sourceVersion = old.version): void {
  if (sourceVersion >= 30) return;
  if (newLists.some(k => Object.hasOwn(old, k)) ||
      list(old.animals).some(a => record(a) && (animalFields.some(k => Object.hasOwn(a, k)) ||
        a.phase === 'rope' || ['area', 'exit'].includes(a.goal?.kind))) ||
      list(old.pawns).some(p => record(p) && (Object.hasOwn(p, 'ropeTask') || p.phase === 'rope')) ||
      list(old.jobs).some(j => record(j) && ['fence', 'fenceGate', 'penMarker'].includes(j.kind)))
    fail('旧版本包含新版围栏、区域或牵引字段');
}
export function migratePens(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 30) return;
  if (!Array.isArray(old.animals) || !Array.isArray(old.pawns) || !integer(old.tick) ||
      old.animals.some(a => !record(a)) || old.pawns.some(p => !record(p))) fail('旧人物或动物列表无效');
  const defaults = initialAnimalPenState(old.tick);
  for (const a of old.animals) Object.assign(a, defaults);
  for (const p of old.pawns) p.ropeTask = null;
  for (const key of newLists) old[key] = [];
}

/** No terrain-derived cells or enclosure flags are trusted or stored. This
 * validates identities, shapes and each physical paired step. The world then
 * recomputes topology and cancels routes invalidated by current geometry. */
export function validatePens(d: VoxelSave): void {
  if (!integer(d.tick) || !integer(d.nextId, 1) || !Array.isArray(d.animals) || !Array.isArray(d.pawns) ||
      !newLists.every(k => Array.isArray(d[k])) || d.fences.length > PEN_RULES.maxFences ||
      d.fenceGates.length > PEN_RULES.maxGates || d.penMarkers.length > PEN_RULES.maxMarkers || d.animalAreas.length > PEN_RULES.maxAreas)
    fail('时钟或圈养列表无效');
  const identity = (v: unknown) => integer(v, 1, d.nextId - 1);
  const ids = new Set<number>();
  for (const [key, value] of Object.entries(d)) if (!(newLists as readonly string[]).includes(key))
    for (const entry of list(value)) if (record(entry) && identity(entry.id)) ids.add(entry.id);
  const cells = new Set<number>();
  const claim = (v: unknown, keys: string[], physical: boolean) => {
    if (!exact(v, keys) || !identity(v.id) || ids.has(v.id)) fail('建筑或区域身份重复、字段无效');
    ids.add(v.id);
    if (physical) {
      if (!inside(v as Pos) || v.z < 1 || v.z >= HEIGHT - 1 || cells.has(at(v as Pos))) fail('圈养建筑位置重复或无效');
      cells.add(at(v as Pos));
    }
  };
  for (const f of d.fences) claim(f, ['id', 'x', 'y', 'z'], true);
  for (const g of d.fenceGates) {
    claim(g, ['id', 'x', 'y', 'z', 'axis', 'mode', 'openUntil'], true);
    if (!['x', 'y'].includes(g.axis) || !['auto', 'open', 'locked'].includes(g.mode) || !integer(g.openUntil)) fail('栏门状态无效');
  }
  const validName = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= PEN_RULES.maxNameLength;
  for (const m of d.penMarkers) {
    claim(m, ['id', 'x', 'y', 'z', 'name', 'filter'], true);
    if (!validName(m.name) || !exact(m.filter, ['deer', 'dromedary', 'male', 'female']) ||
        ![m.filter.deer, m.filter.dromedary, m.filter.male, m.filter.female].every(v => typeof v === 'boolean')) fail('圈地名称或过滤器无效');
  }
  for (const a of d.animalAreas) {
    claim(a, ['id', 'name', 'color', 'cells'], false);
    if (!validName(a.name) || !integer(a.color, 0, 0xffffff) || !Array.isArray(a.cells) ||
        a.cells.length > PEN_RULES.maxAreaCells || a.cells.some(n => !integer(n, 0, CELLS - 1)) ||
        new Set(a.cells).size !== a.cells.length) fail('动物区域颜色、格子或范围无效');
  }
  // Existing door anchors cannot also host a fence, gate or marker. Other
  // multi-cell furniture and terrain geometry are checked by the world loader.
  if (list(d.doors).some(door => record(door) && inside(door as Pos) && cells.has(at(door as Pos)))) fail('圈养建筑与现有门重叠');
  const areas = new Map(d.animalAreas.map(a => [a.id, a]));
  const markers = new Map(d.penMarkers.map(p => [p.id, p]));
  const animals = new Map(d.animals.map(a => [a.id, a]));
  for (const a of d.animals) {
    if (!animalFields.every(k => Object.hasOwn(a, k)) || typeof a.ropePaused !== 'boolean' || !integer(a.nextRoamTick) ||
        (a.allowedAreaId !== null && (!identity(a.allowedAreaId) || !areas.has(a.allowedAreaId) || a.species !== 'hare' || a.faction !== 'colony')) ||
        (a.requestedPenId !== null && (!identity(a.requestedPenId) || !markers.has(a.requestedPenId) || !ANIMAL_HUSBANDRY[a.species].penAnimal || a.faction !== 'colony')))
      fail('动物圈养归属、区域或漫游时钟无效');
    if (a.goal?.kind === 'area' && (a.dead || a.allowedAreaId === null || a.goal.id !== a.allowedAreaId)) fail('返区目标与分配不符');
    if (a.goal?.kind === 'exit' && (a.dead || a.faction !== 'colony' || !ANIMAL_HUSBANDRY[a.species].penAnimal ||
        !integer(a.goal.id, 0, CELLS - 1) || !isPenMapEdge(position(a.goal.id)))) fail('漫游离图目标无效');
  }
  const reserved = new Set<number>(), attached = new Set<number>();
  for (const p of d.pawns) {
    if (!Object.hasOwn(p, 'ropeTask') || ((p.ropeTask !== null) !== (p.phase === 'rope'))) fail('人物牵引阶段不符');
    const task = p.ropeTask;
    if (task === null) continue;
    if (!exact(task, ['animalId', 'penId', 'stage', 'progress', 'path']) || !identity(task.animalId) || !identity(task.penId) ||
        !['approach', 'attach', 'lead', 'detach'].includes(task.stage) || !integer(task.progress) ||
        !Array.isArray(task.path) || task.path.length > PEN_RULES.maxRopePath || task.path.some(n => !integer(n, 0, CELLS - 1)) ||
        (task.stage !== 'lead' && task.path.length !== 0) ||
        (task.stage === 'attach' ? task.progress >= PEN_RULES.attachWork :
          task.stage === 'detach' ? task.progress >= PEN_RULES.detachWork : task.progress !== 0)) fail('牵引任务字段或进度无效');
    const a = animals.get(task.animalId), marker = markers.get(task.penId);
    if (!a || !marker || !penAcceptsAnimal(marker, a) || a.ropePaused ||
        (a.requestedPenId !== null && a.requestedPenId !== marker.id) || reserved.has(a.id) ||
        a.tame || a.hunt || a.slaughter || a.releaseMarked || d.pawns.some(q => q.handleTask?.animalId === a.id))
      fail('牵引目标归属、过滤器或预约不符');
    reserved.add(a.id);
    if (p.faction !== 'colony' || p.dead || p.downed || p.drafted || p.priorities.handle <= 0 ||
        p.carriedBy !== null || p.carryingPawnId !== null || p.handleTask !== null || p.cargo !== null || p.jobId !== null ||
        p.carePhase !== null || p.patientId !== null || p.eating !== null || p.sleepBedId !== null || p.sleepingSince !== null ||
        p.wardenTask !== null || p.cleanTask !== null || p.firefightTask !== null || p.repairTask !== null ||
        p.weaponTask !== null || p.apparelTask !== null || p.attackTargetId !== null || p.shooting !== null ||
        p.psyche.recreation !== null || p.psyche.breakUntil > d.tick || !Array.isArray(p.path)) fail('牵引工作与人物活动冲突');
    if (task.stage === 'approach') {
      if (a.phase === 'rope') fail('尚未挂绳却已锁住动物');
      continue;
    }
    if (a.phase !== 'rope' || p.path.length !== 0 || p.destination !== null || !isAnimalGroundStep(a, p) ||
        (task.stage === 'attach' && a.z !== p.z) || a.path.length !== 0 || a.goal !== null ||
        a.mateId !== null || a.mateProgress !== 0 || a.eatProgress !== 0) fail('挂绳双方位置或活动无效');
    attached.add(a.id);
    let animalCell = at(a), handlerCell = at(p);
    for (const next of task.path) {
      if (next === animalCell || !isAnimalGroundStep(position(handlerCell), position(next))) fail('牵引路径含穿模交换、跳跃或爬梯');
      animalCell = handlerCell; handlerCell = next;
    }
  }
  for (const a of d.animals) if ((a.phase === 'rope') !== attached.has(a.id)) fail('动物绳索缺少对应驯养员');
}
