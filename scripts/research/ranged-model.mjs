// Independent reviewed static models. Never import production code or execute game code.
import assert from 'node:assert/strict';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const roundEven=x=>{const n=Math.floor(x);return x-n===.5?n+n%2:Math.round(x);};
const chance=(p,r)=>p<=0?false:p>=1?true:r<p;
const lerp=(points,x)=>{if(x<=points[0][0])return points[0][1];for(let i=1;i<points.length;i++){const[a,b]=points[i-1],[c,d]=points[i];if(x<=c)return b+(d-b)*(x-a)/(c-a);}return points.at(-1)[1];};
export function rangedData(xml){
 const records=new Map(xml.records.map(r=>[r.id,r])),named=new Map(xml.records.filter(r=>r.name_attribute).map(r=>[r.name_attribute,r]));
 const record=id=>{assert(records.has(id),id);return records.get(id);};
 const chain=id=>{const a=[];for(let r=record(id);r;){assert(!a.includes(r),'Inheritance cycle');a.unshift(r);if(!r.parent_name)break;assert(named.has(r.parent_name),'Missing selected parent: '+r.parent_name);r=named.get(r.parent_name);}return a;};
 const own=(r,k)=>r.fields.find(f=>f.xpath===r.source.xpath+'/'+k)?.value;
 const field=(id,k,d)=>{let v=d;for(const r of chain(id)){const n=own(r,k);if(n!==undefined)v=n;}return v;};
 const number=(id,k,d=0)=>Number(field(id,k,d));
 const list=(id,k)=>{let a=[];for(const r of chain(id)){if(r.node_attributes.some(x=>x.xpath===r.source.xpath+'/'+k&&x.attributes.Inherit?.toLowerCase()==='false'))a=[];a.push(...r.fields.filter(f=>f.xpath.startsWith(r.source.xpath+'/'+k+'/li')).map(f=>f.value));}return a;};
 const map=(id,k)=>{let a={};for(const r of chain(id)){for(const f of r.fields){const p=f.xpath.slice(r.source.xpath.length+1);if(p.startsWith(k+'/')&&!p.slice(k.length+1).includes('/'))a[p.slice(k.length+1)]=Number(f.value);}}return a;};
 const children=(id,k)=>{let a=[];for(const r of chain(id)){const selected=r.fields.filter(f=>f.xpath.startsWith(r.source.xpath+'/'+k+'/'));if(!selected.length)continue;const groups=new Map();for(const f of selected){const p=f.xpath.slice((r.source.xpath+'/'+k+'/').length),key=p.split('/')[0];if(!groups.has(key))groups.set(key,{});groups.get(key)[p.slice(key.length+1)]=f.value;}a=[...groups.values()];}return a;};
 const quality=['Awful','Poor','Normal','Good','Excellent','Masterwork','Legendary'];
 const qualityFrom=id=>quality.map(q=>{const r=record(id);return Number(r.fields.find(f=>f.xpath.endsWith('/factor'+q)).value);});
 const weapons=['Bow_Short','Gun_Revolver','Gun_Autopistol','Gun_MachinePistol'].map(id=>{const key='ThingDef_'+id,v=children(key,'verbs')[0];return{id,sourceChain:chain(key).map(r=>r.id),cost:map(key,'costList'),stuff:null,work:number(key,'statBases/WorkToMake'),maxHP:number(key,'statBases/MaxHitPoints'),mass:number(key,'statBases/Mass'),accuracy:['Touch','Short','Medium','Long'].map(a=>number(key,'statBases/Accuracy'+a)),cooldown:number(key,'statBases/RangedWeapon_Cooldown'),warmup:Number(v.warmupTime),range:Number(v.range),burst:Number(v.burstShotCount??1),burstInterval:Number(v.ticksBetweenBurstShots??15),projectile:v.defaultProjectile,verb:v.verbClass,craftingMin:number(key,'recipeMaker/skillRequirements/Crafting'),research:field(key,'recipeMaker/researchPrerequisite',null),benches:list(key,'recipeMaker/recipeUsers'),workSkill:field(key,'recipeMaker/workSkill',null),workSpeedStat:field(key,'recipeMaker/workSpeedStat',null),tools:children(key,'tools').map(t=>({label:t.label,capacities:Object.entries(t).filter(([k])=>k.startsWith('capacities/')).map(([,v])=>v),power:Number(t.power),cooldown:Number(t.cooldownTime),armorPenetration:Number(t.armorPenetration??-1),chanceFactor:Number(t.chanceFactor??1)}))};});
 const projectiles=weapons.map(w=>{const id='ThingDef_'+w.projectile;return{id:w.projectile,damageDef:field(id,'projectile/damageDef'),damage:number(id,'projectile/damageAmountBase'),speed:number(id,'projectile/speed'),speedTilesPerTick:number(id,'projectile/speed')/100,stoppingPower:number(id,'projectile/stoppingPower',.5),armorPenetrationBase:number(id,'projectile/armorPenetrationBase',-1)};});
 const covers=['Sandbags','Barricade','Wall','Plant_TreeOak','Plant_TreePine','Plant_TreePoplar','Plant_SaguaroCactus'].map(id=>{const key='ThingDef_'+id;return{id,fill:number(key,'fillPercent'),pathCost:number(key,'pathCost'),passability:field(key,'passability',null),cost:map(key,'costList'),costStuffCount:number(key,'costStuffCount'),stuffCategories:list(key,'stuffCategories'),maxHP:number(key,'statBases/MaxHitPoints'),work:number(key,'statBases/WorkToBuild')};});
 const b='ThingDef_TableMachining';const power=record(b).fields.find(f=>f.xpath.endsWith('/basePowerConsumption'));
 const bench={id:'TableMachining',cost:map(b,'costList'),work:number(b,'statBases/WorkToBuild'),maxHP:number(b,'statBases/MaxHitPoints'),size:field(b,'size'),constructionMin:number(b,'constructionSkillPrerequisite'),research:list(b,'researchPrerequisites'),power:Number(power.value),roomRole:field(b,'building/workTableRoomRole'),notRoomFactor:number(b,'building/workTableNotInRoomRoleFactor',1),unpoweredFactor:number(b,'building/unpoweredWorkTableWorkSpeedFactor',0),fill:number(b,'fillPercent'),pathCost:number(b,'pathCost')};
 const research=xml.records.filter(r=>r.group==='research').map(r=>({id:r.def_name,cost:number(r.id,'baseCost'),tech:field(r.id,'techLevel'),prerequisites:list(r.id,'prerequisites')}));
 const shootingCurve=list('StatDef_ShootingAccuracyPawn','postProcessCurve/points').map(s=>s.replace(/[()]/g,'').split(',').map(Number));
 const weather=Object.fromEntries(xml.records.filter(r=>r.group==='weather').map(r=>[r.def_name,number(r.id,'accuracyMultiplier',1)]));
 // These materials intentionally extract only direct stuffProps factors, not their incomplete ThingDef parent chains.
 const materials=Object.fromEntries(['Steel','WoodLog','Cloth'].map(id=>{const r=record('ThingDef_'+id);return[id,{hpFactor:Number(own(r,'stuffProps/statFactors/MaxHitPoints')??1),workFactor:Number(own(r,'stuffProps/statFactors/WorkToBuild')??1)}];}));
 const injuries=['Gunshot','Cut','Crack'].map(id=>({id,pain:number('HediffDef_'+id,'injuryProps/painPerSeverity',1),permanentPain:number('HediffDef_'+id,'injuryProps/averagePainPerSeverityPermanent',.5),bleed:number('HediffDef_'+id,'injuryProps/bleedRate'),canMerge:field('HediffDef_'+id,'injuryProps/canMerge','false')==='true'}));
 const damage=['Bullet','Arrow'].map(id=>({id,worker:field('DamageDef_'+id,'workerClass'),hediff:field('DamageDef_'+id,'hediff'),skin:field('DamageDef_'+id,'hediffSkin',null),solid:field('DamageDef_'+id,'hediffSolid',null),category:field('DamageDef_'+id,'armorCategory'),harmAllLayersUntilOutside:field('DamageDef_'+id,'harmAllLayersUntilOutside')==='true',overkill:field('DamageDef_'+id,'overkillPctToDestroyPart')}));
 return{evidence_id:'RW17-RANGED-DATA',version_text:xml.version_text,assembly_sha256:xml.assembly_sha256,kind:'Reviewed selected Core inheritance and static defaults; not the enabled-mod effective database.',quality,accuracyQuality:qualityFrom('StatDef_AccuracyBase'),damageQuality:qualityFrom('StatDef_RangedWeapon_DamageMultiplier'),penetrationQuality:qualityFrom('StatDef_RangedWeapon_ArmorPenetrationMultiplier'),meleeQuality:qualityFrom('StatDef_MeleeWeapon_DamageMultiplier'),weapons,projectiles,bench,research,covers,materials,weather,shootingCurve,damage,injuries};
}
export function rangedModels(data){
 const weapon=id=>{const w=data.weapons.find(w=>w.id===id);assert(w,id);return w;};
 const projectile=id=>data.projectiles.find(p=>p.id===weapon(id).projectile);
 const accuracy=(id,q,d)=>lerp([3,12,25,40].map((x,i)=>[x,clamp(weapon(id).accuracy[i]*data.accuracyQuality[q],.01,1)]),d);
 const pawnAccuracy=({skill=0,sight=1,manipulation=1,hasSkills=true})=>{const raw=(hasSkills?skill:8)+12*(Math.min(sight,2)-1)+8*(Math.min(manipulation,1)-1);return{raw,perCell:lerp(data.shootingCurve,raw)};};
 const report=({distance,perCell=1,weaponFactor=1,distanceFactor=1,weather=1,shooterRoof=false,targetRoof=false,smoke=false,prone=false,size=1,cover=0,darknessOffset=0})=>{const shooter=Math.max(.0201,perCell**distance*distanceFactor),weatherFactor=shooterRoof&&targetRoof?1:weather,posture=prone&&distance>=4.5?.5:1,execution=prone&&distance<=3.9?7.5:1,standard=Math.max(.0201,shooter*weaponFactor*weatherFactor*(smoke?.7:1)*execution+darknessOffset),ignoringPosture=standard*clamp(size,.5,2),aim=ignoringPosture*posture;return{shooter,weatherFactor,posture,execution,standard,ignoringPosture,aim,passCover:1-cover,total:clamp(aim*(1-cover))};};
 const coverOne=({fill,angle=0,diagonal=false,distance=10,openDoor=false})=>{const a=angle*(diagonal?1.75:1),angleFactor=a<15?1:a<27?.8:a<40?.6:a<52?.4:a<65?.2:0,near=distance<1.9?.3333:distance<2.9?.66666:1;return(openDoor?0:fill>.99?.75:fill)*angleFactor*near;};
 const interceptFactor=distance=>clamp((distance*distance-25)/119);
 return{
  equipment:({ids})=>ids.map(id=>{const w=weapon(id);return{cost:w.cost,work:w.work,hp:w.maxHP,research:w.research,crafting:w.craftingMin,benches:w.benches,stuff:w.stuff};}),
  stats:({id,qualities})=>qualities.map(q=>{const w=weapon(id),p=projectile(id);return{damage:roundEven(p.damage*data.damageQuality[q]),penetration:p.damage*.015*data.penetrationQuality[q],accuracy:w.accuracy.map(a=>clamp(a*data.accuracyQuality[q],.01,1)),hp:w.maxHP,range:w.range};}),
  accuracy:({id,quality=2,distances})=>distances.map(d=>accuracy(id,quality,d)),
  pawnAccuracy:({rows})=>rows.map(pawnAccuracy),
  report,
  cover:({rows})=>rows.map(coverOne),
  combineCover:({blocks})=>blocks.reduce((b,x)=>b+(1-b)*x,0),
  launch:({rows})=>rows.map(({aim,cover=0,aimRoll,coverRoll=0,prone=false,canBenefit=true,nonTargetPawns=true,wildPawnRoll=0,fullTarget=false,emptyTarget=false})=>{if(!chance(aim,aimRoll))return{destination:'wild',flags:4+(nonTargetPawns&&chance(.5,wildPawnRoll)?2:0)};if(canBenefit&&!chance(1-cover,coverRoll))return{destination:'cover',flags:4+(nonTargetPawns?2:0)};return{destination:'target',flags:1+(nonTargetPawns?2:0)+(fullTarget||emptyTarget?4:0)};}),
  missRadius:({rows})=>rows.map(({aim,roll})=>1+(lerp([[.02,10],[.04,8],[.07,6],[.11,4],[.22,2],[1,1]],aim)-1)*clamp(roll)),
  flight:({id,distances})=>distances.map(d=>Math.max(1,Math.ceil(d/(projectile(id).speed/100)))),
  // Equipped non-Normal-ticker weapons: Pawn.Tick completes stance warmup before
  // EquipmentTrackerTick -> VerbsTick. The first shot's counter is decremented
  // once in that same tick; later shots are inside VerbTick and retain full intervals.
  // The XP stat continues to use the nominal XML interval, not elapsed scheduling.
  timing:({id,aimingFactor=1,warmupFactor=1,cooldownFactor=1,hostile=true,eligible=true})=>{const w=weapon(id),warmup=roundEven(w.warmup*aimingFactor*warmupFactor*60),cooldown=roundEven(w.cooldown*cooldownFactor*60),shots=Array.from({length:w.burst},(_,i)=>warmup+i*w.burstInterval-(i>0?1:0)),cycle=w.warmup+w.cooldown*cooldownFactor+(w.burst-1)*w.burstInterval/60;return{warmup,shots,cooldown,end:shots.at(-1)+cooldown,rawXP:eligible?(hostile?170:20)*cycle:0};},
  interceptFactor:({distances})=>distances.map(interceptFactor),
  intercept:({rows})=>rows.map(({distance,kind,bodySize=1,prone=false,fill=.55,adjacentTarget=false,friendly=false,preventFriendlyFire=false,friendlyFactor=1,destinationCell=false})=>{const factor=interceptFactor(distance);if(destinationCell||factor<=0)return 0;if(kind==='wall')return 1;let p=kind==='pawn'?.4*clamp(bodySize,.1,2)*(prone?.1:1)*(friendly?(preventFriendlyFire?0:friendlyFactor):1):kind==='open-door'?.05:fill>.2?fill*(adjacentTarget?1:.15):0;return p*factor;}),
  endpoint:({rows})=>rows.map(({kind,bodySize=1,prone=false,distance=10,fill=.55})=>kind==='intended'?prone&&distance>=4.5?.5:1:kind==='pawn'?.5*clamp(bodySize,.1,2)*(prone&&distance>=4.5?.5:1):1.5*fill),
  endpointTarget:({rows})=>rows.map(({spawned=true,sameMap=true,covered=false,canHitFlags=true,moved=false,prone=false,distance=10,roll=0})=>!spawned||!sameMap||covered||!canHitFlags?'cell-fallback':prone&&distance>=4.5&&!chance(.5,roll)?'ground':'used-target-reference'),
  wound:({rows})=>rows.map(({damageDef,solid=false,skin=false,severity=1,partBleed=1,raceBleed=1,healthScale=1})=>{const d=data.damage.find(x=>x.id===damageDef);const id=solid&&d.solid?d.solid:skin&&d.skin?d.skin:d.hediff,w=data.injuries.find(x=>x.id===id);return{injury:id,pain:severity*w.pain/healthScale,bleed:solid?0:severity*w.bleed*partBleed*raceBleed,worker:d.worker};}),
  buildingDamage:({id,quality=2,hp})=>{const damage=roundEven(projectile(id).damage*data.damageQuality[quality]),ap=projectile(id).damage*.015*data.penetrationQuality[quality];return{damage:Math.min(hp,damage),hp:Math.max(0,hp-damage),penetration:ap};},
  structure:({id,stuff='Steel'})=>{const c=data.covers.find(c=>c.id===id),m=c.costStuffCount?data.materials[stuff]:{hpFactor:1,workFactor:1};return{hp:roundEven(c.maxHP*m.hpFactor),work:c.work*m.workFactor,fill:c.fill};},
  melee:({id,quality=2})=>weapon(id).tools.flatMap(t=>t.capacities.map(cap=>({tool:t.label,damageDef:cap==='Blunt'?'Blunt':'Poke',damage:t.power*data.meleeQuality[quality],penetration:t.power*data.meleeQuality[quality]*.015,cooldown:t.cooldown}))),
  meleeWeights:({weights})=>{const max=Math.max(...weights),groups=weights.map(w=>w>=max*.95?'best':w<max*.25?'worst':'mid');return groups.map(g=>g==='worst'?0:(g==='best'?.75:.25)/groups.filter(x=>x===g).length);},
  stagger:({id,bodySizes})=>bodySizes.map(s=>s<=projectile(id).stoppingPower+.001?{ticks:95,moveFactor:.17}:{ticks:0,moveFactor:1}),
  range:({id,distances,hostile=true,downed=false})=>distances.map(d=>d<=weapon(id).range&&d>=(hostile&&!downed?1.421:0)),
  weather:({last,current,t,shooterRoof=false,targetRoof=false})=>shooterRoof&&targetRoof?1:data.weather[last]+(data.weather[current]-data.weather[last])*clamp(t),
  chance:({rows})=>rows.map(({p,roll})=>chance(p,roll)),
 };
}
