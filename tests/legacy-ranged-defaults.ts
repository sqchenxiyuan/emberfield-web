import { expect } from 'vitest';
import { stripMedicineDefaults } from './legacy-medicine-defaults';
/** Older synthetic schema tests start from a current empty test world. Remove
 * newer defaults before applying that test's historical schema conversion.
 * Authentic historical fixture bytes never pass through this helper. */
export function stripRangedDefaults(raw: Record<string, any>) {
  // No wildlife activity belongs to the older schemas represented by these
  // synthetic fixtures. Preserve real resource assertions before stripping defaults.
  expect(raw.animals.every((a: any) => !a.dead && !a.hunt)).toBe(true);
  expect(raw.butcherSpots).toEqual([]);
  expect(raw.items.some((i: any) => ['meat', 'carcass'].includes(i.resource))).toBe(false);
  expect(raw.jobs.some((j: any) => ['butcher', 'butcherSpot'].includes(j.kind))).toBe(false);
  for (const p of raw.pawns) {
    expect(p.phase).not.toBe('hunt');
    expect(['meat', 'carcass'].includes(p.cargo?.resource)).toBe(false);
    delete p.priorities.hunt;
  }
  for (const ledger of [raw.stats.produced, raw.stats.consumed, raw.stats.spoiled, raw.stats.destroyed,
    raw.trade.imported, raw.trade.exported]) {
    for (const resource of ['meat', 'carcass']) {
      expect(ledger[resource]).toBe(0);
      delete ledger[resource];
    }
  }
  for (const pile of raw.stockpiles)
    pile.accepts = pile.accepts.filter((r: string) => !['meat', 'carcass'].includes(r));
  delete raw.animals;
  delete raw.butcherSpots;
  expect(raw.trade.caravans).toEqual([]);
  expect(raw.trade.receipts).toEqual([]);
  expect(raw.items.filter((i: any) => i.resource === 'silver').reduce((n: number, i: any) => n + i.amount, 0)).toBeLessThanOrEqual(800);
  raw.items = raw.items.filter((i: any) => i.resource !== 'silver');
  for (const pile of raw.stockpiles) pile.accepts = pile.accepts.filter((r: string) => r !== 'silver');
  for (const key of ['produced', 'consumed', 'spoiled', 'destroyed']) delete raw.stats[key].silver;
  for (const p of raw.pawns) { expect(p.skills.social.xp).toBe(0); delete p.skills.social; }
  delete raw.trade;
  delete raw.homeArea;
  expect(raw.storyteller.events).toEqual([]);
  expect(raw.storyteller.losses).toEqual([]);
  expect(raw.storyteller.adaptationDays).toBe(0);
  expect(raw.structureKinds).toEqual([0, 64 * 64 * 16]);
  delete raw.storyteller;
  delete raw.structureKinds;
  stripMedicineDefaults(raw);
  for (const key of ['projectiles', 'combatEvents', 'sandbags']) {
    expect(raw[key]).toEqual([]);
    delete raw[key];
  }
  for (const key of ['Machining', 'Gunsmithing', 'BlowbackOperation']) {
    expect(raw.research.progress[key]).toBe(0);
    delete raw.research.progress[key];
  }
  for (const p of raw.pawns) {
    expect(p.shooting).toBeNull();
    expect(p.staggerUntil).toBe(0);
    expect(p.skills.shooting.xp).toBe(0);
    delete p.shooting;
    delete p.staggerUntil;
    delete p.skills.shooting;
  }
  for (const b of raw.weaponBenches) {
    expect(b.kind).not.toBe('machining');
    expect(b.power).toBeUndefined();
    expect(b.bills.find((bill: any) => bill.kind === 'shortBow')).toEqual({
      kind: 'shortBow',
      target: 0,
      paused: false,
    });
    b.bills = b.bills.filter((bill: any) => bill.kind !== 'shortBow');
  }
}
