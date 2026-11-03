import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Evidence integrity only: never starts the game, replays input or calibrates balance.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = resolve(root, 'docs/research/rimworld/evidence');
const local = process.argv.includes('--local');
const game = process.env.RIMWORLD_GAME_ROOT || 'F:/SteamLibrary/steamapps/common/RimWorld';
const json = async name => JSON.parse(await readFile(resolve(base, name), 'utf8'));
const hex = value => assert.match(value, /^[a-f0-9]{64}$/);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const unique = values => assert.equal(new Set(values).size, values.length);
const safe = path => {
  const full = resolve(root, path), rel = relative(root, full);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), `Outside project: ${path}`);
  return full;
};
const hashes = new Map();
async function hashFile(path, expected) {
  hex(expected); const full = resolve(path);
  if (!hashes.has(full)) hashes.set(full, digest(await readFile(full)));
  assert.equal(hashes.get(full), expected, `Hash mismatch: ${path}`);
}
const m = await json('animal-pens-manifest.json');
const e = await json('animal-pens-evidence.json');
const r = await json('animal-pens-runtime-evidence.json');
const types = await json('animal-pens-types.json');
for (const item of [m, e]) {
  assert.equal(item.version_text, '1.7.4980 rev60');
  assert.equal(item.source_sha256, 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
}
assert.equal(m.engine_version, '11.2.0.10050');
assert.equal(m.engine_sha256, '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');
assert.equal(r.version, m.version_text);
assert.equal(types.length, 27); unique(types);
assert.deepEqual(types, m.types.map(t => t.type));
for (const t of m.types) {
  hex(t.sha256); safe(t.local_file); assert.ok(t.lines > 0);
  if (local) {
    await hashFile(safe(t.local_file), t.sha256);
    assert.equal((await readFile(safe(t.local_file), 'utf8')).split('\n').length, t.lines);
  }
}
assert.equal(e.claims.length, 20); assert.equal(e.xml.length, 8);
assert.deepEqual(e.claims.map(c => c.id), Array.from({length: 20}, (_, i) => `AP${String(i + 1).padStart(2, '0')}`));
unique(e.xml.map(x => x.id));
const xmlIds = new Set(e.xml.map(x => x.id));
let pointers = 0;
for (const c of e.claims) {
  assert.ok(c.finding.length > 30 && c.sources.length);
  for (const id of c.xml) assert.ok(xmlIds.has(id));
  for (const s of c.sources) {
    pointers++; hex(s.sha256); safe(s.file);
    assert.ok(s.lines.length === 2 && s.lines.every(Number.isInteger) && s.lines[0] >= 1 && s.lines[1] >= s.lines[0]);
    if (local) {
      await hashFile(safe(s.file), s.sha256);
      assert.ok(s.lines[1] <= (await readFile(safe(s.file), 'utf8')).split('\n').length);
    }
  }
}
for (const x of e.xml) {
  hex(x.source_sha256); assert.ok(x.file.startsWith('Data/Core/Defs/') && x.xpath.startsWith('/Defs/'));
  assert.ok(x.nodes.length && x.nodes.every(node => node.startsWith('<')));
  assert.match(x.projection, /not the complete selected node/);
  if (local) await hashFile(resolve(game, x.file), x.source_sha256);
}
const projection = id => e.xml.find(x => x.id === id).nodes.join('\n');
for (const value of [1, 25]) assert.ok(projection('PX01').includes(`<costStuffCount>${value}</costStuffCount>`));
assert.match(projection('PX01'), /<roamerCanOpen>true<\/roamerCanOpen>/);
assert.match(projection('PX02'), /<costStuffCount>30<\/costStuffCount>/);
assert.match(projection('PX03'), /AllowMaleGender/);
assert.match(projection('PX05'), /<roamMtbDays>2<\/roamMtbDays>/);
assert.ok(!projection('PX04').includes('roamMtbDays'));
assert.match(projection('PX07'), /<workType>Handling<\/workType>/);
assert.match(projection('PX08'), /JobGiver_StartRoaming/);
assert.equal(e.rea_members.status, 'unavailable');
assert.match(e.rea_members.reason, /67108864/); hex(e.rea_members.sha256);

assert.deepEqual(r.saves.map(s => s.ticks_game), [75812, 75813, 76651, 77073, 76756, 77990, 77990]);
assert.equal(r.preparation.developer_action, true);
assert.equal(r.preparation.direct_tame_action, true);
assert.equal(r.preparation.edited_saves, false);
assert.equal(r.preparation.no_statistical_calibration, true);
assert.equal(r.preparation.load_to_preparation_ticks, 1);
assert.deepEqual(r.launch.active_mods, ['ludeon.rimworld', 'ludeon.rimworld.odyssey']);
assert.equal(r.launch.baseline_source_sha256, r.launch.baseline_copy_sha256);
assert.match(r.launch.configuration_change, /pauseOnLoad False -> True/);
assert.deepEqual(r.branches.main_sequence, [0, 1, 2, 3]);
assert.deepEqual(r.branches.second_sequence, [2, 4, 5, 6]);
assert.equal(r.branches.reload_action, 75);
const [baseline, prepared, approach, arrived, roped, opened, repeated] = r.saves;
assert.equal(baseline.sha256, r.launch.baseline_copy_sha256);
for (const field of ['deer', 'gate', 'marker']) assert.equal(baseline[field], null);
for (const [i, s] of r.saves.entries()) {
  hex(s.sha256); safe(s.file);
  assert.equal(s.handler.id, r.targets.handler); assert.equal(s.hare.id, r.targets.hare);
  assert.equal(s.fences.length, i === 0 ? 0 : 33); unique(s.fences.map(f => f.id));
  for (const p of [s.handler, s.hare, s.deer].filter(Boolean)) {
    assert.equal(p.faction, r.targets.player_faction);
    assert.ok(p.xml.includes(`<id>${p.id}</id>`) && p.xml.includes(`<pos>${p.position}</pos>`));
    assert.ok(p.xml.includes(p.jobs_xml) && p.xml.includes(p.roping_xml) && p.xml.includes(p.player_settings_xml));
    if (p.roped_to) assert.ok(p.roping_xml.includes(`<ropedTo>${p.roped_to}</ropedTo>`));
    for (const ropee of p.ropees) assert.ok(p.roping_xml.includes(`<li>${ropee}</li>`));
  }
  if (i) {
    assert.equal(s.deer.id, r.targets.deer); assert.equal(s.deer.def, 'Deer');
    assert.equal(s.gate.id, r.targets.gate); assert.equal(s.gate.position, '(124, 0, 141)');
    assert.equal(s.marker.id, r.targets.marker); assert.equal(s.marker.position, '(129, 0, 141)');
    assert.equal(s.gate.open, /<open>True<\/open>/.test(s.gate.xml));
    assert.equal(s.gate.hold_open, /<holdOpen>True<\/holdOpen>/.test(s.gate.xml));
    assert.ok(s.marker.allowed_defs.includes('Deer') && !s.marker.allowed_defs.includes('Hare'));
    assert.ok(s.marker.xml.includes(s.marker.filter_xml));
  }
  if (local) await hashFile(safe(s.file), s.sha256);
}
assert.deepEqual(prepared.marker.disallowed_special_filters, ['AllowMaleGender']);
assert.deepEqual(approach.marker.disallowed_special_filters, []);
assert.equal(approach.handler.job, 'RopeToPen'); assert.equal(approach.deer.roped_to, '');
assert.match(approach.handler.jobs_xml, /<playerForced>True<\/playerForced>/);
assert.match(approach.handler.jobs_xml, /<targetC>Thing_PenMarker149578<\/targetC>/);
assert.equal(roped.deer.roped_to, 'Thing_Human958');
assert.deepEqual(roped.handler.ropees, ['Thing_Deer149579']);
assert.equal(roped.handler.position, '(121, 0, 141)'); assert.equal(roped.deer.position, '(121, 0, 140)');
assert.equal(roped.deer.job, 'Wait'); assert.match(roped.deer.jobs_xml, /<expiryInterval>30<\/expiryInterval>/);
assert.match(roped.deer.jobs_xml, /<def>FollowRoper<\/def>/);
assert.equal(arrived.deer.position, '(125, 0, 141)'); assert.equal(arrived.handler.job, 'FeedPatient');
for (const s of [arrived, opened, repeated]) { assert.equal(s.deer.roped_to, ''); assert.deepEqual(s.handler.ropees, []); }
assert.equal(arrived.gate.hold_open, false);
assert.equal(opened.gate.open, true); assert.equal(opened.gate.hold_open, true);
assert.equal(opened.deer.position, '(131, 0, 141)');
for (const field of ['ticks_game', 'handler', 'deer', 'hare', 'gate', 'marker', 'fences']) assert.deepEqual(opened[field], repeated[field]);
assert.deepEqual(r.shutdown.rimworld_processes_after_exit, []);
assert.match(r.shutdown.capture_result, /No successful action100/);

assert.equal(r.actions.length, 99); unique(r.actions.map(a => a.image_name));
for (const [i, a] of r.actions.entries()) {
  assert.ok(a.image_name.startsWith(`animal-pens-${String(i + 1).padStart(3, '0')}-`));
  hex(a.source_sha256); hex(a.image_sha256);
  assert.ok(Date.parse(a.finished_utc) >= Date.parse(a.started_utc));
  if (i) assert.ok(Date.parse(a.started_utc) >= Date.parse(r.actions[i - 1].finished_utc));
  if (a.action === 'drag') assert.ok(a.end_x >= 0 && a.end_x < 2560 && a.end_y >= 0 && a.end_y < 1440);
  if (local) {
    await hashFile(safe(a.source_file), a.source_sha256);
    await hashFile(safe(`.local-research/runtime/${a.image_name}`), a.image_sha256);
    const lines = (await readFile(safe(a.source_file), 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line.replace(/^\uFEFF/, '')));
    const record = lines.find(entry => basename(entry.image) === a.image_name); assert.ok(record);
    const normalizeTime = value => value.replace(/(\.\d*?[1-9])0+Z$/, '$1Z').replace(/\.0+Z$/, 'Z');
    for (const key of ['started_utc', 'finished_utc']) assert.equal(normalizeTime(record[key]), normalizeTime(a[key]));
    for (const key of ['action', 'x', 'y', 'text', 'virtual_key', 'duration_ms', 'wait_ms', 'park_x', 'park_y']) assert.deepEqual(record[key], a[key]);
    for (const key of ['end_x', 'end_y']) assert.equal(record[key] ?? null, a[key]);
  }
}
assert.equal(r.images.length, 9); unique(r.images.map(s => s.id));
for (const s of r.images) {
  await hashFile(safe(`docs/research/rimworld/evidence/${s.file}`), s.sha256);
  const bytes = await readFile(resolve(base, s.file));
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), s.crop[2]); assert.equal(bytes.readUInt32BE(20), s.crop[3]);
  assert.deepEqual(s.source_dimensions, [2560, 1440]);
  assert.ok(s.crop[0] >= 0 && s.crop[1] >= 0 && s.crop[0] + s.crop[2] <= 2560 && s.crop[1] + s.crop[3] <= 1440);
  assert.equal(r.actions.find(a => a.image_name === basename(s.source_file))?.image_sha256, s.source_sha256);
}
assert.equal(r.observations.length, 6);
for (const o of r.observations) for (const id of o.evidence) assert.ok(id === 'saves' || r.images.some(s => s.id === id));

