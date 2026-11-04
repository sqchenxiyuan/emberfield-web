import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Pos, type Resource, type VoxelCommand, type WildAnimal } from '../src/voxel/types';
import { defaultShelfSettings, shelfAllows, shelfCells, SHELF_DEFS, type ShelfKind } from '../src/voxel/shelves';
import { freshBatch } from '../src/voxel/preservation';
import { fireDamageKey } from '../src/voxel/fire';
import { initialAnimalState } from '../src/voxel/husbandry';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { makeWeapon } from '../src/voxel/weapons';
import { applyInjury } from '../src/voxel/injuries';
import { trackInfectionRisks } from '../src/voxel/medicine';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const pos=(x:number,y=16,z=8):Pos=>({x,y,z});
function command(s:VoxelSimulation,c:VoxelCommand){const result=s.command(c);expect(result.ok,result.message).toBe(true);return result;}
function until(s:VoxelSimulation,done:()=>boolean,max=3500){
  for(let i=0;i<max&&!done();i++)s.step();
  expect(done(),JSON.stringify({tick:s.tick,jobs:s.jobs,pawns:s.pawns.map(p=>({phase:p.phase,reason:p.reason,cargo:p.cargo}))})).toBe(true);
}
function fixture(kind:ShelfKind='smallShelf') {
  const s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];s.homeArea.clear();
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=30;x++)for(let y=12;y<=23;y++)for(let z=8;z<=9;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p] of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i));p.schedule.fill('work');p.rest=95;p.food=95;
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0;
  }
  const id=s.nextId++;
  s.shelves.push({...pos(17),id,kind,axis:'x',settings:defaultShelfSettings()});
  command(s,{type:'threats',enabled:false});command(s,{type:'fireHazards',enabled:false});
  return VoxelSimulation.load(s.save());
}
function item(s:VoxelSimulation,resource:Resource,amount:number,p:Pos=pos(17)) {
  const i={...p,...freshBatch(resource,amount),id:s.nextId++};s.items.push(i);return i;
}
const goods=(s:VoxelSimulation)=>Object.fromEntries(['wood','steel','grain'].map(r=>[r,s.items.filter(i=>i.resource===r).reduce((n,i)=>n+i.amount,0)+s.pawns.reduce((n,p)=>n+(p.cargo?.resource===r?p.cargo.amount:0),0)]));

