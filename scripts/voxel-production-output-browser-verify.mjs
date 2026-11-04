import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:4198/?world=voxel';
const INPUT = process.env.VOXEL_PRODUCTION_OUTPUT_OUT ?? 'test-results/voxel-production-output-campaign';
const OUT = process.env.VOXEL_PRODUCTION_OUTPUT_BROWSER_OUT ?? 'test-results/voxel-production-output-browser';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const checkpointNames = ['specific-working', 'specific-carrying', 'specific-delivered', 'drop-working',
  'drop-completed', 'best-carrying', 'best-delivered', 'final'];
const campaignBytes = await readFile(`${INPUT}/report.json`), campaign = JSON.parse(campaignBytes);
assert.equal(campaign.status, 'passed', 'Requires a passed ordinary-command campaign');
assert.equal(sha(await readFile(campaign.input)), campaign.inputSha256);
assert.equal(campaign.scriptSha256, sha(await readFile(new URL('./voxel-production-output-campaign-verify.mjs', import.meta.url))));
for (const name of checkpointNames) {
  const checkpoint = campaign.checkpoints.find(value => value.name === name); assert(checkpoint, `Missing ${name}`);
  assert.equal(sha(await readFile(checkpoint.path)), checkpoint.sha256, `${name} unchanged checkpoint`);
}
for (const key of ['benchId', 'creatorId']) assert(Number.isSafeInteger(campaign[key]), key);
assert.equal(typeof campaign.billId, 'string'); assert.equal(campaign.targets.length, 2);
assert(campaign.expansion && Number.isSafeInteger(campaign.expansion.z));
const [specific, best] = campaign.targets;
const cell = pos => pos.x + pos.y * 64 + pos.z * 64 * 64;
const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
const targetKey = target => `${target.kind}:${target.id}`;
const billOf = save => save.productionQueues.find(queue => queue.benchId === campaign.benchId)?.bills.find(bill => bill.id === campaign.billId);
const creator = save => save.pawns.find(pawn => pawn.id === campaign.creatorId);
const zoneOf = save => save.stockpileZones.find(zone => zone.id === specific.target.id);
const deliveryState = save => save.pawns.map(pawn => ({ id: pawn.id, cargo: pawn.cargo, delivery: pawn.productionDelivery }));
function counts(save) {
  const result = Object.fromEntries(Object.keys(save.stats.produced).map(resource => [resource, 0]));
  const add = batch => {
    result[batch.resource] += batch.amount;
    if (batch.unfinished) for (const material of batch.unfinished.ingredients) result[material.resource] += material.amount;
  };
  for (const batch of save.items) add(batch);
  for (const pawn of save.pawns.filter(pawn => pawn.faction === 'colony')) {
    if (pawn.cargo) add(pawn.cargo);
    result.apparel += pawn.worn.length; result.weapon += pawn.weapon ? 1 : 0;
  }
  for (const job of save.jobs) for (const resource of Object.keys(result)) result[resource] += job.delivered[resource] ?? 0;
  result.carcass += save.animals.filter(animal => animal.dead).length;
  return result;
}
function conserved(before, after) {
  const a = counts(before), b = counts(after);
  for (const resource of Object.keys(a)) {
    const balance = (save, physical) => physical + save.stats.consumed[resource] + save.stats.spoiled[resource]
      + save.stats.destroyed[resource] - save.stats.produced[resource];
    assert.equal(balance(before, a[resource]), balance(after, b[resource]), `${resource} material conservation`);
  }
  return { before: a, after: b };
}
await mkdir(OUT, { recursive: true });
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE,
  scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${INPUT}/report.json`, sha256: sha(campaignBytes), input: campaign.input, inputSha256: campaign.inputSha256 },
  scope: 'Chrome Worker and main rendering. Actual visible bill selects, map clicks, storage rename/filter/expand controls, keyboard and file import/export only. Bridge access is read-only snapshot/project/exportSave. SHA-verified ordinary-command checkpoints are imported unchanged; no direct command, terrain, item, pawn or timer injection.',
  modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const mode of ['worker', 'main']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await context.newPage(), assetReads = [];
    const result = { mode, status: 'running', checks: [], errors: [], assets: [], imports: [], exports: [], screenshots: [], evidence: {} };
    report.modes.push(result);
    page.on('pageerror', error => result.errors.push(error.stack ?? error.message));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    page.on('response', response => {
      if (!/\/assets\/.*\.(js|css)$/.test(new URL(response.url()).pathname)) return;
      const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
      assetReads.push(response.body().then(async bytes => {
        asset.sha256 = sha(bytes); asset.bytes = bytes.length;
        asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
      }).catch(error => { asset.error = String(error); }));
    });
    const state = () => page.evaluate(() => window.voxel.snapshot());
    const saved = () => page.evaluate(() => window.voxel.exportSave());
    const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
    const button = name => page.getByRole('button', { name, exact: true });
    const panel = () => page.locator(`[data-testid="production-bills"][data-bench-id="${campaign.benchId}"]`);
    const row = () => panel().locator(`[data-testid="bill-row"][data-bill-id="${campaign.billId}"]`);
    const output = () => row().getByRole('combobox', { name: '成品去向', exact: true });
    const targets = () => row().getByRole('combobox', { name: '成品目标仓库', exact: true });
    const zonePanel = () => page.locator(`[data-testid="stockpile-zone"][data-zone-id="${specific.target.id}"]`);
    const delivery = () => page.locator(`[data-testid="production-delivery"][data-pawn-id="${campaign.creatorId}"]:visible`).first();
    const check = name => { result.checks.push(name); console.log('PASS', mode, name); };
    async function click(name) {
      await button(name).scrollIntoViewIfNeeded(); await button(name).click();
      if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
      if (/^[123]倍速$/.test(name)) await wait(speed => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
    }
    async function settle() { await page.waitForTimeout(180); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); }
    async function reachable(locator) {
      await locator.scrollIntoViewIfNeeded();
      const reach = await locator.evaluate(element => {
        const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, top = document.elementFromPoint(x, y);
        return { hit: top === element || element.contains(top), width: r.width, height: r.height,
          inside: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight };
      });
      assert(reach.hit && reach.inside && reach.width > 0 && reach.height > 0, JSON.stringify(reach));
    }
    async function shot(name, locator) {
      if (locator) await reachable(locator);
      await settle(); const file = `${OUT}/${mode}-${name}.png`;
      await page.screenshot({ path: file }); result.screenshots.push(file);
    }
    async function load(file, checkpoint) {
      const bytes = await readFile(file), data = JSON.parse(bytes);
      if (checkpoint) { assert.equal(sha(bytes), checkpoint.sha256); assert.equal(data.tick, checkpoint.tick); }
      assert.equal(data.version, 42);
      result.imports.push({ file, sha256: sha(bytes), version: data.version, tick: data.tick, checkpoint: checkpoint?.name ?? null });
      await page.keyboard.press('Escape'); await click('菜单与存档');
      const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
      await button('关闭菜单').waitFor({ state: 'hidden' });
      await wait(tick => window.voxel.snapshot().snapshot.tick === tick && window.voxel.snapshot().snapshot.speed === 0, data.tick);
      await settle();
      const imported = await saved();
      assert.deepEqual(imported.productionQueues, data.productionQueues);
      assert.deepEqual(imported.stockpileZones, data.stockpileZones);
      assert.deepEqual(deliveryState(imported), deliveryState(data));
      assert.deepEqual(imported.stats, data.stats); assert.deepEqual(counts(imported), counts(data));
      return data;
    }
    async function fixture(name) {
      const checkpoint = campaign.checkpoints.find(checkpoint => checkpoint.name === name); assert(checkpoint);
      return load(checkpoint.path, checkpoint);
    }
    async function projected(pos, height = .03, dx = 0, dy = 0) {
      const point = await page.evaluate(pos => window.voxel.project(pos), { x: pos.x, y: pos.y, z: pos.z + height });
      const box = await page.locator('canvas[aria-label="多层体素地图"]').boundingBox(); assert(box);
      return { x: box.x + point.x + dx, y: box.y + point.y + dy, height, dx, dy };
    }
    async function canvasAt(point) {
      return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', point);
    }
    async function select(pos, selected, heights = [.03, .16, .45, .8, 0]) {
      await page.keyboard.press('Escape');
      while ((await state()).level !== pos.z) await click((await state()).level < pos.z ? '上移一层' : '下移一层');
      await click('查看'); await settle();
      for (let attempt = 0; attempt < 3; attempt++) {
        for (const height of heights) for (const [dx, dy] of [[0, 0], [0, 8], [8, 0], [-8, 0], [0, -8], [12, 8], [-12, 8], [12, -8], [-12, -8]]) {
          const point = await projected(pos, height, dx, dy);
          if (!await canvasAt(point)) continue;
          await page.mouse.click(point.x, point.y); await page.waitForTimeout(100);
          if (await selected()) return point;
        }
        await page.mouse.move(720, 400); await page.mouse.wheel(0, 250); await settle();
      }
      throw Error(`Visible map clicks did not select ${JSON.stringify(pos)}`);
    }
    async function selectBench() {
      const snapshot = (await state()).snapshot;
      const bench = [...snapshot.stoves, ...snapshot.butcherSpots, ...snapshot.stonecutters,
        ...snapshot.weaponBenches, ...snapshot.tailors].find(bench => bench.id === campaign.benchId); assert(bench);
      await select(bench, async () => await panel().count() > 0);
    }
    async function selectZone() {
      await select(specific.pos, async () => same((await state()).selected, specific.pos) && await zonePanel().count() > 0);
    }
    async function roundtrip(name) {
      const before = await saved(); assert.equal((await state()).snapshot.speed, 0);
      await click('菜单与存档');
      const download = page.waitForEvent('download'); await click('导出体素存档');
      const file = `${OUT}/${mode}-${name}-roundtrip.json`; await (await download).saveAs(file); await click('关闭菜单');
      result.exports.push({ file, sha256: sha(await readFile(file)), tick: before.tick });
      await load(file); const after = await saved();
      assert.deepEqual(deliveryState(after), deliveryState(before));
      assert.deepEqual(after.productionQueues, before.productionQueues);
      assert.deepEqual(after.stockpileZones, before.stockpileZones);
      assert.deepEqual(after.stats, before.stats); assert.deepEqual(counts(after), counts(before));
      return after;
    }
    async function runUntil(fn, arg, speed = 3) {
      await click(`${speed}倍速`);
      try { await wait(fn, arg); } finally { await click('暂停'); }
    }
    async function waitOutput(expected) {
      await wait(({ benchId, billId, expected }) => {
        const value = window.voxel.snapshot().snapshot.productionQueues.find(q => q.benchId === benchId)?.bills.find(b => b.id === billId)?.output;
        return JSON.stringify(value) === JSON.stringify(expected);
      }, { benchId: campaign.benchId, billId: campaign.billId, expected });
    }
    async function finishDelivery(checkpoint, destination, name) {
      const before = await fixture(checkpoint), worker = creator(before), cargo = structuredClone(worker.cargo);
      assert(worker.productionDelivery && cargo?.weapon); assert.equal(worker.priorities.haul, 0);
      assert.equal(worker.productionDelivery.cell, cell(destination.pos));
      assert.equal(billOf(before).remaining, 0);
      await selectBench();
      assert.equal(await row().getAttribute('data-bill-state'), 'delivery');
      assert.equal(await row().getByTestId('bill-progress').count(), 0);
      assert.equal(await row().getByTestId('bill-unfinished').count(), 0);
      assert((await delivery().innerText()).includes(worker.name));
      assert((await delivery().innerText()).includes('已完成加工'));
      await shot(`${name}-carried-bill`, delivery().getByTestId('production-delivery-target'));
      if (name === 'specific') {
        await output().selectOption('drop'); await waitOutput({ mode: 'drop', target: null });
        assert.deepEqual(creator(await saved()).productionDelivery, worker.productionDelivery);
        await delivery().getByRole('button', { name: '查看制作者', exact: true }).click();
        await delivery().waitFor({ state: 'visible' });
        await shot('specific-carried-pawn', delivery().getByTestId('production-delivery-target'));
        check('completed goods display as delivery; changing the next batch does not retarget cargo already carried');
      }
      await roundtrip(`${name}-carried`); await selectBench();
      assert.deepEqual(creator(await saved()).cargo, cargo);
      assert.deepEqual(creator(await saved()).productionDelivery, worker.productionDelivery);
      await runUntil(({ id, weaponId, pos }) => {
        const s = window.voxel.snapshot().snapshot;
        return !s.pawns.find(p => p.id === id)?.productionDelivery && s.items.some(i => i.weapon?.id === weaponId && i.x === pos.x && i.y === pos.y && i.z === pos.z);
      }, { id: campaign.creatorId, weaponId: cargo.weapon.id, pos: destination.pos });
      const after = await saved(), delivered = after.items.filter(item => item.weapon?.id === cargo.weapon.id);
      assert.equal(delivered.length, 1); assert(same(delivered[0], destination.pos));
      assert.equal(after.stats.weaponsMade, before.stats.weaponsMade);
      assert.equal(billOf(after).remaining, 0);
      result.evidence[name] = { cargo, delivery: worker.productionDelivery, delivered: delivered[0], ledger: conserved(before, after) };
      await shot(`${name}-delivered`, row().getByTestId('bill-status'));
      check(`${name} delivery survives visible export/import, reaches its real warehouse and never produces or decrements twice`);
    }
    try {
      const url = new URL(BASE); url.searchParams.set('world', 'voxel');
      if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
      await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await click('暂停');
      if (await button('收起指引').isVisible()) await click('收起指引');
      assert.equal((await state()).worker, mode === 'worker'); check('requested renderer path is active');

      const working = await fixture('specific-working'), initialBill = structuredClone(billOf(working));
      await selectBench(); assert.deepEqual(initialBill.output, { mode: 'specific', target: specific.target });
      await shot('specific-settings', row().getByTestId('bill-output-target-status'));
      await output().selectOption('drop'); await waitOutput({ mode: 'drop', target: null });
      await output().selectOption('specific'); await row().getByTestId('bill-output-draft').waitFor({ state: 'visible' });
      assert.deepEqual(billOf(await saved()).output, { mode: 'drop', target: null });
      assert.equal(await targets().inputValue(), ''); await shot('specific-draft', row().getByTestId('bill-output-draft'));
      await row().getByRole('button', { name: '取消选择', exact: true }).click(); assert.equal(await output().inputValue(), 'drop');
      assert.deepEqual(billOf(await saved()).output, { mode: 'drop', target: null });
      await output().selectOption('best'); await waitOutput({ mode: 'best', target: null });
      await output().selectOption('specific'); await row().getByTestId('bill-output-draft').waitFor({ state: 'visible' });
      assert.deepEqual(billOf(await saved()).output, { mode: 'best', target: null });
      await targets().selectOption(targetKey(best.target)); await waitOutput({ mode: 'specific', target: best.target });
      await targets().selectOption(targetKey(specific.target)); await waitOutput(initialBill.output);
      assert.deepEqual(billOf(await saved()), initialBill); conserved(working, await saved());
      check('all three output modes use visible controls; an unselected specific draft preserves the old mode until a target is chosen');

      await row().getByTestId('bill-output-focus').click(); await zonePanel().waitFor({ state: 'visible' });
      await selectZone();
      await page.getByRole('checkbox', { name: '应用到同层相连仓储', exact: true }).setChecked(false);
      assert.equal(await page.getByRole('checkbox', { name: '收纳武器', exact: true }).isChecked(), true);
      await page.getByRole('checkbox', { name: '收纳武器', exact: true }).click();
      await wait(pos => !window.voxel.snapshot().snapshot.stockpiles.find(s => s.x === pos.x && s.y === pos.y && s.z === pos.z)?.accepts.includes('weapon'), specific.pos);
      await selectBench(); assert.deepEqual(billOf(await saved()).output, initialBill.output);
      assert.equal(await targets().inputValue(), targetKey(specific.target));
      await wait(key => [...document.querySelectorAll('[aria-label="成品目标仓库"] option')]
        .some(option => option.value === key && option.disabled), targetKey(specific.target));
      assert.equal(await targets().locator(`option[value="${targetKey(specific.target)}"]`).evaluate(option => option.disabled), true);
      assert((await row().getByTestId('bill-output-target-status').innerText()).includes('当前筛选不接纳'));
      await shot('target-filter-warning', row().getByTestId('bill-output-target-status'));
      await selectZone(); assert.equal(await page.getByRole('checkbox', { name: '收纳武器', exact: true }).isChecked(), false);
      await page.getByRole('checkbox', { name: '收纳武器', exact: true }).click();
      await wait(pos => window.voxel.snapshot().snapshot.stockpiles.find(s => s.x === pos.x && s.y === pos.y && s.z === pos.z)?.accepts.includes('weapon'), specific.pos);
      check('temporarily refusing a product preserves the exact destination and exposes an unavailable selected option');

      const renamed = `${specific.name} · 界面验证`;
      await zonePanel().getByRole('textbox', { name: '仓库区名称', exact: true }).fill(renamed);
      await zonePanel().getByTestId('stockpile-zone-rename').click();
      await wait(({ id, name }) => window.voxel.snapshot().snapshot.stockpileZones.find(z => z.id === id)?.name === name,
        { id: specific.target.id, name: renamed });
      await shot('zone-renamed', zonePanel().getByTestId('stockpile-zone-name'));
      await selectBench(); assert((await row().getByTestId('bill-output-target-status').innerText()).includes(renamed));
      assert.deepEqual(billOf(await saved()).output, initialBill.output);
      check('renaming a warehouse updates the bill label without replacing its stable destination identity');

      const expansion = campaign.expansion, originalZone = structuredClone(zoneOf(await saved()));
      assert(originalZone.cells.includes(cell(expansion)) && originalZone.cells.length > 1);
      const calibrated = await select(expansion, async () => same((await state()).selected, expansion));
      await click('擦除区域'); assert(await canvasAt(calibrated)); await page.mouse.click(calibrated.x, calibrated.y);
      await wait(({ id, index }) => !window.voxel.snapshot().snapshot.stockpileZones.find(z => z.id === id)?.cells.includes(index),
        { id: specific.target.id, index: cell(expansion) });
      assert.equal(zoneOf(await saved()).cells.length, originalZone.cells.length - 1);
      assert.deepEqual(billOf(await saved()).output, initialBill.output);
      await selectZone(); const beforeExpansion = structuredClone(zoneOf(await saved()));
      await zonePanel().getByTestId('stockpile-zone-expand').click();
      await wait(id => window.voxel.snapshot().stockpileZoneId === id && window.voxel.snapshot().tool === 'stock', specific.target.id);
      await shot('zone-expansion', page.getByTestId('stockpile-expansion-cancel'));
      await page.getByTestId('stockpile-expansion-cancel').click();
      assert.equal((await state()).stockpileZoneId, null); assert.equal((await state()).tool, 'inspect');
      assert.deepEqual(zoneOf(await saved()), beforeExpansion);
      await zonePanel().getByTestId('stockpile-zone-expand').click();
      const expansionPoint = await projected(expansion, calibrated.height, calibrated.dx, calibrated.dy);
      assert(await canvasAt(expansionPoint), 'Expansion target must remain visibly on the map');
      await page.mouse.move(expansionPoint.x, expansionPoint.y); await page.mouse.down();
      await page.mouse.move(expansionPoint.x, expansionPoint.y, { steps: 2 }); await page.mouse.up();
      await wait(({ id, index }) => window.voxel.snapshot().snapshot.stockpileZones.find(z => z.id === id)?.cells.includes(index),
        { id: specific.target.id, index: cell(expansion) });
      assert.deepEqual(zoneOf(await saved()).cells.toSorted((a, b) => a - b), originalZone.cells.toSorted((a, b) => a - b));
      assert.deepEqual(billOf(await saved()).output, initialBill.output);
      await page.keyboard.press('Escape'); assert.equal((await state()).stockpileZoneId, null);
      await selectZone(); await zonePanel().getByTestId('stockpile-zone-expand').click();
      await click('仓储'); assert.equal((await state()).stockpileZoneId, null);
      await page.keyboard.press('Escape');
      result.evidence.zone = { before: originalZone, after: zoneOf(await saved()), expansion, ledger: conserved(working, await saved()) };
      check('visible erase/expand retains warehouse identity; cancel and returning to the ordinary storage tool clear expansion state');

      await page.setViewportSize({ width: 980, height: 720 }); await settle();
      await selectBench(); await shot('compact-output', targets());
      await selectZone(); await shot('compact-zone', zonePanel().getByTestId('stockpile-zone-expand'));
      await page.setViewportSize({ width: 1440, height: 960 }); await settle();
      check('output settings and warehouse naming/expansion controls remain visible and reachable at 980 by 720');

      await finishDelivery('specific-carrying', specific, 'specific');
      const drop = await fixture('drop-working'); assert.equal(billOf(drop).output.mode, 'drop');
      await selectBench();
      await runUntil(made => window.voxel.snapshot().snapshot.stats.weaponsMade > made, drop.stats.weaponsMade);
      const dropped = await saved();
      assert.equal(dropped.stats.weaponsMade, drop.stats.weaponsMade + 1);
      assert.equal(billOf(dropped).remaining, 0); assert.equal(creator(dropped).productionDelivery, undefined);
      assert.equal(dropped.items.filter(item => same(item, specific.pos) && item.resource === 'weapon').length,
        drop.items.filter(item => same(item, specific.pos) && item.resource === 'weapon').length);
      assert.equal(dropped.items.filter(item => same(item, best.pos) && item.resource === 'weapon').length,
        drop.items.filter(item => same(item, best.pos) && item.resource === 'weapon').length);
      result.evidence.drop = { ledger: conserved(drop, dropped), remaining: billOf(dropped).remaining };
      await shot('drop-completed', row().getByTestId('bill-status'));
      check('Drop completes through normal simulation with no delivery task and no automatic relocation to either warehouse');
      await finishDelivery('best-carrying', best, 'best');

      for (const name of checkpointNames) {
        const data = await fixture(name); await selectBench();
        assert.equal(await output().inputValue(), billOf(data).output.mode);
        if (creator(data).productionDelivery) {
          assert.equal(await row().getAttribute('data-bill-state'), 'delivery');
          assert.equal(await row().getByTestId('bill-progress').count(), 0);
        }
      }
      assert.equal(billOf(await saved()).output.mode, 'drop'); assert.equal(billOf(await saved()).remaining, 0);
      assert.equal(zoneOf(await saved()), undefined); await shot('final', row().getByTestId('bill-status'));
      check('all eight SHA-verified campaign checkpoints import unchanged and display their matching output/delivery state');
      await Promise.all(assetReads);
      for (const asset of result.assets) asset.matchesLocalBuildAtEnd =
        sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
      assert(result.assets.length > 0 && result.assets.every(asset => asset.status === 200 && asset.matchesLocalBuild && asset.matchesLocalBuildAtEnd));
      assert.equal(sha(await readFile(new URL(import.meta.url))), report.scriptSha256);
      assert.equal(sha(await readFile(`${INPUT}/report.json`)), report.campaign.sha256);
      assert.deepEqual(result.errors, []); check('no runtime errors; every observed JS/CSS asset matches the local build');
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.failure = error.stack ?? String(error);
      const data = await saved().catch(() => null);
      if (data) result.failureState = { tick: data.tick, bill: billOf(data), zones: data.stockpileZones, stockpiles: data.stockpiles,
        pawns: data.pawns.map(({ id, phase, reason, jobId, cargo, productionDelivery }) => ({ id, phase, reason, jobId, cargo, productionDelivery })) };
      result.failureOptions = await page.locator('[aria-label="成品目标仓库"] option').evaluateAll(options =>
        options.map(option => ({ value: option.value, disabled: option.disabled, text: option.textContent }))).catch(() => []);
      await shot('failure').catch(() => {}); throw error;
    } finally { await context.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await browser.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
