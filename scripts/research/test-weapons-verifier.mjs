import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyWeaponsEvidence} from './verify-weapons-evidence.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),parent=path.resolve(project,'.local-research');
mkdirSync(parent,{recursive:true});const root=mkdtempSync(path.join(parent,'weapons-verifier-tamper-'));
const groups=['weapons','apparel','energy','food','housing','stonecutting','injuries','combat','survival','preservation'];
const files=['weapons-types.json','weapons-claims.json','weapons-cases.json','weapons-xml.json',...groups.map(g=>g+'-manifest.json')];
const rel='docs/research/rimworld/evidence';mkdirSync(path.join(root,rel),{recursive:true});
for(const file of files)copyFileSync(path.join(project,rel,file),path.join(root,rel,file));
const original=new Map(files.map(f=>[f,readFileSync(path.join(root,rel,f),'utf8')]));let rejected=0;
function tamper(file,label,change){const data=JSON.parse(original.get(file));change(data);writeFileSync(path.join(root,rel,file),JSON.stringify(data));assert.throws(()=>verifyWeaponsEvidence({root}),undefined,label);rejected++;writeFileSync(path.join(root,rel,file),original.get(file));}
try{
 assert.equal(verifyWeaponsEvidence({root}).status,'pass');
 tamper('weapons-types.json','missing selection',x=>x.pop());
 tamper('weapons-manifest.json','wrong source',x=>x.source_sha256='0'.repeat(64));
 tamper('weapons-manifest.json','wrong engine',x=>x.engine_sha256='0'.repeat(64));
 tamper('weapons-manifest.json','path escape',x=>x.types[0].local_file='../escape.cs');
 tamper('weapons-manifest.json','wrong content hash',x=>x.types[0].sha256='0'.repeat(64));
 tamper('injuries-manifest.json','wrong reused identity',x=>x.source_sha256='0'.repeat(64));
 tamper('weapons-claims.json','missing claim',x=>x.pop());
 tamper('weapons-claims.json','unsupported runtime claim',x=>x[0].kind='native-runtime');
 tamper('weapons-claims.json','source range outside file',x=>x[0].sources[0].line_end=999999);
 tamper('weapons-claims.json','wrong range hash',x=>x[0].sources[0].range_sha256='0'.repeat(64));
 tamper('weapons-xml.json','wrong XML source',x=>x.records[0].source.sha256='0'.repeat(64));
 tamper('weapons-xml.json','invented club quality inheritance',x=>x.records.find(r=>r.id==='ThingDef_MeleeWeapon_Club').parent_name='BaseMeleeWeapon_Sharp_Quality');
 tamper('weapons-xml.json','changed recipe cost',x=>x.records.find(r=>r.id==='ThingDef_MeleeWeapon_Knife').fields.find(f=>f.xpath.endsWith('/costStuffCount')).value='1');
 tamper('weapons-xml.json','deleted missing field evidence',x=>x.records.find(r=>r.id==='StatDef_MaxHitPoints').absent_paths=[]);
 tamper('weapons-xml.json','changed fuel',x=>x.records.find(r=>r.id==='ThingDef_FueledSmithy').fields.find(f=>f.xpath.endsWith('/fuelCapacity')).value='100');
 tamper('weapons-xml.json','changed quality attribute',x=>x.records.find(r=>r.id==='StatDef_MeleeWeapon_DamageMultiplier').node_attributes=[]);
 tamper('weapons-cases.json','wrong expected work',x=>x[0].expected.work[0]=1200);
 tamper('weapons-cases.json','changed input and output',x=>{x[0].inputs.material[0]=1;x[0].expected.work[0]=1200;x[0].expected.ticks[0]=2400;x[0].expected.seconds[0]=40;});
 tamper('weapons-cases.json','wrong identity transfer',x=>x[14].expected.equipped.hp=65);
 tamper('weapons-cases.json','removed boundary',x=>x.pop());
 tamper('weapons-cases.json','removed limitation',x=>x[0].limitation='');
 // Local-mode integrity is independent of JSON snapshot pins.
 let localBaseline='not requested';
 if(process.argv.includes('--local')){
  const claims=JSON.parse(original.get('weapons-claims.json')),selected=new Map();
  for(const s of claims.flatMap(c=>c.sources).filter(s=>s.type)){
   const m=JSON.parse(original.get(s.group+'-manifest.json')),record=m.types.find(t=>t.type===s.type);selected.set(record.local_file,record);
  }
  for(const record of selected.values()){const target=path.join(root,record.local_file);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(project,record.local_file),target);}
  assert.equal(verifyWeaponsEvidence({root,local:true}).status,'pass');localBaseline='pass';
  const first=[...selected.values()][0],target=path.join(root,first.local_file);writeFileSync(target,readFileSync(target,'utf8')+'\n// changed local derivation\n');
  assert.throws(()=>verifyWeaponsEvidence({root,local:true}),undefined,'altered local derived code');rejected++;
 }
 console.log(JSON.stringify({status:'pass',rejected,portableBaseline:'pass',localBaseline,scope:'Evidence corruption checks; not gameplay tests.'}));
}finally{
 assert(path.resolve(root).startsWith(parent+path.sep+'weapons-verifier-tamper-'));
 assert.equal(path.dirname(path.resolve(root)),parent);
 rmSync(root,{recursive:true,force:true});
}
