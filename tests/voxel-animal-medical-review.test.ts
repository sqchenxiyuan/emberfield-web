import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { newTraderAnimal } from '../src/voxel/animalTrade';
import { injureAnimal } from '../src/voxel/animalMedical';
import { Block, index, type AnimalSpecies, type VoxelSave } from '../src/voxel/types';

const pos = (x: number, y = 16) => ({ x, y, z: 8 });
let baseline: VoxelSave | undefined;
function hospital(species: AnimalSpecies = 'alpaca') {
  if (!baseline) {
    const s = new VoxelSimulation(73129, { biome: 'temperate', hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
    s.animals = []; s.grass = []; s.items = []; s.trees = []; s.stockpiles = []; s.beds = [];
    s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0); s.explored.fill(1);
    for (let x = 10; x <= 35; x++) for (let y = 10; y <= 24; y++) for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
    s.spawn = pos(18); s.homeArea.clear();
    for (const [i, p] of s.pawns.entries()) {
      Object.assign(p, pos(16, 16 + i)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
      for (const k of Object.keys(p.priorities)) p.priorities[k as keyof typeof p.priorities] = 0;
    }
    baseline = s.save();
  }
  const s = VoxelSimulation.load(baseline);
  const a = newTraderAnimal(s.nextId++, species, 'female', s.tick, pos(25)); a.faction = 'colony'; s.animals = [a];
  expect(s.command({ type: 'designate', tool: 'animalBed', from: pos(29) }).ok).toBe(true);
  injureAnimal(a, 3, 'bruise'); s.step();
  expect(a.phase).toBe('medicalRest'); expect(a.medical.bedId).toBe(s.animalBeds[0].id);
  return { s, a, bed: s.animalBeds[0] };
}

describe('animal medical interruption review regressions', () => {
  it('keeps a mobile patient saveable when its reserved bed becomes occupied before retry', () => {
    const { s, a, bed } = hospital();
    const occupant = newTraderAnimal(s.nextId++, 'alpaca', 'male', s.tick, bed); occupant.faction = 'colony';
    occupant.decisionTick = s.tick + 100; s.animals.push(occupant);
    expect(a.decisionTick).toBeGreaterThan(s.tick + 1);
    s.step(); expect(a.medical.bedId).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('keeps a medical hare saveable immediately after assigning an allowed area while paused', () => {
    const { s, a } = hospital('hare');
    expect(s.command({ type: 'animalAreaCreate', name: '护理活动区' }).ok).toBe(true);
    expect(s.command({ type: 'animalAreaAssign', animalId: a.id, areaId: s.animalAreas[0].id }).ok).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
});