let originalProjections = 0;
if (local) {
  await hashFile(resolve(game, 'Assembly-CSharp.dll'), m.source_sha256);
  await hashFile(resolve(root, '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'), m.engine_sha256);
  await hashFile(safe(e.rea_members.source_file), e.rea_members.sha256);
  await hashFile(safe(r.launch.launch_record), r.launch.launch_record_sha256);
  await hashFile(safe(`${r.launch.profile}/Config/ModsConfig.xml`), r.launch.mods_config_sha256);
  // Compare public save/XML projections to the actual source nodes, not hashes alone.
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference='Stop'
$root=${quote(root)};$game=${quote(game)};$base=Join-Path $root 'docs/research/rimworld/evidence'
$r=Get-Content (Join-Path $base 'animal-pens-runtime-evidence.json') -Raw|ConvertFrom-Json
$e=Get-Content (Join-Path $base 'animal-pens-evidence.json') -Raw|ConvertFrom-Json
$count=0
function CheckProjection($actual,[string]$projection){
 $expected=([xml]$projection).DocumentElement
 if(!$actual -or $actual.LocalName -cne $expected.LocalName){throw 'Missing original projected node'}
 foreach($attr in $expected.Attributes){if($actual.GetAttribute($attr.Name) -cne $attr.Value){throw 'Projection attribute mismatch'}}
 foreach($child in $expected.ChildNodes){
  $original=$actual.SelectSingleNode($child.LocalName)
  if(!$original){throw 'Projection child missing'}
  if($child.LocalName -in @('statBases','race','building')){
   foreach($leaf in $child.ChildNodes){if($original.SelectSingleNode($leaf.LocalName).OuterXml -cne $leaf.OuterXml){throw 'XML gameplay leaf mismatch'}}
  }elseif($original.OuterXml -cne $child.OuterXml){throw 'Projection child mismatch'}
 }
}
foreach($save in $r.saves){
 $doc=[xml](Get-Content -LiteralPath (Join-Path $root $save.file) -Raw)
 if([int]$doc.savegame.game.tickManager.ticksGame -ne $save.ticks_game){throw 'Original tick mismatch'}
 foreach($p in @($save.handler,$save.deer,$save.hare,$save.gate,$save.marker)+@($save.fences)){
  if(!$p){continue};$node=$doc.SelectSingleNode('//maps/li/things/thing[id="'+$p.id+'"]')
  CheckProjection $node $p.xml;$count++
 }
}
foreach($x in $e.xml){
 $doc=[xml](Get-Content -LiteralPath (Join-Path $game $x.file) -Raw);$nodes=$doc.SelectNodes($x.xpath)
 if($nodes.Count -ne $x.nodes.Count){throw 'Original XPath count mismatch'}
 for($i=0;$i -lt $nodes.Count;$i++){CheckProjection $nodes[$i] $x.nodes[$i];$count++}
}
Write-Output $count`;
  const output = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
  originalProjections = Number(output.trim()); assert.ok(originalProjections > 200);
}
let links = 0;
for (const name of ['91-animal-pens-mechanisms.md', '92-native-animal-pens-runtime.md']) {
  const file = resolve(base, '..', name);
  for (const match of (await readFile(file, 'utf8')).matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|#)/.test(match[1])) continue;
    await access(resolve(dirname(file), match[1].split('#')[0])); links++;
  }
}
console.log(JSON.stringify({mode: local ? 'local-artifact-integrity' : 'portable-record-integrity', unique_types: types.length, claims: e.claims.length, source_pointers: pointers, xml_selections: e.xml.length, native_saves: r.saves.length, native_actions: r.actions.length, crops: r.images.length, local_links: links, checked_file_hashes: hashes.size, original_node_projections: originalProjections, scope: 'Stored evidence integrity only; no runtime replay or statistical calibration'}, null, 2));
