import { withMedicineLedgers } from './voxel-migration-expectations.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE =
  process.env.VOXEL_RANGED_URL ??
  process.env.VOXEL_TEST_URL ??
  'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_RANGED_BROWSER_OUT ?? 'test-results/voxel-ranged-browser';
const FIXTURES = process.env.VOXEL_RANGED_OUT ?? 'test-results/voxel-ranged-campaign';
const modes = process.env.VOXEL_RANGED_BROWSER_MODE
  ? [process.env.VOXEL_RANGED_BROWSER_MODE]
  : ['worker', 'main'];
assert(modes.every((mode) => mode === 'worker' || mode === 'main'));
await mkdir(OUT, { recursive: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const campaign = JSON.parse(await readFile(`${FIXTURES}/report.json`, 'utf8'));
assert.equal(
  campaign.status,
  'passed',
  'normal ranged campaign must finish before browser verification',
);
const LEGACY = 'tests/fixtures/voxel-v17-armor-combat.json';
const LEGACY_PROVENANCE = 'tests/fixtures/voxel-v17-armor-combat.provenance.json';
const legacyProvenance = JSON.parse(await readFile(LEGACY_PROVENANCE, 'utf8'));
const legacyBytes = await readFile(LEGACY);
const legacySave = JSON.parse(legacyBytes);
assert.equal(legacyProvenance.loadedByOriginalSource, true);
assert.equal(legacyProvenance.version, 17);
assert.equal(legacySave.version, 17, 'migration input must be an original v17 save');
assert.equal(legacySave.tick, legacyProvenance.tick);
assert.equal(
  sha(legacyBytes),
  legacyProvenance.sha256,
  'legacy save must retain its original bytes',
);
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Headless Chrome with Worker and main renderers. Normal campaign files are imported through the visible file chooser; controls and canvas clicks are the only mutations. snapshot, project and exportSave are read-only. Production asset bytes must match local dist. No browser simulation or scene injection.',
  campaign: { file: `${FIXTURES}/report.json`, finalTick: campaign.finalTick },
  legacy: {
    file: LEGACY,
    provenanceFile: LEGACY_PROVENANCE,
    sha256: legacyProvenance.sha256,
    version: legacySave.version,
    tick: legacySave.tick,
    publishedCommit: legacyProvenance.publishedCommit,
    loadedByOriginalSource: legacyProvenance.loadedByOriginalSource,
  },
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
            sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) ===
            asset.sha256;
        })
        .catch((error) => {
          asset.error = String(error);
        }),
    );
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const save = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const click = async (name) => {
    const target = button(name);
    await target.scrollIntoViewIfNeeded();
    await target.click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    if (/^[123]倍速$/.test(name))
      await wait((speed) => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
  };
  const settle = async () => {
    await page.waitForTimeout(400);
    await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0);
  };
  const check = (name, details = {}) => {
    result.checks.push({ name, ...details });
    console.log('PASS', mode, name);
  };
  const shot = async (name, options = {}) => {
    const file = `${OUT}/${mode}-${name}.png`,
      bytes = await page.screenshot({ path: file, ...options });
    result.screenshots.push({ file, sha256: sha(bytes) });
    return bytes;
  };
  async function loadFile(file, expectedHash) {
    const bytes = await readFile(file),
      data = JSON.parse(bytes);
    if (expectedHash)
      assert.equal(sha(bytes), expectedHash, 'fixture bytes must match their retained SHA256');
    result.fixtures.push({ file, sha256: sha(bytes), tick: data.tick, version: data.version });
    if (!(await page.getByRole('dialog').isVisible())) await click('菜单与存档');
    const chooser = page.waitForEvent('filechooser');
    await click('导入体素存档');
    await (await chooser).setFiles(file);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait((tick) => window.voxel.snapshot().snapshot.tick === tick, data.tick);
    await settle();
    return data;
  }
  async function load(name) {
    assert(campaign.fixtures[name], `missing ordinary campaign fixture ${name}`);
    return loadFile(`${FIXTURES}/${name}.json`, campaign.fixtures[name].sha256);
  }
  async function viewLevel(z) {
    for (let n = 0; n < 16 && (await state()).level !== z; n++)
      await click((await state()).level < z ? '上移一层' : '下移一层');
    assert.equal((await state()).level, z);
    await settle();
  }
  async function selectPawn(id) {
    const pawn = (await state()).snapshot.pawns.find((p) => p.id === id);
    assert(pawn);
    const list =
      pawn.faction === 'colony'
        ? page.locator('.voxel-colonists')
        : page.getByTestId('raid-status');
    const target = list.getByRole('button').filter({ hasText: pawn.name });
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await page.getByTestId('pawn-health').waitFor();
    await settle();
    return pawn;
  }
  async function inspect(p, height = 0.1) {
    if (await button('清除选择').isVisible()) await click('清除选择');
    await viewLevel(p.z);
    await click('查看');
    const project = () =>
      page.evaluate(({ p, height }) => window.voxel.project({ ...p, z: p.z + height }), {
        p,
        height,
      });
    let q = await project();
    for (const [axis, low, high, forward, back] of [
      ['y', 180, 520, 's', 'w'],
      ['x', 400, 1120, 'd', 'a'],
    ]) {
      for (let i = 0; i < 32 && (q[axis] < low || q[axis] > high); i++) {
        const middle = (low + high) / 2,
          previous = Math.abs(q[axis] - middle);
        const key = q[axis] > high ? forward : back,
          opposite = key === forward ? back : forward;
        await page.keyboard.press(key);
        await page.waitForTimeout(80);
        q = await project();
        if (Math.abs(q[axis] - middle) > previous) {
          await page.keyboard.press(opposite);
          await page.keyboard.press(opposite);
          await page.waitForTimeout(80);
          q = await project();
        }
      }
    }
    assert(q.x > 320 && q.x < 1260 && q.y > 90 && q.y < 635, JSON.stringify({ p, q }));
    await page.mouse.click(q.x, q.y);
    await settle();
  }
  const benchCenter = (bench) => ({
    x: bench.x + (bench.axis === 'x' ? 1 : 0),
    y: bench.y + (bench.axis === 'y' ? 1 : 0),
    z: bench.z,
  });
  async function advance(ticks, speed = 3) {
    const start = (await state()).snapshot.tick;
    await click(`${speed}倍速`);
    await wait((tick) => window.voxel.snapshot().snapshot.tick >= tick, start + ticks);
    await click('暂停');
  }
  try {
    await page.goto(String(url));
    await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot !== null);
    await click('暂停');
    if (await button('收起指引').isVisible()) await click('收起指引');
    await settle();
    assert.equal((await state()).worker, mode === 'worker');

    const old = await loadFile(LEGACY, legacyProvenance.sha256);
    assert.equal(old.version, 17);
    const migrated = await save();
    assert.equal(migrated.version, 21);
    for (const field of ['blocks', 'items', 'stats', 'tick'])
      assert.deepEqual(migrated[field], field === 'stats' ? withMedicineLedgers(old.stats) : old[field]);
    for (const [profile, pawn] of old.pawns.entries()) {
      const after = migrated.pawns.find((p) => p.id === pawn.id);
      for (const field of ['x', 'y', 'z', 'worn', 'weapon', 'cargo', 'trauma', 'health'])
        assert.deepEqual(after[field], pawn[field]);
      for (const skill of Object.keys(pawn.skills))
        assert.deepEqual(after.skills[skill], pawn.skills[skill]);
      assert.equal(
        after.skills.shooting.level,
        pawn.faction === 'raider' ? 5 : [6, 4, 8][profile % 3],
      );
      assert.equal(after.skills.shooting.xp, 0);
      assert.equal(after.skills.shooting.dailyXp, 0);
      assert.equal(after.shooting, null);
    }
    assert.deepEqual(migrated.projectiles, []);
    assert.deepEqual(migrated.sandbags, []);
    assert(await button('机械加工台').isDisabled());
    const armored = old.pawns.find(
      (p) => p.faction === 'colony' && p.worn.some((piece) => piece.kind === 'plateArmor'),
    );
    assert(armored, 'retained v17 combat save must include a normally equipped armored colonist');
    await selectPawn(armored.id);
    const clothing = page.getByTestId('pawn-apparel');
    assert.equal(await clothing.locator('.voxel-worn-piece').count(), armored.worn.length);
    for (const piece of armored.worn) {
      assert.equal(
        await clothing.locator(`[data-apparel-id="${piece.id}"]`).count(),
        1,
        `legacy apparel ${piece.id} remains inspectable`,
      );
    }
    const plate = clothing.locator('.voxel-worn-piece').filter({ hasText: '板甲' });
    await plate.scrollIntoViewIfNeeded();
    assert(await plate.isVisible());
    await shot('v17-armored-migration');
    check(
      'genuine v17 colony migrates without changing physical items or anatomy; firearm technology remains locked',
      {
        sourceSha256: legacyProvenance.sha256,
        publishedCommit: legacyProvenance.publishedCommit,
        armoredPawnId: armored.id,
        apparelIds: armored.worn.map((piece) => piece.id),
      },
    );

    await load('machining-working');
    let snapshot = (await state()).snapshot;
    const bench = snapshot.weaponBenches.find((b) => b.kind === 'machining');
    assert(bench);
    await inspect(benchCenter(bench), 1.1);
    assert.match(await page.getByTestId('machining-power').innerText(), /350 W/);
    assert.match(await page.getByTestId('weapon-bills').innerText(), /30 钢材[\s\S]*2 零件/);
    await page.getByLabel('武器配方', { exact: true }).selectOption('machinePistol');
    assert.match(await page.getByTestId('weapon-bills').innerText(), /45 钢材[\s\S]*3 零件/);
    await page.getByLabel('武器目标数量', { exact: true }).selectOption('2');
    await wait(
      (id) =>
        window.voxel
          .snapshot()
          .snapshot.weaponBenches.find((b) => b.id === id)
          .bills.find((b) => b.kind === 'machinePistol').target === 2,
      bench.id,
    );
    check('real machining bench exposes researched firearm recipes and editable bills');
    const active = snapshot.jobs.find((j) => j.weaponKind === 'revolver' && j.progress > 0);
    assert(active);
    await click('关闭机械台电源');
    await advance(100);
    snapshot = (await state()).snapshot;
    const stopped = snapshot.jobs.find((j) => j.id === active.id);
    assert(stopped);
    assert.equal(stopped.progress, active.progress);
    assert.deepEqual(stopped.delivered, active.delivered);
    assert.equal(snapshot.weaponBenches.find((b) => b.id === bench.id).power.on, false);
    await shot('machining-off');
    await click('打开机械台电源');
    await click('3倍速');
    await wait(
      ({ id, progress }) =>
        window.voxel.snapshot().snapshot.jobs.some((j) => j.id === id && j.progress > progress),
      { id: active.id, progress: active.progress },
    );
    snapshot = (await state()).snapshot;
    const running = snapshot.jobs.find((j) => j.id === active.id),
      worker = snapshot.pawns.find((p) => p.id === running.owner);
    assert(worker && worker.phase === 'work');
    const q = await page.evaluate(
      (p) => window.voxel.project({ ...p, z: p.z + 1.05 }),
      benchCenter(bench),
    );
    const clip = { x: Math.round(q.x - 60), y: Math.round(q.y - 45), width: 120, height: 90 };
    assert(clip.x > 320 && clip.y > 90 && clip.x + clip.width < 1280 && clip.y + clip.height < 635);
    const frames = [];
    for (let n = 0; n < 2; n++) {
      await page.waitForTimeout(170);
      frames.push(sha(await shot(`machining-motion-${n}`, { clip })));
    }
    assert.notEqual(frames[0], frames[1], 'actual powered machine work pixels animate');
    result.machineMotion = { clip, frames, pawnId: worker.id };
    await click('暂停');
    await shot('machining-working');
    check(
      'visible power switch pauses delivered work exactly and resumes actual machine animation',
    );
    const powerOff = await load('machining-power-off');
    assert.deepEqual(
      (await save()).jobs.find((j) => j.id === active.id)?.delivered,
      powerOff.jobs.find((j) => j.id === active.id)?.delivered,
    );
    await inspect(benchCenter(bench), 1.1);
    assert(await button('打开机械台电源').isVisible());
    check('a normal saved unpowered job remains off after file import');

    await load('equipped');
    const equipped = (await state()).snapshot;
    const names = { shortBow: '短弓', revolver: '左轮手枪', machinePistol: '冲锋手枪' };
    for (const kind of Object.keys(names)) {
      const pawn = equipped.pawns.find((p) => p.faction === 'colony' && p.weapon?.kind === kind);
      assert(pawn);
      await selectPawn(pawn.id);
      if (!pawn.drafted) await click('征召');
      const panel = page.getByTestId('ranged-weapon-detail');
      await panel.scrollIntoViewIfNeeded();
      assert.match(await page.getByTestId('pawn-weapon').innerText(), new RegExp(names[kind]));
      assert.match(await panel.innerText(), kind === 'machinePistol' ? /3 发连射/ : /单发/);
      assert.match(await panel.innerText(), /每发伤害[\s\S]*穿透[\s\S]*瞄准[\s\S]*武器精度/);
      await shot(`equipped-${kind}`);
    }
    await page.getByTitle('向右旋转 E', { exact: true }).click();
    await settle();
    await shot('rotated-weapons');
    check(
      'all three normally crafted ranged weapons expose stats and visible held models after drafting and rotation',
    );
    await inspect(equipped.sandbags[0], 0.55);
    assert.match(await page.getByTestId('sandbag-detail').innerText(), /300[\s\S]*55%/);
    await shot('sandbags');
    check(
      'ordinary cloth sandbags can be selected on the canvas with durability and cover explanation',
    );

    const aiming = await load('aiming'),
      shooter = aiming.pawns.find((p) => p.faction === 'colony' && p.shooting);
    assert(shooter);
    await selectPawn(shooter.id);
    await page.getByTestId('shot-report').scrollIntoViewIfNeeded();
    const factors = await page.getByTestId('shot-report').innerText();
    for (const label of ['射手', '武器精度', '天气', '目标体型', '姿态', '掩体', '高差'])
      assert(factors.includes(label), label);
    assert(await page.getByTestId('shooting-status').count());
    assert.equal(
      await page.getByLabel('射击目标', { exact: true }).inputValue(),
      String(shooter.shooting.targetId),
    );
    await shot('aiming-report');
    await page.getByTestId('shooting-status').scrollIntoViewIfNeeded();
    await shot('aiming-status');
    check('real timed aiming shows its target, progress and separate hit factors');

    const flight = await load('flight');
    assert(flight.projectiles.length > 0);
    assert.deepEqual((await save()).projectiles, flight.projectiles);
    const first = flight.projectiles[0];
    await selectPawn(first.shooterId);
    await viewLevel(Math.max(Math.floor(first.from.z), Math.floor(first.destination.z)));
    await shot('launch-paused');
    const exported = await save(),
      file = `${OUT}/${mode}-inflight-save.json`;
    await writeFile(file, JSON.stringify(exported) + '\n');
    await loadFile(file);
    const reloaded = await save();
    assert.deepEqual(reloaded.projectiles, exported.projectiles);
    assert.deepEqual(
      reloaded.pawns.map((p) => [p.id, p.shooting, p.nextAttackTick]),
      exported.pawns.map((p) => [p.id, p.shooting, p.nextAttackTick]),
    );
    if (first.impactTick - flight.tick >= 8) {
      await selectPawn(first.shooterId);
      await viewLevel(Math.max(Math.floor(first.from.z), Math.floor(first.destination.z)));
      await click('1倍速');
      await wait((tick) => window.voxel.snapshot().snapshot.tick >= tick, flight.tick + 2);
      await click('暂停');
      const middle = (await state()).snapshot;
      assert(
        middle.projectiles.some((p) => p.id === first.id),
        'capture a genuinely in-flight shot before its impact',
      );
      result.inFlightCapture = {
        tick: middle.tick,
        projectileId: first.id,
        impactTick: first.impactTick,
      };
      await shot('inflight-moving');
    }
    await click('1倍速');
    await wait(
      ({ ids, tick }) => {
        const s = window.voxel.snapshot().snapshot;
        return s.tick > tick && ids.every((id) => !s.projectiles.some((p) => p.id === id));
      },
      {
        ids: flight.projectiles.map((p) => p.id),
        tick: Math.max(...flight.projectiles.map((p) => p.impactTick)),
      },
    );
    await click('暂停');
    assert(
      (await state()).snapshot.combatEvents.some((e) => e.tick > flight.tick && e.kind !== 'fire'),
    );
    await shot('flight-resolved');
    check(
      'in-flight projectiles survive a visible export/import and resolve only after resumed simulation ticks',
      {
        flight: flight.projectiles.map((p) => ({
          id: p.id,
          from: p.from,
          destination: p.destination,
          launchedTick: p.launchedTick,
          impactTick: p.impactTick,
        })),
      },
    );

    const impact = await load('impact'),
      hit = [...impact.combatEvents]
        .reverse()
        .find((e) => e.kind === 'hit' || e.kind === 'deflect');
    assert(hit);
    await selectPawn(hit.shooterId);
    await page.getByTestId('combat-events').scrollIntoViewIfNeeded();
    assert((await page.getByTestId('combat-events').innerText()).includes(hit.message));
    await shot('impact-feedback');
    check('actual campaign hit or armor deflection appears in the combat event panel', {
      event: hit,
    });
    const enemyFlight = await load('enemy-flight'),
      enemy = enemyFlight.pawns.find((p) => p.id === campaign.rangedEnemyId);
    assert(enemy);
    assert.equal(enemy.weapon.kind, 'shortBow');
    assert(enemyFlight.combatEvents.some((e) => e.shooterId === enemy.id && e.kind === 'fire'));
    await selectPawn(enemy.id);
    await page.getByTestId('ranged-weapon-detail').scrollIntoViewIfNeeded();
    await shot('ranged-opponent');
    check('a normally scheduled bow-armed opponent renders and exposes its actual weapon');
    const combat = await load('ranged-combat');
    assert(
      combat.combatEvents.some((e) => e.shooterId === campaign.rangedEnemyId && e.kind !== 'fire'),
    );
    await shot('ranged-combat');

    await load('aiming');
    await selectPawn(shooter.id);
    await page.setViewportSize({ width: 900, height: 700 });
    await settle();
    const targetSelect = page.getByLabel('射击目标', { exact: true });
    await targetSelect.scrollIntoViewIfNeeded();
    const box = await targetSelect.boundingBox();
    assert(
      box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 900 && box.y + box.height <= 700,
    );
    assert(
      await targetSelect.evaluate((el) => {
        const b = el.getBoundingClientRect(),
          hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return hit === el || el.contains(hit);
      }),
    );
    await targetSelect.selectOption(String(shooter.shooting.targetId));
    await click('射击目标');
    await wait(
      ({ id, target }) =>
        window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).attackTargetId === target,
      { id: shooter.id, target: shooter.shooting.targetId },
    );
    await page.getByTestId('shot-report').scrollIntoViewIfNeeded();
    await shot('compact');
    check('target controls and shot explanation remain accessible and actionable at 900 by 700');
    await page.setViewportSize({ width: 1280, height: 800 });
    const final = await load('final'),
      restored = await save();
    for (const field of ['projectiles', 'combatEvents', 'sandbags'])
      assert.deepEqual(restored[field], final[field]);
    for (const pawn of final.pawns) {
      const p = restored.pawns.find((v) => v.id === pawn.id);
      for (const field of ['weapon', 'trauma', 'shooting', 'staggerUntil'])
        assert.deepEqual(p[field], pawn[field]);
      assert.deepEqual(p.skills.shooting, pawn.skills.shooting);
    }
    check(
      'final ordinary campaign reload preserves weapons, injuries, shooting skills, stagger and flight state',
    );
    await Promise.all(reads);
    assert(
      result.assets.length > 0 &&
        result.assets.every((a) => a.status === 200 && a.matchesLocalBuild),
      'served production assets must match local dist bytes',
    );
    assert.deepEqual(result.errors, []);
    result.metrics = (await state()).metrics;
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.errors.push(String(error?.stack ?? error));
    await page.screenshot({ path: `${OUT}/${mode}-failure.png` });
    throw error;
  } finally {
    await context.close();
  }
}
try {
  for (const mode of modes) await verify(mode);
} catch (error) {
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
