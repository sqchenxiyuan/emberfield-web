import { at, position, type Pawn, type Pos, type Stack, type WildAnimal } from './types';
import { ANIMAL_MEDICAL_RULES, advanceAnimalMedical, animalMedicalSummary, animalNeedsHospital, tendAnimal,
  type AnimalBed, type AnimalCareTask } from './animalMedical';
import { animalNutritionCapacity, HUSBANDRY_RULES } from './husbandry';
import { releaseAnimalHandlers, type HusbandryHost } from './husbandryWorld';
import { animalAllowed } from './pensWorld';
import { NUTRITION } from './farming';
import { healthSummary } from './survival';
import { learnSkill, tendQuality, tendSpeed } from './skills';

export interface AnimalMedicalHost extends HusbandryHost {
  animalBeds: AnimalBed[]; fires: Pos[];
  pawnAllowed(p:Pawn,target:Pos):boolean;
  prisonDropCargo(p:Pawn):boolean;
  exploredAt(p:Pos):boolean;
}
const same=(a:Pos,b:Pos)=>at(a)===at(b);
const adjacent=(a:Pos,b:Pos)=>a.z===b.z&&Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1;
const eligible=(a:WildAnimal)=>!a.dead&&!a.hunt&&!a.slaughter&&!a.releaseMarked&&(a.faction==='colony'||a.medical.rescue);
const edible=(i:{resource:string})=>['grain','food','meal'].includes(i.resource);
const validBed=(s:AnimalMedicalHost,b:AnimalBed)=>s.standable(b)&&s.animalCanStop(b)&&!s.fires.some(f=>same(f,b));
const presentBed=(s:AnimalMedicalHost,a:WildAnimal)=>s.animalBeds.find(b=>b.id===a.medical.bedId&&same(a,b)&&validBed(s,b));
function bedFree(s:AnimalMedicalHost,b:AnimalBed,a:WildAnimal,p?:Pawn) {
  return validBed(s,b)&&!s.animals.some(other=>other!==a&&!other.dead&&(other.medical.bedId===b.id||same(other,b)))&&
    !s.pawns.some(other=>other!==p&&other.animalCareTask?.animalId!==a.id&&other.animalCareTask?.bedId===b.id);
}
function workerCan(p:Pawn,action:AnimalCareTask['action']):boolean {
  return p.faction==='colony'&&!p.dead&&!p.downed&&!p.drafted&&p.carriedBy===null&&healthSummary(p).manipulation>0&&
    (action==='tend'?p.priorities.care>0:p.priorities.care>0||p.priorities.handle>0);
}
function clearActivity(s:AnimalMedicalHost,a:WildAnimal) {
  releaseAnimalHandlers(s,a);
  a.path=[];a.goal=null;a.eatProgress=0;a.mateId=null;a.mateProgress=0;a.layProgress=0;
  for(const b of s.animals)if(b.mateId===a.id){b.mateId=null;b.mateProgress=0;b.path=[];b.goal=null;b.phase='roam';}
}
function route(p:Pawn,path:number[]) { p.path=path;p.destination=path.at(-1)??null;p.phase='animalCare'; }
export function releaseAnimalCare(s:AnimalMedicalHost,p:Pawn):void {
  const task=p.animalCareTask;if(!task)return;
  const a=s.animals.find(a=>a.id===task.animalId);
  if(a&&a.medical.carriedBy===p.id) {
    Object.assign(a,{x:p.x,y:p.y,z:p.z});a.medical.carriedBy=null;a.medical.bedId=null;
    a.path=[];a.goal=null;a.phase=a.dead?'dead':a.medical.downed?'downed':'roam';
    a.reason='救助中断，留在搬运者当前位置';
  }
  if(a&&!a.dead&&a.phase==='medicalRest'&&a.medical.bedId===null) {
    a.phase=a.medical.downed?'downed':'roam';a.decisionTick=s.tick;a.path=[];a.goal=null;
  }
  delete p.animalCareTask;
}
export function cancelAnimalMedical(s:AnimalMedicalHost,a:WildAnimal):void {
  for(const p of s.pawns)if(p.animalCareTask?.animalId===a.id)s.prisonRelease(p);
  a.medical.bedId=null;a.medical.carriedBy=null;
  if(!a.dead&&['medicalRest','carried'].includes(a.phase)){a.phase=a.medical.downed?'downed':'roam';a.path=[];a.goal=null;a.decisionTick=s.tick;}
}
/** Returns true while medicine controls the animal's movement. Biological needs
 * are updated by husbandry first, including pregnancy, milk/wool/egg progress. */
