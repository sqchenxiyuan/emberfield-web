import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, CELLS, CHUNK, DEPTH, HEIGHT, WIDTH, at, index, position } from '../src/voxel/types';
import type {
  Counts,
  Pos,
  Resource,
  Tool,
  VoxelCommand,
  VoxelSave,
  Work,
} from '../src/voxel/types';

const pos = (x: number, y: number, z: number): Pos => ({ x, y, z });
const resources: Resource[] = ['wood', 'stone', 'steel', 'components', 'food', 'grain', 'meal'];
const works: Work[] = ['dig', 'build', 'cut', 'haul', 'grow', 'cook'];
const place = (s: VoxelSimulation, tool: Tool, from: Pos, to?: Pos) => {
  const result = s.command({ type: 'designate', tool, from, to });
  expect(result.ok, result.message).toBe(true);
  return result;
};
function conserved(s: VoxelSimulation, initial: Counts) {
  const counts = s.counts();
  for (const r of resources) {
    if (counts[r] + s.stats.consumed[r] !== initial[r] + s.stats.produced[r])
      throw new Error(`${r} conservation failed at tick ${s.tick}`);
  }
  if (s.items.some((i) => i.amount <= 0) || s.pawns.some((p) => p.cargo && p.cargo.amount <= 0))
    throw new Error(`Non-positive physical material at tick ${s.tick}`);
  if (s.pawns.some((p) => !s.standable(p))) throw new Error(`Unsupported pawn at tick ${s.tick}`);
  const owners = s.jobs.flatMap((j) => (j.owner === null ? [] : [j.owner]));
  if (owners.length !== new Set(owners).size)
    throw new Error(`Worker owns competing jobs at tick ${s.tick}`);
}
function until(s: VoxelSimulation, condition: () => boolean, limit = 4000, audit?: () => void) {
  for (let n = 0; !condition() && n < limit; n++) {
    s.step();
    audit?.();
  }
  expect(condition(), JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns })).toBe(true);
}
function solo(s: VoxelSimulation) {
  for (const p of s.pawns)
    for (const work of works)
      expect(
        s.command({ type: 'priority', pawnId: p.id, work, value: p === s.pawns[0] ? 1 : 0 }).ok,
      ).toBe(true);
}
function enclosedFixture() {
  const s = new VoxelSimulation();
  // Isolated geometry fixture. Campaign scripts never alter physical state directly.
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  const clear = (p: Pos) => {
    s.blocks[at(p)] = Block.Air;
    s.blocks[index(p.x, p.y, p.z + 1)] = Block.Air;
  };
  return { s, clear };
}

describe('voxel generation and chunk delivery', () => {
  it('generates a deterministic finite world with usable starting resources', () => {
    const a = new VoxelSimulation(73129),
      b = new VoxelSimulation(73129),
      c = new VoxelSimulation(2718);
    expect(a.save()).toEqual(b.save());
    expect(a.blocks).not.toEqual(c.blocks);
    expect(a.blocks).toHaveLength(CELLS);
    expect(a.pawns.every((p) => p.z === 8 && a.standable(p))).toBe(true);
    expect(a.counts()).toEqual({
      wood: 90,
      stone: 0,
      steel: 0,
      components: 0,
      food: 60,
      grain: 0,
      meal: 0,
    });
    expect(a.blocks[index(34, 32, 5)]).toBe(Block.Steel);
    expect(a.trees.find((t) => t.x === 27 && t.y === 29 && t.z === 8)?.wood).toBe(27);
    expect(new Set(a.trees.map((t) => at(t))).size).toBe(a.trees.length);
    expect(position(CELLS - 1)).toEqual(pos(WIDTH - 1, DEPTH - 1, HEIGHT - 1));
  });
  it('delivers independent full-height chunks once and invalidates neighboring mesh seams', () => {
    const s = new VoxelSimulation(),
      chunks = s.chunks();
    expect(chunks).toHaveLength(16);
    expect(s.chunks()).toEqual([]);
    for (const c of chunks) {
      expect(c.blocks).toHaveLength(CHUNK ** 3);
      expect(c.ladders).toHaveLength(CHUNK ** 3);
      const ox = (c.id % 4) * CHUNK,
        oy = Math.floor(c.id / 4) * CHUNK;
      for (const z of [0, 7, 8, 15])
        for (const y of [0, 15])
          for (const x of [0, 15])
            expect(c.blocks[(z * CHUNK + y) * CHUNK + x]).toBe(s.blocks[index(ox + x, oy + y, z)]);
    }
    chunks[0].blocks.fill(255);
    chunks[0].ladders.fill(255);
    expect(s.blocks[0]).toBe(Block.Bedrock);
    expect(s.ladders[0]).toBe(0);
    place(s, 'wall', pos(31, 32, 8));
    until(s, () => !s.jobs.length);
    expect(
      s
        .chunks()
        .map((c) => c.id)
        .sort((a, b) => a - b),
    ).toEqual([5, 9, 10]);
    expect(s.chunks()).toEqual([]);
  });
});

