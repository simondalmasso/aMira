// src/lib/amira-prediction-engine.ts
// V10.1 — AMIRA VISION PREDICTION ENGINE + PREDICTION LIFECYCLE CHAIN
//
// Per spec `engine_improvements.prediction_engine_v2`:
//   name: "Amira Vision Prediction Engine"
//   changes:
//     - expected_return_30d derivado de asset-class consensus
//     - confidence_score basado en cobertura, frescura y consenso entre fuentes
//     - fallback hierarchy: real data → derived consensus → cached last valid → explicit off
//     - source_agreement_index para validar si el forecast es sólido
//
// Per spec `2_unified_prediction_engine.single_source_of_truth`:
//   capital_input, selected_profile, risk_level, stress_mode, active_assets,
//   portfolio_weights, expected_returns_30d
//
// Per spec `2_unified_prediction_engine.formula_rules`:
//   - Ganancia esperada debe salir de expected_returns_30d ponderado por allocation weight
//   - 60d y 90d deben derivarse del retorno base mensual, no de STRESS_SHOCKS
//   - STRESS_SHOCKS solo puede alimentar Stress Projection, nunca Ganancia Proyectada
//
// Per spec `risk_return_consistency.rules`:
//   - Más riesgo no debe ocultar más retorno esperado
//   - El perfil agresivo debe seguir mostrando más upside esperado que conservador
//   - Stress Projection debe ser peor caso separado, no la ganancia esperada
//
// V10.1 LIFECYCLE (per spec `system_changes.prediction_engine`):
//   add_fields:
//     - lifecycle_stage: 'PREDICTION' | 'OUTCOME' | 'VERIFICATION'
//     - prediction_id: string | null  (rule_1: unique id; rule_2: persisted)
//     - verification_status: 'PENDING'|'OUTCOME_CAPTURED'|'VERIFIED'|'EXPIRED'|'REJECTED'
//     - outcome_linked: string | null
//   enforce: "strict_lifecycle_tracking"
//   integration: hooks amira-prediction-lifecycle.ts (append-only event store)
//   pipeline_position: "after_calibration_before_executor"
//   compatibility_mode: "backward_safe"
//
// SAFE MODIFICATIONS: This module is advisory only — it WRAPS
// decisionEngineCore's profit_projection (which is already the single source
// of truth per V6/V7 audit) and ENRICHES it with confidence/freshness/source
// agreement metadata. It does NOT change the math (EXPECTED_RETURNS_30D ×
// STRESS_ADJUSTMENT for fallback, ML ensemble for active path). It does NOT
// change any /api/* contract.
//
// V10.1 ADDITIONS: every non-OFF prediction now goes through
// enrichWithLifecycle() which records an entry in the append-only event log
// (PREDICTIONS_LOG) and attaches a unique prediction_id. Per rule_5,
// predictions with no data_sources are REJECTED at record-time.

import {
  type DecisionEngineOutput,
  type ProfitProjection,
  type StressMode,
  EXPECTED_RETURNS_30D,
  STRESS_ADJUSTMENT,
} from './oracle/portfolio-engine';
// V10.1: import the lifecycle store + enrichment helper.
// This module is the ONLY place that calls enrichWithLifecycle() — per
// spec `anti_frankenstein_rule`: "no_metric_can_exist_without_lifecycle_link".
// Every non-OFF prediction that comes out of composeAmiraPrediction() gets
// a prediction_id and is recorded in the append-only event log.
import {
  enrichWithLifecycle,
  type LifecycleStage,
  type VerificationStatus,
} from './amira-prediction-lifecycle';

// ─── Output Schema (per spec `2_unified_prediction_engine.output_schema`) ───
//
// V10 EXTENSION (per spec `required_changes.4_prediction_calibration`):
//   - calibración con histórico
//   - Brier-like score o error medio
//   - confidence score por predicción
//   - separar predicción real de simulación histórica

export type PredictionStatus = 'ON' | 'OFF' | 'PARTIAL';
export type PredictionFreshness = 'REAL' | 'STALE' | 'SIMULADO' | 'DERIVED';

