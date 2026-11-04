import { animalAllowed, animalManagementTick, inheritAnimalArea, cancelAnimalRopes, type PensHost } from './pensWorld';
import { initialAnimalPenState } from './pens';
import { at, CELLS, DAY, position, type Cargo, type Crop, type GrassPatch, type HandleTask,
  type HusbandryEvent, type Pawn, type Pos, type Stack, type WildAnimal, type CommandResult } from './types';
import { ANIMAL_DEFS } from './wildlife';
import { NUTRITION, daylight, hourAt, temperatureGrowth } from './farming';
import { plantRandom } from './plants';
import { learnSkill } from './skills';
import { healthSummary } from './survival';
import { HUSBANDRY_RULES, ANIMAL_HUSBANDRY, initialAnimalState, isAnimalAdult,
  animalNutritionCapacity, animalFeedAmount, tameChance, advanceAnimalNeeds } from './husbandry';

export interface HusbandryHost extends PensHost {
  seed: number; tick: number; nextId: number; notice: string;
  animals: WildAnimal[]; pawns: Pawn[]; items: Stack[]; crops: Crop[];
  grass: GrassPatch[]; husbandryLog: HusbandryEvent[];
  stats: { consumed: Record<Cargo['resource'], number> };
  temperature(p: Pos): number;
  standable(p: Pos): boolean;
  animalNeighbors(a: WildAnimal, p: Pos): number[];
  animalCanStop(p: Pos): boolean;
  animalMoveTicks(a: WildAnimal, from: Pos): number;
  animalGrassSite(p: Pos): boolean;
  animalAvailable(item: Stack, pawnId?: number): number;
  animalTake(p: Pawn, id: number, amount: number): boolean;
  animalEatCrop(id: number): void;
  itemStands(item: Pos): Pos[];
  itemTouch(actor: Pos, item: Pos): boolean;
  itemPath(from: Pos, item: Pos): number[] | null;
  killAnimal(a: WildAnimal, reason: string): void;
  prisonPath(from: Pos, to: Pos): number[] | null;
  prisonApproach(p: Pawn, target: Pos): number[] | null;
  prisonRelease(p: Pawn): void;
}
const adjacent = (a: Pos, b: Pos) => a.z === b.z && Math.abs(a.x-b.x)+Math.abs(a.y-b.y) === 1;
const edible = (b: Cargo) => ['grain', 'food', 'meal'].includes(b.resource);
const rawFeed = (b: Cargo) => b.resource === 'grain';
const random = (s: HusbandryHost, a: WildAnimal, salt: number) => plantRandom(s.seed, a.id, s.tick, salt);
function event(s: HusbandryHost, kind: HusbandryEvent['kind'], a: WildAnimal, message: string, otherId: number|null = null) {
  s.husbandryLog.push({tick:s.tick, kind, animalId:a.id, otherId, message});
  s.husbandryLog = s.husbandryLog.slice(-HUSBANDRY_RULES.maxLog);
  s.notice = message;
}
function clearAnimal(a: WildAnimal) {
  a.path=[]; a.goal=null; a.eatProgress=0; a.mateId=null; a.mateProgress=0;
  if (!a.dead) a.phase='roam';
}
export function releaseAnimalHandlers(s: HusbandryHost, a: WildAnimal) {
  cancelAnimalRopes(s,a.id);
  for (const p of s.pawns) if (p.handleTask?.animalId===a.id) s.prisonRelease(p);
}
export function animalOrder(s: HusbandryHost, id: number, order: string, enabled: boolean): CommandResult {
  const a=s.animals.find(a=>a.id===id&&!a.dead);
  if(!a||!['tame','slaughter','release'].includes(order)||typeof enabled!=='boolean')return {ok:false,message:'动物或指令无效'};
  if((order==='tame')!==(a.faction==='wild'))return {ok:false,message:order==='tame'?'已经属于殖民地':'只能管理殖民地动物'};
  releaseAnimalHandlers(s,a);
  if(enabled){a.tame=false;a.slaughter=false;a.releaseMarked=false;a.hunt=false;
    for(const p of s.pawns)if(p.attackTargetId===a.id)s.prisonRelease(p);}
  if(order==='tame')a.tame=enabled;
  else if(order==='slaughter')a.slaughter=enabled;
  else a.releaseMarked=enabled;
  a.retryTick=0;
  return {ok:true,message:enabled?'已标记，等待开启驯养分工的殖民者':'已取消动物指令'};
}

