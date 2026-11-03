import { expect } from 'vitest';

/** Synthetic old-schema fixtures only. Ordinary need changes may have happened
 * while arranging the test, but no v23 activity or structure may be discarded.
 * Genuine historical fixture bytes never pass through this helper. */
export function stripMoodFields(raw: Record<string, any>) {
  expect(raw.horseshoePins).toEqual([]);
  expect(raw.jobs.some((job: any) => job.kind === 'horseshoePin')).toBe(false);
  for (const pawn of raw.pawns) {
    expect(['recreation', 'mental'].includes(pawn.phase)).toBe(false);
    expect(pawn.schedule.includes('recreation')).toBe(false);
    expect(pawn.psyche.recreation).toBeNull();
    expect(pawn.psyche.breakUntil).toBe(0);
    delete pawn.psyche;
  }
  delete raw.horseshoePins;
}
