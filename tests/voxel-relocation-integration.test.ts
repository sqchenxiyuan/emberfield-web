import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, index, type Pos, type VoxelCommand } from '../src/voxel/types';
import type { FurnitureKind } from '../src/voxel/furniture';
import { furnitureStats } from '../src/voxel/furniture';
import { fireDamageKey, FIRE_MAX_HP } from '../src/voxel/fire';
import { igniteFire } from '../src/voxel/fireWorld';
import { freshBatch } from '../src/voxel/preservation';
import { jobXP, workSpeed } from '../src/voxel/skills';
const pos = (x:number,y=16,z=8):Pos => ({x,y,z});
function command(s:VoxelSimulation,c:VoxelCommand) {const r=s.command(c);expect(r.ok,r.message).toBe(true);}
function until(s:VoxelSimulation,predicate:()=>boolean,max=3500) {
  for(let i=0;i<max&&!predicate();i++)s.step();
  expect(predicate(),JSON.stringify({tick:s.tick,jobs:s.jobs,pawns:s.pawns.map(p=>({phase:p.phase,reason:p.reason,cargo:p.cargo}))})).toBe(true);
}
/** Controlled chamber isolates transitions. The ordinary campaign supplies
 * separate evidence for building and moving furniture without state edits. */
function fixture(kind:FurnitureKind='bed') {
  const s=new VoxelSimulation(73129, {hilliness:'flat',meanTemperature:24,latitude:0}, false, 2) /* Controlled geometry: historical full visibility. */;
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];s.homeArea.clear();
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=30;x++)for(let y=12;y<=23;y++)for(let z=8;z<=9;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p] of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i));p.schedule.fill('work');p.rest=95;p.food=95;
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0;
  }
  s.pawns[0].priorities.build=1;
  const id=s.nextId++,base={...pos(17),id,axis:'x' as const,quality:3 as const};
  if(kind==='bed')s.beds.push({...base,owner:s.pawns[1].id,medical:false,prisoner:false});
  else if(kind==='table')s.tables.push({...base,gathering:false});else s.chairs.push(base);
  const hp=50.25;
  s.fireDamage.push({...pos(17),kind,targetId:id,key:fireDamageKey(kind,id,pos(17)),hitPoints:hp,maxHitPoints:furnitureStats(kind,3).maxHitPoints});
  command(s,{type:'threats',enabled:false});command(s,{type:'fireHazards',enabled:false});
  return {s:VoxelSimulation.load(s.save()),id,hp,kind};
}
const installed=(s:VoxelSimulation,kind:FurnitureKind,id:number)=>(kind==='bed'?s.beds:kind==='table'?s.tables:s.chairs).find(b=>b.id===id);
const packed=(s:VoxelSimulation,id:number)=>[...s.items,...s.pawns.flatMap(p=>p.cargo?[p.cargo]:[]),...s.jobs.flatMap(j=>j.deliveredBatches)].filter(b=>b.furniture?.id===id);

