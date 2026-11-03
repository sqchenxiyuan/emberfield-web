import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_ENVIRONMENT_URL ?? 'http://127.0.0.1:4178/?world=voxel';
const OUT = process.env.VOXEL_ENVIRONMENT_BROWSER_OUT ?? 'test-results/voxel-environment-browser';
const FIXTURES = process.env.VOXEL_ENVIRONMENT_FIXTURES ?? 'test-results/voxel-environment';
const modes = process.env.VOXEL_ENVIRONMENT_BROWSER_MODE ? [process.env.VOXEL_ENVIRONMENT_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(mode => ['worker', 'main'].includes(mode)));
const development = !process.env.VOXEL_ENVIRONMENT_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const at = p => (p.z * 64 + p.y) * 64 + p.x;
const point = p => p && ({ x: p.x, y: p.y, z: p.z });
const wetMemory = (p, tick) => p.psyche.memories.find(m => m.kind === 'wet' && m.expires > tick);
await mkdir(OUT, { recursive: true });
const campaignBytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(campaignBytes);
assert.equal(campaign.status, 'passed', 'ordinary environment campaign must finish first');
const contract = campaign.browser; assert(contract, 'ordinary campaign browser checkpoints');
for (const field of ['rainFixture', 'dryingFixture', 'protectedFixture', 'pawnId', 'exposedPos', 'roofedPos', 'indoorPos', 'exposedItemId', 'roofedItemId', 'indoorItemId'])
  assert(contract[field] !== undefined, `missing browser contract ${field}`);
