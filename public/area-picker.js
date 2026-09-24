import { landData } from './research-map.js';
const { d3 } = window;
const BOUNDS = [120, 20, 155, 47];

export function createAreaPicker(svgElement, onChange) {
  const cosine = Math.cos((BOUNDS[1] + BOUNDS[3]) / 2 * Math.PI / 180);
  const ratio = (BOUNDS[2] - BOUNDS[0]) * cosine / (BOUNDS[3] - BOUNDS[1]);
  let width, height, rectEl, dragStart;
  const toPixel = ([lon, lat]) => [(lon - BOUNDS[0]) / (BOUNDS[2] - BOUNDS[0]) * width, (BOUNDS[3] - lat) / (BOUNDS[3] - BOUNDS[1]) * height];
  const toLonLat = ([x, y]) => [BOUNDS[0] + x / width * (BOUNDS[2] - BOUNDS[0]), BOUNDS[3] - y / height * (BOUNDS[3] - BOUNDS[1])];
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  function localPoint(event) {
    const box = svgElement.getBoundingClientRect();
    return [clamp((event.clientX - box.left) / box.width * width, 0, width), clamp((event.clientY - box.top) / box.height * height, 0, height)];
  }
  function rectFromPixels(a, b) {
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
    rectEl.attr('x', x).attr('y', y).attr('width', w).attr('height', h).attr('visibility', 'visible');
    const [west, north] = toLonLat([x, y]), [east, south] = toLonLat([x + w, y + h]);
    onChange({ west, east, south, north });
  }
  function onDrag(event) { event.preventDefault(); rectFromPixels(dragStart, localPoint(event)); }
  function endDrag(event) { svgElement.removeEventListener('pointermove', onDrag); svgElement.releasePointerCapture(event.pointerId); }
  function startDrag(event) {
    event.preventDefault();
    dragStart = localPoint(event);
    svgElement.setPointerCapture(event.pointerId);
    svgElement.addEventListener('pointermove', onDrag);
    svgElement.addEventListener('pointerup', endDrag, { once: true });
    rectFromPixels(dragStart, dragStart);
  }
  async function draw() {
    const land = await landData();
    width = Math.max(240, svgElement.getBoundingClientRect().width || 480);
    height = width / ratio;
    svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const transform = d3.geoTransform({ point(x, y) { this.stream.point(...toPixel([x, y])); } });
    const path = d3.geoPath(transform);
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();
    svg.append('rect').attr('x', 0).attr('y', 0).attr('width', width).attr('height', height).attr('fill', '#deedf2');
    svg.append('path').attr('d', path(land)).attr('fill', '#e2e6df').attr('stroke', '#748d8c').attr('stroke-width', 1);
    rectEl = svg.append('rect').attr('class', 'area-rect').attr('fill', 'rgba(23,130,138,.25)').attr('stroke', '#17828a').attr('stroke-width', 1.5).attr('visibility', 'hidden');
    svg.on('pointerdown', startDrag);
  }
  function setBounds(bounds) {
    const [x1, y1] = toPixel([bounds.west, bounds.north]), [x2, y2] = toPixel([bounds.east, bounds.south]);
    rectEl.attr('x', Math.min(x1, x2)).attr('y', Math.min(y1, y2)).attr('width', Math.abs(x2 - x1)).attr('height', Math.abs(y2 - y1)).attr('visibility', 'visible');
    onChange(bounds);
  }
  return { draw, setBounds };
}
