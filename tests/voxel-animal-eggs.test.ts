import { describe, expect, it, vi } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { EGG_RULES, advanceEggLayer, advanceHatcher, eggLayerActive, freshFertilizedEggs } from '../src/voxel/animalEggs';
import { initialAnimalState } from '../src/voxel/husbandry';
import { freshBatch, portion, mergeBatch, validBatch, advanceRot } from '../src/voxel/preservation';
import { simulateCellInsert } from '../src/voxel/logistics';
import { quoteTrade } from '../src/voxel/tradeWorld';
import { Block, DAY, index, at, type WildAnimal, type Pos, type Cargo } from '../src/voxel/types';

const pos=(x:number,y=16):Pos=>({x,y,z:8});
function chicken(id:number,extra:Partial<WildAnimal>={}):WildAnimal{
  return {...pos(22),...initialAnimalState(id,'chicken',0),id,species:'chicken',name:'鸡',faction:'colony',
    tameness:5,sex:'female',health:20,hunger:90,dead:false,phase:'roam',hunt:false,moveTick:0,
    decisionTick:0,fleeUntil:0,threatId:null,retryTick:0,rotProgress:0,...extra};
}
/** Controlled room and animals isolate state transitions, not a natural campaign. */
function fixture(){
  const s=new VoxelSimulation(73129,{biome:'boreal',hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=28;x++)for(let y=10;y<=24;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p]of s.pawns.entries()){
    Object.assign(p,pos(12,16+i));p.schedule.fill('work');p.food=100;p.rest=100;
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0;
  }
  return VoxelSimulation.load(s.save());
}
function until(s:VoxelSimulation,done:()=>boolean,max=1000){
  for(let n=0;n<max&&!done();n++)s.step();
  expect(done(),JSON.stringify({tick:s.tick,animals:s.animals.map(a=>({phase:a.phase,reason:a.reason,goal:a.goal,progress:a.layProgress}))})).toBe(true);
}
function egg(s:VoxelSimulation,amount=1){
  const batch={...freshFertilizedEggs(amount,'colony'),...pos(22),id:s.nextId++};s.items.push(batch);return batch;
}
function cookingFixture(){
  let s=fixture();s.pawns[0].priorities.cook=1;
  s.stoves.push({...pos(12,14),id:s.nextId++,target:0,paused:false});
  egg(s,2);s.items.push({...freshBatch('wood',1),...pos(16),id:s.nextId++});
  s=VoxelSimulation.load(s.save());
  const benchId=s.stoves[0].id;
  for(const b of s.snapshot().productionQueues[0].bills)expect(s.command({type:'productionBillDelete',benchId,billId:b.id}).ok).toBe(true);
  expect(s.command({type:'productionBillAdd',benchId,recipe:'cook'}).ok).toBe(true);
  const b=s.productionQueues[0].bills[0];
  expect(s.command({type:'productionBillUpdate',benchId,billId:b.id,patch:{mode:'count',remaining:1,
    policy:{...b.policy,allowedFood:['eggFertilized']}}}).ok).toBe(true);
  until(s,()=>s.jobs.some(j=>j.kind==='cook'&&j.progress>5),3000);
  return s;
}

