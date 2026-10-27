/* Staged homepage boot: audio -> visual systems -> page display. */
(() => {
  "use strict";

  const root = document.documentElement;
  const song = document.getElementById("song777");
  const visualTargets = [
    document.getElementById("matrix"),
    document.getElementById("crt"),
    document.getElementById("scanlines"),
    document.getElementById("tv"),
    document.getElementById("media-stage"),
    document.querySelector(".song-stage"),
  ].filter(Boolean);

  root.classList.add("booting");
  root.dataset.bootStage = "audio";

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const playAudio = () => {
    if (!song) return Promise.resolve(false);
    song.muted = false;
    song.volume = 1;
    const attempt = song.play();
    if (!attempt || typeof attempt.then !== "function") return Promise.resolve(true);
    return attempt.then(() => true).catch(() => false);
  };

  const startVisuals = () => {
    root.dataset.bootStage = "visual";
    visualTargets.forEach((element) => element.classList.add("boot-ready"));
  };

  const displayPage = () => {
    root.dataset.bootStage = "display";
    root.classList.remove("booting");
    root.classList.add("boot-complete");
  };

  const boot = async () => {
    root.dataset.bootAudio = "blocked";
    root.addEventListener("pointerdown", playAudio, { once: true, capture: true });
    await wait(160);
    startVisuals();
    await wait(420);
    displayPage();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
