import { describe, expect, it } from 'vitest';
import { DAY } from '../src/voxel/types';
import { applySocialInteraction, appendSocialEvent, initialSocial, interactionWeights, opinionBreakdown,
  opinionOf, pruneSocial, pruneSocialHistory, rememberDeparture, resolveSocialIdentity, selectInteraction,
  socialMemoryView, socialRandom, socialThoughts, SOCIAL_RULES, type SocialEvent, type SocialIdentity,
  type SocialPerson } from '../src/voxel/social';

const person = (id: number): SocialPerson => ({ id, name: '人物' + id, faction: 'colony', dead: false, social: initialSocial(0, id) });

describe('directional social memories', () => {
  it('positive interaction changes opinions, preserves the other identity and earns no automatic mood bonus', () => {
    const a = person(1), b = person(2);
    applySocialInteraction(a, b, 'deepTalk', 20, { initiatorImpact: 2, recipientImpact: .5 });
    expect(opinionOf(a.social, b.id, 20)).toBe(8); // Native ties-to-even group rounding.
    expect(opinionOf(b.social, a.id, 20)).toBe(30);
    expect(opinionOf(a.social, 3, 20)).toBe(0);
    expect(socialThoughts(a.social, 20)).toEqual([]); expect(socialThoughts(b.social, 20)).toEqual([]);
    expect(a.social.memories[0].amount).toBe(7.5); expect(b.social.memories[0].amount).toBe(30);
    expect(a.social.lastInteractionTick).toBe(20); expect(b.social.lastInteractionTick).toBe(20);
  });
  it('insults have directional resentment and an independently expiring, unscaled mood memory', () => {
    const a = person(1), b = person(2);
    applySocialInteraction(a, b, 'insult', 100, { initiatorImpact: 2, recipientImpact: .5 });
    expect(a.social.memories).toEqual([]); expect(opinionOf(b.social, a.id, 100)).toBe(-30);
    expect(socialThoughts(b.social, 100)).toEqual([{ otherId: a.id, label: '受到侮辱', value: -5 }]);
    pruneSocial(b.social, 100 + 2 * DAY);
    expect(socialThoughts(b.social, 100 + 2 * DAY)).toEqual([]);
    expect(opinionOf(b.social, a.id, 100 + 2 * DAY)).toBe(-30);
    pruneSocial(b.social, 100 + 20 * DAY); expect(b.social.memories).toEqual([]);
  });
  it('chitchat accumulates beyond its displayed cap without renewing its daily decay clock', () => {
    const a = person(1), b = person(2);
    for (let i = 0; i < 20; i++) applySocialInteraction(a, b, 'chitchat', i * 100);
    expect(a.social.memories).toHaveLength(1);
    const memory = a.social.memories[0]; expect(memory.kind).toBe('chitchat');
    if (memory.kind !== 'chitchat') throw new Error('wrong memory');
    expect(memory.amount).toBeCloseTo(13.2); expect(memory.nextDecayTick).toBe(DAY); expect(memory.createdTick).toBe(0);
    expect(opinionOf(a.social, b.id, 2000)).toBe(10);
    const untouched = structuredClone(a.social);
    expect(socialMemoryView(a.social, DAY)[0].value).toBe(10); expect(a.social).toEqual(untouched);
    pruneSocial(a.social, DAY); expect(a.social.memories[0].amount).toBeCloseTo(12.2);
    expect(socialMemoryView(a.social, DAY)[0].expires).toBe(14 * DAY);
    expect(opinionOf(a.social, b.id, 13 * DAY)).toBe(1);
    pruneSocial(a.social, 14 * DAY); expect(a.social.memories).toEqual([]);
  });
  it('normal opinions remain full for fourteen days and fade linearly over the final six', () => {
    const a = person(1), b = person(2); applySocialInteraction(a, b, 'deepTalk', 0);
    expect(opinionOf(a.social, b.id, 14 * DAY)).toBe(15);
    expect(socialMemoryView(a.social, 17 * DAY)[0].value).toBeCloseTo(7.5);
    expect(opinionOf(a.social, b.id, 17 * DAY)).toBe(8);
    expect(opinionOf(a.social, b.id, 20 * DAY - 1)).toBe(1);
    expect(socialMemoryView(a.social, 20 * DAY)).toEqual([]);
  });
  it('stacks each opinion kind and person from newest to oldest before rounding the group', () => {
    const a = person(1), b = person(2), c = person(3);
    applySocialInteraction(a, b, 'deepTalk', 0);
    applySocialInteraction(a, b, 'deepTalk', 15 * DAY, { initiatorImpact: 1, recipientImpact: 2 });
    applySocialInteraction(a, c, 'deepTalk', 15 * DAY);
    const view = socialMemoryView(a.social, 15 * DAY, b.id);
    expect(view[0].value).toBe(30); expect(view[1].value).toBeCloseTo(11.25);
    expect(opinionBreakdown(a.social, b.id, 15 * DAY)).toEqual([{ kind: 'deepTalk', label: '深入交谈', count: 2, value: 41 }]);
    expect(opinionOf(a.social, c.id, 15 * DAY)).toBe(15);
  });
  it('drops the oldest same-person opinion and shares ten insult-mood slots across actual perpetrators', () => {
    const target = person(1), friend = person(100);
    for (let i = 0; i < 11; i++) applySocialInteraction(target, friend, 'deepTalk', i);
    expect(target.social.memories).toHaveLength(10);
    expect(target.social.memories.map(m => m.createdTick)).not.toContain(0);
    const actors = Array.from({ length: 11 }, (_, i) => person(i + 2));
    for (const [i, actor] of actors.entries()) applySocialInteraction(actor, target, 'insult', 100 + i);
    const moods = socialMemoryView(target.social, 110).filter(m => m.effect === 'mood');
    expect(moods).toHaveLength(10); expect(moods.some(m => m.otherId === actors[0].id)).toBe(false);
    expect(moods[0].otherId).toBe(actors[10].id); expect(moods[0].value).toBe(-5);
    expect(moods.reduce((sum, m) => sum + m.value, 0)).toBeCloseTo(-5 * (1 - .9 ** 10) / (1 - .9));
  });
  it('bounds total memory storage deterministically without losing identity on recruitment', () => {
    const a = person(1); a.faction = 'prisoner';
    for (let i = 0; i < 90; i++) applySocialInteraction(a, person(100 + i), 'deepTalk', i);
    expect(a.social.memories).toHaveLength(SOCIAL_RULES.maxMemories);
    expect(a.social.memories[0].otherId).toBe(126);
    const state = structuredClone(a.social); a.faction = 'colony';
    expect(a.social).toEqual(state); expect(a.id).toBe(1);
  });
});

