import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const BASE = process.env.VOXEL_WILDLIFE_URL ?? 'http://127.0.0.1:5188/?world=voxel';
const OUT = process.env.VOXEL_WILDLIFE_BROWSER_OUT ?? 'test-results/voxel-wildlife-browser';
const FIXTURES = 'test-results/voxel-wildlife';
const modes = process.env.VOXEL_WILDLIFE_BROWSER_MODE ? [process.env.VOXEL_WILDLIFE_BROWSER_MODE] : ['worker', 'main'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(OUT, { recursive: true });
const report = { status: 'running', startedAt: new Date().toISOString(), base: BASE,
  scope: `Bounded v22 ${new URL(BASE).hostname === '127.0.0.1' ? 'local' : 'deployed'} browser verification. All mutations use visible controls, canvas clicks, and normal file chooser imports. snapshot/exportSave/project/blockAt are read-only. Checkpoints originate in the ordinary fresh-colony wildlife campaign. No synthetic stock, entity injection, clock edits, or old campaign reruns.`, modes: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function verify(mode) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), url = new URL(BASE);
  if (mode === 'main') url.searchParams.set('render', 'main');
  const result = { mode, checks: [], screenshots: [], fixtures: [], errors: [] }; report.modes.push(result);
  page.on('pageerror', e => result.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); });
  const state = () => page.evaluate(() => window.voxel.snapshot());
  const save = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 90000) => page.waitForFunction(fn, arg, { timeout });
  const button = name => page.getByRole('button', { name, exact: true });
  const check = (name, detail = {}) => { result.checks.push({ name, ...detail }); console.log('PASS', mode, name); };
  const click = async name => { await button(name).scrollIntoViewIfNeeded(); await button(name).click(); if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0); };
  const settle = async () => { await page.waitForTimeout(350); await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0); };
  const shot = async name => { await settle(); const file = `${OUT}/${mode}-${name}.png`; await page.screenshot({ path: file }); result.screenshots.push(file); };
  async function panel() { if (!await page.getByTestId('wildlife-panel').isVisible()) await click('野生动物与狩猎'); }
  async function closePanel() { if (await page.getByTestId('wildlife-panel').isVisible()) await click('关闭野生动物面板'); }
  async function locateAnimal(id) {
    await panel(); await page.locator(`.voxel-wildlife-list [data-animal-id="${id}"]`).getByRole('button', { name: /^定位 / }).click();
    await closePanel(); await wait(id => document.querySelector('[data-testid="animal-detail"]')?.getAttribute('data-animal-id') === String(id), id); await settle();
  }
  async function locateButcher(id) {
    await panel(); const details = page.locator('.voxel-wildlife-workers').filter({ hasText: '屠宰点 ·' });
    if (!(await details.getAttribute('open') !== null)) await details.locator('summary').click();
    await click(`定位屠宰点 ${id}`); await closePanel(); await page.getByTestId('butcher-bill').waitFor(); await settle();
  }
  async function inspect(pos, height = .08) {
    await click('查看');
    while ((await state()).level !== pos.z) await click((await state()).level < pos.z ? '上移一层' : '下移一层');
    await settle(); const q = await page.evaluate(({ pos, height }) => window.voxel.project({ ...pos, z: pos.z + height }), { pos, height });
    assert(q.x > 280 && q.x < 1230 && q.y > 150 && q.y < 630, `visible map point ${JSON.stringify({ pos, q })}`);
    await page.mouse.click(q.x, q.y); await settle();
  }
  async function load(file) {
    await closePanel(); await click('菜单与存档');
    const bytes = await readFile(file), data = JSON.parse(bytes); result.fixtures.push({ file, sha256: sha(bytes), tick: data.tick });
    const chooser = page.waitForEvent('filechooser'); await click('导入体素存档'); await (await chooser).setFiles(file);
    await button('关闭菜单').waitFor({ state: 'hidden' }); await wait(t => window.voxel.snapshot().snapshot.tick === t, data.tick); await settle(); return data;
  }
  try {
    await page.goto(String(url)); await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot);
    await click('暂停'); if (await button('收起指引').isVisible()) await click('收起指引'); await settle();
    assert.equal((await state()).worker, mode === 'worker');
    const initial = (await state()).snapshot; assert.equal(initial.animals.length, 8); assert.equal(new Set(initial.animals.map(a => a.id)).size, 8);
    await panel(); assert.equal(await page.locator('.voxel-wildlife-list [data-animal-id]').count(), 8);
    assert((await page.getByTestId('wildlife-panel').innerText()).includes('0 位可用远程猎人'));
    check('ordinary new colony lists eight real animals and explains missing ranged hunter');
    for (const species of ['deer', 'hare']) {
      const animal = initial.animals.find(a => a.species === species); await locateAnimal(animal.id);
      await click('清除选择'); await inspect(animal, species === 'deer' ? .9 : .3);
      assert.equal(await page.getByTestId('animal-detail').getAttribute('data-animal-id'), String(animal.id));
      assert((await page.getByTestId('animal-detail').innerText()).includes('饱食'));
      await click('标记狩猎此动物'); await wait(id => window.voxel.snapshot().snapshot.animals.find(a => a.id === id)?.hunt, animal.id);
      await shot(`new-${species}`); await click('取消狩猎此动物');
      await wait(id => !window.voxel.snapshot().snapshot.animals.find(a => a.id === id)?.hunt, animal.id);
    }
    check('both species are selectable through their rendered bodies and visible hunt/cancel controls change actual flags');
    await panel(); await page.setViewportSize({ width: 900, height: 700 }); await shot('narrow-panel');
    const boxes = await page.locator('.voxel-header-actions button, .voxel-wildlife-heading button').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { name: el.getAttribute('aria-label'), x: r.x, right: r.right, y: r.y, bottom: r.bottom }; }));
    assert(boxes.every(b => b.x >= 0 && b.right <= 900 && b.y >= 0 && b.bottom <= 700), JSON.stringify(boxes));
    check('900 by 700 wildlife drawer and header controls remain on screen', { boxes });
    await page.setViewportSize({ width: 1280, height: 800 }); await closePanel(); await page.getByTitle('返回营地', { exact: true }).click();
    const free = await page.evaluate(() => {
      const s = window.voxel.snapshot().snapshot, spawn = s.spawn;
      for (const [dx, dy] of [[0, 2], [1, 2], [-1, 2]]) {
        const p = { x: spawn.x + dx, y: spawn.y + dy, z: spawn.z };
        if (!window.voxel.blockAt(p) && !s.trees.some(t => t.x === p.x && t.y === p.y && t.z === p.z)) return p;
      }
    }); assert(free); await click('屠宰点'); await settle();
    const point = await page.evaluate(p => window.voxel.project(p), free); await page.mouse.click(point.x, point.y);
    await wait(p => window.voxel.snapshot().snapshot.butcherSpots.some(b => b.x === p.x && b.y === p.y && b.z === p.z), free);
    check('normal toolbar and map click create a real butcher spot');

    const ready = await load(`${FIXTURES}/ready.json`); assert.equal((await save()).version, 22);
    assert.deepEqual((await save()).animals, ready.animals); check('normal v22 import preserves live animal identities and state');
    const hunter = ready.pawns.find(p => p.weapon?.kind === 'shortBow'); assert(hunter);
    await page.locator('.voxel-colonists button').filter({ hasText: hunter.name }).click();
    await page.getByLabel(`${hunter.name} hunt优先级`, { exact: true }).selectOption('0');
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).priorities.hunt === 0, hunter.id);
    await page.getByLabel(`${hunter.name} hunt优先级`, { exact: true }).selectOption('1');
    await wait(id => window.voxel.snapshot().snapshot.pawns.find(p => p.id === id).priorities.hunt === 1, hunter.id);
    check('visible hunting work priority updates the actual equipped colonist');
    const spot = ready.butcherSpots[0]; await locateButcher(spot.id); await click('暂停屠宰');
    await wait(id => window.voxel.snapshot().snapshot.butcherSpots.find(b => b.id === id).paused, spot.id);
    await shot('butcher-spot'); await click('恢复屠宰');
    await page.getByTitle('返回营地', { exact: true }).click(); await inspect(ready.stockpiles[0]);
    await click('肉类与尸体'); await wait(() => window.voxel.snapshot().snapshot.stockpiles.some(s => s.accepts.length === 2 && s.accepts.includes('meat') && s.accepts.includes('carcass')));
    assert(await page.getByLabel('收纳生肉', { exact: true }).isChecked()); assert(await page.getByLabel('收纳动物尸体', { exact: true }).isChecked());
    await click('仅收食物'); await wait(() => { const el = document.querySelector('input[aria-label="收纳动物尸体"]'); return el && !el.checked; });
    assert(await page.getByLabel('收纳生肉', { exact: true }).isChecked()); assert(!await page.getByLabel('收纳动物尸体', { exact: true }).isChecked());
    check('butcher pause/resume and meat/carcass versus edible-food storage presets use real commands');

    await load(`${FIXTURES}/ready.json`);
    const target = ready.animals.find(a => a.id === 387) ?? ready.animals.filter(a => a.species === 'hare').sort((a, b) => Math.hypot(a.x - hunter.x, a.y - hunter.y) - Math.hypot(b.x - hunter.x, b.y - hunter.y))[0];
    await locateAnimal(target.id); await click('标记狩猎此动物'); await click('取消狩猎此动物'); await click('标记狩猎此动物');
    await click('3倍速'); await wait(id => window.voxel.snapshot().snapshot.pawns.some(p => p.phase === 'hunt' && p.attackTargetId === id), target.id);
    await click('暂停'); assert((await page.getByTestId('animal-detail').innerText()).includes(hunter.name));
    await click('定位这只动物'); await page.getByTitle('向右旋转 E', { exact: true }).click(); await shot('assigned-hunt');
    check('marked prey receives an actual equipped hunter and the inspector follows the moving animal');
    const beforeHunt = await save(); await click('3倍速');
    await wait(id => { const s = window.voxel.snapshot().snapshot; return !s.animals.some(a => a.id === id) && s.items.some(i => i.carcass?.animalId === id); }, target.id);
    await click('暂停'); const killed = await save(), carcass = killed.items.find(i => i.carcass?.animalId === target.id); assert(carcass);
    assert(killed.tick > beforeHunt.tick); assert.equal(carcass.amount, 1); assert.equal(carcass.carcass.species, target.species);
    await page.getByTestId('carcass-detail').waitFor(); await click('⌖ 对焦此处');
    assert((await page.getByTestId('carcass-detail').innerText()).includes(`#${target.id}`));
    assert((await page.getByTestId('food-condition').first().innerText()).includes('不能直接食用'));
    await shot('actual-carcass'); check('actual shot kills marked prey and selection transfers to its identified perishable carcass', { targetId: target.id, carcassId: carcass.id, tick: killed.tick });
    await locateButcher(spot.id); await click('暂停屠宰'); await click('恢复屠宰'); await click('3倍速');
    await wait(id => window.voxel.snapshot().snapshot.pawns.some(p => p.cargo?.carcass?.animalId === id), target.id);
    await click('暂停'); const carrier = (await state()).snapshot.pawns.find(p => p.cargo?.carcass?.animalId === target.id); assert(carrier);
    await page.locator('.voxel-colonists button').filter({ hasText: carrier.name }).click(); await shot('carried-carcass');
    await click('3倍速'); await wait(() => window.voxel.snapshot().snapshot.items.some(i => i.resource === 'meat'));
    await click('暂停'); const meatSave = await save(), meat = meatSave.items.find(i => i.resource === 'meat'); assert(meat);
    assert(!meatSave.items.some(i => i.carcass?.animalId === target.id)); assert(!meatSave.pawns.some(p => p.cargo?.carcass?.animalId === target.id));
    await page.getByTitle('返回营地', { exact: true }).click(); await inspect(meat);
    assert((await page.getByTestId('food-condition').last().innerText()).includes('可生吃或与谷物混合烹饪'));
    await shot('actual-meat'); check('the real carcass is visibly carried and butchered into perishable edible meat', { carrierId: carrier.id, meatId: meat.id, amount: meat.amount, tick: meatSave.tick });
    await click('3倍速'); await wait(() => window.voxel.snapshot().snapshot.items.some(i => i.resource === 'meal'));
    await click('暂停'); const cooked = await save(); assert(cooked.pawns.filter(p => p.faction === 'colony').every(p => !p.dead));
    assert(cooked.items.some(i => i.resource === 'meat' && i.amount < meat.amount));
    check('real meat is consumed by cooking and produces a meal while all colonists stay alive', { tick: cooked.tick });
    await click('菜单与存档'); const download = page.waitForEvent('download'); await click('导出体素存档');
    const exported = `${OUT}/${mode}-ordinary-flow.json`; await (await download).saveAs(exported); await click('关闭菜单');
    const final = await load(exported), restored = await save();
    for (const field of ['animals', 'butcherSpots', 'items', 'tick']) assert.deepEqual(restored[field], final[field]);
    check('visible export and import preserve animals butcher bills and physical food batches');
    assert.deepEqual(result.errors, []); check('no browser page or console errors');
  } catch (error) { result.failure = String(error.stack ?? error); await shot('failure').catch(() => {}); throw error; }
  finally { await context.close(); }
}
try { for (const mode of modes) await verify(mode); report.status = 'passed'; }
catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, modes: report.modes.map(m => ({ mode: m.mode, checks: m.checks.length, errors: m.errors, failure: m.failure })) }, null, 2));
