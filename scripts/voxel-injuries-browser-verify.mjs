import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_INJURIES_BROWSER_OUT ?? 'test-results/voxel-injuries-browser';
const FIXTURES = process.env.VOXEL_INJURIES_OUT ?? 'test-results/voxel-injuries-campaign';
await mkdir(OUT, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Actual production Chrome canvas, DOM and file chooser. Normal-command combat and care fixtures and genuinely published v11 save; read-only snapshot/project/exportSave. All combat and medical actions use visible controls in both rendering modes.',
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
  try {
    await page.goto(String(url));
    await wait(() => window.voxel?.snapshot().ready);
    await click('暂停');
    await click('收起指引');
    await settle();
    assert.equal((await state()).worker, mode === 'worker');
    await click('菜单与存档');
    await page.getByLabel('允许袭击', { exact: true }).click();
    await wait(() => window.voxel.snapshot().snapshot.combat.enabled);
    const due = (await state()).snapshot.combat.nextRaid;
    assert(due > (await state()).snapshot.tick);
    await page.getByLabel('允许袭击', { exact: true }).click();
    await wait(() => !window.voxel.snapshot().snapshot.combat.enabled);
    check('normal menu toggles future raids and displays the preparation period');
    await click('关闭菜单');
    const old = await load('tests/fixtures/voxel-v11-start.json');
    const current = await save();
    assert.equal(current.version, 18);
    assert.deepEqual(current.items, old.items);
    assert.equal(current.combat.enabled, false);
    assert(current.pawns.every((p) => p.weapon === null && p.trauma.wounds.length === 0));
    check('the genuine v11 colony loads with no retroactive injuries, weapons or threats');
    const raid = await load(FIXTURES + '/raid.json');
    assert.equal(await page.locator('.voxel-colonists button').count(), 3);
    const enemy = raid.pawns.find((p) => p.faction === 'raider');
    await page
      .getByTestId('raid-status')
      .getByRole('button')
      .filter({ hasText: enemy.name })
      .click();
    assert.match(await page.getByTestId('combat-controls').innerText(), /敌对袭击者[\s\S]*钢匕首/);
    assert.equal(
      await page
        .getByTestId('combat-controls')
        .getByRole('button', { name: '征召', exact: true })
        .count(),
      0,
    );
    check('the scheduled attacker is inspectable without appearing as a controllable colonist');
    await page.mouse.move(700, 380);
    await page.mouse.wheel(0, -700);
    await page.keyboard.press('e');
    await page.getByTestId('combat-controls').scrollIntoViewIfNeeded();
    await settle();
    await shot('enemy');
    await page.keyboard.press('q');
    await page.mouse.wheel(0, 700);
    await settle();
    await selectPawn(raid.pawns[0].id);
    await click('征召');
    await page.getByLabel('近战目标', { exact: true }).selectOption(String(enemy.id));
    await click('近战攻击');
    await wait((id) => window.voxel.snapshot().snapshot.pawns[0].attackTargetId === id, enemy.id);
    await click('3倍速');
    await wait(() => window.voxel.snapshot().snapshot.pawns[0].path.length > 0);
    await click('暂停');
    await shot('drafted');
    check('draft and melee controls create a real path toward the enemy');
    const wounded = await load(FIXTURES + '/wounded.json');
    const patient = wounded.pawns.find(
      (p) =>
        p.faction === 'colony' &&
        p.trauma.wounds.some((w) => w.kind === 'cut' || w.kind === 'stab'),
    );
    const doctor = wounded.pawns.find(
      (p) => p.faction === 'colony' && p.id !== patient.id && !p.downed,
    );
    await selectPawn(patient.id);
    assert.match(await page.getByTestId('injury-detail').innerText(), /出血[\s\S]*尚未包扎/);
    await page.getByLabel('医护人员', { exact: true }).selectOption(String(doctor.id));
    await click('优先包扎（无药）');
    await click('3倍速');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).careProgress > 30,
      doctor.id,
    );
    await click('暂停');
    await shot('tending');
    const partial = await save();
    assert(partial.pawns.find((p) => p.id === doctor.id).careProgress > 0);
    check('visible treatment controls make the doctor approach and spend time on one wound');
    await click('菜单与存档');
    await click('保存营地');
    await page.waitForTimeout(300);
    await click('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).careProgress > 0,
      doctor.id,
    );
    check('manual saving and loading retain the active treatment and wound identity');
    await click('3倍速');
    await wait(
      (id) =>
        window.voxel
          .snapshot()
          .snapshot.pawns.find((p) => p.id === id)
          .trauma.wounds.every((w) => w.tendQuality !== null),
      patient.id,
    );
    await click('暂停');
    await selectPawn(patient.id);
    assert(
      (await state()).snapshot.pawns.find((p) => p.id === patient.id).trauma.wounds.length > 0,
    );
    assert.match(await page.getByTestId('injury-detail').innerText(), /没有持续出血/);
    await shot('bandaged');
    check('bandaging removes ongoing bleeding while visible injuries remain');
    await page.setViewportSize({ width: 900, height: 700 });
    await settle();
    await page.getByTestId('injury-detail').scrollIntoViewIfNeeded();
    assert(await page.getByTestId('injury-detail').isVisible());
    await shot('compact');
    check('injury and combat controls remain accessible at 900 by 700');
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
  process.exitCode = 1;
  console.error(String(e));
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(OUT + '/report.json', JSON.stringify(report, null, 2) + '\n');
}
