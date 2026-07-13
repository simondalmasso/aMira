// src/components/dashboard/amira-executor-block.tsx
// V10 — AMIRA PAPER EXECUTOR + MONITOR BLOCK
//
// Per spec `architecture_upgrade.new_layers[executor_layer]`:
//   name: "Paper Executor"
//   responsibility: "Simular rebalanceos, no ejecutar operaciones reales."
//   must_have: [slippage, fees, partial fills, position tracking, paper-only mode]
//
// Per spec `architecture_upgrade.new_layers[monitor_layer]`:
//   name: "Exit + Health Monitor"
//   responsibility: "Controlar riesgo, caducidad de datos, y salida de
//                    posición simulada."
//   must_have: [source freshness, degradation alerts, drawdown guard,
//               prediction confidence guard, liquidity guard]
//
// Per spec `ui_changes.new_ui_hierarchy`:
//   position 7: "risk and sources footer" — this block sits BELOW holdings,
//   alongside the DATA_FOOTER_VIEW, so the user can see simulated execution
//   + risk guardrails + source health in one cluster.
//
// Per spec `anti_frankenstein_rules.do`:
//   - "one render path per concept" — this is the ONLY executor block
//   - "one view model" — consumes viewModel.executor_output + monitor_output
//   - "one explicit fallback per source" — source health badges explicit
//
// Per spec `ui_changes.must_keep_visible`:
//   - "Source health" → rendered here (SourceHealthGrid sub-component)
//   - "REBALANCEAR / SINCRONIZAR / COPIAR / EXPORTAR" → already in
//     GlobalOracleControlBar (separate component, not duplicated here)
//
// SAFE MODIFICATIONS: This component consumes viewModel.executor_output +
// viewModel.monitor_output + viewModel.source_health (single source of
// truth). It does NOT recompute from raw allocations or simulate fills
// independently.

'use client';

import {
  useEffect,
} from 'react';
import {
  Wallet, AlertTriangle, Shield, Activity, Database,
  ChevronDown, ChevronUp, Zap,
} from 'lucide-react';
import type { PortfolioViewModel } from '@/lib/amira-portfolio-view-model';
import { useHedgeFundStore } from '@/store/hedge-fund-store';

