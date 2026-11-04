import { stripAutoSlaughterFields } from './legacy-auto-rebuild-defaults';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, position, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { makeWeapon } from '../src/voxel/weapons';

const pos = (x:number,y=16,z=8):Pos => ({x,y,z});
/** Controlled terrain tests complement the public-command fresh-world campaign. */
function fixture() {
  let s = new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[]; s.grass=[]; s.items=[]; s.trees=[]; s.stockpiles=[];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x=10;x<=30;x++) for(let y=10;y<=24;y++) for(let z=8;z<16;z++) s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p] of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i)); p.schedule.fill('work');
    for(const key of Object.keys(p.priorities)) p.priorities[key as keyof Pawn['priorities']]=0;
  }
  s=VoxelSimulation.load(s.save());
  cmd(s,{type:'threats',enabled:false}); cmd(s,{type:'fireHazards',enabled:false});
  return s;
}
function cmd(s:VoxelSimulation,c:VoxelCommand) {const r=s.command(c);expect(r.ok,r.message).toBe(true);return r;}
function area(s:VoxelSimulation,p:Pawn,from?:Pos,to?:Pos) {
  const id=cmd(s,{type:'allowedAreaCreate',name:'工作区'}).areaId!;
  if(from) cmd(s,{type:'allowedAreaPaint',areaId:id,from,to,erase:false});
  cmd(s,{type:'pawnAreaAssign',pawnId:p.id,areaId:id});return id;
}
function until(s:VoxelSimulation,done:()=>boolean,max=1000) {
  for(let n=0;n<max&&!done();n++) s.step();
  expect(done(),JSON.stringify(s.pawns.map(p=>({x:p.x,y:p.y,phase:p.phase,reason:p.reason,cargo:p.cargo,jobId:p.jobId})))).toBe(true);
}

