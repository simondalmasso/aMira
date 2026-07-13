// src/lib/oracle/v2/forecast-verifier.ts
// ============================================================================
// R4 — FORECAST VERIFICATION ENGINE (append-only, complements existing lifecycle)
// ============================================================================
// MISSION (per ORACLE_V2_SYSTEMIC_ROBUSTNESS spec, R4):
//   "Cerrar completamente el ciclo predicción → outcome → aprendizaje."
//
// METRICS:
//   MAE                 — Mean Absolute Error (fractional returns)
//   RMSE                — Root Mean Squared Error
//   MAPE                — Mean Absolute Percentage Error (%)
//   HitRate             — Directional accuracy (0..1)
//   Calibration         — Brier-like score (0..1, lower is better)
//   DirectionalAccuracy — Same as HitRate but expressed 0..100
//
// DESIGN:
//   - Does NOT replace amira-prediction-lifecycle.ts (existing verification).
//   - Wraps getLifecycleSnapshot() and DERIVES the 6 spec metrics from it.
//   - The lifecycle remains the SINGLE source of truth for verification events.
//   - This module only adds the missing metrics (RMSE, MAPE, Calibration)
//     and provides a unified institutional verification report.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT introduce a parallel verification pipeline.
//   - Does NOT create a new global state.
// ============================================================================

import { getLifecycleSnapshot } from '@/lib/amira-prediction-lifecycle';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface ForecastVerificationReport {
  /** Total verified predictions */
  total_verifications: number;
  /** Mean Absolute Error (fractional, e.g. 0.012 = 1.2%) */
  MAE: number;
  /** Root Mean Squared Error (fractional) */
  RMSE: number;
  /** Mean Absolute Percentage Error (%) — undefined if expected_return is 0 */
  MAPE: number | null;
  /** Hit rate (directional accuracy, 0..1) */
  HitRate: number;
  /** Directional accuracy expressed 0..100 */
  DirectionalAccuracy: number;
  /** Brier-like calibration score (0..1, lower is better) */
  Calibration: number;
  /** Mean expected return (across all verified predictions) */
  mean_expected_return: number;
  /** Mean realized return */
  mean_realized_return: number;
  /** Bias = mean(expected - realized) — positive = model over-predicts */
  bias: number;
  /** Verification window (last N predictions used) */
  window_size: number;
  /** ISO-8601 timestamp */
  computed_at: string;
  /** Verifier version */
  verifier_version: string;
}

export const FORECAST_VERIFIER_VERSION = 'forecast_verifier_v2_r4';

// ─── Internal: extract verification pairs from lifecycle ───────────────────
//
// The lifecycle snapshot stores rolling metrics (MAE, brier, directional %,
// total verifications) but does NOT expose the raw (expected, realized) pairs.
// We approximate the missing metrics (RMSE, MAPE, bias) using a memory of the
// last N verifications kept in this module (append-only ring buffer).
//
// NOTE: This is a SIDE-EFFECT-FREE read from the lifecycle; the buffer is
// filled lazily by registerVerificationPair() which the orchestrator calls
// when a new verification event fires. This avoids duplicating the lifecycle's
// persistence layer.

interface VerificationPair {
  prediction_id: string;
  expected_return: number;
  realized_return: number;
  timestamp: string;
}

const MAX_PAIRS_BUFFER = 200;
let _pairsBuffer: VerificationPair[] = [];

export function registerVerificationPair(pair: VerificationPair): void {
  _pairsBuffer.push(pair);
  if (_pairsBuffer.length > MAX_PAIRS_BUFFER) _pairsBuffer.shift();
}

export function clearVerificationBuffer(): void {
  _pairsBuffer = [];
}

export function getVerificationBuffer(): VerificationPair[] {
  return [..._pairsBuffer];
}

// ─── Metric Implementations ────────────────────────────────────────────────

