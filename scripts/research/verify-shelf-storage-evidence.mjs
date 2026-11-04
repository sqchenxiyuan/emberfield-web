import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

// Portable mode checks retained provenance and rule projections. --local replays
// the static collector against original files. Neither mode launches game code.
const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base=resolve(root, 'docs/research/rimworld/evidence');
const local=process.argv.includes('--local');
assert.ok(process.argv.slice(2).every(a=>a==='--local'), 'Only --local is supported');
const game=process.env.RIMWORLD_GAME_ROOT || 'F:/SteamLibrary/steamapps/common/RimWorld';
const expectedDLL='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3';
const expectedEngine='587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78';
const expectedMvid='8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd';
const json=async n=>JSON.parse(await readFile(resolve(base,n),'utf8'));
const digest=b=>createHash('sha256').update(b).digest('hex');
const hex=h=>assert.match(h,/^[a-f0-9]{64}$/);
const unique=values=>assert.equal(new Set(values).size,values.length);
const safe=(p,anchor=root)=>{
 assert.equal(typeof p,'string');assert.ok(p&&!isAbsolute(p)&&!/[\\:]/.test(p),p);
 const full=resolve(anchor,p),rel=relative(anchor,full);
 assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),p);return full;
};
const cache=new Map();
async function bytes(p){if(!cache.has(p))cache.set(p,await readFile(p));return cache.get(p);}
async function hashFile(p,hash){hex(hash);assert.equal(digest(await bytes(p)),hash,`Hash: ${p}`);}
const e=await json('shelf-storage-evidence.json');
assert.equal(e.evidence_id,'RW17-SHELF-STORAGE');
assert.equal(e.version_text,'1.7.4980 rev60');
assert.equal(e.source_sha256,expectedDLL);assert.equal(e.engine_sha256,expectedEngine);
assert.match(e.kind,/Static.*target not executed/);
assert.ok(e.limitations.some(v=>v.includes('No game execution')));
assert.deepEqual(e.manifests,['energy','furniture-reinstall','furniture-reinstall-extra','logistics','preservation','shelf-storage','skills','weapons','weather','work']);
const manifests=new Map();
for(const group of e.manifests){
 const m=await json(`${group}-manifest.json`);manifests.set(group,m);
 assert.equal(m.source_sha256,expectedDLL);assert.equal(m.engine_sha256,expectedEngine);
 assert.equal(m.engine_version,'11.2.0.10050');assert.equal(m.line_endings,'LF');
 unique(m.types.map(t=>t.type));unique(m.types.map(t=>t.local_file));
 for(const t of m.types){
  assert.equal(t.local_file,`.local-research/${group}/${t.type}.cs`);safe(t.local_file);hex(t.sha256);
  assert.ok(Number.isInteger(t.lines)&&t.lines>0);
 }
}
const own=manifests.get('shelf-storage');
assert.deepEqual(own.types.map(t=>t.type),await json('shelf-storage-types.json'));
assert.deepEqual(own.types.map(t=>t.type),[
 'RimWorld.SlotGroup','RimWorld.SpecialThingFilterWorker_CorpsesLarge','RimWorld.Blueprint_Storage',
 'RimWorld.StorageGroup','RimWorld.StoragePriority','Verse.GenGrid','Verse.AI.PathGrid','Verse.AI.Pawn_PathFollower'
]);
if(local)for(const t of own.types){
 await hashFile(safe(t.local_file),t.sha256);
 assert.equal((await bytes(safe(t.local_file))).toString('utf8').split('\n').length,t.lines);
}
assert.equal(e.rea.file,'shelf-storage-rea-managed.json');
await hashFile(safe(e.rea.file,base),e.rea.sha256);
const rea=await json(e.rea.file),view=rea.normalized_result,summary=view.summary;
assert.equal(rea.evidence_id,e.rea.evidence_id);
assert.equal(view.parent_evidence_id,e.rea.parent_evidence_id);
assert.equal(rea.evidence_id,'ev_107c63f87f74870b8dc7c9c2205fec8ed587133e8dc9701a85c5682d8aa43cea');
assert.equal(view.parent_evidence_id,'ev_002f7c6a8e7e5c16296ff1beb7f5dc6ac1cc486e52a65155a913c3753871a42b');
assert.equal(view.parent_operation,'inspect_managed_artifact');
for(const artifact of [rea.subject.digest,view.artifact,summary.artifact])assert.equal(artifact.sha256,expectedDLL);
assert.equal(e.rea.mvid,expectedMvid);assert.equal(summary.module.mvid,expectedMvid);
assert.equal(summary.metadata.status,'complete');assert.equal(summary.coverage.state,'complete');
assert.equal(summary.classification.implementation,'cil');assert.equal(summary.classification.managed_architecture,'anycpu');

