import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AnimalDetails, AnimalPanel, AnimalTradeDetails } from '../src/voxel/AnimalPanel';
import { TradePanel, tradeSelection } from '../src/voxel/TradePanel';
import { initialAnimalState } from '../src/voxel/husbandry';
import { freshBatch } from '../src/voxel/preservation';
import { VoxelSimulation } from '../src/voxel/world';
import { DAY, type AnimalSpecies, type VoxelSnapshot, type WildAnimal } from '../src/voxel/types';

let initial: VoxelSnapshot;
beforeAll(() => { initial = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).snapshot(); });
const command = vi.fn(async () => ({ ok: true, message: 'ok' }));
const controls = { selectedPenId: null, selectedAreaId: null, editingArea: false, showPen: () => {}, showArea: () => {}, editArea: () => {} };
function animal(id: number, species: AnimalSpecies, extra: Partial<WildAnimal> = {}): WildAnimal {
  return { ...initialAnimalState(id, species, 0), id, species, name: '同名动物', x: 12, y: 12, z: 8,
    faction: 'trader', sex: 'female', ageTicks: 5 * DAY, growth: 1, health: 20, hunger: 72, dead: false,
    hunt: false, phase: 'roam', moveTick: 0, decisionTick: 0, fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0, ...extra };
}
function market(): VoxelSnapshot {
  const s = structuredClone(initial), p = s.pawns[0];
  s.animals = [
    animal(901, 'dromedary', { health: 83, milkFullness: .65, pregnancy: { fatherId: 999, progress: .35 } }),
    animal(902, 'alpaca', { faction: 'colony', health: 75, woolGrowth: .7 }),
    animal(903, 'chicken', { eggProgress: .45, fertilizationCount: 3, eggFatherId: 904 }),
  ];
  s.trade.caravans = [{ id: 801, kind: 'bulk', name: '测试牧场商队', pawnIds: [p.id], animalIds: [901, 903], traderId: p.id,
    stock: [], meeting: { x: 12, y: 12, z: 8 }, stage: 'visiting', arrivedAt: 0, visitingAt: 0, stayTicks: DAY, reason: '停留中' }];
  s.trade.session = { id: 810, caravanId: 801, pawnId: p.id, stage: 'ready', startedAt: 0 };
  s.trade.quote = { sessionId: 810, key: 'mixed-ui-quote', caravanId: 801, pawnId: p.id, improvement: .1, difficultyLoss: 0,
    colonySilver: 100, traderSilver: 100,
    offers: [
      { side: 'trader', stockId: 601, amount: 10, unitPrice: 7.25, currency: false, marketValue: 5, batch: freshBatch('steel', 10) },
      { side: 'colony', stockId: 602, amount: 10, unitPrice: 3.2, currency: false, marketValue: 5, batch: freshBatch('cloth', 10) },
      { side: 'colony', stockId: 603, amount: 100, unitPrice: 1, currency: true, marketValue: 1, batch: freshBatch('silver', 100) },
    ],
    animalOffers: s.animals.map(a => ({ side: a.faction === 'colony' ? 'colony' : 'trader', stockId: a.id,
      animal: structuredClone(a), amount: 1, currency: false, marketValue: 50, unitPrice: a.id === 902 ? 32.4 : 60.25 })),
  };
  s.trade.receipts = [];
  return s;
}
const trade = (s: VoxelSnapshot) => renderToStaticMarkup(<TradePanel snapshot={s} selectedPos={null} selectedPawnId={null}
  command={command} speed={async () => {}} focus={() => {}} close={() => {}} />);
const details = (s: VoxelSnapshot, a = s.animals[0]) => renderToStaticMarkup(<AnimalDetails animal={a} snapshot={s}
  command={command} focus={() => {}} penControls={controls} />);
const animals = (s: VoxelSnapshot) => renderToStaticMarkup(<AnimalPanel snapshot={s} selectedAnimalId={901} baseLevel={8}
  command={command} choose={() => {}} focus={() => {}} selectAnimal={() => {}} selectPawn={() => {}} close={() => {}} penControls={controls} />);

