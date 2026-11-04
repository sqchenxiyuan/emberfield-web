import { describe, expect, it } from 'vitest';
import {
  APPAREL_DEFS, TAILOR_KINDS, apparelCost, apparelFlammability, apparelStats, makeApparel,
  validApparel, validApparelMaterial,
} from '../src/voxel/apparel';
import { emptyCounts, type ApparelKind, type Cargo, type Job, type UnfinishedPiece, type VoxelSave } from '../src/voxel/types';
import { defaultProductionPolicy, makeProductionBill } from '../src/voxel/productionBills';
import { productionPolicyAllowsIngredient, validProductionPolicy } from '../src/voxel/productionPolicies';
import {
  unfinishedApparelMaterial, unfinishedFlammability, unfinishedMaterialCounts, unfinishedRecipeCost,
  unfinishedRecipeWorkTotals, validateUnfinishedPiece, validateUnfinishedProduction,
} from '../src/voxel/unfinishedProduction';
import { advanceRot, freshBatch, isPerishable, mergeBatch, portion, validBatch } from '../src/voxel/preservation';
import { batchMaxHitPoints, deteriorationRate, setBatchHitPoints } from '../src/voxel/deterioration';
import { apparelMarketValue, cargoMarketValue } from '../src/voxel/wealth';
import { carryLimit, simulateCellInsert, stackLimit } from '../src/voxel/logistics';
import { traderAccepts } from '../src/voxel/trade';
import { defaultShelfSettings, shelfAllows } from '../src/voxel/shelves';

function woolPiece(): UnfinishedPiece {
  return { id: 100, recipe: 'tailoring:shirt', creatorId: 1, creatorName: '裁缝', boundBillId: 'bill:20',
    workTotal: unfinishedRecipeWorkTotals('tailoring:shirt')[0], progress: 12.5, workTicks: 20,
    ingredients: [freshBatch('alpacaWool', 40)], policy: defaultProductionPolicy() };
}
/** Isolated ownership graph: this exercises the UFT validator without invented
 * gameplay progression or a mutated generated-world campaign. */
function woolGraph(): VoxelSave {
  const value = woolPiece(), bill = makeProductionBill('bill:20', value.recipe);
  const job = { id: 30, kind: 'tailoring', apparelKind: 'shirt', x: 16, y: 16, z: 8,
    unfinishedId: value.id, billId: bill.id, productionPolicy: structuredClone(value.policy),
    work: value.workTotal, progress: value.progress, workTicks: value.workTicks, owner: value.creatorId,
    cost: { alpacaWool: 40 }, delivered: {}, deliveredBatches: [], cancelled: false, reason: '加工中' } satisfies Job;
  return { nextId: 1000, tick: 100,
    items: [{ id: 101, x: 16, y: 16, z: 8, resource: 'unfinished', amount: 1, unfinished: value }],
    pawns: [{ id: 1, faction: 'colony', worn: [], weapon: null, cargo: null, jobId: job.id }], jobs: [job],
    stoves: [], butcherSpots: [], stonecutters: [], tailors: [{ id: 10, x: 16, y: 16, z: 8, bills: [] }], weaponBenches: [],
    productionQueues: [{ benchId: 10, bills: [bill] }],
    stats: { produced: emptyCounts(), consumed: emptyCounts(), destroyed: emptyCounts(), spoiled: emptyCounts() },
    trade: { caravans: [], session: null, receipts: [], imported: emptyCounts(), exported: emptyCounts() },
  } as unknown as VoxelSave;
}

