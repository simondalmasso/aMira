// ============================================================================
// H1-H10 Source-Tree Hardening Suite
// Operation: ORACLE_DEPLOY_RECOVERY_AND_STABILIZATION
// Mode: CRITICAL_ENGINEERING_ONLY — read-only static verification only.
//
// Each H-suite is a single invariant check against the source tree.
// No engine execution. No scoring. No ML. No network. No KV writes.
// Pure static verification that the invariants established in prior patches
// still hold in the source code that gets bundled into the Worker.
//
// Output: $HARDENING_REPORT_PATH or $RUNNER_TEMP/HARDENING_REPORT.json
// Schema (consumed by scripts/d-post-deploy-validation.ts D5):
//   {
//     total_suites: number,
//     suites_passed: number,
//     final_gate: 'GREEN' | 'AMBER' | 'RED',
//     summary: { total_suites, suites_passed, final_gate },
//     suites: [{ id, name, status, detail, evidence }],
//     generated_at: ISO8601,
//     mode: 'CRITICAL_ENGINEERING_ONLY'
//   }
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.env.GITHUB_WORKSPACE || process.cwd();
const SRC = path.join(ROOT, 'src');
const OUT = process.env.HARDENING_REPORT_PATH || path.join(process.env.RUNNER_TEMP || '/tmp', 'HARDENING_REPORT.json');

// ─── Helpers ────────────────────────────────────────────────────────────────
function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.open-next') continue;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!ext || full.endsWith(ext)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function grepInFiles(files, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const hits = [];
  for (const f of files) {
    const txt = readFile(f);
    if (!txt) continue;
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ file: f, line: i + 1, text: lines[i].trim().slice(0, 200) });
      }
    }
  }
  return hits;
}

// ─── H-suites ───────────────────────────────────────────────────────────────
// Each suite returns { status: 'PASS' | 'FAIL' | 'WARN', detail, evidence }.

