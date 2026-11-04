import { stripPensFields } from './legacy-pens-defaults';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, WIDTH, DEPTH, at, index, type Pawn, type Pos, type VoxelCommand, type WorldSettings } from '../src/voxel/types';
import { initialStoryteller } from '../src/voxel/storyteller';
import { initialTrade } from '../src/voxel/trade';
import { initialFireHazards, makeFire } from '../src/voxel/fire';
import { initialWeather, advanceWeather, weatherAtCycle, nextWeatherTransition, weatherEffects, WEATHER_RULES, type WeatherKind } from '../src/voxel/weather';
import { makeWeapon } from '../src/voxel/weapons';
import { daylight, hourAt } from '../src/voxel/farming';
import { MOOD_RULES } from '../src/voxel/mood';
import { relocationExpectedField } from './legacy-relocation-defaults';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) { const r = s.command(c); expect(r.ok, r.message).toBe(true); }
function until(s: VoxelSimulation, done: () => boolean, limit = 1000) {
  for (let i = 0; i < limit && !done(); i++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, weather: s.weather, fires: s.fires,
    jobs: s.jobs, pawns: s.pawns.map(p => [p.id, p.x, p.y, p.z, p.phase, p.reason]) })).toBe(true);
}
/** These are controlled geometry/time/resource fixtures, not ordinary campaign
 * evidence. Calendar states are generated through the real deterministic model;
 * behavior thereafter uses public commands, stepping, snapshots and save/load. */
function fixture(configure?: (s: VoxelSimulation) => void, settings: Partial<WorldSettings> = {}) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0, ...settings }, false, 2) /* Controlled geometry: historical full visibility. */;
  s.animals = []; s.trees = []; s.treePlots = []; s.items = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  s.blocks.fill(Block.Air, WIDTH * DEPTH * 8);
  s.spawn = pos(12); s.homeArea.clear();
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(12, 16 + i * 2)); p.worn = []; p.weapon = null; p.schedule.fill('work'); p.food = 100; p.rest = 100;
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof Pawn['priorities']] = 0;
  }
  command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
  configure?.(s); return VoxelSimulation.load(s.save());
}
function clockAt(s: VoxelSimulation, tick: number) {
  s.tick = tick; s.storyteller = initialStoryteller(s.seed, tick); s.trade = initialTrade(s.seed, tick);
  s.fireHazards = initialFireHazards(s.seed, tick); s.fireHazards.enabled = false;
  s.weather = initialWeather(s.seed, s.settings); advanceWeather(s.weather, s.seed, s.settings, tick, s.generator);
  return VoxelSimulation.load(s.save());
}
function during(s: VoxelSimulation, kind: WeatherKind, noon = false) {
  for (let cycle = 0; cycle < 300; cycle++) {
    if (weatherAtCycle(s.seed, s.settings, 0, cycle, s.generator) !== kind) continue;
    const start = cycle === 0 ? 0 : nextWeatherTransition(s.seed, 0, cycle - 1);
    const end = nextWeatherTransition(s.seed, 0, cycle);
    for (let tick = start + WEATHER_RULES.transitionTicks + 1; tick + 500 < end; tick += 50)
      if (!noon || daylight(hourAt(tick)) === 1) return clockAt(s, tick);
  }
  throw new Error(`No natural ${kind} episode found for controlled fixture`);
}
function woodFire(s: VoxelSimulation, p: Pos) {
  s.items.push({ ...p, id: s.nextId++, resource: 'wood', amount: 75 });
  const fire = makeFire(s.nextId++, p, s.tick, 'shortCircuit'); s.fires.push(fire); return fire;
}

