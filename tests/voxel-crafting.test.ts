import { legacySimulation } from './fixtures/legacy-start';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { initialTrade } from '../src/voxel/trade';
import { initialFireHazards } from '../src/voxel/fire';
import { initialWeather } from '../src/voxel/weather';
import {
  STONECUTTER_COST,
  STONECUTTER_WORK,
  STONECUTTING,
  STONE_CONSTRUCTION,
  naturalChunkDrop,
} from '../src/voxel/crafting';
import { stackLimit, carryLimit, STACK_LIMITS } from '../src/voxel/logistics';
import { freshBatch } from '../src/voxel/preservation';
import {
  Block,
  DAY,
  at,
  index,
  stonecutterCells,
  stonecutterInteraction,
  type Axis,
  type Counts,
  type Pos,
  type Resource,
  type Stonecutter,
  type VoxelCommand,
  type VoxelSave,
} from '../src/voxel/types';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
const resources = Object.keys(STACK_LIMITS) as Resource[];
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c);
  expect(result.ok, result.message).toBe(true);
  return result;
}
function carve(s: VoxelSimulation, from: Pos, to = { ...from, z: from.z + 1 }) {
  for (let z = from.z; z <= to.z; z++)
    for (let y = from.y; y <= to.y; y++)
      for (let x = from.x; x <= to.x; x++) s.blocks[index(x, y, z)] = Block.Air;
}
function add(s: VoxelSimulation, p: Pos, resource: Resource, amount: number) {
  const item = { ...freshBatch(resource, amount), x: p.x, y: p.y, z: p.z, id: s.nextId++ };
  s.items.push(item);
  return item;
}
function bench(s: VoxelSimulation, p = pos(14, 13), axis: Axis = 'x', target = 20): Stonecutter {
  const b = { ...p, id: s.nextId++, axis, target, paused: false };
  s.stonecutters.push(b);
  return b;
}
/** Explicit isolated geometry/resource fixtures, never presented as normal
 * gathering evidence. Operations after load use real commands and simulation. */
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
  s.stonecutters = [];
  s.devices = [];
  s.wires = [];
  carve(s, pos(10, 10), pos(22, 18, 9));
  s.pawns.forEach((p, n) => {
    Object.assign(p, pos(10 + n, 18));
    p.priorities = {
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
  });
  setup(s);
  s.trade = initialTrade(s.seed, s.tick);
  s.fireHazards = initialFireHazards(s.seed, s.tick);
  s.weather = initialWeather(s.seed, s.settings, s.tick, s.generator);
  return VoxelSimulation.load(s.save());
}
function ledger(s: VoxelSimulation): Counts {
  const out = s.counts();
  for (const r of resources)
    out[r] += s.stats.consumed[r] + s.stats.spoiled[r] - s.stats.produced[r];
  return out;
}
function invariant(s: VoxelSimulation) {
  expect(new Set(s.items.map(at)).size).toBe(s.items.length);
  for (const item of s.items) {
    expect(item.amount).toBeGreaterThan(0);
    expect(item.amount).toBeLessThanOrEqual(stackLimit(item.resource));
    expect(
      Object.keys(item).every((k) =>
        ['id', 'x', 'y', 'z', 'resource', 'amount', 'crop', 'rotProgress'].includes(k),
      ),
    ).toBe(true);
  }
  for (const p of s.pawns)
    if (p.cargo) expect(p.cargo.amount).toBeLessThanOrEqual(carryLimit(p.cargo.resource));
  const owned = s.jobs.flatMap((j) => (j.owner === null ? [] : [j.owner]));
  expect(new Set(owned).size).toBe(owned.length);
}
function until(s: VoxelSimulation, done: () => boolean, limit = 3000) {
  const initial = ledger(s);
  for (let n = 0; !done() && n < limit; n++) {
    s.step();
    invariant(s);
    expect(ledger(s)).toEqual(initial);
  }
  expect(
    done(),
    JSON.stringify({
      tick: s.tick,
      jobs: s.jobs,
      pawns: s.pawns.map((p) => ({ cargo: p.cargo, reason: p.reason })),
    }),
  ).toBe(true);
}
function seedFor(p: Pos, drops: number) {
  for (let seed = 0; seed < 10000; seed++)
    if (naturalChunkDrop(seed, p) + naturalChunkDrop(seed, { ...p, z: p.z + 1 }) === drops)
      return seed;
  throw new Error('No deterministic fixture seed');
}
function supplied(axis: Axis = 'x') {
  return fixture((s) => {
    bench(s, pos(14, 13), axis);
    add(s, pos(11, 15), 'chunk', 1);
    s.pawns[0].priorities.craft = 1;
  });
}

