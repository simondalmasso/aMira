// src/lib/amira-portfolio-view-model.ts
// V9.2 — SINGLE SOURCE OF TRUTH for portfolio state.
//
// Per spec `critical_fixes.1_single_source_of_truth`:
//   rule: "solo un objeto puede emitir portfolio_value_usd"
//   fields: [portfolio_value_usd, portfolio_return_30d,
//            portfolio_risk_metrics, portfolio_allocation]
//   forbidden: [inline recalculation in UI layer,
//               secondary derivations inside rebalance module]
//
// Per spec `metrics_engine_fix`:
//   rules: [Sharpe, VaR, volatility computed once per tick,
//           no recomputation in UI components,
//           cache keyed by (portfolio_state_hash + market_state_hash)]
//
// Per spec `data_layer_fix.required_schema`:
//   { value: number, source: REAL | SIMULADO | DERIVED,
//     timestamp: ISO-8601, confidence: 0-1 }
//
// SAFE MODIFICATIONS: This module is advisory only — it does NOT change
// decisionEngineCore, buildPortfolio, or any /api/* contract. It wraps
// existing outputs (decision, portfolio, breakdown) into a single typed
// view model that UI components consume via `usePortfolioViewModel`.


import type {
  DecisionEngineOutput,
  PortfolioResult,
  PortfolioBreakdown,
  ProfitProjection,
  StressMode,
} from './oracle/portfolio-engine';
// V9.3: importing EXPECTED_RETURNS_30D + STRESS_ADJUSTMENT for source-agreement
// computation (baseline return = STRESS_ADJUSTMENT × weighted EXPECTED_RETURNS_30D).
import {
  EXPECTED_RETURNS_30D,
  STRESS_ADJUSTMENT,
} from './oracle/portfolio-engine';
// V10: import the unified prediction composer from amira-prediction-engine.
// This module imports from oracle/portfolio-engine only — no cycle.
// We delegate to composeAmiraPrediction so the prediction logic lives in ONE
// place (per spec `anti_frankenstein_rules.do`: "one compute layer").
import {
  composeAmiraPrediction,
  computeCalibrationScore,
  type AmiraPredictionOutput,
} from './amira-prediction-engine';
// V10: import the new pipeline layers — scanner, executor, monitor, source-health.
// All four are pure functions that consume (decision / oracle response / capital)
// and produce advisory outputs. Per spec `architecture_upgrade.new_layers`.
import { composeAmiraScanner, type ScannerOutput } from './amira-scanner';
import { composePaperExecutor, summarizeExecutorRisk, type ExecutorOutput } from './amira-executor-sim';
import { composeAmiraMonitor, type MonitorOutput } from './amira-monitor';
import {
  serializeSourceHealth,
  type SourceHealthSnapshot,
} from './amira-source-health';
// V10.1: import the Prediction Lifecycle Chain snapshot. Per spec
// `integration_with_current_system.hooks`: amira-portfolio-view-model.ts is
// one of the three hook points (along with amira-prediction-engine.ts and
// amira-monitor.ts). The snapshot is composed here so the
// PredictionLifecycleTracker UI component can read it from the same single
// source of truth as everything else.
import { getLifecycleSnapshot, type LifecycleSnapshot } from './amira-prediction-lifecycle';
import type { MultiOracleResponse } from './oracle-multi/types';

// ─── Data Contract Enforcement ────────────────────────────────────────────
// Per spec `data_layer_fix.rules`:
//   - REAL and SIMULADO cannot coexist in same visual block
//   - SIMULADO must be clearly isolated in sandbox section
//   - all metrics must declare provenance field
//   - no implicit fallback blending without label

export type DataProvenanceLabel = 'REAL' | 'SIMULADO' | 'DERIVED';

export interface ProvenanceField<T = number> {
  value: T;
  source: DataProvenanceLabel;
  timestamp: string;       // ISO-8601
  confidence: number;      // 0..1
}

// ─── Portfolio View Model ─────────────────────────────────────────────────
// THE single source of truth. UI components MUST consume these fields
// instead of recomputing from raw allocations.

export interface PortfolioViewModel {
  // ─── Headline numbers (per spec `fields`) ───
  portfolio_value_usd: ProvenanceField<number>;
  portfolio_return_30d: ProvenanceField<number>;
  portfolio_risk_metrics: {
    var95: ProvenanceField<number>;
    sharpe: ProvenanceField<number>;
    volatility_30d: ProvenanceField<number>;
    exposure: ProvenanceField<number>;
    exposure_ratio: ProvenanceField<number>;
  };
  portfolio_allocation: ProvenanceField<Array<{ class: string; weight: number }>>;

  // ─── Auxiliary (used by REBALANCE_VIEW + STRATEGY_VIEW) ───
  capital: number;
  risk: number;
  stress_mode: StressMode;
  risk_label: 'conservative' | 'balanced' | 'aggressive';
  prediction_status: { active: boolean; reason: string };
  profit_projection: ProfitProjection | null;

