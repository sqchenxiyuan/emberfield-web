import { useRef, useState, type KeyboardEvent } from 'react';
import { DAY, RESOURCE_NAMES, type Cargo, type CommandResult, type Pawn, type Pos, type VoxelSnapshot } from './types';
import { APPAREL_NAMES, QUALITY_NAMES, apparelStats } from './apparel';
import { CROPS } from './farming';
import { remainingRotDays } from './preservation';
import { healthSummary } from './survival';
import { weaponName, weaponStats } from './weapons';
import { settleTrade, type TradeLine } from './tradeRules';
import type { TradeCommand, TradeOffer, TradeQuote } from './tradeTypes';

type Command = (command: TradeCommand) => Promise<CommandResult>;
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const offerKey = (offer: TradeOffer) => `${offer.side}:${offer.stockId}`;
const stageName = { arriving: '正在入场', visiting: '停留交易', leaving: '正在离开' };
export function tradeItemName(batch: Cargo): string {
  if (batch.weapon) return weaponName(batch.weapon);
  if (batch.apparel) return `${batch.apparel.material === 'steel' ? '钢制' : '布制'}${APPAREL_NAMES[batch.apparel.kind]}（${QUALITY_NAMES[batch.apparel.quality]}）`;
  if (batch.resource === 'grain' && batch.crop) return CROPS[batch.crop].name;
  return RESOURCE_NAMES[batch.resource];
}
function condition(batch: Cargo): string | null {
  if (batch.weapon) return `耐久 ${batch.weapon.hitPoints}/${weaponStats(batch.weapon).maxHitPoints}`;
  if (batch.apparel) return `耐久 ${batch.apparel.hitPoints}/${apparelStats(batch.apparel).maxHitPoints}`;
  const days = remainingRotDays(batch);
  return days === null ? null : `常温下约剩 ${days.toFixed(2)} 日`;
}

