// Independent arithmetic model for reviewed static rules. Never imports src or runs RimWorld.
import assert from 'node:assert/strict';
const clamp=x=>Math.max(0,Math.min(1,x));
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
export const roundEven=x=>{const n=Math.floor(x),f=x-n;return f===.5?n+(n%2):Math.round(x);};
const hundredth=x=>roundEven(x*100)/100;
const close=(a,b)=>assert(Math.abs(a-b)<1e-12,`${a} != ${b}`);
const canonical=p=>p.replaceAll('[1]','');

export function verifyBodyDerivation(xml,human){
 const records=new Map(xml.records.map(r=>[r.id,r])),raw=records.get('BodyDef_Human');
 const fields=new Map(raw.fields.map(f=>[canonical(f.xpath),f.value]));
 const read=(p,k,d)=>fields.get(canonical(p+'/'+k))??d;
 const defPaths=raw.fields.filter(f=>f.xpath.endsWith('/def')).map(f=>canonical(f.xpath.slice(0,-4)));
 const made=[];
 for(const p of defPaths){
  const defName=read(p,'def'),def=records.get('BodyPartDef_'+defName);assert(def);
  const f=(k,d)=>def.fields.find(x=>x.xpath===def.source.xpath+'/'+k)?.value??d;
  const list=k=>def.fields.filter(x=>x.xpath.startsWith(def.source.xpath+'/'+k+'/li')).map(x=>x.value);
  const parentPath=p.slice(0,p.lastIndexOf('/parts/li')),parent=made.find(n=>canonical(n.sourceXPath)===parentPath);
  const label=read(p,'customLabel',f('label',defName)),id=label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const rel=Number(read(p,'coverage',1)),withChildren=parent?parent.coverageAbsWithChildren*rel:1;
  const direct=defPaths.filter(q=>q.slice(0,q.lastIndexOf('/parts/li'))===p&&q!==p);
  let remainder=1;for(const q of direct)remainder-=Number(read(q,'coverage',1));if(Math.abs(remainder)<1e-5||remainder<0)remainder=0;
  const hitChanceFactors={};for(const x of def.fields.filter(x=>x.xpath.endsWith('/key')&&x.xpath.includes('/hitChanceFactors/')))hitChanceFactors[x.value]=Number(def.fields.find(y=>y.xpath===x.xpath.slice(0,-3)+'value').value);
  const node={id,index:made.length,defName,label,parentId:parent?.id??null,childIds:[],height:read(p,'height',parent?.height??'Middle'),depth:read(p,'depth',parent?.depth??'Outside'),coverageRelative:rel,coverageAbsWithChildren:Number(withChildren.toFixed(15)),coverageAbs:Number((withChildren*remainder).toFixed(15)),groups:raw.fields.filter(x=>canonical(x.xpath).startsWith(p+'/groups/li')).map(x=>x.value),tags:list('tags'),hitPoints:Number(f('hitPoints',10)),bleedRate:Number(f('bleedRate',1)),skinCovered:f('skinCovered','false')==='true',solid:f('solid','false')==='true',conceptual:f('conceptual','false')==='true',destroyableByDamage:f('destroyableByDamage','true')==='true',alive:f('alive','true')==='true',hitChanceFactors,definitionRef:def.id,sourceXPath:human.nodes[made.length]?.sourceXPath};
  assert.equal(canonical(node.sourceXPath),p);if(parent)parent.childIds.push(id);made.push(node);
 }
 assert.deepEqual(made,human.nodes);assert.equal(new Set(made.map(n=>n.id)).size,made.length);close(made.reduce((s,n)=>s+n.coverageAbs,0),1);
}

