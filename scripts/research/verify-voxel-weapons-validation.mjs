import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = 'docs/research/rimworld/evidence';
const r = JSON.parse(readFileSync(base + '/voxel-weapons-validation.json', 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.total, r.unit.passed);
assert(r.unit.total >= 420);
assert(r.weaponTests.length >= 38 && r.weaponTests.every((t) => t.status === 'passed'));
assert.equal(r.campaign.status, 'passed');
assert.deepEqual(r.campaign.errors, []);
assert(r.campaign.checks.length >= 20);
assert.equal(r.campaign.final.version, 13);
assert.equal(r.campaign.final.stats.weaponsMade, 3);
assert.equal(r.campaign.final.stats.produced.steel, 240);
assert.equal(r.campaign.final.stats.consumed.steel, 230);
assert.deepEqual(r.campaign.final.weapons.map((p) => p.kind).sort(), [
  'steelKnife',
  'steelLongsword',
  'woodClub',
]);
assert.equal(new Set(r.campaign.final.weapons.map((p) => p.id)).size, 3);
assert(Math.abs(r.campaign.final.fuel - 26) < 1e-6);
assert(
  r.campaign.carriedLayers['steel@11'] > 0 &&
    r.campaign.carriedLayers['wood@11'] > 0 &&
    r.campaign.carriedLayers['weapon@11'] > 0,
);
assert.deepEqual(
  r.browser.modes.map((m) => m.mode),
  ['worker', 'main'],
);
for (const m of r.browser.modes) {
  assert.equal(m.status, 'passed');
  assert.deepEqual(m.errors, []);
  assert.equal(m.checks.length, 10);
  assert(m.assets.length > 0 && m.assets.every((a) => a.status === 200 && a.matchesLocalBuild));
}
assert.equal(r.regressions.runs.length, 5);
assert(r.regressions.runs.every((v) => v.code === 0));
for (const group of ['injuriesBrowser', 'apparelBrowser'])
  for (const m of r.regressions[group]) {
    assert.equal(m.status, 'passed');
    assert.deepEqual(m.errors, []);
  }
for (const item of [...r.sources, ...r.scripts, ...r.assets, ...r.reports])
  assert(/^[a-f0-9]{64}$/.test(item.sha256));
assert.equal(r.screenshots.length, 4);
for (const shot of r.screenshots) {
  assert(/^voxel\/weapons-[a-z-]+\.jpg$/.test(shot.file));
  assert.equal(sha(readFileSync(base + '/' + shot.file)), shot.sha256);
}
assert.equal(
  sha(readFileSync('tests/fixtures/voxel-v12-start.json')),
  '3cda54c4a0a4553175be0c982baeb22a87ee5acb514865b42c788ad69a272086',
);
assert(r.limitations.some((s) => s.includes('armor')));
assert(r.limitations.some((s) => s.includes('skills')));
console.log(
  JSON.stringify({
    status: 'pass',
    unit: r.unit,
    weaponTests: r.weaponTests.length,
    campaignChecks: r.campaign.checks.length,
    browserChecks: r.browser.modes.map((m) => m.checks.length),
    scope:
      'Frozen observed weapon milestone; source/build hashes identify tested history, not current-code immutability. Native observations are verified separately.',
  }),
);
