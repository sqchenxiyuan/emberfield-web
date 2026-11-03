import { describe, expect, it } from 'vitest';
import { initialPrisoner, interactionOutcome, prisonTalkSpeed, PRISON_RULES,
  validPrisonerState, validWardenTask, type PrisonInteractionFactors } from '../src/voxel/prisoners';

const healthy: PrisonInteractionFactors = { social: 8, talking: 1, hearing: 1,
  inmateConsciousness: 1, inmateHearing: 1, inmateTalking: 1, inmatePain: 0, food: 100, rest: 100, mood: 100 };
describe('bounded provisional prisoner rules', () => {
  it('starts with separate maintain-only records and validates clocks', () => {
    const a = initialPrisoner(100, 20), b = initialPrisoner(100, 21);
    expect(a).toMatchObject({ resistance: 24, policy: 'maintain', nextInteractionTick: 100, capturedTick: 100, releasing: false });
    a.resistance = 0; expect(b.resistance).toBe(24);
    expect(validPrisonerState(a, 100)).toBe(true);
    expect(() => initialPrisoner(-1)).toThrow(RangeError);
    expect(() => initialPrisoner(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
  it('finishes resistance reduction without recruiting; a later full recruit interaction can succeed', () => {
    const p = initialPrisoner(0); p.policy = 'recruit'; p.resistance = .2;
    const reduced = interactionOutcome(p, healthy);
    expect(reduced).toEqual({ kind: 'reduce', resistance: 0, reduction: .2 });
    expect(p.resistance).toBe(.2);
    p.resistance = reduced.resistance;
    expect(interactionOutcome(p, healthy).kind).toBe('recruit');
    p.policy = 'reduceResistance'; expect(interactionOutcome(p, healthy).kind).toBe('none');
  });
  it('responds to social skill, communication capacity and actual inmate condition', () => {
    const p = initialPrisoner(0); p.policy = 'recruit';
    const reduction = (f: Partial<PrisonInteractionFactors>) => interactionOutcome(p, { ...healthy, ...f }).reduction;
    expect(reduction({ social: 15 })).toBeGreaterThan(reduction({ social: 1 }));
    expect(reduction({ talking: .5 })).toBeLessThan(reduction({}));
    expect(reduction({ food: 10, rest: 10, mood: 10, inmatePain: .5 })).toBeLessThan(reduction({}));
    for (const f of [{ talking: 0 }, { hearing: 0 }, { inmateHearing: 0 }, { inmateTalking: 0 }, { inmateConsciousness: .2 }])
      expect(interactionOutcome(p, { ...healthy, ...f }).kind).toBe('none');
    expect(prisonTalkSpeed(.5, 1)).toBe(.5);
    expect(() => prisonTalkSpeed(NaN, 1)).toThrow(RangeError);
  });
  it('rejects extra fields, invalid progress, impossible release state and unbounded future deadlines', () => {
    const p = initialPrisoner(100, 20);
    for (const changed of [{ resistance: NaN }, { resistance: 101 }, { recruitProgress: 0 },
      { capturedTick: 101 }, { nextInteractionTick: 100 + PRISON_RULES.interactionInterval + 1 },
      { nextInteractionTick: 99 }, { releasing: true }, { policy: 'unknown' }])
      expect(validPrisonerState({ ...p, ...changed }, 100), JSON.stringify(changed)).toBe(false);
    const task = { prisonerId: 3, bedId: null, stage: 'talk', progress: 42 };
    expect(validWardenTask(task)).toBe(true);
    for (const changed of [{ stage: 'captureCarry' }, { progress: -1 }, { progress: Infinity },
      { progress: PRISON_RULES.talkWork + 1 }, { bedId: 20 }, { extra: 1 }])
      expect(validWardenTask({ ...task, ...changed })).toBe(false);
  });
});
