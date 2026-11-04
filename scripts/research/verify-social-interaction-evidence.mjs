import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname, resolve, relative, isAbsolute, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

// Stored evidence integrity only. No game execution or input replay.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const base=resolve(root,'docs/research/rimworld/evidence');
const local=process.argv.includes('--local');
const game=process.env.RIMWORLD_GAME_ROOT||'F:/SteamLibrary/steamapps/common/RimWorld';
const json=async name=>JSON.parse(await readFile(resolve(base,name),'utf8'));
const hex=v=>assert.match(v,/^[a-f0-9]{64}$/);
const digest=b=>createHash('sha256').update(b).digest('hex');
const unique=values=>assert.equal(new Set(values).size,values.length);
const safe=path=>{const full=resolve(root,path),rel=relative(root,full);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),`Outside project: ${path}`);return full;};
const hashes=new Map();
async function hashFile(path,expected){hex(expected);const full=resolve(path);if(!hashes.has(full))hashes.set(full,digest(await readFile(full)));assert.equal(hashes.get(full),expected,`Hash mismatch: ${path}`);}
const [m,x,e,r]=await Promise.all(['social-interaction-manifest.json','social-interaction-extra-manifest.json','social-interaction-evidence.json','social-runtime-evidence.json'].map(json));
for(const entry of [m,x,e]){assert.equal(entry.version_text,'1.7.4980 rev60');assert.equal(entry.source_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');}
assert.equal(r.version,m.version_text);assert.equal(m.engine_version,'11.2.0.10050');assert.equal(m.engine_sha256,'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');
const allManifests=[m,x,...await Promise.all(['housing','skills','mood-recreation','environment-storage'].map(s=>json(`${s}-manifest.json`)))];
const provenance=new Map();
for(const manifest of allManifests){assert.equal(manifest.source_sha256,m.source_sha256);assert.equal(manifest.engine_sha256,m.engine_sha256);for(const t of manifest.types)provenance.set(t.local_file,t);}
const newTypes=[...m.types,...x.types];assert.equal(newTypes.length,18);unique(newTypes.map(t=>t.type));
for(const [manifest,list] of [[m,await json('social-interaction-types.json')],[x,await json('social-interaction-extra-types.json')]])assert.deepEqual(manifest.types.map(t=>t.type),list);
for(const t of newTypes){hex(t.sha256);safe(t.local_file);assert.ok(t.lines>0);if(local){await hashFile(safe(t.local_file),t.sha256);assert.equal((await readFile(safe(t.local_file),'utf8')).split('\n').length,t.lines);}}
assert.equal(e.claims.length,16);assert.equal(e.xml.length,6);
assert.deepEqual(e.claims.map(c=>c.id),Array.from({length:16},(_,i)=>`SC${String(i+1).padStart(2,'0')}`));
const xmlIds=new Set(e.xml.map(x=>x.id));unique([...e.xml.map(x=>x.id)]);let pointers=0;const usedTypes=new Set();
for(const c of e.claims){assert.ok(c.finding.length>30&&c.sources.length);for(const id of c.xml)assert.ok(xmlIds.has(id));for(const s of c.sources){
 pointers++;hex(s.sha256);safe(s.file);usedTypes.add(s.file);assert.equal(provenance.get(s.file)?.sha256,s.sha256,`Unproven source: ${s.file}`);
 assert.ok(s.lines.length===2&&s.lines.every(Number.isInteger)&&s.lines[0]>=1&&s.lines[1]>=s.lines[0]);
 if(local){await hashFile(safe(s.file),s.sha256);assert.ok(s.lines[1]<=(await readFile(safe(s.file),'utf8')).split('\n').length);}
}}
for(const x of e.xml){hex(x.source_sha256);assert.ok(x.file.startsWith('Data/Core/Defs/')&&x.xpath.startsWith('/Defs/'));assert.ok(x.nodes.length&&x.nodes.every(n=>n.startsWith('<')));assert.match(x.projection,/selected gameplay/);if(local)await hashFile(resolve(game,x.file),x.source_sha256);}
const projection=id=>e.xml.find(x=>x.id===id).nodes.join('\n');
for(const [id,re] of [['SX01',/<initiatorXpGainAmount>4<\/initiatorXpGainAmount>/],['SX01',/<initiatorXpGainAmount>10<\/initiatorXpGainAmount>/],['SX01',/<socialFightBaseChance>0.04<\/socialFightBaseChance>/],['SX02',/<thoughtClass>Thought_MemorySocialCumulative<\/thoughtClass>/],['SX02',/<maxCumulatedOpinionOffset>10<\/maxCumulatedOpinionOffset>/],['SX02',/<thoughtToMake>InsultedMood<\/thoughtToMake>/],['SX02',/<durationDays>20<\/durationDays>/],['SX02',/<baseMoodEffect>-5<\/baseMoodEffect>/],['SX03',/<bonusPerLevel>0.0275<\/bonusPerLevel>/],['SX04',/<baseChance>4<\/baseChance>/],['SX05',/<joyDuration>4000<\/joyDuration>/],['SX06',/<compClass>CompGatherSpot<\/compClass>/]])assert.match(projection(id),re);
assert.equal(e.rea_members.status,'unavailable');assert.match(e.rea_members.reason,/67108864/);hex(e.rea_members.sha256);

assert.deepEqual(r.saves.map(s=>s.ticks_game),[77073,77074,78429,79055,79055]);
assert.equal(r.preparation.developer_action,true);assert.equal(r.preparation.edited_saves,false);assert.equal(r.preparation.no_statistical_calibration,true);
assert.deepEqual(r.launch.active_mods,['ludeon.rimworld','ludeon.rimworld.odyssey']);assert.equal(r.launch.baseline_copy_sha256,r.launch.baseline_source_sha256);assert.equal(r.saves[0].sha256,r.launch.baseline_copy_sha256);
assert.equal(r.targets.event_tick,78450);assert.equal(r.targets.new_log_id,24);
const tag=(xml,name,fallback='')=>xml.match(new RegExp(`<${name}[^>]*>([^<]*)<\\/${name}>`))?.[1]??fallback;
for(const [i,s] of r.saves.entries()){
 hex(s.sha256);safe(s.file);unique(s.nodes.map(n=>n.xpath));assert.deepEqual(s.pawns.map(p=>p.id),['Human958','Human961']);
 for(const p of s.pawns){
  const n=s.nodes.find(n=>n.role===p.id);assert.ok(n&&n.fields.includes('interactions'));const xml=n.xml;
  assert.equal(tag(xml,'id'),p.id);assert.equal(tag(xml,'pos'),p.position);assert.equal(tag(xml,'nick'),p.name);
  const job=xml.match(/<curJob>([\s\S]*?)<\/curJob>/)?.[1]||'';
  assert.equal(tag(job,'def'),p.job);assert.equal(Number(tag(job,'loadID',0)),p.job_id);assert.equal(tag(job,'targetA'),p.target_a);assert.equal(tag(job,'targetB'),p.target_b);assert.equal(tag(job,'playerForced')==='True',p.player_forced);assert.equal(p.player_forced,false);
  assert.equal(Number(tag(xml,'curToilIndex',0)),p.toil);assert.equal(Number(tag(xml,'ticksLeftThisToil',0)),p.ticks_left);assert.equal(tag(xml,'lastInteraction'),p.last_interaction);assert.equal(Number(tag(xml,'lastInteractionTime',0)),p.last_interaction_time);
  for(const key of ['Joy','Comfort']){const need=s.nodes.find(n=>n.role===p.id+'/'+key);assert.ok(need);assert.equal(Number(tag(need.xml,'curLevel',0)),p[key.toLowerCase()]);}
  const memoryNodes=s.nodes.filter(n=>n.role===p.id+'/memory');assert.equal(memoryNodes.length,p.memories.length);
  for(const [k,mem] of p.memories.entries()){
   const mx=memoryNodes[k].xml;assert.equal(tag(mx,'def'),mem.def);assert.equal(tag(mx,'otherPawn'),mem.other);assert.equal(Number(tag(mx,'age',0)),mem.age);assert.equal(Number(tag(mx,'opinionOffset',0)),mem.offset);assert.equal(Number(tag(mx,'moodPowerFactor',1)),mem.power);assert.match(mx,new RegExp(`Class="${mem.class}"`));
  }
 }
 for(const n of s.nodes){assert.ok(n.xpath.startsWith('//')||n.xpath.startsWith('(//'));assert.ok(n.xml.startsWith('<'));}
 const table=s.nodes.find(n=>n.role===r.targets.table);assert.ok(table);assert.match(table.xml,/<active>True<\/active>/);
 assert.equal(s.nodes.some(n=>n.role===r.targets.added_chair),i>=1);
 assert.equal(s.nodes.some(n=>n.role==='new_interaction_log'),i>=3);assert.equal(s.play_log_ids.includes(24),i>=3);assert.equal(s.play_log_ids.length,i>=3?24:23);
 if(local)await hashFile(safe(s.file),s.sha256);
}
const before=r.saves[2],after=r.saves[3],repeat=r.saves[4];
assert.deepEqual(after.play_log_ids.filter(id=>!before.play_log_ids.includes(id)),[24]);
assert.deepEqual(after.play_log_ids.filter(id=>id!==24),before.play_log_ids);
for(const s of [before,after]){
 const seat=s.nodes.find(n=>n.role==='reservation'&&tag(n.xml,'target')==='Thing_DiningChair149545');assert.ok(seat);
 assert.equal(tag(seat.xml,'claimant'),'Thing_Human958');assert.equal(tag(seat.xml,'job'),'Job_48947');assert.equal(Number(tag(seat.xml,'maxPawns')),1);
}
assert.equal(before.pawns[0].job,'SocialRelax');assert.equal(before.pawns[0].job_id,48947);assert.equal(before.pawns[0].position,'(119, 0, 131)');assert.equal(before.pawns[0].target_a,'Thing_Table1x2c149544');assert.equal(before.pawns[0].target_b,before.pawns[0].position);assert.equal(before.pawns[0].toil,1);assert.equal(before.pawns[0].ticks_left,3978);
assert.equal(before.pawns[1].job,'GotoWander');assert.equal(before.pawns[1].position,'(122, 0, 129)');
assert.equal(after.pawns[0].job_id,before.pawns[0].job_id);assert.equal(after.pawns[0].job,'SocialRelax');assert.equal(after.pawns[0].position,before.pawns[0].position);assert.equal(after.pawns[0].toil,1);assert.equal(after.pawns[0].ticks_left,3352);
assert.equal(before.pawns[0].ticks_left-after.pawns[0].ticks_left,after.ticks_game-before.ticks_game);assert.equal(after.pawns[1].job,'Clean');
assert.equal(before.pawns[0].joy,0.797087073);assert.equal(after.pawns[0].joy,0.88470453);assert.equal(before.pawns[0].comfort,0.12240003);assert.equal(after.pawns[0].comfort,0.266400039);
for(const [i,p] of after.pawns.entries()){
 assert.equal(p.last_interaction,'DeepTalk');assert.equal(p.last_interaction_time,r.targets.event_tick);
 const old=before.pawns[i].memories.filter(m=>m.def==='DeepTalk'),now=p.memories.filter(m=>m.def==='DeepTalk');assert.equal(old.length,2);assert.equal(now.length,3);
 const fresh=now.find(m=>m.age===600);assert.ok(fresh);assert.equal(fresh.offset,i===0?13.5374994:12.3000002);assert.equal(fresh.power,i===0?0.902499974:0.819999993);assert.ok(Math.abs(fresh.offset-15*fresh.power)<0.000002);
 assert.deepEqual(p.memories.filter(m=>m.def==='Chitchat').map(m=>m.offset),before.pawns[i].memories.filter(m=>m.def==='Chitchat').map(m=>m.offset));
 const group=a=>Math.round(a.reduce((s,m,i)=>s+m.offset*0.9**i,0));assert.equal(group(old),i===0?26:23);assert.equal(group(now),i===0?37:33);
}
const log=after.nodes.find(n=>n.role==='new_interaction_log').xml;assert.equal(tag(log,'intDef'),'DeepTalk');assert.equal(tag(log,'initiator'),'Thing_Human961');assert.equal(tag(log,'recipient'),'Thing_Human958');assert.equal(Number(tag(log,'ticksAbs')),148450);
for(const key of ['ticks_game','pawns','nodes','play_log_ids'])assert.deepEqual(after[key],repeat[key]);
assert.deepEqual(r.shutdown.rimworld_processes_after_exit,[]);assert.match(r.shutdown.capture_result,/No successful action53/);

assert.equal(r.actions.length,52);unique(r.actions.map(a=>a.image_name));
for(const [i,a] of r.actions.entries()){
 assert.ok(a.image_name.startsWith(`${String(i+1).padStart(3,'0')}-`));hex(a.source_sha256);hex(a.image_sha256);
 assert.ok(Date.parse(a.finished_utc)>=Date.parse(a.started_utc));if(i)assert.ok(Date.parse(a.started_utc)>=Date.parse(r.actions[i-1].finished_utc));
 if(a.action==='pulse'){assert.ok([49,50,51].includes(a.virtual_key));assert.ok(a.duration_ms>=40&&a.duration_ms<=4000);}
 if(local){
  await hashFile(safe(a.source_file),a.source_sha256);await hashFile(safe(`.local-research/runtime/social-20261104/${a.image_name}`),a.image_sha256);
  const records=(await readFile(safe(a.source_file),'utf8')).trim().split(/\r?\n/).map(l=>JSON.parse(l.replace(/^\uFEFF/,'')));const record=records.find(x=>basename(x.image)===a.image_name);assert.ok(record);
  const norm=v=>v.replace(/(\.\d*?[1-9])0+Z$/,'$1Z').replace(/\.0+Z$/,'Z');for(const key of ['started_utc','finished_utc'])assert.equal(norm(record[key]),norm(a[key]));
  for(const key of ['action','x','y','end_x','end_y','text','virtual_key','control','duration_ms','wheel_delta','wait_ms','park_x','park_y'])assert.deepEqual(record[key],a[key]);
 }
}
assert.equal(r.images.length,6);unique(r.images.map(s=>s.id));
for(const s of r.images){
 await hashFile(safe(`docs/research/rimworld/evidence/${s.file}`),s.sha256);const bytes=await readFile(resolve(base,s.file));assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),s.crop[2]);assert.equal(bytes.readUInt32BE(20),s.crop[3]);
 assert.deepEqual(s.source_dimensions,[2560,1440]);assert.ok(s.crop[0]>=0&&s.crop[1]>=0&&s.crop[0]+s.crop[2]<=2560&&s.crop[1]+s.crop[3]<=1440);assert.equal(r.actions.find(a=>a.image_name===basename(s.source_file))?.image_sha256,s.source_sha256);
}
assert.equal(r.observations.length,5);for(const o of r.observations)for(const id of o.evidence)assert.ok(['saves','shutdown'].includes(id)||r.images.some(s=>s.id===id));
let originalProjections=0;
if(local){
 await hashFile(resolve(game,'Assembly-CSharp.dll'),m.source_sha256);await hashFile(resolve(root,'../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'),m.engine_sha256);await hashFile(safe(e.rea_members.source_file),e.rea_members.sha256);
 await hashFile(safe(r.launch.baseline_source),r.launch.baseline_source_sha256);await hashFile(safe(r.launch.record_file),r.launch.record_sha256);await hashFile(safe(r.shutdown.record_file),r.shutdown.record_sha256);await hashFile(safe(`${r.launch.profile}/Config/ModsConfig.xml`),r.launch.mods_sha256);
 const launch=JSON.parse(await readFile(safe(r.launch.record_file),'utf8'));assert.equal(launch.pid,r.launch.pid);assert.equal(launch.baseline_sha256,r.launch.baseline_source_sha256);assert.equal(launch.prefs_sha256,r.launch.prefs_sha256);
 const quote=v=>`'${v.replaceAll("'","''")}'`;
 const script=`$ErrorActionPreference='Stop'
$root=${quote(root)};$game=${quote(game)};$base=Join-Path $root 'docs/research/rimworld/evidence'
$r=Get-Content (Join-Path $base 'social-runtime-evidence.json') -Raw|ConvertFrom-Json
$e=Get-Content (Join-Path $base 'social-interaction-evidence.json') -Raw|ConvertFrom-Json
$count=0
function CheckProjection($actual,$expected){
 if(!$actual -or $actual.LocalName -cne $expected.LocalName){throw 'Missing projected node'}
 foreach($attr in $expected.Attributes){if($actual.GetAttribute($attr.Name) -cne $attr.Value){throw 'Projection attribute mismatch'}}
 $children=@($expected.ChildNodes|Where-Object NodeType -eq Element)
 if(!$children.Count){if($expected.InnerText -and $expected.InnerText -cne $actual.InnerText){throw 'Projection value mismatch'};return}
 $ordinals=@{}
 foreach($child in $children){$name=$child.LocalName;if(!$ordinals.ContainsKey($name)){$ordinals[$name]=0};$ordinals[$name]++;$original=$actual.SelectSingleNode($name+'['+$ordinals[$name]+']');CheckProjection $original $child}
}
foreach($s in $r.saves){
 $doc=[xml](Get-Content -LiteralPath (Join-Path $root $s.file) -Raw)
 if([int]$doc.savegame.game.tickManager.ticksGame -ne $s.ticks_game){throw 'Original tick mismatch'}
 foreach($n in $s.nodes){$original=$doc.SelectSingleNode($n.xpath);if($n.fields){CheckProjection $original (([xml]$n.xml).DocumentElement)}elseif($original.OuterXml -cne $n.xml){throw 'Original exact node mismatch'};$count++}
}
foreach($x in $e.xml){
 $doc=[xml](Get-Content -LiteralPath (Join-Path $game $x.file) -Raw);$nodes=$doc.SelectNodes($x.xpath)
 if($nodes.Count -ne $x.nodes.Count){throw 'Original XPath count mismatch'}
 for($i=0;$i -lt $nodes.Count;$i++){CheckProjection $nodes[$i] (([xml]$x.nodes[$i]).DocumentElement);$count++}
}
Write-Output $count`;
 originalProjections=Number(execFileSync('pwsh',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',maxBuffer:2*1024*1024}).trim());assert.ok(originalProjections>110);
}
let links=0;
for(const name of ['97-social-interaction-mechanisms.md','98-native-social-runtime.md']){
 const file=resolve(base,'..',name);for(const match of (await readFile(file,'utf8')).matchAll(/\]\(([^)]+)\)/g)){if(/^(?:https?:|#)/.test(match[1]))continue;await access(resolve(dirname(file),match[1].split('#')[0]));links++;}
}
console.log(JSON.stringify({mode:local?'local-artifact-integrity':'portable-record-integrity',newly_extracted_types:newTypes.length,used_source_types:usedTypes.size,claims:e.claims.length,source_pointers:pointers,xml_selections:e.xml.length,native_saves:r.saves.length,native_actions:r.actions.length,crops:r.images.length,local_links:links,checked_file_hashes:hashes.size,original_node_projections:originalProjections,scope:'Stored evidence integrity only; no runtime replay or statistical calibration'},null,2));
