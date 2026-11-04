import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname, resolve, relative, isAbsolute, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

// Stored evidence integrity only. Never launches the game or replays inputs.
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
const [m,e,r]=await Promise.all(['furniture-quality-manifest.json','furniture-quality-evidence.json','furniture-quality-runtime-evidence.json'].map(json));
for(const entry of [m,e]){assert.equal(entry.version_text,'1.7.4980 rev60');assert.equal(entry.source_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');}
assert.equal(r.version,m.version_text);assert.equal(m.engine_version,'11.2.0.10050');assert.equal(m.engine_sha256,'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');
const manifests=await Promise.all(e.manifests.map(s=>json(`${s}-manifest.json`)));
const provenance=new Map();
for(const manifest of manifests){assert.equal(manifest.source_sha256,m.source_sha256);assert.equal(manifest.engine_sha256,m.engine_sha256);for(const t of manifest.types)provenance.set(t.local_file,t);}
assert.equal(m.types.length,2);assert.deepEqual(m.types.map(t=>t.type),await json('furniture-quality-types.json'));
for(const t of m.types){hex(t.sha256);safe(t.local_file);assert.ok(t.lines>0);if(local){await hashFile(safe(t.local_file),t.sha256);assert.equal((await readFile(safe(t.local_file),'utf8')).split('\n').length,t.lines);}}
assert.equal(e.claims.length,13);assert.equal(e.xml.length,8);
assert.deepEqual(e.claims.map(c=>c.id),Array.from({length:13},(_,i)=>`FQ${String(i+1).padStart(2,'0')}`));
const xmlIds=new Set(e.xml.map(x=>x.id));unique(e.xml.map(x=>x.id));let pointers=0;const usedTypes=new Set();
for(const c of e.claims){assert.ok(c.finding.length>30&&c.sources.length);for(const id of c.xml)assert.ok(xmlIds.has(id));for(const s of c.sources){
 pointers++;hex(s.sha256);safe(s.file);usedTypes.add(s.file);assert.equal(provenance.get(s.file)?.sha256,s.sha256,`Unproven source: ${s.file}`);
 assert.ok(s.lines.length===2&&s.lines.every(Number.isInteger)&&s.lines[0]>=1&&s.lines[1]>=s.lines[0]);
 if(local){await hashFile(safe(s.file),s.sha256);assert.ok(s.lines[1]<=(await readFile(safe(s.file),'utf8')).split('\n').length);}
}}
for(const x of e.xml){hex(x.source_sha256);assert.ok(x.file.startsWith('Data/Core/Defs/')&&x.xpath.startsWith('/Defs/'));assert.ok(x.nodes.length&&x.nodes.every(n=>n.startsWith('<')));assert.match(x.projection,/selected gameplay/);if(local)await hashFile(resolve(game,x.file),x.source_sha256);}
const tag=(xml,name,fallback='')=>xml.match(new RegExp(`<${name}[^>]*>([^<]*)<\\/${name}>`))?.[1]??fallback;
const attr=(xml,name)=>xml.slice(0,xml.indexOf('>')).match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]??'';
const allNodes=e.xml.flatMap(x=>x.nodes);
const defNode=(type,name)=>{const found=allNodes.filter(x=>x.startsWith(`<${type}`)&&(tag(x,'defName')===name||attr(x,'Name')===name));assert.equal(found.length,1,`Unique ${type}:${name}`);return found[0];};
const chains={Bed:['Bed','BasicBedBase','SansComfortBedBase','ArtableBedBase','BedWithQualityBase','BedBase','FurnitureBase','BuildingBase'],DiningChair:['DiningChair','ArtableFurnitureBase','FurnitureWithQualityBase','FurnitureBase','BuildingBase'],Table1x2c:['Table1x2c','TableGatherSpotBase','TableBase','FurnitureWithQualityBase','FurnitureBase','BuildingBase'],HorseshoesPin:['HorseshoesPin','BuildingBase'],WoodLog:['WoodLog','ResourceVerbBase','ResourceBase']};
for(const [name,chain] of Object.entries(chains)){
 for(let i=0;i<chain.length;i++)assert.equal(attr(defNode('ThingDef',chain[i]),'ParentName'),chain[i+1]??'');
 const inherited=chain.map(n=>defNode('ThingDef',n)).join('');assert.equal(inherited.includes('<compClass>CompQuality</compClass>'),['Bed','DiningChair','Table1x2c'].includes(name));
}
for(const name of ['ArtableBedBase','ArtableFurnitureBase'])assert.equal(tag(defNode('ThingDef',name),'minQualityForArtistic'),'Excellent');
assert.doesNotMatch(defNode('StatDef','MaxHitPoints'),/StatPart_Quality/);
assert.match(defNode('StatDef','MarketValue'),/StatPart_Health/);assert.doesNotMatch(defNode('StatDef','MarketValueIgnoreHp'),/StatPart_Health/);
for(const name of ['MarketValue','MarketValueIgnoreHp'])assert.equal(attr(defNode('StatDef',name),'ParentName'),'MarketValueBase');
const qualities=['Awful','Poor','Normal','Good','Excellent','Masterwork','Legendary'];
for(const [stat,factors] of [['Comfort',[.76,.88,1,1.12,1.24,1.45,1.7]],['BedRestEffectiveness',[.86,.92,1,1.08,1.14,1.25,1.6]],['Beauty',[-.1,.5,1,2,3,5,8]],['MarketValueBase',[.5,.75,1,1.25,1.5,2.5,5]]])assert.deepEqual(qualities.map(q=>Number(tag(defNode('StatDef',stat),`factor${q}`))),factors);
assert.deepEqual(['Good','Excellent','Masterwork','Legendary'].map(q=>Number(tag(defNode('StatDef','MarketValueBase'),`maxGain${q}`))),[500,1000,2000,3000]);
assert.equal(tag(defNode('StatDef','Beauty'),'roundValue'),'true');assert.equal(tag(defNode('StatDef','WorkToBuild'),'roundToFiveOver'),'300');
const wood=defNode('ThingDef','WoodLog'),woodFactors=wood.match(/<statFactors>([\s\S]*?)<\/statFactors>/)[1];
assert.equal(Number(tag(woodFactors,'MaxHitPoints')),.65);assert.equal(Number(tag(woodFactors,'WorkToBuild')),.7);assert.equal(Number(tag(wood,'MarketValue')),1.2);
for(const [name,hp,cost,work] of [['Bed',140,45,800],['DiningChair',100,45,8000],['Table1x2c',75,28,750],['HorseshoesPin',75,10,100]]){const n=defNode('ThingDef',name);assert.equal(Number(tag(n,'MaxHitPoints')),hp);assert.equal(Number(tag(n,'costStuffCount')),cost);assert.equal(Number(tag(n,'WorkToBuild')),work);}
assert.equal(e.rea_members.status,'unavailable');assert.match(e.rea_members.reason,/67108864/);hex(e.rea_members.sha256);

assert.deepEqual(r.saves.map(s=>s.ticks_game),[79055,79638,80357,80357,80358]);
assert.equal(r.preparation.developer_action_this_trial,false);assert.equal(r.preparation.edited_saves,false);assert.equal(r.preparation.no_statistical_calibration,true);
assert.deepEqual(r.launch.active_mods,['ludeon.rimworld','ludeon.rimworld.odyssey']);assert.equal(r.launch.baseline_copy_sha256,r.launch.baseline_source_sha256);assert.equal(r.saves[0].sha256,r.launch.baseline_copy_sha256);
assert.equal(r.targets.worker,'Human958');assert.equal(r.targets.frame,'Frame_Bed221082');assert.equal(r.targets.bed,'Bed221087');assert.equal(r.targets.spawned_tick,80086);
for(const [i,s] of r.saves.entries()){
 hex(s.sha256);safe(s.file);unique(s.nodes.map(n=>n.xpath));const p=s.worker,xml=s.nodes.find(n=>n.role==='worker').xml,skill=s.nodes.find(n=>n.role==='construction_skill').xml;
 assert.equal(tag(xml,'id'),p.id);assert.equal(tag(xml,'nick'),p.name);assert.equal(tag(xml,'pos'),p.position);assert.equal(p.construction_level,3);assert.equal(Number(tag(skill,'level')),p.construction_level);assert.equal(Number(tag(skill,'xpSinceLastLevel')),p.construction_xp);
 const job=xml.match(/<curJob>([\s\S]*?)<\/curJob>/)?.[1]||'';assert.equal(tag(job,'def'),p.job);assert.equal(Number(tag(job,'loadID',0)),p.job_id);assert.equal(tag(job,'targetA'),p.target_a);assert.equal(tag(job,'playerForced')==='True',p.player_forced);
 const vals=xml.match(/<vals>([\s\S]*?)<\/vals>/)[1];assert.deepEqual([...vals.matchAll(/<li>([^<]*)<\/li>/g)].map(m=>Number(m[1])),p.record_values);
 assert.deepEqual(s.objects.map(o=>o.id),[r.targets.frame,r.targets.bed]);
 for(const [j,o] of s.objects.entries()){
  assert.equal(o.count,j===0?(i===1?1:0):(i>=2?1:0));const n=s.nodes.find(n=>n.role===o.id);assert.equal(Boolean(n),o.count===1);if(!n)continue;
  for(const [key,xmlKey] of [['id','id'],['def','def'],['position','pos'],['stuff','stuff'],['quality','quality']])assert.equal(tag(n.xml,xmlKey),o[key]);
  for(const [key,xmlKey] of [['health','health'],['work_done','workDone'],['resource_count','stackCount'],['spawned_tick','spawnedTick']])assert.equal(Number(tag(n.xml,xmlKey,0)),o[key]);
  assert.equal(/<quality(?:>|\s)/.test(n.xml),o.quality_present);assert.equal(/<authorName(?:>|\s)/.test(n.xml),o.author_name_present);assert.equal(o.author_name_present,false);
 }
 if(local)await hashFile(safe(s.file),s.sha256);
}
const [baseline,before,after,repeat,reloaded]=r.saves;
assert.equal(before.worker.job,'FinishFrame');assert.equal(before.worker.job_id,53929);assert.equal(before.worker.player_forced,true);assert.equal(before.worker.target_a,`Thing_${r.targets.frame}`);
assert.equal(before.objects[0].work_done,152.617462);assert.equal(before.objects[0].resource_count,45);assert.equal(before.objects[0].health,23);assert.equal(before.objects[0].position,r.targets.position);
assert.equal(after.objects[1].quality,'Poor');assert.equal(after.objects[1].health,91);assert.equal(after.objects[1].position,before.objects[0].position);assert.equal(after.objects[1].stuff,'WoodLog');assert.equal(after.objects[1].spawned_tick,r.targets.spawned_tick);assert.ok(r.targets.spawned_tick>before.ticks_game&&r.targets.spawned_tick<=after.ticks_game);
assert.equal(baseline.worker.construction_xp,114.974823);assert.equal(before.worker.construction_xp,129.674652);assert.equal(after.worker.construction_xp,169.049194);assert.equal(before.worker.record_values[25],11);assert.equal(after.worker.record_values[25],12);
for(const key of ['ticks_game','worker','objects','nodes'])assert.deepEqual(after[key],repeat[key]);assert.equal(reloaded.ticks_game-repeat.ticks_game,1);assert.deepEqual(reloaded.objects,repeat.objects);
assert.equal(reloaded.nodes.find(n=>n.role===r.targets.bed).xml,repeat.nodes.find(n=>n.role===r.targets.bed).xml);
assert.deepEqual(r.shutdown.rimworld_processes_after_exit,[]);assert.match(r.shutdown.capture_result,/no 041 screenshot/);

assert.equal(r.actions.length,40);unique(r.actions.map(a=>a.image_name));
for(const [i,a] of r.actions.entries()){
 assert.ok(a.image_name.startsWith(`${String(i+1).padStart(3,'0')}-`));hex(a.source_sha256);hex(a.image_sha256);
 assert.ok(Date.parse(a.finished_utc)>=Date.parse(a.started_utc));if(i)assert.ok(Date.parse(a.started_utc)>=Date.parse(r.actions[i-1].finished_utc));
 if(a.action==='pulse'){assert.ok([49,50,51].includes(a.virtual_key));assert.ok(a.duration_ms>=40&&a.duration_ms<=4000);}
 if(local){
  await hashFile(safe(a.source_file),a.source_sha256);await hashFile(safe(`.local-research/runtime/furniture-quality-20261104/${a.image_name}`),a.image_sha256);
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
 const exit=JSON.parse(await readFile(safe(r.shutdown.record_file),'utf8'));assert.equal(exit.expectedPid,r.launch.pid);assert.deepEqual(exit.remainingProcesses,[]);
 const quote=v=>`'${v.replaceAll("'","''")}'`;
 const script=`$ErrorActionPreference='Stop'
$root=${quote(root)};$game=${quote(game)};$base=Join-Path $root 'docs/research/rimworld/evidence'
$r=Get-Content (Join-Path $base 'furniture-quality-runtime-evidence.json') -Raw|ConvertFrom-Json
$e=Get-Content (Join-Path $base 'furniture-quality-evidence.json') -Raw|ConvertFrom-Json
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
 foreach($o in $s.objects){if($doc.SelectNodes($o.xpath).Count -ne $o.count){throw 'Object presence mismatch'}}
 foreach($n in $s.nodes){$original=$doc.SelectSingleNode($n.xpath);if($n.fields){CheckProjection $original (([xml]$n.xml).DocumentElement)}elseif($original.OuterXml -cne $n.xml){throw 'Original exact node mismatch'};$count++}
}
foreach($x in $e.xml){
 $doc=[xml](Get-Content -LiteralPath (Join-Path $game $x.file) -Raw);$nodes=$doc.SelectNodes($x.xpath)
 if($nodes.Count -ne $x.nodes.Count){throw 'Original XPath count mismatch'}
 for($i=0;$i -lt $nodes.Count;$i++){CheckProjection $nodes[$i] (([xml]$x.nodes[$i]).DocumentElement);$count++}
}
Write-Output $count`;
 originalProjections=Number(execFileSync('pwsh',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',maxBuffer:2*1024*1024}).trim());assert.ok(originalProjections>=40);
}
let links=0;
for(const name of ['100-furniture-quality-mechanisms.md','101-native-furniture-quality-runtime.md']){
 const file=resolve(base,'..',name);for(const match of (await readFile(file,'utf8')).matchAll(/\]\(([^)]+)\)/g)){if(/^(?:https?:|#)/.test(match[1]))continue;await access(resolve(dirname(file),match[1].split('#')[0]));links++;}
}
console.log(JSON.stringify({mode:local?'local-artifact-integrity':'portable-record-integrity',newly_extracted_types:m.types.length,used_source_types:usedTypes.size,claims:e.claims.length,source_pointers:pointers,xml_selections:e.xml.length,native_saves:r.saves.length,native_actions:r.actions.length,crops:r.images.length,local_links:links,checked_file_hashes:hashes.size,original_node_projections:originalProjections,scope:'Stored evidence integrity only; no runtime replay or statistical calibration'},null,2));
