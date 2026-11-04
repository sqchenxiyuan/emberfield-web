import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, at, index, position, type Pos, type WildAnimal, type VoxelCommand } from '../src/voxel/types';
import { initialAnimalState, HUSBANDRY_RULES } from '../src/voxel/husbandry';
import { initialPenFilter, PEN_BUILDINGS, PEN_RULES } from '../src/voxel/pens';
import { penCells, tryRope, animalManagementTick } from '../src/voxel/pensWorld';
import { plantRandom } from '../src/voxel/plants';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { FIRE_MAX_HP, fireDamageKey } from '../src/voxel/fire';
import { colonyWealthDetails } from '../src/voxel/wealth';

const pos=(x:number,y=16,z=8):Pos=>({x,y,z});
/** Controlled geometry for mechanism tests; the separate campaign uses an unedited new world. */
function fixture() {
  const s=new VoxelSimulation(73129, {hilliness:'flat',meanTemperature:24,latitude:0}, false, 2) /* Controlled geometry: historical full visibility. */;
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=0;x<=32;x++)for(let y=10;y<=22;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p] of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i));p.schedule.fill('work');
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0;
  }
  s.pawns[0].priorities.handle=1;s.pawns[0].skills.animals.level=0;
  return VoxelSimulation.load(s.save());
}
function animal(s:VoxelSimulation,extra:Partial<WildAnimal>={}) {
  const id=s.nextId++,species=extra.species??'deer';
  const a:WildAnimal={...pos(15),...initialAnimalState(id,species,s.tick),id,species,name:ANIMAL_DEFS[species].name,
    health:ANIMAL_DEFS[species].health,hunger:90,dead:false,phase:'roam',hunt:false,moveTick:0,
    decisionTick:1000000,fleeUntil:0,threatId:null,retryTick:0,rotProgress:0,faction:'colony',tameness:5,...extra};
  s.animals.push(a);return a;
}
function pen(s:VoxelSimulation) {
  for(let x=20;x<=26;x++)for(let y=12;y<=20;y++)if((x===20||x===26||y===12||y===20)&&!(x===20&&y===16))
    s.fences.push({...pos(x,y),id:s.nextId++});
  const gate={...pos(20),id:s.nextId++,axis:'x' as const,mode:'auto' as const,openUntil:0};s.fenceGates.push(gate);
  const marker={...pos(23),id:s.nextId++,name:'测试圈地',filter:initialPenFilter()};s.penMarkers.push(marker);s.revision++;
  return {gate,marker};
}
function command(s:VoxelSimulation,c:VoxelCommand) {const r=s.command(c);expect(r.ok,r.message).toBe(true);return r;}
function until(s:VoxelSimulation,predicate:()=>boolean,limit=2200) {
  for(let i=0;i<limit&&!predicate();i++)s.step();
  expect(predicate(),JSON.stringify({tick:s.tick,p:s.pawns[0],a:s.animals})).toBe(true);
}

