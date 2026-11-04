import { stripRangedDefaults } from './legacy-ranged-defaults';
import { legacySimulation } from './fixtures/legacy-start';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { carryLimit, STACK_LIMITS, stackLimit } from '../src/voxel/logistics';
import { freshBatch, rotLimit, validBatch } from '../src/voxel/preservation';
import { freshFertilizedEggs } from '../src/voxel/animalEggs';
import { makeApparel, validApparel } from '../src/voxel/apparel';
import { makeWeapon, validWeapon } from '../src/voxel/weapons';
import { makeFurniturePiece, validFurniturePiece } from '../src/voxel/relocation';
import { plantYield } from '../src/voxel/skills';
import { defaultProductionPolicy } from '../src/voxel/productionPolicies';
import { unfinishedRecipeWorkTotals, validateUnfinishedPiece } from '../src/voxel/unfinishedProduction';
import {
  Block,
  DAY,
  at,
  index,
  type Cargo,
  type Counts,
  type Pos,
  type Resource,
  type VoxelCommand,
  type VoxelSave,
} from '../src/voxel/types';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
const resources = Object.keys(STACK_LIMITS) as Resource[];
function carve(s: VoxelSimulation, a: Pos, b: Pos = { ...a, z: a.z + 1 }) {
  for (let z = a.z; z <= b.z; z++)
    for (let y = a.y; y <= b.y; y++)
      for (let x = a.x; x <= b.x; x++) s.blocks[index(x, y, z)] = Block.Air;
}
function add(
  s: VoxelSimulation,
  p: Pos,
  resource: Resource,
  amount: number,
  extra: Partial<Cargo> = {},
) {
  const item = {
    ...(resource === 'weapon'
      ? { resource, amount, weapon: makeWeapon(s.nextId++, 'steelKnife') }
      : resource === 'apparel'
        ? { resource, amount, apparel: makeApparel(s.nextId++, 'tuque') }
        : resource === 'carcass'
          ? { resource, amount, carcass: { animalId: s.nextId++, species: 'hare' as const }, rotProgress: 0 }
          : resource === 'furniture'
            ? { resource, amount, furniture: makeFurniturePiece('chair', { ...p, id: s.nextId++, axis: 'x', quality: 2 }, 50.25) }
            : resource === 'unfinished'
              ? { resource, amount, unfinished: {
                id: s.nextId++, recipe: 'smith:woodClub' as const,
                creatorId: s.pawns[0].id, creatorName: s.pawns[0].name, boundBillId: null,
                workTotal: unfinishedRecipeWorkTotals('smith:woodClub')[0], progress: 0, workTicks: 0,
                ingredients: [freshBatch('wood', 40)], policy: defaultProductionPolicy(),
              } }
              : resource === 'eggFertilized' ? freshFertilizedEggs(amount) : freshBatch(resource, amount)),
    ...extra,
    x: p.x,
    y: p.y,
    z: p.z,
    id: s.nextId++,
  };
  s.items.push(item);
  return item;
}
function stock(s: VoxelSimulation, p: Pos, accepts: Resource[] = [...resources], priority = 3) {
  s.stockpiles.push({ ...p, priority, accepts });
}
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c);
  expect(result.ok, result.message).toBe(true);
  return result;
}
/** Geometry/resources are explicit isolated fixtures. All transfers after load
 * use real jobs, reservations, movement, eating, spoiling and save/load. */
