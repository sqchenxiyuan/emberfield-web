import { at, inside, type Cargo, type CommandResult, type Pawn, type Pos, type Stack } from './types';
import { freshBatch, portion, advanceRot } from './preservation';
import { cargoMarketValue } from './wealth';
import { healthSummary } from './survival';
import { advanceTradeCalendar, giftGoodwill, saleFactor, traderAccepts } from './trade';
import { affectGoodwill, settleTrade, tradePrices, tradePriceImprovement, TRADE_DIFFICULTY_LOSS } from './tradeRules';
import type { Difficulty } from './storyteller';
import type { TradeCommand, TradeQuote, TradeState, TraderCaravan, TraderStock } from './tradeTypes';

export interface Placement { items: Stack[]; nextId: number }
export interface TradeHost {
  socialDepart(pawn: Pawn): void;
  seed: number; tick: number; nextId: number; revision: number; notice: string;
  pawns: Pawn[]; items: Stack[]; homeArea: Set<number>; trade: TradeState;
  storyteller: { difficulty: Difficulty };
  stockpiles: Pos[];
  path(from: Pos, to: Pos): number[] | null;
  tradeReachable(pawn: Pawn): Set<number>;
  tradePlace(entries: { batch: Cargo; origin: Pos }[], base: Stack[]): Placement | null;
  tradeApplyPlacement(plan: Placement): void;
  tradeRelease(pawn: Pawn): void;
  tradeDropCargo(pawn: Pawn): boolean;
  tradeSpawn(): void;
  tradeExit(pawn: Pawn): number[] | null;
  tradeTemperature(pawn: Pawn): number;
}
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const distance = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
export const tradeHostile = (a: Pick<Pawn, 'faction'>, b: Pick<Pawn, 'faction'>, goodwill: number) => a.faction !== 'prisoner' && b.faction !== 'prisoner' && a.faction !== b.faction &&
  (a.faction === 'raider' || b.faction === 'raider' || goodwill <= -75);
/** Native damage notification uses incoming Amount, even if armor absorbs it.
 * Crossfire is exempt only when the intended target is hostile to both sides. */
export function tradeHarmed(s: TradeHost, attacker: Pick<Pawn, 'faction'>, victim: Pawn, intended: Pawn | undefined, amount: number) {
  if (attacker.faction !== 'colony' || victim.faction !== 'trader' || s.trade.goodwill <= -75) return;
  if (intended && tradeHostile(attacker, intended, s.trade.goodwill) && tradeHostile(victim, intended, s.trade.goodwill)) return;
  s.trade.goodwill = affectGoodwill(s.trade.goodwill, Math.trunc(-1.3 * Math.min(100, amount)));
  if (s.trade.goodwill <= -75) {
    cancelSession(s);
    for (const c of s.trade.caravans) { c.stage = 'leaving'; c.reason = '关系已敌对，商队战斗撤离'; }
  }
}
export function canNegotiate(pawn: Pawn | undefined): pawn is Pawn {
  return !!pawn && pawn.faction === 'colony' && !pawn.dead && !pawn.downed && !pawn.drafted &&
    pawn.carriedBy === null && healthSummary(pawn).talking > 0;
}
function canTrade(s: TradeHost, caravan: TraderCaravan | undefined): caravan is TraderCaravan {
  const trader = s.pawns.find(p => p.id === caravan?.traderId);
  return !!caravan && s.trade.goodwill > -75 && !!trader && !trader.dead && !trader.downed &&
    trader.carriedBy === null && trader.attackTargetId === null;
}
function cancelSession(s: TradeHost) {
  const p = s.pawns.find(p => p.id === s.trade.session?.pawnId);
  s.trade.session = null;
  if (p?.phase === 'trade') s.tradeRelease(p);
}
/** Native sale candidates are spawned, touch-reachable and in Home or storage.
 * Forbid does not exclude them; worn, carried and delivered inputs are not rows. */
