import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:4198/?world=voxel';
const INPUT = process.env.VOXEL_UNFINISHED_OUT ?? 'test-results/voxel-unfinished-production-campaign';
const OUT = process.env.VOXEL_UNFINISHED_BROWSER_OUT ?? 'test-results/voxel-unfinished-production-browser';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const campaignBytes = await readFile(`${INPUT}/report.json`), campaign = JSON.parse(campaignBytes);
assert.equal(campaign.status, 'passed', 'Requires a passed ordinary-command campaign');
for (const name of ['working', 'paused', 'stored', 'orphan', 'forbidden', 'carried', 'working-again', 'final'])
  assert(campaign.checkpoints.some(checkpoint => checkpoint.name === name), `Missing ${name}`);
assert.equal(sha(await readFile(campaign.input)), campaign.inputSha256);
for (const field of ['benchId', 'creatorId', 'unfinishedId']) assert(Number.isSafeInteger(campaign[field]), field);
await mkdir(OUT, { recursive: true });
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE,
  scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${INPUT}/report.json`, sha256: sha(campaignBytes), input: campaign.input, inputSha256: campaign.inputSha256 },
  scope: 'Chrome Worker and main rendering. Actual visible map clicks, bill controls, storage filters, forbidden/cancel controls and file import/export only. Bridge access is read-only snapshot/project/exportSave. SHA-verified ordinary-command checkpoints are imported unchanged; no direct command, position, resource, worker or clock mutation.', modes: [] };
const entries = save => [
  ...save.items.filter(batch => batch.unfinished).map(batch => ({ batch, piece: batch.unfinished, pos: batch })),
  ...save.pawns.filter(pawn => pawn.cargo?.unfinished).map(carrier => ({ batch: carrier.cargo, piece: carrier.cargo.unfinished, pos: carrier, carrier })),
];
const entry = save => entries(save).find(item => item.piece.id === campaign.unfinishedId);
const billOf = (save, billId) => save.productionQueues.find(queue => queue.benchId === campaign.benchId)?.bills.find(bill => bill.id === billId);
const stableItems = save => entries(save).map(({ batch, piece, carrier }) => ({ piece, forbidden: !!batch.forbidden, carrierId: carrier?.id ?? null }));
function counts(save) {
  const result = Object.fromEntries(Object.keys(save.stats.produced).map(resource => [resource, 0]));
  const add = batch => { result[batch.resource] += batch.amount;
    if (batch.unfinished) for (const material of batch.unfinished.ingredients) result[material.resource] += material.amount; };
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
    const row = billId => panel().locator(`[data-testid="bill-row"][data-bill-id="${billId}"]`);
    const details = () => page.locator(`[data-testid="unfinished-detail"][data-unfinished-id="${campaign.unfinishedId}"]:visible`).first();
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
      assert.equal(data.version, 41);
      result.imports.push({ file, sha256: sha(bytes), version: data.version, tick: data.tick, checkpoint: checkpoint?.name ?? null });
      await page.keyboard.press('Escape'); await click('菜单与存档');
      const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
      await button('关闭菜单').waitFor({ state: 'hidden' });
      await wait(tick => window.voxel.snapshot().snapshot.tick === tick && window.voxel.snapshot().snapshot.speed === 0, data.tick);
      await settle(); return data;
    }
    async function fixture(name) {
      const checkpoint = campaign.checkpoints.find(checkpoint => checkpoint.name === name); assert(checkpoint);
      return load(checkpoint.path, checkpoint);
    }
    async function select(pos, selected, heights = [.03, .16, .45, .8, 0]) {
      await page.keyboard.press('Escape');
      while ((await state()).level !== pos.z) await click((await state()).level < pos.z ? '上移一层' : '下移一层');
      await click('查看'); await settle();
      for (let attempt = 0; attempt < 3; attempt++) {
        for (const height of heights) {
          const point = await page.evaluate(pos => window.voxel.project(pos), { x: pos.x, y: pos.y, z: pos.z + height });
          const box = await page.locator('canvas[aria-label="多层体素地图"]').boundingBox(); assert(box);
          for (const [dx, dy] of [[0, 0], [0, 8], [8, 0], [-8, 0], [0, -8], [12, 8], [-12, 8], [12, -8], [-12, -8]]) {
            const x = box.x + point.x + dx, y = box.y + point.y + dy;
            if (!await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', { x, y })) continue;
            await page.mouse.click(x, y); await page.waitForTimeout(100);
            if (await selected()) return;
          }
        }
        await page.mouse.move(720, 400); await page.mouse.wheel(0, 250); await settle();
      }
      throw Error(`Visible map clicks did not select ${JSON.stringify(pos)}`);
    }
    async function selectBench() {
      const snapshot = (await state()).snapshot;
      const bench = [...snapshot.weaponBenches, ...snapshot.tailors].find(bench => bench.id === campaign.benchId); assert(bench);
      await select(bench, async () => await panel().count() > 0);
    }
    async function selectPiece() {
      const current = entry((await state()).snapshot); assert(current);
      await select(current.pos, async () => await details().count() > 0, current.carrier ? [1, .8, .4, .1] : [.1, .3, .03, .5, 0]);
      assert((await details().getByTestId('unfinished-creator').innerText()).includes(current.piece.creatorName));
      assert.equal(Number(await details().getByTestId('unfinished-progress').getAttribute('data-progress')), current.piece.progress);
      assert.equal(await details().getByTestId('unfinished-materials').locator('[data-resource]').count(), current.piece.ingredients.length);
      return current;
    }
    async function roundtrip(name) {
      const before = await saved(); await click('菜单与存档');
      const download = page.waitForEvent('download'); await click('导出体素存档');
      const file = `${OUT}/${mode}-${name}-roundtrip.json`; await (await download).saveAs(file); await click('关闭菜单');
      result.exports.push({ file, sha256: sha(await readFile(file)), tick: before.tick });
      await load(file); const after = await saved();
      assert.deepEqual(stableItems(after), stableItems(before));
      assert.deepEqual(after.productionQueues, before.productionQueues); assert.deepEqual(after.stats, before.stats);
      assert.deepEqual(counts(after), counts(before));
      return after;
    }
    async function runUntil(fn, arg, speed = 3) {
      await click(`${speed}倍速`);
      try { await wait(fn, arg); } finally { await click('暂停'); }
    }
    async function runFor(ticks) { const tick = (await state()).snapshot.tick; await runUntil(t => window.voxel.snapshot().snapshot.tick >= t, tick + ticks); }
    async function forbid(value) {
      if (!!entry(await saved()).batch.forbidden !== value) await details().getByTestId('unfinished-forbid').click();
      await wait(({ id, value }) => {
        const s = window.voxel.snapshot().snapshot, batch = s.items.find(i => i.unfinished?.id === id) ?? s.pawns.find(p => p.cargo?.unfinished?.id === id)?.cargo;
        return !!batch && !!batch.forbidden === value;
      }, { id: campaign.unfinishedId, value });
    }
    try {
      const url = new URL(BASE); url.searchParams.set('world', 'voxel');
      if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
      await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await click('暂停');
      if (await button('收起指引').isVisible()) await click('收起指引');
      assert.equal((await state()).worker, mode === 'worker'); check('requested renderer path is active');

      const working = await fixture('working'), original = structuredClone(entry(working).piece);
      await selectBench();
      const billPiece = row(campaign.billId).getByTestId('bill-unfinished');
      assert.equal(await billPiece.getAttribute('data-unfinished-id'), String(original.id));
      assert((await billPiece.innerText()).includes(original.creatorName));
      await shot('working-bill', billPiece);
      await row(campaign.billId).getByTestId('bill-focus-unfinished').click();
      await details().waitFor({ state: 'visible' });
      assert.equal(Number(await details().getByTestId('unfinished-progress').getAttribute('data-progress')), original.progress);
      await shot('working-inspect', details().getByTestId('unfinished-binding')); await selectBench();
      check('bill inspection button selects its actual unfinished workpiece');
      await row(campaign.billId).getByTestId('bill-suspend').click();
      await wait(({ benchId, billId }) => window.voxel.snapshot().snapshot.productionQueues.find(q => q.benchId === benchId)?.bills.find(b => b.id === billId)?.suspended,
        { benchId: campaign.benchId, billId: campaign.billId });
      await runFor(30); const paused = await saved();
      assert.deepEqual(entry(paused).piece, original); conserved(working, paused);
      await selectPiece(); assert((await details().getByTestId('unfinished-binding').innerText()).includes('暂停'));
      assert((await state()).metrics.unfinished.groundParts >= 6);
      await shot('paused-item', details().getByTestId('unfinished-forbid'));
      check('visible bill pause retains selectable physical item, exact progress, author and embedded materials');

      await selectBench(); await row(campaign.billId).getByRole('button', { name: '删除账单', exact: true }).click();
      await wait(id => !window.voxel.snapshot().snapshot.productionQueues.some(q => q.bills.some(b => b.id === id)), campaign.billId);
      const orphan = await saved(); assert.equal(entry(orphan).piece.boundBillId, null);
      assert.deepEqual({ ...entry(orphan).piece, boundBillId: original.boundBillId }, original);
      await selectPiece(); assert((await details().getByTestId('unfinished-binding').innerText()).includes('未绑定账单'));
      await shot('orphan-item', details().getByTestId('unfinished-binding'));
      check('deleting a bill visibly unbinds its preserved unfinished item');

      await forbid(true); const forbidden = await saved(); await runFor(40);
      assert.deepEqual(entry(await saved()).piece, entry(forbidden).piece);
      await roundtrip('forbidden-orphan'); await selectPiece();
      assert.equal(await details().getByTestId('unfinished-forbid').getAttribute('aria-pressed'), 'true');
      await shot('forbidden-item', details().getByTestId('unfinished-forbid'));
      await page.setViewportSize({ width: 980, height: 720 }); await settle();
      await shot('compact-item', details().getByTestId('unfinished-forbid'));
      await details().locator('.voxel-unfinished-cancel > summary').click();
      await shot('compact-cancel', details().getByTestId('unfinished-cancel'));
      await page.setViewportSize({ width: 1440, height: 960 }); await settle();
      await forbid(false); const beforeCancel = await saved(), materials = entry(beforeCancel).piece.ingredients;
      await details().getByTestId('unfinished-cancel').click();
      await wait(id => {
        const s = window.voxel.snapshot().snapshot;
        return !s.items.some(i => i.unfinished?.id === id) && !s.pawns.some(p => p.cargo?.unfinished?.id === id);
      }, campaign.unfinishedId);
      const cancelled = await saved();
      assert.equal(cancelled.stats.consumed.unfinished, beforeCancel.stats.consumed.unfinished + 1);
      assert.equal(counts(cancelled).unfinished, counts(beforeCancel).unfinished - 1);
      result.evidence.cancel = { materials, ledger: conserved(beforeCancel, cancelled) };
      for (const material of materials) assert.equal(counts(cancelled)[material.resource], counts(beforeCancel)[material.resource]);
      check('forbidden state survives visible export/import; allow and cancel return every embedded material exactly once');

      const stored = await fixture('stored'), storedPiece = entry(stored); assert(storedPiece && !storedPiece.carrier);
      await selectPiece(); const checkbox = page.getByRole('checkbox', { name: '收纳未完成品', exact: true });
      await checkbox.waitFor({ state: 'visible' }); assert.equal(await checkbox.isChecked(), true);
      await checkbox.click(); await wait(pos => !window.voxel.snapshot().snapshot.stockpiles.find(s => s.x === pos.x && s.y === pos.y && s.z === pos.z)?.accepts.includes('unfinished'), storedPiece.pos);
      await checkbox.click(); await wait(pos => window.voxel.snapshot().snapshot.stockpiles.find(s => s.x === pos.x && s.y === pos.y && s.z === pos.z)?.accepts.includes('unfinished'), storedPiece.pos);
      assert.deepEqual(entry(await saved()).piece, storedPiece.piece);
      await shot('stored-filter', checkbox); await roundtrip('stored');
      check('stored item has an independent storage filter and survives a visible save/load without material duplication');

      const carried = await fixture('carried'); assert(entry(carried)?.carrier);
      await selectPiece(); assert.equal(await page.getByTestId('carried-unfinished').count(), 1);
      assert((await state()).metrics.unfinished.carried.some(value => value.unfinishedId === campaign.unfinishedId));
      await shot('carried-item', details().getByTestId('unfinished-location')); await roundtrip('carried');
      result.evidence.carried = { carrierId: entry(carried).carrier.id, piece: entry(carried).piece };
      check('carried workpiece has a distinct rendered model, inspection controls and persistent identity');

      const resumed = await fixture('working-again'), resumedPiece = entry(resumed).piece;
      assert.equal(resumedPiece.creatorId, campaign.creatorId); assert.equal(resumedPiece.boundBillId, campaign.newBillId);
      assert(resumedPiece.progress > original.progress); assert.equal(billOf(resumed, campaign.newBillId).policy.ingredientRadius, 3);
      await selectBench();
      await runUntil(({ id, progress }) => {
        const s = window.voxel.snapshot().snapshot, piece = s.items.find(i => i.unfinished?.id === id)?.unfinished ?? s.pawns.find(p => p.cargo?.unfinished?.id === id)?.cargo?.unfinished;
        return piece && piece.progress > progress;
      }, { id: campaign.unfinishedId, progress: resumedPiece.progress }, 1);
      const live = await saved(), ownerJob = live.jobs.find(job => job.unfinishedId === campaign.unfinishedId);
      assert(ownerJob && ownerJob.owner === campaign.creatorId); assert.equal(entry(live).piece.creatorId, campaign.creatorId);
      await shot('resumed-bill', row(campaign.newBillId).getByTestId('bill-unfinished'));
      await roundtrip('resumed'); await selectBench();
      await runUntil(id => {
        const s = window.voxel.snapshot().snapshot;
        return !s.items.some(i => i.unfinished?.id === id) && !s.pawns.some(p => p.cargo?.unfinished?.id === id);
      }, campaign.unfinishedId);
      const finished = await saved();
      assert.equal(finished.stats.weaponsMade, resumed.stats.weaponsMade + 1);
      assert.equal(finished.stats.consumed.unfinished, resumed.stats.consumed.unfinished + 1);
      assert.equal(billOf(finished, campaign.newBillId).remaining, billOf(resumed, campaign.newBillId).remaining - 1);
      result.evidence.completed = { creatorId: campaign.creatorId, before: resumedPiece, remaining: billOf(finished, campaign.newBillId).remaining,
        ledger: conserved(resumed, finished) };
      await shot('finished-bill', row(campaign.newBillId).getByTestId('bill-status'));
      check('original author resumes the same work under the new bill, completes after reload and consumes it once');

      for (const name of ['paused', 'orphan', 'forbidden']) {
        const data = await fixture(name); await selectPiece();
        assert.deepEqual(entry(await saved()).piece, entry(data).piece);
        if (name === 'forbidden') assert.equal(await details().getByTestId('unfinished-forbid').getAttribute('aria-pressed'), 'true');
      }
      await fixture('final'); assert.equal(entry(await saved()), undefined); await selectBench();
      assert.equal(billOf(await saved(), campaign.newBillId).remaining, 0);
      check('all ordinary-command lifecycle checkpoints import unchanged and expose their matching state');
      await Promise.all(assetReads);
      assert(result.assets.length > 0 && result.assets.every(asset => asset.status === 200 && asset.matchesLocalBuild));
      assert.deepEqual(result.errors, []); check('no runtime errors; every observed JS/CSS asset matches the local build');
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.failure = error.stack ?? String(error);
      const data = await saved().catch(() => null);
      if (data) result.failureState = { tick: data.tick, items: stableItems(data), jobs: data.jobs.filter(job => job.unfinishedId),
        pawns: data.pawns.map(({ id, phase, reason, jobId }) => ({ id, phase, reason, jobId })) };
      await shot('failure').catch(() => {}); throw error;
    } finally { await context.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await browser.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
