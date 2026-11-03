import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { researchOpening } from './voxel-research-opening.mjs';

const OUT = process.env.VOXEL_ARMOR_OUT ?? 'test-results/voxel-armor-campaign';
await mkdir(OUT, { recursive: true });
const bundle = await build({
  entryPoints: ['src/voxel/world.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { VoxelSimulation } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
const initial = s.counts();
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Fresh v17 colony. Only normal commands, step, save/load; terrain/path/state are read-only observations. No injected resources, research, skills, positions, health, armor or time. Real underground steel, upper-floor research and smithy, fuel, quality, equipment and scheduled raid. Single ordinary campaign is not a probability measurement.',
  commands: [],
  checks: [],
  fixtures: {},
  carriedLayers: {},
  externalTransfers: [],
  errors: [],
  status: 'running',
};
const point = (p) => ({ x: p.x, y: p.y, z: p.z });
const pieces = () => [
  ...s.items.flatMap((i) => (i.apparel ? [i.apparel] : [])),
  ...s.pawns.flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
];
const colonists = () => s.pawns.filter((p) => p.faction === 'colony');
const enemy = () => s.pawns.find((p) => p.faction === 'raider');
function command(c) {
  const r = s.command(c);
  report.commands.push({ tick: s.tick, command: c, result: r });
  assert(r.ok, JSON.stringify({ c, r }));
  return r;
}
const place = (tool, p, extra = {}) =>
  command({ type: 'designate', tool, from: point(p), ...extra });
function check(name, detail = {}) {
  report.checks.push({ name, tick: s.tick, ...detail });
  console.log('PASS', name, s.tick);
}
function audit() {
  const counts = s.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      counts[r] + s.stats.consumed[r] + s.stats.spoiled[r] + s.stats.destroyed[r],
      initial[r] +
        s.stats.produced[r] +
        report.externalTransfers.filter((t) => t.resource === r).reduce((n, t) => n + t.amount, 0),
      r + ' conservation at ' + s.tick,
    );
  assert.equal(
    pieces().length,
    new Set(pieces().map((p) => p.id)).size,
    'unique garment identities',
  );
  assert(
    colonists().every((p) => !p.dead),
    'colony survives this documented scenario',
  );
}
function step() {
  const before = s.pawns
    .filter((p) => p.faction === 'raider')
    .map((p) => ({ id: p.id, weapon: p.weapon ? structuredClone(p.weapon) : null }));
  s.step();
  for (const p of s.pawns.filter((p) => p.faction === 'raider'))
    if (!before.some((q) => q.id === p.id) && p.weapon)
      report.externalTransfers.push({
        tick: s.tick,
        pawnId: p.id,
        resource: 'weapon',
        itemId: p.weapon.id,
        amount: 1,
        reason: 'raider arrived carrying weapon',
      });
  for (const p of before)
    if (!s.pawns.some((q) => q.id === p.id) && p.weapon)
      report.externalTransfers.push({
        tick: s.tick,
        pawnId: p.id,
        resource: 'weapon',
        itemId: p.weapon.id,
        amount: -1,
        reason: 'raider left carrying weapon',
      });
  if (s.tick % 100 === 0) audit();
  for (const p of s.pawns)
    if (p.cargo) {
      const k = p.cargo.resource + '@' + p.z;
      report.carriedLayers[k] = (report.carriedLayers[k] ?? 0) + 1;
    }
}
function until(name, done, max = 60000) {
  const before = s.tick;
  while (!done() && s.tick - before < max) step();
  assert(
    done(),
    JSON.stringify({
      name,
      tick: s.tick,
      counts: s.counts(),
      jobs: s.jobs,
      pawns: s.pawns.map((p) => ({ id: p.id, reason: p.reason, food: p.food, rest: p.rest })),
    }),
  );
  check(name, { elapsed: s.tick - before });
}
async function save(name) {
  const data = s.save(),
    bytes = JSON.stringify(data) + '\n',
    file = OUT + '/' + name + '.json';
  await writeFile(file, bytes);
  report.fixtures[name] = {
    file,
    tick: s.tick,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return data;
}
const smithy = () => s.weaponBenches.find((b) => b.kind === 'smithy');
const bill = (kind, target, paused = false) =>
  command({ type: 'armorBill', benchId: smithy().id, kind, target, paused });
try {
  assert.equal(s.save().version, 21);
  assert.equal(s.command({ type: 'research', project: 'PlateArmor' }).ok, false);
  check('plate research is locked behind its real prerequisites');
  report.layout = await researchOpening({
    getSim: () => s,
    command,
    until,
    check,
    projects: ['Smithing', 'PlateArmor'],
    steelTarget: 400,
    elevated: true,
    fixture: async (name, layout) => {
      report.layout = layout;
      await save(name);
    },
  });
  const { bench, base } = report.layout;
  const smith = { x: bench.x, y: bench.y + 3, z: bench.z };
  // The smithy's operating cell is one row in front; build its access before placing it.
  for (let dx = 0; dx <= 4; dx++) place('floor', { x: base.x + dx, y: base.y + 4, z: bench.z });
  until(
    'an actual upper-floor operating aisle is built for the smithy',
    () => !s.jobs.some((j) => j.kind === 'floor'),
  );
  place('smithy', smith, { axis: 'x' });
  until('physical steel reaches the upper-floor smithy construction', () => !!smithy());
  report.layout.smithy = point(smithy());
  await save('smithy-ready');
  // Replenish real fuel after the long research opening.
  const trees = s.trees
    .filter(
      (t) =>
        t.growth >= 0.8 &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => {
          const p = { ...t, x: t.x + dx, y: t.y + dy };
          return s.standable(p) && s.path(s.pawns[0], p) !== null;
        }),
    )
    .sort(
      (a, b) =>
        Math.abs(a.x - base.x) +
        Math.abs(a.y - base.y) -
        Math.abs(b.x - base.x) -
        Math.abs(b.y - base.y),
    )
    .slice(0, 12);
  for (const t of trees) place('cut', t);
  until(
    'normal forestry replenishes fuel for real armor work',
    () => !s.jobs.some((j) => j.kind === 'cut'),
  );
  const crafter = colonists().sort((a, b) => b.skills.crafting.level - a.skills.crafting.level)[0];
  report.crafterId = crafter.id;
  for (const p of colonists())
    command({ type: 'priority', pawnId: p.id, work: 'craft', value: p.id === crafter.id ? 1 : 0 });
  const steelBefore = s.stats.consumed.steel;
  bill('simpleHelmet', 1);
  until('forty steel is delivered and actual helmet forging starts', () =>
    s.jobs.some((j) => j.kind === 'armorsmith' && j.delivered.steel === 40 && j.progress > 40),
  );
  const beforePause = s.counts().steel;
  await save('helmet-working');
  bill('simpleHelmet', 1, true);
  until(
    'pause returns steel and leaves no finished helmet',
    () => !s.jobs.some((j) => j.kind === 'armorsmith'),
  );
  assert.equal(s.counts().steel, beforePause);
  assert.equal(pieces().filter((p) => p.kind === 'simpleHelmet').length, 0);
  bill('simpleHelmet', 1);
  until('resumed helmet completes once with stored crafter quality', () =>
    pieces().some((p) => p.kind === 'simpleHelmet'),
  );
  bill('simpleHelmet', 1, true);
  bill('plateArmor', 1);
  until('plate receives one hundred seventy steel and starts finite work', () =>
    s.jobs.some(
      (j) => j.kind === 'armorsmith' && j.apparelKind === 'plateArmor' && j.progress > 60,
    ),
  );
  const middle = await save('plate-working');
  s = VoxelSimulation.load(middle);
  for (const before of middle.jobs) {
    const after = s.jobs.find((j) => j.id === before.id);
    assert(after);
    for (const field of [
      'kind',
      'apparelKind',
      'delivered',
      'cost',
      'progress',
      'work',
      'workTicks',
      'qualityRoll',
    ])
      assert.deepEqual(after[field], before[field]);
  }
  check('mid-forging reload preserves delivered inputs and work before normal reassignment');
  until(
    'plate reaches its last work interval through ordinary needs and fuel',
    () =>
      s.jobs.some(
        (j) =>
          j.kind === 'armorsmith' && j.apparelKind === 'plateArmor' && j.progress >= j.work - 100,
      ),
    120000,
  );
  await save('plate-finishing');
  until('steel plate finishes and exists as one physical quality item', () =>
    pieces().some((p) => p.kind === 'plateArmor'),
  );
  bill('plateArmor', 1, true);
  assert.equal(s.stats.consumed.steel - steelBefore, 210);
  assert.equal(s.stats.produced.apparel, 2);
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'haul', value: 0 });
  until('finished armor is available on the ground', () => !s.pawns.some((p) => p.cargo?.apparel));
  await save('ready');
  const wearerId = s.pawns[0].id,
    wearer = () => s.pawns.find((p) => p.id === wearerId);
  report.wearerId = wearerId;
  for (const w of Object.keys(wearer().priorities))
    command({ type: 'priority', pawnId: wearerId, work: w, value: 0 });
  for (const kind of ['simpleHelmet', 'plateArmor']) {
    const item = pieces().find((p) => p.kind === kind);
    command({ type: 'wear', pawnId: wearerId, apparelId: item.id });
    until('colonist physically fetches and wears ' + kind, () =>
      wearer().worn.some((p) => p.id === item.id),
    );
  }
  assert.equal(wearer().worn.length, 4);
  assert(
    report.carriedLayers['steel@' + smith.z] > 0 && report.carriedLayers['steel@' + base.z] > 0,
  );
  await save('equipped');
  check('helmet and plate coexist with inner clothes after real cross-level delivery', {
    armor: wearer().worn,
  });
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'care', value: 0 });
  command({ type: 'threats', enabled: true });
  until('ordinary storyteller calendar produces a reachable raid', () => !!enemy(), 12000 * 15);
  command({ type: 'threats', enabled: false });
  const hp = Object.fromEntries(wearer().worn.map((p) => [p.id, p.hitPoints]));
  report.armorBeforeCombat = structuredClone(wearer().worn);
  for (const p of colonists()) {
    command({ type: 'draft', pawnId: p.id, drafted: true });
    command({ type: 'attack', pawnId: p.id, targetId: enemy().id });
  }
  await save('raid');
  until('defenders stop the ordinary raid', () => s.pawns.every(p => p.faction !== 'raider' || p.dead || p.downed || p.retreating), 20000);
  report.armorAfterCombat = structuredClone(wearer().worn);
  report.observedArmorHit = wearer().worn.some(
    (p) => p.material === 'steel' && p.hitPoints < hp[p.id],
  );
  check('ordinary combat records its actual armor and injury outcome without forcing a hit', {
    observedArmorHit: report.observedArmorHit,
    pawns: colonists().map((p) => ({ id: p.id, trauma: p.trauma, worn: p.worn })),
  });
  for (const p of colonists()) {
    if (p.drafted) command({ type: 'draft', pawnId: p.id, drafted: false });
    if (!p.downed) command({ type: 'priority', pawnId: p.id, work: 'care', value: 1 });
  }
  const final = await save('combat-after');
  s = VoxelSimulation.load(final);
  assert.deepEqual(
    s.pawns.map((p) => p.worn),
    final.pawns.map((p) => p.worn),
  );
  audit();
  check('combat equipment identities and durability survive final reload');
  report.final = { tick: s.tick, counts: s.counts(), stats: s.stats, research: s.research };
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  await save('failure');
  process.exitCode = 1;
  console.error(String(e));
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(OUT + '/report.json', JSON.stringify(report, null, 2) + '\n');
}
