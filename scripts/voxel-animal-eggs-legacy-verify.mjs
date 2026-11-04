// Exact Git-built v50 versus current-model continuation; no game or GUI launch.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { build, version as esbuildVersion } from 'esbuild';

const root = process.cwd(), output = resolve('test-results/animal-eggs-v50-baseline');
const head = '367639684c48d55b43f5a8bb7bed548ed6db6bbd';
const subtree = '6b32422008dbbdc6bc549dab128c725f78d7c411';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const relativePath = path => relative(root, path).split(sep).join('/');
const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { encoding: 'utf8' }).trim();
const gitSource = path => execFileSync('git', ['show', `${head}:${prefix}${path}`], { maxBuffer: 16 * 1024 * 1024 });
const tree = execFileSync('git', ['rev-parse', `${head}:${prefix.replace(/\/$/, '')}`], { encoding: 'utf8' }).trim();
assert.equal(tree, execFileSync('git', ['rev-parse', `${subtree}^{tree}`], { encoding: 'utf8' }).trim());
mkdirSync(output, { recursive: true });

// The committed v50 receipt pins the authentic original fixture, the old public-
// command script and its actual v49 working save. Never synthesize an old version.
const receiptPath = 'docs/research/rimworld/evidence/animal-wool-voxel-validation.json';
const receiptBytes = gitSource(receiptPath), receipt = JSON.parse(receiptBytes);
const retained = receipt.implicitTailor, verified = {};
for (const name of ['fixture', 'provenance', 'baseline', 'report', 'script']) {
  const record = retained[name], bytes = readFileSync(record.file);
  assert.equal(hash(bytes), record.sha256, `Historical ${name} changed`);
  assert.equal(bytes.length, record.bytes);
  verified[name] = { ...record }; verified[name].bytes = bytes;
}
const originalProof = JSON.parse(verified.provenance.bytes), oldReport = JSON.parse(verified.report.bytes);
assert.equal(originalProof.loadedByOriginalSource, true); assert.equal(originalProof.version, 16);
assert.equal(oldReport.status, 'passed'); assert.equal(oldReport.baseline.version, 49);
assert.equal(oldReport.baseline.sha256, retained.baseline.sha256);
assert.equal(oldReport.scriptSha256, retained.script.sha256);
const original = JSON.parse(verified.baseline.bytes);
assert.equal(original.version, 49); assert.equal(original.tick, 301264);
assert.equal(original.productionQueues.length, 0);

async function bundle(historical) {
  const sources = new Map();
  const result = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm',
    write: false, metafile: true, plugins: [{ name: historical ? 'frozen-v50-git-source' : 'current-source-identity', setup(api) {
      api.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, ({ path }) => {
        const local = relativePath(path); assert.ok(local.startsWith('src/'));
        const bytes = historical ? gitSource(local) : readFileSync(path); sources.set(local, hash(bytes));
        return { contents: bytes, loader: local.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) };
      });
    } }] });
  for (const path of Object.keys(result.metafile.inputs)) assert.ok(sources.has(path.replaceAll('\\', '/')));
  const sorted = Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b)));
  if (historical) assert.deepEqual(sorted, oldReport.execution.sources, 'Every frozen v50 dependency matches its published evidence');
  const file = resolve(output, historical ? 'world-v50.mjs' : 'world-current.mjs');
  writeFileSync(file, result.outputFiles[0].contents);
  const module = await import(pathToFileURL(file).href);
  return { Simulation: module.VoxelSimulation, file: relativePath(file), sha256: hash(result.outputFiles[0].contents), sources: sorted };
}
const historical = await bundle(true), currentBuild = await bundle(false);
const Old = historical.Simulation, Current = currentBuild.Simulation;
let old = Old.load(original);
const sourceV50 = old.save(); assert.equal(sourceV50.version, 50);
const stoveId = old.stoves[0].id, tailorId = old.tailors[0].id;
assert.equal(stoveId, 362); assert.equal(tailorId, 640);
assert.ok(!sourceV50.productionQueues.some(q => q.benchId === stoveId), 'The old stove is genuinely implicit');
const unfinished = s => [...s.items, ...s.pawns.flatMap(p => p.cargo ? [p.cargo] : [])]
  .find(item => item.unfinished?.recipe === 'tailoring:tuque')?.unfinished;
