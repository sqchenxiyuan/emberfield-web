import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { freshBatch } from '../src/voxel/preservation';
import { batchHitPoints } from '../src/voxel/deterioration';
import { migrateEnvironment, rejectLegacyEnvironmentFields } from '../src/voxel/environmentPersistence';
import { stripEnvironmentFields } from './legacy-environment-defaults';
import { stripWeatherFields } from './legacy-weather-defaults';
import type { Pawn, VoxelSave } from '../src/voxel/types';
import { relocationExpectedField } from './legacy-relocation-defaults';

const hashes = {
  delivered: '322af75da0919f6278c9042e96d6b3e2af1dfe75a3cf3c8d277983a78f2ac703',
  snow: '77af8979d89d1cf974277866623f13108fe6c01da86ce7f6bdc3d6aa0da07ed3',
} as const;
function historical(name: keyof typeof hashes) {
  const bytes = readFileSync(new URL(`./fixtures/voxel-v27-environment-${name}.json`, import.meta.url));
  const proof = JSON.parse(readFileSync(new URL(`./fixtures/voxel-v27-environment-${name}.provenance.json`, import.meta.url), 'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(hashes[name]);
  expect(proof).toMatchObject({ version: 27, sha256: hashes[name],
    sourceCommit: 'aaf194de071353ada1c60de6158fe53a05e42adb', publishedCommit: '6fafecf8232395532da5d24ac6cdbfa05724c81d' });
  return JSON.parse(bytes.toString('utf8'));
}
const corePawn = (p: Pawn) => ({ id: p.id, name: p.name, x: p.x, y: p.y, z: p.z,
  faction: p.faction, food: p.food, rest: p.rest, health: p.health, trauma: p.trauma,
  medical: p.medical, skills: p.skills, worn: p.worn, weapon: p.weapon, cargo: p.cargo, psyche: p.psyche });
function synthetic() {
  return { version: 28, items: [freshBatch('wood', 3)], animals: [],
    pawns: [{ cargo: freshBatch('meal', 1), psyche: { memories: [] } }],
    jobs: [{ delivered: { wood: 2, grain: 4 }, deliveredBatches: [freshBatch('wood', 2),
      { ...freshBatch('grain', 4, 'potato'), rotProgress: 123 }] }],
    trade: { caravans: [], receipts: [] } } as Record<string, any>;
}

describe('authentic v27 environment migration', () => {
  it.each(['delivered', 'snow'] as const)('preserves genuine %s bytes, calendars, physical goods and prior progress', name => {
    const old = historical(name), before = JSON.stringify(old), s = VoxelSimulation.load(old);
    expect(old.version).toBe(27); expect(s.save().version).toBe(45); expect(s.tick).toBe(old.tick);
    expect(JSON.stringify(old)).toBe(before);
    for (const key of ['weather', 'snow', 'items', 'stats', 'fires', 'fireDamage', 'fireHazards', 'fireLog', 'trade', 'filth'] as const)
      expect(s[key], key).toEqual(relocationExpectedField(key, old[key]));
    expect(s.animals).toMatchObject(old.animals);
    expect(s.pawns.map(corePawn)).toMatchObject(old.pawns.map(corePawn));
    expect(s.pawns.every(p => !p.psyche.memories.some(m => m.kind === 'wet'))).toBe(true);
    for (const previous of old.jobs) {
      const job = s.jobs.find(j => j.id === previous.id)!;
      expect(job).toMatchObject({ id: previous.id, kind: previous.kind, work: previous.work,
        progress: previous.progress, workTicks: previous.workTicks, delivered: previous.delivered, cost: previous.cost });
      expect(job).not.toHaveProperty('deliveredFood');
      for (const [resource, count] of Object.entries(previous.delivered))
        expect(job.deliveredBatches.filter(b => b.resource === resource).reduce((sum, b) => sum + b.amount, 0)).toBe(count);
    }
    if (name === 'delivered') expect(s.jobs[0].deliveredBatches).toEqual([freshBatch('steel', 74)]);
    else expect(s.snow).toHaveLength(4096);
    const copy = VoxelSimulation.load(s.save());
    expect(copy.items).toEqual(s.items); expect(copy.snow).toEqual(s.snow); expect(copy.weather).toEqual(s.weather);
    expect(copy.jobs.map(j => j.deliveredBatches)).toEqual(s.jobs.map(j => j.deliveredBatches));
  });
  it('keeps old food species, age and contamination while adding only formerly counter-only material batches', () => {
    const source = { jobs: [{ delivered: { grain: 10, wood: 1 }, deliveredFood: [
      { ...freshBatch('grain', 6, 'rice'), rotProgress: 100 },
      { ...freshBatch('grain', 4, 'potato'), rotProgress: 200 }] },
      { delivered: { meal: 2 }, deliveredFood: [{ ...freshBatch('meal', 2), rotProgress: 300, poisonChance: .2 }] }] } as Record<string, any>;
    const original = structuredClone(source);
    migrateEnvironment(source, 27);
    expect(source.jobs[0].deliveredBatches).toEqual([...original.jobs[0].deliveredFood, freshBatch('wood', 1)]);
    expect(source.jobs[1].deliveredBatches).toEqual(original.jobs[1].deliveredFood);
    expect(source.jobs.every((j: any) => !Object.hasOwn(j, 'deliveredFood'))).toBe(true);
  });
  it('rejects mismatched old counters, duplicate food and unknown material instead of repairing them', () => {
    const valid = { delivered: { wood: 2 }, deliveredFood: [] };
    const invalid = [
      { delivered: { grain: 1 }, deliveredFood: [] },
      { delivered: { grain: 2 }, deliveredFood: [freshBatch('grain', 1), freshBatch('grain', 1)] },
      { delivered: { grain: 1 }, deliveredFood: [{ resource: 'grain', amount: 1 }] },
      { delivered: { wood: 2 }, deliveredFood: [freshBatch('wood', 2)] },
      { delivered: { wood: -1 }, deliveredFood: [] },
      { delivered: { stone: 1.5 }, deliveredFood: [] },
      { delivered: { unknown: 1 }, deliveredFood: [] },
      { delivered: { weapon: 1 }, deliveredFood: [] },
    ];
    for (const job of invalid) {
      const source = { jobs: [structuredClone(valid), job] }, before = structuredClone(source);
      expect(() => migrateEnvironment(source, 27)).toThrow(/环境存档/);
      expect(source).toEqual(before);
    }
  });
});

describe('v28 strict HP and legacy-field boundaries', () => {
  it('preserves damaged ground/cargo/delivered batches, corpse HP and wet memory through a real save/load', () => {
    // Controlled schema fixture. The authentic source bytes above remain unchanged.
    const s = VoxelSimulation.load(historical('delivered'));
    s.items.find(i => i.resource === 'wood')!.hitPoints = 75;
    s.pawns[0].cargo = { ...freshBatch('grain', 5), hitPoints: 30, rotProgress: 100 };
    s.pawns[0].psyche.memories.push({ kind: 'wet', expires: s.tick + 1200 });
    s.jobs[0].delivered.components = 2;
    s.jobs[0].deliveredBatches.push({ ...freshBatch('components', 2), hitPoints: 35 });
    Object.assign(s.animals[0], { dead: true, health: 0, phase: 'dead', hunt: false, rotProgress: 200, carcassHitPoints: 40 });
    const saved = s.save(), copy = VoxelSimulation.load(saved);
    expect(copy.items).toEqual(saved.items); expect(copy.pawns[0].cargo).toEqual(saved.pawns[0].cargo);
    expect(copy.jobs[0].deliveredBatches).toEqual(saved.jobs[0].deliveredBatches);
    expect(copy.animals[0]).toEqual(saved.animals[0]); expect(copy.pawns[0].psyche).toEqual(saved.pawns[0].psyche);
    expect(batchHitPoints(copy.pawns[0].cargo!)).toBe(30);
    expect(() => VoxelSimulation.load(copy.save())).not.toThrow();
  });
  it('rejects a supplied corpse HP on living animals or outside integer 1..100', () => {
    const saved = VoxelSimulation.load(historical('delivered')).save();
    for (const hitPoints of [0, -1, .5, 101, NaN, Infinity, null, '50']) {
      const invalid = structuredClone(saved) as any;
      Object.assign(invalid.animals[0], { dead: true, health: 0, phase: 'dead', hunt: false, carcassHitPoints: hitPoints });
      expect(() => VoxelSimulation.load(invalid), String(hitPoints)).toThrow(/野生动物状态/);
    }
    const living = structuredClone(saved); living.animals[0].carcassHitPoints = 100;
    expect(() => VoxelSimulation.load(living)).toThrow(/野生动物状态/);
    const dead = structuredClone(saved); Object.assign(dead.animals[0], { dead: true, health: 0, phase: 'dead', hunt: false });
    expect(() => VoxelSimulation.load(dead)).not.toThrow();
    for (const hitPoints of [1, 100]) {
      dead.animals[0].carcassHitPoints = hitPoints;
      expect(VoxelSimulation.load(dead).animals[0].carcassHitPoints).toBe(hitPoints);
    }
  });
  it('rejects malformed ground HP and desynchronized delivered materials without mutating caller data', () => {
    const saved = VoxelSimulation.load(historical('delivered')).save();
    const mutations: ((s: VoxelSave) => void)[] = [
      s => { s.items.find(i => i.resource === 'wood')!.hitPoints = 0; },
      s => { s.items.find(i => i.resource === 'wood')!.hitPoints = 151; },
      s => { s.items.find(i => i.resource === 'steel')!.hitPoints = 1; },
      s => { s.jobs[0].deliveredBatches = []; },
      s => { s.jobs[0].deliveredBatches[0].amount--; },
      s => { (s.jobs[0] as any).deliveredFood = []; },
    ];
    for (const mutate of mutations) {
      const raw = structuredClone(saved); mutate(raw); const before = structuredClone(raw);
      expect(() => VoxelSimulation.load(raw)).toThrow(); expect(raw).toEqual(before);
    }
  });
  it('rejects v28-only state under every older version across all physical and historical batch containers', () => {
    const carrierCases = [
      { items: [{ hitPoints: 100 }] },
      { pawns: [{ cargo: { hitPoints: 1 } }] },
      { jobs: [{ deliveredFood: [{ hitPoints: 1 }] }] },
      { jobs: [{ deliveredBatches: [] }] },
      { animals: [{ carcassHitPoints: 100 }] },
      { pawns: [{ psyche: { memories: [{ kind: 'wet', expires: 1 }] } }] },
      { trade: { caravans: [{ stock: [{ hitPoints: 1 }] }] } },
      { trade: { receipts: [{ transferred: [{ batch: { hitPoints: 1 } }] }] } },
    ];
    for (const version of [1, 5, 21, 26, 27]) for (const fields of carrierCases)
      expect(() => rejectLegacyEnvironmentFields({ version, ...fields })).toThrow(/旧版本包含新版/);
    expect(() => rejectLegacyEnvironmentFields({ version: 27, items: [{ apparel: { hitPoints: 1 } },
      { weapon: { hitPoints: 1 } }] })).not.toThrow();
    expect(() => rejectLegacyEnvironmentFields({ version: 28, jobs: [{ deliveredFood: [] }] })).toThrow(/旧配送/);
  });
});

describe('synthetic legacy downgrade guard', () => {
  it('restores only old-compatible food containers while retaining all material counters', () => {
    const raw = synthetic(), before = structuredClone(raw);
    stripEnvironmentFields(raw);
    expect(raw.jobs[0].delivered).toEqual(before.jobs[0].delivered);
    expect(raw.jobs[0].deliveredFood).toEqual([before.jobs[0].deliveredBatches[1]]);
    expect(raw.jobs[0]).not.toHaveProperty('deliveredBatches');
    migrateEnvironment(raw, 27);
    expect(raw.jobs[0].deliveredBatches).toEqual([before.jobs[0].deliveredBatches[1], before.jobs[0].deliveredBatches[0]]);
  });
  it('refuses to discard actual HP, wet memories or inconsistent physical inputs', () => {
    const changes = [
      (s: any) => { s.items[0].hitPoints = 149; },
      (s: any) => { s.pawns[0].cargo.hitPoints = 49; },
      (s: any) => { s.jobs[0].deliveredBatches[0].hitPoints = 149; },
      (s: any) => { s.animals.push({ carcassHitPoints: 100 }); },
      (s: any) => { s.pawns[0].psyche.memories.push({ kind: 'wet', expires: 0 }); },
      (s: any) => { s.trade.caravans.push({ stock: [{ hitPoints: 100 }] }); },
      (s: any) => { s.trade.receipts.push({ transferred: [{ batch: { hitPoints: 100 } }] }); },
      (s: any) => { s.jobs[0].delivered.wood++; },
    ];
    for (const mutate of changes) {
      const raw = synthetic(); mutate(raw); const before = structuredClone(raw);
      expect(() => stripEnvironmentFields(raw)).toThrow(); expect(raw).toEqual(before);
    }
  });
  it('removes environment defaults before the weather helper downgrades a synthetic empty world', () => {
    const s = new VoxelSimulation(73129), raw = s.save() as unknown as Record<string, any>;
    stripWeatherFields(raw);
    expect(raw).not.toHaveProperty('weather'); expect(raw).not.toHaveProperty('snow');
    expect(() => rejectLegacyEnvironmentFields({ ...raw, version: 26 })).not.toThrow();
  });
});