function computeMAE(pairs: VerificationPair[]): number {
  if (pairs.length === 0) return 0;
  const sum = pairs.reduce((s, p) => s + Math.abs(p.expected_return - p.realized_return), 0);
  return sum / pairs.length;
}

function computeRMSE(pairs: VerificationPair[]): number {
  if (pairs.length === 0) return 0;
  const sumSq = pairs.reduce((s, p) => s + (p.expected_return - p.realized_return) ** 2, 0);
  return Math.sqrt(sumSq / pairs.length);
}

function computeMAPE(pairs: VerificationPair[]): number | null {
  // MAPE only meaningful when expected_return is non-zero
  const valid = pairs.filter((p) => Math.abs(p.expected_return) > 1e-6);
  if (valid.length === 0) return null;
  const sumPct = valid.reduce(
    (s, p) => s + Math.abs((p.expected_return - p.realized_return) / p.expected_return),
    0,
  );
  return (sumPct / valid.length) * 100; // as percentage
}

function computeHitRate(pairs: VerificationPair[]): number {
  if (pairs.length === 0) return 0.5;
  const hits = pairs.filter((p) =>
    Math.sign(p.expected_return) === Math.sign(p.realized_return)
  ).length;
  return hits / pairs.length;
}

function computeCalibration(pairs: VerificationPair[]): number {
  // Brier-like score: average of (expected_return - realized_return)^2
  // (in fractional return units, e.g. 0.0004 = 4 basis points MSE)
  if (pairs.length === 0) return 0;
  const sumSq = pairs.reduce((s, p) => s + (p.expected_return - p.realized_return) ** 2, 0);
  return sumSq / pairs.length;
}

function computeBias(pairs: VerificationPair[]): number {
  if (pairs.length === 0) return 0;
  const sum = pairs.reduce((s, p) => s + (p.expected_return - p.realized_return), 0);
  return sum / pairs.length;
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export function computeForecastVerification(): ForecastVerificationReport {
  // Pull rolling metrics from the canonical lifecycle (single source of truth)
  const snap = getLifecycleSnapshot();
  const total = snap.log_size_verifications;
  const verificationScore = snap.verification_score;

  // Use the local pairs buffer for the metrics the lifecycle doesn't expose
  const pairs = _pairsBuffer;
  const window_size = pairs.length;

  const MAE = window_size > 0 ? computeMAE(pairs) : verificationScore.mae;
  const RMSE = window_size > 0 ? computeRMSE(pairs) : verificationScore.mae * Math.SQRT2; // fallback estimate
  const MAPE = window_size > 0 ? computeMAPE(pairs) : null;
  const HitRate = window_size > 0 ? computeHitRate(pairs) : verificationScore.directional_accuracy_pct / 100;
  const Calibration = window_size > 0 ? computeCalibration(pairs) : verificationScore.brier_like;

  const mean_expected_return = window_size > 0
    ? pairs.reduce((s, p) => s + p.expected_return, 0) / window_size
    : 0;
  const mean_realized_return = window_size > 0
    ? pairs.reduce((s, p) => s + p.realized_return, 0) / window_size
    : 0;
  const bias = window_size > 0 ? computeBias(pairs) : 0;

  return {
    total_verifications: total,
    MAE: Math.round(MAE * 1e6) / 1e6,
    RMSE: Math.round(RMSE * 1e6) / 1e6,
    MAPE: MAPE === null ? null : Math.round(MAPE * 100) / 100,
    HitRate: Math.round(HitRate * 1000) / 1000,
    DirectionalAccuracy: Math.round(HitRate * 1000) / 10,
    Calibration: Math.round(Calibration * 1e6) / 1e6,
    mean_expected_return: Math.round(mean_expected_return * 1e6) / 1e6,
    mean_realized_return: Math.round(mean_realized_return * 1e6) / 1e6,
    bias: Math.round(bias * 1e6) / 1e6,
    window_size,
    computed_at: new Date().toISOString(),
    verifier_version: FORECAST_VERIFIER_VERSION,
  };
}
