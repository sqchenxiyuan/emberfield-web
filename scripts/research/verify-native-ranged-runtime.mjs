import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tag = (xml, name) => xml?.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? null;
const num = (xml, name) => tag(xml, name) === null ? null : Number(tag(xml, name));
const stateKeys = ['tick', 'tick_manager_raw', 'pawns', 'weapons', 'projectiles', 'battle_entries', 'cover'];
const sameState = (a, b) => stateKeys.forEach((k) => assert.deepEqual(a[k], b[k], k));
const pawn = (s, id = 'Human965') => s.pawns.find((x) => x.id === id);
const weapon = (s, id) => s.weapons.find((x) => x.id === id);
const shotVerb = (s, id) => weapon(s, id).verbs.find((x) => x.class === 'Verb_Shoot');
const target = (s) => pawn(s, 'Muffalo78311');
const shooting = (s) => pawn(s).skills.find((x) => x.def === 'Shooting');
const revolverId = 'Gun_Revolver38569', machineId = 'Gun_MachinePistol78310';

// Retained original-game evidence only. Does not replay inputs, use OCR or run a hit model.
export function verifyNativeRangedRuntime({ root = projectRoot, local = false } = {}) {
  const dir = path.join(root, 'docs/research/rimworld/evidence');
  const r = JSON.parse(readFileSync(path.join(dir, 'native-ranged-runtime.json'), 'utf8'));
  assert.equal(r.evidence_id, 'RW17-NATIVE-RANGED-RUNTIME');
  assert.equal(r.version_text, '1.7.4980 rev60');
  assert.equal(r.assembly_sha256, 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
  assert.equal(r.process_id, 29920); assert.equal(r.window_handle, 988850);
  assert.equal(r.profile, '.local-research/runtime/profile-20261102');
  assert.deepEqual(r.active_mods, ['ludeon.rimworld', 'ludeon.rimworld.odyssey']);
  assert(r.method.includes('not REA native UI execution'));
  assert.equal(r.provider_boundary_reference, 'native-plants-runtime.json');
  const body = JSON.parse(readFileSync(path.join(dir, r.body_identity_reference), 'utf8'));
  assert.equal(body.nodes.find((n) => n.index === 12).id, 'neck');
  assert.equal(r.snapshots.length, 37);
  const saves = Object.fromEntries(r.snapshots.map((x) => [x.name, x.save]));
  assert.equal(Object.keys(saves).length, 37);
  const get = (name) => { assert(saves[name], name); return saves[name]; };
  const base = get('armor-final-paused-b'), end = get('ranged-machine-impacts-b');
  const final = get('ranged-final-paused-b');
  assert.equal(base.sha256, '6be73350fb5164652f5c66833bc0f5e785dbeb342bc2b6497ce6e6e1f3c848f3');
  assert.equal(final.sha256, 'd6e545ae79cc6a360ee895224ccfa27730cab7e77f793072436290077a8bdb18');
  sameState(base, get('ranged-entry-a')); sameState(base, get('ranged-entry-b'));
  assert.equal(r.clock.equal_pause_pairs.length, 15);
  for (const p of r.clock.equal_pause_pairs) sameState(get(p.a), get(p.b));
  for (const { save: s } of r.snapshots) {
    assert.equal(s.version, r.version_text); assert.deepEqual(s.mods, r.active_mods);
    assert.equal(num(s.tick_manager_raw, 'ticksGame'), s.tick);
    assert.equal(num(s.tick_manager_raw, 'gameStartAbsTick'), 70000);
    assert.match(s.sha256, /^[a-f0-9]{64}$/); assert(s.bytes > 100000);
    for (const p of s.pawns) for (const h of p.hediffs) {
      assert.equal(num(h.raw, 'loadID'), h.id);
      assert.equal(tag(h.raw, 'def'), h.def);
      assert.equal(num(h.raw, 'severity'), h.severity.value);
      assert.equal(num(h.raw, 'tickAdded'), h.tick_added.value);
      assert.equal(num(h.raw, 'index'), h.part_index.value);
    }
    for (const w of s.weapons) {
      assert.equal(tag(w.raw, 'id'), w.id); assert.equal(tag(w.raw, 'def'), w.def);
      assert.equal(num(w.raw, 'health'), w.hp.value);
      for (const v of w.verbs) {
        assert.equal(num(v.raw, 'lastShotTick'), v.last_shot_tick.value);
        assert.equal(num(v.raw, 'burstShotsLeft'), v.burst_shots_left.value);
        assert.equal(num(v.raw, 'ticksToNextBurstShot'), v.ticks_to_next_burst_shot.value);
      }
    }
    for (const p of s.projectiles) { assert.equal(tag(p.raw, 'id'), p.id); assert.equal(tag(p.raw, 'def'), p.def); }
    for (const e of s.battle_entries) {
      assert.equal(num(e.raw, 'logID'), e.id); assert.equal(num(e.raw, 'ticksAbs'), e.ticks_abs.value);
    }
    for (const p of s.pawns.filter((x) => x.def === 'Human')) {
      const original = pawn(base, p.id); assert(original);
      for (const k of ['medical_care', 'self_tend', 'work_priorities']) assert.deepEqual(p[k], original[k]);
    }
  }
  assert.equal(shooting(base).level.value, 10); assert.equal(shooting(base).passion, 'Major');
  assert.equal(shooting(final).level.value, 10);
  assert.equal(shooting(base).xp_since_level.value, -71.8994751);
  assert.equal(shooting(final).xp_since_level.value, 33.700531);
  assert.equal(pawn(base).hediffs.length, 1); assert.equal(pawn(final).hediffs.length, 1);
  for (const s of [base, end, final]) {
    const h = pawn(s).hediffs[0];
    assert.deepEqual([h.id, h.def, h.part_index.value, h.severity.value, h.permanent.value], [16, 'Bite', 12, 6, true]);
    assert.deepEqual(pawn(s).apparel, pawn(base).apparel);
  }
  assert.deepEqual(pawn(base).equipment_ids, []);
  for (const name of ['ranged-revolver-equipped-b','ranged-revolver-ready-b']) assert.deepEqual(pawn(get(name)).equipment_ids, []);
  assert.deepEqual(pawn(get('ranged-revolver-held-b')).equipment_ids, [revolverId]);
  for (const name of ['ranged-machine-held-b','ranged-machine-ready-b']) assert.deepEqual(pawn(get(name)).equipment_ids, [revolverId]);
  assert.deepEqual(pawn(get('ranged-machine-equipped-b')).equipment_ids, [machineId]);
  assert.equal(weapon(get('ranged-revolver-held-b'), revolverId).owner, 'Human965');
  assert.equal(weapon(get('ranged-machine-equipped-b'), machineId).owner, 'Human965');
  assert.equal(weapon(final, revolverId).hp.value, 95); assert.equal(weapon(final, machineId).hp.value, 100);
  for (const id of [revolverId, machineId, 'Bow_Short78309']) assert.equal(weapon(final, id).quality, 'Normal');
  assert.deepEqual(target(get('ranged-prepared')).hediffs, []);
  assert.equal(target(get('ranged-prepared')).pos, '(124, 0, 114)');
  for (const [name, id, tick] of [['ranged-revolver-ordered', revolverId, 144138], ['ranged-machine-ordered', machineId, 144346]]) {
    const s = get(name); assert.equal(s.tick, tick);
    const j = pawn(s).job; assert.equal(tag(j, 'def'), 'AttackStatic');
    assert.equal(tag(j, 'targetA'), 'Thing_Muffalo78311'); assert.equal(tag(j, 'playerForced'), 'True');
    assert.equal(tag(j, 'verbToUse'), `Verb_CompEquippable_${id}_0`);
    assert.equal(shotVerb(s, id).last_shot_tick.value, -999999);
  }
  for (const [name, started, left, id] of [['ranged-revolver-warmup-b',144141,6,revolverId],['ranged-machine-warmup-b',144348,18,machineId]]) {
    const s = get(name), st = pawn(s).stance;
    assert(st.includes('Class="Stance_Warmup"')); assert.equal(num(st, 'startedTick'), started);
    assert.equal(num(st, 'ticksLeft'), left); assert.equal(shotVerb(s,id).last_shot_tick.value,-999999);
    assert.equal(s.projectiles.length, 0);
  }
  const flight = get('ranged-revolver-flight-b');
  assert.equal(flight.tick, 144170); assert.equal(shotVerb(flight,revolverId).last_shot_tick.value,144159);
  assert.equal(num(pawn(flight).stance,'ticksLeft'),85); assert.equal(num(pawn(flight).stance,'startedTick'),144159);
  assert.deepEqual(target(flight).hediffs, []); assert.equal(flight.projectiles.length, 1);
  const leftBullet = flight.projectiles[0]; assert.equal(leftBullet.id,'Bullet_Revolver78312');
  assert.equal(num(leftBullet.raw,'spawnedTick'),144159); assert.equal(num(leftBullet.raw,'ticksToImpact'),16);
  const burst = get('ranged-machine-burst-b');
  assert.equal(burst.tick,144382);
  const vb = shotVerb(burst,machineId);
  assert.equal(vb.state,'Bursting'); assert.equal(vb.burst_shots_left.value,2);
  assert.equal(vb.ticks_to_next_burst_shot.value,2); assert.equal(vb.last_shot_tick.value,144378);
  assert.equal(burst.projectiles.length,1);
  const follow = get('ranged-machine-burst-follow-b'); assert.equal(follow.tick,144394);
  assert.deepEqual(follow.projectiles.map((p)=>p.id),['Bullet_MachinePistol78317','Bullet_MachinePistol78319','Bullet_MachinePistol78320']);
  const spawned = follow.projectiles.map((p)=>num(p.raw,'spawnedTick'));
  assert.deepEqual(spawned,[144378,144384,144391]);
  assert.deepEqual(spawned.slice(1).map((t,i)=>t-spawned[i]),[6,7]);
  assert.deepEqual(follow.projectiles.map((p)=>num(p.raw,'ticksToImpact')),[1,7,14]);
  assert.equal(num(pawn(follow).stance,'startedTick'),144391); assert.equal(num(pawn(follow).stance,'ticksLeft'),51);
  assert.equal(shotVerb(follow,machineId).last_shot_tick.value,144391);
  for (const p of [leftBullet,...follow.projectiles]) {
    assert.equal(tag(p.raw,'launcher'),'Thing_Human965'); assert.equal(tag(p.raw,'intendedTarget'),'Thing_Muffalo78311');
    assert.equal(tag(p.raw,'usedTarget'),'Thing_Muffalo78311'); assert(tag(p.raw,'origin').includes('8.4126215'));
  }
  const hits = [[143,12,23,144186,44,'Gun_Revolver'],[145,6,25,144395,46,'Gun_MachinePistol'],[146,6,18,144401,47,'Gun_MachinePistol'],[147,6,0,144408,48,'Gun_MachinePistol']];
  assert.equal(end.tick,144413); assert.equal(end.projectiles.length,0); assert.equal(end.battle_entries.length,6);
  for (const [id, damage, part, tick, logId, gun] of hits) {
    const h=target(end).hediffs.find((x)=>x.id===id); assert(h);
    assert.deepEqual([h.def,h.severity.value,h.part_index.value,h.tick_added.value],['Gunshot',damage,part,tick]);
    assert.equal(h.body,'QuadrupedAnimalWithHooves'); assert.equal(h.combat_log_entry,`LogEntry_${tick+70000}_${logId}`);
    assert.equal(tag(h.raw,'source'),gun);
    const log=end.battle_entries.find((e)=>e.id===logId);
    assert.equal(log.class,'BattleLogEntry_RangedImpact'); assert.equal(log.ticks_abs.value,tick+70000);
    assert.equal(tag(log.raw,'weaponDef'),gun); assert.equal(tag(log.raw,'recipientPawn'),'Thing_Muffalo78311');
  }
  const fires=end.battle_entries.filter((e)=>e.class==='BattleLogEntry_RangedFire');
  assert.deepEqual(fires.map((e)=>e.id),[43,45]);
  assert.deepEqual(fires.map((e)=>e.ticks_abs.value),[214159,214378]);
  assert.equal(tag(fires[1].raw,'burst'),'True');
  assert.equal(target(end).hediffs.find((h)=>h.def==='BloodLoss').severity.value,0.00123428577);
  assert(target(get('ranged-machine-ready-b')).mental_state.includes('MentalState_Manhunter'));
  assert(!target(get('ranged-target-calmed')).mental_state.includes('MentalState_Manhunter'));
  assert.deepEqual(target(get('ranged-machine-ready-b')).hediffs,target(get('ranged-target-calmed')).hediffs);
  assert(target(end).mental_state.includes('MentalState_Manhunter'));
  assert(!target(final).mental_state.includes('MentalState_Manhunter'));
  assert.deepEqual(target(end).hediffs,target(final).hediffs);
  assert.equal(tag(pawn(final).job,'def'),'FleeAndCower');
  assert.equal(tag(pawn(final).drafter,'drafted'),null); assert.equal(tag(pawn(final).drafter,'fireAtWill'),null);
  assert.equal(r.clock.entry_tick,143638); assert.equal(r.clock.final_tick,144413);
  assert.equal(r.clock.total_advanced_ticks,final.tick-base.tick);
  assert.equal(r.clock.run_windows.length,13);
  assert.equal(r.clock.run_windows.reduce((sum,w)=>sum+w.advanced_ticks,0),775);
  assert.deepEqual(r.observations.machine.spawned_ticks,spawned);
  assert.deepEqual(r.observations.machine.observed_intervals,[6,7]);
  assert.deepEqual(r.observations.machine.impact_ticks,hits.slice(1).map((h)=>h[3]));
  assert.equal(r.observations.finite_sample.hit_probability_estimated,false);
  assert.equal(r.observations.finite_sample.cover_comparison_performed,false);
  assert.equal(r.observations.finite_sample.short_bow_fired,false);
  for (const k of ['dev_damage','dev_add_hediff','dev_heal','save_xml_edit','natural_crafting','god_mode']) assert.equal(r.preparation[k],false);
  assert.deepEqual(r.preparation.dev_stop_mental_state_ticks,[144319,144413]);
  const actionBytes=readFileSync(path.join(dir,r.actions.file)); assert.equal(sha(actionBytes),r.actions.sha256);
  const actions=actionBytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(actions.length,333); assert.equal(r.actions.count,actions.length);
  for (const [i,a] of actions.entries()) {
    assert.equal(a.kind,'guarded-ui-input'); assert.equal(a.data.pid,29920);
    assert(a.data.profile.replaceAll('\\','/').endsWith(r.profile));
    assert(Date.parse(a.data.finished_utc)>=Date.parse(a.data.started_utc));
    if(i) assert(Date.parse(a.data.started_utc)>=Date.parse(actions[i-1].data.started_utc));
    assert(!/Apply damage|AddHediff|Heal/i.test(a.data.text??''));
    assert(!(a.data.action==='key'&&a.data.virtual_key===32));
    if(local) {
      const records=readFileSync(path.join(root,a.source_ledger),'utf8').trim().split(/\r?\n/).map(JSON.parse);
      assert(records.some((record)=>JSON.stringify(record)===JSON.stringify(a.data)));
    }
  }
  assert.equal(actions.filter((a)=>a.data.action==='pulse').length,13);
  for(const w of r.clock.run_windows) {
    assert.equal(get(w.before).tick,w.before_tick); assert.equal(get(w.after).tick,w.after_tick);
    assert.equal(w.after_tick-w.before_tick,w.advanced_ticks); assert(w.advanced_ticks>0);
    const a=actions.find((x)=>x.data.image.endsWith(w.image)).data; assert.equal(a.action,'pulse');
    assert([49,50,51].includes(a.virtual_key)); assert(a.duration_ms>=40&&a.duration_ms<=4000);
    assert(Date.parse(a.pause_start_utc)>Date.parse(a.run_start_utc));
  }
  assert(actions.at(-1).data.image.endsWith('ranged-final-paused-b-return.png'));
  assert.equal(r.clock.last_input_finished_utc,actions.at(-1).data.finished_utc);
  assert.equal(r.screenshots.length,17);
  for(const s of r.screenshots) {
    const data=readFileSync(path.join(dir,s.image)); assert.equal(sha(data),s.sha256);
    assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const [x,y,w,h]=s.crop_xywh; assert(x>=0&&y>=0&&x+w<=2560&&y+h<=1440);
    assert.deepEqual([data.readUInt32BE(16),data.readUInt32BE(20)],[w,h]);
    assert(actions.some((a)=>a.data.image.replaceAll('\\','/').endsWith('/'+s.source_file)));
    if(local) {
      assert.equal(sha(readFileSync(path.join(root,s.source_file))),s.source_sha256);
      const meta=JSON.parse(readFileSync(path.join(root,s.source_file+'.jsonl'),'utf8').trim().split(/\r?\n/).at(-1));
      assert.equal(meta.pid,29920); assert.equal(Date.parse(meta.timestamp_utc),Date.parse(s.observed_utc));
    }
  }
  for(const s of r.sources) assert.equal(sha(readFileSync(path.join(root,s.file))),s.sha256);
  assert.equal(r.helper_line_ending_normalization.length,1);
  for(const n of r.helper_line_ending_normalization) {
    assert.equal(n.file,'scripts/research/open-ranged-runtime-tool.ps1');
    assert.deepEqual(n.crlf_to_lf_lines,[14]);
    assert.equal(n.before_sha256,'921121d83a2a22338db56d8424dce9609a3070e70ec5401b403201d8d1e07531');
    assert.equal(n.after_sha256,'fc8e004b5b2ee4381945ea23f44b910083a9bd5a635d4ecf01403f6d23402e8b');
    const bytes=readFileSync(path.join(root,n.file)); assert.equal(sha(bytes),n.after_sha256);
    const lines=bytes.toString('utf8').split('\n'); assert(!bytes.includes(13));
    for(const line of n.crlf_to_lf_lines) { assert(line>0&&line<lines.length); lines[line-1]+='\r'; }
    assert.equal(sha(lines.join('\n')),n.before_sha256,'recorded pre-normalization helper bytes');
    assert.equal(r.sources.find((s)=>s.file===n.file).sha256,n.after_sha256);
  }
  for(const k of ['paused','equal_double_save','fire_at_will_restored','target_manhunter_ended_by_dev','baseline_untouched','input_released']) assert.equal(r.final_state[k],true);
  for(const k of ['drafted','normal_profile_touched','game_files_modified']) assert.equal(r.final_state[k],false);
  if(local) for(const x of r.snapshots) {
    const file=path.join(root,x.path); assert.equal(sha(readFileSync(file)),x.save.sha256);
    const output=execFileSync('pwsh',['-NoProfile','-File',path.join(root,'scripts/research/read-ranged-runtime-save.ps1'),'-SavePath',file],{encoding:'utf8',maxBuffer:4*1024*1024});
    assert.deepEqual(JSON.parse(output.replace(/^\uFEFF/,'')),x.save);
  }
  return {ok:true,mode:local?'local-original-saves-and-captures':'portable-recorded-summary',saveSnapshots:37,crops:17,actions:333,equalPausePairs:15,controlledRunWindows:13,advancedTicks:775,ordinaryProjectileShots:4,newGunshots:4,machineBurstIntervals:[6,7],probabilityEstimated:false,finalPauseVerified:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify(verifyNativeRangedRuntime({local:process.argv.includes('--local')})));
