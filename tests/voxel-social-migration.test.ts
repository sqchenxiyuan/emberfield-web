import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { initialSocial } from '../src/voxel/social';
import { relocationExpectedField } from './legacy-relocation-defaults';

const hashes = {
  'carrying-meal': 'c49d2a6d1a6d14c884abe5c5c799b6ff06644081154a0f7728b82e84ba0276da',
  'seated-meal': 'f8e7a38e4860fb806b524c8d2429ad0811e32e41cdf73248539e77c273fbf01b',
};
function historical(name: keyof typeof hashes) {
  const bytes = readFileSync(new URL(`./fixtures/voxel-v31-social-${name}.json`, import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(hashes[name]);
  const old = JSON.parse(bytes.toString('utf8')); expect(old.version).toBe(31); return old;
}

describe('authentic v31 social loader compatibility', () => {
  it.each(['carrying-meal', 'seated-meal'] as const)('roundtrips the actual %s colony without changing food, furniture or active meals', name => {
    const old = historical(name), original = structuredClone(old), sim = VoxelSimulation.load(old), saved = sim.save();
    expect(old).toEqual(original); expect(saved.version).toBe(51);
    expect(saved.socialHistory).toEqual([]); expect(saved.socialLog).toEqual([]);
    for (const [key, value] of Object.entries(old)) if (!['version', 'pawns', 'jobs', 'tables', 'beds', 'chairs'].includes(key))
      expect((saved as any)[key], key).toEqual(relocationExpectedField(key, value));
    expect(saved.tables).toEqual(old.tables.map((t: any) => ({ ...t, gathering: true, quality: 2 })));
    for(const key of ['beds','chairs'] as const) expect(saved[key]).toEqual(old[key].map((t:any)=>({...t,quality:2})));
    // The established loader rebuilds transient routes and ordinary fetch
    // intent. An active dining task retains its actual food and chew progress.
    const scheduling = ['destination', 'jobId', 'moveTick', 'path', 'phase', 'reason', 'workTarget', 'eating'];
    for (const previous of old.pawns) {
      const p = saved.pawns.find(p => p.id === previous.id)!;
      expect(p.social).toEqual(initialSocial(old.tick, p.id));
      expect(p.psyche).toEqual({ ...previous.psyche, tolerance: { ...previous.psyche.tolerance, social: 0 } });
      for (const [key, value] of Object.entries(previous)) if (key !== 'psyche' && !scheduling.includes(key))
        expect((p as any)[key], `pawn${p.id}.${key}`).toEqual(value);
      if (previous.living.mealTask) { expect(p.phase).toBe('dine'); expect(p.eating).toBe(previous.eating); }
    }
    expect(VoxelSimulation.load(saved).save()).toEqual(saved);
  });
  it('continues the actual carried meal deterministically after a second load', () => {
    const first = VoxelSimulation.load(historical('carrying-meal')), second = VoxelSimulation.load(first.save());
    expect(first.pawns.some(p => p.living.mealTask?.stage === 'travel')).toBe(true);
    first.step(40); second.step(40); expect(second.save()).toEqual(first.save());
  });
  it('rejects forged new state in source v31 without modifying the caller data', () => {
    const old = historical('seated-meal'); old.pawns[0].social = initialSocial(); const before = structuredClone(old);
    expect(() => VoxelSimulation.load(old)).toThrow(/旧版本包含新版社交/); expect(old).toEqual(before);
  });
});
