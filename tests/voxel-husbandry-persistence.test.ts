import { describe, expect, it } from 'vitest';
import { at, CELLS, DAY, type Pawn, type VoxelSave, type WildAnimal } from '../src/voxel/types';
import { HUSBANDRY_RULES, initialAnimalState } from '../src/voxel/husbandry';
import { migrateHusbandry, rejectLegacyHusbandryFields, validateHusbandry } from '../src/voxel/husbandryPersistence';
import { initialSkills } from '../src/voxel/skills';
import { freshBatch } from '../src/voxel/preservation';

function animal(id = 20, extra: Partial<WildAnimal> = {}): WildAnimal {
  return { id, species: 'hare', name: '野兔', x: 4, y: 4, z: 8, health: 28, hunger: 80,
    dead: false, hunt: false, phase: 'roam', moveTick: 0, decisionTick: 0, fleeUntil: 0,
    threatId: null, retryTick: 0, rotProgress: 0, ...initialAnimalState(id, 'hare', 0), ...extra };
}
// Controlled schema fixtures exercise this module only; these are not claimed
// as full playable saves or native runtime evidence.
function pawn(id = 1): Pawn {
  return { id, x: 3, y: 4, z: 8, faction: 'colony', phase: 'idle', priorities: { handle: 2 },
    skills: initialSkills(1), handleTask: null, dead: false, downed: false, drafted: false,
    path: [], destination: null, cargo: null, carriedBy: null, carryingPawnId: null,
    jobId: null, carePhase: null, patientId: null, eating: null, sleepBedId: null, sleepingSince: null,
    wardenTask: null, cleanTask: null, firefightTask: null, repairTask: null, weaponTask: null,
    apparelTask: null, attackTargetId: null, shooting: null, psyche: { recreation: null, breakUntil: 0 } } as unknown as Pawn;
}
function current(): VoxelSave {
  return { version: 29, tick: 100, nextId: 100, animals: [animal()], pawns: [pawn()],
    grass: [{ x: 4, y: 4, z: 8, growth: .7 }], husbandryLog: [],
    crops: [], items: [{ id: 30, x: 2, y: 4, z: 8, ...freshBatch('grain', 10) }] } as unknown as VoxelSave;
}
function handling(stage: 'fetch' | 'approach' | 'interact' = 'fetch'): VoxelSave {
  const d = current(), p = d.pawns[0]; d.animals[0].tame = true; p.phase = 'handle';
  p.handleTask = { animalId: 20, action: 'tame', stage, foodId: stage === 'fetch' ? 30 : null,
    amount: 2, feedings: 0, progress: 0 };
  if (stage !== 'fetch') { p.cargo = freshBatch('grain', 2); d.items[0].amount -= 2; }
  return d;
}
function legacy(): Record<string, any> {
  const d = current() as unknown as Record<string, any>;
  d.version = 28; delete d.grass; delete d.husbandryLog;
  for (const a of d.animals) for (const key of Object.keys(initialAnimalState(a.id, a.species, 0))) delete a[key];
  for (const p of d.pawns) { delete p.handleTask; delete p.priorities.handle; delete p.skills.animals; }
  return d;
}

