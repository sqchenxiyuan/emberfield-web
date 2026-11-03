import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_PENS_URL ?? 'http://127.0.0.1:4178/?world=voxel';
const OUT = process.env.VOXEL_PENS_BROWSER_OUT ?? 'test-results/voxel-pens-browser';
const FIXTURES = process.env.VOXEL_PENS_FIXTURES ?? 'test-results/voxel-pens';
const modes = process.env.VOXEL_PENS_BROWSER_MODE ? [process.env.VOXEL_PENS_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_PENS_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = b => createHash('sha256').update(b).digest('hex');
await mkdir(OUT, { recursive: true });
const bytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(bytes), contract = campaign.browser;
assert.equal(campaign.status, 'passed', 'ordinary campaign must complete before browser evidence');
for (const name of ['handlerId', 'maleId', 'femaleId', 'malePenId', 'femalePenId', 'gateId', 'ropeId', 'hareId', 'areaId', 'plots', 'areaFrom', 'areaTo']) assert(contract[name] !== undefined, name);
const report = { status: 'running', version: campaign.version, startedAt: new Date().toISOString(), base: BASE, development,
  scriptSha256: sha(await readFile(new URL(import.meta.url))), campaign: { file: `${FIXTURES}/report.json`, sha256: sha(bytes) },
  scope: 'Worker and main browser play from SHA-verified ordinary-play saves. All mutations use visible controls, actual canvas pointer drags and file chooser import/export. snapshot/project/exportSave are read-only. Checks actual fences, blueprint timing, gate state, sex filters, attached rope rendering and movement, normal rabbit area return, persisted editing, and 900px layout. No state injection.', modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const key = p => (p.z * 64 + p.y) * 64 + p.x;

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
    reads.push(response.body().then(async b => { asset.sha256 = sha(b); asset.bytes = b.length; asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256; }).catch(e => { asset.error = String(e); }));
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const saved = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = name => page.getByRole('button', { name, exact: true });
  const click = async name => { await button(name).scrollIntoViewIfNeeded(); await button(name).click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    if (/^[123]倍速$/.test(name)) await wait(speed => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
  };
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  const settle = async () => { await page.waitForTimeout(200); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
  const zoomDetail = async () => { await page.mouse.move(720, 420); await page.mouse.wheel(0, -600); await settle(); };
  const panel = async (tab = '动物') => { if (!await page.getByTestId('wildlife-panel').isVisible()) await click('野生动物与狩猎'); await page.getByRole('tab', { name: tab, exact: true }).click(); };
  const closePanel = async () => { if (await page.getByTestId('wildlife-panel').isVisible()) await click('关闭野生动物面板'); };
  const animal = async id => (await state()).snapshot.animals.find(a => a.id === id);
  const screen = p => page.evaluate(p => window.voxel.project(p), p);
  async function shot(name, locator) { if (locator) await locator.evaluate(el => el.scrollIntoView({ block: 'start' })); await settle(); const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file); }
  async function load(file, evidence) {
    const raw = await readFile(file), data = JSON.parse(raw);
    if (evidence) { assert.equal(sha(raw), evidence.sha256); assert.equal(data.tick, evidence.tick); }
    result.fixtures.push({ file, sha256: sha(raw), tick: data.tick, campaignFixture: !!evidence });
    await closePanel(); await page.keyboard.press('Escape'); await click('菜单与存档'); const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, data.tick);
    assert.equal((await state()).snapshot.speed, 0); await settle(); return data;
  }
  async function fixture(name) { const evidence = campaign.fixtures[name]; assert(evidence, name); let file = path.resolve(evidence.file); try { await access(file); } catch { file = path.resolve(FIXTURES, path.basename(evidence.file)); } return load(file, evidence); }
  async function locateAnimal(id) {
    await panel(); const row = page.locator(`.voxel-wildlife-list section[data-animal-id="${id}"]`); await row.getByRole('button', { name: /^定位 / }).click(); await closePanel();
    await wait(id => document.querySelector('[data-testid="animal-detail"]')?.getAttribute('data-animal-id') === String(id), id); await settle(); return page.getByTestId('animal-detail');
  }
  async function locatePen(id) {
    await panel('圈地与范围'); const card = page.getByTestId('pen-panel').locator(`[data-pen-id="${id}"]`); await card.getByRole('button', { name: '定位标记', exact: true }).click(); await closePanel();
    await wait(id => document.querySelector('.voxel-inspector [data-testid="pen-detail"]')?.getAttribute('data-pen-id') === String(id), id); await settle(); return page.locator('.voxel-inspector').getByTestId('pen-detail');
  }
  async function roundtrip(name) {
    const before = await saved(); await closePanel(); await click('菜单与存档'); const download = page.waitForEvent('download'); await click('导出体素存档'); const file = `${OUT}/${mode}-${name}-roundtrip.json`; await (await download).saveAs(file); await click('关闭菜单'); await load(file);
    const after = await saved(); for (const field of ['fences', 'fenceGates', 'penMarkers', 'animalAreas', 'animals']) assert.deepEqual(after[field], before[field], field);
    assert.deepEqual(after.pawns.map(p => p.ropeTask), before.pawns.map(p => p.ropeTask)); return after;
  }
  async function runUntil(fn, arg, timeout = 60000) { await click('3倍速'); await wait(fn, arg, timeout); await click('暂停'); }
  async function mapClick(p) { const q = await screen(p); assert(q.x > 340 && q.x < 1390 && q.y > 160 && q.y < 760, `map point unobscured: ${JSON.stringify(q)}`); await page.mouse.click(q.x, q.y); await settle(); }
  async function drag(from, to, previewCheck = true, previewName) {
    const a = await screen(from), b = await screen(to); for (const q of [a, b]) assert(q.x > 340 && q.x < 1390 && q.y > 160 && q.y < 760, `drag point unobscured: ${JSON.stringify(q)}`);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 10 });
    if (previewCheck) { await page.getByTestId('placement-preview-info').waitFor(); await wait(() => (window.voxel.snapshot().metrics.pens?.previewParts ?? 0) > 0); }
    if (previewName) await shot(previewName);
    await page.mouse.up(); await settle();
  }
  async function focusGround(p) {
    await closePanel(); await click('查看');
    while ((await state()).level < p.z) await click('上移一层');
    while ((await state()).level > p.z) await click('下移一层');
    await settle();
    for (let n = 0; n < 4; n++) { const q = await screen(p); if (q.x > 340 && q.x < 1390 && q.y > 160 && q.y < 760) break; await page.mouse.move(720, 400); await page.mouse.wheel(0, 350); await settle(); }
    await mapClick(p); await click('⌖ 对焦此处'); await settle();
  }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot); await click('暂停');
    if (await button('收起指引').isVisible()) await click('收起指引'); assert.equal((await state()).worker, mode === 'worker');
    await fixture('ready');
    const origin = contract.plots[0].origin;
    await focusGround(origin); await click('围栏');
    const to = { ...origin, x: origin.x + 2, y: origin.y + 1 };
    await drag(origin, to, true, 'fence-drag-preview'); const fencePlans = (await state()).snapshot.jobs.filter(j => j.kind === 'fence');
    assert.equal(fencePlans.length, 3); assert(fencePlans.every(j => j.y === origin.y && j.z === origin.z)); assert.equal((await state()).snapshot.fences.length, 0);
    check('canvas fence drag previews and creates a straight three-cell line without instant structures'); await shot('fence-preview-plans');
    await click('栏门'); const gatePos = contract.plots[0].gate; await mapClick(gatePos); await wait(() => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'fenceGate'));
    await click('圈地标记'); await mapClick(contract.plots[0].marker); await wait(() => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'penMarker'));
    check('visible gate and marker tools place actual construction jobs');

    await fixture('gaps'); const gapCard = await locatePen(contract.malePenId); assert.equal(await gapCard.getAttribute('data-closed'), 'false'); assert((await gapCard.innerText()).includes('修补围栏'));
    await shot('unfinished-enclosure', gapCard); check('one unfinished boundary is clearly reported as open with repair guidance');
    await fixture('penned'); const penCard = await locatePen(contract.malePenId); assert.equal(await penCard.getAttribute('data-closed'), 'true');
    await wait(id => window.voxel.snapshot().metrics.pens?.selectedPenId === id && window.voxel.snapshot().metrics.pens.overlayCells > 0, contract.malePenId);
    const summary = (await state()).snapshot.penSummaries.find(p => p.markerId === contract.malePenId); assert((await penCard.innerText()).includes(summary.grassNutrition.toFixed(2))); assert((await penCard.innerText()).includes(summary.nutritionPerDay.toFixed(2)));
    const marker = (await state()).snapshot.penMarkers.find(m => m.id === contract.malePenId); await click('清除选择'); await mapClick({ ...marker, z: marker.z + .92 });
    assert.equal(await page.locator('.voxel-inspector').getByTestId('pen-detail').getAttribute('data-pen-id'), String(marker.id));
    await shot('closed-pen-and-nutrition', page.locator('.voxel-inspector').getByTestId('pen-detail')); check('physical marker is canvas-selectable and exposes authoritative enclosure nutrition and overlay');
    const gate = (await state()).snapshot.fenceGates.find(g => g.id === contract.gateId); await mapClick({ ...gate, z: gate.z + .45 }); await page.getByTestId('fence-gate-detail').waitFor();
    await page.getByRole('combobox', { name: '栏门状态' }).selectOption('open'); await wait(id => !window.voxel.snapshot().snapshot.penSummaries.find(p => p.markerId === id).closed, contract.malePenId);
    assert((await page.getByTestId('fence-gate-detail').innerText()).includes('打开圈地边界')); await shot('open-gate');
    await page.getByRole('combobox', { name: '栏门状态' }).selectOption('auto'); await wait(id => window.voxel.snapshot().snapshot.penSummaries.find(p => p.markerId === id).closed, contract.malePenId);
    check('actual gate mesh inspection and visible mode selector re-evaluate containment');
    const filterCard = await locatePen(contract.femalePenId); await filterCard.getByRole('checkbox', { name: '母鹿牧场 接纳雄性' }).click(); await wait(id => window.voxel.snapshot().snapshot.penMarkers.find(m => m.id === id).filter.male, contract.femalePenId);
    assert(await filterCard.getByRole('checkbox', { name: '母鹿牧场 接纳雄性' }).isChecked());
    await filterCard.getByRole('checkbox', { name: '母鹿牧场 接纳雄性' }).click(); await wait(id => !window.voxel.snapshot().snapshot.penMarkers.find(m => m.id === id).filter.male, contract.femalePenId);
    assert.equal(await filterCard.getByRole('checkbox').count(), 3); check('species and sex filters are editable with only the implemented deer male and female rules');

    await fixture('attaching'); const attaching = (await state()).snapshot.pawns.find(p => p.ropeTask?.stage === 'attach'); await locateAnimal(attaching.ropeTask.animalId);
    await zoomDetail();
    await wait(() => window.voxel.snapshot().metrics.pens?.ropeSegments === 0); await shot('attaching-without-premature-rope'); check('approach and attachment display actual handler status without a premature rope line');
    await fixture('leading'); await locateAnimal(contract.ropeId); await wait(() => window.voxel.snapshot().metrics.pens?.ropeSegments > 0);
    await zoomDetail();
    const detail = page.getByTestId('animal-detail'); assert.equal(await detail.getByTestId('animal-status').getAttribute('data-stage'), 'lead'); await shot('real-leading-rope', detail);
    const leadingSaved = await roundtrip('leading'); const before = leadingSaved.animals.find(a => a.id === contract.ropeId); await locateAnimal(contract.ropeId);
    await wait(() => window.voxel.snapshot().metrics.pens?.ropeSegments > 0);
    await runUntil(({ id, x, y, z }) => { const a = window.voxel.snapshot().snapshot.animals.find(a => a.id === id); return a.x !== x || a.y !== y || a.z !== z; }, before);
    const target = await animal(contract.ropeId); assert.notEqual(key(target), key(before)); check('leading save export/import preserves rope and ordinary elapsed play visibly moves the same animal');
    await fixture('leading'); await locateAnimal(contract.ropeId); const ropeAnimal = await animal(contract.ropeId); await click(`暂停牵引 ${ropeAnimal.name}`); await wait(id => !window.voxel.snapshot().snapshot.pawns.some(p => p.ropeTask?.animalId === id), contract.ropeId);
    assert.equal(key(await animal(contract.ropeId)), key(ropeAnimal)); await wait(() => window.voxel.snapshot().metrics.pens?.ropeSegments === 0);
    await click(`恢复牵引 ${ropeAnimal.name}`); await wait(id => !window.voxel.snapshot().snapshot.animals.find(a => a.id === id).ropePaused, contract.ropeId); check('visible pause releases a rope in place and resume restores scheduling');

    await fixture('area-assigned'); await locatePen(contract.malePenId); await panel('圈地与范围');
    await page.getByRole('textbox', { name: '新活动范围名称' }).fill('浏览器兔区'); await page.getByRole('button', { name: '创建并涂绘', exact: true }).click();
    await wait(() => window.voxel.snapshot().tool === 'animalArea' && window.voxel.snapshot().snapshot.animalAreas.some(a => a.name === '浏览器兔区'));
    const newId = (await state()).snapshot.animalAreas.find(a => a.name === '浏览器兔区').id; await closePanel();
    const from = contract.areaFrom, rectTo = { ...from, x: from.x + 2, y: from.y + 1 };
    await drag(from, rectTo, true, 'area-rectangle-preview'); await wait(id => window.voxel.snapshot().snapshot.animalAreas.find(a => a.id === id)?.cells.length === 6, newId);
    const toolbar = page.getByTestId('area-edit-toolbar'); await toolbar.getByRole('button', { name: '擦除', exact: true }).click(); await drag(from, from);
    await wait(id => window.voxel.snapshot().snapshot.animalAreas.find(a => a.id === id)?.cells.length === 5, newId);
    await toolbar.getByRole('button', { name: '结束', exact: true }).click(); await wait(() => window.voxel.snapshot().tool === 'inspect');
    await panel('圈地与范围'); const newArea = page.getByTestId('pen-panel').locator(`[data-area-id="${newId}"]`);
    const nameInput = newArea.getByRole('textbox', { name: `活动范围名称 ${newId}` }); await nameInput.fill('浏览器兔区 · 编辑后'); await nameInput.press('Enter');
    await wait(id => window.voxel.snapshot().snapshot.animalAreas.find(a => a.id === id).name === '浏览器兔区 · 编辑后', newId);
    await shot('painted-and-erased-area', newArea); check('area creation rectangle paint erase and rename use real visible canvas and form controls');
    await roundtrip('edited-area'); assert.equal((await state()).snapshot.animalAreas.find(a => a.id === newId).cells.length, 5); check('edited activity cells and names survive visible export/import');

    await fixture('area-assigned'); await locateAnimal(contract.hareId); const hare = await animal(contract.hareId);
    const assignment = page.getByTestId('animal-detail').getByRole('combobox', { name: `${hare.name} 活动范围` }); await assignment.selectOption(''); await wait(id => window.voxel.snapshot().snapshot.animals.find(a => a.id === id).allowedAreaId === null, hare.id);
    await assignment.selectOption(String(contract.areaId)); await wait(({ id, areaId }) => window.voxel.snapshot().snapshot.animals.find(a => a.id === id).allowedAreaId === areaId, { id: hare.id, areaId: contract.areaId });
    assert.equal(key(await animal(hare.id)), key(hare)); await shot('rabbit-return-start', page.getByTestId('animal-detail'));
    await runUntil(({ id, areaId }) => { const s = window.voxel.snapshot().snapshot, a = s.animals.find(a => a.id === id); return s.animalAreas.find(a => a.id === areaId).cells.includes((a.z * 64 + a.y) * 64 + a.x); }, { id: hare.id, areaId: contract.areaId }, 120000);
    check('visible rabbit assignment preserves position then normal simulation walks it into its permitted area'); await shot('rabbit-returned');

    await page.setViewportSize({ width: 900, height: 700 }); await fixture('area-edited'); await panel('圈地与范围');
    const drawer = await page.getByTestId('wildlife-panel').boundingBox(); assert(drawer && drawer.x >= 0 && drawer.x + drawer.width <= 900 && drawer.y >= 0 && drawer.y + drawer.height <= 700);
    const narrowArea = page.getByTestId('pen-panel').locator(`[data-area-id="${contract.areaId}"]`); await narrowArea.getByRole('button', { name: '擦除', exact: true }).scrollIntoViewIfNeeded();
    const bounds = await narrowArea.getByRole('button').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom }; })); assert(bounds.every(b => b.x >= 0 && b.right <= 900 && b.y >= 0 && b.bottom <= 700));
    await shot('narrow-pen-management'); check('900 pixel layout keeps pen and activity range controls accessible', { drawer, bounds });
    await narrowArea.getByRole('button', { name: '删除范围', exact: true }).click(); await wait(id => !window.voxel.snapshot().snapshot.animalAreas.some(a => a.id === id), contract.areaId);
    assert.equal((await animal(contract.hareId)).allowedAreaId, null); check('visible area deletion clears rabbit assignment');
    await Promise.all(reads);
    if (!development) { assert(result.assets.length > 0); assert(result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error)); check('all served production JS and CSS assets match the current build by SHA'); }
    assert.deepEqual(result.errors, []); check('no page or console errors');
  } catch (error) { result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, modes: report.modes.map(m => ({ mode: m.mode, checks: m.checks.length, errors: m.errors, failure: m.failure })) }, null, 2));
