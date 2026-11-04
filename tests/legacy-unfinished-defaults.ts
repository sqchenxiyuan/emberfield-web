import { expect } from 'vitest';
import { stripProductionOutputFields } from './legacy-production-output-defaults';
import { milkExpectedField } from './legacy-auto-rebuild-defaults';

/** Add only the new zero ledgers when comparing untouched historical saves. */
export function unfinishedExpectedField(key: string, value: any): any {
  value = milkExpectedField(key, value);
  if (key === 'stats') return { ...value, ...Object.fromEntries(
    ['produced', 'consumed', 'spoiled', 'destroyed'].map(k => [k, { ...value[k], unfinished: 0 }])) };
  if (key === 'trade') return { ...value,
    imported: { ...value.imported, unfinished: 0 }, exported: { ...value.exported, unfinished: 0 } };
  return value;
}

/** Synthetic old-schema tests only. Refuse to erase actual unfinished work. */
export function stripUnfinishedFields(raw: Record<string, any>) {
  stripProductionOutputFields(raw);
  const batches = [...(raw.items ?? []), ...(raw.pawns ?? []).map((p: any) => p.cargo),
    ...(raw.jobs ?? []).flatMap((j: any) => j.deliveredBatches ?? []),
    ...(raw.trade?.caravans ?? []).flatMap((c: any) => c.stock ?? []),
    ...(raw.trade?.receipts ?? []).flatMap((r: any) => (r.transferred ?? []).map((t: any) => t.batch))];
  for (const batch of batches) if (batch) {
    expect(batch.resource).not.toBe('unfinished');
    expect(Object.hasOwn(batch, 'unfinished')).toBe(false);
  }
  for (const job of raw.jobs ?? []) {
    expect(Object.hasOwn(job, 'unfinishedId')).toBe(false);
    expect(Object.hasOwn(job.cost ?? {}, 'unfinished')).toBe(false);
    expect(Object.hasOwn(job.delivered ?? {}, 'unfinished')).toBe(false);
  }
  const ledgers = ['produced', 'consumed', 'spoiled', 'destroyed'].map(k => raw.stats?.[k])
    .concat([raw.trade?.imported, raw.trade?.exported]);
  for (const ledger of ledgers) if (ledger && Object.hasOwn(ledger, 'unfinished')) {
    expect(ledger.unfinished).toBe(0);
    delete ledger.unfinished;
  }
  const settings = [...(raw.stockpiles ?? []), ...(raw.shelves ?? []).map((s: any) => s.settings),
    ...(raw.storageGroups ?? []).map((g: any) => g.settings),
    ...(raw.jobs ?? []).map((j: any) => j.storageSettings),
    ...batches.map((b: any) => b?.furniture?.settings)];
  for (const setting of settings) if (setting)
    setting.accepts = setting.accepts.filter((r: string) => r !== 'unfinished');
}
