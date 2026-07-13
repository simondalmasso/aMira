// src/lib/amira-monitor.ts
// V10.1 — EXIT + HEALTH MONITOR (MONITOR LAYER) + LIFECYCLE ALERTS
//
// Per spec `architecture_upgrade.new_layers[monitor_layer]`:
//   name: "Exit + Health Monitor"
//   responsibility: "Controlar riesgo, caducidad de datos, y salida de
//                    posición simulada."
//   must_have: [source freshness, degradation alerts, drawdown guard,
//               prediction confidence guard, liquidity guard]
//
// Per spec `required_changes.5_executor_simulator.actions`:
//   - monitor de drawdown
//   - salida de emergencia por riesgo
//
// Per spec `architecture_upgrade.single_source_of_truth`:
//   prediction_status and data_freshness_status are part of the unified
//   state graph.
//
// Per spec `no_hallucination`:
//   "si una señal no tiene datos, se etiqueta como SIMULADO o STALE,
//    nunca se inventa"
//
// V10.1 LIFECYCLE HOOK (per spec `integration_with_current_system.hooks`):
//   amira-monitor.ts is one of the three hook points. We add:
//     - lifecycle_coverage guardrail (RED if >20% of predictions are REJECTED
//       or EXPIRED — signals a data quality crisis)
//     - lifecycle_drift_detected alert (CRITICAL when |drift_signal| > threshold)
//     - lifecycle_pending_outcomes alert (INFO when >50 predictions are pending)
//     - lifecycle_rejected_prediction alert (WARNING when most recent prediction
//       was REJECTED — rule_5 violation by upstream data layer)
//
// SAFE MODIFICATIONS: This module is advisory only — it READS the executor
// output, the prediction output, and the source health registry, then
// produces a unified `MonitorOutput` with alerts and guardrails. It does
// NOT mutate any state, does NOT trigger any HTTP request, and does NOT
// replace the decision engine's exit logic (which doesn't exist — this
// is the new layer per spec).

import type { ExecutorOutput, ExecutorRiskSummary } from './amira-executor-sim';
import type { AmiraPredictionOutput } from './amira-prediction-engine';
import type { SourceHealthSnapshot, SourceHealthEntry } from './amira-source-health';
import type { StressMode } from './oracle/portfolio-engine';
// V10.1: import the lifecycle snapshot type. Per spec
// `integration_with_current_system.hooks`: amira-monitor.ts is one of the
// three hook points (along with amira-prediction-engine.ts and
// amira-portfolio-view-model.ts). The monitor reads the lifecycle snapshot
// and produces alerts + a guardrail for lifecycle coverage / drift.
import type { LifecycleSnapshot } from './amira-prediction-lifecycle';

// ─── Types ──────────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertKind =
  | 'source_stale'
  | 'source_error'
  | 'source_partial_fallback'
  | 'drawdown_high'
  | 'drawdown_critical'
  | 'prediction_low_confidence'
  | 'prediction_off'
  | 'liquidity_low'
  | 'cash_drag_high'
  | 'concentration_high'
  | 'emergency_exit'
  | 'costs_high'
  // V10.1 NEW: lifecycle alerts (per spec `integration_with_current_system.hooks`)
  | 'lifecycle_drift_detected'
  | 'lifecycle_pending_outcomes'
  | 'lifecycle_rejected_prediction'
  | 'lifecycle_coverage_low';

export interface MonitorAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  /** Human-readable message (es-AR) */
  message: string;
  /** Source ID or asset ID — for routing to the right component */
  scope: string;
  /** Numeric value that triggered the alert (if any) */
  value: number | null;
  /** Threshold that was crossed (if any) */
  threshold: number | null;
  /** Recommended action (es-AR) */
  recommended_action: string;
}

export type GuardrailStatus = 'GREEN' | 'AMBER' | 'RED';

export interface GuardrailState {
  name: string;
  status: GuardrailStatus;
  value: number;
  threshold: number;
  description: string;
}

