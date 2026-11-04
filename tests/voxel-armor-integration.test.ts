import { withMedicineLedgers } from './legacy-medicine-defaults';
import { expectWildlifeIds } from './legacy-wildlife-defaults';
import { initialSkills } from '../src/voxel/skills';
import { initialTrade } from '../src/voxel/trade';
import { initialFireHazards } from '../src/voxel/fire';
import { initialWeather } from '../src/voxel/weather';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { makeApparel, APPAREL_DEFS } from '../src/voxel/apparel';
import { applyInjury, traumaIds } from '../src/voxel/injuries';
import { makeWeapon } from '../src/voxel/weapons';
import { makeWeaponBench } from '../src/voxel/weaponProduction';
import { initialResearch, RESEARCH_DEFS } from '../src/voxel/research';
import {
  Block,
  index,
  type ApparelPiece,
  type ArmorKind,
  type Pos,
  type Resource,
  type VoxelCommand,
  type VoxelSave,
} from '../src/voxel/types';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c);
  expect(result.ok, result.message).toBe(true);
}
function until(s: VoxelSimulation, done: () => boolean, max = 3000) {
  for (let i = 0; i < max && !done(); i++) s.step();
  expect(
    done(),
    JSON.stringify({
      tick: s.tick,
      jobs: s.jobs,
      pawns: s.pawns.map((p) => ({ reason: p.reason, cargo: p.cargo })),
    }),
  ).toBe(true);
}
// Controlled open geometry, completed prior technologies and initial test goods
// isolate transactions. These are not claims of ordinary colony/campaign play.
// Production progress, delivery, battle and movement below use real commands/step.
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  s.research = initialResearch(true);
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let x = 10; x <= 26; x++)
    for (let y = 10; y <= 26; y++)
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
function smithy() {
  const s = fixture();
  // A prebuilt, fueled station isolates crafting rather than construction.
  const bench = makeWeaponBench(s.nextId++, 'smithy', pos(17, 18), 'x');
  bench.fuel = 50;
  s.weaponBenches.push(bench);
  s.pawns[0].priorities.craft = 1;
  s.pawns[0].skills.crafting.level = 7;
  return VoxelSimulation.load(s.save());
}
function material(
  s: VoxelSimulation,
  resource: 'steel' | 'wood',
  amount: number,
  start = pos(12, 16),
) {
  for (let i = 0; amount > 0; i++) {
    const n = Math.min(75, amount);
    s.items.push({ ...start, y: start.y + i, id: s.nextId++, resource, amount: n });
    amount -= n;
  }
}
function bill(s: VoxelSimulation, kind: ArmorKind, paused = false) {
  command(s, { type: 'armorBill', benchId: s.weaponBenches[0].id, kind, target: 1, paused });
}
function allPieces(s: VoxelSimulation): ApparelPiece[] {
  return [
    ...s.items.flatMap((i) => (i.apparel ? [i.apparel] : [])),
    ...s.pawns.flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
  ];
}
function conserved(s: VoxelSimulation, resource: Resource) {
  return (
    s.counts()[resource] +
    s.stats.consumed[resource] +
    s.stats.destroyed[resource] +
    s.stats.spoiled[resource] -
    s.stats.produced[resource]
  );
}
function original(name: 'apparel' | 'trauma') {
  const bytes = readFileSync(new URL(`./fixtures/voxel-v16-${name}.json`, import.meta.url));
  const provenance = JSON.parse(
    readFileSync(new URL(`./fixtures/voxel-v16-${name}.provenance.json`, import.meta.url), 'utf8'),
  );
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
  expect(provenance.loadedByOriginalSource).toBe(true);
  const old = JSON.parse(bytes.toString());
  expect(old.version).toBe(16);
  return old;
}

