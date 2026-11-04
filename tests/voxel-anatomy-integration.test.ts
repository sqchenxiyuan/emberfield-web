import { withMedicineLedgers } from './legacy-medicine-defaults';
import { eggsExpectedField } from './legacy-auto-rebuild-defaults';
import { stripRangedDefaults } from './legacy-ranged-defaults';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, index, type Pos, type VoxelCommand } from '../src/voxel/types';
import { applyInjury, needsTending, traumaIds, traumaSummary } from '../src/voxel/injuries';
import { BODY_PARTS, isPartMissing, partHealth, type BodyPartId } from '../src/voxel/anatomy';
import { healthSummary, legacyHealthState } from '../src/voxel/survival';
import { makeWeapon } from '../src/voxel/weapons';
import { initialSkills } from '../src/voxel/skills';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
// Controlled geometry and explicit wounds isolate integration boundaries. Ordinary
// raid behavior is separately exercised by voxel-anatomy-campaign-verify.mjs.
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let x = 10; x <= 30; x++)
    for (let y = 10; y <= 30; y++) {
      s.blocks[index(x, y, 7)] = Block.Soil;
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
    }
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i));
    p.schedule.fill('work');
    for (const k of Object.keys(p.priorities)) p.priorities[k as keyof typeof p.priorities] = 0;
  });
  return VoxelSimulation.load(s.save());
}
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c);
  expect(r.ok, r.message).toBe(true);
}
function until(s: VoxelSimulation, done: () => boolean, max = 3000) {
  for (let i = 0; i < max && !done(); i++) s.step();
  expect(done(), JSON.stringify(s.pawns.map((p) => ({ id: p.id, reason: p.reason })))).toBe(true);
}
function lose(s: VoxelSimulation, pawn: number, part: BodyPartId) {
  applyInjury(s.pawns[pawn].trauma, s.nextId++, part, 'cut', BODY_PARTS[part].hitPoints + 1);
}
function oldFixture() {
  const old: any = fixture().save();
  stripRangedDefaults(old);  old.version = 15;
  delete old.research.progress.PlateArmor;
  for (const bench of old.weaponBenches) delete bench.armorBills;
  for (const p of old.pawns) p.trauma = { wounds: [], bloodLoss: 0, brokenParts: [] };
  return old;
}

