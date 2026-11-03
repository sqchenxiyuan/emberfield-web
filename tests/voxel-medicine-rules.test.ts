import { describe, expect, it } from 'vitest';
import { DAY } from '../src/voxel/types';
import { initialTrauma, type Injury } from '../src/voxel/injuries';
import {
  initialMedical,
  advanceMedical,
  infectionCanTend,
  infectionTrialChance,
  infectionRoomFactor,
  immunityGainSpeed,
  tendMedical,
  medicineNeeded,
  trackInfectionRisks,
  type WoundInfection,
} from '../src/voxel/medicine';
import { healthSummary, healthDeathReason, initialSurvival } from '../src/voxel/survival';
import { freshBatch, advanceRot, validBatch } from '../src/voxel/preservation';
import { stackLimit } from '../src/voxel/logistics';

const wound = (id: number, severity: number, part: Injury['part'] = 'torso'): Injury => ({
  id,
  part,
  kind: 'cut',
  severity,
  ageTicks: 0,
  tendQuality: null,
});
const infection = (
  id = 70,
  severity = 0.1,
  part: WoundInfection['part'] = 'torso',
): WoundInfection => ({
  id,
  part,
  createdTick: 0,
  severity,
  immunityFactor: 1,
  tendQuality: null,
  tendUntil: 0,
});
const patient = () => ({ trauma: initialTrauma(), medical: initialMedical() });
const context = () => ({
  seed: 123,
  pawnId: 10,
  food: 100,
  rest: 100,
  resting: false,
  inBed: false,
  bloodFiltration: 1,
  allocId: () => 100,
});
const treatment = (medicine: boolean, tick = 100) => ({
  seed: 123,
  pawnId: 10,
  doctorId: 11,
  tick,
  doctorQuality: 1,
  medicine,
  roomFactor: 0.5,
});

