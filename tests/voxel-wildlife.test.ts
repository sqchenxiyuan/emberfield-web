import { initialAnimalState } from '../src/voxel/husbandry';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { makeWeapon } from '../src/voxel/weapons';
import { freshBatch } from '../src/voxel/preservation';
import { colonyWealthDetails, cargoMarketValue } from '../src/voxel/wealth';
import { Block, DAY, at, index, type Cargo, type Pos, type VoxelCommand, type WildAnimal } from '../src/voxel/types';

const pos = (x: number, y = 16): Pos => ({ x, y, z: 8 });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c); expect(r.ok, r.message).toBe(true);
}
function until(s: VoxelSimulation, condition: () => boolean, limit = 3000) {
  for (let t = 0; t < limit && !condition(); t++) s.step();
  expect(condition(), JSON.stringify({ tick: s.tick, animals: s.animals, jobs: s.jobs,
    pawns: s.pawns.map(p => [p.reason, p.phase, p.cargo]), stats: s.stats })).toBe(true);
}
// Controlled geometry and starting inputs isolate mechanism boundaries. All tasks use public commands.
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  s.animals = []; s.trees = []; s.items = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 8; x <= 40; x++) for (let y = 8; y <= 30; y++)
    for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(12, 16 + i)); p.schedule.fill('work');
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
  }
  return VoxelSimulation.load(s.save());
}
function add(s: VoxelSimulation, batch: Cargo, p: Pos = pos(14)) {
  s.items.push({ ...batch, ...p, id: s.nextId++ });
}
function carcass(s: VoxelSimulation): Cargo {
  return { resource: 'carcass', amount: 1, carcass: { animalId: s.nextId++, species: 'deer' }, rotProgress: 120 };
}
function animal(s: VoxelSimulation): WildAnimal {
  const a: WildAnimal = { ...pos(22), ...initialAnimalState(s.nextId, 'hare', s.tick), id: s.nextId++, species: 'hare', name: '野兔', health: ANIMAL_DEFS.hare.health,
    hunger: 80, dead: false, phase: 'roam', hunt: false, moveTick: 0, decisionTick: 0,
    fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0 };
  s.animals.push(a); return a;
}

