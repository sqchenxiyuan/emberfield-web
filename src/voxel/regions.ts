import type { Biome, Hilliness, WorldSettings } from './types';
import { growingSeasonDays } from './climate';

/** A world selection identifies a place; the local map keeps its own independent seed. */
export interface WorldSite {
  /** v1 keeps generator 2; v2 uses the same regions with generator 3 caves. */
  version: 1 | 2;
  worldSeed: number;
  tileId: number;
}

export interface RegionTile {
  id: number;
  x: number;
  y: number;
  latitude: number;
  longitude: number;
  elevation: number;
  biome: Biome | 'ocean';
  hilliness: Hilliness | 'impassable';
  temperature: number;
  rainfall: number;
  settleable: boolean;
  reason: string | null;
  mapSeed: number;
  settings: WorldSettings | null;
  growingDays: number;
}

export interface RegionMap {
  version: 1;
  seed: number;
  width: number;
  height: number;
  tiles: RegionTile[];
}

/**
 * Emberfield's provisional world design, not RimWorld's icosphere or biome workers.
 * These version-1 rules are save identity: later balancing must introduce a new
 * site version and retain this resolver for existing saves.
 */
export const REGION_RULES = Object.freeze({
  version: 1 as const,
  width: 48,
  height: 24,
  seaLevel: 0.48,
  impassableElevation: 4200,
  coldForestTemperature: 7,
  desertRainfall: 450,
  desertMinTemperature: 8,
});

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const rounded = (value: number, places = 0) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};
/** A bijection of uint32, used to give every tile in a world a distinct local seed. */
function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}
function seedKey(seed: number): number {
  // Do not silently alias worlds separated by 2^32; fold the signed upper half too.
  return mix32((seed | 0) ^ Math.imul(Math.floor(seed / 4294967296), 0x9e3779b1));
}
function validateSeed(seed: unknown): asserts seed is number {
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed))
    throw new Error('世界种子必须是安全整数');
}
function hash(key: number, x: number, y: number, z: number, salt: number): number {
  return mix32(key ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^
    Math.imul(z, 1274126177) ^ Math.imul(salt, 1597334677)) / 4294967296;
}
function noise(key: number, x: number, y: number, z: number, salt: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const dx = smooth(x - ix), dy = smooth(y - iy), dz = smooth(z - iz);
  let sum = 0;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++)
    sum += hash(key, ix + i, iy + j, iz + k, salt) *
      (i ? dx : 1 - dx) * (j ? dy : 1 - dy) * (k ? dz : 1 - dz);
  return sum;
}

