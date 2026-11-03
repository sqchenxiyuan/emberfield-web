import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Integrity of retained evidence, not gameplay replay or statistical calibration.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = resolve(root, 'docs/research/rimworld/evidence');
const local = process.argv.includes('--local');
const gameRoot = process.env.RIMWORLD_GAME_ROOT || 'F:/SteamLibrary/steamapps/common/RimWorld';
const json = async name => JSON.parse(await readFile(resolve(base, name), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => assert.match(value, /^[a-f0-9]{64}$/);
const unique = (values, label) => assert.equal(new Set(values).size, values.length, `Duplicate ${label}`);
const checked = new Map();
const insideRoot = path => {
  const full = resolve(root, path);
  const rel = relative(root, full);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), `Outside project: ${path}`);
  return full;
};
async function verifyAbsoluteFile(path, expected) {
  hex(expected);
  const full = resolve(path);
  if (!checked.has(full)) checked.set(full, digest(await readFile(full)));
  assert.equal(checked.get(full), expected, `Hash mismatch: ${path}`);
}
const verifyFile = (path, expected) => verifyAbsoluteFile(insideRoot(path), expected);
const manifest = await json('animal-husbandry-manifest.json');
const reproduction = await json('animal-husbandry-reproduction-manifest.json');
const evidence = await json('animal-husbandry-evidence.json');
const runtime = await json('animal-husbandry-runtime-evidence.json');
const types = await json('animal-husbandry-types.json');
for (const record of [manifest, reproduction, evidence]) {
  assert.equal(record.source_sha256, 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
  assert.equal(record.version_text, '1.7.4980 rev60');
}
for (const record of [manifest, reproduction]) {
  assert.equal(record.engine_version, '11.2.0.10050');
  assert.equal(record.engine_sha256, '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');
}
assert.equal(runtime.version, manifest.version_text);
assert.equal(manifest.types.length, 8);
assert.equal(reproduction.types.length, 19);
assert.equal(reproduction.xml.length, 8);
assert.equal(reproduction.mvid, '8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd');
assert.deepEqual(types, manifest.types.map(entry => entry.type));
unique(types, 'taming type');
unique(reproduction.types.map(entry => entry.type), 'reproduction type');
const allTypes = [...manifest.types, ...reproduction.types];
assert.equal(new Set(allTypes.map(entry => entry.type)).size, 26);
for (const entry of allTypes) {
  hex(entry.sha256);
  assert.ok(entry.lines > 0);
  insideRoot(entry.local_file);
  if (local) {
    await verifyFile(entry.local_file, entry.sha256);
    assert.equal((await readFile(insideRoot(entry.local_file), 'utf8')).split('\n').length, entry.lines);
  }
}
assert.equal(evidence.claims.length, 21);
assert.equal(evidence.xml.length, 13);
unique(evidence.claims.map(entry => entry.id), 'claim ID');
unique(evidence.xml.map(entry => entry.id), 'XML ID');
assert.deepEqual(evidence.claims.map(entry => entry.id), Array.from({length: 21}, (_, i) => `AH${String(i + 1).padStart(2, '0')}`));
const xmlIds = new Set(evidence.xml.map(entry => entry.id));
let pointers = 0;
for (const claim of evidence.claims) {
  assert.ok(claim.finding.length > 30 && claim.sources.length > 0);
  for (const id of claim.xml) assert.ok(xmlIds.has(id));
  for (const source of claim.sources) {
    hex(source.sha256);
    insideRoot(source.file);
    assert.equal(source.lines.length, 2);
    assert.ok(source.lines.every(Number.isInteger));
    assert.ok(source.lines[0] >= 1 && source.lines[1] >= source.lines[0]);
    pointers++;
    if (local) {
      await verifyFile(source.file, source.sha256);
      assert.ok(source.lines[1] <= (await readFile(insideRoot(source.file), 'utf8')).split('\n').length, `Line range: ${source.file}`);
    }
  }
}
for (const entry of evidence.xml) {
  hex(entry.source_sha256);
  assert.ok(entry.file.startsWith('Data/Core/Defs/'));
  assert.ok(entry.xpath.startsWith('/Defs/'));
  assert.ok(entry.nodes.length > 0 && entry.nodes.every(node => node.startsWith('<')));
  assert.match(entry.projection, /not the complete selected node/);
  if (local) await verifyAbsoluteFile(resolve(gameRoot, entry.file), entry.source_sha256);
}
const projection = id => evidence.xml.find(entry => entry.id === id).nodes.join('\n');
assert.match(projection('AX01'), /<baseValue>0\.04<\/baseValue>/);
assert.match(projection('AX01'), /<bonusPerLevel>0\.03<\/bonusPerLevel>/);
assert.match(projection('AX02'), /<Nutrition>0\.05<\/Nutrition>/);
for (const id of ['AX04', 'AX05']) {
  assert.match(projection(id), /<Wildness>0\.75<\/Wildness>/);
  assert.match(projection(id), /<gestationPeriodDays>5\.661<\/gestationPeriodDays>/);
}
assert.match(projection('AX05'), /<roamMtbDays>2<\/roamMtbDays>/);
assert.ok(!projection('AX04').includes('roamMtbDays'));
assert.match(projection('AX07'), /<foodMaxFactor>3<\/foodMaxFactor>/);
assert.match(evidence.xml.find(entry => entry.id === 'AX08').xpath, /ThinkNode_ConditionalHasFaction/);
assert.match(projection('AX08'), /JobGiver_Mate/);
assert.match(projection('AX09'), /<defName>Tameness<\/defName>/);
assert.match(projection('AX09'), /<steps>5<\/steps>/);
assert.match(projection('AX10'), /<lethalSeverity>1<\/lethalSeverity>/);
assert.match(projection('AX11'), /<initialSeverity>0\.001<\/initialSeverity>/);
assert.match(projection('AX11'), /<preventsPregnancy>true<\/preventsPregnancy>/);
assert.match(projection('AX12'), /<Nutrition>0\.50<\/Nutrition>/);
assert.match(projection('AX13'), /<foodType>Plant<\/foodType>/);
assert.equal(evidence.rea_members.status, 'unavailable');
assert.match(evidence.rea_members.reason, /67108864/);
hex(evidence.rea_members.sha256);
if (local) {
  await verifyFile(evidence.rea_members.source_file, evidence.rea_members.sha256);
  const rea = JSON.parse(await readFile(insideRoot(evidence.rea_members.source_file), 'utf8'));
  assert.equal(rea.evidence_id, evidence.rea_members.evidence_id);
  assert.equal(rea.normalized_result.summary.coverage.state, 'unavailable');
  for (const entry of reproduction.xml) await verifyFile(entry.local_file, entry.sha256);
  await verifyAbsoluteFile(resolve(gameRoot, 'Assembly-CSharp.dll'), manifest.source_sha256);
  await verifyAbsoluteFile(resolve(root, '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'), manifest.engine_sha256);
}

assert.equal(runtime.saves.length, 5);
assert.deepEqual(runtime.saves.map(save => save.ticks_game), [69526, 72541, 73375, 75812, 75812]);
assert.equal(runtime.preparation.developer_action, true);
assert.equal(runtime.preparation.guaranteed_success_inspiration, true);
assert.equal(runtime.preparation.direct_tame_action, false);
assert.equal(runtime.preparation.edited_saves, false);
assert.equal(runtime.preparation.no_statistical_calibration, true);
assert.deepEqual(runtime.launch.active_mods, ['ludeon.rimworld', 'ludeon.rimworld.odyssey']);
assert.equal(runtime.launch.baseline_source_sha256, runtime.launch.baseline_copy_sha256);
const [baseline, before, pickup, after, check] = runtime.saves;
assert.equal(baseline.sha256, runtime.launch.baseline_copy_sha256);
assert.equal(baseline.animal, null);
assert.equal(baseline.ground_rice, null);
assert.equal(runtime.targets.handler, 'Human958');
assert.equal(runtime.targets.animal, 'Hare113769');
assert.equal(runtime.targets.ground_rice, 'RawRice113770');
assert.equal(runtime.targets.carried_rice, 'RawRice113776');
assert.equal(runtime.targets.player_faction, 'Faction_12');
const riceCounts = [0, 0, 5, 3, 3];
for (const [i, save] of runtime.saves.entries()) {
  hex(save.sha256);
  assert.equal(save.handler.id, runtime.targets.handler);
  assert.equal(save.handler.faction, runtime.targets.player_faction);
  assert.equal(save.handler.animals_level, 12);
  assert.match(save.handler.animals_skill_xml, /<def>Animals<\/def><level>12<\/level>/);
  assert.match(save.handler.name_xml, /<nick>Prophet<\/nick>/);
  assert.equal(save.handler.inventory.reduce((sum, item) => sum + item.stack_count, 0), riceCounts[i]);
  for (const item of save.handler.inventory) {
    assert.equal(item.id, runtime.targets.carried_rice);
    assert.equal(item.def, 'RawRice');
    assert.equal(item.hit_points, 60);
    assert.ok(item.xml.includes(`<id>${item.id}</id>`));
    assert.ok(item.xml.includes(`<stackCount>${item.stack_count}</stackCount>`));
    assert.ok(save.handler.inventory_xml.includes(item.xml));
  }
  if (save.animal) {
    assert.equal(save.animal.id, runtime.targets.animal);
    assert.equal(save.animal.def, 'Hare');
    assert.equal(save.animal.spawned_tick, 72541);
    assert.ok(save.animal.xml.includes(`<id>${save.animal.id}</id>`));
    assert.ok(save.animal.xml.includes(save.animal.name_xml));
    assert.ok(save.animal.xml.includes(`<curLevel>${save.animal.food_level}</curLevel>`));
    assert.equal(save.ground_rice.id, runtime.targets.ground_rice);
    assert.equal(save.ground_rice.position, '(104, 0, 137)');
    assert.equal(save.ground_rice.hit_points, 60);
    assert.equal(save.ground_rice.stack_count, i === 1 ? 75 : 70);
    assert.ok(save.ground_rice.xml.includes(`<stackCount>${save.ground_rice.stack_count}</stackCount>`));
  }
  if (local) await verifyFile(save.file, save.sha256);
}
for (const save of [before, pickup]) {
  assert.equal(save.animal.faction, '');
  assert.equal(save.animal.name_xml, '<name IsNull="True" />');
  assert.equal(save.handler.inspiration_def, 'Inspired_Taming');
  assert.match(save.handler.inspiration_xml, /<reason>Debug gain<\/reason>/);
  assert.match(save.designation_xml, /<def>Tame<\/def><target>Thing_Hare113769<\/target>/);
}
assert.match(pickup.handler.job_xml, /<def>Tame<\/def>/);
assert.match(pickup.handler.job_xml, /<targetA>Thing_Hare113769<\/targetA>/);
assert.match(pickup.handler.job_xml, /<targetC>Thing_RawRice113770<\/targetC>/);
assert.match(pickup.handler.job_xml, /<count>5<\/count>/);
assert.match(pickup.handler.job_xml, /<playerForced>True<\/playerForced>/);
for (const save of [after, check]) {
  assert.equal(save.animal.faction, runtime.targets.player_faction);
  assert.equal(save.animal.name_xml, '<name Class="NameSingle"><name>Hare 1</name><numerical>True</numerical></name>');
  assert.equal(save.handler.inspiration_def, '');
  assert.equal(save.handler.inspiration_xml, '<inspirationHandler><curState IsNull="True" /></inspirationHandler>');
  assert.equal(save.designation_xml, '<designationManager><allDesignations /></designationManager>');
}
for (const field of ['handler', 'animal', 'ground_rice', 'designation_xml']) assert.deepEqual(after[field], check[field]);
assert.equal(runtime.timing.load_to_preparation_ticks, before.ticks_game - baseline.ticks_game);
assert.equal(runtime.timing.pickup_window_ticks, pickup.ticks_game - before.ticks_game);
assert.equal(runtime.timing.observed_taming_window_ticks, after.ticks_game - before.ticks_game);
assert.equal(runtime.timing.observed_taming_window_ticks, 3271);
assert.equal(runtime.timing.after_save_pair_equal_ticks, true);
assert.equal(runtime.timing.exact_success_tick_measured, false);
assert.deepEqual(runtime.shutdown.rimworld_processes_after_exit, []);

assert.equal(runtime.actions.length, 78);
unique(runtime.actions.map(action => action.image_name), 'action screenshot');
const pulses = runtime.actions.filter(entry => entry.action === 'pulse');
assert.deepEqual(pulses.map(entry => entry.duration_ms), [40, 1000, 1000, 2500, 4000]);
assert.deepEqual(pulses.map(entry => entry.virtual_key), [49, 51, 51, 51, 51]);
assert.deepEqual(runtime.timing.ordinary_speed3_pulses_ms, pulses.slice(1).map(entry => entry.duration_ms));
assert.ok(!runtime.actions.some(entry => entry.image_name === runtime.shutdown.attempted_capture));
for (const [index, action] of runtime.actions.entries()) {
  assert.ok(action.image_name.startsWith(`animal-husbandry-${String(index + 1).padStart(3, '0')}-`));
  hex(action.source_sha256);
  hex(action.image_sha256);
  assert.ok(Date.parse(action.started_utc) <= Date.parse(action.finished_utc));
  if (local) {
    await verifyFile(action.source_file, action.source_sha256);
    await verifyFile(`.local-research/runtime/${action.image_name}`, action.image_sha256);
    const log = (await readFile(insideRoot(action.source_file), 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(log.length, 1);
    assert.equal(basename(log[0].image), action.image_name);
    for (const field of ['action', 'duration_ms', 'virtual_key', 'x', 'y', 'text', 'control']) assert.equal(log[0][field], action[field]);
    // PowerShell can omit trailing zeroes in fractional ISO timestamps when serializing.
    const canonicalTime = value => value.replace(/(\.\d*?)0+Z$/, '$1Z').replace('.Z', 'Z');
    for (const field of ['started_utc', 'finished_utc']) assert.equal(canonicalTime(log[0][field]), canonicalTime(action[field]));
  }
}
assert.equal(runtime.images.length, 7);
unique(runtime.images.map(shot => shot.id), 'crop ID');
const imageIds = new Set(runtime.images.map(shot => shot.id));
assert.equal(runtime.observations.length, 3);
for (const observation of runtime.observations) for (const id of observation.evidence) assert.ok(id === 'saves' || imageIds.has(id));
for (const shot of runtime.images) {
  await verifyFile(`docs/research/rimworld/evidence/${shot.file}`, shot.sha256);
  const bytes = await readFile(resolve(base, shot.file));
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), shot.crop[2]);
  assert.equal(bytes.readUInt32BE(20), shot.crop[3]);
  assert.deepEqual(shot.source_dimensions, [2560, 1440]);
  assert.ok(shot.crop[0] >= 0 && shot.crop[1] >= 0);
  assert.ok(shot.crop[0] + shot.crop[2] <= 2560 && shot.crop[1] + shot.crop[3] <= 1440);
  const action = runtime.actions.find(entry => entry.image_name === basename(shot.source_file));
  assert.ok(action);
  assert.equal(shot.source_sha256, action.image_sha256);
  if (local) await verifyFile(shot.source_file, shot.source_sha256);
}
if (local) {
  await verifyFile(runtime.launch.launch_record, runtime.launch.launch_record_sha256);
  await verifyFile(`${runtime.launch.profile}/Config/ModsConfig.xml`, runtime.launch.mods_config_sha256);
}
let links = 0;
for (const name of ['88-animal-husbandry-mechanisms.md', '89-native-animal-husbandry-runtime.md']) {
  const file = resolve(base, '..', name);
  for (const match of (await readFile(file, 'utf8')).matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|#)/.test(match[1])) continue;
    await access(resolve(dirname(file), match[1].split('#')[0]));
    links++;
  }
}
console.log(JSON.stringify({mode: local ? 'local-artifact-integrity' : 'portable-record-integrity', type_records: allTypes.length, unique_types: new Set(allTypes.map(entry => entry.type)).size, claims: evidence.claims.length, source_pointers: pointers, xml_selections: evidence.xml.length, native_saves: runtime.saves.length, native_actions: runtime.actions.length, crops: runtime.images.length, local_links: links, checked_file_hashes: checked.size, scope: 'Stored evidence integrity only; no runtime replay or statistical calibration'}, null, 2));
