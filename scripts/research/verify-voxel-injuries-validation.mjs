import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = 'docs/research/rimworld/evidence';
const r = JSON.parse(readFileSync(`${base}/voxel-injuries-validation.json`, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.passed, r.unit.total);
assert(r.unit.total >= 381);
assert.equal(r.combatIntegration.length, 12);
assert(r.combatIntegration.every((t) => t.status === 'passed'));
assert(r.combatIntegration.some((t) => t.title.includes('waits for an exit')));
assert.equal(r.campaign.status, 'passed');
assert.deepEqual(r.campaign.errors, []);
assert.equal(r.campaign.checks.length, 11);
assert(r.campaign.final.days >= 4);
const colonists = r.campaign.final.pawns.filter((p) => p.faction === 'colony');
assert.equal(colonists.length, 3);
assert(colonists.every((p) => !p.dead));
assert(r.campaign.checks.at(-1).limitation.includes('separate controlled integration test'));
assert.deepEqual(
  r.browser.modes.map((m) => m.mode),
  ['worker', 'main'],
);
for (const mode of r.browser.modes) {
  assert.equal(mode.status, 'passed');
  assert.deepEqual(mode.errors, []);
  assert.equal(mode.checks.length, 8);
  assert(
    mode.assets.length > 0 && mode.assets.every((a) => a.status === 200 && a.matchesLocalBuild),
  );
}
assert.equal(r.regressions.runs.length, 8);
assert(r.regressions.runs.every((run) => run.code === 0));
for (const mode of [...r.regressions.survivalBrowser, ...r.regressions.apparelBrowser]) {
  assert.equal(mode.status, 'passed');
  assert.deepEqual(mode.errors, []);
}
for (const record of [...r.sources, ...r.scripts, ...r.assets, ...r.reports])
  assert(/^[a-f0-9]{64}$/.test(record.sha256));
assert.equal(r.screenshots.length, 4);
for (const shot of r.screenshots) {
  assert(/^voxel\/injuries-[a-z-]+\.jpg$/.test(shot.file));
  assert.equal(sha(readFileSync(`${base}/${shot.file}`)), shot.sha256);
}
assert.equal(
  sha(readFileSync('tests/fixtures/voxel-v11-start.json')),
  '25d42ed4a235ab04440921b00c8f36d3bd354d5f1de365b69407dff37a274918',
);
console.log(
  JSON.stringify({
    status: 'pass',
    unit: r.unit,
    campaignChecks: r.campaign.checks.length,
    browserChecks: r.browser.modes.map((m) => m.checks.length),
    scope:
      'Frozen observed Web validation, screenshots and genuine v11 save. Historical source/build hashes identify this tested version, not a requirement for future files to remain unchanged. Native evidence is verified separately.',
  }),
);
