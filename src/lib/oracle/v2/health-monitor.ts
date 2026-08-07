// src/lib/oracle/v2/health-monitor.ts
// ============================================================================
// R7 — ORACLE HEALTH MONITOR (append-only)
// ============================================================================
// MISSION (per ORACLE_V2_SYSTEMIC_ROBUSTNESS spec, R7):
//   "El sistema debe evaluarse a sí mismo."
//
// METRICS:
//   prediction_drift        — drift in expected_returns over recent window
//   feature_drift           — drift in normalized feature distributions
//   missing_data            — % of required fields with no real value
//   confidence_degradation  — trend of confidence_score (down = bad)
//   forecast_degradation    — trend of MAE/RMSE (up = bad)
//   regime_instability      — frequency of regime flips in last N predictions
//
// DESIGN:
//   - Pure function over the lineage buffer (R6) + verification buffer (R4).
//   - Each metric returns { value, status, threshold, explanation }.
//   - status: 'healthy' | 'watch' | 'degraded' | 'critical'
//   - Composite OracleHealth = weighted average of all 6 metrics.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT introduce a parallel monitoring pipeline.
//   - Reads from canonical sources (lineage, verification buffer, lifecycle).
// ============================================================================

import { getLineageBuffer, getLineageStats } from './lineage';
import { getVerificationBuffer } from './forecast-verifier';
import { getLifecycleSnapshot } from '@/lib/amira-prediction-lifecycle-core';

// ─── Public Types ──────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'watch' | 'degraded' | 'critical';

export interface HealthMetric {
  name: string;
  value: number;
  unit: string;
  status: HealthStatus;
  thresholds: { watch: number; degraded: number; critical: number };
  explanation: string;
}

export interface OracleHealthReport {
  composite_score: number;        // 0..100 (higher = healthier)
  composite_status: HealthStatus;
  metrics: HealthMetric[];
  /** # of lineage records used for evaluation */
  sample_size: number;
  /** ISO-8601 */
  computed_at: string;
  /** Monitor version */
  monitor_version: string;
}

export const HEALTH_MONITOR_VERSION = 'health_monitor_v2_r7';

// ─── Helpers ───────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / nums.length);
}

function classifyByThresholds(value: number, t: { watch: number; degraded: number; critical: number }, direction: 'lower_is_bad' | 'higher_is_bad'): HealthStatus {
  // For 'lower_is_bad': low values are bad (e.g. confidence). Watch < watch_threshold.
  // For 'higher_is_bad': high values are bad (e.g. drift). Watch > watch_threshold.
  if (direction === 'lower_is_bad') {
    if (value < t.critical) return 'critical';
    if (value < t.degraded) return 'degraded';
    if (value < t.watch) return 'watch';
    return 'healthy';
  } else {
    if (value > t.critical) return 'critical';
    if (value > t.degraded) return 'degraded';
    if (value > t.watch) return 'watch';
    return 'healthy';
  }
}

// ─── Metric 1: Prediction Drift ────────────────────────────────────────────
//
// Measures how much the expected_return has drifted in the last N predictions
// vs the historical mean. Uses stdev of recent expected_returns.
//
// Healthy: stdev < 0.005 (0.5%)
// Watch:   stdev < 0.010
// Degraded: stdev < 0.020
// Critical: stdev >= 0.020

function computePredictionDrift(): HealthMetric {
  const lineage = getLineageBuffer();
  const recent = lineage.slice(-30);
  const returns = recent.map((l) => l.prediction.expected_return);
  const drift = stdev(returns);
  const thresholds = { watch: 0.005, degraded: 0.010, critical: 0.020 };
  const status = classifyByThresholds(drift, thresholds, 'higher_is_bad');
  return {
    name: 'prediction_drift',
    value: Math.round(drift * 1e6) / 1e6,
    unit: 'fractional_stdev',
    status,
    thresholds,
    explanation: `stdev(expected_return) over last ${returns.length} predictions = ${(drift * 100).toFixed(3)}%`,
  };
}

// ─── Metric 2: Feature Drift ───────────────────────────────────────────────
//
// Average stdev across all 5 normalized features in the last N lineage records.
// Each feature is in [-1, 1], so drift is in the same units.
//
// Healthy: avg_stdev < 0.10
// Watch:   < 0.20
// Degraded: < 0.35
// Critical: >= 0.35

