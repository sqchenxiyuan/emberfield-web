import { describe, expect, it } from 'vitest';
import { DAY, type Cargo } from '../src/voxel/types';
import { makeApparel } from '../src/voxel/apparel';
import { makeWeapon } from '../src/voxel/weapons';
import { advanceRot, compatibleBatches, freshBatch, mergeBatch, portion, validBatch } from '../src/voxel/preservation';
import { cargoMarketValue } from '../src/voxel/wealth';
import { advanceDeterioration, batchHitPoints, batchHpFraction, batchMaxHitPoints,
  deteriorationEnvironmentFactor, deteriorationRandom, deteriorationRate,
  RESOURCE_CONDITION_DEFS, setBatchHitPoints, validBatchHitPoints,
  type DeteriorationEnvironment } from '../src/voxel/deterioration';

const rain: DeteriorationEnvironment = { exposed: true, outdoors: true, rainRate: 1 };
const dry: DeteriorationEnvironment = { ...rain, rainRate: 0 };
const seed = 73129, tick = 100;
function identityFor(batch: Cargo, hit: boolean, env = rain) {
  const probability = deteriorationRate(batch, env) * 100 / DAY;
  for (let id = 1; id <= 100000; id++)
    if ((deteriorationRandom(seed, id, tick) < probability) === hit) return id;
  throw new Error('No deterministic sampling identity found');
}

