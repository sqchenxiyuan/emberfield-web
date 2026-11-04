import { expect } from 'vitest';
import { stripRegionFields } from './legacy-region-defaults';
/** Expected additive schema fields; leaves the captured historical object alone. */
export function relocationExpectedField(key: string, value: any): any {
  if (key === 'stats') return { ...value, ...Object.fromEntries(
    ['produced', 'consumed', 'spoiled', 'destroyed'].map(k => [k, { ...value[k], furniture: 0 }])) };
  if (key === 'trade') return { ...value, imported: { ...value.imported, furniture: 0 }, exported: { ...value.exported, furniture: 0 } };
  return value;
}
/** Synthetic historical inputs only; never alter captured source fixtures. */
export function stripRelocationFields(raw: Record<string, any>) {
  stripRegionFields(raw);
  const batches = [...(raw.items ?? []), ...(raw.pawns ?? []).map((p: any) => p.cargo),
    ...(raw.jobs ?? []).flatMap((j: any) => j.deliveredBatches ?? [])];
  for (const b of batches) if (b) { expect(b.resource).not.toBe('furniture'); expect(b.furniture).toBeUndefined(); }
  for (const j of raw.jobs ?? []) {
    expect(['install', 'uninstall']).not.toContain(j.kind);
    expect(j.furnitureId).toBeUndefined(); expect(j.furnitureKind).toBeUndefined();
  }
  for (const ledger of ['produced', 'consumed', 'spoiled', 'destroyed'].map(k => raw.stats?.[k])
    .concat([raw.trade?.imported, raw.trade?.exported])) if (ledger && Object.hasOwn(ledger, 'furniture')) {
    expect(ledger.furniture).toBe(0); delete ledger.furniture;
  }
  for (const stockpile of raw.stockpiles ?? []) stockpile.accepts = stockpile.accepts.filter((r: string) => r !== 'furniture');
}
