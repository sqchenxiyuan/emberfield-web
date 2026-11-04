import { describe, expect, it, vi } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { advanceMilk, milkActive, milkReady, milkGatherSpeed, milkGatherChance, MILK_RULES } from '../src/voxel/animalMilk';
import { initialAnimalState, animalFeedAmount } from '../src/voxel/husbandry';
import { initialPenFilter, penAcceptsAnimal } from '../src/voxel/pens';
import { defaultAutoSlaughterPolicy } from '../src/voxel/autoSlaughter';
import { freshBatch } from '../src/voxel/preservation';
import { Block, DAY, index, type Pos, type WildAnimal } from '../src/voxel/types';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { handleTick } from '../src/voxel/husbandryWorld';
import { plantRandom } from '../src/voxel/plants';
import { stripAnimalMilkFields } from './legacy-auto-rebuild-defaults';

const pos = (x: number, y = 16): Pos => ({x,y,z:8});
function animal(id=100, extra: Partial<WildAnimal>={}): WildAnimal {
  return {...pos(22), ...initialAnimalState(id,'dromedary',0), id, species:'dromedary', name:ANIMAL_DEFS.dromedary.name,
    faction:'colony', tameness:5, sex:'female', health:100, hunger:90, dead:false, phase:'roam', hunt:false,
    moveTick:0, decisionTick:1e6, fleeUntil:0, threatId:null, retryTick:0, rotProgress:0, ...extra};
}
/** Controlled geometry/actors isolate boundaries; authentic generated-colony
 * coverage lives in the separate public-command campaign. */
function fixture(fullness=1) {
  const s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=28;x++)for(let y=10;y<=22;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p]of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i));p.schedule.fill('work');
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0;
  }
  s.pawns[0].priorities.handle=1;s.pawns[0].skills.animals.level=9;
  s.animals.push(animal(s.nextId++,{milkFullness:fullness}));
  return VoxelSimulation.load(s.save());
}
function until(s:VoxelSimulation,check:()=>boolean,limit=1800) {
  for(let n=0;n<limit&&!check();n++)s.step();
  expect(check(),JSON.stringify(s.pawns.map(p=>({reason:p.reason,task:p.handleTask})))).toBe(true);
}

describe('animal milk biology and gather rules',()=>{
  it('accumulates only adult domestic females without a pregnancy prerequisite',()=>{
    const a=animal();expect(a.pregnancy).toBeNull();expect(milkActive(a)).toBe(true);
    advanceMilk(a);expect(a.milkFullness).toBeCloseTo(1/(2*DAY),12);
    for(const extra of [{faction:'wild'},{sex:'male'},{growth:.99},{dead:true,health:0},{species:'deer'},{species:'hare'}] as Partial<WildAnimal>[]) {
      const inactive=animal(100,{...extra,milkFullness:.4});advanceMilk(inactive);expect(inactive.milkFullness).toBe(.4);
    }
  });
  it('uses hunger multipliers, caps stored fullness, and never treats milk as herbivore feed',()=>{
    for(const [hunger,multiplier]of [[90,1],[30,.5],[10,.25],[0,0]]){
      const a=animal(100,{hunger});advanceMilk(a);expect(a.milkFullness).toBe(multiplier/MILK_RULES.intervalTicks);
    }
    const a=animal(100,{milkFullness:1});advanceMilk(a);expect(a.milkFullness).toBe(1);
    expect(animalFeedAmount('dromedary','milk')).toBe(0);expect(animalFeedAmount('dromedary','grain')).toBe(6);
  });
  it('uses skill and capacities for speed and success probability, with no above-one bonus milk',()=>{
    expect(milkGatherSpeed(0)).toBe(.1);expect(milkGatherSpeed(8)).toBe(1);
    expect(milkGatherChance(0)).toBe(.6);expect(milkGatherChance(8)).toBe(1);expect(milkGatherChance(20)).toBe(1);
    expect(milkGatherChance(8,.5,.5)).toBeCloseTo(.765);
    expect(milkGatherSpeed(8,.5,.5)).toBe(.375);
    expect(()=>milkGatherChance(21)).toThrow();expect(()=>milkGatherSpeed(8,NaN)).toThrow();
  });
  it('gives new desert wildlife a real milk species and keeps old temperate population unchanged',()=>{
    const desert=new VoxelSimulation(73129,{biome:'desert'});
    expect(desert.animals.some(a=>a.species==='dromedary')).toBe(true);
    expect(desert.animals.every(a=>a.faction==='wild'&&a.milkFullness===0)).toBe(true);
    const temperate=new VoxelSimulation(73129);expect(temperate.animals.some(a=>a.species==='dromedary')).toBe(false);
  });
  it('supports camel pen species filters and independent slaughter quotas',()=>{
    const a=animal(),marker={...pos(22),id:101,name:'测试圈地',filter:initialPenFilter()};
    expect(penAcceptsAnimal(marker,a)).toBe(true);marker.filter.dromedary=false;expect(penAcceptsAnimal(marker,a)).toBe(false);
    const s=fixture();const result=s.command({type:'autoSlaughter',species:'dromedary',policy:{...defaultAutoSlaughterPolicy(),female:0}});
    expect(result.ok).toBe(true);expect(s.snapshot().autoSlaughterStatus.targets).toEqual([s.animals[0].id]);
  });
});

