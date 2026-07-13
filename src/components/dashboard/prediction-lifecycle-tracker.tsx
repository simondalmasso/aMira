// src/components/dashboard/prediction-lifecycle-tracker.tsx
// V10.1 — PREDICTION LIFECYCLE TRACKER UI
//
// Per spec `oracle_upgrade.V10.1-PREDICTION-LIFECYCLE`:
//   core_addition.feature_name: "Prediction Lifecycle Chain"
//   ui_changes.new_component: "PredictionLifecycleTracker"
//   ui_changes.must_display: [
//     "prediction_state",
//     "pending_outcomes",
//     "verification_score",
//     "drift_indicator",
//   ]
//   ui_changes.remove: [
//     "isolated_prediction_blocks_without_trace"
//   ]
//   data_governance.anti_frankenstein_rule:
//     "no_metric_can_exist_without_lifecycle_link"
//   rules.rule_6: "Toda UI debe mostrar estado lifecycle activo"
//
// SAFE MODIFICATIONS: This component consumes `viewModel.lifecycle_output`
// (single source of truth from the append-only event store) — it does NOT
// read the logs directly, does NOT mutate them, and does NOT trigger any
// HTTP request. It persists UI state (expanded/collapsed + last known
// stage/score/drift/prediction_id) to the Zustand store so it survives
// section switches.
//
// PER spec `anti_frankenstein_rule`: "no_metric_can_exist_without_lifecycle_link"
// — every number shown in this block is backed by a prediction_id in the
// append-only event store. The user can trace any number back to its
// originating prediction.

'use client';

import { useEffect } from 'react';
import {
  Activity, CheckCircle2, Clock, AlertTriangle, ChevronDown,
  ChevronRight, FileText, GitBranch, History, ShieldCheck,
} from 'lucide-react';
import type { PortfolioViewModel } from '@/lib/amira-portfolio-view-model';
import { useHedgeFundStore } from '@/store/hedge-fund-store';
import type { LifecycleSnapshot } from '@/lib/amira-prediction-lifecycle';

interface PredictionLifecycleTrackerProps {
  viewModel: PortfolioViewModel;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function stageLabel(stage: LifecycleSnapshot['active_stage']): string {
  switch (stage) {
    case 'PREDICTION': return 'PREDICCIÓN';
    case 'OUTCOME': return 'OUTCOME';
    case 'VERIFICATION': return 'VERIFICACIÓN';
    case 'EMPTY': return 'SIN EVENTOS';
  }
}

function stageColor(stage: LifecycleSnapshot['active_stage']): string {
  switch (stage) {
    case 'PREDICTION': return '#0066cc';
    case 'OUTCOME': return '#ca8a04';
    case 'VERIFICATION': return '#16a34a';
    case 'EMPTY': return '#999999';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'EXCELLENT': return '#16a34a';
    case 'GOOD': return '#0066cc';
    case 'POOR': return '#dc2626';
    case 'NO_HISTORY': return '#999999';
    default: return '#999999';
  }
}

function verificationStatusColor(status: string): string {
  switch (status) {
    case 'PENDING': return '#0066cc';
    case 'OUTCOME_CAPTURED': return '#ca8a04';
    case 'VERIFIED': return '#16a34a';
    case 'EXPIRED': return '#6b7280';
    case 'REJECTED': return '#dc2626';
    default: return '#999999';
  }
}

function verificationStatusLabel(status: string): string {
  switch (status) {
    case 'PENDING': return 'PENDIENTE';
    case 'OUTCOME_CAPTURED': return 'OUTCOME CAPTURADO';
    case 'VERIFIED': return 'VERIFICADO';
    case 'EXPIRED': return 'EXPIRADO';
    case 'REJECTED': return 'RECHAZADO';
    default: return status.toUpperCase();
  }
}

function driftColor(detected: boolean): string {
  return detected ? '#dc2626' : '#16a34a';
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StagePill({ stage }: { stage: LifecycleSnapshot['active_stage'] }) {
  const color = stageColor(stage);
  return (
    <span
      data-testid="lifecycle-active-stage-pill"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-[0.1em] whitespace-nowrap"
      style={{ background: `${color}15`, color, border: `1px solid ${color}40` }}
    >
      <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: color }} />
      {stageLabel(stage)}
    </span>
  );
}