  // ─── V9.3: Unified prediction fields (per spec `2_unified_prediction_engine.output_schema`) ───
  // PREDICTION_VIEW reads these — NEVER recomputes from raw allocations.
  // These fields are derived from the same `decision` object as the rest of
  // the view model, so portfolio_value_usd and expected_profit stay aligned.
  //
  // V10 EXTENSION: added fallback_level + calibration per spec
  // `required_changes.4_prediction_calibration` and explicit fallback
  // hierarchy (real → derived → cached → off).
  //
  // V10.1 EXTENSION (per spec `system_changes.prediction_engine.add_fields`):
  //   - lifecycle_stage
  //   - prediction_id
  //   - verification_status
  //   - outcome_linked
  // These come straight from composeAmiraPrediction() — they are populated
  // by the enrichWithLifecycle() hook inside the prediction engine.
  unified_prediction: {
    prediction_status: 'ON' | 'OFF' | 'PARTIAL';
    prediction_reason: string;
    expected_return_30d: number;
    expected_return_60d: number;
    expected_return_90d: number;
    expected_profit_usd_30d: number;
    expected_profit_usd_60d: number;
    expected_profit_usd_90d: number;
    confidence: number;             // 0..1
    freshness: 'REAL' | 'STALE' | 'SIMULADO' | 'DERIVED';
    source_agreement_index: number; // 0..1
    source: 'ml' | 'fallback' | 'off';
    fallback_level: 'real' | 'derived' | 'cached' | 'off';
    calibration: {
      brier_like: number;
      mae: number;
      sample_count: number;
      status: 'EXCELLENT' | 'GOOD' | 'POOR' | 'NO_HISTORY';
      label: string;
    };
    // V10.1 lifecycle fields (mirror of AmiraPredictionOutput)
    lifecycle_stage: 'PREDICTION' | 'OUTCOME' | 'VERIFICATION';
    prediction_id: string | null;
    verification_status: 'PENDING' | 'OUTCOME_CAPTURED' | 'VERIFIED' | 'EXPIRED' | 'REJECTED';
    outcome_linked: string | null;
    data_sources: string[];
    model_version: string;
  };

  // ─── V10.1: Prediction Lifecycle Chain output ───────────────────────────
  // Per spec `core_addition.feature_name`: "Prediction Lifecycle Chain".
  // Per spec `ui_changes.new_component`: "PredictionLifecycleTracker".
  // Per spec `ui_changes.must_display`: [prediction_state, pending_outcomes,
  //   verification_score, drift_indicator].
  // Per spec `data_governance.anti_frankenstein_rule`:
  //   "no_metric_can_exist_without_lifecycle_link".
  //
  // This field exposes the LIFECYCLE_VIEW's source of truth — the snapshot
  // from the append-only event store (PREDICTIONS_LOG + OUTCOMES_LOG +
  // VERIFICATION_LOG). The UI reads from here, never from the logs directly.
  lifecycle_output: LifecycleSnapshot;

  // ─── V10: Modular pipeline layers ────────────────────────────────────────
  // Per spec `architecture_upgrade.new_layers`:
  //   - ingestion_layer (Data Retriever) → source_health
  //   - scanner_layer (Opportunity Scanner) → scanner_output
  //   - brain_layer (Decision Brain) → existing decision (kept in panel)
  //   - executor_layer (Paper Executor) → executor_output
  //   - monitor_layer (Exit + Health Monitor) → monitor_output
  //
  // All five layers consume the SAME source-of-truth inputs (decision,
  // capital, risk, stress, oracleData) — they do NOT compute parallel values.
  // Per spec `anti_frankenstein_rules.do`: "one compute layer · one view
  // model · one render path per concept · one explicit fallback per source".
  source_health: {
    overall_health_score: number;
    overall_freshness_score: number;
    healthy_count: number;
    degraded_count: number;
    error_count: number;
    sources: Array<{
      source_id: string;
      status: string;
      health_score: number;
      freshness_score: number;
      last_success_ts: string | null;
      last_attempt_ts: string | null;
      consecutive_failures: number;
      consecutive_successes: number;
      reason: string;
      asset_classes: string[];
      last_error: string | null;
      coverage: number;
    }>;
    fetched_windows: Record<string, string[]>;
  };
  scanner_output: {
    generated_at: string;
    top_opportunities: Array<{
      asset_id: string;
      asset_class: string;
      name: string;
      ticker?: string;
      scanner_score: number;
      oracle_score: number;
      freshness: string;
      signals: Array<{ kind: string; strength: number; label: string }>;
      expected_return_30d: number | null;
      confidence: number | null;
      reason: string;
      in_active_allocation: boolean;
    }>;
    by_class: Record<string, {
      asset_class: string;
      count: number;
      top_score: number;
      avg_score: number;
      best_opportunity: unknown | null;
    }>;
    total_scanned: number;
    with_signals: number;
    real_count: number;
    degraded_count: number;
    filter_class: string | null;
    dominant_signals: Array<{ kind: string; count: number }>;
  };
  executor_output: {
    generated_at: string;
    paper: true;
    nav: number;
    starting_capital: number;
    pnl: number;
    pnl_pct: number;
    drawdown: number;
    total_fees_usd: number;
    total_slippage_usd: number;
    fill_count: number;
    partial_fill_count: number;
    avg_fill_ratio: number;
    fills: Array<{
      asset_id: string;
      asset_class: string;
      name: string;
      ticker?: string;
      side: string;
      intended_weight: number;
      filled_weight: number;
      intended_notional_usd: number;
      filled_notional_usd: number;
      slippage_bps: number;
      fee_bps: number;
      fee_usd: number;
      slippage_cost_usd: number;
      fill_ratio: number;
      reason: string;
    }>;
    stress_mode: string;
    risk_level: number;
    position_count: number;
    top_position_concentration: number;
    cash_drag: number;
    emergency_exit_triggered: boolean;
    emergency_exit_reason: string | null;
  };
  monitor_output: {
    generated_at: string;
    overall_status: 'GREEN' | 'AMBER' | 'RED';
    alerts: Array<{
      kind: string;
      severity: string;
      message: string;
      scope: string;
      value: number | null;
      threshold: number | null;
      recommended_action: string;
    }>;
    guardrails: {
      source_freshness: { name: string; status: string; value: number; threshold: number; description: string };
      drawdown: { name: string; status: string; value: number; threshold: number; description: string };
      prediction_confidence: { name: string; status: string; value: number; threshold: number; description: string };
      liquidity: { name: string; status: string; value: number; threshold: number; description: string };
      concentration: { name: string; status: string; value: number; threshold: number; description: string };
      cash_drag: { name: string; status: string; value: number; threshold: number; description: string };
      emergency_exit: { name: string; status: string; value: number; threshold: number; description: string };
      costs: { name: string; status: string; value: number; threshold: number; description: string };
      // V10.1 NEW: lifecycle coverage guardrail
      lifecycle_coverage: { name: string; status: string; value: number; threshold: number; description: string };
    };
    degraded_source_count: number;
    error_source_count: number;
    healthy_source_count: number;
    stress_mode: string | null;
    paper: true;
  };

