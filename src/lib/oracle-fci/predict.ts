// src/lib/oracle-fci/predict.ts
// Ensemble prediction engine — linear_regression + ewma + momentum + bayesian_trend
// Guard: confidence_required = 0.65; never invent returns; null when history insufficient.

import { FundPrediction, NormalizedFund } from './types';
import { VcpSeries } from './storage';

const CONFIDENCE_REQUIRED = 0.65;
const MIN_HISTORY_DAYS_7D = 9;   // need ~7 trading days + buffer
const MIN_HISTORY_DAYS_30D = 31;
const MIN_HISTORY_DAYS_90D = 60; // 60+ for any reasonable 90d projection

/** Linear regression on VCP series (x = day index, y = vcp) */
function linearRegression(
  points: Array<{ x: number; y: number }>,
): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const sumY2 = points.reduce((s, p) => s + p.y * p.y, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  // R²
  const meanY = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

/** EWMA forecast — weighted recent values, project slope forward */
function ewmaForecast(values: number[], horizon: number): { expected: number; confidence: number } {
  if (values.length < 3) return { expected: 0, confidence: 0 };
  const alpha = 0.3;
  let prev = values[0];
  const ewmas: number[] = [prev];
  for (let i = 1; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    ewmas.push(prev);
  }
  // Local slope = mean of last 3 deltas
  const last3 = ewmas.slice(-4);
  const deltas: number[] = [];
  for (let i = 1; i < last3.length; i++) {
    deltas.push(last3[i] - last3[i - 1]);
  }
  const slope = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const last = ewmas[ewmas.length - 1];
  const expectedAbs = last + slope * horizon;
  const expected = last > 0 ? (expectedAbs - last) / last : 0;
  // Confidence based on slope consistency (low variance of deltas = high confidence)
  const meanDelta = deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1);
  const variance =
    deltas.reduce((s, d) => s + (d - meanDelta) ** 2, 0) / (deltas.length || 1);
  const stdDev = Math.sqrt(variance);
  const consistency = meanDelta !== 0 ? Math.max(0, 1 - stdDev / Math.abs(meanDelta)) : 0;
  const sampleConfidence = Math.min(1, values.length / 30);
  const confidence = consistency * sampleConfidence;
  return { expected, confidence };
}

/** Momentum model — simple rate of change over N days, annualized assumption disabled */
function momentumForecast(values: number[], horizonDays: number): { expected: number; confidence: number } {
  if (values.length < 3) return { expected: 0, confidence: 0 };
  const last = values[values.length - 1];
  // Look back `horizonDays` trading days (~5/7 of calendar). Use min available.
  const lookback = Math.min(horizonDays, values.length - 1);
  const past = values[values.length - 1 - lookback];
  if (past <= 0) return { expected: 0, confidence: 0 };
  const roc = (last - past) / past;
  // Project linearly: if `roc` over `lookback` days, then over `horizonDays` days
  // (assumes momentum persists — risky, hence lower confidence)
  const projected = roc * (horizonDays / lookback);
  // Confidence decays with horizon
  const horizonPenalty = Math.max(0, 1 - (horizonDays - 7) / 90);
  const sampleConfidence = Math.min(1, values.length / 30);
  const confidence = 0.6 * horizonPenalty * sampleConfidence;
  return { expected: projected, confidence };
}