describe('v29 husbandry migration boundary', () => {
  it('preserves old physical metadata, corpse condition, phase and all previous skill records', () => {
    const d = legacy();
    Object.assign(d.animals[0], { dead: true, health: 0, phase: 'dead', rotProgress: 120, carcassHitPoints: 37,
      hunger: 19, moveTick: 75, decisionTick: 90, retryTick: 300 });
    d.pawns[0].skills.plants.xp = 201.5;
    const before = structuredClone(d);
    rejectLegacyHusbandryFields(d); migrateHusbandry(d, 28);
    for (const [key, value] of Object.entries(before.animals[0])) expect(d.animals[0][key], key).toEqual(value);
    for (const [key, value] of Object.entries(before.pawns[0].skills)) expect(d.pawns[0].skills[key], key).toEqual(value);
    expect(d.animals[0]).toMatchObject({ faction: 'wild', growth: 1, ageTicks: 4 * DAY, tameness: 0, pregnancy: null });
    expect(d.pawns[0]).toMatchObject({ handleTask: null, priorities: { handle: 2 }, skills: { animals: { level: 4, xp: 0 } } });
    expect(d.grass).toEqual([]); expect(d.husbandryLog).toEqual([]); expect(d.version).toBe(28);
    expect(() => validateHusbandry(d as VoxelSave)).not.toThrow();
  });
  it('accepts Animals defaults inserted by older skill migrations and gives non-colonists no work', () => {
    const d = legacy(); rejectLegacyHusbandryFields(d);
    d.pawns[0].faction = 'raider'; d.pawns[0].skills = initialSkills(0, true);
    migrateHusbandry(d, 13);
    expect(d.pawns[0].priorities.handle).toBe(0); expect(d.pawns[0].skills.animals.level).toBe(0);
    const before = structuredClone(d); migrateHusbandry(d, 29); expect(d).toEqual(before);
  });
  it('rejects smuggled current fields under every old source version before any mutation', () => {
    const changes: ((d: any) => void)[] = [d => { d.grass = []; }, d => { d.husbandryLog = []; },
      d => { d.pawns[0].handleTask = null; }, d => { d.pawns[0].priorities.handle = 0; },
      d => { d.pawns[0].skills.animals = initialSkills(0).animals; }, d => { d.pawns[0].phase = 'handle'; },
      d => { d.animals[0].phase = 'mate'; },
      ...Object.entries(initialAnimalState(20, 'hare', 0)).map(([key, value]) => (d: any) => { d.animals[0][key] = value; })];
    for (const version of [1, 13, 21, 27, 28]) for (const change of changes) {
      const d = legacy(); d.version = version; change(d); const before = structuredClone(d);
      expect(() => rejectLegacyHusbandryFields(d)).toThrow(/旧版本包含新版/); expect(d).toEqual(before);
    }
  });
  it('preflights all legacy records before appending any defaults', () => {
    for (const change of [(d: any) => { d.animals.push({ id: 21, species: 'unknown' }); },
      (d: any) => { d.pawns.push({ priorities: {}, skills: null }); },
      (d: any) => { d.tick = -1; }]) {
      const d = legacy(); change(d); const before = structuredClone(d);
      expect(() => migrateHusbandry(d, 28)).toThrow(); expect(d).toEqual(before);
    }
  });
});

describe('v29 husbandry strict state and biological references', () => {
  it('accepts a ready pregnancy with historical father, released mothers and waiting females', () => {
    const d = current(); Object.assign(d.animals[0], { sex: 'female', phase: 'mate', pregnancy: { fatherId: 99, progress: 1 } });
    d.husbandryLog = [{ tick: 0, kind: 'birth', animalId: 98, otherId: 99, message: '历史出生' }];
    const before = structuredClone(d); expect(() => validateHusbandry(d)).not.toThrow(); expect(d).toEqual(before);
    d.animals[0].pregnancy = null;
    d.animals.push(animal(21, { sex: 'male', faction: 'colony', tameness: 5, x: 5,
      phase: 'mate', mateId: 20, mateProgress: 99, goal: { kind: 'mate', id: 20 } }));
    expect(() => validateHusbandry(d)).not.toThrow();
  });
  it('rejects malformed fields, impossible identities, biological relations, paths and grass without mutation', () => {
    const changes: ((d: any) => void)[] = [d => { delete d.animals[0].growth; },
      d => { d.animals[0].growth = NaN; }, d => { d.animals[0].malnutrition = 1.1; },
      d => { d.animals[0].ageTicks = .5; }, d => { d.animals[0].nextInteractionTick = -1; },
      d => { d.animals[0].tameness = 3; }, d => { d.animals[0].slaughter = true; },
      d => { d.animals[0].tame = true; d.animals[0].hunt = true; },
      d => { d.animals.push(structuredClone(d.animals[0])); }, d => { d.animals[0].id = d.nextId; },
      d => { d.animals[0].pregnancy = { fatherId: 20, progress: .5 }; },
      d => { d.animals[0].sex = 'female'; d.animals[0].pregnancy = { fatherId: 1, progress: .5 }; },
      d => { d.animals[0].sex = 'male'; d.animals[0].pregnancy = { fatherId: 99, progress: .5 }; },
      d => { d.animals[0].sex = 'female'; d.animals[0].growth = .5; d.animals[0].pregnancy = { fatherId: 99, progress: .5 }; },
      d => { d.animals[0].mateId = 99; }, d => { d.animals[0].mateProgress = 1; },
      d => { d.animals[0].eatProgress = 1; }, d => { d.animals[0].path = [CELLS]; },
      d => { d.animals[0].goal = { kind: 'grass', id: 0 }; d.animals[0].path = [at({ x: 10, y: 4, z: 8 })]; },
      d => { d.animals[0].goal = { kind: 'food', id: -1 }; },
      d => { d.grass.push({ ...d.grass[0] }); }, d => { d.grass[0].growth = 1.01; },
      d => { d.grass[0].x = 1.5; }, d => { d.grass[0].extra = true; },
      d => { d.husbandryLog = [{ tick: 101, kind: 'birth', animalId: 20, otherId: null, message: '' }]; },
      d => { d.husbandryLog = Array(HUSBANDRY_RULES.maxLog + 1).fill({}); }];
    for (const change of changes) {
      const d = current(); change(d); const before = structuredClone(d);
      expect(() => validateHusbandry(d)).toThrow(/驯养存档/); expect(d).toEqual(before);
    }
  });
  it('accepts stale resource goals and terrain-independent valid paths', () => {
    const d = current(), a = d.animals[0];
    a.goal = { kind: 'grass', id: 0 }; a.path = [at({ x: 5, y: 4, z: 9 })];
    expect(() => validateHusbandry(d)).not.toThrow();
    a.path = []; a.goal = { kind: 'food', id: 99 }; a.phase = 'eat'; a.eatProgress = 59;
    expect(() => validateHusbandry(d)).not.toThrow();
  });
  it('rejects two male reservations of one female', () => {
    const d = current(); d.animals[0].sex = 'female';
    for (const id of [21, 22]) d.animals.push(animal(id, { faction: 'colony', tameness: 5, sex: 'male',
      phase: 'mate', mateId: 20, goal: { kind: 'mate', id: 20 } }));
    expect(() => validateHusbandry(d)).toThrow(/配偶引用/);
  });
});

