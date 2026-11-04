import { expect } from 'vitest';
/** Add schema defaults to a copy; historical material/filter choices stay exact. */
export function woolExpectedField(key: string, value: any): any {
  const copy = structuredClone(value);
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (!Array.isArray(node) && Object.hasOwn(node, 'allowedFood') && Object.hasOwn(node, 'allowedCarcasses'))
      node.allowedTextiles = ['cloth'];
    Object.values(node).forEach(visit);
  };
  visit(copy);
  if (key === 'stats') return { ...copy, ...Object.fromEntries(
    ['produced', 'consumed', 'spoiled', 'destroyed'].map(k => [k, { ...copy[k], alpacaWool: 0 }])) };
  if (key === 'trade') return { ...copy, imported: { ...copy.imported, alpacaWool: 0 }, exported: { ...copy.exported, alpacaWool: 0 } };
  if (key === 'animals') return copy.map((a: any) => ({ ...a, woolGrowth: 0 }));
  if (key === 'penMarkers') return copy.map((p: any) => ({ ...p, filter: { ...p.filter, alpaca: false } }));
  if (key === 'autoSlaughter') return { ...copy,
    alpaca: { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false } };
  return copy;
}
/** Build expected additive defaults without rewriting any historical fixture. */
export function milkExpectedField(key: string, value: any): any {
  value = woolExpectedField(key, value);
  if (key === 'stats') return { ...value, ...Object.fromEntries(
    ['produced', 'consumed', 'spoiled', 'destroyed'].map(k => [k, { ...value[k], milk: 0 }])) };
  if (key === 'trade') return { ...value, imported: { ...value.imported, milk: 0 }, exported: { ...value.exported, milk: 0 } };
  if (key === 'animals') return value.map((a: any) => ({ ...a, milkFullness: 0 }));
  if (key === 'penMarkers') return value.map((p: any) => ({ ...p, filter: { ...p.filter, dromedary: false } }));
  if (key === 'autoSlaughter') return { ...value,
    dromedary: { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false } };
  return value;
}
/** Synthetic old-schema inputs only. Actual wool/animals/work cannot be erased. */
export function stripAnimalWoolFields(raw: Record<string, any>) {
  const preflight = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    expect(node.species).not.toBe('alpaca');
    expect(node.resource).not.toBe('alpacaWool');
    expect(node.material).not.toBe('alpacaWool');
    expect(node.action).not.toBe('shear');
    expect(['sheared', 'shearFailed']).not.toContain(node.kind);
    Object.values(node).forEach(preflight);
  };
  preflight(raw);
  const policy = { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
  for (const animal of raw.animals ?? []) {
    if (Object.hasOwn(animal, 'woolGrowth')) expect(animal.woolGrowth).toBe(0);
    delete animal.woolGrowth;
  }
  for (const ledger of ['produced', 'consumed', 'spoiled', 'destroyed'].map(k => raw.stats?.[k])
    .concat([raw.trade?.imported, raw.trade?.exported])) if (ledger && Object.hasOwn(ledger, 'alpacaWool')) {
    expect(ledger.alpacaWool).toBe(0); delete ledger.alpacaWool;
  }
  if (raw.autoSlaughter && Object.hasOwn(raw.autoSlaughter, 'alpaca')) {
    expect(raw.autoSlaughter.alpaca).toEqual(policy); delete raw.autoSlaughter.alpaca;
  }
  for (const pen of raw.penMarkers ?? []) if (Object.hasOwn(pen.filter, 'alpaca')) {
    // Recognize only fresh-pen and migrated-old-pen defaults, with no alpacas.
    expect([true, false]).toContain(pen.filter.alpaca); delete pen.filter.alpaca;
  }
  for (const job of raw.jobs ?? []) {
    expect(Object.hasOwn(job.cost ?? {}, 'alpacaWool')).toBe(false);
    expect(Object.hasOwn(job.delivered ?? {}, 'alpacaWool')).toBe(false);
  }
  const batches = [...(raw.items ?? []), ...(raw.pawns ?? []).map((p: any) => p.cargo),
    ...(raw.jobs ?? []).flatMap((j: any) => j.deliveredBatches ?? []),
    ...(raw.trade?.caravans ?? []).flatMap((c: any) => c.stock ?? []),
    ...(raw.trade?.receipts ?? []).flatMap((r: any) => (r.transferred ?? []).map((t: any) => t.batch))].filter(Boolean);
  const settings = [...(raw.stockpiles ?? []), ...(raw.shelves ?? []).map((s: any) => s.settings),
    ...(raw.storageGroups ?? []).map((g: any) => g.settings), ...(raw.jobs ?? []).map((j: any) => j.storageSettings),
    ...batches.map((b: any) => b.furniture?.settings)].filter(Boolean);
  const all = ['silver', 'wood', 'stone', 'steel', 'components', 'food', 'grain', 'meat', 'milk', 'carcass', 'meal', 'chunk', 'cloth', 'alpacaWool', 'herb', 'apparel', 'weapon', 'furniture', 'unfinished'];
  for (const setting of settings) if (setting.accepts.includes('alpacaWool')) {
    expect([all.slice().sort(), all.filter(r => !['chunk', 'furniture', 'carcass'].includes(r)).sort()])
      .toContainEqual([...setting.accepts].sort());
    setting.accepts = setting.accepts.filter((r: string) => r !== 'alpacaWool');
  }
  const stripPolicy = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Object.hasOwn(node, 'allowedTextiles')) {
      expect([['cloth'], ['cloth', 'alpacaWool']]).toContainEqual(node.allowedTextiles);
      delete node.allowedTextiles;
    }
    if (node.allowedCarcasses?.includes('alpaca')) {
      expect([...node.allowedCarcasses].sort()).toEqual(['alpaca', 'deer', 'dromedary', 'hare']);
      node.allowedCarcasses = node.allowedCarcasses.filter((s: string) => s !== 'alpaca');
    }
    Object.values(node).forEach(stripPolicy);
  };
  stripPolicy(raw);
}
/** Only current empty/default additions may be removed from synthetic old inputs. */
export function stripAnimalMilkFields(raw: Record<string, any>) {
  stripAnimalWoolFields(raw);
  const policy = { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
  for (const animal of raw.animals ?? []) {
    expect(animal.species).not.toBe('dromedary');
    if (Object.hasOwn(animal, 'milkFullness')) expect(animal.milkFullness).toBe(0);
    delete animal.milkFullness;
  }
  expect(raw.pawns?.some((p: any) => p.handleTask?.action === 'milk')).not.toBe(true);
  for (const ledger of ['produced', 'consumed', 'spoiled', 'destroyed'].map(k => raw.stats?.[k])
    .concat([raw.trade?.imported, raw.trade?.exported])) if (ledger && Object.hasOwn(ledger, 'milk')) {
    expect(ledger.milk).toBe(0); delete ledger.milk;
  }
  if (raw.autoSlaughter && Object.hasOwn(raw.autoSlaughter, 'dromedary')) {
    expect(raw.autoSlaughter.dromedary).toEqual(policy); delete raw.autoSlaughter.dromedary;
  }
  for (const pen of raw.penMarkers ?? []) if (Object.hasOwn(pen.filter, 'dromedary')) {
    // Both new-pen true and old-pen migration false are recognized defaults;
    // no dromedary or animal-product state is present in these synthetic inputs.
    expect([true, false]).toContain(pen.filter.dromedary); delete pen.filter.dromedary;
  }
  const batches = [...(raw.items ?? []), ...(raw.pawns ?? []).map((p: any) => p.cargo),
    ...(raw.jobs ?? []).flatMap((j: any) => j.deliveredBatches ?? []),
    ...(raw.trade?.caravans ?? []).flatMap((c: any) => c.stock ?? []),
    ...(raw.trade?.receipts ?? []).flatMap((r: any) => (r.transferred ?? []).map((t: any) => t.batch))].filter(Boolean);
  for (const batch of [...batches, ...batches.flatMap((b: any) => b.unfinished?.ingredients ?? [])]) {
    expect(batch.resource).not.toBe('milk'); expect(batch.carcass?.species).not.toBe('dromedary');
  }
  for (const job of raw.jobs ?? []) {
    expect(Object.hasOwn(job.cost ?? {}, 'milk')).toBe(false); expect(Object.hasOwn(job.delivered ?? {}, 'milk')).toBe(false);
  }
  const settings = [...(raw.stockpiles ?? []), ...(raw.shelves ?? []).map((s: any) => s.settings),
    ...(raw.storageGroups ?? []).map((g: any) => g.settings), ...(raw.jobs ?? []).map((j: any) => j.storageSettings),
    ...batches.map((b: any) => b.furniture?.settings)].filter(Boolean);
  const all = ['silver', 'wood', 'stone', 'steel', 'components', 'food', 'grain', 'meat', 'milk', 'carcass', 'meal', 'chunk', 'cloth', 'herb', 'apparel', 'weapon', 'furniture', 'unfinished'];
  for (const setting of settings) if (setting.accepts.includes('milk')) {
    const accepted = [...setting.accepts].sort();
    expect([all.slice().sort(), all.filter(r => !['chunk', 'furniture', 'carcass'].includes(r)).sort()]).toContainEqual(accepted);
    setting.accepts = setting.accepts.filter((r: string) => r !== 'milk');
  }
  const policies = [...(raw.productionQueues ?? []).flatMap((q: any) => q.bills.map((b: any) => b.policy)),
    ...(raw.jobs ?? []).map((j: any) => j.productionPolicy), ...batches.map((b: any) => b.unfinished?.policy)].filter(Boolean);
  for (const p of policies) {
    if (p.allowedFood.includes('milk')) { expect(p.allowedFood).toEqual(['grain', 'meat', 'milk']); p.allowedFood = ['grain', 'meat']; }
    if (p.allowedCarcasses.includes('dromedary')) {
      expect([...p.allowedCarcasses].sort()).toEqual(['deer', 'dromedary', 'hare']); p.allowedCarcasses = ['hare', 'deer'];
    }
  }
}
/** Only remove unused new defaults from synthetic old-schema fixtures. */
export function stripAutoSlaughterFields(raw: Record<string, any>) {
  stripAnimalMilkFields(raw);
  const policy = { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
  if (Object.hasOwn(raw, 'autoSlaughter')) expect(raw.autoSlaughter).toEqual({ hare: policy, deer: policy });
  expect(raw.pawns?.some((p: any) => p.handleTask?.action === 'autoSlaughter')).not.toBe(true);
  delete raw.autoSlaughter;
}
/** Synthetic historical fixtures only. Never rewrite real historical saves. */
export function stripAutoRebuildFields(raw: Record<string, any>) {
  stripAutoSlaughterFields(raw);
  if (Object.hasOwn(raw, 'autoRebuild')) expect(raw.autoRebuild).toBe(false);
  expect(raw.fireDamage?.some((d:any) => d.kind === 'frame')).not.toBe(true);
  delete raw.autoRebuild;
}
