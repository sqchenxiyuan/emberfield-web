import { stripRangedDefaults } from './legacy-ranged-defaults';
import { legacySimulation } from './fixtures/legacy-start';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { initialStoryteller } from '../src/voxel/storyteller';
import { initialTrade } from '../src/voxel/trade';
import { initialFireHazards } from '../src/voxel/fire';
import { initialWeather } from '../src/voxel/weather';
import { freshBatch } from '../src/voxel/preservation';
import { VoxelThermal } from '../src/voxel/thermal';
import { temperatureAt } from '../src/voxel/farming';
import {
  Block,
  DAY,
  HEIGHT,
  TPS,
  at,
  deviceCells,
  index,
  type Counts,
  type Device,
  type DeviceKind,
  type Pos,
  type Resource,
  type VoxelCommand,
  type VoxelSave,
} from '../src/voxel/types';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
function carve(sim: VoxelSimulation, from: Pos, to = { ...from, z: from.z + 1 }) {
  for (let z = from.z; z <= to.z; z++)
    for (let y = from.y; y <= to.y; y++)
      for (let x = from.x; x <= to.x; x++) sim.blocks[index(x, y, z)] = Block.Air;
}
function addDevice(sim: VoxelSimulation, kind: DeviceKind, p: Pos, extra: Partial<Device> = {}) {
  const device: Device = {
    ...p,
    id: sim.nextId++,
    kind,
    axis: 'x',
    on: true,
    fuel: 0,
    energy: 0,
    target: 21,
    powered: false,
    active: false,
    networkId: null,
    watts: 0,
    reason: '',
    ...extra,
  };
  sim.devices.push(device);
  return device;
}
/** Isolated integration fixtures: engineered terrain/devices/material delivery
 * are intentionally injected. They are NOT normal resource-gathering campaigns.
 * Loading the serialized fixture exercises the actual production cache rebuilds.
 */
function fixture(configure: (sim: VoxelSimulation) => void = () => {}) {
  const source = legacySimulation();
  source.blocks.fill(Block.Stone);
  source.ladders.fill(0);
  source.items = [];
  source.trees = [];
  source.jobs = [];
  source.stockpiles = [];
  source.farms = [];
  source.crops = [];
  source.stoves = [];
  source.beds = [];
  source.doors = [];
  carve(source, pos(45, 45), pos(49, 47, 9));
  for (let i = 0; i < source.pawns.length; i++) {
    Object.assign(source.pawns[i], pos(45 + i, 46));
    source.pawns[i].priorities = {
      handle: 0, firefight: 0, clean: 0,
      warden: 0,
      hunt: 0,
      dig: 0,
      build: 0,
      cut: 0,
      haul: 0,
      grow: 0,
      cook: 0,
      craft: 0,
      care: 0,
      research: 0,
    };
  }
  configure(source);
  return VoxelSimulation.load(source.save());
}
function insulate(sim: VoxelSimulation) {
  // Passive transport is separately verified in voxel-thermal.test.ts. Disable
  // it here to measure world/device heat application without wall/soil leakage.
  sim.thermal = new VoxelThermal({ wallConductance: 0, reservoirConductance: 0 });
  sim.thermal.sync(
    sim.blocks,
    sim.rooms,
    [
      ...sim.doors.map((d) => ({ ...d, kind: 'door' as const })),
      ...sim.devices
        .filter((d) => d.kind === 'cooler')
        .map((d) => ({ ...d, kind: 'cooler' as const })),
    ],
    temperatureAt(sim.tick),
  );
}
function setTemperature(sim: VoxelSimulation, p: Pos, temperature: number) {
  sim.thermal.pushHeat(p, (temperature - sim.temperature(p)) * 1e7, temperature);
}
function capacity(sim: VoxelSimulation, p: Pos) {
  return sim.rooms.roomAt(p)!.volume / 2;
}
function command(sim: VoxelSimulation, c: VoxelCommand) {
  const result = sim.command(c);
  expect(result.ok, JSON.stringify({ c, result })).toBe(true);
  return result;
}
function until(sim: VoxelSimulation, condition: () => boolean, limit = 1000) {
  for (let i = 0; i < limit && !condition(); i++) sim.step();
  expect(
    condition(),
    JSON.stringify({ tick: sim.tick, jobs: sim.jobs, devices: sim.devices, pawns: sim.pawns }),
  ).toBe(true);
}
function materialLedger(sim: VoxelSimulation): Counts {
  const inventory = sim.counts();
  return Object.fromEntries(
    (Object.keys(inventory) as Resource[]).map((resource) => [
      resource,
      inventory[resource] +
        sim.stats.consumed[resource] +
        sim.stats.spoiled[resource] -
        sim.stats.produced[resource],
    ]),
  ) as unknown as Counts;
}
function expectMaterialLedger(sim: VoxelSimulation, initial: Counts) {
  expect(materialLedger(sim), `all resource cost/consumption balances at tick ${sim.tick}`).toEqual(
    initial,
  );
}
function heaterFixture(energy = 100) {
  const sim = fixture((source) => {
    carve(source, pos(10, 10), pos(14, 13, 9));
    addDevice(source, 'battery', pos(14, 11), { energy });
    addDevice(source, 'heater', pos(11, 11), { powered: true, target: 50 });
  });
  insulate(sim);
  return {
    sim,
    heater: sim.devices.find((d) => d.kind === 'heater')!,
    battery: sim.devices.find((d) => d.kind === 'battery')!,
  };
}
function coolerFixture(axis: 'x' | 'y' = 'x', blocked = false, energy = 100) {
  const cold = axis === 'x' ? pos(19, 20) : pos(20, 19),
    hot = axis === 'x' ? pos(21, 20) : pos(20, 21);
  const sim = fixture((source) => {
    if (axis === 'x') {
      carve(source, pos(17, 19), pos(19, 21, 9));
      carve(source, pos(21, 19), pos(23, 21, 9));
      addDevice(source, 'battery', pos(17, 19), { energy });
    } else {
      carve(source, pos(19, 17), pos(21, 19, 9));
      carve(source, pos(19, 21), pos(21, 23, 9));
      addDevice(source, 'battery', pos(19, 17), { energy });
    }
    carve(source, pos(20, 20));
    addDevice(source, 'cooler', pos(20, 20), { axis, target: 0, powered: true });
    if (blocked) source.blocks[at(hot)] = Block.Stone;
  });
  insulate(sim);
  return { sim, cold, hot, cooler: sim.devices.find((d) => d.kind === 'cooler')! };
}

