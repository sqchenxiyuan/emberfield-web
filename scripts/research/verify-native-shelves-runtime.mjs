import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Verifies retained evidence only; never launches, controls, or replays RimWorld.
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
// Parses exact XmlDocument.OuterXml projections, retaining each nested node's bytes.
function xml(source) {
  assert.equal(typeof source, 'string'); assert.doesNotMatch(source, /<!DOCTYPE|<!ENTITY/i);
  const stack = [], roots = [];
  for (const match of source.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[^>]+>|[^<]+/g)) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { assert.ok(stack.length); stack.at(-1).content.push(token.slice(9, -3)); continue; }
    if (token.startsWith('</')) {
      const node = stack.pop(); assert.equal(node?.name, token.slice(2, -1).trim());
      node.raw = source.slice(node.start, match.index + token.length); continue;
    }
    if (token.startsWith('<')) {
      const name = token.match(/^<([\w.:-]+)/)?.[1]; assert.ok(name);
      const attrs = {};
      for (const a of token.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        assert.ok(!(a[1] in attrs)); attrs[a[1]] = entities(a[2] ?? a[3]);
      }
      const node = { name, attrs, content: [], start: match.index, raw: token.endsWith('/>') ? token : null };
      if (stack.length) stack.at(-1).content.push(node); else roots.push(node);
      if (!token.endsWith('/>')) stack.push(node);
    } else if (stack.length) stack.at(-1).content.push(entities(token));
    else assert.equal(token.trim(), '');
  }
  assert.equal(stack.length, 0); assert.equal(roots.length, 1); return roots[0];
}
const children = (node, name) => node?.content.filter(c => typeof c !== 'string' && (!name || c.name === name)) ?? [];
const text = node => node ? node.content.map(c => typeof c === 'string' ? c : text(c)).join('') : null;
const at = (node, path) => path.split('/').reduce((n, part) => children(n, part)[0], node);
const val = (node, path) => text(at(node, path));
const raw = (node, path) => at(node, path)?.raw ?? null;
const unique = list => assert.equal(new Set(list).size, list.length);
const posText = p => `(${p[0]}, ${p[1]}, ${p[2]})`;
function projection(stage, role) {
  const found = stage.projections.filter(p => p.role === role); assert.equal(found.length, 1, role);
  return found[0].nodes.map(xml);
}
function summarize(nodes, targets) {
  const entries = [];
  function walk(node, path, owner, location) {
    if (at(node, 'def') && at(node, 'id')) entries.push({ node, path, root_id: owner, location });
    const indices = {};
    for (const child of children(node)) {
      const name = child.name; indices[name] = (indices[name] ?? 0) + 1;
      if (path === '.' && !['carryTracker', 'inventory', 'innerContainer', 'resourceContainer'].includes(name)) continue;
      walk(child, `${path}/${name}[${indices[name]}]`, owner, path === '.' ? name : location);
    }
  }
  for (const node of nodes) walk(node, '.', val(node, 'id'), 'ground');
  const batches = entries.filter(e => targets.tracked_defs.includes(val(e.node, 'def'))).map(e => {
    const n = e.node, count = val(n, 'stackCount');
    const amount = count === null ? 1 : Number(count); assert.ok(Number.isInteger(amount) && amount > 0);
    return { id: val(n, 'id'), def: val(n, 'def'), amount, stack_count_serialized: count,
      root_id: e.root_id, path: e.path, location: e.location, pos: val(n, 'pos'), map: val(n, 'map'),
      health: val(n, 'health'), forbidden: val(n, 'forbidden'), rot_progress: val(n, 'rotProg') };
  });
  unique(batches.map(b => b.id));
  const totals = Object.fromEntries(targets.tracked_defs.map(def => [def, batches.filter(b => b.def === def).reduce((sum, b) => sum + b.amount, 0)]));
  const shelves = entries.filter(e => ['Shelf', 'ShelfSmall'].includes(val(e.node, 'def'))).map(e => {
    const n = e.node, settings = raw(n, 'settings');
    return { id: val(n, 'id'), def: val(n, 'def'), root_id: e.root_id, path: e.path, location: e.location,
      pos: val(n, 'pos'), map: val(n, 'map'), rot: val(n, 'rot'), stuff: val(n, 'stuff'), health: val(n, 'health'),
      spawned_tick: val(n, 'spawnedTick'), despawned_tick: val(n, 'despawnedTick'), quality: val(n, 'quality'),
      storage_group: val(n, 'storageGroup'), settings_xml: settings, settings_sha256: settings === null ? null : hash(settings) };
  });
  unique(shelves.map(s => s.id));
  const plans = nodes.filter(n => /^(Blueprint_|Frame_)/.test(val(n, 'def'))).map(n => ({ id: val(n, 'id'), def: val(n, 'def'), class: n.attrs.Class,
    pos: val(n, 'pos'), stuff_to_use: val(n, 'stuffToUse'), work_done: val(n, 'workDone'), thing_to_install: val(n, 'thingToInstall'), settings_xml: raw(n, 'settings') }));
  const workers = targets.colonist_ids.map(id => {
    const found = nodes.filter(n => val(n, 'id') === id); assert.equal(found.length, 1); const n = found[0];
    return { id, nick: val(n, 'name/nick'), pos: val(n, 'pos'), job: val(n, 'jobs/curJob/def'), job_load_id: val(n, 'jobs/curJob/loadID'),
      job_target_a: val(n, 'jobs/curJob/targetA'), job_target_b: val(n, 'jobs/curJob/targetB'), job_count: val(n, 'jobs/curJob/count'),
      driver_class: at(n, 'jobs/curDriver')?.attrs.Class ?? null,
      carried_ids: entries.filter(e => e.root_id === id && e.location === 'carryTracker').map(e => val(e.node, 'id')) };
  });
  const cells = targets.watched_cells.map(pos => ({ pos, occupants: nodes.filter(n => val(n, 'pos') === posText(pos)).map(n => ({ id: val(n, 'id'), def: val(n, 'def') })),
    tracked_stacks: batches.filter(b => b.location === 'ground' && b.pos === posText(pos)).map(b => b.id) }));
  return { batches, totals, shelves, plans, workers, cells };
}

