import { describe, expect, it } from 'vitest';
import { expectWildlifeIds } from './legacy-wildlife-defaults';
import { initialSkills } from '../src/voxel/skills';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, index, type Pos, type VoxelCommand } from '../src/voxel/types';
import { applyInjury } from '../src/voxel/injuries';
import { freshBatch } from '../src/voxel/preservation';
import { initialMedical, trackInfectionRisks } from '../src/voxel/medicine';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c);
  expect(r.ok, r.message).toBe(true);
  return r;
}
function until(s: VoxelSimulation, test: () => boolean, max = 5000) {
  for (let n = 0; n < max && !test(); n++) s.step();
  expect(
    test(),
    JSON.stringify({
      tick: s.tick,
      people: s.pawns.map((p) => ({
        id: p.id,
        phase: p.phase,
        reason: p.reason,
        care: p.carePhase,
      })),
    }),
  ).toBe(true);
}
// Controlled finite medical/state-machine scenario, separate from normal-play evidence.
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let x = 10; x <= 30; x++)
    for (let y = 10; y <= 26; y++) {
      s.blocks[index(x, y, 7)] = Block.Soil;
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
    }
  for (let x = 23; x <= 28; x++)
    for (let y = 20; y <= 24; y++) s.blocks[index(x, y, 10)] = Block.Wood;
  for (let z = 8; z <= 11; z++) s.ladders[index(22, 21, z)] = 1;
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11 + i, 12));
    p.schedule.fill('work');
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
  });
  s.beds.push({ ...pos(25, 22, 11), id: s.nextId++, medical: true, owner: null, axis: 'x' });
  return VoxelSimulation.load(s.save());
}
function wound(s: VoxelSimulation, patientIndex = 0) {
  const p = s.pawns[patientIndex];
  applyInjury(p.trauma, s.nextId++, 'torso', 'cut', 9);
  applyInjury(p.trauma, s.nextId++, 'leftArm', 'cut', 5);
  trackInfectionRisks(p, s.seed, p.id, s.tick);
  return p;
}
function herb(s: VoxelSimulation, n = 4, point = pos(28, 20, 11)) {
  const item = { ...point, id: s.nextId++, ...freshBatch('herb', n) };
  s.items.push(item);
  return item;
}

