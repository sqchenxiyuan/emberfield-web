import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { initialResearch } from '../src/voxel/research';
import { WORLD_PRESETS, previewWorld } from '../src/voxel/worldgen';
import {
  TREE_DATA,
  PLANTED_GROWTH,
  NATURAL_GROWTH,
  TREE_SHADE_GRACE,
  ECOLOGY_INTERVAL,
  treeYield,
  treeGrowth,
  treeDamage,
  treeTemperatureGrowth,
  treeCutWork,
  treeSowWork,
  treeWorkSpeed,
} from '../src/voxel/plants';
import { freshBatch } from '../src/voxel/preservation';
import {
  Block,
  DAY,
  at,
  index,
  type Pos,
  type Tree,
  type TreeSpecies,
  type VoxelCommand,
  type VoxelSave,
} from '../src/voxel/types';

const p = (x: number, y: number, z = 8): Pos => ({ x, y, z });
const species: TreeSpecies[] = ['poplar', 'pine', 'saguaro'];
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c);
  expect(result.ok, result.message).toBe(true);
  return result;
}
function until(s: VoxelSimulation, done: () => boolean, ticks = 5000) {
  for (let i = 0; !done() && i < ticks; i++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns })).toBe(true);
}
function tree(s: VoxelSimulation, position: Pos, values: Partial<Tree> = {}) {
  const t: Tree = {
    ...position,
    id: s.nextId++,
    species: 'poplar',
    wood: 27,
    growth: 1,
    age: 0,
    health: 1,
    unlitTicks: 0,
    planted: false,
    ...values,
  };
  s.trees.push(t);
  return t;
}
/** Explicit bounded topology fixture; normal terrain/resource campaigns are separate. */
function fixture(configure: (s: VoxelSimulation) => void = () => {}) {
  const s = new VoxelSimulation(713, {
    ...WORLD_PRESETS.temperate,
    meanTemperature: 24,
    latitude: 0,
  });
  // Controlled feature fixture represents a colony with research already completed.
  s.research = initialResearch(true);
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  s.treePlots = [];
  for (let y = 10; y <= 24; y++)
    for (let x = 10; x <= 24; x++) {
      s.blocks[index(x, y, 7)] = Block.Soil;
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
    }
  s.spawn = p(11, 22);
  s.pawns.forEach((pawn, i) => {
    Object.assign(pawn, p(10 + i, 22));
    // This geometry/lifecycle fixture has a qualified forester; skill gates have separate tests.
    if (i === 0) pawn.skills.plants.level = 8;
    pawn.priorities = {
      firefight: 0, clean: 0,
      warden: 0,
      hunt: 0,
      dig: 0,
      cut: i === 0 ? 1 : 0,
      build: 0,
      haul: 0,
      grow: i === 0 ? 1 : 0,
      cook: 0,
      craft: 0,
      care: 0,
      research: 0,
    };
  });
  for (let x = 10; x <= 15; x++)
    s.items.push({ ...freshBatch('food', 10), ...p(x, 21), id: s.nextId++ });
  configure(s);
  return VoxelSimulation.load(s.save());
}
type TreeInternals = {
  treeCanAppear(p: Pos, species: TreeSpecies, ownJob?: number, natural?: boolean): boolean;
  distance: Int32Array;
  parents: Int32Array;
};
const internals = (s: VoxelSimulation) => s as unknown as TreeInternals;

