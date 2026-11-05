import { at, bedCells, position, type Bed, type CommandResult, type Pawn, type Pos, type VoxelCommand, type WildAnimal } from './types';
import { animalAllowed } from './pensWorld';
import type { HusbandryHost } from './husbandryWorld';
import { ANIMAL_HUSBANDRY, animalNutritionCapacity, HUSBANDRY_RULES } from './husbandry';
import { animalMedicalSummary, animalNeedsHospital } from './animalMedical';
import { animalEnvironmentEffects } from './animalEnvironment';
import { healthSummary } from './survival';
import { NUTRITION, hourAt } from './farming';
import { learnSkill } from './skills';
import { plantRandom } from './plants';
import { ANIMAL_TRAINING_RULES as RULES, TRAINABLES, TRAINABLE_NAMES, advanceAnimalTraining,
  animalCanTrainWithResource, animalMasterEligible, animalSkillAvailable, animalTrainable,
  animalTrainingChance, animalTrainingFoodAmount, canTrainAnimal, decayAnimalTraining,
  setAnimalTrainingWanted } from './animalTraining';

// Provisional play values; keep bite balance separate from task semantics.
export const ANIMAL_COOPERATION_COMBAT = Object.freeze({cooldown:36,damage:8,armorPenetration:.12});

/** The world owns all physical inventory and combat transactions. The animal
 * scheduler only chooses work and advances the same real actors and batches. */
export interface AnimalTrainingHost extends HusbandryHost {
  beds: Bed[];
  exploredAt(p: Pos): boolean;
  pawnAllowed(p: Pawn, target: Pos): boolean;
  prisonDropCargo(p: Pawn): boolean;
  animalDropCargo(a: WildAnimal): boolean;
  animalReleaseStorage(a: WildAnimal): void;
  animalHaulStart(a: WildAnimal): boolean;
  animalHaulTick(a: WildAnimal): boolean;
  animalDefenseTargets(a: WildAnimal, master: Pawn, radius: number): Pawn[];
  animalStrike(a: WildAnimal, target: Pawn): void;
  animalMasterWorking(p: Pawn): boolean;
}
const same = (a: Pos, b: Pos) => at(a) === at(b);
const adjacent = (a: Pos, b: Pos) => a.z === b.z && Math.abs(a.x-b.x)+Math.abs(a.y-b.y) === 1;
const distance = (a: Pos, b: Pos) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const owner = (s: AnimalTrainingHost, a: WildAnimal) => s.pawns.find(p => p.id === a.training.masterId && animalMasterEligible(p,a));
const workerCan = (p: Pawn) => p.faction === 'colony' && !p.dead && !p.downed && !p.drafted &&
  p.carriedBy === null && p.carryingPawnId === null && p.priorities.handle > 0 &&
  healthSummary(p).manipulation > 0 && healthSummary(p).moving > .15;
const animalCanWork = (a: WildAnimal) => animalTrainable(a.species) && a.faction === 'colony' && !a.dead &&
  !a.medical.downed && a.medical.carriedBy === null && !animalNeedsHospital(a) && !animalEnvironmentEffects(a).ill &&
  !a.hunt && !a.slaughter && !a.releaseMarked && a.tameness > 0;
