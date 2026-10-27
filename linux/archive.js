(function () {
  function bind(input) {
    var table = document.getElementById(input.getAttribute("data-table"));
    var count = document.getElementById(input.getAttribute("data-count"));
    if (!table) return;
    var rows = table.querySelectorAll("tbody tr");
    function apply() {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var ok = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
        row.hidden = !ok;
        if (ok) shown += 1;
      }
      if (count) count.textContent = shown + " shown";
    }
    input.addEventListener("input", apply);
  }
  var inputs = document.querySelectorAll("input[data-table]");
  for (var i = 0; i < inputs.length; i++) bind(inputs[i]);
})();
