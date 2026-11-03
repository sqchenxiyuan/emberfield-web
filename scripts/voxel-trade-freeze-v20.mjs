import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Freeze only while the published v20 simulation is unchanged. Never manufacture old saves.
const OUT = 'test-results/voxel-trade-v20-freeze';
const workspaceCommit = '677e8fdcb4d23e25d52153c28950bd1d76e56fb6';
const publishedCommit = '545df1c6d8891f84e5d36d164451448cea24245a';
const expectedBundleSha256 = 'af30837052684b98e39f2f342386a03683ce71fd3e32acee341060467b17363a';
const reportPath = 'test-results/voxel-storyteller-final3/report.json';
const expectedReportSha256 = 'b2499db12ec1ad8c23a67690e28830e536ed2127da78ba2164f33b5b4c6aa7de';
const bundlePath = `${OUT}/executed-world.mjs`;
const manifestPath = `${OUT}/manifest.json`;
const verifyOnly = process.argv.includes('--verify-frozen');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

const selections = [
  ['initial', 'initial', 'Fresh seed 73129 at tick zero, before any ordinary colony commands.'],
  ['working', 'working', 'Actual powered machine-pistol production: paid steel/components and partial work; a colonist also carries aged rice.'],
  ['carrying', 'failure', 'Unchanged terminal checkpoint of the retained formal prefix failure: real carried rice and aged grain already delivered to a nearly complete cooking job. This is a provenance-labelled failure checkpoint, not an accepted campaign outcome.'],
  ['combat', 'multi-raid', 'Two actual raiders and their unique equipment have entered through the ordinary Cassandra calendar.'],
  ['injured', 'injured-pawn-364', 'Living colonist 364 has the naturally observed right-arm bruise and radius crack during real combat.'],
  ['recovered', 'recovered', 'The same living colonist 364 has recovered after real herbal treatment; all three colonists survive.'],
  ['scheduled', 'event-ready', 'Ordinary mainline save 120 ticks before the already scheduled opportunity; calendar, RNG-derived opportunity and prior events must survive migration.'],
];

