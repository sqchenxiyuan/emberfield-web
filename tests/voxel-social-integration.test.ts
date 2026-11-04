import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, DAY, at, index, type Pos, type VoxelCommand } from '../src/voxel/types';
import { applySocialInteraction, initialSocial, opinionOf, SOCIAL_RULES } from '../src/voxel/social';
import { canSocialize, socialImpact, sociallyAvailable, updateSocial } from '../src/voxel/socialWorld';
import { moodView } from '../src/voxel/mood';
import { freshBatch } from '../src/voxel/preservation';
import { fireDamageKey, FIRE_MAX_HP } from '../src/voxel/fire';
import { initialPrisoner } from '../src/voxel/prisoners';
import { prisonerTick } from '../src/voxel/prisonWorld';

const pos=(x:number,y=16,z=8):Pos=>({x,y,z});
/** Isolated geometry tests; the separate ordinary campaign builds its furniture. */
function fixture(seats=3) {
  const s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0});
  s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=29;x++)for(let y=12;y<=24;y++)for(let z=8;z<=9;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p] of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i));p.schedule.fill('work');p.rest=90;p.food=90;
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof typeof p.priorities]=0;
  }
  s.tables.push({quality:2,...pos(20),id:s.nextId++,axis:'x',gathering:true});
  for(const target of [pos(19),pos(20,15),pos(21,17)].slice(0,seats))
    s.chairs.push({quality:2,...target,id:s.nextId++,axis:'x'});
  return VoxelSimulation.load(s.save());
}
function command(s:VoxelSimulation,c:VoxelCommand){const r=s.command(c);expect(r.ok,r.message).toBe(true);return r;}
function until(s:VoxelSimulation,condition:()=>boolean,max=2000) {
  for(let i=0;i<max&&!condition();i++)s.step();
  expect(condition(),JSON.stringify({tick:s.tick,p:s.pawns.map(p=>({phase:p.phase,reason:p.reason,rec:p.psyche.recreation}))})).toBe(true);
}