describe('physical medical care, agriculture and v18 migration', () => {
  it('uses soil and each physical chunk in the treatment room, retaining the snapshot after hauling', () => {
    const s = fixture(),
      p = wound(s);
    for (let x = 14; x <= 19; x++)
      for (let y = 14; y <= 19; y++) {
        s.blocks[index(x, y, 10)] = Block.Wood;
        if (x === 14 || x === 19 || y === 14 || y === 19)
          for (let z = 8; z <= 9; z++) s.blocks[index(x, y, z)] = Block.Wood;
      }
    Object.assign(p, pos(16, 16));
    Object.assign(s.pawns[1], pos(17, 16));
    const chunk = { ...pos(18, 18), id: s.nextId++, ...freshBatch('chunk', 1) };
    s.items.push(chunk, { ...pos(17, 18), id: s.nextId++, ...freshBatch('chunk', 1) });
    s.rooms.rebuild(s.blocks, s.doors);
    expect(s.rooms.roomAt(p)).toMatchObject({ outdoor: false, floorCells: 16 });
    command(s, { type: 'medicalPolicy', pawnId: p.id, policy: 'noMedicine' });
    command(s, { type: 'care', pawnId: s.pawns[1].id, patientId: p.id, action: 'tend' });
    until(s, () => p.medical.lastTend !== null);
    expect(p.medical.lastTend!.roomFactor).toBeCloseTo(0.625);
    const risk = p.medical.risks.find((r) => r.woundId === p.medical.lastTend!.recordIds[0])!;
    expect(risk.roomFactor).toBeCloseTo(0.625);
    Object.assign(chunk, pos(12, 12));
    s.step(10);
    expect(risk.roomFactor).toBeCloseTo(0.625);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it.each([false, true])('applies downed rest immunity only in a real bed (bed=%s)', (bed) => {
    const s = fixture(),
      p = s.pawns[0];
    p.medical.policy = 'none';
    p.medical.infections = [
      {
        id: s.nextId++,
        part: 'torso',
        createdTick: 0,
        severity: 0.87,
        immunityFactor: 1,
        tendQuality: null,
        tendUntil: 0,
      },
    ];
    if (bed) Object.assign(p, pos(s.beds[0].x, s.beds[0].y, s.beds[0].z));
    s.step(2);
    expect(p.downed).toBe(true);
    const before = p.medical.immunity;
    s.step();
    expect(p.medical.immunity - before).toBeCloseTo((0.6441 * (bed ? 1.1 * 1.07 : 1)) / DAY, 12);
  });
  it('walking or standing on a bed cell does not grant bed or resting immunity factors', () => {
    const s = fixture(),
      p = s.pawns[0];
    p.medical.policy = 'none';
    p.medical.bedRest = false;
    p.medical.infections = [
      {
        id: s.nextId++,
        part: 'torso',
        createdTick: 0,
        severity: 0.1,
        immunityFactor: 1,
        tendQuality: null,
        tendUntil: 0,
      },
    ];
    Object.assign(p, pos(s.beds[0].x, s.beds[0].y, s.beds[0].z));
    s.step();
    expect(p.medical.immunity).toBeCloseTo(0.6441 / DAY, 12);
  });
  it('fetches a real upper-floor herb, retains age and progress across reload, and uses one for multiple wounds', () => {
    let s = fixture();
    const patientId = wound(s).id,
      doctorId = s.pawns[1].id;
    const supply = herb(s);
    supply.rotProgress = 1234;
    command(s, { type: 'care', pawnId: doctorId, patientId, action: 'tend' });
    expect(s.pawns[1].carePhase).toBe('tendFetch');
    expect(s.pawns[1].careAmount).toBe(1);
    const riskBefore = structuredClone(s.pawns[0].medical);
    s = VoxelSimulation.load(s.save());
    expect(s.pawns[0].medical).toEqual(riskBefore);
    until(s, () => s.pawns[1].cargo?.resource === 'herb');
    expect(s.pawns[1].z).toBe(11);
    expect(s.pawns[1].cargo!.rotProgress).toBeGreaterThan(1234);
    until(s, () => s.pawns[1].careProgress > 50);
    const progress = s.pawns[1].careProgress,
      age = s.pawns[1].cargo!.rotProgress;
    s = VoxelSimulation.load(s.save());
    expect(s.pawns[1].careProgress).toBe(progress);
    expect(s.pawns[1].cargo!.rotProgress).toBe(age);
    until(s, () => s.pawns[0].medical.lastTend !== null);
    expect(s.pawns[0].medical.lastTend!.recordIds).toHaveLength(2);
    expect(s.stats.consumed.herb).toBe(1);
    expect(s.counts().herb).toBe(3);
    expect(s.pawns[0].trauma.wounds).toHaveLength(2);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('changing medical policy during transport cancels treatment without consuming or deleting cargo', () => {
    const s = fixture(),
      patientId = wound(s).id,
      doctorId = s.pawns[1].id;
    herb(s);
    command(s, { type: 'care', pawnId: doctorId, patientId, action: 'tend' });
    until(s, () => s.pawns[1].cargo?.resource === 'herb');
    command(s, { type: 'medicalPolicy', pawnId: patientId, policy: 'none' });
    expect(s.pawns[1].carePhase).toBeNull();
    expect(s.pawns[1].cargo?.amount).toBe(1);
    expect(s.stats.consumed.herb).toBe(0);
    expect(s.counts().herb).toBe(4);
    expect(s.command({ type: 'care', pawnId: doctorId, patientId, action: 'tend' }).ok).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('a second doctor cannot reserve the same patient, and policy noMedicine leaves the real herb untouched', () => {
    const s = fixture(),
      patientId = wound(s).id;
    herb(s);
    command(s, { type: 'medicalPolicy', pawnId: patientId, policy: 'noMedicine' });
    command(s, { type: 'care', pawnId: s.pawns[1].id, patientId, action: 'tend' });
    expect(s.command({ type: 'care', pawnId: s.pawns[2].id, patientId, action: 'tend' }).ok).toBe(
      false,
    );
    until(s, () => s.pawns[0].medical.lastTend !== null);
    expect(s.pawns[0].medical.lastTend!.medicine).toBeNull();
    expect(s.pawns[0].medical.lastTend!.recordIds).toHaveLength(1);
    expect(s.stats.consumed.herb).toBe(0);
    expect(s.counts().herb).toBe(4);
  });
  it('herbs rotting while carried release care and account for spoilage without a free treatment', () => {
    const s = fixture(),
      patientId = wound(s).id;
    herb(s, 1);
    command(s, { type: 'care', pawnId: s.pawns[1].id, patientId, action: 'tend' });
    until(s, () => s.pawns[1].cargo?.resource === 'herb');
    s.pawns[1].cargo!.rotProgress = DAY * 150 - 0.1;
    s.step();
    expect(s.pawns[1].carePhase).toBeNull();
    expect(s.pawns[1].cargo).toBeNull();
    expect(s.stats.spoiled.herb).toBe(1);
    expect(s.stats.consumed.herb).toBe(0);
    expect(s.pawns[0].medical.lastTend).toBeNull();
  });
  it('an infected mobile patient walks upstairs to an actual medical bed and stays despite full rest', () => {
    let s = fixture();
    const p = s.pawns[0];
    p.medical.infections.push({
      id: s.nextId++,
      part: 'torso',
      createdTick: 0,
      severity: 0.1,
      immunityFactor: 1,
      tendQuality: 0.7,
      tendUntil: 7000,
    });
    s = VoxelSimulation.load(s.save());
    until(s, () => s.pawns[0].phase === 'sleepTravel');
    expect(s.pawns[0].sleepBedId).toBe(s.beds[0].id);
    s = VoxelSimulation.load(s.save());
    until(s, () => s.pawns[0].phase === 'rest');
    expect(s.pawns[0].z).toBe(11);
    s.step(40);
    expect(s.pawns[0].phase).toBe('rest');
    expect(s.pawns[0].medical.immunity).toBeGreaterThan(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    command(s, { type: 'medicalRest', pawnId: s.pawns[0].id, enabled: false });
    expect(s.pawns[0].sleepBedId).toBeNull();
  });
  it('sowing healroot requires skill 8, longer real work and preserves work identity when changing crops', () => {
    let s = fixture();
    const plot = pos(17, 16);
    command(s, { type: 'designate', tool: 'farm', from: plot, crop: 'healroot' });
    s.pawns[0].priorities.grow = 1;
    s.step(40);
    expect(s.jobs[0].work).toBe(267);
    expect(s.jobs[0].progress).toBe(0);
    expect(s.jobs[0].reason).toContain('8');
    s.pawns[1].priorities.grow = 1;
    until(s, () => s.jobs.some((j) => j.kind === 'sow' && j.progress > 0));
    s = VoxelSimulation.load(s.save());
    expect(s.jobs[0].cropKind).toBe('healroot');
    command(s, { type: 'designate', tool: 'farm', from: plot, crop: 'rice' });
    s.step(20);
    expect(s.jobs.find((j) => j.kind === 'sow' && !j.cancelled)?.work).toBe(57);
    until(s, () => s.crops.length === 1);
    expect(s.crops[0].kind).toBe('rice');
  });
  it('harvesting mature healroot produces finite perishable medicine rather than food', () => {
    const s = fixture(),
      point = pos(17, 16);
    s.farms.push({ ...point, crop: 'healroot' });
    s.crops.push({ ...point, id: s.nextId++, kind: 'healroot', growth: 1, sownAt: 0 });
    s.pawns[1].priorities.grow = 1;
    s.step(20);
    expect(s.jobs.find((j) => j.kind === 'harvest')!.work).toBe(134);
    until(s, () => s.stats.harvested === 1);
    expect(s.stats.produced.herb).toBe(1);
    expect(s.counts().grain).toBe(0);
    expect(s.items.find((i) => i.resource === 'herb')!.rotProgress).toBeGreaterThanOrEqual(0);
  });
  it.each(['working', 'injured'])(
    'migrates original published v18 %s bytes without rerolling old injuries or granting medicine',
    (name) => {
      const bytes = readFileSync(
        new URL(`./fixtures/voxel-v18-medicine-${name}.json`, import.meta.url),
      );
      const provenance = JSON.parse(
        readFileSync(
          new URL(`./fixtures/voxel-v18-medicine-${name}.provenance.json`, import.meta.url),
          'utf8',
        ),
      );
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
      const old = JSON.parse(bytes.toString()),
        save = VoxelSimulation.load(old).save();
      expect(old.version).toBe(18);
      expect(save.version).toBe(22);
      expect(save.items).toEqual(old.items);
      expect(save.research).toEqual(old.research);
      expectWildlifeIds(old.nextId, save);
      expect(save.tick).toBe(old.tick);
      for (const [i, p] of save.pawns.entries()) {
        expect(p.trauma).toEqual(old.pawns[i].trauma);
        expect(p.skills).toEqual({ ...old.pawns[i].skills, social: initialSkills(i, p.faction !== 'colony').social });
        expect(p.medical.infections).toEqual([]);
        expect(p.medical.immunity).toBe(0);
        expect(p.medical.risks.every((r) => r.state === 'legacy')).toBe(true);
      }
      for (const key of ['produced', 'consumed', 'spoiled', 'destroyed'] as const)
        expect(save.stats[key]).toEqual({ ...old.stats[key], herb: 0, silver: 0, meat: 0, carcass: 0 });
      const contaminated = structuredClone(old);
      contaminated.pawns[0].medical = initialMedical();
      expect(() => VoxelSimulation.load(contaminated)).toThrow('旧存档');
      const injured = save.pawns.find((p) => p.trauma.wounds.length);
      if (injured) {
        injured.medical.risks = [];
        expect(() => VoxelSimulation.load(save)).toThrow('检查记录缺失');
      }
    },
  );
  it('rejects duplicated infection identity, impossible reservations and changed saved factors', () => {
    const s = fixture(),
      save = s.save();
    save.pawns[0].medical.infections = [
      {
        id: save.pawns[1].id,
        part: 'torso',
        createdTick: 0,
        severity: 0.1,
        immunityFactor: 1,
        tendQuality: null,
        tendUntil: 0,
      },
    ];
    expect(() => VoxelSimulation.load(save)).toThrow('身份');
    const invalid = s.save();
    invalid.pawns[0].careMedicineId = 999999;
    expect(() => VoxelSimulation.load(invalid)).toThrow();
    save.pawns[0].medical.infections[0].immunityFactor = 3;
    expect(() => VoxelSimulation.load(save)).toThrow('免疫因子');
  });
});
