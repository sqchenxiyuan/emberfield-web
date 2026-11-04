// Exact published v54 versus current v55; ordinary ticks only, no game or GUI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { build, version as esbuildVersion } from 'esbuild';

const root = process.cwd(), output = resolve('test-results/animal-environment-v54-baseline');
const head = '9fd2b25d39f97c554ee43923ecc6bb04fcc9c753';
const subtree = 'c520129db670931ea237a88925cd654fe4a4dce9';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const relativePath = path => relative(root, path).split(sep).join('/');
const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { encoding: 'utf8' }).trim();
const gitSource = path => execFileSync('git', ['show', `${head}:${prefix}${path}`], { maxBuffer: 16 * 1024 * 1024 });
const tree = execFileSync('git', ['rev-parse', `${head}:${prefix.replace(/\/$/, '')}`], { encoding: 'utf8' }).trim();
assert.equal(tree, execFileSync('git', ['rev-parse', `${subtree}^{tree}`], { encoding: 'utf8' }).trim());
mkdirSync(output, { recursive: true });

// Start with a real checkpoint already produced and hashed by the published v54
// run. No version rewriting or synthetic recreation of an historical fixture.
const receiptPath = 'docs/research/rimworld/evidence/animal-medical-voxel-validation.json';
const receiptBytes = gitSource(receiptPath), receipt = JSON.parse(receiptBytes);
const receiptCopy = resolve(output, 'published-v54-receipt.json');
writeFileSync(receiptCopy, receiptBytes);
const retained = receipt.legacyV53, verified = new Map();
function verifyRecord(record, label = record.file) {
  assert.equal(typeof record.file, 'string'); assert.match(record.sha256, /^[0-9a-f]{64}$/);
  const bytes = readFileSync(record.file);
  assert.equal(hash(bytes), record.sha256, `Historical ${label} changed`);
  if (record.bytes !== undefined) assert.equal(bytes.length, record.bytes, `Historical ${label} length changed`);
  if (record.byteLength !== undefined) assert.equal(bytes.length, record.byteLength);
  const existing = verified.get(record.file);
  if (existing) assert.deepEqual(bytes, existing.bytes);
  verified.set(record.file, { file: record.file, sha256: record.sha256, bytes });
  return bytes;
}
const historicalReport = JSON.parse(verifyRecord(retained.report, 'v54 execution report'));
const historicalProvenance = JSON.parse(verifyRecord(retained.provenance, 'v53 migration provenance'));
const historicalScript = verifyRecord(retained.script, 'v53 to v54 verifier');
assert.deepEqual(historicalScript, gitSource(retained.script.file));
assert.deepEqual(verifyRecord(retained.publishedReceipt, 'earlier published v53 receipt'), gitSource(retained.publishedReceipt.file));
assert.equal(historicalProvenance.receipt.sha256, retained.publishedReceipt.sha256);
verifyRecord(retained.baseline, 'authentic v53 predecessor');
for (const record of [retained.baselineCopy, retained.currentBundle, retained.historicalBundle,
  ...retained.historicalArtifacts]) verifyRecord(record, 'published v54 dependency');
for (const record of retained.checkpoints) verifyRecord(record, 'retained v54 checkpoint');
for (const record of [historicalProvenance.originalFixture, historicalProvenance.originalProof,
  ...Object.values(historicalProvenance.earlierContinuation), historicalProvenance.historicalReport,
  historicalProvenance.historicalProvenance, historicalProvenance.historicalScript,
  ...historicalProvenance.verifiedHistoricalArtifacts]) verifyRecord(record, 'original campaign lineage');
assert.equal(historicalReport.status, 'passed'); assert.equal(historicalReport.historicalLockstep, true);
assert.equal(historicalReport.execution.scriptSha256, retained.script.sha256);
assert.equal(historicalReport.provenance.sha256, retained.provenance.sha256);
assert.equal(historicalReport.auditedTicks, 750);
assert.equal(historicalReport.auditCount, 756);
assert.equal(historicalReport.reloads.length, 5);
assert.equal(historicalReport.execution.sha256, retained.currentBundle.sha256);
assert.equal(historicalProvenance.baseline.sha256, retained.baseline.sha256);
const originalProof = JSON.parse(verified.get(historicalProvenance.originalProof.file).bytes);
assert.equal(originalProof.version, 16); assert.equal(originalProof.loadedByOriginalSource, true);

