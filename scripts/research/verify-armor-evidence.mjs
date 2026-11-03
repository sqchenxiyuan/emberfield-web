import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {armorModels,armorData} from './armor-model.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const identity={version:'1.7.4980 rev60',assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'};
// Reviewed semantic pins. Collectors and evidence writers do not update these.
const pins={
 "armor-types.json": "cd22506380cac5f8a19d56d4aa314d47df72aacf8f0c487864eff5d381912c3e",
 "armor-claims.json": "aa846aa2e1c91e69960ebccc5e245f0985ee2b0c04f959fde6dd656c54dfd5fb",
 "armor-cases.json": "636d1f480e14b8eb4033d2f50c9b8622211836aadf197376412ba0e2e21d8fd4",
 "armor-xml.json": "efe177eb882b56a0cf869793fbc26590772c4885cc56a5e517c8e17b1103be84",
 "armor-data.json": "5639981dcfb11d705a3be65210f6b0cbab099436da192fe6de7d46621b53fca7",
 "anatomy-xml.json": "5eebd0b482dce25c359d174d66c00d4df11736252deed5caf7bdd6dfefaa73dd",
 "anatomy-human.json": "58c725cc1707e9fcf3ddb627d129f9927e4e5cafceb80918fa44556f3d542868",
 "combat-manifest.json": "6e2c1683d4bd75d41a2ff0c7e0d439f32a9f7ab884a27e1504aca0f0d35ac83c",
 "armor-manifest.json": "d46df8ff55b4833fdaebea57f918ad2282b9d8b3c5c162c45000617908c9681e",
 "apparel-manifest.json": "54c34415dcfd32aa2f0054103c162ab7e297a8f5cd8008419dd37ffd30de2dd3",
 "anatomy-manifest.json": "86fa432b8c6411c415b7370cb79b27b28ea8c9d4be626f7da13e7301b4f37068",
 "skills-manifest.json": "43fb34340054aa87a8e0cd8217945f11770bd3822d2f4d5afb80631bc6a7711d",
 "food-manifest.json": "133b8d8b4dadf25edd4667c3276c22a636cf639c84a0ae811998c304b00d6823",
 "housing-manifest.json": "460be621c5f0a681a05ced165e76d495f30bae3e4b3c80394ee1d0eecb36ce4e",
 "injuries-manifest.json": "c39107d56e4c4ed4f76076baa8d8c3c1d2e85d26f4098a6d383cd10b4d7b42e8",
 "weapons-manifest.json": "db557b2e2bacf8fbd2aff71528a187395445de7618ea63b4c478e77bbe3f2f1a"
};
export function verifyArmorEvidence({root=project,local=false}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence'),read=n=>JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
 assert.equal(Object.keys(pins).length,16,'Populate reviewed semantic pins.');
 for(const[file,pin]of Object.entries(pins))assert.equal(sha(JSON.stringify(read(file))),pin,'Reviewed snapshot changed: '+file);
 const xml=read('armor-xml.json'),human=read('anatomy-human.json'),data=read('armor-data.json'),claims=read('armor-claims.json'),cases=read('armor-cases.json'),names=read('armor-types.json');
 assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.version_text,identity.version);assert.equal(xml.records.length,58);
 assert.equal(human.assembly_sha256,identity.assembly);assert.equal(human.version_text,identity.version);assert.equal(human.nodes.length,64);
 assert.deepEqual(armorData(xml,human),data,'Derived garments differ from reviewed XML and anatomy.');
 assert.deepEqual(data.armorQuality,[.6,.8,1,1.15,1.3,1.45,1.8]);
 assert.deepEqual(data.meleeQuality,[.8,.9,1,1.1,1.2,1.45,1.65]);
 assert.deepEqual(data.rangedPenetrationQuality,[.9,1,1,1,1,1.25,1.5]);
 const records=new Map(),xmlFiles=new Map();let xmlLeaves=0,xmlAttributes=0,xmlAbsences=0;
 for(const group of ['armor','anatomy'])for(const r of read(group+'-xml.json').records){
  const key=group+':'+r.id;assert(!records.has(key));records.set(key,r);
  assert(r.source.path.startsWith('Data/Core/Defs/')&&!r.source.path.includes('..'));
  assert(/^[a-f0-9]{64}$/.test(r.source.sha256));if(xmlFiles.has(r.source.path))assert.equal(xmlFiles.get(r.source.path),r.source.sha256);xmlFiles.set(r.source.path,r.source.sha256);
  for(const f of r.fields)assert(f.xpath.startsWith(r.source.xpath+'/'));
  if(group==='armor'){xmlLeaves+=r.fields.length;xmlAttributes+=r.node_attributes.length;xmlAbsences+=r.absent_paths.length;}
 }
 const get=id=>{const r=records.get('armor:'+id);assert(r,id);return r;},field=(id,p)=>get(id).fields.find(f=>f.xpath===get(id).source.xpath+'/'+p)?.value;
 const named=new Map(xml.records.filter(r=>r.name_attribute).map(r=>[r.name_attribute,r]));
 const parts=id=>get(id).node_attributes.filter(a=>a.xpath.startsWith(get(id).source.xpath+'/parts/')).map(a=>a.attributes.Class);
 const absent=(id,p)=>assert(get(id).absent_paths.includes(p),id+' absence '+p);
 // Resolve every selected garment parent to a record: omission must not become a false default.
 for(const r of xml.records.filter(r=>r.group==='garment')){if(r.parent_name)assert(named.has(r.parent_name),'Missing garment parent: '+r.parent_name);absent(r.id,'damageMultipliers');}
 assert.equal(get('ThingDef_Human').parent_name,'BasePawn');assert.equal(get('ThingDef_BasePawn').parent_name,'');
 for(const id of ['ThingDef_Human','ThingDef_BasePawn'])for(const category of ['Sharp','Blunt','Heat'])assert.equal(field(id,'statBases/ArmorRating_'+category),undefined);
 assert.equal(field('StatDef_ArmorRatingBase','defaultBaseValue'),'0');assert.equal(field('StatDef_ArmorRatingBase','minValue'),'0');assert.equal(field('StatDef_ArmorRatingBase','maxValue'),'2');
 assert.deepEqual(parts('StatDef_ArmorRatingBase'),['StatPart_Quality']);
 for(const category of ['Sharp','Blunt','Heat']){const id='StatDef_ArmorRating_'+category;assert.equal(get(id).parent_name,'ArmorRatingBase');assert.deepEqual(parts(id),['StatPart_Stuff']);assert.equal(field(id,'parts/li/priority'),'100');assert.equal(field(id,'parts/li/multiplierStat'),'StuffEffectMultiplierArmor');assert.equal(field(id,'parts/li/stuffPowerStat'),'StuffPower_Armor_'+category);}
 absent('StatDef_MaxHitPoints','parts');assert.equal(field('StatDef_MaxHitPoints','roundValue'),'true');assert.equal(field('StatDef_MaxHitPoints','roundToFiveOver'),'200');
 assert(!parts('StatDef_MoveSpeed').includes('StatPart_Quality'));assert.equal(field('StatDef_MoveSpeed','minValue'),'0.15');assert.equal(field('StatDef_MoveSpeed','capacityFactors/li/capacity'),'Moving');assert.equal(field('StatDef_MoveSpeed','capacityFactors/li/weight'),'1');
 assert.equal(field('ThingDef_Human','statBases/MoveSpeed'),'4.6');
 assert.equal(field('ResearchProjectDef_PlateArmor','baseCost'),'600');assert.equal(field('ResearchProjectDef_PlateArmor','techLevel'),'Medieval');
 assert.deepEqual(get('ResearchProjectDef_PlateArmor').fields.filter(f=>f.xpath.includes('/prerequisites/')).map(f=>f.value),['Smithing','ComplexClothing']);
 assert.equal(field('ResearchProjectDef_Smithing','baseCost'),'700');
 for(const id of ['ThingDef_Apparel_SimpleHelmet','ThingDef_ArmorHelmetMakeableBase','ThingDef_ArmorMachineableBase'])assert(!get(id).node_attributes.some(a=>a.xpath.includes('/recipeUsers')&&a.attributes.Inherit?.toLowerCase()==='false'));
 assert(data.garments.every(g=>g.workSkill==='Crafting'&&g.workSpeedStat==='GeneralLaborSpeed'));
 const garment=id=>data.garments.find(g=>g.id===id);
 assert.deepEqual(garment('Apparel_SimpleHelmet').coveredParts,['head','skull','brain','left-ear','right-ear']);
 assert.equal(garment('Apparel_PlateArmor').coveredParts.length,29);assert.equal(garment('Apparel_Duster').coveredParts.length,29);assert.equal(garment('Apparel_Parka').coveredParts.length,23);
 assert.deepEqual(garment('Apparel_PlateArmor').layers,['Middle','Shell']);
 assert.deepEqual(garment('Apparel_SimpleHelmet').benches,['TableMachining','ElectricSmithy','FueledSmithy']);
 assert.equal(garment('Apparel_Parka').research,null);assert(data.garments.filter(g=>!['Apparel_Parka','Apparel_SimpleHelmet','Apparel_PlateArmor'].includes(g.id)).every(g=>g.research==='ComplexClothing'));
 const groups=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))],types=new Map();
 for(const group of groups){assert(/^[a-z][a-z0-9-]+$/.test(group));const m=read(group+'-manifest.json');assert.equal(m.source_sha256,identity.assembly);assert.equal(m.engine_sha256,identity.engine);assert.equal(m.version_text,identity.version);assert.equal(m.engine_version,'11.2.0.10050');for(const t of m.types){assert.equal(t.local_file,`.local-research/${group}/${t.type}.cs`);types.set(group+':'+t.type,t);}}
 assert.deepEqual(names,read('armor-manifest.json').types.map(t=>t.type));assert.equal(names.length,9);
 const selected=new Set(),localFiles=new Map();let codeReferences=0,xmlReferences=0;
 assert.deepEqual(claims.map(c=>c.id),Array.from({length:18},(_,i)=>'AR'+String(i+1).padStart(2,'0')));
 for(const c of claims){assert(['xml-and-static-derived','design-adaptation'].includes(c.kind));assert(c.sources.length&&c.statement.length>20);for(const s of c.sources){
  assert(Boolean(s.type)!==Boolean(s.xml_record));if(s.type){const k=s.group+':'+s.type,r=types.get(k);assert(r,k);assert(Number.isInteger(s.line_start)&&Number.isInteger(s.line_end)&&s.line_start>0&&s.line_start<=s.line_end&&s.line_end<=r.lines,k);assert(/^[a-f0-9]{64}$/.test(s.range_sha256));selected.add(k);codeReferences++;
   if(local){if(!localFiles.has(k)){const b=readFileSync(path.join(root,r.local_file));assert.equal(sha(b),r.sha256,'Derived changed: '+k);const lines=b.toString('utf8').split('\n');assert.equal(lines.length,r.lines);localFiles.set(k,lines);}assert.equal(sha(localFiles.get(k).slice(s.line_start-1,s.line_end).join('\n')),s.range_sha256);}
  }else{assert(records.has(s.group+':'+s.xml_record));xmlReferences++;}
 }}
 assert(names.every(n=>selected.has('armor:'+n)));
 // CompQuality must not silently introduce a quality MaxHP factor through component defaults.
 if(local)assert(!/override\s+float\s+GetStat(?:Factor|Offset)\s*\(/.test(localFiles.get('armor:RimWorld.CompQuality').join('\n')));
 let analyticAssertions=0;function compare(a,e,label){if(typeof e==='number'){assert(Number.isFinite(a)&&Math.abs(a-e)<1e-8,`${label}: ${a} != ${e}`);analyticAssertions++;}else if(Array.isArray(e)){assert(Array.isArray(a));assert.equal(a.length,e.length,label);e.forEach((v,n)=>compare(a[n],v,label+'['+n+']'));}else if(e&&typeof e==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort());for(const[k,v]of Object.entries(e))compare(a[k],v,label+'.'+k);}else{assert.equal(a,e,label);analyticAssertions++;}}
 const evaluate=armorModels(data,human);assert.equal(cases.length,35);assert.deepEqual(cases.map(c=>c.id),Array.from({length:35},(_,i)=>'AV'+String(i+1).padStart(2,'0')));
 for(const c of cases){assert(evaluate[c.model]);assert(c.claims.length&&c.claims.every(id=>claims.some(q=>q.id===id)));assert(c.limitation.includes('not original execution'));compare(evaluate[c.model](c.inputs),c.expected,c.id);}
 return{status:'pass',version:identity.version,garments:data.garments.length,materials:data.materials.length,bodyNodes:human.nodes.length,newTypes:names.length,reusedTypes:selected.size-names.length,claims:claims.length,cases:cases.length,codeReferences,xmlReferences,armorXmlRecords:xml.records.length,referencedXmlFiles:xmlFiles.size,xmlLeaves,xmlAttributes,xmlAbsences,analyticAssertions,localDerivedFilesVerified:localFiles.size,originalGameExecuted:false,scope:'Static artifact verification and independent double-precision formula/state cases; no native random-stream replay, effective mod database or project integration equivalence.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyArmorEvidence({local:process.argv.includes('--local')}),null,2));
