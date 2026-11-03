import { initialLiving } from '../src/voxel/living';
import { describe, expect, it } from 'vitest';
import { at, position, type Bed, type Cargo, type Pawn, type Pos } from '../src/voxel/types';
import { initialSurvival } from '../src/voxel/survival';
import { initialPsyche } from '../src/voxel/mood';
import { initialSkills } from '../src/voxel/skills';
import { applyInjury } from '../src/voxel/injuries';
import { BODY_PARTS } from '../src/voxel/anatomy';
import { initialPrisoner, PRISON_RULES, validPrisonerState, validWardenTask } from '../src/voxel/prisoners';
import { prisonerTick, releaseWarden, setPrisonerPolicy, startCapture, tryWarden, wardenTick,
  type PrisonHost } from '../src/voxel/prisonWorld';

const pos = (x: number, y = 10): Pos => ({ x, y, z: 8 });
function person(id: number, extra: Partial<Pawn> = {}): Pawn {
  return { ...initialSurvival(19, id), ...pos(10 + id), id, name: `人员${id}`, color: 0,
    food: 80, rest: 80, skills: initialSkills(id), living: initialLiving(), psyche: initialPsyche(),
    worn: [], apparelTask: null, apparelWearTicks: 0, jobId: null, phase: 'idle', path: [],
    destination: null, cargo: null, eating: null, reason: '', moveTick: 0, workTarget: null,
    sleepingSince: null, sleepBedId: null, schedule: Array(24).fill('work'),
    priorities: { handle: 0, firefight: 0, clean: 0, warden: 1, care: 0, hunt: 0, dig: 0, build: 0, cut: 0, haul: 0, grow: 0,
      cook: 0, craft: 0, research: 0 }, prisoner: null, wardenTask: null, handleTask: null, ropeTask: null, ...extra };
}
/** Deliberately independent of VoxelSimulation: movement and physical care are
 * host responsibilities. This small corridor fixture exercises stage ownership. */
class Host implements PrisonHost {
  tick = 100;
  notice = '';
  pawns = [person(1), person(2, { ...pos(15), faction: 'raider', downed: true, phase: 'downed' })];
  beds: Bed[] = [{ ...pos(20), id: 90, axis: 'x', medical: false, prisoner: true, owner: null }];
  dropped: Cargo[] = [];
  fullGround = false;
  roomValid = true;
  blocked = false;
  feedCalls = 0;
  allowFeed = false;
  foodCalls: Set<number>[] = [];
  prisonPath(from: Pos, to: Pos, allowed?: Set<number>): number[] | null {
    if (this.blocked || from.z !== to.z) return null;
    const steps: number[] = [], q = { ...from };
    while (q.x !== to.x) { q.x += Math.sign(to.x - q.x); steps.push(at(q)); }
    while (q.y !== to.y) { q.y += Math.sign(to.y - q.y); steps.push(at(q)); }
    return allowed && (!allowed.has(at(from)) || steps.some(i => !allowed.has(i))) ? null : steps;
  }
  prisonApproach(p: Pawn, target: Pos) {
    return [pos(target.x - 1, target.y), pos(target.x + 1, target.y), pos(target.x, target.y - 1), pos(target.x, target.y + 1)]
      .map(q => this.prisonPath(p, q)).filter((path): path is number[] => path !== null)
      .sort((a, b) => a.length - b.length)[0] ?? null;
  }
  prisonRelease(p: Pawn) {
    releaseWarden(this, p); p.path = []; p.destination = null; p.jobId = null;
    p.attackTargetId = null; p.shooting = null; p.carePhase = null; p.patientId = null;
    p.sleepingSince = null; p.sleepBedId = null; p.eating = null;
    p.phase = p.dead ? 'dead' : p.downed ? 'downed' : p.faction === 'prisoner' ? 'prisoner' : 'idle';
  }
  prisonDropCargo(p: Pawn) {
    if (p.cargo && this.fullGround) return false;
    if (p.cargo) this.dropped.push(structuredClone(p.cargo)); p.cargo = null; return true;
  }
  prisonBeginCapture(p: Pawn) { this.prisonRelease(p); return this.prisonDropCargo(p); }
  prisonCells(p: Pawn) {
    if (!this.roomValid || !this.beds.some(b => b.id === p.prisoner?.bedId && b.prisoner)) return null;
    const cells = new Set<number>();
    for (let x = 18; x <= 24; x++) for (let y = 8; y <= 14; y++) cells.add(at(pos(x, y)));
    return cells;
  }
  prisonTakeFood(_p: Pawn, allowed: Set<number>) { this.foodCalls.push(new Set(allowed)); return false; }
  prisonFeed(p: Pawn, q: Pawn) {
    this.feedCalls++; if (!this.allowFeed) return false;
    this.prisonRelease(p); p.patientId = q.id; p.carePhase = 'feedFetch'; p.phase = 'care'; return true;
  }
  prisonBecomeColonist(p: Pawn) { this.prisonRelease(p); p.prisoner = null; p.faction = 'colony'; p.phase = 'idle'; p.priorities.build = 3; }
  prisonExit(p: Pawn) { return this.prisonPath(p, pos(63, p.y)); }
  step(count = 1) {
    for (let i = 0; i < count; i++) {
      this.tick++;
      for (const p of [...this.pawns]) if (p.wardenTask) wardenTick(this, p);
      for (const p of [...this.pawns]) if (p.faction === 'prisoner') prisonerTick(this, p);
      for (const p of this.pawns) if (!p.dead && !p.downed && p.carriedBy === null && p.path.length) {
        Object.assign(p, position(p.path.shift()!));
        const q = this.pawns.find(q => q.id === p.carryingPawnId);
        if (q) Object.assign(q, { x: p.x, y: p.y, z: p.z });
      }
    }
  }
  until(predicate: () => boolean, limit = 2000) {
    for (let i = 0; i < limit && !predicate(); i++) this.step();
    expect(predicate(), JSON.stringify(this.pawns.map(p => ({ id: p.id, phase: p.phase, task: p.wardenTask, reason: p.reason })))).toBe(true);
  }
  jailed() {
    const p = this.pawns[1]; p.faction = 'prisoner'; p.downed = false; p.phase = 'prisoner';
    p.prisoner = initialPrisoner(this.tick, this.beds[0].id); this.beds[0].owner = p.id;
    const bed = this.beds[0]; Object.assign(p, { x: bed.x, y: bed.y, z: bed.z }); return p;
  }
}

