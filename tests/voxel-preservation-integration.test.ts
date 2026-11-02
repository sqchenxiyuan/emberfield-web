import { legacySimulation } from './fixtures/legacy-start';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { VoxelThermal } from '../src/voxel/thermal';
import { freshBatch, rotLimit, rotRateAtTemperature } from '../src/voxel/preservation';
import { CROPS, temperatureAt } from '../src/voxel/farming';
import {
  Block,
  DAY,
  at,
  index,
  type Cargo,
  type Counts,
  type CropKind,
  type Pos,
  type Resource,
  type Stockpile,
  type VoxelCommand,
  type VoxelSave,
} from '../src/voxel/types';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
const resources: Resource[] = [
  'wood',
  'stone',
  'steel',
  'components',
  'food',
  'grain',
  'meal',
  'chunk',
];
const stock = (p: Pos, priority = 1, accepts: Resource[] = [...resources]): Stockpile => ({
  ...p,
  priority,
  accepts,
});
function carve(sim: VoxelSimulation, from: Pos, to = { ...from, z: from.z + 1 }) {
  for (let z = from.z; z <= to.z; z++)
    for (let y = from.y; y <= to.y; y++)
      for (let x = from.x; x <= to.x; x++) sim.blocks[index(x, y, z)] = Block.Air;
}
function addBatch(sim: VoxelSimulation, batch: Cargo, p: Pos) {
  sim.items.push({ ...batch, ...p, id: sim.nextId++ });
}
/** Explicit isolated fixtures, not proof of normal resource gathering. Physical
 * transfer, harvesting, cooking, hauling, cancellation and save/load use world APIs.
 */
function fixture(configure: (sim: VoxelSimulation) => void = () => {}) {
  const source = legacySimulation();
  source.blocks.fill(Block.Stone);
  source.ladders.fill(0);
  source.items = [];
  source.trees = [];
  source.jobs = [];
  source.stockpiles = [];
  source.farms = [];
  source.crops = [];
  source.stoves = [];
  source.beds = [];
  source.doors = [];
  carve(source, pos(10, 10), pos(25, 20, 9));
  for (let i = 0; i < source.pawns.length; i++) {
    Object.assign(source.pawns[i], pos(10 + i, 18));
    source.pawns[i].priorities = { dig: 0, build: 0, cut: 0, haul: 0, grow: 0, cook: 0, craft: 0 };
  }
  configure(source);
  const sim = VoxelSimulation.load(source.save());
  // Isolate food from passive heat exchange while preserving true room lookup.
  sim.thermal = new VoxelThermal({
    wallConductance: 0,
    reservoirConductance: 0,
    doorOpenRate: 0,
    doorClosedRate: 0,
  });
  sim.thermal.sync(
    sim.blocks,
    sim.rooms,
    sim.doors.map((d) => ({ ...d, kind: 'door' as const })),
    temperatureAt(sim.tick),
  );
  for (const room of sim.rooms.snapshot())
    if (!room.outdoor) {
      const anchor = sim.thermal.save().find((saved) => sim.rooms.roomIds[saved.cell] === room.id)!;
      sim.thermal.restore(
        sim.thermal
          .save()
          .map((saved) => (saved.cell === anchor.cell ? { ...saved, temperature: 10 } : saved)),
        sim.rooms,
        10,
      );
    }
  return sim;
}
function temperature(sim: VoxelSimulation, p: Pos, value: number) {
  sim.thermal.pushHeat(p, (value - sim.temperature(p)) * 1e8, value);
}
function command(sim: VoxelSimulation, c: VoxelCommand) {
  const result = sim.command(c);
  expect(result.ok, JSON.stringify({ c, result })).toBe(true);
  return result;
}
function ledger(sim: VoxelSimulation): Counts {
  const counts = sim.counts();
  for (const r of resources)
    counts[r] += sim.stats.consumed[r] + sim.stats.spoiled[r] - sim.stats.produced[r];
  return counts;
}
function until(sim: VoxelSimulation, condition: () => boolean, limit = 1600) {
  const initial = ledger(sim);
  for (let n = 0; !condition() && n < limit; n++) {
    sim.step();
    expect(ledger(sim)).toEqual(initial);
  }
  expect(
    condition(),
    JSON.stringify({ tick: sim.tick, items: sim.items, pawns: sim.pawns, jobs: sim.jobs }),
  ).toBe(true);
}