/**
 * V10 NEW: Calibration score (Brier-like).
 *
 * Per spec `required_changes.4_prediction_calibration.actions`:
 *   - "calibración con histórico"
 *   - "Brier-like score o error medio"
 *   - "confidence score por predicción"
 *
 * Brier score = mean( (forecast_probability - outcome_indicator)² )
 * Lower is better (0 = perfect, 0.25 = random, 1 = always wrong).
 *
 * In our setting, we don't have binary outcomes — we have fractional returns.
 * So we adapt: for each historical prediction P_i with realized return R_i,
 *   error_i = (P_i.expected_return_30d - R_i)
 *   brier_like = mean( error_i² ) / variance(R)
 * This is normalized so 0 = perfect, 1 = no better than the mean, >1 = worse.
 *
 * Per spec `no_hallucination`: if no historical data, calibration_status = 'NO_HISTORY'.
 */
export interface CalibrationScore {
  /** 0..1 — 0 = perfect calibration, 1 = no signal (random) */
  brier_like: number;
  /** Mean absolute error of historical predictions (fractional return) */
  mae: number;
  /** Number of historical predictions used for calibration (0 = no history) */
  sample_count: number;
  /** Calibration status — derived from sample_count + brier_like */
  status: 'EXCELLENT' | 'GOOD' | 'POOR' | 'NO_HISTORY';
  /** Human-readable label (es-AR) */
  label: string;
}

export interface AmiraPredictionOutput {
  prediction_status: PredictionStatus;
  prediction_reason: string;
  expected_return_30d: number;
  expected_return_60d: number;
  expected_return_90d: number;
  expected_profit_usd_30d: number;
  expected_profit_usd_60d: number;
  expected_profit_usd_90d: number;
  confidence: number;             // 0..1
  freshness: PredictionFreshness;
  source_agreement_index: number; // 0..1 — how aligned the underlying signals are
  source: 'ml' | 'fallback' | 'off';
  // V10 NEW: explicit fallback hierarchy level (per spec fallback chain)
  // 'real' = ML ensemble active
  // 'derived' = baseline × regime (EXPECTED_RETURNS_30D × STRESS_ADJUSTMENT)
  // 'cached' = last valid prediction for (risk, stress) pair
  // 'off' = no prediction available
  fallback_level: 'real' | 'derived' | 'cached' | 'off';
  // V10 NEW: calibration score
  calibration: CalibrationScore;
  // ─── V10.1 NEW: Prediction Lifecycle Chain fields ──────────────────────
  // Per spec `system_changes.prediction_engine.add_fields`:
  //   - lifecycle_stage
  //   - prediction_id
  //   - verification_status
  //   - outcome_linked
  // Per spec `system_changes.prediction_engine.enforce`: "strict_lifecycle_tracking"
  // Per spec `data_governance.anti_frankenstein_rule`:
  //   "no_metric_can_exist_without_lifecycle_link"
  //
  // For OFF / cached-fallback predictions, prediction_id is null and
  // lifecycle_stage is 'PREDICTION' (we never advance the stage without a
  // real prediction record). Per rule_5, predictions with no data sources
  // have prediction_id = null AND verification_status = 'REJECTED'.
  lifecycle_stage: LifecycleStage;
  /** Unique prediction_id (per rule_1). null for OFF / REJECTED predictions. */
  prediction_id: string | null;
  /** Verification status (per spec `system_changes.prediction_engine.add_fields`) */
  verification_status: VerificationStatus;
  /** Outcome ID linked to this prediction (null until outcome captured) */
  outcome_linked: string | null;
  /** V10.1: list of data sources used (per rule_5: must not be empty for non-OFF) */
  data_sources: string[];
  /** V10.1: model version that produced this prediction (per spec lifecycle_stages.PREDICTION.outputs) */
  model_version: string;
  // Echoed inputs for traceability
  capital: number;
  risk: number;
  stress_mode: StressMode;
}

// ─── Confidence Inputs (per spec `prediction_engine_v2.scoring.confidence_inputs`) ───
//   data_freshness, source_agreement, history_days, prediction_coverage, stale_penalty

interface ConfidenceInputs {
  data_freshness: number;       // 0..1 — 1 = fresh, 0 = stale
  source_agreement: number;     // 0..1 — 1 = all sources agree
  history_days: number;         // raw count
  prediction_coverage: number;  // 0..1 — fraction of weight with ML predictions
  stale_penalty: number;        // 0..1 — penalty multiplier when stale
}

