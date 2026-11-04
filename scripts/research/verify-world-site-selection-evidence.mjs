import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyBiomesEvidence} from './verify-biomes-evidence.mjs';
import {verifyNativeBiomesRuntime} from './verify-biomes-runtime.mjs';

// Index and retained-source verification. No game launch or input replay.
const root=fileURLToPath(new URL('../../',import.meta.url));
const base=path.join(root,'docs/research/rimworld/evidence');
const local=process.argv.includes('--local');
const game=process.env.RIMWORLD_GAME_ROOT||'F:/SteamLibrary/steamapps/common/RimWorld';
const read=n=>JSON.parse(readFileSync(path.join(base,n),'utf8'));
const safe=p=>{const full=path.resolve(root,p),r=path.relative(root,full);assert.ok(r&&!r.startsWith('..')&&!path.isAbsolute(r));return full;};
const hash=b=>createHash('sha256').update(b).digest('hex');
const checked=new Set();
function verifyFile(p,expected){assert.match(expected,/^[a-f0-9]{64}$/);assert.equal(hash(readFileSync(p)),expected,p);checked.add(path.resolve(p));}
const e=read('world-site-selection-evidence.json'),m=read('world-site-selection-manifest.json');
assert.equal(e.schema_version,1);assert.equal(e.evidence_id,'RW17-WORLD-SITE-SELECTION');assert.equal(e.version_text,'1.7.4980 rev60');
assert.equal(e.source_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
const types=new Map();
for(const group of e.manifests){const manifest=read(`${group}-manifest.json`);assert.equal(manifest.source_sha256,e.source_sha256);assert.equal(manifest.version_text,e.version_text);assert.equal(manifest.engine_sha256,'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');for(const t of manifest.types)types.set(`${group}:${t.type}`,t);}
assert.equal(m.types.length,6);assert.deepEqual(m.types.map(t=>t.type),read('world-site-selection-types.json'));
assert.equal(e.dependencies.length,16);assert.equal(new Set(e.dependencies.map(d=>d.file)).size,16);
for(const d of e.dependencies)verifyFile(safe(d.file),d.sha256);
assert.deepEqual(e.claims.map(c=>c.id),Array.from({length:9},(_,i)=>`WS${String(i+1).padStart(2,'0')}`));
let pointers=0,legacyClaims=0;const used=new Map();
for(const c of e.claims){
 assert.ok(c.finding.length>50);assert.ok(Array.isArray(c.sources)&&Array.isArray(c.prior));
 for(const s of c.sources){const t=types.get(`${s.group}:${s.type}`);assert.ok(t);assert.equal(s.file,t.local_file);assert.equal(s.sha256,t.sha256);assert.ok(s.lines.length===2&&s.lines.every(Number.isInteger)&&s.lines[0]>0&&s.lines[0]<=s.lines[1]&&s.lines[1]<=t.lines);used.set(t.local_file,t);pointers++;}
 for(const p of c.prior){assert.ok(['generation-claims.json','biomes-claims.json'].includes(p.file));const old=read(p.file);for(const id of p.ids){const matches=old.filter(q=>q.id===id);assert.equal(matches.length,1);legacyClaims++;for(const s of matches[0].sources){if(!s.type)continue;const group=s.group??p.file.split('-')[0],t=types.get(`${group}:${s.type}`)??read(`${group}-manifest.json`).types.find(t=>t.type===s.type);assert.ok(t);assert.ok(s.line_start>0&&s.line_start<=s.line_end&&s.line_end<=t.lines);used.set(t.local_file,t);}}}
}
for(const t of m.types)used.set(t.local_file,t);
if(local)for(const t of used.values()){verifyFile(safe(t.local_file),t.sha256);assert.equal(readFileSync(safe(t.local_file),'utf8').split('\n').length,t.lines);}
assert.equal(e.xml.length,1);const water=e.xml[0];assert.equal(water.id,'WSX01');assert.equal(water.file,'Data/Core/Defs/BiomeDefs/Biomes_Water.xml');assert.equal(water.nodes.length,2);
for(const [i,n] of water.nodes.entries()){assert.ok(n.includes(`<defName>${['Ocean','Lake'][i]}</defName>`));assert.ok(n.includes('<canBuildBase>false</canBuildBase>'));assert.ok(n.includes('<isWaterBiome>true</isWaterBiome>'));assert.doesNotMatch(n,/ParentName=/);}
// BigInt with explicit signed32 wrapping is independent of the project's region hash.
const i32=n=>BigInt.asIntN(32,n);
function stable(s){if(s===null)return 0n;let n=23n;for(let i=0;i<s.length;i++)n=i32(n*31n+BigInt(s.charCodeAt(i)));return n;}
function combine(seed,value){return i32(seed^(value+2654435769n+i32(seed<<6n)+(seed>>2n)));}
assert.equal(e.arithmetic_cases.length,5);
assert.deepEqual(e.arithmetic_cases.map(c=>c.id),['WSH01','WSH02','WSH03','WSH04','WSH05']);
for(const c of e.arithmetic_cases){const seed=stable(c.seed_string),tile=i32(i32(BigInt(c.tile_id)*397n)^BigInt(c.layer_id<0||c.root_surface?0:c.layer_id));assert.equal(Number(seed),c.world_seed);assert.equal(Number(tile),c.tile_hash);assert.equal(Number(combine(seed,tile)),c.map_seed);}
assert.equal(stable(null),0n);assert.equal(stable(''),23n);
assert.equal(e.arithmetic_cases[0].map_seed,e.arithmetic_cases[3].map_seed);assert.notEqual(e.arithmetic_cases[0].map_seed,e.arithmetic_cases[2].map_seed);
assert.match(e.arithmetic_scope,/not executed game methods/);
const reused=e.runtime_reuse;assert.equal(reused.file,'native-biomes-runtime.json');assert.deepEqual(reused.tile_ids,[282619,99363,111646,118124,176455]);
for(const k of ['new_native_run','new_world_generation','starting_site_confirmation','local_map_generated','same_seed_equivalence'])assert.equal(reused[k],false);
assert.equal(reused.prior_unintended_advanced_ticks,83122);
assert.deepEqual(e.web_scope.region_dimensions,[48,24]);assert.deepEqual(e.web_scope.local_dimensions,[64,64,16]);assert.deepEqual(e.web_scope.supported_biomes,['temperate','boreal','desert']);assert.deepEqual(e.web_scope.identity_fields,['version','worldSeed','tileId']);assert.equal(e.web_scope.rule_version,1);
const oldStatic=verifyBiomesEvidence({root,local});const oldRuntime=verifyNativeBiomesRuntime({root,local});
assert.equal(oldStatic.status,'pass');assert.equal(oldRuntime.ok,true);assert.equal(oldRuntime.seedEquivalenceDemonstrated,false);
let nativeXmlProjections=0;
if(local){
 verifyFile(path.join(game,'Assembly-CSharp.dll'),e.source_sha256);verifyFile(path.resolve(root,'../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'),m.engine_sha256);verifyFile(path.join(game,water.file),water.source_sha256);
 const code=(group,type)=>readFileSync(safe(types.get(`${group}:${type}`).local_file),'utf8');
 assert.match(code('world-site-selection','RimWorld.Planet.PlanetTile'),/\(tileId \* 397\) \^ \(\(!flag\) \? layerId : 0\)/);
 assert.match(code('world-site-selection','Verse.GenText'),/num = num \* 31 \+ str\[i\]/);
 assert.match(code('world-site-selection','Verse.Gen'),/seed \^ \(value \+ 2654435769u \+ \(seed << 6\) \+ \(seed >> 2\)\)/);
 assert.match(code('generation','Verse.MapGenerator'),/Gen\.HashCombineInt\(Find\.World\.info\.Seed, parent\?\.Tile\.GetHashCode\(\) \?\? 0\)/);
 const quote=v=>`'${v.replaceAll("'","''")}'`;
 const script=`$ErrorActionPreference='Stop';$e=Get-Content -LiteralPath ${quote(path.join(base,'world-site-selection-evidence.json'))} -Raw|ConvertFrom-Json;$x=$e.xml[0];$d=[xml](Get-Content -LiteralPath (Join-Path ${quote(game)} $x.file) -Raw);$nodes=$d.SelectNodes($x.xpath);if($nodes.Count -ne $x.nodes.Count){throw 'Water node count'};for($i=0;$i -lt $nodes.Count;$i++){$expected=([xml]$x.nodes[$i]).DocumentElement;if($nodes[$i].HasAttribute('ParentName')){throw 'Unexpected parent'};foreach($child in $expected.ChildNodes){if($nodes[$i].SelectSingleNode($child.LocalName).OuterXml -cne $child.OuterXml){throw 'Water projection mismatch'}}};$nodes.Count`;
 nativeXmlProjections=Number(execFileSync('pwsh',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',maxBuffer:1024*1024}).trim());assert.equal(nativeXmlProjections,2);
}
let links=0;const doc=path.join(base,'../106-world-site-selection-mechanisms.md');
for(const [,target]of readFileSync(doc,'utf8').matchAll(/\]\(([^)]+)\)/g)){if(/^(https?:|#)/.test(target))continue;assert.ok(existsSync(path.resolve(path.dirname(doc),target.split('#')[0])),target);links++;}
console.log(JSON.stringify({mode:local?'local-source-and-reused-native-integrity':'portable-index-and-reused-record-integrity',new_types:m.types.length,claims:e.claims.length,source_pointers:pointers,legacy_claim_references:legacyClaims,reused_artifact_hashes:e.dependencies.length,selected_source_types:used.size,arithmetic_cases:e.arithmetic_cases.length,new_native_runs:0,reused_native_tiles:oldRuntime.tileObservations,reused_native_saves:oldRuntime.saveSnapshots,reused_native_crops:oldRuntime.crops,reused_native_actions:oldRuntime.actions,previous_biome_assertions:oldStatic.analyticAssertions,checked_file_hashes:checked.size,native_xml_projections:nativeXmlProjections,local_links:links,scope:'Source/record integrity and independent arithmetic; no native generation or seed-equivalence claim'},null,2));