describe('live-animal trade UI without a browser', () => {
  it('shows cargo and individual animal rows, including identity and actual reproductive/product state', () => {
    const html = trade(market());
    expect(html).toContain('data-resource="steel"'); expect(html).toContain('data-resource="cloth"');
    expect(html).not.toContain('data-resource="silver"');
    for (const id of [901, 902, 903]) expect(html).toContain(`data-stock-id="${id}" data-animal-id="${id}"`);
    expect(html).toContain('同名动物 · 单峰驼 #901'); expect(html).toContain('同名动物 · 鸡 #903');
    expect(html.match(/min="0" max="1" step="1"/g)).toHaveLength(3);
    expect(html).toContain('雌性 · 成年 · 日龄 5.0 天');
    expect(html).toContain('健康 83 / 100'); expect(html).toContain('饱食 72%');
    expect(html).toContain('孕期 35%'); expect(html).toContain('蓄奶 65%');
    expect(html).toContain('毛量 70%'); expect(html).toContain('产蛋进度 45%');
    expect(html).toContain('受精余量 3 枚'); expect(html).toContain('下一枚为受精蛋');
    expect(html).toContain('无需位于家园范围'); expect(html).toContain('每只最多选择 1');
    expect(html).toContain('时间已暂停');
  });
  it('previews one combined cargo and animal settlement with the exact shared commit lines', () => {
    const q = market().trade.quote!;
    const { lines, preview } = tradeSelection(q, { 'trader:601': '2', 'colony:602': '3', 'trader:901': '1', 'colony:902': '1' });
    expect(lines).toEqual([
      { side: 'trader', stockId: 601, amount: 2 }, { side: 'colony', stockId: 602, amount: 3 },
      { side: 'trader', stockId: 901, amount: 1 }, { side: 'colony', stockId: 902, amount: 1 },
    ]);
    expect(preview.ok).toBe(true); expect(preview.buying).toBe(74.75); expect(preview.selling).toBe(42);
    expect(preview.silverToColony).toBe(-33);
    expect(tradeSelection(q, { 'colony:603': '5' }).lines).toEqual([]);
  });
  it('rejects fractional, excess and malformed individual quantities and insufficient silver', () => {
    const q = market().trade.quote!;
    for (const value of ['2', '.5', '-1', 'bad', 'Infinity']) {
      expect(tradeSelection(q, { 'trader:901': value }).preview.ok).toBe(false);
    }
    q.colonySilver = 0;
    expect(tradeSelection(q, { 'trader:901': '1' }).preview.reason).toContain('银币不足');
    expect(tradeSelection(q, {}).preview.ok).toBe(false);
    expect(tradeSelection(q, { 'trader:901': '0' }).lines).toEqual([]);
  });
  it('gifts animals, cargo and silver together while excluding merchant selections', () => {
    const selected = tradeSelection(market().trade.quote!, { 'colony:902': '1', 'colony:602': '3', 'colony:603': '10', 'trader:901': '1' }, true);
    expect(selected.offers.every(o => o.side === 'colony')).toBe(true);
    expect(selected.lines).toHaveLength(3); expect(selected.lines.some(l => l.side === 'trader')).toBe(false);
    expect(selected.preview.ok).toBe(true); expect(selected.preview.selling).toBe(52);
    expect(selected.preview.giftGoodwillBase).toBe(1.3); expect(selected.preview.silverToColony).toBe(0);
  });
  it('requires explicit acceptance when animal sales exceed merchant silver', () => {
    const q = market().trade.quote!; q.traderSilver = 2;
    const amounts = { 'colony:902': '1' };
    const rejected = tradeSelection(q, amounts).preview, accepted = tradeSelection(q, amounts, false, true).preview;
    expect(rejected.ok).toBe(false); expect(rejected.shortfall).toBe(30);
    expect(accepted.ok).toBe(true); expect(accepted.silverToColony).toBe(2); expect(accepted.quotedSilverToColony).toBe(32);
  });
  it('keeps merchant inspection and identity but hides all colony and wild management actions', () => {
    const s = market(), a = s.animals[0]; a.tame = true; a.slaughter = true; a.releaseMarked = true;
    const html = details(s);
    expect(html).toContain('单峰驼 · 商队动物'); expect(html).toContain('同名动物 · #901');
    expect(html).toContain('归属：测试牧场商队'); expect(html).toContain('蓄奶 65%');
    expect(html).toContain('定位这只动物'); expect(html).toContain('购买后才能安排');
    for (const text of ['voxel-animal-orders', 'animal-pen-controls', '驯服后', '等待开启「饲养」', '自动待宰', '手动待宰标记已开启']) expect(html).not.toContain(text);
  });
  it('lists merchant animals separately and keeps colony and wildlife management available', () => {
    const s = market(); s.animals.push(animal(905, 'deer', { faction: 'wild' }));
    const html = animals(s);
    expect(html).toContain('2 只商队动物'); expect(html).toContain('data-animal-group="trader"');
    expect(html).toContain('商队动物 · 2'); expect(html).toContain('data-animal-id="901" data-faction="trader"');
    const colony = details(s, s.animals[1]), wild = details(s, s.animals[3]);
    expect(colony).toContain('aria-label="标记待宰此动物"'); expect(colony).toContain('aria-label="标记放归此动物"');
    expect(wild).toContain('aria-label="标记驯服此动物"'); expect(wild).toContain('aria-label="标记狩猎此动物"');
  });
  it('counts only living animals still owned by this caravan and states its actual trade range', () => {
    const s = market(), caravan = s.trade.caravans[0]; s.trade.quote = null; s.trade.session = null;
    caravan.animalIds.push(902, 906, 9999); s.animals.push(animal(906, 'chicken', { dead: true, phase: 'dead' }), animal(907, 'chicken'));
    const html = trade(s);
    expect(html).toContain('随队动物 2 只'); expect(html).toContain('活畜收购与出售：鸡、羊驼、单峰驼');
    caravan.kind = 'combat'; caravan.animalIds = [];
    expect(trade(s)).toContain('这类商队目前不买卖活畜');
  });
  it('renders transfer receipts from historical individual snapshots after live identity/state changes', () => {
    const s = market(), historical = structuredClone(s.animals[0]); historical.name = '成交旧名'; historical.health = 61; historical.milkFullness = .25;
    s.animals[0].name = '后来改名'; s.animals[0].health = 100; s.animals[0].milkFullness = 1;
    s.trade.quote = null; s.trade.session = null;
    s.trade.receipts = [{ id: 820, tick: DAY, caravanId: 801, pawnId: s.pawns[0].id, gift: false, silverToColony: -65,
      quotedSilverToColony: -65, shortfall: 0, goodwillBefore: 0, goodwillAfter: 0,
      transferred: [{ side: 'trader', stockId: 601, batch: freshBatch('steel', 1) }],
      animalTransfers: [{ side: 'trader', animal: historical }, { side: 'colony', animal: structuredClone(s.animals[1]) }] }];
    const receipt = trade(s).split('data-testid="trade-receipt"')[1];
    expect(receipt).toContain('动物交接 2 只 · 以下为成交时状态');
    expect(receipt).toContain('收取 成交旧名 · 单峰驼 #901'); expect(receipt).toContain('送出 同名动物 · 羊驼 #902');
    expect(receipt).toContain('健康 61 / 100'); expect(receipt).toContain('蓄奶 25%'); expect(receipt).toContain('收取 钢材 × 1');
    expect(receipt).not.toContain('后来改名'); expect(receipt).not.toContain('蓄奶 100%');
  });
  it('distinguishes immature animals and male product eligibility without offering work controls', () => {
    const young = renderToStaticMarkup(<AnimalTradeDetails animal={animal(910, 'alpaca', { growth: .1, ageTicks: DAY / 2, woolGrowth: 0 })} />);
    expect(young).toContain('幼崽'); expect(young).toContain('日龄 0.5 天'); expect(young).toContain('成年后可长毛');
    const male = renderToStaticMarkup(<AnimalTradeDetails animal={animal(911, 'dromedary', { sex: 'male' })} />);
    expect(male).toContain('雄性不产奶'); expect(male).not.toContain('未怀孕');
    const hen = renderToStaticMarkup(<AnimalTradeDetails animal={animal(912, 'chicken', { fertilizationCount: 0 })} />);
    expect(hen).toContain('下一枚为未受精蛋'); expect(hen).not.toContain('未怀孕');
    expect(young + male + hen).not.toContain('<button');
  });
});
