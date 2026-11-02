import { describe, expect, it } from 'vitest';
import { VoxelRooms } from '../src/voxel/rooms';
import {
  MAX_TEMPERATURE, MIN_TEMPERATURE, THERMAL_DEFAULTS, VoxelThermal,
  type ThermalMigration, type ThermalOptions, type ThermalPortal,
} from '../src/voxel/thermal';
import { Block, CELLS, HEIGHT, index, type Door, type Pos } from '../src/voxel/types';

const pos = (x: number, y: number, z = 4): Pos => ({ x, y, z });
const solidWorld = (block: number = Block.Stone) => new Uint8Array(CELLS).fill(block);
const isolated = { wallConductance: 0, reservoirConductance: 0 };
function carve(blocks: Uint8Array, from: Pos, to = { ...from, z: from.z + 1 }) {
  for (let z = from.z; z <= to.z; z++) for (let y = from.y; y <= to.y; y++) for (let x = from.x; x <= to.x; x++)
    blocks[index(x, y, z)] = Block.Air;
}
function setup(blocks: Uint8Array, options: Partial<ThermalOptions> = {}, portals: ThermalPortal[] = [], ambient = 0) {
  const rooms = new VoxelRooms(), thermal = new VoxelThermal(options);
  rooms.rebuild(blocks, portals); thermal.sync(blocks, rooms, portals, ambient);
  return { rooms, thermal };
}
function setTemperature(thermal: VoxelThermal, p: Pos, temperature: number) {
  const current = thermal.temperatureAt(p, 0);
  thermal.pushHeat(p, (temperature - current) * CELLS, temperature);
}
function expectMigrationBalanced(migration: ThermalMigration) {
  expect(migration.afterEnergy).toBeCloseTo(migration.beforeEnergy + migration.addedEnergy + migration.enclosedEnergy -
    migration.removedEnergy - migration.exposedEnergy, 8);
}
const portal = (x: number, y = 10, kind: ThermalPortal['kind'] = 'door', axis: 'x' | 'y' = 'x'): ThermalPortal =>
  ({ ...pos(x, y), kind, axis });
const door = (p: Pos, mode: Door['mode'] = 'locked', openUntil = 0): Door => ({ ...p, id: 1, axis: 'x', mode, openUntil });

describe('cached voxel room heat and temperature control', () => {
  it('uses volume/2 capacity and returns independent snapshots', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10), pos(12, 13, 5));
    const { thermal } = setup(blocks, isolated, [], 21);
    expect(thermal.snapshot()).toEqual([{ roomId: 0, temperature: 21, capacity: 12 }]);
    const snapshot = thermal.snapshot(); snapshot[0].temperature = 999; snapshot.pop();
    expect(thermal.temperatureAt(pos(11, 11), -10)).toBe(21);
    expect(thermal.pushHeat(pos(11, 11), 24)).toBe(24);
    expect(thermal.temperatureAt(pos(11, 11), -10)).toBe(23);
  });

  it('limits positive and negative heat to targets without reversing direction', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10), pos(11, 10, 5));
    const { thermal } = setup(blocks, isolated, [], 20);
    expect(thermal.pushHeat(pos(10, 10), 1000, 25)).toBe(10);
    expect(thermal.pushHeat(pos(10, 10), 1000, 24)).toBe(0);
    expect(thermal.pushHeat(pos(10, 10), -1000, 15)).toBe(-20);
    expect(thermal.pushHeat(pos(10, 10), -1000, 16)).toBe(0);
    expect(thermal.pushHeat(pos(10, 10), 0, 100)).toBe(0);
    expect(thermal.temperatureAt(pos(10, 10), 0)).toBe(15);
  });

  it('accounts for actual heat at hard bounds and rejects nonfinite input', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10));
    const { thermal } = setup(blocks, isolated);
    expect(thermal.pushHeat(pos(10, 10), 1e10)).toBe(MAX_TEMPERATURE);
    expect(thermal.pushHeat(pos(10, 10), -1e10)).toBe(MIN_TEMPERATURE - MAX_TEMPERATURE);
    expect(thermal.temperatureAt(pos(10, 10), 0)).toBe(MIN_TEMPERATURE);
    const before = thermal.save();
    expect(() => thermal.pushHeat(pos(10, 10), NaN)).toThrow(RangeError);
    expect(() => thermal.pushHeat(pos(10, 10), 1, Infinity)).toThrow(RangeError);
    expect(() => thermal.step(-1, 20)).toThrow(RangeError);
    expect(() => thermal.step(1, NaN)).toThrow(RangeError);
    expect(thermal.save()).toEqual(before);
  });

  it('treats outdoors as an infinite reservoir, updates snapshots, and safely falls back for invalid/solid cells', () => {
    const blocks = solidWorld(); carve(blocks, pos(0, 10), pos(2, 10, 5));
    const { thermal } = setup(blocks);
    expect(thermal.pushHeat(pos(1, 10), 1000)).toBe(0);
    expect(thermal.pushHeat(pos(-1, 10), 1000)).toBe(0);
    expect(thermal.pushHeat(pos(20, 20), 1000)).toBe(0);
    for (const p of [pos(-1, 10), pos(20, 20), pos(10.5, 10), pos(0, 10)])
      expect(thermal.temperatureAt(p, 12)).toBe(12);
    const report = thermal.step(0, -17);
    expect(thermal.snapshot()[0].temperature).toBe(-17);
    expect(report).toMatchObject({ beforeEnergy: 0, afterEnergy: 0, outdoorHeat: 0, groundHeat: 0, substeps: 0 });
    expect(thermal.save()).toEqual([]);
  });
});

