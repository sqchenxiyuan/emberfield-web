import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const bundle = await build({entryPoints:['src/sim/world.ts'],bundle:true,platform:'node',format:'esm',write:false});
const { Simulation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const report = [];
for (const seed of [73129,12345]) {
  const s = new Simulation(seed);
  s.world.autoPause = false;
  s.world.nextRaid = 1200000;
  const animals = s.world.pawns.filter(p => p.animal);
  const states = new Map(animals.map(p => [p.id,{id:p.id,x:p.x,y:p.y,movingTicks:0,still:0,maxStill:0,trappedTicks:0}]));
  for (let i=0; i<18000; i++) {
    s.step();
    for (const p of animals) {
      const r = states.get(p.id);
      if (Math.hypot(p.x-r.x,p.y-r.y)>1e-6) { r.movingTicks++; r.still=0; } else r.still++;
      r.maxStill=Math.max(r.maxStill,r.still);
      if (p.reason.includes('没有可通行格')) r.trappedTicks++;
      r.x=p.x; r.y=p.y;
    }
  }
  const summary=[...states.values()], maxStill=Math.max(...summary.map(r=>r.maxStill));
  assert.equal(s.world.tick,18000);
  assert.ok(maxStill<=81,`${seed}: unexpected stationary interval ${maxStill}`);
  assert.ok(summary.every(r=>r.movingTicks>1000));
  report.push({seed,tick:s.world.tick,outcome:s.world.outcome,maxStill,summary});
  console.log(`PASS seed ${seed}: ${animals.length} animals, 18000 ticks, maximum stationary interval ${maxStill}`);
}
await mkdir('test-results/interactions',{recursive:true});
await writeFile('test-results/interactions/animal-motion-after.json',JSON.stringify(report,null,2));
