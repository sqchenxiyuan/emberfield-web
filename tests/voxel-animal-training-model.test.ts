import { describe, expect, it } from 'vitest';
import { DAY, type Pawn, type VoxelSave, type WildAnimal } from '../src/voxel/types';
import { initialAnimalState } from '../src/voxel/husbandry';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { initialSurvival } from '../src/voxel/survival';
import { initialSkills } from '../src/voxel/skills';
import { initialPsyche } from '../src/voxel/mood';
import { initialLiving } from '../src/voxel/living';
import { initialSocial } from '../src/voxel/social';
import { initialApparelControl } from '../src/voxel/apparelPolicies';
import { freshBatch } from '../src/voxel/preservation';
import { initialAnimalTraining, TRAINABLES, TRAINING_STEPS, ANIMAL_TRAINING_RULES, setAnimalTrainingWanted,
  advanceAnimalTraining, decayAnimalTraining, animalSkillAvailable, canTrainAnimal, animalBodySize,
  animalCanEatResource, animalCanTrainWithResource, animalGrazes, animalTrainingFoodAmount, animalTrainingChance } from '../src/voxel/animalTraining';
import { rejectLegacyAnimalTraining, migrateAnimalTraining, validateAnimalTrainingState, validateAnimalTraining } from '../src/voxel/animalTrainingPersistence';
import { migrateAnimalTrade } from '../src/voxel/animalTradePersistence';
import { defaultAutoSlaughter } from '../src/voxel/autoSlaughter';
import { migrateAutoSlaughter } from '../src/voxel/autoSlaughterPersistence';
import { validateWildlife } from '../src/voxel/wildlifePersistence';
import { stripAnimalTrainingFields, animalTrainingExpectedField } from './legacy-animal-training-defaults';
import { stripPrisonFoodFields } from './legacy-prison-food-defaults';

function animal(species:WildAnimal['species']='labrador',id=20):WildAnimal {
  return { ...initialAnimalState(id,species,100),id,species,name:ANIMAL_DEFS[species].name,x:11,y:10,z:8,
    faction:'colony',tameness:5,health:ANIMAL_DEFS[species].health,hunger:80,dead:false,phase:'roam',hunt:false,
    moveTick:100,decisionTick:100,fleeUntil:0,threatId:null,retryTick:0,rotProgress:0 };
}
function person(id=1):Pawn {
  return { ...initialSurvival(73129,id),animalsReleased:false,id,name:`人${id}`,x:10,y:10,z:8,color:0,food:80,rest:90,
    skills:initialSkills(id),social:initialSocial(),psyche:initialPsyche(),living:initialLiving(),
    worn:[],apparelControl:initialApparelControl(100),foodPolicyId:null,apparelTask:null,apparelWearTicks:0,
    prisoner:null,wardenTask:null,handleTask:null,ropeTask:null,jobId:null,phase:'idle',path:[],destination:null,
    cargo:null,eating:null,reason:'',moveTick:100,workTarget:null,sleepingSince:null,sleepBedId:null,
    schedule:Array(24).fill('work'),priorities:{handle:2,firefight:0,clean:0,warden:0,care:0,hunt:0,dig:0,build:0,cut:0,haul:0,grow:0,cook:0,craft:0,research:0} };
}
function graph():VoxelSave {
  return {version:59,tick:100,nextId:100,pawns:[person(),person(2)],animals:[animal()],items:[],beds:[],
    jobs:[],stoves:[],butcherSpots:[],stonecutters:[],tailors:[],weaponBenches:[],productionQueues:[],husbandryLog:[],
    autoSlaughter:defaultAutoSlaughter(),trade:{caravans:[],receipts:[],animalLedger:{bought:{hare:0,deer:0,dromedary:0,alpaca:0,chicken:0,labrador:0},sold:{hare:0,deer:0,dromedary:0,alpaca:0,chicken:0,labrador:0}}}} as unknown as VoxelSave;
}
function learned(a:WildAnimal, skill:typeof TRAINABLES[number]) {
  setAnimalTrainingWanted(a.training,skill,true);
  a.training.steps.obedience=3;a.training.learned.obedience=true;
  a.training.steps[skill]=TRAINING_STEPS[skill];a.training.learned[skill]=true;
}
function training(stage:'fetch'|'approach'|'work'='fetch'):VoxelSave {
  const d=graph(),p=d.pawns[0],a=d.animals[0];setAnimalTrainingWanted(a.training,'obedience',true);
  p.phase='animalTrain';p.animalTrainTask={animalId:a.id,trainable:'obedience',sourceId:stage==='fetch'?40:null,
    resource:'grain',amount:6,stage,progress:0};
  if(stage==='fetch')d.items=[{...freshBatch('grain',6),id:40,x:10,y:11,z:8}];else p.cargo=freshBatch('grain',6);
  return d;
}
function legacy():any {
  const d=graph();d.animals=[animal('hare')];stripAnimalTrainingFields(d as any);(d as any).version=58;return d;
}

