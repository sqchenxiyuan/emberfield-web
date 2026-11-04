import { stripAutoSlaughterFields } from './legacy-auto-rebuild-defaults';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Job, type Pawn, type Pos, type Resource, type VoxelCommand } from '../src/voxel/types';
import { constructionFailureChance, constructionSuccessChance, constructionSalvage, isFailableConstruction } from '../src/voxel/construction';
import { freshBatch } from '../src/voxel/preservation';
import { initialSkills } from '../src/voxel/skills';
import { defaultShelfSettings, SHELF_DEFS } from '../src/voxel/shelves';
import { fireDamageKey, FIRE_MAX_HP } from '../src/voxel/fire';
import { furnitureStats } from '../src/voxel/furniture';
import { frameDamageTarget, fireFuelAt, igniteFire } from '../src/voxel/fireWorld';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c); expect(r.ok, JSON.stringify({ c, r })).toBe(true); return r;
}
/** Deliberately controlled geometry, skill and supplies isolate construction
 * transitions. The retained v46 fixture separately uses an unedited generated
 * world. All work and failures here advance through normal simulation ticks. */
function fixture(seed = 73122, level = 0) {
  const s = new VoxelSimulation(seed, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.grass = []; s.trees = []; s.items = []; s.stockpiles = []; s.homeArea.clear();
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 30; x++) for (let y = 12; y <= 23; y++)
    for (let z = 8; z <= 10; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(12, 16 + i)); p.food = 95; p.rest = 95; p.schedule.fill('work');
    for (const work of Object.keys(p.priorities)) p.priorities[work as keyof Pawn['priorities']] = 0;
    p.skills.construction.level = level;
  }
  command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
  return VoxelSimulation.load(s.save());
}
function item(s: VoxelSimulation, resource: Resource, amount: number, point = pos(14), hitPoints?: number) {
  const value = { ...point, ...freshBatch(resource, amount), ...(hitPoints === undefined ? {} : { hitPoints }), id: s.nextId++ };
  s.items.push(value); return value;
}
function enableBuild(s: VoxelSimulation) { command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'build', value: 1 }); }
function until(s: VoxelSimulation, done: () => boolean, limit = 2000, audit?: () => void) {
  for (let n = 0; n < limit && !done(); n++) { s.step(); audit?.(); }
  expect(done(), JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns.map(p => ({ phase: p.phase, reason: p.reason, cargo: p.cargo })) })).toBe(true);
}
function wood(s: VoxelSimulation) {
  const physical = s.items.filter(i => i.resource === 'wood').reduce((a, i) => a + i.amount, 0)
    + s.pawns.reduce((a, p) => a + (p.cargo?.resource === 'wood' ? p.cargo.amount : 0), 0)
    + s.jobs.reduce((a, j) => a + (j.delivered.wood ?? 0), 0);
  expect(s.counts().wood).toBe(physical);
  return physical + s.stats.consumed.wood + s.stats.destroyed.wood + s.stats.spoiled.wood - s.stats.produced.wood;
}
function plan(s: VoxelSimulation, kind: 'chair' | 'smallShelf' = 'chair', target = pos(18)) {
  command(s, { type: 'designate', tool: kind, from: target, axis: 'y' });
  return s.jobs.find(j => j.kind === kind && at(j) === at(target))!;
}
function fillFloor(s: VoxelSimulation) {
  for (let x = 10; x <= 30; x++) for (let y = 12; y <= 23; y++) item(s, 'stone', 75, pos(x, y));
}

