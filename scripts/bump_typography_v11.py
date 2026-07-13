#!/usr/bin/env python3
"""
V11 Typography +1pt Bump
=========================
Bumps every hardcoded px font size by +1 across the dashboard components.
- text-[Npx]  -> text-[N+1px]
- fontSize: 'Npx' -> fontSize: 'N+1px'  (single & double quotes)
- fontSize: \"Npx\" -> fontSize: \"N+1px\"
Does NOT touch rem/em/clamp sizes — those are rem-based and would
cascade to spacing/padding, breaking layout (per user: SIN ROMPER NADA ESTRUCTURAL).
"""
import re
import sys
from pathlib import Path

SRC = Path("/home/z/my-project/src")
TARGET_GLOB = "**/*.tsx"

# text-[Npx]  — capture N, emit N+1
TEXT_PX_PAT = re.compile(r"text-\[(\d+)px\]")
# fontSize: 'Npx' / \"Npx\"  — capture N, emit N+1
FONTSTYLE_PAT = re.compile(r"fontSize:\s*(['\"])(\d+)px\1")

bump_counts = {}
total_text = 0
total_fs = 0

for f in sorted(SRC.glob(TARGET_GLOB)):
    text = f.read_text(encoding="utf-8")
    orig = text

    def bump_text(m):
        global total_text
        total_text += 1
        n = int(m.group(1))
        return f"text-[{n+1}px]"

    def bump_fs(m):
        global total_fs
        total_fs += 1
        quote = m.group(1)
        n = int(m.group(2))
        return f"fontSize: {quote}{n+1}px{quote}"

    text = TEXT_PX_PAT.sub(bump_text, text)
    text = FONTSTYLE_PAT.sub(bump_fs, text)

    if text != orig:
        f.write_text(text, encoding="utf-8")
        rel = f.relative_to(SRC)
        # count per-file delta
        before_t = len(TEXT_PX_PAT.findall(orig))
        before_f = len(FONTSTYLE_PAT.findall(orig))
        bump_counts[str(rel)] = (before_t, before_f)

print(f"Files modified: {len(bump_counts)}")
print(f"Total text-[Npx] bumps: {total_text}")
print(f"Total fontSize bumps:  {total_fs}")
print()
print("Per-file breakdown (text-[Npx], fontSize):")
for k, (t, f) in sorted(bump_counts.items()):
    print(f"  {t:3d} / {f:2d}  {k}")
