import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, index, type AnimalSpecies, type Pawn, type Pos, type Resource, type VoxelCommand } from '../src/voxel/types';
import { defaultProductionPolicy, type ProductionPolicy, type ProductionRecipe } from '../src/voxel/productionBills';
import { freshBatch } from '../src/voxel/preservation';
import { initialResearch } from '../src/voxel/research';
import { defaultShelfSettings } from '../src/voxel/shelves';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { applyInjury } from '../src/voxel/injuries';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, value: VoxelCommand) {
  const result = s.command(value); expect(result.ok, result.message).toBe(true);
}
/** Same controlled room and injected inputs as the bill lifecycle fixture.
 * Only geometry, starting inventory and boundary skills are fixtures; ownership,
 * fetching, production, cancellation and save recovery use the actual simulator. */
function fixture(kind: 'craftingSpot' | 'stove' | 'butcherSpot' = 'craftingSpot') {
  let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.research = initialResearch(true); s.animals = []; s.trees = []; s.items = []; s.stockpiles = []; s.jobs = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 24; x++) for (let y = 10; y <= 24; y++)
    for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
    for (const work of Object.keys(p.priorities)) p.priorities[work as keyof Pawn['priorities']] = 0;
    p.skills.crafting.level = 10; p.skills.cooking.level = 10;
  });
  if (kind === 'stove') s.stoves.push({ id: s.nextId++, ...pos(16), target: 0, paused: false });
  s = VoxelSimulation.load(s.save());
  command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
  if (kind !== 'stove') command(s, { type: 'designate', tool: kind, from: pos(16) });
  const benchId = kind === 'stove' ? s.stoves[0].id : kind === 'butcherSpot' ? s.butcherSpots[0].id : s.weaponBenches[0].id;
  for (const bill of s.snapshot().productionQueues.find(queue => queue.benchId === benchId)!.bills)
    command(s, { type: 'productionBillDelete', benchId, billId: bill.id });
  return { s, benchId };
}
function material(s: VoxelSimulation, resource: Resource, amount: number, p = pos(12)) {
  const value = { id: s.nextId++, ...p, ...freshBatch(resource, amount) }; s.items.push(value); return value;
}
function carcass(s: VoxelSimulation, species: AnimalSpecies, p: Pos) {
  const animalId = s.nextId++;
  s.items.push({ id: s.nextId++, ...p, resource: 'carcass', amount: 1, carcass: { animalId, species }, rotProgress: 0 });
  return animalId;
}
const policy = (patch: Partial<ProductionPolicy> = {}): ProductionPolicy => ({ ...defaultProductionPolicy(), ...patch });
const getBill = (s: VoxelSimulation, id: string) => s.productionQueues.flatMap(queue => queue.bills).find(bill => bill.id === id)!;
const getJob = (s: VoxelSimulation, id: string) => s.jobs.find(job => job.billId === id && !job.cancelled);
function add(s: VoxelSimulation, benchId: number, recipe: ProductionRecipe, rules = policy(), remaining = 1) {
  const before = new Set(s.productionQueues.flatMap(queue => queue.bills).map(bill => bill.id));
  command(s, { type: 'productionBillAdd', benchId, recipe });
  const id = s.productionQueues.flatMap(queue => queue.bills).find(bill => !before.has(bill.id))!.id;
  command(s, { type: 'productionBillUpdate', benchId, billId: id, patch: { policy: rules, remaining } });
  return id;
}
function setPolicy(s: VoxelSimulation, benchId: number, id: string, changes: Partial<ProductionPolicy>) {
  command(s, { type: 'productionBillUpdate', benchId, billId: id, patch: { policy: { ...getBill(s, id).policy, ...changes } } });
}
function enable(s: VoxelSimulation, work: 'cook' | 'craft', ...indexes: number[]) {
  for (const i of indexes) command(s, { type: 'priority', pawnId: s.pawns[i].id, work, value: 1 });
}
function until(s: VoxelSimulation, done: () => boolean, max = 4000) {
  for (let tick = 0; tick < max && !done(); tick++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, jobs: s.jobs, queues: s.productionQueues,
    pawns: s.pawns.map(p => ({ id: p.id, jobId: p.jobId, reason: p.reason, cargo: p.cargo })) })).toBe(true);
}

