import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,relative,isAbsolute,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

// Checks retained evidence only. Never launches RimWorld or replays UI input.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const base=resolve(root,'docs/research/rimworld/evidence');
const local=process.argv.includes('--local');
const game=process.env.RIMWORLD_GAME_ROOT||'F:/SteamLibrary/steamapps/common/RimWorld';
const json=async n=>JSON.parse(await readFile(resolve(base,n),'utf8'));
const hex=v=>assert.match(v,/^[a-f0-9]{64}$/);
const digest=b=>createHash('sha256').update(b).digest('hex');
const safe=p=>{const full=resolve(root,p),rel=relative(root,full);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),p);return full;};
const unique=a=>assert.equal(new Set(a).size,a.length);
const hashes=new Map();
async function hashFile(p,sha){hex(sha);const full=resolve(p);if(!hashes.has(full))hashes.set(full,digest(await readFile(full)));assert.equal(hashes.get(full),sha,`Hash: ${p}`);}
const [e,r]=await Promise.all(['furniture-reinstall-evidence.json','furniture-reinstall-runtime-evidence.json'].map(json));
assert.equal(e.version_text,'1.7.4980 rev60');assert.equal(r.version,e.version_text);
assert.equal(e.source_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
const manifests=await Promise.all(e.manifests.map(n=>json(`${n}-manifest.json`))),m=manifests[0];
const provenance=new Map();let extracted=0;
for(const [i,manifest] of manifests.entries()){
 assert.equal(manifest.source_sha256,e.source_sha256);assert.equal(manifest.engine_sha256,'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');
 assert.equal(manifest.engine_version,'11.2.0.10050');
 for(const t of manifest.types)provenance.set(t.local_file,t);
 if(i<3){assert.deepEqual(manifest.types.map(t=>t.type),await json(`${e.manifests[i]}-types.json`));extracted+=manifest.types.length;for(const t of manifest.types){safe(t.local_file);hex(t.sha256);assert.ok(t.lines>0);if(local){await hashFile(safe(t.local_file),t.sha256);assert.equal((await readFile(safe(t.local_file),'utf8')).split('\n').length,t.lines);}}}
}
assert.equal(extracted,16);assert.equal(e.claims.length,12);assert.equal(e.xml.length,5);
assert.deepEqual(e.claims.map(c=>c.id),Array.from({length:12},(_,i)=>`FR${String(i+1).padStart(2,'0')}`));
unique(e.xml.map(x=>x.id));const xmlIds=new Set(e.xml.map(x=>x.id)),used=new Set();let pointers=0;
for(const c of e.claims){assert.ok(c.finding.length>30&&c.sources.length);for(const id of c.xml)assert.ok(xmlIds.has(id));for(const s of c.sources){
 pointers++;used.add(s.file);hex(s.sha256);safe(s.file);const p=provenance.get(s.file);assert.equal(p?.sha256,s.sha256,`Provenance: ${s.file}`);
 assert.ok(s.lines.length===2&&s.lines.every(Number.isInteger)&&s.lines[0]>=1&&s.lines[1]>=s.lines[0]&&s.lines[1]<=p.lines);
 if(local)await hashFile(safe(s.file),s.sha256);
}}
for(const x of e.xml){hex(x.source_sha256);assert.ok(x.file.startsWith('Data/Core/Defs/')&&x.xpath.startsWith('/Defs/'));assert.ok(x.nodes.length&&x.nodes.every(n=>n.startsWith('<')));assert.match(x.projection,/selected gameplay/);if(local)await hashFile(resolve(game,x.file),x.source_sha256);}
const tag=(s,n,f='')=>(s||'').match(new RegExp(`<${n}[^>]*>([^<]*)<\\/${n}>`))?.[1]??f;
const attr=(s,n)=>s.slice(0,s.indexOf('>')).match(new RegExp(`\\b${n}="([^"]*)"`))?.[1]??'';
const all=e.xml.flatMap(x=>x.nodes);
const defNode=(type,name)=>{const found=all.filter(x=>x.startsWith(`<${type}`)&&(tag(x,'defName')===name||attr(x,'Name')===name));assert.equal(found.length,1,name);return found[0];};
for(const chain of [
 ['Bed','BasicBedBase','SansComfortBedBase','ArtableBedBase','BedWithQualityBase','BedBase','FurnitureBase','BuildingBase'],
 ['DiningChair','ArtableFurnitureBase','FurnitureWithQualityBase','FurnitureBase','BuildingBase'],
 ['Table1x2c','TableGatherSpotBase','TableBase','FurnitureWithQualityBase','FurnitureBase','BuildingBase']
])for(let i=0;i<chain.length;i++)assert.equal(attr(defNode('ThingDef',chain[i]),'ParentName'),chain[i+1]??'');
assert.equal(tag(defNode('ThingDef','FurnitureBase'),'minifiedDef'),'MinifiedThing');
const mini=defNode('ThingDef','MinifiedThing');assert.equal(attr(mini,'ParentName'),'');assert.doesNotMatch(mini,/<statBases/);assert.equal(tag(mini,'useHitPoints'),'true');assert.equal(tag(mini,'category'),'Item');
const deterioration=defNode('StatDef','DeteriorationRate');assert.equal(Number(tag(deterioration,'defaultBaseValue')),0);assert.doesNotMatch(deterioration,/<minifiedThingInherits/);
assert.equal(Number(tag(defNode('StatDef','MaxHitPoints'),'defaultBaseValue')),100);
for(const job of ['Uninstall','HaulToContainer'])assert.equal(tag(defNode('JobDef',job),'driverClass'),`JobDriver_${job}`);
assert.equal(e.rea_members.status,'unavailable');assert.match(e.rea_members.reason,/67108864/);hex(e.rea_members.sha256);

assert.deepEqual(r.saves.map(s=>s.ticks_game),[80358,80359,80703,80703,80847,80847]);
assert.equal(r.preparation.developer_action_this_trial,false);assert.equal(r.preparation.edited_saves,false);assert.equal(r.preparation.no_statistical_calibration,true);
assert.deepEqual(r.launch.active_mods,['ludeon.rimworld','ludeon.rimworld.odyssey']);
assert.equal(r.launch.baseline_source_sha256,r.launch.baseline_copy_sha256);assert.equal(r.saves[0].sha256,r.launch.baseline_copy_sha256);
assert.deepEqual(r.targets,{worker:'Human958',bed:'Bed221087',wrapper:'MinifiedThing292600',blueprint:'Blueprint_Install_Bed292601',origin:'(115, 0, 132)',destination:'(113, 0, 134)',uninstalled_tick:80638,reinstalled_tick:80833});
const node=(s,role)=>s.nodes.find(n=>n.role===role);
const block=(s,n)=>(s||'').match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`))?.[1]??'';
for(const [i,s] of r.saves.entries()){
 hex(s.sha256);safe(s.file);unique(s.nodes.map(n=>n.xpath));assert.equal(s.nodes.length,6);
 for(const n of s.nodes){assert.ok(n.xpath.startsWith('//'));assert.ok(n.count===0||n.count===1);assert.equal(Boolean(n.xml),n.count===1);assert.ok(Array.isArray(n.fields));}
 const bed=node(s,'bed'),installed=node(s,'installed_bed'),wrapper=node(s,'wrapper'),bp=node(s,'blueprint'),worker=node(s,'worker'),skill=node(s,'construction_skill');
 assert.equal(bed.count,1);assert.equal(worker.count,1);assert.equal(skill.count,1);
 assert.equal(installed.count,[0,1,4,5].includes(i)?1:0);assert.equal(wrapper.count,[2,3].includes(i)?1:0);assert.equal(bp.count,i===3?1:0);
 for(const [key,val] of [['id','Bed221087'],['stuff','WoodLog'],['quality','Poor'],['health','91'],['rot','2']])assert.equal(tag(bed.xml,key),val);
 assert.equal(tag(bed.xml,'pos'),i>=4?r.targets.destination:r.targets.origin);
 assert.equal(tag(worker.xml,'id'),'Human958');assert.equal(tag(worker.xml,'nick'),'Prophet');
 assert.equal(Number(tag(skill.xml,'level')),3);assert.equal(Number(tag(skill.xml,'xpSinceLastLevel')),169.049194);
 if([1,4,5].includes(i)){assert.equal(tag(worker.xml,'ownedBed'),'Thing_Bed221087');assert.equal(tag(block(bed.xml,'assignedPawns'),'li'),'Thing_Human958');assert.match(bed.xml,/<uninstalledAssignedPawns\s*\/>/);}
 if([2,3].includes(i)){
  assert.equal(tag(worker.xml,'ownedBed'),'null');assert.match(bed.xml,/<assignedPawns\s*\/>/);assert.equal(tag(block(bed.xml,'uninstalledAssignedPawns'),'li'),'Thing_Human958');
  assert.equal(tag(wrapper.xml,'id'),'MinifiedThing292600');assert.equal(tag(wrapper.xml,'health'),'100');assert.equal(tag(wrapper.xml,'spawnedTick'),'80638');assert.equal(tag(bed.xml,'despawnedTick'),'80638');assert.ok(wrapper.xml.includes(bed.xml));
 }
 if(i>=4)assert.equal(tag(bed.xml,'spawnedTick'),'80833');
 if(local)await hashFile(safe(s.file),s.sha256);
}
const planned=r.saves[3],bp=node(planned,'blueprint').xml,job=block(node(planned,'worker').xml,'curJob');
assert.equal(tag(bp,'id'),'Blueprint_Install_Bed292601');assert.equal(tag(bp,'pos'),r.targets.destination);assert.equal(tag(bp,'miniToInstall'),'Thing_MinifiedThing292600');assert.equal(tag(bp,'buildingToReinstall'),'null');
assert.equal(tag(job,'def'),'HaulToContainer');assert.equal(tag(job,'loadID'),'60136');assert.equal(tag(job,'targetA'),'Thing_MinifiedThing292600');assert.equal(tag(job,'targetB'),'Thing_Blueprint_Install_Bed292601');assert.equal(tag(job,'count'),'1');assert.equal(tag(job,'playerForced'),'True');
assert.deepEqual(r.saves[4].nodes,r.saves[5].nodes);assert.notEqual(r.saves[4].sha256,r.saves[5].sha256);
assert.deepEqual(r.shutdown.rimworld_processes_after_exit,[]);assert.match(r.shutdown.method,/Quit to OS/);
assert.equal(r.actions.length,46);unique(r.actions.map(a=>a.image_name));
for(const [i,a] of r.actions.entries()){
 assert.ok(a.image_name.startsWith(`${String(i+1).padStart(3,'0')}-`));hex(a.source_sha256);hex(a.image_sha256);
 assert.ok(Date.parse(a.finished_utc)>=Date.parse(a.started_utc));if(i)assert.ok(Date.parse(a.started_utc)>=Date.parse(r.actions[i-1].finished_utc));
 if(a.action==='pulse'){assert.ok([49,50,51].includes(a.virtual_key));assert.ok(a.duration_ms>=40&&a.duration_ms<=4000);}
 if(local){
  await hashFile(safe(a.source_file),a.source_sha256);await hashFile(safe(`.local-research/runtime/furniture-reinstall-20261104/${a.image_name}`),a.image_sha256);
  const records=(await readFile(safe(a.source_file),'utf8')).trim().split(/\r?\n/).map(l=>JSON.parse(l.replace(/^\uFEFF/,''))),record=records.find(x=>basename(x.image)===a.image_name);assert.ok(record);
  const norm=v=>v.replace(/(\.\d*?[1-9])0+Z$/,'$1Z').replace(/\.0+Z$/,'Z');for(const key of ['started_utc','finished_utc'])assert.equal(norm(record[key]),norm(a[key]));
  for(const key of ['action','x','y','end_x','end_y','text','virtual_key','control','duration_ms','wheel_delta','wait_ms','park_x','park_y'])assert.deepEqual(record[key],a[key]);
 }
}
assert.equal(r.images.length,6);unique(r.images.map(s=>s.id));
for(const s of r.images){
 await hashFile(safe(`docs/research/rimworld/evidence/${s.file}`),s.sha256);const b=await readFile(resolve(base,s.file));assert.equal(b.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(b.readUInt32BE(16),s.crop[2]);assert.equal(b.readUInt32BE(20),s.crop[3]);
 assert.deepEqual(s.source_dimensions,[2560,1440]);assert.ok(s.crop[0]>=0&&s.crop[1]>=0&&s.crop[0]+s.crop[2]<=2560&&s.crop[1]+s.crop[3]<=1440);assert.equal(r.actions.find(a=>a.image_name===basename(s.source_file))?.image_sha256,s.source_sha256);
}
assert.equal(r.observations.length,5);for(const o of r.observations)for(const id of o.evidence)assert.ok(['saves','shutdown'].includes(id)||r.images.some(s=>s.id===id));
let projections=0;
if(local){
 await hashFile(resolve(game,'Assembly-CSharp.dll'),m.source_sha256);await hashFile(resolve(root,'../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'),m.engine_sha256);await hashFile(safe(e.rea_members.source_file),e.rea_members.sha256);
 await hashFile(safe(r.launch.baseline_source),r.launch.baseline_source_sha256);await hashFile(safe(r.launch.record_file),r.launch.record_sha256);await hashFile(safe(r.shutdown.record_file),r.shutdown.record_sha256);await hashFile(safe(`${r.launch.profile}/Config/ModsConfig.xml`),r.launch.mods_sha256);
 const launch=JSON.parse(await readFile(safe(r.launch.record_file),'utf8'));assert.equal(launch.pid,r.launch.pid);assert.equal(launch.baseline_sha256,r.launch.baseline_source_sha256);assert.equal(launch.prefs_sha256,r.launch.prefs_sha256);
 const exit=JSON.parse(await readFile(safe(r.shutdown.record_file),'utf8'));assert.equal(exit.pid,r.launch.pid);assert.deepEqual(exit.remainingProcesses,[]);
 const quote=v=>`'${v.replaceAll("'","''")}'`;
 const script=`$ErrorActionPreference='Stop'
$root=${quote(root)};$game=${quote(game)};$base=Join-Path $root 'docs/research/rimworld/evidence'
$r=Get-Content (Join-Path $base 'furniture-reinstall-runtime-evidence.json') -Raw|ConvertFrom-Json
$e=Get-Content (Join-Path $base 'furniture-reinstall-evidence.json') -Raw|ConvertFrom-Json
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
 foreach($n in $s.nodes){$selected=$doc.SelectNodes($n.xpath);if($selected.Count -ne $n.count){throw 'Original count mismatch'};if(!$n.count){continue};$original=$selected[0];if($n.fields.Count){CheckProjection $original (([xml]$n.xml).DocumentElement)}elseif($original.OuterXml -cne $n.xml){throw 'Original exact node mismatch'};$count++}
}
foreach($x in $e.xml){
 $doc=[xml](Get-Content -LiteralPath (Join-Path $game $x.file) -Raw);$nodes=$doc.SelectNodes($x.xpath)
 if($nodes.Count -ne $x.nodes.Count){throw 'Original XPath count mismatch'}
 for($i=0;$i -lt $nodes.Count;$i++){CheckProjection $nodes[$i] (([xml]$x.nodes[$i]).DocumentElement);$count++}
}
Write-Output $count`;
 projections=Number(execFileSync('pwsh',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',maxBuffer:2*1024*1024}).trim());assert.ok(projections>=40);
}
let links=0;
for(const name of ['103-furniture-reinstall-mechanisms.md','104-native-furniture-reinstall-runtime.md']){
 const file=resolve(base,'..',name);for(const match of (await readFile(file,'utf8')).matchAll(/\]\(([^)]+)\)/g)){if(/^(?:https?:|#)/.test(match[1]))continue;await access(resolve(dirname(file),match[1].split('#')[0]));links++;}
}
console.log(JSON.stringify({mode:local?'local-artifact-integrity':'portable-record-integrity',newly_extracted_types:extracted,used_source_types:used.size,claims:e.claims.length,source_pointers:pointers,xml_selections:e.xml.length,native_saves:r.saves.length,native_actions:r.actions.length,crops:r.images.length,local_links:links,checked_file_hashes:hashes.size,original_node_projections:projections,scope:'Stored evidence integrity only; no replay, damage trial or statistical calibration'},null,2));
