/* Progressive asset loading for the static page. */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = navigator.connection?.saveData === true;
  const idle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 1));

  function upgradeImages() {
    document.querySelectorAll("img[data-src]").forEach((img) => {
      img.src = img.dataset.src;
      if (img.dataset.srcset) img.srcset = img.dataset.srcset;
      img.removeAttribute("data-src");
      img.removeAttribute("data-srcset");
    });
  }

  function prepareMedia() {
    document.querySelectorAll("video[data-src]").forEach((video) => {
      if (!video.getAttribute("src")) video.src = video.dataset.src;
      video.removeAttribute("data-src");
      if (!reduceMotion && !saveData) video.preload = "metadata";
    });
  }

  function startDecorativeMedia() {
    if (reduceMotion || saveData || document.visibilityState !== "visible") return;
    document.querySelectorAll("video[autoplay][data-decorative]").forEach((video) => {
      video.play().catch(() => {});
    });
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries, io) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = entry.target;
        if (target.matches("img[data-src]")) {
          target.src = target.dataset.src;
          if (target.dataset.srcset) target.srcset = target.dataset.srcset;
          target.removeAttribute("data-src");
          target.removeAttribute("data-srcset");
        } else if (target.matches("video[data-src]")) {
          target.src = target.dataset.src;
          target.removeAttribute("data-src");
          if (!reduceMotion && !saveData) target.load();
        }
        io.unobserve(target);
      });
    }, { rootMargin: "240px 0px" });
    document.querySelectorAll("img[data-src], video[data-src]").forEach((asset) => observer.observe(asset));
  } else {
    idle(() => { upgradeImages(); prepareMedia(); });
  }

  idle(() => {
    prepareMedia();
    startDecorativeMedia();
  }, { timeout: 1500 });
})();
