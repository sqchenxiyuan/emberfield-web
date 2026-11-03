import { expect } from 'vitest';
import type { VoxelSave } from '../src/voxel/types';

/** Migration allocates new wildlife identities after every historical identity.
 * Existing item/pawn/gear identities are still compared by each migration test. */
export function expectWildlifeIds(previousNextId: number, save: VoxelSave) {
  expect(save.animals.map(a => a.id)).toEqual(save.animals.map((_, i) => previousNextId + i));
  expect(save.nextId).toBe(previousNextId + save.animals.length);
}
