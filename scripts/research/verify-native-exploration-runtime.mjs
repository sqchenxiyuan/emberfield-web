import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Recomputes facts from retained XML/bitmasks. Never launches or controls RimWorld.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = resolve(root, 'docs/research/rimworld/evidence');
const local = process.argv.includes('--local');
const game = process.env.RIMWORLD_GAME_ROOT || 'F:/SteamLibrary/steamapps/common/RimWorld';
const hash = b => createHash('sha256').update(b).digest('hex');
const hex = s => assert.match(s, /^[a-f0-9]{64}$/);
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const safe = (dir, file) => {
  assert.equal(typeof file, 'string');
  const full = resolve(dir, file), rel = relative(dir, full);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), `Path outside expected root: ${file}`);
  return full;
};
const filesChecked = new Map();
async function checkFile(file, expected) {
  hex(expected);
  if (!filesChecked.has(file)) filesChecked.set(file, hash(await readFile(file)));
  assert.equal(filesChecked.get(file), expected, `File hash: ${file}`);
}
function entities(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e.startsWith('#')) return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
  });
}
// Small, dependency-free parser for the retained XmlDocument.OuterXml projections.
// Rejects declarations/entities outside the five XML built-ins and numeric refs.
function xml(source) {
  assert.equal(typeof source, 'string');
  assert.doesNotMatch(source, /<!DOCTYPE|<!ENTITY/i);
  const stack = [], roots = [];
  for (const match of source.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[^>]+>|[^<]+/g)) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { assert.ok(stack.length); stack.at(-1).content.push(token.slice(9, -3)); continue; }
    if (token.startsWith('</')) { assert.equal(stack.pop()?.name, token.slice(2, -1).trim()); continue; }
    if (token.startsWith('<')) {
      const name = token.match(/^<([\w.:-]+)/)?.[1]; assert.ok(name, 'Valid XML element name');
      const attrs = {};
      for (const a of token.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) { assert.ok(!(a[1] in attrs)); attrs[a[1]] = entities(a[2] ?? a[3]); }
      const node = { name, attrs, content: [] };
      if (stack.length) stack.at(-1).content.push(node); else roots.push(node);
      if (!token.endsWith('/>')) stack.push(node);
    } else if (stack.length) stack.at(-1).content.push(entities(token));
    else assert.equal(token.trim(), '');
  }
  assert.equal(stack.length, 0); assert.equal(roots.length, 1);
  return roots[0];
}
const children = (node, name) => node?.content.filter(c => typeof c !== 'string' && (!name || c.name === name)) ?? [];
const text = node => node ? node.content.map(c => typeof c === 'string' ? c : text(c)).join('') : null;
const at = (node, path) => path.split('/').reduce((n, part) => children(n, part)[0], node);
const val = (node, path) => text(at(node, path));
const unique = list => assert.equal(new Set(list).size, list.length);
const posText = p => `(${p[0]}, ${p[1]}, ${p[2]})`;
const fogAt = (b, i) => Boolean(b[i >> 3] & (1 << (i & 7)));
const range = n => Array.from({ length: n }, (_, i) => i);
function stableShortHash(name) {
  let value = 23;
  for (let i = 0; i < name.length; i++) value = (Math.imul(value, 31) + name.charCodeAt(i)) | 0;
  return (value % 65535) & 65535;
}
function projection(stage, role) {
  const found = stage.projections.filter(p => p.role === role); assert.equal(found.length, 1, role);
  return found[0].nodes.map(xml);
}
function decodeBlob(record, expectedLength) {
  assert.ok(record.xpath.startsWith('/savegame/game/maps/li[uniqueID="0"]'));
  hex(record.node_sha256); assert.equal(hash(record.node_xml), record.node_sha256);
  const node = xml(record.node_xml), b64 = text(node).replace(/\s/g, '');
  assert.match(b64, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
  assert.ok(record.xpath.endsWith('/' + node.name));
  assert.equal(record.compression, node.name.endsWith('Deflate') ? 'raw-deflate' : 'none');
  const encoded = Buffer.from(b64, 'base64');
  assert.equal(encoded.toString('base64'), b64);
  assert.equal(encoded.length, record.encoded_bytes); assert.equal(hash(encoded), record.encoded_sha256);
  const decoded = record.compression === 'raw-deflate' ? inflateRawSync(encoded, { maxOutputLength: expectedLength }) : encoded;
  assert.equal(decoded.length, expectedLength); assert.equal(record.decoded_bytes, expectedLength);
  assert.equal(hash(decoded), record.decoded_sha256);
  return decoded;
}

const e = await json(resolve(base, 'native-exploration-runtime.json'));
assert.equal(e.evidence_id, 'RW17-NATIVE-EXPLORATION'); assert.equal(e.schema_version, 1);
assert.equal(e.kind, 'native-runtime-observed'); assert.equal(e.version, '1.7.4980 rev60');
assert.equal(e.preparation.edited_saves, false); assert.equal(e.preparation.developer_action_this_trial, false);
assert.equal(e.preparation.offline_scene_selection, true);
assert.deepEqual(e.launch.active_mods, ['ludeon.rimworld', 'ludeon.rimworld.odyssey']);
assert.equal(e.launch.assembly_sha256, 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
assert.equal(e.launch.baseline_copy_sha256, e.launch.baseline_source_sha256);
assert.equal(e.saves[0].sha256, e.launch.baseline_copy_sha256);
assert.equal(e.decoder.route_granite_short_hash, 14420);
assert.equal(stableShortHash('Granite'), e.decoder.route_granite_short_hash);
assert.equal(e.decoder.cell_index, 'x + z * 250');
assert.equal(e.targets.initial_miner, 'Human965'); assert.equal(e.targets.initial_miner_nick, 'Grump');
assert.deepEqual(e.targets.colonist_ids, ['Human958', 'Human961', 'Human965']);
assert.deepEqual(e.targets.mine_route, range(5).map(i => [89, 0, 196 + i]));
assert.deepEqual(e.targets.original_unknown_air, [89, 0, 200]);
assert.deepEqual(e.targets.approach, [89, 0, 195]);

await checkFile(safe(base, e.decoder.manifest_file), e.decoder.manifest_sha256);
const manifest = await json(safe(base, e.decoder.manifest_file));
assert.equal(manifest.kind, 'static-derived-decoder-provenance');
assert.equal(manifest.source_sha256, e.launch.assembly_sha256);
assert.equal(manifest.engine_sha256, '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');
assert.equal(manifest.engine_version, '11.2.0.10050');
await checkFile(resolve(root, 'scripts/research/collect-native-exploration-runtime.ps1'), manifest.collector_sha256);
await checkFile(fileURLToPath(import.meta.url), manifest.verifier_sha256);
assert.equal(manifest.input_helper_file, 'scripts/research/exploration-runtime-input.ps1');
await checkFile(safe(root, manifest.input_helper_file), manifest.input_helper_sha256);
for (const p of manifest.source_pointers) {
  safe(root, p.file); hex(p.sha256); assert.ok(Number.isInteger(p.lines) && p.lines > 0);
  for (const r of p.ranges) assert.ok(r.length === 2 && r.every(Number.isInteger) && r[0] > 0 && r[1] >= r[0] && r[1] <= p.lines);
  if (local) { await checkFile(safe(root, p.file), p.sha256); assert.equal((await readFile(safe(root, p.file), 'utf8')).replace(/\r\n/g, '\n').split('\n').length, p.lines); }
}

const stages = new Map(), stageData = new Map(); unique(e.saves.map(s => s.id));
let previous = null, baseline = null, projectionCount = 0;
for (const stage of e.saves) {
  assert.ok(Number.isInteger(stage.tick) && stage.tick >= 0); assert.deepEqual(stage.size, [250, 1, 250]); assert.equal(stage.map_id, 0);
  hex(stage.sha256); safe(root, stage.file); assert.ok(stage.bytes > 0);
  assert.equal(stage.blobs.length, 2); unique(stage.blobs.map(b => b.role));
  const fog = decodeBlob(stage.blobs.find(b => b.role === 'fog'), 7813);
  const things = decodeBlob(stage.blobs.find(b => b.role === 'compressed_things'), 125000);
  assert.equal(fog.at(-1) & 0xf0, 0, 'Unused fog bits are zero');
  if (!baseline) baseline = fog;
  const indices = range(62500), fogCount = indices.filter(i => fogAt(fog, i)).length;
  assert.equal(stage.fog.count, fogCount); assert.equal(stage.fog.known_count, 62500 - fogCount);
  assert.deepEqual(stage.fog.newly_known_indices, previous ? indices.filter(i => fogAt(previous, i) && !fogAt(fog, i)) : []);
  assert.deepEqual(stage.fog.newly_fogged_indices, previous ? indices.filter(i => !fogAt(previous, i) && fogAt(fog, i)) : []);
  assert.deepEqual(stage.fog.known_since_baseline_indices, indices.filter(i => fogAt(baseline, i) && !fogAt(fog, i)));
  unique(stage.projections.map(p => p.role)); unique(stage.projections.map(p => p.xpath));
  for (const p of stage.projections) {
    assert.ok(p.xpath.startsWith('/savegame/')); assert.ok(Array.isArray(p.fields));
    assert.equal(p.nodes.length, p.count); assert.equal(p.node_sha256.length, p.count);
    for (const [i, node] of p.nodes.entries()) { assert.equal(hash(node), p.node_sha256[i]); xml(node); projectionCount++; }
  }
  const meta = projection(stage, 'meta'); assert.equal(meta.length, 1);
  assert.equal(val(meta[0], 'gameVersion'), e.version);
  assert.deepEqual(children(at(meta[0], 'modIds'), 'li').map(text), e.launch.active_mods);
  assert.equal(Number(text(projection(stage, 'tick')[0])), stage.tick);
  assert.equal(text(projection(stage, 'map_size')[0]), '(250, 1, 250)');
  const designations = projection(stage, 'mine_designations').map(n => ({ def: val(n, 'def'), target: val(n, 'target') }));
  assert.ok(designations.every(d => d.def === 'Mine')); assert.deepEqual(stage.mine_designations, designations);
  assert.equal(stage.route.length, 5);
  for (const [j, cell] of stage.route.entries()) {
    assert.deepEqual(cell.pos, e.targets.mine_route[j]);
    const index = cell.pos[0] + 250 * cell.pos[2], h = things.readUInt16LE(index * 2);
    assert.equal(cell.index, index); assert.equal(cell.fogged, fogAt(fog, index)); assert.equal(cell.compressed_short_hash, h);
    assert.ok([0, 14420, 12796].includes(h), 'Route contains only empty compressed slot, Granite, or ChunkGranite; review new hash');
    const nodes = projection(stage, cell.projection_role), ids = nodes.map(n => val(n, 'id'));
    assert.ok(nodes.every(n => val(n, 'pos') === posText(cell.pos)));
    assert.deepEqual(cell.explicit_thing_ids, ids);
    const rocks = nodes.filter(n => n.attrs.Class === 'Mineable' || val(n, 'def') === 'Granite');
    assert.ok(rocks.length <= 1); assert.ok(!(h === 14420 && rocks.length));
    const rock = h === 14420 ? { storage: 'compressed', def: 'Granite', id: null, health: null } : rocks.length ? { storage: 'explicit', def: val(rocks[0], 'def'), id: val(rocks[0], 'id'), health: val(rocks[0], 'health') } : null;
    assert.deepEqual(cell.rock, rock);
    assert.equal(cell.mine_designated, designations.some(d => d.target === posText(cell.pos) || d.target?.startsWith('Thing_') && ids.includes(d.target.slice(6))));
  }
  const workers = e.targets.colonist_ids.map(id => {
    const nodes = projection(stage, 'worker_' + id); assert.equal(nodes.length, 1); const w = nodes[0];
    assert.equal(val(w, 'id'), id);
    return { id: val(w, 'id'), nick: val(w, 'name/nick'), pos: val(w, 'pos'), job: val(w, 'jobs/curJob/def'), job_load_id: val(w, 'jobs/curJob/loadID'), job_target_a: val(w, 'jobs/curJob/targetA'), player_forced: val(w, 'jobs/curJob/playerForced'), driver_class: at(w, 'jobs/curDriver')?.attrs.Class ?? null };
  });
  assert.deepEqual(stage.workers, workers);
  assert.equal(workers.find(w => w.id === e.targets.initial_miner)?.nick, e.targets.initial_miner_nick);
  const letters = projection(stage, 'letters').map(n => ({ class: n.attrs.Class, def: val(n, 'def'), label: val(n, 'label'), arrival_tick: val(n, 'arrivalTick'), text: val(n, 'text'), targets: children(at(n, 'lookTargets/targets'), 'li').map(text) }));
  assert.deepEqual(stage.letters, letters);
  projection(stage, 'letter_stack');
  if (stage.role === 'planned') {
    assert.ok(stage.route.every(c => c.mine_designated));
    assert.ok(stage.route.slice(0, 4).every(c => c.rock?.def === 'Granite'));
    assert.equal(stage.route[4].fogged, true); assert.equal(stage.route[4].rock, null);
  }
  if (stage.role === 'excavating') {
    const miningWorkers = workers.filter(w => w.job === 'Mine' && w.driver_class === 'JobDriver_Mine');
    const target = stage.route.find(c => c.rock?.storage === 'explicit' && miningWorkers.some(w => 'Thing_' + c.rock.id === w.job_target_a));
    assert.ok(target, 'A native Mine job targets an explicit route rock');
    assert.ok(Number(target.rock.health) > 0 && Number(target.rock.health) < 900, 'Saved damaged Granite demonstrates work beyond walking');
  }
  if (stage.role === 'revealed' || stage.role === 'reloaded') {
    assert.ok(stage.route.every(c => !c.fogged && !c.rock && !c.mine_designated));
    assert.ok(letters.some(l => l.label === 'Area revealed' && l.def === 'NeutralEvent'), 'Retained ordinary Area revealed letter');
  }
  if (stage.reload_of) {
    const before = stages.get(stage.reload_of); assert.ok(before, 'Reload compares to an earlier saved stage');
    assert.equal(hash(fog), hash(stageData.get(stage.reload_of).fog));
    assert.deepEqual(stage.route, before.route); assert.deepEqual(stage.mine_designations, before.mine_designations);
    assert.deepEqual(letters.filter(l => l.label === 'Area revealed'), before.letters.filter(l => l.label === 'Area revealed'));
  }
  if (local) await checkFile(safe(root, stage.file), stage.sha256);
  stages.set(stage.id, stage); stageData.set(stage.id, { fog, things }); previous = fog;
}
assert.ok(e.saves.some(s => s.role === 'planned'), 'Saved five-cell blind mining plan');
assert.ok(e.saves.some(s => s.role === 'revealed'), 'Saved reveal result');
assert.ok(e.saves.some(s => s.role === 'reloaded' && s.reload_of), 'Explicit saved reload result');
assert.ok(e.saves.some(s => s.workers.some(w => w.job === 'Mine')), 'Saved native Mine job');
const first = e.saves[0];
assert.ok(first.route.slice(0, 4).every(c => c.rock?.def === 'Granite'));
assert.deepEqual(first.route.map(c => c.fogged), [false, true, true, true, true]);
assert.equal(first.route[4].rock, null); assert.ok(first.route.every(c => !c.mine_designated));

unique(e.actions.map(a => a.image_name));
for (const [i, a] of e.actions.entries()) {
  hex(a.source_sha256); hex(a.image_sha256); safe(root, a.source_file);
  assert.ok(Date.parse(a.finished_utc) >= Date.parse(a.started_utc));
  if (i) assert.ok(Date.parse(a.started_utc) >= Date.parse(e.actions[i - 1].finished_utc));
  assert.equal(a.pid, e.launch.pid);
  if (a.action === 'pulse') { assert.ok([49, 50, 51].includes(a.virtual_key)); assert.ok(a.duration_ms >= 40 && a.duration_ms <= 4000); }
  if (local) {
    await checkFile(safe(root, a.source_file), a.source_sha256);
    await checkFile(resolve(dirname(safe(root, a.source_file)), a.image_name), a.image_sha256);
    const records = (await readFile(safe(root, a.source_file), 'utf8')).trim().split(/\r?\n/).map(l => JSON.parse(l.replace(/^\uFEFF/, '')));
    const original = records.find(r => basename(r.image) === a.image_name); assert.ok(original);
    for (const key of ['started_utc', 'finished_utc', 'run_start_utc', 'target_click_start_utc', 'pause_start_utc']) assert.equal(original[key] == null ? null : Date.parse(original[key]), a[key] == null ? null : Date.parse(a[key]));
    for (const key of ['pid', 'action', 'x', 'y', 'end_x', 'end_y', 'text', 'virtual_key', 'control', 'duration_ms', 'wheel_delta', 'wait_ms', 'park_x', 'park_y']) assert.deepEqual(original[key], a[key]);
  }
}
unique(e.images.map(i => i.id));
for (const image of e.images) {
  const file = safe(base, image.file); await checkFile(file, image.sha256);
  const png = await readFile(file); assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), image.crop[2]); assert.equal(png.readUInt32BE(20), image.crop[3]);
  assert.ok(image.crop[0] >= 0 && image.crop[1] >= 0 && image.crop[2] > 0 && image.crop[3] > 0);
  assert.ok(image.crop[0] + image.crop[2] <= image.source_dimensions[0] && image.crop[1] + image.crop[3] <= image.source_dimensions[1]);
  assert.equal(e.actions.find(a => a.image_name === basename(image.source_file))?.image_sha256, image.source_sha256);
  if (local) await checkFile(safe(root, image.source_file), image.source_sha256);
}
assert.deepEqual(e.shutdown.rimworld_processes_after_exit, []);
assert.deepEqual(e.shutdown.record.remainingRimWorldProcesses, []); assert.equal(e.shutdown.record.processId, e.launch.pid);
assert.equal(e.shutdown.record.targetProcessAbsent, true); assert.equal(e.shutdown.record.terminationUsed, false);
assert.ok(e.observations.length > 0 && e.limitations.length > 0);
const references = new Set([...e.saves.map(s => s.id), ...e.images.map(i => i.id), 'actions', 'shutdown']);
for (const observation of e.observations) { assert.ok(observation.finding.length > 20); for (const ref of observation.evidence) assert.ok(references.has(ref), ref); }

