// Read retained v45 saves and run only the headless simulation model. No GUI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const hash = data => createHash('sha256').update(data).digest('hex');
const root = process.cwd();
const baseline = resolve('test-results/auto-rebuild-v45-baseline');
const output = resolve('test-results/auto-rebuild-legacy');
const provenanceFile = 'docs/research/rimworld/evidence/auto-rebuild-v45-provenance.json';
const provenanceBytes = readFileSync(provenanceFile);
const provenance = JSON.parse(provenanceBytes);
assert.deepEqual(provenanceBytes, readFileSync(resolve(baseline, 'provenance.json')), 'Public provenance is an exact byte copy');
assert.equal(provenance.status, 'captured');
assert.equal(provenance.head, '860ef95130e9d0cd46d2f998334546e32cba79ee');
assert.equal(provenance.samples.length, 2);
assert.deepEqual(provenance.samples.map(s => s.file), ['carrying-chair-input.json', 'built-chair-forbidden-wood.json']);
const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { encoding: 'utf8' }).trim();
const gitSource = path => execFileSync('git', ['show', `${provenance.head}:${prefix}${path}`], { maxBuffer: 16 * 1024 * 1024 });
assert.equal(hash(gitSource('src/voxel/world.ts')), provenance.worldSha256, 'Recorded v45 world is the exact Git commit source');
const captureScript = 'test-results/capture-auto-rebuild-v45-baseline.mjs';
assert.equal(hash(readFileSync(captureScript)), provenance.scriptSha256, 'Preserved baseline capture script');
const oldBundleFile = resolve(baseline, provenance.sourceBundle);
assert.equal(hash(readFileSync(oldBundleFile)), provenance.sourceBundleSha256, 'Preserved v45 model bundle');
mkdirSync(output, { recursive: true });

// Rebuild the historical bundle from its recorded Git tree, without checkout,
// modifying sources, or executing the old model/capture script. Normal file
// resolution is retained so esbuild emits the same source paths as the capture.
const oldInputs = new Map();
const historical = await build({
  stdin: { contents: "export { VoxelSimulation } from './src/voxel/world.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
  plugins: [{ name: 'historical-git-source', setup(api) {
    api.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, ({ path }) => {
      const local = relative(root, path).split(sep).join('/');
      assert.ok(local.startsWith('src/'), `Historical dependency outside src: ${local}`);
      const bytes = gitSource(local);
      oldInputs.set(local, hash(bytes));
      return { contents: bytes, loader: local.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) };
    });
  } }],
});
for (const input of Object.keys(historical.metafile.inputs))
  assert.ok(input === '<stdin>' || oldInputs.has(input.replaceAll('\\', '/')), `Historical input not read from Git: ${input}`);
assert.equal(hash(historical.outputFiles[0].contents), provenance.sourceBundleSha256, 'Historical Git tree reproduces retained v45 bundle byte for byte');

// Capture the exact current source bytes used for this model verification.
const currentInputs = new Map();
const current = await build({
  entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'current-source-identity', setup(api) {
    api.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, ({ path }) => {
      const bytes = readFileSync(path), local = relative(root, path).split(sep).join('/');
      currentInputs.set(local, hash(bytes));
      return { contents: bytes, loader: local.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) };
    });
  } }],
});
const bundleFile = resolve(output, 'world-v46.mjs');
writeFileSync(bundleFile, current.outputFiles[0].contents);
const { VoxelSimulation } = await import(pathToFileURL(bundleFile).href);

