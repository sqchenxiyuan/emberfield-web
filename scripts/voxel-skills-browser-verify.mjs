import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_SKILLS_BROWSER_OUT ?? 'test-results/voxel-skills-browser';
const FIXTURES = process.env.VOXEL_SKILLS_OUT ?? 'test-results/voxel-skills-campaign';
const KEYS = [
  'mining',
  'construction',
  'plants',
  'cooking',
  'crafting',
  'medicine',
  'melee',
  'intellectual',
];
const NAMES = ['采矿', '建造', '植物', '烹饪', '工艺', '医疗', '格斗', '智识'];
const PASSIONS = ['无热情', '有热情', '强烈热情'];
const QUALITIES = ['极差', '较差', '普通', '良好', '优秀', '大师', '传奇'];
const WEAPONS = { steelKnife: '钢匕首', steelLongsword: '钢长剑' };
const LEVELS = [
  [8, 6, 3, 4, 5, 3, 6, 6],
  [3, 3, 8, 6, 4, 8, 4, 8],
  [5, 7, 4, 3, 8, 4, 5, 4],
];
const START_PASSIONS = [
  [2, 1, 0, 0, 0, 0, 1, 0],
  [0, 0, 2, 1, 0, 1, 0, 1],
  [0, 1, 0, 0, 2, 0, 0, 0],
];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const skillsOf = (pawns) => pawns.map((p) => ({ id: p.id, skills: p.skills }));
const qualityItems = (s) =>
  [
    ...s.items.flatMap((i) => [i.weapon, i.apparel].filter(Boolean)),
    ...s.pawns.flatMap((p) =>
      [...p.worn, p.weapon, p.cargo?.weapon, p.cargo?.apparel].filter(Boolean),
    ),
  ].sort((a, b) => a.id - b.id);
