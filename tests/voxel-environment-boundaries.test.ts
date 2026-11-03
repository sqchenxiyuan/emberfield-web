import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, DEPTH, WIDTH, at, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { initialStoryteller } from '../src/voxel/storyteller';
import { initialTrade } from '../src/voxel/trade';
import { initialFireHazards } from '../src/voxel/fire';
import { advanceWeather, initialWeather, weatherEffects } from '../src/voxel/weather';
import { batchHitPoints, deteriorationRandom } from '../src/voxel/deterioration';
import { quoteTrade } from '../src/voxel/tradeWorld';
import { rotLimit } from '../src/voxel/preservation';

const pos = (x: number, y = 16): Pos => ({ x, y, z: 8 });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c); expect(result.ok, result.message).toBe(true);
}
function until(s: VoxelSimulation, condition: () => boolean, limit = 2000) {
  for (let i = 0; i < limit && !condition(); i++) s.step();
  expect(condition(), JSON.stringify({ tick: s.tick, animals: s.animals,
    pawns: s.pawns.map(p => [p.phase, p.reason, p.cargo]) })).toBe(true);
}
/** Controlled starting geometry/time isolate boundary behavior. After loading
 * the fixture, all transitions use ordinary simulation ticks and commands. */
function flat() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  s.animals = []; s.trees = []; s.items = []; s.stockpiles = []; s.homeArea.clear();
  s.blocks.fill(Block.Stone); s.blocks.fill(Block.Air, WIDTH * DEPTH * 8);
  s.ladders.fill(0); s.structureKinds.fill(0); s.spawn = pos(12);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(18, 16 + i * 2)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
    p.worn = []; p.weapon = null;
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof Pawn['priorities']] = 0;
  }
  command(s, { type: 'threats', enabled: false });
  command(s, { type: 'fireHazards', enabled: false });
  return s;
}
function clock(s: VoxelSimulation, tick: number) {
  s.tick = tick; s.storyteller = initialStoryteller(s.seed, tick); s.trade = initialTrade(s.seed, tick);
  s.fireHazards = initialFireHazards(s.seed, tick); s.fireHazards.enabled = false;
  s.weather = initialWeather(s.seed, s.settings);
  advanceWeather(s.weather, s.seed, s.settings, tick, s.generator);
  command(s, { type: 'threats', enabled: false });
  return VoxelSimulation.load(s.save());
}
function nextDamage(s: VoxelSimulation, id: number, baseRate: number) {
  const weather = structuredClone(s.weather);
  for (let tick = Math.ceil((s.tick + 1) / 100) * 100; tick <= s.tick + DAY * 4; tick += 100) {
    advanceWeather(weather, s.seed, s.settings, tick, s.generator);
    const rate = baseRate * (1 + 4 * weatherEffects(weather, tick).rainRate);
    if (deteriorationRandom(s.seed, id, tick) < rate * 100 / DAY) return tick;
  }
  throw new Error('No deterministic deterioration sample in fixture horizon');
}
function blockedCorpse(hitPoints = 100, rotProgress = 120) {
  let s = flat(); const id = s.nextId++;
  s.animals.push({ ...pos(22), id, species: 'hare', name: '野兔', health: 0, hunger: 80,
    dead: true, phase: 'dead', hunt: false, moveTick: 0, decisionTick: 0,
    fleeUntil: 0, threatId: null, retryTick: 0, rotProgress,
    ...(hitPoints < 100 ? { carcassHitPoints: hitPoints } : {}) });
  s.stats.produced.carcass = 1;
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
    if (Math.abs(dx) + Math.abs(dy) > 3) continue;
    s.items.push({ ...pos(22 + dx, 16 + dy), id: s.nextId++, resource: 'stone',
      amount: dx === -3 && dy === 0 ? 1 : 75 });
  }
  s = clock(s, 6999);
  return { s: clock(s, nextDamage(s, id, 1) - 1), id };
}

