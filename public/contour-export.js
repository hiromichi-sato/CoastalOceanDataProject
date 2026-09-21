/* NetCDF classic writer. All fixed-size variables are big endian (CDF-1). */
(function (root) {
  const encoder = new TextEncoder();
  const pad = (n) => (n + 3) & ~3;
  function netcdf(grid, metadata) {
    const { cols, rows, values, longitude, latitude, water } = grid;
    if (values.length !== cols * rows || longitude.length !== cols || latitude.length !== rows) throw new Error('Invalid grid dimensions');
    const fill = 9.969209968386869e36;
    const variables = [
      { name: 'longitude', dims: [1], data: longitude, attrs: { standard_name: 'longitude', units: 'degrees_east', axis: 'X' } },
      { name: 'latitude', dims: [0], data: latitude, attrs: { standard_name: 'latitude', units: 'degrees_north', axis: 'Y' } },
      { name: 'value', dims: [0, 1], data: values.map((v, i) => water[i] && Number.isFinite(v) ? v : fill), attrs: { long_name: metadata.metric || 'Interpolated value', coordinates: 'latitude longitude', _FillValue: fill, ...(metadata.unit ? { units: metadata.unit } : {}) } },
      { name: 'water_mask', dims: [0, 1], data: water.map(Number), attrs: { long_name: 'Cell center is water within the displayed map frame (1), excluded (0)' } }
    ];
    if (grid.anchors) {
      const fixed = new Map(grid.anchors);
      variables.push({ name: 'fixed_value', dims: [0, 1], data: values.map((_, i) => fixed.has(i) ? fixed.get(i) : fill), attrs: { long_name: 'Dirichlet observation constraints', _FillValue: fill } });
      variables.push({ name: 'solved_mask', dims: [0, 1], data: values.map((v) => Number(Number.isFinite(v))), attrs: { long_name: 'Cells connected to observation constraints' } });
      for (const direction of ['east', 'south']) variables.push({ name: direction + '_open', dims: [0, 1], data: grid[direction].map(Number), attrs: { long_name: 'Water connectivity to ' + direction + ' cell; outer boundary remains closed' } });
    }
    function header(offsets) {
      const bytes = [];
      const u32 = (v) => bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      const str = (s) => { const b = encoder.encode(s); u32(b.length); for (const byte of b) bytes.push(byte); while (bytes.length % 4) bytes.push(0); };
      function attrs(obj) {
        const entries = Object.entries(obj);
        u32(entries.length ? 12 : 0); u32(entries.length);
        for (const [key, val] of entries) {
          str(key);
          if (typeof val === 'number') {
            u32(6); u32(1);
            const b = new ArrayBuffer(8); new DataView(b).setFloat64(0, val); bytes.push(...new Uint8Array(b));
          } else { u32(2); str(String(val)); }
        }
      }
      bytes.push(67, 68, 70, 1); u32(0);
      u32(10); u32(2); str('latitude'); u32(rows); str('longitude'); u32(cols);
      attrs({ Conventions: 'CF-1.8', title: 'Aqua Level Lab displayed contour grid', history: metadata.createdAt, processing_metadata: JSON.stringify(metadata) });
      u32(11); u32(variables.length);
      variables.forEach((v, i) => { str(v.name); u32(v.dims.length); v.dims.forEach(u32); attrs(v.attrs); u32(6); u32(pad(v.data.length * 8)); u32(offsets[i] || 0); });
      return Uint8Array.from(bytes);
    }
    let size = header([]).length;
    const offsets = variables.map((v) => { const at = size; size += pad(v.data.length * 8); return at; });
    const output = new Uint8Array(size); output.set(header(offsets));
    const view = new DataView(output.buffer);
    variables.forEach((v, i) => v.data.forEach((value, j) => view.setFloat64(offsets[i] + j * 8, value)));
    return output;
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function shapefile(bands, metadata) {
    if (!bands.length) throw new Error('出力できる海域のコンターがありません。');
    const features = bands.map((band) => ({ type: 'Feature', properties: { lower: band.lower, upper: band.upper, metric: metadata.metricKey || '', is_demo: metadata.mode === 'demo' ? 1 : 0 }, geometry: { type: 'MultiPolygon', coordinates: band.coordinates } }));
    const archive = await root.shpwrite.zip({ type: 'FeatureCollection', features }, { outputType: 'arraybuffer', compression: 'DEFLATE', types: { polygon: 'contour_bands' } });
    const zip = await root.JSZip.loadAsync(archive);
    for (const name of Object.keys(zip.files)) if (name.endsWith('.dbf')) zip.file(name.replace(/\.dbf$/, '.cpg'), 'UTF-8');
    zip.file('metadata.json', JSON.stringify(metadata, null, 2));
    zip.file('README.txt', 'CRS: WGS 84 (EPSG:4326). Polygon contour bands clipped to the displayed sea area.\nlower: inclusive lower threshold; upper: next threshold (last band includes maximum).\nSee metadata.json for source and interpolation limitations.\n');
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }
  root.AquaExport = { netcdf, shapefile, download };
})(globalThis);
