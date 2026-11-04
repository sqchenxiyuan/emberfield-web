import { furnitureStats, isFurnitureKind, isFurnitureQuality, type FurnitureKind } from './furniture';
import type { DiningChair, DiningTable } from './living';
import type { Axis, Bed, FurniturePiece, Pos } from './types';

/** Native uninstall work 200 at ConstructionSpeed * 1.7, converted from 60 to
 * 20 TPS, is approximately 40. Installation has no native work delay here;
 * one tick is the Web transaction scheduler's minimum, not a quality roll. */
export const RELOCATION_RULES = Object.freeze({ uninstallWork: 40, installWork: 1 });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const identity = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v < 10000000;
export function validFurniturePiece(value: unknown): value is FurniturePiece {
  if (!record(value) || !isFurnitureKind(value.kind) || !identity(value.id) || !isFurnitureQuality(value.quality) ||
      !['x', 'y'].includes(value.axis as string) || typeof value.hitPoints !== 'number' ||
      !Number.isFinite(value.hitPoints) || value.hitPoints <= 0 || value.hitPoints > furnitureStats(value.kind, value.quality).maxHitPoints)
    return false;
  const fields = ['id', 'kind', 'quality', 'hitPoints', 'axis', ...(value.kind === 'bed' ? ['owner'] : value.kind === 'table' ? ['gathering'] : [])];
  if (Object.keys(value).length !== fields.length || !fields.every(k => Object.hasOwn(value, k))) return false;
  return value.kind === 'bed' ? value.owner === null || identity(value.owner) :
    value.kind === 'table' ? typeof value.gathering === 'boolean' : true;
}
/** Copy only persistent inner-building data. Medical/prisoner designation and
 * active users are deliberately not packed; world transitions release them. */
export function makeFurniturePiece(kind: FurnitureKind, building: Bed | DiningTable | DiningChair,
  hitPoints = furnitureStats(kind, building.quality).maxHitPoints): FurniturePiece {
  const base = { id: building.id, kind, quality: building.quality, hitPoints, axis: building.axis };
  const piece = kind === 'bed' ? { ...base, kind,
    owner: (building as Bed).medical || (building as Bed).prisoner ? null : (building as Bed).owner } :
    kind === 'table' ? { ...base, kind, gathering: (building as DiningTable).gathering } : { ...base, kind };
  if (!validFurniturePiece(piece)) throw new RangeError('打包家具实例无效');
  return piece;
}
/** Restoring ownership is a world decision. The returned bed is unclaimed and
 * ordinary until its original owner and destination room have been checked. */
export function furnitureFromPiece(piece: FurniturePiece, target: Pos, axis: Axis = piece.axis): Bed | DiningTable | DiningChair {
  if (!validFurniturePiece(piece) || !['x', 'y'].includes(axis) ||
      ![target.x, target.y, target.z].every(Number.isSafeInteger)) throw new RangeError('家具重装数据无效');
  const base = { id: piece.id, quality: piece.quality, x: target.x, y: target.y, z: target.z, axis };
  return piece.kind === 'bed' ? { ...base, owner: null, medical: false, prisoner: false } :
    piece.kind === 'table' ? { ...base, gathering: piece.gathering } : base;
}
