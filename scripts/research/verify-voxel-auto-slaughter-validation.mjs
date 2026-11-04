// Freeze/recheck local evidence only; never starts a browser or the native game.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const receiptFile = 'docs/research/rimworld/evidence/auto-slaughter-voxel-validation.json';
const bytes = file => fs.readFileSync(file);
const json = file => JSON.parse(bytes(file));
const hash = data => createHash('sha256').update(data).digest('hex');
const normalized = file => hash(bytes(file).toString('utf8').replaceAll('\r\n', '\n'));
const record = file => ({ file, sha256: hash(bytes(file)), bytes: bytes(file).length });
const list = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? list(`${dir}/${e.name}`) : [`${dir}/${e.name}`]).sort();
const fingerprint = () => list('src').map(file => ({ file, sha256: normalized(file) }));
function assertSource(sources) {
  for (const [file, digest] of Object.entries(sources)) assert.equal(hash(bytes(file)), digest, `Executed source: ${file}`);
}
function checkedRecord(r) {
  assert.equal(hash(bytes(r.file)), r.sha256, r.file);
  if (r.byteLength !== undefined) assert.equal(bytes(r.file).length, r.byteLength, r.file);
  return record(r.file);
}
function capture() {
  const testFiles = list('tests').filter(f => /\.test\.tsx?$/.test(f));
  const reports = ['test-results/auto-slaughter-regression.json', 'test-results/auto-slaughter-core-rerun.json'];
  const results = new Map(), attempts = [];
  for (const [i, file] of reports.entries()) {
    const regression = json(file); assert.equal(regression.numPendingTests, 0);
    if (i > 0) { assert.equal(regression.success, true); assert.equal(regression.numFailedTests, 0); }
    attempts.push({ ...record(file), success: regression.success, passed: regression.numPassedTests, failed: regression.numFailedTests });
    for (const r of regression.testResults) results.set(path.relative(process.cwd(), r.name).replaceAll('\\', '/'), r);
  }
  assert.deepEqual([...results.keys()].sort(), testFiles);
  const coverage = testFiles.map(file => {
    const result = results.get(file); assert.equal(result.status, 'passed', file);
    for (const test of result.assertionResults) assert.equal(test.status, 'passed', test.fullName);
    return { file, sha256: normalized(file), tests: result.assertionResults.length };
  });
  const buildLog = 'test-results/auto-slaughter-build.log';
  assert.match(bytes(buildLog).toString(), /tsc --noEmit && vite build/);
  assert.match(bytes(buildLog).toString(), /built in/); assert.doesNotMatch(bytes(buildLog).toString(), /error TS\d+/);
  const legacyFile = 'test-results/auto-slaughter-legacy.json', legacy = json(legacyFile);
  assert.equal(legacy.status, 'passed'); assert.equal(legacy.nativeGameplay, false); assert.equal(legacy.browserInteraction, false);
  assert.equal(legacy.originalSubtree, 'a2891feeecf5b95053a6555e2229218537ed216a');
  assert.equal(legacy.animalCount, 8); assert.equal(legacy.finalWood.accounting, 90);
  assertSource(legacy.current.sources);
  assert.equal(hash(bytes(legacy.provenance.path)), legacy.provenance.sha256);
  const provenance = json(legacy.provenance.path), baseline = 'test-results/auto-slaughter-v47-baseline/';
  assert.equal(hash(bytes(baseline + provenance.sourceBundle)), provenance.sourceBundleSha256);
  const legacyRecords = [record(legacy.provenance.path), record(baseline + provenance.sourceBundle),
    ...provenance.samples.map(s => checkedRecord({ ...s, file: baseline + s.file })), ...legacy.checkpoints.map(checkedRecord)];
  const campaignFile = 'test-results/auto-slaughter-campaign.json', campaign = json(campaignFile);
  assert.equal(campaign.status, 'passed'); assert.equal(campaign.nativeGameplay, false); assert.equal(campaign.browserInteraction, false);
  assert.equal(campaign.auditedTicks, campaign.continuationTicks); assert.ok(campaign.auditedTicks > 0);
  assert.equal(campaign.outputs.carcassesProduced, 1); assert.equal(campaign.outputs.carcassesConsumed, 1);
  assert.ok(campaign.outputs.meatProduced > 0); assertSource(campaign.execution.sources);
  assert.equal(hash(bytes(campaign.execution.script)), campaign.execution.scriptSha256);
  const campaignRecords = campaign.checkpoints.map(checkedRecord);
  const manifest = json('docs/research/rimworld/evidence/auto-slaughter-manifest.json');
  const mechanisms = json('docs/research/rimworld/evidence/auto-slaughter-mechanisms.json');
  assert.equal(manifest.types.length, 18); assert.equal(mechanisms.rules.length, 69);
  assert.equal(mechanisms.boundedChecks.length, 10); assert.equal(mechanisms.packagedXml.length, 4);
  const staticLogs = ['test-results/auto-slaughter-static-extraction-check.log', 'test-results/auto-slaughter-static-mechanism-check.log'];
  assert.match(bytes(staticLogs[0]).toString(), /18 auto-slaughter types/);
  assert.match(bytes(staticLogs[1]).toString(), /69 anchors, 10 bounded checks, 4 packaged XML projections/);
  const tracked = ['scripts/research/verify-voxel-auto-slaughter-validation.mjs',
    'scripts/research/extract-auto-slaughter.ps1', 'scripts/research/collect-auto-slaughter-evidence.ps1',
    'scripts/voxel-auto-slaughter-legacy-verify.mjs', 'scripts/voxel-auto-slaughter-campaign-verify.mjs',
    'docs/research/rimworld/evidence/auto-slaughter-manifest.json', 'docs/research/rimworld/evidence/auto-slaughter-mechanisms.json',
    'docs/research/rimworld/evidence/auto-slaughter-v47-provenance.json',
    'docs/research/rimworld/139-auto-slaughter-mechanisms.md', 'docs/research/rimworld/140-auto-slaughter-gameplay.md',
    ...list('tests').filter(f => !/\.test\.tsx?$/.test(f)), '.github/workflows/pages.yml', 'package.json', 'package-lock.json', 'vite.config.ts'];
  return { schema: 1, version: 48, source: fingerprint(),
    meaning: 'Static evidence and local headless validation. No original-game/browser/preview/GUI interaction. Source text normalizes CRLF; runtime logs, saves and built bytes are exact.',
    regression: { files: coverage.length, tests: coverage.reduce((n, f) => n + f.tests, 0), skipped: 0,
      attempts, coverage,
      note: 'First full run retained two original wall-cancellation failures. The entire core file was rerun serially without changing assertions, source, or test timeout. Final coverage uses the latest passing complete file result.' },
    original: { staticTypes: 18, anchors: 69, boundedChecks: 10, xmlProjections: 4, checks: staticLogs.map(record) },
    legacyV47: { report: record(legacyFile), retained: legacyRecords, historical: legacy.historical,
      lockstep: legacy.historicalLockstep, roundTrips: legacy.roundTrips, continuationTicks: legacy.continuationTicks,
      finalTick: legacy.finalTick, finalWood: legacy.finalWood, animalCount: legacy.animalCount },
    campaign: { report: record(campaignFile), log: record('test-results/auto-slaughter-campaign.log'),
      retained: campaignRecords, provenance: campaign.provenance, checks: campaign.checks.length,
      auditedTicks: campaign.auditedTicks, continuationTicks: campaign.continuationTicks,
      finalTick: campaign.finalTick, outputs: campaign.outputs, scope: campaign.scope },
    tracked: tracked.map(file => ({ file, sha256: normalized(file) })),
    build: { log: record(buildLog), typecheck: 'tsc --noEmit passed as part of npm run build',
      entry: record('dist/index.html'), assets: list('dist/assets').map(record) },
    limits: ['No native or browser gameplay/visual acceptance in this milestone.',
      'Controlled unit fixtures are separate from the preserved historical model-generated saves.',
      'The campaign continues a verified historical newborn; it does not repeat the entire breeding campaign in v48.',
      'Animal bonds, products and full animal health are not implemented. Numbers remain provisional.'] };
}
const current = capture();
if (process.argv.includes('--freeze')) {
  fs.writeFileSync(receiptFile, JSON.stringify({ ...current, verifiedAt: new Date().toISOString() }, null, 2) + '\n');
} else {
  assert(process.argv.includes('--local'), 'Use --freeze or --local');
  const { verifiedAt, ...frozen } = json(receiptFile); assert(verifiedAt);
  assert.deepEqual(current, frozen, 'Evidence or source changed since freeze');
}
console.log(JSON.stringify({ status: 'passed', version: 48, tests: current.regression.tests,
  files: current.regression.files, campaignTicks: current.campaign.auditedTicks, assets: current.build.assets.length }));
