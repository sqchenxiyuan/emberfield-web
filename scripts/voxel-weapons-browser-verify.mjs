import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_WEAPONS_BROWSER_OUT ?? 'test-results/voxel-weapons-browser';
const FIXTURES = process.env.VOXEL_WEAPONS_OUT ?? 'test-results/voxel-weapons-campaign';
await mkdir(OUT, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Production Chrome DOM/canvas and file chooser, real normal-command weapon campaign fixtures and genuine v12 save; read-only snapshot/project/exportSave only. All mutations through visible controls. Both render modes.',
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
    const a = { url: r.url(), status: r.status() };
    result.assets.push(a);
    reads.push(
      r
        .body()
        .then(async (bytes) => {
          a.bytes = bytes.length;
          a.sha256 = sha(bytes);
          a.matchesLocalBuild =
            sha(await readFile('dist/assets/' + path.basename(new URL(a.url).pathname))) ===
            a.sha256;
        })
        .catch((e) => {
          a.error = String(e);
        }),
    );
  });
  const state = () => page.evaluate(() => window.voxel.snapshot()),
    save = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const click = async (name) => {
    const b = page.getByRole('button', { name, exact: true });
    await b.scrollIntoViewIfNeeded();
    await b.click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot?.speed === 0);
    if (name === '3倍速') await wait(() => window.voxel.snapshot().snapshot?.speed === 3);
  };
  const settle = async () => {
    await page.waitForTimeout(400);
    await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0);
  };
  const check = (name, extra = {}) => {
    result.checks.push({ name, ...extra });
    console.log('PASS', mode, name);
  };
  const shot = async (name) => {
    await page.waitForTimeout(3500);
    const file = OUT + '/' + mode + '-' + name + '.png';
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
    await wait((t) => window.voxel.snapshot().snapshot.tick === t, data.tick);
    await settle();
    return data;
  }
  async function pawn(id) {
    const name = (await state()).snapshot.pawns.find((p) => p.id === id).name;
    await page
      .locator('.voxel-colonists button')
      .filter({ hasText: new RegExp('^' + name) })
      .click();
    await page.getByTestId('pawn-weapon').waitFor();
    await settle();
  }
  async function inspect(p, height = 0.1) {
    while ((await state()).level !== p.z)
      await click((await state()).level < p.z ? '上移一层' : '下移一层');
    await click('查看');
    await settle();
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
    await wait(() => {
      const state = window.voxel?.snapshot();
      return state?.ready && state.snapshot !== null;
    });
    await click('暂停');
    await click('收起指引');
    await settle();
    assert.equal((await state()).worker, mode === 'worker');
    const old = await load('tests/fixtures/voxel-v12-start.json'),
      migrated = await save();
    assert.equal(migrated.version, 19);
    assert.deepEqual(migrated.items, old.items);
    assert(migrated.pawns.every((p) => p.weapon === null));
    check('genuine v12 save migrates through the file chooser without adding weapons');
    const ready = await load(FIXTURES + '/ready.json'),
      bench = ready.weaponBenches.find((b) => b.kind === 'smithy'),
      spot = ready.weaponBenches.find((b) => b.kind === 'craftingSpot'),
      pawnId = ready.pawns[0].id;
    await inspect(spot, 0.03);
    await page.getByTestId('weapon-bills').waitFor();
    assert.equal(await page.getByLabel('武器配方', { exact: true }).locator('option').count(), 2);
    check('free crafting spot is selectable and offers only its two valid recipes');
    await inspect({ ...bench, x: bench.x + 1 }, 0.7);
    await page.getByLabel('武器配方', { exact: true }).selectOption('steelLongsword');
    await page.getByLabel('武器目标数量', { exact: true }).selectOption('2');
    await click('暂停此配方');
    await wait(
      () =>
        window.voxel
          .snapshot()
          .snapshot.weaponBenches.find((b) => b.kind === 'smithy')
          .bills.find((b) => b.kind === 'steelLongsword').paused,
    );
    assert.match(await page.getByTestId('smithy-fuel').innerText(), /26.0/);
    await page.getByLabel('武器配方', { exact: true }).scrollIntoViewIfNeeded();
    await shot('smithy');
    check('upper smithy displays real fuel and accepts sword target and pause controls');
    await click('燃料锻造台');
    const axis = (await state()).axis;
    await click('旋转建造朝向');
    assert.notEqual((await state()).axis, axis);
    await click('查看');
    check('smithy placement can be rotated with the visible control');
    await load(FIXTURES + '/finishing.json');
    await click('3倍速');
    await wait(() => window.voxel.snapshot().snapshot.stats.weaponsMade === 3);
    await click('暂停');
    assert.equal((await state()).snapshot.stats.consumed.steel, 230);
    check('normal saved sword work finishes once with actual steel consumption');
    await load(FIXTURES + '/ready.json');
    await pawn(pawnId);
    await click('征召');
    const knife = ready.items.find((i) => i.weapon?.kind === 'steelKnife');
    assert(knife);
    await inspect(knife, 0.16);
    await page.getByTestId('weapon-actions').waitFor();
    assert.match(await page.getByTestId('weapon-actions').innerText(), /钢匕首[\s\S]*耐久 100/);
    await page.getByLabel('允许搬运武器', { exact: true }).click();
    await wait(
      (id) => window.voxel.snapshot().snapshot.items.find((i) => i.weapon?.id === id)?.forbidden,
      knife.weapon.id,
    );
    await page.getByLabel('武器装备者', { exact: true }).selectOption(String(pawnId));
    await click('前往装备');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns[0].weaponTask?.weaponId === id,
      knife.weapon.id,
    );
    assert.equal(
      (await state()).snapshot.items.find((i) => i.weapon?.id === knife.weapon.id).forbidden,
      false,
    );
    await click('3倍速');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns[0].weapon?.id === id,
      knife.weapon.id,
    );
    await click('暂停');
    await pawn(pawnId);
    await page.getByTestId('pawn-weapon').scrollIntoViewIfNeeded();
    await shot('equipped');
    check(
      'ground knife inspection, prohibition and drafted physical equip work through visible UI',
    );
    await click('菜单与存档');
    await click('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    const stored = await save();
    await click('关闭菜单');
    await load(FIXTURES + '/ready.json');
    await click('菜单与存档');
    await click('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await settle();
    const restored = await save();
    assert.deepEqual(
      restored.pawns.map((p) => p.weapon),
      stored.pawns.map((p) => p.weapon),
    );
    assert.deepEqual(restored.items, stored.items);
    check('manual browser save and load preserve weapon identities and physical locations');
    const sword = restored.items.find((i) => i.weapon?.kind === 'steelLongsword');
    await inspect(sword, 0.16);
    await page.getByLabel('武器装备者', { exact: true }).selectOption(String(pawnId));
    await click('前往装备');
    await click('3倍速');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns[0].weapon?.id === id,
      sword.weapon.id,
    );
    await click('暂停');
    assert(
      (await state()).snapshot.items.some((i) => i.weapon?.id === knife.weapon.id && !i.forbidden),
    );
    check('swapping to the actual longsword leaves the old knife on reachable ground');
    await pawn(pawnId);
    await click('放下武器');
    await wait(() => window.voxel.snapshot().snapshot.pawns[0].weaponTask?.action === 'drop');
    const beforeDrop = (await state()).snapshot.pawns[0];
    assert(beforeDrop.weapon);
    assert.equal(beforeDrop.weaponTask.action, 'drop');
    await click('3倍速');
    await wait(() => window.voxel.snapshot().snapshot.pawns[0].weapon === null);
    await click('暂停');
    const dropped = (await state()).snapshot.items.find((i) => i.weapon?.id === sword.weapon.id);
    assert(dropped?.forbidden);
    await inspect(dropped, 0.16);
    await page.getByLabel('武器装备者', { exact: true }).scrollIntoViewIfNeeded();
    await shot('dropped');
    await page.getByLabel('允许搬运武器', { exact: true }).click();
    await wait(
      (id) => !window.voxel.snapshot().snapshot.items.find((i) => i.weapon?.id === id)?.forbidden,
      sword.weapon.id,
    );
    check('timed manual drop produces a forbidden physical weapon that can be allowed again');
    await page.setViewportSize({ width: 900, height: 700 });
    await settle();
    await page.getByRole('button', { name: '前往装备', exact: true }).scrollIntoViewIfNeeded();
    assert(await page.getByRole('button', { name: '前往装备', exact: true }).isVisible());
    await shot('compact');
    check('weapon inspection and equip controls stay accessible at 900 by 700');
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
