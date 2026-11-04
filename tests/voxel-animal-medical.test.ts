import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { newTraderAnimal } from '../src/voxel/animalTrade';
import { advanceAnimalMedical, animalBodyParts, animalMedicalSummary, injureAnimal, tendAnimal } from '../src/voxel/animalMedical';
import { startAnimalCare, tryAnimalCare, animalMedicalTick } from '../src/voxel/animalMedicalWorld';
import { freshBatch } from '../src/voxel/preservation';
import { Block, DAY, at, index, type VoxelSave } from '../src/voxel/types';

const pos=(x:number,y=16)=>({x,y,z:8});
let baseline:VoxelSave|undefined;
function hospital() {
  if(!baseline) {
    const s=new VoxelSimulation(73129,{biome:'temperate',hilliness:'flat',meanTemperature:24,latitude:0},false,2);
    s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];s.beds=[];
    s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);s.explored.fill(1);
    for(let x=10;x<=35;x++)for(let y=10;y<=24;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
    s.spawn=pos(18);s.homeArea.clear();
    for(const [i,p]of s.pawns.entries()){Object.assign(p,pos(16,16+i));p.schedule.fill('work');p.food=100;p.rest=100;
      for(const k of Object.keys(p.priorities))p.priorities[k as keyof typeof p.priorities]=0;}
    baseline=s.save();
  }
  const s=VoxelSimulation.load(baseline),p=s.pawns[0];p.priorities.care=1;p.skills.medicine.level=10;
  const a=newTraderAnimal(s.nextId++,'alpaca','female',s.tick,pos(25));a.faction='colony';a.reason='殖民地动物';s.animals=[a];
  s.items.push({...pos(19,18),...freshBatch('herb',4),id:s.nextId++},{...pos(20,18),...freshBatch('grain',30),id:s.nextId++});
  expect(s.command({type:'designate',tool:'animalBed',from:pos(29)}).ok).toBe(true);
  return {s,p,a,bed:s.animalBeds[0]};
}
function until(s:VoxelSimulation,predicate:()=>boolean,limit=1600){for(let n=0;n<limit&&!predicate();n++)s.step();expect(predicate()).toBe(true);}