describe('physical food age, destruction and harvest identity', () => {
  it('keeps a frozen ground meal age unchanged, then destroys it after two ticks at 5 C', () => {
    const sim = fixture((s) => {
      addBatch(s, { ...freshBatch('meal', 3), rotProgress: 4 * DAY - 1 }, pos(15, 15));
      for (let x = 16; x < 22; x++) addBatch(s, freshBatch('food', 10), pos(x, 15));
    });
    const initial = ledger(sim);
    temperature(sim, pos(15, 15), -5);
    sim.step(20);
    expect(sim.items.find((i) => i.resource === 'meal')!.rotProgress).toBe(4 * DAY - 1);
    temperature(sim, pos(15, 15), 5);
    sim.step();
    expect(sim.counts().meal).toBe(3);
    sim.step();
    expect(sim.counts().meal).toBe(0);
    expect(sim.stats.spoiled.meal).toBe(3);
    expect(sim.stats.consumed.meal).toBe(0);
    expect(sim.stats.eaten).toBe(0);
    expect(sim.counts().food).toBe(60);
    expect(sim.items.find((i) => i.resource === 'food')!.rotProgress).toBeUndefined();
    expect(ledger(sim)).toEqual(initial);
    sim.step(10);
    expect(sim.stats.spoiled.meal).toBe(3);
  });
  it('uses the carrier actual room on each tick while moving through a doorway', () => {
    const sim = fixture((s) => {
      s.blocks.fill(Block.Stone);
      carve(s, pos(10, 10), pos(12, 12, 9));
      carve(s, pos(14, 10), pos(16, 12, 9));
      carve(s, pos(13, 11));
      s.doors.push({ ...pos(13, 11), id: s.nextId++, axis: 'y', mode: 'open', openUntil: 0 });
      for (let i = 0; i < s.pawns.length; i++) Object.assign(s.pawns[i], pos(10 + i, 10));
      s.pawns[0].cargo = { ...freshBatch('meal', 2), rotProgress: 100 };
    });
    temperature(sim, pos(11, 11), -10);
    temperature(sim, pos(15, 11), 10);
    const pawn = sim.pawns[0];
    command(sim, { type: 'move', pawnId: pawn.id, target: pos(15, 11) });
    let expected = 100;
    while (pawn.path.length || pawn.phase === 'travel') {
      expected += rotRateAtTemperature(sim.temperature(pawn));
      sim.step();
      expect(pawn.cargo!.rotProgress).toBeCloseTo(expected, 10);
    }
    expect(pawn.cargo!.rotProgress).toBeGreaterThan(100);
    expect(at(pawn)).toBe(at(pos(15, 11)));
    expect(sim.stats.spoiled.meal).toBe(0);
  });
  it('destroys expired carried food without counting it as eaten or consumed', () => {
    const sim = fixture((s) => {
      s.pawns[0].cargo = { ...freshBatch('meal', 2), rotProgress: 4 * DAY - 1 };
    });
    const initial = ledger(sim);
    sim.step();
    expect(sim.pawns[0].cargo).toBeNull();
    expect(sim.stats.spoiled.meal).toBe(2);
    expect(sim.stats.consumed.meal).toBe(0);
    expect(sim.stats.eaten).toBe(0);
    expect(ledger(sim)).toEqual(initial);
    expect(VoxelSimulation.load(sim.save()).stats.spoiled.meal).toBe(2);
  });
  it.each(['rice', 'potato', 'corn'] as const)(
    'retains %s harvest identity with fresh age while counts aggregate grain',
    (crop) => {
      const sim = fixture((s) => {
        const p = pos(15, 15);
        s.blocks[index(p.x, p.y, 7)] = Block.Soil;
        s.farms.push({ ...p, crop });
        s.crops.push({ ...p, id: s.nextId++, kind: crop, growth: 1, sownAt: 0 });
        s.pawns[0].priorities.grow = 1;
      });
      until(sim, () => sim.stats.harvested === 1);
      expect(sim.items.find((i) => i.resource === 'grain')).toMatchObject({
        amount: CROPS[crop].yield,
        crop,
        rotProgress: 0,
      });
      expect(sim.counts().grain).toBe(CROPS[crop].yield);
      expect(sim.stats.produced.grain).toBe(CROPS[crop].yield);
    },
  );
});

