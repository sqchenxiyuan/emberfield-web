import { initialAnimalPenState } from '../src/voxel/pens';
import { relocationExpectedField } from './legacy-relocation-defaults';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { initialAnimalState } from '../src/voxel/husbandry';
import { initialSkills } from '../src/voxel/skills';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { batchHitPoints } from '../src/voxel/deterioration';
import { freshBatch } from '../src/voxel/preservation';
import { Block, at, index, type Pos, type WildAnimal } from '../src/voxel/types';

const HASHES = {
  initial: '459da967705a49065a970c26a840785928bf975dea1ed8403c578705531dbf77',
  protected: 'c76f3351da0af4dc4a1b6fcc89bbe954a3fefc758c39b1c0f0c24c09341f5ed5',
  final: 'ee6dd5ca35f64549e3c241215ee04708c7958ba2a212630c88eb10053fdb9f2b',
} as const;
function historical(name: keyof typeof HASHES) {
  const bytes = readFileSync(new URL(`./fixtures/voxel-v28-husbandry-${name}.json`, import.meta.url));
  const provenance = JSON.parse(readFileSync(new URL(`./fixtures/voxel-v28-husbandry-${name}.provenance.json`, import.meta.url), 'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(HASHES[name]);
  expect(provenance).toMatchObject({ version: 28, sha256: HASHES[name],
    source: `test-results/voxel-environment/${name}.json`, campaignExecution: {
      bundleSha256: 'aeb1704abd3f3d45462f0ac6741bd3c035e153d8a396136b7cca82eb5d63d29c',
      scriptSha256: '38484375b23caf8c3233e5769c3f05b3d57c1323501ab8643ae97aba9f457011',
    } });
  const old = JSON.parse(bytes.toString('utf8'));
  expect(old.version).toBe(28); expect(old.tick).toBe(provenance.tick);
  return old;
}

describe('authentic v28 husbandry migration', () => {
  it.each(['initial', 'protected', 'final'] as const)('retains genuine %s checkpoint state and seeds grass without allocating identities', name => {
    const old = historical(name), before = structuredClone(old), s = VoxelSimulation.load(old), saved = s.save();
    expect(old).toEqual(before); expect(saved.version).toBe(38);
    expect(saved.tick).toBe(old.tick); expect(saved.nextId).toBe(old.nextId);
    expect(saved.animals).toHaveLength(old.animals.length);
    for (const previous of old.animals) {
      const a = saved.animals.find(a => a.id === previous.id)!;
      const added = initialAnimalState(a.id, a.species, old.tick);
      expect(a).toEqual({ ...previous, ...added });
    }
    for (const previous of old.pawns) {
      const p = saved.pawns.find(p => p.id === previous.id)!;
      expect(p.skills).toEqual({ ...previous.skills, animals: initialSkills(old.pawns.indexOf(previous), previous.faction !== 'colony').animals });
      expect(p.priorities).toEqual({ ...previous.priorities, handle: previous.faction === 'colony' ? 2 : 0 });
      expect(p.handleTask).toBeNull();
      for (const key of ['x', 'y', 'z', 'name', 'faction', 'food', 'rest', 'health', 'trauma', 'medical',
        'weapon', 'worn', 'cargo', 'psyche', 'dirtCarry', 'foodPoisoning'] as const) expect(p[key], `${p.id}.${key}`).toEqual(key === 'psyche' ? { ...previous.psyche, tolerance: { ...previous.psyche.tolerance, social: 0 } } : previous[key]);
    }
    for (const key of ['items', 'stats', 'trade', 'weather', 'snow', 'fires', 'fireDamage', 'fireHazards',
      'fireLog', 'filth', 'crops', 'trees', 'beds', 'research', 'blocks', 'ladders', 'structureKinds'] as const)
      expect(saved[key], key).toEqual(key === 'beds' ? old.beds.map((b:any)=>({...b,quality:2})) : relocationExpectedField(key, old[key]));
    expect(saved.grass.length).toBeGreaterThan(0);
    expect(new Set(saved.grass.map(at)).size).toBe(saved.grass.length);
    expect(saved.grass.every(g => s.animalGrassSite(g) && g.growth === 1)).toBe(true);
    expect(saved.husbandryLog).toEqual([]);
    if (name !== 'initial') {
      const damaged = saved.items.find(i => i.id === 474)!;
      expect(damaged).toMatchObject({ resource: 'wood', amount: 23, hitPoints: 148 });
      expect(batchHitPoints(damaged)).toBe(148);
      expect(batchHitPoints(saved.items.find(i => i.id === 444)!)).toBe(150);
    }
    const again = VoxelSimulation.load(saved).save();
    expect(again.grass).toEqual(saved.grass); expect(again.animals).toEqual(saved.animals);
    expect(again.items).toEqual(saved.items); expect(again.stats).toEqual(saved.stats); expect(again.nextId).toBe(old.nextId);
  });
  it('does not replenish consumed or removed grass or duplicate animals on subsequent current-version loads', () => {
    const old = historical('protected'), s = VoxelSimulation.load(old), original = s.grass.length;
    // Explicit current-schema mutation models persisted depletion/removal; it
    // does not modify or claim to be part of the archived v28 source run.
    s.grass[0].growth = 0; s.grass[1].growth = .125;
    const removed = at(s.grass.pop()!); const saved = s.save();
    let current = saved;
    for (let i = 0; i < 3; i++) current = VoxelSimulation.load(current).save();
    expect(current.grass).toEqual(saved.grass); expect(current.grass).toHaveLength(original - 1);
    expect(current.grass.some(g => at(g) === removed)).toBe(false);
    expect(current.animals).toEqual(saved.animals); expect(current.nextId).toBe(saved.nextId);
    const empty = structuredClone(saved); empty.grass = [];
    expect(VoxelSimulation.load(empty).grass).toEqual([]);
  });
  it('rejects every current husbandry field smuggled into genuine old source without mutating input', () => {
    const baseline = historical('protected');
    const variants: ((d: any) => void)[] = [d => { d.grass = []; }, d => { d.husbandryLog = []; },
      d => { d.pawns[0].handleTask = null; }, d => { d.pawns[0].priorities.handle = 0; },
      d => { d.pawns[0].skills.animals = initialSkills(0).animals; }, d => { d.pawns[0].phase = 'handle'; },
      ...['eat', 'mate', 'interact'].map(phase => (d: any) => { d.animals[0].phase = phase; }),
      ...Object.entries(initialAnimalState(baseline.animals[0].id, baseline.animals[0].species, baseline.tick))
        .filter(([key])=>!Object.hasOwn(initialAnimalPenState(0),key))
        .map(([key, value]) => (d: any) => { d.animals[0][key] = value; })];
    for (const mutate of variants) {
      const old = structuredClone(baseline); mutate(old); const before = structuredClone(old);
      expect(() => VoxelSimulation.load(old)).toThrow(/旧版本包含新版动物/); expect(old).toEqual(before);
    }
  });
});

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
/** Controlled current-world integration fixture, kept separate from immutable
 * historical source bytes. Only time advancement drives the activities below. */
function activityFixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  s.animals = []; s.grass = []; s.items = []; s.trees = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 28; x++) for (let y = 10; y <= 22; y++) for (let z = 8; z < 16; z++)
    s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(12, 16 + i)); p.schedule.fill('work');
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
  }
  return VoxelSimulation.load(s.save());
}
function addAnimal(s: VoxelSimulation, changes: Partial<WildAnimal> = {}) {
  const id = s.nextId++;
  const a: WildAnimal = { ...pos(22), ...initialAnimalState(id, 'hare', s.tick), id, species: 'hare', name: '野兔',
    health: ANIMAL_DEFS.hare.health, hunger: 80, dead: false, phase: 'roam', hunt: false,
    moveTick: 0, decisionTick: 1000000, fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0, ...changes };
  s.animals.push(a); return a;
}
function until(s: VoxelSimulation, predicate: () => boolean, limit = 1800) {
  for (let i = 0; i < limit && !predicate(); i++) s.step();
  expect(predicate(), `tick=${s.tick}; activities=${s.pawns.map(p => p.reason).join(';')}`).toBe(true);
}
function physicalState(s: VoxelSimulation) {
  return { nextId: s.nextId, animals: s.animals, grass: s.grass, items: s.items, stats: s.stats,
    log: s.husbandryLog, handlers: s.pawns.map(p => ({ id: p.id, task: p.handleTask, cargo: p.cargo })) };
}

