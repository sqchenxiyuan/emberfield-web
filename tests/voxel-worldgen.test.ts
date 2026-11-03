import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { initialStoryteller } from '../src/voxel/storyteller';
import { initialTrade } from '../src/voxel/trade';
import { initialFireHazards } from '../src/voxel/fire';
import { initialWeather } from '../src/voxel/weather';
import {
  WORLD_PRESETS,
  generateWorld,
  previewWorld,
  sanitizeWorldSettings,
} from '../src/voxel/worldgen';
import {
  growingSeasonDays,
  outdoorTemperature,
  seasonalAmplitude,
  seasonalOffset,
} from '../src/voxel/climate';
import {
  MIN_CROP_FERTILITY,
  fertilityOf,
  fertilityGrowth,
  temperatureAt,
} from '../src/voxel/farming';
import { freshBatch } from '../src/voxel/preservation';
import { treeYield } from '../src/voxel/plants';
import {
  Block,
  DAY,
  DEPTH,
  HEIGHT,
  WIDTH,
  at,
  index,
  type Biome,
  type Hilliness,
  type Pos,
  type VoxelSave,
  type WorldSettings,
} from '../src/voxel/types';

const biomes: Biome[] = ['temperate', 'boreal', 'desert'];
const hills: Hilliness[] = ['flat', 'small', 'large', 'mountainous'];
const point = (x: number, y: number, z = 8): Pos => ({ x, y, z });
function until(s: VoxelSimulation, done: () => boolean, limit = 1500) {
  for (let tick = 0; !done() && tick < limit; tick++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns })).toBe(true);
}
/** Deliberate geometry fixture for independently controlled climate/fertility tests. */
function plotWorld(soil: number, meanTemperature = 20) {
  const s = new VoxelSimulation(73129, {
    ...WORLD_PRESETS.temperate,
    meanTemperature,
    latitude: 0,
  });
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Air);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let z = 0; z < 8; z++)
    for (let y = 0; y < DEPTH; y++)
      for (let x = 0; x < WIDTH; x++)
        s.blocks[index(x, y, z)] = z === 0 ? Block.Bedrock : z === 7 ? soil : Block.Stone;
  s.spawn = point(10, 10);
  s.pawns.forEach((p, i) => {
    Object.assign(p, point(10 + i, 12));
    p.priorities = {
      firefight: 0, clean: 0,
      warden: 0,
      hunt: 0,
      dig: 1,
      cut: 0,
      build: 0,
      haul: 0,
      grow: 1,
      cook: 0,
      craft: 0,
      care: 0,
      research: 0,
    };
  });
  s.items.push({ ...freshBatch('grain', 10), ...point(10, 11), id: s.nextId++ });
  return VoxelSimulation.load(s.save());
}

