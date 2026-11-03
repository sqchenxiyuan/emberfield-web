import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRangedEvidence} from './verify-ranged-evidence.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),parent=path.resolve(project,'.local-research');
mkdirSync(parent,{recursive:true});const root=mkdtempSync(path.join(parent,'ranged-verifier-tamper-'));
const rel='docs/research/rimworld/evidence';mkdirSync(path.join(root,rel),{recursive:true});
const claims=JSON.parse(readFileSync(path.join(project,rel,'ranged-claims.json'))),groups=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))];
const files=['ranged-types.json','ranged-claims.json','ranged-cases.json','ranged-xml.json','ranged-data.json',...groups.map(g=>g+'-manifest.json')];
for(const f of files)copyFileSync(path.join(project,rel,f),path.join(root,rel,f));
const original=new Map(files.map(f=>[f,readFileSync(path.join(root,rel,f),'utf8')]));let rejected=0,formulaMutants=0;
function tamper(file,label,change){const data=JSON.parse(original.get(file));change(data);writeFileSync(path.join(root,rel,file),JSON.stringify(data));assert.throws(()=>verifyRangedEvidence({root}),undefined,label);rejected++;writeFileSync(path.join(root,rel,file),original.get(file));}
const record=(x,id)=>x.records.find(r=>r.id===id),field=(x,id,suffix)=>record(x,id).fields.find(f=>f.xpath.endsWith(suffix));
try{
 assert.equal(verifyRangedEvidence({root}).status,'pass');
 tamper('ranged-types.json','missing type',x=>x.pop());
 tamper('ranged-manifest.json','wrong assembly',x=>x.source_sha256='0'.repeat(64));
 tamper('ranged-manifest.json','wrong engine',x=>x.engine_sha256='0'.repeat(64));
 tamper('ranged-manifest.json','escape path',x=>x.types[0].local_file='../escape.cs');
 tamper('ranged-manifest.json','wrong class hash',x=>x.types[0].sha256='0'.repeat(64));
 tamper('combat-manifest.json','corrupt reused manifest',x=>x.source_sha256='0'.repeat(64));
 tamper('ranged-claims.json','false runtime claim',x=>x[0].kind='native-runtime');
 tamper('ranged-claims.json','invalid range',x=>x[0].sources[0].line_end=999999);
 tamper('ranged-claims.json','wrong code hash',x=>x[0].sources[0].range_sha256='0'.repeat(64));
 tamper('ranged-xml.json','wrong bow parent',x=>record(x,'ThingDef_Bow_Short').parent_name='BaseGun');
 tamper('ranged-xml.json','wrong speed',x=>field(x,'ThingDef_Arrow_Short','/speed').value='60');
 tamper('ranged-xml.json','wrong burst',x=>field(x,'ThingDef_Gun_MachinePistol','/burstShotCount').value='1');
 tamper('ranged-xml.json','wrong accuracy quality',x=>field(x,'StatDef_AccuracyBase','/factorLegendary').value='2');
 tamper('ranged-xml.json','lost absence proof',x=>record(x,'DamageDef_Bullet').absent_paths=[]);
 tamper('ranged-xml.json','wrong injury worker',x=>field(x,'DamageDef_Arrow','/workerClass').value='DamageWorker_Stab');
 tamper('ranged-xml.json','wrong gunshot bleed',x=>field(x,'HediffDef_Gunshot','/bleedRate').value='.01');
 tamper('ranged-data.json','lost inherited bench',x=>x.weapons[0].benches.shift());
 tamper('ranged-data.json','autopistol as burst gun',x=>x.weapons[2].burst=3);
 tamper('ranged-data.json','powered machine works unpowered',x=>x.bench.unpoweredFactor=.1);
 tamper('ranged-data.json','wrong tree HP',x=>x.covers.find(c=>c.id==='Plant_SaguaroCactus').maxHP=200);
 tamper('ranged-cases.json','changed expectation',x=>x[19].expected[2]=15);
 tamper('ranged-cases.json','changed both input and expected',x=>{x[19].inputs.distances=[0];x[19].expected=[1];});
 tamper('ranged-cases.json','missing scope limit',x=>x[0].limitation='');
 const scriptDir=path.join(root,'scripts/research');mkdirSync(scriptDir,{recursive:true});
 for(const f of ['verify-ranged-evidence.mjs','ranged-model.mjs'])copyFileSync(path.join(project,'scripts/research',f),path.join(scriptDir,f));
 const modelPath=path.join(scriptDir,'ranged-model.mjs'),model=readFileSync(modelPath,'utf8');
 const mutations=[
  [['projectile(id).speed/100','projectile(id).speed/60']],
  [['const accuracy=(id,q,d)=>lerp([3,12,25,40].map((x,i)=>[x,clamp(weapon(id).accuracy[i]*data.accuracyQuality[q],.01,1)]),d);','const accuracy=(id,q,d)=>clamp(lerp([3,12,25,40].map((x,i)=>[x,weapon(id).accuracy[i]*data.accuracyQuality[q]]),d),.01,1);']],
  [['perCell**distance*distanceFactor','perCell*distance*distanceFactor']],
  [['b+(1-b)*x','b+x']],
  [['angle*(diagonal?1.75:1)','angle*(diagonal?1:1)']],
  [['if(!chance(aim,aimRoll))','if(!chance(aim*(prone?.5:1),aimRoll))']],
  [['p.damage*.015*data.penetrationQuality[q]','roundEven(p.damage*data.damageQuality[q])*.015']],
  [['rawXP:eligible?(hostile?170:20)*cycle:0','rawXP:eligible?(hostile?170:20)*cycle*w.burst:0']],
  [['w.warmup+w.cooldown*cooldownFactor','w.warmup*aimingFactor+w.cooldown*cooldownFactor']],
  [['!spawned||!sameMap||covered||!canHitFlags','!spawned||!sameMap||covered||!canHitFlags||moved']],
  [['a.push(...r.fields.filter','a=[];a.push(...r.fields.filter']],
  [['burst:Number(v.burstShotCount??1)','burst:Number(v.burstShotCount??3)']],
  [['hp:w.maxHP,range:w.range','hp:w.id===\'Bow_Short\'?w.maxHP*.65:w.maxHP,range:w.range']],
  [['Math.ceil(d/(projectile(id).speed/100))','Math.floor(d/(projectile(id).speed/100))']],
  [['p>=1?true:r<p','r<p']],
  [['warmup+i*w.burstInterval-(i>0?1:0)','warmup+i*w.burstInterval']],
 ];
 for(const changes of mutations){let mutated=model;for(const[from,to]of changes){assert(mutated.includes(from),from);mutated=mutated.replace(from,to);}writeFileSync(modelPath,mutated);const result=spawnSync(process.execPath,[path.join(scriptDir,'verify-ranged-evidence.mjs')],{encoding:'utf8',windowsHide:true});assert(result.status!==0,JSON.stringify(changes));assert(result.stderr.includes('AssertionError'),result.stderr);formulaMutants++;writeFileSync(modelPath,model);}
 let localBaseline='not requested';
 if(process.argv.includes('--local')){const selected=new Map();for(const s of claims.flatMap(c=>c.sources).filter(s=>s.type)){const r=JSON.parse(original.get(s.group+'-manifest.json')).types.find(t=>t.type===s.type);selected.set(r.local_file,r);}for(const r of selected.values()){const target=path.join(root,r.local_file);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(project,r.local_file),target);}assert.equal(verifyRangedEvidence({root,local:true}).status,'pass');localBaseline='pass';const target=path.join(root,[...selected.values()][0].local_file);writeFileSync(target,readFileSync(target,'utf8')+'\n// corruption\n');assert.throws(()=>verifyRangedEvidence({root,local:true}));rejected++;}
 console.log(JSON.stringify({status:'pass',rejected,formulaMutants,portableBaseline:'pass',localBaseline,scope:'Evidence corruption and independent model mutation checks; not gameplay tests.'}));
}finally{assert(path.resolve(root).startsWith(parent+path.sep+'ranged-verifier-tamper-'));assert.equal(path.dirname(path.resolve(root)),parent);rmSync(root,{recursive:true,force:true});}
