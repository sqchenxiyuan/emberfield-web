import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Job, type Pos } from '../src/voxel/types';
import { EGG_BOX_RULES, type EggBox } from '../src/voxel/eggBoxes';
import { isConstructionFrame, frameBuildingKind, constructionFrameCells, constructionFrameFlammability } from '../src/voxel/constructionFrames';
import { isFailableConstruction, validateConstructionFailure } from '../src/voxel/construction';
import { initialSkills, jobSkill, jobXP, learnSkill } from '../src/voxel/skills';
import { FIRE_MAX_HP, FIRE_TARGET_NAMES, fireDamageCells, fireDamageKey } from '../src/voxel/fire';
import { findFireDamageTarget, fireFuelAt, frameDamageTarget } from '../src/voxel/fireWorld';
import { colonyWealthDetails, constructedMarketValue } from '../src/voxel/wealth';
import { freshBatch } from '../src/voxel/preservation';
import { freshFertilizedEggs } from '../src/voxel/animalEggs';

const pos = (x = 18, y = 16, z = 8): Pos => ({ x, y, z });
function plan(delivered = 20): Job {
  return { ...pos(), id: 900, kind: 'eggBox', progress: 0, work: EGG_BOX_RULES.work, workTicks: 0,
    owner: null, delivered: delivered ? { wood: delivered } : {},
    deliveredBatches: delivered ? [freshBatch('wood', delivered)] : [],
    cost: { ...EGG_BOX_RULES.cost }, reason: '受控蛋箱施工', cancelled: false };
}
/** These direct state fixtures isolate registry/asset integration. Construction
 * delivery, damage destruction, emptying and migration have separate world tests. */
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.grass = []; s.trees = []; s.items = []; s.stockpiles = []; s.eggBoxes = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0); s.explored.fill(1);
  for (let x = 10; x <= 28; x++) for (let y = 10; y <= 22; y++)
    for (let z = 8; z <= 14; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  for (const [n, pawn] of s.pawns.entries()) Object.assign(pawn, pos(12, 16 + n));
  return s;
}
function box(s: VoxelSimulation): EggBox {
  const value: EggBox = { ...pos(), id: s.nextId++, eggs: null, emptyRequested: false, forbidden: false };
  s.eggBoxes.push(value); return value;
}

describe('egg-box construction and skill registration', () => {
  it('creates a one-cell frame only after real materials are delivered and gives it quarter building HP', () => {
    expect(isConstructionFrame(plan(0))).toBe(false);
    const job = plan(); expect(isConstructionFrame(job)).toBe(true); expect(frameBuildingKind(job)).toBe('eggBox');
    expect(constructionFrameCells(job).map(at)).toEqual([at(pos())]);
    expect(constructionFrameFlammability(job)).toBe(.8);
    expect(frameDamageTarget(job)).toMatchObject({ kind: 'frame', targetId: job.id, maxHitPoints: 13, hitPoints: 13 });
    job.cancelled = true; expect(isConstructionFrame(job)).toBe(false);
  });
  it('participates in real construction failure accounting without allowing lost or duplicated salvage', () => {
    const job = plan(); expect(isFailableConstruction(job)).toBe(true);
    expect(isFailableConstruction({ ...job, cost: {} })).toBe(false);
    expect(isFailableConstruction({ ...job, cancelled: true })).toBe(false);
    Object.assign(job, { progress: 11, workTicks: 11, delivered: { wood: 10 }, deliveredBatches: [freshBatch('wood', 10)],
      constructionFailure: { workerId: 103, lost: { wood: 10 } } });
    expect(isConstructionFrame(job)).toBe(false); expect(() => validateConstructionFailure(job, 1000)).not.toThrow();
    for (const delivered of [9, 11]) expect(() => validateConstructionFailure({ ...job, delivered: { wood: delivered } }, 1000)).toThrow();
  });
  it('routes egg-box construction work to the existing construction experience calculation', () => {
    expect(jobSkill('eggBox')).toBe('construction'); expect(jobXP('eggBox')).toBe(.75);
    const skills = initialSkills(103), construction = skills.construction;
    construction.passion = 1; construction.dailyXp = 0; construction.xp = 0; construction.level = 1;
    learnSkill(construction, jobXP('eggBox'));
    expect(construction.xp).toBe(.75); expect(construction.dailyXp).toBe(.75);
  });
});

