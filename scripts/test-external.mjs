import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseQuery,getObservations} from '../lib/observations.js';
import {selectedArgoValue,normalizeProfiles,readTable,getProfiles} from '../lib/profiles.js';
import {depthFromPressure} from '../lib/seawater.js';
const context={module:{exports:{}}};vm.createContext(context);
vm.runInContext(await readFile(new URL('../public/vendor/clipper.js',import.meta.url),'utf8'),context);
context.ClipperLib=context.module.exports;
vm.runInContext(await readFile(new URL('../public/safe-clipping.js',import.meta.url),'utf8'),context);
const {intersection,difference}=context.AquaClip;
const rect=(x1,y1,x2,y2)=>[[[[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]]]];
const ringArea=(r)=>Math.abs(r.slice(1).reduce((s,p,i)=>s+r[i][0]*p[1]-p[0]*r[i][1],0)/2);
const area=(m)=>m.reduce((sum,p)=>sum+ringArea(p[0])-p.slice(1).reduce((s,r)=>s+ringArea(r),0),0);
test('clipping preserves holes, islands, disjoint and shared edges',()=>{
  const donut=difference(rect(0,0,10,10),rect(2,2,8,8));assert.equal(area(donut),64);assert.equal(donut[0].length,2);
  assert.equal(area(intersection(donut,rect(0,0,5,10))),32);
  assert.equal(area(intersection(rect(0,0,1,1),rect(1,0,2,1))),0);
  assert.equal(area(difference(rect(0,0,10,10),[])),100);
});
test('reported near-zero segment is quantized without sweep-line failure',()=>{
  const x=13.482869855631714,x2=13.48286985563174,y=47.08089301480633;
  const polygon=[[[[x-1,y-1],[x,y],[x2,y],[x+1,y-1],[x-1,y-1]]]];
  for(let i=0;i<100;i++){
    const result=intersection(polygon,rect(x-.5,y-2,x+.5,y+1));
    assert.ok(area(result)>.7&&area(result)<.8);
    const rest=difference(polygon,result);assert.ok(Math.abs(area(rest)+area(result)-1)<1e-6);
  }
});
test('Argo adjusted rejected QC does not fall back to raw',()=>{
  const r={data_mode:'D',temp:10,temp_qc:'1',temp_adjusted:11,temp_adjusted_qc:'3'};
  assert.equal(selectedArgoValue(r,'temp'),null);r.temp_adjusted_qc='1';assert.equal(selectedArgoValue(r,'temp'),11);
  r.data_mode='R';assert.equal(selectedArgoValue(r,'temp'),null);assert.equal(selectedArgoValue(r,'temp','all'),10);
});
const diagnostics=()=>({invalidLocation:0,depthExcluded:0,qcRejected:0,duplicates:0,profileLevels:0});
const row={platform_number:'2903178',cycle_number:1,direction:'A',time:'2018-01-15T00:00:00Z',latitude:31,longitude:140.5,position_qc:'1',time_qc:'1',data_mode:'D',pres_adjusted:5,pres_adjusted_qc:'1',temp_adjusted:10,temp_adjusted_qc:'1',psal_adjusted:35,psal_adjusted_qc:'1'};
test('profiles averaged before spatial/temporal aggregation; moving float has distinct bins',()=>{
  const q=parseQuery(new URLSearchParams('sources=argo&area=custom&start=2018&end=2018&depthMax=20'));
  const d=diagnostics();const records=normalizeProfiles([row,{...row,pres_adjusted:10,temp_adjusted:20},{...row,cycle_number:2,longitude:142}], 'argo',q,d);
  assert.equal(records.length,2);assert.equal(records[0].value,15);assert.notEqual(records[0].station,records[1].station);assert.equal(d.profileLevels,3);
  assert.ok(depthFromPressure(1000,30)>980&&depthFromPressure(1000,30)<1000);
});
test('CCHDO oxygen converts umol/kg to mg/L, not a direct numeric merge',()=>{
  const q=parseQuery(new URLSearchParams('sources=cchdo&area=custom&start=2018&end=2018&depthMax=20&metric=DO'));
  const records=normalizeProfiles([{profile_id:'p1',expocode:'TEST',time:row.time,latitude:31,longitude:140.5,pressure:5,ctd_temperature:10,ctd_temperature_qc:2,ctd_salinity:35,ctd_salinity_qc:2,ctd_oxygen:200,ctd_oxygen_qc:2}],'cchdo',q,diagnostics());
  assert.ok(records[0].value>6.5&&records[0].value<6.7);
});
test('ERDDAP empty response distinguished from server errors',async()=>{
  assert.deepEqual((await readTable('test-empty',async()=>({status:404,ok:false,text:async()=> 'Your query produced no matching results. (nRows = 0)'}))).rows,[]);
  await assert.rejects(()=>readTable('test-failure',async()=>({status:503,ok:false,text:async()=> 'maintenance'})));
});
test('partial failure is explicit, not silently relabelled as full success',async()=>{
  const q=parseQuery(new URLSearchParams('sources=argo,cchdo&area=custom&start=2018&end=2018'));
  const result=await getObservations(q,undefined,async(source)=>{if(source==='argo')throw new Error('maintenance');return{records:[],provenance:{source,url:'https://example.test'}};});
  assert.equal(result.partial,true);assert.equal(result.sourceStatus[0].state,'error');
});
test('wide external requests fail before network access',async()=>{
  const q=parseQuery(new URLSearchParams('sources=argo&start=2000&end=2018'));
  await assert.rejects(()=>getProfiles('argo',q,diagnostics(),()=>{throw new Error('should not fetch');}),/10年/);
});
