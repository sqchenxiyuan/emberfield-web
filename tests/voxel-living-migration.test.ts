import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { initialLiving } from '../src/voxel/living';
import { relocationExpectedField } from './legacy-relocation-defaults';

const HASHES = { leading: '110fa3b3d2e8f0a4458671d7760f07814462ef28ba2e46b0c56889d5e4d7a2bf',
  final: 'a9f91d6a5fc4a07e52db0c8119855232598c6785f85635c6854bde4d75014760' } as const;
function historical(name: keyof typeof HASHES) {
  const bytes = readFileSync(new URL(`./fixtures/voxel-v30-living-${name}.json`, import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(HASHES[name]);
  const old = JSON.parse(bytes.toString('utf8')); expect(old.version).toBe(30); return old;
}

describe('authentic v30 living loader compatibility', () => {
  it.each(['leading', 'final'] as const)('roundtrips the real %s colony without changing physical state or active ropes', name => {
    const old = historical(name), original = structuredClone(old), sim = VoxelSimulation.load(old), saved = sim.save();
    expect(old).toEqual(original); expect(saved.version).toBe(39);
    expect(saved.tables).toEqual([]); expect(saved.chairs).toEqual([]);
    // The established loader reschedules ordinary haul/fetch work. Compare all
    // persistent physical and economic fields; retain the entire rope activity.
    for (const [key, value] of Object.entries(old)) if (!['version', 'pawns', 'jobs', 'beds'].includes(key))
      expect((saved as any)[key], key).toEqual(relocationExpectedField(key, value));
    expect(saved.beds).toEqual(old.beds.map((b:any)=>({...b,quality:2})));
    const scheduling = ['destination', 'jobId', 'moveTick', 'path', 'phase', 'reason', 'workTarget'];
    for (const previous of old.pawns) {
      const p = saved.pawns.find(p => p.id === previous.id)!;
      expect(p.living).toEqual(initialLiving());
      for (const [key, value] of Object.entries(previous)) if (previous.ropeTask || !scheduling.includes(key))
        expect((p as any)[key], `pawn${p.id}.${key}`).toEqual(key === 'psyche' ? { ...previous.psyche, tolerance: { ...previous.psyche.tolerance, social: 0 } } : value);
    }
    for (const previous of old.jobs) {
      const job = saved.jobs.find(j => j.id === previous.id)!;
      for (const [key, value] of Object.entries(previous)) if (!['owner', 'reason'].includes(key))
        expect((job as any)[key], `job${job.id}.${key}`).toEqual(value);
    }
    expect(VoxelSimulation.load(saved).save()).toEqual(saved);
  });
  it('resumes the real carried rope state identically after a second load', () => {
    const first = VoxelSimulation.load(historical('leading')), second = VoxelSimulation.load(first.save());
    expect(first.pawns.some(p => p.ropeTask?.stage === 'lead')).toBe(true);
    first.step(20); second.step(20); expect(second.save()).toEqual(first.save());
  });
  it('rejects forged new actions in original v30 input without changing caller data', () => {
    const old = historical('final'); old.pawns[0].living = initialLiving(); const before = structuredClone(old);
    expect(() => VoxelSimulation.load(old)).toThrow(/旧版本包含新版餐桌/); expect(old).toEqual(before);
  });
});
