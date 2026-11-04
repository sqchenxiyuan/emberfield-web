// Receipt verification is read-only unless --freeze is explicitly supplied.
// Never launches a browser, preview, native game, or any GUI interaction.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const bytes = file => readFileSync(path.join(root, file));
const json = file => JSON.parse(bytes(file));
const hash = data => createHash('sha256').update(data).digest('hex');
// Tracked text is normalized so Git's Windows/Linux EOL conversion is harmless.
const textHash = file => hash(bytes(file).toString('utf8').replaceAll('\r\n', '\n'));
const receiptPath = 'docs/research/rimworld/evidence/item-forbidden-voxel-validation.json';
const list = folder => readdirSync(path.join(root, folder), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort();
const sourceFingerprint = () => {
  const files = list('src');
  return { files: files.length, sha256: hash(files.map(file => file + '\0' + textHash(file)).join('\n')), encoding: 'UTF-8 text with CRLF normalized to LF' };
};
const testFiles = list('tests').filter(file => file.endsWith('.test.ts'));
const record = file => ({ file, sha256: hash(bytes(file)) });
if (process.argv.includes('--freeze')) {
  const reports = ['item-forbidden-release-rest-tests.json', 'item-forbidden-release-repaired-tests.json',
    'item-forbidden-release-compat-tests.json', 'item-forbidden-release-core-confirmed-tests.json', 'item-forbidden-release-food-tests.json'];
  const latest = new Map(), attempts = [];
  for (const name of reports) {
    const file = 'test-results/' + name, result = json(file);
    attempts.push({ ...record(file), success: result.success, passed: result.numPassedTests, failed: result.numFailedTests, pending: result.numPendingTests });
    for (const entry of result.testResults) latest.set(path.relative(root, entry.name).replaceAll('\\', '/'), entry);
  }
  assert.deepEqual([...latest.keys()].sort(), testFiles, 'Every current test file must be represented');
  const coverage = testFiles.map(file => {
    const result = latest.get(file); assert.equal(result.status, 'passed', file);
    for (const test of result.assertionResults) assert.equal(test.status, 'passed', test.fullName);
    return { file, sha256: textHash(file), tests: result.assertionResults.length };
  });
  const foodLog = 'test-results/item-forbidden-release-food-tests.log';
  const foodReport = json('test-results/item-forbidden-release-food-tests.json');
  assert.equal(foodReport.success, true); assert.equal(foodReport.numPendingTests, 0);
  const harvestedTests = foodReport.testResults.flatMap(t => t.assertionResults).filter(t => t.fullName.startsWith('real harvested inputs, cooking and food persistence'));
  assert(harvestedTests.length > 0 && harvestedTests.every(t => t.status === 'passed'));
  assert.match(bytes('tests/voxel-food.test.ts').toString(), /s\.counts\(\)\.grain >= 90/);
  assert.match(bytes('tests/voxel-food.test.ts').toString(), /toBeGreaterThanOrEqual\(DAY \* 8\)/);
  const buildLog = 'test-results/item-forbidden-release-build.log', typeLog = 'test-results/item-forbidden-release-typecheck.log';
  assert.match(bytes(buildLog).toString(), /built in/); assert.doesNotMatch(bytes(typeLog).toString(), /error TS\d+/);
  const evidence = json('test-results/item-forbidden-evidence-check-report.json');
  assert.equal(evidence.checksPassed, 3);
  for (const check of evidence.checks) { assert.equal(check.exitCode, 0); assert.equal(hash(bytes(check.file)), check.sha256); }
  const boundary = json('docs/research/rimworld/evidence/item-forbidden-runtime-boundary.json');
  assert.equal(boundary.interruption.newMechanismScenariosCompleted, 0); assert.equal(boundary.publicScreenshotCount, 0);
  const legacy = json('test-results/item-forbidden-legacy.json'); assert.equal(legacy.status, 'passed'); assert.equal(legacy.checks.length, 6);
  const tracked = ['scripts/voxel-item-forbidden-legacy-verify.mjs', 'scripts/research/verify-voxel-item-forbidden-validation.mjs',
    'scripts/research/extract-item-forbidden.ps1', 'scripts/research/collect-item-forbidden-evidence.ps1',
    'scripts/research/collect-item-forbidden-runtime-boundary.ps1',
    'docs/research/rimworld/evidence/item-forbidden-manifest.json', 'docs/research/rimworld/evidence/item-forbidden-mechanisms.json',
    'docs/research/rimworld/evidence/item-forbidden-runtime-boundary.json', legacy.provenance];
  const receipt = { schema: 1, version: 45, verifiedAt: new Date().toISOString(), source: sourceFingerprint(),
    meaning: 'Frozen headless local validation, not original-game or browser interaction evidence. Text hashes normalize CRLF; local raw logs and saves use exact bytes.',
    regression: { files: coverage.length, tests: coverage.reduce((n, f) => n + f.tests, 0), skipped: 0, coverage, attempts,
      repairs: 'Initial full regression caught the UFT ingredient whitelist after allow, plus two previous tests rejecting generic flags. Fixed the whitelist and updated the obsolete expectations while retaining malformed-value rejection. Relevant suites passed on rerun. Typecheck also corrected the wealth assertion to a real nonzero wealth object.' },
    harvest: { ...record(foodLog), minimumTicks: 96000, minimumDays: 8, minimumGrain: 90, downstreamTests: harvestedTests.length,
      exactTickAndYieldCaptured: false, note: 'Passed real-harvest assertions establish these lower bounds. The JSON reporter did not retain the setup console line, so exact harvest tick/yield are not claimed or copied from v44.' },
    legacyV44: { report: record('test-results/item-forbidden-legacy.json'), provenance: legacy.provenance, checks: legacy.checks,
      note: 'Historical files unchanged. Ordinary jobs/path reservations reschedule on load; physical state, progress and accounting are preserved.' },
    original: { version: boundary.version, assemblySha256: boundary.assemblySha256, staticTypes: evidence.staticTypes,
      rules: evidence.rules, boundedChecks: evidence.boundedChecks, defNodes: evidence.defNodes, checks: evidence.checks,
      completedGameplayScenarios: 0, newSaveCount: boundary.newNativeSaveCount, publicScreenshots: 0,
      preparationActionsBeforePause: boundary.actions.length },
    browser: { executed: false, reason: 'User requested no further program interaction. UI was edited and built, not interactively verified.' },
    build: { log: record(buildLog), typecheck: record(typeLog), entry: record('dist/index.html'), assets: list('dist/assets').map(record) },
    tracked: tracked.map(file => ({ file, sha256: textHash(file) })),
    limits: 'Mechanics first, provisional balance. No v45 native gameplay, browser rendering, input, screenshot or fresh GUI campaign verification. Local tests contain controlled fixtures. Historical browser save provenance is not current UI evidence.' };
  writeFileSync(path.join(root, receiptPath), JSON.stringify(receipt, null, 2) + '\n');
}
const report = json(receiptPath);
assert.equal(report.version, 45); assert.deepEqual(report.source, sourceFingerprint());
assert.deepEqual(report.regression.coverage.map(f => f.file), testFiles);
let count = 0;
for (const entry of report.regression.coverage) { assert.equal(textHash(entry.file), entry.sha256, entry.file); count += entry.tests; }
assert.equal(count, report.regression.tests); assert.equal(report.regression.files, testFiles.length); assert.equal(report.regression.skipped, 0);
for (const entry of report.tracked) assert.equal(textHash(entry.file), entry.sha256, entry.file);
assert.equal(report.browser.executed, false); assert.equal(report.original.completedGameplayScenarios, 0);
assert.equal(report.original.publicScreenshots, 0); assert.equal(report.original.newSaveCount, 0);
assert.equal(report.original.staticTypes, 36); assert.equal(report.original.rules, 37); assert.equal(report.original.checks.length, 3);
assert.equal(report.harvest.minimumTicks, 96000); assert.equal(report.harvest.minimumGrain, 90);
assert.equal(report.harvest.exactTickAndYieldCaptured, false); assert.equal(report.legacyV44.checks.length, 6);
if (process.argv.includes('--local') || process.argv.includes('--freeze')) {
  const local = [...report.regression.attempts, report.harvest, report.legacyV44.report, ...report.legacyV44.checks,
    ...report.original.checks, report.build.log, report.build.typecheck, report.build.entry, ...report.build.assets];
  for (const entry of local) assert.equal(hash(bytes(entry.file)), entry.sha256, entry.file);
}
console.log(JSON.stringify({ status: 'passed', files: testFiles.length, tests: count,
  local: process.argv.includes('--local') || process.argv.includes('--freeze'), nativeGameplay: false, browserInteraction: false,
  meaning: 'The files match the recorded validation; this command does not rerun the tests.' }));