// Loading deliberately reconstructs assignment, pathfinding and derived power status.
// Every other field is compared, including complete cargo, food ages, equipment,
// partial production, storyteller state, nextId, health and medical history.
const reconstructedFields = {
  pawns: ['path', 'jobId', 'destination', 'phase', 'reason', 'moveTick', 'workTarget'],
  jobs: ['owner', 'reason'],
  devices: ['active', 'watts', 'network', 'reason'],
  'weaponBenches.power': ['active', 'watts', 'network', 'reason'],
};
function physicalProjection(save) {
  const projected = structuredClone(save);
  for (const [collection, fields] of Object.entries(reconstructedFields)) {
    const [array, nested] = collection.split('.');
    for (const entry of projected[array]) {
      const object = nested ? entry[nested] : entry;
      if (object) for (const field of fields) delete object[field];
    }
  }
  return projected;
}
function equipmentOwners(save) {
  const owners = new Map();
  const retain = (piece, owner) => {
    if (!piece) return;
    assert(!owners.has(piece.id), `equipment ${piece.id} has duplicate physical ownership`);
    owners.set(piece.id, { owner, piece });
  };
  for (const item of save.items) {
    retain(item.weapon, `ground:${item.id}`);
    retain(item.apparel, `ground:${item.id}`);
  }
  for (const pawn of save.pawns) {
    retain(pawn.weapon, `pawn:${pawn.id}`);
    for (const piece of pawn.worn) retain(piece, `worn:${pawn.id}`);
    retain(pawn.cargo?.weapon, `cargo:${pawn.id}`);
    retain(pawn.cargo?.apparel, `cargo:${pawn.id}`);
  }
  return [...owners].sort(([a], [b]) => a - b);
}
function observe(save) {
  return {
    tick: save.tick,
    carrying: save.pawns.filter((p) => p.cargo).map((p) => ({ pawnId: p.id, cargo: p.cargo })),
    unfinishedProduction: save.jobs.filter((j) => j.progress > 0 || Object.keys(j.delivered).length)
      .map((j) => ({ id: j.id, kind: j.kind, progress: j.progress, delivered: j.delivered, deliveredFood: j.deliveredFood ?? [] })),
    liveRaiders: save.pawns.filter((p) => p.faction === 'raider' && !p.dead && !p.downed).map((p) => p.id),
    colonists: save.pawns.filter((p) => p.faction === 'colony').map((p) => ({
      id: p.id, dead: p.dead, downed: p.downed, wounds: p.trauma.wounds, infections: p.medical.infections,
    })),
    equipmentOwners: equipmentOwners(save).map(([id, value]) => ({ id, ...value })),
    raidsEnabled: save.combat.enabled,
    storytellerEventCount: save.storyteller.events.length,
    storytellerLastInterval: save.storyteller.lastInterval,
  };
}
function assertScenario(name, save) {
  if (name === 'initial') assert.equal(save.tick, 0);
  if (name === 'working') assert(save.jobs.some((j) => j.kind === 'smith' && j.progress > 0 && j.delivered.steel > 0 && j.delivered.components > 0));
  if (name === 'carrying') {
    assert(save.pawns.some((p) => p.cargo?.resource === 'grain' && p.cargo.rotProgress > 0));
    assert(save.jobs.some((j) => j.kind === 'cook' && j.progress > 0 && j.deliveredFood.some((f) => f.rotProgress > 0)));
  }
  if (name === 'combat') assert.equal(save.pawns.filter((p) => p.faction === 'raider' && !p.dead && !p.downed).length, 2);
  if (name === 'injured') {
    const patient = save.pawns.find((p) => p.id === 364);
    assert(patient && !patient.dead && patient.trauma.wounds.length === 2);
  }
  if (name === 'recovered') {
    const patient = save.pawns.find((p) => p.id === 364);
    assert(patient && !patient.dead && patient.trauma.wounds.length === 0 && patient.medical.infections.length === 0);
    assert(patient.medical.lastTend, 'retain actual treatment history');
  }
  if (name === 'scheduled') assert(save.combat.enabled && save.tick === 1034680);
}
async function immutable(path, bytes, metadata = false) {
  try { await writeFile(path, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readFile(path);
    if (!metadata) assert.deepEqual(existing, Buffer.from(bytes), `existing immutable bytes: ${path}`);
    else {
      const before = JSON.parse(existing), after = JSON.parse(bytes);
      delete before.capturedAt; delete after.capturedAt;
      assert.deepEqual(before, after, `existing immutable metadata: ${path}`);
    }
  }
}

let bundleBytes, sourceFiles;
if (verifyOnly) {
  bundleBytes = await readFile(bundlePath);
  assert.equal(sha(bundleBytes), expectedBundleSha256);
  sourceFiles = JSON.parse(await readFile(manifestPath)).sourceFiles;
} else {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workspaceCommit);
  const built = await build({
    stdin: {
      contents: "export { VoxelSimulation } from './src/voxel/world.ts'; export { colonyWealthDetails } from './src/voxel/wealth.ts';",
      resolveDir: process.cwd(),
    }, bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
  });
  bundleBytes = Buffer.from(built.outputFiles[0].text);
  assert.equal(sha(bundleBytes), expectedBundleSha256, 'freeze before any v21 simulation changes');
  sourceFiles = await Promise.all(Object.keys(built.metafile.inputs).filter((path) => path !== '<stdin>').sort()
    .map(async (path) => ({ path, sha256: sha(await readFile(path)) })));
}
const reportBytes = await readFile(reportPath);
assert.equal(sha(reportBytes), expectedReportSha256);
const report = JSON.parse(reportBytes);
assert.equal(report.status, 'passed');
assert.equal(report.formal, true);
assert.equal(report.execution.sha256, expectedBundleSha256);
assert.equal(sha(await readFile(report.execution.bundle)), expectedBundleSha256);
const { VoxelSimulation, colonyWealthDetails } = await import('data:text/javascript;base64,' + bundleBytes.toString('base64'));
const pending = [];
for (const [name, sourceKey, scope] of selections) {
  const origin = report.fixtures[sourceKey];
  assert(origin, sourceKey);
  const bytes = await readFile(origin.file);
  assert.equal(sha(bytes), origin.sha256);
  const save = JSON.parse(bytes);
  assert.equal(save.version, 20);
  assert.equal(save.tick, origin.tick);
  const loaded = VoxelSimulation.load(structuredClone(save));
  const roundtrip = loaded.save();
  assert.equal(roundtrip.version, 20);
  assert.deepEqual(physicalProjection(roundtrip), physicalProjection(save), `${name}: complete physical state survives load/save`);
  assert.deepEqual(equipmentOwners(roundtrip), equipmentOwners(save));
  assertScenario(name, save);
  const second = VoxelSimulation.load(structuredClone(roundtrip)).save();
  assert.deepEqual(physicalProjection(second), physicalProjection(roundtrip), `${name}: second roundtrip`);
  const roundtripBytes = Buffer.from(JSON.stringify(roundtrip) + '\n');
  const path = `tests/fixtures/voxel-v20-trade-${name}.json`;
  const roundtripPath = `${OUT}/${name}-roundtrip.json`;
  const metadata = {
    capturedAt: new Date().toISOString(), workspaceCommit, publishedCommit,
    generator: 'Exact original bytes from the formal v20 storyteller campaign. Validated by normal load/save twice using the unchanged published v20 bundle; no commands, steps or direct state/version edits.',
    scope, source: origin.file, sourceSha256: origin.sha256, sourceBranch: origin.branch,
    sourceReport: reportPath, sourceReportSha256: expectedReportSha256,
    sourceFixtureKey: sourceKey, sourceExecution: report.execution,
    sourceExecutionSegments: report.executionSegments,
    originalSourceBundle: report.execution.bundle, originalSourceBundleSha256: expectedBundleSha256,
    frozenSourceBundle: bundlePath, frozenSourceBundleSha256: expectedBundleSha256,
    currentSourceBundleMatched: true, version: save.version, tick: save.tick,
    sha256: sha(bytes), loadedByOriginalSource: true,
    normalLoadSave: { file: roundtripPath, sha256: sha(roundtripBytes), repeatedPhysicalRoundtripPassed: true },
    originalSourceRoundtripPreserved: { strategy: 'Compare every save field after removing only the listed reconstructed fields.', reconstructedFields },
    observations: observe(save), countsAfterNormalLoad: loaded.counts(), wealthAfterNormalLoad: colonyWealthDetails(loaded),
    nextOpportunityAfterNormalLoad: loaded.snapshot().storyteller.nextOpportunity,
  };
  if (name === 'scheduled') assert.equal(metadata.nextOpportunityAfterNormalLoad, 1034800);
  if (verifyOnly) {
    assert.deepEqual(await readFile(path), bytes);
    assert.deepEqual(await readFile(roundtripPath), roundtripBytes);
    const existing = JSON.parse(await readFile(path.replace(/\.json$/, '.provenance.json')));
    delete existing.capturedAt;
    const comparable = structuredClone(metadata); delete comparable.capturedAt;
    assert.deepEqual(existing, comparable);
  }
  pending.push({ path, bytes, metadata, roundtripPath, roundtripBytes });
}
const manifest = {
  capturedAt: new Date().toISOString(), workspaceCommit, publishedCommit,
  bundle: { file: bundlePath, sha256: expectedBundleSha256 }, sourceFiles,
  sourceReport: { file: reportPath, sha256: expectedReportSha256 },
  executedScript: { file: `${OUT}/executed-freeze.mjs`, sha256: sha(await readFile(new URL(import.meta.url))) },
  fixtures: pending.map(({ path, metadata }) => ({ file: path, sha256: metadata.sha256, version: metadata.version, tick: metadata.tick, source: metadata.source, sourceSha256: metadata.sourceSha256 })),
  limitations: ['No new ordinary campaign is claimed.', 'Carrying uses the retained failed prefix terminal checkpoint, explicitly labelled.', 'These fixtures contain no v21 silver or trade state.', 'Only load/save is executed; no simulation stepping or gameplay mutations.'],
};
if (!verifyOnly) {
  await mkdir(OUT, { recursive: true });
  await immutable(bundlePath, bundleBytes);
  await immutable(`${OUT}/executed-freeze.mjs`, await readFile(new URL(import.meta.url)));
  for (const { path, bytes, metadata, roundtripPath, roundtripBytes } of pending) {
    await immutable(path, bytes);
    await immutable(roundtripPath, roundtripBytes);
    await immutable(path.replace(/\.json$/, '.provenance.json'), json(metadata), true);
  }
  await immutable(manifestPath, json(manifest), true);
} else {
  const before = JSON.parse(await readFile(manifestPath));
  delete before.capturedAt; delete manifest.capturedAt;
  assert.deepEqual(before, manifest);
  assert.equal(sha(await readFile(manifest.executedScript.file)), manifest.executedScript.sha256);
}
console.log(JSON.stringify({ status: 'passed', mode: verifyOnly ? 'verify-frozen' : 'freeze', bundleSha256: expectedBundleSha256, fixtures: manifest.fixtures }, null, 2));