describe('physical pens, roping and allowed areas',()=>{
  it('builds from delivered wood, retains wealth and physically demolishes the marker with a refund',()=>{
    const s=fixture(),p=s.pawns[0];p.priorities.build=1;p.priorities.handle=0;
    s.items.push({...pos(13),id:s.nextId++,resource:'wood',amount:56});
    for(const [tool,x] of [['fence',16],['fenceGate',17],['penMarker',18]] as const)
      command(s,{type:'designate',tool,from:pos(x)});
    until(s,()=>s.fences.length===1&&s.fenceGates.length===1&&s.penMarkers.length===1);
    expect(s.counts().wood).toBe(0);expect(colonyWealthDetails(s).buildingSources.facilities).toBeGreaterThan(60);
    command(s,{type:'designate',tool:'remove',from:pos(18)});until(s,()=>s.penMarkers.length===0);
    expect(s.counts().wood).toBe(Math.floor(PEN_BUILDINGS.penMarker.cost.wood/2));
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('checks physical closure without a roof, ignores transient opening and detects held-open gates and breaches',()=>{
    const s=fixture(),{gate,marker}=pen(s);
    expect(penCells(s,marker.id)?.has(at(marker))).toBe(true);
    gate.openUntil=100;expect(penCells(s,marker.id)).not.toBeNull();
    command(s,{type:'fenceGate',gateId:gate.id,mode:'open'});expect(penCells(s,marker.id)).toBeNull();
    command(s,{type:'fenceGate',gateId:gate.id,mode:'auto'});expect(penCells(s,marker.id)).not.toBeNull();
    s.fences=s.fences.filter(f=>at(f)!==at(pos(26)));s.revision++;
    expect(penCells(s,marker.id)).toBeNull();
  });
  it('allows a person and rabbit over a fence but blocks deer and a rope; ladders are not rope edges',()=>{
    const s=fixture();pen(s);const a=animal(s),f=pos(20,15),from=pos(19,15);
    expect(s.path(from,pos(21,15))).not.toBeNull();
    expect(s.animalNeighbors(a,from)).not.toContain(at(f));
    expect(s.animalNeighbors({...a,species:'hare'},from)).toContain(at(f));
    expect(s.penNeighbors(from,'rope')).not.toContain(at(f));
    s.ladders[at(from)]=1;s.ladders[at({...from,z:9})]=1;
    expect(s.penNeighbors(from,'rope')).not.toContain(at({...from,z:9}));
  });
  it('takes a real paired route through the gate with Animals 0 and detaches only once the animal is inside',()=>{
    const s=fixture(),{marker,gate}=pen(s),a=animal(s),p=s.pawns[0];
    until(s,()=>p.ropeTask?.stage==='lead');
    expect(a.phase).toBe('rope');expect(a.x).toBeLessThan(20);
    let crossed=false;
    until(s,()=>{if(a.x===gate.x&&a.y===gate.y)crossed=true;return !p.ropeTask;});
    expect(crossed).toBe(true);expect(penCells(s,marker.id)!.has(at(a))).toBe(true);expect(a.phase).not.toBe('rope');
    expect(s.items).toHaveLength(0);expect(p.skills.animals.level).toBe(0);
  });
  it('preserves an attached mid-route save and replays both endpoints deterministically',()=>{
    const s=fixture();pen(s);animal(s);until(s,()=>s.pawns[0].ropeTask?.stage==='lead');
    const save=s.save(),a=VoxelSimulation.load(save),b=VoxelSimulation.load(save);
    expect(a.pawns[0].ropeTask).toEqual(save.pawns[0].ropeTask);
    for(let i=0;i<240;i++){a.step();b.step();expect(a.animals).toEqual(b.animals);expect(a.pawns[0].ropeTask).toEqual(b.pawns[0].ropeTask);}
    expect(a.pawns[0].ropeTask).toBeNull();
  });
  it('cancels on pause, filter changes, drafting, or animal death without moving either endpoint',()=>{
    for(const action of ['pause','filter','draft','death'] as const) {
      const s=fixture(),{marker}=pen(s),a=animal(s),p=s.pawns[0];until(s,()=>p.ropeTask?.stage==='lead');
      const before=[at(a),at(p)];
      if(action==='pause')command(s,{type:'ropeAnimal',animalId:a.id,penId:null,paused:true});
      if(action==='filter')command(s,{type:'penFilter',markerId:marker.id,filter:{deer:false,dromedary:false,alpaca:false,male:true,female:true}});
      if(action==='draft')command(s,{type:'draft',pawnId:p.id,drafted:true});
      if(action==='death')s.killAnimal(a,'test');
      expect(p.ropeTask).toBeNull();expect([at(a),at(p)]).toEqual(before);expect(a.phase).not.toBe('rope');
      expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
    }
  });
  it('waits for an accepting pen and does not duplicate a rope or feeding reservation',()=>{
    const s=fixture(),{marker}=pen(s),a=animal(s,{sex:'male'});
    marker.filter.male=false;expect(tryRope(s,s.pawns[0])).toBe(false);
    command(s,{type:'penFilter',markerId:marker.id,filter:initialPenFilter()});
    expect(tryRope(s,s.pawns[0])).toBe(true);s.pawns[1].priorities.handle=1;
    expect(tryRope(s,s.pawns[1])).toBe(false);expect(s.pawns.filter(p=>p.ropeTask)).toHaveLength(1);
  });
  it('makes a rabbit walk back into its assigned region, permits outside traversal, then confines routine destinations',()=>{
    const s=fixture(),a=animal(s,{species:'hare',decisionTick:0});s.pawns[0].priorities.handle=0;
    const areaId=command(s,{type:'animalAreaCreate',name:'草场'}).areaId!;
    command(s,{type:'animalAreaPaint',areaId,from:pos(25,15),to:pos(26,17),erase:false});
    command(s,{type:'animalAreaAssign',areaId,animalId:a.id});expect(a.x).toBe(15);
    until(s,()=>s.animalAreas[0].cells.includes(at(a)));
    s.step(400);expect(s.animalAreas[0].cells.includes(at(a))).toBe(true);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
    command(s,{type:'animalAreaDelete',areaId});expect(a.allowedAreaId).toBeNull();
  });
  it('leaves an empty rabbit area unrestricted and returns after painting; deleting clears an active return goal',()=>{
    const s=fixture(),a=animal(s,{species:'hare',decisionTick:0}),cell=at(a);
    const areaId=command(s,{type:'animalAreaCreate',name:'待画范围'}).areaId!;
    command(s,{type:'animalAreaAssign',areaId,animalId:a.id});until(s,()=>at(a)!==cell,200);
    expect(a.goal?.kind).not.toBe('area');
    command(s,{type:'animalAreaPaint',areaId,from:pos(25),erase:false});s.step();expect(a.goal?.kind).toBe('area');
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
    command(s,{type:'animalAreaDelete',areaId});expect(a.goal).toBeNull();expect(a.path).toEqual([]);
  });
  it('inherits the mother rabbit area at birth and clears it on physical release',()=>{
    const s=fixture(),father=animal(s,{species:'hare',sex:'male'}),mother=animal(s,{species:'hare',sex:'female',...pos(17)});
    const areaId=command(s,{type:'animalAreaCreate',name:'兔区'}).areaId!;
    command(s,{type:'animalAreaPaint',areaId,from:pos(14,14),to:pos(19,18),erase:false});
    command(s,{type:'animalAreaAssign',areaId,animalId:mother.id});
    mother.pregnancy={fatherId:father.id,progress:1};s.step();
    const child=s.animals.find(a=>a.id!==father.id&&a.id!==mother.id)!;expect(child.allowedAreaId).toBe(areaId);
    command(s,{type:'animalOrder',animalId:mother.id,order:'release',enabled:true});until(s,()=>mother.faction==='wild');
    expect(mother.allowedAreaId).toBeNull();expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('invalidates closure after a fence burns and cancels an attached rope on marker destruction',()=>{
    const s=fixture(),{marker}=pen(s),a=animal(s);until(s,()=>s.pawns[0].ropeTask?.stage==='lead');
    const target=s.fences.find(f=>f.x===26&&f.y===16)!;
    expect(s.fireDestroy({...target,kind:'fence',targetId:target.id,key:fireDamageKey('fence',target.id,target),
      hitPoints:1,maxHitPoints:FIRE_MAX_HP.fence},'围栏烧毁')).toBe(true);
    expect(penCells(s,marker.id)).toBeNull();expect(s.pawns[0].ropeTask).toBeNull();
    const cell=at(a);expect(s.fireDestroy({...marker,kind:'penMarker',targetId:marker.id,key:fireDamageKey('penMarker',marker.id,marker),
      hitPoints:1,maxHitPoints:FIRE_MAX_HP.penMarker},'标记烧毁')).toBe(true);
    expect(at(a)).toBe(cell);expect(s.penMarkers).toEqual([]);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('keeps a closed-pen animal without starting a redundant rope',()=>{
    const s=fixture(),{marker}=pen(s),a=animal(s,{...pos(23)});
    expect(penCells(s,marker.id)!.has(at(a))).toBe(true);expect(tryRope(s,s.pawns[0])).toBe(false);
    const second={...pos(24),id:s.nextId++,name:'共享',filter:initialPenFilter()};s.penMarkers.push(second);s.revision++;
    expect(s.snapshot().penSummaries[0].sharedWith).toEqual([second.id]);
  });
  it('walks an unpenned deer to the actual map edge before removing it, with no instant rewilding',()=>{
    const s=fixture(),a=animal(s,{nextRoamTick:0,ropePaused:true});
    s.tick=PEN_RULES.roamGraceTicks-1;expect(animalManagementTick(s,a)).toBe(false);
    do{s.tick++;}while(plantRandom(s.seed,a.id,s.tick,1301)>=PEN_RULES.roamChance);
    const start=at(a);expect(animalManagementTick(s,a)).toBe(true);expect(a.goal?.kind).toBe('exit');
    expect(at(a)).toBe(start);expect(s.animals).toContain(a);expect(a.faction).toBe('colony');
    let lastCell=start;
    for(let i=0;i<1000&&s.animals.includes(a);i++) {lastCell=at(a);s.tick++;animalManagementTick(s,a);}
    expect(s.animals).not.toContain(a);expect(position(lastCell).x).toBe(0);
    expect(s.husbandryLog.filter(e=>e.kind==='escaped')).toHaveLength(1);
  });
  it('keeps a physically closed deer from roaming away even when the roam roll succeeds',()=>{
    const s=fixture();pen(s);const a=animal(s,{...pos(23),nextRoamTick:0,ropePaused:true});s.tick=5*DAY;
    while(plantRandom(s.seed,a.id,s.tick,1301)>=PEN_RULES.roamChance)s.tick++;
    expect(animalManagementTick(s,a)).toBe(false);expect(a.goal).toBeNull();expect(s.animals).toContain(a);
  });
  it('does not treat an elevated path over the fence outline as a closed pen',()=>{
    const s=fixture(),{marker}=pen(s);expect(penCells(s,marker.id)).not.toBeNull();
    // Real stairs reach a high bridge over the boundary; the fence retains two clear cells above its base.
    for(const [x,height] of [[23,8],[24,9],[25,10],[26,10],[27,10],[28,9],[29,8]] as const)
      for(let z=x===26?10:8;z<=height;z++)s.blocks[index(x,15,z)]=Block.Stone;
    s.revision++;expect(penCells(s,marker.id)).toBeNull();
  });
  it('cancels on normal-door mode changes and refuses to lock a gate occupied by an animal',()=>{
    const s=fixture(),{gate,marker}=pen(s),a=animal(s);s.fenceGates=[];
    s.doors.push({...gate});s.revision++;expect(penCells(s,marker.id)).not.toBeNull();
    until(s,()=>s.pawns[0].ropeTask?.stage==='lead');
    command(s,{type:'door',doorId:gate.id,mode:'open'});expect(penCells(s,marker.id)).toBeNull();
    expect(s.pawns[0].ropeTask).toBeNull();
    s.doors=[];s.fenceGates=[gate];Object.assign(a,pos(20));s.revision++;
    expect(s.command({type:'fenceGate',gateId:gate.id,mode:'locked'}).ok).toBe(false);
  });
  it('clears an active rope immediately when handling work is disabled',()=>{
    const s=fixture();pen(s);animal(s);until(s,()=>s.pawns[0].ropeTask?.stage==='lead');
    command(s,{type:'priority',pawnId:s.pawns[0].id,work:'handle',value:0});
    expect(s.pawns[0].ropeTask).toBeNull();expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
});
