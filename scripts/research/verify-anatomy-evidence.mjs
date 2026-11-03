import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {anatomyModels,verifyBodyDerivation} from './anatomy-model.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const identity={version:'1.7.4980 rev60',assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'};
// Reviewed semantic pins. Collectors and evidence writers do not update these.
const pins={
 "anatomy-types.json": "9235922874ca8b9f0f6103b6908880385160842f9a1c8ec567065bceccb4b007",
 "anatomy-claims.json": "f4f15045084101ccd29639b9b719bd3bede2d9acedfa0716d5b1906dc4a5bc4b",
 "anatomy-cases.json": "8fac88964fbd0cbe0de69d2951facb71bde415a5b7bd754c8b722f42950e88f9",
 "anatomy-xml.json": "5eebd0b482dce25c359d174d66c00d4df11736252deed5caf7bdd6dfefaa73dd",
 "anatomy-human.json": "58c725cc1707e9fcf3ddb627d129f9927e4e5cafceb80918fa44556f3d542868",
 "injuries-manifest.json": "c39107d56e4c4ed4f76076baa8d8c3c1d2e85d26f4098a6d383cd10b4d7b42e8",
 "anatomy-manifest.json": "86fa432b8c6411c415b7370cb79b27b28ea8c9d4be626f7da13e7301b4f37068",
 "combat-manifest.json": "6e2c1683d4bd75d41a2ff0c7e0d439f32a9f7ab884a27e1504aca0f0d35ac83c",
 "survival-manifest.json": "c4181eaeb6a69a8aa0d0ec95115782c99d86a8fc127b52d5f5d9cb96aa5ed443",
 "work-manifest.json": "d41ef0b6fed099fea1ae9c8d8dc2f13e24d213d622c02850d9dfd149995cfa45",
 "skills-manifest.json": "43fb34340054aa87a8e0cd8217945f11770bd3822d2f4d5afb80631bc6a7711d",
 "plants-manifest.json": "de6122f08d689095163bb129d312beb076737b5e4ecc87492610549b7117f9d2",
 "food-manifest.json": "133b8d8b4dadf25edd4667c3276c22a636cf639c84a0ae811998c304b00d6823",
 "technology-manifest.json": "f0301a15e9e976e14acac5ce89aed6e25c146c3be125c95b391bc5c6afe0d3da",
 "housing-manifest.json": "460be621c5f0a681a05ced165e76d495f30bae3e4b3c80394ee1d0eecb36ce4e",
 "skills-xml.json": "7ae43b0c1d62cae5f91a50e8933061d012de6b8c57560137c5543392697e22c7",
 "technology-xml.json": "b897425cb072c46f6f6a90177b95459348e6525961c82f77dbb17eae9001ba15"
};
export function verifyAnatomyEvidence({root=project,local=false}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence'),read=n=>JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
 assert.equal(Object.keys(pins).length,17,'Populate reviewed semantic pins.');
 for(const[file,pin]of Object.entries(pins))assert.equal(sha(JSON.stringify(read(file))),pin,'Reviewed snapshot changed: '+file);
 const xml=read('anatomy-xml.json'),body=read('anatomy-human.json'),claims=read('anatomy-claims.json'),cases=read('anatomy-cases.json'),names=read('anatomy-types.json');
 assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.version_text,identity.version);assert.equal(xml.records.length,66);
 assert.equal(body.assembly_sha256,identity.assembly);assert.equal(body.version_text,identity.version);assert.equal(body.nodes.length,64);
 verifyBodyDerivation(xml,body);
 const records=new Map(),xmlFiles=new Map();let xmlLeaves=0,xmlAttributes=0,xmlAbsences=0;
 for(const group of ['anatomy','skills','technology'])for(const r of read(group+'-xml.json').records){const key=group+':'+r.id;assert(!records.has(key));records.set(key,r);assert(r.source.path.startsWith('Data/Core/Defs/')&&!r.source.path.includes('..'));assert(/^[a-f0-9]{64}$/.test(r.source.sha256));if(xmlFiles.has(r.source.path))assert.equal(xmlFiles.get(r.source.path),r.source.sha256);xmlFiles.set(r.source.path,r.source.sha256);for(const f of r.fields)assert(f.xpath.startsWith(r.source.xpath+'/'));if(group==='anatomy'){xmlLeaves+=r.fields.length;xmlAttributes+=r.node_attributes.length;xmlAbsences+=r.absent_paths.length;}}
 const get=id=>records.get('anatomy:'+id),field=(id,p)=>get(id).fields.find(f=>f.xpath===get(id).source.xpath+'/'+p)?.value;
 assert.equal(get('DamageDef_Blunt').name_attribute,'BluntBase');assert.equal(get('DamageDef_Poke').parent_name,'BluntBase');assert.equal(field('DamageDef_Poke','workerClass'),'DamageWorker_Stab');assert.equal(field('DamageDef_Poke','stabChanceOfForcedInternal'),'0.4');
 assert.equal(field('DamageDef_Blunt','harmAllLayersUntilOutside'),'true');assert.equal(field('DamageDef_Blunt','overkillPctToDestroyPart'),'0.4~1.0');
 const capacities=xml.records.filter(r=>r.group==='capacity');assert.equal(capacities.length,11);
 assert.deepEqual(capacities.filter(r=>field(r.id,'lethalFlesh')==='true').map(r=>r.def_name).sort(),['BloodFiltration','BloodPumping','Breathing','Consciousness','Metabolism']);
 for(const r of xml.records.filter(r=>r.group==='work'))assert.deepEqual(r.fields.filter(f=>f.xpath.includes('/requiredCapacities/')).map(f=>f.value),['Manipulation']);
 const groups=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))],types=new Map();
 for(const group of groups){assert(/^[a-z][a-z0-9-]+$/.test(group));const m=read(group+'-manifest.json');assert.equal(m.source_sha256,identity.assembly);assert.equal(m.engine_sha256,identity.engine);assert.equal(m.version_text,identity.version);assert.equal(m.engine_version,'11.2.0.10050');for(const t of m.types){assert.equal(t.local_file,`.local-research/${group}/${t.type}.cs`);types.set(group+':'+t.type,t);}}
 assert.deepEqual(names,read('anatomy-manifest.json').types.map(t=>t.type));assert.equal(names.length,21);
 const selected=new Set(),localFiles=new Map();let codeReferences=0,xmlReferences=0;
 assert.deepEqual(claims.map(c=>c.id),Array.from({length:26},(_,i)=>'AC'+String(i+1).padStart(2,'0')));
 for(const c of claims){assert(['xml-and-static-derived','design-adaptation'].includes(c.kind));assert(c.sources.length&&c.statement.length>20);for(const s of c.sources){assert(Boolean(s.type)!==Boolean(s.xml_record));if(s.type){const k=s.group+':'+s.type,r=types.get(k);assert(r,k);assert(Number.isInteger(s.line_start)&&Number.isInteger(s.line_end)&&s.line_start>0&&s.line_start<=s.line_end&&s.line_end<=r.lines,k);assert(/^[a-f0-9]{64}$/.test(s.range_sha256));selected.add(k);codeReferences++;if(local){if(!localFiles.has(k)){const b=readFileSync(path.join(root,r.local_file));assert.equal(sha(b),r.sha256,'Derived changed: '+k);const lines=b.toString('utf8').split('\n');assert.equal(lines.length,r.lines);localFiles.set(k,lines);}assert.equal(sha(localFiles.get(k).slice(s.line_start-1,s.line_end).join('\n')),s.range_sha256);}}else{assert(records.has(s.group+':'+s.xml_record));xmlReferences++;}}}
 assert(names.every(n=>selected.has('anatomy:'+n)));
 let analyticAssertions=0;function compare(a,e,label){if(typeof e==='number'){assert(Number.isFinite(a)&&Math.abs(a-e)<1e-8,`${label}: ${a} != ${e}`);analyticAssertions++;}else if(Array.isArray(e)){assert(Array.isArray(a));assert.equal(a.length,e.length,label);e.forEach((v,n)=>compare(a[n],v,label+'['+n+']'));}else if(e&&typeof e==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort());for(const[k,v]of Object.entries(e))compare(a[k],v,label+'.'+k);}else{assert.equal(a,e,label);analyticAssertions++;}}
 const evaluate=anatomyModels(body,xml);assert.equal(cases.length,49);for(const c of cases){assert(evaluate[c.model]);assert(c.claims.length&&c.claims.every(id=>claims.some(q=>q.id===id)));assert(c.limitation.includes('not original execution'));compare(evaluate[c.model](c.inputs),c.expected,c.id);}
 return{status:'pass',version:identity.version,bodyNodes:body.nodes.length,bodyDefinitions:new Set(body.nodes.map(n=>n.defName)).size,naturalCapacities:capacities.length,newTypes:names.length,reusedTypes:selected.size-names.length,claims:claims.length,cases:cases.length,codeReferences,xmlReferences,anatomyXmlRecords:xml.records.length,referencedXmlFiles:xmlFiles.size,xmlLeaves,xmlAttributes,xmlAbsences,analyticAssertions,localDerivedFilesVerified:localFiles.size,originalGameExecuted:false,scope:'Static artifact verification and independent double-precision formula/state cases; not C# float-bit emulation, native runtime or project integration equivalence.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyAnatomyEvidence({local:process.argv.includes('--local')}),null,2));
