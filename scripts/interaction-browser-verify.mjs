import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const BASE = process.env.COLONY_TEST_URL ?? 'http://127.0.0.1:5181';
const OUT = 'test-results/interactions';
await mkdir(OUT, { recursive: true });
const bundle = await build({ entryPoints: ['src/sim/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { Simulation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const report = { base: BASE, checks: [], screenshots: [], errors: [], scope: 'Production Chrome UI. Offline version-1 fixtures enter through the real JSON import control; commands, pointer drags and speed use UI. window.ember is read only for assertions.' };
let fixtureTick = 100;
function fixture({ work, inspection = false } = {}) {
  const s = new Simulation(73129);
  s.world.terrain.fill(0); s.world.zones.fill(0); s.world.nature=[]; s.world.crops=[];
  s.world.buildings=[]; s.world.items=[]; s.world.tick=fixtureTick++;
  s.world.nextRaid=1200000; s.world.nextWeather=1200000; s.world.autoPause=false;
  const colonists=s.world.pawns.filter(p=>!p.animal&&!p.enemy);
  for (let i=0;i<colonists.length;i++) {
    const p=colonists[i]; p.x=work ? 38+i*2 : 42+i*2; p.y=47;
    p.job=null; p.waitUntil=0; p.food=1;p.rest=100;p.joy=100;p.drafted=false;
    for (const k of Object.keys(p.priorities)) p.priorities[k]=work===k && i===0 ? 1 : 0;
  }
  const animal=s.world.pawns.find(p=>p.animal); animal.x=48;animal.y=44;animal.job=null;animal.waitUntil=0;
  s.world.pawns=[...colonists,animal];
  if (inspection) {
    const enemy=structuredClone(colonists[0]);enemy.id=s.world.nextId++;enemy.name='测试袭击者';enemy.enemy=true;enemy.x=50;enemy.y=44;
    s.world.pawns.push(enemy);
  }
  s.addItem('wood',180,38,46);s.addItem('steel',100,39,46);s.addItem('ration',20,40,46);
  if (inspection) for (const [kind,x] of [['tree',40],['ore',42],['berry',44],['rock',46]])
    s.world.nature.push({id:s.world.nextId++,kind,x,y:44,amount:25,marked:false});
  if (work==='mine'||work==='cut') s.world.nature.push({id:s.world.nextId++,kind:work==='mine'?'ore':'tree',x:43,y:47,amount:25,marked:false});
  s.rebuildNav();return s;
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
page.on('pageerror', e=>report.errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
const record=(name,data={})=>{report.checks.push({name,...data});console.log('PASS',name,JSON.stringify(data));};
const snapshot=()=>page.evaluate(()=>window.ember.snapshot());
const exported=()=>page.evaluate(()=>window.ember.exportSave());
const wait=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:15000});
const pause=async()=>{await page.getByRole('button',{name:'暂停',exact:true}).click();await wait(()=>window.ember.snapshot().speed===0);};
const point=async(x,y)=>{const r=await page.locator('canvas').boundingBox();return {x:r.x+r.width/2+(x+0.5-45)*32*.92,y:r.y+r.height/2+(y+0.5-47)*32*.92};};
const click=async(x,y,button='left')=>{const p=await point(x,y);await page.mouse.click(p.x,p.y,{button});};
const dragStart=async(x,y,x2,y2)=>{const a=await point(x,y),b=await point(x2,y2);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:10});};
const drag=async(...coords)=>{await dragStart(...coords);await page.mouse.up();};
const screen=async(name)=>{const path=`${OUT}/${name}.png`;await page.screenshot({path});report.screenshots.push(path);};
const select=async()=>page.getByTitle('选择',{exact:true}).click();
async function loadFixture(s) {
  await pause();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'菜单与存档',exact:true}).click();
  const data=s.save();
  await page.locator('input[type=file]').setInputFiles({name:'interaction-fixture-v1.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await wait(t=>window.ember.snapshot().summary.tick===t,data.tick);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByTitle('返回营地',{exact:true}).click();await select();await page.waitForTimeout(250);
}
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
try {
  await page.goto(BASE);await wait(()=>window.ember?.snapshot().ready);
  await page.getByRole('button',{name:'建立我们的营地'}).click();await pause();
  const inspectWorld=fixture({inspection:true});await loadFixture(inspectWorld);
  const ration=inspectWorld.world.items.find(i=>i.kind==='ration');
  await click(40,46);await wait(id=>window.ember.snapshot().inspection?.id===id,ration.id);
  assert.equal((await snapshot()).inspection.kind,'item');await screen('01-item-inspector');
  await page.keyboard.press('Escape');await click(48,44);
  await wait(()=>window.ember.snapshot().inspection?.kind==='pawn'&&window.ember.snapshot().inspection.value.animal);
  assert.equal((await snapshot()).selection.length,0);
  const animalId=(await snapshot()).inspection.id;
  await page.keyboard.press('r');await click(51,46,'right');await page.waitForTimeout(250);
  assert.equal((await exported()).pawns.find(p=>p.id===animalId).drafted,false);
  assert.equal((await exported()).pawns.find(p=>p.id===animalId).job,null);
  await screen('02-animal-inspector');
  await page.getByRole('button',{name:'1倍速',exact:true}).click();
  await wait(id=>{const d=window.ember.snapshot().inspection;return d?.id===id&&d.value.job?.path.length>0;},animalId);
  const moving=(await snapshot()).inspection.value;
  await page.waitForTimeout(450);const moved=(await snapshot()).inspection.value;
  assert.notEqual(`${moving.x},${moving.y}`,`${moved.x},${moved.y}`);await pause();
  record('animal inspection updates live; R/right-click grant no animal control');
  await loadFixture(inspectWorld);
  await click(50,44);await wait(()=>window.ember.snapshot().inspection?.kind==='pawn'&&window.ember.snapshot().inspection.value.enemy);
  assert.equal((await snapshot()).selection.length,0);assert.equal(await page.getByRole('button',{name:/^⚑ 征召/}).count(),0);
  await screen('03-enemy-inspector');
  await page.keyboard.press('Escape');await click(40,44);
  await wait(()=>window.ember.snapshot().inspection?.kind==='nature');
  assert.equal((await snapshot()).inspection.value.amount,25);await screen('04-resource-inspector');
  await page.keyboard.press('Escape');await drag(41,43,51,49);
  await wait(()=>window.ember.snapshot().selection.length===3);
  assert.equal((await snapshot()).selection.length,3);
  assert.ok((await snapshot()).selection.every(id=>inspectWorld.world.pawns.some(p=>p.id===id&&!p.enemy&&!p.animal)));
  record('single-click items, animals, enemies, resource nodes; box-select remains colonist-only');

  await loadFixture(fixture());
  await page.getByTitle('建造',{exact:true}).click();await page.locator('.build-items button').filter({hasText:'木墙'}).click();
  await dragStart(39,42,44,43);
  await wait(()=>window.ember.snapshot().preview?.cells.length===6);
  const preview=(await snapshot()).preview;assert.equal(preview.ok,true);assert.equal(preview.cost.wood,30);assert.ok(preview.cells.every(c=>c.y===42));
  await screen('05-wall-line-preview');await page.mouse.up();
  await wait(()=>window.ember.snapshot().summary.buildings.length===6);
  await dragStart(40,42,44,42);await wait(()=>window.ember.snapshot().preview?.ok===false);
  await screen('06-invalid-overlap-preview');await page.mouse.up();await page.waitForTimeout(250);
  assert.equal((await snapshot()).summary.buildings.length,6);
  await page.getByRole('status').filter({hasText:'整段未放置'}).waitFor({state:'hidden'});
  await drag(39,43,39,45);await wait(()=>window.ember.snapshot().summary.buildings.length===9);
  await drag(39,46,44,46);await wait(()=>window.ember.snapshot().summary.buildings.length===15);
  await dragStart(44,43,44,45);
  await wait(()=>window.ember.snapshot().preview?.warnings.some(w=>w.includes('封闭通路')));
  assert.equal((await snapshot()).preview.ok,true);
  assert.ok((await snapshot()).preview.cells.every(c=>c.valid));
  await page.getByLabel('建造预览',{exact:true}).getByText(/建议预留门口.*仍可规划/).waitFor();
  await screen('07-enclosure-warning');await page.mouse.up();
  await wait(()=>window.ember.snapshot().summary.buildings.length===18);
  assert.ok((await snapshot()).summary.buildings.every(b=>b.kind==='wall'));
  await select();await screen('07b-enclosure-planned');
  record('wall line snaps to axis, previews exact costs and rejects overlap atomically');
  record('four walls enclose an empty room: clear doorway warning remains non-blocking');

  // Unlock through an offline saved research result, then use the actual architect controls.
  const wires=fixture();const defs=await build({entryPoints:['src/sim/defs.ts'],bundle:true,platform:'node',format:'esm',write:false});
  const {BUILDINGS,TECHS}=await import(`data:text/javascript;base64,${Buffer.from(defs.outputFiles[0].text).toString('base64')}`);
  const tech=BUILDINGS.wire.tech;if(tech)wires.world.research[tech]=TECHS[tech].cost;
  await loadFixture(wires);await page.getByTitle('建造',{exact:true}).click();
  await page.getByRole('button',{name:'电力',exact:true}).click();await page.locator('.build-items button').filter({hasText:'导线'}).click();
  await dragStart(49,42,50,46);await wait(()=>window.ember.snapshot().preview?.kind==='wire'&&window.ember.snapshot().preview.cells.length===5);
  await screen('08-conduit-line-preview');await page.mouse.up();await wait(()=>window.ember.snapshot().summary.buildings.length===5);
  assert.ok((await snapshot()).summary.buildings.every(b=>b.kind==='wire'&&b.x===49));record('conduit vertical drag builds the displayed five cells');
  await click(52,46,'right');
  await wait(()=>window.ember.snapshot().preview===null);
  assert.equal(await page.locator('.build-items').isVisible(),false);
  assert.equal((await snapshot()).summary.buildings.length,5);
  record('right-click exits the architect tool without issuing a movement order');

  for (const work of ['mine','cut','build','grow']) {
    const s=fixture({work});await loadFixture(s);
    if(work==='mine'||work==='cut') {await page.getByTitle(work==='mine'?'采矿':'采集',{exact:true}).click();await click(43,47);}
    if(work==='build') {await page.getByTitle('建造',{exact:true}).click();await page.getByRole('button',{name:'居所',exact:true}).click();await page.locator('.build-items button').filter({hasText:'木墙'}).click();await click(43,47);}
    if(work==='grow') {await page.getByTitle('区域',{exact:true}).click();await page.locator('.zone-palette button').filter({hasText:'谷物田'}).click();await click(43,47);}
    await select();await page.getByRole('button',{name:'1倍速',exact:true}).click();
    if(work==='mine') {await wait(()=>window.ember.snapshot().summary.pawns[0].job?.path.length>0);await screen('09-walking-without-tool');}
    await wait(k=>{const s=window.ember.snapshot().summary,p=s.pawns[0],j=p.job;return j?.kind===k&&!j.path.length&&(k==='build'?j.stage===2&&s.buildings[0].progress>2:j.progress>2);},work);
    await pause();await page.waitForTimeout(250);await screen(`10-labor-${work}-paused`);
    const frozen=await page.locator('canvas').screenshot();await page.waitForTimeout(450);
    assert.equal(hash(await page.locator('canvas').screenshot()),hash(frozen),`${work} canvas changes while paused`);
    await page.getByRole('button',{name:'1倍速',exact:true}).click();await page.waitForTimeout(300);
    assert.notEqual(hash(await page.locator('canvas').screenshot()),hash(frozen),`${work} canvas fails to advance`);
    await pause();record(`${work} work-site animation advances with simulation and freezes on pause`);
  }
  assert.deepEqual(report.errors,[]);
  record('no browser errors; production render worker active',{metrics:(await snapshot()).metrics});
} catch(e) { report.failure=String(e.stack??e);await screen('failure');throw e; }
finally {await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2));await browser.close();}
