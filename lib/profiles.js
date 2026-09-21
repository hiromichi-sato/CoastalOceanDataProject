import { areas, metrics, sources } from './catalog.js';
import { density, depthFromPressure, pressureFromDepth } from './seawater.js';

const ENDPOINTS = {
  argo: 'https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.json',
  cchdo: 'https://data.pmel.noaa.gov/generic/erddap/tabledap/cchdo_ctd.json'
};
const ARGO = ['platform_number','cycle_number','direction','time','latitude','longitude','position_qc','time_qc','data_mode',
  ...['pres','temp','psal'].flatMap((v)=>[v,v+'_qc',v+'_adjusted',v+'_adjusted_qc'])];
const CCHDO = ['profile_id','expocode','time','latitude','longitude','pressure','ctd_temperature','ctd_temperature_qc','ctd_temperature_68','ctd_temperature_68_qc','ctd_salinity','ctd_salinity_qc','ctd_oxygen','ctd_oxygen_qc'];
const cache = new Map();
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v)<1e10;

export async function readTable(url, fetcher=fetch) {
  const hit=cache.get(url); if(hit&&hit.expires>Date.now())return hit.promise;
  const promise=(async()=>{
    const response=await fetcher(url,{signal:AbortSignal.timeout(60000)});
    let text='';
    if(response.body?.getReader){
      const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>20*1024*1024){await reader.cancel();throw new Error('取得データが20MBを超えました。期間・深度・範囲を狭めてください。');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
      finally{reader.releaseLock();}
    }else text=await response.text();
    if(response.status===404&&/no matching results|nRows\s*=\s*0/i.test(text))return {rows:[],units:{}};
    if(!response.ok)throw new Error(`提供元ERDDAP HTTP ${response.status}: ${text.slice(0,200)}`);
    let table;try{table=JSON.parse(text).table;}catch{throw new Error('提供元ERDDAPのJSON形式が不正です。');}
    if(!table||!Array.isArray(table.columnNames)||!Array.isArray(table.rows)||!Array.isArray(table.columnUnits))throw new Error('提供元のテーブル形式が変更されています。');
    if(table.rows.length>100000)throw new Error('1回の取得が10万行を超えました。条件を狭めてください。');
    return {rows:table.rows.map((r)=>Object.fromEntries(table.columnNames.map((key,i)=>[key,r[i]]))),units:Object.fromEntries(table.columnNames.map((key,i)=>[key,table.columnUnits[i]]))};
  })();
  if(cache.size>=8)cache.delete(cache.keys().next().value);
  cache.set(url,{expires:Date.now()+3600000,promise});
  try{return await promise;}catch(error){cache.delete(url);throw error;}
}

export function selectedArgoValue(row, key, mode='adjusted') {
  if(mode==='delayed'&&row.data_mode!=='D')return null;
  const adjusted=['A','D'].includes(row.data_mode);
  if(!adjusted&&!(mode==='all'&&row.data_mode==='R'))return null;
  const field=adjusted?key+'_adjusted':key;
  return ['1','2'].includes(String(row[field+'_qc']))&&finite(row[field])?row[field]:null;
}
const goodShip = (row,key) => Number(row[key+'_qc'])===2&&finite(row[key])?row[key]:null;

export function normalizeProfiles(rows, source, query, diagnostics) {
  const box=query.bbox||areas[query.area].bbox, groups=new Map(), seen=new Set(), spec=metrics[query.metric];
  for(const row of rows){
    const lon=row.longitude,lat=row.latitude,date=new Date(row.time);
    if(!finite(lon)||!finite(lat)||lon<box[0]||lon>box[2]||lat<box[1]||lat>box[3]||!Number.isFinite(date.getTime())){diagnostics.invalidLocation++;continue;}
    const month=date.getUTCMonth()+1,calendar=date.getUTCFullYear(),year=query.basis==='fiscal'&&month<4?calendar-1:calendar;
    if(year<query.start||year>query.end||!query.months.includes(month))continue;
    let p,t,s,profile;
    if(source==='argo'){
      if(!['1','2'].includes(String(row.position_qc))||!['1','2'].includes(String(row.time_qc))){diagnostics.qcRejected++;continue;}
      p=selectedArgoValue(row,'pres',query.argoMode);t=selectedArgoValue(row,'temp',query.argoMode);s=selectedArgoValue(row,'psal',query.argoMode);
      profile=`${row.platform_number}:${row.cycle_number}:${row.direction}:${row.time}`;
    }else{
      p=finite(row.pressure)?row.pressure:null;t=goodShip(row,'ctd_temperature');s=goodShip(row,'ctd_salinity');
      if(t===null){const t68=goodShip(row,'ctd_temperature_68');if(t68!==null)t=t68/1.00024;}
      profile=row.profile_id;
    }
    if(p===null||p<0||p>12000){diagnostics.qcRejected++;continue;}
    const depth=depthFromPressure(p,lat);
    if(depth<query.depthMin||depth>query.depthMax){diagnostics.depthExcluded++;continue;}
    if(t!==null&&(t< -3||t>45))t=null;
    if(s!==null&&(s<0||s>45))s=null;
    const rho=s!==null&&s<=42&&t!==null&&t>=-2&&t<=40?density(s,t,p):null;
    let value;
    switch(query.metric){
      case 'TEMP':value=t;break;case 'SAL':value=s;break;case 'PRESSURE':value=p;break;case 'DEPTH':value=depth;break;
      case 'RHO':value=rho;break;case 'RHO0':case 'SIGMAT':value=rho===null?null:density(s,t,0)-(query.metric==='SIGMAT'?1000:0);break;
      case 'DO':{const oxygen=goodShip(row,'ctd_oxygen');value=oxygen===null||rho===null?null:oxygen*rho*31.998e-6;break;}
      default:throw new Error('このプロファイルソースに指定項目はありません。');
    }
    if(value===null||!Number.isFinite(value)||(spec.min!==undefined&&value<spec.min)||(spec.max!==undefined&&value>spec.max)){diagnostics.qcRejected++;continue;}
    const recordId=`${profile}:${p}`;if(seen.has(recordId)){diagnostics.duplicates++;continue;}seen.add(recordId);
    if(!groups.has(profile))groups.set(profile,{source,profile,year,fiscalYear:month<4?calendar-1:calendar,month,longitude:lon,latitude:lat,values:[],depths:[],platform:source==='argo'?row.platform_number:row.expocode});
    const item=groups.get(profile);item.values.push(value);item.depths.push(depth);
  }
  const mean=(a)=>a.reduce((sum,v)=>sum+v,0)/a.length;
  return [...groups.values()].map((item)=>{
    const cellX=Math.floor(item.longitude/query.spatialBin),cellY=Math.floor(item.latitude/query.spatialBin);
    diagnostics.profileLevels+=item.values.length;
    return {source,station:`cell:${cellX}:${cellY}:${query.spatialBin}`,name:`${sources[source].label} ${((cellX+.5)*query.spatialBin).toFixed(3)}E ${((cellY+.5)*query.spatialBin).toFixed(3)}N`,recordId:item.profile,profile:item.profile,platform:item.platform,
      longitude:item.longitude,latitude:item.latitude,year:item.year,fiscalYear:item.fiscalYear,month:item.month,depth:mean(item.depths),value:mean(item.values),sampleCount:item.values.length};
  });
}

