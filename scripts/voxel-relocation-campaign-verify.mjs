import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_RELOCATION_OUT ?? 'test-results/voxel-relocation';
await mkdir(OUT, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) files.push(file);
  }
  return files.sort();
}
const manifest = JSON.stringify(await Promise.all((await sourceFiles('src')).map(async file => ({ file, sha256: sha(await readFile(file)) }))), null, 2);
await writeFile(`${OUT}/source-manifest.json`, manifest);
const bundle = await build({ stdin: { contents: "export { VoxelSimulation } from './src/voxel/world'; export { furnitureStats } from './src/voxel/furniture'; export { furnitureMarketValue, colonyWealthDetails } from './src/voxel/wealth'; export { restGain } from './src/voxel/rest';", resolveDir: process.cwd(), sourcefile: 'relocation-campaign-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(`${OUT}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation, furnitureStats, furnitureMarketValue, colonyWealthDetails, restGain } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
let sim = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, rainfall: 1500, latitude: 0 });
const DAY = 12000, initial = sim.counts();
const point = p => ({ x: p.x, y: p.y, z: p.z }), key = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const colonists = () => sim.pawns.filter(p => p.faction === 'colony'), pawn = id => sim.pawns.find(p => p.id === id);
const objects = kind => sim[{ bed: 'beds', table: 'tables', chair: 'chairs' }[kind]];
const furnishing = () => ['bed', 'table', 'chair'].flatMap(kind => objects(kind).map(item => ({ kind, ...item })));
const inBed = (id, bedId) => { const p = pawn(id), b = sim.beds.find(b => b.id === bedId); return p.phase === 'rest' && p.sleepBedId === bedId && key(p) === key(b); };
const arrived = p => p.psyche.recreation?.kind === 'social' && !p.path.length && key(p) === key(p.psyche.recreation.target);
const report = { version: 34, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Fresh seed 73129; ordinary public commands and simulation ticks build timber, shaft, room, beds, table and chairs. Then real uninstall, packed storage, cross-layer carrying and reinstall of the same IDs; quality and HP preservation, construction-material and item conservation, cancellation, exact save/load, actual sleep and dining. Reads may inspect simulation state to select sites. No injected furniture, quality, damage, needs, skills, positions, clock or RNG. No old fixture is used.',
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await readFile(new URL(import.meta.url))), sourceManifestSha256: sha(manifest) },
  checks: [], commands: [], completions: [], observations: [], fixtures: {}, browser: {} };
