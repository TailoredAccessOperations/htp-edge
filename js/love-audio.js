(() => {
  "use strict";
  const audio = document.getElementById("love-bg");
  const pop = document.getElementById("love-pop");
  if (!audio) return;

  // No keydown: Chrome does not treat a keystroke as user activation.
  const EVENTS = ["pointerdown", "touchstart"];

  const start = () =>
    audio.play().then(() => {
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: "True Love",
            artist: "XXXTENTACION & YE",
            album: "HTP | CARRIER",
          });
        } catch {}
      }
    }).catch(() => {});

  // Coordinate with the other carriers through one shared first gesture.
  const arm = (onDone) => {
    const once = () => {
      start().finally(() => {
        for (const ev of EVENTS) document.removeEventListener(ev, once, true);
        if (onDone) onDone();
      });
    };
    for (const ev of EVENTS) document.addEventListener(ev, once, { capture: true, once: true });
  };
  const resume = () => {
    start().catch(() => arm());
  };

  let channel = null;
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel("htp-love");
    channel.addEventListener("message", (m) => {
      if (m.data && m.data.type === "video-playing") {
        audio.pause();
        audio.dataset.pausedForVideo = "1";
      } else if (m.data && m.data.type === "video-closed") {
        if (audio.dataset.pausedForVideo === "1") {
          delete audio.dataset.pausedForVideo;
          resume();
        }
      }
    });
  }

  // love.mp4 is an ambient bed with no visible player on this page, so it must
  // never arm on its own gesture: malware.mp4 is the load-in carrier and two
  // decoders at once starved the tty. It only ever resumes after the pop-out
  // window closes, or when the visitor explicitly opens the player below.
  if (pop) {
    pop.addEventListener("click", () => {
      const w = window.open("/love.html", "htp-love-player", "width=960,height=620");
      if (w && channel) {
        const t = setInterval(() => {
          if (w.closed) {
            clearInterval(t);
            channel.postMessage({ type: "video-closed" });
          }
        }, 400);
      }
    });
  }
})();