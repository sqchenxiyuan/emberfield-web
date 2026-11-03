import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const out=process.env.VOXEL_ENVIRONMENT_OUT??'test-results/voxel-environment';
await fs.mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const bundle=await build({entryPoints:['src/voxel/world.ts'],bundle:true,platform:'node',format:'esm',write:false});
await fs.writeFile(`${out}/executed-world.mjs`,bundle.outputFiles[0].contents);
const {VoxelSimulation}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const point=p=>({x:p.x,y:p.y,z:p.z}),at=p=>(p.z*64+p.y)*64+p.x;
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z);
let s=new VoxelSimulation(73129,{hilliness:'flat',meanTemperature:24,latitude:0});
const initial=s.counts(),surface=[],reserved=new Set([...s.items,...s.stockpiles,...s.trees].map(at));
const report={version:28,status:'running',startedAt:new Date().toISOString(),
  scope:'Fresh colony, public settings and reproducible seed. Only public player commands, ordinary ticks and exact save/load mutate the colony. Planning reads terrain/routes/environment. No injected resources, HP, weather, filth, memory, needs, clocks or RNG. Bounded mechanism demonstration, not probability calibration.',
  execution:{bundleSha256:sha(bundle.outputFiles[0].contents),scriptSha256:sha(await fs.readFile(new URL(import.meta.url)))},
  baseline:{seed:s.seed,settings:s.settings,initial},checks:[],commands:[],observations:[],fixtures:{},browser:{}};
