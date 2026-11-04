import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type ApparelKind, type Pawn, type Pos, type VoxelCommand } from '../src/voxel/types';
import { makeApparel } from '../src/voxel/apparel';
import { initialApparelControl } from '../src/voxel/apparelPolicies';
import { stripApparelPoliciesFields } from './legacy-apparel-policies-defaults';

const pos = (x:number,y=16,z=8):Pos => ({x,y,z});
function cmd(s:VoxelSimulation,c:VoxelCommand) { const r=s.command(c); expect(r.ok,r.message).toBe(true); return r; }
function fixture() {
  const s = new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0},false,2);
  s.animals=[];s.grass=[];s.trees=[];s.items=[];s.stockpiles=[];
  s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
  for(let x=10;x<=30;x++)for(let y=10;y<=24;y++)for(let z=8;z<16;z++)s.blocks[index(x,y,z)]=Block.Air;
  s.spawn=pos(12);
  for(const [i,p] of s.pawns.entries()) {
    Object.assign(p,pos(12,16+i)); p.schedule.fill('work');p.worn=[];
    p.apparelControl=initialApparelControl(s.tick,i===0?1:null);
    for(const key of Object.keys(p.priorities))p.priorities[key as keyof Pawn['priorities']]=0;
  }
  cmd(s,{type:'threats',enabled:false});cmd(s,{type:'fireHazards',enabled:false});
  return VoxelSimulation.load(s.save());
}
function garment(s:VoxelSimulation,kind:ApparelKind='tuque',stored=true,where=pos(22)) {
  const item={id:s.nextId++,...where,resource:'apparel' as const,amount:1,apparel:makeApparel(s.nextId++,kind)};
  s.items.push(item);
  if(stored&&!s.stockpiles.some(p=>at(p)===at(where)))cmd(s,{type:'designate',tool:'stock',from:where});
  return item;
}
function until(s:VoxelSimulation,done:()=>boolean,max=1800) {
  for(let n=0;n<max&&!done();n++)s.step();
  expect(done(),JSON.stringify(s.pawns.map(p=>({phase:p.phase,reason:p.reason,task:p.apparelTask,cargo:p.cargo})))).toBe(true);
}
function policy(s:VoxelSimulation,patch:Partial<typeof s.apparelPolicies.policies[number]>) {
  cmd(s,{type:'apparelPolicyUpdate',policy:{...structuredClone(s.apparelPolicies.policies[0]),...patch}});
}
function identities(s:VoxelSimulation) {
  return [...s.items.flatMap(i=>i.apparel?[i.apparel.id]:[]),...s.pawns.flatMap(p=>[...p.worn.map(a=>a.id),...(p.cargo?.apparel?[p.cargo.apparel.id]:[])])].sort((a,b)=>a-b);
}