assert.deepEqual(e.claims.map(c=>c.id),Array.from({length:14},(_,i)=>`SH${String(i+1).padStart(2,'0')}`));
assert.deepEqual(e.xml.map(x=>x.id),Array.from({length:6},(_,i)=>`SX${String(i+1).padStart(2,'0')}`));
const xmlIds=new Set(e.xml.map(x=>x.id)),used=new Set(),usedGroups=new Set();let pointers=0;
for(const c of e.claims){
 assert.ok(c.finding.length>50&&c.sources.length);unique(c.xml);
 for(const id of c.xml)assert.ok(xmlIds.has(id));
 for(const s of c.sources){
  pointers++;used.add(s.file);usedGroups.add(s.group);safe(s.file);hex(s.sha256);hex(s.excerpt_sha256);
  const found=manifests.get(s.group)?.types.filter(t=>t.type===s.type);assert.equal(found?.length,1,s.type);
  const t=found[0];assert.equal(s.file,t.local_file);assert.equal(s.sha256,t.sha256);
  assert.ok(s.lines.length===2&&s.lines.every(Number.isInteger)&&s.lines[0]>=1&&s.lines[1]>=s.lines[0]&&s.lines[1]<=t.lines);
  if(local){
   await hashFile(safe(s.file),s.sha256);
   const lines=(await bytes(safe(s.file))).toString('utf8').split('\n');assert.equal(lines.length,t.lines);
   assert.equal(digest(lines.slice(s.lines[0]-1,s.lines[1]).join('\n')),s.excerpt_sha256,`${s.file}:${s.lines}`);
  }
 }
}
assert.deepEqual([...usedGroups].sort(),e.manifests);
for(const x of e.xml){
 hex(x.source_sha256);hex(x.nodes_sha256);safe(x.file,game);
 assert.ok(x.file.startsWith('Data/Core/Defs/')&&x.xpath.startsWith('/Defs/'));
 assert.match(x.projection,/MayRequire is retained, not evaluated/);
 assert.ok(x.nodes.length&&x.nodes.every(n=>n.startsWith('<')));
 assert.equal(digest(x.nodes.join('\n')),x.nodes_sha256);
 if(local)await hashFile(safe(x.file,game),x.source_sha256);
}
// These helpers inspect the known, retained XML projection, not arbitrary XML.
const block=(s,n)=>(s||'').match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`))?.[1];
const attr=(s,n)=>s.slice(0,s.indexOf('>')).match(new RegExp(`\\b${n}="([^"]*)"`))?.[1]??'';
const list=s=>[...(s||'').matchAll(/<li(?:\s[^>]*)?>([^<]*)<\/li>/g)].map(m=>m[1]);
const all=e.xml.flatMap(x=>x.nodes);
const node=(type,name)=>{
 const found=all.filter(s=>s.startsWith(`<${type}`)&&(block(s,'defName')===name||attr(s,'Name')===name));
 assert.equal(found.length,1,name);return found[0];
};
const path=(s,p)=>p.split('/').reduce((v,part)=>block(v,part),s);
assert.deepEqual(e.shelves.map(s=>s.def),['Shelf','ShelfSmall']);
for(const [i,s] of e.shelves.entries()){
 assert.deepEqual(s.chain,[s.def,'StorageShelfBase','ShelfBase','FurnitureBase','BuildingBase']);
 for(let j=0;j<s.chain.length;j++)assert.equal(attr(node('ThingDef',s.chain[j]),'ParentName'),s.chain[j+1]??'');
 assert.equal(s.quality_component_in_selected_chain,false);
 for(const name of s.chain)assert.doesNotMatch(node('ThingDef',name),/Class="CompProperties_Quality"/);
 for(const [key,f] of Object.entries(s.fields)){
  const owner=s.chain.find(n=>path(node('ThingDef',n),key)!==undefined);
  assert.equal(f.origin,owner);assert.equal(f.value,path(node('ThingDef',owner),key));
 }
 const expected={thingClass:'Building_Storage',category:'Building',size:['(2,1)','(1,1)'][i],passability:'PassThroughOnly',pathCost:'50',surfaceType:'Item',canOverlapZones:'false',minifiedDef:'MinifiedThing',costStuffCount:['20','10'][i],'statBases/MaxHitPoints':['100','50'][i],'statBases/WorkToBuild':['500','250'][i],'building/maxItemsInCell':'3','building/preventDeteriorationOnTop':'true','building/ignoreStoredThingsBeauty':'true','building/defaultStorageSettings/priority':'Preferred','researchPrerequisites/li':'ComplexFurniture','thingCategories/li':'BuildingsFurniture'};
 assert.deepEqual(Object.keys(s.fields).sort(),Object.keys(expected).sort());
 for(const [key,value] of Object.entries(expected))assert.equal(s.fields[key].value,value);
 const dimensions=s.fields.size.value.match(/\d+/g).map(Number);
 assert.equal(dimensions[0]*dimensions[1]*Number(s.fields['building/maxItemsInCell'].value),[6,3][i]);
}
const shelfBase=node('ThingDef','ShelfBase'),storage=node('ThingDef','StorageShelfBase');
assert.equal(block(shelfBase,'fillPercent'),'0.4');assert.equal(block(shelfBase,'defaultPlacingRot'),'South');
assert.deepEqual(list(block(shelfBase,'stuffCategories')),['Metallic','Woody','Stony']);
assert.equal(block(shelfBase,'blueprintClass'),'Blueprint_Storage');assert.equal(block(storage,'storageGroupTag'),'Shelf');
const fixed=block(storage,'fixedStorageSettings'),defaults=block(storage,'defaultStorageSettings');
assert.equal(block(fixed,'disallowNotEverStorable'),'true');assert.deepEqual(list(block(fixed,'categories')),['Root']);
assert.deepEqual(list(block(fixed,'disallowedCategories')),['Chunks','Plants','Buildings']);
assert.deepEqual(list(block(fixed,'specialFiltersToDisallow')),['AllowLargeCorpses']);
assert.match(fixed,/<disallowedThingDefs MayRequire="Ludeon.RimWorld.Biotech"><li MayRequire="Ludeon.RimWorld.Biotech">Wastepack<\/li>/);
assert.deepEqual(list(block(defaults,'categories')),['Foods','Manufactured','ResourcesRaw','Items','Weapons','Apparel','BodyParts']);
assert.equal(block(defaults,'priority'),'Preferred');
assert.equal(block(node('ThingCategoryDef','BuildingsFurniture'),'parent'),'Buildings');
assert.equal(block(node('ThingCategoryDef','Buildings'),'parent'),'Root');
assert.equal(block(node('SpecialThingFilterDef','AllowLargeCorpses'),'workerClass'),'SpecialThingFilterWorker_CorpsesLarge');
assert.equal(block(node('SpecialThingFilterDef','AllowLargeCorpses'),'parentCategory'),'Corpses');
assert.equal(block(node('ThingDef','MinifiedThing'),'category'),'Item');
const deterioration=node('StatDef','DeteriorationRate');
assert.match(deterioration,/<li Class="StatPart_EnvironmentalEffects">/);
assert.equal(block(deterioration,'protectedByEdificeFactor'),'0');