describe('tree reference curves and deterministic outputs', () => {
  it.each(species)('uses independent %s growth, work, fertility and lifespan values', (name) => {
    const data = TREE_DATA[name];
    expect(treeSowWork(name)).toBe(1334);
    expect(treeCutWork(name)).toBe(name === 'poplar' ? 267 : name === 'pine' ? 237 : 70);
    expect(data.lifespanDays).toBe(name === 'poplar' ? 135.45 : name === 'pine' ? 180 : 200);
    expect(treeWorkSpeed(0)).toBe(3.3);
    expect(treeWorkSpeed(1)).toBeCloseTo(1);
    expect(treeGrowth(name, data.minFertility - 0.01, 1, 24, 12)).toBe(0);
    expect(treeGrowth(name, 1, 1, 24, 5.99)).toBe(0);
    expect(treeGrowth(name, 1, 1, 24, 19.21)).toBe(0);
    expect(treeGrowth(name, 1, 0.51, 24, 12)).toBe(0);
    expect(treeGrowth(name, 1, 1, 24, 12) * data.days * DAY).toBeCloseTo(1);
    expect(treeTemperatureGrowth(name, 0)).toBe(0);
    expect(treeTemperatureGrowth(name, data.maxTemperature)).toBe(0);
    expect(treeTemperatureGrowth(name, 60)).toBe(name === 'saguaro' ? 15 / 33 : 0);
  });
  it('uses strict harvest thresholds, health and stable probabilistic integer rounding', () => {
    const t: Tree = {
      ...p(14, 14),
      id: 1,
      species: 'poplar',
      wood: 27,
      growth: 0.4,
      age: 0,
      health: 1,
      unlitTicks: 0,
      planted: false,
    };
    expect(treeYield(t, 1)).toBe(0);
    t.growth = 0.7;
    let total = 0;
    for (let seed = 0; seed < 10000; seed++) {
      const n = treeYield(t, seed);
      expect([20, 21]).toContain(n);
      expect(treeYield(t, seed)).toBe(n);
      total += n;
    }
    expect(total / 10000).toBeCloseTo(20.25, 1);
    t.growth = 1;
    expect(treeYield(t, 1)).toBe(27);
    t.health = 0.5;
    expect([20, 21]).toContain(treeYield(t, 1));
    t.species = 'saguaro';
    t.wood = 15;
    t.growth = 0.2;
    expect(treeYield(t, 1)).toBe(0);
    t.growth = 0.20001;
    t.health = 1;
    expect([7, 8]).toContain(treeYield(t, 1));
  });
  it('keeps calendar aging and shade thresholds strict without adding their damage twice', () => {
    const data = TREE_DATA.poplar,
      t = {
        species: 'poplar' as const,
        age: data.lifespanDays * DAY,
        unlitTicks: TREE_SHADE_GRACE,
      };
    expect(treeDamage(t)).toBe(0);
    t.age++;
    const damage = treeDamage(t);
    expect(damage).toBeCloseTo(0.025 / 200);
    t.unlitTicks++;
    expect(treeDamage(t)).toBe(damage);
    t.age = 0;
    expect(treeDamage(t)).toBe(damage);
  });
  it('generates a reproducible mixture of juvenile and mature trees with bounded initial ages', () => {
    const preview = previewWorld(73129),
      s = new VoxelSimulation(73129);
    expect(s.trees.map(({ id: _id, ...t }) => t)).toEqual(preview.trees);
    expect(s.trees.some((t) => t.growth <= TREE_DATA[t.species].minGrowth)).toBe(true);
    expect(s.trees.some((t) => t.growth === 1)).toBe(true);
    expect(
      s.trees.every(
        (t) =>
          t.growth >= 0.15 &&
          t.growth <= 1 &&
          t.age < TREE_DATA[t.species].lifespanDays * DAY &&
          t.health === 1,
      ),
    ).toBe(true);
  });
});