describe('isolated world/device heat integration', () => {
  it('delivers heater 21 heat units/s below 20 C and consumes 175 W plus battery self-discharge', () => {
    const { sim, heater, battery } = heaterFixture();
    setTemperature(sim, heater, 0);
    const initialEnergy = battery.energy,
      roomCapacity = capacity(sim, heater);
    sim.step(TPS);
    expect(heater).toMatchObject({ powered: true, active: true, watts: -175 });
    expect(sim.temperature(heater) * roomCapacity).toBeCloseTo(21, 10);
    expect(initialEnergy - battery.energy).toBeCloseTo(((175 + 5) * TPS) / DAY, 10);
    expect(sim.power.snapshot()[0]).toMatchObject({ demandW: 175, usedW: 175, generatedW: 0 });
  });

  it('clips heater heat at target and changes to 17.5 W standby on the next step', () => {
    const { sim, heater, battery } = heaterFixture();
    heater.target = 21;
    setTemperature(sim, heater, 20.99);
    sim.step();
    expect(sim.temperature(heater)).toBe(21);
    expect(heater.watts).toBe(-175);
    const energy = battery.energy;
    sim.step();
    expect(heater).toMatchObject({ active: false, powered: true, watts: -17.5 });
    expect(sim.temperature(heater)).toBe(21);
    expect(energy - battery.energy).toBeCloseTo((17.5 + 5) / DAY, 11);
  });

  it('applies the heater efficiency decline above 20 C', () => {
    const { sim, heater } = heaterFixture();
    setTemperature(sim, heater, 30);
    const roomCapacity = capacity(sim, heater);
    sim.step();
    expect((sim.temperature(heater) - 30) * roomCapacity).toBeCloseTo((21 / TPS) * 0.9, 10);
  });

  it('cannot produce device heat with an empty or disconnected electrical supply', () => {
    const { sim, heater } = heaterFixture(0);
    setTemperature(sim, heater, 0);
    sim.step(100);
    expect(heater.powered).toBe(false);
    expect(heater.active).toBe(false);
    expect(sim.temperature(heater)).toBe(0);
    const disconnected = fixture((source) => {
      carve(source, pos(10, 10), pos(12, 12, 9));
      addDevice(source, 'heater', pos(11, 11), { powered: true, target: 50 });
    });
    insulate(disconnected);
    setTemperature(disconnected, disconnected.devices[0], 0);
    disconnected.step(100);
    expect(disconnected.devices[0]).toMatchObject({
      powered: false,
      active: false,
      networkId: null,
    });
    expect(disconnected.temperature(disconnected.devices[0])).toBe(0);
  });

  it('honors the normal device off command immediately and rejects malformed settings atomically', () => {
    const { sim, heater } = heaterFixture();
    setTemperature(sim, heater, 0);
    command(sim, { type: 'device', deviceId: heater.id, on: false, target: 30 });
    sim.step(5);
    expect(sim.temperature(heater)).toBe(0);
    expect(heater.powered).toBe(false);
    for (const c of [
      { type: 'device', deviceId: heater.id, on: true, target: 51 },
      { type: 'device', deviceId: heater.id, on: true, target: 21.5 },
      { type: 'device', deviceId: -1, on: true, target: 21 },
    ] as VoxelCommand[]) {
      const before = sim.save();
      expect(sim.command(c).ok).toBe(false);
      expect(sim.save()).toEqual(before);
    }
  });

  it.each(['x', 'y'] as const)(
    'cools the negative %s side, heats the positive side at 1.25x, and uses 200 W',
    (axis) => {
      const { sim, cold, hot, cooler } = coolerFixture(axis);
      setTemperature(sim, cold, 30);
      setTemperature(sim, hot, 30);
      const coldCapacity = capacity(sim, cold),
        hotCapacity = capacity(sim, hot);
      expect(sim.rooms.roomAt(cold)?.id).not.toBe(sim.rooms.roomAt(hot)?.id);
      expect(sim.rooms.roomAt(cooler)).toBeNull();
      sim.step();
      expect((30 - sim.temperature(cold)) * coldCapacity).toBeCloseTo(21 / TPS, 10);
      expect((sim.temperature(hot) - 30) * hotCapacity).toBeCloseTo((21 / TPS) * 1.25, 10);
      expect(cooler).toMatchObject({ powered: true, active: true, watts: -200 });
    },
  );

  it('clips cold-side output but preserves available-energy-based exhaust, then idles at 20 W', () => {
    const { sim, cold, hot, cooler } = coolerFixture();
    cooler.target = 29;
    setTemperature(sim, cold, 29.01);
    setTemperature(sim, hot, 29.01);
    const hotCapacity = capacity(sim, hot);
    sim.step();
    expect(sim.temperature(cold)).toBe(29);
    expect((sim.temperature(hot) - 29.01) * hotCapacity).toBeCloseTo((21 / TPS) * 1.25, 10);
    const hotTemperature = sim.temperature(hot);
    sim.step();
    expect(cooler).toMatchObject({ active: false, powered: true, watts: -20 });
    expect(sim.temperature(cold)).toBe(29);
    expect(sim.temperature(hot)).toBe(hotTemperature);
  });

  it('idles with a blocked port and produces no cooling without power', () => {
    const blocked = coolerFixture('x', true);
    setTemperature(blocked.sim, blocked.cold, 30);
    blocked.sim.step();
    expect(blocked.cooler).toMatchObject({
      powered: true,
      active: false,
      watts: -20,
      reason: '进风口或排热口被堵住',
    });
    expect(blocked.sim.temperature(blocked.cold)).toBe(30);
    const unpowered = coolerFixture('x', false, 0);
    setTemperature(unpowered.sim, unpowered.cold, 30);
    setTemperature(unpowered.sim, unpowered.hot, 30);
    unpowered.sim.step(100);
    expect(unpowered.cooler).toMatchObject({ powered: false, active: false });
    expect(unpowered.sim.temperature(unpowered.cold)).toBe(30);
    expect(unpowered.sim.temperature(unpowered.hot)).toBe(30);
  });

  it('stops cooling when exhaust-side temperature removes all efficiency', () => {
    const { sim, cold, hot, cooler } = coolerFixture();
    setTemperature(sim, cold, 20);
    setTemperature(sim, hot, 150);
    sim.step();
    expect(cooler).toMatchObject({ active: false, watts: -20, reason: '排热侧过热' });
    expect(sim.temperature(cold)).toBe(20);
    expect(sim.temperature(hot)).toBe(150);
  });

  it('reports the real indoor temperature to crops rather than the outdoor weather', () => {
    const sim = fixture((source) => {
      carve(source, pos(10, 10), pos(12, 12, 9));
      source.blocks[index(11, 11, 7)] = Block.Soil;
      source.farms.push({ ...pos(11, 11), crop: 'rice' });
    });
    setTemperature(sim, pos(11, 11), -4);
    expect(sim.cropCondition(pos(11, 11), 'rice')).toMatchObject({
      temperature: -4,
      fertility: 1,
      growthRate: 0,
    });
    expect(temperatureAt(sim.tick)).not.toBe(-4);
    setTemperature(sim, pos(11, 11), 33);
    expect(sim.snapshot().cropConditions[0].temperature).toBe(33);
  });
});

