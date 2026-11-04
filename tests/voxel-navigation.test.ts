import { describe, expect, it } from 'vitest';
import { WeightedNavigation } from '../src/voxel/navigation';
import { VoxelSimulation } from '../src/voxel/world';
import { at, Block, index, position, type Pos, type VoxelSave, type WildAnimal } from '../src/voxel/types';
import { defaultShelfSettings } from '../src/voxel/shelves';
import { initialAnimalState } from '../src/voxel/husbandry';

const pos=(x:number,y=16,z=8):Pos=>({x,y,z});
let baseline:VoxelSave;
function fixture(edit?:(s:VoxelSimulation)=>void) {
  if(!baseline) {
    const s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0});
    s.animals=[];s.grass=[];s.items=[];s.trees=[];s.stockpiles=[];s.homeArea.clear();
    s.blocks.fill(Block.Stone);s.ladders.fill(0);s.structureKinds.fill(0);
    for(let x=10;x<=30;x++)for(let y=12;y<=22;y++)for(let z=8;z<=9;z++)s.blocks[index(x,y,z)]=Block.Air;
    s.spawn=pos(12);
    for(const [i,p] of s.pawns.entries()) {
      Object.assign(p,pos(12,16+i));p.schedule.fill('work');p.rest=95;p.food=95;
      for(const work of Object.keys(p.priorities))p.priorities[work as keyof typeof p.priorities]=0;
    }
    s.command({type:'threats',enabled:false});s.command({type:'fireHazards',enabled:false});baseline=s.save();
  }
  const s=VoxelSimulation.load(structuredClone(baseline));edit?.(s);return VoxelSimulation.load(s.save());
}
function shelf(s:VoxelSimulation,p:Pos) { s.shelves.push({...p,id:s.nextId++,kind:'smallShelf',axis:'x',settings:defaultShelfSettings()}); }
function move(s:VoxelSimulation,target:Pos) {
  const result=s.command({type:'move',pawnId:s.pawns[0].id,target});expect(result.ok,result.message).toBe(true);
}
function finish(s:VoxelSimulation,target:Pos) {
  for(let i=0;i<500&&at(s.pawns[0])!==at(target);i++)s.step();
  expect(at(s.pawns[0])).toBe(at(target));
}

describe('bounded weighted navigation',()=>{
  it('matches an independent shortest-cost relaxation on directed graphs, including decrease-key and reuse',()=>{
    const n=32, nav=new WeightedNavigation(n);
    for(let seed=1;seed<=40;seed++) {
      const edges=Array.from({length:n},(_,a)=>Array.from({length:n},(_,b)=>b)
        .filter(b=>a!==b&&((a*19+b*37+seed*11)%13<3)));
      const cost=(a:number,b:number)=>1+((a*7+b*11+seed)%17);
      const best=Array(n).fill(Infinity);best[0]=0;
      for(let k=0;k<n-1;k++)for(let a=0;a<n;a++)for(const b of edges[a])best[b]=Math.min(best[b],best[a]+cost(a,b));
      for(let target=1;target<n;target++) {
        const path=nav.find(0,c=>c===target,c=>edges[c],cost);
        let total=0,prev=0;for(const cell of path??[]){expect(edges[prev]).toContain(cell);total+=cost(prev,cell);prev=cell;}
        expect(path===null?Infinity:total).toBe(best[target]);
        expect(path).toEqual(nav.find(0,c=>c===target,c=>edges[c],cost));
      }
    }
  });
  it('handles unreachable, start-as-goal, directed obstacles and a goal set',()=>{
    const nav=new WeightedNavigation(5), edges=[[1,2],[3],[4],[],[]];
    expect(nav.find(0,c=>c===0,c=>edges[c],()=>1)).toEqual([]);
    expect(nav.find(4,c=>c===0,c=>edges[c],()=>1)).toBeNull();
    expect(nav.find(0,c=>c===3||c===4,c=>edges[c],(_,to)=>to===1?20:1)).toEqual([2,4]);
    expect(nav.find(0,c=>c===3,c=>edges[c],(_,to)=>to===1?Infinity:1)).toBeNull();
  });
});

