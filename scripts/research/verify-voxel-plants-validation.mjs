import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const evidence = 'docs/research/rimworld/evidence';
const r = JSON.parse(readFileSync(`${evidence}/voxel-plants-validation.json`, 'utf8'));
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.passed, r.unit.total);
assert.equal(r.campaign.status, 'passed');
assert.deepEqual(r.campaign.errors, []);
assert(r.campaign.checks.length >= 10);
assert(r.campaign.final.minimumFood > 0);
assert(r.campaign.final.naturalSeedlings > 0);
assert.deepEqual(
  r.browser.modes.map((m) => m.mode),
  ['worker', 'main'],
);
for (const mode of r.browser.modes) {
  assert.equal(mode.status, 'passed');
  assert.deepEqual(mode.errors, []);
  assert(mode.checks.length >= 11);
}
for (const name of [
  'food',
  'housing',
  'power',
  'preservation',
  'logistics',
  'stonecutting',
  'worldgen',
  'layers',
])
  assert.equal(r.regressions[name].status, 'passed');
assert.equal(r.regressions.lifecycle.cycles.length, 6);
assert.equal(r.regressions.lifecycle.status, 'passed');
for (const record of [...r.sources, ...r.scripts, ...r.assets, ...r.reports])
  assert(/^[0-9a-f]{64}$/.test(record.sha256));
assert.equal(r.screenshots.length, 4);
for (const shot of r.screenshots) {
  assert(/^voxel\/plants-[a-z-]+\.jpg$/.test(shot.file));
  assert.equal(sha(readFileSync(`${evidence}/${shot.file}`)), shot.sha256);
}
assert.equal(
  sha(readFileSync('tests/fixtures/voxel-v8-start.json')),
  'e44adc4c30a85f9c58d38d78087c079a1694b0c58e14c62c28b2253820be0512',
);
console.log(
  JSON.stringify(
    {
      status: 'pass',
      scope:
        'Frozen web plants validation record, screenshot bytes and genuine v8 fixture; historical source/build hashes are identities, not claims that current files are identical.',
      unit: r.unit,
      campaignChecks: r.campaign.checks.length,
      browserChecks: r.browser.modes.map((m) => m.checks.length),
    },
    null,
    2,
  ),
);