describe('conservative simultaneous exchanges over cached boundaries', () => {
  it('counts a shared two-high wall once and conserves heat across unequal capacities', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10)); carve(blocks, pos(12, 10), pos(14, 10, 5));
    const { thermal } = setup(blocks, { reservoirConductance: 0 });
    setTemperature(thermal, pos(10, 10), 100);
    const report = thermal.step(1, 0);
    expect(thermal.temperatureAt(pos(10, 10), 0)).toBeCloseTo(97.96, 10);
    expect(thermal.temperatureAt(pos(12, 10), 0)).toBeCloseTo(0.68, 10);
    expect(report).toMatchObject({ beforeEnergy: 100, afterEnergy: 100, outdoorHeat: 0, groundHeat: 0, substeps: 1 });
  });

  it('uses old temperatures for all edges rather than leaking twice along an in-place traversal', () => {
    const blocks = solidWorld(); for (const x of [10, 12, 14]) carve(blocks, pos(x, 10));
    const left = setup(blocks, { reservoirConductance: 0 }).thermal;
    const right = setup(blocks, { reservoirConductance: 0 }).thermal;
    setTemperature(left, pos(10, 10), 100); setTemperature(right, pos(14, 10), 100);
    left.step(1, 0); right.step(1, 0);
    expect(left.snapshot().map(room => room.temperature)).toEqual(right.snapshot().map(room => room.temperature).reverse());
    expect(left.temperatureAt(pos(14, 10), 0)).toBe(0);
    expect(left.temperatureAt(pos(12, 10), 0)).toBeCloseTo(2.04, 12);
  });

  it('subdivides a large duration, stays within old extrema, and converges to the capacity-weighted equilibrium', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10)); carve(blocks, pos(12, 10), pos(14, 10, 5));
    const { thermal } = setup(blocks, { reservoirConductance: 0 });
    setTemperature(thermal, pos(10, 10), 100);
    const report = thermal.step(10_000, 0);
    expect(report.substeps).toBeGreaterThan(1);
    expect(report.afterEnergy).toBeCloseTo(100, 9);
    for (const room of thermal.snapshot()) {
      expect(room.temperature).toBeGreaterThanOrEqual(0); expect(room.temperature).toBeLessThanOrEqual(100);
      expect(room.temperature).toBeCloseTo(25, 9);
    }
  });

  it('has bidirectional ground exchange and reports ground heat separately', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10));
    const { thermal } = setup(blocks);
    const warming = thermal.step(1, -40);
    // A two-air-cell column has ten external faces. Thick stone uses 15 C.
    expect(warming.groundHeat).toBeCloseTo(15 * 10 * 0.0051, 12);
    expect(warming.outdoorHeat).toBe(0);
    expect(warming.afterEnergy - warming.beforeEnergy).toBeCloseTo(warming.groundHeat, 12);
    setTemperature(thermal, pos(10, 10), 30);
    const cooling = thermal.step(1, 40);
    expect(cooling.groundHeat).toBeCloseTo(-warming.groundHeat, 12);
    expect(cooling.afterEnergy - cooling.beforeEnergy).toBeCloseTo(cooling.groundHeat, 12);
  });

  it('uses outdoors for thick wood and keeps mixed-reservoir heat accounting balanced', () => {
    const blocks = solidWorld(Block.Wood); carve(blocks, pos(10, 10));
    const { rooms, thermal } = setup(blocks, {}, [], 30);
    const report = thermal.step(1, 10);
    expect(report.outdoorHeat).toBeCloseTo(-20 * 10 * 0.0051, 12);
    expect(report.groundHeat).toBe(0);
    blocks[index(9, 10, 4)] = Block.Stone;
    rooms.rebuild(blocks); thermal.sync(blocks, rooms, [], 10);
    const mixed = thermal.step(100, -10);
    expect(mixed.groundHeat).not.toBe(0); expect(mixed.outdoorHeat).not.toBe(0);
    expect(mixed.afterEnergy - mixed.beforeEnergy).toBeCloseTo(mixed.groundHeat + mixed.outdoorHeat, 10);
    expect(thermal.temperatureAt(pos(10, 10), -10)).toBeGreaterThanOrEqual(-10);
    expect(thermal.temperatureAt(pos(10, 10), -10)).toBeLessThanOrEqual(30);
  });

  it('exchanges through one solid wall with an actual exterior air region', () => {
    const blocks = solidWorld(); carve(blocks, pos(0, 10)); carve(blocks, pos(2, 10));
    const { thermal } = setup(blocks, { reservoirConductance: 0 });
    setTemperature(thermal, pos(2, 10), 100);
    const report = thermal.step(1, 0);
    expect(report.outdoorHeat).toBeCloseTo(-2.04, 10);
    expect(report.afterEnergy - report.beforeEnergy).toBeCloseTo(report.outdoorHeat, 10);
    expect(thermal.temperatureAt(pos(0, 10), -12)).toBe(-12);
  });

  it('does not rescan modified blocks between explicit structural synchronizations', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10)); carve(blocks, pos(12, 10));
    const { thermal } = setup(blocks, { reservoirConductance: 0 });
    setTemperature(thermal, pos(10, 10), 100);
    blocks.fill(Block.Air);
    thermal.step(1, 0);
    expect(thermal.temperatureAt(pos(10, 10), 0)).toBeCloseTo(97.96, 12);
    expect(thermal.snapshot()).toHaveLength(2);
  });
});

