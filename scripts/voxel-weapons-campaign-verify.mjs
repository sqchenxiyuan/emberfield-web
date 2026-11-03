import { researchOpening } from './voxel-research-opening.mjs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_WEAPONS_OUT ?? 'test-results/voxel-weapons-campaign';
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
const initial = s.counts(),
  sha = (b) => createHash('sha256').update(b).digest('hex');
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Fresh generator-2 colony, normal command/step/save/load and read-only terrain queries. No injected resources, terrain, health, positions, work progress or time. Actual woodcutting, underground mining, elevated smithy, physical weapons and equipment transactions.',
  checks: [],
  commands: [],
  fixtures: {},
  carriedLayers: {},
  errors: [],
  status: 'running',
};
const point = (p) => ({ x: p.x, y: p.y, z: p.z }),
  key = (p) => `${p.x}/${p.y}/${p.z}`,
  at = (p) => (p.z * 64 + p.y) * 64 + p.x;
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const pieces = () => [
  ...s.items.flatMap((i) => (i.weapon ? [i.weapon] : [])),
  ...s.pawns.flatMap((p) => [
    ...(p.weapon ? [p.weapon] : []),
    ...(p.cargo?.weapon ? [p.cargo.weapon] : []),
  ]),
];
const reachable = (p) => s.standable(p) && s.path(s.pawns[0], p) !== null;
function command(c) {
  const r = s.command(c);
  report.commands.push({ tick: s.tick, command: c, result: r });
  assert(r.ok, JSON.stringify({ c, r }));
  return r;
}
const place = (tool, p, extra = {}) =>
  command({ type: 'designate', tool, from: point(p), ...extra });
function check(name, details = {}) {
  report.checks.push({ name, tick: s.tick, ...details });
  console.log('PASS', name, s.tick);
}
function audit() {
  const c = s.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      c[r] + s.stats.consumed[r] + s.stats.spoiled[r] + s.stats.destroyed[r],
      initial[r] + s.stats.produced[r],
      r + ' balance',
    );
  assert.equal(pieces().length, new Set(pieces().map((p) => p.id)).size);
  assert.equal(c.weapon, pieces().length);
  for (const p of s.pawns) {
    assert(!p.dead && !p.downed, p.reason);
    if (p.cargo) {
      const k = p.cargo.resource + '@' + p.z;
      report.carriedLayers[k] = (report.carriedLayers[k] ?? 0) + 1;
    }
  }
}
function step() {
  s.step();
  if (s.tick % 20 === 0) audit();
}
function until(name, done, limit = 24000) {
  const start = s.tick;
  while (!done() && s.tick - start < limit) step();
  assert(
    done(),
    name +
      JSON.stringify({
        tick: s.tick,
        jobs: s.jobs,
        pawns: s.pawns.map((p) => ({ reason: p.reason, cargo: p.cargo, food: p.food })),
      }),
  );
  check(name, { elapsed: s.tick - start });
}
async function save(name) {
  const bytes = JSON.stringify(s.save()) + '\n',
    file = OUT + '/' + name + '.json';
  await writeFile(file, bytes);
  report.fixtures[name] = { file, sha256: sha(bytes), tick: s.tick };
  return JSON.parse(bytes);
}
const bill = (bench, kind, target = 1, paused = false) =>
  command({ type: 'weaponBill', benchId: bench.id, kind, target, paused });
