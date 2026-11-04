import { describe, expect, it } from 'vitest';
import { emptyCounts, type Cargo, type Job, type UnfinishedPiece, type VoxelSave } from '../src/voxel/types';
import { defaultProductionPolicy, makeProductionBill, type ProductionRecipe } from '../src/voxel/productionBills';
import { recipeUsesUnfinished, unfinishedFlammability, unfinishedMaterialCounts, unfinishedRecipeCost,
  unfinishedRecipeWorkTotals, validateUnfinishedPiece, validateUnfinishedProduction } from '../src/voxel/unfinishedProduction';
import { compatibleBatches, freshBatch, mergeBatch, portion, validBatch } from '../src/voxel/preservation';
import { carryLimit, planCellInsertion, stackLimit } from '../src/voxel/logistics';
import { batchHitPoints, batchMaxHitPoints, deteriorationRate } from '../src/voxel/deterioration';
import { cargoMarketValue } from '../src/voxel/wealth';
import { traderAccepts } from '../src/voxel/trade';
import { defaultShelfSettings, shelfAllows } from '../src/voxel/shelves';

const recipes: ProductionRecipe[] = [
  'tailoring:tuque', 'tailoring:parka', 'tailoring:duster', 'tailoring:shirt', 'tailoring:pants',
  'smith:woodClub', 'smith:steelKnife', 'smith:steelLongsword', 'smith:shortBow', 'smith:revolver', 'smith:machinePistol',
  'armorsmith:simpleHelmet', 'armorsmith:plateArmor',
];
function piece(recipe: ProductionRecipe = 'smith:woodClub'): UnfinishedPiece {
  return { id: 100, recipe, creatorId: 1, creatorName: '工人甲', boundBillId: 'bill:20',
    workTotal: unfinishedRecipeWorkTotals(recipe)[0], progress: 12.5, workTicks: 20,
    ingredients: Object.entries(unfinishedRecipeCost(recipe)!).map(([resource, amount]) => freshBatch(resource as Cargo['resource'], amount)),
    policy: defaultProductionPolicy() };
}
const cargo = (value = piece()): Cargo => ({ resource: 'unfinished', amount: 1, unfinished: value });
/** Pure ownership graph, deliberately without a simulation or terrain. Existing
 * geometry/pawn validators run before validateUnfinishedProduction in world.load. */
function state() {
  const value = piece(), bill = makeProductionBill('bill:20', value.recipe);
  const job = { id: 30, kind: 'smith', weaponKind: 'woodClub', weaponBenchKind: 'craftingSpot',
    x: 16, y: 16, z: 8, unfinishedId: value.id, billId: bill.id, productionPolicy: structuredClone(value.policy),
    work: value.workTotal, progress: value.progress, workTicks: value.workTicks, owner: value.creatorId,
    cost: { wood: 40 }, delivered: {}, deliveredBatches: [], cancelled: false, reason: '加工中' } satisfies Job;
  return { nextId: 1000, tick: 100,
    items: [{ id: 101, x: 16, y: 16, z: 8, ...cargo(value) }],
    pawns: [{ id: 1, faction: 'colony', worn: [], weapon: null, cargo: null, jobId: job.id }], jobs: [job],
    stoves: [], butcherSpots: [], stonecutters: [], tailors: [],
    weaponBenches: [{ id: 10, x: 16, y: 16, z: 8, kind: 'craftingSpot', bills: [], armorBills: [] }],
    productionQueues: [{ benchId: 10, bills: [bill] }],
    stats: { produced: emptyCounts(), consumed: emptyCounts(), destroyed: emptyCounts(), spoiled: emptyCounts() },
    trade: { caravans: [], session: null, receipts: [], imported: emptyCounts(), exported: emptyCounts() },
  } as unknown as VoxelSave;
}