describe('room topology temperature migration', () => {
  it('preserves both sides of a split and accounts for air removed by the new wall', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10), pos(14, 10, 5));
    const { rooms, thermal } = setup(blocks, isolated, [], 40);
    blocks[index(12, 10, 4)] = blocks[index(12, 10, 5)] = Block.Wood;
    rooms.rebuild(blocks);
    const migration = thermal.sync(blocks, rooms, [], -20);
    expect(thermal.snapshot().map(room => [room.temperature, room.capacity])).toEqual([[40, 2], [40, 2]]);
    expect(migration).toMatchObject({ beforeEnergy: 200, afterEnergy: 160, removedCapacity: 1, removedEnergy: 40, addedCapacity: 0 });
    expectMigrationBalanced(migration);
  });

  it('merges by overlapping air capacity and initializes newly excavated air at current outdoor temperature', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10), pos(11, 10, 5)); carve(blocks, pos(13, 10), pos(16, 10, 5));
    const { rooms, thermal } = setup(blocks, isolated, [], 0);
    setTemperature(thermal, pos(10, 10), 40); setTemperature(thermal, pos(13, 10), 80);
    carve(blocks, pos(12, 10)); rooms.rebuild(blocks);
    const migration = thermal.sync(blocks, rooms, [], 10);
    expect(thermal.snapshot()).toHaveLength(1);
    expect(thermal.temperatureAt(pos(10, 10), 10)).toBeCloseTo((2 * 40 + 4 * 80 + 10) / 7, 12);
    expect(migration).toMatchObject({ beforeEnergy: 400, afterEnergy: 410, addedCapacity: 1, addedEnergy: 10 });
    expectMigrationBalanced(migration);
  });

  it('retains an owned copy when a rebuild renumbers existing rooms', () => {
    const blocks = solidWorld(); carve(blocks, pos(20, 20));
    const { rooms, thermal } = setup(blocks, isolated, [], 70);
    carve(blocks, pos(10, 10)); rooms.rebuild(blocks);
    thermal.sync(blocks, rooms, [], 5);
    expect(thermal.temperatureAt(pos(20, 20), 5)).toBe(70);
    expect(thermal.temperatureAt(pos(10, 10), 5)).toBe(5);
    expect(rooms.roomAt(pos(20, 20))?.id).toBe(1);
  });

  it('preserves fractional and lower-bound temperatures exactly across unchanged topology and splits', () => {
    for (const temperature of [0.1, MIN_TEMPERATURE]) {
      const blocks = solidWorld(); carve(blocks, pos(10, 10), pos(30, 20, 5));
      const { rooms, thermal } = setup(blocks, isolated, [], temperature);
      expect(thermal.temperatureAt(pos(10, 10), 0)).toBe(temperature);
      rooms.rebuild(blocks); thermal.sync(blocks, rooms, [], 20);
      expect(thermal.temperatureAt(pos(10, 10), 0)).toBe(temperature);
      for (let y = 10; y <= 20; y++) for (const z of [4, 5]) blocks[index(20, y, z)] = Block.Wood;
      rooms.rebuild(blocks); thermal.sync(blocks, rooms, [], 20);
      expect(thermal.snapshot().map(room => room.temperature)).toEqual([temperature, temperature]);
    }
  });

  it('uses current outdoors when enclosing outdoor air and accounts for exposure separately', () => {
    const blocks = solidWorld(); carve(blocks, pos(0, 10), pos(5, 10, 5));
    const { rooms, thermal } = setup(blocks, isolated, [], 20);
    blocks[index(1, 10, 4)] = blocks[index(1, 10, 5)] = Block.Wood;
    rooms.rebuild(blocks);
    const enclosed = thermal.sync(blocks, rooms, [], 7);
    expect(thermal.temperatureAt(pos(4, 10), 7)).toBe(7);
    expect(enclosed).toMatchObject({ beforeEnergy: 0, afterEnergy: 28, enclosedCapacity: 4, enclosedEnergy: 28, addedCapacity: 0 });
    expectMigrationBalanced(enclosed);
    carve(blocks, pos(1, 10)); rooms.rebuild(blocks);
    const exposed = thermal.sync(blocks, rooms, [], -5);
    expect(exposed).toMatchObject({ beforeEnergy: 28, afterEnergy: 0, exposedCapacity: 4, exposedEnergy: 28 });
    expectMigrationBalanced(exposed); expect(thermal.temperatureAt(pos(4, 10), -5)).toBe(-5);
  });

  it('accounts for entirely removed rooms, including negative sensible heat', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10));
    const { rooms, thermal } = setup(blocks, isolated, [], -20);
    blocks.fill(Block.Stone); rooms.rebuild(blocks);
    const migration = thermal.sync(blocks, rooms, [], 10);
    expect(thermal.snapshot()).toEqual([]);
    expect(migration).toMatchObject({ beforeEnergy: -20, afterEnergy: 0, removedCapacity: 1, removedEnergy: -20 });
    expectMigrationBalanced(migration);
  });
});

