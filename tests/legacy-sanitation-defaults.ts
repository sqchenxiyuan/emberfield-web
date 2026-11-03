import { expect } from 'vitest';
import { stripFireFields } from './legacy-fire-defaults';

/** Only downgrade deliberately synthetic schema fixtures. Genuine historical
 * saves are immutable. New disease, tasks and polluted meals cannot be erased.
 * Incidental dirt has no representation in the historical schema. */
export function stripSanitationFields(raw: Record<string, any>) {
  stripFireFields(raw);
  for (const pawn of raw.pawns) {
    expect(pawn.cleanTask).toBeNull();
    expect(pawn.foodPoisoning).toBeNull();
    expect(pawn.phase).not.toBe('clean');
    delete pawn.cleanTask; delete pawn.foodPoisoning; delete pawn.dirtCarry;
    delete pawn.priorities.clean;
  }
  for (const batch of [...raw.items, ...raw.pawns.flatMap((p: any) => p.cargo ? [p.cargo] : []),
    ...raw.jobs.flatMap((j: any) => j.deliveredFood ?? []),
    ...(raw.trade?.caravans ?? []).flatMap((c: any) => c.stock)]) {
    if (batch.resource === 'meal') expect(batch.poisonChance ?? 0).toBe(0);
    delete batch.poisonChance;
  }
  for (const job of raw.jobs) {
    expect(job.cookingOutcome).toBeUndefined();
    delete job.cookingOutcome;
  }
  delete raw.filth;
}
