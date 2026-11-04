import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Block, CELLS, position, type VoxelSave } from '../src/voxel/types';
import { readFileSync } from 'node:fs';

const messages:any[]=[],transfers:any[]=[];
const context={onmessage:null as null|((event:any)=>void),postMessage:(m:any,buffers?:any)=>{messages.push(structuredClone(m));transfers.push(buffers)}};
let sequence=0;
function request(type:string,fields:Record<string,unknown>={}) {
  const id=++sequence;context.onmessage!({data:{type,id,...fields}});
  const reply=messages.findLast(m=>m.type==='reply' && m.id===id);expect(reply).toBeTruthy();return reply;
}
const save=():VoxelSave=>request('save').result;
beforeAll(async()=>{vi.stubGlobal('self',context);vi.stubGlobal('setInterval',vi.fn());await import('../src/voxel/sim.worker')});
beforeEach(()=>{expect(request('new',{seed:73129}).error).toBeUndefined();messages.length=0;transfers.length=0});
afterAll(()=>vi.unstubAllGlobals());
describe('worker exploration boundary',()=>{
  it('publishes five independent chunk buffers and masks hidden topology, water and room IDs',()=>{
    request('new',{seed:73129});const state=messages.findLast(m=>m.type==='state'),data=save();
    expect(state.snapshot.exploration.known).toBeLessThan(CELLS);expect(state.snapshot).not.toHaveProperty('explored');
    const transfer=transfers.find(t=>t?.length===81);expect(transfer).toHaveLength(81);
    expect(new Set(transfer).size).toBe(81);
    for(const chunk of state.chunks) for(let i=0;i<chunk.explored.length;i++) if(!chunk.explored[i]) {
      expect(chunk.blocks[i]).toBe(Block.Stone);expect(chunk.ladders[i]).toBe(0);
      expect(chunk.water[i]).toBe(0);expect(chunk.bridges[i]).toBe(0);
    }
    const cell=data.explored.findIndex(v=>v===0);expect(state.roomIds[cell]).toBe(-1);
    const p=position(cell);expect(request('command',{command:{type:'designate',tool:'wall',from:p}}).result.ok).toBe(false);
  });
  it('malformed exploration leaves active save, speed and published state intact',()=>{
    request('speed',{value:3});const before=save();
    for(const mutate of [(d:any)=>{delete d.explored},(d:any)=>{d.explored[1]=2},(d:any)=>{d.explored.pop()}]) {
      const bad=structuredClone(before);mutate(bad);const start=messages.length;
      expect(request('load',{save:bad}).error).toMatch(/探索/);
      expect(messages.slice(start).filter(m=>m.type==='state')).toHaveLength(0);expect(save()).toEqual(before);
    }
    expect(messages.findLast(m=>m.type==='state').snapshot.speed).toBe(3);
  });
  it('loads genuine v35 with all cells visible and leaves the exact terrain and site intact',()=>{
    const old=JSON.parse(readFileSync(new URL('./fixtures/voxel-v35-exploration-active.json',import.meta.url),'utf8'));
    expect(request('load',{save:old}).error).toBeUndefined();const next=save();
    expect(next).toMatchObject({version: 48,generator:2,worldSite:old.worldSite,blocks:old.blocks,ladders:old.ladders});
    expect(next.explored.every(v=>v===1)).toBe(true);
    expect(messages.findLast(m=>m.type==='state').snapshot.exploration).toEqual({known:CELLS,total:CELLS});
  });
});
