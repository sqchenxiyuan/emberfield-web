import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, at, index, type Pos, type WildAnimal, type VoxelCommand } from '../src/voxel/types';
import { initialAnimalState, HUSBANDRY_RULES } from '../src/voxel/husbandry';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
const pos=(x:number,y=16,z=8):Pos=>({x,y,z});
function fixture(){
 const s=new VoxelSimulation(73129, {hilliness:'flat',meanTemperature:24,latitude:0}, false, 2) /* Controlled geometry: historical full visibility. */;
 s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];
 s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
 for(let x=10;x<=28;x++)for(let y=10;y<=22;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
 s.spawn=pos(12);
 for(const [i,p]of s.pawns.entries()){
   Object.assign(p,pos(12,16+i));p.schedule.fill('work');
   for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0;
 }
 s.pawns[0].priorities.handle=1;s.pawns[0].skills.animals.level=8;
 return VoxelSimulation.load(s.save());
}
function animal(s:VoxelSimulation,extra:Partial<WildAnimal>={}){
 const id=s.nextId++,a:WildAnimal={...pos(22),...initialAnimalState(id,'hare',s.tick),id,species:'hare',name:'野兔',
   health:ANIMAL_DEFS.hare.health,hunger:80,dead:false,phase:'roam',hunt:false,moveTick:0,decisionTick:1000000,
   fleeUntil:0,threatId:null,retryTick:0,rotProgress:0,...extra};s.animals.push(a);return a;
}
function command(s:VoxelSimulation,c:VoxelCommand){const r=s.command(c);expect(r.ok,r.message).toBe(true);}
function until(s:VoxelSimulation,predicate:()=>boolean,limit=2500){
 for(let i=0;i<limit&&!predicate();i++)s.step();
 expect(predicate(),JSON.stringify({tick:s.tick,animals:s.animals,pawns:s.pawns.map(p=>[p.reason,p.phase,p.handleTask,p.cargo])})).toBe(true);
}
function grain(s:VoxelSimulation,amount=30,p=pos(14)){
 s.items.push({...p,id:s.nextId++,resource:'grain',crop:'rice',rotProgress:0,amount});
}
describe('physical animal husbandry integration',()=>{
 it('fetches real grain, consumes one feeding, resumes it after load and cancels with the remainder intact',()=>{
   let s=fixture();const a=animal(s);grain(s);
   command(s,{type:'animalOrder',animalId:a.id,order:'tame',enabled:true});
   until(s,()=>s.pawns[0].handleTask?.feedings===1);
   expect(s.stats.consumed.grain).toBe(1);expect(s.counts().grain).toBe(29);
   const task=structuredClone(s.pawns[0].handleTask);s=VoxelSimulation.load(s.save());
   expect(s.pawns[0].handleTask).toEqual(task);expect(s.pawns[0].cargo?.amount).toBe(1);
   command(s,{type:'animalOrder',animalId:a.id,order:'tame',enabled:false});
   expect(s.pawns[0].handleTask).toBeNull();expect(s.pawns[0].cargo?.amount).toBe(1);
   s.step(100);expect(s.stats.consumed.grain).toBe(1);expect(s.counts().grain).toBe(29);
   expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
 });
 it('does not begin taming without enough physical food or sufficient handling skill',()=>{
   const s=fixture(),a=animal(s);grain(s,1);
   command(s,{type:'animalOrder',animalId:a.id,order:'tame',enabled:true});s.step(100);
   expect(s.pawns[0].handleTask).toBeNull();expect(s.stats.consumed.grain).toBe(0);
   grain(s,10,pos(15));s.pawns[0].skills.animals.level=7;s.step(100);
   expect(s.pawns[0].handleTask).toBeNull();expect(s.stats.consumed.grain).toBe(0);
 });
 it('releases a feeding reservation atomically when a trade removes its ground stack',()=>{
   const s=fixture(),a=animal(s);grain(s,12,pos(18));
   command(s,{type:'animalOrder',animalId:a.id,order:'tame',enabled:true});until(s,()=>s.pawns[0].handleTask?.stage==='fetch');
   const id=s.pawns[0].handleTask!.foodId;
   s.tradeApplyPlacement({items:s.items.filter(i=>i.id!==id),nextId:s.nextId});
   expect(s.pawns[0].handleTask).toBeNull();expect(s.pawns[0].phase).toBe('idle');
   expect(s.stats.consumed.grain).toBe(0);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
 });
 it('makes hunting and taming mutually exclusive and releases a handler when hunting is selected',()=>{
   const s=fixture(),a=animal(s);grain(s);
   command(s,{type:'animalOrder',animalId:a.id,order:'tame',enabled:true});until(s,()=>!!s.pawns[0].handleTask);
   command(s,{type:'hunt',animalId:a.id,enabled:true});
   expect(a.tame).toBe(false);expect(a.hunt).toBe(true);expect(s.pawns[0].handleTask).toBeNull();
   command(s,{type:'animalOrder',animalId:a.id,order:'tame',enabled:true});expect(a.hunt).toBe(false);
 });
 it('feeds an enclosed domestic animal through the actual fetch/carry/adjacent interaction chain',()=>{
   let s=fixture();const a=animal(s,{faction:'colony',tameness:5,hunger:5});grain(s,10);
   until(s,()=>s.husbandryLog.some(e=>e.kind==='fed'));
   expect(s.stats.consumed.grain).toBeGreaterThan(0);expect(a.hunger).toBeGreaterThan(20);
   expect(s.counts().grain+s.stats.consumed.grain).toBe(10);
   s=VoxelSimulation.load(s.save());expect(s.animals[0].faction).toBe('colony');
 });
 it('walks to ground food and consumes it, while a stone floor provides no nutrition',()=>{
   const s=fixture();s.pawns[0].priorities.handle=0;const a=animal(s,{hunger:40,decisionTick:0});
   s.step(200);expect(a.hunger).toBeLessThan(40);expect(s.stats.consumed.grain).toBe(0);
   grain(s,8,pos(23));until(s,()=>s.stats.consumed.grain>0);
   expect(a.hunger).toBeGreaterThan(40);expect(s.counts().grain+s.stats.consumed.grain).toBe(8);
 });
 it('consumes finite grass and cannot obtain food from a depleted patch',()=>{
   const s=fixture();s.pawns[0].priorities.handle=0;const a=animal(s,{hunger:30,decisionTick:0});
   s.blocks[index(a.x,a.y,7)]=Block.Soil;s.grass=[{...a,growth:.5}].map(({x,y,z,growth})=>({x,y,z,growth}));
   until(s,()=>s.grass[0].growth<.1,100);
   expect(a.hunger).toBeGreaterThan(30);const after=a.hunger;s.step(70);expect(a.hunger).toBeLessThan(after);
 });
 it('only uses animal-legal door and height edges',()=>{
   const s=fixture(),a=animal(s);s.doors.push({...pos(23),id:s.nextId++,axis:'x',mode:'auto',openUntil:0});
   expect(s.animalNeighbors(a,a)).not.toContain(at(pos(23)));
   a.faction='colony';a.tameness=5;expect(s.animalNeighbors(a,a)).toContain(at(pos(23)));
   a.species='deer';expect(s.animalNeighbors(a,a)).not.toContain(at(pos(23)));
   s.doors[0].mode='open';expect(s.animalNeighbors(a,a)).toContain(at(pos(23)));
   s.ladders[at(pos(23))]=1;expect(s.animalNeighbors(a,a)).not.toContain(at(pos(23)));
 });
 it('has adult same-species animals approach, mate and persist a real pregnancy',()=>{
   const s=fixture();s.pawns[0].priorities.handle=0;
   const male=animal(s,{faction:'colony',tameness:5,sex:'male',nextMateTick:0,decisionTick:0});
   const female=animal(s,{...pos(25),faction:'colony',tameness:5,sex:'female'});
   until(s,()=>!!female.pregnancy,DAY/2);
   expect(female.pregnancy?.fatherId).toBe(male.id);expect(s.husbandryLog.some(e=>e.kind==='pregnancy')).toBe(true);
   expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
 });
 it('birth creates one real juvenile and waits if all neighboring birth positions are occupied',()=>{
   const s=fixture();s.pawns[0].priorities.handle=0;
   const male=animal(s,{...pos(26),faction:'colony',tameness:5,sex:'male'});
   const mother=animal(s,{faction:'colony',tameness:5,sex:'female',pregnancy:{fatherId:male.id,progress:1}});
   const blockers=s.animalNeighbors(mother,mother).map(cell=>animal(s,{...{x:cell%64,y:Math.floor(cell/64)%64,z:Math.floor(cell/4096)},decisionTick:1000000}));
   s.step();expect(mother.pregnancy?.progress).toBe(1);expect(s.husbandryLog.filter(e=>e.kind==='birth')).toHaveLength(0);
   s.animals=s.animals.filter(a=>a!==blockers[0]);s.step();
   const born=s.husbandryLog.find(e=>e.kind==='birth')!;
   expect(born).toBeDefined();const child=s.animals.find(a=>a.id===born.otherId)!;
   expect(child.faction).toBe('colony');expect(child.growth).toBe(0);expect(child.ageTicks).toBe(0);
   expect(mother.pregnancy).toBeNull();s.step(2);expect(s.husbandryLog.filter(e=>e.kind==='birth')).toHaveLength(1);
   expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
 });
 it('replans from a sloped neighboring tile to a same-floor mating position',()=>{
   const s=fixture();s.pawns[0].priorities.handle=0;s.blocks[index(23,16,8)]=Block.Stone;
   const male=animal(s,{...pos(23,16,9),faction:'colony',tameness:5,sex:'male',nextMateTick:0,decisionTick:0});
   const female=animal(s,{faction:'colony',tameness:5,sex:'female'});
   until(s,()=>!!female.pregnancy,DAY);
   expect(male.z).toBe(female.z);expect(female.pregnancy?.fatherId).toBe(male.id);
 });
 it('slaughter produces one identified carcass; release preserves the living animal identity',()=>{
   let s=fixture();const a=animal(s,{faction:'colony',tameness:5});
   command(s,{type:'animalOrder',animalId:a.id,order:'slaughter',enabled:true});until(s,()=>s.stats.produced.carcass===1);
   s.step(2);expect(s.items.filter(i=>i.carcass?.animalId===a.id)).toHaveLength(1);expect(s.stats.produced.carcass).toBe(1);
   s=VoxelSimulation.load(s.save());const b=animal(s,{faction:'colony',tameness:5});
   command(s,{type:'animalOrder',animalId:b.id,order:'release',enabled:true});until(s,()=>b.faction==='wild');
   expect(b.id).toBe(s.animals[0].id);expect(b.tameness).toBe(0);expect(s.stats.produced.carcass).toBe(1);
 });
 it('starvation cancels pregnancy and eventually produces only one carcass',()=>{
   const s=fixture();s.pawns[0].priorities.handle=0;
   const father=animal(s,{...pos(26),sex:'male'});
   const a=animal(s,{sex:'female',hunger:0,malnutrition:HUSBANDRY_RULES.miscarriageSeverity,
     pregnancy:{fatherId:father.id,progress:.5}});s.step();
   expect(a.pregnancy).toBeNull();expect(s.husbandryLog.some(e=>e.kind==='miscarriage')).toBe(true);
   a.malnutrition=.99999;s.step(2);expect(s.stats.produced.carcass).toBe(1);
   s.step(10);expect(s.stats.produced.carcass).toBe(1);
 });
});
