import { animalAllowed, animalManagementTick, inheritAnimalArea, cancelAnimalRopes, type PensHost } from './pensWorld';
import { initialAnimalPenState } from './pens';
import { autoSlaughterSelection, type AutoSlaughterSettings } from './autoSlaughter';
import { advanceWool, woolReady, woolGatherSpeed, woolGatherChance, WOOL_RULES } from './animalWool';
import { advanceEggLayer, eggLayerActive, EGG_RULES, freshFertilizedEggs } from './animalEggs';
import { eggBoxAccepts, type EggBox } from './eggBoxes';
import { freshBatch } from './preservation';
import { advanceMilk, milkReady, milkGatherSpeed, milkGatherChance, MILK_RULES } from './animalMilk';
import { at, CELLS, DAY, position, type Cargo, type Crop, type GrassPatch, type HandleTask,
  type HusbandryEvent, type Pawn, type Pos, type Stack, type WildAnimal, type CommandResult } from './types';
import { ANIMAL_DEFS } from './wildlife';
import { animalCanEatResource, animalCanTrainWithResource, animalGrazes } from './animalTraining';
import { NUTRITION, daylight, hourAt, temperatureGrowth } from './farming';
import { plantRandom } from './plants';
import { animalEnvironmentEffects, animalTemperatureAllowsRecovery } from './animalEnvironment';
import { learnSkill } from './skills';
import { healthSummary } from './survival';
import { HUSBANDRY_RULES, ANIMAL_HUSBANDRY, initialAnimalState, isAnimalAdult,
  animalNutritionCapacity, animalFeedAmount, tameChance, advanceAnimalNeeds } from './husbandry';

export interface HusbandryHost extends PensHost {
  animalPrepareTraining?(animal: WildAnimal): void;
  animalCooperation?(animal: WildAnimal): boolean;
  animalCancelWork?(animal: WildAnimal): void;
  animalDropCargo?(animal: WildAnimal): boolean;
  animalMedicalTravel?(animal: WildAnimal): boolean;
  animalTradeTravel?(animal: WildAnimal): boolean;
  animalTradeBirth?(mother: WildAnimal, child: WildAnimal): void;
  autoSlaughter?: AutoSlaughterSettings;
  eggBoxes?: EggBox[];
  animalEggBoxPlace?(a: WildAnimal, batch: Cargo, boxId: number, commit: boolean): boolean;
  seed: number; tick: number; nextId: number; notice: string;
  animals: WildAnimal[]; pawns: Pawn[]; items: Stack[]; crops: Crop[];
  grass: GrassPatch[]; husbandryLog: HusbandryEvent[];
  stats: { consumed: Record<Cargo['resource'], number> };
  temperature(p: Pos): number;
  standable(p: Pos): boolean;
  animalNeighbors(a: WildAnimal, p: Pos): number[];
  animalCanStop(p: Pos): boolean;
  animalMoveTicks(a: WildAnimal, from: Pos): number;
  animalRoute(a: WildAnimal, targets: Set<number>): number[] | null;
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
  /** Dry-run must have no side effects; commit places the whole batch and books production. */
  animalWoolPlace?(p: Pawn, amount: number, commit: boolean): boolean;
  animalMilkPlace?(p: Pawn, amount: number, commit: boolean): boolean;
  animalEggPlace?(a: WildAnimal, batch: Cargo, commit: boolean): boolean;
  animalEggRoom?(p: Pos): number;
}
const adjacent = (a: Pos, b: Pos) => a.z === b.z && Math.abs(a.x-b.x)+Math.abs(a.y-b.y) === 1;
const edible = (b: Cargo, a: WildAnimal) => animalCanEatResource(a.species,b.resource);
const rawFeed = (b: Cargo, a: WildAnimal) => animalCanTrainWithResource(a.species,b.resource);
// Once a sick animal reaches suitable air, feeding, laying, mating and wandering should
// not immediately send it back into a harmful room. Paths can still pass
// through other cells; this filter governs the intended destination.
const recoveringDestination = (s:HusbandryHost,a:WildAnimal,p:Pos) =>
  !animalEnvironmentEffects(a).ill || !animalTemperatureAllowsRecovery(a,s.temperature(a)) ||
  animalTemperatureAllowsRecovery(a,s.temperature(p));
