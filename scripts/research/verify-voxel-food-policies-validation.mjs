// Verify retained static/headless evidence; never launch a game, browser or GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const receipt = 'docs/research/rimworld/evidence/food-policies-voxel-validation.json';
const verifier = 'scripts/research/verify-voxel-food-policies-validation.mjs';
const legacyScript = 'scripts/voxel-food-policies-legacy-verify.mjs';
const originalHead = 'c25045a33cb8f9c6495fd825564fcacf9652678e';
const originalSubtree = '251da3031019722a0320180e9ffdc63ad3aa157c';
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
    .filter(entry => entry.isFile() && /^food-policies-.*\.json$/.test(entry.name))
    .map(entry => {
      const file = `test-results/${entry.name}`, report = json(file);
      // A malformed matching report is an error, never an excuse to silently
      // fall back to an older passing run. No manual allow/ignore filename list.
      assert(Array.isArray(report.testResults), `Expected Vitest JSON report: ${file}`);
      assert(Number.isFinite(report.startTime) && report.startTime > 0, `Missing run start time: ${file}`);
      return { file, report };
    })
    .sort((a, b) => a.report.startTime - b.report.startTime || a.file.localeCompare(b.file));
  assert(reports.length > 0, 'No food-policies Vitest reports');
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

function captureLegacy() {
  const legacyFile = 'test-results/food-policies-v56-baseline/report.json', legacy = json(legacyFile);
  assert.equal(legacy.status, 'passed');
  assert.equal(legacy.nativeGameplay, false); assert.equal(legacy.browserInteraction, false);
  assert.equal(legacy.originalHead, originalHead); assert.equal(legacy.originalSubtree, originalSubtree);
  assert.equal(legacy.historicalLockstep, true);
  assert.equal(legacy.historicalTick, 301422); assert.equal(legacy.finalTick, 302172);
  assert.equal(legacy.continuationTicks, 750); assert.equal(legacy.auditedTicks, 750);
  assert.equal(legacy.auditCount, 756);
  assert.equal(legacy.sourceIdentityRechecked, true); assert.equal(legacy.historicalInputsUnchanged, true);
  assert.deepEqual(legacy.normalization, ['version tag: 56 versus 57', 'assert exact default foodPolicies registry',
    'assert every pawn foodPolicyId is null; manualFoodOrder remains absent']);
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
  assert.equal(provenance.tree, '81a89cb427c81732b226de2fb9d306190f234bd1');
  assert.deepEqual(provenance.commands, []); assert.deepEqual(provenance.directStateChanges, []);
  assert.equal(provenance.sourceModel.sha256, historicalBundle.sha256);
  assert.deepEqual(provenance.sourceModel.sources, legacy.historicalExecution.sources);
  assert.equal(provenance.receipt.file, 'docs/research/rimworld/evidence/apparel-policies-voxel-validation.json');
  assert.equal(provenance.receipt.fromGit, originalHead);
  const publishedReceipt = verifyRecord(provenance.receipt), published = json(publishedReceipt.file);
  assert.equal(publishedReceipt.sha256, 'f721c2878ddd502f9d7d037e42dfb72a167c93035025f9dd55201c33daf18124');
  assert.equal(publishedReceipt.bytes, 164970);
  const publishedReceiptCopy = record(provenance.receipt.copy);
  assert.deepEqual(bytes(publishedReceiptCopy.file), bytes(publishedReceipt.file));
  const historicalArtifacts = provenance.verifiedHistoricalArtifacts.map(verifyRecord);
  assert(historicalArtifacts.length > 0, 'Missing authentic historical lineage');
  const previous = json(verifyRecord(provenance.historicalReport).file);
  const retained = published.legacyV55;
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
    ...retained.historicalArtifacts, ...retained.checkpoints];
  const artifactMap = new Map(historicalArtifacts.map(entry => [entry.file, entry]));
  for (const expected of requiredHistorical) assert.deepEqual(artifactMap.get(expected.file), verifyRecord(expected),
    'Historical provenance omitted a published dependency: ' + expected.file);
  const baseline = verifyRecord(legacy.baseline);
  assert.equal(baseline.sha256, 'a31de2f52651ce4abec1c8c10e2cba1361b171a0b37ac744c72acf9acf20355b');
  assert.equal(baseline.bytes, 236425);
  assert.equal(legacy.baseline.version, 56); assert.equal(legacy.baseline.tick, legacy.historicalTick);
  const publishedCheckpoint = published.legacyV55.checkpoints.find(checkpoint => checkpoint.file === baseline.file);
  assert(publishedCheckpoint, 'Baseline must appear in the authentic published v56 receipt');
  assert.equal(publishedCheckpoint.sha256, baseline.sha256); assert.equal(publishedCheckpoint.version, 56);
  const baselineSave = json(baseline.file);
  assert.equal(baselineSave.version, 56); assert.equal(baselineSave.tick, legacy.historicalTick);
  assert.equal(Object.hasOwn(baselineSave, 'foodPolicies'), false);
  assert.ok(baselineSave.apparelPolicies, 'Real v56 baseline retains the prior apparel policy feature');
  for (const pawn of baselineSave.pawns) {
    assert.equal(Object.hasOwn(pawn, 'foodPolicyId'), false);
    assert.equal(Object.hasOwn(pawn, 'manualFoodOrder'), false);
    assert.ok(pawn.apparelControl, 'Real v56 baseline retains apparel controls');
  }
  assert.equal(provenance.baseline.sha256, baseline.sha256);
  assert.deepEqual(bytes(provenance.baseline.copy), bytes(baseline.file), 'Historical baseline copy was rewritten');
  const defaultPolicies = { nextId: 2, policies: [{ id: 1, name: '不限制',
    allowedResources: ['meal', 'food', 'milk', 'eggUnfertilized', 'grain', 'meat', 'eggFertilized'] }] };
  const historicalCheckpoints = legacy.historicalCheckpoints.map(checkpoint => {
    const checked = verifyRecord(checkpoint), saved = json(checked.file);
    assert.equal(checkpoint.version, 56); assert.equal(saved.version, 56);
    assert.equal(saved.tick, checkpoint.tick);
    assert.equal(Object.hasOwn(saved, 'foodPolicies'), false);
    for (const pawn of saved.pawns) {
      assert.equal(Object.hasOwn(pawn, 'foodPolicyId'), false);
      assert.equal(Object.hasOwn(pawn, 'manualFoodOrder'), false);
    }
    return { ...checked, version: checkpoint.version, tick: checkpoint.tick };
  });
  assert.deepEqual(historicalCheckpoints.map(checkpoint => checkpoint.tick), legacy.reloads.map(reload => reload.tick));
  const checkpoints = legacy.checkpoints.map((checkpoint, index) => {
    const checked = verifyRecord(checkpoint), saved = json(checked.file);
    assert.equal(checkpoint.version, 57); assert.equal(saved.version, 57);
    assert.equal(saved.tick, checkpoint.tick);
    assert.deepEqual(saved.foodPolicies, defaultPolicies);
    for (const pawn of saved.pawns) {
      assert.equal(pawn.foodPolicyId, null, 'Historical pawns must retain unrestricted food defaults exactly');
      assert.equal(Object.hasOwn(pawn, 'manualFoodOrder'), false, 'Migration cannot invent a manual consumption order');
      delete pawn.foodPolicyId;
    }
    delete saved.foodPolicies;
    saved.version = 56;
    assert.deepEqual(saved, json(historicalCheckpoints[index].file),
      'Every retained checkpoint must match the actual historical model after only exact new-default normalization');
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
  const manifestFile = 'docs/research/rimworld/evidence/food-policies-manifest.json';
  const mechanismFile = 'docs/research/rimworld/evidence/food-policies-mechanisms.json';
  const manifest = json(manifestFile), mechanisms = json(mechanismFile);
  assert.equal(manifest.source_sha256, originalAssembly); assert.equal(mechanisms.assemblySha256, originalAssembly);
  assert.equal(manifest.types.length, 37); assert.equal(mechanisms.rules.length, 123);
  assert.equal(mechanisms.boundedChecks.length, 17); assert.equal(mechanisms.packagedXml.length, 16);
  assert.equal(mechanisms.definitionProfiles.length, 8);
  assert.deepEqual(mechanisms.definitionProfiles.map(profile => profile.def).sort(),
    ['MealSimple', 'MealFine', 'MealLavish', 'MealSurvivalPack', 'MealNutrientPaste', 'RawRice', 'Milk',
      'EggChickenUnfertilized'].sort());
  const nutritionalScalars = { MealSimple: [.9, 'MealSimple', 'Meal'], MealFine: [.9, 'MealFine', 'Meal'],
    MealLavish: [1, 'MealLavish', 'Meal'], MealSurvivalPack: [.9, 'MealSimple', 'Meal'],
    MealNutrientPaste: [.9, 'MealAwful', 'Meal'], RawRice: [.05, 'RawBad', 'Seed'],
    Milk: [.05, 'RawTasty', 'AnimalProduct, Fluid'], EggChickenUnfertilized: [.25, 'RawBad', 'AnimalProduct'] };
  for (const profile of mechanisms.definitionProfiles) {
    assert(profile.chain.length > 1);
    assert.deepEqual(Object.values(profile.selectedInheritedScalars), nutritionalScalars[profile.def]);
    for (const level of profile.chain) {
      assert.match(level.sha256, /^[0-9a-f]{64}$/);
      assert(level.file.startsWith('Data/Core/Defs/')); assert(level.xpath.startsWith('/Defs/ThingDef['));
    }
    assert.equal(profile.chain.at(-1).parentName, '', 'Food profile must include the complete selected Core parent chain');
  }
  assert.equal(mechanisms.nativeReference.starvationOverridesPolicy, false);
  assert.equal(mechanisms.nativeReference.patientFeedingUsesEaterPolicy, true);
  assert.equal(mechanisms.nativeReference.inventoryUsesEaterPolicy, true);
  assert.equal(mechanisms.nativeReference.prisonerSelfEatingRespectsColonyPolicy, false);
  assert.equal(mechanisms.nativeReference.playerWardenSupplyRespectsPrisonerPolicy, true);
  assert.equal(mechanisms.nativeReference.automaticCandidateRequiresStorage, false);
  assert.equal(mechanisms.nativeReference.manualOrderedIngestConsultsPolicy, false);
  assert.equal(mechanisms.nativeReference.manualOrderedIngestBypassesForbiddenTargetGate, true);
  assert.equal(mechanisms.nativeReference.manualOrderDisablesSeparatePathAreaQuery, false);
  assert.equal(mechanisms.manifestFile, manifestFile);
  assert.equal(mechanisms.manifestSha256, record(manifestFile).sha256);
  assert.equal(mechanisms.collectorSha256, record('scripts/research/collect-food-policies-evidence.ps1').sha256);
  assert.equal(mechanisms.reaSha256, record(mechanisms.reaFile).sha256);
  const staticLogs = ['test-results/food-policies-extract-check.log', 'test-results/food-policies-mechanisms-check.log'];
  assert.match(bytes(staticLogs[0]).toString(), /Re-extracted and checked 37 food-policies types/);
  assert.match(bytes(staticLogs[1]).toString(), /123 anchors, 17 bounded checks, 16 XML projections, 8 inherited profiles/);
  for (const log of staticLogs) assert.doesNotMatch(bytes(log).toString(), /\b(?:Exception|ParserError|RuntimeException)\b/);
  const derivedTypes = manifest.types.map(type => verifyRecord({ file: type.local_file, sha256: type.sha256 }));
  return { staticTypes: 37, anchors: 123, boundedChecks: 17, xmlProjections: 16, foodProfiles: 8,
    manifest: record(manifestFile), mechanisms: record(mechanismFile), reaIdentity: record(mechanisms.reaFile),
    derivedTypes, logs: staticLogs.map(record) };
}

function capture() {
  const regression = captureRegression();
  const checkLog = 'test-results/food-policies-check.log', checkText = bytes(checkLog).toString();
  assert.match(checkText, /tsc --noEmit/);
  assert.doesNotMatch(checkText, /error TS\d+|command failed/i);
  const buildLog = 'test-results/food-policies-build.log', buildText = bytes(buildLog).toString();
  assert.match(buildText, /tsc --noEmit && vite build/); assert.match(buildText, /built in/);
  assert.doesNotMatch(buildText, /error TS\d+|error during build|Build failed/i);
  const assets = list('dist'); assert(assets.includes('dist/index.html'), 'Missing built entry point');
  assert(assets.some(file => file.endsWith('.js')), 'Missing built JavaScript');
  return {
    milestone: 'v57 shared food policies, physical self-feeding and patient/prisoner supply, explicit consumption orders and historical migration',
    nativeGameplay: false, browserInteraction: false, gpuRendering: false, naturalNewColonyAcceptance: false,
    scope: 'Native static evidence; controlled headless simulation fixtures, React SSR and CPU checks. Authentic published v56 cooking/cloth continuation with complete per-tick saved-state equality and five reloads; only exact default foodPolicies and null pawn foodPolicyId differ, and manualFoodOrder remains absent. Existing apparel policies and physical state remain in the historical comparison. No original-game runtime, browser interaction, GPU rendering, or natural new-colony food-policy campaign acceptance. This verifier reads retained artifacts; it does not rerun tests or build.',
    sources: list('src').map(record),
    configuration: ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html'].map(record),
    regression, check: { log: record(checkLog) }, build: { log: record(buildLog), assets: assets.map(record) },
    original: captureOriginal(), legacyV56: captureLegacy(),
    scripts: ['scripts/research/extract-food-policies.ps1', 'scripts/research/collect-food-policies-evidence.ps1',
      legacyScript, verifier].map(record),
  };
}

const args = process.argv.slice(2);
assert(args.length === 1 && ['--freeze', '--local'].includes(args[0]), 'Use exactly one of --freeze or --local');
const result = capture();
if (args[0] === '--freeze') fs.writeFileSync(path.join(root, receipt), JSON.stringify(result, null, 2) + '\n');
else assert.deepEqual(json(receipt), result, 'Frozen local evidence differs');
console.log(JSON.stringify({ status: 'passed', files: result.regression.files, tests: result.regression.tests,
  legacyTicks: result.legacyV56.auditedTicks, assets: result.build.assets.length, mode: args[0] }));
