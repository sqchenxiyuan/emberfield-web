import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stored evidence integrity only. Does not launch RimWorld or replay the experiment.
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

const evidence = await json('weather-evidence.json');
const manifest = await json('weather-manifest.json');
const types = await json('weather-types.json');
const runtime = await json('weather-runtime-evidence.json');
assert.equal(evidence.source_sha256, manifest.source_sha256);
hex(manifest.source_sha256);
assert.equal(manifest.version_text, '1.7.4980 rev60');
assert.equal(runtime.version, manifest.version_text);
assert.equal(manifest.types.length, 15);
assert.deepEqual(types, manifest.types.map((entry) => entry.type));
unique(types, 'type');
assert.equal(evidence.claims.length, 11);
assert.equal(evidence.xml.length, 6);
unique(evidence.claims.map((entry) => entry.id), 'claim ID');
unique(evidence.xml.map((entry) => entry.id), 'XML ID');
const ids = new Set(evidence.xml.map((entry) => entry.id));
let pointers = 0;
for (const claim of evidence.claims) {
  for (const id of claim.xml) assert.ok(ids.has(id), `Missing XML: ${id}`);
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
}
if (local) for (const type of manifest.types) await verifyFile(type.local_file, type.sha256);

assert.equal(runtime.saves.length, 5);
const [baseline, before, prepared, after, check] = runtime.saves;
assert.equal(runtime.preparation.developer_action, true);
assert.equal(runtime.preparation.natural_weather_occurrence_measured, false);
assert.equal(runtime.target.pawn_id, 'Human961');
assert.equal(runtime.target.selected_weather, 'Rain');
assert.equal(runtime.target.thought, 'SoakingWet');
assert.equal(runtime.launch.baseline_source_sha256, runtime.launch.baseline_copy_sha256);
assert.equal(baseline.sha256, runtime.launch.baseline_copy_sha256);
assert.deepEqual(runtime.saves.map((save) => save.ticks_game), [203135, 204935, 204935, 209398, 209398]);
assert.deepEqual(runtime.saves.map((save) => save.weather.current), ['Clear', 'Clear', 'Rain', 'Rain', 'Rain']);
assert.deepEqual(runtime.saves.map((save) => save.weather.age), [35492, 37292, 0, 4463, 4463]);
for (const save of runtime.saves) {
  hex(save.sha256);
  assert.equal(save.weather.previous, 'Clear');
  assert.equal(save.weather.decider_duration, 155246);
  assert.equal(save.pawn.id, runtime.target.pawn_id);
  assert.equal(save.weather.xml, `<weatherManager><curWeatherAge>${save.weather.age}</curWeatherAge><curWeather>${save.weather.current}</curWeather><lastWeather>Clear</lastWeather></weatherManager>`);
  assert.equal(save.weather.decider_xml, '<weatherDecider><curWeatherDuration>155246</curWeatherDuration></weatherDecider>');
  if (local) await verifyFile(save.file, save.sha256);
}
for (const save of [baseline, before, prepared]) assert.deepEqual(save.pawn.wet_memories, []);
assert.deepEqual(before.pawn, prepared.pawn);
for (const save of [after, check]) {
  assert.equal(save.pawn.position, '(105, 0, 130)');
  assert.deepEqual(save.pawn.wet_memories, [{
    def: 'SoakingWet', age: 150,
    xml: '<li><def>SoakingWet</def><sourcePrecept>null</sourcePrecept><otherPawn>null</otherPawn><age>150</age></li>',
  }]);
}
assert.deepEqual(after.weather, check.weather);
assert.deepEqual(after.pawn, check.pawn);
assert.equal(runtime.timing.load_to_before_ticks, before.ticks_game - baseline.ticks_game);
assert.equal(runtime.timing.preparation_pair_equal_ticks, before.ticks_game === prepared.ticks_game);
assert.equal(runtime.timing.observed_weather_window_ticks, after.ticks_game - prepared.ticks_game);
assert.equal(runtime.timing.observed_weather_window_ticks, after.weather.age);
assert.ok(after.weather.age >= 4000);
assert.equal(runtime.timing.after_save_pair_equal_ticks, after.ticks_game === check.ticks_game);
assert.equal(runtime.timing.exact_onset_tick_measured, false);
assert.deepEqual(runtime.shutdown.rimworld_processes_after_exit, []);
assert.equal(runtime.images.length, 7);
unique(runtime.images.map((shot) => shot.id), 'crop ID');
const imageIds = new Set(runtime.images.map((shot) => shot.id));
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
  assert.ok(shot.crop[0] >= 0 && shot.crop[1] >= 0);
  assert.ok(shot.crop[0] + shot.crop[2] <= shot.source_dimensions[0]);
  assert.ok(shot.crop[1] + shot.crop[3] <= shot.source_dimensions[1]);
  if (local) await verifyFile(shot.source_file, shot.source_sha256);
}
assert.equal(runtime.actions.length, 29);
unique(runtime.actions.map((action) => action.image_name), 'action screenshot');
const pulses = runtime.actions.filter((entry) => entry.action === 'pulse');
assert.equal(pulses.length, 3);
for (const pulse of pulses) {
  assert.equal(pulse.duration_ms, 4000);
  assert.equal(pulse.virtual_key, 51);
}
const preparation = runtime.actions.find((entry) => entry.image_name === 'weather-013-rain-prepared.png');
assert.equal(preparation.action, 'click');
assert.deepEqual([preparation.x, preparation.y], runtime.preparation.weather_click);
assert.ok(!runtime.actions.some((entry) => entry.image_name === runtime.shutdown.attempted_capture));
for (const action of runtime.actions) {
  hex(action.source_sha256);
  assert.ok(Date.parse(action.started_utc) <= Date.parse(action.finished_utc));
  if (local) await verifyFile(action.source_file, action.source_sha256);
}
if (local) await verifyFile(runtime.launch.launch_record, runtime.launch.launch_record_sha256);

let links = 0;
for (const name of ['82-weather-mechanisms.md', '83-native-weather-runtime.md']) {
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
