import { TPS, type Pos } from './types';

export const RANGED_KINDS = ['shortBow', 'revolver', 'machinePistol'] as const;
export type RangedKind = (typeof RANGED_KINDS)[number];
export interface RangedWeapon {
  kind: RangedKind;
  quality: number;
}
export const isRangedKind = (kind: unknown): kind is RangedKind =>
  typeof kind === 'string' && (RANGED_KINDS as readonly string[]).includes(kind);
export const RANGED_ACCURACY_QUALITY = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5] as const;
export const RANGED_DAMAGE_QUALITY = [0.9, 1, 1, 1, 1, 1.25, 1.5] as const;
// Reviewed Core declarations, RimWorld 1.7.4980 rev60. Recipe/identity live in weapons.ts.
export const RANGED_DEFS = {
  shortBow: {
    accuracy: [0.75, 0.65, 0.45, 0.25],
    warmup: 1.35,
    cooldown: 1.65,
    range: 22.9,
    burstCount: 1,
    sourceBurstIntervalTicks: 15,
    damageDef: 'Arrow',
    damage: 11,
    speed: 44,
    stoppingPower: 0.5,
  },
  revolver: {
    accuracy: [0.8, 0.75, 0.55, 0.4],
    warmup: 0.3,
    cooldown: 1.6,
    range: 25.9,
    burstCount: 1,
    sourceBurstIntervalTicks: 15,
    damageDef: 'Bullet',
    damage: 12,
    speed: 55,
    stoppingPower: 1,
  },
  machinePistol: {
    accuracy: [0.9, 0.65, 0.35, 0.15],
    warmup: 0.5,
    cooldown: 0.9,
    range: 19.9,
    burstCount: 3,
    sourceBurstIntervalTicks: 7,
    damageDef: 'Bullet',
    damage: 6,
    speed: 55,
    stoppingPower: 0.5,
  },
} as const;
const finite = (n: number) => typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const axes = ['x', 'y', 'z'] as const;
const point = (p: Pos): Pos => ({ x: p.x, y: p.y, z: p.z });
const distance = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sameCell = (a: Pos, b: Pos) => axes.every((axis) => a[axis] === b[axis]);
const center = (p: Pos): Pos => ({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
function interpolate(x: number, points: readonly (readonly [number, number])[]): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1],
      [x2, y2] = points[i];
    if (x <= x2) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }
  return points.at(-1)![1];
}
function roundToEven(n: number): number {
  const floor = Math.floor(n);
  return n - floor === 0.5 ? floor + (floor % 2) : Math.round(n);
}
export function rangedStats(weapon: RangedWeapon) {
  if (
    !weapon ||
    !isRangedKind(weapon.kind) ||
    !Number.isInteger(weapon.quality) ||
    weapon.quality < 0 ||
    weapon.quality > 6
  )
    throw new RangeError('远程武器或品质无效');
  const def = RANGED_DEFS[weapon.kind],
    quality = RANGED_DAMAGE_QUALITY[weapon.quality];
  return {
    kind: weapon.kind,
    range: def.range,
    accuracy: def.accuracy.map((a) => clamp(a * RANGED_ACCURACY_QUALITY[weapon.quality], 0.01, 1)),
    damageDef: def.damageDef,
    damage: roundToEven(def.damage * quality),
    armorPenetration: def.damage * 0.015 * quality,
    speed: def.speed,
    stoppingPower: def.stoppingPower,
    cellsPerTick: ((def.speed / 100) * 60) / TPS,
    warmupTicks: Math.ceil(def.warmup * TPS),
    cooldownTicks: Math.ceil(def.cooldown * TPS),
    burstCount: def.burstCount,
    sourceBurstIntervalTicks: def.sourceBurstIntervalTicks,
    burstIntervalTicks: Math.ceil((def.sourceBurstIntervalTicks * TPS) / 60),
    // Native Pawn.Tick runs warmup completion before equipment VerbTick, so the
    // first-shot tick already decrements the burst timer: [0, 6, 13], not [0, 7, 14].
    burstOffsetsTicks: Array.from({ length: def.burstCount }, (_, i) =>
      i === 0 ? 0 : Math.ceil(((i * def.sourceBurstIntervalTicks - 1) * TPS) / 60),
    ),
    fullCycleSeconds:
      def.warmup + def.cooldown + ((def.burstCount - 1) * def.sourceBurstIntervalTicks) / 60,
  };
}
/** Native speed/100 cells per native tick, mapped from 60 TPS to project TPS. */
export function projectileFlightTicks(length: number, speed: number): number {
  if (!finite(length) || length < 0 || !finite(speed) || speed <= 0)
    throw new RangeError('弹丸距离或速度无效');
  const ticks = Math.max(1, Math.ceil(length / (((speed / 100) * 60) / TPS)));
  if (!Number.isSafeInteger(ticks)) throw new RangeError('弹丸飞行时间越界');
  return ticks;
}
export function shootingAccuracyPerCell(level: number, sight = 1, manipulation = 1): number {
  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level > 20 ||
    !finite(sight) ||
    sight < 0 ||
    !finite(manipulation) ||
    manipulation < 0
  )
    throw new RangeError('射击技能或身体能力无效');
  const value = level + 12 * (Math.min(sight, 2) - 1) + 8 * (Math.min(manipulation, 1) - 1);
  return interpolate(value, [
    [-20, 0.7],
    [-10, 0.8],
    [-6, 0.83],
    [-4, 0.85],
    [-2, 0.87],
    [0, 0.89],
    [2, 0.93],
    [4, 0.94],
    [6, 0.95],
    [8, 0.96],
    [10, 0.97],
    [12, 0.975],
    [14, 0.98],
    [16, 0.98333],
    [18, 0.98666],
    [20, 0.99],
    [22, 0.9925],
    [26, 0.995],
    [30, 0.9965],
    [40, 0.998],
    [60, 0.999],
  ]);
}
export function weaponAccuracyAtDistance(weapon: RangedWeapon, length: number): number {
  if (!finite(length) || length < 0) throw new RangeError('射击距离无效');
  const values = rangedStats(weapon).accuracy;
  return clamp(
    interpolate(length, [
      [3, values[0]],
      [12, values[1]],
      [25, values[2]],
      [40, values[3]],
    ]),
    0.01,
    1,
  );
}