describe('door and cooler portals', () => {
  function pair() {
    const blocks = solidWorld(); carve(blocks, pos(10, 10), pos(12, 10, 5));
    return { blocks, p: portal(11) };
  }

  it('uses mean-based closed door exchange and faster open exchange without joining room IDs', () => {
    const { blocks, p } = pair();
    const closed = setup(blocks, isolated, [p]).thermal, opened = setup(blocks, isolated, [p]).thermal;
    setTemperature(closed, pos(10, 10), 100); setTemperature(opened, pos(10, 10), 100);
    const report = closed.step(1, 0, [door(p)], 10); opened.step(1, 0, [door(p, 'open')], 10);
    expect(closed.temperatureAt(pos(10, 10), 0)).toBeCloseTo(100 - 50 * THERMAL_DEFAULTS.doorClosedRate, 12);
    expect(opened.temperatureAt(pos(10, 10), 0)).toBeLessThan(closed.temperatureAt(pos(10, 10), 0));
    expect(opened.temperatureAt(pos(10, 10), 0)).toBeGreaterThanOrEqual(50);
    expect(report.afterEnergy).toBeCloseTo(report.beforeEnergy, 12);
    expect(closed.snapshot()).toHaveLength(2);
    expect(closed.temperatureAt(p, 0)).toBe(50);
    expect(closed.temperatureAt({ ...p, z: 5 }, 0)).toBe(50);
    expect(closed.pushHeat(p, 100)).toBe(0);
  });

  it('honors automatic door timing and treats locked doors as closed even with future openUntil', () => {
    const { blocks, p } = pair();
    const run = (mode: Door['mode'], tick: number) => {
      const { thermal } = setup(blocks, isolated, [p]); setTemperature(thermal, pos(10, 10), 100);
      thermal.step(0.05, 0, [door(p, mode, 100)], tick); return thermal.save();
    };
    expect(run('auto', 100)).toEqual(run('open', 100));
    expect(run('auto', 101)).toEqual(run('locked', 50));
    expect(run('auto', 100)).not.toEqual(run('auto', 101));
  });

  it('deduplicates four-way door neighbors across head/foot and preserves conservative unweighted mean exchange', () => {
    const blocks = solidWorld(), p = portal(20, 20);
    carve(blocks, p);
    for (const [x, y] of [[19, 20], [21, 20], [20, 19], [20, 21]]) carve(blocks, pos(x, y));
    const { thermal } = setup(blocks, isolated, [p]);
    setTemperature(thermal, pos(19, 20), 100);
    const report = thermal.step(1, 0, [door(p)], 10);
    expect(thermal.temperatureAt(pos(19, 20), 0)).toBeCloseTo(88, 10);
    for (const [x, y] of [[21, 20], [20, 19], [20, 21]]) expect(thermal.temperatureAt(pos(x, y), 0)).toBeCloseTo(4, 10);
    expect(thermal.temperatureAt(p, 0)).toBe(25);
    expect(report.afterEnergy).toBeCloseTo(report.beforeEnergy, 10);
  });

  it('uses cooler axis as the normal and leaves perpendicular rooms thermally disconnected', () => {
    const blocks = solidWorld(), p = portal(20, 20, 'cooler', 'x');
    carve(blocks, p);
    for (const [x, y] of [[19, 20], [21, 20], [20, 19], [20, 21]]) carve(blocks, pos(x, y));
    const { thermal } = setup(blocks, { reservoirConductance: 0 }, [p]);
    setTemperature(thermal, pos(19, 20), 100);
    thermal.step(1, 0);
    expect(thermal.temperatureAt(pos(19, 20), 0)).toBeCloseTo(97.96, 10);
    expect(thermal.temperatureAt(pos(21, 20), 0)).toBeCloseTo(2.04, 10);
    expect(thermal.temperatureAt(pos(20, 19), 0)).toBe(0);
    expect(thermal.temperatureAt(pos(20, 21), 0)).toBe(0);
  });

  it('produces identical results regardless of supplied portal/door order', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10), pos(14, 10, 5));
    const portals = [portal(11), portal(13)];
    const first = setup(blocks, isolated, portals).thermal;
    const second = setup(blocks, isolated, [...portals].reverse()).thermal;
    for (const thermal of [first, second]) setTemperature(thermal, pos(10, 10), 100);
    first.step(10, 0, portals.map(p => door(p, 'open')), 10);
    second.step(10, 0, [...portals].reverse().map(p => door(p, 'open')), 10);
    expect(first.snapshot()).toEqual(second.snapshot());
    expect(first.memoryBytes).toBe(second.memoryBytes);
  });
});

