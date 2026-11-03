import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { snapshotShotReport, projectileViewPosition } from '../src/voxel/rangedView';
import { makeWeapon } from '../src/voxel/weapons';
import { Block, at, type Projectile } from '../src/voxel/types';

// Controlled geometry compares the read-only UI view against actual world rules;
// these isolated fixtures are not evidence of normal colony progression.
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Air);
  s.trees = [];
  s.doors = [];
  s.sandbags = [];
  Object.assign(s.pawns[0], { x: 10, y: 10, z: 8 });
  Object.assign(s.pawns[1], { x: 20, y: 10, z: 8 });
  s.pawns[0].weapon = makeWeapon(s.nextId++, 'revolver');
  return s;
}
function compare(s: VoxelSimulation) {
  const snapshot = s.snapshot();
  const ui = snapshotShotReport(
    snapshot,
    snapshot.pawns[0],
    snapshot.pawns[1],
    (cell) => s.blocks[at(cell)],
  );
  expect(ui).toEqual(s.shotReport(s.pawns[0], s.pawns[1]));
  return ui!;
}

describe('read-only ranged UI agrees with the simulation', () => {
  it('retains weapon quality, shooting skill, cover and prone factors', () => {
    const s = fixture();
    s.sandbags.push({ id: s.nextId++, x: 19, y: 10, z: 8, hitPoints: 300 });
    for (const kind of ['shortBow', 'revolver', 'machinePistol'] as const) {
      s.pawns[0].weapon = makeWeapon(s.nextId++, kind, 5);
      s.pawns[0].skills.shooting.level = 13;
      s.pawns[1].phase = 'rest';
      const ui = compare(s);
      expect(ui.passCover).toBeCloseTo(0.45);
      expect(ui.postureFactor).toBe(0.5);
    }
  });
  it('keeps automatic doors opaque during their first 13 opening ticks and after closing', () => {
    const s = fixture();
    const door = {
      id: s.nextId++,
      x: 15,
      y: 10,
      z: 8,
      axis: 'x' as const,
      mode: 'auto' as const,
      openUntil: 150,
    };
    s.doors.push(door);
    for (const [tick, clear] of [
      [100, false],
      [112, false],
      [113, true],
      [149, true],
      [150, false],
    ] as const) {
      s.tick = tick;
      expect(compare(s).clearLine).toBe(clear);
    }
    s.tick = 120;
    s.doors[0].mode = 'locked';
    expect(compare(s).clearLine).toBe(false);
    s.doors[0].mode = 'open';
    expect(compare(s).clearLine).toBe(true);
  });
  it('preserves cross-floor height filtering and physical floor blockage in the preview', () => {
    const s = fixture();
    s.pawns[0].z = 14;
    s.sandbags.push({ id: s.nextId++, x: 19, y: 10, z: 8, hitPoints: 300 });
    const open = compare(s);
    expect(open.distance).toBeCloseTo(Math.hypot(10, 6));
    expect(open.covers[0].heightEligible).toBe(false);
    s.blocks[at({ x: 15, y: 10, z: 11 })] = Block.Wood;
    expect(compare(s).clearLine).toBe(false);
  });
  it('interpolates all three flight coordinates and clamps without mutating saved flight state', () => {
    const projectile: Projectile = {
      id: 1,
      shooterId: 2,
      shooterFaction: 'colony',
      targetId: 3,
      kind: 'shortBow',
      quality: 2,
      from: { x: 1.5, y: 2.5, z: 3.5 },
      destination: { x: 7.5, y: 14.5, z: 9.5 },
      launchedTick: 100,
      impactTick: 106,
      damage: 11,
      armorPenetration: 0.165,
      canHitIntended: true,
      canHitOthers: true,
      canHitWorld: false,
      coverId: null,
      postureImpactChance: 1,
    };
    const before = structuredClone(projectile);
    expect(projectileViewPosition(projectile, 98)).toEqual(projectile.from);
    expect(projectileViewPosition(projectile, 103)).toEqual({ x: 4.5, y: 8.5, z: 6.5 });
    expect(projectileViewPosition(projectile, 106)).toEqual(projectile.destination);
    expect(projectileViewPosition(projectile, 110)).toEqual(projectile.destination);
    expect(projectile).toEqual(before);
  });
});
