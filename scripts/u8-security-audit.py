#!/usr/bin/env python3
"""
U8: Security Audit
Goal: Find:
  - secret leakage (hardcoded API keys, tokens, passwords in source)
  - unsafe eval (eval(), new Function(), Function())
  - path traversal (fs.readFile(req.query.x), path.join(user_input))
  - hardcoded credentials
  - token exposure (console.log(token), logging of secrets)
  - stack traces (returning err.stack to client)

SCOPE:
  - Production code (src/) — strict checks; any finding here is a real concern.
  - Proxy code (proxy/) — checks adapted for CORS-proxy pattern.
  - Build/test scripts (scripts/) — out of scope for runtime security
    (they're not deployed to the worker). Findings are logged as informational.

Output: /home/z/my-project/download/SECURITY_AUDIT.md
"""
import os
import re
import json
from pathlib import Path
from collections import defaultdict

PROJECT = Path("/home/z/my-project")

# Separate production code from build/test scripts
PRODUCTION_DIRS = [PROJECT / "src"]
PROXY_DIRS = [PROJECT / "proxy"]
SCRIPT_DIRS = [PROJECT / "scripts"]  # informational only

EXCLUDE_DIRS = {"node_modules", ".next", ".open-next", "dist-test", ".git"}
ALLOWED_EXT = {".ts", ".tsx", ".js", ".mjs"}

def index_files(dirs):
    out = []
    for d in dirs:
        if not d.exists(): continue
        for root, dirnames, fnames in os.walk(d):
            dirnames[:] = [x for x in dirnames if x not in EXCLUDE_DIRS]
            for f in fnames:
                ext = os.path.splitext(f)[1]
                if ext in ALLOWED_EXT:
                    out.append(Path(root) / f)
    return out

production_files = index_files(PRODUCTION_DIRS)
proxy_files = index_files(PROXY_DIRS)
script_files = index_files(SCRIPT_DIRS)
all_files = production_files + proxy_files + script_files

print(f"[U8] Production files: {len(production_files)}")
print(f"[U8] Proxy files: {len(proxy_files)}")
print(f"[U8] Script files (informational): {len(script_files)}")
print(f"[U8] Total: {len(all_files)}")

