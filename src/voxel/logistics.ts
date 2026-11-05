import type { Cargo } from './types';
import { compatibleBatches, mergeBatch, portion } from './preservation';
import { stackLimit } from './stackLimits';
export { STACK_LIMITS, stackLimit, carryLimit } from './stackLimits';

export type BatchKind = Pick<Cargo, 'resource' | 'crop' | 'apparel' | 'weapon' | 'carcass' | 'furniture' | 'unfinished' | 'hatcher'>;
export interface CellInsertion {
  accepted: number;
  /** Existing stack indexes, in stable input order; their identities stay intact. */
  merges: { index: number; amount: number }[];
  /** Each entry occupies one additional slot, never an enlarged stack. */
  additions: number[];
}

/** One capacity planner for physical placement and virtual reservations. Filters,
 * reachability and source ownership belong to the caller, not to stack capacity.
 * Existing rejected goods still consume slots. An overflowing cell cannot take
 * new stacks, but can still fill a compatible partial stack. */
export function planCellInsertion(
  existing: readonly Cargo[], incoming: BatchKind & { amount: number }, maxStacks: number,
  mergeForbidden = true,
): CellInsertion {
  if (!Number.isSafeInteger(maxStacks) || maxStacks < 0 ||
      !Number.isSafeInteger(incoming.amount) || incoming.amount < 0)
    throw new RangeError('Invalid cell capacity or incoming amount');
  let remaining = incoming.amount;
  const merges: CellInsertion['merges'] = [], additions: number[] = [];
  const limit = stackLimit(incoming.resource);
  for (let index = 0; index < existing.length && remaining; index++) {
    const stack = existing[index];
    // Single-instance objects must never pass through mergeBatch, even when
    // their instance IDs happen to match in a caller's speculative state.
    if (limit === 1 || (!mergeForbidden && stack.forbidden) || !compatibleBatches(stack, incoming)) continue;
    const amount = Math.min(remaining, Math.max(0, limit - stack.amount));
    if (amount) { merges.push({ index, amount }); remaining -= amount; }
  }
  for (let slot = existing.length; slot < maxStacks && remaining; slot++) {
    const amount = Math.min(remaining, limit);
    additions.push(amount); remaining -= amount;
  }
  return { accepted: incoming.amount - remaining, merges, additions };
}

/** Pure physical preview: quantity-weighted condition changes apply only to
 * transferred portions. No global IDs or input objects are changed. */
export function simulateCellInsert<T extends Cargo>(
  existing: readonly T[], incoming: Cargo, maxStacks: number,
): { stacks: T[]; additions: Cargo[]; accepted: number } {
  const plan = planCellInsertion(existing, incoming, maxStacks);
  const stacks = existing.map(stack => ({ ...stack }));
  for (const merge of plan.merges) mergeBatch(stacks[merge.index], portion(incoming, merge.amount));
  return { stacks, additions: plan.additions.map(amount => portion(incoming, amount)), accepted: plan.accepted };
}

/** Replay all reservations through the same slot rules before asking how much
 * a new type can fit. This models shared partial stacks and mixed resources;
 * subtracting reserved units from a single total cannot represent either. */
export function cellSpaceAfterReservations(
  existing: readonly Cargo[], reservations: readonly Cargo[], incoming: BatchKind, maxStacks: number,
  mergeForbidden = true,
): number {
  const virtual: Cargo[] = existing.map(stack => ({ ...stack }));
  for (const batch of reservations) {
    // Storage reservations are ordinary haul destinations, including when the
    // incoming operation is a physical drop that may merge into a forbidden pile.
    const plan = planCellInsertion(virtual, batch, maxStacks, false);
    if (plan.accepted !== batch.amount) return 0;
    for (const merge of plan.merges) virtual[merge.index].amount += merge.amount;
    virtual.push(...plan.additions.map(amount => ({ ...batch, amount })));
  }
  // Capacity probes may describe an unassigned equipment slot. They need no
  // fabricated instance, age or condition, and never create physical cargo.
  const amount = stackLimit(incoming.resource) * Math.max(maxStacks, virtual.length);
  return planCellInsertion(virtual, { ...incoming, amount }, maxStacks, mergeForbidden).accepted;
}
export function stackSpace(
  existing: Cargo | undefined,
  incoming: BatchKind,
): number {
  return cellSpaceAfterReservations(existing ? [existing] : [], [], incoming, 1);
}

// Immediate output/refund placement stays close to the physical container.
export const DROP_DISTANCE = 3;
export const MIGRATION_DISTANCE = 12;
