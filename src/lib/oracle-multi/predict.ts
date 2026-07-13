// src/lib/oracle-multi/predict.ts
// Ensemble prediction engine for V4 multi-asset Oracle.
// Models: linear_regression + ewma + momentum + bayesian_trend, combined as ensemble.
// Guard: confidence_required = 0.65; never invent returns; null when history insufficient.
// Guard: forbid_hallucinated_returns — all predictions derive strictly from observed prices.

import type { AssetPrediction, PricePoint } from './types';
import { CONFIDENCE_THRESHOLD, MIN_HISTORY_DAYS } from './types';

const MIN_HISTORY_DAYS_30D = 31;
const MIN_HISTORY_DAYS_90D = 60;

// ─── Model 1: Linear regression (OLS) ────────────────────────────────────────

function linearRegression(
  points: Array<{ x: number; y: number }>,
): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

// ─── Model 2: EWMA forecast ──────────────────────────────────────────────────

function ewmaForecast(
  values: number[],
  horizon: number,
): { expected: number; confidence: number } {
  if (values.length < 3) return { expected: 0, confidence: 0 };
  const alpha = 0.3;
  let prev = values[0];
  const ewmas: number[] = [prev];
  for (let i = 1; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    ewmas.push(prev);
  }
  const last3 = ewmas.slice(-4);
  const deltas: number[] = [];
  for (let i = 1; i < last3.length; i++) {
    deltas.push(last3[i] - last3[i - 1]);
  }
  const slope = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const last = ewmas[ewmas.length - 1];
  const expectedAbs = last + slope * horizon;
  const expected = last > 0 ? (expectedAbs - last) / last : 0;
  const meanDelta = deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1);
  const variance = deltas.reduce((s, d) => s + (d - meanDelta) ** 2, 0) / (deltas.length || 1);
  const stdDev = Math.sqrt(variance);
  const consistency = meanDelta !== 0 ? Math.max(0, 1 - stdDev / Math.abs(meanDelta)) : 0;
  const sampleConfidence = Math.min(1, values.length / 30);
  const confidence = consistency * sampleConfidence;
  return { expected, confidence };
}

// ─── Model 3: Momentum (rate of change) ──────────────────────────────────────

function momentumForecast(
  values: number[],
  horizonDays: number,
): { expected: number; confidence: number } {
  if (values.length < 3) return { expected: 0, confidence: 0 };
  const last = values[values.length - 1];
  const lookback = Math.min(horizonDays, values.length - 1);
  const past = values[values.length - 1 - lookback];
  if (past <= 0) return { expected: 0, confidence: 0 };
  const roc = (last - past) / past;
  const projected = roc * (horizonDays / lookback);
  const horizonPenalty = Math.max(0, 1 - (horizonDays - 7) / 90);
  const sampleConfidence = Math.min(1, values.length / 30);
  const confidence = 0.6 * horizonPenalty * sampleConfidence;
  return { expected: projected, confidence };
}

// ─── Model 4: Bayesian trend (combine linear prior + momentum evidence) ─────

function bayesianTrend(
  linear: { slope: number; r2: number },
  momentum: { expected: number; confidence: number },
  values: number[],
  horizon: number,
): { expected: number; bullProb: number; bearProb: number; confidence: number } {
  if (values.length < 5) {
    return { expected: 0, bullProb: 0.5, bearProb: 0.5, confidence: 0 };
  }
  const last = values[values.length - 1];
  if (last <= 0) {
    return { expected: 0, bullProb: 0.5, bearProb: 0.5, confidence: 0 };
  }
  const linearAbs = linear.slope * horizon;
  const linearPct = linearAbs / last;
  const linearWeight = 0.5 * Math.max(0, linear.r2);
  const momentumWeight = 0.5 * momentum.confidence;
  const totalWeight = linearWeight + momentumWeight;
  const combined =
    totalWeight > 0
      ? (linearPct * linearWeight + momentum.expected * momentumWeight) / totalWeight
      : 0;
  const recent = values.slice(-14);
  let ups = 0;
  let downs = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) ups++;
    else if (recent[i] < recent[i - 1]) downs++;
  }
  const alpha = ups + 1;
  const beta = downs + 1;
  const total = alpha + beta;
  const bullProb = alpha / total;
  const bearProb = beta / total;
  const sampleConfidence = Math.min(1, values.length / 30);
  const agreementConfidence =
    1 - Math.abs(linearPct - momentum.expected) / (Math.abs(linearPct) + Math.abs(momentum.expected) + 0.001);
  const confidence = sampleConfidence * agreementConfidence * 0.8;
  return { expected: combined, bullProb, bearProb, confidence };
}

// ─── Volatility score ────────────────────────────────────────────────────────

function volatilityScore(values: number[]): number {
  if (values.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) {
      returns.push((values[i] - values[i - 1]) / values[i - 1]);
    }
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  // Normalize: typical daily std for stocks ~0.01-0.03; FCI ~0.001-0.01; map [0, 0.04] → [0, 1]
  return Math.min(1, std / 0.04);
}