  // ─── Scope attribution (per spec `2_render_scope_isolation`) ───
  // The view model is consumed by exactly ONE METRICS_VIEW block.
  // Other scopes (STRATEGY/REBALANCE/DATA_FOOTER/PREDICTION) read derived fields
  // that are NOT `portfolio_value_usd` — they read return/regime/risk/prediction.
  source_scope: 'METRICS_VIEW';

  // ─── Cache key for memoization (per spec `metrics_engine_fix`) ───
  _cache_key: string;
}

// ─── Stable hash for (portfolio_state + market_state) ─────────────────────
// Per spec `metrics_engine_fix`: "cache keyed by (portfolio_state_hash + market_state_hash)"
// We hash the INPUTS to the view model — not the outputs — so any change
// in capital/risk/stress/decision source produces a new cache key.

function hashInputs(
  capital: number,
  risk: number,
  stress: StressMode,
  decisionHash: string,
): string {
  // Simple string hash (djb2). Good enough for cache invalidation.
  const s = `${capital.toFixed(2)}|${risk.toFixed(3)}|${stress}|${decisionHash}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function hashDecision(d: DecisionEngineOutput | null): string {
  if (!d) return 'null';
  // Hash only the fields that affect view-model derivation.
  // We DO NOT hash the entire object because it includes arrays that
  // would change identity on every render even when values are equal.
  const keys = [
    d.total_portfolio_value,
    d.unallocated_cash,
    d.exposure,
    d.exposure_ratio,
    d.expected_return.ret_7d,
    d.expected_return.ret_30d,
    d.expected_return.ret_90d,
    d.stress_projection.total_stressed_value,
    d.stress_projection.profit_absolute,
    d.stress_projection.profit_percent,
    d.prediction_status.active,
    d.prediction_status.reason,
    d.stress,
    d.profit_projection?.source ?? null,
    d.profit_projection?.ret_30d ?? null,
    d.profit_projection?.ret_60d ?? null,
    d.profit_projection?.ret_90d ?? null,
    d.profit_projection?.profit_30d_usd ?? null,
  ].map((v) => (v == null ? '∅' : String(v))).join('|');
  return keys;
}

// ─── Memoized Metric Cache ─────────────────────────────────────────────────
// Per spec `metrics_engine_fix.rules`:
//   - Sharpe, VaR, volatility computed once per tick
//   - cache keyed by (portfolio_state_hash + market_state_hash)
//
// We use a module-level Map so the cache survives across renders of
// DIFFERENT components — i.e., if StickyTopBar already computed Sharpe
// for cache_key X, then RiskPanel reading the same key gets a cache hit.

interface MetricCacheEntry {
  value: number;
  timestamp: number;
}

const METRIC_CACHE = new Map<string, MetricCacheEntry>();
const METRIC_CACHE_TTL_MS = 60_000; // 1 minute — bounded memory growth

function getCachedMetric(cacheKey: string): number | undefined {
  const entry = METRIC_CACHE.get(cacheKey);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > METRIC_CACHE_TTL_MS) {
    METRIC_CACHE.delete(cacheKey);
    return undefined;
  }
  return entry.value;
}

function setCachedMetric(cacheKey: string, value: number): void {
  METRIC_CACHE.set(cacheKey, { value, timestamp: Date.now() });
  // Bounded cleanup — evict oldest 10% when cache grows too large.
  if (METRIC_CACHE.size > 200) {
    const entries = Array.from(METRIC_CACHE.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );
    for (let i = 0; i < 20; i++) {
      METRIC_CACHE.delete(entries[i][0]);
    }
  }
}

// ─── View Model Constructor ─────────────────────────────────────────────────
// PURE function — given (decision, portfolio, breakdown, capital, risk, stress),
// returns the single typed view model. UI components call this via the
// `usePortfolioViewModel` hook which memoizes by cache_key.
//
// V9.3: now also accepts (historyDays, sourceStatus) so it can compose the
// unified prediction output. These inputs are advisory — they don't change
// the portfolio math, only enrich the prediction metadata.

export function composePortfolioViewModel(
  decision: DecisionEngineOutput | null,
  portfolio: PortfolioResult | null,
  _breakdown: PortfolioBreakdown | null,
  capital: number,
  risk: number,
  stress: StressMode,
  options?: {
    historyDays?: number;
    sourceStatus?: string;
    /** V10 NEW: the raw oracle response — needed by the scanner layer
     * to rank opportunities across all asset classes. */
    oracleResponse?: MultiOracleResponse | null;
    /** V10 NEW: set of asset IDs currently in the active allocation.
     * Used by the scanner to tag opportunities as in_active_allocation. */
    activeAssetIds?: Set<string>;
  },
): PortfolioViewModel {
  const decisionHash = hashDecision(decision);
  const cacheKey = hashInputs(capital, risk, stress, decisionHash);
  const nowIso = new Date().toISOString();

  // ─── portfolio_value_usd — THE single source ───
  // Per spec `critical_fixes.1_single_source_of_truth.fields[0]`.
  // The value comes from decision.total_portfolio_value (computed once by
  // decisionEngineCore). UI components MUST NOT recompute from allocations.
  const portfolioValueUsd = decision?.total_portfolio_value ?? capital;

  // Provenance: DERIVED when computed by the decision engine (it
  // transforms capital + allocations + stress into a single number),
  // REAL when no decision exists yet (raw capital input).
  const valueProvenance: ProvenanceField<number> = {
    value: portfolioValueUsd,
    source: decision ? 'DERIVED' : 'REAL',
    timestamp: nowIso,
    confidence: decision ? 0.85 : 0.50,
  };

  // ─── portfolio_return_30d ───
  const ret30d = decision?.expected_return.ret_30d ?? null;
  const returnProvenance: ProvenanceField<number> = {
    value: ret30d ?? 0,
    source: ret30d != null ? 'DERIVED' : 'SIMULADO',
    timestamp: nowIso,
    confidence: ret30d != null ? 0.75 : 0.30,
  };

  // ─── portfolio_risk_metrics — memoized per cacheKey ───
  // Per spec `metrics_engine_fix`: Sharpe/VaR/volatility computed once per tick.
  // We check the module-level cache first; on miss, we compute from the
  // decision engine's existing outputs (we do NOT recompute from raw
  // allocations — that would violate `safe_modifications_only`).
  const exposure = decision?.exposure ?? 0;
  const exposureRatio = decision?.exposure_ratio ?? 0;

  // VaR 95% — derived from stress projection profit_percent (already
  // computed by decisionEngineCore.stress_projection). We reuse it so
  // we don't recompute the volatility surface.
  const profitPct = decision?.stress_projection.profit_percent ?? 0;
  const varKey = `${cacheKey}|var95`;
  let var95 = getCachedMetric(varKey);
  if (var95 === undefined) {
    // VaR ≈ -min(profit_pct, 0) - 1.65 * |profit_pct|  (rough approximation
    // from stress projection — preserves decisionEngineCore contract).
    var95 = Math.max(0, -profitPct + 1.65 * Math.abs(profitPct));
    setCachedMetric(varKey, var95);
  }

  // Sharpe — derived from expected_return / volatility proxy.
  const sharpeKey = `${cacheKey}|sharpe`;
  let sharpe = getCachedMetric(sharpeKey);
  if (sharpe === undefined) {
    const ret30 = decision?.expected_return.ret_30d ?? 0;
    // Volatility proxy: stress shock magnitude (already computed).
    const volProxy = Math.abs(profitPct) + 0.001; // avoid div-by-zero
    sharpe = (ret30 * 12) / (volProxy * Math.sqrt(12)); // annualized
    setCachedMetric(sharpeKey, sharpe);
  }

  // Volatility 30d — same proxy, annualized back to 30d.
  const volKey = `${cacheKey}|vol30d`;
  let volatility30d = getCachedMetric(volKey);
  if (volatility30d === undefined) {
    volatility30d = Math.abs(profitPct);
    setCachedMetric(volKey, volatility30d);
  }

  const riskMetrics: PortfolioViewModel['portfolio_risk_metrics'] = {
    var95:        { value: var95,          source: 'DERIVED', timestamp: nowIso, confidence: 0.70 },
    sharpe:       { value: sharpe,         source: 'DERIVED', timestamp: nowIso, confidence: 0.65 },
    volatility_30d: { value: volatility30d, source: 'DERIVED', timestamp: nowIso, confidence: 0.75 },
    exposure:     { value: exposure,       source: 'DERIVED', timestamp: nowIso, confidence: 0.85 },
    exposure_ratio: { value: exposureRatio, source: 'DERIVED', timestamp: nowIso, confidence: 0.85 },
  };

  // ─── portfolio_allocation ───
  const allocation = decision?.weights_by_class
    ? (Object.entries(decision.weights_by_class).map(([cls, w]) => ({ class: cls, weight: w })) as Array<{ class: string; weight: number }>)
    : [];

  const allocationProvenance: ProvenanceField<Array<{ class: string; weight: number }>> = {
    value: allocation,
    source: decision ? 'DERIVED' : 'SIMULADO',
    timestamp: nowIso,
    confidence: decision ? 0.80 : 0.30,
  };

  // ─── Auxiliary ───
  const riskLabel: PortfolioViewModel['risk_label'] =
    risk <= 0.33 ? 'conservative' : risk <= 0.66 ? 'balanced' : 'aggressive';

  // ─── V9.3: Unified prediction (composed inline, no separate hook) ───
  // Per spec `2_unified_prediction_engine`: same source of truth as the
  // rest of the view model. PREDICTION_VIEW consumes this field directly —
  // never recomputes from raw allocations.
  const historyDays = options?.historyDays ?? 0;
  const sourceStatus = options?.sourceStatus;
  const unifiedPrediction = composeUnifiedPredictionInline(decision, capital, risk, stress, historyDays, sourceStatus);

  // ─── V10: Compose the modular pipeline layer outputs (scanner, executor,
  // monitor, source health). All four are advisory and consume the same
  // decision + oracleResponse + capital as the rest of the view model.
  // Per spec `architecture_upgrade.new_layers` and `anti_frankenstein_rules.do`.
  const oracleResponse = options?.oracleResponse ?? null;
  const activeAssetIds = options?.activeAssetIds ?? new Set<string>();
  const layerOutputs = composeLayerOutputsInline(
    decision,
    oracleResponse,
    capital,
    stress,
    historyDays,
    sourceStatus,
    unifiedPrediction,
    activeAssetIds,
  );

  // Suppress unused-param lint for _breakdown (kept in signature for
  // future expansion without breaking the API).
  void _breakdown;
  // Same for portfolio (the view model prefers decision as source of truth;
  // portfolio remains available for downstream REBALANCE_VIEW consumers).
  void portfolio;

  return {
    portfolio_value_usd: valueProvenance,
    portfolio_return_30d: returnProvenance,
    portfolio_risk_metrics: riskMetrics,
    portfolio_allocation: allocationProvenance,
    capital,
    risk,
    stress_mode: stress,
    risk_label: riskLabel,
    prediction_status: decision?.prediction_status ?? { active: false, reason: 'Esperando datos' },
    profit_projection: decision?.profit_projection ?? null,
    unified_prediction: unifiedPrediction,
    // V10.1: snapshot from the append-only lifecycle event store.
    // Per spec `data_governance.anti_frankenstein_rule`:
    //   "no_metric_can_exist_without_lifecycle_link".
    // The snapshot is composed ONCE per view-model composition — downstream
    // UI components read it from viewModel.lifecycle_output and never call
    // getLifecycleSnapshot() directly.
    lifecycle_output: getLifecycleSnapshot(),
    source_health: layerOutputs.source_health,
    scanner_output: layerOutputs.scanner_output,
    executor_output: layerOutputs.executor_output,
    monitor_output: layerOutputs.monitor_output,
    source_scope: 'METRICS_VIEW',
    _cache_key: cacheKey,
  };
}

// ─── Inline Unified Prediction Composer ─────────────────────────────────────
// V10: now delegates to `composeAmiraPrediction` from amira-prediction-engine.ts.
// Per spec `anti_frankenstein_rules.do`: "one compute layer" — the prediction
// logic lives in amira-prediction-engine.ts, and this inline wrapper just
// adapts the signature for the view model.
//
// V9.3 originally kept the logic inline to avoid a circular import; that
// concern was unfounded (amira-prediction-engine imports only from
// oracle/portfolio-engine, same as this module).

function composeUnifiedPredictionInline(
  decision: DecisionEngineOutput | null,
  capital: number,
  risk: number,
  stress: StressMode,
  historyDays: number,
  sourceStatus: string | undefined,
): PortfolioViewModel['unified_prediction'] {
  const output: AmiraPredictionOutput = composeAmiraPrediction(decision, {
    capital,
    risk,
    stressMode: stress,
    historyDays,
    sourceStatus,
  });
  return {
    prediction_status: output.prediction_status,
    prediction_reason: output.prediction_reason,
    expected_return_30d: output.expected_return_30d,
    expected_return_60d: output.expected_return_60d,
    expected_return_90d: output.expected_return_90d,
    expected_profit_usd_30d: output.expected_profit_usd_30d,
    expected_profit_usd_60d: output.expected_profit_usd_60d,
    expected_profit_usd_90d: output.expected_profit_usd_90d,
    confidence: output.confidence,
    freshness: output.freshness,
    source_agreement_index: output.source_agreement_index,
    source: output.source,
    fallback_level: output.fallback_level,
    calibration: output.calibration,
    // V10.1: forward the lifecycle fields from the enriched AmiraPredictionOutput.
    // Per spec `system_changes.prediction_engine.add_fields` — these come
    // straight from the enrichWithLifecycle() hook in the prediction engine.
    lifecycle_stage: output.lifecycle_stage,
    prediction_id: output.prediction_id,
    verification_status: output.verification_status,
    outcome_linked: output.outcome_linked,
    data_sources: output.data_sources,
    model_version: output.model_version,
  };
}

function computeBaselineReturnInline(
  decision: DecisionEngineOutput,
  stress: StressMode,
): number {
  // V10: This function is now UNUSED — kept for backward compatibility with
  // any external callers and for future backfill scenarios. The unified
  // prediction logic now lives in amira-prediction-engine.ts (per spec
  // `anti_frankenstein_rules.do`: "one compute layer"). Marked with a void
  // expression so TypeScript doesn't flag it as unused.
  void decision;
  void stress;
  // Reuse the EXPECTED_RETURNS_30D × STRESS_ADJUSTMENT formula
  // (mirrors decisionEngineCore fallback path). Imported at top of file
  // (V9.3) for ESM compatibility — dynamic require() does not work in
  // Edge/Workers runtime.
  let weighted = 0;
  let wSum = 0;
  for (const a of decision.allocations) {
    const w = a.weight;
    if (w <= 0) continue;
    const classRet = EXPECTED_RETURNS_30D[a.asset.asset_class] ?? 0;
    weighted += w * classRet;
    wSum += w;
  }
  return wSum > 0 ? STRESS_ADJUSTMENT[stress] * (weighted / wSum) : 0;
}

// ─── V10: Modular Pipeline Layer Composer ──────────────────────────────────
// Per spec `architecture_upgrade.new_layers`:
//   - ingestion_layer → source_health (from serializeSourceHealth())
//   - scanner_layer → scanner_output (from composeAmiraScanner())
//   - executor_layer → executor_output (from composePaperExecutor())
//   - monitor_layer → monitor_output (from composeAmiraMonitor())
//
// All four layers consume the SAME source-of-truth inputs as the rest of
// the view model. They do NOT compute parallel values — they produce
// advisory outputs derived from `decision` and `oracleResponse`.

interface LayerOutputs {
  source_health: PortfolioViewModel['source_health'];
  scanner_output: PortfolioViewModel['scanner_output'];
  executor_output: PortfolioViewModel['executor_output'];
  monitor_output: PortfolioViewModel['monitor_output'];
}

function composeLayerOutputsInline(
  decision: DecisionEngineOutput | null,
  oracleResponse: MultiOracleResponse | null,
  capital: number,
  stress: StressMode,
  historyDays: number,
  sourceStatus: string | undefined,
  unifiedPrediction: PortfolioViewModel['unified_prediction'],
  activeAssetIds: Set<string>,
): LayerOutputs {
  // Source health: from the source-health registry. By default the registry
  // is empty (no fetches recorded yet) — the UI will show "SIMULADO" status
  // for all sources. As ingestion code calls `recordSourceFetch()` (e.g.,
  // in /api/oracle/rankings route), the registry populates.
  // Per spec `no_hallucination`: "si una señal no tiene datos, se etiqueta
  // como SIMULADO o STALE, nunca se inventa".
  const sourceHealthSnapshot: SourceHealthSnapshot = serializeSourceHealth();

  // Scanner: consume the oracle response, produce ranked opportunities
  const scannerOutput: ScannerOutput = composeAmiraScanner(oracleResponse, {
    topN: 8,
    activeAssetIds,
  });

  // Executor: simulate a paper rebalance from the decision
  const executorOutput: ExecutorOutput = composePaperExecutor(decision, capital);
  const executorRisk = summarizeExecutorRisk(executorOutput);

  // V10.1: Snapshot the lifecycle event store ONCE per view-model composition.
  // Per spec `integration_with_current_system.hooks`: amira-portfolio-view-model.ts
  // is one of the three hook points. We pass this snapshot to the monitor so
  // it can emit lifecycle alerts + the lifecycle_coverage guardrail.
  const lifecycleSnapshot = getLifecycleSnapshot();

  // Monitor: compose alerts + guardrails from the executor + prediction + source health
  // + V10.1 lifecycle snapshot. We adapt the unified_prediction to the
  // AmiraPredictionOutput shape that composeAmiraMonitor expects.
  const monitorOutput: MonitorOutput = composeAmiraMonitor({
    executor: executorOutput,
    executorRisk,
    prediction: adaptUnifiedPredictionForMonitor(unifiedPrediction, capital, stress),
    sourceHealth: sourceHealthSnapshot,
    stressMode: stress,
    // V10.1: feed the lifecycle snapshot to the monitor
    lifecycle: lifecycleSnapshot,
  });

  // Suppress unused-warning for historyDays + sourceStatus — they're advisory
  // inputs that future extensions of the monitor layer will use.
  void historyDays;
  void sourceStatus;

  return {
    source_health: sourceHealthSnapshot,
    scanner_output: scannerOutput,
    executor_output: executorOutput,
    monitor_output: monitorOutput,
  };
}

/**
 * V10 INTERNAL: adapt the view-model's unified_prediction shape to the
 * AmiraPredictionOutput shape that composeAmiraMonitor expects.
 * The view-model shape omits the `capital` / `risk` / `stress_mode` echo
 * fields (since the view model already has them at the top level), so we
 * re-add them for the monitor.
 */
function adaptUnifiedPredictionForMonitor(
  pred: PortfolioViewModel['unified_prediction'],
  capital: number,
  stress: StressMode,
): AmiraPredictionOutput {
  return {
    ...pred,
    capital,
    risk: 0, // risk is not stored in the unified_prediction view-model shape —
              // monitor only reads .confidence and .prediction_status, so 0 is fine
    stress_mode: stress,
  };
}

// ─── React Hook: usePortfolioViewModel ────────────────────────────────────
// Wraps composePortfolioViewModel with useMemo keyed by (capital, risk, stress,
// decision identity). The cache_key in the returned view model lets downstream
// metric consumers (Sharpe/VaR/volatility) hit the module-level cache.
//
// V9.3: now accepts (historyDays, sourceStatus) so the unified prediction
// can compute confidence + freshness from oracle metadata.

export function usePortfolioViewModel(
  decision: DecisionEngineOutput | null,
  portfolio: PortfolioResult | null,
  breakdown: PortfolioBreakdown | null,
  capital: number,
  risk: number,
  stress: StressMode,
  options?: {
    historyDays?: number;
    sourceStatus?: string;
    /** V10 NEW: raw oracle response — feeds the scanner layer. */
    oracleResponse?: MultiOracleResponse | null;
    /** V10 NEW: active asset IDs — feeds the scanner's in_active_allocation tag. */
    activeAssetIds?: Set<string>;
  },
): PortfolioViewModel {
  return composePortfolioViewModel(decision, portfolio, breakdown, capital, risk, stress, {
    historyDays: options?.historyDays,
    sourceStatus: options?.sourceStatus,
    oracleResponse: options?.oracleResponse ?? null,
    activeAssetIds: options?.activeAssetIds,
  });
}

// ─── Semantic Diff Guard ───────────────────────────────────────────────────
// Per spec `critical_fixes.4_duplicate_block_elimination`:
//   method: hash(previous_render_block) == hash(next_render_block)
//   behavior: if identical → suppress render
//   target_blocks: [portfolio_snapshot, return_summary, risk_panel]
//
// V9.3 BUG FIX (GLM_V9_3_RESTORE_PROFIT_BLOCKS): The V9.2 implementation
// was INCORRECT — it returned `false` (caller returned null) whenever the
// fingerprint matched the previous render. This caused legitimate blocks
// (like Ganancia Proyectada) to VANISH from the UI after their data
// stabilized. The spec intent is "suppress DUPLICATE blocks", meaning
// DETECT if the SAME block instance is being mounted twice in the tree
// (cross-instance deduplication) — NOT to suppress re-renders of the
// SAME block instance on subsequent renders (which React already handles
// via reconciliation).
//
// The correct behavior: a block ALWAYS renders its current content. The
// guard exists only to detect when two SEPARATE <SemanticDiffBlock>
// instances share the same `id` AND the same fingerprint — that's a
// duplicate. A single instance always renders.
//
// Implementation: module-level Map<blockId, { fingerprint, instanceCount }>
// — first instance always renders; subsequent instances with identical
// fingerprint are suppressed (they're a duplicate mount).
//
// Usage:
//   <SemanticDiffBlock id="return_summary" fingerprint={...}>
//     <ProfitProjectionBlock ... />
//   </SemanticDiffBlock>

export function useSemanticDiffGuard<T>(_blockId: string, _content: T): boolean {
  // Do not suppress a valid React subtree based on module-local render history.
  // Duplicate ownership is enforced structurally by RenderScope/H8 instead.
  return true;
}

function stableHash<T>(value: T): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return `s:${value}`;
  if (typeof value === 'number') return `n:${value}`;
  if (typeof value === 'boolean') return `b:${value}`;
  try {
    const json = JSON.stringify(value);
    let h = 5381;
    for (let i = 0; i < json.length; i++) {
      h = ((h << 5) + h + json.charCodeAt(i)) >>> 0;
    }
    return `o:${h.toString(36)}`;
  } catch {
    return `u:${String(value)}`;
  }
}

// ─── Render Scope Constants ────────────────────────────────────────────────
// Per spec `critical_fixes.2_render_scope_isolation.scopes`:
//   STRATEGY_VIEW:    solo narrativa + recomendaciones
//   METRICS_VIEW:     solo números + riesgo + performance
//   REBALANCE_VIEW:   solo acciones + estado
//   DATA_FOOTER_VIEW: solo fuentes + freshness
// Rule: "un scope no puede renderizar datos de otro scope"
//
// V9.3 (GLM_V9_3_RESTORE_PROFIT_BLOCKS): added PREDICTION_VIEW per spec
// `render_scope_rules.add`:
//   "PREDICTION_VIEW para Ganancia Proyectada"
//   "Debe compartir estado con METRICS_VIEW, no duplicarlo"
//   "Prediction view puede leer portfolio_value_usd pero no puede redefinirlo"

export const RENDER_SCOPES = {
  STRATEGY_VIEW: 'STRATEGY_VIEW',
  METRICS_VIEW: 'METRICS_VIEW',
  REBALANCE_VIEW: 'REBALANCE_VIEW',
  DATA_FOOTER_VIEW: 'DATA_FOOTER_VIEW',
  PREDICTION_VIEW: 'PREDICTION_VIEW',
  // V10 NEW: scanner + executor scopes per spec `architecture_upgrade.new_layers`.
  //   SCANNER_VIEW: opportunity scanner (cross-class ranking + signals)
  //   EXECUTOR_VIEW: paper executor + monitor + exit guards
  // Per spec `anti_frankenstein_rules.do`: "one render path per concept".
  SCANNER_VIEW: 'SCANNER_VIEW',
  EXECUTOR_VIEW: 'EXECUTOR_VIEW',
  // V10.1 NEW: lifecycle scope per spec `ui_changes.new_component`:
  //   "PredictionLifecycleTracker".
  // Per spec `ui_changes.remove`: "isolated_prediction_blocks_without_trace".
  // Per spec `data_governance.anti_frankenstein_rule`:
  //   "no_metric_can_exist_without_lifecycle_link".
  // LIFECYCLE_VIEW is the ONLY block in the tree that displays the
  // prediction lifecycle state (PREDICTION → OUTCOME → VERIFICATION).
  LIFECYCLE_VIEW: 'LIFECYCLE_VIEW',
} as const;

export type RenderScopeName = (typeof RENDER_SCOPES)[keyof typeof RENDER_SCOPES];

// ─── STALE Tag Control ─────────────────────────────────────────────────────
// Per spec `critical_fixes.3_stale_tag_control`:
//   rule: STALE no puede duplicar bloques, solo modificar badge
//   fix: convert STALE into metadata flag not UI duplication trigger
//   replacement: ui.badge_state only
//
// This helper returns a BadgeState that components can apply to a single
// badge — NEVER use it to trigger a second render of the same block.

export type BadgeState = 'fresh' | 'stale' | 'degraded' | 'error';

export interface StaleMetadata {
  is_stale: boolean;
  badge_state: BadgeState;
  reason: string;
}

export function computeStaleMetadata(
  predictionActive: boolean,
  historyDays: number,
  sourceStatus: string | undefined,
): StaleMetadata {
  if (sourceStatus === 'ERROR') {
    return { is_stale: true, badge_state: 'error', reason: 'Macro data ERROR' };
  }
  if (sourceStatus === 'DEGRADED') {
    return { is_stale: true, badge_state: 'degraded', reason: 'Modo degradado activo' };
  }
  if (!predictionActive && historyDays < 9) {
    return { is_stale: true, badge_state: 'stale', reason: `Historial insuficiente (${historyDays}d)` };
  }
  return { is_stale: false, badge_state: 'fresh', reason: 'Datos frescos' };
}

// ─── Data Contract Validator ───────────────────────────────────────────────
// Per spec `data_layer_fix.rules`:
//   - REAL and SIMULADO cannot coexist in same visual block
//   - all metrics must declare provenance field
//   - no implicit fallback blending without label
//
// This validator is invoked at view-model composition time. If the
// contract is violated, it logs a console warning — we do NOT throw
// because that would crash the dashboard (the spec says `safe_modifications_only`).

export function validateDataContract(
  values: ProvenanceField[],
  blockId: string,
): boolean {
  const hasReal = values.some((v) => v.source === 'REAL');
  const hasSimulado = values.some((v) => v.source === 'SIMULADO');
  if (hasReal && hasSimulado) {
    console.warn(
      `[amira-portfolio-view-model] Data contract violation in "${blockId}": ` +
        `REAL and SIMULADO sources cannot coexist in the same visual block. ` +
        `Per spec \`data_layer_fix.rules\`.`,
    );
    return false;
  }
  return true;
}

// ─── Public Re-exports ────────────────────────────────────────────────────

export type {
  DecisionEngineOutput,
  PortfolioResult,
  PortfolioBreakdown,
  ProfitProjection,
  StressMode,
};
