const { d3, topojson, AquaClip: clip } = window;
let landPromise;
export async function landData() {
  if (!landPromise) landPromise = fetch('/data/japan.topo.json').then((r) => { if (!r.ok) throw new Error('海岸線を取得できません。'); return r.json(); }).then((t) => topojson.merge(t, t.objects.japan.geometries));
  return landPromise;
}
export async function prepareGrid(points, resolution) {
  const land = await landData();
  const lon = d3.extent(points, (p) => p.longitude), lat = d3.extent(points, (p) => p.latitude);
  const padX = Math.max(.025, (lon[1] - lon[0]) * .1), padY = Math.max(.025, (lat[1] - lat[0]) * .1);
  const bounds = [lon[0] - padX, lat[0] - padY, lon[1] + padX, lat[1] + padY];
  const cosine = Math.cos((bounds[1] + bounds[3]) / 2 * Math.PI / 180);
  const width = (bounds[2] - bounds[0]) * cosine, height = bounds[3] - bounds[1];
  const cols = Math.max(8, Math.round(resolution * Math.min(1, width / height)));
  const rows = Math.max(8, Math.round(resolution * Math.min(1, height / width)));
  const dl = (bounds[2] - bounds[0]) / cols, dt = (bounds[3] - bounds[1]) / rows;
  const toGrid = ([x, y]) => [(x - bounds[0]) / dl, (bounds[3] - y) / dt];
  const fromGrid = ([x, y]) => [bounds[0] + x * dl, bounds[3] - y * dt];
  const transform = d3.geoTransform({ point(x, y) { this.stream.point(...toGrid([x, y])); } });
  const context = document.createElement('canvas').getContext('2d');
  const path = new Path2D(d3.geoPath(transform)(land));
  const wet = (x, y) => !context.isPointInPath(path, x, y);
  const water = Array.from({ length: cols * rows }, (_, i) => wet(i % cols + .5, Math.floor(i / cols) + .5));
  const east = water.map((w, i) => w && [0.75, 1, 1.25].every((offset) => wet(i % cols + offset, Math.floor(i / cols) + .5)));
  const south = water.map((w, i) => w && [0.75, 1, 1.25].every((offset) => wet(i % cols + .5, Math.floor(i / cols) + offset)));
  const grouped = new Map(); let excluded = 0;
  for (const p of points) {
    const [x, y] = toGrid([p.longitude, p.latitude]), i = Math.floor(y) * cols + Math.floor(x);
    if (!wet(x, y) || !water[i]) { excluded++; continue; }
    if (!grouped.has(i)) grouped.set(i, []); grouped.get(i).push(p.value);
  }
  const anchors = [...grouped].map(([i, v]) => [i, d3.mean(v)]);
  if (!anchors.length) throw new Error('海岸線・格子上で有効な海域観測点がありません。格子を細かくしてください。');
  return { cols, rows, water, east, south, anchors, dx: dl * cosine * 111195, dy: dt * 111195,
    longitude: d3.range(cols).map((i) => fromGrid([i + .5, 0])[0]), latitude: d3.range(rows).map((i) => fromGrid([0, i + .5])[1]),
    bounds, excluded, collisions: points.length - excluded - anchors.length, land, toGrid, fromGrid };
}
export function drawMap(svgElement, grid, points, settings) {
  const width = Math.max(320, svgElement.getBoundingClientRect().width), height = width < 600 ? 450 : 650, margin = 60;
  svgElement.style.aspectRatio = `${width} / ${height}`;
  const ratio = grid.dx * grid.cols / (grid.dy * grid.rows);
  const w = Math.min(width - 2 * margin, (height - 2 * margin) * ratio), h = w / ratio;
  const left = (width - w) / 2, top = (height - h) / 2;
  const pixel = ([x, y]) => [left + x / grid.cols * w, top + y / grid.rows * h];
  const project = (p) => pixel(grid.toGrid(p));
  const svg = d3.select(svgElement).attr('viewBox', `0 0 ${width} ${height}`); svg.selectAll('*').remove();
  const finite = grid.values.filter(Number.isFinite), extent = d3.extent(finite);
  if (!finite.length) throw new Error('計算可能な格子がありません。');
  const min = settings.min ?? extent[0], max = settings.max ?? extent[1];
  if (min > max || (min === max && extent[0] !== extent[1])) throw new Error('最小値は最大値より小さくしてください。');
  const interval = settings.interval ?? ((max - min) / 10 || 1);
  if (!(interval > 0) || (max - min) / interval > 100) throw new Error('等値線間隔は正の値、分割数は100以下にしてください。');
  const levels = d3.range(min, max + interval * 1e-6, interval).filter((v) => v > extent[0] && v <= extent[1]);
  const thresholds = [...new Set([extent[0], ...levels])].sort((a,b)=>a-b);
  const color = d3.scaleSequential(settings.palette === 'turbo' ? d3.interpolateTurbo : settings.palette === 'diverging' ? (v)=>d3.interpolateRdBu(1-v) : d3.interpolateViridis).domain([min, max]).clamp(true);
  const rectangle = [[[[0,0],[grid.cols,0],[grid.cols,grid.rows],[0,grid.rows],[0,0]]]];
  const land = grid.land.coordinates.map((poly) => poly.map((ring) => ring.map(grid.toGrid)));
  const landInFrame = clip.intersection(land, rectangle);
  const sea = clip.difference(rectangle, landInFrame);
  const contours = d3.contours().size([grid.cols, grid.rows]).thresholds(thresholds)(grid.values.map((v)=>v ?? NaN));
  const clipped = contours.map((c) => clip.intersection(c.coordinates, sea));
  const bands = clipped.map((coordinates, i) => ({ lower: thresholds[i], upper: thresholds[i+1] ?? extent[1], coordinates: i+1 < clipped.length ? clip.difference(coordinates, clipped[i+1]) : coordinates })).filter((b)=>b.coordinates.length);
  const transform = d3.geoTransform({ point(x,y) { this.stream.point(...pixel([x,y])); } });
  const path = d3.geoPath(transform);
  svg.append('rect').attr('x',left).attr('y',top).attr('width',w).attr('height',h).attr('fill','#deedf2').attr('stroke','#afc4c9');
  if (settings.kind === 'filled' || settings.kind === 'both') svg.append('g').selectAll('path').data(bands).join('path').attr('d',(b)=>path({type:'MultiPolygon',coordinates:b.coordinates})).attr('fill',(b)=>color(b.lower));
  // Discard contour edges adjacent to missing cells: these are mask boundaries, not isolines.
  const lines = [];
  for (const contour of contours.slice(1)) for (const polygon of contour.coordinates) for (const ring of polygon) {
    let segment = [];
    const flush = () => { if(segment.length>1) lines.push({ value:contour.value, coordinates:segment }); segment=[]; };
    for (let k=1;k<ring.length;k++) {
      const a=ring[k-1], b=ring[k], x=(a[0]+b[0])/2, y=(a[1]+b[1])/2;
      const cx=Math.floor(x-.5), cy=Math.floor(y-.5);
      const valid = [0,1].every((oy)=>[0,1].every((ox)=>cx+ox>=0 && cx+ox<grid.cols && cy+oy>=0 && cy+oy<grid.rows && Number.isFinite(grid.values[(cy+oy)*grid.cols+cx+ox])));
      if (valid) { if (!segment.length) segment.push(a); segment.push(b); } else flush();
    } flush();
  }
  const defs = svg.append('defs');
  defs.append('clipPath').attr('id','research-sea').append('path').attr('d',path({type:'MultiPolygon',coordinates:sea}));
  if (settings.kind === 'lines' || settings.kind === 'both') svg.append('g').attr('clip-path','url(#research-sea)').selectAll('path').data(lines).join('path').attr('d',(l)=>path({type:'LineString',coordinates:l.coordinates})).attr('fill','none').attr('stroke', settings.kind === 'lines' ? '#196b77' : '#fff').attr('stroke-width',1.2).append('title').text((l)=>l.value);
  svg.append('path').attr('d',path({type:'MultiPolygon',coordinates:landInFrame})).attr('fill','#e2e6df').attr('stroke','#748d8c').attr('stroke-width',1);
  svg.append('g').selectAll('circle').data(points).join('circle').attr('cx',(p)=>project([p.longitude,p.latitude])[0]).attr('cy',(p)=>project([p.longitude,p.latitude])[1]).attr('r',3.5).attr('fill',(p)=>color(p.value)).attr('stroke','#122c37').attr('stroke-width',.7).append('title').text((p)=>`${p.name}: ${p.value.toPrecision(5)} (${p.count}件)`);
  const [west,south,east,north] = grid.bounds;
  for(const x of d3.ticks(west,east,width<600?3:5)) svg.append('text').attr('x',project([x,south])[0]).attr('y',top+h+22).attr('text-anchor','middle').text(`${x.toFixed(2)}°E`);
  for(const y of d3.ticks(south,north,5)) svg.append('text').attr('x',left-6).attr('y',project([west,y])[1]).attr('text-anchor','end').text(`${y.toFixed(2)}°N`);
  const geographicBands=bands.map((b)=>({...b,coordinates:b.coordinates.map((p)=>p.map((r)=>r.map(grid.fromGrid)))}));
  return { bands:geographicBands, min,max,thresholds,color,extent };
}
