import { stripRangedDefaults } from './legacy-ranged-defaults';
import { legacySimulation } from './fixtures/legacy-start';
import { setImmediate as yieldToRunner } from 'node:timers/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import {
  CROPS,
  NUTRITION,
  cropGrowth,
  daylight,
  fertilityGrowth,
  lightGrowth,
  temperatureGrowth,
} from '../src/voxel/farming';
import { Block, DAY, index } from '../src/voxel/types';
import type { CropKind, Pos, Resource, Tool, VoxelSave } from '../src/voxel/types';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
const resources: Resource[] = [
  'wood',
  'stone',
  'steel',
  'components',
  'food',
  'grain',
  'meal',
  'chunk',
];
function place(s: VoxelSimulation, tool: Tool, from: Pos, to?: Pos, crop?: CropKind) {
  const result = s.command({ type: 'designate', tool, from, to, ...(crop ? { crop } : {}) });
  expect(result.ok, result.message).toBe(true);
  return result;
}
function until(s: VoxelSimulation, predicate: () => boolean, limit = 2400, audit?: () => void) {
  for (let n = 0; !predicate() && n < limit; n++) {
    s.step();
    audit?.();
  }
  expect(
    predicate(),
    JSON.stringify({
      tick: s.tick,
      jobs: s.jobs,
      pawns: s.pawns,
      crops: s.crops,
      stoves: s.stoves,
    }),
  ).toBe(true);
}
/** Preserve every tick and ledger check while allowing Vitest's RPC and timers
 * to run during the genuine multi-day harvest setup. */
async function untilCooperatively(
  s: VoxelSimulation, predicate: () => boolean, limit: number, audit: () => void,
) {
  for (let n = 0; !predicate() && n < limit; n++) {
    s.step();
    audit();
    if ((n + 1) % 250 === 0) await yieldToRunner();
  }
  until(s, predicate, 0);
}
function ledger(s: VoxelSimulation) {
  const before = {
    counts: s.counts(),
    produced: { ...s.stats.produced },
    consumed: { ...s.stats.consumed },
    spoiled: { ...s.stats.spoiled },
    destroyed: { ...s.stats.destroyed },
    imported: { ...s.trade.imported },
    exported: { ...s.trade.exported },
  };
  return () => {
    const counts = s.counts();
    for (const r of resources)
      if (
        counts[r] +
          s.stats.consumed[r] -
          before.consumed[r] +
          s.stats.spoiled[r] -
          before.spoiled[r] +
          s.stats.destroyed[r] -
          before.destroyed[r] +
          s.trade.exported[r] -
          before.exported[r] !==
        before.counts[r] + s.stats.produced[r] - before.produced[r] +
          s.trade.imported[r] - before.imported[r]
      )
        throw new Error(`${r} material conservation failed at tick ${s.tick}`);
    if (s.items.some((i) => i.amount <= 0) || s.pawns.some((p) => p.cargo && p.cargo.amount <= 0))
      throw new Error('Invalid physical stack');
    const owners = s.jobs.flatMap((j) => (j.owner === null ? [] : [j.owner]));
    if (new Set(owners).size !== owners.length) throw new Error('Competing job ownership');
  };
}
function bill(s: VoxelSimulation, stoveId: number, target: number, paused = false) {
  const result = s.command({ type: 'bill', stoveId, target, paused });
  expect(result.ok, result.message).toBe(true);
}
function stove(s: VoxelSimulation, p = pos(32, 31)) {
  place(s, 'stove', p);
  until(s, () => s.stoves.some((v) => v.x === p.x && v.y === p.y), 5000);
  const result = s.stoves.find((v) => v.x === p.x && v.y === p.y)!;
  bill(s, result.id, 0, true);
  return result;
}
function disableGrowing(s: VoxelSimulation) {
  for (const p of s.pawns)
    expect(s.command({ type: 'priority', pawnId: p.id, work: 'grow', value: 0 }).ok).toBe(true);
}

