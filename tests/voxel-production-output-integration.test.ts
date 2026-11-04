import { stripAutoSlaughterFields } from './legacy-auto-rebuild-defaults';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Pawn, type Pos, type Resource, type VoxelCommand } from '../src/voxel/types';
import { freshBatch } from '../src/voxel/preservation';
import { defaultShelfSettings } from '../src/voxel/shelves';
import { productionOutputDestinations, type ProductionOutput, type ProductionOutputTarget } from '../src/voxel/productionOutput';
import { type ProductionRecipe } from '../src/voxel/productionBills';

const pos = (x: number, y = 16): Pos => ({ x, y, z: 8 });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c); expect(r.ok, JSON.stringify({ c, r })).toBe(true); return r;
}
/** Controlled geometry and inventory; crafting, scheduling, destination choice,
 * movement and completion all use normal commands and simulation ticks. */
function fixture(kind: 'craftingSpot' | 'butcherSpot' = 'craftingSpot', shelves = 0) {
  let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.trees = []; s.items = []; s.stockpiles = []; s.jobs = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 29; x++) for (let y = 10; y <= 24; y++)
    for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
    for (const work of Object.keys(p.priorities)) p.priorities[work as keyof Pawn['priorities']] = 0;
    p.skills.crafting.level = 10; p.skills.cooking.level = 10;
  });
  for (let i = 0; i < shelves; i++) s.shelves.push({ id: s.nextId++, ...pos(24 + i * 3, 20),
    kind: 'smallShelf', axis: 'x', settings: defaultShelfSettings() });
  s = VoxelSimulation.load(s.save());
  command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
  command(s, { type: 'designate', tool: kind, from: pos(16) });
  const benchId = (kind === 'craftingSpot' ? s.weaponBenches[0] : s.butcherSpots[0]).id;
  for (const b of s.snapshot().productionQueues.find(q => q.benchId === benchId)!.bills)
    command(s, { type: 'productionBillDelete', benchId, billId: b.id });
  return { s, benchId };
}
function item(s: VoxelSimulation, resource: Resource, amount: number, p = pos(12)) {
  const i = { id: s.nextId++, ...p, ...freshBatch(resource, amount) }; s.items.push(i); return i;
}
function add(s: VoxelSimulation, benchId: number, output?: ProductionOutput, recipe: ProductionRecipe = 'smith:woodClub') {
  command(s, { type: 'productionBillAdd', benchId, recipe });
  const b = s.productionQueues.find(q => q.benchId === benchId)!.bills.at(-1)!;
  if (output) command(s, { type: 'productionBillUpdate', benchId, billId: b.id, patch: { output } });
  return b.id;
}
const bill = (s: VoxelSimulation, id: string) => s.productionQueues.flatMap(q => q.bills).find(b => b.id === id)!;
const outputAt = (s: VoxelSimulation, p: Pos, resource: Resource = 'weapon') => s.items
  .filter(i => at(i) === at(p) && i.resource === resource).reduce((sum, i) => sum + i.amount, 0);
function zone(s: VoxelSimulation, p = pos(27, 20), priority = 1, accepts: Resource[] = ['weapon']): ProductionOutputTarget {
  command(s, { type: 'designate', tool: 'stock', from: p });
  command(s, { type: 'storage', from: p, priority, accepts });
  return { kind: 'stockpile', id: s.stockpileZones.find(z => z.cells.includes(at(p)))!.id };
}
function until(s: VoxelSimulation, predicate: () => boolean, max = 4000) {
  for (let n = 0; n < max && !predicate(); n++) s.step();
  expect(predicate(), JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns.map(p => ({ reason: p.reason, cargo: p.cargo, delivery: p.productionDelivery })) })).toBe(true);
}
function start(s: VoxelSimulation) {
  item(s, 'wood', 40); command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'craft', value: 1 });
}
function complete(s: VoxelSimulation, id: string) {
  until(s, () => s.stats.weaponsMade === 1);
  expect(bill(s, id).remaining).toBe(0); expect(s.stats.consumed.wood).toBe(40);
  expect(s.counts().weapon).toBe(1); expect(s.stats.produced.weapon).toBe(1);
}

