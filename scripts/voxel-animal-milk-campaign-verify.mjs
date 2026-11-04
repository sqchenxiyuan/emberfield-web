// Natural generated-world evidence only. No native game, browser, preview or GUI.
import assert from 'node:assert/strict';
import { build, version as esbuildVersion } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd(), output = resolve('test-results/animal-milk-campaign');
mkdirSync(output, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = new Map();
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'campaign-source-identity', setup(api) {
    api.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, ({ path }) => {
      const bytes = readFileSync(path), name = relative(root, path).split(sep).join('/');
      assert.ok(name.startsWith('src/')); sources.set(name, sha(bytes));
      return { contents: bytes, loader: name.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) };
    });
  } }],
});
const bundlePath = resolve(output, 'executed-world-v49.mjs');
writeFileSync(bundlePath, bundle.outputFiles[0].contents);
const { VoxelSimulation } = await import(pathToFileURL(bundlePath).href);
const DAY = 12000, point = p => ({ x: p.x, y: p.y, z: p.z }), cell = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const settings = { biome: 'desert', hilliness: 'flat', meanTemperature: 24, rainfall: 120, latitude: 0 };
let world = new VoxelSimulation(73129, settings);
const initial = world.save(), initialCounts = world.counts();
const colonyIds = world.pawns.filter(p => p.faction === 'colony').map(p => p.id);
const report = { status: 'running', startedAt: new Date().toISOString(), nativeGameplay: false, browserInteraction: false,
  scope: 'Fresh generated desert. State changes only through public player commands, ordinary ticks and exact save/load. No terrain, supplies, skills, animal species, ownership, hunger, age, growth, fullness, RNG, task or clock injection. Read-only terrain/path inspection selects ordinary buildable sites. Proves one natural resource chain and interruption/reload boundaries, not long-term balance or native visual equivalence.',
  execution: { version: initial.version, esbuildVersion, bundleSha256: sha(bundle.outputFiles[0].contents),
    sourceCount: sources.size, sources: Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b))),
    script: 'scripts/voxel-animal-milk-campaign-verify.mjs', scriptSha256: sha(readFileSync(new URL(import.meta.url))) },
  baseline: { seed: world.seed, settings: world.settings, counts: initialCounts, colonyIds,
    blocksSha256: sha(Buffer.from(world.blocks)), animals: structuredClone(world.animals),
    pawnSkills: world.pawns.map(p => ({ id: p.id, skills: structuredClone(p.skills) })), treeCount: world.trees.length },
  checks: [], commands: [], checkpoints: [], observations: [], milkTransfers: [], daily: [], auditedTicks: 0 };
