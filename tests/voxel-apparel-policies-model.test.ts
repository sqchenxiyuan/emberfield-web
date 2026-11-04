import { describe, expect, it } from 'vitest';
import { APPAREL_KINDS, apparelStats, makeApparel } from '../src/voxel/apparel';
import { APPAREL_POLICY_MIN_GAIN, apparelPolicyGain, apparelPolicyRawScore, createDefaultApparelPolicies,
  initialApparelControl, neededApparelWarmth, normalizeApparelPolicy, policyAllowsApparel,
  selectApparelPolicyCandidate } from '../src/voxel/apparelPolicies';
import { migrateApparelPolicies, rejectLegacyApparelPolicies, validateApparelPolicies } from '../src/voxel/apparelPoliciesPersistence';
import { stripApparelPoliciesFields } from './legacy-apparel-policies-defaults';
import { stripAnimalEnvironmentFields } from './legacy-animal-environment-defaults';
import type { VoxelSave } from '../src/voxel/types';

/** Pure model graph, intentionally not a generated world or routing fixture. */
const graph = () => ({ version: 56, tick: 100, apparelPolicies: createDefaultApparelPolicies(),
  pawns: [{ id: 1, faction: 'colony', worn: [makeApparel(31, 'parka')], apparelTask: null,
    apparelControl: initialApparelControl(100, 1), cargo: null },
  { id: 2, faction: 'trader', worn: [makeApparel(32, 'tuque')], apparelTask: null,
    apparelControl: initialApparelControl(100), cargo: null }],
  items: [{ id: 40, apparel: makeApparel(33, 'duster'), resource: 'apparel', amount: 1 }],
} as unknown as VoxelSave);