describe('animal training mechanisms',()=>{
  it('starts independent untrained animals and gives no dog skill for ownership or birth',()=>{
    const a=animal(),b=animal();expect(a.training.steps).toEqual({obedience:0,release:0,rescue:0,haul:0});
    a.training.wanted.haul=true;expect(b.training.wanted.haul).toBe(false);
    expect(initialAnimalTraining('hare')).toMatchObject({countDecayFrom:null,nextHaulTick:0});
    expect(initialAnimalTraining('labrador',100).countDecayFrom).toBe(100);
  });
  it('enables prerequisites and disables descendants without erasing learned progress',()=>{
    const a=animal();setAnimalTrainingWanted(a.training,'haul',true);expect(a.training.wanted.obedience).toBe(true);
    expect(canTrainAnimal(a,'haul')).toBe(false);learned(a,'haul');setAnimalTrainingWanted(a.training,'obedience',false);
    expect(Object.values(a.training.wanted)).toEqual([false,false,false,false]);
    expect(a.training.steps.haul).toBe(7);expect(a.training.learned.haul).toBe(true);
    expect(()=>validateAnimalTrainingState(a,100,100)).not.toThrow();
  });
  it('keeps learned partial skills usable while preventing child training until prerequisite is full',()=>{
    const a=animal();learned(a,'rescue');a.training.steps.rescue=1;expect(animalSkillAvailable(a,'rescue')).toBe(true);
    a.training.steps.rescue=0;a.training.learned.rescue=false;a.training.steps.obedience=2;
    expect(animalSkillAvailable(a,'obedience')).toBe(true);expect(canTrainAnimal(a,'rescue')).toBe(false);
    const clock=a.training.countDecayFrom;advanceAnimalTraining(a.training,'obedience');
    expect(canTrainAnimal(a,'rescue')).toBe(true);expect(a.training.countDecayFrom).toBe(clock);
  });
  it('uses growth-dependent body size for rescue/haul without imposing adult gate on obedience/release',()=>{
    const a=animal();a.growth=0;expect(animalBodySize(a)).toBeCloseTo(.15);expect(canTrainAnimal(a,'obedience')).toBe(true);
    learned(a,'obedience');expect(canTrainAnimal(a,'release')).toBe(true);expect(canTrainAnimal(a,'rescue')).toBe(false);
    a.growth=.5;expect(animalBodySize(a)).toBeCloseTo(.375);expect(canTrainAnimal(a,'haul')).toBe(false);
    a.growth=1;expect(canTrainAnimal(a,'rescue')).toBe(true);expect(canTrainAnimal(a,'haul')).toBe(true);
  });
  it('forgets exactly one leaf step per period, preserving learned until zero',()=>{
    const a=animal();learned(a,'haul');learned(a,'rescue');const tick=100+12*DAY;
    expect(decayAnimalTraining(a,tick-1,0)).toBeNull();expect(decayAnimalTraining(a,tick,.99)).toBe('haul');
    expect(a.training.steps).toEqual({obedience:3,release:0,rescue:2,haul:6});expect(a.training.learned.haul).toBe(true);
    a.training.steps.haul=1;expect(decayAnimalTraining(a,tick+12*DAY,.99)).toBe('haul');
    expect(a.training.learned.haul).toBe(false);expect(a.training.steps.obedience).toBe(3);
    const b=animal('hare'),before=structuredClone(b);decayAnimalTraining(b,tick,.2);expect(b).toEqual(before);
  });
  it('models omnivorous dogs without changing herbivore diet or allowing grazing/training medicine',()=>{
    for(const r of ['grain','food','meal','meat','milk','eggUnfertilized','eggFertilized'] as const)expect(animalCanEatResource('labrador',r)).toBe(true);
    expect(animalGrazes('labrador')).toBe(false);expect(animalGrazes('hare')).toBe(true);
    expect(animalCanEatResource('hare','meat')).toBe(false);expect(animalCanEatResource('labrador','herb')).toBe(false);
    expect(animalCanTrainWithResource('labrador','meal')).toBe(false);expect(animalCanTrainWithResource('labrador','milk')).toBe(true);
    expect(animalTrainingFoodAmount(animal(),'grain')).toBe(6);expect(animalTrainingChance(20)).toBe(1);
  });
});

