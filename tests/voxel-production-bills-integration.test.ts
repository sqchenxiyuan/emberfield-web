import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, index, type Pawn, type Pos, type Resource, type VoxelCommand } from '../src/voxel/types';
import { freshBatch } from '../src/voxel/preservation';
import { initialResearch } from '../src/voxel/research';
import { type ProductionBill, type ProductionRecipe } from '../src/voxel/productionBills';

const pos = (x: number, y = 16): Pos => ({ x, y, z: 8 });
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
function command(s: VoxelSimulation, value: VoxelCommand) {
  const result = s.command(value); expect(result.ok, result.message).toBe(true);
}
/** Explicit geometry/material fixtures isolate bill lifecycle and transactions.
 * Crafting, hauling and completion still run through ordinary commands/ticks. */
function fixture(kind: 'craftingSpot' | 'stove' = 'craftingSpot') {
  let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.research = initialResearch(true);
  s.animals = []; s.trees = []; s.items = []; s.stockpiles = []; s.jobs = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 24; x++) for (let y = 10; y <= 24; y++)
    for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
    for (const work of Object.keys(p.priorities)) p.priorities[work as keyof Pawn['priorities']] = 0;
    p.skills.crafting.level = 10; p.skills.cooking.level = 10;
  });
  if (kind === 'stove') s.stoves.push({ id: s.nextId++, ...pos(16), target: 0, paused: false });
  s = VoxelSimulation.load(s.save());
  command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
  if (kind === 'craftingSpot') command(s, { type: 'designate', tool: 'craftingSpot', from: pos(16) });
  const benchId = kind === 'stove' ? s.stoves[0].id : s.weaponBenches[0].id;
  for (const bill of s.snapshot().productionQueues.find(queue => queue.benchId === benchId)!.bills)
    command(s, { type: 'productionBillDelete', benchId, billId: bill.id });
  return { s, benchId };
}
function material(s: VoxelSimulation, resource: Resource, amount: number, p = pos(12)) {
  const item = { id: s.nextId++, ...p, ...freshBatch(resource, amount) };
  s.items.push(item); return item;
}
function add(s: VoxelSimulation, benchId: number, recipe: ProductionRecipe, patch: Partial<ProductionBill> = {}) {
  const old = new Set(s.productionQueues.find(queue => queue.benchId === benchId)?.bills.map(bill => bill.id));
  command(s, { type: 'productionBillAdd', benchId, recipe });
  const bill = s.productionQueues.find(queue => queue.benchId === benchId)!.bills.find(value => !old.has(value.id))!;
  if (Object.keys(patch).length) command(s, { type: 'productionBillUpdate', benchId, billId: bill.id, patch });
  return bill.id;
}
const getBill = (s: VoxelSimulation, id: string) => s.productionQueues.flatMap(queue => queue.bills).find(bill => bill.id === id)!;
function until(s: VoxelSimulation, done: () => boolean, max = 4000) {
  for (let n = 0; n < max && !done(); n++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, queues: s.productionQueues, jobs: s.jobs, pawns: s.pawns.map(p => p.reason) })).toBe(true);
}
function working(s: VoxelSimulation, id: string) {
  return s.jobs.find(job => job.billId === id && job.progress > 20 && !job.cancelled);
}
function fillOutput(s: VoxelSimulation) {
  for (let x = 10; x <= 24; x++) for (let y = 10; y <= 24; y++)
    if (s.standable(pos(x, y)) && !s.items.some(item => same(item, pos(x, y)))) material(s, 'steel', 75, pos(x, y));
}
function freeOutput(s: VoxelSimulation) {
  command(s, { type: 'draft', pawnId: s.pawns[2].id, drafted: true });
  const item = s.items.find(value => same(value, pos(17, 17)))!;
  expect(item.resource).toBe('steel');
  s.pawns[2].cargo = { resource: 'steel', amount: item.amount };
  s.items = s.items.filter(value => value.id !== item.id);
}

