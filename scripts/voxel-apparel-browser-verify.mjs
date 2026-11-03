import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_APPAREL_BROWSER_OUT ?? 'test-results/voxel-apparel-browser';
const FIXTURES = process.env.VOXEL_APPAREL_OUT ?? 'test-results/voxel-apparel-campaign';
await mkdir(OUT, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Actual production Chrome canvas, DOM and file chooser. Normal-calendar textile fixtures and genuinely published v10 save; read-only snapshot/project/exportSave. All recipe and apparel actions use visible controls in both rendering modes.',
  modes: [],
};
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
  const result = { mode, checks: [], errors: [], assets: [], screenshots: [], fixtures: [] };
  report.modes.push(result);
  const reads = [];
  page.on('pageerror', (e) => result.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') result.errors.push(m.text());
  });
  page.on('response', (r) => {
    if (!new URL(r.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const asset = { url: r.url(), status: r.status() };
    result.assets.push(asset);
    reads.push(
      r
        .body()
        .then(async (bytes) => {
          asset.bytes = bytes.length;
          asset.sha256 = sha(bytes);
          asset.matchesLocalBuild =
            sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) ===
            asset.sha256;
        })
        .catch((e) => {
          asset.error = String(e);
        }),
    );
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const save = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const click = async (name) => {
    const b = button(name);
    await b.scrollIntoViewIfNeeded();
    await b.click();
  };
  const settle = async () => {
    await page.waitForTimeout(500);
    await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0);
  };
  const check = (name, details = {}) => {
    result.checks.push({ name, ...details });
    console.log('PASS', mode, name);
  };
  const shot = async (name) => {
    const file = `${OUT}/${mode}-${name}.png`;
    await page.screenshot({ path: file });
    result.screenshots.push(file);
  };
  async function load(file) {
    const bytes = await readFile(file),
      data = JSON.parse(bytes);
    result.fixtures.push({ file, sha256: sha(bytes), tick: data.tick });
    if (!(await page.getByRole('dialog').isVisible())) await click('菜单与存档');
    const chooser = page.waitForEvent('filechooser');
    await click('导入体素存档');
    await (await chooser).setFiles(file);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait((tick) => window.voxel.snapshot().snapshot.tick === tick, data.tick);
    await settle();
    return data;
  }
  async function selectPawn(id) {
    const name = (await state()).snapshot.pawns.find((p) => p.id === id).name;
    await page
      .locator('.voxel-colonists button')
      .filter({ hasText: new RegExp(`^${name}`) })
      .click();
    await page.getByTestId('pawn-health').waitFor();
    await settle();
  }
  async function inspect(p, height = 0.1) {
    // Other workers can carry a garment to a different storey before we pause.
    // Use normal layer controls to inspect its current physical location.
    while ((await state()).level !== p.z) {
      await click((await state()).level < p.z ? '上移一层' : '下移一层');
    }
    await settle();
    await click('查看');
    const q = await page.evaluate(
      ({ p, height }) => window.voxel.project({ ...p, z: p.z + height }),
      { p, height },
    );
    assert(q.x > 320 && q.x < 1260 && q.y > 90 && q.y < 635, JSON.stringify({ p, q }));
    await page.mouse.click(q.x, q.y);
    await settle();
  }
  try {
    await page.goto(String(url));
    await wait(() => window.voxel?.snapshot().ready);
    await click('暂停');
    await click('收起指引');
    await settle();
    assert.equal((await state()).worker, mode === 'worker');
    assert.equal((await state()).snapshot.inventory.apparel, 6);
    const first = (await state()).snapshot.pawns[0];
    await selectPawn(first.id);
    assert.equal(await page.locator('.voxel-worn-piece').count(), 2);
    check(
      'new world contains six physical starter garments and visible individual outfit controls',
    );
    const legacy = await load('tests/fixtures/voxel-v10-start.json'),
      migrated = await save();
    assert.equal(migrated.version, 13);
    assert.deepEqual(migrated.blocks, legacy.blocks);
    assert.deepEqual(migrated.items, legacy.items);
    assert(migrated.pawns.every((p) => p.worn.length === 0));
    await selectPawn(migrated.pawns[0].id);
    assert.match(await page.getByTestId('pawn-apparel').innerText(), /未穿衣物/);
    check('genuine v10 import preserves the old colony without retroactive clothing');
    await load(`${FIXTURES}/sown.json`);
    await click('地表');
    await click('种植区');
    await page.getByLabel('种植作物', { exact: true }).selectOption('cotton');
    assert.equal(await page.getByLabel('种植作物', { exact: true }).inputValue(), 'cotton');
    const cotton = (await state()).snapshot.crops.find((c) => c.kind === 'cotton');
    await inspect(cotton);
    assert.match(
      await page.getByTestId('voxel-inspector').innerText(),
      /棉花[\s\S]*布料；不能食用/,
    );
    await shot('cotton');
    check('cotton is available in the crop selector and explains non-food output');
    await load(`${FIXTURES}/cloth.json`);
    await click('地表');
    const clothState = (await state()).snapshot,
      cloth = clothState.items.find(
        (i) => i.resource === 'cloth' && i.x >= 40 && i.z === clothState.spawn.z,
      );
    assert(cloth);
    await inspect(cloth, 0.2);
    assert.match(await page.getByTestId('item-detail').innerText(), /布料/);
    assert.equal(await page.getByTestId('food-condition').count(), 0);
    check('real cotton output is selectable and has no food spoilage display');
    const tailor = (await state()).snapshot.tailors[0];
    await click('二层');
    await inspect({ ...tailor, x: tailor.x + 1 }, 0.7);
    await page.getByTestId('tailor-bills').waitFor();
    await page.getByLabel('裁缝配方', { exact: true }).selectOption('tuque');
    await page.getByLabel('衣物目标数量', { exact: true }).selectOption('1');
    await click('暂停此配方');
    await wait(
      () =>
        window.voxel.snapshot().snapshot.tailors[0].bills.find((b) => b.kind === 'tuque').paused,
    );
    await shot('tailor');
    check('physical three-cell bench exposes recipe target and pause controls');
    await click('手工裁缝台');
    const axis = (await state()).axis;
    await click('旋转建造朝向');
    assert.notEqual((await state()).axis, axis);
    await click('查看');
    check('hand tailoring construction footprint can rotate through normal controls');
    const working = await load(`${FIXTURES}/working.json`);
    await click('二层');
    await inspect({ ...working.tailors[0], x: working.tailors[0].x + 1 }, 0.7);
    await page.getByLabel('裁缝配方', { exact: true }).selectOption('tuque');
    await click('暂停此配方');
    await click('3倍速');
    await wait(() => !window.voxel.snapshot().snapshot.jobs.some((j) => j.kind === 'tailoring'));
    await click('暂停');
    assert.equal((await state()).snapshot.stats.tailored, 0);
    assert.equal((await state()).snapshot.stats.consumed.cloth, 0);
    check('pausing an active recipe returns its material without creating finished apparel');
    const mid = await load(`${FIXTURES}/finishing.json`);
    assert(mid.jobs.some((j) => j.kind === 'tailoring' && j.progress > 0));
    // Captured by the campaign after normal work and sleep, with sixty work ticks left.
    await click('3倍速');
    await wait(() => window.voxel.snapshot().snapshot.stats.tailored === 1);
    await click('暂停');
    assert.equal((await state()).snapshot.stats.consumed.cloth, 20);
    check('restored partial sewing work completes exactly one real twenty-cloth tuque');
    const ready = await load(`${FIXTURES}/ready.json`),
      pawnId = ready.pawns[0].id;
    await selectPawn(pawnId);
    for (const work of Object.keys(ready.pawns[0].priorities))
      await page
        .getByLabel(`${ready.pawns[0].name} ${work}优先级`, { exact: true })
        .selectOption('0');
    const parka = ready.items.find((i) => i.apparel?.kind === 'parka');
    assert(parka);
    await click('二层');
    await inspect(parka, 0.2);
    assert.match(
      await page.getByTestId('item-detail').getByTestId('apparel-detail').innerText(),
      /普通[\s\S]*隔冷 36.0/,
    );
    await page.getByLabel('穿戴者', { exact: true }).selectOption(String(pawnId));
    await click('前往穿上');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).apparelTask !== null,
      pawnId,
    );
    assert(
      !(await state()).snapshot.pawns
        .find((p) => p.id === pawnId)
        .worn.some((p) => p.id === parka.apparel.id),
    );
    await click('3倍速');
    await wait(
      ({ id, garment }) =>
        window.voxel
          .snapshot()
          .snapshot.pawns.find((p) => p.id === id)
          .worn.some((p) => p.id === garment),
      { id: pawnId, garment: parka.apparel.id },
    );
    await click('暂停');
    await selectPawn(pawnId);
    await page.getByTestId('pawn-apparel').scrollIntoViewIfNeeded();
    await shot('parka');
    assert.equal(await page.locator('.voxel-worn-piece').count(), 3);
    check('choosing a colonist physically fetches and equips the selected parka after a delay');
    await click('菜单与存档');
    await click('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    const stored = await save();
    await click('关闭菜单');
    await load(`${FIXTURES}/duster.json`);
    await click('菜单与存档');
    await click('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await settle();
    const restored = await save();
    assert.deepEqual(
      restored.pawns.map((p) => p.worn),
      stored.pawns.map((p) => p.worn),
    );
    assert.deepEqual(restored.items, stored.items);
    check('manual save and load retain garment identity, durability and physical location');
    const replacement = restored.items.find((i) => i.apparel?.kind === 'duster');
    assert(replacement);
    await click('地表');
    await inspect(replacement, 0.2);
    await page.getByLabel('穿戴者', { exact: true }).selectOption(String(pawnId));
    await click('前往穿上');
    await click('3倍速');
    await wait(
      ({ pawnId, garment }) =>
        window.voxel
          .snapshot()
          .snapshot.pawns.find((p) => p.id === pawnId)
          .worn.some((p) => p.id === garment),
      { pawnId, garment: replacement.apparel.id },
    );
    await click('暂停');
    const swapped = (await state()).snapshot;
    assert(swapped.items.some((i) => i.apparel?.id === parka.apparel.id));
    assert.equal(swapped.pawns.find((p) => p.id === pawnId).worn.length, 3);
    check(
      'wearing another shell garment physically drops the old parka while keeping shirt and pants',
    );
    const dressing = await load(`${FIXTURES}/wearing.json`),
      dressPawn = dressing.pawns.find((p) => p.apparelTask);
    assert(dressPawn.cargo?.apparel);
    await selectPawn(dressPawn.id);
    assert.match(await page.getByTestId('pawn-apparel').innerText(), /正在/);
    await click('3倍速');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).apparelTask === null,
      dressPawn.id,
    );
    await click('暂停');
    assert(
      (await state()).snapshot.pawns
        .find((p) => p.id === dressPawn.id)
        .worn.some((p) => p.id === dressPawn.cargo.apparel.id),
    );
    check('importing an in-progress dressing task resumes from actual cargo without duplication');
    const dusterState = await load(`${FIXTURES}/duster.json`);
    await selectPawn(pawnId);
    assert(dusterState.items.some((i) => i.apparel?.kind === 'parka'));
    assert(dusterState.pawns[0].worn.some((p) => p.kind === 'duster'));
    const duster = dusterState.pawns[0].worn.find((p) => p.kind === 'duster');
    await page
      .getByRole('button', { name: `${dusterState.pawns[0].name} 脱下 防尘长外套`, exact: true })
      .click();
    await click('3倍速');
    await wait(
      ({ pawnId, id }) =>
        !window.voxel
          .snapshot()
          .snapshot.pawns.find((p) => p.id === pawnId)
          .worn.some((p) => p.id === id),
      { pawnId, id: duster.id },
    );
    await click('暂停');
    assert((await state()).snapshot.items.some((i) => i.apparel?.id === duster.id));
    check('remove control spends time and leaves the same duster as a selectable ground object');
    await load(`${FIXTURES}/clothed.json`);
    await page.setViewportSize({ width: 900, height: 700 });
    await selectPawn(pawnId);
    await page.getByTestId('pawn-apparel').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.voxel-worn-piece').count(), 4);
    await shot('compact');
    check('four-layer outfit controls remain usable in the compact viewport');
    await Promise.all(reads);
    assert(result.assets.length >= 4);
    assert(result.assets.every((a) => a.status === 200 && a.matchesLocalBuild));
    assert.deepEqual(result.errors, []);
    result.status = 'passed';
  } catch (e) {
    result.status = 'failed';
    result.failure = String(e);
    await shot('failure');
    throw e;
  } finally {
    await context.close();
  }
}
try {
  await verify('worker');
  await verify('main');
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
