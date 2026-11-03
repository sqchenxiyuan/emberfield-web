import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_STONECUTTING_BROWSER_OUT ?? 'test-results/voxel-stonecutting-browser';
const INPUT = process.env.VOXEL_STONECUTTING_OUT ?? 'test-results/voxel-stonecutting-campaign';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const p = (x, y, z = 8) => ({ x, y, z });
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Actual Chrome mouse/keyboard/DOM/filechooser input; read-only window.voxel projection, snapshots, block lookup and save export. Normal campaign fixtures provide excavated resources and v6 migration evidence. No hidden simulation mutation.',
  fixtures: {},
  modes: [],
};
await mkdir(`${OUT}/fixtures`, { recursive: true });
const fixtures = {};
for (const [name, source] of [
  ['before-table', `${INPUT}/before-table.json`],
  ['first-batch', `${INPUT}/first-batch.json`],
  ['legacy-v6', 'tests/fixtures/voxel-v6-logistics.json'],
]) {
  const bytes = await readFile(source),
    file = `${OUT}/fixtures/${name}.json`;
  await writeFile(file, bytes);
  fixtures[name] = { file, save: JSON.parse(bytes) };
  report.fixtures[name] = { source, sha256: sha(bytes), tick: fixtures[name].save.tick };
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function verify(mode) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage(),
    url = new URL(BASE);
  if (mode === 'main') url.searchParams.set('render', 'main');
  else url.searchParams.delete('render');
  const result = { mode, url: String(url), checks: [], errors: [], assets: [], screenshots: [] };
  report.modes.push(result);
  const reads = [];
  page.on('pageerror', (e) => result.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') result.errors.push(m.text());
  });
  page.on('response', (r) => {
    if (!new URL(r.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const a = { url: r.url(), status: r.status() };
    result.assets.push(a);
    reads.push(
      r
        .body()
        .then(async (bytes) => {
          a.bytes = bytes.length;
          a.sha256 = sha(bytes);
          a.matchesLocalBuild =
            sha(await readFile(`dist/assets/${path.basename(new URL(a.url).pathname)}`)) ===
            a.sha256;
        })
        .catch((e) => {
          a.error = String(e);
        }),
    );
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const wait = (fn, arg, timeout = 90000) => page.waitForFunction(fn, arg, { timeout });
  async function control(name) {
    const b = page.getByRole('button', { name, exact: true });
    await b.scrollIntoViewIfNeeded();
    await b.click();
  }
  async function pause() {
    await control('暂停');
    await wait(() => window.voxel.snapshot().snapshot.speed === 0);
  }
  async function run() {
    await control('3倍速');
    await wait(() => window.voxel.snapshot().snapshot.speed === 3);
  }
  const project = (q) => page.evaluate((q) => window.voxel.project(q), q);
  async function inspect(q) {
    await control('查看');
    for (const [dx, dy] of [
      [0, 0],
      [-0.25, -0.25],
      [0.25, 0.25],
    ]) {
      const point = await project({ x: q.x + dx, y: q.y + dy, z: q.z });
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(200);
      const s = (await state()).selected;
      if (s?.x === Math.floor(q.x) && s?.y === Math.floor(q.y) && s?.z === Math.floor(q.z)) return;
    }
    assert.fail(`cannot inspect ${JSON.stringify(q)}`);
  }
  async function place(tool, q) {
    await control(tool);
    const point = await project(q);
    await page.mouse.click(point.x, point.y);
  }
  async function load(name) {
    await control('菜单与存档');
    const chooser = page.waitForEvent('filechooser');
    await control('导入体素存档');
    await (await chooser).setFiles(fixtures[name].file);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait(
      (t) =>
        window.voxel.snapshot().snapshot.tick === t && window.voxel.snapshot().snapshot.speed === 0,
      fixtures[name].save.tick,
    );
  }
  async function shot(name) {
    await page.locator('.voxel-toast').waitFor({ state: 'hidden', timeout: 8000 });
    const file = `${OUT}/${mode}-${name}.png`;
    await page.screenshot({ path: file });
    result.screenshots.push(file);
  }
  function check(name, data = {}) {
    result.checks.push({ name, ...data });
    console.log('PASS', mode, name);
  }
  async function pixelDifference(a, b) {
    return page.evaluate(
      async (raw) => {
        const pixels = [];
        for (const s of raw) {
          const i = new Image();
          i.src = 'data:image/png;base64,' + s;
          await i.decode();
          const c = document.createElement('canvas');
          c.width = i.width;
          c.height = i.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(i, 0, 0);
          pixels.push(ctx.getImageData(0, 0, c.width, c.height).data);
        }
        let changed = 0;
        for (let i = 0; i < pixels[0].length; i += 4)
          if ([0, 1, 2].some((k) => Math.abs(pixels[0][i + k] - pixels[1][i + k]) > 2)) changed++;
        return changed;
      },
      [a.toString('base64'), b.toString('base64')],
    );
  }
  try {
    await page.goto(String(url));
    await wait(
      () => window.voxel?.snapshot().ready && window.voxel.snapshot().metrics.pendingChunks === 0,
    );
    await pause();
    await control('收起指引');
    assert.equal((await state()).worker, mode === 'worker');
    check('expected renderer backend');
    await load('before-table');
    const rock = (await state()).snapshot.items.find((i) => i.resource === 'chunk' && i.z === 8);
    assert(rock);
    await inspect({ ...rock, z: rock.z + 0.25 });
    assert.match(await page.getByTestId('item-detail').innerText(), /花岗岩块/);
    assert.match(await page.getByTestId('stack-capacity').innerText(), /每堆上限 1/);
    check('irregular chunk model is selectable as a single raw stone');
    await control('切石台');
    await control('旋转建造朝向');
    assert.equal((await state()).axis, 'y');
    await control('旋转建造朝向');
    assert.equal((await state()).axis, 'x');
    await place('切石台', p(34, 34));
    await wait(() =>
      window.voxel
        .snapshot()
        .snapshot.jobs.some(
          (j) => j.kind === 'stonecutter' && j.x === 34 && j.y === 34 && j.axis === 'x',
        ),
    );
    await shot('01-workbench-blueprint');
    await run();
    await wait(() => window.voxel.snapshot().snapshot.stonecutters.length === 1);
    await pause();
    await inspect(p(34, 34, 8.8));
    assert.match(
      await page.getByTestId('stonecutting-bill').innerText(),
      /1 花岗岩块 → 20 花岗岩砖/,
    );
    await page.getByLabel('石砖库存目标', { exact: true }).selectOption('20');
    await wait(() => window.voxel.snapshot().snapshot.stonecutters[0].target === 20);
    if (!(await state()).snapshot.stonecutters[0].paused) {
      await control('暂停切石');
      await wait(() => window.voxel.snapshot().snapshot.stonecutters[0].paused);
    }
    check('real mouse builds a three-cell workbench and DOM configures its batch target');
    await control('恢复切石');
    await wait(() => !window.voxel.snapshot().snapshot.stonecutters[0].paused);
    await run();
    await wait(() =>
      window.voxel
        .snapshot()
        .snapshot.jobs.some((j) => j.kind === 'stonecut' && j.progress > 70 && j.progress < 300),
    );
    await pause();
    await inspect(p(34, 34, 8.8));
    const work = (await state()).snapshot;
    assert(work.jobs.some((j) => j.kind === 'stonecut' && j.delivered.chunk === 1));
    const activeJob = work.jobs.find((j) => j.kind === 'stonecut');
    for (const target of [100, 0, 20]) {
      await page.getByLabel('石砖库存目标', { exact: true }).selectOption(String(target));
      await wait(
        (target) => window.voxel.snapshot().snapshot.stonecutters[0].target === target,
        target,
      );
      const continued = (await state()).snapshot.jobs.find((j) => j.kind === 'stonecut');
      assert.equal(continued.id, activeJob.id);
      assert.equal(continued.progress, activeJob.progress);
      assert.equal(continued.delivered.chunk, 1);
    }
    check('raising and lowering the DOM bill target preserves the current batch and work');
    const point = await project(p(35, 34, 8.5));
    const clip = {
      x: Math.floor(point.x - 90),
      y: Math.floor(point.y - 85),
      width: 180,
      height: 180,
    };
    await page.mouse.move(1275, 2);
    await page.waitForTimeout(400);
    const a = await page.screenshot({ clip });
    await page.waitForTimeout(500);
    const b = await page.screenshot({ clip });
    assert.equal(await pixelDifference(a, b), 0);
    await shot('02-cutting-paused');
    check('one delivered chunk is visible on the workbench and paused work pixels are stable');
    await run();
    await page.waitForTimeout(650);
    const c = await page.screenshot({ clip });
    await page.waitForTimeout(450);
    const d = await page.screenshot({ clip });
    assert((await pixelDifference(c, d)) > 10);
    await pause();
    check('resumed stonecutting visibly animates at the real workbench');
    const oldChunks = (await state()).snapshot.inventory.chunk;
    await control('暂停切石');
    await wait(() => window.voxel.snapshot().snapshot.stonecutters[0].paused);
    assert.equal((await state()).snapshot.inventory.chunk, oldChunks);
    assert(!(await state()).snapshot.jobs.some((j) => j.kind === 'stonecut' && !j.cancelled));
    check('suspending the bill returns its chunk without producing free bricks');
    await control('恢复切石');
    await wait(() => !window.voxel.snapshot().snapshot.stonecutters[0].paused);
    await run();
    await wait(() =>
      window.voxel.snapshot().snapshot.jobs.some((j) => j.kind === 'stonecut' && j.progress > 40),
    );
    await pause();
    const saved = await page.evaluate(() => window.voxel.exportSave());
    assert.equal(saved.version, 13);
    await control('菜单与存档');
    await control('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    await control('关闭菜单');
    await control('菜单与存档');
    await control('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait((t) => window.voxel.snapshot().snapshot.tick === t, saved.tick);
    const loaded = await page.evaluate(() => window.voxel.exportSave());
    assert.equal(
      loaded.jobs.find((j) => j.kind === 'stonecut').progress,
      saved.jobs.find((j) => j.kind === 'stonecut').progress,
    );
    await run();
    await wait(
      () =>
        window.voxel.snapshot().snapshot.inventory.stone === 20 &&
        window.voxel.snapshot().snapshot.stats.stonecut === 1,
    );
    await pause();
    check('DOM save/load continues unfinished cutting into exactly twenty bricks');
    await load('first-batch');
    await place('向上搭梯', p(31, 30));
    await run();
    await wait(() => window.voxel.snapshot().snapshot.jobs.length === 0);
    await pause();
    await control('二层');
    await wait(
      () =>
        window.voxel.snapshot().metrics.level === 11 &&
        window.voxel.snapshot().metrics.pendingChunks === 0,
    );
    await control('楼板');
    await page.getByLabel('建造材料', { exact: true }).selectOption('stone');
    assert.equal((await state()).material, 'stone');
    await place('楼板', p(32, 30, 11));
    await wait(() =>
      window.voxel
        .snapshot()
        .snapshot.jobs.some((j) => j.kind === 'floor' && j.material === 'stone'),
    );
    await run();
    await wait(
      () =>
        window.voxel.blockAt({ x: 32, y: 30, z: 10 }) === 7 &&
        window.voxel.snapshot().snapshot.jobs.length === 0,
    );
    await pause();
    await place('墙壁', p(32, 30, 11));
    await wait(() =>
      window.voxel
        .snapshot()
        .snapshot.jobs.some((j) => j.kind === 'wall' && j.material === 'stone'),
    );
    await run();
    await wait(
      () =>
        window.voxel.blockAt({ x: 32, y: 30, z: 11 }) === 7 &&
        window.voxel.blockAt({ x: 32, y: 30, z: 12 }) === 7 &&
        window.voxel.snapshot().snapshot.jobs.length === 0,
    );
    await pause();
    assert.equal((await state()).snapshot.inventory.stone, 6);
    await shot('03-upper-masonry');
    check(
      'DOM material selector consumes processed bricks in actual upper floor and wall construction',
    );
    await control('地表');
    await inspect(p(34, 34, 8.8));
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(350);
    for (const locator of [
      page.getByTestId('stonecutting-bill'),
      page.getByLabel('石砖库存目标', { exact: true }),
      page.getByRole('button', { name: '恢复切石', exact: true }),
    ]) {
      await locator.scrollIntoViewIfNeeded();
      assert(
        await locator.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const x = r.x + r.width / 2,
            y = r.y + r.height / 2,
            t = document.elementFromPoint(x, y);
          return (
            x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && (t === e || e.contains(t))
          );
        }),
      );
    }
    const resources = page.locator('.voxel-resources');
    const resourceBounds = await resources.boundingBox();
    const inspectorBounds = await page.locator('.voxel-inspector').boundingBox();
    assert(resourceBounds.y + resourceBounds.height + 8 <= inspectorBounds.y);
    await resources.hover();
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(250);
    assert(
      await resources
        .locator('div')
        .last()
        .evaluate((e) => {
          const r = e.getBoundingClientRect(),
            t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return t === e || e.contains(t);
        }),
    );
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(250);
    await shot('04-workbench-900');
    check('900px workbench target and suspension controls remain reachable');
    await page.setViewportSize({ width: 1280, height: 800 });
    await load('legacy-v6');
    const migrated = await page.evaluate(() => window.voxel.exportSave());
    assert.equal(migrated.version, 13);
    assert.deepEqual(migrated.items, fixtures['legacy-v6'].save.items);
    assert.deepEqual(migrated.stockpiles, fixtures['legacy-v6'].save.stockpiles);
    assert(migrated.pawns.every((q) => q.priorities.craft === 1));
    check('file chooser imports unchanged published v6 material identities and warehouse filters');
    await Promise.all(reads);
    assert(
      result.assets.length >= 5 &&
        result.assets.every((a) => a.status === 200 && a.matchesLocalBuild && !a.error),
    );
    assert.deepEqual(result.errors, []);
    result.status = 'passed';
  } catch (e) {
    result.status = 'failed';
    result.errors.push(String(e.stack ?? e));
    await page.screenshot({ path: `${OUT}/${mode}-failed.png` }).catch(() => {});
    await writeFile(
      `${OUT}/${mode}-failed.json`,
      JSON.stringify(await page.evaluate(() => window.voxel?.exportSave()).catch(() => null)),
    );
    throw e;
  } finally {
    await context.close();
  }
}
try {
  for (const mode of ['worker', 'main']) await verify(mode);
  report.sourceHashes = {};
  for (const f of [
    'types.ts',
    'world.ts',
    'logistics.ts',
    'crafting.ts',
    'preservation.ts',
    'client.ts',
    'main.tsx',
    'renderer.ts',
    'style.css',
  ])
    report.sourceHashes[`src/voxel/${f}`] = sha(await readFile(`src/voxel/${f}`));
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  throw e;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
