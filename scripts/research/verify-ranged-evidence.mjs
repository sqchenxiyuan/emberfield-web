import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {rangedData,rangedModels} from './ranged-model.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const identity={version:'1.7.4980 rev60',assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'};
// Reviewed semantic pins. Neither collector nor evidence writer may update these.
const pins={
 'ranged-types.json':'fde1b74ee51d4ff507ce79aa4f012f7a802be0c7a3d49781a57653670af059cb',
 'ranged-manifest.json':'1ac70d60733e7deb5249e646449495f7c4ec1a55b769974ef85972018bdf6ff7',
 'ranged-xml.json':'42b4e40a6ba2a2b2a6aecae7f03531ac16508c3fec3c7db8792215f0fa44c64b',
 'ranged-data.json':'407c3aa41a970bd18a160d3ec270e612abc28cc81fb74fd8293281daed817512',
 'ranged-claims.json':'72e5ecf91eaa13903546885541dcf538dac957cba92e67ca73667209f3a7cde8',
 'ranged-cases.json':'a7b2f9facfb35ba0edabb229aad02c5fec243de84951d3ecb41c0a818bfae2da',
 'weapons-manifest.json':'db557b2e2bacf8fbd2aff71528a187395445de7618ea63b4c478e77bbe3f2f1a',
 'apparel-manifest.json':'54c34415dcfd32aa2f0054103c162ab7e297a8f5cd8008419dd37ffd30de2dd3',
 'armor-manifest.json':'d46df8ff55b4833fdaebea57f918ad2282b9d8b3c5c162c45000617908c9681e',
 'injuries-manifest.json':'c39107d56e4c4ed4f76076baa8d8c3c1d2e85d26f4098a6d383cd10b4d7b42e8',
 'combat-manifest.json':'6e2c1683d4bd75d41a2ff0c7e0d439f32a9f7ab884a27e1504aca0f0d35ac83c',
 'housing-manifest.json':'460be621c5f0a681a05ced165e76d495f30bae3e4b3c80394ee1d0eecb36ce4e',
 'skills-manifest.json':'43fb34340054aa87a8e0cd8217945f11770bd3822d2f4d5afb80631bc6a7711d',
 'energy-manifest.json':'d9d48c42d1ad87f21f4cfda817d78eb8cb77ca519d1dda0338f16ebb96ab87fa',
 'survival-manifest.json':'c4181eaeb6a69a8aa0d0ec95115782c99d86a8fc127b52d5f5d9cb96aa5ed443',
 'food-manifest.json':'133b8d8b4dadf25edd4667c3276c22a636cf639c84a0ae811998c304b00d6823',
 'generation-manifest.json':'e2e357427b447f4d68236891430ad1212339d336fc2eda2b5859aee33c443b91',
 'stonecutting-manifest.json':'dbe06849c5b123baad629014739672fd6206bc5ad5ff0cdd32652f2d1f915d53',
 'preservation-manifest.json':'63b9fed552b16b593cf74589d610bc3ca396faf79ae07ca9fb1b3283c7962185'
};
export function verifyRangedEvidence({root=project,local=false}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence'),read=n=>JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
 assert.equal(Object.keys(pins).length,19);
 for(const[file,pin]of Object.entries(pins))assert.equal(sha(JSON.stringify(read(file))),pin,'Reviewed snapshot changed: '+file);
 const xml=read('ranged-xml.json'),data=read('ranged-data.json'),claims=read('ranged-claims.json'),cases=read('ranged-cases.json'),names=read('ranged-types.json');
 assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.version_text,identity.version);assert.equal(xml.records.length,80);
 assert.deepEqual(rangedData(xml),data,'Derived data differ from independently reviewed XML/defaults.');
 assert.deepEqual(data.accuracyQuality,[.8,.9,1,1.1,1.2,1.35,1.5]);assert.deepEqual(data.damageQuality,[.9,1,1,1,1,1.25,1.5]);assert.deepEqual(data.damageQuality,data.penetrationQuality);
 const records=new Map(),xmlFiles=new Map();let xmlLeaves=0,xmlAttributes=0,xmlAbsences=0;
 for(const r of xml.records){assert(!records.has(r.id),'Duplicate record');records.set(r.id,r);assert(r.source.path.startsWith('Data/Core/Defs/')&&!r.source.path.includes('..'));assert(/^[a-f0-9]{64}$/.test(r.source.sha256));if(xmlFiles.has(r.source.path))assert.equal(xmlFiles.get(r.source.path),r.source.sha256);xmlFiles.set(r.source.path,r.source.sha256);assert(r.selected_paths.length);assert.equal(new Set(r.fields.map(f=>f.xpath)).size,r.fields.length);for(const f of r.fields)assert(f.xpath.startsWith(r.source.xpath+'/'));for(const a of r.node_attributes)assert(a.xpath.startsWith(r.source.xpath+'/'));xmlLeaves+=r.fields.length;xmlAttributes+=r.node_attributes.length;xmlAbsences+=r.absent_paths.length;}
 const field=(id,k)=>{const r=records.get(id);assert(r,id);return r.fields.find(f=>f.xpath===r.source.xpath+'/'+k)?.value;};
 const named=new Map(xml.records.filter(r=>r.name_attribute).map(r=>[r.name_attribute,r]));
 for(const r of xml.records.filter(r=>r.group!=='stuff'))if(r.parent_name)assert(named.has(r.parent_name),'Unresolved parent: '+r.parent_name);
 for(const w of data.weapons){assert.equal(w.stuff,null);assert.equal(w.maxHP,100);assert.equal(w.verb,'Verb_Shoot');assert.equal(w.workSkill,'Crafting');assert.equal(w.workSpeedStat,'GeneralLaborSpeed');for(const id of w.sourceChain){assert(records.get(id).absent_paths.includes('stuffCategories'));assert(records.get(id).absent_paths.includes('costStuffCount'));}}
 assert.equal(data.weapons.find(w=>w.id==='Gun_Autopistol').burst,1);assert.equal(data.weapons.find(w=>w.id==='Gun_MachinePistol').burst,3);assert.equal(data.weapons.find(w=>w.id==='Gun_MachinePistol').burstInterval,7);
 assert.deepEqual(data.projectiles.map(p=>p.speedTilesPerTick),[.44,.55,.55,.55]);assert.deepEqual(data.projectiles.map(p=>p.stoppingPower),[.5,1,.5,.5]);
 assert.equal(data.bench.power,350);assert.equal(data.bench.unpoweredFactor,0);assert.equal(data.bench.notRoomFactor,.8);assert.deepEqual(data.bench.cost,{Steel:150,ComponentIndustrial:5});
 for(const id of ['TableMachining','BenchBase','BuildingBase'])assert.equal(field('ThingDef_'+id,'building/unpoweredWorkTableWorkSpeedFactor'),undefined);
 assert.deepEqual(data.research.map(r=>r.cost),[1000,500,500]);assert(data.damage.every(d=>d.worker==='DamageWorker_AddInjury'&&d.category==='Sharp'&&d.harmAllLayersUntilOutside));assert.equal(data.damage[0].solid,null);assert.equal(data.damage[1].solid,'Crack');
 for(const id of ['Bullet','Arrow'])for(const k of ['buildingDamageFactor','buildingDamageFactorPassable','buildingDamageFactorImpassable','plantDamageFactor'])assert(records.get('DamageDef_'+id).absent_paths.includes(k));
 for(const r of xml.records.filter(r=>['cover','plant','building-parent'].includes(r.group)&&r.def_name!=='Wall'))assert(r.absent_paths.includes('damageMultipliers'));
 assert.deepEqual(records.get('ThingDef_Wall').fields.filter(f=>f.xpath.includes('/damageMultipliers/')&&f.xpath.endsWith('/damageDef')).map(f=>f.value),['Bomb','Thump']);
 const groups=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))],types=new Map();
 for(const group of groups){assert(/^[a-z][a-z0-9-]+$/.test(group));assert(pins[group+'-manifest.json']);const m=read(group+'-manifest.json');assert.equal(m.source_sha256,identity.assembly);assert.equal(m.engine_sha256,identity.engine);assert.equal(m.version_text,identity.version);assert.equal(m.engine_version,'11.2.0.10050');for(const t of m.types){assert.equal(t.local_file,`.local-research/${group}/${t.type}.cs`);types.set(group+':'+t.type,t);}}
 assert.deepEqual(names,read('ranged-manifest.json').types.map(t=>t.type));assert.equal(names.length,20);
 const selected=new Set(),localFiles=new Map();let codeReferences=0,xmlReferences=0;
 assert.deepEqual(claims.map(c=>c.id),Array.from({length:23},(_,i)=>'RG'+String(i+1).padStart(2,'0')));
 for(const c of claims){assert(['xml-and-static-derived','design-adaptation'].includes(c.kind));assert(c.sources.length&&c.statement.length>20);for(const s of c.sources){assert(Boolean(s.type)!==Boolean(s.xml_record));if(s.type){const k=s.group+':'+s.type,r=types.get(k);assert(r,k);assert(Number.isInteger(s.line_start)&&Number.isInteger(s.line_end)&&s.line_start>0&&s.line_start<=s.line_end&&s.line_end<=r.lines,k);assert(/^[a-f0-9]{64}$/.test(s.range_sha256));selected.add(k);codeReferences++;
   if(local){if(!localFiles.has(k)){const b=readFileSync(path.join(root,r.local_file));assert.equal(sha(b),r.sha256,'Derived changed: '+k);const lines=b.toString('utf8').split('\n');assert.equal(lines.length,r.lines);localFiles.set(k,lines);}assert.equal(sha(localFiles.get(k).slice(s.line_start-1,s.line_end).join('\n')),s.range_sha256);}
  }else{assert.equal(s.group,'ranged');assert(records.has(s.xml_record));xmlReferences++;}}}
 assert(names.every(n=>selected.has('ranged:'+n)));assert.equal(selected.size,62);
 let analyticAssertions=0;function compare(a,e,label){if(typeof e==='number'){assert(Number.isFinite(a)&&Math.abs(a-e)<1e-8,`${label}: ${a} != ${e}`);analyticAssertions++;}else if(Array.isArray(e)){assert(Array.isArray(a));assert.equal(a.length,e.length,label);e.forEach((v,n)=>compare(a[n],v,label+'['+n+']'));}else if(e&&typeof e==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort());for(const[k,v]of Object.entries(e))compare(a[k],v,label+'.'+k);}else{assert.equal(a,e,label);analyticAssertions++;}}
 const evaluate=rangedModels(data);assert.equal(cases.length,50);assert.deepEqual(cases.map(c=>c.id),Array.from({length:50},(_,i)=>'RV'+String(i+1).padStart(2,'0')));
 for(const c of cases){assert(evaluate[c.model]);assert(c.claims.length&&c.claims.every(id=>claims.some(q=>q.id===id)));assert(c.limitation.includes('not original execution'));compare(evaluate[c.model](c.inputs),c.expected,c.id);}
 return{status:'pass',version:identity.version,weapons:data.weapons.length,projectiles:data.projectiles.length,covers:data.covers.length,newTypes:names.length,reusedTypes:selected.size-names.length,claims:claims.length,cases:cases.length,codeReferences,xmlReferences,xmlRecords:xml.records.length,referencedXmlFiles:xmlFiles.size,xmlLeaves,xmlAttributes,xmlAbsences,analyticAssertions,localDerivedFilesVerified:localFiles.size,originalGameExecuted:false,scope:'Static artifact and independent double-precision arithmetic/state verification. No native random-stream replay, effective mod database or project integration equivalence.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyRangedEvidence({local:process.argv.includes('--local')}),null,2));
