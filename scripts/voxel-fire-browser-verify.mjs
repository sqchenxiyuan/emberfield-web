import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_FIRE_URL ?? 'http://127.0.0.1:4178/?world=voxel';
const OUT = process.env.VOXEL_FIRE_BROWSER_OUT ?? 'test-results/voxel-fire-browser';
const FIXTURES = process.env.VOXEL_FIRE_FIXTURES ?? 'test-results/voxel-fire';
const modes = process.env.VOXEL_FIRE_BROWSER_MODE ? [process.env.VOXEL_FIRE_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_FIRE_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const at = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z);
await mkdir(OUT, { recursive: true });
const campaignBytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(campaignBytes);
assert.equal(campaign.status, 'passed', 'ordinary fire campaign must finish first');
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE, development,
  scope: 'Bounded v26 fire and repair UI verification in Worker and main renderers. All mutations use ordinary visible controls and file chooser import/export. snapshot/project/exportSave are read-only. Imported checkpoints come from the hash-checked ordinary fresh-colony campaign. This script never ignites fire, edits damage, resources, actors, clocks or saves. Fire and repair tuning is provisional; displayed heat and damage are actual state, not a probability or heat calibration.',
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
    const bytes = await readFile(file), data = JSON.parse(bytes);
    if (path.resolve(path.dirname(file)) === path.resolve(FIXTURES)) {
      const evidence = campaign.fixtures[path.basename(file, '.json')]; assert(evidence, 'campaign fixture provenance'); assert.equal(sha(bytes), evidence.sha256);
    }
    result.fixtures.push({ file, sha256: sha(bytes), version: data.version, tick: data.tick });
    await click('菜单与存档'); const choosing = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await choosing).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, data.tick); await settle(); return data;
  }
  async function openFire() { if (!await page.getByTestId('fire-panel').isVisible()) await click('火灾与修理'); }
  async function selectColonist(id) {
    const p = (await state()).snapshot.pawns.find(p => p.id === id); assert.equal(p?.faction, 'colony');
    const target = page.locator(`.voxel-colonists button[data-colonist-id="${id}"]`); await target.scrollIntoViewIfNeeded(); await target.click();
    await page.getByTestId('mood-panel').waitFor(); await settle(); return p;
  }
  async function selectFire(id) {
    await openFire(); await click(`查看火点 #${id}`); await page.getByTestId('fire-detail').waitFor(); await settle();
    const f = (await state()).snapshot.fires.find(f => f.id === id); assert(f);
    assert.equal(at((await state()).selected), at(f)); return f;
  }
  async function selectDamage(key) {
    await openFire(); await click(`查看受损结构 ${key}`); await page.getByTestId('fire-damage-detail').waitFor(); await settle();
    const d = (await state()).snapshot.fireDamage.find(d => d.key === key); assert(d); return d;
  }
  async function priority(pawn, work, value) {
    await openFire(); const section = page.locator('.voxel-fire-workers');
    if (await section.getAttribute('open') === null) await section.locator('summary').click();
    await page.getByLabel(`${pawn.name} 火灾面板${work === 'firefight' ? '灭火' : '施工'}优先级`, { exact: true }).selectOption(String(value));
    await wait(({ id, work, value }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).priorities[work] === value, { id: pawn.id, work, value });
  }
  async function exportThroughUI(name) {
    await click('菜单与存档'); const downloading = page.waitForEvent('download'); await click('导出体素存档');
    const file = `${OUT}/${mode}-${name}.json`; await (await downloading).saveAs(file); await click('关闭菜单'); return file;
  }
  function damageRow(key) { return page.getByTestId('fire-damage-detail').locator(`[data-damage-key="${key}"]`); }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot);
    await click('暂停'); if (await button('收起指引').isVisible()) await click('收起指引'); assert.equal((await state()).worker, mode === 'worker');

    const active = await load(`${FIXTURES}/fire-active.json`), fire = active.fires.find(f => f.id === campaign.fireId); assert(fire);
    const preferred = active.pawns.find(p => p.id === campaign.firefighterId); assert(preferred);
    // Choose an existing mobile colonist who really needs to approach; no position edits.
    const actor = distance(preferred, fire) > 1 ? preferred : active.pawns.filter(p => p.faction === 'colony' && !p.dead && !p.downed && !p.drafted && distance(p,fire)>1)
      .sort((a,b) => distance(a,fire)-distance(b,fire))[0]; assert(actor, 'ordinary colony must provide a worker who physically approaches');
    await selectFire(fire.id); assert.equal(Number(await page.getByTestId('fire-alert').getAttribute('data-active-fires')), active.fires.length);
    assert(!active.homeArea.includes(at(fire))); assert(await button(`优先灭火 #${fire.id}`).isDisabled());
    assert.equal(Number(await page.getByRole('progressbar', { name: `火点 #${fire.id} 火势`, exact: true }).getAttribute('value')), fire.size);
    assert.match(await page.getByTestId('fire-detail').innerText(), /当前环境 [\d.-]+°C/);
    await shot('outside-home-fire', page.getByTestId('fire-detail'));
    check('real fire alarm strength temperature and outside-home manual restriction are visible', { fireId: fire.id, size: fire.size, source: fire.source });

    const calendar = structuredClone((await save()).fireHazards);
    if ((await state()).snapshot.fireHazards.enabled) await page.getByLabel('允许新的火灾事件', { exact: true }).click();
    await wait(() => !window.voxel.snapshot().snapshot.fireHazards.enabled);
    const disabled = (await save()).fireHazards; assert.equal(disabled.nextIncidentTick, calendar.nextIncidentTick);
    assert.deepEqual(disabled.events, calendar.events); assert((await state()).snapshot.fires.some(f => f.id === fire.id));
    await click('将火点加入家园范围'); await wait(index => window.voxel.snapshot().snapshot.homeArea.includes(index), at(fire));
    await priority(actor, 'firefight', 0); await selectFire(fire.id);
    await page.getByLabel('灭火执行者', { exact: true }).selectOption(String(actor.id)); await click(`优先灭火 #${fire.id}`);
    await wait(({ id, fireId }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).firefightTask?.fireId === fireId, { id: actor.id, fireId: fire.id });
    const assigned = (await state()).snapshot.pawns.find(p => p.id === actor.id); assert.equal(assigned.firefightTask.progress, 0); assert(assigned.path.length > 0);
    await selectColonist(actor.id); assert((await page.getByTestId('firefight-status').innerText()).includes('前往灭火'));
    await shot('approaching-fire', page.getByTestId('firefight-status'));
    await click('3倍速'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).firefightTask?.progress > 0, actor.id); await click('暂停');
    const reached = (await state()).snapshot.pawns.find(p => p.id === actor.id), liveFire = (await state()).snapshot.fires.find(f => f.id === fire.id);
    assert(liveFire && distance(reached, liveFire) <= 1 && reached.path.length === 0);
    await selectColonist(actor.id); assert((await page.getByTestId('firefight-status').innerText()).includes('正在拍打灭火'));
    assert.equal(Number(await page.getByRole('progressbar', { name: '本次灭火拍打进度', exact: true }).getAttribute('value')), reached.firefightTask.progress);
    await page.mouse.move(720,430); await page.mouse.wheel(0,-500); await shot('actual-firefighting', page.getByTestId('firefight-status'));
    check('disabling future incidents preserves existing flames and Home/manual order causes actual travel then touch-range beating', { actorId: actor.id, pathCells: assigned.path.length, progress: reached.firefightTask.progress });

    // Arrival can precede the first real damage interval; progress until the actual structure is damaged.
    if (!(await state()).snapshot.fireDamage.some(d => d.key === campaign.damageKey)) {
      await click('1倍速'); await wait(key => window.voxel.snapshot().snapshot.fireDamage.some(d => d.key === key), campaign.damageKey); await click('暂停');
    }
    const burningDamage = (await state()).snapshot.fireDamage.find(d => d.key === campaign.damageKey);
    assert(burningDamage && burningDamage.hitPoints < burningDamage.maxHitPoints, 'actual fire damage before extinction');
    await selectDamage(burningDamage.key); assert.equal(Number(await damageRow(burningDamage.key).getAttribute('data-hit-points')), burningDamage.hitPoints);
    assert(await button(`优先修理 ${burningDamage.key}`).isDisabled()); assert((await damageRow(burningDamage.key).innerText()).includes('仍在燃烧'));
    check('actual surviving structure durability is visible and burning structure cannot be repaired', { damageKey: burningDamage.key, hitPoints: burningDamage.hitPoints, maxHitPoints: burningDamage.maxHitPoints });

    const midFile = await exportThroughUI('mid-firefight'), mid = await load(midFile), restored = await save();
    assert.deepEqual(restored.fires, mid.fires); assert.deepEqual(restored.fireDamage, mid.fireDamage); assert.deepEqual(restored.fireHazards, mid.fireHazards);
    assert.deepEqual(restored.pawns.find(p => p.id === actor.id).firefightTask, mid.pawns.find(p => p.id === actor.id).firefightTask);
    await selectColonist(actor.id); await click('取消本次灭火'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).firefightTask === null, actor.id);
    assert((await state()).snapshot.fires.some(f => f.id === fire.id));
    await priority(actor, 'firefight', 1); await click('1倍速');
    await wait(({ id, fireId }) => { const t = window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).firefightTask; return t?.fireId === fireId && t.progress > 0; }, { id: actor.id, fireId: fire.id });
    await click('暂停'); const beforeBeat = (await state()).snapshot.fires.find(f => f.id === fire.id); assert(beforeBeat);
    await click('3倍速'); await wait(({ id, size }) => { const f = window.voxel.snapshot().snapshot.fires.find(f => f.id === id); return f && f.size < size; }, { id: fire.id, size: beforeBeat.size }); await click('暂停');
    const beaten = (await state()).snapshot.fires.find(f => f.id === fire.id); assert(beaten.size < beforeBeat.size);
    check('save/import keeps exact fire tasks damage and incident calendar; cancel preserves fire; visible priority schedules real beating that reduces strength', { before: beforeBeat.size, after: beaten.size });
    await click('3倍速'); await wait(id => !window.voxel.snapshot().snapshot.fires.some(f => f.id === id), fire.id); await click('暂停');
    assert((await state()).snapshot.fireDamage.some(d => d.key === campaign.damageKey));
    await selectDamage(campaign.damageKey); assert(!await button(`优先修理 ${campaign.damageKey}`).isDisabled());
    await shot('extinguished-with-damage', page.getByTestId('fire-damage-detail'));
    check('continuing actual firefighting extinguishes the selected flame while surviving structural damage remains');

    const out = await load(`${FIXTURES}/fire-out.json`), repairer = out.pawns.find(p => p.id === campaign.firefighterId); assert(repairer);
    const damage = await selectDamage(campaign.damageKey); assert(damage.hitPoints > 0 && damage.hitPoints < damage.maxHitPoints);
    const join = button(`将受损结构加入家园 ${damage.key}`); if (await join.count()) await click(`将受损结构加入家园 ${damage.key}`);
    await priority(repairer, 'build', 0); await selectDamage(damage.key);
    await page.getByLabel('修理执行者', { exact: true }).selectOption(String(repairer.id)); await click(`优先修理 ${damage.key}`);
    await wait(({ id, key }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).repairTask?.damageKey === key, { id: repairer.id, key: damage.key });
    await click('1倍速'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).repairTask?.progress > 0, repairer.id); await click('暂停');
    const repairing = (await state()).snapshot.pawns.find(p => p.id === repairer.id); assert.equal(repairing.path.length, 0);
    await selectColonist(repairer.id); assert((await page.getByTestId('repair-status').innerText()).includes('正在修理'));
    assert.equal(Number(await page.getByRole('progressbar', { name: '本点耐久修理进度', exact: true }).getAttribute('value')), repairing.repairTask.progress);
    await page.mouse.move(720,430); await page.mouse.wheel(0,-500); await shot('actual-repair', page.getByTestId('repair-status'));
    const repairFile = await exportThroughUI('mid-repair'), savedRepair = await load(repairFile), loadedRepair = await save();
    assert.deepEqual(loadedRepair.fireDamage, savedRepair.fireDamage);
    assert.deepEqual(loadedRepair.pawns.find(p => p.id === repairer.id).repairTask, savedRepair.pawns.find(p => p.id === repairer.id).repairTask);
    await selectColonist(repairer.id); await click('取消本次修理'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).repairTask === null, repairer.id);
    await selectDamage(damage.key); await page.getByLabel('修理执行者', { exact: true }).selectOption(String(repairer.id));
    const beforeRepair = await save(), beforeHp = beforeRepair.fireDamage.find(d => d.key === damage.key).hitPoints;
    await click(`优先修理 ${damage.key}`); await click('3倍速');
    await wait(({ key, hp }) => { const d = window.voxel.snapshot().snapshot.fireDamage.find(d => d.key === key); return d && d.hitPoints > hp; }, { key: damage.key, hp: beforeHp }); await click('暂停');
    const repairedPart = await save(), afterHp = repairedPart.fireDamage.find(d => d.key === damage.key).hitPoints;
    assert(afterHp > beforeHp); assert.equal(repairedPart.stats.consumed.steel, beforeRepair.stats.consumed.steel); assert.equal(repairedPart.stats.consumed.components, beforeRepair.stats.consumed.components);
    check('visible manual repair works with automatic construction disabled; actual progress survives save and cancel; resumed work restores HP without steel or components', { beforeHp, afterHp, actorId: repairer.id });

    const near = await load(`${FIXTURES}/repair-near-complete.json`), nearDamage = near.fireDamage.find(d => d.key === campaign.damageKey);
    assert(nearDamage && nearDamage.maxHitPoints-nearDamage.hitPoints <= 2, 'bounded normally progressed repair checkpoint');
    const nearWorker = near.pawns.find(p => p.repairTask?.damageKey === campaign.damageKey); assert(nearWorker);
    await selectColonist(nearWorker.id); await click('3倍速'); await wait(key => !window.voxel.snapshot().snapshot.fireDamage.some(d => d.key === key), campaign.damageKey); await click('暂停');
    const full = await save(); assert(full.devices.some(d => d.id === campaign.generatorId && d.watts > 0));
    assert.deepEqual(full.stats.destroyed, near.stats.destroyed); assert.equal(full.pawns.find(p => p.id === nearWorker.id).repairTask, null);
    await selectColonist(nearWorker.id); assert.equal(await page.getByTestId('repair-status').count(), 0);
    check('normal remaining repair clears damage/task on surviving infrastructure while the original generator stays powered', { generatorId: campaign.generatorId, damageKey: campaign.damageKey });

    await page.setViewportSize({ width: 900, height: 700 }); await load(`${FIXTURES}/fire-active.json`); await selectFire(fire.id);
    await shot('narrow-fire', page.getByTestId('fire-detail'));
    const drawer = await page.getByTestId('fire-panel').boundingBox(); assert(drawer && drawer.x >= 0 && drawer.x+drawer.width <= 900 && drawer.y >= 0 && drawer.y+drawer.height <= 700);
    await priority(preferred, 'firefight', 1); await selectColonist(preferred.id);
    const avatar = page.locator(`.voxel-colonists button[data-colonist-id="${preferred.id}"]`); await avatar.scrollIntoViewIfNeeded(); const rect = await avatar.boundingBox();
    assert(rect && rect.x >= 0 && rect.x+rect.width <= 900 && rect.y >= 0);
    check('900 pixel layout retains usable fire alert drawer work controls and colony portraits');
    await Promise.all(reads); if (!development) { assert(result.assets.length > 0); assert(result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error)); check('served production asset bytes match the local build'); }
    assert.deepEqual(result.errors, []); check('no browser page or console errors');
  } catch (error) { result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, modes: report.modes.map(m => ({ mode: m.mode, checks: m.checks.length, errors: m.errors, failure: m.failure })) }, null, 2));
