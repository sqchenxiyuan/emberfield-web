import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { initialStoryteller } from '../src/voxel/storyteller';
import { initialTrade } from '../src/voxel/trade';
import { initialFireHazards } from '../src/voxel/fire';
import { initialWeather } from '../src/voxel/weather';
import {
  APPAREL_DEFS,
  APPAREL_KINDS,
  apparelStats,
  apparelWearDamage,
  compatibleApparel,
  makeApparel,
} from '../src/voxel/apparel';
import { healthSummary, updateHealth, initialSurvival } from '../src/voxel/survival';
import {
  freshBatch,
  portion,
  validBatch,
  isPerishable,
  mergeBatch,
} from '../src/voxel/preservation';
import { stackLimit } from '../src/voxel/logistics';
import {
  Block,
  DAY,
  index,
  type ApparelKind,
  type ApparelPiece,
  type Pos,
  type Resource,
  type VoxelCommand,
} from '../src/voxel/types';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c);
  expect(r.ok, r.message).toBe(true);
  return r;
}
function until(s: VoxelSimulation, done: () => boolean, limit = 12000) {
  for (let i = 0; i < limit && !done(); i++) s.step();
  expect(
    done(),
    JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns, items: s.items }),
  ).toBe(true);
}
function fixture() {
  const s = new VoxelSimulation(73129, {
    biome: 'temperate',
    hilliness: 'flat',
    meanTemperature: 24,
    latitude: 0,
    rainfall: 1100,
  });
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
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
    p.worn = [];
    p.schedule.fill('work');
    p.priorities = {
      handle: 0, firefight: 0, clean: 0,
      warden: 0,
      hunt: 0,
      dig: 0,
      build: i === 0 ? 1 : 0,
      cut: 0,
      haul: 0,
      grow: i === 0 ? 1 : 0,
      cook: 0,
      craft: i === 0 ? 1 : 0,
      care: 0,
      research: 0,
    };
  });
  return VoxelSimulation.load(s.save());
}
function stack(
  s: VoxelSimulation,
  resource: Exclude<Resource, 'apparel'>,
  amount: number,
  p = pos(13, 15),
) {
  const item = { ...p, ...freshBatch(resource, amount), id: s.nextId++ };
  s.items.push(item);
  return item;
}
function garment(s: VoxelSimulation, kind: ApparelKind, p = pos(14, 15)) {
  const apparel = makeApparel(s.nextId++, kind),
    item = { ...p, resource: 'apparel' as const, amount: 1, apparel, id: s.nextId++ };
  s.items.push(item);
  return apparel;
}
function ledger(s: VoxelSimulation) {
  const c = s.counts();
  return Object.fromEntries(
    (Object.keys(c) as Resource[]).map((r) => [
      r,
      c[r] + s.stats.consumed[r] + s.stats.spoiled[r] + s.stats.destroyed[r] - s.stats.produced[r],
    ]),
  );
}
function allPieces(s: VoxelSimulation): ApparelPiece[] {
  return [
    ...s.items.flatMap((i) => (i.apparel ? [i.apparel] : [])),
    ...s.pawns.flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
  ];
}
function unique(s: VoxelSimulation) {
  const pieces = allPieces(s);
  expect(new Set(pieces.map((p) => p.id)).size).toBe(pieces.length);
  expect(s.counts().apparel).toBe(pieces.length);
}
function bench(s: VoxelSimulation) {
  stack(s, 'wood', 75);
  command(s, { type: 'designate', tool: 'tailor', from: pos(17, 18), axis: 'x' });
  until(s, () => s.tailors.length === 1);
  return s.tailors[0];
}

