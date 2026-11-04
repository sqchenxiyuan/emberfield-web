import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, WIDTH, DEPTH, at, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { initialStoryteller } from '../src/voxel/storyteller';
import { initialTrade } from '../src/voxel/trade';
import { initialFireHazards } from '../src/voxel/fire';
import { initialWeather, advanceWeather, WEATHER_RULES } from '../src/voxel/weather';
import { batchHitPoints, deteriorationRandom } from '../src/voxel/deterioration';
import { natureWeatherAllowed, wettingWeather } from '../src/voxel/environment';
import { makeWeapon } from '../src/voxel/weapons';
import { MOOD_RULES } from '../src/voxel/mood';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
function cmd(s: VoxelSimulation, c: VoxelCommand) { const r = s.command(c); expect(r.ok, r.message).toBe(true); }
function until(s: VoxelSimulation, done: () => boolean, limit = 2000) {
  for (let n = 0; n < limit && !done(); n++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns.map(p => [p.phase,p.reason]) })).toBe(true);
}
/** Explicitly controlled geometry, resources and time. Native/campaign evidence
 * is separate; these fixtures isolate interruption and conservation boundaries. */
function fixture(configure?: (s: VoxelSimulation) => void) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  s.animals = []; s.trees = []; s.items = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.blocks.fill(Block.Air, WIDTH * DEPTH * 8);
  s.ladders.fill(0); s.structureKinds.fill(0); s.homeArea.clear(); s.spawn = pos(12);
  for (const [i,p] of s.pawns.entries()) {
    Object.assign(p, pos(12, 16 + i * 2)); p.schedule.fill('work'); p.food = 100; p.rest = 100;
    p.worn = []; p.weapon = null;
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof Pawn['priorities']] = 0;
  }
  cmd(s, { type: 'threats', enabled: false }); cmd(s, { type: 'fireHazards', enabled: false });
  configure?.(s); return VoxelSimulation.load(s.save());
}
function clock(s: VoxelSimulation, tick: number) {
  s.tick = tick; s.storyteller = initialStoryteller(s.seed,tick); s.trade = initialTrade(s.seed,tick);
  s.fireHazards = initialFireHazards(s.seed,tick); s.fireHazards.enabled = false;
  s.weather = initialWeather(s.seed,s.settings); advanceWeather(s.weather,s.seed,s.settings,tick,s.generator);
  return VoxelSimulation.load(s.save());
}
function roof(s: VoxelSimulation, p: Pos) { s.blocks[at({...p,z:p.z+2})] = Block.Stone; }
function room(s: VoxelSimulation) {
  for(let x=20;x<=24;x++)for(let y=20;y<=24;y++)for(let z=8;z<=10;z++)
    if(x===20||x===24||y===20||y===24||z===10)s.blocks[at(pos(x,y,z))]=Block.Stone;
}