function H1_no_modelo_labels() {
  // PATCH 1 invariant: no MODELO masking labels assigned to data fields in
  // engine/scoring code. The word MODELO may still appear in:
  //   - TypeScript type unions for UI badge labels (display compatibility)
  //   - UI components rendering legacy labels (`<MiniBadge label="MODELO" />`)
  // The banned pattern is data assignment: `dataLabel = 'MODELO'`, `source: 'MODELO'`,
  // `quality: 'MODELO'`, `label: 'MODELO'` in non-component, non-type files.
  const srcFiles = listFiles(SRC).filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
  // Look only for assignment patterns, not type unions or JSX props
  const assignHits = grepInFiles(srcFiles, /\b(dataLabel|source|quality|label)\s*[:=]\s*['"]MODELO['"]/);
  // Also catch return statements returning the masking label from engine functions
  const returnHits = grepInFiles(srcFiles, /return\s+['"]MODELO['"]/);
  const real = [...assignHits, ...returnHits].filter(h => {
    // Exclude type union lines (contain '|')
    if (/\|\s*['"]MODELO['"]/.test(h.text) && !/[=:]/.test(h.text.split('MODELO')[0].split(/\|/).pop())) return false;
    // Exclude JSX prop assignments (label="MODELO")
    if (/label\s*=\s*['"]MODELO['"]/.test(h.text) && /<[A-Z]/.test(h.text)) return false;
    return true;
  });
  if (real.length === 0) {
    return { status: 'PASS', detail: '0 MODELO data-masking assignments in src/', evidence: `${srcFiles.length} files scanned (type unions + UI badges excluded)` };
  }
  return {
    status: 'FAIL',
    detail: `${real.length} MODELO data assignments found`,
    evidence: real.slice(0, 5).map(h => `${path.relative(ROOT, h.file)}:${h.line} → ${h.text.slice(0, 120)}`).join('\n'),
  };
}

function H2_deterministic_seed() {
  // PATCH 3 invariant: backtest engine uses mulberry32 with seed=42, createRng(null)
  // throws, and the backtest code path contains 0 Math.random() calls.
  // Math.random is permitted in:
  //   - ID generators (crypto.randomUUID fallback) — non-determinism is correct
  //   - Retry backoff helpers (exponential backoff jitter) — network retry, not scoring
  //   - Test fixtures / scenario generators
  const candidates = [
    path.join(SRC, 'lib/seeded-rng.ts'),
    path.join(ROOT, 'santaninverter-oracle/src/lib/seeded-rng.ts'),
  ];
  const rngFile = candidates.find(fileExists);
  if (!rngFile) {
    return { status: 'WARN', detail: 'seeded-rng.ts not found in src/lib/ or legacy path', evidence: 'checked both locations' };
  }
  const rngSrc = readFile(rngFile) || '';
  const hasMulberry = /mulberry32/.test(rngSrc);
  const throwsOnNull = /createRng\s*\(\s*null\s*\).*throw|throw.*createRng\s*\(\s*null/.test(rngSrc) ||
                       /function createRng[\s\S]*?\{[\s\S]*?if\s*\(\s*seed\s*===?\s*null[\s\S]*?throw/.test(rngSrc);

  // Only flag Math.random in files that actually perform backtest scoring or prediction.
  // Exclude: ID generators, retry/backoff helpers, test fixtures.
  const libFiles = listFiles(path.join(SRC, 'lib')).filter(f => f.endsWith('.ts'));
  const scoringFiles = libFiles.filter(f =>
    /backtest|engine|predict|oracle|signal/i.test(f) &&
    !/fetch|retry|backoff|id-gen|uuid/i.test(f)
  );
  const mathRandomInScoring = grepInFiles(scoringFiles, /Math\.random\s*\(/).filter(h => {
    // Skip full-line comments
    if (/^\s*\/\//.test(h.text) || /^\s*\*/.test(h.text)) return false;
    // Skip inline comments: if Math.random() appears AFTER the // on the line, it's in a comment
    const commentIdx = h.text.indexOf('//');
    if (commentIdx >= 0) {
      const matchIdx = h.text.indexOf('Math.random');
      if (matchIdx > commentIdx) return false;
    }
    // Skip block-comment lines (/* ... */ or * ...)
    if (/^\s*\*/.test(h.text)) return false;
    return true;
  });
  // Filter out: lines where Math.random is clearly in an ID-generation or backoff context
  const real = mathRandomInScoring.filter(h => {
    // Expanded context window (10 lines before, 2 after) — catches crypto.randomUUID guards
    const ctx = readFile(h.file)?.split('\n').slice(Math.max(0, h.line - 10), h.line + 2).join('\n') ?? '';
    return !/randomUUID|backoff|jitter|retry/i.test(ctx);
  });

  const passes = [];
  const fails = [];
  if (hasMulberry) passes.push('mulberry32 present'); else fails.push('mulberry32 missing');
  if (throwsOnNull) passes.push('createRng(null) throws'); else fails.push('createRng(null) does not throw');
  if (real.length === 0) passes.push(`0 Math.random() in scoring files (${scoringFiles.length} scanned)`); else fails.push(`${real.length} Math.random() in scoring files`);

  if (fails.length === 0) {
    return { status: 'PASS', detail: passes.join(', '), evidence: `${path.relative(ROOT, rngFile)} + ${scoringFiles.length} scoring files scanned` };
  }
  return { status: 'FAIL', detail: fails.join(', '), evidence: passes.join(', ') + (real.length > 0 ? `\nMath.random hits: ${real.slice(0, 3).map(h => path.relative(ROOT, h.file) + ':' + h.line).join(', ')}` : '') };
}

function H3_attribution_coverage() {
  // PATCH 4 invariant: recordSignalReturn (or recordPrediction) defined and called in src/
  const srcFiles = listFiles(SRC).filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
  const defHits = grepInFiles(srcFiles, /(export\s+)?(async\s+)?function\s+record(SignalReturn|Prediction)/);
  const callHits = grepInFiles(srcFiles, /\brecord(SignalReturn|Prediction)\s*\(/).filter(h =>
    !/function\s+record(SignalReturn|Prediction)/.test(h.text) && !/^\s*\/\//.test(h.text)
  );
  if (defHits.length > 0 && callHits.length > 0) {
    return {
      status: 'PASS',
      detail: `recordSignalReturn/recordPrediction: ${defHits.length} def + ${callHits.length} calls`,
      evidence: defHits[0] ? path.relative(ROOT, defHits[0].file) + ':' + defHits[0].line : '',
    };
  }
  return {
    status: 'FAIL',
    detail: `definition=${defHits.length} calls=${callHits.length}`,
    evidence: 'recordSignalReturn/recordPrediction not wired',
  };
}

function H4_telemetry_route_exists() {
  // Telemetry route must be present in source (was missing pre-deploy) and expose
  // the 4 core actions. Match either `action === 'X'` (if-chain) or `case 'X':` (switch).
  const route = path.join(SRC, 'app/api/telemetry/route.ts');
  if (!fileExists(route)) {
    return { status: 'FAIL', detail: 'src/app/api/telemetry/route.ts missing', evidence: '' };
  }
  const src = readFile(route) || '';
  const hasSummary = /(action\s*===?\s*['"]summary['"])|(case\s+['"]summary['"]\s*:)/.test(src);
  const hasDecisions = /(action\s*===?\s*['"]decisions['"])|(case\s+['"]decisions['"]\s*:)/.test(src);
  const hasEvents = /(action\s*===?\s*['"]events['"])|(case\s+['"]events['"]\s*:)/.test(src);
  const hasMetrics = /(action\s*===?\s*['"]metrics['"])|(case\s+['"]metrics['"]\s*:)/.test(src);
  const passes = [hasSummary, hasDecisions, hasEvents, hasMetrics].filter(Boolean).length;
  if (passes === 4) {
    return { status: 'PASS', detail: '4 telemetry actions exposed (summary/decisions/events/metrics)', evidence: path.relative(ROOT, route) };
  }
  return { status: 'FAIL', detail: `${passes}/4 actions exposed`, evidence: path.relative(ROOT, route) };
}

function H5_cron_route_exists() {
  // Cron HTTP route (manual trigger) + scheduled handler in wrapper
  const route = path.join(SRC, 'app/api/oracle/cron/route.ts');
  const wrapper = path.join(ROOT, '.open-next/worker-with-cron.js');
  const routeExists = fileExists(route);
  const wrapperExists = fileExists(wrapper);
  if (!routeExists) {
    return { status: 'FAIL', detail: 'src/app/api/oracle/cron/route.ts missing', evidence: '' };
  }
  if (!wrapperExists) {
    return { status: 'WARN', detail: 'worker-with-cron.js not built (run wrap-worker-with-cron.mjs)', evidence: '' };
  }
  const wrapperSrc = readFile(wrapper) || '';
  const hasScheduled = /scheduled\s*\(\s*(event|env|ctx)/.test(wrapperSrc);
  if (hasScheduled) {
    return { status: 'PASS', detail: 'cron route + scheduled() handler both present', evidence: `${path.relative(ROOT, route)} + ${path.relative(ROOT, wrapper)}` };
  }
  return { status: 'FAIL', detail: 'scheduled() handler missing in wrapper', evidence: path.relative(ROOT, wrapper) };
}

function H6_kv_bindings_declared() {
  // wrangler.jsonc must declare all 3 KV namespaces
  const wrangler = path.join(ROOT, 'wrangler.jsonc');
  const src = readFile(wrangler) || '';
  const expected = ['ORACLE_PREDICTIONS', 'ORACLE_ASSETS_HISTORY', 'ORACLE_FCI_HISTORY'];
  const missing = expected.filter(b => !src.includes(`"${b}"`));
  if (missing.length === 0) {
    return { status: 'PASS', detail: '3 KV bindings declared', evidence: expected.join(', ') };
  }
  return { status: 'FAIL', detail: `missing: ${missing.join(', ')}`, evidence: path.relative(ROOT, wrangler) };
}

function H7_cron_schedule_correct() {
  // Post timezone-fix invariant: 0 23 * * 1-5 (= 20:00 AR)
  const wrangler = path.join(ROOT, 'wrangler.jsonc');
  const src = readFile(wrangler) || '';
  const m = src.match(/"crons"\s*:\s*\[\s*"([^"]+)"/);
  if (!m) {
    return { status: 'FAIL', detail: 'crons trigger missing in wrangler.jsonc', evidence: '' };
  }
  const schedule = m[1];
  if (schedule === '0 23 * * 1-5') {
    return { status: 'PASS', detail: `cron schedule = "${schedule}" (= 20:00 AR)`, evidence: path.relative(ROOT, wrangler) };
  }
  return { status: 'FAIL', detail: `cron schedule = "${schedule}" (expected "0 23 * * 1-5")`, evidence: path.relative(ROOT, wrangler) };
}

function H8_worker_with_cron_built() {
  // Wrapper must delegate exactly once to the canonical cron route; durable
  // acknowledgement logic belongs to that route, not to key-count heuristics.
  const wrapper = path.join(ROOT, '.open-next/worker-with-cron.js');
  if (!fileExists(wrapper)) {
    return { status: 'FAIL', detail: '.open-next/worker-with-cron.js missing — run wrap-worker-with-cron.mjs', evidence: '' };
  }
  const src = readFile(wrapper) || '';
  const hasScheduled = /scheduled\s*\(/.test(src);
  const canonicalCalls = (src.match(/\/api\/oracle\/cron/g) || []).length;
  const checksDurableAck = /persistence_ack\?\.durable/.test(src) && /lifecycleDurable/.test(src);
  const noKeyCountHeuristic = !/countKeys|kv_delta|totalDelta/.test(src);
  if (hasScheduled && canonicalCalls === 1 && checksDurableAck && noKeyCountHeuristic) {
    return { status: 'PASS', detail: 'scheduled() delegates once to canonical cron with durable acknowledgements', evidence: `${path.relative(ROOT, wrapper)} (${src.length} bytes)` };
  }
  return { status: 'FAIL', detail: `scheduled=${hasScheduled} canonical_calls=${canonicalCalls} durable_ack=${checksDurableAck} no_key_count_heuristic=${noKeyCountHeuristic}`, evidence: path.relative(ROOT, wrapper) };
}

function H9_handler_freshness() {
  // OpenNext handler.mjs must be newer than the latest source file in src/app/api/
  const handler = path.join(ROOT, '.open-next/server-functions/default/handler.mjs');
  if (!fileExists(handler)) {
    return { status: 'FAIL', detail: 'handler.mjs not built — run @opennextjs/cloudflare build', evidence: '' };
  }
  const handlerMtime = fs.statSync(handler).mtimeMs;
  const apiFiles = listFiles(path.join(SRC, 'app/api')).filter(f => f.endsWith('.ts'));
  if (apiFiles.length === 0) {
    return { status: 'WARN', detail: 'no api source files found to compare', evidence: '' };
  }
  const newestSrc = apiFiles.reduce((newest, f) => {
    const m = fs.statSync(f).mtimeMs;
    return m > newest.m ? { file: f, m } : newest;
  }, { file: '', m: 0 });
  if (handlerMtime > newestSrc.m) {
    return { status: 'PASS', detail: `handler.mjs newer than newest api source`, evidence: `handler=${new Date(handlerMtime).toISOString()} > ${path.relative(ROOT, newestSrc.file)}=${new Date(newestSrc.m).toISOString()}` };
  }
  return { status: 'FAIL', detail: 'handler.mjs is STALE — rebuild needed', evidence: `handler=${new Date(handlerMtime).toISOString()} < ${path.relative(ROOT, newestSrc.file)}=${new Date(newestSrc.m).toISOString()}` };
}

function H10_source_no_type_errors() {
  // Final Order #2 invariant: the configured repository TypeScript graph must
  // have zero diagnostics. Archived runtimes/examples are excluded explicitly
  // by tsconfig.json and documented as non-authoritative evidence.
  try {
    execSync('./node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false', {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 'PASS', detail: '0 TypeScript diagnostics', evidence: 'tsc --noEmit -p tsconfig.json' };
  } catch (error) {
    const out = String(error?.stdout || '') + String(error?.stderr || '');
    const diagnostics = out.split('\n').filter((line) => /error TS\d+:/.test(line));
    return {
      status: 'FAIL',
      detail: `${diagnostics.length || 1} TypeScript diagnostics`,
      evidence: diagnostics.slice(0, 5).join('\n') || 'tsc exited non-zero',
    };
  }
}

// ─── Runner ─────────────────────────────────────────────────────────────────
const suites = [
  { id: 'H1',  name: 'no_modelo_labels',           run: H1_no_modelo_labels },
  { id: 'H2',  name: 'deterministic_seed',         run: H2_deterministic_seed },
  { id: 'H3',  name: 'attribution_coverage',       run: H3_attribution_coverage },
  { id: 'H4',  name: 'telemetry_route_exists',     run: H4_telemetry_route_exists },
  { id: 'H5',  name: 'cron_route_exists',          run: H5_cron_route_exists },
  { id: 'H6',  name: 'kv_bindings_declared',       run: H6_kv_bindings_declared },
  { id: 'H7',  name: 'cron_schedule_correct',      run: H7_cron_schedule_correct },
  { id: 'H8',  name: 'worker_with_cron_built',     run: H8_worker_with_cron_built },
  { id: 'H9',  name: 'handler_freshness',          run: H9_handler_freshness },
  { id: 'H10', name: 'source_no_type_errors',      run: H10_source_no_type_errors },
];

console.log('═'.repeat(80));
console.log('H1-H10 Source-Tree Hardening Suite');
console.log(`Mode: CRITICAL_ENGINEERING_ONLY (read-only static verification)`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log('═'.repeat(80));

const results = [];
let passed = 0;
let warned = 0;
let failed = 0;

for (const suite of suites) {
  let result;
  try {
    result = suite.run();
  } catch (e) {
    result = { status: 'FAIL', detail: `suite threw: ${e.message}`, evidence: e.stack?.split('\n').slice(0, 3).join('\n') };
  }
  const icon = result.status === 'PASS' ? '✓' : result.status === 'WARN' ? '⚠' : '✗';
  console.log(`[${suite.id}] ${icon} ${suite.name}: ${result.status} — ${result.detail}`);
  if (result.evidence) console.log(`       evidence: ${result.evidence.split('\n').slice(0, 3).join('\n       ')}`);
  results.push({ id: suite.id, name: suite.name, status: result.status, detail: result.detail, evidence: result.evidence });
  if (result.status === 'PASS') passed++;
  else if (result.status === 'WARN') warned++;
  else failed++;
}

const total = suites.length;
const finalGate = failed > 0 ? 'RED' : warned > 0 ? 'AMBER' : 'GREEN';

const report = {
  operation: 'ORACLE_DEPLOY_RECOVERY_AND_STABILIZATION',
  mode: 'CRITICAL_ENGINEERING_ONLY',
  generated_at: new Date().toISOString(),
  total_suites: total,
  suites_passed: passed,
  suites_warned: warned,
  suites_failed: failed,
  final_gate: finalGate,
  summary: {
    total_suites: total,
    suites_passed: passed,
    suites_warned: warned,
    suites_failed: failed,
    final_gate: finalGate,
  },
  suites: results,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n' + '═'.repeat(80));
console.log(`FINAL GATE: ${finalGate}  (${passed}/${total} PASS, ${warned} WARN, ${failed} FAIL)`);
console.log(`Report: ${OUT}`);
console.log('═'.repeat(80));

if (finalGate === 'RED') process.exit(1);
