import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {evaluate,fields,chain,listValues,itemInfo,generators,categoryAncestors} from './trade-model.mjs';
import {definitionValue} from './storyteller-model.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=path.join(root,'docs/research/rimworld/evidence');
const sha=x=>createHash('sha256').update(x).digest('hex');
// Reviewed semantic pins. The evidence writer must never update this object.
const pins={
 'trade-manifest.json':'96624af3e3e47bc6dc2789f9a553cad3c67e307de1b1c996e5d00d484610e403',
 'trade-types.json':'fef7805384058616ff4973fd6a415399f8347d2bfb9b13d9dbd283e8969869c9',
 'trade-xml.json':'13c2d1d1767edd87e1eba6b38661a409229c24e077efb14bc22f94e2738b5c3d',
 'trade-data.json':'9397d5074ac78bc3b8258dc622f1d15b66a3c64854619c9f48d2d839444fa1fe',
 'trade-claims.json':'9746e792b276c5982f42afb19f5dbe4f2f8c275a4ee7c2750b0c6f0fc7822987',
 'trade-cases.json':'a7a5dd44f75cbeba1e8befeb8025ecd67448492130957ff658a68da23a688541',
 'economy-manifest.json':'153d5521f7f8287a8c89895ccad10b574ac6ece8b6e630881840fd9e16b6865e',
 'housing-manifest.json':'460be621c5f0a681a05ced165e76d495f30bae3e4b3c80394ee1d0eecb36ce4e',
 'storyteller-manifest.json':'b2f32256f1e4e43b869a69b5bb806d539305261d00af20d2ac53594342450505',
 'energy-manifest.json':'d9d48c42d1ad87f21f4cfda817d78eb8cb77ca519d1dda0338f16ebb96ab87fa',
 'armor-manifest.json':'d46df8ff55b4833fdaebea57f918ad2282b9d8b3c5c162c45000617908c9681e',
 'weapons-manifest.json':'db557b2e2bacf8fbd2aff71528a187395445de7618ea63b4c478e77bbe3f2f1a',
 'combat-manifest.json':'6e2c1683d4bd75d41a2ff0c7e0d439f32a9f7ab884a27e1504aca0f0d35ac83c',
};
const identity={assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78',version:'1.7.4980 rev60'};
export function compareTrade(actual,expected,label=''){
 let count=0;
 if(typeof expected==='number'){assert(Number.isFinite(actual),label);assert(Math.abs(actual-expected)<=1e-8*Math.max(1,Math.abs(expected)),label+': '+actual+' != '+expected);return 1;}
 if(expected&&typeof expected==='object'){
  assert.equal(Array.isArray(actual),Array.isArray(expected),label);assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),label);
  for(const k of Object.keys(expected))count+=compareTrade(actual[k],expected[k],label+'.'+k);return count;
 }
 assert.equal(actual,expected,label);return 1;
}
export function verifyTradeEvidence({local=false,overrides={},localTransform}={}){
 const read=n=>overrides[n]??JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
 assert(Object.keys(pins).length>=12,'Reviewed pins required');
 for(const [n,p]of Object.entries(pins))assert.equal(sha(JSON.stringify(read(n))),p,'Semantic content changed: '+n);
 const xml=read('trade-xml.json'),data=read('trade-data.json'),claims=read('trade-claims.json'),cases=read('trade-cases.json'),names=read('trade-types.json');
 assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.version_text,identity.version);assert.equal(data.version,identity.version);
 const records=new Map(),xmlFiles=new Set();let xmlLeaves=0,xmlAttributes=0,xmlAbsences=0;
 for(const r of xml.records){assert(!records.has(r.id),r.id);records.set(r.id,r);xmlFiles.add(r.source.path);assert(/^[a-f0-9]{64}$/.test(r.source.sha256));assert(r.source.line_start>0&&r.source.line_end>=r.source.line_start);assert(r.fields.every(f=>f.xpath.startsWith(r.source.xpath+'/')));xmlLeaves+=r.fields.length;xmlAttributes+=r.node_attributes.length;xmlAbsences+=r.absent_paths.length;}
 for(const r of xml.records){chain(xml.records,r.id);if(r.type==='ThingCategoryDef')categoryAncestors(xml.records,r.def_name);}
 for(const[type,ids]of Object.entries(xml.seeds))for(const id of ids)assert(records.has(type+'_'+id));
 assert.equal(xml.records.length,124);assert.equal(claims.length,22);assert.equal(cases.length,176);
 const direct=(id,k)=>{const r=records.get(id);assert(r,id);return r.fields.find(f=>f.xpath===r.source.xpath+'/'+k)?.value;};
 const f=id=>fields(xml.records,id);let structureAssertions=0;
 for(const name of xml.seeds.ThingDef)structureAssertions+=compareTrade(data.items[name],itemInfo(xml.records,name),name);
 for(const name of xml.seeds.TraderKindDef)assert.deepEqual(data.traders[name],generators(xml.records,'TraderKindDef_'+name));
 const golden={MeleeWeapon_Club:84.32,MeleeWeapon_Knife:66.48,MeleeWeapon_LongSword:265,Bow_Short:44.64,Gun_Revolver:135.4,Gun_MachinePistol:220,Gun_BoltActionRifle:255,Apparel_Tuque:44.32,Apparel_Parka:188.8,Apparel_Duster:196,Apparel_BasicShirt:85.76,Apparel_Pants:85.76,Apparel_SimpleHelmet:91.52,Apparel_PlateArmor:475};
 for(const[name,v]of Object.entries(data.abstractValues)){structureAssertions+=compareTrade(v,definitionValue(xml.records,'ThingDef_'+name),name);structureAssertions+=compareTrade(v.value,golden[name],'manual abstract '+name);}
 assert.equal(+direct('StatDef_WorkToMake','roundToFiveOver'),300);assert.equal(+direct('StatDef_MarketValueBase','roundToFiveOver'),200);
 assert.equal(+direct('ThingDef_Silver','statBases/MarketValue'),1);assert.equal(+direct('ThingDef_Silver','stackLimit'),500);assert.equal(direct('ThingDef_Silver','useHitPoints'),'false');
 const g=f('StatDef_TradePriceImprovement');assert.equal(+g['skillNeedFactors/li/bonusPerLevel'],.015);assert.equal(+g['skillNeedFactors/li/baseValue'],0);assert.equal(+g.maxValue,.395);
 assert.deepEqual([+g['capacityFactors/li[1]/allowedDefect'],+g['capacityFactors/li[2]/allowedDefect']],data.allowedDefects);assert.equal(+g['capacityFactors/li[1]/weight'],.9);assert.equal(+g['capacityFactors/li[2]/weight'],.9);
 for(const[n,v]of Object.entries(data.difficulties))assert.equal(+(f('DifficultyDef_'+n).tradePriceFactorLoss??0),v);
 for(const n of ['Cassandra','Phoebe']){
  const r=records.get('StorytellerDef_'+n),a=r.fields.find(f=>f.value==='TraderCaravanArrival');assert(a);const p=a.xpath.slice(0,-'/incident'.length),get=k=>r.fields.find(f=>f.xpath===p+'/'+k)?.value;
  assert.equal(+get('minDaysPassed'),data.schedule.offsetDays);assert.equal(+get('baseIncidentsPerYear'),data.schedule.count);assert.equal(+get('minSpacingDays'),data.schedule.spacingDays);
 }
 const groupNames=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))],types=new Map();
 for(const group of groupNames){const m=read(group+'-manifest.json');assert(pins[group+'-manifest.json']);assert.equal(m.source_sha256,identity.assembly);assert.equal(m.engine_sha256,identity.engine);assert.equal(m.version_text,identity.version);assert.equal(m.engine_version,'11.2.0.10050');for(const t of m.types){assert.equal(t.local_file,`.local-research/${group}/${t.type}.cs`);types.set(group+':'+t.type,t);}}
 assert.deepEqual(names,read('trade-manifest.json').types.map(t=>t.type));
 const selected=new Set(),localFiles=new Map();let codeReferences=0,xmlReferences=0;
 for(const c of claims){assert(c.statement.length>20&&c.sources.length);assert(['xml-and-static-derived','design-adaptation'].includes(c.kind));for(const s of c.sources){
  if(s.type){const k=s.group+':'+s.type,r=types.get(k);assert(r,k);assert(s.line_start>=1&&s.line_end>=s.line_start&&s.line_end<=r.lines,k);assert(/^[a-f0-9]{64}$/.test(s.range_sha256));selected.add(k);codeReferences++;
   if(local){if(!localFiles.has(k)){let b=readFileSync(path.join(root,r.local_file));if(localTransform)b=localTransform(k,b);assert.equal(sha(b),r.sha256,'Derived bytes changed: '+k);const lines=b.toString('utf8').split('\n');assert.equal(lines.length,r.lines);localFiles.set(k,lines);}assert.equal(sha(localFiles.get(k).slice(s.line_start-1,s.line_end).join('\n')),s.range_sha256);}
  }else{assert(s.xml_record);const r=records.get(s.xml_record);assert(r);assert.equal(s.xml_line_start,r.source.line_start);assert.equal(s.xml_line_end,r.source.line_end);xmlReferences++;}
 }}
 assert(names.every(n=>selected.has('trade:'+n)),'Every new derived type must be linked');
 let analyticAssertions=0;const runtimeData={...data,xmlRecords:xml.records};
 for(const[cidx,c]of cases.entries()){assert.equal(c.id,'TV'+String(cidx+1).padStart(2,'0'));assert(c.claims.every(id=>claims.some(cl=>cl.id===id)));assert(c.limitation.includes('not original execution'));analyticAssertions+=compareTrade(evaluate(c.model,c.inputs,runtimeData),c.expected,c.id);}
 return{status:'pass',version:identity.version,newTypes:names.length,reusedTypes:selected.size-names.length,claims:claims.length,cases:cases.length,items:Object.keys(data.items).length,abstractValuations:Object.keys(data.abstractValues).length,structureAssertions,analyticAssertions,codeReferences,xmlReferences,xmlRecords:xml.records.length,referencedXmlFiles:xmlFiles.size,xmlLeaves,xmlAttributes,xmlAbsences,localDerivedFilesVerified:localFiles.size,originalGameExecuted:false,scope:'Static identity, selected parent/category closure and independent arithmetic; no native execution, enabled-mod Def engine, native RNG stream, transaction exception rollback or project equivalence.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyTradeEvidence({local:process.argv.includes('--local')}),null,2));
