// src/components/dashboard/amira-prediction-block.tsx
// V9.3 — AMIRA VISION PREDICTION BLOCK (Ganancia Proyectada)
//
// Per spec `1_restore_profit_blocks`:
//   goal: "Volver a mostrar el bloque de Ganancia Proyectada de forma
//          compacta y coherente, sin duplicar portfolio_value_usd."
//   placement: "Debe vivir dentro del Oracle Multi-Asset / Predicciones
//               Amira vision, debajo del bloque de capital y del motor de
//               decisión, antes de holdings."
//   content: [Ganancia Proyectada, 30d / 60d / 90d selector,
//             valor esperado en USD, porcentaje sobre capital,
//             estado pred ON / pred OFF, razón explícita cuando no haya
//             predicción]
//   rule: "Si la predicción está off, mostrar forecast derivado del motor
//          con label claro, no esconder el bloque."
//
// Per spec `ui_spec.profit_block_behavior`:
//   variants:
//     - pred ON: mostrar valor estimado 30d/60d/90d
//     - pred PARTIAL: mostrar estimación derivada con badge DERIVED
//     - pred OFF: mostrar 'Sin predicción suficiente' + razón + fallback del motor
//   must_be_visible: true
//   must_not_hide_on_mobile: true
//
// Per spec `ui_spec.mobile_rules`:
//   - bloques apilados verticalmente
//   - texto grande y legible
//   - tarjetas compactas, no comprimidas
//   - selector 30/60/90 con botones grandes
//   - nunca más de 2 métricas por fila en mobile
//
// Per spec `3_no_frankenstein_rule`:
//   - Un solo bloque para Ganancia Proyectada
//   - Un solo motor de predicción
//   - El bloque PREDICTION_VIEW puede leer portfolio_value_usd pero no redefinirlo
//
// SAFE MODIFICATIONS: This component consumes `viewModel.unified_prediction`
// (single source of truth) — it does NOT recompute from raw allocations. It
// also reads `viewModel.capital` to display the % over capital.

'use client';

import { DollarSign, TrendingUp, TrendingDown, AlertCircle, Brain, Activity } from 'lucide-react';
import type { PortfolioViewModel } from '@/lib/amira-portfolio-view-model';

export type PredictionHorizon = '30d' | '60d' | '90d';

