import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {medicineModels} from './medicine-model.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const identity={version:'1.7.4980 rev60',assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'};
// Deliberately reviewed pins; neither XML collector nor curated writer updates these.
const pins={
 'medicine-types.json':'7495c528e89d76d19bf1b944f71d6c3cfd73877554f6932f2dd502848d2076b6',
 'medicine-manifest.json':'7262beb189caff0bf9e080371e3e3752d0edc73471b1c18dc7eb244502d3542f',
 'medicine-xml.json':'bf9e98e293066c3c6609bbfc9f4a49fbd324f04bc7ba1d6b7442f916c2452e2a',
 'medicine-data.json':'4909335998678dcbe127e613acf50bb2ce6aaa02be1d35b66d769fae5785972e',
 'medicine-claims.json':'31ece48b11ac6f5626fc5c9e98cc35c7f992354c86e79ad198085dd0556aebba',
 'medicine-cases.json':'950377652c08f67f8a47daf272c2834919b4e403767be6804d58b36914b14608',
 'preservation-manifest.json':'63b9fed552b16b593cf74589d610bc3ca396faf79ae07ca9fb1b3283c7962185',
 'generation-manifest.json':'e2e357427b447f4d68236891430ad1212339d336fc2eda2b5859aee33c443b91',
 'plants-manifest.json':'de6122f08d689095163bb129d312beb076737b5e4ecc87492610549b7117f9d2',
 'food-manifest.json':'133b8d8b4dadf25edd4667c3276c22a636cf639c84a0ae811998c304b00d6823',
 'survival-manifest.json':'c4181eaeb6a69a8aa0d0ec95115782c99d86a8fc127b52d5f5d9cb96aa5ed443',
 'injuries-manifest.json':'c39107d56e4c4ed4f76076baa8d8c3c1d2e85d26f4098a6d383cd10b4d7b42e8',
 'energy-manifest.json':'d9d48c42d1ad87f21f4cfda817d78eb8cb77ca519d1dda0338f16ebb96ab87fa',
 'combat-manifest.json':'6e2c1683d4bd75d41a2ff0c7e0d439f32a9f7ab884a27e1504aca0f0d35ac83c',
 'housing-manifest.json':'460be621c5f0a681a05ced165e76d495f30bae3e4b3c80394ee1d0eecb36ce4e',
 'economy-manifest.json':'153d5521f7f8287a8c89895ccad10b574ac6ece8b6e630881840fd9e16b6865e',
 'environment-manifest.json':'52b7cf27b482e0b8c596204dac97d8989b51e0bb693ce95c0c7bc4a4ee55d7d3',
 'technology-manifest.json':'f0301a15e9e976e14acac5ce89aed6e25c146c3be125c95b391bc5c6afe0d3da',
};
export function compareMedicine(a,e,label='case'){
 let assertions=0;
 const visit=(a,e,label)=>{if(typeof e==='number'){assert(Number.isFinite(a)&&Math.abs(a-e)<1e-9,`${label}: ${a} != ${e}`);assertions++;}else if(Array.isArray(e)){assert(Array.isArray(a));assert.equal(a.length,e.length,label);e.forEach((v,i)=>visit(a[i],v,`${label}[${i}]`));}else if(e&&typeof e==='object'){assert(a&&typeof a==='object');assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort(),label);for(const[k,v]of Object.entries(e))visit(a[k],v,label+'.'+k);}else{assert.equal(a,e,label);assertions++;}};
 visit(a,e,label);return assertions;
}
export function verifyMedicineEvidence({root=project,local=false,overrides={},localTransform}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence'),read=n=>overrides[n]??JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
 for(const[file,pin]of Object.entries(pins))assert.equal(sha(JSON.stringify(read(file))),pin,'Reviewed snapshot changed: '+file);
 const xml=read('medicine-xml.json'),data=read('medicine-data.json'),claims=read('medicine-claims.json'),cases=read('medicine-cases.json'),names=read('medicine-types.json');
 assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.version_text,identity.version);assert.equal(xml.records.length,50);
 const records=new Map(),xmlFiles=new Map();let xmlLeaves=0,xmlAttributes=0,xmlAbsences=0;
 for(const r of xml.records){assert(!records.has(r.id));records.set(r.id,r);assert(r.source.path.startsWith('Data/Core/Defs/')&&!r.source.path.includes('..'));assert(/^[a-f0-9]{64}$/.test(r.source.sha256));if(xmlFiles.has(r.source.path))assert.equal(xmlFiles.get(r.source.path),r.source.sha256);xmlFiles.set(r.source.path,r.source.sha256);assert(r.selected_paths.length);assert.equal(new Set(r.fields.map(f=>f.xpath)).size,r.fields.length);for(const f of r.fields)assert(f.xpath.startsWith(r.source.xpath+'/'));for(const a of r.node_attributes)assert(a.xpath.startsWith(r.source.xpath+'/'));xmlLeaves+=r.fields.length;xmlAttributes+=r.node_attributes.length;xmlAbsences+=r.absent_paths.length;}
 const field=(id,key)=>{const r=records.get(id);assert(r,id);return r.fields.find(f=>f.xpath===r.source.xpath+'/'+key)?.value;};
 const named=new Map(xml.records.filter(r=>r.name_attribute).map(r=>[r.name_attribute,r]));
 for(const r of xml.records){assert(Number.isSafeInteger(r.source.line_start)&&r.source.line_start>0&&r.source.line_end>=r.source.line_start);if(r.parent_name)assert(named.has(r.parent_name),'Unresolved selected parent: '+r.parent_name);}
 const bedChain=[];let bed=records.get('ThingDef_Bed'),bedImmunity;
 while(bed){assert(!bedChain.includes(bed.def_name),'Cyclic bed inheritance');bedChain.push(bed.def_name);bedImmunity??=field(bed.id,'statBases/ImmunityGainSpeedFactor');bed=bed.parent_name?named.get(bed.parent_name):null;}
 assert.deepEqual(bedChain,data.beds.ordinarySourceChain);assert.equal(+bedImmunity,data.beds.ordinary);assert.equal(data.beds.ordinary,1.07);assert.equal(records.get('ThingDef_SansComfortBedBase').source.line_start,159);assert.equal(records.get('ThingDef_SansComfortBedBase').source.line_end,184);assert.equal(+field('ThingDef_HospitalBed','statBases/ImmunityGainSpeedFactor'),data.beds.hospital);
 for(const name of ['Cut','Stab','Gunshot','Crush','Bite','Bruise','Crack']){const r=records.get('HediffDef_'+name),comp=r.node_attributes.find(a=>a.attributes.Class==='HediffCompProperties_Infecter');if(data.injuryRisk[name]===undefined)assert.equal(comp,undefined);else{assert(comp,name);assert.equal(+r.fields.find(f=>f.xpath===comp.xpath+'/infectionChance').value,data.injuryRisk[name]);}}
 for(const id of ['Herbal','Industrial','Ultratech']){assert.equal(+field('ThingDef_Medicine'+id,'statBases/MedicalPotency'),data.medicines[id].potency);assert.equal(+field('ThingDef_Medicine'+id,'statBases/MedicalQualityMax'),data.medicines[id].maxQuality);}
 assert.equal(field('ThingDef_MedicineBase','stackLimit'),'25');assert.equal(field('ThingDef_MedicineBase','statBases/MaxHitPoints'),'60');assert.equal(field('ThingDef_MedicineHerbal','comps/li/daysToRotStart'),String(data.healroot.herbalRotDays));assert.equal(field('ThingDef_MedicineHerbal','comps/li/rotDestroys'),'true');
 assert(records.get('ThingDef_MedicineUltratech').absent_paths.includes('recipeMaker'));
 for(const[k,v]of Object.entries({sowWork:data.healroot.sowWork,sowMinSkill:data.healroot.sowMinSkill,growDays:data.healroot.cultivatedGrowDays}))assert.equal(+field('ThingDef_Plant_Healroot','plant/'+k),v);
 assert.equal(+field('ThingDef_HealrootBase','plant/growDays'),data.healroot.wildGrowDays);assert.equal(+field('ThingDef_HealrootBase','plant/harvestYield'),data.healroot.yield);assert.equal(+field('ThingDef_HealrootBase','plant/harvestWork'),data.healroot.harvestWork);
 const immunizable='comps/li[2]/';for(const[k,v]of Object.entries({severityPerDayNotImmune:data.disease.sick,severityPerDayImmune:data.disease.immune,immunityPerDaySick:data.disease.immunitySick,immunityPerDayNotSick:data.disease.immunityHealthy}))assert.equal(+field('HediffDef_WoundInfection',immunizable+k),v);
 assert.equal(+field('HediffDef_WoundInfection','comps/li[1]/severityPerDayTended'),data.disease.tended);assert.equal(+field('HediffDef_WoundInfection','comps/li[1]/baseTendDurationHours'),data.tend.baseHours);assert.equal(+field('HediffDef_InfectionBase','initialSeverity'),data.disease.initial);assert.equal(+field('HediffDef_WoundInfection','lethalSeverity'),data.disease.lethal);
 assert.equal(field('StatDef_MedicalTendSpeed','statFactors/li'),'WorkSpeedGlobal');assert.equal(field('StatDef_Cleanliness','defaultBaseValue'),'0');assert.equal(field('TerrainDef_Soil','statBases/Cleanliness'),'-1');assert.equal(field('StatDef_ImmunityGainSpeedFactor','defaultBaseValue'),'1');assert.equal(field('ThingDef_HospitalBed','statBases/ImmunityGainSpeedFactor'),'1.11');
 const parseCurve=(id,prefix)=>records.get(id).fields.filter(f=>f.xpath.startsWith(records.get(id).source.xpath+'/'+prefix)).map(f=>f.value.replace(/[()]/g,'').split(',').map(Number));
 assert.deepEqual(parseCurve('RoomStatDef_InfectionChanceFactor','curve/points/'),data.roomCurve);assert.deepEqual(parseCurve('StatDef_MedicalTendQuality','postProcessCurve/points/'),data.medicalQualityCurve);assert.deepEqual(parseCurve('StatDef_ImmunityGainSpeed','parts/li[5]/curve/points/'),data.ageCurve);
 const groups=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))],types=new Map();
 for(const g of groups){assert(pins[g+'-manifest.json']);const m=read(g+'-manifest.json');assert.equal(m.source_sha256,identity.assembly);assert.equal(m.engine_sha256,identity.engine);assert.equal(m.version_text,identity.version);assert.equal(m.engine_version,'11.2.0.10050');for(const t of m.types){assert.equal(t.local_file,`.local-research/${g}/${t.type}.cs`);types.set(g+':'+t.type,t);}}
 assert.deepEqual(names,read('medicine-manifest.json').types.map(t=>t.type));assert.equal(names.length,13);
 assert.deepEqual(claims.map(c=>c.id),Array.from({length:17},(_,i)=>'MD'+String(i+1).padStart(2,'0')));
 const selected=new Set(),localFiles=new Map();let codeReferences=0,xmlReferences=0;
 for(const c of claims){assert(['xml-and-static-derived','design-adaptation'].includes(c.kind));assert(c.sources.length&&c.statement.length>20);for(const s of c.sources){assert(Boolean(s.type)!==Boolean(s.xml_record));if(s.type){const k=s.group+':'+s.type,r=types.get(k);assert(r,k);assert(Number.isInteger(s.line_start)&&Number.isInteger(s.line_end)&&s.line_start>0&&s.line_start<=s.line_end&&s.line_end<=r.lines);assert(/^[a-f0-9]{64}$/.test(s.range_sha256));selected.add(k);codeReferences++;
   if(local){if(!localFiles.has(k)){let b=readFileSync(path.join(root,r.local_file));if(localTransform)b=localTransform(k,b);assert.equal(sha(b),r.sha256,'Derived changed: '+k);const lines=b.toString('utf8').split('\n');assert.equal(lines.length,r.lines);localFiles.set(k,lines);}assert.equal(sha(localFiles.get(k).slice(s.line_start-1,s.line_end).join('\n')),s.range_sha256);}
  }else{assert.equal(s.group,'medicine');assert(records.has(s.xml_record),s.xml_record);assert.equal(s.xml_line_start,records.get(s.xml_record).source.line_start);assert.equal(s.xml_line_end,records.get(s.xml_record).source.line_end);xmlReferences++;}}}
 assert(names.every(n=>selected.has('medicine:'+n)));assert.equal(selected.size,46);
 const evaluate=medicineModels(data);let analyticAssertions=0;assert.equal(cases.length,61);assert.deepEqual(cases.map(c=>c.id),Array.from({length:61},(_,i)=>'MV'+String(i+1).padStart(2,'0')));
 for(const c of cases){assert(evaluate[c.model]);assert(c.claims.length&&c.claims.every(id=>claims.some(q=>q.id===id)));assert(c.limitation.includes('not original execution'));analyticAssertions+=compareMedicine(evaluate[c.model](c.inputs),c.expected,c.id);}
 return{status:'pass',version:identity.version,newTypes:names.length,reusedTypes:selected.size-names.length,claims:claims.length,cases:cases.length,codeReferences,xmlReferences,xmlRecords:xml.records.length,referencedXmlFiles:xmlFiles.size,xmlLeaves,xmlAttributes,xmlAbsences,analyticAssertions,localDerivedFilesVerified:localFiles.size,originalGameExecuted:false,scope:'Static artifact and independent double-precision arithmetic/state verification; no native random stream, enabled-mod database or project simulation equivalence.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyMedicineEvidence({local:process.argv.includes('--local')}),null,2));
