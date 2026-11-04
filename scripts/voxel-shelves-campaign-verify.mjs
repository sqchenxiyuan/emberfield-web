import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadLegacyStart } from './voxel-legacy-start.mjs';
const OUT=process.env.VOXEL_SHELVES_OUT??'test-results/voxel-shelves-campaign';await mkdir(OUT,{recursive:true});
const bundle=await build({stdin:{contents:"export {VoxelSimulation} from './src/voxel/world'; export {shelfCells} from './src/voxel/shelves'; export {at} from './src/voxel/types';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {VoxelSimulation,shelfCells,at}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let s=await loadLegacyStart(VoxelSimulation);const initial=s.counts();
const report={scope:'Only normal commands, stepping and saves from unchanged historical world. No added resources, modified needs, terrain or actors.',commands:[],checks:[]};
const pos=(x,y,z=8)=>({x,y,z});
const same=(a,b)=>at(a)===at(b);
function command(c){const r=s.command(c);report.commands.push({tick:s.tick,command:c,result:r});assert(r.ok,JSON.stringify({c,r}));}
function audit(){const counts=s.counts();for(const r of Object.keys(initial))assert.equal(counts[r]+s.stats.consumed[r]+s.stats.spoiled[r]+s.stats.destroyed[r],initial[r]+s.stats.produced[r],r);
  const cells=new Map();for(const item of s.items)cells.set(at(item),(cells.get(at(item))??0)+1);
  for(const [cell,n] of cells)assert(n<=(s.shelves.some(sh=>shelfCells(sh).some(p=>at(p)===cell))||s.storageSpills.some(p=>at(p)===cell)?3:1));
}
function until(name,f,max=12000){let n=0;while(!f()&&n++<max){s.step();audit();}assert(f(),JSON.stringify({name,tick:s.tick,jobs:s.jobs,pawns:s.pawns.map(p=>[p.reason,p.cargo])}));report.checks.push({name,tick:s.tick});console.log('PASS',name,s.tick);}
async function save(name){await writeFile(`${OUT}/${name}.json`,JSON.stringify(s.save()));}
command({type:'threats',enabled:false});command({type:'fireHazards',enabled:false});
// Choose genuinely free, reachable sites in the starting settlement.
const spawn=s.snapshot().spawn;
const candidates=[];for(let y=spawn.y-5;y<=spawn.y+5;y++)for(let x=spawn.x-5;x<=spawn.x+5;x++)candidates.push(pos(x,y,spawn.z));
let site;
for(const p of candidates){const r=s.command({type:'designate',tool:'shelf',from:p,axis:'x'});if(r.ok){site=p;report.commands.push({tick:s.tick,command:{type:'designate',tool:'shelf',from:p,axis:'x'},result:r});break;}}
assert(site);await save('before-build');
until('large shelf built through material delivery and work',()=>s.shelves.length===1);
const id=s.shelves[0].id;
command({type:'shelfStorage',shelfId:id,priority:3,accepts:['wood','steel','food','grain','meal','components']});
until('multiple stacks stored in a single shelf cell',()=>shelfCells(s.shelves[0]).some(p=>s.items.filter(i=>same(i,p)).length>=2));
await save('stocked');
const stocked=s.items.filter(i=>shelfCells(s.shelves[0]).some(p=>same(p,i)));assert(stocked.length>=2);
const excluded=stocked.find(i=>i.resource==='wood')?.resource??stocked[0].resource;
command({type:'shelfStorage',shelfId:id,priority:3,accepts:s.shelves[0].settings.accepts.filter(r=>r!==excluded)});
assert(s.items.some(i=>i.id===stocked.find(i=>i.resource===excluded).id));report.checks.push({name:'filter changes preserve existing goods',tick:s.tick});
const settings=structuredClone(s.shelves[0].settings);
command({type:'uninstallFurniture',kind:'shelf',furnitureId:id});
until('stocked shelf uninstalled with goods separate from original package',()=>!s.shelves.length&&[...s.items,...s.pawns.flatMap(p=>p.cargo?[p.cargo]:[])].some(i=>i.furniture?.id===id));
await save('uninstalled');s=VoxelSimulation.load(s.save());audit();
command({type:'installFurniture',kind:'shelf',furnitureId:id,target:site,axis:'x'});
until('same shelf reinstalled after save and reload',()=>s.shelves.some(sh=>sh.id===id));
assert.deepEqual(s.shelves[0].settings,settings);audit();await save('final');
const loaded=VoxelSimulation.load(s.save());assert.deepEqual(loaded.shelves,s.shelves);
report.checks.push({name:'settings and original identity survive final reload',tick:s.tick});
await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2));
