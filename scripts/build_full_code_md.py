#!/usr/bin/env python3
"""
build_full_code_md.py — Bundle the entire Santaninverter Oracle codebase into a
single Markdown file for audit / external review (e.g. Qwen3.7-Max, Gemini).

WHAT IT INCLUDES:
  - All src/**/*.ts and src/**/*.tsx files
  - All scripts/*.mjs and scripts/*.py files
  - proxy/*.js + proxy/wrangler.toml
  - Key config files (package.json, wrangler.jsonc, open-next.config.ts,
    next.config.ts, tsconfig.json, tailwind.config.ts, postcss.config.mjs,
    eslint.config.mjs, components.json)

WHAT IT EXCLUDES:
  - node_modules/, .open-next/, dist/, dist-test/
  - examples/, santaninverter-oracle/ (legacy, has tsc errors)
  - .git/, .next/, build artifacts
  - search_*.json, search_carry.json, etc. (intermediate research files)
  - tool-results/, upload/, skills/

OUTPUT:
  /home/z/my-project/download/PROJECT_FULL_CODE_2026-07-10.md
"""

import os
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path("/home/z/my-project")
OUTPUT_FILE = PROJECT_ROOT / "download" / "PROJECT_FULL_CODE_2026-07-10.md"

# ─── Files explicitly patched in this audit cycle (for changelog header) ─────
PATCHED_FILES = {
    "scripts/wrap-worker-with-cron.mjs": "Fix A (snapshot_archive removal) · 2026-07-09",
    "src/app/api/oracle/cron/route.ts": "Fix B (KV re-entrancy lock) · 2026-07-09",
    "src/lib/oracle-multi/index.ts": "FASE 0.6 (tombstone exclusion from predictions_count) · 2026-07-09",
    "src/lib/telemetry.ts": "Fix C (lastPipelineExecution only on success) + U3 (dynamic KV counters) · 2026-07-09",
    "src/lib/oracle-multi/cron.ts": "E3 (snapshot_archive dead code cleanup) · 2026-07-09",
    "src/lib/oracle-multi/rank.ts": "FASE 0.5 (null-price guard) + P3 (outlier cap ±100% momentum) · 2026-07-10",
    "src/components/dashboard/main-dashboard.tsx": "P1 (legacy ProfileCards removal) + P2 (source-health hydration) · 2026-07-10",
}

# ─── Scan configuration ─────────────────────────────────────────────────────
SCAN_DIRS = [
    ("src", [".ts", ".tsx", ".js", ".jsx", ".css", ".mjs"]),
    ("scripts", [".mjs", ".py", ".sh", ".js"]),
    ("proxy", [".js", ".toml"]),
    ("prisma", [".prisma", ".sql"]),
]

CONFIG_FILES = [
    "package.json",
    "wrangler.jsonc",
    "open-next.config.ts",
    "next.config.ts",
    "tsconfig.json",
    "tailwind.config.ts",
    "postcss.config.mjs",
    "eslint.config.mjs",
    "components.json",
    "Caddyfile",
]

EXCLUDE_DIRS = {
    "node_modules", ".open-next", ".next", "dist", "dist-test", ".git",
    "examples", "santaninverter-oracle", "tool-results", "upload", "skills",
    "tests",  # tests dir tiene cosas legacy; se incluye aparte si es necesario
}

EXCLUDE_FILE_PATTERNS = (
    "search_",  # search_*.json research dumps
)


def should_exclude_dir(dirname: str) -> bool:
    return dirname in EXCLUDE_DIRS


def should_exclude_file(filename: str) -> bool:
    if filename.startswith("."):
        return True
    for pat in EXCLUDE_FILE_PATTERNS:
        if pat in filename:
            return True
    return False


