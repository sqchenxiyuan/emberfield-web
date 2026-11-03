import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_STORYTELLER_URL ?? process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_STORYTELLER_BROWSER_OUT ?? 'test-results/voxel-storyteller-browser';
const FIXTURES = process.env.VOXEL_STORYTELLER_OUT ?? 'test-results/voxel-storyteller-exploratory';
const preparedOnly = process.argv.includes('--prepared-only');
const modes = process.env.VOXEL_STORYTELLER_BROWSER_MODE ? [process.env.VOXEL_STORYTELLER_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every((mode) => ['worker', 'main'].includes(mode)));
await mkdir(OUT, { recursive: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const executedBytes = await readFile(new URL(import.meta.url));
const execution = { script: `${OUT}/executed-browser.mjs`, sha256: sha(executedBytes) };
await writeFile(execution.script, executedBytes, { flag: 'wx' });
const campaignBytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(campaignBytes);
assert(campaign.status === 'passed' || (preparedOnly && campaign.fixtures.armed), 'full browser evidence requires a passed actual campaign; prepared-only is explicitly preliminary');
assert.equal(sha(await readFile(campaign.execution.bundle)), campaign.execution.sha256);
assert.equal(sha(await readFile(campaign.execution.script)), campaign.execution.scriptSha256);
const legacy = [];
for (const name of ['working', 'scheduled', 'combat', 'carrying', 'tending', 'infected', 'downed', 'death']) {
  const file = `tests/fixtures/voxel-v19-storyteller-${name}.json`;
  const provenanceFile = file.replace(/\.json$/, '.provenance.json');
  const provenance = JSON.parse(await readFile(provenanceFile, 'utf8'));
  const bytes = await readFile(file), save = JSON.parse(bytes);
  assert.equal(save.version, 19); assert.equal(provenance.version, 19);
  assert.equal(provenance.loadedByOriginalSource, true);
  assert.equal(sha(bytes), provenance.sha256); assert.equal(save.tick, provenance.tick);
  legacy.push({ name, file, provenanceFile, ...provenance });
}
const report = {
  startedAt: new Date().toISOString(), base: BASE, preparedOnly, execution,
  scope: 'Headless Chrome with Worker and main renderers. All mutations use visible buttons/selects/checkboxes and file chooser import/export. snapshot/project/exportSave are read-only observations. No hidden simulation commands, injected wealth or events. Genuine v19 fixtures and ordinary v20 campaign files are hash-gated; served asset bytes must match the local production build.',
  campaign: { file: `${FIXTURES}/report.json`, sha256: sha(campaignBytes), formal: campaign.formal, coverage: campaign.coverage, execution: campaign.execution },
  legacy, modes: [],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function verify(mode) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), url = new URL(BASE);
  url.searchParams.set('world', 'voxel');
  if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
  const result = { mode, checks: [], fixtures: [], screenshots: [], assets: [], errors: [], skipped: [] };
  report.modes.push(result);
  const reads = [];
  page.on('pageerror', (error) => result.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') result.errors.push(message.text()); });
  page.on('response', (response) => {
    if (!new URL(response.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
    reads.push(response.body().then(async (bytes) => {
      asset.bytes = bytes.length; asset.sha256 = sha(bytes);
      asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
    }).catch((error) => { asset.error = String(error); }));
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const exported = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = (name) => page.getByRole('button', { name, exact: true });
  async function click(name) {
    const target = button(name); await target.scrollIntoViewIfNeeded(); await target.click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    if (/^[123]倍速$/.test(name)) await wait((speed) => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
  }
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  async function settle() { await page.waitForTimeout(250); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); }
  async function shot(name) {
    if (name !== 'failure') await page.locator('.voxel-toast').waitFor({ state: 'hidden', timeout: 10000 });
    const file = `${OUT}/${mode}-${name}.png`, bytes = await page.screenshot({ path: file });
    result.screenshots.push({ file, sha256: sha(bytes) });
  }
  async function menu() { if (!(await page.getByRole('dialog').isVisible())) await click('菜单与存档'); }
  async function closeMenu() { if (await page.getByRole('dialog').isVisible()) await click('关闭菜单'); }
  async function details() {
    await menu();
    const panel = page.getByTestId('storyteller-details');
    if (!(await panel.evaluate((node) => node.open))) await panel.locator('summary').click();
    await panel.scrollIntoViewIfNeeded();
  }
  async function loadFile(file, hash) {
    const bytes = await readFile(file), save = JSON.parse(bytes);
    if (hash) assert.equal(sha(bytes), hash);
    result.fixtures.push({ file, sha256: sha(bytes), version: save.version, tick: save.tick });
    await menu(); const chooser = page.waitForEvent('filechooser');
    await click('导入体素存档'); await (await chooser).setFiles(file);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait((tick) => window.voxel.snapshot().snapshot.tick === tick, save.tick);
    await settle(); return save;
  }
  async function load(name) {
    const fixture = campaign.fixtures[name]; assert(fixture, `actual campaign fixture ${name}`);
    return loadFile(fixture.file, fixture.sha256);
  }
  async function difficulty(value) {
    await menu(); const select = page.getByLabel('叙事难度', { exact: true });
    await select.scrollIntoViewIfNeeded(); await select.selectOption(value);
    await wait((value) => window.voxel.snapshot().snapshot.storyteller.difficulty === value, value);
  }
  async function threats(enabled) {
    await menu(); const input = page.getByLabel('允许袭击', { exact: true });
    if (await input.isChecked() !== enabled) { await input.scrollIntoViewIfNeeded(); await input.click(); }
    await wait((enabled) => window.voxel.snapshot().snapshot.combat.enabled === enabled, enabled);
  }
  async function advance(ticks) {
    await closeMenu(); const start = (await state()).snapshot.tick;
    await click('3倍速'); await wait((end) => window.voxel.snapshot().snapshot.tick >= end, start + ticks); await click('暂停');
  }
  async function visibleExport(name) {
    await menu(); const download = page.waitForEvent('download'); await click('导出体素存档');
    const file = `${OUT}/${mode}-${name}.json`; await (await download).saveAs(file);
    return { file, data: JSON.parse(await readFile(file, 'utf8')) };
  }
  const calendar = (story) => ({ lastInterval: story.lastInterval, cycle: story.cycle, cycleHits: story.cycleHits, introHandled: story.introHandled, legacyRaidAt: story.legacyRaidAt });
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot !== null);
    await click('暂停'); if (await button('收起指引').isVisible()) await click('收起指引'); await settle();
    assert.equal((await state()).worker, mode === 'worker');
    for (const fixture of legacy) {
      const old = await loadFile(fixture.file, fixture.sha256), current = await exported();
      assert.equal(current.version, 20);
      for (const field of ['tick', 'blocks', 'ladders', 'items', 'research', 'nextId', 'projectiles', 'combatEvents', 'sandbags', 'stats']) assert.deepEqual(current[field], old[field], `v19 ${fixture.name} ${field}`);
      for (const job of old.jobs) {
        const next = current.jobs.find((j) => j.id === job.id); assert(next);
        for (const field of ['kind', 'x', 'y', 'z', 'cost', 'delivered', 'deliveredFood', 'progress', 'work', 'workTicks', 'weaponKind', 'weaponBenchKind', 'apparelKind']) assert.deepEqual(next[field], job[field]);
      }
      for (const pawn of old.pawns) {
        const next = current.pawns.find((p) => p.id === pawn.id); assert(next);
        for (const field of ['x', 'y', 'z', 'trauma', 'health', 'medical', 'skills', 'weapon', 'worn', 'cargo', 'shooting', 'nextAttackTick', 'dead', 'downed', 'carePhase', 'careProgress']) assert.deepEqual(next[field], pawn[field]);
      }
      assert.equal(current.storyteller.legacyRaidAt, old.combat.enabled ? old.combat.nextRaid : null);
      if (old.combat.enabled) assert.equal((await state()).snapshot.storyteller.nextOpportunity, old.combat.nextRaid);
      assert.deepEqual(current.storyteller.losses, [], 'legacy injuries/deaths do not create new loss charges on import');
      assert.equal(current.storyteller.adaptationDays, 0);
      if (['working', 'combat'].includes(fixture.name)) {
        await details(); await page.getByTestId('wealth-breakdown').scrollIntoViewIfNeeded();
        assert(await page.getByTestId('legacy-structure-note').isVisible());
        await shot(`v19-${fixture.name}`);
      }
      check(`authentic v19 ${fixture.name} preserves physical state and initializes the calendar without retroactive losses`, { sha256: fixture.sha256 });
    }
    const armed = await load('armed'); await details();
    let snapshot = (await state()).snapshot;
    assert(snapshot.storyteller.threat.totalWealth > campaign.initialThreat.totalWealth);
    const text = await page.getByTestId('wealth-breakdown').innerText();
    for (const label of ['物品', '建筑', '殖民者', '总财富', '叙事财富']) assert(text.includes(label));
    assert((await page.getByTestId('storyteller-details').innerText()).includes('不是交易报价'));
    assert.equal(snapshot.storyteller.legacyStructureCells, 0);
    await page.getByTestId('wealth-breakdown').scrollIntoViewIfNeeded(); await shot('expanded-wealth');
    check('ordinary expansion displays actual item, building and pawn wealth without legacy estimation');

    const beforeDifficulty = await exported(), difficultyResults = [];
    for (const value of ['peaceful', 'easy', 'medium', 'rough', 'hard', 'extreme']) {
      await difficulty(value); snapshot = (await state()).snapshot;
      difficultyResults.push({ difficulty: value, threat: snapshot.storyteller.threat });
      assert.deepEqual(calendar(snapshot.storyteller), calendar(beforeDifficulty.storyteller));
      assert.deepEqual((await exported()).items, beforeDifficulty.items);
    }
    assert.equal(await page.getByLabel('叙事难度').locator('option').count(), 6);
    result.difficultyResults = difficultyResults;
    check('six actual difficulty controls change threat factors while preserving assets and calendar');

    await difficulty('peaceful'); await threats(true);
    assert((await page.getByTestId('storyteller-opportunity').innerText()).includes('和平难度不安排袭击'));
    assert.equal((await state()).snapshot.storyteller.nextOpportunity, null);
    await page.getByTestId('threat-controls').scrollIntoViewIfNeeded(); await shot('peaceful');
    check('peaceful difficulty visibly disables raid opportunities even with the threat switch enabled');
    if (preparedOnly) {
      await Promise.all(reads);
      assert(result.assets.length > 0 && result.assets.every((a) => a.status === 200 && a.matchesLocalBuild));
      assert.deepEqual(result.errors, []);
      result.skipped.push('Prepared-only preflight: no current encounter, injury, recovery, or final campaign acceptance is claimed.');
      result.status = 'passed'; return;
    }

    const ready = await load('event-ready'); await menu();
    const original = (await state()).snapshot.storyteller;
    await threats(false); await threats(true);
    const toggled = (await state()).snapshot.storyteller;
    assert.deepEqual(calendar(toggled), calendar(original));
    assert.equal(toggled.nextOpportunity, original.nextOpportunity);
    assert(!(await page.getByTestId('threat-controls').innerText()).includes('三天准备'));
    assert((await page.getByTestId('storyteller-opportunity').innerText()).includes('机会'));
    await shot('calendar');
    check('visible off/on does not reset the scheduled opportunity or promise a guaranteed raid');

    await threats(false);
    const untilOpportunity = original.nextOpportunity - ready.tick;
    assert(untilOpportunity >= 0 && untilOpportunity <= 200, 'campaign retained an ordinary near-opportunity save');
    await advance(untilOpportunity + 20);
    const missed = (await state()).snapshot.storyteller.events.find((e) => e.tick === original.nextOpportunity);
    assert(missed && missed.outcome === 'skipped' && missed.members.length === 0);
    await threats(true); await advance(40);
    assert.equal((await state()).snapshot.storyteller.events.filter((e) => e.tick === missed.tick).length, 1);
    assert(!(await state()).snapshot.pawns.some((p) => p.faction === 'raider' && !p.dead && !p.downed));
    await details(); await page.getByTestId('storyteller-events').scrollIntoViewIfNeeded(); await shot('missed-event');
    const missedExport = await visibleExport('missed-export');
    await loadFile(missedExport.file, sha(await readFile(missedExport.file)));
    assert.deepEqual((await exported()).storyteller, missedExport.data.storyteller);
    check('a disabled calendar opportunity is skipped once and survives visible export/import without catch-up spawning');

    await load('event-ready'); await advance(untilOpportunity + 20);
    const entered = (await state()).snapshot.storyteller.events.find((e) => e.tick === original.nextOpportunity);
    assert(entered && entered.outcome === 'spawned');
    assert.equal(entered.members.reduce((sum, p) => sum + p.cost, 0), entered.spent);
    assert(Math.abs(entered.budget - entered.spent - entered.remainder) < 1e-6);
    check('ordinary browser time creates real enemies using the persisted opportunity and budget');

    await load('multi-raid'); snapshot = (await state()).snapshot;
    const event = snapshot.storyteller.events.findLast((e) => e.outcome === 'spawned' && e.members.length > 1); assert(event);
    assert(event.members.every((member) => snapshot.pawns.some((p) => p.id === member.pawnId && p.faction === 'raider')));
    const raid = page.getByTestId('raid-status'); await raid.scrollIntoViewIfNeeded();
    assert(await raid.getByRole('button').count() >= event.members.length);
    const firstEnemy = snapshot.pawns.find((p) => p.id === event.members[0].pawnId);
    const escapedName = firstEnemy.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await raid.getByRole('button', { name: new RegExp(`^${escapedName}(?:\\s|$)`) }).click(); await settle();
    if (await button('清除选择').isVisible()) await click('清除选择');
    await shot('multi-raid-world');
    await details(); await page.getByTestId('storyteller-events').scrollIntoViewIfNeeded();
    assert((await page.getByTestId('storyteller-events').innerText()).includes(`${event.members.length} 名袭击者入场`));
    await shot('multi-raid-budget');
    const groupExport = await visibleExport('group-export'); await loadFile(groupExport.file, sha(await readFile(groupExport.file)));
    assert.deepEqual((await exported()).storyteller, groupExport.data.storyteller);
    check('real multi-person raid list, world and spent/remainder details agree and survive visible export/import', { members: event.members.length, budget: event.budget, spent: event.spent });

    await load('injured'); await details(); snapshot = (await state()).snapshot;
    assert(snapshot.storyteller.threat.population.some((p) => p.health < .999));
    for (const p of snapshot.storyteller.threat.population) assert(await page.locator(`[data-population-pawn="${p.id}"]`).count() === 1);
    await page.getByTestId('threat-breakdown').scrollIntoViewIfNeeded(); await shot('injury-pressure');
    check('real injuries appear in individual health and population pressure');

    if (campaign.fixtures['adaptation-loss']) {
      await load('adaptation-loss'); const before = await exported();
      assert(before.storyteller.losses.length > 0);
      await details(); await page.getByTestId('adaptation-state').scrollIntoViewIfNeeded(); await shot('adaptation-loss');
      const lossExport = await visibleExport('loss-export'); await loadFile(lossExport.file, sha(await readFile(lossExport.file)));
      assert.deepEqual((await exported()).storyteller, before.storyteller);
      check('actual recorded adaptation loss is visible and is not charged again on reload');
    } else result.skipped.push('No adaptation loss occurred in the ordinary campaign; this browser run does not claim live loss coverage.');

    if (campaign.formal) assert(campaign.recoveryProof?.length > 0, 'formal evidence links actual injury to the same recovered living person');
    for (const proof of campaign.recoveryProof ?? []) {
      await load(proof.injury.fixture);
      const injuredPerson = (await state()).snapshot.pawns.find((p) => p.id === proof.pawnId);
      assert(injuredPerson && !injuredPerson.dead && (injuredPerson.trauma.wounds.length || injuredPerson.medical.infections.length));
      assert.deepEqual(injuredPerson.trauma.wounds, proof.injury.wounds);
      assert.deepEqual(injuredPerson.medical.infections, proof.injury.infections);
    }
    await load('recovered'); await details(); snapshot = (await state()).snapshot;
    assert(snapshot.pawns.filter((p) => p.faction === 'colony' && !p.dead).every((p) => !p.downed && p.trauma.wounds.length === 0 && p.medical.infections.length === 0));
    const cared = snapshot.pawns.filter((p) => p.faction === 'colony' && p.medical.lastTend?.tick > armed.tick);
    assert(cared.length > 0, 'actual normal medical work, not merely passive recovery');
    assert(snapshot.stats.consumed.herb > armed.stats.consumed.herb, 'physical herbal medicine was actually consumed after combat');
    for (const proof of campaign.recoveryProof ?? []) {
      const recoveredPerson = snapshot.pawns.find((p) => p.id === proof.pawnId);
      assert(recoveredPerson && !recoveredPerson.dead && !recoveredPerson.downed);
      assert.deepEqual(recoveredPerson.trauma.wounds, []);
      assert.deepEqual(recoveredPerson.medical.infections, []);
      assert.deepEqual(recoveredPerson.trauma.missingParts, proof.recovery.missingParts, 'healing evidence retains any permanent missing parts');
      assert(recoveredPerson.medical.lastTend.tick >= proof.injury.tick);
    }
    await page.getByTestId('threat-breakdown').scrollIntoViewIfNeeded(); await shot('recovered');
    check('ordinary herbal care consumes real medicine and recovered survivors retain calendar and health contribution', { patients: cared.map((p) => ({ id: p.id, lastTend: p.medical.lastTend })), herbConsumed: snapshot.stats.consumed.herb - armed.stats.consumed.herb });

    await page.setViewportSize({ width: 900, height: 700 }); await difficulty('rough');
    const select = page.getByLabel('叙事难度'); await select.scrollIntoViewIfNeeded();
    const box = await select.boundingBox(); assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 900 && box.y + box.height <= 700);
    assert(await select.evaluate((node) => {
      const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === node || node.contains(hit);
    }));
    await shot('compact'); check('900 by 700 layout keeps the real difficulty control visible and actionable');

    const final = await load('final'), finalExport = await exported();
    assert.deepEqual(finalExport.storyteller, final.storyteller);
    assert.deepEqual(finalExport.structureKinds, final.structureKinds);
    assert.deepEqual(finalExport.items, final.items);
    check('final original campaign state retains calendar, structure identities and physical inventory');
    await Promise.all(reads);
    assert(result.assets.length > 0 && result.assets.every((a) => a.status === 200 && a.matchesLocalBuild));
    assert.deepEqual(result.errors, []); result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.failure = String(error.stack ?? error);
    await shot('failure').catch(() => {}); throw error;
  } finally {
    await Promise.allSettled(reads); await context.close();
    await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n');
  }
}
try { for (const mode of modes) await verify(mode); }
catch (error) { process.exitCode = 1; console.error(String(error)); }
finally {
  report.finishedAt = new Date().toISOString();
  report.status = report.modes.length === modes.length && report.modes.every((m) => m.status === 'passed') ? 'passed' : 'failed';
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close();
}