function totalXP(record) {
  let total = record.xp;
  for (let level = 0; level < record.level; level++)
    total += level <= 9 ? 1000 * (level + 1) : 10000 + 2000 * (level - 9);
  return total;
}
await mkdir(OUT, { recursive: true });
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Production Chrome in both renderer modes. Genuine v13 file-chooser migration and normal-command v15 campaign fixtures. Visible DOM/canvas controls only for changes; window.voxel snapshot/project/exportSave are read-only observations. No injected skills, quality, resources, work, time or commands.',
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
    const file = `${OUT}/${mode}-${name}.png`;
    await page.locator('.voxel-toast').waitFor({ state: 'hidden', timeout: 8000 });
    await page.screenshot({ path: file });
    result.screenshots.push(file);
  };
  async function load(file) {
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
    assert(pawn, 'fixture pawn exists');
    await page
      .locator('.voxel-colonists button')
      .filter({ hasText: new RegExp('^' + pawn.name) })
      .click();
    await page.getByTestId('pawn-skills').waitFor();
    const panel = page.getByTestId('pawn-skills');
    if (!(await panel.getAttribute('open'))) {
      // HTML's present boolean open attribute may be an empty string.
      if (!(await panel.locator('.voxel-skill').first().isVisible()))
        await panel.locator('summary').click();
    }
    await settle();
    return pawn;
  }
  async function verifySkillPanel(pawn) {
    const panel = page.getByTestId('pawn-skills');
    assert.equal(await panel.locator('.voxel-skill').count(), 8);
    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[i],
        skill = pawn.skills[key],
        row = panel.locator(`[data-skill="${key}"]`);
      assert.match(
        await row.locator('.voxel-skill-heading b').innerText(),
        new RegExp(NAMES[i] + '\\s+' + skill.level),
      );
      assert.equal(
        await row.locator(`.passion-${skill.passion}`).innerText(),
        PASSIONS[skill.passion],
      );
      assert.equal(
        Number(await row.locator('progress').getAttribute('value')),
        Math.max(0, skill.xp),
      );
      const rate = [0.35, 1, 1.5][skill.passion] * (skill.dailyXp > 4000 ? 0.2 : 1);
      assert.match(await row.innerText(), new RegExp('学习 ' + Math.round(rate * 100) + '%'));
    }
    assert.match(await panel.innerText(), /切石不提供工艺经验/);
    assert.match(await panel.innerText(), /研究需要已选项目与科研台/);
  }
  async function inspectGround(item) {
    const pawns = (await state()).snapshot.pawns.filter((p) => p.faction === 'colony');
    const near = pawns.sort(
      (a, b) =>
        Math.abs(a.x - item.x) +
        Math.abs(a.y - item.y) -
        Math.abs(b.x - item.x) -
        Math.abs(b.y - item.y),
    )[0];
    if (near) await selectPawn(near.id); // Normal portrait click also moves the camera.
    while ((await state()).level !== item.z)
      await click((await state()).level < item.z ? '上移一层' : '下移一层');
    await click('查看');
    await settle();
    let q;
    for (let attempt = 0; attempt < 4; attempt++) {
      q = await page.evaluate((p) => window.voxel.project({ ...p, z: p.z + 0.13 }), item);
      if (q.x > 330 && q.x < 1250 && q.y > 100 && q.y < 625) break;
      await page.mouse.move(760, 400);
      await page.mouse.wheel(0, 300);
      await settle();
    }
    assert(
      q.x > 330 && q.x < 1250 && q.y > 100 && q.y < 625,
      JSON.stringify({ item, projection: q }),
    );
    await page.mouse.click(q.x, q.y);
    await page.getByTestId('weapon-actions').waitFor();
    await settle();
  }
  try {
    await page.goto(String(url));
    await wait(() => {
      const s = window.voxel?.snapshot();
      return s?.ready && s.snapshot !== null && s.metrics.backend === 'Three.js · WebGL2';
    });
    await click('暂停');
    await click('收起指引');
    await settle();
    assert.equal((await state()).worker, mode === 'worker');

    const old = await load('tests/fixtures/voxel-v13-start.json');
    const provenance = JSON.parse(
      await readFile('tests/fixtures/voxel-v13-start.provenance.json', 'utf8'),
    );
    assert.equal(result.fixtures.at(-1).sha256, provenance.sha256);
    assert.equal(old.version, 13);
    const migrated = await save();
    assert.equal(migrated.version, 15);
    assert.deepEqual(migrated.items, old.items);
    assert.deepEqual(migrated.blocks, old.blocks);
    assert.deepEqual(qualityItems(migrated), qualityItems(old));
    for (const [i, pawn] of migrated.pawns.filter((p) => p.faction === 'colony').entries()) {
      assert.deepEqual(
        KEYS.map((k) => pawn.skills[k].level),
        LEVELS[i],
      );
      assert.deepEqual(
        KEYS.map((k) => pawn.skills[k].passion),
        START_PASSIONS[i],
      );
      assert(KEYS.every((k) => pawn.skills[k].xp === 0 && pawn.skills[k].dailyXp === 0));
      await selectPawn(pawn.id);
      await verifySkillPanel(pawn);
    }
    check(
      'genuine v13 imports into v15 with unchanged gear quality and fixed zero-XP starter skill profiles',
      { sourceSha256: provenance.sha256 },
    );
    const colonist = migrated.pawns[0];
    await selectPawn(colonist.id);
    await page.getByTestId('pawn-skills').locator('[data-skill="mining"]').scrollIntoViewIfNeeded();
    await shot('starter-skills');
    const mapping = {
      care: ['medicine', '医疗'],
      dig: ['mining', '采矿'],
      cut: ['plants', '植物'],
      build: ['construction', '建造'],
      grow: ['plants', '植物'],
      cook: ['cooking', '烹饪'],
      craft: ['crafting', '工艺'],
      research: ['intellectual', '智识'],
    };
    for (const [work, [key, name]] of Object.entries(mapping)) {
      const select = page.getByLabel(`${colonist.name} ${work}优先级`, { exact: true });
      assert.match(
        await select.locator('..').locator('.voxel-work-skill').innerText(),
        new RegExp(name + ' ' + colonist.skills[key].level),
      );
    }
    assert.match(
      await page
        .getByLabel(`${colonist.name} haul优先级`, { exact: true })
        .locator('..')
        .innerText(),
      /无需技能/,
    );
    const priority = page.getByLabel(`${colonist.name} craft优先级`, { exact: true });
    const changed = colonist.priorities.craft === 2 ? 3 : 2;
    await priority.selectOption(String(changed));
    await wait(
      ({ id, changed }) =>
        window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).priorities.craft ===
        changed,
      { id: colonist.id, changed },
    );
    assert.deepEqual(skillsOf((await state()).snapshot.pawns), skillsOf(migrated.pawns));
    check(
      'all work priorities show their actual associated skill and changing priority does not grant XP',
    );

    const training = await load(FIXTURES + '/training.json');
    assert.equal(training.version, 15);
    assert(
      training.jobs.some(
        (j) =>
          ['smith', 'tailoring'].includes(j.kind) &&
          !j.cancelled &&
          j.progress > 0 &&
          j.progress < j.work,
      ),
      'normal campaign provides actual in-progress crafting',
    );
    const baseline = (await state()).snapshot;
    const before = baseline.pawns
      .filter((p) => p.faction === 'colony')
      .map((p) => ({ id: p.id, xp: totalXP(p.skills.crafting) }));
    const savedWorker =
      training.pawns.find((p) =>
        training.jobs.some((j) => ['smith', 'tailoring'].includes(j.kind) && j.id === p.jobId),
      ) ?? training.pawns[2];
    await selectPawn(savedWorker.id);
    await click('3倍速');
    await wait((before) => {
      const snap = window.voxel.snapshot().snapshot;
      return before.some(({ id, xp }) => {
        const record = snap.pawns.find((p) => p.id === id).skills.crafting;
        let total = record.xp;
        for (let level = 0; level < record.level; level++)
          total += level <= 9 ? 1000 * (level + 1) : 10000 + 2000 * (level - 9);
        return total > xp + 0.5;
      });
    }, before);
    await click('暂停');
    const after = (await state()).snapshot;
    assert(after.tick > baseline.tick);
    const gained = after.pawns.filter((p) =>
      before.some((b) => b.id === p.id && totalXP(p.skills.crafting) > b.xp + 0.5),
    );
    assert(gained.length > 0);
    await selectPawn(gained[0].id);
    await verifySkillPanel(gained[0]);
    await page
      .getByTestId('pawn-skills')
      .locator('[data-skill="crafting"]')
      .scrollIntoViewIfNeeded();
    await shot('learning');
    const frozen = await save();
    await page.waitForTimeout(1200);
    const still = await save();
    assert.equal(still.tick, frozen.tick);
    assert.deepEqual(skillsOf(still.pawns), skillsOf(frozen.pawns));
    check(
      'real ongoing crafting gains XP through the speed control and pause freezes the complete skill state',
      {
        fromTick: baseline.tick,
        toTick: after.tick,
        gains: gained.map((p) => ({ id: p.id, skill: p.skills.crafting })),
      },
    );

    await click('菜单与存档');
    await click('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor();
    const stored = await save();
    await click('关闭菜单');
    await load('tests/fixtures/voxel-v13-start.json');
    assert((await state()).snapshot.pawns.every((p) => KEYS.every((k) => p.skills[k].xp === 0)));
    await click('菜单与存档');
    await click('读取营地');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await settle();
    const restored = await save();
    assert.equal(restored.tick, stored.tick);
    assert.deepEqual(skillsOf(restored.pawns), skillsOf(stored.pawns));
    assert.deepEqual(qualityItems(restored), qualityItems(stored));
    check(
      'manual save/load restores earned experience, passion, daily learning and existing gear exactly',
    );

    const final = await load(FIXTURES + '/final.json');
    assert.equal(final.version, 15);
    assert(
      final.pawns.some((p) => KEYS.some((k) => p.skills[k].xp !== 0 || p.skills[k].dailyXp !== 0)),
    );
    const physical = (await state()).snapshot;
    const ground = physical.items.find((i) => WEAPONS[i.weapon?.kind]);
    const holder = physical.pawns.find((p) => WEAPONS[p.weapon?.kind]);
    const carrier = physical.pawns.find(
      (p) => p.faction === 'colony' && WEAPONS[p.cargo?.weapon?.kind],
    );
    let weapon;
    if (ground) {
      weapon = ground.weapon;
      await inspectGround(ground);
    } else {
      assert(holder || carrier, 'final campaign contains an actual inspectable steel weapon');
      weapon = holder?.weapon ?? carrier.cargo.weapon;
      await selectPawn((holder ?? carrier).id);
      if (!holder) {
        await click('装备携带的武器');
        await click('3倍速');
        await wait(
          ({ pawnId, weaponId }) =>
            window.voxel.snapshot().snapshot.pawns.find((p) => p.id === pawnId).weapon?.id ===
            weaponId,
          { pawnId: carrier.id, weaponId: weapon.id },
        );
        await click('暂停');
        await selectPawn(carrier.id);
      }
      await page.getByTestId('pawn-weapon').scrollIntoViewIfNeeded();
    }
    const details = ground
      ? page.getByTestId('weapon-actions').getByTestId('weapon-detail')
      : page.getByTestId('pawn-weapon').getByTestId('weapon-detail');
    const text = await details.innerText();
    assert(text.includes(WEAPONS[weapon.kind]));
    assert(text.includes(QUALITIES[weapon.quality]));
    assert.match(text, new RegExp('耐久 ' + weapon.hitPoints + ' /'));
    await details.scrollIntoViewIfNeeded();
    await shot('crafted-quality');
    check(
      'the real campaign weapon inspector displays its persisted quality and durability without assuming a fixed roll',
      { weapon },
    );

    const selected = final.pawns.find((p) => p.faction === 'colony' && !p.dead);
    await page.setViewportSize({ width: 900, height: 700 });
    await selectPawn(selected.id);
    await verifySkillPanel((await state()).snapshot.pawns.find((p) => p.id === selected.id));
    const compactRow = page.getByTestId('pawn-skills').locator('[data-skill="crafting"]');
    await compactRow.scrollIntoViewIfNeeded();
    assert(await compactRow.isVisible());
    const rowBounds = await compactRow.boundingBox();
    assert(rowBounds && rowBounds.x >= 0 && rowBounds.x + rowBounds.width <= 900);
    await shot('compact-skills');
    const compactPriority = page.getByLabel(`${selected.name} craft优先级`, { exact: true });
    await compactPriority.scrollIntoViewIfNeeded();
    const current = Number(await compactPriority.inputValue()),
      next = current === 1 ? 2 : 1;
    await compactPriority.selectOption(String(next));
    await wait(
      ({ id, next }) =>
        window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).priorities.craft === next,
      { id: selected.id, next },
    );
    await shot('compact-priorities');
    check('900 by 700 layout keeps skill rows and actual priority controls reachable');
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
