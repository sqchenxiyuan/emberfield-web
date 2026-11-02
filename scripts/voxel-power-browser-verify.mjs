import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VOXEL_TEST_URL ?? 'http://127.0.0.1:5182/?world=voxel';
const OUT = process.env.VOXEL_POWER_BROWSER_OUT ?? 'test-results/voxel-power-browser';
const FIXTURES = process.env.VOXEL_POWER_CAMPAIGN_OUT ?? 'test-results/voxel-power-campaign';
const MODES = process.env.VOXEL_POWER_MODES?.split(',') ?? ['worker', 'main'];
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const pos = (x,y,z=8) => ({x,y,z});
const names = {generator:'木燃发电机',solar:'太阳能板',battery:'蓄电池',heater:'加热器',cooler:'冷气机'};
const sizes = {generator:[2,2],solar:[4,4],battery:[1,2],heater:[1,1],cooler:[1,1]};
await mkdir(OUT,{recursive:true});
const report = {base:BASE,startedAt:new Date().toISOString(),modes:[],fixtures:{},
  scope:'Real Chrome DOM, mouse, keyboard and file chooser input. window.voxel is read only (project, snapshot, exportSave). Campaign fixtures come from normal designate/step/save work with mined finite resources. Browser construction starts from mined-resources, with no injected devices, resources, fuel, temperature or time. Worker and main fallback, full device footprints, 900x700 scrolling, save/load, live energy consumption and paused pixels.'};
const fixtures = {};
await mkdir(path.join(OUT,'fixtures'),{recursive:true});
for(const name of ['mined-resources','powered-room','cooled-room','final']){
  const file=path.join(FIXTURES,`${name}.json`),bytes=await readFile(file);
  // Freeze the exact bytes read for expectations; a concurrently rerun campaign
  // must not change the subsequent real file-chooser import halfway through a run.
  const importFile=path.join(OUT,'fixtures',`${name}.json`);await writeFile(importFile,bytes);
  fixtures[name]={file:importFile,save:JSON.parse(bytes)};report.fixtures[name]={file,importFile,sha256:digest(bytes),tick:fixtures[name].save.tick};
}
const browser=await chromium.launch({channel:'chrome',headless:true});

