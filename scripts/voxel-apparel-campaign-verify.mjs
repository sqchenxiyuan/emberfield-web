import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_APPAREL_OUT ?? 'test-results/voxel-apparel-campaign';
await mkdir(OUT, { recursive: true });
const bundle = await build({
  entryPoints: ['src/voxel/world.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { VoxelSimulation } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const DAY = 12000,
  sha = (b) => createHash('sha256').update(b).digest('hex');
let sim = new VoxelSimulation(73129, {
  biome: 'desert',
  hilliness: 'flat',
  meanTemperature: 24,
  rainfall: 1500,
  latitude: 0,
});
const initial = sim.counts(),
  initialClothes = structuredClone(sim.pawns.flatMap((p) => p.worn));
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Fresh generator-2 warm wet desert. Public command/step/save/load and read-only terrain inspection only. No injected cloth, apparel, growth, health, terrain, pawn position or time. Physical cotton harvest, upper-floor tailoring and garments, timed wearing/removal and save identity; a bounded sustainable calendar, not all-biome balance.',
  seed: sim.seed,
  settings: sim.settings,
  checks: [],
  commands: [],
  fixtures: {},
  daily: [],
  carriedLayers: {},
  minimumFood: 100,
  errors: [],
  status: 'running',
};
const point = (p) => ({ x: p.x, y: p.y, z: p.z }),
  key = (p) => `${p.x}/${p.y}/${p.z}`;
const block = (p) => sim.blocks[(p.z * 64 + p.y) * 64 + p.x];
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const reachable = (p) => sim.standable(p) && sim.path(sim.pawns[0], p) !== null;
const pieces = () => [
  ...sim.items.flatMap((i) => (i.apparel ? [i.apparel] : [])),
  ...sim.pawns.flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
];
function command(c) {
  const result = sim.command(c);
  report.commands.push({ tick: sim.tick, command: c, result });
  assert(result.ok, JSON.stringify({ c, result }));
  return result;
}
const place = (tool, p, extra = {}) =>
  command({ type: 'designate', tool, from: point(p), ...extra });
function check(name, details = {}) {
  report.checks.push({ name, tick: sim.tick, ...details });
  console.log('PASS', name, sim.tick);
}
function audit() {
  const counts = sim.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r] + sim.stats.destroyed[r],
      initial[r] + sim.stats.produced[r],
      `${r} balance ${sim.tick}`,
    );
  const all = pieces();
  assert.equal(all.length, new Set(all.map((p) => p.id)).size, 'unique physical garment identity');
  assert.equal(counts.apparel, all.length);
  assert.equal(new Set(sim.items.map(key)).size, sim.items.length, 'one ground stack per cell');
  for (const p of sim.pawns) {
    assert(!p.dead && !p.downed);
    assert(sim.standable(p));
    report.minimumFood = Math.min(report.minimumFood, p.food);
    if (p.cargo) {
      const k = `${p.cargo.resource}@${p.z}`;
      report.carriedLayers[k] = (report.carriedLayers[k] ?? 0) + 1;
    }
  }
}
function step() {
  sim.step();
  if (sim.tick % 20 === 0) audit();
  if (sim.tick % DAY === 0) {
    report.daily.push({
      tick: sim.tick,
      counts: sim.counts(),
      food: sim.pawns.map((p) => p.food),
      maxCottonGrowth: Math.max(
        0,
        ...sim.crops.filter((c) => c.kind === 'cotton').map((c) => c.growth),
      ),
    });
    console.log('DAY', sim.tick / DAY);
  }
}
function until(name, fn, limit = DAY * 3) {
  const start = sim.tick;
  while (!fn() && sim.tick - start < limit) step();
  assert(
    fn(),
    `${name}: ${JSON.stringify({ tick: sim.tick, counts: sim.counts(), jobs: sim.jobs, pawns: sim.pawns })}`,
  );
  audit();
  check(name, { elapsed: sim.tick - start });
}
async function save(name) {
  const bytes = JSON.stringify(sim.save()),
    file = `${OUT}/${name}.json`;
  await writeFile(file, bytes);
  report.fixtures[name] = { file, sha256: sha(bytes), tick: sim.tick };
  return JSON.parse(bytes);
}
const bill = (kind, target, paused = false) =>
  command({ type: 'tailorBill', tailorId: sim.tailors[0].id, kind, target, paused });
