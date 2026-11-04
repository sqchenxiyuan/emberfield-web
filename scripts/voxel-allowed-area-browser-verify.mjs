import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:4200/?world=voxel';
const OUT = process.env.VOXEL_ALLOWED_AREA_BROWSER_OUT ?? 'test-results/voxel-allowed-area-browser';
const modes = process.env.VOXEL_ALLOWED_AREA_BROWSER_MODE ? [process.env.VOXEL_ALLOWED_AREA_BROWSER_MODE] : ['worker', 'main'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const index = p => (p.z * 64 + p.y) * 64 + p.x;
await mkdir(OUT, { recursive: true });
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE, scriptSha256: sha(await readFile(new URL(import.meta.url))),
  scope: 'Ordinary visible UI in fresh worlds: create/name shared areas, assign living colonists, paint/erase ground and airborne/underground floors, inspect unchanged exploration, actual return into area, file export/import, release/delete and 980px controls. Only snapshot/project/exportSave bridge reads; no simulation commands, state injection, DOM mutations or edited saves.', modes: [] };
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
    const panel = () => page.getByTestId('allowed-area-panel');
    const row = id => panel().locator(`[data-testid="allowed-area-row"][data-area-id="${id}"]`);
    const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
    const settle = async () => { await page.waitForTimeout(200); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
    const shot = async (name, element) => {
      if (element) await element.scrollIntoViewIfNeeded(); await settle();
      const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file);
    };
    const pause = async () => { await click('暂停'); await wait(() => window.voxel.snapshot().snapshot.speed === 0); };
    const checkpoint = async name => {
      const data = await saved(), file = `${OUT}/${mode}-${name}.json`, bytes = JSON.stringify(data);
      await writeFile(file, bytes); result.checkpoints.push({ name, file, sha256: sha(bytes), tick: data.tick }); return data;
    };
    // project() normally projects solid cut tops. A sub-pixel lower coordinate
    // projects the selected layer plane; this reads the camera only.
    const screen = async p => {
      const point = await page.evaluate(p => window.voxel.project({ ...p, z: p.z - .000001 }), p), box = await page.locator('.voxel-scene canvas').boundingBox();
      assert(box); return { x: point.x + box.x, y: point.y + box.y };
    };
    const paint = async (from, to = from) => {
      const start = await screen(from), end = await screen(to);
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 6 });
      await page.getByTestId('placement-preview-info').waitFor(); await page.mouse.up(); await settle();
    };
    const layer = async z => {
      while ((await state()).level < z) await click('上移一层');
      while ((await state()).level > z) await click('下移一层');
      await settle();
    };
    const portrait = async id => { await page.locator(`[data-colonist-id="${id}"]`).click(); await page.locator(`.voxel-inspector [data-testid="pawn-allowed-area"][data-pawn-id="${id}"]`).waitFor(); };
    const manage = async id => {
      if (await panel().isVisible()) return;
      if (await page.getByTestId('area-edit-toolbar').isVisible()) await page.getByTestId('area-edit-toolbar').getByRole('button', { name: '管理允许区域', exact: true }).click();
      else { await portrait(id); await page.locator('.voxel-inspector').getByRole('button', { name: '管理允许区域', exact: true }).click(); }
      await panel().waitFor();
    };
    const roundtrip = async () => {
      const before = await saved(); await click('菜单与存档'); const download = page.waitForEvent('download'); await click('导出体素存档');
      const file = `${OUT}/${mode}-assigned-area-download.json`; await (await download).saveAs(file); const bytes = await readFile(file);
      assert.deepEqual(JSON.parse(bytes), before);
      const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
      await page.getByRole('dialog').waitFor({ state: 'hidden' }); await settle();
      const after = await saved();
      for (const key of ['tick', 'animalAreas', 'blocks', 'water', 'explored', 'items']) assert.deepEqual(after[key], before[key], key);
      assert.deepEqual(after.pawns.map(p => [p.id, p.allowedAreaId]), before.pawns.map(p => [p.id, p.allowedAreaId]));
      check('unaltered exported file restores shared area cells, names, assignments and exploration', { file, sha256: sha(bytes), tick: before.tick });
    };
    try {
      const url = new URL(BASE); url.searchParams.set('world', 'voxel'); if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
      await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await pause();
      if (await button('收起指引').isVisible()) await click('收起指引'); assert.equal((await state()).worker, mode === 'worker');
      await click('菜单与存档'); await click('自定义地图');
      await page.getByLabel('体素世界种子', { exact: true }).fill('73129');
      await page.getByLabel('生态群落', { exact: true }).selectOption('temperate');
      await page.getByLabel('地形起伏', { exact: true }).selectOption('flat');
      await page.getByLabel('河流', { exact: true }).selectOption('none');
      await page.locator('[data-testid="world-preview"][data-ready="true"]').waitFor(); await click('新开世界（替换当前进度）');
      await page.getByRole('dialog').waitFor({ state: 'hidden' }); await wait(() => window.voxel.snapshot().snapshot.tick === 0); await settle();
      const initial = await checkpoint('created'), pawn = initial.pawns.find(p => p.faction === 'colony' && !p.dead); assert(pawn);
      assert.equal(initial.version, 44); assert(initial.pawns.every(p => p.allowedAreaId === null));
      result.pawnId = pawn.id; const spawn = initial.spawn;
      await portrait(pawn.id); await manage(pawn.id);
      assert((await panel().innerText()).includes('路径') || (await panel().innerText()).includes('行走路线'));
      await page.getByLabel('新允许区域名称', { exact: true }).fill('临时安全区'); await click('创建允许区域');
      await wait(() => window.voxel.snapshot().snapshot.animalAreas.length === 1); const areaId = (await state()).snapshot.animalAreas[0].id; result.areaId = areaId;
      await panel().getByLabel(`${pawn.name} 允许区域`, { exact: true }).selectOption(String(areaId));
      await wait(({ pawnId, areaId }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === pawnId).allowedAreaId === areaId, { pawnId: pawn.id, areaId });
      assert((await panel().innerText()).includes('空区域，不限制'));
      await page.getByLabel(`允许区域名称 ${areaId}`, { exact: true }).fill('营地安全区'); await page.getByLabel(`允许区域名称 ${areaId}`, { exact: true }).press('Tab');
      await wait(id => window.voxel.snapshot().snapshot.animalAreas.find(a => a.id === id).name === '营地安全区', areaId);
      await shot('created-empty-assigned', row(areaId));
      check('create, rename and assign the same empty shared area through resident controls', { pawnId: pawn.id, areaId });

      const from = { x: spawn.x + 2, y: spawn.y + 1, z: spawn.z }, to = { ...from, x: from.x + 1, y: from.y + 1 };
      const ground = [from, { ...from, x: to.x }, { ...from, y: to.y }, to];
      const air = { ...from, z: spawn.z + 2 }, underground = { x: spawn.x + 4, y: spawn.y + 4, z: spawn.z - 2 };
      await row(areaId).getByRole('button', { name: '增添区域', exact: true }).click(); await panel().waitFor({ state: 'hidden' });
      await paint(from, to); await wait(id => window.voxel.snapshot().snapshot.animalAreas.find(a => a.id === id).cells.length === 4, areaId);
      assert.deepEqual([...(await state()).snapshot.animalAreas.find(a => a.id === areaId).cells].sort((a, b) => a - b), ground.map(index).sort((a, b) => a - b));
      await wait(id => { const p = window.voxel.snapshot().metrics.pens; return p.selectedAreaId === id && p.overlayCells === 4; }, areaId);
      await shot('ground-area-overlay');
      await layer(air.z); await paint(air); await wait(id => window.voxel.snapshot().snapshot.animalAreas.find(a => a.id === id).cells.length === 5, areaId); await shot('airborne-area-overlay');
      await layer(underground.z); await paint(underground); await wait(id => window.voxel.snapshot().snapshot.animalAreas.find(a => a.id === id).cells.length === 6, areaId);
      await wait(id => { const p = window.voxel.snapshot().metrics.pens; return p.selectedAreaId === id && p.overlayCells === 1; }, areaId);
      await click('清除选择'); await shot('underground-area-overlay');
      const painted = await checkpoint('painted-multilayer');
      assert.deepEqual(painted.explored, initial.explored); assert.deepEqual(painted.blocks, initial.blocks); assert.equal(painted.tick, 0);
      assert.deepEqual([...painted.animalAreas[0].cells].sort((a, b) => a - b), [...ground, air, underground].map(index).sort((a, b) => a - b));
      check('current-floor painting covers ground, unsupported air and underground without changing terrain or exploration');
      await layer(air.z); await page.getByTestId('area-edit-toolbar').getByRole('button', { name: '擦除', exact: true }).click(); await paint(air);
      await wait(id => window.voxel.snapshot().snapshot.animalAreas.find(a => a.id === id).cells.length === 5, areaId);
      assert(!(await state()).snapshot.animalAreas[0].cells.includes(index(air)));
      await click('地表'); await page.getByTestId('area-edit-toolbar').getByRole('button', { name: '结束', exact: true }).click();
      check('erasing on another floor removes only that floor membership and preserves the assigned area identity');
      await roundtrip(); await portrait(pawn.id); const assignment = page.locator(`.voxel-inspector [data-testid="pawn-allowed-area"][data-pawn-id="${pawn.id}"]`);
      assert.equal(await assignment.getByLabel(`${pawn.name} 允许区域`, { exact: true }).inputValue(), String(areaId));
      await click('3倍速');
      await wait(({ pawnId, cells }) => { const p = window.voxel.snapshot().snapshot.pawns.find(p => p.id === pawnId); return cells.includes((p.z * 64 + p.y) * 64 + p.x); }, { pawnId: pawn.id, cells: ground.map(index) });
      await pause(); const returned = await checkpoint('returned-to-area'); assert(returned.tick > 0); await shot('resident-returned', assignment);
      const arrived = returned.pawns.find(p => p.id === pawn.id);
      check('a resident assigned outside the painted area physically walks into a reachable cell', { tick: returned.tick, position: { x: arrived.x, y: arrived.y, z: arrived.z } });

      await manage(pawn.id); await page.setViewportSize({ width: 980, height: 720 });
      const narrowRow = row(areaId), eraseButton = narrowRow.getByRole('button', { name: '擦除区域', exact: true });
      await eraseButton.scrollIntoViewIfNeeded();
      assert(await eraseButton.evaluate(element => { const r = element.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return top === element || element.contains(top); }));
      await shot('narrow-area-controls', eraseButton);
      await panel().getByLabel(`${pawn.name} 允许区域`, { exact: true }).selectOption('');
      await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).allowedAreaId === null, pawn.id);
      await shot('narrow-unrestricted', panel().getByLabel(`${pawn.name} 允许区域`, { exact: true }));
      check('980px management controls remain clickable and can release the resident from the area');
      await page.setViewportSize({ width: 1440, height: 960 }); await settle();
      await panel().getByLabel(`${pawn.name} 允许区域`, { exact: true }).selectOption(String(areaId));
      await wait(({ pawnId, areaId }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === pawnId).allowedAreaId === areaId, { pawnId: pawn.id, areaId });
      await row(areaId).getByRole('button', { name: '删除区域', exact: true }).click();
      await wait(id => { const s = window.voxel.snapshot().snapshot; return !s.animalAreas.length && s.pawns.find(p => p.id === id).allowedAreaId === null; }, pawn.id);
      const final = await checkpoint('deleted'); assert.equal(final.animalAreas.length, 0);
      await shot('deleted-area', panel()); check('deleting the shared area resets its resident assignment without leaving a dangling reference');
      await Promise.all(reads);
      for (const asset of result.assets) asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
      assert(result.assets.length && result.assets.every(a => a.status === 200 && a.matchesLocalBuild)); assert.deepEqual(result.errors, []);
      result.status = 'passed';
    } catch (error) { result.status = 'failed'; result.failure = String(error.stack ?? error); await checkpoint('failure-state').catch(() => {}); await shot('failure').catch(() => {}); throw error; }
    finally { await context.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await browser.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