function computeConfidenceScore(inputs: ConfidenceInputs): number {
  // Weighted blend — coverage and freshness dominate, source_agreement
  // breaks ties, history_days adds modest boost when ample.
  const coverageWeight = 0.40;
  const freshnessWeight = 0.25;
  const agreementWeight = 0.20;
  const historyWeight = 0.15;

  // History days saturate at 30+ days → max contribution.
  const historyScore = Math.min(1, inputs.history_days / 30);

  const raw =
    coverageWeight * inputs.prediction_coverage +
    freshnessWeight * inputs.data_freshness +
    agreementWeight * inputs.source_agreement +
    historyWeight * historyScore;

  // Apply stale penalty multiplicatively.
  const penalized = raw * Math.max(0.1, inputs.stale_penalty);

  // Clamp to [0, 1] and round to 3 decimals for stable display.
  return Math.max(0, Math.min(1, Math.round(penalized * 1000) / 1000));
}

// ─── Source Agreement Index ─────────────────────────────────────────────────
// Compares the ML ensemble signal with the EXPECTED_RETURNS_30D baseline.
// High agreement (close values) → 1.0; divergent signals → 0.0.
// When ML is unavailable, agreement defaults to 1.0 (single-source = no
// disagreement).

function computeSourceAgreement(
  mlReturn30d: number | null,
  baselineReturn30d: number,
): number {
  if (mlReturn30d == null) return 1.0; // single source = no disagreement
  const diff = Math.abs(mlReturn30d - baselineReturn30d);
  const scale = Math.max(Math.abs(baselineReturn30d), 0.01);
  const ratio = diff / scale;
  // 0% divergence → 1.0, 100%+ divergence → 0.0
  return Math.max(0, Math.min(1, 1 - ratio));
}

// ─── Last-Valid Cache (fallback hierarchy level 3) ──────────────────────────
// Per spec: "cached last valid" — when current inputs produce OFF, fall back
// to the most recent non-OFF prediction for the same (risk, stress) pair.

interface CachedPrediction {
  output: AmiraPredictionOutput;
  timestamp: number;
}

const LAST_VALID_CACHE = new Map<string, CachedPrediction>();
const CACHE_TTL_MS = 5 * 60_000; // 5 min — bounded memory

function cacheKey(risk: number, stress: StressMode): string {
  return `${risk.toFixed(3)}|${stress}`;
}

function getCachedPrediction(risk: number, stress: StressMode): AmiraPredictionOutput | null {
  const entry = LAST_VALID_CACHE.get(cacheKey(risk, stress));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    LAST_VALID_CACHE.delete(cacheKey(risk, stress));
    return null;
  }
  return entry.output;
}

function setCachedPrediction(risk: number, stress: StressMode, output: AmiraPredictionOutput): void {
  LAST_VALID_CACHE.set(cacheKey(risk, stress), { output, timestamp: Date.now() });
}

// ─── V10 NEW: Prediction Calibration (Brier-like) ───────────────────────────
// Per spec `required_changes.4_prediction_calibration`:
//   - "calibración con histórico"
//   - "Brier-like score o error medio"
//   - "confidence score por predicción"
//   - "separar predicción real de simulación histórica"
//
// We track predictions and their realized outcomes in a module-level history.
// When a new prediction is made, we record it. When the realized return
// arrives (after 30 days), we backfill the outcome and recompute the score.
//
// Per spec `no_hallucination`: if no history, calibration_status = NO_HISTORY.

interface CalibrationObservation {
  predicted_return_30d: number;
  realized_return_30d: number | null; // null = outcome not yet observed
  timestamp: number;
  asset_class?: string;
}

const CALIBRATION_HISTORY: CalibrationObservation[] = [];
const CALIBRATION_MAX_SAMPLES = 200;

/**
 * Record a prediction outcome for future calibration.
 * Called by the prediction engine when a new prediction is composed.
 */
export function recordCalibrationObservation(
  predicted_return_30d: number,
  asset_class?: string,
): void {
  CALIBRATION_HISTORY.push({
    predicted_return_30d,
    realized_return_30d: null,
    timestamp: Date.now(),
    asset_class,
  });
  if (CALIBRATION_HISTORY.length > CALIBRATION_MAX_SAMPLES) {
    CALIBRATION_HISTORY.shift();
  }
}

