import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { emptyAnimalTradeCounts, newTraderAnimal } from '../src/voxel/animalTrade';
import { rejectLegacyAnimalTrade, migrateAnimalTrade, validateAnimalTrade } from '../src/voxel/animalTradePersistence';
import { validateHusbandry } from '../src/voxel/husbandryPersistence';
import { validateTrade } from '../src/voxel/tradePersistence';
import { index, type VoxelSave, type WildAnimal } from '../src/voxel/types';
import type { TradeReceipt } from '../src/voxel/tradeTypes';

let seed: VoxelSave | undefined;
/** Controlled current-model fixture, not an authentic historical campaign. */
function fixture() {
  if (!seed) {
    const s = new VoxelSimulation(73129, { biome: 'boreal' });
    s.tradeSpawn(); seed = s.save();
  }
  const d = structuredClone(seed), caravan = d.trade.caravans[0];
  d.animals = d.animals.filter(a => a.faction !== 'trader');
  for (const c of d.trade.caravans) c.animalIds = [];
  const leader = d.pawns.find(p => p.id === caravan.traderId)!;
  const animal = newTraderAnimal(d.nextId++, 'alpaca', 'female', d.tick, { x: leader.x, y: leader.y, z: leader.z });
  animal.goal = { kind: 'caravan', id: caravan.id };
  d.animals.push(animal); caravan.animalIds.push(animal.id);
  return { d, caravan, animal };
}
function receipt(d: VoxelSave, animal: WildAnimal, side: 'colony' | 'trader' = 'trader', gift = false) {
  const snapshot = structuredClone(animal); snapshot.faction = side;
  if (side === 'colony') snapshot.goal = null;
  const r: TradeReceipt = { id: d.nextId++, tick: d.tick, caravanId: d.trade.caravans[0].id,
    pawnId: d.pawns.find(p => p.faction === 'colony')!.id, gift, silverToColony: 0, quotedSilverToColony: 0,
    shortfall: 0, goodwillBefore: 0, goodwillAfter: 0, transferred: [], animalTransfers: [{ side, animal: snapshot }] };
  d.trade.receipts.push(r); d.trade.animalLedger[side === 'trader' ? 'bought' : 'sold'][animal.species]++;
  return r;
}
function tradeValidation(d: VoxelSave) {
  // Live animal IDs already belong to the world's identity set. History may
  // mention the same individual and must not register it for a second time.
  const ids = new Set([...d.pawns, ...d.animals, ...d.items].map(a => a.id));
  validateTrade(d, ids, new Set(), new Set()); validateAnimalTrade(d);
  return ids;
}

describe('v53 live animal migration boundary', () => {
  it('adds only empty ownership, receipt and species ledgers to explicitly synthetic v52 data', () => {
    const old: any = { version: 52, tick: 123, animals: [{ id: 9, faction: 'wild', goal: null }],
      trade: { caravans: [{ id: 7, stock: [{ amount: 2 }] }], receipts: [{ id: 8, transferred: [{ amount: 1 }] }],
        imported: { silver: 17 }, exported: { cloth: 2 }, nextVisit: 456 } };
    const before = structuredClone(old);
    rejectLegacyAnimalTrade(old, 52); migrateAnimalTrade(old, 52);
    expect(old).toEqual({ ...before, trade: { ...before.trade,
      caravans: [{ ...before.trade.caravans[0], animalIds: [] }],
      receipts: [{ ...before.trade.receipts[0], animalTransfers: [] }],
      animalLedger: { bought: emptyAnimalTradeCounts(), sold: emptyAnimalTradeCounts() } } });
    expect(old.version).toBe(52);
  });
  it('rejects smuggled fields and trader animals before mutating synthetic old data', () => {
    const variants: ((d: any) => void)[] = [
      d => { d.trade.animalLedger = { bought: {}, sold: {} }; },
      d => { d.trade.caravans = [{ animalIds: [] }]; },
      d => { d.trade.receipts = [{ animalTransfers: [] }]; },
      d => { d.trade.animalOffers = []; },
      d => { d.animals = [{ faction: 'trader' }]; },
      d => { d.animals = [{ faction: 'wild', goal: { kind: 'caravan', id: 1 } }]; },
      d => { d.extra = { nested: { animalTransfers: [] } }; },
    ];
    for (const change of variants) {
      const d: any = { version: 52, trade: {}, animals: [] }; change(d); const before = structuredClone(d);
      expect(() => rejectLegacyAnimalTrade(d, 52)).toThrow(/活畜/); expect(d).toEqual(before);
    }
    expect(() => rejectLegacyAnimalTrade({ version: 52, pawns: [{ faction: 'trader' }], trade: {} }, 52)).not.toThrow();
  });
  it('does not repair missing current-schema fields or silently reset nonzero ledgers', () => {
    for (const change of [
      (d: any) => { delete d.trade.animalLedger; },
      (d: any) => { delete d.trade.caravans[0].animalIds; },
      (d: any) => { delete d.trade.receipts[0].animalTransfers; },
    ]) {
      const { d, animal } = fixture(); receipt(d, animal); change(d); const before = structuredClone(d);
      migrateAnimalTrade(d, 59); expect(d).toEqual(before); expect(() => validateAnimalTrade(d)).toThrow();
    }
    const { d } = fixture(); d.trade.animalLedger.bought.alpaca = 7;
    migrateAnimalTrade(d, 59); expect(d.trade.animalLedger.bought.alpaca).toBe(7);
  });
  it('rejects malformed historical lists without partially migrating them', () => {
    const d: any = { trade: { caravans: [{ stock: [] }, null], receipts: [] } }, before = structuredClone(d);
    expect(() => migrateAnimalTrade(d, 52)).toThrow(); expect(d).toEqual(before);
  });
});

