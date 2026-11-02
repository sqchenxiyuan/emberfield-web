import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
const json = async file => JSON.parse(await readFile(file,'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const unit=await json('test-results/unit-report.json');
const campaign=await json('test-results/voxel-preservation-campaign/report.json');
const browser=await json('test-results/voxel-preservation-browser/report.json');
const power=await json('test-results/voxel-power-campaign/report.json');
const food=await json('test-results/voxel-food-campaign/report.json');
const housing=await json('test-results/voxel-housing-campaign/report.json');
const foodBrowser=await json('test-results/voxel-food-browser/report.json');
const housingBrowser=await json('test-results/voxel-housing-browser/report.json');
const powerBrowser=await json('test-results/voxel-power-browser/report.json');
assert.equal(unit.success,true);assert.equal(unit.numFailedTests,0);
for(const r of [campaign,browser,power,food,housing,foodBrowser,powerBrowser])assert.equal(r.status,'passed');
assert.equal(housingBrowser.status,'passed-fixtures-only');
assert.deepEqual(browser.modes.map(m=>m.mode).sort(),['main','worker']);
for(const [file,hash] of Object.entries(browser.sourceHashes))assert.equal(sha(await readFile(file)),hash,`source changed after browser validation: ${file}`);
const sources=[];
for(const f of (await readdir('src/voxel')).sort())sources.push({file:`src/voxel/${f}`,sha256:sha(await readFile(`src/voxel/${f}`))});
const assets=new Map();
for(const r of [...browser.modes,...powerBrowser.modes,...housingBrowser.modes,foodBrowser]){
 assert.deepEqual(r.errors,[]);
 for(const a of r.assets){
  const file=`dist/assets/${new URL(a.url).pathname.split('/').at(-1)}`;
  assert.equal(sha(await readFile(file)),a.sha256,`mismatched production bytes ${a.url}`);
  if(a.matchesLocalBuild!==undefined)assert.equal(a.matchesLocalBuild,true);
  assets.set(file,{file:file.slice(5),sha256:a.sha256,bytes:a.bytes});
 }
}
for(const fixture of Object.values(campaign.fixtures))assert.equal(sha(await readFile(fixture.file)),fixture.sha256);
const scripts=[];
for(const file of ['scripts/voxel-preservation-verify.mjs','scripts/voxel-preservation-campaign-verify.mjs','scripts/voxel-preservation-browser-verify.mjs','tests/voxel-preservation.test.ts','tests/voxel-preservation-integration.test.ts'])scripts.push({file,sha256:sha(await readFile(file))});
const out='docs/research/rimworld/evidence';await mkdir(`${out}/voxel`,{recursive:true});
const screenshots=[],engine=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await engine.newPage();
 for(const [source,name] of [['worker-03-storage-900','preservation-storage'],['worker-04-frozen-food','preservation-frozen-food']]){
  const file=`test-results/voxel-preservation-browser/${source}.png`,bytes=await readFile(file);
  const b64=await page.evaluate(async raw=>{const img=new Image();img.src='data:image/png;base64,'+raw;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/jpeg',.83).split(',')[1];},bytes.toString('base64'));
  const jpeg=Buffer.from(b64,'base64');await writeFile(`${out}/voxel/${name}.jpg`,jpeg);screenshots.push({file:`voxel/${name}.jpg`,sha256:sha(jpeg),source:file,sourceSha256:sha(bytes),transform:'Full reviewed gameplay viewport, JPEG .83, no crop'});
 }
}finally{await engine.close();}
const record={generatedAt:new Date().toISOString(),kind:'web-runtime-validated',scope:'Emberfield preservation milestone. Original RimWorld source/XML and native experimental evidence are separate chapters 19/18. Normal Node campaigns advance simulated calendar time; browser fixtures preserve that provenance. Synthetic unit fixtures are not normal gameplay proof. No large-map, population or 4 GiB capacity claim.',sources,scripts,assets:[...assets.values()],unit:{passed:unit.numPassedTests,total:unit.numTotalTests,failed:unit.numFailedTests},campaign:{scope:campaign.scope,source:campaign.source,checks:campaign.checks,samples:campaign.samples,fixtures:campaign.fixtures,final:campaign.final,errors:campaign.errors},browser:{base:browser.base,scope:browser.scope,fixtures:browser.fixtures,modes:browser.modes.map(m=>({mode:m.mode,status:m.status,checks:m.checks,errors:m.errors}))},regressions:{food:{scope:food.scope,final:food.final},housing:{scope:housing.scope,final:housing.final},power:{scope:power.scope,final:power.final},foodBrowser:{checks:foodBrowser.checks,errors:foodBrowser.errors},housingBrowser:{scope:'Fixtures-only regression in Worker and main rendering.',modes:housingBrowser.modes.map(m=>({mode:m.mode,status:m.status,checks:m.checks,errors:m.errors}))},powerBrowser:{modes:powerBrowser.modes.map(m=>({mode:m.mode,status:m.status,checks:m.checks,errors:m.errors}))}},screenshots};
await writeFile(`${out}/voxel-preservation-validation.json`,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({status:'recorded',unit:record.unit,browser:record.browser.modes.map(m=>({mode:m.mode,checks:m.checks.length})),screenshots:screenshots.map(s=>s.file)},null,2));
