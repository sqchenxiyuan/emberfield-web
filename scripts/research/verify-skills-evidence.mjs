import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const project=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const identity={version:'1.7.4980 rev60',assembly:'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',engine:'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'};
// Reviewed semantic pins. The evidence writer never changes these automatically.
const pins={
 'skills-types.json':'9e00527ad0f57055837080454d384c7084ff2de1e1e4ab4fbe64b50f589e8e2f',
 'skills-claims.json':'a43bf4ec2582358bc3cfe6f7fb973a6b8a11992a9557df97d9e8872ffacf1ded',
 'skills-cases.json':'347257b5f3df0963376014f70aaa322d3fea2c0b0510a85e85f9f6789f83a9e8',
 'skills-xml.json':'7ae43b0c1d62cae5f91a50e8933061d012de6b8c57560137c5543392697e22c7',
 'skills-manifest.json':'43fb34340054aa87a8e0cd8217945f11770bd3822d2f4d5afb80631bc6a7711d',
 'economy-manifest.json':'153d5521f7f8287a8c89895ccad10b574ac6ece8b6e630881840fd9e16b6865e',
 'housing-manifest.json':'460be621c5f0a681a05ced165e76d495f30bae3e4b3c80394ee1d0eecb36ce4e',
 'generation-manifest.json':'e2e357427b447f4d68236891430ad1212339d336fc2eda2b5859aee33c443b91',
 'stonecutting-manifest.json':'dbe06849c5b123baad629014739672fd6206bc5ad5ff0cdd32652f2d1f915d53',
 'food-manifest.json':'133b8d8b4dadf25edd4667c3276c22a636cf639c84a0ae811998c304b00d6823',
 'plants-manifest.json':'de6122f08d689095163bb129d312beb076737b5e4ecc87492610549b7117f9d2',
 'apparel-manifest.json':'54c34415dcfd32aa2f0054103c162ab7e297a8f5cd8008419dd37ffd30de2dd3',
 'injuries-manifest.json':'c39107d56e4c4ed4f76076baa8d8c3c1d2e85d26f4098a6d383cd10b4d7b42e8',
 'energy-manifest.json':'d9d48c42d1ad87f21f4cfda817d78eb8cb77ca519d1dda0338f16ebb96ab87fa',
 'weapons-manifest.json':'db557b2e2bacf8fbd2aff71528a187395445de7618ea63b4c478e77bbe3f2f1a'
};
const centers=[.7,1.1,1.5,1.8,2,2.2,2.4,2.6,2.8,2.95,3.1,3.25,3.4,3.5,3.6,3.7,3.8,3.9,4,4.1,4.2];
const decay=[.1,.2,.4,.6,1,1.8,2.8,4,6,8,12];
const curve=(x,points)=>{if(x<=points[0][0])return points[0][1];for(let k=1;k<points.length;k++){const[a,b]=points[k-1],[c,d]=points[k];if(x<=c)return b+(d-b)*(x-a)/(c-a);}return points.at(-1)[1];};
const required=l=>curve(l,[[0,1000],[9,10000],[19,30000]]);
function learn({state,xp,direct=false,global=1,ignoreLearnRate=false}){
 const s={...state};if(xp<0&&s.level===0)return s;
 if(xp>0&&!ignoreLearnRate)xp*=[.35,1,1.5][s.passion]*(direct?1:global*(s.dailyXp>4000?.2:1));
 s.xp+=xp;if(!direct)s.dailyXp+=xp;
 if(s.level===20)s.xp=Math.min(s.xp,required(20)-1);
 while(s.xp>=required(s.level)){s.xp-=required(s.level);s.level++;if(s.level>=20){s.level=20;s.xp=Math.max(0,Math.min(s.xp,required(20)-1));break;}}
 while(s.xp<=-1000){s.level--;s.xp+=required(s.level);if(s.level<=0){s.level=0;s.xp=0;break;}}
 return s;
}
const cap=(x,w,max=Infinity)=>1-w+w*Math.min(x,max);
function quality(level,next,inspired=false){const sample=upper=>{const z=Math.sqrt(-2*Math.log(next()))*Math.sin(2*Math.PI*next());return Math.max(0,Math.min(5,Math.trunc(centers[level]+z*(z<=0?.6:upper))));};let q=sample(.8);if(q===5&&next()<.5)q=sample(.95);return inspired?Math.min(6,q+2):q;}
// Abramowitz-Stegun approximation; max CDF error is below 8e-8, far below sampling tolerance.
function normalCDF(z){const x=Math.abs(z)/Math.SQRT2,t=1/(1+.3275911*x),e=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);return .5*(1+(z<0?-e:e));}
function probabilities(level){const c=centers[level];const mass=upper=>{const cdf=x=>normalCDF((x-c)/(x<=c?.6:upper));return[cdf(1),...Array.from({length:4},(_,i)=>cdf(i+2)-cdf(i+1)),1-cdf(5)];};const p=mass(.8),r=mass(.95);return p.map((v,k)=>k===5?v*(.5+.5*r[5]):v+.5*p[5]*r[k]);}
const models={
 requirements:({levels})=>levels.map(required),learn,
 decay:({levels,sourceDay,sourceInterval,projectDay,projectInterval})=>{const perInterval=levels.map(l=>l<10?0:decay[l-10]);return{perInterval,sourceEvents:sourceDay/sourceInterval,projectEvents:projectDay/projectInterval,fixedLevelDaily:perInterval.map(x=>x*sourceDay/sourceInterval)};},
 work:({level:l,manipulation:m,sight:s,global:g})=>({mining:Math.max(.1,g*(.04+.12*l)*m*cap(s,.5,1)),plants:Math.max(.1,g*(.08+.115*l)*m*cap(s,.3,1)),construction:Math.max(.1,g*(.3+.0875*l)*m*cap(s,.2,1)),cooking:Math.max(.1,g*curve(l+4*(Math.min(s,1.5)-1)+16*(Math.min(m,1.5)-1),[[-20,.01],[0,.4],[20,1.6]])),medicine:Math.max(.1,g*(.4+.06*l)*m*cap(s,.8,1.3)),general:Math.max(.1,g*m*cap(s,.5,1))}),
 combatMedical:({level:l,manipulation:m,sight:s,moving:v})=>({hit:curve(l+12*(Math.min(m,1.5)-1)+12*(Math.min(s,1.5)-1),[[-20,.05],[-10,.1],[0,.5],[10,.8],[20,.9],[40,.96],[60,.98]]),dodge:curve(l+18*(v-1)+8*(Math.min(s,1.4)-1),[[5,0],[20,.3],[60,.5]]),tend:curve((.2+.1*l)*Math.min(m,1.4)*cap(s,.7,1.4),[[0,0],[1,1],[2,1.5],[4,2]])}),
 timing:({sourceWorkTicks,projectWorkTicks,baseRates,humanTendBase,medicineFactors,meleeSeconds})=>({rawXP:baseRates.map(x=>x*sourceWorkTicks),projectRawXP:baseRates.map(x=>x*3*projectWorkTicks),tendRawXP:medicineFactors.map(x=>x*humanTendBase),meleeRawXP:200*meleeSeconds}),
 qualityBranch:({level,random,inspired})=>{let n=0;const q=quality(level,()=>{assert(n<random.length);return random[n++];},inspired);return{quality:q,draws:n};},
 constructionMaterial:({base,level,stuff})=>({work:stuff.map(x=>base*x.factor+x.offset),progress:stuff.map(x=>(.3+.0875*level)*1.7*x.speed)}),
 harvest:({base,rows})=>rows.map(({stat,failable,failDraw,roundDraw})=>{if(failable&&failDraw>stat)return 0;const amount=stat>1?base*stat:base;return Math.floor(amount)+(roundDraw<amount-Math.floor(amount)?1:0);}),
 mineYield:({base,maxHP,damage,roundDraw})=>{const yieldPct=damage.reduce((s,d)=>s+Math.min(d.amount,d.remainingHP)/maxHP*d.stat,0),amount=base*yieldPct;return{yieldPct,product:Math.max(1,Math.floor(amount)+(roundDraw<amount-Math.floor(amount)?1:0))};},
 batchSaturation:({startDaily,rawEvents,splitEvents})=>{const run=events=>{let s={level:3,xp:0,passion:1,dailyXp:startDaily};for(const xp of events)s=learn({state:s,xp});return s.xp;};return{batch:run(rawEvents),split:run(splitEvents),afterBoundaryExample:learn({state:{level:3,xp:0,passion:1,dailyXp:4001},xp:100}).xp};},
 qualityDistribution:({levels,samplesPerLevel,seed,maxStandardErrors})=>{
  let state=seed>>>0;const next=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return(state+.5)/4294967296;};
  for(const level of levels){const p=probabilities(level),counts=Array(7).fill(0);for(let n=0;n<samplesPerLevel;n++)counts[quality(level,next)]++;assert(Math.abs(p.reduce((a,b)=>a+b)-1)<1e-12);assert.equal(counts[6],0);for(let k=0;k<6;k++){const expected=p[k]*samplesPerLevel,tolerance=maxStandardErrors*Math.sqrt(samplesPerLevel*p[k]*(1-p[k]))+4;assert(Math.abs(counts[k]-expected)<tolerance,`quality L${level} Q${k} inconsistent with CDF`);}}
  return{probabilitiesSum:1,ordinaryLegendary:0};
 }
};
export function verifySkillsEvidence({root=project,local=false}={}){
 const dir=path.join(root,'docs/research/rimworld/evidence'),read=n=>JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
 for(const[file,pin]of Object.entries(pins))assert.equal(sha(JSON.stringify(read(file))),pin,'Reviewed snapshot changed: '+file);
 assert(Object.keys(pins).length>=10,'Review and populate semantic pins before validation.');
 const xml=read('skills-xml.json'),claims=read('skills-claims.json'),cases=read('skills-cases.json'),names=read('skills-types.json');
 assert.equal(xml.assembly_sha256,identity.assembly);assert.equal(xml.version_text,identity.version);assert.equal(xml.records.length,89);
 const records=new Map(),xmlFiles=new Map();let xmlLeaves=0,xmlAttributes=0,xmlAbsences=0;
 for(const r of xml.records){assert(!records.has(r.id));records.set(r.id,r);assert(r.source.path.startsWith('Data/Core/Defs/')&&!r.source.path.includes('..'));assert(/^[a-f0-9]{64}$/.test(r.source.sha256));if(xmlFiles.has(r.source.path))assert.equal(xmlFiles.get(r.source.path),r.source.sha256);xmlFiles.set(r.source.path,r.source.sha256);for(const f of r.fields){assert(f.xpath.startsWith(r.source.xpath+'/'));xmlLeaves++;}xmlAttributes+=r.node_attributes.length;xmlAbsences+=r.absent_paths.length;}
 const field=(id,p)=>records.get(id).fields.find(f=>f.xpath===records.get(id).source.xpath+'/'+p)?.value;
 assert(records.get('StatDef_GeneralLaborSpeed').absent_paths.includes('skillNeedFactors'));
 assert.equal(field('RecipeDef_MakeStoneBlocksBase','workSkillLearnFactor'),'0');
 assert.equal(field('ThingDef_StoneBlocksBase','statBases/ConstructionSpeedFactor'),'0.8');
 assert.equal(field('TerrainDef_TileStoneBase','constructionSkillPrerequisite'),'3');
 assert.equal(field('ThingDef_TreeBase','plant/sowMinSkill'),'6');
 assert.equal(field('ThingDef_MeleeWeapon_LongSword','recipeMaker/skillRequirements/Crafting'),'5');
 const groups=[...new Set(claims.flatMap(c=>c.sources.filter(s=>s.type).map(s=>s.group)))],types=new Map();
 for(const group of groups){assert(/^[a-z][a-z0-9-]+$/.test(group));const m=read(group+'-manifest.json');assert.equal(m.source_sha256,identity.assembly);assert.equal(m.engine_sha256,identity.engine);assert.equal(m.version_text,identity.version);assert.equal(m.engine_version,'11.2.0.10050');for(const t of m.types){assert.equal(t.local_file,`.local-research/${group}/${t.type}.cs`);types.set(group+':'+t.type,t);}}
 assert.deepEqual(names,read('skills-manifest.json').types.map(t=>t.type));assert.equal(names.length,15);
 const selected=new Set(),localFiles=new Map();let codeReferences=0,xmlReferences=0;
 assert.deepEqual(claims.map(c=>c.id),Array.from({length:20},(_,i)=>'SK'+String(i+1).padStart(2,'0')));
 for(const c of claims){assert(['xml-and-static-derived','xml-declared','design-adaptation'].includes(c.kind));assert(c.sources.length&&c.statement.length>20);for(const s of c.sources){assert(Boolean(s.type)!==Boolean(s.xml_record));if(s.type){const k=s.group+':'+s.type,r=types.get(k);assert(r);assert(Number.isInteger(s.line_start)&&Number.isInteger(s.line_end)&&s.line_start>0&&s.line_start<=s.line_end&&s.line_end<=r.lines);assert(/^[a-f0-9]{64}$/.test(s.range_sha256));selected.add(k);codeReferences++;if(local){if(!localFiles.has(k)){const b=readFileSync(path.join(root,r.local_file));assert.equal(sha(b),r.sha256,'Derived changed: '+k);const lines=b.toString('utf8').split('\n');assert.equal(lines.length,r.lines);localFiles.set(k,lines);}assert.equal(sha(localFiles.get(k).slice(s.line_start-1,s.line_end).join('\n')),s.range_sha256);}}else{assert.equal(s.group,'skills');assert(records.has(s.xml_record));xmlReferences++;}}}
 assert(names.every(n=>selected.has('skills:'+n)));
 let analyticAssertions=0;
 function compare(a,e,label){if(typeof e==='number'){assert(Number.isFinite(a)&&Math.abs(a-e)<1e-8,`${label}: ${a} != ${e}`);analyticAssertions++;}else if(Array.isArray(e)){assert(Array.isArray(a));assert.equal(a.length,e.length);e.forEach((v,n)=>compare(a[n],v,label+'['+n+']'));}else if(e&&typeof e==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort());for(const[k,v]of Object.entries(e))compare(a[k],v,label+'.'+k);}else{assert.equal(a,e);analyticAssertions++;}}
 assert.equal(cases.length,26);for(const c of cases){assert(models[c.model]);assert(c.claims.length&&c.claims.every(id=>claims.some(q=>q.id===id)));assert(c.limitation.includes('not original execution'));compare(models[c.model](c.inputs),c.expected,c.id);}
 return{status:'pass',version:identity.version,newTypes:names.length,reusedTypes:selected.size-names.length,claims:claims.length,cases:cases.length,codeReferences,xmlReferences,xmlFiles:xmlFiles.size,xmlRecords:records.size,xmlLeaves,xmlAttributes,xmlAbsences,analyticAssertions,sampledProducts:1200000,qualityProbabilities:Object.fromEntries([0,3,5,10,15,20].map(l=>[l,probabilities(l)])),localDerivedFilesVerified:localFiles.size,originalGameExecuted:false,scope:'Static artifact verification, independent branch arithmetic and seeded quality distribution sampling; no native runtime or project integration equivalence.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifySkillsEvidence({local:process.argv.includes('--local')}),null,2));
