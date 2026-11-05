// Verify retained static/headless evidence; never launch a game, browser or GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const receipt = 'docs/research/rimworld/evidence/prison-food-voxel-validation.json';
const verifier = 'scripts/research/verify-voxel-prison-food-validation.mjs';
const legacyScript = 'scripts/voxel-prison-food-legacy-verify.mjs';
const originalHead = 'cb6753927bad97faa0db9850453c6ba6a965a68a';
const originalSubtree = 'a675c7c87605ce98ebd0d514c80dc2840da04f17';
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
    .filter(entry => entry.isFile() && /^prison-food-.*\.json$/.test(entry.name))
    .map(entry => {
      const file = `test-results/${entry.name}`, report = json(file);
      // A malformed matching report is an error, never an excuse to silently
      // fall back to an older passing run. No manual allow/ignore filename list.
      assert(Array.isArray(report.testResults), `Expected Vitest JSON report: ${file}`);
      assert(Number.isFinite(report.startTime) && report.startTime > 0, `Missing run start time: ${file}`);
      return { file, report };
    })
    .sort((a, b) => a.report.startTime - b.report.startTime || a.file.localeCompare(b.file));
  assert(reports.length > 0, 'No prison-food Vitest reports');
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

function captureLegacy() {
  const legacyFile = 'test-results/prison-food-v57-baseline/report.json', legacy = json(legacyFile);
  assert.equal(legacy.status, 'passed');
  assert.equal(legacy.nativeGameplay, false); assert.equal(legacy.browserInteraction, false);
  assert.equal(legacy.originalHead, originalHead); assert.equal(legacy.originalSubtree, originalSubtree);
  assert.equal(legacy.historicalLockstep, true);
  assert.equal(legacy.historicalTick, 301422); assert.equal(legacy.finalTick, 302172);
  assert.equal(legacy.continuationTicks, 750); assert.equal(legacy.auditedTicks, 750);
  assert.equal(legacy.auditCount, 756);
  assert.equal(legacy.sourceIdentityRechecked, true); assert.equal(legacy.historicalInputsUnchanged, true);
  assert.deepEqual(legacy.normalization, ['version tag: 57 versus 58']);
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
  assert.equal(provenance.tree, '534e2b4d7dc089b379d0ce799815e42e9f7b3283');
  assert.deepEqual(provenance.commands, []); assert.deepEqual(provenance.directStateChanges, []);
  assert.equal(provenance.sourceModel.sha256, historicalBundle.sha256);
  assert.deepEqual(provenance.sourceModel.sources, legacy.historicalExecution.sources);
  assert.equal(provenance.receipt.file, 'docs/research/rimworld/evidence/food-policies-voxel-validation.json');
  assert.equal(provenance.receipt.fromGit, originalHead);
  const publishedReceipt = verifyRecord(provenance.receipt), published = json(publishedReceipt.file);
  assert.equal(publishedReceipt.sha256, 'd495749c885758d775ef485c47ca11893e467eff7234f7b1a9391dfb64753744');
  assert.equal(publishedReceipt.bytes, 171180);
  const publishedReceiptCopy = record(provenance.receipt.copy);
  assert.deepEqual(bytes(publishedReceiptCopy.file), bytes(publishedReceipt.file));
  const historicalArtifacts = provenance.verifiedHistoricalArtifacts.map(verifyRecord);
  assert(historicalArtifacts.length > 0, 'Missing authentic historical lineage');
  const previous = json(verifyRecord(provenance.historicalReport).file);
  const retained = published.legacyV56;
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
  assert.equal(baseline.sha256, '2bbd556de8cd48d085eedcd1f6466e4f577472fc6da75e690d9c9c1bd23245a9');
  assert.equal(baseline.bytes, 236645);
  assert.equal(legacy.baseline.version, 57); assert.equal(legacy.baseline.tick, legacy.historicalTick);
  const publishedCheckpoint = published.legacyV56.checkpoints.find(checkpoint => checkpoint.file === baseline.file);
  assert(publishedCheckpoint, 'Baseline must appear in the authentic published v57 receipt');
  assert.equal(publishedCheckpoint.sha256, baseline.sha256); assert.equal(publishedCheckpoint.version, 57);
  const baselineSave = json(baseline.file);
  assert.equal(baselineSave.version, 57); assert.equal(baselineSave.tick, legacy.historicalTick);
  assert.ok(baselineSave.foodPolicies, 'Real v57 baseline retains the prior food policy feature');
  assert.ok(baselineSave.apparelPolicies, 'Real v57 baseline retains the prior apparel policy feature');
  for (const pawn of baselineSave.pawns) {
    assert.equal(Object.hasOwn(pawn, 'foodPolicyId'), true, 'Real v57 baseline retains food assignments');
    assert.ok(pawn.apparelControl, 'Real v57 baseline retains apparel controls');
  }
  assertInactivePrisonFood(baselineSave);
  assert.equal(provenance.baseline.sha256, baseline.sha256);
  assert.deepEqual(bytes(provenance.baseline.copy), bytes(baseline.file), 'Historical baseline copy was rewritten');
  const historicalCheckpoints = legacy.historicalCheckpoints.map(checkpoint => {
    const checked = verifyRecord(checkpoint), saved = json(checked.file);
    assert.equal(checkpoint.version, 57); assert.equal(saved.version, 57);
    assert.equal(saved.tick, checkpoint.tick);
    assertInactivePrisonFood(saved);
    return { ...checked, version: checkpoint.version, tick: checkpoint.tick };
  });
  assert.deepEqual(historicalCheckpoints.map(checkpoint => checkpoint.tick), legacy.reloads.map(reload => reload.tick));
  const checkpoints = legacy.checkpoints.map((checkpoint, index) => {
    const checked = verifyRecord(checkpoint), saved = json(checked.file);
    assert.equal(checkpoint.version, 58); assert.equal(saved.version, 58);
    assert.equal(saved.tick, checkpoint.tick);
    assertInactivePrisonFood(saved);
    saved.version = 57;
    assert.deepEqual(saved, json(historicalCheckpoints[index].file),
      'Every retained checkpoint must match the actual historical model after changing only the version tag');
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
  const manifestFile = 'docs/research/rimworld/evidence/prison-food-manifest.json';
  const mechanismFile = 'docs/research/rimworld/evidence/prison-food-mechanisms.json';
  const manifest = json(manifestFile), mechanisms = json(mechanismFile);
  assert.equal(manifest.source_sha256, originalAssembly); assert.equal(mechanisms.assemblySha256, originalAssembly);
  assert.equal(manifest.types.length, 30); assert.equal(mechanisms.rules.length, 103);
  assert.equal(mechanisms.boundedChecks.length, 17); assert.equal(mechanisms.packagedXml.length, 12);
  for (const projection of mechanisms.packagedXml) {
    assert.match(projection.sha256, /^[0-9a-f]{64}$/);
    assert(projection.file.startsWith('Data/Core/Defs/'));
    assert(projection.xpath.startsWith('/Defs/'));
    assert(Array.isArray(projection.fields) && projection.fields.length > 0);
  }
  assert.equal(mechanisms.nativeReference.ordinaryDeliveryConsumesFood, false);
  assert.equal(mechanisms.nativeReference.bedsideFeedingConsumesFood, true);
  assert.equal(mechanisms.nativeReference.foodAlreadySelectedInSameRoomSuppressesDelivery, true);
  assert.equal(mechanisms.nativeReference.sharedRoomSufficiencyCountsAllHungryPrisoners, true);
  assert.equal(mechanisms.nativeReference.prisonerPolicyRespectedByWardenSupply, true);
  assert.equal(mechanisms.nativeReference.prisonerPolicyRespectedBySelfEating, false);
  assert.equal(mechanisms.nativeReference.separateAllowFoodFieldInInspectedTracker, false);
  assert.equal(mechanisms.nativeReference.deliveryLegDirectlyRechecksRoomOrPolicy, false);
  assert.equal(mechanisms.nativeReference.weakRandomFallbackExists, true);
  assert.deepEqual(mechanisms.prisonerHungerThinkTree.ancestorsNearestFirst,
    [{ class: 'ThinkNode_PrioritySorter', tag: null }, { class: 'ThinkNode_Tagger', tag: 'SatisfyingNeeds' }]);
  assert(mechanisms.prisonerHungerThinkTree.siblingsInOrder.includes('JobGiver_GetFood'));
  const prior = mechanisms.reusedFoodPolicies;
  assert.equal(prior.manifestFile, 'docs/research/rimworld/evidence/food-policies-manifest.json');
  assert.equal(prior.mechanismsFile, 'docs/research/rimworld/evidence/food-policies-mechanisms.json');
  const priorManifestRecord = verifyRecord({ file: prior.manifestFile, sha256: prior.manifestSha256 });
  const priorMechanismsRecord = verifyRecord({ file: prior.mechanismsFile, sha256: prior.mechanismsSha256 });
  const priorManifest = json(prior.manifestFile), priorMechanisms = json(prior.mechanismsFile);
  assert.equal(priorManifest.source_sha256, originalAssembly); assert.equal(priorMechanisms.assemblySha256, originalAssembly);
  assert.equal(prior.matchingTypes.length, 17);
  const priorTypes = new Map(priorManifest.types.map(type => [type.type, type]));
  const currentTypes = new Map(manifest.types.map(type => [type.type, type]));
  assert.equal(currentTypes.size, manifest.types.length, 'Duplicate static type');
  const reusedTypes = prior.matchingTypes.map(type => {
    assert.equal(priorTypes.get(type.type)?.local_file, type.priorFile);
    assert.equal(priorTypes.get(type.type)?.sha256, type.sha256);
    assert.equal(currentTypes.get(type.type)?.sha256, type.sha256);
    return { type: type.type, ...verifyRecord({ file: type.priorFile, sha256: type.sha256 }) };
  });
  assert.equal(new Set(reusedTypes.map(type => type.type)).size, 17, 'Duplicate reused type');
  assert.equal(mechanisms.manifestFile, manifestFile);
  assert.equal(mechanisms.manifestSha256, record(manifestFile).sha256);
  assert.equal(mechanisms.collectorSha256, record('scripts/research/collect-prison-food-evidence.ps1').sha256);
  assert.equal(mechanisms.reaSha256, record(mechanisms.reaFile).sha256);
  const staticLogs = ['test-results/prison-food-extract-check.log', 'test-results/prison-food-mechanisms-check.log'];
  assert.match(bytes(staticLogs[0]).toString(), /Re-extracted and checked 30 prison-food types/);
  assert.match(bytes(staticLogs[1]).toString(), /103 anchors, 17 bounded checks, 12 XML projections, 17 matched prior types/);
  for (const log of staticLogs) assert.doesNotMatch(bytes(log).toString(), /\b(?:Exception|ParserError|RuntimeException)\b/);
  const derivedTypes = manifest.types.map(type => verifyRecord({ file: type.local_file, sha256: type.sha256 }));
  return { staticTypes: 30, anchors: 103, boundedChecks: 17, xmlProjections: 12, reusedTypeCount: 17,
    manifest: record(manifestFile), mechanisms: record(mechanismFile), reaIdentity: record(mechanisms.reaFile),
    reusedFoodPolicies: { manifest: priorManifestRecord, mechanisms: priorMechanismsRecord, types: reusedTypes },
    derivedTypes, logs: staticLogs.map(record) };
}

function capture() {
  const regression = captureRegression();
  const checkLog = 'test-results/prison-food-check.log', checkText = bytes(checkLog).toString();
  assert.match(checkText, /tsc --noEmit/);
  assert.doesNotMatch(checkText, /error TS\d+|command failed/i);
  const buildLog = 'test-results/prison-food-build.log', buildText = bytes(buildLog).toString();
  assert.match(buildText, /tsc --noEmit && vite build/); assert.match(buildText, /built in/);
  assert.doesNotMatch(buildText, /error TS\d+|error during build|Build failed/i);
  const assets = list('dist'); assert(assets.includes('dist/index.html'), 'Missing built entry point');
  assert(assets.some(file => file.endsWith('.js')), 'Missing built JavaScript');
  return {
    milestone: 'v58 physical prisoner food delivery, room rations, prisoner self-feeding and bedside feeding',
    nativeGameplay: false, browserInteraction: false, gpuRendering: false, naturalNewColonyAcceptance: false,
    scope: 'Native static evidence; controlled headless simulation fixtures, React SSR and CPU checks. Authentic published v57 cooking/cloth continuation with complete per-tick saved-state equality and five reloads; only the version tag differs. No new prisoner supply task or prisoner dining may appear in that historical campaign. Both food and apparel policies, assignments, existing tasks and all physical state remain in the comparison. No original-game runtime, browser interaction, GPU rendering, or natural new-colony prisoner-supply campaign acceptance. This verifier reads retained artifacts; it does not rerun tests or build.',
    sources: list('src').map(record),
    configuration: ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html'].map(record),
    regression, check: { log: record(checkLog) }, build: { log: record(buildLog), assets: assets.map(record) },
    original: captureOriginal(), legacyV57: captureLegacy(),
    scripts: ['scripts/research/extract-prison-food.ps1', 'scripts/research/collect-prison-food-evidence.ps1',
      legacyScript, verifier].map(record),
  };
}

const args = process.argv.slice(2);
assert(args.length === 1 && ['--freeze', '--local'].includes(args[0]), 'Use exactly one of --freeze or --local');
const result = capture();
if (args[0] === '--freeze') fs.writeFileSync(path.join(root, receipt), JSON.stringify(result, null, 2) + '\n');
else assert.deepEqual(json(receipt), result, 'Frozen local evidence differs');
console.log(JSON.stringify({ status: 'passed', files: result.regression.files, tests: result.regression.tests,
  legacyTicks: result.legacyV57.auditedTicks, assets: result.build.assets.length, mode: args[0] }));
