import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const validHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
export function verifyNativePreservationRuntime({root=projectRoot,local=false}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence');
 const read=n=>JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
 const r=read('native-preservation-runtime.json');
 assert.equal(r.evidence_id,'RW17-NATIVE-PRESERVATION-RUNTIME');assert.equal(r.schema_version,1);
 assert.equal(r.version_text,'1.7.4980 rev60');assert.equal(r.assembly_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
 assert.equal(r.developer_actions_performed,true);assert.equal(r.normal_power_network_demonstrated,false);assert.equal(r.constant_freezing_interval_demonstrated,false);assert.equal(r.pure_core_runtime,false);assert.equal(r.final_state.paused,true);
 assert.deepEqual(r.active_mods,['ludeon.rimworld','ludeon.rimworld.odyssey']);
 const ids=['warm-0','warm-1','chilled-0','frozen-0','frozen-1'];
 assert.deepEqual(r.samples.map(s=>s.id),ids);assert.equal(r.intervals.length,4);
 for(const [n,s]of r.samples.entries()){
  assert.equal(s.file,`preservation-${s.id}.rws`);assert(validHash(s.sha256));assert(s.bytes>0);assert.equal(s.version,r.version_text);assert.deepEqual(s.active_mods,r.active_mods);assert.deepEqual(s.map_size,[250,1,250]);assert.equal(s.temperature_grid_bytes,125000);assert(Number.isInteger(s.tick));
  assert.equal(s.meals.length,2);const m=s.meals[0],control=s.meals[1];assert.equal(m.id,'MealSimple42000');assert.equal(m.present,true);assert.equal(m.def,'MealSimple');assert.equal(m.stack_count,1);assert.equal(m.forbidden,true);assert.equal(m.spawned_tick,10459);assert.deepEqual(m.pos,[104,0,142]);assert(Number.isFinite(m.rot_progress)&&m.rot_progress>=0);assert(Number.isInteger(m.temperature_cache_c*16));
  assert.equal(control.id,'MealSimple42001');assert.equal(control.present,n<2);assert.equal(s.cooler.id,'Cooler42061');assert.deepEqual(s.cooler.pos,[104,0,144]);assert.equal(s.cooler.target_c,n<2?21:n===2?5:-15);
  if(n<2){assert.deepEqual(control.pos,[114,0,137]);assert.equal(control.rot_progress,m.rot_progress)}
 }
 for(const [i,d]of r.intervals.entries()){
  const a=r.samples[i],b=r.samples[i+1];assert.equal(d.from,a.id);assert.equal(d.to,b.id);assert.equal(d.delta_ticks,b.tick-a.tick);assert(d.delta_ticks>0);close(d.indoor_delta_rot,b.meals[0].rot_progress-a.meals[0].rot_progress);close(d.indoor_average_progress_per_tick,d.indoor_delta_rot/d.delta_ticks);assert.equal(d.constant_temperature_demonstrated,false);assert.equal(d.outdoor_delta_rot,i===0?3000:null);
 }
 assert.equal(r.intervals[0].delta_ticks,2995);assert.equal(r.intervals[0].indoor_delta_rot,3000);close(r.intervals[3].indoor_delta_rot,197.7813);
 assert.equal(r.screenshots.length,7);
 for(const s of r.screenshots){
  assert(/^runtime\/preservation-[a-z0-9-]+\.png$/.test(s.image));assert(validHash(s.sha256)&&validHash(s.source_sha256));const png=readFileSync(path.join(dir,s.image));assert.equal(sha(png),s.sha256);assert.equal(png.subarray(1,4).toString(),'PNG');const [x,y,w,h]=s.crop_xywh;assert.deepEqual(s.source_size,[2560,1440]);assert(x>=0&&y>=0&&w>0&&h>0&&x+w<=2560&&y+h<=1440);assert.equal(png.readUInt32BE(16),w);assert.equal(png.readUInt32BE(20),h);assert(Number.isFinite(Date.parse(s.observed_utc)));
  if(local)assert.equal(sha(readFileSync(path.join(root,s.source_file))),s.source_sha256);
 }
 assert.equal(r.screenshots.find(s=>s.id==='frozen-0').ui_temperature_c,'-0');
 const actions=readFileSync(path.join(dir,r.actions.file));assert.equal(sha(actions),r.actions.sha256);const lines=actions.toString().trim().split(/\r?\n/).map(JSON.parse);assert.equal(lines.length,r.actions.count);assert.equal(lines.length,114);for(const a of lines){assert.equal(a.pid,29920);assert(a.profile.replaceAll('\\','/').endsWith('/.local-research/runtime/profile-20261102'));assert(Number.isFinite(Date.parse(a.started_utc)));}
 const manifest=read('preservation-runtime-manifest.json');assert.equal(manifest.source_sha256,r.assembly_sha256);assert.equal(manifest.types.length,6);assert.deepEqual(read('preservation-runtime-types.json'),manifest.types.map(t=>t.type));
 for(const ref of r.temperature_decode.source_refs){const m=read(`${ref.group}-manifest.json`),t=m.types.find(t=>t.type===ref.type);assert(t&&validHash(t.sha256)&&ref.start>=1&&ref.end>=ref.start&&ref.end<=t.lines);if(local)assert.equal(sha(readFileSync(path.join(root,t.local_file))),t.sha256)}
 if(local){const raw=execFileSync('pwsh',['-NoProfile','-File',path.join(root,'scripts/research/read-native-preservation-saves.ps1')],{encoding:'utf8',maxBuffer:4*1024*1024});assert.deepEqual(JSON.parse(raw.replace(/^\uFEFF/,'')),r.samples);assert.equal(sha(readFileSync(path.join(root,r.initial_backup.file))),r.initial_backup.sha256);}
 return {ok:true,mode:local?'local-original-saves-and-captures':'portable-recorded-summary',samples:r.samples.length,intervals:r.intervals.length,crops:r.screenshots.length,actions:lines.length,constantFreezingDemonstrated:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyNativePreservationRuntime({local:process.argv.includes('--local')})));