describe('egg formation and self-directed laying',()=>{
  it('forms only in adult females regardless of faction and scales with hunger',()=>{
    for(const faction of ['wild','colony'] as const)for(const [hunger,multiplier] of [[90,1],[30,.5],[10,.25],[0,0]]){
      const a=chicken(100,{faction,hunger});expect(eggLayerActive(a)).toBe(true);advanceEggLayer(a);
      expect(a.eggProgress).toBe(multiplier/EGG_RULES.intervalTicks);
    }
    for(const change of [{sex:'male'},{growth:.5},{dead:true},{species:'hare'}] as Partial<WildAnimal>[]){
      const a=chicken(100,{...change,eggProgress:.3});advanceEggLayer(a);expect(a.eggProgress).toBe(.3);
    }
  });
  it('lays an unfertilized egg without a male, handler or pregnancy and resumes saved work',()=>{
    let s=fixture();const id=s.nextId++;s.animals.push(chicken(id,{eggProgress:1}));
    until(s,()=>s.animals[0].layProgress>=35);const work=s.animals[0].layProgress;
    s=VoxelSimulation.load(s.save());expect(s.animals[0].layProgress).toBe(work);
    until(s,()=>s.stats.produced.eggUnfertilized===1);
    expect(s.pawns.every(p=>p.handleTask===null)).toBe(true);expect(s.animals[0].pregnancy).toBeNull();
    expect(s.items.find(b=>b.resource==='eggUnfertilized')?.amount).toBe(1);
    expect(s.animals[0].eggProgress).toBe(0);s.step(100);expect(s.stats.produced.eggUnfertilized).toBe(1);
  });
  it('walks to an existing same-room egg pile before laying',()=>{
    const s=fixture();const id=s.nextId++;s.animals.push(chicken(id,{eggProgress:1}));
    s.items.push({...freshBatch('eggUnfertilized',2),...pos(25),id:s.nextId++});
    s.items.push({...freshFertilizedEggs(1),...pos(23),id:s.nextId++});
    s.step();expect(s.animals[0].goal?.kind).toBe('layEgg');expect(s.animals[0].layProgress).toBe(0);
    until(s,()=>s.stats.produced.eggUnfertilized===1);
    expect(s.animals[0].x).toBeGreaterThanOrEqual(24);expect(s.counts().eggUnfertilized).toBe(3);
  });
  it('keeps a full egg through danger and restarts a new laying job from zero',()=>{
    const s=fixture(),a=chicken(s.nextId++,{eggProgress:1});s.animals.push(a);
    until(s,()=>a.layProgress>=40);a.threatId=s.pawns[0].id;a.fleeUntil=s.tick+5;
    s.step();expect(a.layProgress).toBe(0);expect(a.eggProgress).toBe(1);
    until(s,()=>s.stats.produced.eggUnfertilized===1);expect(s.counts().eggUnfertilized).toBe(1);
  });
  it('fertilizes exactly one future egg after mating without a pregnancy roll',()=>{
    let s=fixture();const female=chicken(s.nextId++,{decisionTick:1e6}),male=chicken(s.nextId++,{...pos(21),sex:'male',nextMateTick:0});
    s.animals.push(female,male);until(s,()=>female.fertilizationCount===1);
    expect(female.pregnancy).toBeNull();expect(female.eggFatherId).toBe(male.id);
    female.eggProgress=1;female.decisionTick=0;
    s=VoxelSimulation.load(s.save());until(s,()=>s.stats.produced.eggFertilized===1);
    const laid=s.items.find(i=>i.resource==='eggFertilized')!;
    expect(laid.hatcher).toMatchObject({motherId:female.id,fatherId:male.id,faction:'colony'});
    expect(s.animals[0].fertilizationCount).toBe(0);expect(s.animals[0].eggFatherId).toBeNull();
  });
  it('holds completed work and fertility while output is blocked, then places once',()=>{
    const s=fixture(),a=chicken(s.nextId++,{eggProgress:1});s.animals.push(a);
    const blocked=vi.spyOn(s,'animalEggPlace').mockReturnValue(false);
    s.step(EGG_RULES.layWork+20);expect(a.layProgress).toBe(EGG_RULES.layWork);expect(a.eggProgress).toBe(1);
    expect(s.counts().eggUnfertilized).toBe(0);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
    blocked.mockRestore();s.step();expect(s.stats.produced.eggUnfertilized).toBe(1);expect(a.layProgress).toBe(0);
  });
});

