import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const patient = (s) => s.pawns.find((p) => p.id === 'Human958');
const item = (s, id) => s.apparel.find((a) => a.id === id);
const same = (a, b, keys) => keys.forEach((k) => assert.deepEqual(a[k], b[k], k));
const stateKeys = ['tick', 'pawns', 'apparel', 'medicines', 'beds'];
// Retained evidence validation only; no game execution, input or OCR.
export function verifyNativeArmorRuntime({ root = projectRoot, local = false } = {}) {
  const dir = path.join(root, 'docs/research/rimworld/evidence');
  const r = JSON.parse(readFileSync(path.join(dir, 'native-armor-runtime.json'), 'utf8'));
  assert.equal(r.schema_version, 1);
  assert.equal(r.evidence_id, 'RW17-NATIVE-ARMOR-RUNTIME');
  assert.equal(r.version_text, '1.7.4980 rev60');
  assert.equal(r.assembly_sha256, 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
  assert.equal(r.process_id, 29920);
  assert.equal(r.window_handle, 988850);
  assert.equal(r.profile, '.local-research/runtime/profile-20261102');
  assert.deepEqual(r.active_mods, ['ludeon.rimworld', 'ludeon.rimworld.odyssey']);
  assert(r.method.includes('not REA native UI execution'));
  assert.equal(r.provider_boundary_reference, 'native-plants-runtime.json');
  assert.equal(r.body_identity_reference, 'anatomy-human.json');
  assert.equal(r.static_armor_reference, 'armor-manifest.json');
  const body = JSON.parse(readFileSync(path.join(dir, r.body_identity_reference), 'utf8'));
  for (const [i, id] of [[0, 'torso'], [13, 'head'], [49, 'left-foot']])
    assert.equal(body.nodes.find((n) => n.index === i).id, id);
  const names = ['anatomy-stopped-b', 'armor-entry-a', 'armor-entry-b', 'armor-bare-head-hit', 'armor-helmet-material-prepared', 'armor-helmet-wear-ordered', 'armor-helmet-worn', 'armor-plate-wear-ordered', 'armor-plate-worn', 'armor-head-hit-1', 'armor-head-hit-2', 'armor-torso-hit', 'armor-foot-hit', 'armor-stopped-a', 'armor-stopped-b', 'armor-final-paused-a', 'armor-final-paused-b'];
  assert.deepEqual(r.snapshots.map((s) => s.name), names);
  assert.equal(sha(JSON.stringify(r.snapshots)), '8a7e29fc89fae3514953312033e675b502fda3c1fd7101d1f920e03916e35ae5');
  const saves = Object.fromEntries(r.snapshots.map((x) => [x.name, x.save]));
  const get = (name) => saves[name];
  const base = get(names[0]), entry = get('armor-entry-b'), end = get('armor-foot-hit');
  same(base, get('armor-entry-a'), stateKeys);
  same(base, entry, stateKeys);
  const helmetId = 'Apparel_SimpleHelmet78149', plateId = 'Apparel_PlateArmor78159';
  const awful = item(get('armor-helmet-material-prepared'), helmetId);
  assert.equal(awful.stuff, 'Steel');
  assert.equal(awful.quality_present, false);
  assert.equal(awful.quality, '');
  assert.equal(awful.quality_if_known, 'Awful');
  assert.equal(awful.health.value, 100);
  assert.equal(awful.worn, false);
  for (const [orderedName, wornName, id] of [['armor-helmet-wear-ordered', 'armor-helmet-worn', helmetId], ['armor-plate-wear-ordered', 'armor-plate-worn', plateId]]) {
    const ordered = get(orderedName), worn = get(wornName);
    assert.equal(patient(ordered).job.def, 'Wear');
    assert.equal(patient(ordered).job.target_a, 'Thing_' + id);
    assert.equal(patient(ordered).job.player_forced, true);
    assert.equal(item(ordered, id).worn, false);
    assert.equal(item(worn, id).worn, true);
    assert.equal(item(worn, id).owner, 'Human958');
    assert.equal(item(worn, id).stuff, 'Steel');
    assert.equal(item(worn, id).quality_if_known, 'Normal');
    assert(worn.tick > ordered.tick);
  }
  assert.equal(item(get('armor-helmet-worn'), 'Apparel_SimpleHelmet78148').worn, false);
  assert.equal(item(get('armor-helmet-worn'), 'Apparel_SimpleHelmet78148').health.value, 280);
  assert.deepEqual(patient(get('armor-plate-worn')).worn_apparel_ids, ['Apparel_BasicShirt959', 'Apparel_Pants960', plateId, helmetId]);
  assert.equal(r.damage_tool.uses_take_damage, true);
  assert.equal(r.damage_tool.amount, 5);
  assert.equal(r.damage_tool.armor_penetration, 0);
  assert.equal(r.damage_tool.damage_def, 'Bullet');
  assert.equal(r.damage_tool.natural_projectile, false);
  assert.equal(r.damage_tool.destroy_part_option, false);
  assert.equal(r.observations.length, 5);
  const expected = [[111, 13, 'Gunshot', 5], [112, 13, 'Gunshot', 5], [113, 13, 'Gunshot', 5], [114, 0, 'Bruise', 3], [115, 49, 'Gunshot', 5]];
  for (const [i, o] of r.observations.entries()) {
    const before = get(o.before), after = get(o.stage);
    assert.equal(before.tick, after.tick);
    assert.equal(after.tick, o.tick);
    assert.deepEqual([o.new_hediff_id, o.index, o.new_hediff_def, o.new_severity], expected[i]);
    const old = patient(before).hediffs, now = patient(after).hediffs;
    const added = now.filter((h) => !old.some((x) => x.id === h.id));
    assert.equal(added.length, 1);
    const h = added[0];
    assert.deepEqual([h.id, h.part_index.value, h.def, h.severity.value], expected[i]);
    assert.equal(h.tick_added.value, after.tick);
    assert.equal(h.class, 'Hediff_Injury');
    assert.deepEqual(now.filter((h) => old.some((x) => x.id === h.id)), old);
    for (const [key, id] of [['helmet', helmetId], ['plate', plateId], ['shirt', 'Apparel_BasicShirt959'], ['pants', 'Apparel_Pants960']]) {
      assert.equal(item(before, id)?.health.value ?? null, o[key + '_hp_before']);
      assert.equal(item(after, id)?.health.value ?? null, o[key + '_hp_after']);
    }
  }
  assert.equal(patient(get('armor-plate-worn')).hediffs.find((h) => h.id === 111).severity.value, 4.28000069);
  assert.equal(end.tick, 101859);
  assert.equal(r.clock.controlled_advanced_ticks, 3539);
  assert.equal(r.clock.unintended_cleanup_run.advanced_ticks, 41779);
  assert.equal(r.clock.unintended_cleanup_run.excluded_from_armor_experiment, true);
  assert.equal(get('armor-stopped-a').tick, 102377);
  assert.equal(get('armor-stopped-b').tick, 102905);
  assert.notEqual(get('armor-stopped-a').tick, get('armor-stopped-b').tick);
  const finalA = get('armor-final-paused-a'), finalB = get('armor-final-paused-b');
  assert.equal(finalB.tick, 143638);
  same(finalA, finalB, stateKeys);
  assert.equal(finalB.tick - base.tick, 45318);
  for (const p of finalB.pawns) {
    const original = base.pawns.find((x) => x.id === p.id);
    same(original, p, ['work_priority_values', 'medical_care', 'self_tend', 'drafted']);
  }
  const bytes = readFileSync(path.join(dir, r.actions.file));
  assert.equal(sha(bytes), r.actions.sha256);
  const actions = bytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(actions.length, 245);
  assert.equal(r.actions.count, actions.length);
  for (const [i, a] of actions.entries()) {
    assert.equal(a.kind, 'guarded-ui-input');
    assert.equal(a.data.pid, 29920);
    assert(a.data.profile.replaceAll('\\', '/').endsWith(r.profile));
    assert(['capture','click','doubleclick','rightclick','text','key','hold','scroll'].includes(a.data.action));
    assert(Date.parse(a.data.finished_utc) >= Date.parse(a.data.started_utc));
    if(i) assert(Date.parse(a.data.started_utc) >= Date.parse(actions[i-1].data.started_utc));
  }
  assert.equal(actions.filter((a) => a.data.action === 'key' && a.data.virtual_key === 51).length, 2);
  assert.equal(actions.filter((a) => a.data.action === 'key' && a.data.virtual_key === 32).length, 0);
  for (const w of r.clock.controlled_run_windows) {
    const a=actions.find((x)=>x.data.image.endsWith(w.start_image)).data;
    const b=actions.find((x)=>x.data.image.endsWith(w.pause_image)).data;
    assert.equal(a.virtual_key, 51); assert.equal(a.wait_ms,w.requested_capture_wait_ms);
    assert.deepEqual([b.x,b.y],[2441,1305]);
    assert.equal(a.started_utc,w.input_start_utc);assert.equal(b.started_utc,w.pause_input_start_utc);
    assert(Date.parse(b.started_utc)-Date.parse(a.started_utc)<12000);
  }
  assert(actions.at(-1).data.image.endsWith('armor-final-paused-b-return.png'));
  assert.equal(r.clock.last_input_finished_utc, actions.at(-1).data.finished_utc);
  assert.equal(r.screenshots.length, 16);
  for(const s of r.screenshots){
    const data=readFileSync(path.join(dir,s.image));assert.equal(sha(data),s.sha256);
    assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const [x,y,w,h]=s.crop_xywh;assert(x>=0&&y>=0&&w>0&&h>0&&x+w<=2560&&y+h<=1440);
    assert.deepEqual([data.readUInt32BE(16),data.readUInt32BE(20)],[w,h]);
    assert(actions.some((a)=>a.data.image.replaceAll('\\','/').endsWith('/'+s.source_file)));
    if(local){
      const original=readFileSync(path.join(root,s.source_file));assert.equal(sha(original),s.source_sha256);
      const meta=JSON.parse(readFileSync(path.join(root,s.source_file+'.jsonl'),'utf8').trim().split(/\r?\n/).at(-1));
      assert.equal(meta.pid,29920);assert.equal(Date.parse(meta.timestamp_utc),Date.parse(s.observed_utc));
    }
  }
  for(const k of ['paused','pause_confirmed_by_two_equal_saves','baseline_untouched','developer_mode','work_assignments_equal_baseline','medical_care_equal_baseline','input_released','unintended_cleanup_run_disclosed']) assert.equal(r.final_state[k],true);
  for(const k of ['god_mode','normal_profile_touched','game_files_modified','mods_installed']) assert.equal(r.final_state[k],false);
  assert.equal(r.final_state.canonical_save,'armor-final-paused-b.rws');
  assert.equal(r.final_state.controlled_results_save,'armor-foot-hit.rws');
  if(local){
    for(const s of r.sources) assert.equal(sha(readFileSync(path.join(root,s.path))),s.sha256);
    for(const x of r.snapshots){
      const file=path.join(root,x.path);assert.equal(sha(readFileSync(file)),x.save.sha256);
      const output=execFileSync('pwsh',['-NoProfile','-File',path.join(root,'scripts/research/read-armor-runtime-save.ps1'),'-SavePath',file],{encoding:'utf8',maxBuffer:4*1024*1024});
      assert.deepEqual(JSON.parse(output.replace(/^\uFEFF/,'')),x.save);
    }
  }
  return {ok:true,mode:local?'local-original-saves-and-captures':'portable-recorded-summary',saveSnapshots:17,crops:16,actions:245,realTakeDamageHits:5,coveredHeadHits:2,sharpToBluntTorsoObserved:true,uncoveredFootObserved:true,deflectionObserved:false,controlledRunWindows:2,controlledAdvancedTicks:3539,unintendedCleanupTicks:41779,finalPauseVerified:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyNativeArmorRuntime({local:process.argv.includes('--local')})));