describe('animal injury, real doctor logistics and recovery',()=>{
  it('separates bird legs from quadruped limbs and stops bleeding without instant health refill',()=>{
    const a=newTraderAnimal(1,'chicken','female',0,pos(12));
    expect(animalBodyParts('chicken')).not.toContain('frontLeft');expect(animalBodyParts('alpaca')).toHaveLength(6);
    injureAnimal(a,12,'cut');expect(a.medical.downed).toBe(true);expect(animalMedicalSummary(a).bleeding).toBeGreaterThan(0);
    const hp=a.health;expect(tendAnimal(a,.6,true)).toBe(true);expect(a.health).toBe(hp);expect(animalMedicalSummary(a).bleeding).toBe(0);
    for(let n=0;n<DAY*4;n++)advanceAnimalMedical(a,true);
    expect(a.medical.wounds).toEqual([]);expect(a.medical.downed).toBe(false);expect(a.health).toBeCloseTo(20,5);
  });
  it('makes lethal bleeding produce one physical carcass and clears bed/care links',()=>{
    const {s,a}=hospital();injureAnimal(a,20);a.medical.bloodLoss=.99999;
    const before=s.stats.produced.carcass;s.step();
    expect(s.stats.produced.carcass).toBe(before+1);expect(s.items.filter(i=>i.carcass?.animalId===a.id)).toHaveLength(1);
    s.step(10);expect(s.stats.produced.carcass).toBe(before+1);expect(s.animals.some(b=>b.id===a.id)).toBe(false);
  });
  it('fetches actual herbs, treats at the patient, then carries and feeds the same animal',()=>{
    const {s,p,a,bed}=hospital();injureAnimal(a,55);a.hunger=15;
    const start=at(a);expect(tryAnimalCare(s,p)).toBe(true);expect(p.animalCareTask?.stage).toBe('fetch');
    expect(s.stats.consumed.herb).toBe(0);expect(a.medical.wounds[0].tended).toBeNull();
    until(s,()=>a.medical.wounds[0]?.tended!==null);
    expect(s.stats.consumed.herb).toBe(1);expect(a.health).toBeLessThan(25);expect(at(a)).toBe(start);
    until(s,()=>p.animalCareTask?.stage==='carry');
    expect(a.id).toBe(s.animals[0].id);expect(at(a)).toBe(at(p));expect(at(a)).not.toBe(at(bed));
    until(s,()=>a.medical.bedId===bed.id&&a.medical.carriedBy===null);
    expect(at(a)).toBe(at(bed));
    until(s,()=>s.stats.consumed.grain>0);expect(a.hunger).toBeGreaterThan(80);
    expect(s.stats.produced.carcass).toBe(0);expect(s.animals.filter(b=>b.id===a.id)).toHaveLength(1);
    // Ordinary idle workers retain the existing load-time scheduling reset.
    // Patient identity/biology, beds, cargo and accounting must remain exact.
    const saved=s.save(),loaded=VoxelSimulation.load(saved).save();
    expect(loaded.animals).toEqual(saved.animals);expect(loaded.animalBeds).toEqual(saved.animalBeds);
    expect(loaded.stats).toEqual(saved.stats);expect(loaded.pawns.map(p=>p.cargo)).toEqual(saved.pawns.map(p=>p.cargo));
  },20000);
  it('lets handlers rescue and feed but reserves tending for doctors, regardless of animal skill',()=>{
    const {s,p,a}=hospital();p.priorities.care=0;p.priorities.handle=1;p.skills.animals.level=20;injureAnimal(a,55);
    expect(startAnimalCare(s,p,a,'tend')).toBe(false);expect(startAnimalCare(s,p,a,'rescue')).toBe(true);
    const other=s.pawns[1];other.priorities.care=1;expect(startAnimalCare(s,other,a,'tend')).toBe(false);
    expect(s.command({type:'draft',pawnId:p.id,drafted:true}).ok).toBe(true);
    expect(p.animalCareTask).toBeUndefined();expect(startAnimalCare(s,other,a,'tend')).toBe(true);
  });
  it('uses no-medicine tending without consuming herbs and respects no care',()=>{
    const {s,p,a}=hospital();injureAnimal(a,18);a.medical.policy='none';
    expect(startAnimalCare(s,p,a,'tend')).toBe(false);
    expect(s.command({type:'animalMedicalPolicy',animalId:a.id,policy:'noMedicine'}).ok).toBe(true);
    expect(startAnimalCare(s,p,a,'tend')).toBe(true);expect(p.animalCareTask?.stage).toBe('approach');
    until(s,()=>a.medical.wounds[0]?.tended!==null);expect(s.stats.consumed.herb).toBe(0);
    expect(a.medical.wounds[0].tended).toBeLessThanOrEqual(.4);
  },10000);
  it('drops a rescued animal at the carrier when drafted and preserves its identity',()=>{
    const {s,p,a}=hospital();injureAnimal(a,55,'bruise');expect(startAnimalCare(s,p,a,'rescue')).toBe(true);
    until(s,()=>p.animalCareTask?.stage==='carry');const location=at(p);
    expect(s.command({type:'draft',pawnId:p.id,drafted:true}).ok).toBe(true);
    expect(a.medical.carriedBy).toBeNull();expect(p.animalCareTask).toBeUndefined();expect(at(a)).toBe(location);
    expect(a.medical.bedId).toBeNull();expect(VoxelSimulation.load(s.save()).animals.find(b=>b.id===a.id)?.medical.carriedBy).toBeNull();
  },10000);
  it('keeps borrowed ownership and requires an explicit rescue for a wild animal',()=>{
    const {s,p,a,bed}=hospital();a.faction='wild';a.tameness=0;injureAnimal(a,55,'bruise');
    expect(tryAnimalCare(s,p)).toBe(false);
    expect(s.command({type:'animalCare',pawnId:p.id,animalId:a.id,action:'rescue'}).ok).toBe(true);
    until(s,()=>a.medical.bedId===bed.id);expect(a.faction).toBe('wild');expect(a.medical.rescue).toBe(true);
    expect(s.trade.animalLedger.bought.alpaca).toBe(0);
  },10000);
  it('sends an ambulatory patient to a physical bed and releases it when recovered',()=>{
    const {s,p,a,bed}=hospital();p.priorities.care=0;injureAnimal(a,8,'bruise');
    until(s,()=>at(a)===at(bed));expect(a.medical.bedId).toBe(bed.id);expect(a.phase).toBe('medicalRest');
    for(let n=0;n<DAY;n++)advanceAnimalMedical(a,true);
    animalMedicalTick(s,a);expect(a.medical.bedId).toBeNull();expect(a.phase).toBe('roam');
  },10000);
  it('cancels a fetch when a reserved herb is forbidden without losing food or medicine',()=>{
    const {s,p,a}=hospital();injureAnimal(a,20);expect(startAnimalCare(s,p,a,'tend')).toBe(true);
    const herb=s.items.find(i=>i.id===p.animalCareTask?.sourceId)!;
    expect(s.command({type:'itemForbidden',itemId:herb.id,forbidden:true}).ok).toBe(true);
    expect(p.animalCareTask).toBeUndefined();expect(herb.amount).toBe(4);expect(s.stats.consumed.herb).toBe(0);
  });
  it('preserves a carried animal when its reserved sleeping point is removed',()=>{
    const {s,p,a,bed}=hospital();injureAnimal(a,55,'bruise');expect(startAnimalCare(s,p,a,'rescue')).toBe(true);
    until(s,()=>p.animalCareTask?.stage==='carry');const place=at(p);
    expect(s.command({type:'animalBedRemove',bedId:bed.id}).ok).toBe(true);
    expect(a.medical.carriedBy).toBeNull();expect(at(a)).toBe(place);expect(s.animalBeds).toEqual([]);
    expect(VoxelSimulation.load(s.save()).animals.find(b=>b.id===a.id)?.medical.bedId).toBeNull();
  },10000);
});