const check = (name, detail = {}) => { report.checks.push({ name, tick: sim.tick, ...detail }); console.log('PASS', name, sim.tick); };
function command(c) { const r = sim.command(c); report.commands.push({ tick: sim.tick, c, r }); assert(r.ok, JSON.stringify({ c, r })); return r; }
const place = (tool, from, extra = {}) => command({ type: 'designate', tool, from: point(from), ...extra });
function audit() {
  const counts = sim.counts();
  for (const r of Object.keys(initial)) assert.equal(counts[r] + sim.stats.consumed[r] + sim.stats.spoiled[r] + sim.stats.destroyed[r] + sim.trade.exported[r], initial[r] + sim.stats.produced[r] + sim.trade.imported[r], `${r} ledger at ${sim.tick}`);
  assert(colonists().every(p => !p.dead && !p.downed), 'colonists remain alive and mobile');
  for (const item of furnishing()) assert(Number.isInteger(item.quality) && item.quality >= 0 && item.quality <= 6);
}
function step() {
  const before = sim.jobs.filter(j => ['bed', 'table', 'chair'].includes(j.kind)).map(j => ({ ...j, finisherBefore: j.owner === null ? null : structuredClone(pawn(j.owner)?.skills.construction) }));
  const known = new Set(furnishing().map(f => f.id)); sim.step();
  for (const item of furnishing().filter(f => !known.has(f.id) && !report.completions.some(c => c.itemId === f.id))) {
    const job = before.find(j => j.kind === item.kind && key(j) === key(item));
    assert(job && job.owner !== null, 'completed furniture has a real final worker');
    report.completions.push({ tick: sim.tick, jobId: job.id, kind: item.kind, itemId: item.id, quality: item.quality,
      workerId: job.owner, before: job.finisherBefore, after: structuredClone(pawn(job.owner).skills.construction),
      previousProgress: job.progress, work: job.work, delivered: job.delivered, stats: furnitureStats(item.kind, item.quality), value: furnitureMarketValue(item.kind, item.quality) });
  }
  if (sim.tick % 300 === 0) { audit(); report.observations.push({ tick: sim.tick, pawns: colonists().map(p => ({ id: p.id, reason: p.reason, rest: p.rest, food: p.food, comfort: p.living.comfort })) }); }
  if (sim.tick % 6000 === 0) console.log('TIME', sim.tick, colonists().map(p => p.reason).join(' / '));
}
function until(name, done, limit = DAY * 3) {
  const start = sim.tick; while (!done() && sim.tick - start < limit) step();
  assert(done(), `${name}: ${JSON.stringify({ tick: sim.tick, people: colonists().map(p => ({ id: p.id, reason: p.reason, food: p.food, rest: p.rest })), jobs: sim.jobs.map(j => ({ kind: j.kind, reason: j.reason })) })}`);
  audit(); check(name, { elapsedTicks: sim.tick - start });
}
async function save(name) {
  const data = sim.save(), raw = JSON.stringify(data), file = `${OUT}/${name}.json`;
  await writeFile(file, raw); report.fixtures[name] = { file, tick: data.tick, sha256: sha(raw) }; return data;
}
function reloadExact() {
  const before = sim.save(); sim = VoxelSimulation.load(before); const after = sim.save();
  for (const field of ['beds', 'tables', 'chairs', 'fireDamage', 'items', 'stats']) assert.deepEqual(after[field], before[field], field);
  const persistentJobs = jobs => jobs.map(({ owner, reason, ...job }) => job);
  assert.deepEqual(persistentJobs(after.jobs), persistentJobs(before.jobs), 'job targets progress and physical cargo persist while worker claims are recomputed');
  for (const field of ['living', 'psyche', 'cargo', 'skills']) assert.deepEqual(after.pawns.map(p => p[field]), before.pawns.map(p => p[field]), field);
  audit(); check('save and load preserve individual furniture quality settings and actual use');
}
const reserved = new Set();
function surfaceSite(tool, width = 1) {
  const sites = [];
  for (let y = 3; y < 61; y++) for (let x = 3; x < 61; x++) {
    let z = 14; while (z > 0 && !sim.blocks[key({ x, y, z })]) z--;
    const p = { x, y, z: z + 1 }; if (sim.standable(p)) sites.push(p);
  }
  sites.sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn));
  for (const p of sites) {
    const cells = Array.from({ length: width }, (_, i) => ({ ...p, x: p.x + i }));
    if (!cells.every(c => !reserved.has(key(c)) && sim.standable(c)) || sim.path(colonists()[0], p) === null) continue;
    const c = { type: 'designate', tool, from: p, axis: 'x' }, r = sim.command(c); if (!r.ok) continue;
    report.commands.push({ tick: sim.tick, c, r }); cells.forEach(c => reserved.add(key(c))); return p;
  }
  throw Error(`No surface site for ${tool}`);
}
function chooseBuilder(id) { for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'build', value: p.id === id ? 1 : 0 }); }
async function construct(kind, pos, axis, builderId) {
  chooseBuilder(builderId); const before = structuredClone(pawn(builderId).skills.construction); place(kind, pos, { axis });
  until(`selected builder completes actual ${kind}`, () => objects(kind).some(f => key(f) === key(pos)));
  const item = objects(kind).find(f => key(f) === key(pos)), receipt = report.completions.find(r => r.itemId === item.id);
  assert.equal(receipt.workerId, builderId); assert(pawn(builderId).skills.construction.xp > before.xp || pawn(builderId).skills.construction.level > before.level);
  check('actual finisher earns construction XP and fixes persisted quality', { ...receipt, skillAtDesignation: before }); return item;
}
try {
  await save('initial'); command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'hunt', value: 0 });
  for (const p of [...sim.items, ...sim.stockpiles, ...sim.trees]) reserved.add(key(p));
  for (let n = 0; sim.counts().wood < 300 && n < 32; n++) {
    const tree = sim.trees.filter(t => t.wood >= 8 && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => sim.path(colonists()[0], { ...t, x: t.x + dx, y: t.y + dy }) !== null)).sort((a, b) => distance(a, sim.spawn) - distance(b, sim.spawn))[0];
    assert(tree, 'reachable timber'); place('cut', tree); until('ordinary worker harvests construction timber', () => !sim.trees.some(t => t.id === tree.id));
  }
  assert(sim.counts().wood >= 300);
  for (let i = 0; i < 16; i++) { const cell = surfaceSite('stock'); command({ type: 'storage', from: cell, priority: 2, accepts: ['chunk'] }); }
  for (let i = 0; i < 8; i++) { const cell = surfaceSite('stock'); command({ type: 'storage', from: cell, priority: 2, accepts: ['wood', 'food', 'meal'] }); }
  let shaft;
  for (let dx = -5; dx <= 4 && !shaft; dx++) for (let dy = -5; dy <= 4 && !shaft; dy++) {
    const p = { x: sim.spawn.x + dx, y: sim.spawn.y + dy, z: sim.spawn.z }, z = p.z - 3;
    if (reserved.has(key(p)) || !sim.standable(p) || sim.path(colonists()[0], p) === null) continue;
    const solid = Array.from({ length: 6 }, (_, x) => Array.from({ length: 5 }, (_, y) => [z - 1, z, z + 1, z + 2].every(h => sim.blocks[key({ x: p.x + x + 1, y: p.y + y - 2, z: h })] > 0))).flat().every(Boolean);
    if (!solid) continue; const c = { type: 'designate', tool: 'shaft', from: p }, r = sim.command(c);
    if (r.ok) { shaft = p; report.commands.push({ tick: sim.tick, c, r }); reserved.add(key(p)); }
  }
  assert(shaft, 'solid supported underground room site');
  const entrance = { x: shaft.x + 1, y: shaft.y, z: shaft.z - 3 }, corner = { x: shaft.x + 2, y: shaft.y - 2, z: entrance.z }, far = { x: corner.x + 4, y: corner.y + 4, z: corner.z };
  until('normal workers excavate the shaft', () => !sim.jobs.some(j => ['digLadder', 'ladder'].includes(j.kind)));
  place('mine', entrance); until('normal workers open the doorway', () => !sim.jobs.some(j => j.kind === 'mine'));
  place('mine', corner, { to: far }); until('normal workers excavate the room', () => !sim.jobs.some(j => j.kind === 'mine'));
  place('door', entrance, { axis: 'y' }); until('door encloses the naturally roofed chamber', () => sim.doors.some(d => key(d) === key(entrance)));
  const room = sim.rooms.roomAt(corner); assert(room && !room.outdoor); report.browser.roomPos = corner;
  const roomBefore = sim.livingRooms().find(r => r.id === room.id), wealthBefore = colonyWealthDetails(sim), filthBefore = sim.filth.filter(f => sim.rooms.roomAt(f)?.id === room.id).length;
  await save('room-ready');
  const builders = colonists().slice().sort((a, b) => a.skills.construction.level - b.skills.construction.level), low = builders[0].id, high = builders.at(-1).id;
  const bedA = await construct('bed', { ...corner, y: corner.y + 3 }, 'y', low);
  const bedB = await construct('bed', { ...corner, x: corner.x + 2, y: corner.y + 3 }, 'y', high);
  await construct('bed', { ...corner, x: corner.x + 4, y: corner.y + 3 }, 'y', high);
  const tablePos = { ...corner, x: corner.x + 1, y: corner.y + 1 }, table = await construct('table', tablePos, 'x', high);
  for (const c of [{ ...tablePos, y: tablePos.y - 1 }, { ...tablePos, y: tablePos.y + 1 }, { ...tablePos, x: tablePos.x + 1, y: tablePos.y + 1 }]) await construct('chair', c, 'x', high);
  for (const [i, b] of sim.beds.entries()) command({ type: 'bedOwner', bedId: b.id, pawnId: colonists()[i].id });
  const qualities = furnishing().map(f => ({ kind: f.kind, id: f.id, quality: f.quality, stats: furnitureStats(f.kind, f.quality), value: furnitureMarketValue(f.kind, f.quality) }));
  Object.assign(report.browser, { qualities, bedAId: bedA.id, bedBId: bedB.id, tableId: table.id, tablePos, chairIds: sim.chairs.map(c => c.id), pawnIds: colonists().map(p => p.id) });

  report.browser.initialFurniture = furnishing().map(f => ({ ...f, hitPoints: furnitureStats(f.kind, f.quality).maxHitPoints }));
  const furnitureCells = (kind, p, axis = p.axis) => kind === 'chair' ? [point(p)] : [point(p), { ...point(p), x:p.x + Number(axis === 'x'), y:p.y + Number(axis === 'y') }];
  const containers = id => [...sim.items, ...sim.pawns.flatMap(p => p.cargo ? [p.cargo] : []), ...sim.jobs.flatMap(j => j.deliveredBatches)].filter(b => b.furniture?.id === id);
  const physical = id => furnishing().filter(f => f.id === id).length + containers(id).length;
  const preserved = (kind, id) => {
    const original = report.browser.initialFurniture.find(f => f.id === id), installed = objects(kind).find(f => f.id === id), packed = containers(id)[0]?.furniture;
    assert.equal(physical(id), 1, 'exactly one original furniture instance');
    assert.equal((installed ?? packed).quality, original.quality);
    const hp = packed?.hitPoints ?? sim.fireDamage.find(d => d.targetId === id && d.kind === kind)?.hitPoints ?? furnitureStats(kind, installed.quality).maxHitPoints;
    assert.equal(hp, original.hitPoints);
  };
  function moveSurface(kind, id, axis = 'x') {
    const sites = [];
    for (let y = 3; y < 61; y++) for (let x = 3; x < 61; x++) {
      let z = 14; while(z > 0 && !sim.blocks[key({x,y,z})]) z--;
      const p = {x,y,z:z+1};
      if (p.z > corner.z && furnitureCells(kind,p,axis).every(q => sim.standable(q) && !reserved.has(key(q))) && sim.path(colonists()[0],p) !== null) sites.push(p);
    }
    sites.sort((a,b) => distance(a,sim.spawn)-distance(b,sim.spawn));
    for (const target of sites) {
      const c={type:'installFurniture',kind,furnitureId:id,target,axis}, r=sim.command(c);
      report.commands.push({tick:sim.tick,c,r}); if(!r.ok) continue;
      furnitureCells(kind,target,axis).forEach(q => reserved.add(key(q))); return target;
    }
    throw Error('no valid surface installation site');
  }
  async function carryThenFinish(kind,id,target,fixtureName) {
    until('ordinary worker carries exact '+kind+' package', () => colonists().some(p => p.cargo?.furniture?.id === id));
    preserved(kind,id); assert(!objects(kind).some(f => f.id === id));
    report.browser[fixtureName+'Carrier'] = colonists().find(p => p.cargo?.furniture?.id === id).id;
    await save(fixtureName+'-carrying'); reloadExact();
    until('same '+kind+' is physically installed at destination', () => objects(kind).some(f => f.id === id && key(f) === key(target)));
    preserved(kind,id); assert(!sim.jobs.some(j => j.furnitureId === id));
    await save(fixtureName+'-installed');
  }
  const woodBefore=sim.counts().wood, consumedBefore=sim.stats.consumed.wood;
  await save('furnished'); reloadExact();
  command({type:'bedMedical',bedId:bedA.id,medical:true}); command({type:'bedPrisoner',bedId:bedA.id,prisoner:true});
  const bedTarget=moveSurface('bed',bedA.id,'x'); report.browser.bedTarget=bedTarget;
  await save('bed-planned');
  await carryThenFinish('bed',bedA.id,bedTarget,'bed');
  const movedBed=sim.beds.find(b => b.id === bedA.id);
  assert.equal(movedBed.axis,'x'); assert.equal(movedBed.medical,false); assert.equal(movedBed.prisoner,false);
  command({type:'bedPrisoner',bedId:bedB.id,prisoner:false});
  check('cross-layer rotated bed retains identity quality HP and resets medical/prisoner settings', {id:bedA.id,from:point(bedA),to:bedTarget});
  command({type:'tableGathering',tableId:table.id,enabled:false});
  const tableTarget=moveSurface('table',table.id,'y'); report.browser.tableTarget=tableTarget;
  await save('table-planned'); await carryThenFinish('table',table.id,tableTarget,'table');
  assert.equal(sim.tables.find(t=>t.id===table.id).gathering,false);
  check('cross-layer rotated table retains its gathering setting and exact quality', {id:table.id,to:tableTarget});
  const chairA=structuredClone(sim.chairs[0]); report.browser.chairId=chairA.id;
  const furnitureStorage=surfaceSite('stock'); command({type:'storage',from:furnitureStorage,priority:3,accepts:['furniture']});
  report.browser.furnitureStorage=furnitureStorage;
  command({type:'uninstallFurniture',kind:'chair',furnitureId:chairA.id});
  until('standalone uninstall creates a tangible packed chair',()=>sim.items.some(i=>i.furniture?.id===chairA.id));
  preserved('chair',chairA.id); await save('chair-packed');
  until('ordinary hauling stores the package across floors',()=>sim.items.some(i=>i.furniture?.id===chairA.id && key(i)===key(furnitureStorage)));
  preserved('chair',chairA.id); await save('chair-stored'); reloadExact();
  command({type:'installFurniture',kind:'chair',furnitureId:chairA.id,target:point(chairA),axis:'y'});
  await carryThenFinish('chair',chairA.id,chairA,'chair');
  assert.equal(sim.chairs.find(c=>c.id===chairA.id).axis,'y');
  check('standalone packed chair uses normal storage and returns through the shaft before reinstall', {id:chairA.id,storage:furnitureStorage,target:point(chairA)});
  const chairB=structuredClone(sim.chairs[1]); report.browser.cancelChairId=chairB.id;
  const cancelledTarget=moveSurface('chair',chairB.id,'x'); report.browser.cancelTarget=cancelledTarget;
  await save('cancel-planned');
  until('cancellation subject is physically carried',()=>colonists().some(p=>p.cargo?.furniture?.id===chairB.id));
  await save('cancel-carrying'); command({type:'cancelFurnitureMove',furnitureId:chairB.id});
  until('cancelled carried furniture returns safely to a ground container',()=>sim.items.some(i=>i.furniture?.id===chairB.id)&&!sim.jobs.some(j=>j.furnitureId===chairB.id));
  preserved('chair',chairB.id); assert(!sim.chairs.some(c=>c.id===chairB.id)); await save('cancelled'); reloadExact();
  check('cancellation preserves exactly one physical package without installing or duplicating it');
  const adjacent=[{...tableTarget,x:tableTarget.x-1},{...tableTarget,x:tableTarget.x+1},{...tableTarget,y:tableTarget.y-1},{...tableTarget,y:tableTarget.y+2}];
  let diningTarget;
  for(const target of adjacent){ const c={type:'installFurniture',kind:'chair',furnitureId:chairB.id,target,axis:'x'},r=sim.command(c); report.commands.push({tick:sim.tick,c,r});if(r.ok){diningTarget=target;break;} }
  assert(diningTarget); report.browser.diningTarget=diningTarget;
  until('cancelled chair can be installed beside the moved table',()=>sim.chairs.some(c=>c.id===chairB.id&&key(c)===key(diningTarget)));
  preserved('chair',chairB.id); assert.equal(sim.counts().wood,woodBefore); assert.equal(sim.stats.consumed.wood,consumedBefore);
  check('all moving storage and cancellation consume no additional timber', {woodBefore,woodAfter:sim.counts().wood,consumedBefore,consumedAfter:sim.stats.consumed.wood});
  await save('moved-furniture'); reloadExact();
  const sleeperId=colonists()[0].id; report.browser.sleeperId=sleeperId;
  until('ordinary activity lowers rest for the moved bed test',()=>pawn(sleeperId).rest<94);
  command({type:'bedOwner',bedId:bedA.id,pawnId:sleeperId}); command({type:'rest',pawnId:sleeperId});
  until('colonist actually sleeps at the moved bed position',()=>inBed(sleeperId,bedA.id));
  await save('moved-bed-sleep');
  const restBefore=pawn(sleeperId).rest, sleepStart=sim.tick;
  until('moved bed supplies actual quality-scaled sleep',()=>sim.tick>=sleepStart+30,100);
  assert(inBed(sleeperId,bedA.id)); assert(Math.abs(pawn(sleeperId).rest-restBefore-restGain(true,furnitureStats('bed',bedA.quality).restEffectiveness)*30)<1e-7);
  check('reinstalled bed is used at its destination with the preserved rest multiplier');
  until('a real meal is eaten at the reinstalled table and chair',()=>colonists().some(p=>p.living.mealTask?.stage==='chew'&&p.living.mealTask.tableId===table.id&&p.living.mealTask.chairId===chairB.id),DAY*4);
  const diner=colonists().find(p=>p.living.mealTask?.stage==='chew'&&p.living.mealTask.tableId===table.id&&p.living.mealTask.chairId===chairB.id);
  report.browser.dinerId=diner.id; report.browser.diningChairId=chairB.id; await save('moved-dining');
  assert.equal(key(diner),key(diningTarget)); check('reinstalled dining furniture participates in an actual meal');
  for(const f of report.browser.initialFurniture) preserved(f.kind,f.id);
  audit(); await save('final'); report.status='passed';
} catch(error) { report.status='failed'; report.error=String(error.stack??error); await save('failure'); process.exitCode=1; }
finally { report.finalTick=sim.tick; report.finishedAt=new Date().toISOString(); report.stats=sim.stats;
  await writeFile(OUT+'/report.json',JSON.stringify(report,null,2)); console.log(JSON.stringify({status:report.status,checks:report.checks.length,finalTick:sim.tick,output:OUT,error:report.error?.slice(0,1800)})); }
