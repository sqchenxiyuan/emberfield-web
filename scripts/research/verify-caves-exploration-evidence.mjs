import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Record integrity and independent analytic examples. No native launch or Web imports.
const root=fileURLToPath(new URL('../../',import.meta.url));
const base=path.join(root,'docs/research/rimworld/evidence');
const local=process.argv.includes('--local');
const game=process.env.RIMWORLD_GAME_ROOT||'F:/SteamLibrary/steamapps/common/RimWorld';
const read=n=>JSON.parse(readFileSync(path.join(base,n),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const safe=p=>{const full=path.resolve(root,p),rel=path.relative(root,full);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));return full;};
const checked=new Set();
function verifyFile(p,sha){assert.match(sha,/^[a-f0-9]{64}$/);assert.equal(hash(readFileSync(p)),sha,p);checked.add(path.resolve(p));}
const e=read('caves-exploration-evidence.json');
assert.equal(e.schema_version,1);
assert.equal(e.evidence_id,'RW17-CAVES-EXPLORATION-AUDIT');
assert.equal(e.version_text,'1.7.4980 rev60');
assert.equal(e.source_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
assert.equal(e.engine_version,'11.2.0.10050');
assert.equal(e.engine_sha256,'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');
assert.deepEqual(e.manifests,['caves-exploration','caves-exploration-extra','generation','energy','housing','skills','work','stonecutting']);
const types=new Map(),used=new Map();
let newTypes=0;
for(const group of e.manifests){
 const m=read(`${group}-manifest.json`);
 assert.equal(m.source_sha256,e.source_sha256);assert.equal(m.version_text,e.version_text);assert.equal(m.engine_sha256,e.engine_sha256);
 for(const t of m.types){types.set(`${group}:${t.type}`,t);}
 if(e.new_groups.includes(group)){
  assert.deepEqual(m.types.map(t=>t.type),read(`${group}-types.json`));
  for(const t of m.types)used.set(t.local_file,t);
  newTypes+=m.types.length;
 }
}
assert.deepEqual(e.new_groups,['caves-exploration','caves-exploration-extra']);
assert.equal(newTypes,14);assert.equal(e.new_type_count,14);
assert.equal(e.dependencies.length,15);assert.equal(new Set(e.dependencies.map(d=>d.file)).size,15);
for(const d of e.dependencies)verifyFile(safe(d.file),d.sha256);
assert.deepEqual(e.claims.map(c=>c.id),Array.from({length:16},(_,i)=>`CE${String(i+1).padStart(2,'0')}`));
let pointers=0,priorReferences=0;
for(const c of e.claims){
 assert.ok(c.finding.length>70);assert.ok(Array.isArray(c.sources));
 assert.ok(c.sources.length>0||c.kind==='project-adaptation-guidance');
 for(const s of c.sources){
  const t=types.get(`${s.group}:${s.type}`);assert.ok(t,`${s.group}:${s.type}`);
  assert.equal(s.file,t.local_file);assert.equal(s.sha256,t.sha256);
  assert.ok(s.lines.length===2&&s.lines.every(Number.isInteger)&&s.lines[0]>0&&s.lines[0]<=s.lines[1]&&s.lines[1]<=t.lines);
  assert.match(s.excerpt_sha256,/^[a-f0-9]{64}$/);used.set(t.local_file,t);pointers++;
  if(local){const lines=readFileSync(safe(s.file),'utf8').split('\n');assert.equal(hash(lines.slice(s.lines[0]-1,s.lines[1]).join('\n')),s.excerpt_sha256,`${c.id}:${s.type}`);}
 }
 if(c.prior){assert.equal(c.prior.file,'generation-claims.json');const old=read(c.prior.file);for(const id of c.prior.ids){assert.equal(old.filter(x=>x.id===id).length,1);priorReferences++;}}
}
if(local){
 for(const t of used.values()){verifyFile(safe(t.local_file),t.sha256);assert.equal(readFileSync(safe(t.local_file),'utf8').split('\n').length,t.lines);}
 verifyFile(path.join(game,'Assembly-CSharp.dll'),e.source_sha256);
 verifyFile(path.resolve(root,'../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'),e.engine_sha256);
}
const p=e.parameters;
assert.deepEqual(p,{open_per_10000:5.8,closed_per_10000:2.5,max_open:3,max_closed:1,min_rock_cells:300,subgroup_fraction:0.05,default_branch_chance:0.1,ordinary_branch_chance:0.02,branch_after_cells:10,width_decay:0.034,min_width:1.4,branch_width_offset:[0.2,0.4],width_curve:[[100,2],[300,4],[3000,5.5]],open_candidates:10,closed_candidates:7,open_distance_cap:40,closed_distance_cap:30,continuous_step:0.5,branch_candidates:6,branch_min_depth:18,area_letter_threshold:600,mining_job_expiry:20000});
if(local){
 const code=(group,type)=>readFileSync(safe(types.get(`${group}:${type}`).local_file),'utf8');
 const cave=code('caves-exploration','RimWorld.MapGenCavesUtility');
 for(const s of ['openTunnelsPer10k = 5.8f','closedTunnelsPer10k = 2.5f','maxOpenTunnelsPerRockGroup = 3','maxClosedTunnelsPerRockGroup = 1','minRocksToGenerateAnyTunnel = 300','branchChance = 0.1f','Rand.RangeInclusive(1, a)','Rand.RangeInclusive(0, a)','GenMorphology.Open(group, 6, map)','0.05f * (float)group.Count','width / 2f + 1.5f','num >= 18'])assert.ok(cave.includes(s),s);
 const caller=code('generation','RimWorld.TileMutatorWorker_Caves');
 assert.ok(code('generation','Verse.GenMath').includes('return (int)f + ((Rand.Value < f % 1f) ? 1 : 0);'));
 for(const s of ['BranchChance => 0.02f','parms.branchChance = BranchChance','parms.allowBranchingAfterThisManyCells = 10','elevation[c] > 0.7f'])assert.ok(caller.includes(s),s);
 const flood=code('caves-exploration','Verse.FloodFillerFog');
 assert.match(flood,/int\.MaxValue/);assert.match(flood,/testMode && !expanding && numUnfogged > 500/);
 assert.doesNotMatch(flood,/\.Walkable\(|\.Standable\(/);
 assert.match(code('caves-exploration-extra','Verse.FloodFiller'),/GenAdj\.CardinalDirectionsAround/);
 assert.match(code('stonecutting','Verse.GenAdj'),/CardinalDirectionsAround = new IntVec3\[4\]/);
 assert.match(code('energy','Verse.ThingDef'),/MakeFog => Fillage == FillCategory\.Full/);
 const fog=code('caves-exploration','Verse.FogGrid');
 for(const s of ['LookBitArray(ref fogGrid, map.Area, "fogGrid")','DesignationDefOf.Mine','c.GetFirstMineable(map) == null','public void Refog(CellRect rect)','unfogResult.cellsUnfogged >= 600'])assert.ok(fog.includes(s),s);
 assert.match(code('housing','RimWorld.Building_Door'),/OpenPct >= 0\.4f && approachingPawn != null/);
 assert.match(code('caves-exploration','RimWorld.Designator_Mine'),/if \(c\.Fogged\(Map\)\)\s*\{\s*return true;/);
 assert.match(code('skills','RimWorld.GenConstruct'),/if \(center\.Fogged\(map\)\)\s*\{\s*return "CannotPlaceInUndiscovered"/);
 for(const [g,t]of [['caves-exploration-extra','RimWorld.MineAIUtility'],['caves-exploration','RimWorld.WorkGiver_Miner'],['work','RimWorld.WorkGiver_Scanner'],['work','RimWorld.JobGiver_Work']])assert.doesNotMatch(code(g,t),/Fogged|FogGrid|fogGrid/);
}

// Tiny explanatory model of selected 2D rules. No door, NPC, multi-cell or RNG code.
const cardinal=[[0,-1],[-1,0],[0,1],[1,0]];
const around=Array.from({length:9},(_,i)=>[i%3-1,Math.floor(i/3)-1]).filter(([x,y])=>x||y);
const key=([x,y])=>`${x},${y}`;
function graphCase(c){
 const grid=c.grid.map(r=>[...r]),height=grid.length,width=grid[0].length;
 assert.ok(grid.every(r=>r.length===width&&r.every(x=>'#.~'.includes(x))));
 const known=new Set(),markers=new Set(c.markers.map(key));
 const inside=([x,y])=>x>=0&&y>=0&&x<width&&y<height;
 const solid=([x,y])=>grid[y][x]==='#';
 const neighbors=(at,offsets)=>offsets.map(([dx,dy])=>[at[0]+dx,at[1]+dy]).filter(inside);
 function reveal(at){if(!known.has(key(at))){known.add(key(at));if(!solid(at))markers.delete(key(at));}}
 function flood(start){
  if(!inside(start)||solid(start)||known.has(key(start)))return;
  const queue=[start],seen=new Set([key(start)]),region=[];
  for(let i=0;i<queue.length;i++){
   const at=queue[i];region.push(at);reveal(at);
   for(const next of neighbors(at,cardinal))if(!solid(next)&&!known.has(key(next))&&!seen.has(key(next))){seen.add(key(next));queue.push(next);}
  }
  for(const at of region)for(const next of neighbors(at,around))if(solid(next))reveal(next);
 }
 function remove(at){
  assert.ok(inside(at)&&solid(at));grid[at[1]][at[0]]='.';
  if(!neighbors(at,around).some(q=>known.has(key(q))&&!solid(q)))return;
  reveal(at);
  for(const q of neighbors(at,cardinal))if(!known.has(key(q))){if(solid(q))reveal(q);else flood(q);}
  for(const q of neighbors(at,around))if(solid(q))reveal(q);
 }
 for(const a of c.actions){assert.ok(['flood','remove'].includes(a.op));(a.op==='flood'?flood:remove)(a.at);}
 assert.equal(known.size,c.expected_known,c.id);
 for(const q of c.known)assert.ok(known.has(key(q)),`${c.id}:known:${q}`);
 for(const q of c.hidden)assert.ok(!known.has(key(q)),`${c.id}:hidden:${q}`);
 assert.deepEqual([...markers].sort(),c.remaining_markers.toSorted(),c.id);
 // Bit payload round trip checks example encoding only, not native serialization.
 const bits=new Uint8Array(Math.ceil(width*height/8));
 for(const s of known){const [x,y]=s.split(',').map(Number),i=y*width+x;bits[i>>3]|=1<<(i&7);}
 const restored=new Set();
 for(let i=0;i<width*height;i++)if(bits[i>>3]&(1<<(i&7)))restored.add(key([i%width,Math.floor(i/width)]));
 assert.deepEqual([...restored].sort(),[...known].sort());
 return {id:c.id,known_cells:known.size,remaining_markers:markers.size};
}
assert.equal(e.graph_cases.length,6);assert.deepEqual(e.graph_cases.map(c=>c.id),['CG01','CG02','CG03','CG04','CG05','CG06']);
const graphs=e.graph_cases.map(graphCase);
assert.match(e.model_scope,/not executed game methods/);
assert.equal(e.count_cases.length,5);
for(const c of e.count_cases){
 const open=c.kind==='open';assert.ok(open||c.kind==='closed');
 const raw=c.n*c.factor*(open?p.open_per_10000:p.closed_per_10000)/10000;
 assert.ok(Math.abs(raw-c.expected_raw)<1e-12);
 const rounded=Math.floor(raw)+(c.round_fraction<raw-Math.floor(raw)?1:0),cap=Math.min(rounded,open?p.max_open:p.max_closed);
 assert.equal(cap,c.expected_cap);assert.ok(Number.isInteger(c.chosen_count));
 assert.ok(c.chosen_count>=(open&&cap>0?1:0)&&c.chosen_count<=cap);
}
assert.equal(e.memory_cases.length,2);
for(const c of e.memory_cases){const cells=c.dimensions.reduce((a,b)=>a*b,1);assert.equal(cells,c.cells);assert.equal(Math.ceil(cells/8),c.bit_payload_bytes);assert.equal(cells,c.byte_payload_bytes);}
assert.equal(e.runtime.new_native_runs,0);assert.equal(e.runtime.game_methods_executed,false);assert.equal(e.runtime.native_screenshots,0);assert.equal(e.runtime.new_save_samples,0);
assert.ok(e.limitations.length>=7);
let links=0;
const doc=path.join(base,'../108-caves-exploration-mechanisms.md'),markdown=readFileSync(doc,'utf8');
for(const [,target]of markdown.matchAll(/\]\(([^)]+)\)/g)){if(/^(https?:|#)/.test(target))continue;assert.ok(existsSync(path.resolve(path.dirname(doc),target.split('#')[0])),target);links++;}
for(const c of e.claims)assert.ok(markdown.includes(c.id),`Missing documented claim ${c.id}`);
console.log(JSON.stringify({ok:true,mode:local?'local-source-integrity-and-independent-examples':'portable-record-integrity-and-independent-examples',new_types:newTypes,claims:e.claims.length,source_pointers:pointers,selected_source_types:used.size,dependencies:e.dependencies.length,checked_file_hashes:checked.size,prior_claim_references:priorReferences,graph_cases:graphs,count_examples:e.count_cases.length,memory_payload_examples:e.memory_cases.length,local_links:links,new_native_runs:0,scope:e.model_scope},null,2));