describe('v29 handler reservations and physically remaining food', () => {
  it('accepts fetch, carried approach, interact, and the single remaining feeding', () => {
    for (const stage of ['fetch', 'approach', 'interact'] as const) expect(() => validateHusbandry(handling(stage))).not.toThrow();
    const d = handling('interact'), p = d.pawns[0];
    p.handleTask!.feedings = 1; p.handleTask!.progress = 79; p.cargo!.amount = 1;
    expect(() => validateHusbandry(d)).not.toThrow();
    p.handleTask!.stage = 'approach'; p.handleTask!.progress = 0;
    expect(() => validateHusbandry(d)).not.toThrow();
  });
  it('accepts one feed portion, maintenance and physical slaughter/release approaches', () => {
    for (const action of ['feed', 'maintain', 'slaughter', 'release'] as const) {
      const d = handling('approach'), a = d.animals[0], p = d.pawns[0], t = p.handleTask!;
      Object.assign(a, { faction: 'colony', tameness: 4, tame: false }); t.action = action;
      if (action === 'feed') { t.amount = 1; p.cargo!.amount = 1; }
      if (action === 'slaughter' || action === 'release') {
        t.amount = 0; p.cargo = null; a.slaughter = action === 'slaughter'; a.releaseMarked = action === 'release';
      }
      expect(() => validateHusbandry(d)).not.toThrow();
    }
  });
  it('rejects missing work data, conflicting tasks, duplicate targets and fabricated feeding state', () => {
    const changes: ((d: any) => void)[] = [d => { d.pawns[0].handleTask = null; },
      d => { d.pawns[0].priorities.handle = 0; }, d => { d.pawns[0].skills.animals.level = 7; },
      d => { d.pawns[0].jobId = 3; }, d => { d.pawns[0].wardenTask = {}; },
      d => { d.pawns[0].drafted = true; }, d => { d.pawns[0].x = 0; },
      d => { d.pawns[0].handleTask.progress = 80; }, d => { d.pawns[0].handleTask.extra = true; },
      d => { d.pawns[0].handleTask.foodId = 30; }, d => { d.pawns[0].handleTask.feedings = 2; },
      d => { d.pawns[0].handleTask.feedings = 1; }, d => { d.pawns[0].cargo.amount = 1; },
      d => { d.pawns[0].cargo.resource = 'meat'; }, d => { d.pawns[0].handleTask.animalId = 99; },
      d => { d.pawns.push({ ...structuredClone(d.pawns[0]), id: 2 }); }];
    for (const change of changes) {
      const d = handling('interact'); change(d); const before = structuredClone(d);
      expect(() => validateHusbandry(d)).toThrow(/驯养存档/); expect(d).toEqual(before);
    }
  });
  it('bounds aggregate feed reservations by real stock and rejects dangling fetch references', () => {
    const d = handling('fetch'); d.animals.push(animal(21, { tame: true }));
    const p = structuredClone(d.pawns[0]); p.id = 2; p.handleTask!.animalId = 21; d.pawns.push(p);
    d.items[0].amount = 4; expect(() => validateHusbandry(d)).not.toThrow();
    d.items[0].amount = 3; expect(() => validateHusbandry(d)).toThrow(/预约超过实物/);
    d.items = []; expect(() => validateHusbandry(d)).toThrow(/照料食物/);
  });
});
