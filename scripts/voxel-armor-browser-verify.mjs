import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_ARMOR_BROWSER_OUT ?? 'test-results/voxel-armor-browser';
const FIXTURES = process.env.VOXEL_ARMOR_OUT ?? 'test-results/voxel-armor-campaign';
await mkdir(OUT, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Production Chrome Worker and main renderers, visible DOM/canvas/file import only. Read-only snapshot/project/exportSave. Ordinary v17 armor campaign and genuine v16 migration are explicit; no injected browser mutations.',
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
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    if (name === '3倍速') await wait(() => window.voxel.snapshot().snapshot.speed === 3);
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
    const project = () =>
      page.evaluate(({ p, height }) => window.voxel.project({ ...p, z: p.z + height }), {
        p,
        height,
      });
    let q = await project();
    for (const [axis, low, high, forward, back] of [
      ['y', 180, 520, 's', 'w'],
      ['x', 400, 1120, 'd', 'a'],
    ])
      for (let i = 0; i < 24 && (q[axis] < low || q[axis] > high); i++) {
        const target = (low + high) / 2,
          previous = Math.abs(q[axis] - target),
          key = q[axis] > high ? forward : back,
          opposite = key === forward ? back : forward;
        await page.keyboard.press(key);
        await page.waitForTimeout(100);
        q = await project();
        if (Math.abs(q[axis] - target) > previous) {
          await page.keyboard.press(opposite);
          await page.keyboard.press(opposite);
          await page.waitForTimeout(100);
          q = await project();
        }
      }
    assert(q.x > 320 && q.x < 1260 && q.y > 90 && q.y < 635, JSON.stringify({ p, q }));
    await page.mouse.click(q.x, q.y);
    await settle();
  }
  try {
    await page.goto(String(url));
    await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot !== null);
    await click('暂停');
    await click('收起指引');
    await settle();
    assert.equal((await state()).worker, mode === 'worker');
    for (const name of ['apparel', 'trauma']) {
      const old = await load(`tests/fixtures/voxel-v16-${name}.json`),
        migrated = await save();
      assert.equal(migrated.version, 17);
      for (const field of ['blocks', 'items', 'stats', 'tick'])
        assert.deepEqual(migrated[field], old[field]);
      for (const pawn of migrated.pawns) {
        const before = old.pawns.find((p) => p.id === pawn.id);
        for (const field of [
          'x',
          'y',
          'z',
          'worn',
          'weapon',
          'cargo',
          'trauma',
          'health',
          'skills',
          'food',
          'rest',
        ])
          assert.deepEqual(pawn[field], before[field]);
      }
      assert.deepEqual(migrated.research, {
        ...old.research,
        progress: { ...old.research.progress, PlateArmor: 0 },
      });
      check('genuine v16 ' + name + ' preserves equipment, injuries and physical state');
    }
    // The actual pre-armor research run has Smithing, but no new PlateArmor points.
    await load('test-results/voxel-research-campaign/final.json');
    await inspect(
      (await state()).snapshot.weaponBenches.find((b) => b.kind === 'smithy'),
      0.5,
    );
    await page.getByLabel('护甲配方', { exact: true }).selectOption('plateArmor');
    assert(await page.getByLabel('护甲目标数量', { exact: true }).isDisabled());
    assert.match(await page.getByTestId('armor-research-lock').innerText(), /板甲/);
    check('unresearched plate recipe is visibly locked on a real smithy');
    await load(FIXTURES + '/helmet-working.json');
    const working = (await state()).snapshot,
      bench = working.weaponBenches.find((b) => b.kind === 'smithy');
    await inspect(bench, 0.5);
    assert.match(await page.getByTestId('armor-bills').innerText(), /40 钢材/);
    const steel = working.inventory.steel;
    await click('暂停护甲配方');
    await wait(() => !window.voxel.snapshot().snapshot.jobs.some((j) => j.kind === 'armorsmith'));
    assert.equal((await state()).snapshot.inventory.steel, steel);
    await click('恢复护甲配方');
    await click('3倍速');
    await wait(() =>
      window.voxel.snapshot().snapshot.jobs.some((j) => j.kind === 'armorsmith' && j.progress > 20),
    );
    const active = (await state()).snapshot;
    const job = active.jobs.find((j) => j.kind === 'armorsmith' && j.progress > 20);
    const smith = active.pawns.find((p) => p.id === job.owner);
    assert(smith && smith.phase === 'work');
    const projectSmith = () =>
      page.evaluate(
        (p) => window.voxel.project({ ...p, x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.7 }),
        smith,
      );
    let q = await projectSmith();
    for (let i = 0; i < 12 && q.y > 520; i++) {
      const previous = q.y;
      await page.keyboard.press('s');
      await page.waitForTimeout(100);
      q = await projectSmith();
      if (q.y > previous) {
        await page.keyboard.press('w');
        await page.keyboard.press('w');
        await page.waitForTimeout(100);
        q = await projectSmith();
      }
    }
    const clip = { x: Math.round(q.x - 40), y: Math.round(q.y - 65), width: 80, height: 100 };
    assert(clip.x > 320 && clip.y > 90 && clip.x + 80 < 1280 && clip.y + 100 < 635);
    const frames = [];
    for (let i = 0; i < 2; i++) {
      await page.waitForTimeout(170);
      const bytes = await page.screenshot({ path: `${OUT}/${mode}-work-motion-${i}.png`, clip });
      frames.push(sha(bytes));
    }
    assert.notEqual(frames[0], frames[1], 'work-area pixels animate while smithing');
    result.workMotion = { clip, frames, pawnId: smith.id };
    await click('暂停');
    await settle();
    await shot('working');
    check('visible pause refunds steel and resume restarts real forging');
    await load(FIXTURES + '/plate-finishing.json');
    await inspect(
      (await state()).snapshot.weaponBenches.find((b) => b.kind === 'smithy'),
      0.5,
    );
    await page.getByLabel('护甲配方', { exact: true }).selectOption('plateArmor');
    assert.match(await page.getByTestId('armor-bills').innerText(), /170 钢材[\s\S]*工艺 7/);
    const animationTick = (await state()).snapshot.tick;
    await click('3倍速');
    await wait(
      () => window.voxel.snapshot().snapshot.items.some((i) => i.apparel?.kind === 'plateArmor'),
      undefined,
      120000,
    );
    await click('暂停');
    assert((await state()).snapshot.tick > animationTick);
    await shot('plate-finished');
    check('actual remaining forging finishes as a physical plate item');
    await load(FIXTURES + '/ready.json');
    const ready = (await state()).snapshot,
      pawnId = ready.pawns[0].id;
    await selectPawn(pawnId);
    // Ordinary work controls keep the chosen pawn free for the explicit outfit order.
    for (const work of Object.keys(ready.pawns[0].priorities))
      await page
        .getByLabel(`${ready.pawns[0].name} ${work}优先级`, { exact: true })
        .selectOption('0');
    const plate = (await state()).snapshot.items.find((i) => i.apparel?.kind === 'plateArmor');
    assert(plate);
    await inspect(plate, 0.2);
    assert.match(
      await page.getByTestId('item-detail').getByTestId('apparel-detail').innerText(),
      /板甲[\s\S]*锐器防护[\s\S]*移动速度修正 -0.8/,
    );
    await page.getByLabel('穿戴者', { exact: true }).selectOption(String(pawnId));
    await click('前往穿上');
    await click('3倍速');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns[0].worn.some((p) => p.id === id),
      plate.apparel.id,
      120000,
    );
    await click('暂停');
    await selectPawn(pawnId);
    assert.match(await page.getByTestId('pawn-apparel').innerText(), /当前步行系数 83%/);
    await shot('plate-equipped');
    check('visible wear control fetches the actual plate and applies its movement penalty');
    const current = await save(),
      savedFile = OUT + '/' + mode + '-equipped.json';
    await writeFile(savedFile, JSON.stringify(current));
    await load(savedFile);
    assert.deepEqual(
      (await save()).pawns.map((p) => [p.id, p.worn, p.trauma, p.health]),
      current.pawns.map((p) => [p.id, p.worn, p.trauma, p.health]),
    );
    await load(FIXTURES + '/equipped.json');
    await selectPawn(pawnId);
    assert.equal(await page.locator('.voxel-worn-piece').count(), 4);
    await page.getByTitle('向右旋转 E', { exact: true }).click();
    await settle();
    await shot('rotated-armor');
    check('four physical garments and their values remain inspectable after rotation and reload');
    await page.setViewportSize({ width: 900, height: 700 });
    await settle();
    const armor = page.locator('.voxel-worn-piece').filter({ hasText: '板甲' });
    await armor.scrollIntoViewIfNeeded();
    assert(await armor.isVisible());
    await shot('compact');
    const remove = armor.getByRole('button');
    await remove.scrollIntoViewIfNeeded();
    const box = await remove.boundingBox();
    assert(
      box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 900 && box.y + box.height <= 700,
    );
    assert(
      await remove.evaluate((el) => {
        const b = el.getBoundingClientRect(),
          hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return hit === el || el.contains(hit);
      }),
    );
    const equippedPlate = (await state()).snapshot.pawns[0].worn.find(
      (p) => p.kind === 'plateArmor',
    );
    await remove.click();
    await click('3倍速');
    await wait(
      (id) => !window.voxel.snapshot().snapshot.pawns[0].worn.some((p) => p.id === id),
      equippedPlate.id,
    );
    await click('暂停');
    assert((await state()).snapshot.items.some((i) => i.apparel?.id === equippedPlate.id));
    check('armor details and removal controls remain accessible at 900 by 700');
    await Promise.all(reads);
    assert(
      result.assets.length > 0 &&
        result.assets.every((a) => a.status === 200 && a.matchesLocalBuild),
    );
    assert.deepEqual(result.errors, []);
    result.status = 'passed';
  } catch (e) {
    result.status = 'failed';
    result.errors.push(String(e.stack ?? e));
    await page.screenshot({ path: OUT + '/' + mode + '-failure.png' });
    throw e;
  } finally {
    await context.close();
  }
}
try {
  await verify('worker');
  await verify('main');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(OUT + '/report.json', JSON.stringify(report, null, 2) + '\n');
}
