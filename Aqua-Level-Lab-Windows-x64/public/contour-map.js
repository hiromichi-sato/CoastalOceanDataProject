const { d3, topojson } = window;
let baseMapPromise;

function loadBaseMap() {
  if (!baseMapPromise) {
    baseMapPromise = Promise.resolve().then(async () => {
      const embedded = document.querySelector("#aqua-offline-map");
      if (embedded) return JSON.parse(embedded.textContent);
      const response = await fetch("/data/japan.topo.json");
      if (!response.ok) throw new Error("Base map unavailable");
      return response.json();
    })
      .then((topology) => {
        const japan = topology.objects.japan;
        return {
          land: topojson.merge(topology, japan.geometries),
          prefectures: topojson.feature(topology, japan).features
        };
      })
      .catch((error) => {
        baseMapPromise = null;
        throw error;
      });
  }
  return baseMapPromise;
}

export class ContourMap {
  constructor(svg) {
    this.svg = svg;
    this.status = document.querySelector("#map-status");
    this.legend = document.querySelector("#map-legend");
    this.requestId = 0;
    this.data = null;
    this.baseMap = null;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.data && this.baseMap) this.draw();
    });
    this.resizeObserver.observe(svg);
    for (const input of document.querySelectorAll("[data-map-layer]")) {
      input.addEventListener("change", () => this.updateLayers());
    }
  }

  clear() {
    this.requestId += 1;
    this.data = null;
    this.svg.replaceChildren();
    this.legend.hidden = true;
    this.status.hidden = true;
  }

  async render(data) {
    this.clear();
    const requestId = this.requestId;
    const points = data.points.filter((point) =>
      Number.isFinite(point.longitude) && Number.isFinite(point.latitude) &&
      Number.isFinite(point.value) && Math.abs(point.longitude) <= 180 &&
      Math.abs(point.latitude) < 85
    );
    this.status.hidden = false;
    this.status.textContent = points.length ? "地図を読み込み中…" : "表示できる地点値がありません。";
    if (!points.length) return;

    try {
      const baseMap = await loadBaseMap();
      if (requestId !== this.requestId) return;
      this.baseMap = baseMap;
      this.data = { ...data, points };
      this.status.hidden = true;
      this.legend.hidden = false;
      this.draw();
    } catch {
      if (requestId !== this.requestId) return;
      this.status.textContent = "地図を読み込めませんでした。もう一度表示してください。";
    }
  }

  updateLayers() {
    for (const input of document.querySelectorAll("[data-map-layer]")) {
      const layer = this.svg.querySelector(`.map-${input.dataset.mapLayer}`);
      if (layer) layer.style.display = input.checked ? "" : "none";
    }
  }

  draw() {
    const width = Math.round(this.svg.getBoundingClientRect().width);
    if (!width) return;
    const height = Math.max(310, Math.min(480, Math.round(width * 0.78)));
    const margin = { top: 22, right: 18, bottom: 30, left: 52 };
    const left = margin.left;
    const top = margin.top;
    const right = width - margin.right;
    const bottom = height - margin.bottom;
    const points = this.data.points;
    const lon = d3.extent(points, (point) => point.longitude);
    const lat = d3.extent(points, (point) => point.latitude);
    const lonPad = Math.max((lon[1] - lon[0]) * 0.18, 0.08);
    const latPad = Math.max((lat[1] - lat[0]) * 0.18, 0.08);
    const bounds = [[lon[0] - lonPad, lat[0] - latPad], [lon[1] + lonPad, lat[1] + latPad]];
    // A shared projection keeps the coastline, field and observations aligned.
    const projection = d3.geoMercator()
      .fitExtent([[left, top], [right, bottom]], { type: "MultiPoint", coordinates: bounds })
      .clipExtent([[left, top], [right, bottom]]);
    const geoPath = d3.geoPath(projection);
    const landPath = geoPath(this.baseMap.land);
    const valueRange = d3.extent(points, (point) => point.value);
    const color = d3.scaleSequential(d3.interpolateViridis).domain(valueRange);
    const svg = d3.select(this.svg).attr("viewBox", `0 0 ${width} ${height}`);
    svg.selectAll("*").remove();
    svg.append("title").text(`${this.data.area} ${this.data.metric} 海岸線と観測点`);
    svg.append("desc").text("国土地理院の地球地図日本に基づく陸地と海岸線。補間色は陸地を除いて表示。北が上。");

    const defs = svg.append("defs");
    defs.append("clipPath").attr("id", "map-frame")
      .append("rect").attr("x", left).attr("y", top)
      .attr("width", right - left).attr("height", bottom - top);
    const mask = defs.append("mask").attr("id", "map-water-mask")
      .attr("maskUnits", "userSpaceOnUse")
      .attr("x", left).attr("y", top).attr("width", right - left).attr("height", bottom - top);
    mask.append("rect").attr("x", left).attr("y", top)
      .attr("width", right - left).attr("height", bottom - top).attr("fill", "white");
    mask.append("path").attr("d", landPath).attr("fill", "black");

    const map = svg.append("g").attr("clip-path", "url(#map-frame)");
    map.append("rect").attr("x", left).attr("y", top)
      .attr("width", right - left).attr("height", bottom - top).attr("fill", "#e7f2f8");

    const projected = points.map((point) => ({
      ...point, position: projection([point.longitude, point.latitude])
    }));
    const field = map.append("g").attr("class", "map-field").attr("mask", "url(#map-water-mask)");
    this.drawField(field, projected, color);
    map.append("path").attr("class", "map-land").attr("d", landPath)
      .attr("fill", "#e2e7e2").attr("stroke", "#697b78").attr("stroke-width", 1);

    this.drawAxes(svg, map, projection, { left, top, right, bottom });
    this.drawLabels(map, geoPath, { left, top, right, bottom });
    map.append("g").attr("class", "map-points").selectAll("circle").data(projected).join("circle")
      .attr("cx", (point) => point.position[0]).attr("cy", (point) => point.position[1])
      .attr("r", 3.6).attr("fill", (point) => color(point.value))
      .attr("stroke", "#ffffff").attr("stroke-width", 1.2)
      .append("title").text((point) => `${point.name}: ${point.value}\n${point.source || ""}\n${point.latitude.toFixed(4)} N, ${point.longitude.toFixed(4)} E`);

    svg.append("rect").attr("x", left).attr("y", top)
      .attr("width", right - left).attr("height", bottom - top)
      .attr("fill", "none").attr("stroke", "#b9c8ca");
    svg.append("text").attr("x", right - 5).attr("y", top - 7)
      .attr("text-anchor", "end").attr("class", "map-axis-label").text("N ↑");
    const format = d3.format(".3~g");
    document.querySelector("#map-value-min").textContent = format(valueRange[0]);
    document.querySelector("#map-value-max").textContent = format(valueRange[1]);
    document.querySelector("#map-color-ramp").style.background = valueRange[0] === valueRange[1]
      ? color(valueRange[0])
      : `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map(d3.interpolateViridis).join(", ")})`;
    document.querySelector("#map-metric").textContent = this.data.metric;
    document.querySelector("#map-period").textContent = this.data.mode === "demo" ? "デモ" : `${this.data.year}年度`;
    this.updateLayers();
  }

  drawField(field, points, color) {
    const [minX, maxX] = d3.extent(points, (point) => point.position[0]);
    const [minY, maxY] = d3.extent(points, (point) => point.position[1]);
    if (points.length < 3 || maxX - minX < 1 || maxY - minY < 1) return;
    const cell = 6;
    const cols = Math.max(2, Math.ceil((maxX - minX) / cell));
    const rows = Math.max(2, Math.ceil((maxY - minY) / cell));
    const values = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = minX + (col + 0.5) * cell;
        const y = minY + (row + 0.5) * cell;
        let sum = 0;
        let weights = 0;
        for (const point of points) {
          const distance2 = (x - point.position[0]) ** 2 + (y - point.position[1]) ** 2;
          const weight = 1 / Math.max(distance2, 0.01);
          sum += point.value * weight;
          weights += weight;
        }
        values.push(sum / weights);
      }
    }
    const [min, max] = d3.extent(values);
    const thresholds = [min, ...d3.ticks(min, max, 8).filter((value) => value > min)];
    const contours = d3.contours().size([cols, rows]).thresholds(thresholds)(values);
    const path = d3.geoPath(d3.geoIdentity().scale(cell).translate([minX, minY]));
    field.attr("opacity", 0.58).selectAll("path").data(contours).join("path")
      .attr("d", path).attr("fill", (contour) => color(contour.value))
      .attr("stroke", "#ffffff").attr("stroke-opacity", 0.45).attr("stroke-width", 0.55);
  }

  drawAxes(svg, map, projection, { left, top, right, bottom }) {
    const southwest = projection.invert([left, bottom]);
    const northeast = projection.invert([right, top]);
    const grid = map.append("g").attr("stroke", "#526f7d").attr("stroke-opacity", 0.16).attr("stroke-dasharray", "3 4");
    const axis = svg.append("g").attr("class", "map-axis-label");
    const lonCount = Math.max(2, Math.floor((right - left) / 80));
    for (const longitude of d3.ticks(southwest[0], northeast[0], lonCount)) {
      const x = projection([longitude, southwest[1]])[0];
      if (x < left + 20 || x > right - 20) continue;
      grid.append("line").attr("x1", x).attr("x2", x).attr("y1", top).attr("y2", bottom);
      axis.append("text").attr("x", x).attr("y", bottom + 20).attr("text-anchor", "middle").text(`${longitude.toFixed(1)}°E`);
    }
    for (const latitude of d3.ticks(southwest[1], northeast[1], 4)) {
      const y = projection([southwest[0], latitude])[1];
      if (y < top + 10 || y > bottom - 10) continue;
      grid.append("line").attr("x1", left).attr("x2", right).attr("y1", y).attr("y2", y);
      axis.append("text").attr("x", left - 6).attr("y", y + 4).attr("text-anchor", "end").text(`${latitude.toFixed(1)}°N`);
    }
  }

  drawLabels(map, geoPath, { left, top, right, bottom }) {
    const labels = map.append("g").attr("class", "map-labels");
    const occupied = [];
    for (const feature of this.baseMap.prefectures) {
      if (geoPath.area(feature) < 1500) continue;
      const [x, y] = geoPath.centroid(feature);
      const name = feature.properties.nam_ja;
      const halfWidth = name.length * 6;
      if (x < left + halfWidth + 4 || x > right - halfWidth - 4 || y < top + 12 || y > bottom - 10) continue;
      if (occupied.some((label) => Math.abs(label.x - x) < label.halfWidth + halfWidth + 8 && Math.abs(label.y - y) < 20)) continue;
      occupied.push({ x, y, halfWidth });
      labels.append("text").attr("x", x).attr("y", y).attr("text-anchor", "middle").text(name);
    }
  }
}
