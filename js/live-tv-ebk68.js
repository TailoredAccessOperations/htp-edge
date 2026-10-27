/* ===== MATRIX RAIN ===== */
(function initMatrix() {
  const canvas = document.getElementById('tv-matrix');
  if (!canvas) return;
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

let idx = chans.indexOf(3), on = false, sound = false, fine = 0, found = new Set(), ang = [-75, 75], osdT;
const $ = id => document.getElementById(id);
const yt = $("yt"), snow = $("snow"), ctx = snow.getContext("2d"), osd = $("osd"), channelBadge = $("channel-badge");
const ytFrame = $("yt-frame");
const PLAYLIST = "PLHvnuL-DiXkjKtloq5PHA0WyeNZuSuYlk";
// The Knowledge Bank (1971), US National Archives. YouTube's highest rung is
// 320×240, which it labels "small". The local stream is that master.
const FILM = {
  id: "puIZolf5T80",
  hls: "/hls/knowledge-bank/av1/index.m3u8",
  hlsCompat: "/hls/knowledge-bank/index.m3u8",
  meta: "/hls/knowledge-bank/stream.json",
  ytQuality: "small",
  mime: 'video/mp4; codecs="av01.0.00M.08,mp4a.40.2"',
  mimeCompat: 'video/mp4; codecs="avc1.4d401e,mp4a.40.2"'
};
let hqVideo = null;
let filmMeta = null;
let ytClock = null;
let ytQualityNow = "";
let ytState = -1;
let syncTimer = 0;
let canvasOn = false;
let filmFailed = false;
let streamArmed = false;
let scanning = false;
let musicRestore = null;
let endTimer = 0;

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
    localVideo.muted = true;
    localVideo.loop = true;
    localVideo.playsInline = true;
    localVideo.preload = 'auto';
    localVideo.src = telegramStreamUrl();
    
    localVideo.addEventListener('loadeddata', () => {
      videoReady = true;
      console.log('[TV] Local video loaded, duration:', localVideo.duration);
    });
    
    // Offline fallback. Prefer HLS: the clip is 29.6 minutes, so a single MP4
    // would either blow the 25 MiB asset limit or have to be bit-starved.
    // HLS starts playing after the first ~1 MB segment instead of waiting on
    // the whole file. If MSE is unavailable (or the playlist fetch fails) we
    // fall back to the progressive MP4, which is a plain <video> src.
    const HLS_FALLBACK = '/hls/rogue/index.m3u8';
    const MP4_FALLBACK = '/rogue-ai-agents.mp4';

    const useFallbackVideo = () => {
      if (localVideo.dataset.fallback === '1') {
        videoReady = false;
        return;
      }
      localVideo.dataset.fallback = '1';
      videoReady = false;

      const onReady = () => {
        localVideo.removeEventListener('error', onFail);
        videoReady = true;
        console.log('[TV] Fallback video ready');
      };
      const onFail = () => {
        localVideo.removeEventListener('loadeddata', onReady);
        console.warn('[TV] HLS fallback failed, using progressive MP4');
        localVideo.src = MP4_FALLBACK;
      };

      if (window.HlsLite && !window.HlsLite.nativeSupport(localVideo)) {
        localVideo.addEventListener('loadeddata', onReady);
        localVideo.addEventListener('error', onFail);
        window.HlsLite.attach(localVideo, HLS_FALLBACK)
          .then((mode) => console.log('[TV] Fallback HLS mode:', mode.mode))
          .catch((err) => {
            console.warn('[TV] HLS attach rejected:', err && err.message);
            onFail();
          });
      } else {
        localVideo.src = HLS_FALLBACK; // Safari: native HLS
      }
    };

    localVideo.addEventListener('error', useFallbackVideo);
    
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
  const el = hqVideo || localVideo;
  if (!el) return;
  const playPromise = el.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      el.muted = true;
      el.play().catch(() => {});
    });
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
  
  // The film owns the tube. The YouTube iframe stays mounted underneath,
  // muted, so its clock and quality can follow the local stream.
  const screen = $("hq-screen");
  const filmOn = on && videoReady;
  $("tv-crt")?.classList.toggle("hq-live", filmOn && q > 0.72 && !filmFailed);
  if (yt) yt.style.opacity = "0";
  if (screen && !filmFailed) {
    const soft = filmOn ? Math.max(0, (1 - q) * 7) : 0;
    screen.style.filter = soft > 0.35 ? `blur(${soft.toFixed(2)}px) saturate(${(0.3 + q * 0.7).toFixed(2)})` : "none";
    screen.style.opacity = filmOn ? "1" : "0";
  }
  if (filmOn) ensurePlayback();
  else if (!on && hqVideo && !hqVideo.paused) hqVideo.pause();
  
  [...$("chs").children].forEach((d, i) => { 
    d.classList.toggle("cur", i === idx); 
    d.classList.toggle("st", found.has(chans[i])); 
  });
  
  if (ng) ng.gain.value = 0;
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
    $("tv-crt").classList.remove("on"); 
    void $("tv-crt").offsetWidth; 
    $("tv-crt").classList.add("on"); 
    showOsd(); 
    document.body.classList.add("rec-on"); 
  } else { 
    off.style.display = "flex"; 
    off.innerHTML = "<i></i>"; 
    osd.style.opacity = 0; 
    document.body.classList.remove("rec-on"); 
    if (localVideo) localVideo.pause();
    if (telegramVideo) telegramVideo.pause();
    ytCmd("pauseVideo");
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

function muteBackground() {
  const music = $("bgmusic");
  if (!music || musicRestore) return;
  musicRestore = { paused: music.paused, volume: music.volume };
  music.volume = 0;
  music.pause();
}

function restoreBackground() {
  clearTimeout(endTimer);
  const music = $("bgmusic");
  if (music && musicRestore && !musicRestore.paused) {
    music.volume = musicRestore.volume || 0.45;
    music.play().catch(() => {});
  }
  musicRestore = null;
  streamArmed = false;
  if (ytFrame) {
    ytFrame.style.display = "none";
    ytFrame.removeAttribute("src");
    delete ytFrame.dataset.list;
  }
  render();
}

function postPlayer(payload) {
  ytFrame?.contentWindow?.postMessage(JSON.stringify(payload), "*");
}

function ytCmd(func, args) {
  postPlayer({ event: "command", func: func, args: args || [], id: 1, channel: "widget" });
}

function setYoutubeSound() {
  ytCmd("mute");
  ytCmd("playVideo");
  ytCmd("setPlaybackQuality", [FILM.ytQuality]);
}

function armYoutubeEnd() {
  postPlayer({ event: "listening", id: 1, channel: "widget" });
  postPlayer({ event: "command", func: "addEventListener", args: ["onStateChange"], id: 1, channel: "widget" });
  postPlayer({ event: "command", func: "addEventListener", args: ["onPlaybackQualityChange"], id: 1, channel: "widget" });
  postPlayer({ event: "command", func: "addEventListener", args: ["onError"], id: 1, channel: "widget" });
  setYoutubeSound();
}

ytFrame?.addEventListener("load", armYoutubeEnd);

addEventListener("message", (event) => {
  if (!String(event.origin).endsWith("youtube-nocookie.com") && !String(event.origin).endsWith("youtube.com")) return;
  let data = event.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return; }
  }
  if (!data) return;
  if (data.event === "infoDelivery") {
    const info = data.info || {};
    if (typeof info.currentTime === "number") ytClock = info.currentTime;
    if (typeof info.playbackQuality === "string") ytQualityNow = info.playbackQuality;
    if (typeof info.playerState === "number") ytState = info.playerState;
    return;
  }
  if (data.event === "onPlaybackQualityChange") {
    ytQualityNow = typeof data.info === "string" ? data.info : (data.info && data.info.playbackQuality) || ytQualityNow;
    if (ytQualityNow && ytQualityNow !== FILM.ytQuality) ytCmd("setPlaybackQuality", [FILM.ytQuality]);
    paintHud();
    return;
  }
  const fallback = $("yt-fallback");
  if (data.event === "onError") {
    if (fallback) {
      fallback.hidden = false;
      delete fallback.dataset.playing;
    }
    return;
  }
  if (data.event !== "onStateChange") return;
  const state = typeof data.info === "number" ? data.info : data.info?.playerState;
  if (state === 1 || state === 3) {
    clearTimeout(endTimer);
    if (fallback && state === 1) {
      fallback.dataset.playing = "1";
      fallback.hidden = true;
    }
    return;
  }
  if (state === 0) {
    clearTimeout(endTimer);
    const t = hqVideo ? hqVideo.currentTime : 0;
    ytCmd("seekTo", [t, true]);
    ytCmd("playVideo");
  }
});