function fixture(setup: (s: VoxelSimulation) => void = () => {}) {
  const s = legacySimulation();
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.items = [];
  s.trees = [];
  s.jobs = [];
  s.stockpiles = [];
  s.farms = [];
  s.crops = [];
  s.stoves = [];
  s.beds = [];
  s.doors = [];
  s.devices = [];
  s.wires = [];
  carve(s, pos(10, 10), pos(22, 18, 9));
  for (let i = 0; i < s.pawns.length; i++) {
    Object.assign(s.pawns[i], pos(10 + i, 18));
    s.pawns[i].priorities = {
      handle: 0, firefight: 0, clean: 0,
      warden: 0,
      hunt: 0,
      dig: 0,
      build: 0,
      cut: 0,
      haul: 0,
      grow: 0,
      cook: 0,
      craft: 0,
      care: 0,
      research: 0,
    };
  }
  setup(s);
  return VoxelSimulation.load(s.save());
}
function ledger(s: VoxelSimulation): Counts {
  const out = s.counts();
  for (const r of resources)
    out[r] += s.stats.consumed[r] + s.stats.spoiled[r] + s.stats.destroyed[r] - s.stats.produced[r];
  return out;
}
function invariants(s: VoxelSimulation) {
  expect(new Set(s.items.map(at)).size).toBe(s.items.length);
  for (const i of s.items) {
    expect(i.amount).toBeGreaterThan(0);
    expect(i.amount).toBeLessThanOrEqual(stackLimit(i.resource));
    expect(
      Object.keys(i).every((k) =>
        [
          'id',
          'x',
          'y',
          'z',
          'resource',
          'amount',
          'crop',
          'rotProgress',
          'apparel',
          'weapon',
          'furniture',
          'unfinished',
          'carcass',
          'hatcher',
          'forbidden',
          'poisonChance',
          'hitPoints',
        ].includes(k),
      ),
    ).toBe(true);
    expect(validBatch(i)).toBe(true);
    expect(i.resource === 'apparel' ? validApparel(i.apparel) : i.apparel === undefined).toBe(true);
    expect(i.resource === 'weapon' ? validWeapon(i.weapon) : i.weapon === undefined).toBe(true);
    expect(i.resource === 'furniture' ? validFurniturePiece(i.furniture) : i.furniture === undefined).toBe(true);
    expect(i.resource === 'unfinished' ? validateUnfinishedPiece(i.unfinished) : i.unfinished === undefined).toBe(true);
  }
  for (const p of s.pawns)
    if (p.cargo) expect(p.cargo.amount).toBeLessThanOrEqual(carryLimit(p.cargo.resource));
  for (const cell of s.storageCapacity())
    expect(cell.amount + cell.reserved).toBeLessThanOrEqual(cell.limit || 75);
}
function until(s: VoxelSimulation, condition: () => boolean, limit = 1600) {
  const initial = ledger(s);
  for (let n = 0; !condition() && n < limit; n++) {
    s.step();
    invariants(s);
    expect(ledger(s)).toEqual(initial);
  }
  expect(
    condition(),
    JSON.stringify({
      tick: s.tick,
      jobs: s.jobs,
      harvested: s.stats.harvested,
      producedGrain: s.stats.produced.grain,
      pawns: s.pawns.map((p) => ({ cargo: p.cargo, reason: p.reason, plantsLevel: p.skills.plants.level })),
    }),
  ).toBe(true);
}
function tiny(s: VoxelSimulation) {
  s.blocks.fill(Block.Stone);
  carve(s, pos(10, 10), pos(12, 12, 9));
  s.pawns.forEach((p, n) => Object.assign(p, pos(10 + n, 10)));
}
function fillTiny(s: VoxelSimulation, exceptions: Pos[] = []) {
  for (let y = 10; y <= 12; y++)
    for (let x = 10; x <= 12; x++) {
      const p = pos(x, y);
      if (!exceptions.some((q) => at(q) === at(p))) add(s, p, 'stone', 75);
    }
}

