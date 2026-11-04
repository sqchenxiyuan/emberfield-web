import type { Cargo, Pawn } from './types';

/** Ordinary colony work/needs respect the item flag. Other factions and mental
 * states keep their own behavior; this is not an ownership or trade filter. */
export function itemForbiddenTo(pawn: Pawn | undefined, item: Cargo, tick: number): boolean {
  return !!item.forbidden && !!pawn && pawn.faction === 'colony' && !pawn.drafted && pawn.psyche.breakUntil <= tick;
}

/** v44 and earlier only permitted the field on weapons and unfinished pieces.
 * Migration preserves those settings and does not invent flags for other goods. */
export function rejectLegacyItemAccess(raw: Record<string, any>, version: number): void {
  if (version >= 45) return;
  const batches = [...(Array.isArray(raw.items) ? raw.items : []),
    ...(Array.isArray(raw.pawns) ? raw.pawns.map((p:any) => p?.cargo) : []),
    ...(Array.isArray(raw.jobs) ? raw.jobs.flatMap((j:any) => j?.deliveredBatches ?? []) : []),
    ...(Array.isArray(raw.trade?.caravans) ? raw.trade.caravans.flatMap((c:any) => c?.stock ?? []) : [])];
  const seen = new Set<object>();
  for (let n=0;n<batches.length;n++) {
    const batch=batches[n];
    if (!batch || typeof batch!=='object' || seen.has(batch)) continue;
    seen.add(batch);
    if (Object.hasOwn(batch,'forbidden') && !['weapon','unfinished'].includes(batch.resource))
      throw new Error('旧版存档混入通用物品禁止字段');
    if (Array.isArray(batch.unfinished?.ingredients)) batches.push(...batch.unfinished.ingredients);
  }
}
