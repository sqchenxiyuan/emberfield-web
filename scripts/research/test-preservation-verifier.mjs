import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyPreservationEvidence} from './verify-preservation-evidence.mjs';

const project=fileURLToPath(new URL('../../',import.meta.url));
const out=path.join(project,'test-results/preservation-verifier-negative');
const snapshot=path.join(out,'snapshot'),evidence=path.join(snapshot,'docs/research/rimworld/evidence');
mkdirSync(evidence,{recursive:true});
const files=[...['preservation','environment','energy','food'].flatMap(g=>[`${g}-manifest.json`,`${g}-types.json`]),'preservation-claims.json','preservation-cases.json','preservation-xml.json'];
const original=new Map();
for(const name of files){const bytes=readFileSync(path.join(project,'docs/research/rimworld/evidence',name));original.set(name,bytes);writeFileSync(path.join(evidence,name),bytes);}
const base=verifyPreservationEvidence({root:snapshot});assert.equal(base.status,'pass');
const report={status:'passed',scope:'Independent verifier rejection checks against an isolated metadata copy. Does not alter game files, canonical evidence, source implementation or browser fixtures.',checks:[]};
function reject(name,file,mutate){
 const value=JSON.parse(original.get(file));mutate(value);writeFileSync(path.join(evidence,file),JSON.stringify(value));
 try{assert.throws(()=>verifyPreservationEvidence({root:snapshot}),undefined,name);report.checks.push({name,rejected:true});console.log('PASS rejects',name);}
 finally{writeFileSync(path.join(evidence,file),original.get(file));}
}
reject('wrong game version','preservation-manifest.json',v=>{v.version_text='1.6';});
reject('wrong assembly SHA','preservation-manifest.json',v=>{v.source_sha256='0'.repeat(64);});
reject('wrong decompiler SHA','preservation-manifest.json',v=>{v.engine_sha256='0'.repeat(64);});
reject('changed type list','preservation-types.json',v=>{v.pop();});
reject('claim line beyond recorded file','preservation-claims.json',v=>{v[0].sources[0].line_end=999999;});
reject('unknown source group','preservation-claims.json',v=>{v[0].sources[0].group='unrecorded';});
reject('duplicate claim ID','preservation-claims.json',v=>{v[1].id=v[0].id;});
reject('wrong analytic output','preservation-cases.json',v=>{v[0].expected.rates[0]=1;});
reject('removed branch despite consistent shape','preservation-cases.json',v=>{v[0].inputs.temperatures.pop();v[0].expected.rates.pop();});
reject('rice50d with self-consistent computed output','preservation-cases.json',v=>{v[1].inputs.days[0]=50;v[1].expected.originalThresholds[0]=3000000;v[1].expected.projectThresholds[0]=600000;v[1].expected.fiveDegreeDays[0]=100;});
reject('missing analytic limitation','preservation-cases.json',v=>{delete v[0].limitation;});
reject('XML path traversal','preservation-xml.json',v=>{v.records[0].source.path='../../other.xml';});
reject('missing XML parent','preservation-xml.json',v=>{v.records.find(r=>r.def_name==='MealSimple').parent_name='MissingParent';});
reject('XML inheritance cycle','preservation-xml.json',v=>{v.records.find(r=>r.def_name==='MealCooked').parent_name='MealSimple';});
reject('wrong direct rice lifetime','preservation-xml.json',v=>{v.records.find(r=>r.def_name==='RawRice').fields.find(f=>f.xpath.endsWith('/daysToRotStart')).value='41';});
reject('removed rottable class attribute','preservation-xml.json',v=>{v.records.find(r=>r.def_name==='RawRice').node_attributes[0].attributes.Class='CompProperties_Unknown';});
reject('field inside explicitly absent root','preservation-xml.json',v=>{const r=v.records.find(r=>r.def_name==='MealSimple');r.fields.push({xpath:r.source.xpath+'/tickerType',value:'Rare'});});
reject('meal stack limit altered','preservation-xml.json',v=>{v.records.find(r=>r.def_name==='MealBaseIngredientless').fields.find(f=>f.xpath.endsWith('/stackLimit')).value='11';});

// The first local file is intentionally corrupted, so failure must be a digest
// mismatch rather than an absent unneeded source from this portable snapshot.
const first=JSON.parse(original.get('preservation-manifest.json')).types[0];
const derivedFile=path.join(snapshot,first.local_file);mkdirSync(path.dirname(derivedFile),{recursive:true});
writeFileSync(derivedFile,Buffer.concat([readFileSync(path.join(project,first.local_file)),Buffer.from('\n// verifier corruption probe\n')]));
assert.throws(()=>verifyPreservationEvidence({root:snapshot,local:true}),/Derived hash mismatch/);
report.checks.push({name:'altered local derived file',rejected:true});
assert.equal(verifyPreservationEvidence({root:snapshot}).status,'pass');
report.total=report.checks.length;report.finishedAt=new Date().toISOString();
writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,rejections:report.total,report:path.join(out,'report.json')},null,2));
