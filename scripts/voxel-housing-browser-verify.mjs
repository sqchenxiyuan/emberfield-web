import { importLegacyStart, LEGACY_START } from './voxel-legacy-start.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5182/?world=voxel';
const OUT = process.env.VOXEL_HOUSING_BROWSER_OUT ?? 'test-results/voxel-housing-browser';
const SLEEP_SAVE = process.env.VOXEL_HOUSING_SLEEP_SAVE ?? 'test-results/voxel-housing-campaign/sleeping-save.json';
const BUILT_SAVE = process.env.VOXEL_HOUSING_BUILT_SAVE ?? 'test-results/voxel-housing-campaign/housing-built.json';
const UI_ONLY = process.argv.includes('--ui-only');
const FIXTURES_ONLY = process.argv.includes('--fixtures-only');
const MODES = process.env.VOXEL_HOUSING_MODES?.split(',') ?? ['worker', 'main'];
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const pos = (x, y, z = 8) => ({ x, y, z });
await mkdir(OUT, { recursive: true });
const report = {
  baseline: LEGACY_START,
  base: BASE, startedAt: new Date().toISOString(), modes: [],
  scope: 'Real DOM controls, canvas mouse clicks, keyboard rotation and file chooser imports in Chrome. window.voxel is used only for projection, snapshots and save export. Beds and doors in the UI checks are built by normal colonist work from a fresh world. Sleeping fixtures come from the separate normal-command housing campaign; no pawn/terrain/need/tick injection. Both render Worker and main-thread fallback are checked at 1280x800 and 900x700.',
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function verifyMode(mode) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const url = new URL(BASE); if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
  const result = { mode, url: String(url), checks: [], screenshots: [], errors: [], assets: [], workers: [] };
  report.modes.push(result);
  const assetReads = [];
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
  page.on('worker', worker => result.workers.push(worker.url()));
  page.on('response', response => {
    const assetUrl = response.url();
    if (!/\.(?:js|css|tsx?|mjs)(?:\?|$)/.test(assetUrl) || result.assets.some(a => a.url === assetUrl)) return;
    const asset = { url: assetUrl, status: response.status() }; result.assets.push(asset);
    assetReads.push(response.body().then(async body => {
      asset.sha256 = digest(body); asset.bytes = body.length;
      if (new URL(assetUrl).pathname.includes('/assets/')) {
        asset.localFile = path.join('dist', 'assets', path.basename(new URL(assetUrl).pathname));
        asset.localSha256 = digest(await readFile(asset.localFile)); asset.matchesLocalBuild = asset.sha256 === asset.localSha256;
      }
    }).catch(error => { asset.error = String(error); }));
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const wait = (fn, arg, timeout = 35000) => page.waitForFunction(fn, arg, { timeout });
  const point = p => page.evaluate(p => window.voxel.project(p), p);
  const record = (name, details = {}) => { result.checks.push({ name, ...details }); console.log('PASS', mode, name, JSON.stringify(details)); };
  const screenshot = async name => { const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file); };
  async function control(name) { const button = page.getByRole('button', { name, exact: true }); await button.scrollIntoViewIfNeeded(); await button.click(); }
  async function pause() { await control('暂停'); await wait(() => window.voxel.snapshot().snapshot.speed === 0); }
  async function run() { await control('3倍速'); await wait(() => window.voxel.snapshot().snapshot.speed === 3); }
  async function click(p) { const q = await point(p); await page.mouse.click(q.x, q.y); }
  async function designate(tool, p) { await control(tool); await click(p); await page.waitForTimeout(100); }
  async function inspect(p, anchor = { ...p, z: Math.floor(p.z) }) {
    await control('查看'); await click(p);
    const expected = Array.isArray(anchor) ? anchor : [anchor];
    await wait(cells => { const a = window.voxel.snapshot().selected; return cells.some(p => a?.x === p.x && a?.y === p.y && a?.z === p.z); }, expected);
  }
  async function reachable(locator, name) {
    await locator.scrollIntoViewIfNeeded();
    const details = await locator.evaluate(el => {
      const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, top = document.elementFromPoint(x, y);
      return { x, y, width: r.width, height: r.height, viewport: [innerWidth, innerHeight], hit: top === el || el.contains(top) };
    });
    assert.ok(details.hit && details.x >= 0 && details.y >= 0 && details.x < details.viewport[0] && details.y < details.viewport[1], `${name} unreachable: ${JSON.stringify(details)}`);
    return { name, ...details };
  }
  async function chooseOwner(bed, owner) {
    await inspect({ ...bed, z: bed.z + 0.5 });
    await page.getByLabel('床位主人', { exact: true }).selectOption(owner === null ? '' : String(owner));
    await wait(({ id, owner }) => window.voxel.snapshot().snapshot.beds.find(b => b.id === id)?.owner === owner, { id: bed.id, owner });
  }
  async function chooseDoor(door, value) {
    const snapshot = (await state()).snapshot, current = snapshot.doors.find(d => d.id === door.id);
    const open = current.mode === 'open' || (current.mode === 'auto' && snapshot.tick <= current.openUntil);
    const target = { x: door.x + (open ? door.axis === 'x' ? -0.31 : 0.31 : 0), y: door.y + (open ? door.axis === 'x' ? 0.31 : -0.31 : 0), z: door.z + 1.25 };
    await inspect(target, pos(door.x, door.y, door.z));
    await page.getByLabel('门状态', { exact: true }).selectOption(value);
    await wait(({ id, value }) => window.voxel.snapshot().snapshot.doors.find(d => d.id === id)?.mode === value, { id: door.id, value });
  }
  async function openPawn(pawn) {
    await page.locator('.voxel-colonists button').filter({ hasText: pawn.name }).click();
    const details = page.locator('.voxel-schedule');
    if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  }
  async function importSave(file, tick) {
    await control('菜单与存档'); const chooser = page.waitForEvent('filechooser');
    await control('导入体素存档'); await (await chooser).setFiles(path.resolve(file));
    await wait(tick => window.voxel.snapshot().snapshot.tick === tick && window.voxel.snapshot().snapshot.speed === 0, tick);
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.waitForTimeout(350);
  }
  async function pixelDifference(a, b) {
    return page.evaluate(async buffers => {
      const images = await Promise.all(buffers.map(base64 => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.src = 'data:image/png;base64,' + base64; })));
      const pixels = images.map(img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, c.width, c.height).data; });
      let changed = 0, overTwo = 0, maxDelta = 0;
      for (let i = 0; i < pixels[0].length; i += 4) { let delta = 0; for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(pixels[0][i+c] - pixels[1][i+c])); if (delta) changed++; if (delta > 2) overTwo++; maxDelta = Math.max(maxDelta, delta); }
      return { changed, overTwo, maxDelta };
    }, [a.toString('base64'), b.toString('base64')]);
  }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().metrics.pendingChunks === 0);
    await importLegacyStart(page);
    await pause(); await control('收起指引');
    assert.equal((await state()).worker, mode === 'worker');
    record('expected renderer backend active', { worker: (await state()).worker, metrics: (await state()).metrics });
    if (!FIXTURES_ONLY) {
    await designate('伐木', pos(27, 29)); await run();
    await wait(() => window.voxel.snapshot().snapshot.stats.cut >= 1 && window.voxel.snapshot().snapshot.stored.wood >= 115); await pause();
    await designate('床', pos(29, 28));
    await wait(() => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'bed' && j.axis === 'x' && j.x === 29 && j.y === 28));
    await control('旋转建造朝向'); await wait(() => window.voxel.snapshot().axis === 'y');
    await click(pos(33, 28));
    await wait(() => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'bed' && j.axis === 'y' && j.x === 33 && j.y === 28));
    await control('门'); await page.keyboard.press('r'); await wait(() => window.voxel.snapshot().axis === 'x');
    await click(pos(32, 31));
    await wait(() => window.voxel.snapshot().snapshot.jobs.some(j => j.kind === 'door' && j.axis === 'x'));
    await screenshot('01-housing-blueprints');
    await run(); await wait(() => window.voxel.snapshot().snapshot.beds.length === 2 && window.voxel.snapshot().snapshot.doors.length === 1, undefined, 60000); await pause();
    const built = (await state()).snapshot, [first, second] = built.beds.slice().sort((a,b) => a.x-b.x), door = built.doors[0];
    assert.equal(first.axis, 'x'); assert.equal(second.axis, 'y');
    assert.equal(built.stats.consumed.wood, 115);
    for (const bed of [first, second]) {
      await inspect({ ...bed, z: bed.z + 0.5 }); assert.equal(await page.getByLabel('床位主人', { exact: true }).count(), 1);
      const foot = pos(bed.x + (bed.axis === 'x' ? 1 : 0), bed.y + (bed.axis === 'y' ? 1 : 0), bed.z);
      // A builder may still stand on the walkable foot tile; pawn picking returns that
      // tile while bed-body picking returns the anchor. Both must expose this bed.
      await inspect({ ...foot, z: foot.z + 0.49 }, [pos(bed.x, bed.y, bed.z), foot]);
      assert.equal(await page.getByLabel('床位主人', { exact: true }).count(), 1);
    }
    record('mouse placement builds both bed axes and door, both bed tiles inspect', { beds: built.beds, doors: built.doors, consumedWood: built.stats.consumed.wood });
    const [p1, p2] = built.pawns;
    await chooseOwner(first, p1.id); await chooseOwner(second, p1.id);
    assert.equal((await state()).snapshot.beds.find(b => b.id === first.id).owner, null);
    await chooseOwner(second, p2.id); await chooseOwner(first, p1.id);
    record('DOM owner assignment transfers exclusive ownership and restores distinct owners');
    for (const value of ['locked', 'open', 'auto']) await chooseDoor(door, value);
    record('door upper-body inspection and all three DOM modes');
    await openPawn(p1);
    const schedule = Array.from({ length: 24 }, (_, h) => h < 6 || h >= 22 ? 'sleep' : h >= 8 && h < 17 ? 'work' : 'anything');
    for (let hour = 0; hour < 24; hour++) {
      const select = page.getByLabel(`${p1.name} ${hour}点作息`, { exact: true });
      await select.scrollIntoViewIfNeeded(); await select.selectOption(schedule[hour]);
      await wait(({ id, hour, assignment }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).schedule[hour] === assignment, { id: p1.id, hour, assignment: schedule[hour] });
    }
    assert.deepEqual((await state()).snapshot.pawns.find(p => p.id === p1.id).schedule, schedule);
    record('24 hourly DOM schedule cells round-trip into simulation', { pawn: p1.name, schedule });
    await screenshot('02-schedule-1280');
    const beforeSave = await page.evaluate(() => window.voxel.exportSave());
    await writeFile(`${OUT}/${mode}-ui-housing-save.json`, JSON.stringify(beforeSave));
    await control('菜单与存档'); await control('保存营地');
    await page.getByText('手动保存成功', { exact: true }).waitFor(); await control('关闭菜单');
    await chooseOwner(first, null); await control('菜单与存档'); await control('读取营地');
    await wait(({ id, owner }) => window.voxel.snapshot().snapshot.beds.find(b => b.id === id)?.owner === owner, { id: first.id, owner: p1.id });
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const restored = (await state()).snapshot;
    assert.deepEqual(restored.pawns.find(p => p.id === p1.id).schedule, schedule);
    record('manual DOM save/load restores bed owners and all schedule entries', { tick: restored.tick, file: `${OUT}/${mode}-ui-housing-save.json`, sha256: digest(beforeSave) });
    await page.setViewportSize({ width: 900, height: 700 }); await page.waitForTimeout(350);
    const reachability = [];
    for (const name of ['床', '门', '擦除区域', '取消规划', '暂停', '3倍速', '菜单与存档'])
      reachability.push(await reachable(page.getByRole('button', { name, exact: true }), name));
    await control('床'); reachability.push(await reachable(page.getByRole('button', { name: '旋转建造朝向', exact: true }), '旋转建造朝向'));
    await chooseOwner(first, p1.id); reachability.push(await reachable(page.getByLabel('床位主人', { exact: true }), '床位主人'));
    await chooseDoor(door, 'open'); reachability.push(await reachable(page.getByLabel('门状态', { exact: true }), '门状态')); await chooseDoor(door, 'auto');
    await openPawn(p1);
    for (let hour = 0; hour < 24; hour++) reachability.push(await reachable(page.getByLabel(`${p1.name} ${hour}点作息`, { exact: true }), `schedule-${hour}`));
    await screenshot('03-schedule-900');
    await control('菜单与存档');
    for (const name of ['保存营地', '导出体素存档', '导入体素存档', '关闭菜单']) reachability.push(await reachable(page.getByRole('button', { name, exact: true }), name));
    await screenshot('04-save-menu-900'); await control('关闭菜单');
    record('900x700 controls remain reachable through actual panel and toolbar scrolling', { reachability });
    }
    if (!UI_ONLY) {
      await page.setViewportSize({ width: 1280, height: 800 });
      const builtBytes = await readFile(BUILT_SAVE), builtSave = JSON.parse(builtBytes);
      await importSave(BUILT_SAVE, builtSave.tick);
      const undergroundBed = builtSave.beds.find(b => b.z < 8), undergroundDoor = builtSave.doors.find(d => d.z < 8);
      assert.ok(undergroundBed && undergroundDoor, 'housing campaign needs an underground room and door');
      await control('地下'); await inspect({ ...undergroundBed, z: undergroundBed.z + .5 });
      const roomText = await page.locator('.voxel-room-detail').innerText();
      assert.match(roomText, /封闭房间/); assert.match(roomText, /12 格体积/);
      const roomRevision = (await state()).snapshot.roomRevision;
      await screenshot('05-underground-room');
      await control('上移一层');
      assert.equal(await page.locator('.voxel-room-detail').innerText(), roomText);
      assert.equal((await state()).snapshot.roomRevision, roomRevision);
      await control('地下'); await chooseDoor(undergroundDoor, 'open');
      await inspect({ ...undergroundBed, z: undergroundBed.z + .5 });
      assert.equal(await page.locator('.voxel-room-detail').innerText(), roomText);
      assert.equal((await state()).snapshot.roomRevision, roomRevision);
      const upperBed = builtSave.beds.find(b => b.z > 8); assert.ok(upperBed);
      await control('二层'); await inspect({ ...upperBed, z: upperBed.z + .5 });
      assert.match(await page.locator('.voxel-room-detail').innerText(), /室外连通空间/);
      await screenshot('06-upper-bedroom');
      record('campaign room topology survives view slicing and door opening', { fixture: BUILT_SAVE, sha256: digest(builtBytes), tick: builtSave.tick, roomText, roomRevision });
      const sleepBytes = await readFile(SLEEP_SAVE), sleepSave = JSON.parse(sleepBytes);
      const sleeper = sleepSave.pawns.find(p => p.phase === 'rest' && p.sleepBedId !== null);
      assert.ok(sleeper, 'campaign fixture must contain a real bed sleeper');
      const bed = sleepSave.beds.find(b => b.id === sleeper.sleepBedId); assert.ok(bed);
      result.fixture = { file: SLEEP_SAVE, sha256: digest(sleepBytes), tick: sleepSave.tick, pawnId: sleeper.id, bed };
      await importSave(SLEEP_SAVE, sleepSave.tick);
      await page.locator('.voxel-colonists button').filter({ hasText: sleeper.name }).click();
      const zoomAt = await point({ ...bed, z: bed.z + .8 });
      await page.mouse.move(zoomAt.x, zoomAt.y); await page.mouse.wheel(0, -800);
      for (const person of sleepSave.pawns.filter(p => p.phase === 'rest' && p.sleepBedId !== null)) {
        await page.locator('.voxel-colonists button').filter({ hasText: person.name }).click();
        await wait(z => window.voxel.snapshot().metrics.level === z && window.voxel.snapshot().metrics.pendingChunks === 0, person.z);
        const actual = (await state()).snapshot.pawns.find(p => p.id === person.id);
        assert.equal(actual.sleepBedId, person.sleepBedId); assert.equal(actual.phase, 'rest');
        await page.locator('.voxel-needs').scrollIntoViewIfNeeded();
        await screenshot(`07-sleeping-z${person.z}`);
      }
      await page.locator('.voxel-colonists button').filter({ hasText: sleeper.name }).click();
      await wait(z => window.voxel.snapshot().metrics.level === z && window.voxel.snapshot().metrics.pendingChunks === 0, sleeper.z);
      await control('查看');
      const sleepState = (await state()).snapshot;
      assert.equal(sleepState.pawns.find(p => p.id === sleeper.id).sleepBedId, bed.id);
      assert.match(await page.getByTestId('voxel-inspector').innerText(), /床|睡/);
      record('all three campaign sleepers reload across underground, surface and upper layers', { pawns: sleepSave.pawns.map(p => ({ id: p.id, z: p.z, bed: p.sleepBedId, rest: p.rest })) });
      const center = await point({ ...bed, z: bed.z + 0.8 });
      const clip = { x: Math.max(0, Math.floor(center.x - 95)), y: Math.max(0, Math.floor(center.y - 105)), width: 190, height: 210 };
      await page.mouse.move(5, 2); await page.waitForTimeout(350);
      const a = await page.screenshot({ clip }); await page.waitForTimeout(650); const b = await page.screenshot({ clip });
      await writeFile(`${OUT}/${mode}-sleep-paused-a.png`, a); await writeFile(`${OUT}/${mode}-sleep-paused-b.png`, b);
      const diff = await pixelDifference(a, b); assert.equal(diff.overTwo, 0, 'paused sleep pose and symbols moved');
      assert.equal((await state()).snapshot.tick, sleepSave.tick);
      record('normal-campaign sleeping save reloads and paused pixels are stable', { fixture: result.fixture, diff });
      const restBefore = sleepState.pawns.find(p => p.id === sleeper.id).rest;
      await run(); await wait(({ id, rest }) => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).rest > rest + .1, { id: sleeper.id, rest: restBefore }); await pause();
      const rested = (await state()).snapshot.pawns.find(p => p.id === sleeper.id);
      assert.equal(rested.phase, 'rest'); assert.equal(rested.sleepBedId, bed.id);
      record('resumed browser simulation restores rest while remaining in assigned bed', { before: restBefore, after: rested.rest, tick: (await state()).snapshot.tick });
      await screenshot('08-sleeping-resumed');
    }
    await Promise.all(assetReads);
    const builtAssets = result.assets.filter(a => a.localFile);
    if (builtAssets.length) assert.ok(builtAssets.every(a => a.matchesLocalBuild), 'loaded assets differ from local dist');
    assert.deepEqual(result.errors, []);
    result.status = UI_ONLY ? 'passed-ui-only' : FIXTURES_ONLY ? 'passed-fixtures-only' : 'passed'; result.final = { worker: (await state()).worker, metrics: (await state()).metrics, tick: (await state()).snapshot.tick };
  } catch (error) {
    result.status = 'failed'; result.errors.push(String(error.stack ?? error));
    await screenshot('failure').catch(() => {});
    await writeFile(`${OUT}/${mode}-failed-state.json`, JSON.stringify(await page.evaluate(() => window.voxel?.exportSave()).catch(() => null)));
    throw error;
  } finally { await Promise.all(assetReads); await context.close(); }
}

try {
  report.sourceHashes = Object.fromEntries(await Promise.all(['src/voxel/renderer.ts', 'src/voxel/world.ts', 'src/voxel/main.tsx', 'src/voxel/client.ts', 'src/voxel/style.css'].map(async file => [file, digest(await readFile(file))])));
  for (const mode of MODES) await verifyMode(mode);
  report.status = UI_ONLY ? 'passed-ui-only' : FIXTURES_ONLY ? 'passed-fixtures-only' : 'passed';
} catch (error) { report.status = 'failed'; throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