describe('production output destinations', () => {
  it('defaults new bills to Best and lets a producer with haul disabled physically deliver', () => {
    const { s, benchId } = fixture(); zone(s); const id = add(s, benchId); start(s);
    expect(bill(s, id).output).toEqual({ mode: 'best', target: null });
    complete(s, id);
    expect(s.pawns[0].priorities.haul).toBe(0);
    expect(s.pawns[0].productionDelivery).toMatchObject({ mode: 'best', billId: id });
    expect(outputAt(s, pos(27, 20))).toBe(0); expect(s.pawns[0].cargo?.resource).toBe('weapon');
    until(s, () => outputAt(s, pos(27, 20)) === 1);
    expect(s.pawns[0].productionDelivery).toBeUndefined(); expect(s.stats.weaponsMade).toBe(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('Drop leaves the new product nearby and does not autonomously haul it', () => {
    const { s, benchId } = fixture(); zone(s); const id = add(s, benchId, { mode: 'drop', target: null }); start(s);
    complete(s, id); s.step(100);
    expect(outputAt(s, pos(27, 20))).toBe(0); expect(s.pawns.every(p => !p.productionDelivery)).toBe(true);
    expect(s.items.filter(i => i.resource === 'weapon')).toHaveLength(1);
  });
  it('Specific honors a low priority zone even when a higher priority zone is available', () => {
    const { s, benchId } = fixture(); const target = zone(s, pos(27, 20), 0); zone(s, pos(23, 13), 3);
    const id = add(s, benchId, { mode: 'specific', target }); start(s); complete(s, id);
    expect(s.pawns[0].productionDelivery?.target).toEqual(target);
    until(s, () => outputAt(s, pos(27, 20)) === 1); expect(outputAt(s, pos(23, 13))).toBe(0);
  });
  it.each(['full', 'filter', 'unreachable'] as const)('Specific %s falls back nearby, never to another available store', failure => {
    let { s, benchId } = fixture(); const target = zone(s); zone(s, pos(23, 13), 3);
    if (failure === 'full') item(s, 'steel', 75, pos(27, 20));
    if (failure === 'filter') command(s, { type: 'storage', from: pos(27, 20), priority: 1, accepts: ['steel'] });
    if (failure === 'unreachable') {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) for (const z of [8, 9])
        s.blocks[index(27 + dx, 20 + dy, z)] = Block.Stone;
      s = VoxelSimulation.load(s.save());
    }
    const id = add(s, benchId, { mode: 'specific', target }); start(s); complete(s, id);
    expect(s.pawns[0].productionDelivery).toBeUndefined(); expect(outputAt(s, pos(23, 13))).toBe(0);
    expect(outputAt(s, pos(27, 20))).toBe(0); expect(s.items.filter(i => i.resource === 'weapon')).toHaveLength(1);
    expect(bill(s, id).output.target).toEqual(target);
  });
  it.each(['shelf', 'group'] as const)('delivers to a %s and de-duplicates linked members in the picker', kind => {
    const { s, benchId } = fixture('craftingSpot', 2), [a, b] = s.shelves;
    command(s, { type: 'shelfStorage', shelfId: a.id, priority: 0, accepts: ['weapon'] });
    let target: ProductionOutputTarget = { kind: 'shelf', id: a.id };
    if (kind === 'group') {
      command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id] });
      target = { kind: 'group', id: s.storageGroups[0].id };
      expect(productionOutputDestinations(s).map(d => d.target)).toEqual([target]);
    }
    zone(s, pos(20, 13), 3); const id = add(s, benchId, { mode: 'specific', target }); start(s); complete(s, id);
    until(s, () => outputAt(s, a) + (kind === 'group' ? outputAt(s, b) : 0) === 1);
    expect(outputAt(s, pos(20, 13))).toBe(0); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('reload preserves cargo and one completed iteration even if the original bill is edited or deleted', () => {
    let { s, benchId } = fixture(); const target = zone(s); const id = add(s, benchId, { mode: 'specific', target }); start(s); complete(s, id);
    const cargo = structuredClone(s.pawns[0].cargo), delivery = structuredClone(s.pawns[0].productionDelivery);
    command(s, { type: 'productionBillUpdate', benchId, billId: id, patch: { output: { mode: 'drop', target: null } } });
    command(s, { type: 'productionBillDelete', benchId, billId: id });
    s = VoxelSimulation.load(s.save());
    expect(s.pawns[0].cargo).toEqual(cargo); expect(s.pawns[0].productionDelivery).toEqual(delivery);
    until(s, () => outputAt(s, pos(27, 20)) === 1); expect(s.stats.weaponsMade).toBe(1); expect(s.stats.consumed.wood).toBe(40);
  });
  it('a registered group with all shelves packed retains its bill target but cannot accept output', () => {
    let { s, benchId } = fixture('craftingSpot', 2); const [a, b] = s.shelves;
    command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id] });
    const target: ProductionOutputTarget = { kind: 'group', id: s.storageGroups[0].id };
    const id = add(s, benchId, { mode: 'specific', target });
    command(s, { type: 'priority', pawnId: s.pawns[1].id, work: 'build', value: 1 });
    for (const shelf of [a, b]) {
      command(s, { type: 'uninstallFurniture', kind: shelf.kind, furnitureId: shelf.id });
      until(s, () => !s.shelves.some(v => v.id === shelf.id));
    }
    s = VoxelSimulation.load(s.save());
    expect(bill(s, id).output).toEqual({ mode: 'specific', target });
    expect(productionOutputDestinations(s).find(d => d.target.kind === 'group')?.cells).toEqual([]);
    start(s); complete(s, id);
    expect(s.pawns[0].productionDelivery).toBeUndefined(); expect(s.counts().weapon).toBe(1);
    expect(bill(s, id).output.target).toEqual(target);
  });
  it.each(['filter', 'delete'] as const)('target %s during delivery drops the cargo without repeating production', change => {
    const { s, benchId } = fixture(); const target = zone(s); const id = add(s, benchId, { mode: 'specific', target }); start(s); complete(s, id);
    if (change === 'filter') command(s, { type: 'storage', from: pos(27, 20), priority: 1, accepts: ['steel'] });
    else command(s, { type: 'designate', tool: 'clearZone', from: pos(27, 20) });
    until(s, () => !s.pawns[0].productionDelivery);
    expect(s.counts().weapon).toBe(1); expect(s.stats.weaponsMade).toBe(1); expect(s.stats.consumed.wood).toBe(40);
    expect(bill(s, id).output).toEqual(change === 'delete' ? { mode: 'drop', target: null } : { mode: 'specific', target });
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('full floor after target rejection keeps cargo in a reloadable dropping intent until space opens', () => {
    let { s, benchId } = fixture(); const target = zone(s); const id = add(s, benchId, { mode: 'specific', target }); start(s); complete(s, id);
    for (let x = 10; x <= 29; x++) for (let y = 10; y <= 24; y++)
      if (s.standable(pos(x, y)) && !s.items.some(i => at(i) === at(pos(x, y)))) item(s, 'steel', 75, pos(x, y));
    command(s, { type: 'storage', from: pos(27, 20), priority: 1, accepts: [] });
    until(s, () => s.pawns[0].productionDelivery?.state === 'dropping');
    s = VoxelSimulation.load(s.save()); expect(s.pawns[0].cargo?.resource).toBe('weapon');
    expect(s.pawns[0].productionDelivery?.state).toBe('dropping'); expect(bill(s, id).remaining).toBe(0);
    const free = s.items.find(i => i.resource === 'steel' && at(i) === at(s.pawns[0]))!;
    expect(free).toBeDefined(); s.items = s.items.filter(i => i.id !== free.id);
    until(s, () => !s.pawns[0].productionDelivery); expect(s.counts().weapon).toBe(1); expect(s.stats.weaponsMade).toBe(1);
  });
  it.each(['remove', 'uninstall'] as const)('committing target shelf %s cannot overwrite the interrupted producer cargo', operation => {
    let { s, benchId } = fixture('craftingSpot', 1);
    // Starting geometry fixture keeps the independent builder close to the
    // target and gives the producer a real, longer delivery route.
    Object.assign(s.shelves[0], pos(29, 24)); Object.assign(s.pawns[1], pos(28, 24));
    s = VoxelSimulation.load(s.save()); const shelf = s.shelves[0];
    const id = add(s, benchId, { mode: 'specific', target: { kind: 'shelf', id: shelf.id } }); start(s); complete(s, id);
    const identity = s.pawns[0].cargo!.weapon!.id;
    command(s, { type: 'priority', pawnId: s.pawns[1].id, work: 'build', value: 1 });
    command(s, operation === 'remove' ? { type: 'designate', tool: 'remove', from: shelf }
      : { type: 'uninstallFurniture', kind: shelf.kind, furnitureId: shelf.id });
    until(s, () => !s.shelves.some(v => v.id === shelf.id));
    expect(s.counts().weapon).toBe(1);
    until(s, () => !s.pawns[0].productionDelivery);
    expect(s.counts().weapon).toBe(1); expect(s.stats.produced.weapon).toBe(1); expect(s.stats.destroyed.weapon).toBe(0);
    expect(s.items.some(i => i.weapon?.id === identity)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('carries new meat only up to available capacity and leaves the remainder and pre-existing meat on the ground', () => {
    const { s, benchId } = fixture('butcherSpot'); const target = zone(s, pos(27, 20), 1, ['meat']);
    item(s, 'meat', 70, pos(27, 20)); const source = item(s, 'meat', 6, pos(15));
    const animalId = s.nextId++;
    s.items.push({ id: s.nextId++, ...pos(12), resource: 'carcass', amount: 1, carcass: { animalId, species: 'deer' }, rotProgress: 0 });
    const id = add(s, benchId, { mode: 'specific', target }, 'butcher');
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'cook', value: 1 });
    until(s, () => !!s.pawns[0].productionDelivery);
    expect(s.pawns[0].cargo).toMatchObject({ resource: 'meat', amount: 5 });
    expect(s.items.find(i => i.id === source.id)!.amount).toBeGreaterThanOrEqual(6);
    expect(bill(s, id).remaining).toBe(0);
    expect(s.counts().meat).toBe(76 + s.stats.produced.meat);
    until(s, () => !s.pawns[0].productionDelivery); expect(outputAt(s, pos(27, 20), 'meat')).toBe(75);
    expect(s.counts().meat).toBe(76 + s.stats.produced.meat);
  });
  it('zone rename/extension/splitting retains bill identity; clearing the final cell resets it', () => {
    let { s, benchId } = fixture(); const target = zone(s); if (target.kind !== 'stockpile') throw new Error('zone');
    const id = add(s, benchId, { mode: 'specific', target });
    command(s, { type: 'stockpileZoneRename', zoneId: target.id, name: '装备仓库' });
    command(s, { type: 'designate', tool: 'stock', from: pos(25, 20), to: pos(26, 20), zoneId: target.id });
    command(s, { type: 'designate', tool: 'clearZone', from: pos(26, 20) });
    s = VoxelSimulation.load(s.save());
    expect(s.stockpileZones.find(z => z.id === target.id)).toMatchObject({ name: '装备仓库', cells: expect.arrayContaining([at(pos(25, 20)), at(pos(27, 20))]) });
    expect(bill(s, id).output.target).toEqual(target);
    command(s, { type: 'designate', tool: 'clearZone', from: pos(25, 20), to: pos(27, 20) });
    expect(bill(s, id).output).toEqual({ mode: 'drop', target: null });
  });
  it('rejects malformed current delivery and zone identities instead of repairing them as legacy data', () => {
    const { s, benchId } = fixture(); const target = zone(s); const id = add(s, benchId, { mode: 'specific', target }); start(s); complete(s, id);
    const saved = s.save();
    const corrupt: Array<(raw: any) => void> = [
      raw => { raw.pawns[0].productionDelivery.mode = 'drop'; },
      raw => { raw.pawns[0].productionDelivery.target = null; },
      raw => { raw.pawns[0].productionDelivery.cell = -1; },
      raw => { raw.pawns[0].productionDelivery.state = 'working'; },
      raw => { raw.pawns[0].productionDelivery.billId = `bill:${raw.nextId}`; },
      raw => { raw.pawns[0].productionDelivery.work = 999; },
      raw => { raw.pawns[0].productionDelivery.recipe = 'butcher'; },
      raw => { raw.pawns[0].productionDelivery.recipe = 'smith:steelKnife'; },
      raw => { raw.pawns[0].productionDelivery.billId = `legacy:${benchId}:smith:steelKnife`; },
      raw => { raw.pawns[0].productionDelivery.target = { kind: 'shelf', id: raw.nextId }; },
      raw => { raw.pawns[0].productionDelivery.target = { kind: 'stockpile', id: `zone:${raw.nextId}` }; },
      raw => { raw.pawns[0].productionDelivery.state = 'dropping'; },
      raw => { raw.pawns[0].cargo = null; },
      raw => { raw.pawns[0].productionDelivery = null; },
      raw => { raw.stockpileZones[0].id = `zone:${raw.pawns[0].id}`; },
      raw => { raw.stockpileZones[0].id = `zone:${raw.pawns[0].cargo.weapon.id}`; },
      raw => { raw.stockpileZones[0].cells.push(raw.stockpileZones[0].cells[0]); },
      raw => { raw.productionQueues[0].bills[0].output = { mode: 'specific', target: { kind: 'stockpile', id: 'zone:9999999' } }; },
    ];
    for (const mutate of corrupt) { const raw = structuredClone(saved); mutate(raw); expect(() => VoxelSimulation.load(raw)).toThrow(); }
    const old = structuredClone(saved) as any; stripAutoSlaughterFields(old); old.version = 41;
    expect(() => VoxelSimulation.load(old)).toThrow();
    expect(s.pawns[0].productionDelivery).toBeDefined(); expect(s.counts().weapon).toBe(1);
  });
});
