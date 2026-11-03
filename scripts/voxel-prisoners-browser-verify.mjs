import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_PRISONERS_URL ?? 'http://127.0.0.1:5188/?world=voxel';
const OUT = process.env.VOXEL_PRISONERS_BROWSER_OUT ?? 'test-results/voxel-prisoners-browser';
const FIXTURES = process.env.VOXEL_PRISONERS_FIXTURES ?? 'test-results/voxel-prisoners';
const modes = process.env.VOXEL_PRISONERS_BROWSER_MODE ? [process.env.VOXEL_PRISONERS_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_PRISONERS_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(OUT, { recursive: true });
const campaignBytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(campaignBytes);
assert.equal(campaign.status, 'passed', 'ordinary prisoner campaign must finish first');
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE, development,
  scope: 'Bounded v24 prisoner UI verification in Worker and main renderers. All mutations use ordinary visible controls, map clicks and file chooser import/export. snapshot/project/exportSave are read-only. Imported checkpoints come from the hash-checked ordinary campaign; this script does not create injuries, prisoners, resources or clocks and never edits saves.',
  campaign: { file: `${FIXTURES}/report.json`, sha256: sha(campaignBytes), scope: campaign.scope, baseline: campaign.baseline }, modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function verify(mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), url = new URL(BASE); url.searchParams.set('world', 'voxel');
  if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
  const result = { mode, checks: [], screenshots: [], fixtures: [], assets: [], errors: [] }, reads = []; report.modes.push(result);
  page.on('pageerror', e => result.errors.push(e.stack ?? e.message));
  page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  page.on('response', response => {
    if (!new URL(response.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
    reads.push(response.body().then(async bytes => { asset.sha256 = sha(bytes); asset.bytes = bytes.length;
      asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
    }).catch(error => { asset.error = String(error); }));
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const save = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = name => page.getByRole('button', { name, exact: true });
  const click = async name => { await button(name).scrollIntoViewIfNeeded(); await button(name).click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    if (/^[123]倍速$/.test(name)) await wait(speed => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
  };
  const settle = async () => { await page.waitForTimeout(250); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  async function shot(name, locator) {
    if (locator) await locator.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await settle(); const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file);
  }
  async function load(file) {
    await click('菜单与存档'); const bytes = await readFile(file), data = JSON.parse(bytes);
    if (path.resolve(path.dirname(file)) === path.resolve(FIXTURES)) {
      const evidence = campaign.fixtures[path.basename(file, '.json')]; assert(evidence, 'campaign fixture provenance'); assert.equal(sha(bytes), evidence.sha256);
    }
    result.fixtures.push({ file, sha256: sha(bytes), version: data.version, tick: data.tick });
    const choosing = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await choosing).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, data.tick); await settle(); return data;
  }
  async function openPrison() { if (!await page.getByTestId('prison-panel').isVisible()) await click('囚犯与招募'); }
  async function selectPrisoner(id) {
    const p = (await state()).snapshot.pawns.find(p => p.id === id); assert(p);
    await openPrison(); await click(`查看囚犯 ${p.name} #${id}`);
    await page.getByTestId('prisoner-detail').waitFor(); assert.equal(await page.getByTestId('prisoner-detail').getAttribute('data-prisoner-id'), String(id));
    await settle(); return p;
  }
  async function selectColonist(id) {
    const p = (await state()).snapshot.pawns.find(p => p.id === id); assert.equal(p?.faction, 'colony');
    const target = page.locator(`.voxel-colonists button[data-colonist-id="${id}"]`); await target.scrollIntoViewIfNeeded(); await target.click();
    await page.getByTestId('mood-panel').waitFor(); await settle(); return p;
  }
  async function policy(id, value) {
    await page.getByLabel('囚犯政策', { exact: true }).selectOption(value);
    await wait(({ id, value }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id)?.prisoner?.policy === value, { id, value });
  }
  async function exportThroughUI(name) {
    await click('菜单与存档'); const downloading = page.waitForEvent('download'); await click('导出体素存档');
    const file = `${OUT}/${mode}-${name}.json`; await (await downloading).saveAs(file); await click('关闭菜单'); return file;
  }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot);
    await click('暂停'); if (await button('收起指引').isVisible()) await click('收起指引'); assert.equal((await state()).worker, mode === 'worker');

    const initial = await load(`${FIXTURES}/ready.json`), enemy = initial.pawns.find(p => p.faction === 'raider' && p.downed && !p.dead);
    assert(enemy, 'ordinary battle checkpoint needs a living downed raider'); assert(initial.beds.length > 0);
    await openPrison(); assert.equal(await page.locator(`[data-capture-target="${enemy.id}"]`).count(), 1);
    const bedsSection = page.getByTestId('prison-panel').locator('details').filter({ has: page.locator('summary', { hasText: '床位设置' }) });
    await bedsSection.locator('summary').click(); const bed = initial.beds.find(b => b.prisoner) ?? initial.beds[0];
    await bedsSection.getByRole('button', { name: `${bed.prisoner ? '囚犯床' : '木床'} #${bed.id}${bed.medical ? ' · 医疗' : ''}`, exact: true }).click();
    await page.getByTestId('bed-detail').waitFor(); assert((await page.getByTestId('prison-bed-room').innerText()).includes('当前位于封闭房间'));
    const beforeBeds = (await save()).beds;
    if (bed.prisoner) await page.getByLabel('囚犯床', { exact: true }).click();
    await wait(id => !window.voxel.snapshot().snapshot.beds.find(b => b.id === id).prisoner, bed.id);
    const unmarked = (await save()).beds;
    await page.getByLabel('囚犯床', { exact: true }).click(); await wait(id => window.voxel.snapshot().snapshot.beds.find(b => b.id === id).prisoner, bed.id);
    await page.getByLabel('床位用途', { exact: true }).selectOption('medical');
    await wait(id => { const b = window.voxel.snapshot().snapshot.beds.find(b => b.id === id); return b.medical && b.prisoner; }, bed.id);
    assert(await page.getByLabel('床位主人', { exact: true }).isDisabled());
    const marked = (await save()).beds, changed = marked.filter(b => b.prisoner && !unmarked.find(q => q.id === b.id).prisoner).map(b => b.id);
    await shot('prison-bed', page.getByTestId('bed-detail'));
    check('visible prisoner-bed switch updates actual room beds and coexists with medical use', { bedId: bed.id, changedBedIds: changed, priorPrisonBedIds: beforeBeds.filter(b => b.prisoner).map(b => b.id) });
    for (const p of (await state()).snapshot.pawns.filter(p => p.faction === 'colony' && p.drafted && !p.dead && !p.downed)) {
      await selectColonist(p.id); await click('解除征召');
    }
    await openPrison(); await click(`查看倒地敌人 ${enemy.name} #${enemy.id}`); await page.getByTestId('capture-controls').waitFor();
    const originalCapture = campaign.commands.find(v => v.c.type === 'capture' && v.c.targetId === enemy.id);
    if (originalCapture) await page.getByLabel('俘虏执行者', { exact: true }).selectOption(String(originalCapture.c.pawnId));
    assert(!await button('俘虏并送往囚犯床').isDisabled()); const captorId = Number(await page.getByLabel('俘虏执行者', { exact: true }).inputValue());
    await click('俘虏并送往囚犯床');
    await wait(({ enemy, captor }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === captor)?.wardenTask?.prisonerId === enemy, { enemy: enemy.id, captor: captorId });
    await click('3倍速'); await wait(id => { const p = window.voxel.snapshot().snapshot.pawns.find(p => p.id === id); return p.faction === 'prisoner' && p.carriedBy !== null; }, enemy.id);
    await click('暂停'); const carried = (await save()).pawns.find(p => p.id === enemy.id); assert.equal(carried.carriedBy, captorId);
    await selectPrisoner(enemy.id); await shot('actual-carry', page.getByTestId('prisoner-detail'));
    await click('3倍速'); await wait(id => { const s = window.voxel.snapshot().snapshot, p = s.pawns.find(p => p.id === id), b = s.beds.find(b => b.id === p.prisoner?.bedId); return p.faction === 'prisoner' && p.carriedBy === null && b && p.x === b.x && p.y === b.y && p.z === b.z; }, enemy.id);
    await click('暂停'); const placed = (await save()).pawns.find(p => p.id === enemy.id); await selectPrisoner(enemy.id);
    assert.equal(placed.id, enemy.id); assert.equal(placed.prisoner.originalFaction, 'raider'); assert.equal(placed.weapon, null);
    assert(!await page.getByTestId('mood-panel').isVisible()); assert.equal(await button('征召').count(), 0);
    assert(await page.getByLabel(`${placed.name} warden优先级`, { exact: true }).isDisabled());
    assert.notEqual(await page.locator('fieldset.voxel-readonly-equipment').getAttribute('disabled'), null);
    for (const control of await page.locator('fieldset.voxel-readonly-equipment button, fieldset.voxel-readonly-equipment input, fieldset.voxel-readonly-equipment select').all()) assert(await control.isDisabled());
    assert(await page.getByLabel('医疗政策', { exact: true }).isVisible());
    await shot('placed-prisoner', page.getByTestId('prisoner-detail'));
    check('ordinary capture preserves identity physically carries and places prisoner and exposes care without colony controls', { prisonerId: enemy.id, captorId, bedId: placed.prisoner.bedId });
    const carryFile = await exportThroughUI('placed'); const exported = await load(carryFile), restored = await save();
    const restoredPawn = restored.pawns.find(p => p.id === enemy.id); assert.deepEqual(restoredPawn.prisoner, exported.pawns.find(p => p.id === enemy.id).prisoner);
    assert.deepEqual(restored.beds, exported.beds); check('ordinary export/import preserves prisoner identity policy resistance and assigned prison bed');

    const ready = await load(`${FIXTURES}/talk-ready.json`), prisoner = ready.pawns.find(p => p.faction === 'prisoner' && !p.dead && !p.downed);
    assert(prisoner?.prisoner?.resistance > 0, 'real recovered prisoner checkpoint needs positive resistance');
    const warden = ready.pawns.find(p => p.faction === 'colony' && !p.dead && !p.downed && !p.drafted && p.priorities.warden > 0); assert(warden);
    await selectColonist(warden.id); await page.getByLabel(`${warden.name} warden优先级`, { exact: true }).selectOption('1');
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).priorities.warden === 1, warden.id);
    await selectPrisoner(prisoner.id); await policy(prisoner.id, 'reduceResistance');
    assert.equal(Number(await page.getByRole('progressbar', { name: '囚犯抵抗', exact: true }).getAttribute('value')), prisoner.prisoner.resistance);
    await click('3倍速'); await wait(id => window.voxel.snapshot().snapshot.pawns.some(p => p.wardenTask?.prisonerId === id && p.wardenTask.stage === 'talk'), prisoner.id);
    await click('暂停'); await selectPrisoner(prisoner.id);
    await page.mouse.move(720, 430); await page.mouse.wheel(0, -600);
    await shot('actual-conversation', page.getByTestId('prisoner-detail'));
    await click('3倍速'); await wait(({ id, resistance }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).prisoner?.resistance < resistance, { id: prisoner.id, resistance: prisoner.prisoner.resistance });
    await click('暂停'); const talked = (await save()).pawns.find(p => p.id === prisoner.id); assert.equal(talked.faction, 'prisoner');
    assert((await page.getByTestId('prisoner-last-interaction').innerText()).includes(talked.prisoner.lastInteraction));
    check('visible warden priority and resistance policy drive real adjacent conversation and expose actual reduction', { before: prisoner.prisoner.resistance, after: talked.prisoner.resistance, lastInteraction: talked.prisoner.lastInteraction });

    const zero = await load(`${FIXTURES}/zero-resistance.json`), recruit = zero.pawns.find(p => p.faction === 'prisoner' && p.prisoner?.resistance === 0 && !p.dead && !p.downed); assert(recruit);
    await selectPrisoner(recruit.id); await policy(recruit.id, 'reduceResistance'); assert((await page.getByTestId('prisoner-detail').innerText()).includes('不会自动招募'));
    const afterEligible = Math.max((await state()).snapshot.tick, recruit.prisoner.nextInteractionTick) + 250;
    await click('3倍速'); await wait(t => window.voxel.snapshot().snapshot.tick >= t, afterEligible); await click('暂停');
    assert.equal((await state()).snapshot.pawns.find(p => p.id === recruit.id).faction, 'prisoner');
    assert(!(await state()).snapshot.pawns.some(p => p.wardenTask?.prisonerId === recruit.id && p.wardenTask.stage === 'talk'));
    await policy(recruit.id, 'recruit'); assert((await page.getByTestId('prisoner-detail').innerText()).includes('等待下次招募交谈'));
    const colonyCount = (await state()).snapshot.pawns.filter(p => p.faction === 'colony').length;
    await click('3倍速'); await wait(id => window.voxel.snapshot().snapshot.pawns.some(p => p.wardenTask?.prisonerId === id && p.wardenTask.stage === 'talk'), recruit.id);
    await click('暂停'); assert.equal((await state()).snapshot.pawns.find(p => p.id === recruit.id).faction, 'prisoner');
    await click('3倍速'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id)?.faction === 'colony', recruit.id); await click('暂停');
    const recruited = (await save()).pawns.find(p => p.id === recruit.id); assert.equal(recruited.prisoner, null);
    assert.equal((await state()).snapshot.pawns.filter(p => p.faction === 'colony').length, colonyCount + 1);
    await selectColonist(recruit.id); assert(!await page.getByTestId('prisoner-detail').isVisible());
    assert(!await page.getByLabel(`${recruit.name} warden优先级`, { exact: true }).isDisabled()); await shot('recruited-colonist', page.getByTestId('mood-panel'));
    check('zero resistance alone keeps prisoner status and only a later completed recruit conversation adds a controllable colonist', { recruitId: recruit.id, colonyCount: colonyCount + 1 });
    const recruitedFile = await exportThroughUI('recruited'); await load(recruitedFile); assert.equal((await save()).pawns.find(p => p.id === recruit.id).faction, 'colony');
    await page.setViewportSize({ width: 900, height: 700 }); await selectColonist(recruit.id);
    const avatar = page.locator(`.voxel-colonists button[data-colonist-id="${recruit.id}"]`); await avatar.scrollIntoViewIfNeeded();
    const rect = await avatar.boundingBox(); assert(rect && rect.x >= 0 && rect.x + rect.width <= 900 && rect.y >= 0);
    await openPrison(); await shot('narrow-recruited-colony'); const drawer = await page.getByTestId('prison-panel').boundingBox();
    assert(drawer && drawer.x >= 0 && drawer.x + drawer.width <= 900 && drawer.y >= 0 && drawer.y + drawer.height <= 700);
    check('900 pixel layout keeps the extra colonist avatar and prison drawer usable after save/import');
    await page.setViewportSize({ width: 1440, height: 960 }); await load(`${FIXTURES}/zero-resistance.json`);
    await selectPrisoner(recruit.id); await policy(recruit.id, 'release'); await click('3倍速');
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id)?.prisoner?.releasing, recruit.id); await click('暂停');
    const releasing = (await save()).pawns.find(p => p.id === recruit.id); assert.equal(releasing.faction, 'prisoner'); assert.equal(releasing.prisoner.bedId, null);
    assert((await state()).snapshot.beds.every(b => b.owner !== recruit.id)); assert(await page.getByLabel('囚犯政策', { exact: true }).isDisabled());
    await shot('released-prisoner', page.getByTestId('prisoner-detail'));
    await click('3倍速'); await wait(id => !window.voxel.snapshot().snapshot.pawns.some(p => p.id === id), recruit.id); await click('暂停');
    assert.equal((await state()).snapshot.pawns.filter(p => p.faction === 'colony').length, colonyCount);
    check('visible release policy needs an actual warden visit then frees the bed and prisoner walks off the map without recruitment');
    await Promise.all(reads); if (!development) { assert(result.assets.length > 0); assert(result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error)); check('served production asset bytes match the local build'); }
    assert.deepEqual(result.errors, []); check('no browser page or console errors');
  } catch (error) { result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, modes: report.modes.map(m => ({ mode: m.mode, checks: m.checks.length, errors: m.errors, failure: m.failure })) }, null, 2));
