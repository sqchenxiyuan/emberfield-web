import { at, type Pawn, type Pos, type VoxelSave } from './types';
import type { AnimalArea } from './pens';

const cache = new WeakMap<AnimalArea, { source: number[]; cells: Set<number> }>();
export function allowedAreaCells(area: AnimalArea): ReadonlySet<number> {
  let entry = cache.get(area);
  if (!entry || entry.source !== area.cells) {
    entry = { source: area.cells, cells: new Set(area.cells) };
    cache.set(area, entry);
  }
  return entry.cells;
}

/** Areas filter destinations. They never remove physical navigation edges. */
export function effectivePawnArea(p: Pawn, areas: AnimalArea[], tick: number): AnimalArea | undefined {
  // Equip/Wear are direct player orders in this prototype. Native orders use
  // playerForced/ignoreForbidden; ordinary prioritized work still checks areas.
  if (p.faction !== 'colony' || p.drafted || p.psyche.breakUntil > tick || p.allowedAreaId === null ||
      p.weaponTask?.action === 'equip' || p.apparelTask?.action === 'wear') return;
  const area = areas.find(a => a.id === p.allowedAreaId);
  return area?.cells.length ? area : undefined;
}
export function pawnAreaAllows(p: Pawn, target: Pos, areas: AnimalArea[], tick: number): boolean {
  const area = effectivePawnArea(p, areas, tick);
  return !area || allowedAreaCells(area).has(at(target));
}

/** Assignment identity survives an empty mask; deleting its definition clears it. */
export function validatePawnAreas(save: VoxelSave): void {
  for (const p of save.pawns) {
    if (p.allowedAreaId !== null && (!Number.isSafeInteger(p.allowedAreaId) ||
        !save.animalAreas.some(a => a.id === p.allowedAreaId)))
      throw new Error('居民允许区域引用无效');
    if (p.faction !== 'colony' && p.allowedAreaId !== null)
      throw new Error('非居民不能分配居民允许区域');
  }
}