let originalsChecked = 0;
if (local) {
  await checkFile(resolve(game, 'Assembly-CSharp.dll'), manifest.source_sha256);
  await checkFile(safe(root, e.launch.baseline_source), e.launch.baseline_source_sha256);
  await checkFile(safe(root, e.launch.record_file), e.launch.record_sha256);
  await checkFile(safe(root, e.shutdown.record_file), e.shutdown.record_sha256);
  await checkFile(safe(root, e.launch.profile + '/Config/ModsConfig.xml'), e.launch.mods_sha256);
  const launch = await json(safe(root, e.launch.record_file)); assert.equal(launch.pid, e.launch.pid); assert.equal(launch.baseline_sha256, e.launch.baseline_source_sha256);
  assert.equal(launch.assembly_sha256, e.launch.assembly_sha256); assert.equal(launch.prefs_sha256, e.launch.prefs_sha256);
  assert.deepEqual(await json(safe(root, e.shutdown.record_file)), e.shutdown.record);
  const quote = s => `'${s.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference='Stop'
$root=${quote(root)}
$e=Get-Content -LiteralPath (Join-Path $root 'docs/research/rimworld/evidence/native-exploration-runtime.json') -Raw|ConvertFrom-Json
$count=0
foreach($s in $e.saves){
 $doc=[xml]([IO.File]::ReadAllText((Join-Path $root $s.file)))
 foreach($b in $s.blobs){$n=$doc.SelectSingleNode($b.xpath);if(!$n -or $n.OuterXml -cne $b.node_xml){throw 'Original blob node mismatch'};$count++}
 foreach($p in $s.projections){
  $nodes=$doc.SelectNodes($p.xpath);if($nodes.Count -ne $p.count){throw 'Original XPath count mismatch'}
  for($i=0;$i -lt $nodes.Count;$i++){
   $n=$nodes[$i]
   if($p.fields.Count){$copy=$n.CloneNode($false);foreach($child in $n.ChildNodes){if($child.LocalName -in $p.fields){[void]$copy.AppendChild($child.CloneNode($true))}};$actual=$copy.OuterXml}else{$actual=$n.OuterXml}
   if($actual -cne $p.nodes[$i]){throw ('Original projection mismatch: '+$p.role)};$count++
  }
 }
}
if(@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe' OR Name='RimWorldWin64.exe'").Count){throw 'RimWorld currently running'}
Write-Output $count`;
  originalsChecked = Number(execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).trim());
  assert.equal(originalsChecked, projectionCount + e.saves.length * 2);
}
console.log(JSON.stringify({ mode: local ? 'local-artifact-integrity' : 'portable-record-integrity', saves: e.saves.length, actions: e.actions.length, crops: e.images.length, recomputed_fog_transitions: e.saves.length - 1, checked_file_hashes: filesChecked.size, original_xml_nodes_checked: originalsChecked, stages: e.saves.map(s => ({ id: s.id, tick: s.tick, fog_count: s.fog.count, newly_known: s.fog.newly_known_indices.length, route_rocks: s.route.filter(c => c.rock).length, route_mine_designations: s.route.filter(c => c.mine_designated).length, workers: s.workers.map(w => ({ id: w.id, pos: w.pos, job: w.job, target_a: w.job_target_a })), area_letters: s.letters.filter(l => l.label === 'Area revealed').length })), scope: 'Stored native evidence; independent decompression and XML recomputation; no replay, timing calibration, or probability inference.' }, null, 2));
