import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { at, CELLS, type VoxelSave, type WildAnimal } from '../src/voxel/types';
import { initialAnimalState } from '../src/voxel/husbandry';
import { initialAnimalPenState, initialPenFilter } from '../src/voxel/pens';
import { migratePens, rejectLegacyPensFields, validatePens } from '../src/voxel/pensPersistence';

function legacy() { return JSON.parse(readFileSync(new URL('./fixtures/voxel-v29-pens-pregnant.json', import.meta.url), 'utf8')); }
function current(): VoxelSave {
  const d = legacy(); migratePens(d, 29); d.version = 30;
  const id = () => d.nextId++;
  d.fences.push({ id: id(), x: 3, y: 3, z: 8 });
  d.fenceGates.push({ id: id(), x: 4, y: 3, z: 8, axis: 'x', mode: 'auto', openUntil: d.tick + 20 });
  d.penMarkers.push({ id: id(), x: 5, y: 3, z: 8, name: '鹿圈', filter: initialPenFilter() });
  d.animalAreas.push({ id: id(), name: '兔区', color: 0x44aa88, cells: [at({ x: 2, y: 2, z: 8 })] });
  return d;
}
function roping(stage: 'approach' | 'attach' | 'lead' | 'detach' = 'lead') {
  const d = current(), p = d.pawns[0], source = d.animals[0], id = d.nextId++;
  const a: WildAnimal = { ...structuredClone(source), ...initialAnimalState(id, 'deer', d.tick), ...initialAnimalPenState(d.tick),
    id, name: '鹿', species: 'deer' as const, health: 65, faction: 'colony' as const, tameness: 5,
    phase: stage === 'approach' ? 'roam' as const : 'rope' as const, x: 4, y: 4, z: 8,
    pregnancy: null, dead: false, hunt: false };
  d.animals.push(a);
  Object.assign(p, { x: 5, y: 4, z: 8, phase: 'rope', drafted: false, dead: false, downed: false,
    path: [], destination: null, cargo: null, carriedBy: null, carryingPawnId: null, handleTask: null,
    jobId: null, carePhase: null, patientId: null, eating: null, sleepBedId: null, sleepingSince: null,
    wardenTask: null, cleanTask: null, firefightTask: null, repairTask: null, weaponTask: null,
    apparelTask: null, attackTargetId: null, shooting: null });
  p.priorities.handle = 1; p.skills.animals.level = 0; p.psyche.recreation = null; p.psyche.breakUntil = 0;
  p.ropeTask = { animalId: a.id, penId: d.penMarkers[0].id, stage, progress: 0,
    path: stage === 'lead' ? [at({ x: 6, y: 4, z: 8 }), at({ x: 7, y: 4, z: 9 })] : [] };
  return { d, p, a };
}

describe('v30 source boundary and pure migration', () => {
  it('adds only pen defaults and preserves every old field without using entity identities', () => {
    const d = legacy(), before = structuredClone(d); rejectLegacyPensFields(d); migratePens(d, 29);
    const restored = structuredClone(d);
    for (const key of ['fences', 'fenceGates', 'penMarkers', 'animalAreas']) { expect(restored[key]).toEqual([]); delete restored[key]; }
    for (const a of restored.animals) for (const key of Object.keys(initialAnimalPenState(d.tick))) delete a[key];
    for (const p of restored.pawns) { expect(p.ropeTask).toBeNull(); delete p.ropeTask; }
    expect(restored).toEqual(before); expect(d.nextId).toBe(before.nextId);
    expect(() => validatePens(d as VoxelSave)).not.toThrow();
  });
  it('rejects v30 fields under any old source before migration can erase them', () => {
    const changes: ((d: any) => void)[] = [
      ...['fences', 'fenceGates', 'penMarkers', 'animalAreas'].map(k => (d: any) => { d[k] = []; }),
      ...Object.entries(initialAnimalPenState(0)).map(([k, v]) => (d: any) => { d.animals[0][k] = v; }),
      d => { d.pawns[0].ropeTask = null; }, d => { d.pawns[0].phase = 'rope'; },
      d => { d.animals[0].phase = 'rope'; }, d => { d.animals[0].goal = { kind: 'area', id: 1 }; },
      d => { d.animals[0].goal = { kind: 'exit', id: 0 }; },
      ...['fence', 'fenceGate', 'penMarker'].map(kind => (d: any) => { d.jobs.push({ kind }); }),
    ];
    const baseline = legacy();
    for (const version of [1, 22, 28, 29]) for (const change of changes) {
      const d = structuredClone(baseline); d.version = version; change(d); const before = structuredClone(d);
      expect(() => rejectLegacyPensFields(d)).toThrow(/旧版本包含新版/); expect(d).toEqual(before);
    }
  });
  it('preflights migration and tolerates defaults inserted by earlier husbandry initialization', () => {
    const d = legacy(); Object.assign(d.animals[0], initialAnimalPenState(d.tick));
    migratePens(d, 28); expect(() => validatePens(d)).not.toThrow();
    const before = structuredClone(d); migratePens(d, 30); expect(d).toEqual(before);
    const broken = legacy(); broken.pawns.push(null); const original = structuredClone(broken);
    expect(() => migratePens(broken, 29)).toThrow(); expect(broken).toEqual(original);
  });
});

