#!/usr/bin/env python3
"""
clean_qwen_dump.py — Clean QWEN's consolidated bash dump.

Removes two glitches from /home/z/my-project/upload/Pasted Content_1782948591642.txt:
  1. Duplicate header at lines 1-14 (a truncated first attempt followed by ```bash)
  2. Stray `SANTANINVERTER_EOF` marker on the last line (no matching heredoc opener)

Writes the cleaned version to:
  /home/z/my-project/download/santaninverter_oracle_full_dump.sh
"""

from pathlib import Path

SRC = Path("/home/z/my-project/upload/Pasted Content_1782948591642.txt")
DST = Path("/home/z/my-project/download/santaninverter_oracle_full_dump.sh")

raw_lines = SRC.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)

# Glitch 1: lines 1-14 (1-indexed) are a truncated first attempt.
# The real script starts at line 15 with `#!/bin/bash`.
# Find the LAST occurrence of `#!/bin/bash` in the first 30 lines — that's the real start.
real_start_idx = None
for i, line in enumerate(raw_lines[:30]):
    if line.startswith("#!/bin/bash"):
        real_start_idx = i  # keep updating — we want the last one in the window
if real_start_idx is None:
    raise SystemExit("Could not locate real script start (#!/bin/bash)")

# Glitch 2: drop a trailing line that is exactly `SANTANINVERTER_EOF` (no heredoc opener)
end_idx = len(raw_lines)
while end_idx > real_start_idx:
    last = raw_lines[end_idx - 1].strip()
    if last == "SANTANINVERTER_EOF":
        end_idx -= 1
        continue
    if last == "":
        # allow trailing blank lines to be trimmed
        end_idx -= 1
        continue
    break

clean_lines = raw_lines[real_start_idx:end_idx]
# Re-add a single trailing newline
clean_text = "".join(clean_lines)
if not clean_text.endswith("\n"):
    clean_text += "\n"

DST.parent.mkdir(parents=True, exist_ok=True)
DST.write_text(clean_text, encoding="utf-8")

# Report
orig_lines = len(raw_lines)
kept_lines = len(clean_lines)
print(f"OK — wrote {DST}")
print(f"  original lines: {orig_lines}")
print(f"  kept lines:     {kept_lines}")
print(f"  dropped head:   {real_start_idx} lines")
print(f"  dropped tail:   {orig_lines - end_idx} lines")
print(f"  size:           {len(clean_text)} bytes")

# Sanity checks — verify all 15 sections are present
required_markers = [
    "SECCIÓN 1: CONFIGURACIÓN",
    "SECCIÓN 2: FRONTEND",
    "SECCIÓN 3: BACKEND",
    "SECCIÓN 4: CRON Y WRAPPING",
    "SECCIÓN 5: TELEMETRÍA",
    "SECCIÓN 6: DATOS EN VIVO",
    "1.1 package.json",
    "1.2 next.config.ts",
    "1.3 wrangler.jsonc",
    "2.1 src/app/page.tsx",
    "3.1 src/app/api/oracle/predictions/route.ts",
    "3.2 src/lib/oracle-multi/index.ts",
    "3.3 src/lib/oracle-multi/storage.ts",
    "4.1 scripts/wrap-worker-with-cron.mjs",
    "4.2 src/lib/oracle-multi/cron.ts",
    "5.1 src/lib/telemetry.ts",
    "6.1 src/lib/live-data.ts",
    "6.2 src/lib/oracle-fci/fetch.ts",
    "6.3 src/lib/oracle-multi/rank.ts",
    "6.4 src/lib/oracle-multi/predict.ts",
    "6.5 src/lib/oracle-multi/types.ts",
]
missing = [m for m in required_markers if m not in clean_text]
if missing:
    print("WARNING — missing markers:")
    for m in missing:
        print(f"  - {m}")
else:
    print("All 15 sections + 6 section headers present ✓")

# Verify the two key fixes are in place
assert "CRON_PERSISTENCE_VISIBILITY_FIX v2" in clean_text, "P1 fix missing"
assert "P2_PREDICTIONS_POST_HANDLER_FIX_v1" in clean_text, "P2 fix missing"
assert "export async function POST()" in clean_text, "POST handler missing"
assert "throw new Error(msg);" in clean_text, "throw in storage.ts missing"
assert "method: 'POST'" in clean_text, "wrap-worker POST method missing"
print("Key fixes verified:")
print("  ✓ P1 CRON_PERSISTENCE_WIRING_FIX (storage.ts throw)")
print("  ✓ P2 PREDICTIONS_POST_HANDLER (route.ts exports POST)")
print("  ✓ wrap-worker-with-cron.mjs uses method: 'POST'")
