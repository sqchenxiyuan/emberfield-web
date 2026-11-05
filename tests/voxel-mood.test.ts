import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { relocationExpectedField } from './legacy-relocation-defaults';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, at, index, type Pos, type VoxelCommand } from '../src/voxel/types';
import { MOOD_RULES, initialPsyche } from '../src/voxel/mood';
import { HORSESHOE_COST } from '../src/voxel/recreation';

const pos = (x: number, y = 16): Pos => ({ x, y, z: 8 });
const cmd = (s: VoxelSimulation, c: VoxelCommand) => {
  const r = s.command(c); expect(r.ok, r.message).toBe(true);
};
function until(s: VoxelSimulation, condition: () => boolean, limit = 3000) {
  for (let t = 0; t < limit && !condition(); t++) s.step();
  expect(condition(), JSON.stringify(s.pawns.map(p => [p.phase, p.reason, p.psyche]))).toBe(true);
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

describe('voxel mood and recreation workflows', () => {
  it('builds with real wood, walks before gaining joy, reserves one pin and resumes a saved activity', () => {
    let s = fixture(); const id = s.pawns[0].id;
    s.items.push({ ...pos(14), id: s.nextId++, resource: 'wood', amount: 40 });
    s.pawns[0].priorities.build = 1;
    cmd(s, { type: 'designate', tool: 'horseshoePin', from: pos(23) });
    until(s, () => s.horseshoePins.length === 1);
    expect(s.stats.consumed.wood).toBe(HORSESHOE_COST.wood);
    cmd(s, { type: 'move', pawnId: id, target: pos(12) });
    until(s, () => s.pawns[0].phase === 'idle');
    const joy = s.pawns[0].psyche.joy;
    cmd(s, { type: 'recreate', pawnId: id });
    expect(s.pawns[0].psyche.recreation?.kind).toBe('horseshoes');
    expect(s.pawns[0].path.length).toBeGreaterThan(0);
    s.step(); expect(s.pawns[0].psyche.joy).toBeLessThanOrEqual(joy);
    cmd(s, { type: 'recreate', pawnId: s.pawns[1].id });
    expect(s.pawns[1].psyche.recreation?.kind).toBe('walk');
    const activity = structuredClone(s.pawns[0].psyche.recreation);
    s = VoxelSimulation.load(s.save());
    expect(s.pawns[0].psyche.recreation).toEqual(activity);
    until(s, () => s.pawns[0].psyche.joy > joy + 3);
    expect(s.pawns[0].psyche.tolerance.horseshoes).toBeGreaterThan(0);
    cmd(s, { type: 'cancelRecreation', pawnId: id });
    expect(s.pawns[0].psyche.recreation).toBeNull();
    cmd(s, { type: 'designate', tool: 'remove', from: s.horseshoePins[0] });
    until(s, () => s.horseshoePins.length === 0);
    expect(s.counts().wood).toBe(30);
  });
  it('respects work vs recreation schedule and can interrupt ordinary labor for planned recreation', () => {
    const s = fixture(), p = s.pawns[0]; p.psyche.joy = 15;
    s.step(100); expect(p.psyche.recreation).toBeNull();
    cmd(s, { type: 'schedule', pawnId: p.id, hour: Math.floor(s.snapshot().hour), assignment: 'recreation' });
    until(s, () => p.phase === 'recreation');
    expect(p.psyche.recreation?.forced).toBe(false);
    cmd(s, { type: 'schedule', pawnId: p.id, hour: Math.floor(s.snapshot().hour), assignment: 'work' });
    s.step(); expect(p.psyche.recreation).toBeNull();
    cmd(s, { type: 'recreate', pawnId: p.id });
    s.step(40); expect(p.psyche.recreation?.forced).toBe(true);
  });
  it('ends an activity when its facility is removed and returns to ordinary work without stale reservation', () => {
    const s = fixture(), p = s.pawns[0];
    s.horseshoePins.push({ ...pos(16), id: s.nextId++ });
    cmd(s, { type: 'recreate', pawnId: p.id });
    expect(p.psyche.recreation?.kind).toBe('horseshoes');
    cmd(s, { type: 'designate', tool: 'remove', from: s.horseshoePins[0] });
    s.pawns[1].priorities.build = 1;
    until(s, () => s.horseshoePins.length === 0);
    expect(p.psyche.recreation).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('releases a construction reservation at breakdown, conserves carried wood and recovers after save/load', () => {
    let s = fixture(); const id = s.pawns[0].id;
    s.pawns[0].priorities.build = 1;
    s.items.push({ ...pos(14), id: s.nextId++, resource: 'wood', amount: 40 });
    cmd(s, { type: 'designate', tool: 'horseshoePin', from: pos(26) });
    until(s, () => !!s.pawns[0].cargo);
    const p = s.pawns[0], job = s.jobs[0];
    // Controlled low-mood duration, not ordinary campaign evidence.
    p.psyche.level = 1; p.psyche.lowTicks = MOOD_RULES.lowDurationTicks - 1;
    s.step();
    expect(p.phase).toBe('mental'); expect(job.owner).toBeNull();
    expect(s.counts().wood).toBe(40);
    expect(s.command({ type: 'draft', pawnId: id, drafted: true }).ok).toBe(false);
    expect(s.command({ type: 'move', pawnId: id, target: pos(18) }).ok).toBe(false);
    cmd(s, { type: 'priority', pawnId: id, work: 'build', value: 1 });
    expect(p.phase).toBe('mental');
    const deadline = p.psyche.breakUntil;
    s = VoxelSimulation.load(s.save()); expect(s.pawns[0].psyche.breakUntil).toBe(deadline);
    until(s, () => s.pawns[0].psyche.breakUntil === 0, DAY);
    expect(s.pawns[0].psyche.memories.some(m => m.kind === 'catharsis')).toBe(true);
    until(s, () => s.horseshoePins.length === 1);
    expect(s.counts().wood + s.stats.consumed.wood).toBe(40);
  });
  it('does not silently discard cargo on recreation and detects malformed state on load', () => {
    const s = fixture(), p = s.pawns[0];
    p.cargo = { resource: 'wood', amount: 10 };
    cmd(s, { type: 'recreate', pawnId: p.id });
    expect(s.counts().wood).toBe(10);
    const save = s.save(); save.pawns[0].psyche.joy = NaN;
    expect(() => VoxelSimulation.load(save)).toThrow();
    const duplicate = s.save();
    duplicate.pawns[0].psyche.recreation!.spotId = 123456;
    expect(() => VoxelSimulation.load(duplicate)).toThrow();
  });
  it('migrates a genuine v22 checkpoint without changing world, identities, goods or existing schedules', () => {
    const old = JSON.parse(readFileSync(new URL('./fixtures/voxel-v22-mood-initial.json', import.meta.url), 'utf8'));
    expect(old.version).toBe(22); expect(old.horseshoePins).toBeUndefined();
    const saved = VoxelSimulation.load(old).save();
    expect(saved.version).toBe(59); expect(saved.horseshoePins).toEqual([]);
    for (const key of ['nextId', 'items', 'blocks', 'ladders', 'stats'] as const) expect(saved[key]).toEqual(relocationExpectedField(key, old[key]));
    expect(saved.animals).toMatchObject(old.animals);
    for (const p of saved.pawns) {
      expect(p.psyche).toEqual(initialPsyche(old.tick));
      expect(p.schedule).toEqual(old.pawns.find((q: {id:number}) => q.id === p.id).schedule);
    }
  });
});
