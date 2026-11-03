import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stored evidence integrity only: no native launch, gameplay replay or rate calibration.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = resolve(root, 'docs/research/rimworld/evidence');
const local = process.argv.includes('--local');
const json = async (name) => JSON.parse(await readFile(resolve(base, name), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (value) => assert.match(value, /^[a-f0-9]{64}$/);
const insideRoot = (path) => {
  const full = resolve(root, path);
  const rel = relative(root, full);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), `Outside root: ${path}`);
  return full;
};
const checked = new Map();
async function verifyFile(path, expected) {
  hex(expected);
  const full = insideRoot(path);
  if (!checked.has(full)) checked.set(full, digest(await readFile(full)));
  assert.equal(checked.get(full), expected, `Hash mismatch: ${path}`);
}
const unique = (values, label) => assert.equal(new Set(values).size, values.length, `Duplicate ${label}`);

const evidence = await json('environment-storage-evidence.json');
const manifest = await json('environment-storage-manifest.json');
const types = await json('environment-storage-types.json');
const runtime = await json('environment-storage-runtime-evidence.json');
assert.equal(evidence.source_sha256, manifest.source_sha256);
assert.equal(manifest.source_sha256, 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
assert.equal(manifest.version_text, '1.7.4980 rev60');
assert.equal(runtime.version, manifest.version_text);
assert.equal(manifest.engine_version, '11.2.0.10050');
hex(manifest.engine_sha256);
assert.equal(manifest.types.length, 19);
assert.deepEqual(types, manifest.types.map((entry) => entry.type));
unique(types, 'type');
assert.equal(evidence.claims.length, 11);
assert.equal(evidence.xml.length, 20);
unique(evidence.claims.map((entry) => entry.id), 'claim ID');
unique(evidence.xml.map((entry) => entry.id), 'XML ID');
const xmlIds = new Set(evidence.xml.map((entry) => entry.id));
let pointers = 0;
for (const claim of evidence.claims) {
  for (const id of claim.xml) assert.ok(xmlIds.has(id), `Missing XML: ${id}`);
  assert.ok(claim.sources.length > 0);
  for (const source of claim.sources) {
    hex(source.sha256);
    insideRoot(source.file);
    assert.equal(source.lines.length, 2);
    assert.ok(source.lines.every(Number.isInteger));
    assert.ok(source.lines[0] >= 1 && source.lines[1] >= source.lines[0]);
    pointers++;
    if (local) {
      await verifyFile(source.file, source.sha256);
      assert.ok(source.lines[1] <= (await readFile(insideRoot(source.file), 'utf8')).split('\n').length);
    }
  }
}
for (const entry of evidence.xml) {
  hex(entry.source_sha256);
  assert.ok(entry.xpath.startsWith('/Defs/'));
  assert.ok(entry.nodes.length > 0 && entry.nodes.every((node) => node.startsWith('<')));
  assert.match(entry.projection, /not the complete selected node/);
}
assert.ok(evidence.claims.find((claim) => claim.id === 'ES03').xml.includes('XML18'));
for (const id of ['XML19', 'XML20']) assert.ok(evidence.claims.find((claim) => claim.id === 'ES02').xml.includes(id));
assert.ok(evidence.xml.find((entry) => entry.id === 'XML05').nodes.some((node) => node.includes('Name="MealCooked"')));
if (local) for (const type of manifest.types) await verifyFile(type.local_file, type.sha256);

assert.equal(runtime.saves.length, 4);
assert.equal(runtime.targets.length, 3);
assert.equal(runtime.preparation.developer_action, true);
assert.equal(runtime.preparation.reused_existing_rain, true);
assert.equal(runtime.preparation.no_statistical_calibration, true);
assert.ok(runtime.preparation.extra_spawn.includes('additional outdoor stack'));
assert.deepEqual(runtime.launch.active_mods, ['ludeon.rimworld', 'ludeon.rimworld.odyssey']);
const [baseline, before, after, check] = runtime.saves;
assert.equal(runtime.launch.baseline_source_sha256, runtime.launch.baseline_copy_sha256);
assert.equal(baseline.sha256, runtime.launch.baseline_copy_sha256);
assert.deepEqual(runtime.saves.map((save) => save.ticks_game), [209398, 213091, 219037, 219037]);
assert.deepEqual(runtime.saves.map((save) => save.weather.age), [4463, 8156, 14102, 14102]);
unique(runtime.targets.map((target) => target.id), 'target ID');
assert.deepEqual(runtime.targets.map((target) => target.id), ['Cloth222220', 'Cloth222221', 'Cloth222222']);
assert.deepEqual(runtime.targets.map((target) => target.position), ['(104, 0, 140)', '(97, 0, 140)', '(98, 0, 140)']);
assert.deepEqual(runtime.targets.map((target) => target.observed_after_hp), [80, 78, 78]);
assert.equal(baseline.cloth.filter((item) => item.target).length, 0);
for (const save of runtime.saves) {
  hex(save.sha256);
  assert.equal(save.weather.current, 'Rain');
  assert.equal(save.weather.previous, 'Clear');
  assert.equal(save.weather.xml, `<weatherManager><curWeatherAge>${save.weather.age}</curWeatherAge><curWeather>Rain</curWeather><lastWeather>Clear</lastWeather></weatherManager>`);
  unique(save.cloth.map((item) => item.id), 'saved cloth ID');
  for (const item of save.cloth) {
    assert.ok(item.xml.includes(`<id>${item.id}</id>`));
    assert.ok(item.xml.includes(`<pos>${item.position}</pos>`));
    assert.ok(item.xml.includes(`<health>${item.hit_points}</health>`));
    assert.ok(item.xml.includes(`<stackCount>${item.stack_count}</stackCount>`));
    assert.equal(item.target, runtime.targets.some((target) => target.id === item.id));
  }
  if (local) await verifyFile(save.file, save.sha256);
}
for (const save of [before, after, check]) {
  assert.equal(save.cloth.filter((item) => item.target).length, 3);
  for (const target of runtime.targets) {
    const item = save.cloth.find((candidate) => candidate.id === target.id);
    assert.equal(item.position, target.position);
    assert.equal(item.stack_count, 75);
    assert.equal(item.spawned_tick, 213091);
    assert.equal(item.forbidden, true);
    assert.ok(item.xml.includes('<forbidden>True</forbidden>'));
    assert.equal(target.expected_before_hp, 80);
    assert.equal(item.hit_points, save === before ? target.expected_before_hp : target.observed_after_hp);
  }
}
assert.deepEqual(after.weather, check.weather);
assert.deepEqual(after.cloth, check.cloth);
assert.equal(runtime.timing.load_to_before_ticks, before.ticks_game - baseline.ticks_game);
assert.equal(runtime.timing.load_to_before_ticks, 3693);
assert.equal(runtime.timing.observed_deterioration_window_ticks, after.ticks_game - before.ticks_game);
assert.equal(runtime.timing.observed_deterioration_window_ticks, 5946);
assert.equal(runtime.timing.after_save_pair_equal_ticks, true);
assert.equal(runtime.timing.exact_damage_ticks_measured, false);
assert.deepEqual(runtime.shutdown.rimworld_processes_after_exit, []);

assert.equal(runtime.images.length, 7);
unique(runtime.images.map((shot) => shot.id), 'crop ID');
const imageIds = new Set(runtime.images.map((shot) => shot.id));
assert.equal(runtime.observations.length, 3);
unique(runtime.observations.map((observation) => observation.id), 'observation ID');
for (const observation of runtime.observations) {
  for (const id of observation.evidence) assert.ok(id === 'saves' || imageIds.has(id), `Missing runtime evidence: ${id}`);
}
for (const shot of runtime.images) {
  await verifyFile(`docs/research/rimworld/evidence/${shot.file}`, shot.sha256);
  const bytes = await readFile(resolve(base, shot.file));
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), shot.crop[2]);
  assert.equal(bytes.readUInt32BE(20), shot.crop[3]);
  assert.deepEqual(shot.source_dimensions, [2560, 1440]);
  assert.ok(shot.crop[0] >= 0 && shot.crop[1] >= 0);
  assert.ok(shot.crop[0] + shot.crop[2] <= shot.source_dimensions[0]);
  assert.ok(shot.crop[1] + shot.crop[3] <= shot.source_dimensions[1]);
  if (local) await verifyFile(shot.source_file, shot.source_sha256);
}
assert.equal(runtime.actions.length, 43);
unique(runtime.actions.map((action) => action.image_name), 'action screenshot');
const pulses = runtime.actions.filter((entry) => entry.action === 'pulse');
assert.equal(pulses.length, 4);
for (const pulse of pulses) {
  assert.equal(pulse.duration_ms, 4000);
  assert.equal(pulse.virtual_key, 51);
}
assert.ok(!runtime.actions.some((entry) => entry.image_name === runtime.shutdown.attempted_capture));
for (const [index, action] of runtime.actions.entries()) {
  assert.ok(action.image_name.startsWith(`environment-storage-${String(index + 1).padStart(3, '0')}-`));
  hex(action.source_sha256);
  assert.ok(Date.parse(action.started_utc) <= Date.parse(action.finished_utc));
  if (local) await verifyFile(action.source_file, action.source_sha256);
}
if (local) {
  await verifyFile(runtime.launch.launch_record, runtime.launch.launch_record_sha256);
  await verifyFile(`${runtime.launch.profile}/Config/ModsConfig.xml`, runtime.launch.mods_config_sha256);
}

let links = 0;
for (const name of ['85-environment-storage-mechanisms.md', '86-native-environment-storage-runtime.md']) {
  const file = resolve(base, '..', name);
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const path = match[1];
    if (/^(?:https?:|#)/.test(path)) continue;
    await access(resolve(dirname(file), path.split('#')[0]));
    links++;
  }
}
console.log(JSON.stringify({mode: local ? 'local-artifact-integrity' : 'portable-record-integrity', claims: evidence.claims.length, source_pointers: pointers, xml_selections: evidence.xml.length, native_saves: runtime.saves.length, native_actions: runtime.actions.length, crops: runtime.images.length, local_links: links, checked_file_hashes: checked.size, scope: 'Stored evidence integrity only; no runtime replay or statistical validation'}, null, 2));