describe('apparel policy model', () => {
  it('creates independent policies, allowed lists and forced controls', () => {
    const first = createDefaultApparelPolicies(), next = createDefaultApparelPolicies();
    expect(first).toEqual({ nextId: 2, policies: [{ id: 1, name: '自由穿戴', allowedKinds: APPAREL_KINDS,
      minQuality: 0, maxQuality: 6, minCondition: 0, maxCondition: 1 }] });
    first.policies[0].allowedKinds.pop(); expect(next.policies[0].allowedKinds).toEqual(APPAREL_KINDS);
    const control = initialApparelControl(54); control.forcedIds.push(1);
    expect(initialApparelControl(54)).toEqual({ policyId: null, nextCheckTick: 54, forcedIds: [] });
  });
  it('normalizes command names and kinds without changing input or silently repairing invalid fields', () => {
    const raw = { ...createDefaultApparelPolicies().policies[0], name: '  工作衣  ', allowedKinds: ['pants', 'shirt', 'pants'] };
    const before = structuredClone(raw), canonical = normalizeApparelPolicy(raw);
    expect(canonical).toEqual({ ...raw, name: '工作衣', allowedKinds: ['shirt', 'pants'] }); expect(raw).toEqual(before);
    const invalid = [{ name: ' ' }, { name: 'x'.repeat(41) }, { name: 'a\nb' }, { id: 0 },
      { allowedKinds: ['unknown'] }, { minQuality: 3, maxQuality: 2 }, { minQuality: .1 },
      { maxQuality: 7 }, { minCondition: -.1 }, { maxCondition: 1.1 }, { minCondition: NaN },
      { minCondition: .8, maxCondition: .2 }, { surprise: true }];
    for (const patch of invalid) expect(normalizeApparelPolicy({ ...raw, ...patch })).toBeNull();
    expect(normalizeApparelPolicy({ ...raw, allowedKinds: [] })?.allowedKinds).toEqual([]);
  });
  it('uses garment kind, inclusive quality and actual hit point percentage rather than absolute durability', () => {
    const policy = { ...createDefaultApparelPolicies().policies[0], allowedKinds: ['parka'] as const,
      minQuality: 2 as const, maxQuality: 3 as const, minCondition: .5, maxCondition: .75 };
    const p = { ...policy, allowedKinds: [...policy.allowedKinds] };
    const piece = makeApparel(1, 'parka'); piece.hitPoints = 90;
    expect(policyAllowsApparel(p, piece)).toBe(true); piece.hitPoints = 135; expect(policyAllowsApparel(p, piece)).toBe(true);
    piece.hitPoints = 89; expect(policyAllowsApparel(p, piece)).toBe(false);
    expect(policyAllowsApparel(p, { ...piece, hitPoints: 100, quality: 4 })).toBe(false);
    expect(policyAllowsApparel(p, makeApparel(2, 'shirt'))).toBe(false);
  });
  it('matches strict seasonal warmth thresholds and the absence of a Cool insulation bonus', () => {
    expect([11.99, 12, 16, 20, 20.01].map(neededApparelWarmth)).toEqual(['warm', 'any', 'any', 'any', 'cool']);
    const parka = makeApparel(1, 'parka'), duster = makeApparel(2, 'duster');
    expect(apparelPolicyRawScore(parka, 'warm')).toBeCloseTo(apparelPolicyRawScore(parka, 'any') * 8);
    expect(apparelPolicyRawScore(parka, 'cool')).toBe(apparelPolicyRawScore(parka, 'any'));
    expect(apparelPolicyRawScore(duster, 'cool')).toBe(apparelPolicyRawScore(duster, 'any'));
  });
  it('rounds filter durability to hundredths with native ties-to-even and inclusive epsilon', () => {
    const policy = { ...createDefaultApparelPolicies().policies[0], minCondition: .12, maxCondition: .12 };
    const cap = makeApparel(1, 'tuque'); cap.hitPoints = 10; // 10 / 80 = .125 => .12
    expect(policyAllowsApparel(policy, cap)).toBe(true);
    cap.hitPoints = 11; expect(policyAllowsApparel(policy, cap)).toBe(false);
    const shirt = makeApparel(2, 'shirt'); shirt.hitPoints = 50;
    expect(policyAllowsApparel({ ...policy, minCondition: .500009, maxCondition: 1 }, shirt)).toBe(true);
    expect(policyAllowsApparel({ ...policy, minCondition: .50002, maxCondition: 1 }, shirt)).toBe(false);
  });
  it('matches native clamped durability score knees and material/quality insulation', () => {
    const piece = makeApparel(1, 'shirt'), base = .1 + apparelStats(piece).armorSharp + apparelStats(piece).armorBlunt;
    for (const [hp, factor] of [[0, 0], [20, .2], [21, .25], [22, .3], [50, .3], [51, .65], [52, 1], [100, 1]])
      expect(apparelPolicyRawScore({ ...piece, hitPoints: hp }, 'any')).toBeCloseTo(base * factor);
    expect(apparelPolicyRawScore(makeApparel(2, 'tuque', 2, 'alpacaWool'), 'warm'))
      .toBeGreaterThan(apparelPolicyRawScore(makeApparel(3, 'tuque'), 'warm'));
    expect(apparelPolicyRawScore(makeApparel(4, 'plateArmor', 6), 'any'))
      .toBeGreaterThan(apparelPolicyRawScore(makeApparel(5, 'plateArmor', 2), 'any'));
  });
  it('subtracts every conflicting layer, rewards empty slots and protects forced physical identities', () => {
    const coat = makeApparel(1, 'parka'), duster = makeApparel(2, 'duster'), shirt = makeApparel(3, 'shirt');
    expect(apparelPolicyGain(duster, [coat, shirt], [], 'any'))
      .toBeCloseTo(apparelPolicyRawScore(duster, 'any') - apparelPolicyRawScore(coat, 'any'));
    expect(apparelPolicyGain(duster, [shirt], [], 'any')).toBe(apparelPolicyRawScore(duster, 'any') * 10);
    expect(apparelPolicyGain(duster, [coat, shirt], [coat.id], 'any')).toBe(-1000);
    expect(apparelPolicyGain(duster, [coat, shirt], [shirt.id], 'any')).toBeGreaterThan(-1000);
  });
  it('filters candidates, enforces minimum gain and keeps equal-score input ordering deterministic', () => {
    const policy = createDefaultApparelPolicies().policies[0], coat = makeApparel(1, 'parka');
    const same = makeApparel(2, 'parka'), helmet = makeApparel(3, 'simpleHelmet'), helmet2 = makeApparel(4, 'simpleHelmet');
    expect(APPAREL_POLICY_MIN_GAIN).toBe(.05);
    expect(selectApparelPolicyCandidate(policy, [coat], [], [same], 'any')).toBeNull();
    expect(selectApparelPolicyCandidate(policy, [coat], [], [helmet, helmet2], 'any')).toBe(helmet2);
    expect(selectApparelPolicyCandidate({ ...policy, allowedKinds: [] }, [], [], [helmet], 'any')).toBeNull();
  });
});

