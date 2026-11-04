import { stripAutoSlaughterFields } from './legacy-auto-rebuild-defaults';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, CELLS, at, index, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { WATER_RULES, validateWater } from '../src/voxel/water';
import { freshBatch } from '../src/voxel/preservation';
import { fireDamageKey, FIRE_MAX_HP } from '../src/voxel/fire';

const pos = (x:number,y=16):Pos => ({x,y,z:8});
function command(s:VoxelSimulation,c:VoxelCommand) {
  const result=s.command(c); expect(result.ok,JSON.stringify({c,result})).toBe(true); return result;
}
/** Controlled channel/inventory; public commands and real simulation do all
 * construction, hauling, movement, interruptions and resource transactions. */
function fixture() {
  let s = new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.trees=[];s.items=[];s.stockpiles=[];s.jobs=[];
  s.blocks.fill(Block.Stone);s.structureKinds.fill(0);s.ladders.fill(0);
  for(let y=10;y<=24;y++)for(let x=10;x<=29;x++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=0;
  for(let y=10;y<=24;y++)for(let x=15;x<=17;x++){
    s.blocks[index(x,y,7)]=0;s.water[index(x,y,7)]=1;
  }
  s.spawn=pos(11,11);
  s.pawns.forEach((p,i)=>{
    Object.assign(p,pos(11,11+i));p.food=100;p.rest=100;p.schedule.fill('work');
    for(const w of Object.keys(p.priorities))p.priorities[w as keyof Pawn['priorities']]=0;
  });
  s.items.push({id:s.nextId++,...pos(12,16),...freshBatch('wood',60)});
  s=VoxelSimulation.load(s.save());
  command(s,{type:'threats',enabled:false});command(s,{type:'fireHazards',enabled:false});
  command(s,{type:'priority',pawnId:s.pawns[0].id,work:'build',value:1});
  return s;
}
function until(s:VoxelSimulation,done:()=>boolean,max=4000){
  for(let i=0;i<max&&!done();i++)s.step();
  expect(done(),JSON.stringify({tick:s.tick,jobs:s.jobs,pawns:s.pawns.map(p=>({phase:p.phase,reason:p.reason,cargo:p.cargo}))})).toBe(true);
}
function build(s:VoxelSimulation){
  command(s,{type:'designate',tool:'bridge',from:pos(15),to:pos(17)});
  until(s,()=>s.bridges[index(17,16,7)]===1 && !s.jobs.length);
}
function wood(s:VoxelSimulation){return s.items.filter(i=>i.resource==='wood').reduce((n,i)=>n+i.amount,0)+
  s.pawns.reduce((n,p)=>n+(p.cargo?.resource==='wood'?p.cargo.amount:0),0)+
  s.jobs.reduce((n,j)=>n+(j.delivered.wood??0),0);}

describe('real water and bridge gameplay',()=>{
  it('wades shallow water but cannot stand in the water volume or cross deep water',()=>{
    const s=fixture();expect(s.standable(pos(16))).toBe(true);
    expect(s.standable({...pos(16),z:7})).toBe(false);
    const normal=s.weatherMoveTicks(pos(12),4,pos(13));
    expect(s.weatherMoveTicks(pos(14),4,pos(15))).toBe(normal+WATER_RULES.shallowPathTicks);
    expect(s.path(pos(14),pos(18))).not.toBeNull();
    for(let y=10;y<=24;y++)for(let x=15;x<=17;x++)s.water[index(x,y,7)]=2;
    expect(s.standable(pos(16))).toBe(false);expect(s.path(pos(14),pos(18))).toBeNull();
    expect(s.command({type:'designate',tool:'bridge',from:pos(16)}).ok).toBe(false);
  });
  it('builds a dragged crossing from real wood, speeds the actual route and preserves water',()=>{
    const s=fixture();build(s);
    expect(s.stats.consumed.wood).toBe(3*WATER_RULES.bridgeWood);
    expect(wood(s)+s.stats.consumed.wood).toBe(60);
    for(let x=15;x<=17;x++){
      expect(s.water[index(x,16,7)]).toBe(1);expect(s.bridges[index(x,16,7)]).toBe(1);
      expect(s.blocks[index(x,16,7)]).toBe(Block.Wood);
    }
    expect(s.path(pos(14),pos(18))).toEqual([15,16,17,18].map(x=>at(pos(x))));
    expect(s.weatherMoveTicks(pos(14),4,pos(15))).toBe(s.weatherMoveTicks(pos(12),4,pos(13)));
    const loaded=VoxelSimulation.load(s.save());
    for(const key of ['blocks','water','bridges','items','stats','tick','jobs'] as const)
      expect(loaded.save()[key]).toEqual(s.save()[key]);
  });
  it('restores a partly delivered bridge task and pays for each bridge only once',()=>{
    let s=fixture();command(s,{type:'designate',tool:'bridge',from:pos(15),to:pos(17)});
    until(s,()=>s.jobs.some(j=>(j.delivered.wood??0)>0 && j.progress>0));
    const original=s.save();s=VoxelSimulation.load(original);
    expect(s.jobs.some(j=>(j.delivered.wood??0)>0)).toBe(true);
    until(s,()=>!s.jobs.length);
    expect(s.bridges[index(17,16,7)]).toBe(1);expect(s.stats.consumed.wood).toBe(18);
    expect(wood(s)+s.stats.consumed.wood).toBe(60);
  });
  it('cancels construction without losing material or replacing water with ground',()=>{
    const s=fixture();command(s,{type:'designate',tool:'bridge',from:pos(15)});
    until(s,()=>s.jobs.some(j=>(j.delivered.wood??0)>0));
    command(s,{type:'designate',tool:'cancel',from:pos(15)});
    until(s,()=>!s.jobs.length);
    expect(wood(s)).toBe(60);expect(s.bridges[index(15,16,7)]).toBe(0);
    expect(s.water[index(15,16,7)]).toBe(1);
  });
  it('restricts water filling, riverbed excavation and heavy bridge construction',()=>{
    const s=fixture();
    expect(s.command({type:'designate',tool:'floor',from:pos(15)}).ok).toBe(false);
    expect(s.command({type:'designate',tool:'wall',from:pos(15)}).ok).toBe(false);
    expect(s.command({type:'designate',tool:'shaft',from:pos(15)}).ok).toBe(false);
    expect(s.command({type:'designate',tool:'mine',from:{...pos(15),z:6}}).ok).toBe(false);
    build(s);
    expect(s.command({type:'designate',tool:'wall',material:'stone',from:pos(15)}).ok).toBe(false);
    expect(s.command({type:'designate',tool:'battery',from:pos(15)}).ok).toBe(false);
    command(s,{type:'designate',tool:'chair',from:pos(15)});
  });
  it('demolishes a bridge back to the same shallow water and recovers only the refund',()=>{
    const s=fixture();build(s);
    command(s,{type:'designate',tool:'remove',from:pos(15),to:pos(17)});
    until(s,()=>!s.jobs.length);
    expect(s.bridges.reduce((n,v)=>n+v,0)).toBe(0);
    expect(s.blocks[index(16,16,7)]).toBe(Block.Air);
    expect(s.water[index(16,16,7)]).toBe(1);
    expect(wood(s)).toBe(60-18+9);expect(s.stats.produced.wood).toBe(9);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('burnt bridge loses its deck and supported furniture, retaining the underlying water',()=>{
    const s=fixture();build(s);command(s,{type:'designate',tool:'chair',from:pos(16)});
    until(s,()=>!s.jobs.length);expect(s.chairs).toHaveLength(1);
    const p={...pos(16),z:7};const damage={...p,kind:'block' as const,targetId:null,
      key:fireDamageKey('block',null,p),hitPoints:1,maxHitPoints:FIRE_MAX_HP.block};
    expect(s.fireDestroy(damage,'test burnt bridge')).toBe(true);
    expect(s.bridges[at(p)]).toBe(0);expect(s.water[at(p)]).toBe(1);expect(s.chairs).toHaveLength(0);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('rejects forged bridge identity and missing water fields; authentic old worlds stay dry',()=>{
    const s=fixture();const raw:any=s.save();delete raw.water;
    expect(()=>VoxelSimulation.load(raw)).toThrow();
    s.bridges[index(16,16,7)]=1;
    expect(()=>validateWater(s.water,s.bridges,s.blocks,s.ladders)).toThrow();
    const old:any=new VoxelSimulation(73129,{biome:'boreal'},false,3).save();
    stripAutoSlaughterFields(old);delete old.water;delete old.bridges;old.version=42;for(const p of old.pawns)delete p.allowedAreaId;
    expect(old.autoRebuild).toBe(false); delete old.autoRebuild;
    const loaded=VoxelSimulation.load(old);expect(loaded.water).toEqual(new Uint8Array(CELLS));
    expect(loaded.save().blocks).toEqual(old.blocks);expect(loaded.save().version).toBe(56);
  });
});
