import { describe, expect, it } from 'vitest';
import { at, CELLS, index, type Resource, type Stockpile } from '../src/voxel/types';
import { createStockpileZone, expandStockpileZone, migrateStockpileZones, reconcileStockpileZones,
  renameStockpileZone, stockpileZoneAt, stockpileZoneViews, validateStockpileZones,
  validStockpileZoneId, type StockpileZoneHost } from '../src/voxel/stockpileZones';

const cell = (x: number, y = 12, z = 8) => index(x, y, z);
const stock = (x: number, y = 12, z = 8, accepts: Resource[] = ['wood'], priority = 1): Stockpile =>
  ({ x, y, z, accepts, priority });
function state(stockpiles = [stock(10), stock(11), stock(12)]): StockpileZoneHost {
  return { stockpiles, stockpileZones: migrateStockpileZones(stockpiles), nextId: 100 };
}

describe('persistent stockpile geometry identity', () => {
  it('migrates only same-floor cardinal components with equal filter sets, independently of input order', () => {
    const input = [stock(12), stock(11, 12, 8, ['steel', 'wood']), stock(10, 12, 8, ['wood', 'steel']),
      stock(13, 12, 8, ['wood'], 3), stock(12, 13), stock(13, 14), stock(10, 12, 9),
      stock(63, 1), stock(0, 2)];
    const before = structuredClone(input), zones = migrateStockpileZones(input);
    expect(input).toEqual(before);
    expect(migrateStockpileZones([...input].reverse().map(s => ({ ...s, accepts: [...s.accepts].reverse() })))).toEqual(zones);
    expect(zones.map(z => z.cells)).toEqual([
      [cell(63, 1)], [cell(0, 2)], [cell(10), cell(11)], [cell(12), cell(12, 13)],
      [cell(13)], [cell(13, 14)], [cell(10, 12, 9)],
    ]);
    expect(zones.every(z => z.id === `legacy-zone:${z.cells[0]}`)).toBe(true);
    expect(() => validateStockpileZones(zones, input, 1)).not.toThrow();
  });

  it('keeps surviving identity and name after a middle deletion, anchor deletion and filter edits', () => {
    const s = state(), id = s.stockpileZones[0].id;
    expect(renameStockpileZone(s, id, '原料仓').ok).toBe(true);
    s.stockpiles = s.stockpiles.filter(p => p.x !== 11);
    s.stockpiles[1].accepts = ['steel']; s.stockpiles[1].priority = 3;
    reconcileStockpileZones(s);
    expect(s.stockpileZones).toEqual([{ id, name: '原料仓', cells: [cell(10), cell(12)] }]);
    expect(() => validateStockpileZones(s.stockpileZones, s.stockpiles, s.nextId)).not.toThrow();
    s.stockpiles = s.stockpiles.filter(p => p.x !== 10);
    reconcileStockpileZones(s);
    expect(s.stockpileZones).toEqual([{ id, name: '原料仓', cells: [cell(12)] }]);
    expect(s.nextId).toBe(100);
    expect(s.stockpiles[0]).toEqual(stock(12, 12, 8, ['steel'], 3));
    s.stockpiles = []; reconcileStockpileZones(s);
    expect(s.stockpileZones).toEqual([]);
  });

  it('fills unowned cells without merging or stealing an adjacent existing zone', () => {
    const s = state([stock(10)]), original = structuredClone(s.stockpileZones[0]);
    s.stockpiles.push(stock(11), stock(12));
    const before = structuredClone(s.stockpiles);
    reconcileStockpileZones(s);
    expect(s.stockpileZones[0]).toEqual(original);
    expect(s.stockpileZones[1]).toMatchObject({ id: `legacy-zone:${cell(11)}`, cells: [cell(11), cell(12)] });
    expect(s.stockpiles).toEqual(before); expect(s.nextId).toBe(100);
    const once = structuredClone(s); reconcileStockpileZones(s); expect(s).toEqual(once);
  });

  it.each([false, true])('allocates a fresh global ID when an old legacy anchor is reused (old zone emptied: %s)', empty => {
    const s = state([stock(10), stock(11)]), oldId = s.stockpileZones[0].id;
    s.stockpiles = [stock(11)]; reconcileStockpileZones(s);
    s.stockpiles = empty ? [stock(10)] : [stock(10), stock(11)];
    reconcileStockpileZones(s);
    expect(s.stockpileZones.find(z => z.id === oldId)?.cells).toEqual(empty ? undefined : [cell(11)]);
    expect(s.stockpileZones.find(z => z.id === 'zone:100')?.cells).toEqual([cell(10)]);
    expect(s.nextId).toBe(101);
    expect(() => validateStockpileZones(s.stockpileZones, s.stockpiles, s.nextId)).not.toThrow();
  });
});

