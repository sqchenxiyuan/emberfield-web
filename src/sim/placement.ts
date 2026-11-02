import { BUILDINGS, RESOURCES, TECHS } from './defs';
import { SIZE, type BuildingKind, type Resource, type World } from './types';

export interface BuildPreview {
  kind: BuildingKind;
  cells: { x: number; y: number; valid: boolean; reason: string }[];
  cost: Partial<Record<Resource, number>>;
  missing: Partial<Record<Resource, number>>;
  ok: boolean;
  reason: string;
  warnings: string[];
}

/** Dragging walls/conduits snaps to the dominant axis, never an implicit filled rectangle. */
export function buildCells(kind: BuildingKind, x: number, y: number, x2 = x, y2 = y) {
  if (![x, y, x2, y2].every(Number.isInteger)) return [];
  if (![x, y, x2, y2].every((v) => v >= 0 && v < SIZE)) return [];
  if (kind !== 'wall' && kind !== 'wire') return [{ x: x2, y: y2 }];
  const horizontal = Math.abs(x2 - x) >= Math.abs(y2 - y);
  const length = horizontal ? Math.abs(x2 - x) : Math.abs(y2 - y);
  return Array.from({ length: length + 1 }, (_, i) => ({
    x: x + (horizontal ? Math.sign(x2 - x) * i : 0),
    y: y + (horizontal ? 0 : Math.sign(y2 - y) * i),
  }));
}

function exterior(blocked: Uint8Array) {
  const seen = new Uint8Array(SIZE * SIZE), queue = new Int32Array(SIZE * SIZE);
  let end = 0;
  const add = (i: number) => { if (!blocked[i] && !seen[i]) { seen[i] = 1; queue[end++] = i; } };
  for (let i = 0; i < SIZE; i++) {
    add(i); add((SIZE - 1) * SIZE + i); add(i * SIZE); add(i * SIZE + SIZE - 1);
  }
  for (let head = 0; head < end; head++) {
    const i = queue[head], x = i % SIZE, y = Math.floor(i / SIZE);
    if (x > 0) add(i - 1); if (x < SIZE - 1) add(i + 1);
    if (y > 0) add(i - SIZE); if (y < SIZE - 1) add(i + SIZE);
  }
  return seen;
}

export function planBuild(w: World, kind: BuildingKind, x: number, y: number, x2 = x, y2 = y): BuildPreview {
  const d = BUILDINGS[kind], cells = buildCells(kind, x, y, x2, y2).map((c) => ({ ...c, valid: true, reason: '' }));
  const result: BuildPreview = { kind, cells, cost: {}, missing: {}, ok: false, reason: '', warnings: [] };
  if (!d || !cells.length) { result.reason = '超出地图范围或未知建筑'; return result; }
  const locked = d.tech && (w.research[d.tech] ?? 0) < TECHS[d.tech].cost;
  for (const c of cells) {
    if (locked) c.reason = '需要先完成对应研究';
    else if (c.x < 1 || c.y < 1 || c.x + d.w >= SIZE || c.y + d.h >= SIZE) c.reason = '超出地图范围';
    else for (let yy = c.y; yy < c.y + d.h; yy++) for (let xx = c.x; xx < c.x + d.w; xx++) {
      if (w.terrain[yy * SIZE + xx] === 2) c.reason = '无法在深水中建造';
      if (w.buildings.some((b) => {
        const bd = BUILDINGS[b.kind];
        return xx >= b.x && xx < b.x + bd.w && yy >= b.y && yy < b.y + bd.h &&
          ((b.kind !== 'wire' && kind !== 'wire') || (b.kind === 'wire' && kind === 'wire'));
      })) c.reason = kind === 'wire' ? '这里已有导线' : '建筑占地重叠';
      if (d.solid && w.pawns.some((p) => !p.dead && Math.round(p.x) === xx && Math.round(p.y) === yy)) c.reason = '有角色占用，请等其离开';
    }
    c.valid = !c.reason;
  }
  if (kind === 'wall' && cells.every((c) => c.valid)) {
    // Advisory only: intentional enclosures are valid plans. Doors remain passable.
    const blocked = Uint8Array.from(w.terrain, (t) => t === 2 ? 1 : 0);
    for (const b of w.buildings) if (BUILDINGS[b.kind].solid) {
      const bd = BUILDINGS[b.kind];
      for (let yy = b.y; yy < b.y + bd.h; yy++) for (let xx = b.x; xx < b.x + bd.w; xx++) blocked[yy * SIZE + xx] = 1;
    }
    const before = exterior(blocked);
    for (const c of cells) blocked[c.y * SIZE + c.x] = 1;
    const after = exterior(blocked);
    if (before.some((v, i) => v && !blocked[i] && !after[i])) {
      result.warnings.push('这段墙会封闭通路，建议预留门口或放置门；仍可规划。');
    }
  }
  for (const r of RESOURCES) {
    const cost = (d.cost[r] ?? 0) * cells.length;
    if (!cost) continue;
    result.cost[r] = cost;
    const available = w.items.filter((i) => i.kind === r).reduce((s, i) => s + i.count - i.reserved, 0);
    if (cost > available) result.missing[r] = cost - available;
  }
  result.ok = cells.every((c) => c.valid);
  result.reason = result.ok ? `可规划 ${cells.length} 格${Object.keys(result.missing).length ? ' · 材料不足，蓝图将等待供应' : ''}` : cells.find((c) => !c.valid)!.reason;
  return result;
}
