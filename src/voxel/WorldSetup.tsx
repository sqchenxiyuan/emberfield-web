import { useEffect, useRef, useState } from 'react';
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
export const TREE_NAMES = { poplar: '白杨', pine: '松树', saguaro: '巨柱仙人掌' };
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
  create: (seed: number, settings: WorldSettings) => Promise<void>;
}) {
  const [seed, setSeed] = useState('73129');
  const [settings, setSettings] = useState<WorldSettings>({ ...DEFAULT_WORLD_SETTINGS });
  const [preview, setPreview] = useState<WorldPreview | null>(null);
  const [error, setError] = useState('');
  const signature = JSON.stringify({ seed, settings });
  const [previewSignature, setPreviewSignature] = useState('');
  const valid = seed.trim() !== '' && Number.isSafeInteger(Number(seed));
  const validClimate = validWorldSettings(settings);
  useEffect(() => {
    let cancelled = false;
    setError('');
    if (!valid) {
      setError('请输入整数种子');
      return;
    }
    if (!validClimate) {
      setError('温度范围 −30～45°C，降雨量 0～4000 mm，纬度 −90～90°');
      return;
    }
    const timer = setTimeout(() => {
      void client
        .previewWorld(Number(seed), settings)
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
  return (
    <section className="voxel-world-setup" aria-label="创建体素世界">
      <h3>选择落脚之地</h3>
      <p>先看地形，再规划营地。高差可开挖，地下矿脉有限；气候会改变作物生长和食物保存。</p>
      <div className="voxel-world-fields">
        <label>
          世界种子
          <input aria-label="体素世界种子" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </label>
        <label>
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
        </label>
      </div>
      <div className="voxel-world-fields">
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
      </small>
      <div
        className="voxel-world-preview"
        aria-live="polite"
        data-testid="world-preview"
        data-ready={!!current}
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
                <dt>成熟木本植物</dt>
                <dd>
                  {current.summary.trees.total} 株 · {current.summary.trees.wood} 木材
                </dd>
                <dt>地下钢矿 / 零件矿</dt>
                <dd>
                  {current.summary.resources.steel} / {current.summary.resources.components} 方块
                </dd>
              </dl>
              <small>
                矿物与裸地为全图初始数量，可能需要开路或梯井。生长期按季节均温估算，室内实际温度另计。
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
          <p>正在预览地形…</p>
        )}
      </div>
      <button
        disabled={busy || !current}
        onClick={() => current && void create(current.seed, current.settings)}
      >
        新开世界（替换当前进度）
      </button>
    </section>
  );
}