describe('colonist allowed areas',()=>{
  it('shares identities with animal aliases, keeps empty masks unrestricted, and clears assignment on delete',()=>{
    const s=fixture(),p=s.pawns[0],id=area(s,p);
    expect(s.pawnAllowed(p,pos(29))).toBe(true);
    cmd(s,{type:'animalAreaRename',areaId:id,name:'共享区域'});
    cmd(s,{type:'animalAreaPaint',areaId:id,from:pos(12),erase:false});
    expect(s.pawnAllowed(p,pos(29))).toBe(false);
    cmd(s,{type:'allowedAreaPaint',areaId:id,from:pos(12),erase:true});
    expect(p.allowedAreaId).toBe(id);expect(s.pawnAllowed(p,pos(29))).toBe(true);
    cmd(s,{type:'animalAreaDelete',areaId:id});expect(p.allowedAreaId).toBeNull();
  });
  it('paints player-defined geometry on multiple layers without revealing hidden terrain',()=>{
    const s=new VoxelSimulation(73129),p=s.pawns[0],id=area(s,p);
    const before=s.explored.slice(),blocks=s.blocks.slice(),hidden=s.explored.findIndex(v=>!v),q=position(hidden);
    cmd(s,{type:'allowedAreaPaint',areaId:id,from:q,erase:false});
    cmd(s,{type:'allowedAreaPaint',areaId:id,from:pos(20,20,12),erase:false});
    expect(s.explored).toEqual(before);expect(s.blocks).toEqual(blocks);
    expect(s.snapshot().animalAreas[0].cells).toContain(hidden);
    expect(s.animalAreas[0].cells).toHaveLength(2);
    expect(s.command({type:'allowedAreaPaint',areaId:id,from:q,to:{...q,z:q.z+1},erase:false}).ok).toBe(false);
  });
  it('physically returns along an outside route; drafting permits manual outside movement',()=>{
    const s=fixture(),p=s.pawns[0],id=area(s,p,pos(24));
    const start=at(p);until(s,()=>p.phase==='travel');expect(at(p)).toBe(start);
    expect(p.path.some(n=>!s.animalAreas[0].cells.includes(n))).toBe(true);
    const resumed=VoxelSimulation.load(s.save());until(resumed,()=>at(resumed.pawns[0])===at(pos(24)));
    expect(s.command({type:'move',pawnId:p.id,target:pos(28)}).ok).toBe(false);
    cmd(s,{type:'draft',pawnId:p.id,drafted:true});cmd(s,{type:'move',pawnId:p.id,target:pos(28)});
    until(s,()=>at(p)===at(pos(28)));expect(p.allowedAreaId).toBe(id);
    cmd(s,{type:'draft',pawnId:p.id,drafted:false});until(s,()=>at(p)===at(pos(24)));
  });
  it('prefers a connected inside detour but preserves outside traversal when required',()=>{
    const s=fixture(),p=s.pawns[0],id=area(s,p,pos(12,16),pos(12,17));
    cmd(s,{type:'allowedAreaPaint',areaId:id,from:pos(12,17),to:pos(16,17),erase:false});
    cmd(s,{type:'allowedAreaPaint',areaId:id,from:pos(16),erase:false});
    const route=s.path(p,pos(16))!;
    expect(route.every(n=>s.animalAreas[0].cells.includes(n))).toBe(true);
    cmd(s,{type:'allowedAreaPaint',areaId:id,from:pos(14,17),erase:true});
    expect(s.path(p,pos(16))).not.toBeNull();
  });
  it('waits without teleporting when no allowed cell is reachable and recovers after editing',()=>{
    const s=fixture(),p=s.pawns[0],start=at(p),id=area(s,p,pos(5));
    s.step(100);expect(at(p)).toBe(start);expect(p.reason).toContain('没有可达');
    cmd(s,{type:'allowedAreaPaint',areaId:id,from:pos(24),erase:false});until(s,()=>at(p)===at(pos(24)));
  });
  it('mines a permitted solid target from an outside adjacent working cell',()=>{
    const s=fixture(),p=s.pawns[0];p.priorities.dig=1;
    s.blocks[at(pos(18))]=Block.Stone; s.revision++;
    area(s,p,pos(18));cmd(s,{type:'designate',tool:'mine',from:pos(18)});
    until(s,()=>s.stats.mined===1,1600);
    expect(s.blocks[at(pos(18))]).toBe(Block.Air);expect(s.pawnAllowed(p,p)).toBe(false);
  });
  it('filters material sources and releases a changed construction target without losing carried wood',()=>{
    const s=fixture(),p=s.pawns[0];p.priorities.build=1;
    s.items.push({id:s.nextId++,...pos(14),resource:'wood',amount:12});
    const id=area(s,p,pos(18));cmd(s,{type:'designate',tool:'wall',from:pos(18)});
    s.step(80);expect(p.cargo).toBeNull();expect(s.stats.built).toBe(0);
    cmd(s,{type:'allowedAreaPaint',areaId:id,from:pos(14),erase:false});
    until(s,()=>p.cargo?.resource==='wood');const wood=s.counts().wood;
    const loaded=VoxelSimulation.load(s.save());expect(loaded.pawns[0].allowedAreaId).toBe(id);
    cmd(s,{type:'allowedAreaPaint',areaId:id,from:pos(18),erase:true});
    expect(p.jobId).toBeNull();expect(p.cargo?.resource).toBe('wood');expect(s.counts().wood).toBe(wood);
    s.step(100);expect(s.stats.built).toBe(0);expect(s.counts().wood).toBe(wood);
    cmd(s,{type:'pawnAreaAssign',pawnId:p.id,areaId:null});until(s,()=>s.stats.built===1);
  });
  it('requires both a hauling source and its storage destination inside the area',()=>{
    const s=fixture(),p=s.pawns[0];p.priorities.haul=1;
    s.items.push({id:s.nextId++,...pos(14),resource:'wood',amount:12});
    s.stockpiles.push({...pos(22),priority:2,accepts:['wood']});
    const id=area(s,p,pos(22));s.step(100);expect(s.stats.hauled).toBe(0);
    cmd(s,{type:'allowedAreaPaint',areaId:id,from:pos(14),erase:false});
    until(s,()=>s.stats.hauled===12);expect(s.items.some(i=>i.x===22&&i.amount===12)).toBe(true);
  });
  it('chooses allowed food and bed instead of a nearer forbidden option',()=>{
    const s=fixture(),p=s.pawns[0];p.food=15;
    s.items.push({id:s.nextId++,...pos(13),resource:'food',amount:2},{id:s.nextId++,...pos(20),resource:'food',amount:2});
    s.beds.push({id:s.nextId++,...pos(14,20),axis:'x',quality:2,owner:null,medical:false,prisoner:false},
      {id:s.nextId++,...pos(22,20),axis:'x',quality:2,owner:null,medical:false,prisoner:false});
    const id=area(s,p,pos(20));cmd(s,{type:'allowedAreaPaint',areaId:id,from:pos(22,20),to:pos(23,20),erase:false});
    until(s,()=>p.food>30);expect(s.items.find(i=>i.x===13)?.amount).toBe(2);
    p.rest=.5;until(s,()=>p.phase==='rest');expect(p.sleepBedId).toBe(s.beds[1].id);
  });
  it('validates identity, migrates old assignments to unrestricted, and does not mutate caller saves',()=>{
    const s=fixture(),p=s.pawns[0],id=area(s,p,pos(20)),raw=s.save();
    expect(raw.version).toBe(55);expect(VoxelSimulation.load(raw).pawns[0].allowedAreaId).toBe(id);
    const bad=structuredClone(raw);bad.pawns[0].allowedAreaId=999999;expect(()=>VoxelSimulation.load(bad)).toThrow('允许区域');
    const missing:any=structuredClone(raw);delete missing.pawns[0].allowedAreaId;expect(()=>VoxelSimulation.load(missing)).toThrow('允许区域');
    const old:any=structuredClone(raw);stripAutoSlaughterFields(old);old.version=43;expect(()=>VoxelSimulation.load(old)).toThrow('混入');
    for(const q of old.pawns)delete q.allowedAreaId;
    expect(old.autoRebuild).toBe(false); delete old.autoRebuild;
    const before=structuredClone(old),loaded=VoxelSimulation.load(old);
    expect(old).toEqual(before);expect(loaded.save().blocks).toEqual(old.blocks);
    expect(loaded.pawns.every(q=>q.allowedAreaId===null)).toBe(true);expect(loaded.animalAreas).toEqual(old.animalAreas);
  });
  it('returns before fallback ground sleep or eating carried food outside',()=>{
    for(const activity of ['sleep','eat']) {
      const s=fixture(),p=s.pawns[0];area(s,p,pos(24));
      if(activity==='sleep')p.rest=.5;
      else {p.food=15;p.cargo={resource:'food',amount:1};}
      until(s,()=>p.phase==='travel');expect(p.path.length).toBeGreaterThan(0);
      until(s,()=>activity==='sleep'?p.phase==='rest':p.food>30);
      expect(at(p)).toBe(at(pos(24)));
    }
  });
  it('honors explicit Equip outside the area, resumes it from save, then returns',()=>{
    const s=fixture(),p=s.pawns[0],id=area(s,p,pos(12));
    const weapon=makeWeapon(s.nextId++,'woodClub');
    s.items.push({id:s.nextId++,...pos(24),resource:'weapon',amount:1,weapon});
    cmd(s,{type:'equipWeapon',pawnId:p.id,weaponId:weapon.id});expect(p.drafted).toBe(false);
    s.step(10);const loaded=VoxelSimulation.load(s.save()),q=loaded.pawns[0];
    until(loaded,()=>q.weapon?.id===weapon.id);expect(q.allowedAreaId).toBe(id);
    until(loaded,()=>at(q)===at(pos(12)));
  });
});
