import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { initialResearch } from '../src/voxel/research';
import { freshBatch, rotLimit } from '../src/voxel/preservation';
import { plantRandom } from '../src/voxel/plants';
import {
  Block,
  at,
  index,
  type Job,
  type Pos,
  type VoxelCommand,
  type Work,
} from '../src/voxel/types';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
/** Controlled terrain, stock and skill fixtures, not evidence of a normal start.
 * Work, transport, blocked output, reassignment and loading use simulation APIs.
 * Deliberate seed/rot/qualification changes below isolate specific boundaries. */
function fixture(configure: (s: VoxelSimulation) => void = () => {}) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  // Controlled feature fixture represents a colony with research already completed.
  s.research = initialResearch(true);
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let x = 10; x <= 18; x++)
    for (let y = 10; y <= 18; y++) {
      s.blocks[index(x, y, 7)] = Block.Soil;
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
    }
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i));
    p.schedule.fill('work');
    p.priorities = {
      clean: 0,
      warden: 0,
      hunt: 0,
      dig: 0,
      build: 0,
      cut: 0,
      haul: 0,
      grow: 0,
      cook: 0,
      craft: 0,
      care: 0,
      research: 0,
    };
    for (const skill of Object.values(p.skills))
      Object.assign(skill, { passion: 0, xp: 0, dailyXp: 0 });
  });
  configure(s);
  return VoxelSimulation.load(s.save());
}
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c);
  expect(r.ok, r.message).toBe(true);
}
function priority(s: VoxelSimulation, pawn: number, work: Work, value: number) {
  command(s, { type: 'priority', pawnId: s.pawns[pawn].id, work, value });
}
function until(s: VoxelSimulation, done: () => boolean, max = 2400) {
  for (let n = 0; n < max && !done(); n++) s.step();
  expect(
    done(),
    JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns.map((p) => p.reason) }),
  ).toBe(true);
}
function fullGround(s: VoxelSimulation) {
  for (let x = 10; x <= 18; x++)
    for (let y = 10; y <= 18; y++) {
      const q = pos(x, y);
      if (s.standable(q) && !s.items.some((i) => at(i) === at(q)))
        s.items.push({ ...q, id: s.nextId++, resource: 'wood', amount: 75 });
    }
}
const job = (s: VoxelSimulation, kind: Job['kind']) => s.jobs.find((j) => j.kind === kind)!;
function matureRice(s: VoxelSimulation) {
  const q = pos(14, 14);
  s.farms.push({ ...q, crop: 'rice' });
  s.crops.push({ ...q, id: s.nextId++, kind: 'rice', growth: 1, sownAt: 0 });
}
function selectCropOutcomeSeed(s: VoxelSimulation, fails: boolean) {
  // Explicit deterministic branch fixture: select a seed before any work, never
  // overwrite the harvest result. Level 0 Plants has native harvest stat .6.
  const j = job(s, 'harvest'),
    id = s.pawns[0].id;
  for (let seed = 1; seed < 10000; seed++)
    if (plantRandom(seed, j.id, id, 4702) > 0.6 === fails) {
      s.seed = seed;
      return;
    }
  throw new Error('No deterministic crop fixture seed');
}