describe('physical apparel policy management',()=>{
  it('assigns new colonists a shared policy and migrates controlled old-format graphs to manual',()=>{
    const s=new VoxelSimulation(73129);expect(s.pawns.every(p=>p.apparelControl.policyId===1)).toBe(true);
    const old:any=s.save();stripApparelPoliciesFields(old);old.version=55;
    const next=VoxelSimulation.load(old);expect(next.pawns.every(p=>p.apparelControl.policyId===null)).toBe(true);
    expect(old.pawns.every((p:any)=>!Object.hasOwn(p,'apparelControl'))).toBe(true);
  });
  it('only seeks stored clothing, walks and carries it before equipping, with fetch/work reloads',()=>{
    let s=fixture();const loose=garment(s,'simpleHelmet',false,pos(13)),stored=garment(s),id=stored.apparel.id;
    const before=identities(s);until(s,()=>s.pawns[0].apparelTask!==null);
    expect(s.pawns[0].apparelTask).toMatchObject({automatic:true,stage:'fetch',apparelId:id});
    expect(s.pawns[0].worn).toHaveLength(0);expect(s.pawns[0].path.length).toBeGreaterThan(0);
    s=VoxelSimulation.load(s.save());until(s,()=>!!s.pawns[0].cargo?.apparel);
    expect(s.items.some(i=>i.apparel?.id===id)).toBe(false);expect(s.pawns[0].worn).toHaveLength(0);
    s=VoxelSimulation.load(s.save());until(s,()=>s.pawns[0].worn.some(a=>a.id===id));
    expect(s.pawns[0].apparelControl.forcedIds).toEqual([]);expect(identities(s)).toEqual(before);
    expect(s.items.some(i=>i.id===loose.id)).toBe(true);expect(VoxelSimulation.load(s.save()).pawns[0].worn[0].id).toBe(id);
  });
  it('replaces incompatible clothing atomically and leaves the old physical garment on the ground',()=>{
    const s=fixture(),p=s.pawns[0],old=makeApparel(s.nextId++,'tuque');p.worn=[old];
    const next=garment(s,'simpleHelmet'),before=identities(s);
    until(s,()=>p.worn.some(a=>a.id===next.apparel.id));
    expect(p.worn.some(a=>a.id===old.id)).toBe(false);expect(s.items.some(i=>i.apparel?.id===old.id)).toBe(true);
    expect(identities(s)).toEqual(before);expect(s.counts().apparel).toBe(2);
  });
  it('removes policy-disallowed clothing before considering stored replacements',()=>{
    const s=fixture(),p=s.pawns[0],old=makeApparel(s.nextId++,'shirt');p.worn=[old];garment(s);
    policy(s,{allowedKinds:['tuque']});until(s,()=>!!p.apparelTask);
    expect(p.apparelTask).toMatchObject({action:'remove',apparelId:old.id,automatic:true});
    until(s,()=>p.worn.some(a=>a.kind==='tuque'));
    expect(s.items.some(i=>i.apparel?.id===old.id)).toBe(true);
  });
  it('marks manual wear only after completion, protects it, then unlocks for shared policy removal',()=>{
    const s=fixture(),p=s.pawns[0],item=garment(s,'parka',false);
    policy(s,{allowedKinds:[]});cmd(s,{type:'wear',pawnId:p.id,apparelId:item.apparel.id});
    expect(p.apparelControl.forcedIds).toEqual([]);until(s,()=>p.worn.length===1);
    expect(p.apparelControl.forcedIds).toEqual([item.apparel.id]);s.step(40);expect(p.worn.length).toBe(1);
    cmd(s,{type:'apparelUnforce',pawnId:p.id,apparelId:item.apparel.id});expect(p.worn.length).toBe(1);
    until(s,()=>p.worn.length===0);expect(identities(s)).toEqual([item.apparel.id]);
  });
  it('lets manual replacement override forced apparel and removes obsolete forced references',()=>{
    const s=fixture(),p=s.pawns[0],old=makeApparel(s.nextId++,'tuque');p.worn=[old];p.apparelControl.forcedIds=[old.id];
    const item=garment(s,'simpleHelmet');s.step(30);expect(p.apparelTask).toBeNull();
    cmd(s,{type:'wear',pawnId:p.id,apparelId:item.apparel.id});until(s,()=>p.worn.some(a=>a.id===item.apparel.id));
    expect(p.apparelControl.forcedIds).toEqual([item.apparel.id]);expect(()=>VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('cancels policy-invalid fetch and work while preserving the carried garment',()=>{
    let s=fixture();const item=garment(s);until(s,()=>s.pawns[0].apparelTask?.stage==='fetch');
    policy(s,{allowedKinds:[]});expect(s.pawns[0].apparelTask).toBeNull();expect(s.items.some(i=>i.id===item.id)).toBe(true);
    policy(s,{allowedKinds:['tuque']});until(s,()=>s.pawns[0].apparelTask?.stage==='work');
    policy(s,{allowedKinds:[]});expect(s.pawns[0].apparelTask).toBeNull();expect(s.pawns[0].cargo?.apparel?.id).toBe(item.apparel.id);
    s=VoxelSimulation.load(s.save());expect(identities(s)).toEqual([item.apparel.id]);
  });
  it('prevents two colonists from claiming the same stored garment',()=>{
    const s=fixture();garment(s);cmd(s,{type:'pawnApparelPolicy',pawnId:s.pawns[1].id,policyId:1});
    until(s,()=>s.pawns.some(p=>!!p.apparelTask));expect(s.pawns.filter(p=>!!p.apparelTask)).toHaveLength(1);
    until(s,()=>s.pawns.some(p=>p.worn.length===1));expect(identities(s)).toHaveLength(1);
  });
  it('honors forbidden flags and rechecks them mid-fetch without clearing them',()=>{
    const s=fixture(),p=s.pawns[0],item=garment(s);(item as any).forbidden=true;s.step(10);expect(p.apparelTask).toBeNull();
    cmd(s,{type:'itemForbidden',itemId:item.id,forbidden:false});cmd(s,{type:'pawnApparelPolicy',pawnId:p.id,policyId:1});
    until(s,()=>p.apparelTask?.stage==='fetch');cmd(s,{type:'itemForbidden',itemId:item.id,forbidden:true});
    expect(p.apparelTask).toBeNull();expect((item as any).forbidden).toBe(true);expect(identities(s)).toEqual([item.apparel.id]);
  });
  it('respects allowed-area targets and cancels an automatic outside fetch immediately after edits',()=>{
    const s=fixture(),p=s.pawns[0],item=garment(s);
    const area=cmd(s,{type:'allowedAreaCreate',name:'衣物区'}).areaId!;
    cmd(s,{type:'allowedAreaPaint',areaId:area,from:pos(12),to:pos(22),erase:false});
    cmd(s,{type:'pawnAreaAssign',pawnId:p.id,areaId:area});until(s,()=>p.apparelTask?.stage==='fetch');
    cmd(s,{type:'allowedAreaPaint',areaId:area,from:pos(22),erase:true});expect(p.apparelTask).toBeNull();
    expect(s.pawnAllowed(p,item)).toBe(false);expect(s.items.some(i=>i.id===item.id)).toBe(true);
  });
  it('cannot pick apparel being hauled even while it is still in lower-priority storage',()=>{
    const s=fixture(),p=s.pawns[0],hauler=s.pawns[1],item=garment(s,'tuque',true,pos(26));
    cmd(s,{type:'pawnApparelPolicy',pawnId:p.id,policyId:null});hauler.priorities.haul=1;
    cmd(s,{type:'designate',tool:'stock',from:pos(28)});
    s.stockpiles.find(q=>at(q)===at(pos(28)))!.priority=3;
    until(s,()=>hauler.phase==='haul');expect(hauler.cargo).toBeNull();
    cmd(s,{type:'pawnApparelPolicy',pawnId:p.id,policyId:1});s.step(20);expect(p.apparelTask).toBeNull();
    expect(s.items.some(i=>i.id===item.id)).toBe(true);
  });
  it('uses seasonal outdoor climate for clothing choice',()=>{
    const s=fixture();s.settings.meanTemperature=-10;
    const parka=garment(s,'parka',true,pos(22)),duster=garment(s,'duster',true,pos(23));
    until(s,()=>!!s.pawns[0].apparelTask);expect(s.pawns[0].apparelTask?.apparelId).toBe(parka.apparel.id);
    expect(s.items.some(i=>i.id===duster.id)).toBe(true);
  });
  it('backs off after no candidate and wakes on policy edits',()=>{
    const s=fixture(),p=s.pawns[0];until(s,()=>p.apparelControl.nextCheckTick>0);const next=p.apparelControl.nextCheckTick;
    expect(next).toBeGreaterThanOrEqual(s.tick+6000);expect(next).toBeLessThanOrEqual(s.tick+9000);
    garment(s);s.step(10);expect(p.apparelTask).toBeNull();expect(p.apparelControl.nextCheckTick).toBe(next);
    policy(s,{name:'日常'});until(s,()=>!!p.apparelTask);
  });
  it('keeps policy identity separate and rejects malformed or referenced mutations without changes',()=>{
    const s=fixture(),nextId=s.nextId;cmd(s,{type:'apparelPolicyCreate',sourceId:1});expect(s.nextId).toBe(nextId);
    expect(s.apparelPolicies.policies[1].id).toBe(2);cmd(s,{type:'apparelPolicyDelete',policyId:2});
    for(const c of [{type:'apparelPolicyDelete',policyId:1},{type:'apparelPolicyUpdate',policy:{...s.apparelPolicies.policies[0],minQuality:7}},
      {type:'pawnApparelPolicy',pawnId:s.pawns[0].id,policyId:NaN},{type:'apparelUnforce',pawnId:s.pawns[0].id,apparelId:1},
      {type:'apparelPolicyCreate',sourceId:999},{type:'apparelPolicyCreate',extra:true}]) {
      const before=s.save();expect(s.command(c as VoxelCommand).ok).toBe(false);expect(s.save()).toEqual(before);
    }
    const snap=s.snapshot();snap.apparelPolicies.policies[0].name='outside';expect(s.apparelPolicies.policies[0].name).toBe('自由穿戴');
  });
  it('rejects poisoned current and downgrade saves without mutating their inputs',()=>{
    const s=fixture();garment(s);until(s,()=>!!s.pawns[0].apparelTask);
    for(const mutate of [(d:any)=>{d.pawns[0].apparelTask.automatic=false;},(d:any)=>{d.pawns[0].apparelControl.policyId=999;},
      (d:any)=>{d.pawns[0].apparelControl.forcedIds=[999];},(d:any)=>{d.apparelPolicies.policies[0].allowedKinds=[];},
      (d:any)=>{d.version=55;}]) {
      const d=s.save();mutate(d);const before=structuredClone(d);expect(()=>VoxelSimulation.load(d)).toThrow();expect(d).toEqual(before);
    }
  });
});
