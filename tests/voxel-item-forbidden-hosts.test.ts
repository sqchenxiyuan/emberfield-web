import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { at, Block, index, position, type Pawn, type Pos, type Stack, type VoxelCommand, type WildAnimal } from '../src/voxel/types';
import { handleTick, tryHandle, updateHusbandry } from '../src/voxel/husbandryWorld';
import { initialAnimalState, HUSBANDRY_RULES } from '../src/voxel/husbandry';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { initialPrisoner } from '../src/voxel/prisoners';
import { tryWarden } from '../src/voxel/prisonWorld';
import { applyTradeCommand, quoteTrade } from '../src/voxel/tradeWorld';
import type { TraderCaravan } from '../src/voxel/tradeTypes';
import { freshBatch } from '../src/voxel/preservation';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, value: VoxelCommand) {
  const result = s.command(value); expect(result.ok, result.message).toBe(true); return result;
}
/** Controlled geometry and starting entities, not a naturally generated campaign.
 * Host selection, reservations, release and physical transfers remain real. */
function fixture() {
  let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.items = []; s.trees = []; s.grass = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 32; x++) for (let y = 10; y <= 22; y++)
    for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(11, 16 + i)); p.food = 90; p.rest = 90; p.schedule.fill('work');
    for (const work of Object.keys(p.priorities)) p.priorities[work as keyof Pawn['priorities']] = 0;
    p.skills.animals.level = 8;
  }
  s = VoxelSimulation.load(s.save());
  s.pawns[0].priorities.handle = 1; s.pawns[0].priorities.warden = 1;
  return { s, p: s.pawns[0], other: s.pawns[1] };
}
function animal(s: VoxelSimulation, action: 'tame' | 'maintain' | 'feed') {
  const id = s.nextId++;
  const a: WildAnimal = { ...pos(22), ...initialAnimalState(id, 'hare', s.tick), id,
    species: 'hare', name: '测试兔', health: ANIMAL_DEFS.hare.health, hunger: action === 'feed' ? 5 : 80,
    dead: false, phase: 'roam', hunt: false, moveTick: 0, decisionTick: 0,
    fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0, nextInteractionTick: 0,
    faction: action === 'tame' ? 'wild' : 'colony', tame: action === 'tame', tameness: action === 'tame' ? 0 : action === 'maintain' ? 3 : 5 };
  s.animals.push(a); return a;
}
function grain(s: VoxelSimulation, x = 14, forbidden = false): Stack {
  const item = { id: s.nextId++, ...pos(x), ...freshBatch('grain', 20), ...(forbidden ? { forbidden: true } : {}) };
  s.items.push(item); return item;
}
function handlerStep(s: VoxelSimulation, p: Pawn) {
  s.tick++; handleTick(s, p);
  if (p.path.length) Object.assign(p, position(p.path.shift()!));
}
function market() {
  const f = fixture(), { s, p, other: trader } = f;
  Object.assign(p, pos(19), { phase: 'trade' }); Object.assign(trader, pos(20), { faction: 'trader' });
  const caravan: TraderCaravan = { id: s.nextId++, kind: 'bulk', name: '测试商队', pawnIds: [trader.id], traderId: trader.id,
    stock: [{ id: s.nextId++, resource: 'silver' as const, amount: 1000, carrierId: trader.id },
      { id: s.nextId++, resource: 'components' as const, amount: 10, carrierId: trader.id }],
    meeting: pos(20), stage: 'visiting' as const, arrivedAt: 0, visitingAt: 0, stayTicks: 100000, reason: '' };
  s.trade.caravans = [caravan]; s.trade.goodwill = 0;
  s.trade.session = { id: s.nextId++, caravanId: caravan.id, pawnId: p.id, stage: 'ready', startedAt: s.tick };
  return { ...f, trader, caravan };
}