describe('live caravan animal ownership', () => {
  it('accepts a real caravan goal and keeps its animal identity through load', () => {
    const { d, animal } = fixture();
    expect(() => validateHusbandry(d)).not.toThrow(); expect(() => tradeValidation(d)).not.toThrow();
    const loaded = VoxelSimulation.load(d).save();
    expect(loaded.version).toBe(59); expect(loaded.trade).toEqual(d.trade);
    expect(loaded.animals.find(a => a.id === animal.id)).toEqual(animal);
  });
  it('requires exactly one live trader animal for every listed identity', () => {
    const variants: ((d: VoxelSave, a: WildAnimal) => void)[] = [
      d => { d.trade.caravans[0].animalIds.push(d.trade.caravans[0].animalIds[0]); },
      d => { d.trade.caravans.push({ ...structuredClone(d.trade.caravans[0]), id: d.nextId++ }); },
      d => { d.trade.caravans[0].animalIds = [d.nextId++]; },
      (d, a) => { a.dead = true; },
      (d, a) => { a.faction = 'colony'; },
      d => { d.trade.caravans[0].animalIds = []; },
      d => { d.trade.caravans[0].animalIds = [d.pawns[0].id]; },
    ];
    for (const change of variants) {
      const { d, animal } = fixture(); change(d, animal); expect(() => validateAnimalTrade(d)).toThrow();
    }
  });
  it('rejects stale caravan goals and caravan goals assigned to colony or wild animals', () => {
    for (const faction of ['wild', 'colony'] as const) {
      const { d, animal, caravan } = fixture(); animal.faction = faction; caravan.animalIds = [];
      expect(() => validateAnimalTrade(d)).toThrow(/跟随/);
    }
    const { d, animal } = fixture(); animal.goal!.id = d.nextId++;
    expect(() => validateAnimalTrade(d)).toThrow(/跟随/);
  });
  it('rejects colony assignments, marks and handler reservations on trader animals', () => {
    const variants: ((d: VoxelSave, a: WildAnimal) => void)[] = [
      (d, a) => { a.allowedAreaId = 1; }, (d, a) => { a.requestedPenId = 1; },
      (d, a) => { a.ropePaused = true; }, (d, a) => { a.hunt = true; }, (d, a) => { a.tame = true; },
      (d, a) => { a.slaughter = true; }, (d, a) => { a.releaseMarked = true; },
      (d, a) => { a.phase = 'rope'; }, (d, a) => { a.phase = 'interact'; },
      (d, a) => { d.pawns[0].handleTask = { animalId: a.id } as any; },
      (d, a) => { d.pawns[0].ropeTask = { animalId: a.id } as any; },
    ];
    for (const change of variants) {
      const { d, animal } = fixture(); change(d, animal); expect(() => validateAnimalTrade(d)).toThrow();
    }
  });
  it('keeps the same ground-only, one-cell path rule for caravan following', () => {
    const { d, animal } = fixture(); Object.assign(animal, { x: 20, y: 20, z: 8 });
    animal.path = [index(21, 20, 8), index(21, 21, 9)]; expect(() => validateHusbandry(d)).not.toThrow();
    for (const path of [[index(22, 20, 8)], [index(20, 20, 9)], [index(21, 20, 10)],
      [index(21, 20, 8), index(20, 20, 8), index(21, 20, 8)]]) {
      animal.path = path; expect(() => validateHusbandry(d)).toThrow(/路径/);
    }
  });
});