function clearActivity(a: WildAnimal) {
  a.path=[]; a.goal=null; a.eatProgress=0; a.mateId=null; a.mateProgress=0; a.layProgress=0;
}
function log(s: AnimalTrainingHost, a: WildAnimal, message: string, otherId: number | null = null) {
  s.notice=message;
  s.husbandryLog.push({tick:s.tick,kind:'training',animalId:a.id,otherId,message});
  s.husbandryLog=s.husbandryLog.slice(-HUSBANDRY_RULES.maxLog);
}
export function cancelAnimalWork(s: AnimalTrainingHost, a: WildAnimal): void {
  const work=a.work;
  if(work?.kind==='rescue'&&work.stage==='carry') {
    const p=s.pawns.find(p=>p.id===work.patientId&&p.carriedBy===a.id);
    if(p){Object.assign(p,{x:a.x,y:a.y,z:a.z});p.carriedBy=null;p.sleepBedId=null;
      p.phase=p.dead?'dead':p.downed?'downed':'idle';p.reason='动物救援中断，留在当前位置';}
  }
  s.animalReleaseStorage(a);a.work=null;
  if(work){clearActivity(a);if(!a.dead&&!a.medical.downed&&a.medical.carriedBy===null)a.phase='roam';a.decisionTick=s.tick;}
}
export function releaseAnimalTraining(s: AnimalTrainingHost, p: Pawn): void {
  const a=s.animals.find(a=>a.id===p.animalTrainTask?.animalId);
  delete p.animalTrainTask;
  if(a&&!a.dead&&a.phase==='interact'){a.phase='roam';a.decisionTick=s.tick;}
}
export function animalTrainingCommand(s: AnimalTrainingHost, c: VoxelCommand): CommandResult | null {
  if(c.type==='animalsRelease') {
    const p=s.pawns.find(p=>p.id===c.pawnId&&p.faction==='colony'&&!p.dead&&!p.downed&&p.carriedBy===null);
    if(!p||typeof c.enabled!=='boolean'||(c.enabled&&(!p.drafted||!s.animals.some(a=>
      animalCanWork(a)&&a.training.masterId===p.id&&a.training.followDrafted&&animalSkillAvailable(a,'release')))))
      return {ok:false,message:'需要征召主人，并有已学会释放攻击的动物'};
    p.animalsReleased=c.enabled;
    for(const a of s.animals)if(a.training.masterId===p.id&&['attack','follow'].includes(a.work?.kind??''))cancelAnimalWork(s,a);
    return {ok:true,message:c.enabled?'已释放训练动物，扩大协同防御范围':'已召回训练动物，恢复近身跟随与防御'};
  }
  if(!['animalTraining','animalMaster','animalFollow'].includes(c.type))return null;
  if(c.type!=='animalTraining'&&c.type!=='animalMaster'&&c.type!=='animalFollow')return null;
  const a=s.animals.find(a=>a.id===c.animalId&&!a.dead&&a.faction==='colony'&&animalTrainable(a.species));
  if(!a)return {ok:false,message:'只能设置殖民地中可训练的动物'};
  if(c.type==='animalTraining') {
    if(!TRAINABLES.includes(c.trainable)||typeof c.wanted!=='boolean')return {ok:false,message:'训练项目无效'};
    setAnimalTrainingWanted(a.training,c.trainable,c.wanted);
    for(const p of s.pawns)if(p.animalTrainTask?.animalId===a.id&&!a.training.wanted[p.animalTrainTask.trainable])s.prisonRelease(p);
    return {ok:true,message:c.wanted?'已安排训练；饲养员会取食物并逐步训练':'已取消后续训练，已学会的技能保留'};
  }
  if(c.type==='animalMaster') {
    const p=s.pawns.find(p=>p.id===c.pawnId);
    if(c.pawnId!==null&&(!animalSkillAvailable(a,'obedience')||!p||!animalMasterEligible(p,a)))
      return {ok:false,message:'需要学会服从，并选择驯养技能合格的殖民者'};
    cancelAnimalWork(s,a);a.training.masterId=c.pawnId;
    if(c.pawnId===null){a.training.followDrafted=false;a.training.followFieldwork=false;}
    return {ok:true,message:c.pawnId===null?'已解除主人指派':'主人已指派，可设置征召或野外工作跟随'};
  }
  if(!['drafted','fieldwork'].includes(c.when)||typeof c.enabled!=='boolean'||
    c.enabled&&(!animalSkillAvailable(a,'obedience')||!owner(s,a)))return {ok:false,message:'跟随需要服从训练和有效主人'};
  a.training[c.when==='drafted'?'followDrafted':'followFieldwork']=c.enabled;
  cancelAnimalWork(s,a);
  return {ok:true,message:c.enabled?'已启用跟随':'已关闭此类跟随'};
}
function handlerPath(p: Pawn, path: number[]) { p.path=path;p.destination=path.at(-1)??null;p.phase='animalTrain'; }
export function tryAnimalTraining(s: AnimalTrainingHost, p: Pawn): boolean {
  if(!workerCan(p)||p.cargo||p.food<30||p.rest<20||p.psyche.breakUntil>s.tick)return false;
  for(const a of s.animals) {
    if(!animalCanWork(a)||s.tick<a.nextInteractionTick||!s.exploredAt(a)||!s.pawnAllowed?.(p,a)||
      p.skills.animals.level<ANIMAL_HUSBANDRY[a.species].minSkill||
      s.pawns.some(q=>q.handleTask?.animalId===a.id||q.animalTrainTask?.animalId===a.id||q.animalCareTask?.animalId===a.id||q.ropeTask?.animalId===a.id))continue;
    const skill=TRAINABLES.find(k=>a.training.wanted[k]&&canTrainAnimal(a,k));
    if(!skill||s.prisonApproach(p,a)===null)continue;
    let best: {id:number;amount:number;path:number[];resource:NonNullable<Pawn['animalTrainTask']>['resource']}|null=null;
    for(const food of s.items) {
      if(food.forbidden||!s.exploredAt(food)||!s.pawnAllowed?.(p,food)||!animalCanTrainWithResource(a.species,food.resource))continue;
      const amount=animalTrainingFoodAmount(a,food.resource);
      if(s.animalAvailable(food,p.id)<amount)continue;
      const path=s.itemPath(p,food);
      if(path!==null&&(!best||path.length<best.path.length))best={id:food.id,amount,path,resource:food.resource};
    }
    if(!best){a.reason='训练等待可达的生食和空闲饲养员';continue;}
    s.prisonRelease(p);cancelAnimalWork(s,a);
    p.animalTrainTask={animalId:a.id,trainable:skill,sourceId:best.id,resource:best.resource,amount:best.amount,stage:'fetch',progress:0};
    handlerPath(p,best.path);p.reason=`取食物训练${a.name}：${TRAINABLE_NAMES[skill]}`;return true;
  }
  return false;
}
export function animalTrainTick(s: AnimalTrainingHost, p: Pawn): void {
  const t=p.animalTrainTask;if(!t)return;
  const a=s.animals.find(a=>a.id===t.animalId);
  const stop=(reason:string)=>{s.prisonRelease(p);p.reason=reason;};
  if(!a||!animalCanWork(a)||!workerCan(p)||p.food<12||p.rest<1||p.psyche.breakUntil>s.tick||
    !s.pawnAllowed?.(p,a)||!a.training.wanted[t.trainable]||!canTrainAnimal(a,t.trainable)||
    s.tick<a.nextInteractionTick||a.phase==='flee'||p.skills.animals.level<ANIMAL_HUSBANDRY[a.species].minSkill||
    s.pawns.some(q=>q!==p&&(q.handleTask?.animalId===a.id||q.animalCareTask?.animalId===a.id||q.ropeTask?.animalId===a.id)))
    return stop('训练条件改变，保留未用食物');
  if(t.stage==='fetch') {
    const f=s.items.find(i=>i.id===t.sourceId&&i.resource===t.resource);
    if(!f||f.forbidden||!s.pawnAllowed?.(p,f)||s.animalAvailable(f,p.id)<t.amount)return stop('训练食物已不可用');
    if(!s.itemTouch(p,f)){if(!p.path.length){const path=s.itemPath(p,f);if(path===null)return stop('训练食物通路中断');handlerPath(p,path);}return;}
    if(!s.animalTake(p,f.id,t.amount))return stop('无法拿取训练食物');
    t.sourceId=null;t.stage='approach';p.path=[];p.destination=null;
  }
  if(!p.cargo||p.cargo.resource!==t.resource||p.cargo.amount<t.amount)return stop('训练食物不足，重新安排');
  if(!adjacent(p,a)){
    if(t.progress>0)return stop('训练被打断，已喂食部分保留实际消耗');
    t.stage='approach';t.progress=0;
    if(!p.path.length||(s.tick+p.id)%40===0){const path=s.prisonApproach(p,a);if(path===null)return stop('无法靠近训练动物');handlerPath(p,path);}
    p.reason='靠近'+a.name+'进行训练';return;
  }
  cancelAnimalWork(s,a);clearActivity(a);a.phase='interact';
  p.path=[];p.destination=null;t.stage='work';p.reason=`训练${a.name}：${TRAINABLE_NAMES[t.trainable]}`;
  t.progress=Math.min(RULES.work,t.progress+1);learnSkill(p.skills.animals,.2);
  if(t.progress===RULES.work*2/3){
    const amount=t.amount/2;p.cargo.amount-=amount;t.amount-=amount;s.stats.consumed[t.resource]+=amount;
    a.hunger=Math.min(100,a.hunger+100*amount*NUTRITION[t.resource]!/animalNutritionCapacity(a));
  }
  if(t.progress<RULES.work)return;
  // Two actual feedings precede the skill roll. Cancellation cannot refund
  // already eaten food; the carrier retains the still unused portion.
  p.cargo.amount-=t.amount;s.stats.consumed[t.resource]+=t.amount;
  a.hunger=Math.min(100,a.hunger+100*t.amount*NUTRITION[t.resource]!/animalNutritionCapacity(a));
  if(!p.cargo.amount)p.cargo=null;
  const health=healthSummary(p),success=plantRandom(s.seed,a.id,s.tick,1601)<
    animalTrainingChance(p.skills.animals.level,ANIMAL_HUSBANDRY[a.species].wildness,Math.min(health.manipulation,health.talking));
  if(success){const learned=a.training.learned.obedience;advanceAnimalTraining(a.training,t.trainable);
    if(!learned&&a.training.learned.obedience)a.training.masterId=p.id;}
  a.nextInteractionTick=s.tick+RULES.interactionCooldown;
  log(s,a,`${p.name}${success?'完成':'未成功完成'}${a.name}的${TRAINABLE_NAMES[t.trainable]}训练${success?'一步':'，稍后重试'}`,p.id);
  stop(success?'训练取得进展':'训练未成功，食物已实际消耗');
}
/** Move on the animal graph; never borrow colonist ladders or teleport to the
 * destination. Allowed areas constrain destinations just as other animal AI. */
