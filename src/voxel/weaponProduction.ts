import { type Counts, type Pos, type WeaponBench } from './types';
import { WEAPON_KINDS, WEAPON_DEFS, type WeaponBenchKind } from './weapons';

// Selected native FueledSmithy declarations; construction/research skills remain pre-unlocked.
export const SMITHY_COST: Readonly<Partial<Counts>> = Object.freeze({ steel: 100 });
export const SMITHY_WORK = 1000;
export const SMITHY_FUEL_CAPACITY = 50;
export const SMITHY_REFUEL_AT = 15;
// Preserve native fuel per real second / completed recipe (60 -> 20 TPS).
// Project days are shorter: continuous operation burns 48 wood per project day.
export const SMITHY_FUEL_PER_TICK = (80 / 60000) * 3;
export const WEAPON_BENCH_NAMES = { craftingSpot: '制作点', smithy: '燃料锻造台' } as const;
export const isWeaponBenchKind = (kind: string): kind is WeaponBenchKind =>
  kind === 'craftingSpot' || kind === 'smithy';
export function makeWeaponBench(
  id: number,
  kind: WeaponBenchKind,
  p: Pos,
  axis: 'x' | 'y',
): WeaponBench {
  return {
    id,
    kind,
    x: p.x,
    y: p.y,
    z: p.z,
    axis,
    fuel: 0,
    bills: WEAPON_KINDS.filter((k) => WEAPON_DEFS[k].benches.includes(kind)).map((kind) => ({
      kind,
      target: 0,
      paused: false,
    })),
  };
}
