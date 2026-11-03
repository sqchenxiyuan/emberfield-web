import { CELLS, emptyCounts, inside, type VoxelSave, type Resource } from './types';
import { initialSkills } from './skills';
import { initialTrade, nextTradeVisit, tradeCycleAt, TRADER_NAMES } from './trade';
import { STORY_INTERVAL } from './storytellerRules';
import { validBatch } from './preservation';
import { validApparel } from './apparel';
import { validWeapon } from './weapons';

export function rejectLegacyTradeFields(old: Record<string, any>) {
  if (old.version >= 21) return;
  if (Object.hasOwn(old, 'trade') || Object.hasOwn(old, 'homeArea') ||
      old.pawns?.some((p: any) => p?.faction === 'trader' || p?.phase === 'trade' || Object.hasOwn(p?.skills ?? {}, 'social')) ||
      old.items?.some((i: any) => i?.resource === 'silver') ||
      old.pawns?.some((p: any) => p?.cargo?.resource === 'silver') ||
      ['produced', 'consumed', 'spoiled', 'destroyed'].some(k => Object.hasOwn(old.stats?.[k] ?? {}, 'silver')) ||
      old.stockpiles?.some((s: any) => s?.accepts?.includes('silver')))
    throw new Error('旧存档包含新版贸易、银币或社交字段');
}
export function migrateTradeFields(old: Record<string, any>, sourceVersion: number) {
  if (old.version !== 20) return;
  if (!Array.isArray(old.pawns) || !old.stats) throw new Error('旧贸易迁移数据无效');
  for (const [i, p] of old.pawns.entries()) {
    if (!p?.skills) throw new Error('旧人物技能无效');
    // Early migrations may already have constructed a current profile. Genuine
    // v20 inputs have nine skills; no old XP or physical item is overwritten.
    p.skills.social = initialSkills(i, p.faction !== 'colony').social;
  }
  for (const key of ['produced', 'consumed', 'spoiled', 'destroyed']) {
    if (!old.stats[key]) throw new Error('旧物资账本无效');
    old.stats[key].silver = 0;
  }
  old.trade = initialTrade(old.seed, old.tick);
  old.homeArea = [];
  old.version = 21;
}
const integer = (n: unknown, min: number, max = Number.MAX_SAFE_INTEGER): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = () => { throw new Error('贸易日程、商人物资或会话无效'); };
export function validateTrade(d: VoxelSave, ids: Set<number>, apparelIds: Set<number>, weaponIds: Set<number>) {
  const t = d.trade;
  if (!record(t) || !Array.isArray(d.homeArea) || d.homeArea.length > CELLS ||
      d.homeArea.some(n => !integer(n, 0, CELLS - 1)) || new Set(d.homeArea).size !== d.homeArea.length ||
      !integer(t.visits, 0) || !integer(t.goodwill, -100, 100) ||
      !integer(t.lastInterval, 0, Math.floor(d.tick / STORY_INTERVAL)) || Math.floor(d.tick / STORY_INTERVAL) - t.lastInterval > 1 ||
      !integer(t.cycle, -1, 10000) || t.cycle !== tradeCycleAt(t.lastInterval) ||
      !integer(t.priorHit, -9999999) || !Array.isArray(t.cycleHits) || t.cycleHits.length > 5 ||
      t.cycleHits.some(n => !integer(n, 0)) || !Array.isArray(t.caravans) || t.caravans.length > 64 ||
      !Array.isArray(t.receipts) || t.receipts.length > 32) fail();
  const expected = initialTrade(d.seed, t.lastInterval * STORY_INTERVAL);
  if (t.priorHit !== expected.priorHit || JSON.stringify(t.cycleHits) !== JSON.stringify(expected.cycleHits) ||
      t.nextVisit !== nextTradeVisit(t, d.seed)) fail();
  for (const ledger of [t.imported, t.exported]) if (!record(ledger) ||
    Object.keys(ledger).length !== Object.keys(emptyCounts()).length ||
    (Object.keys(emptyCounts()) as Resource[]).some(k => !integer(ledger[k], 0, 1e12)) ||
    ledger.carcass !== 0) fail();
  const addId = (id: number) => {
    if (!integer(id, 1, d.nextId - 1) || ids.has(id) || apparelIds.has(id) || weaponIds.has(id)) fail();
    ids.add(id);
  };
  const owned = new Set<number>();
  for (const c of t.caravans) {
    if (!record(c) || !Object.hasOwn(TRADER_NAMES, c.kind) || typeof c.name !== 'string' || c.name.length > 80 ||
        !record(c.meeting) || !inside(c.meeting) || !['arriving', 'visiting', 'leaving'].includes(c.stage) ||
        !integer(c.arrivedAt, 0, d.tick) || !integer(c.stayTicks, 5400, 8999) ||
        (c.visitingAt !== null && !integer(c.visitingAt, c.arrivedAt, d.tick)) ||
        (c.stage === 'visiting' && c.visitingAt === null) || typeof c.reason !== 'string' || c.reason.length > 200 ||
        !Array.isArray(c.pawnIds) || !c.pawnIds.length || c.pawnIds.length > 23 ||
        new Set(c.pawnIds).size !== c.pawnIds.length || !c.pawnIds.includes(c.traderId) ||
        !Array.isArray(c.stock) || c.stock.length > 2048) fail();
    addId(c.id);
    for (const id of c.pawnIds) {
      const p = d.pawns.find(p => p.id === id);
      if (!integer(id, 1, d.nextId - 1) || owned.has(id) || (p ? p.faction !== 'trader' :
        ids.has(id) || apparelIds.has(id) || weaponIds.has(id))) fail();
      owned.add(id);
    }
    for (const stock of c.stock) {
      if (!record(stock) || !validBatch(stock) || stock.resource === 'carcass' || !c.pawnIds.includes(stock.carrierId) ||
          !d.pawns.some(p => p.id === stock.carrierId && p.faction === 'trader')) fail();
      addId(stock.id);
      if (stock.apparel) {
        if (!validApparel(stock.apparel) || stock.apparel.wearTicks > d.tick) fail();
        addId(stock.apparel.id); apparelIds.add(stock.apparel.id);
      }
      if (stock.weapon) {
        if (!validWeapon(stock.weapon)) fail();
        addId(stock.weapon.id); weaponIds.add(stock.weapon.id);
      }
    }
  }
  if (d.pawns.some(p => p.faction === 'trader' && (!owned.has(p.id) || p.jobId !== null ||
      p.carePhase !== null || p.weaponTask !== null || p.apparelTask !== null))) fail();
  if (t.session !== null) {
    if (!record(t.session)) fail();
    const s = t.session, p = d.pawns.find(p => p.id === s.pawnId);
    if (!record(s) || !['walking', 'ready'].includes(s.stage) || !integer(s.startedAt, 0, d.tick) ||
        !t.caravans.some(c => c.id === s.caravanId) || !p || p.faction !== 'colony' || p.phase !== 'trade' ||
        p.dead || p.downed || p.drafted || p.cargo !== null || p.jobId !== null || p.carePhase !== null) fail();
    addId(s.id);
  }
  if (d.pawns.some(p => p.phase === 'trade' && p.id !== t.session?.pawnId)) fail();
  let priorTick = -1;
  for (const r of t.receipts) {
    if (!record(r) || !integer(r.tick, 0, d.tick) || r.tick < priorTick ||
      !integer(r.caravanId, 1, d.nextId - 1) || !d.pawns.some(p => p.id === r.pawnId && p.faction === 'colony') ||
      typeof r.gift !== 'boolean' || !integer(r.silverToColony, -1e9, 1e9) ||
      !integer(r.quotedSilverToColony, -1e9, 1e9) || !integer(r.shortfall, 0, 1e9) ||
      r.quotedSilverToColony - r.silverToColony !== r.shortfall ||
      (r.shortfall > 0 && r.silverToColony < 0) ||
      (r.gift && (r.silverToColony !== 0 || r.shortfall !== 0 || r.quotedSilverToColony !== 0)) ||
      !integer(r.goodwillBefore, -100, 100) || !integer(r.goodwillAfter, -100, 100) ||
      !Array.isArray(r.transferred) || !r.transferred.length || r.transferred.length > 10000 ||
      r.transferred.some(row => !record(row) || !['colony', 'trader'].includes(row.side) ||
        !integer(row.stockId, 1, d.nextId - 1) || !validBatch(row.batch) || row.batch.resource === 'carcass' ||
        (r.gift && row.side !== 'colony'))) fail();
    addId(r.id); priorTick = r.tick;
  }
}
