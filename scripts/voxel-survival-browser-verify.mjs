import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_SURVIVAL_BROWSER_OUT ?? 'test-results/voxel-survival-browser';
const FIXTURES = process.env.VOXEL_SURVIVAL_OUT ?? 'test-results/voxel-survival-campaign';
const TEMPERATURE_FIXTURES =
  process.env.VOXEL_SURVIVAL_TEMPERATURE_OUT ?? 'test-results/voxel-survival-temperature';
await mkdir(OUT, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Actual Chrome canvas, DOM, file chooser and save controls in both rendering modes. Normal-calendar campaign fixtures and genuinely published v9 save; read-only snapshot/project/exportSave only. Manual care commands are issued through visible controls, with automatic care disabled through the work UI.',
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
    const legacy = await load('tests/fixtures/voxel-v9-start.json');
    const migrated = await save();
    assert.equal(migrated.version, 18);
    assert.deepEqual(migrated.blocks, legacy.blocks);
    assert.deepEqual(migrated.trees, legacy.trees);
    assert(migrated.pawns.every((p) => !p.dead && !p.downed && p.health.malnutrition === 0));
    check('genuine v9 map migrates to healthy colonists without replacing terrain or trees');
    const collapsed = await load(`${FIXTURES}/collapsed.json`);
    const patient = collapsed.pawns.find((p) => p.downed),
      id = patient.id;
    await selectPawn(id);
    const panel = page.getByTestId('pawn-health');
    assert.match(await panel.innerText(), /倒地/);
    assert.match(await page.getByTestId('condition-malnutrition').innerText(), /营养不良/);
    assert(await button('现在去睡觉').isDisabled());
    await panel.scrollIntoViewIfNeeded();
    await shot('collapsed');
    check('naturally collapsed colonist exposes disease and disabled self-care controls');
    const helpers = collapsed.pawns.filter((p) => p.id !== id);
    for (const helper of helpers) {
      await selectPawn(helper.id);
      await page.getByLabel(`${helper.name} care优先级`, { exact: true }).selectOption('0');
    }
    await click('二层');
    await inspect(collapsed.beds[0], 0.49);
    await page.getByLabel('床位用途', { exact: true }).selectOption('sleep');
    await wait(() => !window.voxel.snapshot().snapshot.beds[0].medical);
    assert(!(await state()).snapshot.beds[0].medical);
    await page.getByLabel('床位用途', { exact: true }).selectOption('medical');
    await wait(() => window.voxel.snapshot().snapshot.beds[0].medical);
    assert((await state()).snapshot.beds[0].medical);
    assert(await page.getByLabel('床位主人', { exact: true }).isDisabled());
    check('built wooden bed switches between sleeping and medical use through inspector');
    await click('地下');
    await inspect(collapsed.doors[0], 0.8);
    await page.getByLabel('门状态', { exact: true }).selectOption('auto');
    await selectPawn(id);
    await page.getByLabel('医护人员', { exact: true }).selectOption(String(helpers[0].id));
    await click('优先救援');
    await wait(
      (id) =>
        window.voxel
          .snapshot()
          .snapshot.pawns.some((p) => p.patientId === id && p.carePhase === 'rescueApproach'),
      id,
    );
    check('manual priority rescue uses the selected helper even when automatic care is disabled');
    await click('3倍速');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).carriedBy !== null,
      id,
    );
    await click('暂停');
    await selectPawn(id);
    await shot('carrying');
    const carrying = (await save()).pawns.find((p) => p.id === id);
    assert(carrying.downed && carrying.carriedBy !== null);
    check('real helper picks up patient and renders a carried pose');
    await click('菜单与存档');
    await click('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    const stored = await save();
    await click('关闭菜单');
    await load(`${FIXTURES}/recovered.json`);
    await click('菜单与存档');
    await click('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await settle();
    const restored = await save();
    for (const key of ['tick', 'items', 'stats']) assert.deepEqual(restored[key], stored[key]);
    // Loading refreshes transient movement cadence and idle status text; health,
    // physical cargo, care progress and both sides of carrying must persist.
    const persistentPawn = ({ reason, moveTick, ...value }) => value;
    assert.deepEqual(restored.pawns.map(persistentPawn), stored.pawns.map(persistentPawn));
    check('manual save and restore preserve a carried patient and helper relationship');
    await click('3倍速');
    await wait(
      ({ id, bedId }) => {
        const p = window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id);
        return p.sleepBedId === bedId && p.carriedBy === null;
      },
      { id, bedId: collapsed.beds[0].id },
    );
    await click('暂停');
    await selectPawn(id);
    await shot('medical-bed');
    assert.equal((await state()).snapshot.pawns.find((p) => p.id === id).z, 11);
    check('patient physically arrives in upper medical bed after travelling between layers');
    await page.getByLabel('医护人员', { exact: true }).selectOption(String(helpers[0].id));
    await click('优先喂食');
    await click('3倍速');
    await wait(
      (id) =>
        window.voxel
          .snapshot()
          .snapshot.pawns.some((p) => p.patientId === id && p.carePhase === 'feed'),
      id,
    );
    await click('暂停');
    await shot('feeding');
    const before = (await state()).snapshot.stats.consumed.food;
    await click('3倍速');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).food > 0,
      id,
    );
    await click('暂停');
    const after = (await state()).snapshot;
    assert(after.stats.consumed.food > before);
    assert(after.pawns.find((p) => p.id === id).health.malnutrition > 0.7);
    check('visible feeding work consumes actual food without instantly curing malnutrition');
    await load(`${FIXTURES}/recovered.json`);
    await selectPawn(id);
    assert.equal((await state()).snapshot.pawns.find((p) => p.id === id).health.malnutrition, 0);
    assert(!(await state()).snapshot.pawns.find((p) => p.id === id).downed);
    check('normal-calendar recovery fixture shows a healthy mobile colonist');
    for (const [condition, label] of [
      ['hypothermia', '失温'],
      ['heatstroke', '中暑'],
    ]) {
      const data = await load(`${TEMPERATURE_FIXTURES}/${condition}-exposed.json`);
      const affected = data.pawns.find((p) => p.health[condition] >= 0.2);
      assert(affected);
      await selectPawn(affected.id);
      const row = page.getByTestId(`condition-${condition}`);
      await row.scrollIntoViewIfNeeded();
      assert.match(await row.innerText(), new RegExp(label));
      await shot(condition);
      check(`actual equipment exposure displays ${condition} and its current severity`);
    }
    const fatal = await load(`${TEMPERATURE_FIXTURES}/heatstroke-fatal.json`);
    await selectPawn(fatal.pawns[0].id);
    assert.match(await page.getByTestId('pawn-health').innerText(), /已死亡/);
    assert.match(await page.getByLabel('健康警报').innerText(), /营地已无人存活/);
    assert(await button('现在去睡觉').isDisabled());
    assert((await state()).snapshot.pawns.every((p) => p.dead));
    await shot('fatal');
    check('natural death remains visible after import with inactive colonists and colony alert');
    await load(`${FIXTURES}/collapsed.json`);
    await page.setViewportSize({ width: 900, height: 700 });
    await selectPawn(id);
    const carers = page.getByLabel('医护人员', { exact: true });
    await carers.scrollIntoViewIfNeeded();
    await carers.selectOption(String(helpers[1].id));
    assert.equal(await carers.inputValue(), String(helpers[1].id));
    await shot('compact');
    check('health and care controls remain usable at 900 by 700');
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