const originalRecord = retained.checkpoints.find(record => record.file.endsWith('/migrated-active-cook-and-cloth.json'));
assert.ok(originalRecord, 'Published receipt retains the real active v54 checkpoint');
const recordedCheckpoint = historicalReport.checkpoints.find(record => record.file === originalRecord.file);
assert.equal(recordedCheckpoint.sha256, originalRecord.sha256); assert.equal(recordedCheckpoint.version, 54);
const originalBytes = verified.get(originalRecord.file).bytes, original = JSON.parse(originalBytes);
assert.equal(original.version, 54); assert.equal(original.tick, recordedCheckpoint.tick);
assert.deepEqual(original.eggBoxes, []);
assert.equal(original.tick, 301422);
for (const a of original.animals) assert.equal(Object.hasOwn(a, 'environment'), false);
for (const r of original.trade.receipts) for (const row of r.animalTransfers)
  assert.equal(Object.hasOwn(row.animal, 'environment'), false);
const originFile = resolve(output, 'origin-v54-working-cook-and-cloth.json');
writeFileSync(originFile, originalBytes);

async function bundle(historical) {
  const sources = new Map();
  const result = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm',
    write: false, metafile: true, plugins: [{ name: historical ? 'frozen-v54-git-source' : 'current-source-identity', setup(api) {
      api.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, ({ path }) => {
        const local = relativePath(path); assert.ok(local.startsWith('src/'));
        const bytes = historical ? gitSource(local) : readFileSync(path); sources.set(local, hash(bytes));
        return { contents: bytes, loader: local.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) };
      });
    } }] });
  for (const path of Object.keys(result.metafile.inputs)) assert.ok(sources.has(path.replaceAll('\\', '/')));
  const sorted = Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b)));
  const sha256 = hash(result.outputFiles[0].contents);
  if (historical) {
    assert.deepEqual(sorted, historicalReport.execution.sources, 'Every frozen v54 dependency matches published evidence');
    const publishedSources = new Map(receipt.sources.map(record => [record.file, record.sha256]));
    for (const [path, sha] of Object.entries(sorted))
      assert.equal(sha, publishedSources.get(path), `Published v54 source receipt differs: ${path}`);
    assert.equal(esbuildVersion, historicalReport.execution.esbuildVersion);
    assert.equal(sha256, historicalReport.execution.sha256, 'Exact v54 bundle matches the executed historical bundle');
  }
  const file = resolve(output, historical ? 'world-v54.mjs' : 'world-current.mjs');
  writeFileSync(file, result.outputFiles[0].contents);
  const module = await import(pathToFileURL(file).href);
  return { Simulation: module.VoxelSimulation, file: relativePath(file), sha256, sources: sorted };
}

const historical = await bundle(true), currentBuild = await bundle(false);
const Old = historical.Simulation, Current = currentBuild.Simulation;
let old = Old.load(original), current = Current.load(original);
assert.equal(old.save().version, 54); assert.equal(current.save().version, 55);
assert.deepEqual(original, JSON.parse(originalBytes), 'Load must not mutate its caller input');
const before = structuredClone(original.stats);
const unfinished = s => [...s.items, ...s.pawns.flatMap(p => p.cargo ? [p.cargo] : [])]
  .find(item => item.unfinished?.recipe === 'tailoring:tuque')?.unfinished;
const inheritedUft = structuredClone(unfinished(old));
const cookJob = structuredClone(old.jobs.find(j => j.kind === 'cook'));
assert.equal(inheritedUft.id, 2595); assert.equal(inheritedUft.creatorId, 103);
assert.equal(inheritedUft.progress, 165); assert.equal(inheritedUft.workTotal, 800);
assert.deepEqual(inheritedUft.ingredients, [{ resource: 'cloth', amount: 20 }]);
assert.equal(inheritedUft.boundBillId, 'legacy:640:tailoring:tuque');
const cookId = historicalReport.cookId;
assert.equal(cookJob.id, 2597); assert.equal(cookId, 102);
assert.ok(cookJob.cookTraining.some(entry => entry.pawnId === cookId && entry.ticks > 0),
  'Real cooking history persists while both loaders rebuild transient ownership');
assert.equal(cookJob.billId, 'legacy:362:cook');
assert.ok(cookJob.progress > 0 && cookJob.progress < cookJob.work);
assert.deepEqual(cookJob.cost, { wood: 1, grain: 10 });
assert.deepEqual(cookJob.delivered, { wood: 1, grain: 10 });

const balance = s => Object.fromEntries(Object.entries(s.counts()).map(([resource, amount]) => [resource,
  amount + s.stats.consumed[resource] + s.stats.spoiled[resource] + s.stats.destroyed[resource]
    - s.stats.produced[resource] - s.trade.imported[resource] + s.trade.exported[resource]]));
const historicalBalance = balance(old);
assert.deepEqual(balance(current), historicalBalance);
const garments = s => [...s.items.flatMap(i => i.apparel ? [i.apparel] : []),
  ...s.pawns.flatMap(p => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])])];