const report = { version: 28, status: 'running', startedAt: new Date().toISOString(), base: BASE, development,
  scope: 'Bounded v28 environment UI verification in Worker and main modes. Mutations use visible controls, real map clicks and file chooser import/export only. snapshot/project/exportSave are read-only. Checkpoints and campaign are hashed; no weather, HP, filth, memory, position or clocks are injected. Normal progression checks wet refresh/expiry, rain wash and protected HP. No stochastic-rate calibration or complete horseshoe behavior claim is made unless an ordinary eligible horseshoe checkpoint is supplied.',
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
    reads.push(response.body().then(async bytes => {
      asset.sha256 = sha(bytes); asset.bytes = bytes.length;
      asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
    }).catch(error => { asset.error = String(error); }));
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const save = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 45000) => page.waitForFunction(fn, arg, { timeout });
  const button = name => page.getByRole('button', { name, exact: true });
  const click = async name => {
    await button(name).scrollIntoViewIfNeeded(); await button(name).click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    if (/^[123]倍速$/.test(name)) await wait(speed => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
  };
  const settle = async () => { await page.waitForTimeout(250); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  async function shot(name, locator) {
    if (locator) await locator.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await settle(); const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file);
  }
  async function closeDrawers() {
    if (await page.getByTestId('weather-panel').isVisible()) await click('关闭天气面板');
    if (await page.getByTestId('sanitation-panel').isVisible()) await click('关闭卫生面板');
  }
  async function load(file, evidence) {
    const bytes = await readFile(file), data = JSON.parse(bytes);
    if (evidence) { assert.equal(sha(bytes), evidence.sha256, 'campaign fixture SHA-256'); assert.equal(data.tick, evidence.tick); }
    result.fixtures.push({ file, sha256: sha(bytes), version: data.version, tick: data.tick, campaignFixture: !!evidence });
    await closeDrawers(); await click('菜单与存档'); const choosing = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await choosing).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, data.tick);
    assert.equal((await state()).snapshot.speed, 0); await settle(); return data;
  }
  async function loadFixture(name) {
    const evidence = campaign.fixtures[name]; assert(evidence, `campaign fixture ${name}`);
    const declared = evidence.file ?? `${name}.json`;
    let file = path.resolve(declared);
    try { await access(file); } catch { file = path.resolve(FIXTURES, declared); }
    return load(file, evidence);
  }
  async function openWeather() { if (!await page.getByTestId('weather-panel').isVisible()) await click('天气与环境'); }
  async function selectColonist(id) {
    await closeDrawers(); const p = (await state()).snapshot.pawns.find(p => p.id === id); assert.equal(p?.faction, 'colony');
    const target = page.locator(`.voxel-colonists button[data-colonist-id="${id}"]`); await target.scrollIntoViewIfNeeded(); await target.click();
    await page.getByTestId('mood-panel').waitFor(); await settle(); return p;
  }
  async function selectMap(pos) {
    await closeDrawers();
    for (let n = 0; (await state()).level !== pos.z && n < 24; n++) await click((await state()).level < pos.z ? '上移一层' : '下移一层');
    assert.equal((await state()).level, pos.z); await click('查看'); await settle();
    for (const height of [.06, .35, .7, 1]) {
      const q = await page.evaluate(({ pos, height }) => window.voxel.project({ ...pos, z: pos.z + height }), { pos, height });
      await page.mouse.click(q.x, q.y); await page.waitForTimeout(160);
      const selected = (await state()).selected;
      if (selected && at(selected) === at(pos)) return point(selected);
    }
    assert.deepEqual(point((await state()).selected), point(pos), 'visible map click selects the intended storage cell');
  }
  async function exportThroughUI(name) {
    await closeDrawers(); await click('菜单与存档'); const downloading = page.waitForEvent('download'); await click('导出体素存档');
    const file = `${OUT}/${mode}-${name}.json`; await (await downloading).saveAs(file); await click('关闭菜单'); return file;
  }
  async function assertItem(id, pos) {
    await selectMap(pos); const s = (await state()).snapshot;
    const item = s.items.find(i => i.id === id); assert(item, `actual item ${id}`); assert.equal(at(item), at(pos));
    const expected = s.environment.items.find(i => i.entity === 'stack' && i.id === id); assert(expected);
    const ui = page.locator(`[data-testid="item-condition"][data-entity="stack"][data-item-id="${id}"]`); await ui.waitFor();
    for (const [attr, value] of Object.entries({ 'data-hit-points': expected.hitPoints ?? 'none', 'data-max-hit-points': expected.maxHitPoints ?? 'none',
      'data-deterioration-rate': expected.rate, 'data-exposed': expected.environment.exposed, 'data-outdoors': expected.environment.outdoors }))
      assert.equal(await ui.getAttribute(attr), String(value));
    if (expected.hitPoints !== null) {
      assert.equal(Number(await ui.getByRole('progressbar').getAttribute('value')), expected.hitPoints);
      assert.equal(Number(await ui.getByRole('progressbar').getAttribute('max')), expected.maxHitPoints);
    }
    if (item.resource === 'wood') assert.equal(await ui.locator('..').getByTestId('food-condition').count(), 0, 'wood HP is not shown as food rot');
    assert((await ui.innerText()).includes('食物腐坏另外按温度计算'));
    return { item, expected, ui };
  }
  async function assertWet(id, wetting) {
    const pawn = await selectColonist(id), s = (await state()).snapshot, memory = wetMemory(pawn, s.tick); assert(memory);
    assert.equal(s.environment.wetPawnIds.includes(id), wetting);
    const ui = page.getByTestId('wet-memory-status'); await ui.waitFor();
    assert.equal(await ui.getAttribute('data-wetting'), String(wetting));
    assert.equal(Number(await ui.getAttribute('data-expires')), memory.expires);
    assert.equal(Number(await ui.getAttribute('data-remaining-ticks')), memory.expires - s.tick);
    assert((await ui.innerText()).includes(`${Math.max(1, Math.ceil((memory.expires - s.tick) / 12000 * 24 * 60))} 游戏分钟`));
    const thoughts = page.locator('.voxel-mood-thoughts');
    if (await thoughts.getAttribute('open') === null) await thoughts.locator('summary').click();
    const thought = thoughts.locator('li').filter({ hasText: '淋湿了' }); assert.equal((await thought.locator('b').innerText()).trim(), '-3');
    return { pawn, memory, tick: s.tick, ui };
  }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot);
    await click('暂停'); if (await button('收起指引').isVisible()) await click('收起指引'); assert.equal((await state()).worker, mode === 'worker');
    await loadFixture(contract.rainFixture); let rainy = (await state()).snapshot;
    assert(rainy.weather.effects.rainRate > 0 && !rainy.environment.natureAvailable);
    const exposed = await assertItem(contract.exposedItemId, contract.exposedPos);
    assert(exposed.expected.environment.exposed && exposed.expected.environment.outdoors);
    assert(exposed.expected.hitPoints < exposed.expected.maxHitPoints && exposed.expected.rate > 0);
    await shot('exposed-damaged-stock', exposed.ui);
    const roofed = await assertItem(contract.roofedItemId, contract.roofedPos);
    assert(!roofed.expected.environment.exposed && roofed.expected.environment.outdoors);
    assert(roofed.expected.rate > 0 && roofed.expected.rate < exposed.expected.rate);
    assert((await roofed.ui.innerText()).includes('棚下'));
    await openWeather(); const protection = page.getByTestId('weather-panel').getByTestId('cell-storage-protection');
    assert.equal(await protection.getAttribute('data-indoors'), 'false'); assert((await protection.innerText()).includes('有顶室外'));
    assert.equal(await page.getByTestId('weather-nature-status').getAttribute('data-available'), 'false');
    await shot('shed-and-weather', page.getByTestId('weather-panel'));
    check('ground item HP and stochastic rate match canonical environment; zoned outdoor stock deteriorates and an open shed only reduces the rate',
      { exposed: exposed.expected, roofed: roofed.expected });

    const wet = await assertWet(contract.pawnId, true); await shot('wet-mood-memory', wet.ui);
    const paused = await save(); await page.waitForTimeout(900);
    assert.equal((await state()).snapshot.tick, paused.tick);
    assert.deepEqual((await save()).pawns.find(p => p.id === contract.pawnId).psyche.memories, paused.pawns.find(p => p.id === contract.pawnId).psyche.memories);
    await click('3倍速'); await wait(({ id, expires }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).psyche.memories.some(m => m.kind === 'wet' && m.expires > expires),
      { id: contract.pawnId, expires: wet.memory.expires }); await click('暂停');
    const refreshed = await assertWet(contract.pawnId, true);
    assert(refreshed.memory.expires > wet.memory.expires);
    check('visible wet thought has -3 mood and the actual remaining duration; pause freezes it and continued normal rain refreshes expiry',
      { pawnId: contract.pawnId, originalExpiry: wet.memory.expires, refreshedExpiry: refreshed.memory.expires });

    const exportedFile = await exportThroughUI('environment-state'), exported = await load(exportedFile), restored = await save();
    for (const key of ['items', 'filth', 'weather', 'jobs']) assert.deepEqual(restored[key], exported[key], `restored ${key}`);
    for (const p of exported.pawns) {
      const q = restored.pawns.find(v => v.id === p.id); assert.deepEqual(q.psyche.memories, p.psyche.memories); assert.deepEqual(q.cargo, p.cargo);
    }
    check('visible export/import preserves physical item state filth weather and wet-memory expiry', {
      groundStacks: exported.items.length,
      deliveredBatches: exported.jobs.reduce((count, job) => count + job.deliveredBatches.length, 0),
      carriedBatches: exported.pawns.filter(p => p.cargo).length,
    });

    await loadFixture(contract.rainFixture); await selectColonist(contract.pawnId);
    if ((await state()).snapshot.pawns.find(p => p.id === contract.pawnId).drafted) {
      await click('解除征召'); await wait(id => !window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).drafted, contract.pawnId);
    }
    assert(await page.getByTestId('nature-weather-restriction').isVisible());
    assert((await page.getByTestId('nature-weather-restriction').innerText()).includes('马蹄铁'));
    assert(await button('现在去娱乐').isEnabled(), 'rain does not globally disable recreation');
    if (contract.horseshoePawnId !== undefined) {
      const actor = await selectColonist(contract.horseshoePawnId); assert(!actor.drafted && !actor.downed && !actor.dead);
      await click('现在去娱乐'); await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).psyche.recreation?.kind === 'horseshoes', actor.id);
      check('visible recreation order still selects a real reachable horseshoe activity during rain', { pawnId: actor.id });
    }
    await shot('rain-recreation-controls', page.getByTestId('mood-panel'));
    check('nature restriction is explained separately and eligible recreation controls remain enabled in rain', { horseshoeActivityVerified: contract.horseshoePawnId !== undefined });

    await loadFixture(contract.rainFixture); rainy = (await state()).snapshot;
    const washing = rainy.environment.filth.find(f => f.id === contract.washingFilthId) ?? rainy.environment.filth.find(f => f.washing);
    assert(washing?.washing, 'rain checkpoint contains actual washable filth');
    const filth = rainy.filth.find(f => f.id === washing.id); assert(filth);
    assert(rainy.pawns.filter(p => p.faction === 'colony').every(p => p.priorities.clean === 0 && !p.cleanTask), 'rain-wash branch has no cleaners');
    await selectMap(filth); const washUI = page.getByTestId('sanitation-detail').locator(`[data-testid="rain-wash-status"][data-filth-id="${filth.id}"]`);
    assert.equal(await washUI.getAttribute('data-washing'), 'true'); assert.equal(await washUI.getAttribute('data-exposed'), 'true');
    await shot('rain-washing-filth', page.getByTestId('sanitation-detail'));
    await click('3倍速'); await wait(({ id, amount }) => { const f = window.voxel.snapshot().snapshot.filth.find(f => f.id === id); return !f || f.amount < amount; }, { id: filth.id, amount: filth.amount }); await click('暂停');
    const washed = (await state()).snapshot, remaining = washed.filth.find(f => f.id === filth.id);
    assert(!washed.pawns.some(p => p.cleanTask)); assert(!remaining || remaining.amount < filth.amount);
    check('actual exposed filth reports rain washing then loses layers under ordinary weather with no cleaner', { filthId: filth.id, before: filth.amount, after: remaining?.amount ?? 0 });

    await loadFixture(contract.dryingFixture); const sheltered = await assertWet(contract.pawnId, false);
    assert.equal(at(sheltered.pawn), at(contract.roofedPos)); assert(sheltered.pawn.drafted, 'ordinary drying checkpoint keeps this actor under the roof');
    assert((await sheltered.ui.innerText()).includes('已不再淋雨')); await shot('sheltered-still-wet', sheltered.ui);
    const dryFile = await exportThroughUI('drying-state'), dryExport = await load(dryFile);
    assert.equal(wetMemory(dryExport.pawns.find(p => p.id === contract.pawnId), dryExport.tick).expires, sheltered.memory.expires);
    await selectColonist(contract.pawnId); await click('3倍速');
    await wait(id => { const s = window.voxel.snapshot().snapshot; return !s.pawns.find(p => p.id === id).psyche.memories.some(m => m.kind === 'wet' && m.expires > s.tick); }, contract.pawnId);
    await click('暂停'); const dry = (await state()).snapshot;
    assert(dry.tick >= sheltered.memory.expires); assert.equal(at(dry.pawns.find(p => p.id === contract.pawnId)), at(contract.roofedPos));
    assert(!dry.environment.wetPawnIds.includes(contract.pawnId)); await page.getByTestId('wet-memory-status').waitFor({ state: 'hidden' });
    check('actual shelter stops refresh but preserves wet memory through save/import until its original expiry', { pawnId: contract.pawnId, expiry: sheltered.memory.expires, observedExpiredTick: dry.tick });

    await loadFixture(contract.protectedFixture); const protectedItem = await assertItem(contract.indoorItemId, contract.indoorPos);
    assert.equal(protectedItem.expected.rate, 0); assert(!protectedItem.expected.environment.exposed && !protectedItem.expected.environment.outdoors);
    await openWeather(); const indoorProtection = page.getByTestId('weather-panel').getByTestId('cell-storage-protection');
    assert.equal(await indoorProtection.getAttribute('data-indoors'), 'true'); assert((await indoorProtection.innerText()).includes('有顶室内'));
    await shot('protected-underground-stock', page.getByTestId('weather-panel')); await closeDrawers();
    const startTick = (await state()).snapshot.tick; await click('3倍速'); await wait(tick => window.voxel.snapshot().snapshot.tick >= tick + 1300, startTick); await click('暂停');
    const stable = await assertItem(contract.indoorItemId, contract.indoorPos);
    assert.equal(stable.expected.hitPoints, protectedItem.expected.hitPoints); assert.equal(stable.expected.rate, 0);
    check('physically enclosed indoor storage reports protection and preserves actual HP during continued ordinary simulation',
      { itemId: contract.indoorItemId, before: protectedItem.expected.hitPoints, after: stable.expected.hitPoints, elapsedTicks: (await state()).snapshot.tick - startTick });

    await page.setViewportSize({ width: 900, height: 700 }); await loadFixture(contract.rainFixture); await selectColonist(contract.pawnId); await openWeather();
    const toast = await page.locator('.voxel-toast').boundingBox(), inspector = await page.getByTestId('voxel-inspector').boundingBox();
    const drawer = await page.getByTestId('weather-panel').boundingBox();
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    assert(toast && inspector && drawer, 'actual restore notice and both panels are visible');
    assert(!overlaps(toast, inspector) && !overlaps(toast, drawer), 'restore notice does not cover inspector or weather drawer');
    check('900 pixel restore notice occupies map space without overlapping either side panel', { toast, inspector, drawer });
    await page.getByTestId('weather-panel').evaluate(el => { el.scrollTop = 0; }); await shot('narrow-environment');
    const panel = await page.getByTestId('weather-panel').boundingBox();
    assert(panel && panel.x >= 0 && panel.x + panel.width <= 900 && panel.y >= 0 && panel.y + panel.height <= 700);
    await closeDrawers(); const narrowWet = await assertWet(contract.pawnId, true); await narrowWet.ui.scrollIntoViewIfNeeded(); await shot('narrow-wet-memory');
    const wetBounds = await narrowWet.ui.boundingBox(); assert(wetBounds && wetBounds.x >= 0 && wetBounds.x + wetBounds.width <= 900 && wetBounds.y >= 0 && wetBounds.y + wetBounds.height <= 700);
    check('900 pixel layout retains usable environment drawer and wet-memory details');
    await Promise.all(reads);
    if (!development) { assert(result.assets.length > 0); assert(result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error)); check('served production asset bytes match the local build'); }
    assert.deepEqual(result.errors, []); check('no browser page or console errors');
  } catch (error) { result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, modes: report.modes.map(m => ({ mode: m.mode, checks: m.checks.length, errors: m.errors, failure: m.failure })) }, null, 2));
