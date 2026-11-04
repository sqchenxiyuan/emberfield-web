import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { quoteTrade } from '../src/voxel/tradeWorld';
import { initialTrade, traderAccepts } from '../src/voxel/trade';
import { colonyWealthDetails } from '../src/voxel/wealth';
import { freshBatch } from '../src/voxel/preservation';
import { makeWeapon } from '../src/voxel/weapons';
import { makeApparel } from '../src/voxel/apparel';

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/voxel-v20-trade-${name}.json`, 'utf8'));
/** Controlled module setup, not evidence of a naturally scheduled arrival. */
function market() {
  const sim = new VoxelSimulation(73129);
  sim.tradeSpawn();
  expect(sim.trade.caravans).toHaveLength(1);
  const caravan = sim.trade.caravans[0], p = sim.pawns.find(p => p.faction === 'colony')!;
  expect(sim.command({ type: 'tradeTalk', pawnId: p.id, caravanId: caravan.id }).ok).toBe(true);
  for (let n = 0; n < 2000 && !quoteTrade(sim); n++) sim.step();
  expect(sim.trade.session?.stage).toBe('ready');
  const quote = quoteTrade(sim)!;
  expect(quote).not.toBeNull();
  return { sim, caravan, p, quote };
}
describe('physical trade, visitors and genuine v20 migration', () => {
  it('migrates seven genuine saves without giving old colonies silver or moving an appointment', () => {
    for (const name of ['initial', 'working', 'carrying', 'combat', 'injured', 'recovered', 'scheduled']) {
      const old = fixture(name), sim = VoxelSimulation.load(old), saved = sim.save();
      expect(saved.version).toBe(47);
      expect(saved.items).toEqual(old.items);
      expect(saved.storyteller).toEqual(old.storyteller);
      expect(saved.trade).toEqual(initialTrade(old.seed, old.tick));
      expect(saved.trade.imported.silver).toBe(0);
      expect(saved.stats.produced.silver).toBe(0);
      expect(saved.pawns.map(p => p.cargo)).toEqual(old.pawns.map((p: any) => p.cargo));
      expect(VoxelSimulation.load(saved).save().trade).toEqual(saved.trade);
    }
  });
  it('keeps the native trader category exclusions, including gifts', () => {
    for (const resource of ['wood', 'stone', 'chunk', 'meal', 'herb'] as const)
      for (const kind of ['bulk', 'combat'] as const) expect(traderAccepts(kind, freshBatch(resource, 1))).toBe(false);
    const weapon = { resource: 'weapon' as const, amount: 1, weapon: makeWeapon(1, 'steelKnife') };
    expect(traderAccepts('bulk', weapon)).toBe(false);
    expect(traderAccepts('combat', weapon)).toBe(true);
    const coat = { resource: 'apparel' as const, amount: 1, apparel: makeApparel(2, 'parka') };
    expect(traderAccepts('bulk', coat)).toBe(true);
    expect(traderAccepts('combat', coat)).toBe(false);
  });
  it('actually walks to a living merchant and excludes merchant inventory from colony wealth', () => {
    const { sim, caravan, p, quote } = market();
    const trader = sim.pawns.find(p => p.id === caravan.traderId)!;
    expect(Math.abs(p.x - trader.x) + Math.abs(p.y - trader.y) + Math.abs(p.z - trader.z)).toBeLessThanOrEqual(1);
    const before = colonyWealthDetails(sim), inventory = sim.counts();
    const silver = caravan.stock.find(i => i.resource === 'silver')!;
    silver.amount += 100;
    expect(colonyWealthDetails(sim)).toEqual(before);
    expect(sim.counts()).toEqual(inventory);
    expect(quote.colonySilver).toBe(800);
    expect(VoxelSimulation.load(sim.save()).trade.caravans).toEqual(sim.trade.caravans);
  }, 10000); // The published baseline also exceeds 5s after the seven-save migration warmup.
  it('commits both goods and silver once and rejects replay without changing anything', () => {
    const { sim, caravan, quote } = market();
    const offer = quote.offers.find(o => o.side === 'trader' && !o.currency && o.unitPrice < 800)!;
    const beforeSilver = sim.counts().silver;
    const beforeOwned = sim.counts()[offer.batch.resource];
    const command = { type: 'tradeCommit' as const, sessionId: quote.sessionId, quoteKey: quote.key,
      lines: [{ side: 'trader' as const, stockId: offer.stockId, amount: 1 }], gift: false, acceptShortfall: false };
    expect(sim.command(command).ok).toBe(true);
    const receipt = sim.trade.receipts.at(-1)!;
    expect(sim.counts().silver).toBe(beforeSilver + receipt.silverToColony);
    expect(sim.counts()[offer.batch.resource]).toBe(beforeOwned + 1);
    expect(sim.trade.imported[offer.batch.resource]).toBe(1);
    expect(sim.trade.exported.silver).toBe(-receipt.silverToColony);
    expect(caravan.stock.find(i => i.id === offer.stockId)?.amount ?? 0).toBe(offer.amount - 1);
    const after = sim.save();
    expect(sim.command(command).ok).toBe(false);
    expect(sim.save()).toEqual(after);
    expect(VoxelSimulation.load(after).save().trade).toEqual(after.trade);
  }, 10000);
  it('rejects a stale price and cancellation leaves physical goods and currency untouched', () => {
    const { sim, quote } = market();
    const offer = quote.offers.find(o => o.side === 'trader' && !o.currency)!;
    expect(sim.command({ type: 'difficulty', difficulty: 'extreme' }).ok).toBe(true);
    const before = sim.save();
    expect(sim.command({ type: 'tradeCommit', sessionId: quote.sessionId, quoteKey: quote.key,
      lines: [{ side: 'trader', stockId: offer.stockId, amount: 1 }], gift: false, acceptShortfall: false }).ok).toBe(false);
    expect(sim.save()).toEqual(before);
    expect(sim.command({ type: 'tradeCancel', sessionId: quote.sessionId }).ok).toBe(true);
    expect(sim.items).toEqual(before.items);
    expect(sim.trade.caravans).toEqual(before.trade.caravans);
    expect(sim.trade.receipts).toEqual([]);
    expect(VoxelSimulation.load(sim.save()).trade.session).toBeNull();
  });
});
