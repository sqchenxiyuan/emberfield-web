import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT=process.env.VOXEL_UNFINISHED_OUT??'test-results/voxel-unfinished-production-campaign';
const input='tests/fixtures/voxel-v40-working-before-unfinished.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(input),provenance=JSON.parse(await readFile(input.replace('.json','.provenance.json'),'utf8'));
assert.equal(sha(bytes),provenance.sha256);assert.equal(JSON.parse(bytes).version,40);
await mkdir(OUT,{recursive:true});
const bundle=await build({entryPoints:['src/voxel/world.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {VoxelSimulation}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let s=VoxelSimulation.load(JSON.parse(bytes));
const initial=s.counts(),initialStats=structuredClone(s.stats);
const report={status:'running',input,inputSha256:sha(bytes),inputVersion:40,inputTick:s.tick,scriptSha256:sha(await readFile(new URL(import.meta.url))),
  bundleSha256:sha(bundle.outputFiles[0].contents),scope:'Single continuous ordinary-command continuation of an unchanged SHA-verified authentic v40 save. Read-only snapshots, path and geometry inspection select targets; no terrain, inventory, skills, needs, timers, position or RNG mutation. All material ledgers audited on every command and simulation tick.',commands:[],checks:[],checkpoints:[]};
function audit(){const counts=s.counts();for(const r of Object.keys(counts))assert.equal(counts[r]+s.stats.consumed[r]-initialStats.consumed[r]+s.stats.destroyed[r]-initialStats.destroyed[r]+s.stats.spoiled[r]-initialStats.spoiled[r],initial[r]+s.stats.produced[r]-initialStats.produced[r],r);}
function command(c){const result=s.command(c);report.commands.push({tick:s.tick,command:c,result});assert(result.ok,JSON.stringify({c,result}));audit();}
function step(n){for(let i=0;i<n;i++){s.step();audit();}}
function check(name){report.checks.push({name,tick:s.tick});console.log('PASS',name,s.tick);}
function until(name,done,max=16000){for(let i=0;i<max&&!done();i++)step(1);assert(done(),JSON.stringify({name,jobs:s.jobs,pawns:s.pawns.map(p=>({id:p.id,reason:p.reason,cargo:p.cargo}))}));check(name);}
function cargo(){return s.items.find(i=>i.unfinished)??s.pawns.find(p=>p.cargo?.unfinished)?.cargo;}
const piece=()=>cargo()?.unfinished;
const bill=()=>s.snapshot().productionQueues.find(q=>q.benchId===report.benchId)?.bills.find(b=>b.id===report.billId);
async function save(name){const data=JSON.stringify(s.save()),path=`${OUT}/${name}.json`;await writeFile(path,data);report.checkpoints.push({name,path,sha256:sha(data),tick:s.tick});}
function reload(){const before=structuredClone(piece());s=VoxelSimulation.load(s.save());assert.deepEqual(piece(),before);audit();}
try{
  const job=s.jobs.find(j=>j.kind==='smith'&&j.progress>0);assert(job);report.billId=job.billId;
  report.benchId=s.weaponBenches.find(b=>b.x===job.x&&b.y===job.y&&b.z===job.z).id;
  report.creatorId=JSON.parse(bytes).jobs.find(j=>j.id===job.id).owner;
  // v40 did not store a permanent author. Its still-valid current owner is also
  // the continuing worker in this fixture; no historical author is fabricated.
  until('v40 physical inputs become one selectable independent unfinished item',()=>!!piece());
  report.unfinishedId=piece().id;report.creatorId=piece().creatorId;
  assert.equal(piece().ingredients.find(b=>b.resource==='wood').amount,40);
  await save('working');
  command({type:'productionBillUpdate',benchId:report.benchId,billId:report.billId,patch:{suspended:true}});
  const before=structuredClone(piece());step(40);assert.deepEqual(piece(),before);await save('paused');check('pause retains exact material ownership and work progress');
  const carrier=s.pawns.find(p=>p.id!==report.creatorId&&p.faction==='colony'&&!p.dead);assert(carrier);
  for(const p of s.pawns.filter(p=>p.faction==='colony')){
    command({type:'priority',pawnId:p.id,work:'craft',value:0});
    command({type:'priority',pawnId:p.id,work:'haul',value:p.id===carrier.id?1:0});
  }
  const home=s.stockpiles.find(q=>s.path(carrier,q)!==null);assert(home);
  let stock;
  for(let dx=-3;dx<=3&&!stock;dx++)for(let dy=-3;dy<=3&&!stock;dy++){
    const q={x:home.x+dx,y:home.y+dy,z:home.z};
    if([...s.items,...s.stockpiles,...s.trees,...s.crops,...s.beds,...s.stoves,...s.weaponBenches].some(i=>i.x===q.x&&i.y===q.y&&i.z===q.z)||s.path(carrier,q)===null)continue;
    const c={type:'designate',tool:'stock',from:q},result=s.command(c);
    report.commands.push({tick:s.tick,command:c,result});audit();
    if(result.ok)stock=s.stockpiles.find(i=>i.x===q.x&&i.y===q.y&&i.z===q.z);
  }
  assert(stock,'A reachable empty storage cell can be designated through ordinary commands');
  report.storage={x:stock.x,y:stock.y,z:stock.z};
  command({type:'storage',from:stock,priority:3,accepts:['unfinished']});
  until('another colonist physically hauls the paused item to storage',()=>s.items.some(i=>i.unfinished?.id===report.unfinishedId&&s.stockpiles.some(q=>q.x===i.x&&q.y===i.y&&q.z===i.z)));
  assert.deepEqual(piece(),before);await save('stored');reload();check('stored item survives save and load without material duplication');
  command({type:'productionBillDelete',benchId:report.benchId,billId:report.billId});assert.equal(piece().boundBillId,null);
  await save('orphan');reload();check('deleting a bill leaves its orphan item, author and progress intact');
  command({type:'unfinishedForbid',unfinishedId:report.unfinishedId,forbidden:true});step(20);assert.equal(piece().progress,before.progress);
  await save('forbidden');command({type:'unfinishedForbid',unfinishedId:report.unfinishedId,forbidden:false});check('forbid and allow preserve the independent item');
  command({type:'productionBillAdd',benchId:report.benchId,recipe:piece().recipe});
  report.newBillId=s.productionQueues.find(q=>q.benchId===report.benchId).bills.at(-1).id;
  const current=s.productionQueues.find(q=>q.benchId===report.benchId).bills.at(-1);
  command({type:'productionBillUpdate',benchId:report.benchId,billId:current.id,patch:{remaining:1,policy:{...current.policy,workerId:report.creatorId,ingredientRadius:3}}});
  command({type:'priority',pawnId:report.creatorId,work:'craft',value:1});
  until('original author fetches the stored item despite the new ingredient radius',()=>s.pawns.some(p=>p.id===report.creatorId&&p.cargo?.unfinished?.id===report.unfinishedId));
  await save('carried');reload();check('carried work-in-progress survives save and load');
  until('same item and progress resume under the new bill',()=>piece()?.progress>before.progress);
  assert.equal(piece().id,report.unfinishedId);await save('working-again');
  const made=s.stats.weaponsMade;
  until('one product commits and only its completing bill decrements',()=>s.stats.weaponsMade>made);
  assert.equal(piece(),undefined);assert.equal(s.productionQueues.find(q=>q.benchId===report.benchId).bills.find(b=>b.id===report.newBillId).remaining,0);
  assert.equal(s.stats.produced.unfinished-initialStats.produced.unfinished,1);
  assert.equal(s.stats.consumed.unfinished-initialStats.consumed.unfinished,1);
  reload();await save('final');check('all resource ledgers remain balanced after completion and reload');
  report.status='passed';report.finalTick=s.tick;report.successfulCommands=report.commands.filter(c=>c.result.ok).length;
}catch(error){report.status='failed';report.error=String(error?.stack??error);throw error;}
finally{await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2));}
