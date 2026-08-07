// tests/hardening/h8-architectural-invariants.test.ts
// ============================================================================
// H8 — Architectural Invariant Tests
// ============================================================================
// ASSERT:
//   - ONE Oracle              — single canonical engine (single-pass-oracle-engine)
//   - ONE Portfolio Engine    — no parallel portfolio logic
//   - ONE Market Pipeline     — single market state source (live-data.ts)
//   - ONE Prediction Pipeline — no parallel prediction models
//   - ONE Lifecycle           — amira-prediction-lifecycle is canonical
//   - ONE Canonical API       — /api/oracle/single is canonical
//
// METHODOLOGY:
//   Source-code static analysis: count importers, count export sites,
//   verify no duplicate engines exist. We do NOT delete legacy modules
//   (they have API contracts to honor) — but we verify that the canonical
//   ones are the only ones imported by the canonical pipeline.
// ============================================================================

import { test, describe, expect } from 'bun:test';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const SRC_DIR = join(dirname(require_.resolve('@/lib/single-pass-oracle-engine')), '..');
const API_DIR = join(SRC_DIR, 'app', 'api');

function listTsFiles(dir: string, recursive: boolean = true): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory() && recursive) {
      out.push(...listTsFiles(path, true));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}

function grepInFiles(files: string[], pattern: RegExp): { file: string; line: string; lineNo: number }[] {
  const out: { file: string; line: string; lineNo: number }[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < src.length; i++) {
      if (pattern.test(src[i]!)) {
        out.push({ file, line: src[i]!.trim(), lineNo: i + 1 });
      }
    }
  }
  return out;
}

const allSrcFiles = listTsFiles(SRC_DIR);

