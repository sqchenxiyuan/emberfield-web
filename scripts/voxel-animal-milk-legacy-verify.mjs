// Verify the retained unchanged-v48 model checkpoint against the current model.
// This is headless simulation only: no native game, browser, preview or GUI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const root = process.cwd(), baseline = resolve('test-results/animal-milk-v48-baseline');
const output = resolve('test-results/animal-milk-legacy');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenancePath = 'docs/research/rimworld/evidence/animal-milk-v48-provenance.json';
const provenanceBytes = readFileSync(provenancePath), provenance = JSON.parse(provenanceBytes);
assert.deepEqual(provenanceBytes, readFileSync(resolve(baseline, 'provenance.json')));
assert.equal(provenance.status, 'captured');
assert.equal(provenance.head, 'd404f7fb415b2174863e76fcd7ee5ccf697dd45a');
assert.equal(provenance.subtree, '07a386cf087ac52e411b49710af1de240459ea59');
assert.equal(provenance.samples.length, 1);
assert.equal(provenance.samples[0].file, 'working-auto-slaughter.json');
assert.equal(hash(readFileSync(provenance.script)), provenance.scriptSha256);
assert.equal(hash(readFileSync(resolve(baseline, provenance.sourceBundle))), provenance.sourceBundleSha256);
const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { encoding: 'utf8' }).trim();
const gitSource = path => execFileSync('git', ['show', `${provenance.head}:${prefix}${path}`], { maxBuffer: 16 * 1024 * 1024 });
assert.equal(hash(gitSource('src/voxel/world.ts')), provenance.worldSha256);
assert.equal(execFileSync('git', ['rev-parse', `${provenance.head}:${prefix.replace(/\/$/, '')}`], { encoding: 'utf8' }).trim(),
  execFileSync('git', ['rev-parse', `${provenance.subtree}^{tree}`], { encoding: 'utf8' }).trim());
mkdirSync(output, { recursive: true });

// Reproduce the historical bundle from the recorded Git tree, not potentially
// changed working files. Retained capture inputs are never rewritten here.
const historicalInputs = new Map();
const historical = await build({
  stdin: { contents: "export { VoxelSimulation } from './src/voxel/world.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
  plugins: [{ name: 'historical-v48-git-source', setup(api) {
    api.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, ({ path }) => {
      const local = relative(root, path).split(sep).join('/'); assert.ok(local.startsWith('src/'));
      const bytes = gitSource(local); historicalInputs.set(local, hash(bytes));
      return { contents: bytes, loader: local.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) };
    });
  } }],
});
for (const input of Object.keys(historical.metafile.inputs)) assert.ok(input === '<stdin>' || historicalInputs.has(input.replaceAll('\\', '/')));
assert.deepEqual(Object.fromEntries([...historicalInputs].sort(([a], [b]) => a.localeCompare(b))), provenance.sources);
assert.equal(hash(historical.outputFiles[0].contents), provenance.sourceBundleSha256);
const { VoxelSimulation: HistoricalSimulation } = await import(pathToFileURL(resolve(baseline, provenance.sourceBundle)).href);

const currentInputs = new Map();
const current = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'current-source-identity', setup(api) {
    api.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, ({ path }) => {
      const bytes = readFileSync(path), local = relative(root, path).split(sep).join('/');
      currentInputs.set(local, hash(bytes));
      return { contents: bytes, loader: local.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) };
    });
  } }],
});
const bundlePath = resolve(output, 'world-v49.mjs'); writeFileSync(bundlePath, current.outputFiles[0].contents);
const { VoxelSimulation } = await import(pathToFileURL(bundlePath).href);
const defaultPolicy = { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
const pawnTransient = new Set(['jobId', 'path', 'destination', 'phase', 'reason', 'moveTick', 'workTarget']);
const jobTransient = new Set(['owner', 'reason']);
const without = (record, keys) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)));
function physical(saved) {
  const result = structuredClone(saved);
  delete result.version;
  result.pawns = result.pawns.map(p => without(p, pawnTransient));
  result.jobs = result.jobs.map(j => without(j, jobTransient));
  if (saved.version === 49) {
    for (const animal of result.animals) {
      assert.equal(animal.milkFullness, 0, 'Existing hares/deer receive no fabricated milk'); delete animal.milkFullness;
    }
    for (const ledger of [result.stats.produced, result.stats.consumed, result.stats.spoiled, result.stats.destroyed,
      result.trade.imported, result.trade.exported]) {
      assert.equal(ledger.milk, 0, 'Milk starts at zero in every ledger'); delete ledger.milk;
    }
    assert.deepEqual(result.autoSlaughter.dromedary, defaultPolicy, 'New species has unlimited quotas');
    delete result.autoSlaughter.dromedary;
    for (const pen of result.penMarkers) {
      assert.equal(pen.filter.dromedary, false, 'Old explicit pen selections do not silently include the new species');
      delete pen.filter.dromedary;
    }
  }
  return result;
}
function normalizedCounts(world) {
  const counts = world.counts();
  if (Object.hasOwn(counts, 'milk')) { assert.equal(counts.milk, 0); delete counts.milk; }
  return counts;
}
function accounting(world) {
  const counts = world.counts();
  return Object.fromEntries(Object.keys(counts).map(resource => [resource, counts[resource] + world.stats.consumed[resource]
    + world.stats.spoiled[resource] + world.stats.destroyed[resource] - world.stats.produced[resource]
    - (world.trade.imported[resource] ?? 0) + (world.trade.exported[resource] ?? 0)]));
}
for (const [pathKey, hashKey] of [['fixturePath', 'sha256'], ['proofPath', 'proofSha256'], ['frozenPath', 'frozenSha256']])
  assert.equal(hash(readFileSync(provenance.origin[pathKey])), provenance.origin[hashKey]);