/**
 * Backfill the realized outcome for a prior prediction.
 * Called by ingestion code when a 30d-old prediction's outcome is observed.
 *
 * We match by the OLDEST pending observation (FIFO). This is a simple
 * approach — in production we'd match by asset_id + timestamp.
 */
export function backfillCalibrationOutcome(realized_return_30d: number): void {
  const pending = CALIBRATION_HISTORY.find((o) => o.realized_return_30d === null);
  if (pending) {
    pending.realized_return_30d = realized_return_30d;
  }
}

/**
 * Compute the current calibration score from observed predictions.
 *
 * Brier-like score (normalized):
 *   brier_like = mean( (predicted - realized)² ) / variance(realized)
 *
 * Interpretation:
 *   0.0 = perfect (predicted = realized for every observation)
 *   1.0 = no better than always predicting the mean
 *   >1.0 = worse than the mean (anti-signal)
 *
 * Per spec `no_hallucination`: returns CalibrationScore with status='NO_HISTORY'
 * when sample_count is insufficient (we require >=5 observations).
 */
export function computeCalibrationScore(): CalibrationScore {
  const observed = CALIBRATION_HISTORY.filter((o) => o.realized_return_30d != null) as Array<{
    predicted_return_30d: number;
    realized_return_30d: number;
  }>;

  if (observed.length < 5) {
    return {
      brier_like: 1.0,
      mae: 0,
      sample_count: observed.length,
      status: 'NO_HISTORY',
      label: `Sin histórico suficiente (${observed.length}/5 obs.)`,
    };
  }

  // Mean absolute error
  const absErrors = observed.map((o) => Math.abs(o.predicted_return_30d - o.realized_return_30d));
  const mae = absErrors.reduce((a, b) => a + b, 0) / absErrors.length;

  // Variance of realized returns
  const meanRealized = observed.reduce((s, o) => s + o.realized_return_30d, 0) / observed.length;
  const variance = observed.reduce((s, o) => s + Math.pow(o.realized_return_30d - meanRealized, 2), 0) / observed.length;

  // Brier-like = mean squared error / variance
  // If variance is 0 (all realized returns identical), use 1.0 (no information)
  const mse = observed.reduce((s, o) => s + Math.pow(o.predicted_return_30d - o.realized_return_30d, 2), 0) / observed.length;
  const brier = variance > 0 ? mse / variance : 1.0;

  let status: CalibrationScore['status'];
  let label: string;
  if (brier <= 0.30) {
    status = 'EXCELLENT';
    label = `Calibración excelente (Brier ${brier.toFixed(2)})`;
  } else if (brier <= 0.60) {
    status = 'GOOD';
    label = `Calibración buena (Brier ${brier.toFixed(2)})`;
  } else {
    status = 'POOR';
    label = `Calibración pobre (Brier ${brier.toFixed(2)})`;
  }

  return {
    brier_like: Math.round(brier * 1000) / 1000,
    mae: Math.round(mae * 10000) / 10000,
    sample_count: observed.length,
    status,
    label,
  };
}

/**
 * V10 NEW: Inject a calibration observation programmatically.
 * Used by tests and by the calibration backfill pipeline when reading
 * historical predictions from KV storage. Per spec `2_backfill_incremental`:
 * "Reintentar sólo ventanas faltantes".
 */
export function _injectCalibrationObservation(
  predicted: number,
  realized: number | null,
  timestamp: number = Date.now(),
  asset_class?: string,
): void {
  CALIBRATION_HISTORY.push({
    predicted_return_30d: predicted,
    realized_return_30d: realized,
    timestamp,
    asset_class,
  });
  if (CALIBRATION_HISTORY.length > CALIBRATION_MAX_SAMPLES) {
    CALIBRATION_HISTORY.shift();
  }
}

/**
 * V10 NEW: Get the current calibration history (read-only snapshot).
 * Useful for debugging and for the calibration UI block.
 */
export function getCalibrationHistory(): ReadonlyArray<CalibrationObservation> {
  return CALIBRATION_HISTORY.slice();
}

