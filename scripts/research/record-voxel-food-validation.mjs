// Run after the final build and matching unit/campaign/browser/lifecycle reports.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const json = async p => JSON.parse(await readFile(p,'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const unit = await json('test-results/unit-report.json');
const campaign = await json('test-results/voxel-food-campaign/report.json');
const browser = await json('test-results/voxel-food-browser/report.json');
const construction = await json('test-results/voxel-browser/report.json');
const lifecycle = await json('test-results/voxel-lifecycle/report.json');
assert.equal(unit.success,true);
for(const r of [campaign,browser,construction,lifecycle]) assert.equal(r.status,'passed');
assert.deepEqual(browser.errors,[]); assert.deepEqual(construction.errors,[]); assert.deepEqual(lifecycle.browserErrors,[]);
const sources = [];
for(const file of (await readdir('src/voxel')).sort()) sources.push({file:`src/voxel/${file}`,sha256:sha(await readFile(`src/voxel/${file}`))});
const assets = [];
assert(browser.assets?.length > 0,'Food browser must bind the served production assets');
for(const item of browser.assets) {
  const file = new URL(item.url).pathname.split('/').at(-1);
  const bytes = await readFile(`dist/assets/${file}`);
  assert.equal(sha(bytes),item.sha256,'Food report/build mismatch');
  assets.push({file:`assets/${file}`,bytes:bytes.length,sha256:item.sha256});
}
for(const item of lifecycle.assetDigests) {
  const file = new URL(item.url).pathname.split('/').at(-1);
  assert.equal(sha(await readFile(`dist/assets/${file}`)),item.sha256,'Lifecycle report/build mismatch');
}
const images = [], out='docs/research/rimworld/evidence';
await mkdir(`${out}/voxel`,{recursive:true});
const engine = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await engine.newPage();
  for(const [source,name] of [['02-near-harvest-import','farm-harvest'],['05-upper-kitchen-1280','upper-kitchen']]) {
    const file = `test-results/voxel-food-browser/${source}.png`, bytes = await readFile(file);
    const encoded = await page.evaluate(async png => {
      const img = new Image(); img.src='data:image/png;base64,'+png; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height;
      canvas.getContext('2d').drawImage(img,0,0); return canvas.toDataURL('image/jpeg',.83).split(',')[1];
    },bytes.toString('base64'));
    const output = Buffer.from(encoded,'base64'); await writeFile(`${out}/voxel/${name}.jpg`,output);
    images.push({file:`voxel/${name}.jpg`,sha256:sha(output),source:file,sourceSha256:sha(bytes),transform:'Full reviewed gameplay viewport; JPEG quality .83, no crop'});
  }
} finally {await engine.close();}
const record = {
  generatedAt:new Date().toISOString(),kind:'web-runtime-validated',
  scope:'Emberfield voxel food milestone; not original RimWorld runtime evidence, full mechanics equivalence, indefinite colony survival or a large-population memory capacity claim.',
  sources,assets,
  unit:{passed:unit.numPassedTests,total:unit.numTotalTests,failed:unit.numFailedTests},
  campaign:{seed:campaign.seed,scope:campaign.scope,checkpoints:campaign.checkpoints,final:campaign.final},
  browser:{base:browser.base,scope:browser.scope,checks:browser.checks,fixtures:browser.fixtures,errors:browser.errors,final:browser.final},
  regressions:{construction:{base:construction.base,checks:construction.checks,errors:construction.errors},
    emptyWorldLifecycle:{base:lifecycle.base,scope:lifecycle.scope,cycles:lifecycle.cycles.length,convergence:lifecycle.convergence,uiControlsChecked:lifecycle.uiChecks.length,errors:lifecycle.browserErrors}},
  screenshots:images,
};
await writeFile(`${out}/voxel-food-validation.json`,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({status:'recorded',unit:record.unit,foodBrowserChecks:browser.checks.length,images:images.map(i=>i.file)},null,2));
