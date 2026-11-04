import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_PRODUCTION_OUT ?? 'test-results/voxel-production-bills-campaign';
const input = 'tests/fixtures/voxel-v38-before-production-bills.json';
await mkdir(OUT, { recursive: true });
const compiled = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { VoxelSimulation } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const bytes = await readFile(input), original = JSON.parse(bytes);
assert.equal(original.version, 38);
let s = VoxelSimulation.load(original);
const initial = s.counts(), ledger = structuredClone(s.stats);
const report = { status: 'running', input, inputVersion: 38, inputSha256: createHash('sha256').update(bytes).digest('hex'),
  scope: 'Continue an unchanged real v38 storage campaign. Public commands, normal simulation ticks and save/load only; no terrain/resources/worker/time injection. Resource conservation audited after each tick and command.',
  commands: [], checks: [], checkpoints: [] };
function audit() {
  const counts = s.counts();
  for (const r of Object.keys(initial)) assert.equal(counts[r] + s.stats.consumed[r] - ledger.consumed[r]
    + s.stats.spoiled[r] - ledger.spoiled[r] + s.stats.destroyed[r] - ledger.destroyed[r],
    initial[r] + s.stats.produced[r] - ledger.produced[r], r);
  const ids = s.snapshot().productionQueues.flatMap(q => q.bills.map(b => b.id));
  assert.equal(new Set(ids).size, ids.length);
}
function command(c) { const result = s.command(c); report.commands.push({ tick: s.tick, command: c, result }); assert(result.ok, JSON.stringify({ c, result })); audit(); return result; }
function check(name) { report.checks.push({ name, tick: s.tick }); console.log('PASS', name, s.tick); }
function until(name, done, limit = 12000) {
  for (let i = 0; i < limit && !done(); i++) { s.step(); audit(); }
  assert(done(), JSON.stringify({ name, tick: s.tick, jobs: s.jobs, pawns: s.pawns.map(p => [p.name,p.reason,p.cargo]) })); check(name);
}
async function save(name) {
  const path = `${OUT}/${name}.json`, content = JSON.stringify(s.save()); await writeFile(path, content);
  report.checkpoints.push({ name, path, tick: s.tick, sha256: createHash('sha256').update(content).digest('hex') });
}
function reload() { s = VoxelSimulation.load(s.save()); audit(); }
command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
for (const p of s.pawns.filter(p => p.faction === 'colony')) {
  command({ type: 'priority', pawnId: p.id, work: 'cut', value: 1 });
  command({ type: 'priority', pawnId: p.id, work: 'craft', value: 2 });
}
const trees = s.trees.filter(t => s.exploredAt(t) && t.growth >= .7)
  .sort((a,b) => Math.abs(a.x-s.spawn.x)+Math.abs(a.y-s.spawn.y)-Math.abs(b.x-s.spawn.x)-Math.abs(b.y-s.spawn.y));
for (const tree of trees.slice(0,8)) command({ type: 'designate', tool: 'cut', from: {x:tree.x,y:tree.y,z:tree.z} });
until('ordinary tree cutting supplies the production stock', () => s.counts().wood >= 200);
// A crafting spot is a normal free ground designation. Find a valid nearby site via public commands.
let built = false;
for (let radius=1; radius<=5 && !built; radius++) for (let dy=-radius;dy<=radius && !built;dy++) for(let dx=-radius;dx<=radius && !built;dx++) {
  const pos = {x:s.spawn.x+dx,y:s.spawn.y+dy,z:s.spawn.z};
  if (!s.standable(pos) || !s.exploredAt(pos) || s.items.some(i=>i.x===pos.x&&i.y===pos.y&&i.z===pos.z)) continue;
  const c = { type:'designate',tool:'craftingSpot',from:pos }, result=s.command(c);
  report.commands.push({tick:s.tick,command:c,result}); audit(); built=result.ok;
}
assert(built); until('crafting spot exists',()=>s.weaponBenches.some(b=>b.kind==='craftingSpot'));
const benchId=s.weaponBenches.find(b=>b.kind==='craftingSpot').id;report.benchId=benchId;
const queue=()=>s.snapshot().productionQueues.find(q=>q.benchId===benchId);
const update=(id,patch)=>command({type:'productionBillUpdate',benchId,billId:id,patch});
const add=recipe=>{command({type:'productionBillAdd',benchId,recipe});return queue().bills.at(-1).id;};
for(const b of queue().bills)command({type:'productionBillDelete',benchId,billId:b.id});
await save('ready');
const first=add('smith:woodClub');update(first,{remaining:2});
until('first bill delivers materials and starts real work',()=>s.jobs.some(j=>j.billId===first&&j.progress>0&&j.progress<j.work));
await save('mid-work');
const active=s.jobs.find(j=>j.billId===first), jobId=active.id;
const second=add('smith:woodClub');update(second,{suspended:true});
command({type:'productionBillMove',benchId,billId:second,direction:-1});
assert.equal(s.jobs.find(j=>j.billId===first).id,jobId);check('reordering preserves in-flight bill identity');
reload();assert.equal(queue().bills.find(b=>b.id===first).remaining,2);check('partial work and count survive reload');
update(first,{suspended:true});assert.equal(queue().bills.find(b=>b.id===first).remaining,2);
assert(!s.jobs.some(j=>j.billId===first&&!j.cancelled));check('manual suspension returns ingredients without counting output');
update(first,{suspended:false});
until('two successful real outputs exhaust only the first bill',()=>queue().bills.find(b=>b.id===first).remaining===0);
assert(queue().bills.some(b=>b.id===first));assert.equal(queue().bills.find(b=>b.id===second).remaining,1);
update(second,{mode:'forever',suspended:false});
const before=s.stats.weaponsMade;until('forever produces another batch',()=>s.stats.weaponsMade>before);
update(second,{suspended:true});
const count=s.counts().weapon;
update(second,{mode:'target',target:count,pauseWhenSatisfied:true,resumeBelow:Math.max(0,count-1),suspended:false});
assert(queue().bills.find(b=>b.id===second).waiting);reload();assert(queue().bills.find(b=>b.id===second).waiting);check('automatic stock waiting persists independently of manual suspension');
for(const b of queue().bills)command({type:'productionBillDelete',benchId,billId:b.id});
reload();s.step(40);audit();assert.equal(queue().bills.length,0);check('deleted empty queue stays empty after load and time');
await save('final');report.status='passed';report.finalTick=s.tick;report.final=s.counts();
await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2)+'\n');
