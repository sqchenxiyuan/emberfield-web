import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const reports = [],
  assets = new Map();
async function read(file) {
  const b = await readFile(file);
  reports.push({ file, sha256: sha(b) });
  return JSON.parse(b);
}
function passed(r) {
  assert.equal(r.status, 'passed');
  assert.deepEqual(r.errors, []);
}
const unit = await read('test-results/apparel-unit.json');
assert(unit.success);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPassedTests, unit.numTotalTests);
const campaign = await read('test-results/voxel-apparel-campaign/report.json');
passed(campaign);
assert.equal(campaign.final.stats.tailored, 5);
assert.equal(campaign.final.stats.consumed.cloth, 260);
assert(campaign.final.minimumFood > 0);
assert(campaign.final.days > 20);
for (const f of Object.values(campaign.fixtures))
  assert.equal(sha(await readFile(f.file)), f.sha256);
const temperature = await read('test-results/voxel-apparel-temperature/report.json');
passed(temperature);
async function checkBrowser(r) {
  for (const mode of r.modes ?? [r]) {
    passed(mode);
    assert(mode.assets.length >= 4);
    for (const a of mode.assets) {
      const file = `dist/assets/${new URL(a.url).pathname.split('/').at(-1)}`;
      assert.equal(sha(await readFile(file)), a.sha256);
      assert(a.matchesLocalBuild && !a.error);
      assets.set(file, { file: file.slice(5), sha256: a.sha256, bytes: a.bytes });
    }
  }
}
const browser = await read('test-results/voxel-apparel-browser/report.json');
await checkBrowser(browser);
assert.deepEqual(
  browser.modes.map((m) => m.mode),
  ['worker', 'main'],
);
const regressions = {};
const runner = await read('test-results/apparel-regressions.json');
assert.equal(runner.length, 11);
assert(runner.every((r) => r.code === 0));
regressions.runner = runner;
for (const name of ['worldgen', 'plants', 'survival']) {
  const r = await read(`test-results/voxel-${name}-browser/report.json`);
  await checkBrowser(r);
  regressions[`${name}Browser`] = r;
}
const lifecycle = await read('test-results/voxel-lifecycle/report.json');
assert.equal(lifecycle.status, 'passed');
assert.deepEqual(lifecycle.browserErrors, []);
assert.equal(lifecycle.cycles.length, 6);
for (const a of lifecycle.assetDigests)
  assert.equal(
    sha(await readFile(`dist/assets/${new URL(a.url).pathname.split('/').at(-1)}`)),
    a.sha256,
  );
regressions.lifecycle = lifecycle;
const sources = [],
  scripts = [];
for (const name of (await readdir('src/voxel')).sort()) {
  const file = `src/voxel/${name}`;
  sources.push({ file, sha256: sha(await readFile(file)) });
}
for (const file of [
  'scripts/voxel-apparel-campaign-verify.mjs',
  'scripts/voxel-apparel-temperature-verify.mjs',
  'scripts/voxel-apparel-browser-verify.mjs',
  'tests/voxel-apparel.test.ts',
  'tests/fixtures/voxel-v10-start.json',
  'tests/fixtures/voxel-v10-start.provenance.json',
])
  scripts.push({ file, sha256: sha(await readFile(file)) });
assert.equal(
  scripts.find((s) => s.file.endsWith('voxel-v10-start.json')).sha256,
  'ab270a77c6354c5690a1afc76458d8aaff5f4264f9b099f59710447fb1a180f5',
);
const out = 'docs/research/rimworld/evidence',
  screenshots = [];
await mkdir(`${out}/voxel`, { recursive: true });
const chrome = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await chrome.newPage();
  for (const name of ['cotton', 'tailor', 'parka', 'compact']) {
    const source = `test-results/voxel-apparel-browser/worker-${name}.png`,
      b = await readFile(source);
    const encoded = await page.evaluate(async (raw) => {
      const i = new Image();
      i.src = 'data:image/png;base64,' + raw;
      await i.decode();
      const c = document.createElement('canvas');
      c.width = i.width;
      c.height = i.height;
      c.getContext('2d').drawImage(i, 0, 0);
      return c.toDataURL('image/jpeg', 0.83).split(',')[1];
    }, b.toString('base64'));
    const jpeg = Buffer.from(encoded, 'base64'),
      file = `voxel/apparel-${name}.jpg`;
    await writeFile(`${out}/${file}`, jpeg);
    screenshots.push({
      file,
      sha256: sha(jpeg),
      source,
      sourceSha256: sha(b),
      transform: 'Full gameplay viewport, JPEG .83, no crop',
    });
  }
} finally {
  await chrome.close();
}
const record = {
  generatedAt: new Date().toISOString(),
  kind: 'web-runtime-validated',
  scope:
    'Selected textile/apparel slice: normal-calendar cotton, physical cloth, upper-floor tailoring, individual outfits, manual equip/remove, worn durability, temperature-health comparisons, interrupted saves and genuine v10 migration. Does not establish original RNG equivalence, all-biome balance, complete apparel AI, armor or medicine.',
  sources,
  scripts,
  reports,
  assets: [...assets.values()],
  unit: { passed: unit.numPassedTests, total: unit.numTotalTests, failed: unit.numFailedTests },
  campaign,
  temperature,
  browser,
  regressions,
  screenshots,
};
await writeFile(`${out}/voxel-apparel-validation.json`, JSON.stringify(record, null, 2) + '\n');
console.log(
  JSON.stringify({
    status: 'recorded',
    unit: record.unit,
    campaignChecks: campaign.checks.length,
    browserChecks: browser.modes.map((m) => m.checks.length),
    screenshots: screenshots.length,
  }),
);
