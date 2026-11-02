import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_PRESERVATION_BROWSER_OUT ?? 'test-results/voxel-preservation-browser';
const INPUT = process.env.VOXEL_PRESERVATION_OUT ?? 'test-results/voxel-preservation-campaign';
const MODES = process.env.VOXEL_PRESERVATION_MODES?.split(',') ?? ['worker', 'main'];
const digest = (v) => createHash('sha256').update(v).digest('hex');
const pos = (x, y, z = 5) => ({ x, y, z });
await mkdir(path.join(OUT, 'fixtures'), { recursive: true });
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  fixtures: {},
  modes: [],
  scope:
    'Chrome DOM, mouse, keyboard and file chooser. Read-only window.voxel for projection, snapshots and save export; no simulation mutation through debug APIs. Uses frozen bytes from normal farming, mining, power and cooking campaigns. Both render Worker and main fallback. Explicitly accelerated campaign fixtures, not a native RimWorld run.',
};
const fixtures = {};
for (const name of ['warm-stock', 'cold-stock', 'near-spoilage']) {
  const bytes = await readFile(path.join(INPUT, `${name}.json`)),
    file = path.join(OUT, 'fixtures', `${name}.json`);
  await writeFile(file, bytes);
  fixtures[name] = { file, save: JSON.parse(bytes) };
  report.fixtures[name] = { file, sha256: digest(bytes), tick: fixtures[name].save.tick };
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function modeRun(mode) {
  const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    }),
    page = await context.newPage();
  const url = new URL(BASE);
  if (mode === 'main') url.searchParams.set('render', 'main');
  else url.searchParams.delete('render');
  const result = { mode, url: String(url), checks: [], errors: [], assets: [], screenshots: [] };
  report.modes.push(result);
  const reads = [];
  page.on('pageerror', (e) => result.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') result.errors.push(m.text());
  });
  page.on('response', (response) => {
    if (!new URL(response.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const a = { url: response.url(), status: response.status() };
    result.assets.push(a);
    reads.push(
      response
        .body()
        .then(async (b) => {
          a.sha256 = digest(b);
          a.bytes = b.length;
          a.localFile = `dist/assets/${path.basename(new URL(a.url).pathname)}`;
          a.matchesLocalBuild = digest(await readFile(a.localFile)) === a.sha256;
        })
        .catch((e) => {
          a.error = String(e);
        }),
    );
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const wait = (fn, arg, timeout = 45000) => page.waitForFunction(fn, arg, { timeout });
  const button = (name) => page.getByRole('button', { name, exact: true });
  async function control(name) {
    await button(name).scrollIntoViewIfNeeded();
    await button(name).click();
  }
  async function pause() {
    await control('暂停');
    await wait(() => window.voxel.snapshot().snapshot.speed === 0);
  }
  async function run() {
    await control('3倍速');
    await wait(() => window.voxel.snapshot().snapshot.speed === 3);
  }
  const project = (p) => page.evaluate((p) => window.voxel.project(p), p);
  async function click(p) {
    const q = await project(p);
    await page.mouse.click(q.x, q.y);
  }
  async function layer(z) {
    await control(z === 5 ? '地下' : '地表');
    await wait(
      (z) =>
        window.voxel.snapshot().metrics.level === z &&
        window.voxel.snapshot().metrics.pendingChunks === 0,
      z,
    );
  }
  async function inspect(p) {
    await layer(p.z);
    await control('查看');
    // Pawn bodies can cover a neighboring floor cell in an isometric view.
    // Click visible points within the requested cell, never set selection by API.
    for (const [dx,dy] of [[0,0],[-.3,-.3],[.3,-.3],[.3,.3],[-.3,.3]]) {
      await click({x:p.x+dx,y:p.y+dy,z:p.z+.05});
      await page.waitForTimeout(180);
      const q=(await state()).selected;
      if(q?.x===p.x&&q?.y===p.y&&q?.z===p.z)return;
    }
    assert.fail(`visible inspection failed for ${JSON.stringify(p)}, selected ${JSON.stringify((await state()).selected)}`);
  }
  async function load(name) {
    await control('菜单与存档');
    const choosing = page.waitForEvent('filechooser');
    await control('导入体素存档');
    await (await choosing).setFiles(path.resolve(fixtures[name].file));
    await wait(
      (t) =>
        window.voxel.snapshot().snapshot.tick === t && window.voxel.snapshot().snapshot.speed === 0,
      fixtures[name].save.tick,
    );
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  async function shot(name) {
    await page.locator('.voxel-toast').waitFor({state:'hidden',timeout:8000});
    const file = path.join(OUT, `${mode}-${name}.png`);
    await page.screenshot({ path: file });
    result.screenshots.push(file);
  }
  const record = (name, data = {}) => {
    result.checks.push({ name, ...data });
    console.log('PASS', mode, name, JSON.stringify(data));
  };
  async function reachable(locator, name) {
    await locator.scrollIntoViewIfNeeded();
    const v = await locator.evaluate((e) => {
      const r = e.getBoundingClientRect(),
        x = r.x + r.width / 2,
        y = r.y + r.height / 2,
        t = document.elementFromPoint(x, y);
      return {
        x,
        y,
        hit: t === e || e.contains(t),
        inside: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
      };
    });
    assert.ok(v.hit && v.inside, `${name} unreachable`);
    return { name, ...v };
  }
  try {
    await page.goto(String(url));
    await wait(
      () => window.voxel?.snapshot().ready && window.voxel.snapshot().metrics.pendingChunks === 0,
    );
    await pause();
    await control('收起指引');
    assert.equal((await state()).worker, mode === 'worker');
    record('expected renderer backend');
    await load('warm-stock');
    let meal = (await state()).snapshot.items.find((i) => i.resource === 'meal');
    assert.ok(meal);
    await inspect(meal);
    await page.getByTestId('item-detail').filter({ hasText: '简餐' }).scrollIntoViewIfNeeded();
    const warmText = await page.getByTestId('item-detail').filter({ hasText: '简餐' }).innerText();
    assert.match(warmText, /未冷藏/);
    assert.match(warmText, /预计.*日后腐坏/);
    assert.ok(meal.rotProgress > 0);
    record('naturally cooked warm meal displays existing age and temperature forecast', {
      text: warmText,
      rotProgress: meal.rotProgress,
    });
    await shot('01-warm-meals');

    await layer(5);
    await control('仓储');
    const a = await project(pos(35, 29)),
      b = await project(pos(37, 30));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await wait(
      () => window.voxel.snapshot().snapshot.stockpiles.filter((s) => s.z === 5).length === 6,
    );
    await inspect(pos(35, 29));
    await page.getByLabel('仓储优先级', { exact: true }).selectOption('3');
    await control('仅收食物');
    await wait(() =>
      window.voxel
        .snapshot()
        .snapshot.stockpiles.filter((s) => s.z === 5)
        .every((s) => s.priority === 3 && s.accepts.length === 3 && s.accepts.includes('meal')),
    );
    record(
      'real drag creates six storage cells and DOM applies food filter and priority to connected zone',
    );
    await run();
    await wait(
      () => {
        const s = window.voxel.snapshot().snapshot;
        return (
          s.items.some((i) => i.resource === 'meal' && i.z === 5) &&
          s.items.filter((i) => i.resource === 'meal').every((i) => i.z === 5) &&
          !s.pawns.some((p) => p.cargo?.resource === 'meal')
        );
      },
      undefined,
      90000,
    );
    await pause();
    meal = (await state()).snapshot.items.find((i) => i.resource === 'meal' && i.z === 5);
    assert.ok(meal.rotProgress > 0);
    record(
      'workers move aged meals from existing surface storage into higher-priority underground storage',
      { meal },
    );
    await inspect(meal);
    await shot('02-cold-storage');

    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(300);
    await inspect(pos(35, 29));
    const reachableControls = [];
    reachableControls.push(
      await reachable(page.getByLabel('仓储优先级', { exact: true }), '仓储优先级'),
    );
    reachableControls.push(
      await reachable(page.getByLabel('应用到同层相连仓储', { exact: true }), '应用范围'),
    );
    for (const name of ['收纳全部', '仅收食物', '仅收建材', '停止收纳'])
      reachableControls.push(await reachable(button(name), name));
    for (const name of ['木材', '石料', '钢材', '零件', '包装生存口粮', '生食材', '简餐'])
      reachableControls.push(
        await reachable(page.getByLabel(`收纳${name}`, { exact: true }), `收纳${name}`),
      );
    await page.getByLabel('应用到同层相连仓储', { exact: true }).uncheck();
    await control('停止收纳');
    await wait(() => {
      const q = window.voxel.snapshot().snapshot.stockpiles;
      return (
        q.find((s) => s.x === 35 && s.y === 29 && s.z === 5)?.accepts.length === 0 &&
        q.filter((s) => s.z === 5 && s.accepts.length === 3).length === 5
      );
    });
    await control('仅收食物');
    await page.getByLabel('应用到同层相连仓储', { exact: true }).check();
    record(
      '900x700 storage controls are reachable and single-cell scope does not alter neighboring rules',
      { controls: reachableControls },
    );
    await shot('03-storage-900');

    await load('cold-stock');
    await page.setViewportSize({ width: 1280, height: 800 });
    meal = (await state()).snapshot.items.find((i) => i.resource === 'meal' && i.z === 5);
    await inspect(meal);
    await page.getByTestId('item-detail').filter({ hasText: '简餐' }).scrollIntoViewIfNeeded();
    const frozenText = await page
      .getByTestId('item-detail')
      .filter({ hasText: '简餐' })
      .innerText();
    assert.match(frozenText, /冻结.*腐坏暂停/s);
    record('powered freezer shows halted spoilage and remaining warm shelf life', {
      text: frozenText,
    });
    await shot('04-frozen-food');
    const saveBefore = await page.evaluate(() => window.voxel.exportSave());
    assert.equal(saveBefore.version, 5);
    await control('菜单与存档');
    await control('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    await control('关闭菜单');
    await inspect(pos(35, 29));
    await control('停止收纳');
    await control('菜单与存档');
    await control('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait((t) => window.voxel.snapshot().snapshot.tick === t, saveBefore.tick);
    const saveAfter = await page.evaluate(() => window.voxel.exportSave());
    for (const k of ['items', 'stockpiles', 'stats', 'thermal'])
      assert.deepEqual(saveAfter[k], saveBefore[k]);
    assert.deepEqual(
      saveAfter.pawns.map((p) => p.cargo),
      saveBefore.pawns.map((p) => p.cargo),
    );
    assert.deepEqual(
      saveAfter.jobs.map((j) => [j.id, j.delivered, j.deliveredFood]),
      saveBefore.jobs.map((j) => [j.id, j.delivered, j.deliveredFood]),
    );
    record('DOM v5 save/load preserves food ages species storage filters and all food containers');
    const frozen = (await state()).snapshot,
      ages = new Map(
        frozen.items.filter((i) => i.resource === 'meal').map((i) => [i.id, i.rotProgress]),
      );
    await run();
    await wait((t) => window.voxel.snapshot().snapshot.tick >= t + 160, frozen.tick);
    await pause();
    const kept = (await state()).snapshot.items.filter(
      (i) => i.resource === 'meal' && ages.has(i.id),
    );
    assert.ok(kept.length);
    for (const i of kept) assert.equal(i.rotProgress, ages.get(i.id));
    record('live powered freezing does not advance meal rot age', {
      elapsed: (await state()).snapshot.tick - frozen.tick,
      kept: kept.map((i) => ({ id: i.id, age: i.rotProgress })),
    });

    await load('near-spoilage');
    meal = (await state()).snapshot.items.find((i) => i.resource === 'meal');
    await inspect(meal);
    const before = (await state()).snapshot;
    assert.ok(meal.rotProgress > 47700);
    await shot('05-near-spoilage');
    await run();
    await wait(
      (n) => window.voxel.snapshot().snapshot.stats.spoiled.meal > n,
      before.stats.spoiled.meal,
      30000,
    );
    await pause();
    const after = (await state()).snapshot;
    assert.equal(
      after.inventory.meal +
        after.stats.consumed.meal +
        after.stats.spoiled.meal -
        after.stats.produced.meal,
      before.inventory.meal +
        before.stats.consumed.meal +
        before.stats.spoiled.meal -
        before.stats.produced.meal,
    );
    assert.ok(!after.items.some((i) => i.id === meal.id));
    record('natural warm spoilage removes the real stack and records loss separately from eating', {
      spoiled: after.stats.spoiled.meal - before.stats.spoiled.meal,
      elapsed: after.tick - before.tick,
    });
    await shot('06-spoiled');
    await Promise.all(reads);
    assert.ok(
      result.assets.length >= 5 && result.assets.every((a) => a.matchesLocalBuild),
      'all production bytes match dist',
    );
    assert.deepEqual(result.errors, []);
    result.status = 'passed';
  } catch (e) {
    result.status = 'failed';
    result.errors.push(String(e.stack ?? e));
    await shot('failure').catch(() => {});
    throw e;
  } finally {
    await Promise.all(reads);
    await context.close();
  }
}
try {
  report.sourceHashes = Object.fromEntries(
    await Promise.all(
      [
        'types.ts',
        'world.ts',
        'preservation.ts',
        'main.tsx',
        'style.css',
        'client.ts',
        'renderer.ts',
      ].map(async (f) => [`src/voxel/${f}`, digest(await readFile(`src/voxel/${f}`))]),
    ),
  );
  for (const mode of MODES) await modeRun(mode);
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  throw e;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
