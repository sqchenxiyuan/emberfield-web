import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:4196/?world=voxel';
const OUT = process.env.VOXEL_STORAGE_GROUPS_BROWSER_OUT ?? 'test-results/voxel-storage-groups-browser';
const INPUT = process.env.VOXEL_STORAGE_GROUPS_OUT ?? 'test-results/voxel-storage-groups-campaign';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const campaignBytes = await readFile(`${INPUT}/report.json`), campaign = JSON.parse(campaignBytes);
const firstId = campaign.firstShelfId, secondId = campaign.secondShelfId;
assert(Number.isSafeInteger(firstId) && Number.isSafeInteger(secondId));
assert(campaign.checkpoints.some(checkpoint => checkpoint.name === 'final'), 'Completed ordinary-command campaign required');
await mkdir(OUT, { recursive: true });
const report = {
  status: 'running', startedAt: new Date().toISOString(), base: BASE,
  scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${INPUT}/report.json`, sha256: sha(campaignBytes) },
  scope: 'Chrome Worker and main rendering. All changes use visible controls, mouse picking, file chooser imports and downloaded exports. Only snapshot/project/exportSave are read from the bridge. Checks group creation from a blueprint, edits from other members, renaming, real hauling, packed and carried identities, load continuation and independent rules after unlinking. Served asset bytes must equal dist.',
  modes: [],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const mode of ['worker', 'main']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await context.newPage(), reads = [];
    const result = { mode, checks: [], errors: [], assets: [], screenshots: [], imports: [] }; report.modes.push(result);
    page.on('pageerror', error => result.errors.push(error.stack ?? error.message));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    page.on('response', response => {
      if (!/\/assets\/.*\.(js|css)$/.test(new URL(response.url()).pathname)) return;
      const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
      reads.push(response.body().then(async bytes => {
        asset.sha256 = sha(bytes); asset.bytes = bytes.length;
        asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
      }).catch(error => { asset.error = String(error); }));
    });
    const state = () => page.evaluate(() => window.voxel.snapshot());
    const saved = () => page.evaluate(() => window.voxel.exportSave());
    const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
    const button = name => page.getByRole('button', { name, exact: true });
    const check = name => { result.checks.push(name); console.log('PASS', mode, name); };
    const panel = id => page.locator(`[data-testid="shelf-storage"][data-shelf-id="${id}"]`).first();
    const group = (snapshot, id) => snapshot.storageGroups.find(value => value.memberIds.includes(id));
    async function click(name) {
      await button(name).scrollIntoViewIfNeeded(); await button(name).click();
      if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
      if (/^[123]倍速$/.test(name)) await wait(speed => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
    }
    async function settle() { await page.waitForTimeout(180); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); }
    async function shot(name, locator) {
      if (locator) await locator.scrollIntoViewIfNeeded();
      await settle(); const file = `${OUT}/${mode}-${name}.png`;
      await page.screenshot({ path: file }); result.screenshots.push(file);
    }
    async function load(file, evidence) {
      const bytes = await readFile(file), data = JSON.parse(bytes);
      if (evidence) { assert.equal(sha(bytes), evidence.sha256); assert.equal(data.tick, evidence.tick); }
      result.imports.push({ file, sha256: sha(bytes), tick: data.tick, campaignCheckpoint: !!evidence });
      await page.keyboard.press('Escape'); await click('菜单与存档');
      const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
      await button('关闭菜单').waitFor({ state: 'hidden' });
      await wait(tick => window.voxel.snapshot().snapshot.tick === tick && window.voxel.snapshot().snapshot.speed === 0, data.tick);
      await settle(); return data;
    }
    async function fixture(name) {
      const evidence = campaign.checkpoints.find(checkpoint => checkpoint.name === name); assert(evidence, name);
      return load(`${INPUT}/${name}.json`, evidence);
    }
    async function expand(detail) {
      if (!(await detail.evaluate(node => node.open))) await detail.locator(':scope > summary').click();
    }
    async function selectMapMember(id, pos, stage) {
      await page.keyboard.press('Escape');
      const heights = stage === 'built' ? [.75, .3, 0] : [.18, .5, 0];
      for (const height of heights) {
        const projected = await page.evaluate(pos => window.voxel.project(pos), { x: pos.x, y: pos.y, z: pos.z + height });
        const box = await page.locator('canvas[aria-label="多层体素地图"]').boundingBox(); assert(box);
        for (const [dx, dy] of [[0, 0], [0, 8], [8, 0], [-8, 0], [0, -8], [12, 8], [-12, 8]]) {
          await page.mouse.click(box.x + projected.x + dx, box.y + projected.y + dy); await page.waitForTimeout(130);
          if (await panel(id).count() && await panel(id).getAttribute('data-shelf-stage') === stage) {
            await panel(id).scrollIntoViewIfNeeded(); return panel(id);
          }
        }
      }
      throw Error(`Map selection did not expose ${stage} shelf #${id} at ${JSON.stringify(pos)}`);
    }
    async function selectBuilt(id) {
      const shelf = (await state()).snapshot.shelves.find(shelf => shelf.id === id); assert(shelf);
      return selectMapMember(id, shelf, 'built');
    }
    async function priority(id, value) {
      await panel(id).getByLabel('货架优先级', { exact: true }).selectOption(String(value));
      await wait(({ id, value }) => {
        const snapshot = window.voxel.snapshot().snapshot;
        const group = snapshot.storageGroups.find(group => group.memberIds.includes(id));
        return (group?.settings ?? snapshot.shelves.find(shelf => shelf.id === id)?.settings)?.priority === value;
      }, { id, value });
    }
    async function filterWood(id, checked) {
      const filters = panel(id).locator(':scope > details').first(); await expand(filters);
      const control = filters.getByRole('checkbox', { name: '木材', exact: true });
      if (await control.isChecked() !== checked) await control.click();
      await wait(({ id, checked }) => {
        const snapshot = window.voxel.snapshot().snapshot;
        const group = snapshot.storageGroups.find(group => group.memberIds.includes(id));
        return (group?.settings ?? snapshot.shelves.find(shelf => shelf.id === id)?.settings)?.accepts.includes('wood') === checked;
      }, { id, checked });
    }
    async function rename(id, name) {
      await expand(panel(id).getByTestId('shelf-group'));
      await panel(id).getByLabel('储存组名称', { exact: true }).fill(name);
      await panel(id).getByTestId('shelf-group-rename').click();
      await wait(({ id, name }) => window.voxel.snapshot().snapshot.storageGroups.find(group => group.memberIds.includes(id))?.name === name, { id, name });
    }
    async function roundtrip(name) {
      const before = await saved(); await click('菜单与存档');
      const download = page.waitForEvent('download'); await click('导出体素存档');
      const file = `${OUT}/${mode}-${name}-roundtrip.json`; await (await download).saveAs(file); await click('关闭菜单');
      await load(file); const after = await saved();
      for (const key of ['storageGroups', 'shelves', 'items']) assert.deepEqual(after[key], before[key], key);
      const blueprints = save => save.jobs.filter(job => ['shelf', 'smallShelf'].includes(job.kind))
        .map(({ id, kind, storageSettings, x, y, z, axis }) => ({ id, kind, storageSettings, x, y, z, axis }));
      assert.deepEqual(blueprints(after), blueprints(before));
      assert.deepEqual(after.pawns.map(pawn => pawn.cargo), before.pawns.map(pawn => pawn.cargo));
      return after;
    }
    async function runUntil(fn, arg) { await click('3倍速'); await wait(fn, arg); await click('暂停'); }
    try {
      const url = new URL(BASE); url.searchParams.set('world', 'voxel');
      if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
      await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await click('暂停');
      if (await button('收起指引').isVisible()) await click('收起指引');
      assert.equal((await state()).worker, mode === 'worker'); check('requested renderer is active');

      await fixture('linked-blueprint');
      await page.mouse.move(720, 400); await page.mouse.wheel(0, -350); await settle();
      await selectMapMember(secondId, campaign.blueprintSite, 'blueprint');
      assert.equal(await panel(secondId).getByLabel('货架优先级', { exact: true }).inputValue(), '3');
      assert.match(await panel(secondId).getByTestId('shelf-storage-pending').textContent(), /完工/);
      check('map selection exposes the blueprint and its effective shared settings');

      await panel(secondId).getByTestId('shelf-group-unlink').click();
      await wait(() => window.voxel.snapshot().snapshot.storageGroups.length === 0);
      await selectBuilt(firstId);
      const options = panel(firstId).getByTestId('shelf-group-link-options'); await expand(options);
      await options.locator(`[data-testid="shelf-link-candidate"][data-shelf-id="${secondId}"]`).getByRole('checkbox').check();
      await options.getByTestId('shelf-group-link').click();
      await wait(({ a, b }) => window.voxel.snapshot().snapshot.storageGroups.some(group => group.memberIds.includes(a) && group.memberIds.includes(b)), { a: firstId, b: secondId });
      assert.deepEqual(group((await state()).snapshot, secondId).settings, { priority: 3, accepts: ['wood', 'food'] });
      check('visible linking connects the selected blueprint using the built shelf rules');

      await selectMapMember(secondId, campaign.blueprintSite, 'blueprint');
      await priority(secondId, 2); await rename(secondId, '浏览器联动仓库');
      await selectBuilt(firstId);
      assert.equal(await panel(firstId).getByLabel('货架优先级', { exact: true }).inputValue(), '2');
      assert.match(await panel(firstId).getByTestId('shelf-group-scope').textContent(), /浏览器联动仓库.*2/);
      await shot('linked-blueprint', panel(firstId));
      check('editing and renaming from the other member changes the displayed shared rules');
      await roundtrip('blueprint'); check('visible export and import preserve the group and linked blueprint');

      await runUntil(id => window.voxel.snapshot().snapshot.shelves.some(shelf => shelf.id === id), secondId);
      assert.equal(group((await state()).snapshot, secondId).name, '浏览器联动仓库');
      await selectBuilt(secondId);
      assert.equal(await panel(secondId).getByLabel('货架优先级', { exact: true }).inputValue(), '2');
      check('the imported blueprint completes with the same member identity and shared settings');

      await priority(secondId, 3);
      await runUntil(ids => {
        const snapshot = window.voxel.snapshot().snapshot;
        return snapshot.items.some(item => item.resource === 'wood' && snapshot.shelves.filter(shelf => ids.includes(shelf.id)).some(shelf =>
          item.z === shelf.z && ((item.x === shelf.x && item.y === shelf.y) || (shelf.kind === 'shelf'
            && item.x === shelf.x + (shelf.axis === 'x' ? 1 : 0) && item.y === shelf.y + (shelf.axis === 'y' ? 1 : 0)))));
      }, [firstId, secondId]);
      await selectBuilt(secondId); const beforeFilter = (await state()).snapshot.items;
      await filterWood(secondId, false); assert.deepEqual((await state()).snapshot.items, beforeFilter);
      await runUntil(ids => {
        const snapshot = window.voxel.snapshot().snapshot;
        const onShelf = item => snapshot.shelves.filter(shelf => ids.includes(shelf.id)).some(shelf => item.z === shelf.z
          && ((item.x === shelf.x && item.y === shelf.y) || (shelf.kind === 'shelf'
            && item.x === shelf.x + (shelf.axis === 'x' ? 1 : 0) && item.y === shelf.y + (shelf.axis === 'y' ? 1 : 0))));
        return !snapshot.items.some(item => item.resource === 'wood' && onShelf(item))
          && snapshot.items.some(item => item.resource === 'wood' && snapshot.stockpiles.some(stock => stock.x === item.x && stock.y === item.y && stock.z === item.z))
          && !snapshot.pawns.some(pawn => pawn.cargo?.resource === 'wood');
      }, [firstId, secondId]);
      await selectBuilt(firstId); await shot('shared-filter-transfer', panel(firstId));
      check('filtering from the second built member preserves goods and causes real transfer to ground storage');

      await fixture('packed');
      const packed = (await state()).snapshot.items.find(item => item.furniture?.id === secondId); assert(packed, 'The ordinary uninstall checkpoint contains a ground package');
      await selectMapMember(secondId, packed, 'packed');
      assert.match(await panel(secondId).getByTestId('shelf-storage-pending').textContent(), /重新安装/);
      await priority(secondId, 1); await rename(secondId, '打包后仍联动');
      await shot('packed-member', panel(secondId)); await roundtrip('packed');
      await selectBuilt(firstId);
      assert.equal(await panel(firstId).getByLabel('货架优先级', { exact: true }).inputValue(), '1');
      assert.equal(group((await state()).snapshot, firstId).name, '打包后仍联动');
      check('map-selected packed shelf edits its group and survives visible export and import');

      await fixture('carried');
      const carrier = (await state()).snapshot.pawns.find(pawn => pawn.cargo?.furniture?.id === secondId); assert(carrier);
      await page.locator(`[data-colonist-id="${carrier.id}"]`).click();
      await page.locator(`[data-testid="carried-furniture"][data-furniture-id="${secondId}"]`).waitFor();
      assert.equal(await panel(secondId).getByLabel('货架优先级', { exact: true }).inputValue(), '2');
      const carriedGroup = structuredClone(group((await state()).snapshot, secondId));
      await roundtrip('carried');
      assert.equal((await state()).snapshot.pawns.find(pawn => pawn.id === carrier.id).cargo?.furniture?.id, secondId);
      check('visible mid-carry export and import retain the exact package and its linked group');
      await runUntil(({ id, site }) => window.voxel.snapshot().snapshot.shelves.some(shelf => shelf.id === id
        && shelf.x === site.x && shelf.y === site.y && shelf.z === site.z), { id: secondId, site: campaign.installSite });
      assert.deepEqual(group((await state()).snapshot, secondId), carriedGroup);
      await selectBuilt(secondId); await shot('reinstalled-member', panel(secondId));
      check('resuming visible simulation completes the physical carry and reinstalls the linked shelf');

      await panel(secondId).getByTestId('shelf-group-unlink').click();
      await wait(() => window.voxel.snapshot().snapshot.storageGroups.length === 0);
      await priority(secondId, 0); await selectBuilt(firstId);
      assert.equal(await panel(firstId).getByLabel('货架优先级', { exact: true }).inputValue(), '2');
      await roundtrip('unlinked');
      assert.equal((await state()).snapshot.shelves.find(shelf => shelf.id === secondId).settings.priority, 0);
      assert.equal((await state()).snapshot.shelves.find(shelf => shelf.id === firstId).settings.priority, 2);
      check('unlinking retains current rules and later edits remain independent after a visible roundtrip');

      await selectBuilt(firstId); await page.setViewportSize({ width: 980, height: 720 }); await settle();
      await shot('compact-layout', panel(firstId)); assert(await panel(firstId).isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      check('compact layout retains the storage controls without horizontal page overflow');
      await Promise.all(reads);
      assert(result.assets.length > 0 && result.assets.every(asset => asset.status === 200 && asset.matchesLocalBuild));
      assert.deepEqual(result.errors, []); check('no browser errors and served asset bytes match the local build');
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.failure = error.stack ?? String(error);
      await shot('failure').catch(() => {}); throw error;
    } finally {
      await context.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    }
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack ?? String(error); throw error;
} finally {
  report.finishedAt = new Date().toISOString(); await browser.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
