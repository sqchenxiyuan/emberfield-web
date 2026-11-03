import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_HUSBANDRY_URL ?? 'http://127.0.0.1:4178/?world=voxel';
const OUT = process.env.VOXEL_HUSBANDRY_BROWSER_OUT ?? 'test-results/voxel-husbandry-browser';
const FIXTURES = process.env.VOXEL_HUSBANDRY_FIXTURES ?? 'test-results/voxel-husbandry';
const modes = process.env.VOXEL_HUSBANDRY_BROWSER_MODE ? [process.env.VOXEL_HUSBANDRY_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_HUSBANDRY_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = b => createHash('sha256').update(b).digest('hex');
await mkdir(OUT, { recursive: true });
const campaignBytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(campaignBytes);
assert.equal(campaign.status, 'passed', 'ordinary husbandry campaign must finish first');
const contract = campaign.browser;
for (const field of ['handlerId', 'fatherId', 'motherId', 'childId', 'tameId', 'initialFixture', 'readyFixture', 'pairedFixture', 'pregnantFixture', 'newbornFixture', 'nearAdultFixture', 'grownFixture', 'tameFixture', 'releaseFixture', 'slaughterFixture', 'carcassFixture', 'butcherId']) assert(contract[field] !== undefined, `missing browser contract ${field}`);
const report = { version: campaign.version, status: 'running', startedAt: new Date().toISOString(), base: BASE, development,
  scriptSha256: sha(await readFile(new URL(import.meta.url))),
  scope: 'Worker and main browser verification from hashed ordinary-play checkpoints. All mutations use visible buttons/selects, canvas clicks and normal file chooser import/export. snapshot/project/exportSave are read-only. Taming consumes real carried grain; birth, growth, release and slaughter proceed by normal simulation. No ownership, pregnancy, stock, growth, clock or RNG injection.',
  campaign: { file: `${FIXTURES}/report.json`, sha256: sha(campaignBytes), scope: campaign.scope }, modes: [] };
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
    reads.push(response.body().then(async b => { asset.sha256 = sha(b); asset.bytes = b.length; asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256; }).catch(e => { asset.error = String(e); }));
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const saved = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = name => page.getByRole('button', { name, exact: true });
  const click = async name => {
    await button(name).scrollIntoViewIfNeeded(); await button(name).click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    if (/^[123]倍速$/.test(name)) await wait(speed => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
  };
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  const settle = async () => { await page.waitForTimeout(250); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
  const zoomForDetail = async () => { await page.mouse.move(720, 420); await page.mouse.wheel(0, -650); await settle(); };
  const panel = async () => { if (!await page.getByTestId('wildlife-panel').isVisible()) await click('野生动物与狩猎'); };
  const closePanel = async () => { if (await page.getByTestId('wildlife-panel').isVisible()) await click('关闭野生动物面板'); };
  const animal = async id => (await state()).snapshot.animals.find(a => a.id === id);
  async function shot(name, locator) {
    if (locator) await locator.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await settle(); const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file);
  }
  async function load(file, evidence) {
    const bytes = await readFile(file), data = JSON.parse(bytes);
    if (evidence) { assert.equal(sha(bytes), evidence.sha256); assert.equal(data.tick, evidence.tick); }
    result.fixtures.push({ file, sha256: sha(bytes), version: data.version, tick: data.tick, campaignFixture: !!evidence });
    await closePanel(); await click('菜单与存档'); const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, data.tick);
    assert.equal((await state()).snapshot.speed, 0); await settle(); return data;
  }
  async function fixture(name) {
    const evidence = campaign.fixtures[name]; assert(evidence); let file = path.resolve(evidence.file ?? `${name}.json`);
    try { await access(file); } catch { file = path.resolve(FIXTURES, evidence.file ?? `${name}.json`); }
    return load(file, evidence);
  }
  async function locate(id) {
    await panel(); const row = page.locator(`.voxel-wildlife-list section[data-animal-id="${id}"]`);
    await row.getByRole('button', { name: /^定位 / }).click(); await closePanel();
    await wait(id => document.querySelector('[data-testid="animal-detail"]')?.getAttribute('data-animal-id') === String(id), id); await settle();
    return page.getByTestId('animal-detail');
  }
  async function facts(id) {
    const a = await animal(id), detail = await locate(id), ui = detail.getByTestId('animal-facts');
    for (const [attr, value] of Object.entries({ 'data-sex': a.sex, 'data-growth': a.growth, 'data-pregnancy': a.pregnancy?.progress ?? 'none', 'data-faction': a.faction })) assert.equal(await ui.getAttribute(attr), String(value));
    if (a.growth < 1) assert.equal(Number(await ui.getByRole('progressbar', { name: '动物成长' }).getAttribute('value')), a.growth);
    if (a.pregnancy) assert.equal(Number(await ui.getByRole('progressbar', { name: '动物孕期' }).getAttribute('value')), a.pregnancy.progress);
    return detail;
  }
  async function runUntil(fn, arg, timeout = 60000) { await click('3倍速'); await wait(fn, arg, timeout); await click('暂停'); }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot);
    await click('暂停'); if (await button('收起指引').isVisible()) await click('收起指引'); assert.equal((await state()).worker, mode === 'worker');
    await fixture(contract.initialFixture); await panel();
    assert.equal(await page.locator('.voxel-wildlife-list section[data-animal-id]').count(), 8);
    assert.equal(await page.locator('[data-animal-group="colony"] section').count(), 0);
    assert((await page.getByTestId('wildlife-panel').innerText()).includes('8 只野生动物'));
    const handlers = page.getByTestId('animal-handlers'); await handlers.locator('summary').click();
    const p = (await state()).snapshot.pawns.find(p => p.id === contract.handlerId);
    const priority = handlers.getByRole('combobox', { name: `${p.name} 饲养优先级` });
    await priority.selectOption('0'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).priorities.handle === 0, p.id);
    await priority.selectOption('1'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).priorities.handle === 1, p.id);
    assert((await handlers.innerText()).includes(`动物 ${p.skills.animals.level} 级`));
    check('ordinary wildlife groups and independent handler priority/animal skill are usable');
    await facts(contract.noFeedId); await click('标记驯服此动物');
    const noFeedTick = (await state()).snapshot.tick;
    await runUntil(t => window.voxel.snapshot().snapshot.tick >= t + 180, noFeedTick);
    assert.equal((await animal(contract.noFeedId)).faction, 'wild'); assert(!(await state()).snapshot.pawns.some(p => p.handleTask));
    await click('取消驯服此动物'); check('starting packaged food does not instantly tame a marked animal');

    await fixture(contract.readyFixture); await locate(contract.fatherId);
    await click('标记驯服此动物'); await wait(id => window.voxel.snapshot().snapshot.animals.find(a => a.id === id).tame, contract.fatherId);
    await click('标记狩猎此动物'); await wait(id => window.voxel.snapshot().snapshot.animals.find(a => a.id === id).hunt, contract.fatherId); assert.equal((await animal(contract.fatherId)).tame, false);
    await click('标记驯服此动物'); await wait(id => window.voxel.snapshot().snapshot.animals.find(a => a.id === id).tame, contract.fatherId); assert.equal((await animal(contract.fatherId)).hunt, false);
    await click('取消驯服此动物'); check('visible taming and hunting orders are mutually exclusive and cancelable');

    await fixture('carrying-feed');
    const carried = (await state()).snapshot.pawns.find(p => p.handleTask?.action === 'tame' && p.cargo?.resource === 'grain'); assert(carried);
    const feedTarget = carried.handleTask.animalId, cargoBefore = carried.cargo.amount;
    await locate(feedTarget); assert.equal(await page.getByTestId('animal-detail').getByTestId('animal-status').getAttribute('data-handler-id'), String(carried.id));
    await shot('carried-feed-and-handler', page.getByTestId('animal-detail'));
    await click('取消驯服此动物'); await wait(id => !window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).handleTask, carried.id);
    const afterCancel = (await state()).snapshot.pawns.find(p => p.id === carried.id);
    assert.equal(afterCancel.cargo?.amount, cargoBefore); assert.equal(afterCancel.cargo?.resource, 'grain');
    check('canceling an approaching handler preserves the actual carried feed');

    await fixture(contract.tameFixture); await locate(contract.tameId); const grainBefore = (await saved()).stats.consumed.grain;
    assert.equal((await animal(contract.tameId)).faction, 'wild');
    await zoomForDetail(); await shot('feeding-interaction', page.getByTestId('animal-detail'));
    await runUntil(id => window.voxel.snapshot().snapshot.animals.find(a => a.id === id)?.faction === 'colony', contract.tameId);
    assert((await saved()).stats.consumed.grain > grainBefore); assert.equal((await animal(contract.tameId)).tame, false);
    assert((await state()).snapshot.husbandryLog.some(e => e.kind === 'tame' && e.animalId === contract.tameId));
    await facts(contract.tameId); check('ordinary feeding finishes a genuine taming attempt, consumes grain and changes ownership');

    await fixture(contract.pairedFixture); await panel();
    for (const id of [contract.fatherId, contract.motherId]) assert.equal(await page.locator(`[data-animal-group="colony"] section[data-animal-id="${id}"]`).count(), 1);
    await shot('domestic-pair', page.locator('[data-animal-group="colony"]')); check('tamed male and female appear in the colony group with persistent identities');

    await fixture(contract.pregnantFixture); await facts(contract.motherId); await shot('pregnant-mother', page.getByTestId('animal-detail'));
    const beforeExport = await saved(); await closePanel(); await click('菜单与存档'); const download = page.waitForEvent('download'); await click('导出体素存档');
    const exportedFile = `${OUT}/${mode}-pregnancy-roundtrip.json`; await (await download).saveAs(exportedFile); await click('关闭菜单');
    await load(exportedFile); const restored = await saved();
    for (const field of ['animals', 'grass', 'husbandryLog']) assert.deepEqual(restored[field], beforeExport[field]);
    assert.deepEqual(restored.pawns.map(p => p.handleTask), beforeExport.pawns.map(p => p.handleTask));
    check('visible export/import preserves pregnancy, age, finite grass and handler tasks exactly');
    await locate(contract.motherId); const birthTick = (await state()).snapshot.tick;
    await runUntil(({ motherId, tick }) => window.voxel.snapshot().snapshot.husbandryLog.some(e => e.kind === 'birth' && e.animalId === motherId && e.tick > tick), { motherId: contract.motherId, tick: birthTick });
    const born = (await state()).snapshot.husbandryLog.findLast(e => e.kind === 'birth' && e.animalId === contract.motherId), newborn = await animal(born.otherId);
    assert(newborn && newborn.faction === 'colony' && newborn.growth < .05); assert.notEqual(newborn.id, contract.motherId);
    await facts(newborn.id); await zoomForDetail(); await shot('natural-newborn', page.getByTestId('animal-detail'));
    check('natural birth creates a small real offspring with a new stable identity', { motherId: contract.motherId, childId: newborn.id });
    const screen = await page.evaluate(a => window.voxel.project({ x: a.x, y: a.y, z: a.z + .19 }), newborn);
    await click('清除选择'); await page.mouse.click(screen.x, screen.y); await settle();
    assert.equal(await page.getByTestId('animal-detail').getAttribute('data-animal-id'), String(newborn.id));
    check('scaled newborn body remains directly selectable on the rendered map');
    const groundState = (await state()).snapshot;
    const grassCandidates = groundState.grass.filter(g => g.z === newborn.z && Math.abs(g.x - newborn.x) + Math.abs(g.y - newborn.y) < 8 &&
      ![...groundState.animals, ...groundState.trees, ...groundState.crops, ...groundState.items].some(v => v.x === g.x && v.y === g.y && v.z === g.z));
    let inspectedGrass = null;
    for (const grass of grassCandidates) {
      const projected = await page.evaluate(g => window.voxel.project({ ...g, z: g.z + .04 }), grass);
      if (projected.x < 330 || projected.x > 1060 || projected.y < 165 || projected.y > 750) continue;
      await page.mouse.click(projected.x, projected.y); await settle(); const selected = (await state()).selected;
      if (selected?.x === grass.x && selected?.y === grass.y && selected?.z === grass.z && await page.getByTestId('grass-detail').isVisible()) { inspectedGrass = grass; break; }
    }
    assert(inspectedGrass, 'visible ground grass can be inspected by real map click');
    assert.equal(Number(await page.getByTestId('grass-detail').getAttribute('data-growth')), inspectedGrass.growth);
    assert.equal(Number(await page.getByRole('progressbar', { name: '野草生长' }).getAttribute('value')), inspectedGrass.growth);
    await shot('physical-grass', page.getByTestId('grass-detail')); check('actual grass patches expose their finite saved growth through ground inspection');

    await fixture(contract.nearAdultFixture); await facts(contract.childId);
    await runUntil(id => window.voxel.snapshot().snapshot.animals.find(a => a.id === id)?.growth === 1, contract.childId);
    await facts(contract.childId); assert((await page.getByTestId('animal-detail').innerText()).includes('成年'));
    check('the same young animal visibly reaches adulthood through ordinary elapsed ticks');

    await fixture(contract.releaseFixture); await locate(contract.fatherId); await click('取消放归此动物');
    assert.equal((await animal(contract.fatherId)).faction, 'colony'); assert.equal((await animal(contract.fatherId)).releaseMarked, false);
    await click('标记放归此动物'); await runUntil(id => window.voxel.snapshot().snapshot.animals.find(a => a.id === id)?.faction === 'wild', contract.fatherId);
    await facts(contract.fatherId); assert((await state()).snapshot.husbandryLog.some(e => e.kind === 'release' && e.animalId === contract.fatherId));
    check('release can be canceled, then a real handler completes the reissued order');

    await fixture(contract.slaughterFixture); await locate(contract.childId); await click('取消待宰此动物');
    assert.equal((await animal(contract.childId)).dead, false); await click('标记待宰此动物');
    await runUntil(id => window.voxel.snapshot().snapshot.items.some(i => i.carcass?.animalId === id), contract.childId);
    assert(!(await state()).snapshot.animals.some(a => a.id === contract.childId && !a.dead));
    check('marked slaughter requires physical execution and produces the same animal as a real carcass');
    await shot('slaughter-carcass');
    await fixture(contract.carcassFixture); await panel();
    const butcherList = page.locator('.voxel-wildlife-workers').filter({ hasText: '屠宰点 ·' }); await butcherList.locator('summary').click();
    await click(`定位屠宰点 ${contract.butcherId}`); await closePanel(); await page.getByTestId('butcher-bill').waitFor();
    const meatBefore = (await saved()).stats.produced.meat; await click('恢复屠宰');
    await runUntil(before => window.voxel.snapshot().snapshot.stats.produced.meat > before, meatBefore);
    assert((await saved()).stats.produced.meat > meatBefore); check('a normal cook continues from slaughter through physical corpse transport and butchering');

    await page.setViewportSize({ width: 900, height: 700 }); await fixture(contract.grownFixture); await locate(contract.motherId); await panel();
    const drawer = await page.getByTestId('wildlife-panel').boundingBox(); assert(drawer && drawer.x >= 0 && drawer.x + drawer.width <= 900 && drawer.y >= 0 && drawer.y + drawer.height <= 700);
    const row = page.locator(`.voxel-wildlife-list section[data-animal-id="${contract.motherId}"]`); await row.getByRole('button', { name: /^标记待宰 / }).scrollIntoViewIfNeeded();
    const buttons = await row.getByRole('button').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom }; }));
    assert(buttons.every(b => b.x >= 0 && b.right <= 900 && b.y >= 0 && b.bottom <= 700));
    await shot('narrow-animal-management'); check('900 pixel drawer keeps animal orders visible and reachable', { drawer, buttons });
    await Promise.all(reads);
    if (!development) { assert(result.assets.length > 0); assert(result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error)); check('served production assets match the current local build byte for byte'); }
    assert.deepEqual(result.errors, []); check('no browser page or console errors');
  } catch (error) { result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, modes: report.modes.map(m => ({ mode: m.mode, checks: m.checks.length, errors: m.errors, failure: m.failure })) }, null, 2));
