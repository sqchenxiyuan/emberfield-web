import { describe, expect, it } from 'vitest';
import { generateRegions, recommendedRegion, regionTile, resolveWorldSite } from '../src/voxel/regions';
import { previewWorld, validWorldSettings } from '../src/voxel/worldgen';
import { growingSeasonDays, outdoorTemperature } from '../src/voxel/climate';

describe('versioned world regions and local-map identity', () => {
  it('keeps the version-1 landing identity stable for existing saves', () => {
    // This is a save-format compatibility vector. Changing v1 climate, terrain or
    // seed derivation would invalidate old saved sites; such changes require v2.
    const result = resolveWorldSite({ version: 1, worldSeed: 73129, tileId: 714 });
    expect(result.generator).toBe(2);
    expect(result.seed).toBe(3951304940);
    expect(result.settings).toEqual({
      biome: 'temperate', hilliness: 'small', meanTemperature: 16.7, rainfall: 1055, latitude: -18.75,
    });
    expect(result.tile).toMatchObject({ x: 42, y: 14, longitude: 138.75, elevation: 747, growingDays: 60 });
  });

  it('versions local caves without changing the region or invalidating v1 selection', () => {
    const old = resolveWorldSite({ version: 1, worldSeed: 73129, tileId: 714 });
    const next = resolveWorldSite({ version: 2, worldSeed: 73129, tileId: 714 });
    expect(next.generator).toBe(3);
    expect(next.seed).toBe(old.seed);
    expect(next.settings).toEqual(old.settings);
    expect(next.tile).toEqual(old.tile);
    expect(next.site.version).toBe(2);
    expect(resolveWorldSite(old.site)).toEqual(old);
  });

  it.each([73129, 17, 111, 0, -1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])(
    'makes a bounded deterministic map with independent local seeds for world %s', (seed) => {
      const a = generateRegions(seed), b = generateRegions(seed);
      expect(a).toEqual(b);
      expect(a.tiles).not.toBe(b.tiles);
      expect(a.tiles).toHaveLength(a.width * a.height);
      expect(a.tiles).toHaveLength(1152);
      expect(new Set(a.tiles.map((tile) => tile.mapSeed)).size).toBe(a.tiles.length);
      expect(a.tiles.some((t) => t.biome === 'ocean')).toBe(true);
      expect(a.tiles.some((t) => t.hilliness === 'impassable' && t.biome !== 'ocean')).toBe(true);
      expect(new Set(a.tiles.filter((t) => t.settleable).map((t) => t.biome)))
        .toEqual(new Set(['temperate', 'boreal', 'desert']));
      for (const tile of a.tiles) {
        expect(tile.id).toBe(tile.y * a.width + tile.x);
        expect(tile).toEqual(regionTile(seed, tile.id));
        if (tile.settleable) {
          expect(validWorldSettings(tile.settings)).toBe(true);
          expect(tile.settings!.latitude).toBe(tile.latitude);
          expect(tile.settings!.meanTemperature).toBe(tile.temperature);
          expect(tile.settings!.rainfall).toBe(tile.rainfall);
          expect(tile.growingDays).toBe(growingSeasonDays(tile.settings!));
          expect(tile.reason).toBeNull();
        } else {
          expect(tile.settings).toBeNull();
          expect(tile.reason).toBeTruthy();
        }
      }
      const recommendation = recommendedRegion(a)!;
      expect(recommendation.settleable).toBe(true);
      expect(recommendation.biome).toBe('temperate');
      expect(recommendation.growingDays).toBeGreaterThanOrEqual(40);
      expect(a).toEqual(b); // recommending never reshapes or warms the chosen region
      const first = a.tiles.find((t) => t.settleable)!;
      first.settings!.rainfall = 3999;
      expect(regionTile(seed, first.id)).toEqual(b.tiles[first.id]);
    },
  );

  it('does not alias the high 32-bit seed half and does not change maps with selection order', () => {
    const a = generateRegions(73129), b = generateRegions(73129 + 4294967296);
    expect(a.tiles.map((t) => t.mapSeed)).not.toEqual(b.tiles.map((t) => t.mapSeed));
    expect(a.tiles.map((t) => t.elevation)).not.toEqual(b.tiles.map((t) => t.elevation));
    for (const id of [714, 200, 1151, 0, 714]) expect(regionTile(a.seed, id)).toEqual(a.tiles[id]);
  });

  it('rejects invalid seeds, ambiguous identity fields and non-landable regions without mutating input', () => {
    const base = { version: 1, worldSeed: 73129, tileId: 714 };
    for (const seed of [NaN, Infinity, -Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1, '73129', null]) {
      expect(() => generateRegions(seed as number)).toThrow();
      expect(() => resolveWorldSite({ ...base, worldSeed: seed })).toThrow();
    }
    for (const site of [null, [], {}, { ...base, version: 3 }, { ...base, tileId: -1 },
      { ...base, tileId: 1152 }, { ...base, tileId: 714.5 }, { ...base, tileId: '714' },
      { ...base, localSeed: 3951304940 }, { version: 1, tileId: 714 }]) {
      const before = structuredClone(site);
      expect(() => resolveWorldSite(site)).toThrow();
      expect(site).toEqual(before);
    }
    for (const tile of generateRegions(base.worldSeed).tiles.filter((t) => !t.settleable))
      expect(() => resolveWorldSite({ ...base, tileId: tile.id })).toThrow(tile.reason!);
    expect(recommendedRegion({ version: 1, seed: 0, width: 0, height: 0, tiles: [] })).toBeNull();
  });

  it('feeds actual local terrain, trees and seasonal climate instead of cosmetic site labels', () => {
    const map = generateRegions(73129);
    const picks = ['temperate', 'boreal', 'desert'].map((biome) =>
      map.tiles.find((tile) => tile.settleable && tile.biome === biome && tile.hilliness === 'small')!);
    const previews = picks.map((tile) => {
      const site = { version: 1 as const, worldSeed: map.seed, tileId: tile.id };
      const resolved = resolveWorldSite(site), before = structuredClone(resolved);
      const preview = previewWorld(resolved.seed, resolved.settings, resolved.generator);
      expect(preview.seed).toBe(tile.mapSeed);
      expect(preview.settings).toEqual(tile.settings);
      expect(preview.summary.growingDays).toBe(tile.growingDays);
      expect(resolved).toEqual(before);
      expect(site).toEqual(resolved.site);
      expect(resolved.site).not.toBe(site);
      expect(resolved.settings).not.toBe(resolved.tile.settings);
      return preview;
    });
    expect(previews[0].surfaceMap).not.toEqual(previews[2].surfaceMap);
    expect(previews[0].heightMap).not.toEqual(previews[2].heightMap);
    expect(previews[0].trees.every((t) => t.species === 'poplar')).toBe(true);
    expect(previews[1].trees.every((t) => t.species === 'pine')).toBe(true);
    expect(previews[2].trees.every((t) => t.species === 'saguaro')).toBe(true);
    expect(outdoorTemperature(0, previews[0].settings)).not.toBe(outdoorTemperature(0, previews[1].settings));
    expect(previews[2].summary.surfaceCounts.sand).toBeGreaterThan(previews[0].summary.surfaceCounts.sand);
    expect(previews[2].summary.fertileCells).toBeLessThan(previews[0].summary.fertileCells);
  });
});
