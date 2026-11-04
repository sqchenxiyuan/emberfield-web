import { at, CELLS, DEPTH, inside, position, RESOURCE_NAMES, WIDTH,
  type CommandResult, type Pos, type Stockpile } from './types';

/** Geometry identity only. The existing cells continue to own their filters and
 * priorities, so a named Web zone can contain different storage rules. */
export interface StockpileZone { id: string; name: string; cells: number[] }
export interface StockpileZoneHost {
  stockpiles: Stockpile[];
  stockpileZones: StockpileZone[];
  nextId: number;
}
export interface StockpileZoneView extends StockpileZone {
  z: number;
  anchor: Pos;
  cellCount: number;
}
export type StockpileZoneResult = CommandResult & { zoneId?: string };
export const MAX_STOCKPILE_CELLS = 4096;
export const MAX_STOCKPILE_ZONES = MAX_STOCKPILE_CELLS;
const layerSize = WIDTH * DEPTH;
const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validName = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 &&
  v.trim().length <= 40 && !/[\u0000-\u001f\u007f]/.test(v);
function fail(why: string): never { throw new Error('仓储区存档无效：' + why); }
const reject = (message: string): StockpileZoneResult => ({ ok: false, message });

/** Legacy identities do not consume the entity counter or change old item IDs.
 * Their original anchor is a name, not a cell that must remain in the zone. */
export function validStockpileZoneId(id: unknown, nextId: number): id is string {
  if (typeof id !== 'string' || !integer(nextId, 1)) return false;
  const legacy = /^legacy-zone:(0|[1-9]\d*)$/.exec(id);
  if (legacy) return integer(Number(legacy[1]), 0, CELLS - 1);
  const created = /^zone:([1-9]\d*)$/.exec(id);
  return !!created && integer(Number(created[1]), 1, nextId - 1);
}

function stockByCell(stockpiles: readonly Stockpile[]): Map<number, Stockpile> {
  if (!Array.isArray(stockpiles) || stockpiles.length > MAX_STOCKPILE_CELLS) fail('仓储格列表无效');
  const result = new Map<number, Stockpile>();
  const entries: readonly Stockpile[] = stockpiles;
  for (const s of entries) {
    if (!inside(s) || !integer(s.priority, 0, 3) || !Array.isArray(s.accepts) ||
        new Set(s.accepts).size !== s.accepts.length ||
        !Array.from(s.accepts).every(r => typeof r === 'string' && Object.hasOwn(RESOURCE_NAMES, r)) || result.has(at(s)))
      fail('仓储格位置重复或收纳规则无效');
    result.set(at(s), s);
  }
  return result;
}

function checkedRecords(raw: unknown, nextId: number): asserts raw is StockpileZone[] {
  if (!integer(nextId, 1) || !Array.isArray(raw) || raw.length > MAX_STOCKPILE_ZONES) fail('区域列表或身份上界无效');
  const ids = new Set<string>(), claimed = new Set<number>();
  for (const zone of raw) {
    if (!record(zone) || Object.keys(zone).length !== 3 || !['id', 'name', 'cells'].every(k => Object.hasOwn(zone, k)) ||
        !validStockpileZoneId(zone.id, nextId) || ids.has(zone.id) ||
        !validName(zone.name) || zone.name !== zone.name.trim() || !Array.isArray(zone.cells) ||
        !zone.cells.length || zone.cells.length > MAX_STOCKPILE_CELLS) fail('区域身份、名称或成员列表无效');
    ids.add(zone.id);
    let layer: number | undefined;
    for (const cell of zone.cells) {
      if (!integer(cell, 0, CELLS - 1) || claimed.has(cell)) fail('仓储格被重复划分或超出地图');
      const z = Math.floor(cell / layerSize);
      if (layer !== undefined && layer !== z) fail('单个仓储区不能跨层');
      layer = z;
      claimed.add(cell);
    }
  }
}

/** Exact current-save validation. Reconciliation is never a repair pass for
 * malformed saves: each physical stockpile cell must have exactly one owner. */
export function validateStockpileZones(
  raw: unknown, stockpiles: readonly Stockpile[], nextId: number,
): asserts raw is StockpileZone[] {
  checkedRecords(raw, nextId);
  const stock = stockByCell(stockpiles), claimed = new Set<number>();
  for (const zone of raw) for (const cell of zone.cells) {
    if (!stock.has(cell)) fail('区域引用了不存在的仓储格');
    claimed.add(cell);
  }
  if (claimed.size !== stock.size) fail('存在没有归属区域的仓储格');
}

const rulesKey = (stock: Stockpile) => `${stock.priority}:${[...stock.accepts].sort().join(',')}`;
function historicalComponents(stock: Map<number, Stockpile>): StockpileZone[] {
  const remaining = new Set([...stock.keys()].sort((a, b) => a - b)), result: StockpileZone[] = [];
  for (const seed of [...remaining]) {
    if (!remaining.delete(seed)) continue;
    const cells = [seed], rule = rulesKey(stock.get(seed)!);
    for (let n = 0; n < cells.length; n++) {
      const p = position(cells[n]);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const q = { x: p.x + dx, y: p.y + dy, z: p.z };
        if (!inside(q)) continue;
        const cell = at(q), next = stock.get(cell);
        if (remaining.has(cell) && next && rulesKey(next) === rule) {
          remaining.delete(cell); cells.push(cell);
        }
      }
    }
    cells.sort((a, b) => a - b);
    result.push({ id: `legacy-zone:${seed}`, name: `仓储区 ${result.length + 1}`, cells });
  }
  return result;
}

/** Deterministic same-floor, cardinal components with equal rule sets. Input
 * order and filter order do not change identities; the source is untouched. */