describe('generic item forbidding at Host boundaries', () => {
  it.each(['tame', 'maintain', 'feed'] as const)('does not reserve forbidden feed for %s and selects an allowed alternative', action => {
    const { s, p } = fixture(), a = animal(s, action), blocked = grain(s, 12, true);
    expect(tryHandle(s, p)).toBe(false); expect(p.handleTask).toBeNull(); expect(a.retryTick).toBe(0);
    expect(blocked.amount).toBe(20); expect(s.stats.consumed.grain).toBe(0);
    const allowed = grain(s, 18);
    expect(tryHandle(s, p)).toBe(true);
    expect(p.handleTask).toMatchObject({ animalId: a.id, action, stage: 'fetch', foodId: allowed.id });
    expect(s.animalAvailable(blocked)).toBe(20);
  });

  it('rechecks a changed source before pickup and releases its animal and food reservations', () => {
    const { s, p, other } = fixture(), a = animal(s, 'tame'), source = grain(s);
    expect(tryHandle(s, p)).toBe(true);
    expect(s.animalAvailable(source)).toBeLessThan(source.amount);
    // Directly changing the flag exercises the Host's own tick guard, independently
    // of the public command's immediate invalidation of referencing tasks.
    source.forbidden = true; handleTick(s, p);
    expect(p.handleTask).toBeNull(); expect(p.path).toEqual([]); expect(p.cargo).toBeNull();
    expect(p.reason).toContain('禁止'); expect(s.animalAvailable(source)).toBe(20);
    expect(a.tameness).toBe(0); expect(a.retryTick).toBe(0); expect(s.stats.consumed.grain).toBe(0);
    source.forbidden = false; other.priorities.handle = 1;
    expect(tryHandle(s, other)).toBe(true); expect(other.handleTask?.animalId).toBe(a.id);
  });

  it('immediately cancels a forbidden pending fetch, then permits the same source after Allow', () => {
    const { s, p } = fixture(), a = animal(s, 'feed'), source = grain(s);
    expect(tryHandle(s, p)).toBe(true);
    command(s, { type: 'itemForbidden', itemId: source.id, forbidden: true });
    expect(p.handleTask).toBeNull(); expect(p.cargo).toBeNull(); expect(p.path).toEqual([]);
    expect(source.amount).toBe(20); expect(a.hunger).toBe(5); expect(s.stats.consumed.grain).toBe(0);
    command(s, { type: 'itemForbidden', itemId: source.id, forbidden: false });
    expect(tryHandle(s, p)).toBe(true); expect(p.handleTask?.foodId).toBe(source.id);
  });

  it('keeps already carried food and interaction progress when the remaining ground stack is forbidden', () => {
    const { s, p } = fixture(), a = animal(s, 'feed'), source = grain(s);
    expect(tryHandle(s, p)).toBe(true);
    for (let n = 0; n < 200 && p.handleTask?.stage !== 'interact'; n++) handlerStep(s, p);
    expect(p.handleTask?.stage).toBe('interact'); expect(p.cargo?.resource).toBe('grain');
    const task = p.handleTask!, progress = task.progress, cargo = structuredClone(p.cargo), remaining = source.amount;
    expect(task.foodId).toBeNull(); expect(remaining).toBeLessThan(20);
    command(s, { type: 'itemForbidden', itemId: source.id, forbidden: true });
    expect(p.handleTask).toBe(task); expect(task.progress).toBe(progress); expect(p.cargo).toEqual(cargo);
    for (let n = 0; n <= HUSBANDRY_RULES.handleWork && p.handleTask; n++) handlerStep(s, p);
    expect(p.handleTask).toBeNull(); expect(a.hunger).toBeGreaterThan(5);
    expect(source.amount).toBe(remaining); expect(source.forbidden).toBe(true);
    expect(s.counts().grain + s.stats.consumed.grain).toBe(20);
  });

  it('routes warden feeding through ordinary food restrictions and cancels a newly forbidden pending meal', () => {
    const { s, p, other: patient } = fixture();
    Object.assign(patient, pos(22), { faction: 'prisoner', phase: 'prisoner', food: 10 });
    const bed = { ...pos(22), id: s.nextId++, axis: 'x' as const, quality: 2 as const,
      medical: false, prisoner: true, owner: patient.id };
    s.beds.push(bed); patient.prisoner = initialPrisoner(s.tick, bed.id);
    // Room validity is supplied here; actual feeding selection and reservations
    // are owned by the real core care implementation reached from tryWarden.
    s.prisonCells = () => new Set([at(patient)]);
    const food = { id: s.nextId++, ...pos(14), ...freshBatch('food', 4), forbidden: true };
    s.items.push(food);
    expect(tryWarden(s, p)).toBe(false); expect(p.carePhase).toBeNull();
    command(s, { type: 'itemForbidden', itemId: food.id, forbidden: false });
    expect(tryWarden(s, p)).toBe(true); expect(p.carePhase).toBe('feedFetch'); expect(p.careFoodId).toBe(food.id);
    command(s, { type: 'itemForbidden', itemId: food.id, forbidden: true });
    expect(p.carePhase).toBeNull(); expect(p.careFoodId).toBeNull(); expect(p.careAmount).toBe(0);
    expect(p.cargo).toBeNull(); expect(patient.food).toBe(10); expect(food.amount).toBe(4);
    expect(s.animalAvailable(food)).toBe(4); expect(s.stats.consumed.food).toBe(0);
  });

  it.each(['colony', 'wild'] as const)('uses the eater faction for ordinary autonomous hunger (%s)', faction => {
    const { s } = fixture(), a = animal(s, 'feed'), food = grain(s, 24, true);
    a.faction = faction; a.tameness = faction === 'colony' ? 5 : 0; a.hunger = 40;
    // Only animal ticks run: no handler can fetch or feed on its behalf.
    for (let n = 0; n < 250 && !s.stats.consumed.grain; n++) { s.tick++; updateHusbandry(s); }
    if (faction === 'wild') {
      expect(s.stats.consumed.grain).toBeGreaterThan(0); expect(food.amount).toBeLessThan(20);
    } else {
      expect(s.stats.consumed.grain).toBe(0); expect(food.amount).toBe(20); expect(a.goal).toBeNull();
      command(s, { type: 'itemForbidden', itemId: food.id, forbidden: false });
      for (let n = 0; n < 250 && !s.stats.consumed.grain; n++) { s.tick++; updateHusbandry(s); }
      expect(s.stats.consumed.grain).toBeGreaterThan(0);
    }
    expect(s.counts().grain + s.stats.consumed.grain).toBe(20);
  });

  it('stops a domestic animal eating a newly forbidden stack before consuming it, then resumes after Allow', () => {
    const { s } = fixture(), a = animal(s, 'feed'), food = grain(s, 24);
    a.hunger = 40;
    for (let n = 0; n < 200 && a.eatProgress < 10; n++) { s.tick++; updateHusbandry(s); }
    expect(a.phase).toBe('eat'); expect(a.eatProgress).toBeGreaterThanOrEqual(10);
    expect(a.goal).toEqual({ kind: 'food', id: food.id }); expect(food.amount).toBe(20);
    command(s, { type: 'itemForbidden', itemId: food.id, forbidden: true });
    s.tick++; updateHusbandry(s);
    expect(a.goal).toBeNull(); expect(a.eatProgress).toBe(0); expect(s.stats.consumed.grain).toBe(0);
    expect(food.amount).toBe(20);
    command(s, { type: 'itemForbidden', itemId: food.id, forbidden: false });
    for (let n = 0; n < 250 && !s.stats.consumed.grain; n++) { s.tick++; updateHusbandry(s); }
    expect(s.stats.consumed.grain).toBeGreaterThan(0);
    expect(s.counts().grain + s.stats.consumed.grain).toBe(20);
  });

  it('still quotes and sells forbidden reachable colony goods without changing the unsold flag', () => {
    const { s, caravan } = market(), item = grain(s, 15, true); s.homeArea.add(at(item));
    const quote = quoteTrade(s)!;
    expect(quote.offers.find(o => o.side === 'colony' && o.stockId === item.id)?.amount).toBe(20);
    const result = applyTradeCommand(s, { type: 'tradeCommit', sessionId: quote.sessionId, quoteKey: quote.key,
      lines: [{ side: 'colony', stockId: item.id, amount: 12 }], gift: false, acceptShortfall: false });
    expect(result.ok, result.message).toBe(true);
    expect(s.items.find(i => i.id === item.id)).toMatchObject({ amount: 8, forbidden: true });
    expect(s.trade.exported.grain).toBe(12);
    expect(caravan.stock.filter(i => i.resource === 'grain').reduce((total, i) => total + i.amount, 0)).toBe(12);
    expect(s.counts().silver).toBe(s.trade.receipts.at(-1)!.silverToColony);
  });

  it('accepts forbidden reachable colony silver for an ordinary purchase', () => {
    const { s, caravan } = market();
    const silver = { id: s.nextId++, ...pos(15), resource: 'silver' as const, amount: 1000, forbidden: true };
    s.items.push(silver); s.homeArea.add(at(silver));
    const quote = quoteTrade(s)!, offer = quote.offers.find(o => o.side === 'trader' && o.batch.resource === 'components')!;
    expect(quote.colonySilver).toBe(1000);
    const result = applyTradeCommand(s, { type: 'tradeCommit', sessionId: quote.sessionId, quoteKey: quote.key,
      lines: [{ side: 'trader', stockId: offer.stockId, amount: 1 }], gift: false, acceptShortfall: false });
    expect(result.ok, result.message).toBe(true);
    const paid = -s.trade.receipts.at(-1)!.silverToColony;
    expect(paid).toBeGreaterThan(0); expect(s.counts().silver).toBe(1000 - paid);
    expect(s.items.find(i => i.id === silver.id)?.forbidden).toBe(true);
    expect(s.counts().components).toBe(1); expect(s.trade.exported.silver).toBe(paid);
    expect(caravan.stock.find(i => i.id === offer.stockId)?.amount).toBe(9);
  });

  it('preserves a sold forbidden item flag when the same goods are bought back into a new ground stack', () => {
    const { s, p, caravan } = market(), goods = grain(s, 16, true);
    const silver = { id: s.nextId++, ...pos(15), resource: 'silver' as const, amount: 1000 };
    s.items.push(silver); s.homeArea.add(at(silver)); s.homeArea.add(at(goods));
    const sale = quoteTrade(s)!;
    const sold = applyTradeCommand(s, { type: 'tradeCommit', sessionId: sale.sessionId, quoteKey: sale.key,
      lines: [{ side: 'colony', stockId: goods.id, amount: 20 }], gift: false, acceptShortfall: false });
    expect(sold.ok, sold.message).toBe(true); expect(s.counts().grain).toBe(0);
    const traderGoods = caravan.stock.find(i => i.resource === 'grain')!;
    expect(traderGoods).toMatchObject({ amount: 20, forbidden: true });
    p.phase = 'trade';
    s.trade.session = { id: s.nextId++, caravanId: caravan.id, pawnId: p.id, stage: 'ready', startedAt: s.tick };
    const purchase = quoteTrade(s)!;
    const bought = applyTradeCommand(s, { type: 'tradeCommit', sessionId: purchase.sessionId, quoteKey: purchase.key,
      lines: [{ side: 'trader', stockId: traderGoods.id, amount: 20 }], gift: false, acceptShortfall: false });
    expect(bought.ok, bought.message).toBe(true);
    expect(s.items.filter(i => i.resource === 'grain')).toEqual([expect.objectContaining({ amount: 20, forbidden: true })]);
    expect(s.trade.exported.grain).toBe(20); expect(s.trade.imported.grain).toBe(20);
    expect(caravan.stock.some(i => i.id === traderGoods.id)).toBe(false);
  });
});
