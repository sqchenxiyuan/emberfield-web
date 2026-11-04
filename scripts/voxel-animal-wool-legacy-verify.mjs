// Historical v49 -> v50 continuity. Headless models only; no native game or GUI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const root = process.cwd(), baseline = resolve('test-results/animal-wool-v49-baseline');
const output = resolve(baseline, 'verification');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenancePath = 'docs/research/rimworld/evidence/animal-wool-v49-provenance.json';
const provenanceBytes = readFileSync(provenancePath), provenance = JSON.parse(provenanceBytes);
assert.deepEqual(provenanceBytes, readFileSync(resolve(baseline, 'provenance.json')));
assert.equal(provenance.status, 'captured');
assert.equal(provenance.head, '2b50bcae1bbcb9ffb0890630de609c74da460547');
assert.equal(provenance.subtree, '91aae567053c15635b7477745f165cbffa7ad686');
assert.equal(provenance.samples.length, 1);
assert.equal(hash(readFileSync(provenance.script)), provenance.scriptSha256);
assert.equal(hash(readFileSync(resolve(baseline, provenance.sourceBundle))), provenance.sourceBundleSha256);
const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { encoding: 'utf8' }).trim();
const gitSource = path => execFileSync('git', ['show', `${provenance.head}:${prefix}${path}`], { maxBuffer: 16 * 1024 * 1024 });
assert.equal(execFileSync('git', ['rev-parse', `${provenance.head}:${prefix.replace(/\/$/, '')}`], { encoding: 'utf8' }).trim(),
  execFileSync('git', ['rev-parse', `${provenance.subtree}^{tree}`], { encoding: 'utf8' }).trim());
mkdirSync(output, { recursive: true });

const historicalSources = new Map();
const historical = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
  plugins: [{ name: 'historical-v49-git-source', setup(api) {
    api.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, ({ path }) => {
      const local = relative(root, path).split(sep).join('/'); assert.ok(local.startsWith('src/'));
      const bytes = gitSource(local); historicalSources.set(local, hash(bytes));
      return { contents: bytes, loader: local.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) };
    });
  } }],
});
for (const input of Object.keys(historical.metafile.inputs)) assert.ok(historicalSources.has(input.replaceAll('\\', '/')));
assert.deepEqual(Object.fromEntries([...historicalSources].sort(([a], [b]) => a.localeCompare(b))), provenance.sources);
assert.equal(hash(historical.outputFiles[0].contents), provenance.sourceBundleSha256);
assert.equal(historicalSources.size, 89);
const { VoxelSimulation: HistoricalSimulation } = await import(pathToFileURL(resolve(baseline, provenance.sourceBundle)).href);

const origin = provenance.origin;
assert.equal(hash(readFileSync(origin.reportPath)), origin.reportSha256);
assert.equal(hash(readFileSync(origin.frozenPath)), origin.frozenSha256);
assert.equal(hash(gitSource(origin.frozenPath)), origin.frozenSha256);
const report = JSON.parse(readFileSync(origin.reportPath)), frozen = JSON.parse(readFileSync(origin.frozenPath));
assert.equal(report.status, 'passed'); assert.deepEqual(report.execution, origin.campaignExecution);
assert.deepEqual(frozen.campaign.execution, report.execution);
assert.equal(frozen.campaign.report.sha256, origin.reportSha256);
assert.equal(report.execution.bundleSha256, provenance.sourceBundleSha256);
assert.deepEqual(report.execution.sources, provenance.sources);
const originBytes = readFileSync(origin.file);
assert.equal(hash(originBytes), origin.sha256);
assert.deepEqual(originBytes, readFileSync(resolve(baseline, origin.retainedCopy)));
assert.equal(report.checkpoints.find(c => c.file === origin.file)?.sha256, origin.sha256);
assert.equal(frozen.campaign.retained.find(c => c.file === origin.file)?.sha256, origin.sha256);

