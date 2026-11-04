import { afterEach, describe, expect, it, vi } from 'vitest';
import { Block, CELLS, HEIGHT, WIDTH, DEPTH, at, index, position, type Pos } from '../src/voxel/types';
import * as exploration from '../src/voxel/exploration';
import { VoxelSimulation } from '../src/voxel/world';
import { colonyWealthDetails } from '../src/voxel/wealth';

function chambers() {
  const blocks = new Uint8Array(CELLS).fill(Block.Stone);
  // The left corridor reaches the world boundary, a wall at x=5 seals a cave.
  for (let x = 0; x <= 4; x++) for (let z = 5; z <= 7; z++) blocks[index(x,20,z)] = Block.Air;
  for (let x = 6; x <= 9; x++) for (let y = 20; y <= 22; y++) for (let z = 5; z <= 7; z++) blocks[index(x,y,z)] = Block.Air;
  return blocks;
}
function hidden(sim: VoxelSimulation, block: number): Pos {
  const cell = sim.blocks.findIndex((b, i) => b === block && !sim.explored[i] &&
    position(i).z >= 1 && position(i).z <= HEIGHT-3 && !sim.explored[i+WIDTH*DEPTH]);
  expect(cell).toBeGreaterThan(-1); return position(cell);
}
afterEach(() => vi.restoreAllMocks());

describe('permanent six-neighbor exploration', () => {
  it('starts only from top and side air, reveals touching rock but not sealed or diagonal air', () => {
    const blocks = chambers();
    blocks[index(30,30,0)] = Block.Air; // bottom is not an independent exterior entrance
    blocks[index(5,21,5)] = Block.Air; // corner contact with known corridor
    const mask = exploration.initialExploration(blocks,3);
    expect(mask[index(0,20,5)]).toBe(1); expect(mask[index(4,20,5)]).toBe(1);
    expect(mask[index(5,20,5)]).toBe(1); // exposed rock surface
    expect(mask[index(5,21,5)]).toBe(0); expect(mask[index(6,20,5)]).toBe(0);
    expect(mask[index(30,30,0)]).toBe(0); expect(mask[index(30,30,15)]).toBe(0);
    blocks[index(30,30,15)] = Block.Air;
    expect(exploration.initialExploration(blocks,3)[index(30,30,14)]).toBe(1);
  });
  it('opening a visible rock face reveals all connected cave air and rock, and closing it never forgets', () => {
    const blocks = chambers(), mask = exploration.initialExploration(blocks,3);
    const gate = index(5,20,5); blocks[gate] = Block.Air;
    const changed = exploration.revealExploration(blocks,mask,[gate]);
    expect(changed.length).toBeGreaterThan(36);
    for (let x=6;x<=9;x++) for(let y=20;y<=22;y++) for(let z=5;z<=7;z++) expect(mask[index(x,y,z)]).toBe(1);
    expect(mask[index(10,22,7)]).toBe(1); expect(mask[index(11,22,7)]).toBe(0);
    const before = mask.slice(); blocks[gate] = Block.Masonry;
    expect(exploration.revealExploration(blocks,mask,[gate])).toEqual([]); expect(mask).toEqual(before);
  });
  it('cannot reveal a remote unknown opening; old generators remain fully known', () => {
    const blocks = chambers(), mask = exploration.initialExploration(blocks,3), remote=index(40,40,5);
    blocks[remote] = Block.Air; const before=mask.slice();
    expect(exploration.revealExploration(blocks,mask,[remote])).toEqual([]); expect(mask).toEqual(before);
    expect(exploration.initialExploration(blocks,1).every(v=>v===1)).toBe(true);
    expect(exploration.initialExploration(blocks,2).every(v=>v===1)).toBe(true);
  });
});

