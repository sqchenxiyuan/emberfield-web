import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reports = [], assets = new Map();
async function read(file) {
  const bytes = await readFile(file);
  reports.push({ file, sha256: sha(bytes) });
  return JSON.parse(bytes);
}
function passed(r) {
  assert.equal(r.status, 'passed');
  assert.deepEqual(r.errors, []);
}
const unit = await read('test-results/survival-unit.json');
assert(unit.success);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPassedTests, unit.numTotalTests);
const campaign = await read('test-results/voxel-survival-campaign/report.json');
passed(campaign);
assert.equal(campaign.checks.length, 20);
assert(campaign.final.pawns.every((p) => p.health.malnutrition === 0 && p.food > 0));
for (const f of Object.values(campaign.fixtures))
  assert.equal(sha(await readFile(f.file)), f.sha256);
const temperature = await read('test-results/voxel-survival-temperature/report.json');
passed(temperature);
assert.equal(temperature.branches.reduce((n, b) => n + b.checks.length, 0), 16);
assert.equal(sha(await readFile(temperature.baseline.file)), temperature.baseline.sha256);
const temperatureFixtures = [];
for (const condition of ['hypothermia', 'heatstroke']) {
  for (const stage of ['exposed', 'recovered', 'fatal']) {
    const file = `test-results/voxel-survival-temperature/${condition}-${stage}.json`;
    const bytes = await readFile(file), save = JSON.parse(bytes);
    assert.equal(save.version, 10);
    if (stage === 'exposed') assert(save.pawns.some((p) => p.health[condition] >= 0.2));
    if (stage === 'recovered') assert(save.pawns.every((p) => p.health[condition] === 0));
    if (stage === 'fatal') assert(save.pawns.every((p) => p.dead && p.health[condition] === 1));
    temperatureFixtures.push({ file, sha256: sha(bytes), tick: save.tick });
  }
}
async function validateBrowser(r) {
  for (const mode of r.modes ?? [r]) {
    passed(mode);
    assert(mode.assets.length >= 4);
    for (const a of mode.assets) {
      const file = `dist/assets/${new URL(a.url).pathname.split('/').at(-1)}`;
      assert.equal(sha(await readFile(file)), a.sha256, a.url);
      assert(!a.error && a.matchesLocalBuild);
      assets.set(file, { file: file.slice(5), sha256: a.sha256, bytes: a.bytes });
    }
  }
}
const browser = await read('test-results/voxel-survival-browser/report.json');
await validateBrowser(browser);
assert.deepEqual(browser.modes.map((m) => m.mode), ['worker', 'main']);
for (const mode of browser.modes) assert.equal(mode.checks.length, 13);
const regressions = {};
for (const name of ['food', 'housing', 'power', 'preservation', 'logistics', 'stonecutting', 'worldgen', 'plants', 'layers']) {
  const file = name === 'layers' ? 'test-results/voxel-campaign/report.json'
    : `test-results/voxel-${name}-campaign/report.json`;
  const r = await read(file);
  passed(r);
  regressions[name] = { status: r.status, scope: r.scope, checkCount: r.checks?.length ?? null, errors: r.errors };
}
const runner = await read('test-results/survival-regressions.json');
assert.equal(runner.length, 11);
assert(runner.every((r) => r.code === 0));
regressions.runner = runner;
for (const name of ['worldgen', 'plants']) {
  const r = await read(`test-results/voxel-${name}-browser/report.json`);
  await validateBrowser(r);
  regressions[`${name}Browser`] = r;
}
const lifecycle = await read('test-results/voxel-lifecycle/report.json');
assert.equal(lifecycle.status, 'passed');
assert.deepEqual(lifecycle.browserErrors, []);
assert.equal(lifecycle.cycles.length, 6);
for (const a of lifecycle.assetDigests)
  assert.equal(sha(await readFile(`dist/assets/${new URL(a.url).pathname.split('/').at(-1)}`)), a.sha256);
regressions.lifecycle = lifecycle;
const sources = [], scripts = [];
for (const name of (await readdir('src/voxel')).sort()) {
  const file = `src/voxel/${name}`;
  sources.push({ file, sha256: sha(await readFile(file)) });
}
for (const file of [
  'scripts/voxel-survival-campaign-verify.mjs', 'scripts/voxel-survival-temperature-verify.mjs',
  'scripts/voxel-survival-browser-verify.mjs', 'tests/voxel-survival.test.ts',
  'tests/fixtures/voxel-v9-start.json', 'tests/fixtures/voxel-v9-start.provenance.json',
]) scripts.push({ file, sha256: sha(await readFile(file)) });
assert.equal(scripts.find((s) => s.file.endsWith('voxel-v9-start.json')).sha256,
  '662e24d8e4e87cf193cd74fac196e15e3ede787f5fcff29dfdc15ae1c687a0a7');
const out = 'docs/research/rimworld/evidence', screenshots = [];
await mkdir(`${out}/voxel`, { recursive: true });
const chrome = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await chrome.newPage();
  for (const name of ['collapsed', 'medical-bed', 'heatstroke', 'fatal', 'compact']) {
    const source = `test-results/voxel-survival-browser/worker-${name}.png`, bytes = await readFile(source);
    const encoded = await page.evaluate(async (raw) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + raw;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.83).split(',')[1];
    }, bytes.toString('base64'));
    const jpeg = Buffer.from(encoded, 'base64'), file = `voxel/survival-${name}.jpg`;
    await writeFile(`${out}/${file}`, jpeg);
    screenshots.push({ file, sha256: sha(jpeg), source, sourceSha256: sha(bytes), transform: 'Full gameplay viewport, JPEG .83, no crop' });
  }
} finally {
  await chrome.close();
}
const record = {
  generatedAt: new Date().toISOString(), kind: 'web-runtime-validated',
  scope: 'Selected survival slice: natural starvation, room-driven hypothermia/heatstroke, capacity loss, irreversible death, physical rescue between levels, feeding from actual cargo, interrupted saves and genuine v9 migration. Normal-command campaigns and browser UI checks do not establish full original-game equivalence, clothed tolerance, all-biome long-term balance or complete medicine. Native observations and static rules remain separate evidence.',
  sources, scripts, reports, assets: [...assets.values()],
  unit: { passed: unit.numPassedTests, total: unit.numTotalTests, failed: unit.numFailedTests },
  campaign, temperature, temperatureFixtures, browser, regressions, screenshots,
};
await writeFile(`${out}/voxel-survival-validation.json`, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ status: 'recorded', unit: record.unit, campaignChecks: campaign.checks.length,
  temperatureChecks: temperature.branches.reduce((n, b) => n + b.checks.length, 0),
  browserChecks: browser.modes.map((m) => ({ mode: m.mode, checks: m.checks.length })), screenshots: screenshots.length }, null, 2));
