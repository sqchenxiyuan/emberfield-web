import { unfinishedExpectedField } from './legacy-unfinished-defaults';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, index, type VoxelSave, type WorldSettings } from '../src/voxel/types';
import * as regions from '../src/voxel/regions';
import * as worldgen from '../src/voxel/worldgen';
import { validateWorldSiteIdentity } from '../src/voxel/regionPersistence';

const site: regions.WorldSite = { version: 1, worldSeed: 73129, tileId: 714 };
const fixtureHash = '87a71ecab92734bcc6f306838699494f01bd62254b4ebfbb15b4e5e4baa36beb';
// Loading rebuilds transient scheduling explanations while preserving state.
const persistent = (save: VoxelSave) => ({ ...save, pawns: save.pawns.map(({ reason, ...pawn }) => pawn) });
function historical() {
  const bytes = readFileSync(new URL('./fixtures/voxel-v34-regions-active.json', import.meta.url));
  const proof = JSON.parse(readFileSync(new URL('./fixtures/voxel-v34-regions-active.provenance.json', import.meta.url), 'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixtureHash);
  expect(proof).toMatchObject({ version: 34, sha256: fixtureHash,
    sourceCommit: 'e9b007e25866a775373665d8c2d06a23eae3a36a', terrainChangedCells: 55 });
  const raw = JSON.parse(bytes.toString()); expect(raw.version).toBe(34); return raw;
}
afterEach(() => vi.restoreAllMocks());

describe('persistent world region identity', () => {
  it('derives the exact preview terrain, climate and independent local seed from a selected site', () => {
    const resolved = regions.resolveWorldSite(site), before = structuredClone(site);
    const generated = worldgen.generateWorld(resolved.seed, resolved.settings, resolved.generator);
    const sim = VoxelSimulation.fromWorldSite(site);
    expect(site).toEqual(before); expect(sim.seed).toBe(resolved.seed);
    expect(sim.settings).toEqual(resolved.settings); expect(sim.generator).toBe(2);
    expect(sim.blocks).toEqual(generated.blocks); expect(sim.spawn).toEqual(generated.spawn);
    expect(sim.snapshot().worldSite).toEqual(site); expect(sim.save().worldSite).toEqual(site);
    expect(sim.worldSite).not.toBe(site);
  });

  it('restores edited local terrain with one tile resolution and no world or local regeneration', () => {
    const sim = VoxelSimulation.fromWorldSite(site);
    // Controlled edit tests persisted local terrain, independently of the real
    // command-only v34 checkpoint used by the migration test below.
    sim.blocks[index(0, 0, 1)] = Block.Steel;
    const saved = sim.save(), before = structuredClone(saved);
    const resolve = vi.spyOn(regions, 'resolveWorldSite');
    const map = vi.spyOn(regions, 'generateRegions');
    const generate = vi.spyOn(worldgen, 'generateWorld');
    const loaded = VoxelSimulation.load(saved);
    expect(resolve).toHaveBeenCalledTimes(1); expect(map).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
    expect(saved).toEqual(before); expect(persistent(loaded.save())).toEqual(persistent(saved));
    expect(VoxelSimulation.load(loaded.save()).save()).toEqual(loaded.save());
    expect(loaded.blocks[index(0, 0, 1)]).toBe(Block.Steel);
  });

  it('returns independent site copies in saves and snapshots', () => {
    const sim = VoxelSimulation.fromWorldSite(site), saved = sim.save(), snapshot = sim.snapshot();
    saved.worldSite!.tileId = 0; snapshot.worldSite!.worldSeed = 0;
    expect(sim.worldSite).toEqual(site); expect(sim.save().worldSite).toEqual(site);
  });

  it.each([
    null, undefined, [], {}, { ...site, version: 4 }, { ...site, extra: true },
    { ...site, tileId: -1 }, { ...site, tileId: 1152 }, { ...site, tileId: 1.5 },
    { ...site, worldSeed: NaN }, { ...site, worldSeed: Infinity }, { ...site, worldSeed: '73129' },
  ])('rejects malformed creation input without changing it: %j', invalid => {
    const before = structuredClone(invalid);
    expect(() => VoxelSimulation.fromWorldSite(invalid)).toThrow(); expect(invalid).toEqual(before);
  });

  it.each(['ocean', 'impassable'] as const)('rejects a %s region for creation and loading', kind => {
    const tile = regions.generateRegions(site.worldSeed).tiles.find(t => kind === 'ocean' ? t.biome === kind : t.hilliness === kind)!;
    expect(tile).toBeTruthy(); const invalid = { ...site, tileId: tile.id };
    expect(() => VoxelSimulation.fromWorldSite(invalid)).toThrow();
    const saved = VoxelSimulation.fromWorldSite(site).save(); saved.worldSite = invalid;
    const before = structuredClone(saved); expect(() => VoxelSimulation.load(saved)).toThrow(); expect(saved).toEqual(before);
  });

  it.each([
    ['seed', (d: VoxelSave) => { d.seed++; }],
    ['generator', (d: VoxelSave) => { d.generator = 1; }],
    ['biome', (d: VoxelSave) => { d.settings.biome = 'desert'; }],
    ['hilliness', (d: VoxelSave) => { d.settings.hilliness = 'mountainous'; }],
    ['temperature', (d: VoxelSave) => { d.settings.meanTemperature++; }],
    ['rainfall', (d: VoxelSave) => { d.settings.rainfall++; }],
    ['latitude', (d: VoxelSave) => { d.settings.latitude++; }],
  ] as const)('rejects contradictory %s without repairing or mutating the saved colony', (_name, mutate) => {
    const saved = VoxelSimulation.fromWorldSite(site).save(); mutate(saved);
    const before = structuredClone(saved);
    expect(() => VoxelSimulation.load(saved)).toThrow(/地区身份.*不一致/); expect(saved).toEqual(before);
  });

  it('requires the current field and exact settings instead of silently normalizing identity', () => {
    const saved: Record<string, any> = VoxelSimulation.fromWorldSite(site).save();
    for (const mutate of [(d: any) => { delete d.worldSite; }, (d: any) => { d.worldSite = undefined; },
      (d: any) => { d.worldSite = {}; }, (d: any) => { d.settings.extra = true; },
      (d: any) => { delete d.settings.rainfall; }]) {
      const invalid = structuredClone(saved); mutate(invalid); const before = structuredClone(invalid);
      expect(() => VoxelSimulation.load(invalid)).toThrow(); expect(invalid).toEqual(before);
    }
    const reordered = { ...saved, settings: Object.fromEntries(Object.entries(saved.settings).reverse()) as unknown as WorldSettings };
    expect(validateWorldSiteIdentity(reordered)).toEqual(site);
  });

  it('keeps free-form and historical camps explicitly unbound', () => {
    const sim = new VoxelSimulation(73129, { biome: 'desert', rainfall: 120 });
    expect(sim.worldSite).toBeNull(); expect(sim.snapshot().worldSite).toBeNull();
    expect(VoxelSimulation.load(sim.save()).worldSite).toBeNull();
  });
});

describe('authentic v34 world-site migration', () => {
  it('adds null identity while preserving edited terrain, the live installation and its carried original', () => {
    const old = historical(), before = structuredClone(old);
    const generate = vi.spyOn(worldgen, 'generateWorld'), resolve = vi.spyOn(regions, 'resolveWorldSite');
    const sim = VoxelSimulation.load(old), saved = sim.save();
    expect(old).toEqual(before); expect(saved.version).toBe(46); expect(saved.worldSite).toBeNull();
    expect(generate).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
    for (const key of ['seed', 'generator', 'settings', 'tick', 'nextId', 'blocks', 'ladders', 'structureKinds',
      'items', 'stats', 'trade', 'beds', 'tables', 'chairs', 'stockpiles'] as const) expect(saved[key], key).toEqual(unfinishedExpectedField(key, old[key]));
    const jobs = (values: any[]) => values.map(({ owner, reason, ...job }) => job);
    expect(jobs(saved.jobs)).toEqual(jobs(old.jobs)); expect(saved.jobs.some(j => j.kind === 'install')).toBe(true);
    expect(saved.pawns.map(p => p.cargo)).toEqual(old.pawns.map((p: any) => p.cargo));
    expect(saved.pawns.some(p => p.cargo?.resource === 'furniture')).toBe(true);
    expect(VoxelSimulation.load(saved).save()).toEqual(saved);
  });

  it.each([null, site, undefined])('rejects a new field smuggled into v34, including %j', value => {
    const old = historical(); old.worldSite = value; const before = structuredClone(old);
    expect(() => VoxelSimulation.load(old)).toThrow(/旧版本.*地区身份/); expect(old).toEqual(before);
  });

  it('preserves generator-1 legacy terrain and never attaches a guessed site', () => {
    const old = JSON.parse(readFileSync(new URL('./fixtures/voxel-v7-start.json', import.meta.url), 'utf8'));
    const before = structuredClone(old), sim = VoxelSimulation.load(old), saved = sim.save();
    expect(old).toEqual(before); expect(saved.generator).toBe(1); expect(saved.worldSite).toBeNull();
    expect(saved.blocks).toEqual(old.blocks); expect(saved.ladders).toEqual(old.ladders);
  });
});
