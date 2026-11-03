import { importLegacyStart, LEGACY_START } from './voxel-legacy-start.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5182/?world=voxel';
const OUT = 'test-results/voxel-browser';
await mkdir(OUT, { recursive: true });
const report = {
  baseline: LEGACY_START,
  base: BASE,
  checks: [],
  screenshots: [],
  errors: [],
  scope:
    'Chrome, real DOM buttons and map mouse actions. Read-only window.voxel project/snapshot/exportSave for observing exact cells. No command injection, terrain edits or pawn teleports.',
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
page.on('pageerror', (e) => report.errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') report.errors.push(m.text());
});
const pos = (x, y, z) => ({ x, y, z });
const state = () => page.evaluate(() => window.voxel.snapshot());
const wait = (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout });
const record = (name, data = {}) => {
  report.checks.push({ name, ...data });
  console.log('PASS', name, JSON.stringify(data));
};
const screenshot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  report.screenshots.push(`${OUT}/${name}.png`);
};
const point = async (p) => page.evaluate((p) => window.voxel.project(p), p);
async function click(p) {
  const q = await point(p);
  await page.mouse.click(q.x, q.y);
}
async function designate(tool, p, q = p) {
  await page.getByRole('button', { name: tool, exact: true }).click();
  const a = await point(p),
    b = await point(q);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}
