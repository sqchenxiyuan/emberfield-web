import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_REGIONS_URL ?? 'http://127.0.0.1:4182/?world=voxel';
const OUT = process.env.VOXEL_REGIONS_BROWSER_OUT ?? 'test-results/voxel-regions-browser';
const FIXTURES = process.env.VOXEL_REGIONS_FIXTURES ?? 'test-results/voxel-regions';
const modes = process.env.VOXEL_REGIONS_BROWSER_MODE ? [process.env.VOXEL_REGIONS_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_REGIONS_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(OUT, { recursive: true });
const campaignBytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(campaignBytes), contract = campaign.browser;
assert.equal(campaign.status, 'passed');
const manifest = await readFile(`${FIXTURES}/source-manifest.json`); assert.equal(sha(manifest), campaign.execution.sourceManifestSha256);
for (const entry of JSON.parse(manifest)) assert.equal(sha(await readFile(entry.file)), entry.sha256, `current campaign source ${entry.file}`);
const report = { version: 35, status: 'running', startedAt: new Date().toISOString(), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${FIXTURES}/report.json`, sha256: sha(campaignBytes), sourceManifestSha256: campaign.execution.sourceManifestSha256 },
  scope: 'Fresh browser worlds created with visible regional map cells and ordinary buttons in Worker/main modes. Keyboard, comparison, seed invalidation, custom controls, real cutting, manual save/reload, file export/import and 900px layout. Only snapshot/project/exportSave read APIs are used; no injected state. Direct campaign data is read only as expected evidence, never imported to create the tested worlds.', modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function verify(mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), url = new URL(BASE); url.searchParams.set('world', 'voxel');
  if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
  const result = { mode, checks: [], screenshots: [], assets: [], errors: [], worlds: [] }, reads = []; report.modes.push(result);
  page.on('pageerror', e => result.errors.push(e.stack ?? e.message));
  page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  page.on('response', response => {
    if (!new URL(response.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
    reads.push(response.body().then(async b => { asset.sha256 = sha(b); asset.bytes = b.length; asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256; }).catch(e => { asset.error = String(e); }));
  });
  const state = () => page.evaluate(() => window.voxel.snapshot()), saved = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = name => page.getByRole('button', { name, exact: true });
  const click = async name => { await button(name).scrollIntoViewIfNeeded(); await button(name).click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot?.speed === 0);
    if (/^[123]倍速$/.test(name)) await wait(n => window.voxel.snapshot().snapshot?.speed === n, Number(name[0])); };
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  const settle = async () => { await page.waitForTimeout(180); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
  const preview = async id => { await page.locator(`[data-testid="world-preview"][data-ready="true"]${id === undefined ? '' : `[data-site-id="${id}"]`}`).waitFor();
    const el = page.getByTestId('world-preview'); return { seed: Number(await el.getAttribute('data-preview-seed')), settings: JSON.parse(await el.getAttribute('data-preview-settings')), summary: JSON.parse(await el.getAttribute('data-preview-summary')) }; };
  const choose = async id => { const cell = page.locator(`[data-testid="region-tile"][data-region-id="${id}"]`); await cell.scrollIntoViewIfNeeded(); await cell.click(); await wait(id => document.querySelector('[data-testid="region-detail"]')?.getAttribute('data-region-id') === String(id), id); };
  const createName = '新开世界（替换当前进度）';
  async function shot(name, locator) { if (locator) await locator.evaluate(e => e.scrollIntoView({ block: 'center' })); await settle(); await page.locator('.voxel-toast').waitFor({ state: 'hidden', timeout: 7000 }); const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file); }
  async function createSite(expected) {
    if (!await page.getByRole('dialog').isVisible()) await click('菜单与存档');
    await click('区域世界地图'); await page.getByRole('textbox', { name: '体素世界种子' }).fill(String(expected.site.worldSeed));
    await choose(expected.site.tileId); const shown = await preview(expected.site.tileId);
    assert.deepEqual(shown, { seed: expected.seed, settings: expected.settings, summary: expected.summary });
    await click(createName); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait(site => { const s = window.voxel.snapshot().snapshot; return s?.worldSite?.worldSeed === site.worldSeed && s.worldSite.tileId === site.tileId && s.tick === 0; }, expected.site);
    await settle(); const actual = await saved(), s = (await state()).snapshot;
    assert.deepEqual(actual.worldSite, expected.site); assert.equal(actual.seed, shown.seed); assert.deepEqual(actual.settings, shown.settings); assert.deepEqual(s.worldSummary, shown.summary);
    const expectedFixture = campaign.worlds.find(w => w.site.tileId === expected.site.tileId).fixtures.initial, raw = await readFile(expectedFixture.file);
    assert.equal(sha(raw), expectedFixture.sha256); const known = JSON.parse(raw);
    for (const field of ['worldSite', 'seed', 'settings', 'spawn', 'blocks', 'trees', 'items', 'jobs', 'stats']) assert.deepEqual(actual[field], known[field], `pure UI creation matches campaign ${field}`);
    assert.equal((await state()).level, s.spawn.z); assert.equal(s.speed, 0);
    await page.getByTestId('current-world-site').waitFor(); const identity = await page.getByTestId('current-world-site').innerText();
    assert(identity.includes(String(expected.site.worldSeed)) && identity.includes(`#${expected.site.tileId}`) && identity.includes(`(${expected.tile.x}, ${expected.tile.y})`));
    result.worlds.push({ site: actual.worldSite, seed: actual.seed, summary: s.worldSummary, terrainSha256: sha(JSON.stringify(actual.blocks)), itemsSha256: sha(JSON.stringify(actual.items)), jobs: actual.jobs.length });
    check('UI-selected region creates the exact previewed local map initial items and jobs', { site: actual.worldSite, localSeed: actual.seed });
  }
  async function roundtrip(name) {
    const before = await saved(); await click('菜单与存档'); const download = page.waitForEvent('download'); await click('导出体素存档');
    const file = `${OUT}/${mode}-${name}.json`; await (await download).saveAs(file);
    const fileBytes = await readFile(file); assert.deepEqual(JSON.parse(fileBytes).worldSite, before.worldSite);
    const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot?.tick === t, before.tick); await settle();
    const after = await saved();
    for (const field of ['worldSite', 'seed', 'settings', 'spawn', 'blocks', 'trees', 'items', 'stats']) assert.deepEqual(after[field], before[field], field);
    const jobs = list => list.map(({ owner, reason, ...job }) => job); assert.deepEqual(jobs(after.jobs), jobs(before.jobs));
    check('file export and file chooser import preserve site map physical items and task targets', { name, file, sha256: sha(fileBytes), tick: before.tick, jobs: after.jobs.length });
  }
  try {
    await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await click('暂停');
    if (await button('收起指引').isVisible()) await click('收起指引');
    assert.equal((await state()).worker, mode === 'worker');
    const untouched = await saved(); await click('菜单与存档'); await preview(contract.recommendedId);
    assert.equal(await page.getByTestId('region-tile').count(), 1152); assert.equal(await page.getByRole('grid', { name: '区域世界地图' }).getAttribute('aria-rowcount'), '24');
    assert((await page.getByRole('dialog').innerText()).includes('本地营地地图暂不生成海水或河流'));
    await shot('regional-world-map', page.getByTestId('region-map'));
    for (const [id, reason] of [[contract.oceanId, '海洋'], [contract.peaksId, '山峰']]) {
      await choose(id); assert(await button(createName).isDisabled()); assert((await page.getByTestId('region-detail').innerText()).includes(reason));
      assert.equal(await page.getByTestId('world-preview').getAttribute('data-ready'), 'false');
    }
    check('world map exposes 1152 cells and refuses oceans and impassable peaks with a reason');
    await choose(contract.recommendedId); await preview(contract.recommendedId);
    const grid = page.getByRole('grid', { name: '区域世界地图' }); await grid.focus();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
    const nextId = Math.min(contract.recommendedId % 48 + 1, 47) + Math.floor(contract.recommendedId / 48) * 48;
    assert.equal(await page.getByTestId('region-detail').getAttribute('data-region-id'), String(nextId));
    assert.equal((await state()).snapshot.speed, 0); assert.equal((await state()).snapshot.tick, untouched.tick);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter'); await preview(contract.recommendedId);
    check('keyboard selection moves and confirms without toggling colony time');
    for (const expected of contract.sites) {
      await choose(expected.site.tileId); const shown = await preview(expected.site.tileId);
      await page.getByTestId('region-add-candidate').click();
      const card = page.locator(`[data-testid="region-candidate"][data-region-id="${expected.site.tileId}"]`);
      assert.deepEqual(JSON.parse(await card.getAttribute('data-preview-summary')), shown.summary);
      assert.equal(Number(await card.getAttribute('data-preview-seed')), shown.seed);
    }
    assert.equal(await page.getByTestId('region-candidate').count(), 3); assert(await page.getByTestId('region-add-candidate').isDisabled());
    await shot('three-biome-comparison', page.getByTestId('region-comparison'));
    const replacementId = Number(await page.locator('[data-testid="region-tile"][data-settleable="true"]').evaluateAll((cells, ids) => cells.find(e => !ids.includes(Number(e.getAttribute('data-region-id')))).getAttribute('data-region-id'), contract.sites.map(s => s.site.tileId)));
    await choose(replacementId); await preview(replacementId); assert(await page.getByTestId('region-add-candidate').isDisabled());
    const firstId = contract.sites[0].site.tileId; await click(`移除候选地区 ${firstId}`);
    assert.equal(await page.getByTestId('region-candidate').count(), 2); assert(await page.getByTestId('region-add-candidate').isEnabled());
    await page.getByTestId('region-add-candidate').click(); assert.equal(await page.getByTestId('region-candidate').count(), 3);
    await click(`选中地区 #${replacementId}`); await preview(replacementId); await click(`选中地区 #${replacementId}`); await preview(replacementId);
    await choose(replacementId); await preview(replacementId); assert(await button(createName).isEnabled());
    await shot('three-site-comparison', page.getByTestId('region-comparison'));
    check('three candidates use real resource counts enforce cap permit replacement and repeated selection stays creatable');
    assert.deepEqual(await saved(), untouched);
    await page.getByRole('textbox', { name: '体素世界种子' }).fill('abc'); assert(await button(createName).isDisabled()); assert.equal(await page.getByTestId('region-candidate').count(), 0);
    await page.getByRole('textbox', { name: '体素世界种子' }).fill(String(contract.changedSeed.worldSeed));
    assert(await button(createName).isDisabled(), 'new seed cannot reuse old site preview');
    const changed = await preview(contract.changedSeed.recommendedId); assert.equal(changed.seed, contract.changedSeed.localSeed);
    assert.equal(await page.getByTestId('region-map').getAttribute('data-world-seed'), String(contract.changedSeed.worldSeed));
    assert.deepEqual(await saved(), untouched);
    check('seed edits clear comparisons and stale preview while leaving current colony and time unchanged');
    for (const expected of contract.sites) await createSite(expected);
    assert.equal(new Set(result.worlds.map(w => w.terrainSha256)).size, 3);
    await shot('selected-region-camp');
    await click('玩法指引'); await click('定位树木'); const target = (await state()).selected; assert(target);
    await click('收起指引'); await click('查看'); await settle();
    const selectedTree = (await state()).snapshot.trees.find(t => t.x === target.x && t.y === target.y && t.z === target.z); assert(selectedTree);
    const wood = (await state()).snapshot.treeConditions.find(t => t.id === selectedTree.id).yield;
    const projected = await page.evaluate(({ p, growth }) => window.voxel.project({ ...p, z: p.z + .15 + .25 * growth }), { p: target, growth: selectedTree.growth });
    const rect = await page.locator('canvas[aria-label="多层体素地图"]').boundingBox(); assert(rect);
    await click('伐木'); await page.mouse.click(rect.x + projected.x, rect.y + projected.y);
    await wait(p => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'cut' && j.x === p.x && j.y === p.y && j.z === p.z), target);
    await roundtrip('queued-regional-work');
    await click('3倍速'); await wait(id => !window.voxel.snapshot().snapshot.trees.some(t => t.id === id), selectedTree.id); await click('暂停');
    assert.equal((await state()).snapshot.stats.produced.wood, wood);
    check('actual UI-designated regional tree job survives save/load and produces physical timber', { target, treeId: selectedTree.id, wood });
    await roundtrip('completed-regional-work');
    const completed = await saved(); await click('菜单与存档'); await click('保存营地'); await page.getByText('手动保存成功', { exact: true }).waitFor();
    await click('自定义地图');
    for (const label of ['生态群落', '地形起伏', '年均温度', '年降雨量', '纬度']) assert.equal(await page.getByLabel(label, { exact: true }).count(), 1);
    await page.getByRole('textbox', { name: '体素世界种子' }).fill('42'); await page.getByLabel('生态群落', { exact: true }).selectOption('temperate'); await page.getByLabel('地形起伏', { exact: true }).selectOption('flat');
    const custom = await preview(); await click(createName); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await wait(() => window.voxel.snapshot().snapshot.seed === 42 && window.voxel.snapshot().snapshot.worldSite === null);
    assert.deepEqual((await saved()).settings, custom.settings);
    await click('菜单与存档'); await click('读取营地'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, completed.tick);
    const restored = await saved(); for (const field of ['worldSite', 'seed', 'settings', 'blocks', 'trees', 'items', 'stats']) assert.deepEqual(restored[field], completed[field]);
    check('custom mode retains original controls and unbound maps while manual reload restores the regional camp');
    await page.setViewportSize({ width: 900, height: 700 }); await click('菜单与存档'); await preview(contract.recommendedId);
    const mapBounds = await grid.boundingBox(); assert(mapBounds.width <= 850 && mapBounds.x >= 0 && mapBounds.x + mapBounds.width <= 900);
    await choose(contract.recommendedId); await preview(contract.recommendedId); await shot('region-map-900', page.getByTestId('region-map'));
    await page.getByTestId('region-add-candidate').scrollIntoViewIfNeeded(); await page.getByTestId('region-add-candidate').click();
    await button(createName).scrollIntoViewIfNeeded(); await button(createName).click({ trial: true }); await shot('preview-comparison-900', page.getByTestId('world-preview'));
    assert(await page.getByRole('dialog').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    await click('自定义地图'); await preview();
    for (const label of ['生态群落', '地形起伏', '年均温度', '年降雨量', '纬度']) { const input = page.getByLabel(label, { exact: true }); await input.scrollIntoViewIfNeeded(); await input.click({ trial: true }); }
    check('regional map preview comparison and custom controls are usable at 900 by 700 without horizontal overflow');
    await Promise.all(reads); assert.equal(result.errors.length, 0, result.errors.join('\n'));
    if (!development) {
      assert(result.assets.some(a => /\/main-[^/]+\.js$/.test(new URL(a.url).pathname)));
      assert(result.assets.some(a => /\/sim\.worker-[^/]+\.js$/.test(new URL(a.url).pathname)));
      if (mode === 'worker') assert(result.assets.some(a => /\/render\.worker-[^/]+\.js$/.test(new URL(a.url).pathname)));
      assert(result.assets.some(a => /\.css$/.test(new URL(a.url).pathname)));
      assert(result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error));
    }
    result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.failure = error.stack ?? String(error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { await browser.close(); report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
