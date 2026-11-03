import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  RANGED_KINDS,
  RANGED_DEFS,
  RANGED_ACCURACY_QUALITY,
  RANGED_DAMAGE_QUALITY,
  rangedStats,
  shootingAccuracyPerCell,
  weaponAccuracyAtDistance,
  projectileFlightTicks,
  traceVoxelRay,
  rangedShotReport,
  resolveRangedLaunch,
  wildMissRadius,
  projectilePostureChance,
  interceptDistanceFactor,
  pawnInterceptChance,
  type RangedShotInput,
  type RangedCover,
  type RayBounds,
} from '../src/voxel/ranged';
import type { Pos } from '../src/voxel/types';

const bounds: RayBounds = { width: 64, depth: 64, height: 32 };
const p = (x: number, y: number, z = 1): Pos => ({ x, y, z });
const rolls = (...values: number[]) => {
  let i = 0;
  return vi.fn(() => values[i++] ?? 0.99);
};
const report = (changes: Partial<RangedShotInput> = {}) =>
  rangedShotReport({
    weapon: { kind: 'revolver', quality: 2 },
    shooter: p(0, 10),
    target: p(10, 10),
    shootingLevel: 10,
    bounds,
    blocked: () => false,
    ...changes,
  });
const cover = (
  id: number,
  x: number,
  y: number,
  changes: Partial<RangedCover> = {},
): RangedCover => ({
  id,
  position: p(x, y),
  fillPercent: 0.5,
  height: 1,
  ...changes,
});
const keys = (from: Pos, to: Pos, box = bounds) =>
  traceVoxelRay(from, to, box).map((r) => `${r.cell.x}/${r.cell.y}/${r.cell.z}`);