const beforeGarments = new Set(garments(old).map(garment => garment.id));

const environmentDefault = { hypothermia: 0, heatstroke: 0 };
function normalized(sim, expectedVersion) {
  const result = sim.save(); assert.equal(result.version, expectedVersion); delete result.version;
  const animals = [...result.animals, ...result.trade.receipts.flatMap(r => r.animalTransfers.map(row => row.animal))];
  for (const a of animals) {
    if (expectedVersion === 55) {
      assert.deepEqual(a.environment, environmentDefault,
        'Legacy live and historical animals must retain exact untouched environmental defaults');
      delete a.environment;
    } else assert.equal(Object.hasOwn(a, 'environment'), false);
  }
  // Nothing else may differ: retain medical biology, animalBeds, patient tasks,
  // all other fields, accounting, queues, RNG, jobs, navigation and histories.
  return result;
}
function difference(a, b, path = '') {
  if (isDeepStrictEqual(a, b)) return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return { path, current: a, historical: b };
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (Object.hasOwn(a, key) !== Object.hasOwn(b, key))
      return { path: path ? `${path}.${key}` : key, currentHasKey: Object.hasOwn(a, key), historicalHasKey: Object.hasOwn(b, key), current: a[key], historical: b[key] };
    const found = difference(a[key], b[key], path ? `${path}.${key}` : key); if (found) return found;
  }
  return { path, current: a, historical: b };
}
let auditCount = 0;
const reloads = [], checkpoints = [], progress = [], outputs = [];
function audit() {
  assert.deepEqual(balance(old), historicalBalance); assert.deepEqual(balance(current), historicalBalance);
  let a, b;
  try { a = normalized(current, 55); b = normalized(old, 54); }
  catch (error) {
    writeFileSync(resolve(output, 'mismatch.json'), JSON.stringify({ tick: current.tick,
      reason: String(error), current: current.save(), historical: old.save() }, null, 2));
    throw error;
  }
  const mismatch = difference(a, b);
  if (mismatch) {
    writeFileSync(resolve(output, 'mismatch.json'), JSON.stringify({ tick: current.tick, first: mismatch, current: a, historical: b }, null, 2));
    assert.fail(`Historical model mismatch: ${JSON.stringify(mismatch)}`);
  }
  auditCount++;
}
function retain(name) {
  const save = current.save(), bytes = Buffer.from(JSON.stringify(save));
  const file = resolve(output, `${name}.json`); writeFileSync(file, bytes);
  checkpoints.push({ file: relativePath(file), sha256: hash(bytes), bytes: bytes.length, version: save.version, tick: save.tick });
  return save;
}
function reload(name) {
  const save = retain(name), oldSave = old.save();
  current = Current.load(save); old = Old.load(oldSave);
  reloads.push({ tick: current.tick, name, cookProgress: current.jobs.find(j => j.id === cookJob.id)?.progress ?? null,
    unfinishedProgress: unfinished(current)?.progress ?? null });
  audit();
}

audit(); reload('migrated-active-cook-and-cloth');
const reloadAt = new Map([[55, 'mid-cook'], [135, 'mid-cloth'], [690, 'completed-cook-and-cloth']]);
const continuationTicks = 750;
for (let elapsed = 1; elapsed <= continuationTicks; elapsed++) {
  const cookedBefore = current.stats.cooked, tailoredBefore = current.stats.tailored;
  current.step(); old.step(); audit();
  if (current.stats.cooked !== cookedBefore || current.stats.tailored !== tailoredBefore)
    outputs.push({ tick: current.tick, meals: current.stats.cooked - before.cooked, apparel: current.stats.tailored - before.tailored });
  if (reloadAt.has(elapsed)) {
    const job = current.jobs.find(j => j.id === cookJob.id), uft = unfinished(current);
    if (elapsed === 55) {
      assert.ok(job && job.progress > cookJob.progress && job.progress < job.work);
      progress.push({ tick: current.tick, kind: 'cook', jobId: job.id, progress: job.progress });
    }
    if (elapsed === 135) {
      assert.ok(uft && uft.id === inheritedUft.id && uft.progress > inheritedUft.progress && uft.progress < uft.workTotal);
      progress.push({ tick: current.tick, kind: 'cloth', unfinishedId: uft.id, progress: uft.progress });
    }
    if (elapsed === 690) {
      assert.equal(current.stats.cooked - before.cooked, 1); assert.equal(current.stats.tailored - before.tailored, 1);
    }
    reload(reloadAt.get(elapsed));
  }
}
assert.equal(current.tick, original.tick + continuationTicks);
assert.equal(current.stats.cooked - before.cooked, 1); assert.equal(current.stats.tailored - before.tailored, 1);
assert.equal(current.stats.consumed.grain - before.consumed.grain, 10);
assert.equal(current.stats.consumed.wood - before.consumed.wood, 1);
assert.equal(current.stats.consumed.cloth - before.consumed.cloth, 20,
  'The inherited UFT books its twenty physical cloth inputs exactly once at completion');