const reportPath = resolve(output, 'report.json');
const writeReport = () => {
  const bytes = JSON.stringify(report, null, 2);
  writeFileSync(reportPath, bytes); writeFileSync(resolve('test-results/animal-milk-campaign.json'), bytes);
};
const animal = id => world.animals.find(a => a.id === id);
const worker = id => world.pawns.find(p => p.id === id);
let targetId, handlerId, gathering = false, allowMilkConsumption = false;
const milkCells = new Set(), transitions = new Map(), milkCargoTransitions = new Map();
function accounting() {
  const counts = world.counts();
  return Object.fromEntries(Object.keys(initialCounts).map(r => [r, counts[r] + world.stats.consumed[r]
    + world.stats.spoiled[r] + world.stats.destroyed[r] + world.trade.exported[r]
    - world.stats.produced[r] - world.trade.imported[r]]));
}
const balances = accounting();
function audit() {
  assert.deepEqual(accounting(), balances, `physical resource conservation at ${world.tick}`);
  assert.equal(world.pawns.filter(p => colonyIds.includes(p.id)).length, 3);
  for (const id of colonyIds) assert.ok(worker(id) && !worker(id).dead && !worker(id).downed, `colonist ${id} remains alive/mobile at ${world.tick}`);
  assert.equal(new Set(world.animals.map(a => a.id)).size, world.animals.length);
  if (targetId !== undefined) assert.ok(animal(targetId) && !animal(targetId).dead, `original female dromedary ${targetId} retained at ${world.tick}`);
  assert.ok(world.stats.produced.milk <= 18, 'single selected natural milk batch, without duplicate output');
  if (!allowMilkConsumption) assert.equal(world.stats.consumed.milk, 0, 'milk not consumed before its designated production bill');
}
function check(name, detail = {}) { report.checks.push({ name, tick: world.tick, ...detail }); console.log(`PASS ${world.tick} ${name}`); writeReport(); }
function command(c, required = true) {
  const result = world.command(c); report.commands.push({ tick: world.tick, command: c, result });
  if (required) assert.ok(result.ok, JSON.stringify({ c, result })); audit(); return result;
}
const place = (tool, from, extra = {}) => command({ type: 'designate', tool, from: point(from), ...extra });
function step() {
  assert.ok(world.tick < DAY * 20, 'campaign bounded to twenty natural days');
  const before = targetId === undefined ? null : animal(targetId);
  const fullness = before?.milkFullness, beforeHunger = before?.hunger, beforeFaction = before?.faction;
  world.step(); audit(); report.auditedTicks++;
  if (gathering && beforeFaction === 'colony' && fullness < 1 && animal(targetId).milkFullness > fullness)
    report.milkGrowthTicks = (report.milkGrowthTicks ?? 0) + 1;
  for (const p of world.pawns) if (p.handleTask?.action === 'milk' && p.handleTask.animalId === targetId) {
    milkCells.add(cell(p));
    const signature = `${p.handleTask.stage}:${cell(p)}:${Math.floor(p.handleTask.progress / 50)}`;
    if (transitions.get(p.id) !== signature) {
      report.observations.push({ tick: world.tick, pawnId: p.id, point: point(p),
        task: structuredClone(p.handleTask), pathLength: p.path.length, fullness: animal(targetId).milkFullness, beforeHunger });
      transitions.set(p.id, signature);
    }
  }
  for (const p of world.pawns) if (p.cargo?.resource === 'milk') {
    const signature = `${cell(p)}:${p.cargo.amount}:${p.jobId}:${p.phase}`;
    if (milkCargoTransitions.get(p.id) !== signature) {
      report.milkTransfers.push({ tick: world.tick, pawnId: p.id, point: point(p), phase: p.phase,
        batch: structuredClone(p.cargo), jobId: p.jobId, jobKind: world.jobs.find(j => j.id === p.jobId)?.kind ?? null });
      milkCargoTransitions.set(p.id, signature);
    }
  }
  if (!report.storedMilk) {
    const stored = world.items.find(i => i.resource === 'milk' && world.stockpiles.some(s => cell(s) === cell(i) && s.accepts.includes('milk')));
    if (stored) report.storedMilk = { tick: world.tick, batch: structuredClone(stored) };
  }
  if (world.tick % DAY === 0) {
    const day = { tick: world.tick, counts: world.counts(), produced: { ...world.stats.produced },
      target: targetId === undefined ? null : structuredClone(animal(targetId)),
      pawns: world.pawns.map(p => ({ id: p.id, food: p.food, rest: p.rest, phase: p.phase, reason: p.reason })) };
    report.daily.push(day); console.log('DAY', world.tick / DAY, JSON.stringify({ counts: day.counts, target: day.target && { hunger: day.target.hunger, faction: day.target.faction, milkFullness: day.target.milkFullness } })); writeReport();
  }
}
function until(name, predicate, limit = DAY * 3) {
  const started = world.tick;
  while (!predicate() && world.tick - started < limit) step();
  assert.ok(predicate(), `${name}: ${JSON.stringify({ tick: world.tick, target: targetId === undefined ? null : animal(targetId), counts: world.counts(),
    pawns: world.pawns.map(p => ({ id: p.id, point: point(p), food: p.food, rest: p.rest, phase: p.phase, reason: p.reason, task: p.handleTask, cargo: p.cargo })),
    jobs: world.jobs.map(j => ({ id: j.id, kind: j.kind, reason: j.reason, progress: j.progress, delivered: j.delivered })) })}`);
  check(name, { elapsedTicks: world.tick - started });
}
function checkpoint(name) {
  const saved = world.save(), bytes = Buffer.from(JSON.stringify(saved)), path = resolve(output, `${name}.json`);
  writeFileSync(path, bytes);
  report.checkpoints.push({ name, file: relative(root, path).split(sep).join('/'), sha256: sha(bytes), byteLength: bytes.length,
    tick: saved.tick, version: saved.version, counts: world.counts(), target: targetId === undefined ? null : structuredClone(animal(targetId)),
    handler: handlerId === undefined ? null : { id: handlerId, point: point(worker(handlerId)), task: structuredClone(worker(handlerId).handleTask) } });
  return saved;
}
function roundTrip(name) {
  const saved = checkpoint(name), before = structuredClone(saved);
  world = VoxelSimulation.load(saved); const after = world.save();
  for (const key of ['animals', 'items', 'stats', 'tick', 'blocks', 'water', 'bridges']) assert.deepEqual(after[key], saved[key], `reload preserves ${key}`);
  assert.deepEqual(after.pawns.map(p => p.handleTask), saved.pawns.map(p => p.handleTask));
  assert.deepEqual(saved, before); audit(); check('exact reload preserves natural animal fullness, work and physical cargo', { checkpoint: name });
}

