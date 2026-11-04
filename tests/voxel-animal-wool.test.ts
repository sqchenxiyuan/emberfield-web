import { describe, expect, it, vi } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { advanceWool, woolActive, woolReady, WOOL_RULES } from '../src/voxel/animalWool';
import { initialAnimalState } from '../src/voxel/husbandry';
import { handleTick } from '../src/voxel/husbandryWorld';
import { freshBatch } from '../src/voxel/preservation';
import { initialPenFilter, penAcceptsAnimal } from '../src/voxel/pens';
import { plantRandom } from '../src/voxel/plants';
import { apparelStats, TAILOR_KINDS } from '../src/voxel/apparel';
import { healthSummary } from '../src/voxel/survival';
import { Block, DAY, index, type Pos, type VoxelCommand, type WildAnimal } from '../src/voxel/types';
import { stripAnimalWoolFields } from './legacy-auto-rebuild-defaults';

const pos = (x: number, y = 16): Pos => ({x,y,z:8});
function alpaca(id=100, extra: Partial<WildAnimal>={}): WildAnimal {
  return {...pos(22), ...initialAnimalState(id,'alpaca',0), id, species:'alpaca', name:'羊驼',
    faction:'colony', tameness:5, sex:'male', health:75, hunger:90, dead:false, phase:'roam', hunt:false,
    moveTick:0, decisionTick:1e6, fleeUntil:0, threatId:null, retryTick:0, rotProgress:0, ...extra};
}
/** Explicit controlled geometry and mature animal fixture, not a natural colony
 * campaign. State changes after setup use the simulation and public commands. */
function fixture(growth=1) {
  const s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=28;x++)for(let y=10;y<=24;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p]of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i));p.schedule.fill('work');p.food=100;p.rest=100;
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0;
  }
  s.pawns[0].priorities.handle=1;s.pawns[0].skills.animals.level=9;
  s.pawns[0].skills.crafting.level=10;
  s.animals.push(alpaca(s.nextId++,{woolGrowth:growth}));
  return VoxelSimulation.load(s.save());
}
function command(s:VoxelSimulation,c:VoxelCommand) {const r=s.command(c);expect(r.ok,r.message).toBe(true);}
function until(s:VoxelSimulation,done:()=>boolean,max=6000) {
  for(let i=0;i<max&&!done();i++)s.step();
  expect(done(),JSON.stringify({tick:s.tick,jobs:s.jobs.map(j=>({kind:j.kind,cost:j.cost,reason:j.reason})),
    pawns:s.pawns.map(p=>({reason:p.reason,task:p.handleTask,cargo:p.cargo?.resource}))})).toBe(true);
}