export function animalMedicalTick(s:AnimalMedicalHost,a:WildAnimal):boolean {
  const m=a.medical;
  if(advanceAnimalMedical(a,!!presentBed(s,a))) {s.killAnimal(a,'失血过多');return true;}
  if(m.carriedBy!==null) {
    const p=s.pawns.find(p=>p.id===m.carriedBy&&p.animalCareTask?.animalId===a.id&&p.animalCareTask.stage==='carry');
    if(p){Object.assign(a,{x:p.x,y:p.y,z:p.z});a.phase='carried';a.reason=`由${p.name}抱往动物睡眠点`;return true;}
    m.carriedBy=null;m.bedId=null;
  }
  if(m.bedId!==null&&!s.animalBeds.some(b=>b.id===m.bedId&&bedFree(s,b,a)&&(same(a,b)||animalAllowed(s,a,b)))) {
    m.bedId=null;a.path=[];
    if(a.phase==='medicalRest')a.phase='roam';
  }
  if(m.downed) {
    if(!presentBed(s,a))m.bedId=null;
    clearActivity(s,a);a.phase='downed';a.reason=presentBed(s,a)?'卧床等待治疗、喂食与恢复':'倒地，等待医生或救助';return true;
  }
  if(a.fleeUntil>s.tick&&s.pawns.some(p=>p.id===a.threatId&&!p.dead)) {
    cancelAnimalMedical(s,a);return false;
  }
  const doctor=s.pawns.find(p=>p.animalCareTask?.animalId===a.id);
  if(doctor&&doctor.animalCareTask?.action!=='rescue') {
    clearActivity(s,a);a.phase='medicalRest';a.reason='卧下等待'+doctor.name+'护理';return true;
  }
  if(!eligible(a)||!animalNeedsHospital(a)) {
    if(m.bedId!==null||['medicalRest','carried','downed'].includes(a.phase)){m.bedId=null;a.path=[];a.goal=null;a.phase='roam';a.decisionTick=s.tick;}
    if(!animalNeedsHospital(a))m.rescue=false;
    return false;
  }
  // Mobile patients can seek their own bed on the animal ground graph. A
  // sleeping point is a destination, never permission to cross a closed pen.
  let bed=s.animalBeds.find(b=>b.id===m.bedId);
  if(!bed&&s.tick>=a.decisionTick&&m.policy!=='none') {
    a.decisionTick=s.tick+80;
    const beds=s.animalBeds.filter(b=>bedFree(s,b,a)&&animalAllowed(s,a,b));
    const path=s.animalRoute(a,new Set(beds.map(at)));
    if(path!==null) {
      bed=beds.find(b=>at(b)===(path.at(-1)??at(a)));
      if(bed){clearActivity(s,a);m.bedId=bed.id;a.path=path;}
    }
  }
  if(!bed)return false;
  a.phase='medicalRest';a.goal=null;
  if(same(a,bed)){a.path=[];a.reason='在动物睡眠点休养';return true;}
  if(!a.path.length||!s.animalNeighbors(a,a).includes(a.path[0])) {
    const path=s.animalRoute(a,new Set([at(bed)]));
    if(path===null){m.bedId=null;a.path=[];a.phase='roam';a.decisionTick=s.tick+80;return false;}
    a.path=path;
  }
  if(a.path.length&&s.tick>=a.moveTick){const from={...a};Object.assign(a,position(a.path.shift()!));a.moveTick=s.tick+s.animalMoveTicks(a,from);}
  a.reason='前往动物睡眠点休养';return true;
}
export function startAnimalCare(s:AnimalMedicalHost,p:Pawn,a:WildAnimal,action:AnimalCareTask['action'],forced=false):boolean {
  if(!['rescue','tend','feed'].includes(action)||!workerCan(p,action)||p.psyche.breakUntil>s.tick||a.dead||a.hunt||a.slaughter||a.releaseMarked||
      !s.exploredAt(a)||!s.pawnAllowed(p,a)||(!forced&&!eligible(a))||a.medical.carriedBy!==null||
      s.pawns.some(q=>q!==p&&(q.animalCareTask?.animalId===a.id||q.handleTask?.animalId===a.id||q.ropeTask?.animalId===a.id)))return false;
  const summary=animalMedicalSummary(a),currentBed=presentBed(s,a);
  if(action==='rescue'&&(!a.medical.downed||currentBed))return false;
  if(action==='tend'&&(a.medical.policy==='none'||!summary.needsTending))return false;
  if(action==='feed'&&(!currentBed||a.hunger>=HUSBANDRY_RULES.wantFood))return false;
  const approach=s.prisonApproach(p,a);if(approach===null)return false;
  let bed:AnimalBed|undefined;
  if(action==='rescue') {
    bed=s.animalBeds.filter(b=>bedFree(s,b,a,p)&&s.pawnAllowed(p,b)).find(b=>s.prisonPath(p,b)!==null);
    if(!bed)return false;
  }
  let source:Stack|undefined,sourcePath:number[]|null=null,amount=0;
  const carried=action==='feed'&&p.cargo&&edible(p.cargo)||action==='tend'&&a.medical.policy==='herbal'&&p.cargo?.resource==='herb';
  if(!carried&&(action==='feed'||action==='tend'&&a.medical.policy==='herbal')) {
    for(const item of s.items.filter(i=>!i.forbidden&&s.pawnAllowed(p,i)&&s.exploredAt(i)&&(action==='feed'?edible(i):i.resource==='herb'))) {
      if(s.animalAvailable(item,p.id)<1)continue;
      const path=s.itemPath(p,item);if(path===null)continue;
      if(!sourcePath||path.length<sourcePath.length){source=item;sourcePath=path;}
    }
    if(source)amount=action==='tend'?1:Math.min(s.animalAvailable(source,p.id),Math.max(1,Math.ceil((100-a.hunger)/100*animalNutritionCapacity(a)/NUTRITION[source.resource]!)));
    if(action==='feed'&&!source)return false;
  }
  if(!carried&&!s.prisonDropCargo(p))return false;
  s.prisonRelease(p);clearActivity(s,a);
  if(action==='rescue')a.medical.bedId=null;
  if(forced&&a.faction!=='colony')a.medical.rescue=true;
  p.animalCareTask={animalId:a.id,action,stage:source?'fetch':'approach',bedId:bed?.id??null,sourceId:source?.id??null,amount,progress:0};
  route(p,sourcePath??approach);p.reason=(source?'取'+(action==='feed'?'食物':'草药')+'照料':action==='rescue'?'前往救助':action==='feed'?'前往喂食':'前往护理')+a.name;
  if(action==='tend'&&!a.medical.downed)a.phase='medicalRest';
  return true;
}
export function tryAnimalCare(s:AnimalMedicalHost,p:Pawn):boolean {
  if(p.animalCareTask||p.food<30||p.rest<14)return false;
  const patients=s.animals.filter(eligible).sort((a,b)=>Number(b.medical.downed)-Number(a.medical.downed)||b.medical.bloodLoss-a.medical.bloodLoss||a.id-b.id);
  for(const a of patients) {
    const summary=animalMedicalSummary(a),bed=presentBed(s,a);
    if(summary.bleeding>0&&startAnimalCare(s,p,a,'tend'))return true;
    if(a.medical.downed&&!bed&&startAnimalCare(s,p,a,'rescue'))return true;
    if(bed&&a.hunger<HUSBANDRY_RULES.wantFood&&startAnimalCare(s,p,a,'feed'))return true;
    if(summary.needsTending&&startAnimalCare(s,p,a,'tend'))return true;
  }
  return false;
}
export function animalCareTick(s:AnimalMedicalHost,p:Pawn):void {
  const t=p.animalCareTask;if(!t)return;
  const a=s.animals.find(a=>a.id===t.animalId);
  const cancel=(reason:string)=>{s.prisonRelease(p);p.reason=reason;};
  if(!a||!eligible(a)||!workerCan(p,t.action)||p.psyche.breakUntil>s.tick||p.food<12||p.rest<1||
      t.stage!=='carry'&&!s.pawnAllowed(p,a)||a.medical.carriedBy!==null&&a.medical.carriedBy!==p.id)
    return cancel('动物护理中断，保留动物和未用物资');
  const bed=s.animalBeds.find(b=>b.id===t.bedId);
  if(t.action==='rescue'&&(!a.medical.downed||!bed||!bedFree(s,bed,a,p)||!s.pawnAllowed(p,bed)))return cancel('动物已恢复或睡眠点不可用');
  if(t.action==='tend'&&(a.medical.policy==='none'||!animalMedicalSummary(a).needsTending))return cancel('护理政策或伤口状态改变，保留草药');
  if(t.action==='feed'&&(!presentBed(s,a)||a.hunger>=HUSBANDRY_RULES.wantFood))return cancel('动物已离床或无需喂食');
  if(t.stage==='fetch') {
    const source=s.items.find(i=>i.id===t.sourceId);
    if(!source||source.forbidden||!s.pawnAllowed(p,source)||s.animalAvailable(source,p.id)<t.amount||
      (t.action==='tend'&&(a.medical.policy!=='herbal'||source.resource!=='herb')))return cancel('预留药食已不可用');
    if(!s.itemTouch(p,source)) {
      if(!p.path.length){const path=s.itemPath(p,source);if(path===null)return cancel('药食通路中断');route(p,path);}return;
    }
    if(!s.animalTake(p,source.id,t.amount))return cancel('无法拿取预留药食');
    t.sourceId=null;t.amount=0;t.stage='approach';p.path=[];
  }
  if(t.stage==='carry') {
    Object.assign(a,{x:p.x,y:p.y,z:p.z});
    if(same(p,bed!)) {
      a.medical.carriedBy=null;a.medical.bedId=bed!.id;a.phase='downed';
      s.prisonRelease(p);p.reason='已将'+a.name+'送到动物睡眠点';return;
    }
    if(!p.path.length){const path=s.prisonPath(p,bed!);if(path===null)return cancel('搬运通路中断，放下动物');route(p,path);}
    return;
  }
  if(!adjacent(p,a)) {
    t.stage='approach';t.progress=0;
    if(!p.path.length){const path=s.prisonApproach(p,a);if(path===null)return cancel('动物通路中断，保留药食');route(p,path);}return;
  }
  p.path=[];p.destination=null;
  if(t.action==='rescue') {
    const path=s.prisonPath(p,bed!);if(path===null)return cancel('睡眠点通路中断');
    a.medical.bedId=null;a.medical.carriedBy=p.id;Object.assign(a,{x:p.x,y:p.y,z:p.z});a.phase='carried';
    t.stage='carry';route(p,path);p.reason='抱起'+a.name+'前往动物睡眠点';return;
  }
  t.stage='work';const capacity=healthSummary(p);
  t.progress+=t.action==='tend'?tendSpeed(p.skills,capacity.manipulation,capacity.sight):capacity.manipulation;
  p.reason=(t.action==='tend'?'护理':'喂食')+a.name;
  if(t.progress<(t.action==='tend'?ANIMAL_MEDICAL_RULES.work:ANIMAL_MEDICAL_RULES.feedWork))return;
  if(t.action==='tend') {
    const medicine=a.medical.policy==='herbal'&&p.cargo?.resource==='herb';
    if(tendAnimal(a,tendQuality(p.skills,capacity.manipulation,capacity.sight),medicine)) {
      learnSkill(p.skills.medicine,250);
      if(medicine){s.stats.consumed.herb++;p.cargo!.amount--;if(!p.cargo!.amount)p.cargo=null;}
    }
    t.progress=0;
    if(animalMedicalSummary(a).needsTending&&(!medicine||p.cargo))return;
  } else {
    if(!p.cargo||!edible(p.cargo))return cancel('携带食物不适合动物');
    const amount=Math.min(p.cargo.amount,Math.max(1,Math.ceil((100-a.hunger)/100*animalNutritionCapacity(a)/NUTRITION[p.cargo.resource]!)));
    a.hunger=Math.min(100,a.hunger+amount*NUTRITION[p.cargo.resource]!/animalNutritionCapacity(a)*100);
    s.stats.consumed[p.cargo.resource]+=amount;p.cargo.amount-=amount;if(!p.cargo.amount)p.cargo=null;
  }
  s.prisonRelease(p);p.reason='已完成动物'+(t.action==='tend'?'护理，继续等待恢复':'喂食');
}
