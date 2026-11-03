import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const tag=(xml,name)=>xml?.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]??null;
const value=(xml,name)=>tag(xml,name)===null?null:Number(tag(xml,name));
const patient=(s)=>s.pawns.find((p)=>p.id==='Human958');
const doctor=(s)=>s.pawns.find((p)=>p.id==='Human965');
const condition=(s,id)=>patient(s).hediffs.find((h)=>h.id===id);
const immunity=(s)=>value(patient(s).immunity,'immunity');
const herbal=(s)=>s.medicines.filter((m)=>m.def==='MedicineHerbal').reduce((n,m)=>n+(m.stack_count.present?m.stack_count.value:1),0);
const stateKeys=['tick','tick_manager_raw','pawns','medicines','beds'];
const sameState=(a,b)=>stateKeys.forEach((k)=>assert.deepEqual(a[k],b[k],k));

// Recorded evidence checks only. No input, OCR, target execution or treatment model.
export function verifyNativeMedicineRuntime({root=projectRoot,local=false}={}) {
  const dir=path.join(root,'docs/research/rimworld/evidence');
  const r=JSON.parse(readFileSync(path.join(dir,'native-medicine-runtime.json'),'utf8'));
  assert.equal(r.evidence_id,'RW17-NATIVE-MEDICINE-RUNTIME');
  assert.equal(r.version_text,'1.7.4980 rev60');
  assert.equal(r.assembly_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
  assert.equal(r.process_id,29920);assert.equal(r.window_handle,988850);
  assert.equal(r.profile,'.local-research/runtime/profile-20261102');
  assert.deepEqual(r.active_mods,['ludeon.rimworld','ludeon.rimworld.odyssey']);
  assert(r.method.includes('Not REA native UI provider execution'));
  const saves=Object.fromEntries(r.snapshots.map((x)=>[x.name,x.save]));
  assert.equal(Object.keys(saves).length,r.snapshots.length);
  assert.equal(r.snapshots.length,65);assert.equal(r.clock.equal_pause_pairs.length,31);
  const get=(name)=>{assert(saves[name],name);return saves[name];};
  const base=get('ranged-final-paused-b'),entry=get('medicine-entry-b'),final=get('medicine-final-paused-b');
  assert.equal(base.sha256,'d6e545ae79cc6a360ee895224ccfa27730cab7e77f793072436290077a8bdb18');
  sameState(base,entry);sameState(entry,get('medicine-entry-a'));
  for(const pair of r.clock.equal_pause_pairs) sameState(get(pair.a),get(pair.b));
  for(const {save:s} of r.snapshots) {
    assert.equal(s.version,r.version_text);assert.deepEqual(s.mods,r.active_mods);
    assert.equal(value(s.tick_manager_raw,'ticksGame'),s.tick);
    assert(s.tick>=144413&&s.tick<=179408);
    assert.equal(doctor(s).work_priorities,doctor(base).work_priorities);
    assert.equal(doctor(s).medical_care,'NoMeds');
    for(const [id,count] of [['MedicineIndustrial38566',5],['MedicineIndustrial41861',25],['MedicineUltratech38348',4]]){
      const m=s.medicines.find((item)=>item.id===id);assert(m,id);
      assert.equal(m.stack_count.value,count);assert.equal(m.forbidden.value,true);
    }
    for(const p of s.pawns) {
      assert(p.health_tracker.includes(p.immunity));
      for(const h of p.hediffs) {
        assert(p.health_tracker.includes(h.raw));assert.equal(value(h.raw,'loadID'),h.id);
        assert.equal(tag(h.raw,'def'),h.def);
        for(const [key,xml] of [['severity','severity'],['tick_added','tickAdded'],['age_ticks','ageTicks'],['part_index','index'],['tend_ticks_left','tendTicksLeft'],['tend_quality','tendQuality'],['total_tend_quality','totalTendQuality'],['ticks_until_infect','ticksUntilInfect'],['infection_chance_factor','infectionChanceFactor']]) {
          assert.equal(h[key].value,value(h.raw,xml));assert.equal(h[key].present,tag(h.raw,xml)!==null);
        }
      }
    }
    for(const m of s.medicines){assert.equal(tag(m.raw,'id'),m.id);assert.equal(value(m.raw,'stackCount'),m.stack_count.value);}
  }
  const ordered=get('medicine-herbal-ordered-b'),carry=get('medicine-herbal-carry-b'),bedside=get('medicine-herbal-bedside-b'),tended=get('medicine-herbal-tending-b');
  assert.equal(ordered.tick,144413);assert.equal(herbal(entry),0);assert.equal(herbal(ordered),4);
  assert.equal(patient(entry).medical_care,'Best');assert.equal(patient(ordered).medical_care,'HerbalOrWorse');
  assert.equal(tag(doctor(ordered).job,'def'),'TendPatient');assert.equal(tag(doctor(ordered).job,'targetB'),'Thing_MedicineHerbal78321');
  assert.equal(tag(doctor(ordered).job_driver,'usesMedicine'),'True');
  assert.equal(condition(ordered,148).severity.value,.5);assert.equal(condition(ordered,148).part_index.value,0);
  assert.equal(carry.tick,144518);assert.equal(herbal(carry),4);
  assert.equal(carry.medicines.find((m)=>m.id==='MedicineHerbal78321').stack_count.value,2);
  assert.equal(carry.medicines.find((m)=>m.id==='MedicineHerbal78327').owner,'Human965');
  assert(doctor(carry).carry.includes('MedicineHerbal78327'));
  assert.equal(bedside.tick,144687);assert.equal(doctor(bedside).pos,'(112, 0, 124)');
  assert.equal(value(doctor(bedside).job_driver,'curToilIndex'),13);assert.equal(value(doctor(bedside).job_driver,'ticksLeftThisToil'),960);
  assert.equal(tended.tick,146173);assert.equal(herbal(tended),3);
  assert(!tended.medicines.some((m)=>m.id==='MedicineHerbal78327'));
  assert.equal(condition(tended,148).tend_quality.value,.334181815);assert.equal(condition(tended,148).tend_ticks_left.value,1);
  assert.equal(condition(tended,148).severity.value,.5);
  const prepared=get('medicine-infection-prepared-b'),first=get('medicine-infection-first-tend-b');
  assert.equal(prepared.tick,146173);assert.equal(condition(prepared,151).def,'WoundInfection');
  assert.equal(condition(prepared,151).severity.value,.00100000005);assert.equal(immunity(prepared),null);
  assert.equal(first.tick,147663);assert.equal(condition(first,151).tend_quality.value,.464708388);
  assert.equal(condition(first,151).tend_ticks_left.value,37403);assert.equal(immunity(first),.0156398825);assert.equal(herbal(first),2);
  assert.equal(tag(patient(first).immunity,'hediffDef'),'WoundInfection');assert.equal(tag(patient(first).immunity,'source'),'WoundInfection');
  let previous=first;
  const progress=r.snapshots.filter((x)=>/^medicine-infection-progress-\d+-b$/.test(x.name)).sort((a,b)=>a.name.localeCompare(b.name));
  assert.equal(progress.length,20);
  for(const x of progress) {
    const now=x.save;assert(now.tick>previous.tick);
    assert.equal(condition(now,151).tend_ticks_left.value,condition(previous,151).tend_ticks_left.value-(now.tick-previous.tick));
    assert.equal(condition(now,151).tend_quality.value,.464708388);
    assert(condition(now,151).severity.value>condition(previous,151).severity.value);
    assert(immunity(now)>immunity(previous));assert.equal(herbal(now),2);previous=now;
  }
  const eligible=get('medicine-infection-retend-eligible-b'),reordered=get('medicine-infection-retend-ordered');
  const working=get('medicine-infection-retend-working-b'),done=get('medicine-infection-retend-done-b');
  assert.equal(previous.tick,177073);assert.equal(condition(previous,151).tend_ticks_left.value,7993);
  assert.equal(eligible.tick,177692);assert.equal(condition(eligible,151).tend_ticks_left.value,7374);
  assert.equal(condition(eligible,151).tend_quality.value,.464708388);
  assert.equal(condition(eligible,151).severity.value,.319431186);assert.equal(immunity(eligible),.331264704);
  assert.equal(reordered.tick,177692);assert.equal(tag(doctor(reordered).job,'def'),'TendPatient');
  assert.equal(tag(doctor(reordered).job,'targetA'),'Thing_Human958');
  assert.equal(tag(doctor(reordered).job,'targetB'),'Thing_MedicineHerbal78321');
  assert.equal(tag(doctor(reordered).job,'playerForced'),'True');
  assert.equal(working.tick,179177);assert.equal(doctor(working).pos,'(112, 0, 124)');
  assert.equal(value(doctor(working).job_driver,'curToilIndex'),13);assert.equal(value(doctor(working).job_driver,'ticksLeftThisToil'),118);
  assert.equal(working.medicines.find((m)=>m.id==='MedicineHerbal78321').owner,'Human965');
  assert(doctor(working).carry.includes('MedicineHerbal78321'));assert.equal(herbal(working),2);
  assert.equal(condition(working,151).tend_ticks_left.value,5889);assert.equal(condition(working,151).tend_quality.value,.464708388);
  assert.equal(immunity(working),.346872479);
  assert.equal(done.tick,179408);assert.equal(herbal(done),1);
  assert(!done.medicines.some((m)=>m.id==='MedicineHerbal78321'));
  assert.equal(condition(done,151).severity.value,.337512016);
  assert.equal(condition(done,151).tend_quality.value,.31208238);
  assert.equal(condition(done,151).total_tend_quality.value,.776790738);
  assert(Math.abs(condition(done,151).total_tend_quality.value-(.464708388+.31208238))<1e-7);
  assert.equal(condition(done,151).tend_ticks_left.value,43158);
  assert.equal(condition(done,151).tend_ticks_left.value,condition(working,151).tend_ticks_left.value+37500-(done.tick-working.tick));
  assert.equal(immunity(done),.349300355);assert(immunity(done)>immunity(working));
  assert.equal(condition(done,148).severity.value,.5);assert.equal(condition(done,148).tend_ticks_left.value,1);
  assert.equal(patient(final).medical_care,'Best');assert.equal(final.tick,179408);
  assert.equal(final.sha256,'4e8f66c79fbbb355705573f341e27fc4d79f65982f707791d1e371a4f954ac41');
  const restored=structuredClone(done);patient(restored).medical_care='Best';
  patient(restored).player_settings=patient(restored).player_settings.replace('<medCare>HerbalOrWorse</medCare>','<medCare>Best</medCare>');
  sameState(restored,final);
  assert.deepEqual(r.outcomes,{ordinary_wound_tends:1,ordinary_infection_tends:2,herbal_units_consumed:3,herbal_units_remaining:1,infection_load_id:151,retend_observed_unavailable_at:7993,retend_observed_available_at:7374,retend_added_duration:37500,full_recovery_observed:false});
  const actionBytes=readFileSync(path.join(dir,r.actions.file));assert.equal(sha(actionBytes),r.actions.sha256);
  const actions=actionBytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(actions.length,r.actions.count);assert.equal(r.actions.complete_attempt_coverage,false);
  assert.equal(r.guard_failures.length,4);assert.equal(r.guard_failures.filter((f)=>f.stage==='after first menu click').length,1);
  for(const [i,a] of actions.entries()) {
    assert.equal(a.kind,'completed-guarded-ui-input');assert.equal(a.data.pid,29920);
    assert(a.data.profile.replaceAll('\\','/').endsWith(r.profile));
    assert(Date.parse(a.data.finished_utc)>=Date.parse(a.data.started_utc));
    if(i) assert(Date.parse(a.data.started_utc)>=Date.parse(actions[i-1].data.started_utc));
    assert(!(a.data.action==='key'&&a.data.virtual_key===32));
    if(local){const raw=readFileSync(path.join(root,a.source_ledger),'utf8').trim().split(/\r?\n/).map(JSON.parse);assert(raw.some((v)=>JSON.stringify(v)===JSON.stringify(a.data)));}
  }
  const runs=actions.filter((a)=>a.data.action==='pulse').map((a)=>a.data);
  assert.equal(runs.length,27);assert.equal(r.clock.run_windows.length,27);
  assert.deepEqual(r.clock.bounded_runs,runs);
  for(const a of runs){assert([49,50,51].includes(a.virtual_key));assert(a.duration_ms>=40&&a.duration_ms<=4000);assert(Date.parse(a.pause_start_utc)>Date.parse(a.run_start_utc));}
  const actionNamed=(name)=>{const matches=actions.filter((a)=>path.win32.basename(a.data.image)===name);assert.equal(matches.length,1,name);return matches[0].data;};
  let runTick=entry.tick,totalAdvanced=0;
  for(const [i,w] of r.clock.run_windows.entries()){
    const a=actionNamed(w.action_image),before=get(w.before_save),after=get(w.after_save);
    assert.deepEqual(a,runs[i]);assert.equal(w.before_tick,before.tick);assert.equal(w.after_tick,after.tick);
    assert.equal(w.advanced_ticks,after.tick-before.tick);assert(w.advanced_ticks>0);assert.equal(before.tick,runTick);
    assert(w.after_save.endsWith('-b'));assert(r.clock.equal_pause_pairs.some((pair)=>pair.b===w.after_save));
    const beforeReturn=actionNamed(w.before_save+'-return.png');
    const afterFirstMenu=actionNamed(w.after_save.replace(/-b$/,'-a')+'-menu.png');
    assert(Date.parse(beforeReturn.finished_utc)<=Date.parse(a.started_utc));
    assert(Date.parse(afterFirstMenu.started_utc)>=Date.parse(a.finished_utc));
    totalAdvanced+=w.advanced_ticks;runTick=after.tick;
  }
  assert.equal(totalAdvanced,34995);assert.equal(runTick,final.tick);
  assert.equal(r.screenshots.length,16);
  assert.equal(new Set(r.screenshots.map((s)=>s.id)).size,r.screenshots.length);
  for(const s of r.screenshots) {
    const bytes=readFileSync(path.join(dir,s.image));assert.equal(sha(bytes),s.sha256);
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const [x,y,w,h]=s.crop_xywh;assert(x>=0&&y>=0&&x+w<=2560&&y+h<=1440);assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],[w,h]);
    if(local){assert.equal(sha(readFileSync(path.join(root,s.source_file))),s.source_sha256);const meta=JSON.parse(readFileSync(path.join(root,s.source_file+'.jsonl'),'utf8').trim().split(/\r?\n/).at(-1));assert.equal(meta.pid,29920);assert.equal(Date.parse(meta.timestamp_utc),Date.parse(s.observed_utc));}
  }
  for(const s of r.sources) assert.equal(sha(readFileSync(path.join(root,s.file))),s.sha256);
  assert.equal(r.clock.final_tick,final.tick);assert.equal(r.clock.total_advanced_ticks,final.tick-entry.tick);
  assert.equal(r.clock.last_input_finished_utc,actions.at(-1).data.finished_utc);
  assert.equal(r.final_state.paused,true);assert.equal(r.final_state.input_released,true);
  assert.equal(r.final_state.canonical_sha256,final.sha256);assert.equal(r.final_state.tick,final.tick);
  assert.equal(r.final_state.patient_care_restored,'Best');assert.equal(r.final_state.equal_double_save,true);
  for(const key of ['god_mode','new_bed_created','skills_modified','work_priorities_modified','save_xml_modified','immunity_modified','disease_severity_modified_after_creation','tend_countdown_modified','dev_healing','normal_profile_touched'])assert.equal(r.preparation[key],false);
  if(local){
    const files=r.snapshots.map((x)=>{const file=path.join(root,x.path);assert.equal(sha(readFileSync(file)),x.save.sha256);return file;});
    // One PowerShell process avoids repeatedly starting the CLR. The same reader
    // still independently parses every original file; no retry hides failures.
    const command="$ErrorActionPreference='Stop'; $request=[Console]::In.ReadToEnd()|ConvertFrom-Json; $results=@(foreach($file in $request.files){ & $request.reader -SavePath $file | ConvertFrom-Json }); ConvertTo-Json -InputObject $results -Depth 40 -Compress";
    const raw=execFileSync('pwsh',['-NoProfile','-NonInteractive','-Command',command],{
      input:JSON.stringify({reader:path.join(root,'scripts/research/read-medicine-runtime-save.ps1'),files}),
      encoding:'utf8',maxBuffer:64*1024*1024,
    });
    const reread=JSON.parse(raw.replace(/^\uFEFF/,''));assert.equal(reread.length,r.snapshots.length);
    for(const [i,x] of r.snapshots.entries())assert.deepEqual(reread[i],x.save,x.name);
  }
  return {ok:true,mode:local?'local-original-saves-and-captures':'portable-recorded-summary',saveSnapshots:r.snapshots.length,crops:r.screenshots.length,completedActions:actions.length,equalPausePairs:r.clock.equal_pause_pairs.length,boundedRunWindows:runs.length,advancedTicks:r.clock.total_advanced_ticks,ordinaryTends:3,herbalUnitsConsumed:3,retendDurationAdded:37500,naturalInfectionProbabilityMeasured:false,completeAttemptCoverage:false,finalPauseVerified:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyNativeMedicineRuntime({local:process.argv.includes('--local')})));
