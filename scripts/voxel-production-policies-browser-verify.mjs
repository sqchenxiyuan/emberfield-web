import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:4198/?world=voxel';
const INPUT = process.env.VOXEL_PRODUCTION_POLICIES_OUT ?? 'test-results/voxel-production-policies-campaign';
const OUT = process.env.VOXEL_PRODUCTION_POLICIES_BROWSER_OUT ?? 'test-results/voxel-production-policies-browser';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const campaignBytes = await readFile(`${INPUT}/report.json`), campaign = JSON.parse(campaignBytes);
assert.equal(campaign.status, 'passed', 'Run only against the completed ordinary-command campaign');
const scenarios = Object.fromEntries(['crafting', 'cooking', 'butchering'].map(name => {
  const scenario = campaign.scenarios.find(entry => entry.name === name);
  assert(scenario && Number.isSafeInteger(scenario.benchId) && typeof scenario.billId === 'string', name);
  return [name, scenario];
}));
const checkpointNames = ['craft-skill-blocked', 'craft-radius-blocked', 'craft-working', 'craft-final',
  'food-blocked', 'food-working', 'food-next-filter', 'food-final', 'butcher-blocked', 'butcher-working', 'butcher-final'];
for (const name of checkpointNames) assert(campaign.checkpoints.some(entry => entry.name === name), `Missing checkpoint: ${name}`);
for (const scenario of Object.values(scenarios)) {
  const bytes = await readFile(scenario.input);
  assert.equal(sha(bytes), scenario.inputSha256); assert.equal(JSON.parse(bytes).version, scenario.inputVersion);
}
await mkdir(OUT, { recursive: true });
const report = {
  status: 'running', startedAt: new Date().toISOString(), base: BASE,
  scriptSha256: sha(await readFile(new URL(import.meta.url))),
  campaign: { file: `${INPUT}/report.json`, sha256: sha(campaignBytes), scenarios: Object.values(scenarios).map(
    ({ name, benchId, billId, firstWorkerId, secondWorkerId, species, input, inputSha256, inputVersion }) =>
      ({ name, benchId, billId, firstWorkerId, secondWorkerId, species, input, inputSha256, inputVersion })) },
  scope: 'Chrome Worker and main rendering; actual controls, map clicks, downloaded exports and file-chooser imports only. The bridge is read only through snapshot, project and exportSave. Three independent SHA-verified ordinary-player branches are imported unchanged. Checks designated-worker and skill controls, strict 3D radius, food/carcass filters, real products and material ledgers, frozen inputs/current worker during policy edits, and execution after visible save/load. No injected resources, skills, timers, positions, terrain or game commands.',
  modes: [],
};
const queueOf = (snapshot, scenario) => snapshot.productionQueues.find(queue => queue.benchId === scenario.benchId);
const billOf = (snapshot, scenario) => queueOf(snapshot, scenario)?.bills.find(bill => bill.id === scenario.billId);
const jobsOf = (snapshot, scenario) => snapshot.jobs.filter(job => job.billId === scenario.billId && !job.cancelled);
const jobEvidence = job => {
  const { id, billId, owner, progress, work, cost, delivered, deliveredBatches, productionPolicy, cancelled } = job;
  return { id, billId, owner, progress, work, cost, delivered, deliveredBatches, productionPolicy, cancelled };
};
const persistentJobEvidence = job => {
  const { owner, ...persistent } = jobEvidence(job);
  return persistent;
};
// Match the physical accounting domains: ground, colony cargo/equipment,
// delivered inputs, and carcasses waiting for a ground cell.
function counts(save) {
  const result = Object.fromEntries(Object.keys(save.stats.produced).map(resource => [resource, 0]));
  for (const item of save.items) result[item.resource] += item.amount;
  for (const pawn of save.pawns.filter(pawn => pawn.faction === 'colony')) {
    if (pawn.cargo) result[pawn.cargo.resource] += pawn.cargo.amount;
    result.apparel += pawn.worn.length; result.weapon += pawn.weapon ? 1 : 0;
  }
  for (const job of save.jobs) for (const resource of Object.keys(result)) result[resource] += job.delivered[resource] ?? 0;
  result.carcass += save.animals.filter(animal => animal.dead).length;
  return result;
}
function ledger(save) {
  const physical = counts(save);
  return Object.fromEntries(Object.keys(physical).map(resource => [resource, {
    physical: physical[resource], produced: save.stats.produced[resource], consumed: save.stats.consumed[resource],
    spoiled: save.stats.spoiled[resource], destroyed: save.stats.destroyed[resource],
  }]));
}
function conserved(before, after) {
  const a = ledger(before), b = ledger(after);
  const balance = entry => entry.physical + entry.consumed + entry.spoiled + entry.destroyed - entry.produced;
  for (const resource of Object.keys(a)) assert.equal(balance(b[resource]), balance(a[resource]), `${resource} conservation`);
  return { before: a, after: b };
}
function assertBatchUnchanged(before, after, scenario) {
  const active = jobsOf(before, scenario).find(job => job.owner !== null && job.progress > 0);
  assert(active && active.progress < active.work, 'The checkpoint must contain genuine unfinished work');
  const retained = after.jobs.find(job => job.id === active.id);
  assert(retained, 'Editing policy must retain the current physical batch');
  assert.deepEqual(jobEvidence(retained), jobEvidence(active));
  assert.deepEqual(counts(after), counts(before)); assert.deepEqual(after.stats, before.stats);
  return jobEvidence(active);
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const mode of ['worker', 'main']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await context.newPage(), assetReads = [];
    const result = { mode, status: 'running', checks: [], errors: [], assets: [], screenshots: [], imports: [], exports: [], reloads: [], evidence: {} };
    report.modes.push(result);
    let scenario = scenarios.crafting;
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
    const panel = () => page.locator(`[data-testid="production-bills"][data-bench-id="${scenario.benchId}"]`);
    const row = () => panel().locator(`[data-testid="bill-row"][data-bill-id="${scenario.billId}"]`);
    const settings = () => row().getByTestId('bill-policy');
    const bill = async () => billOf((await state()).snapshot, scenario);
    const check = name => { result.checks.push(name); console.log('PASS', mode, name); };
    async function click(name) {
      await button(name).scrollIntoViewIfNeeded(); await button(name).click();
      if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
      if (/^[123]倍速$/.test(name)) await wait(speed => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
    }
    async function settle() { await page.waitForTimeout(180); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); }
    async function reachable(locator) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.evaluate(element => {
        const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        const top = document.elementFromPoint(x, y);
        return { x, y, width: r.width, height: r.height, inViewport: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
          hit: top === element || element.contains(top) };
      });
      assert(box.inViewport && box.hit && box.width > 0 && box.height > 0, `Control is not reachable: ${JSON.stringify(box)}`);
      return box;
    }
    async function shot(name, locator) {
      if (locator) await reachable(locator);
      await settle(); const file = `${OUT}/${mode}-${name}.png`;
      await page.screenshot({ path: file }); result.screenshots.push(file);
    }
    async function load(file, checkpoint) {
      const bytes = await readFile(file), data = JSON.parse(bytes);
      if (checkpoint) { assert.equal(sha(bytes), checkpoint.sha256); assert.equal(data.tick, checkpoint.tick); }
      result.imports.push({ file, sha256: sha(bytes), version: data.version, tick: data.tick, checkpoint: checkpoint?.name ?? null });
      await page.keyboard.press('Escape'); await click('菜单与存档');
      const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
      await button('关闭菜单').waitFor({ state: 'hidden' });
      await wait(tick => window.voxel.snapshot().snapshot.tick === tick && window.voxel.snapshot().snapshot.speed === 0, data.tick);
      await settle(); return data;
    }
    async function fixture(name) {
      const checkpoint = campaign.checkpoints.find(entry => entry.name === name); assert(checkpoint, name);
      scenario = scenarios[checkpoint.scenario]; assert(scenario, checkpoint.scenario);
      const data = await load(checkpoint.path, checkpoint);
      assert.equal(data.version, 42); assert(billOf(data, scenario));
      await selectBench(); return data;
    }
    async function selectBench() {
      const snapshot = (await state()).snapshot;
      const bench = [...snapshot.weaponBenches, ...snapshot.stoves, ...snapshot.butcherSpots].find(value => value.id === scenario.benchId);
      assert(bench, `Missing constructed workbench #${scenario.benchId}`);
      await page.keyboard.press('Escape');
      while ((await state()).level !== bench.z) await click((await state()).level < bench.z ? '上移一层' : '下移一层');
      await click('查看'); await settle();
      for (let attempt = 0; attempt < 2; attempt++) {
        for (const height of [.03, .14, .45, .7, 0]) {
          const point = await page.evaluate(pos => window.voxel.project(pos), { x: bench.x, y: bench.y, z: bench.z + height });
          const box = await page.locator('canvas[aria-label="多层体素地图"]').boundingBox(); assert(box);
          for (const [dx, dy] of [[0, 0], [0, 8], [8, 0], [-8, 0], [0, -8], [12, 8], [-12, 8]]) {
            const x = box.x + point.x + dx, y = box.y + point.y + dy;
            if (!await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', { x, y })) continue;
            await page.mouse.click(x, y); await page.waitForTimeout(130);
            if (await panel().count()) return;
          }
        }
        await page.mouse.move(720, 400); await page.mouse.wheel(0, 250); await settle();
      }
      throw Error(`Visible map clicks did not select ${scenario.name} bench ${JSON.stringify(bench)}`);
    }
    async function expand() {
      if (await settings().getAttribute('open') === null) await settings().locator('summary').click();
      await settings().getByLabel('账单执行工人', { exact: true }).waitFor({ state: 'visible' });
    }
    async function waitPolicy(field, value) {
      await wait(({ benchId, billId, field, value }) => {
        const bill = window.voxel.snapshot().snapshot.productionQueues.find(queue => queue.benchId === benchId)?.bills.find(bill => bill.id === billId);
        return JSON.stringify(bill?.policy[field]) === JSON.stringify(value);
      }, { benchId: scenario.benchId, billId: scenario.billId, field, value });
    }
    async function number(label, field, value) {
      const input = settings().getByLabel(label, { exact: true });
      await input.fill(String(value)); await input.press('Enter'); await waitPolicy(field, value);
    }
    async function worker(id) {
      await settings().getByLabel('账单执行工人', { exact: true }).selectOption(id === null ? 'any' : String(id));
      await waitPolicy('workerId', id);
    }
    async function radius(value) {
      const input = settings().getByLabel('取料范围', { exact: true });
      if (value === null) { await input.selectOption('unlimited'); await waitPolicy('ingredientRadius', null); return; }
      if ((await bill()).policy.ingredientRadius === null) {
        await input.selectOption('radius'); await waitPolicy('ingredientRadius', 100);
      }
      await number('原料搜索半径', 'ingredientRadius', value);
    }
    async function allow(label, field, value, enabled) {
      const checkbox = settings().getByRole('checkbox', { name: label, exact: true });
      const previous = (await bill()).policy[field];
      if (previous.includes(value) !== enabled) await checkbox.click();
      await wait(({ benchId, billId, field, value, enabled }) => window.voxel.snapshot().snapshot.productionQueues
        .find(queue => queue.benchId === benchId)?.bills.find(bill => bill.id === billId)?.policy[field].includes(value) === enabled,
      { benchId: scenario.benchId, billId: scenario.billId, field, value, enabled });
      assert.equal(await checkbox.isChecked(), enabled);
    }
    async function roundtrip(name) {
      const before = await saved(); await click('菜单与存档');
      const download = page.waitForEvent('download'); await click('导出体素存档');
      const file = `${OUT}/${mode}-${name}-roundtrip.json`; await (await download).saveAs(file); await click('关闭菜单');
      const bytes = await readFile(file); result.exports.push({ file, sha256: sha(bytes), tick: before.tick });
      await load(file); const after = await saved();
      assert.equal(after.version, 42); assert.deepEqual(after.productionQueues, before.productionQueues);
      assert.deepEqual(after.items, before.items); assert.deepEqual(after.stats, before.stats); assert.deepEqual(counts(after), counts(before));
      // Paths and ordinary worker assignments are rebuilt on load. Frozen
      // ingredient rules, delivered material and completed work are persistent.
      assert.deepEqual(after.jobs.filter(job => job.billId).map(persistentJobEvidence), before.jobs.filter(job => job.billId).map(persistentJobEvidence));
      assert.deepEqual(after.pawns.map(({ id, cargo }) => ({ id, cargo })), before.pawns.map(({ id, cargo }) => ({ id, cargo })));
      result.reloads.push({ name, tick: after.tick, owners: before.jobs.filter(job => job.billId).map(job =>
        ({ jobId: job.id, before: job.owner, after: after.jobs.find(value => value.id === job.id)?.owner })) });
      await selectBench(); await expand(); return after;
    }
    async function runUntil(fn, arg, speed = 3) {
      await click(`${speed}倍速`);
      try { await wait(fn, arg); } finally { await click('暂停'); }
    }
    async function runFor(ticks) {
      const start = (await state()).snapshot.tick;
      await runUntil(tick => window.voxel.snapshot().snapshot.tick >= tick, start + ticks);
    }
    async function working(owner, previous) {
      await runUntil(({ billId, owner, jobId, progress }) => window.voxel.snapshot().snapshot.jobs.some(job => job.billId === billId && !job.cancelled
        && job.owner !== null && (owner === undefined || job.owner === owner) && (jobId === undefined || job.id === jobId)
        && job.progress > progress), { billId: scenario.billId, owner, jobId: previous?.id, progress: previous?.progress ?? 0 }, 1);
      const data = await saved(), job = jobsOf(data, scenario).find(job => job.owner !== null && job.progress > 0);
      assert(job && job.progress < job.work && job.productionPolicy, 'Capture real physical work before its completion');
      return { data, job };
    }
    async function remaining(value) {
      await runUntil(({ benchId, billId, value }) => window.voxel.snapshot().snapshot.productionQueues
        .find(queue => queue.benchId === benchId)?.bills.find(bill => bill.id === billId)?.remaining === value,
      { benchId: scenario.benchId, billId: scenario.billId, value });
      assert.equal((await bill()).remaining, value); return saved();
    }
    function noWorker(data) { assert(!jobsOf(data, scenario).some(job => job.owner !== null), 'Disallowed work must have no assigned worker'); }
    try {
      const url = new URL(BASE); url.searchParams.set('world', 'voxel');
      if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
      await page.goto(url.href); await wait(() => window.voxel?.snapshot().ready && !!window.voxel.snapshot().snapshot); await click('暂停');
      if (await button('收起指引').isVisible()) await click('收起指引');
      assert.equal((await state()).worker, mode === 'worker'); check('requested rendering path is active');

      const skillStart = await fixture('craft-skill-blocked');
      assert.equal(await settings().getAttribute('open'), null); await expand();
      const workers = (await state()).snapshot.pawns.filter(pawn => pawn.faction === 'colony' && !pawn.dead);
      const workerOptions = await settings().getByLabel('账单执行工人', { exact: true }).locator('option')
        .evaluateAll(options => options.map(option => ({ value: option.value, text: option.textContent })));
      assert.deepEqual(workerOptions.map(option => option.value), ['any', ...workers.map(pawn => String(pawn.id))]);
      for (const pawn of workers) {
        const text = workerOptions.find(option => option.value === String(pawn.id)).text;
        assert(text.includes(pawn.name) && text.includes(`工艺 ${pawn.skills.crafting.level} 级`));
        assert.equal(text.includes('未开启加工'), pawn.priorities.craft === 0);
      }
      await number('最低技能等级', 'skillMin', 4); await number('最高技能等级', 'skillMax', 6);
      assert.deepEqual([(await bill()).policy.skillMin, (await bill()).policy.skillMax], [4, 6]);
      await number('最高技能等级', 'skillMax', 20); await number('最低技能等级', 'skillMin', 20);
      await worker(scenario.firstWorkerId); assert.equal(await settings().getByLabel('最低技能等级', { exact: true }).count(), 0);
      await worker(null); assert.equal(await settings().getByLabel('最低技能等级', { exact: true }).inputValue(), '20');
      assert.equal(await settings().getByTestId('bill-fixed-ingredients').count(), 1);
      assert.equal(await settings().getByTestId('bill-food-filter').count(), 0);
      assert.equal(await settings().getByTestId('bill-carcass-filter').count(), 0);
      await runFor(60); const skillBlocked = await saved(); noWorker(skillBlocked);
      assert.equal(billOf(skillBlocked, scenario).remaining, 2); conserved(skillStart, skillBlocked);
      result.evidence.workerOptions = workerOptions;
      await shot('craft-worker-skills', settings().getByLabel('最低技能等级', { exact: true }));
      check('visible worker and skill controls retain their interval, list real colony workers and block unqualified crafting');

      await page.setViewportSize({ width: 980, height: 720 }); await settle();
      await shot('compact-worker-skills', settings().getByLabel('账单执行工人', { exact: true }));
      await radius(3); await shot('compact-radius', settings().getByLabel('原料搜索半径', { exact: true }));
      assert((await settings().getByTestId('bill-policy-radius-note').innerText()).includes('三维直线距离小于 3'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await reachable(settings().getByLabel('最低技能等级', { exact: true }));
      await reachable(settings().getByLabel('最高技能等级', { exact: true }));
      await page.setViewportSize({ width: 1440, height: 960 }); await settle();
      check('980px policy controls remain reachable by vertical scrolling with no horizontal overflow');

      const radiusStart = await fixture('craft-radius-blocked'); await expand();
      assert.equal((await bill()).policy.workerId, scenario.firstWorkerId); assert.equal((await bill()).policy.ingredientRadius, 3);
      await roundtrip('craft-radius-blocked'); await runFor(40);
      noWorker(await saved()); assert.equal((await bill()).remaining, 2);
      await radius(100); const expandedWork = await working(scenario.firstWorkerId);
      assert.equal(expandedWork.job.productionPolicy.ingredientRadius, 100); assert.equal(expandedWork.job.delivered.wood, 40);
      const radiusFinished = await remaining(1);
      assert.equal(radiusFinished.stats.produced.weapon, radiusStart.stats.produced.weapon + 1);
      assert.equal(radiusFinished.stats.consumed.wood, radiusStart.stats.consumed.wood + 40);
      result.evidence.radiusUnlock = { workerId: scenario.firstWorkerId, job: jobEvidence(expandedWork.job),
        remaining: 1, ledger: conserved(radiusStart, radiusFinished) };
      await shot('craft-radius-unlocked', settings().getByLabel('原料搜索半径', { exact: true }));
      check('visible radius expansion unlocks real wood delivery and a designated worker produces one physical weapon');

      const craftImported = await fixture('craft-working'); await expand();
      const originalCraft = jobsOf(craftImported, scenario).find(job => job.owner === scenario.firstWorkerId && job.progress > 0); assert(originalCraft);
      const craftWorking = (await working(scenario.firstWorkerId, originalCraft)).data;
      await worker(scenario.secondWorkerId); await radius(3);
      const retainedCraft = assertBatchUnchanged(craftWorking, await saved(), scenario);
      await roundtrip('craft-current-worker');
      const rejoinedCraft = await working(scenario.secondWorkerId, retainedCraft);
      assert.equal(rejoinedCraft.job.id, retainedCraft.id);
      assert.deepEqual(rejoinedCraft.job.productionPolicy, retainedCraft.productionPolicy);
      assert.deepEqual(rejoinedCraft.job.deliveredBatches, retainedCraft.deliveredBatches);
      const firstFinished = await remaining(1);
      assert.equal(firstFinished.stats.produced.weapon, craftWorking.stats.produced.weapon + 1);
      assert.equal(firstFinished.stats.consumed.wood, craftWorking.stats.consumed.wood + 40);
      conserved(craftWorking, firstFinished);
      result.evidence.retainedCraft = { original: retainedCraft, afterReload: jobEvidence(rejoinedCraft.job),
        desiredPolicy: (await bill()).policy, completedTick: firstFinished.tick };
      check('live policy edits keep the current worker; reloading reassigns the same preserved inputs to the newly allowed worker');

      await runFor(40); noWorker(await saved());
      const restrictedCraft = await roundtrip('craft-next-worker'); await runFor(40); noWorker(await saved());
      assert.equal((await bill()).policy.workerId, scenario.secondWorkerId); assert.equal((await bill()).policy.ingredientRadius, 3);
      assert.equal((await bill()).remaining, 1);
      await radius(null); const secondWork = await working(scenario.secondWorkerId), secondFinished = await remaining(0);
      assert.equal(secondWork.job.productionPolicy.workerId, scenario.secondWorkerId);
      assert.equal(secondWork.job.productionPolicy.ingredientRadius, null);
      assert.equal(secondFinished.stats.produced.weapon, restrictedCraft.stats.produced.weapon + 1);
      assert.equal(secondFinished.stats.consumed.wood, restrictedCraft.stats.consumed.wood + 40);
      result.evidence.nextCraft = { job: jobEvidence(secondWork.job), remaining: 0, ledger: conserved(craftWorking, secondFinished) };
      check('reloaded next-batch restrictions remain enforced until the radius is lifted and the second named worker finishes');

      const foodBlocked = await fixture('food-blocked'); await expand();
      assert.deepEqual((await bill()).policy.allowedFood, []);
      assert(await settings().getByTestId('bill-policy-empty-ingredients').isVisible());
      const foodOptions = await settings().getByTestId('bill-food-filter').getByRole('checkbox').all(); assert.equal(foodOptions.length, 2);
      for (const checkbox of foodOptions) assert.equal(await checkbox.isChecked(), false);
      await runFor(40); noWorker(await saved()); assert.equal((await bill()).remaining, 2);
      await shot('food-empty-filter', settings().getByTestId('bill-food-filter').getByRole('checkbox').first());
      await allow('允许谷物', 'allowedFood', 'grain', true);
      const grainWork = await working(), foodFirst = await remaining(1);
      assert.equal(grainWork.job.cost.grain, 10); assert.equal(grainWork.job.cost.meat ?? 0, 0);
      assert.equal(grainWork.job.delivered.grain, 10); assert.deepEqual(grainWork.job.productionPolicy.allowedFood, ['grain']);
      assert.equal(foodFirst.stats.produced.meal, foodBlocked.stats.produced.meal + 1);
      // The selected batch must use exactly ten grain; colonists may also eat
      // while it is worked, so global consumption can legitimately be higher.
      assert(foodFirst.stats.consumed.grain >= foodBlocked.stats.consumed.grain + 10);
      result.evidence.foodUnlock = { job: jobEvidence(grainWork.job), remaining: 1, ledger: conserved(foodBlocked, foodFirst) };
      check('enabling grain through the empty food filter delivers real grain and cooks one meal');

      const foodImported = await fixture('food-working'); await expand();
      const originalMeal = jobsOf(foodImported, scenario).find(job => job.owner !== null && job.progress > 0); assert(originalMeal);
      const foodWorking = (await working(undefined, originalMeal)).data;
      await allow('允许谷物', 'allowedFood', 'grain', false);
      assert(await settings().getByTestId('bill-policy-empty-ingredients').isVisible());
      await allow('允许生肉', 'allowedFood', 'meat', true);
      const retainedMeal = assertBatchUnchanged(foodWorking, await saved(), scenario);
      assert.deepEqual(retainedMeal.productionPolicy.allowedFood, ['grain']);
      assert.equal(retainedMeal.cost.grain, 10); assert.equal(retainedMeal.delivered.grain, 10);
      await roundtrip('food-current-grain'); const keptMeal = await remaining(1);
      assert.equal(keptMeal.stats.produced.meal, foodWorking.stats.produced.meal + 1);
      assert(keptMeal.stats.consumed.grain >= foodWorking.stats.consumed.grain + 10); conserved(foodWorking, keptMeal);
      result.evidence.retainedMeal = { original: retainedMeal, desiredPolicy: (await bill()).policy, completedTick: keptMeal.tick };
      check('changing a working grain bill to meat-only preserves its selected grain batch across visible save and reload');

      await runFor(40); noWorker(await saved()); const meatOnly = await roundtrip('food-next-meat');
      await runFor(60); const meatWaiting = await saved(); noWorker(meatWaiting);
      assert.deepEqual((await bill()).policy.allowedFood, ['meat']); assert.equal((await bill()).remaining, 1);
      assert.equal(meatWaiting.stats.produced.meal, meatOnly.stats.produced.meal);
      assert(jobsOf(meatWaiting, scenario).every(job => (job.cost.grain ?? 0) === 0 && (job.delivered.grain ?? 0) === 0));
      result.evidence.nextFoodFilter = { remaining: 1, policy: (await bill()).policy,
        ordinaryGrainConsumption: meatWaiting.stats.consumed.grain - meatOnly.stats.consumed.grain,
        ledger: conserved(meatOnly, meatWaiting) };
      await shot('food-next-meat-only', settings().getByRole('checkbox', { name: '允许生肉', exact: true }));
      check('the reloaded meat-only next batch waits without taking the colony grain');

      const butcherBlocked = await fixture('butcher-blocked'); await expand();
      const species = scenario.species, speciesNames = { hare: '野兔', deer: '鹿' }, speciesLabel = `允许${speciesNames[species]}尸体`;
      assert(speciesNames[species]); assert.deepEqual((await bill()).policy.allowedCarcasses, []);
      const carcassOptions = await settings().getByTestId('bill-carcass-filter').getByRole('checkbox').all(); assert.equal(carcassOptions.length, 2);
      for (const checkbox of carcassOptions) assert.equal(await checkbox.isChecked(), false);
      assert(await settings().getByTestId('bill-policy-empty-ingredients').isVisible());
      await runFor(40); noWorker(await saved());
      await allow(speciesLabel, 'allowedCarcasses', species, true);
      const butcherWork = await working(), butcherFirst = await remaining(0);
      assert(butcherWork.job.deliveredBatches.some(batch => batch.carcass?.species === species));
      assert.deepEqual(butcherWork.job.productionPolicy.allowedCarcasses, [species]);
      assert.equal(butcherFirst.stats.consumed.carcass, butcherBlocked.stats.consumed.carcass + 1);
      assert(butcherFirst.stats.produced.meat > butcherBlocked.stats.produced.meat);
      result.evidence.butcherUnlock = { species, job: jobEvidence(butcherWork.job), remaining: 0,
        meatProduced: butcherFirst.stats.produced.meat - butcherBlocked.stats.produced.meat, ledger: conserved(butcherBlocked, butcherFirst) };
      await shot('butcher-allowed-species', settings().getByRole('checkbox', { name: speciesLabel, exact: true }));
      check('enabling the existing carcass species physically delivers one carcass and produces meat');

      const butcherImported = await fixture('butcher-working'); await expand();
      const originalCarcass = jobsOf(butcherImported, scenario).find(job => job.owner !== null && job.progress > 0); assert(originalCarcass);
      const butcherWorking = (await working(undefined, originalCarcass)).data;
      await allow(speciesLabel, 'allowedCarcasses', species, false);
      assert.deepEqual((await bill()).policy.allowedCarcasses, []);
      const retainedCarcass = assertBatchUnchanged(butcherWorking, await saved(), scenario);
      await roundtrip('butcher-current-carcass'); const keptCarcass = await remaining(0);
      assert.equal(keptCarcass.stats.consumed.carcass, butcherWorking.stats.consumed.carcass + 1);
      assert(keptCarcass.stats.produced.meat > butcherWorking.stats.produced.meat);
      await roundtrip('butcher-finished-empty'); assert.deepEqual((await bill()).policy.allowedCarcasses, []);
      result.evidence.retainedCarcass = { original: retainedCarcass, desiredPolicy: (await bill()).policy,
        meatProduced: keptCarcass.stats.produced.meat - butcherWorking.stats.produced.meat, ledger: conserved(butcherWorking, keptCarcass) };
      await shot('butcher-cleared-filter', settings().getByRole('checkbox', { name: speciesLabel, exact: true }));
      check('clearing carcass permissions keeps selected material and finishes the current batch after visible reload');

      await Promise.all(assetReads);
      assert(result.assets.length > 0 && result.assets.every(asset => asset.status === 200 && asset.matchesLocalBuild));
      assert.deepEqual(result.errors, []); check('no runtime errors and every observed served JS/CSS asset matches dist');
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.failure = error.stack ?? String(error);
      const data = await saved().catch(() => null);
      if (data) result.failureState = { tick: data.tick, scenario: scenario.name, bill: billOf(data, scenario),
        jobs: jobsOf(data, scenario).map(jobEvidence), pawns: data.pawns.map(({ id, name, phase, reason, jobId }) => ({ id, name, phase, reason, jobId })) };
      await shot('failure').catch(() => {}); throw error;
    } finally {
      await context.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    }
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally {
  report.finishedAt = new Date().toISOString(); await browser.close(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
