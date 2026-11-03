import { describe, expect, it } from 'vitest';
import { Block, CELLS, DAY, HEIGHT, at, index, type WorldSettings } from '../src/voxel/types';
import { WEATHER_DEFS, WEATHER_RULES, initialWeather, advanceWeather, nextWeatherTransition,
  weatherAtCycle, weatherCycleAt, weatherEffects, weatherRandom, snowDepthAfter, snowPathCost,
  type WeatherState, type SnowCover } from '../src/voxel/weather';
import { rejectLegacyWeatherFields, migrateWeather, validateWeather } from '../src/voxel/weatherPersistence';

const settings: WorldSettings = { biome: 'temperate', hilliness: 'flat', meanTemperature: 24, rainfall: 1100, latitude: 0 };
function context(tick = 0) {
  const weather = initialWeather(73129, settings);
  advanceWeather(weather, 73129, settings, tick);
  return { seed: 73129, tick, settings: { ...settings }, generator: 2 as const, weather, snow: [] as SnowCover[] };
}
function blocks() {
  const terrain = new Uint8Array(CELLS);
  terrain[index(2, 2, 0)] = Block.Stone;
  return terrain;
}

describe('deterministic natural weather episodes', () => {
  it('begins clear and reaches scheduled opportunities within the first normal day', () => {
    const state = initialWeather(73129, settings);
    expect(state.kind).toBe('clear'); expect(state.events).toEqual([]);
    expect(state.nextTransitionTick).toBeGreaterThan(WEATHER_RULES.transitionTicks);
    expect(state.nextTransitionTick).toBeLessThan(DAY);
    advanceWeather(state, 73129, settings, DAY);
    expect(state.cycle).toBeGreaterThanOrEqual(2);
    expect(state.events.some(e => e.to !== 'clear')).toBe(true);
    expect(state.events.every(e => e.tick <= DAY)).toBe(true);
  });
  it('has a deterministic strictly increasing calendar with a complete blend before the next episode', () => {
    for (let cycle = 0; cycle < 100; cycle++) {
      const tick = nextWeatherTransition(1234, 6000, cycle);
      expect(tick).toBe(nextWeatherTransition(1234, 6000, cycle));
      expect(nextWeatherTransition(1234, 6000, cycle + 1) - tick).toBeGreaterThan(WEATHER_RULES.transitionTicks);
      expect(weatherCycleAt(1234, 6000, tick - 1)).toBe(cycle);
      expect(weatherCycleAt(1234, 6000, tick)).toBe(cycle + 1);
    }
  });
  it('matches single-tick advancement and batched advancement without replaying expired history', () => {
    const slow = initialWeather(73129, settings), fast = structuredClone(slow);
    const end = DAY * 3;
    for (let tick = 1; tick <= end; tick++) advanceWeather(slow, 73129, settings, tick);
    advanceWeather(fast, 73129, settings, end); expect(fast).toEqual(slow);
    const distant = context(DAY * 10000);
    expect(distant.weather.events).toHaveLength(WEATHER_RULES.maxEvents);
    expect(() => validateWeather(distant, blocks())).not.toThrow();
  });
  it('varies with world seeds including high bits instead of prescribing a fixed weather sequence', () => {
    const sequence = (seed: number) => Array.from({ length: 40 }, (_, i) => weatherAtCycle(seed, settings, 0, i));
    expect(sequence(1)).not.toEqual(sequence(2));
    expect(sequence(1)).not.toEqual(sequence(1 + 4294967296));
    expect(weatherRandom(1, 0, 2)).toBe(weatherRandom(1, 0, 2));
    expect(new Set(sequence(73129)).size).toBeGreaterThan(2);
  });
  it('uses rainfall for wet-weather frequency and climate temperature to select rain versus snow', () => {
    const dry = { ...settings, rainfall: 0 }, wet = { ...settings, rainfall: 4000 };
    const cold = { ...wet, meanTemperature: -30 }, hot = { ...wet, meanTemperature: 45 };
    const sample = (s: WorldSettings) => Array.from({ length: 200 }, (_, i) => weatherAtCycle(73129, s, 0, i + 1));
    expect(sample(dry).every(kind => kind === 'clear' || kind === 'fog')).toBe(true);
    expect(sample(wet).filter(k => ['rain', 'thunderstorm', 'snow'].includes(k)).length).toBeGreaterThan(80);
    expect(sample(cold).includes('snow')).toBe(true);
    expect(sample(cold).some(k => k === 'rain' || k === 'thunderstorm')).toBe(false);
    expect(sample(hot).includes('snow')).toBe(false);
    expect(sample(hot).includes('thunderstorm')).toBe(true);
  });
  it('does not replay old weather or snow when beginning at a migration epoch', () => {
    const epoch = DAY * 60 + 123, state = initialWeather(73129, settings, epoch);
    expect(state).toMatchObject({ epoch, startedTick: epoch, cycle: 0, kind: 'clear', previousKind: 'clear', events: [] });
    expect(state.nextTransitionTick).toBeGreaterThan(epoch);
    advanceWeather(state, 73129, settings, epoch + 10); expect(state.cycle).toBe(0);
    expect(() => advanceWeather(state, 73129, settings, epoch - 1)).toThrow();
  });
});

