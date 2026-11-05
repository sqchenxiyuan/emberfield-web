import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { newTraderAnimal } from '../src/voxel/animalTrade';
import { initialAnimalMedical, injureAnimal } from '../src/voxel/animalMedical';
import { startAnimalCare } from '../src/voxel/animalMedicalWorld';
import { migrateAnimalMedical, rejectLegacyAnimalMedical, validateAnimalMedical, validateAnimalMedicalState } from '../src/voxel/animalMedicalPersistence';
import { validateAnimalTrade } from '../src/voxel/animalTradePersistence';
import { freshBatch } from '../src/voxel/preservation';
import { Block, at, index, type VoxelSave } from '../src/voxel/types';
import { stripAnimalMedicalFields } from './legacy-animal-medical-defaults';
import { initialAnimalEnvironment } from '../src/voxel/animalEnvironment';

const pos = (x: number, y = 16) => ({ x, y, z: 8 });
let baseline: VoxelSave | undefined;
/** Synthetic current-world fixture; authentic historical replay is separate. */
function hospital() {
  if (!baseline) {
    const s = new VoxelSimulation(73129, { biome: 'temperate', hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
    s.animals = []; s.grass = []; s.items = []; s.trees = []; s.stockpiles = []; s.beds = [];
    s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0); s.explored.fill(1);
    for (let x = 10; x <= 35; x++) for (let y = 10; y <= 24; y++) for (let z = 8; z < 16; z++)
      s.blocks[index(x,y,z)] = Block.Air;
    s.spawn = pos(18); s.homeArea.clear();
    for (const [i,p] of s.pawns.entries()) {
      Object.assign(p,pos(16,16+i)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
      for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
    }
    baseline = s.save();
  }
  const s = VoxelSimulation.load(baseline), p = s.pawns[0]; p.priorities.care = 1; p.skills.medicine.level = 10;
  const a = newTraderAnimal(s.nextId++,'alpaca','female',s.tick,pos(25));
  a.faction = 'colony'; a.reason = '殖民地动物'; s.animals = [a];
  s.items.push({ ...pos(19,18), ...freshBatch('herb',4), id: s.nextId++ },
    { ...pos(20,18), ...freshBatch('grain',30), id: s.nextId++ });
  s.animalBeds.push({ ...pos(29), id: s.nextId++ });
  return { s, p, a, bed: s.animalBeds[0] };
}
function until(s: VoxelSimulation, predicate: () => boolean, limit = 1800) {
  for (let n = 0; n < limit && !predicate(); n++) s.step();
  expect(predicate()).toBe(true);
}
function reload(s: VoxelSimulation) {
  const before = s.save(), after = VoxelSimulation.load(before);
  const restored=after.save();
  for(const key of ['animals','animalBeds','items','stats','tick','nextId','trade'] as const)expect(restored[key]).toEqual(before[key]);
  for(const p of before.pawns)if(p.animalCareTask)expect(restored.pawns.find(q=>q.id===p.id)).toEqual(p);
  return after;
}

describe('v54 animal medical schema and migration', () => {
  it('adds independent empty medical states to live and historical animals without inventing injuries', () => {
    const old: any = { version: 53, tick: 92, animals: [{ species: 'alpaca', health: 8, phase: 'roam', path: [17] }],
      pawns: [{ phase: 'downed', medical: { humanHistory: true } }],
      trade: { receipts: [{ tick: 71, animalTransfers: [{ side: 'colony', animal: { species: 'chicken', health: 3 } }] }] } };
    const before = structuredClone(old);
    rejectLegacyAnimalMedical(old,53); migrateAnimalMedical(old,53);
    expect(old).toEqual({ ...before, animalBeds: [], animals: before.animals.map((a: any)=>({...a,medical:initialAnimalMedical()})),
      trade: { receipts: [{ ...before.trade.receipts[0], animalTransfers: [{ side: 'colony',
        animal: {...before.trade.receipts[0].animalTransfers[0].animal,medical:initialAnimalMedical()} }] }] } });
    old.animals[0].medical.policy = 'none';
    expect(old.trade.receipts[0].animalTransfers[0].animal.medical.policy).toBe('herbal');
    expect(old.pawns).toEqual(before.pawns); expect(old.version).toBe(53);
  });
  it('rejects medical fields and phases in older live or historical animals before migration', () => {
    const variants: ((d: any)=>void)[] = [
      d=>{d.animalBeds=[];}, d=>{d.pawns=[{animalCareTask:null}];}, d=>{d.pawns=[{phase:'animalCare'}];},
      d=>{d.animals=[{species:'hare',medical:initialAnimalMedical()}];},
      ...['medicalRest','downed','carried'].map(phase=>(d: any)=>{d.animals=[{species:'hare',phase}];}),
      d=>{d.trade.receipts=[{animalTransfers:[{animal:{species:'hare',medical:initialAnimalMedical()}}]}];},
      d=>{d.trade.receipts=[{animalTransfers:[{animal:{species:'hare',phase:'carried'}}]}];},
    ];
    for (const change of variants) {
      const d: any = {animals:[],pawns:[],trade:{receipts:[]}}; change(d); const before=structuredClone(d);
      expect(()=>rejectLegacyAnimalMedical(d,53)).toThrow(/旧版本/); expect(d).toEqual(before);
    }
    expect(()=>rejectLegacyAnimalMedical({pawns:[{phase:'downed',medical:{}}]},53)).not.toThrow();
  });
  it('preflights all old histories before mutating and never fills missing v54 fields', () => {
    const bad: any = {animals:[{health:8}],trade:{receipts:[{animalTransfers:[{animal:{health:3}},null]}]}};
    const before=structuredClone(bad);expect(()=>migrateAnimalMedical(bad,53)).toThrow();expect(bad).toEqual(before);
    for (const change of [(d:any)=>{delete d.animalBeds;},(d:any)=>{delete d.animals[0].medical;}]) {
      const d=hospital().s.save();change(d);const copy=structuredClone(d);
      migrateAnimalMedical(d,54);expect(d).toEqual(copy);expect(()=>VoxelSimulation.load(d)).toThrow();
    }
  });
  it('round-trips an explicitly synthetic v53 injured scalar animal without invented wounds or healing', () => {
    const {s,a}=hospital();s.animalBeds=[];a.health=8;
    const old:any=s.save();stripAnimalMedicalFields(old);old.version=53;const before=structuredClone(old);
    const loaded=VoxelSimulation.load(old), migrated=loaded.save();
    expect(migrated.version).toBe(58);expect(migrated.animals[0]).toEqual({...old.animals[0],medical:initialAnimalMedical(),environment:initialAnimalEnvironment()});
    expect(migrated.animalBeds).toEqual([]);expect(old).toEqual(before);
    loaded.step();expect(loaded.animals[0].health).toBe(8);
  });
  it('never lets the synthetic downgrade helper discard actual beds, wounds or care', () => {
    const {s,a}=hospital();const withBed=s.save();expect(()=>stripAnimalMedicalFields(withBed)).toThrow();
    s.animalBeds=[];injureAnimal(a,8);const wounded=s.save(),before=structuredClone(wounded);
    expect(()=>stripAnimalMedicalFields(wounded)).toThrow();expect(wounded).toEqual(before);
  });
});

describe('strict animal medical identity and state validation', () => {
  it('keeps wound IDs local and rejects malformed wounds, bird parts and excess scalar damage', () => {
    const {s,a}=hospital();injureAnimal(a,8);a.medical.wounds[0].id=s.pawns[0].id;a.medical.nextWoundId=s.pawns[0].id+1;
    expect(()=>validateAnimalMedical(s.save())).not.toThrow();
    const changes: ((a:any)=>void)[] = [
      a=>{a.medical.wounds.push(structuredClone(a.medical.wounds[0]));}, a=>{a.medical.nextWoundId=a.medical.wounds[0].id;},
      a=>{a.medical.wounds[0].severity=9;},a=>{a.medical.wounds[0].severity=NaN;},a=>{a.medical.wounds[0].tended=.8;},
      a=>{a.medical.wounds[0].ageTicks=1;},a=>{a.medical.bloodLoss=Infinity;},a=>{a.medical.extra=true;},
    ];
    for(const change of changes){const d=s.save();change(d.animals[0]);expect(()=>validateAnimalMedical(d)).toThrow();}
    const bird=newTraderAnimal(99,'chicken','female',0,pos(15));injureAnimal(bird,2);bird.medical.wounds[0].part='frontLeft';
    expect(()=>validateAnimalMedicalState(bird,100,0)).toThrow(/部位/);
  });
  it('rejects duplicate bed identities, overlapping cells, invented references and double reservations', () => {
    const {s,a,bed}=hospital();injureAnimal(a,8,'bruise');a.medical.bedId=bed.id;a.phase='medicalRest';
    const changes: ((d:any)=>void)[] = [
      d=>{d.animalBeds[0].id=d.pawns[0].id;},d=>{d.animalBeds.push({...d.animalBeds[0],id:d.nextId++});},
      d=>{d.animalBeds[0].extra=true;},d=>{d.animals[0].medical.bedId=d.nextId++;},
      d=>{d.animals.push({...structuredClone(d.animals[0]),id:d.nextId++});},
    ];
    for(const change of changes){const d=s.save();change(d);expect(()=>validateAnimalMedical(d)).toThrow();}
  });
  it('checks real bed terrain and furniture while permitting a stockpile and physical stack', () => {
    const {s,bed}=hospital();
    const result=s.command({type:'designate',tool:'stock',from:bed});
    expect(result.ok,result.message).toBe(true);
    s.items.push({...pos(bed.x),...freshBatch('wood',5),id:s.nextId++});
    const d=s.save();expect(VoxelSimulation.load(d).save().animalBeds).toEqual(d.animalBeds);
    const solid=VoxelSimulation.load(d);solid.blocks[at(bed)]=Block.Stone;expect(()=>VoxelSimulation.load(solid.save())).toThrow();
    const ladder=VoxelSimulation.load(d);ladder.ladders[at(bed)]=1;expect(()=>VoxelSimulation.load(ladder.save())).toThrow();
    const furniture=structuredClone(d);
    furniture.beds.push({...pos(27,20),id:furniture.nextId++,prisoner:false,quality:2,medical:false,owner:null,axis:'x'});
    expect(()=>VoxelSimulation.load(furniture)).not.toThrow();
    furniture.animalBeds[0]={...pos(27,20),id:bed.id};
    expect(()=>VoxelSimulation.load(furniture)).toThrow(/动物睡眠点/);
  });
  it('preserves a mobile patients path to a reserved bed with no resource goal', () => {
    const {s,p,a,bed}=hospital();p.priorities.care=0;injureAnimal(a,8,'bruise');s.step();
    expect(a.phase).toBe('medicalRest');expect(a.goal).toBeNull();expect(a.medical.bedId).toBe(bed.id);expect(a.path.length).toBeGreaterThan(0);
    reload(s);
  });
  it('checks historical wound snapshots without requiring historical bed or carer to survive', () => {
    const {s,a}=hospital();injureAnimal(a,8,'bruise');const bedId=s.nextId++,caravanId=s.nextId++;
    const historic=structuredClone(a);historic.phase='medicalRest';historic.medical.bedId=bedId;
    s.trade.receipts.push({id:s.nextId++,tick:s.tick,caravanId,pawnId:s.pawns[0].id,gift:false,
      silverToColony:0,quotedSilverToColony:0,shortfall:0,goodwillBefore:0,goodwillAfter:0,
      transferred:[],animalTransfers:[{side:'colony',animal:historic}]});s.trade.animalLedger.sold.alpaca++;
    const d=s.save();expect(()=>validateAnimalTrade(d)).not.toThrow();
    expect(VoxelSimulation.load(d).save().trade.receipts).toEqual(d.trade.receipts);
    delete (d.trade.receipts[0].animalTransfers[0].animal as any).medical;expect(()=>validateAnimalTrade(d)).toThrow();
  });
});

describe('ongoing animal rescue and supply persistence', () => {
  it('preserves fetching, picked-up herbs and fractional treatment progress without double consumption', () => {
    let {s,p,a}=hospital();p.skills.medicine.level=9;injureAnimal(a,20);expect(startAnimalCare(s,p,a,'tend')).toBe(true);
    expect(p.animalCareTask?.stage).toBe('fetch');s=reload(s);p=s.pawns[0];a=s.animals[0];
    until(s,()=>p.cargo?.resource==='herb'&&p.animalCareTask?.stage==='approach');
    expect(p.animalCareTask?.amount).toBe(0);expect(p.animalCareTask?.sourceId).toBeNull();s=reload(s);p=s.pawns[0];a=s.animals[0];
    until(s,()=>p.animalCareTask?.stage==='work'&&!!p.animalCareTask.progress);
    expect(Number.isInteger(p.animalCareTask!.progress)).toBe(false);s=reload(s);a=s.animals[0];
    until(s,()=>a.medical.wounds[0]?.tended!==null);expect(s.stats.consumed.herb).toBe(1);
    expect(s.items.filter(i=>i.resource==='herb').reduce((n,i)=>n+i.amount,0)+s.pawns.reduce((n,p)=>n+(p.cargo?.resource==='herb'?p.cargo.amount:0),0)).toBe(3);
  },20000);
  it('preserves a handler carrying the original animal, then delivers it once', () => {
    let {s,p,a,bed}=hospital();p.priorities.care=0;p.priorities.handle=1;injureAnimal(a,55,'bruise');
    expect(startAnimalCare(s,p,a,'rescue')).toBe(true);s=reload(s);p=s.pawns[0];a=s.animals[0];
    until(s,()=>p.animalCareTask?.stage==='carry');const animalId=a.id;
    expect(at(a)).toBe(at(p));s=reload(s);p=s.pawns[0];a=s.animals[0];
    until(s,()=>a.medical.bedId===bed.id);expect(a.medical.carriedBy).toBeNull();expect(at(a)).toBe(at(bed));
    expect(s.animals.map(a=>a.id)).toEqual([animalId]);expect(p.animalCareTask).toBeUndefined();reload(s);
  },20000);
  it('requires one carer and matching same-cell carry links, permits recovery at a carry boundary', () => {
    const {s,p,a}=hospital();injureAnimal(a,55,'bruise');expect(startAnimalCare(s,p,a,'rescue')).toBe(true);
    until(s,()=>p.animalCareTask?.stage==='carry');
    for(const change of [(d:any)=>{d.animals[0].x++;},(d:any)=>{d.animals[0].medical.carriedBy=null;},
      (d:any)=>{d.pawns[1].animalCareTask=structuredClone(d.pawns[0].animalCareTask);d.pawns[1].phase='animalCare';}]) {
      const d=s.save();change(d);expect(()=>validateAnimalMedical(d)).toThrow();
    }
    a.health=75;a.medical.wounds=[];a.medical.downed=false;
    const restored=reload(s);restored.step();expect(restored.animals[0].medical.carriedBy).toBeNull();
    expect(restored.pawns[0].animalCareTask).toBeUndefined();expect(restored.animals[0].id).toBe(a.id);
  },10000);
  it('rejects concurrent human work, invalid policies, cargo substitution and overreserved real herbs', () => {
    const {s,p,a}=hospital();injureAnimal(a,20);expect(startAnimalCare(s,p,a,'tend')).toBe(true);
    const changes: ((d:any)=>void)[] = [
      d=>{d.pawns[0].jobId=d.nextId++;},d=>{d.pawns[0].animalCareTask.progress=.5;},
      d=>{d.animals[0].medical.policy='none';},d=>{d.pawns[0].cargo=freshBatch('wood',1);},
      d=>{const q=d.pawns[1],id=d.pawns[0].animalCareTask.sourceId;q.careMedicineId=id;q.careAmount=4;},
    ];
    for(const change of changes){const d=s.save();change(d);expect(()=>validateAnimalMedical(d)).toThrow();}
  });
  it('restores feeding with real picked-up food and retains excess carried medicine', () => {
    let {s,p,a,bed}=hospital();injureAnimal(a,55,'bruise');Object.assign(a,pos(bed.x));a.medical.bedId=bed.id;a.phase='downed';a.hunger=12;
    expect(startAnimalCare(s,p,a,'feed')).toBe(true);s=reload(s);p=s.pawns[0];a=s.animals[0];
    until(s,()=>p.cargo?.resource==='grain');s=reload(s);a=s.animals[0];
    until(s,()=>s.stats.consumed.grain>0);expect(a.hunger).toBeGreaterThan(80);
    const second=hospital();injureAnimal(second.a,8);second.p.cargo=freshBatch('herb',3);
    expect(startAnimalCare(second.s,second.p,second.a,'tend')).toBe(true);const restored=reload(second.s);
    until(restored,()=>restored.stats.consumed.herb===1);expect(restored.pawns[0].cargo?.amount).toBe(2);
  },20000);
});
