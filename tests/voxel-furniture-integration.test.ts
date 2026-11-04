import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, index, type ApparelQuality, type Pos, type VoxelCommand } from '../src/voxel/types';
import { furnitureStats } from '../src/voxel/furniture';
import { colonyWealthDetails } from '../src/voxel/wealth';
import { jobSkill } from '../src/voxel/skills';
import { freshBatch } from '../src/voxel/preservation';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
/** Controlled chamber and skills distinguish effects. The release campaign
 * separately uses an unedited generated colony and ordinary player commands. */
function fixture() {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  s.animals=[]; s.grass=[]; s.items=[]; s.trees=[]; s.stockpiles=[];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x=10;x<=25;x++) for (let y=12;y<=22;y++) for (let z=8;z<=9;z++) s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for (const [i,p] of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i)); p.schedule.fill('work'); p.rest=90; p.food=90;
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities]=0;
  }
  for (let y=13;y<=15;y++) s.items.push({...pos(13,y),resource:'wood',amount:75,id:s.nextId++});
  return VoxelSimulation.load(s.save());
}
function command(s:VoxelSimulation,c:VoxelCommand) { const r=s.command(c); expect(r.ok,r.message).toBe(true); }
function until(s:VoxelSimulation,condition:()=>boolean,max=3000) {
  for(let i=0;i<max&&!condition();i++) s.step();
  expect(condition(),JSON.stringify({tick:s.tick,p:s.pawns.map(p=>({phase:p.phase,reason:p.reason})),jobs:s.jobs})).toBe(true);
}
function bedFixture(quality:ApparelQuality) {
  const s=fixture(), p=s.pawns[0];
  const bed={...pos(19),id:s.nextId++,axis:'x' as const,quality,owner:p.id,medical:false,prisoner:false};
  s.beds.push(bed); p.rest=10; p.living.comfort=0; p.schedule.fill('sleep');
  command(s,{type:'rest',pawnId:p.id}); until(s,()=>p.phase==='rest');
  return {s,p,bed};
}