const inheritedUft = structuredClone(unfinished(old)); assert.equal(inheritedUft.id, 2595);
assert.equal(inheritedUft.progress, 20); assert.equal(inheritedUft.creatorId, 103);
assert.deepEqual(inheritedUft.ingredients, [{ resource: 'cloth', amount: 20 }]);
assert.ok(sourceV50.productionQueues.some(q => q.benchId === tailorId));
const before = { cooked: old.stats.cooked, tailored: old.stats.tailored, consumed: { ...old.stats.consumed }, produced: { ...old.stats.produced } };
const commands = [];
function command(c) {
  const result = old.command(c); assert.ok(result.ok, result.message);
  commands.push({ tick: old.tick, command: c, result });
}
command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
const cook = [...old.pawns].filter(p => p.faction === 'colony' && !p.dead && p.id !== inheritedUft.creatorId)
  .sort((a, b) => b.skills.cooking.level - a.skills.cooking.level)[0];
assert.ok(cook);
for (const pawn of old.pawns.filter(p => p.faction === 'colony')) {
  for (let hour = 0; hour < 24; hour++) command({ type: 'schedule', pawnId: pawn.id, hour, assignment: 'work' });
  for (const work of Object.keys(pawn.priorities)) command({ type: 'priority', pawnId: pawn.id, work,
    value: (pawn.id === cook.id && work === 'cook') || (pawn.id === inheritedUft.creatorId && work === 'craft') ? 1 : 0 });
}
const target = old.counts().meal + 1;
command({ type: 'bill', stoveId, target, paused: false });
const balance = s => Object.fromEntries(Object.entries(s.counts()).map(([resource, amount]) => [resource,
  amount + s.stats.consumed[resource] + s.stats.spoiled[resource] + s.stats.destroyed[resource]
    - s.stats.produced[resource] - s.trade.imported[resource] + s.trade.exported[resource]]));
