import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { initialResearch } from '../src/voxel/research';
import { Block, index, type Pos, type VoxelCommand } from '../src/voxel/types';
import { makeWeaponBench } from '../src/voxel/weaponProduction';
import { freshBatch } from '../src/voxel/preservation';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
// Controlled geometry and stock for transactional boundary tests, not a normal campaign.
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  // Controlled feature fixture represents a colony with research already completed.
  s.research = initialResearch(true);
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let x = 10; x <= 24; x++)
    for (let y = 10; y <= 24; y++) {
      s.blocks[index(x, y, 7)] = Block.Soil;
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
    }
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i));
    p.schedule.fill('work');
    p.priorities = {
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
  });
  return VoxelSimulation.load(s.save());
}
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c);
  expect(r.ok, r.message).toBe(true);
}
function until(s: VoxelSimulation, done: () => boolean, max = 3000) {
  for (let i = 0; i < max && !done(); i++) s.step();
  expect(done(), JSON.stringify({ jobs: s.jobs, pawns: s.pawns.map((p) => p.reason) })).toBe(true);
}
function knifeFixture() {
  let s = fixture();
  s.weaponBenches.push(makeWeaponBench(s.nextId++, 'smithy', pos(16, 16), 'x'));
  s.weaponBenches[0].fuel = 50;
  s.items.push({ ...pos(13, 16), resource: 'steel', amount: 30, id: s.nextId++ });
  s = VoxelSimulation.load(s.save());
  s.pawns[0].priorities.craft = 1;
  command(s, {
    type: 'weaponBill',
    benchId: s.weaponBenches[0].id,
    kind: 'steelKnife',
    target: 1,
    paused: false,
  });
  return s;
}

