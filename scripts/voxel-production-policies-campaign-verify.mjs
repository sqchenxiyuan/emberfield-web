import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_PRODUCTION_POLICIES_OUT ?? 'test-results/voxel-production-policies-campaign';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(OUT, { recursive: true });
const compiled = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { VoxelSimulation } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const report = { status: 'running', scriptSha256: hash(await readFile(new URL(import.meta.url))),
  bundleSha256: hash(compiled.outputFiles[0].contents),
  scope: 'Three independent continuations of SHA-verified, unchanged historical ordinary-player campaigns. Public commands, ordinary ticks and save/load only. Read-only geometry, stock and paths choose reachable sites. No terrain, resource, skill, needs, position, clock or RNG injection. Each scenario audits every resource after every tick and command; the branches are not represented as one continuous colony.',
  scenarios: [], checks: [], checkpoints: [] };
let s, scenario, initial, initialLedger;
function audit() {
  const counts = s.counts();
  for (const resource of Object.keys(initial)) assert.equal(counts[resource] + s.stats.consumed[resource] - initialLedger.consumed[resource]
    + s.stats.spoiled[resource] - initialLedger.spoiled[resource] + s.stats.destroyed[resource] - initialLedger.destroyed[resource],
    initial[resource] + s.stats.produced[resource] - initialLedger.produced[resource], resource);
}
function command(value) {
  const result = s.command(value); scenario.commands.push({ tick: s.tick, command: value, result });
  assert(result.ok, JSON.stringify({ value, result })); audit(); return result;
}
function check(name) { report.checks.push({ scenario: scenario.name, name, tick: s.tick }); console.log('PASS', scenario.name, name, s.tick); }
function step(ticks) { for (let n = 0; n < ticks; n++) { s.step(); audit(); } }
function until(name, done, max = 16000) {
  for (let n = 0; n < max && !done(); n++) step(1);
  assert(done(), JSON.stringify({ name, tick: s.tick, jobs: s.jobs, pawns: s.pawns.map(p => ({ id: p.id, phase: p.phase, reason: p.reason })) })); check(name);
}
const queue = benchId => s.snapshot().productionQueues.find(q => q.benchId === benchId);
const bill = (benchId, billId) => queue(benchId).bills.find(b => b.id === billId);
const update = (benchId, billId, patch) => command({ type: 'productionBillUpdate', benchId, billId, patch });
const policy = (benchId, billId, patch) => update(benchId, billId, { policy: { ...bill(benchId, billId).policy, ...patch } });
function add(benchId, recipe, remaining = 1) {
  command({ type: 'productionBillAdd', benchId, recipe }); const id = queue(benchId).bills.at(-1).id;
  update(benchId, id, { remaining }); return id;
}
async function save(name) {
  const path = `${OUT}/${name}.json`, bytes = JSON.stringify(s.save()); await writeFile(path, bytes);
  report.checkpoints.push({ name, scenario: scenario.name, path, sha256: hash(bytes), tick: s.tick });
}
function reload() { s = VoxelSimulation.load(s.save()); audit(); }
async function start(name, file, expectedVersion, work) {
  const path = `tests/fixtures/${file}.json`, provenance = JSON.parse(await readFile(`tests/fixtures/${file}.provenance.json`, 'utf8'));
  const bytes = await readFile(path), old = JSON.parse(bytes); assert.equal(hash(bytes), provenance.sha256); assert.equal(old.version, expectedVersion);
  s = VoxelSimulation.load(old); initial = s.counts(); initialLedger = structuredClone(s.stats);
  scenario = { name, input: path, inputSha256: hash(bytes), inputVersion: old.version, inputTick: old.tick, commands: [] };
  report.scenarios.push(scenario);
  command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
  // Ordinary management isolates the requested production from other work types.
  for (const pawn of s.pawns.filter(p => p.faction === 'colony')) {
    for (const type of Object.keys(pawn.priorities)) command({ type: 'priority', pawnId: pawn.id, work: type, value: type === work ? 1 : 0 });
    for (let hour = 0; hour < 24; hour++) command({ type: 'schedule', pawnId: pawn.id, hour, assignment: 'work' });
  }
  for (const q of s.snapshot().productionQueues) for (const b of q.bills)
    command({ type: 'productionBillDelete', benchId: q.benchId, billId: b.id });
  step(100); // Existing carried goods are put down through ordinary hauling.
}

