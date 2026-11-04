import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { newTraderAnimal } from '../src/voxel/animalTrade';
import { freshBatch } from '../src/voxel/preservation';
import { EGG_RULES } from '../src/voxel/animalEggs';
import { Block, at, index, type VoxelSave } from '../src/voxel/types';

const pos = (x: number, y = 16) => ({ x, y, z: 8 });
let baseline: VoxelSave | undefined;
function colony() {
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
  const a = newTraderAnimal(s.nextId++, 'chicken', 'female', s.tick, pos(25));
  a.faction = 'colony'; a.reason = '殖民地动物'; s.animals = [a];
  return { s, a };
}
afterEach(() => vi.restoreAllMocks());

describe('animal environmental integration review regressions', () => {
  it('keeps hungry ambulatory temperature patients able to obtain physical food when no medical bed exists', () => {
    const { s, a } = colony();
    a.environment.hypothermia = .2; a.hunger = 20;
    s.items.push({ ...pos(26), ...freshBatch('grain', 20), id: s.nextId++ });
    // Controlled local climate isolates the medical scheduling issue. Physical
    // terrain, food routing, eating, inventory and save validation are real.
    vi.spyOn(s, 'temperature').mockImplementation(p => p.x >= 24 ? -30 : 22);
    expect(s.animalBeds).toEqual([]); expect(a.medical.wounds).toEqual([]);
    s.step(220);
    expect(a.medical.downed).toBe(false);
    expect(s.stats.consumed.grain).toBeGreaterThan(0);
    expect(a.hunger).toBeGreaterThan(20);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('retains environmental refuge after arrival even when injury tending is disabled', () => {
    const { s, a } = colony();
    // A two-cell chamber gives the animal one warm refuge and one hazardous
    // cell. Keeping actual neighbours rules out a mocked navigation shortcut.
    for (let x = 24; x <= 27; x++) for (let y = 15; y <= 17; y++) for (let z = 8; z < 11; z++) s.blocks[index(x, y, z)] = Block.Stone;
    for (const x of [25, 26]) for (let z = 8; z <= 9; z++) s.blocks[index(x, 16, z)] = Block.Air;
    s.revision++;
    a.environment.hypothermia = .4; a.medical.policy = 'none'; a.hunger = 100;
    vi.spyOn(s, 'temperature').mockImplementation(p => at(p) === at(pos(25)) ? -80 : 22);
    s.step();
    expect(at(a)).toBe(at(pos(26)));
    expect(a.environment.hypothermia).toBe(.4);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    s.step();
    expect(at(a)).toBe(at(pos(26)));
    expect(a.environment.hypothermia).toBe(.4);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('keeps an environmental route saveable after a real projectile-hit callback interrupts its phase', () => {
    const { s, a } = colony();
    a.environment.hypothermia = .4; a.hunger = 100;
    vi.spyOn(s, 'temperature').mockImplementation(p => p.x >= 30 ? 22 : -80);
    s.step();
    expect(a.phase).toBe('shelter'); expect(a.goal?.kind).toBe('shelter');
    expect(a.path.length).toBeGreaterThan(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    // Use the actual hit callback; projectile trajectory and hit probability
    // are outside this narrowly scoped state-transition regression.
    (s as any).damageAnimal({ shooterId: s.pawns[0].id, targetId: a.id, damage: 1 }, a);
    s.step();
    expect(a.phase).toBe('flee'); expect(a.goal).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('walks an unsafe wild animal to a real map edge before removing it once', () => {
    const { s, a } = colony();
    for (let x = 0; x <= 10; x++) for (let z = 8; z <= 9; z++) s.blocks[index(x, 16, z)] = Block.Air;
    s.revision++; Object.assign(a, pos(4), { faction: 'wild', tameness: 0 });
    vi.spyOn(s, 'temperature').mockReturnValue(-60);
    s.step();
    expect(s.animals).toContain(a); expect(a.goal?.kind).toBe('climateExit');
    expect(a.x).toBe(3); expect(a.phase).toBe('shelter');
    expect(VoxelSimulation.load(s.save()).animals[0]).toEqual(a);
    for (let i = 0; i < 500 && s.animals.includes(a); i++) {
      const before = { x: a.x, y: a.y, z: a.z }; s.step();
      expect(Math.abs(a.x - before.x) + Math.abs(a.y - before.y) + Math.abs(a.z - before.z)).toBeLessThanOrEqual(1);
    }
    expect(a.x).toBe(0); expect(s.animals).not.toContain(a); expect(a.dead).toBe(false);
    s.step(10);
    expect(s.husbandryLog.filter(e => e.kind === 'escaped' && e.animalId === a.id)).toHaveLength(1);
    expect(s.items.some(item => item.resource === 'carcass')).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('lays in its refuge rather than repeatedly seeking a dangerous egg box', () => {
    const { s, a } = colony();
    a.environment.hypothermia = .4; a.medical.policy = 'none'; a.eggProgress = 1;
    s.eggBoxes.push({ ...pos(26), id: s.nextId++, eggs: null, emptyRequested: false, forbidden: false });
    vi.spyOn(s, 'temperature').mockImplementation(p => at(p) === at(pos(25)) ? 22 : -80);
    s.step();
    expect(a.goal).toEqual({ kind: 'layEgg', id: at(pos(25)) });
    s.step(EGG_RULES.layWork + 5);
    expect(s.stats.produced.eggUnfertilized).toBe(1);
    expect(s.eggBoxes[0].eggs).toBeNull(); expect(at(a)).toBe(at(pos(25)));
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
});
