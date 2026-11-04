import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Focused follow-up to the full browser campaign: the producer can occupy the
// bench's interaction cell, so both a bill and a pawn delivery card are present.
// Explicitly inspect the pawn card instead of taking the first matching card.
const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:4198/?world=voxel';
const INPUT = process.env.VOXEL_PRODUCTION_OUTPUT_OUT ?? 'test-results/voxel-production-output-campaign';
const FULL = process.env.VOXEL_PRODUCTION_OUTPUT_BROWSER_OUT ?? 'test-results/voxel-production-output-browser';
const OUT = process.env.VOXEL_PRODUCTION_OUTPUT_INSPECTION_OUT ?? 'test-results/voxel-production-output-inspection';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const campaignBytes = await readFile(`${INPUT}/report.json`), campaign = JSON.parse(campaignBytes);
const fullBytes = await readFile(`${FULL}/report.json`), full = JSON.parse(fullBytes);
assert.equal(campaign.status, 'passed'); assert.equal(full.status, 'passed');
assert.equal(full.campaign.sha256, sha(campaignBytes));
assert.equal(full.scriptSha256, sha(await readFile(new URL('./voxel-production-output-browser-verify.mjs', import.meta.url))));
const checkpoint = campaign.checkpoints.find(checkpoint => checkpoint.name === 'specific-carrying'); assert(checkpoint);
const bytes = await readFile(checkpoint.path), data = JSON.parse(bytes);
assert.equal(sha(bytes), checkpoint.sha256);
const producer = data.pawns.find(pawn => pawn.id === campaign.creatorId); assert(producer?.productionDelivery && producer.cargo?.weapon);
await mkdir(OUT, { recursive: true });
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE,
  scriptSha256: sha(await readFile(new URL(import.meta.url))),
  fullBrowser: { file: `${FULL}/report.json`, sha256: sha(fullBytes), scriptSha256: full.scriptSha256 },
  campaign: { file: `${INPUT}/report.json`, sha256: sha(campaignBytes) }, checkpoint,
  scope: 'Focused UI-only follow-up. Import unchanged specific-carrying checkpoint through file chooser, click producer portrait and bill inspection button, then explicitly inspect the pawn delivery card. Only snapshot/exportSave bridge reads. No simulation commands or state injection.', modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const mode of ['worker', 'main']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const page = await context.newPage(), assetReads = [];
    const result = { mode, status: 'running', errors: [], assets: [], screenshots: [] }; report.modes.push(result);
    page.on('pageerror', error => result.errors.push(String(error.stack ?? error)));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    page.on('response', response => {
      if (!/\/assets\/.*\.(js|css)$/.test(new URL(response.url()).pathname)) return;
      const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
      assetReads.push(response.body().then(bytes => { asset.sha256 = sha(bytes); }).catch(error => { asset.error = String(error); }));
    });
    const button = name => page.getByRole('button', { name, exact: true });
    const saved = () => page.evaluate(() => window.voxel.exportSave());
    const screenshot = async name => {
      const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file);
    };
    try {
      const url = new URL(BASE); url.searchParams.set('world', 'voxel');
      if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
      await page.goto(url.href);
      await page.waitForFunction(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot);
      await button('暂停').click();
      if (await button('收起指引').isVisible()) await button('收起指引').click();
      await button('菜单与存档').click();
      const chooser = page.waitForEvent('filechooser'); await button('导入体素存档').click(); await (await chooser).setFiles(checkpoint.path);
      await button('关闭菜单').waitFor({ state: 'hidden' });
      await page.waitForFunction(tick => window.voxel.snapshot().snapshot.tick === tick && window.voxel.snapshot().snapshot.speed === 0, checkpoint.tick);
      assert.equal(await page.evaluate(() => window.voxel.snapshot().worker), mode === 'worker');
      await page.locator(`[data-colonist-id="${producer.id}"]`).click();
      const billDelivery = page.locator(`[data-testid="bill-row"][data-bill-id="${campaign.billId}"] [data-testid="production-delivery"]`);
      await billDelivery.getByRole('button', { name: '查看制作者', exact: true }).click();
      const card = page.locator(`.voxel-pawn-detail [data-testid="production-delivery"][data-pawn-id="${producer.id}"]`);
      await card.waitFor({ state: 'visible' }); await card.scrollIntoViewIfNeeded();
      const text = await card.innerText(); assert(text.includes('正在运送成品') && text.includes('已完成加工'));
      assert((await card.getByTestId('production-delivery-target').innerText()).includes(campaign.targets[0].name));
      assert.equal(await card.getByRole('progressbar').count(), 0);
      const targetButton = card.getByRole('button', { name: '查看配送位置', exact: true });
      await targetButton.scrollIntoViewIfNeeded();
      assert(await targetButton.evaluate(element => {
        const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        const top = document.elementFromPoint(x, y); return top === element || element.contains(top);
      }));
      await page.waitForTimeout(180); await screenshot('pawn-delivery');
      const current = await saved(), actual = current.pawns.find(pawn => pawn.id === producer.id);
      assert.deepEqual(actual.cargo, producer.cargo); assert.deepEqual(actual.productionDelivery, producer.productionDelivery);
      assert.deepEqual(current.productionQueues, data.productionQueues); assert.equal(current.tick, data.tick);
      await Promise.all(assetReads);
      for (const asset of result.assets) asset.matchesLocalBuild =
        sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
      assert(result.assets.length && result.assets.every(asset => asset.status === 200 && asset.matchesLocalBuild));
      assert.deepEqual(result.errors, []); result.status = 'passed'; result.text = text;
      console.log('PASS', mode, 'actual pawn delivery card, unchanged carried product and source build');
    } catch (error) {
      result.status = 'failed'; result.failure = String(error.stack ?? error); await screenshot('failure').catch(() => {}); throw error;
    } finally { await context.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
  }
  assert.equal(sha(await readFile(`${FULL}/report.json`)), report.fullBrowser.sha256);
  assert.equal(sha(await readFile(new URL(import.meta.url))), report.scriptSha256);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await browser.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