describe('animal training persistence and reservations',()=>{
  it.each(['fetch','approach','work'] as const)('accepts and retains real %s state without mutating inputs',stage=>{
    const d=training(stage),before=structuredClone(d);expect(()=>validateAnimalTraining(d)).not.toThrow();expect(d).toEqual(before);
  });
  it('allows a half-consumed training session and retained food after cancellation',()=>{
    const d=training('work'),p=d.pawns[0];p.animalTrainTask!.progress=ANIMAL_TRAINING_RULES.work*2/3;
    p.animalTrainTask!.amount=3;p.cargo!.amount=3;expect(()=>validateAnimalTraining(d)).not.toThrow();
    delete p.animalTrainTask;p.phase='idle';expect(()=>validateAnimalTraining(d)).not.toThrow();expect(p.cargo!.amount).toBe(3);
  });
  it('rejects task-phase mismatches, missing real food and overlapping human activities',()=>{
    for(const change of [(d:any)=>{d.pawns[0].phase='idle';},(d:any)=>{d.pawns[0].animalTrainTask=undefined;},
      (d:any)=>{d.items=[];},(d:any)=>{d.items[0].amount=5;},(d:any)=>{d.pawns[0].jobId=50;},
      (d:any)=>{d.pawns[0].prisonFoodTask={};},(d:any)=>{d.pawns[0].drafted=true;}]){
      const d=training();change(d);expect(()=>validateAnimalTraining(d)).toThrow();
    }
  });
  it('shares exact source quantities across trainer, medical care, prisoner delivery and animal hauling',()=>{
    for(const change of [(d:any)=>{d.pawns[1].careFoodId=40;d.pawns[1].careAmount=1;},
      (d:any)=>{d.pawns[1].prisonFoodTask={stage:'fetch',sourceId:40,amount:1};},
      (d:any)=>{d.pawns[1].animalCareTask={stage:'fetch',sourceId:40,amount:1};}]){
      const d=training();change(d);expect(()=>validateAnimalTraining(d)).toThrow(/预约/);
    }
    const d=training(),hauler=animal('labrador',21);learned(hauler,'haul');hauler.phase='haul';
    hauler.work={kind:'haul',sourceId:40,resource:'grain',amount:1,target:{x:14,y:10,z:8},stage:'fetch'};
    d.animals.push(hauler);expect(()=>validateAnimalTraining(d)).toThrow(/预约/);
    d.items[0].amount=7;expect(()=>validateAnimalTraining(d)).not.toThrow();
  });
  it('retains real animal cargo when idle, downed or dead and rejects orphan delivery contents',()=>{
    const d=graph(),a=d.animals[0];a.cargo=freshBatch('grain',3);expect(()=>validateAnimalTraining(d)).not.toThrow();
    a.medical.downed=true;a.phase='downed';expect(()=>validateAnimalTraining(d)).not.toThrow();
    a.medical.downed=false;a.dead=true;a.phase='dead';expect(()=>validateAnimalTraining(d)).not.toThrow();
    a.dead=false;a.phase='haul';learned(a,'haul');a.work={kind:'haul',sourceId:null,resource:'grain',amount:4,target:{x:14,y:10,z:8},stage:'deliver'};
    expect(()=>validateAnimalTraining(d)).toThrow(/实物/);a.work.amount=3;expect(()=>validateAnimalTraining(d)).not.toThrow();
  });
  it('checks rescue against both human reservations and the actual carried patient/bed',()=>{
    const d=graph(),a=d.animals[0],p=d.pawns[1];learned(a,'rescue');a.phase='rescue';
    p.downed=true;p.phase='downed';d.beds=[{id:50,x:15,y:10,z:8,owner:p.id,medical:false,prisoner:false,axis:'x',quality:2}];
    a.work={kind:'rescue',patientId:p.id,bedId:50,stage:'approach'};expect(()=>validateAnimalTraining(d)).not.toThrow();
    d.pawns[0].patientId=p.id;expect(()=>validateAnimalTraining(d)).toThrow(/救援/);d.pawns[0].patientId=null;
    a.work.stage='carry';expect(()=>validateAnimalTraining(d)).toThrow(/携带/);p.carriedBy=a.id;Object.assign(p,{x:a.x,y:a.y,z:a.z});
    expect(()=>validateAnimalTraining(d)).not.toThrow();a.work=null;a.phase='roam';expect(()=>validateAnimalTraining(d)).toThrow(/被救援/);
  });
  it('allows ordinary defense without Release but requires learned obedience and a followed master',()=>{
    const d=graph(),a=d.animals[0],master=d.pawns[0],enemy=d.pawns[1];learned(a,'obedience');
    a.training.masterId=master.id;a.training.followFieldwork=true;a.phase='attack';enemy.faction='raider';
    a.work={kind:'attack',targetId:enemy.id,nextAttackTick:120};expect(a.training.learned.release).toBe(false);
    expect(()=>validateAnimalTraining(d)).not.toThrow();a.training.followFieldwork=false;expect(()=>validateAnimalTraining(d)).toThrow(/跟随/);
  });
  it('rejects unsupported species state, malformed learned flags and duplicate corpse identity in animal cargo',()=>{
    const a=animal('hare');a.training.wanted.obedience=true;expect(()=>validateAnimalTrainingState(a,100,100)).toThrow(/物种/);
    const b=animal();b.training.learned.obedience=true;expect(()=>validateAnimalTrainingState(b,100,100)).toThrow(/进度/);
    const d=graph();const carcass={resource:'carcass' as const,amount:1,rotProgress:0,carcass:{animalId:60,species:'hare' as const}};
    d.items=[{...carcass,id:50,x:12,y:10,z:8}];d.animals[0].cargo=structuredClone(carcass);
    expect(()=>validateWildlife(d,new Set(),new Set())).toThrow(/身份重复/);
  });
});

