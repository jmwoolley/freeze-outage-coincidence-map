const config = window.MAP_CONFIG || {};
const appVersion = config.version || "20260706e";
const dataUrl = config.dataUrl || "data/exposure.json";
const areaLabel = config.areaLabel || "the United States";
const initialView = config.initialView || { center: [39.5, -98.35], zoom: 4 };
const map = L.map("map", { zoomControl: true, attributionControl: false, maxZoom: 10 })
  .setView(initialView.center, initialView.zoom);
const geographyPane = map.createPane("baseGeography");
geographyPane.style.zIndex = 350;
geographyPane.style.pointerEvents = "none";
const boundaryPane = map.createPane("stateBorders");
boundaryPane.style.zIndex = 450;
boundaryPane.style.pointerEvents = "none";

fetch("data/countries-50m.json").then(response => {
  if (!response.ok) throw new Error(`Basemap request failed: ${response.status}`);
  return response.json();
}).then(world => {
  L.geoJSON(topojson.feature(world, world.objects.countries), {
    pane: "baseGeography",
    renderer: L.canvas({ pane: "baseGeography" }),
    interactive: false,
    style: { color: "#b5bec2", weight: 0.7, fillColor: "#f5f5f2", fillOpacity: 1 }
  }).addTo(map);
}).catch(error => console.warn("Country basemap unavailable:", error));

const colors = ["#f7fbff", "#d6e9f2", "#9fc9da", "#5e9eb8", "#23708f", "#083d56"];
let exposure;
let countyByFips = new Map();
let metricIndex = new Map();
let layer;
let selectedFeature = null;

function fmt(value, digits = 0) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function updateSubtitle() {
  const count = fmt(exposure.counties.length);
  document.getElementById("subtitle").textContent = `For all ${count} counties in ${areaLabel}`;
}

function selectedYears() {
  const start = Number(document.getElementById("startYear").value);
  const end = Number(document.getElementById("endYear").value);
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return exposure.meta.years.slice(lo, hi + 1);
}

function metricKey() {
  const condition = document.getElementById("condition").value;
  const outage = document.getElementById("outage").value;
  const temperature = document.getElementById("temperature").value;
  const duration = exposure.meta.min_durations[Number(document.getElementById("duration").value)];
  if (condition === "temp") return `${temperature}_dur_${duration}h`;
  if (condition === "outage") return `${outage}_dur_${duration}h`;
  return `combined_${outage.replace("outage_", "")}_${temperature}_dur_${duration}h`;
}

function metricBaseKey() {
  return metricKey().replace(/_dur_\d+h$/, "");
}

function annualMetric(row, year, key) {
  const metrics = row?.annual?.[String(year)];
  if (!metrics) return 0;
  if (Array.isArray(metrics)) {
    const idx = metricIndex.get(key);
    return idx == null ? 0 : (metrics[idx] || 0);
  }
  return metrics[key] || 0;
}

function annualValues(row, key) {
  return selectedYears().map(year => annualMetric(row, year, key));
}

function totalExposure(row) {
  return annualValues(row, metricKey()).reduce((sum, value) => sum + value, 0);
}

function maxAnnualExposure(row) {
  return Math.max(0, ...annualValues(row, metricKey()));
}

function highestCountYear(row) {
  const values = selectedYears().map(year => [year, annualMetric(row, year, metricKey())]);
  return values.reduce((best, current) => current[1] > best[1] ? current : best, [null, 0]);
}

function maxContinuous(row) {
  const key = `${metricBaseKey()}_max_continuous`;
  return Math.max(0, ...annualValues(row, key));
}

function displayedValue(row) {
  const mode = document.getElementById("scaleMode").value;
  return mode === "maxAnnual" ? maxAnnualExposure(row) : totalExposure(row);
}

function colorFor(value) {
  if (!value || value <= 0) return "#eef2f4";
  if (value < 1) return colors[0];
  if (value < 4) return colors[1];
  if (value < 12) return colors[2];
  if (value < 24) return colors[3];
  if (value < 72) return colors[4];
  return colors[5];
}

function styleFeature(feature) {
  const fips = String(feature.id || feature.properties.fips).padStart(5, "0");
  const row = countyByFips.get(fips);
  return {
    color: "#8b979d",
    weight: 0.5,
    fillColor: colorFor(row ? displayedValue(row) : 0),
    fillOpacity: 0.84
  };
}

