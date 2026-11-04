import { expect } from 'vitest';

/** Synthetic old-schema tests only. Never erase an active output delivery. */
export function stripProductionOutputFields(raw: Record<string, any>) {
  // Validate every pawn before mutating the snapshot, including carrying and
  // dropping tasks. Authentic historical fixture bytes never pass this helper.
  for (const pawn of raw.pawns ?? []) expect(pawn.productionDelivery).toBeUndefined();
  for (const pawn of raw.pawns ?? []) delete pawn.productionDelivery;
  delete raw.stockpileZones;
  for (const queue of raw.productionQueues ?? [])
    for (const bill of queue.bills ?? []) delete bill.output;
}
