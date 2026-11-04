import { describe, expect, it, vi } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { EGG_BOX_RULES, eggBoxInsert, type EggBox } from '../src/voxel/eggBoxes';
import { freshBatch } from '../src/voxel/preservation';
import { EGG_RULES, freshFertilizedEggs } from '../src/voxel/animalEggs';
import { initialAnimalState } from '../src/voxel/husbandry';
import { FIRE_MAX_HP, fireDamageKey } from '../src/voxel/fire';
import { Block, DAY, at, index, type Cargo, type Pos, type WildAnimal } from '../src/voxel/types';

const pos=(x:number,y=16,z=8):Pos=>({x,y,z});
function fixture(){
  const s=new VoxelSimulation(73129,{biome:'boreal',hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=28;x++)for(let y=10;y<=24;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p]of s.pawns.entries()){
    Object.assign(p,pos(12,16+i));p.schedule.fill('work');p.food=100;p.rest=100;
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0;
  }
  return VoxelSimulation.load(s.save());
}
function box(s:VoxelSimulation,eggs:Cargo|null=null,x=22):EggBox {
  const b={...pos(x),id:s.nextId++,eggs,emptyRequested:false,forbidden:false};s.eggBoxes.push(b);return b;
}
function hen(s:VoxelSimulation,extra:Partial<WildAnimal>={}){
  const id=s.nextId++,a:WildAnimal={...pos(21),...initialAnimalState(id,'chicken',0),id,species:'chicken',name:'鸡',faction:'colony',
    tameness:5,sex:'female',health:20,hunger:90,dead:false,phase:'roam',hunt:false,moveTick:0,
    decisionTick:0,fleeUntil:0,threatId:null,retryTick:0,rotProgress:0,eggProgress:1,...extra};
  s.animals.push(a);return a;
}
function storage(s:VoxelSimulation,x=13){s.stockpiles.push({...pos(x,12),priority:2,accepts:['eggUnfertilized','eggFertilized']});}
function until(s:VoxelSimulation,done:()=>boolean,max=1500){
  for(let n=0;n<max&&!done();n++)s.step();
  expect(done(),JSON.stringify({tick:s.tick,p:s.pawns.map(p=>({phase:p.phase,reason:p.reason,task:p.eggBoxTask,cargo:p.cargo})),a:s.animals.map(a=>({goal:a.goal,phase:a.phase,reason:a.reason})),boxes:s.eggBoxes})).toBe(true);
}

