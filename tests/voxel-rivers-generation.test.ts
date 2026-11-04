import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateWorld, previewWorld, sanitizeWorldSettings, summarizeWorld, validWorldSettings, WORLD_PRESETS } from '../src/voxel/worldgen';
import { generateRegions, regionTile, resolveWorldSite, riverRouteForTile } from '../src/voxel/regions';
import { validateWorldSiteIdentity } from '../src/voxel/regionPersistence';
import { initialExploration } from '../src/voxel/exploration';
import { Block, CELLS, DEPTH, HEIGHT, WIDTH, index, type Biome, type Hilliness } from '../src/voxel/types';
import type { RiverRoute } from '../src/voxel/rivers';

const biomes: Biome[] = ['temperate', 'boreal', 'desert'];
const hills: Hilliness[] = ['flat', 'small', 'large', 'mountainous'];
const cardinal = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function surfaceConnected(mask: Uint8Array): Set<number> {
  const start = mask.findIndex(value => value > 0), seen = new Set<number>();
  if (start < 0) return seen;
  const queue = [start]; seen.add(start);
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i], x = cell % WIDTH, y = Math.floor(cell / WIDTH);
    for (const [dx, dy] of cardinal) {
      const nx = x + dx, ny = y + dy, next = ny * WIDTH + nx;
      if (nx >= 0 && ny >= 0 && nx < WIDTH && ny < DEPTH && mask[next] && !seen.has(next)) {
        seen.add(next); queue.push(next);
      }
    }
  }
  return seen;
}
function hasFord(waterMap: Uint8Array): boolean {
  for (const vertical of [false, true]) for (let line = 1; line < WIDTH - 1; line++) {
    const cell = (along: number) => vertical ? along * WIDTH + line : line * WIDTH + along;
    for (let start = 1; start < WIDTH - 2; start++) {
      if (waterMap[cell(start - 1)] || waterMap[cell(start)] !== 1) continue;
      let end = start;
      while (end < WIDTH - 1 && waterMap[cell(end)] === 1) end++;
      if (end - start >= 3 && !waterMap[cell(end)]) return true;
    }
  }
  return false;
}
function geometryErrors(world: ReturnType<typeof generateWorld>): string[] {
  const errors: string[] = [];
  for (let y = 0; y < DEPTH; y++) for (let x = 0; x < WIDTH; x++) {
    const column = y * WIDTH + x, kind = world.waterMap[column];
    const cells: number[] = [];
    for (let z = 0; z < HEIGHT; z++) if (world.water[index(x, y, z)]) cells.push(z);
    if (cells.length !== (kind === 2 ? 2 : kind === 1 ? 1 : 0)) errors.push(`depth ${x},${y}`);
    if (!cells.length) continue;
    const low = cells[0], high = cells[cells.length - 1];
    if (world.blocks[index(x, y, low - 1)] === Block.Air) errors.push(`missing bed ${x},${y}`);
    if (high - low + 1 !== cells.length) errors.push(`disconnected column ${x},${y}`);
    if (high + 1 !== world.heightMap[column]) errors.push(`wrong surface ${x},${y}`);
    for (const z of cells) if (world.blocks[index(x, y, z)] !== Block.Air || world.water[index(x, y, z)] !== kind)
      errors.push(`water overlap ${x},${y},${z}`);
    for (const [dx, dy] of cardinal) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < WIDTH && ny < DEPTH &&
          Math.abs(world.heightMap[ny * WIDTH + nx] - world.heightMap[column]) > 1) errors.push(`bank cliff ${x},${y}`);
    }
  }
  for (const tree of world.trees) if (world.waterMap[tree.y * WIDTH + tree.x]) errors.push('underwater tree');
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
    if (world.waterMap[(world.spawn.y + dy) * WIDTH + world.spawn.x + dx]) errors.push('wet landing');
  return errors;
}