describe('authoritative exploration boundaries', () => {
  it('masks unknown air, ore and ladders identically in independent chunk buffers', () => {
    const sim=new VoxelSimulation(), air=hidden(sim,Block.Air), ore=hidden(sim,Block.Steel);
    sim.ladders[at(air)]=1;
    const chunks=sim.chunks();
    for(const p of [air,ore]) {
      const chunk=chunks.find(c=>c.id===Math.floor(p.y/16)*4+Math.floor(p.x/16))!;
      const i=(p.z*16+p.y%16)*16+p.x%16;
      expect(chunk.explored[i]).toBe(0); expect(chunk.blocks[i]).toBe(Block.Stone); expect(chunk.ladders[i]).toBe(0);
      chunk.explored[i]=1; chunk.blocks[i]=Block.Components;
      expect(sim.exploredAt(p)).toBe(false);
    }
    expect(sim.blocks[at(air)]).toBe(Block.Air); expect(sim.blocks[at(ore)]).toBe(Block.Steel);
  });
  it('accepts indistinguishable blind mining plans without probing air or revealing remote cells', () => {
    const sim=new VoxelSimulation(), air=hidden(sim,Block.Air), rock=hidden(sim,Block.Stone);
    const before=sim.explored.slice(), reveal=vi.spyOn(exploration,'revealExploration');
    const a=sim.command({type:'designate',tool:'mine',from:air}), b=sim.command({type:'designate',tool:'mine',from:rock});
    expect(a).toEqual(b); expect(a.ok).toBe(true);
    const publicPlan=({id,x,y,z,...job}:any)=>job;
    expect(publicPlan(sim.jobs[0])).toEqual(publicPlan(sim.jobs[1]));
    expect((sim as any).stands(sim.jobs[0])).toHaveLength(0);
    for(let i=0;i<20;i++)sim.step();
    expect(sim.explored).toEqual(before); expect(reveal).not.toHaveBeenCalled();
    expect(sim.jobs.filter(j=>j.kind==='mine')).toHaveLength(2);
    expect(sim.command({type:'designate',tool:'cancel',from:air}).ok).toBe(true);
    expect(sim.explored).toEqual(before);
  });
  it('rejects unknown movement, construction, areas and multi-cell building footprints uniformly', () => {
    const sim=new VoxelSimulation(), air=hidden(sim,Block.Air), stone=hidden(sim,Block.Stone);
    for(const p of [air,stone]) {
      expect(sim.command({type:'move',pawnId:sim.pawns[0].id,target:p})).toEqual({ok:false,message:'目标区域尚未探索'});
      for(const tool of ['wall','stock','farm','shaft'] as const)
        expect(sim.command({type:'designate',tool:tool as any,from:p})).toEqual({ok:false,message:'目标区域尚未探索'});
    }
    const p={...sim.spawn}, neighbor={...p,x:p.x+1};sim.explored[at(neighbor)]=0;
    expect((sim as any).placementReason('table',p,'x')).toBe('目标区域尚未探索');
  });
  it('invalidates all revealed chunks and removes only newly discovered redundant plans', () => {
    const sim=new VoxelSimulation(73129,undefined,true,3); sim.blocks=chambers();
    sim.explored=exploration.initialExploration(sim.blocks,3);
    (sim as any).exploredCount=sim.explored.reduce((a,b)=>a+b,0);
    const empty={x:6,y:20,z:5}, wall={x:10,y:20,z:5};
    expect(sim.command({type:'designate',tool:'mine',from:empty}).ok).toBe(true);
    expect(sim.command({type:'designate',tool:'mine',from:wall}).ok).toBe(true);
    sim.chunks(); const p={x:5,y:20,z:5};sim.blocks[at(p)]=Block.Air;(sim as any).changed(p);
    expect(sim.jobs.some(j=>j.x===empty.x)).toBe(false);expect(sim.jobs.some(j=>j.x===wall.x)).toBe(true);
    expect(sim.chunks().some(c=>c.id===4)).toBe(true);
    expect(sim.snapshot().exploration.known).toBe(sim.explored.reduce((a,b)=>a+b,0));
  });
  it('hides undiscovered entities, room statistics, inventory and wealth without mutating authority', () => {
    const sim=new VoxelSimulation(), air=hidden(sim,Block.Air), before=colonyWealthDetails(sim);
    const item={...structuredClone(sim.items[0]),...air,id:sim.nextId++,amount:500};sim.items.push(item);
    const animal={...structuredClone(sim.animals[0]),...air,id:sim.nextId++};sim.animals.push(animal);
    const snap=sim.snapshot(), room=sim.rooms.roomIds[at(air)];
    expect(snap.items.some(i=>i.id===item.id)).toBe(false);expect(snap.animals.some(i=>i.id===animal.id)).toBe(false);
    expect(snap.environment.items.some(i=>i.id===item.id)).toBe(false);
    expect(snap.rooms.some(r=>r.id===room)).toBe(false);expect(snap.roomTemperatures.some(r=>r.roomId===room)).toBe(false);
    expect(snap.roomCleanliness.some(r=>r.roomId===room)).toBe(false);expect(snap.roomLiving.some(r=>r.id===room)).toBe(false);
    expect(sim.visibleRoomIds()[at(air)]).toBe(-1);expect(sim.rooms.roomIds[at(air)]).toBe(room);
    expect(snap.inventory[item.resource]).toBe(sim.counts()[item.resource]-500);
    expect(colonyWealthDetails(sim).total).toBe(before.total);expect(sim.items.some(i=>i.id===item.id)).toBe(true);
  });
});
