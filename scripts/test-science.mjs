import assert from 'node:assert/strict';
import test from 'node:test';
import '../public/vendor/numeric-1.2.6.min.js';
import { solveDiffusion } from '../public/diffusion.js';
import { density, pressureFromDepth } from '../lib/seawater.js';
import { parseNumber, parseQuery, average, getObservations, queryArcGIS } from '../lib/observations.js';
test('EOS-80 UNESCO reference densities and Saunders pressure',()=>{
  const expected=[999.842594,1045.33710972,995.65113374,1036.03148891,1028.10633141,1070.95838408,1021.72863949,1060.55058771];
  for(let i=0;i<8;i++) assert.ok(Math.abs(density(i<4?0:35,(i%4<2?0:30)/1.00024,i%2?10000:0)-expected[i])<1e-7);
  assert.ok(Math.abs(pressureFromDepth(7321.45,30)-7500.006513011802)<1e-6);
});
test('missing and censored are not zero; valid zero retained',()=>{
  for(const v of [null,undefined,'',' ','-9999']) assert.equal(parseNumber(v).value,null);
  assert.equal(parseNumber(0).value,0);assert.equal(parseNumber('<0.02').value,null);assert.equal(parseNumber('<=0.02','half').value,.01);
});
test('period means balance months then years',()=>{
  const rows=[{year:2010,month:1,value:2},{year:2010,month:1,value:4},{year:2010,month:2,value:9},{year:2018,month:1,value:20}];
  assert.equal(average(rows,'equal-year'),13); assert.equal(average(rows,'sample'),8.75);
  assert.deepEqual(parseQuery(new URLSearchParams('season=winter')).months,[1,2,12]);
  assert.throws(()=>parseQuery(new URLSearchParams('start=2018&end=2010')));
  assert.deepEqual(parseQuery(new URLSearchParams('season=summer&months=5,6,8')).months,[6,8]);
  assert.throws(()=>parseQuery(new URLSearchParams('season=summer&months=12')));
});
const solve=(grid)=>solveDiffusion(grid,globalThis.numeric);
test('steady diffusion reproduces linear solution with zero-flux top/bottom',()=>{
  const cols=9,rows=7,anchors=[];
  for(let y=0;y<rows;y++){anchors.push([y*cols,0],[y*cols+cols-1,8]);}
  const result=solve({cols,rows,water:Array(cols*rows).fill(true),anchors,dx:200,dy:300});
  result.values.forEach((value,i)=>assert.ok(Math.abs(value-i%cols)<1e-9));
  assert.ok(result.residual<1e-9);
});
test('coastal barrier separates solutions; unanchored ocean is missing',()=>{
  const cols=7,rows=5,water=Array.from({length:35},(_,i)=>i%cols!==3);
  const result=solve({cols,rows,water,anchors:[[0,10],[6,20]],dx:1,dy:1});
  result.values.forEach((v,i)=>assert.ok(i%cols===3?v===null:Math.abs(v-(i%cols<3?10:20))<1e-9));
  const one=solve({cols,rows,water,anchors:[[0,10]],dx:1,dy:1});
  assert.equal(one.unconstrainedCells,15);assert.equal(one.values[6],null);
  const constant=solve({cols:5,rows:5,water:Array(25).fill(true),anchors:[[0,.5],[24,.5]],dx:1200,dy:900});
  assert.ok(constant.values.every((v)=>v===.5));
});
test('annual source cannot invent months; temperature missing/depth filter',async()=>{
  const query=parseQuery(new URLSearchParams('metric=TEMP&start=2010&end=2018&season=summer&sources=koiki,kosui'));
  const attrs={objectid:1,zettaicode:'a',longitude:139.8,latitude:35.4,surveyyear:2015,nendo:2015,surveymonth:7,saisuidepth:'0.5',wtemp:'20'};
  const result=await getObservations(query,async()=>({records:[{attributes:attrs},{attributes:{...attrs,objectid:2,wtemp:null}},{attributes:{...attrs,objectid:3,saisuidepth:'10'}}],url:'https://example.test',where:'test'}));
  assert.equal(result.count,1);assert.equal(result.points[0].value,20);assert.equal(result.diagnostics.missing,1);assert.equal(result.diagnostics.depthExcluded,1);assert.ok(result.warnings.length);
});
test('pagination retrieves more than 2000 records',async()=>{
  let calls=0;
  const result=await queryArcGIS('TEST',0,'pagination',null,async()=>({ok:true,json:async()=>({features:Array.from({length:calls++?2:2000},(_,i)=>({attributes:{objectid:(calls-1)*2000+i}})),exceededTransferLimit:calls===1})}));
  assert.equal(result.records.length,2002);assert.equal(calls,2);
});
test('annual records excluded from seasonal queries but available for fiscal years',async()=>{
  const loader=async()=>({records:[{attributes:{objectid:1,zettaicode:'a',longitude:139.8,latitude:35.4,nendo:2011,cod:'2.3'}}],url:'https://example.test',where:'nendo=2011'});
  await assert.rejects(()=>getObservations(parseQuery(new URLSearchParams('metric=COD&sources=kosui&season=summer')),loader));
  const result=await getObservations(parseQuery(new URLSearchParams('metric=COD&sources=kosui&basis=fiscal')),loader);
  assert.equal(result.points[0].value,2.3);assert.equal(result.monthly.length,0);assert.equal(result.yearly[0].year,2011);
});
