import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = process.env.VOXEL_FOOD_CAMPAIGN_OUT ?? 'test-results/voxel-food-campaign';
const SEED = Number(process.env.VOXEL_FOOD_CAMPAIGN_SEED ?? 73129);
const DAY = 12000;
await mkdir(OUT, { recursive: true });
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { VoxelSimulation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
let sim = new VoxelSimulation(SEED);
const initial = sim.counts();
const report = {
  seed: SEED, scope: 'Public command/step/save/load only, with normal day/night time progression. No resource injection, mature-crop injection, terrain editing, pawn teleportation or direct tick changes. Nominal edible nutrition explicitly includes the recipe gain: 10 grain at 0.05 becomes one 0.9 meal, adding 0.4 nutrition per cooked meal. This does not claim physical calorie conservation or unlimited colony sustainability.',
  commands: [], checkpoints: [], daily: [], harvestEvents: [], mealEatingEvents: [],
  minimumFood: 100, cargoObserved: {}, status: 'running', errors: [],
};
const resources = Object.keys(initial);
const pos = (x, y, z = 8) => ({ x, y, z });
const key = p => `${p.x},${p.y},${p.z}`;
const totals = () => {
  const counts = sim.counts(), cooked = sim.stats.cooked;
  const grainEaten = sim.stats.consumed.grain - 10 * cooked;
  assert.ok(grainEaten >= 0, 'cooking cannot consume more grain than all recorded grain consumption');
  const availableNutrition = counts.food * .9 + counts.grain * .05 + counts.meal * .9;
  const eatenNominalNutrition = sim.stats.consumed.food * .9 + grainEaten * .05 + sim.stats.consumed.meal * .9;
  const spoiledNutrition = sim.stats.spoiled.food * .9 + sim.stats.spoiled.grain * .05 + sim.stats.spoiled.meal * .9;
  const initialNutrition = initial.food * .9 + initial.grain * .05 + initial.meal * .9;
  const harvestNutrition = sim.stats.produced.grain * .05;
  const cookingNutritionGain = cooked * .4;
  assert.ok(Math.abs(availableNutrition + eatenNominalNutrition + spoiledNutrition - initialNutrition - harvestNutrition - cookingNutritionGain) < 1e-8,
    `nominal edible nutrition accounting failed at tick ${sim.tick}`);
  return { availableNutrition, eatenNominalNutrition, spoiledNutrition, initialNutrition, harvestNutrition, cookingNutritionGain, grainEaten };
};
function audit() {
  const counts = sim.counts();
  for (const r of resources) assert.equal(counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r], initial[r] + sim.stats.produced[r], `${r} ledger at ${sim.tick}`);
  assert.equal(sim.stats.produced.meal, sim.stats.cooked, 'each completed cooking job makes exactly one meal');
  for (const p of sim.pawns) {
    assert.ok(sim.standable(p), `unsupported pawn ${p.id} at ${sim.tick}`);
    report.minimumFood = Math.min(report.minimumFood, p.food);
    if (p.cargo) report.cargoObserved[p.cargo.resource] = (report.cargoObserved[p.cargo.resource] ?? 0) + 1;
  }
  assert.ok(sim.items.every(i => Number.isSafeInteger(i.amount) && i.amount > 0));
  const owners = sim.jobs.filter(j => j.owner !== null).map(j => j.owner);
  assert.equal(new Set(owners).size, owners.length, 'exclusive work ownership');
  totals();
}
function step() {
  const harvestedBefore = sim.stats.harvested, mealsBefore = sim.stats.consumed.meal;
  const beforeCrops = new Map(sim.crops.map(c => [c.id, { ...c }]));
  sim.step(); audit();
  if (sim.stats.harvested > harvestedBefore) {
    const remaining = new Set(sim.crops.map(c => c.id));
    for (const [id, crop] of beforeCrops) if (!remaining.has(id))
      report.harvestEvents.push({ tick: sim.tick, day: sim.tick / DAY, crop, growthDays: (sim.tick - crop.sownAt) / DAY });
  }
  if (sim.stats.consumed.meal > mealsBefore) report.mealEatingEvents.push({ tick: sim.tick, count: sim.stats.consumed.meal - mealsBefore });
  if (sim.tick % DAY === 0) {
    const sample = { day: sim.tick / DAY, tick: sim.tick, counts: sim.counts(), stats: structuredClone(sim.stats),
      crops: sim.crops.length, growthRange: sim.crops.length ? [Math.min(...sim.crops.map(c => c.growth)), Math.max(...sim.crops.map(c => c.growth))] : [],
      pawnFood: sim.pawns.map(p => p.food), minimumFood: report.minimumFood, nutrition: totals() };
    report.daily.push(sample); console.log('DAY', sample.day, JSON.stringify({ crops: sample.crops, growthRange: sample.growthRange,
      harvested: sim.stats.harvested, cooked: sim.stats.cooked, counts: sample.counts, minimumFood: report.minimumFood }));
  }
}
function until(label, predicate, limit = DAY * 24) {
  const start = sim.tick;
  while (!predicate() && sim.tick - start < limit) step();
  assert.ok(predicate(), `${label} timed out at ${sim.tick}: ${JSON.stringify({ jobs: sim.jobs, pawns: sim.pawns, crops: sim.crops, stoves: sim.stoves })}`);
  report.checkpoints.push({ label, tick: sim.tick, day: sim.tick / DAY, elapsed: sim.tick - start, counts: sim.counts(), stats: structuredClone(sim.stats), nutrition: totals() });
  console.log('PASS', label, `tick=${sim.tick}`);
}
function command(c) {
  const result = sim.command(c); report.commands.push({ tick: sim.tick, command: c, result });
  assert.ok(result.ok, JSON.stringify({ c, result })); return result;
}
const designate = (tool, from, to, crop) => command({ type: 'designate', tool, from, to, ...(crop ? { crop } : {}) });
async function roundtrip(label) {
  const save = sim.save(), counts = sim.counts(), stats = structuredClone(sim.stats);
  await writeFile(`${OUT}/${label}.json`, JSON.stringify(save));
  sim = VoxelSimulation.load(JSON.parse(JSON.stringify(save)));
  assert.deepEqual(sim.counts(), counts); assert.deepEqual(sim.stats, stats); audit();
}

