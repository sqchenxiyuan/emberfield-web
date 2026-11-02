import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const OUT = process.env.VOXEL_POWER_CAMPAIGN_OUT ?? 'test-results/voxel-power-campaign';
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
let sim = new VoxelSimulation(73129);
const p = (x, y, z = 8) => ({ x, y, z }),
  at = (q) => (q.z * 64 + q.y) * 64 + q.x,
  same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const initial = sim.counts();
const report = {
  scope:
    'Normal command/step/save/load only. No injected terrain, resources, devices, fuel, energy, needs or time. Seed terrain inspected to plan finite ore excavation; headless calendar simulation, not native real-time measurement.',
  commands: [],
  checks: [],
  minimumFood: 100,
  errors: [],
};
const check = (name, data = {}) => {
  report.checks.push({ name, tick: sim.tick, ...data });
  console.log('PASS', name, sim.tick);
};
function audit() {
  const counts = sim.counts();
  for (const r of Object.keys(initial))
    assert.equal(
      counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r],
      initial[r] + sim.stats.produced[r],
      `${r} ledger at ${sim.tick}`,
    );
  for (const pawn of sim.pawns) {
    assert.ok(sim.standable(pawn));
    report.minimumFood = Math.min(report.minimumFood, pawn.food);
  }
  for (const d of sim.devices) {
    assert.ok(d.fuel >= 0 && d.fuel <= 75 && d.energy >= 0 && d.energy <= 600);
  }
}
function until(name, predicate, limit = 30000) {
  const start = sim.tick;
  while (!predicate() && sim.tick - start < limit) {
    sim.step();
    if (sim.tick % 20 === 0) audit();
  }
  assert.ok(
    predicate(),
    `${name}: ${JSON.stringify({ tick: sim.tick, devices: sim.devices, jobs: sim.jobs, pawns: sim.pawns })}`,
  );
  audit();
  check(name, { elapsed: sim.tick - start });
}
function command(c) {
  const result = sim.command(c);
  report.commands.push({ tick: sim.tick, command: c, result });
  assert.ok(result.ok, JSON.stringify({ c, result }));
  return result;
}
const place = (tool, from, to, axis) => command({ type: 'designate', tool, from, to, axis });
const done = (name) => until(name, () => !sim.jobs.some((j) => j.kind !== 'refuel'));
const save = async (name) => writeFile(`${OUT}/${name}.json`, JSON.stringify(sim.save()));
try {
  // Physical slots must be planned before fields; mineral and food stacks no
  // longer fit in the original two starter cells without limit.
  place('stock', p(28, 32), p(31, 36));
  place('stock', p(34, 33), p(36, 36));
  const components = [];
  for (let z = 2; z <= 5; z++)
    for (let y = 1; y < 63; y++)
      for (let x = 1; x < 63; x++)
        if (sim.blocks[at(p(x, y, z))] === 6) components.push(p(x, y, z));
  if (process.argv.includes('--scan')) {
    console.log(JSON.stringify(components));
    process.exit(0);
  }
  for (const [x, y] of [
    [27, 29],
    [28, 27],
    [36, 28],
    [38, 31],
    [36, 37],
    [27, 36],
  ])
    place('cut', p(x, y));
  if (process.argv.includes('--prepare-food')) {
    // The preservation campaign starts farming before industrial construction,
    // so the first natural harvest arrives within the initial ration runway.
    const reserved = new Set(sim.stockpiles.map((q) => at(q)));
    for (const q of [p(32, 31), p(33, 32), p(40, 30), p(27, 28)]) reserved.add(at(q));
    for (let y = 27; y <= 30; y++) for (let x = 28; x <= 31; x++) reserved.add(at(p(x, y)));
    for (let y = 28; y <= 29; y++) for (let x = 34; x <= 37; x++) reserved.add(at(p(x, y)));
    for (let y = 29; y <= 32; y++) for (let x = 32; x <= 33; x++) reserved.add(at(p(x, y)));
    const fields = [];
    for (let y = 24; y <= 41; y++)
      for (let x = 24; x <= 41; x++) {
        const q = p(x, y);
        if (
          !reserved.has(at(q)) &&
          sim.standable(q) &&
          sim.cropCondition(q, 'rice').fertility === 1
        )
          fields.push(q);
      }
    fields.sort((a, b) => Math.hypot(a.x - 32, a.y - 32) - Math.hypot(b.x - 32, b.y - 32));
    assert.ok(fields.length >= 120);
    for (const q of fields.slice(0, 120))
      command({ type: 'designate', tool: 'farm', from: q, crop: 'rice' });
    check('preservation branch starts 120 real rice plots before power construction');
  }
  done('six mature trees harvested and hauled');
  place('shaft', p(33, 32));
  done('surface shaft reaches z5');
  place('mine', p(34, 32, 5), p(36, 33, 5));
  done('starting finite steel vein excavated');
  // Follow a horizontal path to nearby real component seams, then use actual shafts for depth.
  const targets = components
    .filter((q) => q.z === 5)
    .sort(
      (a, b) => Math.abs(a.x - 33) + Math.abs(a.y - 32) - Math.abs(b.x - 33) - Math.abs(b.y - 32),
    );
  console.log('Component targets', JSON.stringify(targets));
  // Explicit routes are recorded as ordinary designations and can be replayed.
  for (const target of targets) {
    if (sim.counts().components >= 12) break;
    for (let x = Math.min(33, target.x); x <= Math.max(33, target.x); x++)
      if (sim.blocks[at(p(x, 32, 5))] || sim.blocks[at(p(x, 32, 6))]) place('mine', p(x, 32, 5));
    done('horizontal mining corridor');
    for (let y = Math.min(32, target.y); y <= Math.max(32, target.y); y++)
      if (sim.blocks[at(p(target.x, y, 5))] || sim.blocks[at(p(target.x, y, 6))])
        place('mine', p(target.x, y, 5));
    done('component seam mined');
  }
  assert.ok(sim.counts().components >= 11, 'mined enough components for five devices');
  const steel = [];
  for (let y = 1; y < 63; y++)
    for (let x = 1; x < 63; x++) if (sim.blocks[at(p(x, y, 5))] === 3) steel.push(p(x, y, 5));
  steel.sort(
    (a, b) => Math.abs(a.x - 33) + Math.abs(a.y - 32) - Math.abs(b.x - 33) - Math.abs(b.y - 32),
  );
  for (const target of steel) {
    if (sim.counts().steel >= 460) break;
    for (let x = Math.min(33, target.x); x <= Math.max(33, target.x); x++)
      if (sim.blocks[at(p(x, 32, 5))] || sim.blocks[at(p(x, 32, 6))]) place('mine', p(x, 32, 5));
    done('steel access corridor');
    for (let y = Math.min(32, target.y); y <= Math.max(32, target.y); y++)
      if (sim.blocks[at(p(target.x, y, 5))] || sim.blocks[at(p(target.x, y, 6))])
        place('mine', p(target.x, y, 5));
    done('finite steel mined');
  }
  assert.ok(sim.counts().steel >= 460, 'mined enough steel');
  check('finite ores supplied all device ingredients', {
    inventory: sim.counts(),
    mined: sim.stats.mined,
  });
  await save('mined-resources');
  // Two enclosed underground rooms with a cooler in their shared wall.
  for (const q of [p(36, 31, 5), p(39, 31, 5), p(39, 30, 5)])
    if (sim.blocks[at(q)]) {
      place('mine', q);
      done('room access');
    }
  place('mine', p(35, 27, 5), p(37, 30, 5));
  place('mine', p(39, 28, 5), p(40, 30, 5));
  done('cold and exhaust rooms excavated');
  if (sim.blocks[at(p(38, 29, 5))]) {
    place('mine', p(38, 29, 5));
    done('cooler wall opening excavated');
  }
  const boundary = [];
  for (let y = 27; y <= 30; y++) {
    boundary.push(p(34, y, 5));
    if (y !== 29) boundary.push(p(38, y, 5));
  }
  for (let x = 35; x <= 37; x++) {
    boundary.push(p(x, 26, 5));
    if (x !== 36) boundary.push(p(x, 31, 5));
  }
  for (let y = 28; y <= 30; y++) boundary.push(p(41, y, 5));
  for (let x = 39; x <= 40; x++) {
    boundary.push(p(x, 27, 5));
    if (x !== 39) boundary.push(p(x, 31, 5));
  }
  for (const q of boundary) if (!sim.blocks[at(q)]) place('wall', q);
  done('old mining tunnels sealed around both rooms');
  place('door', p(36, 31, 5), undefined, 'x');
  place('door', p(39, 31, 5), undefined, 'x');
  done('two room entrances sealed with doors');
  place('generator', p(34, 28));
  place('battery', p(36, 28), undefined, 'y');
  place('solar', p(28, 27));
  place('heater', p(35, 28, 5));
  place('cooler', p(38, 29, 5), undefined, 'x');
  until(
    'five devices built and generator physically refuelled',
    () =>
      sim.devices.length === 5 &&
      sim.devices.find((d) => d.kind === 'generator').fuel > 50 &&
      !sim.jobs.length,
  );
  const get = (k) => sim.devices.find((d) => d.kind === k);
  const toggle = (kind, on, target = get(kind).target) =>
    command({ type: 'device', deviceId: get(kind).id, on, target });
  toggle('cooler', false);
  toggle('heater', true, 32);
  place('wire', p(32, 29), p(33, 29));
  place('wire', p(33, 30), p(33, 32));
  for (const z of [7, 6, 5]) place('wire', p(33, 32, z));
  done('vertical shaft and surface wiring built');
  until(
    'underground heater receives surface power and heats enclosed air',
    () => get('heater').powered && sim.temperature(p(36, 28, 5)) > 30,
  );
  assert.equal(get('heater').networkId, get('generator').networkId);
  check('heater temperature and battery charge', {
    cold: sim.temperature(p(36, 28, 5)),
    battery: get('battery').energy,
    networks: sim.snapshot().networks,
  });
  await save('powered-room');
  place('remove', p(33, 32, 6));
  done('one vertical wire removed');
  sim.step();
  assert.equal(get('heater').powered, false);
  assert.equal(get('heater').active, false);
  assert.notEqual(get('heater').networkId, get('generator').networkId);
  check('cut vertical wire interrupts basement power');
  place('wire', p(33, 32, 6));
  done('wire repaired');
  until('heater restarts after reconnection', () => get('heater').powered);
  toggle('heater', false);
  toggle('cooler', true, -5);
  const hotBefore = sim.temperature(p(39, 29, 5));
  until('cooler lowers cold room below ten degrees', () => sim.temperature(p(36, 28, 5)) < 10);
  assert.ok(
    sim.temperature(p(39, 29, 5)) > hotBefore + 1,
    'exhaust heats the opposite enclosed room',
  );
  check('cooler directional heat transfer', {
    cold: sim.temperature(p(36, 28, 5)),
    hot: sim.temperature(p(39, 29, 5)),
    hotBefore,
  });
  await save('cooled-room');
  // Save/load preserves stored energy, fractional fuel, and both room temperatures.
  const before = sim.save(),
    cold = sim.temperature(p(36, 28, 5)),
    hot = sim.temperature(p(39, 29, 5));
  sim = VoxelSimulation.load(before);
  assert.deepEqual(
    sim.devices.map((d) => [d.id, d.energy, d.fuel]),
    before.devices.map((d) => [d.id, d.energy, d.fuel]),
  );
  assert.ok(
    Math.abs(sim.temperature(p(36, 28, 5)) - cold) < 1e-9 &&
      Math.abs(sim.temperature(p(39, 29, 5)) - hot) < 1e-9,
  );
  check('save restores fractional fuel stored energy and room temperatures');
  toggle('generator', false);
  toggle('solar', false);
  const energy = get('battery').energy;
  sim.step(120);
  audit();
  assert.ok(get('battery').energy < energy);
  assert.ok(get('cooler').powered);
  check('battery alone powers cooler', { beforeWd: energy, afterWd: get('battery').energy });
  toggle('battery', false);
  sim.step();
  assert.equal(get('cooler').active, false);
  check('all supplies off means no active cooling');
  toggle('battery', true);
  toggle('generator', true);
  toggle('solar', true);
  // Physical upper floor shades the solar footprint, then demolition restores sunlight.
  place('up', p(27, 28));
  done('ladder for solar roof test');
  place('floor', p(28, 27, 11), p(31, 30, 11));
  done('upper floor shades every solar panel cell');
  // Construction finishes after this tick's power calculation. Sample output
  // after the next real simulation tick, including daytime construction runs.
  sim.step();
  audit();
  until('daylight sampling time', () => sim.snapshot().hour >= 9 && sim.snapshot().hour < 16);
  assert.equal(get('solar').watts, 0);
  check('full physical roof blocks solar production in daylight');
  // Withdraw workers to camp and dismantle from the far edge toward the ladder.
  // This is normal player planning, with no path/pawn injection.
  for (let x = 31; x >= 28; x--)
    for (const y of [27, 30, 29, 28]) {
      for (const pawn of sim.pawns) command({ type: 'move', pawnId: pawn.id, target: p(32, 34) });
      until('workers return before next roof section', () => sim.pawns.every((q) => q.z === 8));
      place('remove', p(x, y, 11));
      done('solar roof section removed from far edge');
    }
  until('solar produces again with sky exposure', () => get('solar').watts > 1500);
  check('solar daylight restored', { watts: get('solar').watts });
  await save('final');
  report.status = 'passed';
} catch (error) {
  report.errors.push(String(error));
  throw error;
} finally {
  report.final = { tick: sim.tick, inventory: sim.counts(), stats: sim.stats };
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