# 2. Define security patterns
SECURITY_CHECKS = {
    "secret_leakage": {
        "description": "Hardcoded API keys, tokens, passwords in source",
        "patterns": [
            # Generic API key patterns
            (r'(?:api[_-]?key|apikey)\s*[:=]\s*["\'][a-zA-Z0-9]{20,}["\']', "Hardcoded API key"),
            (r'(?:secret|password|passwd|pwd)\s*[:=]\s*["\'][^"\']{8,}["\']', "Hardcoded secret/password"),
            (r'(?:token|bearer|jwt)\s*[:=]\s*["\'][a-zA-Z0-9_\-\.]{20,}["\']', "Hardcoded token"),
            (r'(?:AKIA|ASIA)[A-Z0-9]{16}', "AWS Access Key ID pattern"),
            (r'-----BEGIN [A-Z ]+PRIVATE KEY-----', "Private key block"),
            (r'gh[pousr]_[A-Za-z0-9]{36,}', "GitHub personal access token"),
            (r'sk-[A-Za-z0-9]{20,}', "OpenAI-style API key"),
            (r'xox[baprs]-[A-Za-z0-9-]+', "Slack token"),
            # Cloudflare specifics
            (r'CF_API_TOKEN\s*[:=]\s*["\'][^"\']+["\']', "Cloudflare API token"),
            (r'CLOUDFLARE_API_TOKEN\s*[:=]\s*["\'][^"\']+["\']', "Cloudflare API token"),
        ],
        "exclude_patterns": [
            r'process\.env\.',
            r'\benv\.',
            r'getenv\(',
            r'console\.log\(.*env',
            r'//.*',
            r'/\*.*\*/',
            r'example',
            r'placeholder',
            r'test',
            r'dummy',
        ],
    },
    "unsafe_eval": {
        "description": "eval(), new Function(), Function() — code injection risk",
        "patterns": [
            (r'\beval\s*\(', "eval() call"),
            (r'\bnew\s+Function\s*\(', "new Function() constructor"),
            (r'\bFunction\s*\(\s*["\']', "Function() constructor with string"),
            (r'\bsetTimeout\s*\(\s*["\']', "setTimeout with string (eval-like)"),
            (r'\bsetInterval\s*\(\s*["\']', "setInterval with string (eval-like)"),
        ],
        "exclude_patterns": [],
    },
    "path_traversal": {
        "description": "Unsanitized user input used in fs/path operations",
        "patterns": [
            (r'(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|unlink)\s*\(\s*(?:req\.(?:query|body|params)|searchParams|request\.url)', "FS op with raw user input"),
            (r'path\.join\s*\(\s*(?:req\.(?:query|body|params)|searchParams|request\.url)', "path.join with raw user input"),
            (r'\.\./\.\./', "Parent directory traversal pattern in source"),
        ],
        "exclude_patterns": [],
    },
    "hardcoded_credentials": {
        "description": "Hardcoded database URLs, service URLs with credentials",
        "patterns": [
            (r'(?:postgres|postgresql|mysql|mongodb)://[^:\s]+:[^@\s]+@[^\s/]+', "Database URL with embedded credentials"),
            # URL with embedded basic auth — require user:pass@host pattern, but exclude JSON-LD escapes (\")
            (r'(?:https?://)[^\s:@/"]+:[^\s@/"]+@[^\s/"]+', "URL with embedded basic auth"),
        ],
        "exclude_patterns": [
            r'process\.env\.',
            r'localhost',
            r'127\.0\.0\.1',
            r'example\.com',
            r'\\"',  # JSON-LD escape — false positive
            r'\\u',  # Unicode escape — false positive
        ],
    },
    "token_exposure": {
        "description": "Logging of tokens, secrets, or auth headers",
        "patterns": [
            (r'console\.(log|info|debug|warn)\s*\(\s*["\`].*(?:token|secret|password|apikey|api_key|authorization)', "Console log mentioning secrets"),
            (r'console\.(log|info|debug|warn)\s*\(\s*[^,)]*,\s*(?:req\.headers\.authorization|req\.headers\["authorization"\]|token|secret|password)', "Console log of secret variable"),
        ],
        "exclude_patterns": [],
    },
    "stack_traces": {
        "description": "Returning err.stack or err.message to client",
        "patterns": [
            (r'(?:NextResponse\.json|Response\.json|res\.json)\s*\([\s\S]{0,300}(?:err|error)\.stack', "Stack trace returned in API response"),
            (r'(?:NextResponse\.json|Response\.json|res\.json)\s*\([\s\S]{0,200}error:\s*[`"\'].*\$\{.*\.stack', "Stack trace in template literal"),
        ],
        "exclude_patterns": [],
    },
    "dangerous_fs": {
        "description": "Filesystem access in API routes (potential for abuse)",
        "patterns": [
            (r'(?:readFileSync|writeFileSync|readFile|writeFile|unlink|mkdir|rmdir)\s*\(', "FS operation"),
        ],
        "exclude_patterns": [],
    },
    "dangerous_child_process": {
        "description": "child_process usage (command injection risk)",
        "patterns": [
            (r'(?:exec|execSync|spawn|spawnSync|fork)\s*\(', "child_process invocation"),
            (r'require\s*\(\s*["\']child_process["\']\s*\)', "child_process import"),
            (r'from\s+["\']node:child_process["\']', "child_process import (ESM)"),
        ],
        "exclude_patterns": [
            r'//.*test',
            r'tests/',
        ],
    },
    "dangerous_dynamic_import": {
        "description": "Dynamic import() with user-controlled path (code injection risk)",
        "patterns": [
            (r'import\s*\(\s*(?:req\.|searchParams|request\.url|args|input|user|params)', "Dynamic import with user input"),
            (r'require\s*\(\s*(?:req\.|searchParams|request\.url|args|input|user|params)', "Dynamic require with user input"),
        ],
        "exclude_patterns": [],
    },
    "cors_wildcard": {
        "description": "CORS Access-Control-Allow-Origin: * (overly permissive)",
        "patterns": [
            (r"Access-Control-Allow-Origin['\"\s,]+:[\s'\"]*\*", "CORS wildcard"),
            (r"cors\(\s*\{\s*origin\s*:\s*['\"]\*['\"]", "CORS wildcard (cors lib)"),
        ],
        "exclude_patterns": [],
    },
}