function VerificationStatusPill({ status }: { status: string }) {
  const color = verificationStatusColor(status);
  return (
    <span
      data-testid={`lifecycle-verification-status-pill`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-[0.05em] whitespace-nowrap"
      style={{ background: `${color}15`, color, border: `1px solid ${color}40` }}
    >
      {verificationStatusLabel(status)}
    </span>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  sublabel?: string;
  color?: string;
  testId: string;
}

function MetricCard({ label, value, sublabel, color = '#000000', testId }: MetricCardProps) {
  return (
    <div
      data-testid={testId}
      className="bg-white border border-[#eaeaea] rounded p-2 flex flex-col gap-0.5"
    >
      <span className="text-[8px] font-bold text-[#999999] uppercase tracking-[0.1em]">{label}</span>
      <span
        className="text-[15px] font-bold tabular-nums leading-tight"
        style={{ color }}
      >
        {value}
      </span>
      {sublabel && (
        <span className="text-[9px] text-[#666666]">{sublabel}</span>
      )}
    </div>
  );
}

function CountBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
      style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}
    >
      {label}: <span className="tabular-nums">{count}</span>
    </span>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function PredictionLifecycleTracker({ viewModel }: PredictionLifecycleTrackerProps) {
  const lifecycle: LifecycleSnapshot = viewModel.lifecycle_output;

  // ─── Persist last-known state to the store (rule_6: lifecycle always visible) ───
  // We use useEffect so the persistence happens AFTER render — this avoids
  // an infinite render loop. We persist: stage, verification score, drift
  // signal, and the most recent prediction_id.
  const expanded = useHedgeFundStore((s) => s.lifecycleExpanded);
  const setExpanded = useHedgeFundStore((s) => s.setLifecycleExpanded);
  const setLastLifecycleStage = useHedgeFundStore((s) => s.setLastLifecycleStage);
  const setLastVerificationScore = useHedgeFundStore((s) => s.setLastVerificationScore);
  const setLastDriftSignal = useHedgeFundStore((s) => s.setLastDriftSignal);
  const setLastPredictionId = useHedgeFundStore((s) => s.setLastPredictionId);

  useEffect(() => {
    setLastLifecycleStage(lifecycle.active_stage);
  }, [lifecycle.active_stage, setLastLifecycleStage]);

  useEffect(() => {
    setLastVerificationScore(lifecycle.verification_score.brier_like);
  }, [lifecycle.verification_score.brier_like, setLastVerificationScore]);

  useEffect(() => {
    setLastDriftSignal(lifecycle.drift_indicator.signal);
  }, [lifecycle.drift_indicator.signal, setLastDriftSignal]);

  useEffect(() => {
    setLastPredictionId(lifecycle.latest_prediction?.prediction_id ?? null);
  }, [lifecycle.latest_prediction?.prediction_id, setLastPredictionId]);

  // ─── Render ───
  const latestPred = lifecycle.latest_prediction;
  const latestVer = lifecycle.latest_verification;
  const driftColorValue = driftColor(lifecycle.drift_indicator.detected);
  const verificationColor = statusColor(lifecycle.verification_score.status);

  return (
    <div
      data-testid="lifecycle-tracker-block"
      className="bg-white border border-[#e5e7eb] rounded-lg overflow-hidden"
    >
      {/* ─── Header ─── */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-2 p-2.5 bg-[#fafafa] hover:bg-[#f3f4f6] transition-colors"
        aria-expanded={expanded}
        data-testid="lifecycle-tracker-toggle"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <GitBranch className="w-3.5 h-3.5 text-[#0066cc]" />
            <span className="text-[12px] font-bold text-[#000000]">Trazabilidad Lifecycle</span>
          </div>
          <StagePill stage={lifecycle.active_stage} />
          {latestPred && (
            <VerificationStatusPill status={latestPred.verification_status} />
          )}
          <span className="text-[9px] text-[#999999]">
            V10.1 · audit_mode={String(lifecycle.audit_mode)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <CountBadge label="pend" count={lifecycle.pending_outcomes} color="#0066cc" />
          <CountBadge label="verif" count={lifecycle.counts.verified} color="#16a34a" />
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#666666]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#666666]" />
          )}
        </div>
      </button>

      {/* ─── Always-visible summary (collapsed view) ─── */}
      <div className="p-2.5 border-t border-[#eaeaea]">
        {/* Active stage + prediction_id line */}
        <div className="flex items-center gap-2 flex-wrap mb-2 text-[10px]">
          <span className="text-[#999999] uppercase tracking-[0.1em] font-bold">Estado:</span>
          <span style={{ color: stageColor(lifecycle.active_stage) }} className="font-bold">
            {stageLabel(lifecycle.active_stage)}
          </span>
          {latestPred?.prediction_id && (
            <>
              <span className="text-[#cccccc]">·</span>
              <span className="text-[#666666] font-mono">
                ID: <span data-testid="lifecycle-prediction-id">{latestPred.prediction_id}</span>
              </span>
            </>
          )}
          {latestPred?.timestamp && (
            <>
              <span className="text-[#cccccc]">·</span>
              <span className="text-[#999999]">{formatTimestamp(latestPred.timestamp)}</span>
            </>
          )}
        </div>

        {/* 4 required must_display metrics (rule_6) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MetricCard
            label="Estado Predicción"
            value={stageLabel(lifecycle.active_stage)}
            sublabel={latestPred?.verification_status ? verificationStatusLabel(latestPred.verification_status) : 'sin predicción'}
            color={stageColor(lifecycle.active_stage)}
            testId="lifecycle-metric-state"
          />
          <MetricCard
            label="Outcomes Pendientes"
            value={String(lifecycle.pending_outcomes)}
            sublabel={`${lifecycle.counts.pending} en PENDING · ${lifecycle.counts.outcome_captured} capturados`}
            color="#0066cc"
            testId="lifecycle-metric-pending"
          />
          <MetricCard
            label="Score Verificación"
            value={lifecycle.verification_score.brier_like.toFixed(3)}
            sublabel={lifecycle.verification_score.label}
            color={verificationColor}
            testId="lifecycle-metric-score"
          />
          <MetricCard
            label="Drift Indicator"
            value={`${lifecycle.drift_indicator.signal >= 0 ? '+' : ''}${(lifecycle.drift_indicator.signal * 100).toFixed(2)}%`}
            sublabel={lifecycle.drift_indicator.detected ? 'DRIFT DETECTADO' : 'sin drift'}
            color={driftColorValue}
            testId="lifecycle-metric-drift"
          />
        </div>

        {/* Audit invariant badges */}
        <div className="flex items-center gap-1 flex-wrap mt-2">
          <span className="text-[8px] font-bold text-[#999999] uppercase tracking-[0.1em]">Invariants:</span>
          {lifecycle.all_predictions_have_id ? (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold bg-[#16a34a]10 text-[#16a34a] border border-[#16a34a]30">
              <CheckCircle2 className="w-2 h-2" /> rule_1 IDs únicos
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold bg-[#dc2626]10 text-[#dc2626] border border-[#dc2626]30">
              <AlertTriangle className="w-2 h-2" /> rule_1 VIOLADO
            </span>
          )}
          {lifecycle.all_predictions_have_sources_or_rejected ? (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold bg-[#16a34a]10 text-[#16a34a] border border-[#16a34a]30">
              <CheckCircle2 className="w-2 h-2" /> rule_5 fuentes/rejected
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold bg-[#dc2626]10 text-[#dc2626] border border-[#dc2626]30">
              <AlertTriangle className="w-2 h-2" /> rule_5 VIOLADO
            </span>
          )}
          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold bg-[#16a34a]10 text-[#16a34a] border border-[#16a34a]30">
            <ShieldCheck className="w-2 h-2" /> rule_3 append-only
          </span>
          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold bg-[#16a34a]10 text-[#16a34a] border border-[#16a34a]30">
            <ShieldCheck className="w-2 h-2" /> rule_6 UI activa
          </span>
        </div>
      </div>

      {/* ─── Collapsible expanded view ─── */}
      {expanded && (
        <div className="border-t border-[#eaeaea] bg-[#fafafa] p-2.5 space-y-3">
          {/* Latest prediction details */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <FileText className="w-3 h-3 text-[#0066cc]" />
              <span className="text-[10px] font-bold text-[#666666] uppercase tracking-[0.1em]">
                Última predicción registrada
              </span>
            </div>
            {latestPred ? (
              <div className="bg-white border border-[#eaeaea] rounded p-2 text-[10px] grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1">
                <div>
                  <span className="text-[#999999]">prediction_id:</span>{' '}
                  <span className="font-mono text-[#000000]">{latestPred.prediction_id}</span>
                </div>
                <div>
                  <span className="text-[#999999]">timestamp:</span>{' '}
                  <span className="text-[#000000]">{formatTimestamp(latestPred.timestamp)}</span>
                </div>
                <div>
                  <span className="text-[#999999]">horizon:</span>{' '}
                  <span className="text-[#000000]">{latestPred.horizon_days}d</span>
                </div>
                <div>
                  <span className="text-[#999999]">expected_return:</span>{' '}
                  <span className="font-mono text-[#000000]">{(latestPred.expected_return * 100).toFixed(3)}%</span>
                </div>
                <div>
                  <span className="text-[#999999]">expected_profit_usd:</span>{' '}
                  <span className="font-mono text-[#000000]">${latestPred.expected_profit_usd.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[#999999]">confidence:</span>{' '}
                  <span className="font-mono text-[#000000]">{(latestPred.confidence_score * 100).toFixed(0)}%</span>
                </div>
                <div>
                  <span className="text-[#999999]">model_version:</span>{' '}
                  <span className="font-mono text-[#000000]">{latestPred.model_version}</span>
                </div>
                <div>
                  <span className="text-[#999999]">freshness:</span>{' '}
                  <span className="text-[#000000]">{latestPred.freshness}</span>
                </div>
                <div>
                  <span className="text-[#999999]">fallback_level:</span>{' '}
                  <span className="text-[#000000]">{latestPred.fallback_level}</span>
                </div>
                <div className="col-span-2 md:col-span-3">
                  <span className="text-[#999999]">data_sources:</span>{' '}
                  <span className="font-mono text-[#0066cc]">
                    {latestPred.data_sources.length > 0 ? latestPred.data_sources.join(' · ') : '∅ (REJECTED per rule_5)'}
                  </span>
                </div>
                <div className="col-span-2 md:col-span-3">
                  <span className="text-[#999999]">asset_context:</span>{' '}
                  <span className="text-[#000000]">{latestPred.asset_context}</span>
                  <span className="text-[#cccccc] mx-1">·</span>
                  <span className="text-[#999999]">stress_mode:</span>{' '}
                  <span className="text-[#000000]">{latestPred.stress_mode}</span>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-[#999999] italic">
                Sin predicciones registradas todavía. Las predicciones se registran automáticamente cuando el motor Amira produce una salida no-OFF.
              </div>
            )}
          </div>

          {/* Latest verification details */}
          {latestVer && (
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <CheckCircle2 className="w-3 h-3 text-[#16a34a]" />
                <span className="text-[10px] font-bold text-[#666666] uppercase tracking-[0.1em]">
                  Última verificación
                </span>
              </div>
              <div className="bg-white border border-[#eaeaea] rounded p-2 text-[10px] grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1">
                <div>
                  <span className="text-[#999999]">verification_id:</span>{' '}
                  <span className="font-mono text-[#000000]">{latestVer.verification_id}</span>
                </div>
                <div>
                  <span className="text-[#999999]">timestamp:</span>{' '}
                  <span className="text-[#000000]">{formatTimestamp(latestVer.timestamp)}</span>
                </div>
                <div>
                  <span className="text-[#999999]">prediction_id:</span>{' '}
                  <span className="font-mono text-[#000000]">{latestVer.prediction_id}</span>
                </div>
                <div>
                  <span className="text-[#999999]">error_delta:</span>{' '}
                  <span className="font-mono text-[#000000]">{(latestVer.error_delta * 100).toFixed(3)}%</span>
                </div>
                <div>
                  <span className="text-[#999999]">signed_error:</span>{' '}
                  <span
                    className="font-mono"
                    style={{ color: latestVer.signed_error >= 0 ? '#dc2626' : '#16a34a' }}
                  >
                    {latestVer.signed_error >= 0 ? '+' : ''}{(latestVer.signed_error * 100).toFixed(3)}%
                  </span>
                </div>
                <div>
                  <span className="text-[#999999]">brier_like:</span>{' '}
                  <span className="font-mono text-[#000000]">{latestVer.brier_like_score.toFixed(3)}</span>
                </div>
                <div>
                  <span className="text-[#999999]">directional_accuracy:</span>{' '}
                  <span style={{ color: latestVer.directional_accuracy === 1 ? '#16a34a' : '#dc2626' }} className="font-bold">
                    {latestVer.directional_accuracy === 1 ? 'CORRECTA' : 'INCORRECTA'}
                  </span>
                </div>
                <div>
                  <span className="text-[#999999]">drift_detected:</span>{' '}
                  <span style={{ color: latestVer.drift_detected ? '#dc2626' : '#16a34a' }} className="font-bold">
                    {latestVer.drift_detected ? 'SÍ' : 'NO'}
                  </span>
                </div>
                <div>
                  <span className="text-[#999999]">calibration_update:</span>{' '}
                  <span className="font-mono text-[#000000]">{latestVer.calibration_update.toFixed(6)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Counts breakdown */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <History className="w-3 h-3 text-[#0066cc]" />
              <span className="text-[10px] font-bold text-[#666666] uppercase tracking-[0.1em]">
                Logs (append-only · audit_mode on)
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <CountBadge label="total" count={lifecycle.counts.total_predictions} color="#000000" />
              <CountBadge label="pending" count={lifecycle.counts.pending} color="#0066cc" />
              <CountBadge label="outcome_captured" count={lifecycle.counts.outcome_captured} color="#ca8a04" />
              <CountBadge label="verified" count={lifecycle.counts.verified} color="#16a34a" />
              <CountBadge label="expired" count={lifecycle.counts.expired} color="#6b7280" />
              <CountBadge label="rejected" count={lifecycle.counts.rejected} color="#dc2626" />
              <span className="text-[9px] text-[#999999] ml-1">
                log_sizes: {lifecycle.log_size_predictions}/{lifecycle.log_size_outcomes}/{lifecycle.log_size_verifications}
              </span>
            </div>
          </div>

          {/* Verification score details */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <Activity className="w-3 h-3 text-[#16a34a]" />
              <span className="text-[10px] font-bold text-[#666666] uppercase tracking-[0.1em]">
                Score de verificación (rolling · últimos 30)
              </span>
            </div>
            <div className="bg-white border border-[#eaeaea] rounded p-2 text-[10px] grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1">
              <div>
                <span className="text-[#999999]">brier_like:</span>{' '}
                <span className="font-mono" style={{ color: verificationColor }}>
                  {lifecycle.verification_score.brier_like.toFixed(3)}
                </span>
              </div>
              <div>
                <span className="text-[#999999]">mae:</span>{' '}
                <span className="font-mono text-[#000000]">{(lifecycle.verification_score.mae * 100).toFixed(3)}%</span>
              </div>
              <div>
                <span className="text-[#999999]">directional_accuracy:</span>{' '}
                <span className="font-mono text-[#000000]">{lifecycle.verification_score.directional_accuracy_pct.toFixed(1)}%</span>
              </div>
              <div>
                <span className="text-[#999999]">sample_count:</span>{' '}
                <span className="font-mono text-[#000000]">{lifecycle.verification_score.sample_count}</span>
              </div>
              <div className="col-span-2 md:col-span-4">
                <span className="text-[#999999]">status:</span>{' '}
                <span style={{ color: verificationColor }} className="font-bold">
                  {lifecycle.verification_score.label}
                </span>
              </div>
            </div>
          </div>

          {/* Drift indicator details */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <AlertTriangle
                className="w-3 h-3"
                style={{ color: driftColorValue }}
              />
              <span className="text-[10px] font-bold text-[#666666] uppercase tracking-[0.1em]">
                Drift indicator (rolling · últimos 10 verifications)
              </span>
            </div>
            <div className="bg-white border border-[#eaeaea] rounded p-2 text-[10px] grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1">
              <div>
                <span className="text-[#999999]">signal:</span>{' '}
                <span
                  className="font-mono"
                  style={{ color: driftColorValue }}
                >
                  {lifecycle.drift_indicator.signal >= 0 ? '+' : ''}{(lifecycle.drift_indicator.signal * 100).toFixed(3)}%
                </span>
              </div>
              <div>
                <span className="text-[#999999]">threshold:</span>{' '}
                <span className="font-mono text-[#000000]">±{(lifecycle.drift_indicator.threshold * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-[#999999]">detected:</span>{' '}
                <span style={{ color: driftColorValue }} className="font-bold">
                  {lifecycle.drift_indicator.detected ? 'SÍ — RECALIBRAR' : 'NO'}
                </span>
              </div>
              <div className="col-span-2 md:col-span-3">
                <span className="text-[#999999]">label:</span>{' '}
                <span className="text-[#000000]">{lifecycle.drift_indicator.label}</span>
              </div>
            </div>
            <div className="text-[9px] text-[#999999] mt-1 italic">
              Per rule_4: VERIFICATION es obligatorio antes de recalibrar modelos. Si drift_detected = SÍ, el sistema debe recalibrar antes de generar nuevas predicciones.
            </div>
          </div>

          {/* Footer note */}
          <div className="text-[9px] text-[#666666] border-t border-[#eaeaea] pt-2 italic">
            <strong>Anti-Frankenstein:</strong> toda métrica en este bloque está respaldada por un
            prediction_id en el log append-only. Per spec{' '}
            <code className="text-[#0066cc]">data_governance.anti_frankenstein_rule</code>:{' '}
            "no_metric_can_exist_without_lifecycle_link". Per{' '}
            <code className="text-[#0066cc]">data_governance.traceability_requirement</code>:{' '}
            "100_percent_predictions_must_be_verifiable".
          </div>
        </div>
      )}
    </div>
  );
}
