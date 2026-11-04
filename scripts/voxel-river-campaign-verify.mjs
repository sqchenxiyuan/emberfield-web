import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const OUT='test-results/voxel-river-campaign';
const sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(OUT,{recursive:true});
const bundle=await build({entryPoints:['src/voxel/world.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {VoxelSimulation}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let s=new VoxelSimulation(73129,{hilliness:'flat',river:'creek'});
const report={status:'running',scriptSha256:sha(await readFile(new URL(import.meta.url))),bundleSha256:sha(bundle.outputFiles[0].contents),
  scope:'Fresh generated creek colony; ordinary public commands only. Read-only path/terrain inspection chooses a crossing. No injected terrain, inventory, needs, skills, timers or pawn positions. Resource ledger checked every tick/command/reload.',
  commands:[],checks:[],checkpoints:[]};
const initial=s.counts(),initialStats=structuredClone(s.stats),idx=p=>p.x+p.y*64+p.z*4096;
const same=(a,b)=>idx(a)===idx(b);
function audit(){const counts=s.counts();for(const r of Object.keys(counts))assert.equal(
  counts[r]+s.stats.consumed[r]-initialStats.consumed[r]+s.stats.destroyed[r]-initialStats.destroyed[r]+s.stats.spoiled[r]-initialStats.spoiled[r],
  initial[r]+s.stats.produced[r]-initialStats.produced[r],r);}
function command(c){const result=s.command(c);report.commands.push({tick:s.tick,command:c,result});assert(result.ok,JSON.stringify({c,result}));audit();}
function check(name){report.checks.push({name,tick:s.tick});console.log('PASS',name,s.tick);}
function until(name,done,max=7000){for(let i=0;i<max&&!done();i++){s.step();audit();}assert(done(),JSON.stringify({name,tick:s.tick,jobs:s.jobs,pawns:s.pawns.map(p=>({phase:p.phase,reason:p.reason,cargo:p.cargo}))}));check(name);}
async function checkpoint(name){const data=JSON.stringify(s.save()),file=`${OUT}/${name}.json`;await writeFile(file,data);report.checkpoints.push({name,file,sha256:sha(data),tick:s.tick});}
function reload(){const before=s.save();s=VoxelSimulation.load(before);for(const key of ['water','bridges','blocks','items','stats','tick'])assert.deepEqual(s.save()[key],before[key]);audit();}
try{
  assert(s.water.some(v=>v===1));assert.equal(s.generator,4);check('fresh map contains physical shallow water and dry starting supplies');
  command({type:'threats',enabled:false});command({type:'fireHazards',enabled:false});
  for(const p of s.pawns){command({type:'priority',pawnId:p.id,work:'build',value:p.id===s.pawns[0].id?1:0});
    command({type:'priority',pawnId:p.id,work:'cut',value:0});}
  for(let hour=0;hour<24;hour++)command({type:'schedule',pawnId:s.pawns[0].id,hour,assignment:'work'});
  const candidates=[];
  for(let z=2;z<14;z++)for(let y=2;y<62;y++)for(let x=2;x<60;x++){
    const points=[0,1,2].map(dx=>({x:x+dx,y,z}));
    if(points.every(p=>s.water[idx(p)-4096]===1&&s.standable(p))){
      candidates.push({points,distance:Math.abs(x-s.spawn.x)+Math.abs(y-s.spawn.y)+Math.abs(z-s.spawn.z)});
    }
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  const crossing=candidates.find(c=>c.points.every(p=>s.path(s.pawns[0],p)!==null));assert(crossing);
  report.crossing=crossing.points;const start=crossing.points[0],end=crossing.points[2],bridge=p=>s.bridges[idx(p)-4096]===1;
  const slow=s.weatherMoveTicks(start,4,start);
  command({type:'designate',tool:'bridge',from:start,to:end});await checkpoint('planned');
  until('worker delivers real wood and begins construction',()=>s.jobs.some(j=>j.kind==='bridge'&&j.progress>0));
  await checkpoint('working');reload();check('in-progress construction reload keeps water and delivered materials');
  until('three bridge decks completed',()=>crossing.points.every(bridge)&&!s.jobs.some(j=>j.kind==='bridge'));
  assert.equal(s.stats.consumed.wood-initialStats.consumed.wood,18);assert(s.weatherMoveTicks(start,4,start)<slow);
  assert(crossing.points.every(p=>s.water[idx(p)-4096]===1));check('bridge preserves underlying water and removes wading cost');await checkpoint('built');
  const pawnId=s.pawns[1].id,movingStart=s.tick;assert(!same(s.pawns[1],end));
  command({type:'draft',pawnId,drafted:true});command({type:'move',pawnId,target:end});
  assert(s.pawns[1].path.length>2);
  until('pawn actually reaches bridge via normal movement',()=>same(s.pawns.find(p=>p.id===pawnId),end));
  assert(s.tick-movingStart>2);
  reload();check('bridge and pawn on it survive save/load');
  command({type:'draft',pawnId,drafted:false});
  command({type:'designate',tool:'remove',from:start,to:end});
  until('demolition restores the same shallow-water cells',()=>crossing.points.every(p=>!bridge(p))&&!s.jobs.some(j=>j.kind==='remove'));
  assert(crossing.points.every(p=>s.water[idx(p)-4096]===1&&s.blocks[idx(p)-4096]===0));
  assert.equal(s.stats.produced.wood-initialStats.produced.wood,9);reload();await checkpoint('demolished');
  // Native shallow water permits zones/loose goods. Verify actual logistics,
  // not just an accepted zone command or a UI label.
  command({type:'designate',tool:'stock',from:start});command({type:'storage',from:start,priority:3,accepts:['wood']});
  for(const p of s.pawns)command({type:'priority',pawnId:p.id,work:'haul',value:1});
  until('hauler places real remaining wood in shallow-water storage',()=>s.items.some(i=>same(i,start)&&i.resource==='wood'));
  reload();check('water storage and resource ledger survive reload');await checkpoint('final');
  report.status='passed';report.finalTick=s.tick;report.finalCounts=s.counts();report.stats=s.stats;
}catch(error){report.status='failed';report.error=error.stack;throw error;}finally{
  await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2)+'\n');
}
