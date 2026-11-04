import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bytes=file=>readFileSync(path.join(root,file));
const hash=value=>createHash('sha256').update(value).digest('hex');
const report=JSON.parse(bytes('docs/research/rimworld/evidence/allowed-area-voxel-validation.json'));
const all=readdirSync(path.join(root,'tests'),{recursive:true}).filter(f=>f.endsWith('.test.ts'))
  .map(f=>'tests/'+f.replaceAll('\\','/')).sort();
assert.equal(report.version,44);
assert.deepEqual(report.regression.coverage.map(f=>f.file).sort(),all);
let count=0;
for(const c of report.regression.coverage){assert.equal(hash(bytes(c.file)),c.sha256,c.file);count+=c.tests;}
assert.equal(count,report.regression.tests);assert.equal(report.regression.files,all.length);assert.equal(report.regression.skipped,0);
assert.equal(report.harvest.ticks,97025);assert.equal(report.harvest.grain,90);
assert.equal(hash(bytes(report.campaign.script)),report.campaign.scriptSha256);
assert.equal(hash(bytes(report.browser.script)),report.browser.scriptSha256);
assert.equal(report.campaign.checks.length,10);assert.equal(report.campaign.commands,82);assert.equal(report.campaign.expectedRejections,1);
assert.deepEqual(report.browser.modes.map(m=>m.mode),['worker','main']);
for(const m of report.browser.modes){assert.equal(m.status,'passed');assert.equal(m.checks.length,7);assert.equal(m.screenshots.length,8);assert.deepEqual(m.errors,[]);}
assert.equal(report.legacyV43.length,5);
if(process.argv.includes('--local')){
  for(const a of report.regression.attempts)assert.equal(hash(bytes(a.file)),a.sha256);
  for(const f of [report.harvest,...report.campaign.checkpoints,...report.legacyV43,report.build])
    assert.equal(hash(bytes(f.file??f.log)),f.sha256);
  for(const m of report.browser.modes){
    for(const f of m.screenshots)assert.equal(hash(bytes(f.file)),f.sha256);
    for(const a of m.assets)assert.equal(hash(bytes('dist/assets/'+path.basename(new URL(a.url).pathname))),a.sha256);
  }
  const {build}=await import('esbuild');
  const compiled=await build({entryPoints:[path.join(root,'src/voxel/world.ts')],bundle:true,platform:'node',format:'esm',write:false});
  assert.equal(hash(compiled.outputFiles[0].contents),report.sourceBundleSha256);
}
console.log(JSON.stringify({status:'passed',files:all.length,tests:count,local:process.argv.includes('--local'),
  meaning:process.argv.includes('--local')?'Local logs, screenshots, build, source and authentic saves match the frozen receipt.':'Tracked source and test inventory match the frozen receipt. This does not rerun the tests.'}));
