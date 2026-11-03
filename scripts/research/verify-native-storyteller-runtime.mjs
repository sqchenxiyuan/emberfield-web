import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {inflateRawSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha=(b)=>createHash('sha256').update(b).digest('hex');
const tag=(xml,name)=>xml?.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]??null;
const number=(xml,name)=>tag(xml,name)===null?null:Number(tag(xml,name));
const pawn=(s,id)=>s.pawns.find((p)=>p.id===id);
const silver=(s)=>s.tracked_entities.filter((e)=>e.def==='Silver');
const silverTotal=(s)=>silver(s).reduce((n,e)=>n+(number(e.raw,'stackCount')??1),0);
const asset=(s)=>s.tracked_entities.find((e)=>e.id==='Silver78580');
const state=(s)=>Object.fromEntries(Object.entries(s).filter(([k])=>!['file','sha256','bytes'].includes(k)));
const sameState=(a,b)=>assert.deepEqual(state(a),state(b));
const historical=(s,name)=>s.history_recorders.find((r)=>r.def===name);

// Retained-evidence verification only: no game input, replay, OCR or wealth model.
export function verifyNativeStorytellerRuntime({root=projectRoot,local=false}={}) {
  const dir=path.join(root,'docs/research/rimworld/evidence');
  const r=JSON.parse(readFileSync(path.join(dir,'native-storyteller-runtime.json'),'utf8'));
  assert.equal(r.evidence_id,'RW17-NATIVE-STORYTELLER-RUNTIME');
  assert.equal(r.version_text,'1.7.4980 rev60');
  assert.equal(r.assembly_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
  assert.equal(r.process_id,29920);assert.equal(r.window_handle,988850);
  assert.equal(r.profile,'.local-research/runtime/profile-20261102');
  assert.deepEqual(r.active_mods,['ludeon.rimworld','ludeon.rimworld.odyssey']);
  assert(r.method.includes('Not REA native UI provider execution'));
  const saves=Object.fromEntries(r.snapshots.map((x)=>[x.name,x.save]));
  assert.equal(Object.keys(saves).length,r.snapshots.length);assert.equal(r.snapshots.length,17);
  const get=(name)=>{assert(saves[name],name);return saves[name];};
  const base=get('medicine-final-paused-b'),entry=get('storyteller-entry-b');
  const spawned=get('storyteller-silver-spawned-b'),forbidden=get('storyteller-silver-forbidden-b');
  const ordered=get('storyteller-haul-ordered-b'),first=get('storyteller-haul-first-b');
  const carry=get('storyteller-haul-pickup-b'),stored=get('storyteller-haul-finish-b'),final=get('storyteller-final-paused-b');
  assert.equal(base.sha256,'4e8f66c79fbbb355705573f341e27fc4d79f65982f707791d1e371a4f954ac41');
  sameState(base,entry);sameState(stored,final);
  assert.equal(r.clock.equal_pause_pairs.length,8);
  for(const pair of r.clock.equal_pause_pairs){assert(pair.a.endsWith('-a'));assert.equal(pair.b,pair.a.replace(/-a$/,'-b'));sameState(get(pair.a),get(pair.b));}
  for(const {save:s} of r.snapshots){
    assert.equal(s.version,r.version_text);assert.deepEqual(s.mods,r.active_mods);
    assert.equal(number(s.tick_manager_raw,'ticksGame'),s.tick);assert(s.tick>=179408&&s.tick<=180004);
    assert.equal(s.storyteller_raw,base.storyteller_raw);assert.equal(tag(s.storyteller_raw,'def'),'Cassandra');
    assert.equal(tag(s.storyteller_raw,'difficulty'),'Rough');assert.equal(number(s.storyteller_raw,'lastIncidentTick'),150000);
    assert(s.storyteller_raw.includes('<queuedIncidents />'));assert.equal(s.story_watcher_raw,base.story_watcher_raw);
    assert.equal(s.map_story_state_raw,base.map_story_state_raw);assert.equal(s.map_info_raw,base.map_info_raw);
    assert.equal(pawn(s,'Human958').medical_care,'Best');assert.equal(pawn(s,'Human965').medical_care,'NoMeds');
    assert.equal(tag(pawn(s,'Human958').job,'targetA'),'Thing_Bed77946');
    for(const p of s.pawns){
      assert.equal(p.work_priorities,pawn(base,p.id).work_priorities);
      assert.deepEqual(p.skills.map((k)=>[k.def,k.level]),pawn(base,p.id).skills.map((k)=>[k.def,k.level]));
      for(const h of p.hediffs){assert(p.health_tracker.includes(h.raw));assert.equal(number(h.raw,'loadID'),h.id);assert.equal(tag(h.raw,'def'),h.def);}
    }
    assert.equal(s.tracked_entities.length,new Set(s.tracked_entities.map((e)=>e.id)).size);
    for(const e of s.tracked_entities){
      assert.equal(tag(e.raw,'id'),e.id);assert.equal(tag(e.raw,'def'),e.def);assert.equal(tag(e.raw,'pos')??'',e.pos);
      if(e.owner){
        assert(e.owner_container_raw.includes(e.raw));const p=pawn(s,e.owner);
        if(p)assert([p.carry,p.inventory,p.equipment,p.apparel].some((container)=>container?.includes(e.raw)));
        else assert(['Human38350','Human38360','Human38370','Human38399'].includes(e.owner));
      }
    }
    for(const id of ['Silver38564','Silver41859'])assert.deepEqual(silver(s).find((e)=>e.id===id),silver(base).find((e)=>e.id===id));
    assert.equal(s.history_recorders.length,11);
    for(const h of s.history_recorders){
      assert(s.history_recorders_raw.includes(h.raw));assert.equal(tag(h.raw,'def'),h.def);
      assert(['records','recordsDeflate'].includes(h.encoding));let bytes=Buffer.from(tag(h.raw,h.encoding).trim(),'base64');
      if(h.encoding==='recordsDeflate')bytes=inflateRawSync(bytes);
      assert.equal(bytes.length%4,0);const decoded=Array.from({length:bytes.length/4},(_,i)=>bytes.readFloatLE(i*4));
      assert.deepEqual(h.values,decoded,h.def);
    }
  }
  assert.equal(entry.tick,179408);assert.equal(spawned.tick,179408);assert.equal(forbidden.tick,179408);assert.equal(ordered.tick,179408);
  assert.equal(silverTotal(entry),800);assert.equal(silverTotal(spawned),1300);
  const removeSpawn=structuredClone(spawned);removeSpawn.tracked_entities=removeSpawn.tracked_entities.filter((e)=>e.id!=='Silver78580');sameState(removeSpawn,entry);
  assert.equal(asset(spawned).pos,'(111, 0, 127)');assert.equal(asset(spawned).parent,'things');assert.equal(asset(spawned).owner,'');
  assert.equal(number(asset(spawned).raw,'spawnedTick'),179408);assert.equal(number(asset(spawned).raw,'stackCount'),500);
  assert.equal(tag(asset(spawned).raw,'forbidden'),null);assert.equal(tag(asset(forbidden).raw,'forbidden'),'True');
  const undoForbid=structuredClone(forbidden);asset(undoForbid).raw=asset(undoForbid).raw.replace('<forbidden>True</forbidden>','');sameState(undoForbid,spawned);
  assert.equal(tag(asset(ordered).raw,'forbidden'),null);assert.equal(silverTotal(ordered),1300);
  assert(ordered.map_zone_manager_raw.includes('<ID>3</ID><label>Stockpile zone 2</label>'));
  assert(ordered.map_zone_manager_raw.includes('<cells><li>(116, 0, 123)</li></cells>'));
  for(const s of [ordered,first,carry]){
    const p=pawn(s,'Human961');assert.equal(tag(p.job,'def'),'HaulToCell');assert.equal(number(p.job,'loadID'),101033);
    assert.equal(tag(p.job,'targetA'),'Thing_Silver78580');assert.equal(tag(p.job,'targetB'),'(116, 0, 123)');
    assert.equal(number(p.job,'count'),s===carry?0:500);assert.equal(tag(p.job,'playerForced'),'True');assert.equal(tag(p.job,'workGiverDef'),'HaulGeneral');
    assert.equal(silverTotal(s),1300);
  }
  assert.equal(first.tick,179695);assert.equal(asset(first).parent,'things');assert.equal(asset(first).owner,'');
  assert.equal(carry.tick,179818);assert.equal(asset(carry).parent,'innerList');assert.equal(asset(carry).owner,'Human961');
  assert.equal(asset(carry).pos,'(111, 0, 127)');assert.equal(pawn(carry,'Human961').pos,'(112, 0, 127)');
  assert(pawn(carry,'Human961').carry.includes(asset(carry).raw));assert.equal(number(asset(carry).raw,'despawnedTick'),179789);
  assert.equal(silver(carry).filter((e)=>e.parent==='things').reduce((n,e)=>n+number(e.raw,'stackCount'),0),800);
  assert.equal(number(asset(carry).raw,'stackCount'),500);assert.equal(number(pawn(carry,'Human961').job_driver,'curToilIndex'),9);
  assert.equal(stored.tick,180004);assert.equal(asset(stored).parent,'things');assert.equal(asset(stored).owner,'');
  assert.equal(asset(stored).pos,'(116, 0, 123)');assert.equal(number(asset(stored).raw,'spawnedTick'),179940);
  assert.equal(number(asset(stored).raw,'despawnedTick'),-1);assert.equal(silverTotal(stored),1300);
  assert(!pawn(stored,'Human961').carry.includes('Silver'));assert.equal(tag(pawn(stored,'Human961').job,'def'),'Clean');
  const observations=r.ui.wealth_observations;
  assert.equal(observations.length,5);assert.deepEqual(observations.map((o)=>[o.total,o.items,o.buildings,o.pawns]),[[16739,11933,3196,1610],...[1,2,3,4].map(()=>[17239,12433,3196,1610])]);
  assert.deepEqual(observations.map((o)=>o.paired_save),['storyteller-entry-b','storyteller-silver-spawned-b','storyteller-silver-forbidden-b','storyteller-haul-pickup-b','storyteller-haul-finish-b']);
  for(const o of observations)assert(r.screenshots.some((s)=>s.id===o.screenshot));
  assert.equal(r.ui.storyteller,'Cassandra Classic');assert.equal(r.ui.difficulty,'Strive to survive');
  assert.equal(r.ui.major_threats,0);assert.equal(r.ui.enemy_raids,0);assert.equal(r.history.live_debug_threat_points_invoked,false);
  for(const name of ['Wealth_Total','Wealth_Items','Wealth_Buildings','Wealth_Pawns','ThreatPoints']){
    const a=historical(entry,name).values,b=historical(carry,name).values,c=historical(final,name).values;
    assert.equal(a.length,6);assert.deepEqual(a,b);assert.equal(c.length,7);assert.deepEqual(c.slice(0,-1),a);
  }
  assert.equal(historical(final,'Wealth_Total').values.at(-1),17239.404296875);
  assert.equal(historical(final,'Wealth_Items').values.at(-1),12433.1123046875);
  assert.equal(historical(final,'Wealth_Buildings').values.at(-1),3196.291748046875);
  assert.equal(historical(final,'Wealth_Pawns').values.at(-1),1610);
  assert.equal(historical(final,'ThreatPoints').values.at(-1),3.5);
  assert.equal(historical(final,'Adaptation').values.length,4);assert.equal(r.history.threat_points_record_scale,.1);
  const infection=pawn(final,'Human958').hediffs.find((h)=>h.id===151);
  assert.equal(infection.severity.value,.344257951);assert.equal(infection.tend_ticks_left.value,42562);assert.equal(infection.tend_quality.value,.31208238);
  assert.equal(number(pawn(final,'Human958').immunity,'immunity'),.355574995);
  const actionBytes=readFileSync(path.join(dir,r.actions.file));assert.equal(sha(actionBytes),r.actions.sha256);
  const actions=actionBytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(actions.length,157);assert.equal(actions.length,r.actions.count);assert.equal(r.actions.complete_attempt_coverage,true);
  assert.equal(r.guard_failures.length,0);assert.equal(r.workflow_failures.length,1);
  for(const [i,a] of actions.entries()){
    assert.equal(a.kind,'completed-guarded-ui-input');assert.equal(a.data.pid,29920);assert(a.data.profile.replaceAll('\\','/').endsWith(r.profile));
    assert(Date.parse(a.data.finished_utc)>=Date.parse(a.data.started_utc));if(i)assert(Date.parse(a.data.started_utc)>=Date.parse(actions[i-1].data.started_utc));
    assert(!(a.data.action==='key'&&a.data.virtual_key===32));
    if(local){const raw=readFileSync(path.join(root,a.source_ledger),'utf8').trim().split(/\r?\n/).map(JSON.parse);assert(raw.some((v)=>JSON.stringify(v)===JSON.stringify(a.data)));}
  }
  const actionNamed=(name)=>{const matches=actions.filter((a)=>path.win32.basename(a.data.image)===name);assert.equal(matches.length,1,name);return matches[0].data;};
  const runs=actions.filter((a)=>a.data.action==='pulse').map((a)=>a.data);
  assert.equal(runs.length,3);assert.deepEqual(r.clock.bounded_runs,runs);assert.deepEqual(runs.map((a)=>a.duration_ms),[650,200,400]);
  assert.equal(r.clock.run_windows.length,3);let runTick=entry.tick,total=0;
  for(const [i,w] of r.clock.run_windows.entries()){
    const a=actionNamed(w.action_image),before=get(w.before_save),after=get(w.after_save);assert.deepEqual(a,runs[i]);
    assert.equal(a.virtual_key,51);assert(Date.parse(a.pause_start_utc)>Date.parse(a.run_start_utc));
    assert.equal(w.before_tick,before.tick);assert.equal(w.after_tick,after.tick);assert.equal(w.advanced_ticks,after.tick-before.tick);
    assert.equal(w.advanced_ticks,[287,123,186][i]);assert.equal(before.tick,runTick);
    assert(r.clock.equal_pause_pairs.some((p)=>p.b===w.after_save));
    assert(Date.parse(actionNamed(w.before_save+'-return.png').finished_utc)<=Date.parse(a.started_utc));
    assert(Date.parse(actionNamed(w.after_save.replace(/-b$/,'-a')+'-menu.png').started_utc)>=Date.parse(a.finished_utc));
    total+=w.advanced_ticks;runTick=after.tick;
  }
  assert.equal(total,596);assert.equal(runTick,final.tick);assert.equal(r.clock.total_advanced_ticks,596);
  assert.equal(r.clock.last_input_finished_utc,actions.at(-1).data.finished_utc);
  assert.equal(path.win32.basename(actions.at(-1).data.image),'storyteller-062-final-return.png');
  for(const suffix of ['menu','dialog','select-name','name','saved'])actionNamed(`storyteller-final-paused-b-${suffix}.png`);
  assert.equal(r.screenshots.length,13);assert.equal(new Set(r.screenshots.map((s)=>s.id)).size,13);
  for(const s of r.screenshots){
    const bytes=readFileSync(path.join(dir,s.image));assert.equal(sha(bytes),s.sha256);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const [x,y,w,h]=s.crop_xywh;assert(x>=0&&y>=0&&x+w<=2560&&y+h<=1440);assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],[w,h]);
    const action=actionNamed(path.posix.basename(s.source_file));assert(Date.parse(s.observed_utc)>=Date.parse(action.started_utc));assert(Date.parse(s.observed_utc)<=Date.parse(action.finished_utc));
    if(local){assert.equal(sha(readFileSync(path.join(root,s.source_file))),s.source_sha256);const meta=JSON.parse(readFileSync(path.join(root,s.source_file+'.jsonl'),'utf8').trim().split(/\r?\n/).at(-1));assert.equal(meta.pid,29920);assert.equal(Date.parse(meta.timestamp_utc),Date.parse(s.observed_utc));}
  }
  for(const s of r.sources)assert.equal(sha(readFileSync(path.join(root,s.file))),s.sha256);
  assert.equal(final.sha256,'90679b06fa2f74f9d78813cbd626964d50dddefb6517bb112e60277c28d2db7a');
  assert.equal(r.final_state.canonical_sha256,final.sha256);assert.equal(r.final_state.tick,180004);
  for(const key of ['paused','equal_double_save','input_released'])assert.equal(r.final_state[key],true);
  for(const key of ['god_mode','skills_modified','work_priorities_modified','health_modified','save_xml_modified','storyteller_changed','difficulty_changed','normal_profile_touched'])assert.equal(r.preparation[key],false);
  assert.equal(r.preparation.dev_spawn_silver_units,500);assert.equal(r.preparation.reloads,0);
  assert.equal(r.outcomes.historical_wealth_samples_added,1);assert.equal(r.outcomes.raids_triggered_for_experiment,0);
  if(local){
    const files=r.snapshots.map((x)=>{const f=path.join(root,x.path);assert.equal(sha(readFileSync(f)),x.save.sha256);return f;});
    const command="$ErrorActionPreference='Stop'; $request=[Console]::In.ReadToEnd()|ConvertFrom-Json; $results=@(foreach($file in $request.files){ & $request.reader -SavePath $file | ConvertFrom-Json }); ConvertTo-Json -InputObject $results -Depth 45 -Compress";
    const raw=execFileSync('pwsh',['-NoProfile','-NonInteractive','-Command',command],{input:JSON.stringify({reader:path.join(root,'scripts/research/read-storyteller-runtime-save.ps1'),files}),encoding:'utf8',maxBuffer:64*1024*1024});
    const reread=JSON.parse(raw.replace(/^\uFEFF/,''));assert.equal(reread.length,r.snapshots.length);
    for(const [i,x] of r.snapshots.entries())assert.deepEqual(reread[i],x.save,x.name);
  }
  return {ok:true,mode:local?'local-original-saves-and-captures':'portable-recorded-summary',saveSnapshots:r.snapshots.length,equalPausePairs:8,crops:13,completedActions:actions.length,boundedRunWindows:3,advancedTicks:596,silverAdded:500,groundCarryGroundIdentityVerified:true,decodedHistoricalSeries:11,newHistoricalWealthSamples:1,difficultyUnchanged:true,naturalRaidRateMeasured:false,workflowFailuresRetained:1,finalPauseVerified:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyNativeStorytellerRuntime({local:process.argv.includes('--local')})));