describe('physical furniture relocation',()=>{
  it.each(['bed','table','chair'] as const)('carries the same %s through work and carrying saves, with its quality and fractional HP',kind=>{
    let {s,id,hp}=fixture(kind);const target=pos(26,20),before=s.snapshot().inventory;
    command(s,{type:'installFurniture',kind,furnitureId:id,target,axis:'y'});
    until(s,()=>s.jobs.some(j=>j.kind==='uninstall'&&j.progress>0));s=VoxelSimulation.load(s.save());
    until(s,()=>s.pawns.some(p=>p.cargo?.furniture?.id===id));
    expect(installed(s,kind,id)).toBeUndefined();expect(packed(s,id)).toHaveLength(1);
    s=VoxelSimulation.load(s.save());
    until(s,()=>!!installed(s,kind,id));
    expect(installed(s,kind,id)).toMatchObject({...target,id,quality:3,axis:'y'});
    expect(s.fireDamage.find(d=>d.targetId===id)?.hitPoints).toBe(hp);
    expect(packed(s,id)).toHaveLength(0);expect(s.jobs.some(j=>j.furnitureId===id)).toBe(false);
    expect(s.stats.produced.furniture).toBe(1);expect(s.stats.consumed.furniture).toBe(1);
    expect(s.snapshot().inventory.wood).toBe(before.wood);
    if(kind==='table')expect(s.tables.find(b=>b.id===id)?.gathering).toBe(false);
    if(kind==='bed')expect(s.beds.find(b=>b.id===id)).toMatchObject({owner:s.pawns[1].id,medical:false,prisoner:false});
    expect(VoxelSimulation.load(s.save()).save()).toMatchObject({version: 59});
  });
  it('cancels before uninstallation without changing the building, then cancels during hauling without losing it',()=>{
    const {s,id}=fixture();const target=pos(26,20),bed=structuredClone(s.beds[0]);
    command(s,{type:'installFurniture',kind:'bed',furnitureId:id,target,axis:'x'});
    command(s,{type:'cancelFurnitureMove',furnitureId:id});expect(s.beds[0]).toEqual(bed);expect(s.jobs).toHaveLength(0);
    command(s,{type:'installFurniture',kind:'bed',furnitureId:id,target,axis:'x'});
    until(s,()=>s.pawns.some(p=>p.cargo?.furniture?.id===id));
    command(s,{type:'cancelFurnitureMove',furnitureId:id});
    expect(packed(s,id)).toHaveLength(1);expect(s.jobs).toHaveLength(0);
    const loaded=VoxelSimulation.load(s.save());
    command(loaded,{type:'installFurniture',kind:'bed',furnitureId:id,target,axis:'y'});
    until(loaded,()=>!!installed(loaded,'bed',id));expect(packed(loaded,id)).toHaveLength(0);
    expect(loaded.stats.produced.furniture).toBe(1);expect(loaded.stats.consumed.furniture).toBe(1);
  });
  it('leaves the delivered original intact while a drafted pawn occupies the target, and resumes after it leaves',()=>{
    let {s,id}=fixture('chair');const target=pos(26,20);
    command(s,{type:'installFurniture',kind:'chair',furnitureId:id,target,axis:'x'});
    until(s,()=>s.pawns.some(p=>p.cargo?.furniture?.id===id));
    // A drafted pawn is a deterministic occupying actor; no worker teleport is used.
    command(s,{type:'draft',pawnId:s.pawns[2].id,drafted:true});
    Object.assign(s.pawns[2],target);s.step(100);
    expect(installed(s,'chair',id)).toBeUndefined();expect(packed(s,id)).toHaveLength(1);
    s=VoxelSimulation.load(s.save());command(s,{type:'move',pawnId:s.pawns[2].id,target:pos(24,21)});
    until(s,()=>!!installed(s,'chair',id));expect(s.chairs[0].quality).toBe(3);
  });
  it('damages a packed item by HP rather than destroying it on the first flame hit',()=>{
    const {s,id}=fixture('chair');command(s,{type:'uninstallFurniture',kind:'chair',furnitureId:id});
    until(s,()=>s.items.some(i=>i.furniture?.id===id));
    command(s,{type:'priority',pawnId:s.pawns[0].id,work:'build',value:0});
    const item=s.items.find(i=>i.furniture?.id===id)!;expect(igniteFire(s,item,'lightning')).toBeTruthy();
    until(s,()=>item.furniture!.hitPoints<50.25,100);
    expect(item.furniture!.hitPoints).toBeGreaterThan(0);expect(s.stats.destroyed.furniture).toBe(0);
    const loaded=VoxelSimulation.load(s.save());expect(packed(loaded,id)[0].furniture!.hitPoints).toBe(item.furniture!.hitPoints);
    loaded.fireBurnFurniture(id,100);expect(packed(loaded,id)).toHaveLength(0);expect(loaded.stats.destroyed.furniture).toBe(1);
  });
  it.each(['draft','downed','dead'] as const)('lets another worker continue after the carrier becomes %s',interruption=>{
    let {s,id}=fixture('chair');const target=pos(26,20);
    command(s,{type:'installFurniture',kind:'chair',furnitureId:id,target,axis:'x'});
    until(s,()=>s.pawns.some(p=>p.cargo?.furniture?.id===id));
    const carrier=s.pawns.find(p=>p.cargo?.furniture?.id===id)!;
    if(interruption==='draft')command(s,{type:'draft',pawnId:carrier.id,drafted:true});
    else {carrier.food=0;carrier.health.malnutrition=interruption==='dead'?1:.9;}
    s.step(2);
    expect(carrier[interruption==='draft'?'drafted':interruption]).toBe(true);
    expect(packed(s,id)).toHaveLength(1);
    s=VoxelSimulation.load(s.save());
    command(s,{type:'priority',pawnId:s.pawns[1].id,work:'build',value:1});
    until(s,()=>!!installed(s,'chair',id));
    expect(packed(s,id)).toHaveLength(0);expect(s.stats.consumed.furniture).toBe(1);
  });
  it('retains a canceled delivered package on a full floor and refunds it once space opens',()=>{
    let {s,id}=fixture('chair');const target=pos(26,20);
    command(s,{type:'installFurniture',kind:'chair',furnitureId:id,target,axis:'x'});
    until(s,()=>s.pawns.some(p=>p.cargo?.furniture?.id===id));
    command(s,{type:'draft',pawnId:s.pawns[2].id,drafted:true});Object.assign(s.pawns[2],target);
    until(s,()=>s.jobs.some(j=>j.kind==='install'&&j.delivered.furniture===1));
    for(let x=10;x<=30;x++)for(let y=12;y<=23;y++)s.items.push({...freshBatch('wood',75),...pos(x,y),id:s.nextId++});
    command(s,{type:'cancelFurnitureMove',furnitureId:id});
    expect(s.jobs.find(j=>j.furnitureId===id)?.cancelled).toBe(true);expect(packed(s,id)).toHaveLength(1);
    s=VoxelSimulation.load(s.save());s.step(5);expect(packed(s,id)).toHaveLength(1);
    s.items=s.items.filter(i=>i.x!==26||i.y!==20);s.step(25);
    expect(s.jobs.some(j=>j.furnitureId===id)).toBe(false);
    expect(s.items.filter(i=>i.furniture?.id===id)).toHaveLength(1);
    expect(s.stats.consumed.furniture).toBe(0);
  });
  it('drops a delivered package locally when its floor burns away, preserving identity and damage',()=>{
    const {s,id,hp}=fixture('chair');const target=pos(26,20);
    command(s,{type:'installFurniture',kind:'chair',furnitureId:id,target,axis:'x'});
    until(s,()=>s.pawns.some(p=>p.cargo?.furniture?.id===id));
    command(s,{type:'draft',pawnId:s.pawns[2].id,drafted:true});Object.assign(s.pawns[2],target);
    until(s,()=>s.jobs.some(j=>j.kind==='install'&&j.delivered.furniture===1));
    command(s,{type:'priority',pawnId:s.pawns[0].id,work:'build',value:0});
    command(s,{type:'move',pawnId:s.pawns[2].id,target:pos(28,21)});
    until(s,()=>s.pawns[2].x===28&&s.pawns[2].y===21);
    const floor=pos(26,20,7);s.blocks[index(26,20,7)]=Block.Wood;
    s.blocks[index(26,20,6)]=Block.Air;s.blocks[index(26,20,5)]=Block.Air;
    expect(s.fireDestroy({...floor,kind:'block',targetId:null,key:fireDamageKey('block',null,floor),hitPoints:0,maxHitPoints:FIRE_MAX_HP.block},'controlled collapse')).toBe(true);
    expect(s.jobs.some(j=>j.furnitureId===id)).toBe(false);
    expect(s.items.find(i=>i.furniture?.id===id)).toMatchObject({...pos(26,20,5),furniture:{id,hitPoints:hp}});
    expect(s.stats.destroyed.furniture).toBe(0);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('uses construction speed for uninstalling without awarding construction XP',()=>{
    const {s}=fixture();const low=structuredClone(s.pawns[0].skills),high=structuredClone(low);
    low.construction.level=0;high.construction.level=20;
    expect(workSpeed(high,'uninstall')).toBeGreaterThan(workSpeed(low,'uninstall'));
    expect(jobXP('uninstall')).toBe(0);expect(jobXP('install')).toBe(0);
  });
  it('cancels pending source work when the new site loses support before uninstalling',()=>{
    const {s,id}=fixture('chair');const target=pos(26,20),floor=pos(26,20,7);
    command(s,{type:'installFurniture',kind:'chair',furnitureId:id,target,axis:'x'});
    s.blocks[index(26,20,7)]=Block.Wood;s.blocks[index(26,20,6)]=Block.Air;s.blocks[index(26,20,5)]=Block.Air;
    expect(s.fireDestroy({...floor,kind:'block',targetId:null,key:fireDamageKey('block',null,floor),hitPoints:0,maxHitPoints:FIRE_MAX_HP.block},'controlled collapse')).toBe(true);
    expect(s.jobs.some(j=>j.furnitureId===id)).toBe(false);
    expect(installed(s,'chair',id)).toBeDefined();expect(packed(s,id)).toHaveLength(0);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
});