describe('source ranged weapon, pawn and projectile arithmetic', () => {
  it('matches independently extracted Core declarations and projectile defaults', () => {
    const evidence = JSON.parse(
      readFileSync('docs/research/rimworld/evidence/ranged-data.json', 'utf8'),
    );
    expect(RANGED_ACCURACY_QUALITY).toEqual(evidence.accuracyQuality);
    expect(RANGED_DAMAGE_QUALITY).toEqual(evidence.damageQuality);
    expect(RANGED_DAMAGE_QUALITY).toEqual(evidence.penetrationQuality);
    const nativeNames = {
      shortBow: 'Bow_Short',
      revolver: 'Gun_Revolver',
      machinePistol: 'Gun_MachinePistol',
    };
    for (const kind of RANGED_KINDS) {
      const native = evidence.weapons.find((w: { id: string }) => w.id === nativeNames[kind]);
      const projectile = evidence.projectiles.find(
        (p: { id: string }) => p.id === native.projectile,
      );
      expect(RANGED_DEFS[kind]).toMatchObject({
        accuracy: native.accuracy,
        warmup: native.warmup,
        cooldown: native.cooldown,
        range: native.range,
        burstCount: native.burst,
        sourceBurstIntervalTicks: native.burstInterval,
        damageDef: projectile.damageDef,
        damage: projectile.damage,
        speed: projectile.speed,
        stoppingPower: projectile.stoppingPower,
      });
      expect(rangedStats({ kind, quality: 2 }).cellsPerTick).toBeCloseTo(
        projectile.speedTilesPerTick * 3,
      );
    }
  });
  it('keeps real single-shot weapons distinct from MachinePistol burst and maps native timing to 20 TPS', () => {
    expect(RANGED_KINDS).toEqual(['shortBow', 'revolver', 'machinePistol']);
    expect(rangedStats({ kind: 'shortBow', quality: 2 })).toMatchObject({
      range: 22.9,
      damageDef: 'Arrow',
      damage: 11,
      speed: 44,
      warmupTicks: 27,
      cooldownTicks: 33,
      burstCount: 1,
      fullCycleSeconds: 3,
    });
    expect(rangedStats({ kind: 'shortBow', quality: 2 }).armorPenetration).toBeCloseTo(0.165);
    expect(rangedStats({ kind: 'revolver', quality: 2 })).toMatchObject({
      range: 25.9,
      damageDef: 'Bullet',
      damage: 12,
      armorPenetration: 0.18,
      speed: 55,
      warmupTicks: 6,
      cooldownTicks: 32,
      burstCount: 1,
    });
    const machine = rangedStats({ kind: 'machinePistol', quality: 2 });
    expect(machine).toMatchObject({
      damage: 6,
      armorPenetration: 0.09,
      range: 19.9,
      warmupTicks: 10,
      cooldownTicks: 18,
      burstCount: 3,
      sourceBurstIntervalTicks: 7,
      burstIntervalTicks: 3,
      burstOffsetsTicks: [0, 2, 5],
    });
    expect(machine.fullCycleSeconds).toBeCloseTo(49 / 30);
  });
  it('rounds projectile damage to even while penetration scales independently before damage rounding', () => {
    expect(rangedStats({ kind: 'shortBow', quality: 6 }).damage).toBe(16); // 16.5 -> even 16.
    expect(rangedStats({ kind: 'shortBow', quality: 6 }).armorPenetration).toBeCloseTo(0.2475);
    expect(rangedStats({ kind: 'machinePistol', quality: 5 }).damage).toBe(8); // 7.5 -> even 8.
    expect(rangedStats({ kind: 'machinePistol', quality: 5 }).armorPenetration).toBeCloseTo(0.1125);
    expect(rangedStats({ kind: 'shortBow', quality: 0 }).damage).toBe(10);
    for (const kind of RANGED_KINDS)
      for (const quality of [-1, 7, 1.5, Infinity, NaN])
        expect(() => rangedStats({ kind, quality })).toThrow();
  });
  it('clamps each quality-adjusted range stat before interpolating the 3/12/25/40 cell anchors', () => {
    const ordinary = { kind: 'revolver' as const, quality: 2 };
    expect([0, 3, 12, 25, 40, 50].map((d) => weaponAccuracyAtDistance(ordinary, d))).toEqual([
      0.8, 0.8, 0.75, 0.55, 0.4, 0.4,
    ]);
    expect(weaponAccuracyAtDistance({ kind: 'revolver', quality: 6 }, 18.5)).toBeCloseTo(0.9125);
    expect(weaponAccuracyAtDistance({ kind: 'shortBow', quality: 6 }, 7.5)).toBeCloseTo(0.9875);
  });
  it('uses the source Shooting skill/capacity offset curve, including separate sight/manipulation caps', () => {
    expect(shootingAccuracyPerCell(0)).toBe(0.89);
    expect(shootingAccuracyPerCell(10)).toBe(0.97);
    expect(shootingAccuracyPerCell(20)).toBe(0.99);
    expect(shootingAccuracyPerCell(10, 0.5, 0.5)).toBe(0.89);
    expect(shootingAccuracyPerCell(20, 2, 1)).toBeCloseTo(0.9968);
    expect(shootingAccuracyPerCell(20, 100, 100)).toBe(shootingAccuracyPerCell(20, 2, 1));
    expect(shootingAccuracyPerCell(0, 0, 0)).toBe(0.7);
    expect(() => shootingAccuracyPerCell(21)).toThrow();
    expect(() => shootingAccuracyPerCell(5, NaN)).toThrow();
  });
  it('uses speed/100 native cells per tick instead of treating XML speed as cells per second', () => {
    expect(projectileFlightTicks(11, 44)).toBe(9); // 25 native ticks -> ceil(25/3).
    expect(projectileFlightTicks(16.5, 55)).toBe(10);
    expect(projectileFlightTicks(0, 55)).toBe(1);
    expect(projectileFlightTicks(0.1, 44)).toBe(1);
    expect(() => projectileFlightTicks(-1, 44)).toThrow();
    expect(() => projectileFlightTicks(3, 0)).toThrow();
    expect(() => projectileFlightTicks(Infinity, 55)).toThrow();
  });
});