for (const resource of ['eggFertilized', 'eggUnfertilized']) {
  assert.equal(current.stats.produced[resource] - before.produced[resource], 0);
  assert.equal(current.stats.consumed[resource] - before.consumed[resource], 0);
}
const made = garments(current).filter(garment => !beforeGarments.has(garment.id));
assert.equal(made.length, 1); assert.equal(made[0].kind, 'tuque'); assert.equal(made[0].material, 'cloth');
reload('final');
for (const [path, expected] of Object.entries(currentBuild.sources)) assert.equal(hash(readFileSync(path)), expected, `Current source changed during verification: ${path}`);
for (const { file, bytes } of verified.values()) assert.deepEqual(readFileSync(file), bytes, `Historical bytes changed: ${file}`);
assert.deepEqual(readFileSync(originFile), originalBytes);
assert.deepEqual(readFileSync(receiptCopy), receiptBytes);
const publicIdentity = ({ Simulation: _, ...entry }) => entry;
const provenance = { status: 'verified', head, subtree, tree, esbuildVersion,
  receipt: { file: receiptPath, sha256: hash(receiptBytes), bytes: receiptBytes.length, fromGit: head,
    copy: relativePath(receiptCopy) },
  historicalReport: retained.report, historicalProvenance: retained.provenance, historicalScript: retained.script,
  originalFixture: historicalProvenance.originalFixture, originalProof: historicalProvenance.originalProof,
  earlierContinuation: historicalProvenance.earlierContinuation,
  sourceModel: publicIdentity(historical), baseline: { ...originalRecord, version: original.version, tick: original.tick,
    copy: relativePath(originFile), cookJob, unfinished: inheritedUft },
  verifiedHistoricalArtifacts: [...verified.values()].map(({ file, sha256, bytes }) => ({ file, sha256, bytes: bytes.length })),
  commands: [], directStateChanges: [] };
const provenanceFile = resolve(output, 'provenance.json');
writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2) + '\n');
const result = { status: 'passed', checkedAt: new Date().toISOString(), nativeGameplay: false, browserInteraction: false,
  scope: 'The published v54 checkpoint already contains genuine grain cooking and cloth work inherited from an authentic v16 colony campaign. Exact Git-built v54 and current v55 continue for 750 ordinary ticks with five reloads and full saved-state equality at every tick. Only the version tag and asserted-default environmental disease states of live and historical animals differ. All existing medical, biology, navigation and ownership fields remain in the full comparison. No commands, field injection, original fixture changes, browser, or native gameplay. This verifies historical save migration, not an animal environmental gameplay campaign.',
  originalHead: head, originalSubtree: subtree, historicalLockstep: true,
  normalization: ['version tag: 54 versus 55', 'assert live and historical animals have exact untouched initial environmental defaults'],
  execution: { script: 'scripts/voxel-animal-environment-legacy-verify.mjs', scriptSha256: hash(readFileSync(new URL(import.meta.url))),
    esbuildVersion, ...publicIdentity(currentBuild), sourceCount: Object.keys(currentBuild.sources).length },
  historicalExecution: { ...publicIdentity(historical), sourceCount: Object.keys(historical.sources).length },
  provenance: { file: relativePath(provenanceFile), sha256: hash(readFileSync(provenanceFile)), bytes: readFileSync(provenanceFile).length },
  baseline: { ...originalRecord, version: original.version, tick: original.tick },
  historicalTick: original.tick, finalTick: current.tick, continuationTicks, auditedTicks: continuationTicks, auditCount,
  reloads, progress, checkpoints, outputEvents: outputs,
  outputs: { meals: current.stats.cooked - before.cooked, apparel: current.stats.tailored - before.tailored, material: 'cloth', eggs: 0 },
  ingredients: { grain: 10, wood: 1, inheritedCloth: 20, clothBookedOnCompletion: 20 },
  stoveId: 362, legacyBillId: cookJob.billId, cookId, tailorId: 640, unfinishedId: inheritedUft.id,
  resourceBalances: historicalBalance, historicalInputsUnchanged: true, sourceIdentityRechecked: true };
const reportFile = resolve(output, 'report.json');
writeFileSync(reportFile, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, historicalTick: original.tick, continuationTicks,
  finalTick: result.finalTick, reloads, outputs: result.outputs, scriptSha256: result.execution.scriptSha256,
  report: relativePath(reportFile), reportSha256: hash(readFileSync(reportFile)) }));