describe('medicine and infection reference rules', () => {
  it('crush wounds can carry an infection risk, but bruises and solid parts cannot', () => {
    for (const [kind, part, state] of [
      ['crush', 'torso', 'pending'],
      ['bruise', 'torso', 'ineligible'],
      ['crush', 'skull', 'ineligible'],
    ] as const) {
      const p = patient();
      p.trauma.wounds = [{ ...wound(7, 5, part), kind }];
      trackInfectionRisks(p, 123, 10, 0);
      expect(p.medical.risks[0].state).toBe(state);
    }
  });
  it('a medicine batch skips oversized middle injuries and includes a later fitting one', () => {
    const p = patient();
    p.trauma.wounds = [wound(1, 12), wound(2, 9), wound(3, 8)];
    expect(medicineNeeded(p, 100)).toBe(2);
    const done = tendMedical(p, treatment(true))!;
    expect(done.recordIds).toEqual([1, 3]);
    expect(p.trauma.wounds[1].tendQuality).toBeNull();
    expect(done.qualities.every((q) => q >= 0.35 && q <= 0.7)).toBe(true);
    expect(done.qualities[0]).not.toBe(done.qualities[1]);
  });
  it('no medicine treats only one injury while a single injury exceeding 20 still qualifies', () => {
    const p = patient();
    p.trauma.wounds = [wound(1, 21), wound(2, 2)];
    expect(tendMedical(p, treatment(true))!.recordIds).toEqual([1]);
    expect(tendMedical(p, treatment(false))!.recordIds).toEqual([2]);
  });
  it('life-threatening infection takes precedence over small bleeds without consuming every infection in a batch', () => {
    const p = patient();
    p.trauma.wounds = [wound(1, 2)];
    p.medical.infections = [infection(70, 0.8), infection(71, 0.2, 'leftArm')];
    expect(tendMedical(p, treatment(true))!.recordIds).toEqual([70]);
    expect(p.medical.infections[1].tendQuality).toBeNull();
  });
  it('mild infection precedes a nonbleeding bruise despite the bruise having higher severity', () => {
    const p = patient();
    p.trauma.wounds = [{ ...wound(1, 10), kind: 'bruise' }];
    p.medical.infections = [infection(70, 0.1)];
    expect(tendMedical(p, treatment(true))!.recordIds).toEqual([70]);
    expect(p.trauma.wounds[0].tendQuality).toBeNull();
  });
  it('infection treatment permits strict overlap and adds the remaining treatment time', () => {
    const p = patient();
    p.medical.infections = [infection()];
    tendMedical(p, treatment(true, 100));
    expect(p.medical.infections[0].tendUntil).toBe(7600);
    expect(infectionCanTend(p.medical.infections[0], 0, 6100)).toBe(false);
    expect(infectionCanTend(p.medical.infections[0], 0, 6101)).toBe(true);
    tendMedical(p, treatment(true, 6101));
    expect(p.medical.infections[0].tendUntil).toBe(15100);
    expect(infectionCanTend(p.medical.infections[0], 1, 20000)).toBe(false);
  });
  it('secondary infection risk uses current severity, tending quality and the saved room factor', () => {
    const w = wound(1, 12);
    expect(infectionTrialChance(w, 0.5)).toBe(1);
    w.tendQuality = 0.7;
    expect(infectionTrialChance(w, 0.5)).toBeCloseTo(0.245);
    w.severity = 1;
    expect(infectionTrialChance(w, 0.5)).toBeCloseTo(0.0245);
    expect(infectionRoomFactor(-1)).toBeCloseTo(0.6);
    expect(infectionRoomFactor(0)).toBe(0.5);
    expect(infectionRoomFactor(1)).toBeCloseTo(0.2);
  });
  it('pending infection survives JSON roundtrip and resolves exactly once', () => {
    const p = patient();
    p.trauma.wounds = [wound(1, 12)];
    p.medical.risks = [{ woundId: 1, state: 'pending', checkAt: 500, roll: 0.1, roomFactor: 1 }];
    const loaded = JSON.parse(JSON.stringify(p));
    advanceMedical(p, 499, context());
    advanceMedical(loaded, 499, context());
    expect(p.medical.infections).toHaveLength(0);
    advanceMedical(p, 500, context());
    advanceMedical(loaded, 500, context());
    expect(p).toEqual(loaded);
    expect(p.medical.infections).toHaveLength(1);
    advanceMedical(p, 501, context());
    expect(p.medical.infections).toHaveLength(1);
  });
  it('existing immunity blocks a new infection near sixty percent; it is not multiplied into a probabilistic trial', () => {
    const p = patient();
    p.trauma.wounds = [wound(1, 12)];
    p.medical.risks = [{ woundId: 1, state: 'pending', checkAt: 500, roll: 0, roomFactor: 1 }];
    p.medical.immunity = 0.6;
    advanceMedical(p, 500, context());
    expect(p.medical.infections).toHaveLength(0);
    expect(p.medical.risks[0].state).toBe('failed');
  });
  it('immunity is shared and grows once with the first surviving infection factor', () => {
    const one = patient(),
      two = patient();
    one.medical.infections = [infection()];
    two.medical.infections = [
      infection(),
      { ...infection(71, 0.1, 'leftArm'), immunityFactor: 1.2 },
    ];
    advanceMedical(one, 1, context());
    advanceMedical(two, 1, context());
    expect(one.medical.immunity).toBeCloseTo(0.6441 / DAY, 12);
    expect(two.medical.immunity).toBe(one.medical.immunity);
  });
  it('healing the source wound does not cure an existing infection', () => {
    const p = patient();
    p.medical.infections = [infection()];
    advanceMedical(p, 1, context());
    expect(p.medical.infections).toHaveLength(1);
    expect(p.medical.infections[0].severity).toBeCloseTo(0.1 + 0.84 / DAY);
  });
  it('immunity recovery and residual immunity decay use separate rates', () => {
    const p = patient();
    p.medical.infections = [{ ...infection(), tendQuality: 0.5, tendUntil: 1000 }];
    p.medical.immunity = 1;
    advanceMedical(p, 1, context());
    expect(p.medical.infections[0].severity).toBeCloseTo(0.1 - (0.7 + 0.53 * 0.5) / DAY);
    p.medical.infections = [];
    advanceMedical(p, 2, context());
    expect(p.medical.immunity).toBeCloseTo(1 - 0.4 / DAY);
  });
  it('starts residual immunity decay on the update that removes the last healed infection', () => {
    const p = patient();
    p.medical.immunity = 1;
    p.medical.infections = [infection(70, 0.00001)];
    advanceMedical(p, 1, context());
    expect(p.medical.infections).toEqual([]);
    expect(p.medical.immunity).toBeCloseTo(1 - 0.4 / DAY, 12);
  });
  it('repeated real treatment batches allow a controlled infection to reach immunity and clear, while no care can be lethal', () => {
    const treated = patient(),
      untreated = patient();
    for (const p of [treated, untreated]) p.medical.infections = [infection(70, 0.001)];
    const bedContext = { ...context(), resting: true, inBed: true };
    let treatments = 0,
      immuneSeen = false;
    for (let tick = 1; tick <= DAY * 3; tick++) {
      if (
        treated.medical.infections.some((i) => infectionCanTend(i, treated.medical.immunity, tick))
      ) {
        expect(tendMedical(treated, treatment(true, tick))).not.toBeNull();
        treatments++;
      }
      advanceMedical(treated, tick, bedContext);
      immuneSeen ||= treated.medical.immunity === 1;
      if (untreated.medical.infections[0].severity < 1) advanceMedical(untreated, tick, bedContext);
    }
    expect(treatments).toBeGreaterThan(1);
    expect(immuneSeen).toBe(true);
    expect(treated.medical.infections).toEqual([]);
    expect(treated.medical.immunity).toBeLessThan(1);
    expect(untreated.medical.infections[0].severity).toBe(1);
    expect(untreated.medical.immunity).toBeLessThan(1);
  });
  it('starvation, exhaustion, blood filtration and resting affect actual immunity gain', () => {
    expect(immunityGainSpeed(context())).toBe(1);
    expect(
      immunityGainSpeed({
        ...context(),
        food: 0,
        rest: 0,
        bloodFiltration: 0.5,
        resting: true,
        inBed: true,
      }),
    ).toBeCloseTo(0.7 * 0.8 * 0.75 * 1.1 * 1.07);
    expect(immunityGainSpeed({ ...context(), food: 12, rest: 28 })).toBe(1);
  });
  it('lethal severity is evaluated before reaching immunity in the same update', () => {
    const p = patient();
    p.medical.immunity = 0.99999;
    p.medical.infections = [infection(70, 0.99999)];
    advanceMedical(p, 1, context());
    expect(p.medical.infections[0].severity).toBe(1);
    expect(p.medical.immunity).toBe(0.99999);
    const h = initialSurvival(1, 1);
    expect(healthDeathReason(h.health, p.trauma, p.medical)).toBe('伤口感染致死');
  });
  it('extreme infection changes pain, consciousness and breathing in the existing body model', () => {
    const p = initialSurvival(1, 1);
    p.medical.infections = [infection(70, 0.87)];
    const h = healthSummary(p);
    expect(h.pain).toBe(0.85);
    expect(h.consciousness).toBe(0.1);
    expect(h.breathing).toBe(0.95);
  });
  it('infection can exhaust breathing already reduced by airway damage', () => {
    const p = initialSurvival(1, 1);
    p.trauma.wounds = [{ ...wound(1, 22, 'neck'), kind: 'bruise' }];
    expect(healthSummary(p).breathing).toBe(0.02);
    expect(healthDeathReason(p.health, p.trauma, p.medical)).toBeNull();
    p.medical.infections = [infection(70, 0.87)];
    expect(healthSummary(p).breathing).toBe(0);
    expect(healthDeathReason(p.health, p.trauma, p.medical)).toBe('呼吸功能丧失致死');
  });
  it('herbs are bounded perishable medicine and are not grain with a food crop tag', () => {
    const b = freshBatch('herb', 25);
    expect(stackLimit('herb')).toBe(25);
    expect(validBatch(b)).toBe(true);
    expect(validBatch({ ...b, crop: 'rice' })).toBe(false);
    advanceRot(b, -5, DAY * 200);
    expect(b.rotProgress).toBe(0);
    expect(advanceRot(b, 21, DAY * 150 - 1)).toBe(false);
    expect(advanceRot(b, 21, 1)).toBe(true);
  });
});