const currentSources = new Map();
const current = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
  plugins: [{ name: 'current-source-identity', setup(api) {
    api.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, ({ path }) => {
      const local = relative(root, path).split(sep).join('/'), bytes = readFileSync(path);
      assert.ok(local.startsWith('src/')); currentSources.set(local, hash(bytes));
      return { contents: bytes, loader: local.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) };
    });
  } }],
});
for (const input of Object.keys(current.metafile.inputs)) assert.ok(currentSources.has(input.replaceAll('\\', '/')));
const bundlePath = resolve(output, 'world-v50.mjs'); writeFileSync(bundlePath, current.outputFiles[0].contents);
const { VoxelSimulation } = await import(pathToFileURL(bundlePath).href);
const unlimited = { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
const pawnTransient = new Set(['jobId', 'path', 'destination', 'phase', 'reason', 'moveTick', 'workTarget']);
const jobTransient = new Set(['owner', 'reason']);
const without = (record, keys) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)));
function physical(saved) {
  const result = structuredClone(saved);
  delete result.version;
  result.pawns = result.pawns.map(p => without(p, pawnTransient));
  result.jobs = result.jobs.map(j => without(j, jobTransient));
  if (saved.version === 50) {
    for (const animal of result.animals) {
      assert.notEqual(animal.species, 'alpaca', 'Migration invents no new animals');
      assert.equal(animal.woolGrowth, 0); delete animal.woolGrowth;
    }
    for (const ledger of [result.stats.produced, result.stats.consumed, result.stats.spoiled, result.stats.destroyed,
      result.trade.imported, result.trade.exported]) { assert.equal(ledger.alpacaWool, 0); delete ledger.alpacaWool; }
    assert.deepEqual(result.autoSlaughter.alpaca, unlimited); delete result.autoSlaughter.alpaca;
    for (const marker of result.penMarkers) { assert.equal(marker.filter.alpaca, false); delete marker.filter.alpaca; }
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value) && Object.hasOwn(value, 'allowedFood') && Object.hasOwn(value, 'allowedCarcasses')) {
        assert.deepEqual(value.allowedTextiles, ['cloth'], 'Every old/frozen production policy remains cloth-only');
        delete value.allowedTextiles;
      }
      Object.values(value).forEach(visit);
    };
    visit(result);
  }
  return result;
}
function accounting(s) {
  return Object.fromEntries(Object.entries(s.counts()).map(([r, n]) => [r, n + s.stats.consumed[r] + s.stats.spoiled[r]
    + s.stats.destroyed[r] - s.stats.produced[r] - s.trade.imported[r] + s.trade.exported[r]]));
}
const sample = provenance.samples[0], originalBytes = readFileSync(resolve(baseline, sample.file));
assert.equal(hash(originalBytes), sample.sha256); assert.equal(originalBytes.length, sample.byteLength);
const raw = JSON.parse(originalBytes), rawBefore = structuredClone(raw);
assert.equal(raw.version, 49); assert.equal(raw.tick, sample.tick);
assert.equal(raw.tick - origin.tick, 25); assert.equal(provenance.auditedTicks, 25);
const { handlerId, animalId } = sample;
assert.deepEqual(raw.pawns.find(p => p.id === handlerId).handleTask, sample.handleTask);
assert.equal(sample.handleTask.action, 'milk'); assert.equal(sample.handleTask.stage, 'interact'); assert.equal(sample.handleTask.progress, 125);
assert.equal(hash(JSON.stringify(raw.animals)), sample.animalsSha256);
assert.deepEqual(raw.pawns.map(p => ({ pawnId: p.id, worn: p.worn })), sample.apparel);
assert.deepEqual(raw.productionQueues, sample.productionQueues);
assert.equal(hash(JSON.stringify(raw.stockpiles)), sample.storageSha256);