describe('priority storage transfers preserve species and age', () => {
  it('splits by the remaining 30-unit capacity, inherits age, and merges by the transferred amount', () => {
    const sim = fixture((s) => {
      s.pawns[0].priorities.haul = 1;
      s.stockpiles.push(stock(pos(13, 15), 1, ['grain']), stock(pos(19, 15), 3, ['grain']));
      addBatch(s, { ...freshBatch('grain', 50, 'rice'), rotProgress: 100 }, pos(13, 15));
      addBatch(s, { ...freshBatch('grain', 45, 'rice'), rotProgress: 500 }, pos(19, 15));
    });
    until(sim, () => sim.pawns[0].cargo?.amount === 30);
    expect(sim.items.find((i) => at(i) === at(pos(13, 15)))!).toMatchObject({
      amount: 20,
      crop: 'rice',
      rotProgress: 100 + sim.tick,
    });
    expect(sim.pawns[0].cargo).toMatchObject({
      amount: 30,
      crop: 'rice',
      rotProgress: 100 + sim.tick,
    });
    until(sim, () => sim.items.some((i) => at(i) === at(pos(19, 15)) && i.amount === 75));
    expect(sim.items.find((i) => at(i) === at(pos(19, 15)))!.rotProgress).toBeCloseTo(
      (30 * 100 + 45 * 500) / 75 + sim.tick,
      10,
    );
    expect(sim.items.find((i) => at(i) === at(pos(13, 15)))!.amount).toBe(20);
    const hauled = sim.stats.hauled;
    sim.step(200);
    expect(sim.stats.hauled).toBe(hauled);
  });
  it('never combines rice and potatoes and needs separate cells in the same storage region', () => {
    const sim = fixture((s) => {
      s.pawns[0].priorities.haul = 1;
      s.stockpiles.push(stock(pos(19, 15), 3, ['grain']), stock(pos(20, 15), 3, ['grain']));
      addBatch(s, { ...freshBatch('grain', 5, 'rice'), rotProgress: 100 }, pos(13, 15));
      addBatch(s, { ...freshBatch('grain', 7, 'potato'), rotProgress: 500 }, pos(19, 15));
    });
    until(
      sim,
      () =>
        sim.items.length === 2 &&
        sim.pawns.every((p) => !p.cargo) &&
        sim.items.every((i) => i.x >= 19),
    );
    expect(sim.items).toHaveLength(2);
    expect(sim.counts().grain).toBe(12);
    expect(sim.items.find((i) => i.crop === 'rice')!.rotProgress).toBeCloseTo(100 + sim.tick, 10);
    expect(sim.items.find((i) => i.crop === 'potato')!.rotProgress).toBeCloseTo(500 + sim.tick, 10);
  });
  it('moves accepted food to a higher floor using real ladders while leaving rejected wood in lower storage', () => {
    const sim = fixture((s) => {
      carve(s, pos(17, 11, 11), pos(20, 13, 12));
      carve(s, pos(16, 12, 8), pos(16, 12, 12));
      for (let z = 8; z <= 11; z++) s.ladders[index(16, 12, z)] = 1;
      s.stockpiles.push(
        stock(pos(13, 15), 1),
        stock(pos(14, 15), 1),
        stock(pos(19, 12, 11), 3, ['grain', 'meal', 'food']),
      );
      s.pawns[0].priorities.haul = 1;
      addBatch(s, freshBatch('grain', 4, 'corn'), pos(13, 15));
      addBatch(s, freshBatch('wood', 10), pos(14, 15));
    });
    until(sim, () => sim.items.some((i) => i.resource === 'grain' && i.z === 11));
    expect(sim.items.find((i) => i.resource === 'grain')).toMatchObject({
      ...pos(19, 12, 11),
      crop: 'corn',
      amount: 4,
    });
    expect(sim.items.find((i) => i.resource === 'wood')).toMatchObject({
      ...pos(14, 15),
      amount: 10,
    });
    expect(sim.pawns.every((p) => sim.standable(p))).toBe(true);
  });
  it('does not move between equal priorities and evacuates a cell after its accepts rule changes', () => {
    const sim = fixture((s) => {
      s.pawns[0].priorities.haul = 1;
      s.stockpiles.push(stock(pos(13, 15), 1), stock(pos(19, 15), 1));
      addBatch(s, freshBatch('meal', 2), pos(13, 15));
    });
    sim.step(200);
    expect(sim.stats.hauled).toBe(0);
    expect(sim.items[0]).toMatchObject(pos(13, 15));
    command(sim, { type: 'storage', from: pos(13, 15), priority: 1, accepts: [] });
    until(sim, () => sim.items.some((i) => at(i) === at(pos(19, 15))));
    expect(sim.stats.hauled).toBe(2);
    sim.step(200);
    expect(sim.stats.hauled).toBe(2);
  });
  it('updates connected regions or selected boxes atomically without crossing levels', () => {
    const sim = fixture((s) => {
      s.stockpiles.push(stock(pos(13, 15)), stock(pos(14, 15)), stock(pos(19, 15)));
    });
    expect(
      command(sim, {
        type: 'storage',
        from: pos(13, 15),
        connected: true,
        priority: 3,
        accepts: ['meal', 'grain'],
      }).count,
    ).toBe(2);
    expect(sim.stockpiles.map((s) => s.priority)).toEqual([3, 3, 1]);
    expect(
      command(sim, {
        type: 'storage',
        from: pos(14, 15),
        to: pos(19, 15),
        priority: 0,
        accepts: ['wood'],
      }).count,
    ).toBe(2);
    expect(sim.stockpiles.map((s) => s.priority)).toEqual([3, 0, 0]);
    for (const changes of [
      { priority: 4 },
      { accepts: ['meal', 'meal'] },
      { accepts: ['invalid'] },
      { connected: true, to: pos(19, 15) },
      { from: pos(12, 12), connected: true },
    ]) {
      const before = sim.save();
      expect(
        sim.command({
          type: 'storage',
          from: pos(13, 15),
          priority: 1,
          accepts: [],
          ...changes,
        } as VoxelCommand).ok,
      ).toBe(false);
      expect(sim.save()).toEqual(before);
    }
  });
});