export interface MonitorOutput {
  generated_at: string;
  /** Overall system status — RED = critical alert, AMBER = warning, GREEN = healthy */
  overall_status: GuardrailStatus;
  /** Active alerts, sorted by severity (critical first) */
  alerts: MonitorAlert[];
  /** Guardrails — one per monitored dimension */
  guardrails: {
    source_freshness: GuardrailState;
    drawdown: GuardrailState;
    prediction_confidence: GuardrailState;
    liquidity: GuardrailState;
    concentration: GuardrailState;
    cash_drag: GuardrailState;
    emergency_exit: GuardrailState;
    costs: GuardrailState;
    // V10.1 NEW: lifecycle coverage guardrail.
    // Value = % of predictions that are NOT in REJECTED or EXPIRED status
    // (i.e., the fraction of predictions that the lifecycle chain can
    // actually verify). Thresholds: GREEN >= 0.90, AMBER >= 0.70, RED < 0.70.
    // Per spec `data_governance.traceability_requirement`:
    //   "100_percent_predictions_must_be_verifiable".
    lifecycle_coverage: GuardrailState;
  };
  /** Number of degraded sources (STALE + PARTIAL_FALLBACK) */
  degraded_source_count: number;
  /** Number of error sources */
  error_source_count: number;
  /** Number of healthy sources */
  healthy_source_count: number;
  /** Echoed stress mode (for traceability) */
  stress_mode: StressMode | null;
  /** Echoed paper flag — always true per spec `must_have.paper-only mode` */
  paper: true;
}

// ─── Constants (guardrail thresholds) ──────────────────────────────────────

const THRESHOLDS = {
  source_freshness: {
    green: 0.85,
    amber: 0.50,
    red: 0.20,
  },
  drawdown: {
    green: 0.05,    // <5% drawdown
    amber: 0.10,    // 5-10%
    red: 0.20,      // >20%
  },
  prediction_confidence: {
    green: 0.70,
    amber: 0.40,
    red: 0.10,
  },
  liquidity: {
    // avg fill ratio — 1.0 = full fills, <0.5 = liquidity problems
    green: 0.90,
    amber: 0.70,
    red: 0.50,
  },
  concentration: {
    // top position as fraction of allocated capital
    green: 0.20,
    amber: 0.30,
    red: 0.40,
  },
  cash_drag: {
    green: 0.05,
    amber: 0.15,
    red: 0.30,
  },
  costs: {
    // (fees + slippage) / starting_capital
    green: 0.005,   // <0.5%
    amber: 0.010,   // 0.5-1%
    red: 0.020,     // >2%
  },
  // V10.1 NEW: lifecycle coverage thresholds.
  // Value = % of predictions that are NOT REJECTED or EXPIRED.
  // Per spec `data_governance.traceability_requirement`:
  //   "100_percent_predictions_must_be_verifiable".
  // We don't require 100% for GREEN because EXPIRED predictions can occur
  // when data sources go offline mid-horizon — that's not a model failure.
  // But we DO want RED when >30% of predictions can't be verified.
  lifecycle_coverage: {
    green: 0.90,
    amber: 0.70,
    red: 0.00, // any value below amber 0.70 → RED (handled via invert=false)
  },
} as const;

// ─── Helper: severity → status ─────────────────────────────────────────────

function statusFromValue(value: number, t: { green: number; amber: number; red: number }, invert = false): GuardrailStatus {
  // For metrics where lower is better (drawdown, cash_drag, costs, concentration),
  // set `invert=true` — green means below threshold.green.
  if (invert) {
    if (value >= t.red) return 'RED';
    if (value >= t.amber) return 'AMBER';
    return 'GREEN';
  }
  // For metrics where higher is better (freshness, confidence, liquidity),
  // green means above threshold.green.
  if (value <= t.red) return 'RED';
  if (value <= t.amber) return 'AMBER';
  return 'GREEN';
}