const origin = JSON.parse(readFileSync(provenance.origin.fixturePath));
assert.equal(origin.version, 29); assert.equal(origin.tick, provenance.origin.tick);
const sample = provenance.samples[0], originalBytes = readFileSync(resolve(baseline, sample.file));
assert.equal(hash(originalBytes), sample.sha256); assert.equal(originalBytes.length, sample.byteLength);
const raw = JSON.parse(originalBytes), inputBefore = structuredClone(raw);
assert.equal(raw.version, 48); assert.equal(raw.tick, sample.tick);
assert.deepEqual(raw.autoSlaughter, sample.autoSlaughter); assert.deepEqual(raw.stats, sample.stats);
assert.equal(hash(JSON.stringify(raw.animals)), sample.animalsSha256);
const { childId, fatherId, motherId } = sample.animalIds, handlerId = sample.handlerId;
const originalHandler = raw.pawns.find(p => p.id === handlerId);
assert.deepEqual(originalHandler.handleTask, sample.handleTask);
assert.equal(originalHandler.handleTask.action, 'autoSlaughter'); assert.equal(originalHandler.handleTask.animalId, childId);
assert.equal(originalHandler.handleTask.progress, 25);
assert.equal(raw.autoSlaughter.hare.youngFemale, 0); assert.equal(Object.hasOwn(raw.autoSlaughter, 'dromedary'), false);
assert.ok(raw.animals.every(a => !Object.hasOwn(a, 'milkFullness')));
assert.equal(Object.hasOwn(raw.stats.produced, 'milk'), false);

let world = VoxelSimulation.load(raw), historicalWorld = HistoricalSimulation.load(JSON.parse(originalBytes));
const migrated = world.save();
assert.equal(migrated.version, 49); assert.deepEqual(physical(migrated), physical(raw), 'Migration preserves all preexisting physical state and quota settings');
assert.deepEqual(normalizedCounts(world), sample.counts);
assert.deepEqual(migrated.pawns.find(p => p.id === handlerId).handleTask, originalHandler.handleTask,
  'Migration preserves already active automatic slaughter and partial work');
