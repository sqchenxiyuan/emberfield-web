import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_EXPLORATION_URL ?? 'http://127.0.0.1:4182/?world=voxel';
const OUT = process.env.VOXEL_EXPLORATION_BROWSER_OUT ?? 'test-results/voxel-exploration-browser';
const FIXTURES = process.env.VOXEL_EXPLORATION_FIXTURES ?? 'test-results/voxel-exploration';
const modes = process.env.VOXEL_EXPLORATION_BROWSER_MODE ? [process.env.VOXEL_EXPLORATION_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(m => ['worker', 'main'].includes(m)));
try { await access(`${OUT}/report.json`); throw Error(`Refusing to overwrite prior evidence: ${OUT}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const verifyBuild = !!process.env.VOXEL_EXPLORATION_VERIFY_BUILD || !['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), digest = data => sha(JSON.stringify(data));
await mkdir(OUT, { recursive: true });
const bytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(bytes), contract = campaign.browser;
assert.equal(campaign.status, 'passed');
const manifest = await readFile(`${FIXTURES}/source-manifest.json`); assert.equal(sha(manifest), campaign.execution.sourceManifestSha256);
for (const entry of JSON.parse(manifest)) assert.equal(sha(await readFile(entry.file)), entry.sha256, `current campaign source ${entry.file}`);
const report = { version: 36, status: 'running', startedAt: new Date().toISOString(), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${FIXTURES}/report.json`, sha256: sha(bytes), sourceManifestSha256: campaign.execution.sourceManifestSha256 },
  scope: 'Fresh generator-3 worlds created from regional UI; all mutations use visible controls, map clicks, keyboard and real download/file chooser. Read-only snapshot/project/exportSave/blockAt/ladderAt/exploredAt verify rendering and physical effects. The excavation route comes from the API campaign authoritative terrain inspection; this is not a screen-only discovery claim. No campaign fixture is imported to shortcut digging. Genuine historical saves are imported only for explicit compatibility checks.', modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function verify(mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), url = new URL(BASE); url.searchParams.set('world', 'voxel');
  if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
  const result = { mode, checks: [], screenshots: [], assets: [], errors: [], saves: [] }, reads = []; report.modes.push(result);
  page.on('pageerror', e => result.errors.push(e.stack ?? e.message)); page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  page.on('response', response => {
    if (!new URL(response.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
    reads.push(response.body().then(async data => { asset.sha256 = sha(data); asset.bytes = data.length; asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256; }).catch(e => { asset.error = String(e); }));
  });
  const state = () => page.evaluate(() => window.voxel.snapshot()), saved = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = name => page.getByRole('button', { name, exact: true });
  const click = async name => { await button(name).scrollIntoViewIfNeeded(); await button(name).click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot?.speed === 0);
    if (/^[123]倍速$/.test(name)) await wait(n => window.voxel.snapshot().snapshot?.speed === n, Number(name[0])); };
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  const settle = async () => { await page.waitForTimeout(140); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
  async function shot(name, locator) { if (locator) await locator.evaluate(e => e.scrollIntoView({ block: 'center' })); await settle(); await page.locator('.voxel-toast').waitFor({ state: 'hidden', timeout: 8000 }); const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file); }
  async function level(z) { for (let n = 0; (await state()).level !== z && n < 16; n++) await click((await state()).level < z ? '上移一层' : '下移一层'); assert.equal((await state()).level, z); await settle(); }
  async function target(p) {
    const q = await page.evaluate(p => window.voxel.project(p), p), box = await page.locator('canvas[aria-label="多层体素地图"]').boundingBox(); assert(box);
    await page.mouse.click(box.x + q.x, box.y + q.y); await page.waitForTimeout(180);
  }
  async function select(p) { await click('查看'); await level(p.z); await target(p); await wait(p => { const q = window.voxel.snapshot().selected; return q?.x === p.x && q.y === p.y && q.z === p.z; }, p); }
  async function designate(name, p) { await level(p.z); await click(name); await target(p); }
  async function runUntil(fn, arg, timeout = 60000) { await click('3倍速'); await wait(fn, arg, timeout); await click('暂停'); }
  async function importFile(file, expected) {
    if (!await page.getByRole('dialog').isVisible()) await click('菜单与存档');
    const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot?.tick === t, expected.tick); await settle();
  }
  async function roundtrip(name) {
    const before = await saved(); await click('菜单与存档'); const download = page.waitForEvent('download'); await click('导出体素存档');
    const file = `${OUT}/${mode}-${name}.json`; await (await download).saveAs(file); const raw = await readFile(file);
    await importFile(file, before); const after = await saved();
    for (const field of ['worldSite', 'seed', 'settings', 'blocks', 'explored', 'items', 'stats']) assert.deepEqual(after[field], before[field], field);
    assert.deepEqual(after.pawns.map(p => p.cargo), before.pawns.map(p => p.cargo));
    const jobs = list => list.map(({ owner, reason, ...j }) => j); assert.deepEqual(jobs(after.jobs), jobs(before.jobs));
    result.saves.push({ file, sha256: sha(raw), tick: after.tick, known: after.explored.reduce((n, v) => n + v, 0) });
    check('real file export and import preserve permanent exploration terrain items cargo and queued work', { name, tick: before.tick }); return file;
  }
  try {
    await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await click('暂停');
    if (await button('收起指引').isVisible()) await click('收起指引'); assert.equal((await state()).worker, mode === 'worker');
    await click('菜单与存档'); await page.locator('[data-testid="world-preview"][data-ready="true"]').waitFor();
    await page.getByRole('textbox', { name: '体素世界种子' }).fill(String(contract.site.worldSeed));
    await page.locator(`[data-testid="region-tile"][data-region-id="${contract.site.tileId}"]`).click();
    await page.locator(`[data-testid="world-preview"][data-ready="true"][data-site-id="${contract.site.tileId}"][data-generator="3"]`).waitFor();
    const previewText = await page.getByTestId('world-preview').innerText(); assert(!previewText.includes('地下钢矿 / 零件矿')); assert(previewText.includes('进入营地后探索'));
    await page.getByTestId('world-exploration-guide').waitFor(); await shot('exploration-setup', page.getByTestId('world-preview'));
    await click('新开世界（替换当前进度）'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await wait(site => { const s = window.voxel.snapshot().snapshot; return s.generator === 3 && s.worldSite?.version === 2 && s.worldSite.tileId === site.tileId && s.tick === 0; }, contract.site);
    await settle(); const initial = await saved(); const expected = JSON.parse(await readFile(campaign.fixtures.initial.file));
    for (const field of ['worldSite', 'seed', 'settings', 'blocks', 'explored', 'items']) assert.deepEqual(initial[field], expected[field], field);
    assert.deepEqual((await state()).snapshot.worldSummary, contract.initialSummary);
    const maskBefore = digest(initial.explored);
    for (const p of [contract.hiddenAir, contract.hiddenOre]) {
      await select(p); await page.getByTestId('unexplored-detail').waitFor();
      assert.equal(await page.evaluate(p => window.voxel.exploredAt(p), p), false);
      assert.equal(await page.evaluate(p => window.voxel.blockAt(p), p), 2);
      const text = await page.getByTestId('voxel-inspector').innerText(); assert(text.includes('未探索区域'));
      assert(!/钢矿|机械矿|花岗岩|基岩|格体积|封闭房间/.test(text));
      assert.equal(await page.locator('.voxel-room-detail').count(), 0);
      await designate('墙壁', p); assert(!(await state()).snapshot.jobs.some(j => j.kind === 'wall')); await page.getByRole('status').filter({ hasText: '未探索' }).waitFor();
      await select(p); await page.getByTestId('exploration-designate').click();
      await wait(p => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'mine' && j.x === p.x && j.y === p.y && j.z === p.z), p);
      await click('取消此处探索工作'); await wait(() => window.voxel.snapshot().snapshot.jobs.length === 0);
    }
    assert.equal(digest((await saved()).explored), maskBefore);
    await level(contract.route.bottom.z); await wait(z => window.voxel.snapshot().metrics.exploration?.level === z, contract.route.bottom.z);
    assert((await state()).metrics.exploration.unknownCells > 3000); await shot('sealed-underground-mask');
    await page.setViewportSize({ width: 900, height: 700 }); await select(contract.hiddenAir); await page.getByTestId('exploration-designate').scrollIntoViewIfNeeded(); await page.getByTestId('exploration-designate').click({ trial: true }); await shot('unexplored-900'); await page.setViewportSize({ width: 1440, height: 960 });
    check('new UI world hides cave air and ore alike across layer changes selection building refusal and 900px layout');
    for (const p of contract.storage) { await designate('仓储', p); await wait(p => window.voxel.snapshot().snapshot.stockpiles.some(s => s.x === p.x && s.y === p.y && s.z === p.z), p); }
    const route = contract.route;
    for (let z = route.surface.z; z > route.bottom.z; z -= 3) {
      const p = { ...route.surface, z }; await designate('下挖梯井', p);
      await wait(() => window.voxel.snapshot().snapshot.jobs.some(j => ['digLadder', 'ladder'].includes(j.kind)));
      await runUntil(p => window.voxel.ladderAt(p) === 1 && !window.voxel.snapshot().snapshot.jobs.some(j => ['digLadder', 'ladder'].includes(j.kind)), { ...route.bottom, z: z - 3 });
    }
    assert.equal(await page.evaluate(p => window.voxel.exploredAt(p), route.entry), false);
    await level(route.bottom.z); await shot('shaft-before-cave');
    check('ordinary map clicks excavate two real ladder segments while the sealed cave stays hidden');
    const shaftMask = digest((await saved()).explored);
    for (const p of [...route.passage, route.entry]) { await designate('挖掘', p); await wait(p => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'mine' && j.x === p.x && j.y === p.y && j.z === p.z), p); }
    assert.equal(digest((await saved()).explored), shaftMask); await roundtrip('planned-blind-excavation');
    await level(route.bottom.z); await shot('blind-plan-including-hidden-air');
    await runUntil(p => window.voxel.exploredAt(p) && !window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'mine'), route.entry);
    assert(await page.evaluate(cells => cells.every(p => window.voxel.exploredAt(p)), route.caveCells));
    const opened = await saved(); assert(opened.explored.reduce((n, v) => n + v, 0) > initial.explored.reduce((n, v) => n + v, 0) + 500);
    await select(route.entry); assert.equal(await page.getByTestId('unexplored-detail').count(), 0); await shot('opened-cave');
    check('blind excavation physically opens the cave reveals its interior and clears the redundant hidden-air order');
    await select(route.ore.target); assert((await page.getByTestId('voxel-inspector').innerText()).match(/钢矿|有地板|花岗岩/));
    const beforeSteel = (await state()).snapshot.stats.produced.steel;
    await designate('挖掘', route.ore.target);
    await runUntil(z => window.voxel.snapshot().snapshot.pawns.some(p => p.cargo?.resource === 'steel' && p.z <= z), route.bottom.z);
    const carrying = (await state()).snapshot.pawns.find(p => p.cargo?.resource === 'steel' && p.z <= route.bottom.z); assert(carrying);
    await page.locator(`[data-colonist-id="${carrying.id}"]`).click(); await shot('physical-underground-steel-cargo'); await roundtrip('carrying-discovered-steel');
    await runUntil(() => { const s = window.voxel.snapshot().snapshot; return s.stored.steel === s.inventory.steel && !s.pawns.some(p => p.cargo?.resource === 'steel'); });
    const completed = await saved(); assert(completed.stats.produced.steel > beforeSteel);
    const stored = (await state()).snapshot.items.filter(i => i.resource === 'steel' && i.z >= route.surface.z); assert(stored.length);
    check('a real miner and hauler transport finite discovered steel from the cave through the shaft to surface storage', { producedSteel: completed.stats.produced.steel - beforeSteel, carrierId: carrying.id, cargoLayer: carrying.z, storedSteel: (await state()).snapshot.stored.steel, tick: completed.tick });
    const finalFile = await roundtrip('completed-exploration'); await level(route.bottom.z); await shot('permanent-exploration-after-reload');
    for (const legacy of contract.legacy) {
      const raw = await readFile(legacy.file); assert.equal(sha(raw), legacy.sha256); const old = JSON.parse(raw); await importFile(legacy.file, old);
      const migrated = await saved(); assert.equal(migrated.generator, legacy.generator); assert(migrated.explored.every(v => v === 1)); assert.deepEqual(migrated.blocks, old.blocks);
      if (old.worldSite) assert.deepEqual(migrated.worldSite, old.worldSite);
      await level(2); await wait(() => window.voxel.snapshot().metrics.exploration?.level === 2 && window.voxel.snapshot().metrics.exploration?.unknownCells === 0);
      await shot(`legacy-gen${legacy.generator}-known-underground`);
    }
    await importFile(finalFile, completed); assert.deepEqual((await saved()).explored, completed.explored);
    check('genuine gen1 and gen2 saves remain fully visible and restoring gen3 keeps its partial permanent mask');
    await Promise.all(reads); assert.equal(result.errors.length, 0, result.errors.join('\n'));
    if (verifyBuild) {
      for (const pattern of [/\/main-[^/]+\.js$/, /\/sim\.worker-[^/]+\.js$/, /\.css$/]) assert(result.assets.some(a => pattern.test(new URL(a.url).pathname)));
      if (mode === 'worker') assert(result.assets.some(a => /\/render\.worker-[^/]+\.js$/.test(new URL(a.url).pathname)));
      assert(result.assets.every(a => a.status === 200 && a.matchesLocalBuild && !a.error));
    }
    result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.failure = error.stack ?? String(error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { await browser.close(); report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
