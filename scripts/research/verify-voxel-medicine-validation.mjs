import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = 'docs/research/rimworld/evidence';
const r = JSON.parse(readFileSync(`${root}/voxel-medicine-validation.json`, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hash = (value) => assert(/^[a-f0-9]{64}$/.test(value));
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.version, 19);
assert(r.unit.total >= 645);
assert.equal(r.unit.total, r.unit.passed);
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.process.code, 0);
assert.equal(r.unit.process.signal, null);
assert.equal(r.unit.process.unhandledError, false);
assert(r.medicalTests.length >= 33 && r.medicalTests.every((t) => t.status === 'passed'));
const c = r.campaign;
assert.equal(c.status, 'passed');
assert.equal(c.formal, true);
assert.equal(c.resume, undefined, 'formal campaign must start fresh');
assert.deepEqual(c.errors, []);
assert(c.checks.length >= 63);
for (const key of ['herbs', 'coldStore', 'fetch', 'tend', 'naturalInfection', 'bedRest', 'recovery'])
  assert.equal(c.coverage[key], true);
hash(c.execution.sha256);
hash(c.execution.scriptSha256);
for (const name of [
  'herb-growing',
  'herb-grown',
  'herb-cold',
  'prepared',
  'wounded',
  'no-medicine',
  'fetching',
  'herb-carried',
  'tending',
  'tended',
  'infected',
  'medical-bed',
  'recovered',
  'final',
]) {
  const f = c.fixtures[name];
  assert(f && f.tick > 0 && f.version === 19, `missing ${name}`);
  hash(f.sha256);
}
for (const branch of c.branches) {
  if (!branch.origin?.fixture) continue;
  const f = c.fixtures[branch.origin.fixture];
  assert(f, 'branch must identify its actual ordinary-play origin');
  assert.equal(branch.origin.sha256, f.sha256);
  assert.equal(branch.startTick, f.tick);
}
if (c.coverage.naturalInfection) assert(c.fixtures.infected);
if (c.coverage.recovery) assert(c.fixtures.recovered);
else
  assert(
    c.limitations.some((text) => /recovery|infection/.test(text)),
    'unobserved recovery must be explicit',
  );
assert.equal(r.final.version, 19);
assert.equal(r.final.tick, c.finalTick);
assert.equal(r.final.pawns.length, 3);
assert(r.final.pawns.every((p) => !p.dead && p.medical.infections.length === 0));
assert(r.final.stats.produced.herb > 0 && r.final.stats.consumed.herb > 0);
assert.equal(
  r.browser.campaign.sha256,
  r.reports.find((x) => x.file === r.browser.campaign.file).sha256,
);
assert.deepEqual(
  r.browser.modes.map((m) => m.mode),
  ['worker', 'main'],
);
for (const mode of r.browser.modes) {
  assert.equal(mode.status, 'passed');
  assert.deepEqual(mode.errors, []);
  assert(mode.checks.length >= 14);
  assert(
    mode.assets.length > 0 && mode.assets.every((a) => a.status === 200 && a.matchesLocalBuild),
  );
  assert(mode.screenshots.length >= 5);
}
assert.equal(r.lifecycle.status, 'passed');
assert.equal(r.lifecycle.cycles.length, 6);
assert.deepEqual(r.lifecycle.browserErrors, []);
assert.deepEqual(r.lifecycle.uiFailures, []);
assert.equal(r.regressions.status, 'passed');
assert.deepEqual(
  r.regressions.runs.map((x) => x.name),
  ['injuries', 'armor', 'skills', 'anatomy'],
);
for (const run of r.regressions.runs) {
  assert.equal(run.code, 0);
  assert.equal(run.signal, null);
}
assert.equal(r.historicalSaves.length, 2);
for (const f of r.historicalSaves) {
  assert.equal(sha(readFileSync(f.file)), f.sha256);
  assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).version, 18);
}
for (const file of [...r.sources, ...r.scripts, ...r.assets, ...r.reports]) hash(file.sha256);
assert(r.screenshots.length >= 3);
for (const file of r.screenshots)
  assert.equal(sha(readFileSync(`${root}/${file.file}`)), file.sha256);
assert(r.limitations.length >= 5);
// Historical evidence stays valid after later releases; current-source audit is explicit.
if (process.argv.includes('--current')) {
  for (const f of [...r.sources, ...r.scripts, ...r.assets, ...r.reports])
    assert.equal(sha(readFileSync(f.file)), f.sha256, `changed ${f.file}`);
  for (const f of Object.values(c.fixtures)) assert.equal(sha(readFileSync(f.file)), f.sha256);
  assert.equal(sha(readFileSync(c.execution.bundle)), c.execution.sha256);
  assert.equal(sha(readFileSync(c.execution.script)), c.execution.scriptSha256);
}
console.log(
  JSON.stringify({
    status: 'passed',
    version: r.version,
    tests: r.unit.passed,
    medicalTests: r.medicalTests.length,
    campaignChecks: c.checks.length,
    coverage: c.coverage,
    browser: r.browser.modes.map((m) => ({ mode: m.mode, checks: m.checks.length })),
  }),
);