describe('canonical weather and physical snow effects', () => {
  it('interpolates precipitation, movement and shooting without turning visual dim into a solar penalty', () => {
    const state: WeatherState = { ...initialWeather(1, settings), kind: 'rain', previousKind: 'clear', startedTick: 0 };
    expect(weatherEffects(state, 0)).toEqual(WEATHER_DEFS.clear);
    const middle = weatherEffects(state, WEATHER_RULES.transitionTicks / 2);
    expect(middle.rainRate).toBe(.5); expect(middle.moveFactor).toBe(.95);
    expect(middle.accuracyFactor).toBe(.9); expect(middle.maxSkyGlow).toBe(1);
    const end = weatherEffects(state, WEATHER_RULES.transitionTicks);
    expect(end).toEqual(WEATHER_DEFS.rain); expect(end.visualDim).toBeGreaterThan(0);
    state.kind = 'fog'; expect(weatherEffects(state, WEATHER_RULES.transitionTicks).maxSkyGlow).toBe(1);
  });
  it('keeps the native snow rainRate while distinguishing the snow particle/intensity field', () => {
    expect(WEATHER_DEFS.snow).toMatchObject({ rainRate: 1, snowRate: .8, moveFactor: 1, accuracyFactor: .8 });
    expect(WEATHER_DEFS.thunderstorm.moveFactor).toBe(.8);
    expect(WEATHER_DEFS.fog.accuracyFactor).toBe(.5);
  });
  it('accumulates only in exposed outdoor-temperature cells and preserves cold covered snow', () => {
    expect(snowDepthAfter(0, .8, -10, true, true, 100)).toBeGreaterThan(0);
    expect(snowDepthAfter(0, .8, -10, false, true, 100)).toBe(0);
    expect(snowDepthAfter(0, .8, -10, true, false, 100)).toBe(0);
    expect(snowDepthAfter(.5, .8, -10, false, false, 100)).toBe(.5);
    expect(snowDepthAfter(.5, .8, -10, true, true, 0)).toBe(.5);
  });
  it('melts with the actual local temperature and clamps without inventing negative or excess snow', () => {
    expect(snowDepthAfter(.5, 0, 5, false, false, 100)).toBeLessThan(.5);
    expect(snowDepthAfter(.5, 0, 15, false, false, 100)).toBeLessThan(snowDepthAfter(.5, 0, 5, false, false, 100));
    expect(snowDepthAfter(.5, 0, -5, true, true, 100)).toBe(.5);
    expect(snowDepthAfter(.5, 0, 100, false, false, 100000)).toBe(0);
    expect(snowDepthAfter(.5, 1, -20, true, true, 100000)).toBe(1);
    const whole = snowDepthAfter(.2, .8, -5, true, true, 10);
    expect(snowDepthAfter(snowDepthAfter(.2, .8, -5, true, true, 5), .8, -5, true, true, 5)).toBeCloseTo(whole, 12);
  });
  it('uses actual native snow categories and exposes raw path costs for world time mapping', () => {
    expect([0, .029, .03, .249, .25, .499, .5, .749, .75, 1].map(snowPathCost)).toEqual([0, 0, 0, 0, 4, 4, 8, 8, 12, 12]);
    expect(() => snowPathCost(NaN)).toThrow(); expect(() => snowPathCost(-1)).toThrow();
    expect(() => snowDepthAfter(2, 1, 0, true, true, 1)).toThrow();
  });
});

