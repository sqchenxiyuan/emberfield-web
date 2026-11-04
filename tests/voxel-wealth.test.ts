import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, CELLS, index, type Job, type Pawn } from '../src/voxel/types';
import { makeApparel } from '../src/voxel/apparel';
import { initialTrauma, type MissingPart } from '../src/voxel/injuries';
import { SKILL_KEYS } from '../src/voxel/skills';
import { apparelMarketValue, colonyWealth, colonyWealthDetails, constructedMarketValue, itemMarketValue,
  pawnMarketValue, structureMarketValue, summaryHealthPercent, unityRound, weaponMarketValue } from '../src/voxel/wealth';

function fixture() {
  const sim = new VoxelSimulation(9701, { biome: 'temperate', hilliness: 'flat', meanTemperature: 20, latitude: 0, rainfall: 1000 }, false, 2) /* Controlled geometry: historical full visibility. */;
  const pawn = sim.pawns[0];
  pawn.trauma = initialTrauma(); pawn.worn = []; pawn.weapon = null; pawn.cargo = null;
  for (const key of SKILL_KEYS) pawn.skills[key].level = 0;
  // Isolated terrain fixture excludes the newly spawned wildlife.
  sim.animals = [];
  sim.blocks.fill(Block.Air); sim.ladders.fill(0); sim.items = []; sim.pawns = [pawn];
  sim.jobs = []; sim.beds = []; sim.doors = []; sim.stoves = []; sim.stonecutters = []; sim.tailors = [];
  sim.researchBenches = []; sim.sandbags = []; sim.wires = []; sim.weaponBenches = []; sim.devices = [];
  (sim as VoxelSimulation & { structureKinds: Uint8Array }).structureKinds = new Uint8Array(CELLS);
  return { sim, pawn };
}
describe('source market formulas and explicit voxel wealth mappings', () => {
  it('uses ties-to-even and applies quality gain cap and HP before final price rounding', () => {
    expect([.5, 1.5, 2.5, -1.5, -2.5].map(unityRound)).toEqual([0, 2, 2, -2, -2]);
    expect(itemMarketValue(202.5)).toBe(200);
    expect(itemMarketValue(207.5)).toBe(210);
    expect(itemMarketValue(1000, 6, 1)).toBe(4000);
    expect(itemMarketValue(1000, 6, .5)).toBe(400);
    expect(itemMarketValue(100, 6, .6)).toBe(250);
    expect(itemMarketValue(100, 2, .9)).toBe(100);
    expect(itemMarketValue(100, 2, .5, true)).toBe(1);
  });
  it('prices native selected weapons from unrounded material and work base', () => {
    expect(weaponMarketValue({ id: 1, kind: 'woodClub', quality: 2, hitPoints: 65 })).toBeCloseTo(51.024, 9);
    expect(weaponMarketValue({ id: 2, kind: 'steelKnife', quality: 2, hitPoints: 100 })).toBeCloseTo(63.48, 9);
    expect(weaponMarketValue({ id: 3, kind: 'steelLongsword', quality: 2, hitPoints: 100 })).toBe(255);
    expect(weaponMarketValue({ id: 3, kind: 'steelLongsword', quality: 2, hitPoints: 50 })).toBeCloseTo(25.48, 9);
    expect(weaponMarketValue({ id: 4, kind: 'revolver', quality: 2, hitPoints: 100 })).toBeCloseTo(135.4, 9);
    expect(weaponMarketValue({ id: 5, kind: 'machinePistol', quality: 2, hitPoints: 100 })).toBe(220);
    expect(apparelMarketValue(makeApparel(6, 'tuque', 2))).toBeCloseTo(34.32, 9);
  });
  it('preserves a physical stack through ground, carry and delivered-container transfer', () => {
    const { sim, pawn } = fixture();
    sim.items.push({ id: 100, x: 1, y: 1, z: 8, resource: 'steel', amount: 10 });
    const before = colonyWealth(sim);
    expect(before.items).toBe(19);
    pawn.cargo = sim.items.pop()!;
    expect(colonyWealth(sim)).toEqual(before);
    pawn.cargo = null;
    sim.jobs.push({ delivered: { steel: 10 }, deliveredBatches: [{ resource: 'steel', amount: 10 }] } as unknown as Job);
    expect(colonyWealth(sim)).toEqual(before);
    sim.jobs[0].delivered = { grain: 10 };
    sim.jobs[0].deliveredBatches = [{ resource: 'grain', crop: 'rice', amount: 10, rotProgress: 0 }];
    expect(colonyWealth(sim).items).toBe(11);
  });
  it('includes colony equipment once, excludes enemy held items and records zero-valued corpse scope', () => {
    const { sim, pawn } = fixture();
    pawn.weapon = { id: 101, kind: 'revolver', quality: 2, hitPoints: 100 };
    pawn.worn = [makeApparel(102, 'tuque', 2)];
    pawn.cargo = { resource: 'herb', amount: 2 };
    const enemy = structuredClone(pawn); enemy.id = 200; enemy.faction = 'raider';
    sim.pawns.push(enemy);
    expect(colonyWealth(sim).items).toBeCloseTo(189.72, 9);
    pawn.dead = true;
    const after = colonyWealthDetails(sim);
    expect(after.pawns).toBe(0);
    expect(after.items).toBeCloseTo(158.832, 9);
    expect(after.unvaluedCorpses).toBe(1);
    enemy.dead = true;
    expect(colonyWealthDetails(sim).items).toBe(after.items);
  });
  it('values structures by retained identity, halves a two-cell wall and reports unknown legacy cells', () => {
    const { sim } = fixture(); sim.pawns = [];
    const kinds = (sim as VoxelSimulation & { structureKinds: Uint8Array }).structureKinds;
    const a = index(2, 2, 8), b = index(2, 2, 9), c = index(3, 2, 7), old = index(4, 2, 8);
    sim.blocks[a] = Block.Wood; kinds[a] = 2;
    sim.blocks[b] = Block.Wood; kinds[b] = 3;
    sim.blocks[c] = Block.Wood; kinds[c] = 1;
    sim.blocks[old] = Block.Masonry;
    const full = colonyWealthDetails(sim);
    expect(full.buildings).toBeCloseTo(8.064 + 4.086 + 7.92, 9);
    expect(full.legacyStructureCells).toBe(1);
    sim.blocks[b] = Block.Air; kinds[b] = 0;
    expect(full.buildings - colonyWealth(sim).buildings).toBeCloseTo(4.032, 9);
    expect(structureMarketValue('stone', 'floor')).toBeCloseTo(7.56, 9);
    expect(full.storyteller).toBe(full.buildings / 2);
  });
  it('does not value loaded fuel or multiply a facility by its footprint or damage', () => {
    const { sim } = fixture(); sim.pawns = [];
    sim.devices.push({ id: 1, x: 2, y: 2, z: 8, axis: 'x', kind: 'generator', on: false,
      fuel: 0, energy: 0, target: 20, powered: false, active: false, networkId: null, watts: 0, reason: '' });
    const initial = colonyWealth(sim);
    expect(initial.buildings).toBe(265);
    sim.devices[0].fuel = 75; sim.devices[0].energy = 600;
    expect(colonyWealth(sim)).toEqual(initial);
    sim.sandbags.push({ id: 2, x: 9, y: 9, z: 8, hitPoints: 1 });
    expect(colonyWealth(sim).buildings - initial.buildings).toBeCloseTo(8.148, 9);
    expect(constructedMarketValue({ wood: 45 }, 187)).toBeCloseTo(56.016, 9);
  });
  it('uses injury-product summary health and keeps infection distinct from that source field', () => {
    const { pawn } = fixture();
    pawn.trauma.wounds = [1, 2].map(id => ({ id, part: 'torso', kind: 'cut', severity: 37.5, ageTicks: 0, tendQuality: null }));
    expect(summaryHealthPercent(pawn)).toBe(.25);
    pawn.trauma.wounds.push({ ...pawn.trauma.wounds[0], id: 3, severity: 500 });
    expect(summaryHealthPercent(pawn)).toBe(.05);
    pawn.trauma = initialTrauma();
    pawn.medical.infections.push({ id: 300, part: 'torso', severity: .5 } as never);
    expect(summaryHealthPercent(pawn)).toBe(1);
    pawn.dead = true; expect(summaryHealthPercent(pawn)).toBe(0);
  });
  it('does not multiply a missing common ancestor and its descendant twice, and old stumps stop impacting summary health', () => {
    const { pawn } = fixture();
    const make = (id: number, part: MissingPart['part']): MissingPart => ({ id, part, ageTicks: 0, isFresh: true, lastInjuryKind: 'cut', tendQuality: null, legacyWounds: [] });
    pawn.trauma.missingParts = [make(1, 'leftArm')];
    const one = summaryHealthPercent(pawn);
    pawn.trauma.missingParts.push(make(2, 'leftHand'));
    expect(summaryHealthPercent(pawn)).toBe(one);
    for (const stump of pawn.trauma.missingParts) stump.isFresh = false;
    expect(summaryHealthPercent(pawn)).toBe(1);
  });
  it('prices healthy adult humans using source average-skill curve with the explicit nine-skill project subset', () => {
    const { pawn } = fixture();
    expect(pawnMarketValue(pawn)).toBe(350);
    for (const key of SKILL_KEYS) pawn.skills[key].level = 20;
    expect(pawnMarketValue(pawn)).toBe(5250);
    pawn.dead = true; expect(pawnMarketValue(pawn)).toBe(0);
  });
});
