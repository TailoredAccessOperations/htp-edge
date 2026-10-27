/**
 * /maps/ — the GPS reference pin, plus the curated OSINT set.
 * External module so the strict script-src can run it.
 */

import {
  LAYER_COLOR,
  LAYERS,
  LAYER_FILES,
  layerSummary,
  popupHtml,
  selectDataset,
} from './dataset.js';

const AGGREGATE_URL = '/osint/api/aggregate?limit=32';

async function readJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const doc = await res.json();
  return doc && typeof doc === 'object' ? doc : null;
}

async function loadDocuments() {
  const docs = {};
  await Promise.all(
    LAYERS.map(async (name) => {
      try {
        docs[name] = await readJson(LAYER_FILES[name]);
      } catch {
        docs[name] = null;
      }
    }),
  );
  return docs;
}

async function loadDataset() {
  let aggregate = null;
  try {
    aggregate = await readJson(AGGREGATE_URL);
  } catch {
    aggregate = null;
  }
  if (aggregate && aggregate.ok === true && Array.isArray(aggregate.points)) {
    return selectDataset(aggregate, null);
  }
  let docs = {};
  try {
    docs = await loadDocuments();
  } catch {
    docs = {};
  }
  return selectDataset(null, docs);
}

function statusLine(dataset) {
  const n = dataset.points.length;
  const how = dataset.scored ? 'E8 scored' : 'static files';
  if (!n) return `Curated set unavailable (${how})`;
  return `Curated synthetic samples · ${n} plotted · ${how}`;
}

function renderLegend(list, dataset, groups, map) {
  list.replaceChildren();
  for (const row of layerSummary(dataset)) {
    const li = document.createElement('li');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = row.plotted > 0;
    box.disabled = row.plotted === 0;
    box.id = `layer-${row.name}`;
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = row.color;
    const label = document.createElement('label');
    label.htmlFor = box.id;
    label.textContent = row.error
      ? `${row.name} unavailable`
      : `${row.name} · ${row.plotted}`;
    box.addEventListener('change', () => {
      const group = groups[row.name];
      if (!group) return;
      if (box.checked) group.addTo(map);
      else map.removeLayer(group);
    });
    li.append(box, swatch, label);
    list.append(li);
  }
}

export async function bootMap(root = document) {
  const title = root.getElementById('title');
  const address = root.getElementById('address');
  const setStatus = root.getElementById('set-status');
  const directions = root.getElementById('directions');
  const legend = root.getElementById('legend');
  const fit = root.getElementById('fit');
  const home = root.getElementById('home');
  const Leaflet = globalThis.L;
  if (!Leaflet) {
    if (setStatus) setStatus.textContent = 'Map library failed to load';
    return;
  }

  let ref = null;
  try {
    ref = await readJson('/maps/gps-ref.json');
  } catch {
    ref = null;
  }
  const lat = Number(ref?.coordinates?.lat);
  const lon = Number(ref?.coordinates?.lon);
  const hasRef = Number.isFinite(lat) && Number.isFinite(lon);
  if (title) title.textContent = ref?.target || 'Reference';
  if (address) address.textContent = ref?.address || 'Reference coordinates unavailable';
  if (hasRef && directions) {
    const q = encodeURIComponent(ref.target || 'Reference');
    directions.href = `https://maps.apple.com/?ll=${lat},${lon}&q=${q}`;
  }

  const view = hasRef ? [lat, lon] : [20, 0];
  const map = Leaflet.map('map', { zoomControl: false }).setView(view, hasRef ? 16 : 2);
  Leaflet.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri' },
  ).addTo(map);

  if (hasRef) {
    Leaflet.marker([lat, lon])
      .addTo(map)
      .bindPopup(ref.target || 'Reference')
      .openPopup();
  }

  const dataset = await loadDataset();
  if (setStatus) setStatus.textContent = statusLine(dataset);

  const groups = {};
  for (const name of LAYERS) {
    groups[name] = Leaflet.layerGroup();
  }
  for (const point of dataset.points) {
    const marker = Leaflet.circleMarker([point.lat, point.lon], {
      radius: 6,
      color: '#111',
      weight: 1,
      fillColor: LAYER_COLOR[point.layer],
      fillOpacity: 0.92,
    });
    marker.bindPopup(popupHtml(point));
    marker.addTo(groups[point.layer]);
  }
  for (const name of LAYERS) {
    if (groups[name].getLayers().length) groups[name].addTo(map);
  }
  if (legend) renderLegend(legend, dataset, groups, map);

  const fitCurated = () => {
    const visible = dataset.points.filter((point) => map.hasLayer(groups[point.layer]));
    if (!visible.length) return;
    const bounds = Leaflet.latLngBounds(visible.map((point) => [point.lat, point.lon]));
    if (hasRef) bounds.extend([lat, lon]);
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 6 });
  };
  fit?.addEventListener('click', fitCurated);
  home?.addEventListener('click', () => {
    if (hasRef) map.setView([lat, lon], 16);
  });
  if (new URLSearchParams(location.search).get('fit') === '1') fitCurated();
}

bootMap();