const pause = async () => {
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await wait(() => window.voxel.snapshot().snapshot.speed === 0);
};
const run = async () => {
  await page.getByRole('button', { name: '3倍速', exact: true }).click();
  await wait(() => window.voxel.snapshot().snapshot.speed === 3);
};
const layer = async (label) => {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(250);
};
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function pixelDifference(a, b) {
  return page.evaluate(
    async (data) => {
      const images = await Promise.all(
        data.map(
          (s) =>
            new Promise((resolve) => {
              const i = new Image();
              i.onload = () => resolve(i);
              i.src = 'data:image/png;base64,' + s;
            }),
        ),
      );
      const pixels = images.map((i) => {
        const c = document.createElement('canvas');
        c.width = i.width;
        c.height = i.height;
        const x = c.getContext('2d');
        x.drawImage(i, 0, 0);
        return x.getImageData(0, 0, c.width, c.height).data;
      });
      let changed = 0,
        overTwo = 0,
        maxDelta = 0;
      for (let k = 0; k < pixels[0].length; k += 4) {
        let delta = 0;
        for (let t = 0; t < 3; t++)
          delta = Math.max(delta, Math.abs(pixels[0][k + t] - pixels[1][k + t]));
        if (delta) changed++;
        if (delta > 2) overTwo++;
        maxDelta = Math.max(maxDelta, delta);
      }
      return { changed, overTwo, maxDelta };
    },
    [a.toString('base64'), b.toString('base64')],
  );
}
try {
  await page.goto(BASE);
  await wait(
    () => window.voxel?.snapshot().ready && window.voxel.snapshot().metrics.pendingChunks === 0,
  );
  await importLegacyStart(page);
  await page.waitForTimeout(300);
  await screenshot('01-surface');
  record('worker-rendered 64x64x16 world', {
    worker: (await state()).worker,
    metrics: (await state()).metrics,
  });
  await click(pos(30, 32, 8));
  await wait(() => window.voxel.snapshot().selected?.x === 30);
  assert.match(await page.getByTestId('voxel-inspector').innerText(), /木材/);
  record('physical item inspection');
  const firstPawn = (await state()).snapshot.pawns[0],
    body = await point({ ...firstPawn, z: firstPawn.z + 1 });
  await page.mouse.click(body.x, body.y);
  await wait((p) => {
    const q = window.voxel.snapshot().selected;
    return q?.x === p.x && q?.y === p.y && q?.z === p.z;
  }, firstPawn);
  assert.match(await page.getByTestId('voxel-inspector').innerText(), new RegExp(firstPawn.name));
  record('clicking a colonist body selects the foot-space object');
  await designate('伐木', pos(27, 29, 8));
  await wait(() => window.voxel.snapshot().snapshot.jobs.some((j) => j.kind === 'cut'));
  await run();
  await wait(
    () =>
      window.voxel.snapshot().snapshot.stats.cut === 1 &&
      window.voxel.snapshot().snapshot.stored.wood === 117,
  );
  await pause();
  record('tree cut and wood hauled through actual UI');
  await designate('下挖梯井', pos(33, 32, 8));
  await wait(() => window.voxel.snapshot().snapshot.jobs.length === 4);
  await run();
  await wait(
    () =>
      [5, 6, 7, 8].every((z) => window.voxel.ladderAt({ x: 33, y: 32, z }) === 1) &&
      window.voxel.snapshot().snapshot.jobs.length === 0,
  );
  await pause();
  await layer('地下');
  await screenshot('02-underground-shaft');
  record('three-level shaft built by colonists');
  await designate('挖掘', pos(34, 32, 5));
  await run();
  await wait(() => {
    const s = window.voxel.snapshot().snapshot;
    return s.stats.produced.steel > 0 && s.stored.steel === s.stats.produced.steel;
  });
  await pause();
  await screenshot('03-underground-mined');
  record('underground mining and cross-level steel hauling', {
    steel: (await state()).snapshot.stored.steel,
  });
  await layer('地表');
  await designate('向上搭梯', pos(33, 32, 8));
  await run();
  await wait(
    () =>
      [9, 10, 11].every((z) => window.voxel.ladderAt({ x: 33, y: 32, z }) === 1) &&
      window.voxel.snapshot().snapshot.jobs.length === 0,
  );
  await pause();
  await layer('二层');
  await designate('楼板', pos(34, 32, 11), pos(36, 32, 11));
  await wait(
    () => window.voxel.snapshot().snapshot.jobs.filter((j) => j.kind === 'floor').length === 3,
  );
  await run();
  await wait(
    () =>
      window.voxel.snapshot().snapshot.jobs.some((j) => Object.values(j.delivered).some(n=>n>0) || j.progress > 0) ||
      window.voxel.snapshot().snapshot.pawns.some((p) => p.cargo?.resource === 'wood' && p.z > 8),
  );
  await pause();
  const saved = await page.evaluate(() => window.voxel.exportSave());
  await writeFile(`${OUT}/mid-work.json`, JSON.stringify(saved));
  const before = (await state()).snapshot.inventory;
  await page.getByRole('button', { name: '菜单与存档', exact: true }).click();
  await page.getByRole('button', { name: '保存营地', exact: true }).click();
  await page.waitForTimeout(300);
  await page.reload();
  await wait(() => window.voxel?.snapshot().ready);
  await page.getByRole('button', { name: '菜单与存档', exact: true }).click();
  await page.getByRole('button', { name: '读取营地', exact: true }).click();
  await wait((t) => window.voxel.snapshot().snapshot.tick === t, saved.tick);
  assert.deepEqual((await state()).snapshot.inventory, before);
  await layer('二层');
  await run();
  await wait(
    () =>
      [34, 35, 36].every((x) => window.voxel.blockAt({ x, y: 32, z: 10 }) === 4) &&
      window.voxel.snapshot().snapshot.jobs.length === 0,
  );
  await pause();
  record('upper floors receive physical materials; mid-construction save survives page reload');
  await designate('仓储', pos(34, 32, 11));
  await wait(() =>
    window.voxel.snapshot().snapshot.stockpiles.some((s) => s.x === 34 && s.z === 11),
  );
  await designate('墙壁', pos(36, 32, 11));
  await run();
  await wait(
    () =>
      window.voxel.blockAt({ x: 36, y: 32, z: 11 }) === 4 &&
      window.voxel.blockAt({ x: 36, y: 32, z: 12 }) === 4,
  );
  await pause();
  await screenshot('04-upper-floor-wall');
  record('upper storage and two-voxel-high wall');
  await page.getByRole('button', { name: '查看', exact: true }).click();
  const beforeRotate = await page.evaluate(() => window.voxel.exportSave());
  for (let n = 0; n < 4; n++) {
    await page.getByTitle('向右旋转 E', { exact: true }).click();
    await click(pos(34, 32, 11));
    await wait(() => {
      const p = window.voxel.snapshot().selected;
      return p?.x === 34 && p?.y === 32 && p?.z === 11;
    });
    await screenshot(`05-rotation-${n}`);
  }
  for (const label of ['地下', '地表', '二层']) await layer(label);
  assert.equal(digest(await page.evaluate(() => window.voxel.exportSave())), digest(beforeRotate));
  record('four camera rotations pick the same cell; slices do not change simulation');
  // Let interpolation settle, then verify the canvas is stable while paused.
  const worldClip = { x: 330, y: 180, width: 780, height: 510 };
  await page.mouse.move(1420, 80);
  await page.waitForTimeout(1000);
  const a = await page.screenshot({ clip: worldClip });
  await page.waitForTimeout(600);
  const b = await page.screenshot({ clip: worldClip });
  await writeFile(`${OUT}/pause-a.png`, a);
  await writeFile(`${OUT}/pause-b.png`, b);
  const diff = await pixelDifference(a, b);
  assert.equal(
    diff.overTwo,
    0,
    'paused image may differ by at most 2/255 in a channel from GPU rounding, not animate',
  );
  record('paused world pixels stable within GPU rounding (HUD FPS excluded)', diff);
  const inv = (await state()).snapshot.inventory;
  await designate('墙壁', pos(36, 32, 11));
  assert.match(await page.getByRole('status').innerText(), /空置/);
  assert.deepEqual((await state()).snapshot.inventory, inv);
  record('invalid construction is explained without material consumption');
  // Cut the only vertical connection while a colonist is safely on the upper floor.
  const upper = (await state()).snapshot.pawns.find((p) => p.z === 11);
  assert.ok(upper);
  await page.getByRole('button', { name: '下移一层', exact: true }).click();
  await page.getByRole('button', { name: '下移一层', exact: true }).click();
  await designate('拆除', pos(33, 32, 9));
  await run();
  await wait(() => window.voxel.ladderAt({ x: 33, y: 32, z: 9 }) === 0);
  await pause();
  await page.locator('.voxel-colonists button').filter({ hasText: upper.name }).click();
  await layer('地表');
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await click(pos(32, 32, 8));
  await page.getByRole('button', { name: `让 ${upper.name} 前往选中位置`, exact: true }).click();
  await page.getByRole('status').filter({ hasText: '没有可达通路' }).waitFor();
  await page.getByRole('button', { name: '上移一层', exact: true }).click();
  await designate('梯子', pos(33, 32, 9));
  await run();
  await wait(() => window.voxel.ladderAt({ x: 33, y: 32, z: 9 }) === 1);
  await pause();
  await layer('地表');
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await click(pos(32, 32, 8));
  await page.getByRole('button', { name: `让 ${upper.name} 前往选中位置`, exact: true }).click();
  await run();
  await wait((id) => {
    const p = window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id);
    return p.x === 32 && p.y === 32 && p.z === 8;
  }, upper.id);
  await pause();
  record('removed ladder blocks cross-level movement; rebuilt ladder restores actual walking');
  await layer('二层');
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await screenshot('06-final-overview');
  report.final = {
    tick: (await state()).snapshot.tick,
    stats: (await state()).snapshot.stats,
    metrics: (await state()).metrics,
  };
  // Load the same UI-generated save in the explicit main-thread compatibility path.
  const compatible = new URL(BASE);
  compatible.searchParams.set('render', 'main');
  await page.goto(compatible.href);
  await wait(() => window.voxel?.snapshot().ready);
  assert.equal((await state()).worker, false);
  await page.getByRole('button', { name: '菜单与存档', exact: true }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'voxel-ui-save.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(saved)),
    });
  await wait((t) => window.voxel.snapshot().snapshot.tick === t, saved.tick);
  await layer('二层');
  await screenshot('07-main-fallback');
  record('main-thread WebGL2 fallback loads the same voxel save');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log('PASS voxel browser campaign', report.checks.length);
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  await screenshot('failure');
  await writeFile(
    `${OUT}/failed-state.json`,
    JSON.stringify(await page.evaluate(() => window.voxel.exportSave())),
  );
  throw e;
} finally {
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
