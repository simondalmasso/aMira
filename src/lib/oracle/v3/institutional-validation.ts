// src/lib/oracle/v3/institutional-validation.ts
// ============================================================================
// I9 — INSTITUTIONAL VALIDATION (append-only, automatic committee)
// ============================================================================
// MISSION (per ORACLE_V3_INTELLIGENCE_LAYER spec, I9):
//   "Cada decisión pasa por un comité automático."
//
// CHECKS:
//   - Consistency checks    : does the prediction agree with the regime?
//   - Sanity checks         : are the inputs within plausible ranges?
//   - Outlier detection     : is the prediction an outlier vs historical?
//   - Contradiction detector: do the score and prediction contradict each other?
//   - Decision veto         : block the decision if too many checks fail
//
// DESIGN:
//   - Pure function over V1 + V2 + V3 data.
//   - Each check returns { passed, severity, message, recommended_action }.
//   - The Oracle's decision is NEVER automatically overridden — instead a
//     VETO recommendation is emitted, and downstream consumers can choose
//     to honor or ignore it. This preserves the "Oracle decides" principle.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT modify the Oracle score.
//   - Does NOT block API responses.
// ============================================================================

import type { AssetScore, AssetPrediction } from '@/lib/single-pass-oracle-engine';
import type { NormalizedFeatures, MarketState } from '@/lib/single-market-state';
import type { ConfidenceLayer } from '@/lib/oracle/v2/confidence-engine';
import type { RegimeV2Classification } from '@/lib/oracle/v2/regime-detector-v2';
import type { DecisionExplanation } from '@/lib/oracle/v2/explainer';
import { getLineageBuffer } from '@/lib/oracle/v2/lineage';

// ─── Public Types ──────────────────────────────────────────────────────────

export type CheckSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface ValidationCheck {
  /** Check id */
  id: string;
  /** Category */
  category: 'consistency' | 'sanity' | 'outlier' | 'contradiction';
  /** Human-readable label */
  label: string;
  /** Did the check pass? */
  passed: boolean;
  /** Severity if not passed */
  severity: CheckSeverity;
  /** Detailed message */
  message: string;
  /** Recommended action */
  recommended_action: string;
}

export interface VetoDecision {
  /** Should the decision be vetoed? */
  veto: boolean;
  /** Veto reason (if vetoed) */
  reason: string;
  /** Severity threshold that triggered the veto */
  triggered_by: CheckSeverity;
  /** Number of critical checks that failed */
  critical_failures: number;
  /** Number of error checks that failed */
  error_failures: number;
  /** Recommended override action (if vetoed) */
  override_action: 'hold_signal' | 'reduce_risk_signal' | null;
}

export interface InstitutionalValidationReport {
  /** All checks performed */
  checks: ValidationCheck[];
  /** Pass rate (0..1) */
  pass_rate: number;
  /** Number of checks by status */
  summary: {
    total: number;
    passed: number;
    failed: number;
    by_severity: Record<CheckSeverity, number>;
  };
  /** Veto decision (whether to block the action) */
  veto: VetoDecision;
  /** Committee verdict: 'APPROVED' | 'APPROVED_WITH_WARNINGS' | 'REJECTED' */
  verdict: 'APPROVED' | 'APPROVED_WITH_WARNINGS' | 'REJECTED';
  /** Committee narrative */
  narrative: string;
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
  /** Feature flag */
  enabled: boolean;
}

export const INSTITUTIONAL_VALIDATION_VERSION = 'institutional_validation_v3_i9';

// ─── Feature Flag ──────────────────────────────────────────────────────────

let _enabled = true;
export function setInstitutionalValidationEnabled(v: boolean): void { _enabled = v; }
export function isInstitutionalValidationEnabled(): boolean { return _enabled; }

// ─── Helpers ───────────────────────────────────────────────────────────────

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / nums.length);
}

// ─── Sanity Checks (input ranges) ──────────────────────────────────────────

