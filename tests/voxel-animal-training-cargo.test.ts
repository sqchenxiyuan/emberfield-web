import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { newTraderAnimal, animalMarketValue } from '../src/voxel/animalTrade';
import { TRAINING_STEPS } from '../src/voxel/animalTraining';
import { makeApparel } from '../src/voxel/apparel';
import { makeWeapon } from '../src/voxel/weapons';
import { makeFurniturePiece } from '../src/voxel/relocation';
import { defaultProductionPolicy } from '../src/voxel/productionPolicies';
import { unfinishedRecipeWorkTotals } from '../src/voxel/unfinishedProduction';
import { freshBatch, rotLimit, validBatch } from '../src/voxel/preservation';
import { ANIMAL_HUSBANDRY } from '../src/voxel/husbandry';
import { freshFertilizedEggs, EGG_RULES } from '../src/voxel/animalEggs';
import { colonyWealthDetails, cargoMarketValue } from '../src/voxel/wealth';
import { DROP_DISTANCE } from '../src/voxel/logistics';
import { Block, at, index, type Cargo, type Pos, type Resource, type Stack, type VoxelCommand, type VoxelSave } from '../src/voxel/types';

const pos = (x: number, y = 16): Pos => ({ x, y, z: 8 });
const sourceCell = pos(23), targetCell = pos(35);
let baseline: VoxelSave | undefined;
function fixture() {
  if (!baseline) {
    const s = new VoxelSimulation(73129, { biome: 'temperate', hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
    s.animals = []; s.items = []; s.trees = []; s.grass = []; s.stockpiles = []; s.beds = []; s.jobs = [];
    s.crops = []; s.farms = []; s.homeArea.clear();
    s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0); s.explored.fill(1);
    for (let x = 10; x <= 40; x++) for (let y = 10; y <= 24; y++) for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
    s.spawn = pos(12);
    for (const [i, p] of s.pawns.entries()) {
      Object.assign(p, pos(11, 11 + i)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
      p.apparelControl.nextCheckTick = s.tick + 100000;
      for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
    }
    command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
    baseline = s.save();
  }
  const s = VoxelSimulation.load(baseline), a = newTraderAnimal(s.nextId++, 'labrador', 'female', s.tick, pos(14));
  a.faction = 'colony'; a.hunger = 100;
  // Keep ordinary wandering out of this transfer fixture. The actual periodic
  // hauling scheduler, paths, pickup and delivery still advance through step().
  a.decisionTick = s.tick + 10000;
  for (const skill of ['obedience', 'haul'] as const) { a.training.steps[skill] = TRAINING_STEPS[skill]; a.training.learned[skill] = true; }
  s.animals.push(a);
  command(s, { type: 'animalMaster', animalId: a.id, pawnId: s.pawns[0].id });
  return { s, id: a.id };
}
function command(s: VoxelSimulation, c: VoxelCommand) { const r = s.command(c); expect(r.ok, r.message).toBe(true); }
const dog = (s: VoxelSimulation, id: number) => s.animals.find(a => a.id === id)!;
const hauling = (s: VoxelSimulation, id: number, stage: 'fetch' | 'deliver') => { const w = dog(s, id).work; return w?.kind === 'haul' && w.stage === stage; };
function until(s: VoxelSimulation, predicate: () => boolean, limit = 3500) {
  for (let n = 0; n < limit && !predicate(); n++) s.step();
  expect(predicate(), JSON.stringify({ tick: s.tick, animals: s.animals.map(a => ({ id: a.id, phase: a.phase, reason: a.reason, work: a.work, cargo: a.cargo })),
    pawns: s.pawns.map(p => ({ id: p.id, phase: p.phase, reason: p.reason, cargo: p.cargo })) })).toBe(true);
}
function reload(s: VoxelSimulation) {
  const saved = s.save(), loaded = VoxelSimulation.load(saved), after = loaded.save();
  for (const key of ['animals', 'items', 'stats', 'tick', 'nextId', 'stockpiles'] as const) expect(after[key], key).toEqual(saved[key]);
  expect(loaded.counts()).toEqual(s.counts());
  return loaded;
}
function add(s: VoxelSimulation, batch: Cargo, cell = sourceCell): Stack {
  expect(validBatch(batch), 'fixture cargo must satisfy the current save schema').toBe(true);
  const stack = { ...cell, ...structuredClone(batch), id: s.nextId++ }; s.items.push(stack); return stack;
}
function stock(s: VoxelSimulation, resource: Resource, cell = targetCell) { command(s, { type: 'designate', tool: 'stock', from: cell }); command(s, { type: 'storage', from: cell, priority: 3, accepts: [resource] }); }
function batches(s: VoxelSimulation): Cargo[] {
  return [...s.items, ...s.animals.flatMap(a => a.cargo ? [a.cargo] : []), ...s.pawns.flatMap(p => p.cargo ? [p.cargo] : []), ...s.jobs.flatMap(j => j.deliveredBatches)];
}
function identity(batch: Cargo) { return batch.apparel ?? batch.weapon ?? batch.furniture ?? batch.unfinished ?? batch.carcass; }
function matching(s: VoxelSimulation, batch: Cargo) { return batches(s).filter(b => b.resource === batch.resource && JSON.stringify(identity(b)) === JSON.stringify(identity(batch))); }
function ledger(s: VoxelSimulation, resource: Resource) { return s.counts()[resource] + s.stats.consumed[resource] + s.stats.spoiled[resource] + s.stats.destroyed[resource] - s.stats.produced[resource]; }
function storedWealth(s: VoxelSimulation) { const v = colonyWealthDetails(s).itemSources; return v.ground + v.cargo + v.containers + v.delivered; }
function special(s: VoxelSimulation, kind: Resource): Cargo {
  if (kind === 'apparel') return { resource: kind, amount: 1, apparel: { ...makeApparel(s.nextId++, 'tuque', 4, 'alpacaWool'), hitPoints: 57, wearTicks: 17 } };
  if (kind === 'weapon') return { resource: kind, amount: 1, weapon: { ...makeWeapon(s.nextId++, 'steelKnife', 3), hitPoints: 51 } };
  if (kind === 'carcass') return { resource: kind, amount: 1, carcass: { animalId: s.nextId++, species: 'hare', bodySize: ANIMAL_HUSBANDRY.hare.bodySize }, rotProgress: 12, hitPoints: 62 };
  if (kind === 'furniture') return { resource: kind, amount: 1, furniture: makeFurniturePiece('chair', { ...sourceCell, id: s.nextId++, axis: 'y', quality: 4 }, 50.25) };
  if (kind === 'unfinished') return { resource: kind, amount: 1, unfinished: { id: s.nextId++, recipe: 'smith:woodClub', creatorId: s.pawns[0].id,
    creatorName: s.pawns[0].name, boundBillId: null, workTotal: unfinishedRecipeWorkTotals('smith:woodClub')[0], progress: 12, workTicks: 12,
    ingredients: [freshBatch('wood', 40)], policy: defaultProductionPolicy() } };
  throw new Error('Unknown special fixture');
}
function fillAround(s: VoxelSimulation, cell: Pos) {
  const blocked: number[] = [];
  for (let x = cell.x - DROP_DISTANCE; x <= cell.x + DROP_DISTANCE; x++) for (let y = cell.y - DROP_DISTANCE; y <= cell.y + DROP_DISTANCE; y++) {
    const p = pos(x, y);
    if (Math.abs(x - cell.x) + Math.abs(y - cell.y) > DROP_DISTANCE || !s.animalCanStop(p)) continue;
    if (!s.items.some(i => at(i) === at(p))) blocked.push(add(s, freshBatch('steel', 75), p).id);
  }
  return blocked;
}

describe('real animal hauling inventory boundaries', () => {
  it.each(['apparel', 'weapon', 'carcass', 'furniture', 'unfinished'] as const)('preserves one %s identity across fetch/deliver saves, cancellations and resumed delivery', kind => {
    let { s, id } = fixture(); const batch = special(s, kind), source = add(s, batch); stock(s, kind);
    const initialCount = ledger(s, kind), initialWood = ledger(s, 'wood'), initialValue = storedWealth(s);
    until(s, () => hauling(s, id, 'fetch'));
    expect(dog(s, id).cargo).toBeNull(); expect(s.items.find(i => i.id === source.id)).toBeDefined(); s = reload(s);
    command(s, { type: 'animalMaster', animalId: id, pawnId: null });
    expect(dog(s, id).work).toBeNull(); expect(matching(s, batch)).toHaveLength(1); s = reload(s);
    until(s, () => hauling(s, id, 'deliver'));
    expect(identity(dog(s, id).cargo!)).toEqual(identity(batch)); expect(matching(s, batch)).toHaveLength(1);
    expect(storedWealth(s)).toBeCloseTo(initialValue, 9); s = reload(s);
    command(s, { type: 'animalMaster', animalId: id, pawnId: null });
    expect(dog(s, id).work).toBeNull(); expect(identity(dog(s, id).cargo!)).toEqual(identity(batch)); s = reload(s);
    until(s, () => s.items.some(i => at(i) === at(targetCell) && i.resource === kind));
    expect(dog(s, id).cargo).toBeNull(); expect(matching(s, batch)).toHaveLength(1);
    expect(identity(s.items.find(i => at(i) === at(targetCell))!)).toEqual(identity(batch));
    expect(ledger(s, kind)).toBe(initialCount); expect(ledger(s, 'wood')).toBe(initialWood);
    expect(s.stats.hauled).toBe(1);
    expect(storedWealth(s)).toBeCloseTo(initialValue, 9); reload(s);
  }, 15000);

  it('does not pick up a source forbidden after reservation and resumes after it is allowed', () => {
    let { s, id } = fixture(); const source = add(s, freshBatch('wood', 21)); stock(s, 'wood');
    until(s, () => dog(s, id).work?.kind === 'haul');
    command(s, { type: 'itemForbidden', itemId: source.id, forbidden: true });
    until(s, () => dog(s, id).work === null, 20);
    expect(dog(s, id).cargo).toBeNull(); expect(s.items.find(i => i.id === source.id)?.amount).toBe(21); s = reload(s);
    s.step(30); expect(dog(s, id).cargo).toBeNull(); expect(s.counts().wood).toBe(21);
    command(s, { type: 'itemForbidden', itemId: source.id, forbidden: false });
    until(s, () => s.items.some(i => at(i) === at(targetCell) && i.resource === 'wood'));
    expect(s.counts().wood).toBe(21); expect(s.stats.hauled).toBe(21); reload(s);
  });

  it.each(['filter', 'full'] as const)('keeps carried goods when the target becomes %s and later delivers to a new legal stockpile', change => {
    let { s, id } = fixture(); const batch = special(s, 'weapon'); add(s, batch); stock(s, 'weapon');
    until(s, () => !!dog(s, id).cargo);
    if (change === 'filter') command(s, { type: 'storage', from: targetCell, priority: 3, accepts: ['wood'] });
    else add(s, freshBatch('steel', 75), targetCell);
    until(s, () => dog(s, id).work === null, 20);
    expect(identity(dog(s, id).cargo!)).toEqual(identity(batch)); expect(matching(s, batch)).toHaveLength(1); s = reload(s);
    const replacement = pos(35, 19); stock(s, 'weapon', replacement);
    until(s, () => s.items.some(i => at(i) === at(replacement) && i.weapon?.id === batch.weapon!.id));
    expect(matching(s, batch)).toHaveLength(1); expect(dog(s, id).cargo).toBeNull(); reload(s);
  });

  it('retains a cancelled cargo in a fully occupied neighborhood until a real slot is freed', () => {
    let { s, id } = fixture(); const batch = special(s, 'apparel'); add(s, batch); stock(s, 'apparel');
    until(s, () => !!dog(s, id).cargo); const a = dog(s, id), blocked = fillAround(s, a);
    command(s, { type: 'animalMaster', animalId: id, pawnId: null }); s.step(10);
    expect(identity(dog(s, id).cargo!)).toEqual(identity(batch)); expect(matching(s, batch)).toHaveLength(1); s = reload(s);
    s.items = s.items.filter(i => i.id !== blocked[0]); s.step();
    expect(dog(s, id).cargo).toBeNull(); expect(matching(s, batch)).toHaveLength(1); reload(s);
  });

  it('keeps a dead carrier and its item while full, then drops exactly one item and one carcass', () => {
    let { s, id } = fixture(); const batch = special(s, 'weapon'); add(s, batch); stock(s, 'weapon');
    until(s, () => !!dog(s, id).cargo); const blocked = fillAround(s, dog(s, id));
    s.killAnimal(dog(s, id), 'controlled fatal injury'); s.step(10);
    expect(dog(s, id).dead).toBe(true); expect(identity(dog(s, id).cargo!)).toEqual(identity(batch));
    expect(matching(s, batch)).toHaveLength(1); expect(s.stats.produced.carcass).toBe(1); s = reload(s);
    s.items = s.items.filter(i => !blocked.slice(0, 2).includes(i.id));
    until(s, () => !s.animals.some(a => a.id === id), 20);
    expect(matching(s, batch)).toHaveLength(1); expect(s.items.filter(i => i.carcass?.animalId === id)).toHaveLength(1);
    s = reload(s); s.step(10); expect(s.items.filter(i => i.carcass?.animalId === id)).toHaveLength(1);
    expect(s.stats.produced.carcass).toBe(1);
  });

  it('spoils the actual carried food once and removes its inventory, reservation and item wealth', () => {
    let { s, id } = fixture(); add(s, freshBatch('meal', 5)); stock(s, 'meal');
    until(s, () => !!dog(s, id).cargo); const a = dog(s, id), before = ledger(s, 'meal'), wealth = storedWealth(s), worth = cargoMarketValue(a.cargo!);
    expect(s.temperature(a)).toBeGreaterThanOrEqual(10); a.cargo!.rotProgress = rotLimit(a.cargo!)! - 1; s = reload(s); s.step();
    expect(dog(s, id).cargo).toBeNull(); expect(dog(s, id).work).toBeNull(); expect(s.counts().meal).toBe(0);
    expect(s.stats.spoiled.meal).toBe(5); expect(ledger(s, 'meal')).toBe(before);
    expect(storedWealth(s)).toBeCloseTo(wealth - worth, 9); expect(s.storageCapacity().every(c => c.reserved === 0)).toBe(true);
    s = reload(s); s.step(4); expect(s.stats.spoiled.meal).toBe(5);
  });

  it('hatches carried fertilized eggs into distinct nearby chicks without retaining or duplicating egg assets', () => {
    let { s, id } = fixture(); add(s, freshFertilizedEggs(2, 'colony')); stock(s, 'eggFertilized');
    until(s, () => !!dog(s, id).cargo); const a = dog(s, id), initialEggs = ledger(s, 'eggFertilized'), wealth = storedWealth(s), worth = cargoMarketValue(a.cargo!);
    a.cargo!.hatcher!.progress = 1 - .5 / EGG_RULES.hatchTicks; s = reload(s); s.step();
    const chicks = s.animals.filter(a => a.species === 'chicken');
    expect(chicks).toHaveLength(2); expect(new Set(chicks.map(a => a.id)).size).toBe(2);
    expect(chicks.every(a => a.faction === 'colony' && a.growth < .01)).toBe(true);
    expect(dog(s, id).cargo).toBeNull(); expect(dog(s, id).work).toBeNull(); expect(s.counts().eggFertilized).toBe(0);
    expect(s.stats.consumed.eggFertilized).toBe(2); expect(ledger(s, 'eggFertilized')).toBe(initialEggs);
    expect(storedWealth(s)).toBeCloseTo(wealth - worth, 9);
    const values = colonyWealthDetails(s).pawnValues;
    for (const chick of chicks) expect(values.find(p => p.id === chick.id)?.value).toBe(animalMarketValue(chick));
    s = reload(s); s.step(4); expect(s.animals.filter(a => a.species === 'chicken')).toHaveLength(2); expect(s.stats.consumed.eggFertilized).toBe(2);
  });

  it('shares one source reservation with a human without booking or delivering more than its quantity', () => {
    let { s, id } = fixture(); const a = dog(s, id), source = add(s, freshBatch('wood', 35), pos(26));
    stock(s, 'wood', pos(35, 18)); stock(s, 'wood', pos(35, 20));
    add(s, freshBatch('wood', 55), pos(35, 18)); add(s, freshBatch('wood', 55), pos(35, 20));
    // Start one genuine animal reservation before enabling the human, isolating
    // contention from periodic AI lottery timing. Transfers still use step().
    expect(s.animalHaulStart(a)).toBe(true); expect(a.work).toMatchObject({ kind: 'haul', stage: 'fetch', amount: 20 });
    s.pawns[0].priorities.haul = 1;
    until(s, () => [...(s as any).storageReservations.entries()].some(([owner, r]: [number, any]) => owner === s.pawns[0].id && r.sourceId === source.id), 30);
    const reserved = [...(s as any).storageReservations.values()].filter((r: any) => r.sourceId === source.id).reduce((sum: number, r: any) => sum + r.batch.amount, 0);
    expect(reserved).toBe(35); expect(s.animalAvailable(source)).toBe(0); s = reload(s);
    until(s, () => !s.items.some(i => i.id === source.id) && !dog(s, id).cargo && !s.pawns.some(p => p.cargo), 1800);
    expect(s.counts().wood).toBe(145); expect(s.stats.hauled).toBe(35);
    expect(s.items.filter(i => i.resource === 'wood').reduce((sum, i) => sum + i.amount, 0)).toBe(145); reload(s);
  });
});