describe('production bill command and physical lifecycle integration', () => {
  it('executes separate identical count bills, decrements after output and retains exhausted bills through reload', () => {
    let { s, benchId } = fixture();
    material(s, 'wood', 40); material(s, 'wood', 40, pos(12, 17));
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'craft', value: 1 });
    const first = add(s, benchId, 'smith:woodClub'), second = add(s, benchId, 'smith:woodClub');
    expect(first).not.toBe(second);
    until(s, () => !!working(s, first));
    expect(getBill(s, first).remaining).toBe(1);
    const work = structuredClone(s.jobs.find(job => job.billId === first)!);
    s = VoxelSimulation.load(s.save());
    expect(s.jobs.find(job => job.id === work.id)).toMatchObject({ billId: first, progress: work.progress, delivered: work.delivered });
    until(s, () => s.stats.weaponsMade === 2);
    expect([getBill(s, first).remaining, getBill(s, second).remaining]).toEqual([0, 0]);
    expect(s.productionQueues.find(queue => queue.benchId === benchId)!.bills.map(bill => bill.id)).toEqual([first, second]);
    expect(s.stats.consumed.wood).toBe(80); expect(s.counts().weapon).toBe(2); expect(s.counts().wood).toBe(0);
    s.step(100); expect(s.stats.weaponsMade).toBe(2);
    expect(VoxelSimulation.load(s.save()).productionQueues).toEqual(s.productionQueues);
  });

  it('skips a missing-material first bill and later comes back without consuming its count', () => {
    const { s, benchId } = fixture();
    material(s, 'wood', 40);
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'craft', value: 1 });
    const knife = add(s, benchId, 'smith:steelKnife'), club = add(s, benchId, 'smith:woodClub');
    until(s, () => s.stats.weaponsMade === 1);
    expect(s.items.some(item => item.weapon?.kind === 'woodClub')).toBe(true);
    expect(getBill(s, knife).remaining).toBe(1); expect(getBill(s, club).remaining).toBe(0);
    expect(s.stats.consumed.steel).toBe(0);
    material(s, 'steel', 30, pos(12, 17));
    until(s, () => s.stats.weaponsMade === 2);
    expect(getBill(s, knife).remaining).toBe(0); expect(s.stats.consumed.steel).toBe(30);
  });

  it('skips an unqualified recipe without reserving its wood against the feasible later recipe', () => {
    const { s, benchId } = fixture();
    s.pawns[0].skills.crafting.level = 0; material(s, 'wood', 40);
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'craft', value: 1 });
    const bow = add(s, benchId, 'smith:shortBow'), club = add(s, benchId, 'smith:woodClub');
    until(s, () => s.stats.weaponsMade === 1);
    expect(getBill(s, bow).remaining).toBe(1); expect(getBill(s, club).remaining).toBe(0);
    expect(s.stats.consumed.wood).toBe(40); expect(s.items.some(item => item.weapon?.kind === 'woodClub')).toBe(true);
  });

  it('lets one of two benches use the only complete batch instead of mutually reserving all materials', () => {
    const { s, benchId } = fixture();
    command(s, { type: 'designate', tool: 'craftingSpot', from: pos(20) });
    const secondBench = s.weaponBenches.find(bench => bench.id !== benchId)!.id;
    for (const value of s.snapshot().productionQueues.find(queue => queue.benchId === secondBench)!.bills)
      command(s, { type: 'productionBillDelete', benchId: secondBench, billId: value.id });
    material(s, 'wood', 40);
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'craft', value: 1 });
    const first = add(s, benchId, 'smith:woodClub'), second = add(s, secondBench, 'smith:woodClub');
    until(s, () => s.stats.weaponsMade === 1);
    expect(getBill(s, first).remaining + getBill(s, second).remaining).toBe(1);
    expect(s.stats.consumed.wood).toBe(40); expect(s.counts().wood).toBe(0);
    s.step(60); expect(s.stats.weaponsMade).toBe(1);
    material(s, 'wood', 40, pos(12, 17));
    until(s, () => s.stats.weaponsMade === 2);
    expect([getBill(s, first).remaining, getBill(s, second).remaining]).toEqual([0, 0]);
    expect(s.stats.consumed.wood).toBe(80); expect(s.counts().wood).toBe(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('skips a first recipe whose ingredients exist only in a sealed room', () => {
    let { s, benchId } = fixture();
    // Separate walkable floor pocket beyond the main room's x=24 boundary.
    // Solid cells x=25..27 isolate only the steel; the colony's routes stay intact.
    for (let x = 28; x <= 30; x++) for (let y = 15; y <= 17; y++)
      for (let z = 8; z <= 9; z++) s.blocks[index(x, y, z)] = Block.Air;
    material(s, 'steel', 30, pos(29)); material(s, 'wood', 40);
    s = VoxelSimulation.load(s.save());
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'craft', value: 1 });
    const knife = add(s, benchId, 'smith:steelKnife'), club = add(s, benchId, 'smith:woodClub');
    until(s, () => s.stats.weaponsMade === 1);
    expect(s.items.some(item => item.weapon?.kind === 'woodClub')).toBe(true);
    expect(s.items.some(item => item.weapon?.kind === 'steelKnife')).toBe(false);
    expect(getBill(s, knife).remaining).toBe(1); expect(getBill(s, club).remaining).toBe(0);
    expect(s.stats.consumed.wood).toBe(40); expect(s.stats.consumed.steel).toBe(0);
    expect(s.counts().steel).toBe(30);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('returns partially worked inputs on suspension, resumes without losing an iteration, and deletes with a refund', () => {
    let { s, benchId } = fixture();
    material(s, 'wood', 40);
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'craft', value: 1 });
    const id = add(s, benchId, 'smith:woodClub');
    until(s, () => !!working(s, id));
    command(s, { type: 'productionBillUpdate', benchId, billId: id, patch: { suspended: true } });
    until(s, () => !s.jobs.some(job => job.billId === id));
    expect(getBill(s, id)).toMatchObject({ remaining: 1, suspended: true });
    expect(s.counts().wood).toBe(40); expect(s.stats.consumed.wood).toBe(0); expect(s.stats.weaponsMade).toBe(0);
    s = VoxelSimulation.load(s.save());
    command(s, { type: 'productionBillUpdate', benchId, billId: id, patch: { suspended: false } });
    until(s, () => s.stats.weaponsMade === 1);
    expect(getBill(s, id).remaining).toBe(0);
    material(s, 'wood', 40);
    const removed = add(s, benchId, 'smith:woodClub');
    until(s, () => !!working(s, removed));
    command(s, { type: 'productionBillDelete', benchId, billId: removed });
    until(s, () => !s.jobs.some(job => job.billId === removed));
    expect(getBill(s, removed)).toBeUndefined(); expect(s.counts().wood).toBe(40);
    expect(s.stats.consumed.wood).toBe(40); expect(s.stats.weaponsMade).toBe(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('keeps an in-progress meal when its inventory target is lowered to zero', () => {
    let { s, benchId } = fixture('stove');
    material(s, 'grain', 30); material(s, 'wood', 3, pos(12, 17));
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'cook', value: 1 });
    const id = add(s, benchId, 'cook', { mode: 'target', target: 5, resumeBelow: 1 });
    until(s, () => !!working(s, id));
    const current = structuredClone(s.jobs.find(job => job.billId === id)!);
    command(s, { type: 'productionBillUpdate', benchId, billId: id, patch: { target: 0, resumeBelow: 0 } });
    expect(s.jobs.find(job => job.id === current.id)).toMatchObject({ progress: current.progress, delivered: current.delivered, cancelled: false });
    s = VoxelSimulation.load(s.save());
    until(s, () => s.stats.cooked === 1);
    s.step(100);
    expect(s.stats.cooked).toBe(1); expect(s.jobs.some(job => job.billId === id)).toBe(false);
    expect(s.stats.consumed.grain).toBe(10); expect(s.stats.consumed.wood).toBe(1);
  });

  it('reorders the next bills while preserving the identity, inputs and progress of current work', () => {
    const { s, benchId } = fixture();
    material(s, 'wood', 40); material(s, 'steel', 30, pos(12, 17));
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'craft', value: 1 });
    const first = add(s, benchId, 'smith:woodClub'), second = add(s, benchId, 'smith:steelKnife');
    until(s, () => !!working(s, first));
    const current = structuredClone(s.jobs.find(job => job.billId === first)!);
    command(s, { type: 'productionBillMove', benchId, billId: second, direction: -1 });
    expect(s.productionQueues.find(queue => queue.benchId === benchId)!.bills.map(bill => bill.id)).toEqual([second, first]);
    expect(s.jobs.find(job => job.id === current.id)).toMatchObject({ billId: first, progress: current.progress, delivered: current.delivered });
    until(s, () => s.stats.weaponsMade === 1);
    expect(getBill(s, first).remaining).toBe(0); expect(getBill(s, second).remaining).toBe(1);
    until(s, () => s.stats.weaponsMade === 2);
    expect(getBill(s, second).remaining).toBe(0);
  });

  it('persists the automatic waiting latch and resumes at the inclusive threshold', () => {
    let { s, benchId } = fixture('stove');
    const foodId = material(s, 'meal', 5).id;
    material(s, 'grain', 10, pos(12, 17)); material(s, 'wood', 1, pos(12, 18));
    const id = add(s, benchId, 'cook', { mode: 'target', target: 5, resumeBelow: 2, pauseWhenSatisfied: true, suspended: true });
    command(s, { type: 'productionBillUpdate', benchId, billId: id, patch: { suspended: false } });
    expect(getBill(s, id).waiting).toBe(true);
    s = VoxelSimulation.load(s.save());
    expect(getBill(s, id).waiting).toBe(true);
    // Controlled consumption probes the exact threshold without waiting for hunger.
    s.items.find(item => item.id === foodId)!.amount = 3; s.stats.consumed.meal += 2;
    s.step(20);
    expect(getBill(s, id).waiting).toBe(true); expect(s.jobs.some(job => job.billId === id)).toBe(false);
    s.items.find(item => item.id === foodId)!.amount = 2; s.stats.consumed.meal++;
    s.step(20);
    expect(getBill(s, id).waiting).toBe(false); expect(s.jobs.some(job => job.billId === id)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('counts pending output across benches without treating unfinished meals as satisfied inventory', () => {
    let { s, benchId } = fixture('stove');
    const secondBench = s.nextId++;
    s.stoves.push({ id: secondBench, ...pos(19), target: 0, paused: false });
    s = VoxelSimulation.load(s.save());
    for (const value of s.snapshot().productionQueues.find(queue => queue.benchId === secondBench)!.bills)
      command(s, { type: 'productionBillDelete', benchId: secondBench, billId: value.id });
    material(s, 'grain', 20); material(s, 'wood', 2, pos(12, 17));
    const patch = { mode: 'target' as const, target: 1, resumeBelow: 0, pauseWhenSatisfied: true, suspended: true };
    const first = add(s, benchId, 'cook', patch), second = add(s, secondBench, 'cook', patch);
    command(s, { type: 'productionBillUpdate', benchId, billId: first, patch: { suspended: false } });
    command(s, { type: 'productionBillUpdate', benchId: secondBench, billId: second, patch: { suspended: false } });
    expect(s.jobs.filter(job => job.kind === 'cook' && !job.cancelled)).toHaveLength(1);
    expect(s.counts().meal).toBe(0);
    expect(getBill(s, first).waiting).toBe(false); expect(getBill(s, second).waiting).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it.each(['finish', 'delete'] as const)('never consumes a count during output congestion, then handles %s exactly once', action => {
    let { s, benchId } = fixture();
    material(s, 'wood', 40);
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'craft', value: 1 });
    const id = add(s, benchId, 'smith:woodClub');
    until(s, () => !!working(s, id)); fillOutput(s);
    until(s, () => s.jobs.some(job => job.billId === id && job.progress === job.work));
    expect(getBill(s, id).remaining).toBe(1); expect(s.stats.weaponsMade).toBe(0); expect(s.stats.consumed.wood).toBe(0);
    const work = structuredClone(s.jobs.find(job => job.billId === id)!);
    s = VoxelSimulation.load(s.save());
    s.step(80);
    expect(getBill(s, id).remaining).toBe(1); expect(s.jobs.find(job => job.id === work.id)?.progress).toBe(work.work);
    if (action === 'delete') {
      command(s, { type: 'productionBillDelete', benchId, billId: id });
      expect(getBill(s, id)).toBeUndefined();
      expect(s.jobs.find(job => job.id === work.id)).toMatchObject({ cancelled: true, delivered: { wood: 40 } });
      expect(s.counts().wood).toBe(40); expect(s.stats.weaponsMade).toBe(0);
      s = VoxelSimulation.load(s.save());
    }
    freeOutput(s);
    until(s, () => !s.jobs.some(job => job.id === work.id));
    if (action === 'finish') {
      expect(getBill(s, id).remaining).toBe(0); expect(s.stats.weaponsMade).toBe(1);
      expect(s.stats.consumed.wood).toBe(40); expect(s.counts().wood).toBe(0);
    } else {
      expect(s.stats.weaponsMade).toBe(0); expect(s.stats.consumed.wood).toBe(0); expect(s.counts().wood).toBe(40);
    }
    s.step(60); expect(s.stats.weaponsMade).toBe(action === 'finish' ? 1 : 0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('prevents both the new and legacy SDK from growing a queue beyond the save limit', () => {
    const { s, benchId } = fixture();
    for (let i = 0; i < 32; i++) add(s, benchId, 'smith:woodClub', { suspended: true });
    const before = s.save();
    expect(s.command({ type: 'productionBillAdd', benchId, recipe: 'smith:woodClub' }).ok).toBe(false);
    expect(s.command({ type: 'weaponBill', benchId, kind: 'steelKnife', target: 1, paused: false }).ok).toBe(false);
    expect(s.productionQueues).toEqual(before.productionQueues); expect(s.nextId).toBe(before.nextId);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('rejects current-save identity corruption and bill identities on non-production jobs', () => {
    const { s, benchId } = fixture();
    const id = add(s, benchId, 'smith:woodClub', { suspended: true });
    command(s, { type: 'designate', tool: 'mine', from: pos(9, 12) });
    const mining = s.jobs.find(job => job.kind === 'mine')!;
    expect(mining).toBeDefined(); expect(Object.hasOwn(mining, 'billId')).toBe(false);
    const wrongJob = s.save(); wrongJob.jobs.find(job => job.id === mining.id)!.billId = id;
    expect(() => VoxelSimulation.load(wrongJob)).toThrow();
    const collision = s.save(); collision.productionQueues[0].bills[0].id = `bill:${s.pawns[0].id}`;
    expect(() => VoxelSimulation.load(collision)).toThrow();
    const missing = s.save() as any; delete missing.productionQueues;
    expect(() => VoxelSimulation.load(missing)).toThrow();
    const oldSpoof = s.save() as any; oldSpoof.version = 38;
    expect(() => VoxelSimulation.load(oldSpoof)).toThrow();
  });

  it('migrates authentic v38 bytes without adding products, changing bills or inventing a current queue', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v38-before-production-bills.json', import.meta.url));
    const provenance = JSON.parse(readFileSync(new URL('./fixtures/voxel-v38-before-production-bills.provenance.json', import.meta.url), 'utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
    const old = JSON.parse(bytes.toString()), s = VoxelSimulation.load(old), current = s.save();
    expect(old.version).toBe(38); expect(current.version).toBe(40); expect(current.productionQueues).toEqual([]);
    for (const field of ['items', 'jobs', 'stoves', 'stonecutters', 'tailors', 'weaponBenches', 'butcherSpots', 'stats', 'nextId', 'blocks'] as const)
      expect(current[field], field).toEqual(old[field]);
    // The existing v38 loader also resets these two derived movement/UI fields.
    // Keep every other pawn field (identity, needs, skills, cargo, work and path)
    // equal to the authentic bytes rather than ignoring all pawn differences.
    expect(current.pawns).toEqual(old.pawns.map((pawn: Pawn) => ({
      ...pawn, moveTick: old.tick, reason: '存档已恢复，正在重新安排工作',
    })));
    expect(VoxelSimulation.load(current).save()).toEqual(current);
  });
});
