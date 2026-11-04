import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { at, Block, index, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { freshBatch, mergeBatch, portion } from '../src/voxel/preservation';
import { healthSummary } from '../src/voxel/survival';
import { applyInjury } from '../src/voxel/injuries';
import { relocationExpectedField } from './legacy-relocation-defaults';

const point = (x: number, y = 14): Pos => ({ x, y, z: 8 });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c); expect(r.ok, r.message).toBe(true); return r;
}
function until(s: VoxelSimulation, done: () => boolean, max = 3000) {
  for (let i = 0; i < max && !done(); i++) s.step();
  expect(done(), JSON.stringify(s.pawns.map(p => ({ id: p.id, phase: p.phase, reason: p.reason,
    cleanTask: p.cleanTask, food: p.food, foodPoisoning: p.foodPoisoning })))).toBe(true);
}
/** Deliberately controlled integration fixtures: rooms, dirt and poisoned food
 * are injected to isolate failure paths. Ordinary production/illness is proven
 * separately by voxel-sanitation-campaign-verify.mjs and its saved provenance. */
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  s.animals = []; s.trees = []; s.items = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 25; x++) for (let y = 10; y <= 20; y++)
    for (let z = 8; z <= 9; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = point(11, 11); s.homeArea.clear();
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, point(11 + i)); p.schedule.fill('work'); p.food = 90; p.rest = 100;
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof Pawn['priorities']] = 0;
  }
  command(s, { type: 'threats', enabled: false });
  return VoxelSimulation.load(s.save());
}
function stain(s: VoxelSimulation, amount = 3, position = point(19, 17)) {
  const f = { ...position, id: s.nextId++, kind: 'blood' as const, amount, createdTick: s.tick };
  s.filth.push(f); return f;
}
function stock(s: VoxelSimulation, resource: 'meal' | 'food', amount: number, poisonChance = 0) {
  while (amount > 0) {
    const count = Math.min(10, amount);
    s.items.push({ ...freshBatch(resource, count), ...point(15 + s.items.length), id: s.nextId++,
      ...(resource === 'meal' ? { poisonChance } : {}) });
    amount -= count;
  }
}

