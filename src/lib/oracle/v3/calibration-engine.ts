// src/lib/oracle/v3/calibration-engine.ts
// ============================================================================
// I3 — PREDICTION CALIBRATION ENGINE (append-only)
// ============================================================================
// MISSION (per ORACLE_V3_INTELLIGENCE_LAYER spec, I3):
//   "El Oracle debe aprender si está sobreestimando o subestimando."
//
// METRICS:
//   - Reliability curve      : binned predicted vs realized (10 bins)
//   - Calibration error      : ECE (Expected Calibration Error)
//   - Brier score            : mean((predicted_prob - outcome)²)
//   - CRPS interface         : Continuous Ranked Probability Score (adapter)
//   - Rolling calibration    : ECE over rolling windows of N verifications
//   - Automatic bias         : signed bias (positive = over-predicts returns)
//
// DESIGN:
//   - Reads from V2 R4 verification buffer (single source of truth).
//   - Pure functions for all metrics.
//   - Pluggable CRPS adapter interface (swap in properscoring Python service).
//   - V2 R4 is NOT replaced — V3 I3 adds richer calibration diagnostics.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT modify V2 R4.
//   - Does NOT mutate the verification buffer.
// ============================================================================

import type { AssetPrediction } from '@/lib/single-pass-oracle-engine';
import type { ConfidenceLayer } from '@/lib/oracle/v2/confidence-engine';
import { getVerificationBuffer } from '@/lib/oracle/v2/forecast-verifier';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface ReliabilityBin {
  /** Bin index 0..9 */
  bin: number;
  /** Lower bound of predicted confidence in this bin (0..1) */
  lower: number;
  /** Upper bound (0..1) */
  upper: number;
  /** Number of predictions in this bin */
  count: number;
  /** Mean predicted confidence in this bin (0..1) */
  mean_predicted: number;
  /** Mean observed accuracy in this bin (0..1, fraction of correct direction) */
  mean_observed: number;
  /** Gap = mean_predicted - mean_observed (positive = OVERCONFIDENT) */
  gap: number;
}

export interface ReliabilityCurve {
  bins: ReliabilityBin[];
  /** Perfectly calibrated if ECE = 0 */
  ECE: number;  // Expected Calibration Error
  /** Maximum bin gap (worst-case miscalibration) */
  max_gap: number;
  /** Mean bin gap */
  mean_gap: number;
  /** Number of bins with sufficient samples (≥5) */
  populated_bins: number;
}

export interface CalibrationMetrics {
  /** Brier score: mean((predicted_prob - outcome)²) — lower is better */
  brier: number;
  /** CRPS (Continuous Ranked Probability Score) — lower is better */
  crps: number;
  /** ECE (Expected Calibration Error, 0..1) */
  ece: number;
  /** Signed bias: positive = OVER-predicting returns */
  bias: number;
  /** Mean absolute error */
  mae: number;
  /** Root mean squared error */
  rmse: number;
  /** Directional accuracy (0..1) */
  directional_accuracy: number;
}

export interface RollingCalibrationWindow {
  window_start: string;  // ISO timestamp
  window_end: string;
  sample_size: number;
  ece: number;
  bias: number;
  directional_accuracy: number;
}

export interface BiasEstimate {
  /** Estimated systematic bias (fractional return, positive = over-predicts) */
  bias: number;
  /** Standard error of the bias estimate */
  bias_std_error: number;
  /** 95% confidence interval for the bias */
  bias_ci95: { lower: number; upper: number };
  /** Recommended adjustment to apply to future predictions */
  recommended_adjustment: number;
  /** Confidence in the bias estimate (0..100) */
  confidence: number;
  /** Whether the bias is statistically significant */
  statistically_significant: boolean;
}

export interface CalibrationReport {
  reliability: ReliabilityCurve;
  metrics: CalibrationMetrics;
  rolling: RollingCalibrationWindow[];
  bias: BiasEstimate;
  /** Diagnosis: 'WELL_CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'BIASED' | 'INSUFFICIENT_DATA' */
  diagnosis: 'WELL_CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'BIASED' | 'INSUFFICIENT_DATA';
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
  /** Feature flag */
  enabled: boolean;
}

