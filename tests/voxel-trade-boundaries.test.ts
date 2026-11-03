import { beforeAll, describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { quoteTrade, tradeHarmed, tradeHostile } from '../src/voxel/tradeWorld';
import { at, type VoxelSave, type Cargo } from '../src/voxel/types';
import { freshBatch, rotLimit } from '../src/voxel/preservation';
import { makeWeapon } from '../src/voxel/weapons';
import { makeApparel } from '../src/voxel/apparel';
import { affectGoodwill } from '../src/voxel/tradeRules';

// Deliberate controlled initial merchant/stock/health/space scenarios. These do
// not establish naturally scheduled arrivals or a normal colony economy.
let base: VoxelSave;
beforeAll(() => {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  s.tradeSpawn();
  expect(s.command({ type: 'tradeTalk', pawnId: s.pawns[0].id, caravanId: s.trade.caravans[0].id }).ok).toBe(true);
  for (let n = 0; n < 2000 && !quoteTrade(s); n++) s.step();
  expect(quoteTrade(s)).not.toBeNull();
  base = s.save();
});
function market() {
  const s = VoxelSimulation.load(base), c = s.trade.caravans[0];
  return { s, c, p: s.pawns.find(p => p.id === s.trade.session!.pawnId)!, trader: s.pawns.find(p => p.id === c.traderId)! };
}
function commit(s: VoxelSimulation, side: 'colony' | 'trader', stockId: number, amount: number, gift = false, acceptShortfall = false) {
  const q = quoteTrade(s)!;
  return s.command({ type: 'tradeCommit', sessionId: q.sessionId, quoteKey: q.key,
    lines: [{ side, stockId, amount }], gift, acceptShortfall });
}
function add(s: VoxelSimulation, batch: Cargo, origin = s.spawn) {
  const plan = s.tradePlace([{ batch, origin }], s.items)!;
  expect(plan).not.toBeNull(); s.tradeApplyPlacement(plan);
  const item = s.items.find(i => batch.weapon ? i.weapon?.id === batch.weapon.id : batch.apparel ? i.apparel?.id === batch.apparel.id : i.resource === batch.resource)!;
  s.homeArea.add(at(item)); return item;
}
const currency = (s: VoxelSimulation) => s.items.filter(i => i.resource === 'silver').reduce((n, i) => n + i.amount, 0) +
  s.trade.caravans.flatMap(c => c.stock).filter(i => i.resource === 'silver').reduce((n, i) => n + i.amount, 0);

describe('trade transactional and lifecycle boundaries', () => {
  it('does not mutate either owner on insufficient funds, invalid quantities or a stale physical quote', () => {
    const { s, c, trader } = market();
    c.stock.push({ ...freshBatch('components', 1000), id: s.nextId++, carrierId: trader.id });
    const item = c.stock.at(-1)!, before = s.save();
    for (const amount of [1000, -1, 1.5, Infinity]) {
      expect(commit(s, 'trader', item.id, amount).ok).toBe(false); expect(s.save()).toEqual(before);
    }
    const q = quoteTrade(s)!; item.amount--;
    const stale = s.save();
    expect(s.command({ type: 'tradeCommit', sessionId: q.sessionId, quoteKey: q.key,
      lines: [{ side: 'trader', stockId: item.id, amount: 1 }], gift: false, acceptShortfall: false }).ok).toBe(false);
    expect(s.save()).toEqual(stale);
  });
  it('requires explicit merchant-shortfall consent and conserves real silver and sold materials', () => {
    const { s, c } = market(); c.kind = 'bulk';
    c.stock = c.stock.filter(i => i.resource !== 'silver');
    const source = add(s, freshBatch('steel', 25));
    const before = s.save(), total = currency(s);
    expect(commit(s, 'colony', source.id, source.amount).ok).toBe(false);
    expect(s.save()).toEqual(before);
    expect(commit(s, 'colony', source.id, source.amount, false, true).ok).toBe(true);
    expect(s.trade.receipts.at(-1)).toMatchObject({ silverToColony: 0 });
    expect(s.trade.receipts.at(-1)!.shortfall).toBeGreaterThan(0);
    expect(currency(s)).toBe(total); expect(s.trade.exported.steel).toBe(source.amount);
    expect(VoxelSimulation.load(s.save()).trade.receipts).toEqual(s.trade.receipts);
  });
  it('gifts actual silver, applies natural-goodwill adjustment, and does not invent Social XP', () => {
    const { s, p } = market(); s.trade.goodwill = -10;
    const q = quoteTrade(s)!, silver = q.offers.find(o => o.side === 'colony' && o.currency)!;
    const total = currency(s), skill = structuredClone(p.skills.social), before = s.counts().silver;
    expect(commit(s, 'colony', silver.stockId, 160, true).ok).toBe(true);
    expect(s.counts().silver).toBe(before - 160); expect(currency(s)).toBe(total);
    expect(s.trade.goodwill).toBe(-5); expect(p.skills.social).toEqual(skill);
    expect(s.trade.receipts[0]).toMatchObject({ gift: true, silverToColony: 0, shortfall: 0 });
    expect(VoxelSimulation.load(s.save()).trade.goodwill).toBe(-5);
    expect(affectGoodwill(10, -6)).toBe(2);
    expect(affectGoodwill(-2, 10)).toBe(8);
  });
  it('cancels a different colonist fetching a sold weapon or garment before save', () => {
    for (const kind of ['weapon', 'apparel'] as const) {
      const { s, c, trader } = market(); c.kind = kind === 'weapon' ? 'combat' : 'bulk';
      const other = s.pawns.find(p => p.faction === 'colony' && p.id !== s.trade.session!.pawnId)!;
      const gearId = s.nextId++;
      const item = add(s, kind === 'weapon' ? { resource: kind, amount: 1, weapon: makeWeapon(gearId, 'steelKnife') } :
        { resource: kind, amount: 1, apparel: makeApparel(gearId, 'parka') }, trader);
      const result = kind === 'weapon' ? s.command({ type: 'equipWeapon', pawnId: other.id, weaponId: gearId }) :
        s.command({ type: 'wear', pawnId: other.id, apparelId: gearId });
      expect(result.ok, result.message).toBe(true);
      expect(kind === 'weapon' ? other.weaponTask?.stage : other.apparelTask?.stage).toBe('fetch');
      expect(() => VoxelSimulation.load(s.save())).not.toThrow();
      expect(commit(s, 'colony', item.id, 1).ok).toBe(true);
      expect(other.weaponTask).toBeNull(); expect(other.apparelTask).toBeNull();
      expect(VoxelSimulation.load(s.save()).pawns.find(p => p.id === other.id)?.phase).not.toBe(kind);
    }
  });
  it('preserves age, gear identity and the forbidden flag when goods change owners', () => {
    const { s, c, trader } = market(); c.kind = 'combat';
    const gearId = s.nextId++, stockId = s.nextId++;
    c.stock.push({ resource: 'weapon', amount: 1, weapon: makeWeapon(gearId, 'steelKnife'), forbidden: true, id: stockId, carrierId: trader.id });
    expect(commit(s, 'trader', stockId, 1).ok).toBe(true);
    expect(s.items.find(i => i.weapon?.id === gearId)).toMatchObject({ forbidden: true });
    expect(c.stock.some(i => i.weapon?.id === gearId)).toBe(false);
    expect(VoxelSimulation.load(s.save()).items.find(i => i.weapon?.id === gearId)).toMatchObject({ forbidden: true });
    expect(s.command({ type: 'tradeTalk', pawnId: s.pawns[0].id, caravanId: c.id }).ok).toBe(true); s.step();
    const age = 1234.25, grainId = s.nextId++;
    c.stock.push({ ...freshBatch('grain', 7, 'corn'), rotProgress: age, id: grainId, carrierId: trader.id });
    for (let n = 0; n < 100 && !quoteTrade(s); n++) s.step();
    const beforeAge = c.stock.find(i => i.id === grainId)!.rotProgress!;
    expect(commit(s, 'trader', grainId, 7).ok).toBe(true);
    const corn = s.items.filter(i => i.resource === 'grain' && i.crop === 'corn');
    expect(corn.reduce((n, i) => n + i.amount, 0)).toBe(7);
    expect(corn.reduce((n, i) => n + i.amount * i.rotProgress!, 0)).toBeCloseTo(7 * beforeAge, 8);
  });
  it('releases a caregiver whose reserved food is sold, without losing the patient or creating an unreadable save', () => {
    const { s, c, p } = market(); c.kind = 'bulk';
    const [doctor, patient] = s.pawns.filter(q => q.faction === 'colony' && q.id !== p.id);
    const spot = (s as any).nearby(s.spawn, 8).find((v: any) => [v, { ...v, x: v.x + 1 }].every(q =>
      (s as any).groundAllowed(q) && !s.items.some(i => at(i) === at(q)) && !s.trees.some(t => at(t) === at(q))));
    const bed = { ...spot, id: s.nextId++, axis: 'x' as const, medical: true, owner: null };
    s.beds.push(bed); Object.assign(patient, spot);
    patient.health.malnutrition = .82; patient.food = 0;
    (s as any).reconcileHealth(patient); patient.sleepBedId = bed.id;
    const result = s.command({ type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    expect(result.ok, result.message).toBe(true); expect(doctor.carePhase).toBe('feedFetch');
    const item = s.items.find(i => i.id === doctor.careFoodId)!; s.homeArea.add(at(item));
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    expect(commit(s, 'colony', item.id, item.amount).ok).toBe(true);
    expect(doctor.carePhase).toBeNull(); expect(patient.downed).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('requires Home or any stockpile plus reachability, and excludes carried inventory', () => {
    const { s, c, trader } = market(); c.kind = 'bulk';
    const item = add(s, freshBatch('steel', 5), trader);
    s.homeArea.clear(); s.stockpiles = [];
    expect(quoteTrade(s)!.offers.some(o => o.side === 'colony' && o.stockId === item.id)).toBe(false);
    expect(s.command({ type: 'designate', tool: 'stock', from: item }).ok).toBe(true);
    expect(s.command({ type: 'storage', from: item, priority: 1, accepts: ['wood'] }).ok).toBe(true);
    expect(quoteTrade(s)!.offers.some(o => o.side === 'colony' && o.stockId === item.id)).toBe(true);
    s.stockpiles = []; s.homeArea.add(at(item));
    expect(quoteTrade(s)!.offers.some(o => o.side === 'colony' && o.stockId === item.id)).toBe(true);
    s.items = s.items.filter(i => i.id !== item.id);
    const other = s.pawns.find(p => p.faction === 'colony' && p.id !== s.trade.session!.pawnId)!;
    other.cargo = freshBatch('steel', 5);
    expect(quoteTrade(s)!.offers.some(o => o.side === 'colony' && o.batch.resource === 'steel')).toBe(false);
  });
  it('rolls back a whole purchase when physical landing space is full', () => {
    const { s, c, trader } = market();
    const cells = (s as any).nearby(trader).filter((p: any) => (s as any).groundAllowed(p));
    const occupied = new Set(cells.map(at));
    // Keep payable silver outside the finite drop neighborhood.
    s.items = s.items.filter(i => !occupied.has(at(i)));
    for (const p of cells) s.items.push({ ...p, ...freshBatch('stone', 75), id: s.nextId++ });
    const moneyCell = (s as any).nearby(trader, 7).find((p: any) => !occupied.has(at(p)) &&
      (s as any).groundAllowed(p) && !s.items.some(i => at(i) === at(p)));
    const money = { ...moneyCell, ...freshBatch('silver', 500), id: s.nextId++ };
    s.items.push(money); s.homeArea.add(at(money));
    const offer = c.stock.find(i => i.resource === 'apparel' || i.resource === 'weapon')!;
    const before = s.save();
    const result = commit(s, 'trader', offer.id, 1);
    expect(result.ok).toBe(false); expect(result.message).toContain('落货空间');
    expect(s.save()).toEqual(before);
  });
  it('counts visitor weapons as foreign until an actual drop and keeps production targets local', () => {
    const { s, trader } = market();
    const pieces = (s as any).weaponPieces();
    expect(pieces.some((w: any) => w.id === trader.weapon!.id)).toBe(false);
    const before = s.counts().weapon, gearId = trader.weapon!.id;
    expect((s as any).dropPrimary(trader, true)).toBe(true);
    expect(s.counts().weapon).toBe(before + 1); expect(s.trade.imported.weapon).toBe(1);
    expect((s as any).weaponPieces().some((w: any) => w.id === gearId)).toBe(true);
    expect(VoxelSimulation.load(s.save()).trade.imported.weapon).toBe(1);
  });
  it('penalizes deliberate hits using incoming damage and exempts only crossfire between mutual enemies', () => {
    const { s, p, trader } = market();
    tradeHarmed(s, p, trader, { ...p, faction: 'raider' }, 50);
    expect(s.trade.goodwill).toBe(0);
    tradeHarmed(s, p, trader, p, 10); expect(s.trade.goodwill).toBe(-13);
    tradeHarmed(s, p, trader, trader, 50); expect(s.trade.goodwill).toBe(-78);
    expect(tradeHostile(p, trader, s.trade.goodwill)).toBe(true);
    expect(s.trade.session).toBeNull(); expect(s.trade.caravans[0].stage).toBe('leaving');
    expect(s.command({ type: 'tradeTalk', pawnId: p.id, caravanId: s.trade.caravans[0].id }).ok).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('ages foreign stock and drops it once if its actual carrier is downed', () => {
    const { s, c, trader } = market();
    const item = { ...freshBatch('grain', 3, 'rice'), rotProgress: rotLimit(freshBatch('grain', 1, 'rice'))! - .5, id: s.nextId++, carrierId: trader.id };
    c.stock.push(item); s.step();
    expect(c.stock.some(i => i.id === item.id)).toBe(false);
    expect(s.trade.imported.grain).toBe(0);
    c.stock = [{ ...freshBatch('silver', 35), id: s.nextId++, carrierId: trader.id }];
    trader.health.malnutrition = .82; trader.food = 0; (s as any).reconcileHealth(trader);
    expect(trader.downed).toBe(true);
    const total = currency(s); s.step();
    expect(c.stock).toEqual([]); expect(s.trade.imported.silver).toBe(35);
    expect(currency(s)).toBe(total); s.step(); expect(s.trade.imported.silver).toBe(35);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('cancels negotiation on drafting and eventually removes a departing merchant with no stock refresh', () => {
    const { s, c, p } = market();
    expect(s.command({ type: 'draft', pawnId: p.id, drafted: true }).ok).toBe(true);
    expect(s.trade.session).toBeNull();
    c.stage = 'leaving';
    const clone = VoxelSimulation.load(s.save());
    expect(clone.trade.caravans[0].stock).toEqual(c.stock);
    for (let n = 0; n < 2000 && s.pawns.some(p => p.id === c.traderId); n++) s.step();
    expect(s.pawns.some(p => p.id === c.traderId)).toBe(false);
    expect(s.trade.imported.silver).toBe(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('rejects tampered current calendar, owners, duplicated gear and stale sessions', () => {
    const mutations = [
      (v: VoxelSave) => { v.trade.nextVisit = 1; },
      (v: VoxelSave) => { v.trade.caravans[0].stock[0].carrierId = v.pawns[0].id; },
      (v: VoxelSave) => { v.trade.caravans[0].stock.push(structuredClone(v.trade.caravans[0].stock[0])); },
      (v: VoxelSave) => { v.trade.session!.pawnId = v.trade.caravans[0].traderId; },
      (v: VoxelSave) => { v.trade.imported.silver = -1; },
      (v: VoxelSave) => { v.homeArea.push(v.homeArea[0]); },
      (v: VoxelSave) => { v.trade.caravans[0].stock[0].id = v.trade.caravans[0].id; },
    ];
    for (const mutate of mutations) { const bad = structuredClone(base); mutate(bad); expect(() => VoxelSimulation.load(bad)).toThrow(); }
  });
});
