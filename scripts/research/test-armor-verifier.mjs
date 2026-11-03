import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyArmorEvidence} from './verify-armor-evidence.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),parent=path.resolve(project,'.local-research');
mkdirSync(parent,{recursive:true});const root=mkdtempSync(path.join(parent,'armor-verifier-tamper-'));
const rel='docs/research/rimworld/evidence';mkdirSync(path.join(root,rel),{recursive:true});
const claims=JSON.parse(readFileSync(path.join(project,rel,'armor-claims.json'))),groups=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))];
const files=['armor-types.json','armor-claims.json','armor-cases.json','armor-xml.json','armor-data.json','anatomy-xml.json','anatomy-human.json',...groups.map(g=>g+'-manifest.json')];
for(const f of files)copyFileSync(path.join(project,rel,f),path.join(root,rel,f));
const original=new Map(files.map(f=>[f,readFileSync(path.join(root,rel,f),'utf8')]));let rejected=0,formulaMutants=0;
function tamper(file,label,change){const data=JSON.parse(original.get(file));change(data);writeFileSync(path.join(root,rel,file),JSON.stringify(data));assert.throws(()=>verifyArmorEvidence({root}),undefined,label);rejected++;writeFileSync(path.join(root,rel,file),original.get(file));}
const record=(x,id)=>x.records.find(r=>r.id===id);
try{
 assert.equal(verifyArmorEvidence({root}).status,'pass');
 tamper('armor-types.json','missing worker',x=>x.pop());
 tamper('armor-manifest.json','wrong assembly',x=>x.source_sha256='0'.repeat(64));
 tamper('armor-manifest.json','wrong engine',x=>x.engine_sha256='0'.repeat(64));
 tamper('armor-manifest.json','escape path',x=>x.types[0].local_file='../escape.cs');
 tamper('armor-manifest.json','wrong derived hash',x=>x.types[0].sha256='0'.repeat(64));
 tamper('combat-manifest.json','wrong reused armor source',x=>x.source_sha256='0'.repeat(64));
 tamper('armor-claims.json','false runtime claim',x=>x[0].kind='native-runtime');
 tamper('armor-claims.json','out-of-file range',x=>x[0].sources[0].line_end=999999);
 tamper('armor-claims.json','wrong code range',x=>x[0].sources[0].range_sha256='0'.repeat(64));
 tamper('armor-xml.json','wrong helmet parent',x=>record(x,'ThingDef_Apparel_SimpleHelmet').parent_name='ApparelMakeableBase');
 tamper('armor-xml.json','lost material priority',x=>record(x,'StatDef_ArmorRating_Sharp').fields.find(f=>f.xpath.endsWith('/priority')).value='0');
 tamper('armor-xml.json','added HP armor part',x=>record(x,'StatDef_ArmorRatingBase').node_attributes[0].attributes.Class='StatPart_HitPoints');
 tamper('armor-xml.json','quality HP false absence',x=>record(x,'StatDef_MaxHitPoints').absent_paths=[]);
 tamper('armor-xml.json','changed quality',x=>record(x,'StatDef_ArmorRatingBase').fields.find(f=>f.xpath.endsWith('/factorLegendary')).value='2');
 tamper('armor-xml.json','invented helmet skill minimum',x=>record(x,'ThingDef_Apparel_SimpleHelmet').fields.push({xpath:record(x,'ThingDef_Apparel_SimpleHelmet').source.xpath+'/recipeMaker/skillRequirements/Crafting',value:'3'}));
 tamper('armor-xml.json','wrong plate research',x=>record(x,'ResearchProjectDef_PlateArmor').fields.find(f=>f.xpath.endsWith('/baseCost')).value='500');
 tamper('armor-data.json','missed inherited machining bench',x=>x.garments.find(g=>g.id==='Apparel_SimpleHelmet').benches.shift());
 tamper('armor-data.json','false helmet eye protection',x=>x.garments.find(g=>g.id==='Apparel_SimpleHelmet').coveredParts.push('left-eye'));
 tamper('armor-data.json','lost duster legs',x=>x.garments.find(g=>g.id==='Apparel_Duster').groups.pop());
 tamper('anatomy-human.json','wrong human node group',x=>x.nodes.find(n=>n.id==='left-eye').groups.push('UpperHead'));
 tamper('anatomy-xml.json','altered source',x=>x.records[0].source.sha256='0'.repeat(64));
 tamper('armor-cases.json','wrong armor boundary',x=>x.find(c=>c.id==='AV02').expected[2]=0);
 tamper('armor-cases.json','changed input and expected',x=>{x[1].inputs.amount=20;x[1].expected=[0,0,10,10,20,20];});
 tamper('armor-cases.json','missing limitation',x=>x[0].limitation='');
 // Pin-protected evidence remains intact while these isolated models get realistic errors.
 const scriptDir=path.join(root,'scripts/research');mkdirSync(scriptDir,{recursive:true});
 for(const name of ['verify-armor-evidence.mjs','armor-model.mjs'])copyFileSync(path.join(project,'scripts/research',name),path.join(scriptDir,name));
 const modelPath=path.join(scriptDir,'armor-model.mjs'),model=readFileSync(modelPath,'utf8');
 const mutations=[
  [['rating=layer.armor[initialCategory]','rating=layer.armor[currentCategory]']],
  [['incoming,wear,outcome','incoming,wear:outcome===\'deflect\'?0:wear,outcome']],
  [['hpFractions.map(()=>','hpFractions.map(hp=>'],['*data.armorQuality[q],0,2)','*data.armorQuality[q]*hp,0,2)']],
  [['roll<e*.5?0','roll<=e*.5?0']],
  [['explicit<0?adjusted*.015','explicit<0?adjusted*damageRoll*.015']],
  [['a.push(...r.fields.filter','a=[];a.push(...r.fields.filter']],
  [['garment(id).maxHP*material(stuff).hpFactor','garment(id).maxHP*data.armorQuality[qualities[0]]*material(stuff).hpFactor']],
  [['(base+offset)*m*glow','(base*m+offset)*glow']],
  [['return roll<e*.5?0','return e>=2?0:roll<e*.5?0']],
 ];
 for(const changes of mutations){let mutated=model;for(const[from,to]of changes){assert(mutated.includes(from),from);mutated=mutated.replace(from,to);}writeFileSync(modelPath,mutated);const result=spawnSync(process.execPath,[path.join(scriptDir,'verify-armor-evidence.mjs')],{encoding:'utf8',windowsHide:true});assert(result.status!==0,JSON.stringify(changes));assert(result.stderr.includes('AssertionError'),result.stderr);formulaMutants++;writeFileSync(modelPath,model);}
 let localBaseline='not requested';
 if(process.argv.includes('--local')){
  const selected=new Map();for(const s of claims.flatMap(c=>c.sources).filter(s=>s.type)){const r=JSON.parse(original.get(s.group+'-manifest.json')).types.find(t=>t.type===s.type);selected.set(r.local_file,r);}
  for(const r of selected.values()){const target=path.join(root,r.local_file);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(project,r.local_file),target);}
  assert.equal(verifyArmorEvidence({root,local:true}).status,'pass');localBaseline='pass';const target=path.join(root,[...selected.values()][0].local_file);writeFileSync(target,readFileSync(target,'utf8')+'\n// corruption\n');assert.throws(()=>verifyArmorEvidence({root,local:true}));rejected++;
 }
 console.log(JSON.stringify({status:'pass',rejected,formulaMutants,portableBaseline:'pass',localBaseline,scope:'Evidence corruption and independent model mutation checks; not gameplay tests.'}));
}finally{assert(path.resolve(root).startsWith(parent+path.sep+'armor-verifier-tamper-'));assert.equal(path.dirname(path.resolve(root)),parent);rmSync(root,{recursive:true,force:true});}