describe('construction failure probability and eligibility', () => {
  it('converts total success into work-proportional hazard without a fixed per-tick failure rate', () => {
    const rate = constructionFailureChance(.64, 1, 100);
    expect(Math.pow(1 - rate, 100)).toBeCloseTo(.64, 12);
    expect(constructionFailureChance(.64, 2, 100)).toBeCloseTo(1 - Math.pow(1 - rate, 2), 12);
    expect(constructionFailureChance(.64, 1, 200)).toBeLessThan(rate);
    expect(constructionFailureChance(1, 5, 100)).toBe(0);
    expect(constructionFailureChance(.64, 0, 100)).toBe(0);
  });
  it('lets skill, manipulation and sight affect construction success with bounded odds', () => {
    const low = initialSkills(0), high = initialSkills(0); low.construction.level = 0; high.construction.level = 8;
    expect(constructionSuccessChance(low)).toBeGreaterThan(0); expect(constructionSuccessChance(low)).toBeLessThan(1);
    expect(constructionSuccessChance(high)).toBe(1);
    expect(constructionSuccessChance(high, .5, 1)).toBeLessThan(constructionSuccessChance(high));
    expect(constructionSuccessChance(high, 1, .5)).toBeLessThan(constructionSuccessChance(high));
    expect(constructionSuccessChance(high, 2, 2)).toBe(1);
    expect(constructionSuccessChance(low)).toBe(.75);
    expect(constructionSuccessChance(high, .5, .5)).toBeCloseTo(.85 * .9, 12);
  });
  it('retains at least one unit of a batch and stochastically rounds half of odd batches', () => {
    expect(constructionSalvage(1, .99)).toBe(1);
    expect(constructionSalvage(15, .1)).toBe(8); expect(constructionSalvage(15, .9)).toBe(7);
    expect(constructionSalvage(16, 0)).toBe(8); expect(constructionSalvage(16, .99)).toBe(8);
  });
  it('rejects malformed capability, work and random inputs instead of creating non-finite odds or materials', () => {
    const skills = initialSkills(0);
    for (const bad of [-1, NaN, Infinity]) {
      expect(() => constructionSuccessChance(skills, bad, 1)).toThrow();
      expect(() => constructionSuccessChance(skills, 1, bad)).toThrow();
      expect(() => constructionFailureChance(bad, 1, 100)).toThrow();
      expect(() => constructionFailureChance(.75, bad, 100)).toThrow();
      expect(() => constructionFailureChance(.75, 1, bad)).toThrow();
      expect(() => constructionSalvage(15, bad)).toThrow();
    }
    expect(() => constructionFailureChance(.75, 1, 0)).toThrow();
    expect(() => constructionSalvage(0, .5)).toThrow(); expect(() => constructionSalvage(2.5, .5)).toThrow();
  });
  it('keeps terrain construction separate from fire-frame eligibility and excludes existing-object work', () => {
    const s = fixture(), base = plan(s);
    for (const kind of ['chair', 'wall', 'floor', 'bridge', 'wire', 'ladder', 'smallShelf'] as const)
      expect(isFailableConstruction({ ...base, kind }), kind).toBe(true);
    for (const kind of ['install', 'uninstall', 'remove', 'mine', 'cut', 'cook'] as const)
      expect(isFailableConstruction({ ...base, kind } as Job), kind).toBe(false);
    expect(isFailableConstruction({ ...base, cost: {} })).toBe(false);
  });
});

