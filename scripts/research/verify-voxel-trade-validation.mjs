import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => assert(/^[a-f0-9]{64}$/.test(value), 'complete SHA-256 required');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
export function verifyVoxelTrade(r, local = false) {
  assert.equal(r.kind, 'web-runtime-validated'); assert.equal(r.version, 21);
  assert(r.unit.total >= 701); assert.equal(r.unit.total, r.unit.passed);
  assert.equal(r.unit.failed, 0); assert.equal(r.unit.exitCode, 0);
  assert.equal(r.unit.tests.length, r.unit.total); assert(r.unit.tests.every(t => t.status === 'passed'));
  hash(r.source.bundleSha256); assert(r.source.files.length >= 30);
  assert.equal(new Set(r.source.files.map(f => f.path)).size, r.source.files.length);
  for (const file of r.source.files) hash(file.sha256);
  const c = r.campaign;
  assert.equal(c.status, 'passed'); assert.equal(c.formal, true); assert.equal(c.pilot, false);
  assert.deepEqual(c.errors, []); assert.equal(c.execution.sha256, r.source.bundleSha256);
  hash(c.execution.scriptSha256);
  for (const key of ['foodProduction', 'cottonHarvest', 'productionSale', 'buyAndSell', 'purchasedUse',
    'foodAge', 'equipmentIdentity', 'cancellation', 'repeatedCommit', 'reload', 'departure'])
    assert.equal(c.coverage[key], true, key);
  assert(c.commands.length > 0);
  const rejected = c.commands.filter(row => !row.result.ok);
  assert.equal(rejected.length, c.transactions.length, 'one rejected replay per actual transaction');
  for (const row of rejected) {
    assert.equal(row.command.type, 'tradeCommit');
    assert.equal(row.result.message, '这次交易已经结束');
    const previous = c.commands[c.commands.indexOf(row) - 1];
    assert.equal(previous.result.ok, true);
    assert.equal(previous.tick, row.tick);
    assert.deepEqual(previous.command, row.command, 'only deliberate immediate replays may fail');
  }
  assert(c.transactions.length >= 2);
  assert(c.visits.length >= 1);
  assert(c.finalTrade.receipts.length >= 2);
  assert.equal(new Set(c.finalTrade.receipts.map(t => t.id)).size, c.finalTrade.receipts.length);
  for (const receipt of c.finalTrade.receipts) {
    assert.equal(receipt.quotedSilverToColony - receipt.silverToColony, receipt.shortfall);
    assert(receipt.transferred.length > 0);
    assert(receipt.transferred.every(row => Number.isSafeInteger(row.batch.amount) && row.batch.amount > 0));
  }
  for (const name of ['initial', 'browser-ready', 'after-first-trade', 'second-trade-ready', 'before-departure', 'final']) {
    const f = c.fixtures[name]; assert(f, name); hash(f.sha256); assert.equal(f.version, 21);
  }
  assert.equal(c.fixtures.initial.tick, 0); assert.equal(c.fixtures.final.tick, c.finalTick);
  assert(c.finalTick > c.fixtures['browser-ready'].tick);
  assert.equal(c.finalTrade.caravans.length, 0, 'actual caravan has left');
  assert(c.purchasedMaterial.purchased >= 20);
  const b = r.browser;
  assert.equal(b.status, 'passed'); assert.equal(b.preliminary, false);
  assert.equal(b.campaign.formal, true); assert.equal(b.campaign.execution.sha256, c.execution.sha256);
  hash(b.execution.sha256);
  assert.deepEqual(b.modes.map(m => m.mode), ['worker', 'main']);
  for (const m of b.modes) {
    assert.equal(m.status, 'passed'); assert.deepEqual(m.errors, []);
    assert(m.checks.length >= 16); assert(m.transactions.length >= 2); assert(m.screenshots.length >= 4);
    assert(m.assets.length > 0 && m.assets.every(a => a.status === 200 && a.matchesLocalBuild));
    assert(m.fixtures.filter(f => f.version === 20).length >= 7);
    for (const image of m.screenshots) hash(image.sha256);
  }
  assert.equal(r.legacy.length, 7);
  for (const f of r.legacy) {
    assert.equal(f.version, 20); assert.equal(sha(readFileSync(f.file)), f.sha256);
    assert.equal(json(f.provenance).sha256, f.sha256);
  }
  for (const report of r.reports) hash(report.sha256);
  assert.equal(b.campaign.sha256, r.reports.find(f => f.file === b.campaign.file)?.sha256);
  if (local) {
    // Validate retained historical bytes, without binding historical acceptance
    // to later source or dist changes.
    for (const f of r.reports) assert.equal(sha(readFileSync(f.file)), f.sha256, f.file);
    assert.equal(sha(readFileSync(c.execution.bundle)), c.execution.sha256);
    assert.equal(sha(readFileSync(c.execution.script)), c.execution.scriptSha256);
    assert.equal(sha(readFileSync(b.execution.script)), b.execution.sha256);
    for (const f of Object.values(c.fixtures)) assert.equal(sha(readFileSync(f.file)), f.sha256, f.file);
    for (const m of b.modes) for (const f of m.screenshots) assert.equal(sha(readFileSync(f.file)), f.sha256);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = json('docs/research/rimworld/evidence/voxel-trade-validation.json');
  verifyVoxelTrade(data, process.argv.includes('--local'));
  console.log(`PASS v21 trade: ${data.unit.passed} local tests, ordinary campaign and Worker/main DOM interactions.`);
}