describe('physical clearance and layer paths', () => {
  it('requires feet/head clearance and either solid support or an actual ladder', () => {
    const { s, clear } = enclosedFixture(),
      p = pos(32, 32, 8);
    expect(s.standable(p)).toBe(false);
    clear(p);
    expect(s.standable(p)).toBe(true);
    s.blocks[index(32, 32, 7)] = Block.Air;
    expect(s.standable(p)).toBe(false);
    s.ladders[at(p)] = 1;
    expect(s.standable(p)).toBe(true);
    s.blocks[index(32, 32, 9)] = Block.Wood;
    expect(s.standable(p)).toBe(false);
    expect(s.standable(pos(32, 32, 15))).toBe(false);
    expect(s.standable(pos(-1, 32, 8))).toBe(false);
  });
  it('supports one-block stairs only with clearance and never crosses a diagonal corner', () => {
    const { s, clear } = enclosedFixture(),
      from = pos(32, 32, 8),
      up = pos(33, 32, 9);
    clear(from);
    clear(up);
    s.blocks[index(32, 32, 10)] = Block.Air;
    expect(s.path(from, up)).toEqual([at(up)]);
    expect(s.path(up, from)).toEqual([at(from)]);
    s.blocks[index(32, 32, 10)] = Block.Stone;
    expect(s.path(from, up)).toBeNull();
    expect(s.path(up, from)).toBeNull();
    const diagonal = pos(31, 31, 8);
    clear(diagonal);
    expect(s.path(from, diagonal)).toBeNull();
  });
  it('requires both ladder endpoints for vertical travel and rejects invalid path origins', () => {
    const { s, clear } = enclosedFixture(),
      from = pos(32, 32, 8),
      to = pos(32, 32, 9);
    clear(from);
    clear(to);
    s.ladders[at(from)] = 1;
    s.ladders[at(to)] = 1;
    expect(s.path(from, to)).toEqual([at(to)]);
    s.ladders[at(to)] = 0;
    expect(s.path(from, to)).toBeNull();
    const solid = pos(31, 32, 8);
    expect(s.path(solid, solid)).toBeNull();
    expect(s.path(solid, from)).toBeNull();
    expect(s.path(pos(-1, 32, 8), from)).toBeNull();
  });
});

