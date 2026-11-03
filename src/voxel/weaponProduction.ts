import { type Counts, type Pos, type WeaponBench } from './types';
import { WEAPON_KINDS, WEAPON_DEFS, type WeaponBenchKind } from './weapons';
import { ARMOR_KINDS } from './apparel';

// Selected native FueledSmithy declarations; world checks research and construction skill.
export const SMITHY_COST: Readonly<Partial<Counts>> = Object.freeze({ steel: 100 });
export const SMITHY_WORK = 1000;
export const MACHINING_COST = { steel: 150, components: 5 } as const;
export const MACHINING_WORK = 1000;
export const MACHINING_POWER = 350;
export const SANDBAG_COST = { cloth: 5 } as const;
export const SANDBAG_WORK = 60;
export const SANDBAG_HP = 300;
/** Native worktable factors. This release has no room-role scoring; callers
 * conservatively treat enclosed rooms as non-Workshop unless independently known. */
export function machiningWorkFactor(outdoor: boolean, temperature: number, workshop = false) {
  if (!Number.isFinite(temperature)) throw new RangeError('加工台温度无效');
  return (outdoor || !workshop ? 0.8 : 1) * (temperature < 9 || temperature > 35 ? 0.7 : 1);
}
export const SMITHY_FUEL_CAPACITY = 50;
export const SMITHY_REFUEL_AT = 15;
// Preserve native fuel per real second / completed recipe (60 -> 20 TPS).
// Project days are shorter: continuous operation burns 48 wood per project day.
export const SMITHY_FUEL_PER_TICK = (80 / 60000) * 3;
export const WEAPON_BENCH_NAMES = {
  craftingSpot: '制作点',
  smithy: '燃料锻造台',
  machining: '机械加工台',
} as const;
export const isWeaponBenchKind = (kind: string): kind is WeaponBenchKind =>
  kind === 'craftingSpot' || kind === 'smithy' || kind === 'machining';
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
    ...(kind === 'machining'
      ? {
          power: {
            id,
            x: p.x,
            y: p.y,
            z: p.z,
            kind: 'workbench' as const,
            consumption: MACHINING_POWER,
            on: true,
            powered: false,
            active: false,
            networkId: null,
            watts: -MACHINING_POWER,
            reason: '等待供电',
          },
        }
      : {}),
    bills: WEAPON_KINDS.filter((k) => WEAPON_DEFS[k].benches.includes(kind)).map((kind) => ({
      kind,
      target: 0,
      paused: false,
    })),
    armorBills: (kind === 'smithy' ? ARMOR_KINDS : []).map((kind) => ({
      kind,
      target: 0,
      paused: false,
    })),
  };
}
