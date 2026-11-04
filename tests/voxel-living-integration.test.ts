import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, at, index, type Pos, type VoxelCommand } from '../src/voxel/types';
import { LIVING_RULES, LIVING_BUILDINGS } from '../src/voxel/living';
import { freshBatch } from '../src/voxel/preservation';
import { fireDamageKey, FIRE_MAX_HP } from '../src/voxel/fire';

const pos=(x:number,y=16,z=8):Pos=>({x,y,z});
/** Controlled geometry isolates mechanisms. The release campaign builds its
 * own colony with ordinary commands from an unedited generated world. */
function fixture(dining=true) {
  const s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0});
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=25;x++)for(let y=12;y<=22;y++)for(let z=8;z<=9;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p] of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i));p.schedule.fill('work');p.rest=90;p.food=90;
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0;
  }
  if(dining) {
    s.tables.push({...pos(20),id:s.nextId++,axis:'x',gathering:true});
    s.chairs.push({...pos(19),id:s.nextId++,axis:'y'});
  }
  s.items.push({...pos(13),...freshBatch('meal',5),id:s.nextId++});
  return VoxelSimulation.load(s.save());
}
function command(s:VoxelSimulation,c:VoxelCommand){const r=s.command(c);expect(r.ok,r.message).toBe(true);return r;}
function until(s:VoxelSimulation,condition:()=>boolean,max=2500) {
  for(let i=0;i<max&&!condition();i++)s.step();
  expect(condition(),JSON.stringify({tick:s.tick,p:s.pawns.map(p=>({phase:p.phase,reason:p.reason,task:p.living.mealTask})),jobs:s.jobs})).toBe(true);
}

