import { loadLegacyStart, LEGACY_START } from './voxel-legacy-start.mjs';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = process.env.VOXEL_CAMPAIGN_OUT ?? 'test-results/voxel-campaign';
await mkdir(OUT, { recursive: true });
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { VoxelSimulation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
let sim = await loadLegacyStart(VoxelSimulation, Number(process.env.VOXEL_CAMPAIGN_SEED ?? 73129));
const initial = sim.counts();
const report = {
  baseline: LEGACY_START,
  seed: sim.seed,
  scope: 'Headless rules campaign through public command/step/save/load APIs. No terrain editing, inventory injection, pawn teleportation, or renderer used as gameplay proof.',
  commands: [], checkpoints: [], transitions: [], cargoLayers: {}, visitedLayers: [], errors: [],
};
const visited = new Set(), previous = new Map();
const at = (x,y,z) => (z * 64 + y) * 64 + x;
const pos = (x,y,z) => ({x,y,z});
function audit() {
  const count = sim.counts();
  for (const r of Object.keys(initial)) assert.equal(count[r]+sim.stats.consumed[r]+sim.stats.spoiled[r],initial[r]+sim.stats.produced[r],`resource conservation: ${r} at ${sim.tick}`);
  for (const p of sim.pawns) {
    assert.ok(sim.standable(p),`pawn ${p.id} unsupported at ${sim.tick}`);
    visited.add(p.z);
    if (p.cargo) {
      const key=`${p.cargo.resource}@${p.z}`;
      report.cargoLayers[key]=(report.cargoLayers[key]??0)+1;
    }
    const before=previous.get(p.id);
    if (before && before.z!==p.z) report.transitions.push({tick:sim.tick,pawn:p.id,from:before,to:pos(p.x,p.y,p.z),cargo:p.cargo?{...p.cargo}:null});
    previous.set(p.id,pos(p.x,p.y,p.z));
  }
}
function command(c) {
  const result=sim.command(c);
  report.commands.push({tick:sim.tick,command:c,result});
  assert.ok(result.ok,JSON.stringify({c,result}));
  return result;
}
const designate=(tool,x,y,z,x2=x,y2=y)=>command({type:'designate',tool,from:pos(x,y,z),to:pos(x2,y2,z)});
function until(label,predicate,limit=8000) {
  const start=sim.tick;
  while(!predicate() && sim.tick-start<limit) {sim.step();audit();}
  assert.ok(predicate(),`${label} timed out at ${sim.tick}: ${JSON.stringify({jobs:sim.jobs,pawns:sim.pawns})}`);
  report.checkpoints.push({label,tick:sim.tick,elapsed:sim.tick-start,counts:sim.counts(),stored:sim.snapshot().stored,stats:structuredClone(sim.stats)});
  console.log('PASS',label,`tick=${sim.tick}`);
}

try {
  audit();
  designate('stock',28,32,8,31,36);
  designate('cut',27,29,8);
  until('a finite starting tree is cut and its wood physically hauled to surface storage',()=>sim.stats.cut===1&&sim.snapshot().stored.wood===initial.wood+27);

  designate('shaft',33,32,8);
  until('four connected ladder cells open a three-level descent',()=>[5,6,7,8].every(z=>sim.ladders[at(33,32,z)]===1)&&!sim.jobs.length);
  assert.ok(sim.path(pos(32,32,8),pos(33,32,5))?.length);
  assert.equal(sim.blocks[at(34,32,5)],3,'guaranteed underground steel vein');
  designate('mine',34,32,5);
  until('underground steel is excavated and hauled through the shaft to surface storage',()=>sim.blocks[at(34,32,5)]===0&&sim.stats.produced.steel>0&&sim.snapshot().stored.steel===sim.stats.produced.steel&&!sim.jobs.length);
  assert.ok(report.cargoLayers['steel@5']>0&&report.cargoLayers['steel@8']>0,'steel actually crosses layers while carried');

  designate('up',33,32,8);
  until('upper ladder connects surface to feet level 11',()=>[8,9,10,11].every(z=>sim.ladders[at(33,32,z)]===1)&&!sim.jobs.length);
  designate('floor',34,32,11,36,32);
  until('save during actual upper-floor material delivery or work',()=>sim.jobs.some(j=>j.kind==='floor'&&(Object.values(j.delivered).some(n=>n>0)||j.progress>0))||sim.pawns.some(p=>p.cargo?.resource==='wood'&&p.jobId!==null&&p.z>8));
  const saved=sim.save(), countsBefore=sim.counts();
  await writeFile(`${OUT}/mid-work.json`,JSON.stringify(saved));
  sim=VoxelSimulation.load(saved);
  assert.deepEqual(sim.counts(),countsBefore,'reload preserves loose, carried and delivered quantities');
  audit();
  until('loaded work completes a supported upper floor with physical material delivery',()=>[34,35,36].every(x=>sim.blocks[at(x,32,10)]===4)&&!sim.jobs.length);
  assert.ok(report.cargoLayers['wood@11']>0,'upper floor materials arrive on a pawn');

  const pawnId=sim.pawns[0].id;
  command({type:'move',pawnId,target:pos(34,32,5)});
  until('a colonist actually walks to the excavated underground cell',()=>sim.pawns[0].x===34&&sim.pawns[0].y===32&&sim.pawns[0].z===5);
  command({type:'move',pawnId,target:pos(35,32,11)});
  until('the same colonist walks from underground through surface to the upper floor',()=>sim.pawns[0].x===35&&sim.pawns[0].y===32&&sim.pawns[0].z===11);
  designate('stock',34,32,11);
  designate('wall',36,32,11);
  until('a supported upper wall occupies two actual voxel cells',()=>sim.blocks[at(36,32,11)]===4&&sim.blocks[at(36,32,12)]===4&&!sim.jobs.length);
  assert.equal(sim.standable(pos(36,32,11)),false);
  assert.ok([5,8,11].every(z=>visited.has(z)));
  report.visitedLayers=[...visited].sort((a,b)=>a-b);
  report.final={tick:sim.tick,counts:sim.counts(),stored:sim.snapshot().stored,stats:sim.stats,gridBytes:sim.blocks.byteLength+sim.ladders.byteLength};
  report.status='passed';
  await writeFile(`${OUT}/final.json`,JSON.stringify(sim.save()));
  console.log('PASS three-layer playable rules campaign',JSON.stringify(report.final));
} catch(error) {
  report.status='failed';report.errors.push(String(error.stack??error));
  await writeFile(`${OUT}/failed-state.json`,JSON.stringify(sim.save()));
  throw error;
} finally {
  await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2));
}