describe('skills in real simulation tasks and saves', () => {
  it('migrates original v13 bytes without changing gear, terrain, needs or inventing historical XP', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v13-start.json', import.meta.url));
    const provenance = JSON.parse(
      readFileSync(new URL('./fixtures/voxel-v13-start.provenance.json', import.meta.url), 'utf8'),
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
    const old = JSON.parse(bytes.toString());
    expect(old.version).toBe(13);
    expect(old.pawns[0].skills).toBeUndefined();
    const s = VoxelSimulation.load(old),
      saved = s.save();
    expect(saved.version).toBe(15);
    expect(saved.items).toEqual(old.items);
    expect(saved.blocks).toEqual(old.blocks);
    expect(saved.pawns.map((p) => [p.food, p.rest, p.worn, p.weapon, p.health])).toEqual(
      old.pawns.map((p: any) => [p.food, p.rest, p.worn, p.weapon, p.health]),
    );
    expect(saved.pawns.map((p) => p.skills.crafting.level)).toEqual([5, 4, 8]);
    expect(
      saved.pawns.every((p) => Object.values(p.skills).every((s) => s.xp === 0 && s.dailyXp === 0)),
    ).toBe(true);
  });

  it('awards unfinished recipe XP only on actual work, not travel or fuel waits', () => {
    const s = knifeFixture(),
      p = s.pawns[0];
    until(s, () => s.jobs.some((j) => j.kind === 'smith' && j.workTicks > 0));
    const j = s.jobs.find((j) => j.kind === 'smith')!;
    expect(j.workTicks).toBe(1);
    expect(j.progress).toBe(1); // Crafting has no speed multiplier at healthy GeneralLaborSpeed=1.
    expect(p.skills.crafting.xp).toBeCloseTo(0.105, 10); // .1 * 3 * no-passion .35.
    s.step(9);
    expect(p.skills.crafting.xp).toBeCloseTo(1.05, 10);
    s.weaponBenches[0].fuel = 0;
    const before = structuredClone(p.skills),
      ticks = j.workTicks;
    s.step(200);
    expect(p.skills).toEqual(before);
    expect(j.workTicks).toBe(ticks);
  });

  it('locks finishing worker and quality through full ground, reassignment, load and retry', () => {
    let s = knifeFixture();
    until(s, () => s.jobs.some((j) => j.kind === 'smith' && j.progress >= 590));
    for (let x = 10; x <= 24; x++)
      for (let y = 10; y <= 24; y++) {
        const q = pos(x, y);
        if (s.standable(q) && !s.items.some((i) => i.x === x && i.y === y && i.z === 8))
          s.items.push({ ...q, id: s.nextId++, resource: 'wood', amount: 75 });
      }
    until(s, () => !!s.jobs.find((j) => j.kind === 'smith')?.productQuality);
    const job = s.jobs.find((j) => j.kind === 'smith')!,
      locked = structuredClone(job.productQuality);
    expect(job.progress).toBe(job.work);
    expect(locked?.workerId).toBe(s.pawns[0].id);
    expect(locked?.skill).toBe(5);
    const xp = s.pawns[0].skills.crafting.xp,
      fuel = s.weaponBenches[0].fuel,
      workTicks = job.workTicks;
    s.step(120);
    expect(s.pawns[0].skills.crafting.xp).toBe(xp);
    expect(s.weaponBenches[0].fuel).toBe(fuel);
    expect(job.workTicks).toBe(workTicks);
    s = VoxelSimulation.load(s.save());
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'craft', value: 0 });
    command(s, { type: 'priority', pawnId: s.pawns[2].id, work: 'craft', value: 1 });
    s.step(250);
    expect(s.jobs.find((j) => j.kind === 'smith')!.productQuality).toEqual(locked);
    expect(s.pawns[2].skills.crafting.xp).toBe(0);
    s.items = s.items.filter((i) => !(i.x === 17 && i.y === 18 && i.z === 8));
    until(s, () => s.stats.weaponsMade === 1);
    expect(s.items.find((i) => i.weapon)?.weapon?.quality).toBe(locked!.value);
    expect(s.pawns[2].skills.crafting.xp).toBe(0);
    expect(s.stats.consumed.steel).toBe(30);
    expect(VoxelSimulation.load(s.save()).items).toEqual(s.items);
  });

  it('rejects an underqualified smith, then lets a qualified worker complete the same order', () => {
    const s = knifeFixture(),
      bench = s.weaponBenches[0];
    command(s, {
      type: 'weaponBill',
      benchId: bench.id,
      kind: 'steelKnife',
      target: 0,
      paused: true,
    });
    s.items = [
      { ...pos(13, 16), id: s.nextId++, resource: 'steel', amount: 75 },
      { ...pos(14, 16), id: s.nextId++, resource: 'steel', amount: 25 },
    ];
    s.pawns[0].priorities.craft = 0;
    s.pawns[1].priorities.craft = 1; // Crafting4 cannot make a longsword.
    command(s, {
      type: 'weaponBill',
      benchId: bench.id,
      kind: 'steelLongsword',
      target: 1,
      paused: false,
    });
    s.step(150);
    const job = s.jobs.find((j) => j.kind === 'smith')!;
    expect(job.progress).toBe(0);
    expect(job.reason).toContain('工艺 5');
    expect(s.pawns[1].cargo).toBeNull();
    s.pawns[2].priorities.craft = 1;
    until(s, () => job.progress > 0);
    expect(job.owner).toBe(s.pawns[2].id);
  });

  it('defers cooking training until physical output succeeds and discards cancelled work credit', () => {
    let s = fixture();
    s.stoves.push({ ...pos(16, 16), id: s.nextId++, target: 1, paused: false });
    s.items.push(
      { ...pos(13, 16), id: s.nextId++, ...freshBatch('grain', 10, 'rice') },
      { ...pos(14, 16), id: s.nextId++, resource: 'wood', amount: 1 },
    );
    s = VoxelSimulation.load(s.save());
    s.pawns[0].priorities.cook = 1;
    until(s, () => s.jobs.some((j) => j.kind === 'cook' && j.workTicks >= 10));
    expect(s.pawns[0].skills.cooking.xp).toBe(0);
    const mid = s.save();
    const cancelled = VoxelSimulation.load(mid);
    command(cancelled, { type: 'bill', stoveId: cancelled.stoves[0].id, target: 0, paused: true });
    expect(cancelled.pawns[0].skills.cooking.xp).toBe(0);
    s = VoxelSimulation.load(mid);
    until(s, () => s.stats.cooked === 1);
    expect(s.pawns[0].skills.cooking.xp).toBeCloseTo(157 * 0.3 * 0.35, 9); // Cook4: speed .64; ceil(100/.64)=157.
    const xp = s.pawns[0].skills.cooking.xp;
    s.step(100);
    expect(s.pawns[0].skills.cooking.xp).toBe(xp);
  });

  it('rejects malformed skill records, unearned quality and contradictory work clocks', () => {
    const s = knifeFixture();
    until(s, () => s.jobs.some((j) => j.kind === 'smith' && j.progress > 0));
    const raw = s.save();
    const mutations = [
      (d: typeof raw) => {
        d.pawns[0].skills.crafting.level = 21;
      },
      (d: typeof raw) => {
        d.pawns[0].skills.crafting.xp = -1000;
      },
      (d: typeof raw) => {
        d.pawns[0].skills.crafting.dailyXp = NaN;
      },
      (d: typeof raw) => {
        d.jobs[0].workTicks = d.tick + 1;
      },
      (d: typeof raw) => {
        d.jobs[0].productQuality = { value: 5, skill: 20, workerId: d.pawns[0].id };
      },
      (d: typeof raw) => {
        d.jobs[0].cookTraining = [];
      },
    ];
    for (const mutate of mutations) {
      const d = structuredClone(raw);
      mutate(d);
      expect(() => VoxelSimulation.load(d)).toThrow();
      expect(s.save()).toEqual(raw);
    }
  });
});