// Ordinary hunger uses the eater's faction. Wild animals do not obey the
// colony's item flag; normal domestic animals do. This is not curious eating.
const hungerFoodAllowed = (a: WildAnimal, food: Stack) => a.faction !== 'colony' || !food.forbidden;
const pawnAllowed = (s: HusbandryHost, p: Pawn, target: Pos) => s.pawnAllowed?.(p, target) ?? true;
const random = (s: HusbandryHost, a: WildAnimal, salt: number) => plantRandom(s.seed, a.id, s.tick, salt);
function event(s: HusbandryHost, kind: HusbandryEvent['kind'], a: WildAnimal, message: string, otherId: number|null = null) {
  s.husbandryLog.push({tick:s.tick, kind, animalId:a.id, otherId, message});
  s.husbandryLog = s.husbandryLog.slice(-HUSBANDRY_RULES.maxLog);
  s.notice = message;
}
function clearAnimal(a: WildAnimal) {
  a.path=[]; a.goal=null; a.eatProgress=0; a.mateId=null; a.mateProgress=0;
  a.layProgress=0;
  if (!a.dead) a.phase='roam';
}
export function releaseAnimalHandlers(s: HusbandryHost, a: WildAnimal) {
  s.animalCancelWork?.(a);
  cancelAnimalRopes(s,a.id);
  for (const p of s.pawns) if (p.handleTask?.animalId===a.id||p.animalTrainTask?.animalId===a.id) s.prisonRelease(p);
}
export function animalOrder(s: HusbandryHost, id: number, order: string, enabled: boolean): CommandResult {
  const a=s.animals.find(a=>a.id===id&&!a.dead);
  if(!a||!['tame','slaughter','release'].includes(order)||typeof enabled!=='boolean')return {ok:false,message:'动物或指令无效'};
  if(a.faction==='trader')return {ok:false,message:'商队动物需要通过交易取得，不能直接管理'};
  if((order==='tame')!==(a.faction==='wild'))return {ok:false,message:order==='tame'?'已经属于殖民地':'只能管理殖民地动物'};
  releaseAnimalHandlers(s,a);
  if(enabled){a.tame=false;a.slaughter=false;a.releaseMarked=false;a.hunt=false;
    for(const p of s.pawns)if(p.attackTargetId===a.id)s.prisonRelease(p);}
  if(order==='tame')a.tame=enabled;
  else if(order==='slaughter')a.slaughter=enabled;
  else a.releaseMarked=enabled;
  a.retryTick=0;
  reconcileAutoSlaughter(s);
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

/** Travel costs use the animal's own pace and traversable edges. */
function route(s: HusbandryHost,a: WildAnimal, targets: Map<number,NonNullable<WildAnimal['goal']>>): {path:number[];goal:NonNullable<WildAnimal['goal']>}|null {
  const destinations=[...targets.keys()].filter(cell=>recoveringDestination(s,a,position(cell)));
  const path=s.animalRoute(a,new Set(destinations));
  return path ? {path,goal:targets.get(path.at(-1)??at(a))!} : null;
}
function move(s: HusbandryHost,a:WildAnimal):boolean {
  if(!a.path.length)return false;
  if(!recoveringDestination(s,a,position(a.path.at(-1)!))){clearAnimal(a);a.decisionTick=s.tick;return false;}
  if(s.tick<a.moveTick)return true;
  const next=a.path[0];
  if(!s.animalNeighbors(a,a).includes(next)){clearAnimal(a);a.decisionTick=s.tick+40;return false;}
  const from={x:a.x,y:a.y,z:a.z};Object.assign(a,position(a.path.shift()!));
  a.moveTick=s.tick+s.animalMoveTicks(a,from);return true;
}
function foodTargets(s:HusbandryHost,a:WildAnimal) {
  const targets=new Map<number,NonNullable<WildAnimal['goal']>>();
  if(animalGrazes(a.species))for(const g of s.grass)if(g.growth>=HUSBANDRY_RULES.grassMinGrowth)targets.set(at(g),{kind:'grass',id:at(g)});
  if(animalGrazes(a.species))for(const c of s.crops)if(['rice','potato','corn'].includes(c.kind)&&c.growth>=.1)targets.set(at(c),{kind:'crop',id:c.id});
  for(const f of [...s.items].sort((a,b)=>a.id-b.id)) if(hungerFoodAllowed(a,f)&&edible(f,a)&&s.animalAvailable(f)>0)
    for (const stand of s.itemStands(f)) if (!targets.has(at(stand))) targets.set(at(stand),{kind:'food',id:f.id});
  for (const cell of targets.keys()) if (!animalAllowed(s,a,position(cell))) targets.delete(cell);
  return targets;
}
function goalPosition(s:HusbandryHost,a:WildAnimal):Pos|undefined {
  const goal=a.goal;if(!goal)return;
  if(goal.kind==='grass')return s.grass.find(g=>at(g)===goal.id&&g.growth>=HUSBANDRY_RULES.grassMinGrowth&&s.animalGrassSite(g));
  if(goal.kind==='crop')return s.crops.find(c=>c.id===goal.id&&c.growth>=.1);
  if(goal.kind==='food')return s.items.find(i=>i.id===goal.id&&hungerFoodAllowed(a,i)&&edible(i,a)&&s.animalAvailable(i)>0);
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
    (b.species!=='chicken'||b.fertilizationCount<EGG_RULES.fertilizationMax)&&
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
    if(b.species==='chicken'){
      b.fertilizationCount=EGG_RULES.fertilizationMax;b.eggFatherId=a.id;
      event(s,'fertilized',b,`${b.name}下一枚蛋已受精`,a.id);
    } else if(random(s,a,1101)<HUSBANDRY_RULES.mateChance){b.pregnancy={fatherId:a.id,progress:0};event(s,'pregnancy',b,`${b.name}已经怀孕`,a.id);}
    a.nextMateTick=s.tick+HUSBANDRY_RULES.mateInterval;clearAnimal(a);
  }
  return true;
}
/** Colony hens first reserve a reachable box. Ground laying remains the fallback. */
function boxAvailable(s:HusbandryHost,a:WildAnimal,box:EggBox):boolean {
  return a.faction==='colony' && eggBoxAccepts(box,a.fertilizationCount>0?'eggFertilized':'eggUnfertilized') &&
    !s.pawns.some(p=>p.eggBoxTask?.boxId===box.id) &&
    !s.animals.some(other=>other!==a&&other.goal?.kind==='layEggBox'&&other.goal.id===box.id);
}
function layEggTick(s:HusbandryHost,a:WildAnimal):boolean {
  // Merchant hens keep biological progress but hold their eggs until acquired.
  // Foreign ground-egg ownership/hatching is outside this trade tier.
  if(a.faction==='trader')return false;
  if(!eggLayerActive(a)||a.eggProgress<1||a.slaughter||a.releaseMarked||a.hunt){
    if(a.goal?.kind==='layEgg'||a.goal?.kind==='layEggBox')clearAnimal(a);return false;
  }
  if(a.goal?.kind!=='layEgg'&&a.goal?.kind!=='layEggBox') {
    if(s.tick<a.decisionTick)return false;
    clearAnimal(a);
    const eggType=a.fertilizationCount>0?'eggFertilized':'eggUnfertilized';
    const candidates=s.items.filter(i=>i.resource===eggType&&
      Math.hypot(i.x-a.x,i.y-a.y,i.z-a.z)<=30&&s.animalEggRoom?.(i)===s.animalEggRoom?.(a))
      .sort((x,y)=>Math.hypot(x.x-a.x,x.y-a.y,x.z-a.z)-Math.hypot(y.x-a.x,y.y-a.y,y.z-a.z)||x.id-y.id);
    let result:ReturnType<typeof route>=null;
    // The Web graph has no native region BFS. Search within the source radius,
    // preferring fuller compatible boxes, then geometric distance and identity.
    const distance=(b:Pos)=>Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
    for(const box of [...(s.eggBoxes??[])].filter(b=>distance(b)<=30&&boxAvailable(s,a,b)&&
      s.animalCanStop(b)&&animalAllowed(s,a,b)).sort((x,y)=>(y.eggs?.amount??0)-(x.eggs?.amount??0)||distance(x)-distance(y)||x.id-y.id)) {
      result=route(s,a,new Map([[at(box),{kind:'layEggBox',id:box.id}]]));if(result)break;
    }
    for(const egg of result?[]:candidates){
      const targets=new Map([egg,...s.itemStands(egg)].filter(p=>s.animalCanStop(p)&&animalAllowed(s,a,p))
        .map(p=>[at(p),{kind:'layEgg' as const,id:at(p)}]));
      result=route(s,a,targets);if(result)break;
    }
    if(!result){
      const targets=new Map<number,NonNullable<WildAnimal['goal']>>();
      for(let dx=-5;dx<=5;dx++)for(let dy=-5;dy<=5;dy++){
        const p={x:a.x+dx,y:a.y+dy,z:a.z};
        if(Math.abs(dx)+Math.abs(dy)<=5&&s.animalCanStop(p)&&animalAllowed(s,a,p))targets.set(at(p),{kind:'layEgg',id:at(p)});
      }
      result=route(s,a,targets);
    }
    if(!result){a.reason='准备产蛋，找不到可达位置';a.decisionTick=s.tick+80;return true;}
    a.path=result.path;a.goal=result.goal;a.layProgress=0;
  }
  const box=a.goal!.kind==='layEggBox'?s.eggBoxes?.find(b=>b.id===a.goal!.id):undefined;
  const target=box??position(a.goal!.id);
  if((a.goal!.kind==='layEggBox'&&(!box||!boxAvailable(s,a,box)))||!s.animalCanStop(target)||!animalAllowed(s,a,target)){clearAnimal(a);a.decisionTick=s.tick+80;return true;}
  a.phase='layEgg';a.reason='前往产蛋位置';
  if(move(s,a))return true;
  if(!a.goal||at(a)!==at(target))return true;
  a.phase='layEgg';a.reason='正在产蛋';
  a.layProgress=Math.min(EGG_RULES.layWork,a.layProgress+1);
  if(a.layProgress<EGG_RULES.layWork)return true;
  const fertile=a.fertilizationCount>0;
  const batch=fertile?freshFertilizedEggs(1,a.faction,a.id,a.eggFatherId):freshBatch('eggUnfertilized',1);
  const place=(commit:boolean)=>box?s.animalEggBoxPlace?.(a,batch,box.id,commit):s.animalEggPlace?.(a,batch,commit);
  if(!place(false)){a.reason='产蛋完成，等待可用空间';return true;}
  if(!place(true))throw new Error('产蛋放置计划在同一模拟步内失效');
  a.eggProgress=0;
  if(fertile)a.fertilizationCount--;
  if(!a.fertilizationCount)a.eggFatherId=null;
  event(s,'laidEgg',a,`${a.name}产下一枚${fertile?'受精':'未受精'}鸡蛋`);
  clearAnimal(a);a.decisionTick=s.tick+80;return true;
}
function birth(s:HusbandryHost,a:WildAnimal) {
  if(!a.pregnancy||a.pregnancy.progress<1)return;
  // Never overlap physical entities or mint offspring past the bounded population.
  const cell=s.animalNeighbors(a,a).find(n=>!s.animals.some(b=>at(b)===n)&&!s.pawns.some(p=>at(p)===n));
  if(cell===undefined||s.animals.length>=HUSBANDRY_RULES.maxAnimals){a.reason='临产，等待附近空位或动物容量';return;}
  const id=s.nextId++,child:WildAnimal={...position(cell),...initialAnimalState(id,a.species,s.tick),
    id,species:a.species,name:a.name,health:ANIMAL_DEFS[a.species].health,hunger:80,dead:false,phase:'roam',hunt:false,
    moveTick:s.tick+20,decisionTick:s.tick,fleeUntil:0,threatId:null,retryTick:0,rotProgress:0,
    faction:a.faction,ageTicks:0,growth:0,tameness:a.faction==='wild'?0:5};
  inheritAnimalArea(a,child);s.animals.push(child);a.pregnancy=null;
  if(a.faction==='trader')s.animalTradeBirth?.(a,child);
  event(s,'birth',a,`${a.name}产下一只幼崽`,id);
}
export function updateHusbandry(s:HusbandryHost) {
  grassTick(s);
  for(const a of [...s.animals]){
    if(a.dead)continue;
    const pregnant=!!a.pregnancy;
    advanceMilk(a);
    advanceWool(a);
    advanceEggLayer(a);
    advanceAnimalNeeds(a);
    if(pregnant&&!a.pregnancy)event(s,'miscarriage',a,`${a.name}因营养不良流产`);
    if(a.malnutrition>=1){event(s,'starved',a,`${a.name}因长期饥饿死亡`);s.killAnimal(a,'长期饥饿');continue;}
    if(a.faction==='colony'&&a.species==='hare'&&s.tick>=a.nextTamenessDecayTick){
      a.tameness=Math.max(0,a.tameness-1);a.nextTamenessDecayTick=s.tick+HUSBANDRY_RULES.tamenessDecayTicks;
      if(!a.tameness){releaseAnimalHandlers(s,a);a.faction='wild';Object.assign(a,initialAnimalPenState(s.tick));a.slaughter=false;a.releaseMarked=false;clearAnimal(a);
        event(s,'rewild',a,`${a.name}长期缺少维护，重新变为野生动物`);}
    }
    birth(s,a);
    s.animalPrepareTraining?.(a);
    if(s.animalMedicalTravel?.(a))continue;
    const threat=s.pawns.find(p=>p.id===a.threatId&&!p.dead);
    if(a.fleeUntil>s.tick&&threat){
      cancelAnimalRopes(s,a.id);clearAnimal(a);a.phase='flee';a.reason='逃离威胁';
      if(s.tick>=a.moveTick){const choices=s.animalNeighbors(a,a).map(position).sort((x,y)=>Math.hypot(y.x-threat.x,y.y-threat.y)-Math.hypot(x.x-threat.x,x.y-threat.y));
        if(choices.length){const from={...a};Object.assign(a,choices[0]);a.moveTick=s.tick+s.animalMoveTicks(a,from);}}
      continue;
    }
    a.threatId=null;
    if(s.animalTradeTravel?.(a))continue;
    const handler=s.pawns.find(p=>p.handleTask?.animalId===a.id&&p.handleTask.stage==='interact');
    if(handler){clearAnimal(a);a.phase='interact';a.reason=handler.reason;continue;}
    if(animalManagementTick(s,a)){s.animalCancelWork?.(a);continue;}
    if(s.animalCooperation?.(a))continue;
    // Danger, ropes and handlers interrupt work, preserving biological fullness.
    // A full egg may still be laid while starving; hunger only slows formation.
    if(layEggTick(s,a))continue;
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
    const choices=s.animalNeighbors(a,a).filter(n=>animalAllowed(s,a,position(n))&&recoveringDestination(s,a,position(n))&&!s.animals.some(b=>b!==a&&at(b)===n));
    if(choices.length){const from={...a};Object.assign(a,position(choices[Math.floor(random(s,a,1102)*choices.length)]));a.moveTick=s.tick+s.animalMoveTicks(a,from);}
    if(a.hunger>=65)a.reason='自由活动';
  }
}