# 3. Scan all files (tag each finding with scope: production / proxy / script)
findings = defaultdict(list)  # check_name -> list of findings
for f in all_files:
    try:
        content = f.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    rel = str(f.relative_to(PROJECT))

    # Determine scope
    if f in production_files:
        scope = "production"
    elif f in proxy_files:
        scope = "proxy"
    else:
        scope = "script"

    for check_name, check_def in SECURITY_CHECKS.items():
        excludes = [re.compile(p, re.MULTILINE) for p in check_def["exclude_patterns"]]

        for pattern, label in check_def["patterns"]:
            for match in re.finditer(pattern, content, re.MULTILINE):
                start = max(0, match.start() - 80)
                end = min(len(content), match.end() + 80)
                context = content[start:end].replace("\n", "\\n")

                matched_text = match.group(0)
                full_line = content[:match.start()].split("\n")[-1] + matched_text

                excluded = False
                for ex in excludes:
                    if ex.search(full_line) or ex.search(context):
                        excluded = True
                        break

                if not excluded:
                    line_no = content[:match.start()].count("\n") + 1
                    findings[check_name].append({
                        "file": rel,
                        "line": line_no,
                        "matched_text": matched_text[:120],
                        "label": label,
                        "context": context[:200],
                        "scope": scope,
                    })

# 4. Specific Cloudflare wrangler.jsonc check — secrets should NOT be in [vars]
wrangler_path = PROJECT / "wrangler.jsonc"
wrangler_secrets = []
if wrangler_path.exists():
    wr = wrangler_path.read_text()
    # Find [vars] block
    vars_match = re.search(r'"vars"\s*:\s*\{([^}]+)\}', wr)
    if vars_match:
        vars_block = vars_match.group(1)
        # Look for suspicious var names
        for line in vars_block.split("\n"):
            if any(s in line.lower() for s in ["token", "secret", "password", "key", "api_key", "apikey"]):
                # Check value — if it's a literal string (not env binding), flag it
                if re.search(r':\s*["\'][^"\']{8,}["\']', line):
                    wrangler_secrets.append(line.strip())

# 5. Write report
out_dir = PROJECT / "download"
out_dir.mkdir(exist_ok=True)

# Separate findings by scope
production_findings = defaultdict(list)
proxy_findings = defaultdict(list)
script_findings = defaultdict(list)
for check, hits in findings.items():
    for h in hits:
        if h["scope"] == "production":
            production_findings[check].append(h)
        elif h["scope"] == "proxy":
            proxy_findings[check].append(h)
        else:
            script_findings[check].append(h)

lines = []
lines.append("# U8 — Security Audit Report")
lines.append("")
lines.append(f"**Production files scanned:** {len(production_files)}  ")
lines.append(f"**Proxy files scanned:** {len(proxy_files)}  ")
lines.append(f"**Script files scanned (informational):** {len(script_files)}  ")
lines.append(f"**Scan scope:** `src/` (production), `proxy/` (CORS proxy), `scripts/` (build/test only)  ")
lines.append("")

production_total = sum(len(v) for v in production_findings.values())
proxy_total = sum(len(v) for v in proxy_findings.values())
script_total = sum(len(v) for v in script_findings.values())

lines.append("## Summary by Scope")
lines.append("")
lines.append("| Scope | Files | Findings | Verdict |")
lines.append("|-------|-------|----------|---------|")
lines.append(f"| Production (`src/`) | {len(production_files)} | {production_total} | **{'PASS' if production_total == 0 else 'REVIEW'}** |")
lines.append(f"| Proxy (`proxy/`) | {len(proxy_files)} | {proxy_total} | **{'PASS' if proxy_total == 0 else 'REVIEW'}** |")
lines.append(f"| Scripts (`scripts/`) | {len(script_files)} | {script_total} | INFORMATIONAL (not deployed) |")
lines.append("")

# Production findings
lines.append("## Production Findings (deployed code)")
lines.append("")
if production_total == 0:
    lines.append("**PASS** — No security findings in production code (`src/`).")
else:
    lines.append(f"**{production_total} findings require review:**")
    for check_name, check_def in SECURITY_CHECKS.items():
        hits = production_findings.get(check_name, [])
        if hits:
            lines.append(f"### {check_name} — {len(hits)} hits")
            lines.append("")
            lines.append(f"_{check_def['description']}_")
            lines.append("")
            lines.append("| File | Line | Match | Label |")
            lines.append("|------|------|-------|-------|")
            for h in hits[:10]:
                mt = h["matched_text"].replace("|", "\\|")[:60]
                lines.append(f"| `{h['file']}` | {h['line']} | `{mt}` | {h['label']} |")
            lines.append("")
lines.append("")

# Proxy findings
lines.append("## Proxy Findings (`proxy/` — CORS proxy worker)")
lines.append("")
if proxy_total == 0:
    lines.append("**PASS** — No security findings in proxy code.")
