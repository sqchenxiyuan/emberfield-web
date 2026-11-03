import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const out = process.env.VOXEL_WEATHER_OUT ?? 'test-results/voxel-weather';
await fs.mkdir(out, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
await fs.writeFile(`${out}/executed-world.mjs`, bundle.outputFiles[0].contents);
const { VoxelSimulation } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const point = p => ({ x: p.x, y: p.y, z: p.z }), at = p => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z);
const report = { version: 27, status: 'running', startedAt: new Date().toISOString(),
  scope: 'Two fresh colonies with public world settings and selected reproducible seeds. Only public player commands, normal elapsed ticks and save/load mutate simulation. Terrain, paths and weather are planning observations. No injected weather, fires, snow, terrain, people, needs, resources, clocks or RNG. Seeds were selected for bounded warm rain and cold snow/melt examples, not occurrence statistics.',
  execution: { bundleSha256: sha(bundle.outputFiles[0].contents), scriptSha256: sha(await fs.readFile(new URL(import.meta.url))) },
  baselines: [], checks: [], commands: [], observations: [], fixtures: {}, browser: {} };
class Campaign {
  constructor(name,seed,settings) {
    this.name=name;this.s=new VoxelSimulation(seed,settings);this.initial=this.s.counts();this.surface=[];
    this.reserved=new Set([...this.s.items,...this.s.stockpiles,...this.s.trees].map(at));
    report.baselines.push({name,seed,settings:this.s.settings,initial:this.initial});
    for(let y=2;y<61;y++)for(let x=2;x<61;x++) {
      let z=14;while(z>0&&!this.s.blocks[at({x,y,z})])z--;
      const p={x,y,z:z+1};if(this.s.standable(p))this.surface.push(p);
    }
    this.surface.sort((a,b)=>distance(a,this.s.spawn)-distance(b,this.s.spawn));
  }
  check(name,ok=true,detail={}) { report.checks.push({name,campaign:this.name,tick:this.s.tick,ok:!!ok,detail});assert(ok,name+': '+JSON.stringify(detail));console.log('PASS',this.name,name,this.s.tick); }
  command(c) {const r=this.s.command(c);report.commands.push({campaign:this.name,tick:this.s.tick,c,r});assert(r.ok,JSON.stringify({c,r}));return r;}
  place(tool,from,extra={}){return this.command({type:'designate',tool,from:point(from),...extra});}
  reachable(p){return this.s.standable(p)&&this.s.path(this.s.pawns[0],p)!==null;}
  audit(){const counts=this.s.counts();for(const r of Object.keys(this.initial))assert.equal(counts[r]+this.s.stats.consumed[r]+this.s.stats.spoiled[r]+this.s.stats.destroyed[r]+this.s.trade.exported[r],this.initial[r]+this.s.stats.produced[r]+this.s.trade.imported[r],`${this.name} ${r} at ${this.s.tick}`);assert(this.s.pawns.filter(p=>p.faction==='colony').every(p=>!p.dead&&!p.downed),'colonists remain alive/mobile');}
  step(){this.s.step();if(this.s.tick%400===0){this.audit();report.observations.push({campaign:this.name,tick:this.s.tick,weather:this.s.weather.kind,effects:this.s.snapshot().weather.effects,snowCells:this.s.snow.length,maxSnow:this.s.snow.reduce((v,p)=>Math.max(v,p.depth),0),temperature:this.s.outdoorTemperature(),fires:this.s.fires.length});}}
  until(name,done,limit=16000){const start=this.s.tick;while(!done()&&this.s.tick-start<limit)this.step();if(!done())writeFileSync(`${out}/failed-${this.name}.json`,JSON.stringify(this.s.save()));this.check(name,done(),{elapsed:this.s.tick-start,weather:this.s.weather,pawns:this.s.pawns.map(p=>({id:p.id,phase:p.phase,reason:p.reason,food:p.food,rest:p.rest})),jobs:this.s.jobs.map(j=>({kind:j.kind,reason:j.reason}))});}
  async save(name){this.audit();const bytes=JSON.stringify(this.s.save());await fs.writeFile(`${out}/${name}.json`,bytes);report.fixtures[name]={file:`${out}/${name}.json`,tick:this.s.tick,campaign:this.name,sha256:sha(bytes)};}
  site(tool,width=1,depth=1){for(const p of this.surface){const cells=[];for(let dx=0;dx<width;dx++)for(let dy=0;dy<depth;dy++)cells.push({...p,x:p.x+dx,y:p.y+dy});if(!cells.every(q=>this.reachable(q)&&!this.reserved.has(at(q))))continue;const c={type:'designate',tool,from:point(p),axis:'x'},r=this.s.command(c);if(!r.ok)continue;report.commands.push({campaign:this.name,tick:this.s.tick,c,r});cells.forEach(q=>this.reserved.add(at(q)));return p;}throw Error('No ordinary site '+tool);}
  basics(){
    this.command({type:'threats',enabled:false});
    for(const p of this.s.pawns)for(const work of ['firefight','clean','hunt'])this.command({type:'priority',pawnId:p.id,work,value:0});
    const trees=this.s.trees.filter(t=>t.growth>=.8&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>this.reachable({...t,x:t.x+dx,y:t.y+dy}))).sort((a,b)=>distance(a,this.s.spawn)-distance(b,this.s.spawn));
    for(const t of trees.slice(0,10))this.place('cut',t);
    this.until('ordinary forestry supplies physical construction wood',()=>!this.s.jobs.some(j=>j.kind==='cut'));
    for(let i=0;i<3;i++)this.site('bed',2);
    this.until('three beds built by real material delivery',()=>this.s.beds.length===3);
  }
  roof(){
    const base=this.surface.find(p=>p.z+3<15&&!this.reserved.has(at(p))&&this.reachable(p)&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{const q={...p,x:p.x+dx,y:p.y+dy};return this.reachable(q)&&!this.reserved.has(at(q));}));assert(base);
    this.reserved.add(at(base));this.place('up',base);
    this.until('actual upward ladder reaches upper floor',()=>!this.s.jobs.some(j=>j.kind==='ladder'));
    const below=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({...base,x:base.x+dx,y:base.y+dy})).find(p=>this.reachable(p)&&!this.reserved.has(at(p)));assert(below);
    this.reserved.add(at(below));const top={...below,z:base.z+3};this.place('floor',top);
    this.until('upper floor physically shelters the open-sided ground below',()=>this.s.blocks[at({...top,z:top.z-1})]===4);
    this.check('roof exposure differs from outdoor room membership',!this.s.weatherExposed(below)&&this.s.rooms.roomAt(below)?.outdoor===true,{below,top});
    return {below,top,base};
  }
  mine(block,resource,target,shaft){
    const z=shaft.z-3,ores=[];for(let y=3;y<61;y++)for(let x=3;x<61;x++)if([z,z+1].some(h=>this.s.blocks[at({x,y,z:h})]===block))ores.push({x,y,z});
    ores.sort((a,b)=>distance(a,{...shaft,z})-distance(b,{...shaft,z}));
    for(const ore of ores){
      if(this.s.counts()[resource]>=target)break;
      const line=[];
      for(let x=shaft.x;x!==ore.x;x+=Math.sign(ore.x-shaft.x))line.push({x,y:shaft.y,z});
      for(let y=shaft.y;y!==ore.y;y+=Math.sign(ore.y-shaft.y))line.push({x:ore.x,y,z});
      line.push(ore);
      for(const p of line)if(this.s.blocks[at(p)]||this.s.blocks[at({...p,z:p.z+1})]){
        // Mining removes foot/head solids. Cancel storage designations whose
        // support is excavated, using the normal player command; retain goods.
        for(const stock of [...this.s.stockpiles])if(stock.x===p.x&&stock.y===p.y&&(stock.z===z+1||stock.z===z+2))this.place('clearZone',stock);
        this.place('mine',p);
      }
      this.until('finite ore mined through real corridor',()=>!this.s.jobs.some(j=>j.kind==='mine'));
    }
    this.check('actual mineral supplied '+resource,this.s.counts()[resource]>=target,{amount:this.s.counts()[resource]});
  }
}
try {
  const warm=new Campaign('warm',73129,{hilliness:'flat',meanTemperature:24,latitude:0});
  await warm.save('warm-initial');warm.basics();const roof=warm.roof();
  warm.site('generator',2,2);
  for(const p of warm.surface){if(warm.s.stockpiles.length>=100)break;if(warm.reserved.has(at(p))||!warm.reachable(p))continue;warm.place('stock',p);warm.reserved.add(at(p));}
  const shaft=warm.surface.find(p=>p.z>=4&&!warm.reserved.has(at(p))&&warm.reachable(p));assert(shaft);warm.place('shaft',shaft);
  warm.until('three-level mineral shaft excavated',()=>!warm.s.jobs.some(j=>['ladder','digLadder'].includes(j.kind)));
  warm.mine(3,'steel',100,shaft);await warm.save('warm-mined-steel');warm.mine(6,'components',2,shaft);
  warm.until('generator constructed and fueled with actual materials',()=>warm.s.devices.some(d=>d.kind==='generator'&&d.watts>0));
  for(const p of warm.s.pawns)warm.command({type:'priority',pawnId:p.id,work:'build',value:0});
  warm.until('normal electrical incident ignites during naturally occurring precipitation',()=>warm.s.fireHazards.events.some(e=>e.outcome==='ignited'),48000);
  const fire=warm.s.fires[0];assert(fire);
  warm.check('incident is exposed to actual rain',warm.s.weatherExposed(fire)&&warm.s.snapshot().weather.effects.rainRate>.9,{fire,effects:warm.s.snapshot().weather.effects});
  Object.assign(report.browser,{rainFixture:'rain',snowFixture:'snow',retainedSnowFixture:'snow-retained',exposedPos:point(fire),roofedPos:roof.below,fireId:fire.id});
  await warm.save('rain');const weatherBefore=JSON.stringify(warm.s.weather),fireBefore=JSON.stringify(warm.s.fires);
  warm.s=VoxelSimulation.load(warm.s.save());warm.check('rain calendar and live fire survive exact save/load',JSON.stringify(warm.s.weather)===weatherBefore&&JSON.stringify(warm.s.fires)===fireBefore);
  const woodBefore=warm.s.stats.destroyed.wood;
  warm.until('precipitation extinguishes fire without a firefighter',()=>!warm.s.fires.some(f=>f.id===fire.id),1000);
  warm.check('rain extinction logged while physical damage is retained',warm.s.fireLog.some(e=>e.type==='extinguished'&&e.message.includes('降'))&&warm.s.fireDamage.length>0&&warm.s.stats.destroyed.wood>=woodBefore,{damage:warm.s.fireDamage});
  warm.check('automatic firefighting was disabled throughout',warm.s.pawns.every(p=>p.priorities.firefight===0&&!p.firefightTask));await warm.save('rain-out');
  report.warmFinalTick=warm.s.tick;

  const cold=new Campaign('cold',21,{biome:'boreal',hilliness:'flat',meanTemperature:3,rainfall:1100,latitude:0});
  await cold.save('cold-initial');cold.command({type:'fireHazards',enabled:false});cold.basics();const coldRoof=cold.roof();
  cold.until('natural cold precipitation builds a real traversable snow layer',()=>cold.s.snow.some(p=>p.depth>=.27&&cold.reachable(p)&&!cold.s.ladders[at(p)]),22000);
  const snowy=cold.s.snow.filter(p=>p.depth>=.27&&cold.reachable(p)&&!cold.s.ladders[at(p)]).sort((a,b)=>distance(a,cold.s.spawn)-distance(b,cold.s.spawn))[0];assert(snowy);
  cold.check('new snow accumulates above the constructed roof and not underneath',cold.s.snow.some(p=>at(p)===at(coldRoof.top))&&!cold.s.snow.some(p=>at(p)===at(coldRoof.below)),coldRoof);
  const pawn=cold.s.pawns.filter(p=>p.faction==='colony'&&!p.downed).sort((a,b)=>distance(a,snowy)-distance(b,snowy))[0];assert(pawn);
  cold.command({type:'draft',pawnId:pawn.id,drafted:true});
  const destination=cold.surface.find(p=>at(p)!==at(pawn)&&distance(p,pawn)>=3&&distance(p,pawn)<=8&&cold.s.path(pawn,p)!==null&&cold.s.snow.some(c=>at(c)===at(p)&&c.depth>=.25));assert(destination);
  cold.command({type:'move',pawnId:pawn.id,target:point(destination)});
  Object.assign(report.browser,{snowExposedPos:point(snowy),snowRoofedPos:coldRoof.below,movement:{pawnId:pawn.id,destination:point(destination)}});
  await cold.save('snow');const before=JSON.stringify(cold.s.snow),state=JSON.stringify(cold.s.weather),origin=point(pawn);
  cold.s=VoxelSimulation.load(cold.s.save());cold.check('real snow and weather survive save/load',JSON.stringify(cold.s.snow)===before&&JSON.stringify(cold.s.weather)===state);
  cold.until('drafted pawn actually walks over existing snow',()=>at(cold.s.pawns.find(p=>p.id===pawn.id))===at(destination),2000);
  cold.check('movement changes real position while preserving the snow surface',at(origin)!==at(destination)&&cold.s.snow.some(p=>at(p)===at(destination)&&p.depth>=.25));
  cold.command({type:'draft',pawnId:pawn.id,drafted:false});
  cold.until('precipitation stops being snow while existing snow remains',()=>cold.s.snapshot().weather.effects.snowRate===0&&cold.s.snow.length>0,10000);
  await cold.save('snow-retained');const depth=cold.s.snow.find(p=>at(p)===at(snowy))?.depth??0;assert(depth>0);
  cold.until('warmer local air melts a measurable amount of retained snow',()=>((cold.s.snow.find(p=>at(p)===at(snowy))?.depth??0)<depth-.025)&&cold.s.outdoorTemperature()>0,10000);
  cold.check('melt uses local temperature rather than clearing all snow on weather change',cold.s.snow.length>0,{before:depth,after:cold.s.snow.find(p=>at(p)===at(snowy))?.depth??0,temp:cold.s.outdoorTemperature()});
  await cold.save('snow-melted');const final=cold.s.save();cold.s=VoxelSimulation.load(final);cold.s.step(100);cold.audit();await cold.save('cold-final');report.coldFinalTick=cold.s.tick;
  report.status='passed';
} catch(error){report.status='failed';report.error=String(error?.stack??error);process.exitCode=1;console.error(report.error);}
finally {report.finishedAt=new Date().toISOString();await fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
