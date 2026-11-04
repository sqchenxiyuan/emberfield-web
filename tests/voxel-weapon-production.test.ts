import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { initialResearch } from '../src/voxel/research';
import { Block, index, type Pos, type VoxelCommand, type WeaponBench } from '../src/voxel/types';
import { makeWeapon } from '../src/voxel/weapons';
import { makeWeaponBench } from '../src/voxel/weaponProduction';
import { applyInjury } from '../src/voxel/injuries';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  // Controlled feature fixture represents a colony with research already completed.
  s.research = initialResearch(true);
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let x = 10; x <= 24; x++)
    for (let y = 10; y <= 24; y++)
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i));
    p.schedule.fill('work');
    p.priorities = {
      handle: 0, firefight: 0, clean: 0,
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
  });
  return VoxelSimulation.load(s.save());
}
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c);
  expect(r.ok, r.message).toBe(true);
}
function until(s: VoxelSimulation, done: () => boolean, max = 2500) {
  for (let i = 0; i < max && !done(); i++) s.step();
  expect(done(), JSON.stringify({ jobs: s.jobs, pawns: s.pawns.map((p) => p.reason) })).toBe(true);
}
function material(s: VoxelSimulation, resource: 'wood' | 'steel', amount: number, p = pos(12, 16)) {
  s.items.push({ ...p, id: s.nextId++, resource, amount });
}
function bill(
  s: VoxelSimulation,
  b: WeaponBench,
  kind: 'woodClub' | 'steelKnife' | 'steelLongsword',
  target = 1,
  paused = false,
) {
  command(s, { type: 'weaponBill', benchId: b.id, kind, target, paused });
}
function smithy() {
  let s = fixture();
  s.weaponBenches.push(makeWeaponBench(s.nextId++, 'smithy', pos(16, 16), 'x'));
  s = VoxelSimulation.load(s.save());
  return s;
}