describe('physical item HP and source-derived deterioration rules', () => {
  it('keeps the selected resource HP and rates instead of treating every resource alike', () => {
    const expected = { wood: [150, .5], cloth: [80, 4], alpacaWool: [90, 3.4], components: [70, 2], food: [50, .25],
      grain: [60, 6], meat: [60, 6], milk: [60, 6], eggUnfertilized: [20, 2], eggFertilized: [20, 2], meal: [50, 10], herb: [60, 6], carcass: [100, 1], chunk: [300, 0], unfinished: [50, 2] };
    for (const [resource, [maximum, rate]] of Object.entries(expected)) {
      const batch = { resource, amount: 1 } as Cargo;
      expect(batchMaxHitPoints(batch), resource).toBe(maximum);
      expect(batchHitPoints(batch), resource).toBe(maximum);
      expect(deteriorationRate(batch, dry), resource).toBe(rate);
    }
    expect(Object.keys(RESOURCE_CONDITION_DEFS)).toHaveLength(18);
  });
  it('keeps silver, steel and stone blocks free of HP and leaves chunks immune to environmental damage', () => {
    for (const resource of ['silver', 'steel', 'stone'] as const) {
      const batch = freshBatch(resource, 12);
      expect(batchMaxHitPoints(batch)).toBeNull(); expect(batchHpFraction(batch)).toBe(1);
      expect(advanceDeterioration(batch, rain, seed, 1, tick)).toBe(false);
      expect(validBatch({ ...batch, hitPoints: 1 })).toBe(false);
      expect(() => setBatchHitPoints(batch, 1)).toThrow();
      expect(batch).toEqual(freshBatch(resource, 12));
    }
    const chunk: Cargo = { resource: 'chunk', amount: 1, hitPoints: 7 };
    for (let id = 1; id <= 50; id++) expect(advanceDeterioration(chunk, rain, seed, id, tick)).toBe(false);
    expect(chunk.hitPoints).toBe(7); expect(validBatch(chunk)).toBe(true);
  });
  it('stores ordinary full HP implicitly and rejects invalid or mismatched HP', () => {
    const batch = freshBatch('wood', 30);
    expect(batch).not.toHaveProperty('hitPoints'); expect(batchHpFraction(batch)).toBe(1);
    setBatchHitPoints(batch, 75); expect(batchHpFraction(batch)).toBe(.5); expect(validBatch(batch)).toBe(true);
    setBatchHitPoints(batch, 150); expect(batch).not.toHaveProperty('hitPoints');
    for (const hitPoints of [0, -1, .5, 151, NaN, Infinity, null, '75'])
      expect(validBatch({ ...batch, hitPoints }), String(hitPoints)).toBe(false);
    for (const hitPoints of [-1, .5, 151, NaN]) expect(() => setBatchHitPoints(batch, hitPoints)).toThrow();
    expect(validBatch({ ...batch, hitPoints: 150 })).toBe(true);
  });
  it('uses nested equipment HP without adding a second pool and copies it independently when moved', () => {
    const batches: Cargo[] = [{ resource: 'apparel', amount: 1, apparel: makeApparel(10, 'shirt') },
      { resource: 'weapon', amount: 1, weapon: makeWeapon(11, 'revolver') }];
    for (const original of batches) {
      const batch = portion(original, 1), maximum = batchMaxHitPoints(batch)!;
      setBatchHitPoints(batch, 1);
      expect(batchHitPoints(batch)).toBe(1); expect(batch).not.toHaveProperty('hitPoints');
      expect(batchHitPoints(original)).toBe(maximum); expect(validBatch(batch)).toBe(true);
      expect(validBatchHitPoints({ ...batch, hitPoints: 1 })).toBe(false);
      expect(validBatch({ ...batch, hitPoints: 1 })).toBe(false);
      expect(() => mergeBatch(batch, original)).toThrow();
    }
  });
  it('distinguishes exposed rain, outdoor-temperature sheds, enclosed rooms and protective furniture', () => {
    expect(deteriorationEnvironmentFactor(dry)).toBe(1);
    expect(deteriorationEnvironmentFactor(rain)).toBe(5);
    expect(deteriorationEnvironmentFactor({ ...rain, rainRate: .5 })).toBe(3);
    expect(deteriorationEnvironmentFactor({ ...rain, exposed: false })).toBe(.5);
    expect(deteriorationEnvironmentFactor({ ...rain, outdoors: false })).toBe(2.5);
    expect(deteriorationEnvironmentFactor({ ...rain, exposed: false, outdoors: false })).toBe(0);
    expect(deteriorationEnvironmentFactor({ ...rain, protected: true })).toBe(0);
    expect(() => deteriorationEnvironmentFactor({ ...rain, rainRate: NaN })).toThrow();
    expect(() => deteriorationEnvironmentFactor({ ...rain, rainRate: 2 })).toThrow();
  });
  it('applies native equipment quality factors while the club retains its no-quality rate', () => {
    const qualities = [0, 1, 2, 3, 4, 5, 6] as const;
    expect(qualities.map(quality => deteriorationRate({ resource: 'apparel', amount: 1,
      apparel: makeApparel(20 + quality, 'shirt', quality) }, dry))).toEqual([4, 3, 2, 1.6, 1.2, .6, .2]);
    expect(qualities.map(quality => deteriorationRate({ resource: 'weapon', amount: 1,
      weapon: makeWeapon(30 + quality, 'revolver', quality) }, dry))).toEqual([4, 3, 2, 1.6, 1.2, .6, .2]);
    expect(deteriorationRate({ resource: 'weapon', amount: 1, weapon: makeWeapon(40, 'woodClub') }, dry)).toBe(2);
  });
  it('samples independently by seed, identity and tick and applies at most one real HP per scheduled visit', () => {
    const batch = freshBatch('cloth', 75), before = structuredClone(batch);
    expect(advanceDeterioration(batch, rain, seed, identityFor(batch, false), tick)).toBe(false);
    expect(batch).toEqual(before);
    expect(advanceDeterioration(batch, rain, seed, identityFor(batch, true), tick)).toBe(false);
    expect(batchHitPoints(batch)).toBe(79); expect(batch.amount).toBe(75);
    expect(deteriorationRandom(seed, 12, tick)).toBe(deteriorationRandom(seed, 12, tick));
    expect(deteriorationRandom(seed + 4294967296, 12, tick)).not.toBe(deteriorationRandom(seed, 12, tick));
    expect(deteriorationRandom(seed, 12, tick + 4294967296)).not.toBe(deteriorationRandom(seed, 12, tick));
    expect(() => advanceDeterioration(batch, rain, seed, 12, tick, 101)).toThrow();
  });
  it('reports destruction of the whole batch at zero HP without changing material counts or rot accounting itself', () => {
    const batch: Cargo = { ...freshBatch('grain', 75), hitPoints: 1, rotProgress: 1000 };
    expect(advanceDeterioration(batch, rain, seed, identityFor(batch, true), tick)).toBe(true);
    expect(batch).toMatchObject({ hitPoints: 0, amount: 75, rotProgress: 1000 });
    expect(validBatch(batch)).toBe(false); // World must remove and count this physical batch once.
  });
  it('damages existing garment and weapon HP in place rather than dropping equipment identity', () => {
    for (const batch of [{ resource: 'apparel', amount: 1, apparel: makeApparel(51, 'tuque') },
      { resource: 'weapon', amount: 1, weapon: makeWeapon(52, 'steelKnife') }] as Cargo[]) {
      const identity = batch.apparel?.id ?? batch.weapon!.id;
      setBatchHitPoints(batch, 2);
      expect(advanceDeterioration(batch, rain, seed, identityFor(batch, true), tick)).toBe(false);
      expect(batchHitPoints(batch)).toBe(1); expect(batch.apparel?.id ?? batch.weapon!.id).toBe(identity);
      expect(batch).not.toHaveProperty('hitPoints');
    }
  });
  it('keeps temperature-driven rot and HP deterioration independent, including after a JSON round trip', () => {
    const batch: Cargo = { ...freshBatch('meal', 4), hitPoints: 25, rotProgress: DAY, poisonChance: .2 };
    expect(advanceRot(batch, -10, DAY)).toBe(false); expect(batch.hitPoints).toBe(25);
    const id = identityFor(batch, true), loaded: Cargo = JSON.parse(JSON.stringify(batch));
    for (const value of [batch, loaded]) {
      advanceDeterioration(value, rain, seed, id, tick);
      expect(value).toMatchObject({ hitPoints: 24, rotProgress: DAY, amount: 4, poisonChance: .2 });
    }
    for (let t = 200; t <= 1000; t += 100) {
      advanceDeterioration(batch, rain, seed, id, t); advanceDeterioration(loaded, rain, seed, id, t);
    }
    expect(loaded).toEqual(batch);
  });
});

