(() => {
  "use strict";
  const video = document.getElementById("love-v");
  let channel = null;
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel("htp-love");
  }
  const post = (type) => {
    if (channel) {
      try { channel.postMessage({ type }); } catch {}
    }
  };
  if (video) {
    video.addEventListener("playing", () => post("video-playing"), { once: false });
    video.addEventListener("playing", () => {
      document.title = "▶ TRUE LOVE — pop-out player";
    });
  }
  const close = document.getElementById("love-close");
  if (close) {
    close.addEventListener("click", () => {
      post("video-closed");
      window.close();
    });
  }
  const cleanup = () => post("video-closed");
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);
})();