describe('natural rock and a real stone processing chain', () => {
  it.each([0, 1, 2])(
    'checks each natural voxel independently and produces exactly %i physical chunks',
    (drops) => {
      const target = pos(23, 12),
        seed = seedFor(target, drops);
      const s = fixture((s) => {
        s.seed = seed;
        s.pawns[0].priorities.dig = 1;
      });
      command(s, { type: 'designate', tool: 'mine', from: target });
      const saved = s.save(),
        restored = VoxelSimulation.load(saved);
      until(s, () => !s.jobs.length);
      until(restored, () => !restored.jobs.length);
      expect(s.stats.produced.chunk).toBe(drops);
      expect(s.stats.produced.stone).toBe(0);
      expect(s.items.filter((i) => i.resource === 'chunk')).toHaveLength(drops);
      expect(restored.items).toEqual(s.items);
      expect(s.stats.mined).toBe(2);
    },
  );
  it.each(['x', 'y'] as const)(
    'builds the %s-oriented three-cell bench from physically delivered wood and steel',
    (axis) => {
      const s = fixture((s) => {
        add(s, pos(10, 11), 'wood', 75);
        add(s, pos(10, 12), 'steel', 30);
        s.pawns[0].priorities.build = 1;
      });
      command(s, { type: 'designate', tool: 'stonecutter', from: pos(14, 13), axis });
      expect(s.jobs[0]).toMatchObject({ cost: STONECUTTER_COST, work: STONECUTTER_WORK });
      until(s, () => s.stonecutters.length === 1);
      expect(s.stats.consumed).toMatchObject({ wood: 75, steel: 30 });
      const b = s.stonecutters[0];
      expect(stonecutterCells(b)).toHaveLength(3);
      expect(stonecutterCells(b).every((p) => !s.standable(p))).toBe(true);
      expect(s.standable(stonecutterInteraction(b))).toBe(true);
      expect(VoxelSimulation.load(s.save()).stonecutters).toEqual(s.stonecutters);
    },
  );
  it('mines, carries, cuts and uses actual stone output for a two-high wall and elevated floor', () => {
    const mining = pos(23, 12);
    const s = fixture((s) => {
      s.seed = seedFor(mining, 1);
      add(s, pos(10, 11), 'wood', 75);
      add(s, pos(10, 12), 'wood', 15);
      add(s, pos(10, 13), 'steel', 30);
      carve(s, pos(18, 15, 10), pos(19, 15, 12));
      Object.assign(s.pawns[0].priorities, { build: 1, dig: 1, craft: 1 });
    });
    command(s, { type: 'designate', tool: 'stonecutter', from: pos(14, 13) });
    until(s, () => s.stonecutters.length === 1);
    command(s, {
      type: 'stoneBill',
      stonecutterId: s.stonecutters[0].id,
      target: 20,
      paused: false,
    });
    command(s, { type: 'designate', tool: 'mine', from: mining });
    until(s, () => s.stats.stonecut === 1, 4500);
    expect(s.stats.produced.chunk).toBe(1);
    expect(s.stats.consumed.chunk).toBe(1);
    expect(s.counts().stone).toBe(20);
    command(s, {
      type: 'stoneBill',
      stonecutterId: s.stonecutters[0].id,
      target: 20,
      paused: true,
    });
    command(s, { type: 'designate', tool: 'wall', from: pos(20, 16), material: 'stone' });
    expect(s.jobs[0]).toMatchObject({ cost: { stone: 10 }, work: 634, material: 'stone' });
    until(s, () => !s.jobs.length);
    expect(s.blocks[at(pos(20, 16))]).toBe(Block.Masonry);
    expect(s.blocks[at(pos(20, 16, 9))]).toBe(Block.Masonry);
    command(s, { type: 'designate', tool: 'up', from: pos(18, 15) });
    until(s, () => !s.jobs.length);
    command(s, { type: 'designate', tool: 'floor', from: pos(19, 15, 11), material: 'stone' });
    expect(s.jobs[0]).toMatchObject({ cost: { stone: 4 }, work: 367 });
    until(s, () => !s.jobs.length);
    expect(s.blocks[at(pos(19, 15, 10))]).toBe(Block.Masonry);
    expect(s.counts().stone).toBe(6);
    const worker = s.pawns[0];
    command(s, { type: 'move', pawnId: worker.id, target: pos(19, 15, 11) });
    until(s, () => at(worker) === at(pos(19, 15, 11)) && worker.phase === 'idle');
    expect(VoxelSimulation.load(s.save()).blocks).toEqual(s.blocks);
    command(s, { type: 'move', pawnId: worker.id, target: pos(18, 15, 11) });
    until(s, () => at(worker) === at(pos(18, 15, 11)) && worker.phase === 'idle');
    const wood = s.counts().wood;
    command(s, { type: 'designate', tool: 'remove', from: pos(19, 15, 11) });
    until(s, () => !s.jobs.length);
    expect(s.blocks[at(pos(19, 15, 10))]).toBe(Block.Air);
    expect(s.counts().stone).toBe(8);
    expect(s.counts().wood).toBe(wood);
  });
  it.each(['x', 'y'] as const)(
    'runs %s cutting only at its actual front work cell and consumes one chunk once',
    (axis) => {
      const s = supplied(axis),
        b = s.stonecutters[0];
      until(s, () => !!s.pawns[0].cargo);
      expect(s.pawns[0].cargo).toEqual({ resource: 'chunk', amount: 1 });
      until(s, () => s.jobs[0]?.progress === 1);
      expect(at(s.pawns[0])).toBe(at(stonecutterInteraction(b)));
      expect(s.jobs[0].delivered).toEqual({ chunk: 1 });
      expect(s.stats.consumed.chunk).toBe(0);
      const start = s.tick;
      until(s, () => s.stats.stonecut === 1);
      expect(s.tick - start).toBe(STONECUTTING.work - 1);
      expect(s.stats.produced.stone).toBe(20);
      expect(s.stats.consumed.chunk).toBe(1);
      s.step(100);
      expect(s.stats.stonecut).toBe(1);
      expect(s.jobs).toEqual([]);
    },
  );
});

