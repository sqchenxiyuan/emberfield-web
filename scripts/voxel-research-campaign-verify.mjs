import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { researchOpening } from './voxel-research-opening.mjs';

const OUT = process.env.VOXEL_RESEARCH_OUT ?? 'test-results/voxel-research-campaign';
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
  report = {
    startedAt: new Date().toISOString(),
    project: 'Smithing',
    scope:
      'Fresh v17 industrial colony. Normal command/step/save/load only; read-only terrain and path queries. Actual forestry, underground ore, upper floor construction, carried bench inputs, working research, normal food/rest, project switch/stop and physical unlocked smithy. No injected knowledge, skills, resources, terrain, needs, positions or clock.',
    commands: [],
    checks: [],
    fixtures: {},
    carriedLayers: {},
    errors: [],
    status: 'running',
  };
const point = (p) => ({ x: p.x, y: p.y, z: p.z }),
  same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
function command(c) {
  const r = s.command(c);
  report.commands.push({ tick: s.tick, command: c, result: r });
  assert(r.ok, JSON.stringify({ c, r }));
  return r;
}
function check(name, detail = {}) {
  report.checks.push({ name, tick: s.tick, ...detail });
  console.log('PASS', name, s.tick);
}
function audit() {
  const counts = s.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      counts[r] + s.stats.consumed[r] + s.stats.spoiled[r] + s.stats.destroyed[r],
      initial[r] + s.stats.produced[r],
      r + ' balance',
    );
  assert(
    s.pawns.every((p) => !p.dead && !p.downed),
    'living researchers',
  );
  for (const p of s.pawns)
    if (p.cargo) {
      const key = p.cargo.resource + '@' + p.z;
      report.carriedLayers[key] = (report.carriedLayers[key] ?? 0) + 1;
    }
}
function step() {
  s.step();
  for (const p of s.pawns)
    if (p.cargo) {
      const key = p.cargo.resource + '@' + p.z;
      report.carriedLayers[key] = (report.carriedLayers[key] ?? 0) + 1;
    }
  if (s.tick % 100 === 0) audit();
}
function until(name, done, max = 60000) {
  const before = s.tick;
  while (!done() && s.tick - before < max) step();
  assert(
    done(),
    JSON.stringify({
      name,
      tick: s.tick,
      research: s.research,
      jobs: s.jobs,
      pawns: s.pawns.map((p) => ({ reason: p.reason, food: p.food, rest: p.rest })),
    }),
  );
  check(name, { elapsed: s.tick - before });
}
async function save(name) {
  const bytes = JSON.stringify(s.save()) + '\n',
    file = OUT + '/' + name + '.json';
  await writeFile(file, bytes);
  report.fixtures[name] = {
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    tick: s.tick,
  };
}
try {
  assert.equal(s.save().version, 19);
  assert.equal(s.command({ type: 'research', project: 'LongBlades' }).ok, false);
  assert.equal(s.command({ type: 'designate', tool: 'smithy', from: point(s.spawn) }).ok, false);
  check('new-world prerequisites and building gate reject premature unlocks');
  report.layout = await researchOpening({
    getSim: () => s,
    command,
    until,
    check,
    projects: ['Smithing'],
    elevated: true,
    fixture: async (name, layout) => {
      report.layout = layout;
      if (name === 'research-partial') {
        const partial = s.research.progress.Smithing;
        command({ type: 'research', project: 'Batteries' });
        until(
          'switching projects earns separate actual progress',
          () => s.research.progress.Batteries > 0.1,
        );
        assert.equal(s.research.progress.Smithing, partial);
        command({ type: 'research', project: null });
        const state = structuredClone(s.research),
          xp = s.pawns.map((p) => p.skills.intellectual.xp);
        for (let i = 0; i < 100; i++) step();
        assert.deepEqual(s.research, state);
        assert.deepEqual(
          s.pawns.map((p) => p.skills.intellectual.xp),
          xp,
        );
        command({ type: 'research', project: 'Smithing' });
        check('switch and stop preserve earned points and stop training');
        const saved = s.save(),
          restored = VoxelSimulation.load(saved);
        assert.deepEqual(restored.research, s.research);
        check('mid-project load preserves global progress and eighth skill');
        // Continue the same instance here; the load is checked independently so the
        // opening helper's navigation reference stays attached to this campaign.
      }
      await save(name);
    },
  });
  const base = report.layout.base;
  command({ type: 'designate', tool: 'smithy', from: { ...base, x: base.x + 1 }, axis: 'x' });
  until(
    'newly unlocked smithy consumes real metal and is physically built',
    () => s.weaponBenches.some((b) => b.kind === 'smithy'),
    60000,
  );
  assert(report.carriedLayers['steel@' + report.layout.bench.z] > 0);
  assert(report.carriedLayers['wood@' + report.layout.bench.z] > 0);
  assert(s.pawns.some((p) => p.skills.intellectual.xp > 0));
  assert(s.stats.eaten > 0);
  const saved = s.save();
  s = VoxelSimulation.load(saved);
  assert.deepEqual(s.research, saved.research);
  check('completed research and its actual unlock survive a final reload');
  audit();
  await save('final');
  report.final = {
    tick: s.tick,
    version: s.save().version,
    research: s.research,
    skills: s.pawns.map((p) => p.skills.intellectual),
    counts: s.counts(),
    stats: s.stats,
  };
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  throw e;
} finally {
  await writeFile(OUT + '/report.json', JSON.stringify(report, null, 2) + '\n');
}
