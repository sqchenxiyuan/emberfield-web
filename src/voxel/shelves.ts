import { emptyCounts, type Axis, type Cargo, type Pos, type Resource } from './types';
import type { FurnitureKind } from './furniture';

export type ShelfKind = 'shelf' | 'smallShelf';
export type RelocatableKind = FurnitureKind | ShelfKind;
export interface StorageSettings { priority: number; accepts: Resource[] }
export interface Shelf extends Pos { id: number; kind: ShelfKind; axis: Axis; settings: StorageSettings }
/** Only a physical cell capacity exception; inventory stays in the ordinary
 * Stack array, never duplicated in a hidden container. */
export interface StorageSpill extends Pos { shelfId: number; reason: 'destroyedShelf' }
export interface StorageCell extends Pos, StorageSettings {
  provider: 'stockpile' | 'shelf'; shelfId: number | null; maxStacks: number;
}
/** Capacity/filter/identity follow the researched mechanisms. Costs, work,
 * beauty and HP remain editable Web tuning, and there is no quality roll. */
export const SHELF_DEFS = {
  smallShelf: { name: '小货架', cells: 1, cost: { wood: 25 }, work: 80, maxHitPoints: 100, beauty: 2 },
  shelf: { name: '货架', cells: 2, cost: { wood: 45 }, work: 130, maxHitPoints: 150, beauty: 2 },
} as const;
export const SHELF_STACKS = 3;
export const isShelfKind = (v: unknown): v is ShelfKind => v === 'smallShelf' || v === 'shelf';
export const isRelocatableKind = (v: unknown): v is RelocatableKind =>
  isShelfKind(v) || v === 'bed' || v === 'table' || v === 'chair';
export function shelfCells(shelf: Pos & { kind: ShelfKind; axis: Axis }): Pos[] {
  return Array.from({ length: SHELF_DEFS[shelf.kind].cells }, (_, n) => ({
    x: shelf.x + (shelf.axis === 'x' ? n : 0), y: shelf.y + (shelf.axis === 'y' ? n : 0), z: shelf.z,
  }));
}
export function defaultShelfSettings(): StorageSettings {
  return { priority: 2, accepts: (Object.keys(emptyCounts()) as Resource[]).filter(r => !['chunk', 'furniture', 'carcass'].includes(r)) };
}
export function validStorageSettings(value: unknown): value is StorageSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as StorageSettings;
  return Object.keys(s).length === 2 && Number.isInteger(s.priority) && s.priority >= 0 && s.priority <= 3 &&
    Array.isArray(s.accepts) && new Set(s.accepts).size === s.accepts.length &&
    s.accepts.every(r => Object.hasOwn(emptyCounts(), r) && r !== 'chunk' && r !== 'furniture');
}
/** Historical packed carcasses have no growth record. Missing size uses adult
 * size conservatively; fresh carcasses freeze their actual life-stage size. */
export function shelfAllows(batch: Pick<Cargo, 'resource' | 'carcass'>): boolean {
  // A UFT is one ordinary haulable item; its enclosed ingredients do not occupy
  // extra shelf slots. The shelf's unfinished filter is checked by its caller.
  if (batch.resource === 'unfinished') return true;
  if (batch.resource === 'chunk' || batch.resource === 'furniture') return false;
  if (batch.resource !== 'carcass') return true;
  return !!batch.carcass && (batch.carcass.bodySize ?? (batch.carcass.species === 'hare' ? .2 : 1.2)) < .75;
}
