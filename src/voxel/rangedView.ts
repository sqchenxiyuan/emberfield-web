import {
  WIDTH,
  DEPTH,
  HEIGHT,
  type Pawn,
  type Pos,
  type VoxelSnapshot,
  type Projectile,
} from './types';
import { healthSummary } from './survival';
import { isRangedKind, rangedShotReport, type RangedCover } from './ranged';

/** Read-only preview from the same snapshot and block cache shown by the client. */
export function snapshotShotReport(
  snapshot: VoxelSnapshot,
  pawn: Pawn,
  target: Pawn,
  blockAt: (cell: Pos) => number,
) {
  if (!pawn.weapon || !isRangedKind(pawn.weapon.kind)) return null;
  const adjacent = (p: Pos) =>
    p.z === target.z && Math.max(Math.abs(p.x - target.x), Math.abs(p.y - target.y)) <= 1;
  const covers: RangedCover[] = [
    ...snapshot.sandbags
      .filter(adjacent)
      .map((bag) => ({ id: bag.id, position: bag, fillPercent: 0.55, height: 0.75 })),
    ...snapshot.trees.filter(adjacent).map((tree) => ({
      id: tree.id,
      position: tree,
      fillPercent: tree.species === 'saguaro' ? 0.35 : 0.25,
      height: 2,
    })),
  ];
  const health = healthSummary(pawn),
    prone = target.downed || target.phase === 'rest';
  return rangedShotReport({
    weapon: { kind: pawn.weapon.kind, quality: pawn.weapon.quality },
    shooter: pawn,
    target,
    shootingLevel: pawn.skills.shooting.level,
    sight: health.sight,
    manipulation: health.manipulation,
    weatherAccuracy: 1,
    targetProne: prone,
    canBenefitFromCover: true,
    covers,
    bounds: { width: WIDTH, depth: DEPTH, height: HEIGHT },
    blocked: (cell) =>
      blockAt(cell) !== 0 ||
      snapshot.doors.some(
        (door) =>
          door.x === cell.x &&
          door.y === cell.y &&
          (door.z === cell.z || door.z + 1 === cell.z) &&
          door.mode !== 'open' &&
          (door.mode === 'locked' ||
            door.openUntil <= snapshot.tick ||
            snapshot.tick < door.openUntil - 37),
      ),
  });
}

/** The renderer interpolates the saved physical flight; it never decides hits. */
export function projectileViewPosition(projectile: Projectile, tick: number): Pos {
  const t = Math.max(
    0,
    Math.min(
      1,
      (tick - projectile.launchedTick) /
        Math.max(1, projectile.impactTick - projectile.launchedTick),
    ),
  );
  return {
    x: projectile.from.x + (projectile.destination.x - projectile.from.x) * t,
    y: projectile.from.y + (projectile.destination.y - projectile.from.y) * t,
    z: projectile.from.z + (projectile.destination.z - projectile.from.z) * t,
  };
}
