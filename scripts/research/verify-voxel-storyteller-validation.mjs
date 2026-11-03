import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => assert(/^[a-f0-9]{64}$/.test(value), 'complete SHA-256 required');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const root = 'docs/research/rimworld/evidence';
export function verifyVoxelStoryteller(r, local = false) {
  assert.equal(r.kind, 'web-runtime-validated');
  assert.equal(r.version, 20);
  assert(r.unit.total >= 675);
  assert.equal(r.unit.total, r.unit.passed);
  assert.equal(r.unit.failed, 0);
  assert.equal(r.unit.tests.length, r.unit.total);
  assert(r.unit.tests.every(t => t.status === 'passed' && typeof t.name === 'string'));
  hash(r.source.bundleSha256);
  assert.equal(r.source.files.length, 6);
  assert.equal(new Set(r.source.files.map(f => f.path)).size, 6);
  for (const file of r.source.files) { assert(file.path.startsWith('src/voxel/')); hash(file.sha256); }
  const c = r.campaign;
  assert.equal(c.status, 'passed');
  assert.equal(c.formal, true);
  assert.deepEqual(c.errors, []);
  assert.equal(c.execution.sha256, r.source.bundleSha256);
  hash(c.execution.scriptSha256); hash(c.execution.openingSha256);
  assert(c.commands.every(item => item.result.ok));
  assert.equal(c.commands.filter(item => item.command.type === 'threats' && item.command.enabled).length, 1);
  assert(c.commands.some(item => item.command.type === 'difficulty' && item.command.difficulty === 'extreme'));
  for (const key of ['expansion', 'rawCargo', 'delivered', 'multiRaid', 'healthLoss', 'recovery', 'deterministicReload', 'difficultyComparison'])
    assert.equal(c.coverage[key], true, key);
  for (const key of ['ground', 'cargo', 'delivered']) assert(c.rawAudits[key] > 0);
  for (const name of ['initial', 'armed', 'enabled', 'event-ready', 'multi-raid', 'injured', 'recovered', 'final']) {
    const f = c.fixtures[name];
    assert(f && f.version === 20 && Number.isSafeInteger(f.tick) && f.tick >= 0, name);
    hash(f.sha256);
  }
  assert.equal(c.fixtures.initial.tick, 0, 'formal run must begin with a fresh colony');
  assert.equal(c.fixtures.final.tick, c.finalTick);
  let priorTerminalTick = 0;
  for (const segment of c.executionSegments ?? []) {
    hash(segment.report.sha256); hash(segment.execution.scriptSha256);
    assert.equal(segment.execution.sha256, c.execution.sha256, 'all formal segments use the same game source');
    assert.equal(segment.status, 'failed', 'retain the actual failed preparation attempt');
    assert(segment.terminalTick >= priorTerminalTick);
    assert.equal(segment.resumedFixture.tick, segment.terminalTick, 'ordinary continuation does not rewind the clock');
    hash(segment.resumedFixture.sha256);
    assert(c.branches.some(branch => branch.origin?.sha256 === segment.resumedFixture.sha256 && branch.tick === segment.terminalTick));
    priorTerminalTick = segment.terminalTick;
  }
  assert(Array.isArray(c.recoveryProof) && c.recoveryProof.length > 0, 'a genuinely injured survivor must recover');
  for (const proof of c.recoveryProof) {
    assert.equal(proof.pawnId, proof.injury.id);
    assert(proof.injury.wounds.length > 0 || proof.injury.infections.length > 0);
    assert.equal(c.fixtures[proof.injury.fixture]?.tick, proof.injury.tick);
    assert(proof.recovery.tick > proof.injury.tick);
    assert.equal(proof.recovery.alive, true);
    assert.equal(proof.recovery.downed, false);
    assert.deepEqual(proof.recovery.wounds, []);
    assert.deepEqual(proof.recovery.infections, []);
    assert(proof.recovery.lastTend?.tick >= proof.injury.tick);
    assert(proof.herbConsumedSinceArmed > 0);
    assert.equal(proof.recovery.tick, c.fixtures.recovered.tick);
  }
  const events = c.final.storyteller.events;
  assert(events.some(e => e.outcome === 'spawned' && e.members.length > 1));
  for (const event of events) {
    assert(Math.abs(event.budget - event.spent - event.remainder) < 1e-7);
    assert.equal(event.spent, event.members.reduce((sum, p) => sum + p.cost, 0));
    assert.equal(new Set(event.members.map(p => p.pawnId)).size, event.members.length);
    assert(event.members.every(p => ['drifter', 'thrasher', 'scavenger'].includes(p.kind)));
  }
  if (c.coverage.adaptationLoss) {
    assert(c.fixtures['adaptation-loss']);
    assert(c.final.storyteller.losses.length > 0);
  } else assert(r.limitations.some(text => /adaptation|适应/.test(text)), 'unobserved live loss must remain explicit');
  const browser = r.browser;
  assert.equal(browser.preparedOnly, false, 'preparation-only browser checks are not final acceptance');
  assert.equal(browser.campaign.execution.sha256, c.execution.sha256);
  assert.equal(browser.campaign.formal, true);
  assert.deepEqual(browser.modes.map(m => m.mode), ['worker', 'main']);
  for (const mode of browser.modes) {
    assert.equal(mode.status, 'passed');
    assert.deepEqual(mode.errors, []);
    assert(mode.checks.length >= 16);
    assert(mode.assets.length && mode.assets.every(a => a.status === 200 && a.matchesLocalBuild));
    assert(mode.screenshots.length >= 5);
    for (const image of mode.screenshots) hash(image.sha256);
  }
  assert.equal(browser.legacy.length, 8);
  for (const fixture of browser.legacy) {
    assert.equal(fixture.version, 19);
    assert.equal(fixture.loadedByOriginalSource, true);
    assert(fixture.file.startsWith('tests/fixtures/voxel-v19-storyteller-'));
    assert.equal(sha(readFileSync(fixture.file)), fixture.sha256);
    const provenance = json(fixture.provenanceFile);
    assert.equal(provenance.sha256, fixture.sha256);
  }
  assert(r.reports.length >= 4);
  assert.equal(new Set(r.reports.map(report => report.file)).size, r.reports.length);
  for (const report of r.reports) { assert(report.file.startsWith('test-results/')); hash(report.sha256); }
  assert.equal(browser.campaign.sha256, r.reports.find(report => report.file === browser.campaign.file)?.sha256);
  for (const segment of c.executionSegments ?? [])
    assert.equal(segment.report.sha256, r.reports.find(report => report.file === segment.report.file)?.sha256);
  if (local) {
    // Recorded output identity only; future game revisions do not invalidate
    // this historical acceptance record by changing current source or dist.
    for (const report of r.reports) assert.equal(sha(readFileSync(report.file)), report.sha256, report.file);
    assert.equal(sha(readFileSync(c.execution.bundle)), c.execution.sha256);
    assert.equal(sha(readFileSync(c.execution.script)), c.execution.scriptSha256);
    for (const f of Object.values(c.fixtures)) assert.equal(sha(readFileSync(f.file)), f.sha256, f.file);
    for (const segment of c.executionSegments ?? []) {
      assert.equal(sha(readFileSync(segment.report.file)), segment.report.sha256);
      assert.equal(sha(readFileSync(segment.execution.bundle)), segment.execution.sha256);
      assert.equal(sha(readFileSync(segment.execution.script)), segment.execution.scriptSha256);
      assert.equal(sha(readFileSync(segment.resumedFixture.file)), segment.resumedFixture.sha256);
      const parent = json(segment.report.file);
      assert.equal(parent.formal, true);
      assert.equal(parent.finalTick, segment.terminalTick);
      assert.deepEqual(parent.execution, segment.execution);
      assert.deepEqual(parent.fixtures.failure, segment.resumedFixture);
      assert.equal(parent.fixtures.initial.sha256, c.fixtures.initial.sha256);
      assert.deepEqual(c.commands.slice(0, parent.commands.length), parent.commands, 'retained complete ordinary command prefix');
      assert(parent.errors.length > 0, 'failed preparation diagnostics retained in original report');
    }
    const recovered = json(c.fixtures.recovered.file);
    for (const proof of c.recoveryProof) {
      const injured = json(c.fixtures[proof.injury.fixture].file);
      const before = injured.pawns.find(p => p.id === proof.pawnId);
      const after = recovered.pawns.find(p => p.id === proof.pawnId);
      assert(before && after);
      assert.deepEqual(before.trauma.wounds, proof.injury.wounds);
      assert.deepEqual(before.medical.infections, proof.injury.infections);
      assert.deepEqual(before.trauma.missingParts, proof.injury.missingParts);
      assert.equal(after.dead, false); assert.equal(after.downed, false);
      assert.deepEqual(after.trauma.wounds, proof.recovery.wounds);
      assert.deepEqual(after.medical.infections, proof.recovery.infections);
      assert.deepEqual(after.trauma.missingParts, proof.recovery.missingParts);
      assert.deepEqual(after.medical.lastTend, proof.recovery.lastTend);
    }
    for (const mode of browser.modes)
      for (const image of mode.screenshots) assert.equal(sha(readFileSync(image.file)), image.sha256, image.file);
  }
  return { tests: r.unit.total, campaignChecks: c.checks.length, browserChecks: browser.modes.map(m => m.checks.length), local };
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/verify-voxel-storyteller-validation.mjs'))
  console.log(JSON.stringify(verifyVoxelStoryteller(json(`${root}/voxel-storyteller-validation.json`), process.argv.includes('--local')), null, 2));
