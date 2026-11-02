import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const reports = [],
  assets = new Map();
async function read(file) {
  const bytes = await readFile(file);
  reports.push({ file, sha256: sha(bytes) });
  return JSON.parse(bytes);
}
const unit = await read('test-results/plants-unit.json');
assert(unit.success);
assert.equal(unit.numFailedTests, 0);
const campaign = await read('test-results/voxel-plants-campaign/report.json');
assert.equal(campaign.status, 'passed');
assert.deepEqual(campaign.errors, []);
assert(campaign.final.minimumFood > 0);
assert(campaign.final.naturalSeedlings > 0);
for (const f of Object.values(campaign.fixtures))
  assert.equal(sha(await readFile(f.file)), f.sha256);
const browser = await read('test-results/voxel-plants-browser/report.json');
async function validateBrowser(r) {
  for (const m of r.modes ?? [r]) {
    assert.equal(m.status, 'passed');
    assert.deepEqual(m.errors, []);
    assert(m.assets.length >= 4);
    for (const a of m.assets) {
      const file = `dist/assets/${new URL(a.url).pathname.split('/').at(-1)}`;
      assert.equal(sha(await readFile(file)), a.sha256, a.url);
      assert(!a.error);
      assert(a.matchesLocalBuild);
      assets.set(file, { file: file.slice(5), sha256: a.sha256, bytes: a.bytes });
    }
  }
}
await validateBrowser(browser);
assert.deepEqual(
  browser.modes.map((m) => m.mode),
  ['worker', 'main'],
);
const regressions = {};
for (const name of [
  'food',
  'housing',
  'power',
  'preservation',
  'logistics',
  'stonecutting',
  'worldgen',
]) {
  const r = await read(`test-results/voxel-${name}-campaign/report.json`);
  assert.equal(r.status, 'passed');
  assert.deepEqual(r.errors, []);
  regressions[name] = r;
}
const layers = await read('test-results/voxel-campaign/report.json');
assert.equal(layers.status, 'passed');
assert.deepEqual(layers.errors, []);
regressions.layers = layers;
const worldBrowser = await read('test-results/voxel-worldgen-browser/report.json');
await validateBrowser(worldBrowser);
regressions.worldgenBrowser = worldBrowser;
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
const sources = [];
for (const f of (await readdir('src/voxel')).sort())
  sources.push({ file: `src/voxel/${f}`, sha256: sha(await readFile(`src/voxel/${f}`)) });
const scripts = [];
for (const file of [
  'scripts/voxel-plants-campaign-verify.mjs',
  'scripts/voxel-plants-browser-verify.mjs',
  'tests/voxel-plants.test.ts',
  'tests/fixtures/voxel-v8-start.json',
  'tests/fixtures/voxel-v8-start.provenance.json',
])
  scripts.push({ file, sha256: sha(await readFile(file)) });
assert.equal(
  scripts.find((s) => s.file.endsWith('voxel-v8-start.json')).sha256,
  'e44adc4c30a85f9c58d38d78087c079a1694b0c58e14c62c28b2253820be0512',
);
const out = 'docs/research/rimworld/evidence',
  screenshots = [];
await mkdir(`${out}/voxel`, { recursive: true });
const chrome = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await chrome.newPage();
  for (const name of ['sapling', 'mature', 'replanted', 'compact']) {
    const source = `test-results/voxel-plants-browser/worker-${name}.png`,
      bytes = await readFile(source);
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
    const jpeg = Buffer.from(encoded, 'base64'),
      file = `voxel/plants-${name}.jpg`;
    await writeFile(`${out}/${file}`, jpeg);
    screenshots.push({
      file,
      sha256: sha(jpeg),
      source,
      sourceSha256: sha(bytes),
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
    'Three woody plant species with growth, actual yield, manual cutting, maintained groves, conservative natural reseeding, age/shade damage and v9 migration. Separate static/native evidence documents source boundaries. Normal calendar campaign and actual browser controls do not establish original-game equivalence, all-biome survival balance or full ecology.',
  sources,
  scripts,
  reports,
  assets: [...assets.values()],
  unit: { passed: unit.numPassedTests, total: unit.numTotalTests, failed: unit.numFailedTests },
  campaign,
  browser,
  regressions,
  screenshots,
};
await writeFile(`${out}/voxel-plants-validation.json`, JSON.stringify(record, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      status: 'recorded',
      unit: record.unit,
      campaignChecks: campaign.checks.length,
      final: campaign.final,
      browserChecks: browser.modes.map((m) => ({ mode: m.mode, checks: m.checks.length })),
      screenshots: screenshots.length,
    },
    null,
    2,
  ),
);
