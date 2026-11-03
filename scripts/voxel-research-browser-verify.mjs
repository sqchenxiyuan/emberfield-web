import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_RESEARCH_BROWSER_OUT ?? 'test-results/voxel-research-browser';
const FIXTURES = process.env.VOXEL_RESEARCH_OUT ?? 'test-results/voxel-research-campaign';
const OLD_SKILLS = ['mining', 'construction', 'plants', 'cooking', 'crafting', 'medicine', 'melee'];
const COSTS = {
  ComplexFurniture: 300,
  PassiveCooler: 400,
  Stonecutting: 300,
  ComplexClothing: 600,
  Electricity: 1600,
  NutrientPaste: 400,
  AirConditioning: 500,
  TreeSowing: 1000,
  Smithing: 700,
  LongBlades: 400,
  Batteries: 400,
  SolarPanels: 600,
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const skillsOf = (s) => s.pawns.map((p) => ({ id: p.id, skills: p.skills }));
const intellectual = (s) => s.pawns.map((p) => ({ id: p.id, ...p.skills.intellectual }));
const totalXP = (s) => {
  let value = s.xp;
  for (let level = 0; level < s.level; level++)
    value += level <= 9 ? (level + 1) * 1000 : 10000 + 2000 * (level - 9);
  return value;
};
await mkdir(OUT, { recursive: true });
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Production Chrome worker/main modes. All changes through visible DOM/canvas/file chooser. Only snapshot/project/exportSave are read-only observations. Genuine v14 migration and normal-command v16 campaign fixtures; no injected progress, XP, technology, resources or time.',
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
  url.searchParams.set('world', 'voxel');
  if (mode === 'main') url.searchParams.set('render', 'main');
  else url.searchParams.delete('render');
  const result = { mode, checks: [], errors: [], assets: [], screenshots: [], fixtures: [] };
  report.modes.push(result);
  const reads = [];
  page.on('pageerror', (e) => result.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') result.errors.push(m.text());
  });
  page.on('response', (response) => {
    if (!new URL(response.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const asset = { url: response.url(), status: response.status() };
    result.assets.push(asset);
    reads.push(
      response
        .body()
        .then(async (bytes) => {
          asset.bytes = bytes.length;
          asset.sha256 = sha(bytes);
          asset.matchesLocalBuild =
            sha(await readFile('dist/assets/' + path.basename(new URL(asset.url).pathname))) ===
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
  const click = async (name) => {
    const button = page.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot?.speed === 0);
    if (name === '3倍速') await wait(() => window.voxel.snapshot().snapshot?.speed === 3);
  };
  const settle = async () => {
    await page.waitForTimeout(400);
    await wait(() => {
      const s = window.voxel.snapshot();
      return (
        s.snapshot !== null &&
        s.metrics.backend === 'Three.js · WebGL2' &&
        s.metrics.pendingChunks === 0
      );
    });
  };
  const check = (name, details = {}) => {
    result.checks.push({ name, ...details });
    console.log('PASS', mode, name);
  };
  const shot = async (name) => {
    await page.locator('.voxel-toast').waitFor({ state: 'hidden', timeout: 8000 });
    const file = `${OUT}/${mode}-${name}.png`;
    await page.screenshot({ path: file });
    result.screenshots.push(file);
  };
  const openResearch = async () => {
    if (!(await page.getByTestId('research-panel').isVisible())) await click('研究科技');
    await page.getByTestId('research-panel').waitFor();
  };
  const closeResearch = async () => {
    if (await page.getByTestId('research-panel').isVisible()) await click('关闭研究面板');
  };
  async function load(file) {
    await closeResearch();
    const bytes = await readFile(file),
      data = JSON.parse(bytes);
    result.fixtures.push({ file, sha256: sha(bytes), version: data.version, tick: data.tick });
    if (!(await page.getByRole('dialog').isVisible())) await click('菜单与存档');
    const chooser = page.waitForEvent('filechooser');
    await click('导入体素存档');
    await (await chooser).setFiles(file);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait((tick) => window.voxel.snapshot().snapshot?.tick === tick, data.tick);
    await wait(() => window.voxel.snapshot().snapshot?.speed === 0);
    await settle();
    return data;
  }
  async function selectPawn(id) {
    const pawn = (await state()).snapshot.pawns.find((p) => p.id === id);
    assert(pawn && pawn.faction === 'colony');
    await page
      .locator('.voxel-colonists button')
      .filter({ hasText: new RegExp('^' + pawn.name) })
      .click();
    await settle();
    return pawn;
  }
  async function inspectBench(bench) {
    await closeResearch();
    const pawns = (await state()).snapshot.pawns.filter((p) => p.faction === 'colony');
    const nearest = pawns.sort(
      (a, b) =>
        Math.abs(a.x - bench.x) +
        Math.abs(a.y - bench.y) -
        Math.abs(b.x - bench.x) -
        Math.abs(b.y - bench.y),
    )[0];
    await selectPawn(nearest.id);
    while ((await state()).level !== bench.z)
      await click((await state()).level < bench.z ? '上移一层' : '下移一层');
    await click('查看');
    await settle();
    const target = {
      x: bench.x + (bench.axis === 'x' ? 1 : 0),
      y: bench.y + (bench.axis === 'x' ? 0 : 1),
      z: bench.z + 0.8,
    };
    let q;
    for (let i = 0; i < 4; i++) {
      q = await page.evaluate((p) => window.voxel.project(p), target);
      if (q.x > 330 && q.x < 1250 && q.y > 160 && q.y < 625) break;
      await page.mouse.move(760, 400);
      await page.mouse.wheel(0, 250);
      await settle();
    }
    assert(q.x > 330 && q.x < 1250 && q.y > 160 && q.y < 625, JSON.stringify({ bench, q }));
    await page.mouse.click(q.x, q.y);
    await page.getByTestId('research-bench').waitFor();
    await settle();
    assert.match(await page.getByTestId('research-bench').innerText(), new RegExp('Z ' + bench.z));
  }
  try {
    await page.goto(String(url));
    await wait(() => {
      const s = window.voxel?.snapshot();
      return s?.ready && s.snapshot && s.metrics.backend === 'Three.js · WebGL2';
    });
    await click('暂停');
    await click('收起指引');
    await settle();
    assert.equal((await state()).worker, mode === 'worker');
    const fresh = await save();
    assert.equal(fresh.version, 17);
    assert.equal(fresh.research.origin, 'industrial-start');
    assert.equal(fresh.research.current, null);
    assert.equal(fresh.researchBenches.length, 0);
    assert.equal(Object.values(fresh.research.progress).filter((p) => p > 0).length, 7);
    for (const name of ['林地区', '燃料锻造台', '蓄电池', '太阳能板']) {
      const control = page.getByRole('button', { name, exact: true });
      assert(await control.isDisabled(), name + ' requires research');
      assert.match(await control.getAttribute('title'), /需要研究/);
    }
    await openResearch();
    assert.equal(await page.locator('[data-research-key]').count(), 12);
    assert(await page.getByRole('button', { name: '研究长刃武器', exact: true }).isDisabled());
    await click('研究锻造');
    await wait(() => window.voxel.snapshot().snapshot.research.current === 'Smithing');
    assert.equal((await save()).research.progress.Smithing, 0);
    assert.deepEqual(skillsOf(await save()), skillsOf(fresh));
    await shot('technology');
    await click('停止研究');
    await wait(() => window.voxel.snapshot().snapshot.research.current === null);
    check(
      'fresh industrial colony exposes twelve technologies, seven starting completions, native gates and selection without a bench',
    );

    const old = await load('tests/fixtures/voxel-v14-start.json');
    const provenance = JSON.parse(
      await readFile('tests/fixtures/voxel-v14-start.provenance.json', 'utf8'),
    );
    assert.equal(result.fixtures.at(-1).sha256, provenance.sha256);
    const migrated = await save();
    assert.equal(old.version, 14);
    assert.equal(migrated.version, 17);
    assert.equal(migrated.research.origin, 'legacy-unlocked');
    assert.deepEqual(migrated.research.progress, COSTS);
    assert.equal(migrated.research.current, null);
    assert.deepEqual(migrated.researchBenches, []);
    assert.deepEqual(migrated.blocks, old.blocks);
    assert.deepEqual(migrated.items, old.items);
    for (const [i, pawn] of migrated.pawns.entries()) {
      const original = old.pawns.find((p) => p.id === pawn.id);
      for (const key of OLD_SKILLS) assert.deepEqual(pawn.skills[key], original.skills[key]);
      assert.deepEqual(pawn.worn, original.worn);
      assert.deepEqual(pawn.weapon, original.weapon);
      assert.deepEqual(pawn.skills.intellectual, {
        level: [6, 8, 4][i],
        xp: 0,
        passion: [0, 1, 0][i],
        dailyXp: 0,
      });
    }
    check(
      'genuine v14 migration preserves existing seven skills, physical gear and terrain while adding Intellectual and retaining old unlocks',
      { sourceSha256: provenance.sha256 },
    );

    const built = await load(FIXTURES + '/bench-built.json');
    assert.equal(built.version, 17);
    assert.equal(built.research.origin, 'industrial-start');
    assert(
      built.researchBenches.some((b) => b.z !== built.spawn.z),
      'normal campaign includes an actual research bench on another layer',
    );
    const bench = built.researchBenches.find((b) => b.z !== built.spawn.z);
    await inspectBench(bench);
    const stand =
      bench.axis === 'x' ? { x: bench.x + 1, y: bench.y + 2 } : { x: bench.x - 1, y: bench.y + 1 };
    assert(
      (await page.getByTestId('research-bench').innerText()).includes(
        `操作位 ${stand.x}, ${stand.y}`,
      ),
    );
    await shot('bench');
    await click('简易科研台');
    const axis = (await state()).axis;
    await click('旋转建造朝向');
    assert.notEqual((await state()).axis, axis);
    await click('查看');
    await click('选择研究项目');
    assert(await page.getByTestId('research-panel').isVisible());
    check(
      'the physical three-by-two upper-floor research bench is inspectable and shares the global technology selector and rotation controls',
      { bench, stand },
    );

    const working = await load(FIXTURES + '/research-working.json');
    assert.equal(working.research.current, 'Smithing');
    const before = await save(),
      startPoints = before.research.progress.Smithing;
    assert(before.jobs.some((j) => j.kind === 'research' && j.progress > 0 && j.progress < j.work));
    await click('3倍速');
    await wait(
      (points) => window.voxel.snapshot().snapshot.research.progress.Smithing > points + 0.03,
      startPoints,
    );
    await click('暂停');
    const learned = await save();
    const learner = learned.pawns.find(
      (p) =>
        totalXP(p.skills.intellectual) >
        totalXP(before.pawns.find((b) => b.id === p.id).skills.intellectual),
    );
    assert(learner, 'actual research teaches Intellectual');
    await selectPawn(learner.id);
    assert.equal(await page.getByTestId('pawn-skills').locator('.voxel-skill').count(), 8);
    await page.locator('[data-skill="intellectual"]').scrollIntoViewIfNeeded();
    await shot('learning');
    await openResearch();
    assert.equal(
      Number(await page.getByLabel('当前研究进度', { exact: true }).getAttribute('value')),
      learned.research.progress.Smithing,
    );
    await page.waitForTimeout(1200);
    const frozen = await save();
    assert.equal(frozen.tick, learned.tick);
    assert.deepEqual(frozen.research, learned.research);
    assert.deepEqual(skillsOf(frozen), skillsOf(learned));
    check(
      'real upper-floor research advances both points and Intellectual, while pause freezes exact simulation state',
      {
        fromTick: before.tick,
        toTick: learned.tick,
        fromPoints: startPoints,
        toPoints: learned.research.progress.Smithing,
        learner: { id: learner.id, skill: learner.skills.intellectual },
      },
    );

    await closeResearch();
    await click('菜单与存档');
    await click('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    const stored = await save();
    await click('关闭菜单');
    await load('tests/fixtures/voxel-v14-start.json');
    await click('菜单与存档');
    await click('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await settle();
    const restored = await save();
    assert.equal(restored.tick, stored.tick);
    assert.deepEqual(restored.research, stored.research);
    assert.deepEqual(restored.researchBenches, stored.researchBenches);
    assert.deepEqual(skillsOf(restored), skillsOf(stored));
    check(
      'manual save/load restores actual research points, selected project, bench identities and all skills',
    );

    const partial = await load(FIXTURES + '/research-partial.json');
    const partialPoints = partial.research.progress.Smithing;
    assert(partialPoints > 0 && partialPoints < COSTS.Smithing);
    await openResearch();
    await click('研究蓄电池');
    await wait(() => window.voxel.snapshot().snapshot.research.current === 'Batteries');
    assert.equal((await save()).research.progress.Smithing, partialPoints);
    const batteryBefore = (await save()).research.progress.Batteries;
    await click('3倍速');
    await wait(
      (points) => window.voxel.snapshot().snapshot.research.progress.Batteries > points,
      batteryBefore,
    );
    await click('暂停');
    const batteryAfter = (await save()).research.progress.Batteries;
    await click('研究锻造');
    await wait(() => window.voxel.snapshot().snapshot.research.current === 'Smithing');
    assert.equal((await save()).research.progress.Smithing, partialPoints);
    assert.equal((await save()).research.progress.Batteries, batteryAfter);
    await click('停止研究');
    await wait(() => window.voxel.snapshot().snapshot.research.current === null);
    const stopped = await save();
    await click('3倍速');
    await wait((tick) => window.voxel.snapshot().snapshot.tick > tick + 20, stopped.tick);
    await click('暂停');
    assert.deepEqual((await save()).research, stopped.research);
    assert(!(await save()).jobs.some((j) => j.kind === 'research'));
    check(
      'switching projects preserves both accumulated progresses and stopping cancels research labor without deleting knowledge',
    );

    const complete = await load(FIXTURES + '/research-complete.json');
    assert.equal(complete.research.progress.Smithing, COSTS.Smithing);
    assert(await page.getByRole('button', { name: '燃料锻造台', exact: true }).isEnabled());
    await openResearch();
    assert(await page.getByRole('button', { name: '研究长刃武器', exact: true }).isEnabled());
    await page.locator('[data-research-key="Smithing"]').scrollIntoViewIfNeeded();
    await shot('unlocked');
    check('completed Smithing unlocks the actual construction tool and LongBlades prerequisite');

    const final = await load(FIXTURES + '/final.json');
    const smithy = final.weaponBenches.find((b) => b.kind === 'smithy');
    assert(smithy, 'normal campaign physically built the newly unlocked smithy');
    await selectPawn(
      final.pawns
        .filter((p) => p.faction === 'colony')
        .sort(
          (a, b) =>
            Math.abs(a.x - smithy.x) +
            Math.abs(a.y - smithy.y) -
            Math.abs(b.x - smithy.x) -
            Math.abs(b.y - smithy.y),
        )[0].id,
    );
    while ((await state()).level !== smithy.z)
      await click((await state()).level < smithy.z ? '上移一层' : '下移一层');
    await click('查看');
    await settle();
    const smithPoint = await page.evaluate(
      (b) =>
        window.voxel.project({
          x: b.x + (b.axis === 'x' ? 1 : 0),
          y: b.y + (b.axis === 'y' ? 1 : 0),
          z: b.z + 1.4,
        }),
      smithy,
    );
    await page.mouse.click(smithPoint.x, smithPoint.y);
    await page.getByTestId('weapon-bills').waitFor();
    await page.getByLabel('武器配方', { exact: true }).selectOption('steelLongsword');
    assert(await page.getByLabel('武器目标数量', { exact: true }).isDisabled());
    assert.match(await page.getByTestId('weapon-research-lock').innerText(), /长刃武器/);
    await page.getByTestId('weapon-research-lock').scrollIntoViewIfNeeded();
    await shot('longblade-lock');
    await page.getByLabel('武器配方', { exact: true }).selectOption('steelKnife');
    assert(await page.getByLabel('武器目标数量', { exact: true }).isEnabled());
    check(
      'the unlocked physical smithy keeps LongBlades recipe gated independently while steel knives remain available',
    );

    await page.setViewportSize({ width: 900, height: 700 });
    await openResearch();
    const card = page.locator('[data-research-key="LongBlades"]');
    await card.scrollIntoViewIfNeeded();
    const bounds = await card.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 900);
    await click('研究长刃武器');
    await wait(() => window.voxel.snapshot().snapshot.research.current === 'LongBlades');
    await shot('compact-research');
    await closeResearch();
    const pawn = await selectPawn(final.pawns.find((p) => p.faction === 'colony' && !p.dead).id);
    const priority = page.getByLabel(`${pawn.name} research优先级`, { exact: true });
    await priority.scrollIntoViewIfNeeded();
    assert.match(await priority.locator('..').innerText(), /智识/);
    const unchanged = intellectual(await save());
    await priority.selectOption('0');
    await wait(
      (id) =>
        window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).priorities.research === 0,
      pawn.id,
    );
    assert.deepEqual(intellectual(await save()), unchanged);
    await shot('compact-priority');
    check(
      '900 by 700 layout keeps technology selection and the Intellectual-linked research priority accessible without granting free XP',
    );
    await Promise.all(reads);
    assert(
      result.assets.length > 0 &&
        result.assets.every((a) => a.status === 200 && a.matchesLocalBuild),
    );
    assert.deepEqual(result.errors, []);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.errors.push(String(error.stack ?? error));
    await page.screenshot({ path: `${OUT}/${mode}-failure.png` });
    throw error;
  } finally {
    await context.close();
  }
}
try {
  await verify('worker');
  await verify('main');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