export function quoteTrade(s: TradeHost): TradeQuote | null {
  const session = s.trade.session;
  if (!session || session.stage !== 'ready') return null;
  const caravan = s.trade.caravans.find(c => c.id === session.caravanId);
  const pawn = s.pawns.find(p => p.id === session.pawnId);
  if (!canTrade(s, caravan) || !canNegotiate(pawn) || pawn.phase !== 'trade') return null;
  const trader = s.pawns.find(p => p.id === caravan.traderId)!;
  if (distance(pawn, trader) > 1) return null;
  const accessible = s.tradeReachable(trader), health = healthSummary(pawn);
  const improvement = tradePriceImprovement(pawn.skills.social.level, health.talking, health.hearing);
  const difficultyLoss = TRADE_DIFFICULTY_LOSS[s.storyteller.difficulty];
  const offers: TradeQuote['offers'] = [];
  const add = (side: 'colony' | 'trader', stock: Stack | TraderStock) => {
    const batch = portion(stock, stock.amount), marketValue = cargoMarketValue(portion(stock, 1));
    const prices = tradePrices({ marketValue, difficultyLoss, negotiator: improvement,
      sellFactor: saleFactor(stock), currency: stock.resource === 'silver' });
    offers.push({ side, stockId: stock.id, amount: stock.amount, batch, marketValue,
      unitPrice: side === 'colony' ? prices.sell : prices.buy, currency: stock.resource === 'silver' });
  };
  for (const stock of s.items) if ((s.homeArea.has(at(stock)) || s.stockpiles.some(p => same(p, stock))) &&
    accessible.has(at(stock)) && traderAccepts(caravan.kind, stock)) add('colony', stock);
  for (const stock of caravan.stock) if (stock.resource !== 'carcass' &&
    s.pawns.some(p => p.id === stock.carrierId && !p.dead && !p.downed)) add('trader', stock);
  const silver = (side: 'colony' | 'trader') => offers.filter(o => o.side === side && o.currency).reduce((n, o) => n + o.amount, 0);
  // Full serialized terms avoid a hash collision authorizing different goods.
  const key = JSON.stringify([session.id, improvement, difficultyLoss, s.trade.goodwill, offers]);
  return { sessionId: session.id, key, caravanId: caravan.id, pawnId: pawn.id, improvement,
    difficultyLoss, colonySilver: silver('colony'), traderSilver: silver('trader'), offers };
}
export function applyTradeCommand(s: TradeHost, c: TradeCommand): CommandResult {
  if (c.type === 'homeArea') {
    if (!inside(c.from) || (c.to !== undefined && !inside(c.to)) || typeof c.enabled !== 'boolean')
      return { ok: false, message: '家园区域坐标无效' };
    const b = c.to ?? c.from;
    for (let z = Math.min(c.from.z, b.z); z <= Math.max(c.from.z, b.z); z++)
      for (let y = Math.min(c.from.y, b.y); y <= Math.max(c.from.y, b.y); y++)
        for (let x = Math.min(c.from.x, b.x); x <= Math.max(c.from.x, b.x); x++)
          if (c.enabled) s.homeArea.add(at({ x, y, z })); else s.homeArea.delete(at({ x, y, z }));
    s.revision++;
    return { ok: true, message: c.enabled ? '已标记家园区域，商人可收购其中可达物品' : '已移除家园区域' };
  }
  if (c.type === 'tradeTalk') {
    const p = s.pawns.find(p => p.id === c.pawnId), caravan = s.trade.caravans.find(v => v.id === c.caravanId);
    if (!canNegotiate(p)) return { ok: false, message: '请选择能够说话且未征召、未倒地的殖民者' };
    if (!canTrade(s, caravan)) return { ok: false, message: '商人当前无法交易' };
    const trader = s.pawns.find(p => p.id === caravan.traderId)!;
    const route = s.path(p, trader);
    if (!route) return { ok: false, message: '没有到达商人的通路' };
    if (p.cargo && !s.tradeDropCargo(p)) return { ok: false, message: '身旁无卸货空间，请先放下携带物品' };
    cancelSession(s); s.tradeRelease(p);
    s.trade.session = { id: s.nextId++, caravanId: caravan.id, pawnId: p.id, stage: 'walking', startedAt: s.tick };
    p.phase = 'trade'; p.path = route.slice(0, -1); p.destination = p.path.at(-1) ?? at(p);
    p.reason = '前往与商人交谈';
    return { ok: true, message: `${p.name}正在前往商人处` };
  }
  if (!s.trade.session || c.sessionId !== s.trade.session.id) return { ok: false, message: '这次交易已经结束' };
  if (c.type === 'tradeCancel') { cancelSession(s); return { ok: true, message: '已取消交易，物资与银币未转移' }; }
  const quote = quoteTrade(s);
  if (!quote || c.quoteKey !== quote.key) return { ok: false, message: '报价或可用库存已变化，请重新确认' };
  const result = settleTrade(quote.offers, c.lines, quote.colonySilver, quote.traderSilver, c.gift, c.acceptShortfall);
  if (!result.ok) return { ok: false, message: result.reason };
  const caravan = s.trade.caravans.find(v => v.id === quote.caravanId)!;
  const trader = s.pawns.find(p => p.id === caravan.traderId)!;
  const pawn = s.pawns.find(p => p.id === quote.pawnId)!;
  let items = s.items.map(i => ({ ...i })), stock = caravan.stock.map(i => ({ ...i }));
  const imported: Cargo[] = [], exported: Cargo[] = [];
  const transferred = c.lines.filter(l => l.amount > 0).map(l => ({ side: l.side, stockId: l.stockId,
    batch: portion(quote.offers.find(o => o.side === l.side && o.stockId === l.stockId)!.batch, l.amount) }));
  for (const row of transferred) {
    const list = row.side === 'colony' ? items : stock;
    const item = list.find(i => i.id === row.stockId)!;
    item.amount -= row.batch.amount;
    (row.side === 'colony' ? exported : imported).push(row.batch);
  }
  const takeSilver = (side: 'colony' | 'trader', amount: number) => {
    const list = side === 'colony' ? items : stock;
    for (const offer of quote.offers.filter(o => o.side === side && o.currency)) {
      const item = list.find(i => i.id === offer.stockId)!;
      const take = Math.min(item.amount, amount); item.amount -= take; amount -= take;
      if (!amount) break;
    }
  };
  if (result.silverToColony > 0) { takeSilver('trader', result.silverToColony); imported.push(freshBatch('silver', result.silverToColony)); }
  else if (result.silverToColony < 0) { takeSilver('colony', -result.silverToColony); exported.push(freshBatch('silver', -result.silverToColony)); }
  items = items.filter(i => i.amount > 0); stock = stock.filter(i => i.amount > 0);
  const plan = s.tradePlace(imported.map(batch => ({ batch, origin: trader })), items);
  if (!plan) return { ok: false, message: '商人附近没有足够落货空间；交易未执行' };
  if (stock.length + exported.length > 2048) return { ok: false, message: '商队携带条目已满；交易未执行' };
  for (const batch of exported) stock.push({ ...portion(batch, batch.amount), id: plan.nextId++, carrierId: trader.id });
  const goodwillBefore = s.trade.goodwill;
  const gain = c.gift ? giftGoodwill(goodwillBefore, result.giftGoodwillBase) :
    Math.trunc((result.selling + Math.max(0, -result.silverToColony)) / 600);
  // All ownership changes happen after the complete placement plan succeeds.
  s.tradeApplyPlacement(plan); caravan.stock = stock;
  for (const batch of imported) s.trade.imported[batch.resource] += batch.amount;
  for (const batch of exported) s.trade.exported[batch.resource] += batch.amount;
  s.trade.goodwill = affectGoodwill(goodwillBefore, gain);
  s.trade.receipts.push({ id: s.nextId++, tick: s.tick, caravanId: caravan.id, pawnId: pawn.id,
    gift: c.gift, silverToColony: result.silverToColony, quotedSilverToColony: result.quotedSilverToColony,
    shortfall: result.shortfall, goodwillBefore, goodwillAfter: s.trade.goodwill, transferred });
  if (s.trade.receipts.length > 32) s.trade.receipts.shift();
  cancelSession(s);
  s.notice = c.gift ? `已送出礼物，关系 +${s.trade.goodwill - goodwillBefore}` : `交易完成：${result.silverToColony >= 0 ? '收到' : '支付'} ${Math.abs(result.silverToColony)} 银币`;
  return { ok: true, message: s.notice };
}

