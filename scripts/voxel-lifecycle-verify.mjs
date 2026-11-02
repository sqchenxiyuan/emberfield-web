import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5182/?world=voxel';
const OUT = 'test-results/voxel-lifecycle';
const SEEDS = [2718, 8675309, 12345, 42, 987654, 13579];
await mkdir(OUT, { recursive: true });
const report = {
  base: BASE, cyclesRequested: SEEDS.length, startedAt: new Date().toISOString(),
  scope: 'Chrome headless, DPR 1; one document without reload, six normal UI save/new-world/load cycles. Only read-only window.voxel.snapshot/exportSave/project observation. Renderer must remain Worker WebGL2. Render geometry/texture counts are live Three.js resources; terrainGeometryBytes counts tracked terrain buffers, not total GPU memory. CDP Performance JSHeapUsedSize/JSHeapTotalSize covers the main page isolate only, excluding simulation/render workers, native browser allocations and VRAM. This bounded lifecycle run is not a long-duration leak proof or universal capacity estimate.',
  samples: [], cycles: [], uiChecks: [], screenshots: [], browserErrors: [], notices: [],
  navigationEvents: [], hotUpdates: [], uiFailures: [], checks: [], loadedAssets: [],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
page.setDefaultTimeout(10000);
page.on('pageerror', error => report.browserErrors.push({ type: 'pageerror', message: error.message }));
page.on('console', message => {
  if (message.type() === 'error') report.browserErrors.push({ type: 'console', message: message.text() });
  if (/\[vite\].*(hot updated|page reload)/i.test(message.text())) report.hotUpdates.push(message.text());
});
page.on('requestfailed', request => report.browserErrors.push({ type: 'requestfailed', url: request.url(), message: request.failure()?.errorText }));
page.on('requestfinished', request => {
  if (/\.(?:m?js|css)(?:\?|$)/.test(request.url()) && !report.loadedAssets.includes(request.url()))
    report.loadedAssets.push(request.url());
});
page.on('crash', () => report.browserErrors.push({ type: 'crash', message: 'page crashed' }));
page.on('framenavigated', frame => { if (frame === page.mainFrame()) report.navigationEvents.push(frame.url()); });
const state = () => page.evaluate(() => window.voxel.snapshot());
const wait = (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout });
const button = name => page.getByRole('button', { name, exact: true });
const metricKeys = ['geometries', 'textures', 'chunkCount', 'terrainGeometryBytes'];
const signature = metrics => Object.fromEntries(metricKeys.map(key => [key, metrics[key]]));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const physical = save => ({
  format: save.format, version: save.version, generator: save.generator, seed: save.seed,
  tick: save.tick, nextId: save.nextId, blocks: save.blocks, ladders: save.ladders,
  items: save.items, trees: save.trees, stockpiles: save.stockpiles, stats: save.stats,
  jobs: save.jobs.map(({ owner, reason, ...job }) => job),
  pawns: save.pawns.map(p => ({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z,
    food: p.food, rest: p.rest, priorities: p.priorities, cargo: p.cargo })),
});
async function settle() {
  // Renderer metrics arrive once per second. Wait beyond one publication before
  // checking successive samples, so old zero-pending metrics cannot pass a swap.
  await page.waitForTimeout(1250);
  await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().metrics.pendingChunks === 0);
  let previous = null, stable = 0;
  for (let n = 0; n < 16; n++) {
    const current = await state();
    const value = JSON.stringify(signature(current.metrics));
    stable = current.metrics.pendingChunks === 0 && value === previous ? stable + 1 : 0;
    if (stable >= 2) return;
    previous = value; await page.waitForTimeout(500);
  }
  throw new Error('Renderer resource metrics failed to settle');
}
async function capture(label) {
  const s = await state();
  let mainPageIsolateHeap = { available: false };
  try {
    const metrics = new Map((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    mainPageIsolateHeap = { available: true, usedBytes: metrics.get('JSHeapUsedSize') ?? null,
      totalBytes: metrics.get('JSHeapTotalSize') ?? null,
      scope: 'CDP Performance for main page isolate only; no worker/native/GPU totals; no forced GC' };
  } catch (error) { mainPageIsolateHeap.reason = String(error); }
  const notices = await page.getByRole('status').allTextContents();
  report.notices.push(...notices.filter(text => !report.notices.includes(text)));
  const sample = { label, at: new Date().toISOString(), seed: s.snapshot.seed, tick: s.snapshot.tick,
    worker: s.worker, viewport: page.viewportSize(), metrics: s.metrics, mainPageIsolateHeap };
  report.samples.push(sample);
  assert.equal(s.worker, true, 'Lifecycle measurements require the Worker renderer');
  assert.match(String(s.metrics.backend), /WebGL2/);
  assert.equal(s.metrics.chunkCount, 16); assert.equal(s.metrics.pendingChunks, 0);
  assert.equal(s.metrics.gridBytes, 64 * 64 * 16 * 2);
  for (const key of metricKeys) assert.ok(Number.isFinite(s.metrics[key]), `missing ${key}`);
  console.log('SAMPLE', label, JSON.stringify({ ...signature(s.metrics), mainPageHeapUsedBytes: mainPageIsolateHeap.usedBytes }));
  return sample;
}
async function screenshot(name) {
  const path = `${OUT}/${name}.png`; await page.screenshot({ path }); report.screenshots.push(path);
}
async function openMenu() { await button('菜单与存档').click(); await page.getByRole('dialog').waitFor(); }
async function hitDetails(locator) {
  return locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    const points = [[.5, .5], [.2, .2], [.8, .2], [.2, .8], [.8, .8]].map(([u, v]) => {
      const x = r.left + r.width * u, y = r.top + r.height * v;
      const target = document.elementFromPoint(x, y);
      return { x, y, hit: target === element || element.contains(target), blocker: target?.className ?? target?.tagName ?? null };
    });
    return { box: { x: r.x, y: r.y, width: r.width, height: r.height },
      fullyWithinViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      points, centerClickable: points[0].hit, allSamplePointsClickable: points.every(p => p.hit) };
  });
}
async function auditControl(viewport, label, locator) {
  if (!await locator.isVisible()) { report.uiFailures.push({ viewport, label, reason: 'not visible' }); return; }
  const initial = await hitDetails(locator);
  // A horizontal tool scroller is permitted, but the actual target must become
  // reachable through its normal scrolling container without DOM mutation.
  await locator.scrollIntoViewIfNeeded();
  const afterScroll = await hitDetails(locator);
  const check = { viewport, label, initial, afterScroll };
  report.uiChecks.push(check);
  if (!afterScroll.fullyWithinViewport || !afterScroll.allSamplePointsClickable)
    report.uiFailures.push({ viewport, label, reason: 'clipped or covered', details: afterScroll });
  else await locator.click({ trial: true });
}
async function auditViewport(width, height) {
  await page.setViewportSize({ width, height }); await settle();
  // Avoid treating a six-second operation notification as permanent layout.
  await page.getByRole('status').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  const viewport = `${width}x${height}`;
  const names = ['菜单与存档', '玩法指引', '上移一层', '下移一层', '地下', '地表', '二层',
    '查看', '伐木', '挖掘', '下挖梯井', '向上搭梯', '楼板', '墙壁', '梯子', '仓储', '拆除', '取消规划',
    '暂停', '1倍速', '2倍速', '3倍速'];
  for (const name of names) await auditControl(viewport, name, button(name));
  for (const title of ['向左旋转 Q', '返回营地', '向右旋转 E'])
    await auditControl(viewport, title, page.getByTitle(title, { exact: true }));
  for (const name of ['定位树木', '定位建议入口', '定位上行位置']) {
    if (await button(name).isVisible()) await auditControl(viewport, name, button(name));
  }
  const colonists = page.locator('.voxel-colonists button');
  for (let n = 0; n < await colonists.count(); n++) await auditControl(viewport, `colonist-${n + 1}`, colonists.nth(n));
  await screenshot(`ui-${viewport}`);
  await openMenu();
  for (const name of ['保存营地', '读取营地', '读取自动存档', '导出体素存档', '导入体素存档', '新开世界（替换当前进度）', '关闭菜单'])
    await auditControl(`${viewport}-menu`, name, button(name));
  await auditControl(`${viewport}-menu`, '体素世界种子', page.getByRole('textbox', { name: '体素世界种子', exact: true }));
  await screenshot(`menu-${viewport}`); await button('关闭菜单').click();
}

