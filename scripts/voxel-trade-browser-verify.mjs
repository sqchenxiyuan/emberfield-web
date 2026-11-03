import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE = process.env.VOXEL_TRADE_URL ?? process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_TRADE_BROWSER_OUT ?? 'test-results/voxel-trade-browser';
const FIXTURES = process.env.VOXEL_TRADE_OUT ?? 'test-results/voxel-trade-final';
const preliminary = process.argv.includes('--pilot');
const modes = process.env.VOXEL_TRADE_BROWSER_MODE ? [process.env.VOXEL_TRADE_BROWSER_MODE] : ['worker', 'main'];
assert(modes.every(mode => ['worker', 'main'].includes(mode)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const campaignBytes = await readFile(`${FIXTURES}/report.json`), campaign = JSON.parse(campaignBytes);
assert(campaign.status === 'passed' && campaign.formal || preliminary && campaign.fixtures['browser-ready'], 'Formal browser evidence requires a passed formal campaign; a pilot is explicitly preliminary.');
assert.equal(sha(await readFile(campaign.execution.bundle)), campaign.execution.sha256);
assert.equal(sha(await readFile(campaign.execution.script)), campaign.execution.scriptSha256);
for (const source of campaign.execution.sources) assert.equal(sha(await readFile(source.path)), source.sha256, `campaign source still frozen: ${source.path}`);
await mkdir(OUT, { recursive: true });
const scriptBytes = await readFile(new URL(import.meta.url));
await writeFile(`${OUT}/executed-browser.mjs`, scriptBytes, { flag: 'wx' });
const report = { status: 'running', startedAt: new Date().toISOString(), preliminary, base: BASE,
  execution: { script: `${OUT}/executed-browser.mjs`, sha256: sha(scriptBytes) },
  campaign: { file: `${FIXTURES}/report.json`, sha256: sha(campaignBytes), formal: campaign.formal, status: campaign.status, execution: campaign.execution },
  scope: 'Headless Chrome Worker and main. Every mutation uses visible DOM controls and normal file chooser import/export. window.voxel.snapshot/exportSave are read-only observations. Original formal campaign saves retain their bytes and IDs; no injection, event summon, synthetic stock or clock edit. Seven authentic v20 saves migrate through the same import UI.', modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const round = value => { const f = Math.floor(value), t = value - f; return t < .5 ? f : t > .5 ? f + 1 : f % 2 ? f + 1 : f; };
function gear(data) {
  const entries = [];
  const add = (piece, owner) => { if (piece) entries.push([piece.id, { piece, owner }]); };
  for (const i of data.items) { add(i.weapon, `ground:${i.id}`); add(i.apparel, `ground:${i.id}`); }
  for (const p of data.pawns) {
    add(p.weapon, `pawn:${p.id}`); p.worn.forEach(i => add(i, `worn:${p.id}`));
    add(p.cargo?.weapon, `cargo:${p.id}`); add(p.cargo?.apparel, `cargo:${p.id}`);
  }
  for (const c of data.trade.caravans) for (const i of c.stock) { add(i.weapon, `trader:${c.id}`); add(i.apparel, `trader:${c.id}`); }
  assert.equal(new Set(entries.map(([id]) => id)).size, entries.length);
  return entries.sort(([a], [b]) => a - b);
}
async function verify(mode) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), url = new URL(BASE);
  url.searchParams.set('world', 'voxel');
  if (mode === 'main') url.searchParams.set('render', 'main'); else url.searchParams.delete('render');
  const result = { mode, checks: [], fixtures: [], screenshots: [], assets: [], transactions: [], errors: [] };
  report.modes.push(result); const reads = [];
  page.on('pageerror', e => result.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  page.on('response', response => {
    if (!new URL(response.url()).pathname.match(/\/assets\/.*\.(js|css)$/)) return;
    const asset = { url: response.url(), status: response.status() }; result.assets.push(asset);
    reads.push(response.body().then(async bytes => {
      asset.sha256 = sha(bytes); asset.bytes = bytes.length;
      asset.matchesLocalBuild = sha(await readFile(`dist/assets/${path.basename(new URL(asset.url).pathname)}`)) === asset.sha256;
    }).catch(e => { asset.error = String(e); }));
  });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const exported = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = name => page.getByRole('button', { name, exact: true });
  const dialog = () => page.getByTestId('trade-dialog');
  async function click(name) { const target = button(name); await target.scrollIntoViewIfNeeded(); await target.click(); }
  const check = (name, details = {}) => { result.checks.push({ name, ...details }); console.log('PASS', mode, name); };
  async function shot(name) {
    const file = `${OUT}/${mode}-${name}.png`, bytes = await page.screenshot({ path: file });
    result.screenshots.push({ file, sha256: sha(bytes) });
  }
  async function closeTrade() {
    if (await dialog().isVisible()) { await click('取消交易'); await dialog().waitFor({ state: 'hidden' }); }
    if (await page.getByTestId('trade-panel').isVisible()) await click('关闭商队面板');
  }
  async function menu() { await closeTrade(); if (!(await button('关闭菜单').isVisible())) await click('菜单与存档'); }
  async function loadFile(file, hash) {
    const bytes = await readFile(file), saved = JSON.parse(bytes); assert.equal(sha(bytes), hash);
    result.fixtures.push({ file, sha256: hash, version: saved.version, tick: saved.tick });
    await menu(); const chooser = page.waitForEvent('filechooser'); await click('导入体素存档');
    await (await chooser).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' });
    await wait(t => window.voxel.snapshot().snapshot.tick === t, saved.tick);
    await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0);
    return saved;
  }
  async function load(name) { const f = campaign.fixtures[name]; assert(f, `real checkpoint ${name}`); return loadFile(f.file, f.sha256); }
  async function negotiate(id) {
    if (!await page.getByTestId('trade-panel').isVisible()) await click('商队与家园');
    const before = (await state()).snapshot;
    const p = before.pawns.filter(p => p.faction === 'colony' && !p.drafted && !p.dead && !p.downed).sort((a, b) => b.skills.social.level - a.skills.social.level)[0];
    await page.getByLabel('贸易交谈者', { exact: true }).selectOption(String(p.id));
    const section = page.locator(`[data-caravan-id="${id}"]`);
    await section.getByRole('button', { name: '前往交谈', exact: true }).click();
    await dialog().waitFor({ state: 'visible', timeout: 120000 });
    await wait(() => window.voxel.snapshot().snapshot.speed === 0 && !!window.voxel.snapshot().snapshot.trade.quote);
    const after = (await state()).snapshot, q = after.trade.quote;
    const a = after.pawns.find(p => p.id === q.pawnId), c = after.trade.caravans.find(c => c.id === q.caravanId), b = after.pawns.find(p => p.id === c.traderId);
    assert(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) <= 1);
    return q;
  }
  const input = offer => page.locator(`[data-trade-side="${offer.side}"][data-stock-id="${offer.stockId}"] input`);
  async function transaction(lines) {
    const before = await exported(), q = (await state()).snapshot.trade.quote; assert(q);
    for (const { offer, amount } of lines) await input(offer).fill(String(amount));
    const expected = round(lines.reduce((sum, { offer, amount }) => sum + offer.unitPrice * amount * (offer.side === 'colony' ? 1 : -1), 0));
    assert(expected >= -q.colonySilver && expected <= q.traderSilver);
    assert(await button('确认交易').isEnabled());
    await click('确认交易'); await dialog().waitFor({ state: 'hidden' });
    await wait(n => window.voxel.snapshot().snapshot.trade.receipts.length === n, before.trade.receipts.length + 1);
    const after = await exported(), receipt = after.trade.receipts.at(-1);
    assert.equal(after.tick, before.tick, 'paused commit has no hidden time advance');
    assert.equal(receipt.silverToColony, expected); assert.equal(receipt.quotedSilverToColony, expected);
    for (const { offer, amount } of lines) {
      const item = receipt.transferred.find(t => t.side === offer.side && t.stockId === offer.stockId); assert(item);
      assert.equal(item.batch.amount, amount);
      for (const field of ['resource', 'crop', 'rotProgress', 'weapon', 'apparel']) assert.deepEqual(item.batch[field], offer.batch[field]);
    }
    assert.deepEqual(gear(after).map(([id, o]) => [id, o.piece]), gear(before).map(([id, o]) => [id, o.piece]));
    result.transactions.push({ quote: q, lines: lines.map(({ offer, amount }) => ({ side: offer.side, stockId: offer.stockId, amount })), receipt });
    return receipt;
  }
  async function visibleExport(name) {
    await menu(); const pending = page.waitForEvent('download'); await click('导出体素存档');
    const file = `${OUT}/${mode}-${name}.json`; await (await pending).saveAs(file);
    const bytes = await readFile(file); return { file, sha256: sha(bytes), saved: JSON.parse(bytes) };
  }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot);
    await click('暂停'); await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    if (await button('收起指引').isVisible()) await click('收起指引');
    assert.equal((await state()).worker, mode === 'worker');
    for (const name of ['initial', 'working', 'carrying', 'combat', 'injured', 'recovered', 'scheduled']) {
      const file = `tests/fixtures/voxel-v20-trade-${name}.json`, provenance = JSON.parse(await readFile(file.replace('.json', '.provenance.json'), 'utf8'));
      const old = await loadFile(file, provenance.sha256), migrated = await exported();
      assert.equal(old.version, 20); assert.equal(migrated.version, 21);
      for (const field of ['tick', 'blocks', 'items', 'nextId', 'research', 'storyteller', 'projectiles', 'combatEvents', 'sandbags']) assert.deepEqual(migrated[field], old[field]);
      for (const p of old.pawns) {
        const next = migrated.pawns.find(q => q.id === p.id); assert(next);
        for (const field of ['x', 'y', 'z', 'cargo', 'weapon', 'worn', 'health', 'trauma', 'medical', 'shooting', 'food', 'rest']) assert.deepEqual(next[field], p[field]);
        for (const [skill, value] of Object.entries(p.skills)) assert.deepEqual(next.skills[skill], value);
      }
      for (const job of old.jobs) {
        const next = migrated.jobs.find(j => j.id === job.id); assert(next);
        for (const field of ['delivered', 'deliveredBatches', 'progress', 'work', 'kind', 'cost']) assert.deepEqual(next[field], job[field]);
      }
      assert.equal((await state()).snapshot.inventory.silver, 0); assert.deepEqual(migrated.trade.receipts, []);
      assert.deepEqual(migrated.trade.caravans, []); assert.deepEqual(migrated.homeArea, []);
      const once = await visibleExport(`legacy-${name}`); await loadFile(once.file, once.sha256);
      assert.deepEqual((await exported()).trade, once.saved.trade);
      check(`genuine v20 ${name} retains physical state and persistent initial trade calendar without free silver`);
    }
    const ready = await load('browser-ready'); await dialog().waitFor({ state: 'visible' });
    await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    let q = (await state()).snapshot.trade.quote; assert(q); const caravanId = q.caravanId;
    assert.equal(q.sessionId, ready.trade.session.id); check('ready session reload retains actual merchant and session identities');
    const beforeCancel = await exported(); await click('取消交易'); await dialog().waitFor({ state: 'hidden' });
    const canceled = await exported();
    for (const field of ['items', 'stats']) assert.deepEqual(canceled[field], beforeCancel[field]);
    for (const field of ['receipts', 'imported', 'exported', 'caravans']) assert.deepEqual(canceled.trade[field], beforeCancel.trade[field]);
    check('visible cancellation transfers no items, silver or receipt');
    q = await negotiate(caravanId); await shot('normal-talk');
    check('visible negotiator choice and actual walking opens an adjacent paused quote');
    const allBuy = q.offers.filter(o => o.side === 'trader' && !o.currency);
    for (const offer of allBuy) await input(offer).fill(String(offer.amount));
    assert(await button('确认交易').isDisabled()); assert((await dialog().innerText()).includes('银币不足'));
    await shot('insufficient-silver');
    for (const offer of allBuy) await input(offer).fill('');
    check('insufficient colony silver disables the real confirmation control');
    const buyGear = q.offers.filter(o => o.side === 'trader' && (o.batch.apparel || o.batch.weapon)).sort((a, b) => a.unitPrice - b.unitPrice)[0];
    const sell = q.offers.find(o => o.side === 'colony' && o.batch.resource === 'grain' && o.amount >= 2) ??
      q.offers.find(o => o.side === 'colony' && !o.currency && o.amount >= 2); assert(buyGear && sell);
    await input(buyGear).fill('1'); const keyboardTick = (await state()).snapshot.tick; await input(buyGear).press('Space');
    await page.waitForTimeout(300); assert.equal((await state()).snapshot.speed, 0); assert.equal((await state()).snapshot.tick, keyboardTick);
    assert.equal(await input(buyGear).inputValue(), '1'); check('dialog keyboard input cannot activate background time shortcuts');
    await page.setViewportSize({ width: 900, height: 700 });
    const confirm = button('确认交易'); await confirm.scrollIntoViewIfNeeded();
    const box = await confirm.boundingBox(); assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 900 && box.y + box.height <= 700);
    assert(await dialog().evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollLeft === 0), 'dialog has no hidden horizontal overflow');
    for (const selector of ['.voxel-trade-dialog-header', '.voxel-trade-lists', '.voxel-trade-settlement', '.voxel-trade-confirm-row'])
      assert(await page.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1; }), `${selector} fits viewport without horizontal clipping`);
    assert(await confirm.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === node || node.contains(hit); }));
    await shot('compact-quote'); check('900 by 700 trade dialog keeps settlement and confirmation visible and actionable');
    await transaction([{ offer: buyGear, amount: 1 }, { offer: sell, amount: 2 }]);
    check('first visible buy and sell settles silver and retains the exact purchased gear identity');
    await page.setViewportSize({ width: 1280, height: 800 });
    q = await negotiate(caravanId);
    const secondBuy = q.offers.filter(o => o.side === 'trader' && !o.currency).sort((a, b) => a.unitPrice - b.unitPrice)[0];
    const secondSell = q.offers.find(o => o.side === 'colony' && !o.currency); assert(secondBuy && secondSell);
    await transaction([{ offer: secondBuy, amount: 1 }, { offer: secondSell, amount: 1 }]);
    await shot('receipts'); check('a second ordinary negotiation uses the changed physical inventory and records a distinct receipt');
    const actual = await visibleExport('actual-trades'); await loadFile(actual.file, actual.sha256);
    const again = await exported();
    for (const field of ['tick', 'items', 'stats', 'trade', 'homeArea']) assert.deepEqual(again[field], actual.saved[field]);
    assert.deepEqual(gear(again), gear(actual.saved));
    check('normal visible export and import preserves changed silver, goods, receipts, merchant stock, schedule and unique gear');
    if (campaign.fixtures['before-departure']) {
      const leaving = await load('before-departure'), ids = leaving.trade.caravans.flatMap(c => c.pawnIds);
      await click('3倍速'); await wait(list => !window.voxel.snapshot().snapshot.pawns.some(p => list.includes(p.id)), ids, 120000); await click('暂停');
      assert.equal((await state()).snapshot.trade.session, null); check('normal browser time lets the actual caravan leave the map');
      await shot('departed');
    }
    await Promise.all(reads);
    assert(result.assets.length > 0 && result.assets.every(a => a.status === 200 && a.matchesLocalBuild));
    assert.deepEqual(result.errors, []); result.status = preliminary ? 'pilot-passed' : 'passed';
  } catch (error) {
    result.status = 'failed'; result.failure = error.stack ?? String(error); await shot('failure').catch(() => {}); throw error;
  } finally { await Promise.allSettled(reads); await context.close(); }
}
try { for (const mode of modes) await verify(mode); }
catch (error) { process.exitCode = 1; console.error(error); }
finally {
  report.finishedAt = new Date().toISOString(); report.status = report.modes.length === modes.length && report.modes.every(m => m.status === (preliminary ? 'pilot-passed' : 'passed')) ? (preliminary ? 'pilot-passed' : 'passed') : 'failed';
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); await browser.close();
}