try {
  const surface = [];
  for (let y = 2; y < 62; y++)
    for (let x = 2; x < 62; x++) {
      let z = 14;
      while (z > 0 && !s.blocks[at({ x, y, z })]) z--;
      const p = { x, y, z: z + 1 };
      if (reachable(p)) surface.push(p);
    }
  surface.sort((a, b) => dist(a, s.spawn) - dist(b, s.spawn));
  const occupied = new Set([...s.items, ...s.trees, ...s.stockpiles].map(key));
  const base = surface.find(
    (p) =>
      p.z >= 4 &&
      p.z < 11 &&
      [0, 1, 2, 3, 4].every((dx) =>
        [-1, 0, 1, 2].every((dy) => {
          const q = { ...p, x: p.x + dx, y: p.y + dy };
          return reachable(q) && !occupied.has(key(q));
        }),
      ),
  );
  assert(base, 'elevated smithy platform site');
  for (let dx = 0; dx <= 4; dx++)
    for (let dy = -1; dy <= 2; dy++) occupied.add(key({ ...base, x: base.x + dx, y: base.y + dy }));
  const spot = surface.find((p) => !occupied.has(key(p)));
  assert(spot);
  occupied.add(key(spot));
  place('craftingSpot', spot);
  const shaft = surface.find((p) => p.z >= 4 && !occupied.has(key(p)));
  assert(shaft);
  occupied.add(key(shaft));
  for (const p of surface.filter((p) => !occupied.has(key(p))).slice(0, 48)) {
    place('stock', p);
    occupied.add(key(p));
  }
  const trees = s.trees
    .filter(
      (t) =>
        t.growth >= 0.8 &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => reachable({ ...t, x: t.x + dx, y: t.y + dy })),
    )
    .sort((a, b) => dist(a, s.spawn) - dist(b, s.spawn))
    .slice(0, 12);
  assert(trees.length === 12);
  for (const t of trees) place('cut', t);
  until(
    'normal trees supply physical wood for weapons, fuel and the upper platform',
    () => s.stats.cut === 12,
  );
  bill(s.weaponBenches[0], 'woodClub');
  until(
    'the free crafting spot receives wood and produces one physical club',
    () => s.stats.weaponsMade === 1,
  );
  place('shaft', shaft);
  until(
    'workers excavate an actual three-level mineshaft',
    () => !s.jobs.some((j) => ['ladder', 'digLadder'].includes(j.kind)),
  );
  const z = shaft.z - 3,
    ores = [];
  for (let y = 3; y < 61; y++)
    for (let x = 3; x < 61; x++)
      if (s.blocks[at({ x, y, z })] === 3 || s.blocks[at({ x, y, z: z + 1 })] === 3)
        ores.push({ x, y, z });
  ores.sort((a, b) => dist(a, { ...shaft, z }) - dist(b, { ...shaft, z }));
  for (const ore of ores) {
    if (s.stats.produced.steel >= 280) break;
    const line = [];
    for (let x = shaft.x; x !== ore.x; x += Math.sign(ore.x - shaft.x))
      line.push({ x, y: shaft.y, z });
    for (let y = shaft.y; y !== ore.y; y += Math.sign(ore.y - shaft.y))
      line.push({ x: ore.x, y, z });
    line.push(ore);
    for (const p of line) if (s.blocks[at(p)] || s.blocks[at({ ...p, z: z + 1 })]) place('mine', p);
    until(
      'miners follow a reachable underground corridor to real steel',
      () => !s.jobs.some((j) => j.kind === 'mine'),
    );
  }
  assert(s.stats.produced.steel >= 280);
  check('finite ore supplied all metal without granting materials', {
    steel: s.stats.produced.steel,
  });
  bill(s.weaponBenches[0], 'steelKnife');
  until('steel is carried from the mine into a real knife recipe', () => s.stats.weaponsMade === 2);
  place('up', base);
  until(
    'wooden ladders reach the elevated workshop',
    () => s.ladders[at({ ...base, z: base.z + 3 })] === 1,
  );
  const upper = { ...base, z: base.z + 3 };
  place('floor', { ...upper, y: upper.y + 1 });
  until('upper landing is built', () => !s.jobs.some((j) => j.kind === 'floor'));
  for (let dx = 1; dx <= 4; dx++) {
    for (let dy = -1; dy <= 2; dy++) place('floor', { ...upper, x: upper.x + dx, y: upper.y + dy });
    until(
      'platform extends from physically carried wood',
      () => !s.jobs.some((j) => j.kind === 'floor'),
    );
  }
  await researchOpening({
    getSim: () => s,
    command,
    until,
    check,
    projects: ['Smithing', 'LongBlades'],
    reserved: [...surface.filter((p) => occupied.has(key(p))), ...s.weaponBenches],
  });
  const table = { ...upper, x: upper.x + 1 };
  place('smithy', table, { axis: 'x' });
  until('100 steel is delivered upstairs and the fueled smithy is built', () =>
    s.weaponBenches.some((b) => b.kind === 'smithy'),
  );
  const bench = s.weaponBenches.find((b) => b.kind === 'smithy');
  report.layout = { base, upper, table, spot, shaft };
  for (let dx = 1; dx <= 4; dx++) {
    const p = { ...upper, x: upper.x + dx, y: upper.y + 2 };
    place('stock', p);
    command({ type: 'storage', from: p, priority: 3, accepts: ['weapon'] });
  }
  bill(bench, 'steelLongsword');
  until('fuel and steel reach the upper smithy and sword work starts', () =>
    s.jobs.some((j) => j.kind === 'smith' && j.weaponKind === 'steelLongsword' && j.progress > 80),
  );
  await save('working');
  const middle = s.save(),
    progress = middle.jobs.find((j) => j.weaponKind === 'steelLongsword').progress;
  s = VoxelSimulation.load(middle);
  assert.equal(s.jobs.find((j) => j.weaponKind === 'steelLongsword').progress, progress);
  check('production reload preserves delivered metal, fuel and unfinished work');
  until('normal work reaches the last seconds of the longsword', () =>
    s.jobs.some((j) => j.weaponKind === 'steelLongsword' && j.progress >= j.work - 45),
  );
  await save('finishing');
  until(
    'one physical longsword completes after normal needs and working time',
    () => s.stats.weaponsMade === 3,
  );
  until(
    'all three weapon kinds are physically hauled onto the upper storage floor',
    () => s.items.filter((i) => i.weapon && i.z === upper.z).length === 3,
  );
  assert(report.carriedLayers['steel@' + upper.z] > 0);
  assert(report.carriedLayers['wood@' + upper.z] > 0);
  assert(report.carriedLayers['weapon@' + upper.z] > 0);
  await save('ready');
  const pawnId = s.pawns[0].id,
    club = pieces().find((w) => w.kind === 'woodClub'),
    knife = pieces().find((w) => w.kind === 'steelKnife'),
    sword = pieces().find((w) => w.kind === 'steelLongsword');
  command({ type: 'draft', pawnId, drafted: true });
  command({ type: 'equipWeapon', pawnId, weaponId: club.id });
  until(
    'drafted colonist climbs to the stockpile and equips the real club',
    () => s.pawns[0].weapon?.id === club.id,
  );
  command({ type: 'equipWeapon', pawnId, weaponId: knife.id });
  until(
    'equipping a knife drops the previous club without forbidding or duplicating it',
    () => s.pawns[0].weapon?.id === knife.id,
  );
  assert.equal(s.items.find((i) => i.weapon?.id === club.id)?.forbidden, false);
  await save('equipped');
  command({ type: 'dropWeapon', pawnId });
  for (let i = 0; i < 4; i++) step();
  assert(s.pawns[0].weapon);
  await save('dropping');
  s = VoxelSimulation.load(s.save());
  until(
    'a delayed manual drop survives reload and forbids the actual ground knife',
    () => s.pawns[0].weapon === null,
  );
  assert.equal(s.items.find((i) => i.weapon?.id === knife.id)?.forbidden, true);
  command({ type: 'equipWeapon', pawnId, weaponId: knife.id });
  assert.equal(s.items.find((i) => i.weapon?.id === knife.id)?.forbidden, false);
  until(
    'explicit re-equipping removes the ground prohibition',
    () => s.pawns[0].weapon?.id === knife.id,
  );
  command({ type: 'equipWeapon', pawnId, weaponId: sword.id });
  until(
    'the physical longsword replaces the knife while all three identities remain',
    () => s.pawns[0].weapon?.id === sword.id,
  );
  assert.deepEqual(
    pieces()
      .map((w) => w.id)
      .sort((a, b) => a - b),
    [club.id, knife.id, sword.id].sort((a, b) => a - b),
  );
  audit();
  const final = await save('final');
  s = VoxelSimulation.load(final);
  assert.equal(s.pawns[0].weapon.id, sword.id);
  check('final save keeps physical equipment, ground items and resource accounting');
  report.final = {
    tick: s.tick,
    version: final.version,
    counts: s.counts(),
    stats: s.stats,
    weapons: pieces(),
    fuel: s.weaponBenches.find((b) => b.kind === 'smithy').fuel,
  };
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  throw e;
} finally {
  await writeFile(OUT + '/report.json', JSON.stringify(report, null, 2) + '\n');
}
