import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifySurvivalEvidence} from './verify-survival-evidence.mjs';

const project=fileURLToPath(new URL('../../',import.meta.url));
const out=path.join(project,'test-results/survival-verifier-negative');
const snapshot=path.join(out,'snapshot'),folder=path.join(snapshot,'docs/research/rimworld/evidence');
mkdirSync(folder,{recursive:true});
const names=[...['survival','food','housing','combat','environment','generation'].flatMap(g=>[`${g}-manifest.json`,`${g}-types.json`]),'survival-claims.json','survival-cases.json','survival-xml.json'];
const original=new Map();
for(const name of names){const bytes=readFileSync(path.join(project,'docs/research/rimworld/evidence',name));original.set(name,bytes);writeFileSync(path.join(folder,name),bytes);}
assert.equal(verifySurvivalEvidence({root:snapshot}).status,'pass');
const report={status:'passed',scope:'Copied metadata rejection probes; canonical evidence, implementation and original gameplay are not modified or executed.',checks:[]};
function reject(name,file,mutate){const value=JSON.parse(original.get(file).toString().replace(/^\uFEFF/,''));mutate(value);writeFileSync(path.join(folder,file),JSON.stringify(value));try{assert.throws(()=>verifySurvivalEvidence({root:snapshot}),undefined,name);report.checks.push({name,rejected:true});console.log('PASS rejects',name);}finally{writeFileSync(path.join(folder,file),original.get(file));}}
const rec=(v,id)=>v.records.find(r=>r.id===id);
const field=(v,id,key)=>{const r=rec(v,id);return r.fields.find(f=>f.xpath===r.source.xpath+'/'+key);};

