import { DAY, emptyCounts, type Cargo, type ApparelKind } from './types';
import { storyRandom } from './storyteller';
import { evaluateCurve, generateIncidentCycle, STORY_INTERVAL } from './storytellerRules';
import { unityRound, weaponMarketValue } from './wealth';
import { freshBatch } from './preservation';
import { makeApparel } from './apparel';
import { makeWeapon, WEAPON_DEFS, type WeaponKind, type WeaponPiece } from './weapons';
import type { TradeState, TraderKind, TraderStock } from './tradeTypes';

export const TRADER_NAMES: Record<TraderKind, string> = { bulk: '大宗商品商队', combat: '军火商队' };
export const TRADE_START_INTERVAL = 300, TRADE_CYCLE_INTERVALS = 3600;
export const TRADE_TIMING = { onDays: 60, offDays: 0, minimumSpacingDays: 6, minIncidents: 5, maxIncidents: 5 };
export function tradeCycleAt(interval: number): number {
  return interval < TRADE_START_INTERVAL ? -1 : Math.floor((interval - TRADE_START_INTERVAL) / TRADE_CYCLE_INTERVALS);
}
function nextCycle(seed: number, cycle: number, priorHit: number): number[] {
  return generateIncidentCycle(TRADE_TIMING, cycle * TRADE_CYCLE_INTERVALS, priorHit,
    storyRandom(seed ^ 0x5285b77, cycle));
}
/** One neutral visible faction gives native FactionInteraction acceptance=1.
 * Replay prior cycles for migration; the current cycle and previous hit persist.
 * An endpoint hit belongs to the old cycle and is not executed after its switch. */
export function initialTrade(seed: number, tick = 0): TradeState {
  const lastInterval = Math.floor(tick / STORY_INTERVAL), cycle = tradeCycleAt(lastInterval);
  if (cycle > 10000) throw new Error('贸易日历超过支持的 600000 游戏日');
  let priorHit = -9999999, hits: number[] = [];
  for (let i = 0; i <= cycle; i++) {
    if (hits.length) priorHit = hits[hits.length - 1];
    hits = nextCycle(seed, i, priorHit);
  }
  const state: TradeState = { nextVisit: null, lastInterval, cycle, cycleHits: hits, priorHit,
    visits: 0, goodwill: 0, caravans: [], session: null, receipts: [], imported: emptyCounts(), exported: emptyCounts() };
  state.nextVisit = nextTradeVisit(state, seed);
  return state;
}
export function nextTradeVisit(state: TradeState, seed: number): number | null {
  const relative = state.lastInterval - TRADE_START_INTERVAL;
  const hit = state.cycleHits.find(i => i > relative && i < (state.cycle + 1) * TRADE_CYCLE_INTERVALS);
  if (hit !== undefined) return (hit + TRADE_START_INTERVAL) * STORY_INTERVAL;
  const cycle = Math.max(0, state.cycle + 1);
  const hits = nextCycle(seed, cycle, state.cycleHits.at(-1) ?? state.priorHit);
  const next = hits.find(i => i < (cycle + 1) * TRADE_CYCLE_INTERVALS);
  return next === undefined ? null : (next + TRADE_START_INTERVAL) * STORY_INTERVAL;
}
export function advanceTradeCalendar(state: TradeState, seed: number, tick: number): boolean {
  const interval = Math.floor(tick / STORY_INTERVAL);
  if (interval <= state.lastInterval) return false;
  state.lastInterval = interval;
  const cycle = tradeCycleAt(interval);
  if (cycle !== state.cycle) {
    state.priorHit = state.cycleHits.at(-1) ?? state.priorHit;
    state.cycle = cycle;
    state.cycleHits = nextCycle(seed, cycle, state.priorHit);
  }
  const due = cycle >= 0 && state.cycleHits.includes(interval - TRADE_START_INTERVAL);
  state.nextVisit = nextTradeVisit(state, seed);
  return due;
}
/** StockGenerator.HandlesThingDef and Tradeability are separate gates. */
export function traderAccepts(kind: TraderKind, batch: Cargo): boolean {
  // Animal carcass transfers are outside the current trade feature.
  if (batch.resource === 'carcass') return false;
  if (batch.resource === 'silver') return true;
  if (['wood', 'stone', 'chunk', 'meal', 'herb'].includes(batch.resource)) return false;
  // Local wildlife extension: bulk traders accept meat as raw food.
  if (kind === 'bulk') return ['steel', 'components', 'cloth', 'grain', 'meat', 'food', 'apparel'].includes(batch.resource);
  return ['components', 'food', 'weapon'].includes(batch.resource) ||
    (batch.resource === 'apparel' && !!batch.apparel && ['simpleHelmet', 'plateArmor'].includes(batch.apparel.kind));
}
export const saleFactor = (batch: Cargo) => batch.resource === 'weapon' ? .2 : 1;
/** Native goodwill curve is applied in small increments before integer truncation. */
export function giftGoodwill(current: number, base: number): number {
  if (!Number.isFinite(current) || current < -100 || current > 100 || !Number.isFinite(base) || base < 0)
    throw new RangeError('赠礼关系值无效');
  let gain = 0;
  // Beyond 100 the curve is flat at .25, so the remaining integral is exact.
  for (let used = 0; used < base;) {
    if (current + gain >= 100) { gain += (base - used) * .25; break; }
    const step = Math.min(.25, base - used);
    gain += step * evaluateCurve([[0, 1], [75, .25]], Math.min(100, current + gain));
    used += step;
  }
  return Math.trunc(Math.min(gain, 200));
}
const integerRange = (min: number, max: number, random: () => number) => min + Math.floor(random() * (max - min + 1));
function merchantQuality(random: () => number): 2 | 3 | 4 | 5 {
  const gaussian = Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random());
  return Math.floor(Math.max(2, Math.min(5, 2.5 + gaussian))) as 2 | 3 | 4 | 5;
}
/** Native quantity ranges; missing industrial medicine, animals, drugs, textiles
 * and weapons are omitted rather than replaced with a different resource.
 * Catalogue weights are renormalized over the supported Defs. */
