import { describe, expect, it } from 'vitest';
import { settleTrade, tradePrices, tradePriceImprovement, type PricedTradeOffer } from '../src/voxel/tradeRules';

describe('silver trade prices and atomic settlement', () => {
  it('applies native directional spread, difficulty and negotiator factors', () => {
    expect(tradePrices({ marketValue: 100, difficultyLoss: 0, negotiator: 0 })).toEqual({ buy: 140, sell: 60 });
    const prices = tradePrices({ marketValue: 100, difficultyLoss: .1, negotiator: .1 });
    expect(prices.buy).toBe(139);
    expect(prices.sell).toBeCloseTo(59.4, 10);
    expect(tradePrices({ marketValue: 1, difficultyLoss: .2, negotiator: .395, currency: true })).toEqual({ buy: 1, sell: 1 });
  });
  it('applies sequential capacity penalties and native allowed-defect thresholds', () => {
    expect(tradePriceImprovement(8, 1, 1)).toBeCloseTo(.12, 12);
    expect(tradePriceImprovement(8, .95, .8)).toBeCloseTo(.12, 12);
    expect(tradePriceImprovement(8, .475, .4)).toBeCloseTo(.0363, 12);
    expect(tradePriceImprovement(20, 2, 2)).toBeCloseTo(.3, 12);
  });
  it('rounds only high single prices, then caps sell price by buy price', () => {
    expect(tradePrices({ marketValue: .01, difficultyLoss: 0, negotiator: 0 })).toEqual({ buy: .5, sell: .01 });
    const threshold = tradePrices({ marketValue: 99.5 / 1.4, difficultyLoss: 0, negotiator: 0 });
    expect(threshold.buy).toBeCloseTo(99.5, 12);
    expect(tradePrices({ marketValue: 100.5 / 1.4, difficultyLoss: 0, negotiator: 0 }).buy).toBe(100);
    const capped = tradePrices({ marketValue: 100, difficultyLoss: 0, negotiator: .9 });
    expect(capped.sell).toBe(capped.buy);
  });
  const offers: PricedTradeOffer[] = [
    { side: 'colony', stockId: 1, amount: 50, unitPrice: .72, currency: false },
    { side: 'trader', stockId: 2, amount: 5, unitPrice: 44.8, currency: false },
    { side: 'colony', stockId: 3, amount: 200, unitPrice: 1, currency: true },
  ];
  it('settles a mixed cart in one combined integer transfer', () => {
    const result = settleTrade(offers, [{ side: 'colony', stockId: 1, amount: 50 }, { side: 'trader', stockId: 2, amount: 2 }], 200, 100);
    expect(result.ok).toBe(true);
    expect(result.selling).toBe(36);
    expect(result.buying).toBe(89.6);
    expect(result.silverToColony).toBe(-54);
    const fractional = settleTrade([
      { side: 'colony', stockId: 1, amount: 1, unitPrice: .4, currency: false },
      { side: 'colony', stockId: 2, amount: 1, unitPrice: .4, currency: false },
    ], [{ side: 'colony', stockId: 1, amount: 1 }, { side: 'colony', stockId: 2, amount: 1 }], 0, 100);
    expect(fractional.silverToColony).toBe(1);
  });
  it('requires explicit acceptance before the merchant can pay less than quoted', () => {
    const lines = [{ side: 'colony' as const, stockId: 1, amount: 50 }];
    const declined = settleTrade(offers, lines, 200, 20);
    expect(declined.ok).toBe(false);
    expect(declined.shortfall).toBe(16);
    const accepted = settleTrade(offers, lines, 200, 20, false, true);
    expect(accepted.ok).toBe(true);
    expect(accepted.quotedSilverToColony).toBe(36);
    expect(accepted.silverToColony).toBe(20);
    expect(settleTrade(offers, [{ side: 'trader', stockId: 2, amount: 5 }], 200, 100, false, true).ok).toBe(false);
  });
  it('permits an explicit silver gift without a balancing currency transfer', () => {
    const result = settleTrade(offers, [{ side: 'colony', stockId: 3, amount: 200 }], 200, 100, true);
    expect(result.ok).toBe(true);
    expect(result.giftGoodwillBase).toBe(5);
    expect(result.silverToColony).toBe(0);
    expect(settleTrade(offers, [{ side: 'trader', stockId: 2, amount: 1 }], 200, 100, true).ok).toBe(false);
  });
  it('rejects duplicate, stale, excessive or invalid lines without mutating offers', () => {
    const before = structuredClone(offers);
    const line = { side: 'colony' as const, stockId: 1, amount: 1 };
    for (const lines of [[line, line], [{ ...line, stockId: 99 }], [{ ...line, amount: 51 }],
      [{ ...line, amount: .5 }], [{ ...line, amount: NaN }], [{ ...line, amount: -1 }],
      [{ ...line, stockId: 3 }], []]) expect(settleTrade(offers, lines, 200, 100).ok).toBe(false);
    expect(offers).toEqual(before);
  });
});
