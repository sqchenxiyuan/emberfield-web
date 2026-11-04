import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Pawn, type Pos, type Resource, type VoxelCommand } from '../src/voxel/types';
import { freshBatch } from '../src/voxel/preservation';

const pos=(x:number,y=16,z=8):Pos=>({x,y,z});
function cmd(s:VoxelSimulation,c:VoxelCommand) { const r=s.command(c);expect(r.ok,r.message).toBe(true);return r; }
/** Controlled terrain only; every action below uses real scheduling and inventory. */
function fixture() {
  const s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.grass=[];s.trees=[];s.items=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=30;x++)for(let y=10;y<=24;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p] of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i));p.schedule.fill('work');p.food=90;p.rest=90;p.apparelControl.policyId=null;
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof Pawn['priorities']]=0;
  }
  cmd(s,{type:'threats',enabled:false});cmd(s,{type:'fireHazards',enabled:false});
  cmd(s,{type:'foodPolicyUpdate',policy:{id:1,name:'暂不自动吃',allowedResources:[]}});
  return VoxelSimulation.load(s.save());
}
function food(s:VoxelSimulation,resource:Resource='meal',amount=1,where=pos(24)) {
  const item={id:s.nextId++,...where,...freshBatch(resource,amount)};s.items.push(item);return item;
}
function until(s:VoxelSimulation,done:()=>boolean,max=1600) {
  for(let i=0;i<max&&!done();i++)s.step();
  expect(done(),JSON.stringify(s.pawns.map(p=>({phase:p.phase,reason:p.reason,order:p.manualFoodOrder,cargo:p.cargo})))).toBe(true);
}
function fillFloor(s:VoxelSimulation) {
  for(let x=10;x<=30;x++)for(let y=10;y<=24;y++)
    if(!s.items.some(i=>at(i)===at(pos(x,y))))food(s,'steel',75,pos(x,y));
}

