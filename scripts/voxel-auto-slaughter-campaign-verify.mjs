// Continue an authentic naturally-born v29 animal using public v48 commands.
// Headless simulation only: no native game, browser, preview or GUI interaction.
import assert from 'node:assert/strict';
import { build, version as esbuildVersion } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd(), output = resolve('test-results/auto-slaughter-campaign');
mkdirSync(output, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixturePath = 'tests/fixtures/voxel-v29-pens-newborn.json';
const proofPath = 'tests/fixtures/voxel-v29-pens-newborn.provenance.json';
const frozenPath = 'docs/research/rimworld/evidence/voxel-husbandry-validation.json';
const bytes = readFileSync(fixturePath), proofBytes = readFileSync(proofPath), frozenBytes = readFileSync(frozenPath);
const proof = JSON.parse(proofBytes), frozen = JSON.parse(frozenBytes), raw = JSON.parse(bytes);
const expected = '7212b5c2531d6249d316bf9432ed80c67ade2f4894af4e96d1d59432b53a2aaf';
assert.equal(hash(bytes), expected); assert.equal(proof.sha256, expected);
assert.equal(proof.version, 29); assert.equal(raw.version, 29); assert.equal(raw.tick, proof.tick);
assert.equal(proof.source, 'test-results/voxel-husbandry/newborn.json');
assert.deepEqual(proof.campaignExecution, frozen.campaign.execution);
assert.equal(frozen.campaign.fixtures.newborn.sha256, expected);
assert.equal(frozen.campaign.fixtures.newborn.tick, raw.tick);
assert.equal(frozen.campaign.fixtures.newborn.file, proof.source);

const sources = new Map();
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'campaign-source-identity', setup(api) {
    api.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, ({ path }) => {
      const content = readFileSync(path), local = relative(root, path).split(sep).join('/');
      assert.ok(local.startsWith('src/')); sources.set(local, hash(content));
      return { contents: content, loader: local.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) };
    });
  } }],
});
const bundlePath = resolve(output, 'world-v48.mjs'); writeFileSync(bundlePath, bundle.outputFiles[0].contents);
const { VoxelSimulation } = await import(pathToFileURL(bundlePath).href);
const inputBefore = structuredClone(raw);
let world = VoxelSimulation.load(raw);
assert.deepEqual(raw, inputBefore); assert.equal(world.save().version, 48);
const childId = 1592, fatherId = 475, motherId = 477;
const child = () => world.animals.find(a => a.id === childId);
const point = p => ({ x: p.x, y: p.y, z: p.z });
const cell = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
assert.equal(child().faction, 'colony'); assert.equal(child().sex, 'female'); assert.equal(child().growth, 0);
assert.equal(child().ageTicks, 0); assert.equal(child().slaughter, false);
assert.ok(raw.husbandryLog.some(e => e.kind === 'birth' && e.animalId === motherId && e.otherId === childId && e.tick === raw.tick));
assert.ok(raw.husbandryLog.some(e => e.kind === 'pregnancy' && e.animalId === motherId && e.otherId === fatherId));
const initial = world.save(), initialCounts = world.counts(), colonyIds = world.pawns.filter(p => p.faction === 'colony').map(p => p.id);
assert.equal(colonyIds.length, 3);
const report = { status: 'running', startedAt: new Date().toISOString(), nativeGameplay: false, browserInteraction: false,
  scope: 'Headless continuation of an exact retained v29 model-generated birth checkpoint. Only public commands, ordinary ticks and exact save/load mutate the world. No spawned animals, forged colony ownership, age, pregnancy, inventory, terrain, RNG or task edits. Demonstrates v48 young-female quota selection, real walking/work, in-progress reload, cancellation, one corpse and physical butchering; not full balance or native runtime evidence.',
  provenance: { fixturePath, sha256: expected, byteLength: bytes.length, originalVersion: raw.version, originalTick: raw.tick,
    proofPath, proofSha256: hash(proofBytes), frozenPath, frozenSha256: hash(frozenBytes), originalCampaignExecution: proof.campaignExecution },
  execution: { version: 48, esbuildVersion, bundleSha256: hash(bundle.outputFiles[0].contents), sourceCount: sources.size,
    sources: Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b))),
    script: 'scripts/voxel-auto-slaughter-campaign-verify.mjs', scriptSha256: hash(readFileSync(new URL(import.meta.url))) },
  animalIds: { childId, fatherId, motherId }, checks: [], commands: [], checkpoints: [], observations: [], auditedTicks: 0,
  baseline: { tick: world.tick, counts: initialCounts, stats: structuredClone(world.stats), colonyIds } };