function selectCounty(feature) {
  selectedFeature = feature;
  const fips = String(feature.id || feature.properties.fips).padStart(5, "0");
  const row = countyByFips.get(fips);
  document.getElementById("countyName").textContent = row ? `${row.name}, ${row.state}` : `County ${fips}`;
  document.getElementById("exposureHours").textContent = fmt(totalExposure(row), 1);
  document.getElementById("maxAnnualExposure").textContent = fmt(maxAnnualExposure(row), 1);
  document.getElementById("maxContinuous").textContent = fmt(maxContinuous(row), 1);
  document.getElementById("customers").textContent = fmt(row?.customers);
  updateNarrative(row);
}

function setupControls() {
  const years = exposure.meta.years;
  const firstYear = 0;
  const lastYear = years.length - 1;
  for (const id of ["startYear", "endYear"]) {
    const input = document.getElementById(id);
    input.min = firstYear;
    input.max = lastYear;
    input.value = id === "startYear" ? firstYear : lastYear;
    input.disabled = firstYear === lastYear;
    input.addEventListener("input", () => {
      updateYearLabels();
      refresh();
    });
  }
  updateYearLabels();
  document.getElementById("availableYears").textContent =
    `Available full outage years: ${formatYearList(years)}.`;

  const condition = document.getElementById("condition");
  [
    ["combined", "Freezing during outage"],
    ["temp", "Freezing temperature only"],
    ["outage", "Power outage only"]
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    condition.appendChild(option);
  });

  const outage = document.getElementById("outage");
  exposure.meta.outage_thresholds.forEach(value => {
    const option = document.createElement("option");
    option.value = `outage_abs_${value}`;
    option.textContent = value === 1 ? "Any reported outage" : `At least ${fmt(value)} customers out`;
    outage.appendChild(option);
  });
  exposure.meta.pct_thresholds.forEach(value => {
    const option = document.createElement("option");
    option.value = `outage_pct_${value}`;
    option.textContent = `At least ${value}% of customers out`;
    outage.appendChild(option);
  });

  const temperature = document.getElementById("temperature");
  exposure.meta.freeze_thresholds.forEach(value => {
    const option = document.createElement("option");
    option.value = `temp_${value}`;
    option.textContent = `${value} \u00b0F or colder`;
    if (Number(value) === 32) option.selected = true;
    temperature.appendChild(option);
  });

  const duration = document.getElementById("duration");
  duration.max = exposure.meta.min_durations.length - 1;
  duration.value = Math.min(2, exposure.meta.min_durations.length - 1);
  updateDurationLabel();

  condition.addEventListener("change", refresh);
  outage.addEventListener("change", refresh);
  temperature.addEventListener("change", refresh);
  document.getElementById("scaleMode").addEventListener("change", refresh);
  duration.addEventListener("input", () => {
    updateDurationLabel();
    refresh();
  });
}

function updateYearLabels() {
  const start = Number(document.getElementById("startYear").value);
  const end = Number(document.getElementById("endYear").value);
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const max = Number(document.getElementById("startYear").max);
  const loPct = max ? (lo / max) * 100 : 0;
  const hiPct = max ? (hi / max) * 100 : 100;
  const startYear = exposure.meta.years[lo];
  const endYear = exposure.meta.years[hi];
  const stack = document.querySelector(".range-stack");
  stack.style.setProperty("--range-lo", `${loPct}%`);
  stack.style.setProperty("--range-hi", `${hiPct}%`);
  document.getElementById("yearRangeValue").textContent = startYear === endYear ? `${startYear}` : `${startYear}-${endYear}`;
}

function formatYearList(years) {
  const spans = [];
  let start = years[0];
  let prev = years[0];
  for (const year of years.slice(1)) {
    if (year === prev + 1) {
      prev = year;
      continue;
    }
    spans.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = year;
    prev = year;
  }
  spans.push(start === prev ? `${start}` : `${start}-${prev}`);
  return spans.join(", ");
}

function updateDurationLabel() {
  const idx = Number(document.getElementById("duration").value);
  document.getElementById("durationValue").textContent = `${exposure.meta.min_durations[idx]}+ hours`;
}

