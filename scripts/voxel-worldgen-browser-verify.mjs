import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { importLegacyStart, LEGACY_START } from './voxel-legacy-start.mjs';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_WORLDGEN_BROWSER_OUT ?? 'test-results/voxel-worldgen-browser';
await mkdir(OUT, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const digest = (s) => sha(JSON.stringify(s));
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Real Chrome controls and canvas clicks in Worker and main rendering modes. Only read-only snapshot/project/exportSave access. Preview must not mutate the current colony; new maps must match displayed settings; actual cutting, save reload and genuine v7 import.',
  legacy: LEGACY_START,
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
  const result = { mode, checks: [], errors: [], assets: [], screenshots: [] };
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
  const wait = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const click = async (name) => {
    const b = button(name);
    await b.scrollIntoViewIfNeeded();
    await b.click();
  };
  const check = (name, data = {}) => {
    result.checks.push({ name, ...data });
    console.log('PASS', mode, name);
  };
  const preview = () => page.locator('[data-testid="world-preview"][data-ready="true"]').waitFor();
  const settle = async () => {
    await page.waitForTimeout(1100);
    await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0);
  };
  async function shot(name) {
    const file = `${OUT}/${mode}-${name}.png`;
    await page.screenshot({ path: file });
    result.screenshots.push(file);
  }
  async function create(biome, hilliness, seed = 73129) {
    await page.getByRole('textbox', { name: '体素世界种子' }).fill(String(seed));
    await page.getByLabel('生态群落', { exact: true }).selectOption(biome);
    await page.getByLabel('地形起伏', { exact: true }).selectOption(hilliness);
    await preview();
    const text = await page.getByTestId('world-preview').innerText();
    await click('新开世界（替换当前进度）');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait(
      ({ biome, hilliness, seed }) => {
        const s = window.voxel.snapshot().snapshot;
        return (
          s.seed === seed &&
          s.settings.biome === biome &&
          s.settings.hilliness === hilliness &&
          s.tick === 0
        );
      },
      { biome, hilliness, seed },
    );
    await settle();
    const s = (await state()).snapshot;
    assert(text.includes(`${s.worldSummary.growingDays} / 60`));
    assert(text.includes(`${s.worldSummary.trees.total} 株`));
    assert.equal((await state()).level, s.spawn.z);
    assert.equal(s.generator, 2);
    return s;
  }
  try {
    await page.goto(String(url));
    await wait(() => window.voxel?.snapshot().ready);
    await settle();
    await click('暂停');
    await click('收起指引');
    assert.equal((await state()).worker, mode === 'worker');
    check('expected renderer starts on generator 2 at the actual spawn height');
    const original = await save();
    await click('菜单与存档');
    await preview();
    await page.getByLabel('生态群落', { exact: true }).selectOption('desert');
    await page.getByLabel('年降雨量', { exact: true }).fill('0');
    await preview();
    const dryPreview = await page.getByTestId('world-preview').innerText();
    await page.getByLabel('年降雨量', { exact: true }).fill('2500');
    await preview();
    assert.notEqual(await page.getByTestId('world-preview').innerText(), dryPreview);
    assert.equal(digest(await save()), digest(original));
    check('rainfall changes the preview while current terrain, jobs and clock stay unchanged');
    await page.getByRole('textbox', { name: '体素世界种子' }).fill('abc');
    await page.getByRole('alert').waitFor();
    assert(await button('新开世界（替换当前进度）').isDisabled());
    assert.equal(digest(await save()), digest(original));
    check('invalid seed cannot replace a colony or reuse a stale preview');
    const generated = [];
    for (const [biome, hilliness, species] of [
      ['temperate', 'flat', 'poplar'],
      ['boreal', 'large', 'pine'],
      ['desert', 'mountainous', 'saguaro'],
    ]) {
      if (!(await page.getByRole('dialog').isVisible())) await click('菜单与存档');
      const s = await create(biome, hilliness);
      assert(s.trees.length > 0 && s.trees.every((t) => t.species === species));
      generated.push({
        biome,
        blocks: digest((await save()).blocks),
        temperature: s.temperature,
        summary: s.worldSummary,
      });
      await click('总览');
      await settle();
      await shot(`${biome}-overview`);
      await click('地表');
      check(`${biome} creation matches its preview and renders the corresponding plant species`, {
        spawn: s.spawn,
        summary: s.worldSummary,
      });
    }
    assert.equal(new Set(generated.map((g) => g.blocks)).size, 3);
    assert.equal(new Set(generated.map((g) => g.temperature)).size, 3);
    check(
      'same seed with different terrain and climate produces different real maps and temperatures',
    );
    // Select a nearby actual cactus through the guide, then inspect and cut with real mouse input.
    await click('玩法指引');
    await click('定位树木');
    const tree = (await state()).selected;
    assert(tree);
    await click('收起指引');
    await click('查看');
    await settle();
    const selectedTree = (await state()).snapshot.trees.find(
      (t) => t.x === tree.x && t.y === tree.y && t.z === tree.z,
    );
    assert(selectedTree);
    const expectedWood = (await state()).snapshot.treeConditions.find(
      (c) => c.id === selectedTree.id,
    ).yield;
    const center = await page.evaluate(
      ({ p, growth }) => window.voxel.project({ ...p, z: p.z + 0.15 + 0.25 * growth }),
      { p: tree, growth: selectedTree.growth },
    );
    await page.mouse.click(center.x, center.y);
    await wait((p) => {
      const q = window.voxel.snapshot().selected;
      return q?.x === p.x && q?.y === p.y && q?.z === p.z;
    }, tree);
    assert.match(await page.getByTestId('voxel-inspector').innerText(), /巨柱仙人掌/);
    assert((await page.getByTestId('tree-detail').innerText()).includes(`木材 × ${expectedWood}`));
    await click('伐木');
    await page.mouse.click(center.x, center.y);
    await click('3倍速');
    await wait(() => window.voxel.snapshot().snapshot.stats.cut >= 1);
    await click('暂停');
    assert.equal((await state()).snapshot.stats.produced.wood, expectedWood);
    check(
      'a visible cactus is selectable and actual work produces its current growth-dependent yield',
      { expectedWood },
    );
    await click('菜单与存档');
    await click('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    const saved = await save();
    await create('temperate', 'small', 42);
    await click('菜单与存档');
    await click('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await settle();
    const reloaded = await save();
    for (const k of ['blocks', 'settings', 'spawn', 'trees', 'items', 'stats'])
      assert.deepEqual(reloaded[k], saved[k]);
    assert.equal(reloaded.tick, saved.tick);
    check('manual save and reload keep the selected climate and physically harvested map');
    await page.setViewportSize({ width: 900, height: 700 });
    await click('菜单与存档');
    await preview();
    for (const label of ['生态群落', '地形起伏', '年均温度', '年降雨量', '纬度']) {
      const el = page.getByLabel(label, { exact: true });
      await el.scrollIntoViewIfNeeded();
      await el.click({ trial: true });
    }
    await button('新开世界（替换当前进度）').scrollIntoViewIfNeeded();
    await button('新开世界（替换当前进度）').click({ trial: true });
    await shot('setup-900');
    await click('关闭菜单');
    check('world setup remains reachable at 900 by 700');
    await importLegacyStart(page);
    assert.equal((await save()).generator, 1);
    assert.equal((await save()).version, 9);
    assert.equal((await state()).snapshot.temperature, 21);
    check('unchanged published v7 colony loads as generator 1 with its original climate');
    await Promise.all(reads);
    assert(result.assets.length >= 4);
    assert(result.assets.every((a) => a.status === 200 && a.matchesLocalBuild));
    assert.deepEqual(result.errors, []);
    result.generated = generated;
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
