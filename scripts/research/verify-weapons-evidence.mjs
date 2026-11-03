import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const identity={version:'1.7.4980 rev60',assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'};
// Explicitly reviewed semantic snapshots; the evidence writer never updates these pins.
const pins={
 'weapons-types.json':'ff71b5d9b095f079622e9945401bc166af38d82eb008189efbf3d14c6a899596',
 'weapons-manifest.json':'db557b2e2bacf8fbd2aff71528a187395445de7618ea63b4c478e77bbe3f2f1a',
 'weapons-claims.json':'c52bec956bb192d14b7b342432e0eb802cbab843827149b51881ad82b84b78f6',
 'weapons-cases.json':'ce857b5683450d02ad44e430f14613fc83f406bcd37f678573019d7c5ed1e564',
 'weapons-xml.json':'a119f3f580e594e4b58472936c580026d10f7687962e761c39d7edccb3867b42',
 'apparel-manifest.json':'54c34415dcfd32aa2f0054103c162ab7e297a8f5cd8008419dd37ffd30de2dd3',
 'energy-manifest.json':'d9d48c42d1ad87f21f4cfda817d78eb8cb77ca519d1dda0338f16ebb96ab87fa',
 'food-manifest.json':'133b8d8b4dadf25edd4667c3276c22a636cf639c84a0ae811998c304b00d6823',
 'housing-manifest.json':'460be621c5f0a681a05ced165e76d495f30bae3e4b3c80394ee1d0eecb36ce4e',
 'stonecutting-manifest.json':'dbe06849c5b123baad629014739672fd6206bc5ad5ff0cdd32652f2d1f915d53',
 'injuries-manifest.json':'c39107d56e4c4ed4f76076baa8d8c3c1d2e85d26f4098a6d383cd10b4d7b42e8',
 'combat-manifest.json':'6e2c1683d4bd75d41a2ff0c7e0d439f32a9f7ab884a27e1504aca0f0d35ac83c',
 'survival-manifest.json':'c4181eaeb6a69a8aa0d0ec95115782c99d86a8fc127b52d5f5d9cb96aa5ed443',
 'preservation-manifest.json':'63b9fed552b16b593cf74589d610bc3ca396faf79ae07ca9fb1b3283c7962185'
};
const category=(v,max)=>v>=max*.95?'Best':v<max*.25?'Worst':'Mid';
const models={
 work:i=>{const work=i.base.map((n,k)=>n*i.material[k]),ticks=work.map((n,k)=>n/i.pawn[k]/i.bench[k]);return{work,ticks,seconds:ticks.map(n=>n/i.sourceTPS)};},
 hp:i=>({hp:i.material.map(m=>Math.round(i.base*m)),qualityChangesHP:false}),
 tool:i=>{const damage=i.power.map((v,n)=>v*i.material[n]*i.quality[n]);return{damage,ap:damage.map(v=>v*.015),minDamage:damage.map(v=>v*.8),maxDamage:damage.map(v=>v*1.2)};},
 selection:i=>{const weights=i.damage.map((d,n)=>d*(1+d*.015)/i.cooldown[n]*i.chance[n]),categories=weights.map(w=>category(w,Math.max(...weights)));const raw=categories.map(c=>c==='Worst'?0:(c==='Best'?.75:.25)/categories.filter(k=>k===c).length);const sum=raw.reduce((a,b)=>a+b,0);return{category:categories,probability:raw.map(w=>w/sum)};},
 category:i=>i.weights.map(v=>category(v,1)),
 usability:i=>{const factor=i.efficiency.map((v,n)=>i.ensure[n]?Math.max(.4,v):v);return{factor,damage:factor.map((v,n)=>v*i.baseDamage[n]),usable:factor.map(v=>v!==0),canManipulate:i.manipulation.map(v=>v>0)};},
 fuel:i=>{const full=i.fuel.map(v=>i.capacity-v<1);return{hasFuel:i.fuel.map(v=>v>0&&v>=i.threshold),autoFuelCondition:i.fuel.map((v,n)=>v/i.capacity<=i.auto&&!full[n]&&i.capacity>0),isFull:full,consumed:i.usedTicks.map(t=>t*i.rate/i.sourceDay)};},
 time:i=>{const knifeProjectTicks=i.knifeTicks*i.projectTPS/i.sourceTPS;return{dropProjectTicks:i.dropTicks*i.projectTPS/i.sourceTPS,knifeProjectTicks,cooldownProjectTicks:i.cooldown.map(s=>s*i.projectTPS),sourceKnifeFuel:i.knifeTicks*i.fuelPerDay/i.sourceDay,projectKnifeFuelByDay:knifeProjectTicks*i.fuelPerDay/i.projectDay,projectKnifeFuelBySeconds:knifeProjectTicks*i.fuelPerDay/i.sourceDay*i.sourceTPS/i.projectTPS};},
 deterioration:i=>i.rows.map(r=>i.base*r.q*((r.roof?0:.5)+(r.outside?.5:0)+r.terrain)*(r.roof?1:1+4*Math.max(0,Math.min(1,r.rain)))*(r.protected?0:1)),
 cancel:i=>{const expectation=i.stacks.map(n=>n*i.fraction);return{expectation,possible:expectation.map(v=>Number.isInteger(v)?[v]:[Math.floor(v),Math.ceil(v)])};},
 drop:i=>{const location=i.rows.map(r=>!r.spawned?'equipped':r.destroyGear?'destroyed':r.enclosed?'container':r.cause==='down'&&r.bed?'equipped':'ground');return{location,forbidden:location.map(x=>x==='ground'),remember:location.map((x,n)=>x==='ground'&&i.rows[n].cause==='down'),delaySourceTicks:i.rows.map(r=>r.cause==='manual'?30:0)};},
 equip:i=>({equipped:{...i.incoming,forbidden:false},ground:{...i.old,forbidden:false},uniqueCount:new Set([i.incoming.id,i.old.id]).size,extraDelaySourceTicks:0})
};
export function verifyWeaponsEvidence({root=projectRoot,local=false}={}){
 const read=n=>JSON.parse(readFileSync(path.join(root,'docs/research/rimworld/evidence',n),'utf8').replace(/^\uFEFF/,''));
 assert.equal(Object.keys(pins).length,14,'Snapshot review pins required');
 for(const [file,digest]of Object.entries(pins))assert.equal(sha(JSON.stringify(read(file))),digest,`Reviewed snapshot changed: ${file}`);
 const claims=read('weapons-claims.json'),cases=read('weapons-cases.json'),xml=read('weapons-xml.json');
 assert.equal(xml.version_text,identity.version);assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.evidence_id,'RW17-WEAPONS-XML');
 const records=new Map(),xmlFiles=new Map();let xmlLeaves=0,xmlAttributes=0,xmlAbsences=0;
 for(const r of xml.records){
  assert(!records.has(r.id));records.set(r.id,r);
  assert(/^Data\/Core\/Defs\/[A-Za-z0-9_/.]+\.xml$/.test(r.source.path));assert(/^[a-f0-9]{64}$/.test(r.source.sha256));
  if(xmlFiles.has(r.source.path))assert.equal(xmlFiles.get(r.source.path),r.source.sha256);xmlFiles.set(r.source.path,r.source.sha256);
  assert.equal(new Set(r.fields.map(f=>f.xpath)).size,r.fields.length);
  for(const f of r.fields)assert(f.xpath.startsWith(r.source.xpath+'/')&&typeof f.value==='string');
  for(const a of r.node_attributes)assert(a.xpath.startsWith(r.source.xpath+'/'));
  xmlLeaves+=r.fields.length;xmlAttributes+=r.node_attributes.length;xmlAbsences+=r.absent_paths.length;
 }
 assert.equal(records.size,40);
 const value=(id,p)=>{const r=records.get(id);assert(r,id);return r.fields.find(f=>f.xpath===r.source.xpath+'/'+p)?.value;};
 const num=(id,p)=>{const v=value(id,p);assert(v!==undefined,`${id}/${p}`);assert(Number.isFinite(Number(v)));return Number(v);};
 const paths=(id,p)=>{const r=records.get(id);return r.fields.filter(f=>f.xpath.startsWith(r.source.xpath+'/'+p+'/')).map(f=>f.value);};
 const chain=id=>{const out=[];for(let r=records.get(id);r;r=r.parent_name?records.get('ThingDef_'+r.parent_name):undefined){assert(!out.includes(r));out.unshift(r);}return out;};
 const effectiveUsers=id=>chain(id).flatMap(r=>paths(r.id,'recipeMaker/recipeUsers'));
 assert.deepEqual(effectiveUsers('ThingDef_MeleeWeapon_Club'),['ElectricSmithy','FueledSmithy','CraftingSpot']);
 assert.deepEqual(effectiveUsers('ThingDef_MeleeWeapon_Knife'),['ElectricSmithy','FueledSmithy','CraftingSpot']);
 assert.deepEqual(effectiveUsers('ThingDef_MeleeWeapon_LongSword'),['ElectricSmithy','FueledSmithy']);
 for(const id of ['ThingDef_MeleeWeapon_Club','ThingDef_MeleeWeapon_Knife','ThingDef_MeleeWeapon_LongSword'])for(const r of chain(id))assert(!r.node_attributes.some(a=>a.xpath.endsWith('/recipeUsers')&&a.attributes.Inherit?.toLowerCase()==='false'));
 const hasQuality=id=>chain(id).some(r=>r.fields.some(f=>f.xpath.endsWith('/compClass')&&f.value==='CompQuality'));
 assert.equal(hasQuality('ThingDef_MeleeWeapon_Club'),false);assert.equal(hasQuality('ThingDef_MeleeWeapon_Knife'),true);assert.equal(hasQuality('ThingDef_MeleeWeapon_LongSword'),true);
 for(const [name,cost,work]of [['Club',40,1200],['Knife',30,1800],['LongSword',100,18000]]){assert.equal(num('ThingDef_MeleeWeapon_'+name,'costStuffCount'),cost);assert.equal(num('ThingDef_MeleeWeapon_'+name,'statBases/WorkToMake'),work);}
 assert.equal(num('ThingDef_WoodLog','stuffProps/statFactors/WorkToMake'),.7);assert.equal(num('ThingDef_WoodLog','stuffProps/statFactors/MaxHitPoints'),.65);
 assert.equal(num('ThingDef_Steel','stuffProps/statFactors/MaxHitPoints'),1);assert.equal(num('ThingDef_BaseWeapon','statBases/MaxHitPoints'),100);
 assert(records.get('StatDef_MaxHitPoints').absent_paths.includes('parts'));
 assert.equal(num('ThingDef_CraftingSpot','statBases/WorkTableWorkSpeedFactor'),.5);
 assert.equal(value('ThingDef_FueledSmithy','size'),'(3,1)');assert.equal(value('ThingDef_FueledSmithy','interactionCellOffset'),'(0,0,-1)');
 assert.equal(num('ThingDef_FueledSmithy','costList/Steel'),100);assert.equal(num('ThingDef_FueledSmithy','statBases/WorkToBuild'),3000);
 assert.equal(num('ThingDef_FueledSmithy','comps/li[1]/fuelCapacity'),50);assert.equal(num('ThingDef_FueledSmithy','comps/li[1]/fuelConsumptionRate'),80);
 assert.equal(value('ThingDef_FueledSmithy','comps/li[1]/consumeFuelOnlyWhenUsed'),'true');
 assert.equal(value('ThingDef_MeleeWeapon_LongSword','recipeMaker/researchPrerequisite'),'LongBlades');assert.equal(num('ThingDef_MeleeWeapon_LongSword','recipeMaker/skillRequirements/Crafting'),5);
 assert.equal(num('ResearchProjectDef_Smithing','baseCost'),700);assert.equal(num('ResearchProjectDef_LongBlades','baseCost'),400);
 assert.equal(records.get('DamageDef_Poke').parent_name,'BluntBase');assert.equal(value('DamageDef_Poke','workerClass'),'DamageWorker_Stab');assert.equal(num('DamageDef_Poke','stabChanceOfForcedInternal'),.4);
 assert.equal(value('ManeuverDef_Poke','verb/meleeDamageDef'),'Poke');
 const qualityFactors=['Awful','Poor','Normal','Good','Excellent','Masterwork','Legendary'].map(q=>num('StatDef_MeleeWeapon_DamageMultiplier','parts/li/factor'+q));
 assert.deepEqual(qualityFactors,[.8,.9,1,1.1,1.2,1.45,1.65]);assert.deepEqual(cases[3].inputs.quality,qualityFactors);
 assert.deepEqual(cases[0].inputs.base.slice(0,3),['Club','Knife','LongSword'].map(n=>num('ThingDef_MeleeWeapon_'+n,'statBases/WorkToMake')));
 assert.equal(cases[0].inputs.material[0],num('ThingDef_WoodLog','stuffProps/statFactors/WorkToMake'));
 const groups=['weapons','apparel','energy','food','housing','stonecutting','injuries','combat','survival','preservation'],types=new Map();
 for(const group of groups){const m=read(group+'-manifest.json');assert.equal(m.source_sha256,identity.assembly);assert.equal(m.engine_sha256,identity.engine);assert.equal(m.version_text,identity.version);assert.equal(m.engine_version,'11.2.0.10050');for(const t of m.types){assert.equal(t.local_file,`.local-research/${group}/${t.type}.cs`);types.set(group+':'+t.type,t);}}
 const selected=new Set(),localFiles=new Map();let codeReferences=0,xmlReferences=0;
 assert.deepEqual(claims.map(c=>c.id),Array.from({length:20},(_,i)=>'WM'+String(i+1).padStart(2,'0')));
 for(const claim of claims){assert(['xml-and-static-derived','static-derived','xml-declared','design-adaptation'].includes(claim.kind));assert(claim.sources.length&&claim.statement.length>20);for(const s of claim.sources){
  assert(Boolean(s.type)!==Boolean(s.xml_record));
  if(s.type){const key=s.group+':'+s.type,t=types.get(key);assert(t);assert(Number.isInteger(s.line_start)&&Number.isInteger(s.line_end)&&s.line_start>0&&s.line_end>=s.line_start&&s.line_end<=t.lines);assert(/^[a-f0-9]{64}$/.test(s.range_sha256));selected.add(key);codeReferences++;
   if(local){if(!localFiles.has(key)){const bytes=readFileSync(path.join(root,t.local_file));assert.equal(sha(bytes),t.sha256,`Derived content changed: ${key}`);const lines=bytes.toString('utf8').split('\n');assert.equal(lines.length,t.lines);localFiles.set(key,lines);}assert.equal(sha(localFiles.get(key).slice(s.line_start-1,s.line_end).join('\n')),s.range_sha256,`Source range changed: ${key}`);}
  }else{assert.equal(s.group,'weapons');assert(records.has(s.xml_record));xmlReferences++;}
 }}
 const names=read('weapons-types.json');assert.equal(names.length,14);assert.deepEqual(names,read('weapons-manifest.json').types.map(t=>t.type));assert(names.every(n=>selected.has('weapons:'+n)));
 let analyticAssertions=0;
 function compare(a,e,label){if(typeof e==='number'){assert(Number.isFinite(a)&&Math.abs(a-e)<1e-8,`${label}: ${a} != ${e}`);analyticAssertions++;}else if(Array.isArray(e)){assert(Array.isArray(a));assert.equal(a.length,e.length);e.forEach((v,n)=>compare(a[n],v,label+'['+n+']'));}else if(e&&typeof e==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort());for(const [k,v]of Object.entries(e))compare(a[k],v,label+'.'+k);}else{assert.equal(a,e,label);analyticAssertions++;}}
 assert.equal(cases.length,15);
 for(const c of cases){assert(models[c.model]);assert(c.claims.length&&c.claims.every(id=>claims.some(x=>x.id===id)));assert(c.limitation.includes('not original execution'));compare(models[c.model](c.inputs),c.expected,c.id);}
 return{status:'pass',version:identity.version,newTypes:names.length,reusedTypes:selected.size-names.length,claims:claims.length,cases:cases.length,codeReferences,xmlReferences,xmlFiles:xmlFiles.size,xmlRecords:records.size,xmlLeaves,xmlAttributes,xmlAbsences,analyticAssertions,localDerivedFilesVerified:localFiles.size,effectiveRecipeUsers:Object.fromEntries(['Club','Knife','LongSword'].map(n=>[n,effectiveUsers('ThingDef_MeleeWeapon_'+n)])),originalGameExecuted:false,scope:'Static selected artifact evidence and independent fixed-input models; no native runtime, effective mods, complete combat/crafting or project equivalence.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyWeaponsEvidence({local:process.argv.includes('--local')}),null,2));
