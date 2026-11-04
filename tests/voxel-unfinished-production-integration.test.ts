import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, index, type Pawn, type VoxelCommand, type Cargo } from '../src/voxel/types';
import { freshBatch } from '../src/voxel/preservation';
import { fireDamageKey, FIRE_MAX_HP } from '../src/voxel/fire';
import { unfinishedRecipeWorkTotals } from '../src/voxel/unfinishedProduction';
import { defaultProductionPolicy } from '../src/voxel/productionPolicies';

const pos = (x:number,y=16) => ({x,y,z:8});
function command(s:VoxelSimulation,c:VoxelCommand) { const r=s.command(c); expect(r.ok,r.message).toBe(true); }
function until(s:VoxelSimulation,done:()=>boolean,max=4000) {
  for(let n=0;n<max&&!done();n++) s.step();
  expect(done(),JSON.stringify({jobs:s.jobs,pawns:s.pawns.map(p=>({id:p.id,reason:p.reason,cargo:p.cargo})),items:s.items})).toBe(true);
}
function fixture() {
  let s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.trees=[];s.items=[];s.stockpiles=[];s.jobs=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=24;x++)for(let y=10;y<=24;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(11,11);
  s.pawns.forEach((p,i)=>{Object.assign(p,pos(11,11+i));p.food=100;p.rest=100;p.schedule.fill('work');
    for(const work of Object.keys(p.priorities))p.priorities[work as keyof Pawn['priorities']]=0;
    p.skills.crafting.level=10;
  });
  s=VoxelSimulation.load(s.save());
  command(s,{type:'threats',enabled:false});command(s,{type:'fireHazards',enabled:false});
  command(s,{type:'designate',tool:'craftingSpot',from:pos(16)});
  const benchId=s.weaponBenches[0].id;
  for(const b of s.snapshot().productionQueues.find(q=>q.benchId===benchId)!.bills)
    command(s,{type:'productionBillDelete',benchId,billId:b.id});
  command(s,{type:'productionBillAdd',benchId,recipe:'smith:woodClub'});
  const billId=s.productionQueues[0].bills[0].id;
  s.items.push({id:s.nextId++,...pos(12),...freshBatch('wood',40)});
  command(s,{type:'priority',pawnId:s.pawns[0].id,work:'craft',value:1});
  return {s,benchId,billId};
}
const cargo=(s:VoxelSimulation):Cargo|undefined => s.items.find(i=>i.unfinished) ?? s.pawns.find(p=>p.cargo?.unfinished)?.cargo ?? undefined;
const piece=(s:VoxelSimulation)=>cargo(s)!.unfinished!;
function started(){const f=fixture();until(f.s,()=>!!cargo(f.s)&&(piece(f.s).progress>20));return f;}
const ledger=(s:VoxelSimulation)=>Object.fromEntries(Object.entries(s.counts()).map(([r,n])=>
  [r,n+s.stats.consumed[r as keyof ReturnType<typeof s.counts>]+s.stats.destroyed[r as keyof ReturnType<typeof s.counts>]-s.stats.produced[r as keyof ReturnType<typeof s.counts>]]));