let waking = false;
async function wakeStream() {
  if (waking || streamArmed) return;
  waking = true;
  $("tv")?.classList.add("bunny-up");
  muteBackground();
  streamArmed = true;
  if (!on) power();
  else render();
  await scanChannels();
  idx = chans.indexOf(3);
  fine = 0;
  $("fine").value = 0;
  showOsd();
  render();
  waking = false;
}

$("tv")?.addEventListener("click", (event) => {
  if (event.target.closest("button, input, a, .chs, iframe")) return;
  wakeStream();
});

$("snd").onclick = () => {
  sound = !sound;
  if (localVideo) localVideo.muted = true;
  if (telegramVideo) telegramVideo.muted = true;
  const song = $("song777");
  if (song) {
    song.muted = false;
    song.volume = 1;
    song.play().catch(() => {});
  }
  $("snd").textContent = "777";
  setYoutubeSound();
  render();
};

async function scanChannels() { 
  scanning = true;
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
  scanning = false;
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

function paintHud() {
  const res = $("hq-res");
  const br = $("hq-br");
  const sync = $("hq-sync");
  if (!res) return;
  const w = (hqVideo && hqVideo.videoWidth) || (filmMeta && filmMeta.width) || 320;
  const h = (hqVideo && hqVideo.videoHeight) || (filmMeta && filmMeta.height) || 240;
  const screen = $("hq-screen");
  res.textContent = screen && screen.width ? `${w}×${h} → ${screen.width}×${screen.height}` : `${w}×${h}`;
  const vb = filmMeta && filmMeta.videoBitrate;
  const ab = filmMeta && filmMeta.audioBitrate;
  br.textContent = vb ? `${Math.round(vb / 1000)}k/${Math.round((ab || 0) / 1000)}k` : "best";
  const drift = hqVideo && typeof ytClock === "number" ? Math.round((ytClock - hqVideo.currentTime) * 1000) : null;
  const qLabel = ytQualityNow || FILM.ytQuality;
  sync.textContent = drift == null ? `YT ${qLabel}` : `YT ${qLabel} ${drift > 0 ? "+" : ""}${drift}ms`;
}

function mountYoutube() {
  if (!ytFrame) return;
  const src = `https://www.youtube-nocookie.com/embed/${FILM.id}?autoplay=1&mute=1&loop=1&playlist=${FILM.id}&playsinline=1&rel=0&modestbranding=1&controls=0&enablejsapi=1&vq=${FILM.ytQuality}&origin=${encodeURIComponent(location.origin)}&widget_referrer=${encodeURIComponent(location.href)}`;
  ytFrame.classList.add("yt-sync");
  ytFrame.style.display = "block";
  ytFrame.style.opacity = "0";
  ytFrame.title = "The Knowledge Bank (1971)";
  if (ytFrame.dataset.film !== FILM.id) {
    ytFrame.dataset.film = FILM.id;
    ytFrame.src = src;
  }
}

function revealYoutube() {
  filmFailed = true;
  if (!ytFrame) return;
  ytFrame.classList.remove("yt-sync");
  ytFrame.style.display = "block";
  ytFrame.style.opacity = "1";
  ytFrame.style.zIndex = "8";
  const screen = $("hq-screen");
  if (screen) screen.style.opacity = "0";
  const fallback = $("yt-fallback");
  if (fallback) fallback.hidden = true;
}

function startCanvas() {
  if (canvasOn) return;
  const canvas = $("hq-screen");
  const video = hqVideo;
  if (!canvas || !video) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;
  canvasOn = true;
  const fit = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w: w, h: h };
  };
  const draw = () => {
    const size = fit();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size.w, size.h);
    const vw = video.videoWidth || (filmMeta && filmMeta.width) || 320;
    const vh = video.videoHeight || (filmMeta && filmMeta.height) || 240;
    if (video.readyState >= 2 && vw && vh) {
      const scale = Math.min(size.w / vw, size.h / vh);
      const dw = Math.round(vw * scale);
      const dh = Math.round(vh * scale);
      ctx.drawImage(video, (size.w - dw) / 2, (size.h - dh) / 2, dw, dh);
    }
    requestAnimationFrame(draw);
  };
  draw();
}

