/*!
 * hls-lite.js — minimal VOD HLS (fMP4) player with no third-party dependency.
 *
 * WHY THIS EXISTS
 *   The site's largest clips exceed Cloudflare's 25 MiB per-file static-asset
 *   limit, so they are published as HLS: a playlist plus many small .m4s
 *   segments. That gives three things a single MP4 cannot — every file clears
 *   the limit, playback starts after the first segment instead of after the
 *   whole download, and seeking only fetches the segments around the new time.
 *
 *   Safari plays HLS natively. Chrome and Firefox do not, so this uses Media
 *   Source Extensions to feed the same segments to the <video> element.
 *
 * SCOPE — deliberately VOD only, matching what scripts/media-pipeline.mjs emits:
 *   · fMP4 segments with an EXT-X-MAP init segment
 *   · a finite, fully-written playlist (EXT-X-PLAYLIST-TYPE:VOD, ENDLIST)
 *   · no live playlists, no EXT-X-KEY, no EXT-X-BYTERANGE, no audio/subtitle
 *     renditions. Those need a real player; a half-implementation that
 *     silently drops them would be worse than not supporting them.
 *
 * `options.progressive` starts playback after the init segment and the first
 * media segment, and keeps appending while the rest download. Without it,
 * attach() waits until every segment is fetched (the original behaviour).
 *
 * Progressive enhancement: callers should always keep a plain MP4 fallback.
 * If anything here throws, `attach()` rejects and the caller uses that.
 */
(function (global) {
  'use strict';

  /** Parse an HLS playlist into { init, segments[], duration }. */
  function parsePlaylist(text) {
    var lines = text.split(/\r?\n/);
    var init = null;
    var segments = [];
    var pendingDuration = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (line.indexOf('#EXT-X-MAP:') === 0) {
        var m = /URI="([^"]+)"/.exec(line);
        if (m) init = m[1];
      } else if (line.indexOf('#EXTINF:') === 0) {
        pendingDuration = parseFloat(line.slice(8)) || 0;
      } else if (line.charAt(0) !== '#') {
        segments.push({ uri: line, duration: pendingDuration });
        pendingDuration = 0;
      }
    }

    if (!segments.length) throw new Error('hls-lite: playlist has no segments');
    return { init: init, segments: segments };
  }

  /** Resolve a possibly-relative playlist/segment URI against the playlist URL. */
  function resolveUrl(uri, base) {
    try {
      return new URL(uri, base).toString();
    } catch (e) {
      return uri;
    }
  }

  /**
   * True when the browser can play this playlist natively (Safari, and any
   * platform that has since shipped native HLS). Avoids a pointless MSE setup.
   */
  function nativeSupport(video) {
    return !!(video.canPlayType &&
      video.canPlayType('application/vnd.apple.mpegurl'));
  }

  function fetchWithTimeout(url, signal, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 20000);
    var opts = { signal: ctrl ? ctrl.signal : undefined };
    if (signal) {
      if (signal.aborted && ctrl) ctrl.abort();
      else if (signal.addEventListener) signal.addEventListener('abort', function () { if (ctrl) ctrl.abort(); });
    }
    return fetch(url, opts).finally(function () { clearTimeout(timer); });
  }

  /**
   * Attach an HLS playlist to a <video>.
   * Resolves to true when playback was wired up, false when native HLS was
   * used (src set directly). Rejects if MSE is unavailable or the fetch fails,
   * so the caller can fall back to a plain MP4.
   */
  function attach(video, playlistUrl, options) {
    options = options || {};
    var mimeType = options.mimeType ||
      'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';

    if (nativeSupport(video)) {
      video.src = playlistUrl;
      return Promise.resolve({ mode: 'native', segments: 0 });
    }

    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mimeType)) {
      return Promise.reject(new Error('hls-lite: no HLS support (no MSE / codec)'));
    }

    var base = playlistUrl;
    return fetchWithTimeout(base, options.signal)
      .then(function (res) {
        if (!res.ok) throw new Error('hls-lite: playlist ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var parsed = parsePlaylist(text);
        var mediaSource = new MediaSource();
        var objectUrl = URL.createObjectURL(mediaSource);
        video.src = objectUrl;

        return new Promise(function (resolve, reject) {
          var settled = false;
          function fail(err) {
            if (settled) return;
            settled = true;
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
            reject(err);
          }

          mediaSource.addEventListener('sourceopen', function () {
            var sb;
            try {
              sb = mediaSource.addSourceBuffer(mimeType);
              sb.mode = 'segments';
            } catch (e) {
              return fail(e);
            }

            var queue = [];
            var index = 0;
            var appending = false;
            var fetchDone = false;
            var progressive = !!options.progressive;
            var readyAt = parsed.init ? 2 : 1;

            function report(done) {
              resolve({
                mode: 'mse',
                segments: parsed.segments.length,
                init: parsed.init,
                objectUrl: objectUrl,
                progressive: progressive,
                complete: !!done
              });
            }

            function finishIfDrained() {
              if (appending || index < queue.length || !fetchDone) return;
              try {
                if (mediaSource.readyState === 'open') mediaSource.endOfStream();
              } catch (e) { /* already ended */ }
              if (!settled) {
                settled = true;
                report(true);
              }
            }

            function pump() {
              if (appending) return;
              if (index >= queue.length) {
                finishIfDrained();
                return;
              }

              var next = queue[index++];
              appending = true;
              try {
                sb.appendBuffer(next);
              } catch (e) {
                appending = false;
                return fail(e);
              }
            }

            sb.addEventListener('updateend', function () {
              appending = false;
              if (progressive && !settled && index >= readyAt) {
                settled = true;
                report(false);
              }
              pump();
            });
            sb.addEventListener('error', function () {
              appending = false;
              fail(new Error('hls-lite: source buffer error'));
            });

            // Fetch the init segment first — without it no media parses.
            // Progressive mode appends as each piece arrives so the first
            // frame can play before the rest of a long film has downloaded.
            var initPromise = parsed.init
              ? fetchWithTimeout(resolveUrl(parsed.init, base), options.signal)
                  .then(function (r) { return r.arrayBuffer(); })
              : Promise.resolve(null);

            initPromise.then(function (initBuf) {
              if (initBuf) queue.push(initBuf);
              if (progressive) pump();
              var chain = Promise.resolve();
              parsed.segments.forEach(function (seg) {
                chain = chain.then(function () {
                  return fetchWithTimeout(resolveUrl(seg.uri, base), options.signal)
                    .then(function (r) {
                      if (!r.ok) throw new Error('hls-lite: segment ' + seg.uri + ' ' + r.status);
                      return r.arrayBuffer();
                    })
                    .then(function (buf) {
                      queue.push(buf);
                      if (progressive) pump();
                    });
                });
              });
              return chain;
            }).then(function () {
              fetchDone = true;
              pump();
            }).catch(fail);
          });

          mediaSource.addEventListener('error', function () {
            fail(new Error('hls-lite: MediaSource error'));
          });
        });
      });
  }

  global.HlsLite = { attach: attach, parsePlaylist: parsePlaylist, nativeSupport: nativeSupport };
})(window);