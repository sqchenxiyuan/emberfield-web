import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applySocialInteraction, initialSocial, pruneSocial, rememberDeparture, SOCIAL_RULES } from '../src/voxel/social';
import { migrateSocial, rejectLegacySocialFields, validateSocial } from '../src/voxel/socialPersistence';
import { DAY } from '../src/voxel/types';

const hashes = {
  'carrying-meal': 'c49d2a6d1a6d14c884abe5c5c799b6ff06644081154a0f7728b82e84ba0276da',
  'seated-meal': 'f8e7a38e4860fb806b524c8d2429ad0811e32e41cdf73248539e77c273fbf01b',
};
function legacy(name: keyof typeof hashes = 'carrying-meal') {
  const bytes = readFileSync(new URL(`./fixtures/voxel-v31-social-${name}.json`, import.meta.url));
  const proof = JSON.parse(readFileSync(new URL(`./fixtures/voxel-v31-social-${name}.provenance.json`, import.meta.url), 'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(hashes[name]);
  expect(proof.sha256).toBe(hashes[name]);
  expect(proof.campaignExecution.bundleSha256).toBe('ea3efd80e5f4af85f451a589b206e24fb381b4dc9def5ed92d2dd54d8b6689b5');
  expect(proof.campaignExecution.sourceManifestSha256).toBe('87fc7b6b41aa5b67012b8ee0f47dffd8cbe856d0f108318381c3023f9c0cc830');
  const d = JSON.parse(bytes.toString('utf8')); expect(d.version).toBe(31); return d;
}
function current() { const d = legacy(); migrateSocial(d, 31); d.version = 32; return d; }
function remembered() {
  const d = current(), p = d.pawns[0], other = d.pawns[1];
  p.social.lastInteractionTick = d.tick;
  p.social.memories.push({ kind: 'deepTalk', otherId: other.id, createdTick: d.tick, expires: d.tick + 20 * DAY, amount: 15 });
  d.socialLog.push({ tick: d.tick, kind: 'deepTalk', initiatorId: p.id, recipientId: other.id });
  return { d, p, other, memory: p.social.memories[0] };
}

describe('authentic v31 social migration', () => {
  it.each(['carrying-meal', 'seated-meal'] as const)('preserves every %s field while adding isolated social defaults', name => {
    const d = legacy(name), original = structuredClone(d); rejectLegacySocialFields(d); migrateSocial(d, 31);
    expect(() => validateSocial(d)).not.toThrow();
    const restored = structuredClone(d); delete restored.socialHistory; delete restored.socialLog;
    for (const p of restored.pawns) {
      expect(p.social).toEqual(initialSocial(d.tick, p.id)); delete p.social;
      expect(p.psyche.tolerance.social).toBe(0); delete p.psyche.tolerance.social;
    }
    for (const table of restored.tables) { expect(table.gathering).toBe(true); delete table.gathering; }
    expect(restored).toEqual(original);
    expect(d.pawns.some((p: any) => p.living.mealTask?.stage === (name === 'carrying-meal' ? 'travel' : 'chew'))).toBe(true);
  });
  it('rejects forged modern state before migration and leaves malformed inputs unchanged', () => {
    for (const mutate of [(d: any) => { d.socialHistory = []; }, (d: any) => { d.socialLog = []; },
      (d: any) => { d.pawns[0].social = initialSocial(); }, (d: any) => { d.tables[0].gathering = false; },
      (d: any) => { d.pawns[0].psyche.tolerance.social = 0; },
      (d: any) => { d.pawns[0].psyche.recreation = { kind: 'social' }; }]) {
      const d = legacy(); mutate(d); const before = structuredClone(d);
      expect(() => rejectLegacySocialFields(d)).toThrow(/旧版本包含新版/); expect(d).toEqual(before);
    }
    const broken = legacy(); broken.pawns[1].psyche = null; const before = structuredClone(broken);
    expect(() => migrateSocial(broken, 31)).toThrow(); expect(broken).toEqual(before);
  });
});

describe('social persistence contracts', () => {
  it('keeps an immediate save valid when a second departure releases the first identity', () => {
    const d = current(), [, b, c] = d.pawns;
    applySocialInteraction(b, c, 'deepTalk', d.tick);
    rememberDeparture(d.socialHistory, c, d.tick, d.pawns, d.socialLog);
    d.pawns = d.pawns.filter((p: any) => p.id !== c.id);
    expect(d.socialHistory.map((p: any) => p.pawnId)).toEqual([c.id]);
    expect(() => validateSocial(d)).not.toThrow();
    // Nobody remembers B, but B still owns the only surviving memory of C.
    rememberDeparture(d.socialHistory, b, d.tick, d.pawns, d.socialLog);
    d.pawns = d.pawns.filter((p: any) => p.id !== b.id);
    expect(d.socialHistory).toEqual([]); expect(() => validateSocial(d)).not.toThrow();
  });
  it('accepts actual directional memories, retained dead people and independent historical identities', () => {
    const { d, other } = remembered(); other.dead = true; expect(() => validateSocial(d)).not.toThrow();
    d.pawns = d.pawns.filter((p: any) => p.id !== other.id);
    d.socialHistory.push({ pawnId: other.id, name: other.name, faction: other.faction, departedTick: d.tick, dead: true });
    expect(() => validateSocial(d)).not.toThrow();
    d.tick += 30 * DAY; expect(() => validateSocial(d)).not.toThrow(); // Frozen dead/unscheduled memories may be expired.
  });
  it('requires named person records for absent IDs and rejects all physical ID collisions', () => {
    for (const mutate of [({ d, memory }: any) => { memory.otherId = d.items[0].id; },
      ({ d, memory }: any) => { memory.otherId = d.nextId++; },
      ({ d, other }: any) => { d.socialHistory.push({ pawnId: other.id, name: other.name, faction: 'colony', departedTick: d.tick, dead: false }); },
      ({ d, memory }: any) => {
        const id = d.nextId++; memory.otherId = id;
        d.socialHistory.push({ pawnId: id, name: '离图者', faction: 'trader', departedTick: d.tick, dead: false });
        d.items[0].weapon = { id };
      },
      ({ d, other }: any) => { d.pawns = d.pawns.filter((p: any) => p.id !== other.id); }]) {
      const data = remembered(); mutate(data); expect(() => validateSocial(data.d)).toThrow(/社交存档/);
    }
  });
  it('rejects unknown fields, impossible times, self memories, wrong magnitudes and unbounded storage', () => {
    for (const mutate of [({ p }: any) => { p.social.opinions = {}; },
      ({ p, memory }: any) => { memory.otherId = p.id; }, ({ memory }: any) => { memory.amount = NaN; },
      ({ memory }: any) => { memory.amount = -15; }, ({ memory }: any) => { memory.amount = 15 * SOCIAL_RULES.maxImpact + .1; },
      ({ d, memory }: any) => { memory.createdTick = d.tick + 1; }, ({ memory }: any) => { memory.expires = memory.createdTick; },
      ({ p }: any) => { p.social.lastInteractionTick = null; },
      ({ d, p }: any) => { p.social.nextAttemptTick = d.tick + 1000; },
      ({ p, memory }: any) => { p.social.memories = Array.from({ length: 65 }, () => ({ ...memory })); },
      ({ d }: any) => { delete d.tables[0].gathering; }, ({ p }: any) => { p.psyche.tolerance.social = 1.1; }]) {
      const data = remembered(); mutate(data); expect(() => validateSocial(data.d)).toThrow(/社交存档/);
    }
  });
  it('bounds groups and logs and rejects duplicate, future or orphan history entries', () => {
    for (const mutate of [({ p, memory }: any) => { p.social.memories = Array.from({ length: 11 }, () => ({ ...memory })); },
      ({ d }: any) => { d.socialLog.push({ ...d.socialLog[0] }); },
      ({ d }: any) => { d.socialLog[0].tick++; },
      ({ d }: any) => { d.socialHistory.push({ pawnId: d.nextId++, name: '无引用者', faction: 'trader', departedTick: d.tick, dead: false }); },
      ({ d, other }: any) => {
        d.pawns = d.pawns.filter((p: any) => p.id !== other.id);
        d.socialHistory.push({ pawnId: other.id, name: other.name, faction: 'trader', departedTick: d.tick - 1, dead: false });
      }]) {
      const data = remembered(); mutate(data); expect(() => validateSocial(data.d)).toThrow(/社交存档/);
    }
  });
  it('validates cumulative daily clocks separately from normal expiry and prevents repeated event replay', () => {
    const d = current(), a = d.pawns[0], b = d.pawns[1];
    applySocialInteraction(a, b, 'chitchat', d.tick);
    const normal = structuredClone(d); expect(() => validateSocial(normal)).not.toThrow();
    for (const mutate of [(s: any) => { s.pawns[0].social.memories[0].expires = s.tick + DAY; },
      (s: any) => { s.pawns[0].social.memories[0].nextDecayTick++; },
      (s: any) => { s.pawns[0].social.memories[0].nextDecayTick = s.tick; },
      (s: any) => { s.pawns[0].social.memories[0].amount = SOCIAL_RULES.maxCumulativeAmount + 1; },
      (s: any) => { s.pawns[0].social.memories.push({ ...s.pawns[0].social.memories[0] }); }]) {
      const save = structuredClone(normal); mutate(save); expect(() => validateSocial(save)).toThrow(/社交存档/);
    }
    // Crossing multiple days is legitimate and cannot be rejected as a future
    // timer simply because the original cumulative memory was created earlier.
    a.social.memories[0].amount = 20; d.tick += 3 * DAY; pruneSocial(a.social, d.tick);
    expect(() => validateSocial(d)).not.toThrow();
    const { d: ordinary, memory } = remembered(); memory.expires++;
    expect(() => validateSocial(ordinary)).toThrow(/记忆期限/);
  });
  it('shares the insult-mood cap across people and rejects multiplied mood power', () => {
    const d = current(), target = d.pawns[0];
    target.social.lastInteractionTick = d.tick;
    for (let i = 0; i < 11; i++) {
      const id = d.nextId++;
      d.socialHistory.push({ pawnId: id, name: '离图者' + i, faction: 'colony', departedTick: d.tick, dead: false });
      target.social.memories.push({ kind: 'insultedMood', otherId: id, createdTick: d.tick - i, expires: d.tick - i + 2 * DAY, amount: -5 });
    }
    expect(() => validateSocial(d)).toThrow(/记忆数量超限/);
    target.social.memories.pop(); d.socialHistory.pop(); expect(() => validateSocial(d)).not.toThrow();
    target.social.memories[0].amount = -4; expect(() => validateSocial(d)).toThrow(/不得重复缩放/);
  });
});
