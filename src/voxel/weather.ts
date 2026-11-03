import { DAY, TPS, type Pos, type WorldSettings } from './types';
import { outdoorTemperature } from './climate';

export type WeatherKind = 'clear' | 'fog' | 'rain' | 'thunderstorm' | 'snow';
export interface WeatherEvent { tick: number; from: WeatherKind; to: WeatherKind }
export interface WeatherState {
  epoch: number; cycle: number; kind: WeatherKind; previousKind: WeatherKind;
  startedTick: number; nextTransitionTick: number; events: WeatherEvent[];
}
export interface WeatherEffects {
  rainRate: number; snowRate: number; moveFactor: number; accuracyFactor: number;
  maxSkyGlow: number; visualDim: number;
}
export type WeatherView = WeatherState & { effects: WeatherEffects };
export interface SnowCover extends Pos { depth: number }
export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'fog', 'rain', 'thunderstorm', 'snow'];
export const WEATHER_NAMES: Readonly<Record<WeatherKind, string>> = {
  clear: '晴朗', fog: '雾', rain: '降雨', thunderstorm: '雷雨', snow: '降雪',
};
/** Selected Core rain/fog/gentle-snow movement, accuracy and precipitation
 * definitions. Visual dim is our renderer tint, never a solar-generation factor.
 * None of these selected definitions imposes a maxGlow override. */
export const WEATHER_DEFS: Readonly<Record<WeatherKind, Readonly<WeatherEffects>>> = {
  clear: { rainRate: 0, snowRate: 0, moveFactor: 1, accuracyFactor: 1, maxSkyGlow: 1, visualDim: 0 },
  fog: { rainRate: 0, snowRate: 0, moveFactor: 1, accuracyFactor: .5, maxSkyGlow: 1, visualDim: .15 },
  rain: { rainRate: 1, snowRate: 0, moveFactor: .9, accuracyFactor: .8, maxSkyGlow: 1, visualDim: .2 },
  thunderstorm: { rainRate: 1, snowRate: 0, moveFactor: .8, accuracyFactor: .8, maxSkyGlow: 1, visualDim: .32 },
  snow: { rainRate: 1, snowRate: .8, moveFactor: 1, accuracyFactor: .8, maxSkyGlow: 1, visualDim: .1 },
};
/** The random calendar, precipitation weights and fire suppression are explicit
 * Web tuning. The 4000 native-tick blend is mapped by 20/60, not game-day length.
 * Snow rates replace native randomly sampled cells with a continuous expected
 * sample frequency; native per-cell Perlin variation is deliberately omitted. */