describe('alpaca wool biology and physical shearing',()=>{
  it('grows on adult colony males and females, pauses when ineligible and keeps stored growth',()=>{
    for(const sex of ['male','female'] as const) {const a=alpaca(100,{sex});expect(woolActive(a)).toBe(true);advanceWool(a);expect(a.woolGrowth).toBe(1/(10*DAY));}
    for(const extra of [{faction:'wild'},{growth:.99},{dead:true,health:0},{species:'dromedary'},{species:'deer'}] as Partial<WildAnimal>[]) {
      const a=alpaca(100,{...extra,woolGrowth:.4});advanceWool(a);expect(a.woolGrowth).toBe(.4);
    }
    const a=alpaca();for(let n=0;n<=WOOL_RULES.intervalTicks;n++)advanceWool(a);
    expect(a.woolGrowth).toBe(1);advanceWool(a);expect(a.woolGrowth).toBe(1);
    for(const [hunger,multiplier]of [[90,1],[30,.5],[10,.25],[0,0]]) {
      const a=alpaca(100,{hunger});advanceWool(a);expect(a.woolGrowth).toBe(multiplier/WOOL_RULES.intervalTicks);
    }
  });
  it('generates real temperate alpacas and supports their independent pen filter',()=>{
    const s=new VoxelSimulation(73129);expect(s.animals.some(a=>a.species==='alpaca')).toBe(true);
    expect(s.animals.every(a=>a.woolGrowth===0&&a.faction==='wild')).toBe(true);
    const marker={...pos(22),id:101,name:'牧场',filter:initialPenFilter()};
    expect(penAcceptsAnimal(marker,alpaca())).toBe(true);marker.filter.alpaca=false;
    expect(penAcceptsAnimal(marker,alpaca())).toBe(false);
  });
  it('walks, reserves exclusively, retains biological growth on interruption and resumes exact work on load',()=>{
    let s=fixture();s.pawns[1].priorities.handle=1;
    const start=s.pawns[0].x;
    until(s,()=>s.pawns.some(p=>(p.handleTask?.progress??0)>35));
    expect(s.pawns.filter(p=>p.handleTask?.action==='shear')).toHaveLength(1);
    const p=s.pawns.find(p=>p.handleTask)!;expect(p.x).not.toBe(start);
    const progress=p.handleTask!.progress;
    s=VoxelSimulation.load(s.save());expect(s.pawns.find(q=>q.id===p.id)!.handleTask!.progress).toBe(progress);
    command(s,{type:'draft',pawnId:p.id,drafted:true});
    expect(s.animals[0].woolGrowth).toBe(1);expect(s.stats.produced.alpacaWool).toBe(0);
    command(s,{type:'draft',pawnId:p.id,drafted:false});
    until(s,()=>s.stats.produced.alpacaWool>0);
    expect(s.stats.produced.alpacaWool).toBe(45);expect(s.counts().alpacaWool).toBe(45);
    expect(s.animals[0].woolGrowth).toBe(0);s=VoxelSimulation.load(s.save());s.step(50);
    expect(s.stats.produced.alpacaWool).toBe(45);expect(s.animals[0].woolGrowth).toBeGreaterThan(0);
  });
  it('does not require taming skill for shearing and wastes a failed batch without inventing physical wool',()=>{
    const s=fixture(),a=s.animals[0],p=s.pawns[0];p.skills.animals.level=0;Object.assign(p,pos(a.x-1,a.y));
    while(plantRandom(s.seed,a.id,s.tick,1111)<.6)s.tick++;
    p.phase='handle';p.handleTask={animalId:a.id,action:'shear',stage:'interact',foodId:null,amount:0,feedings:0,progress:WOOL_RULES.work};
    handleTick(s,p);expect(a.woolGrowth).toBe(0);expect(p.handleTask).toBeNull();
    expect(s.stats.produced.alpacaWool).toBe(0);expect(s.stats.consumed.alpacaWool).toBe(0);
    expect(s.husbandryLog.at(-1)?.kind).toBe('shearFailed');expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('waits for atomic output capacity without rerolling, repeated XP or erasing wool',()=>{
    const s=fixture(),original=s.animalWoolPlace.bind(s),place=vi.spyOn(s,'animalWoolPlace').mockReturnValue(false);
    until(s,()=>s.pawns[0].handleTask?.progress===WOOL_RULES.work);
    const xp=structuredClone(s.pawns[0].skills.animals);s.step(10);
    expect(s.pawns[0].skills.animals).toEqual(xp);expect(s.animals[0].woolGrowth).toBe(1);
    expect(s.stats.produced.alpacaWool).toBe(0);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
    place.mockImplementation(original);s.step();expect(s.stats.produced.alpacaWool).toBe(45);
  });
  it('rejects missing or impossible biological progress and malformed gathering tasks',()=>{
    const s=fixture();for(const growth of [-1,1.01,NaN,Infinity,undefined]) {
      const d=s.save();d.animals[0].woolGrowth=growth as number;expect(()=>VoxelSimulation.load(d)).toThrow();
    }
    const bad=s.save();bad.animals[0].species='deer';expect(()=>VoxelSimulation.load(bad)).toThrow();
    until(s,()=> (s.pawns[0].handleTask?.progress??0)>20);
    for(const progress of [-1,1700.1,NaN]) {const d=s.save();d.pawns[0].handleTask!.progress=progress;expect(()=>VoxelSimulation.load(d)).toThrow();}
    expect(woolReady(alpaca(100,{woolGrowth:1,releaseMarked:true}))).toBe(false);
  });
  it('migrates old defaults without changing selections and rejects disguised new state before migration',()=>{
    const raw:any=new VoxelSimulation(73129,{biome:'boreal'}).save();stripAnimalWoolFields(raw);raw.version=49;
    const loaded=VoxelSimulation.load(raw).save();expect(loaded.version).toBe(54);
    expect(loaded.animals.every(a=>a.woolGrowth===0)).toBe(true);expect(loaded.stats.produced.alpacaWool).toBe(0);
    expect(loaded.stockpiles.map(s=>s.accepts)).toEqual(raw.stockpiles.map((s:any)=>s.accepts));
    for(const change of [(d:any)=>d.animals[0].woolGrowth=0,(d:any)=>d.stats.produced.alpacaWool=0,
      (d:any)=>d.pawns[0].handleTask={action:'shear'},(d:any)=>d.pawns[0].worn[0].material='alpacaWool',
      (d:any)=>d.stockpiles[0].accepts.push('alpacaWool'),(d:any)=>d.productionQueues=[{bills:[{policy:{allowedTextiles:['cloth']}}]}]]) {
      const bad=structuredClone(raw);change(bad);const before=structuredClone(bad);
      expect(()=>VoxelSimulation.load(bad)).toThrow(/旧版本/);expect(bad).toEqual(before);
    }
  });
  it('preserves cloth-only choices even on an old tailor with implicit legacy bills',()=>{
    const s=fixture(0);s.animals=[];const raw:any=s.save();
    raw.tailors.push({...pos(16,20),id:raw.nextId++,axis:'x',bills:TAILOR_KINDS.map(kind=>({kind,target:0,paused:false}))});
    stripAnimalWoolFields(raw);raw.version=49;
    const loaded=VoxelSimulation.load(raw);
    const queue=loaded.snapshot().productionQueues.find(q=>q.benchId===raw.tailors[0].id)!;
    expect(queue.bills).toHaveLength(5);expect(queue.bills.every(b=>b.policy.allowedTextiles.join() === 'cloth')).toBe(true);
    expect(VoxelSimulation.load(loaded.save()).snapshot().productionQueues).toEqual(loaded.snapshot().productionQueues);
  });
});

describe('shearing to usable material-specific clothing',()=>{
  it('shears physical wool, makes a bench, hauls ingredients, preserves UFT across reload and wears the resulting garment',()=>{
    let s=fixture();s.items.push({...pos(13,14),...freshBatch('wood',75),id:s.nextId++});
    s.pawns[0].priorities.build=1;s.pawns[0].priorities.craft=1;
    command(s,{type:'designate',tool:'tailor',from:pos(16,20),axis:'x'});
    until(s,()=>s.tailors.length===1&&s.stats.produced.alpacaWool===45);
    const benchId=s.tailors[0].id;
    command(s,{type:'productionBillAdd',benchId,recipe:'tailoring:tuque'});
    let bill=s.productionQueues.find(q=>q.benchId===benchId)!.bills.at(-1)!;
    command(s,{type:'productionBillUpdate',benchId,billId:bill.id,patch:{mode:'count',remaining:1,policy:{...bill.policy,allowedTextiles:['alpacaWool']}}});
    until(s,()=>s.items.some(i=>i.unfinished&&i.unfinished.progress>20));
    const u=s.items.find(i=>i.unfinished)!.unfinished!;
    expect(u.ingredients).toMatchObject([{resource:'alpacaWool',amount:20}]);
    expect(s.stats.consumed.alpacaWool).toBe(0);
    const snapshot=structuredClone(u);s=VoxelSimulation.load(s.save());
    expect(s.items.find(i=>i.unfinished)?.unfinished).toEqual(snapshot);
    // Current bill filters may change; already enclosed material keeps its identity.
    bill=s.productionQueues.find(q=>q.benchId===benchId)!.bills.find(b=>b.id===bill.id)!;
    command(s,{type:'productionBillUpdate',benchId,billId:bill.id,patch:{policy:{...bill.policy,allowedTextiles:['cloth']}}});
    until(s,()=>s.stats.tailored===1);
    const item=s.items.find(i=>i.apparel?.kind==='tuque')!,piece=item.apparel!;
    expect(piece.material).toBe('alpacaWool');expect(s.stats.consumed.alpacaWool).toBe(20);
    expect(s.stats.consumed.cloth).toBe(0);expect(s.counts().alpacaWool).toBe(25);
    const p=s.pawns[0],comfortable=healthSummary(p).comfortableMin;
    command(s,{type:'wear',pawnId:p.id,apparelId:piece.id});
    until(s,()=>p.worn.some(a=>a.id===piece.id));
    expect(healthSummary(p).comfortableMin).toBeCloseTo(comfortable-apparelStats(piece).cold);
    s=VoxelSimulation.load(s.save());s.step(50);
    expect(s.pawns[0].worn.find(a=>a.id===piece.id)?.material).toBe('alpacaWool');
    expect(s.stats.tailored).toBe(1);expect(s.stats.produced.alpacaWool).toBe(45);
  },30000);
  it('does not mix insufficient cloth and wool, and waits on an empty textile filter',()=>{
    let s=fixture(0);s.pawns[0].priorities.handle=0;s.pawns[0].priorities.craft=1;
    s.tailors.push({...pos(16,20),id:s.nextId++,axis:'x',bills:TAILOR_KINDS.map(kind=>({kind,target:kind==='tuque'?1:0,paused:false}))});
    s.items.push({...pos(13),...freshBatch('cloth',10),id:s.nextId++},{...pos(14),...freshBatch('alpacaWool',10),id:s.nextId++});
    s=VoxelSimulation.load(s.save());s.step(150);expect(s.stats.tailored).toBe(0);expect(s.stats.produced.unfinished).toBe(0);
    const benchId=s.tailors[0].id,bill=s.snapshot().productionQueues.find(q=>q.benchId===benchId)!.bills[0];
    command(s,{type:'productionBillUpdate',benchId,billId:bill.id,patch:{policy:{...bill.policy,allowedTextiles:[]}}});
    s.items.push({...pos(15),...freshBatch('alpacaWool',30),id:s.nextId++});s.step(150);
    expect(s.stats.tailored).toBe(0);expect(s.stats.consumed.alpacaWool).toBe(0);
    command(s,{type:'productionBillUpdate',benchId,billId:bill.id,patch:{policy:{...bill.policy,allowedTextiles:['alpacaWool']}}});
    until(s,()=>s.stats.tailored===1);expect(s.items.find(i=>i.apparel)?.apparel?.material).toBe('alpacaWool');
    expect(s.counts().cloth).toBe(10);expect(s.counts().alpacaWool).toBe(20);
  });
});
