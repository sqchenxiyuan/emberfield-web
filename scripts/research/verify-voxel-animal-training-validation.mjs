// Verify retained static/headless evidence; never launch a game, browser or GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const receipt = 'docs/research/rimworld/evidence/animal-training-voxel-validation.json';
const verifier = 'scripts/research/verify-voxel-animal-training-validation.mjs';
const legacyScript = 'scripts/voxel-animal-training-legacy-verify.mjs';
const originalHead = 'e92879b94aeafde33557c7976ef7afec5472160c';
const originalSubtree = '66a05430bb84651f4106bb9cff3f6f9f4d78214c';
const originalAssembly = 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3';
const hash = value => createHash('sha256').update(value).digest('hex');
const relative = file => {
  assert.equal(typeof file, 'string');
  const local = path.relative(root, path.resolve(root, file)).replaceAll('\\', '/');
  assert(local && local !== '..' && !local.startsWith('../') && !path.isAbsolute(local), `Outside project: ${file}`);
  return local;
};
const bytes = file => fs.readFileSync(path.join(root, relative(file)));
const json = file => JSON.parse(bytes(file).toString('utf8'));
const record = file => {
  const local = relative(file), data = bytes(local);
  return { file: local, sha256: hash(data), bytes: data.length };
};
const list = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
  const file = `${dir}/${entry.name}`;
  assert(!entry.isSymbolicLink(), `Evidence traversal must not follow symlinks: ${file}`);
  return entry.isDirectory() ? list(file) : entry.isFile() ? [file] : [];
}).sort();

function verifyRecord(expected) {
  assert(expected && typeof expected.file === 'string', 'Missing artifact record');
  assert.match(expected.sha256, /^[0-9a-f]{64}$/);
  const actual = record(expected.file);
  assert.equal(actual.sha256, expected.sha256, `Changed artifact: ${expected.file}`);
  if (expected.bytes !== undefined) assert.equal(actual.bytes, expected.bytes, `Changed byte length: ${expected.file}`);
  if (expected.byteLength !== undefined) assert.equal(actual.bytes, expected.byteLength, `Changed byte length: ${expected.file}`);
  return actual;
}

function captureRegression() {
  const testInputs = list('tests');
  const testFiles = testInputs.filter(file => /\.test\.[cm]?[jt]sx?$/.test(file));
  assert(testFiles.length > 0, 'No current test files');
  const reports = fs.readdirSync(path.join(root, 'test-results'), { withFileTypes: true })
    .filter(entry => entry.isFile() && /^animal-training-.*\.json$/.test(entry.name))
    .map(entry => {
      const file = `test-results/${entry.name}`, report = json(file);
      // A malformed matching report is an error, never an excuse to silently
      // fall back to an older passing run. No manual allow/ignore filename list.
      assert(Array.isArray(report.testResults), `Expected Vitest JSON report: ${file}`);
      assert(Number.isFinite(report.startTime) && report.startTime > 0, `Missing run start time: ${file}`);
      return { file, report };
    })
    .sort((a, b) => a.report.startTime - b.report.startTime || a.file.localeCompare(b.file));
  assert(reports.length > 0, 'No animal-training Vitest reports');
  const results = new Map(), attempts = [];
  for (const { file, report } of reports) {
    attempts.push({ ...record(file), startTime: report.startTime, success: report.success,
      passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests,
      total: report.numTotalTests, files: report.testResults.length });
    assert(report.testResults.length > 0, `No file results; cannot prove what this run checked: ${file}`);
    const seen = new Set();
    for (const result of report.testResults) {
      const testFile = relative(result.name);
      assert(!seen.has(testFile), `Duplicate file result in ${file}: ${testFile}`);
      seen.add(testFile);
      // Replace the entire file result, including failures/skips. Never combine
      // individual passing assertions from different attempts into a pass.
      results.set(testFile, { result, reportFile: file, runStartTime: report.startTime });
    }
  }
  assert.deepEqual([...results.keys()].sort(), testFiles, 'Every current test file needs a latest complete result');
  const coverage = testFiles.map(file => {
    const { result, reportFile, runStartTime } = results.get(file);
    assert.equal(result.status, 'passed', `Latest file result failed: ${file} (${reportFile})`);
    assert(Array.isArray(result.assertionResults) && result.assertionResults.length > 0, `No assertions: ${file}`);
    for (const test of result.assertionResults) {
      assert.equal(test.status, 'passed', `Incomplete or failed latest test: ${file}: ${test.fullName}`);
      assert(!test.failureMessages?.length, `Failure message on passing test: ${test.fullName}`);
    }
    assert(!result.message, `File-level error on passing result: ${file}`);
    return { ...record(file), tests: result.assertionResults.length, report: reportFile, runStartTime };
  });
  return { files: coverage.length, tests: coverage.reduce((sum, file) => sum + file.tests, 0),
    selection: 'All matching top-level Vitest reports retained; latest whole-file result by run start time; all assertions must pass.',
    attempts, coverage, inputs: testInputs.map(record) };
}