describe('versioned local rivers and physical riverbeds', () => {
  it.each([
    [2, '9a2bd38c9e084ee1dc96e0ae426f6ed270b1d82a45e03d9e1a9c7deac0e67655'],
    [3, 'c457fe168cf9b18092d5fe60f3339a9316be3724efe64a900cd954004c4639df'],
  ] as const)('retains the exact generator %s terrain, trees, spawn and summary compatibility vector', (generator, digest) => {
    // Captured from HEAD before the river change, not generated from the new implementation.
    const world = generateWorld(73129, { hilliness: 'mountainous' }, generator);
    expect(createHash('sha256').update(world.blocks).update(world.heightMap).update(world.surfaceMap)
      .update(JSON.stringify({ spawn: world.spawn, trees: world.trees, summary: world.summary })).digest('hex')).toBe(digest);
    expect(generateWorld(73129, { hilliness: 'mountainous', river: 'river' }, generator).blocks).toEqual(world.blocks);
    expect(world.water.every(value => value === 0)).toBe(true);
  });

  it('preserves the five-field historical climate identity and validates the optional river field strictly', () => {
    const old = sanitizeWorldSettings(WORLD_PRESETS.temperate);
    expect(Object.keys(old)).toHaveLength(5);
    expect(validWorldSettings(old)).toBe(true);
    expect(sanitizeWorldSettings({ ...old, river: undefined })).toEqual({ ...old, river: 'none' });
    for (const river of ['none', 'creek', 'river'] as const) expect(validWorldSettings({ ...old, river })).toBe(true);
    for (const bad of [{ ...old, river: 'ocean' }, { ...old, river: undefined }, { ...old, river: null },
      { ...old, river: 'river', flow: 1 }, { ...old, flow: 1 }]) expect(validWorldSettings(bad)).toBe(false);
  });

  it('defaults to generator 4 while leaving an unspecified or disabled river identical to generator 3 terrain', () => {
    const old = generateWorld(73129, undefined, 3), next = generateWorld(73129);
    expect(next.generator).toBe(4);
    expect(next.blocks).toEqual(old.blocks);
    expect(next.heightMap).toEqual(old.heightMap);
    expect(next.trees).toEqual(old.trees);
    expect(next.summary).toEqual({ ...old.summary, water: { shallow: 0, deep: 0, bridgeable: 0 } });
    expect(initialExploration(next.blocks, 4)).toEqual(initialExploration(old.blocks, 3));
    expect(initialExploration(next.blocks, 4).some(value => value === 0)).toBe(true);
  });

  it.each(biomes.flatMap(biome => hills.flatMap(hilliness => (['creek', 'river'] as const).map(river => ({ biome, hilliness, river })))))
  ('generates supported water, dry landing and a usable ford for $biome / $hilliness / $river', settings => {
    const world = generateWorld(73129, { ...WORLD_PRESETS[settings.biome], ...settings });
    expect(geometryErrors(world)).toEqual([]);
    expect(world.water).toHaveLength(CELLS);
    const wet = world.waterMap.filter(value => value > 0).length;
    expect(wet).toBeGreaterThan(120);
    expect(surfaceConnected(world.waterMap).size).toBe(wet);
    expect(world.summary.water!.shallow).toBeGreaterThan(30);
    expect(world.summary.water!.bridgeable).toBe(world.summary.water!.shallow);
    expect(world.summary.water!.shallow + world.summary.water!.deep).toBe(wet);
    expect(world.summary.water!.deep > 0).toBe(settings.river === 'river');
    expect(hasFord(world.waterMap)).toBe(true);
    expect(world.summary.reachableSurfaceCells).toBeGreaterThan(1000);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      expect(world.heightMap[(world.spawn.y + dy) * WIDTH + world.spawn.x + dx]).toBe(world.spawn.z);
  });

  it.each([0, -1, 17, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])('retains deterministic safe-seed behavior for %s', seed => {
    const world = generateWorld(seed, { river: 'river' });
    expect(geometryErrors(world)).toEqual([]);
    expect(generateWorld(seed, { river: 'river' })).toEqual(world);
  });

  it('connects every supplied tributary and outlet, including headwaters, without crossing the landing patch', () => {
    const route: RiverRoute = { inflow: ['north', 'west', 'east'], outflow: 'south' };
    const world = generateWorld(73129, { river: 'river' }, 4, route), connected = surfaceConnected(world.waterMap);
    for (const port of [32, 63 * WIDTH + 32, 32 * WIDTH, 32 * WIDTH + 63]) expect(connected.has(port)).toBe(true);
    expect(geometryErrors(world)).toEqual([]);
    const source = generateWorld(73129, { river: 'creek' }, 4, { inflow: [], outflow: 'east' });
    expect(source.waterMap[32 * WIDTH + 63]).toBe(1);
    expect(source.waterMap[32]).toBe(0);
    expect(source.waterMap[32 * WIDTH]).toBe(0);
    expect(source.waterMap[63 * WIDTH + 32]).toBe(0);
  });

  it('uses independent preview masks and counts visible surface area rather than deep-water voxel volume', () => {
    const world = generateWorld(73129, { river: 'river' }), preview = previewWorld(73129, { river: 'river' });
    expect(preview.waterMap).toEqual(world.waterMap);
    expect('water' in preview).toBe(false);
    expect(preview.summary).toEqual(world.summary);
    preview.waterMap.fill(0);
    expect(previewWorld(73129, { river: 'river' }).waterMap).toEqual(world.waterMap);
    expect(world.water.filter(value => value === 2).length).toBe(world.summary.water!.deep * 2);
    const shallow = world.water.findIndex(value => value === 1);
    world.blocks[shallow] = Block.Wood;
    const bridged = summarizeWorld(world.blocks, world.trees, world.spawn, world.settings, undefined, world.water);
    expect(bridged.water).toEqual({ ...world.summary.water, bridgeable: world.summary.water!.bridgeable - 1 });
    expect(summarizeWorld(world.blocks, world.trees, world.spawn, world.settings, new Uint8Array(CELLS), world.water).water)
      .toEqual({ shallow: 0, deep: 0, bridgeable: 0 });
  });
});

