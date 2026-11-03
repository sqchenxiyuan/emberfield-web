import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { at, Block, index, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { freshBatch } from '../src/voxel/preservation';
import { makeFire, FIRE_MAX_HP, fireDamageKey } from '../src/voxel/fire';

const pos = (x: number, y = 14, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c); expect(r.ok, r.message).toBe(true); return r;
}
function until(s: VoxelSimulation, done: () => boolean, limit = 5000) {
  for (let i = 0; i < limit && !done(); i++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, fires: s.fires, damage: s.fireDamage,
    pawns: s.pawns.map(p => ({ id: p.id, phase: p.phase, reason: p.reason,
      fire: p.firefightTask, repair: p.repairTask, position: pos(p.x, p.y, p.z) })) })).toBe(true);
}
/** Controlled geometry and ignition fixtures isolate destructive edge cases.
 * They are deliberately separate from the normal incident campaign, which
 * creates its fires only through ordinary events and actual construction. */
function fixture(configure?: (s: VoxelSimulation) => void) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  s.animals = []; s.trees = []; s.treePlots = []; s.items = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 25; x++) for (let y = 10; y <= 20; y++)
    for (let z = 8; z <= 9; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11, 11); s.homeArea.clear();
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(11 + i)); p.schedule.fill('work'); p.food = 95; p.rest = 95;
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof Pawn['priorities']] = 0;
  }
  command(s, { type: 'threats', enabled: false });
  command(s, { type: 'fireHazards', enabled: false });
  configure?.(s);
  return VoxelSimulation.load(s.save());
}
function ignite(s: VoxelSimulation, p = pos(19, 17), size = .6) {
  const f = makeFire(s.nextId++, p, s.tick, 'shortCircuit', size);
  s.fires.push(f); return f;
}
function wood(s: VoxelSimulation, p = pos(19, 17), amount = 20) {
  const item = { ...freshBatch('wood', amount), ...p, id: s.nextId++ };
  s.items.push(item); return item;
}
function home(s: VoxelSimulation, from = pos(10, 10), to = pos(25, 20)) {
  command(s, { type: 'homeArea', from, to, enabled: true });
}

