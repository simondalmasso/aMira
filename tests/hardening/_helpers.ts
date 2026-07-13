// tests/hardening/_helpers.ts
// ============================================================================
// Shared fixtures and utilities for the H1-H10 hardening suite.
// ============================================================================
// This module provides:
//   - Frozen MarketStateInput samples (deterministic test vectors)
//   - Stable SHA-256 hashing for golden regression snapshots
//   - A canonical "stable hash" function that excludes volatile fields
//     (timestamps, IDs) so we can compare engine outputs bit-by-bit.
//   - Sweep helpers that run the engine across many synthetic regimes.
// ============================================================================

import { createHash } from 'node:crypto';
import {
  runSinglePass,
  type AssetScoreVector,
} from '@/lib/single-pass-oracle-engine';
import type { MarketStateInput } from '@/lib/single-market-state';

// ─── Frozen Test Vectors (Golden Inputs) ────────────────────────────────────
//
// These represent canonical Argentina macro regimes — the same inputs MUST
// always produce the same outputs (modulo timestamps, which we strip in
// stableHash). If any of these drift, the engine has been mutated and we
// must update the golden snapshot explicitly.

export const GOLDEN_INPUTS: Record<string, MarketStateInput> = {
  // Argentina late-2025 baseline: high rates, moderate inflation, calm FX
  baseline_2025: {
    fx_mep: 1200,
    inflation_monthly: 0.038,
    rates_tna: 0.30,
    reserves_usd: 26000,
    reserves_usd_prev: 26000,
    fx_gap_pct: 4,
    market_breadth: 0.5,
    sources: ['BCRA_API', 'BLUELYTICS_FX', 'INDEC_SERIES', 'LOCAL_MARKET_PRICES'],
    quality: 'REAL',
  },

  // EASING regime: low real carry + risk-on
  easing_2024: {
    fx_mep: 1000,
    inflation_monthly: 0.025,
    rates_tna: 0.20,
    reserves_usd: 28000,
    reserves_usd_prev: 27500,
    fx_gap_pct: 2,
    market_breadth: 0.7,
    sources: ['BCRA_API', 'BLUELYTICS_FX', 'INDEC_SERIES', 'LOCAL_MARKET_PRICES'],
    quality: 'REAL',
  },

  // TIGHTENING regime: high real carry + risk-off (FX pressure)
  tightening_2023: {
    fx_mep: 900,
    inflation_monthly: 0.075,
    rates_tna: 0.97,
    reserves_usd: 22000,
    reserves_usd_prev: 24000,
    fx_gap_pct: 18,
    market_breadth: 0.3,
    sources: ['BCRA_API', 'BLUELYTICS_FX', 'INDEC_SERIES', 'LOCAL_MARKET_PRICES'],
    quality: 'REAL',
  },

  // STAGFLATION: negative real carry + risk-off
  stagflation_2024: {
    fx_mep: 1400,
    inflation_monthly: 0.13,
    rates_tna: 0.50,
    reserves_usd: 21000,
    reserves_usd_prev: 22500,
    fx_gap_pct: 25,
    market_breadth: 0.2,
    sources: ['BCRA_API', 'BLUELYTICS_FX', 'INDEC_SERIES', 'LOCAL_MARKET_PRICES'],
    quality: 'PARTIAL_FALLBACK',
  },

  // PARTIAL_FALLBACK: 1 source missing
  partial_fallback: {
    fx_mep: 1250,
    inflation_monthly: 0.04,
    rates_tna: 0.28,
    reserves_usd: 25500,
    reserves_usd_prev: 25400,
    fx_gap_pct: 5,
    market_breadth: 0.5,
    sources: ['BCRA_API', 'BLUELYTICS_FX', 'LOCAL_MARKET_PRICES'],
    quality: 'PARTIAL_FALLBACK',
  },

  // STALE: all sources stale
  stale: {
    fx_mep: 1500,
    inflation_monthly: 0.05,
    rates_tna: 0.32,
    reserves_usd: 24000,
    reserves_usd_prev: 24000,
    fx_gap_pct: 12,
    market_breadth: 0.4,
    sources: [],
    quality: 'STALE',
  },

  // ERROR: all sources failed
  error_state: {
    fx_mep: 0,
    inflation_monthly: 0,
    rates_tna: 0,
    reserves_usd: 0,
    reserves_usd_prev: 0,
    fx_gap_pct: 0,
    market_breadth: 0,
    sources: [],
    quality: 'ERROR',
  },

  // Edge: extreme values
  extreme_high: {
    fx_mep: 5000,
    inflation_monthly: 0.50,
    rates_tna: 2.00,
    reserves_usd: 1000,
    reserves_usd_prev: 30000,
    fx_gap_pct: 100,
    market_breadth: 1.0,
    sources: ['BCRA_API', 'BLUELYTICS_FX', 'INDEC_SERIES'],
    quality: 'REAL',
  },

  // Edge: zero values (must not produce NaN)
  zero_edge: {
    fx_mep: 1,
    inflation_monthly: 0.0,
    rates_tna: 0.0,
    reserves_usd: 0,
    reserves_usd_prev: 0,
    fx_gap_pct: 0,
    market_breadth: 0.0,
    sources: ['BCRA_API'],
    quality: 'PARTIAL_FALLBACK',
  },
};