def get_language_tag(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {
        ".ts": "typescript",
        ".tsx": "tsx",
        ".js": "javascript",
        ".jsx": "jsx",
        ".mjs": "javascript",
        ".py": "python",
        ".sh": "bash",
        ".json": "json",
        ".jsonc": "jsonc",
        ".toml": "toml",
        ".css": "css",
        ".md": "markdown",
        ".prisma": "prisma",
        ".sql": "sql",
    }.get(ext, "")


def scan_dir(rel_dir: str, extensions: list[str]) -> list[Path]:
    """Scan a top-level directory recursively, returning matching files."""
    base = PROJECT_ROOT / rel_dir
    if not base.exists():
        return []
    results = []
    for root, dirs, files in os.walk(base):
        # filter dirs in-place to skip excluded ones
        dirs[:] = [d for d in dirs if not should_exclude_dir(d)]
        for fname in sorted(files):
            if should_exclude_file(fname):
                continue
            ext = Path(fname).suffix.lower()
            if ext in extensions:
                results.append(Path(root) / fname)
    return sorted(results)


def read_file_safely(path: Path) -> tuple[str, str]:
    """Read file, return (content, error). Try utf-8 first, latin-1 fallback."""
    try:
        return path.read_text(encoding="utf-8"), ""
    except UnicodeDecodeError:
        try:
            return path.read_text(encoding="latin-1"), ""
        except Exception as e:
            return "", f"read error: {e}"
    except Exception as e:
        return "", f"read error: {e}"


def count_lines(content: str) -> int:
    return content.count("\n") + (0 if content.endswith("\n") or not content else 1)


def build_markdown() -> str:
    parts: list[str] = []

    # ─── Header ────────────────────────────────────────────────────────────
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    parts.append("# Santaninverter Oracle — Full Project Code Audit Dump")
    parts.append("")
    parts.append(f"**Generated**: {now}")
    parts.append(f"**Project root**: `/home/z/my-project/`")
    parts.append(f"**Live URL**: https://santaninverter-oracle.simondalmasso44.workers.dev")
    parts.append(f"**Deployed version**: `ce72a5ce-980c-407f-83f4-9a9a7342694d`")
    parts.append(f"**Cron schedule**: `0 23 * * 1-5` UTC (Mon-Fri 20:00 AR)")
    parts.append("")
    parts.append("---")
    parts.append("")

    # ─── Changelog / patches applied in this audit cycle ───────────────────
    parts.append("## Patches Applied in This Audit Cycle")
    parts.append("")
    parts.append("All changes respect **FREEZE CRITICAL_ENGINEERING_ONLY**: scoring engine, "
                 "weights, and model architecture are untouched. Only data sanitization, "
                 "telemetry, cron infrastructure, and UI cleanup were modified.")
    parts.append("")
    parts.append("| File | Patches Applied |")
    parts.append("|------|-----------------|")
    for path, patches in sorted(PATCHED_FILES.items()):
        parts.append(f"| `{path}` | {patches} |")
    parts.append("")
    parts.append("### Patch inventory:")
    parts.append("")
    parts.append("- **FASE 0.5** (2026-07-03): Null-price guard in `rank.ts` — filter `price:null/NaN/<=0` "
                 "BEFORE computing momentum/volatility/trend. Prevents NaN propagation in oracle_score.")
    parts.append("- **FASE 0.6** (2026-07-09): Exclude tombstones (`data_quality='insufficient'`) from "
                 "`predictions_count` in `index.ts`. Counter dropped from 459 → 0 (real signal count).")
    parts.append("- **Fix A** (2026-07-09): Remove `snapshot_archive` from `CRON_JOBS` in `wrap-worker-with-cron.mjs`. "
                 "Was causing 433s duplicated work via `/api/oracle/cron` re-routing.")
    parts.append("- **Fix B** (2026-07-09): KV re-entrancy lock (`cron_lock` key, 90s TTL) in `/api/oracle/cron/route.ts`. "
                 "Returns HTTP 429 if lock active.")
    parts.append("- **Fix C** (2026-07-09): `lastPipelineExecution` only advances when cron event has `success=true`.")
    parts.append("- **U3** (2026-07-09): Dynamic KV-log-derived counters in `telemetry.ts` (Gemini proposal). "
                 "`pipelineExecutions` 0 → 26 (now persistent across cold starts).")
    parts.append("- **E3** (2026-07-09): `snapshot_archive` dead code cleanup in `cron.ts` (Gemini proposal). "
                 "Removed from `CronJobName` type, `CRON_JOBS` array, and `runJob()` switch.")
    parts.append("- **P1** (2026-07-10): Removed legacy `<ProfileCards />` block from `main-dashboard.tsx` (Gemini proposal). "
                 "X10 `ProfileCardsCompact` inside `MultiOraclePanel` is single source of truth.")
    parts.append("- **P2** (2026-07-10): Hydrate `amira-source-health` registry via `recordSourceFetch()` calls "
                 "in `main-dashboard.tsx` after `/api/macro` success (Gemini proposal). "
                 "Fixes divergent state: header FRESHNESS 85% vs Paper Executor CRÍTICO 0 fuentes sanas.")
    parts.append("- **P3** (2026-07-10): Outlier cap ±100% on momentum in `rank.ts` (Gemini proposal). "
                 "Toronto Trust +1509.7% (30d) capped to +100%, no longer corrupts min-max normalization.")
    parts.append("")
    parts.append("---")
    parts.append("")

    # ─── File inventory by category ────────────────────────────────────────
    parts.append("## File Inventory")
    parts.append("")
    inventory_lines: list[tuple[str, int, int]] = []  # (path, lines, bytes)
    for rel_dir, exts in SCAN_DIRS:
        for fp in scan_dir(rel_dir, exts):
            rel_path = fp.relative_to(PROJECT_ROOT).as_posix()
            content, err = read_file_safely(fp)
            if err:
                inventory_lines.append((rel_path, 0, 0))
            else:
                inventory_lines.append((rel_path, count_lines(content), len(content.encode("utf-8"))))
    for cf in CONFIG_FILES:
        fp = PROJECT_ROOT / cf
        if fp.exists():
            content, err = read_file_safely(fp)
            if err:
                inventory_lines.append((cf, 0, 0))
            else:
                inventory_lines.append((cf, count_lines(content), len(content.encode("utf-8"))))
    inventory_lines.sort()
    parts.append(f"**Total files**: {len(inventory_lines)}")
    parts.append(f"**Total lines**: {sum(l for _, l, _ in inventory_lines):,}")
    parts.append(f"**Total bytes**: {sum(b for _, _, b in inventory_lines):,}")
    parts.append("")
    parts.append("| File | Lines | Bytes |")
    parts.append("|------|-------|-------|")
    for path, lines, byts in inventory_lines:
        parts.append(f"| `{path}` | {lines:,} | {byts:,} |")
    parts.append("")
    parts.append("---")
    parts.append("")

    # ─── Config files first ────────────────────────────────────────────────
    parts.append("## Configuration Files")
    parts.append("")
    for cf in CONFIG_FILES:
        fp = PROJECT_ROOT / cf
        if not fp.exists():
            continue
        content, err = read_file_safely(fp)
        lang = get_language_tag(cf)
        parts.append(f"### `{cf}`")
        parts.append("")
        if err:
            parts.append(f"```\n[ERROR] {err}\n```")
        else:
            parts.append(f"```{lang}")
            parts.append(content.rstrip("\n"))
            parts.append("```")
        parts.append("")
    parts.append("---")
    parts.append("")

    # ─── Then the source code, organized by directory ──────────────────────
    parts.append("## Source Code")
    parts.append("")
    for rel_dir, exts in SCAN_DIRS:
        files = scan_dir(rel_dir, exts)
        if not files:
            continue
        parts.append(f"### `{rel_dir}/`")
        parts.append("")
        for fp in files:
            rel_path = fp.relative_to(PROJECT_ROOT).as_posix()
            content, err = read_file_safely(fp)
            lang = get_language_tag(fp.name)
            patched_marker = ""
            if rel_path in PATCHED_FILES:
                patched_marker = f" ⚡ **PATCHED** — {PATCHED_FILES[rel_path]}"
            parts.append(f"#### `{rel_path}`{patched_marker}")
            parts.append("")
            if err:
                parts.append(f"```\n[ERROR] {err}\n```")
            else:
                parts.append(f"```{lang}")
                parts.append(content.rstrip("\n"))
                parts.append("```")
            parts.append("")
        parts.append("---")
        parts.append("")

    # ─── Footer ────────────────────────────────────────────────────────────
    parts.append("---")
    parts.append("")
    parts.append("## End of Audit Dump")
    parts.append("")
    parts.append(f"Generated by `scripts/build_full_code_md.py` at {now}.")
    parts.append("")
    parts.append("### Active freeze")
    parts.append("")
    parts.append("**FREEZE CRITICAL_ENGINEERING_ONLY** is in effect. The following are NOT to be modified:")
    parts.append("- Scoring engine weights (`ORACLE_SCORE_WEIGHTS`)")
    parts.append("- Model architecture (`linear_factor_model_v1`, ensemble predictor)")
    parts.append("- Confidence thresholds (`CONFIDENCE_THRESHOLD=0.65`, `HIGH_CONVICTION=0.85`)")
    parts.append("- `MIN_HISTORY_DAYS=9`")
    parts.append("")
    parts.append("### Pending work (next milestones)")
    parts.append("")
    parts.append("1. **Gate 1** (Vie 10-Jul 23:00 UTC): Validate first real cron with bundle applied.")
    parts.append("2. **Gate 2** (Sáb 11-Jul): Probe existence + CF Workers compatibility of 4 SantanderAI tools.")
    parts.append("3. **PoC** (Dom-Lun 12-13 Jul): Single PoC with `autoguardrails` if Gate 2 passes.")
    parts.append("4. **FASE 3** (~Jul 15-18): Accumulate 9 days clean snapshots to unlock predictions.")
    parts.append("5. **FASE 4**: Backtest metrics (VaR_95, CVaR, Sortino, decisionAccuracy).")
    parts.append("6. **U1**: BONOS gap structural fix — backoff Yahoo + Ámbito/Cronista scraper + BYMA API.")
    parts.append("7. **U2**: Investigate `totalDecisions=17` stall — snapshot dependency or x10-engine bug.")
    parts.append("8. **P4**: UI tabs consolidation (Multi-Asset / Bloomberg SAN / Auditoría) — Gemini proposal.")
    parts.append("")
    return "\n".join(parts)


def main() -> int:
    if not OUTPUT_FILE.parent.exists():
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    md = build_markdown()
    OUTPUT_FILE.write_text(md, encoding="utf-8")
    size_bytes = OUTPUT_FILE.stat().st_size
    line_count = md.count("\n") + 1
    print(f"OK — wrote {OUTPUT_FILE}")
    print(f"     size: {size_bytes:,} bytes ({size_bytes/1024:.1f} KB)")
    print(f"     lines: {line_count:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
