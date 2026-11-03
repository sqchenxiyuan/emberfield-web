import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = 'docs/research/rimworld/evidence';
const r = JSON.parse(readFileSync(base + '/voxel-ranged-validation.json', 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hash = (s) => assert(/^[a-f0-9]{64}$/.test(s));
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.version, 18);
assert(r.unit.total >= 611);
assert.equal(r.unit.total, r.unit.passed);
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.process.code, 0);
assert.equal(r.unit.process.signal, null);
assert.equal(r.unit.process.unhandledError, false);
assert(r.rangedTests.length >= 72 && r.rangedTests.every((t) => t.status === 'passed'));
assert.equal(r.campaign.status, 'passed');
assert.deepEqual(r.campaign.errors, []);
assert.equal(r.campaign.resume, undefined, 'frozen campaign starts from a fresh colony');
assert(r.campaign.checks.length >= 40);
hash(r.campaign.execution.sha256);
for (const name of [
  'research-ready',
  'machining-working',
  'machining-power-off',
  'equipped',
  'aiming',
  'flight',
  'impact',
  'enemy-flight',
  'ranged-combat',
  'final',
]) {
  hash(r.campaign.fixtures[name].sha256);
  assert(r.campaign.fixtures[name].tick > 0);
}
assert.equal(r.final.tick, r.campaign.finalTick);
assert.equal(r.final.research.progress.Machining, 1000);
assert.equal(r.final.research.progress.Gunsmithing, 500);
assert.equal(r.final.research.progress.BlowbackOperation, 500);
assert.equal(r.final.stats.weaponsMade, 3);
assert.equal(r.final.sandbags.length, 3);
assert.deepEqual(r.equippedKinds, ['machinePistol', 'revolver', 'shortBow']);
assert(r.campaign.carriedLayers['steel@' + r.campaign.layout.machining.z] > 0);
assert.equal(r.regressions.status, 'passed');
assert.deepEqual(
  r.regressions.runs.map((x) => x.name),
  ['power', 'injuries', 'armor', 'skills', 'anatomy', 'voxel'],
);
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
  assert(m.checks.length >= 12);
  assert(m.assets.length > 0 && m.assets.every((a) => a.status === 200 && a.matchesLocalBuild));
  assert.notEqual(...m.machineMotion.frames);
}
assert.equal(r.lifecycle.status, 'passed');
assert.equal(r.lifecycle.cycles.length, 6);
assert.deepEqual(r.lifecycle.browserErrors, []);
assert.deepEqual(r.lifecycle.uiFailures, []);
for (const v of Object.values(r.lifecycle.convergence)) {
  assert.equal(v.min, v.max);
  assert.equal(v.delta, 0);
}
for (const s of r.historicalSaves) {
  assert.equal(sha(readFileSync(s.file)), s.sha256);
  assert.equal(JSON.parse(readFileSync(s.file, 'utf8')).version, 17);
}
assert(r.screenshots.length >= 4);
for (const s of r.screenshots) {
  assert(/^voxel\/ranged-[a-z-]+\.jpg$/.test(s.file));
  assert.equal(sha(readFileSync(base + '/' + s.file)), s.sha256);
}
for (const x of [...r.sources, ...r.scripts, ...r.reports, ...r.assets]) hash(x.sha256);
assert(
  r.reports.some((x) => x.file === r.unit.process.log && x.sha256 === r.unit.process.logSha256),
);
assert(r.limitations.some((x) => x.includes('20 TPS')));
assert(r.limitations.some((x) => x.includes('checkedCells')));
console.log(
  JSON.stringify(
    {
      status: 'pass',
      unit: r.unit.passed,
      rangedTests: r.rangedTests.length,
      campaign: r.campaign.checks.length,
      browser: r.browser.modes.map((m) => m.checks.length),
      regressions: r.regressions.runs.length,
      lifecycle: r.lifecycle.cycles.length,
      scope:
        'Frozen v18 Web ranged milestone. Native observations and source-derived formulas are separate evidence.',
    },
    null,
    2,
  ),
);