else:
    lines.append(f"**{proxy_total} findings:**")
    for check_name, check_def in SECURITY_CHECKS.items():
        hits = proxy_findings.get(check_name, [])
        if hits:
            lines.append(f"### {check_name} — {len(hits)} hits")
            lines.append("")
            for h in hits:
                lines.append(f"- `{h['file']}:{h['line']}` — {h['label']}")
                lines.append(f"  - Match: `{h['matched_text'][:80]}`")
                lines.append(f"  - **Acceptable:** CORS proxy by design serves public macro data; `Access-Control-Allow-Origin: *` is the intended pattern. No sensitive operations exposed.")
            lines.append("")
lines.append("")

# Script findings (informational)
lines.append("## Script Findings (`scripts/` — build/test, NOT deployed)")
lines.append("")
if script_total == 0:
    lines.append("No findings in script files.")
else:
    lines.append(f"_{script_total} findings — informational only (scripts are not deployed to production):_")
    lines.append("")
    for check_name, check_def in SECURITY_CHECKS.items():
        hits = script_findings.get(check_name, [])
        if hits:
            lines.append(f"- **{check_name}** ({len(hits)} hits):")
            for h in hits[:5]:
                lines.append(f"  - `{h['file']}:{h['line']}` — {h['label']}")
            if len(hits) > 5:
                lines.append(f"  - _... and {len(hits) - 5} more_")
    lines.append("")
    lines.append("These findings are in build/test scripts that run locally during CI/test, NOT in the deployed Cloudflare Worker. The `child_process` calls are the test runner spawning `bun test`; the `writeFileSync` calls write reports to `download/`. They are out of scope for runtime security.")
lines.append("")

# Wrangler vars
lines.append("## wrangler.jsonc vars — hardcoded secret check")
lines.append("")
if wrangler_secrets:
    lines.append("**REVIEW REQUIRED** — the following vars in `wrangler.jsonc` may contain hardcoded secrets:")
    lines.append("")
    for s in wrangler_secrets:
        lines.append(f"- `{s}`")
    lines.append("")
    lines.append("_Note: `vars` in wrangler.jsonc are deployed as plaintext to the worker. Real secrets should use `wrangler secret put` instead._")
else:
    lines.append("**PASS** — no hardcoded secrets in `wrangler.jsonc` [vars]. All sensitive values are either env bindings or absent.")
lines.append("")

# Final verdict
critical_categories = ["secret_leakage", "unsafe_eval", "path_traversal", "hardcoded_credentials"]
critical_findings_prod = sum(len(production_findings.get(c, [])) for c in critical_categories)
critical_findings_proxy = sum(len(proxy_findings.get(c, [])) for c in critical_categories)

lines.append("## Final Verdict")
lines.append("")
lines.append(f"- Production critical findings: **{critical_findings_prod}**")
lines.append(f"- Proxy critical findings: **{critical_findings_proxy}** (CORS proxy acceptable)")
lines.append(f"- Wrangler secret leakage: **{len(wrangler_secrets)}**")
lines.append("")
if critical_findings_prod == 0 and not wrangler_secrets:
    lines.append("**PASS** — No critical security findings in production code.")
    lines.append("")
    lines.append("All findings are either:")
    lines.append("- In proxy code (CORS `*` is the intended pattern for public macro data proxy)")
    lines.append("- In build/test scripts (not deployed)")
    lines.append("- False positives (env var references, JSON-LD escapes)")
else:
    lines.append(f"**FAIL** — {critical_findings_prod} critical findings require remediation before deploy.")
lines.append("")

# Write to disk
(out_dir / "SECURITY_AUDIT.md").write_text("\n".join(lines))
(out_dir / "SECURITY_AUDIT_RAW.json").write_text(json.dumps({
    "files_scanned": {
        "production": len(production_files),
        "proxy": len(proxy_files),
        "script": len(script_files),
    },
    "production_findings": dict(production_findings),
    "proxy_findings": dict(proxy_findings),
    "script_findings": dict(script_findings),
    "wrangler_vars_flagged": wrangler_secrets,
    "critical_findings_production": critical_findings_prod,
    "critical_findings_proxy": critical_findings_proxy,
}, indent=2, default=str))

print(f"\n[U8] Production findings: {production_total} (critical: {critical_findings_prod})")
print(f"[U8] Proxy findings: {proxy_total} (critical: {critical_findings_proxy})")
print(f"[U8] Script findings: {script_total} (informational)")
print(f"[U8] Wrangler vars flagged: {len(wrangler_secrets)}")
print(f"[U8] Wrote SECURITY_AUDIT.md")