describe('solar sky visibility through the world integration', () => {
  function solarFixture(shaded: number, tick = 2000) {
    return fixture((source) => {
      source.tick = tick;
      source.storyteller = initialStoryteller(source.seed, tick);
      source.trade = initialTrade(source.seed, tick);
      source.fireHazards = initialFireHazards(source.seed, tick);
      source.weather = initialWeather(source.seed, source.settings, source.tick, source.generator);
      carve(source, pos(10, 10), pos(13, 13, HEIGHT - 1));
      const solar = addDevice(source, 'solar', pos(10, 10));
      for (const p of deviceCells(solar).slice(0, shaded)) {
        source.blocks[index(p.x, p.y, 10)] = Block.Wood;
        source.blocks[index(p.x, p.y, 12)] = Block.Wood;
      }
    });
  }
  it.each([
    [0, 1700],
    [1, 1593.75],
    [8, 850],
    [16, 0],
  ])('uses %i shaded columns once each to produce %s W at saturated daylight', (shaded, watts) => {
    const sim = solarFixture(shaded);
    sim.step();
    expect(sim.devices[0].watts).toBe(watts);
    expect(sim.power.snapshot()[0].generatedW).toBe(watts);
  });
  it('produces no power at night or when switched off', () => {
    const night = solarFixture(0, 6000);
    night.step();
    expect(night.devices[0].watts).toBe(0);
    const off = solarFixture(0);
    command(off, { type: 'device', deviceId: off.devices[0].id, on: false, target: 21 });
    off.step();
    expect(off.devices[0].watts).toBe(0);
  });
});