describe('armor save migration and strict physical schemas', () => {
  it.each(['apparel', 'trauma'] as const)(
    'migrates genuine v16 %s bytes without replacing clothes, wounds or resources',
    (name) => {
      const old = original(name),
        before = structuredClone(old);
      const s = VoxelSimulation.load(old),
        saved = s.save();
      expect(old).toEqual(before);
      expect(saved.version).toBe(41);
      expectWildlifeIds(old.nextId, saved);
      for (const key of ['tick', 'blocks', 'items', 'stats', 'researchBenches'] as const)
        expect(saved[key]).toEqual(key === 'stats' ? withMedicineLedgers(old.stats) : old[key]);
      expect(saved.research).toEqual({
        ...old.research,
        progress: { ...old.research.progress, PlateArmor: 0, Machining: 0, Gunsmithing: 0, BlowbackOperation: 0 },
      });
      expect(saved.weaponBenches).toEqual(
        old.weaponBenches.map((bench: any) => ({
          ...bench,
          bills: [...bench.bills, { kind: 'shortBow', target: 0, paused: false }],
          armorBills:
            bench.kind === 'smithy'
              ? [
                  { kind: 'simpleHelmet', target: 0, paused: false },
                  { kind: 'plateArmor', target: 0, paused: false },
                ]
              : [],
        })),
      );
      for (const [i, p] of saved.pawns.entries()) {
        const prior = old.pawns.find((q: any) => q.id === p.id);
        for (const key of [
          'food',
          'rest',
          'worn',
          'weapon',
          'cargo',
          'skills',
          'health',
          'trauma',
        ] as const)
          expect(p[key]).toEqual(key === 'skills' ? {
            ...prior.skills,
            shooting: initialSkills(i, p.faction !== 'colony').shooting,
            social: initialSkills(i, p.faction !== 'colony').social,
            animals: initialSkills(i, p.faction !== 'colony').animals,
          } : prior[key]);
      }
      expect(() => VoxelSimulation.load(saved)).not.toThrow();
    },
  );
  it('rejects new armor fields and records smuggled into v16 rather than granting new technology or gear', () => {
    const clean = original('apparel');
    const cases: [string, (save: any) => void][] = [
      [
        'research progress',
        (s) => {
          s.research.progress.PlateArmor = 0;
        },
      ],
      [
        'current research',
        (s) => {
          s.research.progress.Smithing = RESEARCH_DEFS.Smithing.cost;
          s.research.current = 'PlateArmor';
        },
      ],
      [
        'worn steel armor',
        (s) => {
          s.pawns[0].worn = [makeApparel(s.nextId++, 'plateArmor')];
        },
      ],
      [
        'carried steel armor',
        (s) => {
          s.pawns[0].cargo = {
            resource: 'apparel',
            amount: 1,
            apparel: makeApparel(s.nextId++, 'simpleHelmet'),
          };
        },
      ],
      [
        'new recipe',
        (s) => {
          s.weaponBenches.push(makeWeaponBench(s.nextId++, 'smithy', s.spawn, 'x'));
        },
      ],
      [
        'new job',
        (s) => {
          s.jobs.push({ kind: 'armorsmith' });
        },
      ],
    ];
    for (const [name, change] of cases) {
      const bad = structuredClone(clean);
      change(bad);
      expect(() => VoxelSimulation.load(bad), name).toThrow();
    }
  });
  it('rejects malformed recipes, incompatible jobs, changed costs and duplicated identities in v17', () => {
    const s = smithy();
    bill(s, 'simpleHelmet');
    const saved = s.save();
    const changes: ((save: VoxelSave) => void)[] = [
      (v) => {
        v.weaponBenches[0].armorBills.push({ ...v.weaponBenches[0].armorBills[0] });
      },
      (v) => {
        v.weaponBenches[0].armorBills[0].target = 0.5;
      },
      (v) => {
        v.weaponBenches[0].kind = 'craftingSpot';
        v.weaponBenches[0].fuel = 0;
      },
      (v) => {
        v.jobs.find((j) => j.kind === 'armorsmith')!.work++;
      },
      (v) => {
        v.jobs.find((j) => j.kind === 'armorsmith')!.cost.steel = 39;
      },
      (v) => {
        v.jobs.find((j) => j.kind === 'armorsmith')!.weaponBenchKind = 'smithy';
      },
      (v) => {
        v.jobs.push({ ...v.jobs.find((j) => j.kind === 'armorsmith')!, id: v.nextId++ });
      },
      (v) => {
        const piece = makeApparel(v.nextId++, 'plateArmor');
        v.pawns[0].worn = [piece];
        v.pawns[1].cargo = { resource: 'apparel', amount: 1, apparel: { ...piece } };
      },
    ];
    for (const change of changes) {
      const bad = structuredClone(saved);
      change(bad);
      expect(() => VoxelSimulation.load(bad)).toThrow();
    }
    expect(() => VoxelSimulation.load(saved)).not.toThrow();
  });
});

