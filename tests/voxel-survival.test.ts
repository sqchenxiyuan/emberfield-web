import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import {
  Block,
  DAY,
  index,
  type Pawn,
  type Pos,
  type Resource,
  type VoxelCommand,
} from '../src/voxel/types';
import {
  initialSurvival,
  updateHealth,
  healthSummary,
  heatOverage,
  hungerMultiplier,
  FEED_WORK,
} from '../src/voxel/survival';
import { freshBatch } from '../src/voxel/preservation';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c);
  expect(result.ok, result.message).toBe(true);
  return result;
}
function until(s: VoxelSimulation, done: () => boolean, max = 4000) {
  for (let i = 0; i < max && !done(); i++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, pawns: s.pawns })).toBe(true);
}
function down(p: Pawn, severity = 0.82) {
  p.health.malnutrition = severity;
  p.food = 0;
  p.downed = true;
  p.phase = 'downed';
}
/** Bounded state-machine fixture, independent from the normal-command campaign. */
function fixture(upper = false) {
  const s = new VoxelSimulation(73129, {
    biome: 'temperate',
    hilliness: 'flat',
    meanTemperature: 24,
    latitude: 0,
    rainfall: 1100,
  });
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.treePlots = [];
  s.items = [];
  s.stockpiles = [];
  for (let y = 10; y <= 24; y++)
    for (let x = 10; x <= 24; x++)
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i));
    p.priorities = {
      dig: 0,
      cut: 0,
      build: 0,
      haul: 0,
      grow: 0,
      cook: 0,
      craft: 0,
      care: 0,
      research: 0,
    };
    p.schedule.fill('work');
  });
  if (upper) {
    for (let x = 18; x <= 22; x++)
      for (let y = 18; y <= 21; y++) s.blocks[index(x, y, 10)] = Block.Wood;
    for (let z = 8; z <= 11; z++) s.ladders[index(17, 18, z)] = 1;
  }
  s.beds.push({
    ...pos(20, 19, upper ? 11 : 8),
    id: s.nextId++,
    axis: 'x',
    owner: null,
    medical: true,
  });
  return VoxelSimulation.load(s.save());
}
function food(s: VoxelSimulation, resource: Resource, amount: number, p = pos(15, 15)) {
  const item = { ...p, ...freshBatch(resource, amount), id: s.nextId++ };
  s.items.push(item);
  return item;
}
function ledger(s: VoxelSimulation) {
  const counts = s.counts();
  return Object.fromEntries(
    (Object.keys(counts) as Resource[]).map((r) => [
      r,
      counts[r] + s.stats.consumed[r] + s.stats.spoiled[r] - s.stats.produced[r],
    ]),
  );
}

describe('voxel health source contract', () => {
  it('uses source game-day intervals, fixed personal rate, and positive-food recovery', () => {
    const h = initialSurvival(1, 1).health;
    h.starvationFactor = 1;
    for (let t = 1; t <= DAY; t++) updateHealth(h, 0, 20, t);
    expect(h.malnutrition).toBeCloseTo(0.453, 10);
    for (let t = DAY + 1; t <= DAY * 2; t++) updateHealth(h, 1, 20, t);
    expect(h.malnutrition).toBeCloseTo(0, 10);
    expect(hungerMultiplier({ ...h, malnutrition: 0.1 })).toBe(1.5);
    expect(hungerMultiplier({ ...h, malnutrition: 0.2 })).toBe(1.6);
  });
  it('keeps thermal stagnation bands and strict recovery boundaries', () => {
    const h = { ...initialSurvival(1, 1).health, hypothermia: 0.2, heatstroke: 0.2 };
    updateHealth(h, 100, 16, 12);
    expect(h.hypothermia).toBe(0.2);
    updateHealth(h, 100, 26, 24);
    expect(h.heatstroke).toBeCloseTo(0.1946);
    const cold = h.hypothermia;
    updateHealth(h, 100, 6, 36);
    expect(h.hypothermia).toBe(cold);
    updateHealth(h, 100, 5, 48);
    expect(h.hypothermia - cold).toBeCloseTo(0.00075);
    expect(heatOverage(37.5)).toBe(32.5);
    expect(heatOverage(10000)).toBe(1000);
  });
  it('combines pain and consciousness before moving/manipulation; severe disease incapacitates', () => {
    const p = { ...initialSurvival(1, 1) };
    p.health.hypothermia = 0.35;
    expect(healthSummary(p)).toMatchObject({
      consciousness: 0.78,
      moving: 0.48,
      manipulation: 0.28,
      pain: 0.15,
    });
    p.health.hypothermia = 0;
    p.health.heatstroke = 0.35;
    expect(healthSummary(p)).toMatchObject({
      consciousness: 0.78,
      moving: 0.48,
      manipulation: 0.78,
    });
    p.health.malnutrition = 0.8;
    expect(healthSummary(p)).toMatchObject({ consciousness: 0.1, moving: 0, manipulation: 0 });
  });
});