describe('current husbandry activities survive exact save/load', () => {
  it('resumes real grazing progress and consumes the finite patch exactly once', () => {
    const s = activityFixture(), a = addAnimal(s, { hunger: 30, decisionTick: 0 });
    s.blocks[index(a.x, a.y, 7)] = Block.Soil; s.grass = [{ x: a.x, y: a.y, z: a.z, growth: .5 }];
    until(s, () => a.phase === 'graze' && a.eatProgress >= 15, 60);
    const saved = s.save(), before = structuredClone(saved), copy = VoxelSimulation.load(saved);
    expect(saved).toEqual(before); expect(physicalState(copy)).toEqual(physicalState(s));
    expect(copy.animals[0].eatProgress).toBe(15);
    s.step(50); copy.step(50);
    expect(physicalState(copy)).toEqual(physicalState(s));
    expect(copy.grass[0].growth).toBe(0); expect(copy.animals[0].hunger).toBeGreaterThan(80);
    expect(VoxelSimulation.load(copy.save()).grass[0].growth).toBe(0);
  });
  it('retains a growing pregnancy without allocating or duplicating offspring during load', () => {
    const s = activityFixture();
    const father = addAnimal(s, { ...pos(26), sex: 'male', faction: 'colony', tameness: 5 });
    const mother = addAnimal(s, { sex: 'female', faction: 'colony', tameness: 5,
      pregnancy: { fatherId: father.id, progress: .5 } });
    s.step(20); const saved = s.save(), copy = VoxelSimulation.load(saved);
    expect(physicalState(copy)).toEqual(physicalState(s)); expect(copy.nextId).toBe(saved.nextId);
    const before = mother.pregnancy!.progress; s.step(100); copy.step(100);
    expect(physicalState(copy)).toEqual(physicalState(s));
    expect(copy.animals.find(a => a.id === mother.id)!.pregnancy!.progress).toBeGreaterThan(before);
    expect(copy.animals).toHaveLength(2); expect(copy.husbandryLog.filter(e => e.kind === 'birth')).toHaveLength(0);
    copy.animals = copy.animals.filter(a => a.id !== father.id);
    expect(VoxelSimulation.load(copy.save()).animals[0].pregnancy!.fatherId).toBe(father.id);
  });
  it('keeps actual carried food metadata and resumes the second feeding with conserved units', () => {
    const s = activityFixture(), a = addAnimal(s), p = s.pawns[0];
    p.priorities.handle = 1; p.skills.animals.level = 8;
    s.items.push({ ...pos(14), id: s.nextId++, ...freshBatch('grain', 30, 'rice'), hitPoints: 37, rotProgress: 345 });
    s.stats.produced.grain = 30;
    expect(s.command({ type: 'animalOrder', animalId: a.id, order: 'tame', enabled: true }).ok).toBe(true);
    until(s, () => p.handleTask?.feedings === 1 && p.handleTask.progress >= 15);
    expect(p.cargo).toMatchObject({ resource: 'grain', crop: 'rice', amount: 1, hitPoints: 37 });
    expect(p.cargo!.rotProgress).toBeGreaterThan(345); expect(s.stats.consumed.grain).toBe(1);
    const saved = s.save(), before = structuredClone(saved), copy = VoxelSimulation.load(saved);
    expect(saved).toEqual(before); expect(physicalState(copy)).toEqual(physicalState(s));
    expect(copy.counts().grain + copy.stats.consumed.grain + copy.stats.spoiled.grain + copy.stats.destroyed.grain).toBe(30);
    s.step(70); copy.step(70);
    expect(physicalState(copy)).toEqual(physicalState(s));
    expect(copy.stats.consumed.grain).toBe(2); expect(copy.pawns[0].handleTask).toBeNull();
    expect(copy.counts().grain + copy.stats.consumed.grain + copy.stats.spoiled.grain + copy.stats.destroyed.grain).toBe(30);
    expect(physicalState(VoxelSimulation.load(copy.save()))).toEqual(physicalState(copy));
  });
});
