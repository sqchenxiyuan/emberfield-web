import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_HUSBANDRY_OUT ?? 'test-results/voxel-husbandry';
await mkdir(OUT, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(`${OUT}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const DAY = 12000, point = p => ({ x: p.x, y: p.y, z: p.z }), key = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
let sim = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, rainfall: 1500, latitude: 0 });
const initial = sim.counts(), initialAnimals = new Set(sim.animals.map(a => a.id));
const report = { version: sim.save().version, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Fresh colony with public world settings. Only public player commands, ordinary simulation ticks and exact save/load mutate the game. Read-only terrain/routes choose sites. No spawned animals, injected food, ownership, pregnancy, growth, needs, clock or RNG edits. One bounded husbandry lifecycle, not probability calibration or long-term balance.',
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await readFile(new URL(import.meta.url))) },
  baseline: { seed: sim.seed, settings: sim.settings, initial }, checks: [], commands: [], daily: [], observations: [], fixtures: {}, browser: {} };
const check = (name, detail = {}) => { report.checks.push({ name, tick: sim.tick, ...detail }); console.log('PASS', name, sim.tick); };
function command(c) { const result = sim.command(c); report.commands.push({ tick: sim.tick, c, result }); assert(result.ok, JSON.stringify({ c, result })); return result; }
const place = (tool, from, extra = {}) => command({ type: 'designate', tool, from: point(from), ...extra });
const animal = id => sim.animals.find(a => a.id === id);
const reachable = p => sim.standable(p) && sim.path(sim.pawns[0], p) !== null;
function audit() {
  const counts = sim.counts();
  for (const r of Object.keys(initial)) assert.equal(counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r] + sim.stats.destroyed[r] + sim.trade.exported[r], initial[r] + sim.stats.produced[r] + sim.trade.imported[r], `${r} conservation at ${sim.tick}`);
  assert(sim.pawns.filter(p => p.faction === 'colony').every(p => !p.dead && !p.downed), 'three colonists remain alive and mobile');
  assert.equal(new Set(sim.animals.map(a => a.id)).size, sim.animals.length, 'unique persistent animal identities');
}
const attemptCandidates = new Map(), successCandidates = new Map();
function step() {
  for (const p of sim.pawns) if (p.handleTask?.action === 'tame' && p.handleTask.feedings === 1 && p.handleTask.progress === 70)
    attemptCandidates.set(p.handleTask.animalId, structuredClone(sim.save()));
  const grazing = !report.grassConsumption ? sim.animals.filter(a => a.faction === 'colony' && a.goal?.kind === 'grass' && a.eatProgress > 0).map(a => ({ id: a.id, hunger: a.hunger, cell: a.goal.id, growth: sim.grass.find(g => key(g) === a.goal.id)?.growth })) : [];
  sim.step();
  for (const a of sim.animals) if (a.faction === 'colony' && attemptCandidates.has(a.id) && !successCandidates.has(a.id)) successCandidates.set(a.id, attemptCandidates.get(a.id));
  for (const before of grazing) {
    const after = animal(before.id), patch = sim.grass.find(g => key(g) === before.cell);
    if (patch && patch.growth < before.growth && after?.hunger > before.hunger)
      report.grassConsumption = { tick: sim.tick, animalId: after.id, cell: point(patch), growthBefore: before.growth, growthAfter: patch.growth, hungerBefore: before.hunger, hungerAfter: after.hunger };
  }
  if (sim.tick % 400 === 0) audit();
  if (sim.tick % DAY === 0) {
    const day = { tick: sim.tick, counts: sim.counts(), animals: sim.animals.map(a => ({ id: a.id, faction: a.faction, sex: a.sex, growth: a.growth, pregnancy: a.pregnancy, hunger: a.hunger })), pawns: sim.pawns.map(p => ({ id: p.id, food: p.food, rest: p.rest, phase: p.phase, reason: p.reason })) };
    report.daily.push(day); console.log('DAY', sim.tick / DAY, 'colony animals', sim.animals.filter(a => a.faction === 'colony').length);
  }
}
function until(name, done, limit = DAY * 3) {
  const started = sim.tick; while (!done() && sim.tick - started < limit) step();
  assert(done(), `${name}: ${JSON.stringify({ tick: sim.tick, animals: sim.animals, pawns: sim.pawns.map(p => ({ id: p.id, phase: p.phase, reason: p.reason, food: p.food, rest: p.rest, handleTask: p.handleTask })), jobs: sim.jobs.map(j => ({ kind: j.kind, reason: j.reason })) })}`);
  audit(); check(name, { elapsedTicks: sim.tick - started });
}
async function save(name, data = sim.save()) {
  const bytes = JSON.stringify(data), file = `${OUT}/${name}.json`; await writeFile(file, bytes);
  report.fixtures[name] = { file, tick: data.tick, sha256: sha(bytes) }; return data;
}
try {
  command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
  assert.equal(sim.animals.length, 8); assert.equal(sim.counts().grain, 0);
  for (const species of ['hare', 'deer']) for (const sex of ['male', 'female']) assert(sim.animals.some(a => a.species === species && a.sex === sex), `ordinary ${species} has ${sex}`);
  check('fresh colony has eight real adults, both sexes per species and no raw feed');
  const handlerId = sim.pawns.slice().sort((a, b) => b.skills.animals.level - a.skills.animals.level)[0].id;
  assert(sim.pawns.find(p => p.id === handlerId).skills.animals.level >= 8);
  for (const p of sim.pawns) { command({ type: 'priority', pawnId: p.id, work: 'hunt', value: 0 }); command({ type: 'priority', pawnId: p.id, work: 'handle', value: p.id === handlerId ? 1 : 0 }); }
  await save('initial');
  const noFeedId = sim.animals.find(a => a.species === 'hare').id;
  command({ type: 'animalOrder', animalId: noFeedId, order: 'tame', enabled: true });
  for (let n = 0; n < 240; n++) step();
  assert.equal(animal(noFeedId).faction, 'wild'); assert(!sim.pawns.some(p => p.handleTask));
  check('packaged starting meals do not satisfy raw-feed taming requirement');
  command({ type: 'animalOrder', animalId: noFeedId, order: 'tame', enabled: false });
  const surface = [], reserved = new Set([...sim.items, ...sim.stockpiles, ...sim.trees].map(key));
  for (let y = 2; y < 62; y++) for (let x = 2; x < 62; x++) {
    let z = 14; while (z > 0 && !sim.blocks[key({ x, y, z })]) z--;
    const p = { x, y, z: z + 1 }; if (reachable(p)) surface.push(p);
  }
  surface.sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn));
  function site(tool, width = 1) {
    for (const p of surface) {
      const cells = Array.from({ length: width }, (_, i) => ({ ...p, x: p.x + i }));
      if (!cells.every(q => reachable(q) && !reserved.has(key(q)))) continue;
      const c = { type: 'designate', tool, from: point(p), axis: 'x' }, result = sim.command(c);
      if (!result.ok) continue;
      report.commands.push({ tick: sim.tick, c, result }); cells.forEach(q => reserved.add(key(q))); return p;
    }
    throw Error(`No legal construction site for ${tool}`);
  }
  for (const tree of sim.trees.filter(t => t.growth >= .8 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reachable({ ...t, x: t.x + dx, y: t.y + dy }))).sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn)).slice(0, 12)) place('cut', tree);
  for (let n = 0; n < 3; n++) site('bed', 2);
  site('stove'); site('horseshoePin');
  const stores = surface.filter(p => !reserved.has(key(p))).slice(0, 22);
  for (const p of stores) { reserved.add(key(p)); place('stock', p); command({ type: 'storage', from: point(p), priority: 2, accepts: ['grain', 'meal', 'wood'] }); }
  const farms = surface.filter(p => !reserved.has(key(p)) && [1, 8, 10].includes(sim.blocks[key({ ...p, z: p.z - 1 })])).slice(0, 160);
  assert.equal(farms.length, 160); for (const p of farms) { place('farm', p, { crop: 'rice' }); reserved.add(key(p)); }
  until('ordinary builders provide beds, recreation and cooking', () => sim.beds.length === 3 && sim.stoves.length === 1 && sim.horseshoePins.length === 1, DAY * 3);
  command({ type: 'bill', stoveId: sim.stoves[0].id, target: 8, paused: false });
  until('farmers naturally sow, grow and harvest enough real rice for taming', () => sim.counts().grain >= 80, DAY * 12);
  assert(sim.stats.produced.grain >= 80); check('raw feed originated in harvested crops', { produced: sim.stats.produced.grain, available: sim.counts().grain });
  const pair = ['male', 'female'].map(sex => sim.animals.filter(a => !a.dead && a.species === 'hare' && a.sex === sex && a.faction === 'wild' && sim.path(sim.pawns.find(p => p.id === handlerId), a) !== null).sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn))[0]);
  assert(pair.every(Boolean)); const [fatherId, motherId] = pair.map(a => a.id);
  report.browser = { handlerId, noFeedId, fatherId, motherId, readyFixture: 'ready', pairedFixture: 'paired', pregnantFixture: 'pregnant', newbornFixture: 'newborn', grownFixture: 'grown', initialFixture: 'initial' };
  for (const work of ['grow', 'cook', 'build', 'cut', 'haul']) command({ type: 'priority', pawnId: handlerId, work, value: 2 });
  await save('ready');
  for (const a of pair) command({ type: 'animalOrder', animalId: a.id, order: 'tame', enabled: true });
  until('handler physically carries harvested grain toward a marked animal', () => sim.pawns.some(p => p.handleTask?.action === 'tame' && p.handleTask.stage === 'approach' && p.cargo?.resource === 'grain'));
  await save('carrying-feed');
  until('handler arrives adjacent and performs a real feeding interaction', () => sim.pawns.some(p => p.handleTask?.action === 'tame' && p.handleTask.stage === 'interact' && p.handleTask.progress > 5));
  await save('interacting');
  const feedBefore = sim.stats.consumed.grain;
  until('independent attempts eventually tame both members of the real pair', () => pair.every(a => animal(a.id)?.faction === 'colony'), DAY * 12);
  assert(sim.stats.consumed.grain > feedBefore);
  check('taming consumed physical feed and recorded success events', { successes: sim.husbandryLog.filter(e => e.kind === 'tame'), failures: sim.husbandryLog.filter(e => e.kind === 'failed').length });
  for (const id of [fatherId, motherId]) if (successCandidates.has(id)) { await save('tame-near-success', successCandidates.get(id)); report.browser.tameId = id; report.browser.tameFixture = 'tame-near-success'; break; }
  assert(report.browser.tameId, 'one exact pre-success checkpoint captured from ordinary play');
  await save('paired');
  until('the domestic pair naturally mates and the female becomes pregnant', () => !!animal(motherId)?.pregnancy, DAY * 5);
  const conceived = structuredClone(animal(motherId).pregnancy), pregnantSave = sim.save();
  sim = VoxelSimulation.load(pregnantSave); assert.deepEqual(animal(motherId).pregnancy, conceived);
  check('exact save/load retains real pregnancy and both animal identities');
  until('pregnancy advances through ordinary time toward birth', () => animal(motherId)?.pregnancy?.progress >= .99, DAY * 4);
  await save('pregnant');
  const beforeBirth = new Set(sim.animals.map(a => a.id));
  until('pregnancy naturally produces a real newborn in free neighboring ground', () => sim.animals.some(a => !beforeBirth.has(a.id) && a.faction === 'colony' && a.species === 'hare' && a.growth < .01));
  const newborn = sim.animals.find(a => !beforeBirth.has(a.id) && a.faction === 'colony' && a.species === 'hare' && a.growth < .01), childId = newborn.id;
  report.browser.childId = childId; assert(!initialAnimals.has(childId)); assert.equal(newborn.ageTicks, 0);
  assert.notEqual(key(newborn), key(animal(motherId))); await save('newborn');
  until('the young animal naturally eats and grows through juvenile life', () => animal(childId)?.growth >= .4, DAY * 5);
  await save('juvenile');
  until('the young animal approaches adulthood without clock or growth edits', () => animal(childId)?.growth >= .998, DAY * 6);
  await save('near-adult'); report.browser.nearAdultFixture = 'near-adult';
  until('the same newborn reaches adult life with persistent identity', () => animal(childId)?.growth === 1);
  assert(report.grassConsumption, 'domestic consumption depleted a real grass patch and restored hunger');
  check('animals consume real finite grass', report.grassConsumption);
  await save('grown');
  command({ type: 'animalOrder', animalId: fatherId, order: 'release', enabled: true });
  until('handler approaches the adult marked for release', () => sim.pawns.some(p => p.handleTask?.animalId === fatherId && p.handleTask.action === 'release' && p.handleTask.stage === 'interact' && p.handleTask.progress >= 60));
  await save('release'); report.browser.releaseFixture = 'release';
  until('release is completed by a real handler and changes ownership', () => animal(fatherId)?.faction === 'wild');
  assert(sim.husbandryLog.some(e => e.kind === 'release' && e.animalId === fatherId));
  site('butcherSpot');
  command({ type: 'butcherBill', spotId: sim.butcherSpots[0].id, paused: true });
  command({ type: 'animalOrder', animalId: childId, order: 'slaughter', enabled: true });
  until('handler performs the actual marked slaughter', () => sim.pawns.some(p => p.handleTask?.animalId === childId && p.handleTask.action === 'slaughter' && p.handleTask.stage === 'interact' && p.handleTask.progress >= 60));
  await save('slaughter'); report.browser.slaughterFixture = 'slaughter';
  until('slaughter produces the original animal as a real carcass', () => sim.items.some(i => i.carcass?.animalId === childId));
  const carcass = sim.items.find(i => i.carcass?.animalId === childId); assert.equal(carcass.carcass.species, 'hare');
  await save('carcass'); report.browser.carcassFixture = 'carcass'; report.browser.butcherId = sim.butcherSpots[0].id;
  const meatBefore = sim.stats.produced.meat;
  command({ type: 'butcherBill', spotId: sim.butcherSpots[0].id, paused: false });
  until('a cook physically transports and butchers the carcass into meat', () => sim.stats.produced.meat > meatBefore);
  assert(!sim.items.some(i => i.carcass?.animalId === childId));
  const final = sim.save(); sim = VoxelSimulation.load(final); assert.deepEqual(sim.animals, final.animals); assert.deepEqual(sim.grass, final.grass);
  check('final exact reload preserves animals, finite vegetation and ownership'); await save('final'); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack ?? error); await save('failure'); process.exitCode = 1;
} finally {
  report.finalTick = sim.tick; report.finishedAt = new Date().toISOString(); report.stats = sim.stats;
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, finalTick: sim.tick, output: OUT, error: report.error?.slice(0, 1000) }));
}
