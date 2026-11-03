import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, index, DAY, type VoxelCommand } from '../src/voxel/types';
import { applyInjury, traumaSummary } from '../src/voxel/injuries';
import { plantRandom } from '../src/voxel/plants';

// Bounded state-machine geometry; the separate campaign uses only normal commands.
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let y = 10; y < 24; y++)
    for (let x = 10; x < 24; x++) for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = { x: 12, y: 12, z: 8 };
  s.pawns.forEach((p, i) => {
    Object.assign(p, { x: 12 + i, y: 12, z: 8 });
    p.priorities = {
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
    p.schedule.fill('work');
  });
  return VoxelSimulation.load(s.save());
}
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c);
  expect(r.ok, r.message).toBe(true);
}
function until(s: VoxelSimulation, done: () => boolean, max = 2000) {
  for (let t = 0; t < max && !done(); t++) s.step();
  expect(done()).toBe(true);
}

describe('voxel combat and physical tending', () => {
  it.each(['miss', 'dodge'])('sleeping targets bypass %s and do not train melee', (branch) => {
    const s = fixture(),
      [attacker, target] = s.pawns;
    attacker.faction = 'raider';
    attacker.phase = 'combat';
    attacker.attackTargetId = target.id;
    attacker.skills.melee.level = 0;
    target.skills.melee.level = 20;
    target.phase = 'rest';
    target.rest = 20;
    target.schedule.fill('sleep');
    target.sleepingSince = 0;
    // Choose actual deterministic rolls which would miss/dodge a standing target.
    for (s.seed = 1; s.seed < 10000; s.seed++) {
      const hit = plantRandom(s.seed, attacker.id, 1, 12);
      const dodge = plantRandom(s.seed, attacker.id, 1, 15);
      if (branch === 'miss' ? hit >= 0.5 : hit < 0.5 && dodge < 0.3) break;
    }
    expect(s.seed).toBeLessThan(10000);
    s.step();
    // A single blunt strike may also crack an internal bone.
    expect(target.trauma.wounds.length).toBeGreaterThan(0);
    expect(attacker.skills.melee.xp).toBe(0);
    expect(attacker.skills.melee.dailyXp).toBe(0);
    expect(attacker.nextAttackTick).toBeGreaterThan(s.tick);
  });
  it('a downed raider recovers without attacking again, waits for an exit, and physically leaves after reload', () => {
    let s = fixture();
    const enemy = {
      ...structuredClone(s.pawns[1]),
      x: 12,
      y: 21,
      id: s.nextId++,
      faction: 'raider' as const,
      worn: [],
      phase: 'combat' as const,
    };
    s.pawns.push(enemy);
    applyInjury(enemy.trauma, s.nextId++, 'torso', 'bruise', 15);
    applyInjury(enemy.trauma, s.nextId++, 'head', 'bruise', 15);
    applyInjury(enemy.trauma, s.nextId++, 'leftArm', 'bruise', 15);
    applyInjury(enemy.trauma, s.nextId++, 'leftLeg', 'bruise', 20);
    s.step();
    expect(enemy.downed).toBe(true);
    expect(enemy.retreating).toBe(true);
    until(s, () => !enemy.downed, 2000);
    s.step(40);
    expect(enemy.reason).toBe('撤离通路受阻');
    expect(enemy.attackTargetId).toBeNull();
    expect(
      s.pawns.filter((p) => p.faction === 'colony').every((p) => !p.trauma.wounds.length),
    ).toBe(true);
    s = VoxelSimulation.load(s.save());
    expect(s.pawns.find((p) => p.id === enemy.id)?.retreating).toBe(true);
    for (let x = 0; x <= 10; x++) for (const z of [8, 9]) s.blocks[index(x, 21, z)] = Block.Air;
    until(s, () => !s.pawns.some((p) => p.id === enemy.id), 2000);
    expect(s.pawns).toHaveLength(3);
    expect(s.pawns.every((p) => !p.trauma.wounds.length && !p.dead)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('finds a raid entry reachable from another colonist when the first is sealed inside', () => {
    const s = fixture();
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++)
        for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
    Object.assign(s.pawns[0], { x: 32, y: 32, z: 8 });
    for (const [x, y] of [
      [31, 32],
      [33, 32],
      [32, 31],
      [32, 33],
    ])
      for (const z of [8, 9]) s.blocks[index(x, y, z)] = Block.Wood;
    s.combat = { enabled: true, nextRaid: 1, wave: 0 };
    s.storyteller.legacyRaidAt = 1;
    s.step();
    expect(s.pawns.filter((p) => p.faction === 'raider')).toHaveLength(1);
    expect(s.combat.wave).toBe(1);
  });
  it('a drafted move order leaves melee contact instead of being overwritten by automatic retaliation', () => {
    const s = fixture(),
      p = s.pawns[0];
    const enemy = {
      ...structuredClone(s.pawns[1]),
      id: s.nextId++,
      faction: 'raider' as const,
      worn: [],
      phase: 'combat' as const,
    };
    s.pawns.push(enemy);
    command(s, { type: 'draft', pawnId: p.id, drafted: true });
    command(s, { type: 'move', pawnId: p.id, target: { x: 12, y: 20, z: 8 } });
    s.step();
    expect(p.y).toBe(13);
    expect(p.attackTargetId).toBeNull();
    expect(p.path.length).toBeGreaterThan(0);
  });
  it('an attacker chooses a reachable colonist instead of fixating on the nearest sealed room', () => {
    const s = fixture(),
      trapped = s.pawns[0];
    Object.assign(trapped, { x: 18, y: 18, z: 8 });
    for (const [x, y] of [
      [17, 18],
      [19, 18],
      [18, 17],
      [18, 19],
    ])
      for (const z of [8, 9]) s.blocks[index(x, y, z)] = Block.Wood;
    const enemy = {
      ...structuredClone(s.pawns[1]),
      x: 20,
      y: 18,
      id: s.nextId++,
      faction: 'raider' as const,
      worn: [],
      phase: 'combat' as const,
    };
    s.pawns.push(enemy);
    until(s, () => s.pawns.slice(1, 3).some((p) => p.trauma.wounds.length > 0), 1600);
    expect(trapped.trauma.wounds).toHaveLength(0);
  });
  it('three wounded doctors complete each other’s treatment without cancelling ongoing care', () => {
    const s = fixture();
    for (const p of s.pawns) {
      applyInjury(p.trauma, s.nextId++, 'torso', 'cut', 8);
      p.priorities.care = 1;
    }
    until(
      s,
      () => s.pawns.every((p) => p.trauma.wounds.every((w) => w.tendQuality !== null)),
      1600,
    );
    expect(s.pawns.every((p) => !p.dead)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('migrates a genuinely published v11 colony without spawning threats, changing needs or supplying weapons', () => {
    const old = JSON.parse(
      readFileSync(new URL('./fixtures/voxel-v11-start.json', import.meta.url), 'utf8'),
    );
    const s = VoxelSimulation.load(old);
    expect(old.version).toBe(11);
    expect(s.save().version).toBe(24);
    expect(s.combat).toEqual({ enabled: false, nextRaid: 0, wave: 0 });
    expect(s.pawns.map((p) => [p.id, p.food, p.rest, p.worn])).toEqual(
      old.pawns.map((p: any) => [p.id, p.food, p.rest, p.worn]),
    );
    expect(s.pawns.every((p) => p.weapon === null && p.trauma.wounds.length === 0)).toBe(true);
  });
  it('requires drafting and spends travel/cooldown ticks before causing a real injury', () => {
    const s = fixture(),
      [attacker, target] = s.pawns;
    target.x = 18;
    expect(s.command({ type: 'attack', pawnId: attacker.id, targetId: target.id }).ok).toBe(false);
    command(s, { type: 'draft', pawnId: attacker.id, drafted: true });
    command(s, { type: 'attack', pawnId: attacker.id, targetId: target.id });
    s.step();
    expect(target.trauma.wounds.length).toBe(0);
    until(s, () => target.trauma.wounds.length > 0);
    expect(Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y)).toBe(1);
    const saved = s.save(),
      restored = VoxelSimulation.load(saved);
    expect(restored.pawns[1].trauma).toEqual(target.trauma);
    expect(restored.pawns[0].nextAttackTick).toBe(attacker.nextAttackTick);
    restored.step(10);
    s.step(10);
    expect(restored.pawns[1].trauma).toEqual(s.pawns[1].trauma);
    command(s, { type: 'draft', pawnId: attacker.id, drafted: false });
    const injuryCount = target.trauma.wounds.length;
    s.step(100);
    expect(target.trauma.wounds.length).toBe(injuryCount);
  });
  it('does not strike through vertical separation or an unreachable room', () => {
    const s = fixture(),
      [attacker, target] = s.pawns;
    target.z = 11;
    s.blocks[index(target.x, target.y, 10)] = Block.Wood;
    command(s, { type: 'draft', pawnId: attacker.id, drafted: true });
    expect(s.command({ type: 'attack', pawnId: attacker.id, targetId: target.id }).ok).toBe(false);
    s.step(80);
    expect(target.trauma.wounds).toHaveLength(0);
  });
  it('physically approaches and tends one injury per work cycle; stopping and reloading cannot heal instantly', () => {
    let s = fixture();
    const [doctor, patient] = s.pawns;
    applyInjury(patient.trauma, s.nextId++, 'torso', 'cut', 8);
    applyInjury(patient.trauma, s.nextId++, 'leftArm', 'cut', 7);
    doctor.x = 18;
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'tend' });
    s.step(1);
    expect(patient.trauma.wounds.every((w) => w.tendQuality === null)).toBe(true);
    until(s, () => doctor.careProgress > 70);
    const saved = s.save();
    s = VoxelSimulation.load(saved);
    expect(s.pawns[0].careProgress).toBe(saved.pawns[0].careProgress);
    until(s, () => s.pawns[1].trauma.wounds.filter((w) => w.tendQuality !== null).length === 1);
    expect(s.pawns[1].trauma.wounds).toHaveLength(2);
    expect(traumaSummary(s.pawns[1].trauma).bleedRate).toBeGreaterThan(0);
    until(s, () => s.pawns[1].trauma.wounds.every((w) => w.tendQuality !== null));
    expect(traumaSummary(s.pawns[1].trauma).bleedRate).toBe(0);
    expect(s.pawns[1].trauma.wounds.reduce((n, w) => n + w.severity, 0)).toBeGreaterThan(13);
    expect(s.counts()).toEqual(fixture().counts());
  });
  it('drafting the patient cancels treatment reservations without losing wounds or cargo', () => {
    const s = fixture(),
      [doctor, patient] = s.pawns;
    applyInjury(patient.trauma, s.nextId++, 'torso', 'cut', 6);
    command(s, { type: 'care', pawnId: doctor.id, patientId: patient.id, action: 'tend' });
    s.step(30);
    command(s, { type: 'draft', pawnId: patient.id, drafted: true });
    expect(doctor.patientId).toBeNull();
    expect(patient.trauma.wounds[0].tendQuality).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('persists opt-in storyteller checks without resetting the calendar when repeatedly enabled', () => {
    let s = fixture();
    command(s, { type: 'threats', enabled: true });
    const due = (Math.floor(s.tick / 200) + 1) * 200;
    expect(s.combat.nextRaid).toBe(due);
    s.step(100);
    command(s, { type: 'threats', enabled: true });
    s = VoxelSimulation.load(s.save());
    expect(s.combat.nextRaid).toBe(due);
    command(s, { type: 'threats', enabled: false });
    expect(s.combat.nextRaid).toBe(0);
    expect(s.pawns).toHaveLength(3);
  });
  it('rejects forged wounds, duplicate wound IDs, invalid attack references and non-finite raid times', () => {
    const s = fixture();
    applyInjury(s.pawns[0].trauma, s.nextId++, 'leftArm', 'bruise', 5);
    for (const mutate of [
      (v: any) => (v.pawns[0].trauma.wounds[0].severity = NaN),
      (v: any) => (v.pawns[0].trauma.wounds[0].id = v.pawns[1].id),
      (v: any) => (v.pawns[0].attackTargetId = 99999),
      (v: any) => (v.combat.nextRaid = Infinity),
    ]) {
      const save = s.save();
      mutate(save);
      expect(() => VoxelSimulation.load(save)).toThrow();
    }
  });
});
