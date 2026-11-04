import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const OUT='test-results/voxel-navigation-campaign',input='test-results/navigation-shelves-campaign/stocked.json';
await mkdir(OUT,{recursive:true});
const bundle=await build({stdin:{contents:"export {VoxelSimulation} from './src/voxel/world';export {at,position} from './src/voxel/types';export {shelfCells} from './src/voxel/shelves';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {VoxelSimulation,at,position,shelfCells}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const bytes=await readFile(input);let s=VoxelSimulation.load(JSON.parse(bytes));
const report={input,inputSha256:createHash('sha256').update(bytes).digest('hex'),scope:'Resume an ordinary-command shelf construction/hauling checkpoint. Mutations only through public commands, ticks and save/load. Read-only geometry/paths. No injected terrain, actor state, resources or timers.',commands:[],checks:[],trace:[]};
const initial=s.counts(),ledger=structuredClone(s.stats),id=s.pawns[0].id;
const pawn=()=>s.pawns.find(p=>p.id===id);
function command(c){const result=s.command(c);report.commands.push({tick:s.tick,command:c,result});assert(result.ok,result.message);}
function audit(){for(const r of Object.keys(initial))assert.equal(s.counts()[r]+s.stats.consumed[r]-ledger.consumed[r]+s.stats.spoiled[r]-ledger.spoiled[r]+s.stats.destroyed[r]-ledger.destroyed[r],initial[r]+s.stats.produced[r]-ledger.produced[r],r);}
function until(f,max=2000){for(let i=0;i<max&&!f();i++){const old=at(pawn());s.step();audit();if(at(pawn())!==old)report.trace.push({tick:s.tick,cell:at(pawn()),moveTick:pawn().moveTick});}assert(f(),pawn().reason);}
const check=name=>{report.checks.push({name,tick:s.tick});console.log('PASS',name);};
for(const p of s.pawns)command({type:'draft',pawnId:p.id,drafted:true});
const shelf=s.shelves[0],from={x:shelf.x+1,y:shelf.y-2,z:shelf.z},to={...from,y:shelf.y+2};
// This is the actual shelf from normal construction, with a parallel open aisle.
for(let y=from.y;y<=to.y;y++)for(const x of [shelf.x+1,shelf.x+2])assert(s.standable({x,y,z:shelf.z}));
command({type:'move',pawnId:id,target:from});until(()=>at(pawn())===at(from));
await writeFile(`${OUT}/before.json`,JSON.stringify(s.save()));
command({type:'move',pawnId:id,target:to});
const planned=[...pawn().path],shelfIndices=shelfCells(shelf).map(at);
assert.equal(planned.length,6);assert(planned.every(n=>!shelfIndices.includes(n)));check('longer route uses the open aisle beside a real stocked shelf');
report.pawnId=id;report.from=from;report.to=to;report.shelfId=shelf.id;report.planned=planned.map(position);report.directSteps=4;
report.navigationBytes=s.snapshot().navigationBytes;assert(report.navigationBytes<4*1024*1024);
until(()=>at(pawn())!==at(from));const target=pawn().destination;
await writeFile(`${OUT}/mid.json`,JSON.stringify(s.save()));s=VoxelSimulation.load(s.save());
assert.equal(pawn().destination,target);assert(pawn().path.every(n=>!shelfIndices.includes(n)));audit();check('mid-trip save keeps its destination and physical goods');
report.trace=[];until(()=>at(pawn())===at(to));assert(report.trace.every(p=>!shelfIndices.includes(p.cell)));check('actual movement reaches the destination without crossing the shelf');
assert(shelfIndices.some(n=>s.items.some(i=>at(i)===n)));check('shelf remains stocked and the resource ledger balances');
await writeFile(`${OUT}/after.json`,JSON.stringify(s.save()));await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2));
