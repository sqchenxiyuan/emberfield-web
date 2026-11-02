import { DAY, type Tree, type TreeSpecies, type WorldSettings } from './types';
import { lightGrowth } from './farming';

export const TREE_NAMES: Record<TreeSpecies, string> = {
  poplar: '白杨',
  pine: '松树',
  saguaro: '巨柱仙人掌',
};
export const TREE_DATA: Record<
  TreeSpecies,
  {
    wood: number;
    minFertility: number;
    days: number;
    fertilitySensitivity: number;
    minGrowth: number;
    harvestWork: number;
    sowWork: number;
    lifespanDays: number;
    maxHitPoints: number;
    maxTemperature: number;
  }
> = {
  poplar: {
    wood: 27,
    minFertility: 0.7,
    days: 15.05,
    fertilitySensitivity: 0.5,
    minGrowth: 0.4,
    harvestWork: 800,
    sowWork: 4000,
    lifespanDays: 135.45,
    maxHitPoints: 200,
    maxTemperature: 58,
  },
  pine: {
    wood: 27,
    minFertility: 0.7,
    days: 20,
    fertilitySensitivity: 0.5,
    minGrowth: 0.4,
    harvestWork: 710,
    sowWork: 4000,
    lifespanDays: 180,
    maxHitPoints: 200,
    maxTemperature: 58,
  },
  saguaro: {
    wood: 15,
    minFertility: 0.05,
    days: 5,
    fertilitySensitivity: 0,
    minGrowth: 0.2,
    harvestWork: 210,
    sowWork: 4000,
    lifespanDays: 200,
    maxHitPoints: 130,
    maxTemperature: 75,
  },
};
export const PLANTED_GROWTH = 0.0001,
  NATURAL_GROWTH = 0.15;
export const TREE_SHADE_GRACE = 7.5 * DAY;
export const ECOLOGY_INTERVAL = 200,
  ECOLOGY_SAMPLES = 16,
  NATURAL_TREE_CAP = 768;
export const treeSowWork = (species: TreeSpecies) => Math.ceil(TREE_DATA[species].sowWork / 3);
export const treeCutWork = (species: TreeSpecies) => Math.ceil(TREE_DATA[species].harvestWork / 3);
export const treeWorkSpeed = (growth: number) => 3.3 - 2.3 * growth;
export function plantRandom(seed: number, x: number, y: number, salt = 0): number {
  let a =
    Math.imul((seed | 0) ^ Math.floor(seed / 4294967296), 374761393) ^
    Math.imul(x + 117, 668265263) ^
    Math.imul(y + 881, 1274126177) ^
    Math.imul(salt + 1447, 1597334677);
  a = Math.imul(a ^ (a >>> 13), 1274126177);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
}
export function treeYield(
  tree: Pick<Tree, 'x' | 'y' | 'z' | 'species' | 'growth' | 'health' | 'wood'>,
  seed: number,
): number {
  const min = TREE_DATA[tree.species].minGrowth;
  if (tree.growth <= min || tree.health <= 0) return 0;
  const growth = Math.max(0, Math.min(1, (tree.growth - min) / (1 - min)));
  const amount = tree.wood * (0.5 + 0.5 * growth) * (0.5 + 0.5 * tree.health);
  const whole = Math.floor(amount);
  // Stable coordinate rounding is our deterministic substitute for Rand.RoundRandom.
  return whole + (plantRandom(seed, tree.x, tree.y, tree.z + 7103) < amount - whole ? 1 : 0);
}
export function treeTemperatureGrowth(species: TreeSpecies, temperature: number): number {
  const max = TREE_DATA[species].maxTemperature;
  if (temperature <= 0 || temperature >= max) return 0;
  return temperature < 6
    ? temperature / 6
    : temperature <= 42
      ? 1
      : (max - temperature) / (max - 42);
}
export function treeGrowth(
  species: TreeSpecies,
  fertility: number,
  light: number,
  temperature: number,
  hour: number,
): number {
  const data = TREE_DATA[species];
  if (fertility < data.minFertility || hour < 6 || hour > 19.2) return 0;
  return (
    (Math.max(0, 1 + (fertility - 1) * data.fertilitySensitivity) *
      lightGrowth(light) *
      treeTemperatureGrowth(species, temperature)) /
    (data.days * DAY)
  );
}
export const treeCover = (settings: WorldSettings): number => {
  const base = settings.biome === 'desert' ? 0.014 : settings.biome === 'boreal' ? 0.085 : 0.065;
  const moisture =
    settings.biome === 'desert'
      ? 0.6 + Math.min(0.9, settings.rainfall / 500)
      : Math.min(1.4, 0.15 + settings.rainfall / 1100);
  return base * moisture;
};
export const naturalSpecies = (settings: WorldSettings): TreeSpecies =>
  settings.biome === 'desert' ? 'saguaro' : settings.biome === 'boreal' ? 'pine' : 'poplar';
/** Age/shade days match the 60k-tick source calendar. Damage is continuous here,
 * instead of the source's 2000-tick rounded damage batches. Reasons do not add. */
export function treeDamage(tree: Pick<Tree, 'species' | 'age' | 'unlitTicks'>): number {
  const data = TREE_DATA[tree.species];
  return tree.age > data.lifespanDays * DAY || tree.unlitTicks > TREE_SHADE_GRACE
    ? (0.005 * (60000 / DAY)) / data.maxHitPoints
    : 0;
}
