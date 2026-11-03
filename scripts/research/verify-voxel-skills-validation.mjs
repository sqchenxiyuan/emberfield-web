import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = 'docs/research/rimworld/evidence';
const r = JSON.parse(readFileSync(base + '/voxel-skills-validation.json', 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.passed, r.unit.total);
assert(r.unit.total >= 452);
assert(r.skillTests.length >= 30 && r.skillTests.every((t) => t.status === 'passed'));
assert.equal(r.campaign.status, 'passed');
assert.deepEqual(r.campaign.errors, []);
assert.equal(r.campaign.final.version, 14);
assert(r.campaign.checks.length >= 16 && r.campaign.opening.checks >= 29);
assert(
  r.campaign.final.skills[2].skills.crafting.level > r.campaign.beforeSkills[2].crafting.level,
);
assert.equal(r.campaign.final.weapons.length, 7);
assert.equal(new Set(r.campaign.final.weapons.map((w) => w.id)).size, 7);
assert.equal(r.campaign.final.weapons.filter((w) => w.kind === 'steelLongsword').length, 5);
assert(
  r.campaign.final.weapons
    .filter((w) => w.kind !== 'woodClub')
    .every((w) => w.quality >= 0 && w.quality <= 5),
);
assert.equal(r.campaign.final.weapons.find((w) => w.kind === 'woodClub').quality, 2);
assert.equal(r.campaign.final.stats.consumed.steel, 630);
assert(r.campaign.final.stats.produced.steel >= 630);
assert.deepEqual(
  r.browser.modes.map((m) => m.mode),
  ['worker', 'main'],
);
for (const m of r.browser.modes) {
  assert.equal(m.status, 'passed');
  assert.deepEqual(m.errors, []);
  assert(m.checks.length >= 6);
  assert(m.assets.length && m.assets.every((a) => a.status === 200 && a.matchesLocalBuild));
}
assert(r.regressions.runs.length >= 13 && r.regressions.runs.every((v) => v.code === 0));
for (const key of ['apparelBrowser', 'injuriesBrowser']) {
  assert.equal(r.regressions[key].length, 2);
  assert(r.regressions[key].every((m) => m.status === 'passed' && !m.errors.length));
}
for (const item of [...r.sources, ...r.scripts, ...r.assets, ...r.reports])
  assert(/^[a-f0-9]{64}$/.test(item.sha256));
assert.equal(r.screenshots.length, 4);
for (const shot of r.screenshots) {
  assert(/^voxel\/skills-[a-z-]+\.jpg$/.test(shot.file));
  assert.equal(sha(readFileSync(base + '/' + shot.file)), shot.sha256);
}
assert.equal(
  sha(readFileSync('tests/fixtures/voxel-v13-start.json')),
  '4672d325a7aedf544554c1235fed784a296e5198237c7208ad7177a0d1a7d6d4',
);
assert(r.limitations.some((s) => s.includes('research')));
assert(r.limitations.some((s) => s.includes('damage-weighted')));
console.log(
  JSON.stringify({
    status: 'pass',
    unit: r.unit,
    skillTests: r.skillTests.length,
    campaignChecks: r.campaign.checks.length,
    openingChecks: r.campaign.opening.checks,
    browserChecks: r.browser.modes.map((m) => m.checks.length),
    regressions: r.regressions.runs.length,
    scope:
      'Frozen skill milestone; original runtime is separate. Source hashes identify observed history, not future-code immutability.',
  }),
);