export function makeTraderStock(kind: TraderKind, carrierId: number, id: () => number, random: () => number): TraderStock[] {
  const stock: TraderStock[] = [];
  const apparelBase: Record<ApparelKind, number> = { tuque: 44.32, parka: 188.8, duster: 196,
    shirt: 85.76, pants: 85.76, simpleHelmet: 91.52, plateArmor: 475 };
  const weaponBase: Record<WeaponKind, number> = { woodClub: 84.32, steelKnife: 66.48,
    steelLongsword: 265, shortBow: 44.64, revolver: 135.4, machinePistol: 220 };
  const add = (batch: Cargo) => stock.push({ ...batch, id: id(), carrierId });
  const choose = <T>(options: readonly T[], price: (item: T) => number): T => {
    const weight = (item: T) => evaluateCurve([[0, 1], [500, .5], [1500, .2], [5000, .1]], price(item));
    let roll = random() * options.reduce((n, item) => n + weight(item), 0);
    for (const item of options) { roll -= weight(item); if (roll < 0) return item; }
    return options[options.length - 1];
  };
  const garment = (options: readonly ApparelKind[]) => {
    const item = choose(options, k => apparelBase[k]);
    const piece = makeApparel(id(), item); piece.quality = merchantQuality(random);
    add({ resource: 'apparel', amount: 1, apparel: piece });
  };
  const weapon = (options: readonly WeaponKind[], uniform = false) => {
    const item = uniform ? options[Math.floor(random() * options.length)] : choose(options, k => weaponBase[k]);
    const piece = makeWeapon(id(), item); piece.quality = item === 'woodClub' ? 2 : merchantQuality(random);
    add({ resource: 'weapon', amount: 1, weapon: piece });
    return item;
  };
  add(freshBatch('silver', integerRange(750, 1200, random)));
  if (kind === 'bulk') {
    add(freshBatch('components', integerRange(30, 40, random)));
    add(freshBatch('steel', integerRange(250, 400, random)));
    add(freshBatch('cloth', integerRange(250, 400, random)));
    for (const crop of ['rice', 'potato', 'corn'] as const)
      add(freshBatch('grain', unityRound((150 + random() * 450) / 1.1), crop));
    for (let i = 0; i < 7; i++) garment(['tuque', 'shirt', 'pants', 'parka', 'duster']);
    for (let i = 0; i < 3; i++) garment(['tuque', 'shirt', 'pants', 'parka', 'duster', 'simpleHelmet', 'plateArmor']);
  } else {
    for (let i = 0; i < 5; i++) weapon(['shortBow', 'revolver', 'machinePistol']);
    const melee: WeaponKind[] = ['woodClub', 'steelKnife', 'steelLongsword'];
    while (melee.length) { const picked = weapon(melee, true); melee.splice(melee.indexOf(picked), 1); }
    for (let i = 0; i < 5; i++) garment(['simpleHelmet', 'plateArmor']);
  }
  return stock;
}
export const merchantStayTicks = (random: () => number) => Math.floor((27000 + Math.floor(random() * 18000)) * DAY / 60000);