describe('food reference curves and physical farmland', () => {
  it('keeps temperature, fertility and light boundaries independent of calendar duration', () => {
    expect([
      temperatureGrowth(0),
      temperatureGrowth(3),
      temperatureGrowth(6),
      temperatureGrowth(42),
      temperatureGrowth(50),
      temperatureGrowth(58),
    ]).toEqual([0, 0.5, 1, 1, 0.5, 0]);
    expect(fertilityGrowth('rice', 0.5)).toBe(0.5);
    expect(fertilityGrowth('potato', 0.5)).toBe(0.8);
    expect(lightGrowth(0.51)).toBe(0);
    expect(lightGrowth(1)).toBe(1);
    expect(daylight(0)).toBe(0);
    expect(daylight(12)).toBe(1);
    expect(cropGrowth('rice', 1, 1, 21, 19.2)).toBe(0);
    expect(cropGrowth('rice', 1, 1, 21, 12) * DAY * 3).toBeCloseTo(1, 12);
    expect(NUTRITION.grain! * 10).toBe(0.5);
    expect(NUTRITION.meal).toBe(0.9);
    expect(CROPS.corn.yield).toBe(22);
  });
  it('rejects invalid farm strokes atomically and prevents storage/construction overlap', () => {
    const s = legacySimulation(),
      initial = s.save();
    for (const c of [
      { type: 'designate', tool: 'farm', from: pos(30, 31), to: pos(30, 32), crop: 'rice' },
      { type: 'designate', tool: 'farm', from: pos(27, 29), crop: 'rice' },
      { type: 'designate', tool: 'farm', from: pos(32, 32, 11), crop: 'rice' },
      { type: 'designate', tool: 'farm', from: pos(32, 32), crop: 'invalid' },
    ] as const) {
      expect(s.command(c as Parameters<VoxelSimulation['command']>[0]).ok).toBe(false);
      expect(s.save()).toEqual(initial);
    }
    place(s, 'farm', pos(32, 32), undefined, 'rice');
    const farm = s.save();
    for (const tool of ['stock', 'wall', 'stove', 'shaft', 'up'] as const) {
      expect(s.command({ type: 'designate', tool, from: pos(32, 32) }).ok).toBe(false);
      expect(s.save()).toEqual(farm);
    }
  });
  it('pauses growth below a real upstairs floor and resumes after normal demolition', () => {
    const s = legacySimulation(),
      plant = pos(32, 30);
    place(s, 'farm', plant, undefined, 'rice');
    until(s, () => s.crops.length === 1);
    place(s, 'up', pos(31, 30));
    until(s, () => !s.jobs.length);
    place(s, 'floor', pos(32, 30, 11));
    until(s, () => !s.jobs.length);
    expect(s.cropCondition(plant, 'rice').light).toBe(0);
    expect(s.cropCondition(plant, 'rice').reason).toContain('遮挡');
    const growth = s.crops[0].growth;
    s.step(250);
    expect(s.crops[0].growth).toBe(growth);
    place(s, 'remove', pos(32, 30, 11));
    until(s, () => !s.jobs.length);
    until(s, () => s.crops[0].growth > growth, DAY);
    expect(s.cropCondition(plant, 'rice').growthRate).toBeGreaterThan(0);
  });
  it('reassigns only the next crop and clears a growing plot without producing a free harvest', () => {
    const s = legacySimulation(),
      target = pos(32, 32);
    place(s, 'farm', target, undefined, 'rice');
    until(s, () => s.crops.length === 1);
    const id = s.crops[0].id;
    place(s, 'farm', target, undefined, 'corn');
    expect(s.farms[0].crop).toBe('corn');
    expect(s.crops[0].id).toBe(id);
    expect(s.crops[0].kind).toBe('rice');
    place(s, 'clearZone', target);
    s.step(100);
    expect(s.farms).toEqual([]);
    expect(s.crops).toEqual([]);
    expect(s.jobs).toEqual([]);
    expect(s.stats.harvested).toBe(0);
    expect(s.stats.produced.grain).toBe(0);
  });
  it('preserves actual crop growth through save/load and stops at night without skipping time', () => {
    let s = legacySimulation();
    place(s, 'farm', pos(32, 32), undefined, 'potato');
    until(s, () => s.crops.length === 1);
    s.step(1000);
    const crop = { ...s.crops[0] };
    s = VoxelSimulation.load(s.save());
    expect(s.crops[0]).toEqual(crop);
    // Start is 08:00; twelve simulated hours reach 20:00. Avoid cloning the whole
    // UI snapshot every tick in this growth test (not a snapshot performance test).
    until(s, () => s.tick >= DAY / 2, DAY);
    const nightGrowth = s.crops[0].growth;
    s.step(1000);
    expect(s.crops[0].growth).toBe(nightGrowth);
    until(s, () => s.crops[0].growth > nightGrowth, DAY);
    // A full day now advances wild-tree ecology too. Keep the bounded calendar
    // assertion independent of CPU contention in concurrent test workers.
  }, 30000);
  it('never seals a physical resource stack inside a completed stove', () => {
    const s = legacySimulation(),
      audit = ledger(s);
    for (const p of s.pawns)
      for (const work of ['dig', 'build', 'cut', 'haul', 'grow', 'cook', 'craft'] as const)
        expect(
          s.command({
            type: 'priority',
            pawnId: p.id,
            work,
            value: p === s.pawns[0] && (work === 'cut' || work === 'build') ? 1 : 0,
          }).ok,
        ).toBe(true);
    place(s, 'cut', pos(27, 29));
    until(s, () => s.stats.cut === 1, 1500, audit);
    const loose = s.items.find(
      (i) =>
        i.resource === 'wood' &&
        i.amount === 27 &&
        !s.stockpiles.some((p) => p.x === i.x && p.y === i.y && p.z === i.z),
    )!;
    expect(loose.amount).toBe(27);
    const target = pos(loose.x, loose.y, loose.z);
    const planned = s.command({ type: 'designate', tool: 'stove', from: target });
    if (planned.ok) {
      until(
        s,
        () =>
          s.stoves.length === 1 || s.jobs.some((j) => j.kind === 'stove' && j.progress >= j.work),
        2400,
        audit,
      );
      if (s.stoves.length)
        expect(s.items.some((i) => i.x === target.x && i.y === target.y && i.z === target.z)).toBe(
          false,
        );
    }
    for (const p of s.pawns)
      expect(s.command({ type: 'priority', pawnId: p.id, work: 'haul', value: 1 }).ok).toBe(true);
    if (!planned.ok) {
      until(
        s,
        () => !s.items.some((i) => i.x === target.x && i.y === target.y && i.z === target.z),
        2400,
        audit,
      );
      place(s, 'stove', target);
    }
    until(s, () => s.stoves.length === 1, 4000, audit);
    expect(s.items.some((i) => i.x === target.x && i.y === target.y && i.z === target.z)).toBe(
      false,
    );
    expect(s.items.every((i) => s.standable(i))).toBe(true);
    audit();
  });
  it('rolls back a wall when an upper stack has no same-layer neighboring drop cell', () => {
    const s = legacySimulation(),
      shaft = pos(33, 32);
    place(s, 'up', shaft);
    until(s, () => !s.jobs.length, 3000);
    for (let n = 0; n < s.pawns.length; n++)
      expect(s.command({ type: 'move', pawnId: s.pawns[n].id, target: pos(31 + n, 34) }).ok).toBe(
        true,
      );
    until(s, () => s.pawns.every((p) => p.z === 8 && p.phase === 'idle'), 1500);
    place(s, 'remove', shaft);
    until(s, () => !s.jobs.length, 1500);
    for (const p of s.pawns)
      expect(s.command({ type: 'priority', pawnId: p.id, work: 'haul', value: 0 }).ok).toBe(true);
    // Isolated obstruction fixture: relocate the existing ration stack onto the
    // remaining upper ladder, preserving every resource quantity. No resources
    // or mature crops are generated; the campaign has no such relocation.
    const ration = s.items.find((i) => i.resource === 'food')!;
    Object.assign(ration, pos(33, 32, 9));
    expect(s.standable(ration)).toBe(true);
    for (const [x, y] of [
      [32, 32],
      [34, 32],
      [33, 31],
      [33, 33],
    ])
      expect(s.standable(pos(x, y, 9))).toBe(false);
    const audit = ledger(s),
      counts = s.counts(),
      consumedWood = s.stats.consumed.wood;
    place(s, 'wall', shaft);
    until(s, () => s.jobs.some((j) => j.kind === 'wall' && j.progress >= j.work), 2000, audit);
    expect(s.blocks[index(33, 32, 8)]).toBe(Block.Air);
    expect(s.blocks[index(33, 32, 9)]).toBe(Block.Air);
    expect(s.items.find((i) => i.id === ration.id)).toMatchObject({
      x: 33,
      y: 32,
      z: 9,
      amount: 10,
    });
    expect(s.counts()).toEqual(counts);
    expect(s.stats.consumed.wood).toBe(consumedWood);
    place(s, 'cancel', shaft);
    audit();
    expect(s.counts()).toEqual(counts);
  });
});

