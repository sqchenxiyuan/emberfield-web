import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, index, type Pos } from '../src/voxel/types';
import { freshBatch } from '../src/voxel/preservation';
import { LIVING_RULES } from '../src/voxel/living';

const pos = (x: number, y = 10, z = 8): Pos => ({ x, y, z });
/** Controlled capacity fixture: every floor cell is occupied by a full wood
 * stack except one food stack. All subsequent eating uses ordinary ticks. */
function groundMeal() {
  let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  s.animals = []; s.grass = []; s.items = []; s.trees = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 12; x++) for (let y = 10; y <= 12; y++) {
    s.blocks[index(x, y, 8)] = s.blocks[index(x, y, 9)] = Block.Air;
    s.items.push({ ...pos(x, y), ...freshBatch(x === 12 && y === 10 ? 'food' : 'wood',
      x === 12 && y === 10 ? 10 : 75), id: s.nextId++ });
  }
  s.spawn = pos(10);
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(10 + i, 12)); p.schedule.fill('work'); p.rest = 90; p.food = 90;
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
  }
  s.pawns[0].cargo = freshBatch('wood', 20); s.pawns[0].food = 20;
  s = VoxelSimulation.load(s.save());
  for (let n = 0; n < 500 && s.pawns[0].living.mealTask === null; n++) s.step();
  const p = s.pawns[0], task = p.living.mealTask;
  expect(task?.sourceId).not.toBeNull(); expect(task?.stage).toBe('chew');
  expect(p.cargo).toEqual({ resource: 'wood', amount: 20 });
  expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  return { s, p, source: s.items.find(i => i.id === task!.sourceId)! };
}

describe('living interruptions and phase compatibility', () => {
  it.each(['trade', 'fire'] as const)('invalidates a ground meal atomically when %s removes its food', event => {
    const { s, p, source } = groundMeal();
    if (event === 'fire') s.fireBurnGround(source.id, source.amount);
    else s.tradeApplyPlacement({ items: s.items.filter(i => i.id !== source.id), nextId: s.nextId });
    expect(p.living.mealTask).toBeNull(); expect(p.cargo).toEqual({ resource: 'wood', amount: 20 });
    expect(s.stats.eaten).toBe(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('keeps a valid ground reservation after only unreserved surplus is removed', () => {
    const { s, p, source } = groundMeal();
    s.tradeApplyPlacement({ items: s.items.map(i => i.id === source.id ? { ...i, amount: 1 } : i), nextId: s.nextId });
    expect(p.living.mealTask?.amount).toBe(1);
    for (let n = 0; n < LIVING_RULES.chewTicks + 5 && s.stats.eaten === 0; n++) s.step();
    expect(s.stats.eaten).toBe(1); expect(p.cargo).toEqual({ resource: 'wood', amount: 20 });
    expect(s.items.some(i => i.id === source.id)).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('actual beds give equal comfort to sleeping colonists, sleeping prisoners and downed patients', () => {
    for (const phase of ['rest', 'prisoner', 'downed'] as const) {
      const s = new VoxelSimulation(73129), p = s.pawns[0];
      const bed = { ...pos(10), id: s.nextId++, axis: 'x' as const, owner: p.id,
        quality: 2 as const, medical: phase === 'downed', prisoner: phase === 'prisoner' };
      s.beds.push(bed); Object.assign(p, pos(10)); p.phase = phase;
      p.sleepBedId = bed.id; p.sleepingSince = phase === 'downed' ? null : 0;
      p.downed = phase === 'downed'; p.faction = phase === 'prisoner' ? 'prisoner' : 'colony';
      p.living.comfort = 50; s.tick = 1;
      // Isolate the shared needs update from unrelated prisoner and trauma AI.
      (s as any).updateLiving();
      expect(p.living.comfort, phase).toBeCloseTo(50 + LIVING_RULES.comfortRisePerTick);
      expect(p.living.memories, phase).toEqual([]);
    }
  });
  it('freezes a deceased pawn comfort and historical expired memories', () => {
    const { s, p } = groundMeal();
    // Living update must not refresh, prune or lower a frozen corpse state.
    p.dead = true; p.living.mealTask = null; p.living.comfort = 80;
    p.living.memories = [{ kind: 'ateWithoutTable', stage: 0, expires: 1 }];
    p.living.sleepThoughtAt = null;
    const before = structuredClone(p.living); s.tick += DAY;
    (s as any).updateLiving(); expect(p.living).toEqual(before);
  });
});
