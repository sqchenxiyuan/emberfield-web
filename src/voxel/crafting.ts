import type { Counts, Pos } from './types';

// Native 60 TPS work is converted to local 20 TPS with ceiling, as for power
// equipment. Stonecutting research is considered unlocked in this prototype;
// skill speed, experience, multi-recipe bills and hauling radii are not modeled.
export const STONECUTTER_COST: Readonly<Partial<Counts>> = Object.freeze({ wood: 75, steel: 30 });
export const STONECUTTER_WORK = Math.ceil((2000 * 0.7) / 3);
export const STONECUTTING = Object.freeze({ input: 1, output: 20, work: Math.ceil(1600 / 3) });
// Two-high voxel wall = two native wall cells; an elevated load-bearing floor
// maps granite tile cost/work onto our 3D support rule. Existing wood is unchanged.
export const STONE_CONSTRUCTION = Object.freeze({
  wall: { cost: 10, work: Math.ceil((2 * 950) / 3), refund: 4 },
  floor: { cost: 4, work: Math.ceil(1100 / 3), refund: 2 },
});
export const CHUNK_DROP_CHANCE = 0.25;

/** One immutable roll per natural-stone voxel. Failed transactions and loading
 * cannot reroll it; each two-high excavation checks both coordinates separately. */
export function naturalChunkDrop(seed: number, p: Pos): 0 | 1 {
  let a =
    Math.imul(p.x + 374761393, 668265263) ^
    Math.imul(p.y + seed + 4187, 1274126177) ^
    Math.imul(p.z + 1447, 1597334677);
  a = Math.imul(a ^ (a >>> 13), 1274126177);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296 < CHUNK_DROP_CHANCE ? 1 : 0;
}