describe('construction footprint transactions with explicitly injected fixtures', () => {
  function constructionFixture(blockDisplacement = false) {
    return fixture((source) => {
      carve(source, pos(10, 10), pos(20, 20, 9));
      for (let i = 0; i < source.pawns.length; i++) Object.assign(source.pawns[i], pos(10 + i, 18));
      source.pawns[0].priorities.build = 1;
      if (blockDisplacement)
        for (const p of [pos(14, 13), pos(13, 14)]) {
          source.blocks[at(p)] = Block.Stone;
          source.blocks[at({ ...p, z: 9 })] = Block.Stone;
        }
    });
  }
  function readyGenerator(sim: VoxelSimulation) {
    command(sim, { type: 'designate', tool: 'generator', from: pos(12, 12), axis: 'x' });
    const job = sim.jobs[0];
    // Only the completion transaction is under test; material delivery/progress
    // are fixture injections, not evidence of a played construction campaign.
    job.delivered = { ...job.cost };
    job.deliveredBatches = Object.entries(job.delivered).map(([resource, amount]) => freshBatch(resource as Resource, amount!));
    until(
      sim,
      () => sim.pawns[0].phase === 'work' && sim.pawns[0].jobId === job.id && job.progress > 0,
    );
    job.progress = job.work - 1;
    return job;
  }
  it('rejects overlapping planned second cells and device headroom atomically', () => {
    const sim = constructionFixture();
    command(sim, { type: 'designate', tool: 'generator', from: pos(12, 12), axis: 'x' });
    for (const c of [
      { type: 'designate', tool: 'battery', from: pos(13, 13), axis: 'x' },
      { type: 'designate', tool: 'wall', from: pos(13, 13, 9) },
      { type: 'designate', tool: 'solar', from: pos(62, 62), axis: 'x' },
    ] as VoxelCommand[]) {
      const before = sim.save();
      expect(sim.command(c).ok).toBe(false);
      expect(sim.save()).toEqual(before);
    }
  });
  it('rolls back the whole device when a pawn occupies its far footprint cell', () => {
    const sim = constructionFixture(),
      job = readyGenerator(sim);
    Object.assign(sim.pawns[1], pos(13, 13));
    const materials = sim.counts(),
      consumed = { ...sim.stats.consumed };
    sim.step();
    expect(sim.devices).toHaveLength(0);
    expect(sim.jobs).toContain(job);
    expect(job.reason).toContain('有人占用');
    expect(job.delivered).toEqual(job.cost);
    expect(sim.stats.consumed).toEqual(consumed);
    expect(sim.counts()).toEqual(materials);
    expect(sim.standable(pos(13, 13))).toBe(true);
  });
  it('rolls back without losing a trapped loose stack or delivered materials', () => {
    const sim = constructionFixture(true),
      job = readyGenerator(sim);
    sim.items.push({ ...pos(13, 13), id: sim.nextId++, resource: 'steel', amount: 1 });
    const before = sim.counts(),
      stack = structuredClone(sim.items[0]);
    sim.step();
    expect(sim.devices).toHaveLength(0);
    expect(job.reason).toContain('散落物资无相邻空位');
    expect(sim.items).toEqual([stack]);
    expect(sim.counts()).toEqual(before);
    expect(sim.standable(pos(13, 13))).toBe(true);
  });
  it('moves a loose stack to an adjacent supported cell before committing construction', () => {
    const sim = constructionFixture(),
      job = readyGenerator(sim);
    sim.items.push({ ...pos(13, 13), id: sim.nextId++, resource: 'steel', amount: 1 });
    const ledger = materialLedger(sim);
    sim.step();
    expect(sim.devices).toHaveLength(1);
    expect(sim.jobs).not.toContain(job);
    expect(sim.stats.consumed).toMatchObject({ steel: 100, components: 2 });
    expect(sim.items).toHaveLength(1);
    expect(sim.items[0]).toMatchObject({ resource: 'steel', amount: 1, z: 8 });
    expect(Math.abs(sim.items[0].x - 13) + Math.abs(sim.items[0].y - 13)).toBe(1);
    expect(sim.standable(sim.items[0])).toBe(true);
    expectMaterialLedger(sim, ledger);
  });

  it.each(['pawn', 'stack'] as const)(
    'rolls back bridge demolition when a supported upper %s would lose its route to camp',
    (occupant) => {
      const camp = pos(32, 34),
        end = pos(38, 34, 11),
        bridge = pos(35, 34, 11);
      const sim = fixture((source) => {
        carve(source, pos(30, 32), pos(40, 36, 13));
        for (let x = 33; x <= 38; x++) source.blocks[index(x, 34, 10)] = Block.Wood;
        for (let z = 8; z <= 11; z++) source.ladders[index(32, 34, z)] = 1;
        Object.assign(source.pawns[0], pos(34, 34, 11));
        Object.assign(source.pawns[1], occupant === 'pawn' ? end : pos(31, 34));
        Object.assign(source.pawns[2], camp);
        source.pawns[0].priorities.build = 1;
        if (occupant === 'stack')
          source.items.push({ ...end, id: source.nextId++, resource: 'steel', amount: 7 });
      });
      expect(sim.path(end, camp)).not.toBeNull();
      command(sim, { type: 'designate', tool: 'remove', from: bridge });
      const job = sim.jobs[0];
      until(sim, () => job.progress > 0);
      job.progress = job.work - 1;
      const blocks = sim.blocks.slice(),
        counts = sim.counts();
      sim.step();
      expect(job.reason).toContain('切断人物或物资返回营地的通路');
      expect(sim.jobs).toContain(job);
      expect(sim.blocks).toEqual(blocks);
      expect(sim.counts()).toEqual(counts);
      expect(sim.standable(end)).toBe(true);
      expect(sim.path(end, camp)).not.toBeNull();
    },
  );
});

