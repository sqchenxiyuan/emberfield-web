import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const identity={version:'1.7.4980 rev60',assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'ICSharpCode.Decompiler',engineVersion:'11.2.0.10050',engineHash:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'};
const sha=v=>createHash('sha256').update(v).digest('hex');
const validHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const rate=t=>t<0?0:t>=10?1:t/10;
// Independent analytic models. No original game classes are loaded or executed.
const models={
 'P01 Temperature rot rate':i=>({rates:i.temperatures.map(rate)}),
 'P02 Food thresholds and day mapping':i=>({originalThresholds:i.days.map(d=>Math.round(d*i.originalDay)),projectThresholds:i.days.map(d=>Math.round(d*i.projectDay)),fiveDegreeDays:i.days.map(d=>d/rate(5))}),
 'P03 Warm cold frozen exposure':i=>{let progress=i.progress;const rows=i.segments.map(s=>(progress+=rate(s.temperature)*s.ticks));return{progress:rows,remainingWarmTicks:rows.map(p=>i.threshold-p)};},
 'P04 Partial merge weighted age':i=>{const k=i.rows.map(r=>Math.min(r.b,r.limit-r.a));const ages=i.rows.map((r,n)=>(r.a*r.pa+k[n]*r.pb)/(r.a+k[n]));return{transferred:k,receiverProgress:ages,donorRemaining:i.rows.map((r,n)=>r.b-k[n]),ageMassBefore:i.rows.map(r=>r.a*r.pa+r.b*r.pb),ageMassAfter:i.rows.map((r,n)=>(r.a+k[n])*ages[n]+(r.b-k[n])*r.pb)};},
 'P05 Split preserves age':i=>({pieceProgress:i.take.map(()=>i.progress),remainder:i.take.map(n=>i.count-n),returnsSameObject:i.take.map(n=>n>=i.count),ageMass:i.take.map(n=>n*i.progress+(i.count-n)*i.progress)}),
 'P06 Rot stage and whole stack destruction':i=>{const progress=i.rows.map(r=>r.progress+rate(r.temperature)*r.delta),stage=progress.map(p=>p<i.threshold?'Fresh':p<i.dessicated?'Rotting':'Dessicated');return{progress,stage,destroy:stage.map((s,n)=>s==='Rotting'&&i.rows[n].destroys)};},
 'P07 UI rounding differs from accumulation':i=>{const displayTemperature=i.temperatures.map(Math.round),displayRate=displayTemperature.map(rate);return{actualRate:i.temperatures.map(rate),displayTemperature,displayRate,displayRemainingTicks:displayRate.map(r=>r<=0?i.frozenSentinel:Math.round(i.remaining/r))};},
 'P08 Temperature source precedence':i=>{const temperature=i.rows.map(r=>r.spawned?r.cell:r.fixed??r.root??r.tile??21);return{temperature,rate:temperature.map(rate)};},
 'P09 Suspended contents preserve age':i=>({progress:i.rows.map(r=>i.progress+(!r.dontTick&&!r.suspended&&r.shouldTick&&r.active?rate(i.temperature)*i.delta:0))}),
 'P10 Storage priority and acceptance':i=>{const eligible=i.candidates.map(c=>c.priority>i.current&&c.allows&&c.reachable);return{eligible,bestPriority:Math.max(0,...i.candidates.filter((_,n)=>eligible[n]).map(c=>c.priority))};},
 'P11 Fresh and rotten filter semantics':i=>({fresh:i.rows.map(r=>r.rottable?r.stage==='Fresh':r.ingestible&&!r.drug),rotten:i.rows.map(r=>r.rottable&&!r.destroys&&r.stage!=='Fresh')}),
 'P12 Base stack identity':i=>({baseEligible:i.rows.map(r=>!r.destroyed&&r.item&&!r.relic&&r.aDef===r.bDef&&r.sameStuff)}),
};
function validateData(value){if(typeof value==='number')assert(Number.isFinite(value));else if(Array.isArray(value))value.forEach(validateData);else if(object(value))Object.values(value).forEach(validateData);else assert(value===null||typeof value==='string'||typeof value==='boolean');}

export function verifyPreservationEvidence({root=projectRoot,local=false}={}){
 const evidence=path.join(root,'docs/research/rimworld/evidence'),read=n=>JSON.parse(readFileSync(path.join(evidence,n),'utf8').replace(/^\uFEFF/,''));
 const groups=['preservation','environment','energy','food'],types=new Map(),selected=new Set(),manifests={};
 for(const group of groups){
  const m=manifests[group]=read(`${group}-manifest.json`);
  assert.equal(m.evidence_id,`RW17-${group.toUpperCase()}`);assert.equal(m.version_text,identity.version);assert.equal(m.source,'Assembly-CSharp.dll');assert.equal(m.source_sha256,identity.assembly);
  assert.equal(m.engine,identity.engine);assert.equal(m.engine_version,identity.engineVersion);assert.equal(m.engine_sha256,identity.engineHash);assert.equal(m.line_endings,'LF');assert.equal(m.encoding,'UTF-8 without BOM');
  assert(Array.isArray(m.types)&&m.types.length);assert.deepEqual(read(`${group}-types.json`),m.types.map(t=>t.type));
  for(const t of m.types){const key=`${group}:${t.type}`;assert(!types.has(key)&&/^[A-Za-z_][A-Za-z0-9_.+`]*$/.test(t.type));assert.equal(t.local_file,`.local-research/${group}/${t.type}.cs`);assert(validHash(t.sha256)&&Number.isInteger(t.lines)&&t.lines>0);types.set(key,t);if(group==='preservation')selected.add(key);}
 }
 assert.equal(manifests.preservation.types.length,20,'Review changed preservation type coverage');
 const xml=read('preservation-xml.json'),records=new Map(),xmlFiles=new Map(),sources=new Set();
 assert.equal(xml.evidence_id,'RW17-PRESERVATION-XML');assert.equal(xml.version_text,identity.version);assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.records.length,14);
 let xmlLeaves=0,xmlAttributeNodes=0,xmlAbsentRoots=0;
 for(const r of xml.records){
  const s=r.source;assert(!records.has(r.id)&&typeof r.parent_name==='string'&&typeof r.group==='string');
  assert(object(s)&&/^Data\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+\.xml$/.test(s.path)&&validHash(s.sha256));
  const match=/^\/Defs\/([A-Za-z_][A-Za-z0-9_]*)\[(?:defName|@Name)='([A-Za-z_][A-Za-z0-9_]*)'\]$/.exec(s.xpath);
  assert(match&&r.id===`${match[1]}_${match[2]}`&&r.def_name===match[2]);const source=`${s.path}:${s.xpath}`;assert(!sources.has(source));sources.add(source);
  if(xmlFiles.has(s.path))assert.equal(xmlFiles.get(s.path),s.sha256);xmlFiles.set(s.path,s.sha256);
  assert(Array.isArray(r.selected_roots)&&new Set(r.selected_roots).size===r.selected_roots.length&&r.selected_roots.every(t=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)));
  assert(Array.isArray(r.absent_roots)&&new Set(r.absent_roots).size===r.absent_roots.length&&r.absent_roots.every(t=>r.selected_roots.includes(t)));xmlAbsentRoots+=r.absent_roots.length;
  const validPath=xp=>{assert(typeof xp==='string'&&xp.startsWith(`${s.xpath}/`));const rel=xp.slice(s.xpath.length+1),first=rel.split('/')[0].replace(/\[\d+\]$/,'');assert(/^[A-Za-z_][A-Za-z0-9_]*(?:\[[1-9][0-9]*\])?(?:\/[A-Za-z_][A-Za-z0-9_]*(?:\[[1-9][0-9]*\])?)*$/.test(rel));assert(r.selected_roots.includes(first)&&!r.absent_roots.includes(first),'Field under absent/unselected root');};
  const fields=new Set(),attrs=new Set();assert(Array.isArray(r.fields)&&Array.isArray(r.node_attributes));
  for(const f of r.fields){validPath(f.xpath);assert(!fields.has(f.xpath)&&typeof f.value==='string');fields.add(f.xpath);xmlLeaves++;}
  for(const a of r.node_attributes){validPath(a.xpath);assert(!attrs.has(a.xpath)&&object(a.attributes)&&Object.keys(a.attributes).length);attrs.add(a.xpath);for(const [k,v]of Object.entries(a.attributes))assert(/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(k)&&typeof v==='string');xmlAttributeNodes++;}
  records.set(r.id,r);
 }
 const claims=read('preservation-claims.json'),cases=read('preservation-cases.json'),ids=new Set();let codeReferences=0,xmlReferences=0,localDerivedFilesVerified=0;
 assert(Array.isArray(claims)&&claims.length===20);
 for(const c of claims){assert(/^PR\d{2}$/.test(c.id)&&!ids.has(c.id));ids.add(c.id);assert(['static-derived','xml-declared','xml-and-static-derived'].includes(c.kind)&&typeof c.statement==='string'&&c.statement.trim());assert(Array.isArray(c.sources)&&c.sources.length);
  for(const s of c.sources){assert(groups.includes(s.group)&&Boolean(s.type)!==Boolean(s.xml_record));if(s.type){const key=`${s.group}:${s.type}`,t=types.get(key);assert(t,`Missing type ${key}`);assert(Number.isInteger(s.line_start)&&Number.isInteger(s.line_end)&&s.line_start>0&&s.line_start<=s.line_end&&s.line_end<=t.lines,`Invalid source lines ${c.id}`);selected.add(key);codeReferences++;}else{assert(s.group==='preservation'&&records.has(s.xml_record),`Missing XML source ${c.id}`);xmlReferences++;}}
 }
 assert.deepEqual([...ids].sort(),Array.from({length:20},(_,n)=>`PR${String(n+1).padStart(2,'0')}`));
 if(local)for(const key of selected){const t=types.get(key),bytes=readFileSync(path.join(root,t.local_file));assert.equal(sha(bytes),t.sha256,`Derived hash mismatch ${key}`);assert.equal(bytes.toString('utf8').split('\n').length,t.lines);localDerivedFilesVerified++;}
 let analyticAssertions=0;const labels=new Set();assert(Array.isArray(cases)&&cases.length===12);
 function compare(actual,expected,label){if(typeof expected==='number'){assert(typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-expected)<1e-8,`${label}: ${actual} != ${expected}`);analyticAssertions++;}else if(Array.isArray(expected)){assert(Array.isArray(actual)&&actual.length===expected.length,`Array shape ${label}`);expected.forEach((v,n)=>compare(actual[n],v,`${label}[${n}]`));}else if(object(expected)){assert(object(actual));assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());for(const[k,v]of Object.entries(expected))compare(actual[k],v,`${label}.${k}`);}else{assert.equal(actual,expected,label);analyticAssertions++;}}
 for(const c of cases){assert(Object.hasOwn(models,c.label)&&!labels.has(c.label));labels.add(c.label);assert(Array.isArray(c.claims)&&c.claims.length&&c.claims.every(id=>ids.has(id)));assert(object(c.inputs)&&object(c.expected)&&typeof c.limitation==='string'&&c.limitation.length>10);validateData(c.inputs);validateData(c.expected);compare(models[c.label](c.inputs),c.expected,c.label);}
 assert.deepEqual([...labels],Object.keys(models));
 assert.equal(analyticAssertions,120,'Review changed analytic assertion coverage');

 // Bind source-derived constants and input parameters to selected XML parent chains.
 // Only these reviewed additive chains are resolved; this is not a generic Def loader.
 function chain(name){const out=[],seen=new Set();while(name){assert(!seen.has(name),'XML inheritance cycle');seen.add(name);const r=records.get(`ThingDef_${name}`);assert(r,`Missing selected ancestor ${name}`);out.push(r);name=r.parent_name;}return out;}
 function direct(r,suffix){const matches=r.fields.filter(f=>f.xpath===`${r.source.xpath}/${suffix}`);assert(matches.length<=1);return matches[0]?.value;}
 function inherited(name,suffix){for(const r of chain(name)){const value=direct(r,suffix);if(value!==undefined)return value;}return undefined;}
 function rot(name){const found=[];for(const r of chain(name))for(const a of r.node_attributes){assert(!Object.entries(a.attributes).some(([k,v])=>k.toLowerCase()==='inherit'&&v.toLowerCase()==='false'),'Unsupported inheritance replacement');if(a.attributes.Class==='CompProperties_Rottable'){const field=key=>{const f=r.fields.find(f=>f.xpath===`${a.xpath}/${key}`);assert(f,`Missing rot field ${name}/${key}`);return f.value;};found.push({declaredAt:r.def_name,days:Number(field('daysToRotStart')),destroys:field('rotDestroys')==='true'});}}assert(found.length<=1,'Unexpected multiple rottable definitions');return found[0]??null;}
 const foodNames=['RawRice','RawPotatoes','RawCorn','MealSimple'],foodDays=[40,30,60,4];
 const resolvedFoods=foodNames.map((name,n)=>{const r=rot(name);assert(r&&r.days===foodDays[n]&&r.destroys);assert.equal(inherited(name,'tickerType'),'Rare');const limit=Number(inherited(name,'stackLimit'));assert.equal(limit,n===3?10:75);return{name,...r,stackLimit:limit,chain:chain(name).map(r=>r.def_name)};});
 assert.equal(rot('MealSurvivalPack'),null);assert.equal(inherited('MealSurvivalPack','stackLimit'),'10');assert.equal(inherited('MealSurvivalPack','statBases/DeteriorationRate'),'0.25');
 assert.deepEqual(chain('MealSurvivalPack').map(r=>r.def_name),['MealSurvivalPack','MealBase','MealBaseIngredientless']);
 assert.deepEqual(chain('MealSimple').map(r=>r.def_name),['MealSimple','MealCooked','MealCookedIngredientless','MealBaseIngredientless']);
 assert.deepEqual(cases[1].inputs.foods,foodNames);assert.deepEqual(cases[1].inputs.days,resolvedFoods.map(r=>r.days));assert.equal(cases[1].inputs.originalDay,60000);assert.equal(cases[1].inputs.projectDay,12000);
 assert.equal(cases[2].inputs.threshold,rot('MealSimple').days*60000);assert.equal(cases[5].inputs.threshold,rot('MealSimple').days*60000);assert.equal(cases[5].inputs.dessicated,999*60000);assert.equal(cases[6].inputs.frozenSentinel,72000000);
 const recipe=records.get('RecipeDef_CookMealSimple');assert.equal(direct(recipe,'products/MealSimple'),'1');
 if(local){
  const code=key=>readFileSync(path.join(root,types.get(key).local_file),'utf8');
  assert.match(code('environment:Verse.GenTemperature'),/temperature < 0f[\s\S]*temperature >= 10f[\s\S]*\(temperature - 0f\) \/ 10f/);
  const rotCode=code('preservation:RimWorld.CompRottable');assert.match(rotCode,/RotProgress \+= num \* \(float\)delta/);assert.match(rotCode,/TickInterval\(250\)/);assert.match(rotCode,/Stage == RotStage\.Rotting && PropsRot\.rotDestroys/);assert.match(rotCode,/return 72000000/);
  assert.match(rotCode,/\(float\)count \/ \(float\)\(parent\.stackCount \+ count\)/);assert.doesNotMatch(rotCode,/override bool AllowStackWith|override void Notify_RecipeProduced/);
  const props=code('preservation:RimWorld.CompProperties_Rottable');assert.match(props,/daysToRotStart = 2f/);assert.match(props,/daysToDessicated = 999f/);assert.match(props,/daysToRotStart \* 60000f/);
 }
 return{status:'pass',evidenceId:'RW17-PRESERVATION-PORTABLE-VALIDATION',version:identity.version,recordedAssemblySha256:identity.assembly,preservationTypes:20,reusedTypes:selected.size-20,claims:claims.length,codeReferences,xmlReferences,xmlFiles:xmlFiles.size,xmlRecords:records.size,xmlLeaves,xmlAttributeNodes,xmlAbsentRoots,analyticCases:cases.length,analyticAssertions,localDerivedFilesVerified,resolvedFoods,originalGameExecutedByVerifier:false,originalGameFilesRead:false,scope:local?'metadata,source bindings,selected parent chains,derived hashes,independent analytic models':'metadata,source bindings,selected parent chains,independent analytic models',limitations:'No native game execution,active mod/DLC patch evaluation,runtime rot measurement or project implementation-equivalence test. Original XML identity/values require verify-preservation-evidence.ps1. Generic containers and special recipes are not all enumerated.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);assert(args.every(a=>a==='--local'||a==='--help'),'Usage: node scripts/research/verify-preservation-evidence.mjs [--local]');
 if(args.includes('--help'))console.log('Usage: node scripts/research/verify-preservation-evidence.mjs [--local]\n--local verifies recorded derived hashes; original game files are never read by this Node script.');
 else console.log(JSON.stringify(verifyPreservationEvidence({local:args.includes('--local')}),null,2));
}