describe('apparel source values and physical identity', () => {
  it('uses cloth insulation and quality, ignores HP ratio, and respects layers plus coverage', () => {
    const parka = makeApparel(1, 'parka');
    expect(apparelStats(parka)).toMatchObject({ cold: 36, heat: 0, maxHitPoints: 180 });
    parka.hitPoints = 1;
    expect(apparelStats(parka).cold).toBe(36);
    parka.quality = 6;
    expect(apparelStats(parka).cold).toBeCloseTo(64.8);
    expect(apparelStats(parka).maxHitPoints).toBe(180);
    expect(compatibleApparel(parka, makeApparel(2, 'duster'))).toBe(false);
    expect(compatibleApparel(makeApparel(3, 'shirt'), makeApparel(4, 'pants'))).toBe(true);
    expect(compatibleApparel(parka, makeApparel(5, 'shirt'))).toBe(true);
    expect(stackLimit('apparel')).toBe(1);
    expect(stackLimit('cloth')).toBe(75);
  });
  it('preserves garment metadata in physical portions and forbids cotton as edible grain', () => {
    const piece = makeApparel(1, 'tuque'),
      batch = { resource: 'apparel' as const, amount: 1, apparel: piece };
    expect(portion(batch, 1)).toEqual(batch);
    expect(portion(batch, 1).apparel).not.toBe(piece);
    expect(() => mergeBatch(batch, portion(batch, 1))).toThrow();
    expect(validBatch(batch)).toBe(true);
    expect(validBatch({ ...batch, amount: 2 })).toBe(false);
    expect(validBatch({ resource: 'grain', crop: 'cotton', amount: 1, rotProgress: 0 })).toBe(
      false,
    );
    expect(isPerishable('cloth')).toBe(false);
    expect(isPerishable('apparel')).toBe(false);
  });
  it('applies worn insulation to both onset and recovery while merely carried clothes do nothing', () => {
    const state = initialSurvival(1, 1),
      parka = makeApparel(1, 'parka');
    expect(healthSummary({ ...state, worn: [parka] })).toMatchObject({
      comfortableMin: -20,
      safeMin: -30,
      comfortableMax: 26,
    });
    const naked = { ...state.health },
      dressed = { ...state.health };
    updateHealth(naked, 100, -10, 12);
    updateHealth(dressed, 100, -10, 12, [parka]);
    expect(naked.hypothermia).toBeGreaterThan(0);
    expect(dressed.hypothermia).toBe(0);
    dressed.hypothermia = 0.5;
    updateHealth(dressed, 100, -10, 24, [parka]);
    expect(dressed.hypothermia).toBeLessThan(0.5);
  });
});