export const VISITOR_KINDS = {
  trader: { name: '商人', cost: 45, weight: 0, quality: 2, hp: [1, 1], money: [200, 200], guns: true },
  villager: { name: '随行村民', cost: 45, weight: 3, quality: 1, hp: [.2, 2], money: [65, 250], guns: true },
  guard: { name: '商队护卫', cost: 60, weight: 10, quality: 2, hp: [.6, 2], money: [250, 400], guns: true },
  slasher: { name: '近战佣兵', cost: 140, weight: 7, quality: 2, hp: [.7, 3.2], money: [200, 500], guns: false },
  gunner: { name: '枪手佣兵', cost: 85, weight: 10, quality: 2, hp: [.7, 3.2], money: [330, 650], guns: true },
} as const;
export type VisitorKind = keyof typeof VISITOR_KINDS;
/** Fixed-material supported subset of PawnWeaponGenerator. No substitute is
 * invented when this visitor's tags and budget have no supported weapon. */
export function visitorWeapon(role: VisitorKind, id: () => number, random: () => number): WeaponPiece | null {
  const def = VISITOR_KINDS[role], budget = def.money[0] + (def.money[1] - def.money[0]) * random();
  const options: WeaponKind[] = role === 'slasher' ? ['steelLongsword'] :
    role === 'villager' ? ['steelKnife', 'revolver', 'machinePistol'] : ['revolver', 'machinePistol'];
  const price = (kind: WeaponKind) => weaponMarketValue(makeWeapon(1, kind));
  const eligible = options.filter(k => price(k) <= budget);
  if (!eligible.length) return null;
  let roll = random() * eligible.reduce((n, k) => n + price(k), 0), kind = eligible[eligible.length - 1];
  for (const k of eligible) { roll -= price(k); if (roll < 0) { kind = k; break; } }
  const q = random(), quality = Math.max(0, Math.min(4, def.quality + (q < .1 ? -1 : q < .2 ? 1 : 0))) as 0 | 1 | 2 | 3 | 4;
  const gear = makeWeapon(id(), kind, quality), hp = def.hp[0] + (def.hp[1] - def.hp[0]) * random();
  gear.hitPoints = Math.max(1, Math.min(WEAPON_DEFS[kind].maxHitPoints, unityRound(WEAPON_DEFS[kind].maxHitPoints * hp)));
  return gear;
}
/** Grenadiers/elite weapons and pack animals have no supported combat bodies yet.
 * Native budget and supported kind weights are kept; omissions are explicit. */
export function visitorGroup(random: () => number): VisitorKind[] {
  let remaining = 550 + Math.floor(random() * 450) - 45, highest = 0;
  const group: VisitorKind[] = ['trader'];
  while (true) {
    const options = (['villager', 'guard', 'slasher', 'gunner'] as const).filter(k => VISITOR_KINDS[k].cost <= remaining);
    if (!options.length) break;
    highest = Math.max(highest, ...options.map(k => VISITOR_KINDS[k].cost));
    const weight = (k: typeof options[number]) => VISITOR_KINDS[k].weight * evaluateCurve([[.2, .01], [.3, .3], [.5, 1]], VISITOR_KINDS[k].cost / highest);
    let roll = random() * options.reduce((n, k) => n + weight(k), 0), chosen = options[options.length - 1];
    for (const k of options) { roll -= weight(k); if (roll < 0) { chosen = k; break; } }
    group.push(chosen); remaining -= VISITOR_KINDS[chosen].cost;
  }
  return group;
}
