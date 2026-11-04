import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { at, Block, index, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { freshBatch } from '../src/voxel/preservation';
import { initialPrisoner } from '../src/voxel/prisoners';
import { initialSurvival } from '../src/voxel/survival';
import { SANITATION_RULES } from '../src/voxel/sanitation';
import { defaultProductionPolicy } from '../src/voxel/productionPolicies';

const pos = (x: number, y = 12): Pos => ({ x, y, z: 8 });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c); expect(result.ok, result.message).toBe(true);
}
function until(s: VoxelSimulation, done: () => boolean, max = 2000) {
  for (let n = 0; n < max && !done(); n++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns.map(p => p.reason) })).toBe(true);
}
/** Small explicit geometry and injected inputs isolate transaction/save boundaries.
 * Normal hunting, cooking and poisoning are covered by the separate campaign. */
function fixture(modify?: (s: VoxelSimulation) => void) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  s.animals = []; s.trees = []; s.items = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 16; x++) for (let y = 10; y <= 14; y++)
    for (let z = 8; z <= 9; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(10, 10);
  s.pawns.forEach((p, n) => {
    Object.assign(p, pos(10, 11 + n)); p.schedule.fill('work');
    for (const work of Object.keys(p.priorities)) p.priorities[work as keyof Pawn['priorities']] = 0;
  });
  modify?.(s);
  return VoxelSimulation.load(s.save());
}
function fill(s: VoxelSimulation, except: Pos[] = []) {
  for (let x = 10; x <= 16; x++) for (let y = 10; y <= 14; y++) {
    const p = pos(x, y);
    if (!except.some(q => at(p) === at(q))) s.items.push({ ...p, id: s.nextId++, ...freshBatch('wood', 75) });
  }
}

