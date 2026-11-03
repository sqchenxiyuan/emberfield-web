import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

// Run only before changing the v19 simulation. Existing evidence is never overwritten.
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const workspaceCommit = '6a0e1fbeb17328a0ea6a43ff271adbb6bf9457d8';
const publishedCommit = 'b80e54a';
const oldBundleSha = '00686294ed1d40179197f4fdc8e459141fb6ef4dcddbcf44aa5024ebf9893697';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workspaceCommit);
const bundle = await build({
  stdin: {
    contents:
      "export { VoxelSimulation } from './src/voxel/world.ts'; export { needsMedicalTending } from './src/voxel/medicine.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const bundleBytes = Buffer.from(bundle.outputFiles[0].text);
assert.equal(sha(bundleBytes), oldBundleSha, 'Current source must be the unchanged published v19 source');
assert.equal(sha(await readFile('test-results/voxel-medicine-final/executed-world.mjs')), oldBundleSha);
const { VoxelSimulation } = await import('data:text/javascript;base64,' + bundleBytes.toString('base64'));
const reportPath = 'test-results/voxel-medicine-final/report.json';
const reportBytes = await readFile(reportPath);
const report = JSON.parse(reportBytes);
assert.equal(report.status, 'passed');
assert.equal(report.formal, true);
const fields = [
  'blocks', 'ladders', 'items', 'research', 'tick', 'nextId', 'projectiles', 'combatEvents',
  'sandbags', 'combat', 'trees', 'treePlots', 'stockpiles', 'farms', 'crops', 'stoves',
  'stonecutters', 'tailors', 'researchBenches', 'beds', 'doors',
  'wires', 'thermal', 'stats',
];
const jobFields = [
  'id', 'kind', 'x', 'y', 'z', 'cost', 'delivered', 'deliveredFood', 'progress', 'work',
  'workTicks', 'weaponKind', 'weaponBenchKind', 'apparelKind', 'productQuality', 'cancelled',
];
const pawnFields = [
  'id', 'x', 'y', 'z', 'trauma', 'health', 'medical', 'skills', 'weapon', 'worn', 'cargo',
  'shooting', 'nextAttackTick', 'staggerUntil', 'dead', 'downed', 'deathReason', 'food', 'rest',
  'carriedBy', 'carryingPawnId', 'patientId', 'carePhase', 'careProgress', 'careMedicineId',
  'careFoodId', 'careAmount', 'careBedId',
];
const deviceFields = ['id', 'x', 'y', 'z', 'kind', 'axis', 'on', 'fuel', 'energy', 'target'];
const benchFields = ['id', 'x', 'y', 'z', 'kind', 'fuel', 'bill'];
function verify(save) {
  assert.equal(save.version, 19);
  const loaded = VoxelSimulation.load(save).save();
  for (const key of fields) assert.deepEqual(loaded[key], save[key], key);
  for (const [collection, physicalFields] of [['devices', deviceFields], ['weaponBenches', benchFields]]) {
    assert.equal(loaded[collection].length, save[collection].length);
    for (const object of save[collection]) {
      const next = loaded[collection].find((x) => x.id === object.id);
      assert(next);
      for (const key of physicalFields) assert.deepEqual(next[key], object[key], `${collection} ${object.id} ${key}`);
    }
  }
  assert.equal(loaded.jobs.length, save.jobs.length);
  for (const job of save.jobs) {
    const next = loaded.jobs.find((x) => x.id === job.id);
    assert(next);
    for (const key of jobFields) assert.deepEqual(next[key], job[key], `job ${job.id} ${key}`);
  }
  assert.equal(loaded.pawns.length, save.pawns.length);
  for (const pawn of save.pawns) {
    const next = loaded.pawns.find((x) => x.id === pawn.id);
    assert(next);
    for (const key of pawnFields) assert.deepEqual(next[key], pawn[key], `pawn ${pawn.id} ${key}`);
  }
  return loaded;
}
const selections = [
  ['carrying', 'herb-carried', 'Actual doctor carrying a physical herb to a naturally wounded colonist.'],
  ['tending', 'tending', 'Actual timed herbal treatment underway, with real downed colonist and raider.'],
  ['infected', 'medical-bed', 'Living infected patient resting in the real upper medical bed with active care and immunity.'],
  ['downed', 'infected-untreated', 'Untreated, naturally infected and downed colonist before the retained blood-loss death.'],
  ['death', 'untreated-infection-outcome', 'Actual death by blood loss, retained as a distinct recorded counterfactual branch.'],
];
const pending = [];
for (const [name, fixture, scope] of selections) {
  const record = report.fixtures[fixture];
  assert(record, fixture);
  const bytes = await readFile(record.file);
  assert.equal(sha(bytes), record.sha256);
  const data = JSON.parse(bytes);
  verify(data);
  pending.push({ name, bytes, data, provenance: {
    generator: 'Exact original bytes from the formal normal-command v19 medicine campaign; imported by unchanged v19 code before storyteller changes.',
    source: record.file,
    sourceSha256: record.sha256,
    sourceReport: reportPath,
    sourceReportSha256: sha(reportBytes),
    sourceBranch: record.branch,
    scope,
  }});
}
const workingPath = 'tests/fixtures/voxel-v18-medicine-working.json';
const workingBytes = await readFile(workingPath);
const oldWorking = JSON.parse(workingBytes);
const workingProvenancePath = 'tests/fixtures/voxel-v18-medicine-working.provenance.json';
const workingProvenanceBytes = await readFile(workingProvenancePath);
assert.equal(sha(workingBytes), JSON.parse(workingProvenanceBytes).sha256);
assert.equal(oldWorking.version, 18);
const working = VoxelSimulation.load(oldWorking).save();
verify(working);
for (const job of oldWorking.jobs) {
  const next = working.jobs.find((x) => x.id === job.id);
  for (const key of jobFields) assert.deepEqual(next[key], job[key], `migrated job ${job.id} ${key}`);
}
assert(working.jobs.some((j) => j.kind === 'smith' && j.progress > 0 && Object.keys(j.delivered).length));
pending.push({ name: 'working', data: working, bytes: Buffer.from(JSON.stringify(working) + '\n'), provenance: {
  generator: 'Unchanged published v19 code loads the authentic v18 normal-production fixture and saves v19 through the public save API; no simulation state is edited or stepped.',
  source: workingPath,
  sourceSha256: sha(workingBytes),
  sourceProvenance: workingProvenancePath,
  sourceProvenanceSha256: sha(workingProvenanceBytes),
  sourceVersion: 18,
  scope: 'Authentic powered revolver production in progress, now a genuine v19 save. This is an explicit v18-to-v19 migration, not a fresh v19 campaign.',
}});
const combatPath = 'tests/fixtures/voxel-v18-medicine-injured.json';
const combatBytes = await readFile(combatPath);
const combatProvenancePath = 'tests/fixtures/voxel-v18-medicine-injured.provenance.json';
const combatProvenanceBytes = await readFile(combatProvenancePath);
assert.equal(sha(combatBytes), JSON.parse(combatProvenanceBytes).sha256);
const combat = VoxelSimulation.load(JSON.parse(combatBytes)).save();
verify(combat);
assert(combat.combat.enabled && combat.combat.nextRaid > combat.tick);
assert(combat.pawns.some((p) => p.faction === 'raider' && !p.dead && !p.downed));
assert(combat.pawns.some((p) => p.shooting));
pending.push({ name: 'combat', data: combat, bytes: Buffer.from(JSON.stringify(combat) + '\n'), provenance: {
  generator: 'Unchanged published v19 code loads the authentic v18 normal-combat fixture and saves v19 through the public save API; no simulation state is edited or stepped.',
  source: combatPath,
  sourceSha256: sha(combatBytes),
  sourceProvenance: combatProvenancePath,
  sourceProvenanceSha256: sha(combatProvenanceBytes),
  sourceVersion: 18,
  scope: 'Actual active combat, ongoing aim timers, wounded living attacker and an existing enabled future raid schedule; explicit v18-to-v19 migration.',
}});
const preparedRecord = report.fixtures.prepared;
const preparedBytes = await readFile(preparedRecord.file);
assert.equal(sha(preparedBytes), preparedRecord.sha256);
const scheduledSim = VoxelSimulation.load(JSON.parse(preparedBytes));
const enableCommand = { type: 'threats', enabled: true };
const enableResult = scheduledSim.command(enableCommand);
assert(enableResult.ok);
const scheduled = scheduledSim.save();
verify(scheduled);
assert.equal(scheduled.combat.nextRaid, scheduled.tick + 36000);
pending.push({ name: 'scheduled', data: scheduled, bytes: Buffer.from(JSON.stringify(scheduled) + '\n'), provenance: {
  generator: 'Unchanged published v19 code loads the formal normal-play prepared colony, executes one ordinary threats command, and saves. No direct state edits and no simulation stepping.',
  source: preparedRecord.file,
  sourceSha256: preparedRecord.sha256,
  sourceReport: reportPath,
  sourceReportSha256: sha(reportBytes),
  sourceBranch: preparedRecord.branch,
  ordinaryCommands: [{ tick: scheduled.tick, command: enableCommand, result: enableResult }],
  scope: 'Real v19 first-raid schedule enabled from an established hospital/cold-store/food colony; the pending timestamp must survive v20 migration without being resampled.',
}});
async function immutable(path, bytes, metadata = false) {
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readFile(path);
    if (metadata) {
      const before = JSON.parse(existing), after = JSON.parse(bytes);
      delete before.capturedAt;
      delete after.capturedAt;
      assert.deepEqual(before, after, `existing provenance ${path}`);
    } else assert.deepEqual(existing, Buffer.from(bytes), `existing original bytes ${path}`);
  }
}
for (const { name, data, bytes, provenance } of pending) {
  const path = `tests/fixtures/voxel-v19-storyteller-${name}.json`;
  const metadata = {
    capturedAt: new Date().toISOString(), workspaceCommit, publishedCommit,
    ...provenance,
    originalSourceBundle: 'test-results/voxel-medicine-final/executed-world.mjs',
    originalSourceBundleSha256: oldBundleSha,
    currentSourceBundleMatched: true,
    version: data.version, tick: data.tick, sha256: sha(bytes),
    loadedByOriginalSource: true,
    originalSourceRoundtripPreserved: {
      saveFields: fields, jobFields, pawnFields, deviceFields, benchFields,
      intentionallyReconstructed: ['job owner/reason', 'ordinary travel path and scheduling fields', 'derived power activity, watts, network and reason'],
    },
  };
  await immutable(path, bytes);
  await immutable(path.replace(/\.json$/, '.provenance.json'), JSON.stringify(metadata, null, 2) + '\n', true);
  console.log(JSON.stringify({ path, version: data.version, tick: data.tick, sha256: metadata.sha256 }));
}
