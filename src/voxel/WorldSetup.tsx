import { useEffect, useMemo, useRef, useState } from 'react';
import type { VoxelClient } from './client';
import {
  Block,
  WIDTH,
  DEPTH,
  type Biome,
  type Hilliness,
  type WorldPreview,
  type WorldSettings,
} from './types';
import { DEFAULT_WORLD_SETTINGS, WORLD_PRESETS, validWorldSettings } from './worldgen';
import { generateRegions, recommendedRegion, type RegionTile, type WorldSite } from './regions';
import { RegionMap, regionLabel } from './RegionMap';

export const BIOME_NAMES: Record<Biome, string> = {
  temperate: '温带森林',
  boreal: '寒带森林',
  desert: '沙漠',
};
export const HILL_NAMES: Record<Hilliness, string> = {
  flat: '平原',
  small: '小丘陵',
  large: '大丘陵',
  mountainous: '山地',
};
const COLORS: Record<number, [number, number, number]> = {
  [Block.Soil]: [119, 148, 83],
  [Block.RichSoil]: [72, 108, 64],
  [Block.Sand]: [206, 175, 112],
  [Block.Gravel]: [143, 145, 127],
  [Block.Stone]: [130, 143, 148],
  [Block.Steel]: [111, 157, 174],
  [Block.Components]: [191, 155, 88],
};

function TerrainPreview({ preview }: { preview: WorldPreview }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(WIDTH, DEPTH);
    for (let i = 0; i < WIDTH * DEPTH; i++) {
      const color = COLORS[preview.surfaceMap[i]] ?? [120, 130, 120];
      const shade = 0.76 + preview.heightMap[i] / 36;
      for (let k = 0; k < 3; k++)
        image.data[i * 4 + k] = Math.min(255, Math.round(color[k] * shade));
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    for (const t of preview.trees) {
      ctx.fillStyle =
        t.species === 'saguaro' ? '#537b51' : t.species === 'pine' ? '#274f47' : '#426537';
      ctx.fillRect(t.x, t.y, 1, 1);
    }
    ctx.strokeStyle = '#fff3ce';
    ctx.lineWidth = 0.65;
    ctx.strokeRect(preview.spawn.x - 1.5, preview.spawn.y - 1.5, 4, 4);
  }, [preview]);
  return (
    <figure className="voxel-terrain-preview">
      <canvas
        ref={canvas}
        width={WIDTH}
        height={DEPTH}
        aria-label="世界地形预览：白框为营地，深色为林木，颜色显示土壤和岩地"
      />
      <figcaption>
        64 × 64 × 16 · 白框为营地
        <br />
        深绿：沃土 · 黄褐：沙地 · 灰色：岩地
      </figcaption>
    </figure>
  );
}

