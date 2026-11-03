// Portable, independent static-rule models. Does not import production code or load target code.
import assert from 'node:assert/strict';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const roundEven=x=>{const n=Math.floor(x);return x-n===.5?n+(n%2):Math.round(x);};
const roundRandom=(x,roll)=>Math.trunc(x)+(roll<x%1?1:0);
export function armorData(xml,human){
 const records=new Map(xml.records.map(r=>[r.id,r])),named=new Map(xml.records.filter(r=>r.name_attribute).map(r=>[r.name_attribute,r]));
 const record=id=>{assert(records.has(id),id);return records.get(id);};
 const chain=id=>{const out=[];for(let r=record(id);r;r=named.get(r.parent_name)){assert(!out.includes(r),'Cycle');out.unshift(r);}return out;};
 const own=(r,k)=>r.fields.find(f=>f.xpath===r.source.xpath+'/'+k)?.value;
 const field=(id,k,d)=>{let value=d;for(const r of chain(id)){const v=own(r,k);if(v!==undefined)value=v;}return value;};
 const list=(id,k)=>{let a=[];for(const r of chain(id)){if(r.node_attributes.some(x=>x.xpath===r.source.xpath+'/'+k&&x.attributes.Inherit?.toLowerCase()==='false'))a=[];a.push(...r.fields.filter(f=>f.xpath.startsWith(r.source.xpath+'/'+k+'/li')).map(f=>f.value));}return a;};
 const numeric=(id,k,d=0)=>Number(field(id,k,d));
 const quality=['Awful','Poor','Normal','Good','Excellent','Masterwork','Legendary'];
 const qualityFrom=id=>quality.map(q=>{const r=record(id);return Number(r.fields.find(f=>f.xpath.endsWith('/factor'+q)).value);});
 const materials=['Steel','Cloth','WoodLog'].map(id=>({id,armor:['Sharp','Blunt','Heat'].map(c=>numeric('ThingDef_'+id,'statBases/StuffPower_Armor_'+c)),cold:numeric('ThingDef_'+id,'statBases/StuffPower_Insulation_Cold'),heat:numeric('ThingDef_'+id,'statBases/StuffPower_Insulation_Heat'),hpFactor:numeric('ThingDef_'+id,'stuffProps/statFactors/MaxHitPoints',1)}));
 const layers=Object.fromEntries(xml.records.filter(r=>r.group==='layer').map(r=>[r.def_name,Number(own(r,'drawOrder'))]));
 const garments=xml.records.filter(r=>r.group==='garment'&&r.def_name.startsWith('Apparel_')).map(r=>{const id=r.id,groups=list(id,'apparel/bodyPartGroups'),ls=list(id,'apparel/layers');return{id:r.def_name,sourceChain:chain(id).map(r=>r.id),cost:numeric(id,'costStuffCount'),work:numeric(id,'statBases/WorkToMake'),maxHP:numeric(id,'statBases/MaxHitPoints',100),mass:numeric(id,'statBases/Mass'),equipDelay:numeric(id,'statBases/EquipDelay'),armorMultiplier:numeric(id,'statBases/StuffEffectMultiplierArmor'),armorBase:['Sharp','Blunt','Heat'].map(c=>numeric(id,'statBases/ArmorRating_'+c)),coldMultiplier:numeric(id,'statBases/StuffEffectMultiplierInsulation_Cold'),heatMultiplier:numeric(id,'statBases/StuffEffectMultiplierInsulation_Heat'),moveOffset:numeric(id,'equippedStatOffsets/MoveSpeed'),research:field(id,'recipeMaker/researchPrerequisite',null),craftingMin:field(id,'recipeMaker/skillRequirements/Crafting',null)===null?null:numeric(id,'recipeMaker/skillRequirements/Crafting'),workSkill:field(id,'recipeMaker/workSkill',null),workSpeedStat:field(id,'recipeMaker/workSpeedStat',null),benches:list(id,'recipeMaker/recipeUsers'),stuffCategories:list(id,'stuffCategories'),groups,layers:ls,drawOrder:layers[ls.at(-1)],coveredParts:human.nodes.filter(n=>n.groups.some(g=>groups.includes(g))).map(n=>n.id),wearPerDay:numeric(id,'apparel/wearPerDay',.4)};});
 return{evidence_id:'RW17-ARMOR-DATA',version_text:xml.version_text,assembly_sha256:xml.assembly_sha256,kind:'Selected reviewed Core inheritance and static arithmetic; not an effective runtime database.',quality,armorQuality:qualityFrom('StatDef_ArmorRatingBase'),meleeQuality:qualityFrom('StatDef_MeleeWeapon_DamageMultiplier'),rangedPenetrationQuality:qualityFrom('StatDef_RangedWeapon_ArmorPenetrationMultiplier'),materials,layers,garments};
}

