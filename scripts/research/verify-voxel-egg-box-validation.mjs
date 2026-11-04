// Static evidence and headless local checks only. Does not launch a game or UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const receipt='docs/research/rimworld/evidence/egg-box-voxel-validation.json';
const bytes=file=>fs.readFileSync(file), json=file=>JSON.parse(bytes(file));
const hash=value=>createHash('sha256').update(value).digest('hex');
const record=file=>({file,sha256:hash(bytes(file)),bytes:bytes(file).length});
const list=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(`${dir}/${e.name}`):[`${dir}/${e.name}`]).sort();
const relative=file=>path.relative(process.cwd(),file).replaceAll('\\','/');
function capture(){
  const files=list('tests').filter(file=>/\.test\.tsx?$/.test(file));
  const results=new Map(),attempts=[];
  const reports=fs.readdirSync('test-results').filter(n=>/^egg-box-.*\.json$/.test(n))
    .map(n=>({file:'test-results/'+n,report:json('test-results/'+n)})).filter(x=>Array.isArray(x.report.testResults))
    .sort((a,b)=>a.report.startTime-b.report.startTime);
  for(const {file,report} of reports){
    attempts.push({...record(file),passed:report.numPassedTests,failed:report.numFailedTests,pending:report.numPendingTests});
    for(const result of report.testResults)results.set(relative(result.name),result);
  }
  assert.deepEqual([...results.keys()].sort(),files,'Every test file needs a complete latest result');
  const coverage=files.map(file=>{
    const result=results.get(file);assert.equal(result.status,'passed',file);
    assert(result.assertionResults.length>0,file);
    for(const test of result.assertionResults)assert.equal(test.status,'passed',test.fullName);
    return {...record(file),tests:result.assertionResults.length};
  });
  const buildLog='test-results/egg-box-build.log',buildText=bytes(buildLog).toString();
  assert.match(buildText,/tsc --noEmit && vite build/);assert.match(buildText,/built in/);assert.doesNotMatch(buildText,/error TS\d+/);
  const legacyFile='test-results/egg-box-v51-baseline/report.json',legacy=json(legacyFile);
  assert.equal(legacy.status,'passed');assert.equal(legacy.originalHead,'5d46d7e6b8e220fd5fc0e0004035e0d8ed070ff9');
  assert.equal(legacy.originalSubtree,'df9d1c29a14f3a1de203b5b61b3caa5555918b34');
  assert.equal(legacy.historicalLockstep,true);assert.equal(legacy.auditedTicks,750);assert.equal(legacy.continuationTicks,750);
  assert.equal(legacy.sourceIdentityRechecked,true);assert.equal(legacy.historicalInputsUnchanged,true);
  assert.deepEqual(legacy.outputs,{meals:1,apparel:1,material:'cloth',eggs:0});
  for(const [file,digest] of Object.entries(legacy.execution.sources))assert.equal(hash(bytes(file)),digest,`Executed source changed: ${file}`);
  assert.equal(hash(bytes(legacy.execution.script)),legacy.execution.scriptSha256);
  assert.equal(hash(bytes(legacy.provenance.file)),legacy.provenance.sha256);
  assert.equal(hash(bytes(legacy.baseline.file)),legacy.baseline.sha256);
  for(const checkpoint of legacy.checkpoints)assert.equal(hash(bytes(checkpoint.file)),checkpoint.sha256);
  const provenance=json(legacy.provenance.file);
  assert.equal(provenance.subtree,legacy.originalSubtree);assert.deepEqual(provenance.commands,[]);assert.deepEqual(provenance.directStateChanges,[]);
  const manifestFile='docs/research/rimworld/evidence/egg-box-manifest.json',mechanismFile='docs/research/rimworld/evidence/egg-box-mechanisms.json';
  const manifest=json(manifestFile),mechanisms=json(mechanismFile);
  assert.equal(manifest.types.length,36);assert.equal(mechanisms.manifestSha256,hash(bytes(manifestFile)));
  assert.equal(mechanisms.rules.length,101);assert.equal(mechanisms.boundedChecks.length,9);assert.equal(mechanisms.packagedXml.length,16);
  const staticLogs=['test-results/egg-box-extract-check.log','test-results/egg-box-mechanisms-check.log'];
  assert.match(bytes(staticLogs[0]).toString(),/checked 36/i);assert.match(bytes(staticLogs[1]).toString(),/101 anchors, 9 bounded checks, 16 packaged XML projections/);
  return {
    milestone:'v52 egg boxes, physical collection and storage hauling',nativeGameplay:false,browserInteraction:false,
    scope:'Native static evidence; controlled model fixtures, React SSR and CPU geometry/raycast checks. Authentic v51 cooking/cloth continuation. No browser, GPU rendering or natural new-colony egg-box campaign acceptance.',
    sources:list('src').map(record),
    regression:{files:coverage.length,tests:coverage.reduce((n,f)=>n+f.tests,0),attempts,coverage},
    build:{log:record(buildLog),assets:list('dist').map(record)},
    original:{staticTypes:36,anchors:101,boundedChecks:9,xmlProjections:16,manifest:record(manifestFile),mechanisms:record(mechanismFile),logs:staticLogs.map(record)},
    legacyV51:{report:record(legacyFile),auditedTicks:legacy.auditedTicks,outputs:legacy.outputs,reloads:legacy.reloads,
      provenance:record(legacy.provenance.file),baseline:record(legacy.baseline.file),script:record(legacy.execution.script),checkpoints:legacy.checkpoints.map(c=>record(c.file))},
    scripts:['scripts/research/extract-egg-box.ps1','scripts/research/collect-egg-box-evidence.ps1','scripts/research/verify-voxel-egg-box-validation.mjs'].map(record),
  };
}
const result=capture();
if(process.argv.includes('--freeze'))fs.writeFileSync(receipt,JSON.stringify(result,null,2)+'\n');
else{assert(process.argv.includes('--local'),'Use --freeze or --local');assert.deepEqual(json(receipt),result,'Frozen local evidence differs');}
console.log(JSON.stringify({status:'passed',files:result.regression.files,tests:result.regression.tests,legacyTicks:result.legacyV51.auditedTicks,assets:result.build.assets.length}));
