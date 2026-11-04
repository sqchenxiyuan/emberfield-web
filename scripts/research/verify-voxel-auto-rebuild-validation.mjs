// Read-only receipt verification unless --freeze is explicitly supplied.
// No browser, preview, native game or GUI interaction is launched.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bytes=file=>readFileSync(path.join(root,file));
const json=file=>JSON.parse(bytes(file));
const hash=data=>createHash('sha256').update(data).digest('hex');
const textHash=file=>hash(bytes(file).toString('utf8').replaceAll('\r\n','\n'));
const list=folder=>readdirSync(path.join(root,folder),{recursive:true,withFileTypes:true}).filter(e=>e.isFile())
  .map(e=>path.relative(root,path.join(e.parentPath,e.name)).replaceAll('\\','/')).sort();
const sourceFingerprint=()=>{const files=list('src');return{files:files.length,
  sha256:hash(files.map(f=>f+'\0'+textHash(f)).join('\n')),encoding:'UTF-8 text with CRLF normalized to LF'};};
const testFiles=list('tests').filter(f=>f.endsWith('.test.ts'));
const record=file=>({file,sha256:hash(bytes(file))});
const receiptPath='docs/research/rimworld/evidence/auto-rebuild-voxel-validation.json';
if(process.argv.includes('--freeze')) {
  const reportFiles=['test-results/auto-rebuild-release-final-rest-tests.json',
    'test-results/auto-rebuild-release-repaired-tests.json','test-results/auto-rebuild-release-food-tests.json'];
  const latest=new Map(),attempts=[];
  for(const file of reportFiles) {
    const result=json(file);assert.equal(result.numPendingTests,0,file);
    if(file !== reportFiles[0]) { assert.equal(result.success,true,file);assert.equal(result.numFailedTests,0,file); }
    attempts.push({...record(file),success:result.success,passed:result.numPassedTests,failed:result.numFailedTests,pending:result.numPendingTests});
    for(const entry of result.testResults) latest.set(path.relative(root,entry.name).replaceAll('\\','/'),entry);
  }
  assert.deepEqual([...latest.keys()].sort(),testFiles,'All current test files must have passed');
  const coverage=testFiles.map(file=>{
    const result=latest.get(file);assert.equal(result.status,'passed',file);
    for(const test of result.assertionResults)assert.equal(test.status,'passed',test.fullName);
    return{file,sha256:textHash(file),tests:result.assertionResults.length};
  });
  const foodLog='test-results/auto-rebuild-release-food-tests.log';
  const match=bytes(foodLog).toString().match(/\[voxel-food harvest\] (\d+) ticks \(([\d.]+) days\), (\d+) grain, (\d+) ms; every tick audited/);
  assert(match,'Capture the actual harvest console line using default and JSON reporters');
  assert(Number(match[1])>=96000);assert(Number(match[3])>=90);
  assert.match(bytes('tests/voxel-food.test.ts').toString(),/toBeGreaterThanOrEqual\(DAY \* 8\)/);
  const buildLog='test-results/auto-rebuild-release-build.log',typeLog='test-results/auto-rebuild-release-typecheck.log';
  assert.match(bytes(buildLog).toString(),/built in/);assert.doesNotMatch(bytes(typeLog).toString(),/error TS\d+/);
  const manifest=json('docs/research/rimworld/evidence/auto-rebuild-manifest.json');
  const mechanisms=json('docs/research/rimworld/evidence/auto-rebuild-mechanisms.json');
  const checks=['test-results/auto-rebuild-static-extraction-check.log','test-results/auto-rebuild-static-mechanism-check.log'].map(record);
  assert.match(bytes(checks[0].file).toString(),/Re-extracted and checked 33 auto-rebuild types/);
  assert.match(bytes(checks[1].file).toString(),/65 anchors, 13 bounded checks, 11 packaged Def projections/);
  assert.equal(manifest.types.length,33);assert.equal(mechanisms.rules.length,65);
  assert.equal(mechanisms.boundedChecks.length,13);assert.equal(mechanisms.packagedDefs.length,11);
  const legacyFile='test-results/auto-rebuild-legacy.json',legacy=json(legacyFile);
  assert.equal(legacy.status,'passed');assert.equal(legacy.checks.length,2);
  for(const [file,digest] of Object.entries(legacy.currentModel.sourceInputs)) assert.equal(hash(bytes(file)),digest,file);
  for(const check of legacy.checks) {
    assert.equal(check.sourceVersion,45);assert.equal(check.targetVersion,46);assert.equal(check.autoRebuildDefault,false);
    assert.equal(check.originalPhysicalPreserved,true);assert.equal(check.callerInputUnchanged,true);assert.equal(check.historicalFileUnchanged,true);
    assert.equal(hash(bytes(check.file)),check.sha256,check.file);
  }
  const tracked=['scripts/voxel-auto-rebuild-legacy-verify.mjs','scripts/research/verify-voxel-auto-rebuild-validation.mjs',
    'scripts/research/extract-auto-rebuild.ps1','scripts/research/collect-auto-rebuild-evidence.ps1',
    'docs/research/rimworld/evidence/auto-rebuild-manifest.json','docs/research/rimworld/evidence/auto-rebuild-mechanisms.json',
    legacy.provenance,...list('tests').filter(f=>!f.endsWith('.test.ts')),
    '.github/workflows/pages.yml','package.json','package-lock.json','vite.config.ts'];
  const receipt={schema:1,version:46,verifiedAt:new Date().toISOString(),source:sourceFingerprint(),
    meaning:'Frozen local headless validation. No original-game or browser interaction evidence. Tracked text hashes normalize CRLF; retained raw logs and saves use exact bytes.',
    regression:{files:coverage.length,tests:coverage.reduce((n,f)=>n+f.tests,0),skipped:0,coverage,attempts,
      reviewFixes:'Static review corrected unrelated-frame support destruction, missing wire rebuilding and damage healed on completion. Full regression exposed one prior fixture using two wall-half damage records; updated it to the single building identity, retaining rollback checks. A final overlap fix preserves independently supported wire frames. All fire/destruction/damage-related suites reran afterward. Historical repair fixtures use legal Home/Touch and roundtrips exclude only documented transient scheduling fields.'},
    harvest:{...record(foodLog),ticks:Number(match[1]),days:Number(match[2]),grain:Number(match[3]),milliseconds:Number(match[4]),
      minimumTicks:96000,minimumDays:8,minimumGrain:90,exactTickAndYieldCaptured:true},
    legacyV45:{report:record(legacyFile),provenance:legacy.provenance,checks:legacy.checks,
      sourceProvenance:legacy.sourceProvenance,currentModel:legacy.currentModel,
      scope:'Two original unchanged saves generated by v45 code with public commands, not player or browser saves; real carrying/work/completion checkpoints resume in the headless current model.'},
    original:{version:manifest.version_text,assemblySha256:manifest.source_sha256,staticTypes:manifest.types.length,
      rules:mechanisms.rules.length,boundedChecks:mechanisms.boundedChecks.length,defNodes:mechanisms.packagedDefs.length,checks,
      completedGameplayScenarios:0,newSaveCount:0,publicScreenshots:0},
    browser:{executed:false,reason:'User requested no further program interaction; UI edited and compiled, not interactively verified.'},
    build:{log:record(buildLog),typecheck:record(typeLog),entry:record('dist/index.html'),assets:list('dist/assets').map(record)},
    tracked:tracked.map(file=>({file,sha256:textHash(file)})),
    limits:'Mechanics first; provisional numerical balance. Controlled model fixtures and injected damage are explicitly distinguished from normal public-command construction. No current native gameplay, browser rendering, input, screenshot or GUI campaign evidence.'};
  writeFileSync(path.join(root,receiptPath),JSON.stringify(receipt,null,2)+'\n');
}
const report=json(receiptPath);assert.equal(report.version,46);assert.deepEqual(report.source,sourceFingerprint());
assert.deepEqual(report.regression.coverage.map(f=>f.file),testFiles);
let count=0;
for(const entry of report.regression.coverage){assert.equal(textHash(entry.file),entry.sha256,entry.file);count+=entry.tests;}
assert.equal(report.regression.tests,count);assert.equal(report.regression.files,testFiles.length);assert.equal(report.regression.skipped,0);
for(const entry of report.tracked)assert.equal(textHash(entry.file),entry.sha256,entry.file);
assert.equal(report.browser.executed,false);assert.equal(report.original.completedGameplayScenarios,0);
assert.equal(report.original.newSaveCount,0);assert.equal(report.original.publicScreenshots,0);
assert.equal(report.original.staticTypes,33);assert.equal(report.original.rules,65);
assert.equal(report.legacyV45.checks.length,2);assert.equal(report.harvest.exactTickAndYieldCaptured,true);
assert(report.harvest.ticks>=96000 && report.harvest.grain>=90);
if(process.argv.includes('--local') || process.argv.includes('--freeze')) {
  const local=[...report.regression.attempts,report.harvest,report.legacyV45.report,...report.legacyV45.checks,
    report.legacyV45.currentModel,...report.original.checks,report.build.log,report.build.typecheck,report.build.entry,...report.build.assets];
  for(const entry of local)assert.equal(hash(bytes(entry.file)),entry.sha256,entry.file);
}
console.log(JSON.stringify({status:'passed',files:testFiles.length,tests:count,
  local:process.argv.includes('--local')||process.argv.includes('--freeze'),nativeGameplay:false,browserInteraction:false,
  meaning:'Files match the recorded validation; this command does not rerun tests.'}));
