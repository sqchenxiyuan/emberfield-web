import { describe, expect, it } from 'vitest';
import { milkExpectedField, stripAnimalMilkFields } from './legacy-auto-rebuild-defaults';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, index, type Pos, type VoxelCommand, type WildAnimal } from '../src/voxel/types';
import { initialAnimalState } from '../src/voxel/husbandry';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { autoSlaughterSelection, defaultAutoSlaughter, defaultAutoSlaughterPolicy, validAutoSlaughter,
  validAutoSlaughterPolicy, type AutoSlaughterPolicy } from '../src/voxel/autoSlaughter';

function animal(id: number, extra: Partial<WildAnimal> = {}): WildAnimal {
  return { x: 22, y: 16, z: 8, ...initialAnimalState(id, 'hare', 0), id, species: 'hare', name: ANIMAL_DEFS.hare.name,
    faction: 'colony', tameness: 5, sex: 'male', health: ANIMAL_DEFS.hare.health, hunger: 90,
    dead: false, phase: 'roam', hunt: false, moveTick: 0, decisionTick: 1000000,
    fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0, ...extra };
}
function select(animals: WildAnimal[], policy: Partial<AutoSlaughterPolicy>) {
  const settings = defaultAutoSlaughter(); Object.assign(settings.hare, policy);
  return autoSlaughterSelection(settings, animals);
}
const pos = (x: number, y = 16): Pos => ({ x, y, z: 8 });
/** Explicit controlled integration fixture, not generated-colony evidence. */
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.grass = []; s.items = []; s.trees = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 28; x++) for (let y = 10; y <= 22; y++) for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(12, 16 + i)); p.schedule.fill('work');
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
  }
  s.pawns[0].priorities.handle = 1;
  return VoxelSimulation.load(s.save());
}
function add(s: VoxelSimulation, extra: Partial<WildAnimal> = {}) {
  const a = animal(s.nextId++, extra); s.animals.push(a); return a;
}
function ok(s: VoxelSimulation, c: VoxelCommand) { const result = s.command(c); expect(result.ok, result.message).toBe(true); }
function configure(s: VoxelSimulation, policy: Partial<AutoSlaughterPolicy>) {
  ok(s, { type: 'autoSlaughter', species: 'hare', policy: { ...defaultAutoSlaughterPolicy(), ...policy } });
}
function until(s: VoxelSimulation, condition: () => boolean, limit = 1600) {
  for (let i = 0; i < limit && !condition(); i++) s.step();
  expect(condition(), JSON.stringify(s.pawns.map(p => ({ reason: p.reason, task: p.handleTask })))).toBe(true);
}

describe('derived automatic slaughter quotas', () => {
  it('defaults to unlimited without sharing mutable per-species objects or altering animals', () => {
    const animals = [animal(1), animal(2)], before = structuredClone(animals), settings = defaultAutoSlaughter();
    expect(autoSlaughterSelection(settings, animals).targets).toEqual([]);
    settings.hare.total = 0; expect(settings.deer.total).toBeNull(); expect(defaultAutoSlaughter().hare.total).toBeNull();
    expect(animals).toEqual(before);
  });
  it('selects old adults first and maintains separate young quotas', () => {
    const herd = [animal(1, { ageTicks: 7 * DAY }), animal(2, { ageTicks: 5 * DAY }),
      animal(3, { growth: .5, ageTicks: 2 * DAY }), animal(4, { growth: .1, ageTicks: DAY })];
    expect(select(herd, { male: 1, youngMale: 1 }).targets).toEqual([1, 3]);
    expect(select(herd, { male: 0 }).targets).toEqual([1, 2]);
  });
  it('uses female, young female, male, young male, then total without duplicate selections', () => {
    const herd = [animal(1, { sex: 'female', ageTicks: 6 * DAY }), animal(2, { sex: 'female' }),
      animal(3, { sex: 'female', growth: .5 }), animal(4), animal(5, { growth: .5 })];
    const selected = select(herd, { female: 1, youngFemale: 0, male: 0, youngMale: 0, total: 0 }).targets;
    expect(selected).toEqual([1, 3, 4, 5, 2]); expect(new Set(selected).size).toBe(5);
    expect(select(herd, { female: 1, total: 4 }).targets).toEqual([1]);
  });
  it('protects pregnant animals by excluding them from counts even when total and female limits are zero', () => {
    const herd = [animal(1, { sex: 'female', pregnancy: { fatherId: 3, progress: .5 } }), animal(2, { sex: 'female' }), animal(3)];
    const status = select(herd, { total: 0, female: 0 });
    expect(status.targets).toEqual([2, 3]);
    expect(status.herds[0]).toMatchObject({ population: 3, protectedPregnant: 1, counts: { total: 2, female: 1 } });
  });
  it('when allowed, chooses non-pregnant first and later pregnancy before earlier pregnancy', () => {
    const herd = [animal(1, { sex: 'female', pregnancy: { fatherId: 9, progress: .2 }, ageTicks: 99 * DAY }),
      animal(2, { sex: 'female', pregnancy: { fatherId: 9, progress: .8 } }), animal(3, { sex: 'female' })];
    expect(select(herd, { total: 1, allowPregnant: true }).targets).toEqual([3, 2]);
    expect(select(herd, { female: 0, allowPregnant: true }).targets).toEqual([3, 2, 1]);
  });
  it('excludes wild, dead and release-ordered animals; keeps manual marks independent', () => {
    const herd = [animal(1, { faction: 'wild', tameness: 0 }), animal(2, { dead: true, health: 0 }),
      animal(3, { releaseMarked: true }), animal(4, { slaughter: true }), animal(5, { species: 'deer' })];
    const status = select(herd, { total: 0 }); expect(status.targets).toEqual([4]);
    expect(status.herds[0]).toMatchObject({ population: 2, releasing: 1, counts: { total: 1 } });
    expect(herd[3].slaughter).toBe(true);
  });
  it('uses stable identity ties and recalculates on growth and pregnancy without cached IDs', () => {
    const a = animal(2, { sex: 'female', growth: .99 }), b = animal(1, { sex: 'female' });
    expect(select([a, b], { female: 1 }).targets).toEqual([]);
    a.growth = 1; expect(select([a, b], { female: 1 }).targets).toEqual([1]);
    b.pregnancy = { fatherId: 8, progress: .1 }; expect(select([a, b], { female: 1 }).targets).toEqual([]);
  });
  it('strictly distinguishes unlimited, zero, valid counts and malformed command/save objects', () => {
    expect(validAutoSlaughter(defaultAutoSlaughter())).toBe(true);
    for (const limit of [null, 0, 1, 128]) expect(validAutoSlaughterPolicy({ ...defaultAutoSlaughterPolicy(), total: limit })).toBe(true);
    for (const value of [-1, 129, .5, NaN, Infinity, '3', undefined])
      expect(validAutoSlaughterPolicy({ ...defaultAutoSlaughterPolicy(), total: value })).toBe(false);
    expect(validAutoSlaughterPolicy({ ...defaultAutoSlaughterPolicy(), fake: 1 })).toBe(false);
    expect(validAutoSlaughter({ hare: defaultAutoSlaughterPolicy() })).toBe(false);
  });
});

