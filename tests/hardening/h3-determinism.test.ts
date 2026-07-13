// tests/hardening/h3-determinism.test.ts
// ============================================================================
// H3 — Determinism Audit
// ============================================================================
// CHECKS:
//   - same input => same output (across N runs)
//   - stable hashes (no bit-level drift)
//   - stable lineage (weights, regime classification, action signal)
//   - no stochastic drift (no Math.random in code path)
//
// METHODOLOGY:
//   Run the engine 100× per golden input. All 100 outputs must hash identically.
//   Additionally, sweep the source code to verify NO Math.random / Date.now /
//   crypto.randomBytes is used in the engine path.
// ============================================================================

import { test, describe, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { GOLDEN_INPUTS, runEngine, stableHash } from './_helpers';

const require_ = createRequire(import.meta.url);
const SRC_DIR = join(dirname(require_.resolve('@/lib/single-pass-oracle-engine')), '..');

// ─── Engine determinism ────────────────────────────────────────────────────

describe('H3 — Determinism Audit', () => {
  for (const [name, input] of Object.entries(GOLDEN_INPUTS)) {
    test(`same input => same output across 100 runs (${name})`, () => {
      const hashes = new Set<string>();
      const scores = new Set<number>();
      const regimes = new Set<string>();
      const actions = new Set<string>();
      const confidences = new Set<number>();

      for (let i = 0; i < 100; i++) {
        const v = runEngine(input);
        hashes.add(stableHash(v));
        scores.add(v.scores[0]!.score);
        regimes.add(v.scores[0]!.regime.regime);
        actions.add(v.scores[0]!.action);
        confidences.add(v.scores[0]!.prediction.confidence);
      }

      expect(hashes.size).toBe(1);
      expect(scores.size).toBe(1);
      expect(regimes.size).toBe(1);
      expect(actions.size).toBe(1);
      expect(confidences.size).toBe(1);
    });
  }

  test('stable hashes — no bit-level drift across runs', () => {
    // Run engine twice and confirm hash bit-equality
    for (const [name, input] of Object.entries(GOLDEN_INPUTS)) {
      const h1 = stableHash(runEngine(input));
      const h2 = stableHash(runEngine(input));
      expect(h1).toBe(h2);
    }
  });

  test('stable lineage — weights, regime, action deterministic', () => {
    const input = GOLDEN_INPUTS.baseline_2025;
    const v1 = runEngine(input);
    const v2 = runEngine(input);

    // Weights
    expect(v1.scores[0]!.breakdown.weights).toEqual(v2.scores[0]!.breakdown.weights);

    // Contributions
    expect(v1.scores[0]!.breakdown.contributions).toEqual(v2.scores[0]!.breakdown.contributions);

    // Raw score
    expect(v1.scores[0]!.breakdown.raw).toBe(v2.scores[0]!.breakdown.raw);

    // Regime classification
    expect(v1.scores[0]!.regime).toEqual(v2.scores[0]!.regime);

    // Action signal
    expect(v1.scores[0]!.action).toBe(v2.scores[0]!.action);
  });

  // ─── Source code scan: no Math.random / Date.now in engine path ─────────
  test('no Math.random in engine path (no stochastic drift)', () => {
    const engineFiles = [
      'single-pass-oracle-engine.ts',
      'single-market-state.ts',
      'linear-factor-model.ts',
      'oracle/v2/index.ts',
      'oracle/v2/confidence-engine.ts',
      'oracle/v2/regime-detector-v2.ts',
      'oracle/v2/explainer.ts',
      'oracle/v2/lineage.ts',
      'oracle/v2/audit-trail.ts',
      'oracle/v2/forecast-verifier.ts',
      'oracle/v2/adaptive-weights.ts',
      'oracle/v2/health-monitor.ts',
      'oracle/v2/scenario-engine.ts',
      'oracle/v2/foundation-model-adapter.ts',
      'oracle/v3/index.ts',
      'oracle/v3/conformal-confidence.ts',
      'oracle/v3/structural-regime-detector.ts',
      'oracle/v3/calibration-engine.ts',
      'oracle/v3/model-arbitration.ts',
      'oracle/v3/evidence-engine.ts',
      'oracle/v3/historical-memory.ts',
      'oracle/v3/self-diagnosis.ts',
      'oracle/v3/counterfactual-engine.ts',
      'oracle/v3/institutional-validation.ts',
      'oracle/v3/knowledge-graph.ts',
    ];

    const violations: string[] = [];
    for (const rel of engineFiles) {
      const path = join(SRC_DIR, rel);
      let src: string;
      try {
        src = readFileSync(path, 'utf8');
      } catch {
        continue; // file may not exist in some branches
      }
      // Strip comments + strings to avoid false positives
      const stripped = src
        .replace(/\/\/[^\n]*/g, '')           // line comments
        .replace(/\/\*[\s\S]*?\*\//g, '')     // block comments
        .replace(/'([^'\\]|\\.)*'/g, "''")    // single-quoted strings
        .replace(/"([^"\\]|\\.)*"/g, '""')    // double-quoted strings
        .replace(/`([^`\\]|\\.)*`/g, '``');   // template strings

      if (/\bMath\.random\s*\(/.test(stripped)) {
        violations.push(`${rel}: Math.random() found in engine path`);
      }
      if (/\bDate\.now\s*\(\s*\)/.test(stripped)) {
        // Date.now is allowed in market_state timestamp generation, but NOT
        // for any computation that affects the score. We flag it for review.
        // (single-market-state.ts uses Date.now() for the timestamp — that's OK.)
        if (!rel.endsWith('single-market-state.ts')) {
          violations.push(`${rel}: Date.now() found in engine path (review needed)`);
        }
      }
      if (/\bcrypto\.randomBytes\s*\(/.test(stripped) || /\bcrypto\.getRandomValues\s*\(/.test(stripped)) {
        violations.push(`${rel}: crypto.random*() found in engine path`);
      }
    }

    expect(violations).toEqual([]);
  });

  test('no stochastic drift across sweep (50 random inputs, 10 runs each)', () => {
    // Use seeded RNG so the sweep itself is deterministic
    let seed = 0xDEAD_BEEF;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let i = 0; i < 50; i++) {
      const input = {
        fx_mep: 500 + rand() * 4500,
        inflation_monthly: rand() * 0.5,
        rates_tna: rand() * 1.5,
        reserves_usd: 10000 + rand() * 30000,
        reserves_usd_prev: 10000 + rand() * 30000,
        fx_gap_pct: rand() * 100,
        market_breadth: rand(),
        sources: ['BCRA_API', 'BLUELYTICS_FX'],
        quality: 'REAL' as const,
      };

      const baseline = stableHash(runEngine(input));
      for (let r = 0; r < 10; r++) {
        const h = stableHash(runEngine(input));
        if (h !== baseline) {
          throw new Error(`stochastic drift at sweep ${i}, run ${r}`);
        }
      }
    }
  });
});