function runSanityChecks(state: MarketState, prediction: AssetPrediction): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // 1. FX MEP range
  const fxOk = state.fx_mep > 100 && state.fx_mep < 10000;
  checks.push({
    id: 'sanity_fx_mep_range',
    category: 'sanity',
    label: 'FX MEP range (100..10000)',
    passed: fxOk,
    severity: 'error',
    message: `fx_mep=${state.fx_mep.toFixed(0)} ${fxOk ? 'within plausible range' : 'OUTSIDE plausible range'}`,
    recommended_action: fxOk ? '' : 'Verify Bluelytics fetch; possible data corruption',
  });

  // 2. Monthly inflation range
  const inflOk = state.inflation_monthly >= 0 && state.inflation_monthly < 0.30;
  checks.push({
    id: 'sanity_inflation_range',
    category: 'sanity',
    label: 'Inflation monthly range (0..30%)',
    passed: inflOk,
    severity: 'error',
    message: `inflation_monthly=${(state.inflation_monthly * 100).toFixed(2)}% ${inflOk ? 'within range' : 'OUTSIDE range'}`,
    recommended_action: inflOk ? '' : 'Verify INDEC source; possible parsing error',
  });

  // 3. TNA range
  const tnaOk = state.rates_tna >= 0 && state.rates_tna < 2.0;
  checks.push({
    id: 'sanity_tna_range',
    category: 'sanity',
    label: 'TNA range (0..200%)',
    passed: tnaOk,
    severity: 'error',
    message: `rates_tna=${(state.rates_tna * 100).toFixed(2)}% ${tnaOk ? 'within range' : 'OUTSIDE range'}`,
    recommended_action: tnaOk ? '' : 'Verify BCRA source',
  });

  // 4. Expected return range
  const erOk = Math.abs(prediction.expected_return) < 0.50; // |30d return| < 50%
  checks.push({
    id: 'sanity_expected_return_range',
    category: 'sanity',
    label: 'Expected 30d return within ±50%',
    passed: erOk,
    severity: 'critical',
    message: `expected_return=${(prediction.expected_return * 100).toFixed(2)}% ${erOk ? 'within range' : 'OUTSIDE range (extreme!)'}`,
    recommended_action: erOk ? '' : 'Sanity-check the model; possible input corruption',
  });

  // 5. VaR range
  const varOk = prediction.risk_var_95 > -0.50 && prediction.risk_var_95 < 0;
  checks.push({
    id: 'sanity_var_range',
    category: 'sanity',
    label: 'VaR95 within (-50%, 0%)',
    passed: varOk,
    severity: 'warning',
    message: `risk_var_95=${(prediction.risk_var_95 * 100).toFixed(2)}% ${varOk ? 'within range' : 'OUTSIDE range'}`,
    recommended_action: varOk ? '' : 'Check volatility model',
  });

  return checks;
}

// ─── Consistency Checks (prediction agrees with regime) ───────────────────

function runConsistencyChecks(
  score: AssetScore,
  prediction: AssetPrediction,
  v2Regime: RegimeV2Classification,
  features: NormalizedFeatures,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // 1. EASING regime should not predict strongly negative returns
  const easingNegative = v2Regime.regime === 'EASING' && prediction.expected_return < -0.02;
  checks.push({
    id: 'consistency_easing_negative',
    category: 'consistency',
    label: 'EASING regime should not predict strong negative returns',
    passed: !easingNegative,
    severity: 'warning',
    message: easingNegative
      ? `EASING regime but expected_return=${(prediction.expected_return * 100).toFixed(2)}% (contradicts easing tailwind)`
      : 'OK',
    recommended_action: easingNegative ? 'Inspect factor contributions; verify fx_momentum sign' : '',
  });

  // 2. CRISIS regime should not predict strongly positive returns
  const crisisPositive = v2Regime.regime === 'CRISIS' && prediction.expected_return > 0.03;
  checks.push({
    id: 'consistency_crisis_positive',
    category: 'consistency',
    label: 'CRISIS regime should not predict strong positive returns',
    passed: !crisisPositive,
    severity: 'warning',
    message: crisisPositive
      ? `CRISIS regime but expected_return=${(prediction.expected_return * 100).toFixed(2)}% (contradicts crisis risk-off)`
      : 'OK',
    recommended_action: crisisPositive ? 'Verify regime detection inputs' : '',
  });

  // 3. HIGH_INFLATION should benefit inflation_hedge factors
  const inflHedgeOk = v2Regime.regime !== 'HIGH_INFLATION' || features.inflation_hedge > 0;
  checks.push({
    id: 'consistency_high_inflation_hedge',
    category: 'consistency',
    label: 'HIGH_INFLATION regime requires positive inflation_hedge',
    passed: inflHedgeOk,
    severity: 'info',
    message: inflHedgeOk ? 'OK' : 'HIGH_INFLATION regime but inflation_hedge is negative',
    recommended_action: inflHedgeOk ? '' : 'Verify inflation_hedge feature computation',
  });

  // 4. Action should match score
  const actionScoreOk =
    (score.action === 'rebalance_signal' && score.score_adjusted >= 60) ||
    (score.action === 'hold_signal' && score.score_adjusted >= 40 && score.score_adjusted < 60) ||
    (score.action === 'reduce_risk_signal' && score.score_adjusted < 40);
  checks.push({
    id: 'consistency_action_score',
    category: 'consistency',
    label: 'Action matches score_adjusted',
    passed: actionScoreOk,
    severity: 'error',
    message: actionScoreOk
      ? `OK (action=${score.action}, score_adjusted=${score.score_adjusted.toFixed(1)})`
      : `MISMATCH: action=${score.action} but score_adjusted=${score.score_adjusted.toFixed(1)}`,
    recommended_action: actionScoreOk ? '' : 'Inspect action thresholds in single-pass-oracle-engine',
  });

  return checks;
}

