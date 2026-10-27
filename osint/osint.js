/**
 * HTP OSINT — /osint visual GEOINT client.
 *
 * Reads the selected image locally (file info, camera EXIF, GPS EXIF, capture
 * time), POSTs the pixels to /osint/api/analyze for a vision-model geolocation
 * lead, and renders model + EXIF + manual pins over OpenStreetMap with a
 * confidence circle, reverse-geocoding (proxied via Nominatim), satellite
 * layer toggle and coordinate export. The tool is stateless: nothing is saved.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    drop: $('osint-drop'),
    file: $('osint-file'),
    preview: $('osint-preview'),
    analyze: $('osint-analyze'),
    clear: $('osint-clear'),
    status: $('osint-status'),
    search: $('osint-search'),
    searchForm: $('osint-search-form'),
    searchBtn: $('osint-search-btn'),
    map: $('osint-map'),
    metaFile: $('osint-meta-file'),
    metaDims: $('osint-meta-dims'),
    metaCamera: $('osint-meta-camera'),
    metaGps: $('osint-meta-gps'),
    metaDt: $('osint-meta-dt'),
    evidence: $('osint-evidence'),
    engine: $('osint-engine'),
    place: $('osint-place'),
    country: $('osint-country'),
    coord: $('osint-coord'),
    confVal: $('osint-conf-val'),
    confFill: $('osint-conf-fill'),
    radius: $('osint-radius'),
    clues: $('osint-clues'),
    reasoning: $('osint-reasoning'),
    reverse: $('osint-reverse'),
    reverseOut: $('osint-reverse-out'),
    copy: $('osint-copy'),
    open: $('osint-open'),
    feedContent: $('osint-feed-content'),
    hudClock: $('osint-hud-clock'),
    hudLat: $('osint-hud-lat'),
    hudLon: $('osint-hud-lon'),
    hudZoom: $('osint-hud-zoom'),
  };

  const fmt = {
    bytes: (n) =>
      n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B',
    coord: (lat, lon) =>
      Math.abs(lat).toFixed(5) + '° ' + (lat >= 0 ? 'N' : 'S') + ' · ' +
      Math.abs(lon).toFixed(5) + '° ' + (lon >= 0 ? 'E' : 'W'),
    deg: (d, min, sec, ref) => {
      const v = d + min / 60 + sec / 3600;
      return { v, str: Math.abs(v).toFixed(6) + '°' + ref };
    },
  };

  const state = {
    fileMeta: null,
    exif: null,
    model: null,
    pins: {},
    markers: {},
    circle: null,
    line: null,
    points: new Set(),
  };

  // ── Status ───────────────────────────────────────────────────────────────

  // ── Intel Feed ─────────────────────────────────────────────────────────────
  
  async function updateIntelFeed() {
    if (!el.feedContent) return;
    try {
      const res = await fetch('/osint/api/intel/fetch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok || !data.stories) return;

      el.feedContent.innerHTML = '';
      data.stories.forEach(s => {
        const item = document.createElement('div');
        item.className = 'osint-feed-item';
        item.innerHTML = `
          <span class="osint-feed-item-time">${s.time || 'NOW'}</span>
          <div class="osint-feed-item-main">
            <div class="osint-feed-item-text">${s.title}</div>
            <div class="osint-feed-item-loc">${s.city || s.country || 'UNKNOWN'}</div>
          </div>
        `;
        item.addEventListener('click', () => {
          if (s.lat && s.lon) {
            setLayer('osm');
            pin('manual', L.latLng(s.lat, s.lon), true);
            map.setView([s.lat, s.lon], 12);
            status('INTEL SIGHTING → ' + s.title, 'ok');
          }
        });
        el.feedContent.appendChild(item);
      });
    } catch (e) { console.error('Intel feed failed', e); }
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────

  function updateHUD() {
    const center = map.getCenter();
    el.hudLat.textContent = center.lat.toFixed(4);
    el.hudLon.textContent = center.lng.toFixed(4);
    el.hudZoom.textContent = map.getZoom();
    el.hudClock.textContent = new Date().toISOString().split('T')[1].split('.')[0] + ' UTC';
  }

  // HUD timers are started after Leaflet creates `map` below.

  // ── Ghost backdrop (deferred until the visitor actually touches the page) ──
  //
  // #ghost-bg used to carry an `autoplay` attribute, which made the browser pull
  // the 1.7MB ghost.webm before the tool was usable — 92% of this page's
  // transfer weight, spent on a decorative layer that sits at opacity .32 behind
  // the matrix rain. The markup now ships preload="none" and keeps the poster
  // (imgs/ghost.webp) as the resting state, so the page looks identical until
  // the video is actually wanted. First real gesture starts it, reusing the
  // shared arbiter from /js/init.js. Same policy as the homepage tap-to-start.
  (function ghostBackdrop() {
    const v = $('ghost-bg');
    if (!v) return;
    const start = () => {
      v.preload = 'metadata';
      const p = v.play();
      if (p && p.catch) p.catch(() => { /* autoplay refused; poster stands in */ });
    };
    if (window.__htpMedia) {
      window.__htpMedia.onGesture(start);
      window.__htpMedia.armed();
    } else {
      // init.js missing: fall back to a plain listener rather than never playing.
      addEventListener('pointerdown', start, { once: true, passive: true });
      addEventListener('touchstart', start, { once: true, passive: true });
    }
  })();

  function status(text, kind) {
    el.status.textContent = text;
    el.status.dataset.state = kind || 'idle';
  }

  // ── Matrix rain (kept cheap: ~800 columns) ───────────────────────────────

  (function matrix() {
    const c = $('osint-matrix');
    if (!c) return;
    const ctx = c.getContext('2d');
    const glyph = '01アイウエオカキクケコサシスセソタチツテト₿1337$#@';
    const cols = 90;
    const drops = new Array(cols).fill(0);
    function resize() {
      c.width = (c.clientWidth || innerWidth) / 2;
      c.height = (c.clientHeight || innerHeight) / 2;
    }
    resize();
    addEventListener('resize', resize);
    function tick() {
      ctx.fillStyle = 'rgba(2,7,9,0.10)';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#3ed678';
      ctx.font = '11px monospace';
      for (let i = 0; i < cols; i++) {
        const ch = glyph[Math.floor(Math.random() * glyph.length)];
        ctx.fillText(ch, i * 11, drops[i] * 11);
        if (drops[i] * 11 > c.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    }
    function schedule() {
      clearInterval(t);
      tick();
      t = setInterval(() => document.hidden || tick(), 55);
    }
    let t;
    schedule();
    // Partial navigation must not leave a 55ms timer painting into a detached
    // canvas. The listener is anonymous, so it is held in a ref we can drop.
    const onVis = () => { if (!document.hidden) schedule(); };
    document.addEventListener('visibilitychange', onVis);
    if (window.__htpTeardown) {
      window.__htpTeardown.add(() => {
        clearInterval(t);
        document.removeEventListener('visibilitychange', onVis);
      });
    }
  })();

  // ── EXIF (JPEG APP1 + TIFF walk) ─────────────────────────────────────────

  function exifAscii(dv, le, off, len) {
    let s = '';
    for (let i = 0; i < len && dv.byteLength > off + i; i++) {
      const ch = dv.getUint8(off + i);
      if (ch === 0) break;
      s += String.fromCharCode(ch);
    }
    return s.trim();
  }
  function exifRational(dv, le, off) {
    const n = dv.getUint32(off, le);
    const d = dv.getUint32(off + 4, le);
    return d === 0 ? 0 : n / d;
  }
  function walkIfd(dv, le, start, wantOf) {
    const u16 = (o) => dv.getUint16(o, le);
    const u32 = (o) => dv.getUint32(o, le);
    const out = {};
    const count = u16(start);
    for (let i = 0; i < count; i++) {
      const e = start + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const n = u32(e + 4);
      const valOff = e + 8;
      if (wantOf && wantOf.indexOf(tag) !== -1) out[tag] = start + u32(valOff);
      // inline vs pointer: size = typeSize * n
      const size = (type === 2 ? 1 : type === 1 || type === 6 || type === 7 ? 1 : type === 3 || type === 8 ? 2 : type === 5 || type === 10 ? 8 : 4) * n;
      if (type === 2 && n <= 4 && size <= 4) out['ascii:' + tag] = exifAscii(dv, le, valOff, n);
      else if ((type === 5 || type === 10) && n > 0 && size <= 512) {
        const p = start + u32(valOff);
        if (n === 1) out['rat:' + tag] = exifRational(dv, le, p);
        else {
          const arr = [];
          for (let k = 0; k < n; k++) arr.push(exifRational(dv, le, p + k * 8));
          out['rat:' + tag] = arr;
        }
      }
    }
    return out;
  }

  function parseExif(buffer) {
    const dv = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return {};
    let off = 2;
    while (off + 4 <= bytes.length) {
      if (bytes[off] !== 0xff) break;
      const marker = bytes[off + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const size = dv.getUint16(off + 2);
      if (marker === 0xe1 && size >= 14) {
        const isExif = bytes[off + 4] === 0x45 && bytes[off + 5] === 0x78 && bytes[off + 6] === 0x69 &&
          bytes[off + 7] === 0x66 && bytes[off + 8] === 0 && bytes[off + 9] === 0;
        if (isExif) return parseTiff(buffer, off + 10);
      }
      off += 2 + size;
    }
    return {};
  }

  function parseTiff(buffer, t) {
    const dv = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    if (t + 8 > bytes.length) return {};
    const first = dv.getUint16(t);
    const le = first === 0x4949;
    const u16 = (o) => dv.getUint16(t + o, le);
    const u32 = (o) => dv.getUint32(t + o, le);
    if (u16(2) !== 42) return {};

    const ifd0 = u32(4);
    const out = {};
    const ifd0rec = walkIfd(dv, le, t + ifd0, [0x8769, 0x8825]);
    if (ifd0rec['ascii:271']) out.make = ifd0rec['ascii:271'];
    if (ifd0rec['ascii:272']) out.model = ifd0rec['ascii:272'];
    if (ifd0rec['ascii:306']) out.dateTime = ifd0rec['ascii:306'];

    if (ifd0rec[0x8769] !== undefined) {
      const ex = walkIfd(dv, le, ifd0rec[0x8769], []);
      if (ex['ascii:36867']) out.dateTime = ex['ascii:36867'];
    }
    if (ifd0rec[0x8825] !== undefined) {
      const g = walkIfd(dv, le, ifd0rec[0x8825], []);
      const latRef = (g['ascii:1'] || 'N').toUpperCase();
      const lonRef = (g['ascii:3'] || 'E').toUpperCase();
      const latArr = g['rat:2'];
      const lonArr = g['rat:4'];
      if (Array.isArray(latArr) && Array.isArray(lonArr) && latArr.length === 3 && lonArr.length === 3) {
        const lat = (latArr[0] + latArr[1] / 60 + latArr[2] / 3600) * (latRef === 'S' ? -1 : 1);
        const lon = (lonArr[0] + lonArr[1] / 60 + lonArr[2] / 3600) * (lonRef === 'W' ? -1 : 1);
        out.gps = { lat, lon, ref: [latRef, lonRef].join('·') };
        if (g['rat:6'] !== undefined) out.alt = Math.round(g['rat:6']);
      }
    }
    return out;
  }

  // ── Image read ───────────────────────────────────────────────────────────

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('could not decode image'));
      img.src = url;
    }).then((dims) => {
      return file.arrayBuffer().then((buf) => {
        const exif = parseExif(buf);
        return { dims, exif };
      });
    });
  }

  async function onFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return status('IMAGE TOO LARGE · ≤ 8 MB', 'err');
    status('READING FRAME…', 'scan');
    let info;
    try {
      info = await readImage(file);
    } catch (err) {
      return status('UNREADABLE IMAGE: ' + (err && err.message ? err.message : err), 'err');
    }
    state.fileMeta = { name: file.name, size: file.size };
    state.exif = info.exif || {};
    state.model = null;

    el.preview.src = URL.createObjectURL(file);
    el.preview.hidden = false;

    el.metaFile.textContent = file.name + ' · ' + fmt.bytes(file.size);
    el.metaDims.textContent = info.dims.width + '×' + info.dims.height + ' px';
    el.metaCamera.textContent = [state.exif.make, state.exif.model].join(' ').trim() || '—';
    el.metaDt.textContent = state.exif.dateTime || '—';

    const hasGps = state.exif.gps && Number.isFinite(state.exif.gps.lat) && Number.isFinite(state.exif.gps.lon);
    el.metaGps.textContent = hasGps ? fmt.coord(state.exif.gps.lat, state.exif.gps.lon) + ' · ' + (state.exif.alt !== undefined ? 'alt ' + state.exif.alt + ' m' : 'gps') : 'none';

    if (hasGps) {
      pin('exif', L.latLng(state.exif.gps.lat, state.exif.gps.lon));
      status('EXIF GPS FOUND · PINNED', 'ok');
    } else {
      status('READY · NO EXIF GPS · RUN ANALYSIS OR PIN MANUALLY', 'idle');
    }
    el.analyze.disabled = false;
    el.analyze.textContent = 'RUN VISUAL ANALYSIS';
    removeZoomHint();
    fitPins();
  }

  // ── Map ──────────────────────────────────────────────────────────────────

  const map = L.map('osint-map', { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([20, 0], 2);
  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
  });
  const layers = { osm: osmLayer, sat: satLayer };
  setInterval(updateIntelFeed, 60000);
  updateIntelFeed();
  setInterval(updateHUD, 1000);
  map.on('move', updateHUD);
  updateHUD();

  function setLayer(name) {
    if (name === 'globe') { enterGlobe(); markLayers(name); return; }
    leaveGlobe();
    for (const k in layers) layers[k][k === name ? 'addTo' : 'removeFrom'](map);
    markLayers(name);
  }
  function markLayers(name) {
    document.querySelectorAll('.osint-layers .osint-btn[data-layer]').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.layer === name));
  }
  document.querySelectorAll('.osint-layers .osint-btn[data-layer]').forEach((b) =>
    b.addEventListener('click', () => setLayer(b.dataset.layer)));

  function markerIcon(kind) {
    return L.divIcon({
      className: 'osint-pin osint-pin-' + kind,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      html: '<span class="osint-pin-ring"></span><span class="osint-pin-dot"></span><span class="osint-pin-cross"></span>',
    });
  }

  function pin(kind, latlng, draggable) {
    const existing = state.markers[kind];
    if (existing) {
      existing.setLatLng(latlng);
      return existing;
    }
    const m = L.marker(latlng, { icon: markerIcon(kind), draggable: !!draggable, title: kind }).addTo(map);
    m.on('dragend', () => {
      if (kind === 'manual') state.pins.manual = m.getLatLng();
      updateDerivedActions();
      el.reverseOut.textContent = '';
    });
    state.markers[kind] = m;
    state.pins[kind] = latlng;
    state.points.add(kind);
    updateDerivedActions();
    return m;
  }

  function removeKind(kind) {
    if (state.markers[kind]) {
      map.removeLayer(state.markers[kind]);
      delete state.markers[kind];
    }
    delete state.pins[kind];
    state.points.delete(kind);
    if (state.circle) {
      map.removeLayer(state.circle);
      state.circle = null;
    }
    if (state.line) {
      map.removeLayer(state.line);
      state.line = null;
    }
    updateDerivedActions();
  }

  function fitPins() {
    const ll = [];
    const sources = Object.keys(state.pins);
    sources.forEach((k) => ll.push(state.pins[k]));
    if (state.circle && state.model) {
      const guess = state.model.guess;
      ll.push([[guess.lat, guess.lon], [guess.lat + guess.radiusKm / 111, guess.lon]]);
    }
    if (ll.length) map.fitBounds(L.latLngBounds(ll).pad(0.3), { maxZoom: 18 });
  }

  function haversineKm(a, b) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function addGapLine() {
    if (state.line) {
      map.removeLayer(state.line);
      state.line = null;
    }
    const edge = state.lineEl;
    if (edge) edge.remove();
    const ex = state.pins.exif;
    const mo = state.pins.model;
    if (!ex || !mo) return;
    state.line = L.polyline([ex, mo], { color: '#e0a63b', weight: 1, dashArray: '3 6', opacity: 0.8 }).addTo(map);
    const gap = haversineKm(ex, mo);
    const div = document.createElement('span');
    div.className = 'osint-gap';
    div.textContent = 'exif ↔ model ' + gap.toFixed(1) + ' km';
    div.style.cssText =
      'position:absolute;z-index:700;left:50%;top:.4rem;transform:translateX(-50%);' +
      'font-family:var(--font-mono);font-size:.62rem;letter-spacing:.1em;color:#e0a63b;' +
      'background:#03080ab8;border:1px dashed var(--line);border-radius:999px;padding:.2rem .6rem;pointer-events:none;';
    el.map.parentElement.appendChild(div);
    state.lineEl = div;
  }

  function removeGapLine() {
    if (state.line) { map.removeLayer(state.line); state.line = null; }
    if (state.lineEl) { state.lineEl.remove(); state.lineEl = null; }
  }

  // ── Derived pin (which pin do reverse/copy/open act on?) ─────────────────

  function currentPin() {
    return state.pins.manual || state.pins.model || state.pins.exif || null;
  }

  function updateDerivedActions() {
    const pin = currentPin();
    const ready = !!pin;
    el.reverse.disabled = !ready;
    el.copy.disabled = !ready;
    el.open.disabled = !ready;
    if (ready) el.coord.textContent = fmt.coord(pin.lat, pin.lng);
  }

  // ── Analysis ─────────────────────────────────────────────────────────────

  async function analyze() {
    if (!state.fileMeta) return;
    el.analyze.disabled = true;
    status('RUNNING VISUAL ANALYSIS…', 'scan');
    el.analyze.textContent = 'ANALYZING…';

    // Re-buffer the file we already read so we never reserialize a blob unexpectedly.
    const input = el.file.files && el.file.files[0];
    let fd;
    if (input) {
      fd = new FormData();
      fd.append('image', input);
    } else {
      const res = await fetch(el.preview.src);
      const blob = await res.blob();
      fd = new FormData();
      fd.append('image', blob, 'image.bin');
    }

    let data;
    try {
      const res = await fetch('/osint/api/analyze', { method: 'POST', body: fd });
      data = await res.json();
    } catch (err) {
      el.analyze.disabled = false;
      el.analyze.textContent = 'RETRY ANALYSIS';
      return status('NETWORK ERROR: ' + (err && err.message ? err.message : err), 'err');
    }

    if (!data || data.ai === false) {
      el.analyze.disabled = false;
      el.analyze.textContent = 'RUN VISUAL ANALYSIS';
      const reason = (data && data.reason) || 'AI backend unavailable';
      document.body.dataset.ai = 'off';
      status('AI OFFLINE · MANUAL MODE · ' + (data && data.error ? 'BACKEND ERROR' : 'EXIF + MANUAL ONLY'), 'err');
      const hint = document.createElement('div');
      hint.className = 'osint-evidenceless dim';
      hint.textContent = reason;
      el.evidence.hidden = false;
      el.evidence.innerHTML = '';
      el.evidence.appendChild(hint);
      const h2 = document.createElement('h3');
      h2.className = 'btc-subhead';
      h2.textContent = 'Model lead';
      el.evidence.insertBefore(h2, el.evidence.firstChild);
      return;
    }

    if (!data.guess) {
      el.analyze.disabled = false;
      el.analyze.textContent = 'RETRY ANALYSIS';
      return status('MODEL RETURNED NO USABLE LEAD', 'err');
    }

    state.model = data;
    const g = data.guess;
    removeKind('model');
    const latlng = L.latLng(g.lat, g.lon);
    pin('model', latlng, true);

    if (state.circle) { map.removeLayer(state.circle); }
    state.circle = L.circle(latlng, {
      radius: g.radiusKm * 1000,
      color: '#e0a63b', weight: 1, fillColor: '#e0a63b', fillOpacity: 0.1, dashArray: '4 6',
    }).addTo(map);

    el.engine.textContent = 'ENGINE: ' + (data.engine || 'unknown');
    el.place.textContent = g.placeName || 'no place label';
    el.country.textContent = g.country || '';
    el.confVal.textContent = Math.round(g.confidence * 100) + '%';
    el.confFill.style.width = Math.round(g.confidence * 100) + '%';
    el.radius.textContent = g.radiusKm + ' km';
    el.clues.innerHTML = '';
    (g.clues || []).forEach((c) => {
      const li = document.createElement('li');
      li.textContent = c;
      el.clues.appendChild(li);
    });
    el.reasoning.textContent = g.reasoning || '';
    el.evidence.hidden = false;

    addGapLine();
    fitPins();
    status('LEAD LOCKED · CONFIDENCE ' + Math.round(g.confidence * 100) + '% · RADIUS ' + g.radiusKm + ' km', 'ok');
    el.analyze.disabled = false;
    el.analyze.textContent = 'RUN ANALYSIS AGAIN';
  }

  // ── Reverse / copy / open ────────────────────────────────────────────────

  async function reverseHere() {
    const p = currentPin();
    if (!p) return;
    el.reverse.disabled = true;
    el.reverseOut.textContent = 'REVERSE-GEOCODING…';
    try {
      const res = await fetch('/osint/api/reverse?lat=' + p.lat + '&lon=' + p.lng + '&zoom=16');
      const data = await res.json();
      if (res.status === 429) el.reverseOut.textContent = 'RATE-LIMITED · WAIT A SECOND · © OpenStreetMap contributors';
      else if (!res.ok) el.reverseOut.textContent = 'REVERSE FAILED: ' + (data.error || res.status);
      else el.reverseOut.textContent = '📍 ' + data.name + ' · © OpenStreetMap contributors';
    } catch (err) {
      el.reverseOut.textContent = 'REVERSE ERROR';
    } finally {
      el.reverse.disabled = !currentPin();
    }
  }

  function copyHere() {
    const p = currentPin();
    if (!p) return;
    const text = p.lat.toFixed(6) + ', ' + p.lng.toFixed(6);
    const done = () => status('COORDS COPIED: ' + text, 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { status('COPY FAILED', 'err'); }
    ta.remove();
  }

  function openInOsm() {
    const p = currentPin();
    if (!p) return;
    window.open('https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lng + '#map=' + Math.max(map.getZoom(), 14) + '/' + p.lat.toFixed(6) + '/' + p.lng.toFixed(6), '_blank', 'noopener');
  }

  // ── Search ───────────────────────────────────────────────────────────────

  async function searchPlace(q) {
    q = q.trim();
    if (!q) return;
    status('GEOCODING "' + q.toUpperCase() + '"…', 'scan');
    el.searchBtn.disabled = true;
    try {
      const res = await fetch('/osint/api/search?q=' + encodeURIComponent(q));
      const data = await res.json();
      if (res.status === 429) return status('RATE-LIMITED · WAIT A SECOND', 'err');
      if (!res.ok || !data.results || !data.results.length) return status('NOT FOUND', 'err');
      const r = data.results[0];
      const ll = L.latLng(r.lat, r.lon);
      pin('manual', ll, true);
      map.setView(ll, Math.max(map.getZoom(), 12));
      el.reverseOut.textContent = '📍 ' + r.name + ' · © OpenStreetMap contributors';
      status('PINNED · ' + r.name.toUpperCase().slice(0, 60), 'ok');
    } catch (err) {
      status('SEARCH ERROR', 'err');
    } finally {
      el.searchBtn.disabled = false;
    }
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  function removeZoomHint() {
    const h = el.map.querySelector('.osint-zoomhint');
    if (h) h.remove();
  }

  el.file.addEventListener('change', () => onFile(el.file.files && el.file.files[0]));
  ['dragenter', 'dragover'].forEach((ev) =>
    el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.remove('dragging'); }));
  el.drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.indexOf('image/') === 0) onFile(f);
  });

  el.analyze.addEventListener('click', analyze);
  el.clear.addEventListener('click', () => {
    el.file.value = '';
    el.preview.hidden = true;
    el.preview.removeAttribute('src');
    Object.keys(state.markers).forEach((k) => removeKind(k));
    state.fileMeta = state.exif = state.model = null;
    state.points.clear();
    removeGapLine();
    el.evidence.hidden = true;
    el.evidence.innerHTML = '';
    ['metaFile', 'metaDims', 'metaCamera', 'metaDt', 'metaGps', 'reverseOut'].forEach((k) => (el[k].textContent = '—'));
    el.metaGps.textContent = 'none';
    el.analyze.disabled = true;
    el.analyze.textContent = 'RUN VISUAL ANALYSIS';
    status('AWAITING IMAGE', 'idle');
    map.setView([20, 0], 2);
  });

  el.reverse.addEventListener('click', reverseHere);
  el.copy.addEventListener('click', copyHere);
  el.open.addEventListener('click', openInOsm);
  el.searchForm.addEventListener('submit', (e) => { e.preventDefault(); searchPlace(el.search.value); });
  map.on('click', (e) => {
    pin('manual', e.latlng, true);
    reverseHere();
  });
  map.on('moveend', () => { removeZoomHint(); });

  const zh = document.createElement('div');
  zh.className = 'osint-zoomhint';
  zh.textContent = 'DROP AN IMAGE → OR PIN A FIGHT · SEARCH ANYPLACE · RENDER EVERYTHING';
  el.map.appendChild(zh);

  status('AWAITING IMAGE', 'idle');

  // ── GLOBE mode (lazy 3D) ────────────────────────────────────────────────
  const elGlobe = {
    wrap: document.getElementById('osint-globe-wrap'),
    stage: document.getElementById('osint-globe-stage'),
    tree: document.getElementById('osint-dir-tree'),
  };
  let globeReady = false;

  function injectScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensureGlobe() {
    if (globeReady) return;
    if (!elGlobe.wrap || !elGlobe.stage || !elGlobe.tree) { status('GLOBE UNSUPPORTED', 'err'); return; }
    try {
      await injectScript('/osint/vendor/globe/globe.gl.js');
      const mod = await import('/osint/globe.js');
      const api = mod.default || window.HTPGlobe;
      await api.init({
        wrap: elGlobe.wrap,
        stage: elGlobe.stage,
        tree: elGlobe.tree,
        onSendToMap: (lat, lon, label) => {
          setLayer('osm');
          pin('manual', L.latLng(lat, lon), true);
          map.setView([lat, lon], Math.max(map.getZoom(), 12));
          if (label) el.reverseOut.textContent = label;
          status('GLOBE SIGHTING → 2D ' + label, 'ok');
        },
      });
      globeReady = true;
    } catch (err) {
      console.error('[osint] globe init failed', err);
      status('GLOBE UNAVAILABLE: ' + (err && err.message ? err.message : err), 'err');
    }
  }

  function enterGlobe() {
    if (!elGlobe.wrap) return;
    el.map.style.display = 'none';
    elGlobe.wrap.hidden = false;
    elGlobe.wrap.classList.add('is-active');
    ensureGlobe();
  }

  function leaveGlobe() {
    if (elGlobe.wrap) { elGlobe.wrap.hidden = true; elGlobe.wrap.classList.remove('is-active'); }
    el.map.style.display = '';
    if (window.HTPGlobe) { try { window.HTPGlobe.hide(); } catch (e) { /* noop */ } }
  }

  // Leaflet keeps a document-level listener set and a WebGL/2D context on the
  // container it was given. Re-initialising it against a fresh #osint-map while
  // the old instance is live leaves the map frozen, so tear it down on swap.
  if (window.__htpTeardown) {
    window.__htpTeardown.add(() => {
      try { leaveGlobe(); } catch (e) {}
      try { map.remove(); } catch (e) {}
    });
  }

  // ── Self-recursive scan client ──
  (function recursiveScan() {
    'use strict';
    const seedEl = $('recursive-seed');
    const startBtn = $('recursive-start');
    const stopBtn = $('recursive-stop');
    const statusEl = $('recursive-status');
    const statsEl = $('recursive-stats');
    const pagesEl = $('recursive-pages');
    const imagesEl = $('recursive-images');
    const opsEl = $('recursive-ops');
    const elapsedEl = $('recursive-elapsed');
    const findingsEl = $('recursive-findings');
    if (!seedEl || !startBtn) return;

    let controller = null;
    let startTime = 0;

    function setBusy(busy) {
      startBtn.disabled = busy;
      stopBtn.disabled = !busy;
      statusEl.textContent = busy ? 'SCANNING…' : 'IDLE';
      statusEl.dataset.state = busy ? 'scan' : 'idle';
      if (!busy) statsEl.hidden = true;
    }

    function renderFinding(f) {
      const div = document.createElement('div');
      div.className = 'osint-recursive-finding';
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = f.kind || 'image';
      const meta = document.createElement('span');
      const g = f.guess || {};
      const conf = Number.isFinite(g.confidence) ? Math.round(g.confidence * 100) + '%' : '—';
      const place = g.placeName || '—';
      const ok = g.confidence >= 0.55 ? 'ok' : 'err';
      meta.className = ok;
      meta.textContent = (f.url || f.q || f.lat + ',' + f.lon) + ' · conf ' + conf + ' · ' + place;
      div.appendChild(kind);
      div.appendChild(meta);
      findingsEl.insertBefore(div, findingsEl.firstChild);
      while (findingsEl.children.length > 40) findingsEl.removeChild(findingsEl.lastChild);
    }

    async function runScan() {
      const seed = seedEl.value.trim();
      if (!seed) return;
      try { new URL(seed, location.origin); } catch {
        statusEl.textContent = 'INVALID SEED URL';
        statusEl.dataset.state = 'err';
        return;
      }
      setBusy(true);
      findingsEl.innerHTML = '';
      statsEl.hidden = false;
      pagesEl.textContent = '0';
      imagesEl.textContent = '0';
      opsEl.textContent = '0';
      elapsedEl.textContent = '0 ms';
      startTime = Date.now();
      controller = new AbortController();

      try {
        const res = await fetch('/osint/api/recursive/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seeds: [seed] }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'scan failed ' + res.status);
        pagesEl.textContent = data.pages || 0;
        imagesEl.textContent = data.images || 0;
        opsEl.textContent = (data.stats && data.stats.completed) || 0;
        elapsedEl.textContent = (data.elapsedMs || 0) + ' ms';
        (data.findings || []).forEach(renderFinding);
        statusEl.textContent = data.timedOut ? 'SCAN TIMED OUT' : 'SCAN COMPLETE';
        statusEl.dataset.state = data.timedOut ? 'scan' : 'ok';
      } catch (err) {
        if (err.name === 'AbortError') {
          statusEl.textContent = 'SCAN STOPPED';
          statusEl.dataset.state = 'idle';
        } else {
          statusEl.textContent = 'SCAN ERROR: ' + (err && err.message ? err.message : err);
          statusEl.dataset.state = 'err';
        }
      } finally {
        setBusy(false);
      }
    }

    startBtn.addEventListener('click', runScan);
    stopBtn.addEventListener('click', () => {
      if (controller) controller.abort();
    });

    // Wire teardown so a partial navigation never leaves a dangling controller.
    if (window.__htpTeardown) {
      window.__htpTeardown.add(() => {
        if (controller) controller.abort();
      });
    }
  })();
})();