describe('genuine v26 weather migration', () => {
  it.each([
    ['initial', '5e2dee2eeab6ff10dc4164abd5de57b12ef613da89674f104c921f732cb59e06'],
    ['fire-active', '697b9ce641bda07d1dce0d2eb0599e92bc9d2de32ea8ef8ad9dbd1caf85c92ae'],
  ])('preserves authentic %s bytes, fire clocks and physical colony state', (name, sha) => {
    const bytes = readFileSync(new URL(`./fixtures/voxel-v26-weather-${name}.json`, import.meta.url));
    const proof = JSON.parse(readFileSync(new URL(`./fixtures/voxel-v26-weather-${name}.provenance.json`, import.meta.url), 'utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha); expect(proof.sha256).toBe(sha);
    const old = JSON.parse(bytes.toString()), s = VoxelSimulation.load(old);
    expect(old.version).toBe(26); expect(s.save().version).toBe(40);
    expect(s.tick).toBe(old.tick); expect(s.items).toEqual(old.items); expect(s.stats).toEqual(relocationExpectedField('stats', old.stats));
    expect(s.fires).toEqual(old.fires); expect(s.fireDamage).toEqual(old.fireDamage);
    expect(s.fireHazards).toEqual(old.fireHazards); expect(s.fireLog).toEqual(old.fireLog);
    const preserved = (p: Pawn) => ({ id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, food: p.food, rest: p.rest,
      faction: p.faction, dead: p.dead, downed: p.downed, health: p.health, trauma: p.trauma, medical: p.medical,
      skills: p.skills, weapon: p.weapon, worn: p.worn, cargo: p.cargo });
    expect(s.pawns.map(preserved)).toMatchObject(old.pawns.map(preserved));
    expect(s.weather).toEqual(initialWeather(s.seed, s.settings, old.tick, s.generator)); expect(s.snow).toEqual([]);
    const loaded = VoxelSimulation.load(s.save()); expect(loaded.weather).toEqual(s.weather); expect(loaded.fires).toEqual(s.fires);
  });
});

describe('weather integrated with fire, real movement and shooting', () => {
  it.each(['clear', 'thunderstorm'] as const)('gates a normal scheduled lightning opportunity by actual %s weather', kind => {
    let s = fixture(s => { s.blocks[at(pos(20, 16, 7))] = Block.Wood; s.structureKinds[at(pos(20, 16, 7))] = 1; });
    let selected: { seed: number; deadline: number } | null = null;
    for (let seed = 1; seed <= 300 && selected === null; seed++) {
      const deadline = initialFireHazards(seed).nextIncidentTick, state = initialWeather(seed, s.settings);
      advanceWeather(state, seed, s.settings, deadline);
      if (state.kind === kind) selected = { seed, deadline };
    }
    expect(selected).not.toBeNull(); s.seed = selected!.seed;
    s = clockAt(s, selected!.deadline - 1);
    s.fireHazards = initialFireHazards(s.seed); // Keep the real initial fire calendar, with this opportunity due next tick.
    s = VoxelSimulation.load(s.save()); s.step();
    expect(s.weather.kind).toBe(kind);
    const event = s.fireHazards.events.at(-1)!;
    expect(event.tick).toBe(selected!.deadline); expect(event.source).toBe('lightning');
    expect(event.outcome).toBe(kind === 'clear' ? 'skipped' : 'ignited');
    expect(s.fires.length).toBe(kind === 'clear' ? 0 : 1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('suppresses exposed fire but shelters a covered fire in the very same outdoor room', () => {
    let s = fixture(s => { s.blocks[at(pos(24, 16, 10))] = Block.Masonry; }); s = during(s, 'rain');
    const exposed = woodFire(s, pos(20)), covered = woodFire(s, pos(24));
    expect(s.rooms.roomAt(exposed)?.outdoor).toBe(true);
    expect(s.rooms.roomAt(covered)?.id).toBe(s.rooms.roomAt(exposed)?.id);
    expect(s.weatherExposed(exposed)).toBe(true); expect(s.weatherExposed(covered)).toBe(false);
    s.step(180);
    expect(s.fires.some(f => f.id === exposed.id)).toBe(false);
    expect(s.fires.find(f => f.id === covered.id)?.size).toBeGreaterThan(.6);
    expect(s.fireLog.some(e => e.type === 'extinguished' && e.message.includes('降水'))).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('makes an exposed walker arrive later than a sheltered walker through the actual movement state machine', () => {
    let s = fixture(s => { for (let x = 12; x <= 14; x++) s.blocks[at(pos(x, 18, 10))] = Block.Masonry; });
    s = during(s, 'rain'); const [open, covered] = s.pawns;
    command(s, { type: 'move', pawnId: open.id, target: pos(14) });
    command(s, { type: 'move', pawnId: covered.id, target: pos(14, 18) });
    const arrived = new Map<number, number>();
    until(s, () => {
      for (const p of [open, covered]) if (p.x === 14 && !arrived.has(p.id)) arrived.set(p.id, s.tick);
      return arrived.size === 2;
    }, 40);
    expect(arrived.get(open.id)! - arrived.get(covered.id)!).toBe(1);
  });
  it('charges mental wandering rain delays from the departure cell in both directions across a roof edge', () => {
    const s = during(fixture(s => {
      // A two-cell enclosure leaves exactly one legal wandering step each way.
      for (const [x, y] of [[11, 16], [14, 16], [12, 15], [13, 15], [12, 17], [13, 17]])
        for (const z of [8, 9]) s.blocks[at(pos(x, y, z))] = Block.Masonry;
      s.blocks[at(pos(12, 16, 10))] = Block.Masonry;
      // Controlled mood history; ordinary stepping must start and run the break.
      s.pawns[0].psyche.level = 1;
      s.pawns[0].psyche.lowTicks = MOOD_RULES.lowDurationTicks - 1;
    }), 'rain');
    const p = s.pawns[0];
    expect(s.weatherExposed(pos(12))).toBe(false); expect(s.weatherExposed(pos(13))).toBe(true);
    expect(p.phase).not.toBe('mental'); expect(s.snapshot().weather.effects.moveFactor).toBe(.9);
    s.step();
    expect(p.phase).toBe('mental'); expect(p).toMatchObject(pos(13));
    expect(p.moveTick - s.tick).toBe(60); // Roofed departure, exposed destination.
    s.step(59); expect(p).toMatchObject(pos(13));
    s.step(); expect(p).toMatchObject(pos(12));
    expect(p.moveTick - s.tick).toBe(67); // Exposed departure, roofed destination.
    s.step(66); expect(p).toMatchObject(pos(12));
    s.step(); expect(p).toMatchObject(pos(13));
    expect(p.phase).toBe('mental'); expect(p.moveTick - s.tick).toBe(60);
  });
  it('uses the larger snow/sandbag movement cost once rather than adding both penalties', () => {
    const delay = (snow: boolean, sandbag: boolean) => {
      const s = fixture(s => {
        // Force the measured crossing: weighted routes now correctly avoid a
        // sandbag when the open ground beside it is faster.
        for (let y=0;y<DEPTH;y++) if (y!==16) for(let z=8;z<=9;z++) s.blocks[index(13,y,z)]=Block.Stone;
        if (snow) s.snow = [{ ...pos(13), depth: .8 }];
        if (sandbag) s.sandbags.push({ ...pos(13), id: s.nextId++, hitPoints: 300 });
      });
      const p = s.pawns[0]; command(s, { type: 'move', pawnId: p.id, target: pos(14) });
      s.step(); expect(p).toMatchObject(pos(13)); return p.moveTick - s.tick;
    };
    expect([delay(false, false), delay(true, false), delay(false, true), delay(true, true)]).toEqual([4, 8, 18, 18]);
  });
  it('uses weather accuracy when one endpoint is exposed and ignores it only when both endpoints are roofed', () => {
    const report = (shooterRoof: boolean, targetRoof: boolean) => {
      let s = fixture(s => {
        Object.assign(s.pawns[1], pos(22)); s.pawns[0].weapon = makeWeapon(s.nextId++, 'revolver');
        if (shooterRoof) s.blocks[at(pos(12, 16, 10))] = Block.Masonry;
        if (targetRoof) s.blocks[at(pos(22, 16, 10))] = Block.Masonry;
      });
      s = during(s, 'rain'); return s.shotReport(s.pawns[0], s.pawns[1])!;
    };
    const open = report(false, false), one = report(true, false), both = report(true, true);
    expect(open.canShoot && one.canShoot && both.canShoot).toBe(true);
    expect(open.weatherFactor).toBe(.8); expect(one.weatherFactor).toBe(.8); expect(both.weatherFactor).toBe(1);
    expect(one.estimatedHitChance).toBeLessThan(both.estimatedHitChance);
  });
});

describe('physical accumulated snow and solar generation', () => {
  it('accumulates from a legal natural snow episode and continues identically after save/load', () => {
    const s = during(fixture(undefined, { meanTemperature: -30, rainfall: 2200 }), 'snow');
    expect(s.snow).toEqual([]); expect(weatherEffects(s.weather, s.tick).snowRate).toBe(.8);
    s.step(100 - s.tick % 100); const depth = s.snow.find(p => at(p) === at(pos(20)))?.depth;
    expect(depth).toBeGreaterThan(0); const loaded = VoxelSimulation.load(s.save());
    expect(loaded.snow).toEqual(s.snow); expect(loaded.weather).toEqual(s.weather);
    s.step(100); loaded.step(100);
    expect(loaded.snow).toEqual(s.snow); expect(loaded.weather).toEqual(s.weather);
    expect(s.snow.find(p => at(p) === at(pos(20)))!.depth).toBeGreaterThan(depth!);
  });
  it('retains cold ground snow under a newly closed low ceiling and accumulates separately on its roof', () => {
    let s = during(fixture(undefined, { meanTemperature: -30, rainfall: 2200 }), 'snow');
    s.step(100 - s.tick % 100); const before = s.snow.find(p => at(p) === at(pos(20)))!.depth;
    // Controlled topology edit models a completed low roof without needing to
    // conflate construction-resource setup with the snow-layer boundary.
    s.blocks[at(pos(20, 16, 9))] = Block.Masonry; s = VoxelSimulation.load(s.save());
    expect(s.weatherExposed(pos(20))).toBe(false); s.step(100);
    expect(s.snow.find(p => at(p) === at(pos(20)))?.depth).toBe(before);
    expect(s.snow.find(p => at(p) === at(pos(20, 16, 10)))?.depth).toBeGreaterThan(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('melts physical saved snow according to warm cell temperature while cold saved snow remains', () => {
    const make = (meanTemperature: number) => fixture(s => { s.snow = [{ ...pos(20), depth: .5 }]; }, { meanTemperature });
    const warm = make(30), cold = make(-30); warm.step(100); cold.step(100);
    expect(warm.temperature(pos(20))).toBeGreaterThan(0); expect(cold.temperature(pos(20))).toBeLessThan(0);
    expect(warm.snow.find(p => at(p) === at(pos(20)))!.depth).toBeLessThan(.5);
    expect(cold.snow.find(p => at(p) === at(pos(20)))!.depth).toBe(.5);
    expect(() => VoxelSimulation.load(warm.save())).not.toThrow();
  });
  it('cleans an invalidated snow surface when a real removal job removes its wooden support', () => {
    const p = pos(20), s = fixture(s => {
      s.blocks[at(pos(20, 16, 7))] = Block.Wood; s.structureKinds[at(pos(20, 16, 7))] = 1;
      s.snow = [{ ...p, depth: .8 }]; Object.assign(s.pawns[0], pos(18));
    });
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'build', value: 1 });
    command(s, { type: 'designate', tool: 'remove', from: p });
    until(s, () => s.blocks[at(pos(20, 16, 7))] === Block.Air, 1000);
    expect(s.snow.some(q => at(q) === at(p))).toBe(false); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it.each(['clear', 'rain', 'fog'] as const)('keeps full unroofed midday solar output during ordinary %s weather', kind => {
    let s = fixture(s => {
      s.devices.push({ ...pos(25), id: s.nextId++, kind: 'solar', axis: 'x', on: true, fuel: 0, energy: 0,
        target: 21, powered: false, active: false, networkId: null, watts: 0, reason: '' });
    });
    s = during(s, kind, true); s.step();
    expect(daylight(hourAt(s.tick))).toBe(1); expect(s.devices[0].watts).toBe(1700);
    expect(s.snapshot().weather.effects.maxSkyGlow).toBe(1);
    if (kind !== 'clear') expect(s.snapshot().weather.effects.visualDim).toBeGreaterThan(0);
  });
});

describe('integrated save rejection', () => {
  it('rejects forged weather dates, duplicate snow and snow without actual support at the world loader', () => {
    const s = fixture(s => { s.snow = [{ ...pos(20), depth: .4 }]; });
    const clock = s.save(); clock.weather.nextTransitionTick++;
    expect(() => VoxelSimulation.load(clock)).toThrow(/天气/);
    const duplicate = s.save(); duplicate.snow.push({ ...duplicate.snow[0] });
    expect(() => VoxelSimulation.load(duplicate)).toThrow(/积雪/);
    const invalid = s.save(); invalid.snow[0].z++;
    expect(() => VoxelSimulation.load(invalid)).toThrow(/积雪/);
    const old = s.save() as any; stripPensFields(old); old.version = 26;
    expect(() => VoxelSimulation.load(old)).toThrow(/旧版本包含新版天气/);
  });
});
