import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyAnatomyEvidence} from './verify-anatomy-evidence.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),parent=path.resolve(project,'.local-research');
mkdirSync(parent,{recursive:true});const root=mkdtempSync(path.join(parent,'anatomy-verifier-tamper-'));
const rel='docs/research/rimworld/evidence';mkdirSync(path.join(root,rel),{recursive:true});
const claims=JSON.parse(readFileSync(path.join(project,rel,'anatomy-claims.json'))),groups=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))];
const files=['anatomy-types.json','anatomy-claims.json','anatomy-cases.json','anatomy-xml.json','anatomy-human.json','skills-xml.json','technology-xml.json',...groups.map(g=>g+'-manifest.json')];
for(const f of files)copyFileSync(path.join(project,rel,f),path.join(root,rel,f));
const original=new Map(files.map(f=>[f,readFileSync(path.join(root,rel,f),'utf8')]));let rejected=0,formulaMutants=0;
function tamper(file,label,change){const data=JSON.parse(original.get(file));change(data);writeFileSync(path.join(root,rel,file),JSON.stringify(data));assert.throws(()=>verifyAnatomyEvidence({root}),undefined,label);rejected++;writeFileSync(path.join(root,rel,file),original.get(file));}
try{
 assert.equal(verifyAnatomyEvidence({root}).status,'pass');
 tamper('anatomy-types.json','missing worker',x=>x.pop());
 tamper('anatomy-manifest.json','wrong assembly',x=>x.source_sha256='0'.repeat(64));
 tamper('anatomy-manifest.json','wrong engine',x=>x.engine_sha256='0'.repeat(64));
 tamper('anatomy-manifest.json','escape path',x=>x.types[0].local_file='../escape.cs');
 tamper('anatomy-manifest.json','wrong derived hash',x=>x.types[0].sha256='0'.repeat(64));
 tamper('survival-manifest.json','wrong reused capacity',x=>x.source_sha256='0'.repeat(64));
 tamper('anatomy-claims.json','false runtime claim',x=>x[0].kind='native-runtime');
 tamper('anatomy-claims.json','out-of-file range',x=>x[1].sources[0].line_end=999999);
 tamper('anatomy-claims.json','wrong code range',x=>x[1].sources[0].range_sha256='0'.repeat(64));
 tamper('anatomy-xml.json','wrong Poke parent',x=>x.records.find(r=>r.id==='DamageDef_Poke').parent_name='CutBase');
 tamper('anatomy-xml.json','lost BluntBase name',x=>x.records.find(r=>r.id==='DamageDef_Blunt').name_attribute='');
 tamper('anatomy-xml.json','wrong organ HP',x=>x.records.find(r=>r.id==='BodyPartDef_Heart').fields.find(f=>f.xpath.endsWith('/hitPoints')).value='100');
 tamper('anatomy-human.json','wrong parent topology',x=>x.nodes.find(n=>n.id==='brain').parentId='torso');
 tamper('anatomy-human.json','wrong integer HP',x=>x.nodes.find(n=>n.id==='left-eye').hitPoints=11);
 tamper('anatomy-human.json','wrong coverage',x=>x.nodes[0].coverageAbs=.9);
 tamper('anatomy-human.json','lost bone segment',x=>x.nodes.find(n=>n.id==='left-clavicle').tags=[]);
 tamper('anatomy-cases.json','wrong eye best weighting',x=>x.find(c=>c.id==='AE08').expected=[.5]);
 tamper('anatomy-cases.json','wrong unconscious Eating floor',x=>x.find(c=>c.id==='AE27').expected[3]=.1);
 tamper('anatomy-cases.json','changed input and expected',x=>{x[1].inputs.max=30;x[1].expected[0]=30;});
 tamper('anatomy-cases.json','missing limitation',x=>x[0].limitation='');
 // Mutate the independent model itself in an isolated copy: pins remain intact.
 const scriptDir=path.join(root,'scripts/research');mkdirSync(scriptDir,{recursive:true});
 for(const name of ['verify-anatomy-evidence.mjs','anatomy-model.mjs'])copyFileSync(path.join(project,'scripts/research',name),path.join(scriptDir,name));
 const modelPath=path.join(scriptDir,'anatomy-model.mjs'),model=readFileSync(modelPath,'utf8');
 for(const[from,to]of [["tag('SightSource',.75)","tag('SightSource',.5)"],['return f===.5?n+(n%2):Math.round(x);','return Math.round(x);'],['penalty>=.01?penalty:0','penalty>0?penalty:0'],['damage*(a.length===1?1','damage*(a.length===1?.5']]){
  assert(model.includes(from));writeFileSync(modelPath,model.replace(from,to));const r=spawnSync(process.execPath,[path.join(scriptDir,'verify-anatomy-evidence.mjs')],{encoding:'utf8',windowsHide:true});assert(r.status!==0,from);assert(r.stderr.includes('AssertionError'),r.stderr);formulaMutants++;writeFileSync(modelPath,model);
 }
 let localBaseline='not requested';
 if(process.argv.includes('--local')){
  const selected=new Map();for(const s of claims.flatMap(c=>c.sources).filter(s=>s.type)){const r=JSON.parse(original.get(s.group+'-manifest.json')).types.find(t=>t.type===s.type);selected.set(r.local_file,r);}
  for(const r of selected.values()){const target=path.join(root,r.local_file);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(project,r.local_file),target);}
  assert.equal(verifyAnatomyEvidence({root,local:true}).status,'pass');localBaseline='pass';const target=path.join(root,[...selected.values()][0].local_file);writeFileSync(target,readFileSync(target,'utf8')+'\n// corruption\n');assert.throws(()=>verifyAnatomyEvidence({root,local:true}));rejected++;
 }
 console.log(JSON.stringify({status:'pass',rejected,formulaMutants,portableBaseline:'pass',localBaseline,scope:'Evidence corruption and independent model mutation checks; not gameplay tests.'}));
}finally{assert(path.resolve(root).startsWith(parent+path.sep+'anatomy-verifier-tamper-'));assert.equal(path.dirname(path.resolve(root)),parent);rmSync(root,{recursive:true,force:true});}