export function armorModels(data,human){
 const garment=id=>{const x=data.garments.find(x=>x.id===id);assert(x,id);return x;};
 const material=id=>{const x=data.materials.find(x=>x.id===id);assert(x,id);return x;};
 function layered({amount,penetration,category='Sharp',damageDef='Cut',layers=[],natural=0,naturalRoll=.9}){
  const initialCategory=category,originalWorker=damageDef,steps=[];let current=amount,currentDef=damageDef,currentCategory=category;
  if(category===null)return{amount:current,damageDef:currentDef,originalWorker,steps};
  for(const layer of [...layers,{id:'natural',armor:{[initialCategory]:natural},armorRoll:naturalRoll}]){
   const incoming=current,rating=layer.armor[initialCategory],wear=layer.id==='natural'?0:Math.min(layer.hp??100,roundRandom(incoming*.25,layer.wearRoll??.9));
   const effective=Math.max(0,rating-penetration),roll=layer.armorRoll;
   let outcome='full';if(roll<effective*.5){current=0;outcome='deflect';}else if(roll<effective){current=roundRandom(current/2,layer.halfRoll??.9);outcome='half';if(currentCategory==='Sharp'){currentDef='Blunt';currentCategory='Blunt';}}
   steps.push({id:layer.id,armorStat:initialCategory,incoming,wear,outcome,remaining:current,damageDef:currentDef});if(current<.001){current=0;break;}
  }
  return{amount:current,damageDef:currentDef,originalWorker,steps};
 }
 return{
  probabilities:({rows})=>rows.map(({armor,penetration})=>{const e=Math.max(0,armor-penetration),deflect=clamp(e*.5),half=clamp(e)-deflect;return{deflect,half,full:1-deflect-half,expectedFraction:half*.5+1-deflect-half};}),
  threshold:({armor,penetration,amount,rolls,halfRoll=.9})=>rolls.map(roll=>{const e=Math.max(0,armor-penetration);return roll<e*.5?0:roll<e?roundRandom(amount/2,halfRoll):amount;}),
  roundRandom:({values,rolls})=>values.map((v,i)=>roundRandom(v,rolls[i])),
  randValue:({ints})=>ints.map(n=>Math.fround((n+2147483648)/4294967295)),
  layered,
  armor:({id,stuff,qualities,hpFractions=[1]})=>qualities.flatMap(q=>hpFractions.map(()=>garment(id).armorBase.map((base,c)=>clamp((base+garment(id).armorMultiplier*material(stuff).armor[c])*data.armorQuality[q],0,2)))),
  hp:({id,stuff,qualities})=>qualities.map(()=>{const v=garment(id).maxHP*material(stuff).hpFactor;return Math.max(1,v>200?roundEven(v/5)*5:roundEven(v));}),
  coverage:({id,parts})=>parts.map(p=>garment(id).coveredParts.includes(p)),
  compatibility:({pairs})=>pairs.map(([a,b])=>{const x=garment(a),y=garment(b);return!x.layers.some(l=>y.layers.includes(l))||!x.coveredParts.some(p=>y.coveredParts.includes(p));}),
  order:({ids})=>ids.map(garment).sort((a,b)=>b.drawOrder-a.drawOrder).map(g=>g.id),
  equipment:({ids})=>ids.map(id=>{const g=garment(id);return{cost:g.cost,work:g.work,maxHP:g.maxHP,research:g.research,craftingMin:g.craftingMin,benches:g.benches};}),
  move:({base=4.6,offset=-.8,moving,glow=1})=>moving.map(m=>Math.max(.15,(base+offset)*m*glow)),
  melee:({rows})=>rows.map(({baseDamage,explicit=-1,quality=1,material=1,pawnFactor=1,damageRoll=1})=>{const adjusted=baseDamage*quality*material*pawnFactor;return{damage:Math.max(1,adjusted*damageRoll),penetration:explicit<0?adjusted*.015:explicit*quality};}),
  ranged:({rows})=>rows.map(({category=true,damageBase=-1,penetrationBase=-1,defPenetration=-1,defaultDamage,quality=1})=>{if(!category)return 0;let base=damageBase!==-1||penetrationBase>=0?penetrationBase:defPenetration;if(base<0)base=(damageBase!==-1?damageBase:defaultDamage)*.015;return base*quality;}),
  natural:()=>[0,0,0],
 };
}
