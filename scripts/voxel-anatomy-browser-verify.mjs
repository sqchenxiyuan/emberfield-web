import { withMedicineLedgers } from './voxel-migration-expectations.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_ANATOMY_BROWSER_OUT ?? 'test-results/voxel-anatomy-browser';
const FIXTURES = process.env.VOXEL_ANATOMY_OUT ?? 'test-results/voxel-anatomy-campaign';
await mkdir(OUT, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Production Chrome worker/main. Genuine v15 migration, ordinary raid fixture and explicitly controlled hand-eye fixture are distinct. All browser changes through visible DOM/canvas/file chooser; snapshot/exportSave read-only. Controlled anatomy setup does not prove ordinary combat.',
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
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot?.speed === 0);
    if (name === '3倍速') await wait(() => window.voxel.snapshot().snapshot?.speed === 3);
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
    await wait((tick) => window.voxel.snapshot().snapshot?.tick === tick, data.tick);
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
    await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot !== null);
    await click('暂停');
    await click('收起指引');
    await settle();
    assert.equal((await state()).worker, mode === 'worker');
    for (const name of ['trauma', 'research']) {
      const old = await load(`tests/fixtures/voxel-v15-${name}.json`),
        migrated = await save();
      assert.equal(migrated.version, 19);
      assert.equal((await state()).snapshot.speed, 0);
      for (const key of ['items', 'researchBenches', 'stats'])
        assert.deepEqual(migrated[key], key === 'stats' ? withMedicineLedgers(old.stats) : old[key]);
      assert.deepEqual(migrated.research, {
        ...old.research,
        progress: { ...old.research.progress, PlateArmor: 0 },
      });
      assert.deepEqual(
        migrated.pawns.map((p) => [p.id, p.skills, p.weapon, p.worn, p.cargo]),
        old.pawns.map((p) => [p.id, p.skills, p.weapon, p.worn, p.cargo]),
      );
      for (const p of migrated.pawns) {
        const before = old.pawns.find((q) => q.id === p.id);
        assert.deepEqual(
          [...p.trauma.wounds, ...p.trauma.missingParts.flatMap((m) => m.legacyWounds)].sort(
            (a, b) => a.id - b.id,
          ),
          [...before.trauma.wounds].sort((a, b) => a.id - b.id),
        );
      }
      check(`authentic v15 ${name} imports paused with preserved injuries, equipment and research`);
    }
    const normal = await load(FIXTURES + '/wounded.json');
    const wounded = normal.pawns.find((p) => p.faction === 'colony' && p.trauma.wounds.length);
    await selectPawn(wounded.id);
    assert.match(await page.getByTestId('injury-detail').innerText(), /骨裂|割伤|刺伤/);
    await page.getByTestId('anatomy-details').locator('summary').click();
    assert.equal(await page.locator('[data-testid^="body-part-"]').count(), 64);
    assert.match(await page.getByTestId('body-part-sternum').innerText(), /胸骨/);
    await page.getByTestId('body-part-sternum').scrollIntoViewIfNeeded();
    await shot('ordinary-injuries');
    check('ordinary raid injury records are visible in the 64-part tree');

    const controlled = await load('test-results/voxel-anatomy-controlled/hand-eye.json');
    const patientId = controlled.pawns[0].id,
      doctorId = controlled.pawns[1].id;
    await selectPawn(patientId);
    assert.match(
      await page.getByTestId('missing-rightHand').innerText(),
      /无法自然恢复[\s\S]*新鲜断端/,
    );
    assert.match(await page.getByTestId('pawn-health').innerText(), /视力 86%/);
    await page.getByTestId('capacity-details').locator('summary').click();
    assert.equal(await page.locator('[data-testid^="capacity-"]').count(), 12); // wrapper plus 11 capacities
    assert.match(await page.getByTestId('capacity-sight').innerText(), /86%[\s\S]*左眼/);
    await page.getByTestId('capacity-sight').scrollIntoViewIfNeeded();
    await shot('capacities');
    await page.getByTestId('capacity-details').locator('summary').click();
    const anatomy = page.getByTestId('anatomy-details');
    if ((await anatomy.getAttribute('open')) === null) await anatomy.locator('summary').click();
    assert.match(await page.getByTestId('body-part-rightThumb').innerText(), /缺失/);
    assert.match(await page.getByTestId('body-part-leftEye').innerText(), /5\/10/);
    await anatomy.locator('summary').click();
    check('controlled hand loss marks descendants missing and eye HP explains vision loss');

    await page.getByLabel('医疗政策', { exact: true }).selectOption('noMedicine');
    await wait(
      (id) =>
        window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).medical.policy ===
        'noMedicine',
      patientId,
    );
    await page.getByLabel('医护人员', { exact: true }).selectOption(String(doctorId));
    await click('优先护理');
    await click('3倍速');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).careProgress > 40,
      doctorId,
    );
    await click('暂停');
    await shot('stump-tending');
    const partial = await save();
    await click('菜单与存档');
    await click('保存营地');
    await page.waitForTimeout(250);
    await click('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait((tick) => window.voxel.snapshot().snapshot?.tick === tick, partial.tick);
    assert.deepEqual(
      (await save()).pawns.map((p) => p.trauma),
      partial.pawns.map((p) => p.trauma),
    );
    assert.equal(
      (await save()).pawns.find((p) => p.id === doctorId).careProgress,
      partial.pawns.find((p) => p.id === doctorId).careProgress,
    );
    check(
      'fresh stump treatment uses a reachable doctor and preserves progress during manual save/load',
    );
    await click('3倍速');
    await wait((id) => {
      const t = window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).trauma;
      return (
        t.missingParts.every((m) => !m.isFresh) && t.wounds.every((w) => w.tendQuality !== null)
      );
    }, patientId);
    await click('暂停');
    await selectPawn(patientId);
    const treated = (await save()).pawns.find((p) => p.id === patientId);
    assert.equal(treated.trauma.missingParts[0].part, 'rightHand');
    assert(treated.trauma.missingParts[0].tendQuality !== null);
    assert.match(await page.getByTestId('missing-rightHand').innerText(), /断端已稳定/);
    assert.match(await page.getByTestId('injury-detail').innerText(), /没有持续出血/);
    check('completed care stops fresh-stump bleeding without regenerating a hand');
    await click('征召');
    await page.mouse.move(700, 380);
    await page.mouse.wheel(0, -650);
    await page.keyboard.press('e');
    await settle();
    await shot('left-handed');
    assert.equal(
      (await save()).pawns.find((p) => p.id === patientId).weapon.id,
      controlled.pawns[0].weapon.id,
    );
    check('one-handed drafted pawn retains its physical knife through rotating view');
    await page.setViewportSize({ width: 900, height: 700 });
    await settle();
    await page.getByTestId('missing-rightHand').scrollIntoViewIfNeeded();
    await shot('compact');
    assert(await page.getByTestId('missing-rightHand').isVisible());
    check('health and missing-part information remains accessible at 900 by 700');
    await Promise.all(reads);
    assert(
      result.assets.length && result.assets.every((a) => a.status === 200 && a.matchesLocalBuild),
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
