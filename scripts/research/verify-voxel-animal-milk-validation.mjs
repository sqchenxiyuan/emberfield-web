// Local evidence only. No original game, browser, preview, GUI or network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const receiptFile='docs/research/rimworld/evidence/animal-milk-voxel-validation.json';
const bytes=f=>fs.readFileSync(f),json=f=>JSON.parse(bytes(f));
const hash=b=>createHash('sha256').update(b).digest('hex');
const normalized=f=>hash(bytes(f).toString('utf8').replaceAll('\r\n','\n'));
const record=file=>({file,sha256:hash(bytes(file)),bytes:bytes(file).length});
const list=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(`${dir}/${e.name}`):[`${dir}/${e.name}`]).sort();
function checkRecord(r){assert.equal(hash(bytes(r.file)),r.sha256,r.file);if(r.byteLength!==undefined)assert.equal(bytes(r.file).length,r.byteLength);return record(r.file);}
function sourcesMatch(sources){for(const [file,digest]of Object.entries(sources))assert.equal(hash(bytes(file)),digest,`Executed model source: ${file}`);}
function capture(){
  const testFiles=list('tests').filter(f=>/\.test\.tsx?$/.test(f));
  const reports=['test-results/animal-milk-regression.json'];
  if(fs.existsSync('test-results/animal-milk-regression-rerun.json'))reports.push('test-results/animal-milk-regression-rerun.json');
  const results=new Map(),attempts=[];
  for(const [i,file]of reports.entries()){
    const r=json(file);
    if(i>0){assert.equal(r.success,true);assert.equal(r.numFailedTests,0);assert.equal(r.numPendingTests,0);}
    attempts.push({...record(file),success:r.success,passed:r.numPassedTests,failed:r.numFailedTests,pending:r.numPendingTests});
    for(const result of r.testResults)results.set(path.relative(process.cwd(),result.name).replaceAll('\\','/'),result);
  }
  assert.deepEqual([...results.keys()].sort(),testFiles);
  const coverage=testFiles.map(file=>{const r=results.get(file);assert.equal(r.status,'passed',file);
    for(const t of r.assertionResults)assert.equal(t.status,'passed',t.fullName);
    return{file,sha256:normalized(file),tests:r.assertionResults.length};});
  const buildLog='test-results/animal-milk-build.log';
  assert.match(bytes(buildLog).toString(),/tsc --noEmit && vite build/);assert.match(bytes(buildLog).toString(),/built in/);
  assert.doesNotMatch(bytes(buildLog).toString(),/error TS\d+/);
  const finalTypecheck='test-results/animal-milk-final-typecheck.log';
  assert.match(bytes(finalTypecheck).toString(),/tsc --noEmit/);assert.doesNotMatch(bytes(finalTypecheck).toString(),/error TS\d+/);
  const legacyFile='test-results/animal-milk-legacy.json',legacy=json(legacyFile);
  assert.equal(legacy.status,'passed');assert.equal(legacy.nativeGameplay,false);assert.equal(legacy.browserInteraction,false);
  assert.equal(legacy.originalSubtree,'07a386cf087ac52e411b49710af1de240459ea59');
  assert.equal(legacy.auditedTicks,legacy.continuationTicks);assert.equal(legacy.continuationTicks,136);
  assert.equal(legacy.historical.handleTask.action,'autoSlaughter');assert.equal(legacy.historical.handleTask.progress,25);
  assert.equal(legacy.outputs.milkProduced,0);sourcesMatch(legacy.current.sources);
  assert.equal(hash(bytes(legacy.provenance.path)),legacy.provenance.sha256);
  const provenance=json(legacy.provenance.path),baseline='test-results/animal-milk-v48-baseline/';
  assert.equal(hash(bytes(baseline+provenance.sourceBundle)),provenance.sourceBundleSha256);
  assert.equal(hash(bytes(provenance.script)),provenance.scriptSha256);
  const retainedLegacy=[record(legacy.provenance.path),record(baseline+provenance.sourceBundle),record(provenance.script),
    ...provenance.samples.map(s=>checkRecord({...s,file:baseline+s.file})),...legacy.checkpoints.map(checkRecord)];
  const campaignFile='test-results/animal-milk-campaign.json',campaign=json(campaignFile);
  assert.equal(campaign.status,'passed');assert.equal(campaign.nativeGameplay,false);assert.equal(campaign.browserInteraction,false);
  assert.equal(campaign.execution.version,49);assert.equal(campaign.baseline.settings.biome,'desert');
  assert.equal(campaign.baseline.counts.milk,0);assert.equal(campaign.baseline.counts.grain,0);
  assert.equal(campaign.auditedTicks,campaign.continuationTicks);assert.ok(campaign.auditedTicks>24000);
  assert.equal(campaign.outputs.milkProduced,18);assert.ok(campaign.outputs.milkConsumed>0);
  sourcesMatch(campaign.execution.sources);assert.equal(hash(bytes(campaign.execution.script)),campaign.execution.scriptSha256);
  const diagnosticDir='test-results/animal-milk-campaign/unpenned-diagnostic';
  const diagnostic=json(diagnosticDir+'/report.json');
  assert.equal(diagnostic.status,'failed');assert.match(diagnostic.error,/original female dromedary/);
  assert.equal(hash(bytes(diagnosticDir+'/executed-campaign.mjs')),diagnostic.execution.scriptSha256);
  const manifestFile='docs/research/rimworld/evidence/animal-milk-manifest.json',mechanismsFile='docs/research/rimworld/evidence/animal-milk-mechanisms.json';
  const manifest=json(manifestFile),mechanisms=json(mechanismsFile);
  assert.equal(manifest.types.length,35);assert.equal(mechanisms.rules.length,72);assert.equal(mechanisms.boundedChecks.length,8);assert.equal(mechanisms.packagedXml.length,25);
  const staticLogs=['test-results/animal-milk-static-extraction-check.log','test-results/animal-milk-static-mechanism-check.log'];
  assert.match(bytes(staticLogs[0]).toString(),/35 animal-milk types/);
  assert.match(bytes(staticLogs[1]).toString(),/72 anchors, 8 bounded checks, 25 packaged XML projections/);
  const tracked=[manifestFile,mechanismsFile,'docs/research/rimworld/evidence/animal-milk-v48-provenance.json',
    'scripts/research/verify-voxel-animal-milk-validation.mjs','scripts/research/extract-animal-milk.ps1','scripts/research/collect-animal-milk-evidence.ps1',
    'scripts/voxel-animal-milk-legacy-verify.mjs','scripts/voxel-animal-milk-campaign-verify.mjs',
    'docs/research/rimworld/141-animal-milk-mechanisms.md','docs/research/rimworld/142-animal-milk-gameplay.md',
    ...list('tests').filter(f=>!/\.test\.tsx?$/.test(f)),'.github/workflows/pages.yml','package.json','package-lock.json','vite.config.ts'];
  return{schema:1,version:49,source:list('src').map(file=>({file,sha256:normalized(file)})),
    meaning:'Local static and headless validation only. Source normalizes CRLF; reports, saves and build bytes are exact. Tests run locally; Pages builds/deploys only.',
    regression:{files:coverage.length,tests:coverage.reduce((n,f)=>n+f.tests,0),skipped:0,attempts,coverage,
      note:'Retain the initial full-run failures and skipped cases. Final coverage requires every test in each latest complete file result to pass; no assertion or test timeout was weakened.'},
    original:{staticTypes:35,anchors:72,boundedChecks:8,xmlProjections:25,checks:staticLogs.map(record)},
    legacyV48:{report:record(legacyFile),retained:retainedLegacy,historical:legacy.historical,roundTrips:legacy.roundTrips,
      continuationTicks:legacy.continuationTicks,finalTick:legacy.finalTick,outputs:legacy.outputs},
    campaign:{report:record(campaignFile),log:record('test-results/animal-milk-campaign/run.log'),retained:campaign.checkpoints.map(checkRecord),
      diagnostics:list(diagnosticDir).map(record),
      checks:campaign.checks.length,auditedTicks:campaign.auditedTicks,continuationTicks:campaign.continuationTicks,
      finalTick:campaign.finalTick,outputs:campaign.outputs,scope:campaign.scope,execution:campaign.execution},
    tracked:tracked.map(file=>({file,sha256:normalized(file)})),
    build:{log:record(buildLog),finalTypecheck:record(finalTypecheck),typecheck:'tsc --noEmit passed as part of npm run build and after test-schema expectation updates',entry:record('dist/index.html'),assets:list('dist/assets').map(record)},
    limits:['No native or browser gameplay or visual acceptance.','Controlled edge-case fixtures are distinct from the generated-world campaign and authentic historical save.',
      'Single-seed natural campaign is not long-term economy or difficulty calibration.','Full animal health, training, wool, eggs and native global stat modifiers remain incomplete.']};
}
const current=capture();
if(process.argv.includes('--freeze'))fs.writeFileSync(receiptFile,JSON.stringify({...current,verifiedAt:new Date().toISOString()},null,2)+'\n');
else{assert(process.argv.includes('--local'),'Use --freeze or --local');const{verifiedAt,...frozen}=json(receiptFile);assert(verifiedAt);assert.deepEqual(current,frozen,'Source or evidence changed since freeze');}
console.log(JSON.stringify({status:'passed',version:49,files:current.regression.files,tests:current.regression.tests,campaignTicks:current.campaign.auditedTicks,assets:current.build.assets.length}));
