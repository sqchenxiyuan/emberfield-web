import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const unit=await json('test-results/unit-report.json');
const campaign=await json('test-results/voxel-power-campaign/report.json');
const browser=await json('test-results/voxel-power-browser/report.json');
const housing=await json('test-results/voxel-housing-campaign/report.json');
const food=await json('test-results/voxel-food-campaign/report.json');
const housingBrowser=await json('test-results/voxel-housing-browser/report.json');
const foodBrowser=await json('test-results/voxel-food-browser/report.json');
assert.equal(unit.success,true);assert.equal(unit.numFailedTests,0);
for(const report of [campaign,browser,housing,food,foodBrowser])assert.equal(report.status,'passed');
assert.equal(housingBrowser.status,'passed-fixtures-only');
assert.deepEqual(foodBrowser.errors,[]);
for(const mode of housingBrowser.modes){assert.equal(mode.status,'passed-fixtures-only');assert.deepEqual(mode.errors,[]);}
assert.deepEqual(campaign.errors,[]);
assert.deepEqual(browser.modes.map(m=>m.mode).sort(),['main','worker']);
for(const [file,hash]of Object.entries(browser.sourceHashes))assert.equal(sha(await readFile(file)),hash,`changed tested source ${file}`);
const sources=[];
for(const file of (await readdir('src/voxel')).sort())sources.push({file:`src/voxel/${file}`,sha256:sha(await readFile(`src/voxel/${file}`))});
const assets=new Map();
for(const asset of [...housingBrowser.modes.flatMap(m=>m.assets),...foodBrowser.assets]){
 const file=`dist/assets/${new URL(asset.url).pathname.split('/').at(-1)}`;
 assert.equal(sha(await readFile(file)),asset.sha256,'regression browser build mismatch');
}
for(const mode of browser.modes){
  assert.equal(mode.status,'passed');assert.deepEqual(mode.errors,[]);
  assert.ok(mode.assets.some(a=>a.localFile),'requires production build');
  for(const item of mode.assets.filter(a=>a.localFile)){
    assert.equal(item.matchesLocalBuild,true);assert.equal(sha(await readFile(item.localFile)),item.sha256);
    assets.set(item.localFile,{file:item.localFile.replace(/^dist[\\/]/,''),sha256:item.sha256,bytes:item.bytes});
  }
}
const out='docs/research/rimworld/evidence';await mkdir(`${out}/voxel`,{recursive:true});
const screenshots=[],engine=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await engine.newPage();
 for(const [source,name]of [['worker-03-battery-network','power-network'],['worker-04-two-room-temperatures','cooler-exhaust-room']]){
  const file=`test-results/voxel-power-browser/${source}.png`,bytes=await readFile(file);
  const b64=await page.evaluate(async raw=>{const img=new Image();img.src='data:image/png;base64,'+raw;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/jpeg',.83).split(',')[1];},bytes.toString('base64'));
  const jpeg=Buffer.from(b64,'base64');await writeFile(`${out}/voxel/${name}.jpg`,jpeg);screenshots.push({file:`voxel/${name}.jpg`,sha256:sha(jpeg),source:file,sourceSha256:sha(bytes),transform:'Full reviewed gameplay viewport, JPEG .83, no crop'});
 }
}finally{await engine.close();}
const record={generatedAt:new Date().toISOString(),kind:'web-runtime-validated',scope:'Emberfield power/thermal milestone. Native mechanism evidence is separately static/XML and one definition UI observation; no native electricity/thermal curve measurement. Node campaigns execute game ticks, not hours of real-time browser play. Unit integration fixtures are explicitly synthetic. Array and renderer counters are not whole-browser/GPU or 4 GiB capacity evidence.',sources,assets:[...assets.values()],
 unit:{passed:unit.numPassedTests,total:unit.numTotalTests,failed:unit.numFailedTests},
 campaign:{scope:campaign.scope,checks:campaign.checks,minimumFood:campaign.minimumFood,final:campaign.final,errors:campaign.errors},
 browser:{base:browser.base,scope:browser.scope,fixtures:browser.fixtures,modes:browser.modes.map(m=>({mode:m.mode,checks:m.checks,errors:m.errors,final:m.final}))},
 regressions:{housing:{scope:housing.scope,checkpoints:housing.checkpoints,final:housing.final},food:{scope:food.scope,final:food.final},housingBrowser:{modes:housingBrowser.modes.map(m=>({mode:m.mode,checks:m.checks,errors:m.errors})),scope:'Fixtures-only regression using freshly generated normal housing campaign saves; no fresh UI housing construction in this milestone regression.'},foodBrowser:{checks:foodBrowser.checks,errors:foodBrowser.errors}},screenshots};
await writeFile(`${out}/voxel-power-validation.json`,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({status:'recorded',unit:record.unit,browserChecks:browser.modes.map(m=>({mode:m.mode,count:m.checks.length})),screenshots:screenshots.map(s=>s.file)},null,2));
