import { describe, expect, it, vi } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { newTraderAnimal, animalMarketValue, traderAcceptsAnimal } from '../src/voxel/animalTrade';
import { quoteTrade, updateTrade } from '../src/voxel/tradeWorld';
import { updateHusbandry, tryHandle } from '../src/voxel/husbandryWorld';
import { Block, at, index, type WildAnimal } from '../src/voxel/types';
import { freshBatch } from '../src/voxel/preservation';
import { colonyWealthDetails } from '../src/voxel/wealth';
import { EGG_RULES } from '../src/voxel/animalEggs';

const pos=(x:number,y=16)=>({x,y,z:8});
/** Controlled headless market isolates transactions; arrival has its own test. */
function market(ready=true) {
  let s=new VoxelSimulation(73129,{biome:'temperate',hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);s.explored.fill(1);
  for(let x=0;x<64;x++)for(let y=10;y<=24;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(22);s.homeArea.clear();
  for(const [i,p] of s.pawns.entries()) { Object.assign(p,pos(21,16+i));p.schedule.fill('work');p.food=100;p.rest=100;
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0; }
  s=VoxelSimulation.load(s.save());s.tradeSpawn();
  const c=s.trade.caravans[0];expect(c.kind).toBe('bulk');
  const trader=s.pawns.find(p=>p.id===c.traderId)!,p=s.pawns[0];
  if(ready) {
    for(const [i,p] of s.pawns.filter(p=>p.faction==='trader').entries())Object.assign(p,pos(22,12+i%12));
    Object.assign(trader,pos(22));c.stage='visiting';c.visitingAt=s.tick;
    for(const [i,a] of s.animals.entries())Object.assign(a,pos(25+i),{path:[],goal:null});
    p.phase='trade';s.trade.session={id:s.nextId++,caravanId:c.id,pawnId:p.id,stage:'ready',startedAt:s.tick};
  }
  for(let y=14;y<=17;y++) { s.items.push({...pos(20,y),...freshBatch('silver',500),id:s.nextId++});s.homeArea.add(at(pos(20,y))); }
  return {s,c,p,trader};
}
function commit(s:VoxelSimulation, ids:{side:'colony'|'trader';id:number;amount?:number}[], gift=false) {
  const q=quoteTrade(s)!;expect(q).not.toBeNull();
  return s.command({type:'tradeCommit',sessionId:q.sessionId,quoteKey:q.key,
    lines:ids.map(r=>({side:r.side,stockId:r.id,amount:r.amount??1})),gift,acceptShortfall:false});
}
function reopen(s:VoxelSimulation) {
  const p=s.pawns[0],c=s.trade.caravans[0];p.phase='trade';p.path=[];p.destination=null;
  s.trade.session={id:s.nextId++,caravanId:c.id,pawnId:p.id,stage:'ready',startedAt:s.tick};
}
const biology=(a:WildAnimal)=>({id:a.id,sex:a.sex,age:a.ageTicks,growth:a.growth,health:a.health,hunger:a.hunger,
  malnutrition:a.malnutrition,pregnancy:a.pregnancy,milk:a.milkFullness,wool:a.woolGrowth,egg:a.eggProgress,
  fertilization:a.fertilizationCount,father:a.eggFatherId});

describe('live animals, individual settlement and physical caravan ownership',()=>{
  it('walks both visitors and live stock in from the edge before negotiating',()=>{
    const {s,c,p}=market(false),starts=new Map(s.animals.map(a=>[a.id,at(a)]));
    expect(s.animals.every(a=>a.x===0||a.x===63||a.y===0||a.y===63)).toBe(true);
    expect(s.command({type:'tradeTalk',pawnId:p.id,caravanId:c.id}).ok).toBe(true);
    for(let n=0;n<1600&&(!quoteTrade(s)||c.stage!=='visiting');n++)s.step();
    expect(quoteTrade(s)).not.toBeNull();expect(c.stage).toBe('visiting');
    expect(s.animals.some(a=>starts.get(a.id)!==at(a))).toBe(true);
    expect(VoxelSimulation.load(s.save()).trade.caravans[0].animalIds).toEqual(c.animalIds);
  },15000);
  it('brings real farm pairs within the animal cap and replaces generated fertile eggs',()=>{
    const {s,c}=market();expect(c.animalIds).toHaveLength(4);
    expect(s.animals.filter(a=>a.species==='chicken').map(a=>a.sex)).toEqual(['female','male']);
    expect(c.stock.some(b=>b.resource==='eggFertilized')).toBe(false);
    expect(VoxelSimulation.load(s.save()).save()).toEqual(s.save());
    for(const species of ['chicken','alpaca','dromedary'] as const)expect(traderAcceptsAnimal('bulk',{species})).toBe(true);
    for(const species of ['hare','deer'] as const)expect(traderAcceptsAnimal('bulk',{species})).toBe(false);
    expect(traderAcceptsAnimal('combat',{species:'chicken'})).toBe(false);
  });
  it('lists animals outside Home and preserves the same female and biological state on purchase',()=>{
    const {s,c}=market(),a=s.animals[0];a.health=18;a.hunger=72;a.malnutrition=.08;a.eggProgress=.8;
    a.fertilizationCount=1;a.eggFatherId=s.animals[1].id;
    const before=structuredClone(biology(a)),location=at(a),silver=s.counts().silver;
    expect(s.homeArea.has(at(a))).toBe(false);expect(quoteTrade(s)!.animalOffers.some(o=>o.stockId===a.id)).toBe(true);
    expect(commit(s,[{side:'trader',id:a.id}]).ok).toBe(true);
    expect(s.animals.find(b=>b.id===a.id)).toBe(a);expect(at(a)).toBe(location);expect(biology(a)).toEqual(before);
    expect(a.faction).toBe('colony');expect(c.animalIds).not.toContain(a.id);
    expect(s.trade.animalLedger.bought.chicken).toBe(1);expect(s.trade.imported.carcass).toBe(0);
    expect(s.counts().silver).toBeLessThan(silver);expect(s.trade.receipts.at(-1)!.animalTransfers[0].animal.faction).toBe('trader');
    expect(VoxelSimulation.load(s.save()).animals.find(b=>b.id===a.id)).toEqual(a);
  });
  it('combines animal and item lines and retains a single replay-proof receipt',()=>{
    const {s,c}=market(),a=s.animals[0],good=c.stock.find(b=>b.resource==='components')!;
    const q=quoteTrade(s)!,command={type:'tradeCommit' as const,sessionId:q.sessionId,quoteKey:q.key,gift:false,acceptShortfall:false,
      lines:[{side:'trader' as const,stockId:a.id,amount:1},{side:'trader' as const,stockId:good.id,amount:2}]};
    expect(s.command(command).ok).toBe(true);expect(s.trade.imported.components).toBe(2);
    expect(s.trade.receipts[0].transferred).toHaveLength(1);expect(s.trade.receipts[0].animalTransfers).toHaveLength(1);
    const saved=s.save();expect(s.command(command).ok).toBe(false);expect(s.save()).toEqual(saved);
  });
  it('preserves environmental illness through actual purchase, resale and independent historical receipts',()=>{
    const {s}=market(),a=s.animals[0];
    a.environment={hypothermia:.2,heatstroke:.04};
    const state=structuredClone(a.environment),id=a.id;
    expect(commit(s,[{side:'trader',id}]).ok).toBe(true);
    expect(a.faction).toBe('colony');expect(a.environment).toEqual(state);
    reopen(s);expect(commit(s,[{side:'colony',id}]).ok).toBe(true);
    expect(a.faction).toBe('trader');expect(a.environment).toEqual(state);
    const snapshots=s.trade.receipts.flatMap(r=>r.animalTransfers.map(t=>t.animal));
    expect(snapshots).toHaveLength(2);
    for(const saved of snapshots){expect(saved.id).toBe(id);expect(saved.environment).toEqual(state);expect(saved.environment).not.toBe(a.environment);}
    expect(snapshots[0].environment).not.toBe(snapshots[1].environment);
    const loaded=VoxelSimulation.load(s.save());
    expect(loaded.animals.find(b=>b.id===id)?.environment).toEqual(state);
    expect(loaded.trade.receipts).toEqual(s.trade.receipts);
  });
  it('rolls back animal ownership and all money when mixed goods have no placement',()=>{
    const {s,c}=market(),a=s.animals[0],good=c.stock.find(b=>b.resource==='components')!;
    const before=s.save();vi.spyOn(s,'tradePlace').mockReturnValue(null);
    expect(commit(s,[{side:'trader',id:a.id},{side:'trader',id:good.id}]).ok).toBe(false);
    expect(s.save()).toEqual(before);
  });
  it('rejects stale, fractional, duplicate and over-count animal lines without mutation',()=>{
    const {s}=market(),a=s.animals[0],q=quoteTrade(s)!;
    for(const lines of [[{side:'trader' as const,stockId:a.id,amount:2}], [{side:'trader' as const,stockId:a.id,amount:.5}],
      [{side:'trader' as const,stockId:a.id,amount:1},{side:'trader' as const,stockId:a.id,amount:1}]]) {
      const before=s.save();expect(s.command({type:'tradeCommit',sessionId:q.sessionId,quoteKey:q.key,lines,gift:false,acceptShortfall:false}).ok).toBe(false);
      expect(s.save()).toEqual(before);
    }
    a.health-=1;const before=s.save();
    expect(s.command({type:'tradeCommit',sessionId:q.sessionId,quoteKey:q.key,lines:[{side:'trader',stockId:a.id,amount:1}],gift:false,acceptShortfall:false}).ok).toBe(false);
    expect(s.save()).toEqual(before);
  });
  it('blocks unavailable, wild, inaccessible and badly injured animals',()=>{
    const {s,c}=market(),a=s.animals[0];a.health=1;expect(quoteTrade(s)!.animalOffers.some(o=>o.stockId===a.id)).toBe(false);
    a.health=20;vi.spyOn(s,'tradeAnimalReachable').mockReturnValue(new Set());expect(quoteTrade(s)!.animalOffers).toEqual([]);vi.restoreAllMocks();
    a.faction='wild';a.tameness=0;c.animalIds=c.animalIds.filter(id=>id!==a.id);
    expect(quoteTrade(s)!.animalOffers.some(o=>o.stockId===a.id)).toBe(false);
  });
  it('sells a pregnant individual, cancels handling, and attaches its later newborn to the same caravan',()=>{
    const {s,c}=market();const mother=newTraderAnimal(s.nextId++,'dromedary','female',s.tick,pos(29));
    const father=newTraderAnimal(s.nextId++,'dromedary','male',s.tick,pos(30));
    mother.faction=father.faction='colony';mother.pregnancy={fatherId:father.id,progress:1};mother.milkFullness=.7;
    s.animals.push(mother,father);mother.slaughter=true;const handler=s.pawns[1];handler.priorities.handle=1;
    handler.phase='handle';handler.handleTask={animalId:mother.id,action:'slaughter',stage:'approach',foodId:null,amount:0,feedings:0,progress:0};
    const before=structuredClone(biology(mother));expect(commit(s,[{side:'colony',id:mother.id}]).ok).toBe(true);
    expect(biology(mother)).toEqual(before);expect(handler.handleTask).toBeNull();expect(mother.slaughter).toBe(false);
    expect(c.animalIds).toContain(mother.id);expect(s.trade.animalLedger.sold.dromedary).toBe(1);
    updateHusbandry(s);const child=s.animals.find(a=>a.species==='dromedary'&&a.ageTicks===0)!;
    expect(child).toBeDefined();expect(child.faction).toBe('trader');expect(c.animalIds).toContain(child.id);
    expect(mother.pregnancy).toBeNull();expect(VoxelSimulation.load(s.save()).animals.some(a=>a.id===child.id)).toBe(true);
  });
  it('gifts only a real animal, records no Cargo, and can reload the receipt',()=>{
    const {s,c}=market(),a=s.animals[0];s.tradeAnimalTransfer(a,'colony',c);
    const silver=s.counts().silver;expect(commit(s,[{side:'colony',id:a.id}],true).ok).toBe(true);
    expect(s.counts().silver).toBe(silver);expect(s.trade.receipts[0].transferred).toEqual([]);
    expect(s.trade.receipts[0].animalTransfers).toHaveLength(1);expect(a.faction).toBe('trader');
    expect(VoxelSimulation.load(s.save()).trade.receipts).toEqual(s.trade.receipts);
  });
  it('excludes merchant animals from colony work and counts bought animals as pawn wealth',()=>{
    const {s,c,p}=market(),a=s.animals[0];
    p.phase='idle';s.trade.session=null;p.priorities.handle=1;a.hunger=10;
    expect(tryHandle(s,p)).toBe(false);
    for(const order of ['tame','slaughter','release'] as const)expect(s.command({type:'animalOrder',animalId:a.id,order,enabled:true}).ok).toBe(false);
    const before=colonyWealthDetails(s).pawns;s.tradeAnimalTransfer(a,'colony',c);
    expect(colonyWealthDetails(s).pawns-before).toBeCloseTo(animalMarketValue(a));
  });
  it('lets a bought hen resume laying while visiting hens keep mature eggs',()=>{
    const {s}=market(),a=s.animals[0];a.eggProgress=1;
    for(let n=0;n<EGG_RULES.layWork+10;n++){s.tick++;updateHusbandry(s);}
    expect(a.eggProgress).toBe(1);expect(s.items.some(b=>b.resource==='eggUnfertilized')).toBe(false);
    // Restore adjacency after the controlled needs ticks, then purchase.
    Object.assign(s.pawns[0],pos(21));Object.assign(s.pawns.find(p=>p.id===s.trade.caravans[0].traderId)!,pos(22));
    reopen(s);expect(commit(s,[{side:'trader',id:a.id}]).ok).toBe(true);
    for(let n=0;n<400&&!s.items.some(b=>b.resource==='eggUnfertilized');n++){s.tick++;updateHusbandry(s);}
    expect(s.items.some(b=>b.resource==='eggUnfertilized')).toBe(true);
  });
  it('keeps blocked animals physical after humans depart, then walks them to a boundary',()=>{
    let {s,c}=market();const a=s.animals[0];c.animalIds=[a.id];s.animals=[a];
    s.trade.session=null;s.pawns[0].phase='idle';c.stage='leaving';
    for(const p of s.pawns.filter(p=>p.faction==='trader'))Object.assign(p,pos(0));
    const block=vi.spyOn(s,'animalNeighbors').mockReturnValue([]);
    for(let n=0;n<100;n++)s.step();
    expect(s.trade.caravans).toHaveLength(1);expect(c.animalIds).toContain(a.id);expect(s.animals).toContain(a);
    expect(a.reason).toContain('受阻');expect(s.pawns.some(p=>p.faction==='trader')).toBe(false);block.mockRestore();
    s=VoxelSimulation.load(s.save());const id=a.id;
    for(let n=0;n<1400&&s.animals.some(a=>a.id===id);n++)s.step();
    expect(s.animals.some(a=>a.id===id)).toBe(false);expect(s.trade.caravans).toEqual([]);
    expect(s.trade.exported.carcass).toBe(0);expect(s.stats.produced.carcass).toBe(0);
  },15000);
  it('removes dead merchant animal stock without duplicating a carcass or blocking save/load',()=>{
    const {s,c}=market(),a=s.animals[0];s.killAnimal(a,'验证');expect(c.animalIds).not.toContain(a.id);
    expect(quoteTrade(s)!.animalOffers.some(o=>o.stockId===a.id)).toBe(false);
    expect(s.stats.produced.carcass).toBe(1);expect(VoxelSimulation.load(s.save()).animals.find(b=>b.id===a.id)?.dead).toBe(true);
    updateTrade(s);expect(c.stock.every(b=>b.resource!=='carcass')).toBe(true);
  });
});