describe('stone bills, interrupted jobs and bounded output', () => {
  it.each([0, 40])(
    'preserves the current batch when its target changes to %i, then reevaluates the next batch',
    (target) => {
      const s = supplied(),
        b = s.stonecutters[0];
      add(s, pos(11, 16), 'chunk', 1);
      until(s, () => (s.jobs[0]?.progress ?? 0) > 100);
      const job = structuredClone(s.jobs[0]),
        initial = ledger(s);
      command(s, { type: 'stoneBill', stonecutterId: b.id, target, paused: false });
      expect(s.jobs[0]).toEqual(job);
      expect(ledger(s)).toEqual(initial);
      until(s, () => s.stats.stonecut === (target === 0 ? 1 : 2));
      s.step(100);
      expect(s.stats.consumed.chunk).toBe(target === 0 ? 1 : 2);
      expect(s.counts().stone).toBe(target === 0 ? 20 : 40);
      expect(s.jobs).toEqual([]);
      expect(s.counts().chunk).toBe(target === 0 ? 1 : 0);
    },
  );
  it('waits when only the front interaction cell is blocked and resumes after a real mining job', () => {
    const s = fixture((s) => {
      const b = bench(s);
      const work = stonecutterInteraction(b);
      s.blocks[at(work)] = Block.Stone;
      s.blocks[at({ ...work, z: work.z + 1 })] = Block.Stone;
      add(s, pos(11, 15), 'chunk', 1);
      Object.assign(s.pawns[0].priorities, { craft: 1, dig: 1 });
    });
    s.step(100);
    expect(s.jobs.find((j) => j.kind === 'stonecut')!.progress).toBe(0);
    expect(s.stats.stonecut).toBe(0);
    command(s, {
      type: 'designate',
      tool: 'mine',
      from: stonecutterInteraction(s.stonecutters[0]),
    });
    until(s, () => s.stats.stonecut === 1);
  });
  it.each(['carried', 'delivered'] as const)(
    'pauses %s raw material, refunds exactly once and restarts a fresh recipe',
    (phase) => {
      const s = supplied(),
        b = s.stonecutters[0];
      until(s, () => (phase === 'carried' ? !!s.pawns[0].cargo : (s.jobs[0]?.progress ?? 0) > 20));
      const initial = ledger(s),
        old = s.jobs[0].id;
      command(s, { type: 'stoneBill', stonecutterId: b.id, target: 20, paused: true });
      expect(s.jobs.some((j) => j.id === old)).toBe(false);
      expect(s.stats.stonecut).toBe(0);
      expect(ledger(s)).toEqual(initial);
      command(s, { type: 'stoneBill', stonecutterId: b.id, target: 20, paused: false });
      expect(s.jobs[0].progress).toBe(0);
      until(s, () => s.stats.stonecut === 1);
      expect(s.stats.consumed.chunk).toBe(1);
      expect(s.counts().stone).toBe(20);
    },
  );
  it.each(['carried', 'delivered'] as const)(
    'preserves %s inputs and existing recipe progress across a v7 save',
    (phase) => {
      let s = supplied();
      until(s, () => (phase === 'carried' ? !!s.pawns[0].cargo : (s.jobs[0]?.progress ?? 0) > 100));
      const before = s.counts(),
        saved = s.save(),
        progress = s.jobs[0].progress;
      s = VoxelSimulation.load(saved);
      expect(s.jobs[0].progress).toBe(progress);
      expect(s.counts()).toEqual(before);
      until(s, () => s.stats.stonecut === 1);
      expect(s.stats.consumed.chunk).toBe(1);
      expect(s.stats.produced.stone).toBe(20);
    },
  );
  it('uses one shared target across two benches and does not duplicate one raw chunk under competing workers', () => {
    const s = fixture((s) => {
      bench(s, pos(14, 12), 'x', 20);
      bench(s, pos(18, 14), 'y', 20);
      add(s, pos(11, 15), 'chunk', 1);
      s.pawns.forEach((p) => {
        p.priorities.craft = 1;
        p.priorities.haul = 1;
      });
      s.stockpiles.push({ ...pos(20, 18), priority: 3, accepts: ['chunk'] });
    });
    until(s, () => s.jobs.some((j) => j.kind === 'stonecut'));
    expect(s.jobs.filter((j) => j.kind === 'stonecut')).toHaveLength(1);
    until(s, () => s.stats.stonecut === 1);
    s.step(100);
    expect(s.stats.consumed.chunk).toBe(1);
    expect(s.stats.produced.stone).toBe(20);
    expect(s.jobs).toEqual([]);
  });
  it.each(['finish', 'pause'] as const)(
    'retains bounded ingredients on full output and safely retries %s after local space opens',
    (action) => {
      const s = fixture((s) => {
        const b = bench(s, pos(14, 13), 'x', 90),
          work = stonecutterInteraction(b),
          body = new Set(stonecutterCells(b).map(at));
        for (let y = 10; y <= 17; y++)
          for (let x = 10; x <= 18; x++) {
            const p = pos(x, y);
            // Fill the bounded output radius and the separate adjacent refund origin.
            if (
              (Math.abs(x - work.x) + Math.abs(y - work.y) > 3 &&
                Math.abs(x - 13) + Math.abs(y - 13) > 3) ||
              body.has(at(p))
            )
              continue;
            if (x === 13 && y === 13) {
              const item = add(s, p, 'meal', 10);
              item.rotProgress = 4 * DAY - 1000;
            } else
              add(s, p, x === 14 && y === 14 ? 'stone' : 'steel', x === 14 && y === 14 ? 70 : 75);
          }
        add(s, pos(10, 18), 'chunk', 1);
        s.pawns[0].priorities.craft = 1;
      });
      until(s, () =>
        s.jobs.some((j) => j.progress === j.work && j.reason.includes('附近可达落地空间')),
      );
      expect(s.stats.consumed.chunk).toBe(0);
      expect(s.jobs[0].delivered).toEqual({ chunk: 1 });
      expect(s.counts().stone).toBe(70);
      expect(VoxelSimulation.load(s.save()).jobs[0].progress).toBe(STONECUTTING.work);
      if (action === 'pause') {
        command(s, {
          type: 'stoneBill',
          stonecutterId: s.stonecutters[0].id,
          target: 90,
          paused: true,
        });
        expect(s.jobs[0].cancelled).toBe(true);
        expect(s.jobs[0].delivered).toEqual({ chunk: 1 });
        expect(VoxelSimulation.load(s.save()).jobs[0].cancelled).toBe(true);
      }
      until(s, () => (action === 'pause' ? !s.jobs.length : s.stats.stonecut === 1), 1300);
      expect(s.stats.spoiled.meal).toBe(10);
      expect(s.counts().stone).toBe(action === 'pause' ? 70 : 90);
      expect(s.stats.consumed.chunk).toBe(action === 'pause' ? 0 : 1);
      expect(s.counts().chunk).toBe(action === 'pause' ? 1 : 0);
      s.step(100);
      expect(s.stats.stonecut).toBe(action === 'pause' ? 0 : 1);
    },
  );
  it('does not reroll a two-chunk excavation after blocked output or save/load', () => {
    const target = pos(13, 11),
      s = fixture((s) => {
        s.seed = seedFor(target, 2);
        s.blocks.fill(Block.Stone);
        carve(s, pos(10, 10), pos(12, 12, 9));
        s.pawns.forEach((p, n) => Object.assign(p, pos(10 + n, 10)));
        for (let y = 10; y <= 12; y++)
          for (let x = 10; x <= 12; x++) {
            const item = add(
              s,
              pos(x, y),
              x === 12 && y === 12 ? 'meal' : 'steel',
              x === 12 && y === 12 ? 10 : 75,
            );
            if (item.resource === 'meal') item.rotProgress = 4 * DAY - 300;
          }
        s.pawns[0].priorities.dig = 1;
      });
    command(s, { type: 'designate', tool: 'mine', from: target });
    until(s, () =>
      s.jobs.some((j) => j.progress === j.work && j.reason.includes('附近可达落地空间')),
    );
    expect(s.stats.produced.chunk).toBe(0);
    expect(s.blocks[at(target)]).toBe(Block.Stone);
    const resumed = VoxelSimulation.load(s.save());
    until(s, () => s.stats.mined === 2);
    until(resumed, () => resumed.stats.mined === 2);
    expect(s.stats.produced.chunk).toBe(2);
    expect(resumed.stats.produced.chunk).toBe(2);
    expect(resumed.items).toEqual(s.items);
  });
});