describe('unfinished production physical model', () => {
  it.each(recipes)('retains the exact complete inputs and a valid work total for %s', recipe => {
    const value = piece(recipe);
    expect(recipeUsesUnfinished(recipe)).toBe(true);
    expect(validateUnfinishedPiece(value)).toBe(true);
    expect(validBatch(cargo(value))).toBe(true);
    for (const [resource, amount] of Object.entries(unfinishedRecipeCost(recipe)!))
      expect(unfinishedMaterialCounts(value)[resource as keyof ReturnType<typeof emptyCounts>]).toBe(amount);
    expect(unfinishedMaterialCounts(value).unfinished).toBe(0);
    for (const workTotal of unfinishedRecipeWorkTotals(recipe))
      expect(validateUnfinishedPiece({ ...value, workTotal })).toBe(true);
  });

  it('rejects non-UFT and category-mismatched recipes without fabricating costs', () => {
    for (const recipe of ['cook', 'butcher', 'stonecut', 'tailoring:simpleHelmet', 'armorsmith:shirt', 'smith:unknown', null]) {
      expect(recipeUsesUnfinished(recipe)).toBe(false);
      expect(unfinishedRecipeCost(recipe as ProductionRecipe)).toBeNull();
      expect(unfinishedRecipeWorkTotals(recipe as ProductionRecipe)).toEqual([]);
    }
    const cost = unfinishedRecipeCost('smith:woodClub')!; cost.wood = 999;
    expect(unfinishedRecipeCost('smith:woodClub')!.wood).toBe(40);
  });

  it('preserves independent material conditions and refuses missing, extra or nested inputs', () => {
    const value = piece();
    value.ingredients = [{ resource: 'wood', amount: 10, hitPoints: 80 }, { resource: 'wood', amount: 30 }];
    expect(validateUnfinishedPiece(value)).toBe(true);
    for (const ingredients of [[], [{ resource: 'wood', amount: 39 }], [{ resource: 'wood', amount: 41 }],
      [{ resource: 'cloth', amount: 40 }], [...value.ingredients, { resource: 'steel', amount: 1 }],
      [{ resource: 'wood', amount: 40, unfinished: piece() }], [cargo()],
      [{ resource: 'wood', amount: 40, id: 25 }], [{ resource: 'wood', amount: 40, hitPoints: 0 }]])
      expect(validateUnfinishedPiece({ ...value, ingredients })).toBe(false);
  });

  it('deep-copies whole physical pieces and never merges or splits them', () => {
    const original = cargo(), copy = portion(original, 1);
    expect(copy).toEqual(original);
    copy.unfinished!.ingredients[0].amount = 1;
    copy.unfinished!.policy.allowedFood.length = 0;
    copy.unfinished!.creatorName = '改名';
    expect(original.unfinished!.ingredients[0].amount).toBe(40);
    expect(original.unfinished!.policy.allowedFood).toEqual(['grain', 'meat']);
    expect(original.unfinished!.creatorName).toBe('工人甲');
    expect(() => portion(original, 0)).toThrow(); expect(() => portion(original, 2)).toThrow();
    expect(() => freshBatch('unfinished', 1)).toThrow();
    expect(() => mergeBatch(original, portion(original, 1))).toThrow();
    expect(compatibleBatches(original, cargo({ ...piece(), id: 102 }))).toBe(false);
    expect(stackLimit('unfinished')).toBe(1); expect(carryLimit('unfinished')).toBe(1);
    expect(planCellInsertion([original], original, 1).accepted).toBe(0);
    expect(planCellInsertion([], original, 3)).toMatchObject({ accepted: 1, merges: [], additions: [1] });
    expect(shelfAllows(original)).toBe(true);
    expect(defaultShelfSettings().accepts).toContain('unfinished');
  });

  it('validates wrapper shape, forbidden state, work and the locked final quality', () => {
    expect(validBatch({ ...cargo(), forbidden: true })).toBe(true);
    expect(validBatch({ ...cargo(), forbidden: 'yes' })).toBe(false);
    expect(validBatch({ ...cargo(), amount: 2 })).toBe(false);
    expect(validBatch({ ...cargo(), rotProgress: 0 })).toBe(false);
    expect(validBatch({ resource: 'wood', amount: 40, unfinished: piece() })).toBe(false);
    for (const patch of [{ creatorName: '' }, { creatorId: 0 }, { creatorId: 100 }, { boundBillId: 'missing' },
      { workTotal: 1 }, { progress: Infinity }, { progress: -1 }, { workTicks: .5 }, { extra: 1 },
      { policy: { ...defaultProductionPolicy(), allowedFood: ['grain', 'grain'] } }, { productQuality: undefined }])
      expect(validateUnfinishedPiece({ ...piece(), ...patch })).toBe(false);
    const qualityPiece = piece('smith:shortBow'); qualityPiece.progress = qualityPiece.workTotal;
    qualityPiece.productQuality = { value: 3, skill: 10, workerId: qualityPiece.creatorId };
    expect(validateUnfinishedPiece(qualityPiece)).toBe(true);
    expect(validateUnfinishedPiece({ ...qualityPiece, progress: qualityPiece.workTotal - 1 })).toBe(false);
    expect(validateUnfinishedPiece({ ...qualityPiece, productQuality: { ...qualityPiece.productQuality, workerId: 0 } })).toBe(false);
    // v40 could lock an outcome before output placement; a different worker may
    // adopt that legacy job without changing who rolled its finished quality.
    expect(validateUnfinishedPiece({ ...qualityPiece, creatorId: 2 })).toBe(true);
    const club = piece(); club.progress = club.workTotal; club.productQuality = qualityPiece.productQuality;
    expect(validateUnfinishedPiece(club)).toBe(false);
  });

  it('exposes explicit condition/fire rules while keeping UFTs valueless and untradeable', () => {
    const value = cargo();
    expect(batchMaxHitPoints(value)).toBe(50); expect(batchHitPoints(value)).toBe(50);
    expect(deteriorationRate(value, { exposed: true, outdoors: true, rainRate: 0 })).toBe(2);
    expect(deteriorationRate(value, { exposed: true, outdoors: true, rainRate: 1, protected: true })).toBe(0);
    expect(unfinishedFlammability(piece())).toBe(1);
    expect(unfinishedFlammability(piece('smith:steelKnife'))).toBe(0);
    expect(unfinishedFlammability(piece('smith:revolver'))).toBe(.5);
    expect(cargoMarketValue(value)).toBe(0);
    expect(traderAccepts('bulk', value)).toBe(false); expect(traderAccepts('combat', value)).toBe(false);
  });
});

