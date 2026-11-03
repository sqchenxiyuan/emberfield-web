import { withMedicineLedgers } from './legacy-medicine-defaults';
import { expectWildlifeIds } from './legacy-wildlife-defaults';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, index, type Device, type Pos, type VoxelCommand } from '../src/voxel/types';
import { VoxelPower } from '../src/voxel/power';
import { initialResearch, RESEARCH_DEFS } from '../src/voxel/research';
import { initialSkills } from '../src/voxel/skills';
import { machiningWorkFactor, makeWeaponBench } from '../src/voxel/weaponProduction';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c);
  expect(r.ok, r.message).toBe(true);
  return r;
}
function until(s: VoxelSimulation, done: () => boolean, max = 8000) {
  for (let i = 0; i < max && !done(); i++) s.step();
  expect(
    done(),
    JSON.stringify({ tick: s.tick, jobs: s.jobs, people: s.pawns.map((p) => p.reason) }),
  ).toBe(true);
}
// Controlled finite inputs and researched test scenario, NOT ordinary campaign evidence.
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  s.research = initialResearch(true);
  for (const key of ['Machining', 'Gunsmithing', 'BlowbackOperation'] as const)
    s.research.progress[key] = RESEARCH_DEFS[key].cost;
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let x = 10; x <= 36; x++)
    for (let y = 10; y <= 30; y++)
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i));
    p.worn = [];
    p.schedule.fill('work');
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
  });
  command(s, { type: 'threats', enabled: false });
  return VoxelSimulation.load(s.save());
}
function generator(id: number, p: Pos): Device {
  return {
    ...p,
    id,
    kind: 'generator',
    axis: 'x',
    on: true,
    fuel: 75,
    energy: 0,
    target: 21,
    powered: false,
    active: false,
    networkId: null,
    watts: 0,
    reason: 'controlled test',
  };
}
function original(name: string) {
  const data = readFileSync(new URL(`./fixtures/voxel-v17-armor-${name}.json`, import.meta.url));
  const provenance = JSON.parse(
    readFileSync(
      new URL(`./fixtures/voxel-v17-armor-${name}.provenance.json`, import.meta.url),
      'utf8',
    ),
  );
  expect(createHash('sha256').update(data).digest('hex')).toBe(provenance.sha256);
  expect(provenance.loadedByOriginalSource).toBe(true);
  const old = JSON.parse(data.toString());
  expect(old.version).toBe(17);
  return old;
}

