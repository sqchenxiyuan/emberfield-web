import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { newTraderAnimal } from '../src/voxel/animalTrade';
import { ANIMAL_TRAINING_RULES, TRAINING_STEPS, animalTrainingFoodAmount, type Trainable } from '../src/voxel/animalTraining';
import { freshBatch } from '../src/voxel/preservation';
import { quoteTrade } from '../src/voxel/tradeWorld';
import { initialSurvival } from '../src/voxel/survival';
import { initialSkills } from '../src/voxel/skills';
import { initialPsyche } from '../src/voxel/mood';
import { initialApparelControl } from '../src/voxel/apparelPolicies';
import { HUSBANDRY_RULES } from '../src/voxel/husbandry';
import { Block, at, index, type Pawn, type Pos, type Resource, type VoxelCommand, type VoxelSave, type WildAnimal } from '../src/voxel/types';

const pos = (x: number, y = 14, z = 8): Pos => ({ x, y, z });
let baseline: VoxelSave | undefined;
/** Controlled terrain, trader stock, prior training and injuries isolate the
 * mechanisms. All asserted actions use public commands and real world ticks;
 * this is not a naturally progressed colony or a balance acceptance campaign. */
function scene() {
  if (!baseline) {
    const s = new VoxelSimulation(73129, { biome: 'temperate', hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
    s.animals = []; s.grass = []; s.items = []; s.trees = []; s.treePlots = [];
    s.stockpiles = []; s.beds = []; s.tables = []; s.chairs = []; s.doors = [];
    s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0); s.explored.fill(1);
    for (let x = 0; x < 64; x++) for (let y = 10; y <= 24; y++) for (let z = 8; z < 16; z++)
      s.blocks[index(x, y, z)] = Block.Air;
    s.spawn = pos(12); s.homeArea.clear();
    for (const [i, p] of s.pawns.entries()) {
      Object.assign(p, pos(12, 14 + i)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
      for (const key of Object.keys(p.priorities)) p.priorities[key as keyof Pawn['priorities']] = 0;
    }
    cmd(s, { type: 'threats', enabled: false }); cmd(s, { type: 'fireHazards', enabled: false });
    baseline = s.save();
  }
  return VoxelSimulation.load(baseline);
}
function cmd(s: VoxelSimulation, command: VoxelCommand) {
  const r = s.command(command); expect(r.ok, r.message).toBe(true); return r;
}
function until(s: VoxelSimulation, done: () => boolean, limit = 1200) {
  for (let n = 0; n < limit && !done(); n++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick,
    pawns: s.pawns.map(p => ({ id: p.id, pos: at(p), phase: p.phase, reason: p.reason, train: p.animalTrainTask, cargo: p.cargo, carried: p.carriedBy })),
    animals: s.animals.map(a => ({ id: a.id, pos: at(a), phase: a.phase, reason: a.reason, work: a.work, cargo: a.cargo, training: a.training })) })).toBe(true);
}
function dog(s: VoxelSimulation, where = pos(20)) {
  const a = newTraderAnimal(s.nextId++, 'labrador', 'female', s.tick, where);
  a.faction = 'colony'; a.decisionTick = s.tick + 10000; s.animals.push(a); return a;
}
function learned(a: WildAnimal, ...skills: Trainable[]) {
  for (const skill of ['obedience', ...skills] as Trainable[]) {
    a.training.steps[skill] = TRAINING_STEPS[skill]; a.training.learned[skill] = true;
  }
}
function item(s: VoxelSimulation, resource: Resource, amount: number, where = pos(15, 16)) {
  const i = { ...where, ...freshBatch(resource, amount), id: s.nextId++ }; s.items.push(i); return i;
}
function total(s: VoxelSimulation, resource: Resource) {
  return s.items.filter(i => i.resource === resource).reduce((n, i) => n + i.amount, 0) +
    [...s.pawns, ...s.animals].reduce((n, a) => n + (a.cargo?.resource === resource ? a.cargo.amount : 0), 0) +
    s.stats.consumed[resource] + s.stats.destroyed[resource];
}
function train(s: VoxelSimulation, a: WildAnimal, level = 20) {
  const p = s.pawns[0]; p.skills.animals.level = level;
  cmd(s, { type: 'priority', pawnId: p.id, work: 'handle', value: 1 });
  cmd(s, { type: 'animalTraining', animalId: a.id, trainable: 'obedience', wanted: true });
  return p;
}
function storage(s: VoxelSimulation, where: Pos, priority: number) {
  cmd(s, { type: 'designate', tool: 'stock', from: where });
  cmd(s, { type: 'storage', from: where, priority, accepts: ['wood'] });
}
function reloaded(s: VoxelSimulation) {
  const saved = s.save(), copy = VoxelSimulation.load(saved);
  expect(copy.save().animals).toEqual(saved.animals);
  expect(copy.save().items).toEqual(saved.items);
  expect(copy.save().stats).toEqual(saved.stats);
  return copy;
}