describe('shelf storage and gameplay',()=>{
  it.each(['smallShelf','shelf'] as const)('supports three mixed stacks per cell on %s, with exact stack identities after load',kind=>{
    const s=fixture(kind),shelf=s.shelves[0];
    for(const cell of shelfCells(shelf)){item(s,'wood',75,cell);item(s,'steel',75,cell);item(s,'grain',75,cell);}
    const restored=VoxelSimulation.load(s.save());
    expect(restored.items).toEqual(s.items);
    const capacity=restored.snapshot().storageCapacity.filter(c=>c.shelfId===shelf.id);
    expect(capacity).toHaveLength(SHELF_DEFS[kind].cells);
    expect(capacity.every(c=>c.maxStacks===3&&c.occupiedSlots===3)).toBe(true);
    item(s,'food',1);expect(()=>VoxelSimulation.load(s.save())).toThrow(/物品堆超过/);
  });
  it('hauls mixed goods into six slots and collects from adjacent cells',()=>{
    const s=fixture('shelf');s.pawns[0].priorities.haul=1;
    for(let i=0;i<6;i++)item(s,(['wood','steel','grain'] as const)[i%3],75,pos(21+i,20));
    until(s,()=>s.items.length===6&&s.items.every(i=>shelfCells(s.shelves[0]).some(p=>at(p)===at(i))));
    expect(goods(s)).toEqual({wood:150,steel:150,grain:150});
    expect(s.itemTouch(pos(17,15),s.items.find(i=>i.x===17)!)).toBe(true);
    expect(s.itemTouch(pos(17,15,9),s.items[0])).toBe(false);
    expect(VoxelSimulation.load(s.save()).items).toEqual(s.items);
  });
  it('builds a shelf through delivery and work, then eats its food from next to it',()=>{
    const s=fixture();s.shelves=[];(s as any).rebuildDevices();
    item(s,'wood',25,pos(20));s.pawns[0].priorities.build=1;
    command(s,{type:'designate',tool:'smallShelf',from:pos(17),to:pos(17),axis:'x'});
    until(s,()=>s.shelves.length===1);expect(s.shelves[0]).not.toHaveProperty('quality');
    item(s,'meal',4);s.pawns[0].food=10;
    until(s,()=>s.stats.consumed.meal>0);
    expect(at(s.pawns[0])).not.toBe(at(s.shelves[0]));
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('moves a full large shelf with settings and HP while goods remain separate',()=>{
    let s=fixture('shelf');const shelf=s.shelves[0],id=shelf.id;
    shelf.settings={priority:3,accepts:['wood','steel','grain']};
    s.fireDamage.push({...pos(17),kind:'shelf',targetId:id,key:fireDamageKey('shelf',id,pos(17)),hitPoints:65,maxHitPoints:150});
    for(const p of shelfCells(shelf)){item(s,'wood',75,p);item(s,'steel',75,p);item(s,'grain',75,p);}
    s.pawns[0].priorities.build=1;const before=goods(s);
    command(s,{type:'installFurniture',kind:'shelf',furnitureId:id,target:pos(26,20),axis:'y'});
    until(s,()=>s.pawns.some(p=>p.cargo?.furniture?.id===id));
    expect(goods(s)).toEqual(before);expect(s.shelves).toHaveLength(0);
    expect(s.pawns.find(p=>p.cargo?.furniture)?.cargo?.furniture).not.toHaveProperty('quality');
    s=VoxelSimulation.load(s.save());
    until(s,()=>s.shelves.some(s=>s.id===id));
    expect(s.shelves[0]).toMatchObject({...pos(26,20),axis:'y',settings:shelf.settings,id});
    expect(s.fireDamage.find(d=>d.targetId===id)?.hitPoints).toBe(65);
    expect(goods(s)).toEqual(before);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('keeps excluded goods physically present and lets workers move them to another store',()=>{
    const s=fixture();const wood=item(s,'wood',75);item(s,'steel',75);item(s,'grain',75);
    command(s,{type:'shelfStorage',shelfId:s.shelves[0].id,priority:3,accepts:['steel','grain']});
    expect(s.items.find(i=>i.id===wood.id)).toBe(wood);
    command(s,{type:'designate',tool:'stock',from:pos(25),to:pos(25)});
    s.pawns[0].priorities.haul=1;
    until(s,()=>s.items.some(i=>i.resource==='wood'&&at(i)===at(pos(25))));
    expect(goods(s)).toEqual({wood:75,steel:75,grain:75});
  });
  it('rejects chunks, packed buildings and large carcasses independently of selected filters',()=>{
    expect(shelfAllows({resource:'chunk'})).toBe(false);expect(shelfAllows({resource:'furniture'})).toBe(false);
    expect(shelfAllows({resource:'carcass',carcass:{species:'deer',animalId:1,bodySize:.6}})).toBe(true);
    expect(shelfAllows({resource:'carcass',carcass:{species:'deer',animalId:1,bodySize:.75}})).toBe(false);
    expect(shelfAllows({resource:'carcass',carcass:{species:'deer',animalId:1}})).toBe(false);
    expect(defaultShelfSettings().accepts).not.toContain('carcass');
  });
  it('waits atomically when a full shelf cannot be unpacked, then retries after space is cleared',()=>{
    const s=fixture();s.pawns[0].priorities.build=1;
    item(s,'wood',75);item(s,'steel',75);item(s,'grain',75);
    for(let x=10;x<=30;x++)for(let y=12;y<=23;y++)if(x!==17||y!==16)item(s,'steel',75,pos(x,y));
    const before=structuredClone(s.items),next=s.nextId,id=s.shelves[0].id;
    command(s,{type:'uninstallFurniture',kind:'smallShelf',furnitureId:id});
    until(s,()=>s.jobs.some(j=>j.reason.includes('等待清理')));
    const physical=(items:typeof s.items)=>items.map(({rotProgress,...i})=>i);
    expect(s.shelves).toHaveLength(1);expect(physical(s.items)).toEqual(physical(before));expect(s.stats.produced.furniture).toBe(0);
    expect(s.items.find(i=>i.resource==='grain')!.rotProgress).toBeGreaterThan(0);
    expect(s.nextId).toBe(next+1);
    s.items=s.items.filter(i=>!(i.y===15&&i.x>=16&&i.x<=19));
    until(s,()=>s.shelves.length===0);
    expect(s.items.filter(i=>i.furniture?.id===id)).toHaveLength(1);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('destroys a congested shelf without losing goods and persists temporary overflow until consumed',()=>{
    let s=fixture();const shelf=s.shelves[0];
    item(s,'wood',75);item(s,'steel',75);item(s,'grain',75);
    for(let x=10;x<=30;x++)for(let y=12;y<=23;y++)if(x!==17||y!==16)item(s,'steel',75,pos(x,y));
    const before=goods(s);
    expect(s.fireDestroy({...shelf,kind:shelf.kind,targetId:shelf.id,key:fireDamageKey(shelf.kind,shelf.id,shelf),hitPoints:1,maxHitPoints:100},'test fire')).toBe(true);
    expect(s.shelves).toHaveLength(0);expect(goods(s)).toEqual(before);expect(s.storageSpills).toHaveLength(1);
    s=VoxelSimulation.load(s.save());expect(s.storageSpills).toHaveLength(1);
    // Exact source IDs are still accessible on ordinary ground; saving prunes obsolete overflow metadata.
    Object.assign(s.pawns[0],pos(17));
    for(const resource of ['wood','grain']){
      const source=s.items.find(i=>i.resource===resource)!;
      expect((s as any).take(s.pawns[0],resource,75,source.id)).toBe(true);
      s.stats.consumed[resource as 'wood'|'grain']+=75;s.pawns[0].cargo=null;
    }
    expect(s.save().storageSpills).toEqual([]);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('keeps exact source identity when two same-cell stacks exist and one disappears',()=>{
    const s=fixture();const first=item(s,'wood',75),second=item(s,'wood',75);
    Object.assign(s.pawns[0],pos(17,15));s.tradeApplyPlacement({items:[second],nextId:s.nextId});
    expect((s as any).take(s.pawns[0],'wood',10,first.id)).toBe(false);
    expect(second.amount).toBe(75);
    expect((s as any).take(s.pawns[0],'wood',10,second.id)).toBe(true);
    expect(second.amount).toBe(65);
  });
  it('equips the selected weapon from a shelf after resuming its fetch',()=>{
    let s=fixture();const weapon=makeWeapon(s.nextId++,'steelKnife');
    s.items.push({...pos(17),id:s.nextId++,resource:'weapon',amount:1,weapon});item(s,'steel',75);
    const pawnId=s.pawns[0].id;
    command(s,{type:'equipWeapon',pawnId,weaponId:weapon.id});
    until(s,()=>s.pawns[0].weaponTask?.stage==='fetch');s=VoxelSimulation.load(s.save());
    until(s,()=>s.pawns[0].weapon?.id===weapon.id);
    expect(at(s.pawns[0])).not.toBe(at(pos(17)));expect(s.items.some(i=>i.resource==='steel')).toBe(true);
  });
  it.each(['self','handler'] as const)('feeds an animal from a mixed shelf through %s consumption',mode=>{
    let s=fixture();const id=s.nextId++,a:WildAnimal={...pos(23),...initialAnimalState(id,'hare',s.tick),id,species:'hare',name:'野兔',
      health:ANIMAL_DEFS.hare.health,hunger:mode==='self'?30:80,dead:false,phase:'roam',hunt:false,moveTick:0,decisionTick:mode==='self'?0:1000000,
      fleeUntil:0,threatId:null,retryTick:0,rotProgress:0};
    s.animals.push(a);item(s,'steel',75);item(s,'grain',30);
    if(mode==='handler'){
      s.pawns[0].priorities.handle=1;s.pawns[0].skills.animals.level=8;
      command(s,{type:'animalOrder',animalId:id,order:'tame',enabled:true});
      until(s,()=>s.pawns[0].handleTask?.stage==='fetch');s=VoxelSimulation.load(s.save());
    }
    until(s,()=>s.stats.consumed.grain>0);
    expect(s.counts().grain+s.stats.consumed.grain).toBe(30);
    expect(s.items.find(i=>i.resource==='steel')?.amount).toBe(75);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('allows passage but moves an interrupted idle pawn off the shelf before resting',()=>{
    const s=fixture(),p=s.pawns[0];Object.assign(p,pos(17));p.rest=1;
    expect(s.standable(p)).toBe(true);expect((s as any).canStop(p)).toBe(false);
    s.step(40);expect(at(p)).not.toBe(at(pos(17)));expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('resumes a medical fetch from the adjacent shelf stand and consumes the chosen herbs',()=>{
    let s=fixture();const doctorId=s.pawns[0].id,patient=s.pawns[1],patientId=patient.id;
    applyInjury(patient.trauma,s.nextId++,'torso','cut',9);
    trackInfectionRisks(patient,s.seed,patient.id,s.tick);s.pawns[0].priorities.care=1;
    item(s,'wood',75);const herbs=item(s,'herb',5);
    command(s,{type:'care',pawnId:doctorId,patientId,action:'tend'});
    expect(s.pawns[0].carePhase).toBe('tendFetch');expect(s.pawns[0].careMedicineId).toBe(herbs.id);
    s=VoxelSimulation.load(s.save());
    expect(s.pawns[0].destination).not.toBe(at(pos(17)));
    until(s,()=>s.stats.consumed.herb>0);
    expect(s.items.find(i=>i.resource==='wood')?.amount).toBe(75);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('migrates actual published v36 bytes without regenerating the world or changing inventory',()=>{
    const bytes=readFileSync(new URL('./fixtures/voxel-v36-before-shelves.json',import.meta.url));
    const proof=JSON.parse(readFileSync(new URL('./fixtures/voxel-v36-before-shelves.provenance.json',import.meta.url),'utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(proof.sha256);
    expect(proof.publishedCommit).toBe('9e2dc745c5caa820778ecec44249be503cfce679');
    const old=JSON.parse(bytes.toString()),before=structuredClone(old);expect(old.version).toBe(36);expect(old.shelves).toBeUndefined();
    const s=VoxelSimulation.load(old),saved=s.save();expect(saved.version).toBe(40);expect(old).toEqual(before);
    expect(saved.shelves).toEqual([]);expect(saved.storageSpills).toEqual([]);
    for(const key of ['blocks','ladders','items','stats','explored','generator','worldSite','seed'])expect((saved as any)[key],key).toEqual(old[key]);
    s.step(50);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('rejects overlap, unsupported shelves, invalid settings and second-cell overflow',()=>{
    const base=fixture('shelf').save();
    for(const mutate of [
      (d:any)=>d.shelves[0].settings.accepts.push('chunk'),
      (d:any)=>d.shelves[0].quality=2,
      (d:any)=>d.shelves[0].x=63,
      (d:any)=>d.stockpiles.push({...pos(18),priority:1,accepts:['wood']}),
    ]){const d=structuredClone(base);mutate(d);expect(()=>VoxelSimulation.load(d)).toThrow();}
    const unsupported=fixture('shelf');unsupported.blocks[index(18,16,7)]=0;
    expect(()=>VoxelSimulation.load(unsupported.save())).toThrow(/支撑/);
    const relabeled:any=structuredClone(base);delete relabeled.storageGroups;relabeled.version=36;expect(()=>VoxelSimulation.load(relabeled)).toThrow(/旧版本包含新版货架/);
  });
  it('protects outdoor goods from deterioration while warm food continues to rot',()=>{
    const s=fixture();for(let x=10;x<=30;x++)for(let y=12;y<=23;y++)for(let z=10;z<16;z++)s.blocks[index(x,y,z)]=0;
    (s as any).roomsDirty=true;s.revision++;s.updateRooms();
    const food=item(s,'grain',20),ground=item(s,'grain',20,pos(20));s.step(60);
    const env=s.snapshot().environment.items;
    expect(env.find((e:any)=>e.id===food.id)).toMatchObject({rate:0,environment:{protected:true}});
    expect(env.find((e:any)=>e.id===ground.id)?.rate).toBeGreaterThan(0);
    expect(food.rotProgress).toBeGreaterThan(0);
  });
});
