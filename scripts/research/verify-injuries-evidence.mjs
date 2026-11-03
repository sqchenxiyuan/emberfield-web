import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha=v=>createHash('sha256').update(v).digest('hex');
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const identity={version:'1.7.4980 rev60',assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'};
// Reviewed semantic snapshots. Changes require explicit source review; generation never updates these pins.
const pins = {
 'injuries-types.json':'15478cb20119351662123df4c83f8be8cfec03d262daf43968c8101c143617e5',
 'injuries-manifest.json':'c39107d56e4c4ed4f76076baa8d8c3c1d2e85d26f4098a6d383cd10b4d7b42e8',
 'injuries-claims.json':'8808e4ce90f6c4023011c50c40b7bbab0b6978e3dda8eb1c14f8661e2ebd452d',
 'injuries-cases.json':'3384673feffc041ca8eb5229bafa24023ab8aa2daf95fc16bd31ae88c932273e',
 'injuries-xml.json':'ffd2a0c65ee20f43baffce924167efd08605d0c9cbc517427dd612779f14f321',
 'combat-manifest.json':'6e2c1683d4bd75d41a2ff0c7e0d439f32a9f7ab884a27e1504aca0f0d35ac83c',
 'survival-manifest.json':'c4181eaeb6a69a8aa0d0ec95115782c99d86a8fc127b52d5f5d9cb96aa5ed443',
 'housing-manifest.json':'460be621c5f0a681a05ced165e76d495f30bae3e4b3c80394ee1d0eecb36ce4e',
};
const category=(w,max)=>w>=max*.95?'Best':w<max*.25?'Worst':'Mid';
const models={
 time:i=>({health:i.healthInterval*i.projectDay/i.sourceDay,heal:i.healInterval*i.projectDay/i.sourceDay,tendBySeconds:i.tendTicks*i.projectTPS/i.sourceTPS,tendByDay:i.tendTicks*i.projectDay/i.sourceDay,ageStopDays:[90000,180000].map(t=>t/i.sourceDay),infectionHours:[15000,45000].map(t=>t/(i.sourceDay/24))}),
 melee:i=>{const ap=i.power.map(p=>p*.015),w=i.power.map((p,n)=>p*(1+ap[n])/i.cooldown[n]*i.chance[n]),c=w.map(v=>category(v,Math.max(...w))),raw=c.map(k=>k==='Worst'?0:(k==='Best'?.75:.25)/c.filter(v=>v===k).length),total=raw.reduce((a,b)=>a+b,0);return{ap,minDamage:i.power.map(p=>p*.8),maxDamage:i.power.map(p=>p*1.2),category:c,probability:raw.map(p=>p/total)};},
 meleeBoundary:i=>i.weights.map(v=>category(v,i.highest)),
 bleed:i=>({bleed:i.injuryBleed.map((v,n)=>i.severity*v*i.partBleed[n]*i.race/i.scale),pain:i.injuryBleed.map(()=>i.severity*.0125/i.scale),tendedBleed:i.injuryBleed.map(()=>0)}),
 blood:i=>{const perCall=i.bleed.map(v=>v>=.1?v*.001:-.00033333333);return{perCall,perDay:perCall.map(v=>v*i.callsPerDay)};},
 bloodStages:i=>{const index=s=>[0,.15,.3,.45,.6].reduce((n,v,j)=>s>=v?j:n,0);return{offset:i.severity.map(s=>[0,-.1,-.2,-.4,-.4][index(s)]),maximum:i.severity.map(s=>s>=.6?.1:1),lethal:i.severity.map(s=>s>=1)};},
 healing:i=>{const natural=i.rows.map(r=>r.starving?0:8+(r.lying?4+r.bed:0)),tended=i.rows.map(r=>r.starving||r.q===null?0:8*(.5+clamp(r.q)));return{natural,tended,total:natural.map((v,n)=>v+tended[n])};},
 quality:i=>{const base=i.potency.map((v,n)=>clamp((i.doctor*v+i.bed)*(i.self?.7:1),0,i.max[n]));return{base,low:base.map((v,n)=>clamp(v-.25,0,i.max[n])),high:base.map((v,n)=>clamp(v+.25,0,i.max[n]))};},
 batch:i=>{const remaining=[...i.severity],batches=[];while(remaining.length){const row=[remaining.shift()];let sum=row[0];if(i.usingMedicine)for(let n=0;n<remaining.length;n++){if(sum+remaining[n]<=20){sum+=remaining[n];row.push(remaining.splice(n--,1)[0]);}}batches.push(row);}return{batches,medicine:i.usingMedicine?batches.length:0};},
 tendTime:i=>{const sourceTicks=i.speed.map(v=>Math.trunc(600/v));return{sourceTicks,seconds:sourceTicks.map(v=>v/60)};},
 tendTimer:i=>{const permanent=i.baseHours.map(v=>v<0),initialTicks=i.baseHours.map((v,n)=>permanent[n]?1:(v+i.overlap)*2500);return{permanent,initialTicks,afterTick:initialTicks.map((v,n)=>permanent[n]?v:Math.max(0,v-i.elapsed)),retendAtLeft:permanent.map(v=>v?null:i.overlap*2500-1)};},
 missing:i=>({freshBleed:Math.ceil(i.hp*i.scale)*.12*i.bleedFactor*i.race/i.scale,pain:Math.ceil(i.hp*i.scale)*.0125/i.scale,tendedBleed:0,agedBleed:i.age>=90000?0:Math.ceil(i.hp*i.scale)*.12,ordinaryRegrowth:false}),
 infection:i=>{const second=clamp(.1+(i.severity-1)*.9/11,.1,1)*(.7-.3*clamp(i.quality))*i.room*i.difficulty;return{second,total:i.initial.map(v=>v*second)};},
 injuryAge:i=>({ticks:i.severity.map(v=>90000+Math.round(clamp((v-1)/29)*90000))}),
};
export function verifyInjuriesEvidence({root=projectRoot,local=false}={}){
 const read=name=>JSON.parse(readFileSync(path.join(root,'docs/research/rimworld/evidence',name),'utf8').replace(/^\uFEFF/,''));
 assert.equal(Object.keys(pins).length,8,'reviewed snapshot pins are present');
 for(const[name,digest]of Object.entries(pins))assert.equal(sha(JSON.stringify(read(name))),digest,`Reviewed snapshot changed: ${name}`);
 const claims=read('injuries-claims.json'),cases=read('injuries-cases.json'),xml=read('injuries-xml.json');
 assert.equal(xml.version_text,identity.version);assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.evidence_id,'RW17-INJURIES-XML');
 const records=new Map(),xmlFiles=new Map();let leaves=0,attributes=0,absences=0;
 for(const r of xml.records){assert(!records.has(r.id));records.set(r.id,r);assert(/^Data\/Core\/Defs\/[A-Za-z0-9_/.]+\.xml$/.test(r.source.path));assert(/^[a-f0-9]{64}$/.test(r.source.sha256));if(xmlFiles.has(r.source.path))assert.equal(xmlFiles.get(r.source.path),r.source.sha256);xmlFiles.set(r.source.path,r.source.sha256);assert.equal(new Set(r.fields.map(f=>f.xpath)).size,r.fields.length);for(const f of r.fields)assert(f.xpath.startsWith(r.source.xpath+'/')&&typeof f.value==='string');for(const a of r.node_attributes)assert(a.xpath.startsWith(r.source.xpath+'/'));leaves+=r.fields.length;attributes+=r.node_attributes.length;absences+=r.absent_paths.length;}
 assert.equal(records.size,67);
 const value=(id,p)=>{const r=records.get(id);assert(r);return r.fields.find(f=>f.xpath===r.source.xpath+'/'+p)?.value;};
 const num=(id,p)=>{const v=value(id,p);assert(v!==undefined,`${id}/${p}`);const n=Number(v);assert(Number.isFinite(n));return n;};
 assert.equal(num('ThingDef_Human','tools/li[1]/power'),8.2);assert.equal(num('ThingDef_Human','tools/li[3]/chanceFactor'),.07);
 for(const [n,p,t]of [[1,9,2],[2,12,1.5],[3,13,2]]){assert.equal(num('ThingDef_MeleeWeapon_Knife',`tools/li[${n}]/power`),p);assert.equal(num('ThingDef_MeleeWeapon_Knife',`tools/li[${n}]/cooldownTime`),t);}
 for(const kind of ['Bite','Cut','Stab']){assert.equal(num('HediffDef_'+kind,'injuryProps/bleedRate'),.06);assert.equal(num('HediffDef_'+kind,'injuryProps/painPerSeverity'),.0125);}
 assert.equal(value('HediffDef_Bruise','injuryProps/bleedRate'),undefined);assert(records.get('HediffDef_Bruise').absent_paths.includes('injuryProps/bleedRate'));
 for(const [id,hp]of Object.entries({Torso:40,Head:25,Neck:25,Shoulder:30,Arm:30,Hand:20,Finger:8,Leg:30,Foot:25,Toe:8,Eye:10,Ear:12,Nose:10,Jaw:20}))assert.equal(num('BodyPartDef_'+id,'hitPoints'),hp);
 for(const [n,p,q]of [['Herbal',.6,.7],['Industrial',1,1],['Ultratech',1.6,1.3]]){assert.equal(num('ThingDef_Medicine'+n,'statBases/MedicalPotency'),p);assert.equal(num('ThingDef_Medicine'+n,'statBases/MedicalQualityMax'),q);}
 assert.equal(num('ThingDef_Plant_Healroot','plant/growDays'),7);assert.equal(num('ThingDef_HealrootBase','plant/harvestYield'),1);assert.equal(num('ThingDef_Plant_Healroot','plant/sowMinSkill'),8);
 const types=new Map();for(const group of ['injuries','combat','survival','housing']){const m=read(`${group}-manifest.json`);assert.equal(m.source_sha256,identity.assembly);assert.equal(m.engine_sha256,identity.engine);assert.equal(m.version_text,identity.version);assert.equal(m.engine_version,'11.2.0.10050');for(const t of m.types){assert.equal(t.local_file,`.local-research/${group}/${t.type}.cs`);types.set(`${group}:${t.type}`,t);}}
 const selected=new Set();let codeReferences=0,xmlReferences=0;const localFiles=new Map();
 assert.deepEqual(claims.map(c=>c.id),Array.from({length:24},(_,n)=>'IM'+String(n+1).padStart(2,'0')));
 for(const claim of claims){assert(['xml-and-static-derived','static-derived','xml-declared'].includes(claim.kind));assert(claim.statement.length>20&&claim.sources.length);for(const s of claim.sources){assert(Boolean(s.type)!==Boolean(s.xml_record));if(s.type){const key=`${s.group}:${s.type}`,t=types.get(key);assert(t);assert(Number.isInteger(s.line_start)&&Number.isInteger(s.line_end)&&s.line_start>0&&s.line_start<=s.line_end&&s.line_end<=t.lines);assert(/^[a-f0-9]{64}$/.test(s.range_sha256));selected.add(key);codeReferences++;if(local){if(!localFiles.has(key)){const bytes=readFileSync(path.join(root,t.local_file));assert.equal(sha(bytes),t.sha256,`Local derived hash changed: ${key}`);const lines=bytes.toString('utf8').split('\n');assert.equal(lines.length,t.lines);localFiles.set(key,lines);}assert.equal(sha(localFiles.get(key).slice(s.line_start-1,s.line_end).join('\n')),s.range_sha256,`Code locator moved: ${key}`);}}else{assert.equal(s.group,'injuries');assert(records.has(s.xml_record));xmlReferences++;}}}
 const names=read('injuries-types.json');assert.equal(names.length,20);assert.deepEqual(names,read('injuries-manifest.json').types.map(t=>t.type));assert(names.every(n=>selected.has('injuries:'+n)));
 let analyticAssertions=0;function compare(actual,expected,label){if(typeof expected==='number'){assert(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-8,`${label}: ${actual} != ${expected}`);analyticAssertions++;}else if(Array.isArray(expected)){assert(Array.isArray(actual));assert.equal(actual.length,expected.length);expected.forEach((v,n)=>compare(actual[n],v,label+'['+n+']'));}else if(expected&&typeof expected==='object'){assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());for(const[k,v]of Object.entries(expected))compare(actual[k],v,label+'.'+k);}else{assert.equal(actual,expected,label);analyticAssertions++;}}
 assert.equal(cases.length,18);for(const c of cases){assert(models[c.model]);assert(c.claims.length&&c.claims.every(id=>claims.some(cl=>cl.id===id)));assert(c.limitation.includes('not original execution'));compare(models[c.model](c.inputs),c.expected,c.id);}
 // Reconstruct ONLY structural coverage from the source tree, not capacities or injury propagation.
 const br=records.get('BodyDef_Human'),bf=new Map(br.fields.map(f=>[f.xpath.slice(br.source.xpath.length+1),f.value]));
 const body=[...bf].filter(([k])=>k.endsWith('/def')).map(([k,name])=>({key:k.slice(0,-4),name}));
 const byPath=new Map(body.map(p=>[p.key,p]));
 for(const p of body){p.parent=p.key==='corePart'?undefined:byPath.get(p.key.replace(/\/parts\/li(?:\[\d+\])?$/,''));p.coverage=Number(bf.get(p.key+'/coverage')??1);p.depth=bf.get(p.key+'/depth')??p.parent?.depth??'Outside';p.withChildren=p.parent?p.parent.withChildren*p.coverage:1;const children=body.filter(q=>q.key.replace(/\/parts\/li(?:\[\d+\])?$/,'')===p.key&&q!==p);let remaining=1-children.reduce((a,b)=>a+Number(bf.get(b.key+'/coverage')??1),0);if(Math.abs(remaining)<1e-5)remaining=0;p.self=p.withChildren*Math.max(0,remaining);}
 const total=body.reduce((a,b)=>a+b.self,0);assert(Math.abs(total-1)<1e-8);
 const outside=body.filter(p=>p.depth==='Outside'&&p.self>0),outsideTotal=outside.reduce((a,b)=>a+b.self,0);
 const grouped=new Map();for(const p of outside){assert(records.has('BodyPartDef_'+p.name),`Missing external part declaration ${p.name}`);const entry=grouped.get(p.name)??{part:p.name,count:0,absoluteCoverage:0};entry.count++;entry.absoluteCoverage+=p.self;grouped.set(p.name,entry);}
 const bodyCoverage=[...grouped.values()].map(p=>({...p,normalizedOutsideCoverage:p.absoluteCoverage/outsideTotal,baseHP:num('BodyPartDef_'+p.part,'hitPoints'),partBleedFactor:Number(value('BodyPartDef_'+p.part,'bleedRate')??1)}));
 assert.equal(codeReferences,71);assert.equal(xmlReferences,70);
 return{status:'pass',version:identity.version,newTypes:names.length,reusedTypes:selected.size-names.length,claims:claims.length,codeReferences,xmlReferences,xmlFiles:xmlFiles.size,xmlRecords:records.size,xmlLeaves:leaves,xmlAttributes:attributes,xmlAbsences:absences,cases:cases.length,analyticAssertions,localDerivedFilesVerified:localFiles.size,bodyRecords:body.length,outsideRecords:outside.length,outsideCoverage:outsideTotal,bodyCoverage,originalGameExecuted:false,limitation:'Static derived code and selected XML plus independent arithmetic/branch models; no native runtime, effective mods, full damage propagation or project gameplay equivalence.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyInjuriesEvidence({local:process.argv.includes('--local')}),null,2));