export function anatomyModels(body,xml){
 const nodes=body.nodes,byId=new Map(nodes.map(n=>[n.id,n]));
 const part=id=>{assert(byId.has(id),'Unknown part '+id);return byId.get(id);};
 const ancestors=id=>{const a=[];for(let n=part(id);n;n=n.parentId?part(n.parentId):null)a.push(n);return a;};
 const subtree=id=>nodes.filter(n=>ancestors(n.id).some(a=>a.id===id));
 const missing=(id,roots)=>ancestors(id).some(n=>roots.includes(n.id));
 const health=({max,damage=0,destroys=true,destroyable=true,missing=false,injuries})=>{if(missing)return 0;let n=max;for(const w of injuries??[{damage,destroys}])n=w.destroys===false?Math.max(1,n-w.damage):n-w.damage;return roundEven(Math.max(destroyable?0:1,n));};
 const efficiency=({max,remaining,inside=false,core=false,offset=0,ignoreMissingHP=false,addedMultiplier=1,ancestorAdded,parentMissing=false})=>ancestorAdded!==undefined?ancestorAdded:parentMissing?0:Math.max(0,addedMultiplier*(ignoreMissingHP?1:inside||core?remaining/max:clamp((remaining/max-.1)/.9))+offset);
 const wrapper=({raw,offset=0,post=1,max=99999,min=0,awake=true,zeroIfCannotBeAwake=false})=>!awake&&zeroIfCannotBeAwake?0:hundredth(Math.max(min,raw>0?Math.min((raw+offset)*post,max):raw));
 function capacities(state={}){
  const roots=state.missing??[],wounds=(state.wounds??[]).filter(w=>!missing(w.part,roots));
  const eff=id=>{const n=part(id);return missing(id,roots)?0:efficiency({max:n.hitPoints,remaining:health({max:n.hitPoints,destroyable:n.destroyableByDamage,injuries:wounds.filter(w=>w.part===id).map(w=>({damage:w.amount,destroys:w.destroys}))}),inside:n.depth==='Inside',core:n.parentId===null});};
  const tag=(name,best=-1)=>{const vals=nodes.filter(n=>n.tags.includes(name)).map(n=>eff(n.id));if(!vals.length)return 1;const top=Math.max(...vals);return best>=0&&vals.length>1?top*best+(vals.reduce((a,b)=>a+b,0)-top)/(vals.length-1)*(1-best):mean(vals);};
  const limb=(prefix,weight)=>{const vals=nodes.filter(n=>n.tags.includes(prefix+'LimbCore')).map(n=>{let start=n;while(start.parentId&&part(start.parentId).tags.includes(prefix+'LimbSegment'))start=part(start.parentId);let value=eff(n.id);for(const s of subtree(start.id).filter(s=>s.tags.includes(prefix+'LimbSegment')))value*=eff(s.id);const digits=subtree(n.id).filter(s=>s.tags.includes(prefix+'LimbDigit'));return value*(digits.length?1-weight+weight*mean(digits.map(d=>eff(d.id))):1);});return{value:mean(vals),functional:mean(vals.map(v=>v>0?1:0))};};
  const c={BloodPumping:hundredth(tag('BloodPumpingSource')),Breathing:hundredth(tag('BreathingSource')*Math.min(1,tag('BreathingPathway'))*Math.min(1,tag('BreathingSourceCage'))),BloodFiltration:hundredth(tag('BloodFiltrationKidney')*tag('BloodFiltrationLiver')),Metabolism:hundredth(tag('MetabolismSource'))};
  const pain=state.pain??Math.min(1,wounds.reduce((s,w)=>s+w.amount*(part(w.part).solid?.01:.0125),0));
  const penalty=clamp((pain-.1)/.9)*.4;
  c.Consciousness=hundredth(Math.max(0,(tag('ConsciousnessSource')-(penalty>=.01?penalty:0))*(.8+.2*Math.min(1,c.BloodPumping))*(.8+.2*Math.min(1,c.Breathing))*(.9+.1*Math.min(1,c.BloodFiltration))));
  const awake=c.Consciousness>=.3,movement=limb('Moving',.4);
  c.Manipulation=wrapper({raw:limb('Manipulation',.8).value*c.Consciousness,awake,zeroIfCannotBeAwake:true});
  c.Moving=wrapper({raw:movement.functional<.4999||state.alwaysDowned?0:movement.value*tag('Pelvis')*tag('Spine')*(.8+.2*c.Breathing)*(.8+.2*c.BloodPumping)*Math.min(1,c.Consciousness),awake,zeroIfCannotBeAwake:true});
  c.Sight=hundredth(tag('SightSource',.75));c.Hearing=hundredth(tag('HearingSource',.75));
  c.Talking=wrapper({raw:tag('TalkingSource')*Math.min(1,tag('TalkingPathway'))*Math.min(1,tag('Tongue'))*c.Consciousness,awake,zeroIfCannotBeAwake:true});
  c.Eating=wrapper({raw:tag('EatingSource')*Math.min(1,tag('EatingPathway'))*(.5+.5*tag('Tongue'))*c.Consciousness,min:.1,awake,zeroIfCannotBeAwake:true});
  if(state.dead)for(const key of Object.keys(c))c[key]=0;
  return c;
 }
 const chain=id=>{const a=[];for(const n of ancestors(id)){a.push(n);if(n.depth==='Outside')break;}return a;};
 const curve=(x,p)=>{if(x<=p[0][0])return p[0][1];for(let k=1;k<p.length;k++){const[a,b]=p[k-1],[c,d]=p[k];if(x<=c)return b+(d-b)*(x-a)/(c-a);}return p.at(-1)[1];};
 return{
  structure:()=>({nodes:nodes.length,definitions:new Set(nodes.map(n=>n.defName)).size,outsidePositive:nodes.filter(n=>n.depth==='Outside'&&n.coverageAbs>0).length,inside:nodes.filter(n=>n.depth==='Inside').length,conceptual:nodes.filter(n=>n.conceptual).length,totalCoverage:nodes.reduce((s,n)=>s+n.coverageAbs,0),outsideCoverage:nodes.filter(n=>n.depth==='Outside').reduce((s,n)=>s+n.coverageAbs,0)}),
  partHealth:({max,rows})=>rows.map(r=>health({max,...r})),partEfficiency:({rows})=>rows.map(efficiency),capacityWrapper:({rows})=>rows.map(wrapper),capacities:x=>x.pick.map(k=>capacities(x)[k]),
  missing:({roots,wounds})=>({missingCount:nodes.filter(n=>missing(n.id,roots)).length,remainingWounds:wounds.filter(w=>!missing(w.part,roots)).map(w=>w.part),roots:roots.filter((id,i)=>roots.indexOf(id)===i&&!ancestors(id).slice(1).some(n=>roots.includes(n.id)))}),
  stump:({rows})=>rows.map(r=>{const n=part(r.part),active=r.fresh&&!r.tended&&(r.age??0)<90000&&!r.parentMissing&&!r.ancestorAdded&&!r.dead&&n.depth==='Outside'&&!n.solid;return{bleed:active?n.hitPoints*.12*n.bleedRate:0,pain:active?n.hitPoints*.0125:0};}),
  hitWeights:({damage,depth})=>{const pool=nodes.filter(n=>n.depth===depth),weight=n=>n.coverageAbs*(n.conceptual?0:n.hitChanceFactors[damage]??1);return{total:pool.reduce((s,n)=>s+weight(n),0),eyeWeight:pool.filter(n=>n.defName==='Eye').reduce((s,n)=>s+weight(n),0),utilityWeight:weight(part('utility-slot'))};},
  mapping:({rows})=>rows.map(([damage,id])=>{const n=part(id);return n.solid?'Crack':['Blunt','Poke'].includes(damage)?n.skinCovered?'Bruise':'Crush':damage;}),
  preserve:({rows})=>rows.map(r=>r.inside||r.core||r.damage<r.hp?r.damage:r.roll<clamp(((r.damage-r.hp)/r.max-r.range[0])/(r.range[1]-r.range[0]))?r.damage:r.hp-1),
  stabPlan:({part:id,damage})=>{const a=chain(id);return a.map(n=>({part:n.id,damage:damage*(a.length===1?1:n.depth==='Outside'?.75:.4)}));},
  cutInsidePlan:({part:id,damage})=>{const a=chain(id);return a.map((n,i)=>({part:n.id,damage:damage*(i===0?.5:1)/(a.length-.5)}));},
  cutCleave:({damage,targets})=>targets.map(n=>damage*2.4/(n+1.4)),
  bluntPlan:({damage,convert,extra,hp})=>{let rest=damage*(1-convert);const outer=[];for(const n of hp){const applied=Math.min(n,rest);outer.push(applied);rest-=applied;if(rest<=1)break;}return{outer,inner:convert?damage*(convert+extra):0};},
  fatal:({rows})=>rows.map(r=>{const c=capacities(r);return['BloodFiltration','BloodPumping','Breathing','Consciousness','Metabolism'].filter(k=>c[k]<=0);}),
  statSight:({level:l,manipulation:m,sight:s})=>{const cap=(weight,max)=>1-weight+weight*Math.min(s,max);return{mining:Math.max(.1,(.04+.12*l)*m*cap(.5,1)),plants:Math.max(.1,(.08+.115*l)*m*cap(.3,1)),construction:Math.max(.1,(.3+.0875*l)*1.7*m*cap(.2,1)),tendSpeed:Math.max(.1,(.4+.06*l)*m*cap(.8,1.3)),tendQuality:curve((.2+.1*l)*Math.min(m,1.4)*cap(.7,1.4),[[0,0],[1,1],[2,1.5],[4,2]]),cooking:curve(l+4*(Math.min(s,1.5)-1)+16*(Math.min(m,1.5)-1),[[-20,.01],[0,.4],[20,1.6]]),research:Math.max(.1,(.08+.115*l)*(.5+.5*Math.min(m,1.1))*cap(.5,1.1))};},
  workQualification:({manipulations})=>manipulations.map(m=>m>0),
  naturalGroup:({group,missing:roots=[]})=>mean(nodes.filter(n=>n.groups.includes(group)&&!missing(n.id,roots)).map(()=>1)),
  time:({nativeTicks,nativeDay,projectDay})=>nativeTicks/nativeDay*projectDay,
 };
}
