import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_RELOCATION_URL ?? 'http://127.0.0.1:4182/?world=voxel';
const OUT = process.env.VOXEL_RELOCATION_BROWSER_OUT ?? 'test-results/voxel-relocation-browser';
const FIXTURES = process.env.VOXEL_RELOCATION_FIXTURES ?? 'test-results/voxel-relocation';
const modes = process.env.VOXEL_RELOCATION_BROWSER_MODE ? [process.env.VOXEL_RELOCATION_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_RELOCATION_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = b => createHash('sha256').update(b).digest('hex');
await mkdir(OUT, { recursive: true });
const bytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(bytes), contract = campaign.browser;
assert.equal(campaign.status, 'passed', 'fresh ordinary-play campaign required');
const manifest = await readFile(`${FIXTURES}/source-manifest.json`); assert.equal(sha(manifest), campaign.execution.sourceManifestSha256);
for (const entry of JSON.parse(manifest)) assert.equal(sha(await readFile(entry.file)), entry.sha256, `campaign source is current: ${entry.file}`);
const report = { status: 'running', startedAt: new Date().toISOString(), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${FIXTURES}/report.json`, sha256: sha(bytes), sourceManifestSha256: campaign.execution.sourceManifestSha256 },
  scope: 'Worker and main renderer evidence from current SHA-verified fresh v34 ordinary-play saves. Mutations use visible buttons, keyboard, map input, file chooser and download. snapshot/project/exportSave are read-only. Exercises installed move/uninstall, packed attributes/install, bed ghost, rotation, cross-layer selection, Esc, refusal reason, linked stages/cancel, physical cargo, exact save/load, actual destination sleep/dining and narrow layout. No state injection.', modes: [] };
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
  async function furnitureDetails(id) { await wait(id => [...document.querySelectorAll('[data-testid="furniture-quality"]')].some(e => e.getAttribute('data-furniture-id') === String(id)), id); }
  async function currentFurniture(id, itemId) { await wait(({ id, itemId }) => { const e = document.querySelector('[data-testid="current-furniture"]'); return e?.getAttribute('data-pawn-id') === String(id) && e.getAttribute('data-furniture-id') === String(itemId); }, { id, itemId }); }
  async function selectBed(id) {
    await click('囚犯与招募'); const list = page.getByTestId('prison-panel').locator('details').filter({ has: page.locator('summary').filter({ hasText: '床位设置' }) });
    await list.locator('summary').click(); await list.getByRole('button', { name: `木床 #${id}`, exact: true }).click(); await click('关闭囚犯面板'); await furnitureDetails(id);
  }
  async function runUntil(fn, arg, timeout = 60000) { await click('3倍速'); await wait(fn, arg, timeout); await click('暂停'); }
  async function assertStats(id) {
    await furnitureDetails(id); const expected = contract.qualities.find(q => q.id === id), panel = page.locator('[data-testid="furniture-quality"][data-furniture-id="' + id + '"]').first();
    assert(expected); assert.equal(await panel.getAttribute('data-quality'), String(expected.quality)); assert.equal(await panel.getAttribute('data-kind'), expected.kind);
    assert.equal(await panel.getByTestId('furniture-quality-name').textContent(), expected.stats.qualityName);
    assert.equal(Number(await panel.getByTestId('furniture-hit-points').getAttribute('data-max')), expected.stats.maxHitPoints);
    assert.equal(Number(await panel.getByTestId('furniture-hit-points').getAttribute('data-current')), expected.stats.maxHitPoints);
    assert.equal(Number(await panel.getByTestId('furniture-beauty').getAttribute('data-value')), expected.stats.beauty);
    assert.equal(Number(await panel.getByTestId('furniture-value').getAttribute('data-value')), expected.value);
    for (const [field, testId] of [['comfort', 'furniture-comfort'], ['restEffectiveness', 'furniture-rest']]) {
      if (expected.stats[field] === null) assert.equal(await panel.getByTestId(testId).count(), 0);
      else assert.equal(Number(await panel.getByTestId(testId).getAttribute('data-value')), expected.stats[field]);
    }
    assert(!/品质.*耐久.*提高|舒适上限/.test(await panel.textContent()));
    return expected;
  }
  async function roundtrip(name) {
    const before = await saved(); await click('菜单与存档'); const download = page.waitForEvent('download'); await click('导出体素存档'); const file = `${OUT}/${mode}-${name}-roundtrip.json`; await (await download).saveAs(file); await click('关闭菜单'); await load(file);
    const after = await saved(); for (const f of ['beds', 'tables', 'chairs', 'fireDamage', 'items']) assert.deepEqual(after[f], before[f], f);
    const persistentJobs = jobs => jobs.map(({ owner, reason, ...job }) => job);
    assert.deepEqual(persistentJobs(after.jobs), persistentJobs(before.jobs), 'job targets progress and physical cargo');
    for (const f of ['living', 'psyche', 'cargo', 'skills']) assert.deepEqual(after.pawns.map(p => p[f]), before.pawns.map(p => p[f]), f);
  }
  async function gathering(enabled) {
    const control = page.getByRole('checkbox', { name: '允许聚会', exact: true }); if (await control.isChecked() !== enabled) await control.click();
    await wait(({ id, enabled }) => window.voxel.snapshot().snapshot.tables.find(t => t.id === id).gathering === enabled, { id: contract.tableId, enabled });
    await wait(enabled => document.querySelector('input[aria-label="允许聚会"]')?.checked === enabled, enabled);
  }

  async function level(z) {
    for(let n=0;(await state()).level!==z&&n<16;n++) await click((await state()).level<z?'上移一层':'下移一层');
    assert.equal((await state()).level,z); await settle();
  }
  async function canvasPoint(p) {
    const q=await page.evaluate(p=>window.voxel.project(p),p), rect=await page.locator('canvas[aria-label="多层体素地图"]').boundingBox();
    assert(rect); return {x:rect.x+q.x,y:rect.y+q.y};
  }
  async function hover(p) { const q=await canvasPoint(p); await page.mouse.move(q.x,q.y); await settle(); }
  async function target(p) { const q=await canvasPoint(p); await page.mouse.click(q.x,q.y); await settle(); }
  async function selectItem(p,id,packed=false) {
    await level(p.z);
    const q=await canvasPoint({...p,z:p.z+(packed?.3:.45)});
    for(const [dx,dy] of [[0,0],[0,-7],[6,-5],[-6,-5],[0,7]]) {
      await page.mouse.click(q.x+dx,q.y+dy); await page.waitForTimeout(140);
      if(await page.locator('[data-testid="'+(packed?'packed-furniture':'furniture-quality')+'"][data-furniture-id="'+id+'"]').count()) return;
    }
    throw Error('cannot select visible furniture '+id);
  }
  async function moveBed() {
    await selectBed(contract.bedAId); await page.getByTestId('furniture-move-target').click();
    await wait(id=>window.voxel.snapshot().furniturePlacement?.furnitureId===id,contract.bedAId);
    if((await state()).axis!=='x') await page.keyboard.press('r');
    await level(contract.bedTarget.z); await target(contract.bedTarget);
    await wait(id=>window.voxel.snapshot().snapshot.jobs.some(j=>j.kind==='install'&&j.furnitureId===id),contract.bedAId);
  }
  try {
    await page.goto(url.href); await wait(()=>window.voxel?.snapshot().ready&&!!window.voxel.snapshot().snapshot); await click('暂停');
    if(await button('收起指引').isVisible())await click('收起指引');
    assert.equal((await state()).worker,mode==='worker');check('requested renderer is active');
    await fixture('furnished'); await selectBed(contract.bedAId); await assertStats(contract.bedAId);
    await page.getByTestId('furniture-move-target').click();
    await wait(id=>window.voxel.snapshot().furniturePlacement?.furnitureId===id,contract.bedAId);
    await hover(contract.roomPos); await wait(()=>window.voxel.snapshot().metrics.living?.previewKind==='bed'&&window.voxel.snapshot().metrics.living.previewParts===14);
    const axis=(await state()).axis; await page.keyboard.press('r'); assert.notEqual((await state()).axis,axis);
    await shot('bed-ghost-rotated');
    const footerBounds = await page.locator('.voxel-footer').boundingBox(), targetingBounds = await page.locator('.voxel-tool-hint').boundingBox();
    assert(targetingBounds.y >= footerBounds.y && targetingBounds.y + targetingBounds.height <= footerBounds.y + footerBounds.height);
    for (const selector of ['.voxel-tool-hint .voxel-kicker', '.voxel-tool-hint p', '[data-testid="furniture-placement-cancel"]']) {
      const bounds = await page.locator(selector).boundingBox(); assert(bounds.y >= targetingBounds.y && bounds.y + bounds.height <= targetingBounds.y + targetingBounds.height + 1, selector + ' fits targeting toolbar');
    }
    const sourceLevel=(await state()).level; await click('上移一层');
    assert.equal((await state()).furniturePlacement.furnitureId,contract.bedAId); assert.equal((await state()).placementPreview,null);
    await page.keyboard.press('['); await wait(z=>window.voxel.snapshot().level===z,sourceLevel);
    await target(contract.tablePos);
    await page.getByTestId('furniture-placement-error').waitFor(); assert.equal((await state()).furniturePlacement.furnitureId,contract.bedAId);
    assert(!(await state()).snapshot.jobs.some(j=>j.furnitureId===contract.bedAId)); await shot('invalid-target-reason');
    await page.keyboard.press('Escape'); assert.equal((await state()).furniturePlacement,null);
    check('bed ghost rotation floor navigation refusal reason and Esc retain the correct selected furniture');
    await moveBed(); await page.getByTestId('furniture-job-cancel').first().click();
    await wait(id=>!window.voxel.snapshot().snapshot.jobs.some(j=>j.furnitureId===id),contract.bedAId);
    assert((await state()).snapshot.beds.some(b=>b.id===contract.bedAId));
    check('queued move is cancelled visibly while the original bed remains installed');
    await moveBed();
    await runUntil(id=>window.voxel.snapshot().snapshot.pawns.some(p=>p.cargo?.furniture?.id===id),contract.bedAId);
    const carrier=(await state()).snapshot.pawns.find(p=>p.cargo?.furniture?.id===contract.bedAId); await selectPawn(carrier.id);
    await page.getByTestId('carried-furniture').waitFor();
    await wait(id=>window.voxel.snapshot().metrics.living?.carriedFurniture.some(f=>f.furnitureId===id),contract.bedAId);
    await page.keyboard.press('q'); await shot('bed-physical-cargo',page.getByTestId('carried-furniture')); await roundtrip('carrying-bed');
    check('ordinary worker visibly carries the same packaged bed and file roundtrip preserves it');
    await runUntil(({id,target})=>window.voxel.snapshot().snapshot.beds.some(b=>b.id===id&&b.x===target.x&&b.y===target.y&&b.z===target.z),{id:contract.bedAId,target:contract.bedTarget});
    await selectBed(contract.bedAId); await assertStats(contract.bedAId); await shot('reinstalled-bed',page.getByTestId('furniture-quality'));
    assert.equal((await state()).snapshot.beds.find(b=>b.id===contract.bedAId).axis,'x');
    check('visible map targeting runs uninstall carrying and rotated cross-layer bed reinstall');
    await page.getByTestId('furniture-uninstall').click();
    await runUntil(id=>window.voxel.snapshot().snapshot.items.some(i=>i.furniture?.id===id),contract.bedAId);
    const bedPackage=(await state()).snapshot.items.find(i=>i.furniture?.id===contract.bedAId); await selectItem(bedPackage,contract.bedAId,true);
    await assertStats(contract.bedAId); await wait(()=>window.voxel.snapshot().metrics.living?.packedParts>=6);
    await shot('uninstalled-bed-package',page.getByTestId('packed-furniture'));
    check('standalone uninstall exposes a ground package with preserved authoritative attributes');
    await fixture('chair-stored'); const stored=(await state()).snapshot.items.find(i=>i.furniture?.id===contract.chairId);
    await selectItem(stored,contract.chairId,true); await assertStats(contract.chairId);
    await page.getByTestId('furniture-move-target').click(); await wait(id=>window.voxel.snapshot().furniturePlacement?.furnitureId===id,contract.chairId);
    const chairOriginal=contract.initialFurniture.find(f=>f.id===contract.chairId);
    await level(chairOriginal.z); await page.keyboard.press('r'); await hover(chairOriginal);
    await wait(()=>window.voxel.snapshot().metrics.living?.previewKind==='chair'); await shot('packed-chair-install-preview');
    await target(chairOriginal); await runUntil(id=>window.voxel.snapshot().snapshot.chairs.some(c=>c.id===id),contract.chairId);
    await selectItem(chairOriginal,contract.chairId); await assertStats(contract.chairId);
    check('stored package installs across floors through visible targeting and normal hauling');
    await fixture('cancel-carrying'); const cancelCarrier=(await state()).snapshot.pawns.find(p=>p.cargo?.furniture?.id===contract.cancelChairId);
    await selectPawn(cancelCarrier.id); await page.getByTestId('carried-furniture').getByTestId('furniture-move-cancel').click();
    await runUntil(id=>window.voxel.snapshot().snapshot.items.some(i=>i.furniture?.id===id)&&!window.voxel.snapshot().snapshot.jobs.some(j=>j.furnitureId===id),contract.cancelChairId);
    const cancelled=(await state()).snapshot.items.find(i=>i.furniture?.id===contract.cancelChairId);
    await selectItem(cancelled,contract.cancelChairId,true); await assertStats(contract.cancelChairId); await shot('cancelled-package',page.getByTestId('packed-furniture'));
    check('cancel during real carrying leaves one inspectable package and no install job');
    await fixture('table-planned'); await level(contract.tableTarget.z); await target(contract.tableTarget);
    await page.getByTestId('furniture-job-cancel').first().waitFor(); await shot('table-destination-job');
    await runUntil(id=>window.voxel.snapshot().snapshot.pawns.some(p=>p.cargo?.furniture?.id===id),contract.tableId);
    const tableCarrier=(await state()).snapshot.pawns.find(p=>p.cargo?.furniture?.id===contract.tableId); await selectPawn(tableCarrier.id);
    await page.keyboard.press('q'); await shot('table-physical-cargo',page.getByTestId('carried-furniture')); await page.keyboard.press('e');
    await runUntil(({id,target})=>window.voxel.snapshot().snapshot.tables.some(t=>t.id===id&&t.z===target.z),{id:contract.tableId,target:contract.tableTarget});
    await selectItem(contract.tableTarget,contract.tableId); await assertStats(contract.tableId); assert.equal((await state()).snapshot.tables.find(t=>t.id===contract.tableId).gathering,false);
    await gathering(true); await gathering(false); check('moved table keeps its gathering setting and existing controls');
    await fixture('moved-bed-sleep'); await selectPawn(contract.sleeperId); await currentFurniture(contract.sleeperId,contract.bedAId);
    await shot('actual-moved-bed-user',page.getByTestId('current-furniture')); await click('查看当前床品质'); await assertStats(contract.bedAId);
    check('actual sleep at the moved destination links to the preserved bed');
    await fixture('moved-dining'); await selectPawn(contract.dinerId); await currentFurniture(contract.dinerId,contract.diningChairId);
    await wait(id=>window.voxel.snapshot().metrics.living?.diners.some(p=>p.pawnId===id),contract.dinerId);
    await shot('actual-moved-dining',page.getByTestId('current-furniture')); await click('查看当前餐椅品质'); await assertStats(contract.diningChairId); await roundtrip('moved-dining');
    check('actual meal uses reinstalled table and chair and survives visible save/load');
    await fixture('chair-stored'); await selectItem(stored,contract.chairId,true); await page.setViewportSize({width:900,height:700}); await settle();
    await shot('narrow-packed-controls',page.getByTestId('furniture-move'));
    const bounds=await page.getByTestId('furniture-move').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=900);
    await page.getByTestId('furniture-move-target').click(); await shot('narrow-install-targeting');
    const narrowFooter = await page.locator('.voxel-footer').boundingBox(), narrowToolbar = await page.locator('.voxel-tool-hint').boundingBox();
    assert(narrowToolbar.y >= narrowFooter.y && narrowToolbar.x >= 0 && narrowToolbar.x + narrowToolbar.width <= 900);
    const narrowCancel = await page.getByTestId('furniture-placement-cancel').boundingBox();
    assert(narrowCancel.y >= narrowToolbar.y && narrowCancel.y + narrowCancel.height <= narrowToolbar.y + narrowToolbar.height);
    await page.keyboard.press('Escape');
    check('900 pixel layout retains packed attributes and install controls',{bounds});
    await Promise.all(reads); if(!development){assert(result.assets.length>0&&result.assets.every(a=>a.status===200&&a.matchesLocalBuild&&!a.error));check('served JS and CSS match frozen local build by SHA');}
    assert.deepEqual(result.errors,[]);check('no page or console errors');
  } catch(error){result.failure=String(error.stack??error);await shot('failure').catch(()=>{});throw error;}
  finally{await context.close();}
}
try{for(const mode of modes)await verify(mode);report.status='passed';}
catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(OUT+'/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({status:report.status,modes:report.modes.map(m=>({mode:m.mode,checks:m.checks.length,errors:m.errors,failure:m.failure}))},null,2));