/** Persistent, finite vegetation. Soil itself never supplies nutrition. */
export function seedGrass(s: HusbandryHost) {
  s.grass=[];
  for(let cell=0;cell<CELLS;cell++) {
    const p=position(cell);
    if(plantRandom(s.seed,p.x,p.y,1100)<.4 && s.animalGrassSite(p)) s.grass.push({...p,growth:1});
  }
}
function grassTick(s: HusbandryHost) {
  if(s.tick%100)return;
  s.grass=s.grass.filter(g=>s.animalGrassSite(g));
  const light=daylight(hourAt(s.tick));
  for(const g of s.grass)if(g.growth<1)g.growth=Math.min(1,g.growth+100/HUSBANDRY_RULES.grassRegrowTicks*light*temperatureGrowth(s.temperature(g)));
}

/** BFS uses animal-specific edges: no ladders, species-specific doors. */
function route(s: HusbandryHost,a: WildAnimal, targets: Map<number,NonNullable<WildAnimal['goal']>>): {path:number[];goal:NonNullable<WildAnimal['goal']>}|null {
  const start=at(a), parents=new Map<number,number>([[start,-1]]), queue=[start];
  for(let head=0;head<queue.length;head++) {
    const cell=queue[head],goal=targets.get(cell);
    if(goal){const path:number[]=[];let n=cell;while(n!==start){path.push(n);n=parents.get(n)!;}return {path:path.reverse(),goal};}
    for(const n of s.animalNeighbors(a,position(cell)))if(!parents.has(n)){parents.set(n,cell);queue.push(n);}
  }
  return null;
}
function move(s: HusbandryHost,a:WildAnimal):boolean {
  if(!a.path.length)return false;
  if(s.tick<a.moveTick)return true;
  const next=a.path[0];
  if(!s.animalNeighbors(a,a).includes(next)){clearAnimal(a);a.decisionTick=s.tick+40;return false;}
  const from={x:a.x,y:a.y,z:a.z};Object.assign(a,position(a.path.shift()!));
  a.moveTick=s.tick+s.animalMoveTicks(a,from);return true;
}
function foodTargets(s:HusbandryHost,a:WildAnimal) {
  const targets=new Map<number,NonNullable<WildAnimal['goal']>>();
  for(const g of s.grass)if(g.growth>=HUSBANDRY_RULES.grassMinGrowth)targets.set(at(g),{kind:'grass',id:at(g)});
  for(const c of s.crops)if(['rice','potato','corn'].includes(c.kind)&&c.growth>=.1)targets.set(at(c),{kind:'crop',id:c.id});
  for(const f of [...s.items].sort((a,b)=>a.id-b.id)) if(edible(f)&&s.animalAvailable(f)>0)
    for (const stand of s.itemStands(f)) if (!targets.has(at(stand))) targets.set(at(stand),{kind:'food',id:f.id});
  for (const cell of targets.keys()) if (!animalAllowed(s,a,position(cell))) targets.delete(cell);
  return targets;
}
function goalPosition(s:HusbandryHost,a:WildAnimal):Pos|undefined {
  const goal=a.goal;if(!goal)return;
  if(goal.kind==='grass')return s.grass.find(g=>at(g)===goal.id&&g.growth>=HUSBANDRY_RULES.grassMinGrowth&&s.animalGrassSite(g));
  if(goal.kind==='crop')return s.crops.find(c=>c.id===goal.id&&c.growth>=.1);
  if(goal.kind==='food')return s.items.find(i=>i.id===goal.id&&edible(i)&&s.animalAvailable(i)>0);
  return goal.kind==='mate' ? s.animals.find(q=>q.id===goal.id&&!q.dead) : undefined;
}
function consumeNutrition(a:WildAnimal,nutrition:number) {
  a.hunger=Math.min(100,a.hunger+100*nutrition/animalNutritionCapacity(a));
}
function eat(s:HusbandryHost,a:WildAnimal) {
  const target=goalPosition(s,a);
  if(!target || (a.goal?.kind === 'food' ? !s.itemTouch(a,target) : at(target)!==at(a))){clearAnimal(a);return;}
  a.phase=a.goal!.kind==='food'?'eat':'graze';a.reason='正在吃'+(a.goal!.kind==='food'?'地面食物':a.goal!.kind==='crop'?'田间作物':'野草');
  if(++a.eatProgress<HUSBANDRY_RULES.eatWork)return;
  const goal=a.goal!;
  if(goal.kind==='food'){
    const b=target as Stack,amount=Math.min(s.animalAvailable(b),Math.max(1,Math.ceil((100-a.hunger)/100*animalNutritionCapacity(a)/NUTRITION[b.resource]!)));
    if(amount>0){b.amount-=amount;consumeNutrition(a,amount*NUTRITION[b.resource]!);s.stats.consumed[b.resource]+=amount;s.items=s.items.filter(i=>i.amount>0);
      if(a.faction==='colony')event(s,'fed',a,`${a.name}吃了${amount}单位地面食物`);}
  }else if(goal.kind==='crop'){
    consumeNutrition(a,.25*(target as Crop).growth);s.animalEatCrop(goal.id);
  }else if(goal.kind==='grass'){
    const g=target as GrassPatch,taken=Math.min(g.growth,.5);g.growth-=taken;consumeNutrition(a,taken*HUSBANDRY_RULES.grassNutrition);
  }
  clearAnimal(a);a.decisionTick=s.tick;
}
function compatibleMate(a:WildAnimal,b:WildAnimal) {
  return a!==b&&!a.dead&&!b.dead&&a.faction==='colony'&&b.faction==='colony'&&a.species===b.species&&
    a.sex==='male'&&b.sex==='female'&&isAnimalAdult(a)&&isAnimalAdult(b)&&!b.pregnancy&&
    a.hunger>30&&b.hunger>30&&a.malnutrition<.1&&b.malnutrition<.1&&!a.slaughter&&!b.slaughter&&!a.releaseMarked&&!b.releaseMarked;
}
function mateTick(s:HusbandryHost,a:WildAnimal):boolean {
  if(a.mateId===null)return false;
  const b=s.animals.find(b=>b.id===a.mateId);
  if(!b||!compatibleMate(a,b)||s.pawns.some(p=>p.handleTask?.animalId===b.id||p.ropeTask?.animalId===b.id)||!animalAllowed(s,a,b)){clearAnimal(a);return false;}
  a.phase='mate';a.reason='靠近配偶';
  if(!adjacent(a,b)){
    if(!a.path.length||s.tick%80===0){
      const targets=new Map(s.animalNeighbors(a,b).filter(n=>s.animalCanStop(position(n))&&adjacent(position(n),b)&&animalAllowed(s,a,position(n))).map(n=>[n,{kind:'mate' as const,id:b.id}]));
      const result=route(s,a,targets);if(!result){clearAnimal(a);a.nextMateTick=s.tick+200;return false;}
      a.path=result.path;a.goal=result.goal;
    }
    move(s,a);return true;
  }
  a.path=[];a.goal={kind:'mate',id:b.id};a.reason='正在交配';
  if(++a.mateProgress>=HUSBANDRY_RULES.mateWork){
    if(random(s,a,1101)<HUSBANDRY_RULES.mateChance){b.pregnancy={fatherId:a.id,progress:0};event(s,'pregnancy',b,`${b.name}已经怀孕`,a.id);}
    a.nextMateTick=s.tick+HUSBANDRY_RULES.mateInterval;clearAnimal(a);
  }
  return true;
}
function birth(s:HusbandryHost,a:WildAnimal) {
  if(!a.pregnancy||a.pregnancy.progress<1)return;
  // Never overlap physical entities or mint offspring past the bounded population.
  const cell=s.animalNeighbors(a,a).find(n=>!s.animals.some(b=>at(b)===n)&&!s.pawns.some(p=>at(p)===n));
  if(cell===undefined||s.animals.length>=HUSBANDRY_RULES.maxAnimals){a.reason='临产，等待附近空位或动物容量';return;}
  const id=s.nextId++,child:WildAnimal={...position(cell),...initialAnimalState(id,a.species,s.tick),
    id,species:a.species,name:a.name,health:ANIMAL_DEFS[a.species].health,hunger:80,dead:false,phase:'roam',hunt:false,
    moveTick:s.tick+20,decisionTick:s.tick,fleeUntil:0,threatId:null,retryTick:0,rotProgress:0,
    faction:a.faction,ageTicks:0,growth:0,tameness:a.faction==='colony'?5:0};
  inheritAnimalArea(a,child);s.animals.push(child);a.pregnancy=null;
  event(s,'birth',a,`${a.name}产下一只幼崽`,id);
}
export function updateHusbandry(s:HusbandryHost) {
  grassTick(s);
  for(const a of [...s.animals]){
    if(a.dead)continue;
    const pregnant=!!a.pregnancy;
    advanceAnimalNeeds(a);
    if(pregnant&&!a.pregnancy)event(s,'miscarriage',a,`${a.name}因营养不良流产`);
    if(a.malnutrition>=1){event(s,'starved',a,`${a.name}因长期饥饿死亡`);s.killAnimal(a,'长期饥饿');continue;}
    if(a.faction==='colony'&&a.species==='hare'&&s.tick>=a.nextTamenessDecayTick){
      a.tameness=Math.max(0,a.tameness-1);a.nextTamenessDecayTick=s.tick+HUSBANDRY_RULES.tamenessDecayTicks;
      if(!a.tameness){releaseAnimalHandlers(s,a);a.faction='wild';Object.assign(a,initialAnimalPenState(s.tick));a.slaughter=false;a.releaseMarked=false;clearAnimal(a);
        event(s,'rewild',a,`${a.name}长期缺少维护，重新变为野生动物`);}
    }
    birth(s,a);
    const threat=s.pawns.find(p=>p.id===a.threatId&&!p.dead);
    if(a.fleeUntil>s.tick&&threat){
      cancelAnimalRopes(s,a.id);clearAnimal(a);a.phase='flee';a.reason='逃离威胁';
      if(s.tick>=a.moveTick){const choices=s.animalNeighbors(a,a).map(position).sort((x,y)=>Math.hypot(y.x-threat.x,y.y-threat.y)-Math.hypot(x.x-threat.x,x.y-threat.y));
        if(choices.length){const from={...a};Object.assign(a,choices[0]);a.moveTick=s.tick+s.animalMoveTicks(a,from);}}
      continue;
    }
    a.threatId=null;
    const handler=s.pawns.find(p=>p.handleTask?.animalId===a.id&&p.handleTask.stage==='interact');
    if(handler){clearAnimal(a);a.phase='interact';a.reason=handler.reason;continue;}
    if(animalManagementTick(s,a))continue;
    const suitor=s.animals.find(b=>b.mateId===a.id&&compatibleMate(b,a));
    if(suitor&&a.hunger>30){clearAnimal(a);a.phase='mate';a.reason='等待配偶靠近';continue;}
    if(mateTick(s,a))continue;
    if(a.goal&&a.goal.kind!=='mate'){
      if(!goalPosition(s,a)){clearAnimal(a);}
      else if(move(s,a))continue;
      else {eat(s,a);continue;}
    }
    if(s.tick<a.decisionTick)continue;
    a.decisionTick=s.tick+80;
    if(a.hunger<65){
      const result=route(s,a,foodTargets(s,a));
      if(result){a.path=result.path;a.goal=result.goal;a.phase='roam';a.reason='前往觅食';if(!move(s,a))eat(s,a);continue;}
      a.reason='找不到可达食物；需要草地或投放粮食';
    }
    if(a.sex==='male'&&a.faction==='colony'&&s.tick>=a.nextMateTick&&a.hunger>45){
      for(const b of s.animals.filter(b=>compatibleMate(a,b)&&animalAllowed(s,a,b)&&!s.pawns.some(p=>p.ropeTask?.animalId===b.id)&&!s.animals.some(other=>other.mateId===b.id))){
        const result=route(s,a,new Map(s.animalNeighbors(a,b).filter(n=>s.animalCanStop(position(n))&&adjacent(position(n),b)).map(n=>[n,{kind:'mate' as const,id:b.id}])));
        if(result){a.mateId=b.id;a.path=result.path;a.goal=result.goal;mateTick(s,a);break;}
      }
      if(a.mateId!==null)continue;
      a.nextMateTick=s.tick+200;
    }
    const night=hourAt(s.tick)<6||hourAt(s.tick)>=20;
    a.phase=night&&a.hunger>30?'rest':'roam';
    if(a.phase==='rest'&&s.animalCanStop(a)){a.reason='休息';continue;}
    a.phase='roam';
    const choices=s.animalNeighbors(a,a).filter(n=>animalAllowed(s,a,position(n))&&!s.animals.some(b=>b!==a&&at(b)===n));
    if(choices.length){const from={...a};Object.assign(a,position(choices[Math.floor(random(s,a,1102)*choices.length)]));a.moveTick=s.tick+s.animalMoveTicks(a,from);}
    if(a.hunger>=65)a.reason='自由活动';
  }
}

