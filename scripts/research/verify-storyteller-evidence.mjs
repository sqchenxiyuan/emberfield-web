import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chain,fields,listValues,definitionValue,evaluate} from './storyteller-model.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const identity={version:'1.7.4980 rev60',assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'};
// Reviewed independently after checking source ranges and manual expectations.
// Neither collect-storyteller-xml nor write-storyteller-evidence updates pins.
const pins={
 'storyteller-types.json':'1616e3a1c386f295ae25b5f3cad59d278123e32e1746ff79df47676896702361',
 'storyteller-xml.json':'44ff62af7dbf4cf939014319621404d49acbbb48e3ac340a1eb25f519b967307',
 'storyteller-data.json':'a88a4ad11044d1ef565443961bb3c2a69b669e4918f5edc94375d10cd24bbc2e',
 'storyteller-claims.json':'cd04ad70fbc4f7aac450769faca3215880fd87588ddda8eb00842753d481b5b4',
 'storyteller-cases.json':'ce80c26f2e792a7a310fa578bc01b2d515763d303a25662e35cbfdb76428bba5',
 'storyteller-manifest.json':'b2f32256f1e4e43b869a69b5bb806d539305261d00af20d2ac53594342450505',
 'housing-manifest.json':'460be621c5f0a681a05ced165e76d495f30bae3e4b3c80394ee1d0eecb36ce4e',
 'economy-manifest.json':'153d5521f7f8287a8c89895ccad10b574ac6ece8b6e630881840fd9e16b6865e',
 'weapons-manifest.json':'db557b2e2bacf8fbd2aff71528a187395445de7618ea63b4c478e77bbe3f2f1a',
 'energy-manifest.json':'d9d48c42d1ad87f21f4cfda817d78eb8cb77ca519d1dda0338f16ebb96ab87fa',
 'combat-manifest.json':'6e2c1683d4bd75d41a2ff0c7e0d439f32a9f7ab884a27e1504aca0f0d35ac83c',
 'injuries-manifest.json':'c39107d56e4c4ed4f76076baa8d8c3c1d2e85d26f4098a6d383cd10b4d7b42e8',
 'survival-manifest.json':'c4181eaeb6a69a8aa0d0ec95115782c99d86a8fc127b52d5f5d9cb96aa5ed443',
 'biomes-manifest.json':'8272be64327997ca5c7bf3808f45064679044475b3e997803266f4a080602bcd',
};
export function compareStoryteller(actual,expected,label='case'){
 let assertions=0;
 const visit=(a,e,l)=>{if(typeof e==='number'){assert(Number.isFinite(a)&&Math.abs(a-e)<1e-9,`${l}: ${a} != ${e}`);assertions++;}else if(Array.isArray(e)){assert(Array.isArray(a),l);assert.equal(a.length,e.length,l);e.forEach((v,i)=>visit(a[i],v,`${l}[${i}]`));}else if(e&&typeof e==='object'){assert(a&&typeof a==='object',l);assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort(),l);for(const[k,v]of Object.entries(e))visit(a[k],v,l+'.'+k);}else{assert.equal(a,e,l);assertions++;}};
 visit(actual,expected,label);return assertions;
}
export function verifyStorytellerEvidence({root=project,local=false,overrides={},localTransform}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence'),read=n=>overrides[n]??JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
 for(const[file,pin]of Object.entries(pins))assert.equal(sha(JSON.stringify(read(file))),pin,'Reviewed snapshot changed: '+file);
 const xml=read('storyteller-xml.json'),data=read('storyteller-data.json'),claims=read('storyteller-claims.json'),cases=read('storyteller-cases.json'),names=read('storyteller-types.json');
 assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.version_text,identity.version);assert.equal(data.version,identity.version);assert.equal(xml.records.length,149);
 const records=new Map(),xmlFiles=new Map();let xmlLeaves=0,xmlAttributes=0,xmlAbsences=0;
 for(const r of xml.records){assert(!records.has(r.id));records.set(r.id,r);assert(r.source.path.startsWith('Data/Core/Defs/')&&!r.source.path.includes('..'));assert(/^[a-f0-9]{64}$/.test(r.source.sha256));if(xmlFiles.has(r.source.path))assert.equal(xmlFiles.get(r.source.path),r.source.sha256);xmlFiles.set(r.source.path,r.source.sha256);assert(r.selected_paths.length);assert.equal(new Set(r.fields.map(f=>f.xpath)).size,r.fields.length);assert(Number.isSafeInteger(r.source.line_start)&&r.source.line_start>0&&r.source.line_end>=r.source.line_start);for(const f of r.fields)assert(f.xpath.startsWith(r.source.xpath+'/'));for(const a of r.node_attributes)assert(a.xpath.startsWith(r.source.xpath+'/'));xmlLeaves+=r.fields.length;xmlAttributes+=r.node_attributes.length;xmlAbsences+=r.absent_paths.length;}
 // Validate every parent, including intermediate abstract definitions, not only
 // the few parents cited in prose. Every seed must remain present.
 for(const r of xml.records)chain(xml.records,r.id);
 for(const[type,ids]of Object.entries(xml.seeds))for(const id of ids)assert(records.has(type+'_'+id),'Missing seed '+id);
 const direct=(id,k)=>{const r=records.get(id);assert(r,id);return r.fields.find(f=>f.xpath===r.source.xpath+'/'+k)?.value;};
 const points=(id,prefix)=>{const r=records.get(id);return r.fields.filter(f=>f.xpath.startsWith(r.source.xpath+'/'+prefix+'/')).map(f=>f.value.replace(/[()]/g,'').split(',').map(Number));};
 const f=id=>fields(xml.records,id);
 const q=['Awful','Poor','Normal','Good','Excellent','Masterwork','Legendary'];
 assert.deepEqual(q.map(k=>+direct('StatDef_MarketValueBase','parts/li[1]/factor'+k)),data.quality);
 assert.deepEqual(q.map(k=>+(direct('StatDef_MarketValueBase','parts/li[1]/maxGain'+k)??0)),data.qualityCap);
 assert.deepEqual(points('StatDef_MarketValue','parts/li[1]/curve/points'),data.durability);
 assert.deepEqual(points('StatDef_MarketValue','parts/li[2]/curve/points'),data.childAge);
 assert.equal(+direct('StatDef_MarketValueBase','roundToFiveOver'),200);
 assert.equal(+direct('StatDef_WorkToMake','roundToFiveOver'),300);assert.equal(+direct('StatDef_WorkToBuild','roundToFiveOver'),300);
 const base='StorytellerDef_BaseStoryteller';
 for(const[k,prefix]of Object.entries({factor:'pointsFactorFromAdaptDays',growth:'adaptDaysGrowthRateCurve',downed:'adaptDaysLossFromColonistViolentlyDownedByPopulation',lost:'adaptDaysLossFromColonistLostByPostPopulation'}))assert.deepEqual(points(base,prefix+'/points'),data.adaptation[k]);
 assert.deepEqual(points(base,'pointsFactorFromDaysPassed/points'),data.daysFactor);
 for(const[k,name]of Object.entries({min:'adaptDaysMin',max:'adaptDaysMax',grace:'adaptDaysGameStartGraceDays'}))assert.equal(+direct(base,name),data.adaptation[k]);
 assert.deepEqual(points('FactionDef_Pirate','maxPawnCostPerTotalPointsCurve/points'),data.pirateMaxCost);
 for(const[name,d]of Object.entries(data.difficulties)){const a=f('DifficultyDef_'+name),ceiling=+(a.minThreatPointsRangeCeiling??0);assert.deepEqual({scale:+a.threatScale,effect:+(a.adaptationEffectFactor??1),growth:+(a.adaptationGrowthRateFactorOverZero??1),ceiling:ceiling<35?70:ceiling,big:a.allowBigThreats!=='false',intro:a.allowIntroThreats!=='false'},d,name);}
 for(const name of ['Cassandra','Phoebe']){const id='StorytellerDef_'+name,get=k=>direct(id,'comps/li[2]/'+k);assert.deepEqual({minDays:+get('minDaysPassed'),onDays:+get('onDays'),offDays:+get('offDays'),spacing:+(get('minSpacingDays')??0),count:get('numIncidentsRange').split('~').map(Number),forceRaidBefore:+get('forceRaidEnemyBeforeDaysPassed')},data.schedules[name]);}
 const rr=k=>direct('StorytellerDef_Randy','comps/li[1]/'+k),rd=data.schedules.Randy;assert.equal(+rr('mtbDays'),rd.mtbDays);assert.equal(+rr('maxThreatBigIntervalDays'),rd.maxThreatDays);assert.deepEqual(rr('randomPointsFactorRange').split('~').map(Number),rd.pointsRange);for(const[k,v]of Object.entries(rd.weights))assert.equal(+rr('categoryWeights/'+k),v);
 let valuationAssertions=0;
 for(const[name,v]of Object.entries(data.nativeValues)){valuationAssertions+=compareStoryteller(definitionValue(xml.records,v.id,v.stuff),Object.fromEntries(Object.entries(v).filter(([k])=>!['id','stuff'].includes(k))),name);}
 // Hand-reviewed arithmetic anchors are independent of the XML valuation model.
 const golden={WoodLog:1.2,Steel:1.9,BlocksGranite:.9,ChunkGranite:0,Cloth:1.5,ComponentIndustrial:32,MealSurvivalPack:24,RawRice:1.1,MealSimple:15,MedicineHerbal:10,Silver:1,Human:1750,Wall:6.3402,Door:32.142,Bed:56.016,WoodFiredGenerator:265,SimpleResearchBench:144.556,Sandbags:8.148,MeleeWeapon_Club:51.024,MeleeWeapon_Knife:63.48,MeleeWeapon_LongSword:255,Bow_Short:44.64,Gun_Revolver:135.4,Gun_MachinePistol:220,Apparel_Tuque:34.32,Apparel_Parka:148.8,Apparel_PlateArmor:460,WoodPlankFloor:3.906,FlagstoneGranite:5.4,TileGranite:7.56};
 for(const[k,v]of Object.entries(golden))valuationAssertions+=compareStoryteller(data.nativeValues[k].value,v,'golden '+k);
 assert.equal(data.nativeValues.MeleeWeapon_LongSword.base,254.8);assert.equal(data.nativeValues.Gun_MachinePistol.base,221.1);
 assert.deepEqual(chain(xml.records,'ThingDef_Bed').map(r=>r.def_name),['BuildingBase','FurnitureBase','BedBase','BedWithQualityBase','ArtableBedBase','SansComfortBedBase','BasicBedBase','Bed']);
 for(const r of Object.values(data.raiders)){const a=f(r.id);assert.equal(+a.combatPower,r.cost);assert.equal(a.itemQuality,r.quality);assert.deepEqual(a.weaponMoney.split('~').map(Number),r.weaponMoney);assert.deepEqual(a.gearHealthRange.split('~').map(Number),r.health);assert.deepEqual(listValues(xml.records,r.id,'weaponTags'),r.tags);assert.deepEqual(chain(xml.records,r.id).map(x=>x.def_name),r.chain);}
 for(const[k,w]of Object.entries(data.weapons)){assert.equal(w.price,data.nativeValues[k].value);assert.deepEqual(w.tags,listValues(xml.records,'ThingDef_'+k,'weaponTags'));}
 assert.deepEqual(data.weapons.Gun_MachinePistol.tags,['Gun','ShortShots']);
 for(const name of ['Wealth_Total','Wealth_Items','Wealth_Buildings','Wealth_Pawns','ThreatPoints'])assert.equal(+direct('HistoryAutoRecorderDef_'+name,'recordTicksFrequency'),30000);assert.equal(+direct('HistoryAutoRecorderDef_Adaptation','recordTicksFrequency'),60000);
 const groups=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))],types=new Map();
 for(const g of groups){assert(pins[g+'-manifest.json']);const m=read(g+'-manifest.json');assert.equal(m.source_sha256,identity.assembly);assert.equal(m.engine_sha256,identity.engine);assert.equal(m.version_text,identity.version);assert.equal(m.engine_version,'11.2.0.10050');for(const t of m.types){assert.equal(t.local_file,`.local-research/${g}/${t.type}.cs`);types.set(g+':'+t.type,t);}}
 assert.deepEqual(names,read('storyteller-manifest.json').types.map(t=>t.type));assert.equal(names.length,36);
 assert.deepEqual(claims.map(c=>c.id),Array.from({length:20},(_,i)=>'ST'+String(i+1).padStart(2,'0')));
 const selected=new Set(),localFiles=new Map();let codeReferences=0,xmlReferences=0;
 for(const c of claims){assert(['xml-and-static-derived','design-adaptation'].includes(c.kind));assert(c.sources.length&&c.statement.length>20);for(const s of c.sources){assert(Boolean(s.type)!==Boolean(s.xml_record));if(s.type){const k=s.group+':'+s.type,r=types.get(k);assert(r,k);assert(Number.isInteger(s.line_start)&&Number.isInteger(s.line_end)&&s.line_start>0&&s.line_start<=s.line_end&&s.line_end<=r.lines);assert(/^[a-f0-9]{64}$/.test(s.range_sha256));selected.add(k);codeReferences++;
   if(local){if(!localFiles.has(k)){let b=readFileSync(path.join(root,r.local_file));if(localTransform)b=localTransform(k,b);assert.equal(sha(b),r.sha256,'Derived changed: '+k);const lines=b.toString('utf8').split('\n');assert.equal(lines.length,r.lines);localFiles.set(k,lines);}assert.equal(sha(localFiles.get(k).slice(s.line_start-1,s.line_end).join('\n')),s.range_sha256);}
  }else{assert.equal(s.group,'storyteller');assert(records.has(s.xml_record),s.xml_record);assert.equal(s.xml_line_start,records.get(s.xml_record).source.line_start);assert.equal(s.xml_line_end,records.get(s.xml_record).source.line_end);xmlReferences++;}}}
 assert(names.every(n=>selected.has('storyteller:'+n)));assert.equal(selected.size,59);
 let analyticAssertions=0;assert.equal(cases.length,71);assert.deepEqual(cases.map(c=>c.id),Array.from({length:71},(_,i)=>'SV'+String(i+1).padStart(2,'0')));
 for(const c of cases){assert(c.claims.length&&c.claims.every(id=>claims.some(q=>q.id===id)));assert(c.limitation.includes('not original execution'));analyticAssertions+=compareStoryteller(evaluate(c.model,c.inputs,data),c.expected,c.id);}
 return{status:'pass',version:identity.version,newTypes:names.length,reusedTypes:selected.size-names.length,claims:claims.length,cases:cases.length,codeReferences,xmlReferences,xmlRecords:xml.records.length,referencedXmlFiles:xmlFiles.size,xmlLeaves,xmlAttributes,xmlAbsences,nativeValuations:Object.keys(data.nativeValues).length,valuationAssertions,analyticAssertions,localDerivedFilesVerified:localFiles.size,originalGameExecuted:false,scope:'Static artifact plus independent double-precision arithmetic/state verification; not native RNG, enabled-mod database or project simulation equivalence.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyStorytellerEvidence({local:process.argv.includes('--local')}),null,2));
