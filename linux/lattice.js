(function () {
  var plate = document.getElementById("plate");
  var body = document.getElementById("ledger-body");
  var countEl = document.getElementById("count");
  var query = document.getElementById("q");
  var hoverline = document.getElementById("hoverline");
  var live = document.getElementById("live");
  var NS = "http://www.w3.org/2000/svg";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var mode = "all";
  var selected = "easter47:10";
  var byId = Object.create(null);
  var links = [];
  var visible = [];

  var NOTES = {
    "easter47:10": "This track pins linux seq 349 and the linux primary PGP key. The payload hash is below.",
    "linux:349": "Chain head of linux. The easter47 track names this link.",
    "linux:276": "Publishes the current linux primary PGP key da994c8789892c2c9ca0df149e88d841d1ddc62e.",
    "easter47:24": "Publishes easter47 PGP 20867A78369EA23A420DF3C4D10E7AF2A93DE56B. That key is not the linux primary.",
    "linux:272": "DNS proof for htp.sh. The live apex carries this text.",
    "easter47:25": "DNS proof for htp.sh. The live _keybase.htp.sh name carries this text.",
    "linux:273": "DNS proof for files.htp.sh. The live TXT matches this link.",
    "easter47:19": "DNS proof for war.htp.sh. The live TXT matches this link.",
    "linux:281": "GitHub proof for tailoredaccessoperations, state ok.",
    "easter47:5": "GitHub proof for tailoredaccessoperations. State on the account is superseded.",
    "easter47:9": "Bitcoin claim for the genesis coinbase address. A claim is not spend control."
  };

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
    }
    return node;
  }

  function spiral(order, n) {
    var t = n < 2 ? 0 : order / (n - 1);
    var ang = -Math.PI / 2 + t * 5 * Math.PI * 2;
    var rad = 292 + t * 176;
    return [500 + Math.cos(ang) * rad, 500 + Math.sin(ang) * rad];
  }

  function flower(root) {
    return [500 + root.x * 210, 500 + root.y * 210];
  }

  function pathOf(points) {
    return points.map(function (p, i) {
      return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
    }).join("");
  }

  function bow(a, b, amount) {
    var mx = (a[0] + b[0]) / 2;
    var my = (a[1] + b[1]) / 2;
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len = Math.hypot(dx, dy) || 1;
    return "M " + a[0].toFixed(1) + " " + a[1].toFixed(1) +
      " Q " + (mx - dy / len * amount).toFixed(1) + " " + (my + dx / len * amount).toFixed(1) +
      " " + b[0].toFixed(1) + " " + b[1].toFixed(1);
  }

  function drawIn(path) {
    if (reduce) return;
    var length = path.getTotalLength();
    if (!length) return;
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    path.getBoundingClientRect();
    path.style.transition = "stroke-dashoffset 1.5s cubic-bezier(0.32, 0.72, 0, 1)";
    path.style.strokeDashoffset = "0";
  }

  function matches(link, needle) {
    if (mode === "linux" && link.account !== "linux") return false;
    if (mode === "easter47" && link.account !== "easter47") return false;
    if (mode === "sync" && !link.marks.length) return false;
    if (!needle) return true;
    return link.hay.indexOf(needle) !== -1;
  }

  function applyFilter() {
    var needle = query.value.trim().toLowerCase();
    visible = [];
    var shown = 0;
    links.forEach(function (link) {
      var on = matches(link, needle);
      link.bead.setAttribute("class", "bead " + (link.account === "linux" ? "linux" : "easter") + (on ? "" : " dim"));
      link.row.hidden = !on;
      if (on) {
        visible.push(link);
        shown += 1;
      }
    });
    countEl.textContent = shown + " shown";
    plate.classList.toggle("show-names", mode === "sync");
    plate.querySelectorAll("#chords path").forEach(function (path) {
      var a = byId[path.dataset.a];
      var b = byId[path.dataset.b];
      var named = path.dataset.kind === "name";
      var on = a && b && !a.row.hidden && !b.row.hidden && (!named || mode === "sync");
      path.style.visibility = on ? "visible" : "hidden";
    });
    if (!byId[selected] || byId[selected].row.hidden) {
      if (visible.length) select(visible[0].id, true);
    } else {
      paintSelection();
    }
  }

  function fillFacts(link) {
    var facts = document.getElementById("read-facts");
    facts.replaceChildren();
    var rows = [
      ["Signed", link.time],
      ["Type", link.type],
      ["Signature", link.kind + " v" + link.version],
      ["Check", link.check + (link.state ? " · " + link.state : "")],
      ["Root", link.root + " of 240 · " + (link.half ? "half-integer" : "integer")],
      ["Distance", String(link.distance)],
      ["Payload hash", link.hash],
      ["Sig id", link.sig]
    ];
    rows.forEach(function (pair) {
      var dt = document.createElement("dt");
      dt.textContent = pair[0];
      var dd = document.createElement("dd");
      dd.textContent = pair[1];
      if (pair[0] === "Payload hash" || pair[0] === "Sig id") {
        dd.className = "hash";
        dd.textContent = pair[1].replace(/(.{16})/g, "$1 ").trim();
      }
      facts.appendChild(dt);
      facts.appendChild(dd);
    });
  }

  function paintSelection() {
    var link = byId[selected];
    if (!link) return;
    var halo = plate.querySelector(".halo");
    var spoke = plate.querySelector(".spoke");
    halo.setAttribute("cx", link.pos[0].toFixed(1));
    halo.setAttribute("cy", link.pos[1].toFixed(1));
    halo.setAttribute("r", link.account === "easter47" ? "9" : "8");
    spoke.setAttribute("x1", link.pos[0].toFixed(1));
    spoke.setAttribute("y1", link.pos[1].toFixed(1));
    spoke.setAttribute("x2", link.rootPos[0].toFixed(1));
    spoke.setAttribute("y2", link.rootPos[1].toFixed(1));
    plate.querySelectorAll(".root-dot.on").forEach(function (node) {
      node.classList.remove("on");
    });
    link.rootEl.classList.add("on");
    document.querySelectorAll("#ledger-body tr.is-on").forEach(function (row) {
      row.classList.remove("is-on");
    });
    link.row.classList.add("is-on");
    document.getElementById("read-kicker").textContent = link.account + " · root " + link.root;
    document.getElementById("read-title").textContent = "seq " + link.seq;
    document.getElementById("read-statement").textContent = link.statement;
    document.getElementById("read-note").textContent = NOTES[link.id] || "";
    hoverline.textContent = link.account + " seq " + link.seq + " · " + link.statement;
    fillFacts(link);
    live.textContent = link.account + " seq " + link.seq + ". " + link.statement + ". Root " + link.root + ". " + link.check + ".";
  }

  function select(id, quietScroll) {
    if (!byId[id]) return;
    selected = id;
    paintSelection();
  }

  function cursor(event) {
    var point = plate.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    var ctm = plate.getScreenCTM();
    if (!ctm) return null;
    var mapped = point.matrixTransform(ctm.inverse());
    return [mapped.x, mapped.y];
  }

  function nearestVisible(point, limit) {
    var best = null;
    var bestD = limit * limit;
    visible.forEach(function (link) {
      var dx = link.pos[0] - point[0];
      var dy = link.pos[1] - point[1];
      var d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = link;
      }
    });
    return best;
  }

  function move(step) {
    if (!visible.length) return;
    var index = visible.findIndex(function (link) { return link.id === selected; });
    if (index < 0) index = 0;
    else index = (index + step + visible.length) % visible.length;
    select(visible[index].id);
  }

  function render(doc) {
    var n = doc.links.length;
    var guide = [];
    for (var i = 0; i <= 720; i++) guide.push(spiral(i / 720 * (n - 1), n));
    plate.appendChild(el("path", { class: "guide", d: pathOf(guide) }));

    var rootNodes = new Array(doc.roots.length);
    doc.roots.forEach(function (root) {
      var at = flower(root);
      var node = root.half
        ? el("circle", { class: "root-dot half", cx: at[0].toFixed(1), cy: at[1].toFixed(1), r: "2.1" })
        : el("rect", {
          class: "root-dot",
          x: (at[0] - 1.7).toFixed(1),
          y: (at[1] - 1.7).toFixed(1),
          width: "3.4",
          height: "3.4"
        });
      rootNodes[root.i] = node;
      plate.appendChild(node);
    });
    links.forEach(function (link) {
      link.rootEl = rootNodes[link.root];
    });

    var linuxPath = el("path", { class: "chain linux", d: pathOf(links.filter(function (link) { return link.account === "linux"; }).map(function (link) { return link.pos; })) });
    var easterPath = el("path", { class: "chain easter", d: pathOf(links.filter(function (link) { return link.account === "easter47"; }).map(function (link) { return link.pos; })) });
    plate.appendChild(linuxPath);
    plate.appendChild(easterPath);

    links.forEach(function (link) {
      var bead = link.account === "linux"
        ? el("circle", { class: "bead linux", cx: link.pos[0].toFixed(1), cy: link.pos[1].toFixed(1), r: "3.6" })
        : el("circle", { class: "bead easter", cx: link.pos[0].toFixed(1), cy: link.pos[1].toFixed(1), r: "4.4" });
      plate.appendChild(bead);
      link.bead = bead;
    });

    var chords = el("g", { id: "chords" });
    doc.chords.forEach(function (chord) {
      var a = byId[chord.a];
      var b = byId[chord.b];
      if (!a || !b) return;
      [bow(a.rootPos, b.rootPos, 42), bow(a.pos, b.pos, 26)].forEach(function (d) {
        var path = el("path", { class: chord.kind === "name" ? "chord name" : "chord", d: d });
        path.dataset.a = chord.a;
        path.dataset.b = chord.b;
        path.dataset.kind = chord.kind;
        chords.appendChild(path);
      });
    });
    plate.appendChild(chords);
    plate.appendChild(el("line", { class: "spoke", x1: "0", y1: "0", x2: "0", y2: "0" }));
    plate.appendChild(el("circle", { class: "halo", cx: "0", cy: "0", r: "8" }));

    document.getElementById("occupied").textContent = doc.occupiedRoots + " of 240 roots hold a link";
    drawIn(linuxPath);
    drawIn(easterPath);
    applyFilter();
    select("easter47:10", true);
  }

  function buildRows(doc) {
    var frag = document.createDocumentFragment();
    doc.links.forEach(function (link) {
      var tr = document.createElement("tr");
      tr.dataset.id = link.id;
      tr.dataset.account = link.account;
      var cells = [
        link.account,
        String(link.seq),
        link.time,
        link.type,
        link.statement,
        link.root + " " + (link.half ? "half" : "integer"),
        link.check
      ];
      cells.forEach(function (text, index) {
        var td = document.createElement("td");
        td.textContent = text;
        if (index === 1 || index === 2 || index === 5) td.className = "num";
        if (index === 6) td.className = "pass";
        tr.appendChild(td);
      });
      frag.appendChild(tr);
      link.row = tr;
      link.hay = (link.account + " " + link.seq + " " + link.time + " " + link.type + " " + link.statement + " " + link.check + " " + link.root + " " + link.hash).toLowerCase();
    });
    body.appendChild(frag);
  }

  plate.addEventListener("pointermove", function (event) {
    var point = cursor(event);
    if (!point) return;
    var link = nearestVisible(point, 22);
    hoverline.textContent = link ? link.account + " seq " + link.seq + " · " + link.statement : "Select a bead or a ledger row.";
  });

  plate.addEventListener("pointerdown", function (event) {
    var point = cursor(event);
    if (!point) return;
    var link = nearestVisible(point, 26);
    if (link) select(link.id);
  });

  plate.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (visible.length) select(visible[0].id);
    } else if (event.key === "End") {
      event.preventDefault();
      if (visible.length) select(visible[visible.length - 1].id);
    }
  });

  body.addEventListener("click", function (event) {
    var row = event.target.closest("tr");
    if (row && row.dataset.id) select(row.dataset.id);
  });

  document.querySelectorAll(".modes button").forEach(function (button) {
    button.addEventListener("click", function () {
      mode = button.dataset.mode;
      document.querySelectorAll(".modes button").forEach(function (other) {
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
      });
      applyFilter();
    });
  });

  query.addEventListener("input", applyFilter);

  fetch("/linux/lattice.json")
    .then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    })
    .then(function (doc) {
      if (!doc.axioms || !doc.axioms.ok || doc.links.length !== 374 || doc.roots.length !== 240) {
        throw new Error("lattice index failed its own checks");
      }
      doc.links.forEach(function (link) {
        link.pos = spiral(link.order, doc.links.length);
        link.rootPos = flower(doc.roots[link.root]);
        link.rootEl = null;
        byId[link.id] = link;
        links.push(link);
      });
      buildRows(doc);
      render(doc);
    })
    .catch(function () {
      document.getElementById("read-title").textContent = "Index missing";
      document.getElementById("read-statement").textContent = "The lattice index did not load. The sigchains remain on the linux record.";
    });
})();
