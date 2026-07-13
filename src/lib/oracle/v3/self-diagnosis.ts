// src/lib/oracle/v3/self-diagnosis.ts
// ============================================================================
// I7 — SELF DIAGNOSIS (append-only, automatic alerts)
// ============================================================================
// MISSION (per ORACLE_V3_INTELLIGENCE_LAYER spec, I7):
//   "El sistema detecta deterioro antes que el usuario."
//
// DRIFT METRICS (extends V2 R7):
//   - Model drift      : predicted vs realized return drift over time
//   - Data drift       : MarketState field distribution drift
//   - Feature drift    : NormalizedFeatures distribution drift
//   - Confidence drift : V2 confidence_score trend
//   - Prediction degradation : MAE/RMSE trend
//
// ALERTS:
//   - Automatic alert generation when any metric crosses severity thresholds
//   - Alert deduplication (don't spam the same alert)
//   - Severity escalation (WATCH → DEGRADED → CRITICAL)
//   - Auto-recovery detection (alert clears when metric returns to healthy)
//
// DESIGN:
//   - Builds on V2 R7 health-monitor (reuses its 6 metrics).
//   - Adds TIME-SERIES drift detection (V2 R7 is a point-in-time snapshot).
//   - Adds an ALERT BUFFER (bounded, in-memory) for the alert feed.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT replace V2 R7.
//   - Reads from V2 R6 lineage + V2 R4 verification buffer.
// ============================================================================

import type { NormalizedFeatures, MarketState } from '@/lib/single-market-state';
import type { AssetScore } from '@/lib/single-pass-oracle-engine';
import type { OracleHealthReport, HealthStatus } from '@/lib/oracle/v2/health-monitor';
import { getLineageBuffer } from '@/lib/oracle/v2/lineage';
import { getVerificationBuffer } from '@/lib/oracle/v2/forecast-verifier';

// ─── Public Types ──────────────────────────────────────────────────────────

export type DriftMetricKey =
  | 'model_drift'
  | 'data_drift'
  | 'feature_drift'
  | 'confidence_drift'
  | 'prediction_degradation'
  | 'regime_instability';

export interface DriftMetric {
  key: DriftMetricKey;
  /** Current drift value */
  current: number;
  /** Previous drift value (one window ago) */
  previous: number;
  /** Trend: 'improving' | 'stable' | 'deteriorating' */
  trend: 'improving' | 'stable' | 'deteriorating';
  /** Severity 0..100 (higher = worse) */
  severity: number;
  /** Status */
  status: HealthStatus;
  /** Thresholds */
  thresholds: { watch: number; degraded: number; critical: number };
  /** Explanation */
  explanation: string;
  /** Historical samples (last N windows) */
  history: Array<{ timestamp: string; value: number }>;
}

export interface Alert {
  alert_id: string;
  timestamp: string;
  metric: DriftMetricKey;
  severity: 'watch' | 'degraded' | 'critical';
  title: string;
  description: string;
  recommended_action: string;
  /** True if this alert has been auto-resolved */
  resolved: boolean;
  /** ISO-8601 of resolution (if resolved) */
  resolved_at: string | null;
}

export interface SelfDiagnosisReport {
  /** Per-metric drift analysis */
  drift_metrics: DriftMetric[];
  /** Composite diagnosis: 0..100 (higher = healthier) */
  composite_health: number;
  /** Composite status */
  composite_status: HealthStatus;
  /** Active alerts (unresolved) */
  active_alerts: Alert[];
  /** Recent alerts (last 50, includes resolved) */
  alert_history: Alert[];
  /** Whether the system has auto-detected any deterioration */
  deterioration_detected: boolean;
  /** Earliest sign of deterioration (timestamp) */
  earliest_deterioration: string | null;
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
  /** Feature flag */
  enabled: boolean;
}

export const SELF_DIAGNOSIS_VERSION = 'self_diagnosis_v3_i7';

// ─── Feature Flag ──────────────────────────────────────────────────────────

let _enabled = true;
export function setSelfDiagnosisEnabled(v: boolean): void { _enabled = v; }
export function isSelfDiagnosisEnabled(): boolean { return _enabled; }

