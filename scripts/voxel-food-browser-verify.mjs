import { importLegacyStart, LEGACY_START } from './voxel-legacy-start.mjs';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5182/?world=voxel';
const OUT = process.env.VOXEL_FOOD_BROWSER_OUT ?? 'test-results/voxel-food-browser';
await mkdir(OUT, { recursive: true });
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const report = {
  baseline: LEGACY_START,
  base: BASE, startedAt: new Date().toISOString(), checks: [], screenshots: [], errors: [], fixtures: [], assets: [],
  scope: 'Chrome at 1280x720 and 900x700; actual DOM controls, map mouse drags and file chooser imports. window.voxel is used only for read-only projection, snapshots and save export. Calendar fixtures start from the genuinely published generator-1 save imported through the UI and use only VoxelSimulation.load/command/step/save. No mature crops, resources, terrain, pawn positions or tick values are injected. Fixture rendering is followed by real browser harvest/cooking and cross-level ingredient transport.',
};
const pos = (x, y, z = 8) => ({ x, y, z });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const assetReads = [];
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
page.on('response', response => {
  const url = response.url();
  if (/\.(?:js|css)(?:\?|$)/.test(url) && !report.assets.some(asset => asset.url === url)) {
    const asset = { url, status: response.status() };
    report.assets.push(asset);
    assetReads.push(response.body().then(async body => {
      asset.sha256 = digest(body); asset.bytes = body.length;
      if (new URL(url).pathname.includes('/assets/')) {
        const localFile = path.join('dist', 'assets', path.basename(new URL(url).pathname));
        asset.localFile = localFile; asset.localSha256 = digest(await readFile(localFile));
        asset.matchesLocalBuild = asset.sha256 === asset.localSha256;
      }
    }).catch(error => { asset.error = String(error); }));
  }
});
const state = () => page.evaluate(() => window.voxel.snapshot());
const wait = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout });
const point = p => page.evaluate(p => window.voxel.project(p), p);
const record = (name, data = {}) => { report.checks.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };
async function screenshot(name) {
  const file = `${OUT}/${name}.png`; await page.screenshot({ path: file }); report.screenshots.push(file);
}
async function control(name) {
  const button = page.getByRole('button', { name, exact: true });
  await button.scrollIntoViewIfNeeded(); await button.click();
}
async function pause() { await control('暂停'); await wait(() => window.voxel.snapshot().snapshot.speed === 0); }
async function run() { await control('3倍速'); await wait(() => window.voxel.snapshot().snapshot.speed === 3); }
async function click(p) { const q = await point(p); await page.mouse.click(q.x, q.y); }
async function drag(tool, from, to = from) {
  await control(tool); const a = await point(from), b = await point(to);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(150);
}
async function inspect(p) {
  await control('查看'); await click(p);
  await wait(p => { const selected = window.voxel.snapshot().selected; return selected?.x === p.x && selected?.y === p.y && selected?.z === Math.floor(p.z); }, p);
}
async function importFile(filename, tick) {
  await control('菜单与存档');
  const chooser = page.waitForEvent('filechooser');
  await control('导入体素存档'); await (await chooser).setFiles(path.resolve(filename));
  await wait(t => window.voxel.snapshot().snapshot.tick === t && window.voxel.snapshot().snapshot.speed === 0, tick);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForTimeout(350);
}
async function reachable(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const result = await locator.evaluate(el => {
    const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, width: r.width, height: r.height, viewport: [innerWidth, innerHeight], hit: top === el || el.contains(top) };
  });
  assert.ok(result.hit && result.x >= 0 && result.y >= 0 && result.x < result.viewport[0] && result.y < result.viewport[1], `${label} cannot be reached: ${JSON.stringify(result)}`);
  return result;
}
async function pixelDifference(a, b) {
  return page.evaluate(async buffers => {
    const images = await Promise.all(buffers.map(base64 => new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image); image.src = 'data:image/png;base64,' + base64; })));
    const pixels = images.map(image => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height).data; });
    let changed = 0, overTwo = 0, maxDelta = 0;
    for (let i = 0; i < pixels[0].length; i += 4) { let delta = 0; for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(pixels[0][i + c] - pixels[1][i + c])); if (delta) changed++; if (delta > 2) overTwo++; maxDelta = Math.max(delta, maxDelta); }
    return { changed, overTwo, maxDelta };
  }, [a.toString('base64'), b.toString('base64')]);
}

