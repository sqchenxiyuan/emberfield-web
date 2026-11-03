import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_SANITATION_URL ?? 'http://127.0.0.1:4178/?world=voxel';
const OUT = process.env.VOXEL_SANITATION_BROWSER_OUT ?? 'test-results/voxel-sanitation-browser';
const FIXTURES = process.env.VOXEL_SANITATION_FIXTURES ?? 'test-results/voxel-sanitation';
const modes = process.env.VOXEL_SANITATION_BROWSER_MODE ? [process.env.VOXEL_SANITATION_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_SANITATION_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const at = p => (p.z * 64 + p.y) * 64 + p.x;
const point = p => ({ x: p.x, y: p.y, z: p.z });
const names = { dirt: '泥土', blood: '血迹', butcher: '屠宰污物', vomit: '呕吐物' };
const stages = { initial: '初期', major: '严重', recovering: '恢复' };
await mkdir(OUT, { recursive: true });
const campaignBytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(campaignBytes);
assert.equal(campaign.status, 'passed', 'ordinary sanitation campaign must finish first');
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE, development,
  scope: 'Bounded v25 sanitation UI verification in Worker and main renderers. All mutations use ordinary visible controls, map clicks and file chooser import/export. snapshot/project/exportSave are read-only. Imported checkpoints come from the hash-checked ordinary campaign; this script never creates filth, illness, food or clocks and never edits saves. Numbers remain provisional project tuning, not native calibration.',
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
  const wait = (fn, arg, timeout = 45000) => page.waitForFunction(fn, arg, { timeout });
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
  async function openSanitation() { if (!await page.getByTestId('sanitation-panel').isVisible()) await click('卫生与清洁'); }
  async function selectColonist(id) {
    const p = (await state()).snapshot.pawns.find(p => p.id === id); assert.equal(p?.faction, 'colony');
    const target = page.locator(`.voxel-colonists button[data-colonist-id="${id}"]`); await target.scrollIntoViewIfNeeded(); await target.click();
    await page.getByTestId('mood-panel').waitFor(); await settle(); return p;
  }
  async function selectMap(pos) {
    for (let n = 0; (await state()).level !== pos.z && n < 24; n++) await click((await state()).level < pos.z ? '上移一层' : '下移一层');
    assert.equal((await state()).level, pos.z); await click('查看'); await settle();
    for (const height of [.06, .35, .7, 1]) {
      const q = await page.evaluate(({ pos, height }) => window.voxel.project({ ...pos, z: pos.z + height }), { pos, height });
      await page.mouse.click(q.x, q.y); await page.waitForTimeout(160);
      const selected = (await state()).selected;
      if (selected && at(selected) === at(pos)) return;
    }
    assert.deepEqual(point((await state()).selected), point(pos), 'visible map click must select actual intended cell');
  }
  async function selectFilth(id) {
    const f = (await state()).snapshot.filth.find(f => f.id === id); assert(f, `actual filth ${id}`);
    await openSanitation(); const item = button(`查看${names[f.kind]} #${id}`);
    if (await item.count()) await click(`查看${names[f.kind]} #${id}`);
    else {
      const near = (await state()).snapshot.pawns.filter(p => p.faction === 'colony' && !p.dead)
        .sort((a, b) => Math.hypot(a.x-f.x,a.y-f.y)-Math.hypot(b.x-f.x,b.y-f.y))[0];
      await selectColonist(near.id); await selectMap(f);
    }
    await page.getByTestId('sanitation-detail').waitFor(); await settle(); return f;
  }
  async function priority(pawn, value) {
    await openSanitation(); const section = page.locator('.voxel-sanitation-workers');
    if (await section.getAttribute('open') === null) await section.locator('summary').click();
    await page.getByLabel(`${pawn.name} 卫生面板清洁优先级`, { exact: true }).selectOption(String(value));
    await wait(({ id, value }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).priorities.clean === value, { id: pawn.id, value });
  }
  async function exportThroughUI(name) {
    await click('菜单与存档'); const downloading = page.waitForEvent('download'); await click('导出体素存档');
    const file = `${OUT}/${mode}-${name}.json`; await (await downloading).saveAs(file); await click('关闭菜单'); return file;
  }
  async function diagnosed(id) {
    await selectColonist(id); const s = (await state()).snapshot, p = s.pawns.find(p => p.id === id), illness = p.foodPoisoning;
    assert(illness); const panel = page.getByTestId('food-poisoning-detail'); await panel.waitFor();
    assert.equal(await panel.getAttribute('data-stage'), illness.stage); assert((await panel.innerText()).includes(`${stages[illness.stage]}阶段`));
    const bar = page.getByRole('progressbar', { name: '食物中毒恢复进度', exact: true });
    assert.equal(Number(await bar.getAttribute('value')), Math.max(0, Math.min(s.tick, illness.endsTick) - illness.startedTick));
    assert.equal(Number(await bar.getAttribute('max')), illness.endsTick - illness.startedTick);
    assert((await page.getByTestId('food-poisoning-recovery').innerText()).includes('随时间恢复'));
    assert(!/poisonChance|cookingOutcome|已知有毒餐食|中毒概率/.test(await page.locator('body').innerText()));
    return { pawn: p, tick: s.tick, illness };
  }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot);
    await click('暂停'); if (await button('收起指引').isVisible()) await click('收起指引'); assert.equal((await state()).worker, mode === 'worker');

    const initial = await load(`${FIXTURES}/ready.json`), { corner, far } = campaign.kitchen;
    const kitchenFilth = initial.filth.filter(f => f.z === corner.z && f.x >= corner.x && f.x <= far.x && f.y >= corner.y && f.y <= far.y);
    const target = kitchenFilth.find(f => f.kind === 'butcher') ?? kitchenFilth[0]; assert(target);
    const cleaner = initial.pawns.find(p => p.id === campaign.people.cleanerId); assert(cleaner);
    await selectFilth(target.id); const detail = page.getByTestId('sanitation-detail');
    assert((await detail.innerText()).includes(`${target.amount} 层`)); assert(!initial.homeArea.includes(at(target)));
    assert(await button(`清扫${names[target.kind]} #${target.id}`).isDisabled());
    const roomId = Number(await page.getByTestId('room-cleanliness').getAttribute('data-room-id'));
    const beforeRoom = (await state()).snapshot.roomCleanliness.find(r => r.roomId === roomId); assert(beforeRoom);
    assert.equal(Number(await page.getByTestId('room-cleanliness').getAttribute('data-value')), beforeRoom.cleanliness);
    await shot('dirty-kitchen', detail);
    check('actual kitchen filth and room cleanliness are inspectable and outside-home cleaning is disabled', { filthId: target.id, layers: target.amount, roomId, cleanliness: beforeRoom.cleanliness });

    // Actual map selections define the six-cell kitchen rectangle.
    await selectMap(corner); await click('设为清洁范围起点'); await selectMap(far); await click('加入清洁家园范围');
    await wait(({ corner, far }) => { const home = new Set(window.voxel.snapshot().snapshot.homeArea);
      for (let x = corner.x; x <= far.x; x++) for (let y = corner.y; y <= far.y; y++) if (!home.has((corner.z*64+y)*64+x)) return false; return true;
    }, { corner, far });
    await priority(cleaner, 1); await priority(cleaner, 0); await selectFilth(target.id);
    await page.getByLabel('清扫执行者', { exact: true }).selectOption(String(cleaner.id));
    await click(`清扫${names[target.kind]} #${target.id}`);
    await wait(({ id, filthId }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).cleanTask?.filthId === filthId, { id: cleaner.id, filthId: target.id });
    const assigned = (await state()).snapshot.pawns.find(p => p.id === cleaner.id);
    assert.equal(assigned.cleanTask.progress, 0); assert(assigned.path.length > 0, 'real cleaner must initially travel from outside kitchen');
    await selectColonist(cleaner.id); assert((await page.getByTestId('cleaning-status').innerText()).includes('前往清扫'));
    await click('3倍速'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).cleanTask?.progress > 0, cleaner.id);
    await click('暂停'); const working = (await state()).snapshot.pawns.find(p => p.id === cleaner.id);
    assert.equal(at(working), at(target)); assert.equal(working.path.length, 0);
    await selectColonist(cleaner.id); assert((await page.getByTestId('cleaning-status').innerText()).includes('正在清扫'));
    assert.equal(Number(await page.getByRole('progressbar', { name: '本层清扫进度', exact: true }).getAttribute('value')), working.cleanTask.progress);
    await page.mouse.move(720, 430); await page.mouse.wheel(0, -500); await shot('actual-cleaning', page.getByTestId('cleaning-status'));
    check('visible home rectangle priority and manual order produce real travel followed by on-cell cleaning progress', { cleanerId: cleaner.id, filthId: target.id, pathCells: assigned.path.length, progress: working.cleanTask.progress });

    const midFile = await exportThroughUI('mid-clean'), exported = await load(midFile), restored = await save();
    assert.deepEqual(restored.pawns.find(p => p.id === cleaner.id).cleanTask, exported.pawns.find(p => p.id === cleaner.id).cleanTask);
    assert.deepEqual(restored.filth, exported.filth); await selectColonist(cleaner.id); await click('取消本次清扫');
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).cleanTask === null, cleaner.id);
    assert.equal((await state()).snapshot.pawns.find(p => p.id === cleaner.id).priorities.clean, 0);
    await selectFilth(target.id); await page.getByLabel('清扫执行者', { exact: true }).selectOption(String(cleaner.id)); await click(`清扫${names[target.kind]} #${target.id}`);
    await click('3倍速'); await wait(id => !window.voxel.snapshot().snapshot.filth.some(f => f.id === id), target.id); await click('暂停');
    await selectMap(target); const updatedDetail = page.getByTestId('sanitation-detail');
    if (await updatedDetail.getAttribute('open') === null) await updatedDetail.locator('summary').click();
    const afterRoom = (await state()).snapshot.roomCleanliness.find(r => r.roomId === roomId); assert(afterRoom.cleanliness > beforeRoom.cleanliness);
    assert.equal(Number(await page.getByTestId('room-cleanliness').getAttribute('data-value')), afterRoom.cleanliness);
    await shot('cleaned-kitchen', updatedDetail);
    check('save/import preserves actual cleaning task and layers; visible cancel stops it; completed work removes filth and improves the same room', { before: beforeRoom.cleanliness, after: afterRoom.cleanliness });

    const automatic = await load(`${FIXTURES}/cleaning.json`), autoPawn = automatic.pawns.find(p => p.cleanTask?.progress > 0);
    assert(autoPawn && autoPawn.priorities.clean > 0); await selectColonist(autoPawn.id);
    assert.equal(await page.getByTestId('cleaning-status').getAttribute('data-filth-id'), String(autoPawn.cleanTask.filthId));
    // Changing a work priority releases the current task immediately, as for all work types.
    await priority(autoPawn, 0);
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).cleanTask === null, autoPawn.id);
    await priority(autoPawn, 1); await click('1倍速');
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).cleanTask?.progress > 0, autoPawn.id); await click('暂停');
    const scheduled = (await state()).snapshot.pawns.find(p => p.id === autoPawn.id); await selectColonist(autoPawn.id);
    assert.equal(await page.getByTestId('cleaning-status').getAttribute('data-filth-id'), String(scheduled.cleanTask.filthId));
    check('visible cleaning priority releases the prior task then re-enables automatic scheduling and actual on-cell work', { pawnId: autoPawn.id, filthId: scheduled.cleanTask.filthId, progress: scheduled.cleanTask.progress });

    await load(`${FIXTURES}/poisoned.json`); const firstIllness = await diagnosed(campaign.patientId);
    await shot('food-poisoning-initial', page.getByTestId('food-poisoning-detail'));
    const illnessFile = await exportThroughUI('diagnosed'); await load(illnessFile);
    assert.deepEqual((await save()).pawns.find(p => p.id === campaign.patientId).foodPoisoning, firstIllness.illness);
    check('illness panel shows diagnosed stage actual recovery progress and capacities without exposing unconsumed meal contamination', { patientId: campaign.patientId, ...firstIllness.illness });

    if (campaign.fixtures['vomit-ready']) {
      await load(`${FIXTURES}/vomit-ready.json`); const before = await diagnosed(campaign.patientId), oldFilth = (await state()).snapshot.filth;
      assert(before.illness.nextVomitTick - before.tick <= 300, 'bounded real vomit checkpoint');
      await click('3倍速'); await wait(({ id, next }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).foodPoisoning?.nextVomitTick > next,
        { id: campaign.patientId, next: before.illness.nextVomitTick }); await click('暂停');
      const current = (await state()).snapshot, patient = current.pawns.find(p => p.id === campaign.patientId);
      const vomit = current.filth.filter(f => f.kind === 'vomit' && f.amount > (oldFilth.find(q => q.id === f.id)?.amount ?? 0)); assert(vomit.length > 0);
      await diagnosed(campaign.patientId); await shot('actual-vomiting-aftermath', page.getByTestId('food-poisoning-detail'));
      check('normally elapsed diagnosed illness produces real additional vomit filth', { beforeFood: before.pawn.food, afterFood: patient.food, filthIds: vomit.map(f => f.id), stage: patient.foodPoisoning.stage });
    }
    assert(campaign.fixtures['recovery-ready'], 'ordinary near-expiry checkpoint required for bounded recovery verification');
    await load(`${FIXTURES}/recovery-ready.json`); const recovering = await diagnosed(campaign.patientId);
    assert.equal(recovering.illness.stage, 'recovering'); assert(recovering.illness.endsTick - recovering.tick <= 360);
    await shot('food-poisoning-recovering', page.getByTestId('food-poisoning-detail'));
    await click('3倍速'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).foodPoisoning === null, campaign.patientId); await click('暂停');
    await selectColonist(campaign.patientId); assert.equal(await page.getByTestId('food-poisoning-detail').count(), 0);
    check('real recovering stage naturally expires under the visible time control and illness panel disappears', { patientId: campaign.patientId, expectedEnd: recovering.illness.endsTick, observedTick: (await state()).snapshot.tick });

    await page.setViewportSize({ width: 900, height: 700 }); await load(`${FIXTURES}/ready.json`); await openSanitation(); await selectFilth(target.id);
    await shot('narrow-sanitation', page.getByTestId('sanitation-detail'));
    const drawer = await page.getByTestId('sanitation-panel').boundingBox(); assert(drawer && drawer.x >= 0 && drawer.x + drawer.width <= 900 && drawer.y >= 0 && drawer.y + drawer.height <= 700);
    await priority(cleaner, 1); await selectColonist(cleaner.id);
    const avatar = page.locator(`.voxel-colonists button[data-colonist-id="${cleaner.id}"]`); await avatar.scrollIntoViewIfNeeded(); const rect = await avatar.boundingBox();
    assert(rect && rect.x >= 0 && rect.x + rect.width <= 900 && rect.y >= 0);
    check('900 pixel layout retains usable sanitation drawer cleaning controls and colonist portraits');
    await Promise.all(reads); if (!development) { assert(result.assets.length > 0); assert(result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error)); check('served production asset bytes match the local build'); }
    assert.deepEqual(result.errors, []); check('no browser page or console errors');
  } catch (error) { result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, modes: report.modes.map(m => ({ mode: m.mode, checks: m.checks.length, errors: m.errors, failure: m.failure })) }, null, 2));
