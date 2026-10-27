import sys
filename = '/Users/piv/projects/agi/f22-website/app/interactive/InteractivePageClient.tsx'
with open(filename, 'r') as f:
    lines = f.readlines()
# Line numbers are 1-indexed, so line 92 is index 91
if len(lines) >= 92:
    lines[91] = lines[91].replace('strokeLinejoin=\"round\\/>', 'strokeLinejoin=\"round/\"/>')
with open(filename, 'w') as f:
    f.writelines(lines)
