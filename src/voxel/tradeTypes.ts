import type { AnimalSpecies, Cargo, Counts, Pos, WildAnimal } from './types';
import type { PricedTradeOffer, TradeLine } from './tradeRules';

export type TraderKind = 'bulk' | 'combat';
/** Items belong to an actual visitor; these are not colony inventory. */
export interface TraderStock extends Cargo { id: number; carrierId: number }
export interface TraderCaravan {
  id: number;
  kind: TraderKind;
  name: string;
  pawnIds: number[];
  animalIds: number[];
  traderId: number;
  stock: TraderStock[];
  meeting: Pos;
  stage: 'arriving' | 'visiting' | 'leaving';
  arrivedAt: number;
  visitingAt: number | null;
  stayTicks: number;
  reason: string;
}
export interface TradeSession {
  id: number;
  caravanId: number;
  pawnId: number;
  stage: 'walking' | 'ready';
  startedAt: number;
}
export interface TradeReceipt {
  id: number;
  tick: number;
  caravanId: number;
  pawnId: number;
  gift: boolean;
  silverToColony: number;
  quotedSilverToColony: number;
  shortfall: number;
  goodwillBefore: number;
  goodwillAfter: number;
  transferred: { side: 'colony' | 'trader'; stockId: number; batch: Cargo }[];
  /** Individual at handover, not a resource stack or a second live actor. */
  animalTransfers: { side: 'colony' | 'trader'; animal: WildAnimal }[];
}
export interface TradeState {
  /** Persistent independent scheduling; save/load never rerolls this appointment. */
  nextVisit: number | null;
  lastInterval: number;
  cycle: number;
  cycleHits: number[];
  priorHit: number;
  visits: number;
  goodwill: number;
  caravans: TraderCaravan[];
  session: TradeSession | null;
  receipts: TradeReceipt[];
  /** External transfers for colony material conservation, excluding NPC consumption. */
  imported: Counts;
  exported: Counts;
  animalLedger: { bought: Record<AnimalSpecies, number>; sold: Record<AnimalSpecies, number> };
}
export interface TradeOffer extends PricedTradeOffer { batch: Cargo; marketValue: number }
export interface AnimalTradeOffer extends PricedTradeOffer { animal: WildAnimal; marketValue: number }
export interface TradeQuote {
  sessionId: number;
  /** Exact terms fingerprint. An expired quote must be refreshed, never silently repriced. */
  key: string;
  caravanId: number;
  pawnId: number;
  improvement: number;
  difficultyLoss: number;
  colonySilver: number;
  traderSilver: number;
  offers: TradeOffer[];
  animalOffers: AnimalTradeOffer[];
}
export interface TradeView extends TradeState { quote: TradeQuote | null }
export type TradeCommand =
  | { type: 'tradeTalk'; pawnId: number; caravanId: number }
  | { type: 'tradeCancel'; sessionId: number }
  | { type: 'tradeCommit'; sessionId: number; quoteKey: string; lines: TradeLine[]; gift: boolean; acceptShortfall: boolean }
  | { type: 'homeArea'; from: Pos; to?: Pos; enabled: boolean };