describe('forestry commands, physical jobs and cancellation', () => {
  it('spaces a dragged grove, plants from a real adjacent work cell, and keeps seedlings when the zone is erased', () => {
    const s = fixture();
    const result = command(s, {
      type: 'designate',
      tool: 'grove',
      from: p(15, 15),
      to: p(17, 17),
      treeSpecies: 'poplar',
    });
    expect(result.count).toBe(4);
    expect(result.message).toContain('跳过5格');
    expect(s.jobs.every((j) => j.kind === 'plantTree' && j.work === 1334)).toBe(true);
    until(s, () => s.stats.treesPlanted === 1);
    const t = s.trees.find((t) => t.planted)!;
    expect(t.growth).toBe(PLANTED_GROWTH);
    expect(t.age).toBe(0);
    expect(s.standable(t)).toBe(false);
    expect(s.pawns.every((pawn) => s.standable(pawn))).toBe(true);
    expect(s.pawns[0].workTarget).toBeNull();
    command(s, { type: 'designate', tool: 'clearZone', from: p(15, 15), to: p(17, 17) });
    expect(s.treePlots).toEqual([]);
    expect(s.jobs).toEqual([]);
    expect(s.trees.some((tree) => tree.id === t.id)).toBe(true);
    command(s, { type: 'designate', tool: 'cut', from: t });
    until(s, () => s.stats.cut === 1);
    expect(s.stats.produced.wood).toBe(0);
    s.step(100);
    expect(s.treePlots).toEqual([]);
  });
  it('completes planting after save/load and preserves existing progress rather than restarting', () => {
    let s = fixture();
    command(s, { type: 'designate', tool: 'grove', from: p(15, 15), treeSpecies: 'pine' });
    until(s, () => s.jobs[0].progress > 500);
    const progress = s.jobs[0].progress;
    s = VoxelSimulation.load(s.save());
    expect(s.jobs[0].progress).toBe(progress);
    expect(s.treePlots[0].species).toBe('pine');
    until(s, () => s.stats.treesPlanted === 1);
    expect(s.trees.find((t) => t.planted)!.species).toBe('pine');
  });
  it('allows sand-grown saguaro, rejects an incompatible replacement, and automatically replants after manual harvest', () => {
    const target = p(15, 15);
    let s = fixture((s) => {
      s.blocks[index(15, 15, 7)] = Block.Sand;
    });
    command(s, { type: 'designate', tool: 'grove', from: target, treeSpecies: 'saguaro' });
    const saved = s.save();
    expect(
      s.command({ type: 'designate', tool: 'grove', from: target, treeSpecies: 'poplar' }).ok,
    ).toBe(false);
    expect(s.save()).toEqual(saved);
    until(s, () => s.stats.treesPlanted === 1);
    // Isolated mature-stage fixture: the normal campaign measures calendar growth from .0001.
    const raw = s.save();
    raw.trees.find((t) => t.planted)!.growth = 1;
    s = VoxelSimulation.load(raw);
    command(s, { type: 'designate', tool: 'cut', from: target });
    until(s, () => s.stats.cut === 1);
    expect(s.stats.produced.wood).toBe(15);
    until(s, () => s.stats.treesPlanted === 2);
    expect(s.trees.find((t) => t.planted)!.growth).toBe(PLANTED_GROWTH);
  });
  it('retains a full-output tree and work until a local wood stack can accept the exact bounded yield', () => {
    let s = fixture((s) => {
      s.blocks.fill(Block.Stone);
      s.items = [];
      for (let y = 10; y <= 12; y++)
        for (let x = 10; x <= 12; x++) {
          s.blocks[index(x, y, 8)] = s.blocks[index(x, y, 9)] = Block.Air;
          s.items.push({ ...freshBatch('wood', 75), ...p(x, y), id: s.nextId++ });
        }
      s.pawns.forEach((pawn, i) => Object.assign(pawn, p(10 + i, 10)));
      s.blocks[index(13, 11, 8)] = s.blocks[index(13, 11, 9)] = Block.Air;
      tree(s, p(13, 11), { growth: 0.7 });
    });
    const target = s.trees[0];
    command(s, { type: 'designate', tool: 'cut', from: target });
    until(
      s,
      () => s.jobs[0].progress === s.jobs[0].work && s.jobs[0].reason.includes('附近可达落地空间'),
    );
    const amount = treeYield(target, s.seed);
    expect(s.stats.produced.wood).toBe(0);
    expect(s.trees).toHaveLength(1);
    s = VoxelSimulation.load(s.save());
    expect(treeYield(s.trees[0], s.seed)).toBe(amount);
    // Free exactly enough space in an already-local stack; no distant output teleport.
    s.items.find((i) => i.x === 12 && i.y === 12)!.amount -= amount;
    const wood = s.counts().wood;
    until(s, () => s.stats.cut === 1);
    expect(s.counts().wood - wood).toBe(amount);
    expect(s.items.every((i) => i.amount <= 75)).toBe(true);
  });
});