function selectedYearLabel() {
  const years = selectedYears();
  return years.length === 1 ? `${years[0]}` : `${years[0]}-${years[years.length - 1]}`;
}

function selectedCountyName(row) {
  return row ? `${row.name}, ${row.state}` : "the selected county";
}

function outageDescription() {
  return document.getElementById("outage").selectedOptions[0]?.textContent.toLowerCase() || "the selected outage threshold";
}

function temperatureDescription() {
  return document.getElementById("temperature").selectedOptions[0]?.textContent.toLowerCase() || "the selected temperature threshold";
}

function conditionDescription() {
  const condition = document.getElementById("condition").value;
  if (condition === "temp") return `the outdoor temperature was ${temperatureDescription()}`;
  if (condition === "outage") return `${outageDescription()} was reported`;
  return `${outageDescription()} was reported while the outdoor temperature was ${temperatureDescription()}`;
}

function updateNarrative(row) {
  const el = document.getElementById("metricNarrative");
  if (!el) return;
  if (!row) {
    el.textContent = "Select a county to see a county-specific interpretation of the active filters and metrics.";
    return;
  }
  const [peakYear, peakHours] = highestCountYear(row);
  const duration = exposure.meta.min_durations[Number(document.getElementById("duration").value)];
  el.textContent =
    `Between ${selectedYearLabel()}, ${selectedCountyName(row)} had ${fmt(row.customers)} customers. ` +
    `There were ${fmt(totalExposure(row), 1)} hours in qualifying continuous runs of ${duration}+ hours where ${conditionDescription()}. ` +
    `The longest continuous run at this condition was ${fmt(maxContinuous(row), 1)} hours. ` +
    `The highest-count year in the selected range was ${peakYear}, with ${fmt(peakHours, 1)} hours at this condition.`;
}

function refresh() {
  if (layer) layer.setStyle(styleFeature);
  if (selectedFeature) selectCounty(selectedFeature);
  else updateNarrative(null);
}

function drawLegend() {
  const bins = [
    ["0", "#eef2f4"],
    ["<1", colors[0]],
    ["1-4", colors[1]],
    ["4-12", colors[2]],
    ["12-24", colors[3]],
    ["24-72", colors[4]],
    ["72+", colors[5]],
  ];
  const el = document.getElementById("legendScale");
  el.innerHTML = "";
  bins.forEach(([label, color]) => {
    const row = document.createElement("div");
    row.className = "swatch";
    row.innerHTML = `<span class="chip" style="background:${color}"></span><span>${label} hours</span>`;
    el.appendChild(row);
  });
}

Promise.all([
  fetch(`data/counties-10m.json?v=${appVersion}`, { cache: "no-store" }).then(r => r.json()),
  fetch(`${dataUrl}?v=${appVersion}`, { cache: "no-store" }).then(r => r.json())
]).then(([topology, data]) => {
  exposure = data;
  metricIndex = new Map((data.meta.metric_keys || []).map((key, idx) => [key, idx]));
  countyByFips = new Map(data.counties.map(row => [row.fips, row]));
  updateSubtitle();
  setupControls();
  drawLegend();
  const allCounties = topojson.feature(topology, topology.objects.counties);
  const geojson = {
    type: "FeatureCollection",
    features: allCounties.features.filter(feature => {
      const fips = String(feature.id || feature.properties.fips).padStart(5, "0");
      return countyByFips.has(fips);
    })
  };
  layer = L.geoJSON(geojson, {
    style: styleFeature,
    onEachFeature: (feature, lyr) => {
      lyr.on({
        click: () => selectCounty(feature),
        mouseover: () => lyr.setStyle({ weight: 1.5, color: "#1d252b" }),
        mouseout: () => layer.resetStyle(lyr)
      });
    }
  }).addTo(map);
  const states = topojson.mesh(topology, topology.objects.states, (a, b) => a !== b);
  L.geoJSON(states, {
    pane: "stateBorders",
    interactive: false,
    style: { color: "#475760", weight: 1, opacity: 0.55 }
  }).addTo(map);
  map.setView(initialView.center, initialView.zoom);
}).catch(err => {
  document.body.innerHTML = `<pre>${err.stack || err}</pre>`;
});