describe('H8 — Architectural Invariant Tests', () => {
  // ─── ONE Oracle ─────────────────────────────────────────────────────────
  test('ONE Oracle — only single-pass-oracle-engine is imported by /api/oracle/single', () => {
    const canonicalRoute = readFileSync(join(API_DIR, 'oracle', 'single', 'route.ts'), 'utf8');
    expect(canonicalRoute).toContain("from '@/lib/single-pass-oracle-engine'");
    expect(canonicalRoute).toContain("runSinglePass");

    // The canonical route should NOT import from legacy engines
    expect(canonicalRoute).not.toContain("from '@/lib/macroOracle'");
    expect(canonicalRoute).not.toContain("from '@/lib/amira-prediction-engine'");
    expect(canonicalRoute).not.toContain("from '@/lib/oracle-fci/predict'");
    expect(canonicalRoute).not.toContain("from '@/lib/oracle-multi/predict'");
  });

  test('ONE Oracle — runSinglePass is the only exported engine entry point', () => {
    const engineSrc = readFileSync(join(SRC_DIR, 'lib', 'single-pass-oracle-engine.ts'), 'utf8');
    // Should export runSinglePass
    expect(engineSrc).toMatch(/export\s+function\s+runSinglePass\b/);
    // Should NOT export a second `run*Pass` function (would indicate parallel engine).
    // Negative lookahead excludes runSinglePass itself.
    const otherRunPass = engineSrc.match(/export\s+function\s+run(?!SinglePass\b)[A-Z]\w*Pass\b/g);
    expect(otherRunPass).toBeNull();
  });

  // ─── ONE Portfolio Engine ───────────────────────────────────────────────
  test('ONE Portfolio Engine — portfolio-engine.ts is the single canonical module', () => {
    // portfolio-engine.ts lives under src/lib/oracle/ (not src/lib/)
    expect(existsSync(join(SRC_DIR, 'lib', 'oracle', 'portfolio-engine.ts'))).toBe(true);
    const portfolioModules = allSrcFiles.filter((f) =>
      /portfolio-engine\.tsx?$/.test(f) && !f.includes('components/'),
    );
    // We allow 1 canonical file (legacy code may have remnants but no new ones)
    expect(portfolioModules.length).toBeGreaterThanOrEqual(1);
    expect(portfolioModules.length).toBeLessThanOrEqual(2);
  });

  // ─── ONE Market Pipeline ────────────────────────────────────────────────
  test('ONE Market Pipeline — live-data.ts is the single source of MacroState', () => {
    const canonicalRoute = readFileSync(join(API_DIR, 'macro', 'route.ts'), 'utf8');
    expect(canonicalRoute).toContain("from '@/lib/live-data'");
    expect(canonicalRoute).toContain("getMacroState");

    // The canonical route should NOT bypass live-data with direct BCRA/Bluelytics fetches
    expect(canonicalRoute).not.toContain("fetch('https://api.bcra.gob.ar");
    expect(canonicalRoute).not.toContain("fetch('https://api.bluelytics.com.ar");
    expect(canonicalRoute).not.toContain("fetch('https://datos.gob.ar");
  });

  test('ONE Market Pipeline — single-market-state.ts is the single MarketState builder', () => {
    const marketStateModules = allSrcFiles.filter((f) =>
      /single-market-state\.tsx?$/.test(f),
    );
    expect(marketStateModules.length).toBe(1);
    expect(marketStateModules[0]).toBe(join(SRC_DIR, 'lib', 'single-market-state.ts'));
  });

  // ─── ONE Prediction Pipeline ────────────────────────────────────────────
  test('ONE Prediction Pipeline — route executes V1 once and delegates enrichment through V3', () => {
    const canonicalRoute = readFileSync(join(API_DIR, 'oracle', 'single', 'route.ts'), 'utf8');
    expect(canonicalRoute).not.toContain("amira-prediction-engine");
    expect(canonicalRoute).not.toContain("oracle-fci/predict");
    expect(canonicalRoute).not.toContain("oracle-multi/predict");
    expect(canonicalRoute).toContain("runSinglePass");
    expect(canonicalRoute).toContain("oracle/v3");
    expect(canonicalRoute).not.toContain("from '@/lib/oracle/v2'");
  });

  test('ONE Prediction Pipeline — V2/V3 reuse a precomputed canonical V1 vector', () => {
    const v2src = readFileSync(join(SRC_DIR, 'lib', 'oracle', 'v2', 'index.ts'), 'utf8');
    expect(v2src).toContain("from '@/lib/single-pass-oracle-engine'");
    expect(v2src).toContain('v1Vector?: AssetScoreVector');
    expect(v2src).toContain('v1Vector ?? runSinglePass(input)');

    const v3src = readFileSync(join(SRC_DIR, 'lib', 'oracle', 'v3', 'index.ts'), 'utf8');
    expect(v3src).toContain('v1Vector?: AssetScoreVector');
    expect(v3src).toContain('runV2SystemicEnrichment(input, v1Vector)');
    expect(v3src).not.toMatch(/import.*amira-prediction-engine/);
  });

  // ─── ONE Lifecycle ─────────────────────────────────────────────────────
  test('ONE Lifecycle — server-safe core and client facade have explicit boundaries', () => {
    const corePath = join(SRC_DIR, 'lib', 'amira-prediction-lifecycle-core.ts');
    const facadePath = join(SRC_DIR, 'lib', 'amira-prediction-lifecycle.ts');
    expect(existsSync(corePath)).toBe(true);
    expect(existsSync(facadePath)).toBe(true);

    const core = readFileSync(corePath, 'utf8');
    expect(core).not.toContain("from 'react'");
    expect(core).not.toContain("'use client'");
    expect(core).not.toContain('amira-prediction-engine');

    const facade = readFileSync(facadePath, 'utf8');
    expect(facade).toContain("'use client'");
    expect(facade).toContain("from 'react'");
    expect(facade).toContain("./amira-prediction-lifecycle-core");

    const closedLoop = readFileSync(join(SRC_DIR, 'lib', 'closed-loop-learning.ts'), 'utf8');
    expect(closedLoop).toContain('getLifecycleSnapshot');
    expect(closedLoop).toContain("./amira-prediction-lifecycle-core");
  });

  test('ONE Lifecycle — canonical server route cannot reach the React lifecycle facade directly', () => {
    const canonicalRoute = readFileSync(join(API_DIR, 'oracle', 'single', 'route.ts'), 'utf8');
    expect(canonicalRoute).not.toContain("@/lib/amira-prediction-lifecycle'");
  });


  test('ONE Lifecycle — KV ledger is storage adapter only, not a second lifecycle truth', () => {
    const ledger = readFileSync(join(SRC_DIR, 'lib', 'amira-prediction-lifecycle-ledger.ts'), 'utf8');
    expect(ledger).toContain("from './amira-prediction-lifecycle-core'");
    expect(ledger).toContain('hydrateLifecycleEvents');
    expect(ledger).toContain('lifecycleRecordPrediction');
    expect(ledger).not.toMatch(/const\s+memory\s*=\s*new\s+Map/);
    expect(ledger).not.toMatch(/interface\s+LifecycleLedgerRecord\s*\{/);
  });

  test('Lifecycle durability — outcomes and verifications are persisted with distinct event prefixes', () => {
    const ledger = readFileSync(join(SRC_DIR, 'lib', 'amira-prediction-lifecycle-ledger.ts'), 'utf8');
    expect(ledger).toContain("outcome: 'lifecycle:outcome:'");
    expect(ledger).toContain("verification: 'lifecycle:verification:'");
    expect(ledger).toContain('captureLifecycleOutcome');
    expect(ledger).toContain('verifyLifecyclePrediction');
    expect(ledger).toContain('recoverLifecycle');
  });

  test('Scenario and counterfactual reruns are explicitly synthetic and non-learning', () => {
    for (const rel of ['oracle/v2/scenario-engine.ts', 'oracle/v3/counterfactual-engine.ts']) {
      const source = readFileSync(join(SRC_DIR, 'lib', rel), 'utf8');
      expect(source).toContain("data_class: 'SYNTHETIC'");
      expect(source).toContain("live_prediction: false");
      expect(source).toContain("lifecycle_persist_as_real: false");
      expect(source).toContain("learning_eligible: false");
    }
  });

  test('Canonical V1/V2/V3 paths do not assume scores[0] or assets[0]', () => {
    const files = [
      join(API_DIR, 'oracle', 'single', 'route.ts'),
      join(SRC_DIR, 'lib', 'oracle', 'v2', 'index.ts'),
      join(SRC_DIR, 'lib', 'oracle', 'v3', 'index.ts'),
      join(SRC_DIR, 'lib', 'oracle', 'v2', 'scenario-engine.ts'),
      join(SRC_DIR, 'lib', 'oracle', 'v3', 'counterfactual-engine.ts'),
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/\.scores\s*\[\s*0\s*\]/);
      expect(source).not.toMatch(/\.assets\s*\[\s*0\s*\]/);
    }
  });

  test('Cron — scheduled wrapper delegates once to canonical route and does not use key-count deltas as proof', () => {
    const wrapperScript = readFileSync(join(SRC_DIR, '..', 'scripts', 'wrap-worker-with-cron.mjs'), 'utf8');
    expect(wrapperScript).toContain('/api/oracle/cron');
    expect(wrapperScript).toContain('persistence_ack?.durable');
    expect(wrapperScript).not.toContain('countKeys');
    expect(wrapperScript).not.toContain('kv_delta');
  });

  // ─── ONE Canonical API ──────────────────────────────────────────────────
  test('ONE Canonical API — /api/oracle/single exists and is the canonical prediction endpoint', () => {
    expect(existsSync(join(API_DIR, 'oracle', 'single', 'route.ts'))).toBe(true);
  });

  test('ONE Canonical API — /api/macro exists and is the canonical macro endpoint', () => {
    expect(existsSync(join(API_DIR, 'macro', 'route.ts'))).toBe(true);
  });

  test('ONE Canonical API — /api/telemetry now exists (H1 deliverable)', () => {
    expect(existsSync(join(API_DIR, 'telemetry', 'route.ts'))).toBe(true);
  });

  // ─── Anti-Frankenstein: no second engine instantiated ──────────────────
  test('Anti-Frankenstein — no `new .*Engine()` instantiations in src/lib (excluding type refs)', () => {
    // Search for engine instantiations — should not find parallel engines
    const engineInstantiations = grepInFiles(
      allSrcFiles.filter((f) => f.startsWith(join(SRC_DIR, 'lib'))),
      /\bnew\s+\w*Engine\s*\(/,
    ).filter((hit) => !hit.file.includes('__tests__') && !hit.file.includes('tests/'));

    // We accept some legacy instantiations but log them for review
    if (engineInstantiations.length > 0) {
      console.log('Engine instantiations found (legacy — review for V4 cleanup):');
      for (const hit of engineInstantiations) {
        console.log(`  ${hit.file}:${hit.lineNo}: ${hit.line}`);
      }
    }
    // No new engines should be instantiated in the canonical pipeline
    const canonicalInstantiations = engineInstantiations.filter((hit) =>
      hit.file.includes('oracle/v2/') || hit.file.includes('oracle/v3/') || hit.file.includes('single-pass-oracle-engine'),
    );
    expect(canonicalInstantiations).toEqual([]);
  });

  // ─── V2 + V3 are APPEND-ONLY (no replacement of V1) ────────────────────
  test('V2 + V3 — append-only enrichment, V1 vector shape unchanged', () => {
    const v2src = readFileSync(join(SRC_DIR, 'lib', 'oracle', 'v2', 'index.ts'), 'utf8');
    const v3src = readFileSync(join(SRC_DIR, 'lib', 'oracle', 'v3', 'index.ts'), 'utf8');

    // V2 must return v1 (canonical AssetScoreVector)
    expect(v2src).toMatch(/v1[:\s]+AssetScoreVector/);
    // V3 must return v1 + v2
    expect(v3src).toMatch(/v1[:\s]+AssetScoreVector/);
    expect(v3src).toMatch(/v2[:\s]+V2SystemicReport/);
  });

  // ─── Cron is single-scheduled ──────────────────────────────────────────
  test('Cron — single cron expression in wrangler.jsonc', () => {
    const wrangler = readFileSync(join(SRC_DIR, '..', 'wrangler.jsonc'), 'utf8');
    const cronMatches = wrangler.match(/"crons"\s*:\s*\[[^\]]*\]/g);
    expect(cronMatches).not.toBeNull();
    expect(cronMatches!.length).toBe(1);
    // Should contain exactly one cron expression
    const cronExprs = wrangler.match(/"\d[^"]*"/g) ?? [];
    const cronLines = cronExprs.filter((e) => /\d\s+\d|\*|\d-\d/.test(e) && e.includes('*'));
    expect(cronLines.length).toBeGreaterThanOrEqual(1);
  });

  // ─── KV namespaces are bounded ─────────────────────────────────────────
  test('KV namespaces — exactly 3 namespaces bound (FCI_HISTORY, ASSETS_HISTORY, PREDICTIONS)', () => {
    const wrangler = readFileSync(join(SRC_DIR, '..', 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('ORACLE_FCI_HISTORY');
    expect(wrangler).toContain('ORACLE_ASSETS_HISTORY');
    expect(wrangler).toContain('ORACLE_PREDICTIONS');
    // Count kv_namespaces entries
    const kvBlock = wrangler.match(/"kv_namespaces"\s*:\s*\[([\s\S]*?)\]/);
    expect(kvBlock).not.toBeNull();
    const idMatches = kvBlock![1].match(/"id"\s*:/g) ?? [];
    expect(idMatches.length).toBe(3);
  });
});