describe('generator 2 terrain, ecology and preview isolation', () => {
  it('uses independent deterministic buffers and never changes the active colony during preview', () => {
    const s = new VoxelSimulation(17);
    s.step(3);
    const before = s.save(),
      chunks = s.chunks();
    const a = previewWorld(73129),
      b = previewWorld(73129);
    expect(a).toEqual(b);
    expect(a.heightMap).not.toBe(b.heightMap);
    expect(a.surfaceMap).not.toBe(b.surfaceMap);
    a.heightMap.fill(0);
    a.surfaceMap.fill(0);
    a.trees[0].wood = 999;
    expect(previewWorld(73129)).toEqual(b);
    expect(s.save()).toEqual(before);
    expect(s.chunks()).toEqual([]);
    expect(chunks).toHaveLength(16);
    expect(previewWorld(73129 + 4294967296).heightMap).not.toEqual(b.heightMap);
    const started = new VoxelSimulation(73129);
    expect(started.worldSummary).toEqual(b.summary);
    expect(started.spawn).toEqual(b.spawn);
    expect(started.trees.map(({ id: _id, ...tree }) => tree)).toEqual(b.trees);
    for (let y = 0; y < DEPTH; y++)
      for (let x = 0; x < WIDTH; x++)
        expect(started.blocks[index(x, y, b.heightMap[y * WIDTH + x] - 1)]).toBe(
          b.surfaceMap[y * WIDTH + x],
        );
  });
  it('changes actual soils and tree species/yields across biomes and changes ecology with rainfall', () => {
    const [temperate, boreal, desert] = biomes.map((biome) =>
      previewWorld(73129, WORLD_PRESETS[biome]),
    );
    expect(temperate.summary.trees.poplar).toBeGreaterThan(100);
    expect(boreal.summary.trees.pine).toBeGreaterThan(100);
    expect(desert.summary.trees.saguaro).toBeGreaterThan(5);
    expect(desert.summary.trees.total).toBeLessThan(temperate.summary.trees.total / 2);
    expect(temperate.trees.every((t) => t.wood === 27 && t.species === 'poplar')).toBe(true);
    expect(boreal.trees.every((t) => t.wood === 27 && t.species === 'pine')).toBe(true);
    expect(desert.trees.every((t) => t.wood === 15 && t.species === 'saguaro')).toBe(true);
    expect(temperate.summary.surfaceCounts.richSoil).toBeGreaterThan(0);
    expect(desert.summary.surfaceCounts.sand).toBeGreaterThan(3000);
    expect(desert.summary.fertileCells).toBeLessThan(temperate.summary.fertileCells / 2);
    const wet = previewWorld(73129, { ...WORLD_PRESETS.temperate, rainfall: 2000 });
    const dry = previewWorld(73129, { ...WORLD_PRESETS.temperate, rainfall: 0 });
    expect(wet.heightMap).toEqual(dry.heightMap);
    expect(wet.surfaceMap).not.toEqual(dry.surfaceMap);
    expect(wet.summary.trees.total).toBeGreaterThan(dry.summary.trees.total * 2);
  });
  it('makes finite three-dimensional veins, increasing relief without a large flat starting disk', () => {
    const worlds = hills.map((hilliness) => generateWorld(73129, { hilliness }));
    expect(worlds[0].summary.elevation.max - worlds[0].summary.elevation.min).toBeLessThanOrEqual(
      1,
    );
    expect(
      worlds[3].summary.elevation.max - worlds[3].summary.elevation.min,
    ).toBeGreaterThanOrEqual(8);
    expect(worlds[3].summary.resources.steel).toBeGreaterThan(worlds[0].summary.resources.steel);
    for (const world of worlds) {
      expect(world.summary.resources.steel).toBeGreaterThan(0);
      expect(
        world.summary.resources.steel + world.summary.resources.components,
      ).toBeLessThanOrEqual(60 * 16);
      expect(world.summary.resources.components).toBeGreaterThan(0);
      const oreLayers = new Set<number>();
      for (let i = 0; i < world.blocks.length; i++)
        if ([Block.Steel, Block.Components].includes(world.blocks[i] as 3 | 6))
          oreLayers.add(Math.floor(i / (WIDTH * DEPTH)));
      expect(oreLayers.size).toBeGreaterThan(1);
      expect(oreLayers.has(0)).toBe(false);
      for (let i = 0; i < WIDTH * DEPTH; i++) expect(world.blocks[i]).toBe(Block.Bedrock);
      const s = world.spawn;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          expect(world.heightMap[(s.y + dy) * WIDTH + s.x + dx]).toBe(s.z);
    }
    const mountain = worlds[3],
      near = new Set<number>();
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++)
        near.add(mountain.heightMap[(mountain.spawn.y + dy) * WIDTH + mountain.spawn.x + dx]);
    expect(near.size).toBeGreaterThan(2);
  });
  it.each(biomes.flatMap((biome) => hills.map((hilliness) => ({ biome, hilliness }))))(
    'starts and harvests a reachable natural tree for $biome / $hilliness without injecting supplies',
    ({ biome, hilliness }) => {
      const s = new VoxelSimulation(73129, { ...WORLD_PRESETS[biome], hilliness });
      expect(s.pawns.every((p) => s.standable(p))).toBe(true);
      expect(s.worldSummary.reachableSurfaceCells).toBeGreaterThan(2500);
      expect(s.counts()).toMatchObject({ wood: 90, food: 60, steel: 0, components: 0 });
      const worker = s.pawns[0];
      const tree = [...s.trees]
        .sort(
          (a, b) =>
            Math.hypot(a.x - worker.x, a.y - worker.y) - Math.hypot(b.x - worker.x, b.y - worker.y),
        )
        .find((t) =>
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dy]) =>
            [0, -1, 1].some(
              (dz) => s.path(worker, { x: t.x + dx, y: t.y + dy, z: t.z + dz }) !== null,
            ),
          ),
        );
      expect(tree).toBeDefined();
      expect(s.command({ type: 'designate', tool: 'cut', from: tree! }).ok).toBe(true);
      until(s, () => s.stats.cut === 1);
      expect(s.stats.produced.wood).toBe(treeYield(tree!, s.seed));
      expect(s.counts().wood).toBe(90 + s.stats.produced.wood);
      const restored = VoxelSimulation.load(s.save());
      expect(restored.blocks).toEqual(s.blocks);
      expect(restored.trees).toEqual(s.trees);
      expect(restored.settings).toEqual(s.settings);
      expect(restored.generator).toBe(2);
    },
  );
});