interface AmiraPredictionBlockProps {
  viewModel: PortfolioViewModel;
  horizon: PredictionHorizon;
  onHorizonChange: (h: PredictionHorizon) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(n).toLocaleString('es-AR', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(2)}%`;
}

// ─── Status Badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'ON' | 'OFF' | 'PARTIAL' }) {
  const config = {
    ON:      { bg: '#16a34a', text: '#ffffff', label: 'pred ON',      icon: Brain },
    PARTIAL: { bg: '#ca8a04', text: '#ffffff', label: 'pred PARTIAL', icon: Activity },
    OFF:     { bg: '#6b7280', text: '#ffffff', label: 'pred OFF',     icon: AlertCircle },
  } as const;
  const c = config[status];
  const Icon = c.icon;
  return (
    <span
      data-testid="prediction-status-pill"
      data-prediction-status={status}
      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.text }}
    >
      <Icon className="w-2.5 h-2.5" />
      {c.label}
    </span>
  );
}

// ─── Freshness Badge ────────────────────────────────────────────────────────

function FreshnessBadge({ freshness }: { freshness: 'REAL' | 'STALE' | 'SIMULADO' | 'DERIVED' }) {
  const config = {
    REAL:      { bg: '#dcfce7', color: '#16a34a', border: '#16a34a40' },
    DERIVED:   { bg: '#dbeafe', color: '#0066cc', border: '#0066cc40' },
    SIMULADO:  { bg: '#fef3c7', color: '#ca8a04', border: '#ca8a0440' },
    STALE:     { bg: '#fee2e2', color: '#dc2626', border: '#dc262640' },
  } as const;
  const c = config[freshness];
  return (
    <span
      data-testid="prediction-freshness-pill"
      data-freshness={freshness}
      className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded"
      style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}
    >
      {freshness}
    </span>
  );
}

// ─── Main Block ─────────────────────────────────────────────────────────────

export function AmiraPredictionBlock({
  viewModel,
  horizon,
  onHorizonChange,
}: AmiraPredictionBlockProps) {
  const pred = viewModel.unified_prediction;
  const capital = viewModel.capital;

  // ─── Determine which horizon's values to show as the headline ───
  const horizonMap: Record<PredictionHorizon, { ret: number; usd: number; label: string }> = {
    '30d': { ret: pred.expected_return_30d, usd: pred.expected_profit_usd_30d, label: '30 días' },
    '60d': { ret: pred.expected_return_60d, usd: pred.expected_profit_usd_60d, label: '60 días' },
    '90d': { ret: pred.expected_return_90d, usd: pred.expected_profit_usd_90d, label: '90 días' },
  };
  const current = horizonMap[horizon];
  const isPositive = current.usd >= 0;
  const gainColor = current.usd === 0 ? '#666666' : isPositive ? '#16a34a' : '#dc2626';

  // ─── Confidence visual (0-100%) ───
  const confidencePct = Math.round(pred.confidence * 100);
  const confidenceColor = pred.confidence >= 0.7 ? '#16a34a' : pred.confidence >= 0.4 ? '#ca8a04' : '#dc2626';

  // ─── Source agreement visual (0-100%) ───
  const agreementPct = Math.round(pred.source_agreement_index * 100);

  return (
    <div
      data-testid="profit-projection-block"
      data-prediction-view="true"
      data-prediction-status={pred.prediction_status}
      data-prediction-source={pred.source}
      data-prediction-freshness={pred.freshness}
      data-prediction-confidence={pred.confidence.toFixed(3)}
      data-prediction-horizon={horizon}
      className="bg-gradient-to-br from-[#f0fdf4] via-[#ffffff] to-[#eff6ff] border-2 border-[#0066cc]/30 rounded-lg p-2.5 mb-3"
    >
      {/* ─── Header ─── */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <DollarSign className="w-3.5 h-3.5 text-[#16a34a]" />
        <span className="text-[12px] font-extrabold text-[#000000] uppercase tracking-wider">
          Ganancia Proyectada
        </span>
        <StatusBadge status={pred.prediction_status} />
        <FreshnessBadge freshness={pred.freshness} />
        <span className="text-[9px] text-[#666666] ml-auto tabular-nums">
          capital: <strong className="text-[#000000]">${capital.toLocaleString('es-AR')}</strong>
        </span>
      </div>

      {/* ─── Reason line (always visible per spec rule) ─── */}
      <div
        data-testid="prediction-reason"
        className="text-[10px] text-[#666666] mb-2 leading-snug"
      >
        {pred.prediction_reason}
      </div>

      {/* ─── Main GANANCIA display — large, legible ─── */}
      <div className="bg-[#ffffff] border border-[#e5e7eb] rounded-lg p-3 mb-2">
        <div className="flex items-start justify-between gap-3">
          {/* Left: value + percent */}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase font-bold tracking-wider text-[#999999] mb-1">
              {pred.source === 'fallback'
                ? 'Escenario estático de referencia · ' + current.label
                : 'GANANCIA estimada · ' + current.label}
            </div>
            {pred.source === 'fallback' && (
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-[#dc2626] text-white tracking-wider">PRED OFF</span>
                <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-[#6b7280] text-white tracking-wider">NO ES PREDICCIÓN ML</span>
              </div>
            )}
            <div
              data-testid="profit-gain-value"
              className="text-[27px] sm:text-[29px] font-extrabold tabular-nums leading-none"
              style={{ color: gainColor }}
            >
              {pred.source === 'off'
                ? 'Sin predicción suficiente'
                : formatUsd(current.usd)}
            </div>
            <div className="text-[12px] text-[#666666] mt-1 tabular-nums">
              {pred.source === 'off'
                ? 'Mostrando fallback del motor · ver razón arriba'
                : `${formatPct(current.ret)} sobre capital`}
            </div>
          </div>
          {/* Right: direction arrow */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div
              className="text-[15px] font-bold tabular-nums px-2 py-0.5 rounded"
              style={{
                background: gainColor === '#16a34a' ? '#f0fdf4' : gainColor === '#dc2626' ? '#fef2f2' : '#f3f4f6',
                color: gainColor,
              }}
            >
              {pred.source === 'off' ? '—' : isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Horizon selector: 3 horizons side-by-side, clickable cards ───
          NOTE: previously there were TWO horizon selectors (large buttons
          above + clickable cards below) showing the same data — the selected
          horizon appeared twice. Now there is only ONE selector that is also
          the comparison row. Clicking a card changes the hero block above. */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        {(Object.keys(horizonMap) as PredictionHorizon[]).map((h) => {
          const data = horizonMap[h];
          const c = data.usd === 0 ? '#666666' : data.usd >= 0 ? '#16a34a' : '#dc2626';
          return (
            <button
              key={h}
              onClick={() => onHorizonChange(h)}
              data-testid={`profit-horizon-${h}`}
              className={`bg-[#ffffff] border rounded p-2 text-center transition-all ${
                horizon === h ? 'border-[#0066cc] shadow-sm bg-[#eff6ff]' : 'border-[#e5e7eb] hover:border-[#cccccc]'
              }`}
            >
              <div className="text-[10px] uppercase font-bold tracking-wider text-[#999999]">{data.label}</div>
              <div className="text-[14px] font-extrabold tabular-nums mt-0.5" style={{ color: c }}>
                {pred.source === 'off' ? 'N/D' : formatUsd(data.usd)}
              </div>
              <div className="text-[10px] text-[#666666] tabular-nums">
                {pred.source === 'off' ? '—' : formatPct(data.ret)}
              </div>
            </button>
          );
        })}
      </div>

      {/* ─── Quality metrics row (confidence + source agreement, max 2 per row) ─── */}
      <div className="grid grid-cols-2 gap-2 mb-1">
        {/* Confidence */}
        <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2">
          <div className="text-[9px] uppercase font-bold tracking-wider text-[#999999] mb-1">
            Confianza
          </div>
          <div className="flex items-baseline gap-1">
            <span
              data-testid="prediction-confidence-value"
              className="text-[15px] font-extrabold tabular-nums"
              style={{ color: confidenceColor }}
            >
              {confidencePct}%
            </span>
          </div>
          <div className="w-full h-1 bg-[#f3f4f6] rounded-full mt-1 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${confidencePct}%`, background: confidenceColor }}
            />
          </div>
        </div>
        {/* Source agreement */}
        <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2">
          <div className="text-[9px] uppercase font-bold tracking-wider text-[#999999] mb-1">
            Acuerdo fuentes
          </div>
          <div className="flex items-baseline gap-1">
            <span
              data-testid="prediction-agreement-value"
              className="text-[15px] font-extrabold tabular-nums text-[#0066cc]"
            >
              {agreementPct}%
            </span>
          </div>
          <div className="w-full h-1 bg-[#f3f4f6] rounded-full mt-1 overflow-hidden">
            <div
              className="h-full rounded-full transition-all bg-[#0066cc]"
              style={{ width: `${agreementPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ─── Footer caveat — explains source + formula provenance ─── */}
      <div className="text-[9px] text-[#999999] mt-1.5 leading-snug">
        {pred.source === 'ml'
          ? 'Proyección ML ensemble (Linear + EWMA + Momentum + Bayesian) ponderada por peso de asignación · 60d = (1+r30)²−1 · 90d = ML ret_90d si disponible · para el peor caso ver Proyección Stress.'
          : pred.source === 'fallback'
            ? 'Pred ' + pred.prediction_status + ' · retorno base mensual por clase de activo (EXPECTED_RETURNS_30D) × ajuste de régimen (CRISIS×0.5, SIDEWAYS×1.0, BULL×1.4) · siempre positivo · 60d = (1+r30)²−1 · 90d = (1+r30)³−1 · para el peor caso ver Proyección Stress.'
            : 'Sin predicción suficiente — esperando que el motor de decisión produzca una proyección. Cuando se hidrate el oráculo, este bloque mostrará el forecast derivado.'}
      </div>
    </div>
  );
}
