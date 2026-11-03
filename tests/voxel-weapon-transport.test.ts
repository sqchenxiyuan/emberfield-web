import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, index, type Pos, type VoxelCommand } from '../src/voxel/types';
import { makeWeapon, type WeaponKind, type WeaponPiece } from '../src/voxel/weapons';
import { applyInjury, validTrauma } from '../src/voxel/injuries';
import { portion } from '../src/voxel/preservation';
import { healthSummary } from '../src/voxel/survival';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c);
  expect(result.ok, result.message).toBe(true);
}
function until(s: VoxelSimulation, done: () => boolean, limit = 1500) {
  for (let n = 0; n < limit && !done(); n++) s.step();
  expect(
    done(),
    JSON.stringify(
      s.pawns.map((p) => ({
        id: p.id,
        phase: p.phase,
        reason: p.reason,
        weaponTask: p.weaponTask,
        cargo: p.cargo,
      })),
    ),
  ).toBe(true);
}
/** Bounded geometry tests transactions; full production is exercised by the normal campaign. */
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let x = 10; x <= 24; x++)
    for (let y = 10; y <= 24; y++)
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i));
    p.worn = [];
    p.schedule.fill('work');
    p.priorities = {
      clean: 0,
      warden: 0,
      hunt: 0,
      dig: 0,
      build: 0,
      cut: 0,
      haul: 0,
      grow: 0,
      cook: 0,
      craft: 0,
      care: 0,
      research: 0,
    };
  });
  return VoxelSimulation.load(s.save());
}
function groundWeapon(
  s: VoxelSimulation,
  kind: WeaponKind,
  point = pos(14, 15),
  forbidden = false,
) {
  const weapon = makeWeapon(s.nextId++, kind);
  s.items.push({ ...point, id: s.nextId++, resource: 'weapon', amount: 1, weapon, forbidden });
  return weapon;
}
function pieces(s: VoxelSimulation): WeaponPiece[] {
  return [
    ...s.items.flatMap((i) => (i.weapon ? [i.weapon] : [])),
    ...s.pawns.flatMap((p) => [
      ...(p.weapon ? [p.weapon] : []),
      ...(p.cargo?.weapon ? [p.cargo.weapon] : []),
    ]),
  ];
}
function identities(s: VoxelSimulation, expected: number[]) {
  const all = pieces(s);
  expect(all.map((p) => p.id).sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
  expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
  expect(s.counts().weapon).toBe(all.length);
}
function fillGround(s: VoxelSimulation) {
  for (let x = 10; x <= 24; x++)
    for (let y = 10; y <= 24; y++)
      if (!s.items.some((i) => i.x === x && i.y === y && i.z === 8))
        s.items.push({ ...pos(x, y), id: s.nextId++, resource: 'wood', amount: 75 });
}
function clearOneCellWithoutLosingStock(s: VoxelSimulation, at: Pos) {
  const item = s.items.find((i) => i.x === at.x && i.y === at.y && i.z === at.z)!;
  expect(item.resource).toBe('wood');
  expect(s.pawns[1].cargo).toBeNull();
  s.pawns[1].cargo = portion(item, item.amount);
  s.items = s.items.filter((i) => i.id !== item.id);
}

describe('weapon transport, prohibition and interrupted transactions', () => {
  it('keeps forbidden ground weapons out of automatic hauling, but explicit equip clears the flag and reserves one identity', () => {
    let s = fixture();
    const piece = groundWeapon(s, 'steelKnife', pos(14, 15), true),
      pawnId = s.pawns[0].id;
    command(s, { type: 'designate', tool: 'stock', from: pos(20, 20) });
    command(s, { type: 'storage', from: pos(20, 20), priority: 3, accepts: ['weapon'] });
    command(s, { type: 'priority', pawnId, work: 'haul', value: 1 });
    s.step(120);
    expect(s.items.find((i) => i.weapon?.id === piece.id)).toMatchObject({
      x: 14,
      y: 15,
      forbidden: true,
    });
    expect(s.pawns.every((p) => p.cargo === null)).toBe(true);
    command(s, { type: 'draft', pawnId, drafted: true });
    command(s, { type: 'equipWeapon', pawnId, weaponId: piece.id });
    expect(s.items.find((i) => i.weapon?.id === piece.id)?.forbidden).toBe(false);
    expect(s.command({ type: 'equipWeapon', pawnId: s.pawns[1].id, weaponId: piece.id }).ok).toBe(
      false,
    );
    s.step();
    expect(s.pawns[0].weapon).toBeNull(); // Travel must happen before equipping.
    s = VoxelSimulation.load(s.save());
    until(s, () => s.pawns[0].weapon?.id === piece.id);
    expect(s.pawns[0].drafted).toBe(true);
    expect(s.pawns[0].phase).toBe('combat');
    expect(s.pawns[0].cargo).toBeNull();
    identities(s, [piece.id]);
  });

  it('reuses the just-vacated pickup tile for the old weapon even when every other ground cell is full', () => {
    const s = fixture(),
      pawn = s.pawns[0];
    const old = makeWeapon(s.nextId++, 'woodClub');
    pawn.weapon = old;
    const next = groundWeapon(s, 'steelKnife', pawn, true);
    fillGround(s);
    const wood = s.counts().wood;
    command(s, { type: 'equipWeapon', pawnId: pawn.id, weaponId: next.id });
    s.step();
    expect(pawn.weapon?.id).toBe(next.id);
    expect(pawn.cargo).toBeNull();
    expect(s.items.find((i) => i.weapon?.id === old.id)).toMatchObject({
      x: pawn.x,
      y: pawn.y,
      forbidden: false,
    });
    expect(s.counts().wood).toBe(wood);
    identities(s, [old.id, next.id]);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('keeps a drafted equip order through hunger and exhaustion checks and reloads while fetching', () => {
    let s = fixture();
    const pawnId = s.pawns[0].id;
    const piece = groundWeapon(s, 'steelLongsword', pos(22, 22));
    s.items.push({ ...pos(12, 11), id: s.nextId++, resource: 'food', amount: 10 });
    s.pawns[0].food = 8;
    s.pawns[0].rest = 1;
    s.pawns[0].schedule.fill('sleep');
    command(s, { type: 'draft', pawnId, drafted: true });
    command(s, { type: 'equipWeapon', pawnId, weaponId: piece.id });
    s.step(25); // Cross the staggered twenty-tick ordinary need checks.
    expect(s.pawns[0].phase).toBe('weapon');
    expect(s.pawns[0].weaponTask).toMatchObject({ action: 'equip', stage: 'fetch' });
    expect(s.pawns[0].eating).toBeNull();
    s = VoxelSimulation.load(s.save());
    until(s, () => s.pawns[0].weapon?.id === piece.id);
    expect(s.pawns[0].drafted).toBe(true);
    expect(s.pawns[0].phase).toBe('combat');
    expect(s.pawns[0].food).toBeLessThan(8);
    expect(s.pawns[0].rest).toBeLessThan(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    identities(s, [piece.id]);
  });

  it('rejects player equipment orders for an enemy instead of producing an unloadable weapon task', () => {
    const s = fixture(),
      enemy = structuredClone(s.pawns[2]);
    enemy.id = s.nextId++;
    enemy.name = '测试敌人';
    Object.assign(enemy, pos(23, 10));
    enemy.faction = 'raider';
    enemy.phase = 'combat';
    enemy.weapon = makeWeapon(s.nextId++, 'steelKnife');
    s.pawns.push(enemy);
    const replacement = groundWeapon(s, 'steelLongsword');
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    expect(s.command({ type: 'equipWeapon', pawnId: enemy.id, weaponId: replacement.id }).ok).toBe(
      false,
    );
    expect(s.command({ type: 'dropWeapon', pawnId: enemy.id }).ok).toBe(false);
    expect(enemy.weaponTask).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it.each(['equipped-fetch', 'equipped-work', 'dropping', 'unarmed-fetch'] as const)(
    'cancels %s on actual dual-arm loss without requiring death or downing and preserves saveable weapon identities',
    (mode) => {
      const s = fixture(),
        pawn = s.pawns[0];
      const old = mode === 'unarmed-fetch' ? null : makeWeapon(s.nextId++, 'woodClub');
      pawn.weapon = old;
      const next = mode === 'dropping' ? null : groundWeapon(s, 'steelLongsword', pos(22, 22));
      const expectedIds = [old, next].flatMap((piece) => (piece ? [piece.id] : []));
      if (mode === 'equipped-work') {
        // The replacement has already been physically fetched; no second ground copy exists.
        const item = s.items.find((i) => i.weapon?.id === next!.id)!;
        pawn.cargo = portion(item, 1);
        s.items = s.items.filter((i) => i.id !== item.id);
      }
      command(s, { type: 'draft', pawnId: pawn.id, drafted: true });
      command(
        s,
        mode === 'dropping'
          ? { type: 'dropWeapon', pawnId: pawn.id }
          : { type: 'equipWeapon', pawnId: pawn.id, weaponId: next!.id },
      );
      if (mode === 'dropping') s.step(4);
      else if (mode !== 'equipped-work') s.step();
      expect(pawn.weaponTask?.stage).toBe(mode.includes('fetch') ? 'fetch' : 'work');
      expect(() => VoxelSimulation.load(s.save())).not.toThrow();

      // Low-level destruction fixture: 2 × 30 arm HP, total fresh-stump pain .75.
      // Fresh missing parts bleed even when the triggering wound was blunt.
      // Consciousness and walking remain above the downing thresholds while Manipulation is zero.
      applyInjury(pawn.trauma, s.nextId++, 'leftArm', 'bruise', 30);
      applyInjury(pawn.trauma, s.nextId++, 'rightArm', 'bruise', 30);
      expect(validTrauma(pawn.trauma, s.tick)).toBe(true);
      const health = healthSummary(pawn);
      expect(health.manipulation).toBe(0);
      expect(health.pain).toBeCloseTo(0.75);
      expect(health.consciousness).toBeGreaterThan(0.3);
      expect(health.moving).toBeGreaterThan(0.15);
      expect(health.bleedRate).toBeCloseTo(7.2);

      s.step();
      expect(pawn.dead).toBe(false);
      expect(pawn.downed).toBe(false);
      expect(pawn.weaponTask).toBeNull();
      expect(pawn.phase).toBe('combat');
      expect(pawn.weapon).toBeNull();
      expect(pawn.weaponDropPending).toBe(false);
      if (old) expect(s.items.find((i) => i.weapon?.id === old.id)?.forbidden).toBe(true);
      if (mode.includes('fetch'))
        expect(s.items.find((i) => i.weapon?.id === next!.id)).toMatchObject({
          x: 22,
          y: 22,
          weapon: next,
        });
      identities(s, expectedIds);
      const restored = VoxelSimulation.load(s.save());
      restored.step(12);
      expect(restored.pawns[0].weaponTask).toBeNull();
      expect(restored.pawns[0].weapon).toBeNull();
      if (next)
        expect(
          restored.command({ type: 'equipWeapon', pawnId: pawn.id, weaponId: next.id }).ok,
        ).toBe(false);
      identities(restored, expectedIds);
    },
  );

  it.each(['equip', 'drop'] as const)(
    'rejects a saved %s task whose valid injuries already remove all manipulation',
    (action) => {
      const s = fixture(),
        pawn = s.pawns[0];
      pawn.weapon = makeWeapon(s.nextId++, 'woodClub');
      const next = groundWeapon(s, 'steelKnife');
      command(s, { type: 'draft', pawnId: pawn.id, drafted: true });
      command(
        s,
        action === 'equip'
          ? { type: 'equipWeapon', pawnId: pawn.id, weaponId: next.id }
          : { type: 'dropWeapon', pawnId: pawn.id },
      );
      expect(() => VoxelSimulation.load(s.save())).not.toThrow();
      const invalid = s.save(),
        injured = invalid.pawns[0];
      applyInjury(injured.trauma, invalid.nextId++, 'leftArm', 'bruise', 30);
      applyInjury(injured.trauma, invalid.nextId++, 'rightArm', 'bruise', 30);
      expect(validTrauma(injured.trauma, invalid.tick)).toBe(true);
      expect(healthSummary(injured).manipulation).toBe(0);
      expect(healthSummary(injured).pain).toBeLessThan(0.8);
      expect(() => VoxelSimulation.load(invalid)).toThrow();
    },
  );

  it('retains an equipped old weapon and carried replacement when no cell is free, through save/load and interruption', () => {
    let s = fixture(),
      pawn = s.pawns[0];
    const old = makeWeapon(s.nextId++, 'woodClub'),
      next = makeWeapon(s.nextId++, 'steelLongsword');
    pawn.weapon = old;
    pawn.cargo = { resource: 'weapon', amount: 1, weapon: next };
    fillGround(s);
    const wood = s.counts().wood;
    command(s, { type: 'equipWeapon', pawnId: pawn.id, weaponId: next.id });
    s.step(15);
    expect(pawn.weapon?.id).toBe(old.id);
    expect(pawn.cargo?.weapon?.id).toBe(next.id);
    expect(pawn.weaponTask?.stage).toBe('work');
    s = VoxelSimulation.load(s.save());
    pawn = s.pawns[0];
    s.step(10);
    expect(pawn.weapon?.id).toBe(old.id);
    expect(pawn.cargo?.weapon?.id).toBe(next.id);
    command(s, { type: 'move', pawnId: pawn.id, target: pos(12, 11) });
    expect(pawn.weaponTask).toBeNull();
    identities(s, [old.id, next.id]);
    command(s, { type: 'equipWeapon', pawnId: pawn.id, weaponId: next.id });
    clearOneCellWithoutLosingStock(s, pawn);
    until(s, () => pawn.weapon?.id === next.id);
    expect(pawn.cargo).toBeNull();
    expect(s.counts().wood).toBe(wood);
    identities(s, [old.id, next.id]);
  });

  it('failed pre-equip unloading is atomic and does not clear prohibition or partially merge cargo', () => {
    const s = fixture(),
      pawn = s.pawns[0],
      next = groundWeapon(s, 'steelKnife', pos(14, 15), true);
    pawn.weapon = makeWeapon(s.nextId++, 'woodClub');
    pawn.cargo = { resource: 'wood', amount: 75 };
    fillGround(s);
    s.items.find((i) => i.x === pawn.x && i.y === pawn.y)!.amount = 50; // Only 25 free spaces for 75 cargo.
    const before = {
      items: structuredClone(s.items),
      cargo: structuredClone(pawn.cargo),
      weapon: structuredClone(pawn.weapon),
      nextId: s.nextId,
    };
    expect(s.command({ type: 'equipWeapon', pawnId: pawn.id, weaponId: next.id }).ok).toBe(false);
    expect({ items: s.items, cargo: pawn.cargo, weapon: pawn.weapon, nextId: s.nextId }).toEqual(
      before,
    );
  });

  it('persists the half-second voluntary drop and marks the resulting physical object forbidden', () => {
    let s = fixture();
    const piece = makeWeapon(s.nextId++, 'steelKnife');
    s.pawns[0].weapon = piece;
    command(s, { type: 'draft', pawnId: s.pawns[0].id, drafted: true });
    command(s, { type: 'dropWeapon', pawnId: s.pawns[0].id });
    s.step(4);
    expect(s.pawns[0].weaponTask?.progress).toBe(4);
    s = VoxelSimulation.load(s.save());
    s.step(5);
    expect(s.pawns[0].weapon?.id).toBe(piece.id);
    s.step();
    expect(s.pawns[0].weapon).toBeNull();
    expect(s.items.find((i) => i.weapon?.id === piece.id)?.forbidden).toBe(true);
    expect(s.pawns[0].phase).toBe('combat');
    identities(s, [piece.id]);
  });

  it('keeps a casualty weapon pending on full ground, then drops exactly once after one cell becomes free', () => {
    let s = fixture();
    const piece = makeWeapon(s.nextId++, 'steelKnife');
    s.pawns[0].weapon = piece;
    fillGround(s);
    applyInjury(s.pawns[0].trauma, s.nextId++, 'torso', 'cut', 40);
    s.step();
    expect(s.pawns[0].dead).toBe(true);
    expect(s.pawns[0].weaponDropPending).toBe(true);
    expect(s.pawns[0].weapon?.id).toBe(piece.id);
    s = VoxelSimulation.load(s.save());
    s.step(10);
    identities(s, [piece.id]);
    clearOneCellWithoutLosingStock(s, s.pawns[0]);
    s.step(3);
    expect(s.pawns[0].weapon).toBeNull();
    expect(s.pawns[0].weaponDropPending).toBe(false);
    expect(s.items.find((i) => i.weapon?.id === piece.id)?.forbidden).toBe(true);
    identities(s, [piece.id]);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('honors a newly applied prohibition while an automatic hauler is still approaching', () => {
    const s = fixture(),
      piece = groundWeapon(s, 'steelKnife', pos(22, 22));
    command(s, { type: 'designate', tool: 'stock', from: pos(13, 13) });
    command(s, { type: 'storage', from: pos(13, 13), priority: 3, accepts: ['weapon'] });
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'haul', value: 1 });
    until(s, () => s.pawns[0].phase === 'haul' && s.pawns[0].path.length > 0);
    command(s, { type: 'weaponForbidden', weaponId: piece.id, forbidden: true });
    s.step(150);
    expect(s.items.find((i) => i.weapon?.id === piece.id)).toMatchObject({
      x: 22,
      y: 22,
      forbidden: true,
    });
    expect(s.pawns[0].cargo).toBeNull();
    identities(s, [piece.id]);
  });

  it('hauls one nonmergeable weapon up a ladder and preserves quality and HP across cargo save/load', () => {
    let s = fixture();
    for (let x = 18; x <= 22; x++)
      for (let y = 18; y <= 21; y++) s.blocks[index(x, y, 10)] = Block.Wood;
    for (let z = 8; z <= 11; z++) s.ladders[index(17, 18, z)] = 1;
    const piece = groundWeapon(s, 'steelLongsword');
    piece.quality = 6;
    piece.hitPoints = 17;
    s = VoxelSimulation.load(s.save());
    command(s, { type: 'designate', tool: 'stock', from: pos(20, 19, 11) });
    command(s, { type: 'storage', from: pos(20, 19, 11), priority: 3, accepts: ['weapon'] });
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'haul', value: 1 });
    until(s, () => s.pawns[0].cargo?.weapon?.id === piece.id && s.pawns[0].z > 8);
    s = VoxelSimulation.load(s.save());
    expect(s.pawns[0].cargo?.weapon).toEqual(piece);
    until(s, () => s.items.some((i) => i.weapon?.id === piece.id && i.z === 11));
    expect(s.items.find((i) => i.weapon?.id === piece.id)?.weapon).toEqual(piece);
    identities(s, [piece.id]);
  });

  it('rejects duplicate equipped/cargo identities, contradictory pending drops and misplaced prohibition fields', () => {
    const s = fixture();
    s.pawns[0].weapon = makeWeapon(s.nextId++, 'steelKnife');
    groundWeapon(s, 'woodClub');
    for (const change of [
      (d: ReturnType<VoxelSimulation['save']>) => {
        d.pawns[1].weapon = structuredClone(d.pawns[0].weapon);
      },
      (d: ReturnType<VoxelSimulation['save']>) => {
        d.pawns[1].cargo = {
          resource: 'weapon',
          amount: 1,
          weapon: structuredClone(d.pawns[0].weapon!),
        };
      },
      (d: ReturnType<VoxelSimulation['save']>) => {
        d.pawns[1].weaponDropPending = true;
      },
      (d: ReturnType<VoxelSimulation['save']>) => {
        d.items[0].forbidden = 'yes' as unknown as boolean;
      },
      (d: ReturnType<VoxelSimulation['save']>) => {
        d.pawns[1].cargo = { resource: 'wood', amount: 1, forbidden: true };
      },
    ]) {
      const save = s.save();
      change(save);
      expect(() => VoxelSimulation.load(save)).toThrow();
    }
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
});