/** Bayesian trend — combine linear-regression prior with momentum evidence */
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
  // Linear projection (% of last)
  const linearAbs = linear.slope * horizon;
  const linearPct = linearAbs / last;

  // Combine linear (prior weight) + momentum (evidence weight)
  const linearWeight = 0.5 * Math.max(0, linear.r2); // weight by fit quality
  const momentumWeight = 0.5 * momentum.confidence;
  const totalWeight = linearWeight + momentumWeight;
  const combined =
    totalWeight > 0
      ? (linearPct * linearWeight + momentum.expected * momentumWeight) / totalWeight
      : 0;

  // Beta(α, β) for bull/bear probability — α = #up days, β = #down days in last 14
  const recent = values.slice(-14);
  let ups = 0;
  let downs = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) ups++;
    else if (recent[i] < recent[i - 1]) downs++;
  }
  // Add prior of 1 to each (Laplace smoothing)
  const alpha = ups + 1;
  const beta = downs + 1;
  const total = alpha + beta;
  const bullProb = alpha / total;
  const bearProb = beta / total;

  // Confidence = combined model agreement + sample size
  const sampleConfidence = Math.min(1, values.length / 30);
  const agreementConfidence = 1 - Math.abs(linearPct - momentum.expected) / (Math.abs(linearPct) + Math.abs(momentum.expected) + 0.001);
  const confidence = sampleConfidence * agreementConfidence * 0.8;

  return {
    expected: combined,
    bullProb,
    bearProb,
    confidence,
  };
}

/** Volatility score — std dev of daily returns, normalized */
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
  // Normalize: typical FCI daily std is 0.001-0.02; map [0, 0.03] → [0, 1]
  return Math.min(1, std / 0.03);
}

/**
 * Generate prediction for a single fund given its VCP series.
 * Returns null if confidence < threshold (guard against hallucinated returns).
 */
export function predictFund(series: VcpSeries | undefined): FundPrediction | null {
  if (!series || series.series.length < MIN_HISTORY_DAYS_7D) {
    return null;
  }

  // Build numeric series (x = day index from 0, y = vcp)
  const sorted = [...series.series].sort((a, b) => a.date.localeCompare(b.date));
  const points = sorted.map((s, i) => ({ x: i, y: s.vcp }));
  const values = sorted.map((s) => s.vcp);

  // Run all 4 models
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

  // Ensemble: weighted average of model expectations per horizon
  // Weights: linear (only if r2 > 0.3), ewma, momentum, bayesian
  const weights7 = {
    linear: linear.r2 > 0.3 ? 0.25 : 0,
    ewma: 0.25,
    momentum: 0.20,
    bayesian: 0.30,
  };
  const totalW7 = weights7.linear + weights7.ewma + weights7.momentum + weights7.bayesian;
  const expected7 = totalW7 > 0
    ? (linear.slope * 7 / (values[values.length - 1] || 1) * weights7.linear
        + ewma7.expected * weights7.ewma
        + mom7.expected * weights7.momentum
        + bayes7.expected * weights7.bayesian) / totalW7
    : null;

  const totalW30 = 0.25 + 0.25 + 0.20 + 0.30;
  const expected30 = (ewma30.expected * 0.25 + mom30.expected * 0.20 + bayes30.expected * 0.30
    + (linear.r2 > 0.3 ? linear.slope * 30 / (values[values.length - 1] || 1) * 0.25 : 0)) / totalW30;

  const totalW90 = 0.20 + 0.25 + 0.20 + 0.35;
  const expected90 = (ewma90.expected * 0.25 + mom90.expected * 0.20 + bayes90.expected * 0.35
    + (linear.r2 > 0.3 ? linear.slope * 90 / (values[values.length - 1] || 1) * 0.20 : 0)) / totalW90;

  // Aggregate confidence — use 30d as primary (most actionable)
  const confidence = bayes30.confidence;

  // Bull/bear prob — use 30d bayesian
  const bullProb = bayes30.bullProb;
  const bearProb = bayes30.bearProb;

  // Volatility score
  const volScore = volatilityScore(values);

  // GUARD: don't emit predictions below confidence threshold
  if (confidence < CONFIDENCE_REQUIRED) {
    return null;
  }

  // Also require minimum history for 30d/90d windows
  return {
    expected_return_7d: expected7,
    expected_return_30d: values.length >= MIN_HISTORY_DAYS_30D ? expected30 : null,
    expected_return_90d: values.length >= MIN_HISTORY_DAYS_90D ? expected90 : null,
    confidence,
    bull_probability: bullProb,
    bear_probability: bearProb,
    volatility_score: volScore,
    models_used: ['linear_regression', 'ewma', 'momentum', 'bayesian_trend'],
  };
}
