import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'docs/research/rimworld/evidence';
const r = JSON.parse(readFileSync(base + '/voxel-armor-validation.json', 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
assert.equal(r.kind, 'web-runtime-validated');
assert.equal(r.version, 17);
assert(r.unit.total >= 539);
assert.equal(r.unit.total, r.unit.passed);
assert.equal(r.unit.failed, 0);
assert.equal(r.unit.process.code, 0);
assert.equal(r.unit.process.signal, null);
assert.equal(r.unit.process.unhandledError, false);
assert(r.armorTests.length >= 34 && r.armorTests.every((t) => t.status === 'passed'));
assert.equal(r.campaign.status, 'passed');
assert.deepEqual(r.campaign.errors, []);
assert(r.campaign.checks.length >= 25);
assert.equal(r.campaign.final.research.progress.PlateArmor, 600);
assert.equal(r.campaign.final.stats.produced.apparel, 2);
assert.equal(r.campaign.armorBeforeCombat.filter((p) => p.material === 'steel').length, 2);
assert(r.campaign.carriedLayers['steel@' + r.campaign.layout.smithy.z] > 0);
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
  assert(m.assets.length > 0 && m.assets.every((a) => a.status === 200 && a.matchesLocalBuild));
  assert.notEqual(...m.workMotion.frames);
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
  assert.equal(JSON.parse(readFileSync(s.file, 'utf8')).version, 16);
}
for (const s of r.screenshots) {
  assert(/^voxel\/armor-[a-z-]+\.jpg$/.test(s.file));
  assert.equal(sha(readFileSync(base + '/' + s.file)), s.sha256);
}
for (const x of [...r.sources, ...r.scripts, ...r.reports, ...r.assets])
  assert(/^[a-f0-9]{64}$/.test(x.sha256));
assert(
  r.reports.some((x) => x.file === r.unit.process.log && x.sha256 === r.unit.process.logSha256),
);
assert(
  r.limitations.some((x) => x.includes('20 TPS')) && r.limitations.some((x) => x.includes('[0,1)')),
);
console.log(
  JSON.stringify(
    {
      status: 'pass',
      unit: r.unit.passed,
      armorTests: r.armorTests.length,
      campaign: r.campaign.checks.length,
      browser: r.browser.modes.map((m) => m.checks.length),
      regressions: r.regressions.runs.length,
      lifecycle: r.lifecycle.cycles.length,
      scope:
        'Frozen v17 Web armor milestone; current sources can evolve, native/static evidence is separate.',
    },
    null,
    2,
  ),
);