describe('cooking input containers and v5 food persistence', () => {
  function kitchen() {
    return fixture((s) => {
      s.stoves.push({ ...pos(15, 15), id: s.nextId++, target: 1, paused: false });
      s.pawns[0].priorities.cook = 1;
      addBatch(s, { ...freshBatch('grain', 6, 'rice'), rotProgress: 100 }, pos(12, 14));
      addBatch(s, { ...freshBatch('grain', 4, 'potato'), rotProgress: 200 }, pos(12, 16));
      addBatch(s, freshBatch('wood', 1), pos(12, 18));
    });
  }
  it('preserves delivered species/age through a save and cancellation, then cooks a fresh meal once', () => {
    const sim = kitchen();
    until(sim, () => sim.jobs.some((j) => j.kind === 'cook' && j.progress > 0));
    const job = sim.jobs.find((j) => j.kind === 'cook')!,
      initial = ledger(sim);
    expect(job.delivered).toEqual({ wood: 1, grain: 10 });
    expect(job.deliveredFood).toHaveLength(2);
    expect(job.deliveredFood.find((i) => i.crop === 'rice')).toMatchObject({
      amount: 6,
      rotProgress: 100 + sim.tick,
    });
    expect(job.deliveredFood.find((i) => i.crop === 'potato')).toMatchObject({
      amount: 4,
      rotProgress: 200 + sim.tick,
    });
    const saved = sim.save(),
      copy = VoxelSimulation.load(saved);
    expect(copy.jobs[0].deliveredFood).toEqual(job.deliveredFood);
    expect(ledger(copy)).toEqual(initial);
    command(copy, { type: 'bill', stoveId: copy.stoves[0].id, target: 1, paused: true });
    expect(copy.jobs).toEqual([]);
    expect(copy.stats.produced.meal).toBe(0);
    expect(ledger(copy)).toEqual(initial);
    expect(copy.items.find((i) => i.crop === 'rice')).toMatchObject({
      amount: 6,
      rotProgress: 100 + sim.tick,
    });
    expect(copy.items.find((i) => i.crop === 'potato')).toMatchObject({
      amount: 4,
      rotProgress: 200 + sim.tick,
    });
    until(sim, () => sim.stats.produced.meal === 1);
    expect(sim.items.find((i) => i.resource === 'meal')).toMatchObject({
      amount: 1,
      rotProgress: 0,
    });
    expect(sim.stats.consumed).toMatchObject({ grain: 10, wood: 1 });
    expect(ledger(sim)).toEqual(initial);
  });
  it('expires delivered ingredients at the stove and cannot finish the meal from vanished inputs', () => {
    const sim = kitchen();
    until(sim, () => sim.jobs.some((j) => j.kind === 'cook' && j.progress > 0));
    const job = sim.jobs.find((j) => j.kind === 'cook')!,
      initial = ledger(sim);
    // Threshold age is the only injected test condition; these inputs were
    // physically hauled into the stove container by the normal job workflow.
    for (const batch of job.deliveredFood) batch.rotProgress = rotLimit(batch)! - 1;
    sim.step();
    expect(job.deliveredFood).toEqual([]);
    expect(job.delivered.grain ?? 0).toBe(0);
    expect(job.delivered.wood).toBe(1);
    expect(job.progress).toBe(0);
    expect(sim.stats.spoiled.grain).toBe(10);
    expect(sim.stats.consumed.grain).toBe(0);
    expect(sim.stats.produced.meal).toBe(0);
    expect(ledger(sim)).toEqual(initial);
    expect(VoxelSimulation.load(sim.save()).jobs[0].deliveredFood).toEqual([]);
  });
  it('strictly rejects v5 inconsistent containers, ages, species, spoiled ledger and storage rules without modifying input', () => {
    const sim = kitchen();
    until(sim, () => sim.jobs.some((j) => j.kind === 'cook' && j.progress > 0));
    command(sim, { type: 'designate', tool: 'stock', from: pos(19, 15) });
    const saved = sim.save();
    const changes: ((s: VoxelSave) => void)[] = [
      (s) => {
        delete s.jobs[0].deliveredFood[0].crop;
      },
      (s) => {
        delete s.jobs[0].deliveredFood[0].rotProgress;
      },
      (s) => {
        s.jobs[0].deliveredFood[0].rotProgress = NaN;
      },
      (s) => {
        s.jobs[0].deliveredFood[0].rotProgress = -1;
      },
      (s) => {
        s.jobs[0].deliveredFood[0].rotProgress = rotLimit(s.jobs[0].deliveredFood[0])!;
      },
      (s) => {
        s.jobs[0].deliveredFood[0].amount++;
      },
      (s) => {
        s.jobs[0].deliveredFood.push({ ...s.jobs[0].deliveredFood[0] });
      },
      (s) => {
        s.jobs[0].deliveredFood = [];
      },
      (s) => {
        s.stats.spoiled.grain = -1;
      },
      (s) => {
        s.stats.spoiled.wood = 1;
      },
      (s) => {
        s.stockpiles[0].priority = 4;
      },
      (s) => {
        s.stockpiles[0].accepts = ['grain', 'grain'];
      },
      (s) => {
        s.pawns[0].cargo = { resource: 'grain', amount: 1 };
      },
      (s) => {
        s.items.push({
          ...pos(19, 15),
          id: s.nextId++,
          resource: 'food',
          amount: 1,
          rotProgress: 0,
        });
      },
    ];
    for (const change of changes) {
      const invalid = structuredClone(saved);
      change(invalid);
      const before = structuredClone(invalid);
      expect(() => VoxelSimulation.load(invalid)).toThrow();
      expect(invalid).toEqual(before);
    }
  });
  it('migrates legacy v4 grain to fresh rice and default storage, while v5 keeps actual metadata', () => {
    const sim = fixture((s) => {
      addBatch(s, { ...freshBatch('grain', 7, 'corn'), rotProgress: 1234 }, pos(15, 15));
      s.pawns[0].cargo = { ...freshBatch('meal', 2), rotProgress: 345 };
      s.stockpiles.push(stock(pos(19, 15), 3, ['grain']));
    });
    const current = sim.save(),
      same = VoxelSimulation.load(current);
    expect(same.items[0]).toMatchObject({ crop: 'corn', rotProgress: 1234 });
    expect(same.pawns[0].cargo).toMatchObject({ rotProgress: 345 });
    expect(same.stockpiles[0].priority).toBe(3);
    const old = structuredClone(current) as unknown as Record<string, any>;
    old.version = 4;
    delete old.items[0].crop;
    delete old.items[0].rotProgress;
    delete old.pawns[0].cargo.rotProgress;
    delete old.stockpiles[0].priority;
    delete old.stockpiles[0].accepts;
    delete old.stats.spoiled;
    const before = structuredClone(old),
      migrated = VoxelSimulation.load(old);
    expect(old).toEqual(before);
    expect(migrated.save().version).toBe(8);
    expect(migrated.counts()).toEqual(sim.counts());
    expect(migrated.items[0]).toMatchObject({ crop: 'rice', rotProgress: 0 });
    expect(migrated.pawns[0].cargo).toMatchObject({ rotProgress: 0 });
    expect(migrated.stockpiles[0]).toMatchObject({
      priority: 1,
      accepts: resources.filter((r) => r !== 'chunk'),
    });
    expect(migrated.stats.spoiled).toEqual({
      wood: 0,
      stone: 0,
      steel: 0,
      components: 0,
      food: 0,
      grain: 0,
      meal: 0,
      chunk: 0,
    });
  });
});
