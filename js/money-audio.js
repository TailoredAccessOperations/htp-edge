(() => {
  "use strict";
  const audio = document.getElementById("htp-music");
  const video = document.getElementById("ghost-bg");
  if (!audio || !video) return;

  if (matchMedia("(prefers-reduced-data: reduce)").matches) {
    video.pause();
    video.removeAttribute("src");
    while (video.firstChild) video.removeChild(video.firstChild);
    video.load();
  }

  const EVENTS = ["pointerdown", "keydown", "touchstart"];

  const start = () => {
    audio.currentTime = 0;
    video.currentTime = 0;
    return Promise.allSettled([audio.play(), video.play()]);
  };

  const arm = () => {
    const once = () => {
      start().finally(() => {
        for (const ev of EVENTS) document.removeEventListener(ev, once, true);
      });
    };
    for (const ev of EVENTS) document.addEventListener(ev, once, { capture: true, once: true });
  };

  start()
    .then((results) => {
      if (results.some((r) => r.status !== "fulfilled")) arm();
    })
    .catch(arm);

  for (const el of [audio, video]) {
    el.addEventListener("error", () => console.warn(`[htp-music] failed to load ${el.tagName.toLowerCase()}`), { once: true });
  }

  if ("mediaSession" in navigator) {
    const metadata = {
      title: "Psychopath Killer",
      artist: "SIMON GHOST RILEY · slowed + reverb",
      album: "HTP | MONEY",
    };
    try {
      const art = new Image();
      art.src = "/imgs/ghost.webp";
      art.decode().then(() => {
        navigator.mediaSession.metadata = new MediaMetadata({ ...metadata, artwork: [{ src: art.src, sizes: "800x450", type: "image/webp" }] });
      }).catch(() => {
        navigator.mediaSession.metadata = new MediaMetadata(metadata);
      });
    } catch {
      navigator.mediaSession.metadata = new MediaMetadata(metadata);
    }
    for (const [action, handler] of [
      ["play", () => audio.play()],
      ["pause", () => audio.pause()],
      ["seekbackward", () => { audio.currentTime = Math.max(0, audio.currentTime - 10); }],
      ["seekforward", () => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 10); }],
    ]) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    }
  }
})();