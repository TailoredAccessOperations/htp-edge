import sys
filename = '/Users/piv/projects/agi/f22-website/components/E8HexTool.tsx'
with open(filename, 'r') as f:
    lines = f.readlines()
# Find the line with elm.innerHTML
for i, line in enumerate(lines):
    if 'elm.innerHTML =' in line:
        # Replace that line with a template literal version
        lines[i] = '    elm.innerHTML = `<div><span class="hit">root #${String(rootId).padStart(3, "0")}</span><span class="dim"> · ${r.type}</span></div><div class="dim">signature <span class="hit" style="letter-spacing:.08em">${r.hexSpaced}</span></div><div class="dim">pixel fold <span style="letter-spacing:.04em">${r.pixelHex}</span></div>${extra ? `<div class="dim">${extra}</div>` : ""}`;\n'
        break
with open(filename, 'w') as f:
    f.writelines(lines)
