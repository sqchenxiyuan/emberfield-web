import { stripAutoSlaughterFields } from './legacy-auto-rebuild-defaults';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Cargo, type Pawn, type Pos, type Resource, type VoxelCommand } from '../src/voxel/types';
import { freshBatch, portion, mergeBatch, validBatch } from '../src/voxel/preservation';
import { planCellInsertion, cellSpaceAfterReservations } from '../src/voxel/logistics';
import { makeApparel } from '../src/voxel/apparel';
import { makeWeapon } from '../src/voxel/weapons';
import { applyInjury } from '../src/voxel/injuries';
import { trackInfectionRisks } from '../src/voxel/medicine';
import { defaultShelfSettings } from '../src/voxel/shelves';

const pos=(x:number,y=16,z=8):Pos=>({x,y,z});
function cmd(s:VoxelSimulation,c:VoxelCommand) {const r=s.command(c);expect(r.ok,r.message).toBe(true);return r;}
function until(s:VoxelSimulation,test:()=>boolean,max=1800) {
  for(let n=0;n<max&&!test();n++)s.step();
  expect(test(),JSON.stringify({jobs:s.jobs,pawns:s.pawns.map(p=>({phase:p.phase,reason:p.reason,cargo:p.cargo}))})).toBe(true);
}
/** Isolated state-machine fixtures. No native or browser runtime is driven. */
function fixture() {
  let s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=32;x++)for(let y=10;y<=24;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(11);
  for(const [i,p] of s.pawns.entries()) {
    Object.assign(p,pos(11,16+i));p.food=90;p.rest=90;p.schedule.fill('work');
    for(const work of Object.keys(p.priorities))p.priorities[work as keyof Pawn['priorities']]=0;
  }
  s=VoxelSimulation.load(s.save());cmd(s,{type:'threats',enabled:false});cmd(s,{type:'fireHazards',enabled:false});return s;
}
function stack(s:VoxelSimulation,resource:Resource,amount=20,point=pos(22)) {
  const i={id:s.nextId++,...point,...freshBatch(resource,amount)};s.items.push(i);return i;
}