describe('environment attached to real colony operations', () => {
  it('distinguishes exposed storage, an open shed and an enclosed room', () => {
    let s=fixture(s=>{roof(s,pos(16));room(s);
      for(const p of [pos(14),pos(16),pos(22,22)])s.items.push({...p,id:s.nextId++,resource:'cloth',amount:10});
    }); s=clock(s,7000);
    cmd(s,{type:'designate',tool:'stock',from:pos(14)});
    expect(s.snapshot().environment.items.map(i=>i.rate)).toEqual([20,2,0]);
    const before=s.items.map(batchHitPoints);until(s,()=>batchHitPoints(s.items[0])!<before[0]!,6000);
    expect(batchHitPoints(s.items[0])).toBeLessThan(before[0]!);
    expect(batchHitPoints(s.items[2])).toBe(before[2]);
    expect(s.items.map(i=>i.amount)).toEqual([10,10,10]);
    expect(VoxelSimulation.load(s.save()).items).toEqual(s.items);
  });
  it('refreshes a single wet memory then dries under a roof without instant removal', () => {
    let s=clock(fixture(s=>roof(s,pos(14))),6000);const id=s.pawns[0].id;
    cmd(s,{type:'draft',pawnId:id,drafted:true});s.step(50);
    const p=s.pawns[0];expect(p.psyche.memories.filter(m=>m.kind==='wet')).toHaveLength(1);
    const first=p.psyche.memories.find(m=>m.kind==='wet')!.expires;s.step(50);
    expect(p.psyche.memories.find(m=>m.kind==='wet')!.expires).toBeGreaterThan(first);
    cmd(s,{type:'move',pawnId:id,target:pos(14)});until(s,()=>at(p)===at(pos(14)));
    const expires=p.psyche.memories.find(m=>m.kind==='wet')!.expires;
    expect(s.snapshot().environment.wetPawnIds).not.toContain(id);
    s=VoxelSimulation.load(s.save());s.step(expires-s.tick-1);
    expect(s.pawns[0].psyche.memories.find(m=>m.kind==='wet')!.expires).toBe(expires);
    s.step();expect(s.pawns[0].psyche.memories.some(m=>m.kind==='wet')).toBe(false);
  });
  it('blocks nature watching in rain while physical horseshoes remain usable', () => {
    const s=clock(fixture(s=>s.horseshoePins.push({...pos(18),id:s.nextId++})),6000);
    expect(natureWeatherAllowed(s.weather,s.tick)).toBe(false);
    cmd(s,{type:'recreate',pawnId:s.pawns[0].id});
    expect(s.pawns[0].psyche.recreation?.kind).toBe('horseshoes');
    expect(s.command({type:'recreate',pawnId:s.pawns[1].id}).ok).toBe(false);
    const joy=s.pawns[0].psyche.joy;until(s,()=>s.pawns[0].psyche.joy>joy+1);
  });
  it('ends a nature walk when the real weather transition becomes unsuitable', () => {
    const s=clock(fixture(),5095);cmd(s,{type:'recreate',pawnId:s.pawns[0].id});
    expect(s.pawns[0].psyche.recreation?.kind).toBe('walk');
    until(s,()=>s.pawns[0].psyche.recreation===null,450);
    expect(s.snapshot().environment.natureAvailable).toBe(false);
  });
  it('snow has no wet thought and weather thoughts switch at the transition midpoint', () => {
    const s=fixture(), w={...s.weather,kind:'rain' as const,previousKind:'clear' as const,startedTick:100};
    const midpoint=100+WEATHER_RULES.transitionTicks/2;
    expect(wettingWeather(w,midpoint-1)).toBe(false);expect(wettingWeather(w,midpoint)).toBe(true);
    expect(wettingWeather({...w,kind:'snow'},midpoint)).toBe(false);
    expect(MOOD_RULES.memoryValue.wet).toBe(-3);expect(MOOD_RULES.memoryDuration.wet).toBe(DAY/10);
  });
  it('rain removes outdoor filth and releases its reserved cleaning task without touching sheltered dirt', () => {
    let s=fixture(s=>{roof(s,pos(16));for(const p of [pos(40),pos(16)])
      s.filth.push({...p,id:s.nextId++,kind:'dirt',amount:1,createdTick:0});});
    const id=s.filth[0].id;
    let tick=7000;while(deteriorationRandom(s.seed^0x61e245f,id,tick)>=.3)tick+=100;
    s=clock(s,tick-1);cmd(s,{type:'homeArea',from:pos(40),enabled:true});
    cmd(s,{type:'clean',pawnId:s.pawns[0].id,filthId:id});expect(s.pawns[0].cleanTask).not.toBeNull();
    s.step();expect(s.filth.map(f=>f.id)).toEqual([id+1]);expect(s.pawns[0].cleanTask).toBeNull();
    expect(s.pawns[0].reason).toContain('雨水');expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('zero HP destroys the whole stack once and clears an equipment fetch reservation', () => {
    let s=fixture(s=>s.items.push({...pos(40),id:s.nextId++,resource:'weapon',amount:1,
      weapon:{...makeWeapon(s.nextId++,'steelKnife'),hitPoints:1}}));
    const item=s.items[0];let tick=7000;
    while(deteriorationRandom(s.seed,item.id,tick)>=10*100/DAY)tick+=100;
    s=clock(s,tick-1);cmd(s,{type:'equipWeapon',pawnId:s.pawns[0].id,weaponId:item.weapon!.id});
    expect(s.pawns[0].weaponTask).not.toBeNull();s.step();
    expect(s.items).toHaveLength(0);expect(s.stats.destroyed.weapon).toBe(1);
    expect(s.pawns[0].weaponTask).toBeNull();s.step(100);expect(s.stats.destroyed.weapon).toBe(1);
    expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('keeps damaged building materials through delivery, save/load and cancellation', () => {
    let s=fixture(s=>{s.items.push({...pos(14),id:s.nextId++,resource:'wood',amount:6,hitPoints:90});
      s.pawns[0].priorities.build=1;});
    cmd(s,{type:'designate',tool:'wall',from:pos(17)});
    until(s,()=>s.jobs[0]?.delivered.wood===6);
    expect(s.jobs[0].deliveredBatches).toEqual([{resource:'wood',amount:6,hitPoints:90}]);
    s=VoxelSimulation.load(s.save());cmd(s,{type:'designate',tool:'cancel',from:pos(17)});
    expect(s.jobs).toHaveLength(0);expect(s.items.find(i=>i.resource==='wood')).toMatchObject({amount:6,hitPoints:90});
    expect(s.stats.consumed.wood).toBe(0);
  });
  it('clears old optional damage when actual hauling merges a near-full stack to full HP', () => {
    const s=fixture(s=>{s.items.push({...pos(14),id:s.nextId++,resource:'wood',amount:1,hitPoints:149},
      {...pos(16),id:s.nextId++,resource:'wood',amount:2});s.pawns[0].priorities.haul=1;});
    cmd(s,{type:'designate',tool:'stock',from:pos(14)});
    until(s,()=>s.items.some(i=>i.resource==='wood'&&i.amount===3));
    expect(s.items[0].hitPoints).toBeUndefined();expect(batchHitPoints(s.items[0])).toBe(150);
    expect(VoxelSimulation.load(s.save()).counts().wood).toBe(3);
  });
});
