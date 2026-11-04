// Verify retained static/headless evidence; never launch a game, browser or GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const receipt = 'docs/research/rimworld/evidence/animal-environment-voxel-validation.json';
const verifier = 'scripts/research/verify-voxel-animal-environment-validation.mjs';
const legacyScript = 'scripts/voxel-animal-environment-legacy-verify.mjs';
const originalHead = '9fd2b25d39f97c554ee43923ecc6bb04fcc9c753';
const originalSubtree = 'c520129db670931ea237a88925cd654fe4a4dce9';
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
    .filter(entry => entry.isFile() && /^animal-environment-.*\.json$/.test(entry.name))
    .map(entry => {
      const file = `test-results/${entry.name}`, report = json(file);
      // A malformed matching report is an error, never an excuse to silently
      // fall back to an older passing run. No manual allow/ignore filename list.
      assert(Array.isArray(report.testResults), `Expected Vitest JSON report: ${file}`);
      assert(Number.isFinite(report.startTime) && report.startTime > 0, `Missing run start time: ${file}`);
      return { file, report };
    })
    .sort((a, b) => a.report.startTime - b.report.startTime || a.file.localeCompare(b.file));
  assert(reports.length > 0, 'No animal-environment Vitest reports');
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
  const legacyFile = 'test-results/animal-environment-v54-baseline/report.json', legacy = json(legacyFile);
  assert.equal(legacy.status, 'passed');
  assert.equal(legacy.nativeGameplay, false); assert.equal(legacy.browserInteraction, false);
  assert.equal(legacy.originalHead, originalHead); assert.equal(legacy.originalSubtree, originalSubtree);
  assert.equal(legacy.historicalLockstep, true);
  assert.equal(legacy.historicalTick, 301422); assert.equal(legacy.finalTick, 302172);
  assert.equal(legacy.continuationTicks, 750); assert.equal(legacy.auditedTicks, 750);
  assert.equal(legacy.auditCount, 756);
  assert.equal(legacy.sourceIdentityRechecked, true); assert.equal(legacy.historicalInputsUnchanged, true);
  assert.deepEqual(legacy.normalization, ['version tag: 54 versus 55',
    'assert live and historical animals have exact untouched initial environmental defaults']);
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
  assert.deepEqual(provenance.commands, []); assert.deepEqual(provenance.directStateChanges, []);
  assert.equal(provenance.sourceModel.sha256, historicalBundle.sha256);
  assert.deepEqual(provenance.sourceModel.sources, legacy.historicalExecution.sources);
  assert.equal(provenance.receipt.file, 'docs/research/rimworld/evidence/animal-medical-voxel-validation.json');
  assert.equal(provenance.receipt.fromGit, originalHead);
  const publishedReceipt = verifyRecord(provenance.receipt), published = json(publishedReceipt.file);
  const publishedReceiptCopy = record(provenance.receipt.copy);
  assert.deepEqual(bytes(publishedReceiptCopy.file), bytes(publishedReceipt.file));
  const historicalArtifacts = provenance.verifiedHistoricalArtifacts.map(verifyRecord);
  assert(historicalArtifacts.length > 0, 'Missing authentic historical lineage');
  const previous = json(verifyRecord(provenance.historicalReport).file);
  assert.deepEqual(previous.execution.sources, legacy.historicalExecution.sources);
  assert.equal(previous.execution.sha256, historicalBundle.sha256);
  const baseline = verifyRecord(legacy.baseline);
  assert.equal(baseline.sha256, '0be9bdbe7d80fb839ec8308489e828918f4d49a2259e5c028bca512d34a7f55e');
  assert.equal(baseline.bytes, 235605);
  assert.equal(legacy.baseline.version, 54); assert.equal(legacy.baseline.tick, legacy.historicalTick);
  const publishedCheckpoint = published.legacyV53.checkpoints.find(checkpoint => checkpoint.file === baseline.file);
  assert(publishedCheckpoint, 'Baseline must appear in the authentic published v54 receipt');
  assert.equal(publishedCheckpoint.sha256, baseline.sha256); assert.equal(publishedCheckpoint.version, 54);
  const baselineSave = json(baseline.file);
  assert.equal(baselineSave.version, 54); assert.equal(baselineSave.tick, legacy.historicalTick);
  const animals = saved => [...saved.animals, ...saved.trade.receipts.flatMap(row => row.animalTransfers.map(t => t.animal))];
  for (const a of animals(baselineSave)) assert.equal(Object.hasOwn(a, 'environment'), false);
  assert.equal(provenance.baseline.sha256, baseline.sha256);
  assert.deepEqual(bytes(provenance.baseline.copy), bytes(baseline.file), 'Historical baseline copy was rewritten');
  const checkpoints = legacy.checkpoints.map(checkpoint => {
    const checked = verifyRecord(checkpoint), saved = json(checked.file);
    assert.equal(checkpoint.version, 55); assert.equal(saved.version, 55);
    assert.equal(saved.tick, checkpoint.tick);
    for (const a of animals(saved)) {
      assert.deepEqual(a.environment, { hypothermia: 0, heatstroke: 0 }, 'Only exact initial environmental defaults may differ');
      assert.notEqual(a.phase, 'shelter'); assert(!['shelter', 'climateExit'].includes(a.goal?.kind));
    }
    return { ...checked, version: checkpoint.version, tick: checkpoint.tick };
  });
  assert.deepEqual(checkpoints.map(checkpoint => checkpoint.tick), legacy.reloads.map(reload => reload.tick));
  return { report: record(legacyFile), originalHead, originalSubtree,
    historicalTick: legacy.historicalTick, finalTick: legacy.finalTick, auditedTicks: legacy.auditedTicks,
    auditCount: legacy.auditCount, normalization: legacy.normalization, outputs: legacy.outputs,
    ingredients: legacy.ingredients, reloads: legacy.reloads,
    provenance: provenanceRecord, publishedReceipt, publishedReceiptCopy, baseline, baselineCopy: record(provenance.baseline.copy),
    script: record(legacyScript), currentBundle, historicalBundle, historicalArtifacts, checkpoints };
}

