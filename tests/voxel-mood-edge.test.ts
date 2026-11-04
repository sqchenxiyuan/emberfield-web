import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Pos, type VoxelCommand } from '../src/voxel/types';
import { applyInjury } from '../src/voxel/injuries';
import { BODY_PARTS } from '../src/voxel/anatomy';
import { healthSummary } from '../src/voxel/survival';
import { freshBatch } from '../src/voxel/preservation';

const pos = (x: number, y = 16): Pos => ({ x, y, z: 8 });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c); expect(result.ok, result.message).toBe(true);
}
function until(s: VoxelSimulation, done: () => boolean, limit = 1500) {
  for (let n = 0; n < limit && !done(); n++) s.step();
  expect(done(), JSON.stringify(s.pawns.map(p => ({ phase: p.phase, reason: p.reason })))).toBe(true);
}
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  s.animals = []; s.trees = []; s.items = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 8; x <= 30; x++) for (let y = 8; y <= 26; y++)
    for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(12, 16 + i)); p.schedule.fill('work');
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
  }
  return VoxelSimulation.load(s.save());
}
function playing() {
  const s = fixture(), p = s.pawns[0];
  s.horseshoePins.push({ ...pos(18), id: s.nextId++ });
  command(s, { type: 'recreate', pawnId: p.id });
  until(s, () => p.path.length === 0);
  expect(p.psyche.recreation?.kind).toBe('horseshoes');
  return { s, p };
}

describe('recreation interruption and save boundaries', () => {
  it('preserves the existing construction reservation when a manual break cannot unload cargo', () => {
    const s = fixture(), p = s.pawns[0]; p.priorities.build = 1;
    s.items.push({ ...freshBatch('wood', 40), ...pos(14), id: s.nextId++ });
    command(s, { type: 'designate', tool: 'horseshoePin', from: pos(26) });
    until(s, () => !!p.cargo);
    // Deliberately full ground isolates failed unloading; every physical item remains legal.
    for (let x = 8; x <= 30; x++) for (let y = 8; y <= 26; y++) {
      const point = pos(x, y), item = s.items.find(i => at(i) === at(point));
      if (item) item.amount = 75;
      else s.items.push({ ...freshBatch('stone', 75), ...point, id: s.nextId++ });
    }
    const cargo = structuredClone(p.cargo), job = s.jobs.find(j => j.id === p.jobId)!, beforeJobId = p.jobId;
    const beforeCounts = s.counts(), beforePath = [...p.path];
    expect(s.command({ type: 'recreate', pawnId: p.id }).ok).toBe(false);
    expect(p.cargo).toEqual(cargo); expect(s.counts()).toEqual(beforeCounts);
    expect(p.jobId).toBe(beforeJobId); expect(job.owner).toBe(p.id); expect(p.path).toEqual(beforePath);
    expect(p.psyche.recreation).toBeNull();
  });

  it('interrupts even forced recreation to eat and retains a readable physical save', () => {
    const { s, p } = playing(); p.food = 20;
    s.items.push({ ...freshBatch('meal', 1), ...pos(13, 15), id: s.nextId++ });
    until(s, () => p.food > 80);
    expect(p.psyche.recreation).toBeNull(); expect(s.stats.consumed.meal).toBe(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('interrupts forced recreation for exhaustion and records actual ground sleep', () => {
    const { s, p } = playing(); p.rest = .1;
    until(s, () => p.phase === 'rest');
    expect(p.psyche.recreation).toBeNull();
    until(s, () => p.psyche.memories.some(m => m.kind === 'sleptGround'));
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('lets an enabled caregiver stop recreation for a real patient', () => {
    const { s, p } = playing(); p.priorities.care = 1;
    const patient = s.pawns[1];
    applyInjury(patient.trauma, s.nextId++, 'leftArm', 'cut', 6);
    until(s, () => p.carePhase !== null);
    expect(p.psyche.recreation).toBeNull(); expect(p.patientId).toBe(patient.id);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('stops a throwing game when the actor loses manipulation while remaining mobile', () => {
    const { s, p } = playing();
    for (const hand of ['leftHand', 'rightHand'] as const)
      applyInjury(p.trauma, s.nextId++, hand, 'cut', BODY_PARTS[hand].hitPoints + 1);
    expect(healthSummary(p).manipulation).toBe(0);
    expect(healthSummary(p).moving).toBeGreaterThan(.15);
    expect(healthSummary(p).consciousness).toBeGreaterThanOrEqual(.3);
    expect(healthSummary(p).pain).toBeLessThan(.8);
    const joy = p.psyche.joy;
    s.step();
    expect(p.downed).toBe(false);
    expect(p.psyche.recreation).toBeNull();
    expect(p.psyche.joy).toBeLessThanOrEqual(joy);
  });

  it.each(['cargo', 'sleepingSince'] as const)('rejects a recreated save carrying incompatible %s state', field => {
    const { s } = playing(), save = s.save();
    if (field === 'cargo') save.pawns[0].cargo = freshBatch('wood', 1);
    else save.pawns[0].sleepingSince = save.tick;
    expect(() => VoxelSimulation.load(save)).toThrow();
  });
});