try {
  audit();
  for (const p of [pos(27,29), pos(28,27), pos(36,28)]) designate('cut', p);
  const reserved = new Set([pos(32,31),pos(34,31),pos(31,31),pos(33,31),...sim.stockpiles].map(key));
  const candidates = [];
  for(let y=25;y<=39;y++)for(let x=25;x<=39;x++) {
    const p=pos(x,y);
    if(!reserved.has(key(p)) && sim.standable(p) && sim.cropCondition(p,'rice').fertility===1) candidates.push(p);
  }
  candidates.sort((a,b)=>Math.hypot(a.x-32,a.y-32)-Math.hypot(b.x-32,b.y-32)||a.y-b.y||a.x-b.x);
  assert.ok(candidates.length>=120,'120 usable ground plots must be available');
  for(const p of candidates.slice(0,120)) designate('farm',p,undefined,'rice');
  designate('farm', pos(31, 31), undefined, 'potato');
  designate('farm', pos(33, 31), undefined, 'corn');
  const ricePlots = sim.farms.filter(f => f.crop === 'rice').length;
  until('workers sow rice, potato and corn in real soil', () => sim.crops.length === sim.farms.length && sim.crops.some(c => c.kind === 'potato') && sim.crops.some(c => c.kind === 'corn'), DAY);
  await roundtrip('growing-save');
  const cropIds = new Set(sim.crops.filter(c => c.kind === 'rice').map(c => c.id));
  until('unaccelerated calendar growth yields harvested raw ingredients', () => sim.stats.harvested >= 8 && sim.counts().grain >= 30 && report.cargoObserved.grain > 0);
  await writeFile(`${OUT}/first-harvest.json`,JSON.stringify(sim.save()));
  assert.ok(report.harvestEvents.some(e => e.crop.kind === 'rice' && e.crop.growth >= 1));
  assert.ok(report.harvestEvents[0].growthDays >= 3, 'three full-speed growth days cannot mature in fewer calendar days');
  assert.ok(report.cargoObserved.grain > 0, 'grain must be physically carried');

  designate('stove', pos(32, 31));
  until('a colonist builds the wood-fired stove with delivered wood', () => sim.stoves.length === 1, DAY);
  const stoveId = sim.stoves[0].id;
  command({ type: 'bill', stoveId, target: 6, paused: false });
  until('cooking has real delivered ingredients or carried grain', () => sim.jobs.some(j => j.kind === 'cook' && (j.delivered.grain ?? 0) > 0)
    || sim.pawns.some(p => p.cargo?.resource === 'grain' && sim.jobs.some(j => j.id === p.jobId && j.kind === 'cook')), DAY);
  await roundtrip('cooking-save');
  until('grain and fuel become simple meals which colonists actually eat', () => sim.stats.cooked >= 3 && sim.stats.consumed.meal >= 1, DAY * 3);
  until('harvested plots are automatically sown again and resume growth', () => sim.crops.some(c => c.kind === 'rice' && !cropIds.has(c.id) && c.growth > .001), DAY);
  await writeFile(`${OUT}/first-cycle.json`, JSON.stringify(sim.save()));
  until('120 rice plots complete two real calendar growth and harvest cycles',()=>report.harvestEvents.filter(e=>e.crop.kind==='rice').length>=ricePlots*2,DAY*20);
  const harvestsByPlot=new Map();
  for(const event of report.harvestEvents.filter(e=>e.crop.kind==='rice'))harvestsByPlot.set(key(event.crop),(harvestsByPlot.get(key(event.crop))??0)+1);
  assert.equal([...harvestsByPlot.values()].filter(n=>n>=2).length,ricePlots,'every rice plot completes a second harvest');
  until('second harvest reaches stock and the meal target recovers',()=>sim.counts().meal>=6&&sim.jobs.every(j=>j.kind!=='cook')&&sim.snapshot().stored.grain===sim.counts().grain,DAY*2);
  command({ type: 'bill', stoveId, target: 6, paused: true });
  assert.equal(sim.jobs.filter(j => j.kind === 'cook').length, 0, 'pausing refunds and removes the cooking job'); audit();
  report.final = { tick: sim.tick, calendarDays: sim.tick / DAY, ricePlots, counts: sim.counts(), stored: sim.snapshot().stored, stats: sim.stats,
    nutrition: totals(), minimumFood: report.minimumFood, firstRiceHarvest: report.harvestEvents.find(e => e.crop.kind === 'rice'),
    replantCount: sim.crops.filter(c => c.kind === 'rice' && !cropIds.has(c.id)).length };
  await writeFile(`${OUT}/final.json`, JSON.stringify(sim.save()));
  report.status = 'passed'; console.log('PASS normal-command food campaign', JSON.stringify(report.final));
} catch (error) {
  report.status = 'failed'; report.errors.push(String(error.stack ?? error));
  await writeFile(`${OUT}/failed-state.json`, JSON.stringify(sim.save())); throw error;
} finally { await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