describe('closed-cube 3D supercover geometry', () => {
  it('returns analytical entry/exit intervals for a horizontal ray and a vertical shaft', () => {
    const ray = traceVoxelRay(p(0.5, 0.5, 0.5), p(3.5, 0.5, 0.5), bounds);
    expect(ray.map((r) => r.cell)).toEqual([p(0, 0, 0), p(1, 0, 0), p(2, 0, 0), p(3, 0, 0)]);
    const expected = [
      [0, 1 / 6],
      [1 / 6, 1 / 2],
      [1 / 2, 5 / 6],
      [5 / 6, 1],
    ];
    ray.forEach((r, i) => {
      expect(r.tEnter).toBeCloseTo(expected[i][0]);
      expect(r.tExit).toBeCloseTo(expected[i][1]);
    });
    expect(keys(p(2.5, 2.5, 0.5), p(2.5, 2.5, 3.5))).toEqual(['2/2/0', '2/2/1', '2/2/2', '2/2/3']);
  });
  it('includes both sides of diagonal wall corners rather than slipping between voxels', () => {
    const ray = traceVoxelRay(p(0.5, 0.5, 0.5), p(2.5, 2.5, 0.5), bounds);
    expect(new Set(ray.map((r) => `${r.cell.x}/${r.cell.y}`))).toEqual(
      new Set(['0/0', '1/0', '0/1', '1/1', '2/1', '1/2', '2/2']),
    );
    for (const [x, y, t] of [
      [1, 0, 0.25],
      [0, 1, 0.25],
      [2, 1, 0.75],
      [1, 2, 0.75],
    ]) {
      const cell = ray.find((r) => r.cell.x === x && r.cell.y === y)!;
      expect([cell.tEnter, cell.tExit]).toEqual([t, t]);
    }
  });
  it('visits all eight cubes at a 3D vertex so diagonal rays cannot skip a floor corner', () => {
    const ray = traceVoxelRay(p(0.5, 0.5, 0.5), p(1.5, 1.5, 1.5), bounds);
    expect(ray).toHaveLength(8);
    expect(new Set(ray.map((r) => `${r.cell.x}${r.cell.y}${r.cell.z}`))).toEqual(
      new Set(['000', '001', '010', '011', '100', '101', '110', '111']),
    );
    expect(ray.filter((r) => r.tEnter === 0.5 && r.tExit === 0.5)).toHaveLength(6);
  });
  it('includes both sides of coplanar segments and all closed-cell contacts at degenerate vertices', () => {
    expect(new Set(keys(p(1, 0.5, 0.5), p(1, 2.5, 0.5)))).toEqual(
      new Set(['0/0/0', '1/0/0', '0/1/0', '1/1/0', '0/2/0', '1/2/0']),
    );
    const pointRay = traceVoxelRay(p(1, 1, 1), p(1, 1, 1), bounds);
    expect(pointRay).toHaveLength(8);
    expect(pointRay.every((r) => r.tEnter === 0 && r.tExit === 0)).toBe(true);
  });
  it('is reversible, unique and bounded for long corner rays and arbitrary fractional endpoints', () => {
    const a = p(0.2, 2.75, 0.125),
      b = p(14.9, 0.1, 12.6);
    const forward = traceVoxelRay(a, b, bounds),
      reverse = traceVoxelRay(b, a, bounds);
    expect(new Set(keys(a, b))).toEqual(new Set(keys(b, a)));
    for (const r of forward) {
      const reversed = reverse.find(
        (q) => q.cell.x === r.cell.x && q.cell.y === r.cell.y && q.cell.z === r.cell.z,
      )!;
      expect(reversed.tEnter).toBeCloseTo(1 - r.tExit, 10);
      expect(reversed.tExit).toBeCloseTo(1 - r.tEnter, 10);
    }
    const long = traceVoxelRay(p(0.5, 0.5, 0.5), p(511.5, 511.5, 511.5), {
      width: 512,
      depth: 512,
      height: 512,
    });
    expect(long).toHaveLength(1 + 511 * 7);
    expect(new Set(long.map((r) => `${r.cell.x}/${r.cell.y}/${r.cell.z}`)).size).toBe(long.length);
  });
  it('keeps boundary-face contacts inside the supplied map and rejects nonfinite/out-of-bounds inputs', () => {
    const small = { width: 2, depth: 2, height: 2 };
    const edge = traceVoxelRay(p(0, 0, 0), p(2, 2, 2), small);
    expect(edge).toHaveLength(8);
    expect(edge.every((r) => Object.values(r.cell).every((n) => n >= 0 && n < 2))).toBe(true);
    for (const bad of [p(NaN, 1), p(Infinity, 1), p(-0.1, 1), p(65, 1)])
      expect(() => traceVoxelRay(bad, p(1, 1), bounds)).toThrow();
    expect(() => traceVoxelRay(p(1, 1), p(2, 2), { ...bounds, height: 0 })).toThrow();
    expect(() => traceVoxelRay(p(1, 1), p(2, 2), { ...bounds, width: 1.5 })).toThrow();
  });
});

