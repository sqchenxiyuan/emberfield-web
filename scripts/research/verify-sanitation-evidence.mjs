import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Evidence integrity only; this does not launch RimWorld or reproduce an experiment.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = resolve(root, 'docs/research/rimworld/evidence');
const local = process.argv.includes('--local');
const json = async (name) => JSON.parse(await readFile(resolve(base, name), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (value) => assert.match(value, /^[a-f0-9]{64}$/);
const insideRoot = (path) => {
  const full = resolve(root, path);
  assert.ok(full.startsWith(root + '/') || full.startsWith(root + '\\'), `Outside root: ${path}`);
  return full;
};
const checked = new Set();
async function verifyFile(path, expected) {
  hex(expected);
  const full = insideRoot(path);
  if (checked.has(full)) return;
  assert.equal(digest(await readFile(full)), expected, `Hash mismatch: ${path}`);
  checked.add(full);
}

const evidence = await json('hygiene-evidence.json');
const manifest = await json('hygiene-manifest.json');
const runtime = await json('hygiene-runtime-evidence.json');
assert.equal(evidence.source_sha256, manifest.source_sha256);
assert.equal(manifest.version_text, '1.7.4980 rev60');
assert.equal(manifest.types.length, 13);
assert.equal(evidence.claims.length, 10);
assert.equal(evidence.xml.length, 10);
const ids = new Set(evidence.xml.map((entry) => entry.id));
assert.equal(ids.size, evidence.xml.length);
let pointers = 0;
for (const claim of evidence.claims) {
  for (const id of claim.xml) assert.ok(ids.has(id), `Missing XML: ${id}`);
  assert.ok(claim.sources.length > 0);
  for (const source of claim.sources) {
    hex(source.sha256);
    assert.ok(source.lines[0] >= 1 && source.lines[1] >= source.lines[0]);
    pointers++;
    if (local) {
      await verifyFile(source.file, source.sha256);
      const lines = (await readFile(insideRoot(source.file), 'utf8')).split('\n');
      assert.ok(source.lines[1] <= lines.length, `Range overflow: ${source.file}`);
    }
  }
}
for (const entry of evidence.xml) {
  hex(entry.source_sha256);
  assert.ok(entry.xpath.startsWith('/Defs/'));
  assert.ok(entry.nodes.length > 0 && entry.nodes.every((node) => node.startsWith('<')));
}
if (local) for (const type of manifest.types) await verifyFile(type.local_file, type.sha256);

assert.equal(runtime.target.filth_id, 'Filth_Blood78450');
const [baseline, before, after, check] = runtime.saves;
assert.equal(before.ticks_game, 218400);
assert.equal(after.ticks_game, 219875);
assert.equal(check.ticks_game, after.ticks_game);
assert.equal(before.home_true_count, baseline.home_true_count + 2);
assert.equal(before.selected_filth.thickness, 2);
assert.equal(before.selected_filth.id, runtime.target.filth_id);
assert.equal(before.selected_filth.position, runtime.target.position);
assert.equal(before.pawn.job_def, 'Clean');
assert.equal(before.pawn.job_target, `Thing_${runtime.target.filth_id}`);
assert.equal(before.pawn.player_forced, 'True');
assert.equal(after.selected_filth, null);
assert.equal(check.selected_filth, null);
assert.equal(after.pawn.job_def, 'Wait_Wander');
assert.equal(runtime.timing.baseline_to_pre_clean_ticks, before.ticks_game - baseline.ticks_game);
assert.equal(runtime.timing.observed_cleaning_window_ticks, after.ticks_game - before.ticks_game);
assert.equal(runtime.timing.exact_cleaning_duration_measured, false);
assert.deepEqual(runtime.shutdown.rimworld_processes_after_exit, []);
assert.equal(runtime.images.length, 6);
for (const shot of runtime.images) {
  await verifyFile(`docs/research/rimworld/evidence/${shot.file}`, shot.sha256);
  const bytes = await readFile(resolve(base, shot.file));
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), shot.crop[2]);
  assert.equal(bytes.readUInt32BE(20), shot.crop[3]);
  assert.ok(shot.crop[0] + shot.crop[2] <= shot.source_dimensions[0]);
  assert.ok(shot.crop[1] + shot.crop[3] <= shot.source_dimensions[1]);
  if (local) await verifyFile(shot.source_file, shot.source_sha256);
}
for (const save of runtime.saves) {
  hex(save.sha256);
  if (local) await verifyFile(save.file, save.sha256);
}
assert.equal(runtime.actions.length, 40);
for (const action of runtime.actions) {
  hex(action.source_sha256);
  if (local) await verifyFile(action.source_file, action.source_sha256);
}
if (local) await verifyFile(runtime.launch.launch_record, runtime.launch.launch_record_sha256);

let links = 0;
for (const name of ['76-sanitation-food-poisoning-mechanisms.md', '77-native-sanitation-runtime.md']) {
  const file = resolve(base, '..', name);
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const path = match[1];
    if (/^(?:https?:|#)/.test(path)) continue;
    await access(resolve(dirname(file), path.split('#')[0]));
    links++;
  }
}
console.log(JSON.stringify({mode: local ? 'local-artifact-integrity' : 'portable-record-integrity', claims: evidence.claims.length, source_pointers: pointers, xml_selections: evidence.xml.length, native_saves: runtime.saves.length, crops: runtime.images.length, local_links: links, checked_file_hashes: checked.size, scope: 'Stored evidence integrity only; no runtime replay or statistical validation'}, null, 2));