describe('physical egg boxes',()=>{
  it('rejects malformed commands without throwing or changing the save',()=>{
    const s=fixture(),before=s.save();for(const c of [null,undefined,3,'eggBox',{}, {type:'eggBoxEmpty',boxId:999,enabled:true}])
      expect(s.command(c as any).ok).toBe(false);
    expect(s.save()).toEqual(before);
  });
  it('constructs from delivered wood, remains passable, and saves the actual entity',()=>{
    let s=fixture();s.pawns[0].priorities.build=1;s.pawns[0].skills.construction.level=20;
    s.items.push({...pos(14),id:s.nextId++,...freshBatch('wood',20)});
    expect(s.command({type:'designate',tool:'eggBox',from:pos(22)}).ok).toBe(true);
    expect(s.jobs[0]).toMatchObject({cost:{wood:20},work:EGG_BOX_RULES.work});
    until(s,()=>s.eggBoxes.length===1,4000);
    expect(s.counts().wood).toBe(0);expect(s.stats.built).toBe(1);expect(s.standable(pos(22))).toBe(true);expect(s.penStandable(pos(22))).toBe(true);
    expect(s.command({type:'designate',tool:'wall',from:pos(22)}).ok).toBe(false);
    s=VoxelSimulation.load(s.save());expect(s.eggBoxes[0]).toMatchObject({eggs:null,forbidden:false,emptyRequested:false});
  });
  it('prefers fuller compatible boxes over nearer empty boxes and resumes a hen on the box',()=>{
    let s=fixture();box(s,null,21);const b=box(s,freshBatch('eggUnfertilized',5),25);hen(s,{...pos(20)});
    s.step();expect(s.animals[0].goal).toEqual({kind:'layEggBox',id:b.id});expect(s.animals[0].layProgress).toBe(0);
    until(s,()=>s.animals[0].layProgress===30);s=VoxelSimulation.load(s.save());expect(s.animals[0].layProgress).toBe(30);
    until(s,()=>s.stats.produced.eggUnfertilized===1);
    expect(s.eggBoxes[1].eggs?.amount).toBe(6);expect(s.items).toEqual([]);expect(s.counts().eggUnfertilized).toBe(6);
  });
  it('keeps species/faction/type/capacity restrictions and falls back to the ground',()=>{
    for(const mode of ['full','wrongType','forbidden','wild'] as const){
      const s=fixture(),b=box(s,mode==='wrongType'?freshFertilizedEggs(1):freshBatch('eggUnfertilized',mode==='full'?25:1));
      b.forbidden=mode==='forbidden';const a=hen(s,mode==='wild'?{faction:'wild'}:{});
      const before=b.eggs!.amount;s.step();expect(a.goal?.kind).toBe('layEgg');
      until(s,()=>s.stats.produced.eggUnfertilized===1);expect(b.eggs!.amount).toBe(before);
      expect(s.items.some(i=>i.resource==='eggUnfertilized')).toBe(true);
    }
  });
  it('reserves one box for one hen and preflights insertion without mutating hatch metadata',()=>{
    const s=fixture(),b=box(s,freshFertilizedEggs(3));b.eggs!.hatcher!.progress=.7;
    const candidate=freshFertilizedEggs(1);candidate.hatcher!.progress=.3;
    const before=structuredClone(b);expect(eggBoxInsert(b,candidate,false)).toBe(true);expect(b).toEqual(before);
    expect(eggBoxInsert(b,candidate,true)).toBe(true);expect(b.eggs!.hatcher!.progress).toBeCloseTo(.6);
    b.eggs=null;hen(s);hen(s,{...pos(20)});s.step();
    expect(s.animals.filter(a=>a.goal?.kind==='layEggBox')).toHaveLength(1);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('forbidding a box interrupts laying immediately without consuming fertility or the forming egg',()=>{
    const s=fixture(),b=box(s);const male=hen(s,{sex:'male',eggProgress:0}),a=hen(s,{fertilizationCount:1,eggFatherId:male.id});
    until(s,()=>a.layProgress>15);expect(s.command({type:'eggBoxForbid',boxId:b.id,forbidden:true}).ok).toBe(true);
    expect(a.goal).toBeNull();expect(a.layProgress).toBe(0);expect(a.eggProgress).toBe(1);expect(a.fertilizationCount).toBe(1);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('automatically extracts after walking and work, carries to storage, and resumes saved extraction',()=>{
    let s=fixture();box(s,freshBatch('eggUnfertilized',20));storage(s);s.pawns[0].priorities.haul=1;
    until(s,()=>!!s.pawns[0].eggBoxTask);expect(s.pawns[0].cargo).toBeNull();expect(s.eggBoxes[0].eggs!.amount).toBe(20);
    until(s,()=>s.pawns[0].eggBoxTask?.progress===15);s=VoxelSimulation.load(s.save());expect(s.pawns[0].eggBoxTask?.progress).toBe(15);
    until(s,()=>s.pawns[0].cargo?.amount===20);expect(s.eggBoxes[0].eggs).toBeNull();expect(s.items).toEqual([]);
    expect(s.pawns[0].path.length).toBeGreaterThan(0);expect(s.counts().eggUnfertilized).toBe(20);
    s=VoxelSimulation.load(s.save());until(s,()=>s.stats.hauled===20);
    expect(s.items[0]).toMatchObject({...pos(13,12),resource:'eggUnfertilized',amount:20});expect(s.pawns[0].cargo).toBeNull();
  });
  it('manual empty request bypasses threshold only and reserves finite storage for concurrent workers',()=>{
    const s=fixture(),a=box(s,freshBatch('eggUnfertilized',5),22),b=box(s,freshFertilizedEggs(20),23);
    // Fertile batches require explicit hatcher state.
    b.eggs=freshFertilizedEggs(20);storage(s);s.pawns[0].priorities.haul=1;s.pawns[1].priorities.haul=1;
    s.step(40);expect(a.eggs?.amount).toBe(5);
    expect(s.command({type:'eggBoxEmpty',boxId:a.id,enabled:true}).ok).toBe(true);
    until(s,()=>s.pawns.some(p=>!!p.eggBoxTask));
    expect(s.pawns.filter(p=>p.eggBoxTask)).toHaveLength(1);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('does not start without storage or hauling and preserves a pending early-empty request',()=>{
    let s=fixture();const b=box(s,freshBatch('eggUnfertilized',3));
    expect(s.command({type:'eggBoxEmpty',boxId:b.id,enabled:true}).ok).toBe(true);s.pawns[0].priorities.haul=1;s.step(50);
    expect(s.pawns[0].eggBoxTask).toBeUndefined();expect(b.eggs!.amount).toBe(3);storage(s);s.pawns[0].priorities.haul=0;s.step(50);
    expect(s.pawns[0].eggBoxTask).toBeUndefined();s=VoxelSimulation.load(s.save());expect(s.eggBoxes[0].emptyRequested).toBe(true);
    s.pawns[0].priorities.haul=1;until(s,()=>s.stats.hauled===3);expect(s.eggBoxes[0].emptyRequested).toBe(false);
  });
  it('takes only reserved capacity and leaves the remainder physically inside',()=>{
    const s=fixture(),b=box(s,freshBatch('eggUnfertilized',25));storage(s);
    s.items.push({...pos(13,12),id:s.nextId++,...freshBatch('eggUnfertilized',70)});s.pawns[0].priorities.haul=1;
    until(s,()=>!!s.pawns[0].cargo);expect(s.pawns[0].cargo?.amount).toBe(5);expect(b.eggs?.amount).toBe(20);
    until(s,()=>s.stats.hauled===5);s.step(80);expect(b.eggs?.amount).toBe(20);expect(s.counts().eggUnfertilized).toBe(95);
  });
  it.each(['forbid','draft','noStorage','haulOff'] as const)('interrupts %s during extraction with the eggs still in the box',(mode)=>{
    let s=fixture();const b=box(s,freshBatch('eggUnfertilized',20));storage(s);const p=s.pawns[0];p.priorities.haul=1;
    until(s,()=>p.eggBoxTask?.progress===10);
    if(mode==='forbid')s.command({type:'eggBoxForbid',boxId:b.id,forbidden:true});
    if(mode==='draft')s.command({type:'draft',pawnId:p.id,drafted:true});
    if(mode==='noStorage')s.stockpiles=[];
    if(mode==='haulOff')s.command({type:'priority',pawnId:p.id,work:'haul',value:0});
    s.step();expect(p.eggBoxTask).toBeUndefined();expect(p.cargo).toBeNull();expect(b.eggs?.amount).toBe(20);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('incubates in a forbidden box at ambient temperature and hatches each egg once',()=>{
    let s=fixture();const b=box(s,freshFertilizedEggs(2,'colony'));b.forbidden=true;b.eggs!.hatcher!.progress=1;
    s.step();expect(b.eggs).toBeNull();expect(s.animals).toHaveLength(2);expect(s.stats.consumed.eggFertilized).toBe(2);
    s=VoxelSimulation.load(s.save());s.step(10);expect(s.animals).toHaveLength(2);
  });
  it('converts ruined box eggs to fresh edible eggs and cancels incompatible reservations',()=>{
    const s=fixture(),b=box(s,freshFertilizedEggs(20));storage(s);s.pawns[0].priorities.haul=1;
    until(s,()=>s.pawns[0].eggBoxTask?.progress===10);b.eggs!.hatcher!.temperatureDamage=.999;
    vi.spyOn(s,'temperature').mockReturnValue(-20);s.step();expect(s.pawns[0].eggBoxTask).toBeUndefined();
    expect(b.eggs).toMatchObject({resource:'eggUnfertilized',amount:20,rotProgress:0});expect(b.eggs!.hatcher).toBeUndefined();
    expect(s.stats.consumed.eggFertilized).toBe(20);expect(s.stats.produced.eggUnfertilized).toBe(20);
  });
  it('rots unfertilized contents but shelter prevents outdoor deterioration',()=>{
    const s=fixture(),b=box(s,freshBatch('eggUnfertilized',3));b.forbidden=true;b.emptyRequested=true;
    vi.spyOn(s,'temperature').mockReturnValue(20);s.step(100);expect(b.eggs?.hitPoints).toBeUndefined();
    b.eggs!.rotProgress=15*DAY-1;s.step();expect(b.eggs).toBeNull();expect(b.emptyRequested).toBe(false);expect(s.stats.spoiled.eggUnfertilized).toBe(3);
  });
  it('demolishes atomically, preserving contained hatcher state without double booking production',()=>{
    const s=fixture(),b=box(s,freshFertilizedEggs(3));b.eggs!.hatcher!.progress=.4;s.pawns[0].priorities.build=1;
    expect(s.command({type:'designate',tool:'remove',from:b}).ok).toBe(true);
    const blocked=vi.spyOn(s as any,'planPlacement').mockReturnValue(null);s.step(400);
    expect(s.eggBoxes).toHaveLength(1);expect(b.eggs?.amount).toBe(3);expect(s.items).toEqual([]);
    blocked.mockRestore();until(s,()=>!s.eggBoxes.length);expect(s.counts().eggFertilized).toBe(3);expect(s.counts().wood).toBe(10);
    expect(s.stats.produced.eggFertilized).toBe(0);expect(s.items.find(i=>i.resource==='eggFertilized')?.hatcher?.progress).toBeGreaterThan(.4);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('loss of support drops contents onto a legal lower landing without production credit',()=>{
    const s=fixture(),b=box(s,freshFertilizedEggs(3));b.eggs!.hatcher!.progress=.2;
    s.blocks[index(22,16,6)]=Block.Air;s.blocks[index(22,16,7)]=Block.Wood;s.structureKinds[index(22,16,7)]=1;
    const support=pos(22,16,7),damage={...support,kind:'block' as const,targetId:null,key:fireDamageKey('block',null,support),hitPoints:0,maxHitPoints:100};
    expect(s.fireDestroy(damage,'支撑毁坏')).toBe(true);expect(s.eggBoxes).toEqual([]);
    const eggs=s.items.find(i=>i.resource==='eggFertilized')!;expect(eggs.amount).toBe(3);expect(eggs.z).toBe(6);expect(eggs.hatcher!.progress).toBe(.2);
    expect(s.stats.produced.eggFertilized).toBe(0);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('burned boxes drop real contents and invalidate laying/hauling users',()=>{
    const s=fixture(),b=box(s,freshBatch('eggUnfertilized',20));storage(s);s.pawns[0].priorities.haul=1;
    until(s,()=>s.pawns[0].eggBoxTask?.progress===10);
    const damage={...pos(22),kind:'eggBox' as const,targetId:b.id,key:fireDamageKey('eggBox',b.id,b),hitPoints:0,maxHitPoints:FIRE_MAX_HP.eggBox};
    expect(s.fireDestroy(damage,'蛋箱烧毁')).toBe(true);expect(s.eggBoxes).toEqual([]);expect(s.pawns[0].eggBoxTask).toBeUndefined();
    expect(s.counts().eggUnfertilized).toBe(20);expect(s.items.reduce((n,i)=>n+i.amount,0)).toBe(20);expect(s.stats.produced.eggUnfertilized).toBe(0);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('rejects cross-version injection, invalid cargo, duplicate reservations and unsupported boxes',()=>{
    const s=fixture();box(s,freshBatch('eggUnfertilized',20));storage(s);s.pawns[0].priorities.haul=1;
    until(s,()=>s.pawns[0].eggBoxTask?.progress===10);
    for(const mutate of [(d:any)=>d.version=51,(d:any)=>d.eggBoxes[0].eggs.amount=26,
      (d:any)=>d.eggBoxes[0].eggs={resource:'wood',amount:1},(d:any)=>d.eggBoxes[0].id=d.pawns[0].id,(d:any)=>d.pawns[0].priorities.haul=0,(d:any)=>d.pawns[0].eating='meal',
      (d:any)=>Object.assign(d.pawns[1],{phase:'eggBox',eggBoxTask:{...d.pawns[0].eggBoxTask}})]){
      const raw=s.save();mutate(raw);expect(()=>VoxelSimulation.load(raw)).toThrow();
    }
    (s as any).release(s.pawns[0]);s.ladders[index(22,16,8)]=1;expect(()=>VoxelSimulation.load(s.save())).toThrow('梯子');
    s.ladders[index(22,16,8)]=0;s.blocks[index(22,16,7)]=Block.Air;expect(()=>VoxelSimulation.load(s.save())).toThrow();
  });
});