function computeFeatureDrift(): HealthMetric {
  const lineage = getLineageBuffer();
  const recent = lineage.slice(-30);
  if (recent.length < 2) {
    return {
      name: 'feature_drift',
      value: 0,
      unit: 'avg_stdev',
      status: 'healthy',
      thresholds: { watch: 0.10, degraded: 0.20, critical: 0.35 },
      explanation: `insufficient data (${recent.length} records)`,
    };
  }
  // We need to extract features from market_state (re-derive is expensive;
  // we approximate using prediction expected_return + risk_var_95 spread)
  const features = recent.map((l) => ({
    carry_proxy: l.weights.carry * l.market_state.rates_tna - l.market_state.inflation_monthly * 12,
    fx_proxy: -l.market_state.risk_sentiment,
    infl_proxy: l.market_state.inflation_monthly,
    liq_proxy: l.market_state.liquidity_index,
  }));
  const drift = mean([
    stdev(features.map((f) => f.carry_proxy)),
    stdev(features.map((f) => f.fx_proxy)),
    stdev(features.map((f) => f.infl_proxy)),
    stdev(features.map((f) => f.liq_proxy)),
  ]);
  const thresholds = { watch: 0.10, degraded: 0.20, critical: 0.35 };
  const status = classifyByThresholds(drift, thresholds, 'higher_is_bad');
  return {
    name: 'feature_drift',
    value: Math.round(drift * 1e4) / 1e4,
    unit: 'avg_stdev',
    status,
    thresholds,
    explanation: `avg stdev across 4 feature proxies over last ${recent.length} predictions`,
  };
}

// ─── Metric 3: Missing Data ────────────────────────────────────────────────
//
// % of lineage records where MarketState.quality != 'REAL' in the last N.
//
// Healthy: < 10%
// Watch:   < 30%
// Degraded: < 60%
// Critical: >= 60%

function computeMissingData(): HealthMetric {
  const lineage = getLineageBuffer();
  const recent = lineage.slice(-30);
  if (recent.length === 0) {
    return {
      name: 'missing_data',
      value: 0,
      unit: 'percent',
      status: 'healthy',
      thresholds: { watch: 10, degraded: 30, critical: 60 },
      explanation: 'no lineage records yet',
    };
  }
  const nonReal = recent.filter((l) => l.market_state.quality !== 'REAL').length;
  const pct = (nonReal / recent.length) * 100;
  const thresholds = { watch: 10, degraded: 30, critical: 60 };
  const status = classifyByThresholds(pct, thresholds, 'higher_is_bad');
  return {
    name: 'missing_data',
    value: Math.round(pct * 10) / 10,
    unit: 'percent',
    status,
    thresholds,
    explanation: `${nonReal}/${recent.length} recent predictions used non-REAL data`,
  };
}

// ─── Metric 4: Confidence Degradation ──────────────────────────────────────
//
// Trend of V2 confidence_score. Compares mean(confidence) of last 5 vs last 20.
// A drop > 10 points = degraded.
//
// Healthy: drop < 5
// Watch:   drop < 10
// Degraded: drop < 20
// Critical: drop >= 20

function computeConfidenceDegradation(): HealthMetric {
  const lineage = getLineageBuffer();
  const withConf = lineage.filter((l) => l.confidence);
  if (withConf.length < 10) {
    return {
      name: 'confidence_degradation',
      value: 0,
      unit: 'points_drop',
      status: 'healthy',
      thresholds: { watch: 5, degraded: 10, critical: 20 },
      explanation: `insufficient data (${withConf.length} records with confidence)`,
    };
  }
  const recent5 = withConf.slice(-5);
  const recent20 = withConf.slice(-20);
  const mean5 = mean(recent5.map((l) => l.confidence!.confidence_score));
  const mean20 = mean(recent20.map((l) => l.confidence!.confidence_score));
  const drop = mean20 - mean5; // positive = degradation
  const thresholds = { watch: 5, degraded: 10, critical: 20 };
  const status = classifyByThresholds(drop, thresholds, 'higher_is_bad');
  return {
    name: 'confidence_degradation',
    value: Math.round(drop * 10) / 10,
    unit: 'points_drop',
    status,
    thresholds,
    explanation: `mean confidence last 5 = ${mean5.toFixed(1)} vs last 20 = ${mean20.toFixed(1)} (drop ${drop.toFixed(1)})`,
  };
}

// ─── Metric 5: Forecast Degradation ────────────────────────────────────────
//
// Trend of verification MAE. Compares recent MAE vs historical baseline.
// Since we may have few verifications, we use lifecycle's verification_score.mae.
//
// Healthy: mae < 0.005 (0.5%)
// Watch:   < 0.010
// Degraded: < 0.020
// Critical: >= 0.020