interface AmiraExecutorBlockProps {
  viewModel: PortfolioViewModel;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(n).toLocaleString('es-AR', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatUsdAbs(n: number): string {
  return `$${n.toLocaleString('es-AR', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(2)}%`;
}

function formatBps(n: number): string {
  return `${n.toFixed(2)} bps`;
}

function getStatusColor(s: string): string {
  switch (s) {
    case 'GREEN': return '#16a34a';
    case 'AMBER': return '#ca8a04';
    case 'RED': return '#dc2626';
    default: return '#666666';
  }
}

function getStatusLabel(s: string): string {
  switch (s) {
    case 'GREEN': return 'OK';
    case 'AMBER': return 'ATENCIÓN';
    case 'RED': return 'CRÍTICO';
    default: return s;
  }
}

function getSourceStatusColor(status: string): string {
  switch (status) {
    case 'REAL': return '#16a34a';
    case 'STALE': return '#dc2626';
    case 'SIMULADO': return '#ca8a04';
    case 'PARTIAL_FALLBACK': return '#ea580c';
    case 'ERROR': return '#dc2626';
    default: return '#666666';
  }
}

function getSeverityColor(s: string): string {
  switch (s) {
    case 'info': return '#0066cc';
    case 'warning': return '#ca8a04';
    case 'critical': return '#dc2626';
    default: return '#666666';
  }
}

function getSeverityLabel(s: string): string {
  switch (s) {
    case 'info': return 'INFO';
    case 'warning': return 'AVISO';
    case 'critical': return 'CRÍTICO';
    default: return s.toUpperCase();
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ExecutorMetricsRow({ viewModel }: { viewModel: PortfolioViewModel }) {
  const exec = viewModel.executor_output;
  const isProfit = exec.pnl >= 0;
  const pnlColor = exec.pnl === 0 ? '#666666' : isProfit ? '#16a34a' : '#dc2626';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mb-2">
      {/* NAV */}
      <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
        <div className="text-[8px] uppercase font-bold tracking-wider text-[#999999] mb-0.5">
          NAV (paper)
        </div>
        <div className="text-[13px] font-extrabold tabular-nums text-[#000000]">
          {formatUsdAbs(exec.nav)}
        </div>
        <div className="text-[8px] text-[#666666] tabular-nums">
          capital: {formatUsdAbs(exec.starting_capital)}
        </div>
      </div>
      {/* P&L */}
      <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
        <div className="text-[8px] uppercase font-bold tracking-wider text-[#999999] mb-0.5">
          P&L simulado
        </div>
        <div
          data-testid="executor-pnl-value"
          className="text-[13px] font-extrabold tabular-nums"
          style={{ color: pnlColor }}
        >
          {formatUsd(exec.pnl)}
        </div>
        <div className="text-[8px] tabular-nums" style={{ color: pnlColor }}>
          {formatPct(exec.pnl_pct)}
        </div>
      </div>
      {/* Costs */}
      <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
        <div className="text-[8px] uppercase font-bold tracking-wider text-[#999999] mb-0.5">
          Costos sim.
        </div>
        <div className="text-[13px] font-extrabold tabular-nums text-[#dc2626]">
          -{formatUsdAbs(exec.total_fees_usd + exec.total_slippage_usd)}
        </div>
        <div className="text-[8px] text-[#666666] tabular-nums">
          fees ${exec.total_fees_usd.toFixed(0)} + slip ${exec.total_slippage_usd.toFixed(0)}
        </div>
      </div>
      {/* Fills */}
      <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
        <div className="text-[8px] uppercase font-bold tracking-wider text-[#999999] mb-0.5">
          Fills
        </div>
        <div className="text-[13px] font-extrabold tabular-nums text-[#000000]">
          {exec.fill_count}
          <span className="text-[9px] text-[#666666] font-normal"> ({exec.partial_fill_count} parc.)</span>
        </div>
        <div className="text-[8px] text-[#666666] tabular-nums">
          avg fill {(exec.avg_fill_ratio * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
}

function GuardrailGrid({ viewModel }: { viewModel: PortfolioViewModel }) {
  const guardrails = viewModel.monitor_output.guardrails;
  // V10.1: added guardrails.lifecycle_coverage as the 9th guardrail card.
  // Per spec `data_governance.traceability_requirement`:
  //   "100_percent_predictions_must_be_verifiable"
  // The grid layout is grid-cols-2 (mobile) / grid-cols-4 (desktop) — adding
  // a 9th item shifts the layout from 2 rows of 4 to 3 rows (2x4 + 1x1 on
  // desktop, 5 rows of 2 on mobile). Both stay readable.
  const items = [
    guardrails.source_freshness,
    guardrails.drawdown,
    guardrails.prediction_confidence,
    guardrails.liquidity,
    guardrails.concentration,
    guardrails.cash_drag,
    guardrails.emergency_exit,
    guardrails.costs,
    guardrails.lifecycle_coverage,
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mb-2">
      {items.map((g, idx) => {
        const color = getStatusColor(g.status);
        const Icon = g.status === 'GREEN' ? Shield : g.status === 'AMBER' ? AlertTriangle : Zap;
        return (
          <div
            key={idx}
            data-testid={`guardrail-${idx}`}
            data-guardrail-name={g.name}
            data-guardrail-status={g.status}
            className="bg-[#ffffff] border rounded p-1.5"
            style={{ borderColor: `${color}40` }}
          >
            <div className="flex items-center gap-1 mb-0.5">
              <Icon className="w-2.5 h-2.5" style={{ color }} />
              <span className="text-[8px] uppercase font-bold tracking-wider text-[#999999] truncate">
                {g.name}
              </span>
            </div>
            <div
              className="text-[11px] font-extrabold tabular-nums"
              style={{ color }}
            >
              {getStatusLabel(g.status)}
            </div>
            <div className="text-[8px] text-[#666666] truncate" title={g.description}>
              {g.description}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AlertsList({ viewModel }: { viewModel: PortfolioViewModel }) {
  const alerts = viewModel.monitor_output.alerts;
  if (alerts.length === 0) {
    return (
      <div className="bg-[#ffffff] border border-[#16a34a]/30 rounded p-2 flex items-center gap-2 mb-2">
        <Shield className="w-3 h-3 text-[#16a34a]" />
        <span className="text-[11px] font-bold text-[#16a34a]">
          Sin alertas activas · sistema saludable
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-1 mb-2">
      {alerts.slice(0, 5).map((alert, idx) => {
        const color = getSeverityColor(alert.severity);
        return (
          <div
            key={idx}
            data-testid={`alert-${idx}`}
            data-alert-kind={alert.kind}
            data-alert-severity={alert.severity}
            className="bg-[#ffffff] border-l-2 rounded p-1.5 flex items-start gap-1.5"
            style={{ borderColor: color }}
          >
            <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" style={{ color }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span
                  className="text-[8px] font-bold px-1 py-0.5 rounded"
                  style={{ background: `${color}15`, color }}
                >
                  {getSeverityLabel(alert.severity)}
                </span>
                <span className="text-[9px] text-[#666666]">{alert.scope}</span>
              </div>
              <div className="text-[10px] text-[#000000] mt-0.5 leading-snug">
                {alert.message}
              </div>
              <div className="text-[9px] text-[#666666] mt-0.5 leading-snug">
                → {alert.recommended_action}
              </div>
            </div>
          </div>
        );
      })}
      {alerts.length > 5 && (
        <div className="text-[9px] text-[#666666] text-center">
          +{alerts.length - 5} alerta{alerts.length - 5 !== 1 ? 's' : ''} más (ver monitor)
        </div>
      )}
    </div>
  );
}

function SourceHealthGrid({ viewModel }: { viewModel: PortfolioViewModel }) {
  const sources = viewModel.source_health.sources.filter(
    (s) => s.source_id !== 'internal-fallback',
  );
  if (sources.length === 0) {
    return (
      <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2 text-[9px] text-[#666666] italic">
        Sin telemetría de fuentes todavía — las fuentes se registran a medida que el oráculo consulta los endpoints.
      </div>
    );
  }
  return (
    <div
      data-testid="source-health-grid"
      className="grid grid-cols-2 md:grid-cols-4 gap-1.5"
    >
      {sources.map((src) => {
        const color = getSourceStatusColor(src.status);
        const classes = src.asset_classes.length > 0
          ? src.asset_classes.join(', ')
          : 'macro';
        return (
          <div
            key={src.source_id}
            data-testid={`source-health-${src.source_id.toLowerCase()}`}
            data-source-status={src.status}
            data-source-health-score={src.health_score}
            data-source-freshness-score={src.freshness_score}
            className="bg-[#ffffff] border rounded p-1.5"
            style={{ borderColor: `${color}40` }}
            title={src.reason}
          >
            <div className="flex items-center gap-1 mb-0.5">
              <Database className="w-2.5 h-2.5" style={{ color }} />
              <span className="text-[9px] font-bold text-[#000000] truncate">
                {src.source_id}
              </span>
            </div>
            <div
              className="text-[10px] font-extrabold tabular-nums"
              style={{ color }}
            >
              {src.status}
            </div>
            <div className="text-[8px] text-[#666666] tabular-nums">
              health {(src.health_score * 100).toFixed(0)}% · fresh {(src.freshness_score * 100).toFixed(0)}%
            </div>
            <div className="text-[8px] text-[#999999] truncate" title={classes}>
              {classes}
            </div>
            {src.last_success_ts && (
              <div className="text-[8px] text-[#999999] tabular-nums">
                {new Date(src.last_success_ts).toLocaleString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: '2-digit',
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FillsTable({ viewModel }: { viewModel: PortfolioViewModel }) {
  const fills = viewModel.executor_output.fills;
  if (fills.length === 0) {
    return (
      <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2 text-[9px] text-[#666666] italic">
        Sin fills simulados — esperando datos del oráculo.
      </div>
    );
  }
  return (
    <div className="bg-[#ffffff] border border-[#e5e7eb] rounded overflow-x-auto">
      <table className="w-full text-[9px]">
        <thead className="bg-[#f9fafb] border-b border-[#e5e7eb]">
          <tr>
            <th className="text-left py-1 px-1.5 font-bold text-[#666666] uppercase tracking-wider">Activo</th>
            <th className="text-right py-1 px-1.5 font-bold text-[#666666] uppercase tracking-wider">Side</th>
            <th className="text-right py-1 px-1.5 font-bold text-[#666666] uppercase tracking-wider">Peso</th>
            <th className="text-right py-1 px-1.5 font-bold text-[#666666] uppercase tracking-wider">Notional</th>
            <th className="text-right py-1 px-1.5 font-bold text-[#666666] uppercase tracking-wider">Fill</th>
            <th className="text-right py-1 px-1.5 font-bold text-[#666666] uppercase tracking-wider">Fee+Slip</th>
          </tr>
        </thead>
        <tbody>
          {fills.map((fill, idx) => {
            const sideColor = fill.side === 'BUY' ? '#16a34a' : fill.side === 'SELL' ? '#dc2626' : '#666666';
            return (
              <tr
                key={idx}
                data-testid={`executor-fill-${idx}`}
                className="border-b border-[#f3f4f6] last:border-b-0"
              >
                <td className="py-1 px-1.5 text-[#000000] font-bold truncate max-w-[120px]" title={fill.name}>
                  {fill.name}
                  {fill.ticker && (
                    <span className="text-[#666666] font-normal ml-1">{fill.ticker}</span>
                  )}
                </td>
                <td className="py-1 px-1.5 text-right font-bold" style={{ color: sideColor }}>
                  {fill.side}
                </td>
                <td className="py-1 px-1.5 text-right tabular-nums text-[#000000]">
                  {(fill.filled_weight * 100).toFixed(1)}%
                </td>
                <td className="py-1 px-1.5 text-right tabular-nums text-[#000000]">
                  ${fill.filled_notional_usd.toFixed(0)}
                </td>
                <td className="py-1 px-1.5 text-right tabular-nums" style={{
                  color: fill.fill_ratio >= 0.99 ? '#16a34a' : fill.fill_ratio >= 0.65 ? '#ca8a04' : '#dc2626',
                }}>
                  {(fill.fill_ratio * 100).toFixed(0)}%
                </td>
                <td className="py-1 px-1.5 text-right tabular-nums text-[#dc2626]">
                  -${(fill.fee_usd + fill.slippage_cost_usd).toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Block ─────────────────────────────────────────────────────────────

export function AmiraExecutorBlock({ viewModel }: AmiraExecutorBlockProps) {
  const exec = viewModel.executor_output;
  const monitor = viewModel.monitor_output;
  const sourceHealth = viewModel.source_health;

  // Store-backed UI state (survives section switches)
  const executorExpanded = useHedgeFundStore((s) => s.executorExpanded);
  const monitorExpanded = useHedgeFundStore((s) => s.monitorExpanded);
  const setExecutorExpanded = useHedgeFundStore((s) => s.setExecutorExpanded);
  const setMonitorExpanded = useHedgeFundStore((s) => s.setMonitorExpanded);
  const setLastOverallStatus = useHedgeFundStore((s) => s.setLastOverallStatus);
  const setLastPredictionStatus = useHedgeFundStore((s) => s.setLastPredictionStatus);
  const lastOverallStatus = useHedgeFundStore((s) => s.lastOverallStatus);

  // V10: persist the latest overall + prediction status in the store so
  // other components (e.g., a future top status bar) can read them
  // immediately on remount. Per spec `architecture_upgrade.single_source_of_truth`.
  useEffect(() => {
    setLastOverallStatus(monitor.overall_status);
  }, [monitor.overall_status, setLastOverallStatus]);
  useEffect(() => {
    setLastPredictionStatus(viewModel.unified_prediction.prediction_status);
  }, [viewModel.unified_prediction.prediction_status, setLastPredictionStatus]);

  // Confidence + source-agreement meters (small, reusable)
  const overallColor = getStatusColor(monitor.overall_status);
  const OverallIcon = monitor.overall_status === 'GREEN' ? Shield : monitor.overall_status === 'AMBER' ? AlertTriangle : Zap;

  return (
    <div
      data-testid="executor-block"
      data-executor-view="true"
      data-paper-mode="true"
      data-executor-nav={exec.nav}
      data-executor-pnl={exec.pnl}
      data-executor-drawdown={exec.drawdown}
      data-monitor-overall-status={monitor.overall_status}
      data-monitor-alerts-count={monitor.alerts.length}
      data-monitor-degraded-sources={monitor.degraded_source_count}
      data-monitor-error-sources={monitor.error_source_count}
      className="bg-gradient-to-br from-[#fff7ed] via-[#ffffff] to-[#fef2f2] border-2 border-[#ea580c]/30 rounded-lg p-2.5 mb-3"
    >
      {/* ─── Header ─── */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <Wallet className="w-3.5 h-3.5 text-[#ea580c]" />
        <span className="text-[12px] font-extrabold text-[#000000] uppercase tracking-wider">
          Paper Executor + Monitor
        </span>
        <span
          className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{ background: '#dcfce7', color: '#16a34a', border: '1px solid #16a34a40' }}
          title="Modo paper-only: las operaciones son simuladas, no se ejecutan trades reales"
        >
          PAPER-ONLY
        </span>
        {/* Overall status badge */}
        <span
          data-testid="monitor-overall-status-badge"
          className="inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            background: overallColor,
            color: '#ffffff',
          }}
          title={`Status general: ${getStatusLabel(monitor.overall_status)}`}
        >
          <OverallIcon className="w-2.5 h-2.5" />
          {getStatusLabel(monitor.overall_status)}
        </span>
        <span className="text-[9px] text-[#666666] ml-auto tabular-nums">
          alertas: <strong className="text-[#000000]">{monitor.alerts.length}</strong>
          {' · '}
          fuentes: <strong className="text-[#16a34a]">{sourceHealth.healthy_count}</strong> OK
          {' / '}
          <strong className="text-[#ca8a04]">{sourceHealth.degraded_count}</strong> degr
          {' / '}
          <strong className="text-[#dc2626]">{sourceHealth.error_count}</strong> err
        </span>
      </div>

      {/* ─── Executor metrics row ─── */}
      <ExecutorMetricsRow viewModel={viewModel} />

      {/* ─── Guardrails grid ─── */}
      <GuardrailGrid viewModel={viewModel} />

      {/* ─── Alerts list ─── */}
      <AlertsList viewModel={viewModel} />

      {/* ─── Collapsible: Fills table ─── */}
      <div className="mb-2">
        <button
          onClick={() => setExecutorExpanded(!executorExpanded)}
          data-testid="executor-fills-toggle"
          className="w-full flex items-center justify-between bg-[#ffffff] border border-[#e5e7eb] rounded px-2 py-1 hover:bg-[#f9fafb] transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-[#ea580c]" />
            <span className="text-[11px] font-bold text-[#000000]">
              Fills simulados ({exec.fills.length})
            </span>
          </div>
          {executorExpanded ? <ChevronUp className="w-3 h-3 text-[#666666]" /> : <ChevronDown className="w-3 h-3 text-[#666666]" />}
        </button>
        {executorExpanded && (
          <div className="mt-1.5">
            <FillsTable viewModel={viewModel} />
            <div className="text-[9px] text-[#999999] mt-1 leading-snug">
              Fee model: {exec.fills[0]?.fee_bps.toFixed(2) ?? '0.30'} bps por fill ·
              slippage variable por clase de activo (FCI 0.10×base · PF 0.16×base ·
              ACCIONES 0.20×base · BONOS 0.24×base · CEDEARS 0.30×base · ETF_CEDEARS 0.36×base) ·
              fill parcial simulado para liquidez &lt; 20%.
            </div>
          </div>
        )}
      </div>

      {/* ─── Collapsible: Source health grid ─── */}
      <div className="mb-2">
        <button
          onClick={() => setMonitorExpanded(!monitorExpanded)}
          data-testid="source-health-toggle"
          className="w-full flex items-center justify-between bg-[#ffffff] border border-[#e5e7eb] rounded px-2 py-1 hover:bg-[#f9fafb] transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <Database className="w-3 h-3 text-[#ea580c]" />
            <span className="text-[11px] font-bold text-[#000000]">
              Salud de fuentes ({sourceHealth.sources.length})
            </span>
          </div>
          {monitorExpanded ? <ChevronUp className="w-3 h-3 text-[#666666]" /> : <ChevronDown className="w-3 h-3 text-[#666666]" />}
        </button>
        {monitorExpanded && (
          <div className="mt-1.5">
            <SourceHealthGrid viewModel={viewModel} />
            <div className="text-[9px] text-[#999999] mt-1 leading-snug">
              Telemetría de fuentes — cada vez que el oráculo consulta un endpoint (BCRA, INDEC,
              Bluelytics, DolarAPI, ArgentinaDatos, CAFCI, Yahoo Finance), se registra el outcome.
              El freshness score decae según TTL por fuente (Yahoo 30 min · DolarAPI 1 h · BCRA 6 h · INDEC 24 h).
            </div>
          </div>
        )}
      </div>

      {/* ─── Footer caveat ─── */}
      <div className="text-[9px] text-[#999999] mt-1.5 leading-snug">
        Paper Executor simula el rebalanceo aplicando fees + slippage por clase de activo,
        sin ejecutar operaciones reales. El Monitor compone alertas + guardrails desde el
        executor, la predicción unificada, y la salud de fuentes. La salida de emergencia
        está desactivada en paper (sólo se flaggea). Status general:{' '}
        <strong style={{ color: overallColor }}>{getStatusLabel(monitor.overall_status)}</strong>
        {lastOverallStatus && lastOverallStatus !== monitor.overall_status && (
          <span className="text-[#666666]"> (anterior: {getStatusLabel(lastOverallStatus)})</span>
        )}
        .
      </div>
    </div>
  );
}