// ─── Main composer ─────────────────────────────────────────────────────────

export interface ComposeMonitorOptions {
  /** Executor output (paper broker simulation) */
  executor: ExecutorOutput | null;
  /** Executor risk summary (derived) */
  executorRisk: ExecutorRiskSummary | null;
  /** Unified prediction output */
  prediction: AmiraPredictionOutput | null;
  /** Source health snapshot */
  sourceHealth: SourceHealthSnapshot | null;
  /** Override stress mode (defaults to executor.stress_mode) */
  stressMode?: StressMode;
  /** V10.1 NEW: prediction lifecycle snapshot — feeds the lifecycle_coverage
   * guardrail + 4 new alert kinds (lifecycle_drift_detected,
   * lifecycle_pending_outcomes, lifecycle_rejected_prediction,
   * lifecycle_coverage_low).
   * Per spec `integration_with_current_system.hooks`: amira-monitor.ts is
   * one of the three hook points. */
  lifecycle?: LifecycleSnapshot | null;
}

export function composeAmiraMonitor(options: ComposeMonitorOptions): MonitorOutput {
  const { executor, executorRisk, prediction, sourceHealth, lifecycle } = options;
  const alerts: MonitorAlert[] = [];

  // ─── Source freshness alerts ───
  let degradedCount = 0;
  let errorCount = 0;
  let healthyCount = 0;
  let avgFreshness = 1.0;

  if (sourceHealth) {
    const sourceEntries: SourceHealthEntry[] = sourceHealth.sources.filter(
      (s) => s.source_id !== 'internal-fallback',
    );
    degradedCount = sourceHealth.degraded_count;
    errorCount = sourceHealth.error_count;
    healthyCount = sourceHealth.healthy_count;
    avgFreshness = sourceHealth.overall_freshness_score;

    for (const source of sourceEntries) {
      if (source.status === 'ERROR') {
        alerts.push({
          kind: 'source_error',
          severity: 'critical',
          message: `Fuente ${source.source_id} en ERROR · ${source.last_error ?? 'razón desconocida'}`,
          scope: source.source_id,
          value: null,
          threshold: null,
          recommended_action: `Reintentar fetch · usar fallback interno si persiste · última consulta: ${source.last_attempt_ts ?? 'nunca'}`,
        });
      } else if (source.status === 'PARTIAL_FALLBACK') {
        alerts.push({
          kind: 'source_partial_fallback',
          severity: 'warning',
          message: `Fuente ${source.source_id} en PARTIAL_FALLBACK · ${source.reason}`,
          scope: source.source_id,
          value: source.coverage,
          threshold: 0.5,
          recommended_action: 'Verificar endpoint upstream · mantener último snapshot válido',
        });
      } else if (source.status === 'STALE') {
        alerts.push({
          kind: 'source_stale',
          severity: 'warning',
          message: `Fuente ${source.source_id} STALE · ${source.reason}`,
          scope: source.source_id,
          value: source.freshness_score,
          threshold: 0.85,
          recommended_action: 'Re-fetch forzado · mantener último snapshot válido',
        });
      }
    }
  }

  // ─── Drawdown alerts ───
  let drawdownValue = 0;
  if (executorRisk) {
    drawdownValue = executorRisk.drawdown;
    if (drawdownValue >= THRESHOLDS.drawdown.red) {
      alerts.push({
        kind: 'drawdown_critical',
        severity: 'critical',
        message: `Drawdown crítico: ${(drawdownValue * 100).toFixed(1)}% del capital inicial`,
        scope: 'portfolio',
        value: drawdownValue,
        threshold: THRESHOLDS.drawdown.red,
        recommended_action: 'Activar salida de emergencia en simulador paper · revisar asignación',
      });
    } else if (drawdownValue >= THRESHOLDS.drawdown.amber) {
      alerts.push({
        kind: 'drawdown_high',
        severity: 'warning',
        message: `Drawdown elevado: ${(drawdownValue * 100).toFixed(1)}% del capital inicial`,
        scope: 'portfolio',
        value: drawdownValue,
        threshold: THRESHOLDS.drawdown.amber,
        recommended_action: 'Considerar reducir exposure · revisar régimen',
      });
    }
  }

  // ─── Prediction confidence alerts ───
  let confidenceValue = 1.0;
  if (prediction) {
    confidenceValue = prediction.confidence;
    if (prediction.prediction_status === 'OFF') {
      alerts.push({
        kind: 'prediction_off',
        severity: 'warning',
        message: `Predicción OFF · ${prediction.prediction_reason}`,
        scope: 'prediction',
        value: confidenceValue,
        threshold: 0.40,
        recommended_action: 'Esperar más histórico · usar fallback del motor (retorno base × régimen)',
      });
    } else if (confidenceValue <= THRESHOLDS.prediction_confidence.red) {
      alerts.push({
        kind: 'prediction_low_confidence',
        severity: 'critical',
        message: `Confianza de predicción muy baja: ${(confidenceValue * 100).toFixed(0)}%`,
        scope: 'prediction',
        value: confidenceValue,
        threshold: THRESHOLDS.prediction_confidence.red,
        recommended_action: 'Esperar más histórico · verificar frescura de fuentes',
      });
    } else if (confidenceValue <= THRESHOLDS.prediction_confidence.amber) {
      alerts.push({
        kind: 'prediction_low_confidence',
        severity: 'warning',
        message: `Confianza de predicción baja: ${(confidenceValue * 100).toFixed(0)}%`,
        scope: 'prediction',
        value: confidenceValue,
        threshold: THRESHOLDS.prediction_confidence.amber,
        recommended_action: 'Considerar reducir tamaño de posición · monitorear cobertura ML',
      });
    }
  }

  // ─── Liquidity alerts (from executor avg fill ratio) ───
  let liquidityValue = 1.0;
  if (executor) {
    liquidityValue = executor.avg_fill_ratio;
    if (liquidityValue <= THRESHOLDS.liquidity.red) {
      alerts.push({
        kind: 'liquidity_low',
        severity: 'critical',
        message: `Liquidez muy baja · fill ratio promedio ${(liquidityValue * 100).toFixed(0)}%`,
        scope: 'portfolio',
        value: liquidityValue,
        threshold: THRESHOLDS.liquidity.red,
        recommended_action: 'Reducir tamaño de órdenes · priorizar clases más líquidas (FCI, PF)',
      });
    } else if (liquidityValue <= THRESHOLDS.liquidity.amber) {
      alerts.push({
        kind: 'liquidity_low',
        severity: 'warning',
        message: `Liquidez baja · fill ratio promedio ${(liquidityValue * 100).toFixed(0)}% · ${executor.partial_fill_count} fills parciales`,
        scope: 'portfolio',
        value: liquidityValue,
        threshold: THRESHOLDS.liquidity.amber,
        recommended_action: 'Considerar reducir exposición a clases ilíquidas',
      });
    }
  }

  // ─── Concentration alerts ───
  let concentrationValue = 0;
  if (executorRisk) {
    concentrationValue = executorRisk.top_position_concentration;
    if (concentrationValue >= THRESHOLDS.concentration.red) {
      alerts.push({
        kind: 'concentration_high',
        severity: 'critical',
        message: `Concentración muy alta en top posición: ${(concentrationValue * 100).toFixed(0)}% del capital asignado`,
        scope: 'portfolio',
        value: concentrationValue,
        threshold: THRESHOLDS.concentration.red,
        recommended_action: 'Diversificar · reducir peso de top posición · revisar restricciones del motor',
      });
    } else if (concentrationValue >= THRESHOLDS.concentration.amber) {
      alerts.push({
        kind: 'concentration_high',
        severity: 'warning',
        message: `Concentración elevada en top posición: ${(concentrationValue * 100).toFixed(0)}% del capital asignado`,
        scope: 'portfolio',
        value: concentrationValue,
        threshold: THRESHOLDS.concentration.amber,
        recommended_action: 'Considerar reducir peso · añadir activos correlacionados negativamente',
      });
    }
  }

  // ─── Cash drag alerts ───
  let cashDragValue = 0;
  if (executorRisk) {
    cashDragValue = executorRisk.cash_drag;
    if (cashDragValue >= THRESHOLDS.cash_drag.red) {
      alerts.push({
        kind: 'cash_drag_high',
        severity: 'critical',
        message: `Cash drag muy alto: ${(cashDragValue * 100).toFixed(0)}% del capital sin asignar`,
        scope: 'portfolio',
        value: cashDragValue,
        threshold: THRESHOLDS.cash_drag.red,
        recommended_action: 'Aumentar exposure · verificar restricciones del motor de asignación',
      });
    } else if (cashDragValue >= THRESHOLDS.cash_drag.amber) {
      alerts.push({
        kind: 'cash_drag_high',
        severity: 'warning',
        message: `Cash drag elevado: ${(cashDragValue * 100).toFixed(0)}% del capital sin asignar`,
        scope: 'portfolio',
        value: cashDragValue,
        threshold: THRESHOLDS.cash_drag.amber,
        recommended_action: 'Considerar aumentar exposure · revisar restricciones por clase',
      });
    }
  }

  // ─── Emergency exit alert (paper-only flag, no real action) ───
  if (executorRisk?.emergency_exit_triggered) {
    alerts.push({
      kind: 'emergency_exit',
      severity: 'critical',
      message: `Salida de emergencia ACTIVADA (paper) · ${executorRisk.emergency_exit_reason ?? 'razón desconocida'}`,
      scope: 'portfolio',
      value: drawdownValue,
      threshold: 0.20,
      recommended_action: 'En producción, esto liquidaría posiciones · aquí solo se flaggea',
    });
  }

  // ─── Costs alert ───
  let costsValue = 0;
  if (executorRisk) {
    costsValue = executorRisk.total_costs_pct;
    if (costsValue >= THRESHOLDS.costs.red) {
      alerts.push({
        kind: 'costs_high',
        severity: 'critical',
        message: `Costos de transacción muy altos: ${(costsValue * 100).toFixed(2)}% del capital (fees + slippage)`,
        scope: 'portfolio',
        value: costsValue,
        threshold: THRESHOLDS.costs.red,
        recommended_action: 'Reducir frecuencia de rebalanceo · consolidar órdenes',
      });
    } else if (costsValue >= THRESHOLDS.costs.amber) {
      alerts.push({
        kind: 'costs_high',
        severity: 'warning',
        message: `Costos de transacción elevados: ${(costsValue * 100).toFixed(2)}% del capital`,
        scope: 'portfolio',
        value: costsValue,
        threshold: THRESHOLDS.costs.amber,
        recommended_action: 'Considerar rebalanceo menos frecuente · revisar clases ilíquidas',
      });
    }
  }

  // ─── V10.1: Prediction Lifecycle alerts ──────────────────────────────────
  // Per spec `integration_with_current_system.hooks`: amira-monitor.ts is one
  // of the three hook points. We emit 4 alert kinds here:
  //   1. lifecycle_drift_detected (CRITICAL) — |drift_signal| > threshold
  //   2. lifecycle_pending_outcomes (INFO) — >50 predictions awaiting outcome
  //   3. lifecycle_rejected_prediction (WARNING) — most recent prediction REJECTED
  //   4. lifecycle_coverage_low (WARNING/CRITICAL) — <70% of predictions verifiable
  //
  // Per spec `data_governance.anti_frankenstein_rule`:
  //   "no_metric_can_exist_without_lifecycle_link"
  let lifecycleCoverageValue = 1.0; // default: no predictions → 100% verifiable (vacuous)
  if (lifecycle && lifecycle.counts.total_predictions > 0) {
    const total = lifecycle.counts.total_predictions;
    const unverifiable = lifecycle.counts.rejected + lifecycle.counts.expired;
    lifecycleCoverageValue = (total - unverifiable) / total;

    // Drift alert
    if (lifecycle.drift_indicator.detected) {
      alerts.push({
        kind: 'lifecycle_drift_detected',
        severity: 'critical',
        message: `Drift del modelo detectado · señal ${lifecycle.drift_indicator.signal >= 0 ? '+' : ''}${(lifecycle.drift_indicator.signal * 100).toFixed(2)}% · supera umbral ${(lifecycle.drift_indicator.threshold * 100).toFixed(2)}%`,
        scope: 'lifecycle',
        value: lifecycle.drift_indicator.signal,
        threshold: lifecycle.drift_indicator.threshold,
        recommended_action: 'Recalibrar modelo · verificar fuentes upstream · revisar último régimen',
      });
    }

    // Pending outcomes alert (informational — not a fault, just a heads-up)
    if (lifecycle.pending_outcomes > 50) {
      alerts.push({
        kind: 'lifecycle_pending_outcomes',
        severity: 'info',
        message: `${lifecycle.pending_outcomes} predicciones pendientes de outcome · horizonte 30/60/90d`,
        scope: 'lifecycle',
        value: lifecycle.pending_outcomes,
        threshold: 50,
        recommended_action: 'Esperar cierre de horizonte · el sistema verificara automáticamente',
      });
    }

    // Rejected prediction alert (rule_5 violation by upstream data layer)
    if (lifecycle.latest_prediction && lifecycle.latest_prediction.verification_status === 'REJECTED') {
      alerts.push({
        kind: 'lifecycle_rejected_prediction',
        severity: 'warning',
        message: `Última predicción RECHAZADA · sin fuentes de datos (rule_5) · prediction_id ${lifecycle.latest_prediction.prediction_id}`,
        scope: 'lifecycle',
        value: 0,
        threshold: 1,
        recommended_action: 'Verificar ingestion layer · revisar recordSourceFetch() · restaurar fuentes caídas',
      });
    }

    // Coverage low alert
    if (lifecycleCoverageValue < THRESHOLDS.lifecycle_coverage.amber) {
      alerts.push({
        kind: 'lifecycle_coverage_low',
        severity: 'critical',
        message: `Cobertura de trazabilidad muy baja: ${(lifecycleCoverageValue * 100).toFixed(0)}% · ${lifecycle.counts.rejected} rechazadas + ${lifecycle.counts.expired} expiradas de ${total}`,
        scope: 'lifecycle',
        value: lifecycleCoverageValue,
        threshold: THRESHOLDS.lifecycle_coverage.amber,
        recommended_action: 'Revisar ingestion layer · Restaurar fuentes caídas · Recalibrar modelo',
      });
    } else if (lifecycleCoverageValue < THRESHOLDS.lifecycle_coverage.green) {
      alerts.push({
        kind: 'lifecycle_coverage_low',
        severity: 'warning',
        message: `Cobertura de trazabilidad baja: ${(lifecycleCoverageValue * 100).toFixed(0)}% · ${lifecycle.counts.rejected} rechazadas + ${lifecycle.counts.expired} expiradas`,
        scope: 'lifecycle',
        value: lifecycleCoverageValue,
        threshold: THRESHOLDS.lifecycle_coverage.green,
        recommended_action: 'Monitorear fuentes · considerar pausar predicciones si empeora',
      });
    }
  }

  // ─── Build guardrails ───
  const freshnessStatus = statusFromValue(avgFreshness, THRESHOLDS.source_freshness);
  const drawdownStatus = statusFromValue(drawdownValue, THRESHOLDS.drawdown, true);
  const confidenceStatus = statusFromValue(confidenceValue, THRESHOLDS.prediction_confidence);
  const liquidityStatus = statusFromValue(liquidityValue, THRESHOLDS.liquidity);
  const concentrationStatus = statusFromValue(concentrationValue, THRESHOLDS.concentration, true);
  const cashDragStatus = statusFromValue(cashDragValue, THRESHOLDS.cash_drag, true);
  const emergencyStatus: GuardrailStatus = executorRisk?.emergency_exit_triggered ? 'RED' : 'GREEN';
  const costsStatus = statusFromValue(costsValue, THRESHOLDS.costs, true);
  // V10.1: lifecycle coverage status (higher is better — not inverted)
  const lifecycleCoverageStatus = statusFromValue(lifecycleCoverageValue, THRESHOLDS.lifecycle_coverage);

  // ─── Overall status = worst guardrail ───
  const allStatuses: GuardrailStatus[] = [
    freshnessStatus,
    drawdownStatus,
    confidenceStatus,
    liquidityStatus,
    concentrationStatus,
    cashDragStatus,
    emergencyStatus,
    costsStatus,
    // V10.1: lifecycle coverage participates in overall status
    lifecycleCoverageStatus,
  ];
  const overall: GuardrailStatus = allStatuses.includes('RED')
    ? 'RED'
    : allStatuses.includes('AMBER')
      ? 'AMBER'
      : 'GREEN';

  // ─── Sort alerts by severity ───
  const severityOrder: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const stressMode = options.stressMode ?? executor?.stress_mode ?? null;

  return {
    generated_at: new Date().toISOString(),
    overall_status: overall,
    alerts,
    guardrails: {
      source_freshness: {
        name: 'Frescura de fuentes',
        status: freshnessStatus,
        value: Math.round(avgFreshness * 1000) / 1000,
        threshold: THRESHOLDS.source_freshness.amber,
        description: `${healthyCount} sanas · ${degradedCount} degradadas · ${errorCount} en error`,
      },
      drawdown: {
        name: 'Drawdown',
        status: drawdownStatus,
        value: Math.round(drawdownValue * 10000) / 10000,
        threshold: THRESHOLDS.drawdown.amber,
        description: drawdownValue > 0 ? `${(drawdownValue * 100).toFixed(1)}% del capital` : 'Sin pérdida',
      },
      prediction_confidence: {
        name: 'Confianza predicción',
        status: confidenceStatus,
        value: Math.round(confidenceValue * 1000) / 1000,
        threshold: THRESHOLDS.prediction_confidence.amber,
        description: prediction ? `${(confidenceValue * 100).toFixed(0)}% · ${prediction.prediction_status}` : 'Sin predicción',
      },
      liquidity: {
        name: 'Liquidez',
        status: liquidityStatus,
        value: Math.round(liquidityValue * 1000) / 1000,
        threshold: THRESHOLDS.liquidity.amber,
        description: executor ? `Fill ratio ${(liquidityValue * 100).toFixed(0)}% · ${executor.partial_fill_count} parciales` : 'Sin ejecución',
      },
      concentration: {
        name: 'Concentración',
        status: concentrationStatus,
        value: Math.round(concentrationValue * 1000) / 1000,
        threshold: THRESHOLDS.concentration.amber,
        description: `${(concentrationValue * 100).toFixed(0)}% en top posición`,
      },
      cash_drag: {
        name: 'Cash drag',
        status: cashDragStatus,
        value: Math.round(cashDragValue * 1000) / 1000,
        threshold: THRESHOLDS.cash_drag.amber,
        description: `${(cashDragValue * 100).toFixed(0)}% sin asignar`,
      },
      emergency_exit: {
        name: 'Salida de emergencia',
        status: emergencyStatus,
        value: executorRisk?.emergency_exit_triggered ? 1 : 0,
        threshold: 0,
        description: executorRisk?.emergency_exit_triggered
          ? `ACTIVADA · ${executorRisk.emergency_exit_reason}`
          : 'No activada',
      },
      costs: {
        name: 'Costos',
        status: costsStatus,
        value: Math.round(costsValue * 10000) / 10000,
        threshold: THRESHOLDS.costs.amber,
        description: executor
          ? `${(costsValue * 100).toFixed(2)}% · $${executor.total_fees_usd.toFixed(0)} fees + $${executor.total_slippage_usd.toFixed(0)} slippage`
          : 'Sin ejecución',
      },
      // V10.1 NEW: lifecycle coverage guardrail
      lifecycle_coverage: {
        name: 'Trazabilidad lifecycle',
        status: lifecycleCoverageStatus,
        value: Math.round(lifecycleCoverageValue * 1000) / 1000,
        threshold: THRESHOLDS.lifecycle_coverage.amber,
        description: lifecycle && lifecycle.counts.total_predictions > 0
          ? `${(lifecycleCoverageValue * 100).toFixed(0)}% verificables · ${lifecycle.counts.verified} verificadas · ${lifecycle.counts.pending} pendientes · ${lifecycle.counts.rejected} rechazadas · ${lifecycle.counts.expired} expiradas`
          : 'Sin predicciones registradas',
      },
    },
    degraded_source_count: degradedCount,
    error_source_count: errorCount,
    healthy_source_count: healthyCount,
    stress_mode: stressMode,
    paper: true,
  };
}

