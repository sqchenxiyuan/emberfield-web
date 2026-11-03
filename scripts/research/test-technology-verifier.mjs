import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyTechnologyEvidence} from './verify-technology-evidence.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),parent=path.resolve(project,'.local-research');
mkdirSync(parent,{recursive:true});const root=mkdtempSync(path.join(parent,'technology-verifier-tamper-'));
const groups=['technology','skills','housing','stonecutting','work','environment','economy'];
const files=['technology-types.json','technology-claims.json','technology-cases.json','technology-xml.json',...groups.map(g=>g+'-manifest.json')];
const rel='docs/research/rimworld/evidence';mkdirSync(path.join(root,rel),{recursive:true});
for(const f of files)copyFileSync(path.join(project,rel,f),path.join(root,rel,f));
const original=new Map(files.map(f=>[f,readFileSync(path.join(root,rel,f),'utf8')]));let rejected=0;
function tamper(file,label,change){const data=JSON.parse(original.get(file));change(data);writeFileSync(path.join(root,rel,file),JSON.stringify(data));assert.throws(()=>verifyTechnologyEvidence({root}),undefined,label);rejected++;writeFileSync(path.join(root,rel,file),original.get(file));}
try{
 assert.equal(verifyTechnologyEvidence({root}).status,'pass');
 tamper('technology-types.json','missing type',x=>x.pop());
 tamper('technology-manifest.json','wrong assembly',x=>x.source_sha256='0'.repeat(64));
 tamper('technology-manifest.json','wrong engine',x=>x.engine_sha256='0'.repeat(64));
 tamper('technology-manifest.json','escape path',x=>x.types[0].local_file='../escape.cs');
 tamper('technology-manifest.json','wrong derived hash',x=>x.types[0].sha256='0'.repeat(64));
 tamper('work-manifest.json','wrong reused dispatcher',x=>x.source_sha256='0'.repeat(64));
 tamper('technology-claims.json','false runtime claim',x=>x[0].kind='native-runtime');
 tamper('technology-claims.json','out-of-file range',x=>x[0].sources[0].line_end=999999);
 tamper('technology-claims.json','wrong code range',x=>x[0].sources[0].range_sha256='0'.repeat(64));
 tamper('technology-xml.json','invented bench gate',x=>x.records.find(r=>r.id==='ResearchProjectDef_TreeSowing').absent_paths=[]);
 tamper('technology-xml.json','wrong cost',x=>x.records.find(r=>r.id==='ResearchProjectDef_Batteries').fields.find(f=>f.xpath.endsWith('/baseCost')).value='200');
 tamper('technology-xml.json','wrong parent chain',x=>x.records.find(r=>r.id==='StatDef_ResearchSpeed').parent_name='GeneralLaborSpeed');
 tamper('technology-xml.json','wrong inherited comps',x=>x.records.find(r=>r.id==='ThingDef_SimpleResearchBench').node_attributes=[]);
 tamper('technology-cases.json','wrong cost cap',x=>x[0].expected[7]=3.5);
 tamper('technology-cases.json','wrong research XP',x=>x.find(c=>c.id==='TE12').expected.projectXP=100);
 tamper('technology-cases.json','wrong session',x=>x.find(c=>c.id==='TE14').inputs.work=1000);
 tamper('technology-cases.json','changed input and expected',x=>{x[2].inputs.progress=200;x[2].expected.progress=300;x[2].expected.fraction=2/7;});
 tamper('technology-cases.json','missing limitation',x=>x[0].limitation='');
 let localBaseline='not requested';
 if(process.argv.includes('--local')){
  const selected=new Map();for(const s of JSON.parse(original.get('technology-claims.json')).flatMap(c=>c.sources).filter(s=>s.type)){const r=JSON.parse(original.get(s.group+'-manifest.json')).types.find(t=>t.type===s.type);selected.set(r.local_file,r);}
  for(const r of selected.values()){const target=path.join(root,r.local_file);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(project,r.local_file),target);}
  assert.equal(verifyTechnologyEvidence({root,local:true}).status,'pass');localBaseline='pass';const target=path.join(root,[...selected.values()][0].local_file);writeFileSync(target,readFileSync(target,'utf8')+'\n// tampered\n');assert.throws(()=>verifyTechnologyEvidence({root,local:true}));rejected++;
 }
 console.log(JSON.stringify({status:'pass',rejected,portableBaseline:'pass',localBaseline,scope:'Corruption checks on evidence, not gameplay tests.'}));
}finally{assert(path.resolve(root).startsWith(parent+path.sep+'technology-verifier-tamper-'));assert.equal(path.dirname(path.resolve(root)),parent);rmSync(root,{recursive:true,force:true});}