describe('social selection and persistent identity', () => {
  it('uses native opinion/compatibility weights and deterministic keyed draws', () => {
    const neutral = interactionWeights({ opinion: 0, compatibility: 0 });
    expect(neutral.chitchat).toBe(1); expect(neutral.deepTalk).toBeCloseTo(.04125); expect(neutral.insult).toBeCloseTo(.0105);
    expect(interactionWeights({ opinion: -100 }).insult).toBeCloseTo(neutral.insult * 6);
    expect(interactionWeights({ opinion: 100 }).insult).toBe(0);
    expect(interactionWeights({ opinion: 0, compatibility: -1.5 }).deepTalk).toBe(0);
    expect(selectInteraction(neutral, 0)).toBe('chitchat'); expect(selectInteraction(neutral, .99999)).toBe('insult');
    const values = Array.from({ length: 100 }, (_, i) => socialRandom(7, 42, i, 3));
    expect(values).toEqual(Array.from({ length: 100 }, (_, i) => socialRandom(7, 42, i, 3)));
    expect(new Set(values).size).toBe(100); expect(values.every(v => v >= 0 && v < 1)).toBe(true);
    expect(socialRandom(7, 42, 0, 4)).not.toBe(values[0]);
    expect(() => selectInteraction({ chitchat: 0, deepTalk: 0, insult: 0 }, 0)).toThrow();
  });
  it('retains named departed sources until both memories and bounded events release them', () => {
    const a = person(1), b = person(2), history: SocialIdentity[] = [], events: SocialEvent[] = [];
    applySocialInteraction(b, a, 'insult', 0);
    appendSocialEvent(events, { tick: 0, kind: 'insult', initiatorId: b.id, recipientId: a.id });
    rememberDeparture(history, b, 10, [a, b], events);
    expect(history).toEqual([{ pawnId: 2, name: '人物2', faction: 'colony', departedTick: 10, dead: false }]);
    expect(resolveSocialIdentity(2, [a], history)?.departed).toBe(true);
    pruneSocial(a.social, 21 * DAY); pruneSocialHistory(history, [a], events); expect(history).toHaveLength(1);
    events.length = 0; pruneSocialHistory(history, [a], events); expect(history).toEqual([]);
    expect(resolveSocialIdentity(2, [a], history)).toBeNull();
  });
  it('keeps dead on-map identities authoritative and never copies social state into a fresh person', () => {
    const a = person(1), b = person(2); applySocialInteraction(a, b, 'deepTalk', 0); b.dead = true;
    const identity = resolveSocialIdentity(2, [a, b], []); expect(identity?.dead).toBe(true); expect(identity?.departed).toBe(false);
    expect(opinionOf(a.social, b.id, DAY)).toBe(15);
    const visitor = { ...structuredClone(a), id: 3, social: initialSocial(50, 3) };
    expect(visitor.social.memories).toEqual([]); expect(visitor.social).not.toBe(a.social);
  });
  it('keeps only bounded real event receipts and rejects duplicates or time reversal', () => {
    const events: SocialEvent[] = [];
    for (let tick = 0; tick < 80; tick++) appendSocialEvent(events, { tick, kind: 'chitchat', initiatorId: 1, recipientId: 2 });
    expect(events).toHaveLength(64); expect(events[0].tick).toBe(16);
    const before = structuredClone(events);
    expect(() => appendSocialEvent(events, events[events.length - 1])).toThrow(); expect(events).toEqual(before);
    expect(() => appendSocialEvent(events, { tick: 20, kind: 'insult', initiatorId: 2, recipientId: 1 })).toThrow();
  });
  it('rejects invalid events before mutating either participant', () => {
    const a = person(1), b = person(2); const before = structuredClone([a, b]);
    expect(() => applySocialInteraction(a, b, 'deepTalk', 0, { initiatorImpact: NaN, recipientImpact: 1 })).toThrow();
    expect([a, b]).toEqual(before); expect(() => applySocialInteraction(a, a, 'chitchat', 0)).toThrow();
    expect([a, b]).toEqual(before);
  });
});
