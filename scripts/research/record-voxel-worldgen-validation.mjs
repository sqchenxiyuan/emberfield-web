import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const reports = [],
  assets = new Map();
async function report(file) {
  const bytes = await readFile(file);
  reports.push({ file, sha256: sha(bytes) });
  return JSON.parse(bytes);
}
const unit = await report('test-results/worldgen-unit.json');
assert(unit.success);
assert.equal(unit.numFailedTests, 0);
const campaign = await report('test-results/voxel-worldgen-campaign/report.json');
assert.equal(campaign.status, 'passed');
assert.deepEqual(campaign.errors, []);
assert.deepEqual(
  campaign.worlds.map((w) => w.biome),
  ['temperate', 'boreal', 'desert'],
);
for (const w of campaign.worlds)
  for (const f of Object.values(w.fixtures)) assert.equal(sha(await readFile(f.file)), f.sha256);
const browser = await report('test-results/voxel-worldgen-browser/report.json');
async function validateBrowser(r) {
  for (const m of r.modes ?? [r]) {
    assert.deepEqual(m.errors, []);
    if (m.status) assert(['passed', 'passed-fixtures-only'].includes(m.status));
    assert(m.assets.length >= 4);
    for (const a of m.assets) {
      const file = `dist/assets/${new URL(a.url).pathname.split('/').at(-1)}`;
      assert.equal(sha(await readFile(file)), a.sha256, a.url);
      assert(!a.error);
      if (a.matchesLocalBuild !== undefined) assert(a.matchesLocalBuild);
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
for (const name of ['food', 'housing', 'power', 'preservation', 'logistics', 'stonecutting']) {
  const c = await report(`test-results/voxel-${name}-campaign/report.json`);
  assert.equal(c.status, 'passed');
  assert.deepEqual(c.errors, []);
  const b = await report(`test-results/voxel-${name}-browser/report.json`);
  assert(['passed', 'passed-fixtures-only'].includes(b.status));
  await validateBrowser(b);
  regressions[name] = {
    baseline: c.baseline,
    scope: c.scope,
    checks: c.checks,
    checkpoints: c.checkpoints,
    final: c.final,
    browser: b,
  };
}
const layers = await report('test-results/voxel-campaign/report.json');
assert.equal(layers.status, 'passed');
assert.deepEqual(layers.errors, []);
regressions.threeLayer = layers;
const lifecycle = await report('test-results/voxel-lifecycle/report.json');
assert.equal(lifecycle.status, 'passed');
assert.equal(lifecycle.cycles.length, 6);
assert.deepEqual(lifecycle.browserErrors, []);
assert.deepEqual(lifecycle.uiFailures, []);
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
for (const f of [
  'scripts/voxel-worldgen-campaign-verify.mjs',
  'scripts/voxel-worldgen-browser-verify.mjs',
  'scripts/voxel-legacy-start.mjs',
  'tests/voxel-worldgen.test.ts',
  'tests/fixtures/voxel-v7-start.json',
])
  scripts.push({ file: f, sha256: sha(await readFile(f)) });
assert.equal(
  scripts.at(-1).sha256,
  '203b82e8cf07279f2090a9576131dc47182a2c8fdce838542ed05b6480969076',
);
const out = 'docs/research/rimworld/evidence',
  screenshots = [];
await mkdir(`${out}/voxel`, { recursive: true });
const chrome = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await chrome.newPage();
  for (const name of ['temperate-overview', 'boreal-overview', 'desert-overview', 'setup-900']) {
    const source = `test-results/voxel-worldgen-browser/worker-${name}.png`,
      bytes = await readFile(source);
    const encoded = await page.evaluate(async (raw) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + raw;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.83).split(',')[1];
    }, bytes.toString('base64'));
    const jpeg = Buffer.from(encoded, 'base64'),
      file = `voxel/worldgen-${name}.jpg`;
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
    'Generator 2 on 64x64x16: three biomes, four relief settings, finite 3D ores, genuine soils/trees and independent seasonal climate. Unit scenarios, fresh normal-command campaigns, real browser UI, and genuine generator-1 continued-play regressions are separate evidence. No planet/noise equivalence, long-term biome survival balance, population scaling or 4 GiB total-memory claim.',
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
await writeFile(`${out}/voxel-worldgen-validation.json`, JSON.stringify(record, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      status: 'recorded',
      unit: record.unit,
      worlds: campaign.worlds.map((w) => ({
        biome: w.biome,
        checks: w.checks.length,
        tick: w.finalTick,
      })),
      browser: browser.modes.map((m) => ({ mode: m.mode, checks: m.checks.length })),
      regressions: Object.keys(regressions),
      screenshots: screenshots.map((s) => s.file),
    },
    null,
    2,
  ),
);
