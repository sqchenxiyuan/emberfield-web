import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Job, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { FIRE_MAX_HP, fireDamageKey, type BurnTargetKind } from '../src/voxel/fire';
import { frameDamageTarget } from '../src/voxel/fireWorld';
import { freshBatch } from '../src/voxel/preservation';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
const wallBase = pos(18), wireSite = pos(18, 16, 9);
const ladderBase = pos(23), ladderSupport = pos(23, 16, 9), ladderSite = pos(23, 16, 10);
const remoteChairSite = pos(28, 21);
// Loading intentionally refreshes the transient scheduling explanation.
const physicalJobs = (jobs: Job[]) => jobs.map(({ reason: _reason, ...job }) => job);

function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c);
  expect(result.ok, JSON.stringify({ c, result })).toBe(true);
}
function destroy(s: VoxelSimulation, kind: BurnTargetKind, point: Pos, targetId: number | null = null) {
  expect(s.fireDestroy({ ...point, kind, targetId, key: fireDamageKey(kind, targetId, point),
    hitPoints: 1, maxHitPoints: FIRE_MAX_HP[kind] }, 'controlled frame-support destruction')).toBe(true);
}
function suppliedJob(s: VoxelSimulation, kind: 'wire' | 'ladder', point: Pos): Job {
  command(s, { type: 'designate', tool: kind, from: point });
  const job = s.jobs.find(j => j.kind === kind && at(j) === at(point))!;
  // Deliberate fixture delivery isolates the destruction transaction. This is
  // not evidence of workers reaching either site or supplying a natural build.
  const resource = kind === 'wire' ? 'steel' : 'wood', amount = job.cost[resource]!;
  job.delivered = { [resource]: amount };
  job.deliveredBatches = [freshBatch(resource, amount)];
  const damage = frameDamageTarget(job);
  damage.hitPoints = damage.maxHitPoints / 2;
  s.fireDamage.push(damage);
  return job;
}

/** Headless model fixture: explicit geometry, supplied inputs and direct
 * destruction. No native game, browser, preview or GUI interaction is used. */
function fixture(wirePoint: Pos = wireSite) {
  let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.grass = []; s.trees = []; s.items = []; s.stockpiles = []; s.homeArea.clear();
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0); s.explored.fill(1);
  for (let x = 10; x <= 30; x++) for (let y = 10; y <= 24; y++)
    for (let z = 8; z <= 14; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  for (const [n, pawn] of s.pawns.entries()) {
    Object.assign(pawn, pos(12, 16 + n)); pawn.food = 95; pawn.rest = 95; pawn.schedule.fill('work');
    for (const work of Object.keys(pawn.priorities)) pawn.priorities[work as keyof Pawn['priorities']] = 0;
  }
  // A conduit can be embedded in the upper wall voxel. Its empty replacement
  // position will have no floor after both wall voxels are destroyed.
  s.blocks[at(wallBase)] = Block.Wood; s.structureKinds[at(wallBase)] = 2;
  s.blocks[at(wireSite)] = Block.Wood; s.structureKinds[at(wireSite)] = 3;
  // The new ladder is supported by an existing ladder below, not by a block.
  s.ladders[at(ladderBase)] = 1; s.ladders[at(ladderSupport)] = 1;
  s.chairs.push({ ...remoteChairSite, id: s.nextId++, axis: 'x', quality: 2 });
  command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
  s = VoxelSimulation.load(s.save());
  const wire = suppliedJob(s, 'wire', wirePoint), ladder = suppliedJob(s, 'ladder', ladderSite);
  command(s, { type: 'autoRebuild', enabled: true });
  for (const point of [wallBase, wireSite, ladderSupport, ladderSite, remoteChairSite])
    command(s, { type: 'homeArea', from: point, enabled: true });
  return { s: VoxelSimulation.load(s.save()), wireId: wire.id, ladderId: ladder.id };
}