describe('world drainage and durable versioned site identity', () => {
  it.each([73129, 17, 0, -1, Number.MAX_SAFE_INTEGER])('connects adjacent tributaries and drains every channel to an ocean for %s', seed => {
    const map = generateRegions(seed, 2), channels = map.tiles.filter(tile => tile.river);
    expect(map.version).toBe(2);
    expect(channels.length).toBeGreaterThan(20);
    expect(channels.some(tile => tile.river!.inflow.length >= 2)).toBe(true);
    expect(channels.some(tile => tile.river!.kind === 'river')).toBe(true);
    for (const source of channels) {
      const seen = new Set<number>();
      let current = source;
      while (current.biome !== 'ocean') {
        expect(seen.has(current.id)).toBe(false); seen.add(current.id);
        expect(current.river!.outflow).not.toBeNull();
        const next = map.tiles[current.river!.outflow!];
        const dx = Math.abs(next.x - current.x), dy = Math.abs(next.y - current.y);
        expect((dy === 1 && dx === 0) || (dy === 0 && (dx === 1 || dx === map.width - 1))).toBe(true);
        if (next.biome !== 'ocean') {
          expect(next.river!.inflow).toContain(current.id);
          expect(next.river!.accumulation).toBeGreaterThan(current.river!.accumulation);
          expect(next.river!.drainageElevation).toBeLessThanOrEqual(current.river!.drainageElevation);
        }
        current = next;
      }
    }
  });

  it('preserves v1/v2 identities exactly and resolves v3 to matching local water generation', () => {
    const first = resolveWorldSite({ version: 1, worldSeed: 73129, tileId: 714 }),
      second = resolveWorldSite({ version: 2, worldSeed: 73129, tileId: 714 });
    expect(first.settings).toEqual({ biome: 'temperate', hilliness: 'small', meanTemperature: 16.7, rainfall: 1055, latitude: -18.75 });
    expect(second.settings).toEqual(first.settings);
    expect(second.tile).toEqual(first.tile);
    expect(first.seed).toBe(3951304940);
    const riverTile = generateRegions(73129, 2).tiles.find(tile => tile.settleable && tile.river?.inflow.length === 2)!;
    const third = resolveWorldSite({ version: 3, worldSeed: 73129, tileId: riverTile.id });
    expect(third.generator).toBe(4);
    expect(third.settings.river).toBe(riverTile.river!.kind);
    expect(third.riverRoute).toEqual(riverRouteForTile(riverTile));
    const local = generateWorld(third.seed, third.settings, third.generator, third.riverRoute);
    expect(local.summary.water!.shallow).toBeGreaterThan(0);
    expect(validateWorldSiteIdentity({ worldSite: third.site, generator: third.generator, seed: third.seed, settings: third.settings })).toEqual(third.site);
    expect(() => validateWorldSiteIdentity({ worldSite: third.site, generator: 3, seed: third.seed, settings: third.settings })).toThrow();
    expect(() => validateWorldSiteIdentity({ worldSite: third.site, generator: 4, seed: third.seed, settings: { ...third.settings, river: 'none' } })).toThrow();
  });

  it('isolates cache results, wraps longitude, and preserves deterministic data after cache eviction', () => {
    const a = generateRegions(73129, 2), b = generateRegions(73129, 2);
    expect(a).toEqual(b);
    const wet = a.tiles.find(tile => tile.river && tile.settings)!;
    wet.river!.inflow.push(-1); wet.settings!.river = 'none';
    expect(regionTile(73129, wet.id, 2)).toEqual(b.tiles[wet.id]);
    for (let seed = 100; seed < 106; seed++) generateRegions(seed, 2);
    expect(generateRegions(73129, 2)).toEqual(b);
    expect(generateRegions(73129 + 4294967296, 2)).not.toEqual(b);
    expect(generateRegions(73129).version).toBe(1);
    expect(regionTile(73129, 714).river).toBeUndefined();
  });
});