reject('wrong version','survival-manifest.json',v=>{v.version_text='1.6';});
reject('wrong assembly','survival-manifest.json',v=>{v.source_sha256='0'.repeat(64);});
reject('wrong analysis engine','survival-manifest.json',v=>{v.engine_sha256='0'.repeat(64);});
reject('changed type list','survival-types.json',v=>{v.pop();});
reject('derived path traversal','survival-manifest.json',v=>{v.types[0].local_file='../../secret.cs';});
reject('reused source identity changed','food-manifest.json',v=>{v.source_sha256='0'.repeat(64);});
reject('code range out of bounds','survival-claims.json',v=>{v[0].sources[0].line_end=999999;});
reject('unknown code group','survival-claims.json',v=>{v[0].sources[0].group='other';});
reject('unknown code type','survival-claims.json',v=>{v[0].sources[0].type='Verse.Unknown';});
reject('duplicate claim identity','survival-claims.json',v=>{v[1].id=v[0].id;});
reject('feeding boundary widened','survival-cases.json',v=>{v[0].expected.feedingHungry[7]=true;});
reject('instant malnutrition cure','survival-cases.json',v=>{v[1].expected.severity[3]=0;});
reject('personal rate incorrectly affects food','survival-cases.json',v=>{v[1].expected.food[3]=.89488;});
reject('thermal safety threshold is inclusive','survival-cases.json',v=>{v[5].expected.severity[1]=.50075;});
reject('heated terrain recovers newly created cold','survival-cases.json',v=>{v[5].expected.severity[6]=0;});
reject('heat overage curve changed','survival-cases.json',v=>{v[6].expected.adjusted[3]=37.5;});
reject('heat neutral zone incorrectly recovers','survival-cases.json',v=>{v[7].expected.severity[1]=.4865;});
reject('ability offset treated as final capacity','survival-cases.json',v=>{v[10].expected.moving[4]=.7;});
reject('consciousness equality incorrectly downed','survival-cases.json',v=>{v[11].expected.downed[1]=true;});
reject('generic initial severity incorrectly retained','survival-cases.json',v=>{v[12].expected.severity[1]=.5011325;});
reject('tendable assumption grants medical rest','survival-cases.json',v=>{v[14].expected.medicalRest[7]=true;});
reject('feed timing ignores multiplier','survival-cases.json',v=>{v[17].expected.chewTicks=500;});
reject('pickup rounding confused with consumption','survival-cases.json',v=>{v[17].expected.consumed[2]=2;});
reject('death guard ignored in nutrition assignment','survival-cases.json',v=>{v[18].expected.newFood[2]=.9;});
reject('source ticks copied into project calendar','survival-cases.json',v=>{v[19].expected.projectIntervals[0]=150;});
reject('boundary removed self consistently','survival-cases.json',v=>{v[0].inputs.food.pop();v[0].expected.category.pop();v[0].expected.hungerMultiplier.pop();v[0].expected.feedingHungry.pop();});
reject('numeric scope limitation removed','survival-cases.json',v=>{delete v[0].limitation;});
reject('XML source path traversal','survival-xml.json',v=>{v.records[0].source.path='../../secret.xml';});
reject('wrong XML source hash','survival-xml.json',v=>{v.records[0].source.sha256='0'.repeat(64);});
reject('changed selected XML parent','survival-xml.json',v=>{rec(v,'ThingDef_MealSimple').parent_name='MealBase';});
reject('default absence probe removed','survival-xml.json',v=>{rec(v,'HediffDef_Malnutrition').absent_paths.pop();});
reject('naked human minimum confused with Stat default','survival-xml.json',v=>{field(v,'ThingDef_Human','statBases/ComfyTemperatureMin').value='0';});
reject('naked human maximum changed','survival-xml.json',v=>{field(v,'ThingDef_Human','statBases/ComfyTemperatureMax').value='40';});
reject('malnutrition lethal severity changed','survival-xml.json',v=>{field(v,'HediffDef_Malnutrition','lethalSeverity').value='2';});
reject('temperature stage threshold changed','survival-xml.json',v=>{field(v,'HediffDef_Hypothermia','stages/li[5]/minSeverity').value='.8';});
reject('moving capable threshold changed','survival-xml.json',v=>{field(v,'PawnCapacityDef_Moving','minForCapable').value='.3';});
reject('untendable disease made tendable','survival-xml.json',v=>{const r=rec(v,'HediffDef_Heatstroke');r.absent_paths=r.absent_paths.filter(p=>p!=='tendable');r.fields.push({xpath:r.source.xpath+'/tendable',value:'true'});});
reject('hospital healing incorrectly altered','survival-xml.json',v=>{field(v,'ThingDef_HospitalBed','building/bed_healPerDay').value='100';});
reject('meal ingest timing override inserted','survival-xml.json',v=>{const r=rec(v,'ThingDef_MealSimple');r.absent_paths=r.absent_paths.filter(p=>p!=='ingestible/baseIngestTicks');r.fields.push({xpath:r.source.xpath+'/ingestible/baseIngestTicks',value:'100'});});
reject('temperature giver Class lost','survival-xml.json',v=>{delete rec(v,'HediffGiverSetDef_OrganicStandard').node_attributes[0].attributes.Class;});
reject('unreviewed leaf removed','survival-xml.json',v=>{rec(v,'HediffDef_Hypothermia').fields.pop();});

const first=JSON.parse(original.get('food-manifest.json').toString().replace(/^\uFEFF/,'')).types.find(t=>t.type==='RimWorld.Need_Food');
const derived=path.join(snapshot,first.local_file);mkdirSync(path.dirname(derived),{recursive:true});
// A deliberately invalid first referenced source makes this rejection probe portable:
// no original installation or ignored derived source is needed to run the negative suite.
writeFileSync(derived,'// Deliberately corrupted derived source for SHA256 rejection.\n');
assert.throws(()=>verifySurvivalEvidence({root:snapshot,local:true}),/Derived hash mismatch/);
report.checks.push({name:'derived source hash corrupted',rejected:true});
assert.equal(report.checks.length,42);
assert.equal(verifySurvivalEvidence({root:snapshot}).status,'pass');
report.total=report.checks.length;report.finishedAt=new Date().toISOString();
writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,rejections:report.total,report:path.join(out,'report.json')},null,2));