describe('physical automatic slaughter integration and save safety', () => {
  it('walks to excess animals, preserves manual flags, persists actual work, then produces exactly one carcass', () => {
    let s = fixture(); const a = add(s, { ageTicks: 8 * DAY }), b = add(s, { x: 24 });
    configure(s, { total: 1 }); expect(a.slaughter).toBe(false); expect(b.slaughter).toBe(false);
    until(s, () => (s.pawns[0].handleTask?.progress ?? 0) >= 35);
    expect(s.pawns[0].handleTask?.action).toBe('autoSlaughter'); expect(s.stats.produced.carcass).toBe(0);
    const saved = s.save(), task = structuredClone(saved.pawns[0].handleTask); s = VoxelSimulation.load(saved);
    expect(s.pawns[0].handleTask).toEqual(task); expect(s.save().autoSlaughter.hare.total).toBe(1);
    until(s, () => s.husbandryLog.some(e => e.kind === 'slaughter'));
    s.step(250); expect(s.stats.produced.carcass).toBe(1); expect(s.counts().carcass).toBe(1);
    expect(s.animals.filter(a => !a.dead).map(a => a.id)).toEqual([b.id]);
    expect(s.husbandryLog.filter(e => e.kind === 'slaughter').map(e => e.animalId)).toEqual([a.id]);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('changing quotas revokes an in-progress automatic interaction immediately', () => {
    const s = fixture(), a = add(s); configure(s, { total: 0 });
    until(s, () => (s.pawns[0].handleTask?.progress ?? 0) >= 20);
    configure(s, {}); expect(s.pawns[0].handleTask).toBeNull(); expect(a.dead).toBe(false);
    s.step(160); expect(s.stats.produced.carcass).toBe(0); expect(a.slaughter).toBe(false);
  });
  it('unlimited settings do not cancel a manual slaughter instruction or job', () => {
    const s = fixture(), a = add(s); ok(s, { type: 'animalOrder', animalId: a.id, order: 'slaughter', enabled: true });
    until(s, () => (s.pawns[0].handleTask?.progress ?? 0) >= 20); configure(s, {});
    expect(s.pawns[0].handleTask?.action).toBe('slaughter'); expect(a.slaughter).toBe(true);
    until(s, () => s.stats.produced.carcass === 1);
  });
  it('releasing an automatically selected animal cancels its automatic job and removes it from quota counts', () => {
    const s = fixture(), a = add(s); configure(s, { total: 0 });
    until(s, () => !!s.pawns[0].handleTask);
    ok(s, { type: 'animalOrder', animalId: a.id, order: 'release', enabled: true });
    expect(s.pawns[0].handleTask).toBeNull(); expect(s.snapshot().autoSlaughterStatus.targets).toEqual([]);
    until(s, () => a.faction === 'wild'); expect(s.stats.produced.carcass).toBe(0);
  });
  it('requires enabled handlers and safely releases on drafting without creating a carcass', () => {
    const s = fixture(), a = add(s); s.pawns[0].priorities.handle = 0; configure(s, { total: 0 });
    s.step(120); expect(s.pawns.every(p => p.handleTask === null)).toBe(true); expect(a.dead).toBe(false);
    ok(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'handle', value: 1 });
    until(s, () => (s.pawns[0].handleTask?.progress ?? 0) >= 20);
    ok(s, { type: 'draft', pawnId: s.pawns[0].id, drafted: true });
    expect(s.pawns[0].handleTask).toBeNull(); s.step(110); expect(s.stats.produced.carcass).toBe(0);
  });
  it('multiple workers reserve distinct targets and stop at the remaining live population', () => {
    const s = fixture(); for (const p of s.pawns) p.priorities.handle = 1;
    for (let i = 0; i < 4; i++) add(s, { x: 20 + i, ageTicks: (10 - i) * DAY });
    configure(s, { total: 2 });
    for (let i = 0; i < 650; i++) {
      s.step(); const targets = s.pawns.flatMap(p => p.handleTask ? [p.handleTask.animalId] : []);
      expect(new Set(targets).size).toBe(targets.length); expect(s.stats.produced.carcass).toBeLessThanOrEqual(2);
    }
    expect(s.stats.produced.carcass).toBe(2); expect(s.animals.filter(a => !a.dead)).toHaveLength(2);
  });
  it('new pregnancy revokes the work before the next work tick; explicit manual slaughter remains possible', () => {
    const s = fixture(), a = add(s, { sex: 'female' }), father = add(s, { x: 25 });
    configure(s, { female: 0 }); until(s, () => (s.pawns[0].handleTask?.progress ?? 0) >= 20);
    a.pregnancy = { fatherId: father.id, progress: .2 }; s.step();
    expect(s.pawns[0].handleTask?.action).not.toBe('autoSlaughter'); expect(a.dead).toBe(false);
    ok(s, { type: 'animalOrder', animalId: a.id, order: 'slaughter', enabled: true });
    until(s, () => s.stats.produced.carcass === 1);
  });
  it('malformed commands cannot mutate policy or cancel work; accepted commands copy input', () => {
    const s = fixture(); add(s); const policy = { ...defaultAutoSlaughterPolicy(), total: 0 };
    ok(s, { type: 'autoSlaughter', species: 'hare', policy }); policy.total = 100;
    expect(s.autoSlaughter.hare.total).toBe(0); until(s, () => !!s.pawns[0].handleTask);
    const before = structuredClone(s.autoSlaughter), task = structuredClone(s.pawns[0].handleTask);
    expect(s.command({ type: 'autoSlaughter', species: 'hare', policy: { ...policy, total: -1 } }).ok).toBe(false);
    expect(s.autoSlaughter).toEqual(before); expect(s.pawns[0].handleTask).toEqual(task);
  });
  it('migrates a v47-shaped controlled save with disabled quotas, preserving input and manual animal marks', () => {
    const s = fixture(); add(s, { slaughter: true });
    const old = s.save() as any; stripAnimalMilkFields(old); old.version = 47; delete old.autoSlaughter; const before = structuredClone(old);
    const migrated = VoxelSimulation.load(old).save(); expect(old).toEqual(before);
    expect(migrated.version).toBe(52); expect(migrated.autoSlaughter).toEqual(defaultAutoSlaughter());
    expect(migrated.animals).toEqual(milkExpectedField('animals', old.animals)); expect(migrated.stats).toEqual(milkExpectedField('stats', old.stats));
  });
  it('rejects new state hidden behind old schemas and malformed current configuration', () => {
    const s = fixture(), raw = s.save();
    const oldShape = structuredClone(raw); stripAnimalMilkFields(oldShape);
    for (const version of [29, 46, 47]) expect(() => VoxelSimulation.load({ ...oldShape, version })).toThrow(/自动宰杀/);
    for (const value of [undefined, null, [], {}, { ...defaultAutoSlaughter(), cow: defaultAutoSlaughterPolicy() }])
      expect(() => VoxelSimulation.load({ ...raw, autoSlaughter: value })).toThrow(/自动宰杀/);
    add(s); configure(s, { total: 0 }); until(s, () => !!s.pawns[0].handleTask);
    const old = s.save() as any; stripAnimalMilkFields(old); old.version = 47; delete old.autoSlaughter;
    expect(() => VoxelSimulation.load(old)).toThrow(/旧版存档混入自动宰杀/);
  });
  it('revalidates derived eligibility on load instead of trusting a stale in-progress automatic job', () => {
    const s = fixture(); add(s); configure(s, { total: 0 });
    until(s, () => (s.pawns[0].handleTask?.progress ?? 0) >= 20);
    const saved = s.save(); saved.autoSlaughter = defaultAutoSlaughter();
    const loaded = VoxelSimulation.load(saved); expect(loaded.pawns[0].handleTask).toBeNull();
    loaded.step(120); expect(loaded.stats.produced.carcass).toBe(0);
  });
});