describe('skill yield and deferred learning transaction boundaries', () => {
  it('keeps both miners progress-weighted yields through full output, handoff and load', () => {
    const target = pos(19, 14);
    let s = fixture((s) => {
      // Two resource types require two output cells; mining opens only one new
      // standable cell, so a full surrounding floor genuinely blocks the commit.
      s.blocks[at(target)] = Block.Steel;
      s.blocks[at({ ...target, z: 9 })] = Block.Components;
      s.pawns[0].skills.mining.level = 0; // yield .6, speed .1
      s.pawns[1].skills.mining.level = 8; // yield 1, speed 1
      s.pawns[2].skills.mining.level = 9;
    });
    fullGround(s); // Fill after load rebuilds the occupancy indexes of the controlled terrain.
    priority(s, 0, 'dig', 1);
    command(s, { type: 'designate', tool: 'mine', from: target });
    until(s, () => job(s, 'mine').progress >= 35);
    const firstProgress = job(s, 'mine').progress,
      firstContribution = job(s, 'mine').miningYieldWork;
    expect(firstContribution).toBeCloseTo(firstProgress * 0.6, 9);
    const firstXP = s.pawns[0].skills.mining.xp;
    s = VoxelSimulation.load(s.save());
    expect(job(s, 'mine').miningYieldWork).toBe(firstContribution);
    priority(s, 0, 'dig', 0);
    priority(s, 1, 'dig', 1);
    until(s, () => !job(s, 'mine') || job(s, 'mine').progress === job(s, 'mine').work);
    const complete = job(s, 'mine');
    expect(complete, JSON.stringify(s.items.filter((i) => i.resource !== 'wood'))).toBeDefined();
    const weighted = firstProgress * 0.6 + (complete.work - firstProgress);
    expect(complete.miningYieldWork).toBeCloseTo(weighted, 9);
    expect(complete.reason).toContain('落地空间');
    expect(s.stats.produced.steel).toBe(0);
    expect(s.blocks[at(target)]).toBe(Block.Steel);
    expect(s.pawns[0].skills.mining.xp).toBe(firstXP);
    const ticks = complete.workTicks,
      contributions = complete.miningYieldWork;
    const xp = s.pawns.map((p) => p.skills.mining.xp);
    s.step(80);
    expect(job(s, 'mine').workTicks).toBe(ticks);
    expect(s.pawns.map((p) => p.skills.mining.xp)).toEqual(xp);
    s = VoxelSimulation.load(s.save());
    priority(s, 1, 'dig', 0);
    priority(s, 2, 'dig', 1);
    s.step(80);
    expect(job(s, 'mine').miningYieldWork).toBe(contributions);
    expect(job(s, 'mine').workTicks).toBe(ticks);
    expect(s.pawns.map((p) => p.skills.mining.xp)).toEqual(xp);
    // A nearby free cell plus the mined cell can now hold both physical resources.
    s.items = s.items.filter((i) => at(i) !== at(pos(18, 13)));
    until(s, () => s.stats.mined === 2);
    expect(s.stats.produced.steel).toBe(32); // 40 * (.5*.6 + .5*1), not final miner's 40/41.
    expect(s.counts().steel).toBe(32);
    expect([1, 2]).toContain(s.stats.produced.components);
    expect(s.counts().components).toBe(s.stats.produced.components);
    expect(s.pawns.map((p) => p.skills.mining.xp)).toEqual(xp);
    expect(VoxelSimulation.load(s.save()).stats.produced.steel).toBe(32);
  });

  it('loses an entire low-skill crop harvest but never applies that failure to a mature tree', () => {
    const crop = fixture((s) => {
      matureRice(s);
      s.pawns[0].skills.plants.level = 0;
    });
    until(crop, () => !!job(crop, 'harvest'));
    selectCropOutcomeSeed(crop, true);
    priority(crop, 0, 'grow', 1);
    until(crop, () => crop.stats.harvested === 1);
    expect(crop.crops).toHaveLength(0);
    expect(crop.counts().grain).toBe(0);
    expect(crop.stats.produced.grain).toBe(0); // Ledger must not report base yield after physical failure.
    expect(crop.pawns[0].skills.plants.xp).toBeGreaterThan(0); // Actual failed work still teaches.

    const tree = fixture((s) => {
      s.pawns[0].skills.plants.level = 0;
      s.trees.push({
        ...pos(14, 14),
        id: s.nextId++,
        species: 'saguaro',
        wood: 15,
        growth: 1,
        age: 0,
        health: 1,
        unlitTicks: 0,
        planted: false,
      });
    });
    command(tree, { type: 'designate', tool: 'cut', from: pos(14, 14) });
    const cutting = job(tree, 'cut');
    // Even choose a would-be failure draw, proving tree behavior differs from crops.
    for (let seed = 1; seed < 10000; seed++)
      if (plantRandom(seed, cutting.id, tree.pawns[0].id, 4702) > 0.6) {
        tree.seed = seed;
        break;
      }
    priority(tree, 0, 'cut', 1);
    until(tree, () => tree.stats.cut === 1);
    expect(tree.stats.produced.wood).toBe(15);
    expect(tree.counts().wood).toBe(15);
  });

  it('freezes the first harvest outcome across a blocked floor, different worker and reload without XP farming', () => {
    let s = fixture((s) => {
      matureRice(s);
      s.pawns[0].skills.plants.level = 0;
      s.pawns[1].skills.plants.level = 8;
      fullGround(s);
    });
    until(s, () => !!job(s, 'harvest'));
    selectCropOutcomeSeed(s, false);
    priority(s, 0, 'grow', 1);
    until(s, () => !!job(s, 'harvest').harvestResult);
    const finished = job(s, 'harvest'),
      result = structuredClone(finished.harvestResult);
    expect(result).toEqual({ amount: 6, skill: 0, workerId: s.pawns[0].id });
    expect(finished.reason).toContain('落地空间');
    expect(s.stats.harvested).toBe(0);
    expect(s.crops).toHaveLength(1);
    const ticks = finished.workTicks,
      xp = s.pawns.map((p) => p.skills.plants.xp);
    s.step(80);
    expect(s.pawns.map((p) => p.skills.plants.xp)).toEqual(xp);
    s = VoxelSimulation.load(s.save());
    priority(s, 0, 'grow', 0);
    priority(s, 1, 'grow', 1);
    s.step(100);
    expect(job(s, 'harvest').harvestResult).toEqual(result);
    expect(job(s, 'harvest').workTicks).toBe(ticks);
    expect(s.pawns.map((p) => p.skills.plants.xp)).toEqual(xp);
    s.items = s.items.filter((i) => at(i) !== at(pos(15, 14)));
    until(s, () => s.stats.harvested === 1);
    expect(s.stats.produced.grain).toBe(6);
    expect(s.counts().grain).toBe(6);
    expect(s.pawns.map((p) => p.skills.plants.xp)).toEqual(xp);
  });

  it('erases stale cooking training when delivered ingredients spoil and rewards only replacement work', () => {
    let s = fixture((s) => {
      s.stoves.push({ ...pos(14, 14), id: s.nextId++, target: 1, paused: false });
      s.items.push(
        { ...pos(12, 14), id: s.nextId++, ...freshBatch('grain', 10, 'rice') },
        { ...pos(12, 15), id: s.nextId++, resource: 'wood', amount: 1 },
      );
      s.pawns[0].skills.cooking.level = 4;
      s.pawns[1].skills.cooking.level = 8;
    });
    priority(s, 0, 'cook', 1);
    until(s, () => (job(s, 'cook')?.workTicks ?? 0) >= 20);
    const cooking = job(s, 'cook');
    expect(cooking.cookTraining).toEqual([{ pawnId: s.pawns[0].id, ticks: 20 }]);
    expect(s.pawns[0].skills.cooking.xp).toBe(0);
    // Only freshness is injected; original inputs were delivered by the actual job.
    for (const batch of cooking.deliveredFood) batch.rotProgress = rotLimit(batch)! - 0.001;
    s.step();
    expect(cooking.workTicks).toBe(0);
    expect(cooking.progress).toBe(0);
    expect(cooking.cookTraining).toEqual([]);
    expect(s.stats.spoiled.grain).toBe(10);
    expect(cooking.delivered.wood).toBe(1);
    s = VoxelSimulation.load(s.save());
    expect(job(s, 'cook').cookTraining).toEqual([]);
    priority(s, 0, 'cook', 0);
    priority(s, 1, 'cook', 1);
    s.items.push({ ...pos(12, 14), id: s.nextId++, ...freshBatch('grain', 10, 'rice') });
    const replacement = job(s, 'cook');
    until(s, () => s.stats.cooked === 1);
    expect(replacement.workTicks).toBe(114); // ceil(100 / (.4 + .06*8)).
    expect(replacement.cookTraining).toEqual([{ pawnId: s.pawns[1].id, ticks: 114 }]);
    expect(s.pawns[0].skills.cooking.xp).toBe(0);
    expect(s.pawns[1].skills.cooking.xp).toBeCloseTo(114 * 0.3 * 0.35, 9);
    expect(s.stats.consumed.grain).toBe(10);
    expect(s.stats.produced.meal).toBe(1);
  });

  it.each(['plantTree', 'solar'] as const)(
    'rechecks %s level 6 after qualification loss and rejects an unqualified handoff',
    (kind) => {
      let s = fixture((s) => {
        for (const p of s.pawns) {
          p.skills.plants.level = 5;
          p.skills.construction.level = 5;
        }
        s.pawns[0].skills.plants.level = 6;
        s.pawns[0].skills.construction.level = 6;
        if (kind === 'solar')
          s.items.push(
            { ...pos(10, 13), id: s.nextId++, resource: 'steel', amount: 75 },
            { ...pos(11, 13), id: s.nextId++, resource: 'steel', amount: 25 },
            { ...pos(12, 13), id: s.nextId++, resource: 'components', amount: 3 },
          );
      });
      const work = kind === 'solar' ? 'build' : 'grow';
      const skill = kind === 'solar' ? 'construction' : 'plants';
      command(
        s,
        kind === 'solar'
          ? { type: 'designate', tool: 'solar', from: pos(14, 14) }
          : { type: 'designate', tool: 'grove', from: pos(14, 14), treeSpecies: 'poplar' },
      );
      priority(s, 0, work, 1);
      until(s, () => job(s, kind).workTicks >= 10);
      const before = structuredClone(job(s, kind));
      // Controlled qualification change, not a claim that native decay occurs at level 6.
      Object.assign(s.pawns[0].skills[skill], { level: 5, xp: 0 });
      const xp = s.pawns[0].skills[skill].xp;
      s.step();
      expect(job(s, kind).owner).toBeNull();
      expect(job(s, kind).progress).toBe(before.progress);
      expect(job(s, kind).workTicks).toBe(before.workTicks);
      expect(s.pawns[0].skills[skill].xp).toBe(xp);
      priority(s, 0, work, 0);
      priority(s, 1, work, 1);
      s.step(100);
      expect(job(s, kind).progress).toBe(before.progress);
      expect(job(s, kind).delivered).toEqual(before.delivered);
      expect(job(s, kind).reason).toContain('6 级');
      expect(s.pawns[1].skills[skill].xp).toBe(0);
      s = VoxelSimulation.load(s.save());
      s.pawns[1].skills[skill].level = 6;
      until(s, () => job(s, kind).progress > before.progress);
      expect(job(s, kind).owner).toBe(s.pawns[1].id);
      expect(job(s, kind).delivered).toEqual(before.delivered);
    },
  );
});
