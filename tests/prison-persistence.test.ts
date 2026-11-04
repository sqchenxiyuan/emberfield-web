import { initialSocial } from '../src/voxel/social';
import { initialLiving } from '../src/voxel/living';
import { initialApparelControl } from '../src/voxel/apparelPolicies';
import { describe, expect, it } from 'vitest';
import { initialPrisoner } from '../src/voxel/prisoners';
import { migratePrisoners, rejectLegacyPrisonerFields, validatePrisoners } from '../src/voxel/prisonPersistence';
import { initialSurvival } from '../src/voxel/survival';
import { initialSkills } from '../src/voxel/skills';
import { initialPsyche } from '../src/voxel/mood';
import { type Pawn, type VoxelSave } from '../src/voxel/types';

function pawn(id: number, extra: Partial<Pawn> = {}): Pawn {
  return { ...initialSurvival(20, id), id, name: `人物${id}`, x: 19, y: 10, z: 8, color: 0,
    food: 80, rest: 80, skills: initialSkills(id), social: initialSocial(), living: initialLiving(), psyche: initialPsyche(),
    worn: [], apparelControl: initialApparelControl(0), apparelTask: null, apparelWearTicks: 0, jobId: null, phase: 'idle', path: [],
    destination: null, cargo: null, eating: null, reason: '', moveTick: 0, workTarget: null,
    sleepingSince: null, sleepBedId: null, schedule: Array(24).fill('work'),
    priorities: { handle: 0, firefight: 0, clean: 0, warden: 1, care: 0, hunt: 0, dig: 0, build: 0, cut: 0, haul: 0, grow: 0,
      cook: 0, craft: 0, research: 0 }, prisoner: null, wardenTask: null, handleTask: null, ropeTask: null, ...extra };
}
function fixture(): VoxelSave {
  const q = pawn(2, { x: 20, faction: 'prisoner', prisoner: initialPrisoner(200, 90), phase: 'prisoner' });
  q.priorities.warden = 0;
  return { tick: 300, pawns: [pawn(1), q],
    beds: [{ id: 90, x: 20, y: 10, z: 8, axis: 'x', prisoner: true, quality: 2 as const, medical: false, owner: 2 }],
  } as VoxelSave;
}
function talking(): VoxelSave {
  const d = fixture(), [w, q] = d.pawns; q.prisoner!.policy = 'recruit';
  w.phase = 'warden'; w.wardenTask = { prisonerId: q.id, bedId: null, stage: 'talk', progress: 100 };
  return d;
}
function rejectChanged(base: VoxelSave, mutations: ((d: VoxelSave) => void)[]) {
  for (const change of mutations) {
    const d = structuredClone(base); change(d); expect(() => validatePrisoners(d)).toThrow('俘虏存档无效');
  }
}
describe('prisoner migration and cross-entity persistence boundaries', () => {
  it('migrates old saves without creating people, resetting skills or advancing the version', () => {
    const d = fixture() as unknown as Record<string, any>;
    d.version = 23; d.pawns[1].faction = 'raider'; d.pawns[1].phase = 'downed'; d.pawns[1].downed = true;
    for (const p of d.pawns) { delete p.prisoner; delete p.wardenTask; delete p.priorities.warden; }
    for (const b of d.beds) { delete b.prisoner; b.owner = null; }
    const skills = structuredClone(d.pawns.map((p: Pawn) => p.skills));
    expect(() => rejectLegacyPrisonerFields(d)).not.toThrow();
    migratePrisoners(d, 23);
    expect(d.version).toBe(23); expect(d.pawns).toHaveLength(2);
    expect(d.pawns.map((p: Pawn) => p.skills)).toEqual(skills);
    expect(d.pawns.map((p: Pawn) => [p.prisoner, p.wardenTask, p.priorities.warden])).toEqual([[null, null, 1], [null, null, 0]]);
    expect(d.beds[0].prisoner).toBe(false);
    const before = structuredClone(d); migratePrisoners(d, 24); expect(d).toEqual(before);
  });
  it('rejects new fields hidden inside a legacy version, including explicit null fields', () => {
    for (const patch of [(d: any) => d.pawns[0].prisoner = null,
      (d: any) => d.pawns[0].wardenTask = null, (d: any) => d.pawns[0].priorities.warden = 0,
      (d: any) => d.pawns[0].phase = 'warden', (d: any) => d.pawns[0].faction = 'prisoner',
      (d: any) => d.beds[0].prisoner = false]) {
      const d = { version: 23, pawns: [{ faction: 'colony', phase: 'idle', priorities: {} }], beds: [{}] };
      patch(d); expect(() => migratePrisoners(d, 23)).toThrow('旧版本包含新版');
    }
  });
  it('accepts a waiting prisoner after a bed is cancelled and the completed release state', () => {
    const d = fixture(); expect(() => validatePrisoners(d)).not.toThrow();
    d.pawns[1].prisoner!.bedId = null; d.beds = [];
    expect(() => validatePrisoners(d)).not.toThrow();
    d.pawns[1].prisoner!.policy = 'release'; d.pawns[1].prisoner!.releasing = true;
    expect(() => validatePrisoners(d)).not.toThrow();
  });
  it('rejects forged prisoner identity, work, ownership and physical sleep state', () => {
    rejectChanged(fixture(), [
      d => d.pawns[1].faction = 'colony', d => d.pawns[0].prisoner = initialPrisoner(0),
      d => d.pawns[1].jobId = 100, d => d.pawns[1].drafted = true,
      d => d.pawns[1].attackTargetId = 1, d => d.pawns[1].priorities.warden = 1,
      d => d.pawns[1].prisoner!.bedId = 99, d => d.beds[0].prisoner = false,
      d => d.beds[0].owner = 1, d => d.pawns[1].sleepingSince = 100,
      d => { d.pawns[1].sleepingSince = 100; d.pawns[1].sleepBedId = 90; d.pawns[1].x--; },
    ]);
  });
  it('accepts only paired capture carriers, including a prisoner recovering while carried', () => {
    const d = fixture(), [w, q] = d.pawns;
    w.phase = 'warden'; w.wardenTask = { prisonerId: q.id, bedId: 90, stage: 'captureCarry', progress: 0 };
    w.carryingPawnId = q.id; q.carriedBy = w.id; q.x = w.x;
    expect(q.downed).toBe(false); expect(() => validatePrisoners(d)).not.toThrow();
    rejectChanged(d, [s => s.pawns[1].carriedBy = null, s => s.pawns[0].carryingPawnId = null,
      s => s.pawns[1].x++, s => s.pawns[1].prisoner!.bedId = null,
      s => s.pawns[1].sleepBedId = 90, s => s.pawns[0].cargo = { resource: 'wood', amount: 1 },
    ]);
  });
  it('rejects duplicate targets, mixed care reservations and two captures reserving one bed', () => {
    const d = talking(); expect(() => validatePrisoners(d)).not.toThrow();
    rejectChanged(d, [s => s.pawns.push({ ...structuredClone(s.pawns[0]), id: 3 }),
      s => s.pawns.push(pawn(3, { phase: 'care', patientId: 2, carePhase: 'feedFetch' })),
    ]);
    const c = fixture(); c.beds[0].owner = null; c.pawns[1].prisoner = null;
    c.pawns[1].faction = 'raider'; c.pawns[1].downed = true; c.pawns[1].phase = 'downed';
    const w = c.pawns[0]; w.phase = 'warden'; w.wardenTask = { prisonerId: 2, bedId: 90, stage: 'captureApproach', progress: 0 };
    expect(() => validatePrisoners(c)).not.toThrow();
    c.pawns.push(pawn(3, { phase: 'warden', wardenTask: { prisonerId: 4, bedId: 90, stage: 'captureApproach', progress: 0 } }));
    const another = pawn(4, { faction: 'raider', downed: true, phase: 'downed' }); another.priorities.warden = 0;
    c.pawns.push(another); expect(() => validatePrisoners(c)).toThrow();
  });
  it('requires a stopped adjacent conversation with an eligible policy and expired cooldown', () => {
    const d = talking(); expect(() => validatePrisoners(d)).not.toThrow();
    rejectChanged(d, [s => s.pawns[0].x--, s => s.pawns[0].path = [1], s => s.pawns[0].destination = 1,
      s => s.pawns[1].prisoner!.policy = 'maintain', s => s.pawns[1].prisoner!.nextInteractionTick = s.tick + 1,
      s => { s.pawns[1].prisoner!.policy = 'reduceResistance'; s.pawns[1].prisoner!.resistance = 0; },
      s => s.pawns[0].wardenTask!.progress = Infinity,
    ]);
  });
});