describe('egg-box fire identity and physical asset accounting', () => {
  it('resolves the box as its own one-cell 50-HP burn target and removes the target with the building', () => {
    const s = fixture(), value = box(s);
    const fuel = fireFuelAt(s, value).find(f => f.damage?.kind === 'eggBox' && f.id === value.id)!;
    expect(fuel).toBeDefined(); expect(fuel.flammability).toBe(.8);
    expect(FIRE_MAX_HP.eggBox).toBe(50); expect(FIRE_TARGET_NAMES.eggBox).toBe('蛋箱');
    expect(fuel.damage).toMatchObject({ kind: 'eggBox', targetId: value.id, key: fireDamageKey('eggBox', value.id, value),
      hitPoints: 50, maxHitPoints: 50 });
    expect(fireDamageCells(fuel.damage!, s).map(at)).toEqual([at(value)]);
    expect(findFireDamageTarget(s, fuel.damage!)).toEqual(fuel.damage);
    expect(fireFuelAt(s, pos(18, 16, 9)).some(f => f.damage?.kind === 'eggBox')).toBe(false);
    s.eggBoxes = []; expect(findFireDamageTarget(s, fuel.damage!)).toBeUndefined();
    expect(fireFuelAt(s, value).some(f => f.damage?.kind === 'eggBox')).toBe(false);
  });
  it('keeps an egg-box construction frame discoverable as fuel before the completed building exists', () => {
    const s = fixture(), job = plan(); s.jobs.push(job);
    const fuel = fireFuelAt(s, job).find(f => f.damage?.kind === 'frame' && f.id === job.id)!;
    expect(fuel.damage).toEqual(frameDamageTarget(job));
    expect(findFireDamageTarget(s, fuel.damage!)).toEqual(frameDamageTarget(job));
    job.delivered = {}; job.deliveredBatches = [];
    expect(findFireDamageTarget(s, fuel.damage!)).toBeUndefined();
  });
  it.each(['eggUnfertilized', 'eggFertilized'] as const)('counts the building and its real %s contents separately, even when forbidden or damaged', resource => {
    const s = fixture(), before = colonyWealthDetails(s), value = box(s);
    const empty = colonyWealthDetails(s), building = constructedMarketValue(EGG_BOX_RULES.cost, EGG_BOX_RULES.work);
    expect(building).toBeCloseTo(31.2);
    expect(empty.buildingSources.facilities - before.buildingSources.facilities).toBeCloseTo(building);
    expect(empty.items).toBe(before.items); expect(empty.itemSources.containers).toBe(0);
    value.eggs = resource === 'eggFertilized' ? freshFertilizedEggs(25, 'colony') : freshBatch(resource, 25);
    const filled = colonyWealthDetails(s);
    expect(filled.itemSources.containers).toBe(175); expect(filled.items - empty.items).toBeCloseTo(175, 9);
    expect(filled.storyteller - before.storyteller).toBeCloseTo(175 + building * .5);
    value.forbidden = true; value.emptyRequested = true; value.eggs.hitPoints = 1;
    const damage = fireFuelAt(s, value).find(f => f.damage?.kind === 'eggBox')!.damage!;
    s.fireDamage.push({ ...damage, hitPoints: 1 });
    expect(colonyWealthDetails(s)).toEqual(filled);
  });
  it('preserves total item wealth when eggs move from the container onto the floor', () => {
    const s = fixture(), value = box(s); value.eggs = freshBatch('eggUnfertilized', 20);
    const filled = colonyWealthDetails(s), batch = value.eggs;
    value.eggs = null; s.items.push({ ...pos(19), ...batch, id: s.nextId++ });
    const emptied = colonyWealthDetails(s);
    expect(emptied.itemSources.containers).toBe(0);
    expect(emptied.itemSources.ground - filled.itemSources.ground).toBe(140);
    expect(emptied.items).toBe(filled.items); expect(emptied.buildings).toBe(filled.buildings);
    expect(emptied.total).toBe(filled.total);
  });
  it('excludes both the building and its contents while their cell remains unexplored', () => {
    const s = fixture(), before = colonyWealthDetails(s), value = box(s); value.eggs = freshBatch('eggUnfertilized', 20);
    s.explored[at(value)] = 0;
    const hidden = colonyWealthDetails(s);
    expect(hidden.itemSources.containers).toBe(0);
    expect(hidden.items).toBe(before.items); expect(hidden.buildings).toBe(before.buildings);
    s.explored[at(value)] = 1;
    expect(colonyWealthDetails(s).itemSources.containers).toBe(140);
  });
});