describe('apparel policy persistence', () => {
  it('keeps independent policy and physical id namespaces and validates without mutation', () => {
    const d = graph(), before = structuredClone(d); validateApparelPolicies(d); expect(d).toEqual(before);
    d.pawns[0].apparelControl.forcedIds = [31]; expect(() => validateApparelPolicies(d)).not.toThrow();
  });
  it('rejects raw newer fields even when empty/undefined and leaves all historical input untouched', () => {
    const old: any = { version: 55, tick: 19, pawns: [{ faction: 'colony', apparelTask: null }] };
    for (const change of [(d: any) => { d.apparelPolicies = undefined; }, (d: any) => { d.pawns[0].apparelControl = null; },
      (d: any) => { d.pawns[0].apparelTask = { action: 'wear', automatic: false }; }]) {
      const d = structuredClone(old); change(d); const before = structuredClone(d);
      expect(() => rejectLegacyApparelPolicies(d, 55)).toThrow(/旧版本混入/);
      expect(() => migrateApparelPolicies(d, 55)).toThrow(); expect(d).toEqual(before);
    }
  });
  it('migrates all old factions to manual without changing existing tasks or ids', () => {
    const old: any = { version: 55, tick: 255, nextId: 1, pawns: [{ faction: 'colony', apparelTask:
      { action: 'wear', apparelId: 12, stage: 'work', progress: 7 } }, { faction: 'raider', apparelTask: null }] };
    const before = structuredClone(old); migrateApparelPolicies(old, 55);
    expect(old.apparelPolicies).toEqual(createDefaultApparelPolicies()); expect(old.nextId).toBe(1);
    for (let i = 0; i < old.pawns.length; i++) expect(old.pawns[i]).toEqual({ ...before.pawns[i], apparelControl: initialApparelControl(255) });
    old.pawns[0].apparelControl.forcedIds.push(12); expect(old.pawns[1].apparelControl.forcedIds).toEqual([]);
    const current = graph(), copy = structuredClone(current); migrateApparelPolicies(current, 56); expect(current).toEqual(copy);
  });
  it('preflights every historical pawn before adding defaults', () => {
    for (const bad of [null, [], 1, 'pawn']) {
      const old: any = { version: 55, tick: 0, pawns: [{ apparelTask: null }, bad] }, before = structuredClone(old);
      expect(() => migrateApparelPolicies(old, 55)).toThrow(); expect(old).toEqual(before);
    }
  });
  it('rejects invalid policy ids, shape, canonical order, limits and references atomically', () => {
    const mutations = [
      (d: any) => { d.apparelPolicies.nextId = 1; }, (d: any) => { d.apparelPolicies.policies = []; },
      (d: any) => { d.apparelPolicies.policies[0].allowedKinds.reverse(); },
      (d: any) => { d.apparelPolicies.policies[0].allowedKinds.push('parka'); },
      (d: any) => { d.apparelPolicies.policies[0].name = ' leading'; },
      (d: any) => { d.apparelPolicies.policies[0].maxCondition = Infinity; },
      (d: any) => { d.apparelPolicies.policies.push({ ...d.apparelPolicies.policies[0] }); },
      (d: any) => { d.apparelPolicies.policies = Array.from({ length: 17 }, (_, i) => ({ ...d.apparelPolicies.policies[0], id: i + 1 })); d.apparelPolicies.nextId = 18; },
      (d: any) => { d.pawns[0].apparelControl.policyId = 999; },
      (d: any) => { d.pawns[0].apparelControl.nextCheckTick = -.1; },
      (d: any) => { d.pawns[0].apparelControl.nextCheckTick = Infinity; },
      (d: any) => { d.pawns[1].apparelControl.policyId = 1; },
      (d: any) => { d.pawns[0].apparelControl.extra = true; },
    ];
    for (const mutate of mutations) { const d = graph(); mutate(d); const before = structuredClone(d);
      expect(() => validateApparelPolicies(d)).toThrow(/服装政策存档/); expect(d).toEqual(before); }
  });
  it('rejects forced ground, other-pawn, nonexistent and duplicate apparel references', () => {
    for (const forcedIds of [[32], [33], [999], [31, 31], [-1]]) {
      const d = graph(); d.pawns[0].apparelControl.forcedIds = forcedIds;
      expect(() => validateApparelPolicies(d)).toThrow(/强制衣物/);
    }
  });
  it('keeps legacy manual tasks unchanged and rejects false or extra automatic task fields', () => {
    const d = graph(); d.pawns[0].apparelTask = { action: 'wear', apparelId: 33, stage: 'fetch', progress: 0 };
    expect(() => validateApparelPolicies(d)).not.toThrow();
    for (const automatic of [false, null, undefined, 1]) {
      const bad = structuredClone(d); Object.assign(bad.pawns[0].apparelTask!, { automatic });
      expect(() => validateApparelPolicies(bad)).toThrow(/任务字段/);
    }
  });
  it('checks automatic wear and removal against live policy and forced conflicts', () => {
    const d = graph(); d.pawns[0].apparelTask = { action: 'wear', apparelId: 33, stage: 'fetch', progress: 0, automatic: true };
    expect(() => validateApparelPolicies(d)).not.toThrow();
    d.pawns[0].apparelControl.forcedIds = [31]; expect(() => validateApparelPolicies(d)).toThrow(/违反政策/);
    d.pawns[0].apparelControl.forcedIds = []; d.apparelPolicies.policies[0].allowedKinds = [];
    expect(() => validateApparelPolicies(d)).toThrow(/违反政策/);
    d.pawns[0].apparelTask = { action: 'remove', apparelId: 31, stage: 'work', progress: 0, automatic: true };
    expect(() => validateApparelPolicies(d)).not.toThrow();
    d.pawns[0].apparelControl.policyId = null; expect(() => validateApparelPolicies(d)).toThrow(/没有有效政策/);
  });
  it('synthetic downgrade rejects live policy data before stripping any predecessor state', () => {
    for (const mutate of [(d: any) => { d.apparelPolicies.policies[0].name = 'Custom'; },
      (d: any) => { d.pawns[0].apparelControl.forcedIds = [31]; },
      (d: any) => { d.pawns[0].apparelTask = { action: 'wear', apparelId: 33, stage: 'fetch', progress: 0, automatic: true }; }]) {
      for (const strip of [stripApparelPoliciesFields, stripAnimalEnvironmentFields]) {
        const d = graph(); mutate(d); const before = structuredClone(d);
        expect(() => strip(d)).toThrow(); expect(d).toEqual(before);
      }
    }
    const d: any = graph(); stripAnimalEnvironmentFields(d);
    expect(Object.hasOwn(d, 'apparelPolicies')).toBe(false); expect(d.pawns.every((p: any) => !Object.hasOwn(p, 'apparelControl'))).toBe(true);
  });
});