describe('sanitation integration and interrupted physical actions', () => {
  it('loads the genuine v24 bytes without inventing filth, illness, resources or cooked food', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v24-sanitation-initial.json', import.meta.url));
    const provenance = JSON.parse(readFileSync(new URL('./fixtures/voxel-v24-sanitation-initial.provenance.json', import.meta.url), 'utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
    const old = JSON.parse(bytes.toString()), s = VoxelSimulation.load(old);
    expect(old.version).toBe(24); expect(s.save().version).toBe(57);
    expect(s.filth).toEqual([]); expect(s.items).toEqual(old.items);
    expect(s.pawns.map(p => p.id)).toEqual(old.pawns.map((p: Pawn) => p.id));
    expect(s.pawns.every(p => p.foodPoisoning === null && p.cleanTask === null)).toBe(true);
    expect(s.stats).toEqual(relocationExpectedField('stats', old.stats)); expect(s.tick).toBe(old.tick);
  });

  it('requires home area even for a forced clean and actually walks before clearing a layer', () => {
    const s = fixture(), f = stain(s), p = s.pawns[0];
    command(s, { type: 'priority', pawnId: p.id, work: 'clean', value: 1 }); s.step(200);
    expect(p.cleanTask).toBeNull(); expect(f.amount).toBe(3);
    expect(s.command({ type: 'clean', pawnId: p.id, filthId: f.id }).ok).toBe(false);
    command(s, { type: 'homeArea', from: point(10, 10), to: point(25, 20), enabled: true });
    command(s, { type: 'clean', pawnId: p.id, filthId: f.id });
    expect(f.amount).toBe(3); expect(p.path.length).toBeGreaterThan(0);
    until(s, () => (p.cleanTask?.progress ?? 0) > 0);
    expect(Math.abs(p.x - f.x) + Math.abs(p.y - f.y) + Math.abs(p.z - f.z)).toBeLessThanOrEqual(1);
    expect(f.amount).toBe(3);
    until(s, () => f.amount < 3 || !s.filth.some(q => q.id === f.id));
    expect(s.cleanlinessAt(f)).toBeLessThanOrEqual(0);
  });

  it('walking carries soil onto actual wooden flooring and a bleeding wound leaves a separate stain', () => {
    let s = fixture();
    for (let x = 11; x <= 12; x++) s.blocks[index(x, 14, 7)] = Block.Soil;
    for (let x = 13; x <= 19; x++) s.blocks[index(x, 14, 7)] = Block.Wood;
    s = VoxelSimulation.load(s.save()); const p = s.pawns[0];
    command(s, { type: 'draft', pawnId: p.id, drafted: true });
    command(s, { type: 'move', pawnId: p.id, target: point(19) });
    until(s, () => at(p) === at(point(19)));
    expect(s.filth.some(f => f.kind === 'dirt')).toBe(true);
    expect(s.filth.filter(f => f.kind === 'dirt').every(f => s.blocks[index(f.x, f.y, f.z - 1)] === Block.Wood)).toBe(true);
    applyInjury(p.trauma, s.nextId++, 'torso', 'cut', 8);
    until(s, () => s.filth.some(f => f.kind === 'blood'), 400);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('reserves a stain exclusively and releases it immediately on drafting, including paused save/load', () => {
    let s = fixture(); const f = stain(s, 6); s.step(200);
    command(s, { type: 'homeArea', from: f, enabled: true });
    const [a, b] = s.pawns.map(p => p.id);
    command(s, { type: 'clean', pawnId: a, filthId: f.id });
    expect(s.command({ type: 'clean', pawnId: b, filthId: f.id }).ok).toBe(false);
    until(s, () => (s.pawns.find(p => p.id === a)?.cleanTask?.progress ?? 0) > 0);
    const progress = s.pawns.find(p => p.id === a)!.cleanTask!.progress;
    s = VoxelSimulation.load(s.save()); expect(s.pawns.find(p => p.id === a)!.cleanTask!.progress).toBe(progress);
    command(s, { type: 'draft', pawnId: a, drafted: true });
    expect(s.pawns.find(p => p.id === a)!.cleanTask).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    command(s, { type: 'clean', pawnId: b, filthId: f.id });
    expect(s.pawns.filter(p => p.cleanTask?.filthId === f.id)).toHaveLength(1);
  });

  it('removing the home cell cancels a current cleaning task without a ghost reservation', () => {
    const s = fixture(), f = stain(s); s.step(200);
    command(s, { type: 'homeArea', from: f, enabled: true });
    command(s, { type: 'clean', pawnId: s.pawns[0].id, filthId: f.id });
    command(s, { type: 'homeArea', from: f, enabled: false });
    expect(s.pawns[0].cleanTask).toBeNull();
    expect(s.filth.find(q => q.id === f.id)?.amount).toBe(3);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('keeps contamination mass through split, partial merge and load then actually poisons an eater', () => {
    const s = fixture(), p = s.pawns[0]; p.food = 10;
    const poisoned = { ...freshBatch('meal', 4), poisonChance: 1 };
    const clean = freshBatch('meal', 6); mergeBatch(clean, portion(poisoned, 2));
    expect(clean.amount).toBe(8); expect(clean.poisonChance).toBe(.25);
    expect(portion(clean, 3).poisonChance).toBe(.25);
    stock(s, 'meal', 1, 1); stock(s, 'food', 30);
    const restored = VoxelSimulation.load(s.save()), patient = restored.pawns.find(q => q.id === p.id)!;
    const before = healthSummary(patient).moving;
    until(restored, () => patient.foodPoisoning !== null);
    expect(restored.stats.consumed.meal).toBe(1); expect(restored.counts().meal).toBe(0);
    expect(patient.food).toBeGreaterThan(80); expect(healthSummary(patient).moving).toBeLessThan(before);
    const illness = structuredClone(patient.foodPoisoning);
    const loaded = VoxelSimulation.load(restored.save());
    expect(loaded.pawns.find(q => q.id === p.id)!.foodPoisoning).toEqual(illness);
  });

  it('poisoned physical food delivered by a caregiver reaches the patient, not the caregiver', () => {
    const s = fixture(), patient = s.pawns[0], doctor = s.pawns[1];
    patient.food = 10; patient.health.malnutrition = .9;
    s.beds.push({ ...point(19, 17), id: s.nextId++, axis: 'x', owner: null, quality: 2 as const, medical: true, prisoner: false });
    Object.assign(patient, point(19, 17)); stock(s, 'meal', 1, 1); s.step();
    expect(patient.downed).toBe(true);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'feed' });
    until(s, () => doctor.cargo?.resource === 'meal');
    expect(doctor.cargo?.poisonChance).toBe(1); expect(patient.foodPoisoning).toBeNull();
    const loaded = VoxelSimulation.load(s.save()), q = loaded.pawns.find(p => p.id === patient.id)!;
    until(loaded, () => q.foodPoisoning !== null);
    expect(loaded.pawns.find(p => p.id === doctor.id)!.foodPoisoning).toBeNull();
    expect(loaded.stats.consumed.meal).toBe(1);
  });

  it('vomiting produces physical filth and recovery retains its deadline across save/load', () => {
    let s = fixture(); const id = s.pawns[0].id; s.pawns[0].food = 10;
    stock(s, 'meal', 1, 1); stock(s, 'food', 30);
    until(s, () => s.pawns[0].foodPoisoning !== null);
    const illness = structuredClone(s.pawns[0].foodPoisoning!);
    until(s, () => s.filth.some(f => f.kind === 'vomit'), illness.nextVomitTick - s.tick + 10);
    expect(s.filth.some(f => f.kind === 'vomit' && at(f) === at(s.pawns[0]))).toBe(true);
    s = VoxelSimulation.load(s.save());
    expect(s.pawns.find(p => p.id === id)!.foodPoisoning!.endsTick).toBe(illness.endsTick);
    until(s, () => s.pawns.find(p => p.id === id)!.foodPoisoning === null, illness.endsTick - s.tick + 10);
    expect(s.pawns.find(p => p.id === id)!.dead).toBe(false);
    expect(healthSummary(s.pawns.find(p => p.id === id)!).moving).toBe(1);
  });

  it('rejects nonphysical dirt, duplicate ownership, invalid meal poison and illness timeline in saves', () => {
    const s = fixture(), f = stain(s); s.step(200);
    command(s, { type: 'homeArea', from: f, enabled: true });
    command(s, { type: 'clean', pawnId: s.pawns[0].id, filthId: f.id });
    const malformed = s.save(); malformed.filth[0].z = 0;
    expect(() => VoxelSimulation.load(malformed)).toThrow();
    const duplicate = s.save(); duplicate.pawns[1].cleanTask = structuredClone(duplicate.pawns[0].cleanTask);
    expect(() => VoxelSimulation.load(duplicate)).toThrow();
    stock(s, 'meal', 1, 1); const badBatch = s.save(); badBatch.items[0].poisonChance = 1.1;
    expect(() => VoxelSimulation.load(badBatch)).toThrow();
    const badIllness = s.save(); badIllness.pawns[0].foodPoisoning = { startedTick: s.tick + 1, endsTick: s.tick + 2, nextVomitTick: s.tick + 3, stage: 'initial' };
    expect(() => VoxelSimulation.load(badIllness)).toThrow();
  });
});