describe('partial refuelling with physically transported wood', () => {
  function refuelFixture(split: boolean) {
    return fixture((source) => {
      carve(source, pos(10, 10), pos(20, 20, 9));
      Object.assign(source.pawns[0], pos(10, 14));
      source.pawns[0].priorities.haul = 1;
      // Only the empty machine and initial wood piles are fixture inputs.
      // Fuel, carried/delivered wood, progress and completion are never injected.
      addDevice(source, 'generator', pos(12, 12));
      source.items.push({
        ...pos(11, 14),
        id: source.nextId++,
        resource: 'wood',
        amount: split ? 2 : 4,
      });
      if (split)
        source.items.push({ ...pos(18, 18), id: source.nextId++, resource: 'wood', amount: 2 });
    });
  }
  function advance(sim: VoxelSimulation, condition: () => boolean, ledger: Counts, limit = 1600) {
    for (let i = 0; i < limit && !condition(); i++) {
      sim.step();
      expectMaterialLedger(sim, ledger);
    }
    expect(
      condition(),
      JSON.stringify({ tick: sim.tick, jobs: sim.jobs, pawns: sim.pawns, devices: sim.devices }),
    ).toBe(true);
  }

  it('hauls only four available wood into an empty generator and completes after 80 work ticks', () => {
    const sim = refuelFixture(false),
      generator = sim.devices[0],
      ledger = materialLedger(sim);
    expect(generator.fuel).toBe(0);
    expect(ledger.wood).toBe(4);
    advance(sim, () => sim.pawns[0].cargo?.resource === 'wood', ledger);
    expect(sim.pawns[0].cargo).toEqual({ resource: 'wood', amount: 4 });
    const job = sim.jobs.find((j) => j.kind === 'refuel')!;
    expect(job.cost).toEqual({ wood: 4 });
    expect(job.work).toBe(80);
    advance(sim, () => job.progress > 0, ledger);
    expect(job.delivered).toEqual({ wood: 4 });
    expect(sim.pawns[0].cargo).toBeNull();
    expect(generator.fuel).toBe(0);
    expect(sim.stats.consumed.wood).toBe(0);
    const firstWorkTick = sim.tick;
    expect(job.progress).toBe(1);
    advance(sim, () => !sim.jobs.some((j) => j.id === job.id), ledger);
    expect(sim.tick - firstWorkTick).toBe(79);
    expect(job.progress).toBe(80);
    expect(generator.fuel).toBe(4);
    expect(sim.counts().wood).toBe(0);
    expect(sim.stats.consumed.wood).toBe(4);
    sim.step();
    expectMaterialLedger(sim, ledger);
    // Converted fuel is already recorded in consumed wood; the subsequent burn
    // belongs to its separate fuel balance and must not consume inventory twice.
    expect(generator.fuel).toBeCloseTo(4 - 22 / DAY, 12);
    expect(generator.fuel + 22 / DAY).toBeCloseTo(sim.stats.consumed.wood, 12);
  });

  it('preserves partial delivery plus cargo through saves, cancellation, and resumed refuelling', () => {
    const sim = refuelFixture(true),
      ledger = materialLedger(sim);
    advance(
      sim,
      () =>
        sim.jobs.some((j) => j.kind === 'refuel' && j.delivered.wood === 2) &&
        sim.pawns[0].cargo?.resource === 'wood' &&
        sim.pawns[0].cargo.amount === 2,
      ledger,
    );
    const job = sim.jobs.find((j) => j.kind === 'refuel')!,
      saved = sim.save();
    expect(job.cost).toEqual({ wood: 4 });
    expect(job.delivered).toEqual({ wood: 2 });
    expect(sim.devices[0].fuel).toBe(0);
    expect(sim.items).toEqual([]);
    expect(sim.stats.consumed.wood).toBe(0);
    const restored = VoxelSimulation.load(saved);
    expect(restored.jobs.find((j) => j.id === job.id)?.delivered).toEqual({ wood: 2 });
    expect(restored.pawns[0].cargo).toEqual({ resource: 'wood', amount: 2 });
    expectMaterialLedger(restored, ledger);
    for (const cancelled of [sim, restored]) {
      command(cancelled, { type: 'designate', tool: 'cancel', from: pos(12, 12) });
      expect(cancelled.jobs.some((j) => j.id === job.id)).toBe(false);
      expect(
        cancelled.items.reduce(
          (total, item) => total + (item.resource === 'wood' ? item.amount : 0),
          0,
        ),
      ).toBe(2);
      expect(cancelled.pawns[0].cargo).toEqual({ resource: 'wood', amount: 2 });
      expect(cancelled.devices[0].fuel).toBe(0);
      expect(cancelled.stats.consumed.wood).toBe(0);
      expectMaterialLedger(cancelled, ledger);
      expectMaterialLedger(VoxelSimulation.load(cancelled.save()), ledger);
    }
    const resumed = VoxelSimulation.load(saved);
    advance(resumed, () => resumed.devices[0].fuel > 0, ledger);
    expect(resumed.devices[0].fuel).toBe(4);
    expect(resumed.counts().wood).toBe(0);
    expect(resumed.stats.consumed.wood).toBe(4);
    expectMaterialLedger(resumed, ledger);
  });
});