describe('strict pen entities, policy references and movement state', () => {
  it('accepts empty areas and partial gate opening without trusting derived enclosure data', () => {
    const d = current(); d.animalAreas[0].cells = [];
    expect(() => validatePens(d)).not.toThrow();
    const corrupted = structuredClone(d) as any; corrupted.penMarkers[0].closed = true;
    expect(() => validatePens(corrupted)).toThrow(/字段无效/);
  });
  it('rejects duplicate identities/cells, wrong gate shape, filters and malformed areas', () => {
    const changes: ((d: any) => void)[] = [
      d => { d.fences[0].id = d.pawns[0].id; }, d => { d.fenceGates[0].id = d.fences[0].id; },
      d => { Object.assign(d.penMarkers[0], { x: 3, y: 3, z: 8 }); },
      d => { d.fences[0].x = .5; }, d => { d.fenceGates[0].mode = 'unknown'; },
      d => { d.fenceGates[0].openUntil = -1; }, d => { d.fenceGates[0].axis = 'z'; },
      d => { d.penMarkers[0].filter.adult = true; }, d => { d.penMarkers[0].filter.deer = 1; },
      d => { d.animalAreas[0].color = 0x1000000; }, d => { d.animalAreas[0].cells.push(d.animalAreas[0].cells[0]); },
      d => { d.animalAreas[0].cells = [CELLS]; }, d => { d.penMarkers[0].name = ' '; },
      d => { d.doors.push({ id: d.nextId++, x: 3, y: 3, z: 8 }); },
    ];
    for (const change of changes) { const d = current(); change(d); const before = structuredClone(d);
      expect(() => validatePens(d)).toThrow(/圈养存档/); expect(d).toEqual(before); }
  });
  it('binds area goals to owned rabbits and escape goals to real map-edge cells', () => {
    const d = current(), hare = d.animals.find(a => a.species === 'hare' && a.faction === 'colony')!;
    hare.allowedAreaId = d.animalAreas[0].id; hare.goal = { kind: 'area', id: hare.allowedAreaId };
    expect(() => validatePens(d)).not.toThrow();
    hare.goal.id++; expect(() => validatePens(d)).toThrow(/返区目标/);
    hare.goal = null; hare.allowedAreaId = null;
    const { d: deerSave, a } = roping('approach'); deerSave.pawns[0].ropeTask = null; deerSave.pawns[0].phase = 'idle';
    a.goal = { kind: 'exit', id: at({ x: 0, y: 4, z: 8 }) };
    expect(() => validatePens(deerSave)).not.toThrow();
    a.goal.id = at({ x: 4, y: 4, z: 8 }); expect(() => validatePens(deerSave)).toThrow(/离图目标/);
  });
  it('accepts every valid rope stage even at Animals level zero', () => {
    for (const stage of ['approach', 'attach', 'lead', 'detach'] as const) {
      const { d, p } = roping(stage); expect(p.skills.animals.level).toBe(0);
      expect(() => validatePens(d), stage).not.toThrow();
    }
  });
  it('rejects fake rope phases, conflicting work, missing targets and nonphysical paired routes', () => {
    const changes: ((v: ReturnType<typeof roping>) => void)[] = [
      ({ p }) => { p.phase = 'idle'; }, ({ a }) => { a.phase = 'roam'; },
      ({ p }) => { p.ropeTask!.penId++; }, ({ a }) => { a.ropePaused = true; },
      ({ a }) => { a.requestedPenId = 1; }, ({ d }) => { d.penMarkers[0].filter.deer = false; },
      ({ p }) => { p.jobId = 1; }, ({ p }) => { p.handleTask = {} as any; },
      ({ p }) => { p.ropeTask!.progress = 1; }, ({ p }) => { p.path = [at({ x: 6, y: 4, z: 8 })]; },
      ({ p, a }) => { p.ropeTask!.path = [at(a)]; },
      ({ p }) => { p.ropeTask!.path = [at({ x: 5, y: 4, z: 9 })]; },
      ({ p }) => { p.ropeTask!.path = [at({ x: 8, y: 4, z: 8 })]; },
      ({ d, p }) => { const other = structuredClone(p); other.id = d.nextId++; d.pawns.push(other); },
      ({ a }) => { a.goal = { kind: 'food', id: 1 }; },
    ];
    for (const change of changes) { const value = roping(); change(value); const before = structuredClone(value.d);
      expect(() => validatePens(value.d)).toThrow(/圈养存档/); expect(value.d).toEqual(before); }
    const { d, p } = roping('attach'); p.ropeTask!.progress = 40; expect(() => validatePens(d)).toThrow(/进度/);
  });
});
