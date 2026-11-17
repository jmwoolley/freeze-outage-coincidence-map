# Coincident Freeze and Power Outage History

Static interactive Leaflet maps for county-level screening of historical power outage and freezing-temperature overlap.

- `index.html`: full United States view.
- `california.html`: California-only view.

The app is static HTML, CSS, JavaScript, and JSON data. It can be served by GitHub Pages or another static host.

The label-free basemap uses local geographic data, with no tile service or API key. `data/countries-50m.json` is the [world-atlas 2.0.2](https://github.com/topojson/world-atlas) distribution of [Natural Earth public-domain boundary data](https://www.naturalearthdata.com/about/terms-of-use/). U.S. state borders are derived from the existing `data/counties-10m.json` topology.