describe('safe natural renewal, aging and deterministic continuation', () => {
  it.each(['farm', 'storage', 'stove', 'bed', 'ladder', 'items', 'plot', 'jobStand'] as const)(
    'excludes %s cells from actual natural-tree placement checks',
    (kind) => {
      const target = p(15, 15),
        s = fixture((s) => {
          if (kind === 'farm') s.farms.push({ ...target, crop: 'rice' });
          if (kind === 'storage') s.stockpiles.push({ ...target, priority: 1, accepts: ['wood'] });
          if (kind === 'stove')
            s.stoves.push({ ...target, id: s.nextId++, target: 0, paused: true });
          if (kind === 'bed')
            s.beds.push({ ...target, id: s.nextId++, axis: 'x', owner: null, prisoner: false, medical: false });
          if (kind === 'ladder') s.ladders[at(target)] = 1;
          if (kind === 'items')
            s.items.push({ ...freshBatch('wood', 1), ...target, id: s.nextId++ });
          if (kind === 'plot') s.treePlots.push({ ...target, species: 'pine' });
        });
      if (kind === 'jobStand') command(s, { type: 'designate', tool: 'wall', from: p(16, 15) });
      const before = s.save();
      expect(internals(s).treeCanAppear(target, 'poplar', undefined, true)).toBe(false);
      expect(s.save()).toEqual(before);
    },
  );
  it('uses independent topology scratch and forbids growth on active paths, job stands and sole corridors', () => {
    const s = fixture();
    const target = p(15, 15),
      intern = internals(s);
    s.path(s.pawns[0], p(20, 20));
    const distance = intern.distance.slice(),
      parents = intern.parents.slice();
    expect(intern.treeCanAppear(target, 'poplar', undefined, true)).toBe(true);
    expect(intern.distance).toEqual(distance);
    expect(intern.parents).toEqual(parents);
    command(s, { type: 'move', pawnId: s.pawns[0].id, target });
    expect(intern.treeCanAppear(target, 'poplar', undefined, true)).toBe(false);
    const corridor = fixture((s) => {
      s.blocks.fill(Block.Stone);
      s.items = [];
      for (let x = 10; x <= 18; x++) {
        s.blocks[index(x, 10, 7)] = Block.Soil;
        for (let z = 8; z < 16; z++) s.blocks[index(x, 10, z)] = Block.Air;
      }
      s.pawns.forEach((pawn, i) => Object.assign(pawn, p(10 + i, 10)));
    });
    expect(corridor.path(corridor.pawns[0], p(18, 10))).not.toBeNull();
    expect(internals(corridor).treeCanAppear(p(15, 10), 'poplar', undefined, true)).toBe(false);
    expect(corridor.path(corridor.pawns[0], p(18, 10))).not.toBeNull();
  });
  it('preserves deterministic natural renewal across save/load without disabling legacy-generator ecology', () => {
    const s = fixture();
    s.generator = 1;
    s.pawns.forEach((pawn) =>
      Object.keys(pawn.priorities).forEach((k) => {
        pawn.priorities[k as 'grow'] = 0;
      }),
    );
    const restored = VoxelSimulation.load(s.save());
    s.step(DAY * 5);
    restored.step(DAY * 5);
    expect(s.stats.treesRegrown).toBeGreaterThan(0);
    expect(s.trees).toEqual(restored.trees);
    expect(s.stats.treesRegrown).toBe(restored.stats.treesRegrown);
    expect(s.trees.every((t) => !t.planted && t.growth >= NATURAL_GROWTH)).toBe(true);
    expect(s.pawns.every((pawn) => s.standable(pawn))).toBe(true);
  }, 30000);
  it('lets cold trees stop growing, lets useful daylight reset shade age, and removes dead trees without wood', () => {
    let s = fixture((s) => {
      tree(s, p(15, 15), { growth: 0.3, age: 100, unlitTicks: 100 });
      s.settings.meanTemperature = -30;
    });
    s.step(100);
    expect(s.trees[0].growth).toBe(0.3);
    expect(s.trees[0].health).toBe(1);
    expect(s.trees[0].unlitTicks).toBe(0);
    const saved = s.save();
    const t = saved.trees[0];
    t.age = Math.ceil(TREE_DATA[t.species].lifespanDays * DAY) + 1;
    t.health = 0.00001;
    s = VoxelSimulation.load(saved);
    s.step();
    expect(s.stats.treesDied).toBe(1);
    expect(s.trees).toEqual([]);
    expect(s.stats.produced.wood).toBe(0);
    s = fixture((s) => {
      tree(s, p(15, 15), {
        growth: 0.3,
        age: TREE_SHADE_GRACE + 1,
        unlitTicks: TREE_SHADE_GRACE + 1,
        health: 0.00001,
      });
      s.blocks[index(15, 15, 10)] = Block.Wood;
    });
    s.step();
    expect(s.stats.treesDied).toBe(1);
    expect(s.stats.produced.wood).toBe(0);
  });
});

