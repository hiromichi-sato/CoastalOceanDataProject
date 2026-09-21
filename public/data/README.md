# Coastline Data

`japan.topo.json` is the unmodified `japan.topojson` from dataofjapan/land.

- Original map: Geospatial Information Authority of Japan, Global Map Japan.
  https://www.gsi.go.jp/kankyochiri/gm_jpn.html
- TopoJSON conversion and prefecture properties: dataofjapan.
  https://github.com/dataofjapan/land
- Pinned source:
  https://raw.githubusercontent.com/dataofjapan/land/01d9c03b92c4b7280cefd3da6b7c76e8b7a746e5/japan.topojson
- SHA-256: `eca320674e2a5aa6bffe641bb4cd67a18f6a816b340a7e0aec29a784b6386753`

The original provider's content terms apply. The map UI attributes both the
original provider and the conversion. This is a generalized background map,
not a current survey of ports, reclamation, or shoreline change.

At display time, TopoJSON Client merges prefectures into land polygons, and
D3 projects land and observations using the same Mercator projection. Land
polygons mask the interpolated field, including islands and polygon holes.
Observation coordinates are not moved or discarded based on the land mask.
The display mask does not change the IDW calculation into a coastline-aware
hydrodynamic model. Geographic coverage of this background is Japan.

## Bundled Libraries

- D3 7.9.0: https://github.com/d3/d3/tree/v7.9.0
  License: `../vendor/d3.LICENSE`
- TopoJSON Client 3.1.0: https://github.com/topojson/topojson-client/tree/v3.1.0
  License: `../vendor/topojson-client.LICENSE`

Both browser libraries and the background map are served locally. No external
map tiles, API keys, or additional runtime npm installation are required.