export const WEATHER_RULES = {
  interval: DAY / 3, intervalJitter: DAY / 8,
  transitionTicks: Math.ceil(4000 * TPS / 60), maxEvents: 32,
  rainExtinguishPerSecond: .12,
  snowSampleFrequency: .0006 * 60,
  snowAccumulationPerSample: .046,
  snowTemperatureMaximum: -.5,
} as const;
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
function integer(value: number, name: string, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw new RangeError(`天气${name}无效`);
}
function context(seed: number, settings: WorldSettings, tick: number, generator: 1 | 2) {
  if (!Number.isSafeInteger(seed)) throw new RangeError('天气种子无效');
  integer(tick, '计时');
  if (!settings || !Number.isFinite(settings.rainfall) || settings.rainfall < 0 || settings.rainfall > 4000 ||
      !Number.isFinite(settings.meanTemperature) || settings.meanTemperature < -30 || settings.meanTemperature > 45 ||
      !Number.isFinite(settings.latitude) || settings.latitude < -90 || settings.latitude > 90 ||
      ![1, 2].includes(generator)) throw new RangeError('天气气候参数无效');
}
/** Independent stream; both halves of safe-integer world seeds participate. */
export function weatherRandom(seed: number, epoch: number, cycle: number, stream = 0): number {
  let h = Math.imul((seed | 0) ^ Math.floor(seed / 4294967296), 0x45d9f3b) ^
    Math.imul((epoch | 0) ^ Math.floor(epoch / 4294967296), 0x27d4eb2d) ^
    Math.imul((cycle | 0) ^ Math.floor(cycle / 4294967296), 0x85ebca6b) ^ Math.imul(stream + 701, 374761393);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Deadline after this episode. Bounded positive jitter keeps intervals longer
 * than the effect blend and makes arbitrary dates directly verifiable. */
export function nextWeatherTransition(seed: number, epoch: number, cycle: number): number {
  integer(epoch, '起点'); integer(cycle, '周期');
  const result = epoch + (cycle + 1) * WEATHER_RULES.interval +
    Math.floor(weatherRandom(seed, epoch, cycle, 1) * WEATHER_RULES.intervalJitter);
  if (!Number.isSafeInteger(result)) throw new RangeError('天气日历超出计时范围');
  return result;
}
export function weatherCycleAt(seed: number, epoch: number, tick: number): number {
  integer(epoch, '起点'); integer(tick, '计时', epoch);
  const candidate = Math.floor((tick - epoch) / WEATHER_RULES.interval);
  return candidate > 0 && tick < nextWeatherTransition(seed, epoch, candidate - 1) ? candidate - 1 : candidate;
}
export function weatherAtCycle(seed: number, settings: WorldSettings, epoch: number, cycle: number, generator: 1 | 2 = 2): WeatherKind {
  context(seed, settings, epoch, generator); integer(cycle, '周期');
  if (cycle === 0) return 'clear';
  // Independently sampled episodes may continue the same weather. There is no
  // prescribed clear/rain/snow sequence and no dependence on fire-event rolls.
  const wetChance = clamp(settings.rainfall / 2200, 0, .65);
  const roll = weatherRandom(seed, epoch, cycle, 2);
  if (roll < wetChance) {
    const start = nextWeatherTransition(seed, epoch, cycle - 1);
    if (outdoorTemperature(start, settings, generator) <= WEATHER_RULES.snowTemperatureMaximum) return 'snow';
    return weatherRandom(seed, epoch, cycle, 3) < .25 ? 'thunderstorm' : 'rain';
  }
  const fogChance = .1 + .1 * clamp(settings.rainfall / 2200);
  return roll < wetChance + fogChance ? 'fog' : 'clear';
}
export function initialWeather(seed: number, settings: WorldSettings, tick = 0, generator: 1 | 2 = 2): WeatherState {
  context(seed, settings, tick, generator);
  return { epoch: tick, cycle: 0, kind: 'clear', previousKind: 'clear', startedTick: tick,
    nextTransitionTick: nextWeatherTransition(seed, tick, 0), events: [] };
}
/** Mutates only the provided weather state. Large valid time advances rebuild
 * at most 32 retained events instead of looping over years of expired episodes. */
export function advanceWeather(state: WeatherState, seed: number, settings: WorldSettings, tick: number, generator: 1 | 2 = 2): void {
  context(seed, settings, tick, generator);
  integer(state.epoch, '起点'); integer(state.cycle, '周期');
  if (tick < state.startedTick) throw new RangeError('天气不能倒退推进');
  if (tick < state.nextTransitionTick) return;
  const cycle = weatherCycleAt(seed, state.epoch, tick);
  if (cycle <= state.cycle) return;
  const first = Math.max(state.cycle + 1, cycle - WEATHER_RULES.maxEvents + 1);
  if (cycle - state.cycle >= WEATHER_RULES.maxEvents) state.events = [];
  for (let i = first; i <= cycle; i++) state.events.push({
    tick: nextWeatherTransition(seed, state.epoch, i - 1),
    from: weatherAtCycle(seed, settings, state.epoch, i - 1, generator),
    to: weatherAtCycle(seed, settings, state.epoch, i, generator),
  });
  state.events = state.events.slice(-WEATHER_RULES.maxEvents);
  state.cycle = cycle;
  state.kind = weatherAtCycle(seed, settings, state.epoch, cycle, generator);
  state.previousKind = weatherAtCycle(seed, settings, state.epoch, cycle - 1, generator);
  state.startedTick = nextWeatherTransition(seed, state.epoch, cycle - 1);
  state.nextTransitionTick = nextWeatherTransition(seed, state.epoch, cycle);
}
export function weatherEffects(state: WeatherState, tick: number): WeatherEffects {
  if (!WEATHER_KINDS.includes(state.kind) || !WEATHER_KINDS.includes(state.previousKind) ||
      !Number.isSafeInteger(state.startedTick) || !Number.isSafeInteger(tick) || tick < state.startedTick)
    throw new RangeError('天气效果时间或类型无效');
  const from = WEATHER_DEFS[state.previousKind], to = WEATHER_DEFS[state.kind];
  const blend = clamp((tick - state.startedTick) / WEATHER_RULES.transitionTicks);
  return Object.fromEntries(Object.keys(to).map(key => {
    const k = key as keyof WeatherEffects;
    return [k, from[k] + (to[k] - from[k]) * blend];
  })) as unknown as WeatherEffects;
}
/** Spatial eligibility is supplied by the world: both outdoor-temperature room
 * and sky exposure are required to deposit snow. Existing covered snow can melt
 * at its actual cell temperature, and remains when that cell is below freezing. */
export function snowDepthAfter(depth: number, snowRate: number, temp: number, exposed: boolean, outdoors: boolean, elapsedSeconds: number): number {
  if (![depth, snowRate, temp, elapsedSeconds].every(Number.isFinite) || depth < 0 || depth > 1 ||
      snowRate < 0 || snowRate > 10 || elapsedSeconds < 0 || typeof exposed !== 'boolean' || typeof outdoors !== 'boolean')
    throw new RangeError('积雪深度或环境参数无效');
  const accumulation = exposed && outdoors ? WEATHER_RULES.snowAccumulationPerSample * snowRate : 0;
  const melt = temp < 0 ? 0 : temp < 10 ? temp * temp * .0058 * .1 : temp * .0058;
  return clamp(depth + (accumulation - melt) * WEATHER_RULES.snowSampleFrequency * elapsedSeconds);
}
export function snowPathCost(depth: number): number {
  if (!Number.isFinite(depth) || depth < 0 || depth > 1) throw new RangeError('积雪深度无效');
  return depth < .03 ? 0 : depth < .25 ? 0 : depth < .5 ? 4 : depth < .75 ? 8 : 12;
}
