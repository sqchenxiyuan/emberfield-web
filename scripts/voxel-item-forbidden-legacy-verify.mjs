// Headless migration of retained, unmodified v44 files; no browser or native game.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
const hash = data => createHash('sha256').update(data).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const provenance = 'docs/research/rimworld/evidence/allowed-area-voxel-validation.json';
const old = json(provenance);
assert.equal(old.version, 44);
mkdirSync('test-results', { recursive: true });
const bundle = 'test-results/item-forbidden-legacy-model.mjs';
await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', outfile: bundle });
const { VoxelSimulation } = await import(pathToFileURL(resolve(bundle)).href);
const files = [...old.campaign.checkpoints, ...old.browser.modes.flatMap(m => m.checks.filter(c => c.file))];
const checks = [];
const persistentFields = ['blocks', 'ladders', 'structureKinds', 'water', 'bridges', 'explored', 'items', 'stats', 'animalAreas', 'storageGroups', 'productionQueues'];
const physical = saved => ({ ...Object.fromEntries(persistentFields.map(key => [key, saved[key]])),
  pawns: saved.pawns.map(p => ({ id:p.id, x:p.x, y:p.y, z:p.z, cargo:p.cargo, weapon:p.weapon, worn:p.worn, allowedAreaId:p.allowedAreaId })),
  jobs: saved.jobs.map(j => ({ id:j.id, progress:j.progress, delivered:j.delivered, deliveredBatches:j.deliveredBatches, unfinishedId:j.unfinishedId })) });
for (const entry of files) {
  const bytes = readFileSync(entry.file);
  assert.equal(hash(bytes), entry.sha256, 'Historical save must be unchanged');
  const raw = JSON.parse(bytes), before = structuredClone(raw);
  assert.equal(raw.version, 44);
  const world = VoxelSimulation.load(raw), saved = world.save();
  assert.equal(saved.version, 45);
  for (const field of persistentFields)
    assert.deepEqual(saved[field], raw[field], entry.file + ': ' + field);
  assert.deepEqual(saved.pawns.map(p => p.allowedAreaId), raw.pawns.map(p => p.allowedAreaId));
  assert.deepEqual(VoxelSimulation.load(saved).save(), saved);
  world.step(20);
  const resumed = world.save();
  assert.equal(resumed.tick, raw.tick + 20);
  // Ordinary assignments/path reservations are deliberately rescheduled on load.
  // Compare physical ownership and progress, not transient owner/path fields.
  const continued = VoxelSimulation.load(resumed);
  assert.deepEqual(physical(continued.save()), physical(resumed));
  assert.deepEqual(continued.counts(), world.counts());
  assert.deepEqual(raw, before, 'Caller data is not mutated');
  assert.equal(hash(readFileSync(entry.file)), entry.sha256);
  checks.push({ file: entry.file, sha256: entry.sha256, sourceVersion: raw.version, targetVersion: saved.version, tick: raw.tick, resumedTicks: 20 });
}
const report = { status: 'passed', checkedAt: new Date().toISOString(),
  scriptSha256: hash(readFileSync('scripts/voxel-item-forbidden-legacy-verify.mjs')),
  sourceBundleSha256: hash(readFileSync(bundle)), provenance, provenanceSha256: hash(readFileSync(provenance)), checks,
  scope: 'Read retained v44 saves, load and continue only the headless model. No new GUI interaction; browser provenance belongs to v44.' };
writeFileSync('test-results/item-forbidden-legacy.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, authenticV44Files: checks.length }));