describe('cotton and actual tailoring containers', () => {
  it('sows cotton and harvests real non-food cloth with bounded physical output', () => {
    const s = fixture();
    // This isolates the cloth container transaction at the native 100% yield skill.
    // Low-skill failed harvests are covered by the skills integration suite.
    for (const p of s.pawns) p.skills.plants.level = 8;
    command(s, { type: 'designate', tool: 'farm', from: pos(15, 15), crop: 'cotton' });
    until(s, () => s.crops.length === 1);
    expect(s.crops[0].kind).toBe('cotton');
    // Isolated harvest transaction fixture; normal growth campaign advances the full eight-day crop.
    s.crops[0].growth = 1;
    const before = ledger(s);
    until(s, () => s.stats.harvested === 1);
    expect(s.counts().cloth).toBe(10);
    expect(s.counts().grain).toBe(0);
    expect(s.stats.produced.cloth).toBe(10);
    expect(s.items.find((i) => i.resource === 'cloth')).not.toHaveProperty('rotProgress');
    expect(ledger(s)).toEqual(before);
  });
  it('builds a real 3-cell bench, delivers cloth, and produces one independent garment with worker quality', () => {
    const s = fixture(),
      b = bench(s);
    stack(s, 'cloth', 20);
    const before = ledger(s);
    command(s, { type: 'tailorBill', tailorId: b.id, kind: 'tuque', target: 1, paused: false });
    until(s, () => s.stats.tailored === 1);
    const piece = allPieces(s)[0];
    expect(piece).toMatchObject({ kind: 'tuque', hitPoints: 80, wearTicks: 0 });
    expect(Number.isInteger(piece.quality) && piece.quality >= 0 && piece.quality <= 5).toBe(true);
    expect(s.counts().cloth).toBe(0);
    expect(s.stats.consumed.cloth).toBe(20);
    expect(s.stats.produced.apparel).toBe(1);
    expect(ledger(s)).toEqual(before);
    unique(s);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('pauses a partly delivered batch without erasing cloth or creating an unfinished garment', () => {
    const s = fixture(),
      b = bench(s);
    stack(s, 'cloth', 75);
    stack(s, 'cloth', 5, pos(14, 15));
    const before = ledger(s);
    command(s, { type: 'tailorBill', tailorId: b.id, kind: 'parka', target: 1, paused: false });
    until(s, () =>
      s.jobs.some(
        (j) =>
          j.kind === 'tailoring' && (j.delivered.cloth ?? 0) > 0 && (j.delivered.cloth ?? 0) < 80,
      ),
    );
    command(s, { type: 'tailorBill', tailorId: b.id, kind: 'parka', target: 1, paused: true });
    expect(s.counts().cloth).toBe(80);
    expect(s.counts().apparel).toBe(0);
    expect(ledger(s)).toEqual(before);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('counts worn and in-progress instances toward targets and keeps the current batch on target changes', () => {
    const s = fixture(),
      b = bench(s);
    stack(s, 'cloth', 40);
    stack(s, 'food', 10, pos(14, 15));
    command(s, { type: 'tailorBill', tailorId: b.id, kind: 'tuque', target: 2, paused: false });
    until(s, () => s.jobs.some((j) => j.kind === 'tailoring' && j.progress > 0));
    const job = s.jobs.find((j) => j.kind === 'tailoring')!;
    command(s, { type: 'tailorBill', tailorId: b.id, kind: 'tuque', target: 1, paused: false });
    expect(s.jobs.some((j) => j.id === job.id)).toBe(true);
    until(s, () => s.stats.tailored === 1);
    const id = allPieces(s)[0].id;
    command(s, { type: 'wear', pawnId: s.pawns[0].id, apparelId: id });
    until(s, () => s.pawns[0].worn.length === 1);
    s.step(100);
    expect(s.stats.tailored).toBe(1);
    expect(s.counts().cloth).toBe(20);
    unique(s);
  });
  it('keeps completed work and all delivered cloth until an actual output cell becomes available', () => {
    let s = fixture(),
      b = bench(s);
    stack(s, 'cloth', 20);
    command(s, { type: 'tailorBill', tailorId: b.id, kind: 'tuque', target: 1, paused: false });
    until(s, () => s.jobs.some((j) => j.kind === 'tailoring' && j.progress > 0));
    for (let x = 10; x <= 24; x++)
      for (let y = 10; y <= 24; y++)
        if (s.standable(pos(x, y)) && !s.items.some((i) => i.x === x && i.y === y))
          stack(s, 'wood', 75, pos(x, y));
    const before = ledger(s),
      jobId = s.jobs.find((j) => j.kind === 'tailoring')!.id;
    until(s, () => s.jobs.some((j) => j.id === jobId && j.progress === j.work));
    s.step(30);
    expect(s.stats.tailored).toBe(0);
    expect(s.stats.consumed.cloth).toBe(0);
    expect(s.counts().cloth).toBe(20);
    s = VoxelSimulation.load(s.save());
    b = s.tailors[0];
    const item = s.items.find((i) => i.x === 18 && i.y === 19)!;
    s.pawns[1].cargo = portion(item, item.amount);
    s.items = s.items.filter((i) => i.id !== item.id);
    until(s, () => s.stats.tailored === 1);
    expect(allPieces(s)[0].id).toBe(jobId);
    expect(ledger(s)).toEqual(before);
    unique(s);
  });
  it('persists cancelled cloth in its bounded job when refund ground is full, then returns it once', () => {
    let s = fixture(),
      b = bench(s);
    stack(s, 'cloth', 20);
    command(s, { type: 'tailorBill', tailorId: b.id, kind: 'tuque', target: 1, paused: false });
    until(s, () => s.jobs.some((j) => j.kind === 'tailoring' && j.progress > 0));
    for (let x = 10; x <= 24; x++)
      for (let y = 10; y <= 24; y++)
        if (s.standable(pos(x, y)) && !s.items.some((i) => i.x === x && i.y === y))
          stack(s, 'wood', 75, pos(x, y));
    const before = ledger(s);
    command(s, { type: 'tailorBill', tailorId: b.id, kind: 'tuque', target: 1, paused: true });
    expect(
      s.jobs.some((j) => j.kind === 'tailoring' && j.cancelled && j.delivered.cloth === 20),
    ).toBe(true);
    s = VoxelSimulation.load(s.save());
    const item = s.items.find((i) => i.x === 16 && i.y === 18)!;
    s.pawns[1].cargo = portion(item, item.amount);
    s.items = s.items.filter((i) => i.id !== item.id);
    until(s, () => !s.jobs.some((j) => j.kind === 'tailoring'));
    expect(s.items.filter((i) => i.resource === 'cloth').reduce((n, i) => n + i.amount, 0)).toBe(
      20,
    );
    expect(s.stats.produced.apparel).toBe(0);
    expect(ledger(s)).toEqual(before);
    s.step(40);
    expect(ledger(s)).toEqual(before);
  });
});

describe('physical dressing, interruption, death and migration', () => {
  it('walks to clothing, carries one identity, saves mid-dress, and swaps conflicting clothes atomically', () => {
    let s = fixture(),
      p = s.pawns[0];
    const old = makeApparel(s.nextId++, 'parka');
    p.worn = [old];
    const next = garment(s, 'duster'),
      origin = ledger(s);
    command(s, { type: 'wear', pawnId: p.id, apparelId: next.id });
    until(s, () => p.apparelTask?.stage === 'work' && (p.apparelTask?.progress ?? 0) > 5);
    const progress = p.apparelTask!.progress;
    s = VoxelSimulation.load(s.save());
    p = s.pawns[0];
    expect(p.apparelTask?.progress).toBe(progress);
    expect(p.cargo?.apparel?.id).toBe(next.id);
    until(s, () => p.worn.some((a) => a.id === next.id));
    expect(s.items.some((i) => i.apparel?.id === old.id)).toBe(true);
    expect(p.cargo).toBeNull();
    expect(ledger(s)).toEqual(origin);
    unique(s);
  });
  it('retains new cargo on interruption and prevents a second person reserving the same garment', () => {
    const s = fixture(),
      [p, other] = s.pawns,
      a = garment(s, 'tuque'),
      origin = ledger(s);
    command(s, { type: 'wear', pawnId: p.id, apparelId: a.id });
    expect(s.command({ type: 'wear', pawnId: other.id, apparelId: a.id }).ok).toBe(false);
    until(s, () => p.apparelTask?.stage === 'work');
    command(s, { type: 'priority', pawnId: p.id, work: 'craft', value: 0 });
    expect(p.apparelTask).toBeNull();
    expect(p.cargo?.apparel?.id).toBe(a.id);
    expect(p.worn.length).toBe(0);
    expect(ledger(s)).toEqual(origin);
    unique(s);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('holds both garments when replacement has no ground space, including across save/load', () => {
    let s = fixture(),
      p = s.pawns[0];
    p.worn = [makeApparel(s.nextId++, 'parka')];
    const a = garment(s, 'duster'),
      oldId = p.worn[0].id;
    command(s, { type: 'wear', pawnId: p.id, apparelId: a.id });
    until(s, () => p.apparelTask?.stage === 'work');
    for (let x = 10; x <= 24; x++) for (let y = 10; y <= 24; y++) stack(s, 'wood', 75, pos(x, y));
    const before = ledger(s);
    s.step(130);
    expect(p.worn[0].id).toBe(oldId);
    expect(p.cargo?.apparel?.id).toBe(a.id);
    s = VoxelSimulation.load(s.save());
    p = s.pawns[0];
    const item = s.items.find((i) => i.x === p.x && i.y === p.y)!;
    s.pawns[1].cargo = portion(item, item.amount);
    s.items = s.items.filter((i) => i.id !== item.id);
    until(s, () => p.worn.some((piece) => piece.id === a.id));
    expect(s.items.some((i) => i.apparel?.id === oldId)).toBe(true);
    expect(ledger(s)).toEqual(before);
    unique(s);
  });
  it('hauls one stable garment identity across floors and resumes the physical cargo after loading', () => {
    let s = fixture(),
      p = s.pawns[0];
    for (let x = 18; x <= 22; x++)
      for (let y = 18; y <= 21; y++) s.blocks[index(x, y, 10)] = Block.Wood;
    for (let z = 8; z <= 11; z++) s.ladders[index(17, 18, z)] = 1;
    const a = garment(s, 'tuque');
    s = VoxelSimulation.load(s.save());
    p = s.pawns[0];
    command(s, { type: 'designate', tool: 'stock', from: pos(20, 19, 11) });
    command(s, { type: 'storage', from: pos(20, 19, 11), priority: 2, accepts: ['apparel'] });
    command(s, { type: 'priority', pawnId: p.id, work: 'haul', value: 1 });
    const before = ledger(s);
    until(s, () => p.cargo?.apparel?.id === a.id && p.z > 8);
    s = VoxelSimulation.load(s.save());
    p = s.pawns[0];
    expect(p.cargo?.apparel?.id).toBe(a.id);
    until(s, () => s.items.some((i) => i.apparel?.id === a.id && i.z === 11));
    expect(ledger(s)).toEqual(before);
    unique(s);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('drops a removed garment as a real item after the correct delay and allows re-wearing it', () => {
    const s = fixture(),
      p = s.pawns[0],
      piece = makeApparel(s.nextId++, 'shirt');
    p.worn = [piece];
    const before = ledger(s);
    command(s, { type: 'removeApparel', pawnId: p.id, apparelId: piece.id });
    s.step(29);
    expect(p.worn.length).toBe(1);
    s.step();
    expect(p.worn.length).toBe(0);
    expect(s.items[0].apparel?.id).toBe(piece.id);
    command(s, { type: 'wear', pawnId: p.id, apparelId: piece.id });
    until(s, () => p.worn.length === 1);
    expect(ledger(s)).toEqual(before);
    unique(s);
  });
  it('does not drop or destroy worn/cargo clothes when their owner dies', () => {
    const s = fixture(),
      p = s.pawns[0];
    p.worn = [makeApparel(s.nextId++, 'shirt')];
    const a = garment(s, 'tuque');
    command(s, { type: 'wear', pawnId: p.id, apparelId: a.id });
    until(s, () => p.apparelTask?.stage === 'work');
    p.food = 0;
    p.health.malnutrition = 0.99999;
    const origin = ledger(s);
    until(s, () => p.dead, 30);
    expect(p.worn.length).toBe(1);
    expect(p.cargo?.apparel?.id).toBe(a.id);
    expect(ledger(s)).toEqual(origin);
    unique(s);
    const clock = p.apparelWearTicks;
    s.step(30);
    expect(p.apparelWearTicks).toBe(clock);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('counts actual worn time, uses the saved pawn day clock, and records destruction once', () => {
    let s = fixture(),
      p = s.pawns[0],
      piece = makeApparel(s.nextId++, 'tuque');
    p.worn = [piece];
    piece.hitPoints = 1;
    const day = Array.from({ length: 30 }, (_, i) => i + 1).find(
      (day) => apparelWearDamage(s.seed, piece.id, day) === 1,
    )!;
    s.tick = day * DAY - 1;
    s.storyteller = initialStoryteller(s.seed, s.tick);
    s.trade = initialTrade(s.seed, s.tick);
    s.fireHazards = initialFireHazards(s.seed, s.tick);
    s.weather = initialWeather(s.seed, s.settings, s.tick, s.generator);
    p.apparelWearTicks = s.tick;
    const origin = ledger(s);
    s = VoxelSimulation.load(s.save());
    p = s.pawns[0];
    s.step();
    expect(p.worn.length).toBe(0);
    expect(s.stats.destroyed.apparel).toBe(1);
    expect(ledger(s)).toEqual(origin);
    s.step();
    expect(s.stats.destroyed.apparel).toBe(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('migrates the untouched v10 fixture without granting clothes or changing health/resources', () => {
    const raw = readFileSync(new URL('./fixtures/voxel-v10-start.json', import.meta.url));
    expect(createHash('sha256').update(raw).digest('hex')).toBe(
      'ab270a77c6354c5690a1afc76458d8aaff5f4264f9b099f59710447fb1a180f5',
    );
    const old = JSON.parse(raw.toString()),
      s = VoxelSimulation.load(old);
    expect(s.save().version).toBe(29);
    expect(s.items).toEqual(old.items);
    expect(s.pawns.map((p) => p.health)).toEqual(old.pawns.map((p: any) => p.health));
    expect(s.counts().apparel).toBe(0);
    expect(s.pawns.every((p) => p.worn.length === 0)).toBe(true);
  });
  it('rejects duplicated identities, incompatible layers, malformed wearable metadata and invalid reservations', () => {
    const s = fixture(),
      p = s.pawns[0];
    p.worn = [makeApparel(s.nextId++, 'parka')];
    garment(s, 'tuque');
    const valid = s.save();
    const changes = [
      (d: typeof valid) => {
        d.pawns[1].worn = [structuredClone(d.pawns[0].worn[0])];
      },
      (d: typeof valid) => {
        d.pawns[0].worn.push(makeApparel(d.nextId++, 'duster'));
      },
      (d: typeof valid) => {
        d.pawns[0].worn[0].hitPoints = 0;
      },
      (d: typeof valid) => {
        d.pawns[0].worn[0].quality = 8 as any;
      },
      (d: typeof valid) => {
        d.items[0].amount = 2;
      },
      (d: typeof valid) => {
        d.pawns[0].apparelTask = { action: 'wear', stage: 'work', apparelId: 999999, progress: 0 };
        d.pawns[0].phase = 'apparel';
      },
    ];
    for (const change of changes) {
      const d = structuredClone(valid);
      change(d);
      expect(() => VoxelSimulation.load(d)).toThrow();
    }
    expect(() => VoxelSimulation.load(valid)).not.toThrow();
  });
});