const defaultPolicy = { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
function accounting() {
  const counts = world.counts();
  return Object.fromEntries(Object.keys(counts).map(resource => [resource, counts[resource] + world.stats.consumed[resource]
    + world.stats.spoiled[resource] + world.stats.destroyed[resource] - world.stats.produced[resource]
    - (world.trade.imported[resource] ?? 0) + (world.trade.exported[resource] ?? 0)]));
}
const balances = accounting();
const initialCarcass = world.stats.produced.carcass, initialConsumedCarcass = world.stats.consumed.carcass;
const initialMeat = world.stats.produced.meat, initialHealth = child().health;
let allowDeath = false;
const walkingCells = new Set(), transitions = new Map();
function audit() {
  assert.deepEqual(accounting(), balances, `Physical resource conservation at tick ${world.tick}`);
  for (const id of colonyIds) {
    const pawn = world.pawns.find(p => p.id === id);
    assert.ok(pawn && !pawn.dead && !pawn.downed, `Colonist ${id} remains alive and mobile`);
  }
  for (const id of [fatherId, motherId]) {
    const animal = world.animals.find(a => a.id === id);
    assert.ok(animal && !animal.dead && animal.faction === 'colony', `Parent ${id} retained`);
    assert.equal(animal.slaughter, false);
  }
  assert.equal(new Set(world.animals.map(a => a.id)).size, world.animals.length);
  if (!allowDeath) { assert.ok(child() && !child().dead); assert.equal(child().health, initialHealth); }
  assert.ok(world.stats.produced.carcass - initialCarcass <= 1, 'At most the one selected animal becomes a carcass');
}
function step() {
  assert.ok(world.tick - initial.tick < 10000, 'Whole campaign is bounded to 10000 continuation ticks');
  world.step(); audit(); report.auditedTicks++;
  for (const p of world.pawns) {
    if (p.handleTask?.action === 'autoSlaughter' && p.handleTask.animalId === childId) {
      walkingCells.add(cell(p));
      const task = p.handleTask, signature = `${task.stage}:${cell(p)}:${Math.floor(task.progress / 20)}`;
      if (transitions.get(p.id) !== signature) {
        report.observations.push({ tick: world.tick, pawnId: p.id, point: point(p), task: structuredClone(task), pathLength: p.path.length });
        transitions.set(p.id, signature);
      }
    }
  }
}
function command(c, requireSuccess = true) {
  const result = world.command(c); report.commands.push({ tick: world.tick, command: c, result });
  if (requireSuccess) assert.equal(result.ok, true, JSON.stringify({ c, result })); audit(); return result;
}
function check(name, detail = {}) { report.checks.push({ name, tick: world.tick, ...detail }); console.log(`PASS ${world.tick} ${name}`); }
function until(name, predicate, limit = 5000) {
  const start = world.tick; while (!predicate() && world.tick - start < limit) step();
  assert.ok(predicate(), `${name}: ${JSON.stringify({ tick: world.tick, child: child(),
    pawns: world.pawns.map(p => ({ id: p.id, point: point(p), phase: p.phase, reason: p.reason, handleTask: p.handleTask, cargo: p.cargo, jobId: p.jobId })),
    jobs: world.jobs.map(j => ({ id: j.id, kind: j.kind, reason: j.reason, progress: j.progress, delivered: j.delivered })) })}`);
  check(name, { elapsedTicks: world.tick - start });
}
function checkpoint(name) {
  const saved = world.save(), content = Buffer.from(JSON.stringify(saved)), path = resolve(output, `${name}.json`);
  writeFileSync(path, content);
  report.checkpoints.push({ name, file: relative(root, path).split(sep).join('/'), sha256: hash(content), byteLength: content.length,
    version: saved.version, tick: saved.tick, autoSlaughter: saved.autoSlaughter, counts: world.counts(),
    child: saved.animals.find(a => a.id === childId), pawns: saved.pawns.map(p => ({ id: p.id, point: point(p), handleTask: p.handleTask, cargo: p.cargo, jobId: p.jobId })),
    carcasses: saved.items.filter(i => i.carcass), jobs: saved.jobs.filter(j => j.kind === 'butcher') });
  return saved;
}
function roundTrip(name) {
  const saved = checkpoint(name), before = structuredClone(saved);
  const fields = ['animals', 'items', 'stats', 'autoSlaughter', 'tick', 'blocks', 'water', 'bridges'];
  const previousTasks = saved.pawns.map(p => ({ id: p.id, handleTask: p.handleTask }));
  world = VoxelSimulation.load(saved);
  for (const key of fields) assert.deepEqual(world.save()[key], saved[key], `Exact reload preserves ${key}`);
  assert.deepEqual(world.pawns.map(p => ({ id: p.id, handleTask: p.handleTask })), previousTasks, 'Handler partial work survives exact reload');
  assert.deepEqual(saved, before); audit();
  check('exact save/load preserves physical state and active handling progress', { checkpoint: name });
}
function spotNear(origin, cook) {
  const candidates = [];
  for (let y = Math.max(1, origin.y - 6); y <= Math.min(62, origin.y + 6); y++)
    for (let x = Math.max(1, origin.x - 6); x <= Math.min(62, origin.x + 6); x++) candidates.push({ x, y, z: origin.z });
  candidates.sort((a, b) => distance(a, origin) - distance(b, origin));
  for (const point of candidates) {
    if (!world.standable(point) || world.path(cook, point) === null) continue;
    if (command({ type: 'designate', tool: 'butcherSpot', from: point }, false).ok) return world.butcherSpots.find(s => cell(s) === cell(point));
  }
  throw new Error('No publicly placeable reachable butcher spot near the real carcass');
}

try {
  audit(); checkpoint('migrated-newborn');
  check('exact historical fixture proves the young female was naturally born to the retained pair');
  command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
  const handlerId = world.pawns.slice().sort((a, b) => b.skills.animals.level - a.skills.animals.level)[0].id;
  const cookId = world.pawns.filter(p => p.id !== handlerId).sort((a, b) => b.skills.cooking.level - a.skills.cooking.level)[0].id;
  report.workers = { handlerId, cookId };
  for (const p of world.pawns) {
    for (let hour = 0; hour < 24; hour++) command({ type: 'schedule', pawnId: p.id, hour, assignment: 'work' });
    for (const work of Object.keys(p.priorities)) command({ type: 'priority', pawnId: p.id, work, value: work === 'handle' && p.id === handlerId ? 1 : 0 });
  }
  for (const stove of world.stoves) command({ type: 'bill', stoveId: stove.id, target: stove.target, paused: true });
  command({ type: 'autoSlaughter', species: 'hare', policy: { ...defaultPolicy, youngFemale: 0 } });
  assert.deepEqual(world.snapshot().autoSlaughterStatus.targets, [childId]);
  assert.ok(world.animals.every(a => !a.slaughter), 'Automatic target selection never creates manual slaughter designations');
  check('young-female quota selects only the naturally born child and retains both adults');
  until('handler obtains a real approach path toward the quota-selected child', () => world.pawns.some(p =>
    p.handleTask?.action === 'autoSlaughter' && p.handleTask.animalId === childId && p.handleTask.stage === 'approach' && p.path.length > 0));
  checkpoint('approaching-child');
  until('handler walks adjacent and performs partial automatic slaughter work', () => world.pawns.some(p =>
    p.handleTask?.action === 'autoSlaughter' && p.handleTask.animalId === childId && p.handleTask.stage === 'interact' && p.handleTask.progress >= 25));
  assert.ok(walkingCells.size > 1, 'Actual worker coordinates changed while approaching');
  const firstProgress = world.pawns.find(p => p.id === handlerId).handleTask.progress;
  roundTrip('partial-before-cancel');
  command({ type: 'autoSlaughter', species: 'hare', policy: { ...defaultPolicy } });
  assert.deepEqual(world.snapshot().autoSlaughterStatus.targets, []);
  assert.ok(world.pawns.every(p => p.handleTask?.action !== 'autoSlaughter'));
  for (let n = 0; n < 40; n++) step();
  assert.equal(world.stats.produced.carcass, initialCarcass);
  assert.equal(child().health, initialHealth);
  checkpoint('cancelled-alive');
  check('disabling quota immediately cancels partial work with no animal damage or carcass', { firstProgress, waitedTicks: 40 });
  command({ type: 'autoSlaughter', species: 'hare', policy: { ...defaultPolicy, youngFemale: 0 } });
  assert.deepEqual(world.snapshot().autoSlaughterStatus.targets, [childId]);
  until('restoring quota assigns fresh ordinary automatic work', () => world.pawns.some(p =>
    p.handleTask?.action === 'autoSlaughter' && p.handleTask.animalId === childId));
  const resumed = world.pawns.find(p => p.id === handlerId).handleTask;
  assert.ok(resumed.progress < firstProgress, 'Cancelled partial work does not silently complete a later task');
  until('restored quota progresses through actual work again', () => world.pawns.some(p =>
    p.handleTask?.action === 'autoSlaughter' && p.handleTask.animalId === childId && p.handleTask.stage === 'interact' && p.handleTask.progress >= 40));
  roundTrip('partial-restored-work');
  allowDeath = true;
  until('automatic work kills only the selected child exactly once', () => world.stats.produced.carcass === initialCarcass + 1);
  const slaughterEvents = world.husbandryLog.filter(e => e.kind === 'slaughter' && e.animalId === childId);
  assert.equal(slaughterEvents.length, 1); assert.ok(slaughterEvents[0].message.includes('配额'));
  until('the original animal becomes a real ground carcass with persistent identity', () => world.items.some(i => i.carcass?.animalId === childId));
  const carcass = world.items.find(i => i.carcass?.animalId === childId);
  assert.equal(carcass.carcass.species, 'hare'); assert.equal(carcass.amount, 1);
  assert.deepEqual(world.snapshot().autoSlaughterStatus.targets, []);
  roundTrip('real-carcass');
  const spot = spotNear(carcass, world.pawns.find(p => p.id === cookId));
  report.butcherSpot = { id: spot.id, ...point(spot) };
  command({ type: 'butcherBill', spotId: spot.id, paused: false });
  command({ type: 'priority', pawnId: cookId, work: 'cook', value: 1 });
  until('cook physically collects the identified carcass', () => world.pawns.some(p => p.cargo?.carcass?.animalId === childId));
  checkpoint('carrying-real-carcass');
  until('cook delivers the carcass and performs butcher work', () => world.jobs.some(j => j.kind === 'butcher' && j.progress > 0 && j.deliveredBatches.some(b => b.carcass?.animalId === childId)));
  checkpoint('butchering-original-carcass');
  until('actual butcher work consumes the carcass and produces physical meat', () => world.stats.produced.meat > initialMeat);
  assert.equal(world.stats.consumed.carcass, initialConsumedCarcass + 1);
  assert.equal(world.stats.produced.carcass, initialCarcass + 1);
  assert.equal(world.stats.produced.meat - initialMeat, 18, 'Configured hare yield; provisional balance, not a native numeric claim');
  assert.ok(world.items.some(i => i.resource === 'meat' && i.amount > 0));
  assert.ok(!world.items.some(i => i.carcass?.animalId === childId));
  assert.ok(!world.pawns.some(p => p.cargo?.carcass?.animalId === childId));
  assert.ok(!world.jobs.some(j => j.deliveredBatches.some(b => b.carcass?.animalId === childId)));
  assert.ok(!world.animals.some(a => a.id === childId));
  roundTrip('finished-meat');
  for (let n = 0; n < 60; n++) step();
  assert.equal(world.stats.produced.carcass, initialCarcass + 1); assert.equal(world.stats.produced.meat - initialMeat, 18);
  assert.equal(world.husbandryLog.filter(e => e.kind === 'slaughter' && e.animalId === childId).length, 1);
  check('reloaded completion cannot duplicate the death, corpse, meat or retained adult parents', { observedExtraTicks: 60 });
  checkpoint('final');
  assert.deepEqual(readFileSync(fixturePath), bytes); assert.deepEqual(readFileSync(proofPath), proofBytes); assert.deepEqual(readFileSync(frozenPath), frozenBytes);
  for (const [path, expectedHash] of sources) assert.equal(hash(readFileSync(path)), expectedHash, `Source changed during campaign: ${path}`);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack ?? error); checkpoint('failure'); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.finalTick = world.tick; report.continuationTicks = world.tick - initial.tick;
  report.finalCounts = world.counts(); report.finalStats = structuredClone(world.stats); report.resourceBalances = balances;
  report.outputs = { carcassesProduced: world.stats.produced.carcass - initialCarcass,
    carcassesConsumed: world.stats.consumed.carcass - initialConsumedCarcass, meatProduced: world.stats.produced.meat - initialMeat };
  writeFileSync('test-results/auto-slaughter-campaign.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, auditedTicks: report.auditedTicks,
    continuationTicks: report.continuationTicks, finalTick: report.finalTick, outputs: report.outputs, error: report.error?.slice(0, 1800) }));
}