describe('v4 energy persistence and malformed-input rejection', () => {
  function savedWorld() {
    const sim = fixture((source) => {
      carve(source, pos(10, 10), pos(18, 15, 9));
      addDevice(source, 'generator', pos(10, 10), { fuel: 43.25 });
      addDevice(source, 'battery', pos(12, 10), { energy: 123.5 });
      addDevice(source, 'heater', pos(15, 12), { powered: true, target: 35 });
    });
    setTemperature(sim, pos(15, 12), -7.125);
    return sim;
  }
  it('round-trips fuel, stored energy, temperature and resumes production with the real passive model', () => {
    const original = savedWorld(),
      saved = original.save(),
      restored = VoxelSimulation.load(saved);
    expect(saved.version).toBe(42);
    expect(restored.devices.map((d) => [d.fuel, d.energy, d.target])).toEqual(
      original.devices.map((d) => [d.fuel, d.energy, d.target]),
    );
    expect(restored.thermal.save()).toEqual(original.thermal.save());
    original.step(20);
    restored.step(20);
    expect(restored.devices.map((d) => [d.fuel, d.energy, d.powered, d.watts])).toEqual(
      original.devices.map((d) => [d.fuel, d.energy, d.powered, d.watts]),
    );
    expect(restored.thermal.save()).toEqual(original.thermal.save());
    expect(restored.counts()).toEqual(original.counts());
  });
  it('rejects malformed device state, thermal anchors, and overlapping footprints without mutating the input', () => {
    const saved = savedWorld().save();
    const mutations: ((save: VoxelSave) => void)[] = [
      (s) => {
        s.devices[0].fuel = -1;
      },
      (s) => {
        s.devices[0].fuel = 75.1;
      },
      (s) => {
        s.devices[0].fuel = NaN;
      },
      (s) => {
        s.devices[1].energy = 600.1;
      },
      (s) => {
        s.devices[1].energy = Infinity;
      },
      (s) => {
        s.devices[1].fuel = 1;
      },
      (s) => {
        s.devices[2].energy = 1;
      },
      (s) => {
        s.devices[2].target = 51;
      },
      (s) => {
        s.devices[2].target = 21.5;
      },
      (s) => {
        s.devices[2].id = s.devices[0].id;
      },
      (s) => {
        s.devices[1].x = 63;
        s.devices[1].axis = 'y';
      },
      (s) => {
        s.devices[1].x = 11;
        s.devices[1].y = 10;
      },
      (s) => {
        s.devices[1].x = 10;
        s.devices[1].y = 10;
        s.devices[1].z = 9;
      },
      (s) => {
        s.thermal[0].temperature = 1001;
      },
      (s) => {
        s.thermal[0].temperature = NaN;
      },
      (s) => {
        s.thermal[0].cell = -1;
      },
      (s) => {
        s.thermal[0].cell = index(0, 0, 0);
      },
      (s) => {
        s.thermal.push({ ...s.thermal[0] });
      },
      (s) => {
        s.wires.push(pos(10, 10), pos(10, 10));
      },
      (s) => {
        s.wires.push(pos(10, 10, 0));
      },
    ];
    for (const [i, mutate] of mutations.entries()) {
      const invalid = structuredClone(saved);
      mutate(invalid);
      const before = structuredClone(invalid);
      expect(() => VoxelSimulation.load(invalid), `mutation ${i}`).toThrow();
      expect(invalid).toEqual(before);
    }
  });
  it('migrates a v3 save with no devices/wires/thermal and preserves the world', () => {
    const sim = fixture(),
      old = sim.save() as unknown as Record<string, unknown>;
    stripRangedDefaults(old);    old.version = 3;
    delete old.devices;
    delete old.wires;
    delete old.thermal;
    const restored = VoxelSimulation.load(old);
    expect(restored.save().version).toBe(42);
    expect(restored.devices).toEqual([]);
    expect(restored.wires).toEqual([]);
    expect(restored.blocks).toEqual(sim.blocks);
    expect(restored.pawns.map((p) => p.id)).toEqual(sim.pawns.map((p) => p.id));
  });
});
