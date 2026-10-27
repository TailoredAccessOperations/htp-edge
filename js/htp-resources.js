/* HTP · live resources — pulls the latest @MadMonero posts from the raw KV feed
 * at /x.ai/MadMonero (Worker htp-xai-raw). Same-origin fetch only; all text is
 * rendered with textContent (never innerHTML). Links restricted to x.com. */
(function () {
  "use strict";
  var FEED = "/x.ai/MadMonero";
  var MAX = 5;
  var list = document.getElementById("mm-list");
  var meta = document.getElementById("mm-meta");
  if (!list || !window.fetch) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function safeX(u) {
    return /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+$/.test(u) ? u : null;
  }
  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
  function parse(txt) {
    var head = {};
    var body = [];
    txt.split(/\r?\n/).forEach(function (line) {
      var m = /^#\s*([a-z]+):\s*(.*)$/i.exec(line);
      if (m) head[m[1].toLowerCase()] = m[2];
      else if (!/^#/.test(line)) body.push(line);
    });
    var posts = [];
    var buf = [];
    body.forEach(function (line) {
      var t = line.trim();
      if (/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+$/.test(t)) {
        var when = null;
        while (buf.length && buf[buf.length - 1].trim() === "") buf.pop();
        if (buf.length && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(buf[buf.length - 1].trim())) when = buf.pop().trim();
        var text = buf.join("\n").trim();
        if (text) posts.push({ text: text, when: when, url: t });
        buf = [];
      } else {
        buf.push(line);
      }
    });
    return { head: head, posts: posts };
  }
  function render(data) {
    list.textContent = "";
    var posts = data.posts.slice(0, MAX);
    if (!posts.length) {
      list.appendChild(el("li", "dim", "Feed is empty — the boat left without posts. Open the raw file anyway."));
      return;
    }
    posts.forEach(function (p) {
      var li = el("li");
      var t = p.text;
      var rt = /^RT (@[A-Za-z0-9_]+):\s*/.exec(t);
      if (rt) {
        li.appendChild(el("span", "res-rt", "RT " + rt[1] + " · "));
        t = t.slice(rt[0].length);
      }
      li.appendChild(document.createTextNode(t.length > 280 ? t.slice(0, 277) + "…" : t));
      var w = el("span", "res-when");
      var href = p.url && safeX(p.url);
      if (href) {
        var a = el("a", null, p.when ? fmt(p.when) : "view on X");
        a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
        w.appendChild(a);
      } else if (p.when) {
        w.textContent = fmt(p.when);
      }
      li.appendChild(w);
      list.appendChild(li);
    });
    if (meta) {
      var bits = [];
      if (data.head.fetched) bits.push("fetched " + data.head.fetched);
      if (data.head.count) bits.push(data.head.count.replace(/^(\d+)/, "$1 posts"));
      if (data.head.window) bits.push(data.head.window.replace(/\s*\(.*\)\s*$/, ""));
      meta.textContent = bits.join(" · ");
    }
  }
  fetch(FEED, { headers: { Accept: "text/plain" }, credentials: "same-origin", cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      // Feed can be 300KB+; only the newest posts are shown, so read the head and stop.
      if (!r.body || !r.body.getReader || !window.TextDecoder) return r.text();
      var reader = r.body.getReader(), dec = new TextDecoder(), out = "";
      return (function pump() {
        return reader.read().then(function (c) {
          if (c.done) return out + dec.decode();
          out += dec.decode(c.value, { stream: true });
          if (out.length >= 24576) { try { reader.cancel(); } catch (e) {} return out.slice(0, out.lastIndexOf("\n") + 1); }
          return pump();
        });
      })();
    })
    .then(function (txt) { render(parse(txt)); })
    .catch(function () {
      list.textContent = "";
      list.appendChild(el("li", "dim", "Live preview unavailable — open the raw feed directly."));
    });
})();