try {
  assert.equal(initial.apparel, 6);
  assert.equal(initial.cloth, 0);
  assert(sim.pawns.every((p) => p.worn.length === 2));
  check('new scenario has six real initial shirts and pants, no fabricated cloth');
  const legacyBytes = await readFile('tests/fixtures/voxel-v10-start.json');
  assert.equal(
    sha(legacyBytes),
    'ab270a77c6354c5690a1afc76458d8aaff5f4264f9b099f59710447fb1a180f5',
  );
  const legacy = JSON.parse(legacyBytes),
    migrated = VoxelSimulation.load(legacy).save();
  assert.equal(migrated.version, 21);
  for (const field of ['blocks', 'items', 'crops', 'trees', 'tick'])
    assert.deepEqual(migrated[field], legacy[field]);
  assert(migrated.pawns.every((p) => p.worn.length === 0));
  for (let i = 0; i < legacy.pawns.length; i++) {
    assert.deepEqual(migrated.pawns[i].health, legacy.pawns[i].health);
    assert.deepEqual(migrated.pawns[i].cargo, legacy.pawns[i].cargo);
  }
  check(
    'genuine published v10 bytes migrate without free clothes or changed terrain, cargo and health',
  );
  const surface = [];
  for (let y = 1; y < 63; y++)
    for (let x = 1; x < 63; x++) {
      let z = 14;
      while (z > 0 && !block({ x, y, z })) z--;
      const p = { x, y, z: z + 1 };
      if (reachable(p)) surface.push(p);
    }
  surface.sort((a, b) => dist(a, sim.spawn) - dist(b, sim.spawn) || a.y - b.y || a.x - b.x);
  const occupied = new Set([...sim.items, ...sim.trees].map(key));
  const upperBase = surface.find(
    (p) =>
      p.z <= 10 &&
      [0, 1, 2, 3, 4].every((dx) =>
        [-1, 0, 1, 2].every((dy) => {
          const q = { x: p.x + dx, y: p.y + dy, z: p.z };
          return reachable(q) && !occupied.has(key(q));
        }),
      ),
  );
  assert(upperBase, 'room for a real elevated tailoring platform');
  const reserved = new Set([...sim.items, ...sim.stockpiles].map(key));
  for (let dx = 0; dx <= 4; dx++)
    for (let dy = -1; dy <= 2; dy++)
      reserved.add(key({ ...upperBase, x: upperBase.x + dx, y: upperBase.y + dy }));
  const stock = surface
    .filter((p) => !reserved.has(key(p)) && dist(p, sim.spawn) >= 3)
    .slice(0, 50);
  for (const p of stock) {
    place('stock', p);
    reserved.add(key(p));
  }
  const stove = surface.find((p) => !reserved.has(key(p)) && !occupied.has(key(p)));
  assert(stove);
  place('stove', stove);
  reserved.add(key(stove));
  const farms = surface
    .filter((p) => !reserved.has(key(p)) && [1, 8].includes(block({ ...p, z: p.z - 1 })))
    .slice(0, 224);
  assert.equal(farms.length, 224);
  for (const [i, p] of farms.entries()) place('farm', p, { crop: i < 160 ? 'rice' : 'cotton' });
  const trees = sim.trees
    .filter(
      (t) =>
        t.growth >= 1 &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => reachable({ ...t, x: t.x + dx, y: t.y + dy })),
    )
    .sort((a, b) => dist(a, sim.spawn) - dist(b, sim.spawn))
    .slice(0, 16);
  assert(trees.length >= 12);
  for (const t of trees) place('cut', t);
  until(
    'workers sow real rice and cotton and build food production',
    () =>
      sim.stoves.length === 1 &&
      sim.crops.filter((c) => c.kind === 'cotton').length === 64 &&
      sim.crops.length === 224,
    DAY * 3,
  );
  command({ type: 'bill', stoveId: sim.stoves[0].id, target: 6, paused: false });
  place('up', upperBase);
  until(
    'workers build a ladder from the surface to the upper floor',
    () => sim.ladders[((upperBase.z + 3) * 64 + upperBase.y) * 64 + upperBase.x] === 1,
  );
  const upper = { ...upperBase, z: upperBase.z + 3 };
  place('floor', { ...upper, y: upper.y + 1 });
  until(
    'landing beside the ladder keeps the workbench from blocking access',
    () => !sim.jobs.some((j) => j.kind === 'floor'),
  );
  // Extend adjacent floor strips outwards so every construction site has a physical approach.
  for (let dx = 1; dx <= 4; dx++) {
    for (let dy = -1; dy <= 2; dy++) place('floor', { ...upper, x: upper.x + dx, y: upper.y + dy });
    until(
      'upper platform strip is built from carried wood',
      () => !sim.jobs.some((j) => j.kind === 'floor'),
    );
  }
  const table = { ...upper, x: upper.x + 1 };
  place('tailor', table, { axis: 'x' });
  until(
    'three-cell hand tailoring bench is built on the upper platform',
    () => sim.tailors.length === 1,
  );
  for (let dx = 1; dx <= 4; dx++) {
    const p = { ...upper, x: upper.x + dx, y: upper.y + 2 };
    place('stock', p);
    command({ type: 'storage', from: p, priority: 3, accepts: ['cloth', 'apparel'] });
  }
  report.layout = { upperBase, upper, table, stove, cotton: farms.slice(160) };
  await save('sown');
  until(
    'cotton matures and harvest produces physical non-food cloth under normal calendar',
    () => sim.stats.produced.cloth >= 300,
    DAY * 28,
  );
  assert(sim.stats.cooked > 0 && sim.stats.consumed.meal > 0);
  assert(
    sim.items
      .filter((i) => i.resource === 'cloth')
      .every((i) => !i.crop && i.rotProgress === undefined),
  );
  await save('cloth');
  bill('tuque', 1);
  until('actual cloth is delivered upstairs and the tailor performs work', () =>
    sim.jobs.some((j) => j.kind === 'tailoring' && j.delivered.cloth === 20 && j.progress > 30),
  );
  await save('working');
  const beforePause = sim.counts().cloth;
  bill('tuque', 1, true);
  until(
    'pausing the recipe returns delivered cloth without producing a garment',
    () => !sim.jobs.some((j) => j.kind === 'tailoring'),
  );
  assert.equal(sim.counts().cloth, beforePause);
  assert.equal(sim.stats.tailored, 0);
  bill('tuque', 1);
  until('resumed recipe starts a fresh physical batch', () =>
    sim.jobs.some((j) => j.kind === 'tailoring' && j.progress > 40),
  );
  const job = sim.jobs.find((j) => j.kind === 'tailoring'),
    progress = job.progress;
  bill('tuque', 0);
  assert.equal(sim.jobs.find((j) => j.id === job.id).progress, progress);
  const middle = await save('mid-work');
  sim = VoxelSimulation.load(middle);
  assert.equal(sim.jobs.find((j) => j.id === job.id).progress, progress);
  until('resumed sewing advances through normal needs and sleep to its final minute', () =>
    sim.jobs.some((j) => j.kind === 'tailoring' && j.progress >= j.work - 60),
  );
  await save('finishing');
  until(
    'saved in-progress batch completes once after target is lowered',
    () => sim.stats.tailored === 1,
  );
  sim.step(100);
  assert.equal(sim.stats.tailored, 1);
  audit();
  for (const [kind, target] of [
    ['parka', 1],
    ['duster', 1],
    ['shirt', 4],
    ['pants', 4],
  ])
    bill(kind, target);
  until(
    'all five real garment recipes produce their requested individual outputs',
    () => sim.stats.tailored === 5 && !sim.jobs.some((j) => j.kind === 'tailoring'),
    DAY * 5,
  );
  assert.equal(sim.stats.consumed.cloth, 260);
  assert.equal(sim.stats.produced.apparel, 5);
  assert(pieces().every((p) => Number.isInteger(p.quality) && p.quality >= 0 && p.quality <= 5));
  for (const b of sim.tailors[0].bills) bill(b.kind, b.target, true);
  // Stop new hauling reservations during the explicit outfit sequence. Faster
  // skilled workers can otherwise claim the next garment while the first is worn.
  for (const p of sim.pawns) command({ type: 'priority', pawnId: p.id, work: 'haul', value: 0 });
  until(
    'finished garments are put down and available for selection',
    () => !sim.pawns.some((p) => p.cargo?.apparel),
  );
  await save('ready');
  const pawnId = sim.pawns[0].id,
    pawn = () => sim.pawns.find((p) => p.id === pawnId);
  for (const w of Object.keys(pawn().priorities))
    command({ type: 'priority', pawnId, work: w, value: 0 });
  const originalInsulation = structuredClone(pawn().worn);
  const parka = pieces().find((p) => p.kind === 'parka');
  command({ type: 'wear', pawnId, apparelId: parka.id });
  until(
    'colonist fetches an actual garment and begins the equip delay',
    () => pawn().apparelTask?.stage === 'work' && pawn().apparelTask.progress > 0,
  );
  assert(!pawn().worn.some((p) => p.id === parka.id));
  assert.equal(pawn().cargo.apparel.id, parka.id);
  const wearing = await save('wearing');
  sim = VoxelSimulation.load(wearing);
  assert.equal(pawn().cargo.apparel.id, parka.id);
  assert.equal(pawn().apparelTask.progress, wearing.pawns[0].apparelTask.progress);
  until('saved equip delay finishes and moves exactly one identity from cargo to worn', () =>
    pawn().worn.some((p) => p.id === parka.id),
  );
  await save('parka');
  const duster = pieces().find((p) => p.kind === 'duster');
  command({ type: 'wear', pawnId, apparelId: duster.id });
  until('replacing shell apparel drops the original parka and keeps shirt and pants', () =>
    pawn().worn.some((p) => p.id === duster.id),
  );
  assert(
    pawn().worn.some((p) => p.kind === 'shirt') && pawn().worn.some((p) => p.kind === 'pants'),
  );
  assert(sim.items.some((i) => i.apparel?.id === parka.id));
  assert(!pawn().worn.some((p) => p.id === parka.id));
  await save('duster');
  const tuque = pieces().find((p) => p.kind === 'tuque');
  command({ type: 'wear', pawnId, apparelId: tuque.id });
  until('headwear coexists with shell, shirt and pants', () => pawn().worn.length === 4);
  const full = await save('clothed');
  command({ type: 'removeApparel', pawnId, apparelId: duster.id });
  until(
    'removal takes time and places the same garment on the map',
    () => !pawn().worn.some((p) => p.id === duster.id),
  );
  assert(sim.items.some((i) => i.apparel?.id === duster.id));
  assert(
    initialClothes.some((old) => pieces().find((p) => p.id === old.id)?.hitPoints < old.hitPoints),
  );
  check('normal calendar causes measurable worn-only durability loss without deleting identities');
  assert(report.minimumFood > 0);
  assert(report.carriedLayers[`cloth@${upper.z}`] > 0);
  assert(report.carriedLayers[`cloth@${upperBase.z}`] > 0);
  check('real cloth crosses layers and the entire colony stays fed during cotton growth');
  await save('final');
  report.final = {
    tick: sim.tick,
    days: sim.tick / DAY,
    counts: sim.counts(),
    stats: sim.stats,
    minimumFood: report.minimumFood,
    initialHealth: originalInsulation,
    clothedPawn: full.pawns[0],
  };
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.errors.push(String(e.stack ?? e));
  await save('failure');
  throw e;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