describe('fire lifecycle and physical interruption integration', () => {
  it('migrates unchanged genuine v25 bytes without adding fire, damage, resources or resetting people', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v25-fire-initial.json', import.meta.url));
    const proof = JSON.parse(readFileSync(new URL('./fixtures/voxel-v25-fire-initial.provenance.json', import.meta.url), 'utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(proof.sha256);
    const old = JSON.parse(bytes.toString()), s = VoxelSimulation.load(old);
    expect(old.version).toBe(25); expect(s.save().version).toBe(29);
    expect(s.fires).toEqual([]); expect(s.fireDamage).toEqual([]);
    expect(s.items).toEqual(old.items); expect(s.stats).toEqual(old.stats);
    expect(s.pawns.map(p => ({ id: p.id, ...pos(p.x, p.y, p.z) })))
      .toEqual(old.pawns.map((p: Pawn) => ({ id: p.id, ...pos(p.x, p.y, p.z) })));
    expect(s.pawns.every(p => p.firefightTask === null && p.repairTask === null)).toBe(true);
    expect(s.tick).toBe(old.tick);
    expect(s.fireHazards.nextIncidentTick).toBeGreaterThan(s.tick);
    expect(VoxelSimulation.load(s.save()).fireHazards).toEqual(s.fireHazards);
  });

  it('keeps the same incident deadline through immediate disable, save, load and re-enable', () => {
    let s = new VoxelSimulation(73129);
    const before = structuredClone(s.fireHazards);
    command(s, { type: 'fireHazards', enabled: false });
    s = VoxelSimulation.load(s.save());
    command(s, { type: 'fireHazards', enabled: true });
    expect(s.fireHazards).toEqual(before);
    expect(s.fires).toEqual([]);
  });

  it('requires Home even when forced, walks to touch range, and reserves the fire for one worker', () => {
    const s = fixture(), p = s.pawns[0], other = s.pawns[1];
    wood(s); const f = ignite(s);
    expect(s.command({ type: 'firefight', pawnId: p.id, fireId: f.id }).ok).toBe(false);
    home(s);
    command(s, { type: 'firefight', pawnId: p.id, fireId: f.id });
    expect(p.path.length).toBeGreaterThan(0); expect(p.firefightTask?.progress).toBe(0);
    expect(s.command({ type: 'firefight', pawnId: other.id, fireId: f.id }).ok).toBe(false);
    s.step(); expect(p.firefightTask?.progress).toBe(0);
    until(s, () => (p.firefightTask?.progress ?? 0) > 0);
    expect(Math.abs(p.x-f.x)+Math.abs(p.y-f.y)+Math.abs(p.z-f.z)).toBeLessThanOrEqual(1);
    until(s, () => !s.fires.some(q => q.id === f.id));
    expect(s.fireLog.some(e => e.type === 'extinguished')).toBe(true);
    expect(p.firefightTask).toBeNull();
    expect(s.items.some(i => i.resource === 'wood')).toBe(true);
  });

  it('retains beating progress on reload and releases it immediately on draft and Home removal', () => {
    let s = fixture(); wood(s); const f = ignite(s); home(s);
    const id = s.pawns[0].id;
    command(s, { type: 'firefight', pawnId: id, fireId: f.id });
    until(s, () => (s.pawns[0].firefightTask?.progress ?? 0) > 5);
    const progress = s.pawns[0].firefightTask!.progress, fire = structuredClone(s.fires[0]);
    s = VoxelSimulation.load(s.save());
    expect(s.pawns[0].firefightTask?.progress).toBe(progress); expect(s.fires[0]).toEqual(fire);
    command(s, { type: 'draft', pawnId: id, drafted: true });
    expect(s.pawns[0].firefightTask).toBeNull();
    const other = s.pawns[1]; command(s, { type: 'firefight', pawnId: other.id, fireId: f.id });
    command(s, { type: 'homeArea', from: pos(f.x, f.y, f.z), enabled: false });
    expect(other.firefightTask).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('burns real ground stock into the destruction ledger without inventing replacement materials', () => {
    const s = fixture(), item = wood(s, pos(19, 17), 10), before = s.counts();
    ignite(s, item, 1.2);
    until(s, () => !s.items.some(i => i.id === item.id));
    expect(s.stats.destroyed.wood).toBe(10);
    expect(s.counts().wood + s.stats.destroyed.wood).toBe(before.wood);
    expect(s.stats.produced.wood).toBe(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('dispatches automatic Home firefighting and releases the assignment when that work is disabled', () => {
    const s = fixture(), p = s.pawns[0];
    wood(s, pos(19, 17), 75); const f = ignite(s); home(s);
    command(s, { type: 'priority', pawnId: p.id, work: 'firefight', value: 1 });
    until(s, () => p.firefightTask?.fireId === f.id);
    command(s, { type: 'priority', pawnId: p.id, work: 'firefight', value: 0 });
    expect(p.firefightTask).toBeNull();
    s.step(10); expect(p.firefightTask).toBeNull();
    expect(s.fires.some(q => q.id === f.id)).toBe(true);
    command(s, { type: 'priority', pawnId: p.id, work: 'firefight', value: 1 });
    until(s, () => p.firefightTask?.fireId === f.id);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('heats an enclosed room while burning, preserves partial wall damage and repairs it through real work', () => {
    let s = fixture(s => {
      s.blocks[at(pos(19, 17))] = Block.Wood;
      s.structureKinds[at(pos(19, 17))] = 2;
    });
    const f = ignite(s), p = s.pawns[0], initialTemperature = s.temperature(pos(18, 17));
    home(s); command(s, { type: 'firefight', pawnId: p.id, fireId: f.id });
    until(s, () => !s.fires.length);
    expect(s.blocks[at(f)]).toBe(Block.Wood);
    expect(s.temperature(pos(18, 17))).toBeGreaterThan(initialTemperature);
    const d = s.fireDamage.find(d => d.kind === 'block' && at(d) === at(f)); expect(d).toBeDefined();
    expect(d!.hitPoints).toBeLessThan(d!.maxHitPoints);
    const counts = s.counts(), consumed = structuredClone(s.stats.consumed), destroyed = structuredClone(s.stats.destroyed);
    command(s, { type: 'repair', pawnId: p.id, damageKey: d!.key });
    until(s, () => (p.repairTask?.progress ?? 0) > 0);
    const saved = s.save(); s = VoxelSimulation.load(saved);
    expect(s.pawns[0].repairTask).toEqual(saved.pawns[0].repairTask);
    until(s, () => !s.fireDamage.some(x => x.key === d!.key));
    expect(s.blocks[at(f)]).toBe(Block.Wood);
    expect(s.counts()).toEqual(counts); expect(s.stats.consumed).toEqual(consumed);
    expect(s.stats.destroyed).toEqual(destroyed);
  });

  it('lets a supporting wooden floor burn and settles the person and real stock onto lower ground', () => {
    let bedId = 0, itemId = 0;
    const upper = pos(17, 16, 11), floor = pos(17, 16, 10);
    const s = fixture(s => {
      for (let x = 16; x <= 19; x++) for (let y = 15; y <= 17; y++)
        for (let z = 10; z <= 13; z++) s.blocks[index(x, y, z)] = Block.Air;
      for (let x = 16; x <= 19; x++) for (let y = 15; y <= 17; y++) {
        s.blocks[index(x, y, 10)] = Block.Wood; s.structureKinds[index(x, y, 10)] = 1;
      }
      Object.assign(s.pawns[0], upper);
      bedId = s.nextId++;
      s.beds.push({ ...upper, id: bedId, axis: 'x', owner: s.pawns[0].id, medical: false, prisoner: false });
      itemId = wood(s, pos(17, 15, 11), 12).id;
    });
    ignite(s, upper, 1.7); ignite(s, pos(17, 15, 11), 1.7);
    until(s, () => s.blocks[at(floor)] === Block.Air);
    expect(s.pawns[0].z).toBeLessThan(upper.z);
    expect(s.standable(s.pawns[0])).toBe(true);
    expect(s.beds.some(b => b.id === bedId)).toBe(false);
    const item = s.items.find(i => i.id === itemId);
    if (item) expect(s.standable(item)).toBe(true);
    expect(s.counts().wood + s.stats.destroyed.wood).toBe(12);
    expect(s.fireLog.some(e => e.type === 'fell')).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('rejects duplicate fire identity, impossible damage targets, and conflicting task ownership', () => {
    const s = fixture(); wood(s); const f = ignite(s); home(s);
    command(s, { type: 'firefight', pawnId: s.pawns[0].id, fireId: f.id });
    const raw = s.save(), duplicate = structuredClone(raw);
    duplicate.fires.push(structuredClone(f));
    expect(() => VoxelSimulation.load(duplicate)).toThrow();
    const damage = structuredClone(raw), target = pos(20, 17);
    damage.fireDamage.push({ ...target, kind: 'bed', targetId: 999999,
      key: fireDamageKey('bed', 999999, target), hitPoints: 50, maxHitPoints: FIRE_MAX_HP.bed });
    expect(() => VoxelSimulation.load(damage)).toThrow();
    const conflict = structuredClone(raw);
    Object.assign(conflict.pawns[1], { ...pos(raw.pawns[0].x, raw.pawns[0].y, raw.pawns[0].z),
      phase: 'firefight', firefightTask: structuredClone(raw.pawns[0].firefightTask),
      path: [...raw.pawns[0].path], destination: raw.pawns[0].destination });
    expect(() => VoxelSimulation.load(conflict)).toThrow();
  });
});