describe('production worker selection and physical ingredient policies', () => {
  it('uses only the named worker for real ingredient transport and work', () => {
    const { s, benchId } = fixture(); material(s, 'wood', 40); enable(s, 'craft', 0, 1, 2);
    const workerId = s.pawns[2].id, id = add(s, benchId, 'smith:woodClub', policy({ workerId }));
    until(s, () => s.pawns[2].cargo?.resource === 'wood' && s.pawns[2].jobId === getJob(s, id)?.id);
    expect(getJob(s, id)?.owner).toBe(workerId);
    expect(s.pawns.slice(0, 2).every(p => p.jobId !== getJob(s, id)?.id)).toBe(true);
    until(s, () => (getJob(s, id)?.progress ?? 0) > 20);
    expect(getJob(s, id)?.owner).toBe(workerId); expect(getJob(s, id)?.productionPolicy).toEqual(getBill(s, id).policy);
    until(s, () => s.stats.weaponsMade === 1);
    expect(getBill(s, id).remaining).toBe(0); expect(s.stats.consumed.wood).toBe(40);
  });

  it('applies both ends of the any-worker skill interval to actual assignment', () => {
    const { s, benchId } = fixture(); material(s, 'wood', 40); enable(s, 'craft', 0, 1, 2);
    [2, 4, 6].forEach((level, i) => { s.pawns[i].skills.crafting.level = level; });
    const id = add(s, benchId, 'smith:woodClub', policy({ skillMin: 4, skillMax: 4 }));
    until(s, () => (getJob(s, id)?.progress ?? 0) > 20);
    expect(getJob(s, id)?.owner).toBe(s.pawns[1].id);
    until(s, () => s.stats.weaponsMade === 1);
    expect(getBill(s, id).remaining).toBe(0);
  });

  it('lets a named novice bypass the player skill interval while retaining the recipe hard requirement', () => {
    const { s, benchId } = fixture(); material(s, 'wood', 40); enable(s, 'craft', 0);
    s.pawns[0].skills.crafting.level = 0;
    const rules = policy({ workerId: s.pawns[0].id, skillMin: 20, skillMax: 20 });
    const club = add(s, benchId, 'smith:woodClub', rules);
    until(s, () => s.stats.weaponsMade === 1); expect(getBill(s, club).remaining).toBe(0);
    material(s, 'wood', 30);
    const bow = add(s, benchId, 'smith:shortBow', rules);
    s.step(80);
    expect(getBill(s, bow).remaining).toBe(1); expect(getJob(s, bow)?.owner).toBeNull();
    expect(getJob(s, bow)?.delivered.wood ?? 0).toBe(0); expect(s.counts().wood).toBe(30);
    s.pawns[0].skills.crafting.level = 2;
    until(s, () => s.stats.weaponsMade === 2);
    expect(getBill(s, bow).remaining).toBe(0); expect(s.stats.consumed.wood).toBe(70);
  });

  it('lets the available worker execute a later bill while the first bill requires someone else', () => {
    const { s, benchId } = fixture(); material(s, 'wood', 40); enable(s, 'craft', 0);
    const first = add(s, benchId, 'smith:woodClub', policy({ workerId: s.pawns[1].id }));
    const second = add(s, benchId, 'smith:woodClub', policy({ workerId: s.pawns[0].id }));
    until(s, () => s.stats.weaponsMade === 1);
    expect(getBill(s, first).remaining).toBe(1); expect(getBill(s, second).remaining).toBe(0);
    expect(s.stats.consumed.wood).toBe(40);
    material(s, 'wood', 40); enable(s, 'craft', 1);
    until(s, () => s.stats.weaponsMade === 2);
    expect(getBill(s, first).remaining).toBe(0);
  });

  it.each(['ground', 'shelf'] as const)('uses the actual %s source anchor for the strict ingredient radius', storage => {
    let { s, benchId } = fixture();
    const source = pos(19); // Exactly three cells from the workbench, even if a shelf pickup stand is nearer.
    if (storage === 'shelf') s.shelves.push({ id: s.nextId++, ...source, kind: 'smallShelf', axis: 'x', settings: defaultShelfSettings() });
    material(s, 'wood', 40, source); s = VoxelSimulation.load(s.save()); enable(s, 'craft', 0);
    const id = add(s, benchId, 'smith:woodClub', policy({ ingredientRadius: 3, allowedFood: [], allowedCarcasses: [] }));
    s.step(60);
    expect(getJob(s, id)?.owner).toBeNull(); expect(s.counts().wood).toBe(40); expect(s.pawns.every(p => !p.cargo)).toBe(true);
    setPolicy(s, benchId, id, { ingredientRadius: 4 });
    until(s, () => s.stats.weaponsMade === 1);
    expect(s.stats.consumed.wood).toBe(40); expect(getBill(s, id).remaining).toBe(0);
  });

  it('counts the vertical separation from a reachable upper-floor ingredient', () => {
    let { s, benchId } = fixture();
    const source = pos(16, 16, 11);
    s.blocks[index(16, 16, 10)] = Block.Wood;
    for (let z = 8; z <= 11; z++) s.ladders[index(17, 16, z)] = 1;
    material(s, 'wood', 40, source); s = VoxelSimulation.load(s.save());
    expect(s.path(s.pawns[0], source)).not.toBeNull(); enable(s, 'craft', 0);
    const id = add(s, benchId, 'smith:woodClub', policy({ ingredientRadius: 3 }));
    s.step(60); expect(getJob(s, id)?.owner).toBeNull(); expect(s.stats.weaponsMade).toBe(0);
    setPolicy(s, benchId, id, { ingredientRadius: 4 });
    until(s, () => s.stats.weaponsMade === 1);
    expect(s.stats.consumed.wood).toBe(40);
  });

  it('uses a real mixed meal, honors an empty food filter, then makes a grain-only meal', () => {
    const { s, benchId } = fixture('stove');
    material(s, 'meat', 4); material(s, 'grain', 6, pos(12, 17)); material(s, 'wood', 1, pos(12, 18)); enable(s, 'cook', 0);
    const mixed = add(s, benchId, 'cook');
    until(s, () => (getJob(s, mixed)?.progress ?? 0) > 10);
    expect(getJob(s, mixed)?.cost).toEqual({ wood: 1, meat: 4, grain: 6 });
    until(s, () => s.stats.cooked === 1);
    expect(s.stats.consumed.meat).toBe(4); expect(s.stats.consumed.grain).toBe(6);
    material(s, 'meat', 10); material(s, 'grain', 10, pos(12, 17)); material(s, 'wood', 1, pos(12, 18));
    const filtered = add(s, benchId, 'cook', policy({ allowedFood: [] }));
    s.step(60);
    expect(getJob(s, filtered)?.owner).toBeNull(); expect(s.stats.cooked).toBe(1);
    expect(getJob(s, filtered)?.delivered).toEqual({});
    setPolicy(s, benchId, filtered, { allowedFood: ['grain'] });
    until(s, () => s.stats.cooked === 2);
    expect(s.stats.consumed.meat).toBe(4); expect(s.stats.consumed.grain).toBe(16);
    expect(s.counts().meat).toBe(10); expect(s.stats.consumed.wood).toBe(2);
  });

  it('filters actual carcass species instead of consuming the closer excluded corpse', () => {
    const { s, benchId } = fixture('butcherSpot');
    const hareId = carcass(s, 'hare', pos(12)), deerId = carcass(s, 'deer', pos(20)); enable(s, 'cook', 0);
    const id = add(s, benchId, 'butcher', policy({ allowedCarcasses: ['deer'] }));
    until(s, () => !!s.pawns[0].cargo?.carcass);
    expect(s.pawns[0].cargo?.carcass?.animalId).toBe(deerId);
    until(s, () => getBill(s, id).remaining === 0);
    expect(s.stats.consumed.carcass).toBe(1); expect(s.stats.produced.meat).toBe(ANIMAL_DEFS.deer.meat);
    expect(s.items.some(item => item.carcass?.animalId === hareId)).toBe(true);
    expect(s.counts().carcass).toBe(1);
  });

  it.each(['carried', 'working'] as const)('freezes the selected batch at the %s stage while subsequent work uses the new policy', phase => {
    const { s, benchId } = fixture('stove');
    material(s, 'grain', 20); material(s, 'wood', 2, pos(17, 17)); enable(s, 'cook', 0, 1);
    const original = policy({ workerId: s.pawns[0].id, allowedFood: ['grain'] });
    const id = add(s, benchId, 'cook', original, 2);
    until(s, () => phase === 'carried'
      ? s.pawns[0].cargo?.resource === 'wood' && s.pawns[0].jobId === getJob(s, id)?.id
      : (getJob(s, id)?.progress ?? 0) > 10);
    const current = getJob(s, id)!, workId = current.id, cargo = structuredClone(s.pawns[0].cargo), delivered = structuredClone(current.delivered);
    setPolicy(s, benchId, id, { workerId: s.pawns[1].id, allowedFood: ['meat'], ingredientRadius: 3 });
    expect(getJob(s, id)).toMatchObject({ id: workId, owner: s.pawns[0].id, productionPolicy: original, delivered });
    expect(s.pawns[0].cargo).toEqual(cargo);
    until(s, () => s.stats.cooked === 1);
    expect(getBill(s, id).remaining).toBe(1); expect(s.stats.consumed.grain).toBe(10);
    s.step(60); expect(s.stats.cooked).toBe(1);
    material(s, 'meat', 10, pos(18));
    until(s, () => (getJob(s, id)?.progress ?? 0) > 10);
    expect(getJob(s, id)?.owner).toBe(s.pawns[1].id);
    expect(getJob(s, id)?.productionPolicy).toEqual(getBill(s, id).policy);
    until(s, () => s.stats.cooked === 2);
    expect(s.stats.consumed.grain).toBe(10); expect(s.stats.consumed.meat).toBe(10); expect(s.stats.consumed.wood).toBe(2);
    expect(getBill(s, id).remaining).toBe(0);
  });

  it('does not let the wrong worker reacquire a job with carried inputs after save/load', () => {
    let { s, benchId } = fixture('stove');
    material(s, 'grain', 10); material(s, 'wood', 1, pos(17, 17)); enable(s, 'cook', 0, 1);
    const oldWorker = s.pawns[0].id, newWorker = s.pawns[1].id;
    const id = add(s, benchId, 'cook', policy({ workerId: oldWorker, allowedFood: ['grain'] }));
    until(s, () => s.pawns[0].cargo?.resource === 'grain');
    const jobId = getJob(s, id)!.id, before = s.counts();
    setPolicy(s, benchId, id, { workerId: newWorker, allowedFood: ['meat'] });
    s = VoxelSimulation.load(s.save());
    expect(s.counts()).toEqual(before);
    expect(getJob(s, id)?.owner).not.toBe(oldWorker);
    expect(s.pawns.find(p => p.id === oldWorker)?.jobId).not.toBe(jobId);
    until(s, () => (getJob(s, id)?.progress ?? 0) > 10);
    expect(getJob(s, id)?.owner).toBe(newWorker);
    expect(getJob(s, id)?.productionPolicy?.allowedFood).toEqual(['grain']);
    until(s, () => s.stats.cooked === 1);
    expect(s.stats.consumed.grain).toBe(10); expect(s.stats.consumed.meat).toBe(0); expect(getBill(s, id).remaining).toBe(0);
  });

  it('preserves a valid carried input across save/load while its real detour leaves the ingredient radius', () => {
    let { s, benchId } = fixture();
    const source = pos(18), radius = 3;
    // Both endpoints are inside the radius, but this two-cell-high wall forces
    // the actual return path around y=12 or y=20. Pawns are never teleported.
    for (let y = 13; y <= 19; y++) for (let z = 8; z <= 9; z++)
      s.blocks[index(17, y, z)] = Block.Stone;
    material(s, 'wood', 40, source); s = VoxelSimulation.load(s.save()); enable(s, 'craft', 0);
    const workerId = s.pawns[0].id;
    const id = add(s, benchId, 'smith:woodClub', policy({ workerId, ingredientRadius: radius }));
    const distanceSquared = (p: Pos) => (p.x - 16) ** 2 + (p.y - 16) ** 2 + (p.z - 8) ** 2;
    until(s, () => s.pawns[0].cargo?.resource === 'wood', 600);
    expect(s.pawns[0]).toMatchObject(source);
    expect(distanceSquared(s.pawns[0])).toBeLessThan(radius ** 2);
    const pickupTick = s.tick, jobId = getJob(s, id)!.id;
    until(s, () => s.pawns[0].cargo?.resource === 'wood' && distanceSquared(s.pawns[0]) >= radius ** 2, 600);
    expect(s.tick).toBeGreaterThan(pickupTick);
    expect(s.pawns[0].jobId).toBe(jobId);
    expect(getJob(s, id)?.delivered.wood ?? 0).toBe(0);
    const checkpoint = s.save(), carried = structuredClone(s.pawns[0].cargo), counts = s.counts();
    s = VoxelSimulation.load(checkpoint);
    expect(s.counts()).toEqual(counts);
    expect(s.pawns[0].cargo).toEqual(carried);
    expect(s.pawns[0].jobId).toBe(jobId);
    expect(getJob(s, id)).toMatchObject({ id: jobId, owner: workerId, productionPolicy: { ingredientRadius: radius } });
    expect(distanceSquared(s.pawns[0])).toBeGreaterThanOrEqual(radius ** 2);
    until(s, () => s.stats.weaponsMade === 1);
    expect(getBill(s, id).remaining).toBe(0); expect(s.stats.consumed.wood).toBe(40);
    expect(s.pawns[0].cargo).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('refunds inputs excluded by an edited filter when a carried batch is suspended', () => {
    let { s, benchId } = fixture('stove'); material(s, 'grain', 10); material(s, 'wood', 1, pos(17, 17)); enable(s, 'cook', 0);
    const id = add(s, benchId, 'cook', policy({ allowedFood: ['grain'] }));
    until(s, () => s.pawns[0].cargo?.resource === 'grain');
    const before = s.counts();
    command(s, { type: 'productionBillUpdate', benchId, billId: id, patch: { policy: policy({ allowedFood: ['meat'] }), suspended: true } });
    expect(s.counts()).toEqual(before);
    until(s, () => !s.jobs.some(job => job.billId === id) && s.pawns.every(p => p.cargo === null));
    expect(s.counts().grain).toBe(10); expect(s.counts().wood).toBe(1);
    expect(s.stats.consumed.grain).toBe(0); expect(s.stats.consumed.wood).toBe(0); expect(s.stats.cooked).toBe(0);
    s = VoxelSimulation.load(s.save());
    expect(getBill(s, id)).toMatchObject({ remaining: 1, suspended: true, policy: { allowedFood: ['meat'] } });
  });

  it('returns a deceased named-worker bill to any worker and rejects a new assignment to the deceased pawn', () => {
    const { s, benchId } = fixture(), deceased = s.pawns[0];
    const id = add(s, benchId, 'smith:woodClub', policy({ workerId: deceased.id }));
    applyInjury(deceased.trauma, s.nextId++, 'torso', 'cut', 100);
    until(s, () => deceased.dead && getBill(s, id).policy.workerId === null, 100);
    expect(s.notice).toContain('指定生产工人');
    expect(s.command({ type: 'productionBillUpdate', benchId, billId: id, patch: { policy: policy({ workerId: deceased.id }) } }).ok).toBe(false);
    material(s, 'wood', 40); enable(s, 'craft', 1);
    until(s, () => s.stats.weaponsMade === 1);
    expect(getBill(s, id).remaining).toBe(0);
  });
});

describe('production policy command isolation and save migration', () => {
  it('clones command policy objects and rejects invalid settings without partial changes', () => {
    const { s, benchId } = fixture(), id = add(s, benchId, 'smith:woodClub');
    const submitted = policy({ workerId: s.pawns[1].id, ingredientRadius: 8 }), expected = structuredClone(submitted);
    command(s, { type: 'productionBillUpdate', benchId, billId: id, patch: { policy: submitted } });
    submitted.allowedFood.length = 0; submitted.allowedCarcasses.reverse(); submitted.workerId = s.nextId + 100; submitted.ingredientRadius = 2;
    expect(getBill(s, id).policy).toEqual(expected);
    const before = structuredClone(s.productionQueues);
    for (const invalid of [
      { ...expected, extra: true }, { ...expected, workerId: s.nextId + 100 }, { ...expected, skillMin: 9, skillMax: 8 },
      { ...expected, ingredientRadius: 2 }, { ...expected, allowedFood: ['grain', 'grain'] },
    ]) {
      expect(s.command({ type: 'productionBillUpdate', benchId, billId: id, patch: { policy: invalid } } as VoxelCommand).ok).toBe(false);
      expect(s.productionQueues).toEqual(before);
    }
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('rejects malformed v40 policies, absent live workers and policy fields on non-production jobs', () => {
    const { s, benchId } = fixture(); add(s, benchId, 'smith:woodClub');
    const badPolicies = [
      { ...policy(), unknown: true }, { ...policy(), workerId: s.nextId + 50 },
      { ...policy(), ingredientRadius: 101 }, { ...policy(), skillMin: 5, skillMax: 4 },
    ];
    for (const bad of badPolicies) {
      const save = s.save(); save.productionQueues[0].bills[0].policy = bad;
      expect(() => VoxelSimulation.load(save)).toThrow();
    }
    const missing = s.save() as any; delete missing.productionQueues[0].bills[0].policy;
    expect(() => VoxelSimulation.load(missing)).toThrow();
    const badJob = s.save(); badJob.jobs.find(job => job.kind === 'smith')!.productionPolicy = policy({ ingredientRadius: 1 });
    expect(() => VoxelSimulation.load(badJob)).toThrow();
    command(s, { type: 'designate', tool: 'mine', from: pos(9, 12) });
    const wrongKind = s.save(); wrongKind.jobs.find(job => job.kind === 'mine')!.productionPolicy = policy();
    expect(() => VoxelSimulation.load(wrongKind)).toThrow();
  });

  it('migrates the authentic v39 working batch with its delivered wood, progress, queues and pawn inventory intact', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v39-mid-production-before-policies.json', import.meta.url));
    const provenance = JSON.parse(readFileSync(new URL('./fixtures/voxel-v39-mid-production-before-policies.provenance.json', import.meta.url), 'utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
    const old = JSON.parse(bytes.toString()), s = VoxelSimulation.load(old), saved = s.save();
    expect(old.version).toBe(39); expect(saved.version).toBe(52);
    expect(old.jobs.some((job: any) => job.kind === 'smith' && job.progress > 0 && job.delivered.wood === 40)).toBe(true);
    for (const key of ['items', 'nextId', 'blocks', 'stoves', 'stonecutters', 'tailors', 'weaponBenches', 'butcherSpots'] as const)
      expect(saved[key], key).toEqual(old[key]);
    const stats = structuredClone(saved.stats);
    for (const key of ['produced', 'consumed', 'destroyed', 'spoiled'] as const) {
      expect(stats[key].unfinished).toBe(0);
      expect(stats[key].milk).toBe(0);
      expect(stats[key].alpacaWool).toBe(0);
      expect(stats[key].eggUnfertilized).toBe(0); expect(stats[key].eggFertilized).toBe(0);
      delete (stats[key] as Partial<typeof stats[typeof key]>).unfinished;
      delete (stats[key] as Partial<typeof stats[typeof key]>).milk;
      delete (stats[key] as Partial<typeof stats[typeof key]>).alpacaWool;
      delete (stats[key] as Partial<typeof stats[typeof key]>).eggUnfertilized;
      delete (stats[key] as Partial<typeof stats[typeof key]>).eggFertilized;
    }
    expect(stats).toEqual(old.stats);
    expect(saved.productionQueues.map(queue => ({ ...queue, bills: queue.bills.map(({ policy: _policy, ...bill }) => bill) })))
      .toEqual(old.productionQueues.map((queue: any) => ({ ...queue,
        bills: queue.bills.map((bill: any) => ({ ...bill, output: { mode: 'drop', target: null } })) })));
    const historicalPolicy = policy({ allowedFood: ['grain', 'meat', 'milk'], allowedCarcasses: ['hare', 'deer', 'alpaca', 'dromedary'], allowedTextiles: ['cloth'] });
    expect(saved.productionQueues.every(queue => queue.bills.every(bill => JSON.stringify(bill.policy) === JSON.stringify(historicalPolicy)))).toBe(true);
    const pawnState = (pawn: Pawn) => ({ id: pawn.id, x: pawn.x, y: pawn.y, z: pawn.z, food: pawn.food, rest: pawn.rest,
      health: pawn.health, skills: pawn.skills, cargo: pawn.cargo, worn: pawn.worn, weapon: pawn.weapon, trauma: pawn.trauma });
    expect(saved.pawns.map(pawnState)).toEqual(old.pawns.map(pawnState));
    const previous = old.jobs.find((job: any) => job.kind === 'smith' && job.progress > 0), current = saved.jobs.find(job => job.id === previous.id)!;
    for (const key of ['id', 'kind', 'billId', 'progress', 'work', 'workTicks', 'cost', 'delivered', 'deliveredBatches'] as const)
      expect(current[key], key).toEqual(previous[key]);
    expect(current.productionPolicy).toEqual(historicalPolicy);
    const remaining = getBill(s, previous.billId).remaining, consumed = s.stats.consumed.wood;
    until(s, () => s.stats.weaponsMade === old.stats.weaponsMade + 1);
    expect(getBill(s, previous.billId).remaining).toBe(remaining - 1);
    expect(s.stats.consumed.wood).toBe(consumed + 40);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
});
