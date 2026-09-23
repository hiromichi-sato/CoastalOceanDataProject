const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
fs.mkdirSync('artifacts', { recursive: true });
const readNC=require('./read-netcdf.cjs');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
    const errors=[];page.on('pageerror',(e)=>errors.push(e.message));
    await page.goto(process.env.APP_URL||'http://localhost:5175');
    await page.locator('#metric option').nth(20).waitFor({state:'attached'});
    await page.selectOption('#season','summer');
    await page.click('#run');
    await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('表示完了') || (!document.querySelector('#run').disabled && !document.querySelector('#status').textContent.startsWith('条件')),null,{timeout:120000});
    console.log('STATUS',await page.locator('#status').textContent());
    console.log('DISPLAY',await page.locator('#display-error').textContent());
    console.log('ERRORS',errors);
    assert.equal(await page.locator('#nc').isEnabled(),true);
    assert.ok(await page.locator('#map path').count()>5);
    await page.locator('#minimum').fill('20');await page.locator('#minimum').dispatchEvent('change');
    await page.locator('#maximum').fill('32');await page.locator('#maximum').dispatchEvent('change');
    await page.locator('#interval').fill('1');await page.locator('#interval').dispatchEvent('change');
    for(const kind of ['lines','filled','points','both']){await page.selectOption('#kind',kind);assert.equal(await page.locator('#display-error').textContent(),'');}
    await page.screenshot({path:'artifacts/research-desktop.png',fullPage:true});
    for(const format of ['nc','shape','csv']){
      const pending=page.waitForEvent('download');await page.click('#'+format);const download=await pending;
      await download.saveAs('artifacts/research-'+download.suggestedFilename());
      if(format==='nc'){
        const nc=readNC(fs.readFileSync('artifacts/research-'+download.suggestedFilename()));
        const meta=JSON.parse(nc.global.processing_metadata);
        assert.equal(meta.query.start,2010);assert.equal(meta.query.end,2018);assert.deepEqual(meta.query.months,[6,7,8]);
        assert.ok(meta.interpolation.includes('diffusion'));assert.ok(meta.grid.residual<1e-7);
        const field=nc.variables.find((v)=>v.name==='value'),fixed=nc.variables.find((v)=>v.name==='fixed_value');
        fixed.values.forEach((v,i)=>{if(v!==fixed.attrs._FillValue)assert.equal(field.values[i],v);});
        assert.equal(nc.dimensions[0].size*nc.dimensions[1].size,field.values.length);
      }
    }
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('#map').screenshot({path:'artifacts/research-map-mobile.png'});
    await page.selectOption('#metric','RHO');await page.click('#run');
    await page.waitForFunction(()=>!document.querySelector('#run').disabled,null,{timeout:120000});
    assert.equal(await page.locator('#nc').isEnabled(),true);
    assert.ok((await page.locator('#legend').textContent()).includes('kg m-3'));
    await page.selectOption('#source-view','koiki');
    await page.waitForFunction(()=>document.querySelector('#nc').disabled===false,null,{timeout:120000});
    await page.selectOption('#resolution','96');
    await page.waitForFunction(()=>document.querySelector('#nc').disabled===false,null,{timeout:120000});
    await page.locator('#minimum').fill('9999');await page.locator('#maximum').fill('0');await page.locator('#maximum').dispatchEvent('change');
    assert.equal(await page.locator('#nc').isEnabled(),false);assert.ok((await page.locator('#display-error').textContent()).length);
    await page.selectOption('#metric','COD');await page.selectOption('[name=basis]','fiscal');await page.selectOption('#season','all');await page.check('[name=source][value=kosui]');
    await page.click('#run');await page.waitForFunction(()=>!document.querySelector('#run').disabled,null,{timeout:120000});
    assert.equal(await page.locator('#nc').isEnabled(),true);
    await page.selectOption('#source-view','kosui');await page.waitForFunction(()=>document.querySelector('#nc').disabled===false,null,{timeout:120000});
    await page.screenshot({path:'artifacts/research-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: live multi-year summer temperature/density, range/type, exports, source selection, mobile');
  }finally{await browser.close();}
})().catch((e)=>{console.error(e);process.exitCode=1;});
