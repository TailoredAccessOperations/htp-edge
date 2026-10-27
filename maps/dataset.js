/**
 * Curated OSINT set for /maps/.
 *
 * Prefers the scored aggregate (`/osint/api/aggregate`). When that route is
 * absent, samples the same public files the aggregate reads. Points are the
 * labeled synthetic samples, not a live tracking feed.
 */

export const LAYERS = Object.freeze(['planes', 'trains', 'cctv', 'ips', 'intel']);

export const LAYER_COLOR = Object.freeze({
  planes: '#7ec8ff',
  trains: '#ffd76a',
  cctv: '#ff6b8a',
  ips: '#c4b5fd',
  intel: '#ff9f43',
});

export const LAYER_FILES = Object.freeze({
  planes: '/osint/data/planes.json',
  trains: '/osint/data/trains.json',
  cctv: '/osint/data/cctv.json',
  ips: '/osint/data/ips.json',
  intel: '/osint/data/intel.json',
});

const SAMPLE_LIMIT = 32;

function sampleEven(items, limit) {
  if (items.length <= limit) return items;
  const out = [];
  for (let i = 0; i < limit; i++) {
    out.push(items[Math.floor((i * items.length) / limit)]);
  }
  return out;
}

function finitePair(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return [la, lo];
}

function labelOf(item, index) {
  const raw = item.callsign || item.line || item.name || item.ip || item.title || item.id;
  const text = raw == null ? '' : String(raw).trim();
  if (text && text.length <= 80) return text;
  return item.id == null ? String(index) : String(item.id);
}

export function pointsFromDocument(doc, layerName, limit = SAMPLE_LIMIT) {
  const items = Array.isArray(doc?.items) ? doc.items : [];
  const located = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    const pair = finitePair(item.lat, item.lon);
    if (!pair) continue;
    located.push({ item, index: i, lat: pair[0], lon: pair[1] });
  }
  return sampleEven(located, limit).map(({ item, index, lat, lon }) => ({
    id: item.id == null ? String(index) : String(item.id),
    layer: layerName,
    lat,
    lon,
    label: labelOf(item, index),
    predicted: '',
    score: null,
  }));
}

export function pointsFromAggregate(body) {
  const rows = Array.isArray(body?.points) ? body.points : [];
  const points = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (!LAYERS.includes(row.layer)) continue;
    const pair = finitePair(row.lat, row.lon);
    if (!pair) continue;
    const id = row.id == null ? '' : String(row.id);
    points.push({
      id,
      layer: row.layer,
      lat: pair[0],
      lon: pair[1],
      label: id || row.layer,
      predicted: typeof row.predicted === 'string' ? row.predicted : '',
      score: Number.isFinite(Number(row.score)) ? Number(row.score) : null,
    });
  }
  return points;
}

export function datasetFromDocuments(docs, limit = SAMPLE_LIMIT) {
  const layers = {};
  const points = [];
  for (const name of LAYERS) {
    const doc = docs?.[name];
    if (!doc) {
      layers[name] = { count: 0, error: 'unavailable' };
      continue;
    }
    const items = Array.isArray(doc.items) ? doc.items : [];
    layers[name] = { count: items.length };
    points.push(...pointsFromDocument(doc, name, limit));
  }
  return { scored: false, curated: true, layers, points };
}

/** Scored aggregate wins. A missing route falls back to the static files. */
export function selectDataset(aggregate, docs, limit = SAMPLE_LIMIT) {
  if (aggregate && aggregate.ok === true && Array.isArray(aggregate.points)) {
    const layers =
      aggregate.layers && typeof aggregate.layers === 'object' ? aggregate.layers : {};
    return {
      scored: true,
      curated: aggregate.curated !== false,
      layers,
      points: pointsFromAggregate(aggregate),
    };
  }
  return datasetFromDocuments(docs, limit);
}

export function layerSummary(dataset) {
  return LAYERS.map((name) => ({
    name,
    color: LAYER_COLOR[name],
    plotted: dataset.points.filter((point) => point.layer === name).length,
    error: dataset.layers?.[name]?.error || '',
  }));
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

export function popupHtml(point) {
  const title = point.label || point.id || point.layer;
  const bits = [point.layer, 'curated'];
  if (point.predicted) bits.splice(1, 0, point.predicted);
  if (point.score != null) bits.splice(point.predicted ? 2 : 1, 0, point.score.toFixed(2));
  const q = encodeURIComponent(title);
  const apple = `https://maps.apple.com/?ll=${point.lat},${point.lon}&q=${q}`;
  return (
    `<strong>${escapeHtml(title)}</strong><br>` +
    `${escapeHtml(bits.join(' · '))}<br>` +
    `<a href="${apple}">Apple Maps</a>`
  );
}
