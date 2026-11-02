import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=x=>assert(typeof x==='string'&&/^[a-f0-9]{64}$/.test(x));

// Integrity and interpretation checks of this bounded observation, not a gameplay rerun.
export function verifyNativePlantsRuntime({root=projectRoot,local=false}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence');
 const r=JSON.parse(readFileSync(path.join(dir,'native-plants-runtime.json'),'utf8'));
 assert.equal(r.schema_version,1);assert.equal(r.evidence_id,'RW17-NATIVE-PLANTS-RUNTIME');
 assert.equal(r.version_text,'1.7.4980 rev60');assert.equal(r.assembly_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
 assert.equal(r.process_id,29920);assert.equal(r.profile,'.local-research/runtime/profile-20261102');assert.deepEqual(r.active_mods,['ludeon.rimworld','ludeon.rimworld.odyssey']);
 assert.equal(r.rea.skill_version,42);assert.equal(r.rea.server_version,'6.7.0');assert.equal(r.rea.session_open,false);assert(r.rea.native_ui_provider.includes('unsupported_host'));assert(r.rea.runtime_method.includes('not REA native UI execution'));
 const names=['stonecutting-final','plants-entry-a','plants-entry-b','plants-start','plants-ready-a','plants-ready-b','plants-stopped-a','plants-stopped-b'];
 assert.deepEqual(r.snapshots.map(x=>x.name),names);assert.deepEqual(r.snapshots.map(x=>x.save.tick),[50881,134003,134003,55840,64249,64249,64249,64249]);
 assert.equal(r.snapshots[0].save.sha256,'2af1ff41a338adbb9fdc458b01433acceae8f90ef323f5f71e5ee0929494dc6a');
 for(const x of r.snapshots){const s=x.save;assert.equal(x.path,`${r.profile}/Saves/${x.name}.rws`);assert.equal(s.file,`${x.name}.rws`);hash(s.sha256);assert(s.bytes>0);assert.equal(s.version,r.version_text);assert.deepEqual(s.mods,r.active_mods);assert.equal(s.tree_sowing_research_progress,0);assert.deepEqual(s.pawns.map(p=>[p.id,p.plants_skill]),[['Human958',10],['Human961',3],['Human965',0]]);assert.deepEqual(s.designations,[]);assert(s.scope.includes('not a runtime disabled-reason test'))}
 const ready=r.snapshots[4].save,final=r.snapshots[7].save;
 assert.deepEqual(ready.growing_zones,[]);assert.deepEqual(final.growing_zones,[{id:1,label:'Growing zone 1',cells:['(89, 0, 138)'],plant:'Plant_Potato',hidden:false},{id:2,label:'Growing zone 2',cells:['(123, 0, 133)'],plant:'Plant_Potato',hidden:true}]);
 assert.deepEqual(r.snapshots[6].save.growing_zones,final.growing_zones);
 assert.deepEqual(final.recorded_cacti,[{id:'Plant_SaguaroCactus38625',def:'Plant_SaguaroCactus',pos:'(75, 0, 158)',health:130,growth:0.396612734,age:607223},{id:'Plant_SaguaroCactus39903',def:'Plant_SaguaroCactus',pos:'(123, 0, 133)',health:90,growth:0.715002835,age:12006097}]);
 // Only the reliably paused phase is compared for no progression.
 for(const x of r.snapshots.slice(4)){assert.deepEqual(x.save.recorded_cacti,ready.recorded_cacti);assert.deepEqual(x.save.explicit_wood,ready.explicit_wood);assert.deepEqual(x.save.pawns,ready.pawns)}
 assert.deepEqual(r.clock.entry_ticks,[134003,134003]);assert.equal(r.clock.baseline_tick,50881);assert.equal(r.clock.start_after_load_tick,55840);assert.deepEqual(r.clock.ready_ticks,[64249,64249]);assert.deepEqual(r.clock.final_ticks,[64249,64249]);
 assert.equal(r.clock.unplanned_post_load_advance,64249-50881);assert.equal(r.clock.controlled_paused_phase_delta,0);assert.equal(r.clock.deliberate_run_windows,0);assert.equal(r.clock.final_pause_verified,true);
 assert.equal(r.ui_samples.length,2);assert.deepEqual(r.ui_samples.map(s=>s.growth_percent),[38,71]);assert.deepEqual(r.ui_samples.map(s=>s.health),[130,90]);assert.deepEqual(r.ui_samples.map(s=>s.growth_rate_percent),[0,100]);assert.equal(r.ui_samples[0].growth_reason,'resting, needs light level 51%');
 for(const s of r.ui_samples){assert.equal(s.plant,'Saguaro cactus');assert.equal(s.max_health,130);assert.equal(s.chop_wood_button_visible,true);assert(r.screenshots.some(x=>x.id===s.shot))}
 assert.equal(r.ui_samples[1].health_percent_displayed,Math.round(90/130*100));assert.notEqual(r.ui_samples[1].health_percent_displayed,r.ui_samples[1].growth_percent);
 assert.deepEqual(r.visible_sow_menu,['Corn plant','Haygrass','Potato plant','Rice plant','Strawberry plant (min skill: 5)','Healroot (min skill: 8)','Dandelions','Daylily','Rose','Cotton plant','Hop plant (min skill: 3)','Psychoid plant (min skill: 6)','Smokeleaf plant (min skill: 4)','Tinctoria']);
 for(const k of ['different_growth_percentages_observed','health_growth_distinction_observed','chop_button_observed','growing_zone_created','crop_min_skill_labels_observed'])assert.equal(r.outcomes[k],true);
 for(const k of ['tree_option_selected','tree_disabled_reason_popup_observed','sowing_eligibility_exercised','normal_tree_chop_started','normal_tree_chop_finished','harvest_yield_observed','harvest_work_time_observed','controlled_growth_experiment','multi_season_growth_observed'])assert.equal(r.outcomes[k],false);
 for(const k of ['paused','pause_confirmed_by_two_equal_saves','baseline_untouched','developer_mode','god_mode'])assert.equal(r.final_state[k],true);
 for(const k of ['normal_profile_touched','game_files_modified','mods_installed'])assert.equal(r.final_state[k],false);
 assert.equal(r.final_state.canonical_save,'plants-stopped-b.rws');assert.equal(r.limitations.length,9);
 assert.deepEqual(r.screenshots.map(s=>s.id),['baseline-load','loaded','cactus38','cactus71','growing-zone','sow-menu','failed-chop-attempt','final-paused']);
 for(const s of r.screenshots){assert.equal(s.image,`runtime/plants-${s.id}.png`);assert(/^\.local-research\/runtime\/plants-[a-z0-9-]+\.png$/.test(s.source_file));hash(s.sha256);hash(s.source_sha256);const b=readFileSync(path.join(dir,s.image));assert.equal(sha(b),s.sha256);assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const [x,y,width,height]=s.crop_xywh;assert.deepEqual(s.source_size,[2560,1440]);assert(x>=0&&y>=0&&width>0&&height>0&&x+width<=2560&&y+height<=1440);assert.equal(b.readUInt32BE(16),width);assert.equal(b.readUInt32BE(20),height);assert(Number.isFinite(Date.parse(s.observed_utc)));if(local){const original=readFileSync(path.join(root,s.source_file));assert.equal(sha(original),s.source_sha256);assert.deepEqual([original.readUInt32BE(16),original.readUInt32BE(20)],s.source_size)}}
 assert.equal(r.actions.file,'native-plants-actions.jsonl');const data=readFileSync(path.join(dir,r.actions.file));assert.equal(sha(data),r.actions.sha256);const actions=data.toString().trim().split(/\r?\n/).map(JSON.parse);assert.equal(actions.length,r.actions.count);assert.equal(actions.length,65);
 let previous=0;for(const a of actions){assert.equal(a.kind,'guarded-ui-input');assert.equal(a.data.pid,r.process_id);assert(a.data.profile.replaceAll('\\','/').endsWith('/'+r.profile));assert(/plants-[a-z0-9-]+\.png$/.test(a.data.image));const stamp=Date.parse(a.data.started_utc);assert(stamp>=previous);assert(Date.parse(a.data.finished_utc)>=stamp);previous=stamp}
 assert.equal(new Set(actions.map(a=>a.data.image)).size,65);
 const pause=actions.filter(a=>a.data.action==='key'&&a.data.virtual_key===32);assert.equal(pause.length,1);assert(pause[0].data.image.endsWith('plants-008-pause-after-load.png'));assert.equal(actions.filter(a=>a.data.action==='key'&&a.data.virtual_key===51).length,0);assert(actions.at(-1).data.image.endsWith('plants-stopped-b-return.png'));
 for(const s of r.screenshots)assert(actions.some(a=>a.data.image.replaceAll('\\','/').endsWith('/'+s.source_file)));
 if(local)for(const x of r.snapshots){const file=path.join(root,x.path);assert.equal(sha(readFileSync(file)),x.save.sha256);const output=execFileSync('pwsh',['-NoProfile','-File',path.join(root,'scripts/research/read-plants-runtime-save.ps1'),'-SavePath',file],{encoding:'utf8',maxBuffer:4*1024*1024});assert.deepEqual(JSON.parse(output.replace(/^\uFEFF/,'')),x.save)}
 return {ok:true,mode:local?'local-original-saves-and-captures':'portable-recorded-summary',saveSnapshots:8,crops:8,actions:65,plantUiSamples:2,visibleCropOptions:14,unplannedAdvancedTicks:13368,controlledPausedTicks:0,finalPauseVerified:true,choppingDemonstrated:false,sowingDemonstrated:false,harvestYieldDemonstrated:false,controlledGrowthDemonstrated:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyNativePlantsRuntime({local:process.argv.includes('--local')})));