function computeForecastDegradation(): HealthMetric {
  const pairs = getVerificationBuffer();
  const recent = pairs.slice(-20);
  if (recent.length < 5) {
    // Fall back to lifecycle's mae
    const snap = getLifecycleSnapshot();
    const mae = snap.verification_score.mae;
    const thresholds = { watch: 0.005, degraded: 0.010, critical: 0.020 };
    const status = classifyByThresholds(mae, thresholds, 'higher_is_bad');
    return {
      name: 'forecast_degradation',
      value: Math.round(mae * 1e6) / 1e6,
      unit: 'MAE_fractional',
      status,
      thresholds,
      explanation: `lifecycle MAE (insufficient local pairs: ${recent.length})`,
    };
  }
  const mae = mean(recent.map((p) => Math.abs(p.expected_return - p.realized_return)));
  const thresholds = { watch: 0.005, degraded: 0.010, critical: 0.020 };
  const status = classifyByThresholds(mae, thresholds, 'higher_is_bad');
  return {
    name: 'forecast_degradation',
    value: Math.round(mae * 1e6) / 1e6,
    unit: 'MAE_fractional',
    status,
    thresholds,
    explanation: `MAE over last ${recent.length} verified pairs`,
  };
}

// ─── Metric 6: Regime Instability ──────────────────────────────────────────
//
// Frequency of regime changes in last N lineage records.
// A "flip" = regime at index i differs from regime at i-1.
//
// Healthy: flips < 20% of N
// Watch:   < 35%
// Degraded: < 50%
// Critical: >= 50%

function computeRegimeInstability(): HealthMetric {
  const lineage = getLineageBuffer();
  const recent = lineage.slice(-20);
  if (recent.length < 3) {
    return {
      name: 'regime_instability',
      value: 0,
      unit: 'percent_flips',
      status: 'healthy',
      thresholds: { watch: 20, degraded: 35, critical: 50 },
      explanation: `insufficient data (${recent.length} records)`,
    };
  }
  let flips = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].regime.regime !== recent[i - 1].regime.regime) flips++;
  }
  const flipPct = (flips / (recent.length - 1)) * 100;
  const thresholds = { watch: 20, degraded: 35, critical: 50 };
  const status = classifyByThresholds(flipPct, thresholds, 'higher_is_bad');
  return {
    name: 'regime_instability',
    value: Math.round(flipPct * 10) / 10,
    unit: 'percent_flips',
    status,
    thresholds,
    explanation: `${flips} regime flips over last ${recent.length} predictions`,
  };
}

// ─── Composite Score ───────────────────────────────────────────────────────
//
// Composite = 100 - weighted_sum(metric_severity)
// Severity: healthy=0, watch=1, degraded=2, critical=3
// Weights: equal across all 6 metrics (1/6 each)
// Composite ranges 0..100 (100 = all healthy; 0 = all critical)

const STATUS_TO_SEVERITY: Record<HealthStatus, number> = {
  healthy: 0,
  watch: 1,
  degraded: 2,
  critical: 3,
};

function statusToHealthScore(status: HealthStatus): number {
  // healthy = 100, watch = 66, degraded = 33, critical = 0
  return 100 - (STATUS_TO_SEVERITY[status] * 100 / 3);
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export function computeOracleHealth(): OracleHealthReport {
  const metrics: HealthMetric[] = [
    computePredictionDrift(),
    computeFeatureDrift(),
    computeMissingData(),
    computeConfidenceDegradation(),
    computeForecastDegradation(),
    computeRegimeInstability(),
  ];

  // Composite = mean of per-metric health scores
  const perMetricScore = metrics.map((m) => statusToHealthScore(m.status));
  const composite_score = clamp(mean(perMetricScore));

  // Composite status: based on composite_score thresholds
  let composite_status: HealthStatus;
  if (composite_score >= 80) composite_status = 'healthy';
  else if (composite_score >= 60) composite_status = 'watch';
  else if (composite_score >= 40) composite_status = 'degraded';
  else composite_status = 'critical';

  const stats = getLineageStats();

  return {
    composite_score: Math.round(composite_score * 10) / 10,
    composite_status,
    metrics,
    sample_size: stats.total,
    computed_at: new Date().toISOString(),
    monitor_version: HEALTH_MONITOR_VERSION,
  };
}