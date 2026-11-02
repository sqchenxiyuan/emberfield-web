import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const BASE = process.env.COLONY_TEST_URL ?? 'http://127.0.0.1:4178',
  OUT = 'test-results/browser';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = {
  base: BASE,
  browser: browser.version(),
  checks: [],
  errors: [],
  backends: [],
  screenshots: [],
  scope:
    'Production browser UI operations, IndexedDB persistence, exported state comparison, normal campaign save import and rendering fallback. Read-only window.ember used for assertions; commands use actual UI.',
};
const record = (name, data = {}) => {
  report.checks.push({ name, ...data });
  console.log('PASS', name, JSON.stringify(data));
};
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
const page = await context.newPage();
page.on('pageerror', (e) => report.errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') report.errors.push(m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`);
});
const snapshot = () => page.evaluate(() => window.ember.snapshot());
const wait = (fn) => page.waitForFunction(fn, null, { timeout: 30000 });
const screen = async (name) => {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path });
  report.screenshots.push(path);
};
const pause = async () => {
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await wait(() => window.ember.snapshot().speed === 0);
};
const point = async (x, y) => {
  const r = await page.locator('canvas').boundingBox();
  return {
    x: r.x + r.width / 2 + (x + 0.5 - 45) * 32 * 0.92,
    y: r.y + r.height / 2 + (y + 0.5 - 47) * 32 * 0.92,
  };
};
const clickCell = async (x, y, button = 'left') => {
  const p = await point(x, y);
  await page.mouse.click(p.x, p.y, { button });
};
const drag = async (x, y, x2, y2) => {
  const a = await point(x, y),
    b = await point(x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
};
try {
  await page.goto(BASE);
  await wait(() => window.ember?.snapshot().ready);
  await page.waitForTimeout(1200);
  await screen('01-welcome');
  assert.equal((await snapshot()).metrics.renderWorker, true);
  record('initial Worker renderer', (await snapshot()).metrics);
  await page.getByRole('button', { name: '建立我们的营地' }).click();
  await pause();
  const mapBounds = await page.locator('canvas').boundingBox();
  assert.equal(mapBounds.x, 0);
  assert.equal(mapBounds.y, 0);
  assert.equal(mapBounds.width, 1440);
  assert.ok(mapBounds.height >= 950);
  assert.equal(await page.getByLabel('信息面板', { exact: true }).isVisible(), false);
  await screen('02-map-hud');
  record('map fills viewport behind compact colony HUD');
  await page.getByRole('button', { name: '选择林野', exact: true }).click();
  const inspector = page.getByLabel('信息面板', { exact: true });
  await inspector.waitFor();
  const inspectorBounds = await inspector.boundingBox();
  assert.ok(inspectorBounds.x < 20 && inspectorBounds.y > 500);
  await page.getByRole('button', { name: '健康', exact: true }).click();
  await page.getByText('身体健康，可以正常工作。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '技能', exact: true }).click();
  assert.equal(await inspector.locator('.skills > div').count(), 9);
  await page.getByRole('button', { name: '状态', exact: true }).click();
  await screen('02-person-inspector');
  await page.getByRole('button', { name: '收起信息面板', exact: true }).click();
  assert.equal(await inspector.isVisible(), false);
  await page.getByRole('button', { name: '选择林野', exact: true }).click();
  await inspector.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await inspector.isVisible(), false);
  await page.getByTitle('返回营地', { exact: true }).click();
  record('selection inspector tabs, close, reselect and Escape operate independently of map');
  const tick = (await snapshot()).summary.tick;
  await page.waitForTimeout(600);
  assert.equal((await snapshot()).summary.tick, tick);
  record('paused world stays frozen');
  await page.getByTitle('建造', { exact: true }).click();
  await page.locator('.build-items button').filter({ hasText: '木床' }).click();
  for (const x of [40, 42, 44]) await clickCell(x, 41);
  await wait(() => window.ember.snapshot().summary.buildings.length === 3);
  await clickCell(40, 41);
  await page.getByRole('status').filter({ hasText: '重叠' }).waitFor();
  assert.equal((await snapshot()).summary.buildings.length, 3);
  record('blueprints validate footprint overlap');
  await page.getByTitle('区域', { exact: true }).click();
  await drag(41, 50, 44, 53);
  await page.locator('.zone-palette button').filter({ hasText: '谷物田' }).click();
  await drag(49, 48, 54, 55);
  await page.waitForFunction(
    async () => (await window.ember.exportSave()).zones.filter((v) => v === 2).length === 48,
    null,
    { timeout: 10000 },
  );
  const initial = await page.evaluate(() => window.ember.exportSave());
  assert.equal(initial.zones.filter((v) => v === 1).length, 16);
  assert.equal(initial.zones.filter((v) => v === 2).length, 48);
  record('drag zoning changes authoritative grid');
  await page.getByTitle('选择', { exact: true }).click();
  await page.getByRole('button', { name: '6倍速', exact: true }).click();
  await wait(() => window.ember.snapshot().summary.stats.built >= 3);
  await pause();
  record('workers build three beds with real resources', {
    stats: (await snapshot()).summary.stats,
  });
  await page.getByRole('button', { name: '选择林野', exact: true }).click();
  await page.keyboard.press('r');
  await wait(() => window.ember.snapshot().summary.pawns.find((p) => p.name === '林野').drafted);
  await page.getByTitle('返回营地', { exact: true }).click();
  await clickCell(45, 47, 'right');
  await wait(
    () => window.ember.snapshot().summary.pawns.find((p) => p.name === '林野').job?.kind === 'move',
  );
  await page.keyboard.press('r');
  await wait(() => !window.ember.snapshot().summary.pawns.find((p) => p.name === '林野').drafted);
  record('selection, drafting, right-click orders and interruption');
  await page.locator('.top-actions button').nth(1).click();
  await wait(() => window.ember.snapshot().metrics.saveStatus.startsWith('手动保存'));
  const saved = await page.evaluate(() => window.ember.exportSave());
  await page.getByRole('button', { name: '6倍速', exact: true }).click();
  await page.waitForFunction((t) => window.ember.snapshot().summary.tick > t + 100, saved.tick);
  await pause();
  await page.getByRole('button', { name: '菜单与存档', exact: true }).click();
  await page.getByRole('button', { name: '读取手动存档', exact: true }).click();
  await page.waitForFunction((t) => window.ember.snapshot().summary.tick === t, saved.tick);
  assert.deepEqual(await page.evaluate(() => window.ember.exportSave()), saved);
  record('IndexedDB restores complete mid-job state exactly');
  const beforeHeap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  for (let i = 0; i < 20; i++) {
    await page.getByRole('button', { name: '读取手动存档', exact: true }).click();
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => window.ember.exportSave()), saved);
  const afterHeap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  record('twenty repeated loads preserve state', {
    mainHeapBefore: beforeHeap,
    mainHeapAfter: afterHeap,
    limitation: 'JS main-thread heap only; not total application memory',
  });
  await page.reload();
  await wait(() => window.ember?.snapshot().ready);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '菜单与存档', exact: true }).click();
  await page.getByRole('button', { name: '读取手动存档', exact: true }).click();
  await page.waitForFunction((t) => window.ember.snapshot().summary.tick === t, saved.tick);
  assert.deepEqual(await page.evaluate(() => window.ember.exportSave()), saved);
  record('saved world survives page reload and both Worker restarts');
  const invalid = {
    ...saved,
    pawns: [{ ...saved.pawns[0], priorities: null }, ...saved.pawns.slice(1)],
  };
  await page.locator('input[type=file]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalid)),
  });
  await page.getByRole('status').filter({ hasText: '存档字段' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.ember.exportSave()), saved);
  record('invalid import fails without replacing world');
  const campaign = JSON.parse(await readFile('test-results/campaign/day-8.json', 'utf8'));
  await page.locator('input[type=file]').setInputFiles({
    name: 'day-8.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(campaign)),
  });
  await page.waitForFunction((t) => window.ember.snapshot().summary.tick === t, campaign.tick);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByTitle('返回营地', { exact: true }).click();
  await page.waitForTimeout(1000);
  await screen('03-established-camp');
  record('real eight-day campaign loads and renders', {
    buildings: campaign.buildings.length,
    stats: campaign.stats,
  });
  await page.getByRole('button', { name: '分工', exact: true }).click();
  await screen('04-work-priorities');
  const p = page.locator('.priority').first(),
    previous = await p.innerText(),
    oldPriority = (await snapshot()).summary.pawns[0].priorities.doctor;
  await p.click();
  await page.waitForFunction(
    (v) => window.ember.snapshot().summary.pawns[0].priorities.doctor !== v,
    oldPriority,
  );
  assert.notEqual(await p.innerText(), previous);
  record('work priority control updates simulation');
  await page.getByRole('button', { name: '研究', exact: true }).click();
  await screen('05-research');
  await page.getByRole('button', { name: '纪事', exact: true }).click();
  await screen('06-journal');
  const stable = await page.evaluate(() => window.ember.exportSave());
  await page.getByRole('button', { name: '菜单与存档', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON 存档', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(`${OUT}/exported-save.json`);
  assert.deepEqual(JSON.parse(await readFile(`${OUT}/exported-save.json`, 'utf8')), stable);
  record('exported JSON contains full authoritative state');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screen('07-1280-layout');
  record('desktop layout at 1280x800');
  await page.keyboard.press('Escape');
  for (const [width, height] of [
    [1024, 720],
    [720, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const selector of [
      '.tool-rail',
      '.colony-nav',
      '.world-status',
      '.resource-strip',
      '.colonist-row',
    ]) {
      const r = await page.locator(selector).boundingBox();
      assert.ok(
        r && r.x >= 0 && r.y >= 0 && r.x + r.width <= width + 1 && r.y + r.height <= height + 1,
        selector,
      );
    }
    await page.getByRole('button', { name: '研究', exact: true }).click();
    const panel = await page.getByLabel('信息面板', { exact: true }).boundingBox();
    assert.ok(panel && panel.x + panel.width <= width && panel.y + panel.height <= height - 40);
    await screen(`07-layout-${width}`);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  record('HUD and expandable panels fit 1024x720 and 720x720');
  await page.getByRole('button', { name: '菜单与存档', exact: true }).click();
  await page.getByRole('textbox', { name: '世界种子', exact: true }).fill('42');
  await page.getByRole('button', { name: '使用此种子重新开始', exact: true }).click();
  await page.waitForFunction(
    async () =>
      (await window.ember.exportSave()).seed === 42 && window.ember.snapshot().summary.tick === 0,
  );
  await page.waitForTimeout(500);
  await screen('08-new-seed');
  record('new seed replaces terrain and renderer entities');
  await page.getByTitle('返回营地', { exact: true }).click();
  const view = await page.locator('canvas').boundingBox();
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await wait(
    () => window.ember.snapshot().hover?.x === 45 && window.ember.snapshot().hover?.y === 47,
  );
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowRight');
  await page.mouse.move(view.x + view.width / 2 + 2, view.y + view.height / 2);
  await wait(() => window.ember.snapshot().hover?.x > 45);
  record('arrow keys pan camera through Worker input routing');
  await page.getByRole('button', { name: '菜单与存档', exact: true }).click();
  const finale = JSON.parse(await readFile('test-results/campaign/final-save.json', 'utf8'));
  await page.locator('input[type=file]').setInputFiles({
    name: 'final-save.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(finale)),
  });
  await page.getByRole('button', { name: '留下，继续经营', exact: true }).waitFor();
  await screen('09-victory');
  await page.getByRole('button', { name: '留下，继续经营', exact: true }).click();
  await wait(() => window.ember.snapshot().summary.continueAfterWin);
  assert.equal((await snapshot()).summary.beaconActive, false);
  assert.equal((await snapshot()).summary.nextRaid, finale.tick + 48000);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '概览', exact: true }).click();
  await page.getByText('救援已完成，继续经营。营地仍会遇到普通袭击。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '6倍速', exact: true }).click();
  await page.waitForFunction((t) => window.ember.snapshot().summary.tick > t + 100, finale.tick);
  await pause();
  await screen('10-continued-colony');
  record('victory can continue with normal raid schedule and no repeated finale');
  report.backends.push((await snapshot()).metrics);
  await context.close();
  for (const backend of ['webgl', 'main']) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await c.newPage();
    p.on('pageerror', (e) => report.errors.push(`${backend}: ${e.message}`));
    await p.goto(`${BASE}/?backend=${backend}`);
    await p.waitForFunction(() => window.ember?.snapshot().ready, null, { timeout: 45000 });
    await p.waitForTimeout(1500);
    const m = await p.evaluate(() => window.ember.snapshot().metrics);
    assert.equal(m.backend, 'WebGL');
    assert.equal(m.renderWorker, backend !== 'main');
    assert.ok(m.fps > 0);
    report.backends.push(m);
    record(`${backend} fallback path`, m);
    await c.close();
  }
  assert.deepEqual(report.errors, []);
  record('no browser errors or failed HTTP responses');
} finally {
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
