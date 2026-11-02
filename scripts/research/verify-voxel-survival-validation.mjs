import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const evidence = 'docs/research/rimworld/evidence';
const r = JSON.parse(readFileSync(`${evidence}/voxel-survival-validation.json`, 'utf8'));
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.passed, r.unit.total);
assert.equal(r.campaign.status, 'passed');
assert.deepEqual(r.campaign.errors, []);
assert.equal(r.campaign.checks.length, 20);
assert(r.campaign.final.pawns.every((p) => p.health.malnutrition === 0 && p.food > 0));
assert.equal(r.temperature.status, 'passed');
assert.deepEqual(r.temperature.errors, []);
assert.deepEqual(r.temperature.branches.map((b) => b.kind),
  ['hypothermia', 'heatstroke', 'untreated-hypothermia', 'untreated-heatstroke']);
assert.deepEqual(r.temperature.branches.map((b) => b.checks.length), [6, 6, 2, 2]);
for (const b of r.temperature.branches.slice(2)) {
  const result = b.checks[0], condition = b.kind.slice('untreated-'.length);
  assert(result.deathTick > result.collapseTick);
  assert.equal(result.deceased.length, 3);
  assert(result.deceased.every((p) => p.health[condition] === 1 && p.deathReason));
}
assert.equal(r.temperatureFixtures.length, 6);
assert.deepEqual(r.browser.modes.map((m) => m.mode), ['worker', 'main']);
for (const mode of r.browser.modes) {
  assert.equal(mode.status, 'passed');
  assert.deepEqual(mode.errors, []);
  assert.equal(mode.checks.length, 13);
  assert(mode.assets.every((a) => a.status === 200 && a.matchesLocalBuild && !a.error));
}
for (const name of ['food', 'housing', 'power', 'preservation', 'logistics', 'stonecutting', 'worldgen', 'plants', 'layers']) {
  assert.equal(r.regressions[name].status, 'passed');
  assert.deepEqual(r.regressions[name].errors, []);
}
assert.equal(r.regressions.runner.length, 11);
assert(r.regressions.runner.every((s) => s.code === 0));
for (const name of ['worldgenBrowser', 'plantsBrowser']) {
  for (const m of r.regressions[name].modes) {
    assert.equal(m.status, 'passed');
    assert.deepEqual(m.errors, []);
  }
}
assert.equal(r.regressions.lifecycle.status, 'passed');
assert.deepEqual(r.regressions.lifecycle.browserErrors, []);
assert.equal(r.regressions.lifecycle.cycles.length, 6);
for (const record of [...r.sources, ...r.scripts, ...r.assets, ...r.reports, ...r.temperatureFixtures])
  assert(/^[0-9a-f]{64}$/.test(record.sha256));
assert.equal(r.screenshots.length, 5);
for (const shot of r.screenshots) {
  assert(/^voxel\/survival-[a-z-]+\.jpg$/.test(shot.file));
  assert.equal(sha(readFileSync(`${evidence}/${shot.file}`)), shot.sha256);
}
assert.equal(sha(readFileSync('tests/fixtures/voxel-v9-start.json')),
  '662e24d8e4e87cf193cd74fac196e15e3ede787f5fcff29dfdc15ae1c687a0a7');
console.log(JSON.stringify({ status: 'pass',
  scope: 'Frozen web survival report, screenshot bytes and genuine v9 fixture; historical source/build hashes identify the tested release and do not require future code to remain unchanged.',
  unit: r.unit, campaignChecks: r.campaign.checks.length,
  temperatureChecks: r.temperature.branches.reduce((n, b) => n + b.checks.length, 0),
  browserChecks: r.browser.modes.map((m) => m.checks.length) }, null, 2));
