import { stripRangedDefaults } from './legacy-ranged-defaults';
import { legacySimulation } from './fixtures/legacy-start';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { assignmentAt, defaultSchedule, restGain, restLoss, wantsSleep } from '../src/voxel/rest';
import { hourAt } from '../src/voxel/farming';
import {
  DAY,
  at,
  bedCells,
  type Assignment,
  type Counts,
  type Pos,
  type Resource,
  type VoxelCommand,
  type Work,
} from '../src/voxel/types';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
const works: Work[] = ['dig', 'build', 'cut', 'haul', 'grow', 'cook', 'craft'];
function command(sim: VoxelSimulation, c: VoxelCommand) {
  const result = sim.command(c);
  expect(result.ok, JSON.stringify({ c, result })).toBe(true);
  return result;
}
function conserved(sim: VoxelSimulation, initial: Counts) {
  const current = sim.counts();
  for (const resource of Object.keys(initial) as Resource[])
    expect(
      current[resource] + sim.stats.consumed[resource] + sim.stats.spoiled[resource],
      `${resource} at tick ${sim.tick}`,
    ).toBe(initial[resource] + sim.stats.produced[resource]);
  expect(sim.pawns.every((p) => sim.standable(p))).toBe(true);
}
function until(sim: VoxelSimulation, condition: () => boolean, limit = 12000) {
  const initial = sim.counts(),
    consumed = { ...sim.stats.consumed },
    produced = { ...sim.stats.produced },
    spoiled = { ...sim.stats.spoiled };
  const origin = Object.fromEntries(
    Object.keys(initial).map((r) => [
      r,
      initial[r as Resource] +
        consumed[r as Resource] +
        spoiled[r as Resource] -
        produced[r as Resource],
    ]),
  ) as unknown as Counts;
  for (let i = 0; i < limit && !condition(); i++) {
    sim.step();
    if (i % 40 === 0) conserved(sim, origin);
  }
  expect(
    condition(),
    JSON.stringify({
      tick: sim.tick,
      beds: sim.beds,
      doors: sim.doors,
      jobs: sim.jobs,
      pawns: sim.pawns,
    }),
  ).toBe(true);
  conserved(sim, origin);
}
function bedWorld() {
  const sim = legacySimulation();
  command(sim, { type: 'designate', tool: 'bed', from: pos(31, 30), axis: 'x' });
  until(sim, () => sim.beds.length === 1);
  return sim;
}
function makeSleepy(sim: VoxelSimulation, pawnId = sim.pawns[0].id) {
  until(sim, () => sim.pawns.find((p) => p.id === pawnId)!.rest < 74.9);
  return sim.pawns.find((p) => p.id === pawnId)!;
}
function schedule(sim: VoxelSimulation, pawnId: number, value: Assignment) {
  for (let hour = 0; hour < 24; hour++)
    command(sim, { type: 'schedule', pawnId, hour, assignment: value });
}