describe('material ownership, cancellation and recovery', () => {
  it.each(['carried', 'delivered'] as const)(
    'refunds a cancelled wall with %s materials without duplication',
    (phase) => {
      const s = new VoxelSimulation(),
        initial = s.counts(),
        target = pos(36, 34, 8);
      solo(s);
      place(s, 'wall', target);
      until(
        s,
        () =>
          phase === 'carried'
            ? s.pawns.some((p) => p.cargo?.resource === 'wood')
            : s.jobs[0].delivered.wood === 6,
        1000,
        () => conserved(s, initial),
      );
      const before = s.counts();
      place(s, 'cancel', target);
      expect(s.counts()).toEqual(before);
      expect(s.jobs).toHaveLength(0);
      expect(s.blocks[at(target)]).toBe(Block.Air);
      expect(s.stats.consumed.wood).toBe(0);
      until(
        s,
        () => s.snapshot().stored.wood === initial.wood && s.pawns.every((p) => !p.cargo),
        1000,
        () => conserved(s, initial),
      );
    },
  );
  it('makes three workers compete for eight pieces of wood without negative or duplicated stock', () => {
    const s = new VoxelSimulation();
    s.items.find((i) => i.resource === 'wood')!.amount = 8;
    const initial = s.counts();
    for (const y of [33, 34, 35]) place(s, 'wall', pos(36, y, 8));
    until(
      s,
      () => s.stats.built === 1,
      1600,
      () => conserved(s, initial),
    );
    for (let n = 0; n < 160; n++) {
      s.step();
      conserved(s, initial);
    }
    expect(s.stats.built).toBe(1);
    expect(s.stats.consumed.wood).toBe(6);
    expect(s.counts().wood).toBe(2);
    expect(s.jobs).toHaveLength(2);
    expect(s.jobs.reduce((n, j) => n + (j.delivered.wood ?? 0), 0)).toBe(2);
    expect(s.jobs.some((j) => /木材/.test(j.reason))).toBe(true);
  });
  it('retains cargo when a ladder breaks, waits for a route, and resumes after repair', () => {
    const s = new VoxelSimulation(),
      initial = s.counts();
    solo(s);
    place(s, 'up', pos(33, 32, 8));
    until(
      s,
      () => !s.jobs.length,
      2000,
      () => conserved(s, initial),
    );
    const p = s.pawns[0];
    expect(s.command({ type: 'move', pawnId: p.id, target: pos(31, 34, 8) }).ok).toBe(true);
    until(s, () => p.z === 8 && p.phase === 'idle');
    place(s, 'floor', pos(34, 32, 11));
    until(
      s,
      () => !!p.cargo && p.z === 9,
      1000,
      () => conserved(s, initial),
    );
    const before = s.counts(),
      cargo = { ...p.cargo! };
    // Fault injection only: break a future step, never the occupied support.
    s.ladders[index(33, 32, 10)] = 0;
    until(
      s,
      () => /通路改变/.test(p.reason),
      10,
      () => conserved(s, initial),
    );
    expect(p.cargo).toEqual(cargo);
    expect(s.counts()).toEqual(before);
    for (let n = 0; n < 60; n++) {
      s.step();
      conserved(s, initial);
      expect(p.z).toBeLessThanOrEqual(9);
    }
    expect(s.blocks[index(34, 32, 10)]).toBe(Block.Air);
    s.ladders[index(33, 32, 10)] = 1;
    until(
      s,
      () => !s.jobs.length,
      1600,
      () => conserved(s, initial),
    );
    expect(s.blocks[index(34, 32, 10)]).toBe(Block.Wood);
    expect(s.stats.consumed.wood).toBe(11);
  });
  it('postpones removal of an occupied support and finishes after the occupant moves', () => {
    const s = new VoxelSimulation(),
      initial = s.counts(),
      occupant = s.pawns[1];
    solo(s);
    s.blocks[index(occupant.x, occupant.y, occupant.z - 1)] = Block.Wood;
    const target = pos(occupant.x, occupant.y, occupant.z);
    place(s, 'remove', target);
    until(
      s,
      () => s.jobs.some((j) => /有人占用/.test(j.reason)),
      1000,
      () => conserved(s, initial),
    );
    expect(s.blocks[index(target.x, target.y, target.z - 1)]).toBe(Block.Wood);
    expect(s.stats.produced.wood).toBe(0);
    expect(s.command({ type: 'move', pawnId: occupant.id, target: pos(32, 35, 8) }).ok).toBe(true);
    until(
      s,
      () => !s.jobs.length,
      1000,
      () => conserved(s, initial),
    );
    expect(s.blocks[index(target.x, target.y, target.z - 1)]).toBe(Block.Air);
    expect(s.stats.produced.wood).toBe(1);
  });
});

