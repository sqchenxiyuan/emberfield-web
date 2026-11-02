import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reports = [];
async function readReport(file) {
  const bytes = await readFile(file);
  reports.push({ file, sha256: sha(bytes) });
  return JSON.parse(bytes);
}
const unit = await readReport('test-results/stonecutting-unit.json');
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
const names = ['stonecutting', 'logistics', 'food', 'housing', 'power', 'preservation'];
const campaigns = {},
  browsers = {},
  assets = new Map();
for (const name of names) {
  const campaign = await readReport(`test-results/voxel-${name}-campaign/report.json`);
  assert.equal(campaign.status, 'passed', name);
  assert.deepEqual(campaign.errors, [], name);
  for (const f of Object.values(campaign.fixtures ?? {}))
    assert.equal(sha(await readFile(f.file)), f.sha256);
  campaigns[name] = campaign;
  const browser = await readReport(`test-results/voxel-${name}-browser/report.json`);
  assert.equal(browser.status, name === 'housing' ? 'passed-fixtures-only' : 'passed', name);
  if (browser.modes) assert.deepEqual(browser.modes.map((m) => m.mode).sort(), ['main', 'worker']);
  for (const [file, hash] of Object.entries(browser.sourceHashes ?? {}))
    assert.equal(sha(await readFile(file)), hash, `${name}: changed after validation: ${file}`);
  for (const mode of browser.modes ?? [browser]) {
    assert.deepEqual(mode.errors, [], name);
    assert(mode.assets.length >= 5);
    for (const asset of mode.assets) {
      const file = `dist/assets/${new URL(asset.url).pathname.split('/').at(-1)}`;
      assert.equal(sha(await readFile(file)), asset.sha256, asset.url);
      if (asset.matchesLocalBuild !== undefined) assert.equal(asset.matchesLocalBuild, true);
      if (asset.status !== undefined) assert.equal(asset.status, 200);
      assert(!asset.error);
      assets.set(file, { file: file.slice(5), sha256: asset.sha256, bytes: asset.bytes });
    }
  }
  browsers[name] = browser;
}
const threeLayer = await readReport('test-results/voxel-campaign/report.json');
assert.equal(threeLayer.status, 'passed');
assert.deepEqual(threeLayer.errors, []);
const fixture = 'tests/fixtures/voxel-v6-logistics.json';
assert.equal(
  sha(await readFile(fixture)),
  '8063226ef027897139f295a02e8b53963c94f1c48853c2c83e36edf1d628d36d',
);
const sources = [];
for (const file of (await readdir('src/voxel')).sort())
  sources.push({ file: `src/voxel/${file}`, sha256: sha(await readFile(`src/voxel/${file}`)) });
const scripts = [];
for (const file of [
  ...names.flatMap((n) => [
    `scripts/voxel-${n}-campaign-verify.mjs`,
    `scripts/voxel-${n}-browser-verify.mjs`,
  ]),
  'scripts/voxel-campaign-verify.mjs',
  'tests/voxel-crafting.test.ts',
  fixture,
])
  scripts.push({ file, sha256: sha(await readFile(file)) });
const out = 'docs/research/rimworld/evidence';
await mkdir(`${out}/voxel`, { recursive: true });
const screenshots = [],
  chrome = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await chrome.newPage();
  for (const [source, name] of [
    ['worker-02-cutting-paused', 'stonecutting-workbench'],
    ['worker-03-upper-masonry', 'stonecutting-masonry'],
    ['worker-04-workbench-900', 'stonecutting-900'],
  ]) {
    const file = `test-results/voxel-stonecutting-browser/${source}.png`,
      bytes = await readFile(file);
    const b64 = await page.evaluate(async (raw) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + raw;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.83).split(',')[1];
    }, bytes.toString('base64'));
    const jpeg = Buffer.from(b64, 'base64');
    await writeFile(`${out}/voxel/${name}.jpg`, jpeg);
    screenshots.push({
      file: `voxel/${name}.jpg`,
      sha256: sha(jpeg),
      source: file,
      sourceSha256: sha(bytes),
      transform: 'Full reviewed gameplay viewport, JPEG .83, no crop',
    });
  }
} finally {
  await chrome.close();
}
const browserSummary = (r) => ({
  base: r.base,
  scope: r.scope,
  fixtures: r.fixtures,
  modes: (r.modes ?? [r]).map((m) => ({
    mode: m.mode ?? 'worker',
    status: m.status,
    checks: m.checks,
    errors: m.errors,
  })),
});
const record = {
  generatedAt: new Date().toISOString(),
  kind: 'web-runtime-validated',
  scope:
    'Natural rock chunks, physical stonecutting and upper-floor masonry on 64x64x16. Normal Node commands/step/save/load and real Chrome DOM/mouse/file chooser, using read-only projection and snapshots. Synthetic unit fixtures are separate. Native static and bounded runtime evidence are chapters 24 and 25. Research initially unlocked; deterministic voxel drops, whole-world bill counting and fixed work speed are explicit adaptations. No full RimWorld, large-map, population or 4 GiB validation claim.',
  sources,
  scripts,
  reports,
  assets: [...assets.values()],
  unit: { passed: unit.numPassedTests, total: unit.numTotalTests, failed: unit.numFailedTests },
  campaign: campaigns.stonecutting,
  browser: browserSummary(browsers.stonecutting),
  regressions: {
    threeLayer: {
      scope: threeLayer.scope,
      checkpoints: threeLayer.checkpoints,
      final: threeLayer.final,
    },
    ...Object.fromEntries(
      names
        .filter((n) => n !== 'stonecutting')
        .map((n) => [
          n,
          {
            scope: campaigns[n].scope,
            final: campaigns[n].final,
            checks: campaigns[n].checks,
            browser: browserSummary(browsers[n]),
          },
        ]),
    ),
  },
  screenshots,
};
await writeFile(
  `${out}/voxel-stonecutting-validation.json`,
  JSON.stringify(record, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      status: 'recorded',
      unit: record.unit,
      campaign: record.campaign.checks.length,
      browser: record.browser.modes.map((m) => ({ mode: m.mode, checks: m.checks.length })),
      screenshots: screenshots.map((s) => s.file),
    },
    null,
    2,
  ),
);
