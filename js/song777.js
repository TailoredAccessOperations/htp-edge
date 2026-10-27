/* 777.mp4 is the homepage picture and the only song. */
(function () {
  const song = document.getElementById("song777");
  if (!song) return;

  function hush() {
    document.querySelectorAll("video, audio").forEach((el) => {
      if (el === song) return;
      el.muted = true;
      el.volume = 0;
    });
  }

  function playMuted() {
    song.preload = "metadata";
    song.load();
    song.muted = true;
    song.volume = 1;
    const pending = song.play();
    if (pending) pending.catch(() => {});
  }

  function playLoud() {
    hush();
    song.volume = 1;
    song.muted = false;
    const pending = song.play();
    if (!pending) return;
    pending.catch(playMuted);
  }

  hush();
  // Playback starts only from the shared first real gesture.
  document.addEventListener("DOMContentLoaded", hush);
  song.addEventListener("canplay", () => {
    if (song.paused) playMuted();
  });

  addEventListener("pointerdown", playLoud, { capture: true });
  addEventListener("keydown", playLoud, { capture: true });
  document.addEventListener("play", (event) => {
    if (event.target !== song) hush();
  }, true);
  document.addEventListener("volumechange", (event) => {
    const el = event.target;
    if (el && el !== song && el.muted === false) hush();
  }, true);
})();
