/* ===== MATRIX RAIN ===== */
(function initMatrix() {
  const canvas = document.getElementById('matrix');
  const ctx = canvas.getContext('2d');
  const charset = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
  let cols = 0, drops = [], charWidth = 14, charHeight = 20;
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; cols = Math.floor(canvas.width / charWidth); drops = Array(cols).fill(0).map(() => Math.random() * -100); }
  function draw() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${charHeight}px "Azeret Mono", monospace`;
    ctx.fillStyle = '#25f4ee';
    for (let i = 0; i < cols; i++) {
      const char = charset[Math.floor(Math.random() * charset.length)];
      const x = i * charWidth;
      const y = drops[i] * charHeight;
      ctx.fillText(char, x, y);
      if (y > canvas.height && Math.random() > .975) drops[i] = 0;
      drops[i]++;
    }
  }
  resize(); addEventListener('resize', resize); setInterval(draw, 50);
})();

/* ===== TV LOGIC — LOCAL MP4 LIVE STREAM ===== */
const edges = {2:54,3:60,4:66,5:76,6:82,7:174,8:180,9:186,10:192,11:198,12:204,13:210};
for (let n=14;n<=36;n++) edges[n] = 470 + 6*(n-14);
const chans = Object.keys(edges).map(Number);
const stations = new Set([3,5,8,11,14,21, 66]); // Added channel 66 for Telegram

let idx = chans.indexOf(3), on = false, sound = false, fine = 0, found = new Set(), ang = [-60, 60], osdT;
const $ = id => document.getElementById(id);
const yt = $("yt"), snow = $("snow"), ctx = snow.getContext("2d"), osd = $("osd"), channelBadge = $("channel-badge");

const vc = n => edges[n] + 1.25, ac = n => edges[n] + 5.75;

let localVideo = null;
let telegramVideo = null;
let videoReady = false;
let telegramVideoReady = false;

function telegramStreamUrl() {
  const node = 1 + Math.floor(Math.random() * 3);
  return `/cdn/${node}/ebkpablo/68.mp4`;
}

function initLocalVideo() {
  const preloaded = document.getElementById('live-stream');
  if (preloaded) {
    localVideo = preloaded;
    localVideo.removeAttribute('crossorigin');
    localVideo.style.display = 'block';
    localVideo.muted = !sound;
    localVideo.loop = true;
    localVideo.playsInline = true;
    localVideo.preload = 'auto';
    localVideo.src = telegramStreamUrl();
    
    localVideo.addEventListener('loadeddata', () => {
      videoReady = true;
      console.log('[TV] Local video loaded, duration:', localVideo.duration);
    });
    
    localVideo.addEventListener('error', () => {
      if (localVideo.dataset.fallback === '1') {
        videoReady = false;
        return;
      }
      localVideo.dataset.fallback = '1';
      videoReady = false;
      localVideo.src = '/rogue-ai-agents.mp4';
    });
    
    localVideo.addEventListener('waiting', () => {
      console.log('[TV] Video buffering...');
    });
    
    localVideo.addEventListener('playing', () => {
      console.log('[TV] Video playing');
    });
  }
}

function ensurePlayback() {
  if (!on) return;
  const n = chans[idx];
  const isTelegram = n === 66;
  const currentVideo = isTelegram ? telegramVideo : localVideo;
  const currentReady = isTelegram ? telegramVideoReady : videoReady;
  
  const playEl = (el) => {
    if (!el) return;
    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        el.muted = true;
        el.play().catch(() => {});
      });
    }
  };
  if (currentVideo && currentReady) {
    playEl(currentVideo);
    playEl(yt);
  }
}

function earQ(n) { 
  const spread = Math.abs(ang[1] - ang[0]); 
  const f = edges[n]; 
  const ideal = f < 100 ? 150 : f < 300 ? 100 : 55; 
  return Math.max(.35, 1 - Math.abs(spread - ideal) / 160); 
}

function tuneQ() { return Math.max(0, 1 - Math.abs(fine) / 1.2); }

function quality() { 
  const n = chans[idx]; 
  if (!on || !stations.has(n)) return 0; 
  return tuneQ() * earQ(n); 
}

let ac_, ng;
function audioInit() { 
  if (ac_) return; 
  ac_ = new (window.AudioContext || window.webkitAudioContext)(); 
  const b = ac_.createBuffer(1, ac_.sampleRate * 2, ac_.sampleRate), d = b.getChannelData(0); 
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; 
  const s = ac_.createBufferSource(); 
  s.buffer = b; 
  s.loop = true; 
  ng = ac_.createGain(); 
  ng.gain.value = 0; 
  s.connect(ng).connect(ac_.destination); 
  s.start(); 
}

function render() {
  const n = chans[idx], q = quality(), st = stations.has(n);
  $("lcd").innerHTML = `CH ${String(n).padStart(2,"0")}<small>VID ${(vc(n)+fine).toFixed(2)} · AUD ${(ac(n)+fine).toFixed(2)} MHz</small>`;
  $("fv").textContent = (fine >= 0 ? "+" : "") + fine.toFixed(2);
  const knobAngle = idx * (300 / (chans.length - 1)) - 150;
  $("knob").style.setProperty('--knob-angle', `${knobAngle}deg`);
  [...$("meter").children].forEach((b, i) => b.className = i < Math.round(q * 10) ? "l" : "");
  
  // Local video display logic
  const isTelegram = n === 66;
  const currentVideo = isTelegram ? telegramVideo : localVideo;
  const currentReady = isTelegram ? telegramVideoReady : videoReady;
  
  if (currentVideo) {
    if (on && st && currentReady) {
      yt.style.opacity = Math.min(1, .15 + q);
      yt.style.filter = `blur(${(1 - q) * 7}px) saturate(${(0.3 + q * 0.7).toFixed(2)})`;
      // Swap video source if needed
      if (yt.src !== currentVideo.src) {
        yt.src = currentVideo.src;
        yt.loop = true;
        yt.muted = currentVideo.muted;
        yt.playsInline = true;
      }
      ensurePlayback();
    } else {
      yt.style.opacity = 0;
      if (currentVideo && !currentVideo.paused) {
        currentVideo.pause();
      }
    }
  } else {
    yt.style.opacity = on && st ? Math.min(1, .15 + q) : 0;
    yt.style.filter = `blur(${(1 - q) * 7}px) saturate(${(0.3 + q * 0.7).toFixed(2)})`;
  }
  
  [...$("chs").children].forEach((d, i) => { 
    d.classList.toggle("cur", i === idx); 
    d.classList.toggle("st", found.has(chans[i])); 
  });
  
  if (ng) ng.gain.value = on && sound ? (1 - q) * .18 : 0;
  channelBadge.textContent = `CH ${String(n).padStart(2,"0")} — VID ${(vc(n)+fine).toFixed(2)} MHz`;
}

function showOsd() { 
  osd.style.opacity = 1; 
  const n = chans[idx]; 
  osd.textContent = `CH ${String(n).padStart(2,"0")}\n${vc(n).toFixed(2)} MHz`; 
  clearTimeout(osdT); 
  osdT = setTimeout(() => osd.style.opacity = 0, 2500); 
}

function go(d) { 
  if (!on) return; 
  idx = (idx + d + chans.length) % chans.length; 
  fine = 0; 
  $("fine").value = 0; 
  showOsd(); 
  render(); 
}

function power() { 
  on = !on; 
  const off = $("off"); 
  if (on) { 
    off.style.display = "none"; 
    $("crt").classList.remove("on"); 
    void $("crt").offsetWidth; 
    $("crt").classList.add("on"); 
    showOsd(); 
    document.body.classList.add("rec-on"); 
  } else { 
    off.style.display = "flex"; 
    off.innerHTML = "<i></i>"; 
    osd.style.opacity = 0; 
    document.body.classList.remove("rec-on"); 
    if (localVideo) localVideo.pause();
    if (telegramVideo) telegramVideo.pause();
  } 
  render(); 
}

function noise() { 
  const q = quality(), a = on ? Math.pow(1 - q, .7) * .95 + (q > 0 ? .04 : 0) : 0; 
  if (on) { 
    const w = 192, h = 108, im = ctx.createImageData(w, h), d = im.data, al = Math.round(a * 255); 
    for (let i = 0; i < d.length; i += 4) { 
      const v = Math.random() * 255; 
      d[i] = d[i+1] = d[i+2] = v; 
      d[i+3] = al; 
    } 
    ctx.putImageData(im, 0, 0); 
  } else ctx.clearRect(0, 0, 192, 108); 
  requestAnimationFrame(noise); 
}

$("meter").innerHTML = "<b></b>".repeat(10);
$("chs").innerHTML = chans.map((n, i) => `<div data-i='${i}'><span>CH ${String(n).padStart(2,"0")}</span><span>${vc(n).toFixed(2)} MHz</span></div>`).join("");
$("chs").onclick = e => { const d = e.target.closest("div"); if (d && on) { idx = +d.dataset.i; fine = 0; $("fine").value = 0; showOsd(); render(); } };
$("knob").onclick = () => go(1);
$("knob").onwheel = e => { e.preventDefault(); go(e.deltaY > 0 ? 1 : -1); };

addEventListener("keydown", e => { 
  if (e.key === "ArrowUp" || e.key === "ArrowRight") go(1); 
  if (e.key === "ArrowDown" || e.key === "ArrowLeft") go(-1); 
  if (e.key === " ") { e.preventDefault(); power(); } 
});

$("fine").oninput = e => { fine = +e.target.value; render(); };
$("pwr").onclick = power;

$("snd").onclick = () => {
  sound = !sound;
  if (sound) {
    audioInit(); 
    ac_.resume();
    if (localVideo) localVideo.muted = false;
    if (telegramVideo) telegramVideo.muted = false;
  } else {
    if (localVideo) localVideo.muted = true;
    if (telegramVideo) telegramVideo.muted = true;
  }
  $("snd").textContent = sound ? "Sound off" : "Sound on";
  render();
};

async function scanChannels() { 
  if (!on) power(); 
  found.clear(); 
  fine = 0; 
  $("fine").value = 0; 
  for (let i = 0; i < chans.length; i++) { 
    idx = i; 
    showOsd(); 
    render(); 
    await new Promise(r => setTimeout(r, stations.has(chans[i]) ? 600 : 180)); 
    if (stations.has(chans[i])) found.add(chans[i]); 
  } 
  idx = chans.indexOf(3); 
  showOsd(); 
  render(); 
}
$("scan").onclick = scanChannels;

function setEar(k, deg) { 
  ang[k] = Math.max(-85, Math.min(85, deg)); 
  const bx = k ? 520 : 480, by = 128, L = 150, r = ang[k] * Math.PI / 180; 
  const x = bx + Math.sin(r) * L * 1.2, y = by - Math.cos(r) * L * .8; 
  $("r" + (k+1)).setAttribute("x2", x); 
  $("r" + (k+1)).setAttribute("y2", y); 
  $("t" + (k+1)).setAttribute("cx", x); 
  $("t" + (k+1)).setAttribute("cy", y); 
}

setEar(0, ang[0]); 
setEar(1, ang[1]);

[0, 1].forEach(k => { 
  const g = $("e" + (k+1)); 
  g.addEventListener("pointerdown", e => { 
    g.setPointerCapture(e.pointerId); 
    const svg = g.ownerSVGElement; 
    const mv = ev => { 
      const p = svg.createSVGPoint(); 
      p.x = ev.clientX; 
      p.y = ev.clientY; 
      const c = p.matrixTransform(svg.getScreenCTM().inverse()); 
      const bx = k ? 520 : 480; 
      setEar(k, Math.atan2((c.x - bx) / 1.2, (128 - c.y) / .8) * 180 / Math.PI); 
      render(); 
    }; 
    g.addEventListener("pointermove", mv); 
    g.addEventListener("pointerup", () => g.removeEventListener("pointermove", mv), { once: true }); 
  }); 
});

noise(); 
render();

/* ===== AUTO POWER-ON + CHANNEL SCAN ===== */
let autoScanned = false;
function autoScan() { 
  if (autoScanned) return; 
  autoScanned = true; 
  if (!on) power(); 
  scanChannels().then(ensurePlayback); 
}

// Initialize local video on DOM ready
addEventListener("DOMContentLoaded", () => {
  initLocalVideo();
  setTimeout(autoScan, 900);
});

/* ===== AI ROUTE HEALTH CHECK ===== */
async function checkAiRoutes() {
  const routes = ['/ai/health', '/ai/models', '/ai/capabilities', '/ai/chat', '/chat/api/ask', '/osint/api/analyze'];
  const results = {};
  for (const route of routes) {
    try { 
      const r = await fetch(route, {method: 'GET', headers: {'Accept': 'application/json'}}); 
      results[route] = {status: r.status, ok: r.ok}; 
    } catch (e) { 
      results[route] = {status: 0, ok: false, error: e.message}; 
    }
  }
  console.table(results);
  return results;
}
setTimeout(checkAiRoutes, 2000);

/* ===== FULLSCREEN SUPPORT ===== */
function requestFullscreen() {
  const tv = document.querySelector('.tv');
  if (tv.requestFullscreen) {
    tv.requestFullscreen().catch(() => {});
  } else if (tv.webkitRequestFullscreen) {
    tv.webkitRequestFullscreen();
  } else if (tv.msRequestFullscreen) {
    tv.msRequestFullscreen();
  }
}

// Double-click CRT for fullscreen
$("crt")?.addEventListener('dblclick', requestFullscreen);

// F key for fullscreen
addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    requestFullscreen();
  }
});

// Handle fullscreen change
addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) {
    document.body.classList.add('fullscreen-active');
  } else {
    document.body.classList.remove('fullscreen-active');
  }
});