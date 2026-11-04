import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { at, Block, index, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { freshBatch } from '../src/voxel/preservation';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, value: VoxelCommand) {
  const result = s.command(value); expect(result.ok, result.message).toBe(true); return result;
}
function until(s: VoxelSimulation, done: () => boolean, max = 3000) {
  for (let tick = 0; tick < max && !done(); tick++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, jobs: s.jobs, items: s.items,
    pawns: s.pawns.map(p => ({ id: p.id, jobId: p.jobId, reason: p.reason, cargo: p.cargo })) })).toBe(true);
}
/** Controlled starting geometry/inventory; area edits, transport, wrapping,
 * production interruption, persistence and continuation use the real simulator. */
function fixture() {
  let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.trees = []; s.grass = []; s.items = []; s.stockpiles = []; s.jobs = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 24; x++) for (let y = 10; y <= 24; y++)
    for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11, 11);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(11, 11 + i)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
    for (const work of Object.keys(p.priorities)) p.priorities[work as keyof Pawn['priorities']] = 0;
    p.skills.crafting.level = 10;
  }
  s = VoxelSimulation.load(s.save());
  command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
  command(s, { type: 'designate', tool: 'craftingSpot', from: pos(16) });
  const benchId = s.weaponBenches[0].id;
  for (const bill of s.snapshot().productionQueues.find(q => q.benchId === benchId)!.bills)
    command(s, { type: 'productionBillDelete', benchId, billId: bill.id });
  command(s, { type: 'productionBillAdd', benchId, recipe: 'smith:woodClub' });
  const billId = s.productionQueues.find(q => q.benchId === benchId)!.bills[0].id;
  s.items.push({ id: s.nextId++, ...pos(12), ...freshBatch('wood', 40) });
  // Occupying the crafting spot's ground slot makes the real wrapper placement
  // choose a neighboring cell, independently editable from the workbench target.
  s.items.push({ id: s.nextId++, ...pos(16), resource: 'chunk', amount: 1 });
  const creatorId = s.pawns[0].id;
  const areaId = command(s, { type: 'allowedAreaCreate', name: '生产区' }).areaId!;
  command(s, { type: 'allowedAreaPaint', areaId, from: pos(10, 10), to: pos(24, 24), erase: false });
  command(s, { type: 'pawnAreaAssign', pawnId: creatorId, areaId });
  command(s, { type: 'priority', pawnId: creatorId, work: 'craft', value: 1 });
  return { s, benchId, billId, creatorId, areaId };
}

describe('allowed areas during actual unfinished production', () => {
  it.each(['running', 'reloaded'] as const)('preserves an excluded piece and lets its author resume after expansion (%s)', recovery => {
    let { s, benchId, billId, creatorId, areaId } = fixture();
    until(s, () => s.items.some(i => (i.unfinished?.progress ?? 0) > 20));
    const item = s.items.find(i => i.unfinished)!, original = structuredClone(item.unfinished!);
    const itemCell = { x: item.x, y: item.y, z: item.z };
    const bench = s.weaponBenches.find(b => b.id === benchId)!;
    expect(at(item)).not.toBe(at(bench));
    expect(original.creatorId).toBe(creatorId);
    expect(original.ingredients).toMatchObject([{ resource: 'wood', amount: 40 }]);

    command(s, { type: 'allowedAreaPaint', areaId, from: itemCell, erase: true });
    const creator = s.pawns.find(p => p.id === creatorId)!;
    expect(s.pawnAllowed(creator, bench)).toBe(true);
    expect(s.pawnAllowed(creator, itemCell)).toBe(false);
    expect(creator.jobId).toBeNull();
    expect(s.jobs.find(j => j.billId === billId)?.owner).toBeNull();
    // Another eligible, unrestricted worker cannot take over this author's piece.
    command(s, { type: 'priority', pawnId: s.pawns[1].id, work: 'craft', value: 1 });
    if (recovery === 'reloaded') s = VoxelSimulation.load(s.save());
    s.step(100);
    expect(s.items.find(i => i.unfinished?.id === original.id)?.unfinished).toEqual(original);
    expect(s.pawns.every(p => p.cargo?.unfinished?.id !== original.id)).toBe(true);
    expect(s.counts().wood).toBe(40); expect(s.stats.consumed.wood).toBe(0);
    expect(s.stats.weaponsMade).toBe(0); expect(s.stats.produced.unfinished).toBe(1);

    command(s, { type: 'allowedAreaPaint', areaId, from: itemCell, erase: false });
    until(s, () => (s.items.find(i => i.unfinished?.id === original.id)?.unfinished?.progress ?? 0) > original.progress);
    const resumed = s.items.find(i => i.unfinished?.id === original.id)!.unfinished!;
    expect(resumed.creatorId).toBe(creatorId); expect(resumed.ingredients).toEqual(original.ingredients);
    expect(s.jobs.find(j => j.unfinishedId === original.id)?.owner).toBe(creatorId);
    until(s, () => s.stats.weaponsMade === 1);
    expect(s.items.some(i => i.unfinished?.id === original.id)).toBe(false);
    expect(s.stats.produced.unfinished).toBe(1); expect(s.stats.consumed.unfinished).toBe(1);
    expect(s.counts().wood).toBe(0); expect(s.stats.consumed.wood).toBe(40);
    expect(s.productionQueues.find(q => q.benchId === benchId)!.bills.find(b => b.id === billId)!.remaining).toBe(0);
  });
});
