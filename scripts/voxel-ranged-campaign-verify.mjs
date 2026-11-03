import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { researchOpening } from './voxel-research-opening.mjs';

const OUT = process.env.VOXEL_RANGED_OUT ?? 'test-results/voxel-ranged-campaign';
await mkdir(OUT, { recursive: true });
const bundle = await build({
  entryPoints: ['src/voxel/world.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const executedBytes = Buffer.from(bundle.outputFiles[0].text);
const execution = {
  bundle: OUT + '/executed-world.mjs',
  sha256: createHash('sha256').update(executedBytes).digest('hex'),
  scriptSha256: createHash('sha256')
    .update(await readFile(new URL(import.meta.url)))
    .digest('hex'),
  openingSha256: createHash('sha256')
    .update(await readFile(new URL('./voxel-research-opening.mjs', import.meta.url)))
    .digest('hex'),
};
await writeFile(execution.bundle, executedBytes);
const { VoxelSimulation } = await import(
  'data:text/javascript;base64,' + executedBytes.toString('base64')
);
let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
const initial = s.counts();
let report = {
  startedAt: new Date().toISOString(),
  status: 'running',
  scope:
    'Fresh v18 colony. Only normal commands, step and save/load mutate simulation. Read-only terrain/path inspection selects sites. No injected resources, research, skills, positions, weapons, injuries, time or enemies. This single campaign is not a probability experiment.',
  execution,
  commands: [],
  checks: [],
  fixtures: {},
  externalTransfers: [],
  carriedLayers: {},
  errors: [],
};
const resume = process.env.VOXEL_RANGED_RESUME;
if (resume) {
  assert(
    ['research-ready', 'machining-built', 'weapons-crafted'].includes(resume),
    'Only recorded normal production checkpoints are resumable',
  );
  report = JSON.parse(await readFile(OUT + '/report.json', 'utf8'));
  const fileName = resume === 'machining-built' && !report.fixtures[resume] ? 'failure' : resume;
  const bytes = await readFile(OUT + '/' + fileName + '.json'),
    record = report.fixtures[fileName];
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
  s = VoxelSimulation.load(JSON.parse(bytes));
  report.commands = report.commands.filter((c) => c.tick <= record.tick);
  report.checks = report.checks.filter((c) => c.tick <= record.tick);
  report.externalTransfers = report.externalTransfers.filter((c) => c.tick <= record.tick);
  report.resume = {
    name: resume,
    tick: record.tick,
    sha256: record.sha256,
    at: new Date().toISOString(),
    previousErrors: report.errors,
    previousExecution: report.execution,
  };
  report.execution = execution;
  report.errors = [];
  report.status = 'running';
}
const point = ({ x, y, z }) => ({ x, y, z }),
  key = (p) => `${p.x}/${p.y}/${p.z}`,
  at = (p) => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const colonists = () => s.pawns.filter((p) => p.faction === 'colony');
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
      r + ' conservation ' + s.tick,
    );
  assert(
    colonists().every((p) => !p.dead),
    'colonists survive documented scenario',
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
        reason: 'scheduled raider carried weapon onto map',
      });
  for (const p of before)
    if (!s.pawns.some((q) => q.id === p.id) && p.weapon)
      report.externalTransfers.push({
        tick: s.tick,
        pawnId: p.id,
        resource: 'weapon',
        itemId: p.weapon.id,
        amount: -1,
        reason: 'retreating raider carried weapon off map',
      });
  if (s.tick % 100 === 0) audit();
  for (const p of s.pawns)
    if (p.cargo) {
      const k = p.cargo.resource + '@' + p.z;
      report.carriedLayers[k] = (report.carriedLayers[k] ?? 0) + 1;
    }
}
function until(name, done, max = 60000) {
  const start = s.tick;
  while (!done() && s.tick - start < max) step();
  assert(
    done(),
    JSON.stringify({
      name,
      tick: s.tick,
      counts: s.counts(),
      jobs: s.jobs,
      people: s.pawns.map((p) => ({ id: p.id, reason: p.reason, food: p.food, rest: p.rest })),
    }),
  );
  check(name, { elapsed: s.tick - start });
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
  await writeFile(OUT + '/report.json', JSON.stringify(report, null, 2) + '\n');
  return data;
}
function occupied(p) {
  return (
    !!s.ladders[at(p)] ||
    s.treePlots.some((q) => key(q) === key(p)) ||
    s.farms.some((q) => key(q) === key(p)) ||
    s.stockpiles.some((q) => key(q) === key(p)) ||
    s.items.some((q) => key(q) === key(p)) ||
    s.jobs.some((q) => key(q) === key(p)) ||
    s.trees.some((q) => key(q) === key(p)) ||
    s.sandbags.some((q) => key(q) === key(p)) ||
    s.stoves.some((q) => key(q) === key(p)) ||
    s.beds.some((q) => key(q) === key(p)) ||
    s.weaponBenches.some((q) => key(q) === key(p))
  );
}
function surface() {
  const out = [];
  for (let x = 3; x < 60; x++)
    for (let y = 3; y < 60; y++) {
      let z = 14;
      while (z > 0 && !s.blocks[at({ x, y, z })]) z--;
      const p = { x, y, z: z + 1 };
      if (s.standable(p) && !s.ladders[at(p)] && !occupied(p)) out.push(p);
    }
  return out.sort((a, b) => distance(a, s.spawn) - distance(b, s.spawn));
}
function forestry(n = 12) {
  const trees = s.trees
    .filter(
      (t) =>
        t.growth >= 0.8 &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => s.path(s.pawns[0], { x: t.x + dx, y: t.y + dy, z: t.z }) !== null),
    )
    .sort((a, b) => distance(a, s.spawn) - distance(b, s.spawn))
    .slice(0, n);
  for (const t of trees) place('cut', t);
  until(
    'forestry replenishes finite construction and fuel wood',
    () => !s.jobs.some((j) => j.kind === 'cut'),
  );
}
const machining = () => s.weaponBenches.find((b) => b.kind === 'machining');
const weapon = (kind) => s.items.find((i) => i.weapon?.kind === kind)?.weapon;
try {
  if (!resume) {
    assert.equal(s.save().version, 18);
    assert.equal(s.command({ type: 'research', project: 'Gunsmithing' }).ok, false);
    check('firearm research requires its real prerequisite');
    report.layout = await researchOpening({
      getSim: () => s,
      command,
      until,
      check,
      projects: ['Smithing', 'Machining', 'Gunsmithing', 'BlowbackOperation'],
      steelTarget: 400,
      foodPlots: 160,
      elevated: true,
      fixture: async (name, layout) => {
        report.layout = layout;
        await save(name);
      },
    });
    await save('research-ready');
  }
  if (!resume || resume === 'research-ready') {
    const missingPlots = Math.max(0, 160 - s.farms.length);
    for (const p of surface()
      .filter((p) => [1, 8, 10].includes(s.blocks[at({ ...p, z: p.z - 1 })]))
      .slice(0, missingPlots))
      place('farm', p, { crop: 'rice' });
    until(
      'harvest and cooking restore a food reserve before industrial construction',
      () => s.counts().grain >= 150 || s.counts().meal >= 20,
      30000,
    );
    const { base, bench, shaft } = report.layout,
      lower = shaft.z - 3;
    if (s.counts().components < 12) {
      const ores = [];
      for (let x = 3; x < 61; x++)
        for (let y = 3; y < 61; y++)
          if (s.blocks[at({ x, y, z: lower })] === 6 || s.blocks[at({ x, y, z: lower + 1 })] === 6)
            ores.push({ x, y, z: lower });
      ores.sort(
        (a, b) => distance(a, { ...shaft, z: lower }) - distance(b, { ...shaft, z: lower }),
      );
      for (const ore of ores) {
        if (s.counts().components >= 12) break;
        const line = [];
        for (let x = shaft.x; x !== ore.x; x += Math.sign(ore.x - shaft.x))
          line.push({ x, y: shaft.y, z: lower });
        for (let y = shaft.y; y !== ore.y; y += Math.sign(ore.y - shaft.y))
          line.push({ x: ore.x, y, z: lower });
        line.push(ore);
        for (const p of line)
          if (s.blocks[at(p)] || s.blocks[at({ ...p, z: p.z + 1 })]) place('mine', p);
        until(
          'miners physically extract finite underground components',
          () => !s.jobs.some((j) => j.kind === 'mine'),
        );
      }
    }
    assert(s.counts().components >= 12);
    forestry();
    const cotton = surface()
      .filter((p) => [1, 8, 10].includes(s.blocks[at({ ...p, z: p.z - 1 })]))
      .slice(0, 20);
    assert.equal(cotton.length, 20);
    for (const p of cotton) place('farm', p, { crop: 'cotton' });
    for (let dx = 0; dx <= 4; dx++) place('floor', { x: base.x + dx, y: base.y + 4, z: bench.z });
    until(
      'upper machining aisle is built with carried wood',
      () => !s.jobs.some((j) => j.kind === 'floor'),
    );
    place('machining', { x: bench.x, y: bench.y + 3, z: bench.z }, { axis: 'x' });
    until('150 steel and 5 components form the upper-floor machining bench', () => !!machining());
    report.layout.machining = point(machining());
    await save('machining-built');
  }
  if (resume !== 'weapons-crafted') {
    const { base, bench } = report.layout;
    const site = surface().find(
      (p) =>
        p.z === base.z &&
        distance(p, base) < 20 &&
        [0, 1, 2].every((dx) =>
          [0, 1, 2].every((dy) => {
            const q = { x: p.x + dx, y: p.y + dy, z: p.z };
            return s.standable(q) && !occupied(q);
          }),
        ),
    );
    assert(site, 'generator site near research complex');
    place('generator', site, { axis: 'x' });
    until('physical generator construction and hauling supplies fuel', () =>
      s.devices.some((d) => d.kind === 'generator' && d.fuel > 0),
    );
    report.layout.generator = point(s.devices.find((d) => d.kind === 'generator'));
    const wires = [];
    for (let x = site.x; x !== base.x; x += Math.sign(base.x - site.x))
      wires.push({ x, y: site.y, z: base.z });
    for (let y = site.y; y !== base.y; y += Math.sign(base.y - site.y))
      wires.push({ x: base.x, y, z: base.z });
    for (let z = base.z; z <= bench.z; z++) wires.push({ x: base.x, y: base.y, z });
    for (const p of wires) place('wire', p);
    until(
      'real vertical wires power the 350 W upper-floor load',
      () => !!machining().power.powered,
    );
    const crafter = colonists().sort(
      (a, b) => b.skills.crafting.level - a.skills.crafting.level,
    )[0];
    report.crafterId = crafter.id;
    for (const p of colonists())
      command({
        type: 'priority',
        pawnId: p.id,
        work: 'craft',
        value: p.id === crafter.id ? 1 : 0,
      });
    const beforeSteel = s.stats.consumed.steel,
      beforeComponents = s.stats.consumed.components;
    command({
      type: 'weaponBill',
      benchId: machining().id,
      kind: 'revolver',
      target: 1,
      paused: false,
    });
    until('revolver ingredients arrive and powered machining begins', () =>
      s.jobs.some((j) => j.weaponKind === 'revolver' && j.progress > 25),
    );
    await save('machining-working');
    const job = s.jobs.find((j) => j.weaponKind === 'revolver'),
      progress = job.progress,
      delivered = structuredClone(job.delivered);
    command({ type: 'benchPower', benchId: machining().id, on: false });
    for (let i = 0; i < 100; i++) step();
    assert.equal(job.progress, progress);
    assert.deepEqual(job.delivered, delivered);
    await save('machining-power-off');
    s = VoxelSimulation.load(s.save());
    assert.equal(s.jobs.find((j) => j.id === job.id).progress, progress);
    command({ type: 'benchPower', benchId: machining().id, on: true });
    until('revolver finishes once after a real switch-off and reload', () => !!weapon('revolver'));
    assert.equal(s.stats.consumed.steel - beforeSteel, 30);
    assert.equal(s.stats.consumed.components - beforeComponents, 2);
    command({
      type: 'weaponBill',
      benchId: machining().id,
      kind: 'machinePistol',
      target: 1,
      paused: false,
    });
    until(
      'three-shot machine pistol is crafted with finite materials',
      () => !!weapon('machinePistol'),
    );
    const spot = surface().find((p) => s.path(s.pawns[0], p) !== null);
    assert(spot);
    place('craftingSpot', spot);
    const spotId = s.weaponBenches.find((b) => b.kind === 'craftingSpot').id;
    command({ type: 'weaponBill', benchId: spotId, kind: 'shortBow', target: 1, paused: false });
    until(
      'short bow is crafted from 30 carried wood at a normal crafting spot',
      () => !!weapon('shortBow'),
    );
    await save('weapons-crafted');
  }
  until(
    'cotton grows and harvest provides real sandbag cloth',
    () => s.counts().cloth >= 15,
    180000,
  );
  const bagSite = surface().find((p) =>
    [0, 1, 2].every((dx) => s.standable({ ...p, x: p.x + dx }) && !occupied({ ...p, x: p.x + dx })),
  );
  assert(bagSite);
  place('sandbag', bagSite, { to: { ...bagSite, x: bagSite.x + 2 } });
  until(
    'three cloth sandbags are built through normal line designation',
    () => s.sandbags.length === 3,
  );
  report.layout.sandbags = s.sandbags.map(point);
  for (const [i, kind] of ['shortBow', 'revolver', 'machinePistol'].entries()) {
    const p = colonists()[i],
      w = weapon(kind);
    assert(w);
    command({ type: 'equipWeapon', pawnId: p.id, weaponId: w.id });
    until(
      'colonist physically picks up ' + kind,
      () => s.pawns.find((q) => q.id === p.id).weapon?.kind === kind,
    );
  }
  await save('equipped');
  audit();
  command({ type: 'threats', enabled: true });
  until(
    'first scheduled raider enters carrying the original knife',
    () => s.combat.wave >= 1,
    40000,
  );
  for (const p of colonists())
    if (!p.downed) command({ type: 'draft', pawnId: p.id, drafted: true });
  let enemy = s.pawns.find((p) => p.faction === 'raider' && !p.dead && !p.downed);
  assert(enemy);
  report.firstEnemyId = enemy.id;
  for (const p of colonists())
    if (!p.downed) command({ type: 'attack', pawnId: p.id, targetId: enemy.id });
  until('normal attack orders begin timed aiming', () => colonists().some((p) => p.shooting));
  await save('aiming');
  until('a physical projectile leaves a crafted weapon', () => s.projectiles.length > 0);
  await save('flight');
  const flight = s.save();
  s = VoxelSimulation.load(flight);
  assert.deepEqual(s.projectiles, flight.projectiles);
  until(
    'ordinary ranged fire records a real impact',
    () => s.combatEvents.some((e) => e.kind === 'hit' || e.kind === 'deflect'),
    10000,
  );
  await save('impact');
  until(
    'first attacker is stopped by real combat',
    () => {
      const p = s.pawns.find((q) => q.id === report.firstEnemyId);
      return !p || p.dead || p.downed;
    },
    15000,
  );
  for (const p of colonists())
    if (!p.dead && !p.downed) command({ type: 'draft', pawnId: p.id, drafted: false });
  await save('first-combat-after');
  until('a later scheduled wave carries a native short bow', () => s.combat.wave >= 2, 100000);
  enemy = s.pawns.find((p) => p.faction === 'raider' && !p.dead && !p.downed && !p.retreating);
  assert(enemy);
  assert.equal(enemy.weapon.kind, 'shortBow');
  report.rangedEnemyId = enemy.id;
  for (const p of colonists())
    if (!p.downed) {
      command({ type: 'draft', pawnId: p.id, drafted: true });
      command({ type: 'attack', pawnId: p.id, targetId: enemy.id });
    }
  until(
    'scheduled ranged opponent completes real warmup and fires',
    () => s.combatEvents.some((e) => e.kind === 'fire' && e.shooterId === report.rangedEnemyId),
    15000,
  );
  await save('enemy-flight');
  until(
    'ranged engagement produces impact or resolved miss',
    () => s.combatEvents.some((e) => e.shooterId === report.rangedEnemyId && e.kind !== 'fire'),
    10000,
  );
  await save('ranged-combat');
  audit();
  check('finite resource conservation holds through crafting, cover and scheduled weapon arrivals');
  report.status = 'passed';
  report.finishedAt = new Date().toISOString();
  report.finalTick = s.tick;
  await save('final');
  console.log(
    JSON.stringify({ status: report.status, checks: report.checks.length, tick: s.tick }),
  );
} catch (error) {
  report.status = 'failed';
  report.errors.push(String(error?.stack ?? error));
  await save('failure');
  throw error;
} finally {
  await writeFile(OUT + '/report.json', JSON.stringify(report, null, 2) + '\n');
}
