import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { furnitureV32 } from './furniture-fixtures';
import { relocationExpectedField } from './legacy-relocation-defaults';

describe('published v32 furniture loader compatibility', () => {
  it.each(['furnished', 'during-meal', 'sleeping'] as const)('migrates actual %s construction and occupancy without rerolling it', name => {
    const old = furnitureV32(name), original = structuredClone(old), simulation = VoxelSimulation.load(old), saved = simulation.save();
    expect(old).toEqual(original); expect(saved.version).toBe(40);
    for (const key of ['beds', 'tables', 'chairs'] as const) expect(saved[key]).toEqual(old[key].map((item: any) => ({ ...item, quality: 2 })));
    for (const key of ['tick', 'nextId', 'items', 'stats', 'fireDamage', 'fireHazards', 'socialHistory', 'socialLog'] as const)
      expect(saved[key]).toEqual(relocationExpectedField(key, old[key]));
    for (const oldPawn of old.pawns) {
      const pawn = saved.pawns.find(p => p.id === oldPawn.id)!;
      for (const key of ['food', 'rest', 'cargo', 'skills', 'living', 'social', 'psyche', 'sleepBedId', 'sleepingSince'] as const)
        expect(pawn[key], `pawn${pawn.id}.${key}`).toEqual(oldPawn[key]);
    }
    expect(VoxelSimulation.load(saved).save()).toEqual(saved);
  });
  it.each(['during-meal', 'sleeping'] as const)('resumes the real %s activity identically after a second load', name => {
    const first = VoxelSimulation.load(furnitureV32(name)), second = VoxelSimulation.load(first.save());
    expect(first.pawns.some(p => name === 'sleeping' ? p.phase === 'rest' && p.sleepBedId !== null : p.living.mealTask !== null)).toBe(true);
    first.step(30); second.step(30); expect(second.save()).toEqual(first.save());
  });
  it('rejects a version-relabeled quality-bearing save instead of treating it as Normal', () => {
    const old = furnitureV32(); old.beds[0].quality = 6; const before = structuredClone(old);
    expect(() => VoxelSimulation.load(old)).toThrow(/旧版本包含新版家具品质/); expect(old).toEqual(before);
  });
});
