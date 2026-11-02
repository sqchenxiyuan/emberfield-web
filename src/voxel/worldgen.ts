import {
  Block,
  CELLS,
  DEPTH,
  HEIGHT,
  WIDTH,
  at,
  index,
  type Biome,
  type Pos,
  type Tree,
  type TreeSpecies,
  type WorldPreview,
  type WorldSettings,
  type WorldSummary,
} from './types';
import { growingSeasonDays } from './climate';
import { fertilityOf, MIN_CROP_FERTILITY } from './farming';

export const WORLD_PRESETS: Record<Biome, WorldSettings> = {
  temperate: {
    biome: 'temperate',
    hilliness: 'small',
    meanTemperature: 17,
    rainfall: 1100,
    latitude: 35,
  },
  boreal: { biome: 'boreal', hilliness: 'large', meanTemperature: 3, rainfall: 850, latitude: 60 },
  desert: { biome: 'desert', hilliness: 'small', meanTemperature: 30, rainfall: 120, latitude: 25 },
};
export const DEFAULT_WORLD_SETTINGS: Readonly<WorldSettings> = Object.freeze({
  ...WORLD_PRESETS.temperate,
});
const BIOMES = ['temperate', 'boreal', 'desert'] as const;
const HILLINESS = ['flat', 'small', 'large', 'mountainous'] as const;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export function sanitizeWorldSettings(input: Partial<WorldSettings> = {}): WorldSettings {
  if (!input || typeof input !== 'object') input = {};
  const biome = BIOMES.includes(input.biome as Biome) ? input.biome! : 'temperate';
  const preset = WORLD_PRESETS[biome];
  const number = (key: 'meanTemperature' | 'rainfall' | 'latitude', min: number, max: number) =>
    finite(input[key]) ? Math.max(min, Math.min(max, input[key]!)) : preset[key];
  return {
    biome,
    hilliness: HILLINESS.includes(input.hilliness!) ? input.hilliness! : preset.hilliness,
    meanTemperature: number('meanTemperature', -30, 45),
    rainfall: number('rainfall', 0, 4000),
    latitude: number('latitude', -90, 90),
  };
}
export function validWorldSettings(value: unknown): value is WorldSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as WorldSettings,
    cleaned = sanitizeWorldSettings(v);
  return (
    Object.keys(cleaned).every(
      (key) => v[key as keyof WorldSettings] === cleaned[key as keyof WorldSettings],
    ) && Object.keys(v).length === 5
  );
}
export const TREE_DATA: Record<TreeSpecies, { wood: number; minFertility: number }> = {
  poplar: { wood: 27, minFertility: 0.7 },
  pine: { wood: 27, minFertility: 0.7 },
  saguaro: { wood: 15, minFertility: 0.05 },
};
function hash(seed: number, x: number, y: number, salt = 0): number {
  // Fold both halves of any safe integer seed so seeds differing by 2^32 remain distinct.
  let a =
    Math.imul((seed | 0) ^ Math.floor(seed / 4294967296), 374761393) ^
    Math.imul(x + 117, 668265263) ^
    Math.imul(y + 881, 1274126177) ^
    Math.imul(salt + 1447, 1597334677);
  a = Math.imul(a ^ (a >>> 13), 1274126177);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
}
function noise(seed: number, x: number, y: number, salt: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    dx = x - ix,
    dy = y - iy;
  const u = dx * dx * (3 - 2 * dx),
    v = dy * dy * (3 - 2 * dy);
  return (
    (hash(seed, ix, iy, salt) * (1 - u) + hash(seed, ix + 1, iy, salt) * u) * (1 - v) +
    (hash(seed, ix, iy + 1, salt) * (1 - u) + hash(seed, ix + 1, iy + 1, salt) * u) * v
  );
}
function surfaceMaps(blocks: Uint8Array): { heightMap: Uint8Array; surfaceMap: Uint8Array } {
  const heightMap = new Uint8Array(WIDTH * DEPTH),
    surfaceMap = new Uint8Array(WIDTH * DEPTH);
  for (let y = 0; y < DEPTH; y++)
    for (let x = 0; x < WIDTH; x++) {
      let z = HEIGHT - 1;
      while (z > 0 && blocks[index(x, y, z)] === Block.Air) z--;
      const i = y * WIDTH + x;
      heightMap[i] = z + 1;
      surfaceMap[i] = blocks[index(x, y, z)];
    }
  return { heightMap, surfaceMap };
}
export function summarizeWorld(
  blocks: Uint8Array,
  trees: readonly Omit<Tree, 'id'>[],
  spawn: Pos,
  settings: WorldSettings,
): WorldSummary {
  const { heightMap, surfaceMap } = surfaceMaps(blocks);
  const summary: WorldSummary = {
    elevation: { min: Math.min(...heightMap), max: Math.max(...heightMap) },
    surfaceCounts: { soil: 0, richSoil: 0, sand: 0, gravel: 0, stone: 0 },
    resources: { stone: 0, steel: 0, components: 0 },
    trees: { poplar: 0, pine: 0, saguaro: 0, total: trees.length, wood: 0 },
    fertileCells: 0,
    reachableSurfaceCells: 0,
    growingDays: growingSeasonDays(settings),
  };
  const treeCells = new Set(trees.map((t) => t.y * WIDTH + t.x));
  const names: Partial<Record<number, keyof WorldSummary['surfaceCounts']>> = {
    [Block.Soil]: 'soil',
    [Block.RichSoil]: 'richSoil',
    [Block.Sand]: 'sand',
    [Block.Gravel]: 'gravel',
    [Block.Stone]: 'stone',
  };
  for (let i = 0; i < surfaceMap.length; i++) {
    const name = names[surfaceMap[i]];
    if (name) summary.surfaceCounts[name]++;
    if (
      fertilityOf(surfaceMap[i]) >= MIN_CROP_FERTILITY &&
      !treeCells.has(i) &&
      heightMap[i] < HEIGHT - 1
    )
      summary.fertileCells++;
  }
  for (const block of blocks) {
    if (block === Block.Stone) summary.resources.stone++;
    else if (block === Block.Steel) summary.resources.steel++;
    else if (block === Block.Components) summary.resources.components++;
  }
  for (const tree of trees) {
    summary.trees[tree.species]++;
    summary.trees.wood += tree.wood;
  }
  // Surface reachability follows the same one-level walking rule, excluding tree cells.
  const start = spawn.y * WIDTH + spawn.x,
    seen = new Uint8Array(WIDTH * DEPTH),
    queue = [start];
  seen[start] = 1;
  for (let n = 0; n < queue.length; n++) {
    const i = queue[n],
      x = i % WIDTH,
      y = Math.floor(i / WIDTH);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy,
        next = ny * WIDTH + nx;
      if (
        nx < 0 ||
        nx >= WIDTH ||
        ny < 0 ||
        ny >= DEPTH ||
        seen[next] ||
        treeCells.has(next) ||
        heightMap[next] >= HEIGHT - 1 ||
        Math.abs(heightMap[next] - heightMap[i]) > 1
      )
        continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  summary.reachableSurfaceCells = queue.length;
  return summary;
}
export function generateWorld(seed: number, input?: Partial<WorldSettings>) {
  if (!Number.isSafeInteger(seed)) throw new Error('种子必须是安全整数');
  const settings = sanitizeWorldSettings(input),
    blocks = new Uint8Array(CELLS),
    heightMap = new Uint8Array(WIDTH * DEPTH);
  const ranges = { flat: [7, 1], small: [5, 5], large: [3, 9], mountainous: [2, 12] } as const;
  const [base, amplitude] = ranges[settings.hilliness];
  for (let y = 0; y < DEPTH; y++)
    for (let x = 0; x < WIDTH; x++) {
      const rolling = 0.68 * noise(seed, x / 16, y / 16, 1) + 0.32 * noise(seed, x / 7, y / 7, 2);
      heightMap[y * WIDTH + x] = Math.max(3, Math.min(13, base + Math.round(rolling * amplitude)));
    }
  // Pick a naturally gentle central site, then level only a 3x3 landing patch.
  let spawn = { x: 32, y: 32, z: heightMap[32 * WIDTH + 32] },
    score = Infinity;
  for (let y = 26; y <= 38; y++)
    for (let x = 26; x <= 38; x++) {
      const z = heightMap[y * WIDTH + x];
      let roughness = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          roughness += Math.abs(heightMap[(y + dy) * WIDTH + x + dx] - z);
      const candidate = roughness + Math.hypot(x - 32, y - 32) * 0.1 + hash(seed, x, y, 20) * 0.01;
      if (candidate < score) {
        score = candidate;
        spawn = { x, y, z };
      }
    }
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) heightMap[(spawn.y + dy) * WIDTH + spawn.x + dx] = spawn.z;
  const rain = settings.rainfall / 1100;
  for (let y = 0; y < DEPTH; y++)
    for (let x = 0; x < WIDTH; x++) {
      const h = heightMap[y * WIDTH + x],
        wet = noise(seed, x / 8, y / 8, 3),
        rock = noise(seed, x / 5, y / 5, 4);
      const slope = Math.max(
        ...[
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].map(([dx, dy]) => {
          const nx = Math.max(0, Math.min(WIDTH - 1, x + dx)),
            ny = Math.max(0, Math.min(DEPTH - 1, y + dy));
          return Math.abs(h - heightMap[ny * WIDTH + nx]);
        }),
      );
      // Thresholds, noise fields and rainfall shifts are our 3D terrain design.
      let top: number =
        settings.biome === 'desert'
          ? wet + Math.min(0.25, rain * 0.16) > 0.8
            ? Block.Soil
            : Block.Sand
          : wet + Math.min(0.14, (rain - 1) * 0.08) > 0.87
            ? Block.RichSoil
            : Block.Soil;
      if (settings.biome !== 'desert' && settings.rainfall < 350 && wet < 0.6) top = Block.Gravel;
      const rocky =
        settings.hilliness === 'mountainous' ? 0.52 : settings.hilliness === 'large' ? 0.68 : 0.84;
      if ((slope >= 1 && rock > rocky) || slope > 1) top = Block.Stone;
      else if (rock > 0.87) top = Block.Gravel;
      for (let z = 0; z < h; z++)
        blocks[index(x, y, z)] =
          z === 0
            ? Block.Bedrock
            : z === h - 1
              ? top
              : z === h - 2 && top !== Block.Stone
                ? top === Block.RichSoil
                  ? Block.Soil
                  : top
                : Block.Stone;
    }
  // A finite set of bounded 3D random walks, never one 2D vein repeated through every layer.
  const attempts = { flat: 20, small: 32, large: 44, mountainous: 60 }[settings.hilliness];
  for (let vein = 0; vein < attempts; vein++) {
    let x = 2 + Math.floor(hash(seed, vein, 0, 30) * 60),
      y = 2 + Math.floor(hash(seed, vein, 1, 30) * 60);
    let z = 1 + Math.floor(hash(seed, vein, 2, 30) * Math.max(1, heightMap[y * WIDTH + x] - 2));
    const kind = vein % 8 === 0 ? Block.Components : Block.Steel;
    const size = (kind === Block.Components ? 5 : 10) + Math.floor(hash(seed, vein, 3, 30) * 7);
    for (let n = 0; n < size; n++) {
      if (blocks[index(x, y, z)] === Block.Stone) blocks[index(x, y, z)] = kind;
      const dir = Math.floor(hash(seed, vein, n, 31) * 6);
      x = Math.max(1, Math.min(WIDTH - 2, x + (dir === 0 ? 1 : dir === 1 ? -1 : 0)));
      y = Math.max(1, Math.min(DEPTH - 2, y + (dir === 2 ? 1 : dir === 3 ? -1 : 0)));
      z = Math.max(1, Math.min(HEIGHT - 3, z + (dir === 4 ? 1 : dir === 5 ? -1 : 0)));
    }
  }
  const trees: Omit<Tree, 'id'>[] = [];
  for (let y = 0; y < DEPTH; y++)
    for (let x = 0; x < WIDTH; x++) {
      if (Math.hypot(x - spawn.x, y - spawn.y) < 3) continue;
      const z = heightMap[y * WIDTH + x],
        fertility = fertilityOf(blocks[index(x, y, z - 1)]);
      const species: TreeSpecies =
        settings.biome === 'desert' ? 'saguaro' : settings.biome === 'boreal' ? 'pine' : 'poplar';
      if (fertility < TREE_DATA[species].minFertility) continue;
      // Tree cover is a separately calibrated subset, not RimWorld's total wild-plant density.
      const baseTreeCover =
        settings.biome === 'desert' ? 0.014 : settings.biome === 'boreal' ? 0.085 : 0.065;
      const moisture =
        settings.biome === 'desert'
          ? 0.6 + Math.min(0.9, settings.rainfall / 500)
          : Math.min(1.4, 0.15 + rain);
      const local = 0.5 + noise(seed, x / 10, y / 10, 40);
      const density =
        baseTreeCover *
        moisture *
        local *
        (species === 'saguaro' ? 1 : Math.min(1.5, fertility * fertility));
      if (hash(seed, x, y, 41) < density)
        trees.push({ x, y, z, species, wood: TREE_DATA[species].wood });
    }
  return {
    generator: 2 as const,
    seed,
    settings,
    spawn,
    blocks,
    trees,
    ...surfaceMaps(blocks),
    summary: summarizeWorld(blocks, trees, spawn, settings),
  };
}
/** Pure fresh buffers. Preview never creates a simulation or touches its jobs/time/state. */
export function previewWorld(seed: number, settings?: Partial<WorldSettings>): WorldPreview {
  const { blocks: _blocks, ...preview } = generateWorld(seed, settings);
  return preview;
}