describe('independent unfinished production lifecycle',()=>{
  it('wraps actual ingredients once, counts materials once, then consumes only on completion',()=>{
    const {s,billId}=fixture(),before=ledger(s);
    until(s,()=>!!cargo(s));const u=piece(s),job=s.jobs.find(j=>j.billId===billId)!;
    expect(u.creatorId).toBe(s.pawns[0].id);expect(u.ingredients).toMatchObject([{resource:'wood',amount:40}]);
    expect(job.delivered).toEqual({});expect(job.deliveredBatches).toEqual([]);expect(job.unfinishedId).toBe(u.id);
    expect(s.counts().wood).toBe(40);expect(s.stats.consumed.wood).toBe(0);expect(ledger(s)).toEqual(before);
    until(s,()=>s.stats.weaponsMade===1);
    expect(cargo(s)).toBeUndefined();expect(s.stats.consumed.wood).toBe(40);expect(s.stats.produced.unfinished).toBe(1);
    expect(s.stats.consumed.unfinished).toBe(1);expect(ledger(s)).toEqual(before);
  });
  it('pause and deletion retain progress, author and actual materials across save/load',()=>{
    let {s,benchId,billId}=started();const u=structuredClone(piece(s));
    command(s,{type:'productionBillUpdate',benchId,billId,patch:{suspended:true}});s.step(40);
    expect(piece(s)).toEqual(u);expect(s.jobs.some(j=>j.unfinishedId===u.id)).toBe(false);
    command(s,{type:'productionBillDelete',benchId,billId});expect(piece(s).boundBillId).toBeNull();
    s=VoxelSimulation.load(s.save());expect(piece(s)).toEqual({...u,boundBillId:null});
    expect(s.counts().wood).toBe(40);expect(s.stats.consumed.wood).toBe(0);
  });
  it('new bill on another workbench reuses the same authors orphan outside its ingredient radius',()=>{
    const {s,benchId,billId}=started();const original=structuredClone(piece(s));
    command(s,{type:'productionBillDelete',benchId,billId});
    command(s,{type:'designate',tool:'craftingSpot',from:pos(22,21)});
    const next=s.weaponBenches.at(-1)!.id;
    for(const b of s.snapshot().productionQueues.find(q=>q.benchId===next)!.bills)
      command(s,{type:'productionBillDelete',benchId:next,billId:b.id});
    command(s,{type:'productionBillAdd',benchId:next,recipe:'smith:woodClub'});
    const bill=s.productionQueues.find(q=>q.benchId===next)!.bills[0];
    command(s,{type:'productionBillUpdate',benchId:next,billId:bill.id,patch:{policy:{...bill.policy,ingredientRadius:3}}});
    until(s,()=>s.pawns[0].cargo?.unfinished?.id===original.id);
    expect(piece(s).progress).toBe(original.progress);
    const loaded=VoxelSimulation.load(s.save());expect(piece(loaded).id).toBe(original.id);
    until(loaded,()=>loaded.stats.weaponsMade===1);
    expect(loaded.stats.produced.unfinished).toBe(1);expect(loaded.stats.consumed.wood).toBe(40);
  });
  it('current worker rules cannot transfer authorship',()=>{
    const {s,benchId,billId}=started(),creator=s.pawns[0].id,other=s.pawns[1].id;
    command(s,{type:'draft',pawnId:creator,drafted:true});
    command(s,{type:'priority',pawnId:other,work:'craft',value:1});
    const b=s.productionQueues[0].bills[0];
    command(s,{type:'productionBillUpdate',benchId,billId,patch:{policy:{...b.policy,workerId:other}}});
    const progress=piece(s).progress;s.step(100);expect(piece(s).progress).toBe(progress);
    expect(piece(s).creatorId).toBe(creator);expect(s.stats.weaponsMade).toBe(0);
    command(s,{type:'productionBillUpdate',benchId,billId,patch:{policy:{...b.policy,workerId:creator}}});
    command(s,{type:'draft',pawnId:creator,drafted:false});until(s,()=>s.stats.weaponsMade===1);
  });
  it('suspended unfinished items can be hauled into storage and fetched back',()=>{
    let {s,benchId,billId}=started();const id=piece(s).id;
    command(s,{type:'productionBillUpdate',benchId,billId,patch:{suspended:true}});
    command(s,{type:'designate',tool:'stock',from:pos(22,22)});
    command(s,{type:'priority',pawnId:s.pawns[1].id,work:'haul',value:1});
    until(s,()=>s.items.some(i=>i.unfinished?.id===id&&i.x===22&&i.y===22));
    s=VoxelSimulation.load(s.save());expect(piece(s).id).toBe(id);
    command(s,{type:'productionBillUpdate',benchId,billId,patch:{suspended:false}});
    until(s,()=>s.stats.weaponsMade===1);expect(s.stats.produced.unfinished).toBe(1);
  });
  it('forbid interrupts work and protects against both hauling and continuation',()=>{
    const {s}=started(),id=piece(s).id;
    command(s,{type:'unfinishedForbid',unfinishedId:id,forbidden:true});const progress=piece(s).progress;
    s.step(80);expect(piece(s).progress).toBe(progress);expect(cargo(s)?.forbidden).toBe(true);
    command(s,{type:'unfinishedForbid',unfinishedId:id,forbidden:false});until(s,()=>s.stats.weaponsMade===1);
  });
  it('explicit cancel refunds ingredients without completing or decrementing the bill',()=>{
    const {s,billId}=started(),id=piece(s).id,before=ledger(s);
    command(s,{type:'unfinishedCancel',unfinishedId:id});
    expect(cargo(s)).toBeUndefined();expect(s.items.filter(i=>i.resource==='wood').reduce((n,i)=>n+i.amount,0)).toBe(40);
    expect(s.productionQueues[0].bills.find(b=>b.id===billId)!.remaining).toBe(1);expect(s.stats.weaponsMade).toBe(0);
    expect(s.stats.consumed.wood).toBe(0);expect(ledger(s)).toEqual(before);
  });
  it('reuses the wrapper cell for a full refund even when the surrounding floor is full',()=>{
    const {s}=started(),item=s.items.find(i=>i.unfinished)!,before=structuredClone(piece(s));
    // Controlled full-floor boundary; cancellation may reuse its own physical slot.
    for(let x=10;x<=24;x++)for(let y=10;y<=24;y++)
      if(!s.items.some(i=>i.x===x&&i.y===y))s.items.push({id:s.nextId++,...pos(x,y),resource:'chunk',amount:1});
    // The original wrapper's cell is reusable for its wood refund, so a one
    // ingredient cancellation must still succeed even with every other cell full.
    command(s,{type:'unfinishedCancel',unfinishedId:before.id});
    expect(s.items.some(i=>i.x===item.x&&i.y===item.y&&i.resource==='wood'&&i.amount===40)).toBe(true);
    expect(s.stats.consumed.wood).toBe(0);
  });
  it('workbench destruction leaves an immediately saveable orphan with intact inputs',()=>{
    const {s,benchId}=started(),u=structuredClone(piece(s)),bench=s.weaponBenches.find(b=>b.id===benchId)!;
    expect(s.fireDestroy({kind:'weaponBench',targetId:benchId,x:bench.x,y:bench.y,z:bench.z,
      key:fireDamageKey('weaponBench',benchId,bench),hitPoints:0,maxHitPoints:FIRE_MAX_HP.weaponBench},'controlled destruction boundary')).toBe(true);
    const restored=VoxelSimulation.load(s.save());
    expect(piece(restored)).toEqual({...u,boundBillId:null});
    expect(restored.counts().wood).toBe(40);expect(restored.stats.consumed.wood).toBe(0);
  });
  it('rejects a partial multi-material refund atomically until two physical cells are available',()=>{
    const {s}=fixture();s.items=[];
    // Prepared valid orphan gun: this isolates cancellation capacity, not gun manufacturing.
    const id=s.nextId++;
    const batch:Cargo={resource:'unfinished',amount:1,unfinished:{id,recipe:'smith:revolver',creatorId:s.pawns[0].id,
      creatorName:s.pawns[0].name,boundBillId:null,workTotal:unfinishedRecipeWorkTotals('smith:revolver')[0],
      progress:0,workTicks:0,ingredients:[freshBatch('steel',30),freshBatch('components',2)],policy:defaultProductionPolicy()}};
    s.items.push({id:s.nextId++,...pos(17,17),...batch});
    for(let x=10;x<=24;x++)for(let y=10;y<=24;y++)
      if(!s.items.some(i=>i.x===x&&i.y===y))s.items.push({id:s.nextId++,...pos(x,y),resource:'chunk',amount:1});
    const before=structuredClone(s.items);
    expect(s.command({type:'unfinishedCancel',unfinishedId:id}).ok).toBe(false);
    expect(s.items).toEqual(before);expect(s.stats.consumed.unfinished).toBe(0);
    s.items=s.items.filter(i=>!(i.x===18&&i.y===17));
    command(s,{type:'unfinishedCancel',unfinishedId:id});
    expect(s.items.some(i=>i.unfinished?.id===id)).toBe(false);
    expect(s.counts().steel).toBe(30);expect(s.counts().components).toBe(2);expect(s.stats.consumed.unfinished).toBe(1);
  });
  it('destruction records wrapper and inner materials once and invalidates its job',()=>{
    const {s}=started(),item=s.items.find(i=>i.unfinished)!,id=item.unfinished!.id,before=ledger(s);
    s.fireBurnGround(item.id,1);
    expect(s.jobs.some(j=>j.unfinishedId===id)).toBe(false);expect(cargo(s)).toBeUndefined();
    expect(s.stats.destroyed.unfinished).toBe(1);expect(s.stats.destroyed.wood).toBe(40);expect(ledger(s)).toEqual(before);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('current saves reject duplicate material ownership and progress desynchronization',()=>{
    const {s}=started(),save=s.save();
    const bad=structuredClone(save);bad.jobs.find(j=>j.unfinishedId)!.progress++;
    expect(()=>VoxelSimulation.load(bad)).toThrow();
    const duplicate=structuredClone(save);duplicate.items.push({...structuredClone(duplicate.items.find(i=>i.unfinished)!),id:duplicate.nextId++});
    expect(()=>VoxelSimulation.load(duplicate)).toThrow();
  });
});
