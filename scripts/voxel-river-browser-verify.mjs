import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:4199/?world=voxel';
const OUT = process.env.VOXEL_RIVER_BROWSER_OUT ?? 'test-results/voxel-river-browser';
const modes = process.env.VOXEL_RIVER_BROWSER_MODE ? [process.env.VOXEL_RIVER_BROWSER_MODE] : ['worker', 'main'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = values => { const result = []; for (let i = 0; i < values.length; i += 2) for (let k = 0; k < values[i + 1]; k++) result.push(values[i]); return result; };
const index = p => (p.z * 64 + p.y) * 64 + p.x;
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
await mkdir(OUT, { recursive: true });
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE, scriptSha256: sha(await readFile(new URL(import.meta.url))),
  scope: 'Fresh worlds created by ordinary visible UI. Regional river selection and comparison, custom river preview, shallow/deep inspection, rejected deep-water bridge, dragged real bridge construction, save/file reload and demolition. Only snapshot/project/exportSave/waterAt/bridgeAt read APIs; no state injection or direct simulation commands.', modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const mode of modes) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const page = await context.newPage(), reads = [];
    const result = { mode, status: 'running', checks: [], screenshots: [], checkpoints: [], assets: [], errors: [] }; report.modes.push(result);
    page.on('pageerror', e => result.errors.push(e.stack ?? e.message));
    page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
    page.on('response', response => {
      if (!/\/assets\/.*\.(js|css)$/.test(new URL(response.url()).pathname)) return;
      const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
      reads.push(response.body().then(bytes => { asset.sha256 = sha(bytes); }).catch(e => { asset.error = String(e); }));
    });
    const state = () => page.evaluate(() => window.voxel.snapshot());
    const saved = () => page.evaluate(() => window.voxel.exportSave());
    const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
    const button = name => page.getByRole('button', { name, exact: true });
    const click = async name => { await button(name).scrollIntoViewIfNeeded(); await button(name).click(); };
    const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
    const settle = async () => { await page.waitForTimeout(180); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
    const preview = async () => {
      const element = page.locator('[data-testid="world-preview"][data-ready="true"]'); await element.waitFor();
      return { generator: Number(await element.getAttribute('data-generator')), seed: Number(await element.getAttribute('data-preview-seed')),
        settings: JSON.parse(await element.getAttribute('data-preview-settings')), summary: JSON.parse(await element.getAttribute('data-preview-summary')) };
    };
    const shot = async (name, element) => {
      if (element) await element.scrollIntoViewIfNeeded(); await settle();
      const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file);
    };
    const screen = async p => {
      const point = await page.evaluate(p => window.voxel.project(p), p), box = await page.locator('.voxel-scene canvas').boundingBox();
      assert(box); return { x: point.x + box.x, y: point.y + box.y };
    };
    const mapClick = async p => { const point = await screen(p); await page.mouse.click(point.x, point.y); };
    const pause = async () => { await click('暂停'); await wait(() => window.voxel.snapshot().snapshot.speed === 0); };
    const checkpoint = async name => {
      const data = await saved(), file = `${OUT}/${mode}-${name}.json`, bytes = JSON.stringify(data);
      await writeFile(file, bytes); result.checkpoints.push({ name, file, sha256: sha(bytes), tick: data.tick }); return data;
    };
    const roundtrip = async name => {
      const before = await saved(); await click('菜单与存档');
      const download = page.waitForEvent('download'); await click('导出体素存档');
      const file = `${OUT}/${mode}-${name}-download.json`; await (await download).saveAs(file);
      const bytes = await readFile(file); assert.deepEqual(JSON.parse(bytes), before);
      const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
      await page.getByRole('dialog').waitFor({ state: 'hidden' }); await settle();
      const after = await saved();
      for (const key of ['tick', 'water', 'bridges', 'blocks', 'items', 'settings', 'worldSite']) assert.deepEqual(after[key], before[key], key);
      check('unchanged browser export/import preserves water, bridge deck and physical items', { name, file, sha256: sha(bytes), tick: before.tick });
    };
    const createCustom = async river => {
      if (!await page.getByRole('dialog').isVisible()) await click('菜单与存档');
      await click('自定义地图');
      await page.getByLabel('体素世界种子', { exact: true }).fill('73129');
      await page.getByLabel('生态群落', { exact: true }).selectOption('temperate');
      await page.getByLabel('地形起伏', { exact: true }).selectOption('flat');
      await page.getByLabel('河流', { exact: true }).selectOption(river);
      const shown = await preview(); assert.equal(shown.generator, 4); assert.equal(shown.settings.river, river);
      await shot(`${river}-preview`, page.getByTestId('world-preview'));
      await click('新开世界（替换当前进度）'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await wait(river => { const s = window.voxel.snapshot().snapshot; return s.generator === 4 && s.settings.river === river && s.tick === 0; }, river);
      await settle(); const current = (await state()).snapshot; assert.deepEqual(current.worldSummary, shown.summary);
      const canvas = page.locator('.voxel-scene canvas'); await canvas.hover(); await page.mouse.wheel(0, 300); await settle();
      return current;
    };
    try {
      const url = new URL(BASE); url.searchParams.set('world', 'voxel'); if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
      await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await pause();
      if (await button('收起指引').isVisible()) await click('收起指引');
      assert.equal((await state()).worker, mode === 'worker'); const untouched = await saved();
      await click('菜单与存档'); await preview();
      const rivers = page.locator('[data-testid="region-tile"][data-settleable="true"][data-river="river"]'); assert(await rivers.count() > 0);
      const riverId = Number(await rivers.first().getAttribute('data-region-id')); await rivers.first().click(); const regional = await preview();
      assert(regional.summary.water.shallow > 0 && regional.summary.water.deep > 0);
      assert((await page.getByTestId('region-detail').innerText()).includes('河流'));
      assert(await page.locator('[data-testid="regional-rivers"] path').count() > 0);
      await page.getByTestId('region-add-candidate').click();
      assert((await page.getByTestId('region-candidate').innerText()).includes('可架木桥'));
      assert.deepEqual(await saved(), untouched);
      await shot('regional-river-comparison', page.getByTestId('region-comparison'));
      check('regional drainage, water preview and candidate comparison leave current colony unchanged', { riverId, water: regional.summary.water });

      const broad = await createCustom('river');
      const broadSave = await checkpoint('broad-river-created'), broadWater = decode(broadSave.water);
      const surfaceCells = depth => broadWater.flatMap((value, i) => value === depth && !broadWater[i + 4096]
        ? [{ x: i % 64, y: Math.floor(i / 64) % 64, z: Math.floor(i / 4096) + 1 }] : [])
        .sort((a, b) => Math.hypot(a.x - broad.spawn.x, a.y - broad.spawn.y) - Math.hypot(b.x - broad.spawn.x, b.y - broad.spawn.y));
      const shallow = surfaceCells(1)[0], deep = surfaceCells(2)[0]; assert(shallow && deep);
      await click('查看'); await mapClick(deep); await wait(() => document.querySelector('[data-testid="water-detail"]')?.getAttribute('data-water-depth') === '2');
      assert((await page.getByTestId('water-detail').innerText()).includes('无法通行')); await shot('deep-water-inspection');
      const jobsBefore = (await state()).snapshot.jobs.length; await click('木桥'); await mapClick(deep); await settle();
      assert.equal((await state()).snapshot.jobs.length, jobsBefore); assert(!(await state()).snapshot.jobs.some(j => j.kind === 'bridge'));
      check('deep water is visually distinct, inspectable and rejects wooden bridge construction', { deep, shallow });

      const creek = await createCustom('creek'), initial = await checkpoint('creek-created'), water = decode(initial.water);
      const shallowCells = water.flatMap((value, i) => value === 1 ? [{ x: i % 64, y: Math.floor(i / 64) % 64, z: Math.floor(i / 4096) + 1 }] : [])
        .sort((a, b) => Math.hypot(a.x - creek.spawn.x, a.y - creek.spawn.y) - Math.hypot(b.x - creek.spawn.x, b.y - creek.spawn.y));
      const first = shallowCells.find(p => water[index({ ...p, x: p.x + 1, z: p.z - 1 })] === 1 && p.x < 62); assert(first);
      const second = { ...first, x: first.x + 1 }, targets = [first, second]; result.targets = targets;
      await click('查看'); await mapClick(first); await wait(() => document.querySelector('[data-testid="water-detail"]')?.getAttribute('data-water-depth') === '1');
      assert((await page.getByTestId('water-detail').innerText()).includes('涉水移动较慢')); await shot('shallow-water-inspection');
      await click('规划木桥'); const start = await screen(first), end = await screen(second);
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 });
      await page.getByTestId('placement-preview-info').waitFor(); await shot('bridge-drag-preview'); await page.mouse.up();
      await wait(() => window.voxel.snapshot().snapshot.jobs.filter(j => j.kind === 'bridge').length === 2);
      assert((await state()).snapshot.jobs.filter(j => j.kind === 'bridge').every(j => targets.some(p => same(j, p))));
      await checkpoint('bridges-designated'); await roundtrip('bridges-designated');
      check('dragging on the water surface designates two genuine bridge jobs at walking height', { targets });
      await click('3倍速');
      await wait(targets => targets.every(p => window.voxel.bridgeAt({ ...p, z: p.z - 1 })), targets, 120000);
      await pause(); await checkpoint('bridges-built'); await click('查看'); await mapClick(first);
      await wait(() => document.querySelector('[data-testid="water-detail"]')?.getAttribute('data-bridge') === 'true');
      assert((await page.getByTestId('water-detail').innerText()).includes('轻型承载')); await shot('bridge-deck-built');
      const built = await saved(); assert(built.tick > 0); assert(decode(built.bridges).filter(Boolean).length === 2);
      assert.deepEqual(built.water, initial.water); assert(!(await state()).snapshot.jobs.some(j => j.kind === 'bridge'));
      check('colonists deliver materials and complete visible plank bridges while original water remains below', { tick: built.tick });
      await roundtrip('bridges-built');
      await click('查看'); await mapClick(first);
      await wait(() => document.querySelector('[data-testid="water-detail"]')?.getAttribute('data-bridge') === 'true');
      await page.setViewportSize({ width: 980, height: 720 }); await shot('bridge-narrow-layout');
      assert(await page.getByTestId('water-detail').isVisible()); await page.setViewportSize({ width: 1440, height: 960 }); await settle();
      await click('查看'); await mapClick(first); await click('拆除这格木桥');
      await wait(() => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'remove'));
      await click('3倍速'); await wait(p => !window.voxel.bridgeAt({ ...p, z: p.z - 1 }), first, 120000); await pause();
      await click('查看'); await mapClick(first); await wait(() => document.querySelector('[data-testid="water-detail"]')?.getAttribute('data-bridge') === 'false');
      await shot('bridge-removed-water-restored'); const final = await checkpoint('bridge-removed'); assert.deepEqual(final.water, initial.water);
      assert.equal(decode(final.bridges).filter(Boolean).length, 1);
      check('ordinary demolition restores original shallow water and leaves the neighboring bridge intact');
      await Promise.all(reads);
      for (const asset of result.assets) asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
      assert(result.assets.length && result.assets.every(a => a.status === 200 && a.matchesLocalBuild)); assert.deepEqual(result.errors, []);
      result.status = 'passed';
    } catch (error) { result.status = 'failed'; result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
    finally { await context.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await browser.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
