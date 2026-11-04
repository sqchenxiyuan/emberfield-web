// Local model/build evidence only; never starts a game, browser or preview.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const receipt='docs/research/rimworld/evidence/animal-wool-voxel-validation.json';
const bytes=f=>fs.readFileSync(f),json=f=>JSON.parse(bytes(f));
const hash=b=>createHash('sha256').update(b).digest('hex');
const record=file=>({file,sha256:hash(bytes(file)),bytes:bytes(file).length});
const list=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(`${dir}/${e.name}`):[`${dir}/${e.name}`]).sort();
const relative=f=>path.relative(process.cwd(),f).replaceAll('\\','/');

function capture() {
  const testFiles=list('tests').filter(f=>/\.test\.tsx?$/.test(f));
  const results=new Map(),attempts=[];
  for(const file of ['test-results/animal-wool-regression.json','test-results/animal-wool-regression-rerun.json',
    'test-results/animal-wool-ui-tests.json']) {
    if(!fs.existsSync(file))continue;
    const report=json(file);
    attempts.push({...record(file),passed:report.numPassedTests,failed:report.numFailedTests,pending:report.numPendingTests});
    for(const result of report.testResults)results.set(relative(result.name),result);
  }
  assert.deepEqual([...results.keys()].sort(),testFiles,'Every current test file needs a complete latest result');
  const coverage=testFiles.map(file=>{
    const result=results.get(file);assert.equal(result.status,'passed',file);
    assert(result.assertionResults.length>0,file);
    for(const test of result.assertionResults)assert.equal(test.status,'passed',test.fullName);
    return {...record(file),tests:result.assertionResults.length};
  });
  const buildLog='test-results/animal-wool-build.log';
  assert.match(bytes(buildLog).toString(),/tsc --noEmit && vite build/);
  assert.match(bytes(buildLog).toString(),/built in/);
  assert.doesNotMatch(bytes(buildLog).toString(),/error TS\d+/);
  const legacyFile='test-results/animal-wool-v49-baseline/verification/report.json',legacy=json(legacyFile);
  assert.equal(legacy.status,'passed');assert.equal(legacy.originalSubtree,'91aae567053c15635b7477745f165cbffa7ad686');
  assert.equal(legacy.historicalLockstep,true);assert.equal(legacy.auditedTicks,335);
  assert.deepEqual(legacy.outputs,{milkProduced:18,woolProduced:0});
  for(const [file,digest]of Object.entries(legacy.execution.sources))assert.equal(hash(bytes(file)),digest,`Executed model changed: ${file}`);
  assert.equal(hash(bytes(legacy.execution.script)),legacy.execution.scriptSha256);
  assert.equal(hash(bytes(legacy.provenance.path)),legacy.provenance.sha256);
  for(const checkpoint of legacy.checkpoints)assert.equal(hash(bytes(checkpoint.file)),checkpoint.sha256);
  const tailorFile='test-results/animal-wool-v49-baseline/implicit-tailor/report.json',tailor=json(tailorFile);
  const tailorScript='test-results/animal-wool-v49-baseline/verify-implicit-tailor.mjs';
  assert.equal(tailor.status,'passed');assert.equal(tailor.continuationTicks,873);
  assert.deepEqual(tailor.outputs,{apparelProduced:1,material:'cloth'});
  assert.equal(hash(bytes(tailorScript)),tailor.scriptSha256);
  assert.equal(hash(bytes(tailor.fixture.file)),tailor.fixture.sha256);
  assert.equal(hash(bytes(tailor.baseline.file)),tailor.baseline.sha256);
  for(const [file,digest]of Object.entries(tailor.execution.sources))assert.equal(hash(bytes(file)),digest,`Executed tailor model changed: ${file}`);
  const manifestFile='docs/research/rimworld/evidence/animal-wool-manifest.json',manifest=json(manifestFile);
  const mechanismFile='docs/research/rimworld/evidence/animal-wool-mechanisms.json',mechanisms=json(mechanismFile);
  assert.equal(manifest.types.length,34);assert.equal(mechanisms.manifestSha256,hash(bytes(manifestFile)));
  const staticLogs=['test-results/animal-wool-static-extraction-check.log','test-results/animal-wool-static-mechanism-check.log'];
  assert.match(bytes(staticLogs[0]).toString(),/checked 34/);
  assert.match(bytes(staticLogs[1]).toString(),/60 anchors, 6 bounded checks, 37 packaged XML projections/);
  return {
    milestone:'v50 animal wool and textile apparel',nativeGameplay:false,browserInteraction:false,
    scope:'Static native evidence; controlled model fixtures for shearing to clothing; authentic historical v49 milk and cloth-tailoring task continuity. No fresh-colony ten-day wool campaign or visual acceptance.',
    sources:list('src').map(record),
    regression:{files:coverage.length,tests:coverage.reduce((n,f)=>n+f.tests,0),attempts,coverage},
    build:{log:record(buildLog),assets:list('dist').map(record)},
    original:{staticTypes:34,anchors:60,boundedChecks:6,xmlProjections:37,manifest:record(manifestFile),mechanisms:record(mechanismFile),logs:staticLogs.map(record)},
    legacyV49:{report:record(legacyFile),auditedTicks:335,outputs:legacy.outputs,provenance:record(legacy.provenance.path),
      script:record(legacy.execution.script),checkpoints:legacy.checkpoints.map(c=>record(c.file))},
    implicitTailor:{report:record(tailorFile),script:record(tailorScript),fixture:record(tailor.fixture.file),
      provenance:record(tailor.fixture.proof),baseline:record(tailor.baseline.file),auditedTicks:873,outputs:tailor.outputs},
    scripts:['scripts/research/extract-animal-wool.ps1','scripts/research/collect-animal-wool-evidence.ps1',
      'scripts/research/verify-voxel-animal-wool-validation.mjs'].map(record),
  };
}
const result=capture();
if(process.argv.includes('--freeze'))fs.writeFileSync(receipt,JSON.stringify(result,null,2)+'\n');
else {assert(process.argv.includes('--local'),'Use --freeze or --local');assert.deepEqual(json(receipt),result,'Frozen evidence differs');}
console.log(JSON.stringify({status:'passed',files:result.regression.files,tests:result.regression.tests,legacyTicks:result.legacyV49.auditedTicks,assets:result.build.assets.length}));
