import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { models } from './case-models.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const research = path.join(root, 'docs/research/rimworld');
const evidence = path.join(research, 'evidence');
const read = name => JSON.parse(readFileSync(path.join(evidence,name),'utf8').replace(/^\uFEFF/,''));
const sha = value => createHash('sha256').update(value).digest('hex');
const validHash = value => /^[a-f0-9]{64}$/.test(value);
const groups = ['work','combat','environment','economy','generation'];
const local = process.argv.includes('--local');
const ids = new Set(), uniqueTypes = new Set();
let claimsCount=0, sourceCount=0, caseCount=0, assertionCount=0, localFiles=0, linkCount=0;
const sourceHashes = new Set();
function compare(actual, expected, label) {
  if (typeof expected === 'number') {
    assert(Number.isFinite(actual), `${label}: not finite`);
    assert(Math.abs(actual-expected)<=1e-5*Math.max(1,Math.abs(expected)), `${label}: ${actual} != ${expected}`);
    assertionCount++;
  } else if (Array.isArray(expected)) {
    assert(Array.isArray(actual));
    assert.equal(actual.length,expected.length,label);
    expected.forEach((v,i)=>compare(actual[i],v,`${label}[${i}]`));
  } else if (expected && typeof expected === 'object') {
    for (const [k,v] of Object.entries(expected)) compare(actual[k],v,`${label}.${k}`);
  } else {
    assert.equal(actual,expected,label); assertionCount++;
  }
}
for (const group of groups) {
  const manifest=read(`${group}-manifest.json`), types=read(`${group}-types.json`), claims=read(`${group}-claims.json`);
  assert.equal(manifest.version_text,'1.7.4980 rev60');
  assert(validHash(manifest.source_sha256)); sourceHashes.add(manifest.source_sha256);
  assert(validHash(manifest.engine_sha256));
  assert.deepEqual(types,manifest.types.map(t=>t.type));
  const byType=new Map(manifest.types.map(t=>[t.type,t]));
  assert.equal(byType.size,types.length);
  for (const item of manifest.types) {
    uniqueTypes.add(item.type);
    assert(validHash(item.sha256));
    assert.equal(item.local_file,`.local-research/${group}/${item.type}.cs`);
    assert(item.lines>0);
    if(local){
      const bytes=readFileSync(path.join(root,item.local_file));
      assert.equal(sha(bytes),item.sha256,`changed derived file: ${item.type}`);
      assert.equal(bytes.toString('utf8').split('\n').length,item.lines);
      localFiles++;
    }
  }
  for(const claim of claims){
    assert(!ids.has(claim.id),`duplicate claim ${claim.id}`);ids.add(claim.id);claimsCount++;
    assert(['static-derived','xml-declared','inference'].includes(claim.kind));
    assert(claim.statement && claim.sources.length>0);
    for(const source of claim.sources){
      sourceCount++;
      if(source.type){
        const item=byType.get(source.type);assert(item,`unmanifested type in ${claim.id}: ${source.type}`);
        assert(source.member && Number.isInteger(source.line_start) && Number.isInteger(source.line_end));
        assert(source.line_start>0 && source.line_end>=source.line_start && source.line_end<=item.lines,`invalid lines in ${claim.id}`);
      }else{
        assert(source.path?.startsWith('Data/') && !source.path.includes('..'));
        assert(source.xpath?.startsWith('/') && validHash(source.sha256),`invalid XML reference in ${claim.id}`);
      }
    }
  }
  for(const example of read(`${group}-cases.json`)){
    const model=models[group]?.[example.label];assert(model,`no arithmetic model for ${group}/${example.label}`);
    compare(model(example.inputs),example.expected,`${group}/${example.label}`);caseCount++;
  }
}
assert.equal(sourceHashes.size,1,'Mixed source assembly versions');
const runtime = read('runtime-interactions.json');
assert.equal(runtime.kind, 'runtime-observed');
assert(sourceHashes.has(runtime.assembly_sha256), 'Runtime target differs from static target');
for (const shot of runtime.screenshots) {
  assert(/^runtime\/[a-z-]+\.png$/.test(shot.file), 'Unexpected runtime image path');
  assert.equal(sha(readFileSync(path.join(evidence, shot.file))), shot.sha256, `changed runtime crop: ${shot.file}`);
  assert(shot.crop.length === 4 && shot.crop.every(Number.isInteger));
  assert(shot.crop[0] >= 0 && shot.crop[1] >= 0 && shot.crop[2] > 0 && shot.crop[3] > 0);
  assert(validHash(shot.source_sha256) && Number.isFinite(Date.parse(shot.timestamp_utc)));
  if (local) assert.equal(sha(readFileSync(path.join(root, shot.local_source))), shot.source_sha256);
}
for(const group of groups){
  for(const example of read(`${group}-cases.json`))for(const id of example.claims??[])assert(ids.has(id),`unknown claim ${id}`);
}
const voxel = read('voxel-implementation-validation.json');
assert.equal(voxel.kind, 'web-runtime-validated');
assert.equal(voxel.unit.failed, 0);
assert.equal(voxel.unit.passed, voxel.unit.total);
assert.equal(voxel.browser.errors.length, 0);
assert.equal(voxel.lifecycle.browserErrors.length, 0);
for (const shot of voxel.screenshots) {
  assert(/^voxel\/[a-z-]+\.jpg$/.test(shot.file));
  assert.equal(sha(readFileSync(path.join(evidence, shot.file))), shot.sha256, `changed voxel image: ${shot.file}`);
}
for(const file of readdirSync(research).filter(f=>f.endsWith('.md'))){
  const body=readFileSync(path.join(research,file),'utf8');
  for(const match of body.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)){
    const target=match[1];if(/^(https?:|#|mailto:)/.test(target))continue;
    const resolved=path.resolve(research,decodeURIComponent(target.split('#')[0]));
    assert(resolved.startsWith(root) && existsSync(resolved),`broken link ${file}: ${target}`);linkCount++;
  }
}
console.log(JSON.stringify({status:'pass',groups:groups.length,uniqueTypes:uniqueTypes.size,claims:claimsCount,sourceReferences:sourceCount,numericCases:caseCount,numericAssertions:assertionCount,localDerivedFilesVerified:localFiles,relativeDocumentLinks:linkCount,scope:local?'metadata, derived hashes, claim locations, arithmetic, links':'metadata, declared claim locations, arithmetic, links',originalGameExecuted:false,xmlValidation:'Run verify-local-sources.ps1 with your matching installation; portable check does not read game files.'},null,2));