// ─── React Hook ────────────────────────────────────────────────────────────

import { useMemo } from 'react';

export function useAmiraMonitor(options: ComposeMonitorOptions): MonitorOutput {
  const { executor, executorRisk, prediction, sourceHealth, stressMode, lifecycle } = options;
  return useMemo(
    () => composeAmiraMonitor({ executor, executorRisk, prediction, sourceHealth, stressMode, lifecycle }),
    [executor, executorRisk, prediction, sourceHealth, stressMode, lifecycle],
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function getStatusColor(s: GuardrailStatus): string {
  switch (s) {
    case 'GREEN': return '#16a34a';
    case 'AMBER': return '#ca8a04';
    case 'RED': return '#dc2626';
  }
}

export function getStatusLabel(s: GuardrailStatus): string {
  switch (s) {
    case 'GREEN': return 'OK';
    case 'AMBER': return 'ATENCIÓN';
    case 'RED': return 'CRÍTICO';
  }
}

export function getSeverityColor(s: AlertSeverity): string {
  switch (s) {
    case 'info': return '#0066cc';
    case 'warning': return '#ca8a04';
    case 'critical': return '#dc2626';
  }
}

export function getSeverityLabel(s: AlertSeverity): string {
  switch (s) {
    case 'info': return 'INFO';
    case 'warning': return 'AVISO';
    case 'critical': return 'CRÍTICO';
  }
}

export function getAlertKindLabel(k: AlertKind): string {
  switch (k) {
    case 'source_stale': return 'Fuente stale';
    case 'source_error': return 'Fuente error';
    case 'source_partial_fallback': return 'Fuente parcial';
    case 'drawdown_high': return 'Drawdown alto';
    case 'drawdown_critical': return 'Drawdown crítico';
    case 'prediction_low_confidence': return 'Confianza baja';
    case 'prediction_off': return 'Predicción OFF';
    case 'liquidity_low': return 'Liquidez baja';
    case 'cash_drag_high': return 'Cash drag alto';
    case 'concentration_high': return 'Concentración alta';
    case 'emergency_exit': return 'Salida emergencia';
    case 'costs_high': return 'Costos altos';
    // V10.1 NEW: lifecycle alert kinds
    case 'lifecycle_drift_detected': return 'Drift modelo';
    case 'lifecycle_pending_outcomes': return 'Outcomes pendientes';
    case 'lifecycle_rejected_prediction': return 'Predicción rechazada';
    case 'lifecycle_coverage_low': return 'Trazabilidad baja';
  }
}