/** Evaluate only one tile: loading a save does not regenerate all world/local maps. */
export function regionTile(worldSeed: number, tileId: number): RegionTile {
  validateSeed(worldSeed);
  if (!Number.isInteger(tileId) || tileId < 0 || tileId >= REGION_RULES.width * REGION_RULES.height)
    throw new Error('地区编号超出世界范围');
  const key = seedKey(worldSeed), x = tileId % REGION_RULES.width, y = Math.floor(tileId / REGION_RULES.width);
  const latitude = 90 - (y + 0.5) * 180 / REGION_RULES.height;
  const longitude = (x + 0.5) * 360 / REGION_RULES.width - 180;
  const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
  // Sample a sphere, then display its equirectangular projection. Longitude wraps
  // continuously; the visible rectangular cells are not equal-area world hexes.
  const sx = Math.cos(lat) * Math.cos(lon), sy = Math.sin(lat), sz = Math.cos(lat) * Math.sin(lon);
  const field = (scale: number, salt: number) =>
    noise(key, sx * scale + 17.3, sy * scale + 29.1, sz * scale + 43.7, salt);
  const tilt = (hash(key, 0, 0, 0, 1) - 0.5) * 0.8;
  const axis = hash(key, 0, 0, 0, 2) * Math.PI * 2;
  const continental = 0.48 + 0.2 * (sx * Math.cos(axis) + sz * Math.sin(axis) + sy * tilt) +
    0.28 * (field(2.2, 10) * 2 - 1);
  const ocean = continental < REGION_RULES.seaLevel;
  const ridge = field(6.5, 11);
  const elevation = ocean
    ? rounded((continental - REGION_RULES.seaLevel) * 16000)
    : rounded((continental - REGION_RULES.seaLevel) * 8500 + Math.max(0, ridge - 0.45) * 10000);
  const absLat = Math.abs(latitude) / 90;
  // Latitude, elevation and independent climate fields inform the region. All
  // constants here are prototype choices, not claims about original-game values.
  const latitudeTemperature = absLat < 0.5 ? 31 - absLat * 46 : 8 - (absLat - 0.5) * 80;
  const temperature = rounded(clamp(latitudeTemperature - Math.max(0, elevation - 250) * 0.005 +
    (field(4.2, 12) - 0.5) * 12, -30, 45), 1);
  const subtropicalDryness = 1 - 0.65 * Math.exp(-(((Math.abs(latitude) - 27) / 13) ** 2));
  const rainfall = rounded(clamp(4200 * field(5, 13) ** 1.6 * subtropicalDryness *
    (1 - absLat * 0.65) * (1 - clamp(elevation / 7500, 0, 0.6)), 0, 4000));
  const hilliness: RegionTile['hilliness'] = elevation >= REGION_RULES.impassableElevation
    ? 'impassable' : ridge > 0.65 ? 'mountainous' : ridge > 0.53 ? 'large' : ridge > 0.37 ? 'small' : 'flat';
  const biome: RegionTile['biome'] = ocean ? 'ocean'
    : temperature <= REGION_RULES.coldForestTemperature ? 'boreal'
    : rainfall < REGION_RULES.desertRainfall && temperature > REGION_RULES.desertMinTemperature ? 'desert' : 'temperate';
  const settleable = !ocean && hilliness !== 'impassable';
  const settings: WorldSettings | null = settleable ? {
    biome: biome as Biome,
    hilliness: hilliness as Hilliness,
    meanTemperature: temperature,
    rainfall,
    latitude,
  } : null;
  return {
    id: tileId, x, y, latitude, longitude, elevation, biome, hilliness, temperature, rainfall,
    settleable,
    reason: ocean ? '海洋地区不能建立陆地营地' : hilliness === 'impassable' ? '高峰地区不可通行，无法建立营地' : null,
    mapSeed: mix32(key ^ mix32(tileId + 0x51ed270b)),
    settings,
    growingDays: settings ? growingSeasonDays(settings) : 0,
  };
}

export function generateRegions(seed: number): RegionMap {
  validateSeed(seed);
  return {
    version: 1,
    seed,
    width: REGION_RULES.width,
    height: REGION_RULES.height,
    tiles: Array.from({ length: REGION_RULES.width * REGION_RULES.height }, (_, id) => regionTile(seed, id)),
  };
}

/** A suggestion only; no climate or terrain is changed to make a selected site easier. */
export function recommendedRegion(map: RegionMap): RegionTile | null {
  const score = (tile: RegionTile) => Math.abs(tile.temperature - 17) +
    Math.abs(tile.rainfall - 1100) / 100 + (60 - tile.growingDays) / 3 +
    (tile.biome === 'temperate' ? 0 : 30) +
    ({ flat: 0, small: 0, large: 6, mountainous: 12, impassable: Infinity }[tile.hilliness]);
  let best: RegionTile | null = null;
  for (const tile of map.tiles) if (tile.settleable && (!best || score(tile) < score(best))) best = tile;
  return best;
}

export function resolveWorldSite(value: unknown): {
  site: WorldSite; seed: number; settings: WorldSettings; tile: RegionTile; generator: 2 | 3;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的世界选址');
  const site = value as WorldSite;
  if ((site.version !== 1 && site.version !== 2) || Object.keys(site).length !== 3 ||
    !['version', 'worldSeed', 'tileId'].every((key) => Object.hasOwn(site, key)))
    throw new Error('无效的世界选址版本或字段');
  const tile = regionTile(site.worldSeed, site.tileId);
  if (!tile.settleable || !tile.settings) throw new Error(tile.reason ?? '该地区不能建立营地');
  return {
    site: { version: site.version, worldSeed: site.worldSeed, tileId: site.tileId },
    generator: site.version === 1 ? 2 : 3,
    seed: tile.mapSeed,
    settings: { ...tile.settings },
    tile,
  };
}
