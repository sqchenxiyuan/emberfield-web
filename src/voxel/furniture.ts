import { QUALITY_NAMES } from './apparel';
import { FIRE_MAX_HP } from './fire';
import { LIVING_BUILDINGS, LIVING_RULES } from './living';
import type { ApparelQuality } from './types';

export type FurnitureKind = 'bed' | 'table' | 'chair';
export interface FurnitureStats {
  qualityName: string; maxHitPoints: number; beauty: number;
  /** Rated comfort in percentage units; legendary furniture can exceed 100.
   * The actual comfort need remains capped at 100 by its consumer. */
  comfort: number | null;
  /** Multiplier for actual bed rest gain; not a new rest reservoir. */
  restEffectiveness: number | null;
}

/** Selected native quality parts from Core 1.7.4980. MaxHitPoints has no quality
 * part, and HorseshoesPin has no CompQuality. Physical base values, material
 * scope and construction costs remain the established Web furniture tier. */
export const FURNITURE_QUALITY = Object.freeze({
  comfort: Object.freeze([.76, .88, 1, 1.12, 1.24, 1.45, 1.7]),
  restEffectiveness: Object.freeze([.86, .92, 1, 1.08, 1.14, 1.25, 1.6]),
  beauty: Object.freeze([-.1, .5, 1, 2, 3, 5, 8]),
});
export function isFurnitureKind(value: unknown): value is FurnitureKind {
  return value === 'bed' || value === 'table' || value === 'chair';
}
export function isFurnitureQuality(value: unknown): value is ApparelQuality {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}
function roundEven(value: number): number {
  const floor = Math.floor(value), fraction = value - floor;
  const result = fraction === .5 ? (floor % 2 ? floor + 1 : floor) : Math.round(value);
  return result === 0 ? 0 : result;
}
export function furnitureStats(kind: FurnitureKind, quality: ApparelQuality): FurnitureStats {
  if (!isFurnitureKind(kind) || !isFurnitureQuality(quality)) throw new RangeError('家具类型或品质无效');
  const beauty = kind === 'bed' ? 1 : LIVING_BUILDINGS[kind].beauty;
  const comfort = kind === 'bed' ? LIVING_RULES.bedComfort : kind === 'chair' ? LIVING_RULES.chairComfort : null;
  return { qualityName: QUALITY_NAMES[quality], maxHitPoints: FIRE_MAX_HP[kind],
    beauty: roundEven(beauty > 0 ? beauty * FURNITURE_QUALITY.beauty[quality] : beauty),
    comfort: comfort === null ? null : comfort * FURNITURE_QUALITY.comfort[quality],
    restEffectiveness: kind === 'bed' ? FURNITURE_QUALITY.restEffectiveness[quality] : null };
}