try {
  await start('crafting', 'voxel-v39-mid-production-before-policies', 39, 'craft');
  const workers = s.pawns.filter(p => p.faction === 'colony' && !p.dead && !p.cargo).sort((a, b) => b.skills.crafting.level - a.skills.crafting.level);
  assert(workers.length >= 2); const firstWorkerId = workers[0].id, secondWorkerId = workers[1].id;
  const squared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
  const wood = s.items.filter(i => i.resource === 'wood'); assert(wood.reduce((n, i) => n + i.amount, 0) >= 80);
  let site;
  for (let radius = 5; radius <= 18 && !site; radius++) for (let dy = -radius; dy <= radius && !site; dy++) for (let dx = -radius; dx <= radius && !site; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
    const p = { x: s.spawn.x + dx, y: s.spawn.y + dy, z: s.spawn.z };
    if (!s.standable(p) || !s.exploredAt(p) || s.items.some(i => squared(i, p) < 1) ||
      s.weaponBenches.some(b => squared(b, p) < 9) || wood.some(i => squared(i, p) < 16) || s.path(workers[0], p) === null) continue;
    site = p;
  }
  assert(site, 'Ordinary colony must have a reachable crafting site outside the small stock radius');
  command({ type: 'designate', tool: 'craftingSpot', from: site });
  const benchId = s.weaponBenches.find(b => squared(b, site) === 0).id;
  for (const b of queue(benchId).bills) command({ type: 'productionBillDelete', benchId, billId: b.id });
  const billId = add(benchId, 'smith:woodClub', 2);
  Object.assign(scenario, { benchId, billId, firstWorkerId, secondWorkerId, site });
  policy(benchId, billId, { skillMin: 20, skillMax: 20 }); step(60);
  assert(!s.jobs.some(j => j.billId === billId && j.owner !== null)); check('player skill range prevents unqualified new work');
  await save('craft-skill-blocked');
  policy(benchId, billId, { workerId: firstWorkerId, ingredientRadius: 3 }); step(60);
  assert(!s.jobs.some(j => j.billId === billId && j.owner !== null)); assert.equal(bill(benchId, billId).remaining, 2);
  check('named worker bypasses player skill range but distant real wood remains out of radius'); await save('craft-radius-blocked');
  policy(benchId, billId, { ingredientRadius: null });
  until('named worker physically fetches wood and begins the batch', () => s.jobs.some(j => j.billId === billId && j.owner === firstWorkerId && j.progress > 0));
  await save('craft-working');
  const beforeWeapons = s.stats.weaponsMade, beforeWood = s.stats.consumed.wood;
  policy(benchId, billId, { workerId: secondWorkerId, ingredientRadius: 3 });
  assert(s.jobs.some(j => j.billId === billId && j.owner === firstWorkerId && j.productionPolicy.ingredientRadius === null));
  until('current worker completes the selected physical batch after policy change', () => bill(benchId, billId).remaining === 1);
  assert.equal(s.stats.weaponsMade, beforeWeapons + 1); assert.equal(s.stats.consumed.wood, beforeWood + 40);
  step(40); assert(!s.jobs.some(j => j.billId === billId && j.owner !== null)); reload();
  assert.equal(bill(benchId, billId).policy.workerId, secondWorkerId); check('next batch and save reload use the new worker and radius');
  policy(benchId, billId, { ingredientRadius: null });
  until('second designated worker takes over the next batch', () => s.jobs.some(j => j.billId === billId && j.owner === secondWorkerId && j.progress > 0));
  until('two physical products exhaust the requested count', () => bill(benchId, billId).remaining === 0);
  assert.equal(s.stats.weaponsMade, beforeWeapons + 2); assert.equal(s.stats.consumed.wood, beforeWood + 80);
  await save('craft-final'); scenario.finalTick = s.tick;

  await start('cooking', 'voxel-v30-living-final', 30, 'cook');
  const stoveId = s.stoves[0].id, foodBillId = add(stoveId, 'cook', 2);
  Object.assign(scenario, { benchId: stoveId, billId: foodBillId });
  policy(stoveId, foodBillId, { allowedFood: [] }); step(60);
  assert(!s.jobs.some(j => j.billId === foodBillId && j.owner !== null)); check('empty food filter leaves actual grain untouched');
  await save('food-blocked');
  policy(stoveId, foodBillId, { allowedFood: ['grain'] });
  until('grain-only policy delivers real ingredients and starts cooking', () => s.jobs.some(j => j.billId === foodBillId && j.progress > 0));
  await save('food-working');
  const beforeMeals = s.stats.produced.meal, beforeGrain = s.stats.consumed.grain;
  policy(stoveId, foodBillId, { allowedFood: ['meat'] });
  until('changing filter preserves the already selected grain batch', () => bill(stoveId, foodBillId).remaining === 1);
  assert.equal(s.stats.produced.meal, beforeMeals + 1); assert.equal(s.stats.consumed.grain, beforeGrain + 10);
  step(40); assert(!s.jobs.some(j => j.billId === foodBillId && j.owner !== null)); reload();
  check('the following meat-only batch waits instead of consuming grain'); await save('food-next-filter');
  policy(stoveId, foodBillId, { allowedFood: ['grain', 'meat'] });
  until('re-enabling grain completes the second meal with conserved inputs', () => bill(stoveId, foodBillId).remaining === 0);
  assert.equal(s.stats.produced.meal, beforeMeals + 2); assert.equal(s.stats.consumed.grain, beforeGrain + 20);
  await save('food-final'); scenario.finalTick = s.tick;

  await start('butchering', 'voxel-v31-social-seated-meal', 31, 'cook');
  const spotId = s.butcherSpots[0].id, carcass = s.items.find(i => i.resource === 'carcass'); assert(carcass?.carcass);
  const butcherBillId = add(spotId, 'butcher'), species = carcass.carcass.species;
  Object.assign(scenario, { benchId: spotId, billId: butcherBillId, species });
  policy(spotId, butcherBillId, { allowedCarcasses: [] }); step(60);
  assert(!s.jobs.some(j => j.billId === butcherBillId && j.owner !== null)); check('empty carcass filter prevents ordinary butchering');
  await save('butcher-blocked');
  policy(spotId, butcherBillId, { allowedCarcasses: [species] });
  until('allowed species is physically delivered and butchered', () => s.jobs.some(j => j.billId === butcherBillId && j.progress > 0));
  await save('butcher-working');
  const beforeMeat = s.stats.produced.meat, beforeCarcass = s.stats.consumed.carcass;
  policy(spotId, butcherBillId, { allowedCarcasses: [] });
  until('current carcass finishes after its species is deselected', () => bill(spotId, butcherBillId).remaining === 0);
  assert.equal(s.stats.consumed.carcass, beforeCarcass + 1); assert(s.stats.produced.meat > beforeMeat);
  reload(); await save('butcher-final'); scenario.finalTick = s.tick;
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack ?? error); throw error; }
finally { await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
