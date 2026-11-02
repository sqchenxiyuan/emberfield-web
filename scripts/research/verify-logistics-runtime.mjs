import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const hash=x=>assert(typeof x==='string'&&/^[a-f0-9]{64}$/.test(x));
export function verifyNativeLogisticsRuntime({root=projectRoot,local=false}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence');
 const r=JSON.parse(readFileSync(path.join(dir,'native-logistics-runtime.json'),'utf8'));
 assert.equal(r.evidence_id,'RW17-NATIVE-LOGISTICS-RUNTIME');assert.equal(r.schema_version,1);assert.equal(r.version_text,'1.7.4980 rev60');assert.equal(r.assembly_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
 assert.equal(r.process_id,29920);assert.equal(r.profile,'.local-research/runtime/profile-20261102');assert.deepEqual(r.active_mods,['ludeon.rimworld','ludeon.rimworld.odyssey']);
 for(const s of [r.before,r.after]){hash(s.sha256);assert(s.bytes>0);assert.equal(s.version,r.version_text);assert.deepEqual(s.mods,r.active_mods);assert(Number.isInteger(s.tick));for(const w of s.wood){assert(/^WoodLog\d+$/.test(w.id));assert(Number.isInteger(w.count)&&w.count>0&&w.count<=75)}}
 assert.equal(r.before.tick,39868);assert.equal(r.after.tick,46372);assert.equal(r.delta_ticks,r.after.tick-r.before.tick);assert.equal(r.before.zones.length,0);assert.equal(r.after.zones.length,1);
 const z=r.after.zones[0];assert.equal(z.class,'Zone_Stockpile');assert.deepEqual(z.cells,['(105, 0, 129)']);assert.deepEqual(z.allowed_defs,['WoodLog']);assert.equal(z.priority,'Normal');
 assert.deepEqual(r.experiment_wood_ids,['WoodLog42138','WoodLog42139','WoodLog42142']);const pieces=r.experiment_wood_ids.map(id=>r.after.wood.find(w=>w.id===id));assert(pieces.every(Boolean));assert.deepEqual(pieces.map(w=>w.count),[4,75,71]);assert.deepEqual(pieces.map(w=>w.pos),['(105, 0, 133)','(108, 0, 133)','(105, 0, 129)']);assert.equal(pieces.reduce((n,w)=>n+w.count,0),r.spawned_total);assert.equal(r.spawned_total,150);assert.equal(r.final_experiment_total,150);assert(!r.before.wood.some(w=>r.experiment_wood_ids.includes(w.id)));
 const p=r.after.pawns.find(p=>p.id==='Human961');assert.equal(p.nick,'Squint');assert.equal(p.job,'LayDown');assert.equal(p.job_target,z.cells[0]);assert.equal(p.pos,z.cells[0]);assert.equal(p.asleep,true);assert.deepEqual(p.carry,[]);assert(r.after.human_reservations.some(x=>x.claimant==='Thing_Human961'&&x.target===z.cells[0]&&x.job===`Job_${p.job_id}`));
 for(const k of ['partial_stack_merge_demonstrated','full75_rejection_demonstrated','expansion_succeeded','hauling_after_expansion_demonstrated','rejection_cause_isolated'])assert.equal(r.outcomes[k],false);assert.equal(r.outcomes.normal_pawn_haul_observed,true);assert.equal(r.outcomes.stored_count,71);assert.equal(r.final_state.paused,true);assert.equal(r.final_state.game_files_modified,false);assert.equal(r.final_state.normal_profile_touched,false);
 assert.equal(r.screenshots.length,7);for(const s of r.screenshots){assert(/^runtime\/logistics-[a-z0-9-]+\.png$/.test(s.image));hash(s.sha256);hash(s.source_sha256);const b=readFileSync(path.join(dir,s.image));assert.equal(sha(b),s.sha256);assert.equal(b.subarray(1,4).toString(),'PNG');const [x,y,w,h]=s.crop_xywh;assert.deepEqual(s.source_size,[2560,1440]);assert(x>=0&&y>=0&&w>0&&h>0&&x+w<=2560&&y+h<=1440);assert.equal(b.readUInt32BE(16),w);assert.equal(b.readUInt32BE(20),h);if(local)assert.equal(sha(readFileSync(path.join(root,s.source_file))),s.source_sha256)}
 const bytes=readFileSync(path.join(dir,r.actions.file));assert.equal(sha(bytes),r.actions.sha256);const actions=bytes.toString().trim().split(/\r?\n/).map(JSON.parse);assert.equal(actions.length,r.actions.count);assert.equal(actions.length,52);assert.equal(actions.filter(a=>a.kind==='native-window-drag').length,1);for(const a of actions){assert.equal(a.data.pid,29920);if(a.kind==='guarded-ui-input')assert(a.data.profile.replaceAll('\\','/').endsWith('/.local-research/runtime/profile-20261102'))}
 if(local)for(const which of ['before','after']){const file=path.join(root,r[`${which}_path`]);assert.equal(sha(readFileSync(file)),r[which].sha256);const output=execFileSync('pwsh',['-NoProfile','-File',path.join(root,'scripts/research/read-logistics-runtime-save.ps1'),'-SavePath',file],{encoding:'utf8',maxBuffer:4*1024*1024});assert.deepEqual(JSON.parse(output.replace(/^\uFEFF/,'')),r[which]);}
 return {ok:true,mode:local?'local-original-saves-and-captures':'portable-recorded-summary',saveSnapshots:2,crops:r.screenshots.length,actions:actions.length,storedWood:71,full75RejectionDemonstrated:false,expansionDemonstrated:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyNativeLogisticsRuntime({local:process.argv.includes('--local')})));