function tickSync() {
  if (!hqVideo || !ytFrame || !ytFrame.src) return;
  ytCmd("getCurrentTime");
  ytCmd("getPlaybackQuality");
  if (ytQualityNow && ytQualityNow !== FILM.ytQuality && ytQualityNow !== "unknown") {
    ytCmd("setPlaybackQuality", [FILM.ytQuality]);
  }
  if (!on || hqVideo.paused) {
    if (ytState === 1) ytCmd("pauseVideo");
    paintHud();
    return;
  }
  if (ytState !== 1 && ytState !== 3) ytCmd("playVideo");
  if (typeof ytClock === "number" && Math.abs(ytClock - hqVideo.currentTime) > 0.4) {
    ytCmd("seekTo", [hqVideo.currentTime, true]);
    ytClock = hqVideo.currentTime;
  }
  paintHud();
}

function startSync() {
  if (syncTimer) return;
  syncTimer = setInterval(tickSync, 400);
  if (hqVideo) {
    hqVideo.addEventListener("seeked", () => ytCmd("seekTo", [hqVideo.currentTime, true]));
    hqVideo.addEventListener("pause", () => ytCmd("pauseVideo"));
    hqVideo.addEventListener("playing", () => {
      ytCmd("playVideo");
      ytCmd("setPlaybackQuality", [FILM.ytQuality]);
      if (typeof ytClock !== "number" || Math.abs(ytClock - hqVideo.currentTime) > 0.4) {
        ytCmd("seekTo", [hqVideo.currentTime, true]);
      }
      paintHud();
    });
    hqVideo.addEventListener("ratechange", () => ytCmd("setPlaybackRate", [hqVideo.playbackRate || 1]));
  }
}