describe('normal-command voxel housing', () => {
  it('builds a two-cell bed and two-high doorway from physically delivered wood, then refunds demolition', () => {
    const sim = legacySimulation(),
      initial = sim.counts();
    command(sim, { type: 'designate', tool: 'bed', from: pos(31, 30), axis: 'x' });
    command(sim, { type: 'designate', tool: 'door', from: pos(34, 31), axis: 'y' });
    expect(sim.jobs.find((j) => j.kind === 'bed')).toMatchObject({ cost: { wood: 45 }, work: 187 });
    expect(sim.jobs.find((j) => j.kind === 'door')).toMatchObject({
      cost: { wood: 25 },
      work: 199,
    });
    until(sim, () => sim.beds.length === 1 && sim.doors.length === 1);
    expect(bedCells(sim.beds[0])).toEqual([pos(31, 30), pos(32, 30)]);
    expect(sim.stats.consumed.wood).toBe(70);
    expect(sim.counts().wood).toBe(20);
    expect(sim.rooms.roomAt(pos(34, 31))).toBeNull();
    command(sim, { type: 'designate', tool: 'remove', from: pos(32, 30) });
    command(sim, { type: 'designate', tool: 'remove', from: pos(34, 31) });
    until(sim, () => sim.beds.length === 0 && sim.doors.length === 0);
    expect(sim.stats.produced.wood).toBe(22 + 12);
    expect(sim.counts().wood).toBe(54);
    conserved(sim, initial);
  });

  it('rejects overlapping second bed cells and invalid housing commands atomically', () => {
    const sim = legacySimulation();
    command(sim, { type: 'designate', tool: 'bed', from: pos(31, 30), axis: 'x' });
    const invalid: unknown[] = [
      { type: 'designate', tool: 'bed', from: pos(32, 30), axis: 'y' },
      { type: 'designate', tool: 'bed', from: pos(63, 30), axis: 'x' },
      { type: 'designate', tool: 'door', from: pos(31, 30), to: pos(32, 30) },
      { type: 'designate', tool: 'bed', from: pos(34, 30), axis: 'z' },
      { type: 'bedOwner', bedId: -1, pawnId: sim.pawns[0].id },
      { type: 'schedule', pawnId: sim.pawns[0].id, hour: 24, assignment: 'sleep' },
      { type: 'schedule', pawnId: sim.pawns[0].id, hour: 8, assignment: 'invalid' },
      { type: 'door', doorId: -1, mode: 'locked' },
      { type: 'rest', pawnId: sim.pawns[0].id },
    ];
    for (const c of invalid) {
      const before = sim.save();
      expect(sim.command(c as VoxelCommand).ok).toBe(false);
      expect(sim.save()).toEqual(before);
    }
  });

  it('releases a construction reservation and drops carried material without loss when sleep interrupts work', () => {
    const sim = legacySimulation(),
      initial = sim.counts(),
      pawn = makeSleepy(sim);
    for (const other of sim.pawns)
      if (other.id !== pawn.id)
        for (const work of works)
          command(sim, { type: 'priority', pawnId: other.id, work, value: 0 });
    command(sim, { type: 'designate', tool: 'bed', from: pos(31, 30), axis: 'x' });
    until(sim, () => pawn.cargo?.resource === 'wood' && pawn.jobId !== null);
    const job = sim.jobs.find((j) => j.id === pawn.jobId)!;
    const before = sim.counts();
    command(sim, { type: 'rest', pawnId: pawn.id });
    expect(pawn.phase).toBe('rest');
    expect(pawn.cargo).toBeNull();
    expect(job.owner).toBeNull();
    expect(sim.counts()).toEqual(before);
    conserved(sim, initial);
  });

  it('walks to the owned bed, gains rest there, and preserves real sleeping state through v3 saves', () => {
    const sim = bedWorld(),
      pawn = makeSleepy(sim),
      bed = sim.beds[0];
    command(sim, { type: 'bedOwner', bedId: bed.id, pawnId: pawn.id });
    command(sim, { type: 'rest', pawnId: pawn.id });
    until(sim, () => pawn.phase === 'rest');
    expect(at(pawn)).toBe(at(bed));
    expect(pawn.sleepBedId).toBe(bed.id);
    expect(pawn.sleepingSince).not.toBeNull();
    const rest = pawn.rest;
    sim.step(100);
    expect(pawn.rest - rest).toBeCloseTo(restGain(true) * 100, 7);
    const save = sim.save(),
      restored = VoxelSimulation.load(save),
      copy = restored.pawns.find((p) => p.id === pawn.id)!;
    expect(save.version).toBe(30);
    expect(restored.counts()).toEqual(sim.counts());
    expect(copy).toMatchObject({
      phase: 'rest',
      sleepBedId: bed.id,
      sleepingSince: pawn.sleepingSince,
      rest: pawn.rest,
    });
    sim.step(20);
    restored.step(20);
    expect(copy.rest).toBeCloseTo(pawn.rest, 9);
    command(restored, {
      type: 'schedule',
      pawnId: copy.id,
      hour: Math.floor(hourAt(restored.tick)),
      assignment: 'work',
    });
    restored.step();
    expect(copy.phase).toBe('idle');
    expect(copy.sleepBedId).toBeNull();
    expect(copy.sleepingSince).toBeNull();
  });

  it('restores a manual sleep request made around 74 rest during Anything while still walking to bed', () => {
    const sim = bedWorld(),
      pawn = makeSleepy(sim),
      bed = sim.beds[0];
    schedule(sim, pawn.id, 'anything');
    command(sim, { type: 'bedOwner', bedId: bed.id, pawnId: pawn.id });
    command(sim, { type: 'move', pawnId: pawn.id, target: pos(35, 34) });
    until(sim, () => at(pawn) === at(pos(35, 34)) && pawn.phase === 'idle');
    expect(pawn.rest).toBeGreaterThan(70);
    expect(pawn.rest).toBeLessThan(75);
    command(sim, { type: 'rest', pawnId: pawn.id });
    expect(pawn.phase).toBe('sleepTravel');
    expect(pawn.path.length).toBeGreaterThan(0);
    const restored = VoxelSimulation.load(sim.save()),
      copy = restored.pawns.find((p) => p.id === pawn.id)!;
    expect(restored.counts()).toEqual(sim.counts());
    expect(copy).toMatchObject({ phase: 'sleepTravel', sleepBedId: bed.id, sleepingSince: null });
    expect(copy.path.length).toBeGreaterThan(0);
    until(restored, () => copy.phase === 'rest');
    expect(at(copy)).toBe(at(bed));
    expect(copy.sleepBedId).toBe(bed.id);
  });

  it('rejects placing a ladder in door headroom or a wall in bed headroom without changing state', () => {
    const sim = bedWorld();
    command(sim, { type: 'designate', tool: 'door', from: pos(34, 31), axis: 'x' });
    until(sim, () => sim.doors.length === 1);
    for (const c of [
      { type: 'designate', tool: 'ladder', from: pos(34, 31, 9) },
      { type: 'designate', tool: 'wall', from: pos(31, 30, 9) },
      { type: 'designate', tool: 'ladder', from: pos(32, 30, 9) },
    ] as VoxelCommand[]) {
      const before = sim.save();
      expect(sim.command(c).ok).toBe(false);
      expect(sim.save()).toEqual(before);
    }
  });

  it('uses slower ground sleeping when no bed exists and wakes at full rest under a sleep schedule', () => {
    const sim = legacySimulation(),
      pawn = makeSleepy(sim);
    schedule(sim, pawn.id, 'sleep');
    command(sim, { type: 'rest', pawnId: pawn.id });
    expect(pawn.phase).toBe('rest');
    expect(pawn.sleepBedId).toBeNull();
    const start = pawn.rest;
    sim.step(100);
    expect(pawn.rest - start).toBeCloseTo(restGain(false) * 100, 7);
    expect(restGain(false) / restGain(true)).toBeCloseTo(0.8, 12);
    until(sim, () => pawn.phase !== 'rest', 2400);
    expect(pawn.rest).toBe(100);
    expect(pawn.sleepingSince).toBeNull();
  });

  it('claims at most one bed per owner and wakes an occupant when ownership changes', () => {
    const sim = bedWorld();
    command(sim, { type: 'designate', tool: 'bed', from: pos(34, 30), axis: 'y' });
    until(sim, () => sim.beds.length === 2);
    const [first, second] = sim.beds,
      pawn = makeSleepy(sim),
      other = sim.pawns[1];
    command(sim, { type: 'bedOwner', bedId: first.id, pawnId: pawn.id });
    command(sim, { type: 'rest', pawnId: pawn.id });
    until(sim, () => pawn.phase === 'rest');
    command(sim, { type: 'bedOwner', bedId: second.id, pawnId: pawn.id });
    expect(first.owner).toBeNull();
    expect(second.owner).toBe(pawn.id);
    expect(pawn.phase).toBe('idle');
    command(sim, { type: 'bedOwner', bedId: first.id, pawnId: other.id });
    expect(new Set(sim.beds.map((b) => b.owner)).size).toBe(2);
    const before = sim.save();
    expect(sim.command({ type: 'bedOwner', bedId: first.id, pawnId: -5 }).ok).toBe(false);
    expect(sim.save()).toEqual(before);
  });

  it('reserves an unowned bed during travel so another sleeper uses the floor, and dismantling wakes its occupant', () => {
    const sim = bedWorld(),
      initialWood = 90,
      [first, second] = sim.pawns;
    until(sim, () => first.rest < 74.9 && second.rest < 74.9);
    const bed = sim.beds[0];
    expect(bed.owner).toBeNull();
    command(sim, { type: 'rest', pawnId: first.id });
    expect(first.sleepBedId).toBe(bed.id);
    expect(bed.owner).toBe(first.id);
    command(sim, { type: 'rest', pawnId: second.id });
    expect(second.sleepBedId).toBeNull();
    expect(second.phase).toBe('rest');
    expect(sim.pawns.filter((p) => p.sleepBedId === bed.id)).toHaveLength(1);
    until(sim, () => first.phase === 'rest');
    schedule(sim, second.id, 'work');
    command(sim, { type: 'designate', tool: 'remove', from: bedCells(bed)[1] });
    until(sim, () => sim.beds.length === 0);
    expect(first.sleepBedId).toBeNull();
    expect(first.sleepingSince).toBeNull();
    expect(first.phase).not.toBe('rest');
    expect(sim.counts().wood + sim.stats.consumed.wood - sim.stats.produced.wood).toBe(initialWood);
    expect(sim.stats.produced.wood).toBe(22);
  });

  it('does not force a sleeping pawn awake at 06:00 when the next assignment is Anything', () => {
    const sim = bedWorld(),
      pawn = sim.pawns[0];
    command(sim, { type: 'bedOwner', bedId: sim.beds[0].id, pawnId: pawn.id });
    schedule(sim, pawn.id, 'work');
    sim.step(10975 - sim.tick);
    expect(pawn.rest).toBeLessThan(30);
    command(sim, { type: 'schedule', pawnId: pawn.id, hour: 5, assignment: 'sleep' });
    command(sim, { type: 'schedule', pawnId: pawn.id, hour: 6, assignment: 'anything' });
    command(sim, { type: 'rest', pawnId: pawn.id });
    until(sim, () => pawn.phase === 'rest', 24);
    expect(sim.tick).toBeLessThan(11000);
    sim.step(11001 - sim.tick);
    expect(assignmentAt(pawn.schedule, sim.tick)).toBe('anything');
    expect(pawn.phase).toBe('rest');
    expect(pawn.sleepBedId).toBe(sim.beds[0].id);
  });

  it('under Work, keeps sleeping below 20 and wakes on the tick that rest reaches 20', () => {
    const sim = bedWorld(),
      pawn = sim.pawns[0];
    schedule(sim, pawn.id, 'work');
    command(sim, { type: 'bedOwner', bedId: sim.beds[0].id, pawnId: pawn.id });
    until(sim, () => pawn.rest < 19.5);
    command(sim, { type: 'rest', pawnId: pawn.id });
    until(sim, () => pawn.phase === 'rest');
    expect(pawn.rest).toBeLessThan(20);
    sim.step(10);
    expect(pawn.phase).toBe('rest');
    expect(pawn.rest).toBeLessThan(20);
    until(sim, () => pawn.phase === 'idle', 100);
    expect(pawn.rest).toBeGreaterThanOrEqual(20);
    expect(pawn.rest).toBeLessThan(20 + restGain(true));
    expect(pawn.sleepBedId).toBeNull();
    expect(pawn.sleepingSince).toBeNull();
  });

  it('opening delay and closing grace are based on simulation ticks, and occupied doors cannot lock', () => {
    const sim = legacySimulation(),
      pawn = sim.pawns[0];
    command(sim, { type: 'designate', tool: 'door', from: pos(33, 32), axis: 'x' });
    until(sim, () => sim.doors.length === 1);
    command(sim, { type: 'move', pawnId: pawn.id, target: pos(32, 32) });
    until(sim, () => at(pawn) === at(pos(32, 32)) && pawn.phase === 'idle');
    const door = sim.doors[0];
    command(sim, { type: 'door', doorId: door.id, mode: 'auto' });
    command(sim, { type: 'move', pawnId: pawn.id, target: pos(34, 32) });
    until(sim, () => pawn.reason === '等待木门打开', 100);
    const waitingAt = sim.tick;
    expect(at(pawn)).toBe(at(pos(32, 32)));
    until(sim, () => at(pawn) === at(door), 40);
    expect(sim.tick - waitingAt).toBe(13);
    expect(door.openUntil).toBe(sim.tick + 37);
    const before = sim.save();
    expect(sim.command({ type: 'door', doorId: door.id, mode: 'locked' }).ok).toBe(false);
    expect(sim.save()).toEqual(before);
    until(sim, () => at(pawn) === at(pos(34, 32)) && pawn.phase === 'idle');
    command(sim, { type: 'door', doorId: door.id, mode: 'locked' });
    expect(sim.standable(door)).toBe(false);
    expect(sim.path(pos(32, 32), pos(34, 32))?.includes(at(door))).toBe(false);
    command(sim, { type: 'door', doorId: door.id, mode: 'open' });
    expect(sim.standable(door)).toBe(true);
    command(sim, { type: 'move', pawnId: pawn.id, target: pos(32, 32) });
    const openStart = sim.tick;
    until(sim, () => at(pawn) === at(door), 20);
    expect(sim.tick - openStart).toBeLessThan(13);
  });

  it('refreshes room topology only for structural edits, not sleep, furniture ownership or door mode', () => {
    const sim = legacySimulation();
    const initial = sim.snapshot().roomRevision;
    sim.step(25);
    expect(sim.snapshot().roomRevision).toBe(initial);
    command(sim, { type: 'designate', tool: 'bed', from: pos(31, 30), axis: 'x' });
    until(sim, () => sim.beds.length === 1);
    expect(sim.snapshot().roomRevision).toBe(initial);
    command(sim, { type: 'bedOwner', bedId: sim.beds[0].id, pawnId: sim.pawns[0].id });
    expect(sim.snapshot().roomRevision).toBe(initial);
    command(sim, { type: 'designate', tool: 'door', from: pos(34, 31), axis: 'x' });
    until(sim, () => sim.doors.length === 1);
    expect(sim.snapshot().roomRevision).toBe(initial + 1);
    expect(sim.rooms.roomAt(pos(34, 31))).toBeNull();
    command(sim, { type: 'door', doorId: sim.doors[0].id, mode: 'open' });
    expect(sim.snapshot().roomRevision).toBe(initial + 1);
    expect(sim.rooms.roomAt(pos(34, 31))).toBeNull();
    command(sim, { type: 'designate', tool: 'remove', from: pos(34, 31) });
    until(sim, () => sim.doors.length === 0);
    expect(sim.snapshot().roomRevision).toBe(initial + 2);
    expect(sim.rooms.roomAt(pos(34, 31))).not.toBeNull();
  });

  it('migrates v2 and v1 data formats without adding furniture or altering material totals', () => {
    const sim = legacySimulation();
    command(sim, { type: 'designate', tool: 'wall', from: pos(32, 31) });
    until(sim, () =>
      sim.jobs.some((job) => (job.delivered.wood ?? 0) > 0 && job.progress < job.work),
    );
    const before = sim.counts();
    for (const version of [1, 2]) {
      // Data-format migration fixture: strip only fields absent from historical schemas.
      const old = structuredClone(sim.save()) as unknown as Record<string, any>;
      stripRangedDefaults(old);      old.version = version;
      delete old.beds;
      delete old.doors;
      for (const pawn of old.pawns) {
        delete pawn.schedule;
        delete pawn.sleepBedId;
        delete pawn.sleepingSince;
      }
      if (version === 1) {
        for (const job of old.jobs) {
          job.cost = job.cost.wood ?? 0;
          job.delivered = job.delivered.wood ?? 0;
        }
        for (const pawn of old.pawns) {
          delete pawn.priorities.grow;
          delete pawn.priorities.cook;
          delete pawn.eating;
        }
        delete old.farms;
        delete old.crops;
        delete old.stoves;
      }
      const restored = VoxelSimulation.load(old);
      expect(restored.counts()).toEqual(before);
      expect(restored.beds).toEqual([]);
      expect(restored.doors).toEqual([]);
      expect(restored.save().version).toBe(30);
      expect(
        restored.pawns.every(
          (pawn) =>
            pawn.schedule.join() === defaultSchedule().join() &&
            pawn.sleepBedId === null &&
            pawn.sleepingSince === null,
        ),
      ).toBe(true);
      until(restored, () => restored.jobs.length === 0);
      expect(restored.stats.consumed.wood).toBe(6);
    }
  });

  it('rejects malformed saved sleep ownership, schedule, door mode and duplicate bed owners', () => {
    const sim = bedWorld();
    command(sim, { type: 'designate', tool: 'door', from: pos(34, 31), axis: 'x' });
    until(sim, () => sim.doors.length === 1);
    command(sim, { type: 'designate', tool: 'cut', from: pos(27, 29) });
    until(sim, () => sim.stats.cut === 1);
    command(sim, { type: 'designate', tool: 'bed', from: pos(35, 33), axis: 'y' });
    until(sim, () => sim.beds.length === 2);
    const invalid: ((save: ReturnType<VoxelSimulation['save']>) => void)[] = [
      (save) => {
        save.pawns[0].schedule.pop();
      },
      (save) => {
        save.pawns[0].sleepBedId = save.beds[0].id;
      },
      (save) => {
        save.pawns[0].sleepingSince = save.tick + 1;
      },
      (save) => {
        save.beds[0].owner = -1;
      },
      (save) => {
        save.beds[0].axis = 'z' as 'x';
      },
      (save) => {
        save.doors[0].mode = 'broken' as 'auto';
      },
      (save) => {
        save.doors[0].openUntil = -1;
      },
      (save) => {
        save.beds[0].owner = save.pawns[0].id;
        save.beds[1].owner = save.pawns[0].id;
      },
    ];
    for (const modify of invalid) {
      const save = sim.save();
      modify(save);
      expect(() => VoxelSimulation.load(save)).toThrow();
    }
  });
});

describe('rest schedule policy and day-scaled rates', () => {
  it.each([
    [29.99, 'anything', true],
    [30, 'anything', false],
    [74.99, 'sleep', true],
    [75, 'sleep', false],
    [0.99, 'work', true],
    [1, 'work', false],
    [29, 'work', false],
  ] as const)('rest=%s under %s requests sleep=%s', (rest, assignment, expected) => {
    expect(wantsSleep(rest, assignment)).toBe(expected);
  });
  it('preserves game-day rates and switches default assignments at their actual clock boundaries', () => {
    expect(restLoss(100) * DAY).toBeCloseTo(95, 10);
    expect(restGain(true) * DAY).toBeCloseTo(228.57144, 8);
    expect(assignmentAt(defaultSchedule(), 6999)).toBe('anything');
    expect(assignmentAt(defaultSchedule(), 7000)).toBe('sleep');
    expect(assignmentAt(defaultSchedule(), 10999)).toBe('sleep');
    expect(assignmentAt(defaultSchedule(), 11000)).toBe('anything');
  });
});