// Loading deliberately rebuilds scheduling reservations/routes. Keep every
// other saved field, including ground/cargo/frame containers and progress.
const pawnTransient = new Set(['jobId', 'path', 'destination', 'phase', 'reason', 'moveTick', 'workTarget']);
const jobTransient = new Set(['owner', 'reason']);
const without = (record, keys) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)));
function physical(saved) {
  const { version, autoRebuild, pawns, jobs, ...rest } = saved;
  return { ...rest, pawns: pawns.map(p => without(p, pawnTransient)), jobs: jobs.map(j => without(j, jobTransient)) };
}
function woodOwnership(saved) {
  const ground = saved.items.filter(i => i.resource === 'wood').reduce((n, i) => n + i.amount, 0);
  const carried = saved.pawns.reduce((n, p) => n + (p.cargo?.resource === 'wood' ? p.cargo.amount : 0), 0);
  const delivered = saved.jobs.reduce((n, j) => n + (j.delivered.wood ?? 0), 0);
  const loose = ground + carried + delivered;
  const accounting = loose + saved.stats.consumed.wood + saved.stats.destroyed.wood + saved.stats.spoiled.wood
    - saved.stats.produced.wood - (saved.trade.imported.wood ?? 0) + (saved.trade.exported.wood ?? 0);
  return { ground, carried, delivered, loose, consumed: saved.stats.consumed.wood, destroyed: saved.stats.destroyed.wood, accounting };
}
function checkpoint(name, saved) {
  const file = resolve(output, `${name}.json`), bytes = Buffer.from(JSON.stringify(saved));
  writeFileSync(file, bytes);
  return { file: relative(root, file).split(sep).join('/'), sha256: hash(bytes), byteLength: bytes.length,
    version: saved.version, tick: saved.tick, autoRebuild: saved.autoRebuild, physicalSha256: hash(JSON.stringify(physical(saved))),
    wood: woodOwnership(saved), chairs: saved.chairs,
    jobs: saved.jobs.map(j => ({ id: j.id, kind: j.kind, progress: j.progress, work: j.work, delivered: j.delivered, deliveredBatches: j.deliveredBatches })),
    cargo: saved.pawns.map(p => ({ id: p.id, cargo: p.cargo })) };
}
function roundTrip(saved, label) {
  const before = structuredClone(saved), loaded = VoxelSimulation.load(saved), after = loaded.save();
  assert.equal(after.version, 46, label);
  assert.equal(after.autoRebuild, false, label);
  assert.deepEqual(physical(after), physical(saved), `${label}: physical state and ownership`);
  assert.deepEqual(saved, before, `${label}: caller input unchanged`);
  return loaded;
}
const checks = [];
for (const sample of provenance.samples) {
  const file = resolve(baseline, sample.file), bytes = readFileSync(file);
  assert.equal(hash(bytes), sample.sha256, 'Historical save hash');
  assert.equal(bytes.length, sample.byteLength, 'Historical save byte length');
  const raw = JSON.parse(bytes), original = structuredClone(raw);
  assert.equal(raw.version, 45);
  assert.equal(raw.tick, sample.tick);
  assert.equal(Object.hasOwn(raw, 'autoRebuild'), false);
  assert.deepEqual(raw.chairs, sample.chairs);
  assert.deepEqual(raw.jobs, sample.jobs);
  assert.deepEqual(raw.stats, sample.stats);
  assert.deepEqual(raw.pawns.map(p => ({ id: p.id, jobId: p.jobId, cargo: p.cargo })), sample.pawns);
  let world = VoxelSimulation.load(raw);
  const migrated = world.save();
  assert.equal(migrated.version, 46);
  assert.equal(migrated.autoRebuild, false);
  assert.deepEqual(physical(migrated), physical(raw), 'Migration preserves original physical state and cargo');
  assert.deepEqual(world.counts(), sample.counts, 'Migration resource inventory');
  const stem = sample.file.replace(/\.json$/, '');
  const checkpoints = [checkpoint(`${stem}-migrated`, migrated)];
  world = roundTrip(migrated, 'Immediate v46 roundtrip');
  const initialWood = woodOwnership(migrated), commands = [];
  const initialChairs = structuredClone(migrated.chairs);
  const initialBuilt = migrated.stats.built;
  const initialConsumed = migrated.stats.consumed.wood;
  const command = c => { const result = world.command(c); commands.push({ tick: world.tick, command: c, result }); return result; };
  let target = migrated.jobs.find(j => j.kind === 'chair');
  if (!target) {
    // First prove that the archived forbidden flag and completed chair survive.
    const forbiddenWood = migrated.items.filter(i => i.resource === 'wood' && i.forbidden);
    assert.ok(forbiddenWood.length > 0, 'The second historical sample includes forbidden ground wood');
    for (const item of forbiddenWood) assert.equal(command({ type: 'itemForbidden', itemId: item.id, forbidden: false }).ok, true);
    for (let y = migrated.spawn.y - 3; y <= migrated.spawn.y + 3 && !target; y++) {
      for (let x = migrated.spawn.x - 3; x <= migrated.spawn.x + 3 && !target; x++) {
        const point = { x, y, z: migrated.spawn.z };
        if (command({ type: 'designate', tool: 'chair', from: point, axis: 'y' }).ok)
          target = world.jobs.find(j => j.kind === 'chair' && j.x === x && j.y === y && j.z === point.z);
      }
    }
    assert.ok(target, 'A normal new construction order is accepted');
  } else {
    assert.ok(migrated.pawns.some(p => p.cargo?.resource === 'wood' && p.cargo.amount === target.cost.wood), 'The first historical sample has construction input in pawn cargo');
  }
  const construction = { id: target.id, x: target.x, y: target.y, z: target.z, axis: target.axis, cost: structuredClone(target.cost) };
  const verifyAccounting = saved => {
    assert.equal(saved.autoRebuild, false);
    assert.equal(woodOwnership(saved).accounting, initialWood.accounting, 'Construction wood conservation');
    assert.equal(woodOwnership(saved).loose, world.counts().wood, 'Independent physical containers equal inventory wood');
  };
  world.step(20);
  const resumed = world.save();
  assert.equal(resumed.tick, migrated.tick + 20);
  verifyAccounting(resumed);
  checkpoints.push(checkpoint(`${stem}-continued20`, resumed));
  const preReloadCounts = world.counts();
  world = roundTrip(resumed, 'After 20 normal simulation ticks');
  assert.deepEqual(world.counts(), preReloadCounts, 'Reload resource counts');
  const finished = () => world.chairs.find(c => c.x === construction.x && c.y === construction.y && c.z === construction.z &&
    !initialChairs.some(old => old.id === c.id));
  let completionTicks = 20;
  let workingRoundTrip = null;
  while (!finished() && completionTicks < 1000) {
    world.step(); completionTicks++;
    const active = world.jobs.find(j => j.id === construction.id);
    if (!workingRoundTrip && active?.workTicks >= 20) {
      const working = world.save();
      verifyAccounting(working);
      assert.ok(active.progress > 0, 'Actual construction work has begun');
      assert.equal(active.delivered.wood, construction.cost.wood, 'Materials belong to the active construction frame');
      workingRoundTrip = { tick: working.tick, workTicks: active.workTicks, progress: active.progress, delivered: structuredClone(active.delivered) };
      checkpoints.push(checkpoint(`${stem}-working20`, working));
      const counts = world.counts();
      world = roundTrip(working, 'After at least 20 actual construction work ticks');
      assert.deepEqual(world.counts(), counts, 'Active frame reload resource inventory');
    }
  }
  assert.ok(workingRoundTrip, 'Both fixtures exercise save/load after actual construction work');
  assert.ok(finished(), 'Ordinary construction completes after legacy migration and reload');
  const completed = world.save();
  verifyAccounting(completed);
  assert.equal(completed.chairs.length, initialChairs.length + 1, 'One new chair, no duplication');
  for (const chair of initialChairs) assert.deepEqual(completed.chairs.find(c => c.id === chair.id), chair, 'Existing chair identity, orientation and quality');
  assert.equal(completed.stats.built, initialBuilt + 1);
  assert.equal(completed.stats.consumed.wood, initialConsumed + construction.cost.wood, 'Inputs consumed exactly once');
  assert.ok(!completed.jobs.some(j => j.id === construction.id), 'Completed job removed');
  assert.ok(completed.pawns.every(p => p.cargo?.resource !== 'wood'), 'Construction cargo is no longer retained on any pawn');
  assert.equal(finished().axis, construction.axis);
  checkpoints.push(checkpoint(`${stem}-completed`, completed));
  world = roundTrip(completed, 'Completed construction roundtrip');
  verifyAccounting(world.save());
  assert.deepEqual(raw, original, 'Historical caller data unchanged after the entire scenario');
  assert.equal(hash(readFileSync(file)), sample.sha256, 'Historical file remains unchanged');
  checks.push({ file: relative(root, file).split(sep).join('/'), sha256: sample.sha256, byteLength: sample.byteLength,
    sourceVersion: 45, targetVersion: 46, sourceTick: raw.tick, autoRebuildDefault: false, originalPhysicalPreserved: true,
    callerInputUnchanged: true, historicalFileUnchanged: true, resumedTicks: 20, completionTicks, workingRoundTrip, construction,
    commands, checkpoints });
}
for (const [file, digest] of currentInputs) assert.equal(hash(readFileSync(file)), digest, `Current source changed during verification; rerun: ${file}`);
assert.deepEqual(readFileSync(provenanceFile), provenanceBytes, 'Provenance receipt unchanged');
assert.deepEqual(readFileSync(resolve(baseline, 'provenance.json')), provenanceBytes, 'Historical provenance unchanged');
assert.equal(hash(readFileSync(oldBundleFile)), provenance.sourceBundleSha256, 'Historical bundle unchanged');
assert.equal(hash(readFileSync(captureScript)), provenance.scriptSha256, 'Historical capture script unchanged');
const report = { status: 'passed', checkedAt: new Date().toISOString(),
  script: 'scripts/voxel-auto-rebuild-legacy-verify.mjs', scriptSha256: hash(readFileSync(new URL(import.meta.url))),
  provenance: provenanceFile, provenanceSha256: hash(provenanceBytes), esbuildVersion,
  sourceProvenance: { head: provenance.head, worldSha256: provenance.worldSha256, captureScript, captureScriptSha256: provenance.scriptSha256,
    sourceBundle: relative(root, oldBundleFile).split(sep).join('/'), sourceBundleSha256: provenance.sourceBundleSha256,
    reproducedFromGitTree: true, sourceInputs: Object.fromEntries([...oldInputs].sort()) },
  currentModel: { file: relative(root, bundleFile).split(sep).join('/'), sha256: hash(readFileSync(bundleFile)),
    sourceInputs: Object.fromEntries([...currentInputs].sort()), unchangedThroughVerification: true },
  ignoredTransientFields: { pawn: [...pawnTransient], job: [...jobTransient] }, checks,
  scope: 'Two exact retained v45 headless public-command saves migrated to v46, with unchanged physical state/cargo, disabled auto-rebuild default, 20-tick continuation, save/load after at least 20 actual construction work ticks, ordinary chair completion and subsequent ownership checks. No save input was rewritten.',
  limits: ['No native game, browser, preview, GUI interaction or new screenshots.',
    'Historical fixtures were produced by the unmodified v45 headless model, not human gameplay or original RimWorld saves.',
    'Only these two v45 construction/forbidden-item fixtures are covered; other versions and all possible saves are not exhaustively validated.',
    'This verifies migration and ordinary construction, not fire damage, automatic rebuilding, rendering or input controls.',
    'Routes and scheduling ownership are intentionally rebuilt on load; the listed transient fields are excluded from physical equality.',
    'The explicit across-time conservation assertion covers wood used by these chair jobs; other preserved fields are checked at migration and roundtrip boundaries.'] };
writeFileSync('test-results/auto-rebuild-legacy.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, authenticV45Files: checks.length, historicalBundleReproduced: true,
  checks: checks.map(c => ({ file: c.file, resumedTicks: c.resumedTicks, completionTicks: c.completionTicks,
    sourceTick: c.sourceTick, finalTick: c.checkpoints.at(-1).tick, wood: c.checkpoints.at(-1).wood })) }));