describe('physical item prohibition',()=>{
  it('preserves physical amounts, condition and flags on all ordinary resources through saving',()=>{
    const s=fixture();
    const resources:Resource[]=['silver','wood','stone','steel','components','food','grain','meat','meal','chunk','cloth','herb'];
    const goods=resources.map((r,n)=>stack(s,r,r==='chunk'?1:4,pos(12+n,13)));
    const before=s.counts(),wealth=s.snapshot().storyteller.threat.wealth;expect(wealth.items).toBeGreaterThan(0);
    for(const item of goods)cmd(s,{type:'itemForbidden',itemId:item.id,forbidden:true});
    expect(s.counts()).toEqual(before);expect(s.snapshot().storyteller.threat.wealth).toEqual(wealth);
    const saved=s.save();expect(saved.version).toBe(56);
    const restored=VoxelSimulation.load(saved);expect(restored.items).toEqual(s.items);
    expect(restored.snapshot().items.every(i=>i.forbidden)).toBe(true);
    const old:Record<string,any>={...saved,version:44}; stripAutoSlaughterFields(old); delete old.autoRebuild;
    expect(()=>VoxelSimulation.load(old)).toThrow(/通用物品禁止/);
    const bad=structuredClone(saved);bad.items[0].forbidden='yes' as unknown as boolean;
    expect(()=>VoxelSimulation.load(bad)).toThrow();
  });
  it('restricts bulk edits to the selected layer and discovered cells without revealing terrain',()=>{
    const s=fixture(),one=stack(s,'wood',4,pos(20)),two=stack(s,'steel',4,pos(21)),
      high=stack(s,'stone',4,pos(20,16,11)),hidden=stack(s,'components',4,pos(22));
    s.explored[at(hidden)]=0;const before=s.explored.slice();
    expect(cmd(s,{type:'itemForbiddenArea',from:pos(19),to:pos(22),forbidden:true}).count).toBe(2);
    expect(one.forbidden&&two.forbidden).toBe(true);expect(high.forbidden).toBeUndefined();expect(hidden.forbidden).toBeUndefined();
    expect(s.explored).toEqual(before);
    expect(s.command({type:'itemForbidden',itemId:hidden.id,forbidden:true}).ok).toBe(false);
    expect(s.command({type:'itemForbiddenArea',from:pos(20),to:pos(20,16,11),forbidden:true}).ok).toBe(false);
    expect(s.command({type:'itemForbiddenArea',from:null as unknown as Pos,forbidden:true}).ok).toBe(false);
    expect(cmd(s,{type:'itemForbiddenArea',from:pos(29),forbidden:false}).count).toBe(0);
    expect(cmd(s,{type:'itemForbiddenArea',from:pos(19),to:pos(22),forbidden:false}).count).toBe(2);
  });
  it('interrupts construction material fetch, resumes after Allow, and leaves carried portions independent',()=>{
    let s=fixture();let p=s.pawns[0];p.priorities.build=1;
    const wood=stack(s,'wood',40),id=wood.id,before=s.counts().wood;
    cmd(s,{type:'designate',tool:'wall',from:pos(18,14)});
    until(s,()=>p.phase==='fetch');cmd(s,{type:'itemForbidden',itemId:id,forbidden:true});
    expect(p.jobId).toBeNull();expect(p.cargo).toBeNull();s.step(60);
    expect(s.stats.built).toBe(0);expect(wood.amount).toBe(40);
    cmd(s,{type:'itemForbidden',itemId:id,forbidden:false});until(s,()=>p.cargo?.resource==='wood');
    const cargo=structuredClone(p.cargo),job=p.jobId;expect(wood.amount).toBeLessThan(40);
    cmd(s,{type:'itemForbidden',itemId:id,forbidden:true});expect(p.cargo).toEqual(cargo);expect(p.jobId).toBe(job);
    s=VoxelSimulation.load(s.save());p=s.pawns[0];until(s,()=>s.stats.built===1);
    expect(s.items.find(i=>i.id===id)?.forbidden).toBe(true);
    expect(s.counts().wood+s.stats.consumed.wood).toBe(before);
  });
  it('blocks forbidden hauling sources and forbidden merge destinations while retaining occupied space',()=>{
    const s=fixture(),p=s.pawns[0];p.priorities.haul=1;
    const source=stack(s,'wood',10,pos(15)),destination=stack(s,'wood',60,pos(26));
    s.stockpiles.push({...pos(26),priority:2,accepts:['wood']});
    cmd(s,{type:'itemForbidden',itemId:destination.id,forbidden:true});
    expect(s.storageSpace(pos(26),source)).toBe(0);s.step(100);expect(source.amount).toBe(10);expect(destination.amount).toBe(60);
    cmd(s,{type:'itemForbidden',itemId:source.id,forbidden:true});
    cmd(s,{type:'itemForbidden',itemId:destination.id,forbidden:false});s.step(100);expect(source.amount).toBe(10);
    cmd(s,{type:'itemForbidden',itemId:source.id,forbidden:false});until(s,()=>destination.amount===70);
    expect(s.counts().wood).toBe(70);expect(s.items).toHaveLength(1);
  });
  it('rechecks a destination that is forbidden while a hauler is carrying the goods',()=>{
    let s=fixture();const p=s.pawns[0];p.priorities.haul=1;
    stack(s,'wood',10,pos(13));const target=stack(s,'wood',60,pos(29));
    s.stockpiles.push({...pos(29),priority:2,accepts:['wood']});
    until(s,()=>p.cargo?.resource==='wood');cmd(s,{type:'itemForbidden',itemId:target.id,forbidden:true});
    expect(p.cargo?.amount).toBe(10);s=VoxelSimulation.load(s.save());s.step(200);
    expect(s.items.find(i=>i.id===target.id)).toMatchObject({amount:60,forbidden:true});
    expect(s.counts().wood).toBe(70);
  });
  it('keeps native physical split/merge flag behavior separate from automatic storage candidates',()=>{
    const a:Cargo={resource:'wood',amount:60,forbidden:true},b:Cargo={resource:'wood',amount:10};
    expect(portion(a,7).forbidden).toBe(true);mergeBatch(a,b);expect(a).toMatchObject({amount:70,forbidden:true});
    const c:Cargo={resource:'wood',amount:1};mergeBatch(c,{resource:'wood',amount:2,forbidden:true});expect(c.forbidden).toBeUndefined();
    expect(planCellInsertion([a],b,1).accepted).toBe(5);expect(planCellInsertion([a],b,1,false).accepted).toBe(0);
    const shelf=planCellInsertion([a],b,3,false);expect(shelf.merges).toEqual([]);expect(shelf.additions).toEqual([10]);
    expect(cellSpaceAfterReservations([a],[b],b,3,false)).toBe(140);
  });
  it('does not eat prohibited ground food, cancels pending fetch, and preserves independently carried food',()=>{
    const s=fixture(),p=s.pawns[0],food=stack(s,'food',4,pos(23));p.food=10;
    cmd(s,{type:'itemForbidden',itemId:food.id,forbidden:true});s.step(80);expect(food.amount).toBe(4);expect(s.stats.eaten).toBe(0);
    cmd(s,{type:'itemForbidden',itemId:food.id,forbidden:false});until(s,()=>p.phase==='fetch');
    cmd(s,{type:'itemForbidden',itemId:food.id,forbidden:true});expect(p.eating).toBeNull();expect(p.cargo).toBeNull();
    cmd(s,{type:'itemForbidden',itemId:food.id,forbidden:false});until(s,()=>p.phase==='dine');
    const carried=p.cargo;expect(carried?.resource).toBe('food');cmd(s,{type:'itemForbidden',itemId:food.id,forbidden:true});
    expect(p.cargo).toBe(carried);until(s,()=>s.stats.eaten===1);expect(food.amount).toBe(3);
  });
  it('uses a free shelf slot without merging into its forbidden stack, and bulk edits all stacks in that cell',()=>{
    let s=fixture();s.shelves.push({id:s.nextId++,...pos(26),kind:'smallShelf',axis:'x',settings:defaultShelfSettings()});
    s=VoxelSimulation.load(s.save());s.pawns[0].priorities.haul=1;
    const original=stack(s,'wood',60,pos(26)),metal=stack(s,'steel',75,pos(26));stack(s,'wood',10,pos(13));
    cmd(s,{type:'itemForbidden',itemId:original.id,forbidden:true});
    until(s,()=>s.items.filter(i=>at(i)===at(pos(26))).length===3);
    expect(s.items.find(i=>i.id===original.id)).toMatchObject({amount:60,forbidden:true});
    expect(s.items.find(i=>i.resource==='wood'&&i.id!==original.id)).toMatchObject({amount:10,...pos(26)});
    expect(s.counts().wood).toBe(70);expect(s.counts().steel).toBe(75);
    expect(cmd(s,{type:'itemForbiddenArea',from:pos(26),forbidden:true}).count).toBe(3);
    const restored=VoxelSimulation.load(s.save());expect(restored.items.every(i=>i.forbidden)).toBe(true);
    expect(restored.items.find(i=>i.id===metal.id)?.amount).toBe(75);
  });
  it('preserves forbidden production inputs and unfinished progress, then counts the forbidden finished product toward its target',()=>{
    let s=fixture();s.pawns[0].priorities.craft=1;s.pawns[0].skills.crafting.level=10;
    cmd(s,{type:'designate',tool:'craftingSpot',from:pos(18)});
    const benchId=s.weaponBenches[0].id;
    for(const bill of s.snapshot().productionQueues.find(q=>q.benchId===benchId)!.bills)
      cmd(s,{type:'productionBillDelete',benchId,billId:bill.id});
    cmd(s,{type:'productionBillAdd',benchId,recipe:'smith:woodClub'});
    const billId=s.productionQueues.find(q=>q.benchId===benchId)!.bills[0].id,wood=stack(s,'wood',40,pos(24));
    cmd(s,{type:'itemForbidden',itemId:wood.id,forbidden:true});s.step(100);
    expect(s.stats.consumed.wood).toBe(0);expect(wood.amount).toBe(40);expect(s.items.some(i=>i.unfinished)).toBe(false);
    cmd(s,{type:'itemForbidden',itemId:wood.id,forbidden:false});
    until(s,()=>s.items.some(i=>(i.unfinished?.progress??0)>20),4000);
    const item=s.items.find(i=>i.unfinished)!,piece=structuredClone(item.unfinished!);
    cmd(s,{type:'itemForbidden',itemId:item.id,forbidden:true});expect(s.pawns[0].jobId).toBeNull();
    s=VoxelSimulation.load(s.save());s.step(100);
    expect(s.items.find(i=>i.id===item.id)?.unfinished).toEqual(piece);expect(s.counts().wood).toBe(40);
    cmd(s,{type:'itemForbidden',itemId:item.id,forbidden:false});until(s,()=>s.stats.weaponsMade===1,4000);
    expect(s.stats.consumed.wood).toBe(40);expect(s.stats.produced.unfinished).toBe(1);
    const finished=s.items.find(i=>i.weapon)!;cmd(s,{type:'itemForbidden',itemId:finished.id,forbidden:true});
    cmd(s,{type:'productionBillUpdate',benchId,billId,patch:{mode:'target',target:1,resumeBelow:0}});
    stack(s,'wood',40,pos(24));s.step(200);
    expect(s.stats.weaponsMade).toBe(1);expect(s.counts().wood).toBe(40);expect(s.items.some(i=>i.unfinished)).toBe(false);
  });
  it('skips prohibited medicine and cancels a newly prohibited medicine fetch without changing the wound',()=>{
    const s=fixture(),doctor=s.pawns[0],patient=s.pawns[1];Object.assign(patient,pos(25));
    applyInjury(patient.trauma,s.nextId++,'torso','cut',9);trackInfectionRisks(patient,s.seed,patient.id,s.tick);
    const herb=stack(s,'herb',4,pos(19));cmd(s,{type:'itemForbidden',itemId:herb.id,forbidden:true});
    cmd(s,{type:'care',pawnId:doctor.id,patientId:patient.id,action:'tend'});
    expect(doctor.carePhase).not.toBe('tendFetch');expect(doctor.careMedicineId).toBeNull();
    cmd(s,{type:'itemForbidden',itemId:herb.id,forbidden:false});
    cmd(s,{type:'care',pawnId:doctor.id,patientId:patient.id,action:'tend'});expect(doctor.careMedicineId).toBe(herb.id);
    const wound=structuredClone(patient.trauma);cmd(s,{type:'itemForbidden',itemId:herb.id,forbidden:true});
    expect(doctor.carePhase).toBeNull();expect(patient.trauma).toEqual(wound);expect(herb.amount).toBe(4);
  });
  it.each(['weapon','apparel'] as const)('explicitly equips forbidden %s outside the allowed area and preserves the task across saving',kind=>{
    let s=fixture();const p=s.pawns[0],area=cmd(s,{type:'allowedAreaCreate',name:'室内'}).areaId!;
    cmd(s,{type:'allowedAreaPaint',areaId:area,from:pos(11),erase:false});cmd(s,{type:'pawnAreaAssign',pawnId:p.id,areaId:area});
    const pieceId=s.nextId++,itemId=s.nextId++;
    s.items.push({id:itemId,...pos(24),resource:kind,amount:1,forbidden:true,
      ...(kind==='weapon'?{weapon:makeWeapon(pieceId,'woodClub')}:{apparel:makeApparel(pieceId,'shirt')})});
    cmd(s,kind==='weapon'?{type:'equipWeapon',pawnId:p.id,weaponId:pieceId}:{type:'wear',pawnId:p.id,apparelId:pieceId});
    expect(s.items.find(i=>i.id===itemId)?.forbidden).toBe(false);expect(s.pawnAllowed(p,pos(24))).toBe(true);
    s=VoxelSimulation.load(s.save());const pawn=s.pawns[0];
    until(s,()=>kind==='weapon'?pawn.weapon?.id===pieceId:pawn.worn.some(a=>a.id===pieceId));
    until(s,()=>at(pawn)===at(pos(11)));expect(pawn.allowedAreaId).toBe(area);
  });
  it('keeps a forbidden packed original waiting for installation until it is allowed',()=>{
    const s=fixture(),p=s.pawns[0];p.priorities.build=1;
    const furnitureId=s.nextId++,itemId=s.nextId++;
    s.items.push({id:itemId,...pos(22),resource:'furniture',amount:1,forbidden:true,
      furniture:{id:furnitureId,kind:'chair',quality:3,axis:'x',hitPoints:80}});
    cmd(s,{type:'installFurniture',kind:'chair',furnitureId,target:pos(28,20),axis:'x'});
    s.step(100);expect(s.chairs).toHaveLength(0);expect(s.items.find(i=>i.id===itemId)?.forbidden).toBe(true);
    cmd(s,{type:'itemForbidden',itemId,forbidden:false});until(s,()=>s.chairs.some(c=>c.id===furnitureId));
    expect(s.chairs.find(c=>c.id===furnitureId)?.quality).toBe(3);expect(s.stats.consumed.furniture).toBe(1);
  });
  it('migrates v44-compatible state without adding flags or changing existing weapon settings',()=>{
    const s=fixture();stack(s,'wood',12);const id=s.nextId++;
    s.items.push({id:s.nextId++,...pos(25),resource:'weapon',amount:1,weapon:makeWeapon(id,'woodClub'),forbidden:true});
    const raw:Record<string,any>={...s.save(),version:44}; stripAutoSlaughterFields(raw); expect(raw.autoRebuild).toBe(false); delete raw.autoRebuild;
    const before=structuredClone(raw),loaded=VoxelSimulation.load(raw);
    expect(raw).toEqual(before);expect(loaded.save().version).toBe(56);expect(loaded.items).toEqual(raw.items);
    expect(loaded.save().blocks).toEqual(raw.blocks);
    expect(validBatch({...freshBatch('herb',2),forbidden:true})).toBe(true);
  });
});