describe('real v8 migration and v9 validation', () => {
  it('migrates the immutable real v8 fixture and preserves its pre-lifecycle materials and mature yields', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v8-start.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'e44adc4c30a85f9c58d38d78087c079a1694b0c58e14c62c28b2253820be0512',
    );
    const raw = JSON.parse(bytes.toString('utf8')),
      before = structuredClone(raw),
      s = VoxelSimulation.load(raw);
    expect(raw.version).toBe(8);
    expect(raw).toEqual(before);
    expect(s.save().version).toBe(26);
    expect(s.save().blocks).toEqual(raw.blocks);
    expect(s.items).toEqual(raw.items);
    expect(s.treePlots).toEqual([]);
    expect(
      s.trees.every(
        (t) => t.growth === 1 && t.age === 0 && t.health === 1 && treeYield(t, s.seed) === t.wood,
      ),
    ).toBe(true);
  });
  it('preserves a legacy in-progress cutting workload and rejects malformed lifecycle fields atomically', () => {
    const raw = JSON.parse(
      readFileSync(new URL('./fixtures/voxel-v8-start.json', import.meta.url), 'utf8'),
    );
    const t = raw.trees[0];
    raw.jobs.push({
      ...p(t.x, t.y, t.z),
      id: raw.nextId++,
      kind: 'cut',
      work: 60,
      progress: 25,
      owner: null,
      delivered: {},
      deliveredFood: [],
      cost: {},
      reason: 'legacy work fixture',
      cancelled: false,
    });
    const s = VoxelSimulation.load(raw);
    expect(s.jobs[0]).toMatchObject({
      work: 60,
      progress: 25,
      legacyCut: true,
      treeSpecies: t.species,
    });
    const saved = s.save();
    const mutations: ((d: VoxelSave) => void)[] = [
      (d) => {
        d.trees[0].growth = NaN;
      },
      (d) => {
        d.trees[0].growth = 1.1;
      },
      (d) => {
        d.trees[0].age = -1;
      },
      (d) => {
        d.trees[0].health = 0;
      },
      (d) => {
        d.trees[0].health = 2;
      },
      (d) => {
        d.trees[0].unlitTicks = 1;
      },
      (d) => {
        d.trees[0].planted = 1 as unknown as boolean;
      },
      (d) => {
        d.treePlots.push({ ...p(10, 10), species: 'bad' as TreeSpecies });
      },
      (d) => {
        d.treePlots.push({ ...p(10, 10), species: 'pine' }, { ...p(11, 11), species: 'pine' });
      },
      (d) => {
        d.jobs[0].work = 267;
      },
      (d) => {
        d.stats.treesRegrown = 0.5;
      },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(saved);
      mutate(bad);
      const before = structuredClone(bad);
      expect(() => VoxelSimulation.load(bad)).toThrow();
      expect(bad).toEqual(before);
    }
  });
});