describe('bounded physical stacks and hauling reservations', () => {
  it('does not send several workers to fetch the same scarce construction input', () => {
    const s = fixture(s => {
      s.pawns.forEach(p => { p.schedule.fill('work'); p.priorities.build = 1; p.priorities.haul = 1; });
      add(s, pos(18, 12), 'wood', 6);
      stock(s, pos(21, 17), ['wood']);
    });
    command(s, { type: 'designate', tool: 'wall', from: pos(19, 15) });
    command(s, { type: 'designate', tool: 'wall', from: pos(20, 15) });
    until(s, () => s.pawns.some(p => p.phase === 'fetch'));
    expect(s.pawns.filter(p => p.destination === at(pos(18, 12)))).toHaveLength(1);
    until(s, () => s.stats.consumed.wood === 6);
    expect(s.items.filter(i => i.resource === 'wood')).toHaveLength(0);
    expect(s.pawns.filter(p => p.cargo?.resource === 'wood')).toHaveLength(0);
    expect(s.jobs.some(j => j.kind === 'wall' && j.delivered.wood === undefined)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it.each(['construction', 'food', 'haul'] as const)('a sale cancels the %s source plan before a same-cell replacement can be taken', kind => {
    const s = fixture(s => {
      const p = s.pawns[0]; p.schedule.fill('work');
      p.priorities.build = kind === 'construction' ? 1 : 0;
      p.priorities.haul = kind === 'haul' ? 1 : 0;
      if (kind === 'food') p.food = 20;
      add(s, pos(18, 12), kind === 'food' ? 'meal' : 'wood', kind === 'food' ? 2 : 6);
      if (kind === 'haul') stock(s, pos(21, 17), ['wood']);
    });
    if (kind === 'construction') command(s, { type: 'designate', tool: 'wall', from: pos(20, 15) });
    until(s, () => s.pawns[0].destination === at(pos(18, 12)));
    const original = s.items[0], replacement = { ...original, id: s.nextId++ };
    // Commit the same atomic replacement used by trading; the fresh stack at
    // the old position must not inherit another physical batch's reservations.
    s.tradeApplyPlacement({ items: [replacement], nextId: s.nextId });
    expect(s.pawns[0].destination).toBeNull();
    expect(s.pawns[0].phase).toBe('idle');
    expect(s.pawns[0].cargo).toBeNull();
    expect(s.items).toEqual([replacement]);
    expect(s.storageCapacity().every(c => c.reserved === 0)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('shares one stack by quantity and releases a drafted worker\'s portion for another builder', () => {
    const s = fixture(s => {
      s.pawns.forEach(p => { p.schedule.fill('work'); p.priorities.build = 1; });
      add(s, pos(18, 12), 'wood', 12);
    });
    for (const x of [18, 19, 20]) command(s, { type: 'designate', tool: 'wall', from: pos(x, 15) });
    until(s, () => s.pawns.filter(p => p.phase === 'fetch').length === 2);
    const builders = s.pawns.filter(p => p.phase === 'fetch'), waiting = s.pawns.find(p => p.phase !== 'fetch')!;
    expect(s.animalAvailable(s.items[0])).toBe(0);
    command(s, { type: 'draft', pawnId: builders[0].id, drafted: true });
    expect(s.animalAvailable(s.items[0])).toBe(6);
    until(s, () => waiting.phase === 'fetch');
    expect(s.animalAvailable(s.items[0])).toBe(0);
    until(s, () => s.stats.consumed.wood === 12);
    expect(ledger(s).wood).toBe(12);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('reserves scarce meals individually so all hungry pawns do not chase one serving', () => {
    const s = fixture(s => {
      s.pawns.forEach(p => { p.food = 20; p.schedule.fill('work'); });
      add(s, pos(18, 12), 'meal', 1);
      add(s, pos(20, 12), 'food', 2);
    });
    until(s, () => s.pawns.every(p => p.phase === 'fetch'));
    expect(s.pawns.filter(p => p.destination === at(pos(18, 12)))).toHaveLength(1);
    expect(s.pawns.filter(p => p.destination === at(pos(20, 12)))).toHaveLength(2);
    expect(s.items.every(i => s.animalAvailable(i) === 0)).toBe(true);
    until(s, () => s.stats.consumed.meal === 1 && s.stats.consumed.food === 2);
    expect(s.pawns.every(p => p.food > 60)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it.each(['fetch', 'haul'] as const)('a rotting source immediately releases its %s route and physical reservation', phase => {
    const s = fixture(s => {
      const p = s.pawns[0]; p.schedule.fill('work');
      if (phase === 'fetch') p.food = 20;
      else { p.priorities.haul = 1; stock(s, pos(21, 17), ['meal']); }
      add(s, pos(18, 12), 'meal', 2);
    });
    until(s, () => s.pawns[0].phase === phase);
    const source = s.items[0];
    // Explicit boundary fixture: the already reserved batch expires next tick.
    source.rotProgress = rotLimit(source)! - 0.01;
    s.step();
    expect(s.stats.spoiled.meal).toBe(2);
    expect(s.pawns[0].destination).not.toBe(at(source));
    expect(s.pawns[0].cargo).toBeNull();
    expect(s.storageCapacity().every(c => c.reserved === 0)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('keeps all initial 90 wood and 60 packaged meals as two and six legal stacks', () => {
    const s = legacySimulation();
    invariants(s);
    expect(s.items.filter((i) => i.resource === 'wood').map((i) => i.amount)).toEqual([75, 15]);
    expect(s.items.filter((i) => i.resource === 'food').map((i) => i.amount)).toEqual([
      10, 10, 10, 10, 10, 10,
    ]);
    expect(s.save().version).toBe(55);
    expect(VoxelSimulation.load(s.save()).counts()).toEqual(s.counts());
  });
  it.each(resources)('carries and stores %s only within its native one-stack limit', (resource) => {
    const s = fixture((s) => {
      s.pawns[0].priorities.haul = 1;
      add(s, pos(12, 15), resource, stackLimit(resource));
      stock(s, pos(20, 15), [resource]);
    });
    const unfinished = structuredClone(s.items[0].unfinished);
    until(s, () => !!s.pawns[0].cargo);
    expect(s.pawns[0].cargo!.amount).toBe(carryLimit(resource));
    if (resource === 'unfinished') {
      expect(s.pawns[0].cargo!.unfinished).toEqual(unfinished);
      expect(VoxelSimulation.load(s.save()).pawns[0].cargo!.unfinished).toEqual(unfinished);
    }
    until(s, () => s.items.find((i) => at(i) === at(pos(20, 15)))?.amount === stackLimit(resource));
    expect(s.storageCapacity()[0]).toMatchObject({
      amount: stackLimit(resource),
      reserved: 0,
      occupied: true,
    });
    if (resource === 'unfinished')
      expect(s.items.find(i => at(i) === at(pos(20, 15)))!.unfinished).toEqual(unfinished);
    expect(VoxelSimulation.load(s.save()).counts()).toEqual(s.counts());
  });
  it('reserves the last five places across three workers without overbooking or idle ping-pong', () => {
    const s = fixture((s) => {
      s.pawns.forEach((p) => (p.priorities.haul = 1));
      stock(s, pos(20, 15), ['wood']);
      add(s, pos(20, 15), 'wood', 70);
      add(s, pos(12, 15), 'wood', 75);
      add(s, pos(14, 15), 'wood', 75);
    });
    until(s, () => s.storageCapacity()[0].reserved > 0);
    expect(s.storageCapacity()[0].reserved).toBe(5);
    expect(s.storageSpace(pos(20, 15), { resource: 'wood' })).toBe(0);
    until(s, () => s.items.find((i) => at(i) === at(pos(20, 15)))!.amount === 75);
    expect(s.stats.hauled).toBe(5);
    const initial = ledger(s);
    s.step(500);
    invariants(s);
    expect(s.stats.hauled).toBe(5);
    expect(s.pawns.every((p) => !p.cargo)).toBe(true);
    expect(ledger(s)).toEqual(initial);
  });
  it('does not reserve an empty cell simultaneously for incompatible resources', () => {
    const s = fixture((s) => {
      s.pawns.forEach((p) => (p.priorities.haul = 1));
      stock(s, pos(20, 15), ['wood', 'steel']);
      add(s, pos(12, 15), 'wood', 20);
      add(s, pos(14, 15), 'steel', 20);
    });
    until(s, () => s.storageCapacity()[0].reserved > 0);
    const free = s.storageCapacity()[0].available;
    expect(Number(free.wood > 0) + Number(free.steel > 0)).toBe(1);
    until(s, () => s.storageCapacity()[0].occupied);
    s.step(300);
    invariants(s);
    expect(s.items).toHaveLength(2);
    expect(s.stats.hauled).toBe(20);
    expect(s.pawns.every((p) => !p.cargo)).toBe(true);
  });
  it('waits at a full warehouse and resumes after a normal zone expansion', () => {
    const s = fixture((s) => {
      s.pawns[0].priorities.haul = 1;
      stock(s, pos(20, 15), ['wood']);
      add(s, pos(20, 15), 'wood', 75);
      add(s, pos(12, 15), 'wood', 30);
    });
    s.step(160);
    expect(s.stats.hauled).toBe(0);
    expect(s.pawns[0].reason).toContain('仓储已满');
    command(s, { type: 'designate', tool: 'stock', from: pos(21, 15) });
    until(s, () => s.stats.hauled === 30);
    expect(s.items.find((i) => at(i) === at(pos(21, 15)))!.amount).toBe(30);
  });
  it('retains cargo when its destination filter changes and resumes into a new legal cell', () => {
    const s = fixture((s) => {
      s.pawns[0].priorities.haul = 1;
      stock(s, pos(20, 15), ['wood']);
      add(s, pos(12, 15), 'wood', 30);
    });
    until(s, () => !!s.pawns[0].cargo);
    const initial = ledger(s);
    command(s, { type: 'storage', from: pos(20, 15), priority: 3, accepts: ['steel'] });
    expect(s.storageCapacity()[0].reserved).toBe(0);
    until(s, () => s.pawns[0].phase === 'idle');
    expect(s.pawns[0].cargo).toMatchObject({ resource: 'wood', amount: 30 });
    expect(s.items).toEqual([]);
    expect(ledger(s)).toEqual(initial);
    command(s, { type: 'designate', tool: 'stock', from: pos(21, 15) });
    until(s, () => !s.pawns[0].cargo);
    expect(s.items[0]).toMatchObject({ ...pos(21, 15), resource: 'wood', amount: 30 });
  });
  it('chooses a reachable lower-priority destination over an isolated higher-priority island', () => {
    const s = fixture((s) => {
      carve(s, pos(30, 30), pos(32, 32, 9));
      stock(s, pos(31, 31), ['wood'], 3);
      stock(s, pos(20, 15), ['wood'], 1);
      add(s, pos(12, 15), 'wood', 30);
      s.pawns[0].priorities.haul = 1;
    });
    until(s, () => s.stats.hauled === 30);
    expect(s.items[0]).toMatchObject(pos(20, 15));
  });
  it('lets ordinary spoilage free a formerly incompatible destination', () => {
    const s = fixture((s) => {
      s.pawns[0].priorities.haul = 1;
      stock(s, pos(20, 15), ['wood', 'meal']);
      add(s, pos(20, 15), 'meal', 10, { rotProgress: 4 * DAY - 1 });
      add(s, pos(12, 15), 'wood', 20);
    });
    expect(s.storageSpace(pos(20, 15), { resource: 'wood' })).toBe(0);
    until(s, () => s.stats.hauled === 20);
    expect(s.stats.spoiled.meal).toBe(10);
    expect(s.items[0]).toMatchObject({ resource: 'wood', amount: 20 });
  });
  it('rebuilds storage reservations after saving mid-haul without losing the carried age', () => {
    let s = fixture((s) => {
      s.pawns[0].priorities.haul = 1;
      stock(s, pos(20, 15), ['grain']);
      add(s, pos(12, 15), 'grain', 30, { crop: 'corn', rotProgress: 1234 });
    });
    until(s, () => !!s.pawns[0].cargo);
    const saved = s.save(),
      age = s.pawns[0].cargo!.rotProgress!,
      initial = ledger(s);
    s = VoxelSimulation.load(saved);
    expect(s.pawns[0].cargo!.rotProgress).toBe(age);
    expect(s.storageCapacity()[0].reserved).toBe(0);
    until(s, () => s.stats.hauled === 30);
    expect(ledger(s)).toEqual(initial);
    expect(s.items[0]).toMatchObject({ crop: 'corn', amount: 30 });
    expect(s.items[0].rotProgress).toBeGreaterThan(age);
  });
});

describe('bounded outputs and interrupted physical containers', () => {
  it('keeps carried perishable food during sleep when every nearby floor cell is full', () => {
    const s = fixture((s) => {
      tiny(s);
      fillTiny(s);
      s.pawns[0].cargo = { ...freshBatch('meal', 2), rotProgress: 100 };
      s.pawns[0].rest = 50;
    });
    const initial = ledger(s);
    command(s, { type: 'rest', pawnId: s.pawns[0].id });
    expect(s.pawns[0]).toMatchObject({
      phase: 'rest',
      cargo: { resource: 'meal', amount: 2, rotProgress: 100 },
    });
    expect(s.pawns[0].reason).toContain('无卸货空间');
    s.step(10);
    expect(ledger(s)).toEqual(initial);
    expect(s.pawns[0].cargo!.rotProgress).toBeGreaterThan(100);
    expect(VoxelSimulation.load(s.save()).counts()).toEqual(s.counts());
  });
  it('can eat from the ground while retaining nonfood cargo when unloading is impossible', () => {
    const s = fixture((s) => {
      tiny(s);
      fillTiny(s, [pos(11, 10)]);
      add(s, pos(11, 10), 'food', 10);
      s.pawns[0].cargo = freshBatch('wood', 20);
      s.pawns[0].food = 20;
    });
    until(s, () => s.stats.consumed.food === 1);
    expect(s.pawns[0].cargo).toEqual({ resource: 'wood', amount: 20 });
    expect(s.pawns[0].food).toBeGreaterThan(90);
    expect(s.items.find((i) => i.resource === 'food')!.amount).toBe(9);
  });
  function fullKitchen() {
    return fixture((s) => {
      tiny(s);
      const stove = pos(11, 11);
      fillTiny(s, [stove, pos(12, 11), pos(12, 12)]);
      add(s, pos(12, 11), 'meal', 10, { rotProgress: 4 * DAY - 300 });
      add(s, pos(12, 12), 'meal', 10, { rotProgress: 4 * DAY - 300 });
      s.stoves.push({ ...stove, id: s.nextId++, target: 21, paused: false });
      command(s, { type: 'bill', stoveId: s.stoves[0].id, target: 21, paused: false });
      const job = s.jobs.find((j) => j.kind === 'cook')!;
      // This controlled fixture injects a prepared batch, including its v40
      // input policy, rather than fetching those ingredients through assignment.
      job.productionPolicy = defaultProductionPolicy();
      job.delivered = { wood: 1, grain: 10 };
      job.deliveredBatches = [freshBatch('wood', 1), { ...freshBatch('grain', 10, 'potato'), rotProgress: 100 }];
      job.progress = job.work - 1;
      s.pawns[0].priorities.cook = 1;
    });
  }
  it('keeps a cancelled recipe in its finite original container until real spoilage opens refund space', () => {
    let s = fullKitchen();
    const initial = ledger(s),
      jobId = s.jobs[0].id;
    command(s, { type: 'bill', stoveId: s.stoves[0].id, target: 21, paused: true });
    expect(s.jobs[0]).toMatchObject({ cancelled: true, delivered: { grain: 10, wood: 1 } });
    expect(s.jobs[0].reason).toContain('退料空间');
    expect(ledger(s)).toEqual(initial);
    s = VoxelSimulation.load(s.save());
    expect(s.jobs[0].cancelled).toBe(true);
    until(s, () => !s.jobs.some((j) => j.id === jobId), 500);
    expect(s.stats.spoiled.meal).toBe(20);
    expect(s.stats.produced.meal).toBe(0);
    expect(s.items.find((i) => i.resource === 'grain')).toMatchObject({
      crop: 'potato',
      amount: 10,
    });
    expect(s.items.find((i) => i.resource === 'grain')!.rotProgress).toBeGreaterThan(100);
    expect(ledger(s)).toEqual(initial);
  });
  it('pauses cooked output without consuming ingredients until a nearby stack expires', () => {
    let s = fullKitchen();
    until(s, () => s.jobs.some((j) => j.reason.includes('附近可达落地空间')));
    expect(s.stats.cooked).toBe(0);
    expect(s.stats.consumed.grain).toBe(0);
    expect(s.jobs[0].delivered.grain).toBe(10);
    const outcome = structuredClone(s.jobs[0].cookingOutcome);
    expect(outcome).toBeDefined();
    s = VoxelSimulation.load(s.save());
    expect(s.jobs[0].cookingOutcome).toEqual(outcome);
    until(s, () => s.stats.cooked === 1, 500);
    expect(s.stats.produced.meal).toBe(1);
    expect(s.stats.consumed.grain).toBe(10);
    invariants(s);
  });
  it('rolls back both ore cells when 80 steel cannot fit, then splits the output once space opens', () => {
    const s = fixture((s) => {
      tiny(s);
      fillTiny(s, [pos(12, 12)]);
      add(s, pos(12, 12), 'meal', 10, { rotProgress: 4 * DAY - 300 });
      s.blocks[at(pos(13, 11))] = Block.Steel;
      s.blocks[at(pos(13, 11, 9))] = Block.Steel;
      s.pawns[0].priorities.dig = 1;
    });
    command(s, { type: 'designate', tool: 'mine', from: pos(13, 11) });
    until(s, () => s.jobs.some((j) => j.reason.includes('附近可达落地空间')));
    expect(s.blocks[at(pos(13, 11))]).toBe(Block.Steel);
    expect(s.blocks[at(pos(13, 11, 9))]).toBe(Block.Steel);
    expect(s.stats.mined).toBe(0);
    expect(s.stats.produced.steel).toBe(0);
    until(s, () => s.stats.mined === 2, 500);
    expect(s.stats.produced.steel).toBe(80);
    expect(
      s.items
        .filter((i) => i.resource === 'steel')
        .map((i) => i.amount)
        .sort((a, b) => a - b),
    ).toEqual([5, 75]);
  });
  it('rolls back a partially planned food displacement without changing its weighted age or count', () => {
    const s = fixture((s) => {
      tiny(s);
      fillTiny(s, [pos(11, 11), pos(12, 11)]);
      add(s, pos(11, 11), 'grain', 5, { crop: 'rice', rotProgress: 100 });
      add(s, pos(12, 11), 'grain', 73, { crop: 'rice', rotProgress: 500 });
      command(s, { type: 'designate', tool: 'wall', from: pos(11, 11) });
      s.jobs[0].delivered = { wood: 6 };
      s.jobs[0].deliveredBatches = [freshBatch('wood', 6)];
      s.jobs[0].progress = s.jobs[0].work - 1;
      s.pawns[0].priorities.build = 1;
    });
    until(s, () => s.jobs.some((j) => j.reason.includes('散落物资无相邻')));
    expect(s.blocks[at(pos(11, 11))]).toBe(Block.Air);
    expect(s.stats.consumed.wood).toBe(0);
    const a = s.items.find((i) => at(i) === at(pos(11, 11)))!,
      b = s.items.find((i) => at(i) === at(pos(12, 11)))!;
    expect([a.amount, b.amount]).toEqual([5, 73]);
    expect(b.rotProgress! - a.rotProgress!).toBeCloseTo(400, 8);
  });
  it.each(['cut', 'harvest'] as const)(
    'preserves the actual %s source while nearby ground is full',
    (kind) => {
      const s = fixture((s) => {
        tiny(s);
        fillTiny(s, [pos(12, 12)]);
        // Remain full beyond the novice forester's slower actual cutting time.
        add(s, pos(12, 12), 'meal', 10, { rotProgress: 4 * DAY - 1000 });
        if (kind === 'cut') {
          carve(s, pos(13, 11));
          s.trees.push({
            ...pos(13, 11),
            id: s.nextId++,
            wood: 27,
            species: 'poplar',
            growth: 1,
            age: 0,
            planted: false,
            health: 1,
            unlitTicks: 0,
          });
          s.pawns[0].priorities.cut = 1;
        } else {
          // This case isolates blocked output, not the novice harvest-failure roll.
          s.pawns[0].skills.plants.level = 8;
          expect(plantYield(s.pawns[0].skills)).toBe(1);
          s.blocks[index(11, 11, 7)] = Block.Soil;
          s.farms.push({ ...pos(11, 11), crop: 'rice' });
          s.crops.push({ ...pos(11, 11), id: s.nextId++, kind: 'rice', growth: 1, sownAt: 0 });
          s.pawns[0].priorities.grow = 1;
        }
      });
      if (kind === 'cut') command(s, { type: 'designate', tool: 'cut', from: pos(13, 11) });
      until(s, () => s.jobs.some((j) => j.reason.includes('附近可达落地空间')));
      expect(kind === 'cut' ? s.trees.length : s.crops.length).toBe(1);
      expect(s.stats.cut + s.stats.harvested).toBe(0);
      until(s, () => s.stats.cut + s.stats.harvested === 1, 1500);
      expect(s.stats.produced[kind === 'cut' ? 'wood' : 'grain']).toBe(kind === 'cut' ? 27 : 6);
    },
  );
});

describe('v6 strict saves and bounded v5 migration', () => {
  it('splits same-cell legacy species and excess cargo deterministically without changing totals or age', () => {
    const s = fixture(),
      raw = s.save() as unknown as Record<string, any>;
    stripRangedDefaults(raw);    raw.version = 5;
    raw.items = [
      { ...pos(15, 15), id: raw.nextId++, ...freshBatch('grain', 160, 'corn'), rotProgress: 1234 },
      { ...pos(15, 15), id: raw.nextId++, ...freshBatch('grain', 40, 'potato'), rotProgress: 4321 },
    ];
    raw.pawns[0].cargo = { ...freshBatch('meal', 25), rotProgress: 222 };
    const untouched = structuredClone(raw),
      a = VoxelSimulation.load(raw),
      b = VoxelSimulation.load(raw);
    expect(raw).toEqual(untouched);
    expect(a.save()).toEqual(b.save());
    invariants(a);
    expect(a.counts()).toMatchObject({ grain: 200, meal: 25 });
    expect(a.pawns[0].cargo!.amount).toBe(10);
    for (const batch of [...a.items, a.pawns[0].cargo!]) {
      expect(batch.rotProgress).toBe(
        batch.resource === 'meal' ? 222 : batch.crop === 'corn' ? 1234 : 4321,
      );
    }
    expect(
      a.items.filter((i) => i.resource === 'grain').every((i) => a.path(pos(15, 15), i) !== null),
    ).toBe(true);
  });
  it('rejects legacy overflow atomically when only an isolated unreachable room has space', () => {
    const s = fixture((s) => {
      tiny(s);
      fillTiny(s);
      carve(s, pos(30, 30), pos(40, 40, 9));
    });
    const raw = s.save() as unknown as Record<string, any>;
    stripRangedDefaults(raw);    raw.version = 5;
    raw.items[0].amount = 76;
    const before = structuredClone(raw);
    expect(() => VoxelSimulation.load(raw)).toThrow(/容量不足/);
    expect(raw).toEqual(before);
  });
  it('rejects v6 excessive stacks, collisions, cargo, hidden stack fields and excessive delivered inputs', () => {
    const s = fixture((s) => {
      add(s, pos(12, 15), 'wood', 30);
      command(s, { type: 'designate', tool: 'wall', from: pos(20, 15) });
    });
    const saved = s.save();
    const mutations: ((d: VoxelSave) => void)[] = [
      (d) => {
        d.items[0].amount = 76;
      },
      (d) => {
        d.items.push({ ...d.items[0], id: d.nextId++ });
      },
      (d) => {
        d.pawns[0].cargo = freshBatch('food', 11);
      },
      (d) => {
        d.pawns[0].cargo = Object.assign(freshBatch('wood', 1), {
          hidden: { resource: 'steel', amount: 100 },
        });
      },
      (d) => {
        Object.assign(d.items[0], { cargo: { amount: 0 }, schedule: [] });
      },
      (d) => {
        d.jobs[0].delivered.wood = 7;
      },
      (d) => {
        (d.jobs[0] as unknown as Record<string, unknown>).cancelled = undefined;
      },
      (d) => {
        d.items[0].z = 9;
      },
    ];
    for (const mutate of mutations) {
      const raw = structuredClone(saved);
      mutate(raw);
      const before = structuredClone(raw);
      expect(() => VoxelSimulation.load(raw)).toThrow();
      expect(raw).toEqual(before);
    }
  });
});