describe('v58 to v59 strict defaults',()=>{
  it('preflights native old data before adding fresh independent state and zero trade counts',()=>{
    const old=legacy();old.trade.receipts=[{animalTransfers:[{side:'colony',animal:structuredClone(old.animals[0])}]}];
    const before=structuredClone(old);expect(()=>rejectLegacyAnimalTraining(old,58)).not.toThrow();
    migrateAutoSlaughter(old,58);migrateAnimalTrade(old,58);migrateAnimalTraining(old,58);
    expect(old.animals).toEqual(animalTrainingExpectedField('animals',before.animals));
    expect(old.trade).toEqual(animalTrainingExpectedField('trade',before.trade));
    expect(old.pawns).toEqual(animalTrainingExpectedField('pawns',before.pawns));
    old.animals[0].training.wanted.obedience=true;
    expect(old.trade.receipts[0].animalTransfers[0].animal.training.wanted.obedience).toBe(false);
  });
  it('rejects new species/fields/phases even when null and inside historical snapshots or policies',()=>{
    for(const change of [(d:any)=>{d.animals[0].training=null;},(d:any)=>{d.animals[0].work=undefined;},
      (d:any)=>{d.animals[0].cargo=null;},(d:any)=>{d.pawns[0].animalsReleased=false;},(d:any)=>{d.pawns[0].animalTrainTask=null;},
      (d:any)=>{d.animals[0].species='labrador';},(d:any)=>{d.trade.animalLedger.bought.labrador=0;},
      (d:any)=>{d.productionQueues=[{bills:[{policy:{allowedCarcasses:['labrador']}}]}];},
      (d:any)=>{d.husbandryLog=[{kind:'training'}];},(d:any)=>{d.trade.receipts=[{animalTransfers:[{animal:{training:null}}]}];}]){
      const d=legacy();change(d);const before=structuredClone(d);expect(()=>rejectLegacyAnimalTraining(d,58)).toThrow(/旧版本/);expect(d).toEqual(before);
    }
  });
  it('refuses lossy synthetic downgrade atomically and strips only exact inactive defaults',()=>{
    for(const change of [(d:any)=>{d.animals[0].cargo=freshBatch('grain',1);},(d:any)=>{d.animals[0].training.steps.haul=1;},
      (d:any)=>{d.pawns[0].animalsReleased=true;},(d:any)=>{d.autoSlaughter.labrador.total=0;}]){
      const d=graph();d.animals=[animal('hare')];change(d);const before=structuredClone(d);
      expect(()=>stripPrisonFoodFields(d as any)).toThrow();expect(d).toEqual(before);
    }
    const d=graph();d.animals=[animal('hare')];stripAnimalTrainingFields(d as any);
    expect(()=>rejectLegacyAnimalTraining(d as any,58)).not.toThrow();expect(Object.hasOwn(d.animals[0],'training')).toBe(false);
  });
});
