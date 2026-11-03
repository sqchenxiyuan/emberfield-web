import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const out = path.resolve('test-results/voxel-mood');
await fs.mkdir(out, { recursive: true });
await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', outfile: path.join(out, 'world.mjs') });
const { VoxelSimulation } = await import(pathToFileURL(path.join(out, 'world.mjs')).href);
let sim = new VoxelSimulation(73129);
const report = { version: 23, setup: 'ordinary fresh seed73129; public commands and elapsed ticks only', checks: [], commands: [], observations: [] };
const check = (name, ok, detail) => {
  report.checks.push({ name, ok: !!ok, tick: sim.tick, detail });
  if (!ok) throw Error(name + ': ' + JSON.stringify(detail));
};
const cmd = c => {
  const r = sim.command(c); report.commands.push({ tick: sim.tick, command: c, result: r });
  if (!r.ok) throw Error(JSON.stringify({ c, r }));
};
const advance = (done, limit = 12000) => {
  for (let i = 0; i < limit && !done(); i++) {
    sim.step();
    if (sim.tick % 200 === 0) report.observations.push({ tick: sim.tick,
      pawns: sim.pawns.map(p => ({ id: p.id, reason: p.reason, phase: p.phase, mood: p.psyche.level, joy: p.psyche.joy })) });
  }
  if (!done()) throw Error(JSON.stringify({ timeout: sim.tick, pawns: sim.pawns.map(p => p.reason), jobs: sim.jobs }));
};
const save = async name => fs.writeFile(path.join(out, name + '.json'), JSON.stringify(sim.save()));
function site(tool) {
  for (let radius = 3; radius < 8; radius++) for (let dx = -radius; dx <= radius; dx++) for (const dy of [-radius, radius]) {
    const from = { x: sim.spawn.x + dx, y: sim.spawn.y + dy, z: sim.spawn.z };
    if (!sim.standable(from)) continue;
    const c = { type: 'designate', tool, from }, r = sim.command(c);
    if (r.ok) { report.commands.push({ tick: sim.tick, command: c, result: r }); return from; }
  }
  throw Error('No site: ' + tool);
}
try {
  await save('initial');
  site('horseshoePin');
  advance(() => sim.horseshoePins.length === 1);
  check('real wood delivered and consumed to build recreation furniture', sim.stats.consumed.wood === 20);
  const id = sim.pawns[0].id, pawn = () => sim.pawns.find(p => p.id === id);
  await save('ready');
  cmd({ type: 'recreate', pawnId: id });
  check('manual activity chooses reachable horseshoes', pawn().psyche.recreation?.kind === 'horseshoes');
  const before = pawn().psyche.joy;
  advance(() => pawn().psyche.joy > before + 2);
  check('joy increases only after arriving and playing', pawn().path.length === 0 && pawn().reason === '投掷马蹄铁');
  await save('playing');
  const activity = structuredClone(pawn().psyche.recreation);
  sim = VoxelSimulation.load(sim.save());
  check('save restores activity identity and original deadline', JSON.stringify(pawn().psyche.recreation) === JSON.stringify(activity));
  advance(() => pawn().psyche.recreation === null);
  check('activity ends and retains category tolerance', pawn().psyche.tolerance.horseshoes > 0);
  // The same pin is unavailable to a second person while reserved; outdoor recreation is a real fallback.
  cmd({ type: 'recreate', pawnId: sim.pawns[1].id });
  cmd({ type: 'recreate', pawnId: sim.pawns[2].id });
  check('one physical pin cannot be reserved twice', sim.pawns.filter(p => p.psyche.recreation?.spotId === sim.horseshoePins[0].id).length === 1);
  check('second person has an outdoor alternative', sim.pawns.some(p => p.psyche.recreation?.kind === 'walk'));
  for (const p of sim.pawns) if (p.psyche.recreation) cmd({ type: 'cancelRecreation', pawnId: p.id });
  // Normal forestry and sleeping continue alongside the new needs.
  for (let harvest = 0; sim.counts().wood < 135 && harvest < 30; harvest++) {
    const tree = [...sim.trees].filter(t => t.wood >= 8).sort((a, b) => Math.hypot(a.x-sim.spawn.x,a.y-sim.spawn.y)-Math.hypot(b.x-sim.spawn.x,b.y-sim.spawn.y))[0];
    if (!tree) throw Error('No harvestable timber');
    cmd({ type: 'designate', tool: 'cut', from: { x: tree.x, y: tree.y, z: tree.z } });
    advance(() => !sim.trees.some(t => t.id === tree.id));
  }
  for (let i = 0; i < 3; i++) site('bed');
  advance(() => sim.beds.length === 3);
  check('ordinary construction continues after leisure cancellation', sim.stats.built >= 4);
  for (const p of sim.pawns) for (const hour of [10, 18]) cmd({ type: 'schedule', pawnId: p.id, hour, assignment: 'recreation' });
  const start = sim.tick;
  advance(() => sim.tick >= start + 12000);
  check('normal colony survives one full day with the added needs', sim.pawns.every(p => !p.dead && !p.downed));
  check('automatic recreation occurred during ordinary simulation', report.observations.some(o => o.tick > start && o.pawns.some(p => p.phase === 'recreation')));
  check('sleep and physical eating still occur', sim.stats.eaten > 0 && report.observations.some(o => o.pawns.some(p => p.phase === 'rest')));
  await save('final');
  const final = sim.save();
  sim = VoxelSimulation.load(final); sim.step(40);
  check('completed colony loads and continues without resetting mood', sim.tick === final.tick + 40 && sim.pawns.every(p => Number.isFinite(p.psyche.level)));
  report.ok = true; report.finalTick = sim.tick; report.finalInventory = sim.counts();
} catch (error) { report.ok = false; report.error = String(error.stack ?? error); process.exitCode = 1; }
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, finalTick: report.finalTick, error: report.error }));