describe('alpaca wool physical material and apparel identity', () => {
  it('keeps the historical cloth/steel defaults and charges only the selected textile', () => {
    expect(makeApparel(1, 'shirt').material).toBe('cloth');
    expect(makeApparel(2, 'plateArmor').material).toBe('steel');
    expect(apparelCost('shirt')).toEqual({ cloth: 40 });
    expect(apparelCost('shirt', 'alpacaWool')).toEqual({ alpacaWool: 40 });
    expect(apparelCost('plateArmor')).toEqual({ steel: 170 });
    const cost = apparelCost('shirt', 'alpacaWool'); cost.alpacaWool = 100;
    expect(apparelCost('shirt', 'alpacaWool')).toEqual({ alpacaWool: 40 });
    expect(APPAREL_DEFS.shirt.cost).toEqual({ cloth: 40 });
    expect(() => makeApparel(3, 'simpleHelmet', 2, 'alpacaWool')).toThrow();
    expect(() => apparelCost('shirt', 'steel')).toThrow();
  });

  it.each([
    ['tuque', 15, 0, .22, 80], ['parka', 60, 0, .22, 180], ['duster', 18, 13.6, .33, 200],
    ['shirt', 6.6, 1.6, .22, 100], ['pants', 6, 1.28, .22, 100],
  ] as const)('applies native wool Stuff powers to %s without deriving apparel HP from raw wool HP', (kind, cold, heat, armorHeat, hp) => {
    const wool = makeApparel(1, kind, 2, 'alpacaWool'), stats = apparelStats(wool);
    expect(stats.cold).toBeCloseTo(cold);
    expect(stats.heat).toBeCloseTo(heat);
    expect(stats.armorHeat).toBeCloseTo(armorHeat);
    expect(stats.armorSharp).toBe(apparelStats(makeApparel(2, kind)).armorSharp);
    expect(stats.armorBlunt).toBe(0);
    expect(stats.maxHitPoints).toBe(hp); expect(wool.hitPoints).toBe(hp);
    expect(validApparel(wool)).toBe(true);
  });

  it('applies quality after material while preserving the old optional-material stats API', () => {
    expect(apparelStats({ kind: 'parka', quality: 2 })).toEqual(apparelStats(makeApparel(1, 'parka')));
    const good = apparelStats(makeApparel(2, 'parka', 3, 'alpacaWool'));
    expect(good.cold).toBeCloseTo(66); expect(good.armorHeat).toBeCloseTo(.253);
    expect(good.maxHitPoints).toBe(180);
    const damaged = makeApparel(3, 'parka', 3, 'alpacaWool'); damaged.hitPoints = 1;
    expect(apparelStats(damaged)).toEqual(good);
  });

  it('rejects incompatible or missing persisted materials and validates condition against the garment', () => {
    for (const kind of TAILOR_KINDS) {
      expect(validApparelMaterial(kind, 'alpacaWool')).toBe(true);
      expect(validApparelMaterial(kind, 'steel')).toBe(false);
    }
    expect(validApparelMaterial('simpleHelmet', 'alpacaWool')).toBe(false);
    expect(validApparelMaterial('plateArmor', 'cloth')).toBe(false);
    expect(validApparelMaterial('unknown' as ApparelKind, 'cloth')).toBe(false);
    const wool = makeApparel(7, 'shirt', 2, 'alpacaWool');
    for (const patch of [{ material: undefined }, { material: 'steel' }, { material: 'cotton' },
      { hitPoints: 101 }, { hitPoints: 0 }, { hitPoints: .5 }, { extra: true }])
      expect(validApparel({ ...wool, ...patch })).toBe(false);
    const cargo: Cargo = { resource: 'apparel', amount: 1, apparel: wool };
    const copied = portion(cargo, 1); copied.apparel!.hitPoints = 10;
    expect(copied.apparel!.material).toBe('alpacaWool');
    expect(cargo.apparel!.hitPoints).toBe(100); expect(validBatch(copied)).toBe(true);
  });

  it('preserves wool physical condition, native 100-unit stacks and a 75-unit carrier limit', () => {
    const wool = freshBatch('alpacaWool', 80);
    expect(wool).toEqual({ resource: 'alpacaWool', amount: 80 });
    expect(validBatch(wool)).toBe(true); expect(isPerishable('alpacaWool')).toBe(false);
    expect(advanceRot(wool, 50, 1_000_000)).toBe(false);
    expect(validBatch({ ...wool, rotProgress: 0 })).toBe(false);
    expect(batchMaxHitPoints(wool)).toBe(90);
    expect(deteriorationRate(wool, { exposed: true, outdoors: true, rainRate: 0 })).toBe(3.4);
    expect(deteriorationRate(wool, { exposed: true, outdoors: true, rainRate: 1 })).toBe(17);
    expect(stackLimit('alpacaWool')).toBe(100); expect(carryLimit('alpacaWool')).toBe(75);
    const incoming = freshBatch('alpacaWool', 30); setBatchHitPoints(incoming, 45);
    const preview = simulateCellInsert([wool], incoming, 1);
    expect(preview.accepted).toBe(20); expect(preview.additions).toEqual([]);
    expect(preview.stacks[0]).toEqual({ resource: 'alpacaWool', amount: 100, hitPoints: 81 });
    expect(wool.amount).toBe(80); expect(incoming.amount).toBe(30);
    expect(() => mergeBatch(wool, freshBatch('cloth', 20))).toThrow();
    expect(shelfAllows(wool)).toBe(true); expect(defaultShelfSettings().accepts).toContain('alpacaWool');
  });

  it('values raw wool independently of surviving HP and completed apparel from its actual input material', () => {
    const wool = freshBatch('alpacaWool', 40);
    expect(cargoMarketValue(wool)).toBe(152);
    setBatchHitPoints(wool, 1); expect(cargoMarketValue(wool)).toBe(152);
    const clothShirt = makeApparel(1, 'shirt'), woolShirt = makeApparel(2, 'shirt', 2, 'alpacaWool');
    expect(apparelMarketValue(woolShirt)).toBeCloseTo(157.76);
    expect(apparelMarketValue(woolShirt) - apparelMarketValue(clothShirt)).toBeCloseTo(92);
    woolShirt.hitPoints = 50; expect(apparelMarketValue(woolShirt)).toBeCloseTo(15.776);
    expect(traderAccepts('bulk', wool)).toBe(true); expect(traderAccepts('combat', wool)).toBe(false);
  });

  it('permits independent textile filters including an empty set while fixed armor slots remain separate', () => {
    const policy = defaultProductionPolicy(); expect(policy.allowedTextiles).toEqual(['cloth', 'alpacaWool']);
    expect(validProductionPolicy(policy)).toBe(true);
    policy.allowedTextiles = ['alpacaWool'];
    expect(productionPolicyAllowsIngredient(policy, 'tailoring:shirt', { resource: 'alpacaWool' })).toBe(true);
    expect(productionPolicyAllowsIngredient(policy, 'tailoring:shirt', { resource: 'cloth' })).toBe(false);
    expect(productionPolicyAllowsIngredient(policy, 'tailoring:shirt', { resource: 'steel' })).toBe(false);
    policy.allowedTextiles = [];
    expect(validProductionPolicy(policy)).toBe(true);
    expect(productionPolicyAllowsIngredient(policy, 'tailoring:shirt', { resource: 'alpacaWool' })).toBe(false);
    expect(productionPolicyAllowsIngredient(policy, 'armorsmith:plateArmor', { resource: 'steel' })).toBe(true);
    expect(defaultProductionPolicy().allowedTextiles).toEqual(['cloth', 'alpacaWool']);
    for (const allowedTextiles of [undefined, null, ['steel'], ['cloth', 'cloth'], new Array(1)])
      expect(validProductionPolicy({ ...policy, allowedTextiles })).toBe(false);
  });

  it('locks UFT material from actual enclosed input batches and rejects mixed, extra or incomplete textiles', () => {
    const value = woolPiece();
    expect(unfinishedRecipeCost(value.recipe, 'alpacaWool')).toEqual({ alpacaWool: 40 });
    expect(unfinishedRecipeCost(value.recipe)).toEqual({ cloth: 40 });
    expect(unfinishedApparelMaterial(value)).toBe('alpacaWool');
    expect(validateUnfinishedPiece(value)).toBe(true);
    value.ingredients = [{ resource: 'alpacaWool', amount: 15, hitPoints: 20 }, freshBatch('alpacaWool', 25)];
    expect(validateUnfinishedPiece(value)).toBe(true);
    expect(unfinishedMaterialCounts(value).alpacaWool).toBe(40);
    expect(unfinishedMaterialCounts(value).cloth).toBe(0);
    for (const ingredients of [[freshBatch('alpacaWool', 39)], [freshBatch('alpacaWool', 41)],
      [freshBatch('cloth', 20), freshBatch('alpacaWool', 20)], [freshBatch('alpacaWool', 40), freshBatch('wood', 1)],
      [{ resource: 'alpacaWool', amount: 40, rotProgress: 0 }]])
      expect(validateUnfinishedPiece({ ...value, ingredients })).toBe(false);
    expect(validateUnfinishedPiece({ ...value, policy: { ...value.policy, allowedTextiles: ['cloth'] } })).toBe(false);
    expect(unfinishedApparelMaterial({ ...value, ingredients: [freshBatch('cloth', 20), freshBatch('alpacaWool', 20)] })).toBeNull();
  });

  it('retains nested wool and filters through physical transfer without duplicating input material', () => {
    const original: Cargo = { resource: 'unfinished', amount: 1, unfinished: woolPiece() };
    const copied = portion(original, 1);
    expect(validBatch(copied)).toBe(true);
    copied.unfinished!.ingredients[0].amount = 1;
    copied.unfinished!.policy.allowedTextiles.length = 0;
    expect(original.unfinished!.ingredients[0]).toEqual(freshBatch('alpacaWool', 40));
    expect(original.unfinished!.policy.allowedTextiles).toEqual(['cloth', 'alpacaWool']);
    expect(unfinishedMaterialCounts(original.unfinished!).unfinished).toBe(0);
    expect(() => portion(original, 2)).toThrow();
  });

  it('reconciles active UFT jobs against the real wool cost and frozen textile policy', () => {
    expect(() => validateUnfinishedProduction(woolGraph())).not.toThrow();
    const wrongCost = woolGraph(); wrongCost.jobs[0].cost = { cloth: 40 };
    expect(() => validateUnfinishedProduction(wrongCost)).toThrow('作业原配方成本不一致');
    const mixed = woolGraph(); mixed.items[0].unfinished!.ingredients = [freshBatch('cloth', 20), freshBatch('alpacaWool', 20)];
    expect(() => validateUnfinishedProduction(mixed)).toThrow();
    const changedPolicy = woolGraph(); changedPolicy.jobs[0].productionPolicy!.allowedTextiles = ['cloth'];
    expect(() => validateUnfinishedProduction(changedPolicy)).toThrow('作业引用、作者或进度副本不一致');
  });

  it('distinguishes finished garment Stuff flammability from the native nonflammable apparel UFT', () => {
    expect(apparelFlammability(makeApparel(1, 'shirt'))).toBe(1.2);
    expect(apparelFlammability(makeApparel(2, 'shirt', 2, 'alpacaWool'))).toBe(1.7);
    expect(unfinishedFlammability(woolPiece())).toBe(0);
    expect(unfinishedFlammability({ ...woolPiece(), ingredients: [freshBatch('cloth', 40)] })).toBe(0);
    expect(unfinishedFlammability({ recipe: 'smith:woodClub', ingredients: [freshBatch('wood', 40)] })).toBe(1);
  });
});
