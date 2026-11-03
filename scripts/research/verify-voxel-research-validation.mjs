import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = 'docs/research/rimworld/evidence';
const r = JSON.parse(readFileSync(base + '/voxel-research-validation.json', 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.passed, r.unit.total);
assert.equal(r.unit.process.code, 0, 'Full test process must exit successfully');
assert.equal(r.unit.process.signal, null);
assert.equal(r.unit.process.unhandledError, false, 'Assertion totals cannot hide runner errors');
assert(/^[a-f0-9]{64}$/.test(r.unit.process.logSha256));
assert(
  r.reports.some(
    (entry) => entry.file === r.unit.process.log && entry.sha256 === r.unit.process.logSha256,
  ),
);
assert(r.unit.total >= 469);
assert(r.researchTests.length >= 17 && r.researchTests.every((t) => t.status === 'passed'));
assert.equal(r.campaign.status, 'passed');
assert.deepEqual(r.campaign.errors, []);
assert(r.campaign.checks.length >= 25);
assert.equal(r.campaign.final.version, 15);
assert.equal(r.campaign.final.research.origin, 'industrial-start');
assert.equal(r.campaign.final.research.current, null);
assert.equal(r.campaign.final.research.progress.Smithing, 700);
assert(
  r.campaign.final.research.progress.Batteries > 0 &&
    r.campaign.final.research.progress.Batteries < 400,
);
assert(r.campaign.final.skills[1].level > 8);
assert.equal(r.campaign.final.stats.consumed.steel, 125);
assert(r.campaign.final.stats.produced.steel >= 125);
assert(r.campaign.final.stats.eaten > 0);
assert(r.campaign.carriedLayers['steel@' + r.campaign.layout.bench.z] > 0);
assert(r.campaign.carriedLayers['wood@' + r.campaign.layout.bench.z] > 0);
for (const name of [
  'bench-built',
  'research-working',
  'research-partial',
  'research-complete',
  'final',
])
  assert(r.campaign.fixtures[name]);
assert.equal(r.skillsCampaign.status, 'passed');
assert(r.skillsCampaign.opening.checks >= 40);
assert.equal(r.skillsCampaign.final.version, 15);
assert.equal(r.skillsCampaign.final.weapons.length, 7);
for (const browser of [r.browser, r.skillsBrowser]) {
  assert.deepEqual(
    browser.modes.map((m) => m.mode),
    ['worker', 'main'],
  );
  for (const mode of browser.modes) {
    assert.equal(mode.status, 'passed');
    assert.deepEqual(mode.errors, []);
    assert(mode.checks.length >= (browser === r.browser ? 9 : 6));
    assert(mode.assets.length && mode.assets.every((a) => a.status === 200 && a.matchesLocalBuild));
  }
}
assert(r.regressions.runs.length >= 14 && r.regressions.runs.every((run) => run.code === 0));
assert.equal(new Set(r.regressions.runs.map((run) => run.name)).size, 14);
for (const run of r.regressions.runs) {
  const original = r.regressions.attempts.filter((attempt) => attempt.name === run.name).at(-1);
  assert.deepEqual(run, { ...original, code: original.exitCode });
  assert.equal(run.signal, null);
  assert.equal(run.status, 'passed');
}
for (const entry of [...r.sources, ...r.scripts, ...r.assets, ...r.reports])
  assert(/^[a-f0-9]{64}$/.test(entry.sha256));
assert.equal(r.screenshots.length, 4);
for (const shot of r.screenshots) {
  assert(/^voxel\/research-[a-z-]+\.jpg$/.test(shot.file));
  assert.equal(sha(readFileSync(base + '/' + shot.file)), shot.sha256);
}
const old = readFileSync('tests/fixtures/voxel-v14-start.json'),
  provenance = JSON.parse(readFileSync('tests/fixtures/voxel-v14-start.provenance.json', 'utf8'));
assert.equal(sha(old), provenance.sha256);
assert.equal(sha(old), r.historicalSave.sha256);
assert.equal(JSON.parse(old).version, 14);
assert(r.limitations.some((s) => s.includes('room')));
assert(r.limitations.some((s) => s.includes('20 TPS')));
console.log(
  JSON.stringify({
    status: 'pass',
    unit: r.unit,
    researchTests: r.researchTests.length,
    campaignChecks: r.campaign.checks.length,
    browserChecks: r.browser.modes.map((m) => m.checks.length),
    regressions: r.regressions.runs.length,
    scope:
      'Frozen research milestone; source hashes identify the observed release, not future source immutability. Native runtime evidence is separate.',
  }),
);
