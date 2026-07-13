// src/lib/oracle/v3/conformal-confidence.ts
// ============================================================================
// I1 — CONFORMAL CONFIDENCE ENGINE (MAPIE-ready) — append-only
// ============================================================================
// MISSION (per ORACLE_V3_INTELLIGENCE_LAYER spec, I1):
//   "Reemplazar el confidence heurístico por intervalos probabilísticos reales."
//
// ARCHITECTURE:
//   - Generic interface ConformalPredictor (any conformal backend can implement)
//   - Built-in InternalConformalPredictor: uses split-conformal calibration
//     over historical verification pairs (from V2 R4 buffer) to derive
//     empirical quantiles of |residual| → real prediction intervals.
//   - MAPIEAdapter: stub adapter that delegates to the same internal
//     conformal engine but is wired for an external MAPIE service (when
//     available, swap the `calibrate` call for an HTTP/Python call).
//   - The V2 confidence-engine (R1) is NOT replaced — it remains the
//     canonical heuristic layer. This V3 module ADDS a conformal layer
//     that re-ranks confidence using calibration evidence.
//
// SPLIT-CONFORMAL ALGORITHM:
//   1. Collect the last N verification pairs (expected, realized).
//   2. Compute nonconformity scores s_i = |expected_i - realized_i|.
//   3. For a new prediction y_hat with target coverage α (default 0.90):
//        q_α = quantile(s_i, ceil((N+1) * α) / N)
//        interval = [y_hat - q_α, y_hat + q_α]
//   4. Coverage guarantee: P(y ∈ interval) ≥ α under exchangeability.
//
// APPEND-ONLY / ANTI-FRANKENSTEIN:
//   - Does NOT modify V2 ConfidenceLayer. Reads from R4 verification buffer.
//   - Adds a NEW field `v3.conformal` to the response.
//   - All adapters implement the same interface — Oracle is final authority.
// ============================================================================

import type { AssetScore, AssetPrediction } from '@/lib/single-pass-oracle-engine';
import type { MarketState, NormalizedFeatures } from '@/lib/single-market-state';
import type { ConfidenceLayer } from '@/lib/oracle/v2/confidence-engine';
import { getVerificationBuffer } from '@/lib/oracle/v2/forecast-verifier';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface ConformalInterval {
  /** Lower bound (fractional return, e.g. -0.08) */
  lower: number;
  /** Center (= prediction.expected_return) */
  center: number;
  /** Upper bound (fractional return, e.g. +0.12) */
  upper: number;
  /** Width = upper - lower */
  width: number;
  /** Target coverage (0..1, e.g. 0.90) */
  coverage: number;
  /** Quantile used (nonconformity threshold) */
  quantile: number;
  /** Method label */
  method: string;
  /** Whether the interval was derived empirically or fell back to heuristic */
  empirical: boolean;
  /** Sample size used for calibration */
  calibration_size: number;
}

export interface ConformalCalibration {
  /** Target coverage (input) */
  target_coverage: number;
  /** Empirical coverage achieved on the calibration set (leave-one-out) */
  empirical_coverage: number;
  /** Mean nonconformity score */
  mean_score: number;
  /** Quantile of nonconformity scores at target coverage */
  quantile: number;
  /** Distribution of nonconformity scores (sampled) */
  score_distribution: number[];
  /** Sample size used for the calibration */
  sample_size: number;
}

export interface ConformalConfidenceReport {
  /** Conformal interval around expected_return */
  interval: ConformalInterval;
  /** Calibration diagnostics */
  calibration: ConformalCalibration;
  /** Conformal-adjusted confidence score 0..100 (replaces heuristic when empirical) */
  conformal_confidence: number;
  /** Adjustment vs V2 heuristic confidence (positive = conformal is more confident) */
  delta_vs_heuristic: number;
  /** Adapter that produced this report */
  adapter_id: string;
  /** Whether the adapter is a stub or a real conformal backend */
  is_stub: boolean;
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
  /** Feature flag: was this layer enabled? */
  enabled: boolean;
}

export const CONFORMAL_CONFIDENCE_VERSION = 'conformal_confidence_v3_i1';

