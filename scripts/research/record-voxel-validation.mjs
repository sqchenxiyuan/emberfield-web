// Run from project root after the unit, campaign, browser and lifecycle checks.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const unit=await json('test-results/unit-report.json');
const campaign=await json('test-results/voxel-campaign/report.json');
const browser=await json('test-results/voxel-browser/report.json');
const lifecycle=await json('test-results/voxel-lifecycle/report.json');
assert.equal(unit.success,true);for(const r of [campaign,browser,lifecycle])assert.equal(r.status,'passed');
const sources=[];
for(const file of (await readdir('src/voxel')).sort())sources.push({file:`src/voxel/${file}`,sha256:sha(await readFile(`src/voxel/${file}`))});
const assets=[];
for(const asset of lifecycle.assetDigests){const file=new URL(asset.url).pathname.split('/').at(-1);const bytes=await readFile(`dist/assets/${file}`);assert.equal(sha(bytes),asset.sha256,'Report refers to a different build');assets.push({file:`assets/${file}`,bytes:bytes.length,sha256:asset.sha256});}
const images=[];
const out='docs/research/rimworld/evidence';await mkdir(`${out}/voxel`,{recursive:true});
const engine=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await engine.newPage();
  for(const [source,name]of [['03-underground-mined','underground'],['06-final-overview','upper-floor']]){
    const path=`test-results/voxel-browser/${source}.png`,bytes=await readFile(path);
    // Compression only; the complete reviewed game viewport is retained.
    const jpg=await page.evaluate(async encoded=>{const img=new Image();img.src='data:image/png;base64,'+encoded;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/jpeg',.83).split(',')[1];},bytes.toString('base64'));
    const output=Buffer.from(jpg,'base64');await writeFile(`${out}/voxel/${name}.jpg`,output);images.push({file:`voxel/${name}.jpg`,sha256:sha(output),source:path,sourceSha256:sha(bytes),transform:'JPEG quality 0.83, no crop, full game viewport'});
  }
}finally{await engine.close();}
const record={
  generatedAt:new Date().toISOString(),kind:'web-runtime-validated',
  scope:'Emberfield voxel construction slice. These checks do not establish full RimWorld equivalence, 3D survival-system completion, large-map capacity or long-term leak freedom.',
  sources,assets,
  unit:{passed:unit.numPassedTests,total:unit.numTotalTests,failed:unit.numFailedTests},
  campaign:{seed:campaign.seed,scope:campaign.scope,checkpoints:campaign.checkpoints,visitedLayers:campaign.visitedLayers,cargoLayers:campaign.cargoLayers,final:campaign.final},
  browser:{base:browser.base,scope:browser.scope,checks:browser.checks,errors:browser.errors,final:browser.final},
  lifecycle:{base:lifecycle.base,scope:lifecycle.scope,cycles:lifecycle.cycles.length,convergence:lifecycle.convergence,uiControlsChecked:lifecycle.uiChecks.length,uiFailures:lifecycle.uiFailures,browserErrors:lifecycle.browserErrors,mainPageIsolateHeapObservation:lifecycle.mainPageIsolateHeapObservation,finishedAt:lifecycle.finishedAt},
  screenshots:images,
};
await writeFile(`${out}/voxel-implementation-validation.json`,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({status:'recorded',unit:record.unit,browserChecks:browser.checks.length,lifecycleCycles:lifecycle.cycles.length,images:images.map(i=>i.file)},null,2));