export function moveAnimalTo(s: AnimalTrainingHost, a: WildAnimal, targets: Pos[]): boolean | null {
  const cells=new Set(targets.filter(p=>animalAllowed(s,a,p)&&s.animalCanStop(p)).map(at));
  if(cells.has(at(a))){a.path=[];return true;}
  if(!a.path.length||!cells.has(a.path.at(-1)!)||!s.animalNeighbors(a,a).includes(a.path[0])) {
    const path=s.animalRoute(a,cells);if(path===null){a.path=[];return null;}a.path=path;
  }
  if(a.path.length&&s.tick>=a.moveTick){const from={x:a.x,y:a.y,z:a.z};Object.assign(a,position(a.path.shift()!));a.moveTick=s.tick+s.animalMoveTicks(a,from);}
  return cells.has(at(a));
}
const approaches = (s: AnimalTrainingHost, a: WildAnimal, p: Pos) =>
  s.animalNeighbors(a,p).map(position).filter(q=>adjacent(q,p)&&s.animalCanStop(q));
function rescueBedFree(s: AnimalTrainingHost, a: WildAnimal, p: Pawn, bed: Bed): boolean {
  return !bed.prisoner&&(bed.medical||bed.owner===p.id)&&animalAllowed(s,a,bed)&&s.standable(bed)&&
    !s.pawns.some(q=>q!==p&&!q.dead&&(q.sleepBedId===bed.id||q.careBedId===bed.id||bedCells(bed).some(c=>same(c,q))))&&
    !s.animals.some(b=>b!==a&&b.work?.kind==='rescue'&&b.work.bedId===bed.id);
}
function rescueTick(s: AnimalTrainingHost, a: WildAnimal): boolean {
  const w=a.work;if(w?.kind!=='rescue')return false;
  const p=s.pawns.find(p=>p.id===w.patientId),bed=s.beds.find(b=>b.id===w.bedId);
  if(!p||p.dead||!p.downed||p.faction!=='colony'||!animalSkillAvailable(a,'rescue')||!bed||!rescueBedFree(s,a,p,bed)||
    !animalAllowed(s,a,p)||(w.stage==='carry'?p.carriedBy!==a.id:p.carriedBy!==null||s.pawns.some(q=>q.patientId===p.id))) {
    cancelAnimalWork(s,a);return false;
  }
  a.phase='rescue';a.reason=w.stage==='carry'?'驮着'+p.name+'前往床位':'前往救援'+p.name;
  if(w.stage==='approach') {
    const reached=moveAnimalTo(s,a,approaches(s,a,p));
    if(reached===null){cancelAnimalWork(s,a);return false;}
    if(!reached)return true;
    s.prisonRelease(p);p.carriedBy=a.id;p.sleepBedId=null;w.stage='carry';a.path=[];
    Object.assign(p,{x:a.x,y:a.y,z:a.z});p.phase='downed';p.reason='由'+a.name+'救往床位';
  }
  const reached=moveAnimalTo(s,a,approaches(s,a,bed));
  Object.assign(p,{x:a.x,y:a.y,z:a.z});
  if(reached===null){cancelAnimalWork(s,a);return false;}
  if(reached){Object.assign(p,{x:bed.x,y:bed.y,z:bed.z});p.carriedBy=null;p.sleepBedId=bed.id;
    p.phase='downed';p.reason='动物已送到床位，等待治疗';a.work=null;clearActivity(a);a.phase='roam';
    log(s,a,`${a.name}将${p.name}救到床位`,p.id);}
  return true;
}
function startRescue(s: AnimalTrainingHost, a: WildAnimal): boolean {
  if(!animalSkillAvailable(a,'rescue')||a.cargo)return false;
  for(const p of s.pawns) {
    if(p.faction!=='colony'||p.dead||!p.downed||p.carriedBy!==null||distance(a,p)>RULES.rescueRadius||
      !s.exploredAt(p)||!animalAllowed(s,a,p)||s.beds.some(b=>same(b,p))||
      s.pawns.some(q=>q.patientId===p.id)||s.animals.some(b=>b!==a&&b.work?.kind==='rescue'&&b.work.patientId===p.id))continue;
    const path=s.animalRoute(a,new Set(approaches(s,a,p).filter(q=>animalAllowed(s,a,q)).map(at)));
    if(path===null)continue;
    const bed=s.beds.filter(b=>rescueBedFree(s,a,p,b)).sort((x,y)=>Number(y.medical)-Number(x.medical)||distance(a,x)-distance(a,y))
      .find(b=>s.animalRoute(a,new Set(approaches(s,a,b).filter(q=>animalAllowed(s,a,q)).map(at)))!==null);
    if(!bed)continue;
    clearActivity(a);a.work={kind:'rescue',patientId:p.id,bedId:bed.id,stage:'approach'};a.path=path;return rescueTick(s,a);
  }
  return false;
}
/** Runs before medicine, escape or handler work, so any override releases real
 * carried patients before their carrier moves under another state machine. */
