import { at, HEIGHT, inside, type Pos, type Stack } from './types';
import { isShelfKind, shelfAllows, shelfCells, validStorageSettings, SHELF_STACKS } from './shelves';

const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, any> => record(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
function fail(reason: string): never { throw new Error('货架仓储存档无效：' + reason); }
export function rejectLegacyShelves(d: Record<string, any>, version: number) {
  if (version >= 37) return;
  const cargo = [...list(d.items), ...list(d.pawns).map(p => p?.cargo), ...list(d.jobs).flatMap(j => list(j?.deliveredBatches))];
  if (['shelves', 'storageSpills'].some(k => Object.hasOwn(d, k)) ||
      list(d.jobs).some(j => isShelfKind(j?.kind) || isShelfKind(j?.furnitureKind)) ||
      list(d.fireDamage).some(f => isShelfKind(f?.kind)) || cargo.some(b => isShelfKind(b?.furniture?.kind)))
    fail('旧版本包含新版货架或散货字段');
}
export function migrateShelves(d: Record<string, any>, version: number) {
  if (version < 37) { d.shelves = []; d.storageSpills = []; }
}
/** World.load additionally validates support, overlap with other buildings and
 * interaction geometry. Filters govern new intake, not existing stack validity. */
export function validateShelves(d: Record<string, any>, checkCapacity = true) {
  if (!Array.isArray(d.shelves) || d.shelves.length > 256 || !Array.isArray(d.storageSpills) ||
      d.storageSpills.length > 4096 || !Array.isArray(d.items)) fail('列表无效');
  const identity = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) < d.nextId;
  const occupied = new Set<number>(), shelfIds = new Set<number>();
  for (const s of d.shelves) {
    if (!exact(s, ['id','kind','x','y','z','axis','settings']) || !identity(s.id) || shelfIds.has(s.id) ||
        !isShelfKind(s.kind) || !['x','y'].includes(s.axis) || !validStorageSettings(s.settings)) fail('身份、朝向或共享设置无效');
    shelfIds.add(s.id);
    for (const cell of shelfCells(s as any)) {
      if (!inside(cell) || cell.z < 1 || cell.z >= HEIGHT - 1 || occupied.has(at(cell))) fail('占地重叠或越界');
      occupied.add(at(cell));
    }
  }
  const spills = new Set<number>();
  for (const spill of d.storageSpills) {
    if (!exact(spill, ['x','y','z','shelfId','reason']) || !inside(spill as Pos) || spill.z < 1 || spill.z >= HEIGHT - 1 ||
        !identity(spill.shelfId) || shelfIds.has(spill.shelfId) || spill.reason !== 'destroyedShelf' ||
        occupied.has(at(spill as Pos)) || spills.has(at(spill as Pos))) fail('应急散货来源或位置无效');
    spills.add(at(spill as Pos));
  }
  if (!checkCapacity) return;
  const counts = new Map<number, number>();
  for (const item of d.items) {
    if (!inside(item)) fail('物品格无效');
    if (occupied.has(at(item)) && !shelfAllows(item as Stack)) fail('货架不能承载此物品');
    counts.set(at(item), (counts.get(at(item)) ?? 0) + 1);
  }
  for (const [cell, count] of counts)
    if (count > (occupied.has(cell) || spills.has(cell) ? SHELF_STACKS : 1)) fail('物品堆超过物理槽数');
  for (const cell of spills) if ((counts.get(cell) ?? 0) < 2) fail('无需容量例外的散货记录');
}