export function migrateStockpileZones(stockpiles: readonly Stockpile[]): StockpileZone[] {
  return historicalComponents(stockByCell(stockpiles));
}

/** After committed runtime geometry edits, preserve surviving identities even
 * when a zone becomes disconnected. Unowned test/legacy cells receive zones;
 * they never steal membership from an existing zone. */
export function reconcileStockpileZones(host: StockpileZoneHost): void {
  checkedRecords(host.stockpileZones, host.nextId);
  const stock = stockByCell(host.stockpiles), unowned = new Map(stock);
  // Reserve even IDs of zones removed in this pass, to avoid retargeting a bill
  // before its caller has handled the removal of that particular destination.
  const ids = new Set(host.stockpileZones.map(zone => zone.id));
  const zones = host.stockpileZones.map(zone => ({ ...zone, cells: zone.cells.filter(cell => stock.has(cell)) }))
    .filter(zone => zone.cells.length);
  for (const zone of zones) for (const cell of zone.cells) unowned.delete(cell);
  let nextId = host.nextId;
  for (const added of historicalComponents(unowned)) {
    if (ids.has(added.id)) {
      if (!integer(nextId + 1, 1)) fail('区域身份计数已达上限');
      added.id = `zone:${nextId++}`;
    }
    added.name = `仓储区 ${zones.length + 1}`;
    ids.add(added.id); zones.push(added);
  }
  validateStockpileZones(zones, host.stockpiles, nextId);
  host.stockpileZones = zones;
  host.nextId = nextId;
}

function candidateCells(host: StockpileZoneHost, raw: readonly number[]): number[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_STOCKPILE_CELLS || new Set(raw).size !== raw.length ||
      !Array.from(raw).every(cell => integer(cell, 0, CELLS - 1))) return null;
  const stock = stockByCell(host.stockpiles);
  const cells = [...raw].sort((a, b) => a - b), z = Math.floor(cells[0] / layerSize);
  return cells.every(cell => stock.has(cell) && Math.floor(cell / layerSize) === z) ? cells : null;
}

/** The caller stages physical geometry first. These commands change only the
 * registry and commit nothing on failure; they never move items or change rules. */
export function createStockpileZone(
  host: StockpileZoneHost, rawCells: readonly number[], name?: string,
): StockpileZoneResult {
  const label = name ?? `仓储区 ${host.stockpileZones.length + 1}`;
  if (!validName(label)) return reject('仓储区名称需要 1 到 40 个字符，且不能包含控制字符');
  if (!integer(host.nextId, 1) || !integer(host.nextId + 1, 1) || host.stockpileZones.length >= MAX_STOCKPILE_ZONES)
    return reject('仓储区数量或身份计数已达上限');
  const cells = candidateCells(host, rawCells);
  if (!cells || cells.some(cell => stockpileZoneAt(host.stockpileZones, cell)))
    return reject('新仓储区只能使用同层、未归属其他区域的现有仓储格');
  const id = `zone:${host.nextId}`;
  if (host.stockpileZones.some(zone => zone.id === id)) return reject('仓储区身份已被使用');
  host.stockpileZones = [...host.stockpileZones, { id, name: label.trim(), cells }];
  host.nextId++;
  return { ok: true, zoneId: id, count: cells.length, message: `已创建 ${cells.length} 格仓储区` };
}

export function expandStockpileZone(
  host: StockpileZoneHost, zoneId: string, rawCells: readonly number[],
): StockpileZoneResult {
  const zone = host.stockpileZones.find(value => value.id === zoneId);
  if (!zone) return reject('指定仓储区不存在');
  const cells = candidateCells(host, rawCells);
  if (!cells || Math.floor(cells[0] / layerSize) !== Math.floor(zone.cells[0] / layerSize) ||
      cells.some(cell => { const owner = stockpileZoneAt(host.stockpileZones, cell); return owner && owner.id !== zoneId; }))
    return reject('扩展只能加入同层、未归属其他区域的仓储格');
  const added = cells.filter(cell => !zone.cells.includes(cell));
  if (zone.cells.length + added.length > MAX_STOCKPILE_CELLS) return reject('仓储区格数已达上限');
  host.stockpileZones = host.stockpileZones.map(value => value.id === zoneId
    ? { ...value, cells: [...value.cells, ...added].sort((a, b) => a - b) } : value);
  return { ok: true, zoneId, count: added.length, message: `已扩展 ${added.length} 格仓储区` };
}

export function renameStockpileZone(host: StockpileZoneHost, zoneId: string, name: string): StockpileZoneResult {
  if (!host.stockpileZones.some(zone => zone.id === zoneId)) return reject('指定仓储区不存在');
  if (!validName(name)) return reject('仓储区名称需要 1 到 40 个字符，且不能包含控制字符');
  host.stockpileZones = host.stockpileZones.map(zone => zone.id === zoneId ? { ...zone, name: name.trim() } : zone);
  return { ok: true, zoneId, message: '仓储区已重命名' };
}

export function stockpileZoneAt(zones: readonly StockpileZone[], cell: number): StockpileZone | undefined {
  return zones.find(zone => zone.cells.includes(cell));
}

/** Returned cell arrays are owned by the view; selection UI cannot mutate the
 * simulation. The anchor is only a camera focus, never destination identity. */
export function stockpileZoneViews(host: Pick<StockpileZoneHost, 'stockpileZones'>): StockpileZoneView[] {
  return host.stockpileZones.map(zone => {
    const cells = [...zone.cells].sort((a, b) => a - b), anchor = position(cells[0]);
    return { ...zone, cells, z: anchor.z, anchor, cellCount: cells.length };
  });
}