const historicalBalance = balance(old);
let captureTicks = 0;
while (!old.jobs.some(j => j.kind === 'cook' && j.progress >= 20)) {
  assert.ok(captureTicks < 3000, 'Bounded real fetching and cooking in frozen v50');
  old.step(); captureTicks++; assert.deepEqual(balance(old), historicalBalance);
}
const checkpoint = old.save(), cookJob = checkpoint.jobs.find(j => j.kind === 'cook');
const activeUft = structuredClone(unfinished(old));
assert.equal(checkpoint.version, 50); assert.ok(!checkpoint.productionQueues.some(q => q.benchId === stoveId));
assert.ok(activeUft && activeUft.progress > inheritedUft.progress && activeUft.progress < activeUft.workTotal);
assert.equal(activeUft.id, inheritedUft.id); assert.equal(cookJob.billId, `legacy:${stoveId}:cook`);
assert.deepEqual(cookJob.cost, { wood: 1, grain: 10 }); assert.deepEqual(cookJob.delivered, { grain: 10, wood: 1 });
assert.equal(cookJob.owner, cook.id); assert.ok(cookJob.progress > 0 && cookJob.progress < cookJob.work);
const checkpointPath = resolve(output, 'v50-working-cook-and-cloth.json'), checkpointBytes = Buffer.from(JSON.stringify(checkpoint));
writeFileSync(checkpointPath, checkpointBytes);
writeFileSync(resolve(output, 'origin-v49-working-cloth.json'), verified.baseline.bytes);
let current = Current.load(checkpoint); old = Old.load(checkpoint);
assert.equal(current.save().version, 51);
const unlimited = { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
function normalized(sim) {
  const result = sim.save(), version = result.version; delete result.version;
  // Compare resolved identities/settings, independent of explicit queue storage.
  result.productionQueues = structuredClone(sim.snapshot().productionQueues).sort((a, b) => a.benchId - b.benchId);
  if (version === 51) {
    for (const animal of result.animals) {
      assert.notEqual(animal.species, 'chicken');
      for (const key of ['eggProgress', 'fertilizationCount', 'layProgress']) { assert.equal(animal[key], 0); delete animal[key]; }
      assert.equal(animal.eggFatherId, null); delete animal.eggFatherId;
    }
    for (const ledger of [result.stats.produced, result.stats.consumed, result.stats.spoiled, result.stats.destroyed,
      result.trade.imported, result.trade.exported]) for (const resource of ['eggUnfertilized', 'eggFertilized']) {
      assert.equal(ledger[resource], 0); delete ledger[resource];
    }
    assert.deepEqual(result.autoSlaughter.chicken, unlimited); delete result.autoSlaughter.chicken;
    for (const marker of result.penMarkers) { assert.equal(marker.filter.chicken, false); delete marker.filter.chicken; }
  }
  return result;
}
function difference(a, b, path = '') {
  if (isDeepStrictEqual(a, b)) return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return { path, current: a, historical: b };
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const found = difference(a[key], b[key], path ? `${path}.${key}` : key); if (found) return found;
  }
  return { path, current: a, historical: b };
}
const currentBalance = balance(current), reloads = [], progress = [], checkpoints = [];
const legacyBillId = `legacy:${stoveId}:cook`;
function audit() {
  assert.deepEqual(balance(old), historicalBalance); assert.deepEqual(balance(current), currentBalance);
  const a = normalized(current), b = normalized(old), mismatch = difference(a, b);
  if (mismatch) {
    writeFileSync(resolve(output, 'mismatch.json'), JSON.stringify({ tick: current.tick, first: mismatch, current: a, historical: b }, null, 2));
    assert.fail(`Historical model mismatch: ${JSON.stringify(mismatch)}`);
  }
  const bill = current.productionQueues.find(q => q.benchId === stoveId)?.bills.find(b => b.id === legacyBillId);
  assert.ok(bill, 'Implicit stove now has the same stable explicit bill identity');
  assert.deepEqual(bill.policy.allowedFood, ['grain', 'meat', 'milk']);
  assert.ok(!bill.policy.allowedCarcasses.includes('chicken'));
}
function retain(name) {
  const save = current.save(), bytes = Buffer.from(JSON.stringify(save));
  const file = resolve(output, `${name}.json`); writeFileSync(file, bytes);
  checkpoints.push({ file: relativePath(file), sha256: hash(bytes), version: save.version, tick: save.tick });
  return save;
}
function reload(name) {
  const save = retain(name); current = Current.load(save); old = Old.load(old.save()); reloads.push(current.tick); audit();
}
audit(); reload('migrated-active-cook-and-cloth');
let continuationTicks = 0, midCookReload = false, midClothReload = false;
while (current.stats.cooked === before.cooked || current.stats.tailored === before.tailored) {
  assert.ok(continuationTicks < 3000, 'Bounded complete historical meal and cloth product');
  current.step(); old.step(); continuationTicks++; audit();
  const job = current.jobs.find(j => j.id === cookJob.id), uft = unfinished(current);
  if (job && (job.progress === cookJob.progress + 1 || job.progress >= 50 && !midCookReload))
    progress.push({ tick: current.tick, kind: 'cook', jobId: job.id, progress: job.progress });
  if (job && job.progress >= 50 && !midCookReload) { reload('mid-cook'); midCookReload = true; }
  if (uft && uft.progress >= activeUft.progress + 100 && !midClothReload) { reload('mid-cloth'); midClothReload = true; }
}
assert.ok(midCookReload && midClothReload);
assert.equal(current.stats.cooked - before.cooked, 1); assert.equal(current.stats.tailored - before.tailored, 1);
assert.equal(current.stats.consumed.grain - before.consumed.grain, 10);
assert.equal(current.stats.consumed.wood - before.consumed.wood, 1);
const garments = s => [...s.items.flatMap(i => i.apparel ? [i.apparel] : []),
  ...s.pawns.flatMap(p => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])])];
