import { prepareGrid, drawMap } from './research-map.js';
const $ = (s) => document.querySelector(s);
const form = $('#query');
let catalog, data, grid, rendered, points, worker, cancelSolve, generation = 0, fetching = false;
const status = (message) => { $('#status').textContent = message; };
const setExport = (enabled) => ['nc','shape','csv'].forEach((id)=>{ $('#'+id).disabled = !enabled; });
for(let month=1;month<=12;month++) {
  const label=document.createElement('label'), input=document.createElement('input');
  input.type='checkbox'; input.name='month'; input.value=month; input.checked=true;
  label.append(input, `${month}月`); $('#months').append(label);
}
$('#season').addEventListener('change',()=>{
  for(const input of form.querySelectorAll('[name=month]')) input.checked=catalog.seasons[$('#season').value].includes(Number(input.value));
});
async function initialize() {
  const response=await fetch('/api/catalog'); if(!response.ok) throw new Error('解析APIに接続できません。最新版の起動アプリを再起動してください。');
  catalog=await response.json();
  for(const [key,area] of Object.entries(catalog.areas)) $('#area').add(new Option(area.label,key));
  for(const [key,metric] of Object.entries(catalog.metrics)) $('#metric').add(new Option(`${metric.label} [${metric.unit}]`,key));
  for(const [key,source] of Object.entries(catalog.sources)) {
    const label=document.createElement('label'),input=document.createElement('input');label.className='check';input.type='checkbox';input.name='source';input.value=key;input.checked=key==='koiki';label.append(input,source.label);$('#source-options').append(label);
    input.addEventListener('change',()=>{$('#profile-options').hidden=![...form.querySelectorAll('[name=source]:checked')].some((i)=>catalog.sources[i.value].cadence==='profile');});
  }
  for(const el of form.querySelectorAll('[name=start],[name=end]')) el.max=new Date().getFullYear();
}
$('#area').addEventListener('change',()=>{$('#custom-area').hidden=$('#area').value!=='custom';});
form.addEventListener('submit',async(event)=>{
  event.preventDefault();
  const id=++generation; cancelSolve?.(); worker?.terminate(); setExport(false); rendered=null; grid=null; data=null;
  for(const selector of ['#map','#legend','#record','#provenance','#warnings','#yearly','#monthly','#coverage']) $(selector).replaceChildren();
  $('#count').textContent='';
  const sources=[...form.querySelectorAll('[name=source]:checked')].map((i)=>i.value), months=[...form.querySelectorAll('[name=month]:checked')].map((i)=>i.value);
  if(!sources.length || !months.length) { status('データソースと対象月を1つ以上選択してください。'); return; }
  const params=new URLSearchParams(new FormData(form)); params.delete('source'); params.delete('month');
  params.set('sources',sources.join(',')); params.set('months',months.join(','));
  $('#run').disabled=true; $('#source-view').disabled=true; $('#resolution').disabled=true; fetching=true; status('実観測データを取得しています…');
  try {
    const response=await fetch('/api/observations?'+params,{signal:AbortSignal.timeout(180000)});
    const result=await response.json(); if(!response.ok) throw new Error(result.error || '取得に失敗しました。');
    if(id!==generation) return;
    data=result; $('#title').textContent=`${data.area} / ${data.metric}`;
    $('#count').textContent=`${data.query.start}〜${data.query.end} ${data.query.basis==='calendar'?'年':'年度'} / ${data.count}集計標本 / ${data.stationCount}測点・区画`;
    $('#source-view').replaceChildren(new Option('選択ソースを統合','all'));
    for(const item of data.summary) $('#source-view').add(new Option(item.label,item.source));
    for(const selector of ['#minimum','#maximum','#interval']) $(selector).value='';
    for(const p of data.provenance) {
      const line=document.createElement('p'), link=document.createElement('a'); link.href=p.url; link.target='_blank'; link.rel='noopener'; link.textContent=p.label;
      line.append(link, ` / ${p.usedCount}件 / 取得 ${p.retrievedAt}`); $('#provenance').append(line);
      if(p.doi){const doi=document.createElement('a');doi.href=p.doi;doi.textContent='Argo DOI';doi.target='_blank';doi.rel='noopener';$('#provenance').append(doi);}
      for(const url of p.cruiseLinks||[]){const a=document.createElement('a');a.href=url;a.textContent=url.split('/').at(-1);a.target='_blank';a.rel='noopener';const entry=document.createElement('p');entry.append(a);$('#provenance').append(entry);}
    }
    if(!data.points.length) { status('条件に該当する有効な観測値がありません。期間・月・深度を変更してください。'); showWarnings(); return; }
    await compute(id);
  } catch(error) { if(id===generation) status(error.message); }
  finally { fetching=false; $('#run').disabled=false; $('#source-view').disabled=false; $('#resolution').disabled=false; }
});
function showWarnings() {
  $('#warnings').replaceChildren();
  const warnings=[...data.warnings];
  if(data.missingYears.length) warnings.push(`欠測年（平均の分母から除外）: ${data.missingYears.join(', ')}`);
  if(data.query.sources.includes('koiki')) {
    const requested=(data.query.end-data.query.start+1)*data.query.months.length;
    const available=data.bySource.koiki?.coverage.filter((c)=>c.month>0).length || 0;
    if(available<requested) warnings.push(`広域総合: 指定した ${requested} 年月のうち ${requested-available} 年月に有効な観測がありません。平均は観測のある年月のみで計算しています。`);
  }
  if(grid?.excluded) warnings.push(`海岸線・格子上の陸地に該当する ${grid.excluded} 測点は補間の固定値から除外しました。測点は地図上に表示しています。`);
  if(grid?.collisions) warnings.push(`同じ格子に入った ${grid.collisions} 測点分を均等平均しました。`);
  if(grid?.unconstrainedCells) warnings.push(`観測点に接続しない ${grid.unconstrainedCells} 海域格子は欠測です。`);
  if(grid && grid.anchors.length<3) warnings.push('固定値を持つ格子が3点未満です。空間分布の解釈に十分な観測点がありません。');
  warnings.push('観測網のある位置からの空間内挿です。未観測域の精度・不確かさを保証するものではありません。');
  for(const warning of warnings) { const p=document.createElement('p'); p.textContent=warning; $('#warnings').append(p); }
}
async function compute(id=++generation) {
  cancelSolve?.(); worker?.terminate(); setExport(false); rendered=null; grid=null; $('#map').replaceChildren();
  points=data.points.filter((p)=>$('#source-view').value==='all'||p.source===$('#source-view').value);
  if(!points.length) { status('このソースには有効な観測点がありません。'); return; }
  status('海岸線を格子化し、定常拡散方程式を計算しています…');
  const prepared=await prepareGrid(points,Number($('#resolution').value));
  if(id!==generation) return;
  const {land,toGrid,fromGrid,...input}=prepared;
  const result=await new Promise((resolve,reject)=>{
    worker=new Worker('/diffusion-worker.js');
    const activeWorker=worker;
    const timer=setTimeout(()=>{activeWorker.terminate();reject(new Error('計算時間を超過しました。格子数を減らしてください。'));},90000);
    cancelSolve=()=>{clearTimeout(timer);activeWorker.terminate();resolve(null);};
    activeWorker.onmessage=({data})=>{clearTimeout(timer);cancelSolve=null;activeWorker.terminate();data.error?reject(new Error(data.error)):resolve(data.result);};
    activeWorker.onerror=(e)=>{clearTimeout(timer);cancelSolve=null;activeWorker.terminate();reject(new Error(e.message));};
    activeWorker.postMessage(input);
  });
  if(id!==generation || !result) return;
  grid={...prepared,...result};
  redraw(); showWarnings(); drawCharts();
  if(!rendered){status('描画できませんでした。表示設定とエラー内容を確認してください。');return;}
  status(`${data.partial?'一部ソースの取得失敗あり':'表示完了'} / ${grid.solvedCells} 格子 / 方程式残差 ${grid.residual.toExponential(2)}`);
}
function settingNumber(selector) { const value=$(selector).value; if(value==='')return null; const n=Number(value); if(!Number.isFinite(n))throw new Error('表示範囲には有限の数値を指定してください。'); return n; }
function redraw() {
  if(!grid) return;
  setExport(false); rendered=null; $('#display-error').textContent='';
  try {
    rendered=drawMap($('#map'),grid,points,{min:settingNumber('#minimum'),max:settingNumber('#maximum'),interval:settingNumber('#interval'),kind:$('#kind').value,palette:$('#palette').value});
    $('#legend').replaceChildren();
    const ramp=document.createElement('span'); ramp.className='ramp'; ramp.style.background=`linear-gradient(90deg, ${d3.range(0,1.01,.1).map((t)=>rendered.color(rendered.min+t*(rendered.max-rendered.min))).join(',')})`;
    $('#legend').append(`${rendered.min.toPrecision(5)}`,ramp,`${rendered.max.toPrecision(5)} ${data.unit}`);
    $('#record').replaceChildren();
    const record={ '対象月':data.query.months.join(', ')+'月', '採水深度':`${data.query.depthMin}〜${data.query.depthMax} m`, '平均方法':data.query.aggregation==='equal-year'?data.method.equalYearDefinition:'観測件数による加重平均（測点内）。水域グラフも観測件数で加重。', '補間方程式':'∂c/∂t = κ∇²c の定常解 ∇²c=0（一定κ）', '境界条件':'観測格子:固定値、陸域・計算外縁:流束ゼロ。無観測の孤立水域:欠測。', '計算格子':`${grid.cols} × ${grid.rows} / ${grid.dx.toFixed(0)} × ${grid.dy.toFixed(0)} m（中緯度での局所平面近似）`, '固定格子':`${grid.anchors.length}`, '残差':grid.residual.toExponential(3), '除外記録':JSON.stringify(data.diagnostics), 'Shapefile':'色分け領域のポリゴン（等値線のみの出力ではありません）' };
    for(const [key,value] of Object.entries(record)) {const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;$('#record').append(dt,dd);}
    setExport(true);
  }catch(error){$('#display-error').textContent=error.message;}
}
for(const id of ['kind','palette','minimum','maximum','interval']) $('#'+id).addEventListener('change',redraw);
for(const id of ['source-view','resolution']) $('#'+id).addEventListener('change',()=>{ if(data&&!fetching) compute().catch((error)=>status(error.message)); });
function drawCharts() {
  const source=$('#source-view').value;
  const series=source==='all'?data:data.bySource[source];
  $('#coverage').replaceChildren();
  const head=document.createElement('tr');
  for(const label of ['年 / 年度',...d3.range(1,13).map((m)=>`${m}月`),'年間値']){const th=document.createElement('th');th.textContent=label;head.append(th);}
  $('#coverage').append(head);
  for(let year=data.query.start;year<=data.query.end;year++){
    const tr=document.createElement('tr');const th=document.createElement('th');th.textContent=year;tr.append(th);
    for(const month of [...d3.range(1,13),0]){const td=document.createElement('td');td.textContent=series.coverage.find((c)=>c.year===year&&c.month===month)?.count || '—';tr.append(td);}
    $('#coverage').append(tr);
  }
  for(const [selector,key,field] of [['#yearly','yearly','year'],['#monthly','monthly','month']]) {
    const items=series[key], svg=d3.select(selector); svg.selectAll('*').remove(); svg.attr('viewBox','0 0 450 190');
    if(!items.length)continue;
    const x=d3.scaleBand().domain(items.map((d)=>d[field])).range([55,435]).padding(.3);
    const extent=d3.extent(items,(d)=>d.average); const padding=Math.max((extent[1]-extent[0])*.1,.01);
    const y=d3.scaleLinear().domain([extent[0]-padding,extent[1]+padding]).nice().range([155,15]);
    svg.append('g').attr('transform','translate(0,155)').call(d3.axisBottom(x).tickValues(x.domain().filter((_,i)=>i%Math.max(1,Math.ceil(items.length/9))===0)));
    svg.append('g').attr('transform','translate(55,0)').call(d3.axisLeft(y).ticks(5));
    svg.append('path').datum(items).attr('d',d3.line().x((d)=>x(d[field])+x.bandwidth()/2).y((d)=>y(d.average))).attr('fill','none').attr('stroke','#17828a').attr('stroke-width',2);
    svg.append('g').selectAll('circle').data(items).join('circle').attr('cx',(d)=>x(d[field])+x.bandwidth()/2).attr('cy',(d)=>y(d.average)).attr('r',4).attr('fill','#17828a').append('title').text((d)=>`${d[field]}: ${d.average} ${data.unit} / ${d.count}件`);
  }
}
function metadata() {
  return { createdAt:new Date().toISOString(),mode:'observations',metric:data.metric,metricKey:data.metricKey,unit:data.unit,area:data.area,query:data.query,provenance:data.provenance,observations:points,
    aggregation:data.method,interpolation:'steady diffusion: Laplacian(c)=0; constant diffusivity; finite volume; Numeric.js sparse LU',boundary:'Dirichlet at observation cells; zero flux at land and outer boundary',clipping:{engine:'Clipper 6.4.2.2',coordinateQuantum:1e-6,coordinateUnits:'grid cells',gridValuesUnchanged:true},
    grid:{cols:grid.cols,rows:grid.rows,bounds:grid.bounds,dx:grid.dx,dy:grid.dy,residual:grid.residual,excludedPoints:grid.excluded,mergedPoints:grid.collisions,unconstrainedCells:grid.unconstrainedCells},
    display:{source:$('#source-view').value,kind:$('#kind').value,palette:$('#palette').value,min:rendered.min,max:rendered.max,thresholds:rendered.thresholds},warnings:data.warnings,sourceStatus:data.sourceStatus,partial:data.partial,crs:'EPSG:4326',coastline:'GSI Global Map Japan via dataofjapan/land' };
}
for(const format of ['nc','shape','csv']) $('#'+format).addEventListener('click',async()=>{
  if(!rendered)return;
  const meta=metadata(),current=grid,bands=rendered.bands; $('#export-status').textContent='保存ファイルを作成中…';
  try {
    let blob,extension;
    if(format==='nc'){blob=new Blob([AquaExport.netcdf(current,meta)],{type:'application/x-netcdf'});extension='nc';}
    else if(format==='shape'){blob=await AquaExport.shapefile(bands,meta);extension='zip';}
    else {const escape=(value)=>'"'+String(value).replaceAll('"','""')+'"';const rows=[['source','station','name','longitude','latitude','value','unit','count','years','months'],...points.map((p)=>[p.source,p.station,p.name,p.longitude,p.latitude,p.value,data.unit,p.count,p.years.join(';'),p.months.join(';')])];blob=new Blob(['\uFEFF'+rows.map((r)=>r.map(escape).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});extension='csv';}
    AquaExport.download(blob,`aqua-${meta.query.area}-${meta.metricKey}-${meta.query.start}-${meta.query.end}.${extension}`);$('#export-status').textContent='保存しました。';
  }catch(error){$('#export-status').textContent=error.message;}
});
initialize().catch((error)=>{status(error.message);$('#run').disabled=true;});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
let previousWidth=0;
new ResizeObserver(()=>{
  const width=$('#map').getBoundingClientRect().width;
  if(Math.abs(width-previousWidth)>1){previousWidth=width;if(grid)redraw();}
}).observe($('#map'));
