import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const out = process.env.VOXEL_FIRE_OUT ?? 'test-results/voxel-fire';
await fs.mkdir(out, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
await fs.writeFile(`${out}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
const initial = s.counts(), point = p => ({ x: p.x, y: p.y, z: p.z });
const at = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z);
const report = { version: 26, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Fresh colony. Public commands, normal elapsed ticks and save/load only; read-only terrain/path queries plan finite ore access. No injected fire, damage, resources, needs, terrain, people, incident clocks or RNG. The fixed-seed incident demonstrates a gameplay loop, not probability calibration.',
  baseline: { seed: s.seed, settings: s.settings, initial }, checks: [], commands: [], observations: [], fixtures: {},
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await fs.readFile(new URL(import.meta.url))) } };
function audit() {
  const counts = s.counts();
  for (const resource of Object.keys(initial)) assert.equal(
    counts[resource] + s.stats.consumed[resource] + s.stats.spoiled[resource] + s.stats.destroyed[resource] + s.trade.exported[resource],
    initial[resource] + s.stats.produced[resource] + s.trade.imported[resource], `${resource} physical ledger at ${s.tick}`);
  assert(s.pawns.filter(p => p.faction === 'colony').every(p => !p.dead && !p.downed), 'Colony remains alive and mobile');
}
function command(c) { const r = s.command(c); report.commands.push({ tick: s.tick, c, r }); assert(r.ok, JSON.stringify({ c, r })); return r; }
function check(name, ok = true, detail = {}) { report.checks.push({ name, ok: !!ok, tick: s.tick, detail }); assert(ok, name + ': ' + JSON.stringify(detail)); console.log('PASS', name, s.tick); }
function step() {
  s.step();
  if (s.tick % 400 === 0) { audit(); report.observations.push({ tick: s.tick, fires: s.fires.length, damage: s.fireDamage.length,
    events: s.fireHazards.events.length, inventory: s.counts(), destroyed: { ...s.stats.destroyed },
    pawns: s.pawns.filter(p => p.faction === 'colony').map(p => ({ id: p.id, phase: p.phase, reason: p.reason, food: p.food, rest: p.rest })) }); }
}
function until(name, done, limit = 16000) {
  const start = s.tick;
  while (!done() && s.tick-start < limit) step();
  check(name, done(), { elapsed: s.tick-start, fires: s.fires, damage: s.fireDamage,
    pawns: s.pawns.map(p => ({ id:p.id, phase:p.phase, reason:p.reason, food:p.food, rest:p.rest })),
    jobs: s.jobs.map(j => ({ kind:j.kind, reason:j.reason })) });
}
async function save(name) {
  audit(); const bytes = JSON.stringify(s.save()); await fs.writeFile(`${out}/${name}.json`, bytes);
  report.fixtures[name] = { file: `${out}/${name}.json`, tick: s.tick, sha256: sha(bytes) };
}
const place = (tool, from, extra = {}) => command({ type:'designate', tool, from:point(from), ...extra });
const surface = [];
for (let y=2;y<61;y++) for (let x=2;x<61;x++) {
  let z=14; while(z>0 && !s.blocks[at({x,y,z})]) z--;
  const p={x,y,z:z+1}; if(s.standable(p)) surface.push(p);
}
surface.sort((a,b)=>distance(a,s.spawn)-distance(b,s.spawn));
const reserved = new Set([...s.items,...s.stockpiles,...s.trees].map(at));
const reachable = p => s.standable(p) && s.path(s.pawns[0],p)!==null;
function site(tool, width=1, depth=1) {
  for(const p of surface) {
    const cells=[];
    for(let dx=0;dx<width;dx++) for(let dy=0;dy<depth;dy++) cells.push({...p,x:p.x+dx,y:p.y+dy});
    if(!cells.every(q=>reachable(q)&&!reserved.has(at(q)))) continue;
    const c={type:'designate',tool,from:point(p),axis:'x'}, r=s.command(c);
    if(!r.ok) continue;
    report.commands.push({tick:s.tick,c,r}); cells.forEach(q=>reserved.add(at(q))); return p;
  }
  throw Error('No ordinary construction site: '+tool);
}
function mineResource(block, resource, target, shaft) {
  const z=shaft.z-3, ores=[];
  for(let y=3;y<61;y++) for(let x=3;x<61;x++) if([z,z+1].some(h=>s.blocks[at({x,y,z:h})]===block)) ores.push({x,y,z});
  ores.sort((a,b)=>distance(a,{...shaft,z})-distance(b,{...shaft,z}));
  for(const ore of ores) {
    if(s.counts()[resource]>=target) break;
    const line=[];
    for(let x=shaft.x;x!==ore.x;x+=Math.sign(ore.x-shaft.x)) line.push({x,y:shaft.y,z});
    for(let y=shaft.y;y!==ore.y;y+=Math.sign(ore.y-shaft.y)) line.push({x:ore.x,y,z});
    line.push(ore);
    for(const p of line) if(s.blocks[at(p)]||s.blocks[at({...p,z:z+1})]) place('mine',p);
    until('mine actual '+resource+' along an excavated corridor',()=>!s.jobs.some(j=>j.kind==='mine'));
  }
  check('finite ore supplied '+resource,s.counts()[resource]>=target,{amount:s.counts()[resource],target});
}
try {
  await save('initial'); command({type:'threats',enabled:false});
  for(const p of s.pawns) for(const work of ['firefight','clean','hunt']) command({type:'priority',pawnId:p.id,work,value:0});
  const trees=s.trees.filter(t=>t.growth>=.8 && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>reachable({...t,x:t.x+dx,y:t.y+dy})))
    .sort((a,b)=>distance(a,s.spawn)-distance(b,s.spawn));
  for(const t of trees.slice(0,10)) place('cut',t);
  until('ordinary forestry supplies beds and generator fuel',()=>!s.jobs.some(j=>j.kind==='cut'));
  for(let i=0;i<3;i++) site('bed',2);
  until('three beds are physically built',()=>s.beds.length===3);
  const generatorSite=site('generator',2,2);
  report.layout={generatorSite};
  // Mineral chunks each occupy a physical slot. Reserve actual storage before digging.
  for(const p of surface) {
    if(s.stockpiles.length>=100) break;
    if(reserved.has(at(p))||!reachable(p)) continue;
    place('stock',p); reserved.add(at(p));
  }
  const shaft=surface.find(p=>p.z>=4&&!reserved.has(at(p))&&reachable(p)); assert(shaft);
  reserved.add(at(shaft)); place('shaft',shaft); report.layout.shaft=point(shaft);
  until('miners excavate a real three-level shaft',()=>!s.jobs.some(j=>['ladder','digLadder'].includes(j.kind)));
  mineResource(3,'steel',100,shaft); mineResource(6,'components',2,shaft);
  until('generator is built and fueled with real delivered resources',()=>s.devices.some(d=>d.kind==='generator'&&d.watts>0));
  const generator=s.devices.find(d=>d.kind==='generator'); report.generatorId=generator.id;
  // The normal incident can damage this existing powered machine. Disable repair
  // work so its persistent damage can be inspected before choosing a worker.
  for(const p of s.pawns) command({type:'priority',pawnId:p.id,work:'build',value:0});
  await save('ready');
  until('normal incident calendar starts a real electrical fire',()=>s.fireHazards.events.some(e=>e.outcome==='ignited'&&e.source==='shortCircuit'),48000);
  const event=structuredClone(s.fireHazards.events.find(e=>e.outcome==='ignited'&&e.source==='shortCircuit'));
  report.incident=event; const fire=s.fires.find(f=>at(f)===at(event.position)); assert(fire); report.fireId=fire.id;
  command({type:'homeArea',from:point(fire),enabled:false});
  const firefighter=s.pawns.filter(p=>p.faction==='colony').sort((a,b)=>distance(a,fire)-distance(b,fire))[0]; report.firefighterId=firefighter.id;
  check('manual firefighting outside Home is rejected',!s.command({type:'firefight',pawnId:firefighter.id,fireId:fire.id}).ok);
  await save('fire-active');
  const hazards=structuredClone(s.fireHazards); s=VoxelSimulation.load(s.save());
  check('active fire and future calendar survive reload',s.fires.some(f=>f.id===fire.id)&&JSON.stringify(s.fireHazards)===JSON.stringify(hazards));
  command({type:'homeArea',from:point(fire),enabled:true});
  command({type:'firefight',pawnId:firefighter.id,fireId:fire.id});
  until('worker physically arrives and beats the actual flame',()=>s.pawns.find(p=>p.id===firefighter.id).firefightTask?.progress>0);
  await save('firefighting');
  const task=structuredClone(s.pawns.find(p=>p.id===firefighter.id).firefightTask); s=VoxelSimulation.load(s.save());
  check('beating progress persists',JSON.stringify(s.pawns.find(p=>p.id===firefighter.id).firefightTask)===JSON.stringify(task));
  until('beating reduces the fire to its last stage',()=>!s.fires.some(f=>f.id===fire.id)||s.fires.find(f=>f.id===fire.id).size<.33);
  await save('near-extinguished');
  until('actual fire is extinguished',()=>!s.fires.some(f=>f.id===fire.id));
  check('surviving structure retains actual fire damage',s.fireDamage.length>0,{damage:s.fireDamage});
  await save('fire-out');
  const damage=s.fireDamage[0]; report.damageKey=damage.key; report.damageBeforeRepair=structuredClone(damage);
  command({type:'homeArea',from:point(damage),enabled:true});
  const consumed=structuredClone(s.stats.consumed), destroyed=structuredClone(s.stats.destroyed);
  command({type:'repair',pawnId:firefighter.id,damageKey:damage.key});
  until('repairer arrives and works on surviving structure',()=>s.pawns.find(p=>p.id===firefighter.id).repairTask?.progress>0);
  await save('repairing');
  const repair=structuredClone(s.pawns.find(p=>p.id===firefighter.id).repairTask); s=VoxelSimulation.load(s.save());
  check('repair progress and damage survive reload',JSON.stringify(s.pawns.find(p=>p.id===firefighter.id).repairTask)===JSON.stringify(repair));
  until('ordinary repair reaches final hit points',()=>!s.fireDamage.some(d=>d.key===damage.key)||s.fireDamage.find(d=>d.key===damage.key).maxHitPoints-s.fireDamage.find(d=>d.key===damage.key).hitPoints<=2);
  // Needs can interrupt a forced job. Automatic construction is deliberately off;
  // after eating the player must assign repair again, keeping already restored HP.
  if(s.pawns.find(p=>p.id===firefighter.id).food<40 && s.fireDamage.some(d=>d.key===damage.key)) {
    until('ordinary hunger interrupts repair and real food is eaten',()=>{
      const p=s.pawns.find(p=>p.id===firefighter.id); return p.repairTask===null&&p.eating===null&&p.food>50;
    });
    check('interrupted repair keeps already restored durability',s.fireDamage.find(d=>d.key===damage.key).hitPoints>report.damageBeforeRepair.hitPoints);
    command({type:'repair',pawnId:firefighter.id,damageKey:damage.key});
    until('player resumes repair after the real meal',()=>s.pawns.find(p=>p.id===firefighter.id).repairTask?.progress>0);
  }
  await save('repair-near-complete');
  until('repair restores surviving structure to full health',()=>!s.fireDamage.some(d=>d.key===damage.key));
  check('repair consumes no additional construction materials',s.stats.consumed.steel===consumed.steel&&s.stats.consumed.components===consumed.components&&s.stats.destroyed.steel===destroyed.steel);
  check('generator remains operational',s.devices.some(d=>d.id===generator.id&&d.watts>0));
  await save('repaired');
  s=VoxelSimulation.load(s.save()); for(let i=0;i<100;i++) step();
  check('colony continues after save and repaired infrastructure',s.pawns.filter(p=>p.faction==='colony').every(p=>!p.dead&&!p.downed));
  await save('final'); report.status='passed';
} catch(error) {
  report.status='failed'; report.error=String(error.stack??error); process.exitCode=1;
  try { await save('failure'); } catch(saveError) { report.failureSaveError=String(saveError); }
} finally {
  report.finishedAt=new Date().toISOString(); report.finalTick=s.tick;
  await fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,tick:s.tick,error:report.error}));
}