try {
  report.browser = browser.version(); await page.goto(BASE);
  await wait(() => window.voxel?.snapshot().ready); await settle();
  const baseline = await capture('baseline');
  const originalSeed = baseline.seed;
  for (let i = 0; i < SEEDS.length; i++) {
    const startTick = (await state()).snapshot.tick;
    await button('3倍速').click();
    await wait(tick => window.voxel.snapshot().snapshot.tick >= tick, startTick + 30);
    await button('暂停').click(); await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    const expected = await page.evaluate(() => window.voxel.exportSave());
    await writeFile(`${OUT}/cycle-${i + 1}-saved.json`, JSON.stringify(expected));
    await openMenu(); await button('保存营地').click();
    await page.waitForTimeout(150);
    await wait(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent === '保存营地' && !b.disabled));
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: '体素世界种子', exact: true }).fill(String(SEEDS[i]));
    await button('新开世界（替换当前进度）').click();
    await wait(seed => window.voxel.snapshot().snapshot.seed === seed && window.voxel.snapshot().snapshot.tick === 0, SEEDS[i]);
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); await settle();
    const fresh = await capture(`cycle-${i + 1}-new-${SEEDS[i]}`);
    await openMenu(); await button('读取营地').click();
    await wait(({ seed, tick }) => window.voxel.snapshot().snapshot.seed === seed && window.voxel.snapshot().snapshot.tick === tick,
      { seed: originalSeed, tick: expected.tick });
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); await settle();
    const restoredSave = await page.evaluate(() => window.voxel.exportSave());
    assert.deepEqual(physical(restoredSave), physical(expected), `cycle ${i + 1}: physical save state mismatch`);
    const restored = await capture(`cycle-${i + 1}-restored`);
    assert.deepEqual(signature(restored.metrics), signature(baseline.metrics), `cycle ${i + 1}: same-world renderer resources grew`);
    report.cycles.push({ cycle: i + 1, newSeed: SEEDS[i], savedTick: expected.tick,
      savedPhysicalSha256: digest(physical(expected)), restoredPhysicalSha256: digest(physical(restoredSave)),
      newWorld: signature(fresh.metrics), restored: signature(restored.metrics) });
    console.log('PASS', `save/new/load cycle ${i + 1} without page reload`);
  }
  await auditViewport(1280, 720); await auditViewport(900, 700);
  await capture('final-900x700');
  report.assetDigests = await Promise.all(report.loadedAssets.map(async url => {
    const response = await fetch(url); assert.ok(response.ok, `Failed to hash loaded asset ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return { url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  const comparable = report.samples.filter(s => s.label === 'baseline' || s.label.endsWith('-restored'));
  report.convergence = Object.fromEntries(metricKeys.map(key => {
    const values = comparable.map(s => s.metrics[key]);
    return [key, { values, min: Math.min(...values), max: Math.max(...values), delta: values.at(-1) - values[0] }];
  }));
  const heaps = comparable.map(s => s.mainPageIsolateHeap.usedBytes).filter(Number.isFinite);
  report.mainPageIsolateHeapObservation = heaps.length ? { samples: heaps, minBytes: Math.min(...heaps), maxBytes: Math.max(...heaps),
    finalMinusInitialBytes: heaps.at(-1) - heaps[0], monotonicallyIncreasing: heaps.every((n, i) => i === 0 || n > heaps[i - 1]),
    interpretation: 'Natural GC/JIT noise is retained. This is one page isolate and is not a whole-page or whole-browser leak/capacity claim.' } : null;
  assert.equal(report.navigationEvents.length, 1, 'The six cycles must share one document');
  assert.deepEqual(report.hotUpdates, [], 'Hot updates invalidate a fixed-implementation lifecycle sample');
  assert.deepEqual(report.browserErrors, [], 'Browser errors occurred');
  assert.ok(!report.notices.some(n => /异常|错误|失败/.test(n)), 'Application reported a worker/save error');
  assert.deepEqual(report.uiFailures, [], 'A key control is clipped or covered');
  report.checks.push('six physical save round-trips matched', 'same-world renderer counts and terrain bytes returned exactly to baseline',
    'one document with no navigation reload or hot update', 'Worker WebGL2 remained active', 'both viewport control audits passed');
  report.status = 'passed'; console.log('PASS voxel lifecycle', JSON.stringify(report.convergence));
} catch (error) {
  report.status = 'failed'; report.failure = String(error.stack ?? error);
  await screenshot('failure').catch(() => {}); throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close();
}
