import { at, DAY, TPS, WIDTH, type Pos, type VoxelSnapshot } from './types';
import { WEATHER_NAMES, snowPathCost } from './weather';

const percent = (value: number) => `${Math.round(value * 100)}%`;
const exposedAt = (s: VoxelSnapshot, p: Pos) => p.z >= s.weatherRoof[p.y * WIDTH + p.x];
const snowAt = (s: VoxelSnapshot, p: Pos) => s.snow.find(cell => at(cell) === at(p))?.depth ?? 0;
const snowTicks = (depth: number) => snowPathCost(depth) * TPS / 60;

export function WeatherCellDetails({ snapshot: s, pos }: { snapshot: VoxelSnapshot; pos: Pos }) {
  const exposed = exposedAt(s, pos), depth = snowAt(s, pos), effects = s.weather.effects;
  const move = exposed ? effects.moveFactor : 1, accuracy = exposed ? effects.accuracyFactor : 1;
  const rain = exposed ? effects.rainRate : 0, snow = exposed ? effects.snowRate : 0;
  return <section className="voxel-weather-cell" data-testid="weather-cell-detail" data-exposed={exposed}
    data-snow-depth={depth} data-weather-move={move} data-weather-accuracy={accuracy} data-snow-ticks={snowTicks(depth)}>
    <div className="voxel-info-row"><b>当地天气影响</b><span>{exposed ? '露天' : '上方有遮蔽'}</span></div>
    <small>{pos.x}, {pos.y} · Z {pos.z} · {snow > 0 ? '雪可以落到此处' : rain > 0 ? '雨水可以落到此处' : exposed ? '当前没有降水' : '此处不受降水直接影响'}</small>
    <dl>
      <div><dt>天气移速</dt><dd>{percent(move)}</dd></div>
      <div><dt>积雪覆盖</dt><dd>{percent(depth)}</dd></div>
      <div><dt>积雪基础通行耗时</dt><dd>+{(snowTicks(depth) / TPS).toFixed(2)} 秒 / 格</dd></div>
    </dl>
    {depth > 0 && <progress aria-label="选中格积雪覆盖" value={depth} max={1} />}
    <small>天气影响从此格出发的移动；积雪增加进入此格的耗时，与其他障碍取较大值。实际耗时还受人物状态影响；这里按 1 倍速计。</small>
    <small>{exposed ? `涉及此处的射击，天气命中系数 ${percent(accuracy)}。` : `射手和目标均有顶时，天气命中系数 100%；另一端露天时为 ${percent(effects.accuracyFactor)}。`}</small>
  </section>;
}

export function WeatherPanel({ snapshot: s, selectedPos, focus, close }: {
  snapshot: VoxelSnapshot; selectedPos: Pos | null; focus: (pos: Pos) => void; close: () => void;
}) {
  const weather = s.weather, effects = weather.effects;
  const snow = [...s.snow].sort((a, b) => b.depth - a.depth || at(a) - at(b));
  const outdoorFires = s.fires.filter(f => exposedAt(s, f)).length;
  const solar = s.devices.filter(d => d.kind === 'solar');
  const elapsed = Math.max(0, s.tick - weather.startedTick) / DAY;
  return <aside className="voxel-weather-drawer" data-testid="weather-panel" aria-label="天气与环境" data-weather-kind={weather.kind}>
    <div className="voxel-weather-heading"><h2>天气与环境</h2><button aria-label="关闭天气面板" onClick={close}>×</button></div>
    <section className="voxel-weather-current">
      <div className="voxel-info-row"><b>{WEATHER_NAMES[weather.kind]}</b><span>室外 {s.temperature.toFixed(1)}°C</span></div>
      <small>已持续 {elapsed.toFixed(2)} 日{weather.previousKind !== weather.kind ? ` · 此前${WEATHER_NAMES[weather.previousKind]}` : ''}</small>
      <dl>
        <div><dt>降水强度</dt><dd data-testid="weather-rain-rate" data-value={effects.rainRate}>{percent(effects.rainRate)}</dd></div>
        <div><dt>降雪强度</dt><dd data-testid="weather-snow-rate" data-value={effects.snowRate}>{percent(effects.snowRate)}</dd></div>
        <div><dt>露天天气移速</dt><dd data-testid="weather-move-factor" data-value={effects.moveFactor}>{percent(effects.moveFactor)}</dd></div>
        <div><dt>露天射击天气系数</dt><dd data-testid="weather-accuracy-factor" data-value={effects.accuracyFactor}>{percent(effects.accuracyFactor)}</dd></div>
      </dl>
      <small>射击任一端露天时计入天气；最终命中还取决于人物、武器、距离和掩护。</small>
    </section>
    {selectedPos ? <WeatherCellDetails snapshot={s} pos={selectedPos} /> : <p>用查看工具选择一格，可查看其遮蔽、积雪和通行影响。</p>}
    <section className="voxel-weather-effects">
      <h3>降水与营地</h3>
      <p>{effects.rainRate > 0 ? `降水正在影响露天火焰；当前 ${outdoorFires} 处火点露天。` : '当前没有降水扑灭火焰的作用。'}</p>
      <small>真实屋顶可以遮挡降水；切换查看楼层不会移除屋顶。树冠和设备本身不视为屋顶。</small>
      <p>太阳能按昼夜与面板上方遮挡发电。</p>
      {solar.length ? solar.map(d => <button key={d.id} aria-label={`查看太阳能发电机 #${d.id}`} onClick={() => focus(d)}>
        太阳能 #{d.id} · {Math.round(d.watts)} W
      </button>) : <small>营地还没有太阳能发电机。</small>}
    </section>
    <section className="voxel-weather-snow" aria-label="实际积雪">
      <h3>积雪 · {snow.length} 格</h3>
      <p>积雪会保留到融化或地形变化，停雪后仍可能影响通行。</p>
      {snow.slice(0, 20).map(cell => <div key={at(cell)} data-snow-cell={at(cell)} data-depth={cell.depth}>
        <span>{cell.x}, {cell.y} · Z {cell.z} · 覆盖 {percent(cell.depth)}</span>
        <button aria-label={`查看积雪 ${at(cell)}`} onClick={() => focus(cell)}>查看</button>
      </div>)}
      {!snow.length && <small>当前没有积雪。</small>}
      {snow.length > 20 && <small>列出积雪最多的前 20 格；其他位置可以在地图查看。</small>}
    </section>
  </aside>;
}