async function generateCalendarFixtures(uiSave) {
  const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
  const { VoxelSimulation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const source = `${OUT}/ui-grown-seedlings.json`;
  await writeFile(source, JSON.stringify(uiSave));
  const sim = VoxelSimulation.load(structuredClone(uiSave));
  const origin = { source, sha256: digest(uiSave), tick: sim.tick, worldSourceSha256: digest(await readFile('src/voxel/world.ts')), commands: [] };
  const issue = command => { const result = sim.command(command); origin.commands.push({ tick: sim.tick, command, result }); assert.ok(result.ok, JSON.stringify({ command, result })); };
  const until = (label, condition, limit = 24000) => {
    const start = sim.tick; while (!condition() && sim.tick - start < limit) sim.step();
    assert.ok(condition(), `${label} fixture timed out: ${JSON.stringify({ tick: sim.tick, crops: sim.crops, jobs: sim.jobs, pawns: sim.pawns })}`);
  };
  until('normal calendar approaches first rice harvest', () => sim.crops.some(c => c.kind === 'rice' && c.growth >= .998), 240000);
  assert.equal(sim.stats.harvested, 0, 'near-harvest fixture must precede the first real harvest');
  const near = structuredClone(sim.save()), nearPath = `${OUT}/normal-near-harvest.json`;
  await writeFile(nearPath, JSON.stringify(near));
  report.fixtures.push({ ...structuredClone(origin), file: nearPath, sha256: digest(near), tick: sim.tick, stats: structuredClone(sim.stats), growth: sim.crops.map(c => ({ kind: c.kind, growth: c.growth, sownAt: c.sownAt })) });
  issue({ type: 'bill', stoveId: sim.stoves[0].id, target: 5, paused: true });
  until('normal harvesting supplies upper kitchen', () => sim.counts().grain >= 30, 24000);
  issue({ type: 'designate', tool: 'up', from: pos(33, 32) });
  until('upper ladder construction', () => [8, 9, 10, 11].every(z => sim.ladders[(z * 64 + 32) * 64 + 33]));
  issue({ type: 'designate', tool: 'floor', from: pos(34, 31, 11), to: pos(35, 32, 11) });
  until('upper kitchen floor', () => [34, 35].every(x => [31, 32].every(y => sim.blocks[(10 * 64 + y) * 64 + x] === 4)));
  issue({ type: 'designate', tool: 'stove', from: pos(35, 31, 11) });
  until('upper stove construction', () => sim.stoves.some(stove => stove.z === 11));
  const upper = sim.stoves.find(stove => stove.z === 11);
  issue({ type: 'bill', stoveId: upper.id, target: 5, paused: false });
  const cross = structuredClone(sim.save()), crossPath = `${OUT}/normal-upper-kitchen.json`;
  await writeFile(crossPath, JSON.stringify(cross));
  report.fixtures.push({ ...structuredClone(origin), file: crossPath, sha256: digest(cross), tick: sim.tick, stats: structuredClone(sim.stats), counts: sim.counts() });
  await writeFile(`${OUT}/fixture-provenance.json`, JSON.stringify(report.fixtures, null, 2));
  return { near, nearPath, cross, crossPath };
}

try {
  await page.goto(BASE);
  await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().metrics.pendingChunks === 0);
  await importLegacyStart(page);
    await pause(); await control('收起指引');
  for (const name of ['种植区', '灶台', '暂停', '3倍速', '菜单与存档'])
    await reachable(page.getByRole('button', { name, exact: true }), name);
  await control('种植区'); await page.getByLabel('种植作物', { exact: true }).selectOption('rice');
  await drag('种植区', pos(29, 28), pos(31, 30));
  await wait(() => window.voxel.snapshot().snapshot.farms.filter(f => f.crop === 'rice').length === 9);
  await page.getByLabel('种植作物', { exact: true }).selectOption('potato'); await drag('种植区', pos(33, 28));
  await page.getByLabel('种植作物', { exact: true }).selectOption('corn'); await drag('种植区', pos(35, 28));
  await wait(() => window.voxel.snapshot().snapshot.farms.length === 11);
  assert.deepEqual((await state()).snapshot.farms.reduce((out, farm) => ({ ...out, [farm.crop]: (out[farm.crop] ?? 0) + 1 }), {}), { rice: 9, potato: 1, corn: 1 });
  record('DOM crop selector and real mouse drag create three crop types', { plots: 11 });
  await run(); await wait(() => window.voxel.snapshot().snapshot.crops.length === 11); await pause();
  await inspect(pos(29, 28));
  const detail = await page.getByTestId('voxel-inspector').innerText();
  assert.match(detail, /肥力/); assert.match(detail, /光照/); assert.match(detail, /本轮生长/);
  assert.ok((await state()).snapshot.crops.every(c => c.growth >= 0 && c.growth < .1));
  record('actual sowing produces seedlings and visible environmental conditions', { detail });
  await drag('灶台', pos(32, 31)); await run(); await wait(() => window.voxel.snapshot().snapshot.stoves.length === 1); await pause();
  await inspect(pos(32, 31, 8.8));
  assert.match(await page.getByTestId('voxel-inspector').innerText(), /烧木灶台/);
  await page.getByLabel('简餐库存目标', { exact: true }).selectOption('5');
  await wait(() => window.voxel.snapshot().snapshot.stoves[0].target === 5);
  await control('暂停烹饪'); await wait(() => window.voxel.snapshot().snapshot.stoves[0].paused);
  await control('恢复烹饪'); await wait(() => !window.voxel.snapshot().snapshot.stoves[0].paused);
  record('stove body inspection and bill target / pause / resume work through DOM');
  await screenshot('01-seedlings-and-stove-1280');
  const uiSave = await page.evaluate(() => window.voxel.exportSave());
  const fixtures = await generateCalendarFixtures(uiSave);
  record('calendar fixtures generated from UI save using normal commands and step only', { fixtures: report.fixtures.map(f => ({ file: f.file, tick: f.tick, sha256: f.sha256 })) });
  await importFile(fixtures.nearPath, fixtures.near.tick);
  await inspect(pos(29, 28)); await screenshot('02-near-harvest-import');
  await run();
  await wait(() => window.voxel.snapshot().snapshot.stats.harvested >= 2, undefined, 45000);
  await wait(() => { const s = window.voxel.snapshot().snapshot; return s.jobs.some(job => job.kind === 'cook' && job.progress > 5 && job.progress < job.work - 5); }, undefined, 45000);
  await pause();
  const cooking = (await state()).snapshot;
  assert.ok(cooking.stats.harvested >= 2 && cooking.stats.produced.grain >= 12);
  assert.ok(cooking.jobs.some(job => job.kind === 'cook' && job.delivered.grain === 10 && job.delivered.wood === 1));
  record('imported normal-growth crops are actually harvested and ingredients delivered for cooking', { tick: cooking.tick, stats: cooking.stats });
  await inspect(pos(32, 31, 8.8)); await screenshot('03-real-cooking-paused');
  const stovePoint = await point(pos(32, 31, 8.8));
  const clip = { x: Math.floor(stovePoint.x - 70), y: Math.floor(stovePoint.y - 65), width: 140, height: 150 };
  await page.mouse.move(1270, 2); await page.waitForTimeout(500);
  const a = await page.screenshot({ clip }); await page.waitForTimeout(650); const b = await page.screenshot({ clip });
  await writeFile(`${OUT}/paused-stove-a.png`, a); await writeFile(`${OUT}/paused-stove-b.png`, b);
  const diff = await pixelDifference(a, b); assert.equal(diff.overTwo, 0, 'paused stove/pawn particles must not animate');
  record('paused cooking scene pixels stable within GPU rounding', diff);
  await run(); await wait(count => window.voxel.snapshot().snapshot.stats.cooked > count, cooking.stats.cooked); await pause();
  record('real cooking completes a meal', { stats: (await state()).snapshot.stats, inventory: (await state()).snapshot.inventory });
  await importFile(fixtures.crossPath, fixtures.cross.tick);
  await control('二层'); await control('查看'); await inspect(pos(35, 31, 11.8));
  assert.match(await page.getByTestId('voxel-inspector').innerText(), /烧木灶台/);
  const beforeCross = (await state()).snapshot.stats.cooked;
  // One-times speed makes the intermediate ladder steps observable at the 200 ms snapshot cadence.
  await control('1倍速');
  await wait(() => window.voxel.snapshot().snapshot.pawns.some(pawn => pawn.cargo?.resource === 'grain' && pawn.x === 33 && pawn.y === 32 && pawn.z > 8 && pawn.z < 11), undefined, 45000);
  const ladderObservation = (await state()).snapshot.pawns.filter(pawn => pawn.cargo?.resource === 'grain' && pawn.x === 33 && pawn.y === 32 && pawn.z > 8 && pawn.z < 11);
  assert.ok(ladderObservation.length, 'ingredient carrier was not observed between floors');
  await pause();
  record('real colonist carries harvested grain through an intermediate ladder level', { carriers: ladderObservation });
  await screenshot('04-grain-on-upper-ladder');
  await run(); await wait(count => window.voxel.snapshot().snapshot.stats.cooked > count, beforeCross, 45000); await pause();
  record('upper kitchen cooks using physically delivered cross-level ingredients', { stats: (await state()).snapshot.stats });
  await screenshot('05-upper-kitchen-1280');
  await page.setViewportSize({ width: 900, height: 700 }); await page.waitForTimeout(350);
  const reachability = [];
  for (const name of ['种植区', '灶台', '擦除区域', '取消规划', '暂停', '3倍速', '菜单与存档'])
    reachability.push({ name, ...await reachable(page.getByRole('button', { name, exact: true }), name) });
  await control('种植区'); await reachable(page.getByLabel('种植作物', { exact: true }), '种植作物');
  await page.getByLabel('种植作物', { exact: true }).selectOption('potato');
  assert.equal((await state()).crop, 'potato');
  await inspect(pos(35, 31, 11.8));
  await reachable(page.getByLabel('简餐库存目标', { exact: true }), '简餐库存目标');
  await page.getByLabel('简餐库存目标', { exact: true }).selectOption('10');
  await wait(() => window.voxel.snapshot().snapshot.stoves.find(stove => stove.z === 11).target === 10);
  await control('暂停烹饪'); await wait(() => window.voxel.snapshot().snapshot.stoves.find(stove => stove.z === 11).paused);
  await control('恢复烹饪'); await wait(() => !window.voxel.snapshot().snapshot.stoves.find(stove => stove.z === 11).paused);
  record('900x700 critical controls are reachable through actual toolbar/panel scrolling', { reachability });
  await screenshot('06-upper-kitchen-900');
  await control('菜单与存档');
  for (const name of ['保存营地', '导出体素存档', '导入体素存档', '关闭菜单'])
    await reachable(page.getByRole('button', { name, exact: true }), name);
  await screenshot('07-save-menu-900'); await control('关闭菜单');
  await Promise.all(assetReads);
  const productionAssets = report.assets.filter(asset => asset.localFile);
  if (productionAssets.length) {
    assert.ok(productionAssets.every(asset => asset.matchesLocalBuild), 'served asset content must match the frozen local build');
    record('loaded production asset bytes match frozen dist assets', { assets: productionAssets.map(asset => ({ url: asset.url, sha256: asset.sha256, bytes: asset.bytes })) });
  }
  assert.deepEqual(report.errors, []);
  report.final = { viewport: page.viewportSize(), tick: (await state()).snapshot.tick, stats: (await state()).snapshot.stats, worker: (await state()).worker, metrics: (await state()).metrics };
  report.status = 'passed'; console.log('PASS voxel food browser', report.checks.length);
} catch (error) {
  report.status = 'failed'; report.errors.push(String(error.stack ?? error));
  await screenshot('failure').catch(() => {});
  await writeFile(`${OUT}/failed-state.json`, JSON.stringify(await page.evaluate(() => window.voxel?.exportSave()).catch(() => null)));
  throw error;
} finally {
  await Promise.all(assetReads); report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close();
}
