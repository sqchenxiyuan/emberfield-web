import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const base = 'docs/research/rimworld/evidence',
  r = JSON.parse(readFileSync(`${base}/voxel-apparel-validation.json`));
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.passed, r.unit.total);
assert(r.unit.total >= 351);
assert.equal(r.campaign.status, 'passed');
assert.deepEqual(r.campaign.errors, []);
assert.equal(r.campaign.checks.length, 25);
assert(r.campaign.final.minimumFood > 0);
assert(r.campaign.final.days > 20);
assert.equal(r.campaign.final.stats.tailored, 5);
assert.equal(r.campaign.final.stats.produced.apparel, 5);
assert.equal(r.campaign.final.stats.consumed.cloth, 260);
assert.equal(r.campaign.final.stats.produced.cloth, 640);
assert.equal(r.campaign.final.counts.apparel, 11);
assert(r.campaign.carriedLayers['cloth@7'] > 0 && r.campaign.carriedLayers['cloth@10'] > 0);
assert.equal(r.temperature.status, 'passed');
assert.deepEqual(r.temperature.errors, []);
assert.deepEqual(
  r.temperature.branches.map((b) => b.kind),
  ['hypothermia', 'heatstroke'],
);
for (const b of r.temperature.branches) {
  assert.equal(b.checks.length, 6);
  assert.equal(b.fullyNakedTick, 70);
  assert(b.minimumFood > 0);
  const effect = b.checks[4];
  assert.equal(effect.tick, 3600);
  assert(effect.nakedSeverity.every((n) => n > 0.04));
  assert.deepEqual(effect.clothedSeverity, [0, 0, 0]);
}
assert.deepEqual(
  r.browser.modes.map((m) => m.mode),
  ['worker', 'main'],
);
for (const m of r.browser.modes) {
  assert.equal(m.status, 'passed');
  assert.deepEqual(m.errors, []);
  assert.equal(m.checks.length, 14);
  assert(m.assets.every((a) => a.status === 200 && a.matchesLocalBuild && !a.error));
}
assert.equal(r.regressions.runner.length, 11);
assert(r.regressions.runner.every((s) => s.code === 0));
for (const name of ['worldgenBrowser', 'plantsBrowser', 'survivalBrowser'])
  for (const m of r.regressions[name].modes) {
    assert.equal(m.status, 'passed');
    assert.deepEqual(m.errors, []);
  }
assert.equal(r.regressions.lifecycle.status, 'passed');
assert.deepEqual(r.regressions.lifecycle.browserErrors, []);
assert.equal(r.regressions.lifecycle.cycles.length, 6);
for (const record of [...r.sources, ...r.scripts, ...r.assets, ...r.reports])
  assert(/^[0-9a-f]{64}$/.test(record.sha256));
assert.equal(r.screenshots.length, 4);
for (const s of r.screenshots) {
  assert(/^voxel\/apparel-[a-z-]+\.jpg$/.test(s.file));
  assert.equal(sha(readFileSync(`${base}/${s.file}`)), s.sha256);
}
assert.equal(
  sha(readFileSync('tests/fixtures/voxel-v10-start.json')),
  'ab270a77c6354c5690a1afc76458d8aaff5f4264f9b099f59710447fb1a180f5',
);
console.log(
  JSON.stringify({
    status: 'pass',
    scope:
      'Frozen web apparel report, screenshot bytes and genuine v10 fixture. Historical source/build hashes identify the tested release; they do not require future source to remain unchanged.',
    unit: r.unit,
    campaignChecks: r.campaign.checks.length,
    browserChecks: r.browser.modes.map((m) => m.checks.length),
  }),
);