describe('furniture construction quality in the colony',()=>{
  it.each(['bed','table','chair'] as const)('uses the actual finishing builder for %s, retains materials and quality through reload',kind=>{
    const s=fixture();
    s.pawns[0].skills.construction.level=0;
    s.pawns[1].skills.construction.level=20;
    command(s,{type:'priority',pawnId:s.pawns[0].id,work:'build',value:1});
    command(s,{type:'designate',tool:kind,from:pos(20),axis:'x'});
    until(s,()=>s.jobs.some(j=>j.kind===kind&&j.progress>0));
    const checkpoint=s.save(), low=VoxelSimulation.load(checkpoint), high=VoxelSimulation.load(checkpoint);
    command(high,{type:'priority',pawnId:high.pawns[0].id,work:'build',value:0});
    command(high,{type:'priority',pawnId:high.pawns[1].id,work:'build',value:1});
    const resumed=VoxelSimulation.load(high.save());
    const furniture=(v:VoxelSimulation)=>kind==='bed'?v.beds:kind==='table'?v.tables:v.chairs;
    for(const run of [low,high,resumed]) until(run,()=>furniture(run).length===1);
    expect(furniture(high)[0].quality).toBeGreaterThan(furniture(low)[0].quality);
    expect(furniture(resumed)).toEqual(furniture(high));
    // High-level skills decay even while working. Compare with the same
    // colonist left idle for exactly the same duration, not with zero XP.
    const endTick=Math.max(low.tick,high.tick);
    high.step(endTick-high.tick);low.step(endTick-low.tick);
    expect(high.pawns[1].skills.construction.dailyXp).toBeGreaterThan(low.pawns[1].skills.construction.dailyXp);
    expect(high.counts().wood).toBe(low.counts().wood);
    const built=furniture(high)[0];
    expect(VoxelSimulation.load(high.save()).save()[kind==='bed'?'beds':kind==='table'?'tables':'chairs'][0]).toEqual(built);
    const before=high.counts().wood;
    command(high,{type:'designate',tool:'remove',from:built}); until(high,()=>furniture(high).length===0);
    expect(high.counts().wood).toBeGreaterThan(before);
  });
  it('routes furniture and pen construction through Construction, without adding quality to fences or horseshoes',()=>{
    for(const kind of ['bed','table','chair','fence','fenceGate','penMarker','horseshoePin']) expect(jobSkill(kind)).toBe('construction');
    const s=fixture();s.pawns[0].priorities.build=1;
    command(s,{type:'designate',tool:'horseshoePin',from:pos(20)}); until(s,()=>s.horseshoePins.length===1);
    expect(Object.hasOwn(s.horseshoePins[0],'quality')).toBe(false);
  });
  it('actual bed quality changes sleeping recovery and comfort without changing HP or creating resources',()=>{
    const low=bedFixture(0), high=bedFixture(4);
    const startLow=low.p.rest,startHigh=high.p.rest;
    low.s.step(700);high.s.step(700);
    expect(high.p.rest-startHigh).toBeGreaterThan(low.p.rest-startLow);
    expect(low.p.living.comfort).toBeCloseTo(furnitureStats('bed',0).comfort!);
    expect(high.p.living.comfort).toBeGreaterThan(low.p.living.comfort);
    expect(furnitureStats('bed',0).maxHitPoints).toBe(furnitureStats('bed',4).maxHitPoints);
    expect(high.s.counts()).toEqual(low.s.counts());
    const saved=high.s.save(), restored=VoxelSimulation.load(saved);
    expect(restored.beds).toEqual(saved.beds);expect(restored.pawns[0].living).toEqual(saved.pawns[0].living);
    restored.step(40);high.s.step(40);
    // The established loader rebuilds dormant movement bookkeeping; compare
    // all persistent outcomes without requiring stale path cursors to survive.
    const stable=(run:VoxelSimulation)=>{
      const d=run.save();for(const p of d.pawns){expect(p.path).toEqual([]);p.destination=null;p.moveTick=0;}return d;
    };
    expect(stable(restored)).toEqual(stable(high.s));
  });
  it('uses the actual dining chair for comfort; a better table cannot replace an inferior chair',()=>{
    function seat(chairQuality:ApparelQuality,tableQuality:ApparelQuality) {
      const s=fixture();s.items=[];
      s.tables.push({...pos(20),id:s.nextId++,axis:'x',gathering:true,quality:tableQuality});
      s.chairs.push({...pos(19),id:s.nextId++,axis:'x',quality:chairQuality});
      const p=s.pawns[0];p.food=20;p.living.comfort=65;
      s.items.push({...pos(13),...freshBatch('meal',5),id:s.nextId++});
      until(s,()=>p.living.mealTask?.stage==='chew');s.step(50);
      return p.living.comfort;
    }
    expect(seat(0,6)).toBeLessThan(seat(4,0));
  });
  it('recomputes room beauty and wealth from furniture quality while keeping damage independent',()=>{
    const {s,bed}=bedFixture(0);
    const room=()=>s.livingRooms().find(r=>r.id===s.rooms.roomAt(bed)?.id)!;
    const low=room(), wealthLow=colonyWealthDetails(s).buildings;
    bed.quality=4;
    const high=room(), wealthHigh=colonyWealthDetails(s).buildings;
    expect(high.beauty).toBeGreaterThan(low.beauty);expect(high.wealth).toBeGreaterThan(low.wealth);
    expect(wealthHigh).toBeGreaterThan(wealthLow);
    const hp=furnitureStats('bed',bed.quality).maxHitPoints;
    s.fireDamage.push({kind:'bed',targetId:bed.id,key:`bed:${bed.id}`,x:bed.x,y:bed.y,z:bed.z,hitPoints:hp*.5,maxHitPoints:hp});
    expect(room().wealth).toBeLessThan(high.wealth);expect(room().beauty).toBe(high.beauty);
    // Native colony building wealth ignores HP, unlike the room's MarketValue.
    expect(colonyWealthDetails(s).buildings).toBe(wealthHigh);
    expect(s.beds[0].quality).toBe(4);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
});
