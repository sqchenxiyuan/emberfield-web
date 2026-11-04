import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const OUT='test-results/voxel-allowed-area-campaign';
const sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(OUT,{recursive:true});
const bundle=await build({entryPoints:['src/voxel/world.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {VoxelSimulation}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0});
const report={status:'running',scriptSha256:sha(await readFile(new URL(import.meta.url))),bundleSha256:sha(bundle.outputFiles[0].contents),
  scope:'Fresh generated colony; ordinary public commands only. Read-only geometry and paths select a work site. No injected terrain, inventory, needs, skills, time or pawn positions. Area editing, actual blocked/allowed material collection, lossless interruption, save/load, completion and return. Resource ledger audited each tick.',
  commands:[],checks:[],checkpoints:[]};
const initial=s.counts(),stats=structuredClone(s.stats),idx=p=>p.x+p.y*64+p.z*4096;
const pawnId=s.pawns[0].id,pawn=()=>s.pawns.find(p=>p.id===pawnId);
function audit(){const counts=s.counts();for(const r of Object.keys(counts))assert.equal(
  counts[r]+s.stats.consumed[r]-stats.consumed[r]+s.stats.destroyed[r]-stats.destroyed[r]+s.stats.spoiled[r]-stats.spoiled[r],
  initial[r]+s.stats.produced[r]-stats.produced[r],r);}
function command(c){const result=s.command(c);report.commands.push({tick:s.tick,command:c,result});assert(result.ok,JSON.stringify({c,result}));audit();return result;}
function check(name){report.checks.push({name,tick:s.tick});console.log('PASS',name,s.tick);}
function step(n){for(let i=0;i<n;i++){s.step();audit();}}
function until(name,done,max=4000){for(let i=0;i<max&&!done();i++)step(1);assert(done(),JSON.stringify({name,tick:s.tick,jobs:s.jobs,p:pawn()}));check(name);}
async function checkpoint(name){const bytes=JSON.stringify(s.save()),file=`${OUT}/${name}.json`;await writeFile(file,bytes);report.checkpoints.push({name,file,sha256:sha(bytes),tick:s.tick});}
function reload(){const before=s.save();s=VoxelSimulation.load(before);for(const k of ['blocks','water','bridges','animalAreas','items','stats','tick'])assert.deepEqual(s.save()[k],before[k]);audit();}
try{
  command({type:'threats',enabled:false});command({type:'fireHazards',enabled:false});
  for(const p of s.pawns)for(const work of Object.keys(p.priorities))command({type:'priority',pawnId:p.id,work,value:p.id===pawnId&&work==='build'?1:0});
  for(let hour=0;hour<24;hour++)command({type:'schedule',pawnId,hour,assignment:'work'});
  const points=[];
  for(let y=s.spawn.y-7;y<=s.spawn.y+7;y++)for(let x=s.spawn.x-7;x<=s.spawn.x+7;x++) {
    const q={x,y,z:s.spawn.z},distance=Math.abs(x-s.spawn.x)+Math.abs(y-s.spawn.y);
    if(distance>=5&&distance<=8&&s.standable(q)&&s.path(pawn(),q)!==null&&
      !s.items.some(i=>idx(i)===idx(q))&&!s.pawns.some(p=>idx(p)===idx(q)))points.push(q);
  }
  assert(points.length);const target=points[0],wood=s.items.find(i=>i.resource==='wood');assert(wood);
  report.target=target;report.wood={x:wood.x,y:wood.y,z:wood.z};
  const areaId=command({type:'allowedAreaCreate',name:'施工区'}).areaId;
  command({type:'pawnAreaAssign',pawnId,areaId});assert(s.pawnAllowed(pawn(),target));check('empty assignment is unrestricted');
  command({type:'allowedAreaPaint',areaId,from:target,erase:false});
  command({type:'designate',tool:'wall',from:target});step(80);
  assert.equal(s.stats.built,0);assert.equal(s.stats.consumed.wood,0);assert.equal(pawn().cargo,null);check('inside construction waits for outside materials');
  command({type:'allowedAreaPaint',areaId,from:report.wood,erase:false});
  until('worker really collects allowed wood',()=>pawn().cargo?.resource==='wood');
  assert(pawn().path.some(cell=>!s.animalAreas[0].cells.includes(cell)));await checkpoint('carrying');
  reload();assert.equal(pawn().allowedAreaId,areaId);check('carried materials and assignment survive load');
  command({type:'allowedAreaPaint',areaId,from:target,erase:true});
  assert.equal(pawn().jobId,null);assert.equal(pawn().cargo?.resource,'wood');
  step(80);assert.equal(s.stats.built,0);check('shrinking the area interrupts work without losing carried materials');await checkpoint('interrupted');
  command({type:'allowedAreaPaint',areaId,from:target,erase:false});
  until('expanded area resumes real construction',()=>s.stats.built===1);reload();await checkpoint('built');
  command({type:'allowedAreaRename',areaId,name:'完成区'});assert.equal(s.animalAreas[0].name,'完成区');
  const outside=points.find(q=>idx(q)!==idx(target)&&!s.animalAreas[0].cells.includes(idx(q))&&s.path(pawn(),q)!==null);assert(outside);
  const denied=s.command({type:'move',pawnId,target:outside});assert.equal(denied.ok,false);
  report.commands.push({tick:s.tick,command:{type:'move',pawnId,target:outside},result:denied,expectedRejection:true});
  command({type:'draft',pawnId,drafted:true});command({type:'move',pawnId,target:outside});
  until('drafted colonist reaches an outside destination',()=>idx(pawn())===idx(outside));
  command({type:'draft',pawnId,drafted:false});
  until('released colonist returns by physical movement',()=>s.animalAreas[0].cells.includes(idx(pawn())));
  const before=JSON.stringify(s.save().blocks),exploration=s.explored.slice();
  command({type:'allowedAreaPaint',areaId,from:{...target,z:target.z+3},erase:false});
  assert.equal(JSON.stringify(s.save().blocks),before);assert.deepEqual(s.explored,exploration);check('multilayer mask edits leave terrain and exploration unchanged');
  reload();command({type:'animalAreaDelete',areaId});assert.equal(pawn().allowedAreaId,null);assert.equal(s.animalAreas.length,0);check('shared alias deletion clears colonist references');await checkpoint('final');
  report.status='passed';report.finalTick=s.tick;report.finalCounts=s.counts();
}catch(error){report.status='failed';report.error=error.stack;throw error;}finally{await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2)+'\n');}