const check=(name,ok=true,detail={})=>{report.checks.push({name,tick:s.tick,ok:!!ok,detail});assert(ok,name+': '+JSON.stringify(detail));console.log('PASS',name,s.tick);};
function command(c){const r=s.command(c);report.commands.push({tick:s.tick,c,r});assert(r.ok,JSON.stringify({c,r}));return r;}
const place=(tool,from,extra={})=>command({type:'designate',tool,from:point(from),...extra});
const reachable=p=>s.standable(p)&&s.path(s.pawns[0],p)!==null;
function audit(){const counts=s.counts();for(const r of Object.keys(initial))assert.equal(counts[r]+s.stats.consumed[r]+s.stats.spoiled[r]+s.stats.destroyed[r]+s.trade.exported[r],initial[r]+s.stats.produced[r]+s.trade.imported[r],`${r} conservation at ${s.tick}`);assert(s.pawns.filter(p=>p.faction==='colony').every(p=>!p.dead&&!p.downed),'colonists remain alive and mobile');}
function step(){s.step();if(s.tick%400===0){audit();report.observations.push({tick:s.tick,weather:s.weather.kind,wetPawnIds:s.snapshot().environment.wetPawnIds,damaged:s.items.filter(i=>i.hitPoints!==undefined).map(i=>({id:i.id,resource:i.resource,hp:i.hitPoints})),filth:s.filth.length});}}
function until(name,done,limit=16000){const start=s.tick;while(!done()&&s.tick-start<limit)step();check(name,done(),{elapsed:s.tick-start,pawns:s.pawns.map(p=>({id:p.id,phase:p.phase,reason:p.reason,food:p.food,rest:p.rest})),jobs:s.jobs.map(j=>({kind:j.kind,reason:j.reason}))});}
async function save(name){audit();const bytes=JSON.stringify(s.save());await fs.writeFile(`${out}/${name}.json`,bytes);report.fixtures[name]={file:`${out}/${name}.json`,tick:s.tick,sha256:sha(bytes)};}
function site(tool,width=1,depth=1){for(const p of surface){const cells=[];for(let dx=0;dx<width;dx++)for(let dy=0;dy<depth;dy++)cells.push({...p,x:p.x+dx,y:p.y+dy});if(!cells.every(q=>reachable(q)&&!reserved.has(at(q))))continue;const c={type:'designate',tool,from:point(p),axis:'x'},r=s.command(c);if(!r.ok)continue;report.commands.push({tick:s.tick,c,r});cells.forEach(q=>reserved.add(at(q)));return p;}throw Error('No site '+tool);}
const itemAt=p=>s.items.find(i=>at(i)===at(p));
const envAt=p=>s.snapshot().environment.items.find(i=>i.entity==='stack'&&i.id===itemAt(p)?.id);
function store(p,priority){place('stock',p);command({type:'storage',from:point(p),accepts:['wood'],priority});}
function walk(id,target){command({type:'move',pawnId:id,target:point(target)});until('pawn walks to actual selected cell',()=>at(s.pawns.find(p=>p.id===id))===at(target),2500);}
try{
  command({type:'threats',enabled:false});command({type:'fireHazards',enabled:false});
  for(const p of s.pawns)for(const work of ['clean','hunt'])command({type:'priority',pawnId:p.id,work,value:0});
  for(let y=2;y<61;y++)for(let x=2;x<61;x++){let z=14;while(z>0&&!s.blocks[at({x,y,z})])z--;const p={x,y,z:z+1};if(s.standable(p))surface.push(p);}
  surface.sort((a,b)=>distance(a,s.spawn)-distance(b,s.spawn));
  await save('initial');
  const trees=s.trees.filter(t=>t.growth>=.8&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>reachable({...t,x:t.x+dx,y:t.y+dy}))).sort((a,b)=>distance(a,s.spawn)-distance(b,s.spawn));
  for(const t of trees.slice(0,12))place('cut',t);
  until('ordinary forestry supplies physical construction materials',()=>!s.jobs.some(j=>j.kind==='cut'));
  for(let i=0;i<3;i++)site('bed',2);
  until('three real beds support ordinary colony needs',()=>s.beds.length===3);
  const base=surface.find(p=>!reserved.has(at(p))&&reachable(p)&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>reachable({...p,x:p.x+dx,y:p.y+dy})&&!reserved.has(at({...p,x:p.x+dx,y:p.y+dy}))));assert(base);
  reserved.add(at(base));place('up',base);until('upper ladder constructed',()=>!s.jobs.some(j=>j.kind==='ladder'));
  // Build actual upper flooring via ladders. Existing solid ground is not a
  // replaceable floor in this prototype; no terrain edits bypass construction.
  const platform=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy){
    const p={x:base.x+dx,y:base.y+dy,z:base.z+3};place('floor',p);platform.push(p);
  }
  until('upper wooden platform completed with real materials',()=>!s.jobs.length);
  const second={x:base.x+1,y:base.y,z:base.z+3};place('up',second);
  until('second ladder gives real access to roof level',()=>!s.jobs.length);
  const covered={x:base.x+1,y:base.y+1,z:base.z+3},exposed={x:base.x-1,y:base.y+1,z:base.z+3};
  place('floor',{...covered,z:covered.z+3});until('open shed over part of the upper platform completed',()=>!s.jobs.length);
  check('roofed shed is still outdoors',!s.weatherExposed(covered)&&s.rooms.roomAt(covered)?.outdoor===true);
  store(covered,2);store(exposed,2);
  until('both outdoor stockpiles contain real hauled wood',()=>itemAt(covered)?.resource==='wood'&&itemAt(exposed)?.resource==='wood');
  for(const p of s.pawns)command({type:'priority',pawnId:p.id,work:'haul',value:0});
  const pawnId=s.pawns[0].id;command({type:'draft',pawnId,drafted:true});walk(pawnId,covered);walk(pawnId,exposed);
  check('normal dirty footsteps leave filth on exposed and covered flooring',s.filth.some(f=>at(f)===at(exposed))&&s.filth.some(f=>at(f)===at(covered)));
  const shelteredFilth=s.filth.filter(f=>at(f)===at(covered)).map(f=>({id:f.id,amount:f.amount}));
  until('ordinary rain wets a colonist and damages actual exposed wood',()=>s.snapshot().weather.effects.rainRate>.9&&s.pawns[0].psyche.memories.some(m=>m.kind==='wet')&&itemAt(exposed)?.hitPoints!==undefined,20000);
  const dirtSource=surface.find(p=>reachable(p)&&[1,8,9,10].includes(s.blocks[at({...p,z:p.z-1})]));assert(dirtSource);
  walk(pawnId,dirtSource);walk(pawnId,exposed);
  const washing=s.filth.find(f=>at(f)===at(exposed));assert(washing);
  report.browser={rainFixture:'rain',dryingFixture:'drying',protectedFixture:'protected',pawnId,exposedPos:point(exposed),roofedPos:point(covered),exposedItemId:itemAt(exposed).id,roofedItemId:itemAt(covered).id};
  report.browser.washingFilthId=washing.id;
  check('stockpile zoning does not prevent rainfall deterioration',envAt(exposed).rate>envAt(covered).rate&&envAt(covered).rate>0,{exposed:envAt(exposed),shed:envAt(covered)});
  await save('rain');walk(pawnId,covered);const memory=s.pawns[0].psyche.memories.find(m=>m.kind==='wet');assert(memory);
  check('shelter stops wet-memory refresh without immediately curing it',!s.snapshot().environment.wetPawnIds.includes(pawnId));
  await save('drying');const expires=memory.expires;s=VoxelSimulation.load(s.save());
  until('wet memory expires naturally while the pawn stays under the roof',()=>!s.pawns.find(p=>p.id===pawnId).psyche.memories.some(m=>m.kind==='wet'),1400);
  check('drying retained the original expiry through save/load',s.tick===expires);
  until('rain naturally washes exposed dirt',()=>!s.filth.some(f=>at(f)===at(exposed)),12000);
  check('sheltered filth retains its actual layers',shelteredFilth.every(f=>s.filth.some(g=>g.id===f.id&&g.amount===f.amount)));
  command({type:'draft',pawnId,drafted:false});
  for(const p of s.pawns)command({type:'priority',pawnId:p.id,work:'haul',value:1});
  const shaft=surface.find(p=>p.z>=4&&!reserved.has(at(p))&&reachable(p)&&[1,2,3].every(dx=>[-1,0,1].every(dy=>[p.z-3,p.z-2,p.z-1].every(z=>s.blocks[at({x:p.x+dx,y:p.y+dy,z})]>0))));assert(shaft);reserved.add(at(shaft));
  place('shaft',shaft);until('ordinary shaft reaches warehouse depth',()=>!s.jobs.some(j=>['ladder','digLadder'].includes(j.kind)));
  const doorway={x:shaft.x+1,y:shaft.y,z:shaft.z-3},inside={x:shaft.x+2,y:shaft.y,z:shaft.z-3};
  place('mine',doorway);until('warehouse doorway excavated',()=>!s.jobs.some(j=>j.kind==='mine'));
  place('mine',{...inside,y:inside.y-1},{to:{x:inside.x+1,y:inside.y+1,z:inside.z}});
  until('warehouse chamber excavated from real terrain',()=>!s.jobs.some(j=>j.kind==='mine'));
  place('door',doorway,{axis:'y'});until('physical door encloses the underground warehouse',()=>s.doors.some(d=>at(d)===at(doorway)));
  s.updateRooms();check('closed warehouse is an indoor room',s.rooms.roomAt(inside)?.outdoor===false&&!s.weatherExposed(inside));
  // Restrict outdoor stores through normal filters so the actual damaged batch
  // is relocated. No fresh replacement stack or metadata is injected.
  for(const p of [covered,exposed])command({type:'storage',from:point(p),accepts:[],priority:0});
  const indoor=[-1,0,1].flatMap(dy=>[0,1].map(dx=>({...inside,x:inside.x+dx,y:inside.y+dy}))).find(p=>!itemAt(p)&&reachable(p));assert(indoor,'warehouse has an empty cell among excavated chunks');
  const damaged=s.items.filter(i=>i.resource==='wood'&&i.hitPoints!==undefined).map(i=>({id:i.id,hp:i.hitPoints,amount:i.amount}));
  const source=s.items.find(i=>i.resource==='wood'&&i.hitPoints!==undefined);assert(source,'actual damaged wood still exists');
  for(const p of s.pawns)command({type:'priority',pawnId:p.id,work:'haul',value:0});
  command({type:'draft',pawnId,drafted:true});walk(pawnId,source);store(indoor,3);
  command({type:'priority',pawnId,work:'haul',value:1});command({type:'draft',pawnId,drafted:false});
  until('colonist picks up the actual damaged wood batch',()=>s.pawns.find(p=>p.id===pawnId).cargo?.resource==='wood');
  const cargo=structuredClone(s.pawns.find(p=>p.id===pawnId).cargo);assert(cargo.hitPoints!==undefined);
  until('colonist hauls damaged wood into the closed warehouse',()=>itemAt(indoor)?.resource==='wood');
  const stored=itemAt(indoor);const hp=stored.hitPoints??150;
  check('indoor storage has zero environment deterioration and preserves delivered HP',envAt(indoor).rate===0&&stored.hitPoints===cargo.hitPoints,{damagedBefore:damaged,cargo,stored,environment:envAt(indoor)});
  // Freeze hauling by a player work priority to observe a stable protected stack.
  for(const p of s.pawns)command({type:'priority',pawnId:p.id,work:'haul',value:0});
  Object.assign(report.browser,{indoorPos:point(indoor),indoorItemId:stored.id});
  await save('protected');s=VoxelSimulation.load(s.save());const end=s.tick+1500;
  until('protected stored batch survives continued ordinary weather and save/load',()=>s.tick>=end,1600);
  check('indoor HP stays constant',itemAt(indoor)?.id===stored.id&&(itemAt(indoor).hitPoints??150)===hp);
  await save('final');report.finalTick=s.tick;report.status='passed';
}catch(error){report.status='failed';report.error=String(error?.stack??error);process.exitCode=1;await fs.writeFile(`${out}/failed.json`,JSON.stringify(s.save()));console.error(report.error);}
finally{report.finishedAt=new Date().toISOString();await fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
