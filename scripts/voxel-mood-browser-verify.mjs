import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_MOOD_URL ?? 'http://127.0.0.1:5188/?world=voxel';
const OUT = process.env.VOXEL_MOOD_BROWSER_OUT ?? 'test-results/voxel-mood-browser';
const FIXTURES = process.env.VOXEL_MOOD_FIXTURES ?? 'test-results/voxel-mood';
const modes = process.env.VOXEL_MOOD_BROWSER_MODE ? [process.env.VOXEL_MOOD_BROWSER_MODE] : ['worker', 'main'];
const development = ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(OUT, { recursive: true });
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE, development,
  scope: 'Bounded v23 normal recreation UI verification. All mutations use visible controls, canvas clicks and ordinary file chooser import/export. snapshot/project/exportSave are read-only. Real initial/ready campaign saves contain no injected psyche values. This run does not claim a naturally occurring mental break; controlled core tests cover that separate mechanism.', modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function verify(mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), url = new URL(BASE); url.searchParams.set('world', 'voxel');
  if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
  const result = { mode, checks: [], screenshots: [], fixtures: [], assets: [], errors: [] }, reads = []; report.modes.push(result);
  page.on('pageerror', e => result.errors.push(e.message));
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
  const click = async name => { await button(name).scrollIntoViewIfNeeded(); await button(name).click(); if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0); };
  const settle = async () => { await page.waitForTimeout(250); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  async function shot(name, locator) {
    if (locator) await locator.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await settle(); const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file);
  }
  async function load(file) {
    await click('菜单与存档'); const bytes = await readFile(file), data = JSON.parse(bytes); result.fixtures.push({ file, sha256: sha(bytes), tick: data.tick });
    const choosing = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await choosing).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, data.tick); await settle(); return data;
  }
  async function selectPawn(id) {
    const p = (await state()).snapshot.pawns.find(p => p.id === id); assert(p);
    await page.locator('.voxel-colonists button').filter({ hasText: p.name }).click(); await page.getByTestId('mood-panel').waitFor(); await settle(); return p;
  }
  async function schedule(pawn, assignment) {
    const details = page.locator('.voxel-schedule'); if (await details.getAttribute('open') === null) await details.locator('summary').click();
    const hour = Math.floor((await state()).snapshot.hour); await page.getByLabel(`${pawn.name} ${hour}点作息`, { exact: true }).selectOption(assignment);
    await wait(({ id, hour, assignment }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).schedule[hour] === assignment, { id: pawn.id, hour, assignment });
    return hour;
  }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot);
    await click('暂停'); if (await button('收起指引').isVisible()) await click('收起指引'); assert.equal((await state()).worker, mode === 'worker');
    const initial = await load(`${FIXTURES}/initial.json`), first = initial.pawns.find(p => p.faction === 'colony'); await selectPawn(first.id);
    for (const [label, field] of [['心情', 'level'], ['娱乐', 'joy']]) assert.equal(Number(await page.getByRole('progressbar', { name: `${first.name} ${label}`, exact: true }).getAttribute('value')), first.psyche[field]);
    await page.locator('.voxel-mood-thoughts summary').click(); assert((await page.locator('.voxel-mood-thoughts').innerText()).includes('基础心情'));
    await shot('mood-causes', page.getByTestId('mood-panel')); check('actual psyche bars and mood cause target appear in a real initial colony');
    await click('现在去娱乐'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).psyche.recreation?.kind === 'walk', first.id);
    const beforeWalk = (await save()).pawns.find(p => p.id === first.id).psyche; await click('3倍速');
    await wait(({ id, joy }) => { const p = window.voxel.snapshot().snapshot.pawns.find(p => p.id === id); return p.psyche.joy > joy + 1 && p.psyche.tolerance.walk > 0; }, { id: first.id, joy: beforeWalk.joy });
    await click('暂停'); await shot('nature-walk', page.getByTestId('mood-panel')); await click('结束本次娱乐');
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).psyche.recreation === null, first.id);
    check('visible manual nature walk reaches a real destination raises joy and tolerance then can be ended');

    await load(`${FIXTURES}/initial.json`); const readyFile = JSON.parse(await readFile(`${FIXTURES}/ready.json`, 'utf8')), planned = readyFile.horseshoePins[0]; assert(planned);
    await click('马蹄铁桩'); await settle(); const projected = await page.evaluate(p => window.voxel.project(p), planned); await page.mouse.click(projected.x, projected.y);
    await wait(() => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'horseshoePin'));
    await click('3倍速'); await wait(() => window.voxel.snapshot().snapshot.horseshoePins.length === 1); await click('暂停');
    const built = await save(); assert(built.stats.built > initial.stats.built); check('visible construction tool and map click produce a physically completed horseshoe pin', { tick: built.tick, pin: built.horseshoePins[0] });
    const ready = await load(`${FIXTURES}/ready.json`), actor = ready.pawns.find(p => p.faction === 'colony'); await selectPawn(actor.id);
    await click('定位马蹄铁桩'); await page.getByTestId('horseshoe-detail').waitFor(); const pin = ready.horseshoePins[0];
    await click('清除选择'); await click('查看'); await settle(); const point = await page.evaluate(p => window.voxel.project({ ...p, z: p.z + .3 }), pin); await page.mouse.click(point.x, point.y);
    await page.getByTestId('horseshoe-detail').waitFor(); assert((await page.getByTestId('horseshoe-detail').innerText()).includes('两格外'));
    await shot('horseshoe-inspector', page.getByTestId('horseshoe-detail')); check('completed horseshoe model accepts map inspection and explains its actual throwing space');
    await selectPawn(actor.id); const hour = await schedule(actor, 'recreation'); await click('3倍速');
    await wait(id => { const p = window.voxel.snapshot().snapshot.pawns.find(p => p.id === id); return p.psyche.recreation?.kind === 'horseshoes' && !p.psyche.recreation.forced; }, actor.id);
    await click('暂停'); await schedule(actor, 'work'); await click('3倍速');
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).psyche.recreation === null, actor.id); await click('暂停');
    check('visible recreation schedule starts automatic play and changing to work interrupts it', { hour });
    const before = await save(), prior = before.pawns.find(p => p.id === actor.id).psyche; await click('现在去娱乐');
    await wait(id => { const p = window.voxel.snapshot().snapshot.pawns.find(p => p.id === id); return p.psyche.recreation?.kind === 'horseshoes' && p.psyche.recreation.forced; }, actor.id);
    await click('3倍速'); await wait(({ id, joy }) => { const p = window.voxel.snapshot().snapshot.pawns.find(p => p.id === id); return p.psyche.recreation?.kind === 'horseshoes' && !p.path.length && p.psyche.joy > joy + 2; }, { id: actor.id, joy: prior.joy });
    await click('暂停'); const playing = await save(), performer = playing.pawns.find(p => p.id === actor.id); assert(performer.psyche.tolerance.horseshoes > prior.tolerance.horseshoes);
    assert.equal(performer.x, performer.psyche.recreation.target.x); assert.equal(performer.y, performer.psyche.recreation.target.y);
    assert.equal(performer.psyche.recreation.spotId, pin.id);
    await selectPawn(actor.id); await page.locator('.voxel-recreation-tolerance summary').click();
    await page.mouse.move(720, 430); await page.mouse.wheel(0, -450); await shot('actual-horseshoes', page.getByTestId('mood-panel'));
    check('manual play overrides work schedule but joy only grows after real arrival with actual pin ownership', { pawnId: actor.id, joyBefore: prior.joy, joyAfter: performer.psyche.joy, tolerance: performer.psyche.tolerance.horseshoes });
    await click('菜单与存档'); const downloading = page.waitForEvent('download'); await click('导出体素存档'); const file = `${OUT}/${mode}-playing.json`; await (await downloading).saveAs(file); await click('关闭菜单');
    const exported = await load(file), restored = await save(); for (const key of ['horseshoePins', 'items', 'tick']) assert.deepEqual(restored[key], exported[key]);
    for (const p of exported.pawns) { const q = restored.pawns.find(v => v.id === p.id); assert.deepEqual(q.psyche, p.psyche); assert.deepEqual(q.schedule, p.schedule); }
    await selectPawn(actor.id); assert(await button('结束本次娱乐').isVisible()); await click('结束本次娱乐');
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).psyche.recreation === null, actor.id);
    check('visible save/import preserves recreation identities timers tolerance and schedules and cancellation releases play');
    await page.setViewportSize({ width: 900, height: 700 }); await button('现在去娱乐').scrollIntoViewIfNeeded(); await shot('narrow-controls');
    const rect = await button('现在去娱乐').boundingBox(); assert(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 900 && rect.y + rect.height <= 700);
    assert.equal(await page.getByTestId('mood-panel').getAttribute('data-risk'), 'stable'); check('900 pixel layout keeps actual mood controls visible and usable');
    await Promise.all(reads); if (!development) { assert(result.assets.length > 0); assert(result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error)); check('served production asset bytes match the local build'); }
    assert.deepEqual(result.errors, []); check('no browser page or console errors');
  } catch (error) { result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, modes: report.modes.map(m => ({ mode: m.mode, checks: m.checks.length, errors: m.errors, failure: m.failure })) }, null, 2));
