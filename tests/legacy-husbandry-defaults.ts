import { stripPensFields } from './legacy-pens-defaults';
import { expect } from 'vitest';
/** Synthetic fixtures only: historical bytes are never rewritten. */
export function stripHusbandryFields(raw: Record<string, any>) {
  stripPensFields(raw);
  for (const p of raw.pawns ?? []) expect(p.handleTask ?? null).toBeNull();
  for (const a of raw.animals ?? []) {
    expect(a.faction ?? 'wild').toBe('wild');
    expect(a.pregnancy ?? null).toBeNull();
    expect(a.tame ?? false).toBe(false);
    expect(a.slaughter ?? false).toBe(false);
    expect(a.releaseMarked ?? false).toBe(false);
  }
  delete raw.grass; delete raw.husbandryLog;
  for (const p of raw.pawns ?? []) {
    delete p.handleTask;
    if(p.priorities)delete p.priorities.handle;
    if(p.skills)delete p.skills.animals;
  }
  for (const a of raw.animals ?? []) for(const key of ['faction','sex','ageTicks','growth','tame','slaughter','releaseMarked',
    'malnutrition','pregnancy','mateId','mateProgress','nextMateTick','tameness','nextTamenessDecayTick','nextInteractionTick','path','goal','eatProgress','reason'])delete a[key];
}