export function WorldSetup({
  client,
  busy,
  create,
}: {
  client: VoxelClient;
  busy: boolean;
  create: (seed: number, settings: WorldSettings, site?: WorldSite) => Promise<void>;
}) {
  const [mode, setMode] = useState<'regions' | 'custom'>('regions');
  const [seed, setSeed] = useState('73129');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<{ site: WorldSite; tile: RegionTile; preview: WorldPreview }[]>([]);
  const [settings, setSettings] = useState<WorldSettings>({ ...DEFAULT_WORLD_SETTINGS });
  const [preview, setPreview] = useState<WorldPreview | null>(null);
  const [error, setError] = useState('');
  const [previewSignature, setPreviewSignature] = useState('');
  const valid = seed.trim() !== '' && Number.isSafeInteger(Number(seed));
  const regional = useMemo(() => {
    if (!valid) return { map: null, error: '' };
    try { return { map: generateRegions(Number(seed)), error: '' }; }
    catch (error) { return { map: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [seed, valid]);
  useEffect(() => { setSelectedId(regional.map ? recommendedRegion(regional.map)?.id ?? null : null); }, [regional.map]);
  const selected = regional.map?.tiles.find(t => t.id === selectedId) ?? null;
  const site: WorldSite | undefined = mode === 'regions' && regional.map && selected?.settleable
    ? { version: 2, worldSeed: regional.map.seed, tileId: selected.id } : undefined;
  const signature = JSON.stringify(mode === 'regions' ? { mode, seed, site, selectedId } : { mode, seed, settings });
  const validClimate = mode === 'regions' ? !!site : validWorldSettings(settings);
  useEffect(() => {
    let cancelled = false;
    setError('');
    if (!valid) {
      setError('请输入整数种子');
      return;
    }
    if (mode === 'regions' && (!regional.map || !site)) {
      setError(regional.error || selected?.reason || '');
      return;
    }
    if (mode === 'custom' && !validClimate) {
      setError('温度范围 −30～45°C，降雨量 0～4000 mm，纬度 −90～90°');
      return;
    }
    const timer = setTimeout(() => {
      void (site ? client.previewSite(site) : client.previewWorld(Number(seed), settings))
        .then((result) => {
          if (cancelled) return;
          setPreview(result);
          setPreviewSignature(signature);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, signature, valid, validClimate]);
  const current =
    previewSignature === signature && valid && validClimate && !error ? preview : null;
  const change = <K extends keyof WorldSettings>(key: K, value: WorldSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const changeSeed = (value: string) => {
    setSeed(value); setSelectedId(null); setCandidates([]); setPreview(null); setPreviewSignature(''); setError('');
  };
  const chooseRegion = (tile: RegionTile) => {
    if (tile.id === selectedId) return;
    setSelectedId(tile.id); setPreview(null); setPreviewSignature(''); setError('');
  };
  const addCandidate = () => {
    if (!current || !site || !selected || candidates.length >= 3 || candidates.some(c => c.site.worldSeed === site.worldSeed && c.site.tileId === site.tileId)) return;
    setCandidates(all => all.length >= 3 || all.some(c => c.site.worldSeed === site.worldSeed && c.site.tileId === site.tileId) ? all : [...all, { site, tile: selected, preview: current }]);
  };
  return (
    <section className="voxel-world-setup" aria-label="创建体素世界">
      <h3>选择落脚之地</h3>
      <p>先看地形，再规划营地。高差可开挖，地下矿脉有限；气候会改变作物生长和食物保存。</p>
      <p className="voxel-exploration-guide" data-testid="world-exploration-guide">地下岩层和洞穴需要探索。先开凿梯井，再切到地下层规划开凿；打通洞穴后才能看清内部，已发现区域会随存档保留。</p>
      <div className="voxel-world-mode" aria-label="地图创建方式">
        <button aria-pressed={mode === 'regions'} onClick={() => setMode('regions')}>区域世界地图</button>
        <button aria-pressed={mode === 'custom'} onClick={() => setMode('custom')}>自定义地图</button>
      </div>
      <div className="voxel-world-fields">
        <label>
          {mode === 'regions' ? '世界种子' : '本地地图种子'}
          <input aria-label="体素世界种子" value={seed} onChange={(e) => changeSeed(e.target.value)} />
        </label>
        {mode === 'custom' && <><label>
          生态群落
          <select
            aria-label="生态群落"
            value={settings.biome}
            onChange={(e) => {
              const biome = e.target.value as Biome;
              setSettings({ ...WORLD_PRESETS[biome], hilliness: settings.hilliness });
            }}
          >
            {Object.entries(BIOME_NAMES).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          地形起伏
          <select
            aria-label="地形起伏"
            value={settings.hilliness}
            onChange={(e) => change('hilliness', e.target.value as Hilliness)}
          >
            {Object.entries(HILL_NAMES).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label></>}
      </div>
      {mode === 'regions' && regional.map && <>
        <RegionMap key={regional.map.seed} map={regional.map} selectedId={selectedId} choose={chooseRegion} />
        {selected && <section className="voxel-region-detail" data-testid="region-detail" data-region-id={selected.id} data-map-seed={selected.mapSeed}>
          <b>地区 #{selected.id} · {regionLabel(selected)}</b>
          <dl><div><dt>地区坐标</dt><dd>({selected.x}, {selected.y})</dd></div>
            <div><dt>纬度 / 经度</dt><dd>{selected.latitude}° / {selected.longitude}°</dd></div>
            <div><dt>年均温度</dt><dd>{selected.temperature}°C</dd></div>
            <div><dt>年降雨量</dt><dd>{selected.rainfall} mm</dd></div>
            <div><dt>生长期估算</dt><dd>{selected.growingDays} / 60 日</dd></div>
            <div><dt>地势</dt><dd>{selected.hilliness === 'impassable' ? '不可通行山峰' : HILL_NAMES[selected.hilliness]}</dd></div></dl>
          {!selected.settleable && <p className="voxel-world-warning">{selected.reason}</p>}
          {selected.settleable && <small>下方显示这处选址的实际营地地形与初始资源；数量包含可能需要开路才能利用的区域。</small>}
        </section>}
      </>}
      {mode === 'custom' && <><div className="voxel-world-fields">
        <label>
          年均温度 · °C
          <input
            aria-label="年均温度"
            type="number"
            min="-30"
            max="45"
            step="1"
            value={settings.meanTemperature}
            onChange={(e) => change('meanTemperature', Number(e.target.value))}
          />
        </label>
        <label>
          年降雨量 · mm
          <input
            aria-label="年降雨量"
            type="number"
            min="0"
            max="4000"
            step="50"
            value={settings.rainfall}
            onChange={(e) => change('rainfall', Number(e.target.value))}
          />
        </label>
        <label>
          纬度 · 北正南负
          <input
            aria-label="纬度"
            type="number"
            min="-90"
            max="90"
            step="5"
            value={settings.latitude}
            onChange={(e) => change('latitude', Number(e.target.value))}
          />
        </label>
      </div>
      <small>
        切换生态会填入气候预设；你可以分别调整。降雨量影响初始植被与土壤，不会生成水体。
      </small></>}
      <small>
        新营地每人有基础布衫与长裤。种棉、建裁缝台可制作保暖外衣或防热长衣；极端寒热仍需庇护与温控，建议先从温带开始。
      </small>
      <div
        className="voxel-world-preview"
        aria-live="polite"
        data-testid="world-preview"
        data-ready={!!current}
        data-generator={current?.generator}
        data-preview-seed={current?.seed}
        data-preview-settings={current ? JSON.stringify(current.settings) : undefined}
        data-preview-summary={current ? JSON.stringify(current.summary) : undefined}
        data-site-id={site?.tileId}
      >
        {error ? (
          <p role="alert">{error}</p>
        ) : current ? (
          <>
            <TerrainPreview preview={current} />
            <div className="voxel-world-summary">
              <b>
                {BIOME_NAMES[current.settings.biome]} · {HILL_NAMES[current.settings.hilliness]}
              </b>
              <dl>
                <dt>地表高度</dt>
                <dd>
                  Z {current.summary.elevation.min}–{current.summary.elevation.max}
                </dd>
                <dt>营地连通地表</dt>
                <dd>{current.summary.reachableSurfaceCells} 格</dd>
                <dt>可种植裸地</dt>
                <dd>{current.summary.fertileCells} 格</dd>
                <dt>适宜生长季估算</dt>
                <dd>{current.summary.growingDays} / 60 日</dd>
                <dt>木本植物</dt>
                <dd>
                  {current.summary.trees.total} 株 · 健康成熟后最多 {current.summary.trees.wood}{' '}
                  木材
                </dd>
                <dt>地下矿藏</dt>
                <dd>进入营地后探索</dd>
              </dl>
              <small>
                裸地为全图初始数量，可能需要开路。预览不揭示地下洞穴或矿藏总量；生长期按季节均温估算，室内实际温度另计。
              </small>
              {current.summary.growingDays < 30 && (
                <p className="voxel-world-warning">生长期较短：优先准备储粮和供暖。</p>
              )}
              {current.summary.trees.wood < 500 && (
                <p className="voxel-world-warning">木材较少：合理分配建材与燃料，尽早加工石砖。</p>
              )}
            </div>
          </>
        ) : (
          <p>{mode === 'regions' && !site ? '请在世界地图上选择可以建立营地的陆地。' : '正在预览地形…'}</p>
        )}
      </div>
      {mode === 'regions' && <section className="voxel-region-comparison" data-testid="region-comparison">
        <div className="voxel-info-row"><b>候选选址 · {candidates.length} / 3</b>
          <button data-testid="region-add-candidate" disabled={!current || !site || candidates.length >= 3 || candidates.some(c => c.site.tileId === site?.tileId)} onClick={addCandidate}>
            {candidates.some(c => c.site.tileId === site?.tileId) ? '已加入对比' : '加入对比'}
          </button></div>
        {!candidates.length && <small>收藏最多三个选址，比较真实营地预览。改变世界种子会清空候选。</small>}
        <div className="voxel-region-candidates">{candidates.map(candidate => <article key={candidate.site.tileId} data-testid="region-candidate" data-region-id={candidate.site.tileId}
          data-preview-seed={candidate.preview.seed} data-preview-summary={JSON.stringify(candidate.preview.summary)}>
          <b>地区 #{candidate.tile.id}</b><span>{regionLabel(candidate.tile)}</span>
          <small>{candidate.tile.temperature}°C · {candidate.tile.rainfall} mm · 生长 {candidate.preview.summary.growingDays} / 60 日</small>
          <dl><div><dt>可种植裸地</dt><dd>{candidate.preview.summary.fertileCells} 格</dd></div>
            <div><dt>木本植物</dt><dd>{candidate.preview.summary.trees.total} 株</dd></div>
            <div><dt>木材潜力</dt><dd>{candidate.preview.summary.trees.wood}</dd></div>
            <div><dt>地下矿藏</dt><dd>需要探索</dd></div></dl>
          <button onClick={() => { if (candidate.site.worldSeed === regional.map?.seed) chooseRegion(candidate.tile); }}>选中地区 #{candidate.tile.id}</button>
          <button aria-label={`移除候选地区 ${candidate.tile.id}`} onClick={() => setCandidates(all => all.filter(c => c.site.tileId !== candidate.site.tileId))}>移除</button>
        </article>)}</div>
      </section>}
      <button
        disabled={busy || !current}
        onClick={() => current && void create(current.seed, current.settings, site)}
      >
        新开世界（替换当前进度）
      </button>
    </section>
  );
}