describe('strict weather persistence and migration', () => {
  it('preserves the exact state/history and stored physical snow through serialization', () => {
    const d = context(DAY * 100); d.snow = [{ x: 2, y: 2, z: 1, depth: .314 }];
    const copy = JSON.parse(JSON.stringify(d)); expect(() => validateWeather(copy, blocks())).not.toThrow();
    advanceWeather(d.weather, d.seed, d.settings, d.tick + DAY);
    advanceWeather(copy.weather, copy.seed, copy.settings, copy.tick + DAY);
    expect(copy.weather).toEqual(d.weather); expect(copy.snow).toEqual(d.snow);
  });
  it('migrates old data with no changes to people, fire dates, resources or already elapsed time', () => {
    const old: Record<string, any> = { version: 26, seed: 73129, tick: 123456, settings: { ...settings }, generator: 2,
      pawns: [{ id: 1, x: 8 }], items: [{ id: 2, amount: 75 }], fireHazards: { nextIncidentTick: 130000 } };
    const preserved = structuredClone(old); rejectLegacyWeatherFields(old); migrateWeather(old, 26);
    expect(old.weather).toEqual(initialWeather(old.seed, settings, old.tick)); expect(old.snow).toEqual([]);
    const { weather: _weather, snow: _snow, ...rest } = old; expect(rest).toEqual(preserved);
    expect(() => validateWeather(old as never, blocks())).not.toThrow();
  });
  it('rejects new weather fields in pre-weather saves rather than silently replacing them', () => {
    expect(() => rejectLegacyWeatherFields({ version: 26, weather: {} })).toThrow(/旧版本/);
    expect(() => rejectLegacyWeatherFields({ version: 1, snow: [] })).toThrow(/旧版本/);
    expect(() => rejectLegacyWeatherFields({ version: 27, weather: {} })).not.toThrow();
  });
  it('retains distinct supported snow layers, low ceilings and the highest air cell', () => {
    const d = context(), terrain = blocks();
    terrain[index(2, 2, 2)] = Block.Wood;
    terrain[index(2, 2, HEIGHT - 2)] = Block.Wood;
    d.snow = [{ x: 2, y: 2, z: 1, depth: .4 }, { x: 2, y: 2, z: HEIGHT - 1, depth: .2 }];
    expect(() => validateWeather(d, terrain)).not.toThrow();
  });
  const mutations: [string, (d: ReturnType<typeof context>) => void][] = [
    ['future epoch', d => { d.weather.epoch = d.tick + 1; }],
    ['forged cycle', d => { d.weather.cycle++; }],
    ['forged next date', d => { d.weather.nextTransitionTick++; }],
    ['forged start', d => { d.weather.startedTick++; }],
    ['forged kind', d => { d.weather.kind = 'invalid' as never; }],
    ['forged previous kind', d => { d.weather.previousKind = 'invalid' as never; }],
    ['missing history', d => { d.weather.events.pop(); }],
    ['history date', d => { d.weather.events[0].tick++; }],
    ['history weather', d => { d.weather.events[0].to = 'invalid' as never; }],
    ['unknown saved coefficient', d => { (d.weather as any).rainRate = 1; }],
    ['duplicate snow', d => { d.snow.push({ ...d.snow[0] }); }],
    ['negative snow', d => { d.snow[0].depth = -1; }],
    ['zero sparse snow', d => { d.snow[0].depth = 0; }],
    ['excess snow', d => { d.snow[0].depth = 1.001; }],
    ['nonfinite snow', d => { d.snow[0].depth = NaN; }],
    ['fractional coordinates', d => { d.snow[0].x += .5; }],
    ['unsupported snow', d => { d.snow[0].x++; }],
    ['unknown snow id', d => { (d.snow[0] as any).id = 123; }],
  ];
  it.each(mutations)('rejects %s', (_name, mutate) => {
    const d = context(DAY * 20); d.snow = [{ x: 2, y: 2, z: 1, depth: .314 }];
    mutate(d); expect(() => validateWeather(d, blocks())).toThrow();
  });
  it('rejects snow in solid cells and an invalid raw support grid', () => {
    const d = context(); d.snow = [{ x: 2, y: 2, z: 1, depth: .314 }];
    const terrain = blocks(); terrain[at(d.snow[0])] = Block.Wood;
    expect(() => validateWeather(d, terrain)).toThrow();
    expect(() => validateWeather(d, new Uint8Array(1))).toThrow();
  });
});
