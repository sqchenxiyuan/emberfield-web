import { describe, expect, it } from 'vitest';
import { expectWildlifeIds } from './legacy-wildlife-defaults';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { VoxelSimulation } from '../src/voxel/world';
import { DAY, Block } from '../src/voxel/types';
import { initialStoryteller, nextOpportunity, planRaid, raidWeapon, cycleHits, storyRandom } from '../src/voxel/storyteller';
import { applyInjury } from '../src/voxel/injuries';
import { STORY_INTERVAL } from '../src/voxel/storytellerRules';
import { initialTrade } from '../src/voxel/trade';
import { initialFireHazards } from '../src/voxel/fire';
import { initialWeather } from '../src/voxel/weather';

// White-box clock/health fixtures test transitions. Normal gameplay evidence is
// collected separately by the command-only storyteller campaign.
function atTick(tick: number) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  s.tick = tick;
  s.storyteller = initialStoryteller(s.seed, tick);
  s.trade = initialTrade(s.seed, tick);
  s.fireHazards = initialFireHazards(s.seed, tick);
  s.weather = initialWeather(s.seed, s.settings, s.tick, s.generator);
  return s;
}
describe('persistent colony storyteller', () => {
  it.each(['carrying', 'tending', 'infected', 'downed', 'death', 'working', 'combat', 'scheduled'])(
    'migrates authentic v19 %s bytes without rewriting physical state or retroactive losses', name => {
      const path = new URL(`./fixtures/voxel-v19-storyteller-${name}.json`, import.meta.url);
      const bytes = readFileSync(path), old = JSON.parse(bytes.toString());
      const provenance = JSON.parse(readFileSync(new URL(`./fixtures/voxel-v19-storyteller-${name}.provenance.json`, import.meta.url), 'utf8'));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
      const s = VoxelSimulation.load(old), saved = s.save();
      expect(old.version).toBe(19);
      expect(saved.version).toBe(45);
      expectWildlifeIds(old.nextId, saved);
      for (const key of ['tick', 'blocks', 'ladders', 'items', 'research', 'combat'] as const)
        expect(saved[key], key).toEqual(old[key]);
      for (const [key, value] of Object.entries(old.stats))
        expect(saved.stats[key as keyof typeof saved.stats]).toEqual(
          ['produced', 'consumed', 'spoiled', 'destroyed'].includes(key) ?
            { ...(value as object), silver: 0, meat: 0, carcass: 0, furniture: 0, unfinished: 0 } : value);
      for (const p of saved.pawns) {
        const before = old.pawns.find((q: { id: number }) => q.id === p.id);
        for (const key of ['trauma', 'medical', 'cargo', 'weapon', 'worn', 'careProgress', 'dead', 'downed'] as const)
          expect(p[key], `${p.id}:${key}`).toEqual(before[key]);
        const { social, animals, ...preserved } = p.skills;
        expect(preserved).toEqual(before.skills);
        expect(social.xp).toBe(0);
        expect(animals.xp).toBe(0);
      }
      expect(saved.storyteller.adaptationDays).toBe(0);
      expect(saved.storyteller.losses).toEqual([]);
      expect(saved.storyteller.legacyRaidAt).toBe(old.combat.enabled ? old.combat.nextRaid : null);
      expect(saved.structureKinds).toEqual([0, 64 * 64 * 16]);
      expect(VoxelSimulation.load(saved).save().storyteller).toEqual(saved.storyteller);
      const forged = structuredClone(old); forged.storyteller = saved.storyteller;
      expect(() => VoxelSimulation.load(forged)).toThrow('旧存档');
    });
  it('uses a 5.4-day intro at 40 points and actual budgeted people, with deterministic reload', () => {
    const s = atTick(324 * STORY_INTERVAL - 1);
    s.command({ type: 'threats', enabled: true });
    const clone = VoxelSimulation.load(s.save());
    s.step(); clone.step();
    const event = s.storyteller.events.at(-1)!;
    expect(event.source).toBe('intro');
    expect(event.outcome).toBe('spawned');
    expect(event.budget).toBe(40);
    expect(event.members).toHaveLength(1);
    expect(event.members[0].cost).toBe(35);
    expect(event.remainder).toBe(5);
    expect(s.storyteller).toEqual(clone.storyteller);
    expect(s.pawns.filter(p => p.faction === 'raider')).toEqual(clone.pawns.filter(p => p.faction === 'raider'));
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('difficulty and enable toggles never reroll the day-11 cycle or replay missed opportunities', () => {
    const s = atTick(11 * DAY);
    const original = structuredClone(s.storyteller.cycleHits);
    const opportunity = nextOpportunity(s.storyteller, s.seed, s.tick);
    for (const difficulty of ['easy', 'extreme', 'rough'] as const) {
      s.command({ type: 'difficulty', difficulty });
      s.command({ type: 'threats', enabled: true });
      expect(s.storyteller.cycleHits).toEqual(original);
      expect(nextOpportunity(s.storyteller, s.seed, s.tick)).toBe(opportunity);
      s.command({ type: 'threats', enabled: false });
    }
    const missed = atTick(324 * STORY_INTERVAL - 1); missed.step();
    expect(missed.storyteller.events.at(-1)?.outcome).toBe('skipped');
    missed.command({ type: 'threats', enabled: true }); missed.step(201);
    expect(missed.combat.wave).toBe(0);
    expect(missed.storyteller.introHandled).toBe(true);
    expect(missed.snapshot().storyteller.nextOpportunity).toBeGreaterThanOrEqual(11 * DAY);
  });
  it('respects the migrated pending appointment before introducing new calendar raids', () => {
    const due = cycleHits(73129, 0)[0] * STORY_INTERVAL;
    const s = atTick(due - 1);
    s.storyteller.legacyRaidAt = due + 3;
    s.command({ type: 'threats', enabled: true });
    expect(s.snapshot().storyteller.nextOpportunity).toBe(due + 3);
    s.step();
    expect(s.combat.wave).toBe(0);
    expect(s.storyteller.events.at(-1)?.reason).toContain('旧存档');
    s.step(3);
    expect(s.storyteller.legacyRaidAt).toBeNull();
    expect(s.storyteller.events.at(-1)?.source).toBe('legacy');
    expect(s.storyteller.events.at(-1)?.outcome).toBe('spawned');
  });
  it('a cycle can generate multiple distinct physical enemies rather than upgrading one weapon by wave', () => {
    const due = cycleHits(73129, 0)[0] * STORY_INTERVAL;
    const s = atTick(due - 1);
    for (const p of s.pawns) for (const skill of Object.values(p.skills)) skill.level = 20;
    s.command({ type: 'difficulty', difficulty: 'extreme' });
    s.command({ type: 'threats', enabled: true });
    s.step();
    const event = s.storyteller.events.at(-1)!;
    expect(event.outcome).toBe('spawned');
    expect(event.members.length).toBeGreaterThan(1);
    expect(event.spent + event.remainder).toBeCloseTo(event.budget);
    const people = s.pawns.filter(p => p.faction === 'raider');
    expect(new Set(people.map(p => `${p.x},${p.y},${p.z}`)).size).toBe(people.length);
    for (const m of event.members) expect(people.find(p => p.id === m.pawnId)?.weapon).toEqual(m.weapon);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('blocks impossible entries and caps a real group without deleting existing bodies', () => {
    const s = atTick(324 * STORY_INTERVAL - 1);
    for (let i = 0; i < s.blocks.length; i++) s.blocks[i] = Block.Stone;
    s.command({ type: 'threats', enabled: true }); s.step();
    expect(s.storyteller.events.at(-1)?.outcome).toBe('skipped');
    expect(s.combat.wave).toBe(0);
    expect(planRaid(10000, 4, () => 0).kinds).toHaveLength(4);
    expect(planRaid(10000, 64, () => 0).kinds).toHaveLength(16);
  });
  it('charges violent downing once, excludes downing without external violence, and collapses same-tick down/death to loss', () => {
    const makeDowned = (s: VoxelSimulation, external: boolean) => {
      const p = s.pawns[0];
      applyInjury(p.trauma, s.nextId++, 'torso', 'bruise', 15);
      applyInjury(p.trauma, s.nextId++, 'head', 'bruise', 15);
      applyInjury(p.trauma, s.nextId++, 'leftArm', 'bruise', 15);
      applyInjury(p.trauma, s.nextId++, 'leftLeg', 'bruise', 20);
      (s as any).reconcileHealth(p, external);
      expect(p.downed).toBe(true);
      return p;
    };
    const violent = atTick(0); const p = makeDowned(violent, true);
    (violent as any).reconcileHealth(p, true); violent.step();
    expect(violent.storyteller.adaptationDays).toBe(-6);
    violent.step(5); expect(violent.storyteller.losses).toHaveLength(1);
    const nonviolent = atTick(0); makeDowned(nonviolent, false); nonviolent.step();
    expect(nonviolent.storyteller.losses).toEqual([]);
    const dying = atTick(0); const q = makeDowned(dying, true);
    q.health.malnutrition = 1; (dying as any).reconcileHealth(q); dying.step();
    expect(dying.storyteller.losses.map(l => l.kind)).toEqual(['lost']);
    expect(dying.storyteller.adaptationDays).toBe(-30);
  });
  it('rejects forged calendars, nonfinite pressure, duplicate losses and structural phantom value', () => {
    const source = atTick(11 * DAY).save();
    const mutations: ((v: any) => void)[] = [
      v => v.storyteller.adaptationDays = Infinity,
      v => v.storyteller.difficulty = 'impossible',
      v => v.storyteller.cycleHits.push(1),
      v => v.storyteller.lastInterval += 10,
      v => v.storyteller.legacyRaidAt = -1,
      v => v.storyteller.introHandled = false,
      v => v.storyteller.events = Array(33).fill({}),
      v => v.storyteller.losses = [{ tick: 1, pawnId: 1, kind: 'lost', population: 2, before: 0, after: 5 }],
      v => v.structureKinds = [1, 64 * 64 * 16],
    ];
    for (const mutate of mutations) { const value = structuredClone(source); mutate(value); expect(() => VoxelSimulation.load(value)).toThrow(); }
  });
  it('preserves budget remainders, minimum raid floor and supported gear filters', () => {
    expect(planRaid(35, 16, () => 0)).toEqual({ budget: 36.75, spent: 35, remainder: 1.75, kinds: ['drifter'] });
    expect(planRaid(140, 16, () => 0).spent).toBe(140);
    expect(planRaid(140, 16, () => .9999)).toEqual({ budget: 140, spent: 135, remainder: 5, kinds: ['scavenger', 'scavenger', 'drifter'] });
    for (const kind of ['drifter', 'thrasher', 'scavenger'] as const) {
      const random = storyRandom(73129, kind.length);
      for (let n = 0; n < 50; n++) {
        const w = raidWeapon(kind, n + 1, random);
        expect(kind === 'scavenger' ? ['revolver', 'machinePistol'] : ['woodClub', 'steelKnife']).toContain(w.kind);
        expect(w.kind === 'woodClub' ? [2] : [0, 1, 2]).toContain(w.quality);
        expect(w.hitPoints).toBeGreaterThan(0);
      }
    }
    const weaponAt = (quality: number) => {
      const values = [.9, .9, quality, .5];
      return raidWeapon('scavenger', 77, () => values.shift()!);
    };
    expect(weaponAt(.099).quality).toBe(0);
    expect(weaponAt(.1).quality).toBe(2);
    expect(weaponAt(.2).quality).toBe(1);
  });
});