describe('real armorsmith delivery, production and cancellation', () => {
  it('delivers steel, resumes unfinished work exactly and produces one unique helmet without duplicating a reservation', () => {
    let s = smithy();
    material(s, 'steel', 40);
    const before = conserved(s, 'steel');
    bill(s, 'simpleHelmet');
    expect(s.counts().apparel).toBe(0);
    until(s, () => s.jobs.some((j) => j.kind === 'armorsmith' && j.progress > 50));
    const job = s.jobs.find((j) => j.kind === 'armorsmith')!;
    expect(job.delivered).toEqual({});
    const workpiece = structuredClone(s.items.find(i => i.unfinished?.id === job.unfinishedId)!.unfinished!);
    expect(workpiece.ingredients).toEqual([{ resource: 'steel', amount: 40 }]);
    expect(workpiece.creatorId).toBe(job.owner);
    expect(job.work).toBe(APPAREL_DEFS.simpleHelmet.work);
    expect(s.items.some((i) => i.resource === 'steel')).toBe(false);
    const saved = s.save(),
      clone = VoxelSimulation.load(saved);
    s = VoxelSimulation.load(saved);
    expect(s.jobs.find((j) => j.id === job.id)?.progress).toBe(job.progress);
    expect(s.items.find(i => i.unfinished)?.unfinished).toEqual(workpiece);
    expect(s.jobs.filter((j) => j.kind === 'armorsmith')).toHaveLength(1);
    until(s, () => s.stats.produced.apparel === 1);
    clone.step(s.tick - saved.tick);
    expect(clone.items).toEqual(s.items);
    expect(clone.stats).toEqual(s.stats);
    const pieces = allPieces(s);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ kind: 'simpleHelmet', material: 'steel', hitPoints: 100 });
    expect(s.stats.consumed.steel).toBe(40);
    expect(conserved(s, 'steel')).toBe(before);
    const fuel = s.weaponBenches[0].fuel;
    s.step(80);
    expect(s.weaponBenches[0].fuel).toBe(fuel);
    expect(s.stats.produced.apparel).toBe(1);
    expect(s.jobs.some((j) => j.kind === 'armorsmith')).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('checks PlateArmor research and Crafting 7 before assigning production or reserving its steel', () => {
    const s = smithy();
    material(s, 'steel', 170);
    const request = {
      type: 'armorBill' as const,
      benchId: s.weaponBenches[0].id,
      kind: 'plateArmor' as const,
      target: 1,
      paused: false,
    };
    expect(s.command(request).ok).toBe(false);
    s.research.progress.PlateArmor = RESEARCH_DEFS.PlateArmor.cost;
    s.pawns[0].skills.crafting.level = 6;
    command(s, request);
    s.step(100);
    expect(s.jobs.find((j) => j.kind === 'armorsmith')).toMatchObject({
      progress: 0,
      owner: null,
      delivered: {},
    });
    expect(s.pawns[0].cargo).toBeNull();
    s.pawns[0].skills.crafting.level = 7;
    until(s, () => s.jobs.some((j) => j.kind === 'armorsmith' && j.progress > 5));
    expect(s.jobs.find((j) => j.kind === 'armorsmith')?.delivered).toEqual({});
    const workpiece = structuredClone(s.items.find(i => i.unfinished)!.unfinished!);
    expect(workpiece.ingredients.reduce((n, batch) => n + (batch.resource === 'steel' ? batch.amount : 0), 0)).toBe(170);
    bill(s, 'plateArmor', true);
    until(s, () => !s.jobs.some((j) => j.kind === 'armorsmith'));
    expect(s.counts().steel).toBe(170);
    expect(s.counts().apparel).toBe(0);
    expect(s.stats.consumed.steel).toBe(0);
    expect(s.items.find(i => i.unfinished)?.unfinished).toEqual(workpiece);
    expect(s.items.some(i => i.resource === 'steel')).toBe(false);
  });
  it('returns carried steel to the ground when paused and consumes it only after production resumes', () => {
    let s = smithy();
    material(s, 'steel', 40);
    bill(s, 'simpleHelmet');
    until(s, () => s.pawns[0].cargo?.resource === 'steel');
    const before = conserved(s, 'steel');
    bill(s, 'simpleHelmet', true);
    expect(s.pawns[0].cargo).toBeNull();
    expect(s.items.filter(item => item.resource === 'steel').reduce((n, item) => n + item.amount, 0)).toBe(40);
    expect(conserved(s, 'steel')).toBe(before);
    s = VoxelSimulation.load(s.save());
    s.step(100);
    expect(conserved(s, 'steel')).toBe(before);
    expect(s.stats.consumed.steel).toBe(0);
    expect(s.stats.produced.apparel).toBe(0);
    bill(s, 'simpleHelmet');
    until(s, () => s.stats.produced.apparel === 1);
    expect(s.stats.consumed.steel).toBe(40);
    expect(conserved(s, 'steel')).toBe(before);
  });
  it('retains paused armor atomically when its multi-stack refund cannot fit and returns materials once two more slots open', () => {
    let s = smithy();
    s.research.progress.PlateArmor = RESEARCH_DEFS.PlateArmor.cost;
    material(s, 'steel', 170);
    bill(s, 'plateArmor');
    until(s, () => s.jobs.some((j) => j.kind === 'armorsmith' && j.progress > 20));
    // Controlled full floor tests the bounded physical refund transaction.
    for (let x = 10; x <= 26; x++)
      for (let y = 10; y <= 26; y++)
        if (s.standable(pos(x, y)) && !s.items.some((i) => i.x === x && i.y === y))
          material(s, 'steel', 75, pos(x, y));
    const before = conserved(s, 'steel'), piece = structuredClone(s.items.find(i => i.unfinished)!.unfinished!);
    bill(s, 'plateArmor', true);
    expect(s.jobs.some(j => j.kind === 'armorsmith')).toBe(false);
    expect(s.items.find(i => i.unfinished)?.unfinished).toEqual(piece);
    const full = s.save();
    expect(s.command({ type: 'unfinishedCancel', unfinishedId: piece.id }).ok).toBe(false);
    expect(s.save()).toEqual(full);
    s = VoxelSimulation.load(s.save());
    s.step(60);
    expect(conserved(s, 'steel')).toBe(before);
    expect(s.counts().apparel).toBe(0);
    // Controlled removal into real cargo keeps material totals unchanged while
    // exposing exactly the two additional stack slots required by 170 steel.
    for (const p of [s.pawns[1], s.pawns[2]]) {
      const freed = s.items.find(i => i.resource === 'steel' && i.amount === 75 && i.x === 17 && (i.y === 19 || i.y === 20))!;
      expect(freed).toBeDefined();
      command(s, { type: 'draft', pawnId: p.id, drafted: true });
      p.cargo = { resource: 'steel', amount: freed.amount };
      s.items = s.items.filter(i => i.id !== freed.id);
    }
    command(s, { type: 'unfinishedCancel', unfinishedId: piece.id });
    expect(s.items.some(i => i.unfinished)).toBe(false);
    expect(conserved(s, 'steel')).toBe(before);
    expect(s.stats.consumed.steel).toBe(0);
    expect(s.stats.produced.apparel).toBe(0);
    expect(s.stats.consumed.unfinished).toBe(1);
    expect(s.command({ type: 'unfinishedCancel', unfinishedId: piece.id }).ok).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
});

function battle(seed: number, hitPoints = 290) {
  const s = fixture(),
    [attacker, target] = s.pawns;
  s.seed = seed;
  s.trade = initialTrade(s.seed, s.tick);
  s.fireHazards = initialFireHazards(s.seed, s.tick);
  s.weather = initialWeather(s.seed, s.settings, s.tick, s.generator);
  attacker.weapon = makeWeapon(s.nextId++, 'steelKnife');
  target.worn = [makeApparel(s.nextId++, 'plateArmor')];
  target.worn[0].hitPoints = hitPoints;
  // Resting target isolates armor from hit/dodge probabilities without changing RNG.
  target.phase = 'rest';
  target.rest = 20;
  target.schedule.fill('sleep');
  target.sleepingSince = 0;
  command(s, { type: 'draft', pawnId: attacker.id, drafted: true });
  command(s, { type: 'attack', pawnId: attacker.id, targetId: target.id });
  return s;
}
describe('armor during actual battle, clothing tasks and grid movement', () => {
  it('deflects real melee while reducing durability, and destroys a last-HP garment once without dropping a duplicate', () => {
    // Deterministic scenario search uses normal attacks, not a mocked armor result.
    let s: VoxelSimulation | null = null,
      seed = 1;
    for (; seed <= 64; seed++) {
      const candidate = battle(seed);
      candidate.step();
      if (candidate.pawns[0].reason.includes('护甲挡下')) {
        s = candidate;
        break;
      }
    }
    expect(s).not.toBeNull();
    const intact = s!;
    expect(traumaIds(intact.pawns[1].trauma)).toEqual([]);
    expect(intact.pawns[1].worn[0].hitPoints).toBeLessThan(290);
    expect(intact.stats.destroyed.apparel).toBe(0);
    const broken = battle(seed, 1),
      identity = broken.pawns[1].worn[0].id;
    const before = conserved(broken, 'apparel');
    broken.step();
    expect(broken.pawns[0].reason).toContain('护甲挡下');
    expect(traumaIds(broken.pawns[1].trauma)).toEqual([]);
    expect(broken.stats.destroyed.apparel).toBe(1);
    expect(broken.pawns[1].worn).toEqual([]);
    expect(allPieces(broken).some((p) => p.id === identity)).toBe(false);
    expect(conserved(broken, 'apparel')).toBe(before);
    command(broken, { type: 'draft', pawnId: broken.pawns[0].id, drafted: false });
    const restored = VoxelSimulation.load(broken.save());
    restored.step(100);
    expect(restored.stats.destroyed.apparel).toBe(1);
    expect(conserved(restored, 'apparel')).toBe(before);
    const continuation = VoxelSimulation.load(intact.save());
    intact.step(100);
    continuation.step(100);
    expect(continuation.pawns.map((p) => [p.worn, p.trauma, p.dead, p.downed])).toEqual(
      intact.pawns.map((p) => [p.worn, p.trauma, p.dead, p.downed]),
    );
    expect(continuation.stats.destroyed).toEqual(intact.stats.destroyed);
  });
  it('retains a carried garment when a mid-wear loss leaves no remaining covered parts', () => {
    const s = fixture(),
      p = s.pawns[0],
      pants = makeApparel(s.nextId++, 'pants');
    applyInjury(p.trauma, s.nextId++, 'leftLeg', 'cut', 31);
    s.step();
    expect(p.downed).toBe(false);
    s.items.push({
      ...pos(p.x, p.y),
      id: s.nextId++,
      resource: 'apparel',
      amount: 1,
      apparel: pants,
    });
    command(s, { type: 'wear', pawnId: p.id, apparelId: pants.id });
    until(s, () => p.apparelTask?.stage === 'work');
    expect(p.cargo?.apparel?.id).toBe(pants.id);
    applyInjury(p.trauma, s.nextId++, 'rightLeg', 'cut', 31);
    s.step();
    expect(p.downed).toBe(true);
    expect(p.apparelTask).toBeNull();
    expect(p.worn).toEqual([]);
    expect(p.cargo?.apparel?.id).toBe(pants.id);
    expect(allPieces(s)).toHaveLength(1);
    expect(s.command({ type: 'wear', pawnId: p.id, apparelId: pants.id }).ok).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('slows real travel in plate and retains its remaining route through a save', () => {
    const naked = fixture(),
      armored = VoxelSimulation.load(naked.save());
    armored.pawns[0].worn = [makeApparel(armored.nextId++, 'plateArmor')];
    const destination = pos(21, 11);
    // Drafted move orders retain their route on reload in the existing loader.
    for (const s of [naked, armored]) {
      command(s, { type: 'draft', pawnId: s.pawns[0].id, drafted: true });
      command(s, { type: 'move', pawnId: s.pawns[0].id, target: destination });
    }
    naked.step(12);
    armored.step(12);
    expect(armored.pawns[0].x).toBeLessThanOrEqual(naked.pawns[0].x);
    const resumed = VoxelSimulation.load(armored.save());
    until(naked, () => naked.pawns[0].x === destination.x);
    until(armored, () => armored.pawns[0].x === destination.x);
    resumed.step(armored.tick - resumed.tick);
    expect(armored.tick).toBeGreaterThan(naked.tick);
    expect([naked.tick, armored.tick]).toEqual([37, 46]);
    expect(resumed.pawns[0]).toEqual(armored.pawns[0]);
  });
});
