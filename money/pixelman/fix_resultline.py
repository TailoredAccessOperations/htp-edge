import sys
filename = '/Users/piv/projects/agi/f22-website/components/E8HexTool.tsx'
with open(filename, 'r') as f:
    lines = f.readlines()
# lines are 0-indexed
# line 401 is index 400
# we want to replace lines 400 to 410 (inclusive) because line 411 is the }; line? Let's check.
# Actually, we want to replace from line 401 to line 411 inclusive (the old function).
# That's indices 400 to 410 inclusive (since 411-1=410).
new_lines = [
  '  const resultLine = (elm, rootId, extra = "") => {\n',
  '    if (!elm) return;\n',
  '    const r = roots[rootId];\n',
  '    elm.innerHTML = `<div><span class="hit">root ${"#" + String(rootId).padStart(3, "0")}</span><span class="dim"> · ${r.type}</span></div><div class="dim">signature <span class="hit" style="letter-spacing:.08em">${r.hexSpaced}</span></div><div class="dim">pixel fold <span style="letter-spacing:.04em">${r.pixelHex}</span></div>${extra ? `<div class="dim">${extra}</div>` : ""}`;\n',
  '  };\n',
]
# Replace lines 400 to 410 inclusive (11 lines) with new_lines (4 lines)
lines[400:411] = new_lines
with open(filename, 'w') as f:
    f.writelines(lines)