let localReplay='not requested';
if(local){
 await hashFile(resolve(game,'Assembly-CSharp.dll'),expectedDLL);
 await hashFile(resolve(root,'../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'),expectedEngine);
 localReplay=execFileSync('pwsh',['-NoProfile','-NonInteractive','-File',resolve(root,'scripts/research/collect-shelf-storage-evidence.ps1'),'-GameRoot',game,'-Check'],{encoding:'utf8',maxBuffer:2*1024*1024}).trim();
 assert.equal(localReplay,'Shelf source/XML replay verified: 14 claims');
}
const doc=resolve(base,'../111-shelf-storage-mechanisms.md');let links=0;
for(const match of (await readFile(doc,'utf8')).matchAll(/\]\(([^)]+)\)/g)){
 if(/^(?:https?:|#)/.test(match[1]))continue;
 await access(resolve(dirname(doc),match[1].split('#')[0]));links++;
}
console.log(JSON.stringify({mode:local?'local-static-artifact-replay':'portable-record-integrity',claims:e.claims.length,newly_extracted_types:own.types.length,used_source_types:used.size,source_pointers:pointers,xml_selections:e.xml.length,xml_nodes:all.length,manifests:e.manifests.length,local_links:links,checked_files:cache.size,local_replay:localReplay,scope:'Retained static evidence only; no game execution, runtime shelf trial or calibrated movement/decay'},null,2));