export function prepareAnimalTraining(s: AnimalTrainingHost, a: WildAnimal): void {
  if(!animalTrainable(a.species))return;
  if(a.training.countDecayFrom!==null&&s.tick>=a.training.countDecayFrom+RULES.decayTicks) {
    const skill=decayAnimalTraining(a,s.tick,plantRandom(s.seed,a.id,s.tick,1602));
    if(skill)log(s,a,`${a.name}的${TRAINABLE_NAMES[skill]}熟练度退化一步，需要复训`);
  }
  if(a.training.masterId!==null&&(!animalSkillAvailable(a,'obedience')||!owner(s,a))){a.training.masterId=null;a.training.followDrafted=false;a.training.followFieldwork=false;}
  if(!animalCanWork(a)||a.hunger<30||a.fleeUntil>s.tick||
    s.pawns.some(p=>p.handleTask?.animalId===a.id||p.animalTrainTask?.animalId===a.id||p.animalCareTask?.animalId===a.id||p.ropeTask?.animalId===a.id))cancelAnimalWork(s,a);
}
/** Commands and late-in-tick health/building changes must leave a reloadable
 * state even while paused. Reconciliation cancels invalid work, never advances
 * training, movement, random outcomes or inventory consumption. */
export function reconcileAnimalTraining(s: AnimalTrainingHost): void {
  for(const p of s.pawns)if(p.animalTrainTask){
    const t=p.animalTrainTask,a=s.animals.find(a=>a.id===t.animalId),source=t.sourceId===null?null:s.items.find(i=>i.id===t.sourceId);
    if(!a||!animalCanWork(a)||!workerCan(p)||!a.training.wanted[t.trainable]||!canTrainAnimal(a,t.trainable)||
      !s.pawnAllowed(p,a)||(t.stage==='fetch'&&(!source||source.forbidden||!s.pawnAllowed(p,source)||s.animalAvailable(source,p.id)<t.amount)))s.prisonRelease(p);
  }
  for(const a of s.animals){
    if(a.training.masterId!==null&&(!animalSkillAvailable(a,'obedience')||a.dead||a.faction!=='colony'||!owner(s,a))){
      a.training.masterId=null;a.training.followDrafted=false;a.training.followFieldwork=false;
    }
    const w=a.work;if(!w)continue;
    if(!animalCanWork(a)){cancelAnimalWork(s,a);continue;}
    if(w.kind==='follow'||w.kind==='attack'){
      const m=owner(s,a),target=w.kind==='attack'?s.pawns.find(p=>p.id===w.targetId):null;
      if(!m||m.downed||m.carriedBy!==null||!animalSkillAvailable(a,'obedience')||
        !(m.drafted?a.training.followDrafted:a.training.followFieldwork)||
        w.kind==='attack'&&(!target||target.dead||target.downed||target.carriedBy!==null))cancelAnimalWork(s,a);
    }else if(w.kind==='rescue'){
      const p=s.pawns.find(p=>p.id===w.patientId),bed=s.beds.find(b=>b.id===w.bedId);
      if(!p||p.dead||!p.downed||!bed||!rescueBedFree(s,a,p,bed)||!animalSkillAvailable(a,'rescue'))cancelAnimalWork(s,a);
    }else if(!animalSkillAvailable(a,'haul'))cancelAnimalWork(s,a);
  }
}
export function animalCooperationTick(s: AnimalTrainingHost, a: WildAnimal): boolean {
  if(!animalTrainable(a.species))return false;
  const trainer=s.pawns.find(p=>p.animalTrainTask?.animalId===a.id&&p.animalTrainTask.stage==='work');
  if(trainer){clearActivity(a);a.phase='interact';a.reason=trainer.reason;return true;}
  if(!animalCanWork(a)||a.hunger<30)return false;
  if(a.cargo&&!a.work){s.animalDropCargo(a);if(a.cargo){a.reason='携带物资等待附近空位';return true;}}
  const m=owner(s,a),masterActive=!!m&&!m.downed&&m.carriedBy===null&&m.psyche.breakUntil<=s.tick;
  const released=masterActive&&m.drafted&&m.animalsReleased&&animalSkillAvailable(a,'release');
  const following=masterActive&&animalSkillAvailable(a,'obedience')&&
    (m.drafted?a.training.followDrafted:a.training.followFieldwork&&s.animalMasterWorking(m));
  if(following&&!a.cargo) {
    const targets=s.animalDefenseTargets(a,m,released?RULES.releasedDefendRadius:RULES.defendRadius)
      .filter(p=>animalAllowed(s,a,p));
    const target=targets.find(p=>p.id===(a.work?.kind==='attack'?a.work.targetId:null))??targets[0];
    if(target) {
      if(a.work?.kind!=='attack'||a.work.targetId!==target.id){cancelAnimalWork(s,a);clearActivity(a);a.work={kind:'attack',targetId:target.id,nextAttackTick:s.tick};}
      a.phase='attack';a.reason='协助'+m.name+'防御：'+target.name;
      const reached=moveAnimalTo(s,a,approaches(s,a,target));
      if(reached===true&&s.tick>=a.work.nextAttackTick)s.animalStrike(a,target);
      if(reached===null){cancelAnimalWork(s,a);a.reason='防御目标通路受阻';}
      return true;
    }
    if(a.work?.kind!=='follow'){cancelAnimalWork(s,a);clearActivity(a);a.work={kind:'follow',masterId:m.id};}
    a.phase='follow';a.reason='跟随'+m.name;
    if(distance(a,m)>(released?RULES.releasedFollowDistance:RULES.followDistance)) {
      if(moveAnimalTo(s,a,approaches(s,a,m))===null)a.reason='跟随通路受阻，等待主人返回';
    }else a.path=[];
    return true;
  }
  if(a.work?.kind==='follow'||a.work?.kind==='attack')cancelAnimalWork(s,a);
  if(a.work?.kind==='rescue')return rescueTick(s,a);
  if(a.work?.kind==='haul')return s.animalHaulTick(a);
  if(a.goal||a.hunger<65||hourAt(s.tick)<6||hourAt(s.tick)>=20)return false;
  if(s.tick>=a.decisionTick&&startRescue(s,a))return true;
  if(animalSkillAvailable(a,'haul')&&s.tick>=a.training.nextHaulTick) {
    a.training.nextHaulTick=s.tick+RULES.haulCheckTicks;
    if(plantRandom(s.seed,a.id,s.tick,1603)<1-Math.exp(-RULES.haulCheckTicks/RULES.haulMtbTicks)&&s.animalHaulStart(a))return true;
  }
  return false;
}
