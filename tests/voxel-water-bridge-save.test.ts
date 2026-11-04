import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, WIDTH, DEPTH, at, position, type Pos } from '../src/voxel/types';
import { FIRE_MAX_HP, fireDamageKey } from '../src/voxel/fire';
import { fireFuelAt } from '../src/voxel/fireWorld';
import { validateWater } from '../src/voxel/water';
import { advanceWeather, WEATHER_RULES } from '../src/voxel/weather';

const plane = WIDTH * DEPTH;
/** Deliberate save-boundary fixtures: the ordinary-command build/remove
 * campaign is separate. These isolate forged support and water identities. */
function bridgeFixture() {
  const simulation = new VoxelSimulation(73129, { river: 'river' });
  const cell = simulation.water.findIndex(value => value === 1), bridge = position(cell),
    surface = { ...bridge, z: bridge.z + 1 };
  simulation.blocks[cell] = Block.Wood;
  simulation.bridges[cell] = 1;
  simulation.structureKinds[cell] = 1;
  return { simulation, cell, bridge, surface };
}
function recordDamage(simulation: VoxelSimulation, target: Pos) {
  const damage = { ...target, key: fireDamageKey('block', null, target), kind: 'block' as const,
    targetId: null, hitPoints: 1, maxHitPoints: FIRE_MAX_HP.block };
  simulation.fireDamage.push(damage);
  return damage;
}
function burn(simulation: VoxelSimulation, bridge: Pos) {
  return simulation.fireDestroy(recordDamage(simulation, bridge), 'isolated bridge-fire regression');
}
function wallOnBridge() {
  const fixture = bridgeFixture(), { simulation, surface } = fixture, base = at(surface);
  simulation.blocks[base] = Block.Wood;
  simulation.blocks[base + plane] = Block.Wood;
  simulation.structureKinds[base] = 2;
  simulation.structureKinds[base + plane] = 3;
  recordDamage(simulation, surface);
  recordDamage(simulation, { ...surface, z: surface.z + 1 });
  return fixture;
}

