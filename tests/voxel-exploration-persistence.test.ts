import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { CELLS, type VoxelSave } from '../src/voxel/types';
import { loadExploration } from '../src/voxel/exploration';
import * as worldgen from '../src/voxel/worldgen';

const hash='01da342a40412eba91f22d3cf0a7856018d48ce8db7725b2c4d353e82cd3e5bb';
function historical() {
  const bytes=readFileSync(new URL('./fixtures/voxel-v35-exploration-active.json',import.meta.url));
  const proof=JSON.parse(readFileSync(new URL('./fixtures/voxel-v35-exploration-active.provenance.json',import.meta.url),'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
  expect(proof).toMatchObject({sha256:hash,version:35,sourceCommit:'b125bd3ee4fd4e688b81d9deeecaa8c230723de3',terrainChangedCells:3,
    worldSite:{version:1,worldSeed:73129,tileId:714},generator:2});
  const raw=JSON.parse(bytes.toString());expect(raw.version).toBe(35);expect(raw.explored).toBeUndefined();return raw;
}
const persistent=(s:VoxelSave)=>({...s,pawns:s.pawns.map(({reason,...p})=>p)});
afterEach(()=>vi.restoreAllMocks());

describe('v36 exploration persistence',()=>{
  it('migrates genuine v35 edited terrain and active work to fully explored without regeneration',()=>{
    const old=historical(),before=structuredClone(old),generate=vi.spyOn(worldgen,'generateWorld');
    const sim=VoxelSimulation.load(old),saved=sim.save();
    expect(old).toEqual(before);expect(generate).not.toHaveBeenCalled();
    expect(saved.version).toBe(36);expect(saved.explored).toHaveLength(CELLS);expect(saved.explored.every(v=>v===1)).toBe(true);
    for(const key of ['generator','worldSite','seed','settings','tick','nextId','blocks','ladders','items','stats','stockpiles'] as const)
      expect(saved[key],key).toEqual(old[key]);
    const jobs=(values:any[])=>values.map(({reason,owner,...j})=>j);
    expect(jobs(saved.jobs)).toEqual(jobs(old.jobs));expect(saved.jobs.some(j=>j.kind==='mine' && j.progress>0)).toBe(true);
    expect(sim.snapshot().exploration).toEqual({known:CELLS,total:CELLS});
    expect(persistent(VoxelSimulation.load(saved).save())).toEqual(persistent(saved));
  });
  it('preserves the independent gen3 mask and site2 identity across save/load with no regeneration',()=>{
    const sim=VoxelSimulation.fromWorldSite({version:2,worldSeed:73129,tileId:714}),saved=sim.save();
    expect(saved.generator).toBe(3);expect(saved.explored.some(v=>v===0)).toBe(true);
    const generate=vi.spyOn(worldgen,'generateWorld'),loaded=VoxelSimulation.load(saved);
    expect(generate).not.toHaveBeenCalled();expect(persistent(loaded.save())).toEqual(persistent(saved));
    const old=loaded.explored[0];saved.explored[0]=old?0:1;expect(loaded.explored[0]).toBe(old);
    expect(loaded.snapshot().exploration.known).toBe(loaded.explored.reduce((a,b)=>a+b,0));
  });
  it.each([
    ['missing',(d:any)=>{delete d.explored}],['null',(d:any)=>{d.explored=null}],
    ['short',(d:any)=>{d.explored.pop()}],['long',(d:any)=>{d.explored.push(0)}],
    ['negative',(d:any)=>{d.explored[123]=-1}],['two',(d:any)=>{d.explored[123]=2}],
    ['boolean',(d:any)=>{d.explored[123]=true}],['string',(d:any)=>{d.explored[123]='1'}],
    ['NaN',(d:any)=>{d.explored[123]=NaN}],['sparse',(d:any)=>{delete d.explored[123]}],
    ['typed array',(d:any)=>{d.explored=Uint8Array.from(d.explored)}],
  ] as const)('rejects %s current exploration without mutating input or a running colony',(_name,mutate)=>{
    const sim=new VoxelSimulation(),running=sim.save(),bad=structuredClone(running);mutate(bad);const before=structuredClone(bad);
    expect(()=>VoxelSimulation.load(bad)).toThrow(/探索/);expect(bad).toEqual(before);expect(sim.save()).toEqual(running);
  });
  it.each([null,undefined,[],new Array(CELLS).fill(1)])('rejects an exploration field on historical data even when empty: %j',value=>{
    const old=historical();old.explored=value;const before=structuredClone(old);
    expect(()=>VoxelSimulation.load(old)).toThrow(/旧版本.*探索/);expect(old).toEqual(before);
  });
  it('rejects generator3 relabeled as old data and preserves a valid mask as an owned buffer',()=>{
    const old=historical();old.generator=3;expect(()=>VoxelSimulation.load(old)).toThrow();
    const raw=new Array(CELLS).fill(0),mask=loadExploration(raw);raw[0]=1;expect(mask[0]).toBe(0);
  });
  it.each([1,2])('requires generator %i saves to remain fully explored',generator=>{
    const old=generator===2?historical():JSON.parse(readFileSync(new URL('./fixtures/voxel-v7-start.json',import.meta.url),'utf8'));
    const saved=VoxelSimulation.load(old).save();saved.explored[123]=0;
    expect(()=>VoxelSimulation.load(saved)).toThrow(/探索记录必须全部可见/);
  });
});