describe('condition across physical splits, stack merging and valuation', () => {
  it('weights only the transferred portion and preserves independent rot and contamination averages', () => {
    const receiving: Cargo = { ...freshBatch('meal', 6), hitPoints: 40, rotProgress: 100, poisonChance: .1 };
    const source: Cargo = { ...freshBatch('meal', 10), hitPoints: 10, rotProgress: 500, poisonChance: .5 };
    const transferred = portion(source, 2);
    expect(compatibleBatches(receiving, transferred)).toBe(true);
    mergeBatch(receiving, transferred);
    expect(receiving).toMatchObject({ amount: 8, hitPoints: 33, rotProgress: 200, poisonChance: .2 });
    expect(source).toMatchObject({ amount: 10, hitPoints: 10, rotProgress: 500, poisonChance: .5 });
    expect(transferred).toMatchObject({ amount: 2, hitPoints: 10 });
  });
  it('treats omitted incoming or destination HP as full and retains native upward rounding', () => {
    const damaged: Cargo = { ...freshBatch('wood', 1), hitPoints: 149 };
    mergeBatch(damaged, freshBatch('wood', 1));
    expect(batchHitPoints(damaged)).toBe(150); // Native ceil(149.5), not exact HP-mass conservation.
    expect(damaged).not.toHaveProperty('hitPoints');
    const fresh = freshBatch('wood', 3);
    mergeBatch(fresh, { ...freshBatch('wood', 1), hitPoints: 10 });
    expect(fresh.hitPoints).toBe(115);
    const full = freshBatch('meal', 2); mergeBatch(full, freshBatch('meal', 3));
    expect(full).toEqual(freshBatch('meal', 5));
  });
  it('retains HP and identity on carcass portions without allowing corpse stacks to merge', () => {
    const carcass: Cargo = { resource: 'carcass', amount: 1, carcass: { animalId: 80, species: 'deer' },
      hitPoints: 50, rotProgress: 500 };
    const copy = portion(carcass, 1);
    expect(copy).toEqual(carcass); expect(copy.carcass).not.toBe(carcass.carcass);
    expect(validBatch(copy)).toBe(true); expect(() => mergeBatch(copy, carcass)).toThrow();
    expect(cargoMarketValue(copy)).toBeCloseTo(cargoMarketValue({ ...copy, hitPoints: 100 }) * .1);
  });
  it('prices damaged ordinary items per unit through the existing HP value curve', () => {
    const wood: Cargo = { ...freshBatch('wood', 10), hitPoints: 75 };
    expect(cargoMarketValue(wood)).toBeCloseTo(1.2);
    expect(cargoMarketValue({ ...wood, hitPoints: 90 })).toBeCloseTo(6);
    expect(cargoMarketValue({ ...wood, hitPoints: 135 })).toBeCloseTo(12);
    expect(cargoMarketValue(portion(wood, 1)) * wood.amount).toBeCloseTo(cargoMarketValue(wood));
    expect(cargoMarketValue(JSON.parse(JSON.stringify(wood)))).toBe(cargoMarketValue(wood));
    expect(cargoMarketValue(freshBatch('steel', 10))).toBe(19);
  });
});