describe('environment physical ownership boundaries', () => {
  it('retains blocked dead-animal damage through reload and actual hauling that permits carcass placement', () => {
    let { s, id } = blockedCorpse();
    s.step();
    expect(s.animals.find(a => a.id === id)).toMatchObject({ carcassHitPoints: 99, rotProgress: 121 });
    expect(s.items.some(i => i.carcass?.animalId === id)).toBe(false);
    expect(s.counts().carcass).toBe(1);
    s = VoxelSimulation.load(s.save());
    const before = s.tick;
    command(s, { type: 'designate', tool: 'stock', from: pos(16) });
    command(s, { type: 'storage', from: pos(16), priority: 1, accepts: ['stone'] });
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'haul', value: 1 });
    until(s, () => !s.animals.some(a => a.id === id), 90);
    const corpse = s.items.filter(i => i.carcass?.animalId === id);
    expect(corpse).toHaveLength(1);
    expect(corpse[0]).toMatchObject({ ...pos(19), amount: 1, hitPoints: 99,
      carcass: { animalId: id, species: 'hare' }, rotProgress: 121 + s.tick - before });
    expect(s.pawns[0].cargo).toMatchObject({ resource: 'stone', amount: 1 });
    expect(s.stats.produced.carcass).toBe(1);
    expect(s.stats.destroyed.carcass).toBe(0); expect(s.stats.spoiled.carcass).toBe(0);
    const restored = VoxelSimulation.load(s.save());
    expect(restored.items.find(i => i.carcass?.animalId === id)).toEqual(corpse[0]);
    expect(restored.counts().carcass).toBe(1);
  });

  it('counts zero-HP blocked corpse destruction once when rot would also expire on that tick', () => {
    const limit = rotLimit({ resource: 'carcass' })!;
    const { s, id } = blockedCorpse(1, limit - 1);
    s.step();
    expect(s.animals.some(a => a.id === id)).toBe(false);
    expect(s.items.some(i => i.carcass?.animalId === id)).toBe(false);
    expect(s.counts().carcass).toBe(0);
    expect(s.stats.destroyed.carcass).toBe(1); expect(s.stats.spoiled.carcass).toBe(0);
    const restored = VoxelSimulation.load(s.save()); restored.step(100);
    expect(restored.stats.destroyed.carcass).toBe(1); expect(restored.stats.spoiled.carcass).toBe(0);
  });

  it('invalidates an actual deterioration quote before price changes, and trades the current HP without damaging held stock', () => {
    let s = clock(flat(), 6000); s.tradeSpawn();
    command(s, { type: 'tradeTalk', pawnId: s.pawns[0].id, caravanId: s.trade.caravans[0].id });
    until(s, () => quoteTrade(s) !== null && s.trade.caravans[0].stage === 'visiting' &&
      s.pawns.find(p => p.id === s.trade.caravans[0].traderId)!.path.length === 0);
    const caravan = s.trade.caravans[0]; caravan.kind = 'bulk';
    // Remove unrelated perishables so a changed quote proves HP invalidation.
    caravan.stock = caravan.stock.filter(i => i.resource === 'silver');
    const heldId = s.nextId++, itemId = s.nextId++;
    caravan.stock.push({ id: heldId, carrierId: caravan.traderId, resource: 'cloth', amount: 3, hitPoints: 41 });
    s.items.push({ ...pos(14), id: itemId, resource: 'cloth', amount: 7 });
    command(s, { type: 'homeArea', from: pos(14), enabled: true });
    s = VoxelSimulation.load(s.save());
    const damageTick = nextDamage(s, itemId, 4); s.step(damageTick - s.tick - 1);
    const oldQuote = quoteTrade(s)!;
    expect(oldQuote, JSON.stringify({ tick: s.tick, damageTick, session: s.trade.session,
      pawns: s.pawns.map(p => [p.phase, p.reason, p.food, p.rest]) })).not.toBeNull();
    const oldOffer = oldQuote.offers.find(o => o.side === 'colony' && o.stockId === itemId)!;
    expect(batchHitPoints(oldOffer.batch)).toBe(80);
    s.step();
    const quote = quoteTrade(s)!;
    const offer = quote.offers.find(o => o.side === 'colony' && o.stockId === itemId)!;
    expect(offer.batch.hitPoints).toBe(79); expect(offer.unitPrice).toBe(oldOffer.unitPrice);
    expect(quote.key).not.toBe(oldQuote.key);
    expect(s.trade.caravans[0].stock.find(i => i.id === heldId)?.hitPoints).toBe(41);
    const before = s.save();
    const result = s.command({ type: 'tradeCommit', sessionId: oldQuote.sessionId, quoteKey: oldQuote.key,
      lines: [{ side: 'colony', stockId: itemId, amount: 7 }], gift: false, acceptShortfall: false });
    expect(result.ok).toBe(false); expect(result.message).toContain('报价'); expect(s.save()).toEqual(before);
    command(s, { type: 'tradeCommit', sessionId: quote.sessionId, quoteKey: quote.key,
      lines: [{ side: 'colony', stockId: itemId, amount: 7 }], gift: false, acceptShortfall: false });
    expect(s.items.some(i => i.id === itemId)).toBe(false);
    expect(s.trade.caravans[0].stock.find(i => i.resource === 'cloth' && i.id !== heldId))
      .toMatchObject({ amount: 7, hitPoints: 79 });
    expect(s.trade.receipts.at(-1)!.transferred[0].batch).toEqual({ resource: 'cloth', amount: 7, hitPoints: 79 });
    expect(s.trade.exported.cloth).toBe(7);
    const restored = VoxelSimulation.load(s.save());
    expect(restored.trade.caravans[0].stock).toEqual(s.trade.caravans[0].stock);
    expect(restored.trade.receipts).toEqual(s.trade.receipts);
  }, 20000);
});