describe('physical weapon production and persistence', () => {
  it('migrates genuine published v12 bytes without adding gear or changing needs', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v12-start.json', import.meta.url));
    const provenance = JSON.parse(
      readFileSync(new URL('./fixtures/voxel-v12-start.provenance.json', import.meta.url), 'utf8'),
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
    const old = JSON.parse(bytes.toString()),
      s = VoxelSimulation.load(old);
    expect(old.version).toBe(12);
    expect(s.save().version).toBe(57);
    expect(s.weaponBenches).toEqual([]);
    expect(s.items).toEqual(old.items);
    expect(s.save().blocks).toEqual(old.blocks);
    expect(
      s.pawns.map((p) => [p.food, p.rest, p.health, p.trauma.wounds, p.trauma.bloodLoss, p.worn]),
    ).toEqual(
      old.pawns.map((p: any) => [
        p.food,
        p.rest,
        p.health,
        p.trauma.wounds,
        p.trauma.bloodLoss,
        p.worn,
      ]),
    );
    expect(s.pawns.every((p) => p.trauma.missingParts.length === 0)).toBe(true);
    expect(s.pawns.every((p) => p.weapon === null && p.weaponTask === null)).toBe(true);
    // Separately marked legacy-state fixture exercises v12's former string equipment.
    old.pawns[0].weapon = 'steelKnife';
    const migrated = VoxelSimulation.load(old);
    expect(migrated.pawns[0].weapon).toMatchObject({
      kind: 'steelKnife',
      quality: 2,
      hitPoints: 100,
    });
    expect(() => VoxelSimulation.load(migrated.save())).not.toThrow();
  });
  it('places a free walkable crafting spot and produces a physical no-quality club only after delivering 40 wood', () => {
    const s = fixture();
    material(s, 'wood', 40);
    const before = s.counts().wood;
    command(s, { type: 'designate', tool: 'craftingSpot', from: pos(16, 16) });
    expect(s.jobs).toHaveLength(0);
    expect(s.standable(pos(16, 16))).toBe(true);
    expect(s.counts().wood).toBe(before);
    const b = s.weaponBenches[0];
    bill(s, b, 'woodClub');
    s.step(50);
    expect(s.stats.weaponsMade).toBe(0);
    s.pawns[0].priorities.craft = 1;
    until(s, () => s.jobs.some((j) => j.kind === 'smith' && j.progress > 20));
    expect(s.items.filter((i) => i.resource === 'wood')).toHaveLength(0);
    expect(s.jobs.find((j) => j.kind === 'smith')).toMatchObject({
      delivered: {},
      work: 560,
    });
    const job = s.jobs.find(j => j.kind === 'smith')!;
    expect(s.items.find(i => i.unfinished?.id === job.unfinishedId)?.unfinished).toMatchObject({
      creatorId: job.owner, recipe: 'smith:woodClub', ingredients: [{ resource: 'wood', amount: 40 }],
    });
    expect(s.counts().wood).toBe(before);
    until(s, () => s.stats.weaponsMade === 1);
    expect(s.items.find((i) => i.weapon)?.weapon).toMatchObject({
      kind: 'woodClub',
      quality: 2,
      hitPoints: 65,
    });
    expect(s.stats.consumed.wood).toBe(40);
    expect(s.stats.produced.weapon).toBe(1);
    expect(s.counts().weapon).toBe(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('rejects unsupported spots and longswords at a crafting spot', () => {
    const s = fixture();
    expect(s.command({ type: 'designate', tool: 'craftingSpot', from: pos(16, 16, 12) }).ok).toBe(
      false,
    );
    command(s, { type: 'designate', tool: 'craftingSpot', from: pos(16, 16) });
    expect(
      s.command({
        type: 'weaponBill',
        benchId: s.weaponBenches[0].id,
        kind: 'steelLongsword',
        target: 1,
        paused: false,
      }).ok,
    ).toBe(false);
    const bad = s.save();
    bad.weaponBenches[0].fuel = 1;
    expect(() => VoxelSimulation.load(bad)).toThrow();
  });
  it('retains author, progress and embedded steel through reload and pause until explicit cancellation', () => {
    let s = fixture();
    material(s, 'steel', 30);
    s.pawns[0].priorities.craft = 1;
    command(s, { type: 'designate', tool: 'craftingSpot', from: pos(16, 16) });
    bill(s, s.weaponBenches[0], 'steelKnife');
    until(s, () => s.jobs.some((j) => j.kind === 'smith' && j.progress > 35));
    const job = s.jobs.find((j) => j.kind === 'smith')!,
      progress = job.progress;
    const piece = structuredClone(s.items.find(i => i.unfinished?.id === job.unfinishedId)!.unfinished!);
    s = VoxelSimulation.load(s.save());
    expect(s.jobs.find((j) => j.id === job.id)?.progress).toBe(progress);
    expect(s.items.find(i => i.unfinished)?.unfinished).toEqual(piece);
    bill(s, s.weaponBenches[0], 'steelKnife', 1, true);
    until(s, () => !s.jobs.some((j) => j.kind === 'smith'));
    expect(s.counts().steel).toBe(30);
    expect(s.counts().weapon).toBe(0);
    expect(s.stats.consumed.steel).toBe(0);
    expect(s.items.some(i => i.resource === 'steel')).toBe(false);
    expect(s.items.find(i => i.unfinished)?.unfinished).toEqual(piece);
    command(s, { type: 'unfinishedCancel', unfinishedId: piece.id });
    expect(s.items.filter(i => i.resource === 'steel').reduce((n, i) => n + i.amount, 0)).toBe(30);
    expect(s.items.some(i => i.unfinished)).toBe(false);
  });
  it('refuels an empty smithy while a production bill is queued and burns fuel only during actual work', () => {
    const s = smithy(),
      b = s.weaponBenches[0];
    material(s, 'wood', 50);
    material(s, 'steel', 30, pos(12, 17));
    s.pawns[0].priorities.craft = 1;
    s.pawns[1].priorities.haul = 1;
    bill(s, b, 'steelKnife');
    expect(s.jobs.some((j) => j.kind === 'smith')).toBe(true);
    expect(s.jobs.some((j) => j.kind === 'refuel')).toBe(true);
    until(s, () => s.stats.weaponsMade === 1);
    expect(b.fuel).toBeCloseTo(47.6, 6);
    const fuel = b.fuel;
    s.step(200);
    expect(b.fuel).toBe(fuel);
    expect(s.stats.consumed.steel).toBe(30);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('releases a completed blocked output after fuel is exhausted without repeating work or consuming inputs twice', () => {
    let s = smithy();
    let b = s.weaponBenches[0];
    b.fuel = 2.4;
    material(s, 'steel', 30);
    s.pawns[0].priorities.craft = 1;
    bill(s, b, 'steelKnife');
    until(s, () => s.jobs.some((j) => j.kind === 'smith' && j.progress > 25));
    // Controlled shelf adjacent to the real work position accepts the UFT but
    // rejects finished weapons, so consuming its own slot cannot bypass the
    // physical output boundary. Work and quality remain simulation-generated.
    const workpiece = s.items.find(i => i.unfinished)!;
    Object.assign(workpiece, pos(18, 17));
    const shelfId = s.nextId++;
    s.shelves.push({ ...pos(18, 17), id: shelfId, kind: 'smallShelf', axis: 'x', settings: { priority: 2, accepts: ['unfinished'] } });
    s = VoxelSimulation.load(s.save()); b = s.weaponBenches[0];
    for (let x = 10; x <= 24; x++)
      for (let y = 10; y <= 24; y++)
        if (s.standable(pos(x, y)) && !s.items.some((i) => i.x === x && i.y === y))
          material(s, 'steel', 75, pos(x, y));
    until(s, () => s.jobs.some((j) => j.kind === 'smith' && j.progress === j.work));
    expect(s.stats.weaponsMade).toBe(0);
    const job = s.jobs.find(j => j.kind === 'smith')!, workTicks = job.workTicks, quality = structuredClone(job.productQuality);
    const xp = s.pawns[0].skills.crafting.xp;
    b.fuel = 0; // Controlled exact-zero boundary, not normal-game evidence.
    const before = s.counts().steel;
    s.step(60);
    expect(job.workTicks).toBe(workTicks);
    expect(job.productQuality).toEqual(quality);
    expect(s.stats.consumed.steel).toBe(0);
    command(s, { type: 'shelfStorage', shelfId, priority: 2, accepts: ['unfinished', 'weapon'] });
    until(s, () => s.stats.weaponsMade === 1);
    expect(s.counts().steel).toBe(before - 30);
    expect(s.stats.consumed.steel).toBe(30);
    expect(b.fuel).toBe(0);
    expect(s.pawns[0].skills.crafting.xp).toBe(xp);
    expect(s.items.find(i => i.weapon)?.weapon?.quality).toBe(quality!.value);
    expect(s.items.some(i => i.unfinished)).toBe(false);
  });
  it('keeps weapon while downed in own bed, but ordinary death drops and forbids it', () => {
    const s = fixture(),
      p = s.pawns[0];
    const w = makeWeapon(s.nextId++, 'steelKnife');
    p.weapon = w;
    s.beds.push({ ...pos(p.x, p.y), id: s.nextId++, owner: p.id, axis: 'x', prisoner: false, quality: 2 as const, medical: false });
    p.sleepBedId = s.beds[0].id;
    p.phase = 'rest';
    p.sleepingSince = s.tick;
    applyInjury(p.trauma, s.nextId++, 'torso', 'bruise', 15);
    applyInjury(p.trauma, s.nextId++, 'head', 'bruise', 15);
    applyInjury(p.trauma, s.nextId++, 'leftArm', 'bruise', 15);
    applyInjury(p.trauma, s.nextId++, 'leftLeg', 'bruise', 20);
    s.step(5);
    expect(p.downed).toBe(true);
    expect(p.weapon?.id).toBe(w.id);
    expect(p.sleepBedId).toBe(s.beds[0].id);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    applyInjury(p.trauma, s.nextId++, 'torso', 'cut', 50);
    s.step();
    expect(p.dead).toBe(true);
    expect(p.weapon).toBeNull();
    expect(s.items.find((i) => i.weapon?.id === w.id)?.forbidden).toBe(true);
  });
  it('rejects forged bench recipes, incompatible smith jobs and cross-category duplicate instance identities', () => {
    const s = smithy();
    bill(s, s.weaponBenches[0], 'steelKnife');
    const bad = s.save();
    bad.weaponBenches[0].bills.push({ ...bad.weaponBenches[0].bills[0] });
    expect(() => VoxelSimulation.load(bad)).toThrow();
    const wrong = s.save();
    wrong.jobs.find((j) => j.kind === 'smith')!.weaponBenchKind = 'craftingSpot';
    expect(() => VoxelSimulation.load(wrong)).toThrow();
    s.pawns[0].weapon = makeWeapon(s.pawns[0].worn[0].id, 'steelKnife');
    expect(() => VoxelSimulation.load(s.save())).toThrow(/身份/);
  });
});
