// Verify the retained unchanged-v47 model checkpoint against the current model.
// This is headless simulation only: no native game, browser, preview or GUI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const root = process.cwd(), baseline = resolve('test-results/auto-slaughter-v47-baseline');
const output = resolve('test-results/auto-slaughter-legacy');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenancePath = 'docs/research/rimworld/evidence/auto-slaughter-v47-provenance.json';
const provenanceBytes = readFileSync(provenancePath), provenance = JSON.parse(provenanceBytes);
assert.deepEqual(provenanceBytes, readFileSync(resolve(baseline, 'provenance.json')));
assert.equal(provenance.status, 'captured');
assert.equal(provenance.head, '58e8b65c3a7aa60cbefb343f22039335200b6aca');
assert.equal(provenance.subtree, 'a2891feeecf5b95053a6555e2229218537ed216a');
assert.equal(provenance.samples.length, 1);
assert.equal(provenance.samples[0].file, 'working-chair-wildlife.json');
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
  plugins: [{ name: 'historical-v47-git-source', setup(api) {
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
const bundlePath = resolve(output, 'world-v48.mjs'); writeFileSync(bundlePath, current.outputFiles[0].contents);
const { VoxelSimulation } = await import(pathToFileURL(bundlePath).href);
// Expected migration policy is independent of the implementation under test.
const unlimitedPolicy = { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
const defaultAutoSlaughter = { hare: { ...unlimitedPolicy }, deer: { ...unlimitedPolicy } };
const pawnTransient = new Set(['jobId', 'path', 'destination', 'phase', 'reason', 'moveTick', 'workTarget']);
const jobTransient = new Set(['owner', 'reason']);
const without = (record, keys) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)));
function physical(saved) {
  const { version, autoSlaughter, pawns, jobs, ...rest } = saved;
  return { ...rest, pawns: pawns.map(p => without(p, pawnTransient)), jobs: jobs.map(j => without(j, jobTransient)) };
}
function woodOwnership(saved) {
  const ground = saved.items.filter(i => i.resource === 'wood').reduce((n, i) => n + i.amount, 0);
  const carried = saved.pawns.reduce((n, p) => n + (p.cargo?.resource === 'wood' ? p.cargo.amount : 0), 0);
  const delivered = saved.jobs.reduce((n, j) => n + (j.delivered.wood ?? 0), 0);
  const loose = ground + carried + delivered;
  return { ground, carried, delivered, loose, consumed: saved.stats.consumed.wood, destroyed: saved.stats.destroyed.wood,
    accounting: loose + saved.stats.consumed.wood + saved.stats.destroyed.wood + saved.stats.spoiled.wood - saved.stats.produced.wood
      - (saved.trade.imported.wood ?? 0) + (saved.trade.exported.wood ?? 0) };
}
const checkpoints = [];
function checkpoint(name, saved) {
  const bytes = Buffer.from(JSON.stringify(saved)), file = resolve(output, `${name}.json`); writeFileSync(file, bytes);
  checkpoints.push({ animalsSha256: hash(JSON.stringify(saved.animals)),
    pendingTameIds: saved.animals.filter(a => a.tame).map(a => a.id), autoSlaughter: saved.autoSlaughter, file: relative(root, file).split(sep).join('/'), sha256: hash(bytes), byteLength: bytes.length,
    version: saved.version, tick: saved.tick, physicalSha256: hash(JSON.stringify(physical(saved))), wood: woodOwnership(saved),
    chairs: saved.chairs, jobs: saved.jobs.map(j => ({ id: j.id, kind: j.kind, work: j.work, progress: j.progress,
      workTicks: j.workTicks, delivered: j.delivered, deliveredBatches: j.deliveredBatches, constructionFailure: j.constructionFailure })) });
}
function roundTrip(saved) {
  const before = structuredClone(saved), loaded = VoxelSimulation.load(saved);
  assert.equal(loaded.save().version, 48); assert.deepEqual(physical(loaded.save()), physical(saved));
  assert.deepEqual(loaded.save().autoSlaughter, defaultAutoSlaughter);
  assert.deepEqual(saved, before, 'Load leaves caller save unchanged'); return loaded;
}
const sample = provenance.samples[0], originalBytes = readFileSync(resolve(baseline, sample.file));
assert.equal(hash(originalBytes), sample.sha256); assert.equal(originalBytes.length, sample.byteLength);
const raw = JSON.parse(originalBytes), inputBefore = structuredClone(raw);
assert.equal(hash(JSON.stringify(raw.animals)), sample.animalsSha256);
assert.equal(raw.animals.find(a => a.id === sample.markedAnimalId)?.tame, true);
assert.equal(raw.animals.length, provenance.initialAnimalCount);
assert.equal(Object.hasOwn(raw, 'autoSlaughter'), false);
assert.equal(raw.version, 47); assert.equal(raw.tick, sample.tick); assert.deepEqual(raw.jobs, sample.jobs);
assert.deepEqual(raw.stats, sample.stats); assert.deepEqual(raw.chairs, sample.chairs);
const originalFrame = raw.jobs.find(j => j.kind === 'chair');
assert.equal(originalFrame.workTicks, 20); assert.ok(originalFrame.progress > 0 && originalFrame.progress < originalFrame.work);
assert.equal(originalFrame.delivered.wood, 15); assert.equal(originalFrame.cost.wood, 15);
assert.equal(Object.hasOwn(originalFrame, 'constructionFailure'), false);
let world = VoxelSimulation.load(raw), migrated = world.save();
assert.equal(migrated.version, 48); assert.deepEqual(physical(migrated), physical(raw), 'Migration does not reroll, reset work, or change goods');
assert.deepEqual(migrated.autoSlaughter, defaultAutoSlaughter, 'Old saves receive unlimited quotas and pregnancy protection');
assert.deepEqual(migrated.animals, raw.animals, 'Migration preserves actual wildlife and pending manual orders');
assert.deepEqual(world.counts(), sample.counts); checkpoint('migrated-working-frame', migrated);
world = roundTrip(migrated);
let historicalWorld = HistoricalSimulation.load(JSON.parse(originalBytes));
historicalWorld = HistoricalSimulation.load(historicalWorld.save());
assert.deepEqual(physical(world.save()), physical(historicalWorld.save()));
const originalWood = woodOwnership(migrated), initialBuilt = migrated.stats.built;
const events = [], workContinuity = [], roundTrips = [];
const lastRecordedWork = new Map();
let previousJobs = JSON.stringify(world.jobs.map(j => j.id)), completed = false;
for (let continuationTick = 1; continuationTick <= 3000 && !completed; continuationTick++) {
  world.step(); historicalWorld.step(); const saved = world.save(), ownership = woodOwnership(saved);
  assert.deepEqual(saved.autoSlaughter, defaultAutoSlaughter);
  assert.deepEqual(physical(saved), physical(historicalWorld.save()), 'Unlimited v48 policy preserves the historical v47 causal simulation at every tick');
  assert.equal(ownership.accounting, originalWood.accounting, 'Every tick conserves wood including failed input destruction');
  assert.equal(ownership.loose, world.counts().wood, 'Ground, carried and delivered are independent physical ownership containers');
  assert.equal(saved.autoRebuild, false, 'Continuation never relies on automatic destruction rebuilding');
  assert.equal(saved.animals.find(a => a.id === sample.markedAnimalId)?.tame, true, 'Pending tame order remains while handler work is disabled');
  assert.ok(saved.animals.every(a => !a.slaughter), 'Unlimited automatic slaughter does not mark wild animals');
  assert.deepEqual(saved.animals.filter(a => !a.dead).map(a => a.id), raw.animals.map(a => a.id), 'No animal is killed during default-policy continuation');
  const jobs = JSON.stringify(saved.jobs.map(j => j.id));
  if (jobs !== previousJobs) { events.push({ tick: saved.tick, jobs: saved.jobs, wood: ownership }); previousJobs = jobs; }
  const active = saved.jobs.find(j => j.kind === 'chair' && !j.constructionFailure && j.workTicks > 0);
  if (active && (active.id !== originalFrame.id || active.workTicks > originalFrame.workTicks)
      && (!lastRecordedWork.has(active.id) || active.workTicks >= lastRecordedWork.get(active.id) + 20)) {
    workContinuity.push({ tick: saved.tick, id: active.id, workTicks: active.workTicks, progress: active.progress, delivered: active.delivered });
    checkpoint(`working-${saved.tick}`, saved);
    lastRecordedWork.set(active.id, active.workTicks);
    world = roundTrip(saved); historicalWorld = HistoricalSimulation.load(historicalWorld.save()); roundTrips.push(saved.tick);
  }
  completed = world.chairs.some(c => c.x === originalFrame.x && c.y === originalFrame.y && c.z === originalFrame.z);
}
assert.ok(workContinuity.length > 0, 'Historical work actually advances after migration');
// A legitimate botch may replace even the first resumed frame. Identity and
// work preservation are checked at migration, and historical lockstep above
// proves that every subsequent completion/failure follows unchanged v47 work.
assert.ok(workContinuity.some(j => j.id === originalFrame.id && j.workTicks > originalFrame.workTicks)
  || events.some(e => e.wood.destroyed > originalWood.destroyed),
  'The original frame either advances or experiences an ordinary accounted-for botch');
assert.ok(completed, 'Normal v48 work completes the historical chair, allowing ordinary failure/retry if selected');
assert.equal(world.chairs.length, 1); assert.equal(world.stats.built, initialBuilt + 1);
assert.equal(world.stats.consumed.wood, raw.stats.consumed.wood + 15); assert.equal(world.stats.produced.wood, raw.stats.produced.wood);
const final = world.save(); checkpoint('completed-chair', final); world = roundTrip(final);
assert.deepEqual(world.chairs, final.chairs); assert.equal(woodOwnership(world.save()).accounting, originalWood.accounting);
assert.deepEqual(raw, inputBefore); assert.deepEqual(readFileSync(resolve(baseline, sample.file)), originalBytes);
assert.deepEqual(readFileSync(provenancePath), provenanceBytes);
for (const [file, expected] of currentInputs) assert.equal(hash(readFileSync(file)), expected, `Current source changed during verification: ${file}`);
const result = { status: 'passed', checkedAt: new Date().toISOString(), nativeGameplay: false, browserInteraction: false,
  scope: 'Authentic model-generated v47 wildlife and in-progress frame migrate unchanged into v48 with default unlimited automatic-slaughter settings. The original pending manual tame order survives while the frame advances through ordinary work, repeated save/load and completion with per-tick physical wood conservation.',
  originalHead: provenance.head, originalSubtree: provenance.subtree, esbuildVersion,
  provenance: { path: provenancePath, sha256: hash(provenanceBytes) },
  historical: { bundleSha256: hash(historical.outputFiles[0].contents), sourceCount: historicalInputs.size, saveSha256: sample.sha256,
    tick: raw.tick, animalsSha256: sample.animalsSha256, markedAnimalId: sample.markedAnimalId, workTicks: originalFrame.workTicks, progress: originalFrame.progress, delivered: originalFrame.delivered },
  current: { bundleSha256: hash(current.outputFiles[0].contents), sources: Object.fromEntries([...currentInputs].sort(([a], [b]) => a.localeCompare(b))) },
  events, workContinuity, roundTrips, checkpoints, defaultAutoSlaughter, historicalLockstep: true,
  animalCount: raw.animals.length, pendingTameIds: final.animals.filter(a => a.tame).map(a => a.id),
  finalTick: final.tick, continuationTicks: final.tick - raw.tick, finalWood: woodOwnership(final) };
writeFileSync('test-results/auto-slaughter-legacy.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, historicalTick: raw.tick, historicalWorkTicks: originalFrame.workTicks,
  finalTick: final.tick, continuationTicks: result.continuationTicks, roundTrips, finalWood: result.finalWood }));
