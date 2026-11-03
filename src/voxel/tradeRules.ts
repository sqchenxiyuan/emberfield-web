import { unityRound } from './wealth';
import type { Difficulty } from './storyteller';

/** Core 1.7 silver trade. All prices retain fractional values until the native
 * >99.5 single-price threshold; settlement rounds the combined net only once. */
export interface TradePriceFactors {
  marketValue: number;
  difficultyLoss: number;
  negotiator: number;
  buyType?: number;
  sellType?: number;
  sellFactor?: number;
  humanSellFactor?: number;
  joinAsFactor?: number;
  settlement?: number;
  drugBonus?: number;
  animalBonus?: number;
  currency?: boolean;
}
export const TRADE_DIFFICULTY_LOSS: Record<Difficulty, number> = {
  peaceful: 0, easy: 0, medium: 0, rough: 0, hard: .1, extreme: .2,
};
/** Faction.TryAffectGoodwillWith; this project's sole neutral faction has natural=0. */
export function affectGoodwill(current: number, delta: number, natural = 0): number {
  if ((natural < current && delta < 0) || (natural > current && delta > 0))
    delta += Math.sign(delta) * unityRound(.25 * Math.min(Math.abs(current - natural), Math.abs(delta)));
  return Math.max(-100, Math.min(100, current + delta));
}
export function tradePrices(f: TradePriceFactors): { buy: number; sell: number } {
  if (!Number.isFinite(f.marketValue) || f.marketValue < 0 ||
      ![f.difficultyLoss, f.negotiator, f.buyType ?? 1, f.sellType ?? 1,
        f.sellFactor ?? 1, f.humanSellFactor ?? 1, f.joinAsFactor ?? 1,
        f.settlement ?? 0, f.drugBonus ?? 0, f.animalBonus ?? 0].every(Number.isFinite))
    throw new RangeError('交易价格因素无效');
  if (f.currency) return { buy: f.marketValue, sell: f.marketValue };
  let buy = Math.max(.5, f.marketValue * 1.4 * (f.buyType ?? 1) * (f.joinAsFactor ?? 1) *
    (1 + f.difficultyLoss) * (1 - f.negotiator - (f.settlement ?? 0)));
  let sell = Math.max(.01, f.marketValue * .6 * (f.sellType ?? 1) * (f.sellFactor ?? 1) *
    (f.humanSellFactor ?? 1) * (1 - f.difficultyLoss) *
    (1 + f.negotiator + (f.settlement ?? 0) + (f.drugBonus ?? 0) + (f.animalBonus ?? 0)));
  if (buy > 99.5) buy = unityRound(buy);
  if (sell > 99.5) sell = unityRound(sell);
  return { buy, sell: Math.min(sell, buy) };
}
/** StatWorker applies each capacity factor sequentially, not as an average.
 * No traits, titles, genes, trade inspirations or equipment offsets exist yet. */
export function tradePriceImprovement(social: number, talking: number, hearing: number): number {
  if (![social, talking, hearing].every(Number.isFinite) || social < 0 || social > 20 ||
      talking < 0 || hearing < 0) throw new RangeError('谈判技能或能力无效');
  const capacity = (value: number, defect: number) =>
    Math.min(1, value < 1 ? Math.max(0, Math.min(1, value / (1 - defect))) : value);
  return Math.max(0, Math.min(.395, social * .015 *
    (.1 + .9 * capacity(talking, .05)) * (.1 + .9 * capacity(hearing, .2))));
}

export type TradeSide = 'colony' | 'trader';
export interface TradeLine { side: TradeSide; stockId: number; amount: number }
export interface PricedTradeOffer {
  side: TradeSide;
  stockId: number;
  amount: number;
  unitPrice: number;
  currency: boolean;
}
export interface Settlement {
  ok: boolean;
  reason: string;
  buying: number;
  selling: number;
  /** Positive means the colony receives silver. Gift silver is a normal line. */
  silverToColony: number;
  quotedSilverToColony: number;
  shortfall: number;
  /** Sell-price value / 40, before the native faction goodwill curve. */
  giftGoodwillBase: number;
}
export function settleTrade(
  offers: readonly PricedTradeOffer[], lines: readonly TradeLine[],
  colonySilver: number, traderSilver: number, gift = false, acceptShortfall = false,
): Settlement {
  const result: Settlement = { ok: false, reason: '', buying: 0, selling: 0,
    silverToColony: 0, quotedSilverToColony: 0, shortfall: 0, giftGoodwillBase: 0 };
  const fail = (reason: string) => ({ ...result, reason });
  if (![colonySilver, traderSilver].every(n => Number.isSafeInteger(n) && n >= 0) ||
      typeof gift !== 'boolean' || typeof acceptShortfall !== 'boolean' ||
      !Array.isArray(lines) || lines.length > 10000) return fail('交易数量或货币无效');
  const seen = new Set<string>();
  let entries = 0;
  for (const line of lines) {
    if (!line || !['colony', 'trader'].includes(line.side) || !Number.isSafeInteger(line.stockId) ||
        !Number.isSafeInteger(line.amount) || line.amount < 0) return fail('交易数量必须是非负整数');
    const key = `${line.side}:${line.stockId}`;
    if (seen.has(key)) return fail('同一物品不能重复提交');
    seen.add(key);
    if (!line.amount) continue;
    entries++;
    const offer = offers.find(o => o.side === line.side && o.stockId === line.stockId);
    if (!offer || line.amount > offer.amount || !Number.isFinite(offer.unitPrice) || offer.unitPrice < 0)
      return fail('物品已经变化，请刷新报价');
    if (gift && line.side !== 'colony') return fail('赠礼只能送出殖民地物品');
    if (!gift && offer.currency) return fail('银币由交易差额自动结算');
    if (line.side === 'colony') result.selling += offer.unitPrice * line.amount;
    else result.buying += offer.unitPrice * line.amount;
  }
  if (!entries) return fail('尚未选择交易物品');
  if (gift) result.giftGoodwillBase = result.selling / 40;
  else {
    result.quotedSilverToColony = unityRound(result.selling - result.buying);
    result.silverToColony = result.quotedSilverToColony;
    if (result.silverToColony < -colonySilver) return fail('殖民地可用于交易的银币不足');
    result.shortfall = Math.max(0, result.silverToColony - traderSilver);
    if (result.shortfall && !acceptShortfall) return fail(`商人少 ${result.shortfall} 银币；可以减少出售或明确接受少收`);
    result.silverToColony = Math.min(result.silverToColony, traderSilver);
  }
  result.ok = true;
  return result;
}