function canHandle(p:Pawn){const h=healthSummary(p);return p.faction==='colony'&&!p.dead&&!p.downed&&!p.drafted&&p.carriedBy===null&&p.priorities.handle>0&&h.manipulation>0&&h.moving>.15;}
export function autoSlaughterTargets(s: Pick<HusbandryHost, 'autoSlaughter' | 'animals'>): number[] {
  return s.autoSlaughter ? autoSlaughterSelection(s.autoSlaughter, s.animals).targets : [];
}
/** Policies and population changes can revoke only automatic jobs. Manual
 * slaughter remains an explicit player instruction, independent of quotas. */
export function reconcileAutoSlaughter(s:HusbandryHost) {
  if(!s.pawns.some(p=>p.handleTask?.action==='autoSlaughter'))return;
  const selected=new Set(autoSlaughterTargets(s));
  for(const p of s.pawns) if(p.handleTask?.action==='autoSlaughter'&&!selected.has(p.handleTask.animalId)) {
    s.prisonRelease(p);p.reason='自动宰杀资格已改变，停止处理';
  }
}
function actionFor(a:WildAnimal,automatic:Set<number>):HandleTask['action']|null {
  if(a.faction==='wild')return a.tame?'tame':null;
  if(a.faction!=='colony')return null;
  return a.slaughter?'slaughter':a.releaseMarked?'release':automatic.has(a.id)?'autoSlaughter':a.hunger<30?'feed':a.species==='hare'&&a.tameness<5?'maintain':milkReady(a)?'milk':woolReady(a)?'shear':null;
}
function handlerRoute(p:Pawn,path:number[]){p.path=path;p.destination=path.at(-1)??null;p.phase='handle';}
export function tryHandle(s:HusbandryHost,p:Pawn):boolean {
  if(!canHandle(p)||p.cargo||p.food<30||p.rest<20)return false;
  const automatic=new Set(autoSlaughterTargets(s));
  for(const a of s.animals.filter(a=>!a.dead&&!a.medical.downed&&a.medical.carriedBy===null&&a.medical.bedId===null&&!s.pawns.some(p=>p.animalCareTask?.animalId===a.id)&&pawnAllowed(s,p,a)&&!s.pawns.some(p=>p.ropeTask?.animalId===a.id)&&s.tick>=a.retryTick&&a.phase!=='flee'&&
    !s.pawns.some(q=>q.handleTask?.animalId===a.id||q.animalTrainTask?.animalId===a.id)).sort((a,b)=>a.hunger-b.hunger)){
    const action=actionFor(a,automatic);if(!action)continue;
    if(['milk','shear'].includes(action)&&s.tick<a.nextInteractionTick)continue;
    if(['tame','maintain'].includes(action)&&(s.tick<a.nextInteractionTick||p.skills.animals.level<ANIMAL_HUSBANDRY[a.species].minSkill||a.phase==='rest'))continue;
    // Area filtering occurs before pathfinding, so rejecting a restricted worker
    // never puts the animal on the shared physical-unreachability retry timer.
    const path=s.prisonApproach(p,a);if(path===null){a.retryTick=s.tick+200;continue;}
    const foodNeeded=['tame','maintain','feed'].includes(action);
    let source:Stack|undefined,foodPath:number[]|null=null,amount=0;
    if(foodNeeded){
      for(const food of s.items.filter(f=>!f.forbidden&&pawnAllowed(s,p,f)&&(action==='feed'?edible(f,a):rawFeed(f,a)))){
        const n=animalFeedAmount(a.species,food.resource)*(action==='feed'?1:HUSBANDRY_RULES.feedings);
        if(n<=0||s.animalAvailable(food)<n)continue;
        const route=s.itemPath(p,food);if(route===null)continue;
        if(foodPath===null||route.length<foodPath.length){source=food;foodPath=route;amount=n;}
      }
      if(!source){a.reason='等待驯养员与可达的食物（驯服需要生粮）';continue;}
    }
    s.prisonRelease(p);
    p.handleTask={animalId:a.id,action,stage:source?'fetch':'approach',foodId:source?.id??null,amount,feedings:0,progress:0};
    handlerRoute(p,foodPath??path);p.reason=source?'取食物照料'+a.name:['slaughter','autoSlaughter'].includes(action)?'前往宰杀'+a.name:action==='milk'?'前往挤奶'+a.name:action==='shear'?'前往剪毛'+a.name:'前往放归'+a.name;
    return true;
  }
  return false;
}
export function handleTick(s:HusbandryHost,p:Pawn) {
  const task=p.handleTask;if(!task)return;
  const a=s.animals.find(a=>a.id===task.animalId);
  const cancel=(message:string)=>{s.prisonRelease(p);p.reason=message;};
  if(!a||a.dead||a.medical.downed||a.medical.carriedBy!==null||s.pawns.some(q=>q.animalCareTask?.animalId===a.id)||!canHandle(p)||p.food<12||p.rest<1||a.phase==='flee'||
    (task.action==='tame'?a.faction!=='wild'||!a.tame: a.faction!=='colony')||
    (task.action==='slaughter'&&!a.slaughter)||(task.action==='release'&&!a.releaseMarked)||
    (task.action==='autoSlaughter'&&!autoSlaughterTargets(s).includes(a.id))||
    (task.action==='shear'&&(!woolReady(a)||s.tick<a.nextInteractionTick||s.pawns.some(q=>q.ropeTask?.animalId===a.id)||autoSlaughterTargets(s).includes(a.id)))||
    (task.action==='milk'&&(!milkReady(a)||s.tick<a.nextInteractionTick||s.pawns.some(q=>q.ropeTask?.animalId===a.id)||autoSlaughterTargets(s).includes(a.id)))||
    (['tame','maintain'].includes(task.action)&&p.skills.animals.level<ANIMAL_HUSBANDRY[a.species].minSkill)){
    cancel('动物照料中断，保留未用食物');return;
  }
  if(!pawnAllowed(s,p,a)) {
    cancel('动物已在允许区域之外，保留未用食物');return;
  }
  if(task.stage==='fetch'){
    const food=s.items.find(i=>i.id===task.foodId);
    if(food?.forbidden){cancel('动物食物已被禁止，保留物品并重新安排');return;}
    if(!food||s.animalAvailable(food,p.id)<task.amount){cancel('食物已不可用，重新安排');return;}
    if(!pawnAllowed(s,p,food)){cancel('动物食物已在允许区域之外，重新安排');return;}
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
  if(task.action==='milk') {
    p.reason='正在给'+a.name+'挤奶';
    if(task.progress<MILK_RULES.work) {
      learnSkill(p.skills.animals,MILK_RULES.xpPerTick);
      const health=healthSummary(p);
      task.progress=Math.min(MILK_RULES.work,task.progress+milkGatherSpeed(p.skills.animals.level,health.manipulation,health.sight));
    }
    if(task.progress<MILK_RULES.work)return;
    // Web adaptation: reserve real capacity before the one outcome draw. Full
    // ground neither wastes milk nor rerolls or awards XP while waiting.
    if(!s.animalMilkPlace?.(p,MILK_RULES.amount,false)){p.reason='挤奶完成，等待附近放置空间';return;}
    const health=healthSummary(p),chance=milkGatherChance(p.skills.animals.level,health.manipulation,health.sight);
    const success=chance>=1||random(s,a,1110)<chance;
    if(success&&!s.animalMilkPlace(p,MILK_RULES.amount,true))return;
    a.milkFullness=0;
    event(s,success?'milked':'milkFailed',a,success?`${p.name}挤得${MILK_RULES.amount}份奶`:`${p.name}挤奶失败，这批奶损失了`,p.id);
    cancel(success?'挤奶完成':'挤奶失败');return;
  }
  if(task.action==='shear') {
    p.reason='正在给'+a.name+'剪毛';
    if(task.progress<WOOL_RULES.work) {
      learnSkill(p.skills.animals,WOOL_RULES.xpPerTick);
      const health=healthSummary(p);
      task.progress=Math.min(WOOL_RULES.work,task.progress+woolGatherSpeed(p.skills.animals.level,health.manipulation,health.sight));
    }
    if(task.progress<WOOL_RULES.work)return;
    // Web adaptation: reserve real capacity before the one outcome draw. Full
    // ground neither wastes wool nor rerolls or awards XP while waiting.
    if(!s.animalWoolPlace?.(p,WOOL_RULES.amount,false)){p.reason='剪毛完成，等待附近放置空间';return;}
    const health=healthSummary(p),chance=woolGatherChance(p.skills.animals.level,health.manipulation,health.sight);
    const success=chance>=1||random(s,a,1111)<chance;
    if(success&&!s.animalWoolPlace(p,WOOL_RULES.amount,true))return;
    a.woolGrowth=0;
    event(s,success?'sheared':'shearFailed',a,success?`${p.name}剪得${WOOL_RULES.amount}份羊驼毛`:`${p.name}剪毛失败，这批毛损失了`,p.id);
    cancel(success?'剪毛完成':'剪毛失败');return;
  }
  if(['tame','maintain','feed'].includes(task.action)){
    if(!p.cargo||(task.action==='feed'?!edible(p.cargo,a):!rawFeed(p.cargo,a))){cancel('携带食物不足');return;}
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
  p.reason=(task.action==='slaughter'?'正在宰杀':task.action==='autoSlaughter'?'按配额宰杀':'正在放归')+a.name;
  if(++task.progress<HUSBANDRY_RULES.slaughterWork)return;
  if(task.action==='release'&&a.cargo&&!s.animalDropCargo?.(a)){a.reason='等待放下携带物后再放归';return;}
  if(task.action==='slaughter'||task.action==='autoSlaughter'){event(s,'slaughter',a,`${p.name}${task.action==='autoSlaughter'?'按配额':''}宰杀了${a.name}`,p.id);s.killAnimal(a,'宰杀');}
  else{a.faction='wild';a.training.masterId=null;a.training.followDrafted=false;a.training.followFieldwork=false;Object.assign(a,initialAnimalPenState(s.tick));a.releaseMarked=false;a.slaughter=false;a.tame=false;a.tameness=0;clearAnimal(a);event(s,'release',a,`${p.name}将${a.name}放归野外`,p.id);}
  cancel('动物管理完成');
}