describe('explicit stockpile zone commands', () => {
  it('creates distinct adjacent zones, expands the selected identity and exposes independent views', () => {
    const s: StockpileZoneHost = { stockpiles: [stock(10), stock(11), stock(12)], stockpileZones: [], nextId: 200 };
    const beforeCells = structuredClone(s.stockpiles);
    expect(createStockpileZone(s, [cell(10)], ' 木料仓 ')).toMatchObject({ ok: true, zoneId: 'zone:200', count: 1 });
    expect(createStockpileZone(s, [cell(11)], '金属仓')).toMatchObject({ ok: true, zoneId: 'zone:201' });
    expect(expandStockpileZone(s, 'zone:200', [cell(12), cell(10)])).toMatchObject({ ok: true, count: 1 });
    expect(expandStockpileZone(s, 'zone:200', [cell(12)])).toMatchObject({ ok: true, count: 0 });
    reconcileStockpileZones(s);
    expect(s.nextId).toBe(202); expect(s.stockpileZones).toHaveLength(2);
    expect(stockpileZoneAt(s.stockpileZones, cell(12))?.id).toBe('zone:200');
    expect(stockpileZoneAt(s.stockpileZones, cell(13))).toBeUndefined();
    expect(s.stockpiles).toEqual(beforeCells);
    const views = stockpileZoneViews(s);
    expect(views[0]).toEqual({ id: 'zone:200', name: '木料仓', cells: [cell(10), cell(12)],
      z: 8, anchor: { x: 10, y: 12, z: 8 }, cellCount: 2 });
    views[0].cells.pop(); views[0].anchor.x++;
    expect(s.stockpileZones[0].cells).toEqual([cell(10), cell(12)]);
    expect(stockpileZoneViews(s)[0].anchor.x).toBe(10);
    expect(() => validateStockpileZones(s.stockpileZones, s.stockpiles, s.nextId)).not.toThrow();
  });

  it('rejects invalid creation and expansion atomically, including another zone and a different floor', () => {
    const s = state([stock(10), stock(12), stock(10, 12, 9)]);
    s.stockpiles.push(stock(11));
    const first = s.stockpileZones[0].id, second = s.stockpileZones[1].id;
    const attempts = [
      () => createStockpileZone(s, [cell(10)]),
      () => createStockpileZone(s, [cell(11), cell(11)]),
      () => createStockpileZone(s, [cell(11)], '\n无效'),
      () => createStockpileZone(s, [cell(11)], 'x'.repeat(41)),
      () => createStockpileZone(s, [cell(50)]),
      () => createStockpileZone(s, []),
      () => createStockpileZone(s, [NaN]),
      () => expandStockpileZone(s, first, [cell(11), cell(12)]),
      () => expandStockpileZone(s, first, [cell(10, 12, 9)]),
      () => expandStockpileZone(s, 'zone:999', [cell(11)]),
      () => renameStockpileZone(s, second, '  '),
      () => renameStockpileZone(s, 'zone:999', '失效'),
    ];
    for (const attempt of attempts) {
      const before = structuredClone(s);
      expect(attempt().ok).toBe(false); expect(s).toEqual(before);
    }
  });
});

describe('strict saved stockpile membership', () => {
  const corruptions: [string, (s: any) => void][] = [
    ['missing list', s => { delete s.stockpileZones; }],
    ['extra zone field', s => { s.stockpileZones[0].extra = true; }],
    ['missing name', s => { delete s.stockpileZones[0].name; }],
    ['untrimmed name', s => { s.stockpileZones[0].name = ' 仓库 '; }],
    ['empty name', s => { s.stockpileZones[0].name = ''; }],
    ['invalid id', s => { s.stockpileZones[0].id = 'legacy-zone:01'; }],
    ['future id', s => { s.stockpileZones[0].id = `zone:${s.nextId}`; }],
    ['duplicate id', s => { s.stockpileZones.push({ ...s.stockpileZones[0], cells: [cell(20)] }); }],
    ['duplicate cell', s => { s.stockpileZones[0].cells.push(s.stockpileZones[0].cells[0]); }],
    ['shared membership', s => { s.stockpileZones.push({ id: 'zone:1', name: '重复', cells: [cell(10)] }); }],
    ['empty zone', s => { s.stockpileZones[0].cells = []; }],
    ['unowned cell', s => { s.stockpileZones[0].cells.pop(); }],
    ['absent physical cell', s => { s.stockpileZones[0].cells.push(cell(20)); }],
    ['cross floor', s => { s.stockpiles.push(stock(10, 12, 9)); s.stockpileZones[0].cells.push(cell(10, 12, 9)); }],
    ['fractional cell', s => { s.stockpileZones[0].cells[0] += .5; }],
    ['boolean cell', s => { s.stockpileZones[0].cells[0] = true; }],
    ['outside map', s => { s.stockpileZones[0].cells[0] = CELLS; }],
    ['sparse membership', s => { delete s.stockpileZones[0].cells[0]; }],
    ['duplicate stockpile', s => { s.stockpiles.push(structuredClone(s.stockpiles[0])); }],
    ['fractional nextId', s => { s.nextId += .5; }],
  ];
  it.each(corruptions)('rejects %s without normalizing input', (_name, corrupt) => {
    const s = state(); corrupt(s); const before = structuredClone(s);
    expect(() => validateStockpileZones(s.stockpileZones, s.stockpiles, s.nextId)).toThrow(/仓储区存档无效/);
    expect(s).toEqual(before);
  });
  it('validates disconnected mixed-rule zones without requiring their historical anchor to still exist', () => {
    const s = state([stock(12), stock(20, 12, 8, ['meal'], 3)]);
    s.stockpileZones = [{ id: `legacy-zone:${cell(10)}`, name: '被分割的旧仓', cells: s.stockpiles.map(at) }];
    expect(() => validateStockpileZones(s.stockpileZones, s.stockpiles, s.nextId)).not.toThrow();
    expect(validStockpileZoneId('zone:99', 100)).toBe(true);
    expect(validStockpileZoneId('zone:100', 100)).toBe(false);
    expect(validStockpileZoneId(`legacy-zone:${CELLS}`, 100)).toBe(false);
    expect(() => validateStockpileZones([], [], 1)).not.toThrow();
  });
});