describe('auditable source shot factors with explicit 3D line and cover adaptation', () => {
  it('multiplies distinct source factors and applies the standard-target floor before target size', () => {
    const r = report({ target: p(12, 10), weatherAccuracy: 0.5 });
    expect(r.shooterAccuracyPerCell).toBe(0.97);
    expect(r.shooterFactor).toBeCloseTo(0.97 ** 12);
    expect(r.weaponFactor).toBe(0.75);
    expect(r.estimatedHitChance).toBeCloseTo(0.97 ** 12 * 0.75 * 0.5);
    const floor = report({
      target: p(60, 10),
      shootingLevel: 0,
      weatherAccuracy: 0,
      targetSize: 0.1,
    });
    expect(floor.aimStandard).toBe(0.0201);
    expect(floor.targetSizeFactor).toBe(0.5);
    expect(floor.aimIgnoringPosture).toBe(0.01005);
    expect(floor.inRange).toBe(false);
  });
  it('bypasses weather only when both endpoints are roofed and keeps current absent weather at one', () => {
    expect(report().weatherFactor).toBe(1);
    expect(report({ weatherAccuracy: 0.5, shooterRoofed: true }).weatherFactor).toBe(0.5);
    expect(
      report({ weatherAccuracy: 0.5, shooterRoofed: true, targetRoofed: true }).weatherFactor,
    ).toBe(1);
  });
  it('separates close execution, farther prone impact and legal minimum range', () => {
    expect(report({ target: p(3, 10), targetProne: true }).executionFactor).toBe(7.5);
    expect(report({ target: p(4, 10), targetProne: true }).executionFactor).toBe(1);
    expect(report({ target: p(4, 10), targetProne: true }).postureFactor).toBe(1);
    expect(report({ target: p(5, 10), targetProne: true }).postureFactor).toBe(0.5);
    expect(report({ target: p(1, 10) }).canShoot).toBe(false);
    expect(report({ target: p(1, 10), allowAdjacentShot: true }).canShoot).toBe(true);
    expect(projectilePostureChance(4.499, true)).toBe(1);
    expect(projectilePostureChance(4.5, true)).toBe(0.5);
  });
  it('uses actual 3D range and blocks walls/floors/corner contacts rather than granting elevation bonuses', () => {
    const distant = report({
      weapon: { kind: 'shortBow', quality: 2 },
      shooter: p(2, 2, 0),
      target: p(2, 2, 23),
    });
    expect(distant.distance).toBe(23);
    expect(distant.inRange).toBe(false);
    const wall = report({
      shooter: p(0, 0, 0),
      target: p(2, 2, 0),
      blocked: (c) => c.x === 1 && c.y === 0 && c.z === 0,
    });
    expect(wall.clearLine).toBe(false);
    expect(wall.firstBlocker).toEqual(p(1, 0, 0));
    const floor = report({ shooter: p(0, 0, 0), target: p(2, 0, 2), blocked: (c) => c.z === 1 });
    expect(floor.canShoot).toBe(false);
    expect(floor.firstBlocker?.z).toBe(1);
  });
  it('retains native horizontal angle, diagonal and short-distance factors with multiplicative combined cover', () => {
    expect(report({ covers: [cover(1, 9, 10, { fillPercent: 0.55 })] }).passCover).toBeCloseTo(
      0.45,
    );
    const angled = report({ shooter: p(0, 6), covers: [cover(1, 9, 10), cover(2, 9, 9)] });
    expect(angled.covers.map((c) => c.angleFactor)).toEqual([0.8, 0.4]);
    expect(angled.covers.map((c) => c.blockChance)).toEqual([0.4, 0.2]);
    expect(angled.passCover).toBeCloseTo(0.48);
    const close = report({ shooter: p(8, 10), covers: [cover(1, 9, 10)] });
    expect(close.covers[0].nearFactor).toBe(0.3333);
    expect(close.passCover).toBeCloseTo(1 - 0.5 * 0.3333);
    expect(report({ covers: [cover(1, 11, 10)] }).passCover).toBe(1);
    expect(report({ covers: [cover(1, 9, 10, { full: true })] }).passCover).toBe(0.25);
    expect(report({ covers: [cover(1, 9, 10, { full: true, open: true })] }).passCover).toBe(1);
  });
  it('rejects lower cover under an elevated trajectory by an inspectable height projection', () => {
    const low = report({ shooter: p(0, 10, 11), covers: [cover(1, 9, 10)] });
    expect(low.covers[0]).toMatchObject({ rayHeight: 2.5, heightEligible: false, blockChance: 0 });
    expect(low.passCover).toBe(1);
    const tall = report({ shooter: p(0, 10, 11), covers: [cover(1, 9, 10, { height: 2 })] });
    expect(tall.covers[0].heightEligible).toBe(true);
    expect(tall.passCover).toBe(0.5);
  });
  it('excludes shooter-cell cover only from combined cover, retaining source cover-selection consumption', () => {
    const r = report({ shooter: p(9, 10), allowAdjacentShot: true, covers: [cover(1, 9, 10)] });
    expect(r.covers[0].blockChance).toBeCloseTo(0.5 * 0.3333);
    expect(r.passCover).toBe(1);
    const launch = resolveRangedLaunch(r, rolls(0, 0));
    expect(launch.outcome).toBe('target');
    expect(launch.rolls.map((r) => r.stage)).toEqual(['coverSelection', 'aim']);
  });
});