async function verifyMode(mode){
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
  const page=await context.newPage(),url=new URL(BASE);
  if(mode==='main')url.searchParams.set('render','main');else url.searchParams.delete('render');
  const result={mode,url:String(url),checks:[],screenshots:[],errors:[],assets:[],workers:[]};report.modes.push(result);
  const assetReads=[];
  page.on('pageerror',e=>result.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')result.errors.push(m.text());});
  page.on('worker',w=>result.workers.push(w.url()));
  page.on('response',response=>{
    const assetUrl=response.url();
    if(!/\.(?:js|css|tsx?|mjs)(?:\?|$)/.test(assetUrl)||result.assets.some(a=>a.url===assetUrl))return;
    const a={url:assetUrl,status:response.status()};result.assets.push(a);
    assetReads.push(response.body().then(async body=>{
      a.sha256=digest(body);a.bytes=body.length;
      if(new URL(assetUrl).pathname.includes('/assets/')){
        a.localFile=path.join('dist','assets',path.basename(new URL(assetUrl).pathname));
        a.localSha256=digest(await readFile(a.localFile));a.matchesLocalBuild=a.sha256===a.localSha256;
      }
    }).catch(e=>{a.error=String(e);}));
  });
  const state=()=>page.evaluate(()=>window.voxel.snapshot());
  const wait=(fn,arg,timeout=35000)=>page.waitForFunction(fn,arg,{timeout});
  const point=p=>page.evaluate(p=>window.voxel.project(p),p);
  const record=(name,data={})=>{result.checks.push({name,...data});console.log('PASS',mode,name,JSON.stringify(data));};
  const screenshot=async name=>{const file=path.join(OUT,`${mode}-${name}.png`);await page.screenshot({path:file});result.screenshots.push(file);};
  async function control(name){const button=page.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();await button.click();}
  async function pause(){await control('暂停');await wait(()=>window.voxel.snapshot().snapshot.speed===0);}
  async function run(){await control('3倍速');await wait(()=>window.voxel.snapshot().snapshot.speed===3);}
  async function click(p){const q=await point(p);await page.mouse.click(q.x,q.y);}
  async function layer(z){await control(z===5?'地下':z===8?'地表':'二层');await wait(z=>window.voxel.snapshot().metrics.level===z&&window.voxel.snapshot().metrics.pendingChunks===0,z);}
  async function inspect(p,anchor={...p,z:Math.floor(p.z)}){
    await control('查看');await click(p);
    await wait(p=>{const a=window.voxel.snapshot().selected;return a?.x===p.x&&a?.y===p.y&&a?.z===p.z;},anchor,5000);
  }
  async function selectDevice(d){await layer(d.z);await inspect({...d,z:d.z+({generator:.85,solar:1.5,battery:1.15,heater:.65,cooler:1.7}[d.kind])},pos(d.x,d.y,d.z));await page.getByTestId('device-detail').waitFor();}
  async function toggle(d,on){await selectDevice(d);const actual=(await state()).snapshot.devices.find(v=>v.id===d.id);if(actual.on!==on)await control(on?'开启设备':'关闭设备');await wait(({id,on})=>window.voxel.snapshot().snapshot.devices.find(d=>d.id===id)?.on===on,{id:d.id,on});}
  async function target(d,value){await selectDevice(d);await page.getByLabel('目标温度',{exact:true}).selectOption(String(value));await wait(({id,value})=>window.voxel.snapshot().snapshot.devices.find(d=>d.id===id)?.target===value,{id:d.id,value});}
  async function importFixture(name){
    const fixture=fixtures[name];await control('菜单与存档');const chooser=page.waitForEvent('filechooser');await control('导入体素存档');await(await chooser).setFiles(path.resolve(fixture.file));
    await wait(tick=>window.voxel.snapshot().snapshot.tick===tick&&window.voxel.snapshot().snapshot.speed===0,fixture.save.tick);await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForTimeout(300);
  }
  async function reachable(locator,name){
    await locator.scrollIntoViewIfNeeded();const data=await locator.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,top=document.elementFromPoint(x,y);return{x,y,width:r.width,height:r.height,viewport:[innerWidth,innerHeight],hit:top===el||el.contains(top)};});
    assert.ok(data.hit&&data.x>=0&&data.y>=0&&data.x<data.viewport[0]&&data.y<data.viewport[1],`${name} unreachable ${JSON.stringify(data)}`);return{name,...data};
  }
  async function pixels(a,b){return page.evaluate(async buffers=>{
    const images=await Promise.all(buffers.map(base64=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.src='data:image/png;base64,'+base64;})));
    const rows=images.map(img=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,c.width,c.height).data;});
    let changed=0,overTwo=0,maxDelta=0;for(let i=0;i<rows[0].length;i+=4){let delta=0;for(let c=0;c<3;c++)delta=Math.max(delta,Math.abs(rows[0][i+c]-rows[1][i+c]));if(delta)changed++;if(delta>2)overTwo++;maxDelta=Math.max(maxDelta,delta);}return{changed,overTwo,maxDelta};
  },[a.toString('base64'),b.toString('base64')]);}
  try{
    await page.goto(String(url));await wait(()=>window.voxel?.snapshot().ready&&window.voxel.snapshot().metrics.pendingChunks===0);
    await pause();await control('收起指引');assert.equal((await state()).worker,mode==='worker');record('expected renderer backend',{worker:(await state()).worker});

    await importFixture('mined-resources');await layer(8);
    const before=(await state()).snapshot;
    await control('蓄电池');const originalAxis=(await state()).axis;await page.keyboard.press('r');await wait(axis=>window.voxel.snapshot().axis!==axis,originalAxis);
    const rotated=(await state()).axis;await click(pos(36,28));await wait(axis=>window.voxel.snapshot().snapshot.jobs.some(j=>j.kind==='battery'&&j.x===36&&j.y===28&&j.axis===axis),rotated);
    const blueprint=(await state()).snapshot.jobs.find(j=>j.kind==='battery');await screenshot('01-rotated-battery-blueprint');
    await control('取消规划');await click(pos(36,28));await wait(()=>!window.voxel.snapshot().snapshot.jobs.some(j=>j.kind==='battery'));
    record('R rotates a real battery blueprint and mouse cancellation removes it',{originalAxis,rotated,blueprint});
    await control('加热器');await click(pos(31,28));await wait(()=>window.voxel.snapshot().snapshot.jobs.some(j=>j.kind==='heater'&&j.x===31&&j.y===28));
    await control('电线');const start=await point(pos(32,29)),end=await point(pos(33,29));await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();
    await wait(()=>window.voxel.snapshot().snapshot.jobs.filter(j=>j.kind==='wire').length===2);await run();
    await wait(()=>{const s=window.voxel.snapshot().snapshot;return s.devices.some(d=>d.kind==='heater'&&d.x===31&&d.y===28)&&s.wires.some(p=>p.x===32&&p.y===29&&p.z===8)&&s.wires.some(p=>p.x===33&&p.y===29&&p.z===8);},undefined,60000);await pause();
    const built=(await state()).snapshot;assert.equal(built.stats.consumed.steel-before.stats.consumed.steel,52);assert.equal(built.stats.consumed.components-before.stats.consumed.components,1);
    const builtHeater=built.devices.find(d=>d.kind==='heater');await selectDevice(builtHeater);assert.match(await page.getByTestId('device-detail').innerText(),/未供电|电力不足/);await screenshot('02-normal-browser-construction');
    record('normal colonist work builds mouse-placed heater and dragged wires from finite mined resources',{elapsed:built.tick-before.tick,steel:52,components:1,device:builtHeater,wires:built.wires});

    await importFixture('powered-room');const powered=(await state()).snapshot;
    const inspected=[];
    for(const d of powered.devices){
      await layer(d.z);const [w,h]=sizes[d.kind];
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const cell=pos(d.x+(d.axis==='x'?x:y),d.y+(d.axis==='x'?y:x),d.z);
        const height=d.kind==='solar'?1.145-(y+.5-2)*Math.sin(.22):({generator:.85,battery:1.15,heater:.65,cooler:1.7}[d.kind]);
        await inspect({...cell,z:cell.z+height},pos(d.x,d.y,d.z));
        assert.equal(await page.getByTestId('device-detail').count(),1);assert.match(await page.getByTestId('voxel-inspector').innerText(),new RegExp(names[d.kind]));inspected.push({kind:d.kind,cell});
      }
      await toggle(d,false);await toggle(d,true);if(!d.on)await toggle(d,false);
    }
    assert.equal(inspected.length,24);record('all 24 occupied device cells inspect their anchors and every device toggles through DOM',{inspected});
    const heater=powered.devices.find(d=>d.kind==='heater'),cooler=powered.devices.find(d=>d.kind==='cooler'),battery=powered.devices.find(d=>d.kind==='battery'),generator=powered.devices.find(d=>d.kind==='generator');
    await target(heater,28);await target(cooler,-8);await selectDevice(cooler);assert.match(await page.getByTestId('device-detail').innerText(),/X− 制冷.*X\+\s*排热/s);
    record('heater and cooler DOM target controls update simulation, cooler displays both directional faces',{heater:28,cooler:-8});
    await selectDevice(generator);const fuelText=await page.getByTestId('device-detail').innerText();assert.match(fuelText,/木燃料 .*75.*每日消耗 22/s);assert.match(fuelText,/电网发电/);
    await selectDevice(battery);const batteryText=await page.getByTestId('device-detail').innerText();assert.match(batteryText,/600 Wd.*充电效率 50%.*自耗 5 W/s);const bar=page.getByRole('progressbar',{name:'电池储能'});assert.equal(await bar.getAttribute('max'),'600');assert.ok(Math.abs(Number(await bar.getAttribute('value'))-battery.energy)<1e-6);
    const pausedNetwork=(await state()).snapshot.networks.find(n=>n.id===battery.networkId);assert.equal(pausedNetwork.capacityWd,600);assert.ok(Math.abs(pausedNetwork.storedWd-battery.energy)<1e-6);assert.match(batteryText,new RegExp(`储能 ${battery.energy.toFixed(1)} / 600 Wd`));
    record('fuel, battery storage and network budgets are visible',{fuelText,batteryText});await screenshot('03-battery-network');

    await importFixture('cooled-room');await layer(5);
    await inspect(pos(36,29,5));const coldText=await page.locator('.voxel-room-detail').innerText();assert.match(coldText,/封闭房间/);
    await inspect(pos(39,29,5));const hotText=await page.locator('.voxel-room-detail').innerText();assert.match(hotText,/封闭房间/);
    const temperature=text=>Number(text.match(/(-?\d+(?:\.\d+)?)\s*°C/)[1]);assert.ok(temperature(coldText)<11);assert.ok(temperature(hotText)>60);
    record('two enclosed rooms display distinct cold-side and exhaust temperatures',{coldText,hotText});await screenshot('04-two-room-temperatures');
    const cooled=(await state()).snapshot,coldDevice=cooled.devices.find(d=>d.kind==='cooler');
    await target(coldDevice,-7);
    const saveBefore=await page.evaluate(()=>window.voxel.exportSave());await writeFile(path.join(OUT,`${mode}-saved-power.json`),JSON.stringify(saveBefore));
    await control('菜单与存档');await control('保存营地');await page.getByText('手动保存成功',{exact:true}).waitFor();await control('关闭菜单');await target(coldDevice,10);await toggle(coldDevice,false);
    await control('菜单与存档');await control('读取营地');await page.getByRole('dialog').waitFor({state:'hidden'});await wait(id=>window.voxel.snapshot().snapshot.devices.find(d=>d.id===id)?.target===-7,coldDevice.id);
    const savedAfter=await page.evaluate(()=>window.voxel.exportSave());const stableDevice=d=>[d.id,d.kind,d.axis,d.on,d.target,d.fuel,d.energy];
    assert.equal(savedAfter.tick,saveBefore.tick);assert.deepEqual(savedAfter.devices.map(stableDevice),saveBefore.devices.map(stableDevice));assert.deepEqual(savedAfter.wires,saveBefore.wires);assert.deepEqual(savedAfter.thermal,saveBefore.thermal);
    record('DOM manual save/load exactly restores fuel, energy, switches, targets, wires and room temperatures',{tick:savedAfter.tick,sha256:digest(saveBefore),thermal:savedAfter.thermal});

    await page.setViewportSize({width:900,height:700});await page.waitForTimeout(300);const controls=[];
    for(const name of [...Object.values(names),'电线','暂停','3倍速','菜单与存档'])controls.push(await reachable(page.getByRole('button',{name,exact:true}),name));
    await control('蓄电池');controls.push(await reachable(page.getByRole('button',{name:'旋转建造朝向',exact:true}),'旋转建造朝向'));
    for(const d of [heater,coldDevice]){
      await selectDevice(d);controls.push(await reachable(page.getByLabel('目标温度',{exact:true}),`${d.kind}目标温度`));
      controls.push(await reachable(page.getByTestId('device-detail').getByRole('button'),`${d.kind}开关`));
    }
    await selectDevice(battery);controls.push(await reachable(page.getByRole('progressbar',{name:'电池储能'}),'电池储能'));await screenshot('05-battery-900');
    await selectDevice(generator);controls.push(await reachable(page.getByTestId('device-detail').getByRole('button'),'发电机开关'));await screenshot('06-generator-900');
    record('900x700 new toolbar tools and inspector controls are reachable by actual scrolling',{controls});

    // Loading clears transient powered/active flags. Resume normally before testing
    // paused air effects, so the pixel test actually includes a running cooler.
    await run();await wait(id=>window.voxel.snapshot().snapshot.devices.find(d=>d.id===id)?.active,coldDevice.id);await pause();
    const pausedTick=(await state()).snapshot.tick;
    await page.setViewportSize({width:1280,height:800});await selectDevice(coldDevice);await control('⌖ 对焦此处');
    const focusPoint=await point({...coldDevice,z:coldDevice.z+1});await page.mouse.move(focusPoint.x,focusPoint.y);await page.mouse.wheel(0,-550);await page.waitForTimeout(450);await page.mouse.move(5,2);
    const center=await point({...coldDevice,z:coldDevice.z+1}),clip={x:Math.floor(center.x-100),y:Math.floor(center.y-100),width:200,height:200};
    const a=await page.screenshot({clip});await page.waitForTimeout(650);const b=await page.screenshot({clip});await writeFile(path.join(OUT,`${mode}-paused-a.png`),a);await writeFile(path.join(OUT,`${mode}-paused-b.png`),b);
    const diff=await pixels(a,b);assert.equal(diff.overTwo,0);assert.equal((await state()).snapshot.tick,pausedTick);assert.ok((await state()).snapshot.devices.find(d=>d.id===coldDevice.id).active);record('paused cooler body and active air effects do not drift',{diff,clip,tick:pausedTick});
    const liveBefore=(await state()).snapshot;await run();await wait(tick=>window.voxel.snapshot().snapshot.tick>=tick+120,liveBefore.tick);await pause();const liveAfter=(await state()).snapshot;
    assert.ok(liveAfter.devices.find(d=>d.id===generator.id).fuel<liveBefore.devices.find(d=>d.id===generator.id).fuel);assert.ok(liveAfter.devices.find(d=>d.id===battery.id).energy>liveBefore.devices.find(d=>d.id===battery.id).energy);assert.ok(liveAfter.devices.find(d=>d.id===cooler.id).powered);
    record('resuming normal browser simulation consumes fuel and charges the battery while cooling',{elapsed:liveAfter.tick-liveBefore.tick,before:liveBefore.devices.map(stableDevice),after:liveAfter.devices.map(stableDevice)});

    await importFixture('final');await page.getByTitle('返回营地',{exact:true}).click();await selectDevice(fixtures.final.save.devices.find(d=>d.kind==='solar'));
    const finalSave=await page.evaluate(()=>window.voxel.exportSave());assert.deepEqual(finalSave.devices.map(stableDevice),fixtures.final.save.devices.map(stableDevice));assert.deepEqual(finalSave.thermal,fixtures.final.save.thermal);await screenshot('07-final-campaign');
    record('final normal campaign imports through the file chooser without changing physical energy state',{tick:finalSave.tick,sha256:report.fixtures.final.sha256});
    await Promise.all(assetReads);const builtAssets=result.assets.filter(a=>a.localFile);if(builtAssets.length)assert.ok(builtAssets.every(a=>a.matchesLocalBuild),'served assets differ from dist');assert.deepEqual(result.errors,[]);
    result.status='passed';result.final={worker:(await state()).worker,metrics:(await state()).metrics,tick:(await state()).snapshot.tick};
  }catch(error){result.status='failed';result.errors.push(String(error.stack??error));await screenshot('failure').catch(()=>{});await writeFile(path.join(OUT,`${mode}-failed-state.json`),JSON.stringify(await page.evaluate(()=>window.voxel?.exportSave()).catch(()=>null)));throw error;}
  finally{await Promise.all(assetReads);await context.close();}
}
try{
  report.sourceHashes=Object.fromEntries(await Promise.all(['src/voxel/renderer.ts','src/voxel/world.ts','src/voxel/power.ts','src/voxel/main.tsx','src/voxel/client.ts','src/voxel/style.css'].map(async file=>[file,digest(await readFile(file))])));
  for(const mode of MODES)await verifyMode(mode);report.status='passed';
}catch(error){report.status='failed';throw error;}
finally{report.finishedAt=new Date().toISOString();await writeFile(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await browser.close();}