describe('real harvested inputs, cooking and food persistence', () => {
  let harvestedSave: VoxelSave;
  beforeAll(async () => {
    // Shared setup is a genuine eight-plus-day harvest, not a mature crop or item fixture.
    const started = performance.now(), s = legacySimulation(), startTick = s.tick;
    place(s, 'farm', pos(29, 28), pos(35, 30), 'rice');
    place(s, 'stock', pos(29, 35), pos(35, 36));
    const audit = ledger(s);
    await untilCooperatively(s, () => s.counts().grain >= 90 && s.pawns.every((p) => p.food > 60), DAY * 12, audit);
    expect(s.tick - startTick).toBeGreaterThanOrEqual(DAY * 8);
    disableGrowing(s);
    harvestedSave = s.save();
    console.info(`[voxel-food harvest] ${s.tick - startTick} ticks (${((s.tick - startTick) / DAY).toFixed(3)} days), ` +
      `${s.counts().grain} grain, ${Math.round(performance.now() - started)} ms; every tick audited`);
  }, 180000);
  const prepared = () => VoxelSimulation.load(harvestedSave);

  it('requires delivered grain and fuel, produces one meal, and treats the stove as solid', () => {
    const s = prepared(),
      oven = stove(s),
      audit = ledger(s);
    expect(s.standable(oven)).toBe(false);
    expect(s.command({ type: 'move', pawnId: s.pawns[0].id, target: oven }).ok).toBe(false);
    const before = { consumed: { ...s.stats.consumed }, produced: { ...s.stats.produced } };
    bill(s, oven.id, 1);
    until(
      s,
      () =>
        s.jobs.some(
          (j) =>
            j.kind === 'cook' && (j.delivered.grain ?? 0) === 10 && (j.delivered.wood ?? 0) === 1,
        ),
      5000,
      audit,
    );
    expect(s.stats.produced.meal).toBe(before.produced.meal);
    until(s, () => s.stats.produced.meal === before.produced.meal + 1, 5000, audit);
    expect(s.stats.consumed.grain - before.consumed.grain).toBe(10);
    expect(s.stats.consumed.wood - before.consumed.wood).toBe(1);
    expect(s.counts().meal).toBe(1);
    s.step(100);
    audit();
    expect(s.jobs.some((j) => j.kind === 'cook')).toBe(false);
  });
  it.each(['carried', 'delivered'] as const)(
    'refunds paused %s cooking ingredients without making or losing a meal',
    (phase) => {
      const s = prepared(),
        oven = stove(s),
        audit = ledger(s);
      bill(s, oven.id, 4);
      until(
        s,
        () =>
          phase === 'carried'
            ? s.pawns.some(
                (p) =>
                  p.cargo?.resource === 'grain' &&
                  s.jobs.some((j) => j.id === p.jobId && j.kind === 'cook'),
              )
            : s.jobs.some(
                (j) =>
                  j.kind === 'cook' &&
                  (j.delivered.grain ?? 0) === 10 &&
                  (j.delivered.wood ?? 0) === 1,
              ),
        5000,
        audit,
      );
      const before = s.counts(),
        produced = s.stats.produced.meal;
      bill(s, oven.id, 4, true);
      expect(s.counts()).toEqual(before);
      expect(s.jobs.some((j) => j.kind === 'cook')).toBe(false);
      until(s, () => s.pawns.every((p) => !p.cargo), 2000, audit);
      expect(s.stats.produced.meal).toBe(produced);
      expect(s.stoves[0].paused).toBe(true);
    },
  );
  it.each(['carried', 'delivered'] as const)(
    'preserves %s recipe inputs across a save and completes the recipe once',
    (phase) => {
      let s = prepared();
      const oven = stove(s);
      bill(s, oven.id, 1);
      until(
        s,
        () =>
          phase === 'carried'
            ? s.pawns.some(
                (p) =>
                  p.cargo?.resource === 'grain' &&
                  s.jobs.some((j) => j.id === p.jobId && j.kind === 'cook'),
              )
            : s.jobs.some(
                (j) => j.kind === 'cook' && (j.delivered.grain ?? 0) === 10 && j.progress > 20,
              ),
        5000,
      );
      const before = s.counts(),
        save = s.save(),
        delivered = save.jobs.find((j) => j.kind === 'cook')!.delivered;
      s = VoxelSimulation.load(JSON.parse(JSON.stringify(save)));
      const audit = ledger(s);
      expect(s.counts()).toEqual(before);
      expect(s.jobs.find((j) => j.kind === 'cook')!.delivered).toEqual(delivered);
      expect(s.stoves).toEqual(save.stoves);
      until(s, () => s.counts().meal === 1 && !s.jobs.some((j) => j.kind === 'cook'), 5000, audit);
      expect(s.stats.cooked).toBe(save.stats.cooked + 1);
      s.step(100);
      audit();
      expect(s.stats.cooked).toBe(save.stats.cooked + 1);
    },
  );
  it('counts in-progress output across two stoves and never reserves beyond a shared meal target', () => {
    const s = prepared(),
      a = stove(s, pos(32, 31)),
      b = stove(s, pos(34, 31)),
      audit = ledger(s);
    bill(s, a.id, 2);
    bill(s, b.id, 2);
    expect(s.jobs.filter((j) => j.kind === 'cook')).toHaveLength(2);
    const check = () => {
      audit();
      expect(s.counts().meal + s.jobs.filter((j) => j.kind === 'cook').length).toBeLessThanOrEqual(
        2,
      );
    };
    until(s, () => s.counts().meal === 2 && !s.jobs.some((j) => j.kind === 'cook'), 6000, check);
    expect(s.stats.cooked).toBe(2);
    s.step(100);
    check();
  });
  it('continues cooking after a target change without keeping the old reservation or inputs', () => {
    const s = prepared(),
      oven = stove(s),
      audit = ledger(s);
    bill(s, oven.id, 4);
    until(
      s,
      () => s.jobs.some((j) => j.kind === 'cook' && (j.delivered.grain ?? 0) > 0),
      5000,
      audit,
    );
    const id = s.jobs.find((j) => j.kind === 'cook')!.id,
      before = s.counts();
    bill(s, oven.id, 1);
    expect(s.jobs.some((j) => j.id === id)).toBe(false);
    expect(s.counts()).toEqual(before);
    until(s, () => s.counts().meal === 1 && !s.jobs.some((j) => j.kind === 'cook'), 5000, audit);
  });
  it('makes colonists consume a prepared meal through normal hunger progression', () => {
    const s = prepared(),
      oven = stove(s),
      audit = ledger(s);
    bill(s, oven.id, 3);
    until(s, () => s.counts().meal >= 1, 5000, audit);
    const consumed = s.stats.consumed.meal;
    until(s, () => s.stats.consumed.meal > consumed, DAY, audit);
    expect(s.pawns.some((p) => p.food > 85)).toBe(true);
    expect(
      s.stats.produced.meal +
        s.trade.imported.meal +
        harvestedSave.items.filter((i) => i.resource === 'meal').reduce((n, i) => n + i.amount, 0),
    ).toBe(s.counts().meal + s.stats.consumed.meal + s.stats.spoiled.meal +
      s.stats.destroyed.meal + s.trade.exported.meal);
  });
  it('rejects malformed food saves and bills without mutating the source world', () => {
    const s = prepared(),
      oven = stove(s);
    bill(s, oven.id, 2);
    const original = s.save();
    const mutations: Array<(save: VoxelSave) => void> = [
      (d) => {
        d.crops[0].growth = 1.01;
      },
      (d) => {
        d.crops[0].sownAt = d.tick + 1;
      },
      (d) => {
        d.farms.push({ ...d.farms[0] });
      },
      (d) => {
        d.stoves[0].target = -1;
      },
      (d) => {
        (d.stoves[0] as unknown as { paused: string }).paused = 'false';
      },
      (d) => {
        d.jobs.find((j) => j.kind === 'cook')!.cost.grain = 9;
      },
      (d) => {
        d.jobs.find((j) => j.kind === 'cook')!.delivered.grain = 11;
      },
      (d) => {
        d.items.push({ id: d.nextId++, resource: 'grain', amount: 0.5, ...pos(30, 32) });
      },
    ];
    for (const mutation of mutations) {
      const save = structuredClone(original);
      mutation(save);
      expect(() => VoxelSimulation.load(save)).toThrow();
      expect(s.save()).toEqual(original);
    }
    for (const target of [-1, 0.5, 101, Infinity]) {
      expect(s.command({ type: 'bill', stoveId: oven.id, target, paused: false }).ok).toBe(false);
      expect(s.save()).toEqual(original);
    }
  });
});

