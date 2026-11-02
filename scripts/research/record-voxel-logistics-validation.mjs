import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const unit = await json('test-results/logistics-unit.json');
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
const campaignNames = ['logistics', 'food', 'housing', 'power', 'preservation'];
const campaigns = {};
const reports = [];
for (const name of campaignNames) {
  const file = `test-results/voxel-${name}-campaign/report.json`;
  const report = await json(file);
  assert.equal(report.status, 'passed', name);
  assert.deepEqual(report.errors, [], name);
  campaigns[name] = report;
  reports.push({ file, sha256: sha(await readFile(file)) });
}
const threeLayer = await json('test-results/voxel-campaign/report.json');
assert.equal(threeLayer.status, 'passed');
assert.deepEqual(threeLayer.errors, []);
const browsers = {};
for (const name of campaignNames) {
  const file = `test-results/voxel-${name}-browser/report.json`;
  const report = await json(file);
  assert.equal(report.status, name === 'housing' ? 'passed-fixtures-only' : 'passed', name);
  if (report.modes) assert.deepEqual(report.modes.map((m) => m.mode).sort(), ['main', 'worker']);
  for (const [file, hash] of Object.entries(report.sourceHashes ?? {}))
    assert.equal(
      sha(await readFile(file)),
      hash,
      `${name}: source changed after browser validation: ${file}`,
    );
  browsers[name] = report;
  reports.push({ file, sha256: sha(await readFile(file)) });
}
const assets = new Map();
for (const report of Object.values(browsers)) {
  for (const mode of report.modes ?? [report]) {
    assert.deepEqual(mode.errors, []);
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
}
for (const name of ['logistics', 'preservation']) {
  for (const f of Object.values(campaigns[name].fixtures))
    assert.equal(sha(await readFile(f.file)), f.sha256);
}
const fixture = 'tests/fixtures/voxel-v5-cold-store.json';
assert.equal(
  sha(await readFile(fixture)),
  '0f239085ebd34f8ff6f17da4716cc875e908255f82d527746847f28f543a9f20',
);
const sources = [];
for (const file of (await readdir('src/voxel')).sort())
  sources.push({ file: `src/voxel/${file}`, sha256: sha(await readFile(`src/voxel/${file}`)) });
const scripts = [];
for (const file of [
  'scripts/voxel-logistics-campaign-verify.mjs',
  'scripts/voxel-logistics-browser-verify.mjs',
  'scripts/voxel-campaign-verify.mjs',
  'scripts/voxel-food-campaign-verify.mjs',
  'scripts/voxel-housing-campaign-verify.mjs',
  'scripts/voxel-power-campaign-verify.mjs',
  'scripts/voxel-preservation-campaign-verify.mjs',
  'scripts/voxel-preservation-browser-verify.mjs',
  'tests/voxel-logistics.test.ts',
  fixture,
])
  scripts.push({ file, sha256: sha(await readFile(file)) });
const out = 'docs/research/rimworld/evidence';
await mkdir(`${out}/voxel`, { recursive: true });
const screenshots = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  for (const [source, name] of [
    ['worker-02-capacity-900', 'logistics-capacity'],
    ['worker-04-underground', 'logistics-underground'],
  ]) {
    const file = `test-results/voxel-logistics-browser/${source}.png`,
      bytes = await readFile(file);
    const b64 = await page.evaluate(async (raw) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + raw;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.83).split(',')[1];
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
  await browser.close();
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
    'Finite ground logistics milestone on 64x64x16. Normal Node campaigns use command/step/save/load; real Chrome uses DOM/mouse/file chooser and read-only snapshots. Synthetic unit fixtures are separate. Native RimWorld static evidence and limited live 71-unit hauling observation are chapters 21 and 22. No large-map, population, 4 GiB or complete RimWorld equivalence claim.',
  sources,
  scripts,
  reports,
  assets: [...assets.values()],
  unit: { passed: unit.numPassedTests, total: unit.numTotalTests, failed: unit.numFailedTests },
  campaign: campaigns.logistics,
  browser: browserSummary(browsers.logistics),
  regressions: {
    threeLayer: {
      scope: threeLayer.scope,
      checkpoints: threeLayer.checkpoints,
      final: threeLayer.final,
    },
    ...Object.fromEntries(
      campaignNames
        .filter((n) => n !== 'logistics')
        .map((name) => [
          name,
          {
            scope: campaigns[name].scope,
            final: campaigns[name].final,
            browser: browserSummary(browsers[name]),
            ...(name === 'preservation'
              ? {
                  source: campaigns[name].source,
                  checks: campaigns[name].checks,
                  samples: campaigns[name].samples,
                  fixtures: campaigns[name].fixtures,
                }
              : {}),
          },
        ]),
    ),
  },
  screenshots,
};
await writeFile(`${out}/voxel-logistics-validation.json`, JSON.stringify(record, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      status: 'recorded',
      unit: record.unit,
      browser: record.browser.modes.map((m) => ({ mode: m.mode, checks: m.checks.length })),
      screenshots: screenshots.map((s) => s.file),
    },
    null,
    2,
  ),
);
