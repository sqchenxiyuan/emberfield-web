import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { relocationV33 } from './relocation-fixtures';
import { relocationExpectedField } from './legacy-relocation-defaults';
import { stripUnfinishedFields } from './legacy-unfinished-defaults';

describe('published v33 furniture relocation compatibility', () => {
  it.each(['furnished', 'sleeping', 'during-meal'] as const)('keeps the actual %s checkpoint identities, quality, HP and ongoing activity', name => {
    const old = relocationV33(name), before = structuredClone(old), s = VoxelSimulation.load(old), saved = s.save();
    expect(old).toEqual(before); expect(saved.version).toBe(51);
    for (const key of ['tick', 'nextId', 'beds', 'tables', 'chairs', 'fireDamage', 'items', 'stats', 'trade', 'stockpiles'] as const)
      expect(saved[key], key).toEqual(relocationExpectedField(key, old[key]));
    for (const previous of old.pawns) {
      const pawn = saved.pawns.find(p => p.id === previous.id)!;
      for (const key of ['x', 'y', 'z', 'food', 'rest', 'cargo', 'skills', 'living', 'social', 'psyche', 'sleepBedId', 'sleepingSince'] as const)
        expect(pawn[key], `pawn${pawn.id}.${key}`).toEqual(previous[key]);
    }
    expect(VoxelSimulation.load(saved).save()).toEqual(saved);
  });
  it.each(['sleeping', 'during-meal'] as const)('resumes real %s state identically across an additional load', name => {
    const first = VoxelSimulation.load(relocationV33(name)), second = VoxelSimulation.load(first.save());
    expect(first.pawns.some(p => name === 'sleeping' ? p.phase === 'rest' && p.sleepBedId !== null : p.living.mealTask !== null)).toBe(true);
    first.step(30); second.step(30); expect(second.save()).toEqual(first.save());
  });
  it('rejects a version-relabeled current save before zeroing newly added ledgers', () => {
    const current = VoxelSimulation.load(relocationV33()).save(); stripUnfinishedFields(current); current.version = 33 as typeof current.version;
    const before = structuredClone(current);
    expect(() => VoxelSimulation.load(current)).toThrow(/旧版本包含新版/); expect(current).toEqual(before);
  });
});