export const CALIBRATION_ENGINE_VERSION = 'calibration_engine_v3_i3';

// ─── CRPS Adapter Interface ────────────────────────────────────────────────

export interface CRPSAdapter {
  id: string;
  name: string;
  is_stub: boolean;
  /** Compute CRPS given a forecast and observation */
  compute(forecast: { expected: number; p5?: number; p95?: number }, observed: number): number;
}

class InternalCRPSAdapter implements CRPSAdapter {
  id = 'internal-crps';
  name = 'Internal CRPS (Gaussian approx)';
  is_stub = false;

  compute(forecast: { expected: number; p5?: number; p95?: number }, observed: number): number {
    // CRPS for a Gaussian distribution N(μ, σ):
    //   CRPS = σ * [z * (2Φ(z) - 1) + 2φ(z) - 1/√π]
    // where z = (observed - μ) / σ
    // If we only have p5/p95, estimate σ from the interval: σ ≈ (p95 - p5) / (2 * 1.65)
    let sigma: number;
    if (forecast.p5 !== undefined && forecast.p95 !== undefined) {
      sigma = (forecast.p95 - forecast.p5) / (2 * 1.65);
    } else {
      sigma = 0.05; // default 5% std dev
    }
    sigma = Math.max(sigma, 1e-6);

    const z = (observed - forecast.expected) / sigma;
    // Standard normal PDF and CDF approximations
    const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    const Phi = 0.5 * (1 + erf(z / Math.sqrt(2)));

    const crps = sigma * (z * (2 * Phi - 1) + 2 * phi - 1 / Math.sqrt(Math.PI));
    return crps;
  }
}

// Error function approximation (Abramowitz & Stegun 7.1.26)
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

const _crpsAdapters = new Map<string, CRPSAdapter>();
_crpsAdapters.set('internal-crps', new InternalCRPSAdapter());

export function registerCRPSAdapter(a: CRPSAdapter): void { _crpsAdapters.set(a.id, a); }
export function listCRPSAdapters(): CRPSAdapter[] { return Array.from(_crpsAdapters.values()); }
export function getCRPSAdapter(id: string): CRPSAdapter | null { return _crpsAdapters.get(id) ?? null; }

// ─── Feature Flag ──────────────────────────────────────────────────────────

let _enabled = true;
export function setCalibrationEngineEnabled(v: boolean): void { _enabled = v; }
export function isCalibrationEngineEnabled(): boolean { return _enabled; }

// ─── Helpers ───────────────────────────────────────────────────────────────

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function std(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / (nums.length - 1));
}

// ─── Reliability Curve ─────────────────────────────────────────────────────
//
// Bins predictions by V2 confidence_score (0..100, mapped to 0..1) into 10 bins.
// For each bin, computes the observed directional accuracy.
// A perfectly calibrated model has mean_predicted ≈ mean_observed in every bin.

function computeReliabilityCurve(
  pairs: Array<{
    expected: number;
    realized: number;
    confidence: number; // 0..100
  }>,
): ReliabilityCurve {
  const NUM_BINS = 10;
  const bins: ReliabilityBin[] = [];

  for (let i = 0; i < NUM_BINS; i++) {
    const lower = i / NUM_BINS;
    const upper = (i + 1) / NUM_BINS;
    const inBin = pairs.filter((p) => {
      const c = p.confidence / 100;
      return c >= lower && (i === NUM_BINS - 1 ? c <= upper : c < upper);
    });
    const count = inBin.length;
    const mean_predicted = count > 0 ? mean(inBin.map((p) => p.confidence / 100)) : 0;
    // Observed "accuracy" = fraction of correct direction
    const correct = inBin.filter((p) => Math.sign(p.expected) === Math.sign(p.realized)).length;
    const mean_observed = count > 0 ? correct / count : 0;
    bins.push({
      bin: i,
      lower: round(lower, 2),
      upper: round(upper, 2),
      count,
      mean_predicted: round(mean_predicted, 4),
      mean_observed: round(mean_observed, 4),
      gap: round(mean_predicted - mean_observed, 4),
    });
  }

  // ECE = Σ (n_bin / N) * |gap_bin|
  const N = pairs.length;
  const ece = N > 0
    ? bins.reduce((s, b) => s + (b.count / N) * Math.abs(b.gap), 0)
    : 0;

  const populated = bins.filter((b) => b.count >= 5);
  const max_gap = populated.length > 0 ? Math.max(...populated.map((b) => Math.abs(b.gap))) : 0;
  const mean_gap = populated.length > 0 ? mean(populated.map((b) => Math.abs(b.gap))) : 0;

  return {
    bins,
    ECE: round(ece, 4),
    max_gap: round(max_gap, 4),
    mean_gap: round(mean_gap, 4),
    populated_bins: populated.length,
  };
}