describe('physical dining and inhabited rooms',()=>{
  it('takes one actual meal, reserves a real chair, walks and chews before nutrition; reload retains the batch',()=>{
    let s=fixture();s.pawns[0].food=20;
    until(s,()=>s.pawns[0].living.mealTask?.stage==='travel');
    const p=s.pawns[0];expect(p.cargo?.amount).toBe(1);expect(s.stats.eaten).toBe(0);
    expect(p.food).toBeLessThan(20);expect(p.living.mealTask?.chairId).toBe(s.chairs[0].id);
    const saved=s.save();s=VoxelSimulation.load(saved);
    expect(s.pawns[0].cargo).toEqual(saved.pawns[0].cargo);
    until(s,()=>s.pawns[0].living.mealTask?.stage==='chew');
    expect(at(s.pawns[0])).toBe(at(s.chairs[0]));expect(s.stats.eaten).toBe(0);
    s.step(30);const progress=s.pawns[0].living.mealTask!.progress;
    s=VoxelSimulation.load(s.save());expect(s.pawns[0].living.mealTask!.progress).toBe(progress);
    until(s,()=>s.stats.eaten===1);expect(s.pawns[0].food).toBeGreaterThan(90);
    expect(s.pawns[0].living.memories.some(m=>m.kind==='ateWithoutTable')).toBe(false);
    expect(s.counts().meal+s.stats.consumed.meal).toBe(5);
  });
  it('does not reserve one chair for two people or block their meals',()=>{
    const s=fixture();s.pawns[0].food=s.pawns[1].food=20;
    let occupied=false,ground=false;
    until(s,()=>{
      const tasks=s.pawns.flatMap(p=>p.living.mealTask?[p.living.mealTask]:[]);
      expect(tasks.filter(t=>t.chairId!==null).length).toBeLessThanOrEqual(1);
      occupied ||= tasks.some(t=>t.chairId!==null);ground ||= tasks.some(t=>t.chairId===null);
      return s.stats.eaten===2;
    });
    expect(occupied&&ground).toBe(true);
  });
  it('a chair without a table stays unused; standing beside a table avoids a new no-table memory',()=>{
    const s=fixture();s.tables=[];s.pawns[0].food=20;
    until(s,()=>s.stats.eaten===1);
    expect(s.pawns[0].living.memories.some(m=>m.kind==='ateWithoutTable')).toBe(true);
    let t=fixture();t.chairs=[];Object.assign(t.pawns[0],pos(19));
    t.pawns[0].cargo=freshBatch('food',1);t.pawns[0].food=20;t=VoxelSimulation.load(t.save());
    until(t,()=>t.stats.eaten===1);expect(t.pawns[0].living.memories.some(m=>m.kind==='ateWithoutTable')).toBe(false);
  });
  it('drafting interrupts chewing without consuming food or retaining a seat reservation',()=>{
    const s=fixture();s.pawns[0].food=20;
    until(s,()=>s.pawns[0].living.mealTask?.stage==='chew');s.step(10);
    command(s,{type:'draft',pawnId:s.pawns[0].id,drafted:true});
    expect(s.pawns[0].living.mealTask).toBeNull();expect(s.pawns[0].cargo?.amount).toBe(1);
    expect(s.stats.eaten).toBe(0);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('burning a chair releases the diner and preserves food; expired carried meals cannot be eaten',()=>{
    const s=fixture();s.pawns[0].food=20;until(s,()=>s.pawns[0].living.mealTask?.stage==='chew');
    const c=s.chairs[0];expect(s.fireDestroy({...c,kind:'chair',targetId:c.id,key:fireDamageKey('chair',c.id,c),
      hitPoints:1,maxHitPoints:FIRE_MAX_HP.chair},'餐椅烧毁')).toBe(true);
    expect(s.chairs).toHaveLength(0);expect(s.pawns[0].living.mealTask).toBeNull();
    expect(s.pawns[0].cargo?.amount).toBe(1);
    s.pawns[0].cargo!.rotProgress=DAY*4-1;s.step(4);
    expect(s.stats.spoiled.meal).toBe(1);expect(s.stats.eaten).toBe(0);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('uses real construction and refunds, rejects furniture overlap and both table footprint cells block routes',()=>{
    const s=fixture(false);s.items=[];s.items.push({...pos(13),resource:'wood',amount:43,id:s.nextId++});
    s.pawns[0].priorities.build=1;
    command(s,{type:'designate',tool:'table',from:pos(20),axis:'y'});
    command(s,{type:'designate',tool:'chair',from:pos(19),axis:'x'});
    expect(s.command({type:'designate',tool:'bed',from:pos(20,17)}).ok).toBe(false);
    until(s,()=>s.tables.length===1&&s.chairs.length===1);
    expect(s.counts().wood).toBe(0);expect(s.standable(pos(20))).toBe(false);expect(s.standable(pos(20,17))).toBe(false);
    expect(s.standable(pos(19))).toBe(true);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
    command(s,{type:'designate',tool:'remove',from:pos(20,17)});until(s,()=>s.tables.length===0);
    expect(s.counts().wood).toBe(Math.floor(LIVING_BUILDINGS.table.cost.wood/2));
  });
  it('sleeping in an owned bedroom raises comfort and creates a qualified memory; room roles follow furniture',()=>{
    let s=fixture(false);s.beds.push({...pos(17),id:s.nextId++,axis:'x',owner:s.pawns[0].id,medical:false,prisoner:false});
    // A small bare chamber has a real negative bedroom thought (a mediocre
    // room can legitimately produce no memory at all).
    for(let x=19;x<=25;x++)for(let y=12;y<=22;y++)for(let z=8;z<=9;z++)s.blocks[index(x,y,z)]=Block.Stone;
    s=VoxelSimulation.load(s.save());const p=s.pawns[0];p.food=100;p.rest=10;p.schedule.fill('sleep');
    expect(s.livingRooms().find(r=>r.id===s.rooms.roomAt(p)?.id)?.role).toBe('bedroom');
    command(s,{type:'rest',pawnId:p.id});until(s,()=>p.phase==='rest');
    s.step(LIVING_RULES.sleepThoughtDelay+5);expect(p.living.comfort).toBeGreaterThan(60);
    expect(p.living.sleepThoughtAt).toBeGreaterThan(s.tick);
    expect(p.living.memories.some(m=>m.kind==='bedroom')).toBe(true);
    const save=s.save();expect(VoxelSimulation.load(save).pawns[0].living).toEqual(p.living);
    s.beds.push({...pos(17,19),id:s.nextId++,axis:'x',owner:null,medical:false,prisoner:false});
    expect(s.livingRooms().find(r=>r.id===s.rooms.roomAt(p)?.id)?.role).toBe('barracks');
  });
});