describe('construction frame support during destruction transactions', () => {
  it('preserves a wall conduit and ladder-supported frame when a distant chair is destroyed', () => {
    const { s, wireId, ladderId } = fixture(), ids = new Set([wireId, ladderId]);
    const before = s.save(), counts = s.counts(), chair = s.chairs[0];
    expect(s.blocks[at(wireSite)]).toBe(Block.Wood);
    expect(s.blocks[at(ladderSupport)]).toBe(Block.Air);
    expect(s.ladders[at(ladderSupport)]).toBe(1);
    destroy(s, 'chair', chair, chair.id);
    expect(s.chairs).toHaveLength(0);
    expect(s.jobs.filter(j => ids.has(j.id))).toEqual(before.jobs.filter(j => ids.has(j.id)));
    expect(s.fireDamage).toEqual(before.fireDamage);
    expect(s.counts()).toEqual(counts);
    expect(s.stats.destroyed).toEqual(before.stats.destroyed);
    expect(s.stats.consumed).toEqual(before.stats.consumed);
    expect(s.stats.produced).toEqual(before.stats.produced);
    const restored = VoxelSimulation.load(s.save());
    expect(restored.jobs.filter(j => ids.has(j.id))).toEqual(before.jobs.filter(j => ids.has(j.id)));
    expect(restored.fireDamage).toEqual(before.fireDamage);
    expect(restored.counts()).toEqual(counts);
  });

  it.each([
    { name: 'lower wall voxel', kind: 'block' as const, point: wallBase },
    { name: 'chair', kind: 'chair' as const, point: remoteChairSite },
  ])('preserves a supplied conduit when its same-cell $name is destroyed but the floor remains', ({ kind, point }) => {
    const { s, wireId, ladderId } = fixture(point), before = s.save(), counts = s.counts();
    const wire = before.jobs.find(j => j.id === wireId)!;
    expect(wire.delivered.steel).toBe(1);
    const damage = before.fireDamage.find(d => d.targetId === wireId)!;
    expect(damage.hitPoints).toBe(damage.maxHitPoints / 2);
    destroy(s, kind, point, kind === 'chair' ? s.chairs[0].id : null);
    expect(s.blocks[at(point)]).toBe(Block.Air);
    expect(s.blocks[index(point.x, point.y, point.z - 1)]).toBe(Block.Stone);
    if (kind === 'block') expect(s.blocks[at(wireSite)]).toBe(Block.Air);
    else expect(s.chairs).toHaveLength(0);
    expect(s.jobs.find(j => j.id === wireId)).toEqual(wire);
    expect(s.jobs.find(j => j.id === ladderId)).toEqual(before.jobs.find(j => j.id === ladderId));
    expect(s.fireDamage).toEqual(before.fireDamage);
    expect(s.counts()).toEqual(counts);
    expect(s.stats.destroyed).toEqual(before.stats.destroyed);
    expect(s.stats.consumed).toEqual(before.stats.consumed);
    expect(s.stats.produced).toEqual(before.stats.produced);
    const restored = VoxelSimulation.load(s.save());
    expect(restored.jobs.find(j => j.id === wireId)).toEqual(wire);
    expect(restored.fireDamage).toEqual(before.fireDamage);
    expect(restored.stats).toEqual(s.stats); expect(restored.counts()).toEqual(counts);
  });

  it('destroys only the supplied conduit whose supporting wall disappeared, without a suspended replacement', () => {
    const { s, wireId, ladderId } = fixture(), before = s.save(), counts = s.counts();
    const wire = before.jobs.find(j => j.id === wireId)!;
    destroy(s, 'block', wireSite);
    expect(s.blocks[at(wallBase)]).toBe(Block.Air); expect(s.blocks[at(wireSite)]).toBe(Block.Air);
    expect(s.jobs.some(j => j.id === wireId || (j.kind === 'wire' && at(j) === at(wireSite)))).toBe(false);
    expect(s.jobs.find(j => j.id === ladderId)).toEqual(before.jobs.find(j => j.id === ladderId));
    expect(s.fireDamage).toEqual(before.fireDamage.filter(d => d.targetId !== wireId));
    expect(s.counts()).toEqual({ ...counts, steel: counts.steel - wire.delivered.steel! });
    expect(s.stats.destroyed).toEqual({ ...before.stats.destroyed,
      steel: before.stats.destroyed.steel + wire.delivered.steel! });
    expect(s.stats.consumed).toEqual(before.stats.consumed); expect(s.stats.produced).toEqual(before.stats.produced);
    const restored = VoxelSimulation.load(s.save());
    expect(physicalJobs(restored.jobs)).toEqual(physicalJobs(s.jobs));
    expect(restored.stats).toEqual(s.stats); expect(restored.counts()).toEqual(s.counts());
  });

  it('destroys only the supplied upper ladder whose connecting segment disappeared, without a suspended replacement', () => {
    const { s, wireId, ladderId } = fixture(), before = s.save(), counts = s.counts();
    const ladder = before.jobs.find(j => j.id === ladderId)!;
    destroy(s, 'ladder', ladderSupport);
    expect(s.ladders[at(ladderSupport)]).toBe(0); expect(s.ladders[at(ladderBase)]).toBe(1);
    expect(s.jobs.some(j => j.id === ladderId || (j.kind === 'ladder' && at(j) === at(ladderSite)))).toBe(false);
    expect(s.jobs.find(j => j.id === wireId)).toEqual(before.jobs.find(j => j.id === wireId));
    expect(s.fireDamage).toEqual(before.fireDamage.filter(d => d.targetId !== ladderId));
    expect(s.counts()).toEqual({ ...counts, wood: counts.wood - ladder.delivered.wood! });
    expect(s.stats.destroyed).toEqual({ ...before.stats.destroyed,
      wood: before.stats.destroyed.wood + ladder.delivered.wood! });
    expect(s.stats.consumed).toEqual(before.stats.consumed); expect(s.stats.produced).toEqual(before.stats.produced);
    const restored = VoxelSimulation.load(s.save());
    expect(physicalJobs(restored.jobs)).toEqual(physicalJobs(s.jobs));
    expect(restored.stats).toEqual(s.stats); expect(restored.counts()).toEqual(s.counts());
  });
});