describe('v1 voxel food migration', () => {
  it('upgrades old numeric material jobs and keeps their delivered wood without altering the input save', () => {
    const s = legacySimulation();
    place(s, 'wall', pos(36, 34));
    until(s, () => (s.jobs[0]?.delivered.wood ?? 0) === 6);
    const legacy = s.save() as unknown as Record<string, any>;
    stripRangedDefaults(legacy);    legacy.version = 1;
    delete legacy.farms;
    delete legacy.crops;
    delete legacy.stoves;
    for (const j of legacy.jobs) {
      j.cost = j.cost.wood ?? 0;
      j.delivered = j.delivered.wood ?? 0;
    }
    for (const p of legacy.pawns) {
      delete p.eating;
      delete p.priorities.grow;
      delete p.priorities.cook;
    }
    for (const name of ['sown', 'harvested', 'cooked', 'eaten']) delete legacy.stats[name];
    for (const name of ['produced', 'consumed']) {
      delete legacy.stats[name].grain;
      delete legacy.stats[name].meal;
    }
    const untouched = structuredClone(legacy),
      loaded = VoxelSimulation.load(legacy),
      before = s.counts();
    expect(legacy).toEqual(untouched);
    expect(loaded.save().version).toBe(29);
    expect(loaded.farms).toEqual([]);
    expect(loaded.crops).toEqual([]);
    expect(loaded.stoves).toEqual([]);
    expect(loaded.jobs[0].delivered).toEqual({ wood: 6 });
    expect(loaded.counts()).toEqual(before);
    expect(
      loaded.pawns.every(
        (p) => p.priorities.grow === 1 && p.priorities.cook === 1 && p.eating === null,
      ),
    ).toBe(true);
    const audit = ledger(loaded);
    until(loaded, () => !loaded.jobs.length, 1000, audit);
    expect(loaded.stats.consumed.wood).toBe(6);
    expect(loaded.counts().wood).toBe(84);
  });
});
