import { expect } from 'vitest';
import { emptyCounts, type Resource } from '../src/voxel/types';
import { isPerishable, validBatch } from '../src/voxel/preservation';

/** Only downgrade deliberately synthetic schema fixtures. A pre-v28 format can
 * represent full-condition ordinary inputs through its old counters, but cannot
 * represent damaged goods, carcass HP or any wet memory. Reject these states
 * before changing anything; genuine historical fixture bytes never use this. */
export function stripEnvironmentFields(raw: Record<string, any>) {
  const batches = [...raw.items, ...raw.pawns.flatMap((p: any) => p.cargo ? [p.cargo] : []),
    ...raw.jobs.flatMap((j: any) => j.deliveredBatches ?? []),
    ...(raw.trade?.caravans ?? []).flatMap((c: any) => c.stock),
    ...(raw.trade?.receipts ?? []).flatMap((r: any) => r.transferred.map((t: any) => t.batch))];
  for (const batch of batches) expect(Object.hasOwn(batch, 'hitPoints')).toBe(false);
  for (const animal of raw.animals ?? []) expect(Object.hasOwn(animal, 'carcassHitPoints')).toBe(false);
  for (const pawn of raw.pawns) expect(pawn.psyche?.memories.some((m: any) => m.kind === 'wet') ?? false).toBe(false);
  for (const job of raw.jobs) {
    expect(Object.hasOwn(job, 'deliveredFood')).toBe(false);
    expect(Array.isArray(job.deliveredBatches)).toBe(true);
    for (const batch of job.deliveredBatches) expect(validBatch(batch)).toBe(true);
    for (const resource of Object.keys(emptyCounts()) as Resource[])
      expect(job.deliveredBatches.filter((b: any) => b.resource === resource).reduce((sum: number, b: any) => sum + b.amount, 0))
        .toBe(job.delivered[resource] ?? 0);
  }
  for (const job of raw.jobs) {
    job.deliveredFood = job.deliveredBatches.filter((b: any) => isPerishable(b.resource));
    delete job.deliveredBatches;
  }
}