describe('strict water and bridge save boundaries', () => {
  it('reloads the generated two-layer deep channel, shallow water, solid riverbed and dry colony without regeneration', () => {
    const simulation = new VoxelSimulation(73129, { river: 'river' });
    const before = simulation.save(), restored = VoxelSimulation.load(before);
    expect(restored.generator).toBe(4);
    expect(restored.water).toEqual(simulation.water);
    expect(restored.blocks).toEqual(simulation.blocks);
    expect(restored.spawn).toEqual(simulation.spawn);
    expect(restored.pawns.map(p => ({ x: p.x, y: p.y, z: p.z })))
      .toEqual(simulation.pawns.map(p => ({ x: p.x, y: p.y, z: p.z })));
    expect(restored.pawns.every(p => restored.standable(p))).toBe(true);
    expect(restored.water.some(value => value === 2)).toBe(true);
    expect(simulation.save()).toEqual(before);
  });

  it('migrates an authentic prior save with empty water buffers and preserves its edited terrain', () => {
    const original = JSON.parse(readFileSync(new URL('./fixtures/voxel-v41-working-before-output.json', import.meta.url), 'utf8'));
    const before = structuredClone(original), restored = VoxelSimulation.load(original);
    expect(restored.generator).toBe(original.generator);
    expect(restored.save().blocks).toEqual(original.blocks);
    expect(restored.water.every(value => value === 0)).toBe(true);
    expect(restored.bridges.every(value => value === 0)).toBe(true);
    expect(Object.hasOwn(restored.settings, 'river')).toBe(false);
    expect(original).toEqual(before);
  });

  it.each([0, 2, 3])('rejects bridge structure identity %s instead of a floor identity', identity => {
    const { simulation, cell } = bridgeFixture();
    simulation.structureKinds[cell] = identity;
    const save = simulation.save(), before = structuredClone(save);
    expect(() => VoxelSimulation.load(save)).toThrow(/水域|桥面/);
    expect(save).toEqual(before);
  });

  it('preserves a valid bridge as independent water, wooden deck and floor identity', () => {
    const { simulation, cell, surface } = bridgeFixture();
    const restored = VoxelSimulation.load(simulation.save());
    expect(restored.water[cell]).toBe(1);
    expect(restored.blocks[cell]).toBe(Block.Wood);
    expect(restored.bridges[cell]).toBe(1);
    expect(restored.structureKinds[cell]).toBe(1);
    expect(restored.standable(surface)).toBe(true);
  });

  it.each([1, 3])('rejects a deep-water column with %s voxels', depth => {
    const simulation = new VoxelSimulation(73129, { river: 'river' });
    const bottom = simulation.water.findIndex((value, i) => value === 2 && simulation.water[i - plane] !== 2);
    if (depth === 1) {
      simulation.water[bottom] = 0;
      simulation.blocks[bottom] = Block.Stone;
    } else {
      simulation.water[bottom - plane] = 2;
      simulation.blocks[bottom - plane] = Block.Air;
      simulation.blocks[bottom - plane * 2] = Block.Stone;
    }
    expect(() => validateWater(simulation.water, simulation.bridges, simulation.blocks, simulation.ladders, simulation.structureKinds))
      .toThrow(/水域/);
    expect(() => VoxelSimulation.load(simulation.save())).toThrow(/水域/);
  });

  it('rejects a forged heavy building on a bridge using the same support rule as new construction', () => {
    const { simulation, surface } = bridgeFixture();
    const command = simulation.command({ type: 'designate', tool: 'stove', from: surface });
    expect(command.ok).toBe(false);
    expect(command.message).toMatch(/轻型承载/);
    simulation.stoves.push({ ...surface, id: simulation.nextId++, target: 10, paused: false });
    expect(() => VoxelSimulation.load(simulation.save())).toThrow(/木桥|轻型承载/);
  });

  it('rejects stone walls above a bridge while preserving a supported wooden wall', () => {
    const { simulation, surface } = bridgeFixture(), base = at(surface);
    simulation.blocks[base] = Block.Wood;
    simulation.blocks[base + plane] = Block.Wood;
    simulation.structureKinds[base] = 2;
    simulation.structureKinds[base + plane] = 3;
    expect(() => VoxelSimulation.load(simulation.save())).not.toThrow();
    simulation.blocks[base] = Block.Masonry;
    simulation.blocks[base + plane] = Block.Masonry;
    expect(() => VoxelSimulation.load(simulation.save())).toThrow(/木桥|石砌/);
  });

  it('burns only the wooden bridge, leaving the water and its real bed intact and reloadable', () => {
    const { simulation, cell, bridge, surface } = bridgeFixture();
    const waterBefore = simulation.water.slice(), bed = simulation.blocks[cell - plane], stats = structuredClone(simulation.stats);
    // A standing person remains in the same cell when the deck becomes wadeable water.
    Object.assign(simulation.pawns[0], surface);
    expect(fireFuelAt(simulation, surface).some(target => target.damage?.kind === 'block' && at(target.damage) === cell)).toBe(true);
    expect(burn(simulation, bridge)).toBe(true);
    expect(simulation.blocks[cell]).toBe(Block.Air);
    expect(simulation.bridges[cell]).toBe(0);
    expect(simulation.structureKinds[cell]).toBe(0);
    expect(simulation.water).toEqual(waterBefore);
    expect(simulation.blocks[cell - plane]).toBe(bed);
    expect(simulation.pawns[0]).toMatchObject(surface);
    expect(simulation.standable(surface)).toBe(true);
    expect(simulation.stats).toEqual(stats);
    const restored = VoxelSimulation.load(simulation.save());
    expect(restored.water).toEqual(waterBefore);
    expect(restored.bridges[cell]).toBe(0);
    expect(restored.pawns[0]).toMatchObject(surface);
  });

  it('removes both wooden wall halves and stale damage/jobs when their bridge burns, preserving the riverbed', () => {
    const { simulation, cell, bridge, surface } = wallOnBridge();
    const waterBefore = simulation.water.slice(), bed = simulation.blocks[cell - plane], stats = structuredClone(simulation.stats);
    expect(simulation.command({ type: 'designate', tool: 'remove', from: surface }).ok).toBe(true);
    expect(simulation.jobs.some(job => at(job) === at(surface))).toBe(true);
    Object.assign(simulation.pawns[0], { ...surface, z: surface.z + 2 });
    expect(simulation.standable(simulation.pawns[0])).toBe(true);
    expect(burn(simulation, bridge)).toBe(true);
    for (const offset of [0, plane, plane * 2]) {
      expect(simulation.blocks[cell + offset]).toBe(Block.Air);
      expect(simulation.structureKinds[cell + offset]).toBe(0);
    }
    expect(simulation.bridges[cell]).toBe(0);
    expect(simulation.fireDamage).toEqual([]);
    expect(simulation.jobs).toEqual([]);
    expect(simulation.water).toEqual(waterBefore);
    expect(simulation.blocks[cell - plane]).toBe(bed);
    expect(simulation.pawns[0]).toMatchObject(surface);
    expect(simulation.standable(simulation.pawns[0])).toBe(true);
    expect(simulation.stats).toEqual(stats);
    const restored = VoxelSimulation.load(simulation.save());
    expect(restored.water).toEqual(waterBefore);
    expect(restored.fireDamage).toEqual([]);
    expect(restored.jobs).toEqual([]);
    expect(restored.blocks[at(surface)]).toBe(Block.Air);
  });

  it('rolls back deck, wall halves, structure identities and damage atomically if the landing resolver fails', () => {
    const { simulation, bridge, surface } = wallOnBridge();
    Object.assign(simulation.pawns[0], { ...surface, z: surface.z + 2 });
    expect(simulation.standable(simulation.pawns[0])).toBe(true);
    const damage = recordDamage(simulation, bridge), before = simulation.save();
    // Explicit failure injection isolates the rollback contract. A normal
    // shallow bridge has a legal wading landing, verified in the preceding test.
    const landing = vi.spyOn(simulation as unknown as { fireLanding(from: Pos): Pos | null }, 'fireLanding').mockReturnValue(null);
    try {
      expect(simulation.fireDestroy(damage, 'isolated landing failure')).toBe(false);
      expect(landing).toHaveBeenCalled();
      expect(simulation.save()).toEqual(before);
    } finally { landing.mockRestore(); }
    expect(() => VoxelSimulation.load(simulation.save())).not.toThrow();
  });

  it('accumulates snow on dry ground and bridge decks, never inside shallow or deep water', () => {
    const simulation = new VoxelSimulation(73129, { river: 'river', meanTemperature: -30, rainfall: 4000, latitude: 0 });
    const cell = simulation.water.findIndex(value => value === 1), bridge = position(cell), surface = { ...bridge, z: bridge.z + 1 };
    simulation.blocks[cell] = Block.Wood;
    simulation.bridges[cell] = 1;
    simulation.structureKinds[cell] = 1;
    // Advance the real deterministic weather calendar without stepping unrelated
    // colonist work; this fixture isolates surface eligibility during snowfall.
    for (let opportunity = 0; opportunity < 12 && simulation.weather.kind !== 'snow'; opportunity++) {
      simulation.tick = simulation.weather.nextTransitionTick + WEATHER_RULES.transitionTicks;
      advanceWeather(simulation.weather, simulation.seed, simulation.settings, simulation.tick, simulation.generator);
    }
    expect(simulation.weather.kind).toBe('snow');
    (simulation as unknown as { updateSnow(): void }).updateSnow();
    expect(simulation.snow.length).toBeGreaterThan(100);
    expect(simulation.snow.every(snow => simulation.water[at(snow)] === 0)).toBe(true);
    expect(simulation.snow.find(snow => at(snow) === at(surface))?.depth).toBeGreaterThan(0);
    expect(simulation.water[cell]).toBe(1);
  });

  it.each([1, 2])('rejects a forged snow layer inside water class %s without mutating the supplied save', kind => {
    const simulation = new VoxelSimulation(73129, { river: 'river' });
    const cell = simulation.water.findIndex((value, i) => value === kind && simulation.blocks[i - plane] !== Block.Air);
    expect(cell).toBeGreaterThan(-1);
    const save = simulation.save();
    save.snow.push({ ...position(cell), depth: 0.1 });
    const before = structuredClone(save);
    expect(() => VoxelSimulation.load(save)).toThrow(/天气存档无效.*积雪/);
    expect(save).toEqual(before);
  });
});