describe('v18 ranged migration and powered physical production', () => {
  it.each(['working', 'combat'])(
    'migrates authentic published v17 %s without changing prior physical progress',
    (name) => {
      const old = original(name),
        before = structuredClone(old),
        s = VoxelSimulation.load(old),
        save = s.save();
      expect(old).toEqual(before);
      expect(save.version).toBe(30);
      expectWildlifeIds(old.nextId, save);
      for (const key of [
        'tick',
        'blocks',
        'ladders',
        'items',
        'stats',
        'combat',
        'researchBenches',
        'trees',
        'devices',
        'wires',
      ] as const)
        expect(save[key]).toEqual(key === 'stats' ? withMedicineLedgers(old.stats) : old[key]);
      expect(save.projectiles).toEqual([]);
      expect(save.combatEvents).toEqual([]);
      expect(save.sandbags).toEqual([]);
      expect(save.research).toEqual({
        ...old.research,
        progress: { ...old.research.progress, Machining: 0, Gunsmithing: 0, BlowbackOperation: 0 },
      });
      for (const [i, p] of save.pawns.entries()) {
        const prior = old.pawns[i];
        for (const key of ['food', 'rest', 'worn', 'weapon', 'trauma', 'health', 'cargo'] as const)
          expect(p[key]).toEqual(prior[key]);
        expect(p.skills).toEqual({
          ...prior.skills,
          shooting: initialSkills(i, p.faction === 'raider').shooting,
          social: initialSkills(i, p.faction !== 'colony').social,
          animals: initialSkills(i, p.faction !== 'colony').animals,
        });
        expect(p.shooting).toBeNull();
        expect(p.staggerUntil).toBe(0);
      }
      for (const j of save.jobs) {
        const prior = old.jobs.find((q: any) => q.id === j.id);
        for (const key of ['progress', 'delivered', 'workTicks', 'productQuality'] as const)
          expect(j[key]).toEqual(prior[key]);
      }
      expect(save.weaponBenches).toEqual(
        old.weaponBenches.map((b: any) => ({
          ...b,
          bills: [...b.bills, { kind: 'shortBow', target: 0, paused: false }],
        })),
      );
      expect(() => VoxelSimulation.load(save)).not.toThrow();
    },
  );
  it('rejects ranged content disguised as v17 and does not mutate the input on rejection', () => {
    const changes = [
      (d: any) => {
        d.projectiles = [];
      },
      (d: any) => {
        d.combatEvents = [];
      },
      (d: any) => {
        d.sandbags = [];
      },
      (d: any) => {
        d.pawns[0].shooting = null;
      },
      (d: any) => {
        d.pawns[0].staggerUntil = 0;
      },
      (d: any) => {
        d.pawns[0].skills.shooting = initialSkills(0).shooting;
      },
      (d: any) => {
        d.research.progress.Machining = 0;
      },
      (d: any) => {
        d.weaponBenches[0].bills.push({ kind: 'shortBow', target: 0, paused: false });
      },
      (d: any) => {
        d.weaponBenches[0].kind = 'machining';
      },
      (d: any) => {
        d.pawns[0].weapon = { kind: 'revolver' };
      },
      (d: any) => {
        d.jobs[0].kind = 'sandbag';
      },
    ];
    for (const change of changes) {
      const d = original('working');
      change(d);
      const before = structuredClone(d);
      expect(() => VoxelSimulation.load(d)).toThrow(/旧存档/);
      expect(d).toEqual(before);
    }
  });
  it('charges the 350 W machining load while idle, disconnects without free energy and joins only wired floors', () => {
    const power = new VoxelPower(),
      g = generator(1, pos(10, 10)),
      b = makeWeaponBench(2, 'machining', pos(14, 10), 'x'),
      load = b.power!;
    power.rebuild([], [g], [load]);
    for (let tick = 1; tick <= 70; tick++) power.step(tick, [g], () => 1);
    expect(load.powered).toBe(true);
    expect(load.active).toBe(true);
    expect(power.snapshot()[0]).toMatchObject({ generatedW: 1000, demandW: 350, usedW: 350 });
    g.on = false;
    power.step(71, [g], () => 1);
    expect(load.powered).toBe(false);
    expect(load.active).toBe(false);
    expect(power.snapshot()[0].usedW).toBe(0);
    load.z++;
    power.rebuild([], [g], [load]);
    expect(load.networkId).toBeNull();
    power.rebuild([pos(10, 10, 9)], [g], [load]);
    expect(load.networkId).toBe(g.networkId);
    const battery: Device = { ...generator(3, pos(10, 10)), kind: 'battery', fuel: 0, energy: 100 };
    load.z = 8;
    load.on = true;
    load.powered = true;
    power.rebuild([], [battery], [load]);
    const before = battery.energy;
    power.step(72, [battery], () => 0);
    expect(before - battery.energy).toBeCloseTo((350 + 5) / DAY, 10);
  });
  it('builds machining from 150 steel and 5 components with the load sharing the built entity identity', () => {
    const s = fixture();
    s.pawns[0].priorities.build = 1;
    s.items.push(
      { ...pos(12, 18), id: s.nextId++, resource: 'steel', amount: 75 },
      { ...pos(13, 18), id: s.nextId++, resource: 'steel', amount: 75 },
      { ...pos(14, 18), id: s.nextId++, resource: 'components', amount: 5 },
    );
    command(s, { type: 'designate', tool: 'machining', from: pos(20, 20), axis: 'y' });
    until(s, () => s.weaponBenches.length === 1);
    const b = s.weaponBenches[0];
    expect(b.power?.id).toBe(b.id);
    expect(s.stats.consumed).toMatchObject({ steel: 150, components: 5 });
    expect(s.counts()).toMatchObject({ steel: 0, components: 0 });
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    const bad = s.save();
    bad.weaponBenches[0].power!.id++;
    expect(() => VoxelSimulation.load(bad)).toThrow(/电源/);
  });
  it('retains delivered gun materials and progress through power loss, switch-off and reload, then finishes exactly once', () => {
    let s = fixture();
    s.pawns[2].priorities.craft = 1;
    s.weaponBenches.push(makeWeaponBench(s.nextId++, 'machining', pos(20, 20), 'x'));
    s.devices.push(generator(s.nextId++, pos(16, 20)));
    s.items.push(
      { ...pos(12, 18), id: s.nextId++, resource: 'steel', amount: 30 },
      { ...pos(13, 18), id: s.nextId++, resource: 'components', amount: 2 },
    );
    s = VoxelSimulation.load(s.save());
    command(s, {
      type: 'weaponBill',
      benchId: s.weaponBenches[0].id,
      kind: 'revolver',
      target: 1,
      paused: false,
    });
    until(s, () => s.jobs.some((j) => j.kind === 'smith' && j.progress > 20));
    const j = s.jobs.find((j) => j.kind === 'smith')!,
      progress = j.progress,
      delivered = structuredClone(j.delivered);
    command(s, { type: 'benchPower', benchId: s.weaponBenches[0].id, on: false });
    s.step(80);
    expect(j.progress).toBe(progress);
    expect(j.delivered).toEqual(delivered);
    expect(s.stats.weaponsMade).toBe(0);
    expect(s.weaponBenches[0].power?.active).toBe(false);
    s = VoxelSimulation.load(s.save());
    expect(s.jobs.find((k) => k.id === j.id)?.progress).toBe(progress);
    command(s, { type: 'benchPower', benchId: s.weaponBenches[0].id, on: true });
    until(s, () => s.stats.weaponsMade === 1);
    expect(s.stats.consumed).toMatchObject({ steel: 30, components: 2 });
    expect(s.items.filter((i) => i.weapon?.kind === 'revolver')).toHaveLength(1);
    s.step(100);
    expect(s.stats.weaponsMade).toBe(1);
    const piece = s.items.find((i) => i.weapon?.kind === 'revolver')!.weapon!;
    expect(piece.quality).toBeGreaterThanOrEqual(0);
    expect(piece.quality).toBeLessThanOrEqual(5);
    expect(s.pawns[2].skills.crafting.xp).toBeGreaterThan(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('builds cloth sandbags in a line, charges finite cloth, allows crossing but rejects stopping on them', () => {
    const s = fixture();
    s.pawns[0].priorities.build = 1;
    s.items.push({ ...pos(12, 18), id: s.nextId++, resource: 'cloth', amount: 15 });
    command(s, { type: 'designate', tool: 'sandbag', from: pos(20, 20), to: pos(22, 20) });
    until(s, () => s.sandbags.length === 3);
    expect(s.sandbags.every((b) => b.hitPoints === 300)).toBe(true);
    expect(s.stats.consumed.cloth).toBe(15);
    expect(s.counts().cloth).toBe(0);
    expect(s.standable(pos(20, 20))).toBe(true);
    expect(s.command({ type: 'move', pawnId: s.pawns[0].id, target: pos(20, 20) }).ok).toBe(false);
    expect(s.path(pos(20, 19), pos(20, 21))).not.toBeNull();
    command(s, { type: 'designate', tool: 'remove', from: pos(20, 20) });
    until(s, () => s.sandbags.length === 2);
    expect(s.stats.produced.cloth).toBe(2);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('keeps temperature thresholds and outdoor/non-workshop penalties distinct from power availability', () => {
    expect(machiningWorkFactor(true, 20)).toBe(0.8);
    expect(machiningWorkFactor(false, 20, false)).toBe(0.8);
    expect(machiningWorkFactor(false, 20, true)).toBe(1);
    expect(machiningWorkFactor(true, 8)).toBeCloseTo(0.56);
    expect(machiningWorkFactor(false, 9, true)).toBe(1);
    expect(machiningWorkFactor(false, 35, true)).toBe(1);
    expect(machiningWorkFactor(false, 36, true)).toBe(0.7);
  });
});