function canHandle(p:Pawn){const h=healthSummary(p);return p.faction==='colony'&&!p.dead&&!p.downed&&!p.drafted&&p.carriedBy===null&&p.priorities.handle>0&&h.manipulation>0&&h.moving>.15;}
function actionFor(a:WildAnimal):HandleTask['action']|null {
  if(a.faction==='wild')return a.tame?'tame':null;
  return a.slaughter?'slaughter':a.releaseMarked?'release':a.hunger<30?'feed':a.species==='hare'&&a.tameness<5?'maintain':null;
}
function handlerRoute(p:Pawn,path:number[]){p.path=path;p.destination=path.at(-1)??null;p.phase='handle';}
export function tryHandle(s:HusbandryHost,p:Pawn):boolean {
  if(!canHandle(p)||p.cargo||p.food<30||p.rest<20)return false;
  for(const a of s.animals.filter(a=>!a.dead&&!s.pawns.some(p=>p.ropeTask?.animalId===a.id)&&s.tick>=a.retryTick&&a.phase!=='flee'&&
    !s.pawns.some(q=>q.handleTask?.animalId===a.id)).sort((a,b)=>a.hunger-b.hunger)){
    const action=actionFor(a);if(!action)continue;
    if(['tame','maintain'].includes(action)&&(s.tick<a.nextInteractionTick||p.skills.animals.level<ANIMAL_HUSBANDRY[a.species].minSkill||a.phase==='rest'))continue;
    const path=s.prisonApproach(p,a);if(path===null){a.retryTick=s.tick+200;continue;}
    const foodNeeded=['tame','maintain','feed'].includes(action);
    let source:Stack|undefined,foodPath:number[]|null=null,amount=0;
    if(foodNeeded){
      for(const food of s.items.filter(f=>action==='feed'?edible(f):rawFeed(f))){
        const n=animalFeedAmount(a.species,food.resource)*(action==='feed'?1:HUSBANDRY_RULES.feedings);
        if(n<=0||s.animalAvailable(food)<n)continue;
        const route=s.itemPath(p,food);if(route===null)continue;
        if(foodPath===null||route.length<foodPath.length){source=food;foodPath=route;amount=n;}
      }
      if(!source){a.reason='等待驯养员与可达的食物（驯服需要生粮）';continue;}
    }
    s.prisonRelease(p);
    p.handleTask={animalId:a.id,action,stage:source?'fetch':'approach',foodId:source?.id??null,amount,feedings:0,progress:0};
    handlerRoute(p,foodPath??path);p.reason=source?'取食物照料'+a.name:action==='slaughter'?'前往宰杀'+a.name:'前往放归'+a.name;
    return true;
  }
  return false;
}
export function handleTick(s:HusbandryHost,p:Pawn) {
  const task=p.handleTask;if(!task)return;
  const a=s.animals.find(a=>a.id===task.animalId);
  const cancel=(message:string)=>{s.prisonRelease(p);p.reason=message;};
  if(!a||a.dead||!canHandle(p)||p.food<12||p.rest<1||a.phase==='flee'||
    (task.action==='tame'?a.faction!=='wild'||!a.tame: a.faction!=='colony')||
    (task.action==='slaughter'&&!a.slaughter)||(task.action==='release'&&!a.releaseMarked)||
    (['tame','maintain'].includes(task.action)&&p.skills.animals.level<ANIMAL_HUSBANDRY[a.species].minSkill)){
    cancel('动物照料中断，保留未用食物');return;
  }
  if(task.stage==='fetch'){
    const food=s.items.find(i=>i.id===task.foodId);
    if(!food||s.animalAvailable(food,p.id)<task.amount){cancel('食物已不可用，重新安排');return;}
    if(!s.itemTouch(p,food)){
      if(!p.path.length){const path=s.itemPath(p,food);if(path===null){cancel('食物通路中断');return;}handlerRoute(p,path);}return;
    }
    if(!s.animalTake(p,food.id,task.amount)){cancel('无法拿取食物');return;}
    task.foodId=null;task.stage='approach';
  }
  if(!adjacent(p,a)){
    task.stage='approach';task.progress=0;
    if(!p.path.length||(s.tick+p.id)%40===0){const path=s.prisonApproach(p,a);if(path===null){a.retryTick=s.tick+200;cancel('无法靠近动物');return;}handlerRoute(p,path);}
    p.reason='靠近'+a.name;return;
  }
  p.path=[];p.destination=null;task.stage='interact';
  if(['tame','maintain','feed'].includes(task.action)){
    if(!p.cargo||(task.action==='feed'?!edible(p.cargo):!rawFeed(p.cargo))){cancel('携带食物不足');return;}
    p.reason=(task.action==='feed'?'喂食':task.action==='maintain'?'维护驯顺':'尝试驯服')+a.name;
    if(++task.progress<HUSBANDRY_RULES.handleWork)return;
    const amount=animalFeedAmount(a.species,p.cargo.resource);
    if(p.cargo.amount<amount){cancel('携带食物不足');return;}
    consumeNutrition(a,amount*NUTRITION[p.cargo.resource]!);s.stats.consumed[p.cargo.resource]+=amount;
    p.cargo.amount-=amount;if(!p.cargo.amount)p.cargo=null;
    task.progress=0;task.feedings++;
    learnSkill(p.skills.animals,50);
    if(task.action==='feed'){event(s,'fed',a,`${p.name}实际喂食了${a.name}`,p.id);cancel('喂食完成');return;}
    if(task.feedings<HUSBANDRY_RULES.feedings)return;
    a.nextInteractionTick=s.tick+HUSBANDRY_RULES.interactionCooldown;
    const success=random(s,a,1103)<tameChance({...a,faction:'wild'},p.skills.animals.level);
    if(success){
      if(task.action==='tame'){Object.assign(a,initialAnimalPenState(s.tick));a.faction='colony';a.tame=false;a.hunt=false;a.tameness=5;event(s,'tame',a,`${p.name}成功驯服${a.name}`,p.id);}
      else a.tameness=Math.min(5,a.tameness+1);
      a.nextTamenessDecayTick=s.tick+HUSBANDRY_RULES.tamenessDecayTicks;clearAnimal(a);
    }else event(s,'failed',a,`${p.name}的${task.action==='tame'?'驯服':'驯顺维护'}尝试失败，稍后可再次尝试`,p.id);
    cancel(success?'动物互动成功':'动物互动失败');return;
  }
  p.reason=(task.action==='slaughter'?'正在宰杀':'正在放归')+a.name;
  if(++task.progress<HUSBANDRY_RULES.slaughterWork)return;
  if(task.action==='slaughter'){event(s,'slaughter',a,`${p.name}宰杀了${a.name}`,p.id);s.killAnimal(a,'宰杀');}
  else{a.faction='wild';Object.assign(a,initialAnimalPenState(s.tick));a.releaseMarked=false;a.slaughter=false;a.tame=false;a.tameness=0;clearAnimal(a);event(s,'release',a,`${p.name}将${a.name}放归野外`,p.id);}
  cancel('动物管理完成');
}