describe('sanitation physical and interrupted boundaries', () => {
  it.each([
    { clean: 4, haul: 1, expected: 'haul' },
    { clean: 1, haul: 4, expected: 'clean' },
  ])('honors clean=$clean / haul=$haul when both physical tasks exist without regular jobs', ({ clean, haul, expected }) => {
    const s = fixture(s => {
      s.items.push({ ...pos(13, 10), id: s.nextId++, ...freshBatch('wood', 3) });
      s.stockpiles.push({ ...pos(16, 10), priority: 1, accepts: ['wood'] });
    });
    const p = s.pawns[0], f = { ...pos(15, 14), id: s.nextId++, kind: 'blood' as const, amount: 2, createdTick: 0 };
    s.filth.push(f);
    command(s, { type: 'homeArea', from: f, enabled: true });
    command(s, { type: 'priority', pawnId: p.id, work: 'clean', value: clean });
    command(s, { type: 'priority', pawnId: p.id, work: 'haul', value: haul });
    expect(s.jobs).toHaveLength(0);
    until(s, () => p.phase !== 'idle', 50);
    expect(p.phase).toBe(expected);
    if (expected === 'clean') {
      expect(p.cleanTask?.filthId).toBe(f.id); expect(s.stats.hauled).toBe(0);
      until(s, () => s.filth.length === 0); expect(s.stats.hauled).toBe(0);
      until(s, () => s.stats.hauled > 0);
    } else {
      expect(p.cleanTask).toBeNull(); expect(f.amount).toBe(2);
      until(s, () => s.stats.hauled > 0); expect(f.amount).toBe(2);
      until(s, () => s.filth.length === 0);
    }
  });
  it('tracks soil onto constructed floors only after physical movement and preserves carry on load', () => {
    let s = fixture(s => {
      s.blocks[index(10, 11, 7)] = Block.Soil;
      for (let x = 11; x <= 14; x++) { s.blocks[index(x, 11, 7)] = Block.Wood; s.structureKinds[index(x, 11, 7)] = 1; }
    });
    const id = s.pawns[0].id;
    command(s, { type: 'move', pawnId: id, target: pos(14, 11) });
    expect(s.filth).toHaveLength(0);
    until(s, () => s.filth.length > 0);
    expect(s.pawns[0].dirtCarry).toBe(SANITATION_RULES.dirtCarry - 1);
    const before = structuredClone(s.filth), carry = s.pawns[0].dirtCarry;
    s = VoxelSimulation.load(s.save());
    expect(s.filth).toEqual(before); expect(s.pawns[0].dirtCarry).toBe(carry);
    command(s, { type: 'move', pawnId: id, target: pos(14, 11) });
    until(s, () => at(s.pawns[0]) === at(pos(14, 11)));
    expect(s.filth.filter(f => f.kind === 'dirt')).toHaveLength(SANITATION_RULES.dirtCarry);
  });
  it('thickness extends work without multiplying room cleanliness per existing stain', () => {
    const s = fixture(), f = { ...pos(14), id: s.nextId++, kind: 'blood' as const, amount: 1, createdTick: 0 };
    s.filth.push(f); const one = s.cleanlinessAt(f); f.amount = 7;
    expect(s.cleanlinessAt(f)).toBe(one);
    s.filth.push({ ...f, ...pos(15), id: s.nextId++, amount: 1 });
    expect(s.cleanlinessAt(f)).toBeLessThan(one);
  });
  it('a full floor refuses a manual clean without losing current travel, cargo or target', () => {
    const s = fixture(s => fill(s)), p = s.pawns[0];
    const f = { ...pos(15), id: s.nextId++, kind: 'blood' as const, amount: 1, createdTick: 0 };
    s.filth.push(f); p.cargo = freshBatch('steel', 1);
    command(s, { type: 'move', pawnId: p.id, target: pos(16, 13) });
    command(s, { type: 'homeArea', from: f, enabled: true });
    const prior = structuredClone(p), nextId = s.nextId;
    expect(s.command({ type: 'clean', pawnId: p.id, filthId: f.id }).ok).toBe(false);
    expect(p).toEqual(prior); expect(s.nextId).toBe(nextId);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('retains a cooked result through blocked placement, changed cook and reload, then produces once', () => {
    let s = fixture(s => {
      const stove = { ...pos(14), id: s.nextId++, target: 1, paused: false };
      s.stoves.push(stove); fill(s, [stove]);
      command(s, { type: 'bill', stoveId: stove.id, target: 1, paused: false });
      const job = s.jobs.find(j => j.kind === 'cook')!;
      // The fixture supplies a prepared batch, including its frozen v40 policy.
      job.productionPolicy = defaultProductionPolicy();
      job.delivered = { wood: 1, grain: 10 }; job.deliveredBatches = [freshBatch('wood', 1), freshBatch('grain', 10)];
      job.progress = job.work - 1; s.pawns[0].priorities.cook = 1;
    });
    until(s, () => s.jobs.some(j => j.kind === 'cook' && !!j.cookingOutcome));
    const jobId = s.jobs[0].id, outcome = structuredClone(s.jobs[0].cookingOutcome!);
    expect(s.stats.produced.meal).toBe(0); expect(s.stats.consumed.grain).toBe(0);
    const bad = s.save(); bad.jobs[0].cookingOutcome!.roll = .123;
    expect(() => VoxelSimulation.load(bad)).toThrow();
    s = VoxelSimulation.load(s.save());
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'cook', value: 0 });
    command(s, { type: 'priority', pawnId: s.pawns[1].id, work: 'cook', value: 1 });
    s.step(40); expect(s.jobs.find(j => j.id === jobId)?.cookingOutcome).toEqual(outcome);
    s.items = s.items.filter(i => at(i) !== at(pos(13)));
    until(s, () => s.stats.produced.meal === 1);
    expect(s.items.find(i => i.resource === 'meal')?.poisonChance).toBe(outcome.poisonChance);
    expect(s.stats.consumed.grain).toBe(10); expect(s.jobs.some(j => j.id === jobId)).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('consumes a carried contaminated meal without dropping a duplicate or losing concentration', () => {
    let s = fixture(), id = s.pawns[0].id;
    s.pawns[0].cargo = { ...freshBatch('meal', 2), poisonChance: 1 }; s.pawns[0].food = 10;
    s = VoxelSimulation.load(s.save()); until(s, () => s.pawns[0].foodPoisoning !== null);
    expect(s.stats.consumed.meal).toBe(1); expect(s.counts().meal).toBe(1);
    expect(s.pawns.find(p => p.id === id)!.cargo?.poisonChance).toBe(1);
    expect(s.pawns.find(p => p.id === id)!.cargo?.amount).toBe(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('a prisoner physically eats a poisoned meal from the prison room and preserves illness on load', () => {
    let prisonerId = 0;
    let s = fixture(s => {
      prisonerId = s.nextId++;
      const bed = { ...pos(15, 13), id: s.nextId++, axis: 'x' as const, quality: 2 as const, medical: false, prisoner: true, owner: prisonerId };
      s.beds.push(bed);
      s.pawns.push({ ...structuredClone(s.pawns[0]), ...initialSurvival(s.seed, prisonerId), ...pos(12, 13),
        id: prisonerId, name: '测试囚犯', worn: [], faction: 'prisoner', prisoner: initialPrisoner(0, bed.id), phase: 'prisoner', food: 10 });
      s.items.push({ ...pos(14, 11), id: s.nextId++, ...freshBatch('meal', 1), poisonChance: 1 });
    });
    const q = s.pawns.find(p => p.id === prisonerId)!;
    until(s, () => q.foodPoisoning !== null);
    expect(at(q)).toBe(at(pos(14, 11))); expect(s.stats.consumed.meal).toBe(1);
    expect(s.pawns.filter(p => p.foodPoisoning)).toHaveLength(1);
    s = VoxelSimulation.load(s.save()); expect(s.pawns.find(p => p.id === prisonerId)!.foodPoisoning).toEqual(q.foodPoisoning);
  });
});