let world = VoxelSimulation.load(raw), oldWorld = HistoricalSimulation.load(JSON.parse(originalBytes));
const migrated = world.save(); assert.equal(migrated.version, 50);
assert.deepEqual(physical(migrated), physical(raw)); assert.deepEqual(physical(migrated), physical(oldWorld.save()));
assert.deepEqual(migrated.pawns.find(p => p.id === handlerId).handleTask, sample.handleTask);
assert.deepEqual(migrated.pawns.map(p => ({ pawnId: p.id, worn: p.worn })), sample.apparel);
assert.deepEqual(migrated.stockpiles, raw.stockpiles, 'Old explicit storage filters are unchanged');
const counts = world.counts(); assert.equal(counts.alpacaWool, 0); delete counts.alpacaWool; assert.deepEqual(counts, sample.counts);
const balances = accounting(world), milkBefore = world.stats.produced.milk;
const colonyIds = raw.pawns.filter(p => p.faction === 'colony').map(p => p.id);
const initialEventCount = world.husbandryLog.filter(e => e.kind === 'milked' && e.animalId === animalId).length;
const checkpoints = [], roundTrips = [], workContinuity = [], checks = [];
let auditedTicks = 0;
function audit() {
  assert.deepEqual(accounting(world), balances, `All resources conserved at tick ${world.tick}`);
  assert.deepEqual(physical(world.save()), physical(oldWorld.save()), `Historical physical lockstep at tick ${world.tick}`);
  assert.ok(world.animals.some(a => a.id === animalId && a.species === 'dromedary' && a.faction === 'colony' && !a.dead));
  for (const id of colonyIds) assert.ok(world.pawns.some(p => p.id === id && !p.dead && !p.downed));
  assert.ok(world.stats.produced.milk - milkBefore <= 18);
}
function checkpoint(name) {
  const saved = world.save(), bytes = Buffer.from(JSON.stringify(saved)), path = resolve(output, `${name}.json`);
  writeFileSync(path, bytes);
  checkpoints.push({ name, file: relative(root, path).split(sep).join('/'), sha256: hash(bytes), byteLength: bytes.length,
    version: saved.version, tick: saved.tick, normalizedPhysicalSha256: hash(JSON.stringify(physical(saved))),
    handler: saved.pawns.find(p => p.id === handlerId), animal: saved.animals.find(a => a.id === animalId),
    counts: world.counts(), productionQueues: saved.productionQueues });
  return saved;
}
function reload(name) {
  const saved = checkpoint(name), before = structuredClone(saved), oldSaved = oldWorld.save();
  world = VoxelSimulation.load(saved); oldWorld = HistoricalSimulation.load(oldSaved);
  assert.deepEqual(physical(world.save()), physical(saved)); assert.deepEqual(saved, before);
  audit(); roundTrips.push(world.tick);
}
function step() { world.step(); oldWorld.step(); auditedTicks++; audit(); }
reload('migrated-partial-milk');
checks.push('Old milk work125, fullness, skills, cloth apparel identities/condition, food and storage selections migrate exactly; only specified zero/default wool fields are added');
let midWorkReload = false;
while (world.stats.produced.milk === milkBefore) {
  assert.ok(auditedTicks < 2000, 'Bounded continuation of the real ongoing milk task');
  const before = world.pawns.find(p => p.id === handlerId).handleTask?.progress;
  step();
  const task = world.pawns.find(p => p.id === handlerId).handleTask;
  if (task?.action === 'milk') {
    assert.equal(task.animalId, animalId); assert.equal(task.stage, 'interact'); assert.ok(task.progress > before);
    if (task.progress === 126 || task.progress === 250 || task.progress === 399)
      workContinuity.push({ tick: world.tick, progress: task.progress, animalId });
    if (task.progress >= 250 && !midWorkReload) { reload('mid-work-progress250'); midWorkReload = true; }
  }
}
assert.ok(midWorkReload); assert.equal(world.stats.produced.milk - milkBefore, 18);
assert.equal(world.husbandryLog.filter(e => e.kind === 'milked' && e.animalId === animalId).length - initialEventCount, 1);
reload('completed-real-milk');
for (let n = 0; n < 60; n++) step();
assert.equal(world.stats.produced.milk - milkBefore, 18);
assert.equal(world.husbandryLog.filter(e => e.kind === 'milked' && e.animalId === animalId).length - initialEventCount, 1);
checks.push('Partial milk work advances through a work250 reload, produces exactly one 18-unit physical milk batch, and does not duplicate after completion reload');
const final = checkpoint('final');
assert.deepEqual(raw, rawBefore); assert.deepEqual(readFileSync(resolve(baseline, sample.file)), originalBytes);
assert.deepEqual(readFileSync(origin.file), originBytes); assert.deepEqual(readFileSync(provenancePath), provenanceBytes);
for (const [path, expected] of currentSources) assert.equal(hash(readFileSync(path)), expected, `Current source changed during verification: ${path}`);
const result = { status: 'passed', checkedAt: new Date().toISOString(), nativeGameplay: false, browserInteraction: false,
  scope: 'Authentic natural v49 desert milk checkpoint, continued by the exact Git-built v49 source, migrates to v50 and matches v49 physical state every ordinary tick. Verifies real ongoing milk work and old cloth apparel/explicit food-storage policy continuity. No active historical tailoring task is present; this does not claim legacy tailoring-material work continuation.',
  originalHead: provenance.head, originalSubtree: provenance.subtree, esbuildVersion,
  execution: { script: 'scripts/voxel-animal-wool-legacy-verify.mjs', scriptSha256: hash(readFileSync(new URL(import.meta.url))),
    bundleSha256: hash(current.outputFiles[0].contents), sourceCount: currentSources.size,
    sources: Object.fromEntries([...currentSources].sort(([a], [b]) => a.localeCompare(b))) },
  provenance: { path: provenancePath, sha256: hash(provenanceBytes) }, origin,
  historical: { bundleSha256: provenance.sourceBundleSha256, sourceCount: historicalSources.size, saveSha256: sample.sha256,
    tick: raw.tick, handlerId, animalId, handleTask: sample.handleTask },
  checks, workContinuity, roundTrips, checkpoints, historicalLockstep: true, auditedTicks,
  finalTick: final.tick, continuationTicks: final.tick - raw.tick, resourceBalances: balances, finalCounts: world.counts(),
  outputs: { milkProduced: world.stats.produced.milk - milkBefore, woolProduced: world.stats.produced.alpacaWool } };
writeFileSync(resolve(output, 'report.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, historicalTick: raw.tick, progressBefore: sample.handleTask.progress,
  finalTick: final.tick, auditedTicks, roundTrips, outputs: result.outputs, report: relative(root, resolve(output, 'report.json')).split(sep).join('/') }));