describe('physical construction failure and ordinary retry', () => {
  it('also fails and retries ordinary floor work even though a terrain frame has no building-frame hit points', () => {
    let s = fixture(73127); const target = pos(18), floor = pos(18, 16, 7);
    s.blocks[at(floor)] = Block.Air; s = VoxelSimulation.load(s.save()); item(s, 'wood', 3);
    command(s, { type: 'designate', tool: 'floor', from: target });
    const original = s.jobs.find(j => j.kind === 'floor')!; enableBuild(s);
    until(s, () => s.stats.destroyed.wood > 0 || s.blocks[at(floor)] === Block.Wood);
    expect(s.stats.destroyed.wood).toBeGreaterThan(0); expect(s.blocks[at(floor)]).toBe(Block.Air);
    const replacement = s.jobs.find(j => j.kind === 'floor')!;
    expect(replacement.id).not.toBe(original.id); expect(replacement).toMatchObject({ progress: 0, delivered: {} });
    expect(s.fireDamage.some(d => d.kind === 'frame')).toBe(false);
    s.pawns[0].skills.construction.level = 8; item(s, 'wood', s.stats.destroyed.wood);
    until(s, () => s.blocks[at(floor)] === Block.Wood);
    expect(s.stats.consumed.wood).toBe(3); expect(wood(s)).toBe(3 + s.stats.destroyed.wood);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('retries outside Home with automatic rebuilding disabled, retaining salvage metadata and requiring replacement materials', () => {
    const s = fixture(); item(s, 'wood', 15, pos(14), 90); const old = plan(s); enableBuild(s);
    until(s, () => s.stats.destroyed.wood > 0 || s.chairs.length > 0, 1000, () => expect(wood(s)).toBe(15));
    expect(s.stats.destroyed.wood).toBeGreaterThan(0); expect(s.chairs).toHaveLength(0);
    expect(s.homeArea.size).toBe(0); expect(s.autoRebuild).toBe(false);
    const next = s.jobs.find(j => j.kind === 'chair')!;
    expect(next.id).not.toBe(old.id); expect(next).toMatchObject({ ...pos(18), axis: 'y', progress: 0, workTicks: 0, delivered: {} });
    expect(s.stats.destroyed.wood).toBeGreaterThanOrEqual(7); expect(s.stats.destroyed.wood).toBeLessThanOrEqual(8);
    expect(s.items.filter(i => i.resource === 'wood').every(i => i.hitPoints === 90)).toBe(true);
    expect(s.stats.consumed.wood).toBe(0); expect(s.stats.produced.wood).toBe(0);
    s.pawns[0].skills.construction.level = 8;
    s.step(120); expect(s.chairs).toHaveLength(0); expect(s.jobs[0].progress).toBe(0); expect(wood(s)).toBe(15);
    const lost = s.stats.destroyed.wood; item(s, 'wood', lost);
    until(s, () => s.chairs.length === 1, 1000, () => expect(wood(s)).toBe(15 + lost));
    expect(s.stats.consumed.wood).toBe(15); expect(s.counts().wood).toBe(0);
    expect(VoxelSimulation.load(s.save()).chairs).toEqual(s.chairs);
  });

  it('keeps survivors in a failed frame on a full floor, does not reroll them after reload, then starts a fresh frame when space opens', () => {
    let s = fixture(); item(s, 'wood', 15, pos(14), 90); const original = plan(s); enableBuild(s);
    until(s, () => s.jobs[0].delivered.wood === 15);
    s.fireDamage.push({ ...frameDamageTarget(s.jobs[0]), hitPoints: 10 });
    fillFloor(s);
    until(s, () => !!s.jobs.find(j => j.id === original.id)?.constructionFailure || s.chairs.length > 0);
    const failed = s.jobs.find(j => j.id === original.id)!;
    expect(failed.constructionFailure).toBeDefined(); expect(s.chairs).toHaveLength(0);
    expect(failed.constructionFailure?.workerId).toBe(s.pawns[0].id);
    expect(failed.delivered.wood! + s.stats.destroyed.wood).toBe(15); expect(wood(s)).toBe(15);
    expect(failed.deliveredBatches.every(b => b.hitPoints === 90)).toBe(true);
    expect(s.fireDamage.some(d => d.kind === 'frame' && d.targetId === original.id)).toBe(false);
    const retained = structuredClone(failed), destroyed = s.stats.destroyed.wood;
    s = VoxelSimulation.load(s.save()); s.step(40);
    expect(s.jobs.find(j => j.id === original.id)).toMatchObject({ delivered: retained.delivered,
      deliveredBatches: retained.deliveredBatches, constructionFailure: retained.constructionFailure,
      progress: retained.progress, workTicks: retained.workTicks });
    expect(s.stats.destroyed.wood).toBe(destroyed); expect(wood(s)).toBe(15);
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'build', value: 0 });
    s.items = s.items.filter(i => !(i.resource === 'stone' && at(i) === at(original)));
    until(s, () => !s.jobs.some(j => j.id === original.id), 100);
    const replacement = s.jobs.find(j => j.kind === 'chair')!;
    expect(replacement).toMatchObject({ progress: 0, workTicks: 0, delivered: {}, deliveredBatches: [] });
    expect(replacement.constructionFailure).toBeUndefined(); expect(wood(s)).toBe(15);
    expect(s.items.filter(i => i.resource === 'wood').reduce((a, i) => a + i.amount, 0)).toBe(15 - destroyed);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('cancels a pending failed frame and refunds only survivors once, without creating a retry', () => {
    let s = fixture(); item(s, 'wood', 15); const old = plan(s); enableBuild(s);
    until(s, () => s.jobs[0].delivered.wood === 15); fillFloor(s);
    until(s, () => !!s.jobs.find(j => j.id === old.id)?.constructionFailure || s.chairs.length > 0);
    expect(s.jobs.find(j => j.id === old.id)?.constructionFailure).toBeDefined();
    const lost = s.stats.destroyed.wood;
    command(s, { type: 'designate', tool: 'cancel', from: old });
    s = VoxelSimulation.load(s.save()); s.step(30);
    expect(s.jobs.find(j => j.id === old.id)?.cancelled).toBe(true); expect(s.stats.destroyed.wood).toBe(lost);
    s.items = s.items.filter(i => !(i.resource === 'stone' && at(i) === at(old)));
    until(s, () => s.jobs.length === 0, 100); s.step(20);
    expect(s.chairs).toHaveLength(0); expect(s.counts().wood).toBe(15 - lost); expect(wood(s)).toBe(15);
    expect(s.stats.consumed.wood).toBe(0); expect(s.stats.produced.wood).toBe(0);
  });

  it('burns pending survivors as physical material, persists the separate burn loss, and never charges initial failure loss twice', () => {
    let s = fixture(); item(s, 'wood', 15); const original = plan(s); enableBuild(s);
    until(s, () => s.jobs[0].delivered.wood === 15); fillFloor(s); until(s, () => !!s.jobs[0].constructionFailure);
    const initialLoss = s.stats.destroyed.wood, initialSurvivors = s.jobs[0].delivered.wood!;
    expect(fireFuelAt(s, original).some(f => f.kind === 'constructionMaterial' && f.id === original.id && f.resource === 'wood')).toBe(true);
    expect(fireFuelAt(s, original).some(f => f.kind === 'structure' && f.damage?.kind === 'frame')).toBe(false);
    // Controlled ignition; actual fire-update ticks consume the waiting batch.
    expect(igniteFire(s, original, 'lightning')).not.toBeNull();
    until(s, () => s.stats.destroyed.wood > initialLoss, 200);
    const saved = s.save(), job = saved.jobs.find(j => j.id === original.id)!;
    expect(job.constructionFailure?.lost.wood).toBe(initialLoss);
    expect(job.constructionFailure?.burned?.wood).toBe(s.stats.destroyed.wood - initialLoss);
    expect(job.delivered.wood).toBe(initialSurvivors - job.constructionFailure!.burned!.wood!);
    s = VoxelSimulation.load(saved); expect(s.jobs[0].constructionFailure).toEqual(job.constructionFailure); expect(wood(s)).toBe(15);
    until(s, () => !s.jobs.some(j => j.id === original.id), 1000, () => expect(wood(s)).toBe(15));
    expect(s.stats.destroyed.wood).toBe(15); expect(s.stats.consumed.wood).toBe(0);
    expect(s.jobs.find(j => j.kind === 'chair')).toMatchObject({ progress: 0, delivered: {}, deliveredBatches: [] });
    expect(s.jobs.some(j => j.constructionFailure)).toBe(false); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('settles remaining material once when the failed site loses support, without leaving a suspended replacement', () => {
    const s = fixture(); item(s, 'wood', 15); const original = plan(s); enableBuild(s);
    until(s, () => s.jobs[0].delivered.wood === 15); fillFloor(s); until(s, () => !!s.jobs[0].constructionFailure);
    const floor = pos(original.x, original.y, original.z - 1);
    // Controlled support destruction isolates the transactional geometry path.
    s.blocks[at(floor)] = Block.Wood;
    s.blocks[index(floor.x, floor.y, floor.z - 1)] = Block.Air;
    s.blocks[index(floor.x, floor.y, floor.z - 2)] = Block.Air;
    const damage = { ...floor, kind: 'block' as const, targetId: null, key: fireDamageKey('block', null, floor),
      hitPoints: 1, maxHitPoints: FIRE_MAX_HP.block };
    expect(s.fireDestroy(damage, 'controlled pending construction support loss')).toBe(true);
    expect(s.jobs.some(j => j.id === original.id || j.kind === 'chair')).toBe(false);
    expect(s.stats.destroyed.wood).toBe(15); expect(s.counts().wood).toBe(0); expect(wood(s)).toBe(15);
    s.step(20); expect(s.jobs.some(j => j.kind === 'chair')).toBe(false); expect(s.stats.destroyed.wood).toBe(15);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('merges damaged source stacks through actual deliveries and preserves their weighted HP in the failed survivors', () => {
    let s = fixture(73125);
    item(s, 'wood', 1, pos(14), 90); item(s, 'wood', 1, pos(14, 17), 120); item(s, 'wood', 13, pos(14, 18), 135);
    const original = plan(s); enableBuild(s); until(s, () => s.jobs[0].delivered.wood === 15);
    expect(s.jobs[0].deliveredBatches).toHaveLength(1); expect(s.jobs[0].deliveredBatches[0].hitPoints).toBe(131);
    fillFloor(s); until(s, () => !!s.jobs.find(j => j.id === original.id)?.constructionFailure || s.jobs[0].progress >= s.jobs[0].work);
    expect(s.jobs[0].constructionFailure).toBeDefined(); expect(s.jobs[0].deliveredBatches[0].hitPoints).toBe(131);
    const saved = s.save(); s = VoxelSimulation.load(saved);
    expect(s.jobs[0].deliveredBatches).toEqual(saved.jobs[0].deliveredBatches); expect(wood(s)).toBe(15);
  });

  it('selects the same actual failed work tick and loss after a drafted pause, multiple step sizes and reload', () => {
    const base = fixture(); item(base, 'wood', 15); plan(base); enableBuild(base);
    until(base, () => base.jobs[0].workTicks >= 10); fillFloor(base);
    const a = VoxelSimulation.load(base.save()); let b = VoxelSimulation.load(base.save());
    command(b, { type: 'draft', pawnId: b.pawns[0].id, drafted: true }); b.step(23); b = VoxelSimulation.load(b.save());
    expect(b.jobs[0].workTicks).toBe(10); command(b, { type: 'draft', pawnId: b.pawns[0].id, drafted: false });
    until(a, () => !!a.jobs[0].constructionFailure);
    until(b, () => !!b.jobs[0].constructionFailure);
    expect(b.jobs[0].workTicks).toBe(a.jobs[0].workTicks); expect(b.jobs[0].progress).toBe(a.jobs[0].progress);
    expect(b.jobs[0].constructionFailure).toEqual(a.jobs[0].constructionFailure);
    expect(b.jobs[0].deliveredBatches).toEqual(a.jobs[0].deliveredBatches);
    expect(b.stats.destroyed.wood).toBe(a.stats.destroyed.wood); expect(wood(a)).toBe(15); expect(wood(b)).toBe(15);
  });

  it('rejects impossible failed-container receipts and old-version injection without mutating input', () => {
    const s = fixture(); item(s, 'wood', 15); plan(s); enableBuild(s);
    until(s, () => s.jobs[0].delivered.wood === 15); fillFloor(s); until(s, () => !!s.jobs[0].constructionFailure);
    const valid = s.save();
    const mutations: ((save: typeof valid) => void)[] = [
      save => { save.jobs[0].constructionFailure!.workerId = 0; },
      save => { save.jobs[0].owner = save.pawns[0].id; },
      save => { save.jobs[0].constructionFailure!.lost.wood!++; },
      save => { save.jobs[0].progress = save.jobs[0].work; },
      save => { save.jobs[0].workTicks = 0; },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(valid); mutate(invalid); const before = structuredClone(invalid);
      expect(() => VoxelSimulation.load(invalid)).toThrow(); expect(invalid).toEqual(before);
    }
    const old = { ...structuredClone(valid), version: 46 }; stripAutoSlaughterFields(old); expect(() => VoxelSimulation.load(old)).toThrow();
    expect(VoxelSimulation.load(valid).jobs[0].constructionFailure).toEqual(valid.jobs[0].constructionFailure);
  });

  it('preserves shelf orientation and linked effective settings through failure and retry', () => {
    let s = fixture(73120);
    const member = { ...pos(24, 20), id: s.nextId++, kind: 'smallShelf' as const, axis: 'x' as const, settings: defaultShelfSettings() };
    s.shelves.push(member); s = VoxelSimulation.load(s.save());
    const cost = SHELF_DEFS.smallShelf.cost.wood;
    item(s, 'wood', cost); const original = plan(s, 'smallShelf');
    command(s, { type: 'shelfStorage', shelfId: member.id, priority: 3, accepts: ['steel'] });
    command(s, { type: 'shelfLink', sourceId: member.id, memberIds: [original.id] }); enableBuild(s);
    until(s, () => s.stats.destroyed.wood > 0 || s.shelves.length > 1);
    expect(s.stats.destroyed.wood).toBeGreaterThan(0);
    const replacement = s.jobs.find(j => j.kind === 'smallShelf')!;
    expect(replacement.id).not.toBe(original.id); expect(replacement.axis).toBe('y');
    expect(s.storageGroups[0].memberIds).toContain(replacement.id); expect(s.storageGroups[0].memberIds).not.toContain(original.id);
    command(s, { type: 'shelfStorage', shelfId: member.id, priority: 0, accepts: ['grain'] });
    s = VoxelSimulation.load(s.save()); s.pawns[0].skills.construction.level = 8; item(s, 'wood', s.stats.destroyed.wood);
    until(s, () => s.shelves.length === 2);
    const built = s.shelves.find(value => value.id !== member.id)!;
    expect(built.axis).toBe('y'); expect(s.snapshot().storageGroups.find(g => g.memberIds.includes(built.id))?.settings)
      .toEqual({ priority: 0, accepts: ['grain'] });
    expect(wood(s)).toBe(cost + s.stats.destroyed.wood); expect(s.stats.consumed.wood).toBe(cost);
  });

  it('does not consume failure rolls or advance work while a builder is drafted, and a skilled replacement finishes the existing frame', () => {
    let s = fixture(73129, 8); item(s, 'wood', 15); const job = plan(s); enableBuild(s);
    until(s, () => s.jobs[0].workTicks >= 10);
    const progress = s.jobs[0].progress, workTicks = s.jobs[0].workTicks, batches = structuredClone(s.jobs[0].deliveredBatches);
    command(s, { type: 'draft', pawnId: s.pawns[0].id, drafted: true }); s.step(30); s = VoxelSimulation.load(s.save());
    expect(s.jobs[0]).toMatchObject({ id: job.id, progress, workTicks, deliveredBatches: batches });
    expect(s.stats.destroyed.wood).toBe(0);
    command(s, { type: 'priority', pawnId: s.pawns[1].id, work: 'build', value: 1 });
    until(s, () => s.chairs.length === 1); expect(s.stats.destroyed.wood).toBe(0); expect(wood(s)).toBe(15);
  });

  it('does not damage or reroll a relocated original even with a novice builder', () => {
    const s = fixture(), original = { ...pos(18), id: s.nextId++, quality: 4 as const, axis: 'x' as const };
    s.chairs.push(original); s.fireDamage.push({ ...original, kind: 'chair', targetId: original.id,
      key: fireDamageKey('chair', original.id, original), hitPoints: 30, maxHitPoints: furnitureStats('chair', 4).maxHitPoints });
    enableBuild(s); command(s, { type: 'installFurniture', kind: 'chair', furnitureId: original.id, target: pos(25, 20), axis: 'y' });
    until(s, () => s.chairs.some(c => c.id === original.id && c.x === 25));
    expect(s.chairs[0]).toMatchObject({ id: original.id, quality: 4, axis: 'y', ...pos(25, 20) });
    expect(s.stats.destroyed.furniture).toBe(0); expect(s.stats.destroyed.wood).toBe(0);
    expect(s.stats.consumed.wood).toBe(0); expect(s.stats.consumed.furniture).toBe(1);
    expect(s.fireDamage.find(d => d.targetId === original.id)?.hitPoints).toBe(30);
  });
});