describe('unfinished production identity and ownership validation', () => {
  it('accepts a single ground object and a job reference without duplicate material ownership', () => {
    expect(() => validateUnfinishedProduction(state())).not.toThrow();
    const d = state(); d.jobs = []; d.items[0].unfinished!.boundBillId = null;
    d.pawns = []; // Historical creator identity/name deliberately outlive the author.
    expect(() => validateUnfinishedProduction(d)).not.toThrow();
  });

  it('moves the same identity to a carrier and permits unclaimed ordinary hauling', () => {
    const d = state(); d.pawns[0].cargo = portion(d.items[0], 1); d.items = [];
    expect(() => validateUnfinishedProduction(d)).not.toThrow();
    d.jobs = []; d.pawns[0].jobId = null; d.pawns[0].cargo!.unfinished!.boundBillId = null;
    expect(() => validateUnfinishedProduction(d)).not.toThrow();
  });

  it('allows an idle referenced UFT to be carried by a hauler or its author after load clears ownership', () => {
    for (const carrierId of [1, 2]) {
      const d = state(); d.pawns[0].cargo = portion(d.items[0], 1); d.items = [];
      d.pawns[0].id = carrierId; d.pawns[0].jobId = null; d.jobs[0].owner = null;
      expect(() => validateUnfinishedProduction(d)).not.toThrow();
    }
  });

  it('rejects copies and collisions with ground, equipment, furniture, bill or task identities', () => {
    for (const conflict of ['duplicate', 'ground', 'bill', 'job', 'equipment', 'furniture'] as const) {
      const d = state();
      if (conflict === 'duplicate') d.pawns[0].cargo = portion(d.items[0], 1);
      if (conflict === 'ground') d.items[0].id = d.items[0].unfinished!.id;
      if (conflict === 'bill') d.items[0].unfinished!.id = 20;
      if (conflict === 'job') d.items[0].unfinished!.id = 30;
      if (conflict === 'equipment') d.pawns[0].weapon = { id: 100, kind: 'woodClub', quality: 2, hitPoints: 100 };
      if (conflict === 'furniture') d.items.push({ id: 102, x: 15, y: 16, z: 8,
        resource: 'furniture', amount: 1, furniture: { id: 100 } as Cargo['furniture'] });
      expect(() => validateUnfinishedProduction(d), conflict).toThrow();
    }
  });

  it('allows only one bound unfinished object per bill while keeping independent unbound objects', () => {
    const d = state();
    d.items.push({ id: 103, x: 15, y: 16, z: 8, ...cargo({ ...piece(), id: 102 }) });
    expect(() => validateUnfinishedProduction(d)).toThrow('同一账单绑定了多个未完成品');
    d.items[1].unfinished!.boundBillId = null;
    expect(() => validateUnfinishedProduction(d)).not.toThrow();
  });

  it('rejects dangling, duplicate and mismatched task references or material copies', () => {
    const changes: Array<(d: VoxelSave) => void> = [
      d => { d.jobs[0].unfinishedId = 999; },
      d => { d.jobs.push({ ...d.jobs[0], id: 31 }); },
      d => { d.jobs[0].delivered = { wood: 40 }; },
      d => { d.jobs[0].deliveredBatches = [portion(d.items[0], 1)]; },
      d => { d.jobs[0].work++; }, d => { d.jobs[0].progress++; }, d => { d.jobs[0].workTicks++; },
      d => { d.jobs[0].owner = 2; }, d => { d.jobs[0].cost.wood = 39; },
      d => { d.jobs[0].productionPolicy!.ingredientRadius = 3; },
      d => { d.items[0].unfinished!.boundBillId = null; },
      d => { d.jobs[0].cancelled = true; },
      d => { d.pawns[0].cargo = portion(d.items[0], 1); d.items = []; d.pawns[0].jobId = null; },
    ];
    for (const change of changes) { const d = state(); change(d); expect(() => validateUnfinishedProduction(d)).toThrow(); }
  });

  it('rejects missing bindings, future identities/timing and unsupported ledger transfers', () => {
    const changes: Array<(d: VoxelSave) => void> = [
      d => { d.items[0].unfinished!.boundBillId = 'bill:999'; },
      d => { d.items[0].unfinished!.id = d.nextId; },
      d => { d.items[0].unfinished!.creatorId = d.nextId; },
      d => { d.items[0].unfinished!.policy.workerId = d.nextId; },
      d => { d.items[0].unfinished!.workTicks = d.tick + 1; },
      d => { d.stats.produced.unfinished = -1; }, d => { d.stats.spoiled.unfinished = 1; },
      d => { d.trade.imported.unfinished = 1; }, d => { d.trade.exported.unfinished = 1; },
    ];
    for (const change of changes) { const d = state(); change(d); expect(() => validateUnfinishedProduction(d)).toThrow(); }
  });
});