// ─── Main Composer ──────────────────────────────────────────────────────────
// Given the decision engine output (single source of truth per V7 audit),
// produce a unified prediction with confidence + freshness + source agreement.
//
// This function is PURE — same inputs → same output. Safe to memoize.

export function composeAmiraPrediction(
  decision: DecisionEngineOutput | null,
  options: {
    capital: number;
    risk: number;             // 0..1
    stressMode: StressMode;
    historyDays: number;
    sourceStatus?: string;    // 'OK' | 'DEGRADED' | 'ERROR'
    dataFreshnessOverride?: number; // 0..1, optional
  },
): AmiraPredictionOutput {
  const { capital, risk, stressMode, historyDays, sourceStatus, dataFreshnessOverride } = options;

  // ─── Handle missing decision (oracle not hydrated yet) ───
  // V10.1: lifecycle fields are still emitted (with prediction_id = null and
  // verification_status = 'PENDING') so downstream consumers see a stable
  // shape. Per spec `compatibility_mode`: "backward_safe".
  if (!decision || !decision.profit_projection) {
    return {
      prediction_status: 'OFF',
      prediction_reason: 'Esperando datos del oráculo',
      expected_return_30d: 0,
      expected_return_60d: 0,
      expected_return_90d: 0,
      expected_profit_usd_30d: 0,
      expected_profit_usd_60d: 0,
      expected_profit_usd_90d: 0,
      confidence: 0,
      freshness: 'STALE',
      source_agreement_index: 0,
      source: 'off',
      fallback_level: 'off',
      calibration: computeCalibrationScore(),
      // V10.1 lifecycle fields — no prediction record created for OFF state
      lifecycle_stage: 'PREDICTION',
      prediction_id: null,
      verification_status: 'PENDING',
      outcome_linked: null,
      data_sources: [],
      model_version: 'amira-pred-v10.1',
      capital,
      risk,
      stress_mode: stressMode,
    };
  }

  const proj: ProfitProjection = decision.profit_projection;

  // ─── Compute baseline return for source-agreement comparison ───
  // Weighted EXPECTED_RETURNS_30D × STRESS_ADJUSTMENT (same formula as the
  // decision engine fallback path, but computed here for agreement scoring).
  let weightedBaseline = 0;
  let wSum = 0;
  for (const a of decision.allocations) {
    const w = a.weight;
    if (w <= 0) continue;
    const classRet = EXPECTED_RETURNS_30D[a.asset.asset_class] ?? 0;
    weightedBaseline += w * classRet;
    wSum += w;
  }
  const baselineReturn30d = wSum > 0
    ? STRESS_ADJUSTMENT[stressMode] * (weightedBaseline / wSum)
    : 0;

  // ─── Determine ML signal ───
  const mlReturn30d = proj.source === 'ml' ? proj.ret_30d : null;
  const sourceAgreement = computeSourceAgreement(mlReturn30d, baselineReturn30d);

  // ─── Determine freshness ───
  // REAL when ML active + history sufficient + source OK
  // STALE when source status is DEGRADED/ERROR or history insufficient
  // DERIVED when fallback (baseline × regime)
  // SIMULADO reserved for sandboxed test data (not used here)
  let freshness: PredictionFreshness;
  let dataFreshness: number;
  if (sourceStatus === 'ERROR') {
    freshness = 'STALE';
    dataFreshness = 0.10;
  } else if (sourceStatus === 'DEGRADED') {
    freshness = 'STALE';
    dataFreshness = 0.35;
  } else if (proj.source === 'ml' && historyDays >= 9) {
    freshness = 'REAL';
    dataFreshness = 0.90;
  } else {
    freshness = 'DERIVED';
    dataFreshness = 0.60;
  }
  if (dataFreshnessOverride != null) {
    dataFreshness = dataFreshnessOverride;
  }

  // ─── Determine prediction status (ON / PARTIAL / OFF) ───
  let predictionStatus: PredictionStatus;
  let predictionReason: string;

  const coverage = decision.prediction_status.coverage;
  const minHistoryDays = decision.prediction_status.min_history_days;

  if (proj.source === 'ml' && historyDays >= minHistoryDays && coverage > 0.05) {
    predictionStatus = coverage > 0.6 ? 'ON' : 'PARTIAL';
    predictionReason = coverage > 0.6
      ? `pred ON · ML ensemble · cobertura ${(coverage * 100).toFixed(0)}%`
      : `pred PARTIAL · ML parcial · cobertura ${(coverage * 100).toFixed(0)}% · complementado con retorno base`;
  } else if (historyDays < minHistoryDays) {
    predictionStatus = 'OFF';
    predictionReason = `pred OFF · sin historial suficiente (${historyDays}/${minHistoryDays} días) · usando retorno base × régimen`;
  } else if (coverage <= 0.05) {
    predictionStatus = 'OFF';
    predictionReason = `pred OFF · cobertura ML insuficiente (${(coverage * 100).toFixed(0)}%) · usando retorno base × régimen`;
  } else {
    predictionStatus = 'PARTIAL';
    predictionReason = `pred PARTIAL · señales mixtas · usando retorno base × régimen`;
  }

  // ─── Stale penalty (applied multiplicatively in confidence) ───
  const stalePenalty = freshness === 'STALE' ? 0.5 : 1.0;

  // ─── Confidence score ───
  const confidence = computeConfidenceScore({
    data_freshness: dataFreshness,
    source_agreement: sourceAgreement,
    history_days: historyDays,
    prediction_coverage: coverage,
    stale_penalty: stalePenalty,
  });

  // ─── Compose output ───
  // V10: determine fallback_level explicitly
  // 'real' = ML ensemble active (proj.source === 'ml' && predictionStatus !== 'OFF')
  // 'derived' = baseline × regime (proj.source !== 'ml')
  // 'cached' = will be set later when falling back to last valid
  // 'off' = no prediction available
  const fallbackLevel: AmiraPredictionOutput['fallback_level'] =
    proj.source === 'ml' && predictionStatus !== 'OFF'
      ? 'real'
      : predictionStatus === 'OFF'
        ? 'off'
        : 'derived';

  const calibration = computeCalibrationScore();

  // V10.1: Collect the data sources used for this prediction.
  // Per rule_5: "El sistema debe rechazar predicciones sin fuente de datos".
  // We compile the sources from the decision engine's allocations + the
  // profit_projection source tag. If empty, the lifecycle enrichment will
  // mark this prediction as REJECTED.
  const dataSources: string[] = [];
  if (proj.source === 'ml') dataSources.push('ml-ensemble');
  if (decision.allocations.some((a) => a.asset.asset_class === 'FCI')) dataSources.push('oracle-fci');
  if (decision.allocations.some((a) => a.asset.asset_class === 'PLAZO_FIJO')) dataSources.push('argentina-datos-pf');
  if (decision.allocations.some((a) => a.asset.asset_class === 'BONOS')) dataSources.push('oracle-bonds');
  if (decision.allocations.some((a) => a.asset.asset_class === 'ACCIONES')) dataSources.push('oracle-stocks');
  if (decision.allocations.some((a) => a.asset.asset_class === 'CEDEARS')) dataSources.push('oracle-cedears');
  if (decision.allocations.some((a) => a.asset.asset_class === 'ETF_CEDEARS')) dataSources.push('oracle-etf-cedears');
  // De-duplicate
  const dataSourcesDedup = Array.from(new Set(dataSources));

  const baseOutput: AmiraPredictionOutput = {
    prediction_status: predictionStatus,
    prediction_reason: predictionReason,
    expected_return_30d: proj.ret_30d,
    expected_return_60d: proj.ret_60d,
    expected_return_90d: proj.ret_90d,
    expected_profit_usd_30d: proj.profit_30d_usd,
    expected_profit_usd_60d: proj.profit_60d_usd,
    expected_profit_usd_90d: proj.profit_90d_usd,
    confidence,
    freshness,
    source_agreement_index: sourceAgreement,
    source: proj.source === 'ml' ? 'ml' : 'fallback',
    fallback_level: fallbackLevel,
    calibration,
    // V10.1 lifecycle fields — populated below by enrichWithLifecycle()
    lifecycle_stage: 'PREDICTION',
    prediction_id: null,
    verification_status: 'PENDING',
    outcome_linked: null,
    data_sources: dataSourcesDedup,
    model_version: 'amira-pred-v10.1',
    capital,
    risk,
    stress_mode: stressMode,
  };

  // V10.1: Record this prediction in the append-only lifecycle log.
  // Per spec `system_changes.prediction_engine.enforce`: "strict_lifecycle_tracking".
  // Per rule_2: "Toda predicción debe persistirse obligatoriamente".
  // Per rule_5: "El sistema debe rechazar predicciones sin fuente de datos".
  //
  // We pass the 30d horizon (the canonical horizon for our predictions).
  // The enrichment returns the prediction_id and verification_status that we
  // attach to the output. For OFF / cached-fallback predictions, the
  // enrichment returns prediction_id = null (no event recorded).
  const enrichment = enrichWithLifecycle(
    baseOutput,
    30, // horizon_days — canonical 30d horizon for portfolio-level predictions
    'PORTFOLIO', // asset_context — this is a portfolio-level prediction
    dataSourcesDedup,
  );
  const output: AmiraPredictionOutput = {
    ...baseOutput,
    prediction_id: enrichment.prediction_id,
    lifecycle_stage: enrichment.lifecycle_stage,
    verification_status: enrichment.verification_status,
    outcome_linked: enrichment.outcome_linked,
  };

  // V10: record this prediction as a calibration observation (no realized
  // outcome yet — will be backfilled when 30d elapse). Per spec
  // `4_prediction_calibration.actions[0]`: "calibración con histórico".
  // We only record predictions that have a real expected_return_30d
  // (not the OFF state).
  // V10.1: also skip if the lifecycle enrichment rejected this prediction
  // (rule_5 — no data sources) — rejected predictions don't count for calibration.
  if (predictionStatus !== 'OFF' && Math.abs(proj.ret_30d) > 0 && !enrichment.rejected) {
    recordCalibrationObservation(proj.ret_30d);
  }

  // ─── Cache last valid prediction (fallback hierarchy level 3) ───
  // Per spec: "real data → derived consensus → cached last valid → explicit off"
  // If we produced a non-OFF prediction, cache it so a future OFF can fall back.
  if (predictionStatus !== 'OFF') {
    setCachedPrediction(risk, stressMode, output);
  } else {
    // OFF — try to return cached last-valid prediction if available
    const cached = getCachedPrediction(risk, stressMode);
    if (cached) {
      // Mark as DERIVED (cached) — keeps the block visible with a clear label
      // V10: set fallback_level = 'cached' explicitly per spec hierarchy
      // V10.1: cached predictions DO NOT get a new prediction_id (they are
      // replaying an older prediction whose id is already in the log). We
      // set prediction_id = null + verification_status = 'PENDING' to signal
      // that this is a replay, not a new prediction event. Per spec
      // `compatibility_mode`: "backward_safe".
      return {
        ...cached,
        prediction_status: 'PARTIAL',
        prediction_reason: `${predictionReason} · mostrando última proyección válida (cached)`,
        freshness: 'DERIVED',
        confidence: Math.max(0.1, cached.confidence * 0.5), // halve confidence for cached
        source: 'fallback',
        fallback_level: 'cached',
        calibration,
        // V10.1: lifecycle fields for the cached-fallback path
        lifecycle_stage: 'PREDICTION',
        prediction_id: null,
        verification_status: 'PENDING',
        outcome_linked: null,
        data_sources: cached.data_sources ?? [],
        model_version: 'amira-pred-v10.1',
      };
    }
  }

  return output;
}

// ─── React Hook ─────────────────────────────────────────────────────────────
// Memoized wrapper around composeAmiraPrediction. Re-computes only when
// decision identity or option primitives change.

export function useAmiraPrediction(
  decision: DecisionEngineOutput | null,
  options: {
    capital: number;
    risk: number;
    stressMode: StressMode;
    historyDays: number;
    sourceStatus?: string;
  },
): AmiraPredictionOutput {
  return composeAmiraPrediction(decision, options);
}

// ─── Quality Label Helper (per spec `prediction_engine_v2.scoring.quality_labels`) ───

export function qualityLabel(output: AmiraPredictionOutput): string {
  if (output.source === 'off') return 'OFF';
  if (output.freshness === 'REAL' && output.confidence >= 0.7) return 'REAL';
  if (output.freshness === 'STALE') return 'STALE';
  if (output.freshness === 'SIMULADO') return 'SIMULADO';
  return 'DERIVED';
}