describe('fertility and real climate integration', () => {
  it.each([
    [Block.Soil, 1],
    [Block.RichSoil, 1.4],
    [Block.Sand, 0.1],
    [Block.Gravel, 0.7],
  ])('uses actual block %i fertility %f for farm commands and growth', (block, fertility) => {
    const s = plotWorld(block),
      p = point(10, 10),
      condition = s.cropCondition(p, 'rice');
    expect(MIN_CROP_FERTILITY).toBe(0.7);
    expect(fertilityOf(block)).toBe(fertility);
    expect(condition.fertility).toBe(fertility);
    expect(s.command({ type: 'designate', tool: 'farm', from: p, crop: 'rice' }).ok).toBe(
      fertility >= 0.7,
    );
    if (fertility >= 0.7) {
      until(s, () => s.stats.sown === 1);
      const before = s.crops[0].growth;
      s.step(100);
      expect(s.crops[0].growth).toBeGreaterThan(before);
      expect(fertilityGrowth('rice', fertility)).toBeCloseTo(fertility);
      expect(fertilityGrowth('potato', fertility)).toBeCloseTo(1 + (fertility - 1) * 0.4);
    } else expect(condition.growthRate).toBe(0);
  });
  it.each([Block.RichSoil, Block.Sand, Block.Gravel])(
    'mines new natural soil %i without inventing stone or ore output',
    (block) => {
      let s = plotWorld(Block.Soil);
      const p = point(14, 10);
      s.blocks[at(p)] = block;
      s.blocks[at({ ...p, z: 9 })] = block;
      s = VoxelSimulation.load(s.save());
      expect(s.command({ type: 'designate', tool: 'mine', from: p }).ok).toBe(true);
      until(s, () => s.stats.mined === 2);
      expect(s.blocks[at(p)]).toBe(Block.Air);
      expect(s.stats.produced).toMatchObject({ chunk: 0, stone: 0, steel: 0 });
    },
  );
  it('uses the source seasonal latitude curve, phase, hemisphere and 60-day calendar', () => {
    expect(seasonalAmplitude(0)).toBe(3);
    expect(seasonalAmplitude(90)).toBe(28);
    expect(seasonalAmplitude(45)).toBeCloseTo(20.189514164974604, 10);
    expect(seasonalOffset(20, 45)).toBeCloseTo(seasonalAmplitude(45));
    expect(seasonalOffset(50, 45)).toBeCloseTo(-seasonalAmplitude(45));
    expect(seasonalOffset(20, -45)).toBeCloseTo(-seasonalOffset(20, 45));
    expect(seasonalOffset(12, 45)).toBeCloseTo(seasonalOffset(72, 45));
    expect(
      growingSeasonDays({ ...WORLD_PRESETS.temperate, meanTemperature: 20, latitude: 0 }),
    ).toBe(60);
    expect(
      growingSeasonDays({ ...WORLD_PRESETS.temperate, meanTemperature: -30, latitude: 90 }),
    ).toBe(0);
    expect(growingSeasonDays(WORLD_PRESETS.temperate)).toBe(40);
    expect(growingSeasonDays(WORLD_PRESETS.boreal)).toBe(30);
  });
  it('keeps temperature independent of the biome name and changes crops, rooms and food through actual climate', () => {
    const settings = { ...WORLD_PRESETS.temperate, latitude: 45, meanTemperature: 14 };
    expect(outdoorTemperature(20 * DAY, settings)).toBe(
      outdoorTemperature(20 * DAY, { ...settings, biome: 'desert' }),
    );
    const cold = plotWorld(Block.Soil, -20),
      warm = plotWorld(Block.Soil, 20),
      p = point(10, 10);
    expect(cold.cropCondition(p, 'rice').growthRate).toBe(0);
    expect(warm.cropCondition(p, 'rice').growthRate).toBeGreaterThan(0);
    for (const s of [cold, warm]) {
      for (let z = 8; z <= 10; z++)
        for (let y = 10; y <= 14; y++)
          for (let x = 18; x <= 22; x++)
            s.blocks[index(x, y, z)] =
              z === 10 || x === 18 || x === 22 || y === 10 || y === 14 ? Block.Masonry : Block.Air;
      // Recreate topology via the normal save loader after explicit geometry setup.
      const loaded = VoxelSimulation.load(s.save());
      expect(loaded.temperature(point(20, 12))).toBeCloseTo(loaded.outdoorTemperature(), 10);
      expect(loaded.snapshot().temperature).toBe(loaded.outdoorTemperature());
    }
    cold.step(100);
    warm.step(100);
    expect(cold.items.find((i) => i.resource === 'grain')!.rotProgress).toBe(0);
    expect(warm.items.find((i) => i.resource === 'grain')!.rotProgress).toBe(100);
  });
});

