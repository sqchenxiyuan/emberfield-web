import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const out = path.resolve('test-results/voxel-wildlife');
await fs.mkdir(out, { recursive: true });
await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm',
  outfile: path.join(out, 'world.mjs') });
const { VoxelSimulation } = await import(pathToFileURL(path.join(out, 'world.mjs')).href);
let sim = new VoxelSimulation(73129);
const report = { version: 22, setup: 'ordinary fresh colony; commands and elapsed ticks only',
  initialTick: sim.tick, checks: [], commands: [], observations: [] };
const check = (name, ok, detail) => {
  report.checks.push({ name, ok: !!ok, tick: sim.tick, detail });
  if (!ok) throw Error(name + ': ' + JSON.stringify(detail));
};
const cmd = c => {
  const r = sim.command(c); report.commands.push({ tick: sim.tick, command: c, result: r });
  if (!r.ok) throw Error(JSON.stringify({ c, r }));
  return r;
};
const advance = (done, limit = 12000) => {
  for (let i = 0; i < limit && !done(); i++) {
    sim.step();
    if (sim.tick % 200 === 0) report.observations.push({ tick: sim.tick,
      livingAnimals: sim.animals.filter(a => !a.dead).length, inventory: sim.counts(),
      pawns: sim.pawns.map(p => ({ id: p.id, phase: p.phase, reason: p.reason })) });
  }
  if (!done()) throw Error(JSON.stringify({ timeout: sim.tick, pawns: sim.pawns.map(p => p.reason), jobs: sim.jobs }));
};
const save = async name => fs.writeFile(path.join(out, name + '.json'), JSON.stringify(sim.save()));
function site(tool) {
  for (let radius = 2; radius <= 7; radius++) for (let dx = -radius; dx <= radius; dx++)
    for (const dy of [-radius, radius]) {
      const from = { x: sim.spawn.x + dx, y: sim.spawn.y + dy, z: sim.spawn.z };
      if (!sim.standable(from)) continue;
      const c = { type: 'designate', tool, from }, r = sim.command(c);
      if (r.ok) { report.commands.push({ tick: sim.tick, command: c, result: r }); return from; }
    }
  throw Error('No valid site: ' + tool);
}
try {
  await save('initial');
  const started = sim.animals.map(a => [a.id, a.x, a.y, a.z]);
  site('craftingSpot');
  cmd({ type: 'weaponBill', benchId: sim.weaponBenches[0].id, kind: 'shortBow', target: 1, paused: false });
  advance(() => sim.items.some(i => i.weapon?.kind === 'shortBow'));
  const bow = sim.items.find(i => i.weapon?.kind === 'shortBow').weapon;
  const hunterId = sim.pawns.slice().sort((a, b) => b.skills.shooting.level - a.skills.shooting.level)[0].id;
  cmd({ type: 'equipWeapon', pawnId: hunterId, weaponId: bow.id });
  advance(() => sim.pawns.find(p => p.id === hunterId).weapon?.id === bow.id);
  check('crafted and physically equipped short bow', sim.stats.weaponsMade === 1, { weaponId: bow.id, hunterId });
  site('butcherSpot'); site('stove');
  advance(() => sim.stoves.length === 1);
  cmd({ type: 'bill', stoveId: sim.stoves[0].id, target: 5, paused: false });
  for (const p of sim.pawns) cmd({ type: 'priority', pawnId: p.id, work: 'hunt', value: p.id === hunterId ? 1 : 0 });
  check('wildlife kept moving during colony preparation', JSON.stringify(started) !== JSON.stringify(sim.animals.map(a => [a.id, a.x, a.y, a.z])));
  await save('ready');
  const target = sim.animals.slice().sort((a, b) => Math.hypot(a.x - sim.spawn.x, a.y - sim.spawn.y) - Math.hypot(b.x - sim.spawn.x, b.y - sim.spawn.y))[0];
  cmd({ type: 'hunt', animalId: target.id, enabled: true });
  advance(() => sim.stats.produced.carcass > 0);
  check('actual ranged impact killed a marked animal', sim.combatEvents.some(e => e.kind === 'hit' && e.targetId === target.id));
  check('carcass retains hunted animal identity', sim.items.some(i => i.carcass?.animalId === target.id));
  await save('carcass');
  sim = VoxelSimulation.load(sim.save());
  advance(() => sim.stats.consumed.carcass > 0 && sim.stats.produced.meat > 0);
  check('a worker physically fetched and butchered the carcass', sim.counts().carcass === 0, { meatProduced: sim.stats.produced.meat });
  await save('meat');
  advance(() => sim.stats.cooked > 0);
  check('meat became a real meal', sim.stats.consumed.meat >= 10 && sim.counts().meal > 0,
    { meatUsed: sim.stats.consumed.meat, meals: sim.counts().meal });
  await save('meal');
  advance(() => sim.stats.consumed.meal > 0, 12000);
  check('a colonist actually ate the cooked meal', sim.stats.consumed.meal > 0);
  check('all three colonists remain alive', sim.pawns.filter(p => p.faction === 'colony' && !p.dead).length === 3);
  const old = sim.save(), restored = VoxelSimulation.load(old);
  check('final save keeps animal and food ownership', JSON.stringify(restored.counts()) === JSON.stringify(sim.counts()) &&
    JSON.stringify(restored.animals) === JSON.stringify(sim.animals));
  await save('final'); report.passed = true;
} catch (e) {
  report.passed = false; report.error = String(e?.stack ?? e); await save('failure'); process.exitCode = 1;
} finally {
  report.finalTick = sim.tick; report.stats = sim.stats;
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, tick: sim.tick,
    output: out, error: report.error?.slice(0, 1000) }));
}
