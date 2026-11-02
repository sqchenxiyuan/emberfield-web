import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const unit=await json('test-results/unit-report.json');
const housing=await json('test-results/voxel-housing-campaign/report.json');
const browser=await json('test-results/voxel-housing-browser/report.json');
const food=await json('test-results/voxel-food-campaign/report.json');
const foodBrowser=await json('test-results/voxel-food-browser/report.json');
const lifecycle=await json('test-results/voxel-lifecycle/report.json');
assert.equal(unit.success,true);
for(const r of [housing,browser,food,foodBrowser,lifecycle])assert.equal(r.status,'passed');
assert.deepEqual(foodBrowser.errors,[]);assert.deepEqual(lifecycle.browserErrors,[]);
assert.deepEqual(browser.modes.map(m=>m.mode).sort(),['main','worker']);
const sources=[];
for(const file of (await readdir('src/voxel')).sort())sources.push({file:`src/voxel/${file}`,sha256:sha(await readFile(`src/voxel/${file}`))});
for(const [file,hash] of Object.entries(browser.sourceHashes))assert.equal(sha(await readFile(file)),hash,`changed tested source ${file}`);
const assets=new Map();
for(const mode of browser.modes){
 assert.equal(mode.status,'passed');assert.deepEqual(mode.errors,[]);
 assert.ok(mode.assets.some(a=>new URL(a.url).pathname.includes('/assets/')),'requires production browser verification');
 for(const item of mode.assets){
  const file=new URL(item.url).pathname.split('/').at(-1);
  assert.ok(item.sha256&&!item.error);assert.equal(sha(await readFile(`dist/assets/${file}`)),item.sha256);
  assets.set(file,{file:`assets/${file}`,sha256:item.sha256,bytes:item.bytes});
 }
}
for(const item of [...foodBrowser.assets,...lifecycle.assetDigests]){
 const file=new URL(item.url).pathname.split('/').at(-1);
 assert.equal(sha(await readFile(`dist/assets/${file}`)),item.sha256,'regression report/build mismatch');
}
const out='docs/research/rimworld/evidence';await mkdir(`${out}/voxel`,{recursive:true});
const screenshots=[],engine=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await engine.newPage();
 for(const [source,name] of [['worker-05-underground-room','underground-bedroom'],['worker-07-sleeping-z11','upstairs-sleep']]){
  const file=`test-results/voxel-housing-browser/${source}.png`,bytes=await readFile(file);
  const b64=await page.evaluate(async raw=>{const img=new Image();img.src='data:image/png;base64,'+raw;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/jpeg',.83).split(',')[1];},bytes.toString('base64'));
  const jpeg=Buffer.from(b64,'base64');await writeFile(`${out}/voxel/${name}.jpg`,jpeg);
  screenshots.push({file:`voxel/${name}.jpg`,sha256:sha(jpeg),source:file,sourceSha256:sha(bytes),transform:'Full reviewed gameplay viewport, JPEG .83, no crop'});
 }
}finally{await engine.close();}
const record={generatedAt:new Date().toISOString(),kind:'web-runtime-validated',scope:'Emberfield voxel housing milestone. Original housing evidence is static/XML, not independently measured native behavior. Normal-command campaigns advance game ticks headlessly, not hours of real-time browser play. Room array and renderer counters are not total browser/GPU capacity claims.',
 sources,assets:[...assets.values()],unit:{passed:unit.numPassedTests,total:unit.numTotalTests,failed:unit.numFailedTests},
 housing:{scope:housing.scope,checkpoints:housing.checkpoints,sleepEvents:housing.sleepEvents,doorEvents:housing.doorEvents,rooms:housing.rooms,final:housing.final},
 browser:{base:browser.base,scope:browser.scope,modes:browser.modes.map(m=>({mode:m.mode,checks:m.checks,fixture:m.fixture,errors:m.errors,final:m.final}))},
 regressions:{food:{scope:food.scope,final:food.final},foodBrowser:{checks:foodBrowser.checks,errors:foodBrowser.errors},emptyWorldLifecycle:{scope:lifecycle.scope,cycles:lifecycle.cycles.length,convergence:lifecycle.convergence,errors:lifecycle.browserErrors}},screenshots};
await writeFile(`${out}/voxel-housing-validation.json`,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({status:'recorded',unit:record.unit,browserChecks:browser.modes.map(m=>({mode:m.mode,count:m.checks.length})),screenshots:screenshots.map(s=>s.file)},null,2));
