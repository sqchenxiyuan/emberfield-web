import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_SOCIAL_URL ?? 'http://127.0.0.1:4178/?world=voxel';
const OUT = process.env.VOXEL_SOCIAL_BROWSER_OUT ?? 'test-results/voxel-social-browser';
const FIXTURES = process.env.VOXEL_SOCIAL_FIXTURES ?? 'test-results/voxel-social';
const modes = process.env.VOXEL_SOCIAL_BROWSER_MODE ? [process.env.VOXEL_SOCIAL_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_SOCIAL_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = b => createHash('sha256').update(b).digest('hex');
await mkdir(OUT, { recursive: true });
const bytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(bytes), contract = campaign.browser;
assert.equal(campaign.status, 'passed', 'fresh ordinary-play campaign required');
const manifest = await readFile(`${FIXTURES}/source-manifest.json`); assert.equal(sha(manifest), campaign.execution.sourceManifestSha256);
for (const entry of JSON.parse(manifest)) assert.equal(sha(await readFile(entry.file)), entry.sha256, `campaign source is current: ${entry.file}`);
const report = { status: 'running', startedAt: new Date().toISOString(), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${FIXTURES}/report.json`, sha256: sha(bytes), sourceManifestSha256: campaign.execution.sourceManifestSha256 },
  scope: 'Worker and main renderer evidence from SHA-verified v32 ordinary-play saves. Mutations only through visible controls and file chooser import/export. snapshot/project/exportSave are read-only. Checks real table relaxation, shared seat claims, gathering controls, directional opinions and timed source memories, real interaction bubbles and recent parties, paused receipt, expiry, explicit recreation selection, physical dining continuity and 900px layout. No state injection.', modes: [] };
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
  async function selectPawn(id) { const p = await pawn(id); await page.locator('.voxel-colonists button').filter({ hasText: p.name }).first().click(); await wait(id => { const panels = document.querySelectorAll('[data-testid="social-panel"]'); return panels.length === 1 && panels[0].getAttribute('data-pawn-id') === String(id); }, id); await settle(); }
  async function waitForTable() { await wait(id => document.querySelector('[data-testid="dining-furniture-detail"]')?.getAttribute('data-furniture-id') === String(id), contract.tableId); }
  async function tableDetails() { await click('定位聚会餐桌'); await waitForTable(); }
  async function runUntil(fn, arg, timeout = 60000) { await click('3倍速'); await wait(fn, arg, timeout); await click('暂停'); }
  async function toggle(enabled) {
    const control = page.getByRole('checkbox', { name: '允许聚会', exact: true });
    if (await control.isChecked() !== enabled) await control.click();
    await wait(({ id, enabled }) => window.voxel.snapshot().snapshot.tables.find(t => t.id === id).gathering === enabled, { id: contract.tableId, enabled });
    await wait(enabled => document.querySelector('input[aria-label="允许聚会"]')?.checked === enabled, enabled);
  }
  async function roundtrip(name) {
    const before = await saved(); await click('菜单与存档'); const download = page.waitForEvent('download'); await click('导出体素存档'); const file = `${OUT}/${mode}-${name}-roundtrip.json`; await (await download).saveAs(file); await click('关闭菜单'); await load(file);
    const after = await saved(); for (const f of ['tables', 'chairs', 'socialHistory', 'socialLog', 'items']) assert.deepEqual(after[f], before[f], f);
    for (const f of ['social', 'psyche', 'living', 'cargo']) assert.deepEqual(after.pawns.map(p => p[f]), before.pawns.map(p => p[f]), f);
  }
  try {
    await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await click('暂停');
    if (await button('收起指引').isVisible()) await click('收起指引');
    assert.equal((await state()).worker, mode === 'worker'); check('requested renderer is active');
    await fixture('gathering'); const attendees = (await state()).snapshot.pawns.filter(p => p.psyche.recreation?.kind === 'social' && !p.path.length && p.x === p.psyche.recreation.target.x && p.y === p.psyche.recreation.target.y && p.z === p.psyche.recreation.target.z);
    assert(attendees.length >= 2); await selectPawn(attendees[0].id);
    await wait(ids => ids.every(id => window.voxel.snapshot().metrics.social?.relaxing.some(p => p.pawnId === id)), attendees.map(p => p.id));
    assert.equal(await page.getByTestId('recreation-status').getAttribute('data-kind'), 'social');
    const rendered = (await state()).metrics.social.relaxing; assert(rendered.every(r => r.tableId === contract.tableId));
    for (const r of rendered) { assert(r.seated && r.chairId !== null); assert.equal(r.leg, -1.25); }
    await shot('real-table-relaxation', page.getByTestId('mood-panel')); check('automatic table users have actual arrival and occupied-chair poses', { rendered });
    await tableDetails(); assert(await page.getByRole('checkbox', { name: '允许聚会' }).isChecked());
    assert(await page.getByTestId('table-social-users').getByRole('button').count() >= 2);
    const userButton = page.getByTestId('table-social-users').getByRole('button').first(), targetId = Number(await userButton.getAttribute('data-pawn-id'));
    await userButton.click(); await wait(id => document.querySelector('[data-testid="social-panel"]')?.getAttribute('data-pawn-id') === String(id), targetId);
    check('table list focuses the real person and updates person selection');
    await tableDetails(); await toggle(false);
    await wait(id => window.voxel.snapshot().snapshot.pawns.every(p => p.psyche.recreation?.kind !== 'social' || p.psyche.recreation.spotId !== id) && window.voxel.snapshot().metrics.social?.relaxing.length === 0, contract.tableId);
    await shot('gathering-disabled', page.getByTestId('dining-furniture-detail')); check('visible gathering switch ends real table leisure and its pose');

    await fixture('interaction'); const event = contract.event;
    await selectPawn(event.initiatorId);
    await wait(e => [e.initiatorId, e.recipientId].every(id => window.voxel.snapshot().metrics.social?.bubbles.some(b => b.pawnId === id && b.tick === e.tick && b.initiatorId === e.initiatorId && b.recipientId === e.recipientId)), event);
    await page.locator(`[data-testid="social-event"][data-tick="${event.tick}"][data-initiator-id="${event.initiatorId}"]`).waitFor();
    const relation = page.locator(`[data-testid="social-relation"][data-other-id="${event.recipientId}"]`);
    await relation.locator('summary').click(); assert(Number.isFinite(Number(await relation.getAttribute('data-opinion'))));
    assert(Number.isFinite(Number(await relation.getAttribute('data-reverse-opinion'))));
    await shot('directional-opinions', page.getByTestId('social-panel')); check('real event participants and both opinion directions are visible');
    await click(`查看 ${(await pawn(event.recipientId)).name}`);
    assert.equal(await page.getByTestId('social-panel').getAttribute('data-pawn-id'), String(event.recipientId));
    const reverse = page.locator(`[data-testid="social-relation"][data-other-id="${event.initiatorId}"]`); await reverse.locator('summary').click();
    const memories = reverse.getByTestId('social-memory'); assert(await memories.count() > 0);
    for (const memory of await memories.all()) { assert(Number(await memory.getAttribute('data-expires')) > event.tick); assert.match(await memory.textContent(), /剩余/); }
    await shot('source-and-expiry', page.getByTestId('social-panel')); check('counterpart navigation shows concrete source memories and remaining lifetime');
    const tickBefore = (await state()).snapshot.tick; await page.waitForTimeout(1000); assert.equal((await state()).snapshot.tick, tickBefore);
    assert((await state()).metrics.social.bubbles.some(b => b.tick === event.tick && b.initiatorId === event.initiatorId));
    await shot('paused-real-bubbles'); check('paused simulation preserves short receipt and actual identities');
    await roundtrip('social-event'); await selectPawn(event.recipientId);
    check('visible export and import preserve events memories and recreation without replay');
    await runUntil(e => window.voxel.snapshot().snapshot.tick > e.tick + e.bubbleTicks, { ...event, bubbleTicks: contract.bubbleTicks });
    await wait(e => !window.voxel.snapshot().metrics.social?.bubbles.some(b => b.tick === e.tick && b.initiatorId === e.initiatorId), event);
    assert((await state()).snapshot.socialLog.some(e => e.tick === event.tick && e.initiatorId === event.initiatorId));
    check('expired bubbles vanish while the historical event remains available');

    await fixture('manual-ready'); const id = contract.manualPawnId; await selectPawn(id);
    await page.getByRole('combobox', { name: `${(await pawn(id)).name} 娱乐活动`, exact: true }).selectOption('social');
    const before = structuredClone((await pawn(id)).social);
    await click('现在去娱乐'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).psyche.recreation?.kind === 'social', id);
    assert.deepEqual((await pawn(id)).social, before);
    assert((await pawn(id)).path.length > 0, 'explicit table leisure produces actual travel');
    await runUntil(id => { const p = window.voxel.snapshot().snapshot.pawns.find(p => p.id === id); return p.psyche.recreation?.kind === 'social' && !p.path.length && p.x === p.psyche.recreation.target.x && p.y === p.psyche.recreation.target.y && p.z === p.psyche.recreation.target.z; }, id);
    await wait(id => window.voxel.snapshot().metrics.social?.relaxing.some(p => p.pawnId === id), id);
    await shot('explicit-social-choice', page.getByTestId('mood-panel')); check('explicit leisure choice uses real travel and cannot directly manufacture opinion');
    await click('结束本次娱乐'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).psyche.recreation === null, id);
    check('visible cancellation releases the chosen leisure activity');

    await fixture('during-meal'); await selectPawn(contract.dinerId); const dinerBefore = await pawn(contract.dinerId);
    // Use the diner-visible table link; the front chair can occlude a projected table cell.
    await click('定位用餐桌'); await waitForTable();
    assert.equal(await page.getByTestId('dining-furniture-detail').getAttribute('data-furniture-id'), String(contract.tableId));
    await toggle(true); await toggle(false);
    const dinerAfter = await pawn(contract.dinerId); assert.deepEqual(dinerAfter.living.mealTask, dinerBefore.living.mealTask); assert.deepEqual(dinerAfter.cargo, dinerBefore.cargo);
    await wait(id => window.voxel.snapshot().metrics.living?.diners.some(d => d.pawnId === id), contract.dinerId);
    await shot('meal-continues', page.getByTestId('dining-furniture-detail')); check('gathering controls preserve physical dining and the eating pose');
    await fixture('interaction'); await selectPawn(event.recipientId); await page.setViewportSize({ width: 900, height: 700 }); await settle();
    const narrowRelation = page.locator(`[data-testid="social-relation"][data-other-id="${event.initiatorId}"]`); await narrowRelation.locator('summary').click();
    await shot('narrow-social', page.getByTestId('social-panel')); const bounds = await page.getByTestId('social-panel').boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 900); check('900 pixel layout preserves relation details and controls', { bounds });
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