describe('voxel travel choices',()=>{
  it('takes a longer, faster detour around a shelf and actually follows that route',()=>{
    const s=fixture(s=>shelf(s,pos(14))),p=s.pawns[0];move(s,pos(16));
    expect(p.path).toHaveLength(6);expect(p.path).not.toContain(at(pos(14)));
    const started=s.tick;finish(s,pos(16));expect(s.tick-started).toBeLessThan(30);
  });
  it('uses a shelf when it is the only passage and charges the existing crossing delay',()=>{
    const s=fixture(s=>{
      for(let y=12;y<=22;y++)if(y!==16)for(let z=8;z<=9;z++)s.blocks[index(14,y,z)]=Block.Stone;
      shelf(s,pos(14));
    });
    move(s,pos(16));expect(s.pawns[0].path).toContain(at(pos(14)));
    while(s.pawns[0].x<14)s.step();expect(s.pawns[0].moveTick-s.tick).toBe(18);finish(s,pos(16));
  });
  it('accounts for actor speed, so a sufficiently slow pawn prefers fewer steps',()=>{
    const s=fixture(s=>shelf(s,pos(14))),p=s.pawns[0];
    expect(s.path(p,pos(16))).not.toContain(at(pos(14)));
    p.staggerUntil=s.tick+500;
    expect(s.path(p,pos(16))).toEqual([13,14,15,16].map(x=>at(pos(x))));
  });
  it('avoids a closed door when cheaper, then uses the same passage when held open',()=>{
    const s=fixture(s=>s.doors.push({...pos(14),id:s.nextId++,axis:'x',mode:'auto',openUntil:0}));
    s.step();expect(s.path(s.pawns[0],pos(16))).not.toContain(at(pos(14)));
    expect(s.command({type:'door',doorId:s.doors[0].id,mode:'open'}).ok).toBe(true);
    expect(s.path(s.pawns[0],pos(16))).toEqual([13,14,15,16].map(x=>at(pos(x))));
  });
  it('routes around accumulated snow even with clear weather',()=>{
    const s=fixture(s=>{s.snow=[13,14,15].map(x=>({...pos(x),depth:.8}));});
    expect(s.weather.kind).toBe('clear');move(s,pos(16));
    expect(s.pawns[0].path).toHaveLength(6);expect(s.pawns[0].path.every(n=>!s.snow.some(c=>at(c)===n))).toBe(true);
  });
  it('retains a destination and replans when a door locks ahead',()=>{
    const s=fixture(s=>s.doors.push({...pos(14),id:s.nextId++,axis:'x',mode:'open',openUntil:0}));
    move(s,pos(16));s.step();expect(s.pawns[0]).toMatchObject(pos(13));
    expect(s.command({type:'door',doorId:s.doors[0].id,mode:'locked'}).ok).toBe(true);
    finish(s,pos(16));expect(s.pawns[0].reason).not.toBe('通路改变，等待重新规划');
  });
  it('keeps allowed-cell constraints even when a cheaper detour exists',()=>{
    const s=fixture(s=>shelf(s,pos(14))),allowed=new Set([12,13,14,15,16].map(x=>at(pos(x))));
    expect(s.prisonPath(s.pawns[0],pos(16),allowed)).toEqual([13,14,15,16].map(x=>at(pos(x))));
  });
  it('uses actual ladder edges across floors and cannot jump through a blocked shaft',()=>{
    const s=fixture(s=>{
      for(let z=8;z<=11;z++){s.blocks[index(16,16,z)]=Block.Air;if(z<11)s.ladders[index(16,16,z)]=1;}
    });
    const path=s.path(s.pawns[0],pos(16,16,10));expect(path).not.toBeNull();
    expect(path!.map(position).some(p=>p.z===9)).toBe(true);
    s.ladders[index(16,16,9)]=0;expect(s.path(s.pawns[0],pos(16,16,10))).toBeNull();
  });
  it('continues weighted travel after save/load without changing cargo or the destination',()=>{
    let s=fixture(s=>shelf(s,pos(14)));move(s,pos(18));s.step(5);
    const target=s.pawns[0].destination,counts=s.counts();s=VoxelSimulation.load(s.save());
    expect(s.pawns[0].destination).toBe(target);expect(s.counts()).toEqual(counts);
    expect(s.pawns[0].path).not.toContain(at(pos(14)));finish(s,pos(18));
  });
  it('uses animal pace and physical obstacles for food routes while preserving door restrictions',()=>{
    const s=fixture(s=>{shelf(s,pos(14));shelf(s,pos(15));});
    const id=s.nextId++,a:WildAnimal={...pos(12),...initialAnimalState(id,'hare',s.tick),id,species:'hare',name:'野兔',
      health:28,hunger:80,dead:false,phase:'roam',hunt:false,moveTick:0,decisionTick:0,fleeUntil:0,threatId:null,retryTick:0,rotProgress:0};
    s.animals.push(a);
    const path=s.animalRoute(a,new Set([at(pos(17))]));expect(path).toHaveLength(7);
    expect(path).not.toContain(at(pos(14)));expect(path).not.toContain(at(pos(15)));
    expect(s.animalMoveTicks(a,pos(13),pos(14))).toBe(23);
    s.doors.push({...pos(13),id:s.nextId++,axis:'x',mode:'auto',openUntil:0});s.tick=1;
    expect(s.animalRoute(a,new Set([at(pos(17))]))).not.toContain(at(pos(13)));
  });
});
