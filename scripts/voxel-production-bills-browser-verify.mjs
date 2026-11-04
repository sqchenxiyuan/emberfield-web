import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:4197/?world=voxel';
const INPUT = process.env.VOXEL_PRODUCTION_BILLS_OUT ?? 'test-results/voxel-production-bills-campaign';
const OUT = process.env.VOXEL_PRODUCTION_BILLS_BROWSER_OUT ?? 'test-results/voxel-production-bills-browser';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const campaignBytes = await readFile(`${INPUT}/report.json`), campaign = JSON.parse(campaignBytes), benchId = campaign.benchId;
assert(Number.isSafeInteger(benchId), 'The campaign must identify its real constructed crafting spot');
for (const name of ['ready', 'mid-work', 'final']) assert(campaign.checkpoints.some(entry => entry.name === name), `Missing completed campaign checkpoint: ${name}`);
await mkdir(OUT, { recursive: true });
const report = {
  status: 'running', startedAt: new Date().toISOString(), base: BASE,
  scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${INPUT}/report.json`, sha256: sha(campaignBytes), benchId },
  scope: 'Chrome Worker and main rendering. Changes use visible controls, canvas clicks, file chooser import and downloaded export only; the bridge is read through snapshot/project/exportSave. The ready branch edits an empty queue through the UI. The mid-work branch resumes an unmodified SHA-verified ordinary-command campaign save with real delivered materials and progress, never an injected fixture. Checks resource-preserving cancellation, one completed batch and remaining count, plus served asset equality with dist.',
  modes: [],
};
const queueOf = snapshot => snapshot.productionQueues.find(queue => queue.benchId === benchId);
const wood = save => [...save.items, ...save.pawns.flatMap(pawn => pawn.cargo ? [pawn.cargo] : []),
  ...save.jobs.flatMap(job => job.deliveredBatches)].filter(batch => batch.resource === 'wood').reduce((total, batch) => total + batch.amount, 0);
const groundWood = save => save.items.filter(item => item.resource === 'wood').reduce((total, item) => total + item.amount, 0);
const woodLedger = save => ({ physical: wood(save), produced: save.stats.produced.wood,
  consumed: save.stats.consumed.wood, spoiled: save.stats.spoiled.wood, destroyed: save.stats.destroyed.wood });
const woodBalance = ledger => ledger.physical + ledger.consumed + ledger.spoiled + ledger.destroyed - ledger.produced;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const mode of ['worker', 'main']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await context.newPage(), reads = [];
    const result = { mode, checks: [], errors: [], assets: [], screenshots: [], imports: [], evidence: {} }; report.modes.push(result);
    page.on('pageerror', error => result.errors.push(error.stack ?? error.message));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    page.on('response', response => {
      if (!/\/assets\/.*\.(js|css)$/.test(new URL(response.url()).pathname)) return;
      const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
      reads.push(response.body().then(async bytes => {
        asset.sha256 = sha(bytes); asset.bytes = bytes.length;
        asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
      }).catch(error => { asset.error = String(error); }));
    });
    const state = () => page.evaluate(() => window.voxel.snapshot());
    const saved = () => page.evaluate(() => window.voxel.exportSave());
    const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
    const button = name => page.getByRole('button', { name, exact: true });
    const panel = () => page.locator(`[data-testid="production-bills"][data-bench-id="${benchId}"]`);
    const row = id => panel().locator(`[data-testid="bill-row"][data-bill-id="${id}"]`);
    const bills = async () => queueOf((await state()).snapshot).bills;
    const bill = async id => (await bills()).find(bill => bill.id === id);
    const check = name => { result.checks.push(name); console.log('PASS', mode, name); };
    async function click(name) {
      await button(name).scrollIntoViewIfNeeded(); await button(name).click();
      if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
      if (/^[123]倍速$/.test(name)) await wait(speed => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
    }
    async function settle() { await page.waitForTimeout(180); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); }
    async function shot(name, locator) {
      if (locator) await locator.scrollIntoViewIfNeeded();
      await settle(); const file = `${OUT}/${mode}-${name}.png`;
      await page.screenshot({ path: file }); result.screenshots.push(file);
    }
    async function load(file, evidence) {
      const bytes = await readFile(file), data = JSON.parse(bytes);
      if (evidence) { assert.equal(sha(bytes), evidence.sha256); assert.equal(data.tick, evidence.tick); }
      result.imports.push({ file, sha256: sha(bytes), tick: data.tick, campaignCheckpoint: evidence?.name ?? null });
      await page.keyboard.press('Escape'); await click('菜单与存档');
      const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
      await button('关闭菜单').waitFor({ state: 'hidden' });
      await wait(tick => window.voxel.snapshot().snapshot.tick === tick && window.voxel.snapshot().snapshot.speed === 0, data.tick);
      await settle(); return data;
    }
    async function fixture(name) {
      const evidence = campaign.checkpoints.find(entry => entry.name === name); assert(evidence, name);
      return load(`${INPUT}/${name}.json`, evidence);
    }
    async function selectBench() {
      const bench = (await state()).snapshot.weaponBenches.find(bench => bench.id === benchId);
      assert.equal(bench?.kind, 'craftingSpot');
      await page.keyboard.press('Escape');
      while ((await state()).level !== bench.z) await click((await state()).level < bench.z ? '上移一层' : '下移一层');
      await click('查看'); await settle();
      for (const height of [.03, .14, .45, 0]) {
        const point = await page.evaluate(pos => window.voxel.project(pos), { x: bench.x, y: bench.y, z: bench.z + height });
        const box = await page.locator('canvas[aria-label="多层体素地图"]').boundingBox(); assert(box);
        for (const [dx, dy] of [[0, 0], [0, 8], [8, 0], [-8, 0], [0, -8], [12, 8], [-12, 8]]) {
          await page.mouse.click(box.x + point.x + dx, box.y + point.y + dy); await page.waitForTimeout(130);
          if (await panel().count()) { await panel().scrollIntoViewIfNeeded(); return; }
        }
      }
      throw Error(`Map click failed to select crafting spot #${benchId} at ${JSON.stringify(bench)}`);
    }
    async function modeOf(id, mode) {
      await row(id).getByLabel('账单模式', { exact: true }).selectOption(mode);
      await wait(({ benchId, id, mode }) => window.voxel.snapshot().snapshot.productionQueues.find(queue => queue.benchId === benchId)
        .bills.find(bill => bill.id === id)?.mode === mode, { benchId, id, mode });
    }
    async function number(id, label, field, value) {
      const input = row(id).getByLabel(label, { exact: true });
      await input.fill(String(value)); await input.press('Enter');
      await wait(({ benchId, id, field, value }) => window.voxel.snapshot().snapshot.productionQueues.find(queue => queue.benchId === benchId)
        .bills.find(bill => bill.id === id)?.[field] === value, { benchId, id, field, value });
    }
    async function suspended(id, value) {
      if ((await bill(id)).suspended !== value) await row(id).getByTestId('bill-suspend').click();
      await wait(({ benchId, id, value }) => window.voxel.snapshot().snapshot.productionQueues.find(queue => queue.benchId === benchId)
        .bills.find(bill => bill.id === id)?.suspended === value, { benchId, id, value });
    }
    async function roundtrip(name) {
      const before = await saved(); await click('菜单与存档');
      const download = page.waitForEvent('download'); await click('导出体素存档');
      const file = `${OUT}/${mode}-${name}-roundtrip.json`; await (await download).saveAs(file); await click('关闭菜单');
      await load(file); const after = await saved();
      assert.deepEqual(after.productionQueues, before.productionQueues);
      assert.deepEqual(after.items, before.items);
      assert.deepEqual(after.stats, before.stats);
      assert.equal(wood(after), wood(before));
      assert.deepEqual(after.jobs.filter(job => job.billId).map(({ id, billId, progress, delivered, deliveredBatches, cancelled }) =>
        ({ id, billId, progress, delivered, deliveredBatches, cancelled })), before.jobs.filter(job => job.billId)
        .map(({ id, billId, progress, delivered, deliveredBatches, cancelled }) => ({ id, billId, progress, delivered, deliveredBatches, cancelled })));
      return after;
    }
    async function runUntil(fn, arg, speed = 3) { await click(`${speed}倍速`); await wait(fn, arg); await click('暂停'); }
    try {
      const url = new URL(BASE); url.searchParams.set('world', 'voxel');
      if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
      await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await click('暂停');
      if (await button('收起指引').isVisible()) await click('收起指引');
      assert.equal((await state()).worker, mode === 'worker'); check('requested renderer is active');

      await fixture('ready'); await page.mouse.move(720, 400); await page.mouse.wheel(0, -350); await settle();
      await selectBench(); assert.equal((await bills()).length, 0); assert(await panel().getByTestId('production-bills-empty').isVisible());
      check('map-selected ordinary-play crafting spot imports with an intentionally empty queue');
      await panel().getByLabel('添加生产配方', { exact: true }).selectOption('smith:woodClub');
      for (const count of [1, 2]) {
        await panel().getByTestId('production-bill-add').click();
        await wait(({ benchId, count }) => window.voxel.snapshot().snapshot.productionQueues.find(queue => queue.benchId === benchId).bills.length === count, { benchId, count });
      }
      const initialBills = await bills(), firstId = initialBills[0].id, secondId = initialBills[1].id;
      assert.notEqual(firstId, secondId);
      assert(initialBills.every(bill => bill.recipe === 'smith:woodClub' && bill.mode === 'count' && bill.remaining === 1));
      result.evidence.createdBillIds = [firstId, secondId]; check('visible Add creates two independent bills for the same wood-club recipe');

      await number(firstId, '剩余制作次数', 'remaining', 2);
      await number(secondId, '剩余制作次数', 'remaining', 3);
      await modeOf(secondId, 'forever'); assert.equal((await bill(secondId)).mode, 'forever');
      check('visible controls set separate counts and offer continuous production');
      await row(secondId).getByRole('button', { name: '上移账单', exact: true }).click();
      await wait(({ benchId, id }) => window.voxel.snapshot().snapshot.productionQueues.find(queue => queue.benchId === benchId).bills[0].id === id, { benchId, id: secondId });
      assert.deepEqual(await panel().getByTestId('bill-row').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-bill-id'))), [secondId, firstId]);
      await row(secondId).getByRole('button', { name: '下移账单', exact: true }).click();
      await wait(({ benchId, id }) => window.voxel.snapshot().snapshot.productionQueues.find(queue => queue.benchId === benchId).bills[0].id === id, { benchId, id: firstId });
      assert.equal((await bill(firstId)).remaining, 2); assert.equal((await bill(secondId)).remaining, 3);
      check('up and down controls reorder exact bill identities without exchanging their settings');

      await modeOf(secondId, 'target'); await number(secondId, '目标库存', 'target', 8);
      // The checkbox is controlled by a Worker snapshot, so acknowledge the command
      // before asserting the DOM state instead of check()'s immediate post-click test.
      await row(secondId).getByRole('checkbox', { name: '达到目标后暂停', exact: true }).click();
      await wait(({ benchId, id }) => window.voxel.snapshot().snapshot.productionQueues.find(queue => queue.benchId === benchId)
        .bills.find(bill => bill.id === id).pauseWhenSatisfied, { benchId, id: secondId });
      assert(await row(secondId).getByRole('checkbox', { name: '达到目标后暂停', exact: true }).isChecked());
      await number(secondId, '恢复生产库存', 'resumeBelow', 6);
      await number(secondId, '目标库存', 'target', 4); assert.equal((await bill(secondId)).resumeBelow, 4);
      assert.equal(await row(secondId).getByLabel('恢复生产库存', { exact: true }).getAttribute('max'), '4');
      await number(secondId, '恢复生产库存', 'resumeBelow', 1); await suspended(secondId, true);
      assert.equal((await bill(firstId)).suspended, false);
      result.evidence.targetConfiguration = await bill(secondId);
      check('target mode stores automatic waiting and resume threshold, clamping the threshold when target decreases');
      await shot('ordered-bills', row(secondId));
      await shot('queue-overview', panel().getByTestId('production-bill-add'));
      await roundtrip('configured-queue'); await selectBench();
      assert.equal((await bill(firstId)).remaining, 2); assert.equal((await bill(secondId)).resumeBelow, 1);
      assert.equal((await bill(secondId)).pauseWhenSatisfied, true); assert.equal((await bill(secondId)).suspended, true);
      check('visible export and import preserve duplicate identities, order, modes, counts and hysteresis settings');

      await page.setViewportSize({ width: 980, height: 720 }); await settle(); await shot('compact-layout', row(secondId));
      assert(await row(secondId).getByLabel('目标库存', { exact: true }).isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot('compact-actions', row(secondId).getByTestId('bill-suspend'));
      assert(await row(secondId).getByTestId('bill-suspend').isVisible());
      check('980px layout retains editable production controls without horizontal page overflow');
      await page.setViewportSize({ width: 1440, height: 960 }); await settle();
      for (const id of [firstId, secondId]) {
        await row(id).getByRole('button', { name: '删除账单', exact: true }).click();
        await wait(({ benchId, id }) => !window.voxel.snapshot().snapshot.productionQueues.find(queue => queue.benchId === benchId)
          .bills.some(bill => bill.id === id), { benchId, id });
      }
      const emptyTick = (await state()).snapshot.tick;
      await runUntil(tick => window.voxel.snapshot().snapshot.tick >= tick + 40, emptyTick);
      assert.equal((await bills()).length, 0); assert.equal((await state()).snapshot.jobs.filter(job => job.kind === 'smith').length, 0);
      await roundtrip('empty-queue'); assert.equal((await bills()).length, 0);
      check('deleting every bill leaves an empty queue through later ticks and visible reload');

      const mid = await fixture('mid-work');
      const active = mid.jobs.find(job => job.kind === 'smith' && job.weaponKind === 'woodClub' && !job.cancelled && job.billId);
      assert(active && active.progress > 0 && active.progress < active.work, 'Use actual ordinary-play unfinished work');
      const activeId = active.billId; assert.equal((await bill(activeId)).remaining, 2);
      await selectBench(); assert(await row(activeId).getByTestId('bill-progress').isVisible());
      await runUntil(({ id, progress }) => window.voxel.snapshot().snapshot.jobs.some(job => job.id === id && job.progress > progress),
        { id: active.id, progress: active.progress }, 1);
      const beforeCancel = await saved(), jobBefore = beforeCancel.jobs.find(job => job.id === active.id);
      assert(jobBefore && jobBefore.progress > active.progress && jobBefore.progress < jobBefore.work);
      assert(jobBefore.delivered.wood > 0); assert.equal((await bill(activeId)).remaining, 2);
      result.evidence.midWork = { importTick: mid.tick, jobId: active.id, billId: activeId, importedProgress: active.progress,
        resumedProgress: jobBefore.progress, work: jobBefore.work, deliveredWood: jobBefore.delivered.wood };
      check('a SHA-verified normal campaign checkpoint visibly resumes real material-backed partial work');

      await suspended(activeId, true);
      await wait(id => !window.voxel.snapshot().snapshot.jobs.some(job => job.id === id), active.id);
      const cancelled = await saved();
      assert.equal(wood(cancelled), wood(beforeCancel));
      assert.equal(groundWood(cancelled), groundWood(beforeCancel) + jobBefore.delivered.wood);
      assert.equal(cancelled.stats.consumed.wood, beforeCancel.stats.consumed.wood);
      assert.equal(cancelled.stats.weaponsMade, beforeCancel.stats.weaponsMade);
      assert.equal((await bill(activeId)).remaining, 2); assert.equal(await row(activeId).getAttribute('data-bill-state'), 'suspended');
      result.evidence.cancellation = { beforeWood: wood(beforeCancel), afterWood: wood(cancelled),
        refundedWood: groundWood(cancelled) - groundWood(beforeCancel), remaining: (await bill(activeId)).remaining };
      await shot('suspended-refund', row(activeId));
      check('manual pause returns the delivered wood, cancels partial work and preserves both remaining iterations');

      await suspended(activeId, false);
      await runUntil(({ benchId, id }) => window.voxel.snapshot().snapshot.productionQueues.find(queue => queue.benchId === benchId)
        .bills.find(bill => bill.id === id)?.remaining === 1, { benchId, id: activeId });
      const completed = await saved();
      assert.equal((await bill(activeId)).remaining, 1);
      assert.equal(completed.stats.weaponsMade, cancelled.stats.weaponsMade + 1);
      assert.equal(completed.stats.produced.weapon, cancelled.stats.produced.weapon + 1);
      assert.equal(completed.stats.consumed.wood, cancelled.stats.consumed.wood + jobBefore.cost.wood);
      result.evidence.completion = { tick: completed.tick, remaining: 1,
        weaponDelta: completed.stats.produced.weapon - cancelled.stats.produced.weapon,
        consumedWood: completed.stats.consumed.wood - cancelled.stats.consumed.wood,
        woodLedgerBefore: woodLedger(cancelled), woodLedgerAfter: woodLedger(completed) };
      // Other ordinary colony jobs keep running while the bill is worked, including
      // chopping trees; account for their production and every recorded loss too.
      assert.equal(woodBalance(woodLedger(completed)), woodBalance(woodLedger(cancelled)));
      await shot('one-iteration-completed', row(activeId));
      check('resuming finishes one physical weapon, consumes one recipe and decrements the correct bill from two to one');
      await roundtrip('after-one-completion'); await selectBench();
      assert.equal((await bill(activeId)).remaining, 1);
      assert.equal(await row(activeId).getByLabel('剩余制作次数', { exact: true }).inputValue(), '1');
      check('visible post-completion save and reload retain remaining count and any following partial batch');

      await Promise.all(reads);
      assert(result.assets.length > 0 && result.assets.every(asset => asset.status === 200 && asset.matchesLocalBuild));
      assert.deepEqual(result.errors, []); check('no runtime errors and served asset bytes match the local build');
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.failure = error.stack ?? String(error);
      await shot('failure').catch(() => {}); throw error;
    } finally {
      await context.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    }
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack ?? String(error); throw error;
} finally {
  report.finishedAt = new Date().toISOString(); await browser.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
