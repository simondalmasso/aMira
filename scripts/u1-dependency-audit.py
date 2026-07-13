#!/usr/bin/env python3
"""
U1: Full Dependency Audit
Goal: Find dead imports, cycles, duplicates, orphan files.
Outputs:
  - /home/z/my-project/download/DEPENDENCY_GRAPH.md
  - /home/z/my-project/download/DEAD_FILES.json
"""
import os
import re
import json
import hashlib
from collections import defaultdict, deque
from pathlib import Path

PROJECT = Path("/home/z/my-project")
SRC_DIRS = [PROJECT / "src", PROJECT / "tests"]
EXCLUDE_DIRS = {"node_modules", ".next", ".open-next", "dist-test", ".git"}
ALLOWED_EXT = {".ts", ".tsx"}

# 1. Build file index
files = []  # list of (abs_path, rel_path, ext)
for src_dir in SRC_DIRS:
    for root, dirs, fnames in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in fnames:
            ext = os.path.splitext(f)[1]
            if ext in ALLOWED_EXT:
                abs_p = Path(root) / f
                rel_p = abs_p.relative_to(PROJECT)
                files.append((abs_p, rel_p, ext))

print(f"[U1] Indexed {len(files)} TS/TSX files")

# 2. Extract imports per file
import_re = re.compile(
    r"""(?:import\s+(?:[^'"]+\s+from\s+)?|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]""",
    re.MULTILINE,
)
export_re = re.compile(
    r"""^export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum|async\s+function)\s+(\w+)""",
    re.MULTILINE,
)

# Map: relative path -> set of imported module specifiers
imports_map = {}  # file -> list of specifiers
exports_map = {}  # file -> set of exported names
file_size_lines = {}
file_hash = {}

for abs_p, rel_p, ext in files:
    try:
        content = abs_p.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        continue
    file_size_lines[str(rel_p)] = content.count("\n") + 1
    file_hash[str(rel_p)] = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]
    specifiers = import_re.findall(content)
    imports_map[str(rel_p)] = specifiers
    exports_map[str(rel_p)] = set(export_re.findall(content))

# 3. Resolve specifiers to canonical rel paths
def resolve_spec(spec: str, importer_rel: str) -> str | None:
    """Resolve a TS import specifier to a canonical rel path."""
    if not spec.startswith(".") and not spec.startswith("@/"):
        # External package
        return None
    if spec.startswith("@/"):
        target = Path("src") / spec[2:]
    else:
        importer_dir = Path(importer_rel).parent
        target = (importer_dir / spec).resolve()
        try:
            target = target.relative_to(PROJECT)
        except ValueError:
            return None
    # Try with extensions / index
    candidates = []
    for ext in ALLOWED_EXT:
        candidates.append(str(target.with_suffix(ext)))
        candidates.append(str(target / f"index{ext}"))
    for c in candidates:
        if c in imports_map or c in exports_map:
            return c
    # Loose match by path stem
    target_str = str(target)
    for known in list(imports_map.keys()) + list(exports_map.keys()):
        if known.startswith(target_str):
            return known
    return None

# 4. Build adjacency list
graph = defaultdict(set)  # importer -> set(importees)
reverse_graph = defaultdict(set)  # importee -> set(importers)
internal_files = set(str(r) for _, r, _ in files)
for importer, specs in imports_map.items():
    for spec in specs:
        resolved = resolve_spec(spec, importer)
        if resolved:
            graph[importer].add(resolved)
            reverse_graph[resolved].add(importer)

# 5. Detect cycles via DFS
def find_cycles(graph, max_cycles=20):
    cycles = []
    visited = set()
    rec_stack = []
    WHITE, GRAY, BLACK = 0, 1, 2
    color = defaultdict(lambda: WHITE)

    def dfs(node):
        if len(cycles) >= max_cycles:
            return
        color[node] = GRAY
        rec_stack.append(node)
        for neighbor in sorted(graph.get(node, [])):
            if color[neighbor] == GRAY:
                # cycle found
                idx = rec_stack.index(neighbor)
                cycle = rec_stack[idx:] + [neighbor]
                cycles.append(cycle)
            elif color[neighbor] == WHITE:
                dfs(neighbor)
        rec_stack.pop()
        color[node] = BLACK

    for node in sorted(graph.keys()):
        if color[node] == WHITE:
            dfs(node)
    return cycles

cycles = find_cycles(graph)

# 6. Find orphan files (not imported by anyone, and not API routes or entry points)
def is_entry_point(rel_path: str) -> bool:
    # API routes are entry points
    if rel_path.startswith("src/app/api/") and rel_path.endswith("route.ts"):
        return True
    if rel_path.startswith("src/app/") and (
        "page.tsx" in rel_path or "layout.tsx" in rel_path or "middleware.ts" in rel_path
    ):
        return True
    if rel_path.startswith("tests/"):
        return True
    if "middleware.ts" in rel_path or "worker.ts" in rel_path:
        return True
    return False

orphans = []
for rel_p in internal_files:
    if is_entry_point(rel_p):
        continue
    importers = reverse_graph.get(rel_p, set())
    if not importers:
        orphans.append(rel_p)

# 7. Find duplicate files (same content hash)
hash_to_files = defaultdict(list)
for f, h in file_hash.items():
    hash_to_files[h].append(f)
duplicates = {h: fs for h, fs in hash_to_files.items() if len(fs) > 1}

# 8. Find dead imports (imports that cannot be resolved and aren't external)
dead_imports = defaultdict(list)
for importer, specs in imports_map.items():
    for spec in specs:
        if spec.startswith(".") or spec.startswith("@/"):
            if resolve_spec(spec, importer) is None:
                dead_imports[importer].append(spec)

