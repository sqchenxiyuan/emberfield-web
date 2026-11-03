import { describe, expect, it } from 'vitest';
import { NUTRITION } from '../src/voxel/farming';
import { carryLimit, stackLimit, stackSpace } from '../src/voxel/logistics';
import { advanceRot, compatibleBatches, freshBatch, mergeBatch, portion, rotLimit, validBatch } from '../src/voxel/preservation';
import { initialTrade, traderAccepts } from '../src/voxel/trade';
import { validateTrade } from '../src/voxel/tradePersistence';
import { DAY, type Cargo, type VoxelSave } from '../src/voxel/types';
import { cargoMarketValue, RESOURCE_MARKET_VALUE } from '../src/voxel/wealth';
import { ANIMAL_DEFS, WILDLIFE } from '../src/voxel/wildlife';

const carcass = (animalId = 42, species: 'hare' | 'deer' = 'hare'): Cargo => ({
  resource: 'carcass', amount: 1, carcass: { animalId, species }, rotProgress: 123,
});

describe('wildlife food transport and preservation', () => {
  it('makes meat edible in ordinary stacks, while carcasses remain single inedible instances', () => {
    expect(validBatch(freshBatch('meat', 75))).toBe(true);
    expect(NUTRITION.meat).toBe(.05);
    expect(NUTRITION.carcass).toBeUndefined();
    expect([stackLimit('meat'), carryLimit('meat'), stackLimit('carcass'), carryLimit('carcass')])
      .toEqual([75, 75, 1, 1]);
    expect(stackSpace(freshBatch('meat', 70), freshBatch('meat', 10))).toBe(5);
    expect(stackSpace(undefined, carcass())).toBe(1);
    expect(stackSpace(carcass(), carcass(43))).toBe(0);
    expect(() => freshBatch('carcass', 1)).toThrow();
  });

  it('retains an independent corpse identity and exact age on transfer, without merging bodies', () => {
    const source = carcass(), moved = portion(source, 1);
    expect(moved).toEqual(source);
    expect(moved.carcass).not.toBe(source.carcass);
    expect(compatibleBatches(source, moved)).toBe(true);
    expect(compatibleBatches(source, carcass(43))).toBe(false);
    expect(compatibleBatches(source, carcass(42, 'deer'))).toBe(false);
    expect(() => mergeBatch(source, moved)).toThrow();
    expect(source.amount).toBe(1);
    moved.carcass!.animalId = 99;
    expect(source.carcass!.animalId).toBe(42);
  });

  it('rejects missing or misplaced identity, invalid body counts and expired meat', () => {
    expect(validBatch(carcass())).toBe(true);
    const invalid: unknown[] = [
      { ...carcass(), amount: 2 }, { ...carcass(), carcass: undefined },
      { ...carcass(), carcass: null }, { ...carcass(), carcass: [] },
      { ...carcass(), carcass: { animalId: 0, species: 'hare' } },
      { ...carcass(), carcass: { animalId: 1.5, species: 'hare' } },
      { ...carcass(), carcass: { animalId: 42, species: 'wolf' } },
      { ...carcass(), rotProgress: undefined },
      { ...carcass(), rotProgress: WILDLIFE.carcassRotDays * DAY },
      { ...freshBatch('meat', 1), carcass: carcass().carcass },
      { ...freshBatch('wood', 1), carcass: carcass().carcass },
      { ...freshBatch('meat', 1), crop: 'rice' },
      { ...freshBatch('meat', 1), rotProgress: WILDLIFE.meatRotDays * DAY },
    ];
    for (const batch of invalid) expect(validBatch(batch), JSON.stringify(batch)).toBe(false);
  });

  it('freezes both foods without rejuvenation and expires them after their remaining warm exposure', () => {
    for (const batch of [freshBatch('meat', 18), carcass()]) {
      const startingAge = batch.rotProgress!, limit = rotLimit(batch)!;
      expect(advanceRot(batch, -8, 10 * DAY)).toBe(false);
      expect(batch.rotProgress).toBe(startingAge);
      expect(advanceRot(batch, 5, DAY)).toBe(false);
      expect(batch.rotProgress).toBe(startingAge + DAY / 2);
      const remaining = limit - batch.rotProgress!;
      expect(advanceRot(batch, 20, remaining - 1)).toBe(false);
      expect(advanceRot(batch, 20, 1)).toBe(true);
    }
  });

  it('merges meat by transferred quantity and preserves its weighted age', () => {
    const target = { ...freshBatch('meat', 20), rotProgress: 100 };
    const source = { ...freshBatch('meat', 50), rotProgress: 700 };
    mergeBatch(target, portion(source, 10));
    expect(target).toEqual({ resource: 'meat', amount: 30, rotProgress: 300 });
    expect(source.amount).toBe(50);
    expect(source.rotProgress).toBe(700);
  });

  it('values animal carcasses by provisional meat yield but excludes them from trade', () => {
    for (const species of ['hare', 'deer'] as const) {
      const body = carcass(42, species);
      expect(cargoMarketValue(body)).toBe(ANIMAL_DEFS[species].meat * RESOURCE_MARKET_VALUE.meat);
      expect(traderAccepts('bulk', body)).toBe(false);
      expect(traderAccepts('combat', body)).toBe(false);
    }
    expect(cargoMarketValue(freshBatch('meat', 18))).toBe(18 * RESOURCE_MARKET_VALUE.meat);
    expect(traderAccepts('bulk', freshBatch('meat', 18))).toBe(true);
    expect(traderAccepts('combat', freshBatch('meat', 18))).toBe(false);
    // Trade owns no carcass transfers, including its serialized material ledger.
    const data = { tick: 0, seed: 73, nextId: 1, homeArea: [], pawns: [], trade: initialTrade(73) } as unknown as VoxelSave;
    const validate = () => validateTrade(data, new Set(), new Set(), new Set());
    expect(validate).not.toThrow();
    data.trade.exported.carcass = 1;
    expect(validate).toThrow();
  });
});
