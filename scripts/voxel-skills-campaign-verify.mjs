import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_SKILLS_OUT ?? 'test-results/voxel-skills-campaign';
await mkdir(OUT, { recursive: true });
// Reuse the real opening workflow as a prerequisite, rather than grant a workshop or metal.
process.env.VOXEL_WEAPONS_OUT = OUT + '/opening';
await import('./voxel-weapons-campaign-verify.mjs');
const opening = JSON.parse(await readFile(OUT + '/opening/report.json', 'utf8'));
assert.equal(opening.status, 'passed');
const bundled = await build({
  entryPoints: ['src/voxel/world.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { VoxelSimulation } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
);
const input = await readFile(OUT + '/opening/final.json');
let s = VoxelSimulation.load(JSON.parse(input));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const initial = new VoxelSimulation(73129, {
  hilliness: 'flat',
  meanTemperature: 24,
  latitude: 0,
}).counts();
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Fresh-world weapon opening, then continued ordinary mining, forestry and elevated smithing to train a passionate crafter. No terrain, resources, health, positions, skills, XP, progress or clock injections. Commands/step/save/load only; read-only spatial queries.',
  opening: {
    file: OUT + '/opening/report.json',
    checks: opening.checks.length,
    saveSha256: sha(input),
  },
  checks: [],
  commands: [],
  fixtures: {},
  errors: [],
  status: 'running',
};
const check = (name, detail = {}) => {
  report.checks.push({ name, tick: s.tick, ...detail });
  console.log('PASS', name, s.tick);
};
function command(c) {
  const r = s.command(c);
  report.commands.push({ tick: s.tick, command: c, result: r });
  assert(r.ok, JSON.stringify({ c, r }));
}
const point = (p) => ({ x: p.x, y: p.y, z: p.z });
const at = (p) => (p.z * 64 + p.y) * 64 + p.x;
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const place = (tool, p) => command({ type: 'designate', tool, from: point(p) });
const pieces = () => [
  ...s.items.flatMap((i) => (i.weapon ? [i.weapon] : [])),
  ...s.pawns.flatMap((p) => [
    ...(p.weapon ? [p.weapon] : []),
    ...(p.cargo?.weapon ? [p.cargo.weapon] : []),
  ]),
];
function audit() {
  const c = s.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      c[r] + s.stats.consumed[r] + s.stats.spoiled[r] + s.stats.destroyed[r],
      initial[r] + s.stats.produced[r],
      r + ' balance',
    );
  assert.equal(pieces().length, new Set(pieces().map((p) => p.id)).size);
  assert(s.pawns.every((p) => !p.dead && !p.downed));
}
function step() {
  s.step();
  if (s.tick % 100 === 0) audit();
}
function until(name, done, limit = 60000) {
  const tick = s.tick;
  while (!done() && s.tick - tick < limit) step();
  assert(
    done(),
    name +
      JSON.stringify({
        tick: s.tick,
        jobs: s.jobs,
        pawns: s.pawns.map((p) => ({
          name: p.name,
          reason: p.reason,
          food: p.food,
          skill: p.skills.crafting,
        })),
      }),
  );
  check(name, { elapsed: s.tick - tick });
}
async function save(name) {
  const data = s.save(),
    bytes = JSON.stringify(data) + '\n',
    file = OUT + '/' + name + '.json';
  await writeFile(file, bytes);
  report.fixtures[name] = { file, sha256: sha(bytes), tick: data.tick };
  return data;
}
try {
  assert.equal(s.save().version, 15);
  const crafterId = s.pawns[2].id,
    before = structuredClone(s.pawns.map((p) => p.skills));
  report.beforeSkills = before;
  assert(s.pawns.some((p) => p.skills.mining.xp > 0));
  assert(s.pawns.some((p) => p.skills.construction.xp > 0));
  assert(s.pawns.some((p) => p.skills.plants.xp > 0));
  check('ordinary opening has already trained mining, construction, plants and crafting');
  for (const p of s.pawns) {
    if (p.drafted) command({ type: 'draft', pawnId: p.id, drafted: false });
    command({ type: 'priority', pawnId: p.id, work: 'craft', value: p.id === crafterId ? 1 : 0 });
  }
  const nearby = s.trees
    .filter(
      (t) =>
        t.growth >= 0.8 &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => {
          const q = { ...t, x: t.x + dx, y: t.y + dy };
          return s.standable(q) && s.path(s.pawns[0], q) !== null;
        }),
    )
    .sort((a, b) => dist(a, s.spawn) - dist(b, s.spawn))
    .slice(0, 10);
  for (const t of nearby) place('cut', t);
  until(
    'normal forestry supplies fuel for prolonged training',
    () => !s.jobs.some((j) => j.kind === 'cut'),
  );
  const shaft = opening.layout.shaft,
    z = shaft.z - 3,
    ores = [];
  for (let y = 3; y < 61; y++)
    for (let x = 3; x < 61; x++)
      if (s.blocks[at({ x, y, z })] === 3 || s.blocks[at({ x, y, z: z + 1 })] === 3)
        ores.push({ x, y, z });
  ores.sort((a, b) => dist(a, { ...shaft, z }) - dist(b, { ...shaft, z }));
  for (const ore of ores) {
    if (s.counts().steel >= 400) break;
    const line = [];
    for (let x = shaft.x; x !== ore.x; x += Math.sign(ore.x - shaft.x))
      line.push({ x, y: shaft.y, z });
    for (let y = shaft.y; y !== ore.y; y += Math.sign(ore.y - shaft.y))
      line.push({ x: ore.x, y, z });
    line.push(ore);
    for (const p of line) if (s.blocks[at(p)] || s.blocks[at({ ...p, z: z + 1 })]) place('mine', p);
    until(
      'continued actual mining supplies training metal with skill-based yield',
      () => !s.jobs.some((j) => j.kind === 'mine'),
    );
  }
  assert(s.counts().steel >= 400);
  const bench = s.weaponBenches.find((b) => b.kind === 'smithy');
  command({
    type: 'weaponBill',
    benchId: bench.id,
    kind: 'steelLongsword',
    target: 5,
    paused: false,
  });
  until('passionate crafter physically starts the elevated order', () =>
    s.jobs.some((j) => j.kind === 'smith' && j.owner === crafterId && j.progress > 50),
  );
  await save('training');
  const resume = s.save();
  s = VoxelSimulation.load(resume);
  assert.deepEqual(
    s.pawns.map((p) => p.skills),
    resume.pawns.map((p) => p.skills),
  );
  assert.deepEqual(
    s.jobs.map((j) => j.workTicks),
    resume.jobs.map((j) => j.workTicks),
  );
  check('mid-work save preserves exact experience and work clocks');
  until(
    'four additional swords finish using physical fuel and delivered metal',
    () => pieces().filter((w) => w.kind === 'steelLongsword').length === 5,
  );
  const crafter = s.pawns.find((p) => p.id === crafterId);
  assert(crafter.skills.crafting.level > before[2].crafting.level);
  check('ordinary repeated crafting raises a skill level without injected experience', {
    before: before[2].crafting,
    after: crafter.skills.crafting,
  });
  assert(
    pieces()
      .filter((w) => w.kind !== 'woodClub')
      .every((w) => w.quality >= 0 && w.quality <= 5),
  );
  assert.equal(pieces().find((w) => w.kind === 'woodClub').quality, 2);
  check(
    'finished steel quality is stored per item while the club retains its no-quality sentinel',
    { weapons: pieces() },
  );
  audit();
  const final = await save('final');
  assert.deepEqual(
    VoxelSimulation.load(final).pawns.map((p) => p.skills),
    final.pawns.map((p) => p.skills),
  );
  report.final = {
    tick: s.tick,
    version: final.version,
    counts: s.counts(),
    stats: s.stats,
    skills: s.pawns.map((p) => ({ id: p.id, name: p.name, skills: p.skills })),
    weapons: pieces(),
  };
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  throw e;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(OUT + '/report.json', JSON.stringify(report, null, 2) + '\n');
}