describe('wildlife, actual hunting and physical food chain', () => {
  it('keeps moving after repeated decisions and resumes the same ecological state after save/load', () => {
    const s = new VoxelSimulation(73129), before = s.animals.map(a => at(a));
    s.step(800); const middle = s.animals.map(a => at(a));
    expect(middle).not.toEqual(before);
    const restored = VoxelSimulation.load(s.save());
    s.step(800); restored.step(800);
    expect(s.animals.map(a => at(a))).not.toEqual(middle);
    expect(restored.animals).toEqual(s.animals);
  });
  it('shoots real projectiles, flees after damage and leaves one identified carcass', () => {
    let s = fixture(); const a = animal(s), hunter = s.pawns[0];
    hunter.weapon = makeWeapon(s.nextId++, 'shortBow'); hunter.skills.shooting.level = 20; hunter.priorities.hunt = 1;
    command(s, { type: 'hunt', animalId: a.id, enabled: true });
    until(s, () => s.pawns[0].shooting !== null);
    const aim = structuredClone(s.pawns[0].shooting);
    s = VoxelSimulation.load(s.save()); expect(s.pawns[0].shooting).toEqual(aim);
    until(s, () => s.stats.produced.carcass === 1, 8000);
    expect(s.combatEvents.some(e => e.kind === 'fire' && e.targetId === a.id)).toBe(true);
    expect(s.combatEvents.some(e => e.kind === 'hit' && e.targetId === a.id)).toBe(true);
    expect(s.items.filter(i => i.carcass?.animalId === a.id)).toHaveLength(1);
    expect(s.counts().carcass).toBe(1);
    expect(VoxelSimulation.load(s.save()).counts()).toEqual(s.counts());
  });
  it('cancels hunting before launch and releases the hunter for other work', () => {
    const s = fixture(), a = animal(s), p = s.pawns[0];
    p.weapon = makeWeapon(s.nextId++, 'shortBow'); p.priorities.hunt = 1;
    command(s, { type: 'hunt', animalId: a.id, enabled: true });
    until(s, () => !!p.shooting);
    command(s, { type: 'hunt', animalId: a.id, enabled: false }); s.step(150);
    expect(p.attackTargetId).toBeNull(); expect(p.shooting).toBeNull();
    expect(s.projectiles).toEqual([]); expect(a.health).toBe(ANIMAL_DEFS.hare.health);
  });
  it('waits for an unreachable animal and resumes after another worker opens the wall', () => {
    let s = fixture(); const a = animal(s), hunterId = s.pawns[0].id;
    s.pawns[0].weapon = makeWeapon(s.nextId++, 'shortBow');
    s.pawns[0].skills.shooting.level = 20; s.pawns[0].priorities.hunt = 1;
    for (let x = 21; x <= 23; x++) for (let y = 15; y <= 17; y++)
      if (x !== 22 || y !== 16) for (const z of [8, 9, 10]) s.blocks[index(x, y, z)] = Block.Stone;
    s.blocks[index(22, 16, 10)] = Block.Stone;
    s = VoxelSimulation.load(s.save());
    command(s, { type: 'hunt', animalId: a.id, enabled: true }); s.step(240);
    expect(s.projectiles).toHaveLength(0);
    expect(s.pawns.find(p => p.id === hunterId)!.phase).toBe('idle');
    command(s, { type: 'priority', pawnId: s.pawns[1].id, work: 'dig', value: 1 });
    command(s, { type: 'designate', tool: 'mine', from: pos(21) });
    until(s, () => s.stats.produced.carcass === 1, 8000);
    expect(s.stats.mined).toBeGreaterThan(0);
  });
  it('returns a carried carcass intact on pause and processes it exactly once after save and resume', () => {
    let s = fixture(); const batch = carcass(s); add(s, batch, pos(20));
    s.pawns[0].priorities.cook = 1;
    command(s, { type: 'designate', tool: 'butcherSpot', from: pos(12, 14) });
    until(s, () => !!s.pawns[0].cargo?.carcass);
    const carried = structuredClone(s.pawns[0].cargo!);
    command(s, { type: 'butcherBill', spotId: s.butcherSpots[0].id, paused: true });
    s = VoxelSimulation.load(s.save());
    expect(s.pawns[0].cargo).toBeNull();
    expect(s.items.find(item => item.carcass?.animalId === batch.carcass!.animalId)).toMatchObject(carried);
    expect(s.counts().carcass).toBe(1);
    command(s, { type: 'butcherBill', spotId: s.butcherSpots[0].id, paused: false });
    until(s, () => s.stats.produced.meat === ANIMAL_DEFS.deer.meat);
    s.step(60);
    expect(s.stats.consumed.carcass).toBe(1); expect(s.counts().carcass).toBe(0);
    expect(s.counts().meat).toBe(ANIMAL_DEFS.deer.meat);
    expect(VoxelSimulation.load(s.save()).stats).toEqual(s.stats);
  });
  it('combines meat and vegetables into a meal, consuming each physical input once', () => {
    let s = fixture(); add(s, freshBatch('meat', 6)); add(s, freshBatch('grain', 4), pos(15));
    add(s, freshBatch('wood', 1), pos(16));
    s.stoves.push({ ...pos(12, 14), id: s.nextId++, target: 1, paused: false });
    s.pawns[0].priorities.cook = 1; s = VoxelSimulation.load(s.save());
    until(s, () => s.jobs.some(j => j.kind === 'cook' && (j.delivered.meat ?? 0) > 0));
    s = VoxelSimulation.load(s.save());
    until(s, () => s.stats.cooked === 1);
    expect(s.counts().meal).toBe(1); expect(s.counts().meat).toBe(0); expect(s.counts().grain).toBe(0);
    expect(s.stats.consumed.meat).toBe(6); expect(s.stats.consumed.grain).toBe(4);
  });
  it('keeps a completed butcher input when output space is full and resumes after space is freed', () => {
    const s = fixture(); add(s, carcass(s)); s.pawns[0].priorities.cook = 1;
    command(s, { type: 'designate', tool: 'butcherSpot', from: pos(12, 14) });
    until(s, () => !!s.jobs.find(j => j.kind === 'butcher')?.delivered.carcass);
    const delivered = s.jobs.find(j => j.kind === 'butcher')!.deliveredBatches[0];
    expect(colonyWealthDetails(s).itemSources.delivered).toBe(cargoMarketValue(delivered));
    for (let x = 8; x <= 40; x++) for (let y = 8; y <= 30; y++) {
      const p = pos(x, y); if (!s.items.some(i => at(i) === at(p))) add(s, freshBatch('stone', 75), p);
    }
    until(s, () => s.jobs.some(j => j.kind === 'butcher' && j.progress >= j.work));
    expect(s.stats.produced.meat).toBe(0); expect(s.counts().carcass).toBe(1);
    expect(VoxelSimulation.load(s.save()).counts().carcass).toBe(1);
    s.items = s.items.filter(i => at(i) !== at(pos(12, 15)));
    until(s, () => s.stats.produced.meat === ANIMAL_DEFS.deer.meat);
    expect(s.stats.consumed.carcass).toBe(1);
  });
  it('rejects duplicate animal ownership across ground, cargo and the living population', () => {
    const s = fixture(), batch = carcass(s); add(s, batch);
    const bad = s.save(); bad.pawns[0].cargo = structuredClone(batch);
    expect(() => VoxelSimulation.load(bad)).toThrow(/尸体身份/);
    const a = animal(s), other = s.save(); other.items[0].carcass!.animalId = a.id;
    expect(() => VoxelSimulation.load(other)).toThrow(/尸体身份/);
  });
  it('freezes real meat and carried carcasses, then records spoilage exactly once after warming', () => {
    let s = fixture();
    for (let x = 8; x <= 40; x++) for (let y = 8; y <= 30; y++) s.blocks[index(x, y, 10)] = Block.Stone;
    add(s, { ...freshBatch('meat', 8), rotProgress: DAY * 2 - 1 });
    s.pawns[0].cargo = { ...carcass(s), rotProgress: DAY * 2 - 1 };
    s = VoxelSimulation.load(s.save());
    s.thermal.pushHeat(pos(14), (-10 - s.temperature(pos(14))) * 1e8, -10);
    s.step(20);
    expect(s.temperature(pos(14))).toBeLessThan(0);
    expect(s.items.find(i => i.resource === 'meat')!.rotProgress).toBe(DAY * 2 - 1);
    expect(s.pawns[0].cargo!.rotProgress).toBe(DAY * 2 - 1);
    s.thermal.pushHeat(pos(14), (20 - s.temperature(pos(14))) * 1e8, 20);
    s.step(5);
    expect(s.stats.spoiled.meat).toBe(8); expect(s.stats.spoiled.carcass).toBe(1);
    expect(s.counts().meat).toBe(0); expect(s.counts().carcass).toBe(0);
    s.step(5); expect(s.stats.spoiled.carcass).toBe(1);
  });
  it('loads an actual v21 new colony without altering its items and adds wildlife once', () => {
    const old = JSON.parse(readFileSync('tests/fixtures/voxel-v21-wildlife-initial.json', 'utf8'));
    expect(old.version).toBe(21); expect(old.animals).toBeUndefined();
    const s = VoxelSimulation.load(old);
    expect(s.items).toEqual(old.items); expect(s.animals).toHaveLength(8); expect(s.save().version).toBe(40);
    expect(VoxelSimulation.load(s.save()).animals).toEqual(s.animals);
  });
});
