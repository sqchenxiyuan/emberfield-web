import { build as bundle } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const OUT = process.env.CAMPAIGN_OUT ?? 'test-results/campaign';
await mkdir(OUT, { recursive: true });
await bundle({
  entryPoints: ['src/sim/world.ts'],
  outfile: `${OUT}/sim.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { Simulation } = await import(pathToFileURL(path.resolve(OUT, 'sim.mjs')).href);
const DAY = 12000;
const seed = Number(process.env.CAMPAIGN_SEED ?? 73129),
  sim = new Simulation(seed),
  commands = [],
  days = [];
const command = (c) => {
  const r = sim.command(c);
  commands.push({ tick: sim.world.tick, command: c, result: r });
  assert.ok(r.ok, JSON.stringify({ c, r }));
};
const build = (kind, x, y) => command({ type: 'build', kind, x, y });
const zone = (zone, x, y, x2, y2) => command({ type: 'zone', zone, x, y, x2, y2 });
const mark = (mode, x, y, x2, y2) => command({ type: 'mark', mode, x, y, x2, y2 });
const people = () => sim.world.pawns.filter((p) => !p.enemy && !p.animal && !p.dead);
const targets = () => sim.world.pawns.filter((p) => p.enemy && !p.dead && !p.downed);
const count = (kind) => sim.world.buildings.filter((b) => b.kind === kind).length;
const checkpoints = [];
zone(1, 41, 50, 44, 53);
zone(2, 49, 48, 54, 55);
zone(3, 52, 43, 54, 44);
build('bed', 40, 41);
build('bed', 42, 41);
build('bed', 44, 41);
build('stove', 47, 45);
build('research', 47, 41);
build('medical', 40, 44);
build('table', 42, 44);
build('chair', 42, 45);
build('campfire', 45, 45);
for (let y = 45; y <= 49; y++) build('sandbag', 37, y);
mark('cut', 33, 37, 38, 57);
mark('mine', 24, 24, 34, 34);
let previousDay = 0,
  defending = false,
  rescuedRecorded = false,
  started = performance.now();
for (let i = 0; i < (DAY * 30) / 100; i++) {
  if (targets().length) {
    if (!defending) {
      defending = true;
      for (const [pIndex, p] of people().entries()) {
        command({ type: 'draft', ids: [p.id], value: true });
        command({ type: 'move', ids: [p.id], x: 38, y: 46 + pIndex });
      }
    }
  } else if (defending) {
    defending = false;
    command({ type: 'draft', ids: people().map((p) => p.id), value: false });
  }
  const w = sim.world;
  if ((w.research.electricity ?? 0) >= 400) {
    if (!count('generator')) {
      build('generator', 46, 38);
      build('wire', 48, 38);
      build('wire', 49, 38);
      build('wire', 50, 38);
    }
    if ((w.research.communication ?? 0) < 600 && w.researchTarget !== 'communication')
      command({ type: 'research', target: 'communication' });
  }
  if (
    (w.research.communication ?? 0) >= 600 &&
    (w.research.beacon ?? 0) < 800 &&
    w.researchTarget !== 'beacon'
  )
    command({ type: 'research', target: 'beacon' });
  if ((w.research.beacon ?? 0) >= 800 && !count('beacon')) build('beacon', 51, 37);
  if (
    w.tick >= DAY * 8 &&
    count('beacon') &&
    w.buildings.some((b) => b.kind === 'beacon' && sim.complete(b) && b.powered) &&
    !w.beaconActive
  )
    command({ type: 'beacon' });
  if (i % 120 === 0 && sim.inventory().wood < 150) mark('cut', 30, 30, 60, 64);
  sim.pauseRequested = false;
  sim.step(100);
  const d = Math.floor(w.tick / DAY);
  if (d > previousDay) {
    previousDay = d;
    const record = {
      day: d,
      tick: w.tick,
      inventory: sim.inventory(),
      stats: { ...w.stats },
      research: { ...w.research },
      beacon: w.beaconTicks,
      pawns: people().map((p) => ({
        name: p.name,
        food: p.food,
        rest: p.rest,
        blood: p.blood,
        mood: p.mood,
        job: p.job?.kind,
        reason: p.reason,
      })),
      enemyCount: targets().length,
    };
    days.push(record);
    console.log(JSON.stringify(record));
    for (const item of w.items) {
      assert.ok(
        item.count >= -1e-6 && item.reserved >= -1e-6 && item.reserved <= item.count + 1e-6,
        'invalid inventory',
      );
    }
    if (d === 3 || d === 8) checkpoints.push({ day: d, save: sim.save() });
  }
  if (w.stats.tended > 0) rescuedRecorded = true;
  if (w.outcome !== 'playing') break;
}
const report = {
  seed,
  elapsedMs: performance.now() - started,
  outcome: sim.world.outcome,
  tick: sim.world.tick,
  days,
  commands,
  stats: sim.world.stats,
  people: people().map((p) => p.name),
  treatmentObserved: rescuedRecorded,
  scope:
    'Headless authoritative simulation. Commands only; no resource grants, completed-building fixtures, clock edits, disabled incidents or direct damage injections.',
};
await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await writeFile(`${OUT}/final-save.json`, JSON.stringify(sim.save()));
for (const c of checkpoints) await writeFile(`${OUT}/day-${c.day}.json`, JSON.stringify(c.save));
console.log(
  'RESULT',
  JSON.stringify({
    outcome: report.outcome,
    days: sim.world.tick / DAY,
    stats: report.stats,
    people: report.people,
    elapsedMs: report.elapsedMs,
  }),
);
assert.equal(report.outcome, 'won', 'Campaign did not reach evacuation');
assert.ok(
  report.stats.cooked > 30 &&
    report.stats.harvested > 48 &&
    report.stats.built >= 15 &&
    report.stats.kills >= 3,
  'Missing gameplay chain',
);
assert.ok(report.people.length >= 1, 'No survivor');
