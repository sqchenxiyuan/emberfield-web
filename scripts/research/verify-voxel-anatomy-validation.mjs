import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'docs/research/rimworld/evidence';
const r = JSON.parse(readFileSync(base + '/voxel-anatomy-validation.json', 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.version, 16);
assert(r.unit.total >= 505);
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.total, r.unit.passed);
assert.equal(r.unit.process.code, 0);
assert.equal(r.unit.process.signal, null);
assert.equal(r.unit.process.unhandledError, false);
assert(
  r.reports.some((x) => x.file === r.unit.process.log && x.sha256 === r.unit.process.logSha256),
);
assert(r.anatomyTests.length >= 36 && r.anatomyTests.every((t) => t.status === 'passed'));
assert.equal(r.campaign.status, 'passed');
assert.deepEqual(r.campaign.errors, []);
assert(r.campaign.checks.length >= 13);
assert.equal(r.campaign.anatomy.bodyParts, 64);
assert(r.campaign.anatomy.hitParts.includes('sternum'));
assert(r.campaign.anatomy.hitParts.includes('ribcage'));
assert(r.campaign.anatomy.hitParts.some((x) => x === 'leftTibia' || x === 'rightTibia'));
assert.equal(r.regressions.status, 'passed');
assert.equal(r.regressions.runs.length, 17);
assert.equal(new Set(r.regressions.runs.map((x) => x.name)).size, 17);
for (const run of r.regressions.runs) {
  assert.equal(run.code, 0);
  assert.equal(run.signal, null);
  assert.equal(run.status, 'passed');
}
assert.deepEqual(
  r.browser.modes.map((m) => m.mode),
  ['worker', 'main'],
);
for (const m of r.browser.modes) {
  assert.equal(m.status, 'passed');
  assert.deepEqual(m.errors, []);
  assert(m.checks.length >= 8);
  assert(m.assets.length && m.assets.every((a) => a.status === 200 && a.matchesLocalBuild));
}
assert.equal(r.lifecycle.status, 'passed');
assert.equal(r.lifecycle.cycles.length, 6);
assert.equal(r.lifecycle.navigationEvents.length, 1);
assert.deepEqual(r.lifecycle.hotUpdates, []);
assert.deepEqual(r.lifecycle.browserErrors, []);
assert.deepEqual(r.lifecycle.uiFailures, []);
assert(r.lifecycle.checks.length >= 5);
for (const c of r.lifecycle.cycles) assert.equal(c.savedPhysicalSha256, c.restoredPhysicalSha256);
for (const metric of Object.values(r.lifecycle.convergence)) {
  assert.equal(metric.min, metric.max);
  assert.equal(metric.delta, 0);
}
for (const c of r.lifecycle.uiChecks) {
  assert(c.afterScroll.fullyWithinViewport && c.afterScroll.allSamplePointsClickable);
  if (c.disabled) {
    assert.equal(c.label, '林地区');
    assert.equal(c.disabledReason, '需要研究「树木播种」');
  }
}
assert(r.lifecycle.scope.includes('excluding simulation/render workers'));
assert.equal(r.screenshots.length, 5);
for (const s of r.screenshots) {
  assert(/^voxel\/anatomy-[a-z-]+\.jpg$/.test(s.file));
  assert.equal(sha(readFileSync(base + '/' + s.file)), s.sha256);
}
for (const x of [...r.sources, ...r.scripts, ...r.reports, ...r.assets])
  assert(/^[a-f0-9]{64}$/.test(x.sha256));
for (const s of r.historicalSaves) {
  const bytes = readFileSync(s.file);
  assert.equal(sha(bytes), s.sha256);
  assert.equal(JSON.parse(bytes).version, 15);
}
assert(r.limitations.some((s) => s.includes('controlled')));
assert(r.limitations.some((s) => s.includes('20 TPS')));
assert(r.limitations.some((s) => s.includes('armor')));
console.log(
  JSON.stringify({
    status: 'pass',
    unit: r.unit,
    anatomyTests: r.anatomyTests.length,
    campaign: r.campaign.checks.length,
    browser: r.browser.modes.map((m) => m.checks.length),
    regressions: r.regressions.runs.length,
    lifecycleCycles: r.lifecycle.cycles.length,
    scope:
      'Frozen v16 anatomy milestone; source hashes identify observed artifacts, not immutability of future source. Native runtime and static evidence are separate.',
  }),
);