// ─── Calibration Metrics ───────────────────────────────────────────────────

function computeCalibrationMetrics(
  pairs: Array<{ expected: number; realized: number; confidence: number }>,
  crpsAdapter: CRPSAdapter,
): CalibrationMetrics {
  if (pairs.length === 0) {
    return {
      brier: 0,
      crps: 0,
      ece: 0,
      bias: 0,
      mae: 0,
      rmse: 0,
      directional_accuracy: 0.5,
    };
  }

  // Brier: treat (confidence/100) as predicted probability of "positive return"
  // Outcome = 1 if realized > 0 else 0
  const brierScores = pairs.map((p) => {
    const pred_prob = p.confidence / 100;
    const outcome = p.realized > 0 ? 1 : 0;
    return (pred_prob - outcome) ** 2;
  });
  const brier = mean(brierScores);

  // CRPS — using each forecast's expected return and V2 confidence-derived sigma
  const crpsScores = pairs.map((p) => {
    const sigma = Math.max(0.02, (1 - p.confidence / 100) * 0.10);
    return crpsAdapter.compute(
      { expected: p.expected, p5: p.expected - 1.65 * sigma, p95: p.expected + 1.65 * sigma },
      p.realized,
    );
  });
  const crps = mean(crpsScores);

  const errors = pairs.map((p) => p.expected - p.realized);
  const bias = mean(errors);
  const mae = mean(errors.map(Math.abs));
  const rmse = Math.sqrt(mean(errors.map((e) => e * e)));
  const directional = pairs.filter((p) => Math.sign(p.expected) === Math.sign(p.realized)).length / pairs.length;

  return {
    brier: round(brier, 6),
    crps: round(crps, 6),
    ece: 0, // filled by caller from reliability curve
    bias: round(bias, 6),
    mae: round(mae, 6),
    rmse: round(rmse, 6),
    directional_accuracy: round(directional, 4),
  };
}

// ─── Rolling Calibration ───────────────────────────────────────────────────
//
// Computes ECE + bias + directional accuracy over rolling windows of size W.
// Default: 4 windows of size = N/4 (quartiles).

function computeRollingCalibration(
  pairs: Array<{ expected: number; realized: number; confidence: number; timestamp: string }>,
): RollingCalibrationWindow[] {
  if (pairs.length < 8) return [];

  const NUM_WINDOWS = Math.min(4, Math.floor(pairs.length / 4));
  const windowSize = Math.floor(pairs.length / NUM_WINDOWS);
  const windows: RollingCalibrationWindow[] = [];

  for (let i = 0; i < NUM_WINDOWS; i++) {
    const start = i * windowSize;
    const end = i === NUM_WINDOWS - 1 ? pairs.length : start + windowSize;
    const slice = pairs.slice(start, end);
    if (slice.length === 0) continue;

    const curve = computeReliabilityCurve(slice);
    const bias = mean(slice.map((p) => p.expected - p.realized));
    const dir = slice.filter((p) => Math.sign(p.expected) === Math.sign(p.realized)).length / slice.length;

    windows.push({
      window_start: slice[0].timestamp,
      window_end: slice[slice.length - 1].timestamp,
      sample_size: slice.length,
      ece: curve.ECE,
      bias: round(bias, 6),
      directional_accuracy: round(dir, 4),
    });
  }

  return windows;
}

// ─── Automatic Bias Estimation ─────────────────────────────────────────────
//
// Computes the systematic bias and its 95% CI using the t-distribution.
// Recommended adjustment = -bias (apply opposite correction).