describe('explicit physical food orders',()=>{
  it('does not copy the resident manual order into newly arriving caravan members',()=>{
    const s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0},false,2);
    const p=s.pawns[0],item=s.items.find(i=>i.resource==='food')!;p.food=90;
    cmd(s,{type:'ingest',pawnId:p.id,stackId:item.id});expect(p.manualFoodOrder).toBeDefined();
    s.tradeSpawn();const traders=s.pawns.filter(p=>p.faction==='trader');expect(traders.length).toBeGreaterThan(0);
    expect(traders.every(p=>p.manualFoodOrder===undefined&&p.foodPolicyId===null)).toBe(true);
    const loaded=VoxelSimulation.load(s.save());expect(loaded.pawns[0].manualFoodOrder).toEqual(p.manualFoodOrder);
    expect(loaded.pawns.filter(p=>p.faction==='trader').length).toBe(traders.length);
  });
  it('overrides policy and forbidden once, walks, saves fetching and chewing, and consumes the actual batch',()=>{
    let s=fixture();const item=food(s);item.forbidden=true;const pawnId=s.pawns[0].id;
    cmd(s,{type:'ingest',pawnId,stackId:item.id});expect(item.forbidden).toBe(false);
    expect(s.pawns[0].path.length).toBeGreaterThan(0);expect(s.pawns[0].cargo).toBeNull();expect(s.stats.eaten).toBe(0);
    s=VoxelSimulation.load(s.save());expect(s.pawns[0].manualFoodOrder?.sourceId).toBe(item.id);
    until(s,()=>s.pawns[0].phase==='dine');s.step(8);const progress=s.pawns[0].living.mealTask!.progress;
    expect(s.pawns[0].cargo?.resource).toBe('meal');expect(s.items.some(i=>i.id===item.id)).toBe(false);
    s=VoxelSimulation.load(s.save());expect(s.pawns[0].living.mealTask!.progress).toBe(progress);
    until(s,()=>s.stats.eaten===1);expect(s.pawns[0].manualFoodOrder).toBeUndefined();
    expect(s.counts().meal).toBe(0);expect(s.foodPolicies.policies[0].allowedResources).toEqual([]);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('keeps the explicit order while the shared policy is edited',()=>{
    const s=fixture(),item=food(s),p=s.pawns[0];cmd(s,{type:'ingest',pawnId:p.id,stackId:item.id});
    cmd(s,{type:'foodPolicyUpdate',policy:{id:1,name:'重命名',allowedResources:['food']}});
    expect(p.manualFoodOrder?.sourceId).toBe(item.id);until(s,()=>s.stats.eaten===1);
  });
  it('temporarily bypasses an allowed area but cancels when the player explicitly reassigns the area',()=>{
    const s=fixture(),item=food(s),p=s.pawns[0];const areaId=cmd(s,{type:'allowedAreaCreate',name:'屋内'}).areaId!;
    cmd(s,{type:'allowedAreaPaint',areaId,from:pos(12),erase:false});cmd(s,{type:'pawnAreaAssign',pawnId:p.id,areaId});
    cmd(s,{type:'ingest',pawnId:p.id,stackId:item.id});expect(s.pawnAllowed(p,item)).toBe(true);
    cmd(s,{type:'pawnAreaAssign',pawnId:p.id,areaId});expect(p.manualFoodOrder).toBeUndefined();
    expect(s.pawnAllowed(p,item)).toBe(false);expect(s.items.find(i=>i.id===item.id)?.amount).toBe(1);
  });
  it('preserves meal quantity and poison state when drafting interrupts chewing',()=>{
    const s=fixture(),item=food(s),p=s.pawns[0];item.poisonChance=.35;
    cmd(s,{type:'ingest',pawnId:p.id,stackId:item.id});until(s,()=>p.phase==='dine');s.step(10);
    cmd(s,{type:'draft',pawnId:p.id,drafted:true});expect(p.manualFoodOrder).toBeUndefined();
    expect(p.living.mealTask).toBeNull();expect(p.cargo).toMatchObject({resource:'meal',amount:1,poisonChance:.35});
    expect(s.stats.eaten).toBe(0);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('honors a later forbid command and frees the source for another resident',()=>{
    const s=fixture(),item=food(s),p=s.pawns[0],q=s.pawns[1];cmd(s,{type:'ingest',pawnId:p.id,stackId:item.id});
    cmd(s,{type:'itemForbidden',itemId:item.id,forbidden:true});expect(p.manualFoodOrder).toBeUndefined();
    cmd(s,{type:'ingest',pawnId:q.id,stackId:item.id});until(s,()=>s.stats.eaten===1);
    expect(q.food).toBeGreaterThan(p.food);expect(s.counts().meal).toBe(0);
  });
  it('does not steal a reserved unit and preserves rejected commands atomically',()=>{
    const s=fixture(),item=food(s);cmd(s,{type:'ingest',pawnId:s.pawns[0].id,stackId:item.id});
    const before=s.save();expect(s.command({type:'ingest',pawnId:s.pawns[1].id,stackId:item.id}).ok).toBe(false);
    expect(s.save()).toEqual(before);until(s,()=>s.stats.eaten===1);
  });
  it('rebuilds separate reservations for two units after loading simultaneous manual fetches',()=>{
    let s=fixture();const item=food(s,'meal',2);
    for(const p of s.pawns.slice(0,2))cmd(s,{type:'ingest',pawnId:p.id,stackId:item.id});
    s=VoxelSimulation.load(s.save());const before=s.save();expect(s.command({type:'ingest',pawnId:s.pawns[2].id,stackId:item.id}).ok).toBe(false);
    expect(s.save()).toEqual(before);until(s,()=>s.stats.eaten===2);expect(s.counts().meal).toBe(0);
  });
  it('retains non-food cargo and consumes the reserved ground batch when every drop cell is full',()=>{
    let s=fixture();const item=food(s,'meal',1,pos(12));fillFloor(s);s.pawns[0].cargo=freshBatch('wood',8);
    s=VoxelSimulation.load(s.save());cmd(s,{type:'ingest',pawnId:s.pawns[0].id,stackId:item.id});
    until(s,()=>s.pawns[0].phase==='dine');expect(s.pawns[0].living.mealTask?.sourceId).toBe(item.id);
    s=VoxelSimulation.load(s.save());until(s,()=>s.stats.eaten===1);
    expect(s.pawns[0].cargo).toMatchObject({resource:'wood',amount:8});expect(s.counts().meal).toBe(0);
  });
  it('never creates an unloadable ground-dining task with a second food in full hands',()=>{
    let s=fixture();const item=food(s,'meal',1,pos(12));fillFloor(s);s.pawns[0].cargo=freshBatch('meat',8);
    s=VoxelSimulation.load(s.save());cmd(s,{type:'ingest',pawnId:s.pawns[0].id,stackId:item.id});s.step(2);
    expect(s.pawns[0].manualFoodOrder).toBeUndefined();expect(s.pawns[0].living.mealTask).toBeNull();
    expect(s.counts().meal).toBe(1);expect(s.pawns[0].cargo).toMatchObject({resource:'meat',amount:8});
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('waits safely if disallowed carried food cannot be dropped before automatic dining',()=>{
    let s=fixture();food(s,'meal',1,pos(12));fillFloor(s);s.pawns[0].cargo=freshBatch('meat',8);s.pawns[0].food=10;
    cmd(s,{type:'foodPolicyUpdate',policy:{id:1,name:'熟食',allowedResources:['meal']}});
    s=VoxelSimulation.load(s.save());s.step(40);expect(s.pawns[0].living.mealTask).toBeNull();
    expect(s.pawns[0].cargo).toMatchObject({resource:'meat',amount:8});expect(s.stats.eaten).toBe(0);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('rejects unknown, non-food, unreachable, extra-key and full-pawn requests without clearing forbid',()=>{
    const s=fixture(),item=food(s),wood=food(s,'wood',4,pos(25)),p=s.pawns[0];item.forbidden=true;
    for(const c of [{type:'ingest',pawnId:p.id,stackId:999999},{type:'ingest',pawnId:p.id,stackId:wood.id},
      {type:'ingest',pawnId:p.id,stackId:item.id,extra:true},{type:'ingest',pawnId:999999,stackId:item.id}]) {
      const before=s.save();expect(s.command(c as VoxelCommand).ok).toBe(false);expect(s.save()).toEqual(before);
    }
    p.food=100;let before=s.save();expect(s.command({type:'ingest',pawnId:p.id,stackId:item.id}).ok).toBe(false);expect(s.save()).toEqual(before);
    p.food=90;for(let y=10;y<=24;y++)for(let z=8;z<16;z++)s.blocks[index(20,y,z)]=Block.Stone;s.revision++;
    before=s.save();expect(s.command({type:'ingest',pawnId:p.id,stackId:item.id}).ok).toBe(false);expect(s.save()).toEqual(before);expect(item.forbidden).toBe(true);
  });
});
