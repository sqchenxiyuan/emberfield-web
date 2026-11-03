import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname, resolve, relative, isAbsolute, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

// Stored evidence integrity only. Never runs RimWorld or replays input.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const base=resolve(root,'docs/research/rimworld/evidence');
const local=process.argv.includes('--local');
const game=process.env.RIMWORLD_GAME_ROOT||'F:/SteamLibrary/steamapps/common/RimWorld';
const json=async name=>JSON.parse(await readFile(resolve(base,name),'utf8'));
const hex=value=>assert.match(value,/^[a-f0-9]{64}$/);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const unique=values=>assert.equal(new Set(values).size,values.length);
const safe=path=>{const full=resolve(root,path),rel=relative(root,full);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),`Outside project: ${path}`);return full;};
const hashes=new Map();
async function hashFile(path,expected){hex(expected);const full=resolve(path);if(!hashes.has(full))hashes.set(full,digest(await readFile(full)));assert.equal(hashes.get(full),expected,`Hash mismatch: ${path}`);}
const m=await json('dining-comfort-manifest.json');
const e=await json('dining-comfort-evidence.json');
const r=await json('dining-runtime-evidence.json');
const types=await json('dining-comfort-types.json');
for(const item of [m,e]){assert.equal(item.version_text,'1.7.4980 rev60');assert.equal(item.source_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');}
assert.equal(m.engine_version,'11.2.0.10050');
assert.equal(m.engine_sha256,'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');
assert.equal(r.version,m.version_text);
assert.equal(types.length,3);unique(types);assert.deepEqual(types,m.types.map(t=>t.type));
const provenance=new Map();
for(const manifest of [m,...await Promise.all(['food','housing','survival','work'].map(x=>json(`${x}-manifest.json`)))]){
 assert.equal(manifest.source_sha256,m.source_sha256);assert.equal(manifest.engine_sha256,m.engine_sha256);
 for(const t of manifest.types)provenance.set(t.local_file,t);
}
for(const t of m.types){hex(t.sha256);safe(t.local_file);assert.ok(t.lines>0);if(local){await hashFile(safe(t.local_file),t.sha256);assert.equal((await readFile(safe(t.local_file),'utf8')).split('\n').length,t.lines);}}
assert.equal(e.claims.length,17);assert.equal(e.xml.length,7);
assert.deepEqual(e.claims.map(c=>c.id),Array.from({length:17},(_,i)=>`DC${String(i+1).padStart(2,'0')}`));
unique(e.xml.map(x=>x.id));const xmlIds=new Set(e.xml.map(x=>x.id));let pointers=0;const usedTypes=new Set();
for(const c of e.claims){assert.ok(c.finding.length>30&&c.sources.length);for(const id of c.xml)assert.ok(xmlIds.has(id));for(const s of c.sources){
 pointers++;hex(s.sha256);safe(s.file);usedTypes.add(s.file);
 assert.equal(provenance.get(s.file)?.sha256,s.sha256,`Missing matching reconstruction provenance: ${s.file}`);
 assert.ok(s.lines.length===2&&s.lines.every(Number.isInteger)&&s.lines[0]>=1&&s.lines[1]>=s.lines[0]);
 if(local){await hashFile(safe(s.file),s.sha256);assert.ok(s.lines[1]<=(await readFile(safe(s.file),'utf8')).split('\n').length);}
}}
for(const x of e.xml){hex(x.source_sha256);assert.ok(x.file.startsWith('Data/Core/Defs/')&&x.xpath.startsWith('/Defs/'));assert.ok(x.nodes.length&&x.nodes.every(n=>n.startsWith('<')));assert.match(x.projection,/selected gameplay/);if(local)await hashFile(resolve(game,x.file),x.source_sha256);}
const projection=id=>e.xml.find(x=>x.id===id).nodes.join('\n');
assert.match(projection('DX01'),/<surfaceType>Eat<\/surfaceType>/);
assert.match(projection('DX01'),/<Comfort>0.70<\/Comfort>/);
assert.match(projection('DX02'),/Name="MealBaseIngredientless"/);
assert.match(projection('DX02'),/<maxNumToIngestAtOnce>1<\/maxNumToIngestAtOnce>/);
assert.match(projection('DX03'),/<baseMoodEffect>-3<\/baseMoodEffect>/);
assert.match(projection('DX04'),/<li IsNull="True" \/>/);
assert.match(projection('DX05'),/<seekerRisePerHour>0.60<\/seekerRisePerHour>/);
assert.match(projection('DX05'),/<seekerFallPerHour>0.04<\/seekerFallPerHour>/);
assert.match(projection('DX06'),/<factorLegendary>1.7<\/factorLegendary>/);
assert.match(projection('DX07'),/<baseMoodEffect>10<\/baseMoodEffect>/);
assert.equal(e.rea_members.status,'unavailable');assert.match(e.rea_members.reason,/67108864/);hex(e.rea_members.sha256);

assert.deepEqual(r.saves.map(s=>s.ticks_game),[75812,76627,76724,75813,76253,76670,77073,77073]);
assert.equal(r.preparation.developer_action,true);assert.equal(r.preparation.edited_saves,false);assert.equal(r.preparation.no_statistical_calibration,true);
assert.equal(r.preparation.load_to_preparation_ticks,1);
assert.deepEqual(r.launch.active_mods,['ludeon.rimworld','ludeon.rimworld.odyssey']);
assert.equal(r.launch.baseline_source_sha256,r.launch.baseline_copy_sha256);
assert.match(r.launch.configuration_change,/pauseOnLoad False -> True/);
assert.deepEqual(r.branches.without_table,[0,1,2]);assert.deepEqual(r.branches.with_table,[0,3,4,5,6,7]);assert.equal(r.branches.reload_action,22);assert.equal(r.branches.reload_source_save,0);
const tag=(xml,name,fallback='')=>xml.match(new RegExp(`<${name}[^>]*>([^<]*)<\\/${name}>`))?.[1]??fallback;
const [baseline,noTableChew,noTableDone,prepared,walking,chewing,finished,repeated]=r.saves;
assert.equal(baseline.sha256,r.launch.baseline_copy_sha256);
for(const [i,s] of r.saves.entries()){
 hex(s.sha256);safe(s.file);assert.equal(s.pawn.id,r.targets.pawn);unique(s.nodes.map(n=>n.xpath));
 const pawn=s.nodes.find(n=>n.role==='pawn').xml;
 assert.equal(tag(pawn,'id'),s.pawn.id);assert.equal(tag(pawn,'pos'),s.pawn.position);
 const curJob=pawn.match(/<curJob>([\s\S]*?)<\/curJob>/)?.[1]||'';
 assert.equal(tag(curJob,'def'),s.pawn.job);assert.equal(tag(curJob,'targetA'),s.pawn.job_target_a);assert.equal(tag(curJob,'targetB'),s.pawn.job_target_b);
 assert.equal(tag(curJob,'playerForced')==='True',s.pawn.player_forced);
 assert.equal(Number(tag(pawn,'curToilIndex',0)),s.pawn.toil);assert.equal(Number(tag(pawn,'ticksLeftThisToil',0)),s.pawn.ticks_left);
 assert.equal(tag(pawn,'destination'),s.pawn.path_destination);
 for(const role of ['food','comfort'])assert.equal(Number(tag(s.nodes.find(n=>n.role===role).xml,'curLevel',0)),s.pawn[role]);
 assert.equal(Number(tag(s.nodes.find(n=>n.role==='without_table').xml,'age',0)),s.pawn.without_table_age);
 const carry=pawn.match(/<carryTracker>([\s\S]*?)<\/carryTracker>/)?.[1]||'';
 for(const c of s.pawn.carry){assert.ok(carry.includes(`<id>${c.id}</id>`)&&carry.includes(`<def>${c.def}</def>`)&&carry.includes(`<stackCount>${c.count}</stackCount>`));}
 const reservationNodes=s.nodes.filter(n=>n.xpath.includes('/reservationManager/'));
 assert.deepEqual(reservationNodes.map(n=>tag(n.xml,'target')),s.reservations);
 const destinationNodes=s.nodes.filter(n=>n.xpath.includes('/pawnDestinationReservationManager/'));
 assert.deepEqual(destinationNodes.map(n=>tag(n.xml,'target')),s.destination_reservations);
 for(const n of s.nodes){assert.ok(n.xpath.startsWith('//maps/')||n.xpath.startsWith('(//maps/'));assert.ok(n.xml.startsWith('<'));}
 for(const role of [r.targets.table,r.targets.chair])assert.equal(s.nodes.some(n=>n.role===role),i>=3);
 if(local)await hashFile(safe(s.file),s.sha256);
}
assert.equal(baseline.pawn.without_table_age,9600);assert.equal(baseline.pawn.comfort,0);
assert.equal(noTableChew.pawn.job,'Ingest');assert.equal(noTableChew.pawn.ticks_left,30);assert.equal(noTableChew.pawn.food,0.486001104);
assert.deepEqual(noTableChew.pawn.carry,[{id:'MealSurvivalPack149545',def:'MealSurvivalPack',count:1}]);
assert.equal(noTableChew.pawn.without_table_age,10350);
assert.equal(noTableDone.pawn.job,'FeedPatient');assert.equal(noTableDone.pawn.food,0.994000018);assert.equal(noTableDone.pawn.without_table_age,150);assert.equal(noTableDone.pawn.comfort,0);
assert.equal(prepared.pawn.without_table_age,9600);assert.equal(prepared.pawn.comfort,0);
assert.match(prepared.nodes.find(n=>n.role===r.targets.table).xml,/<pos>\(119, 0, 132\)<\/pos>/);
assert.match(prepared.nodes.find(n=>n.role===r.targets.chair).xml,/<pos>\(119, 0, 131\)<\/pos>/);
assert.equal(walking.pawn.job,'Ingest');assert.equal(walking.pawn.position,'(112, 0, 125)');assert.equal(walking.pawn.path_destination,'(119, 0, 131)');
assert.ok(walking.reservations.includes('Thing_DiningChair149545'));assert.deepEqual(walking.destination_reservations,['(119, 0, 131)']);
assert.deepEqual(walking.pawn.carry,[{id:'MealSurvivalPack149549',def:'MealSurvivalPack',count:1}]);
assert.equal(chewing.pawn.position,'(119, 0, 131)');assert.equal(chewing.pawn.job_target_b,'(119, 0, 132)');assert.equal(chewing.pawn.ticks_left,307);assert.deepEqual(chewing.pawn.carry,walking.pawn.carry);
assert.equal(chewing.pawn.food,0.486001104);assert.equal(chewing.pawn.comfort,0.0360000022);
assert.equal(finished.pawn.job,'FeedPatient');assert.equal(finished.pawn.food,0.994000018);assert.equal(finished.pawn.comfort,0.144000009);assert.equal(finished.pawn.without_table_age,10800);
assert.ok(!finished.reservations.includes('Thing_DiningChair149545'));
for(const field of ['ticks_game','pawn','nodes','reservations','destination_reservations'])assert.deepEqual(finished[field],repeated[field]);
assert.deepEqual(r.shutdown.rimworld_processes_after_exit,[]);assert.match(r.shutdown.capture_result,/No successful action62/);

assert.equal(r.actions.length,61);unique(r.actions.map(a=>a.image_name));
for(const [i,a] of r.actions.entries()){
 assert.ok(a.image_name.startsWith(`${String(i+1).padStart(3,'0')}-`));hex(a.source_sha256);hex(a.image_sha256);
 assert.ok(Date.parse(a.finished_utc)>=Date.parse(a.started_utc));if(i)assert.ok(Date.parse(a.started_utc)>=Date.parse(r.actions[i-1].finished_utc));
 if(a.action==='pulse'){assert.ok([49,50,51].includes(a.virtual_key));assert.ok(a.duration_ms>=40&&a.duration_ms<=4000);}
 if(local){
  await hashFile(safe(a.source_file),a.source_sha256);await hashFile(safe(`.local-research/runtime/dining-20261104/${a.image_name}`),a.image_sha256);
  const records=(await readFile(safe(a.source_file),'utf8')).trim().split(/\r?\n/).map(l=>JSON.parse(l.replace(/^\uFEFF/,'')));
  const record=records.find(x=>basename(x.image)===a.image_name);assert.ok(record);
  const norm=v=>v.replace(/(\.\d*?[1-9])0+Z$/,'$1Z').replace(/\.0+Z$/,'Z');
  for(const key of ['started_utc','finished_utc'])assert.equal(norm(record[key]),norm(a[key]));
  for(const key of ['action','x','y','end_x','end_y','text','virtual_key','control','duration_ms','wheel_delta','wait_ms','park_x','park_y'])assert.deepEqual(record[key],a[key]);
 }
}
assert.equal(r.images.length,8);unique(r.images.map(s=>s.id));
for(const s of r.images){
 await hashFile(safe(`docs/research/rimworld/evidence/${s.file}`),s.sha256);const bytes=await readFile(resolve(base,s.file));
 assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),s.crop[2]);assert.equal(bytes.readUInt32BE(20),s.crop[3]);
 assert.deepEqual(s.source_dimensions,[2560,1440]);assert.ok(s.crop[0]>=0&&s.crop[1]>=0&&s.crop[0]+s.crop[2]<=2560&&s.crop[1]+s.crop[3]<=1440);
 assert.equal(r.actions.find(a=>a.image_name===basename(s.source_file))?.image_sha256,s.source_sha256);
}
assert.equal(r.observations.length,6);for(const o of r.observations)for(const id of o.evidence)assert.ok(id==='saves'||r.images.some(s=>s.id===id));
let originalProjections=0;
if(local){
 await hashFile(resolve(game,'Assembly-CSharp.dll'),m.source_sha256);
 await hashFile(resolve(root,'../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'),m.engine_sha256);
 await hashFile(safe(e.rea_members.source_file),e.rea_members.sha256);
 await hashFile(safe(r.launch.baseline_source),r.launch.baseline_source_sha256);
 await hashFile(safe(`${r.launch.profile}/Config/ModsConfig.xml`),r.launch.mods_config_sha256);
 const quote=value=>`'${value.replaceAll("'","''")}'`;
 const script=`$ErrorActionPreference='Stop'
$root=${quote(root)};$game=${quote(game)};$base=Join-Path $root 'docs/research/rimworld/evidence'
$r=Get-Content (Join-Path $base 'dining-runtime-evidence.json') -Raw|ConvertFrom-Json
$e=Get-Content (Join-Path $base 'dining-comfort-evidence.json') -Raw|ConvertFrom-Json
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
 foreach($n in $s.nodes){CheckProjection ($doc.SelectSingleNode($n.xpath)) (([xml]$n.xml).DocumentElement);$count++}
}
foreach($x in $e.xml){
 $doc=[xml](Get-Content -LiteralPath (Join-Path $game $x.file) -Raw);$nodes=$doc.SelectNodes($x.xpath)
 if($nodes.Count -ne $x.nodes.Count){throw 'Original XPath count mismatch'}
 for($i=0;$i -lt $nodes.Count;$i++){CheckProjection $nodes[$i] (([xml]$x.nodes[$i]).DocumentElement);$count++}
}
Write-Output $count`;
 const output=execFileSync('pwsh',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',maxBuffer:2*1024*1024});
 originalProjections=Number(output.trim());assert.ok(originalProjections>60);
}
let links=0;
for(const name of ['94-dining-comfort-mechanisms.md','95-native-dining-runtime.md']){
 const file=resolve(base,'..',name);
 for(const match of (await readFile(file,'utf8')).matchAll(/\]\(([^)]+)\)/g)){if(/^(?:https?:|#)/.test(match[1]))continue;await access(resolve(dirname(file),match[1].split('#')[0]));links++;}
}
console.log(JSON.stringify({mode:local?'local-artifact-integrity':'portable-record-integrity',newly_extracted_types:types.length,used_source_types:usedTypes.size,claims:e.claims.length,source_pointers:pointers,xml_selections:e.xml.length,native_saves:r.saves.length,native_actions:r.actions.length,crops:r.images.length,local_links:links,checked_file_hashes:hashes.size,original_node_projections:originalProjections,scope:'Stored evidence integrity only; no runtime replay or statistical calibration'},null,2));
