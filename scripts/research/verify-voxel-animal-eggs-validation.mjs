// Local model/build evidence only; never starts a game, browser or preview.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const receipt = 'docs/research/rimworld/evidence/animal-eggs-voxel-validation.json';
const bytes = file => fs.readFileSync(file), json = file => JSON.parse(bytes(file));
const hash = value => createHash('sha256').update(value).digest('hex');
const record = file => ({ file, sha256: hash(bytes(file)), bytes: bytes(file).length });
const list = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? list(`${dir}/${e.name}`) : [`${dir}/${e.name}`]).sort();
const relative = file => path.relative(process.cwd(), file).replaceAll('\\', '/');

function capture() {
  const testFiles = list('tests').filter(file => /\.test\.tsx?$/.test(file));
  const results = new Map(), attempts = [];
  // Keep early failures as evidence; replace coverage only with complete files
  // from subsequent runs, never with individual passing assertions.
  const reports = ['test-results/animal-eggs-legacy-targeted.json',
    'test-results/animal-eggs-ui-tests.json', 'test-results/animal-eggs-legacy-rerun.json',
    'test-results/animal-eggs-core-tests.json', 'test-results/animal-eggs-regression.json',
    'test-results/animal-eggs-regression-rerun.json', 'test-results/animal-eggs-final-tests.json',
    'test-results/animal-eggs-logistics-rerun.json']
    .filter(file => fs.existsSync(file)).map(file => ({ file, report: json(file) }))
    .sort((a, b) => a.report.startTime - b.report.startTime);
  for (const { file, report } of reports) {
    attempts.push({ ...record(file), passed: report.numPassedTests, failed: report.numFailedTests,
      pending: report.numPendingTests });
    for (const result of report.testResults) results.set(relative(result.name), result);
  }
  assert.deepEqual([...results.keys()].sort(), testFiles, 'Every current test file needs a complete latest result');
  const coverage = testFiles.map(file => {
    const result = results.get(file); assert.equal(result.status, 'passed', file);
    assert(result.assertionResults.length > 0, file);
    for (const test of result.assertionResults) assert.equal(test.status, 'passed', test.fullName);
    return { ...record(file), tests: result.assertionResults.length };
  });
  const buildLog = 'test-results/animal-eggs-build.log';
  assert.match(bytes(buildLog).toString(), /tsc --noEmit && vite build/);
  assert.match(bytes(buildLog).toString(), /built in/);
  assert.doesNotMatch(bytes(buildLog).toString(), /error TS\d+/);
  const legacyFile = 'test-results/animal-eggs-v50-baseline/report.json';
  const legacy = json(legacyFile);
  assert.equal(legacy.status, 'passed');
  assert.equal(legacy.originalHead, '367639684c48d55b43f5a8bb7bed548ed6db6bbd');
  assert.equal(legacy.originalSubtree, '6b32422008dbbdc6bc549dab128c725f78d7c411');
  assert.equal(legacy.historicalLockstep, true); assert.equal(legacy.captureTicks, 158);
  assert.equal(legacy.auditedTicks, 750); assert.equal(legacy.continuationTicks, 750);
  assert.deepEqual(legacy.outputs, { meals: 1, apparel: 1, material: 'cloth' });
  for (const [file, digest] of Object.entries(legacy.execution.sources))
    assert.equal(hash(bytes(file)), digest, `Executed model changed: ${file}`);
  assert.equal(hash(bytes(legacy.execution.script)), legacy.execution.scriptSha256);
  assert.equal(hash(bytes(legacy.provenance.file)), legacy.provenance.sha256);
  for (const checkpoint of legacy.checkpoints) assert.equal(hash(bytes(checkpoint.file)), checkpoint.sha256);
  const provenance = json(legacy.provenance.file);
  assert.equal(provenance.subtree, legacy.originalSubtree);
  assert.equal(hash(bytes(provenance.baseline.file)), provenance.baseline.sha256);
  const manifestFile = 'docs/research/rimworld/evidence/animal-eggs-manifest.json';
  const mechanismFile = 'docs/research/rimworld/evidence/animal-eggs-mechanisms.json';
  const manifest = json(manifestFile), mechanisms = json(mechanismFile);
  assert.equal(manifest.types.length, 43); assert.equal(mechanisms.manifestSha256, hash(bytes(manifestFile)));
  assert.equal(mechanisms.rules.length, 115); assert.equal(mechanisms.boundedChecks.length, 9);
  assert.equal(mechanisms.packagedXml.length, 25); assert.equal(mechanisms.coreBiomeAbsence.length, 6);
  const staticLogs = ['test-results/animal-eggs-static-extraction-check.log',
    'test-results/animal-eggs-static-mechanism-check.log'];
  assert.match(bytes(staticLogs[0]).toString(), /checked 43/i);
  assert.match(bytes(staticLogs[1]).toString(), /115 anchors, 9 bounded checks, 25 packaged XML projections, 6 Core biome absence files/);
  return {
    milestone: 'v51 chicken eggs, incubation and food production', nativeGameplay: false, browserInteraction: false,
    scope: 'Static native evidence; controlled model fixtures for mating, laying, containers, hatching, trade and food. Authentic v50 cooking and cloth-task continuation. No natural fresh-colony chicken campaign or GPU visual acceptance.',
    sources: list('src').map(record),
    regression: { files: coverage.length, tests: coverage.reduce((n, file) => n + file.tests, 0), attempts, coverage },
    build: { log: record(buildLog), assets: list('dist').map(record) },
    original: { staticTypes: 43, anchors: 115, boundedChecks: 9, xmlProjections: 25, coreBiomeFiles: 6,
      manifest: record(manifestFile), mechanisms: record(mechanismFile), logs: staticLogs.map(record) },
    legacyV50: { report: record(legacyFile), captureTicks: legacy.captureTicks, auditedTicks: legacy.auditedTicks,
      outputs: legacy.outputs, provenance: record(legacy.provenance.file), baseline: record(provenance.baseline.file),
      script: record(legacy.execution.script), checkpoints: legacy.checkpoints.map(c => record(c.file)) },
    scripts: ['scripts/research/extract-animal-eggs.ps1', 'scripts/research/collect-animal-eggs-evidence.ps1',
      'scripts/research/verify-voxel-animal-eggs-validation.mjs'].map(record),
  };
}
const result = capture();
if (process.argv.includes('--freeze')) fs.writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n');
else {
  assert(process.argv.includes('--local'), 'Use --freeze or --local');
  assert.deepEqual(json(receipt), result, 'Frozen evidence differs');
}
console.log(JSON.stringify({ status: 'passed', files: result.regression.files, tests: result.regression.tests,
  legacyTicks: result.legacyV50.auditedTicks, assets: result.build.assets.length }));