describe('voxel persistence and input validation', () => {
  it.each(['carried', 'delivered'] as const)(
    'loads %s materials and completes exactly once with rebuilt assignments',
    (phase) => {
      let s = new VoxelSimulation();
      const initial = s.counts(),
        target = pos(36, 34, 8);
      solo(s);
      place(s, 'wall', target);
      until(
        s,
        () => (phase === 'carried' ? s.pawns.some((p) => !!p.cargo) : s.jobs[0].progress >= 12),
        1000,
        () => conserved(s, initial),
      );
      const save = s.save(),
        counts = s.counts(),
        delivered = s.jobs[0].delivered,
        progress = s.jobs[0].progress;
      s = VoxelSimulation.load(JSON.parse(JSON.stringify(save)));
      expect(s.counts()).toEqual(counts);
      expect(s.jobs[0].delivered).toEqual(delivered);
      expect(s.jobs[0].progress).toBe(progress);
      expect(s.pawns.every((p) => p.jobId === null && p.path.length === 0)).toBe(true);
      expect(s.jobs.every((j) => j.owner === null)).toBe(true);
      expect(s.save().blocks).toEqual(save.blocks);
      expect(s.chunks()).toHaveLength(16);
      until(
        s,
        () => !s.jobs.length,
        1600,
        () => conserved(s, initial),
      );
      expect(s.blocks[at(target)]).toBe(Block.Wood);
      expect(s.blocks[index(target.x, target.y, 9)]).toBe(Block.Wood);
      expect(s.stats.built).toBe(1);
      expect(s.stats.consumed.wood).toBe(6);
      s.step(80);
      conserved(s, initial);
      expect(s.stats.built).toBe(1);
    },
  );
  it('rejects invalid typed commands without changing simulation state', () => {
    const s = new VoxelSimulation(),
      pawnId = s.pawns[0].id;
    const commands: VoxelCommand[] = [
      { type: 'designate', tool: 'wall', from: pos(-1, 32, 8) },
      { type: 'designate', tool: 'wall', from: pos(32.5, 32, 8) },
      { type: 'designate', tool: 'wall', from: pos(32, 32, 15) },
      { type: 'designate', tool: 'wall', from: pos(32, 32, 8), to: pos(33, 32, 9) },
      { type: 'designate', tool: 'wall', from: pos(10, 10, 8), to: pos(30, 30, 8) },
      { type: 'priority', pawnId, work: 'dig', value: 5 },
      { type: 'priority', pawnId, work: 'dig', value: 0.5 },
      { type: 'move', pawnId, target: pos(32, 32, 12) },
      { type: 'move', pawnId: -1, target: pos(32, 32, 8) },
    ];
    for (const c of commands) {
      const before = s.save();
      expect(s.command(c).ok).toBe(false);
      expect(s.save()).toEqual(before);
    }
  });
  it('rejects malformed commands as results and leaves rejected overlapping plans atomic', () => {
    const s = new VoxelSimulation();
    const malformed: unknown[] = [
      null,
      {},
      { type: 'designate', tool: 'wall' },
      { type: 'move', pawnId: s.pawns[0].id },
      { type: 'designate', tool: 'unknown', from: pos(32, 32, 8) },
    ];
    for (const raw of malformed) {
      const before = s.save();
      expect(s.command(raw as VoxelCommand).ok).toBe(false);
      expect(s.save()).toEqual(before);
    }
    place(s, 'wall', pos(31, 32, 8));
    const before = s.save();
    expect(s.command({ type: 'designate', tool: 'wall', from: pos(31, 32, 8) }).ok).toBe(false);
    expect(s.save()).toEqual(before);
  });
  it('rejects corrupt saves without touching the running world', () => {
    const s = new VoxelSimulation();
    place(s, 'wall', pos(36, 34, 8));
    const original = s.save();
    const corruptions: Array<(save: VoxelSave) => void> = [
      (d) => {
        (d as { version: number }).version = 4;
      },
      (d) => {
        (d as { generator: number }).generator = 2;
      },
      (d) => {
        d.seed = Infinity;
      },
      (d) => {
        d.tick = -1;
      },
      (d) => {
        d.blocks = [0, CELLS - 1];
      },
      (d) => {
        d.blocks = [7, CELLS];
      },
      (d) => {
        d.ladders = [2, CELLS];
      },
      (d) => {
        d.blocks = [0, CELLS + 1];
      },
      (d) => {
        d.items[0].amount = -1;
      },
      (d) => {
        d.items[0].amount = 1.5;
      },
      (d) => {
        d.items[0].id = d.pawns[0].id;
      },
      (d) => {
        d.pawns[0].priorities.build = 9;
      },
      (d) => {
        d.pawns[0].z = 5;
      },
      (d) => {
        d.pawns[0].cargo = { resource: 'wood', amount: 0 };
      },
      (d) => {
        d.jobs[0].delivered.wood = (d.jobs[0].cost.wood ?? 0) + 1;
      },
      (d) => {
        d.jobs[0].work++;
      },
      (d) => {
        d.stats.consumed.wood = NaN;
      },
    ];
    for (const mutate of corruptions) {
      const raw = structuredClone(original);
      mutate(raw);
      expect(() => VoxelSimulation.load(raw)).toThrow();
      expect(s.save()).toEqual(original);
    }
    expect(() => VoxelSimulation.load(null)).toThrow();
  });
});