// ─── Helpers ───────────────────────────────────────────────────────────────

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
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

function severityFromStatus(status: HealthStatus): number {
  switch (status) {
    case 'healthy': return 0;
    case 'watch': return 25;
    case 'degraded': return 60;
    case 'critical': return 100;
  }
}

// ─── Alert Buffer (bounded in-memory) ──────────────────────────────────────

const MAX_ALERTS = 200;
let _alerts: Alert[] = [];

function genAlertId(): string {
  return `alert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function pushAlert(alert: Alert): void {
  // Deduplication: if an unresolved alert with same metric+severity exists, don't add
  const exists = _alerts.some(
    (a) => !a.resolved && a.metric === alert.metric && a.severity === alert.severity,
  );
  if (exists) return;

  // Auto-resolve any lower-severity alerts for the same metric
  for (const a of _alerts) {
    if (!a.resolved && a.metric === alert.metric && a.severity !== alert.severity) {
      a.resolved = true;
      a.resolved_at = new Date().toISOString();
    }
  }

  _alerts.push(alert);
  if (_alerts.length > MAX_ALERTS) _alerts.shift();
}

export function getAlerts(): Alert[] {
  return [..._alerts];
}

export function getActiveAlerts(): Alert[] {
  return _alerts.filter((a) => !a.resolved);
}

export function clearAlerts(): void {
  _alerts = [];
}

// ─── Drift Metric Computations ─────────────────────────────────────────────

function computeModelDrift(): DriftMetric {
  const pairs = getVerificationBuffer();
  const recent = pairs.slice(-20);
  const previous = pairs.slice(-40, -20);

  const recentMAE = recent.length > 0 ? mean(recent.map((p) => Math.abs(p.expected_return - p.realized_return))) : 0;
  const previousMAE = previous.length > 0 ? mean(previous.map((p) => Math.abs(p.expected_return - p.realized_return))) : 0;

  const drift = Math.abs(recentMAE - previousMAE);
  const thresholds = { watch: 0.003, degraded: 0.008, critical: 0.015 };
  const status = classifyByThresholds(drift, thresholds, 'higher_is_bad');
  const trend: DriftMetric['trend'] = recentMAE < previousMAE - 0.001 ? 'improving' : recentMAE > previousMAE + 0.001 ? 'deteriorating' : 'stable';

  return {
    key: 'model_drift',
    current: round(recentMAE, 6),
    previous: round(previousMAE, 6),
    trend,
    severity: severityFromStatus(status),
    status,
    thresholds,
    explanation: `Recent MAE=${(recentMAE * 100).toFixed(2)}% vs previous MAE=${(previousMAE * 100).toFixed(2)}% (drift=${(drift * 100).toFixed(2)}%)`,
    history: recent.map((p) => ({ timestamp: p.timestamp, value: Math.abs(p.expected_return - p.realized_return) })),
  };
}

function computeDataDrift(): DriftMetric {
  const lineage = getLineageBuffer();
  const recent = lineage.slice(-30);
  const previous = lineage.slice(-60, -30);

  if (recent.length < 5 || previous.length < 5) {
    return {
      key: 'data_drift',
      current: 0, previous: 0, trend: 'stable',
      severity: 0, status: 'healthy',
      thresholds: { watch: 0.10, degraded: 0.20, critical: 0.35 },
      explanation: 'insufficient data for drift analysis',
      history: [],
    };
  }

  // Compare distributions of fx_mep, inflation_monthly, rates_tna
  const recentMeans = {
    fx: mean(recent.map((l) => l.market_state.fx_mep)),
    infl: mean(recent.map((l) => l.market_state.inflation_monthly)),
    rates: mean(recent.map((l) => l.market_state.rates_tna)),
  };
  const previousMeans = {
    fx: mean(previous.map((l) => l.market_state.fx_mep)),
    infl: mean(previous.map((l) => l.market_state.inflation_monthly)),
    rates: mean(previous.map((l) => l.market_state.rates_tna)),
  };

  const driftFx = Math.abs(recentMeans.fx - previousMeans.fx) / Math.max(1, previousMeans.fx);
  const driftInfl = Math.abs(recentMeans.infl - previousMeans.infl);
  const driftRates = Math.abs(recentMeans.rates - previousMeans.rates);

  const drift = (driftFx + driftInfl * 10 + driftRates * 10) / 3;
  const thresholds = { watch: 0.10, degraded: 0.20, critical: 0.35 };
  const status = classifyByThresholds(drift, thresholds, 'higher_is_bad');
  const trend: DriftMetric['trend'] = drift < 0.05 ? 'stable' : drift < 0.15 ? 'deteriorating' : 'deteriorating';

  return {
    key: 'data_drift',
    current: round(drift, 4),
    previous: 0,
    trend,
    severity: severityFromStatus(status),
    status,
    thresholds,
    explanation: `Data distribution drift: fx=${(driftFx * 100).toFixed(1)}%, infl=${(driftInfl * 100).toFixed(2)}%, rates=${(driftRates * 100).toFixed(2)}%`,
    history: recent.map((l) => ({ timestamp: l.timestamp, value: l.market_state.fx_mep })),
  };
}

function computeFeatureDrift(): DriftMetric {
  const lineage = getLineageBuffer();
  const recent = lineage.slice(-30);
  const previous = lineage.slice(-60, -30);

  if (recent.length < 5 || previous.length < 5) {
    return {
      key: 'feature_drift',
      current: 0, previous: 0, trend: 'stable',
      severity: 0, status: 'healthy',
      thresholds: { watch: 0.10, degraded: 0.20, critical: 0.35 },
      explanation: 'insufficient data for feature drift analysis',
      history: [],
    };
  }

  // Approximate feature drift via lineage-derived proxies
  const recentFeatures = recent.map((l) => ({
    carry: l.market_state.rates_tna - l.market_state.inflation_monthly * 12,
    infl: l.market_state.inflation_monthly,
    fx: l.market_state.fx_mep,
    liq: l.market_state.liquidity_index,
  }));
  const previousFeatures = previous.map((l) => ({
    carry: l.market_state.rates_tna - l.market_state.inflation_monthly * 12,
    infl: l.market_state.inflation_monthly,
    fx: l.market_state.fx_mep,
    liq: l.market_state.liquidity_index,
  }));

  const drift = mean([
    Math.abs(mean(recentFeatures.map((f) => f.carry)) - mean(previousFeatures.map((f) => f.carry))),
    Math.abs(mean(recentFeatures.map((f) => f.infl)) - mean(previousFeatures.map((f) => f.infl))) * 10,
    Math.abs(mean(recentFeatures.map((f) => f.fx)) - mean(previousFeatures.map((f) => f.fx))) / 1000,
    Math.abs(mean(recentFeatures.map((f) => f.liq)) - mean(previousFeatures.map((f) => f.liq))),
  ]);

  const thresholds = { watch: 0.10, degraded: 0.20, critical: 0.35 };
  const status = classifyByThresholds(drift, thresholds, 'higher_is_bad');
  const trend: DriftMetric['trend'] = drift < 0.05 ? 'stable' : 'deteriorating';

  return {
    key: 'feature_drift',
    current: round(drift, 4),
    previous: 0,
    trend,
    severity: severityFromStatus(status),
    status,
    thresholds,
    explanation: `Feature distribution drift across carry/infl/fx/liq proxies`,
    history: recentFeatures.map((f, i) => ({ timestamp: recent[i].timestamp, value: f.carry })),
  };
}

function computeConfidenceDrift(): DriftMetric {
  const lineage = getLineageBuffer();
  const withConf = lineage.filter((l) => l.confidence);
  const recent = withConf.slice(-20);
  const previous = withConf.slice(-40, -20);

  if (recent.length < 5 || previous.length < 5) {
    return {
      key: 'confidence_drift',
      current: 0, previous: 0, trend: 'stable',
      severity: 0, status: 'healthy',
      thresholds: { watch: 5, degraded: 10, critical: 20 },
      explanation: 'insufficient data for confidence drift analysis',
      history: [],
    };
  }

  const recentMean = mean(recent.map((l) => l.confidence!.confidence_score));
  const previousMean = mean(previous.map((l) => l.confidence!.confidence_score));
  const drift = previousMean - recentMean; // positive = deteriorating

  const thresholds = { watch: 5, degraded: 10, critical: 20 };
  const status = classifyByThresholds(drift, thresholds, 'higher_is_bad');
  const trend: DriftMetric['trend'] = drift > 1 ? 'deteriorating' : drift < -1 ? 'improving' : 'stable';

  return {
    key: 'confidence_drift',
    current: round(recentMean, 1),
    previous: round(previousMean, 1),
    trend,
    severity: severityFromStatus(status),
    status,
    thresholds,
    explanation: `Confidence drift: recent=${recentMean.toFixed(1)} vs previous=${previousMean.toFixed(1)} (drop=${drift.toFixed(1)})`,
    history: recent.map((l) => ({ timestamp: l.timestamp, value: l.confidence!.confidence_score })),
  };
}

function computePredictionDegradation(): DriftMetric {
  const pairs = getVerificationBuffer();
  const recent = pairs.slice(-20);
  const previous = pairs.slice(-40, -20);

  if (recent.length < 5 || previous.length < 5) {
    return {
      key: 'prediction_degradation',
      current: 0, previous: 0, trend: 'stable',
      severity: 0, status: 'healthy',
      thresholds: { watch: 0.005, degraded: 0.010, critical: 0.020 },
      explanation: 'insufficient verification data',
      history: [],
    };
  }

  const recentMAE = mean(recent.map((p) => Math.abs(p.expected_return - p.realized_return)));
  const previousMAE = mean(previous.map((p) => Math.abs(p.expected_return - p.realized_return)));
  const drift = recentMAE - previousMAE;

  const thresholds = { watch: 0.005, degraded: 0.010, critical: 0.020 };
  const status = classifyByThresholds(Math.abs(drift), thresholds, 'higher_is_bad');
  const trend: DriftMetric['trend'] = drift > 0.001 ? 'deteriorating' : drift < -0.001 ? 'improving' : 'stable';

  return {
    key: 'prediction_degradation',
    current: round(recentMAE, 6),
    previous: round(previousMAE, 6),
    trend,
    severity: severityFromStatus(status),
    status,
    thresholds,
    explanation: `Prediction degradation: recent MAE=${(recentMAE * 100).toFixed(2)}% vs previous MAE=${(previousMAE * 100).toFixed(2)}%`,
    history: recent.map((p) => ({ timestamp: p.timestamp, value: Math.abs(p.expected_return - p.realized_return) })),
  };
}

function computeRegimeInstability(): DriftMetric {
  const lineage = getLineageBuffer();
  const recent = lineage.slice(-30);

  if (recent.length < 3) {
    return {
      key: 'regime_instability',
      current: 0, previous: 0, trend: 'stable',
      severity: 0, status: 'healthy',
      thresholds: { watch: 20, degraded: 35, critical: 50 },
      explanation: 'insufficient data',
      history: [],
    };
  }

  let flips = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].regime.regime !== recent[i - 1].regime.regime) flips++;
  }
  const flipPct = (flips / (recent.length - 1)) * 100;
  const thresholds = { watch: 20, degraded: 35, critical: 50 };
  const status = classifyByThresholds(flipPct, thresholds, 'higher_is_bad');
  const trend: DriftMetric['trend'] = flipPct > 30 ? 'deteriorating' : flipPct < 10 ? 'stable' : 'stable';

  return {
    key: 'regime_instability',
    current: round(flipPct, 1),
    previous: 0,
    trend,
    severity: severityFromStatus(status),
    status,
    thresholds,
    explanation: `${flips} regime flips over last ${recent.length} predictions (${flipPct.toFixed(1)}%)`,
    history: recent.map((l) => ({ timestamp: l.timestamp, value: REGIME_TO_IDX[l.regime.regime] ?? 0 })),
  };
}

const REGIME_TO_IDX: Record<string, number> = {
  EASING: 0, TIGHTENING: 1, HIGH_INFLATION: 2, DISINFLATION: 3,
  CRISIS: 4, RECOVERY: 5, STRESS: 6, NEUTRAL: 5, STAGFLATION: 4,
};

// ─── Alert Generation ──────────────────────────────────────────────────────

function maybeGenerateAlerts(metrics: DriftMetric[]): void {
  for (const m of metrics) {
    if (m.status === 'healthy') {
      // Auto-resolve any active alert for this metric
      for (const a of _alerts) {
        if (!a.resolved && a.metric === m.key) {
          a.resolved = true;
          a.resolved_at = new Date().toISOString();
        }
      }
      continue;
    }

    if (m.status === 'watch' || m.status === 'degraded' || m.status === 'critical') {
      // Check if there's an active alert at this severity
      const existing = _alerts.find(
        (a) => !a.resolved && a.metric === m.key && a.severity === m.status,
      );
      if (existing) continue;

      // Escalate: resolve any lower-severity alerts for this metric
      const severityOrder = { watch: 0, degraded: 1, critical: 2 };
      for (const a of _alerts) {
        if (!a.resolved && a.metric === m.key && severityOrder[a.severity] < severityOrder[m.status]) {
          a.resolved = true;
          a.resolved_at = new Date().toISOString();
        }
      }

      const titles: Record<DriftMetricKey, string> = {
        model_drift: 'Model Drift Detected',
        data_drift: 'Data Drift Detected',
        feature_drift: 'Feature Drift Detected',
        confidence_drift: 'Confidence Drift Detected',
        prediction_degradation: 'Prediction Degradation Detected',
        regime_instability: 'Regime Instability Detected',
      };

      const actions: Record<DriftMetricKey, string> = {
        model_drift: 'Review recent weight updates; consider rolling back via adaptive-weights.rollback()',
        data_drift: 'Check upstream data sources (BCRA, INDEC, Bluelytics); verify proxy health',
        feature_drift: 'Investigate market regime change; consider activating scenario analysis',
        confidence_drift: 'Inspect confidence layer contributors; verify data freshness',
        prediction_degradation: 'Run forecast-verification diagnostics; consider re-calibration',
        regime_instability: 'Activate scenario engine; reduce position sizing until regime stabilizes',
      };

      pushAlert({
        alert_id: genAlertId(),
        timestamp: new Date().toISOString(),
        metric: m.key,
        severity: m.status,
        title: titles[m.key],
        description: m.explanation,
        recommended_action: actions[m.key],
        resolved: false,
        resolved_at: null,
      });
    }
  }
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export interface SelfDiagnosisInput {
  score: AssetScore;
  features: NormalizedFeatures;
  market_state: MarketState;
  v2_health?: OracleHealthReport;
}

export function diagnoseSelf(input: SelfDiagnosisInput): SelfDiagnosisReport {
  void input; // currently diagnosis reads from lineage + verification buffers

  const metrics: DriftMetric[] = [
    computeModelDrift(),
    computeDataDrift(),
    computeFeatureDrift(),
    computeConfidenceDrift(),
    computePredictionDegradation(),
    computeRegimeInstability(),
  ];

  // Generate alerts (mutates the alert buffer)
  maybeGenerateAlerts(metrics);

  // Composite health = 100 - mean(severity)
  const composite_health = Math.max(0, 100 - mean(metrics.map((m) => m.severity)));
  let composite_status: HealthStatus;
  if (composite_health >= 80) composite_status = 'healthy';
  else if (composite_health >= 60) composite_status = 'watch';
  else if (composite_health >= 40) composite_status = 'degraded';
  else composite_status = 'critical';

  const active_alerts = getActiveAlerts();
  const alert_history = [..._alerts].reverse().slice(0, 50);
  const deterioration_detected = active_alerts.length > 0;
  const earliest_deterioration = deterioration_detected
    ? active_alerts[0].timestamp
    : null;

  return {
    drift_metrics: metrics,
    composite_health: round(composite_health, 1),
    composite_status,
    active_alerts,
    alert_history,
    deterioration_detected,
    earliest_deterioration,
    computed_at: new Date().toISOString(),
    engine_version: SELF_DIAGNOSIS_VERSION,
    enabled: _enabled,
  };
}