function computeBiasEstimate(pairs: Array<{ expected: number; realized: number }>): BiasEstimate {
  if (pairs.length < 5) {
    return {
      bias: 0,
      bias_std_error: 0,
      bias_ci95: { lower: 0, upper: 0 },
      recommended_adjustment: 0,
      confidence: 0,
      statistically_significant: false,
    };
  }

  const errors = pairs.map((p) => p.expected - p.realized);
  const bias = mean(errors);
  const sigma = std(errors);
  const n = errors.length;
  const se = sigma / Math.sqrt(n);
  // 95% CI using normal approx (for n≥30) or t(0.975, n-1) approx (≈2 for small n)
  const z = n >= 30 ? 1.96 : 2.0; // conservative
  const lower = bias - z * se;
  const upper = bias + z * se;

  // Statistical significance: |bias| > 2*SE
  const statistically_significant = Math.abs(bias) > 2 * se;

  // Confidence in the estimate (0..100): more samples + smaller CI → higher confidence
  const ciWidth = upper - lower;
  const confidence = Math.min(100, Math.max(0, 100 - ciWidth * 1000));

  return {
    bias: round(bias, 6),
    bias_std_error: round(se, 6),
    bias_ci95: { lower: round(lower, 6), upper: round(upper, 6) },
    recommended_adjustment: round(-bias, 6),
    confidence: round(confidence, 1),
    statistically_significant,
  };
}

// ─── Diagnosis ─────────────────────────────────────────────────────────────

function diagnose(
  reliability: ReliabilityCurve,
  bias: BiasEstimate,
  sampleSize: number,
): CalibrationReport['diagnosis'] {
  if (sampleSize < 10) return 'INSUFFICIENT_DATA';

  if (bias.statistically_significant && Math.abs(bias.bias) > 0.005) {
    return 'BIASED';
  }

  if (reliability.ECE < 0.05) return 'WELL_CALIBRATED';

  // OVERCONFIDENT: predicted confidence > observed accuracy (gap > 0 in most bins)
  const overconfidentBins = reliability.bins.filter((b) => b.count >= 5 && b.gap > 0.05).length;
  const underconfidentBins = reliability.bins.filter((b) => b.count >= 5 && b.gap < -0.05).length;

  if (overconfidentBins > underconfidentBins) return 'OVERCONFIDENT';
  if (underconfidentBins > overconfidentBins) return 'UNDERCONFIDENT';
  return 'WELL_CALIBRATED';
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export interface CalibrationEngineInput {
  prediction: AssetPrediction;
  v2_confidence: ConfidenceLayer;
  /** Adapter id for CRPS (default: 'internal-crps') */
  crps_adapter_id?: string;
}

export function computeCalibration(input: CalibrationEngineInput): CalibrationReport {
  const crpsAdapter = getCRPSAdapter(input.crps_adapter_id ?? 'internal-crps') ?? listCRPSAdapters()[0];

  // Pull verification pairs from V2 R4 buffer
  const buffer = getVerificationBuffer();
  // Note: V2 buffer doesn't store confidence; we approximate using V2 R4's Calibration metric
  // For a real implementation, we'd extend the buffer to store per-pair confidence.
  // Here we use the prediction's confidence as a proxy.
  const pairs = buffer.map((p) => ({
    expected: p.expected_return,
    realized: p.realized_return,
    confidence: input.v2_confidence.confidence_score,
    timestamp: p.timestamp,
  }));

  const reliability = computeReliabilityCurve(pairs);
  const metrics = computeCalibrationMetrics(pairs, crpsAdapter);
  metrics.ece = reliability.ECE;

  const rolling = computeRollingCalibration(pairs);
  const biasEstimate = computeBiasEstimate(pairs);
  const diagnosis = diagnose(reliability, biasEstimate, pairs.length);

  return {
    reliability,
    metrics,
    rolling,
    bias: biasEstimate,
    diagnosis,
    computed_at: new Date().toISOString(),
    engine_version: CALIBRATION_ENGINE_VERSION,
    enabled: _enabled,
  };
}
