import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { newTraderAnimal } from '../src/voxel/animalTrade';
import { animalMedicalSummary, injureAnimal } from '../src/voxel/animalMedical';
import { startAnimalCare } from '../src/voxel/animalMedicalWorld';
import { ANIMAL_ENVIRONMENT_RULES } from '../src/voxel/animalEnvironment';
import { makeFire } from '../src/voxel/fire';
import { freshBatch } from '../src/voxel/preservation';
import { Block, at, index, type AnimalSpecies, type Pos, type VoxelSave } from '../src/voxel/types';

const pos = (x: number, y = 14, z = 8): Pos => ({ x, y, z });
let baseline: VoxelSave | undefined;
/** Explicitly engineered two-room scene; temperature/illness injections isolate
 * state transitions, not a claimed natural new-colony acceptance campaign. */
function scene() {
  if (!baseline) {
    const s = new VoxelSimulation(73129, { biome: 'temperate', hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
    s.animals = []; s.grass = []; s.items = []; s.trees = []; s.stockpiles = []; s.beds = [];
    s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0); s.explored.fill(1);
    for (let x = 10; x <= 30; x++) for (let y = 10; y <= 18; y++) for (let z = 8; z <= 9; z++)
      if (x !== 20 || y === 14) s.blocks[index(x,y,z)] = Block.Air;
    s.doors = [{ ...pos(20), id: s.nextId++, axis: 'x', mode: 'open', openUntil: 0 }];
    s.spawn = pos(12); s.homeArea.clear();
    for (const [i,p] of s.pawns.entries()) {
      Object.assign(p,pos(12+i)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
      for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
    }
    expect(s.command({type:'fireHazards',enabled:false}).ok).toBe(true);
    baseline = s.save();
  }
  return VoxelSimulation.load(baseline);
}
function animal(s: VoxelSimulation, species: AnimalSpecies = 'chicken', p = pos(26)) {
  const a = newTraderAnimal(s.nextId++,species,'female',s.tick,p);
  a.faction = 'colony'; a.decisionTick = s.tick + 1000; s.animals.push(a); return a;
}
function temperature(s: VoxelSimulation,p: Pos,value: number) {
  s.thermal.pushHeat(p,(value-s.temperature(p))*1e7,value); expect(s.temperature(p)).toBeCloseTo(value,6);
}
function until(s: VoxelSimulation,predicate:()=>boolean,limit=1200) {
  for (let i=0;i<limit&&!predicate();i++) s.step();
  expect(predicate(),JSON.stringify(s.animals.map(a=>({phase:a.phase,reason:a.reason,pos:at(a),env:a.environment,medical:a.medical})))).toBe(true);
}
function reload(s: VoxelSimulation) {
  const saved = s.save(), loaded = VoxelSimulation.load(saved);
  expect(loaded.save().animals).toEqual(saved.animals); expect(loaded.save().items).toEqual(saved.items);
  expect(loaded.save().stats).toEqual(saved.stats); return loaded;
}

describe('animal environmental injury connects real rooms, care and physical movement',()=>{
  it('samples the actual room and species tolerance instead of the biome or outdoor label',()=>{
    const s=scene(),hot=animal(s),camel=animal(s,'dromedary',pos(28)),cool=animal(s,'chicken',pos(16));
    temperature(s,pos(25),65);temperature(s,pos(15),20);
    s.step(ANIMAL_ENVIRONMENT_RULES.interval);
    expect(hot.environment.heatstroke).toBeGreaterThan(0);
    expect(camel.environment.heatstroke).toBe(0);expect(cool.environment.heatstroke).toBe(0);
    expect(hot.medical.wounds).toEqual([]);expect(hot.health).toBe(20);
    expect(s.stats.consumed.herb).toBe(0);reload(s);
  });
  it('does not offer wound medicine for pure temperature illness and does not instantly heal on rescue',()=>{
    const s=scene(),a=animal(s),doctor=s.pawns[0];doctor.priorities.care=1;
    a.environment.heatstroke=.65;a.medical.downed=true;a.phase='downed';
    temperature(s,a,90);temperature(s,pos(15),20);
    expect(s.command({type:'designate',tool:'animalBed',from:pos(27)}).ok).toBe(true);
    expect(s.command({type:'designate',tool:'animalBed',from:pos(16)}).ok).toBe(true);
    s.items.push({...pos(15,16),...freshBatch('herb',4),id:s.nextId++});
    expect(startAnimalCare(s,doctor,a,'tend')).toBe(false);
    expect(startAnimalCare(s,doctor,a,'rescue')).toBe(true);
    expect(doctor.animalCareTask?.bedId).toBe(s.animalBeds[1].id);
    until(s,()=>doctor.animalCareTask?.stage==='carry');
    const illness=a.environment.heatstroke;expect(illness).toBeGreaterThan(0);
    const loaded=reload(s),copy=loaded.animals.find(q=>q.id===a.id)!;
    expect(copy.environment).toEqual(a.environment);expect(copy.medical.carriedBy).toBe(doctor.id);
    until(loaded,()=>copy.medical.carriedBy===null);
    expect(copy.environment.heatstroke).toBeGreaterThan(0);expect(loaded.stats.consumed.herb).toBe(0);
    until(loaded,()=>copy.environment.heatstroke===0,2400);
    expect(copy.medical.downed).toBe(false);expect(loaded.stats.consumed.herb).toBe(0);
  },20000);
  it('lets a mobile seriously ill animal reach a real cooler room and preserve its in-flight route',()=>{
    let s=scene();const a=animal(s);a.environment.heatstroke=.4;a.decisionTick=s.tick;
    temperature(s,a,90);temperature(s,pos(15),20);
    s.step();expect(a.phase).toBe('shelter');expect(a.goal?.kind).toBe('shelter');expect(a.path.length).toBeGreaterThan(0);
    const id=a.id,goal=a.goal!.id;s=reload(s);
    until(s,()=>s.animals.find(q=>q.id===id)!.x<20);
    expect(s.temperature(s.animals.find(q=>q.id===id)!)).toBeLessThan(40);
    expect(s.animals.find(q=>q.id===id)!.environment.heatstroke).toBeGreaterThan(0);
    expect(at(s.animals.find(q=>q.id===id)!)).toBe(goal);
  },10000);
  it('cannot seek comfort through a closed animal gate or teleport through a wall',()=>{
    const s=scene(),a=animal(s);s.doors[0].mode='locked';a.environment.heatstroke=.4;a.decisionTick=s.tick;
    temperature(s,a,90);temperature(s,pos(15),20);
    const before=at(a);s.step(30);
    expect(a.x).toBeGreaterThan(20);expect(at(a)).toBe(before);
    expect(a.environment.heatstroke).toBeGreaterThan(.4);expect(a.goal).toBeNull();reload(s);
  });
  it('leaves an unsafe occupied medical spot and can reserve a different safe bed',()=>{
    const s=scene(),a=animal(s),doctor=s.pawns[0];doctor.priorities.care=1;
    expect(s.command({type:'designate',tool:'animalBed',from:a}).ok).toBe(true);
    expect(s.command({type:'designate',tool:'animalBed',from:pos(16)}).ok).toBe(true);
    a.environment.heatstroke=.7;a.medical.downed=true;a.phase='downed';a.medical.bedId=s.animalBeds[0].id;
    temperature(s,a,90);temperature(s,pos(15),20);
    expect(startAnimalCare(s,doctor,a,'rescue')).toBe(true);
    expect(doctor.animalCareTask?.bedId).toBe(s.animalBeds[1].id);expect(a.medical.bedId).toBeNull();
    reload(s);
  });
  it('keeps a carried temperature patient at the interrupted carrier with its illness intact',()=>{
    const s=scene(),a=animal(s),doctor=s.pawns[0];doctor.priorities.care=1;
    a.environment.heatstroke=.7;a.medical.downed=true;a.phase='downed';
    temperature(s,a,90);temperature(s,pos(15),20);
    expect(s.command({type:'designate',tool:'animalBed',from:pos(16)}).ok).toBe(true);
    expect(startAnimalCare(s,doctor,a,'rescue')).toBe(true);until(s,()=>doctor.animalCareTask?.stage==='carry');
    const before=structuredClone(a.environment),cell=at(doctor);
    expect(s.command({type:'draft',pawnId:doctor.id,drafted:true}).ok).toBe(true);
    expect(at(a)).toBe(cell);expect(a.environment).toEqual(before);expect(a.medical.carriedBy).toBeNull();reload(s);
  });
  it('makes severe temperature failure produce exactly one ordinary physical carcass',()=>{
    const s=scene(),a=animal(s);a.environment.heatstroke=.9999;a.medical.downed=true;a.phase='downed';
    temperature(s,a,120);s.step(ANIMAL_ENVIRONMENT_RULES.interval);
    expect(s.animals.some(q=>q.id===a.id)).toBe(false);
    expect(s.items.filter(i=>i.carcass?.animalId===a.id)).toHaveLength(1);
    expect(s.stats.produced.carcass).toBe(1);s.step(30);expect(s.stats.produced.carcass).toBe(1);reload(s);
  });
  it('turns physical flame contact into a persistent burn on an immobilized animal',()=>{
    const s=scene(),a=animal(s,'alpaca');injureAnimal(a,55,'bruise');a.phase='downed';
    s.items.push({...pos(a.x,a.y),...freshBatch('wood',75),id:s.nextId++});
    s.fires.push(makeFire(s.nextId++,a,s.tick,'shortCircuit',1));
    s.step(30);expect(a.medical.wounds.some(w=>w.kind==='burn'&&w.tended===null)).toBe(true);
    expect(animalMedicalSummary(a).bleeding).toBe(0);reload(s);
  });
  it('escapes a real fire using traversable cells without creating a duplicate animal',()=>{
    const s=scene(),a=animal(s);const original=at(a);
    s.items.push({...pos(a.x,a.y),...freshBatch('wood',75),id:s.nextId++});
    s.fires.push(makeFire(s.nextId++,a,s.tick,'shortCircuit',1));
    s.step();expect(at(a)).not.toBe(original);expect(s.animals.filter(q=>q.id===a.id)).toHaveLength(1);
    expect(s.fires.some(f=>at(f)===at(a))).toBe(false);reload(s);
  });
  it('preserves diseases through saving and rejects malformed environmental state',()=>{
    const s=scene(),a=animal(s,'alpaca');a.environment.hypothermia=.2;
    const saved=s.save();expect(VoxelSimulation.load(saved).animals[0].environment).toEqual(a.environment);
    const bad=structuredClone(saved);bad.animals[0].environment.heatstroke=Number.NaN;
    expect(()=>VoxelSimulation.load(bad)).toThrow(/动物环境/);
    expect(saved.animals[0].environment.hypothermia).toBe(.2);
  });
});
