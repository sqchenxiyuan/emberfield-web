import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const BASE =
  process.env.VOXEL_MEDICINE_URL ??
  process.env.VOXEL_TEST_URL ??
  'http://127.0.0.1:5183/?world=voxel';
const OUT = process.env.VOXEL_MEDICINE_BROWSER_OUT ?? 'test-results/voxel-medicine-browser';
const FIXTURES = process.env.VOXEL_MEDICINE_OUT ?? 'test-results/voxel-medicine-exploratory';
const modes = process.env.VOXEL_MEDICINE_BROWSER_MODE
  ? [process.env.VOXEL_MEDICINE_BROWSER_MODE]
  : ['worker', 'main'];
assert(modes.every((m) => ['worker', 'main'].includes(m)));
await mkdir(OUT, { recursive: true });
const sha = (v) => createHash('sha256').update(v).digest('hex');
const campaignBytes = await readFile(`${FIXTURES}/report.json`);
const campaign = JSON.parse(campaignBytes);
assert.equal(campaign.status, 'passed', 'ordinary medicine campaign must finish first');
assert.equal(sha(await readFile(campaign.execution.bundle)), campaign.execution.sha256);
const legacy = [];
for (const name of ['working', 'injured']) {
  const file = `tests/fixtures/voxel-v18-medicine-${name}.json`;
  const provenanceFile = `tests/fixtures/voxel-v18-medicine-${name}.provenance.json`;
  const provenance = JSON.parse(await readFile(provenanceFile, 'utf8'));
  const bytes = await readFile(file),
    data = JSON.parse(bytes);
  assert.equal(data.version, 18);
  assert.equal(provenance.version, 18);
  assert.equal(provenance.loadedByOriginalSource, true);
  assert.equal(data.tick, provenance.tick);
  assert.equal(sha(bytes), provenance.sha256);
  legacy.push({ name, file, provenanceFile, ...provenance });
}
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  scope:
    'Headless Chrome, Worker and main renderers. All mutations use visible buttons, selects, checkboxes, canvas clicks and the file chooser. snapshot/project/blockAt/exportSave are read-only observations. Real v18 fixtures and normal v19 campaign fixtures are hash-checked. Production asset response bytes must match dist. No internal simulation commands, scene injection or forged infection state.',
  campaign: {
    file: `${FIXTURES}/report.json`,
    sha256: sha(campaignBytes),
    formal: campaign.formal,
    coverage: campaign.coverage,
    execution: campaign.execution,
  },
  legacy,
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
  const result = {
    mode,
    checks: [],
    errors: [],
    assets: [],
    fixtures: [],
    screenshots: [],
    skipped: [],
  };
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
  const exported = () => page.evaluate(() => window.voxel.exportSave());
  const wait = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout });
  const button = (name) => page.getByRole('button', { name, exact: true });
  async function click(name) {
    const target = button(name);
    await target.scrollIntoViewIfNeeded();
    await target.click();
    if (name === '暂停') await wait(() => window.voxel.snapshot().snapshot.speed === 0);
    if (/^[123]倍速$/.test(name))
      await wait((speed) => window.voxel.snapshot().snapshot.speed === speed, Number(name[0]));
  }
  async function settle() {
    await page.waitForTimeout(350);
    await wait(() => window.voxel.snapshot().metrics.pendingChunks === 0);
  }
  function check(name, detail = {}) {
    result.checks.push({ name, ...detail });
    console.log('PASS', mode, name);
  }
  async function shot(name) {
    const file = `${OUT}/${mode}-${name}.png`,
      bytes = await page.screenshot({ path: file });
    result.screenshots.push({ file, sha256: sha(bytes) });
  }
  async function loadFile(file, hash) {
    const bytes = await readFile(file),
      data = JSON.parse(bytes);
    if (hash) assert.equal(sha(bytes), hash);
    result.fixtures.push({ file, sha256: sha(bytes), version: data.version, tick: data.tick });
    if (!(await page.getByRole('dialog').isVisible())) await click('菜单与存档');
    const chooser = page.waitForEvent('filechooser');
    await click('导入体素存档');
    await (await chooser).setFiles(file);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await wait((tick) => window.voxel.snapshot().snapshot.tick === tick, data.tick);
    await settle();
    return data;
  }
  const load = (name) => {
    const fixture = campaign.fixtures[name];
    assert(fixture, `normal campaign fixture ${name}`);
    return loadFile(fixture.file, fixture.sha256);
  };
  async function viewLevel(z) {
    for (let n = 0; n < 16 && (await state()).level !== z; n++)
      await click((await state()).level < z ? '上移一层' : '下移一层');
    assert.equal((await state()).level, z);
    await settle();
  }
  async function selectPawn(id) {
    const p = (await state()).snapshot.pawns.find((p) => p.id === id);
    assert(p);
    const list =
      p.faction === 'colony' ? page.locator('.voxel-colonists') : page.getByTestId('raid-status');
    const escapedName = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const target = list.getByRole('button', { name: new RegExp(`^${escapedName}(?:\\s|$)`) });
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await page.getByTestId('pawn-health').waitFor();
    await settle();
    return p;
  }
  async function frame(p, height = 0.1) {
    await viewLevel(p.z);
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
      for (let n = 0; n < 40 && (q[axis] < low || q[axis] > high); n++) {
        const middle = (low + high) / 2,
          previous = Math.abs(q[axis] - middle);
        const key = q[axis] > high ? forward : back,
          opposite = key === forward ? back : forward;
        await page.keyboard.press(key);
        await page.waitForTimeout(70);
        q = await project();
        if (Math.abs(q[axis] - middle) > previous) {
          await page.keyboard.press(opposite);
          await page.keyboard.press(opposite);
          await page.waitForTimeout(70);
          q = await project();
        }
      }
    }
    assert(q.x > 320 && q.x < 1260 && q.y > 90 && q.y < 635, JSON.stringify({ p, q }));
    return q;
  }
  async function inspect(p, height = 0.1) {
    if (await button('清除选择').isVisible()) await click('清除选择');
    await click('查看');
    const q = await frame(p, height);
    await page.mouse.click(q.x, q.y);
    await settle();
  }
  async function advance(ticks, speed = 3) {
    const start = (await state()).snapshot.tick;
    await click(`${speed}倍速`);
    await wait((tick) => window.voxel.snapshot().snapshot.tick >= tick, start + ticks);
    await click('暂停');
  }
  async function visibleExport(name) {
    await click('菜单与存档');
    const download = page.waitForEvent('download');
    await click('导出体素存档');
    const file = `${OUT}/${mode}-${name}.json`;
    await (await download).saveAs(file);
    return { file, data: JSON.parse(await readFile(file, 'utf8')) };
  }
  async function policy(id, value) {
    await selectPawn(id);
    const select = page.getByLabel('医疗政策', { exact: true });
    await select.scrollIntoViewIfNeeded();
    await select.selectOption(value);
    await wait(
      ({ id, value }) =>
        window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).medical.policy === value,
      { id, value },
    );
  }
  async function startCare(patientId, doctorId) {
    await selectPawn(patientId);
    const doctors = page.getByLabel('医护人员', { exact: true });
    await doctors.scrollIntoViewIfNeeded();
    await doctors.selectOption(String(doctorId));
    await click('优先护理');
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).carePhase !== null,
      doctorId,
    );
  }
  try {
    await page.goto(String(url));
    await wait(() => window.voxel?.snapshot().ready && window.voxel.snapshot().snapshot !== null);
    await click('暂停');
    if (await button('收起指引').isVisible()) await click('收起指引');
    await settle();
    assert.equal((await state()).worker, mode === 'worker');
    for (const fixture of legacy) {
      const old = await loadFile(fixture.file, fixture.sha256),
        migrated = await exported();
      assert.equal(migrated.version, 19);
      for (const field of [
        'blocks',
        'ladders',
        'items',
        'research',
        'tick',
        'nextId',
        'projectiles',
        'combatEvents',
        'sandbags',
      ])
        assert.deepEqual(migrated[field], old[field], `legacy ${field}`);
      assert.equal(migrated.jobs.length, old.jobs.length);
      for (const job of old.jobs) {
        const next = migrated.jobs.find((j) => j.id === job.id);
        assert(next);
        // Normal reload reconstructs work assignments. Physical ingredients and earned
        // work are retained; owner/reason are deliberately runtime scheduling state.
        for (const field of [
          'kind',
          'x',
          'y',
          'z',
          'cost',
          'delivered',
          'deliveredFood',
          'progress',
          'work',
          'workTicks',
          'weaponKind',
          'weaponBenchKind',
        ])
          assert.deepEqual(next[field], job[field], `legacy job ${job.id} ${field}`);
      }
      for (const key of ['produced', 'consumed', 'spoiled', 'destroyed'])
        assert.deepEqual(migrated.stats[key], { ...old.stats[key], herb: 0 });
      for (const p of old.pawns) {
        const next = migrated.pawns.find((q) => q.id === p.id);
        for (const field of [
          'x',
          'y',
          'z',
          'trauma',
          'health',
          'skills',
          'weapon',
          'worn',
          'cargo',
          'shooting',
          'nextAttackTick',
        ])
          assert.deepEqual(next[field], p[field]);
        assert.deepEqual(next.medical.infections, []);
        assert.equal(next.medical.immunity, 0);
        assert(next.medical.risks.every((r) => r.state === 'legacy'));
        assert.equal(next.careMedicineId, null);
      }
      await selectPawn(old.pawns.find((p) => p.faction === 'colony').id);
      assert.equal(await page.getByLabel('医疗政策', { exact: true }).inputValue(), 'herbal');
      await page.getByTestId('medical-policy').scrollIntoViewIfNeeded();
      await shot(`v18-${fixture.name}-migration`);
      check(
        `genuine v18 ${fixture.name} save migrates with physical state and old wounds unchanged`,
        { sha256: fixture.sha256, publishedCommit: fixture.publishedCommit },
      );
    }

    await load('herb-growing');
    const growing = (await state()).snapshot.crops.find((c) => c.kind === 'healroot');
    assert(growing);
    await inspect(growing, 0.3);
    await page.getByTestId('farm-detail').waitFor();
    assert.match(await page.getByTestId('crop-sowing-skill').innerText(), /8 级.*收获不受/);
    assert.match(await page.getByTestId('farm-detail').innerText(), /草药.*不能食用/);
    await page.getByTestId('farm-detail').scrollIntoViewIfNeeded();
    await shot('healroot-growing');
    await click('种植区');
    await page.getByLabel('种植作物', { exact: true }).selectOption('healroot');
    await click('种植区');
    const plot = await page.evaluate(() => {
      const s = window.voxel.snapshot().snapshot;
      const occupied = [
        ...s.farms,
        ...s.stockpiles,
        ...s.items,
        ...s.trees,
        ...s.stoves,
        ...s.jobs,
        ...s.beds,
      ];
      const origin = s.farms.find((p) => p.crop === 'healroot');
      for (let radius = 1; radius < 18; radius++)
        for (let dx = -radius; dx <= radius; dx++)
          for (let dy = -radius; dy <= radius; dy++) {
            const p = { x: origin.x + dx, y: origin.y + dy, z: origin.z };
            if (p.x < 3 || p.y < 3 || p.x > 60 || p.y > 60) continue;
            if (
              ![1, 8, 10].includes(window.voxel.blockAt({ ...p, z: p.z - 1 })) ||
              window.voxel.blockAt(p) ||
              window.voxel.blockAt({ ...p, z: p.z + 1 })
            )
              continue;
            if (!occupied.some((q) => q.x === p.x && q.y === p.y && q.z === p.z)) return p;
          }
      return null;
    });
    assert(plot, 'read-only search finds an actual free soil tile');
    const projected = await frame(plot, 0);
    await page.mouse.click(projected.x, projected.y);
    await wait(
      (p) =>
        window.voxel
          .snapshot()
          .snapshot.farms.some(
            (q) => q.x === p.x && q.y === p.y && q.z === p.z && q.crop === 'healroot',
          ),
      plot,
    );
    await shot('healroot-designated');
    check(
      'visible crop selection and a canvas click designate a real healroot plot with the skill requirement shown',
      { plot },
    );

    const cold = await load('herb-cold');
    const herb = cold.items.find((i) => i.resource === 'herb' && i.z === campaign.layout.cold.z);
    assert(herb);
    await inspect(herb, 0.2);
    await page.getByTestId('herb-use').waitFor();
    assert.match(await page.getByTestId('herb-use').innerText(), /不能食用/);
    assert.match(await page.getByTestId('stack-capacity').innerText(), /25/);
    assert.match(await page.getByTestId('food-condition').innerText(), /冻结.*腐坏暂停/);
    await page.getByTestId('food-condition').scrollIntoViewIfNeeded();
    await shot('herb-cold');
    await click('停止收纳');
    await wait(
      (p) =>
        window.voxel
          .snapshot()
          .snapshot.stockpiles.find((q) => q.x === p.x && q.y === p.y && q.z === p.z).accepts
          .length === 0,
      herb,
    );
    await click('仅收草药');
    await wait((p) => {
      const q = window.voxel
        .snapshot()
        .snapshot.stockpiles.find((q) => q.x === p.x && q.y === p.y && q.z === p.z);
      return q.accepts.length === 1 && q.accepts[0] === 'herb';
    }, herb);
    const filter = page.getByLabel('收纳草药', { exact: true });
    assert(await filter.isChecked());
    await page.getByLabel('仓储优先级', { exact: true }).selectOption('2');
    await wait(
      (p) =>
        window.voxel
          .snapshot()
          .snapshot.stockpiles.find((q) => q.x === p.x && q.y === p.y && q.z === p.z).priority ===
        2,
      herb,
    );
    await shot('herb-storage-filter');
    check(
      'upper cold herbs render as leaf bundles with nonfood, finite capacity, rot and real storage controls',
      { herbId: herb.id, amount: herb.amount, z: herb.z },
    );

    const wounded = await load('wounded');
    const patientId = campaign.patientId,
      doctorId = campaign.doctorId;
    assert(wounded.pawns.some((p) => p.id === patientId && p.trauma.wounds.length));
    await policy(patientId, 'none');
    await page.getByTestId('care-controls').scrollIntoViewIfNeeded();
    assert(await button('优先护理').isDisabled());
    await shot('policy-none');
    const rest = page.getByLabel('医疗卧床休养', { exact: true });
    await rest.scrollIntoViewIfNeeded();
    await rest.click();
    await wait(
      (id) => !window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).medical.bedRest,
      patientId,
    );
    await rest.click();
    await wait(
      (id) => window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).medical.bedRest,
      patientId,
    );
    await policy(patientId, 'noMedicine');
    const noMedicineBefore = (await state()).snapshot.stats.consumed.herb;
    await startCare(patientId, doctorId);
    await click('3倍速');
    await wait(
      (id) =>
        window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).medical.lastTend !== null,
      patientId,
    );
    await click('暂停');
    const noMedicineAfter = (await state()).snapshot;
    assert.equal(noMedicineAfter.stats.consumed.herb, noMedicineBefore);
    assert.equal(
      noMedicineAfter.pawns.find((p) => p.id === patientId).medical.lastTend.medicine,
      null,
    );
    await selectPawn(patientId);
    await page.getByTestId('last-medical-treatment').scrollIntoViewIfNeeded();
    await page.getByTestId('last-medical-treatment').locator('summary').click();
    await shot('no-medicine-treatment');
    check(
      'none blocks care, rest preference toggles, and visible no-medicine care performs work without consuming herbs',
    );

    const fetching = await load('fetching');
    await selectPawn(patientId);
    await page.getByTestId('medical-process').scrollIntoViewIfNeeded();
    assert.match(await page.getByTestId('medical-process').innerText(), /正在取用草药/);
    const savedFetch = await visibleExport('fetch-export');
    assert.equal(savedFetch.data.tick, fetching.tick);
    await loadFile(savedFetch.file, sha(await readFile(savedFetch.file)));
    const fetchedReload = await exported();
    for (const field of ['carePhase', 'careMedicineId', 'careAmount', 'careProgress', 'cargo'])
      assert.deepEqual(
        fetchedReload.pawns.find((p) => p.id === doctorId)[field],
        fetching.pawns.find((p) => p.id === doctorId)[field],
      );
    await selectPawn(patientId);
    await page.getByTestId('medical-process').scrollIntoViewIfNeeded();
    await shot('fetching');
    await click('3倍速');
    await wait(
      (id) =>
        window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).cargo?.resource === 'herb',
      doctorId,
    );
    await click('暂停');
    const carrying = (await state()).snapshot.pawns.find((p) => p.id === doctorId);
    assert(carrying.cargo.amount > 0);
    assert(carrying.cargo.rotProgress >= 0);
    await selectPawn(doctorId);
    await viewLevel(carrying.z);
    await page.getByTestId('medical-process').scrollIntoViewIfNeeded();
    await shot('herb-carried');
    check(
      'physical medicine fetch survives visible export/import and resumes to a real carried herb bundle',
      { doctorId, cargo: carrying.cargo, layer: carrying.z },
    );

    const tending = await load('tending');
    const beforeConsumed = tending.stats.consumed.herb;
    const oldTendTick = tending.pawns.find((p) => p.id === patientId).medical.lastTend?.tick ?? -1;
    await selectPawn(patientId);
    await page.getByTestId('medical-process').scrollIntoViewIfNeeded();
    assert(
      Number(
        await page
          .getByRole('progressbar', { name: '护理进度', exact: true })
          .getAttribute('value'),
      ) > 0,
    );
    await shot('tending');
    const exportedCare = await visibleExport('tending-export');
    await loadFile(exportedCare.file);
    assert.equal(
      (await exported()).pawns.find((p) => p.id === doctorId).careProgress,
      tending.pawns.find((p) => p.id === doctorId).careProgress,
    );
    await click('3倍速');
    await wait(
      ({ id, before }) =>
        (window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id).medical.lastTend?.tick ??
          -1) > before,
      { id: patientId, before: oldTendTick },
    );
    await click('暂停');
    const treated = (await state()).snapshot;
    assert(treated.stats.consumed.herb > beforeConsumed);
    assert.equal(treated.pawns.find((p) => p.id === patientId).medical.lastTend.medicine, 'herb');
    await selectPawn(patientId);
    await page.getByTestId('last-medical-treatment').scrollIntoViewIfNeeded();
    await page.getByTestId('last-medical-treatment').locator('summary').click();
    await shot('herbal-treatment');
    check(
      'elapsed tending work and its carried herb survive export/import; completion consumes herb and exposes real treatment quality',
    );

    if (campaign.coverage.naturalInfection) {
      const infected = await load('infected'),
        id = campaign.infectedPatientId;
      const p = infected.pawns.find((p) => p.id === id);
      assert(p.medical.infections.length > 0);
      await selectPawn(id);
      await page.getByTestId('infection-list').scrollIntoViewIfNeeded();
      assert.equal(await page.getByTestId('infection-detail').count(), p.medical.infections.length);
      assert.equal(
        await page.getByRole('progressbar', { name: '伤口感染免疫', exact: true }).count(),
        1,
      );
      assert.equal(
        Number(
          await page
            .getByRole('progressbar', { name: '伤口感染免疫', exact: true })
            .getAttribute('value'),
        ),
        p.medical.immunity,
      );
      assert(
        !/random|checkAt|roll|感染风险抽样|预定感染/.test(
          await page.getByTestId('medical-detail').innerText(),
        ),
      );
      await shot('natural-infection');
      check(
        'a real delayed infection exposes per-part severity and exactly one shared immunity bar without hidden-risk spoilers',
        { patientId: id, infections: p.medical.infections },
      );
      if (campaign.coverage.bedRest) {
        const resting = await load('medical-bed'),
          restPatient = resting.pawns.find((p) => p.id === id);
        assert.equal(restPatient.sleepBedId, campaign.layout.medicalBed.id);
        assert.equal(restPatient.phase, 'rest');
        assert.equal(restPatient.z, campaign.layout.medicalBed.z);
        await selectPawn(id);
        await viewLevel(restPatient.z);
        await page.getByTestId('medical-rest-status').scrollIntoViewIfNeeded();
        assert.match(await page.getByTestId('medical-rest-status').innerText(), /正在医疗床休养/);
        await shot('medical-bed');
        const immunity = restPatient.medical.immunity;
        await advance(100);
        assert((await state()).snapshot.pawns.find((p) => p.id === id).medical.immunity > immunity);
        check(
          'actual upper medical-bed rest is visible and immunity advances with elapsed gameplay',
        );
      } else
        result.skipped.push(
          'Natural case did not reach an actual medical bed; no resting claim is made.',
        );
      if (campaign.fixtures['infection-tended']) {
        const renewed = await load('infection-tended'),
          p = renewed.pawns.find((p) => p.id === id);
        await selectPawn(id);
        await page.getByTestId('infection-list').scrollIntoViewIfNeeded();
        assert(p.medical.infections.some((i) => i.tendUntil > renewed.tick));
        assert.match(await page.getByTestId('infection-list').innerText(), /护理品质.*%/);
        assert.match(await page.getByTestId('infection-list').innerText(), /本次护理仍有效/);
        await shot('infection-tended');
        check('a real infection treatment displays its quality and remaining valid duration');
        const infection = p.medical.infections.find((i) => i.tendUntil > renewed.tick);
        const herbBeforeRenewal = renewed.stats.consumed.herb;
        await click('3倍速');
        await wait(
          ({ id, infectionId }) => {
            const s = window.voxel.snapshot().snapshot;
            const p = s.pawns.find((p) => p.id === id);
            const i = p.medical.infections.find((i) => i.id === infectionId);
            return (
              i && p.medical.immunity < 1 && i.tendUntil > s.tick && i.tendUntil - s.tick < 1500
            );
          },
          { id, infectionId: infection.id },
          180000,
        );
        await click('暂停');
        await selectPawn(id);
        await page.getByTestId('infection-list').scrollIntoViewIfNeeded();
        assert.match(await page.getByTestId('infection-list').innerText(), /已可提前再次护理/);
        await shot('infection-renewable');
        await click('3倍速');
        await wait(
          ({ id, infectionId, previousUntil }) => {
            const p = window.voxel.snapshot().snapshot.pawns.find((p) => p.id === id);
            return p.medical.infections.some(
              (i) => i.id === infectionId && i.tendUntil > previousUntil,
            );
          },
          { id, infectionId: infection.id, previousUntil: infection.tendUntil },
        );
        await click('暂停');
        const repeated = (await state()).snapshot;
        assert(repeated.stats.consumed.herb > herbBeforeRenewal);
        assert(
          repeated.pawns.find((p) => p.id === id).medical.lastTend.recordIds.includes(infection.id),
        );
        await page.getByTestId('infection-list').scrollIntoViewIfNeeded();
        await shot('infection-renewed');
        check(
          'elapsed normal gameplay reaches the early-repeat interval and an actual subsequent herb treatment extends infection care',
          {
            infectionId: infection.id,
            oldTendUntil: infection.tendUntil,
            newTendUntil: repeated.pawns
              .find((p) => p.id === id)
              .medical.infections.find((i) => i.id === infection.id).tendUntil,
            herbsConsumed: repeated.stats.consumed.herb - herbBeforeRenewal,
          },
        );
      }
      if (campaign.coverage.recovery) {
        const recovered = await load('recovered'),
          p = recovered.pawns.find((p) => p.id === id);
        assert.equal(p.medical.infections.length, 0);
        assert(p.medical.immunity > 0);
        await selectPawn(id);
        await page.getByTestId('infection-list').scrollIntoViewIfNeeded();
        assert.match(await page.getByTestId('infection-list').innerText(), /感染已消退/);
        assert.match(await page.getByTestId('infection-list').innerText(), /保留免疫/);
        await shot('recovered');
        check('resolved real infection retains a visible shared immunity value');
      } else {
        result.skipped.push(
          'Natural infected case did not recover; no invented recovery fixture is used.',
        );
        if (campaign.fixtures['infection-care-outcome']) {
          const outcome = await load('infection-care-outcome');
          const patient = outcome.pawns.find((p) => p.id === id);
          await selectPawn(id);
          await page.getByTestId('infection-list').scrollIntoViewIfNeeded();
          await shot('infection-outcome');
          check(
            'the actual adverse infection outcome is retained and shown without claiming recovery',
            {
              patientId: id,
              dead: patient.dead,
              immunity: patient.medical.immunity,
              infections: patient.medical.infections,
            },
          );
        }
      }
    } else
      result.skipped.push(
        'No natural infection occurred in the recorded campaign. Infection/rest/recovery UI is not established by this normal-play browser run.',
      );

    await load('wounded');
    await selectPawn(patientId);
    await page.setViewportSize({ width: 900, height: 700 });
    await settle();
    const policySelect = page.getByLabel('医疗政策', { exact: true });
    await policySelect.scrollIntoViewIfNeeded();
    assert(
      await policySelect.evaluate((el) => {
        const b = el.getBoundingClientRect(),
          hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return (
          b.x >= 0 &&
          b.y >= 0 &&
          b.right <= 900 &&
          b.bottom <= 700 &&
          (hit === el || el.contains(hit))
        );
      }),
    );
    await policySelect.selectOption('herbal');
    await page.getByTestId('care-controls').scrollIntoViewIfNeeded();
    assert(await button('优先护理').isEnabled());
    await shot('compact');
    await startCare(patientId, doctorId);
    check('medical policy and care controls remain reachable and actionable at 900 by 700');
    await page.setViewportSize({ width: 1280, height: 800 });
    const final = await load('final'),
      finalReload = await exported();
    for (const field of ['items', 'stats', 'beds', 'stockpiles', 'farms', 'crops'])
      assert.deepEqual(finalReload[field], final[field]);
    for (const p of final.pawns) {
      const q = finalReload.pawns.find((q) => q.id === p.id);
      for (const field of [
        'medical',
        'trauma',
        'skills',
        'cargo',
        'careMedicineId',
        'careProgress',
        'carePhase',
      ])
        assert.deepEqual(q[field], p[field]);
    }
    check(
      'final real campaign reload preserves medicine, crops, injuries, immunity and care state',
    );
    await Promise.all(reads);
    assert(
      result.assets.length > 0 &&
        result.assets.every((a) => a.status === 200 && a.matchesLocalBuild),
      'served assets exactly match production build',
    );
    assert.deepEqual(result.errors, []);
    result.metrics = (await state()).metrics;
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
  for (const mode of modes) await verify(mode);
} catch (error) {
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
