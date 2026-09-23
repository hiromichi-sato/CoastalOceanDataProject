const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const readNC=require('./read-netcdf.cjs');
fs.mkdirSync('artifacts', { recursive: true });
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1366,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',(e)=>errors.push(e.message));
  await page.goto(process.env.APP_URL||'http://localhost:5176');await page.locator('[name=source][value=argo]').waitFor();
  await page.uncheck('[name=source][value=koiki]');await page.check('[name=source][value=argo]');await page.selectOption('#area','custom');
  for(const [name,value] of Object.entries({west:140,east:141,south:30,north:32,start:2018,end:2018,depthMax:20}))await page.fill(`[name=${name}]`,String(value));
  await page.selectOption('#metric','RHO');
  await page.click('#run');await page.waitForFunction(()=>!document.querySelector('#run').disabled,null,{timeout:180000});
  console.log('Argo:',await page.locator('#status').textContent(),await page.locator('#display-error').textContent());
  assert.equal(await page.locator('#nc').isEnabled(),true);assert.ok((await page.locator('#provenance').textContent()).includes('Argo'));
  let pending=page.waitForEvent('download');await page.click('#nc');let download=await pending;await download.saveAs('artifacts/argo-live.nc');
  const nc=readNC(fs.readFileSync('artifacts/argo-live.nc')),meta=JSON.parse(nc.global.processing_metadata);
  assert.deepEqual(meta.query.sources,['argo']);assert.equal(meta.query.argoMode,'adjusted');assert.ok(meta.provenance[0].requests.length);
  await page.screenshot({path:'artifacts/argo-live-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('#map').screenshot({path:'artifacts/argo-live-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.uncheck('[name=source][value=argo]');await page.check('[name=source][value=cchdo]');await page.selectOption('#area','boso-offshore');
  await page.fill('[name=start]','2013');await page.fill('[name=end]','2013');await page.selectOption('#metric','DO');
  await page.click('#run');await page.waitForFunction(()=>!document.querySelector('#run').disabled,null,{timeout:180000});
  console.log('CCHDO:',await page.locator('#status').textContent(),await page.locator('#display-error').textContent());
  assert.equal(await page.locator('#shape').isEnabled(),true);
  pending=page.waitForEvent('download');await page.click('#shape');download=await pending;await download.saveAs('artifacts/cchdo-live.zip');
  assert.deepEqual(errors,[]);console.log('PASS: live Argo density, CCHDO oxygen, exports, mobile, clipping');
 }finally{await browser.close();}
})().catch((e)=>{console.error(e);process.exitCode=1;});