assert.deepEqual(physical(migrated), physical(historicalWorld.save()));
const baselineBalance = accounting(world), producedBefore = raw.stats.produced.carcass;
const checkpoints = [], workContinuity = [], roundTrips = [], checks = [];
function checkpoint(name) {
  const saved = world.save(), bytes = Buffer.from(JSON.stringify(saved)), path = resolve(output, `${name}.json`);
  writeFileSync(path, bytes);
  checkpoints.push({ name, file: relative(root, path).split(sep).join('/'), sha256: hash(bytes), byteLength: bytes.length,
    version: saved.version, tick: saved.tick, normalizedPhysicalSha256: hash(JSON.stringify(physical(saved))),
    autoSlaughter: saved.autoSlaughter, handler: saved.pawns.find(p => p.id === handlerId),
    child: saved.animals.find(a => a.id === childId), carcasses: saved.items.filter(i => i.carcass?.animalId === childId), counts: world.counts() });
  return saved;
}
function reload(name) {
  const saved = checkpoint(name), before = structuredClone(saved), historicalSaved = historicalWorld.save();
  world = VoxelSimulation.load(saved); historicalWorld = HistoricalSimulation.load(historicalSaved);
  assert.deepEqual(physical(world.save()), physical(saved)); assert.deepEqual(saved, before);
  assert.deepEqual(physical(world.save()), physical(historicalWorld.save())); roundTrips.push(world.tick);
}
function audit() {
  assert.deepEqual(accounting(world), baselineBalance, `All resources conserved at ${world.tick}`);
  assert.deepEqual(physical(world.save()), physical(historicalWorld.save()), `v49 preserves the historical v48 physical simulation at ${world.tick}`);
  for (const id of [fatherId, motherId]) assert.ok(world.animals.some(a => a.id === id && !a.dead && a.faction === 'colony'));
  assert.ok(world.pawns.filter(p => p.faction === 'colony').every(p => !p.dead && !p.downed));
  assert.ok(world.stats.produced.carcass - producedBefore <= 1);
}
reload('migrated-partial-auto-slaughter');
checks.push('v48 policy, active automatic task and work25 migrate unchanged; only zero milk/default dromedary fields are added');
let auditedTicks = 0, didMidWorkReload = false;
while (!world.items.some(i => i.carcass?.animalId === childId)) {
  assert.ok(auditedTicks < 3000, 'Bounded ordinary automatic-work continuation');
  world.step(); historicalWorld.step(); auditedTicks++; audit();
  const handler = world.pawns.find(p => p.id === handlerId);
  if (handler.handleTask?.action === 'autoSlaughter') {
    const progress = handler.handleTask.progress;
    if (progress === 26 || progress === 50 || progress === 75)
      workContinuity.push({ tick: world.tick, animalId: handler.handleTask.animalId, progress });
    if (progress >= 50 && !didMidWorkReload) { reload('mid-work-progress50'); didMidWorkReload = true; }
  }
}
assert.ok(didMidWorkReload); assert.ok(workContinuity.some(w => w.progress > sample.handleTask.progress));
assert.equal(world.stats.produced.carcass, producedBefore + 1);
assert.equal(world.husbandryLog.filter(e => e.kind === 'slaughter' && e.animalId === childId).length, 1);
assert.deepEqual(world.snapshot().autoSlaughterStatus.targets, []);
reload('completed-real-carcass');
for (let n = 0; n < 60; n++) { world.step(); historicalWorld.step(); auditedTicks++; audit(); }
assert.equal(world.stats.produced.carcass, producedBefore + 1);
assert.equal(world.items.filter(i => i.carcass?.animalId === childId).length, 1);
assert.equal(world.husbandryLog.filter(e => e.kind === 'slaughter' && e.animalId === childId).length, 1);
checks.push('actual work advances after migration, survives a progress50 reload, creates one original-identity corpse, and does not repeat after completion reload');
const final = checkpoint('final');
assert.deepEqual(raw, inputBefore); assert.deepEqual(readFileSync(resolve(baseline, sample.file)), originalBytes);
assert.deepEqual(readFileSync(provenancePath), provenanceBytes);
for (const [path, expected] of currentInputs) assert.equal(hash(readFileSync(path)), expected, `Current source changed during verification: ${path}`);
const result = { status: 'passed', checkedAt: new Date().toISOString(), nativeGameplay: false, browserInteraction: false,
  scope: 'Exact Git-built v48 checkpoint generated by continuing the authentic v29 newborn colony migrates to v49. All preexisting physical state, non-default hare quotas and already active automatic slaughter work are preserved. Added milk fields are zero and new dromedary policy is unlimited. Ordinary continuation and reloads match the historical v48 implementation every tick, ending in one original-identity carcass with resource conservation.',
  originalHead: provenance.head, originalSubtree: provenance.subtree, esbuildVersion,
  provenance: { path: provenancePath, sha256: hash(provenanceBytes) }, origin: provenance.origin,
  historical: { bundleSha256: hash(historical.outputFiles[0].contents), sourceCount: historicalInputs.size, saveSha256: sample.sha256,
    tick: raw.tick, handlerId, handleTask: sample.handleTask, autoSlaughter: sample.autoSlaughter },
  current: { bundleSha256: hash(current.outputFiles[0].contents), sources: Object.fromEntries([...currentInputs].sort(([a], [b]) => a.localeCompare(b))) },
  checks, workContinuity, roundTrips, checkpoints, historicalLockstep: true, auditedTicks,
  finalTick: final.tick, continuationTicks: final.tick - raw.tick, resourceBalances: baselineBalance,
  finalCounts: world.counts(), outputs: { carcassesProduced: world.stats.produced.carcass - producedBefore, milkProduced: world.stats.produced.milk } };
writeFileSync('test-results/animal-milk-legacy.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, historicalTick: raw.tick, progressBefore: sample.handleTask.progress,
  finalTick: final.tick, auditedTicks, roundTrips, outputs: result.outputs }));