describe('colony social interactions and physical table leisure',()=>{
  it('needs a real adjacent chair; no chair means no standing social job',()=>{
    const s=fixture(0),p=s.pawns[0],before=structuredClone(p);
    expect(s.command({type:'recreate',pawnId:p.id,kind:'social'}).ok).toBe(false);
    expect(p).toEqual(before);
    s.chairs.push({quality:2,...pos(25),id:s.nextId++,axis:'x'});
    expect(s.command({type:'recreate',pawnId:p.id,kind:'social'}).ok).toBe(false);
  });
  it('walks before gaining joy/comfort, then can enjoy a table alone with no drink',()=>{
    const s=fixture(),p=s.pawns[0],joy=p.psyche.joy;
    s.pawns.slice(1).forEach(q=>q.drafted=true);
    command(s,{type:'recreate',pawnId:p.id,kind:'social'});
    expect(p.path.length).toBeGreaterThan(0);expect(s.socialRelaxing(p)).toBe(false);
    s.step();expect(p.psyche.joy).toBeLessThan(joy);
    until(s,()=>s.socialRelaxing(p));const arrived=p.psyche.joy,comfort=p.living.comfort;
    s.step(80);expect(p.psyche.joy).toBeGreaterThan(arrived);expect(p.living.comfort).toBeGreaterThan(comfort);
    expect(s.socialLog).toEqual([]);expect(s.counts().food).toBe(0);
  });
  it('common recreation schedules cause autonomous arrivals and natural talk; reload continues exactly',()=>{
    const s=fixture();for(const p of s.pawns)p.schedule.fill('recreation');
    until(s,()=>s.pawns.filter(p=>s.socialRelaxing(p)).length===3);
    expect(s.pawns.every(p=>p.psyche.recreation?.forced===false)).toBe(true);
    const afterArrival=s.tick;until(s,()=>s.socialLog.some(e=>e.tick>afterArrival));
    const e=s.socialLog.at(-1)!;
    expect(canSocialize(s,s.pawns.find(p=>p.id===e.initiatorId)!,s.pawns.find(p=>p.id===e.recipientId)!)).toBe(true);
    expect(s.pawns.some(p=>p.social.memories.length>0)).toBe(true);
    const copy=VoxelSimulation.load(s.save());s.step(120);copy.step(120);
    expect(copy.save()).toEqual(s.save());
  });
  it('shares seat reservations with dining in both orders and leaves meals alone when gatherings close',()=>{
    const s=fixture(1),[a,b]=s.pawns;
    command(s,{type:'recreate',pawnId:a.id,kind:'social'});
    expect(s.command({type:'recreate',pawnId:b.id,kind:'social'}).ok).toBe(false);
    s.items.push({...pos(13),...freshBatch('meal',4),id:s.nextId++});b.food=20;
    until(s,()=>b.living.mealTask!==null);
    expect(b.living.mealTask?.chairId).toBeNull();
    command(s,{type:'tableGathering',tableId:s.tables[0].id,enabled:false});
    expect(a.psyche.recreation).toBeNull();
    const t=fixture(1),[diner,relaxer]=t.pawns;
    t.items.push({...pos(13),...freshBatch('meal',4),id:t.nextId++});diner.food=20;
    until(t,()=>diner.living.mealTask!==null);
    expect(diner.living.mealTask?.chairId).toBe(t.chairs[0].id);
    expect(t.command({type:'recreate',pawnId:relaxer.id,kind:'social'}).ok).toBe(false);
    const meal=structuredClone(diner.living.mealTask),cargo=structuredClone(diner.cargo);
    command(t,{type:'tableGathering',tableId:t.tables[0].id,enabled:false});
    expect(diner.living.mealTask).toEqual(meal);expect(diner.cargo).toEqual(cargo);
  });
  it('fire destruction and drafting release social seats; current saves reject absent chairs',()=>{
    const s=fixture(1),p=s.pawns[0];command(s,{type:'recreate',pawnId:p.id,kind:'social'});
    const bad=s.save();bad.chairs=[];expect(()=>VoxelSimulation.load(bad)).toThrow(/座位|休闲/);
    const c=s.chairs[0];expect(s.fireDestroy({...c,kind:'chair',targetId:c.id,key:fireDamageKey('chair',c.id,c),
      hitPoints:1,maxHitPoints:FIRE_MAX_HP.chair},'餐椅烧毁')).toBe(true);
    expect(p.psyche.recreation).toBeNull();expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
    const t=fixture();command(t,{type:'recreate',pawnId:t.pawns[0].id,kind:'social'});
    command(t,{type:'draft',pawnId:t.pawns[0].id,drafted:true});expect(t.pawns[0].psyche.recreation).toBeNull();
  });
  it('speech LOS respects walls, floors, and closed/open doors in 3D',()=>{
    const s=fixture(),[a,b]=s.pawns;Object.assign(a,pos(14));Object.assign(b,pos(18));
    expect(canSocialize(s,a,b)).toBe(true);
    s.blocks[index(16,16,9)]=Block.Stone;expect(canSocialize(s,a,b)).toBe(false);
    s.blocks[index(16,16,9)]=Block.Air;
    s.doors.push({...pos(16),id:s.nextId++,axis:'x',mode:'locked',openUntil:0});
    expect(canSocialize(s,a,b)).toBe(false);s.doors[0].mode='open';expect(canSocialize(s,a,b)).toBe(true);
    Object.assign(b,pos(14,16,11));s.blocks[index(14,16,10)]=Block.Stone;
    expect(canSocialize(s,a,b)).toBe(false);
    s.blocks[index(14,16,10)]=s.blocks[index(14,16,11)]=s.blocks[index(14,16,12)]=Block.Air;
    expect(canSocialize(s,a,b)).toBe(true);
    Object.assign(b,pos(24));expect(canSocialize(s,a,b)).toBe(false);
  });
  it('excludes sleep, combat, specialist conversations and other factions',()=>{
    const s=fixture(),[a,b]=s.pawns;Object.assign(b,pos(13));
    for(const phase of ['rest','trade','warden','care','handle','firefight','mental','combat'] as const){
      a.phase=phase;expect(sociallyAvailable(a,s.tick)).toBe(false);
    }
    a.phase='idle';a.drafted=true;expect(canSocialize(s,a,b)).toBe(false);a.drafted=false;
    b.faction='trader';expect(canSocialize(s,a,b)).toBe(false);b.faction='colony';
    b.sleepingSince=0;expect(canSocialize(s,a,b)).toBe(false);
  });
  it('instantaneous talk preserves cargo, work and route; only insult changes mood',()=>{
    const s=fixture(),[a,b]=s.pawns;Object.assign(b,pos(13));
    a.phase='work';a.jobId=999;a.cargo=freshBatch('wood',3);a.path=[at(pos(14))];
    const baseline=moodView(b,s.tick,21).target,job=structuredClone({cargo:a.cargo,path:a.path,jobId:a.jobId,phase:a.phase});
    for(let i=0;i<20000 && !s.socialLog.length;i++){s.tick++;updateSocial(s);}
    expect(s.socialLog.length).toBeGreaterThan(0);
    expect({cargo:a.cargo,path:a.path,jobId:a.jobId,phase:a.phase}).toEqual(job);
    a.social=initialSocial(s.tick,a.id);b.social=initialSocial(s.tick,b.id);
    applySocialInteraction(a,b,'deepTalk',s.tick);
    expect(opinionOf(b.social,a.id,s.tick)).toBeGreaterThan(0);expect(moodView(b,s.tick,21).target).toBe(baseline);
    applySocialInteraction(a,b,'insult',s.tick+1);expect(moodView(b,s.tick+1,21).target).toBe(baseline-5);
    expect(socialImpact(a)).toBeCloseTo(.82+.0275*a.skills.social.level);
  });
  it('recruitment retains identity and memories; actual prisoner departure keeps only referenced identity',()=>{
    const s=fixture(),a=s.pawns[0];s.tick=50;
    const b=structuredClone(s.pawns[1]);b.id=s.nextId++;b.name='新同伴';b.worn=[];b.social=initialSocial(50,b.id);s.pawns.push(b);
    applySocialInteraction(a,b,'deepTalk',s.tick);
    b.faction='prisoner';b.prisoner=initialPrisoner(s.tick);const social=structuredClone(b.social);
    s.prisonBecomeColonist(b);expect(b.social).toEqual(social);expect(s.pawns.at(-1)?.id).toBe(b.id);
    b.faction='prisoner';b.prisoner={...initialPrisoner(s.tick),policy:'release',releasing:true};b.x=0;
    prisonerTick(s,b);expect(s.pawns.some(p=>p.id===b.id)).toBe(false);
    expect(s.socialHistory).toEqual([{pawnId:b.id,name:b.name,faction:'prisoner',departedTick:50,dead:false}]);
    expect(VoxelSimulation.load(s.save()).socialHistory).toEqual(s.socialHistory);
    s.tick+=21*DAY;updateSocial(s);expect(s.socialHistory).toEqual([]);
  });
});