describe('physical incubation, damage, and stack identity',()=>{
  it('ticks incubation outside the safe band until irreversible temperature damage reaches one',()=>{
    const b=freshFertilizedEggs(2,'colony');advanceHatcher(b,-10,100);
    expect(b.hatcher!.progress).toBeCloseTo(100/EGG_RULES.hatchTicks);expect(b.hatcher!.temperatureDamage).toBeCloseTo(.15);
    advanceHatcher(b,20,100);expect(b.hatcher!.temperatureDamage).toBeCloseTo(.15);
    expect(advanceHatcher(b,60,1000)).toBe('ruined');
    for(const t of [0,50]){const c=freshFertilizedEggs(1);advanceHatcher(c,t,1000);expect(c.hatcher!.temperatureDamage).toBe(0);}
  });
  it('never rots live fertilized eggs, but ages ordinary eggs',()=>{
    const b=freshFertilizedEggs(1);expect(advanceRot(b,30,100*DAY)).toBe(false);expect(b.rotProgress).toBeUndefined();
    expect(advanceRot(freshBatch('eggUnfertilized',1),20,15*DAY)).toBe(true);
  });
  it('copies splits, averages progress and damage, and preserves the receiving stack parents',()=>{
    const a=freshFertilizedEggs(2,'colony',101,102),b=freshFertilizedEggs(1,'wild',201,202);
    a.hatcher!.progress=.9;a.hatcher!.temperatureDamage=.6;b.hatcher!.progress=.3;b.hatcher!.temperatureDamage=0;
    const split=portion(a,1);split.hatcher!.progress=.1;expect(a.hatcher!.progress).toBe(.9);
    const preview=simulateCellInsert([a],b,1);expect(a.hatcher!.progress).toBe(.9);expect(a.amount).toBe(2);
    expect(preview.stacks[0].hatcher!.progress).toBeCloseTo(.7);
    mergeBatch(a,b);expect(a.amount).toBe(3);expect(a.hatcher).toMatchObject({motherId:101,fatherId:102,faction:'colony'});
    expect(a.hatcher!.temperatureDamage).toBeCloseTo(.4);
  });
  it('hatches each physical egg once, generating independent juvenile identities across reload',()=>{
    let s=fixture();const b=egg(s,3);b.hatcher!.progress=1-2/EGG_RULES.hatchTicks;
    s.step();s=VoxelSimulation.load(s.save());until(s,()=>s.animals.length===3,10);
    expect(new Set(s.animals.map(a=>a.id)).size).toBe(3);expect(s.animals.every(a=>a.species==='chicken'&&a.faction==='colony'&&a.growth<.01)).toBe(true);
    expect(s.animals.every(a=>!Object.hasOwn(a,'hatcher')&&!Object.hasOwn(a,'resource')&&!Object.hasOwn(a,'amount'))).toBe(true);
    expect(s.counts().eggFertilized).toBe(0);expect(s.stats.consumed.eggFertilized).toBe(3);
    const ids=s.animals.map(a=>a.id);s=VoxelSimulation.load(s.save());s.step(10);expect(s.animals.map(a=>a.id)).toEqual(ids);
  });
  it('keeps a ready egg while placement is blocked, including across reload',()=>{
    let s=fixture();egg(s,2).hatcher!.progress=1;
    const blocked=vi.spyOn(s,'animalCanStop').mockReturnValue(false);s.step(3);
    expect(s.animals).toHaveLength(0);expect(s.counts().eggFertilized).toBe(2);expect(s.stats.consumed.eggFertilized).toBe(0);
    const save=s.save();blocked.mockRestore();s=VoxelSimulation.load(save);s.step();
    expect(s.animals).toHaveLength(2);expect(s.counts().eggFertilized).toBe(0);
  });
  it('converts thermally ruined eggs to fresh full-condition edible eggs with conserved counts',()=>{
    const s=fixture(),b=egg(s,3);b.hatcher!.temperatureDamage=.999;b.hitPoints=1;b.forbidden=true;
    vi.spyOn(s,'temperature').mockReturnValue(-20);s.step();
    const result=s.items.find(i=>i.id===b.id)!;expect(result.resource).toBe('eggUnfertilized');expect(result.amount).toBe(3);
    expect(result.hatcher).toBeUndefined();expect(result.hitPoints).toBeUndefined();expect(result.rotProgress).toBe(0);
    expect(result.forbidden).toBe(true);expect(s.stats.consumed.eggFertilized).toBe(3);expect(s.stats.produced.eggUnfertilized).toBe(3);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('incubates carried eggs at their holder and releases interrupted hauling without duplication',()=>{
    let s=fixture();s.pawns[0].cargo=freshFertilizedEggs(1,'colony');s.pawns[0].cargo.hatcher!.progress=1;
    s=VoxelSimulation.load(s.save());s.step();expect(s.pawns[0].cargo).toBeNull();expect(s.animals).toHaveLength(1);
    expect(Object.hasOwn(s.animals[0],'cargo')).toBe(false);expect(Object.hasOwn(s.animals[0],'skills')).toBe(false);
    expect(s.stats.consumed.eggFertilized).toBe(1);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('returns converted cooking inputs even when refund space is temporarily blocked',()=>{
    let s=cookingFixture();const j=s.jobs.find(j=>j.kind==='cook')!;
    j.deliveredBatches.find(b=>b.resource==='eggFertilized')!.hatcher!.temperatureDamage=.999;
    vi.spyOn(s,'temperature').mockReturnValue(-20);
    const blocked=vi.spyOn(s as any,'planPlacement').mockReturnValue(null);
    s.step();expect(j.cancelled).toBe(true);expect(j.delivered.eggUnfertilized).toBe(2);
    expect(j.cost.eggUnfertilized).toBe(2);expect(j.delivered.eggFertilized).toBeUndefined();
    expect(s.stats.cooked).toBe(0);const save=s.save();blocked.mockRestore();
    s=VoxelSimulation.load(save);s.step(100);expect(s.jobs.some(k=>k.id===j.id)).toBe(false);
    expect(s.counts().eggUnfertilized).toBe(2);expect(s.stats.consumed.eggFertilized).toBe(2);
    expect(s.stats.produced.eggUnfertilized).toBe(2);expect(s.stats.cooked).toBe(0);
  });
  it('hatches delivered recipe eggs, cancels cooking and refunds the remaining real fuel',()=>{
    const s=cookingFixture(),j=s.jobs.find(j=>j.kind==='cook')!;
    j.deliveredBatches.find(b=>b.resource==='eggFertilized')!.hatcher!.progress=1;
    s.step();expect(s.animals).toHaveLength(2);expect(s.stats.cooked).toBe(0);
    expect(s.animals.every(a=>!Object.hasOwn(a,'deliveredBatches')&&!Object.hasOwn(a,'cost'))).toBe(true);
    expect(s.counts().eggFertilized).toBe(0);expect(s.counts().wood).toBe(1);
    expect(s.stats.consumed.eggFertilized).toBe(2);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('retains historical merchant egg cargo, transfers ownership atomically and rejects a replay',()=>{
    let s=new VoxelSimulation(73129);s.tradeSpawn();
    const c=s.trade.caravans[0],p=s.pawns.find(p=>p.faction==='colony')!;
    expect(c.kind).toBe('bulk');expect(c.stock.some(i=>i.resource==='eggFertilized')).toBe(false);
    // Retained v51/v52 cargo remains buyable; new merchants bring live chickens.
    c.stock.push({...freshFertilizedEggs(4),id:s.nextId++,carrierId:c.traderId});
    expect(s.command({type:'tradeTalk',pawnId:p.id,caravanId:c.id}).ok).toBe(true);
    until(s,()=>quoteTrade(s)!==null,2500);const q=quoteTrade(s)!,offer=q.offers.find(o=>o.side==='trader'&&o.batch.resource==='eggFertilized')!;
    const buy={type:'tradeCommit' as const,sessionId:q.sessionId,quoteKey:q.key,
      lines:[{side:'trader' as const,stockId:offer.stockId,amount:2}],gift:false,acceptShortfall:false};
    const before=s.counts().silver;expect(s.command(buy).ok).toBe(true);
    const owned=s.items.find(i=>i.resource==='eggFertilized')!;
    expect(owned.amount).toBe(2);expect(owned.hatcher!.faction).toBe('colony');
    expect(c.stock.find(i=>i.id===offer.stockId)?.hatcher?.faction).toBe('wild');
    expect(s.counts().silver).toBeLessThan(before);expect(s.trade.imported.eggFertilized).toBe(2);
    const saved=s.save();expect(s.command(buy).ok).toBe(false);expect(s.save()).toEqual(saved);
    s=VoxelSimulation.load(saved);s.items.find(i=>i.id===owned.id)!.hatcher!.progress=1;s.step();
    expect(s.animals.filter(a=>a.species==='chicken'&&a.faction==='colony')).toHaveLength(2);
    expect(s.trade.caravans[0].stock.find(i=>i.id===offer.stockId)?.amount).toBe(2);
  },15000);
  it('rejects missing hatcher identity, stale damage, invalid parents and impossible egg-laying states',()=>{
    expect(()=>freshBatch('eggFertilized',1)).toThrow();expect(validBatch({resource:'eggFertilized',amount:1})).toBe(false);
    const bad=freshFertilizedEggs(1);bad.hatcher!.temperatureDamage=1;expect(validBatch(bad)).toBe(false);
    const s=fixture();egg(s).hatcher!.fatherId=s.nextId+100;expect(()=>VoxelSimulation.load(s.save())).toThrow();
    s.items[0].hatcher!.fatherId=s.pawns[0].id;expect(()=>VoxelSimulation.load(s.save())).toThrow('父母身份');
    s.items=[];s.animals=[chicken(s.nextId++,{sex:'male',eggProgress:.5})];expect(()=>VoxelSimulation.load(s.save())).toThrow();
    s.animals=[chicken(s.animals[0].id,{layProgress:10})];expect(()=>VoxelSimulation.load(s.save())).toThrow();
  });
});