describe('physical prisoner state machine', () => {
  it('walks to a living downed raider, carries the same injured person and keeps physical cargo', () => {
    const s = new Host(), w = s.pawns[0], q = s.pawns[1];
    applyInjury(q.trauma, 400, 'leftArm', 'cut', 6); q.cargo = { resource: 'wood', amount: 7 };
    const identity = { id: q.id, skills: structuredClone(q.skills), trauma: structuredClone(q.trauma) };
    expect(startCapture(s, w, q).ok).toBe(true);
    expect(q.faction).toBe('raider'); expect(q.carriedBy).toBeNull();
    s.until(() => w.wardenTask?.stage === 'captureCarry');
    expect(q.faction).toBe('prisoner'); expect(q.carriedBy).toBe(w.id);
    expect(w.carryingPawnId).toBe(q.id); expect(s.dropped).toEqual([{ resource: 'wood', amount: 7 }]);
    s.until(() => w.wardenTask === null);
    expect(q).toMatchObject({ ...identity, x: 20, y: 10, z: 8, carriedBy: null, faction: 'prisoner' });
    expect(s.beds[0].owner).toBe(q.id); expect(q.prisoner?.bedId).toBe(s.beds[0].id);
  });
  it('rejects invalid capture targets and preserves current work when cargo cannot be unloaded', () => {
    const s = new Host(), w = s.pawns[0], q = s.pawns[1];
    for (const extra of [{ downed: false }, { dead: true }, { faction: 'colony' as const }]) {
      expect(startCapture(s, w, { ...q, ...extra }).ok).toBe(false); expect(w.wardenTask).toBeNull();
    }
    w.cargo = { resource: 'wood', amount: 4 }; w.jobId = 71; w.path = [at(pos(12))]; s.fullGround = true;
    const before = structuredClone(w);
    expect(startCapture(s, w, q).ok).toBe(false); expect(w).toEqual(before);
    s.fullGround = false; s.roomValid = false;
    expect(startCapture(s, w, q).ok).toBe(false); expect(w).toEqual(before);
  });
  it('reserves one target and bed and safely lowers a carried prisoner on interruption', () => {
    const s = new Host(), w = s.pawns[0], q = s.pawns[1], other = person(3);
    s.pawns.push(other);
    expect(startCapture(s, w, q).ok).toBe(true);
    expect(startCapture(s, other, q).ok).toBe(false);
    s.until(() => w.carryingPawnId === q.id);
    const carriedPosition = at(w); s.prisonRelease(w);
    expect(q.carriedBy).toBeNull(); expect(w.carryingPawnId).toBeNull();
    expect(at(q)).toBe(carriedPosition); expect(q.faction).toBe('prisoner');
    expect(q.prisoner?.bedId).toBe(90); expect(s.pawns).toHaveLength(3);
  });
  it('waits a real cooldown after resistance reaches zero and then recruits without replacing identity', () => {
    const s = new Host(), w = s.pawns[0], q = s.jailed();
    q.prisoner!.resistance = .1;
    const identity = { id: q.id, skills: structuredClone(q.skills), trauma: structuredClone(q.trauma), medical: structuredClone(q.medical) };
    expect(setPrisonerPolicy(s, q, 'recruit').ok).toBe(true);
    expect(tryWarden(s, w)).toBe(true);
    s.until(() => w.wardenTask === null);
    expect(q.faction).toBe('prisoner'); expect(q.prisoner!.resistance).toBe(0);
    expect(tryWarden(s, w)).toBe(false);
    s.tick = q.prisoner!.nextInteractionTick;
    expect(tryWarden(s, w)).toBe(true); s.until(() => q.faction === 'colony');
    expect(q).toMatchObject(identity); expect(q.prisoner).toBeNull();
    expect(s.beds[0].owner).toBeNull(); expect(q.priorities.build).toBeGreaterThan(0);
    expect(s.pawns).toHaveLength(2);
  });
  it('persists partial conversation and prevents disconnected speech or loss of talking capacity', () => {
    const s = new Host(), q = s.jailed(); q.prisoner!.policy = 'recruit';
    expect(tryWarden(s, s.pawns[0])).toBe(true);
    s.until(() => (s.pawns[0].wardenTask?.progress ?? 0) >= 100);
    const save = JSON.parse(JSON.stringify({ tick: s.tick, pawns: s.pawns, beds: s.beds }));
    const restored = new Host(); Object.assign(restored, save);
    expect(validWardenTask(restored.pawns[0].wardenTask)).toBe(true);
    expect(validPrisonerState(restored.pawns[1].prisoner, restored.tick)).toBe(true);
    s.until(() => s.pawns[0].wardenTask === null); restored.until(() => restored.pawns[0].wardenTask === null);
    expect(restored.pawns[1].prisoner).toEqual(s.pawns[1].prisoner);
    const fresh = new Host(), inmate = fresh.jailed(), w = fresh.pawns[0]; inmate.prisoner!.policy = 'recruit';
    expect(tryWarden(fresh, w)).toBe(true); fresh.until(() => w.wardenTask?.stage === 'talk');
    applyInjury(w.trauma, 401, 'jaw', 'cut', BODY_PARTS.jaw.hitPoints + 1);
    const resistance = inmate.prisoner!.resistance;
    fresh.step(); expect(w.wardenTask).toBeNull(); expect(inmate.prisoner!.resistance).toBe(resistance);
  });
  it('requires a face-to-face release and keeps the prisoner until they physically reach an edge', () => {
    const s = new Host(), w = s.pawns[0], q = s.jailed();
    expect(setPrisonerPolicy(s, q, 'release').ok).toBe(true);
    q.downed = true; expect(tryWarden(s, w)).toBe(false); q.downed = false;
    expect(tryWarden(s, w)).toBe(true);
    expect(q.prisoner!.releasing).toBe(false); expect(s.pawns).toContain(q);
    s.until(() => q.prisoner!.releasing);
    expect(s.pawns).toContain(q); expect(s.beds[0].owner).toBeNull(); expect(q.prisoner!.bedId).toBeNull();
    expect(setPrisonerPolicy(s, q, 'recruit').ok).toBe(false);
    s.until(() => !s.pawns.includes(q)); expect(q.x).toBe(63); expect(s.pawns).toHaveLength(1);
  });
  it('stays confined, routes food queries through cell limits, sleeps physically and waits for broken-room repair', () => {
    const s = new Host(), q = s.jailed(); q.food = 20; q.rest = 5;
    const foodBefore = q.food, restBefore = q.rest;
    prisonerTick(s, q); expect(q.food).toBe(foodBefore); expect(q.sleepingSince).toBe(s.tick);
    expect(s.foodCalls[0]).toEqual(s.prisonCells(q));
    s.step(20); expect(q.rest).toBeGreaterThan(restBefore); expect(q.path).toEqual([]);
    s.roomValid = false; s.step(); expect(q.path).toEqual([]); expect(q.sleepingSince).toBeNull();
    expect(q.reason).toContain('等待看守转移'); expect(q.faction).toBe('prisoner');
    expect(q.jobId).toBeNull(); expect(q.attackTargetId).toBeNull();
  });
  it('delegates hungry healthy prisoner delivery to physical care before talking', () => {
    const s = new Host(), w = s.pawns[0], q = s.jailed(); q.food = 20; q.prisoner!.policy = 'recruit';
    s.allowFeed = true; expect(tryWarden(s, w)).toBe(true);
    expect(w.carePhase).toBe('feedFetch'); expect(w.patientId).toBe(q.id);
    expect(w.wardenTask).toBeNull(); expect(q.food).toBe(20); expect(q.prisoner!.resistance).toBe(24);
  });
});