describe('masonry recovery and v7 validation', () => {
  it.each(['floor', 'head', 'far'] as const)(
    'checks the far bench cell for physical %s support and clearance in commands and saves',
    (condition) => {
      const s = fixture((s) => {
        s.blocks[at(pos(16, 13, condition === 'floor' ? 7 : condition === 'head' ? 9 : 8))] =
          condition === 'floor' ? Block.Air : Block.Stone;
      });
      const before = s.save();
      expect(s.command({ type: 'designate', tool: 'stonecutter', from: pos(14, 13) }).ok).toBe(
        false,
      );
      expect(s.save()).toEqual(before);
      bench(s);
      const malformed = s.save(),
        original = structuredClone(malformed);
      expect(() => VoxelSimulation.load(malformed)).toThrow();
      expect(malformed).toEqual(original);
    },
  );
  it('requires processed bricks, cannot use raw chunks or wood, and returns bricks from demolition', () => {
    const s = fixture((s) => {
      add(s, pos(10, 11), 'chunk', 1);
      add(s, pos(10, 12), 'wood', 75);
      s.pawns[0].priorities.build = 1;
    });
    command(s, { type: 'designate', tool: 'wall', from: pos(20, 16), material: 'stone' });
    s.step(100);
    expect(s.jobs[0].progress).toBe(0);
    expect(s.stats.consumed.chunk).toBe(0);
    expect(s.stats.consumed.wood).toBe(0);
    // Supply a finite test batch through fixture injection; the complete chain is tested above.
    add(s, pos(11, 12), 'stone', 10);
    until(s, () => !s.jobs.length);
    const stone = s.counts().stone,
      wood = s.counts().wood;
    expect(s.command({ type: 'designate', tool: 'mine', from: pos(20, 16) }).ok).toBe(false);
    command(s, { type: 'designate', tool: 'remove', from: pos(20, 16) });
    until(s, () => !s.jobs.length);
    expect(s.counts().stone - stone).toBe(STONE_CONSTRUCTION.wall.refund);
    expect(s.counts().wood).toBe(wood);
    expect(s.stats.produced.chunk).toBe(0);
    expect(s.blocks[at(pos(20, 16))]).toBe(Block.Air);
  });
  it('demolishes a bench from its far footprint cell and refunds construction plus any delivered chunk once', () => {
    const s = supplied();
    s.pawns[0].priorities.build = 1;
    until(s, () => (s.jobs[0]?.progress ?? 0) > 10);
    const before = s.counts();
    command(s, { type: 'designate', tool: 'remove', from: pos(16, 13) });
    until(s, () => s.stonecutters.length === 0);
    expect(s.counts().chunk).toBe(before.chunk);
    expect(s.stats.consumed.chunk).toBe(0);
    expect(s.stats.produced).toMatchObject({ wood: 37, steel: 15, stone: 0 });
    expect(VoxelSimulation.load(s.save()).stonecutters).toEqual([]);
  });
  it('migrates the genuine v6 fixture without converting its existing 15 usable bricks back into raw chunks', () => {
    const text = readFileSync(
      new URL('./fixtures/voxel-v6-logistics.json', import.meta.url),
      'utf8',
    );
    const raw = JSON.parse(text),
      before = structuredClone(raw),
      s = VoxelSimulation.load(raw);
    expect(raw.version).toBe(6);
    expect(raw).toEqual(before);
    expect(s.save().version).toBe(58);
    expect(s.counts().stone).toBe(15);
    expect(s.counts().chunk).toBe(0);
    expect(s.stats.stonecut).toBe(0);
    expect(s.stonecutters).toEqual([]);
    expect(s.pawns.every((p) => p.priorities.craft === 1)).toBe(true);
    expect(s.stockpiles.map((p) => p.accepts)).toEqual(
      raw.stockpiles.map((p: { accepts: Resource[] }) => p.accepts),
    );
    expect(s.stockpiles.every((p) => !p.accepts.includes('chunk'))).toBe(true);
  });
  it('rejects invalid bills, footprints, material choices and v7 physical inputs atomically', () => {
    const s = supplied(),
      b = s.stonecutters[0];
    command(s, { type: 'designate', tool: 'wall', from: pos(20, 16), material: 'stone' });
    const commands: unknown[] = [
      { type: 'stoneBill', stonecutterId: b.id, target: -1, paused: false },
      { type: 'stoneBill', stonecutterId: b.id, target: 2001, paused: false },
      { type: 'stoneBill', stonecutterId: b.id, target: 1.5, paused: false },
      { type: 'stoneBill', stonecutterId: b.id, target: 20, paused: 'false' },
      { type: 'designate', tool: 'stonecutter', from: pos(22, 14) },
      { type: 'designate', tool: 'stonecutter', from: pos(18, 12), to: pos(19, 12) },
      { type: 'designate', tool: 'wall', from: pos(18, 16), material: 'chunk' },
      { type: 'designate', tool: 'ladder', from: pos(18, 16), material: 'stone' },
      { type: 'designate', tool: 'stonecutter', from: pos(15, 13) },
    ];
    for (const c of commands) {
      const before = s.save();
      expect(s.command(c as VoxelCommand).ok).toBe(false);
      expect(s.save()).toEqual(before);
    }
    const saved = s.save();
    const mutations: ((d: VoxelSave) => void)[] = [
      (d) => {
        d.stonecutters[0].target = 2001;
      },
      (d) => {
        d.stonecutters[0].axis = 'z' as Axis;
      },
      (d) => {
        d.stonecutters.push({ ...d.stonecutters[0], x: 15, id: d.nextId++ });
      },
      (d) => {
        d.items.find((i) => i.resource === 'chunk')!.amount = 2;
      },
      (d) => {
        d.pawns[0].cargo = freshBatch('chunk', 2);
      },
      (d) => {
        d.jobs.find((j) => j.kind === 'wall')!.material = 'wood';
      },
      (d) => {
        d.jobs.find((j) => j.kind === 'wall')!.work = 80;
      },
      (d) => {
        d.stats.stonecut = 0.5;
      },
      (d) => {
        (d.pawns[0].priorities as unknown as Record<string, unknown>).craft = undefined;
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