describe('v8 world persistence and validation', () => {
  it('retains the actual frozen v7 map, amounts and legacy daily clock after migration', () => {
    const raw = JSON.parse(
      readFileSync(new URL('./fixtures/voxel-v7-start.json', import.meta.url), 'utf8'),
    );
    const original = structuredClone(raw),
      s = VoxelSimulation.load(raw),
      saved = s.save();
    expect(raw).toEqual(original);
    expect(saved.version).toBe(27);
    expect(saved.generator).toBe(1);
    expect(saved.blocks).toEqual(raw.blocks);
    expect(saved.ladders).toEqual(raw.ladders);
    expect(saved.items).toEqual(raw.items);
    for (const tick of [0, 100, DAY * 20, DAY * 50]) {
      s.tick = tick;
      s.storyteller = initialStoryteller(s.seed, tick);
      s.trade = initialTrade(s.seed, tick);
      s.fireHazards = initialFireHazards(s.seed, tick);
      s.weather = initialWeather(s.seed, s.settings, s.tick, s.generator);
      expect(s.outdoorTemperature()).toBe(temperatureAt(tick));
    }
    expect(VoxelSimulation.load(s.save()).outdoorTemperature()).toBe(temperatureAt(s.tick));
    expect(s.trees.every((t) => t.species === 'poplar')).toBe(true);
  });
  it('restores edited v8 terrain directly and rejects malformed world metadata without touching inputs', () => {
    const s = new VoxelSimulation(111, WORLD_PRESETS.desert);
    s.blocks[index(2, 2, 1)] = Block.Masonry;
    const saved = s.save(),
      restored = VoxelSimulation.load(saved);
    expect(restored.blocks[index(2, 2, 1)]).toBe(Block.Masonry);
    const restoredSave = restored.save();
    // Loading rebuilds transient worker status; all physical data remains exact.
    restoredSave.pawns.forEach((p, i) => {
      p.reason = saved.pawns[i].reason;
    });
    expect(restoredSave).toEqual(saved);
    const mutations: ((d: VoxelSave) => void)[] = [
      (d) => {
        d.settings.meanTemperature = NaN;
      },
      (d) => {
        d.settings.rainfall = -1;
      },
      (d) => {
        d.settings.latitude = 91;
      },
      (d) => {
        d.settings.biome = 'ocean' as Biome;
      },
      (d) => {
        d.settings.hilliness = 'bad' as Hilliness;
      },
      (d) => {
        d.generator = 3 as 2;
      },
      (d) => {
        d.spawn.x = 64;
      },
      (d) => {
        d.spawn.z = 0;
      },
      (d) => {
        d.trees[0].species = 'oak' as 'pine';
      },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(saved);
      mutate(bad);
      const before = structuredClone(bad);
      expect(() => VoxelSimulation.load(bad)).toThrow();
      expect(bad).toEqual(before);
    }
    expect(s.save()).toEqual(saved);
  });
  it('bounds user settings explicitly while strict save loading does not silently clamp them', () => {
    expect(
      sanitizeWorldSettings({ biome: 'desert', latitude: 200, rainfall: -1, meanTemperature: 90 }),
    ).toEqual({ ...WORLD_PRESETS.desert, latitude: 90, rainfall: 0, meanTemperature: 45 });
    expect(sanitizeWorldSettings({ latitude: NaN })).toEqual(WORLD_PRESETS.temperate);
    expect(() => previewWorld(Number.NaN)).toThrow();
    expect(() => new VoxelSimulation(1.5)).toThrow();
  });
});
