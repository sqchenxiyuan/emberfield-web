import type { VoxelSave } from './types';
import { defaultAutoSlaughter, defaultAutoSlaughterPolicy, validAutoSlaughter } from './autoSlaughter';

export function migrateAutoSlaughter(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion < 48) {
    if (Object.hasOwn(old, 'autoSlaughter') || (Array.isArray(old.pawns) &&
        old.pawns.some((p: any) => p?.handleTask?.action === 'autoSlaughter')))
      throw new Error('旧版存档混入自动宰杀字段');
    old.autoSlaughter = defaultAutoSlaughter();
  }
  if (sourceVersion === 48 && old.autoSlaughter && typeof old.autoSlaughter === 'object')
    old.autoSlaughter.dromedary = defaultAutoSlaughterPolicy();
  if (sourceVersion >= 48 && sourceVersion < 50 && old.autoSlaughter && typeof old.autoSlaughter === 'object')
    old.autoSlaughter.alpaca = defaultAutoSlaughterPolicy();
  if (sourceVersion >= 48 && sourceVersion < 51 && old.autoSlaughter && typeof old.autoSlaughter === 'object')
    old.autoSlaughter.chicken = defaultAutoSlaughterPolicy();
  if (!validAutoSlaughter(old.autoSlaughter)) throw new Error('自动宰杀配额设置无效');
}

/** A target may become ineligible later in the same tick (e.g. birth/ageing).
 * The worker rechecks before doing work, including immediately after a load.
 * Only persisted policy is authority; derived target IDs are never trusted. */
export function validateAutoSlaughter(d: VoxelSave): void {
  if (!validAutoSlaughter(d.autoSlaughter)) throw new Error('自动宰杀配额设置无效');
}
