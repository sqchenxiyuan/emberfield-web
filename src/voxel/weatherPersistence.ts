import { Block, CELLS, WIDTH, DEPTH, at, inside, type WorldSettings } from './types';
import { WEATHER_RULES, initialWeather, nextWeatherTransition, weatherAtCycle, weatherCycleAt,
  type WeatherState, type SnowCover } from './weather';

interface WeatherSaveContext {
  seed: number; tick: number; settings: WorldSettings; generator: 1 | 2;
  weather: WeatherState; snow: SnowCover[];
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
function fail(reason: string): never { throw new Error('天气存档无效：' + reason); }
export function rejectLegacyWeatherFields(old: Record<string, any>): void {
  if (old.version < 27 && (Object.hasOwn(old, 'weather') || Object.hasOwn(old, 'snow')))
    fail('旧版本包含新版天气或积雪字段');
}
export function migrateWeather(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 27) return;
  old.weather = initialWeather(old.seed, old.settings, old.tick, old.generator);
  old.snow = [];
}
/** Snow is a surface layer, not an actor: no head clearance or furniture
 * exclusion. Even the highest air layer can retain snow on a real support. */
export function validateWeather(d: WeatherSaveContext, blocks: Uint8Array): void {
  const w = d.weather;
  if (!exact(w, ['epoch', 'cycle', 'kind', 'previousKind', 'startedTick', 'nextTransitionTick', 'events']) ||
      !integer(w.epoch, 0, d.tick) || !integer(w.cycle) || !integer(w.startedTick, w.epoch, d.tick) ||
      !integer(w.nextTransitionTick, d.tick + 1) || !Array.isArray(w.events) ||
      w.events.length !== Math.min(w.cycle, WEATHER_RULES.maxEvents)) fail('天气形状、周期或事件数量无效');
  if (w.cycle !== weatherCycleAt(d.seed, w.epoch, d.tick) ||
      w.startedTick !== (w.cycle === 0 ? w.epoch : nextWeatherTransition(d.seed, w.epoch, w.cycle - 1)) ||
      w.nextTransitionTick !== nextWeatherTransition(d.seed, w.epoch, w.cycle) ||
      w.kind !== weatherAtCycle(d.seed, d.settings, w.epoch, w.cycle, d.generator) ||
      w.previousKind !== weatherAtCycle(d.seed, d.settings, w.epoch, Math.max(0, w.cycle - 1), d.generator))
    fail('天气日期或类型不符合确定性日历');
  for (const [index, e] of w.events.entries()) {
    const cycle = w.cycle - w.events.length + index + 1;
    if (!exact(e, ['tick', 'from', 'to']) || e.tick !== nextWeatherTransition(d.seed, w.epoch, cycle - 1) ||
        e.from !== weatherAtCycle(d.seed, d.settings, w.epoch, cycle - 1, d.generator) ||
        e.to !== weatherAtCycle(d.seed, d.settings, w.epoch, cycle, d.generator)) fail('天气切换历史无效');
  }
  if (!(blocks instanceof Uint8Array) || blocks.length !== CELLS || !Array.isArray(d.snow) || d.snow.length > CELLS)
    fail('积雪列表或体素数量无效');
  const cells = new Set<number>();
  for (const s of d.snow) {
    if (!exact(s, ['x', 'y', 'z', 'depth']) || !inside(s) || s.z < 1 ||
        !Number.isFinite(s.depth) || s.depth <= 0 || s.depth > 1 || cells.has(at(s)) ||
        blocks[at(s)] !== Block.Air ||
        blocks[at(s) - WIDTH * DEPTH] === Block.Air) fail('积雪坐标、深度、重复或实际支撑无效');
    cells.add(at(s));
  }
}