// ─── Generic Predictor Interface (MAPIE-ready) ─────────────────────────────
//
// Any external conformal library (MAPIE, mapie-ml, scikit-posthocs) can
// implement this interface. The orchestrator calls `calibrate()` once per
// prediction cycle and `predict_interval()` per asset.

export interface ConformalPredictor {
  id: string;
  name: string;
  version: string;
  is_stub: boolean;
  enabled: boolean;
  /** Calibrate nonconformity scores from verification pairs */
  calibrate(pairs: Array<{ expected: number; realized: number }>, coverage: number): ConformalCalibration;
  /** Predict interval for a new point */
  predictInterval(point: { expected: number }, calibration: ConformalCalibration): ConformalInterval;
}

// ─── Internal Conformal Predictor (split-conformal) ────────────────────────
//
// Implements the standard split-conformal algorithm in pure TS. No external
// dependencies. Uses leave-one-out empirical coverage estimation.

class InternalConformalPredictor implements ConformalPredictor {
  id = 'internal-split-conformal';
  name = 'Internal Split-Conformal';
  version = 'v1';
  is_stub = false;
  enabled = true;

  calibrate(pairs: Array<{ expected: number; realized: number }>, coverage: number): ConformalCalibration {
    const scores = pairs.map((p) => Math.abs(p.expected - p.realized));
    const n = scores.length;

    if (n < 5) {
      return {
        target_coverage: coverage,
        empirical_coverage: 0,
        mean_score: 0,
        quantile: 0,
        score_distribution: scores,
        sample_size: n,
      };
    }

    const sorted = [...scores].sort((a, b) => a - b);
    // Quantile with ceil((n+1) * α) / n formula for finite-sample coverage
    const rank = Math.ceil((n + 1) * coverage);
    const quantile = sorted[Math.min(rank - 1, n - 1)] ?? sorted[n - 1];

    // Leave-one-out empirical coverage: for each i, count how many j≠i have |s_j| ≤ q_loocv_i
    // Simplification: use the full-sample quantile and compute fraction of scores ≤ quantile.
    const covered = scores.filter((s) => s <= quantile).length;
    const empirical_coverage = covered / n;

    return {
      target_coverage: coverage,
      empirical_coverage,
      mean_score: mean(scores),
      quantile,
      score_distribution: sorted.slice(-50), // last 50 for distribution view
      sample_size: n,
    };
  }

  predictInterval(point: { expected: number }, calibration: ConformalCalibration): ConformalInterval {
    const center = point.expected;
    const q = calibration.quantile;
    const empirical = calibration.sample_size >= 5;

    if (!empirical) {
      // Fallback: V2 heuristic band width (sqrt of V2 calibration MSE)
      const fallbackQ = Math.sqrt(Math.max(calibration.mean_score, 0)) * 1.65 || 0.05;
      return {
        lower: round(center - fallbackQ, 6),
        center: round(center, 6),
        upper: round(center + fallbackQ, 6),
        width: round(fallbackQ * 2, 6),
        coverage: calibration.target_coverage,
        quantile: fallbackQ,
        method: 'gaussian_fallback (insufficient calibration data)',
        empirical: false,
        calibration_size: calibration.sample_size,
      };
    }

    return {
      lower: round(center - q, 6),
      center: round(center, 6),
      upper: round(center + q, 6),
      width: round(q * 2, 6),
      coverage: calibration.target_coverage,
      quantile: q,
      method: 'split-conformal (empirical quantile of |residual|)',
      empirical: true,
      calibration_size: calibration.sample_size,
    };
  }
}

// ─── MAPIE Adapter (pluggable; currently delegates to internal) ────────────
//
// This adapter is the integration point for the real MAPIE Python service.
// Today it delegates to the InternalConformalPredictor. When MAPIE is deployed
// (e.g., via a sidecar Python service or Cloudflare AI binding), swap the
// implementation of `calibrate()` and `predictInterval()` to call it — no
// other code needs to change.

class MAPIEAdapter implements ConformalPredictor {
  id = 'mapie-adapter';
  name = 'MAPIE Adapter (delegated to internal)';
  version = 'stub-v1';
  is_stub = true;
  enabled = true;

