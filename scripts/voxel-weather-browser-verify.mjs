import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_WEATHER_URL ?? 'http://127.0.0.1:4178/?world=voxel';
const OUT = process.env.VOXEL_WEATHER_BROWSER_OUT ?? 'test-results/voxel-weather-browser';
const FIXTURES = process.env.VOXEL_WEATHER_FIXTURES ?? 'test-results/voxel-weather';
const modes = process.env.VOXEL_WEATHER_BROWSER_MODE ? [process.env.VOXEL_WEATHER_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
const development = !process.env.VOXEL_WEATHER_VERIFY_BUILD && ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const at = p => (p.z * 64 + p.y) * 64 + p.x;
const point = p => p && ({ x: p.x, y: p.y, z: p.z });
const snowCost = depth => depth < .25 ? 0 : depth < .5 ? 4 : depth < .75 ? 8 : 12;
await mkdir(OUT, { recursive: true });
const campaignBytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(campaignBytes);
assert.equal(campaign.status, 'passed', 'ordinary weather campaign must finish first');
const contract = campaign.browser; assert(contract, 'ordinary campaign browser checkpoints');
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE, development,
  scope: 'Bounded v27 real-weather UI and renderer verification. All mutations use visible controls, map clicks and file chooser import/export. snapshot/project/exportSave are read-only. Checkpoints are hash-checked products of an ordinary fresh-colony campaign; this script never changes weather, snow, resources, actors or clocks. Movement and rain-fire results are actual normal progression. Solar rain/fog invariance belongs to controlled simulation tests; no solar building is fabricated here.',
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
  async function load(file) {
    const bytes = await readFile(file), data = JSON.parse(bytes);
    if (path.resolve(path.dirname(file)) === path.resolve(FIXTURES)) {
      const evidence = campaign.fixtures[path.basename(file, '.json')]; assert(evidence, 'campaign fixture provenance'); assert.equal(sha(bytes), evidence.sha256);
    }
    result.fixtures.push({ file, sha256: sha(bytes), version: data.version, tick: data.tick });
    await click('菜单与存档'); const choosing = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await choosing).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, data.tick); await settle(); return data;
  }
  const loadFixture = name => load(`${FIXTURES}/${name}.json`);
  async function openWeather() { if (!await page.getByTestId('weather-panel').isVisible()) await click('天气与环境'); }
  async function closeWeather() { if (await page.getByTestId('weather-panel').isVisible()) await click('关闭天气面板'); }
  async function selectColonist(id) {
    const p = (await state()).snapshot.pawns.find(p => p.id === id); assert.equal(p?.faction, 'colony');
    const target = page.locator(`.voxel-colonists button[data-colonist-id="${id}"]`); await target.scrollIntoViewIfNeeded(); await target.click();
    await page.getByTestId('mood-panel').waitFor(); await settle(); return p;
  }
  async function selectMap(pos, allowGeneratorAnchor = false) {
    await closeWeather();
    for (let n = 0; (await state()).level !== pos.z && n < 24; n++) await click((await state()).level < pos.z ? '上移一层' : '下移一层');
    assert.equal((await state()).level, pos.z); await click('查看'); await settle();
    for (const height of [.06, .35, .7, 1]) {
      const q = await page.evaluate(({ pos, height }) => window.voxel.project({ ...pos, z: pos.z + height }), { pos, height });
      await page.mouse.click(q.x, q.y); await page.waitForTimeout(160);
      const selected = (await state()).selected;
      if (selected && at(selected) === at(pos)) return point(selected);
      if (allowGeneratorAnchor && selected) {
        const device = (await state()).snapshot.devices.find(d => d.kind === 'generator' && at(d) === at(selected));
        // The ordinary campaign's 2 x 2 generator is inspected through its anchor.
        if (device && pos.z === device.z && pos.x >= device.x && pos.x < device.x + 2 && pos.y >= device.y && pos.y < device.y + 2)
          return point(selected);
      }
    }
    assert.deepEqual(point((await state()).selected), point(pos), 'visible map click must select actual intended cell');
  }
  async function exportThroughUI(name) {
    await click('菜单与存档'); const downloading = page.waitForEvent('download'); await click('导出体素存档');
    const file = `${OUT}/${mode}-${name}.json`; await (await downloading).saveAs(file); await click('关闭菜单'); return file;
  }
  async function assertCell(pos, expectedExposure) {
    const requested = point(pos); pos = await selectMap(pos, true); await openWeather();
    const s = (await state()).snapshot, detail = page.getByTestId('weather-cell-detail');
    const exposed = pos.z >= s.weatherRoof[pos.y * 64 + pos.x]; assert.equal(exposed, expectedExposure);
    const depth = s.snow.find(cell => at(cell) === at(pos))?.depth ?? 0;
    assert.equal(await detail.getAttribute('data-exposed'), String(exposed));
    assert.equal(Number(await detail.getAttribute('data-snow-depth')), depth);
    assert.equal(Number(await detail.getAttribute('data-weather-move')), exposed ? s.weather.effects.moveFactor : 1);
    assert.equal(Number(await detail.getAttribute('data-weather-accuracy')), exposed ? s.weather.effects.accuracyFactor : 1);
    assert.equal(Number(await detail.getAttribute('data-snow-ticks')), snowCost(depth) * 20 / 60);
    return { requested, selected: point(pos), exposed, depth, moveFactor: exposed ? s.weather.effects.moveFactor : 1 };
  }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot);
    await click('暂停'); if (await button('收起指引').isVisible()) await click('收起指引'); assert.equal((await state()).worker, mode === 'worker');
    const rain = await loadFixture(contract.rainFixture), rainy = (await state()).snapshot;
    assert(rainy.weather.effects.rainRate > 0 && rainy.weather.effects.snowRate === 0);
    await openWeather();
    assert.equal(await page.getByTestId('weather-status').getAttribute('data-weather-kind'), rainy.weather.kind);
    assert.equal(await page.getByTestId('weather-panel').getAttribute('data-weather-kind'), rainy.weather.kind);
    for (const [id, key] of [['weather-rain-rate','rainRate'],['weather-snow-rate','snowRate'],['weather-move-factor','moveFactor'],['weather-accuracy-factor','accuracyFactor']])
      assert.equal(Number(await page.getByTestId(id).getAttribute('data-value')), rainy.weather.effects[key]);
    await wait(() => window.voxel.snapshot().metrics.weather?.rainParticles > 0);
    assert.equal((await state()).metrics.weather.visualDim, rainy.weather.effects.visualDim);
    await shot('rain-and-effects', page.getByTestId('weather-panel'));
    check('actual weather status precipitation movement and accuracy values match snapshot; rainfall and cloud tint are rendered', { weather: rainy.weather.kind, effects: rainy.weather.effects });

    const exposed = await assertCell(contract.exposedPos, true), covered = await assertCell(contract.roofedPos, false);
    assert.equal(covered.moveFactor, 1); await shot('roofed-cell', page.getByTestId('weather-cell-detail'));
    check('real built roof excludes local precipitation and weather movement; exposed cell reports actual effects', { exposed, covered, roofedPos: contract.roofedPos });

    const pausedBefore = await save(); await wait(() => Math.abs(window.voxel.snapshot().metrics.weather.animationTick - window.voxel.snapshot().snapshot.tick) < .0001);
    const pausedAnimation = (await state()).metrics.weather.animationTick; await page.waitForTimeout(1200);
    assert.equal((await state()).metrics.weather.animationTick, pausedAnimation); assert.deepEqual((await save()).weather, pausedBefore.weather);
    const exported = await exportThroughUI('rain-save'), savedRain = await load(exported), restoredRain = await save();
    assert.deepEqual(restoredRain.weather, savedRain.weather); assert.deepEqual(restoredRain.snow, savedRain.snow); assert.deepEqual(restoredRain.fires, savedRain.fires);
    check('pause freezes precipitation animation and weather; visible export/import preserves weather calendar snow and fire');

    const fire = (await state()).snapshot.fires.find(f => f.id === contract.fireId); assert(fire, 'ordinary rain checkpoint includes live fire');
    assert(!(await state()).snapshot.pawns.some(p => p.firefightTask), 'rain branch uses no active firefighter');
    assert((await state()).snapshot.pawns.filter(p => p.faction === 'colony' && !p.dead).every(p => p.priorities.firefight === 0), 'ordinary rain checkpoint disables automatic firefighting');
    await click('3倍速'); await wait(({ id, size }) => { const f = window.voxel.snapshot().snapshot.fires.find(f => f.id === id); return !f || f.size < size; }, { id: fire.id, size: fire.size }); await click('暂停');
    const suppressed = (await state()).snapshot.fires.find(f => f.id === fire.id);
    assert(!suppressed || suppressed.size < fire.size);
    await click('3倍速'); await wait(id => !window.voxel.snapshot().snapshot.fires.some(f => f.id === id), fire.id); await click('暂停');
    assert(!(await state()).snapshot.pawns.some(p => p.firefightTask));
    await shot('rain-extinguished-fire');
    check('normal rainfall progression weakens and extinguishes the actual exposed fire without an assigned firefighter', { fireId: fire.id, before: fire.size, afterFirstSuppression: suppressed?.size ?? 0 });

    const snowySave = await loadFixture(contract.snowFixture), snowy = (await state()).snapshot;
    assert(snowy.weather.effects.snowRate > 0 && snowy.snow.length > 0); await openWeather();
    await wait(() => window.voxel.snapshot().metrics.weather?.snowParticles > 0);
    assert.equal((await state()).metrics.weather.rainParticles, 0, 'snow precipitation is not duplicated as rain streaks');
    const snowyCell = await assertCell(contract.snowExposedPos, true); assert(snowyCell.depth >= .25);
    await shot('snow-and-real-cover', page.getByTestId('weather-cell-detail'));
    const roofSnow = await assertCell(contract.snowRoofedPos, false); assert.equal(roofSnow.depth, 0);
    const cutBefore = await save(); await closeWeather();
    for (let n = 0; (await state()).level > 1 && n < 24; n++) await click('下移一层');
    await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0 && window.voxel.snapshot().metrics.weather.snowParticles === 0);
    assert.equal((await state()).metrics.weather.snowCells, 0); assert.deepEqual((await save()).snow, cutBefore.snow);
    assert.deepEqual((await save()).weather, cutBefore.weather); await shot('underground-no-precipitation');
    check('actual snow particles and accumulated cells are visible; built roof and underground view do not create interior snowfall', { snowCells: snowy.snow.length, exposedDepth: snowyCell.depth });

    await loadFixture(contract.snowFixture); const actor = await selectColonist(contract.movement.pawnId);
    await selectMap(contract.movement.destination);
    const beforeMove = await save(), initial = beforeMove.pawns.find(p => p.id === actor.id);
    await click(`让 ${actor.name} 前往选中位置`);
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).path.length > 0, actor.id);
    const assigned = (await state()).snapshot.pawns.find(p => p.id === actor.id); assert(assigned.path.length > 0);
    await click('1倍速'); await wait(({ id, destination }) => { const p = window.voxel.snapshot().snapshot.pawns.find(p => p.id === id); return p.x === destination.x && p.y === destination.y && p.z === destination.z; }, { id: actor.id, destination: contract.movement.destination }); await click('暂停');
    const arrived = (await state()).snapshot.pawns.find(p => p.id === actor.id); assert.deepEqual(point(arrived), point(contract.movement.destination));
    assert((await state()).snapshot.tick > beforeMove.tick); await shot('actual-snow-movement');
    check('visible move order creates a real route and actor traverses snowy terrain under normal simulation', { actorId: actor.id, from: point(initial), to: point(arrived), pathCells: assigned.path.length, elapsedTicks: (await state()).snapshot.tick - beforeMove.tick });

    const retained = await loadFixture(contract.retainedSnowFixture); assert(retained.snow.length > 0);
    const retainedState = (await state()).snapshot; assert.equal(retainedState.weather.effects.snowRate, 0);
    await openWeather(); const cell = [...retainedState.snow].sort((a,b) => b.depth-a.depth || at(a)-at(b))[0];
    await click(`查看积雪 ${at(cell)}`); assert.equal(Number(await page.getByTestId('weather-cell-detail').getAttribute('data-snow-depth')), cell.depth);
    await wait(() => window.voxel.snapshot().metrics.weather.snowCells > 0 && window.voxel.snapshot().metrics.weather.snowParticles === 0);
    const snowFile = await exportThroughUI('retained-snow'), savedSnow = await load(snowFile), restoredSnow = await save();
    assert.deepEqual(restoredSnow.weather, savedSnow.weather); assert.deepEqual(restoredSnow.snow, savedSnow.snow);
    await shot('retained-snow', page.getByTestId('weather-panel'));
    check('snow persists after snowfall ends and exact depth survives visible export/import', { kind: retainedState.weather.kind, snowCells: retained.snow.length });

    await page.setViewportSize({ width: 900, height: 700 }); await loadFixture(contract.rainFixture); await openWeather();
    await page.getByTestId('weather-panel').evaluate(el => { el.scrollTop = 0; }); await shot('narrow-weather');
    const panel = await page.getByTestId('weather-panel').boundingBox(), status = await page.getByTestId('weather-status').boundingBox();
    assert(panel && panel.x >= 0 && panel.x + panel.width <= 900 && panel.y >= 0 && panel.y + panel.height <= 700);
    assert(status && status.x >= 0 && status.x + status.width <= 900 && status.y + status.height <= 700);
    await click('关闭天气面板'); await click('天气与环境'); assert(await page.getByTestId('weather-panel').isVisible());
    check('900 pixel layout retains usable weather status panel and close/reopen controls');
    await Promise.all(reads); if (!development) { assert(result.assets.length > 0); assert(result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error)); check('served production asset bytes match the local build'); }
    assert.deepEqual(result.errors, []); check('no browser page or console errors');
  } catch (error) { result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, modes: report.modes.map(m => ({ mode: m.mode, checks: m.checks.length, errors: m.errors, failure: m.failure })) }, null, 2));