// ─── Stable Hash ────────────────────────────────────────────────────────────
//
// Recursively strips volatile fields (timestamps, IDs) and produces a stable
// SHA-256 hash. Used by golden regression + determinism audit.

const VOLATILE_KEYS = new Set([
  'timestamp', 'timestamp_ms', 'computed_at', 'fetchedAt', 'lastUpdate',
  'dataDate', 'id', 'prediction_id', 'event_id', 'audit_id',
  'freshness_sec',  // always 0 in test context
]);

export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => !VOLATILE_KEYS.has(k)).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(rec[k])).join(',') + '}';
}

export function stableHash(obj: unknown): string {
  return createHash('sha256').update(stableStringify(obj)).digest('hex');
}

// ─── Run helpers ────────────────────────────────────────────────────────────

export function runEngine(input: MarketStateInput): AssetScoreVector {
  return runSinglePass(input);
}

export function runEngineStable(input: MarketStateInput): {
  vector: AssetScoreVector;
  hash: string;
} {
  const vector = runEngine(input);
  return { vector, hash: stableHash(vector) };
}

// ─── Sweep helper (for property tests) ──────────────────────────────────────

export function sweepInputs(count: number = 50): MarketStateInput[] {
  const out: MarketStateInput[] = [];
  // Use a LCG for reproducibility — no Math.random in tests.
  let seed = 0x5EED_5EED;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let i = 0; i < count; i++) {
    out.push({
      fx_mep: 500 + rand() * 4500,
      inflation_monthly: rand() * 0.5,
      rates_tna: rand() * 1.5,
      reserves_usd: 10000 + rand() * 30000,
      reserves_usd_prev: 10000 + rand() * 30000,
      fx_gap_pct: rand() * 100,
      market_breadth: rand(),
      sources: ['BCRA_API', 'BLUELYTICS_FX', 'INDEC_SERIES', 'LOCAL_MARKET_PRICES'],
      quality: 'REAL',
    });
  }
  return out;
}

// ─── Assertion helpers ──────────────────────────────────────────────────────

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function assertAllFinite(obj: unknown, path: string = ''): string[] {
  const violations: string[] = [];
  if (obj === null || obj === undefined) return violations;
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) violations.push(`${path}=${obj}`);
    return violations;
  }
  if (typeof obj !== 'object') return violations;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      violations.push(...assertAllFinite(v, `${path}[${i}]`));
    });
    return violations;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    violations.push(...assertAllFinite(v, path ? `${path}.${k}` : k));
  }
  return violations;
}