// ─── Outlier Detection (prediction vs historical) ──────────────────────────

function runOutlierChecks(prediction: AssetPrediction, confidence: ConfidenceLayer): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const lineage = getLineageBuffer();

  if (lineage.length < 10) {
    checks.push({
      id: 'outlier_insufficient_data',
      category: 'outlier',
      label: 'Outlier detection (insufficient data)',
      passed: true,
      severity: 'info',
      message: `Only ${lineage.length} historical predictions; cannot reliably detect outliers`,
      recommended_action: '',
    });
    return checks;
  }

  const returns = lineage.map((l) => l.prediction.expected_return);
  const mu = mean(returns);
  const sigma = stdev(returns);
  const z = sigma > 0 ? Math.abs((prediction.expected_return - mu) / sigma) : 0;

  // 1. Z-score outlier (>3σ)
  checks.push({
    id: 'outlier_zscore',
    category: 'outlier',
    label: 'Prediction is not a statistical outlier (|z| < 3)',
    passed: z < 3,
    severity: z >= 3 ? 'critical' : z >= 2 ? 'warning' : 'info',
    message: `z-score=${z.toFixed(2)} (mean=${(mu * 100).toFixed(2)}%, σ=${(sigma * 100).toFixed(2)}%)`,
    recommended_action: z >= 3 ? 'Inspect input data for anomalies; consider veto' : '',
  });

  // 2. Confidence outlier (very low confidence)
  checks.push({
    id: 'outlier_confidence_low',
    category: 'outlier',
    label: 'Confidence is not extremely low (≥20)',
    passed: confidence.confidence_score >= 20,
    severity: confidence.confidence_score < 10 ? 'critical' : confidence.confidence_score < 20 ? 'warning' : 'info',
    message: `confidence=${confidence.confidence_score.toFixed(1)}/100`,
    recommended_action: confidence.confidence_score < 20 ? 'Inspect confidence contributors; data may be stale or unreliable' : '',
  });

  return checks;
}

// ─── Contradiction Detector ────────────────────────────────────────────────

function runContradictionChecks(
  score: AssetScore,
  prediction: AssetPrediction,
  explanation: DecisionExplanation,
  confidence: ConfidenceLayer,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // 1. Score vs prediction direction
  // High score → rebalance → expected positive return
  // Low score → reduce risk → expected negative return
  const scoreReturnOk =
    (score.score_adjusted >= 60 && prediction.expected_return > -0.01) ||
    (score.score_adjusted < 40 && prediction.expected_return < 0.01) ||
    (score.score_adjusted >= 40 && score.score_adjusted < 60);
  checks.push({
    id: 'contradiction_score_return',
    category: 'contradiction',
    label: 'Score and expected_return do not contradict',
    passed: scoreReturnOk,
    severity: 'error',
    message: scoreReturnOk
      ? 'OK'
      : `score_adjusted=${score.score_adjusted.toFixed(1)} contradicts expected_return=${(prediction.expected_return * 100).toFixed(2)}%`,
    recommended_action: scoreReturnOk ? '' : 'Inspect the prediction layer formula in single-pass-oracle-engine',
  });

  // 2. Explanation factors should support the action
  const positiveSum = explanation.top_positive_factors.reduce((s, f) => s + f.contribution, 0);
  const negativeSum = explanation.top_negative_factors.reduce((s, f) => s + f.contribution, 0);
  const explanationConsistent =
    (score.action === 'rebalance_signal' && positiveSum > Math.abs(negativeSum)) ||
    (score.action === 'reduce_risk_signal' && Math.abs(negativeSum) > positiveSum) ||
    score.action === 'hold_signal';
  checks.push({
    id: 'contradiction_explanation_action',
    category: 'contradiction',
    label: 'Explanation factors support the action',
    passed: explanationConsistent,
    severity: 'warning',
    message: explanationConsistent
      ? `OK (positive_sum=${positiveSum.toFixed(4)}, negative_sum=${negativeSum.toFixed(4)})`
      : `Action=${score.action} but factors don't clearly support it (pos=${positiveSum.toFixed(4)}, neg=${negativeSum.toFixed(4)})`,
    recommended_action: explanationConsistent ? '' : 'Inspect factor weights; possible miscalibration',
  });

  // 3. Confidence vs score extremity
  // Extreme scores (high or low) should have higher confidence than middle scores
  const extremity = Math.abs(score.score_adjusted - 50) / 50;
  const expectedConfidence = 40 + extremity * 40;
  const confOk = Math.abs(confidence.confidence_score - expectedConfidence) < 25;
  checks.push({
    id: 'contradiction_confidence_extremity',
    category: 'contradiction',
    label: 'Confidence aligns with score extremity',
    passed: confOk,
    severity: 'info',
    message: `confidence=${confidence.confidence_score.toFixed(1)}, expected≈${expectedConfidence.toFixed(1)} (extremity=${extremity.toFixed(2)})`,
    recommended_action: confOk ? '' : 'Inspect confidence contributors',
  });

  return checks;
}