describe('thermal save/restore and resource bounds', () => {
  it('round-trips indoor anchors and temperatures and resumes the same exchange', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10)); carve(blocks, pos(12, 10)); carve(blocks, pos(0, 20));
    const first = setup(blocks), second = setup(blocks);
    setTemperature(first.thermal, pos(10, 10), 80); setTemperature(first.thermal, pos(12, 10), -10);
    const records = JSON.parse(JSON.stringify(first.thermal.save()));
    expect(records).toHaveLength(2);
    second.thermal.restore(records, second.rooms, 0);
    expect(second.thermal.snapshot()).toEqual(first.thermal.snapshot());
    expect(second.thermal.step(5, 7)).toEqual(first.thermal.step(5, 7));
    expect(second.thermal.snapshot()).toEqual(first.thermal.snapshot());
    records[0].temperature = 999;
    expect(second.thermal.save()).not.toEqual(records);
  });

  it('rejects malformed, outdoor, and conflicting anchors atomically', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10), pos(11, 10, 5)); carve(blocks, pos(0, 20));
    const { thermal, rooms } = setup(blocks, {}, [], 30), before = thermal.snapshot();
    for (const records of [
      [{ cell: -1, temperature: 20 }], [{ cell: CELLS, temperature: 20 }],
      [{ cell: index(10, 10, 4), temperature: NaN }], [{ cell: index(10, 10, 4), temperature: 1001 }],
      [{ cell: index(0, 20, 4), temperature: 10 }], [{ cell: index(20, 20, 4), temperature: 10 }],
      [{ cell: index(10, 10, 4), temperature: 10 }, { cell: index(11, 10, 4), temperature: 20 }],
    ]) {
      expect(() => thermal.restore(records, rooms, 0)).toThrow(RangeError);
      expect(thermal.snapshot()).toEqual(before);
    }
    thermal.restore([], rooms, -5);
    expect(thermal.temperatureAt(pos(10, 10), -5)).toBe(-5);
  });

  it('rejects malformed structural inputs before changing cached state', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10));
    const { thermal, rooms } = setup(blocks, isolated, [], 20), before = thermal.snapshot();
    expect(() => thermal.sync(new Uint8Array(CELLS - 1), rooms, [], 0)).toThrow(RangeError);
    expect(() => thermal.sync(blocks, rooms, [{ ...portal(10), z: HEIGHT - 1 }], 0)).toThrow(RangeError);
    expect(() => thermal.sync(blocks, rooms, [portal(10)], 0)).toThrow(RangeError);
    expect(thermal.snapshot()).toEqual(before);
    expect(() => new VoxelThermal({ wallConductance: -1 })).toThrow(RangeError);
    expect(() => new VoxelThermal({ groundTemperature: NaN })).toThrow(RangeError);
  });

  it('reports all owned typed-array bytes and reuses the same budget during updates', () => {
    const blocks = solidWorld(); carve(blocks, pos(10, 10)); carve(blocks, pos(12, 10));
    const { thermal } = setup(blocks, { reservoirConductance: 0 });
    // Owned grid: 4 bytes/cell. Rooms: capacity,temp,delta,totalG (4*8),
    // anchor (4), outdoor (1). One aggregate edge: a,b,door (3*4), g,activeG (2*8).
    expect(thermal.memoryBytes).toBe(CELLS * 4 + 2 * 37 + 28);
    const bytes = thermal.memoryBytes;
    for (let tick = 0; tick < 100; tick++) thermal.step(0.05, 10, [], tick);
    expect(thermal.memoryBytes).toBe(bytes);
    const { rooms } = setup(blocks); thermal.sync(blocks, rooms, [], 10);
    expect(thermal.memoryBytes).toBe(bytes);
  });
});
