import { isRelocatableKind, isShelfKind, shelfCells, type RelocatableKind } from './shelves';
import { validFurniturePiece } from './relocation';
import { bedCells, HEIGHT, inside, type FurniturePiece } from './types';
import { tableCells } from './living';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const owns = (v: unknown, key: string) => record(v) && Object.hasOwn(v, key);
const relocation = (j: any) => j?.kind === 'install' || j?.kind === 'uninstall';
function fail(message: string): never { throw new Error('家具搬装存档无效：' + message); }
function batches(d: Record<string, any>): any[] {
  return [...list(d.items), ...list(d.pawns).map(p => p?.cargo),
    ...list(d.jobs).flatMap(j => [...list(j?.deliveredBatches), ...list(j?.deliveredFood)])];
}
const ledgers = (d: Record<string, any>) =>
  ['produced', 'consumed', 'spoiled', 'destroyed'].map(k => d.stats?.[k]).concat([d.trade?.imported, d.trade?.exported]);

/** Call on untouched source data, before any historic migration can add current
 * ledger keys. Merely relabeling new data as an old save must never erase it. */
export function rejectLegacyRelocationFields(old: Record<string, any>, sourceVersion = old.version): void {
  if (sourceVersion >= 34) return;
  const containers = [...batches(old), ...list(old.trade?.caravans).flatMap(c => list(c?.stock)),
    ...list(old.trade?.receipts).flatMap(r => list(r?.transferred).map(t => t?.batch))];
  if (containers.some(b => b?.resource === 'furniture' || owns(b, 'furniture')) ||
      list(old.jobs).some(j => relocation(j) || owns(j, 'furnitureId') || owns(j, 'furnitureKind') ||
        owns(j?.cost, 'furniture') || owns(j?.delivered, 'furniture')) ||
      ledgers(old).some(v => owns(v, 'furniture')) || list(old.stockpiles).some(s => list(s?.accepts).includes('furniture')))
    fail('旧版本包含新版打包家具、搬装任务或账本字段');
}
/** Run after all older migrations. Existing furniture, damage and jobs remain
 * byte-for-byte values; only the six newly extended resource ledgers gain zero. */
export function migrateRelocation(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 34) return;
  const targets = ledgers(old);
  if (targets.some(v => !record(v) || (owns(v, 'furniture') && v.furniture !== 0)))
    fail('旧资源账本无效');
  for (const ledger of targets) ledger.furniture = 0;
}

/** Validate the inner identity across every live physical container. Orders
 * reference that identity but do not own another copy; receipt history is not
 * inventory. Geometry, routes and ordinary job fields stay with world.load. */
