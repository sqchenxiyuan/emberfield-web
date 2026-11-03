import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifySkillsEvidence} from './verify-skills-evidence.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),parent=path.resolve(project,'.local-research');
mkdirSync(parent,{recursive:true});const root=mkdtempSync(path.join(parent,'skills-verifier-tamper-'));
const groups=['skills','economy','housing','generation','stonecutting','food','plants','apparel','injuries','energy','weapons'];
const files=['skills-types.json','skills-claims.json','skills-cases.json','skills-xml.json',...groups.map(g=>g+'-manifest.json')];
const rel='docs/research/rimworld/evidence';mkdirSync(path.join(root,rel),{recursive:true});
for(const f of files)copyFileSync(path.join(project,rel,f),path.join(root,rel,f));
const original=new Map(files.map(f=>[f,readFileSync(path.join(root,rel,f),'utf8')]));let rejected=0;
function tamper(file,label,change){const data=JSON.parse(original.get(file));change(data);writeFileSync(path.join(root,rel,file),JSON.stringify(data));assert.throws(()=>verifySkillsEvidence({root}),undefined,label);rejected++;writeFileSync(path.join(root,rel,file),original.get(file));}
try{
 assert.equal(verifySkillsEvidence({root}).status,'pass');
 tamper('skills-types.json','missing type',x=>x.pop());
 tamper('skills-manifest.json','wrong assembly',x=>x.source_sha256='0'.repeat(64));
 tamper('skills-manifest.json','wrong engine',x=>x.engine_sha256='0'.repeat(64));
 tamper('skills-manifest.json','escape path',x=>x.types[0].local_file='../escape.cs');
 tamper('skills-manifest.json','wrong derived hash',x=>x.types[0].sha256='0'.repeat(64));
 tamper('economy-manifest.json','wrong reused curve',x=>x.source_sha256='0'.repeat(64));
 tamper('skills-claims.json','missing claim',x=>x.pop());
 tamper('skills-claims.json','false runtime claim',x=>x[0].kind='native-runtime');
 tamper('skills-claims.json','out-of-file range',x=>x[0].sources[0].line_end=999999);
 tamper('skills-claims.json','wrong code range',x=>x[0].sources[0].range_sha256='0'.repeat(64));
 tamper('skills-xml.json','invented Crafting speed',x=>x.records.find(r=>r.id==='StatDef_GeneralLaborSpeed').absent_paths=[]);
 tamper('skills-xml.json','stonecut XP',x=>x.records.find(r=>r.id==='RecipeDef_MakeStoneBlocksBase').fields.find(f=>f.xpath.endsWith('/workSkillLearnFactor')).value='1');
 tamper('skills-xml.json','wrong parent chain',x=>x.records.find(r=>r.id==='ThingDef_BlocksGranite').parent_name='ResourceBase');
 tamper('skills-xml.json','capacity attributes',x=>x.records.find(r=>r.id==='StatDef_MiningSpeed').node_attributes=[]);
 tamper('skills-cases.json','threshold >= instead of >',x=>x[2].expected.xp=20);
 tamper('skills-cases.json','wrong raw/effective daily',x=>x[1].expected.dailyXp=450);
 tamper('skills-cases.json','wrong sample branch',x=>x.find(c=>c.id==='SC20').expected.quality=5);
 tamper('skills-cases.json','changed input and expected',x=>{x[0].inputs.levels[0]=1;x[0].expected[0]=2000;});
 tamper('skills-cases.json','missing limitation',x=>x[0].limitation='');
 let localBaseline='not requested';
 if(process.argv.includes('--local')){
  const selected=new Map();for(const s of JSON.parse(original.get('skills-claims.json')).flatMap(c=>c.sources).filter(s=>s.type)){const r=JSON.parse(original.get(s.group+'-manifest.json')).types.find(t=>t.type===s.type);selected.set(r.local_file,r);}
  for(const r of selected.values()){const target=path.join(root,r.local_file);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(project,r.local_file),target);}
  assert.equal(verifySkillsEvidence({root,local:true}).status,'pass');localBaseline='pass';const target=path.join(root,[...selected.values()][0].local_file);writeFileSync(target,readFileSync(target,'utf8')+'\n// tampered\n');assert.throws(()=>verifySkillsEvidence({root,local:true}));rejected++;
 }
 console.log(JSON.stringify({status:'pass',rejected,portableBaseline:'pass',localBaseline,scope:'Corruption checks on evidence, not gameplay tests.'}));
}finally{assert(path.resolve(root).startsWith(parent+path.sep+'skills-verifier-tamper-'));assert.equal(path.dirname(path.resolve(root)),parent);rmSync(root,{recursive:true,force:true});}