export interface RayBounds {
  width: number;
  depth: number;
  height: number;
}
export interface VoxelRayCell {
  cell: Pos;
  tEnter: number;
  tExit: number;
}
function validBounds(bounds: RayBounds): boolean {
  return (
    !!bounds &&
    [bounds.width, bounds.depth, bounds.height].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 512,
    )
  );
}
function validPoint(p: Pos, bounds: RayBounds, cell = false): boolean {
  return (
    !!p &&
    axes.every(
      (axis, i) =>
        finite(p[axis]) &&
        p[axis] >= 0 &&
        (cell
          ? Number.isInteger(p[axis]) && p[axis] < [bounds.width, bounds.depth, bounds.height][i]
          : p[axis] <= [bounds.width, bounds.depth, bounds.height][i]),
    )
  );
}
/**
 * Project 3D extension: closed-cube supercover, x/y horizontal and z vertical.
 * Continuous endpoints may touch the outer map boundary. Returned cells are in
 * bounds, sorted by segment t, including zero-length edge/corner contacts. Rays
 * lying on a voxel face include both sides. No point sampling or thin Bresenham.
 */
export function traceVoxelRay(from: Pos, to: Pos, bounds: RayBounds): VoxelRayCell[] {
  if (!validBounds(bounds) || !validPoint(from, bounds) || !validPoint(to, bounds))
    throw new RangeError('射线坐标或地图范围无效');
  const delta = axes.map((axis) => to[axis] - from[axis]);
  const start = axes.map((axis) => from[axis]);
  const limits = [bounds.width, bounds.depth, bounds.height];
  const step = delta.map(Math.sign);
  const current = start.map((n, i) => Math.floor(n) - (Number.isInteger(n) && step[i] < 0 ? 1 : 0));
  const stationaryPlanes = [0, 1, 2].filter((i) => delta[i] === 0 && Number.isInteger(start[i]));
  const found = new Map<string, VoxelRayCell>();
  const add = (coords: number[]) => {
    if (coords.some((n, i) => n < 0 || n >= limits[i])) return;
    const key = coords.join(',');
    if (found.has(key)) return;
    let enter = 0,
      leave = delta.every((n) => n === 0) ? 0 : 1;
    for (let i = 0; i < 3; i++) {
      if (delta[i] === 0) {
        if (start[i] < coords[i] || start[i] > coords[i] + 1) return;
      } else {
        const a = (coords[i] - start[i]) / delta[i],
          b = (coords[i] + 1 - start[i]) / delta[i];
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter > leave + 1e-12 || leave < 0 || enter > 1) return;
    found.set(key, {
      cell: { x: coords[0], y: coords[1], z: coords[2] },
      tEnter: clamp(enter),
      tExit: clamp(Math.max(enter, leave)),
    });
  };
  const addWithPlanes = (coords: number[]) => {
    for (let mask = 0; mask < 1 << stationaryPlanes.length; mask++) {
      const copy = [...coords];
      stationaryPlanes.forEach((axis, bit) => {
        if (mask & (1 << bit)) copy[axis]--;
      });
      add(copy);
    }
  };
  const addPointContacts = (p: Pos) => {
    const base = axes.map((axis) => Math.floor(p[axis]));
    const planes = [0, 1, 2].filter((i) => Number.isInteger(p[axes[i]]));
    for (let mask = 0; mask < 1 << planes.length; mask++) {
      const copy = [...base];
      planes.forEach((axis, bit) => {
        if (mask & (1 << bit)) copy[axis]--;
      });
      add(copy);
    }
  };
  addPointContacts(from);
  addWithPlanes(current);
  // At most one crossing for each coordinate plane, plus the final endpoint.
  for (let iteration = 0; iteration <= limits.reduce((a, b) => a + b, 0) + 3; iteration++) {
    const crossing = delta.map((d, i) =>
      d === 0 ? Infinity : (current[i] + (step[i] > 0 ? 1 : 0) - start[i]) / d,
    );
    const next = Math.min(...crossing);
    if (!Number.isFinite(next) || next > 1 + 1e-12) break;
    const tied = [0, 1, 2].filter((i) => Math.abs(crossing[i] - next) <= 1e-12);
    for (let mask = 1; mask < 1 << tied.length; mask++) {
      const copy = [...current];
      tied.forEach((axis, bit) => {
        if (mask & (1 << bit)) copy[axis] += step[axis];
      });
      addWithPlanes(copy);
    }
    tied.forEach((axis) => {
      current[axis] += step[axis];
    });
    if (next >= 1) break;
  }
  addPointContacts(to);
  return [...found.values()].sort(
    (a, b) =>
      a.tEnter - b.tEnter ||
      a.tExit - b.tExit ||
      a.cell.x - b.cell.x ||
      a.cell.y - b.cell.y ||
      a.cell.z - b.cell.z,
  );
}

export interface RangedCover {
  id: number;
  position: Pos;
  fillPercent: number;
  height: number;
  full?: boolean;
  open?: boolean;
}
export interface CoverReport extends RangedCover {
  angle: number;
  angleFactor: number;
  nearFactor: number;
  rayHeight: number;
  heightEligible: boolean;
  blockChance: number;
}
export interface RangedShotInput {
  weapon: RangedWeapon;
  shooter: Pos;
  target: Pos;
  shootingLevel: number;
  sight?: number;
  manipulation?: number;
  weatherAccuracy?: number;
  shooterRoofed?: boolean;
  targetRoofed?: boolean;
  targetSize?: number;
  targetProne?: boolean;
  canBenefitFromCover?: boolean;
  canHitOthers?: boolean;
  allowAdjacentShot?: boolean;
  covers?: readonly RangedCover[];
  bounds: RayBounds;
  blocked: (cell: Pos) => boolean;
}
export interface RangedShotReport {
  weapon: RangedWeapon;
  stats: ReturnType<typeof rangedStats>;
  shooter: Pos;
  target: Pos;
  origin: Pos;
  targetPoint: Pos;
  bounds: RayBounds;
  distance: number;
  minRange: number;
  inRange: boolean;
  clearLine: boolean;
  canShoot: boolean;
  firstBlocker: Pos | null;
  ray: VoxelRayCell[];
  shooterAccuracyPerCell: number;
  shooterFactor: number;
  weaponFactor: number;
  weatherFactor: number;
  targetSizeFactor: number;
  executionFactor: number;
  postureFactor: number;
  aimStandard: number;
  aimIgnoringPosture: number;
  passCover: number;
  estimatedHitChance: number;
  canBenefitFromCover: boolean;
  canHitOthers: boolean;
  covers: CoverReport[];
}
/** Source horizontal adjacent-cover formula; cross-floor height rejection is a project extension. */
function coverReports(input: RangedShotInput, origin: Pos, targetPoint: Pos): CoverReport[] {
  const dx = input.shooter.x - input.target.x,
    dy = input.shooter.y - input.target.y;
  const horizontalLength = Math.hypot(dx, dy);
  const candidates: CoverReport[] = [];
  for (const cover of input.covers ?? []) {
    const cx = cover.position.x - input.target.x,
      cy = cover.position.y - input.target.y;
    if (
      cover.position.z !== input.target.z ||
      Math.max(Math.abs(cx), Math.abs(cy)) !== 1 ||
      horizontalLength === 0
    )
      continue;
    let angle =
      (Math.acos(clamp((dx * cx + dy * cy) / (horizontalLength * Math.hypot(cx, cy)), -1, 1)) *
        180) /
      Math.PI;
    if (Math.abs(cx) + Math.abs(cy) !== 1) angle *= 1.75;
    const angleFactor =
      angle < 15
        ? 1
        : angle < 27
          ? 0.8
          : angle < 40
            ? 0.6
            : angle < 52
              ? 0.4
              : angle < 65
                ? 0.2
                : 0;
    const toShooter = Math.hypot(
      input.shooter.x - cover.position.x,
      input.shooter.y - cover.position.y,
    );
    const nearFactor = toShooter < 1.9 ? 0.3333 : toShooter < 2.9 ? 0.66666 : 1;
    const projection = clamp(
      ((cover.position.x + 0.5 - origin.x) * (targetPoint.x - origin.x) +
        (cover.position.y + 0.5 - origin.y) * (targetPoint.y - origin.y)) /
        (horizontalLength * horizontalLength),
    );
    const rayHeight = origin.z + (targetPoint.z - origin.z) * projection;
    const heightEligible =
      input.shooter.z === input.target.z ||
      (rayHeight >= cover.position.z && rayHeight <= cover.position.z + cover.height);
    candidates.push({
      ...cover,
      position: point(cover.position),
      angle,
      angleFactor,
      nearFactor,
      rayHeight,
      heightEligible,
      blockChance:
        cover.open || !heightEligible
          ? 0
          : (cover.full ? 0.75 : cover.fillPercent) * angleFactor * nearFactor,
    });
  }
  return candidates;
}
export function rangedShotReport(input: RangedShotInput): RangedShotReport {
  if (
    !input ||
    !validBounds(input.bounds) ||
    !validPoint(input.shooter, input.bounds, true) ||
    !validPoint(input.target, input.bounds, true) ||
    typeof input.blocked !== 'function'
  )
    throw new RangeError('射击场景无效');
  const stats = rangedStats(input.weapon),
    weather = input.weatherAccuracy ?? 1,
    size = input.targetSize ?? 1;
  if (
    !finite(weather) ||
    weather < 0 ||
    weather > 1 ||
    !finite(size) ||
    size < 0 ||
    [
      'shooterRoofed',
      'targetRoofed',
      'targetProne',
      'canBenefitFromCover',
      'canHitOthers',
      'allowAdjacentShot',
    ].some(
      (key) =>
        input[key as keyof RangedShotInput] !== undefined &&
        typeof input[key as keyof RangedShotInput] !== 'boolean',
    ) ||
    (input.covers !== undefined && !Array.isArray(input.covers))
  )
    throw new RangeError('射击因子无效');
  const covers = input.covers ?? [];
  if (
    new Set(covers.map((cover) => cover?.id)).size !== covers.length ||
    covers.length > 128 ||
    covers.some(
      (cover) =>
        !cover ||
        !Number.isSafeInteger(cover.id) ||
        cover.id <= 0 ||
        !validPoint(cover.position, input.bounds, true) ||
        !finite(cover.fillPercent) ||
        cover.fillPercent < 0 ||
        cover.fillPercent > 1 ||
        !finite(cover.height) ||
        cover.height <= 0 ||
        cover.height > input.bounds.height ||
        (cover.full !== undefined && typeof cover.full !== 'boolean') ||
        (cover.open !== undefined && typeof cover.open !== 'boolean'),
    )
  )
    throw new RangeError('掩体数据无效');
  const origin = center(input.shooter),
    targetPoint = center(input.target),
    length = distance(origin, targetPoint);
  const perCell = shootingAccuracyPerCell(input.shootingLevel, input.sight, input.manipulation);
  const shooterFactor = Math.max(0.0201, perCell ** length);
  const weaponFactor = weaponAccuracyAtDistance(input.weapon, length);
  const weatherFactor = input.shooterRoofed && input.targetRoofed ? 1 : weather;
  const executionFactor = input.targetProne && length <= 3.9 ? 7.5 : 1;
  const postureFactor = projectilePostureChance(length, input.targetProne ?? false);
  const aimStandard = Math.max(
    0.0201,
    shooterFactor * weaponFactor * weatherFactor * executionFactor,
  );
  const targetSizeFactor = clamp(size, 0.5, 2),
    aimIgnoringPosture = aimStandard * targetSizeFactor;
  const cover = coverReports(input, origin, targetPoint),
    canBenefitFromCover = input.canBenefitFromCover ?? true;
  // Native giver selection retains shooter-cell cover; only the combined pass
  // chance excludes that cell (CalculateCoverGiverSet vs CalculateOverallBlockChance).
  const passCover = canBenefitFromCover
    ? cover.reduce(
        (pass, c) => (sameCell(c.position, input.shooter) ? pass : pass * (1 - c.blockChance)),
        1,
      )
    : 1;
  const ray = traceVoxelRay(origin, targetPoint, input.bounds);
  let firstBlocker: Pos | null = null;
  for (const entry of ray) {
    if (sameCell(entry.cell, input.shooter)) continue;
    const blocked = input.blocked(point(entry.cell));
    if (typeof blocked !== 'boolean') throw new RangeError('遮挡查询结果无效');
    if (blocked) {
      firstBlocker = point(entry.cell);
      break;
    }
  }
  const minRange = input.allowAdjacentShot ? 0 : 1.421;
  const inRange = length > 0 && length >= minRange && length <= stats.range;
  return {
    weapon: { ...input.weapon },
    stats,
    shooter: point(input.shooter),
    target: point(input.target),
    origin,
    targetPoint,
    bounds: { ...input.bounds },
    distance: length,
    minRange,
    inRange,
    clearLine: firstBlocker === null,
    canShoot: inRange && firstBlocker === null,
    firstBlocker,
    ray,
    shooterAccuracyPerCell: perCell,
    shooterFactor,
    weaponFactor,
    weatherFactor,
    targetSizeFactor,
    executionFactor,
    postureFactor,
    aimStandard,
    aimIgnoringPosture,
    passCover,
    estimatedHitChance: clamp(aimIgnoringPosture * postureFactor * passCover),
    canBenefitFromCover,
    canHitOthers: input.canHitOthers ?? true,
    covers: cover,
  };
}

export interface RangedLaunch {
  outcome: 'target' | 'wild' | 'cover' | 'blocked' | 'outOfRange';
  destination: Pos;
  canHitIntended: boolean;
  canHitOthers: boolean;
  canHitWorld: boolean;
  coverId: number | null;
  launchDistance: number;
  /** Preview only. World must recalculate from current target posture at impact. */
  postureImpactChance: number;
  rolls: { stage: string; value: number }[];
}
/** Native SimpleSurface columns, sampled on the caller's reproducible [0,1) stream. */
export function wildMissRadius(aimStandard: number, roll: number): number {
  if (!finite(aimStandard) || aimStandard < 0 || !finite(roll) || roll < 0 || roll >= 1)
    throw new RangeError('偏射输入无效');
  const maximum = interpolate(aimStandard, [
    [0.02, 10],
    [0.04, 8],
    [0.07, 6],
    [0.11, 4],
    [0.22, 2],
    [1, 1],
  ]);
  return 1 + (maximum - 1) * roll;
}
/**
 * Launch decision only; no damage or impact-posture roll occurs here. Source
 * flags do not let a target-directed shot hit ordinary partial world cover.
 * World must still stop every projectile at solid 3D walls/floors (adaptation).
 * Wild offsets use the native horizontal radius curve and cell quantization;
 * map-edge clamping and a 128-attempt bound are explicit project safeguards.
 */
export function resolveRangedLaunch(report: RangedShotReport, random: () => number): RangedLaunch {
  if (
    !report ||
    typeof random !== 'function' ||
    !validBounds(report.bounds) ||
    !validPoint(report.origin, report.bounds) ||
    !validPoint(report.targetPoint, report.bounds) ||
    !finite(report.aimIgnoringPosture) ||
    report.aimIgnoringPosture < 0 ||
    !finite(report.aimStandard) ||
    report.aimStandard < 0 ||
    !finite(report.passCover) ||
    report.passCover < 0 ||
    report.passCover > 1 ||
    !finite(report.postureFactor) ||
    report.postureFactor < 0 ||
    report.postureFactor > 1 ||
    ['inRange', 'clearLine', 'canBenefitFromCover', 'canHitOthers'].some(
      (key) => typeof report[key as keyof RangedShotReport] !== 'boolean',
    ) ||
    !finite(report.distance) ||
    report.distance < 0 ||
    !Array.isArray(report.covers) ||
    report.covers.length > 128 ||
    new Set(report.covers.map((c) => c?.id)).size !== report.covers.length ||
    report.covers.some(
      (c) =>
        !c ||
        !Number.isSafeInteger(c.id) ||
        c.id <= 0 ||
        !finite(c.blockChance) ||
        c.blockChance < 0 ||
        c.blockChance > 1 ||
        !validPoint(c.position, report.bounds, true),
    )
  )
    throw new RangeError('发射报告无效');
  const result: RangedLaunch = {
    outcome: !report.inRange ? 'outOfRange' : !report.clearLine ? 'blocked' : 'target',
    destination: point(report.targetPoint),
    canHitIntended: false,
    canHitOthers: false,
    canHitWorld: false,
    coverId: null,
    launchDistance: report.distance,
    postureImpactChance: report.postureFactor,
    rolls: [],
  };
  if (!report.inRange || !report.clearLine) return result;
  const roll = (stage: string) => {
    const value = random();
    if (!finite(value) || value < 0 || value >= 1) throw new RangeError('发射随机值无效');
    result.rolls.push({ stage, value });
    return value;
  };
  const chance = (value: number, stage: string) => value >= 1 || (value > 0 && roll(stage) < value);
  const candidates = report.canBenefitFromCover
    ? report.covers.filter((c) => c.blockChance > 0)
    : [];
  let chosen: CoverReport | null = null;
  if (candidates.length) {
    let value = roll('coverSelection') * candidates.reduce((sum, c) => sum + c.blockChance, 0);
    chosen = candidates.at(-1)!;
    for (const candidate of candidates) {
      value -= candidate.blockChance;
      if (value < 0) {
        chosen = candidate;
        break;
      }
    }
  }
  result.coverId = chosen?.id ?? null;
  if (!chance(report.aimIgnoringPosture, 'aim')) {
    result.outcome = 'wild';
    const radius = wildMissRadius(report.aimStandard, roll('wildRadius'));
    let accepted = false;
    for (let attempt = 0; attempt < 128; attempt++) {
      const angle = roll('wildAngle') * Math.PI * 2;
      const dest = {
        x: clamp(
          Math.floor(report.targetPoint.x + Math.cos(angle) * radius) + 0.5,
          0.5,
          report.bounds.width - 0.5,
        ),
        y: clamp(
          Math.floor(report.targetPoint.y + Math.sin(angle) * radius) + 0.5,
          0.5,
          report.bounds.depth - 0.5,
        ),
        z: report.targetPoint.z,
      };
      const forward = axes.reduce(
        (sum, axis) =>
          sum +
          (report.targetPoint[axis] - report.origin[axis]) * (dest[axis] - report.origin[axis]),
        0,
      );
      if (forward >= 0) {
        result.destination = dest;
        accepted = true;
        break;
      }
    }
    if (!accepted) throw new RangeError('偏射随机源不能产生前向落点');
    result.canHitOthers = chance(0.5, 'wildHitOthers') && report.canHitOthers;
    result.canHitWorld = true;
  } else if (report.canBenefitFromCover && !chance(report.passCover, 'cover')) {
    if (!chosen) throw new RangeError('掩体概率缺少对应掩体');
    result.outcome = 'cover';
    result.destination = center(chosen.position);
    result.canHitOthers = report.canHitOthers;
    result.canHitWorld = true;
  } else {
    result.canHitIntended = true;
    result.canHitOthers = report.canHitOthers;
  }
  result.launchDistance = distance(report.origin, result.destination);
  return result;
}
export function projectilePostureChance(length: number, prone: boolean): number {
  if (!finite(length) || length < 0 || typeof prone !== 'boolean')
    throw new RangeError('落点姿态输入无效');
  return prone && length >= 4.5 ? 0.5 : 1;
}
/** All free-interception checks use this distance gate, not just friendly pawns.
 * 3D distance replaces the native horizontal metric in this voxel extension. */
export function interceptDistanceFactor(origin: Pos, cell: Pos): number {
  if (!origin || !cell || axes.some((a) => !finite(origin[a]) || !finite(cell[a])))
    throw new RangeError('拦截坐标无效');
  const squared = distance(origin, center(cell)) ** 2;
  return clamp((squared - 25) / (144 - 25));
}
export function pawnInterceptChance(input: {
  origin: Pos;
  cell: Pos;
  bodySize?: number;
  prone?: boolean;
  friendly?: boolean;
  preventFriendlyFire?: boolean;
  friendlyFireFactor?: number;
}): number {
  const size = input.bodySize ?? 1,
    friendlyFactor = input.friendlyFireFactor ?? 1;
  if (
    !finite(size) ||
    size < 0 ||
    !finite(friendlyFactor) ||
    friendlyFactor < 0 ||
    ['prone', 'friendly', 'preventFriendlyFire'].some(
      (key) =>
        input[key as keyof typeof input] !== undefined &&
        typeof input[key as keyof typeof input] !== 'boolean',
    )
  )
    throw new RangeError('人物拦截输入无效');
  const factor = interceptDistanceFactor(input.origin, input.cell);
  if (input.friendly && input.preventFriendlyFire) return 0;
  return clamp(
    0.4 *
      clamp(size, 0.1, 2) *
      (input.prone ? 0.1 : 1) *
      factor *
      (input.friendly ? friendlyFactor : 1),
  );
}
