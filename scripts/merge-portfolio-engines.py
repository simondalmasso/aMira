#!/usr/bin/env python3
"""
TASK_1 — Portfolio Engine Consolidation.

Merges src/lib/portfolio-engine.ts (LEGACY, SantanderProduct-based)
into src/lib/oracle/portfolio-engine.ts (CANONICAL V7, AssetMetrics-based),
producing ONE single portfolio engine file.

Steps:
1. Read canonical file (src/lib/oracle/portfolio-engine.ts).
2. Read legacy file (src/lib/portfolio-engine.ts).
3. Extract legacy imports of './live-data' symbols.
4. Append those imports to canonical's import section.
5. Append a clearly-marked "LEGACY SANTANDER PRODUCT DOMAIN" section at the
   end of the canonical file, containing the legacy file body (minus its
   own import line).
6. Write the merged content back to canonical.
7. Delete the legacy file.
8. Update all 8 consumers to import from '@/lib/oracle/portfolio-engine'
   (or './oracle/portfolio-engine' for relative imports from src/lib/).
"""

from pathlib import Path
import re

ROOT = Path('/home/z/my-project')
CANONICAL = ROOT / 'src/lib/oracle/portfolio-engine.ts'
LEGACY = ROOT / 'src/lib/portfolio-engine.ts'

# --- 1. Read both files ---
canonical_text = CANONICAL.read_text()
legacy_text = LEGACY.read_text()

# --- 2. Extract legacy imports of live-data symbols ---
# Legacy file imports:
#   import {
#     type MacroState,
#     type SantanderProduct,
#     type MarketScenario,
#     getProductsFromMacro,
#     getScenariosFromMacro,
#   } from './live-data';
legacy_import_match = re.search(
    r"import\s*\{[^}]*\}\s*from\s*['\"]\.\/live-data['\"]\s*;",
    legacy_text,
    re.DOTALL,
)
if not legacy_import_match:
    raise SystemExit("Could not find legacy './live-data' import block")

legacy_import_block = legacy_import_match.group(0)
# Rewrite the path: from './live-data' → '../live-data' (because we're now
# in src/lib/oracle/portfolio-engine.ts, not src/lib/portfolio-engine.ts).
legacy_import_rewritten = legacy_import_block.replace(
    "'./live-data'", "'../live-data'"
)

# Remove the legacy import block from the legacy body
legacy_body = legacy_text[:legacy_import_match.start()] + legacy_text[legacy_import_match.end():]

# Strip leading whitespace/newlines from legacy body
legacy_body = legacy_body.lstrip('\n').rstrip() + '\n'

# --- 3. Build merged file ---
# Insert legacy imports after the canonical import line
canonical_import_line = "import type { AssetMetrics, AssetClass } from '@/lib/oracle-multi/types';"
if canonical_import_line not in canonical_text:
    raise SystemExit(f"Could not find canonical import line: {canonical_import_line}")

# Add a separator comment + section header
section_header = '''

// ============================================================================
// LEGACY SANTANDER PRODUCT DOMAIN — preserved for /api/portfolio, /api/sync,
// /api/rebalance, hedge-fund-store, rebalanceOracle, profile-cards, main-dashboard.
// This section uses MacroState/SantanderProduct (ARS-denominated Santander
// mini-bond universe) — DIFFERENT data model from the canonical
// AssetMetrics[]-based engine above. Kept as the single source for the legacy
// domain until the legacy API routes + store are migrated. NOT to be extended.
// ============================================================================
'''

merged = (
    canonical_text.rstrip()
    + '\n'
    + legacy_import_rewritten
    + section_header
    + legacy_body
)

# Insert legacy imports right after canonical import line at top
merged = merged.replace(
    canonical_import_line,
    canonical_import_line + '\n' + legacy_import_rewritten,
    1,  # only the first occurrence (at top)
)

# But we already appended legacy_import_rewritten at the section boundary —
# remove that duplicate. Actually, let's redo this more carefully.

# Restart: build merged cleanly.
merged = canonical_text.rstrip() + '\n'

# Add legacy import line right after canonical's import line
merged = merged.replace(
    canonical_import_line,
    canonical_import_line + '\n' + legacy_import_rewritten,
    1,
)

# Append section header + legacy body (without its own imports)
merged = merged.rstrip() + section_header + legacy_body

CANONICAL.write_text(merged)
print(f"OK: merged legacy into canonical. New canonical size: {len(merged)} chars, {merged.count(chr(10))} lines")

# --- 4. Delete legacy file ---
LEGACY.unlink()
print(f"OK: deleted legacy file {LEGACY}")

# --- 5. Report ---
print("\nMerged file structure:")
print(f"  - Canonical imports (top): AssetMetrics, AssetClass from '@/lib/oracle-multi/types'")
print(f"  - Legacy imports (added): MacroState, SantanderProduct, MarketScenario, getProductsFromMacro, getScenariosFromMacro from '../live-data'")
print(f"  - Canonical body (lines 1-1144): V7 engine for AssetMetrics[]")
print(f"  - LEGACY section (appended): V1 engine for SantanderProduct[]")
