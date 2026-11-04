import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_FURNITURE_URL ?? 'http://127.0.0.1:4182/?world=voxel';
const OUT = process.env.VOXEL_FURNITURE_BROWSER_OUT ?? 'test-results/voxel-furniture-browser';
const FIXTURES = process.env.VOXEL_FURNITURE_FIXTURES ?? 'test-results/voxel-furniture';
const modes = process.env.VOXEL_FURNITURE_BROWSER_MODE ? [process.env.VOXEL_FURNITURE_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_FURNITURE_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = b => createHash('sha256').update(b).digest('hex');
await mkdir(OUT, { recursive: true });
const bytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(bytes), contract = campaign.browser;
assert.equal(campaign.status, 'passed', 'fresh ordinary-play campaign required');
const manifest = await readFile(`${FIXTURES}/source-manifest.json`); assert.equal(sha(manifest), campaign.execution.sourceManifestSha256);
for (const entry of JSON.parse(manifest)) assert.equal(sha(await readFile(entry.file)), entry.sha256, `campaign source is current: ${entry.file}`);
const report = { status: 'running', startedAt: new Date().toISOString(), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${FIXTURES}/report.json`, sha256: sha(bytes), sourceManifestSha256: campaign.execution.sourceManifestSha256 },
  scope: 'Worker and main renderer evidence from SHA-verified v33 ordinary-play saves. Mutations use visible controls and file chooser import/export only. snapshot/project/exportSave are read-only. Checks actual furniture quality and attributes, real sleep and visible reassignment to another actual bed, bed owner/medical/prisoner controls, actual dining and social chairs, gathering continuity, exact persistence and 900px layout. Naturally created qualities may coincide. No state injection.', modes: [] };
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
  const state = () => page.evaluate(() => window.voxel.snapshot()), saved = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = name => page.getByRole('button', { name, exact: true });
  const click = async name => { await button(name).scrollIntoViewIfNeeded(); await button(name).click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot?.speed === 0);
    if (/^[123]倍速$/.test(name)) await wait(n => window.voxel.snapshot().snapshot?.speed === n, Number(name[0])); };
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  const settle = async () => { await page.waitForTimeout(180); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
  const pawn = async id => (await state()).snapshot.pawns.find(p => p.id === id);
  async function shot(name, locator) { if (locator) await locator.evaluate(e => e.scrollIntoView({ block: 'center' })); await settle(); const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file); }
  async function load(file, evidence) {
    const raw = await readFile(file), data = JSON.parse(raw); if (evidence) { assert.equal(sha(raw), evidence.sha256); assert.equal(data.tick, evidence.tick); }
    result.fixtures.push({ file, sha256: sha(raw), tick: data.tick, campaignFixture: !!evidence });
    await page.keyboard.press('Escape'); await click('菜单与存档'); const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, data.tick);
    assert.equal((await state()).snapshot.speed, 0); await settle();
    await page.mouse.move(720, 420); await page.mouse.wheel(0, -600); await wait(() => window.voxel.snapshot().metrics.zoom > 2); await settle(); return data;
  }
  async function fixture(name) { const e = campaign.fixtures[name]; assert(e, name); let file = path.resolve(e.file); try { await access(file); } catch { file = path.resolve(FIXTURES, path.basename(e.file)); } return load(file, e); }
  async function selectPawn(id) { const p = await pawn(id); await page.locator('.voxel-colonists button').filter({ hasText: p.name }).first().click(); await wait(id => { const panels = document.querySelectorAll('[data-testid="living-panel"]'); return panels.length === 1 && panels[0].getAttribute('data-pawn-id') === String(id); }, id); await settle(); }
  async function furnitureDetails(id) { await wait(id => document.querySelector('[data-testid="furniture-quality"]')?.getAttribute('data-furniture-id') === String(id), id); }
  async function currentFurniture(id, itemId) { await wait(({ id, itemId }) => { const e = document.querySelector('[data-testid="current-furniture"]'); return e?.getAttribute('data-pawn-id') === String(id) && e.getAttribute('data-furniture-id') === String(itemId); }, { id, itemId }); }
  async function selectBed(id) {
    await click('囚犯与招募'); const list = page.getByTestId('prison-panel').locator('details').filter({ has: page.locator('summary').filter({ hasText: '床位设置' }) });
    await list.locator('summary').click(); await list.getByRole('button', { name: `木床 #${id}`, exact: true }).click(); await click('关闭囚犯面板'); await furnitureDetails(id);
  }
  async function runUntil(fn, arg, timeout = 60000) { await click('3倍速'); await wait(fn, arg, timeout); await click('暂停'); }
  async function assertStats(id) {
    await furnitureDetails(id); const expected = contract.qualities.find(q => q.id === id), panel = page.getByTestId('furniture-quality');
    assert(expected); assert.equal(await panel.getAttribute('data-quality'), String(expected.quality)); assert.equal(await panel.getAttribute('data-kind'), expected.kind);
    assert.equal(await page.getByTestId('furniture-quality-name').textContent(), expected.stats.qualityName);
    assert.equal(Number(await page.getByTestId('furniture-hit-points').getAttribute('data-max')), expected.stats.maxHitPoints);
    assert.equal(Number(await page.getByTestId('furniture-hit-points').getAttribute('data-current')), expected.stats.maxHitPoints);
    assert.equal(Number(await page.getByTestId('furniture-beauty').getAttribute('data-value')), expected.stats.beauty);
    assert.equal(Number(await page.getByTestId('furniture-value').getAttribute('data-value')), expected.value);
    for (const [field, testId] of [['comfort', 'furniture-comfort'], ['restEffectiveness', 'furniture-rest']]) {
      if (expected.stats[field] === null) assert.equal(await page.getByTestId(testId).count(), 0);
      else assert.equal(Number(await page.getByTestId(testId).getAttribute('data-value')), expected.stats[field]);
    }
    assert(!/品质.*耐久.*提高|舒适上限/.test(await panel.textContent()));
    return expected;
  }
  async function roundtrip(name) {
    const before = await saved(); await click('菜单与存档'); const download = page.waitForEvent('download'); await click('导出体素存档'); const file = `${OUT}/${mode}-${name}-roundtrip.json`; await (await download).saveAs(file); await click('关闭菜单'); await load(file);
    const after = await saved(); for (const f of ['beds', 'tables', 'chairs', 'fireDamage', 'items']) assert.deepEqual(after[f], before[f], f);
    for (const f of ['living', 'psyche', 'cargo', 'skills']) assert.deepEqual(after.pawns.map(p => p[f]), before.pawns.map(p => p[f]), f);
  }
  async function gathering(enabled) {
    const control = page.getByRole('checkbox', { name: '允许聚会', exact: true }); if (await control.isChecked() !== enabled) await control.click();
    await wait(({ id, enabled }) => window.voxel.snapshot().snapshot.tables.find(t => t.id === id).gathering === enabled, { id: contract.tableId, enabled });
    await wait(enabled => document.querySelector('input[aria-label="允许聚会"]')?.checked === enabled, enabled);
  }
  try {
    await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await click('暂停');
    if (await button('收起指引').isVisible()) await click('收起指引');
    assert.equal((await state()).worker, mode === 'worker'); check('requested renderer is active');
    await fixture('sleep-a'); await selectPawn(contract.sleeperId); await currentFurniture(contract.sleeperId, contract.bedAId);
    await shot('actual-bed-a-user', page.getByTestId('current-furniture')); await click('查看当前床品质'); const bedA = await assertStats(contract.bedAId);
    await page.getByTestId('furniture-quality').locator('summary').click(); await shot('bed-a-quality', page.getByTestId('furniture-quality'));
    check('actual sleeper links to the specific bed and its authoritative quality attributes', { bedA });
    const start = (await state()).snapshot.tick, rest = (await pawn(contract.sleeperId)).rest;
    await runUntil(t => window.voxel.snapshot().snapshot.tick >= t + 30, start);
    const after = await pawn(contract.sleeperId), elapsed = (await state()).snapshot.tick - start;
    assert.equal(after.sleepBedId, contract.bedAId); assert.equal(after.phase, 'rest');
    assert(Math.abs(after.rest - rest - 228.57144 / 12000 * bedA.stats.restEffectiveness * elapsed) < 1e-7);
    check('browser ticks apply the current bed rest multiplier to actual sleep', { elapsed, before: rest, after: after.rest, multiplier: bedA.stats.restEffectiveness });
    await roundtrip('bed-a'); await selectPawn(contract.sleeperId); await currentFurniture(contract.sleeperId, contract.bedAId);
    check('visible export and import preserve individual quality and actual bed use exactly');
    await selectBed(contract.bedBId); const bedB = await assertStats(contract.bedBId);
    await page.getByRole('combobox', { name: '床位主人', exact: true }).selectOption(String(contract.sleeperId));
    await wait(({ id, owner }) => window.voxel.snapshot().snapshot.beds.find(b => b.id === id).owner === owner, { id: contract.bedBId, owner: contract.sleeperId });
    await selectPawn(contract.sleeperId); await click('现在去睡觉');
    await runUntil(({ id, bedId }) => { const p = window.voxel.snapshot().snapshot.pawns.find(p => p.id === id), b = window.voxel.snapshot().snapshot.beds.find(b => b.id === bedId); return p.phase === 'rest' && p.sleepBedId === bedId && p.x === b.x && p.y === b.y && p.z === b.z; }, { id: contract.sleeperId, bedId: contract.bedBId });
    await currentFurniture(contract.sleeperId, contract.bedBId); await shot('reassigned-bed-b-user', page.getByTestId('current-furniture'));
    await click('查看当前床品质'); await assertStats(contract.bedBId); check('visible owner reassignment makes the same person actually travel to and sleep in another bed', { bedB });
    await page.getByRole('combobox', { name: '床位用途', exact: true }).selectOption('medical');
    await wait(id => window.voxel.snapshot().snapshot.beds.find(b => b.id === id).medical, contract.bedBId);
    assert(await page.getByRole('combobox', { name: '床位主人', exact: true }).isDisabled()); await assertStats(contract.bedBId);
    await page.getByRole('combobox', { name: '床位用途', exact: true }).selectOption('sleep');
    await wait(id => !window.voxel.snapshot().snapshot.beds.find(b => b.id === id).medical, contract.bedBId);
    const prison = page.getByRole('checkbox', { name: '囚犯床', exact: true }); await prison.click();
    await wait(() => window.voxel.snapshot().snapshot.beds.every(b => b.prisoner)); await wait(() => document.querySelector('input[aria-label="囚犯床"]')?.checked);
    assert(await page.getByRole('combobox', { name: '床位主人', exact: true }).isDisabled()); await assertStats(contract.bedBId); await shot('bed-purpose-controls', page.getByTestId('bed-detail'));
    await prison.click(); await wait(() => window.voxel.snapshot().snapshot.beds.every(b => !b.prisoner)); await wait(() => !document.querySelector('input[aria-label="囚犯床"]')?.checked);
    check('bed medical and room-wide prisoner settings retain every built quality');
    for (const b of (await state()).snapshot.beds) assert.equal(b.quality, contract.qualities.find(q => q.id === b.id).quality);

    await fixture('seated-social'); await selectPawn(contract.socialPawnId); await currentFurniture(contract.socialPawnId, contract.socialChairId);
    await wait(id => window.voxel.snapshot().metrics.social?.relaxing.some(r => r.pawnId === id && r.seated), contract.socialPawnId);
    await shot('actual-social-chair-user', page.getByTestId('current-furniture')); await click('查看当前餐椅品质'); await assertStats(contract.socialChairId);
    await shot('chair-quality', page.getByTestId('furniture-quality')); check('actual social seat exposes that chair quality and the seated renderer pose');
    await selectPawn(contract.socialPawnId); await page.getByTestId('current-furniture').getByRole('button', { name: /^查看餐桌品质/ }).click(); await assertStats(contract.tableId);
    await page.getByTestId('room-living-detail').waitFor(); await shot('table-quality-room', page.getByTestId('furniture-quality'));
    check('actual table link shows table quality and room attributes without invented comfort or rest');
    await gathering(false); await wait(id => window.voxel.snapshot().snapshot.pawns.every(p => p.psyche.recreation?.spotId !== id || p.psyche.recreation?.kind !== 'social'), contract.tableId);
    await assertStats(contract.tableId); await gathering(true); check('gathering switch still controls actual leisure while quality stays fixed');

    await fixture('seated-meal'); await selectPawn(contract.dinerId); await currentFurniture(contract.dinerId, contract.diningChairId);
    await wait(id => window.voxel.snapshot().metrics.living?.diners.some(d => d.pawnId === id), contract.dinerId);
    await shot('actual-dining-chair-user', page.getByTestId('current-furniture')); await click('查看当前餐椅品质'); await assertStats(contract.diningChairId);
    await selectPawn(contract.dinerId); const meal = structuredClone((await pawn(contract.dinerId)).living.mealTask), cargo = structuredClone((await pawn(contract.dinerId)).cargo);
    await click('定位用餐桌'); await assertStats(contract.tableId); await gathering(true); await gathering(false);
    assert.deepEqual((await pawn(contract.dinerId)).living.mealTask, meal); assert.deepEqual((await pawn(contract.dinerId)).cargo, cargo);
    check('real dining uses the actual chair and gathering controls preserve its physical meal');
    await roundtrip('dining'); await selectPawn(contract.dinerId); await currentFurniture(contract.dinerId, contract.diningChairId);
    check('visible dining export and import retain quality physical food and seat identity');
    await page.setViewportSize({ width: 900, height: 700 }); await settle(); await shot('narrow-current-chair', page.getByTestId('current-furniture'));
    await click('查看当前餐椅品质'); await assertStats(contract.diningChairId); await shot('narrow-quality', page.getByTestId('furniture-quality'));
    const bounds = await page.getByTestId('furniture-quality').boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= 900);
    check('900 pixel layout preserves quality attributes and use navigation', { bounds });
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