const beforeGarments = new Set(garments(Old.load(checkpoint)).map(p => p.id));
const made = garments(current).filter(p => !beforeGarments.has(p.id));
assert.equal(made.length, 1); assert.equal(made[0].kind, 'tuque'); assert.equal(made[0].material, 'cloth');
reload('completed-cook-and-cloth');
for (let n = 0; n < 60; n++) { current.step(); old.step(); continuationTicks++; audit(); }
assert.equal(current.stats.cooked - before.cooked, 1); assert.equal(current.stats.tailored - before.tailored, 1);
retain('final');
for (const [path, expected] of Object.entries(currentBuild.sources)) assert.equal(hash(readFileSync(path)), expected, `Current source changed during verification: ${path}`);
for (const { file, bytes } of Object.values(verified)) assert.deepEqual(readFileSync(file), bytes);
assert.deepEqual(readFileSync(checkpointPath), checkpointBytes);
const publicIdentity = ({ Simulation: _, ...entry }) => entry;
const provenance = { status: 'captured', head, subtree, tree, esbuildVersion,
  receipt: { file: receiptPath, sha256: hash(receiptBytes), fromGit: head },
  originalFixture: retained.fixture, originalProof: retained.provenance,
  sourceHistoricalRun: { report: retained.report, script: retained.script, baseline: retained.baseline },
  sourceModel: publicIdentity(historical), commands, captureTicks,
  baseline: { file: relativePath(checkpointPath), sha256: hash(checkpointBytes), byteLength: checkpointBytes.length,
    version: checkpoint.version, tick: checkpoint.tick, cookJob, unfinished: activeUft } };
writeFileSync(resolve(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
const result = { status: 'passed', checkedAt: new Date().toISOString(), nativeGameplay: false, browserInteraction: false,
  scope: 'Authentic v16 colony campaign, previously continued by public commands in frozen v49 to a real cloth UFT. Exact published v50 then receives only public commands and ordinary ticks to make a genuine v50 save with an implicit stove and active grain cooking plus cloth UFT. Current v51 and frozen v50 compare full states every tick after only zero egg fields and implicit/explicit queue representation normalization, including reloads and one meal plus one cloth tuque. This is a controlled continuation of authentic history, not a natural egg, milk, shearing or wool campaign.',
  originalHead: head, originalSubtree: subtree, historicalLockstep: true,
  normalization: ['version tag', 'asserted-zero new egg ledgers and animal fields', 'asserted-default chicken pen/slaughter settings', 'resolved production queue representation'],
  execution: { script: 'scripts/voxel-animal-eggs-legacy-verify.mjs', scriptSha256: hash(readFileSync(new URL(import.meta.url))),
    esbuildVersion, ...publicIdentity(currentBuild), sourceCount: Object.keys(currentBuild.sources).length },
  provenance: { file: relativePath(resolve(output, 'provenance.json')), sha256: hash(readFileSync(resolve(output, 'provenance.json'))) },
  captureTicks, historicalTick: checkpoint.tick, finalTick: current.tick, continuationTicks, auditedTicks: continuationTicks, reloads, progress, checkpoints,
  outputs: { meals: current.stats.cooked - before.cooked, apparel: current.stats.tailored - before.tailored, material: 'cloth' },
  ingredients: { grain: 10, wood: 1, inheritedCloth: 20 }, stoveId, legacyBillId, cookId: cook.id,
  resourceBalances: currentBalance };
writeFileSync(resolve(output, 'report.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, captureTicks, historicalTick: checkpoint.tick, continuationTicks,
  finalTick: result.finalTick, reloads, outputs: result.outputs, report: relativePath(resolve(output, 'report.json')) }));