describe('launch intent is separate from projectile impact', () => {
  it('does not replace aim, cover and far prone checks with one final hit-chance roll', () => {
    const r = report({ targetProne: true }),
      random = rolls(0);
    const launch = resolveRangedLaunch(r, random);
    expect(launch).toMatchObject({
      outcome: 'target',
      canHitIntended: true,
      canHitOthers: true,
      canHitWorld: false,
      postureImpactChance: 0.5,
    });
    expect(launch.rolls.map((r) => r.stage)).toEqual(['aim']);
    expect(random).toHaveBeenCalledTimes(1);
    expect(r.estimatedHitChance).toBeCloseTo(r.aimIgnoringPosture * 0.5);
  });
  it('selects a physical cover before aiming and only then tests cover passage', () => {
    const r = report({ covers: [cover(42, 9, 10, { fillPercent: 0.55 })] });
    const launch = resolveRangedLaunch(r, rolls(0.5, 0, 0.9));
    expect(launch).toMatchObject({
      outcome: 'cover',
      coverId: 42,
      destination: p(9.5, 10.5, 1.5),
      canHitIntended: false,
      canHitOthers: true,
      canHitWorld: true,
    });
    expect(launch.rolls.map((r) => r.stage)).toEqual(['coverSelection', 'aim', 'cover']);
    expect(launch.launchDistance).toBe(9);
  });
  it('produces bounded reproducible wild destinations and the source 50% non-target-pawn flag', () => {
    const r = report(),
      a = resolveRangedLaunch(r, rolls(0.99, 0, 0, 0)),
      b = resolveRangedLaunch(r, rolls(0.99, 0, 0, 0.9));
    expect(a).toMatchObject({
      outcome: 'wild',
      destination: p(11.5, 10.5, 1.5),
      canHitIntended: false,
      canHitOthers: true,
      canHitWorld: true,
    });
    expect(b.canHitOthers).toBe(false);
    expect(a.launchDistance).toBe(11);
    expect(resolveRangedLaunch(r, rolls(0.99, 0, 0, 0))).toEqual(a);
    const edge = report({
      shooter: p(4, 10),
      target: p(15, 10),
      bounds: { width: 16, depth: 16, height: 16 },
    });
    expect(resolveRangedLaunch(edge, rolls(0.99, 0, 0, 0)).destination.x).toBe(15.5);
    expect(wildMissRadius(0.02, 0.5)).toBe(5.5);
    expect(wildMissRadius(0.04, 0.5)).toBe(4.5);
    expect(wildMissRadius(0.03, 0.5)).toBe(5);
    expect(wildMissRadius(1, 0.99)).toBe(1);
  });
  it('consumes no RNG for illegal shots or saturated chances, and invalid RNG leaves reports unchanged', () => {
    const blocked = report({ blocked: (c) => c.x === 5 }),
      none = rolls(NaN);
    expect(resolveRangedLaunch(blocked, none).outcome).toBe('blocked');
    expect(none).not.toHaveBeenCalled();
    expect(resolveRangedLaunch(report({ target: p(60, 10) }), none).outcome).toBe('outOfRange');
    const execution = report({ target: p(3, 10), targetProne: true });
    expect(resolveRangedLaunch(execution, none).outcome).toBe('target');
    expect(none).not.toHaveBeenCalled();
    const r = report(),
      before = structuredClone(r);
    for (const bad of [NaN, -0.1, 1, Infinity])
      expect(() => resolveRangedLaunch(r, rolls(bad))).toThrow();
    expect(r).toEqual(before);
  });
  it('keeps native five-to-twelve-cell interception gating, prone reduction and friendly-fire policy separate', () => {
    const origin = p(0.5, 0.5, 1.5);
    expect(interceptDistanceFactor(origin, p(5, 0))).toBe(0);
    expect(interceptDistanceFactor(origin, p(12, 0))).toBe(1);
    expect(interceptDistanceFactor(origin, p(8, 0))).toBeCloseTo(39 / 119);
    expect(pawnInterceptChance({ origin, cell: p(12, 0) })).toBe(0.4);
    expect(pawnInterceptChance({ origin, cell: p(12, 0), prone: true })).toBeCloseTo(0.04);
    expect(
      pawnInterceptChance({ origin, cell: p(12, 0), friendly: true, preventFriendlyFire: true }),
    ).toBe(0);
    expect(
      pawnInterceptChance({ origin, cell: p(12, 0), friendly: true, friendlyFireFactor: 0.5 }),
    ).toBe(0.2);
    expect(pawnInterceptChance({ origin, cell: p(3, 0), friendly: false })).toBe(0);
  });
  it('rejects malformed map, cover and accuracy factors before calling geometry callbacks', () => {
    for (const changes of [
      { weatherAccuracy: NaN },
      { targetSize: Infinity },
      { sight: -1 },
      { shooter: p(0.5, 10) },
      { covers: [cover(1, 9, 10, { height: 0 })] },
      { covers: [cover(1, 9, 10), cover(1, 9, 9)] },
    ]) {
      const blocked = vi.fn(() => false);
      expect(() => report({ ...changes, blocked })).toThrow();
      expect(blocked).not.toHaveBeenCalled();
    }
    const r = report(),
      random = rolls(0);
    for (const changes of [
      { inRange: 'yes' },
      { canHitOthers: 1 },
      { postureFactor: NaN },
      { covers: [null] },
      { covers: [{ ...cover(-1, 9, 10), blockChance: 0.5 }] },
    ])
      expect(() =>
        resolveRangedLaunch({ ...r, ...changes } as unknown as typeof r, random),
      ).toThrow();
    expect(random).not.toHaveBeenCalled();
  });
});