export async function getProfiles(source, query, diagnostics, loader=readTable) {
  const box=query.bbox||areas[query.area].bbox;
  if(query.end-query.start>9||(box[2]-box[0])*(box[3]-box[1])>100||query.depthMax-query.depthMin>500)throw new Error('外部プロファイルは1回10年以内・範囲100平方度以内・深度幅500m以内で指定してください。');
  const records=[],requests=[],cruises=new Set();let fetchedCount=0;
  const modes=source==='argo'&&query.argoMode==='all'?['adjusted','raw']:['adjusted'];
  for(let year=query.start;year<=query.end;year++)for(const mode of modes){
    const fiscal=query.basis==='fiscal',start=`${year}-${fiscal?'04':'01'}-01T00:00:00Z`,end=`${year+1}-${fiscal?'04':'01'}-01T00:00:00Z`;
    const pressure=source==='argo'?(mode==='raw'?'pres':'pres_adjusted'):'pressure';
    const pmin=Math.max(0,Math.min(pressureFromDepth(query.depthMin,box[1]),pressureFromDepth(query.depthMin,box[3]))-2);
    const pmax=Math.max(pressureFromDepth(query.depthMax,box[1]),pressureFromDepth(query.depthMax,box[3]))+2;
    const filters=[`longitude>=${box[0]}`,`longitude<=${box[2]}`,`latitude>=${box[1]}`,`latitude<=${box[3]}`,`time>=${start}`,`time<${end}`,`${pressure}>=${pmin}`,`${pressure}<=${pmax}`];
    if(source==='argo')filters.push(mode==='raw'?'data_mode="R"':query.argoMode==='delayed'?'data_mode="D"':'data_mode=~"[AD]"');
    if(source==='cchdo'&&query.cruise)filters.push(`expocode="${query.cruise}"`);
    const columns=source==='argo'?ARGO:CCHDO;
    const url=ENDPOINTS[source]+'?'+columns.join(',')+'&'+filters.map(encodeURIComponent).join('&');
    const table=await loader(url);requests.push(url);fetchedCount+=table.rows.length;
    if(fetchedCount>150000)throw new Error('外部観測が15万行を超えました。範囲・深度・期間を狭めてください。');
    if(table.rows.length){
      const required=source==='argo'?{temp:['degree_Celsius'],psal:['PSU'],pres:['decibar']}:{ctd_temperature:['degree_C'],ctd_salinity:['1'],pressure:['dbar'],ctd_oxygen:['µmole/kg']};
      for(const [key,units] of Object.entries(required))if(!units.includes(table.units[key]))throw new Error(`${key} の単位が想定と異なります: ${table.units[key]}`);
      for(const key of columns)if(!Object.hasOwn(table.rows[0],key))throw new Error(`提供元に ${key} がありません。`);
    }
    if(source==='cchdo')table.rows.forEach((r)=>cruises.add(r.expocode));
    records.push(...normalizeProfiles(table.rows,source,query,diagnostics));
  }
  return {records,provenance:{source,label:sources[source].label,url:sources[source].url,requests,retrievedAt:new Date().toISOString(),fetchedCount,usedCount:records.length,
    cruiseLinks:[...cruises].map((id)=>`https://cchdo.ucsd.edu/cruise/${encodeURIComponent(id)}`),doi:source==='argo'?'https://doi.org/10.17882/42182':undefined,
    qc:source==='argo'?`mode=${query.argoMode}; Argo QC 1/2; adjusted values for A/D, no fallback to rejected raw values`:'WOCE QC 2; ITS-68 converted to ITS-90; oxygen umol/kg to mg/L with EOS-80 density',spatialBin:query.spatialBin}};
}
