// A frozen record is not a test runner. --local requires retained ignored inputs.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bytes=file=>readFileSync(path.join(root,file));
const json=file=>JSON.parse(bytes(file));
const hash=data=>createHash('sha256').update(data).digest('hex');
const textHash=file=>hash(bytes(file).toString('utf8').replaceAll('\r\n','\n'));
const list=folder=>readdirSync(path.join(root,folder),{recursive:true,withFileTypes:true}).filter(e=>e.isFile())
  .map(e=>path.relative(root,path.join(e.parentPath,e.name)).replaceAll('\\','/')).sort();
const fingerprint=()=>{const files=list('src');return{files:files.length,
  sha256:hash(files.map(f=>f+'\0'+textHash(f)).join('\n')),encoding:'UTF-8 text normalized to LF'};};
const record=file=>({file,sha256:hash(bytes(file))});
const testFiles=list('tests').filter(f=>f.endsWith('.test.ts'));
const receiptPath='docs/research/rimworld/evidence/construction-failure-voxel-validation.json';
if(process.argv.includes('--freeze')) {
  const files=['test-results/construction-failure-regression.json','test-results/construction-failure-repaired.json',
    'test-results/construction-failure-regression-tests.json','test-results/construction-failure-final-focused.json',
    'test-results/construction-failure-food.json'];
  const latest=new Map(),attempts=[];
  for(const file of files){
    const report=json(file);assert.equal(report.numPendingTests,0,file);
    if(file!==files[0]){assert.equal(report.success,true,file);assert.equal(report.numFailedTests,0,file);}
    attempts.push({...record(file),success:report.success,passed:report.numPassedTests,failed:report.numFailedTests,pending:report.numPendingTests});
    for(const entry of report.testResults)latest.set(path.relative(root,entry.name).replaceAll('\\','/'),entry);
  }
  assert.deepEqual([...latest.keys()].sort(),testFiles,'Every current test file needs a passing result');
  const coverage=testFiles.map(file=>{const result=latest.get(file);assert.equal(result.status,'passed',file);
    for(const test of result.assertionResults)assert.equal(test.status,'passed',test.fullName);
    return{file,sha256:textHash(file),tests:result.assertionResults.length};});
  const foodLog='test-results/construction-failure-food.log';
  const match=bytes(foodLog).toString().match(/\[voxel-food harvest\] (\d+) ticks \(([\d.]+) days\), (\d+) grain, (\d+) ms; every tick audited/);
  assert(match,'Retain actual harvest console measurements');assert(Number(match[1])>=96000);assert(Number(match[3])>=90);
  assert.match(bytes('tests/voxel-food.test.ts').toString(),/toBeGreaterThanOrEqual\(DAY \* 8\)/);
  const buildLog='test-results/construction-failure-build.log',typeLog='test-results/construction-failure-typecheck.log';
  assert.match(bytes(buildLog).toString(),/built in/);assert.doesNotMatch(bytes(typeLog).toString(),/error TS\d+/);
  const manifest=json('docs/research/rimworld/evidence/construction-failure-manifest.json');
  const mechanisms=json('docs/research/rimworld/evidence/construction-failure-mechanisms.json');
  const checks=['test-results/construction-failure-static-extraction-check.log','test-results/construction-failure-static-mechanism-check.log'].map(record);
  assert.match(bytes(checks[0].file).toString(),/Re-extracted and checked 16 construction-failure types/);
  assert.match(bytes(checks[1].file).toString(),/47 anchors, 5 bounded checks, 4 packaged Def projections/);
  assert.equal(manifest.types.length,16);assert.equal(mechanisms.rules.length,47);
  assert.equal(mechanisms.boundedChecks.length,5);assert.equal(mechanisms.packagedDefs.length,4);
  const legacyFile='test-results/construction-failure-legacy.json',legacy=json(legacyFile);
  assert.equal(legacy.status,'passed');assert.equal(legacy.historical.workTicks,20);assert.equal(legacy.historical.sourceCount,84);
  assert.equal(legacy.nativeGameplay,false);assert.equal(legacy.browserInteraction,false);
  for(const [file,digest] of Object.entries(legacy.current.sources))assert.equal(hash(bytes(file)),digest,file);
  assert.equal(hash(bytes(legacy.provenance.path)),legacy.provenance.sha256);
  const provenance=json(legacy.provenance.path),baseline='test-results/construction-failure-v46-baseline/';
  const retainedLegacy=[record(baseline+provenance.sourceBundle),...provenance.samples.map(s=>{
    assert.equal(hash(bytes(baseline+s.file)),s.sha256);return record(baseline+s.file);
  })];
  assert.equal(retainedLegacy[0].sha256,legacy.historical.bundleSha256);
  const tracked=['scripts/voxel-construction-failure-legacy-verify.mjs','scripts/research/verify-voxel-construction-failure-validation.mjs',
    'scripts/research/extract-construction-failure.ps1','scripts/research/collect-construction-failure-evidence.ps1',
    'docs/research/rimworld/evidence/construction-failure-manifest.json','docs/research/rimworld/evidence/construction-failure-mechanisms.json',
    legacy.provenance.path,...list('tests').filter(f=>!f.endsWith('.test.ts')),'.github/workflows/pages.yml','package.json','package-lock.json','vite.config.ts'];
  const receipt={schema:1,version:47,verifiedAt:new Date().toISOString(),source:fingerprint(),
    meaning:'Frozen static and headless validation; does not establish native or browser gameplay. Tracked text normalizes CRLF; retained logs, saves and dist use exact bytes.',
    regression:{files:coverage.length,tests:coverage.reduce((n,f)=>n+f.tests,0),skipped:0,coverage,attempts,
      diagnostics:['test-results/construction-failure-food-before-ladder-fix.json',
        'test-results/construction-failure-food-before-ladder-fix.log','test-results/construction-failure-ladder-fix.log'].map(record),
      reviewFixes:'Pending survivors remain combustible and lose support with nearby geometry. Shelves use construction speed/learning. Old ledger assertions now count destroyed materials; one damage-inheritance fixture uses a qualified builder to isolate the original frame from failure replacement. Current schema assertions updated. Affected fire/shelf/worker/relocation suites reran. The long food suite exposed an upper ladder with no same-level material landing; local gravity now returns survivors to nearby legal ground, including cancellation. Focused failure/building suites, the full food suite, historical migration, typecheck and build reran after this repair.'},
    harvest:{...record(foodLog),ticks:Number(match[1]),days:Number(match[2]),grain:Number(match[3]),milliseconds:Number(match[4]),exactTickAndYieldCaptured:true},
    legacyV46:{report:record(legacyFile),provenance:legacy.provenance,retained:retainedLegacy,
      historical:legacy.historical,roundTrips:legacy.roundTrips,continuationTicks:legacy.continuationTicks,finalTick:legacy.finalTick,finalWood:legacy.finalWood,
      scope:'One untouched v46 model-generated working frame from public commands, not a player/native/browser save. Original Git bundle reconstructed; real work resumes and finishes with per-tick material accounting.'},
    original:{version:manifest.version_text,assemblySha256:manifest.source_sha256,staticTypes:manifest.types.length,
      rules:mechanisms.rules.length,boundedChecks:mechanisms.boundedChecks.length,defNodes:mechanisms.packagedDefs.length,checks,
      completedGameplayScenarios:0,newSaveCount:0,publicScreenshots:0},
    browser:{executed:false,reason:'User requested no further program interaction. UI statically checked and built only.'},
    build:{log:record(buildLog),typecheck:record(typeLog),entry:record('dist/index.html'),assets:list('dist/assets').map(record)},
    tracked:tracked.map(file=>({file,sha256:textHash(file)})),
    limits:'Mechanisms first; economic balance provisional. Controlled fixtures, deliberate capacity exhaustion and injected fire/support damage are distinct from ordinary public-command construction. No GUI, renderer, interaction or native-game runtime validation this milestone.'};
  writeFileSync(path.join(root,receiptPath),JSON.stringify(receipt,null,2)+'\n');
}
const report=json(receiptPath);assert.equal(report.version,47);assert.deepEqual(report.source,fingerprint());
assert.deepEqual(report.regression.coverage.map(f=>f.file),testFiles);
let count=0;
for(const entry of report.regression.coverage){assert.equal(textHash(entry.file),entry.sha256,entry.file);count+=entry.tests;}
assert.equal(report.regression.tests,count);assert.equal(report.regression.files,testFiles.length);assert.equal(report.regression.skipped,0);
for(const entry of report.tracked)assert.equal(textHash(entry.file),entry.sha256,entry.file);
assert.equal(report.browser.executed,false);assert.equal(report.original.completedGameplayScenarios,0);
assert.equal(report.original.newSaveCount,0);assert.equal(report.original.publicScreenshots,0);
assert.equal(report.legacyV46.historical.workTicks,20);assert(report.harvest.ticks>=96000 && report.harvest.grain>=90);
if(process.argv.includes('--local') || process.argv.includes('--freeze')) {
  const local=[...report.regression.attempts,...report.regression.diagnostics,report.harvest,report.legacyV46.report,...report.legacyV46.retained,
    ...report.original.checks,report.build.log,report.build.typecheck,report.build.entry,...report.build.assets];
  for(const entry of local)assert.equal(hash(bytes(entry.file)),entry.sha256,entry.file);
}
console.log(JSON.stringify({status:'passed',files:testFiles.length,tests:count,
  local:process.argv.includes('--local')||process.argv.includes('--freeze'),nativeGameplay:false,browserInteraction:false,
  meaning:'Files match the recorded validation; this does not rerun tests.'}));