export function updateTrade(s: TradeHost) {
  if (advanceTradeCalendar(s.trade, s.seed, s.tick)) s.tradeSpawn();
  for (const caravan of s.trade.caravans) {
    const trader = s.pawns.find(p => p.id === caravan.traderId);
    const members = caravan.pawnIds.map(id => s.pawns.find(p => p.id === id)).filter((p): p is Pawn => !!p);
    if (!trader || trader.dead || trader.downed || s.trade.goodwill <= -75) {
      caravan.stage = 'leaving'; caravan.reason = '商人失去行动能力或关系恶化，商队撤离';
    }
    for (const item of [...caravan.stock]) {
      const carrier = s.pawns.find(p => p.id === item.carrierId);
      if (!carrier) continue;
      if (advanceRot(item, s.tradeTemperature(carrier))) {
        caravan.stock = caravan.stock.filter(i => i.id !== item.id);
      } else if (carrier.dead || carrier.downed) {
        const plan = s.tradePlace([{ batch: item, origin: carrier }], s.items);
        if (plan) {
          s.tradeApplyPlacement(plan); caravan.stock = caravan.stock.filter(i => i.id !== item.id);
          s.trade.imported[item.resource] += item.amount;
        }
      }
    }
    if (caravan.stage === 'arriving' && trader && distance(trader, caravan.meeting) <= 2) {
      caravan.stage = 'visiting'; caravan.visitingAt = s.tick; caravan.reason = '停留交易';
    }
    if (caravan.visitingAt !== null && s.tick - caravan.visitingAt > caravan.stayTicks) {
      caravan.stage = 'leaving'; caravan.reason = '商队正在离开地图';
    }
    for (const p of members) {
      if (p.dead || p.downed || p.attackTargetId !== null || p.shooting) continue;
      if (caravan.stage === 'leaving' && (p.x === 0 || p.x === 63 || p.y === 0 || p.y === 63)) {
        for (const q of s.pawns) if (q.attackTargetId === p.id || q.shooting?.targetId === p.id) s.tradeRelease(q);
        s.socialDepart(p);
        s.pawns = s.pawns.filter(q => q.id !== p.id);
        caravan.stock = caravan.stock.filter(i => i.carrierId !== p.id);
        continue;
      }
      if (!p.path.length && (s.tick + p.id) % 40 === 0) {
        if (caravan.stage === 'leaving') p.path = s.tradeExit(p) ?? [];
        else if (caravan.stage === 'arriving') p.path = s.path(p, caravan.meeting) ?? [];
        p.destination = p.path.at(-1) ?? null;
        p.reason = p.path.length ? caravan.reason : caravan.stage === 'visiting' ? '商队停留中，可交谈交易' : '商队通路受阻';
      }
    }
  }
  s.trade.caravans = s.trade.caravans.filter(c => c.pawnIds.some(id => s.pawns.some(p => p.id === id)) || c.stock.length);
  const session = s.trade.session;
  if (!session) return;
  const p = s.pawns.find(p => p.id === session.pawnId), caravan = s.trade.caravans.find(c => c.id === session.caravanId);
  if (!canNegotiate(p) || p.phase !== 'trade' || !canTrade(s, caravan)) { cancelSession(s); return; }
  const trader = s.pawns.find(p => p.id === caravan.traderId)!;
  if (distance(p, trader) <= 1) {
    session.stage = 'ready'; p.path = []; p.destination = null; p.reason = '正在与商人交易';
  } else if (!p.path.length || (s.tick + p.id) % 40 === 0) {
    const route = s.path(p, trader);
    if (!route) { cancelSession(s); p.reason = '前往商人的通路中断'; return; }
    session.stage = 'walking'; p.path = route.slice(0, -1); p.destination = p.path.at(-1) ?? null;
  }
}