describe('historical live animal receipts and separate accounting', () => {
  it('allows animal-only receipts and never registers a historical animal as another live object', () => {
    const { d, animal } = fixture(); receipt(d, animal);
    const count = d.animals.length, identities = tradeValidation(d);
    expect(identities.has(animal.id)).toBe(true); expect(d.animals).toHaveLength(count);
    expect(VoxelSimulation.load(d).save().trade.receipts).toEqual(d.trade.receipts);
    expect(d.trade.imported).not.toHaveProperty('alpaca'); expect(d.trade.exported).not.toHaveProperty('alpaca');
  });
  it('retains valid snapshots after the current individual, caravan and historical parent disappear', () => {
    const { d, animal, caravan } = fixture(); animal.pregnancy = { fatherId: d.nextId++, progress: .45 };
    const r = receipt(d, animal); d.animals = d.animals.filter(a => a.id !== animal.id); caravan.animalIds = [];
    d.trade.caravans = []; d.pawns = d.pawns.filter(p => p.faction !== 'trader');
    expect(() => validateAnimalTrade(d)).not.toThrow();
    expect(VoxelSimulation.load(d).save().trade.receipts[0]).toEqual(r);
  });
  it('permits the same individual across different historical trades and retained totals below lifetime totals', () => {
    const { d, animal } = fixture(); receipt(d, animal); receipt(d, animal, 'colony');
    d.trade.animalLedger.bought.alpaca += 3;
    expect(() => validateAnimalTrade(d)).not.toThrow();
    d.trade.animalLedger.sold.alpaca = 0; expect(() => validateAnimalTrade(d)).toThrow(/账本/);
  });
  it('rejects duplicate individuals, fake quantities, ownership mismatches and non-colony gifts', () => {
    const changes: ((r: TradeReceipt) => void)[] = [
      r => { r.animalTransfers.push(structuredClone(r.animalTransfers[0])); },
      r => { (r.animalTransfers[0] as any).amount = 2; },
      r => { r.animalTransfers[0].side = 'colony'; },
      r => { r.gift = true; },
      r => { (r.animalTransfers[0] as any).side = 'wild'; },
    ];
    for (const change of changes) {
      const { d, animal } = fixture(); const r = receipt(d, animal); change(r);
      expect(() => validateAnimalTrade(d)).toThrow();
    }
    const { d, animal } = fixture(); receipt(d, animal, 'colony', true);
    expect(() => validateAnimalTrade(d)).not.toThrow();
  });
  it('validates complete biological snapshots without trusting obsolete world references', () => {
    const changes: ((a: any, d: VoxelSave) => void)[] = [
      a => { delete a.milkFullness; }, a => { a.health = NaN; }, a => { a.health = 0; },
      a => { a.dead = true; }, a => { a.growth = 1.01; }, a => { a.woolGrowth = -1; },
      a => { a.milkFullness = .3; }, a => { a.eggProgress = .2; }, a => { a.hunger = 101; },
      a => { a.name = '伪造物种'; }, a => { a.rotProgress = 1; }, a => { a.carcassHitPoints = 50; },
      a => { a.goal = { kind: 'caravan', id: 0 }; }, a => { a.path = [index(40, 40, 8)]; },
      (a, d) => { a.pregnancy = { fatherId: d.nextId++, progress: 2 }; },
      (a, d) => { a.pregnancy = { fatherId: d.pawns[0].id, progress: .3 }; },
      a => { a.pregnancy = { fatherId: a.id, progress: .2 }; },
    ];
    for (const change of changes) {
      const { d, animal } = fixture(); const r = receipt(d, animal); change(r.animalTransfers[0].animal, d);
      expect(() => validateAnimalTrade(d)).toThrow();
    }
  });
  it('rejects historical IDs impersonating a current non-animal or changing immutable sex/species', () => {
    for (const change of [
      (a: WildAnimal, d: VoxelSave) => { a.id = d.pawns[0].id; },
      (a: WildAnimal, d: VoxelSave) => { a.id = d.trade.caravans[0].id; },
      (a: WildAnimal) => { a.sex = 'male'; },
    ]) {
      const { d, animal } = fixture(); const r = receipt(d, animal); change(r.animalTransfers[0].animal, d);
      expect(() => validateAnimalTrade(d)).toThrow(/身份/);
    }
  });
  it('rejects malformed animal ledgers and transient offer payloads in saves', () => {
    const changes: ((d: any) => void)[] = [
      d => { d.trade.animalLedger = []; }, d => { delete d.trade.animalLedger.bought.chicken; },
      d => { d.trade.animalLedger.bought.dragon = 0; }, d => { d.trade.animalLedger.sold.alpaca = -1; },
      d => { d.trade.animalLedger.bought.alpaca = .5; }, d => { d.trade.animalLedger.bought.alpaca = Infinity; },
      d => { d.trade.animalOffers = []; },
    ];
    for (const change of changes) {
      const { d } = fixture(); change(d); expect(() => validateAnimalTrade(d)).toThrow();
    }
  });
  it('still rejects an entirely empty receipt and live animal entries in material ledgers', () => {
    const { d, animal } = fixture(); const r = receipt(d, animal); r.animalTransfers = [];
    expect(() => tradeValidation(d)).toThrow();
    r.animalTransfers = [{ side: 'trader', animal: structuredClone(animal) }];
    (d.trade.imported as any).alpaca = 1; expect(() => tradeValidation(d)).toThrow();
  });
});