export function validateRelocation(d: Record<string, any>): void {
  if (!Number.isSafeInteger(d.nextId) || d.nextId <= 0 || !Array.isArray(d.items) ||
      !Array.isArray(d.pawns) || !Array.isArray(d.jobs)) fail('实体列表或编号无效');
  const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v < d.nextId;
  const liveIds = new Set<number>();
  const entityLists = ['fires', 'filth', 'pawns', 'animals', 'butcherSpots', 'tables', 'chairs', 'horseshoePins',
    'items', 'trees', 'jobs', 'crops', 'stoves', 'stonecutters', 'tailors', 'weaponBenches', 'researchBenches',
    'beds', 'doors', 'fences', 'fenceGates', 'penMarkers', 'devices', 'sandbags', 'projectiles', 'animalAreas', 'shelves', 'storageGroups'];
  for (const key of entityLists) for (const e of list(d[key])) if (id(e?.id)) liveIds.add(e.id);
  const containers = batches(d);
  for (const b of containers) for (const piece of [b?.apparel, b?.weapon]) if (id(piece?.id)) liveIds.add(piece.id);
  for (const p of d.pawns) for (const piece of [...list(p?.worn), p?.weapon]) if (id(piece?.id)) liveIds.add(piece.id);
  for (const c of list(d.trade?.caravans)) {
    if (id(c?.id)) liveIds.add(c.id);
    for (const stock of list(c?.stock)) {
      if (stock?.resource === 'furniture' || owns(stock, 'furniture')) fail('本版本不支持家具贸易');
      for (const value of [stock, stock?.apparel, stock?.weapon]) if (id(value?.id)) liveIds.add(value.id);
    }
  }
  if (id(d.trade?.session?.id)) liveIds.add(d.trade.session.id);
  for (const receipt of list(d.trade?.receipts)) {
    if (id(receipt?.id)) liveIds.add(receipt.id);
    if (list(receipt?.transferred).some(t => t?.batch?.resource === 'furniture' || owns(t?.batch, 'furniture')))
      fail('本版本不支持家具贸易');
  }
  const packed = new Map<number, FurniturePiece>();
  for (const b of containers) {
    if (!record(b)) continue;
    if (b.resource !== 'furniture') { if (owns(b, 'furniture')) fail('非家具货物包含家具实例'); continue; }
    if (b.amount !== 1 || !validFurniturePiece(b.furniture) || !id(b.furniture.id) ||
        (b.furniture.kind === 'bed' && b.furniture.owner !== null && !id(b.furniture.owner)) ||
        liveIds.has(b.furniture.id) || packed.has(b.furniture.id) || owns(b, 'hitPoints'))
      fail('家具实例重复、身份或耐久无效');
    packed.set(b.furniture.id, b.furniture);
  }
  const installed = new Map<number, RelocatableKind>();
  const buildings = new Map<number, any>();
  for (const [key, kind] of [['beds', 'bed'], ['tables', 'table'], ['chairs', 'chair']] as const)
    for (const item of list(d[key])) { installed.set(item.id, kind); buildings.set(item.id, item); }
  for (const shelf of list(d.shelves)) { installed.set(shelf.id, shelf.kind); buildings.set(shelf.id, shelf); }
  for (const [kind, limit] of [['bed', 128], ['table', 128], ['chair', 256]] as const)
    if ([...installed.values()].filter(k => k === kind).length + [...packed.values()].filter(p => p.kind === kind).length > limit)
      fail('安装及打包家具总量超过上限');
  if ([...installed.values()].filter(isShelfKind).length + [...packed.values()].filter(p=>isShelfKind(p.kind)).length +
      d.jobs.filter((j:any)=>isShelfKind(j.kind)&&!j.cancelled).length > 256) fail('安装、打包及规划货架总量超过上限');
  for (const spill of list(d.storageSpills)) if (liveIds.has(spill.shelfId) || packed.has(spill.shelfId)) fail('散货来源身份已被占用');
  const orders = new Set<string>();
  for (const j of d.jobs) {
    if (!relocation(j)) {
      if (owns(j, 'furnitureId') || owns(j, 'furnitureKind') || owns(j?.cost, 'furniture') ||
          owns(j?.delivered, 'furniture') || list(j?.deliveredBatches).some(b => b?.resource === 'furniture'))
        fail('非搬装任务包含家具');
      continue;
    }
    if (!id(j.furnitureId) || !isRelocatableKind(j.furnitureKind) || !record(j.cost) ||
        !record(j.delivered) || !Array.isArray(j.deliveredBatches) || !['x', 'y'].includes(j.axis))
      fail('搬装任务身份或材料形状无效');
    if (![j.x, j.y, j.z].every(Number.isSafeInteger)) fail('搬装位置无效');
    const cells = isShelfKind(j.furnitureKind) ? shelfCells({ ...j, kind: j.furnitureKind }) :
      j.furnitureKind === 'bed' ? bedCells(j) : j.furnitureKind === 'table' ? tableCells(j) : [j];
    if (cells.some(p => !inside(p) || p.z < 1 || p.z + 1 >= HEIGHT)) fail('搬装占地超出世界');
    const key = `${j.kind}:${j.furnitureId}`;
    if (orders.has(key)) fail('同一家具重复搬装任务');
    orders.add(key);
    if (j.kind === 'uninstall') {
      const original = buildings.get(j.furnitureId);
      if (Object.keys(j.cost).length || Object.keys(j.delivered).length || j.deliveredBatches.length ||
          (!j.cancelled && installed.get(j.furnitureId) !== j.furnitureKind)) fail('卸下任务目标或材料无效');
      if (!j.cancelled && (!original || ['x', 'y', 'z', 'axis'].some(k => original[k] !== j[k])))
        fail('卸下任务位置或朝向与原家具不匹配');
    } else {
      if (Object.keys(j.cost).length !== 1 || j.cost.furniture !== 1 ||
          Object.keys(j.delivered).some(k => k !== 'furniture') || ![0, 1].includes(j.delivered.furniture ?? 0) ||
          j.deliveredBatches.length !== (j.delivered.furniture ?? 0) || j.deliveredBatches.some((b: any) =>
            b?.resource !== 'furniture' || b.furniture?.id !== j.furnitureId || b.furniture?.kind !== j.furnitureKind))
        fail('重装任务配送实例不匹配');
      const actual = installed.get(j.furnitureId) ?? packed.get(j.furnitureId)?.kind;
      if ((!j.cancelled || j.deliveredBatches.length) && actual !== j.furnitureKind) fail('重装任务引用的家具不存在');
    }
  }
  for (const ledger of ledgers(d)) if (!record(ledger) || !Number.isSafeInteger(ledger.furniture) || ledger.furniture < 0)
    fail('家具资源账本无效');
  if (d.stats.spoiled.furniture !== 0 || d.trade.imported.furniture !== 0 || d.trade.exported.furniture !== 0)
    fail('家具不可腐坏或交易');
}
