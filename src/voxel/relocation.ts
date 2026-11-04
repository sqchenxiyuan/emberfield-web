import { furnitureStats, isFurnitureKind, isFurnitureQuality, type FurnitureKind } from './furniture';
import type { DiningChair, DiningTable } from './living';
import type { Axis, Bed, FurniturePiece, Pos } from './types';
import { isShelfKind, isRelocatableKind, SHELF_DEFS, validStorageSettings, type RelocatableKind, type Shelf } from './shelves';

/** Native uninstall work 200 at ConstructionSpeed * 1.7, converted from 60 to
 * 20 TPS, is approximately 40. Installation has no native work delay here;
 * one tick is the Web transaction scheduler's minimum, not a quality roll. */
export const RELOCATION_RULES = Object.freeze({ uninstallWork: 40, installWork: 1 });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const identity = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v < 10000000;
export function validFurniturePiece(value: unknown): value is FurniturePiece {
  if (!record(value) || !isRelocatableKind(value.kind) || !identity(value.id) ||
      !['x', 'y'].includes(value.axis as string) || typeof value.hitPoints !== 'number' ||
      !Number.isFinite(value.hitPoints) || value.hitPoints <= 0 || value.hitPoints > relocationMaxHP(value.kind))
    return false;
  if (isShelfKind(value.kind)) return Object.keys(value).length === 5 &&
    ['id', 'kind', 'axis', 'hitPoints', 'settings'].every(k => Object.hasOwn(value, k)) && validStorageSettings(value.settings);
  if (!isFurnitureQuality(value.quality)) return false;
  const fields = ['id', 'kind', 'quality', 'hitPoints', 'axis', ...(value.kind === 'bed' ? ['owner'] : value.kind === 'table' ? ['gathering'] : [])];
  if (Object.keys(value).length !== fields.length || !fields.every(k => Object.hasOwn(value, k))) return false;
  return value.kind === 'bed' ? value.owner === null || identity(value.owner) :
    value.kind === 'table' ? typeof value.gathering === 'boolean' : true;
}
/** Copy only persistent inner-building data. Medical/prisoner designation and
 * active users are deliberately not packed; world transitions release them. */
export function relocationMaxHP(kind: RelocatableKind): number {
  return isShelfKind(kind) ? SHELF_DEFS[kind].maxHitPoints : furnitureStats(kind, 2).maxHitPoints;
}
export function makeFurniturePiece(kind: RelocatableKind, building: Bed | DiningTable | DiningChair | Shelf,
  hitPoints = relocationMaxHP(kind)): FurniturePiece {
  if (isShelfKind(kind)) {
    if (!('settings' in building) || building.kind !== kind) throw new RangeError('货架实例无效');
    const piece = { id: building.id, kind, axis: building.axis, hitPoints,
      settings: { priority: building.settings.priority, accepts: [...building.settings.accepts] } };
    if (!validFurniturePiece(piece)) throw new RangeError('打包货架无效');
    return piece;
  }
  if (!('quality' in building)) throw new RangeError('有品质家具实例无效');
  const base = { id: building.id, kind, quality: building.quality, hitPoints, axis: building.axis };
  const piece = kind === 'bed' ? { ...base, kind,
    owner: (building as Bed).medical || (building as Bed).prisoner ? null : (building as Bed).owner } :
    kind === 'table' ? { ...base, kind, gathering: (building as DiningTable).gathering } : { ...base, kind };
  if (!validFurniturePiece(piece)) throw new RangeError('打包家具实例无效');
  return piece;
}
/** Restoring ownership is a world decision. The returned bed is unclaimed and
 * ordinary until its original owner and destination room have been checked. */
export function furnitureFromPiece(piece: FurniturePiece, target: Pos, axis: Axis = piece.axis): Bed | DiningTable | DiningChair | Shelf {
  if (!validFurniturePiece(piece) || !['x', 'y'].includes(axis) ||
      ![target.x, target.y, target.z].every(Number.isSafeInteger)) throw new RangeError('家具重装数据无效');
  if ('settings' in piece) return { id: piece.id, kind: piece.kind, x: target.x, y: target.y, z: target.z, axis,
    settings: { priority: piece.settings.priority, accepts: [...piece.settings.accepts] } };
  const base = { id: piece.id, quality: piece.quality, x: target.x, y: target.y, z: target.z, axis };
  return piece.kind === 'bed' ? { ...base, owner: null, medical: false, prisoner: false } :
    piece.kind === 'table' ? { ...base, gathering: piece.gathering } : base;
}