describe('anatomy integration with work, physical treatment and save migration', () => {
  it.each(['trauma', 'research'])(
    'migrates authentic v15 %s bytes while preserving physical state and injury records',
    (name) => {
      const bytes = readFileSync(new URL(`./fixtures/voxel-v15-${name}.json`, import.meta.url));
      const provenance = JSON.parse(
        readFileSync(
          new URL(`./fixtures/voxel-v15-${name}.provenance.json`, import.meta.url),
          'utf8',
        ),
      );
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
      const old = JSON.parse(bytes.toString()),
        before = structuredClone(old);
      expect(old.version).toBe(15);
      const s = VoxelSimulation.load(old),
        save = s.save();
      expect(old).toEqual(before);
      expect(save.version).toBe(52);
      expect(s.tick).toBe(old.tick);
      for (const key of ['blocks', 'items', 'researchBenches', 'stats'] as const)
        expect(save[key]).toEqual(key === 'stats' ? eggsExpectedField('stats', withMedicineLedgers(old.stats)) : old[key]);
      expect(save.research).toEqual({
        ...old.research,
        progress: { ...old.research.progress, PlateArmor: 0, Machining: 0, Gunsmithing: 0, BlowbackOperation: 0 },
      });
      expect(save.weaponBenches).toEqual(
        old.weaponBenches.map((b: any) => ({
          ...b,
          bills: [...b.bills, { kind: 'shortBow', target: 0, paused: false }],
          armorBills:
            b.kind === 'smithy'
              ? ['simpleHelmet', 'plateArmor'].map((kind) => ({ kind, target: 0, paused: false }))
              : [],
        })),
      );
      for (const [i, p] of save.pawns.entries()) {
        const prior = old.pawns.find((q: any) => q.id === p.id);
        for (const key of ['food', 'rest', 'worn', 'weapon', 'cargo', 'skills', 'health'] as const)
          expect(p[key]).toEqual(key === 'skills' ? {
            ...prior.skills,
            shooting: initialSkills(i, p.faction !== 'colony').shooting,
            social: initialSkills(i, p.faction !== 'colony').social,
            animals: initialSkills(i, p.faction !== 'colony').animals,
          } : prior[key]);
        const retained = [
          ...p.trauma.wounds,
          ...p.trauma.missingParts.flatMap((m) => m.legacyWounds),
        ].sort((a, b) => a.id - b.id);
        expect(retained).toEqual([...prior.trauma.wounds].sort((a, b) => a.id - b.id));
        expect(p.trauma.bloodLoss).toBe(prior.trauma.bloodLoss);
      }
      expect(s.notice).toContain('身体能力按新规则重算');
      expect(() => VoxelSimulation.load(save)).not.toThrow();
    },
  );

  it('preserves irreversible old loss and archived IDs without renewing stump bleeding', () => {
    const old = oldFixture(),
      p = old.pawns[0];
    const wound = {
      id: old.nextId++,
      part: 'rightArm',
      kind: 'cut',
      severity: 30,
      ageTicks: 0,
      tendQuality: null,
    };
    p.trauma = { wounds: [wound], bloodLoss: 0.1, brokenParts: ['rightArm'] };
    const state = legacyHealthState(p.health, p.trauma);
    Object.assign(p, { dead: state.dead, downed: state.downed, deathReason: state.deathReason });
    const s = VoxelSimulation.load(old),
      t = s.pawns[0].trauma;
    expect(t.wounds).toEqual([]);
    expect(t.missingParts).toHaveLength(1);
    expect(t.missingParts[0].legacyWounds).toEqual([wound]);
    expect(t.missingParts[0].isFresh).toBe(false);
    expect(isPartMissing(t, 'rightIndexFinger')).toBe(true);
    expect(needsTending(t)).toBe(false);
    expect(traumaSummary(t).bleedRate).toBe(0);
    const bad = s.save();
    bad.pawns[0].trauma.missingParts[0].legacyWounds[0].id = bad.pawns[1].id;
    expect(() => VoxelSimulation.load(bad)).toThrow();
  });

  it('does not amputate a legacy healable 29.8/30 arm injury rounded to zero HP', () => {
    const old = oldFixture(),
      p = old.pawns[0];
    p.trauma.wounds.push({
      id: old.nextId++,
      part: 'leftArm',
      kind: 'bruise',
      severity: 29.8,
      ageTicks: 0,
      tendQuality: 0.7,
    });
    const s = VoxelSimulation.load(old),
      arm = s.pawns[0].trauma;
    expect(partHealth(arm, 'leftArm')).toBe(0);
    expect(isPartMissing(arm, 'leftArm')).toBe(false);
    const original = structuredClone(arm.wounds[0]);
    expect(original).toEqual(p.trauma.wounds[0]);
    s.step(600);
    expect(arm.wounds[0].severity).toBeLessThan(original.severity);
    expect(partHealth(arm, 'leftArm')).toBeGreaterThan(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('validates old health flags before migration and new anatomy invariants after it', () => {
    const old = oldFixture();
    old.pawns[0].downed = true;
    old.pawns[0].phase = 'downed';
    expect(() => VoxelSimulation.load(old)).toThrow();
    const s = fixture();
    lose(s, 0, 'leftHand');
    s.step();
    const saved = s.save();
    const original = structuredClone(saved);
    for (const mutate of [
      (v: any) =>
        v.pawns[0].trauma.missingParts.push({
          ...v.pawns[0].trauma.missingParts[0],
          id: v.nextId++,
          part: 'leftThumb',
        }),
      (v: any) =>
        v.pawns[0].trauma.wounds.push({
          id: v.nextId++,
          part: 'leftThumb',
          kind: 'cut',
          severity: 1,
          ageTicks: 0,
          tendQuality: null,
        }),
      (v: any) => (v.pawns[0].trauma.missingParts[0].id = v.pawns[1].id),
      (v: any) => (v.pawns[0].trauma.missingParts[0].part = '__proto__'),
    ]) {
      const bad = structuredClone(saved);
      mutate(bad);
      expect(() => VoxelSimulation.load(bad)).toThrow();
    }
    expect(saved).toEqual(original);
  });

  it('routes fresh stump through travel and timed tending, survives reload and never regrows', () => {
    let s = fixture();
    lose(s, 1, 'leftHand');
    s.step();
    const patientId = s.pawns[1].id,
      doctorId = s.pawns[0].id;
    command(s, { type: 'care', pawnId: doctorId, patientId, action: 'tend' });
    until(s, () => s.pawns[0].careProgress > 60);
    const before = s.save();
    s = VoxelSimulation.load(before);
    expect(s.pawns[0].careProgress).toBe(before.pawns[0].careProgress);
    expect(needsTending(s.pawns[1].trauma)).toBe(true);
    until(s, () => !needsTending(s.pawns[1].trauma));
    const missing = s.pawns[1].trauma.missingParts[0];
    expect(missing.tendQuality).not.toBeNull();
    expect(missing.isFresh).toBe(false);
    expect(traumaSummary(s.pawns[1].trauma).bleedRate).toBe(0);
    s.step(1000);
    expect(isPartMissing(s.pawns[1].trauma, 'leftHand')).toBe(true);
    expect(isPartMissing(s.pawns[1].trauma, 'leftThumb')).toBe(true);
    expect(s.pawns[1].trauma.missingParts[0].id).toBe(missing.id);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('rejects persisted care reservations held by a standing doctor with no usable hands', () => {
    const s = fixture();
    applyInjury(s.pawns[1].trauma, s.nextId++, 'leftArm', 'cut', 4);
    command(s, { type: 'care', pawnId: s.pawns[0].id, patientId: s.pawns[1].id, action: 'tend' });
    until(s, () => s.pawns[0].careProgress > 0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    // Deliberately forged state skips runtime reconciliation. The loader must
    // reject it immediately rather than letting a reserved patient wait a tick.
    lose(s, 0, 'leftHand');
    lose(s, 0, 'rightHand');
    expect(s.pawns[0].downed).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).toThrow();
    s.step();
    expect(s.pawns[0].patientId).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('interrupts research and drops the same equipped weapon when both hands fail', () => {
    let s = fixture();
    s.researchBenches.push({ id: s.nextId++, ...pos(16, 16), axis: 'x' });
    s = VoxelSimulation.load(s.save());
    const p = s.pawns[0];
    p.priorities.research = 1;
    p.weapon = makeWeapon(s.nextId++, 'steelKnife');
    const weapon = structuredClone(p.weapon);
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.research.progress.Batteries > 0);
    const progress = s.research.progress.Batteries;
    lose(s, 0, 'leftHand');
    lose(s, 0, 'rightHand');
    s.step();
    expect(healthSummary(p).manipulation).toBe(0);
    expect(p.dead).toBe(false);
    expect(p.jobId).toBeNull();
    expect(p.weapon).toBeNull();
    expect(s.items.find((i) => i.weapon?.id === weapon.id)?.weapon).toEqual(weapon);
    expect(s.research.progress.Batteries).toBe(progress);
    expect(
      s.command({ type: 'care', pawnId: p.id, patientId: s.pawns[1].id, action: 'tend' }).ok,
    ).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it.each(['leftEye', 'bothEyes'] as const)(
    'keeps %s research eligible and applies actual vision to earned points',
    (loss) => {
      let s = fixture();
      s.researchBenches.push({ id: s.nextId++, ...pos(16, 16), axis: 'x' });
      s = VoxelSimulation.load(s.save());
      const p = s.pawns[0];
      p.priorities.research = 1;
      p.skills.intellectual.level = 8;
      lose(s, 0, 'leftEye');
      if (loss === 'bothEyes') lose(s, 0, 'rightEye');
      for (const m of p.trauma.missingParts) m.isFresh = false;
      command(s, { type: 'research', project: 'Batteries' });
      until(s, () => s.research.progress.Batteries > 0);
      expect(healthSummary(p).sight).toBe(loss === 'leftEye' ? 0.75 : 0);
      expect(healthSummary(p).manipulation).toBe(1);
      const before = s.research.progress.Batteries;
      const benchFactor = s.researchBenchFactor(s.researchBenches[0]);
      s.step();
      // Intellectual 8 => 1; natural vision factor = .5 + .5 * Sight.
      expect(s.research.progress.Batteries - before).toBeCloseTo(
        0.02475 * benchFactor * (loss === 'leftEye' ? 0.875 : 0.5),
        12,
      );
      expect(p.skills.intellectual.xp).toBeGreaterThan(0);
    },
  );

  it('ordinary knife attacks produce full-tree injuries and deterministic combat after reload', () => {
    const a = fixture(),
      [attacker, target] = a.pawns;
    attacker.weapon = makeWeapon(a.nextId++, 'steelKnife');
    command(a, { type: 'draft', pawnId: attacker.id, drafted: true });
    command(a, { type: 'attack', pawnId: attacker.id, targetId: target.id });
    until(a, () => traumaIds(target.trauma).length > 0);
    const b = VoxelSimulation.load(a.save());
    for (let i = 0; i < 120; i++) {
      a.step();
      b.step();
    }
    expect(b.pawns.map((p) => [p.trauma, p.dead, p.downed, p.weapon])).toEqual(
      a.pawns.map((p) => [p.trauma, p.dead, p.downed, p.weapon]),
    );
    expect(a.pawns[1].trauma.wounds.every((w) => Object.hasOwn(BODY_PARTS, w.part))).toBe(true);
    expect(a.nextId).toBe(b.nextId);
  });
});
