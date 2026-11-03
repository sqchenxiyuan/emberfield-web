import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_LIVING_URL ?? 'http://127.0.0.1:4178/?world=voxel';
const OUT = process.env.VOXEL_LIVING_BROWSER_OUT ?? 'test-results/voxel-living-browser';
const FIXTURES = process.env.VOXEL_LIVING_FIXTURES ?? 'test-results/voxel-living';
const modes = process.env.VOXEL_LIVING_BROWSER_MODE ? [process.env.VOXEL_LIVING_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_LIVING_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = b => createHash('sha256').update(b).digest('hex');
await mkdir(OUT, { recursive: true });
const bytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(bytes), contract = campaign.browser;
assert.equal(campaign.status, 'passed', 'fresh ordinary-play campaign required');
if (campaign.execution.sourceManifestSha256) {
  const manifest = await readFile(`${FIXTURES}/source-manifest.json`); assert.equal(sha(manifest), campaign.execution.sourceManifestSha256);
  for (const entry of JSON.parse(manifest)) assert.equal(sha(await readFile(entry.file)), entry.sha256, `campaign source is current: ${entry.file}`);
}
const report = { status: 'running', startedAt: new Date().toISOString(), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${FIXTURES}/report.json`, sha256: sha(bytes), sourceManifestSha256: campaign.execution.sourceManifestSha256 ?? null },
  scope: 'Worker and main renderer evidence from SHA-verified v31 ordinary-play saves. Mutations use visible controls, actual canvas pointers and file chooser import/export. snapshot/project/exportSave are read-only. Checks furniture meshes, rotated two-cell previews, actual construction and picking, physical food, seated chewing, comfort, memories, room details, removal and 900px layout. No state injection.', modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function verify(mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), url = new URL(BASE); url.searchParams.set('world', 'voxel');
  if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
  const result = { mode, checks: [], fixtures: [], screenshots: [], assets: [], errors: [] }, reads = []; report.modes.push(result);
  page.on('pageerror', e => result.errors.push(e.stack ?? e.message));
  page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  page.on('response', response => {
    if (!new URL(response.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
    reads.push(response.body().then(async b => { asset.sha256 = sha(b); asset.bytes = b.length; asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256; }).catch(e => { asset.error = String(e); }));
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const saved = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = name => page.getByRole('button', { name, exact: true });
  const click = async name => { await button(name).scrollIntoViewIfNeeded(); await button(name).click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot?.speed === 0);
    if (/^[123]倍速$/.test(name)) await wait(n => window.voxel.snapshot().snapshot?.speed === n, Number(name[0])); };
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  const settle = async () => { await page.waitForTimeout(180); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
  const screen = p => page.evaluate(p => window.voxel.project(p), p);
  const pawn = async id => (await state()).snapshot.pawns.find(p => p.id === id);
  async function shot(name, locator) { if (locator) await locator.evaluate(e => e.scrollIntoView({ block: 'center' })); await settle(); const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file); }
  async function level(z) { while ((await state()).level !== z) await click((await state()).level < z ? '上移一层' : '下移一层'); await settle(); }
  async function mapClick(p) { const q = await screen(p); assert(q.x > 330 && q.x < 1400 && q.y > 150 && q.y < 760, `unobscured map target ${JSON.stringify(q)}`); await page.mouse.click(q.x, q.y); await settle(); }
  async function load(file, evidence) {
    const raw = await readFile(file), data = JSON.parse(raw); if (evidence) { assert.equal(sha(raw), evidence.sha256); assert.equal(data.tick, evidence.tick); }
    result.fixtures.push({ file, sha256: sha(raw), tick: data.tick, campaignFixture: !!evidence });
    await page.keyboard.press('Escape'); await click('菜单与存档'); const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, data.tick);
    assert.equal((await state()).snapshot.speed, 0); await settle();
    await page.mouse.move(720, 420); await page.mouse.wheel(0, -600); await wait(() => window.voxel.snapshot().metrics.zoom > 2); await settle(); return data;
  }
  async function fixture(name) { const e = campaign.fixtures[name]; assert(e, name); let file = path.resolve(e.file); try { await access(file); } catch { file = path.resolve(FIXTURES, path.basename(e.file)); } return load(file, e); }
  async function selectPawn(id) { const p = await pawn(id); await page.locator('.voxel-colonists button').filter({ hasText: p.name }).first().click(); await page.getByTestId('living-panel').waitFor(); await settle(); }
  async function runUntil(fn, arg, timeout = 60000) { await click('3倍速'); await wait(fn, arg, timeout); await click('暂停'); }
  async function roundtrip(name) {
    const before = await saved(); await click('菜单与存档'); const download = page.waitForEvent('download'); await click('导出体素存档'); const file = `${OUT}/${mode}-${name}-roundtrip.json`; await (await download).saveAs(file); await click('关闭菜单'); await load(file);
    const after = await saved(); for (const f of ['tables', 'chairs', 'items']) assert.deepEqual(after[f], before[f], f);
    assert.deepEqual(after.pawns.map(p => p.living), before.pawns.map(p => p.living));
    assert.deepEqual(after.pawns.map(p => p.cargo), before.pawns.map(p => p.cargo));
  }
  try {
    await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await click('暂停');
    if (await button('收起指引').isVisible()) await click('收起指引');
    assert.equal((await state()).worker, mode === 'worker'); check('requested renderer is active');
    await fixture('without-table'); await selectPawn(contract.noTablePawnId);
    await page.locator('[data-testid="living-memories"] [data-memory="ateWithoutTable"]').waitFor();
    await shot('without-table-memory', page.getByTestId('living-panel')); check('actual no-table memory and comfort are visible');

    await fixture('furnished'); await level(contract.roomPos.z);
    await mapClick({ ...contract.tablePos, x: contract.tablePos.x + 1, z: contract.tablePos.z + .9 });
    await page.getByTestId('dining-furniture-detail').waitFor();
    assert.equal(await page.getByTestId('dining-furniture-detail').getAttribute('data-furniture-id'), String(contract.tableId));
    await wait(() => window.voxel.snapshot().metrics.living?.tableParts > 0 && window.voxel.snapshot().metrics.living?.chairParts > 0);
    await page.getByTestId('room-living-detail').waitFor(); await shot('furniture-room', page.getByTestId('dining-furniture-detail'));
    await shot('room-experience', page.getByTestId('room-living-detail'));
    check('both table cells pick the actual multi-part furniture and show authoritative room details');

    await click('餐桌'); const target = await screen(contract.previewPos); await page.mouse.move(target.x, target.y); await settle();
    await page.getByTestId('placement-preview-info').waitFor(); assert.match(await page.getByTestId('placement-preview-info').textContent(), /2 格/);
    await page.keyboard.press('r'); await wait(() => window.voxel.snapshot().metrics.living?.previewParts > 0); await settle();
    assert.equal((await state()).axis, 'y'); await shot('rotated-table-preview');
    await page.mouse.click(target.x, target.y); await wait(p => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'table' && j.x === p.x && j.y === p.y && j.z === p.z && j.axis === 'y'), contract.previewPos);
    await runUntil(p => window.voxel.snapshot().snapshot.tables.some(t => t.x === p.x && t.y === p.y && t.z === p.z), contract.previewPos);
    const created = (await state()).snapshot.tables.find(t => t.x === contract.previewPos.x && t.y === contract.previewPos.y && t.z === contract.previewPos.z);
    await page.keyboard.press('Escape'); await click('查看'); await mapClick({ ...created, y: created.y + 1, z: created.z + .9 });
    assert.equal(await page.getByTestId('dining-furniture-detail').getAttribute('data-furniture-id'), String(created.id));
    check('rotated two-cell preview commits a normal construction and far cell selects it');
    const extraSeatPos = { x: created.x + 1, y: created.y, z: created.z };
    await click('餐椅'); const chairPoint = await screen(extraSeatPos); await page.mouse.move(chairPoint.x, chairPoint.y); await settle();
    assert.match(await page.getByTestId('placement-preview-info').textContent(), /1 格/);
    await page.keyboard.press('r'); await page.mouse.click(chairPoint.x, chairPoint.y);
    await runUntil(p => window.voxel.snapshot().snapshot.chairs.some(c => c.x === p.x && c.y === p.y && c.z === p.z), extraSeatPos);
    const extraSeat = (await state()).snapshot.chairs.find(c => c.x === extraSeatPos.x && c.y === extraSeatPos.y && c.z === extraSeatPos.z);
    await click('查看'); await mapClick({ ...extraSeat, z: extraSeat.z + .5 });
    assert.equal(await page.getByTestId('dining-furniture-detail').getAttribute('data-furniture-id'), String(extraSeat.id));
    await click('拆除餐椅'); await runUntil(id => !window.voxel.snapshot().snapshot.chairs.some(c => c.id === id), extraSeat.id);
    check('chair preview rotation construction picking and dismantling are physical');
    await click('查看'); await mapClick({ ...created, y: created.y + 1, z: created.z + .9 });
    await click('拆除餐桌'); await runUntil(id => !window.voxel.snapshot().snapshot.tables.some(t => t.id === id), created.id);
    check('visible dismantle action removes the actual table');

    await fixture('carrying-meal'); await selectPawn(contract.dinerId);
    assert.equal((await pawn(contract.dinerId)).cargo.resource, 'meal');
    assert.equal(await page.getByTestId('dining-status').getAttribute('data-stage'), 'travel');
    await shot('carrying-meal', page.getByTestId('living-panel')); check('actual meal cargo and reserved travel appear in the UI');

    await fixture('seated-meal'); await selectPawn(contract.dinerId);
    const before = await pawn(contract.dinerId), mealCount = (await state()).snapshot.stats.consumed.meal;
    await wait(id => window.voxel.snapshot().metrics.living?.diners.some(d => d.pawnId === id && d.seated), contract.dinerId);
    const rendered = (await state()).metrics.living.diners.find(d => d.pawnId === contract.dinerId);
    assert.equal(rendered.chairId, before.living.mealTask.chairId); assert.equal(rendered.tableId, before.living.mealTask.tableId);
    await shot('seated-meal', page.getByTestId('living-panel')); await roundtrip('seated-meal'); await selectPawn(contract.dinerId);
    check('actual occupied seat table meal and chewing progress survive visible export and import');
    await runUntil(({ id, progress }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).living.mealTask?.progress >= progress + 20,
      { id: contract.dinerId, progress: before.living.mealTask.progress });
    const during = await pawn(contract.dinerId); assert(during.living.comfort > before.living.comfort);
    assert.equal(during.living.mealTask.stage, 'chew');
    await wait(({ id, arm }) => window.voxel.snapshot().metrics.living?.diners.some(d => d.pawnId === id && Math.abs(d.arm - arm) > .01), { id: contract.dinerId, arm: rendered.arm });
    await shot('eating-progress', page.getByTestId('living-panel'));
    check('real time advances eating motion and chair comfort before food disappears');
    await runUntil(({ id, count }) => { const s = window.voxel.snapshot().snapshot; return s.stats.consumed.meal > count && s.pawns.find(p => p.id === id).living.mealTask === null; }, { id: contract.dinerId, count: mealCount });
    await wait(id => !window.voxel.snapshot().metrics.living?.diners.some(d => d.pawnId === id), contract.dinerId);
    check('completed chewing consumes food and ends the dining pose');

    await fixture('sleep-memory'); await selectPawn(contract.sleeperId);
    await page.locator('[data-testid="living-memories"] [data-memory="bedroom"], [data-testid="living-memories"] [data-memory="barracks"]').waitFor();
    await shot('sleep-room-memory', page.getByTestId('living-panel')); check('ordinary sleep produces visible room experience and comfort');
    await page.setViewportSize({ width: 900, height: 700 }); await settle(); await shot('narrow-living', page.getByTestId('living-panel'));
    const bounds = await page.getByTestId('living-panel').boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= 900);
    check('900 pixel layout preserves readable life controls', { bounds });
    await Promise.all(reads);
    if (!development) { assert(result.assets.length > 0 && result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error)); check('served JS and CSS match frozen local build by SHA'); }
    assert.deepEqual(result.errors, []); check('no page or console errors');
  } catch (error) { result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, modes: report.modes.map(m => ({ mode: m.mode, checks: m.checks.length, errors: m.errors, failure: m.failure })) }, null, 2));
