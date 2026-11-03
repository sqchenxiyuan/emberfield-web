import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const project=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const identity={version:'1.7.4980 rev60',assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'};
// Reviewed semantic pins. Writers and collectors never update these automatically.
const pins={
 'technology-types.json':'a887dc0289e875a0999a720e7207010c3d4cb54862ea0ba9a3c446fddc3c50e5',
 'technology-claims.json':'5e8397ec0c664d513c1662241979a69b7acfeb92ec6f5d44c381e0103f7da02f',
 'technology-cases.json':'dd2f1fcf7c4268fa1db0443977a296ac39dd94ab11b1a5974311c472ae07308c',
 'technology-xml.json':'b897425cb072c46f6f6a90177b95459348e6525961c82f77dbb17eae9001ba15',
 'technology-manifest.json':'f0301a15e9e976e14acac5ce89aed6e25c146c3be125c95b391bc5c6afe0d3da',
 'skills-manifest.json':'43fb34340054aa87a8e0cd8217945f11770bd3822d2f4d5afb80631bc6a7711d',
 'housing-manifest.json':'460be621c5f0a681a05ced165e76d495f30bae3e4b3c80394ee1d0eecb36ce4e',
 'stonecutting-manifest.json':'dbe06849c5b123baad629014739672fd6206bc5ad5ff0cdd32652f2d1f915d53',
 'work-manifest.json':'d41ef0b6fed099fea1ae9c8d8dc2f13e24d213d622c02850d9dfd149995cfa45',
 'environment-manifest.json':'52b7cf27b482e0b8c596204dac97d8989b51e0bb693ce95c0c7bc4a4ee55d7d3',
 'economy-manifest.json':'153d5521f7f8287a8c89895ccad10b574ac6ece8b6e630881840fd9e16b6865e'
};
const factor=(p,f)=>p===0?1:1+.5*Math.max(0,Math.min(p,4)-f);
const clean=x=>{const points=[[-5,.75],[-2.5,.85],[0,1],[1,1.15]];if(x<=-5)return .75;for(let k=1;k<points.length;k++){const[a,b]=points[k-1],[c,d]=points[k];if(x<=c)return b+(d-b)*(x-a)/(c-a);}return 1.15;};
function reading(x){let n=0,result=0;while(x>0&&result<.2){const amount=Math.min(1,x);x-=amount;result+=amount*[.04,.02,.01,.005][Math.min(n++,3)];}return 1+Math.min(.2,result);}
function models(records){
 const fields=(id,p)=>{const r=records.get(id);assert(r,id);return r.fields.filter(f=>f.xpath.startsWith(r.source.xpath+'/'+p)).map(f=>f.value);};
 return{
  cost:({faction,projects})=>projects.map(p=>factor(p,faction)),
  apparent:({baseCost,progress,faction,project})=>({cost:baseCost*factor(project,faction),progress:progress*factor(project,faction),fraction:Math.min(1,progress/baseCost)}),
  speed:({levels,manipulation:m,sight:s,global:g})=>levels.map(l=>Math.max(.1,(.08+.115*l)*g*(.5+.5*Math.min(m,1.1))*(.5+.5*Math.min(s,1.1)))),
  cleanliness:({values})=>values.map(clean),reading:({filled})=>filled.map(reading),
  bench:({base,rows})=>rows.map(({temp,outdoors=false,wrongRole=false,psychOut=false,clean:c=0,filled=0,hasRoom=true})=>Math.max(.25,base*(hasRoom&&outdoors?.75:1)*(hasRoom&&!psychOut&&wrongRole?.8:1)*(temp<9||temp>35?.7:1)*(hasRoom?clean(c)*reading(filled):1))),
  research:({sourceTicks,projectTicks,speed,bench,difficulty,faction,tech})=>({sourcePoints:sourceTicks*speed*bench*.00825*difficulty/factor(tech,faction),projectPoints:projectTicks*speed*bench*.02475*difficulty/factor(tech,faction),sourceXP:sourceTicks*.1,projectXP:projectTicks*.3}),
  session:({work,wait,sourceTPS,projectTPS})=>({seconds:work/sourceTPS,projectWork:Math.ceil(work/sourceTPS*projectTPS),projectWait:Math.ceil(wait/sourceTPS*projectTPS),effectiveWorkSeconds:Math.ceil(work/sourceTPS*projectTPS)/projectTPS}),
  state:({costs,operations})=>{const state={selected:null,progress:{},completed:[]};for(const[op,arg]of operations){if(op==='select')state.selected=arg;else if(op==='stop')state.selected=null;else if(op==='work'&&state.selected){const key=state.selected;state.progress[key]=Math.min(costs[key],(state.progress[key]??0)+arg);if(state.progress[key]===costs[key]){state.completed.push(key);state.selected=null;}}}return state;},
  benchSuitability:({rows})=>rows.map(({required,bench,powered,hasPower,ignorePower=false,facilities=[]})=>(!required||required===bench)&&(ignorePower||!hasPower||powered)&&facilities.every(Boolean)),
  selectable:({rows})=>rows.map(({finished=false,prereqs=true,hiddenPrereqs=true,requiredBench=false,hasBench})=>!finished&&prereqs&&hiddenPrereqs&&(!requiredBench||hasBench)),
  starts:({tag})=>[...records.values()].filter(r=>r.group==='project'&&fields(r.id,'tags/li').includes(tag)).map(r=>r.def_name).sort(),
  gates:({defs,completed})=>defs.map(id=>fields('ThingDef_'+id,'researchPrerequisites/li').every(p=>completed.includes(p))),
  learnRate:({raw,passions,global,daily})=>passions.map(p=>raw*p*global*(daily>4000?.2:1))
 };
}
export function verifyTechnologyEvidence({root=project,local=false}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence'),read=n=>JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
 assert.equal(Object.keys(pins).length,11,'Review and populate semantic pins before validation.');
 for(const[file,pin]of Object.entries(pins))assert.equal(sha(JSON.stringify(read(file))),pin,'Reviewed snapshot changed: '+file);
 const xml=read('technology-xml.json'),claims=read('technology-claims.json'),cases=read('technology-cases.json'),names=read('technology-types.json');
 assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.version_text,identity.version);assert.equal(xml.records.length,79);
 const records=new Map(),xmlFiles=new Map();let xmlLeaves=0,xmlAttributes=0,xmlAbsences=0;
 for(const r of xml.records){assert(!records.has(r.id));records.set(r.id,r);assert(r.source.path.startsWith('Data/Core/Defs/')&&!r.source.path.includes('..'));assert(/^[a-f0-9]{64}$/.test(r.source.sha256));if(xmlFiles.has(r.source.path))assert.equal(xmlFiles.get(r.source.path),r.source.sha256);xmlFiles.set(r.source.path,r.source.sha256);for(const f of r.fields){assert(f.xpath.startsWith(r.source.xpath+'/'));xmlLeaves++;}xmlAttributes+=r.node_attributes.length;xmlAbsences+=r.absent_paths.length;}
 const field=(id,p)=>records.get(id).fields.find(f=>f.xpath===records.get(id).source.xpath+'/'+p)?.value;
 const selectedProjects={ComplexFurniture:[300,'Medieval'],PassiveCooler:[400,'Neolithic'],Stonecutting:[300,'Medieval'],ComplexClothing:[600,'Medieval'],Electricity:[1600,'Industrial'],NutrientPaste:[400,'Industrial'],AirConditioning:[500,'Industrial'],TreeSowing:[1000,'Neolithic'],Smithing:[700,'Medieval'],LongBlades:[400,'Medieval'],Batteries:[400,'Industrial'],SolarPanels:[600,'Industrial']};
 for(const[id,[cost,tech]]of Object.entries(selectedProjects)){const key='ResearchProjectDef_'+id;assert.equal(Number(field(key,'baseCost')),cost);assert.equal(field(key,'techLevel'),tech);for(const p of ['hiddenPrerequisites','requiredResearchBuilding','requiredResearchFacilities','techprintCount'])assert(records.get(key).absent_paths.includes(p));}
 assert.equal(field('ThingDef_SimpleResearchBench','size'),'(3,2)');assert.equal(field('ThingDef_SimpleResearchBench','costStuffCount'),'75');assert.equal(field('ThingDef_SimpleResearchBench','costList/Steel'),'25');assert.equal(field('ThingDef_SimpleResearchBench','statBases/WorkToBuild'),'2800');assert.equal(field('ThingDef_HiTechResearchBench','constructionSkillPrerequisite'),'6');
 assert.equal(field('ThingDef_Heater','researchPrerequisites/li'),'Electricity');assert.equal(field('ThingDef_Cooler','researchPrerequisites/li'),'AirConditioning');assert.equal(field('ThingDef_Apparel_BasicShirt','recipeMaker/researchPrerequisite'),'ComplexClothing');assert.equal(field('ThingDef_MeleeWeapon_LongSword','recipeMaker/researchPrerequisite'),'LongBlades');assert.equal(field('ThingDef_TreeBase','plant/sowResearchPrerequisites/li'),'TreeSowing');
 const groups=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))],types=new Map();
 for(const group of groups){assert(/^[a-z][a-z0-9-]+$/.test(group));const m=read(group+'-manifest.json');assert.equal(m.source_sha256,identity.assembly);assert.equal(m.engine_sha256,identity.engine);assert.equal(m.version_text,identity.version);assert.equal(m.engine_version,'11.2.0.10050');for(const t of m.types){assert.equal(t.local_file,`.local-research/${group}/${t.type}.cs`);types.set(group+':'+t.type,t);}}
 assert.deepEqual(names,read('technology-manifest.json').types.map(t=>t.type));assert.equal(names.length,18);
 const selected=new Set(),localFiles=new Map();let codeReferences=0,xmlReferences=0;
 assert.deepEqual(claims.map(c=>c.id),Array.from({length:16},(_,i)=>'TC'+String(i+1).padStart(2,'0')));
 for(const c of claims){assert(['xml-and-static-derived','xml-declared','design-adaptation'].includes(c.kind));assert(c.sources.length&&c.statement.length>20);for(const s of c.sources){assert(Boolean(s.type)!==Boolean(s.xml_record));if(s.type){const k=s.group+':'+s.type,r=types.get(k);assert(r);assert(Number.isInteger(s.line_start)&&Number.isInteger(s.line_end)&&s.line_start>0&&s.line_start<=s.line_end&&s.line_end<=r.lines);assert(/^[a-f0-9]{64}$/.test(s.range_sha256));selected.add(k);codeReferences++;if(local){if(!localFiles.has(k)){const b=readFileSync(path.join(root,r.local_file));assert.equal(sha(b),r.sha256,'Derived changed: '+k);const lines=b.toString('utf8').split('\n');assert.equal(lines.length,r.lines);localFiles.set(k,lines);}assert.equal(sha(localFiles.get(k).slice(s.line_start-1,s.line_end).join('\n')),s.range_sha256);}}else{assert.equal(s.group,'technology');assert(records.has(s.xml_record));xmlReferences++;}}}
 assert(names.every(n=>selected.has('technology:'+n)));
 let analyticAssertions=0;function compare(a,e,label){if(typeof e==='number'){assert(Number.isFinite(a)&&Math.abs(a-e)<1e-8,`${label}: ${a} != ${e}`);analyticAssertions++;}else if(Array.isArray(e)){assert(Array.isArray(a));assert.equal(a.length,e.length);e.forEach((v,n)=>compare(a[n],v,label+'['+n+']'));}else if(e&&typeof e==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort());for(const[k,v]of Object.entries(e))compare(a[k],v,label+'.'+k);}else{assert.equal(a,e);analyticAssertions++;}}
 const evaluate=models(records);assert.equal(cases.length,23);for(const c of cases){assert(evaluate[c.model]);assert(c.claims.length&&c.claims.every(id=>claims.some(q=>q.id===id)));assert(c.limitation.includes('not original execution'));compare(evaluate[c.model](c.inputs),c.expected,c.id);}
 return{status:'pass',version:identity.version,newTypes:names.length,reusedTypes:selected.size-names.length,claims:claims.length,cases:cases.length,codeReferences,xmlReferences,xmlFiles:xmlFiles.size,xmlRecords:records.size,xmlLeaves,xmlAttributes,xmlAbsences,analyticAssertions,localDerivedFilesVerified:localFiles.size,originalGameExecuted:false,scope:'Static artifact verification and independent formula/state cases; no native runtime or project integration equivalence.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyTechnologyEvidence({local:process.argv.includes('--local')}),null,2));