describe('physical milking and persistence',()=>{
  it('walks, works, reloads fractional progress and produces one ordinary batch near the handler',()=>{
    let s=fixture();const id=s.animals[0].id,start={...s.pawns[0]};
    until(s,()=> (s.pawns[0].handleTask?.progress??0)>90);
    expect(s.pawns[0].x).not.toBe(start.x);expect(s.stats.produced.milk).toBe(0);
    const task=structuredClone(s.pawns[0].handleTask);expect(task?.action).toBe('milk');expect(Number.isInteger(task?.progress)).toBe(false);
    s=VoxelSimulation.load(s.save());expect(s.pawns[0].handleTask).toEqual(task);
    until(s,()=>s.stats.produced.milk===18);expect(s.counts().milk).toBe(18);
    expect(s.animals.find(a=>a.id===id)?.milkFullness).toBeLessThan(.001);
    const item=s.items.find(i=>i.resource==='milk')!;expect(item.rotProgress).toBeDefined();
    expect(Math.abs(item.x-s.pawns[0].x)+Math.abs(item.y-s.pawns[0].y)).toBeLessThanOrEqual(6);
    s=VoxelSimulation.load(s.save());s.step(60);expect(s.stats.produced.milk).toBe(18);expect(s.counts().milk).toBe(18);
  });
  it('interrupts on draft and preserves fullness, while a new task starts its work over',()=>{
    const s=fixture();until(s,()=> (s.pawns[0].handleTask?.progress??0)>100);
    expect(s.command({type:'draft',pawnId:s.pawns[0].id,drafted:true}).ok).toBe(true);
    expect(s.pawns[0].handleTask).toBeNull();s.step(30);expect(s.animals[0].milkFullness).toBe(1);expect(s.stats.produced.milk).toBe(0);
    expect(s.command({type:'draft',pawnId:s.pawns[0].id,drafted:false}).ok).toBe(true);
    until(s,()=>s.pawns[0].handleTask?.action==='milk');expect(s.pawns[0].handleTask!.progress).toBeLessThan(100);
  });
  it('allows a low-skilled milker, enforces exclusive interaction and daily eligibility',()=>{
    const s=fixture();s.pawns[0].skills.animals.level=0;s.pawns[1].priorities.handle=1;
    s.animals[0].nextInteractionTick=40;s.step(39);expect(s.pawns.some(p=>p.handleTask)).toBe(false);
    s.pawns[1].priorities.handle=0;until(s,()=>!!s.pawns[0].handleTask);
    s.pawns[1].priorities.handle=1;s.step(80);
    expect(s.pawns.filter(p=>p.handleTask?.animalId===s.animals[0].id)).toHaveLength(1);
    expect(s.pawns[0].handleTask?.action).toBe('milk');expect(s.pawns[0].skills.animals.level).toBe(0);
  });
  it('waits for actual placement capacity without repeated experience or destroying milk',()=>{
    const s=fixture();const original=s.animalMilkPlace.bind(s),place=vi.spyOn(s,'animalMilkPlace').mockReturnValue(false);
    until(s,()=>s.pawns[0].handleTask?.progress===400);
    const xp=s.pawns[0].skills.animals.xp;s.step(20);expect(s.pawns[0].skills.animals.xp).toBe(xp);
    expect(s.animals[0].milkFullness).toBe(1);expect(s.stats.produced.milk).toBe(0);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();place.mockImplementation(original);
    s.step();expect(s.stats.produced.milk).toBe(18);expect(s.pawns[0].handleTask).toBeNull();
  });
  it('loses the entire gathered batch on failure and does not create or consume a physical milk stack',()=>{
    const s=fixture(),a=s.animals[0],p=s.pawns[0];p.skills.animals.level=0;Object.assign(p,pos(a.x-1,a.y));
    while(plantRandom(s.seed,a.id,s.tick,1110)<.6)s.tick++;
    p.phase='handle';p.handleTask={animalId:a.id,action:'milk',stage:'interact',foodId:null,amount:0,feedings:0,progress:400};
    handleTick(s,p);expect(a.milkFullness).toBe(0);expect(p.handleTask).toBeNull();
    expect(s.stats.produced.milk).toBe(0);expect(s.stats.consumed.milk).toBe(0);expect(s.counts().milk).toBe(0);
    expect(s.husbandryLog.at(-1)?.kind).toBe('milkFailed');expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('makes physical placement atomic and honors a full ground area',()=>{
    const s=fixture(),p=s.pawns[0];
    for(let x=10;x<=28;x++)for(let y=10;y<=22;y++)s.items.push({...pos(x,y),...freshBatch('wood',75),id:s.nextId++});
    const before=structuredClone(s.items),nextId=s.nextId;
    expect(s.animalMilkPlace(p,18,false)).toBe(false);expect(s.animalMilkPlace(p,18,true)).toBe(false);
    expect(s.items).toEqual(before);expect(s.nextId).toBe(nextId);expect(s.stats.produced.milk).toBe(0);
    s.items=s.items.filter(i=>i.x!==p.x||i.y!==p.y);expect(s.animalMilkPlace(p,18,false)).toBe(true);
    expect(s.stats.produced.milk).toBe(0);expect(s.animalMilkPlace(p,18,true)).toBe(true);expect(s.counts().milk).toBe(18);
  });
  it('cancels milk when a release or automatic slaughter order takes priority',()=>{
    for(const slaughter of [false,true]){
      const s=fixture();until(s,()=> (s.pawns[0].handleTask?.progress??0)>40);
      const result=slaughter?s.command({type:'autoSlaughter',species:'dromedary',policy:{...defaultAutoSlaughterPolicy(),total:0}}):
        s.command({type:'animalOrder',animalId:s.animals[0].id,order:'release',enabled:true});
      expect(result.ok).toBe(true);s.step();expect(s.pawns[0].handleTask?.action).not.toBe('milk');expect(s.stats.produced.milk).toBe(0);
    }
  });
  it('consumes raw milk in nutrition-sized portions without an ateRaw memory',()=>{
    const s=fixture(0);s.pawns[0].priorities.handle=0;s.pawns[0].food=35;
    s.items.push({...pos(14),...freshBatch('milk',18),id:s.nextId++});
    until(s,()=>s.stats.consumed.milk>0);expect(s.stats.consumed.milk).toBeGreaterThan(1);
    expect(s.pawns[0].psyche.memories.some(m=>m.kind==='ateRaw')).toBe(false);
    expect(s.counts().milk+s.stats.consumed.milk+s.stats.spoiled.milk+s.stats.destroyed.milk).toBe(18);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('cooks a real mixture of meat, milk and grain exactly once across an in-progress reload',()=>{
    let s=fixture(0);s.pawns[0].priorities.handle=0;s.pawns[0].priorities.cook=1;
    for(const [i,[resource,amount]]of (['meat','milk','grain','wood'] as const).map((r,i)=>[r,[3,4,3,1][i]] as const).entries())
      s.items.push({...pos(14+i),...freshBatch(resource,amount),id:s.nextId++});
    s.stoves.push({...pos(12,14),id:s.nextId++,target:1,paused:false});s=VoxelSimulation.load(s.save());
    until(s,()=>s.jobs.some(j=>j.kind==='cook'&&(j.delivered.milk??0)>0));
    s=VoxelSimulation.load(s.save());until(s,()=>s.stats.cooked===1);
    expect([s.stats.consumed.meat,s.stats.consumed.milk,s.stats.consumed.grain]).toEqual([3,4,3]);
    expect(s.counts().meal).toBe(1);expect(s.counts().milk).toBe(0);s.step(60);expect(s.stats.cooked).toBe(1);
  });
  it('migrates authentic schema shape defaults and rejects smuggled fields before old migrations',()=>{
    // Boreal generation contains only species representable by this synthetic v48 input.
    const s=new VoxelSimulation(73129,{biome:'boreal'}),raw=s.save() as any;stripAnimalMilkFields(raw);raw.version=48;
    const migrated=VoxelSimulation.load(raw).save();expect(migrated.version).toBe(56);
    expect(migrated.animals.every(a=>a.milkFullness===0)).toBe(true);expect(migrated.stats.produced.milk).toBe(0);
    expect(migrated.stockpiles.map(p=>p.accepts)).toEqual(raw.stockpiles.map((p:any)=>p.accepts));
    for(const mutate of [(d:any)=>d.animals[0].milkFullness=0,(d:any)=>d.stats.produced.milk=0,
      (d:any)=>d.autoSlaughter.dromedary=defaultAutoSlaughterPolicy(),(d:any)=>d.pawns[0].handleTask={action:'milk'},
      (d:any)=>d.stockpiles[0].accepts.push('milk')]){
      const bad=structuredClone(raw);mutate(bad);expect(()=>VoxelSimulation.load(bad)).toThrow(/旧版本/);
    }
  });
  it('rejects missing, impossible or nonfinite fullness and invalid gather progress',()=>{
    const s=fixture(),raw=s.save();
    for(const fullness of [-1,1.01,NaN,Infinity,undefined]){
      const bad=structuredClone(raw);bad.animals[0].milkFullness=fullness as number;expect(()=>VoxelSimulation.load(bad)).toThrow();
    }
    const male=structuredClone(raw);male.animals[0].sex='male';expect(()=>VoxelSimulation.load(male)).toThrow();
    until(s,()=> (s.pawns[0].handleTask?.progress??0)>10);
    for(const progress of [-1,400.01,NaN,Infinity]){
      const bad=s.save();bad.pawns[0].handleTask!.progress=progress;expect(()=>VoxelSimulation.load(bad)).toThrow();
    }
    expect(milkReady(animal(100,{milkFullness:1,releaseMarked:true}))).toBe(false);
  });
});
