(function () {
  "use strict";
  var links = document.querySelectorAll(
    'link[rel="stylesheet"][media="print"][data-async-css]'
  );
  function activate(l) {
    if (l.getAttribute("data-async-css") === "done") return;
    l.setAttribute("data-async-css", "done");
    l.media = "all";
  }
  for (var i = 0; i < links.length; i++) {
    (function (l) {
      if (l.sheet) { activate(l); return; }
      var done = false;
      function ready() { if (done) return; done = true; activate(l); }
      if (l.addEventListener) {
        l.addEventListener("load", ready);
        l.addEventListener("error", ready);
        setTimeout(ready, 5000);
      } else {
        l.attachEvent("onload", ready);
      }
    })(links[i]);
  }
})();
