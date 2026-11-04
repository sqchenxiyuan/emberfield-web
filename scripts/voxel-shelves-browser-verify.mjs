import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
const BASE=process.env.VOXEL_TEST_URL??'http://127.0.0.1:4196/?world=voxel';
const OUT=process.env.VOXEL_SHELVES_BROWSER_OUT??'test-results/voxel-shelves-browser';
const INPUT=process.env.VOXEL_SHELVES_OUT??'test-results/voxel-shelves-campaign';
await mkdir(OUT,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={base:BASE,scope:'Chrome UI and file chooser mutations only; read-only snapshot/project/exportSave. Current ordinary-play checkpoints. Both Worker and main renderer.',modes:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const mode of ['worker','main']){
  const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1}),page=await context.newPage();
  const result={mode,checks:[],errors:[],screenshots:[],assets:[]},reads=[];report.modes.push(result);
  page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')result.errors.push(m.text());});
  page.on('response',r=>{if(!/\/assets\/.*\.(js|css)$/.test(new URL(r.url()).pathname))return;
    reads.push(r.body().then(async b=>result.assets.push({url:r.url(),status:r.status(),sha256:sha(b),matchesLocalBuild:sha(await readFile('dist/assets/'+path.basename(new URL(r.url()).pathname)))===sha(b)})));});
  const url=new URL(BASE);url.searchParams.set('world','voxel');if(mode==='main')url.searchParams.set('render','main');
  const wait=(f,a,t=60000)=>page.waitForFunction(f,a,{timeout:t}),state=()=>page.evaluate(()=>window.voxel.snapshot());
  const click=async name=>{const b=page.getByRole('button',{name,exact:true});await b.scrollIntoViewIfNeeded();await b.click();};
  const check=name=>{result.checks.push(name);console.log('PASS',mode,name);};
  async function shot(name){const file=`${OUT}/${mode}-${name}.png`;await page.screenshot({path:file});result.screenshots.push(file);}
  async function load(file){await page.keyboard.press('Escape');await click('菜单与存档');const chooser=page.waitForEvent('filechooser');await click('导入体素存档');await(await chooser).setFiles(file);await page.getByRole('button',{name:'关闭菜单',exact:true}).waitFor({state:'hidden'});await wait(()=>window.voxel.snapshot().snapshot.speed===0);await page.waitForTimeout(350);}
  async function point(p){const q=await page.evaluate(p=>window.voxel.project(p),p),box=await page.locator('canvas[aria-label="多层体素地图"]').boundingBox();return{x:box.x+q.x,y:box.y+q.y};}
  async function selectShelf(shelf){const q=await point({...shelf,z:shelf.z+.75});
    for(const [dx,dy] of [[0,0],[0,8],[8,0],[-8,0],[0,-8],[12,8],[-12,8]]){await page.mouse.click(q.x+dx,q.y+dy);await page.waitForTimeout(180);if(await page.getByTestId('shelf-storage').count())return;}
    throw Error('shelf not selectable');}
  try{
    await page.goto(url.href);await wait(()=>window.voxel?.snapshot().ready&&!!window.voxel.snapshot().snapshot);await click('暂停');
    if(await page.getByRole('button',{name:'收起指引',exact:true}).isVisible())await click('收起指引');
    assert.equal((await state()).worker,mode==='worker');check('requested renderer active');
    await load(`${INPUT}/stocked.json`);const shelf=(await state()).snapshot.shelves[0],id=shelf.id;
    await page.mouse.move(700,400);await page.mouse.wheel(0,-350);await page.waitForTimeout(400);
    await selectShelf(shelf);const stacks=await page.getByTestId('shelf-stack').count();assert(stacks>=2);check('visible shelf selectable with distinct stack IDs');
    assert.equal(await page.getByTestId('furniture-quality').count(),0);check('shelf has storage and durability without quality');await shot('stocked-shelf');
    await page.getByLabel('货架优先级',{exact:true}).selectOption('2');await wait(id=>window.voxel.snapshot().snapshot.shelves.find(s=>s.id===id).settings.priority===2,id);
    check('whole shelf priority setting updates');
    const storagePanel=page.getByTestId('shelf-storage');await storagePanel.locator('summary').click();
    const steel=storagePanel.getByRole('checkbox',{name:'钢材',exact:true}),beforeItems=(await state()).snapshot.items;
    const accepted=await steel.isChecked();await steel.click();
    await wait(({id,accepted})=>window.voxel.snapshot().snapshot.shelves.find(s=>s.id===id).settings.accepts.includes('steel')!==accepted,{id,accepted});
    assert.deepEqual((await state()).snapshot.items,beforeItems);await steel.click();await storagePanel.locator('summary').click();
    check('visible filter toggle preserves existing goods');
    await page.getByTestId('furniture-move-target').click();await wait(()=>!!window.voxel.snapshot().furniturePlacement);
    const q=await point({x:shelf.x+4,y:shelf.y,z:shelf.z});await page.mouse.move(q.x,q.y);await page.keyboard.press('r');await page.waitForTimeout(300);
    assert.equal((await state()).furniturePlacement.kind,'shelf');await shot('move-preview');await page.keyboard.press('Escape');await wait(()=>!window.voxel.snapshot().furniturePlacement);check('move preview rotates and cancels');
    await selectShelf(shelf);await page.getByTestId('furniture-uninstall').click();await click('3倍速');
    await wait(id=>!window.voxel.snapshot().snapshot.shelves.some(s=>s.id===id),id);await click('暂停');
    const after=await page.evaluate(()=>window.voxel.exportSave());
    assert([...after.items,...after.pawns.flatMap(p=>p.cargo?[p.cargo]:[]),...after.jobs.flatMap(j=>j.deliveredBatches)].some(b=>b.furniture?.id===id));check('UI uninstall produces original package and leaves goods');
    await load(`${INPUT}/final.json`);await selectShelf((await state()).snapshot.shelves[0]);check('reinstalled shelf and settings survive file import');
    await page.setViewportSize({width:980,height:720});await page.waitForTimeout(350);await shot('compact-layout');
    assert(await page.getByTestId('shelf-storage').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);check('compact layout retains storage controls');
    await load('tests/fixtures/voxel-v36-before-shelves.json');const old=await page.evaluate(()=>window.voxel.exportSave());assert.equal(old.version,37);assert.deepEqual(old.shelves,[]);check('genuine v36 save imports in browser');
    await Promise.all(reads);assert(result.assets.length&&result.assets.every(a=>a.status===200&&a.matchesLocalBuild));assert.deepEqual(result.errors,[]);check('no runtime errors and served assets match local build');
  }catch(e){await shot('failure');result.failure=e.stack;throw e;}finally{await context.close();await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2));}
}}finally{await browser.close();}