# 9. External packages list
external_pkgs = set()
for specs in imports_map.values():
    for spec in specs:
        if not spec.startswith(".") and not spec.startswith("@/"):
            pkg = spec.split("/")[0] if not spec.startswith("@") else "/".join(spec.split("/")[:2])
            external_pkgs.add(pkg)

# 10. Top most-imported files (hub modules)
hub_modules = sorted(reverse_graph.items(), key=lambda x: len(x[1]), reverse=True)[:20]

# === WRITE OUTPUTS ===
out_dir = PROJECT / "download"
out_dir.mkdir(exist_ok=True)

# DEAD_FILES.json
dead_files_payload = {
    "audit_metadata": {
        "task": "U1 Full Dependency Audit",
        "files_indexed": len(files),
        "total_lines": sum(file_size_lines.values()),
    },
    "orphans": sorted(orphans),
    "orphans_count": len(orphans),
    "duplicates": {h: fs for h, fs in duplicates.items()},
    "duplicates_count": len(duplicates),
    "dead_imports": {k: v for k, v in dead_imports.items()},
    "dead_imports_count": sum(len(v) for v in dead_imports.values()),
    "cycles": cycles,
    "cycles_count": len(cycles),
    "external_packages": sorted(external_pkgs),
    "external_packages_count": len(external_pkgs),
}
(out_dir / "DEAD_FILES.json").write_text(json.dumps(dead_files_payload, indent=2, ensure_ascii=False))

# DEPENDENCY_GRAPH.md
lines = []
lines.append("# U1 — Full Dependency Audit Report")
lines.append("")
lines.append(f"**Files indexed:** {len(files)} TS/TSX files  ")
lines.append(f"**Total source lines:** {sum(file_size_lines.values()):,}  ")
lines.append(f"**External packages:** {len(external_pkgs)}  ")
lines.append("")
lines.append("## Summary Verdict")
lines.append("")
lines.append(f"- Orphan files (not imported, not entry points): **{len(orphans)}**")
lines.append(f"- Duplicate file groups (identical hash): **{len(duplicates)}**")
lines.append(f"- Unresolved internal imports: **{sum(len(v) for v in dead_imports.values())}**")
lines.append(f"- Import cycles detected: **{len(cycles)}**")
lines.append("")

# Verdict
issues = len(orphans) + len(duplicates) + sum(len(v) for v in dead_imports.values()) + len(cycles)
if issues == 0:
    lines.append("**Verdict: PASS** — No dead files, no duplicates, no cycles, no unresolved imports.")
else:
    lines.append(f"**Verdict: REVIEW REQUIRED** — {issues} structural issues identified for triage.")
lines.append("")

lines.append("## Orphan Files (candidates for removal)")
lines.append("")
if not orphans:
    lines.append("_None — all internal files are reachable from entry points._")
else:
    lines.append("| File | Lines | Hash (sha256:16) |")
    lines.append("|------|-------|------------------|")
    for o in sorted(orphans):
        lines.append(f"| `{o}` | {file_size_lines.get(o, '?')} | `{file_hash.get(o, '?')}` |")
lines.append("")

lines.append("## Duplicate File Groups (identical content)")
lines.append("")
if not duplicates:
    lines.append("_None — no two files share identical content._")
else:
    for h, fs in duplicates.items():
        lines.append(f"### Hash `{h}`")
        for f in fs:
            lines.append(f"- `{f}` ({file_size_lines.get(f, '?')} lines)")
        lines.append("")
lines.append("")

lines.append("## Unresolved Internal Imports")
lines.append("")
if not dead_imports:
    lines.append("_None — all `./` and `@/` imports resolve._")
else:
    lines.append("| Importer | Unresolved Specifier |")
    lines.append("|----------|----------------------|")
    for importer, specs in sorted(dead_imports.items()):
        for spec in specs:
            lines.append(f"| `{importer}` | `{spec}` |")
lines.append("")

lines.append("## Import Cycles")
lines.append("")
if not cycles:
    lines.append("_None — graph is acyclic._")
else:
    for i, cycle in enumerate(cycles, 1):
        lines.append(f"### Cycle {i}")
        for node in cycle:
            lines.append(f"- `{node}`")
        lines.append("")
lines.append("")

lines.append("## Top 20 Hub Modules (most imported)")
lines.append("")
lines.append("| Module | Imported By (count) |")
lines.append("|--------|---------------------|")
for mod, importers in hub_modules:
    lines.append(f"| `{mod}` | {len(importers)} |")
lines.append("")

lines.append("## External Packages")
lines.append("")
lines.append(", ".join(f"`{p}`" for p in sorted(external_pkgs)))
lines.append("")

lines.append("## Graph Statistics")
lines.append("")
lines.append(f"- Nodes: {len(internal_files)}")
lines.append(f"- Edges: {sum(len(v) for v in graph.values())}")
lines.append(f"- Avg out-degree: {sum(len(v) for v in graph.values())/max(len(graph),1):.2f}")
lines.append(f"- Max out-degree: {max((len(v) for v in graph.values()), default=0)}")
lines.append(f"- Files with no imports (leaves): {sum(1 for f in internal_files if not graph.get(f))}")

(out_dir / "DEPENDENCY_GRAPH.md").write_text("\n".join(lines))

print(f"[U1] Orphans: {len(orphans)}")
print(f"[U1] Duplicates: {len(duplicates)}")
print(f"[U1] Dead imports: {sum(len(v) for v in dead_imports.values())}")
print(f"[U1] Cycles: {len(cycles)}")
print(f"[U1] External packages: {len(external_pkgs)}")
print(f"[U1] Wrote DEPENDENCY_GRAPH.md + DEAD_FILES.json")