const e = await json(resolve(base, 'native-shelves-runtime.json'));
assert.equal(e.evidence_id, 'RW17-NATIVE-SHELVES'); assert.equal(e.schema_version, 1);
assert.equal(e.kind, 'native-runtime-observed'); assert.equal(e.version, '1.7.4980 rev60');
assert.equal(e.preparation.edited_saves, false); assert.equal(e.preparation.developer_action_this_trial, false);
assert.equal(e.preparation.code_injection, false); assert.equal(e.preparation.baseline_contains_earlier_developer_preparation, true);
assert.deepEqual(e.launch.active_mods, ['ludeon.rimworld', 'ludeon.rimworld.odyssey']);
assert.equal(e.launch.assembly_sha256, 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
assert.equal(e.launch.baseline_copy_sha256, e.launch.baseline_source_sha256);
assert.equal(e.saves[0].sha256, e.launch.baseline_copy_sha256);
assert.deepEqual(e.targets.map_size, [250, 1, 250]); assert.equal(e.targets.map_id, 0);
assert.deepEqual(e.targets.colonist_ids, ['Human958', 'Human961', 'Human965']);
assert.deepEqual(e.targets.initial_shelf_cell, [115, 0, 130]);
assert.match(e.targets.target_shelf_id, /^ShelfSmall\d+$/);
unique(e.targets.tracked_defs); unique(e.targets.watched_cells.map(posText));
for (const def of e.targets.tracked_defs) assert.match(def, /^[A-Za-z0-9_]+$/);
for (const p of e.targets.watched_cells) assert.ok(p.length === 3 && p.every(Number.isInteger) && p[0] >= 0 && p[0] < 250 && p[1] === 0 && p[2] >= 0 && p[2] < 250);
for (const [name, file] of [['collector', 'collect-native-shelves-runtime.ps1'], ['verifier', 'verify-native-shelves-runtime.mjs'], ['input_helper', 'shelves-runtime-input.ps1']]) {
  assert.equal(e.tools[name + '_file'], 'scripts/research/' + file);
  await checkFile(safe(root, e.tools[name + '_file']), e.tools[name + '_sha256']);
  assert.ok(!(await readFile(safe(root, e.tools[name + '_file']), 'utf8')).includes('\r'), `${name} uses LF`);
}
let projectionCount = 0;
const stages = new Map(); unique(e.saves.map(s => s.id));
for (const stage of e.saves) {
  hex(stage.sha256); safe(root, stage.file); assert.ok(stage.bytes > 0); assert.ok(Number.isSafeInteger(stage.tick) && stage.tick >= 0);
  unique(stage.projections.map(p => p.role)); unique(stage.projections.map(p => p.xpath));
  for (const p of stage.projections) {
    assert.ok(p.xpath.startsWith('/savegame/')); assert.ok(Array.isArray(p.fields)); unique(p.fields);
    assert.equal(p.nodes.length, p.count); assert.equal(p.node_sha256.length, p.count);
    for (const [i, node] of p.nodes.entries()) { assert.equal(hash(node), p.node_sha256[i]); xml(node); projectionCount++; }
  }
  const meta = projection(stage, 'meta'); assert.equal(meta.length, 1); assert.equal(val(meta[0], 'gameVersion'), e.version);
  assert.deepEqual(children(at(meta[0], 'modIds'), 'li').map(text), e.launch.active_mods);
  assert.equal(Number(text(projection(stage, 'tick')[0])), stage.tick);
  assert.equal(text(projection(stage, 'map_size')[0]), '(250, 1, 250)');
  const nodes = projection(stage, 'physical_roots'); unique(nodes.map(n => val(n, 'id')));
  const computed = summarize(nodes, e.targets); assert.deepEqual(stage.summary, computed, `Recomputed XML summary: ${stage.id}`);
  projection(stage, 'designations'); projection(stage, 'storage_groups');
  const shelf = computed.shelves.find(s => s.id === e.targets.target_shelf_id);
  for (const s of computed.shelves) { assert.equal(s.def, 'ShelfSmall'); assert.equal(s.quality, null); assert.ok(s.settings_xml); assert.equal(s.stuff, 'WoodLog'); }
  const expected = stage.expect ?? {};
  for (const key of Object.keys(expected)) assert.ok(['shelf_location', 'shelf_pos', 'shelf_rotation', 'shelf_priority', 'shelf_cell_stacks', 'initial_cell_stack_count', 'initial_cell_defs', 'initial_cell_stacks', 'blueprint_id', 'packed_without_contents'].includes(key), key);
  if (expected.shelf_location !== undefined) assert.equal(shelf?.location ?? null, expected.shelf_location);
  if (expected.shelf_pos !== undefined) assert.equal(shelf?.pos ?? null, expected.shelf_pos);
  if (expected.shelf_rotation !== undefined) assert.equal(shelf?.rot ?? null, expected.shelf_rotation);
  if (expected.shelf_priority !== undefined) assert.equal(shelf?.settings_xml ? val(xml(shelf.settings_xml), 'priority') : null, expected.shelf_priority);
  if (expected.shelf_cell_stacks !== undefined) {
    assert.equal(shelf?.location, 'ground');
    assert.deepEqual(Object.fromEntries(computed.batches.filter(b => b.location === 'ground' && b.pos === shelf.pos).map(b => [b.id, b.amount])), expected.shelf_cell_stacks);
  }
  const initial = computed.cells.find(c => posText(c.pos) === posText(e.targets.initial_shelf_cell)); assert.ok(initial);
  if (expected.initial_cell_stack_count !== undefined) assert.equal(initial.tracked_stacks.length, expected.initial_cell_stack_count);
  if (expected.initial_cell_defs !== undefined) assert.deepEqual(initial.tracked_stacks.map(id => computed.batches.find(b => b.id === id).def).sort(), [...expected.initial_cell_defs].sort());
  if (expected.initial_cell_stacks !== undefined) assert.deepEqual(Object.fromEntries(initial.tracked_stacks.map(id => [id, computed.batches.find(b => b.id === id).amount])), expected.initial_cell_stacks);
  if (expected.blueprint_id !== undefined) assert.ok(computed.plans.some(p => p.id === expected.blueprint_id));
  if (expected.packed_without_contents) {
    assert.ok(shelf && shelf.location !== 'ground');
    const wrapper = nodes.find(n => val(n, 'id') === shelf.root_id); assert.ok(wrapper);
    assert.equal(val(wrapper, 'def'), 'MinifiedThing');
    assert.equal(children(at(wrapper, 'innerContainer/innerList'), 'li').length, 1, 'Only the original shelf is in the minified wrapper');
    assert.equal(computed.batches.filter(b => b.root_id === shelf.root_id).length, 0, 'Shelf goods are not hidden inside its package');
  }
  if (stage.reload_of) {
    const before = stages.get(stage.reload_of); assert.ok(before);
    assert.deepEqual(computed.shelves, before.summary.shelves, 'Shelf state preserved by ordinary reload');
    assert.deepEqual(computed.totals, before.summary.totals, 'Tracked quantities preserved by ordinary reload');
    // Native save/load can reorder root things without changing cell membership.
    const membership = cells => cells.map(c => ({ ...c, occupants: [...c.occupants].sort((a, b) => a.id.localeCompare(b.id)), tracked_stacks: [...c.tracked_stacks].sort() }));
    assert.deepEqual(membership(computed.cells), membership(before.summary.cells), 'Watched ground membership preserved by ordinary reload');
  }
  if (local) { await checkFile(safe(root, stage.file), stage.sha256); assert.equal((await readFile(safe(root, stage.file))).length, stage.bytes); }
  stages.set(stage.id, stage);
}
for (const role of ['baseline', 'planned', 'built', 'three_stacks', 'packed', 'reinstalled', 'reloaded']) assert.ok(e.saves.some(s => s.role === role), `Retained ${role} stage`);
const comparisonResults = [];
for (const c of e.comparisons) {
  const from = stages.get(c.from), to = stages.get(c.to); assert.ok(from && to); assert.ok(c.explanation?.length > 20);
  if (c.type === 'resource_delta') {
    const deltas = {};
    for (const [def, delta] of Object.entries(c.expected)) {
      assert.ok(e.targets.tracked_defs.includes(def)); assert.ok(Number.isInteger(delta));
      deltas[def] = to.summary.totals[def] - from.summary.totals[def]; assert.equal(deltas[def], delta);
    }
    comparisonResults.push({ from: c.from, to: c.to, deltas });
  } else if (c.type === 'inner_identity') {
    const a = from.summary.shelves.find(s => s.id === e.targets.target_shelf_id), b = to.summary.shelves.find(s => s.id === e.targets.target_shelf_id);
    assert.ok(a && b);
    for (const key of ['id', 'def', 'stuff', 'health', 'quality', 'storage_group', 'settings_xml', 'settings_sha256']) assert.deepEqual(a[key], b[key], key);
    comparisonResults.push({ from: c.from, to: c.to, retained_inner_id: b.id });
  } else if (c.type === 'batch_identity') {
    assert.ok(c.ids?.length); unique(c.ids);
    for (const id of c.ids) {
      const a = from.summary.batches.find(b => b.id === id), b = to.summary.batches.find(b => b.id === id); assert.ok(a && b);
      for (const key of ['id', 'def', 'amount']) assert.equal(a[key], b[key], `Retained batch ${id}: ${key}`);
    }
    comparisonResults.push({ from: c.from, to: c.to, retained_batches: c.ids });
  } else assert.fail(`Unknown comparison: ${c.type}`);
}
unique(e.actions.map(a => a.image_name));
for (const [i, a] of e.actions.entries()) {
  hex(a.source_sha256); hex(a.image_sha256); safe(root, a.source_file); assert.equal(a.pid, e.launch.pid);
  assert.ok(Date.parse(a.finished_utc) >= Date.parse(a.started_utc));
  if (i) assert.ok(Date.parse(a.started_utc) >= Date.parse(e.actions[i - 1].finished_utc));
  if (a.action === 'pulse') { assert.ok([49, 50, 51].includes(a.virtual_key)); assert.ok(a.duration_ms >= 40 && a.duration_ms <= 4000); }
  if (local) {
    await checkFile(safe(root, a.source_file), a.source_sha256);
    await checkFile(resolve(dirname(safe(root, a.source_file)), a.image_name), a.image_sha256);
    const original = (await readFile(safe(root, a.source_file), 'utf8')).trim().split(/\r?\n/).map(l => JSON.parse(l.replace(/^\uFEFF/, ''))).find(r => basename(r.image) === a.image_name); assert.ok(original);
    for (const key of ['started_utc', 'finished_utc', 'run_start_utc', 'target_click_start_utc', 'pause_start_utc']) assert.equal(original[key] == null ? null : Date.parse(original[key]), a[key] == null ? null : Date.parse(a[key]));
    for (const key of ['pid', 'action', 'x', 'y', 'end_x', 'end_y', 'text', 'virtual_key', 'control', 'duration_ms', 'wheel_delta', 'wait_ms', 'park_x', 'park_y']) assert.deepEqual(original[key], a[key]);
  }
}
assert.ok(e.images.length > 0); unique(e.images.map(i => i.id));
for (const im of e.images) {
  const file = safe(base, im.file); await checkFile(file, im.sha256); const png = await readFile(file);
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a'); assert.equal(png.readUInt32BE(16), im.crop[2]); assert.equal(png.readUInt32BE(20), im.crop[3]);
  assert.ok(im.crop.length === 4 && im.crop.every(Number.isInteger) && im.crop[0] >= 0 && im.crop[1] >= 0 && im.crop[2] > 0 && im.crop[3] > 0);
  assert.ok(im.crop[0] + im.crop[2] <= im.source_dimensions[0] && im.crop[1] + im.crop[3] <= im.source_dimensions[1]);
  assert.equal(e.actions.find(a => a.image_name === basename(im.source_file))?.image_sha256, im.source_sha256);
  if (local) await checkFile(safe(root, im.source_file), im.source_sha256);
}
assert.deepEqual(e.shutdown.rimworld_processes_after_exit, []); assert.deepEqual(e.shutdown.record.remainingRimWorldProcesses, []);
assert.equal(e.shutdown.record.processId, e.launch.pid); assert.equal(e.shutdown.record.targetProcessAbsent, true); assert.equal(e.shutdown.record.terminationUsed, false);
assert.ok(e.observations.length > 0 && e.limitations.length > 0);
const references = new Set([...e.saves.map(s => s.id), ...e.images.map(i => i.id), 'actions', 'shutdown']);
for (const observation of e.observations) { assert.ok(observation.finding.length > 20); for (const ref of observation.evidence) assert.ok(references.has(ref), ref); }
let originalsChecked = 0;
if (local) {
  await checkFile(resolve(game, 'Assembly-CSharp.dll'), e.launch.assembly_sha256);
  for (const [file, expected] of [[e.launch.baseline_source, e.launch.baseline_source_sha256], [e.launch.record_file, e.launch.record_sha256], [e.shutdown.record_file, e.shutdown.record_sha256], [e.launch.profile + '/Config/ModsConfig.xml', e.launch.mods_sha256]]) await checkFile(safe(root, file), expected);
  const launch = await json(safe(root, e.launch.record_file)); assert.equal(launch.pid, e.launch.pid); assert.equal(launch.baseline_sha256, e.launch.baseline_source_sha256);
  assert.equal(launch.assembly_sha256, e.launch.assembly_sha256); assert.equal(launch.prefs_sha256, e.launch.prefs_sha256);
  assert.deepEqual(await json(safe(root, e.shutdown.record_file)), e.shutdown.record);
  const quote = s => `'${s.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference='Stop'
$root=${quote(root)}
$e=Get-Content -LiteralPath (Join-Path $root 'docs/research/rimworld/evidence/native-shelves-runtime.json') -Raw|ConvertFrom-Json
$count=0
foreach($s in $e.saves){
 $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
 $reader=[Xml.XmlReader]::Create((Join-Path $root $s.file),$settings)
 $doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;try{$doc.Load($reader)}finally{$reader.Dispose()}
 foreach($p in $s.projections){
  $nodes=$doc.SelectNodes($p.xpath);if($nodes.Count -ne $p.count){throw 'Original XPath count mismatch'}
  for($i=0;$i -lt $nodes.Count;$i++){
   $n=$nodes[$i]
   if($p.fields.Count){$copy=$n.CloneNode($false);foreach($child in $n.ChildNodes){if($child.LocalName -in $p.fields){[void]$copy.AppendChild($child.CloneNode($true))}};$actual=$copy.OuterXml}else{$actual=$n.OuterXml}
   if($actual -cne $p.nodes[$i]){throw ('Original projection mismatch: '+$p.role)};$count++
  }
 }
}
Add-Type -AssemblyName System.Drawing
foreach($im in $e.images){
 $bitmap=[Drawing.Bitmap]::new((Join-Path $root $im.source_file))
 try{
  if($bitmap.Width -ne $im.source_dimensions[0] -or $bitmap.Height -ne $im.source_dimensions[1]){throw 'Original screenshot dimensions mismatch'}
  $r=$im.crop;$crop=$bitmap.Clone([Drawing.Rectangle]::new([int]$r[0],[int]$r[1],[int]$r[2],[int]$r[3]),$bitmap.PixelFormat)
  try{
   $stream=[IO.MemoryStream]::new()
   try{
    $crop.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
    $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream.ToArray())).ToLowerInvariant()
    if($digest -cne $im.sha256){throw 'Screenshot crop is not the recorded rectangle of the original'}
   }finally{$stream.Dispose()}
  }finally{$crop.Dispose()}
 }finally{$bitmap.Dispose()}
}
if(@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe' OR Name='RimWorldWin64.exe'").Count){throw 'RimWorld currently running'}
Write-Output $count`;
  originalsChecked = Number(execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).trim());
  assert.equal(originalsChecked, projectionCount);
}
console.log(JSON.stringify({ mode: local ? 'local-artifact-integrity' : 'portable-record-integrity', saves: e.saves.length, actions: e.actions.length, crops: e.images.length,
  checked_file_hashes: filesChecked.size, recomputed_xml_nodes: projectionCount, original_xml_nodes_checked: originalsChecked,
  stages: e.saves.map(s => ({ id: s.id, tick: s.tick, totals: s.summary.totals, shelves: s.summary.shelves.map(v => ({ id: v.id, location: v.location, pos: v.pos })),
    watched_cells: s.summary.cells.map(c => ({ pos: c.pos, tracked_stacks: c.tracked_stacks })) })), comparisons: comparisonResults,
  scope: 'Retained native snapshots and UI records only; no replay, timing calibration, or assertion of whole-run conservation where ordinary eating or construction changed quantities.' }, null, 2));
