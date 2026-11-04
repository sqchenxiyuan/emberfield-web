import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { at, Block, index, position, type Pawn, type Pos, type WildAnimal } from '../src/voxel/types';
import { makeFire, fireDamageKey, FIRE_MAX_HP } from '../src/voxel/fire';
import { startFirefight, validFirefight, firefightTick, startRepair, repairTick } from '../src/voxel/fireWorld';
import { startCapture, wardenTick, tryWarden } from '../src/voxel/prisonWorld';
import { initialPrisoner } from '../src/voxel/prisoners';
import { initialAnimalState } from '../src/voxel/husbandry';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { handleTick, tryHandle } from '../src/voxel/husbandryWorld';
import { initialPenFilter, planRopePath } from '../src/voxel/pens';
import { animalAllowed, animalManagementTick, ropeTick, tryRope } from '../src/voxel/pensWorld';
import { applyTradeCommand, quoteTrade, updateTrade } from '../src/voxel/tradeWorld';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });

/** Controlled module boundaries, not a normal-play campaign. We use the real
 * host's release and physical inventory handling, but explicitly supply geometry
 * and an independent allowed-cell predicate to isolate each module contract. */
function fixture() {
  let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.items = []; s.trees = []; s.grass = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 32; x++) for (let y = 10; y <= 22; y++)
    for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(11, 16 + i)); p.food = 90; p.rest = 90;
    p.skills.animals.level = 8; p.priorities.handle = 1; p.priorities.warden = 1;
  }
  s = VoxelSimulation.load(s.save()); // Rebuild tree/terrain caches for the controlled geometry.
  const blocked = new Set<number>();
  s.pawnAllowed = (_pawn, target) => !blocked.has(at(target));
  return { s, p: s.pawns[0], other: s.pawns[1], blocked };
}
function only(s: VoxelSimulation, cells: Pos[]) {
  const allowed = new Set(cells.map(at));
  s.pawnAllowed = (_pawn, target) => allowed.has(at(target));
  return allowed;
}
function animal(s: VoxelSimulation, extra: Partial<WildAnimal> = {}) {
  const id = s.nextId++;
  const a: WildAnimal = { ...pos(20), ...initialAnimalState(id, 'hare', s.tick), id,
    species: 'hare', name: '测试兔', health: ANIMAL_DEFS.hare.health, hunger: 80,
    dead: false, phase: 'roam', hunt: false, moveTick: 0, decisionTick: 0,
    fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0, ...extra };
  s.animals.push(a); return a;
}
function moveOne(p: Pawn, carried?: Pawn) {
  if (!p.path.length) return;
  Object.assign(p, position(p.path.shift()!));
  if (carried?.carriedBy === p.id) Object.assign(carried, { x: p.x, y: p.y, z: p.z });
}
function capturedFixture() {
  const f = fixture(), { s, p, other: patient } = f;
  Object.assign(patient, pos(15), { faction: 'raider', downed: true, phase: 'downed' });
  const bed = { ...pos(22), id: s.nextId++, axis: 'x' as const, quality: 2 as const,
    medical: false, prisoner: true, owner: null };
  s.beds.push(bed);
  // The allowed-area test does not claim to prove room classification.
  s.prisonCells = () => new Set([at(bed)]);
  const allowed = only(s, [patient, bed]);
  return { ...f, patient, bed, allowed };
}
function ropeFixture() {
  const f = fixture(), { s, p } = f;
  Object.assign(p, pos(15));
  const a = animal(s, { ...pos(14), species: 'deer', health: ANIMAL_DEFS.deer.health,
    faction: 'colony', tameness: 5 });
  const marker = { ...pos(18), id: s.nextId++, name: '终点圈地', filter: initialPenFilter() };
  s.penMarkers.push(marker);
  const chain = (q: Pos, from: number, to: number) => q.y !== 16 || q.z !== 8 || q.x < from || q.x > to
    ? [] : [q.x - 1, q.x + 1].filter(x => x >= from && x <= to).map(x => at(pos(x)));
  // Closed enclosure starts at x=16. Animal destination 18 is allowed; the
  // handler may stand outside at 19 when completing the real paired movement.
  s.penNeighbors = (q, mode) => chain(q, mode === 'enclosure' ? 16 : 14, 19);
  s.penStandable = q => q.y === 16 && q.z === 8 && q.x >= 14 && q.x <= 19;
  const allowed = only(s, [a, pos(18)]);
  return { ...f, a, marker, allowed };
}
function tradeFixture() {
  const f = fixture(), { s, p, other: trader } = f;
  Object.assign(trader, pos(20), { faction: 'trader' });
  const caravan = { id: s.nextId++, kind: 'bulk' as const, name: '测试商队', pawnIds: [trader.id],
    traderId: trader.id, stock: [{ id: s.nextId++, resource: 'wood' as const, amount: 5, carrierId: trader.id }],
    meeting: pos(20), stage: 'visiting' as const, arrivedAt: 0, visitingAt: 0, stayTicks: 100000, reason: '' };
  s.trade.caravans = [caravan]; s.trade.goodwill = 0;
  return { ...f, trader, caravan };
}