/**
 * Generate ensemble prediction for an asset given its price series.
 * Returns null if:
 *   - series length < MIN_HISTORY_DAYS (9)
 *   - aggregate confidence < CONFIDENCE_THRESHOLD (0.65)
 *
 * Returns a "tombstone" prediction (confidence=0, data_quality='insufficient') if:
 *   - series is empty / undefined
 *   - all points have invalid price (null/NaN/<=0) after filtering
 *
 * GUARD: forbid_hallucinated_returns — never returns a non-null prediction with null
 * expected_return fields. If insufficient history for 30d/90d, those fields are null
 * but the 7d must be present.
 *
 * FASE_0.5_HARDEN_NULL_PRICE (2026-07-03):
 *   Filter out points with invalid `price` (null/NaN/<=0) BEFORE any numeric op.
 *   Without this, the OLS regression would receive NaN y-values, EWMA would
 *   smooth NaN into NaN forever, momentumForecast would do `(last - NaN) / NaN`
 *   = NaN, and bayesianTrend would compute NaN weights. The ensemble would
 *   then return a NaN confidence that silently slips past the
 *   `confidence < CONFIDENCE_THRESHOLD` guard (NaN < 0.65 is false) and reaches
 *   the rankings as a "high-confidence" NaN prediction — catastrophic.
 *
 *   The tombstone case lets downstream code distinguish "no prediction
 *   available, data was bad" (data_quality='insufficient') from "no prediction
 *   available, history too short" (returns null) — both are non-fatal, but the
 *   distinction matters for telemetry and UI.
 */
export function predictAsset(series: PricePoint[] | undefined): AssetPrediction | null {
  // FASE_0.5: extreme case — empty series → tombstone (confidence=0, data_quality='insufficient')
  if (!series || series.length === 0) {
    return {
      expected_return_7d: null,
      expected_return_30d: null,
      expected_return_90d: null,
      confidence: 0,
      bull_probability: 0.5,
      bear_probability: 0.5,
      volatility_score: 0,
      trend_strength: 0,
      models_used: [],
      data_quality: 'insufficient',
    };
  }

  // FASE_0_LOCALECOMPARE_NULL_GUARD + FASE_0.5_HARDEN_NULL_PRICE — null-safe filter on date AND price
  const filtered = series.filter(
    (p) =>
      p &&
      typeof p.date === 'string' &&
      p.date.length > 0 &&
      typeof p.price === 'number' &&
      isFinite(p.price) &&
      p.price > 0,
  );

  // FASE_0.5: all points had invalid price → tombstone
  if (filtered.length === 0) {
    return {
      expected_return_7d: null,
      expected_return_30d: null,
      expected_return_90d: null,
      confidence: 0,
      bull_probability: 0.5,
      bear_probability: 0.5,
      volatility_score: 0,
      trend_strength: 0,
      models_used: [],
      data_quality: 'insufficient',
    };
  }

  // Existing behavior: insufficient history (after filter) → null
  if (filtered.length < MIN_HISTORY_DAYS) {
    return null;
  }

  // Sort filtered points ascending by date (null-safe comparator)
  const sorted = [...filtered].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const points = sorted.map((s, i) => ({ x: i, y: s.price }));
  const values = sorted.map((s) => s.price);

  // Run all 4 models for each horizon
  const linear = linearRegression(points);
  const ewma7 = ewmaForecast(values, 7);
  const ewma30 = ewmaForecast(values, 30);
  const ewma90 = ewmaForecast(values, 90);
  const mom7 = momentumForecast(values, 7);
  const mom30 = momentumForecast(values, 30);
  const mom90 = momentumForecast(values, 90);
  const bayes7 = bayesianTrend(linear, mom7, values, 7);
  const bayes30 = bayesianTrend(linear, mom30, values, 30);
  const bayes90 = bayesianTrend(linear, mom90, values, 90);

  // Ensemble weights per horizon
  // linear (only if r2 > 0.3) | ewma | momentum | bayesian
  const wLinear = linear.r2 > 0.3 ? 0.25 : 0;
  const wTotal7 = wLinear + 0.25 + 0.20 + 0.30;
  const expected7 = wTotal7 > 0
    ? (linear.slope * 7 / (values[values.length - 1] || 1) * wLinear
        + ewma7.expected * 0.25
        + mom7.expected * 0.20
        + bayes7.expected * 0.30) / wTotal7
    : null;

  const wTotal30 = wLinear + 0.25 + 0.20 + 0.30;
  const expected30 = wTotal30 > 0
    ? (linear.slope * 30 / (values[values.length - 1] || 1) * wLinear
        + ewma30.expected * 0.25
        + mom30.expected * 0.20
        + bayes30.expected * 0.30) / wTotal30
    : null;

  const wTotal90 = wLinear + 0.20 + 0.25 + 0.35; // longer horizon: weight bayesian more
  const expected90 = wTotal90 > 0
    ? (linear.slope * 90 / (values[values.length - 1] || 1) * (linear.r2 > 0.3 ? 0.20 : 0)
        + ewma90.expected * 0.25
        + mom90.expected * 0.20
        + bayes90.expected * 0.35) / wTotal90
    : null;

  const confidence = bayes30.confidence;
  const bullProb = bayes30.bullProb;
  const bearProb = bayes30.bearProb;
  const volScore = volatilityScore(values);

  // GUARD: confidence threshold
  if (confidence < CONFIDENCE_THRESHOLD) {
    return null;
  }

  // 30d/90d require more history
  return {
    expected_return_7d: expected7,
    expected_return_30d: values.length >= MIN_HISTORY_DAYS_30D ? expected30 : null,
    expected_return_90d: values.length >= MIN_HISTORY_DAYS_90D ? expected90 : null,
    confidence,
    bull_probability: bullProb,
    bear_probability: bearProb,
    volatility_score: volScore,
    trend_strength: Math.max(0, Math.min(1, linear.r2)),
    models_used: ['linear_regression', 'ewma', 'momentum', 'bayesian_trend', 'ensemble'],
  };
}
