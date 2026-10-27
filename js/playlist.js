(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const boot = $("htp-boot");
  const ghost = $("ghostvideo");
  const av = $("avstage");
  const amp = $("htp-amp");
  const queue = $("htp-playlist");
  const listEl = $("htp-tracklist");
  const nowEl = queue ? queue.querySelector("[data-now]") : null;
  const seqEl = queue ? queue.querySelector("[data-seq]") : null;

  // n1c3_r3p0rt.mp3 is the site bed. It starts on the first gesture, rides under
  // d0ct0r.mp4, then loops on repeat over ghost.mp4 until the visitor leaves.
  const BED = "music/n1c3_r3p0rt.mp3";

  // d0ct0r.mp4 (Dr Raid · ClockWork) is the load-in opener. It plays silent on
  // top of the bed, then hands the screen back to ghost.mp4.
  const DOCTOR = { label: "d0ct0r.mp4", src: "videos/d0ct0r.mp4" };

  // Manual A/V picks. d0ct0r.mp4 leads so the tracklist order matches the load.
  const VIDEOS = [
    DOCTOR,
    { label: "RCE.mp4", src: "videos/RCE.mp4" },
    { label: "OWNED.mp4", src: "videos/OWNED.mp4" }
  ];

// MP3 queue in playlist order. The randpool names are ROT13 of each
  // downloaded file's sha512sum (first 32 hex chars).
  const TRACKS = [
    "music/5qpor6rn31072p34278n29n61nn22178.mp3",
    "music/0n4p09656nr3670665784p524s21330q.mp3",
    "music/27463n3rsn1470085r3po8n4p26049p1.mp3",
    "music/15qpn33sn18796s5r4r45629nq6qn879.mp3",
    "music/o734519po002n7sqs59sn32qsr397r8s.mp3",
    "music/n356r8sqqnq0r470137n76noo0p028r1.mp3",
    "music/59578n40o972sr71rprnoo0q7rr231p.mp3"
  ];

  const basename = (p) => p.split("/").pop().replace(/\.mp3$/i, "");

  // Entry 01 is the bed itself so the tracklist reads the load-in order.
  const items = [
    { kind: "bed", label: basename(BED), src: BED }
  ].concat(
    VIDEOS.map((v) => ({ kind: "video", label: v.label, src: v.src })),
    TRACKS.map((t) => ({ kind: "audio", label: basename(t), src: t }))
  );

  let idx = 0;
  let started = false;
  let active = 0;
  let lastVideo = -1;
  let doctorActive = false;
  let bedLoaded = false;

  const buildList = () => {
    if (!listEl) return;
    listEl.innerHTML = "";
    items.forEach((it, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      const n = document.createElement("span");
      const l = document.createElement("span");
      const m = document.createElement("span");
      n.className = "q-n";
      l.className = "q-l";
      m.className = "q-m";
      btn.type = "button";
      n.textContent = String(i + 1).padStart(2, "0");
      l.textContent = it.kind === "video" ? it.label + " · A/V" : it.label;
      btn.title =
        it.kind === "bed"
          ? "loop " + it.label + " until you leave"
          : it.kind === "audio"
            ? "play " + it.label
            : "play " + it.label + " with audio + video";
      btn.setAttribute("aria-label", btn.title);
      btn.addEventListener("click", () => {
        if (it.kind === "bed") {
          playBed();
        } else if (it.kind === "video") {
          playVideo(i - 1);
        } else {
          playAudio(i - VIDEOS.length - 1);
        }
      });
      btn.append(n, l, m);
      li.append(btn);
      listEl.append(li);
    });
  };

  const showQueue = () => {
    if (queue && queue.hidden) queue.hidden = false;
  };

  const setStatus = (text, act) => {
    active = act;
    if (nowEl) nowEl.textContent = text;
    if (seqEl) seqEl.textContent = String(act + 1).padStart(2, "0") + " / " + items.length;
    if (!listEl) return;
    [...listEl.children].forEach((li, i) => {
      const on = i === act;
      li.classList.toggle("on", on);
      const mm = li.querySelector(".q-m");
      if (mm) mm.textContent = on ? "▶" : "";
    });
  };

  const setMediaSession = (title, album) => {
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title,
          artist: "HTP | 1.3.3.7",
          album: album || "RANDPOOL"
        });
      } catch {}
    }
  };

  const muteAmbient = () => {
    const bg = $("bgmusic");
    const love = $("love-bg");
    if (bg) {
      bg.pause();
      bg.muted = true;
      try { bg.volume = 0; } catch {}
    }
    if (love) {
      love.pause();
      love.muted = true;
      try { love.volume = 0; } catch {}
    }
    // a selected queue track supersedes the ambient carriers
    if (window.__htpMalware) window.__htpMalware.pause();
  };

  const stopAmp = () => {
    if (!amp) return;
    amp.pause();
    amp.removeAttribute("src");
    try { amp.load(); } catch {}
    bedLoaded = false;
  };

  const stopAv = () => {
    if (!av) return;
    av.pause();
    av.removeAttribute("src");
    try { av.load(); } catch {}
    av.hidden = true;
  };

  // ghost.mp4 settles in as the video-only bed (no audio) behind the rain.
  const ghostBed = () => {
    if (av) av.hidden = true;
    if (ghost) {
      ghost.muted = true;
      ghost.loop = true;
      ghost.play().catch(() => {});
    }
  };

  // n1c3_r3p0rt.mp3 on repeat. Never advances — this is the floor everything
  // else plays over, and it survives video openers and queue picks.
  const startBed = () => {
    if (!amp) return;
    amp.loop = true;
    if (!bedLoaded) {
      amp.src = BED;
      amp.currentTime = 0;
      bedLoaded = true;
    }
    amp.play().catch(() => {});
  };

  const playBed = () => {
    muteAmbient();
    stopAv();
    doctorActive = false;
    idx = -1;
    startBed();
    ghostBed();
    showQueue();
    setStatus("PLAYING " + basename(BED) + " · LOOP", 0);
    setMediaSession(basename(BED), "BED | HTP");
  };

  // Load-in: d0ct0r.mp4 opens the visit, silent, over the n1c3_r3p0rt bed.
  const playDoctor = () => {
    muteAmbient();
    idx = -1;
    startBed();
    if (!av) {
      ghostBed();
      setStatus("PLAYING " + basename(BED) + " · LOOP", 0);
      return;
    }
    if (ghost) ghost.pause();
    av.hidden = false;
    av.muted = true;
    av.loop = false;
    av.src = DOCTOR.src;
    av.currentTime = 0;
    doctorActive = true;
    lastVideo = 0;
    av.play().catch(() => {});
    showQueue();
    setStatus("PLAYING " + DOCTOR.label + " · " + basename(BED), 1);
    setMediaSession(DOCTOR.label, "D0CT0R | HTP");
  };

  // d0ct0r.mp4 has rolled: ghost.mp4 takes the screen for good and the bed
  // keeps looping underneath until the visitor leaves the page.
  const afterDoctor = () => {
    doctorActive = false;
    ghostBed();
    startBed();
    setStatus("PLAYING " + basename(BED) + " · LOOP", 0);
    setMediaSession(basename(BED), "BED | HTP");
  };

  const playVideo = (i) => {
    if (!av || !VIDEOS[i]) return;
    lastVideo = i;
    doctorActive = false;
    muteAmbient();
    stopAmp();
    idx = 0;
    if (ghost) ghost.pause();
    av.hidden = false;
    av.muted = false;
    av.loop = false;
    av.src = VIDEOS[i].src;
    av.currentTime = 0;
    av.play().catch(() => {});
    showQueue();
    setStatus("PLAYING " + VIDEOS[i].label + " · A/V", i + 1);
    setMediaSession(VIDEOS[i].label);
  };

  const playAudio = (i) => {
    if (!amp || !TRACKS[i]) return;
    muteAmbient();
    doctorActive = false;
    idx = i;
    ghostBed();
    amp.loop = false;
    amp.src = TRACKS[i];
    amp.currentTime = 0;
    bedLoaded = false;
    amp.play().catch(() => {});
    showQueue();
    setStatus("PLAYING " + basename(TRACKS[i]), i + VIDEOS.length + 1);
    setMediaSession(basename(TRACKS[i]));
  };

  // A queue pass ends by handing the floor back to the n1c3_r3p0rt bed.
  const nextMp3 = () => {
    const next = idx + 1;
    if (next >= TRACKS.length) return playBed();
    playAudio(next);
  };

  // after the manual video openers, the bed resumes
  const afterVideo = (i) => {
    if (i + 1 < VIDEOS.length) {
      playVideo(i + 1);
    } else {
      playBed();
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    if (boot) {
      boot.hidden = true;
      // main.js holds the terminal's autofocus until the gate is down, so the
      // caret never lands on an input hidden behind the splash.
      boot.dispatchEvent(new Event("htp:boot-dismissed"));
    }
    playDoctor();
  };

  if (av) {
    const avDone = () => {
      if (doctorActive) return afterDoctor();
      afterVideo(lastVideo);
    };
    av.addEventListener("ended", avDone);
    av.addEventListener("error", avDone);
  }

  // the /malware.html pop-out finished: hand the floor back to the bed
  if (!window.__htpPlaylist) {
    window.__htpPlaylist = { afterMalware: () => playBed() };
  }

  if (amp) {
    amp.addEventListener("ended", nextMp3);
    amp.addEventListener("error", nextMp3);
  }

  const init = () => {
    buildList();
    if (!boot || !av || !amp) return;
    boot.addEventListener("click", start);
    // Media startup goes through the shared first-gesture arbiter (init.js).
    // A keystroke must never start a 4MB video — that used to fire on the
    // visitor's first terminal command and stall the tty while it buffered.
    if (window.__htpMedia) {
      window.__htpMedia.onGesture(start);
      window.__htpMedia.armed();
    } else {
      // No arbiter (script blocked): fall back to pointer gestures only.
      for (const ev of ["pointerdown", "touchstart"]) {
        document.addEventListener(ev, start, { once: true, passive: true });
      }
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