function canPlayMime(video, mime) {
  try {
    if (window.MediaSource && MediaSource.isTypeSupported(mime)) return true;
  } catch (e) { /* ignore */ }
  return !!(video.canPlayType && video.canPlayType(mime));
}

function attachFilm(url, mime) {
  if (window.HlsLite && !window.HlsLite.nativeSupport(hqVideo)) {
    return window.HlsLite.attach(hqVideo, url, { progressive: true, mimeType: mime });
  }
  hqVideo.src = url;
  return Promise.resolve({ mode: "native" });
}

function initFilm() {
  hqVideo = $("hq-display");
  if (!hqVideo) return;
  localVideo = hqVideo;
  hqVideo.muted = true;
  hqVideo.defaultMuted = true;
  hqVideo.loop = true;
  hqVideo.playsInline = true;
  hqVideo.autoplay = false;
  hqVideo.preload = "auto";
  streamArmed = true;
  mountYoutube();
  startCanvas();
  startSync();
  fetch(FILM.meta).then((r) => r.ok ? r.json() : null).then((meta) => {
    filmMeta = meta;
    paintHud();
  }).catch(() => {});

  const markReady = () => {
    videoReady = true;
    paintHud();
    ensurePlayback();
    render();
  };
  hqVideo.addEventListener("loadeddata", markReady);
  hqVideo.addEventListener("playing", markReady);
  hqVideo.addEventListener("error", () => {
    if (hqVideo.dataset.fallback === "1") {
      revealYoutube();
      return;
    }
    hqVideo.dataset.fallback = "1";
    videoReady = false;
    attachFilm(FILM.hlsCompat, (filmMeta && filmMeta.mimeCompat) || FILM.mimeCompat).catch(() => revealYoutube());
  });

  const preferAv1 = canPlayMime(hqVideo, FILM.mime);
  const url = preferAv1 ? FILM.hls : FILM.hlsCompat;
  const mime = preferAv1 ? FILM.mime : FILM.mimeCompat;
  attachFilm(url, mime).then(() => ensurePlayback()).catch(() => {
    if (url === FILM.hls) {
      hqVideo.dataset.fallback = "1";
      attachFilm(FILM.hlsCompat, FILM.mimeCompat).catch(() => revealYoutube());
      return;
    }
    revealYoutube();
  });
  ensurePlayback();
}

/* ===== AUTO POWER-ON ===== */
function bootFilm() {
  $("tv")?.classList.add("bunny-up");
  initFilm();
  if (!on) power();
  else {
    render();
    ensurePlayback();
  }
}
if (document.readyState === "loading") addEventListener("DOMContentLoaded", bootFilm);
else bootFilm();

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
$("tv-crt")?.addEventListener('dblclick', requestFullscreen);

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