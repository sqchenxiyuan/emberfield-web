import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyInjuriesEvidence} from './verify-injuries-evidence.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const parent=path.resolve(project,'.local-research');
mkdirSync(parent,{recursive:true});
const root=mkdtempSync(path.join(parent,'injuries-verifier-tamper-'));
const files=['injuries-types.json','injuries-manifest.json','injuries-claims.json','injuries-cases.json','injuries-xml.json','combat-manifest.json','survival-manifest.json','housing-manifest.json'];
const rel='docs/research/rimworld/evidence';mkdirSync(path.join(root,rel),{recursive:true});
for(const f of files)copyFileSync(path.join(project,rel,f),path.join(root,rel,f));
const original=new Map(files.map(f=>[f,readFileSync(path.join(root,rel,f),'utf8')]));
let rejected=0;
function tamper(file,label,change){const parsed=JSON.parse(original.get(file));change(parsed);writeFileSync(path.join(root,rel,file),JSON.stringify(parsed));assert.throws(()=>verifyInjuriesEvidence({root}),undefined,label);rejected++;writeFileSync(path.join(root,rel,file),original.get(file));}
try{
 assert.equal(verifyInjuriesEvidence({root}).status,'pass');
 tamper('injuries-types.json','missing selection',x=>x.pop());
 tamper('injuries-manifest.json','different game assembly',x=>x.source_sha256='0'.repeat(64));
 tamper('injuries-manifest.json','different decompiler',x=>x.engine_sha256='0'.repeat(64));
 tamper('injuries-manifest.json','untrusted path',x=>x.types[0].local_file='../escape.cs');
 tamper('injuries-manifest.json','wrong derived hash',x=>x.types[0].sha256='0'.repeat(64));
 for(const f of ['combat','survival','housing'])tamper(`${f}-manifest.json`,'reused identity',x=>x.source_sha256='0'.repeat(64));
 tamper('injuries-claims.json','missing claim',x=>x.pop());
 tamper('injuries-claims.json','out of bounds locator',x=>x[0].sources[0].line_end=999999);
 tamper('injuries-claims.json','moved range hash',x=>x[0].sources[0].range_sha256='0'.repeat(64));
 tamper('injuries-claims.json','unsupported runtime assertion',x=>x[0].kind='native-runtime');
 tamper('injuries-xml.json','wrong XML source',x=>x.records[0].source.sha256='0'.repeat(64));
 tamper('injuries-xml.json','wrong parent inheritance',x=>x.records.find(r=>r.id==='ThingDef_Plant_Healroot').parent_name='PlantBase');
 tamper('injuries-xml.json','invented bruise bleeding',x=>x.records.find(r=>r.id==='HediffDef_Bruise').absent_paths=[]);
 tamper('injuries-xml.json','changed knife damage',x=>x.records.find(r=>r.id==='ThingDef_MeleeWeapon_Knife').fields.find(f=>f.xpath.endsWith('tools/li[2]/power')).value='99');
 tamper('injuries-xml.json','changed human coverage',x=>x.records.find(r=>r.id==='BodyDef_Human').fields.find(f=>f.xpath.endsWith('/coverage')).value='0.9');
 tamper('injuries-xml.json','deleted quality attribute',x=>x.records.find(r=>r.id==='StatDef_MeleeWeapon_DamageMultiplier').node_attributes=[]);
 tamper('injuries-cases.json','incorrect same-formula expected result',x=>x[0].expected.health=60);
 tamper('injuries-cases.json','changed input and expectation together',x=>{x[1].inputs.power[0]=999;x[1].expected.ap[0]=999*.015;});
 tamper('injuries-cases.json','removed case boundary',x=>x.pop());
 tamper('injuries-cases.json','removed stated limitation',x=>x[0].limitation='');
 console.log(JSON.stringify({status:'pass',rejected,baseline:'portable pass',scope:'Evidence corruption is rejected; these are verifier tests, not gameplay tests.'}));
}finally{
 assert(path.resolve(root).startsWith(parent+path.sep+'injuries-verifier-tamper-'));
 assert.equal(path.dirname(path.resolve(root)),parent);
 rmSync(root,{recursive:true,force:true});
}
