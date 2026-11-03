import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_LOGISTICS_BROWSER_OUT ?? 'test-results/voxel-logistics-browser';
const INPUT = process.env.VOXEL_LOGISTICS_OUT ?? 'test-results/voxel-logistics-campaign';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const pos = (x, y, z = 8) => ({ x, y, z });
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Real Chrome mouse, DOM, keyboard and file chooser. Read-only window.voxel snapshot/project/exportSave. Imports normal campaign checkpoints and unchanged published v5 gameplay save; never mutates simulation through hidden APIs.',
  fixtures: {},
  modes: [],
};
await mkdir(`${OUT}/fixtures`, { recursive: true });
const fixtures = {};
for (const [name, source] of [
  ['before-single', `${INPUT}/before-single.json`],
  ['cross-level', `${INPUT}/final.json`],
  ['legacy-v5', 'tests/fixtures/voxel-v5-cold-store.json'],
]) {
  const bytes = await readFile(source),
    file = `${OUT}/fixtures/${name}.json`;
  await writeFile(file, bytes);
  fixtures[name] = { file, save: JSON.parse(bytes) };
  report.fixtures[name] = { source, sha256: sha(bytes), tick: fixtures[name].save.tick };
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function modeRun(mode) {
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
  page.on('response', (response) => {
    if (!new URL(response.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const a = { url: response.url(), status: response.status() };
    result.assets.push(a);
    reads.push(
      response
        .body()
        .then(async (bytes) => {
          a.sha256 = sha(bytes);
          a.bytes = bytes.length;
          a.localFile = `dist/assets/${path.basename(new URL(a.url).pathname)}`;
          a.matchesLocalBuild = sha(await readFile(a.localFile)) === a.sha256;
        })
        .catch((e) => {
          a.error = String(e);
        }),
    );
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
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
  async function inspect(p) {
    await control(p.z === 5 ? '地下' : '地表');
    await wait(
      (z) =>
        window.voxel.snapshot().metrics.level === z &&
        window.voxel.snapshot().metrics.pendingChunks === 0,
      p.z,
    );
    await control('查看');
    for (const [dx, dy] of [
      [0, 0],
      [-0.3, -0.3],
      [0.3, -0.3],
      [0.3, 0.3],
      [-0.3, 0.3],
    ]) {
      const q = await project({ x: p.x + dx, y: p.y + dy, z: p.z + 0.05 });
      await page.mouse.click(q.x, q.y);
      await page.waitForTimeout(180);
      const s = (await state()).selected;
      if (s?.x === p.x && s?.y === p.y && s?.z === p.z) return;
    }
    assert.fail(`Unable to inspect visible tile ${JSON.stringify(p)}`);
  }
  async function drag(from, to = from) {
    await control('仓储');
    const a = await project(from),
      b = await project(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
  }
  async function load(name) {
    await control('菜单与存档');
    const choosing = page.waitForEvent('filechooser');
    await control('导入体素存档');
    await (await choosing).setFiles(fixtures[name].file);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait(
      (t) =>
        window.voxel.snapshot().snapshot.tick === t && window.voxel.snapshot().snapshot.speed === 0,
      fixtures[name].save.tick,
    );
  }
  function record(name, details = {}) {
    result.checks.push({ name, ...details });
    console.log('PASS', mode, name, JSON.stringify(details));
  }
  async function shot(name) {
    await page.locator('.voxel-toast').waitFor({ state: 'hidden', timeout: 8000 });
    const file = `${OUT}/${mode}-${name}.png`;
    await page.screenshot({ path: file });
    result.screenshots.push(file);
  }
  async function woodOnly() {
    await page.getByLabel('仓储优先级', { exact: true }).selectOption('3');
    await wait(() =>
      window.voxel
        .snapshot()
        .snapshot.stockpiles.filter((s) => s.x === 36 && s.y >= 34 && s.y <= 35)
        .every((s) => s.priority === 3),
    );
    await control('停止收纳');
    await wait(() =>
      window.voxel
        .snapshot()
        .snapshot.stockpiles.filter((s) => s.x === 36 && s.y >= 34 && s.y <= 35)
        .every((s) => !s.accepts.length),
    );
    await wait(() => !document.querySelector('input[aria-label="收纳木材"]').checked);
    await page.getByLabel('收纳木材', { exact: true }).click();
    await wait(() =>
      window.voxel
        .snapshot()
        .snapshot.stockpiles.filter((s) => s.x === 36 && s.y >= 34 && s.y <= 35)
        .every((s) => s.priority === 3 && s.accepts.length === 1 && s.accepts[0] === 'wood'),
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
    record('expected renderer backend');
    await load('before-single');
    await drag(pos(36, 34));
    await wait(() =>
      window.voxel
        .snapshot()
        .snapshot.stockpiles.some((s) => s.x === 36 && s.y === 34 && s.z === 8),
    );
    await inspect(pos(36, 34));
    await woodOnly();
    await run();
    await wait(() => {
      const s = window.voxel.snapshot().snapshot;
      return (
        s.items.some(
          (i) => i.x === 36 && i.y === 34 && i.z === 8 && i.resource === 'wood' && i.amount === 75,
        ) && s.pawns.every((p) => !p.cargo)
      );
    });
    await pause();
    await inspect(pos(36, 34));
    const full = (await state()).snapshot;
    assert.equal(full.inventory.wood, 90);
    assert.match(await page.getByTestId('storage-capacity').innerText(), /仓位 1 \/ 1 已占用/);
    assert.match(await page.getByTestId('storage-capacity').innerText(), /没有可接收空间/);
    assert.match(await page.getByTestId('stack-capacity').innerText(), /每堆上限 75.*剩余 0/);
    record('real single-cell designation fills to seventy-five and exposes full capacity');
    await page.getByTestId('storage-capacity').scrollIntoViewIfNeeded();
    await shot('01-full-slot');
    await run();
    await wait((t) => window.voxel.snapshot().snapshot.tick >= t + 240, full.tick);
    await pause();
    assert.equal((await state()).snapshot.stats.hauled, full.stats.hauled);
    record('full warehouse does not repeatedly take and drop the remaining wood');
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(300);
    await inspect(pos(36, 34));
    for (const locator of [
      page.getByTestId('storage-capacity'),
      page.getByLabel('仓储优先级', { exact: true }),
      page.getByLabel('应用到同层相连仓储', { exact: true }),
      page.getByLabel('收纳木材', { exact: true }),
    ]) {
      await locator.scrollIntoViewIfNeeded();
      assert(
        await locator.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
        }),
      );
    }
    await page.getByTestId('storage-capacity').scrollIntoViewIfNeeded();
    await shot('02-capacity-900');
    record('900px warehouse capacity and scope controls remain reachable');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    await drag(pos(36, 34), pos(36, 35));
    await inspect(pos(36, 34));
    await woodOnly();
    await run();
    await wait(() => {
      const s = window.voxel.snapshot().snapshot;
      return (
        s.items
          .filter((i) => i.resource === 'wood' && i.x === 36 && i.y >= 34 && i.y <= 35)
          .reduce((n, i) => n + i.amount, 0) === 90 && s.pawns.every((p) => !p.cargo)
      );
    });
    await pause();
    await inspect(pos(36, 35));
    assert.match(await page.getByTestId('storage-capacity').innerText(), /仓位 2 \/ 2 已占用/);
    assert.match(await page.getByTestId('storage-capacity').innerText(), /仍可接收/);
    const piles = (await state()).snapshot.items.filter((i) => i.resource === 'wood');
    assert.deepEqual(
      piles.map((i) => i.amount).sort((a, b) => a - b),
      [15, 75],
    );
    record('expanding the warehouse resumes hauling into a second finite stack', { piles });
    await shot('03-expanded');

    await inspect(pos(36, 34));
    await page.getByLabel('应用到同层相连仓储', { exact: true }).uncheck();
    await control('停止收纳');
    await wait(
      () =>
        window.voxel.snapshot().snapshot.stockpiles.find((s) => s.x === 36 && s.y === 34)?.accepts
          .length === 0,
    );
    await wait(() => !document.querySelector('input[aria-label="收纳包装生存口粮"]').checked);
    await page.getByLabel('收纳包装生存口粮', { exact: true }).click();
    await wait(
      () =>
        window.voxel
          .snapshot()
          .snapshot.stockpiles.find((s) => s.x === 36 && s.y === 34)
          ?.accepts.join(',') === 'food',
    );
    const filterTick = (await state()).snapshot.tick;
    await run();
    await wait((t) => window.voxel.snapshot().snapshot.tick >= t + 240, filterTick);
    await pause();
    const changed = (await state()).snapshot;
    assert.equal(changed.inventory.wood, 90);
    assert(changed.items.some((i) => i.x === 36 && i.y === 34 && i.resource === 'wood'));
    assert(!changed.items.some((i) => i.x === 36 && i.y === 34 && i.resource === 'food'));
    record(
      'a changed filter cannot overwrite incompatible material when evacuation space is insufficient',
    );
    const beforeSave = await page.evaluate(() => window.voxel.exportSave());
    assert.equal(beforeSave.version, 21);
    await control('菜单与存档');
    await control('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    await control('关闭菜单');
    await control('收纳全部');
    await control('菜单与存档');
    await control('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait((t) => window.voxel.snapshot().snapshot.tick === t, beforeSave.tick);
    const afterSave = await page.evaluate(() => window.voxel.exportSave());
    for (const k of ['items', 'stockpiles', 'stats']) assert.deepEqual(afterSave[k], beforeSave[k]);
    record('DOM save/load retains finite stacks and warehouse filters');

    await load('legacy-v5');
    const migrated = await page.evaluate(() => window.voxel.exportSave());
    assert.equal(migrated.version, 21);
    for (const resource of ['grain', 'meal']) {
      const old = fixtures['legacy-v5'].save.items.filter((i) => i.resource === resource),
        current = migrated.items.filter((i) => i.resource === resource);
      assert.equal(
        current.reduce((n, i) => n + i.amount, 0),
        old.reduce((n, i) => n + i.amount, 0),
      );
      assert(
        Math.abs(
          current.reduce((n, i) => n + i.amount * i.rotProgress, 0) -
            old.reduce((n, i) => n + i.amount * i.rotProgress, 0),
        ) < 1e-6,
      );
      assert(current.every((i) => i.amount <= (resource === 'meal' ? 10 : 75)));
    }
    assert.equal(
      new Set(migrated.items.map((i) => `${i.x}/${i.y}/${i.z}`)).size,
      migrated.items.length,
    );
    record(
      'unchanged published v5 save imports through file chooser without losing food quantities or weighted age',
    );
    await load('cross-level');
    const wood = (await state()).snapshot.items.find((i) => i.resource === 'wood');
    assert.equal(wood.z, 5);
    await inspect(wood);
    assert.match(await page.getByTestId('stack-capacity').innerText(), /每堆上限 75/);
    await page.getByTestId('storage-capacity').scrollIntoViewIfNeeded();
    await shot('04-underground');
    record('normally excavated underground warehouse exposes its physical finite stacks');
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
    throw e;
  } finally {
    await context.close();
  }
}
try {
  for (const mode of ['worker', 'main']) await modeRun(mode);
  report.sourceHashes = {};
  for (const file of [
    'types.ts',
    'world.ts',
    'logistics.ts',
    'preservation.ts',
    'main.tsx',
    'style.css',
    'client.ts',
    'renderer.ts',
  ])
    report.sourceHashes[`src/voxel/${file}`] = sha(await readFile(`src/voxel/${file}`));
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  throw e;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