function assertInactivePrisonFood(saved) {
  for (const pawn of saved.pawns) {
    assert.equal(Object.hasOwn(pawn, 'prisonFoodTask'), false, 'Historical save must not contain new prisoner supply tasks');
    assert.notEqual(pawn.phase, 'prisonFood');
    if (pawn.faction === 'prisoner') {
      assert.notEqual(pawn.phase, 'dine', 'This historical checkpoint has no active prisoner dining');
      assert.equal(pawn.eating, null);
      assert.equal(pawn.living.mealTask, null);
    }
  }
}

// This authentic checkpoint already has an explicit queue for every bench.
// Keep every queue, policy, timer, biological state and identity in comparison.
const benchIds = save => ['stoves', 'butcherSpots', 'stonecutters', 'tailors', 'weaponBenches']
  .flatMap(key => save[key].map(bench => bench.id)).sort((a, b) => a - b);
function assertExplicitQueues(save) {
  assert.deepEqual(save.productionQueues.map(queue => queue.benchId).sort((a, b) => a - b), benchIds(save),
    'This genuine lineage needs no implicit queue normalization');
}
const inactiveTraining = {
  wanted: { obedience: false, release: false, rescue: false, haul: false },
  steps: { obedience: 0, release: 0, rescue: 0, haul: 0 },
  learned: { obedience: false, release: false, rescue: false, haul: false },
  countDecayFrom: null, masterId: null, followDrafted: false, followFieldwork: false, nextHaulTick: 0,
};
const inactiveSlaughter = { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
function allAnimals(save) {
  return [...save.animals, ...save.trade.receipts.flatMap(receipt => receipt.animalTransfers.map(row => row.animal))];
}
function assertNoNewSpecies(node) {
  if (!node || typeof node !== 'object') return;
  assert.equal(Object.hasOwn(node, 'labrador'), false, 'New species policy cannot be hidden');
  if (Array.isArray(node)) assert.equal(node.includes('labrador'), false, 'Old production filters remain exact');
  assert.notEqual(node.species, 'labrador', 'No new live or physical animal identity');
  Object.values(node).forEach(assertNoNewSpecies);
}
function normalized(result, expectedVersion) { assert.equal(result.version, expectedVersion);
  assertInactivePrisonFood(result); assertExplicitQueues(result);
  assert.equal(result.husbandryLog.some(entry => entry.kind === 'training'), false);
  // Assert the complete inactive shape first: no training progress, cargo,
  // master assignment, task, cooldown or species filter may be discarded.
  for (const animal of allAnimals(result)) {
    assert.notEqual(animal.species, 'labrador');
    assert.equal(['follow', 'attack', 'rescue', 'haul'].includes(animal.phase), false);
    if (expectedVersion === 59) {
      assert.deepEqual(animal.training, inactiveTraining);
      assert.equal(animal.work, null); assert.equal(animal.cargo, null);
    } else for (const key of ['training', 'work', 'cargo']) assert.equal(Object.hasOwn(animal, key), false);
  }
  for (const pawn of result.pawns) {
    assert.equal(Object.hasOwn(pawn, 'animalTrainTask'), false); assert.notEqual(pawn.phase, 'animalTrain');
    if (expectedVersion === 59) assert.equal(pawn.animalsReleased, false);
    else assert.equal(Object.hasOwn(pawn, 'animalsReleased'), false);
  }
  if (expectedVersion === 59) {
    assert.deepEqual(result.autoSlaughter.labrador, inactiveSlaughter);
    for (const side of ['bought', 'sold']) assert.equal(result.trade.animalLedger[side].labrador, 0);
    for (const animal of allAnimals(result)) { delete animal.training; delete animal.work; delete animal.cargo; }
    for (const pawn of result.pawns) delete pawn.animalsReleased;
    delete result.autoSlaughter.labrador;
    for (const side of ['bought', 'sold']) delete result.trade.animalLedger[side].labrador;
  }
  assertNoNewSpecies(result);
  delete result.version;
  return result;
}

function captureLegacy() {
  const legacyFile = 'test-results/animal-training-v58-baseline/report.json', legacy = json(legacyFile);
  assert.equal(legacy.status, 'passed');
  assert.equal(legacy.nativeGameplay, false); assert.equal(legacy.browserInteraction, false);
  assert.equal(legacy.originalHead, originalHead); assert.equal(legacy.originalSubtree, originalSubtree);
  assert.equal(legacy.historicalLockstep, true);
  assert.equal(legacy.historicalTick, 301422); assert.equal(legacy.finalTick, 302172);
  assert.equal(legacy.continuationTicks, 750); assert.equal(legacy.auditedTicks, 750);
  assert.equal(legacy.auditCount, 756);
  assert.equal(legacy.sourceIdentityRechecked, true); assert.equal(legacy.historicalInputsUnchanged, true);
  assert.deepEqual(legacy.normalization, ['version tag: 58 versus 59', 'strictly inactive old-species training/work/cargo defaults', 'Pawn animalsReleased:false with no training task', 'default Labrador slaughter limits and zero live-animal trade ledger']);
  assert.equal(legacy.productionQueuesNormalized, false);
  assert.deepEqual(legacy.outputs, { meals: 1, apparel: 1, material: 'cloth', eggs: 0 });
  assert.deepEqual(legacy.ingredients, { grain: 10, wood: 1, inheritedCloth: 20, clothBookedOnCompletion: 20 });
  assert.deepEqual(legacy.reloads.map(reload => reload.tick), [301422, 301477, 301557, 302112, 302172]);
  assert.equal(legacy.execution.script, legacyScript);
  assert.equal(record(legacyScript).sha256, legacy.execution.scriptSha256, 'Legacy verifier changed since execution');
  const executed = Object.entries(legacy.execution.sources);
  assert(executed.length > 0); assert.equal(legacy.execution.sourceCount, executed.length);
  for (const [file, digest] of executed) {
    assert(relative(file).startsWith('src/'), 'Unexpected executed source: ' + file);
    assert.equal(record(file).sha256, digest, 'Executed source changed: ' + file);
  }
  const currentBundle = verifyRecord(legacy.execution), historicalBundle = verifyRecord(legacy.historicalExecution);
  assert.equal(legacy.historicalExecution.sourceCount, Object.keys(legacy.historicalExecution.sources).length);
  const provenanceRecord = verifyRecord(legacy.provenance), provenance = json(provenanceRecord.file);
  assert.equal(provenance.status, 'verified');
  assert.equal(provenance.head, originalHead); assert.equal(provenance.subtree, originalSubtree);
  assert.equal(provenance.tree, '31194077bb8619141961cd9207fa85737d597fda');
  assert.deepEqual(provenance.commands, []); assert.deepEqual(provenance.directStateChanges, []);
  assert.equal(provenance.sourceModel.sha256, historicalBundle.sha256);
  assert.deepEqual(provenance.sourceModel.sources, legacy.historicalExecution.sources);
  assert.equal(provenance.receipt.file, 'docs/research/rimworld/evidence/prison-food-voxel-validation.json');
  assert.equal(provenance.receipt.fromGit, originalHead);
  const publishedReceipt = verifyRecord(provenance.receipt), published = json(publishedReceipt.file);
  assert.equal(publishedReceipt.sha256, 'e4347528146bdbe2829085dd4ed6bee6e425e073c7dd1bf434d1b08f18d902db');
  assert.equal(publishedReceipt.bytes, 179472);
  const publishedReceiptCopy = record(provenance.receipt.copy);
  assert.deepEqual(bytes(publishedReceiptCopy.file), bytes(publishedReceipt.file));
  const historicalArtifacts = provenance.verifiedHistoricalArtifacts.map(verifyRecord);
  assert(historicalArtifacts.length > 0, 'Missing authentic historical lineage');
  const previous = json(verifyRecord(provenance.historicalReport).file);
  const retained = published.legacyV57;
  assert.deepEqual(verifyRecord(provenance.historicalReport), verifyRecord(retained.report));
  assert.deepEqual(verifyRecord(provenance.historicalProvenance), verifyRecord(retained.provenance));
  assert.deepEqual(verifyRecord(provenance.historicalScript), verifyRecord(retained.script));
  assert.equal(previous.status, 'passed'); assert.equal(previous.historicalLockstep, true);
  assert.equal(previous.auditedTicks, 750); assert.equal(previous.auditCount, 756);
  assert.equal(previous.execution.scriptSha256, retained.script.sha256);
  assert.equal(previous.provenance.sha256, retained.provenance.sha256);
  const executedPriorBundle = verifyRecord(retained.currentBundle);
  assert.equal(historicalBundle.sha256, executedPriorBundle.sha256);
  assert.equal(historicalBundle.bytes, executedPriorBundle.bytes);
  assert.deepEqual(bytes(historicalBundle.file), bytes(executedPriorBundle.file));
  assert.deepEqual(previous.execution.sources, legacy.historicalExecution.sources);
  assert.equal(previous.execution.sha256, historicalBundle.sha256);
  const publishedSources = new Map(published.sources.map(source => [source.file, source.sha256]));
  for (const [file, digest] of Object.entries(legacy.historicalExecution.sources))
    assert.equal(publishedSources.get(file), digest, 'Historical source differs from fixed published receipt: ' + file);
  const requiredHistorical = [retained.report, retained.provenance, retained.script, retained.publishedReceipt,
    retained.baseline, retained.baselineCopy, retained.currentBundle, retained.historicalBundle,
    ...retained.historicalArtifacts, ...retained.checkpoints, ...retained.historicalCheckpoints];
  const artifactMap = new Map(historicalArtifacts.map(entry => [entry.file, entry]));
  for (const expected of requiredHistorical) assert.deepEqual(artifactMap.get(expected.file), verifyRecord(expected),
    'Historical provenance omitted a published dependency: ' + expected.file);
  const baseline = verifyRecord(legacy.baseline);
  assert.equal(baseline.sha256, '519117b75112eba06748d98c9fe3a2ed33736f5c76276813c4685a3500945f9e');
  assert.equal(baseline.bytes, 236645);
  assert.equal(legacy.baseline.version, 58); assert.equal(legacy.baseline.tick, legacy.historicalTick);
  const publishedCheckpoint = published.legacyV57.checkpoints.find(checkpoint => checkpoint.file === baseline.file);
  assert(publishedCheckpoint, 'Baseline must appear in the authentic published v58 receipt');
  assert.equal(publishedCheckpoint.sha256, baseline.sha256); assert.equal(publishedCheckpoint.version, 58);
  const baselineSave = json(baseline.file);
  assert.equal(baselineSave.version, 58); assert.equal(baselineSave.tick, legacy.historicalTick);
  assert.ok(baselineSave.foodPolicies, 'Real v58 baseline retains the prior food policy feature');
  assert.ok(baselineSave.apparelPolicies, 'Real v58 baseline retains the prior apparel policy feature');
  for (const pawn of baselineSave.pawns) {
    assert.equal(Object.hasOwn(pawn, 'foodPolicyId'), true, 'Real v58 baseline retains food assignments');
    assert.ok(pawn.apparelControl, 'Real v58 baseline retains apparel controls');
  }
  assertInactivePrisonFood(baselineSave);
  assert.equal(provenance.baseline.sha256, baseline.sha256);
  assert.deepEqual(bytes(provenance.baseline.copy), bytes(baseline.file), 'Historical baseline copy was rewritten');
  const historicalCheckpoints = legacy.historicalCheckpoints.map(checkpoint => {
    const checked = verifyRecord(checkpoint), saved = json(checked.file);
    assert.equal(checkpoint.version, 58); assert.equal(saved.version, 58);
    assert.equal(saved.tick, checkpoint.tick);
    assertInactivePrisonFood(saved);
    return { ...checked, version: checkpoint.version, tick: checkpoint.tick };
  });
  assert.deepEqual(historicalCheckpoints.map(checkpoint => checkpoint.tick), legacy.reloads.map(reload => reload.tick));
  const checkpoints = legacy.checkpoints.map((checkpoint, index) => {
    const checked = verifyRecord(checkpoint), saved = json(checked.file);
    assert.equal(checkpoint.version, 59); assert.equal(saved.version, 59);
    assert.equal(saved.tick, checkpoint.tick);
    assertInactivePrisonFood(saved);
    assert.deepEqual(normalized(saved, 59), normalized(json(historicalCheckpoints[index].file), 58),
      'Every retained checkpoint must match after strictly asserted inactive v59 defaults only');
    return { ...checked, version: checkpoint.version, tick: checkpoint.tick };
  });
  assert.deepEqual(checkpoints.map(checkpoint => checkpoint.tick), legacy.reloads.map(reload => reload.tick));
  return { report: record(legacyFile), originalHead, originalSubtree,
    historicalTick: legacy.historicalTick, finalTick: legacy.finalTick, auditedTicks: legacy.auditedTicks,
    auditCount: legacy.auditCount, normalization: legacy.normalization, outputs: legacy.outputs,
    ingredients: legacy.ingredients, reloads: legacy.reloads,
    provenance: provenanceRecord, publishedReceipt, publishedReceiptCopy, baseline, baselineCopy: record(provenance.baseline.copy),
    script: record(legacyScript), currentBundle, historicalBundle, historicalArtifacts, checkpoints, historicalCheckpoints };
}

function captureOriginal() {
  const manifestFile = 'docs/research/rimworld/evidence/animal-training-manifest.json';
  const mechanismFile = 'docs/research/rimworld/evidence/animal-training-mechanisms.json';
  const manifest = json(manifestFile), mechanisms = json(mechanismFile);
  assert.equal(manifest.source_sha256, originalAssembly); assert.equal(mechanisms.assemblySha256, originalAssembly);
  assert.equal(manifest.types.length, 55); assert.equal(mechanisms.rules.length, 116);
  assert.equal(mechanisms.boundedChecks.length, 16); assert.equal(mechanisms.packagedXml.length, 25);
  for (const projection of mechanisms.packagedXml) {
    assert.match(projection.sha256, /^[0-9a-f]{64}$/);
    assert(projection.file.startsWith('Data/Core/Defs/'));
    assert(projection.xpath.startsWith('/Defs/'));
    assert(Array.isArray(projection.fields) && projection.fields.length > 0);
  }
  const native = mechanisms.nativeReference;
  for (const [key, value] of Object.entries({ species: 'LabradorRetriever', trainability: 'Advanced',
    bodySize: .75, wildness: 0, minimumHandlingSkill: 0, grazesPlants: false,
    learnedLostOnlyAtZero: true, trainingResetsDecayClock: false, wishlistChangeDeletesLearned: false,
    minimumAttemptIntervalTicks: 15000, labradorDecayPeriodTicks: 720000, labradorTamenessDecays: false,
    feedCount: 2, feedFraction: .15, feedNutritionCap: .3, talkDurationTicks: 270, feedBaseDurationTicks: 270,
    rescueNeedsMaster: false, rescueRadius: 75, rescueEnemyExclusionRadius: 25, rescueHasChanceGate: false,
    haulNeedsMaster: false, haulMtbHours: 1.5, haulMinimumChanceAttemptTicks: 2500,
    normalFollowRadius: 3, releasedFollowRadius: 50, normalDefendRadius: 5, releasedDefendRadius: 50,
    directAttackTargetIsSeparateOdysseyCapability: true,
    playerAnimalGenerationCompletesTameness: true, playerAnimalGenerationCompletesAllFourWorkSkills: false,
  })) assert.equal(native[key], value, 'Native reference changed: ' + key);
  assert.deepEqual(native.trainables, [
    { def: 'Tameness', steps: 5, prerequisite: null },
    { def: 'Obedience', steps: 3, prerequisite: 'Tameness' },
    { def: 'Release', steps: 2, prerequisite: 'Obedience' },
    { def: 'Rescue', steps: 2, prerequisite: 'Obedience', minBodySize: .65 },
    { def: 'Haul', steps: 7, prerequisite: 'Obedience', minBodySize: .4 },
  ]);
  const paths = mechanisms.animalThinkTree.ordinaryBehaviorPaths;
  assert.deepEqual(paths.map(p => p.class), ['JobGiver_AIDefendMaster', 'JobGiver_AIFollowMaster', 'JobGiver_RescueNearby', 'JobGiver_Haul']);
  for (const p of paths.slice(0, 2)) {
    assert.equal(p.ancestorsNearestFirst[0].class, 'ThinkNode_ConditionalShouldFollowMaster');
    assert.deepEqual(p.ancestorsNearestFirst[1], { class: 'ThinkNode_ConditionalTrainableCompleted', fields: { trainable: '<trainable>Obedience</trainable>' } });
  }
  assert.equal(mechanisms.priorManifests.length, 3);
  const priorManifests = mechanisms.priorManifests.map(verifyRecord);
  const priorByFile = new Map(priorManifests.map(entry => {
    const prior = json(entry.file); assert.equal(prior.source_sha256, originalAssembly);
    return [entry.file, new Map(prior.types.map(type => [type.type, type]))];
  }));
  const currentTypes = new Map(manifest.types.map(type => [type.type, type]));
  assert.equal(currentTypes.size, manifest.types.length, 'Duplicate static type');
  assert.equal(mechanisms.matchingPriorTypes.length, 17);
  const reusedTypes = mechanisms.matchingPriorTypes.map(type => {
    assert.equal(currentTypes.get(type.type)?.sha256, type.sha256);
    assert(Array.isArray(type.prior) && type.prior.length > 0);
    const prior = type.prior.map(link => {
      const earlier = priorByFile.get(link.manifest)?.get(type.type);
      assert(earlier, 'Missing reused type lineage: ' + type.type);
      assert.equal(earlier.local_file, link.localFile); assert.equal(earlier.sha256, type.sha256);
      return { manifest: link.manifest, ...verifyRecord({ file: link.localFile, sha256: type.sha256 }) };
    });
    return { type: type.type, sha256: type.sha256, prior };
  });
  assert.equal(new Set(reusedTypes.map(type => type.type)).size, 17, 'Duplicate reused type');
  assert.equal(mechanisms.manifestFile, manifestFile);
  assert.equal(mechanisms.manifestSha256, record(manifestFile).sha256);
  assert.equal(mechanisms.collectorSha256, record('scripts/research/collect-animal-training-evidence.ps1').sha256);
  assert.equal(mechanisms.reaSha256, record(mechanisms.reaFile).sha256);
  const staticLogs = ['test-results/animal-training-extract-check.log', 'test-results/animal-training-mechanisms-check.log'];
  assert.match(bytes(staticLogs[0]).toString(), /Re-extracted and checked 55 animal-training types/);
  assert.match(bytes(staticLogs[1]).toString(), /116 anchors, 16 bounded checks, 25 XML projections, 17 matched prior types/);
  for (const log of staticLogs) assert.doesNotMatch(bytes(log).toString(), /\b(?:Exception|ParserError|RuntimeException)\b/);
  const derivedTypes = manifest.types.map(type => verifyRecord({ file: type.local_file, sha256: type.sha256 }));
  return { staticTypes: 55, anchors: 116, boundedChecks: 16, xmlProjections: 25, reusedTypeCount: 17,
    manifest: record(manifestFile), mechanisms: record(mechanismFile), reaIdentity: record(mechanisms.reaFile),
    priorManifests, reusedTypes, derivedTypes, logs: staticLogs.map(record) };
}

function capture() {
  const regression = captureRegression();
  const checkLog = 'test-results/animal-training-check.log', checkText = bytes(checkLog).toString();
  assert.match(checkText, /tsc --noEmit/);
  assert.doesNotMatch(checkText, /error TS\d+|command failed/i);
  const buildLog = 'test-results/animal-training-build.log', buildText = bytes(buildLog).toString();
  assert.match(buildText, /tsc --noEmit && vite build/); assert.match(buildText, /built in/);
  assert.doesNotMatch(buildText, /error TS\d+|error during build|Build failed/i);
  const assets = list('dist'); assert(assets.includes('dist/index.html'), 'Missing built entry point');
  assert(assets.some(file => file.endsWith('.js')), 'Missing built JavaScript');
  return {
    milestone: 'v59 animal training, master following, defense, rescue and physical hauling',
    nativeGameplay: false, browserInteraction: false, gpuRendering: false, naturalNewColonyAcceptance: false,
    scope: 'Native static evidence; controlled headless simulation fixtures, React SSR and CPU checks. Authentic published v58 cooking/cloth continuation with complete per-tick saved-state equality and five reloads. Only the version tag and strictly asserted inactive v59 animal-training defaults differ. Every historical production queue is explicit and remains fully compared, along with policies, RNG, biology, timers, existing tasks, identities and physical state. No original-game runtime, browser interaction, GPU rendering, or natural new-colony animal-training campaign acceptance. This verifier reads retained artifacts; it does not rerun tests or build.',
    sources: list('src').map(record),
    configuration: ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html'].map(record),
    regression, check: { log: record(checkLog) }, build: { log: record(buildLog), assets: assets.map(record) },
    original: captureOriginal(), legacyV58: captureLegacy(),
    scripts: ['scripts/research/extract-animal-training.ps1', 'scripts/research/collect-animal-training-evidence.ps1',
      legacyScript, verifier].map(record),
  };
}

const args = process.argv.slice(2);
assert(args.length === 1 && ['--freeze', '--local'].includes(args[0]), 'Use exactly one of --freeze or --local');
const result = capture();
if (args[0] === '--freeze') fs.writeFileSync(path.join(root, receipt), JSON.stringify(result, null, 2) + '\n');
else assert.deepEqual(json(receipt), result, 'Frozen local evidence differs');
console.log(JSON.stringify({ status: 'passed', files: result.regression.files, tests: result.regression.tests,
  legacyTicks: result.legacyV58.auditedTicks, assets: result.build.assets.length, mode: args[0] }));
