import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_PLANTS_BROWSER_OUT ?? 'test-results/voxel-plants-browser';
const FIXTURES = process.env.VOXEL_PLANTS_OUT ?? 'test-results/voxel-plants-campaign';
await mkdir(OUT, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Real Chrome canvas/DOM controls in Worker and main rendering modes. Genuine v8 and normal-calendar campaign saves imported through file chooser. Only read-only window.voxel snapshot/project/exportSave/blockAt; no state or time injection.',
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
  const wait = (fn, arg, timeout = 45000) => page.waitForFunction(fn, arg, { timeout });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const click = async (name) => {
    const b = button(name);
    await b.scrollIntoViewIfNeeded();
    await b.click();
  };
  const check = (name, details = {}) => {
    result.checks.push({ name, ...details });
    console.log('PASS', mode, name);
  };
  const settle = async () => {
    await page.waitForTimeout(600);
    await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0);
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
    await wait((t) => window.voxel.snapshot().snapshot.tick === t, data.tick);
    await settle();
    return data;
  }
  async function canvas(p, z = 0.05) {
    const q = await page.evaluate(({ p, z }) => window.voxel.project({ ...p, z: p.z + z }), {
      p,
      z,
    });
    assert(
      q.x > 320 && q.x < 1260 && q.y > 90 && q.y < 630,
      `target within usable canvas: ${JSON.stringify({ p, q })}`,
    );
    await page.mouse.click(q.x, q.y);
  }
  async function inspect(tree) {
    await click('查看');
    // Lower trunk stays within the pickable mesh at every growth stage.
    await canvas(tree, 0.15 + 0.25 * tree.growth);
    await wait((p) => {
      const q = window.voxel.snapshot().selected;
      return q?.x === p.x && q?.y === p.y && q?.z === p.z;
    }, tree);
    await page.getByTestId('tree-detail').waitFor();
  }
  try {
    await page.goto(String(url));
    await wait(() => window.voxel?.snapshot().ready);
    await click('暂停');
    await click('收起指引');
    await settle();
    assert.equal((await state()).worker, mode === 'worker');
    const legacy = await load('tests/fixtures/voxel-v8-start.json');
    const migrated = await save();
    assert.equal(migrated.version, 21);
    assert.deepEqual(migrated.blocks, legacy.blocks);
    assert.deepEqual(
      migrated.trees.map((t) => [t.id, t.wood, t.species]),
      legacy.trees.map((t) => [t.id, t.wood, t.species]),
    );
    assert(migrated.trees.every((t) => t.growth === 1 && t.health === 1));
    check('genuine v8 map imports with its existing mature tree resources intact');
    await load(`${FIXTURES}/sapling.json`);
    let s = (await state()).snapshot,
      tree = s.trees.find((t) => t.planted);
    assert(tree && tree.growth < 0.2);
    const plot = { x: tree.x, y: tree.y, z: tree.z };
    await inspect(tree);
    assert.match(
      await page.getByTestId('tree-detail').innerText(),
      /人工种植[\s\S]*木材 × 0[\s\S]*肥力[\s\S]*光照/,
    );
    check('small sapling is selectable and explains zero yield and growth conditions');
    await shot('sapling');
    await click('取消这格林地');
    await wait(() => window.voxel.snapshot().snapshot.treePlots.length === 0);
    assert((await state()).snapshot.trees.some((t) => t.id === tree.id));
    check('removing a grove through the inspector keeps the tree alive');
    const before = (await state()).snapshot.stats.produced.wood;
    await click('清除树苗');
    await click('3倍速');
    await wait((id) => !window.voxel.snapshot().snapshot.trees.some((t) => t.id === id), tree.id);
    await click('暂停');
    assert.equal((await state()).snapshot.stats.produced.wood, before);
    check('actual clearing work removes the sapling without producing wood');
    await click('林地区');
    await page.getByLabel('种植树种', { exact: true }).selectOption('saguaro');
    await canvas(plot);
    await wait(() => window.voxel.snapshot().snapshot.treePlots.length === 1);
    assert.equal((await state()).snapshot.treePlots[0].species, 'saguaro');
    check('canvas zoning and the species selector create a real planting job');
    await click('3倍速');
    await wait(
      (p) =>
        window.voxel
          .snapshot()
          .snapshot.trees.some((t) => t.planted && t.x === p.x && t.y === p.y && t.z === p.z),
      plot,
      90000,
    );
    await click('暂停');
    tree = (await state()).snapshot.trees.find(
      (t) => t.planted && t.x === plot.x && t.y === plot.y,
    );
    await inspect(tree);
    check('colonist completes planting with a new visible sapling');
    await click('菜单与存档');
    await click('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    const saved = await save();
    await click('关闭菜单');
    await load(`${FIXTURES}/mature.json`);
    s = (await state()).snapshot;
    tree = s.trees.find((t) => t.planted && t.growth === 1);
    assert(tree);
    await inspect(tree);
    assert.match(await page.getByTestId('tree-detail').innerText(), /成熟[\s\S]*木材 × 15/);
    await shot('mature');
    check('normal-calendar mature fixture displays full-size tree and fifteen wood');
    const wood = s.stats.produced.wood;
    await click('标记砍伐');
    await click('3倍速');
    await wait((id) => !window.voxel.snapshot().snapshot.trees.some((t) => t.id === id), tree.id);
    await click('暂停');
    assert.equal((await state()).snapshot.stats.produced.wood - wood, 15);
    check('mature tree cutting through the inspector yields the displayed wood');
    await click('3倍速');
    await wait(
      (p) =>
        window.voxel
          .snapshot()
          .snapshot.trees.some(
            (t) => t.planted && t.id !== p.id && t.x === p.x && t.y === p.y && t.z === p.z,
          ),
      tree,
      90000,
    );
    await click('暂停');
    const replacement = (await state()).snapshot.trees.find(
      (t) => t.planted && t.x === tree.x && t.y === tree.y,
    );
    await inspect(replacement);
    await shot('replanted');
    check('maintained grove automatically replants after harvesting');
    await click('菜单与存档');
    await click('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await settle();
    const restored = await save();
    for (const k of ['tick', 'trees', 'treePlots', 'items', 'stats'])
      assert.deepEqual(restored[k], saved[k]);
    check('manual save and restore retain tree lifecycle and grove state');
    await page.setViewportSize({ width: 900, height: 700 });
    await click('林地区');
    await page.getByLabel('种植树种', { exact: true }).selectOption('pine');
    await shot('compact');
    assert.equal(await page.getByLabel('种植树种', { exact: true }).inputValue(), 'pine');
    check('grove controls remain usable at 900 by 700');
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