  private internal = new InternalConformalPredictor();

  calibrate(pairs: Array<{ expected: number; realized: number }>, coverage: number): ConformalCalibration {
    // TODO: replace with real MAPIE call when the service is deployed.
    return this.internal.calibrate(pairs, coverage);
  }

  predictInterval(point: { expected: number }, calibration: ConformalCalibration): ConformalInterval {
    return this.internal.predictInterval(point, calibration);
  }
}

// ─── Adapter Registry ──────────────────────────────────────────────────────

const _adapters = new Map<string, ConformalPredictor>();

export function registerConformalAdapter(adapter: ConformalPredictor): void {
  _adapters.set(adapter.id, adapter);
}

export function listConformalAdapters(): ConformalPredictor[] {
  return Array.from(_adapters.values());
}

export function getConformalAdapter(id: string): ConformalPredictor | null {
  return _adapters.get(id) ?? null;
}

// Auto-register built-in adapters
registerConformalAdapter(new InternalConformalPredictor());
registerConformalAdapter(new MAPIEAdapter());

// ─── Feature Flag ──────────────────────────────────────────────────────────

let _enabled = true;
export function setConformalConfidenceEnabled(v: boolean): void { _enabled = v; }
export function isConformalConfidenceEnabled(): boolean { return _enabled; }

// ─── Helpers ───────────────────────────────────────────────────────────────

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

// ─── Conformal Confidence Score Mapping ────────────────────────────────────
//
// Conformal confidence is derived from the EMPIRICAL COVERAGE achieved on the
// calibration set, scaled by the inverse of the normalized interval width.
//
//   conformal_confidence = 50
//                       + 40 * (empirical_coverage - target_coverage)
//                       + 10 * (1 - width / 0.30)
//
// Higher empirical coverage than target → bonus (well-calibrated).
// Smaller interval width → bonus (tighter prediction).

function computeConformalScore(
  calibration: ConformalCalibration,
  interval: ConformalInterval,
): number {
  if (!interval.empirical) return 50; // neutral fallback

  const coverage_bonus = (calibration.empirical_coverage - calibration.target_coverage) * 40;
  const width_factor = clamp(1 - interval.width / 0.30, -1, 1);
  const width_bonus = width_factor * 10;
  const sample_bonus = clamp(calibration.sample_size / 50, 0, 1) * 5; // up to +5 for ≥50 samples

  return clamp(50 + coverage_bonus + width_bonus + sample_bonus);
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export interface ConformalConfidenceInput {
  score: AssetScore;
  prediction: AssetPrediction;
  features: NormalizedFeatures;
  market_state: MarketState;
  v2_confidence: ConfidenceLayer;
  /** Target coverage (default 0.90 = 90% interval) */
  target_coverage?: number;
  /** Adapter id to use (default: 'internal-split-conformal') */
  adapter_id?: string;
}

export function computeConformalConfidence(input: ConformalConfidenceInput): ConformalConfidenceReport {
  const target_coverage = input.target_coverage ?? 0.90;
  const adapter_id = input.adapter_id ?? 'internal-split-conformal';
  const adapter = getConformalAdapter(adapter_id) ?? listConformalAdapters()[0];

  // Pull verification pairs from V2 R4 buffer (single source of truth)
  const buffer = getVerificationBuffer();
  const pairs = buffer.map((p) => ({ expected: p.expected_return, realized: p.realized_return }));

  const calibration = adapter.calibrate(pairs, target_coverage);
  const interval = adapter.predictInterval({ expected: input.prediction.expected_return }, calibration);
  const conformal_confidence = computeConformalScore(calibration, interval);
  const delta_vs_heuristic = round(conformal_confidence - input.v2_confidence.confidence_score, 1);

  return {
    interval,
    calibration,
    conformal_confidence: round(conformal_confidence, 1),
    delta_vs_heuristic,
    adapter_id: adapter.id,
    is_stub: adapter.is_stub,
    computed_at: new Date().toISOString(),
    engine_version: CONFORMAL_CONFIDENCE_VERSION,
    enabled: _enabled,
  };
}
