import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const validHash=x=>assert(typeof x==='string'&&/^[a-f0-9]{64}$/.test(x));

export function verifyNativeStonecuttingRuntime({root=projectRoot,local=false}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence');
 const r=JSON.parse(readFileSync(path.join(dir,'native-stonecutting-runtime.json'),'utf8'));
 assert.equal(r.schema_version,1);assert.equal(r.evidence_id,'RW17-NATIVE-STONECUTTING-RUNTIME');
 assert.equal(r.version_text,'1.7.4980 rev60');assert.equal(r.assembly_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
 assert.equal(r.process_id,29920);assert.equal(r.profile,'.local-research/runtime/profile-20261102');assert.deepEqual(r.active_mods,['ludeon.rimworld','ludeon.rimworld.odyssey']);
 assert.deepEqual(r.snapshots.map(x=>x.stage),['start','ready','working','final']);
 for(const x of r.snapshots){const s=x.save;validHash(s.sha256);assert(s.bytes>0);assert.equal(s.version,r.version_text);assert.deepEqual(s.mods,r.active_mods);assert(s.inventory_scope.includes('compressed simple things not decoded'));assert.equal(s.compressed_simple_things_present,true);assert.equal(s.pawn.id,'Human961');assert.equal(s.pawn.nick,'Squint');assert(s.pawn.hediffs.some(h=>h.def==='Malnutrition'));}
 const [start,ready,working,final]=r.snapshots.map(x=>x.save);
 assert.deepEqual(r.snapshots.map(x=>x.save.tick),[46372,46372,47518,50881]);assert.equal(start.tables.length,0);
 assert.equal(ready.pawn.food,1);assert.equal(ready.pawn.rest,1);
 for(const s of [ready,working,final]){assert.equal(s.tables.length,1);const t=s.tables[0];assert.equal(t.id,'TableStonecutter42144');assert.equal(t.stuff,'WoodLog');assert.equal(t.health,117);assert.equal(t.pos,'(113, 0, 138)');assert.equal(t.bills.length,1);const b=t.bills[0];assert.equal(b.recipe,'Make_StoneBlocksGranite');assert.equal(b.repeat_mode,'RepeatCount');assert.deepEqual(b.ingredients,['ChunkGranite']);assert.equal(b.suspended,false)}
 assert.equal(ready.tables[0].bills[0].repeat_count,1);assert.equal(working.tables[0].bills[0].repeat_count,1);assert.equal(final.tables[0].bills[0].repeat_count,0);assert.equal(final.tables[0].bills[0].repeat_count_explicit,false);
 const p=working.pawn;assert.equal(p.job,'DoBill');assert.equal(p.driver,'JobDriver_DoBill');assert.equal(p.job_id,'36124');assert.equal(p.job_count,1);assert.equal(p.work_giver,'DoBillsStonecut');assert.equal(p.player_forced,true);assert.equal(p.target_a,'Thing_TableStonecutter42144');assert.equal(p.target_b,`Thing_${r.experiment_input_id}`);assert.deepEqual(p.placed_things,[`Thing_${r.experiment_input_id}`]);assert.equal(p.work_left,1195.07764);assert.equal(p.bill_start_tick,46854);assert.equal(p.ticks_spent_recipe_work,666);assert(p.work_left>0);
 const input=working.explicit_granite_things.find(x=>x.id===r.experiment_input_id);assert(input);assert.equal(input.def,'ChunkGranite');assert.equal(input.count,1);assert.equal(input.pos,'(113, 0, 138)');assert.equal(input.stack_count_explicit,false);
 const output=final.explicit_granite_things.find(x=>x.id===r.experiment_output_id);assert(output);assert.equal(output.def,'BlocksGranite');assert.equal(output.count,20);assert.equal(output.stack_count_explicit,true);assert.equal(output.pos,'(113, 0, 137)');assert.equal(output.spawned_tick,49485);assert(output.spawned_tick>working.tick&&output.spawned_tick<final.tick);assert.equal(final.pawn.job,'GoForWalk');assert.equal(final.pawn.work_left,null);
 assert.equal(r.observed_input_count,input.count);assert.equal(r.observed_output_count,output.count);assert.equal(r.observed_table_outdoor_speed_factor,0.8);
 for(const k of ['normal_pawn_cutting_observed','input_one_output_twenty_observed','clock_pause_save_resume_completed'])assert.equal(r.outcomes[k],true);
 for(const k of ['reload_continuation_tested','bill_suspension_tested','mining_chunk_drop_tested','normal_table_construction_tested','automatic_work_selection_tested','stockpile_delivery_demonstrated'])assert.equal(r.outcomes[k],false);
 assert.equal(r.final_state.paused,true);for(const k of ['normal_profile_touched','game_files_modified','mods_installed'])assert.equal(r.final_state[k],false);
 assert.equal(r.screenshots.length,8);for(const s of r.screenshots){assert(/^runtime\/stonecutting-[a-z0-9-]+\.png$/.test(s.image));validHash(s.sha256);validHash(s.source_sha256);const b=readFileSync(path.join(dir,s.image));assert.equal(sha(b),s.sha256);assert.equal(b.subarray(1,4).toString(),'PNG');const [x,y,w,h]=s.crop_xywh;assert.deepEqual(s.source_size,[2560,1440]);assert(x>=0&&y>=0&&w>0&&h>0&&x+w<=2560&&y+h<=1440);assert.equal(b.readUInt32BE(16),w);assert.equal(b.readUInt32BE(20),h);if(local)assert.equal(sha(readFileSync(path.join(root,s.source_file))),s.source_sha256)}
 const ledger=readFileSync(path.join(dir,r.actions.file));assert.equal(sha(ledger),r.actions.sha256);const actions=ledger.toString().trim().split(/\r?\n/).map(JSON.parse);assert.equal(actions.length,r.actions.count);assert.equal(actions.length,72);
 let last=0;for(const a of actions){assert.equal(a.kind,'guarded-ui-input');assert.equal(a.data.pid,29920);assert(a.data.profile.replaceAll('\\','/').endsWith('/.local-research/runtime/profile-20261102'));const t=Date.parse(a.data.started_utc);assert(t>=last);last=t;assert(Date.parse(a.data.finished_utc)>=t)}
 const runs=actions.filter(a=>a.data.action==='key'&&a.data.virtual_key===51);assert.equal(runs.length,2);assert.deepEqual(runs.map(a=>a.data.wait_ms),[1800,8000]);
 for(const suffix of ['039-pause-working.png','041-pause-final.png']){const a=actions.find(a=>a.data.image.endsWith(suffix));assert(a);assert.equal(a.data.action,'click');assert.equal(a.data.x,2443);assert.equal(a.data.y,1305)}
 validHash(r.backup.sha256);
 if(local){assert.equal(sha(readFileSync(path.join(root,r.backup.path))),r.backup.sha256);for(const x of r.snapshots){const file=path.join(root,x.path);assert.equal(sha(readFileSync(file)),x.save.sha256);const raw=execFileSync('pwsh',['-NoProfile','-File',path.join(root,'scripts/research/read-stonecutting-runtime-save.ps1'),'-SavePath',file],{encoding:'utf8',maxBuffer:4*1024*1024});assert.deepEqual(JSON.parse(raw.replace(/^\uFEFF/,'')),x.save)}}
 return {ok:true,mode:local?'local-original-saves-and-captures':'portable-recorded-summary',saveSnapshots:4,crops:r.screenshots.length,actions:actions.length,inputChunks:1,outputBlocks:20,clockPauseSaveResumeCompleted:true,billSuspensionTested:false,reloadContinuationTested:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyNativeStonecuttingRuntime({local:process.argv.includes('--local')})));