function captureOriginal() {
  const manifestFile = 'docs/research/rimworld/evidence/animal-environment-manifest.json';
  const mechanismFile = 'docs/research/rimworld/evidence/animal-environment-mechanisms.json';
  const manifest = json(manifestFile), mechanisms = json(mechanismFile);
  assert.equal(manifest.source_sha256, originalAssembly); assert.equal(mechanisms.assemblySha256, originalAssembly);
  assert.equal(manifest.types.length, 43); assert.equal(mechanisms.rules.length, 91);
  assert.equal(mechanisms.boundedChecks.length, 10); assert.equal(mechanisms.packagedXml.length, 18);
  assert.equal(mechanisms.nativeReference.species.length, 5);
  assert.equal(mechanisms.manifestFile, manifestFile);
  assert.equal(mechanisms.manifestSha256, record(manifestFile).sha256);
  assert.equal(mechanisms.collectorSha256, record('scripts/research/collect-animal-environment-evidence.ps1').sha256);
  assert.equal(mechanisms.reaSha256, record(mechanisms.reaFile).sha256);
  const staticLogs = ['test-results/animal-environment-extract-check.log', 'test-results/animal-environment-mechanisms-check.log'];
  assert.match(bytes(staticLogs[0]).toString(), /Re-extracted and checked 43 animal-environment types/);
  assert.match(bytes(staticLogs[1]).toString(), /91 anchors, 10 bounded checks, 18 XML projections, 5 species/);
  for (const log of staticLogs) assert.doesNotMatch(bytes(log).toString(), /(?:Exception|ParserError|RuntimeException)/);
  return { staticTypes: 43, anchors: 91, boundedChecks: 10, xmlProjections: 18, species: 5,
    manifest: record(manifestFile), mechanisms: record(mechanismFile), reaIdentity: record(mechanisms.reaFile),
    logs: staticLogs.map(record) };
}

function capture() {
  const regression = captureRegression();
  const buildLog = 'test-results/animal-environment-build.log', buildText = bytes(buildLog).toString();
  assert.match(buildText, /tsc --noEmit && vite build/); assert.match(buildText, /built in/);
  assert.doesNotMatch(buildText, /error TS\d+|error during build|Build failed/i);
  const assets = list('dist'); assert(assets.includes('dist/index.html'), 'Missing built entry point');
  assert(assets.some(file => file.endsWith('.js')), 'Missing built JavaScript');
  return {
    milestone: 'v55 animal environmental illness, shelter, rescue, burns and recovery',
    nativeGameplay: false, browserInteraction: false, gpuRendering: false, naturalNewColonyAcceptance: false,
    scope: 'Native static evidence; controlled headless simulation fixtures, React SSR and CPU checks. Authentic v54 cooking/cloth continuation with per-tick equality and reloads. No original-game runtime, browser interaction, GPU rendering, or natural new-colony animal environmental campaign acceptance. This verifier reads retained artifacts; it does not rerun tests or build.',
    sources: list('src').map(record),
    configuration: ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html'].map(record),
    regression, build: { log: record(buildLog), assets: assets.map(record) },
    original: captureOriginal(), legacyV54: captureLegacy(),
    scripts: ['scripts/research/extract-animal-environment.ps1', 'scripts/research/collect-animal-environment-evidence.ps1',
      legacyScript, verifier].map(record),
  };
}

const args = process.argv.slice(2);
assert(args.length === 1 && ['--freeze', '--local'].includes(args[0]), 'Use exactly one of --freeze or --local');
const result = capture();
if (args[0] === '--freeze') fs.writeFileSync(path.join(root, receipt), JSON.stringify(result, null, 2) + '\n');
else assert.deepEqual(json(receipt), result, 'Frozen local evidence differs');
console.log(JSON.stringify({ status: 'passed', files: result.regression.files, tests: result.regression.tests,
  legacyTicks: result.legacyV54.auditedTicks, assets: result.build.assets.length, mode: args[0] }));