function TradeDialog({ quote, snapshot: s, command }: { quote: TradeQuote; snapshot: VoxelSnapshot; command: Command }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [gift, setGift] = useState(false);
  const [acceptShortfall, setAcceptShortfall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const caravan = s.trade.caravans.find((c) => c.id === quote.caravanId);
  const negotiator = s.pawns.find((p) => p.id === quote.pawnId);
  const offers = quote.offers.filter((offer) => gift ? offer.side === 'colony' : !offer.currency);
  const lines: TradeLine[] = offers.flatMap((offer) => {
    const value = amounts[offerKey(offer)] ?? '';
    return value === '' || Number(value) === 0 ? [] : [{ side: offer.side, stockId: offer.stockId, amount: Number(value) }];
  });
  const preview = settleTrade(quote.offers, lines, quote.colonySilver, quote.traderSilver, gift, acceptShortfall);
  const setAmount = (offer: TradeOffer, value: string) => {
    setAmounts((before) => ({ ...before, [offerKey(offer)]: value }));
    setAcceptShortfall(false);
    setError('');
  };
  const run = async (value: TradeCommand) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await command(value);
      if (!result.ok) setError(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { submitting.current = false; setBusy(false); }
  };
  const cancel = () => void run({ type: 'tradeCancel', sessionId: quote.sessionId });
  const dialogKeys = (event: KeyboardEvent<HTMLElement>) => {
    // Keep map/time shortcuts from advancing the world while confirming a quote.
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); cancel(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return (
    <div className="voxel-modal-backdrop voxel-trade-backdrop">
      <section className="voxel-trade-dialog" role="dialog" aria-modal="true" aria-labelledby="trade-title" onKeyDown={dialogKeys} data-testid="trade-dialog">
        <header className="voxel-trade-dialog-header">
          <div><span className="voxel-kicker">商队交易 · 时间已暂停</span><h2 id="trade-title">{caravan?.name ?? '来访商队'}</h2></div>
          <button aria-label="取消交易" onClick={cancel} disabled={busy} autoFocus>×</button>
        </header>
        <div className="voxel-trade-balances" data-testid="trade-balances">
          <span>营地可用银币 <strong>{number(quote.colonySilver)}</strong></span>
          <span>商人银币 <strong>{number(quote.traderSilver)}</strong></span>
          <span>交谈者 <strong>{negotiator?.name ?? '殖民者'}</strong></span>
        </div>
        <div className="voxel-trade-toolbar">
          <div role="group" aria-label="交易方式">
            {[false, true].map((value) => <button key={String(value)} className={gift === value ? 'active' : ''} aria-pressed={gift === value} disabled={busy} onClick={() => {
              setGift(value); setAmounts({}); setAcceptShortfall(false); setError('');
            }}>{value ? '赠礼' : '买卖'}</button>)}
          </div>
          <details className="voxel-trade-price-details">
            <summary>报价说明</summary>
            <p>议价改善 {(quote.improvement * 100).toFixed(1)}% · 难度交易损失 {(quote.difficultyLoss * 100).toFixed(0)}%。各商品已有独立买卖价；银币按整单差额取整结算。</p>
            <p>营地只出售家园或仓储中已经落地、商人可达且愿意收购的物资。携带、穿戴和已交工地物品不在售；禁止搬运标记不阻止交易。</p>
          </details>
        </div>
        <div className="voxel-trade-lists">
          {(gift ? ['colony'] as const : ['trader', 'colony'] as const).map((side) => {
            const entries = offers.filter((offer) => offer.side === side);
            const direction = gift ? '赠送' : side === 'trader' ? '买入' : '卖出';
            return <section key={side} className="voxel-trade-list" aria-label={`${direction}商品`}>
              <h3>{direction} · {side === 'trader' ? '商人物资' : '营地物资'}</h3>
              {!entries.length && <p className="voxel-trade-empty">{side === 'colony' ? '没有符合这位商人收购范围的可售物资。' : '商人目前没有可售商品。'}</p>}
              {entries.map((offer, index) => <div className="voxel-trade-row" key={offerKey(offer)} data-trade-side={offer.side} data-stock-id={offer.stockId} data-resource={offer.batch.resource}>
                <div className="voxel-trade-item-name"><b>{tradeItemName(offer.batch)}</b><small>{condition(offer.batch) ?? '不腐坏'}</small><small>单价 {number(offer.unitPrice)} · 可用 {offer.amount}</small></div>
                <div className="voxel-trade-quantity">
                  <input type="number" min="0" max={offer.amount} step="1" inputMode="numeric" aria-label={`${direction} ${tradeItemName(offer.batch)} 数量 ${index + 1}`} disabled={busy} placeholder="0" value={amounts[offerKey(offer)] ?? ''} onChange={(e) => setAmount(offer, e.target.value)} />
                  <button aria-label={`${direction}全部 ${tradeItemName(offer.batch)} ${index + 1}`} disabled={busy} onClick={() => setAmount(offer, String(offer.amount))}>全部</button>
                </div>
              </div>)}
            </section>;
          })}
        </div>
        <footer className="voxel-trade-settlement">
          <div className="voxel-trade-totals" data-testid="trade-settlement">
            {gift ? <span>赠礼估值 <strong>{number(preview.selling)}</strong> 银币</span> : <>
              <span>买入 {number(preview.buying)} · 卖出 {number(preview.selling)}</span>
              <strong>{preview.silverToColony < 0 ? '营地支付' : preview.shortfall > 0 ? (acceptShortfall ? '实际收入' : '报价应收') : '营地收入'} {number(Math.abs(preview.silverToColony))} 银币</strong>
            </>}
          </div>
          {preview.shortfall > 0 && <label className="voxel-trade-shortfall">
            <input type="checkbox" checked={acceptShortfall} disabled={busy} aria-label="接受商人银币不足的差额" onChange={(e) => { setAcceptShortfall(e.target.checked); setError(''); }} />
            商人银币不足，我接受少收 {number(preview.shortfall)} 银币
          </label>}
          {(error || (!preview.ok && lines.length > 0)) && <p className="voxel-trade-error" role="alert">{error || preview.reason}</p>}
          <div className="voxel-trade-confirm-row">
            <small>{gift ? '赠出的物品不收取货款，确认后显示实际关系变化。' : '确认后按当前整单报价交付物资并结算银币。'}</small>
            <button onClick={cancel} disabled={busy}>取消</button>
            <button className="voxel-primary" disabled={busy || !preview.ok} onClick={() => void run({ type: 'tradeCommit', sessionId: quote.sessionId, quoteKey: quote.key, lines, gift, acceptShortfall })}>{busy ? '处理中…' : gift ? '确认赠礼' : '确认交易'}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function TraderInspector({ pawn, openTrade }: { pawn: Pawn; openTrade: () => void }) {
  const summary = healthSummary(pawn);
  return <section className="voxel-trader-inspector" data-testid="trader-inspector">
    <b>{pawn.name} · 来访商人</b><p>{pawn.reason}</p>
    <small>{pawn.dead ? '已死亡' : pawn.downed ? '倒地' : summary.reason}</small>
    <small>饱食 {Math.round(pawn.food)}% · 精力 {Math.round(pawn.rest)}%</small>
    {pawn.weapon && <small>装备 {weaponName(pawn.weapon)}</small>}
    {pawn.worn.map((piece) => <small key={piece.id}>{APPAREL_NAMES[piece.kind]} · {QUALITY_NAMES[piece.quality]} · 耐久 {piece.hitPoints}</small>)}
    <button onClick={openTrade}>查看商队与交谈</button>
  </section>;
}

export function TradePanel({ snapshot: s, selectedPos, selectedPawnId, command, speed, focus, close }: {
  snapshot: VoxelSnapshot;
  selectedPos: Pos | null;
  selectedPawnId: number | null;
  command: Command;
  speed: (value: number) => Promise<unknown>;
  focus: (pawn: Pawn) => void;
  close: () => void;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const negotiators = s.pawns.filter((p) => p.faction === 'colony' && !p.dead && !p.downed && !p.drafted && p.carriedBy === null);
  const negotiator = negotiators.find((p) => p.id === chosen) ?? negotiators.find((p) => p.id === selectedPawnId) ?? negotiators[0];
  const session = s.trade.session;
  const quote = s.trade.quote;
  const from = anchor ?? selectedPos;
  const validArea = from !== null && selectedPos !== null && from.z === selectedPos.z;
  const areaCount = validArea ? (Math.abs(from.x - selectedPos.x) + 1) * (Math.abs(from.y - selectedPos.y) + 1) : 0;
  const act = async (value: TradeCommand, resume = false) => {
    setBusy(true); setError('');
    try {
      const result = await command(value);
      if (!result.ok) setError(result.message);
      else if (resume && s.speed === 0) await speed(1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <>
    <aside className="voxel-trade-drawer" aria-label="商队与家园" data-testid="trade-panel">
      <div className="voxel-trade-drawer-heading"><h2>商队与家园</h2><button aria-label="关闭商队面板" onClick={close}>×</button></div>
      <p>商队关系 {s.trade.goodwill} · 营地银币 {number(s.inventory.silver)}</p>
      <small>{s.trade.nextVisit === null ? '当前窗口没有剩余来访机会，商队日历会随时间继续推进。' : `下一次来访机会约 ${Math.max(0, (s.trade.nextVisit - s.tick) / DAY).toFixed(2)} 日后；届时检查能否入场。`}</small>
      <label className="voxel-trade-negotiator">交谈者<select aria-label="贸易交谈者" value={negotiator?.id ?? ''} onChange={(e) => setChosen(Number(e.target.value))} disabled={!negotiators.length || busy}>
        {!negotiators.length && <option value="">暂无可行动的殖民者</option>}
        {negotiators.map((p) => <option key={p.id} value={p.id}>{p.name} · 社交 {p.skills.social.level}</option>)}
      </select></label>
      {!s.trade.caravans.length && <p>目前没有来访商队。正常推进时间等待来访机会。</p>}
      {s.trade.caravans.map((caravan) => {
        const trader = s.pawns.find((p) => p.id === caravan.traderId);
        return <section className="voxel-trade-caravan" key={caravan.id} data-caravan-id={caravan.id}>
          <div><b>{caravan.name}</b><span>{stageName[caravan.stage]}</span></div>
          <small>{caravan.kind === 'bulk' ? '大宗物资商队' : '武器装备商队'} · {caravan.reason}</small>
          <div><button disabled={!trader} onClick={() => trader && focus(trader)}>查看商人</button>
            <button disabled={busy || !negotiator || !trader || trader.dead || trader.downed || !!session} onClick={() => negotiator && void act({ type: 'tradeTalk', pawnId: negotiator.id, caravanId: caravan.id }, true)}>前往交谈</button></div>
        </section>;
      })}
      {session && !quote && <div className="voxel-trade-walking" role="status">
        <b>{s.pawns.find((p) => p.id === session.pawnId)?.name ?? '殖民者'} 正在前往商人处</b>
        <small>到达后自动暂停并打开正式报价。时间暂停时请继续时间。</small>
        <button disabled={busy} onClick={() => void act({ type: 'tradeCancel', sessionId: session.id })}>取消交谈</button>
      </div>}
      {!session && <small>开始交谈会继续时间，让殖民者实际走到商人身边；到达后自动暂停。商人入场或离开途中也可交谈，离图后交易结束。</small>}
      {error && <p className="voxel-trade-error" role="alert">{error}</p>}
      <details className="voxel-home-area" open>
        <summary>家园范围 · {s.homeArea.length} 格</summary>
        <p>金色边界内的落地物资可参与贸易，仓储中的落地物资也可。商人还需要能走到物资处并愿意收购。</p>
        <small>用查看工具点选地图，设定矩形起点，再点选同层终点。</small>
        <div><button disabled={!selectedPos || busy} onClick={() => { setAnchor(selectedPos && { ...selectedPos }); setError(''); }}>设为范围起点</button><button disabled={!anchor} onClick={() => setAnchor(null)}>清除起点</button></div>
        <small>{anchor ? `起点 (${anchor.x}, ${anchor.y}) · 第 ${anchor.z} 层` : '未设起点时只修改选中格。'}</small>
        {selectedPos && <small>当前选中 ({selectedPos.x}, {selectedPos.y}) · 第 {selectedPos.z} 层{validArea ? ` · ${areaCount} 格` : ' · 请在起点同层选择终点'}</small>}
        <div><button disabled={!validArea || busy} onClick={() => from && selectedPos && void act({ type: 'homeArea', from, to: selectedPos, enabled: true })}>加入家园范围</button><button disabled={!validArea || busy} onClick={() => from && selectedPos && void act({ type: 'homeArea', from, to: selectedPos, enabled: false })}>移除家园范围</button></div>
      </details>
      <details className="voxel-trade-receipts"><summary>最近交易 · {s.trade.receipts.length}</summary>
        {!s.trade.receipts.length && <p>尚未成交。</p>}
        {s.trade.receipts.slice(-4).reverse().map((receipt) => <div key={receipt.id} data-testid="trade-receipt">
          <b>第 {number(receipt.tick / DAY)} 日 · {receipt.gift ? '赠礼' : '交易'}</b>
          <small>{receipt.gift ? `关系 ${receipt.goodwillBefore} → ${receipt.goodwillAfter}` : `营地${receipt.silverToColony < 0 ? '支付' : '收入'} ${number(Math.abs(receipt.silverToColony))} 银币`}</small>
          {receipt.shortfall > 0 && <small>已同意少收 {number(receipt.shortfall)} 银币</small>}
          <small>{receipt.transferred.map((transfer) => `${transfer.side === 'colony' ? '送出' : '收取'} ${tradeItemName(transfer.batch)} × ${transfer.batch.amount}`).join('；')}</small>
        </div>)}
      </details>
    </aside>
    {quote && session?.stage === 'ready' && <TradeDialog key={`${quote.sessionId}:${quote.key}`} quote={quote} snapshot={s} command={command} />}
  </>;
}