try {
  assert.equal(initial.version, 49); assert.equal(colonyIds.length, 3); assert.equal(initialCounts.grain, 0); assert.equal(initialCounts.milk, 0);
  const regenerated = new VoxelSimulation(world.seed, settings);
  assert.deepEqual(regenerated.animals, world.animals); assert.deepEqual(regenerated.blocks, world.blocks);
  handlerId = [...world.pawns].sort((a, b) => b.skills.animals.level - a.skills.animals.level)[0].id;
  assert.ok(worker(handlerId).skills.animals.level >= 2);
  targetId = world.animals.filter(a => a.species === 'dromedary' && a.sex === 'female' && a.faction === 'wild' && world.path(worker(handlerId), a) !== null)
    .sort((a, b) => distance(a, world.spawn) - distance(b, world.spawn))[0]?.id;
  assert.ok(targetId, 'generated desert supplies a naturally female reachable dromedary');
  report.workers = { handlerId }; report.targetId = targetId;
  assert.equal(animal(targetId).milkFullness, 0);
  check('reproducible fresh desert has a real adult female dromedary and no raw feed or milk', { targetId, handlerId }); checkpoint('generated-initial');
  command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
  for (const p of world.pawns) {
    command({ type: 'priority', pawnId: p.id, work: 'hunt', value: 0 });
    command({ type: 'priority', pawnId: p.id, work: 'handle', value: 0 });
  }
  const reachable = p => world.standable(p) && world.path(world.pawns[0], p) !== null;
  const surface = [], reserved = new Set([...world.items, ...world.stockpiles, ...world.trees].map(cell));
  for (let y = 2; y < 62; y++) for (let x = 2; x < 62; x++) {
    let z = 14; while (z > 0 && !world.blocks[cell({ x, y, z })]) z--;
    const p = { x, y, z: z + 1 }; if (reachable(p)) surface.push(p);
  }
  surface.sort((a, b) => distance(a, world.spawn) - distance(b, world.spawn));
  function site(tool, width = 1) {
    for (const p of surface) {
      const cells = Array.from({ length: width }, (_, i) => ({ ...p, x: p.x + i }));
      if (!cells.every(q => reachable(q) && !reserved.has(cell(q)))) continue;
      if (!command({ type: 'designate', tool, from: point(p), axis: 'x' }, false).ok) continue;
      cells.forEach(q => reserved.add(cell(q))); return p;
    }
    throw Error(`No legal generated construction site for ${tool}`);
  }
  const trees = world.trees.filter(t => t.growth >= .8 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reachable({ ...t, x: t.x + dx, y: t.y + dy })))
    .sort((a, b) => distance(a, world.spawn) - distance(b, world.spawn)).slice(0, 16);
  report.harvestTrees = trees.map(t => ({ id: t.id, species: t.species, growth: t.growth, point: point(t) }));
  for (const tree of trees) place('cut', tree);
  for (let n = 0; n < 3; n++) site('bed', 2);
  site('stove'); site('horseshoePin');
  // A milk animal must actually be contained; leaving a pen species loose is
  // allowed to roam off-map before its two-day milk interval has elapsed.
  const penOrigin = surface.find(origin => origin.x < 55 && origin.y < 55 &&
    Array.from({ length: 64 }, (_, i) => ({ x: origin.x + i % 8, y: origin.y + Math.floor(i / 8), z: origin.z }))
      .every(p => reachable(p) && !reserved.has(cell(p))));
  assert.ok(penOrigin, 'generated desert has a genuine clear eight-by-eight enclosure site');
  const penCells = Array.from({ length: 64 }, (_, i) => ({ x: penOrigin.x + i % 8, y: penOrigin.y + Math.floor(i / 8), z: penOrigin.z }));
  const gate = { ...penOrigin, x: penOrigin.x + 3 }, marker = { ...penOrigin, x: penOrigin.x + 3, y: penOrigin.y + 3 };
  const boundary = penCells.filter(p => p.x === penOrigin.x || p.x === penOrigin.x + 7 || p.y === penOrigin.y || p.y === penOrigin.y + 7);
  for (const p of boundary) if (cell(p) !== cell(gate)) place('fence', p);
  place('fenceGate', gate, { axis: 'x' }); place('penMarker', marker);
  for (const p of penCells) reserved.add(cell(p));
  for (const dy of [2, 3, 4]) {
    const p = { ...penOrigin, x: penOrigin.x + 2, y: penOrigin.y + dy };
    place('stock', p); command({ type: 'storage', from: p, priority: 3, accepts: ['grain'] });
  }
  report.pen = { origin: penOrigin, gate, marker, boundary, nutritionSource: 'ordinary hauled grain plus any naturally generated grass' };
  for (const p of surface.filter(p => !reserved.has(cell(p))).slice(0, 24)) {
    reserved.add(cell(p)); place('stock', p); command({ type: 'storage', from: point(p), priority: 2, accepts: ['grain', 'meal', 'milk', 'wood'] });
  }
  const farms = surface.filter(p => !reserved.has(cell(p)) && [1, 8, 10].includes(world.blocks[cell({ ...p, z: p.z - 1 })])).slice(0, 160);
  assert.equal(farms.length, 160, 'generated desert has 160 reachable fertile cells');
  report.farms = farms.map(point);
  for (const p of farms) { place('farm', p, { crop: 'rice' }); reserved.add(cell(p)); }
  checkpoint('public-designations');
  until('ordinary labor builds beds, stove, recreation and a real closed pen from original supplies and cut cacti',
    () => world.beds.length === 3 && world.stoves.length === 1 && world.horseshoePins.length === 1 &&
      world.fences.length === boundary.length - 1 && world.fenceGates.length === 1 && world.penMarkers.length === 1, DAY * 3);
  const penId = world.penMarkers[0].id;
  assert.equal(world.snapshot().penSummaries.find(p => p.markerId === penId)?.closed, true);
  command({ type: 'penFilter', markerId: penId, filter: { deer: false, dromedary: true, male: false, female: true } });
  report.pen.markerId = penId;
  const stoveId = world.stoves[0].id, grainBillId = `legacy:${stoveId}:cook`;
  command({ type: 'productionBillUpdate', benchId: stoveId, billId: grainBillId, patch: { target: 8,
    policy: { workerId: null, skillMin: 0, skillMax: 20, ingredientRadius: null, allowedFood: ['grain', 'meat'], allowedCarcasses: ['hare', 'deer', 'dromedary'] } } });
  until('natural rice sowing and growth produce actual harvested taming feed', () => world.counts().grain >= 60, DAY * 12);
  assert.ok(world.stats.produced.grain >= 60); checkpoint('naturally-harvested-feed');
  command({ type: 'priority', pawnId: handlerId, work: 'handle', value: 1 });
  for (const work of ['grow', 'cook', 'build', 'cut', 'haul']) command({ type: 'priority', pawnId: handlerId, work, value: 2 });
  command({ type: 'animalOrder', animalId: targetId, order: 'tame', enabled: true });
  until('handler carries harvested rice to the original marked female', () => worker(handlerId).handleTask?.animalId === targetId && worker(handlerId).handleTask?.stage === 'approach' && worker(handlerId).cargo?.resource === 'grain');
  checkpoint('actual-taming-approach');
  until('ordinary repeated feeding physically tames the generated female', () => animal(targetId).faction === 'colony', DAY * 4);
  const tamedTick = world.tick;
  report.taming = { tick: tamedTick, grainProduced: world.stats.produced.grain, grainConsumed: world.stats.consumed.grain,
    events: world.husbandryLog.filter(e => e.animalId === targetId), animal: structuredClone(animal(targetId)) };
  assert.ok(report.taming.events.some(e => e.kind === 'tame'));
  assert.equal(animal(targetId).milkFullness, 0); gathering = true;
  checkpoint('naturally-tamed');
  command({ type: 'ropeAnimal', animalId: targetId, penId, paused: false });
  until('handler physically ropes the original female inside the constructed enclosure', () =>
    animal(targetId).z === penOrigin.z && animal(targetId).x > penOrigin.x && animal(targetId).x < penOrigin.x + 7 &&
    animal(targetId).y > penOrigin.y && animal(targetId).y < penOrigin.y + 7 &&
    !world.pawns.some(p => p.ropeTask?.animalId === targetId), DAY);
  assert.ok(world.snapshot().penSummaries.find(p => p.markerId === penId)?.animalIds.includes(targetId));
  roundTrip('naturally-roped-into-pen');
  command({ type: 'priority', pawnId: handlerId, work: 'handle', value: 0 });
  until('two natural days of domestic adult biology fill one milk batch', () => animal(targetId).milkFullness === 1, DAY * 4);
  assert.ok(world.tick - tamedTick >= 2 * DAY); assert.equal(world.stats.produced.milk, 0);
  report.maturation = { tamedTick, fullTick: world.tick, elapsedTicks: world.tick - tamedTick, growthTicks: report.milkGrowthTicks,
    fullness: animal(targetId).milkFullness, hunger: animal(targetId).hunger };
  roundTrip('naturally-full-milk');
  // Public movement establishes a real milking approach rather than an adjacent fixture.
  const staging = surface.find(p => distance(p, animal(targetId)) >= 10 && world.standable(p) && world.path(worker(handlerId), p) !== null);
  assert.ok(staging); command({ type: 'draft', pawnId: handlerId, drafted: true });
  command({ type: 'move', pawnId: handlerId, target: point(staging) });
  until('handler physically walks to the chosen staging cell', () => cell(worker(handlerId)) === cell(staging), DAY);
  command({ type: 'priority', pawnId: handlerId, work: 'handle', value: 1 });
  command({ type: 'draft', pawnId: handlerId, drafted: false });
  until('handler follows a real route to the milk-ready animal', () => worker(handlerId).handleTask?.action === 'milk' && worker(handlerId).path.length > 0);
  checkpoint('actual-milk-approach');
  until('handler reaches the animal and performs partial gathering work', () => worker(handlerId).handleTask?.action === 'milk' && worker(handlerId).handleTask.progress >= 60);
  assert.ok(milkCells.size > 1); roundTrip('partial-milk-work');
  const cancelledProgress = worker(handlerId).handleTask.progress;
  command({ type: 'draft', pawnId: handlerId, drafted: true });
  assert.equal(worker(handlerId).handleTask, null);
  for (let n = 0; n < 40; n++) step();
  assert.equal(world.stats.produced.milk, 0); assert.equal(animal(targetId).milkFullness, 1);
  check('draft cancellation keeps full biological milk and creates no output', { cancelledProgress, waitedTicks: 40 }); checkpoint('cancelled-milk-work');
  command({ type: 'draft', pawnId: handlerId, drafted: false });
  until('undrafted handler starts fresh gathering work', () => worker(handlerId).handleTask?.action === 'milk');
  assert.ok(worker(handlerId).handleTask.progress < cancelledProgress);
  until('restored gathering performs fresh partial work', () => worker(handlerId).handleTask?.action === 'milk' && worker(handlerId).handleTask.progress >= 100);
  roundTrip('resumed-milk-work');
  until('completed ordinary gathering creates exactly eighteen physical milk units', () => world.stats.produced.milk === 18, DAY);
  const milkingTick = world.tick, milk = world.items.filter(i => i.resource === 'milk');
  assert.equal(milk.reduce((n, b) => n + b.amount, 0), 18);
  assert.ok(animal(targetId).milkFullness < .001); assert.equal(world.husbandryLog.filter(e => e.kind === 'milked' && e.animalId === targetId).length, 1);
  report.milking = { tick: milkingTick, walkingCells: milkCells.size, output: structuredClone(milk),
    skill: structuredClone(worker(handlerId).skills.animals), animal: structuredClone(animal(targetId)) };
  command({ type: 'priority', pawnId: handlerId, work: 'handle', value: 0 });
  for (const item of milk) command({ type: 'itemForbidden', itemId: item.id, forbidden: true });
  roundTrip('real-milk-batch');
  command({ type: 'productionBillDelete', benchId: stoveId, billId: grainBillId });
  command({ type: 'productionBillAdd', benchId: stoveId, recipe: 'cook' });
  const billId = world.productionQueues.find(q => q.benchId === stoveId).bills.at(-1).id;
  command({ type: 'productionBillUpdate', benchId: stoveId, billId, patch: { mode: 'count', remaining: 1,
    policy: { workerId: null, skillMin: 0, skillMax: 20, ingredientRadius: null, allowedFood: ['milk'], allowedCarcasses: ['hare', 'deer', 'dromedary'] } } });
  for (const item of milk) command({ type: 'itemForbidden', itemId: item.id, forbidden: false });
  const priorMeal = world.stats.produced.meal; allowMilkConsumption = true;
  until('cook carries the real milk into the milk-only meal job', () => world.jobs.some(j => j.kind === 'cook' && j.billId === billId && j.delivered.milk > 0));
  const milkJob = world.jobs.find(j => j.kind === 'cook' && j.billId === billId);
  assert.equal(milkJob.cost.milk, 10); assert.equal(milkJob.cost.grain ?? 0, 0); assert.equal(milkJob.cost.meat ?? 0, 0);
  roundTrip('milk-delivered-to-stove');
  until('one milk-only cooking cycle consumes ten milk and produces a physical meal', () => world.stats.consumed.milk === 10 && world.stats.produced.meal === priorMeal + 1);
  assert.equal(world.productionQueues.find(q => q.benchId === stoveId).bills.find(b => b.id === billId).remaining, 0);
  assert.equal(world.stats.produced.milk, 18); assert.equal(world.counts().milk, 8);
  for (const item of world.items.filter(i => i.resource === 'milk')) command({ type: 'itemForbidden', itemId: item.id, forbidden: true });
  report.cooking = { billId, priorMeal, producedMeals: world.stats.produced.meal, consumedMilk: world.stats.consumed.milk,
    remainingMilk: world.counts().milk, tick: world.tick };
  for (let n = 0; n < 100; n++) step();
  assert.equal(world.stats.produced.milk, 18); assert.equal(world.stats.consumed.milk, 10);
  roundTrip('finished-natural-milk-chain');
  check('natural farming, taming, accumulation, interrupted milking and milk-only cooking retain exact physical accounting');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack ?? error); checkpoint('failure'); process.exitCode = 1;
} finally {
  report.finalTick = world.tick; report.finishedAt = new Date().toISOString(); report.stats = structuredClone(world.stats);
  report.continuationTicks = world.tick - initial.tick;
  report.finalCounts = world.counts();
  report.outputs = { milkProduced: world.stats.produced.milk, milkConsumed: world.stats.consumed.milk,
    milkSpoiled: world.stats.spoiled.milk, milkDestroyed: world.stats.destroyed.milk, milkRemaining: world.counts().milk,
    mealsProduced: world.stats.produced.meal, milkOnlyMealsProduced: report.cooking ? report.cooking.producedMeals - report.cooking.priorMeal : 0,
    grainProduced: world.stats.produced.grain, woodProduced: world.stats.produced.wood };
  writeReport();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, finalTick: world.tick,
    auditedTicks: report.auditedTicks, output, error: report.error?.slice(0, 1500) }));
}