describe('voxel incapacitation and physical care', () => {
  it('zero food begins malnutrition without instant death; downed people cannot move/work/self-feed', () => {
    const s = fixture(),
      p = s.pawns[0];
    down(p);
    food(s, 'food', 3, p);
    const origin = ledger(s),
      start = p.health.malnutrition;
    expect(s.command({ type: 'move', pawnId: p.id, target: pos(12, 11) }).ok).toBe(false);
    expect(s.command({ type: 'rest', pawnId: p.id }).ok).toBe(false);
    s.step(200);
    expect(p.food).toBe(0);
    expect(p.dead).toBe(false);
    expect(p.health.malnutrition).toBeGreaterThan(start);
    expect(p).toMatchObject({ x: 11, y: 11, phase: 'downed', jobId: null });
    expect(ledger(s)).toEqual(origin);
  });
  it('walks to a patient, carries across a ladder, resumes after load, and delivers to the medical bed', () => {
    let s = fixture(true),
      doctor = s.pawns[0],
      patient = s.pawns[1];
    down(patient);
    patient.cargo = freshBatch('wood', 3);
    const origin = ledger(s);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'rescue' });
    until(s, () => doctor.carePhase === 'rescueCarry' && doctor.z > 8);
    expect(patient.carriedBy).toBe(doctor.id);
    expect(patient.z).toBe(doctor.z);
    const saved = s.save();
    s = VoxelSimulation.load(saved);
    [doctor, patient] = s.pawns;
    expect(doctor.carePhase).toBe('rescueCarry');
    expect(patient.carriedBy).toBe(doctor.id);
    until(s, () => patient.sleepBedId === s.beds[0].id);
    expect(patient).toMatchObject({
      x: 20,
      y: 19,
      z: 11,
      downed: true,
      phase: 'downed',
      carriedBy: null,
    });
    expect(doctor.carryingPawnId).toBeNull();
    expect(patient.cargo?.amount).toBe(3);
    expect(ledger(s)).toEqual(origin);
  });
  it('releases a carried patient safely on explicit interruption with both inventories intact', () => {
    const s = fixture(true),
      [doctor, patient] = s.pawns;
    down(patient);
    patient.cargo = freshBatch('steel', 2);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'rescue' });
    until(s, () => doctor.carePhase === 'rescueCarry');
    const origin = ledger(s);
    command(s, { type: 'priority', pawnId: doctor.id, work: 'care', value: 0 });
    expect(patient.carriedBy).toBeNull();
    expect(doctor.carryingPawnId).toBeNull();
    expect(patient).toMatchObject({ x: doctor.x, y: doctor.y, z: doctor.z, phase: 'downed' });
    expect(s.standable(patient)).toBe(true);
    expect(ledger(s)).toEqual(origin);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('requires a real bed and food; reserves once and preserves food and progress through load/interruption', () => {
    let s = fixture(),
      [doctor, patient, other] = s.pawns;
    down(patient);
    food(s, 'meal', 1);
    expect(
      s.command({ type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' }).ok,
    ).toBe(false);
    Object.assign(patient, pos(s.beds[0].x, s.beds[0].y));
    patient.sleepBedId = s.beds[0].id;
    const origin = ledger(s);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    expect(
      s.command({ type: 'care', pawnId: other.id, patientId: patient.id, action: 'feed' }).ok,
    ).toBe(false);
    until(s, () => doctor.carePhase === 'feed' && doctor.careProgress > 20);
    expect(patient.food).toBe(0);
    expect(doctor.cargo?.amount).toBe(1);
    const progress = doctor.careProgress;
    s = VoxelSimulation.load(s.save());
    [doctor, patient, other] = s.pawns;
    expect(doctor.careProgress).toBe(progress);
    expect(doctor.carePhase).toBe('feed');
    command(s, { type: 'priority', pawnId: doctor.id, work: 'care', value: 0 });
    expect(doctor.cargo?.amount).toBe(1);
    expect(patient.food).toBe(0);
    expect(ledger(s)).toEqual(origin);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    until(s, () => s.stats.consumed.meal === 1);
    expect(patient.food).toBeCloseTo(90);
    expect(patient.health.malnutrition).toBeGreaterThan(0.8);
    expect(doctor.cargo).toBeNull();
    expect(ledger(s)).toEqual(origin);
    until(s, () => !patient.downed, 2000);
    expect(patient.dead).toBe(false);
    expect(patient.phase).not.toBe('downed');
  });
  it('protects the reserved food quantity from another hungry pawn', () => {
    const s = fixture(),
      [doctor, patient, other] = s.pawns;
    down(patient);
    Object.assign(patient, pos(s.beds[0].x, s.beds[0].y));
    patient.sleepBedId = s.beds[0].id;
    const item = food(s, 'food', 1, pos(20, 12));
    Object.assign(other, pos(20, 12));
    other.food = 10;
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    expect(doctor.careFoodId).toBe(item.id);
    s.step(20);
    expect(s.stats.consumed.food).toBe(0);
    expect(other.food).toBeLessThan(10);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    until(s, () => s.stats.consumed.food === 1);
    expect(patient.food).toBeCloseTo(90);
  });
  it('retains cargo when full local ground prevents unloading for rescue', () => {
    const s = fixture(),
      [doctor, patient] = s.pawns;
    down(patient);
    doctor.cargo = freshBatch('steel', 1);
    for (let y = 10; y <= 24; y++) for (let x = 10; x <= 24; x++) food(s, 'wood', 75, pos(x, y));
    const origin = ledger(s);
    expect(
      s.command({ type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'rescue' }).ok,
    ).toBe(false);
    expect(doctor.cargo).toEqual(freshBatch('steel', 1));
    expect(ledger(s)).toEqual(origin);
  });
  it('interrupts rescue when its medical bed changes and preserves the carried patient', () => {
    const s = fixture(),
      [doctor, patient] = s.pawns;
    down(patient);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'rescue' });
    until(s, () => doctor.carePhase === 'rescueCarry');
    command(s, { type: 'bedMedical', bedId: s.beds[0].id, medical: false });
    expect(patient.carriedBy).toBeNull();
    expect(doctor.patientId).toBeNull();
    expect(s.standable(patient)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('ends a rescue on patient death without losing the body or its carried items', () => {
    const s = fixture(true),
      [doctor, patient] = s.pawns;
    down(patient);
    patient.cargo = freshBatch('components', 2);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'rescue' });
    until(s, () => doctor.carePhase === 'rescueCarry');
    patient.health.malnutrition = 0.9999;
    const origin = ledger(s);
    until(s, () => patient.dead, 30);
    expect(doctor.patientId).toBeNull();
    expect(patient.carriedBy).toBeNull();
    expect(patient.cargo?.amount).toBe(2);
    expect(s.standable(patient)).toBe(true);
    expect(ledger(s)).toEqual(origin);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('sets the patient down when the carrier collapses, preserving both state machines', () => {
    const s = fixture(true),
      [doctor, patient] = s.pawns;
    down(patient);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'rescue' });
    until(s, () => doctor.carePhase === 'rescueCarry');
    doctor.health.malnutrition = 0.79999;
    doctor.food = 0;
    until(s, () => doctor.downed, 30);
    expect(patient.carriedBy).toBeNull();
    expect(doctor.carryingPawnId).toBeNull();
    expect(patient).toMatchObject({ x: doctor.x, y: doctor.y, z: doctor.z, phase: 'downed' });
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('retains a feeding cargo if the route becomes impassable', () => {
    const s = fixture(),
      [doctor, patient] = s.pawns;
    down(patient);
    Object.assign(patient, pos(s.beds[0].x, s.beds[0].y));
    patient.sleepBedId = s.beds[0].id;
    food(s, 'food', 1);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    until(s, () => doctor.carePhase === 'feedApproach');
    const origin = ledger(s),
      next = doctor.path[0];
    s.blocks[next] = Block.Wood;
    until(s, () => doctor.carePhase === null, 10);
    expect(doctor.cargo?.amount).toBe(1);
    expect(patient.food).toBe(0);
    expect(ledger(s)).toEqual(origin);
  });
  it('does not advance physiology when paused commands edit storage', () => {
    const s = fixture(),
      p = s.pawns[0];
    p.food = 0;
    command(s, { type: 'designate', tool: 'stock', from: pos(15, 15) });
    const health = structuredClone(p.health);
    for (let i = 0; i < 5; i++)
      command(s, { type: 'storage', from: pos(15, 15), priority: 1, accepts: ['food'] });
    expect(s.tick).toBe(0);
    expect(p.health).toEqual(health);
  });
  it('freezes death permanently, retains corpse cargo and prevents sleeping on its bed', () => {
    let s = fixture(),
      [doctor, patient] = s.pawns;
    down(patient, 0.9999);
    patient.cargo = freshBatch('steel', 3);
    const bed = s.beds[0];
    bed.medical = false;
    bed.owner = patient.id;
    Object.assign(patient, pos(bed.x, bed.y));
    patient.sleepBedId = bed.id;
    const origin = ledger(s);
    s.step(30);
    expect(patient.dead).toBe(true);
    expect(patient.deathReason).toBe('营养不良致死');
    expect(patient.phase).toBe('dead');
    expect(bed.owner).toBeNull();
    expect(
      s.command({ type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'rescue' }).ok,
    ).toBe(false);
    s = VoxelSimulation.load(s.save());
    [doctor, patient] = s.pawns;
    const health = structuredClone(patient.health);
    doctor.rest = 20;
    command(s, { type: 'rest', pawnId: doctor.id });
    expect(doctor.sleepBedId).toBeNull();
    s.step(1000);
    expect(patient.health).toEqual(health);
    expect(patient.cargo?.amount).toBe(3);
    expect(patient.dead).toBe(true);
    expect(ledger(s)).toEqual(origin);
  });
  it('loads the untouched v9 fixture as healthy with no extra materials or permanent immunity', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v9-start.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '662e24d8e4e87cf193cd74fac196e15e3ede787f5fcff29dfdc15ae1c687a0a7',
    );
    const old = JSON.parse(bytes.toString()),
      s = VoxelSimulation.load(old);
    expect(s.save().version).toBe(19);
    expect(s.items).toEqual(old.items);
    expect(
      s.pawns.every(
        (p) => !p.dead && !p.downed && p.health.malnutrition === 0 && p.priorities.care === 1,
      ),
    ).toBe(true);
    s.pawns[0].food = 0;
    s.items = [];
    s.step(30);
    expect(s.pawns[0].health.malnutrition).toBeGreaterThan(0);
  });
  it('rejects forged health, dead revival, reservations and carry relationships', () => {
    const s = fixture(),
      [doctor, patient] = s.pawns;
    down(patient);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'rescue' });
    until(s, () => doctor.carePhase === 'rescueCarry');
    const valid = s.save();
    const mutations = [
      (d: typeof valid) => {
        d.pawns[1].health.starvationFactor = 0;
      },
      (d: typeof valid) => {
        d.pawns[1].health.malnutrition = NaN;
      },
      (d: typeof valid) => {
        d.pawns[1].health.malnutrition = 1;
      },
      (d: typeof valid) => {
        d.pawns[1].downed = false;
      },
      (d: typeof valid) => {
        d.pawns[1].carriedBy = null;
      },
      (d: typeof valid) => {
        d.pawns[0].carryingPawnId = null;
      },
      (d: typeof valid) => {
        d.pawns[0].careBedId = 12345;
      },
      (d: typeof valid) => {
        d.pawns[0].careFoodId = 12345;
      },
      (d: typeof valid) => {
        d.pawns[0].careProgress = FEED_WORK;
      },
      (d: typeof valid) => {
        d.pawns[1].path = [0];
      },
    ];
    for (const mutate of mutations) {
      const d = structuredClone(valid);
      mutate(d);
      expect(() => VoxelSimulation.load(d)).toThrow();
    }
    expect(() => VoxelSimulation.load(valid)).not.toThrow();
  });
});
