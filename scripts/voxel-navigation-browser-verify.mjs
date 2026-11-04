import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const BASE=process.env.VOXEL_TEST_URL??'http://127.0.0.1:4196/?world=voxel';
const OUT='test-results/voxel-navigation-browser',INPUT='test-results/voxel-navigation-campaign';
await mkdir(OUT,{recursive:true});
const campaign=JSON.parse(await readFile(`${INPUT}/report.json`,'utf8')),id=campaign.pawnId;
const hash=b=>createHash('sha256').update(b).digest('hex'),at=p=>(p.z*64+p.y)*64+p.x;
const report={base:BASE,scope:'Chrome UI/file imports only; read-only bridge observations. Ordinary-command constructed shelf checkpoint. Both renderer modes.',modes:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const mode of ['worker','main']){
  const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage();
  const r={mode,checks:[],errors:[],assets:[],screenshots:[]},reads=[];report.modes.push(r);
  page.on('pageerror',e=>r.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')r.errors.push(m.text());});
  page.on('response',response=>{if(!/\/assets\/.*\.(js|css)$/.test(new URL(response.url()).pathname))return;
    reads.push(response.body().then(async b=>r.assets.push({url:response.url(),status:response.status(),sha256:hash(b),matchesLocalBuild:hash(b)===hash(await readFile('dist/assets/'+path.basename(new URL(response.url()).pathname)))})));});
  const state=()=>page.evaluate(()=>window.voxel.snapshot()),wait=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:30000});
  const click=async name=>{const button=page.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();await button.click();};
  const check=name=>{r.checks.push(name);console.log('PASS',mode,name);};
  async function shot(name){const file=`${OUT}/${mode}-${name}.png`;await page.screenshot({path:file});r.screenshots.push(file);}
  async function load(file){await page.keyboard.press('Escape');await click('菜单与存档');const chooser=page.waitForEvent('filechooser');await click('导入体素存档');await(await chooser).setFiles(file);await page.getByRole('button',{name:'关闭菜单',exact:true}).waitFor({state:'hidden'});await wait(()=>window.voxel.snapshot().snapshot.speed===0);await page.waitForTimeout(250);}
  async function arrived(){await wait(({id,to})=>{const p=window.voxel.snapshot().snapshot.pawns.find(p=>p.id===id);return p.x===to.x&&p.y===to.y&&p.z===to.z;},{id,to:campaign.to});await click('暂停');}
  try{
    const url=new URL(BASE);if(mode==='main')url.searchParams.set('render','main');
    await page.goto(url.href);await wait(()=>window.voxel?.snapshot().ready&&!!window.voxel.snapshot().snapshot);await click('暂停');
    if(await page.getByRole('button',{name:'收起指引',exact:true}).isVisible())await click('收起指引');
    assert.equal((await state()).worker,mode==='worker');check('requested renderer active');
    await load(`${INPUT}/before.json`);await page.locator(`[data-colonist-id="${id}"]`).click();await click('查看');await page.waitForTimeout(250);
    const q=await page.evaluate(p=>window.voxel.project(p),campaign.to),box=await page.locator('canvas[aria-label="多层体素地图"]').boundingBox();
    await page.mouse.click(box.x+q.x,box.y+q.y);await wait(p=>{const q=window.voxel.snapshot().selected;return q?.x===p.x&&q.y===p.y&&q.z===p.z;},campaign.to);
    const name=(await state()).snapshot.pawns.find(p=>p.id===id).name;await click(`让 ${name} 前往选中位置`);
    await wait(id=>window.voxel.snapshot().snapshot.pawns.find(p=>p.id===id).path.length>0,id);
    const s=(await state()).snapshot,p=s.pawns.find(p=>p.id===id),shelf=s.shelves.find(s=>s.id===campaign.shelfId);
    const shelfCells=[at(shelf),at({...shelf,x:shelf.x+1})];
    assert.equal(p.path.length,6);assert(p.path.every(n=>!shelfCells.includes(n)));check('mouse and movement button plan an aisle route around the shelf');
    await shot('planned-route');await click('1倍速');await arrived();check('visible simulation follows the order and reaches the other side');
    await load(`${INPUT}/mid.json`);const restored=(await state()).snapshot.pawns.find(p=>p.id===id);
    assert.equal(restored.destination,at(campaign.to));assert(restored.path.every(n=>!shelfCells.includes(n)));await click('1倍速');await arrived();check('mid-trip import preserves destination and resumes movement');
    await page.locator(`[data-colonist-id="${id}"]`).click();await shot('arrival');
    await Promise.all(reads);assert(r.assets.length&&r.assets.every(a=>a.status===200&&a.matchesLocalBuild));assert.deepEqual(r.errors,[]);check('no browser errors and served assets match local build');
  }catch(e){r.failure=e.stack;await shot('failure');throw e;}finally{await context.close();await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2));}
}}finally{await browser.close();}