describe('actual animal training, cooperation and conserved physical work', () => {
  it('purchases the same untrained dog through a real quoted transaction', () => {
    const s = scene(); s.tradeSpawn();
    const c = s.trade.caravans[0], p = s.pawns[0]; expect(c.kind).toBe('bulk');
    c.stage = 'visiting'; c.visitingAt = s.tick;
    for (const [i, visitor] of s.pawns.filter(q => q.faction === 'trader').entries()) Object.assign(visitor, pos(15, 12 + i));
    Object.assign(s.pawns.find(q => q.id === c.traderId)!, pos(13));
    for (const [i, a] of s.animals.entries()) Object.assign(a, pos(22 + i), { path: [], goal: null });
    // Explicit stock is a fixture; settlement and ownership transfer are real.
    const a = newTraderAnimal(s.nextId++, 'labrador', 'female', s.tick, pos(26));
    s.animals.push(a); c.animalIds.push(a.id);
    const money = item(s, 'silver', 500, pos(12, 12)); s.homeArea.add(at(money));
    p.phase = 'trade'; s.trade.session = { id: s.nextId++, caravanId: c.id, pawnId: p.id, stage: 'ready', startedAt: s.tick };
    const q = quoteTrade(s)!; expect(q.animalOffers.some(o => o.stockId === a.id)).toBe(true);
    const training = structuredClone(a.training), start = at(a), moneyBefore = s.counts().silver;
    cmd(s, { type: 'tradeCommit', sessionId: q.sessionId, quoteKey: q.key,
      lines: [{ side: 'trader', stockId: a.id, amount: 1 }], gift: false, acceptShortfall: false });
    expect(s.animals.find(b => b.id === a.id)).toBe(a); expect(at(a)).toBe(start);
    expect(a.faction).toBe('colony'); expect(c.animalIds).not.toContain(a.id);
    expect(a.training).toEqual(training); expect(Object.values(a.training.learned).every(v => !v)).toBe(true);
    expect(s.counts().silver).toBeLessThan(moneyBefore); expect(s.trade.animalLedger.bought.labrador).toBe(1);
    reloaded(s);
  });

  it('recursively requests prerequisites and cancels future training without erasing learned progress', () => {
    const s = scene(), a = dog(s); learned(a, 'release'); a.training.steps.haul = 2;
    cmd(s, { type: 'animalTraining', animalId: a.id, trainable: 'haul', wanted: true });
    cmd(s, { type: 'animalTraining', animalId: a.id, trainable: 'release', wanted: true });
    expect(a.training.wanted).toEqual({ obedience: true, release: true, rescue: false, haul: true });
    const progress = structuredClone({ steps: a.training.steps, learned: a.training.learned });
    cmd(s, { type: 'animalTraining', animalId: a.id, trainable: 'obedience', wanted: false });
    expect(Object.values(a.training.wanted).every(v => !v)).toBe(true);
    expect({ steps: a.training.steps, learned: a.training.learned }).toEqual(progress); reloaded(s);
  });

  it('fetches actual food, feeds twice and completes first obedience learning with the trainer as master across saves', () => {
    let s = scene(), a = dog(s), p = train(s, a);
    // Two prior successful lessons isolate the first transition to learned.
    a.training.steps.obedience = TRAINING_STEPS.obedience - 1;
    const source = item(s, 'grain', 20), portion = animalTrainingFoodAmount(a, 'grain'), animalId = a.id, pawnId = p.id;
    const reload = () => { s = reloaded(s); a = s.animals.find(b => b.id === animalId)!; p = s.pawns.find(b => b.id === pawnId)!; };
    until(s, () => p.animalTrainTask?.stage === 'fetch');
    expect(p.cargo).toBeNull(); expect(p.animalTrainTask?.sourceId).toBe(source.id); reload();
    until(s, () => p.animalTrainTask?.stage === 'work');
    expect(p.cargo).toMatchObject({ resource: 'grain', amount: portion });
    expect(s.stats.consumed.grain).toBe(0); expect(a.training.learned.obedience).toBe(false); reload();
    until(s, () => s.stats.consumed.grain === portion / 2);
    expect(p.animalTrainTask?.progress).toBe(ANIMAL_TRAINING_RULES.work * 2 / 3);
    expect(p.cargo?.amount).toBe(portion / 2); expect(a.training.learned.obedience).toBe(false);
    expect(total(s, 'grain')).toBe(20); reload();
    until(s, () => !p.animalTrainTask);
    expect(a.training.learned.obedience).toBe(true); expect(a.training.masterId).toBe(p.id);
    expect(a.training.followDrafted).toBe(false); expect(a.training.followFieldwork).toBe(false);
    expect(s.stats.consumed.grain).toBe(portion); expect(p.cargo).toBeNull();
    expect(a.nextInteractionTick).toBe(s.tick + ANIMAL_TRAINING_RULES.interactionCooldown);
    expect(total(s, 'grain')).toBe(20); reloaded(s);
  });

  it('cancels after the first feeding without refunding eaten food or deleting unused cargo', () => {
    const s = scene(), a = dog(s), p = train(s, a), portion = animalTrainingFoodAmount(a, 'grain');
    item(s, 'grain', 20);
    until(s, () => s.stats.consumed.grain === portion / 2);
    cmd(s, { type: 'animalTraining', animalId: a.id, trainable: 'obedience', wanted: false });
    expect(p.animalTrainTask).toBeUndefined(); expect(a.training.steps.obedience).toBe(0);
    expect(s.stats.consumed.grain).toBe(portion / 2); expect(total(s, 'grain')).toBe(20);
    reloaded(s); s.step(80); expect(total(s, 'grain')).toBe(20);
    expect(s.stats.consumed.grain).toBe(portion / 2); reloaded(s);
  });

  it('consumes both feedings and applies cooldown after a real low-skill failed attempt', () => {
    const s = scene(), a = dog(s), p = train(s, a, 0), portion = animalTrainingFoodAmount(a, 'grain');
    item(s, 'grain', 20); until(s, () => !!p.animalTrainTask); until(s, () => !p.animalTrainTask);
    expect(s.husbandryLog.at(-1)?.message).toContain('未成功完成');
    expect(a.training.steps.obedience).toBe(0); expect(a.training.masterId).toBeNull();
    expect(s.stats.consumed.grain).toBe(portion); expect(total(s, 'grain')).toBe(20);
    expect(a.nextInteractionTick).toBe(s.tick + ANIMAL_TRAINING_RULES.interactionCooldown); reloaded(s);
  });

  it('requires enabled handling work and cannot repeat training before the interaction cooldown', () => {
    const s = scene(), a = dog(s), p = s.pawns[0]; p.skills.animals.level = 20; item(s, 'grain', 20);
    cmd(s, { type: 'animalTraining', animalId: a.id, trainable: 'obedience', wanted: true });
    s.step(60); expect(p.animalTrainTask).toBeUndefined(); expect(s.stats.consumed.grain).toBe(0);
    cmd(s, { type: 'priority', pawnId: p.id, work: 'handle', value: 1 });
    until(s, () => a.training.steps.obedience === 1);
    const consumed = s.stats.consumed.grain, deadline = a.nextInteractionTick;
    s.step(120); expect(s.tick).toBeLessThan(deadline); expect(a.training.steps.obedience).toBe(1);
    expect(p.animalTrainTask).toBeUndefined(); expect(s.stats.consumed.grain).toBe(consumed); reloaded(s);
  });

  it.each(['priority', 'area'] as const)('interrupts a partly fed lesson when the handler %s changes, preserving food', change => {
    const s = scene(), a = dog(s), p = train(s, a), portion = animalTrainingFoodAmount(a, 'grain'); item(s, 'grain', 20);
    until(s, () => s.stats.consumed.grain === portion / 2);
    if (change === 'priority') cmd(s, { type: 'priority', pawnId: p.id, work: 'handle', value: 0 });
    else {
      const areaId = cmd(s, { type: 'allowedAreaCreate', name: '训练员新区域' }).areaId!;
      cmd(s, { type: 'allowedAreaPaint', areaId, from: { x: p.x, y: p.y, z: p.z }, erase: false });
      cmd(s, { type: 'pawnAreaAssign', pawnId: p.id, areaId });
    }
    s.step(); expect(p.animalTrainTask).toBeUndefined(); expect(a.training.steps.obedience).toBe(0);
    expect(s.stats.consumed.grain).toBe(portion / 2); expect(total(s, 'grain')).toBe(20); reloaded(s);
  });

  it.each(['rescue', 'haul'] as const)('waits for sufficient body size before training %s', skill => {
    const s = scene(), a = dog(s), p = s.pawns[0]; learned(a);
    a.growth = .1; a.ageTicks = Math.floor(HUSBANDRY_RULES.adultTicks * a.growth); p.skills.animals.level = 20;
    item(s, 'grain', 20); cmd(s, { type: 'priority', pawnId: p.id, work: 'handle', value: 1 });
    cmd(s, { type: 'animalTraining', animalId: a.id, trainable: skill, wanted: true });
    s.step(80); expect(p.animalTrainTask).toBeUndefined(); expect(s.stats.consumed.grain).toBe(0);
    expect(a.training.steps[skill]).toBe(0); reloaded(s);
    // Controlled adulthood isolates the capability gate, not the growth rate.
    a.growth = 1; a.ageTicks = HUSBANDRY_RULES.adultTicks;
    until(s, () => a.training.steps[skill] === 1);
    expect(s.stats.consumed.grain).toBe(animalTrainingFoodAmount(a, 'grain')); reloaded(s);
  });

  it('allows a small puppy to learn obedience rather than imposing an adulthood gate on every skill', () => {
    const s = scene(), a = dog(s); a.growth = .1; a.ageTicks = Math.floor(HUSBANDRY_RULES.adultTicks * a.growth);
    train(s, a); item(s, 'grain', 20); until(s, () => a.training.steps.obedience === 1);
    expect(a.growth).toBeLessThan(HUSBANDRY_RULES.juvenileGrowth); expect(total(s, 'grain')).toBe(20); reloaded(s);
  });

  it('creates a real newborn with inherited area but no parental training, master or follow settings', () => {
    const s = scene(), mother = dog(s, pos(20)), father = dog(s, pos(22)), p = s.pawns[0]; father.sex = 'male';
    const areaId = cmd(s, { type: 'animalAreaCreate', name: '犬舍区域' }).areaId!;
    cmd(s, { type: 'animalAreaPaint', areaId, from: pos(18, 12), to: pos(24, 18), erase: false });
    for (const a of [mother, father]) {
      learned(a, 'release', 'rescue', 'haul');
      cmd(s, { type: 'animalMaster', animalId: a.id, pawnId: p.id });
      cmd(s, { type: 'animalFollow', animalId: a.id, when: 'drafted', enabled: true });
      cmd(s, { type: 'animalFollow', animalId: a.id, when: 'fieldwork', enabled: true });
      cmd(s, { type: 'animalTraining', animalId: a.id, trainable: 'haul', wanted: true });
      cmd(s, { type: 'animalAreaAssign', animalId: a.id, areaId });
    }
    mother.pregnancy = { fatherId: father.id, progress: 1 }; s.step();
    const event = s.husbandryLog.find(e => e.kind === 'birth')!, child = s.animals.find(a => a.id === event.otherId)!;
    expect(child.species).toBe('labrador'); expect(child.faction).toBe('colony'); expect(child.allowedAreaId).toBe(areaId);
    expect(child.growth).toBe(0); expect(child.training.masterId).toBeNull();
    expect(Object.values(child.training.steps).every(v => v === 0)).toBe(true);
    expect(Object.values(child.training.learned).every(v => !v)).toBe(true); expect(Object.values(child.training.wanted).every(v => !v)).toBe(true);
    expect(child.training.followDrafted).toBe(false); expect(child.training.followFieldwork).toBe(false);
    expect(mother.training.learned.haul).toBe(true); expect(child.work).toBeNull(); reloaded(s);
  });

  it('physically follows a drafted master, releases into actual combat and recalls after undrafting', () => {
    let s = scene(), a = dog(s, pos(28)), p = s.pawns[0]; learned(a, 'release');
    cmd(s, { type: 'animalMaster', animalId: a.id, pawnId: p.id });
    cmd(s, { type: 'animalFollow', animalId: a.id, when: 'drafted', enabled: true });
    cmd(s, { type: 'draft', pawnId: p.id, drafted: true });
    const origin = at(a); until(s, () => a.work?.kind === 'follow' && Math.hypot(a.x - p.x, a.y - p.y) <= 3);
    expect(at(a)).not.toBe(origin);
    const animalId = a.id, pawnId = p.id; s = reloaded(s); a = s.animals.find(b => b.id === animalId)!; p = s.pawns.find(b => b.id === pawnId)!;
    const enemyId = s.nextId++, enemy: Pawn = { ...structuredClone(s.pawns[1]), ...initialSurvival(s.seed, enemyId), ...pos(30),
      id: enemyId, name: '协作防御测试袭击者', faction: 'raider', foodPolicyId: null, apparelControl: initialApparelControl(s.tick),
      skills: initialSkills(0, true), psyche: initialPsyche(), worn: [], prisoner: null, wardenTask: null, moveTick: s.tick + 3000 };
    s.pawns.push(enemy); const trauma = structuredClone(enemy.trauma);
    s.step(); expect(a.work?.kind).toBe('follow');
    cmd(s, { type: 'animalsRelease', pawnId: p.id, enabled: true });
    until(s, () => s.combatEvents.some(e => e.shooterId === a.id && e.targetId === enemy.id && e.kind === 'hit') &&
      s.combatEvents.some(e => e.shooterId === enemy.id && e.targetId === a.id && e.kind === 'hit'));
    expect(enemy.trauma).not.toEqual(trauma); expect(a.medical.wounds.length).toBeGreaterThan(0); expect(p.animalsReleased).toBe(true);
    cmd(s, { type: 'animalsRelease', pawnId: p.id, enabled: false });
    expect(p.animalsReleased).toBe(false); expect(a.work?.kind).not.toBe('attack');
    // Wound care and fleeing can interrupt following after actual retaliation.
    s.step(); expect(a.work?.kind).not.toBe('attack');
    cmd(s, { type: 'draft', pawnId: p.id, drafted: false });
    expect(a.work).toBeNull(); expect(p.animalsReleased).toBe(false); reloaded(s);
  });

  it('follows during an actual mining assignment and stops following after fieldwork is cancelled', () => {
    const s = scene(), a = dog(s, pos(12, 18)), p = s.pawns[0]; learned(a);
    Object.assign(p, pos(22, 14)); s.blocks[at(pos(28))] = Block.Stone; s.revision++;
    cmd(s, { type: 'animalMaster', animalId: a.id, pawnId: p.id });
    cmd(s, { type: 'animalFollow', animalId: a.id, when: 'fieldwork', enabled: true });
    s.step(); expect(a.work).toBeNull();
    cmd(s, { type: 'priority', pawnId: p.id, work: 'dig', value: 1 });
    cmd(s, { type: 'designate', tool: 'mine', from: pos(28) });
    until(s, () => a.work?.kind === 'follow' && a.x > 12);
    expect(p.drafted).toBe(false); expect(s.jobs.some(j => j.id === p.jobId && j.kind === 'mine')).toBe(true);
    reloaded(s); cmd(s, { type: 'designate', tool: 'cancel', from: pos(28) });
    s.step(); expect(a.work?.kind).not.toBe('follow'); expect(a.training.followFieldwork).toBe(true); reloaded(s);
  });

  it('respects the animal allowed area while following and resumes when that restriction is removed', () => {
    const s = scene(), a = dog(s, pos(26)), p = s.pawns[0]; learned(a);
    const areaId = cmd(s, { type: 'animalAreaCreate', name: '犬活动区域' }).areaId!;
    cmd(s, { type: 'animalAreaPaint', areaId, from: pos(24, 12), to: pos(28, 18), erase: false });
    cmd(s, { type: 'animalAreaAssign', animalId: a.id, areaId });
    cmd(s, { type: 'animalMaster', animalId: a.id, pawnId: p.id });
    cmd(s, { type: 'animalFollow', animalId: a.id, when: 'drafted', enabled: true });
    cmd(s, { type: 'draft', pawnId: p.id, drafted: true });
    const start = at(a); s.step(80); expect(at(a)).toBe(start); expect(a.path).toEqual([]); reloaded(s);
    cmd(s, { type: 'animalAreaAssign', animalId: a.id, areaId: null });
    until(s, () => Math.hypot(a.x - p.x, a.y - p.y) <= 3); expect(at(a)).not.toBe(start); reloaded(s);
  });

  it.each(['lockedDoor', 'ladder'] as const)('cannot follow across a %s bottleneck or teleport through the wall', obstacle => {
    let s = scene();
    for (let y = 10; y <= 24; y++) for (let z = 8; z < 16; z++) s.blocks[index(20, y, z)] = Block.Stone;
    s.blocks[at(pos(20))] = Block.Air; s.blocks[at(pos(20, 14, 9))] = Block.Air;
    const doorId = s.nextId++;
    if (obstacle === 'lockedDoor') s.doors.push({ ...pos(20), id: doorId, axis: 'x', mode: 'locked', openUntil: 0 });
    else s.ladders[at(pos(20))] = 1;
    s = VoxelSimulation.load(s.save()); const a = dog(s, pos(16)), p = s.pawns[0]; Object.assign(p, pos(24)); learned(a);
    cmd(s, { type: 'animalMaster', animalId: a.id, pawnId: p.id });
    cmd(s, { type: 'animalFollow', animalId: a.id, when: 'drafted', enabled: true });
    cmd(s, { type: 'draft', pawnId: p.id, drafted: true });
    const start = at(a); s.step(80); expect(at(a)).toBe(start); expect(a.path).toEqual([]); reloaded(s);
    if (obstacle === 'lockedDoor') {
      cmd(s, { type: 'door', doorId, mode: 'open' }); until(s, () => a.x > 20); reloaded(s);
    }
  });

  it.each(['undraft', 'downed', 'death'] as const)('clears active following and released mode when the master becomes %s', change => {
    const s = scene(), a = dog(s, pos(20)), p = s.pawns[0]; learned(a, 'release');
    cmd(s, { type: 'animalMaster', animalId: a.id, pawnId: p.id });
    cmd(s, { type: 'animalFollow', animalId: a.id, when: 'drafted', enabled: true });
    cmd(s, { type: 'draft', pawnId: p.id, drafted: true });
    cmd(s, { type: 'animalsRelease', pawnId: p.id, enabled: true }); s.step(); expect(a.work?.kind).toBe('follow');
    if (change === 'undraft') cmd(s, { type: 'draft', pawnId: p.id, drafted: false });
    else { p.health.malnutrition = change === 'death' ? 1 : .9; p.food = change === 'death' ? 0 : 90; s.step(); }
    expect(p.animalsReleased).toBe(false); expect(a.work?.kind).not.toBe('follow'); expect(a.work?.kind).not.toBe('attack');
    if (change === 'death') {
      expect(p.dead).toBe(true); expect(a.training.masterId).toBeNull(); expect(a.training.followDrafted).toBe(false);
    } else {
      expect(p.downed).toBe(change === 'downed'); expect(a.training.masterId).toBe(p.id); expect(a.training.followDrafted).toBe(true);
    }
    reloaded(s);
  });

  it('rescues without a master using an actual patient and bed, continuing the carry after saving', () => {
    let s = scene(), a = dog(s, pos(16)), p = s.pawns[1]; learned(a, 'rescue'); a.decisionTick = s.tick;
    Object.assign(p, pos(24)); p.health.malnutrition = .9; p.downed = true; p.phase = 'downed';
    const bed = { ...pos(12, 20), id: s.nextId++, axis: 'x' as const, owner: null, quality: 2 as const, medical: true, prisoner: false };
    s.beds.push(bed); const animalId = a.id, patientId = p.id;
    expect(a.training.masterId).toBeNull(); until(s, () => a.work?.kind === 'rescue' && a.work.stage === 'carry');
    expect(p.carriedBy).toBe(a.id); expect(at(p)).toBe(at(a)); expect(at(p)).not.toBe(at(bed));
    s = reloaded(s); a = s.animals.find(b => b.id === animalId)!; p = s.pawns.find(b => b.id === patientId)!;
    expect(p.carriedBy).toBe(a.id); expect(a.work).toMatchObject({ kind: 'rescue', stage: 'carry', patientId, bedId: bed.id });
    until(s, () => p.carriedBy === null && p.sleepBedId === bed.id);
    expect(at(p)).toBe(at(bed)); expect(p.downed).toBe(true); expect(p.health.malnutrition).toBeGreaterThan(0);
    expect(a.work).toBeNull(); expect(a.training.masterId).toBeNull(); reloaded(s);
  });

  it('requires a real bed and drops a carried patient at the interruption position when an override arrives', () => {
    const s = scene(), a = dog(s, pos(16)), p = s.pawns[1]; learned(a, 'rescue'); a.decisionTick = s.tick;
    Object.assign(p, pos(24)); p.health.malnutrition = .9; p.downed = true; p.phase = 'downed';
    s.step(); expect(a.work).toBeNull(); expect(p.carriedBy).toBeNull();
    a.goal = null; a.path = []; a.decisionTick = s.tick;
    s.beds.push({ ...pos(12, 20), id: s.nextId++, axis: 'x', owner: null, quality: 2, medical: true, prisoner: false });
    until(s, () => a.work?.kind === 'rescue' && a.work.stage === 'carry');
    const stop = at(a); cmd(s, { type: 'animalMaster', animalId: a.id, pawnId: null });
    expect(a.work).toBeNull(); expect(p.carriedBy).toBeNull(); expect(at(p)).toBe(stop);
    expect(p.sleepBedId).toBeNull(); expect(p.downed).toBe(true); reloaded(s);
  });

  it.each(['medicalRemoved', 'prisonerBed'] as const)('releases a carried patient immediately when the destination becomes %s', change => {
    const s = scene(), a = dog(s, pos(16)), p = s.pawns[1]; learned(a, 'rescue'); a.decisionTick = s.tick;
    Object.assign(p, pos(24)); p.health.malnutrition = .9; p.downed = true; p.phase = 'downed';
    const bed = { ...pos(12, 20), id: s.nextId++, axis: 'x' as const, owner: null, quality: 2 as const, medical: true, prisoner: false };
    s.beds.push(bed); until(s, () => a.work?.kind === 'rescue' && a.work.stage === 'carry'); const stop = at(a);
    if (change === 'medicalRemoved') cmd(s, { type: 'bedMedical', bedId: bed.id, medical: false });
    else cmd(s, { type: 'bedPrisoner', bedId: bed.id, prisoner: true });
    expect(p.carriedBy).toBeNull(); expect(at(p)).toBe(stop); expect(p.sleepBedId).toBeNull(); expect(a.work).toBeNull();
    expect(p.downed).toBe(true); reloaded(s);
  });

  it('drops the patient at the real carry position when the rescuing animal dies', () => {
    const s = scene(), a = dog(s, pos(16)), p = s.pawns[1]; learned(a, 'rescue'); a.decisionTick = s.tick;
    Object.assign(p, pos(24)); p.health.malnutrition = .9; p.downed = true; p.phase = 'downed';
    s.beds.push({ ...pos(12, 20), id: s.nextId++, axis: 'x', owner: null, quality: 2, medical: true, prisoner: false });
    until(s, () => a.work?.kind === 'rescue' && a.work.stage === 'carry'); const stop = at(a), patientId = p.id;
    // Terminal hunger is a controlled injury fixture; death and carry release
    // run through the ordinary biology/world step rather than a cleanup stub.
    a.hunger = 0; a.malnutrition = 1; s.step();
    expect(a.dead).toBe(true); expect(p.carriedBy).toBeNull(); expect(at(p)).toBe(stop);
    expect(p.sleepBedId).toBeNull(); expect(p.downed).toBe(true); expect(p.dead).toBe(false);
    expect(s.pawns.filter(q => q.id === patientId)).toHaveLength(1); reloaded(s);
  });

  it('hauls real cargo without a master to strictly better storage, respecting forbidden stock and save continuation', () => {
    let s = scene(), a = dog(s, pos(20)); learned(a, 'haul');
    storage(s, pos(26, 17), 1); storage(s, pos(16, 18), 1);
    const source = item(s, 'wood', 12, pos(26, 17)); cmd(s, { type: 'itemForbidden', itemId: source.id, forbidden: true });
    s.step(40); expect(a.work).toBeNull(); expect(source.amount).toBe(12); expect(a.cargo).toBeNull();
    cmd(s, { type: 'storage', from: pos(16, 18), priority: 3, accepts: ['wood'] });
    // A closer but lower-priority destination must not win over priority 3.
    storage(s, pos(24, 18), 2);
    s.step(40); expect(a.work).toBeNull(); expect(source.amount).toBe(12);
    cmd(s, { type: 'itemForbidden', itemId: source.id, forbidden: false });
    until(s, () => a.work?.kind === 'haul' && a.work.stage === 'fetch', 2400);
    expect(a.cargo).toBeNull(); expect(a.work).toMatchObject({ target: pos(16, 18), sourceId: source.id });
    const animalId = a.id; s = reloaded(s); a = s.animals.find(b => b.id === animalId)!;
    until(s, () => a.work?.kind === 'haul' && a.work.stage === 'deliver');
    expect(a.cargo).toMatchObject({ resource: 'wood', amount: 12 }); expect(s.items.some(i => i.id === source.id)).toBe(false);
    expect(total(s, 'wood')).toBe(12); s = reloaded(s); a = s.animals.find(b => b.id === animalId)!;
    until(s, () => a.cargo === null && a.work === null);
    expect(s.items.find(i => at(i) === at(pos(16, 18)) && i.resource === 'wood')?.amount).toBe(12);
    expect(s.stats.hauled).toBe(12); expect(a.training.masterId).toBeNull(); expect(total(s, 'wood')).toBe(12); reloaded(s);
  });

  it('preserves and physically drops haul cargo when work is cancelled after pickup', () => {
    let s = scene(), a = dog(s, pos(20)); learned(a, 'haul');
    storage(s, pos(12, 20), 3); item(s, 'wood', 12, pos(25, 17));
    until(s, () => a.work?.kind === 'haul' && a.work.stage === 'deliver', 2400);
    const animalId = a.id; expect(a.cargo?.amount).toBe(12);
    cmd(s, { type: 'animalMaster', animalId: a.id, pawnId: null });
    expect(a.work).toBeNull(); expect(a.cargo?.amount).toBe(12); expect(total(s, 'wood')).toBe(12);
    s = reloaded(s); a = s.animals.find(b => b.id === animalId)!;
    s.step(); expect(a.cargo).toBeNull(); expect(total(s, 'wood')).toBe(12);
    expect(s.stats.hauled).toBe(0);
    expect(s.items.some(i => i.resource === 'wood' && Math.abs(i.x - a.x) + Math.abs(i.y - a.y) <= 3)).toBe(true); reloaded(s);
  });
});