// ─── Veto Decision ─────────────────────────────────────────────────────────

function decideVeto(checks: ValidationCheck[], score: AssetScore): VetoDecision {
  const critical = checks.filter((c) => !c.passed && c.severity === 'critical');
  const errors = checks.filter((c) => !c.passed && c.severity === 'error');

  const veto = critical.length >= 1 || errors.length >= 2;
  const triggered_by = critical.length >= 1 ? 'critical' : 'error';

  let override_action: 'hold_signal' | 'reduce_risk_signal' | null = null;
  if (veto) {
    // If the original action was aggressive (rebalance), demote to hold or reduce
    if (score.action === 'rebalance_signal') {
      override_action = critical.length >= 2 ? 'reduce_risk_signal' : 'hold_signal';
    } else if (score.action === 'hold_signal' && critical.length >= 2) {
      override_action = 'reduce_risk_signal';
    }
  }

  return {
    veto,
    reason: veto
      ? `${critical.length} critical + ${errors.length} error checks failed`
      : 'No veto (all critical checks passed)',
    triggered_by: veto ? triggered_by : 'info',
    critical_failures: critical.length,
    error_failures: errors.length,
    override_action,
  };
}

// ─── Verdict ───────────────────────────────────────────────────────────────

function computeVerdict(veto: VetoDecision, checks: ValidationCheck[]): InstitutionalValidationReport['verdict'] {
  if (veto.veto) return 'REJECTED';

  const warnings = checks.filter((c) => !c.passed && c.severity === 'warning').length;
  const infos = checks.filter((c) => !c.passed && c.severity === 'info').length;

  if (warnings === 0 && infos === 0) return 'APPROVED';
  return 'APPROVED_WITH_WARNINGS';
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export interface InstitutionalValidationInput {
  score: AssetScore;
  prediction: AssetPrediction;
  features: NormalizedFeatures;
  market_state: MarketState;
  v2_confidence: ConfidenceLayer;
  v2_regime: RegimeV2Classification;
  v2_explanation: DecisionExplanation;
}

export function validateInstitutionally(input: InstitutionalValidationInput): InstitutionalValidationReport {
  const checks: ValidationCheck[] = [
    ...runSanityChecks(input.market_state, input.prediction),
    ...runConsistencyChecks(input.score, input.prediction, input.v2_regime, input.features),
    ...runOutlierChecks(input.prediction, input.v2_confidence),
    ...runContradictionChecks(input.score, input.prediction, input.v2_explanation, input.v2_confidence),
  ];

  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.length - passed;
  const bySeverity: Record<CheckSeverity, number> = { info: 0, warning: 0, error: 0, critical: 0 };
  for (const c of checks) {
    if (!c.passed) bySeverity[c.severity]++;
  }

  const veto = decideVeto(checks, input.score);
  const verdict = computeVerdict(veto, checks);

  const narrative = `Comité automático: ${verdict}. ${passed}/${checks.length} checks pasaron. ` +
    `${bySeverity.critical} critical, ${bySeverity.error} error, ${bySeverity.warning} warning, ${bySeverity.info} info. ` +
    (veto.veto ? `VETO activado. Override sugerido: ${veto.override_action}.` : 'Sin veto.');

  return {
    checks,
    pass_rate: checks.length > 0 ? passed / checks.length : 1,
    summary: {
      total: checks.length,
      passed,
      failed,
      by_severity: bySeverity,
    },
    veto,
    verdict,
    narrative,
    computed_at: new Date().toISOString(),
    engine_version: INSTITUTIONAL_VALIDATION_VERSION,
    enabled: _enabled,
  };
}
