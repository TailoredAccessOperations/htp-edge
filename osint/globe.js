/**
 * HTP GLOBE — lazy 3D ops surface for /osint (GLOBE mode).
 * vendored: globe.gl 2.38 UMD (bundles its own three.js; no separate
 * three build needed — the r179 `three.min.js` UMD no longer exists).
 * Loaded dynamically by osint.js. Exposes window.HTPGlobe (ESM default
 * export mirrors it).
 */
(function () {
  'use strict';

  const ACCENTS = { planes: '#3ed678', trains: '#5ad1e6', cctv: '#e0a63b', ips: '#e6c85a', intel: '#ff5c7a' };
  let state = { globe: null, chains: {}, itemOn: {}, enabled: {}, intelLive: [], onSendToMap: null, treeEl: null };

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch ' + url + ' -> ' + res.status);
    return res.json();
  }

  function makeTexture() {
    // Procedural "matrix world": dark base, graticule grid, glow dots. No external image.
    const W = 2048, H = 1024;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#03070a';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(62,214,120,0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 36; i++) { ctx.beginPath(); ctx.moveTo((i / 36) * W, 0); ctx.lineTo((i / 36) * W, H); ctx.stroke(); }
    for (let i = 0; i <= 18; i++) { ctx.beginPath(); ctx.moveTo(0, (i / 18) * H); ctx.lineTo(W, (i / 18) * H); ctx.stroke(); }
    ctx.fillStyle = 'rgba(62,214,120,0.55)';
    for (let i = 0; i < 700; i++) {
      const x = (i * 79.7) % W, y = (i * 37.3) % H;
      ctx.fillRect(x, y, 2, 2);
    }
    return c.toDataURL('image/png');
  }

  function polar(lat, lon, alt = 0) { return { lat, lng: lon, altitude: alt }; }

  async function buildGlobe(stage) {
    const G = window.Globe || (window.GLOBE && (window.GLOBE.default || window.GLOBE));
    if (!G) throw new Error('globe.gl missing');
    const g = new G(stage, { animateIn: true });
    
    // Load high-res geo-data for refined borders
    try {
      const geoData = await (await fetch('/osint/data/worldLow.js')).text();
      // Strip 'export default ' if present to parse as JSON
      const jsonStr = geoData.replace(/^export\s+default\s+/, '').replace(/;$/, '');
      const worldData = JSON.parse(jsonStr);
      g.polygonsData(worldData.features)
       .polygonCapColor(() => 'rgba(62,214,120,0.05)')
       .polygonSideColor(() => 'rgba(62,214,120,0.02)')
       .polygonStrokeColor(() => '#3ed678');
    } catch (e) {
      console.warn('GeoData load failed, falling back to procedural', e);
    }

    g.globeImageUrl(makeTexture())
      .backgroundImageUrl(null)
      .atmosphereColor('#3ed678')
      .pointOfView(polar(22, 8, 2.1));

    // Click a sighting → jump back to the 2D GEOINT view (spec §4 "Send to 2D map").
    g.onPointClick((pt) => {
      if (pt && state.onSendToMap) state.onSendToMap(pt.lat, pt.lng, pt.label || '');
    });
    if (g.controls && g.controls()) {
      const c = g.controls();
      c.autoRotate = true;
      c.autoRotateSpeed = 0.55;
      c.enableDamping = true;
      stage.addEventListener('pointerdown', () => { c.autoRotate = false; });
    }
    const canvas = stage.querySelector('canvas');
    if (canvas) canvas.style.background = 'radial-gradient(circle at 50% 40%, #06120c 0%, #02070a 60%, #01040a 100%)';
    state.globe = g;
  }

  function pointsFor(chainId) {
    const chain = state.chains[chainId];
    if (!chain) return [];
    return state.itemOn[chainId].map((slot) => chain.item(slot));
  }

  function renderAll() {
    const g = state.globe;
    if (!g) return;
    const any = Object.keys(state.chains).find((id) => state.enabled[id] && state.itemOn[id].length);
    if (!any) { g.pointsData([]); return; }
    const combined = Object.keys(state.chains).reduce((acc, id) => {
      if (!state.enabled[id]) return acc;
      return acc.concat(state.itemOn[id].map((slot) => ({ ...state.chains[id].item(slot), _chain: id })));
    }, []);
    g.pointsData(combined)
      .pointLat((d) => d.lat)
      .pointLng((d) => d.lon)
      .pointColor((d) => ACCENTS[d._chain] || '#3ed678')
      .pointAltitude((d) => d.alt || 0.02)
      .pointRadius((d) => d.r || 0.35)
      .pointLabel((d) => d.label || (d.title || d.callsign || d.ip || d.id) || '');
    // arcs for planes only (a few sample routes)
    if (state.enabled.planes) {
      const arcs = state.itemOn.planes.slice(0, 10)
        .filter((slot) => state.chains.planes.metaFor(slot))
        .map((slot) => state.chains.planes.metaFor(slot));
      g.arcsData(arcs).arcStartLat((d) => d.start[0]).arcStartLng((d) => d.start[1])
        .arcEndLat((d) => d.end[0]).arcEndLng((d) => d.end[1])
        .arcColor((d) => ['rgba(62,214,120,0.5)', 'rgba(62,214,120,0.05)'])
        .arcDashLength(0.25).arcDashGap(3).arcDashAnimateTime(2500);
    } else {
      g.arcsData([]);
    }
  }

  function itemLabel(chainId, item) {
    if (chainId === 'planes') return (item.callsign || item.icao24 || item.id) + ' · ' + item.origin + '→' + item.dest;
    if (chainId === 'trains') return (item.line || item.id) + ' · ' + item.operator + ' · ' + item.status;
    if (chainId === 'cctv') return (item.name || item.id) + ' · ' + item.city + ' · ' + item.status;
    if (chainId === 'ips') return item.ip + ' · ' + item.city + ' · ' + item.org;
    if (chainId === 'intel') return (item.title || item.id) + ' · sev ' + item.severity;
    return String(item.id || '');
  }

  async function loadChain(chain) {
    const file = getJson(chain.file);
    const items = (await file).items || [];
    const chainState = {
      ...chain,
      item(slot) {
        const it = items[slot];
        return { ...it, lat: it.lat, lon: it.lon, label: itemLabel(chain.id, it) };
      },
      metaFor(slot) {
        const it = items[slot];
        if (chain.id !== 'planes' || !it.origin || !it.dest) return null;
        const find = (code) => {
          for (const p of items) if (p.origin === code || p.dest === code) return [p.lat, p.lon];
          return null;
        };
        const r = find(it.dest);
        return { start: [it.lat, it.lon], end: r || [it.lat + 0.1, it.lon - 0.1] };
      },
      items,
    };
    state.chains[chain.id] = chainState;
    state.itemOn[chain.id] = items.map((_, i) => i).slice(0, chain.defaultOn || 12);
    state.enabled[chain.id] = !!chain.enabled;
  }

  function railRow(chainId, slot) {
    const chain = state.chains[chainId];
    const g = document.createElement('div');
    g.className = 'osint-rule';
    const on = state.itemOn[chainId].includes(slot);
    g.dataset.on = String(on);
    const line = document.createElement('div');
    line.className = 'osint-rule-line';
    const cmd = document.createElement('span');
    cmd.className = 'osint-rule-cmd';
    cmd.textContent = '-A ' + chain.chain + ' -j ' + (on ? 'ACCEPT' : 'DROP');
    const lbl = document.createElement('span');
    lbl.className = 'osint-rule-label';
    lbl.textContent = chain.item(slot).label;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'osint-rule-toggle';
    toggle.textContent = on ? 'DISABLE' : 'ENABLE';
    toggle.addEventListener('click', () => {
      const nowOn = state.itemOn[chainId].includes(slot);
      if (nowOn) state.itemOn[chainId] = state.itemOn[chainId].filter((s) => s !== slot);
      else state.itemOn[chainId] = [slot, ...state.itemOn[chainId]];
      renderAll();
      rebuildTree();
    });
    line.append(cmd, lbl, toggle);
    g.appendChild(line);
    return g;
  }

  function chainHeader(chainId) {
    const chain = state.chains[chainId];
    const h = document.createElement('div');
    h.className = 'osint-chain';
    const t = document.createElement('div');
    t.className = 'osint-chain-title';
    t.textContent = '/ ' + chain.label;
    const c = document.createElement('div');
    c.className = 'osint-chain-name';
    c.textContent = '-N ' + chain.chain + '  ·  ' + state.itemOn[chainId].length + '/' + chain.items.length + ' ON';
    h.append(t, c);
    return h;
  }

  function rebuildTree() {
    const tree = state.treeEl;
    if (!tree) return;
    tree.innerHTML = '';
    Object.keys(state.chains).forEach((id) => {
      const chain = state.chains[id];
      const folder = document.createElement('details');
      folder.className = 'osint-folder';
      const sum = document.createElement('summary');
      sum.textContent = chain.label + '/';
      folder.appendChild(sum);
      folder.appendChild(chainHeader(id));
      const rows = chain.items
        .map((_, i) => i)
        .reduce((acc, slot) => (state.itemOn[id].includes(slot) || chain.items.length <= 60 ? acc.concat(slot) : acc), [])
        .slice(0, chain.items.length <= 60 ? chain.items.length : 40);
      rows.forEach((slot) => folder.appendChild(railRow(id, slot)));
      tree.appendChild(folder);
    });
    buildToolsTree(tree);
    buildRulesTree(tree);
  }

  function buildToolsTree(tree) {
    const tools = document.createElement('details');
    tools.className = 'osint-folder';
    const sum = document.createElement('summary');
    sum.textContent = 'tools/';
    tools.appendChild(sum);
    const lookup = document.createElement('div');
    lookup.className = 'osint-tool';
    lookup.textContent = 'IP LOOKUP → GET /osint/api/iplookup?ip=x';
    tools.appendChild(lookup);
    const intel = document.createElement('button');
    intel.type = 'button';
    intel.className = 'osint-rule-toggle osint-tool';
    intel.textContent = 'INTEL FETCH → live AI-geolocated headlines';
    intel.addEventListener('click', fetchIntel);
    tools.appendChild(intel);
    const taranis = document.createElement('div');
    taranis.className = 'osint-tool';
    const ta = document.createElement('a');
    ta.href = 'https://taranis.ai/docs/getting-started/01_deployment/';
    ta.target = '_blank'; ta.rel = 'noopener noreferrer';
    ta.textContent = 'SELF-HOST TARANIS AI · deploy guide';
    taranis.appendChild(ta);
    tools.appendChild(taranis);
    tree.appendChild(tools);
  }

  function buildRulesTree(tree) {
    const folder = document.createElement('details');
    folder.className = 'osint-folder';
    const sum = document.createElement('summary');
    sum.textContent = 'rules/';
    folder.appendChild(sum);
    fetch('/osint/rules/index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((idx) => {
        const list = document.createElement('div');
        if (!idx || !idx.files) {
          list.className = 'osint-tool';
          list.textContent = 'no rules vendored';
          folder.appendChild(list);
          return;
        }
        (idx.top || []).slice(0, 14).forEach((top) => {
          const a = document.createElement('a');
          a.className = 'osint-tool';
          a.href = '/osint/rules/' + top + '/';
          a.textContent = top + '/';
          list.appendChild(a);
        });
        folder.appendChild(list);
      })
      .then(() => {
        const via = document.createElement('div');
        via.className = 'osint-tool';
        via.textContent = 'source: 7WaySecurity/ai_osint · MIT / CC BY-SA 4.0';
        folder.appendChild(via);
      })
      .catch(() => {});
    tree.appendChild(folder);
  }

  async function fetchIntel() {
    try {
      const res = await fetch('/osint/api/intel/fetch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || res.status);
      if (!data.stories || !data.stories.length) {
        if (data.reason) {
          const t = document.createElement('div');
          t.className = 'osint-tool';
          t.textContent = 'INTEL: ' + data.reason;
          state.treeEl.appendChild(t);
        }
        return;
      }
      window.HTPGlobe.addIntel(data.stories);
      const ok = document.createElement('div');
      ok.className = 'osint-tool';
      ok.textContent = 'INTEL: +' + data.stories.length + ' live stories (ai=' + (data.ai ? 'yes' : 'no') + ')';
      state.treeEl.appendChild(ok);
    } catch (err) {
      const t = document.createElement('div');
      t.className = 'osint-tool';
      t.textContent = 'INTEL FAILED: ' + (err && err.message ? err.message : err);
      state.treeEl.appendChild(t);
    }
  }

  window.HTPGlobe = {
    async init(opts) {
      const stage = opts.stage, tree = opts.tree;
      if (state.globe) return;
      state.treeEl = tree;
      state.onSendToMap = opts.onSendToMap || (() => {});
      const dir = await getJson('/osint/data/directory.json');
      await buildChainSetup(dir, stage);
      rebuildTree();
      renderAll();
    },
    show() { /* noop; visibility handled by osint.js */ },
    hide() { if (state.globe) { try { state.globe.pauseAnimation(); } catch (e) {} } },
    focus(lat, lon, alt = 1.6) {
      if (!state.globe) return;
      state.globe.pointOfView({ lat, lng: lon, altitude: alt }, 800);
    },
    setLayerEnabled(id, on) { state.enabled[id] = on; renderAll(); },
    addIntel(stories) {
      if (!state.chains.intel) return;
      const start = state.chains.intel.items.length;
      state.chains.intel.items = state.chains.intel.items.concat(stories);
      state.itemOn.intel = state.itemOn.intel.concat(stories.map((_, i) => start + i));
      renderAll();
      rebuildTree();
    },
    setItemEnabled(id, slot, on) {
      const onList = state.itemOn[id];
      const has = onList.includes(slot);
      if (on && !has) state.itemOn[id] = [slot, ...onList];
      if (!on && has) state.itemOn[id] = onList.filter((s) => s !== slot);
      renderAll();
      rebuildTree();
    },
  };

  async function buildChainSetup(dir, stage) {
    const chains = dir.chains || [];
    for (const c of chains) {
      c.chain = c.chain || 'HTP_' + c.id.toUpperCase();
      c.enabled = true;
      c.defaultOn = c.id === 'ips' ? 40 : c.id === 'intel' ? 30 : 12;
      await loadChain(c);
    }
    await buildGlobe(stage);
    renderAll();
  }
})();

export default window.HTPGlobe;