describe('allowed-area host behavior boundaries', () => {
  it('rejects a fire target without releasing the existing work or cargo', () => {
    const { s, p, blocked } = fixture(), fire = makeFire(s.nextId++, pos(20), 0, 'lightning');
    s.fires.push(fire); s.homeArea.add(at(fire)); blocked.add(at(fire));
    p.cargo = { resource: 'wood', amount: 7 }; p.jobId = 777;
    expect(startFirefight(s, p, fire)).toBe(false);
    expect(p.jobId).toBe(777); expect(p.cargo).toEqual({ resource: 'wood', amount: 7 });
    expect(p.reason).toContain('允许区域');
  });
  it('keeps an accepted firefighting trip through outside cells, then cancels a newly excluded target', () => {
    const { s, p } = fixture(), fire = makeFire(s.nextId++, pos(20), 0, 'lightning');
    s.fires.push(fire); s.homeArea.add(at(fire));
    const allowed = only(s, [fire]);
    expect(startFirefight(s, p, fire)).toBe(true);
    expect(p.path.some(cell => !allowed.has(cell))).toBe(true);
    expect(validFirefight(s, p)).toBe(true);
    allowed.delete(at(fire)); const size = fire.size;
    firefightTick(s, p);
    expect(p.firefightTask).toBeNull(); expect(fire.size).toBe(size);
  });
  it('checks repair targets both when selected and before producing repair progress', () => {
    const { s, p, blocked } = fixture(), target = pos(20);
    s.blocks[at(target)] = Block.Wood; s.homeArea.add(at(target));
    const d = { ...target, kind: 'block' as const, key: fireDamageKey('block', null, target),
      targetId: null, hitPoints: 40, maxHitPoints: FIRE_MAX_HP.block };
    s.fireDamage.push(d); blocked.add(at(target)); blocked.add(at({ ...target, z: target.z + 1 }));
    expect(startRepair(s, p, d)).toBe(false);
    blocked.clear(); expect(startRepair(s, p, d)).toBe(true);
    blocked.add(at(target)); blocked.add(at({ ...target, z: target.z + 1 })); repairTick(s, p);
    expect(p.repairTask).toBeNull(); expect(d.hitPoints).toBe(40);
  });
  it('reports capture target and destination restrictions before changing ownership', () => {
    const { s, p, patient, bed, allowed } = capturedFixture();
    allowed.delete(at(patient));
    expect(startCapture(s, p, patient)).toMatchObject({ ok: false, message: expect.stringContaining('允许区域') });
    allowed.add(at(patient)); allowed.delete(at(bed));
    expect(startCapture(s, p, patient)).toMatchObject({ ok: false, message: expect.stringContaining('允许区域') });
    expect(patient.faction).toBe('raider'); expect(patient.carriedBy).toBeNull(); expect(p.wardenTask).toBeNull();
  });
  it('carries the same prisoner through excluded transit cells and finishes at the allowed bed', () => {
    const { s, p, patient, bed, allowed } = capturedFixture();
    const result = startCapture(s, p, patient); expect(result.ok, result.message).toBe(true);
    let crossedOutsideWhileCarrying = false;
    for (let i = 0; i < 60 && p.wardenTask; i++) {
      s.tick++; wardenTick(s, p); moveOne(p, patient);
      if (p.wardenTask?.stage === 'captureCarry' && !allowed.has(at(p))) {
        crossedOutsideWhileCarrying = true; expect(patient.carriedBy).toBe(p.id);
      }
    }
    expect(crossedOutsideWhileCarrying).toBe(true); expect(p.wardenTask).toBeNull();
    expect(at(patient)).toBe(at(bed)); expect(patient.carriedBy).toBeNull(); expect(bed.owner).toBe(patient.id);
  });
  it('safely puts a carried prisoner down if the destination becomes excluded', () => {
    const { s, p, patient, bed, allowed } = capturedFixture();
    const result = startCapture(s, p, patient); expect(result.ok, result.message).toBe(true);
    for (let i = 0; i < 20 && p.wardenTask?.stage !== 'captureCarry'; i++) { s.tick++; wardenTick(s, p); moveOne(p, patient); }
    expect(patient.carriedBy).toBe(p.id); allowed.delete(at(bed));
    const location = at(p); wardenTick(s, p);
    expect(p.wardenTask).toBeNull(); expect(p.carryingPawnId).toBeNull();
    expect(patient.carriedBy).toBeNull(); expect(at(patient)).toBe(location);
  });
  it('does not schedule an automatic prisoner visit outside the warden area', () => {
    const { s, p, other: patient, blocked } = fixture();
    patient.faction = 'prisoner'; patient.prisoner = initialPrisoner(s.tick); patient.prisoner.policy = 'release';
    blocked.add(at(patient)); expect(tryWarden(s, p)).toBe(false); expect(p.wardenTask).toBeNull();
  });
  it('leaves a restricted animal available to another handler without a global retry delay', () => {
    const { s, p, other } = fixture(), a = animal(s, { faction: 'colony', slaughter: true });
    s.pawnAllowed = (actor, target) => actor.id !== p.id || at(target) !== at(a);
    expect(tryHandle(s, p)).toBe(false); expect(a.retryTick).toBe(0);
    expect(tryHandle(s, other)).toBe(true); expect(other.handleTask?.animalId).toBe(a.id);
  });
  it('does not reserve forbidden-area feed and preserves carried food after an animal moves out', () => {
    const { s, p, blocked } = fixture(), a = animal(s, { tame: true });
    const food = { ...pos(14), id: s.nextId++, resource: 'grain' as const, amount: 12, crop: 'rice' as const, rotProgress: 0 };
    s.items.push(food); blocked.add(at(food));
    expect(tryHandle(s, p)).toBe(false); expect(p.handleTask).toBeNull(); expect(food.amount).toBe(12);
    blocked.clear(); expect(tryHandle(s, p)).toBe(true);
    blocked.add(at(food)); handleTick(s, p); expect(p.handleTask).toBeNull(); expect(a.retryTick).toBe(0);
    blocked.clear(); expect(tryHandle(s, p)).toBe(true);
    p.handleTask!.stage = 'approach'; p.handleTask!.foodId = null;
    p.cargo = { resource: 'grain', amount: 2, crop: 'rice', rotProgress: 4 };
    blocked.add(at(a)); handleTick(s, p);
    expect(p.handleTask).toBeNull(); expect(p.cargo).toEqual({ resource: 'grain', amount: 2, crop: 'rice', rotProgress: 4 });
    expect(a.retryTick).toBe(0);
  });
  it('treats an empty assigned rabbit area as unrestricted and clears a stale return goal', () => {
    const { s } = fixture(), area = { id: s.nextId++, name: '空区', color: 0, cells: [] as number[] };
    s.animalAreas.push(area); const a = animal(s, { faction: 'colony', allowedAreaId: area.id });
    a.goal = { kind: 'area', id: area.id }; a.path = [at(pos(21))];
    expect(animalAllowed(s, a, pos(30))).toBe(true);
    expect(animalManagementTick(s, a)).toBe(false);
    expect(a.goal).toBeNull(); expect(a.path).toEqual([]); expect(a.allowedAreaId).toBe(area.id);
  });
  it('searches past an invalid rope endpoint instead of turning area edges into walls', () => {
    const graph = (q: Pos) => [q.x - 1, q.x + 1].filter(x => x >= 14 && x <= 19).map(x => at(pos(x)));
    const path = planRopePath(pos(14), pos(15), [at(pos(16)), at(pos(18))], graph,
      (a, p) => a.x === 18 && p.x === 19);
    expect(path).toEqual([16, 17, 18, 19].map(x => at(pos(x))));
  });
  it('leads across excluded cells to the allowed animal destination, with the handler standing outside', () => {
    const { s, p, a, allowed } = ropeFixture();
    expect(tryRope(s, p)).toBe(true); let crossed = false;
    for (let i = 0; i < 300 && p.ropeTask; i++) {
      s.tick++; ropeTick(s, p);
      if (p.ropeTask?.stage === 'lead' && !allowed.has(at(p))) crossed = true;
      if (a.x === 16 || a.x === 17) expect(p.ropeTask?.stage).toBe('lead');
    }
    expect(crossed).toBe(true); expect(p.ropeTask).toBeNull();
    expect(a.x).toBe(18); expect(p.x).toBe(19); expect(a.phase).toBe('roam');
    expect(allowed.has(at(a))).toBe(true); expect(allowed.has(at(p))).toBe(false);
  });
  it('releases a rope after a destination-area change without moving either endpoint or setting a retry timer', () => {
    const { s, p, a, marker, allowed } = ropeFixture();
    expect(tryRope(s, p)).toBe(true);
    for (let i = 0; i < 150 && p.ropeTask?.stage !== 'lead'; i++) { s.tick++; ropeTick(s, p); }
    expect(p.ropeTask?.stage).toBe('lead'); const before = [at(a), at(p)];
    allowed.delete(at(marker)); ropeTick(s, p);
    expect(p.ropeTask).toBeNull(); expect([at(a), at(p)]).toEqual(before); expect(a.retryTick).toBe(0);
    expect(a.phase).toBe('roam');
  });
  it('rejects an outside trader, but may cross and stand outside to talk to an inside trader', () => {
    const { s, p, trader, caravan, blocked } = tradeFixture();
    blocked.add(at(trader));
    expect(applyTradeCommand(s, { type: 'tradeTalk', pawnId: p.id, caravanId: caravan.id }))
      .toMatchObject({ ok: false, message: expect.stringContaining('允许区域') });
    const allowed = only(s, [trader]);
    expect(applyTradeCommand(s, { type: 'tradeTalk', pawnId: p.id, caravanId: caravan.id }).ok).toBe(true);
    expect(p.path.at(-1)).toBe(at(pos(19))); expect(p.path.some(cell => !allowed.has(cell))).toBe(true);
    updateTrade(s); expect(s.trade.session).not.toBeNull();
  });
  it('invalidates a ready quote on area changes before transferring any goods', () => {
    const { s, p, trader, caravan, blocked } = tradeFixture(); Object.assign(p, pos(19));
    expect(applyTradeCommand(s, { type: 'tradeTalk', pawnId: p.id, caravanId: caravan.id }).ok).toBe(true);
    updateTrade(s); const quote = quoteTrade(s)!; expect(quote).not.toBeNull();
    const stock = structuredClone(caravan.stock), items = structuredClone(s.items);
    blocked.add(at(trader)); expect(quoteTrade(s)).toBeNull();
    const result = applyTradeCommand(s, { type: 'tradeCommit', sessionId: quote.sessionId,
      quoteKey: quote.key, lines: [], gift: false, acceptShortfall: false });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('允许区域') });
    expect(caravan.stock).toEqual(stock); expect(s.items).toEqual(items); expect(s.trade.receipts).toEqual([]);
    updateTrade(s); expect(s.trade.session).toBeNull(); expect(p.phase).toBe('idle');
  });
});
