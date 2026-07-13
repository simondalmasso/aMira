// src/components/dashboard/amira-scanner-block.tsx
// V10 — AMIRA OPPORTUNITY SCANNER BLOCK
//
// Per spec `architecture_upgrade.new_layers[scanner_layer]`:
//   name: "Opportunity Scanner"
//   responsibility: "Detectar activos, clases y regímenes con edge potencial."
//   must_have: [ranking cross-class, top opportunities by score,
//               filters por clase, señales de momentum / carry / inflación / FX]
//
// Per spec `ui_changes.new_ui_hierarchy`:
//   position 4: "scanner / top opportunities"
//
// Per spec `ui_changes.must_keep_visible`:
//   - Source health (shown in UnifiedStatusBar above, fed by source_health field)
//   - Holdings total (in REBALANCE_VIEW, separate)
//
// Per spec `anti_frankenstein_rules.do`:
//   - "one render path per concept" — this is the ONLY scanner block
//   - "one view model" — consumes viewModel.scanner_output (single source)
//
// Per spec `ui_changes.must_keep_visible`:
//   - "Source health" → rendered in UnifiedStatusBar (separate component)
//   - This block surfaces scanner top_opportunities only.
//
// SAFE MODIFICATIONS: This component consumes viewModel.scanner_output
// (single source of truth) — it does NOT recompute from raw assets. It
// also reads the Zustand store for pinned/dismissed/filter UI state.

'use client';

import {
  Crosshair, TrendingUp, Shield, DollarSign, Activity,
  Pin, X, ChevronRight, Flame,
} from 'lucide-react';
import type { PortfolioViewModel } from '@/lib/amira-portfolio-view-model';
import { useHedgeFundStore } from '@/store/hedge-fund-store';

interface AmiraScannerBlockProps {
  viewModel: PortfolioViewModel;
  /** Callback when user clicks a scanner opportunity (e.g., to scroll to holdings) */
  onSelectAsset?: (assetId: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPct(n: number | null): string {
  if (n == null) return 'N/D';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function getFreshnessColor(f: string): string {
  switch (f) {
    case 'REAL': return '#16a34a';
    case 'STALE': return '#dc2626';
    case 'SIMULADO': return '#ca8a04';
    case 'PARTIAL_FALLBACK': return '#ea580c';
    default: return '#666666';
  }
}

function getSignalIcon(kind: string) {
  switch (kind) {
    case 'momentum': return TrendingUp;
    case 'carry': return DollarSign;
    case 'inflation_hedge': return Shield;
    case 'fx_hedge': return Shield;
    case 'value': return Activity;
    case 'liquidity': return Flame;
    default: return Activity;
  }
}

function getSignalColor(kind: string): string {
  switch (kind) {
    case 'momentum': return '#16a34a';
    case 'carry': return '#0066cc';
    case 'inflation_hedge': return '#7c3aed';
    case 'fx_hedge': return '#0891b2';
    case 'value': return '#ca8a04';
    case 'liquidity': return '#6b7280';
    default: return '#666666';
  }
}

function getSignalLabelShort(kind: string): string {
  switch (kind) {
    case 'momentum': return 'MOM';
    case 'carry': return 'CARRY';
    case 'inflation_hedge': return 'INFL';
    case 'fx_hedge': return 'FX';
    case 'value': return 'VAL';
    case 'liquidity': return 'LIQ';
    default: return kind.toUpperCase();
  }
}

function formatScore(score: number): string {
  return score.toFixed(1);
}

// ─── Main Block ─────────────────────────────────────────────────────────────

const ASSET_CLASSES = ['FCI', 'PLAZO_FIJO', 'ACCIONES', 'BONOS', 'CEDEARS', 'ETF_CEDEARS'] as const;

export function AmiraScannerBlock({ viewModel, onSelectAsset }: AmiraScannerBlockProps) {
  const scanner = viewModel.scanner_output;

  // Store-backed UI state (survives section switches per spec `5_store_changes`)
  const pinnedIds = useHedgeFundStore((s) => s.scannerPinnedAssetIds);
  const dismissedIds = useHedgeFundStore((s) => s.scannerDismissedAssetIds);
  const filterClass = useHedgeFundStore((s) => s.scannerFilterClass);
  const togglePin = useHedgeFundStore((s) => s.toggleScannerPin);
  const toggleDismiss = useHedgeFundStore((s) => s.toggleScannerDismiss);
  const setFilterClass = useHedgeFundStore((s) => s.setScannerFilterClass);

  // Filter out dismissed opportunities, then apply class filter
  const filteredOpportunities = scanner.top_opportunities.filter((o) => {
    if (dismissedIds.includes(o.asset_id)) return false;
    if (filterClass && o.asset_class !== filterClass) return false;
    return true;
  });

  // Pinned opportunities bubble to the top
  const sortedOpportunities = [...filteredOpportunities].sort((a, b) => {
    const aPinned = pinnedIds.includes(a.asset_id) ? 1 : 0;
    const bPinned = pinnedIds.includes(b.asset_id) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return b.scanner_score - a.scanner_score;
  });

  const realPct = scanner.total_scanned > 0
    ? Math.round((scanner.real_count / scanner.total_scanned) * 100)
    : 0;

  return (
    <div
      data-testid="scanner-block"
      data-scanner-view="true"
      data-scanner-total={scanner.total_scanned}
      data-scanner-real-count={scanner.real_count}
      data-scanner-degraded-count={scanner.degraded_count}
      data-scanner-with-signals={scanner.with_signals}
      className="bg-gradient-to-br from-[#fefce8] via-[#ffffff] to-[#eff6ff] border-2 border-[#7c3aed]/30 rounded-lg p-2.5 mb-3"
    >
      {/* ─── Header ─── */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <Crosshair className="w-3.5 h-3.5 text-[#7c3aed]" />
        <span className="text-[12px] font-extrabold text-[#000000] uppercase tracking-wider">
          Scanner de Oportunidades
        </span>
        <span
          className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{
            background: '#dcfce7',
            color: '#16a34a',
            border: '1px solid #16a34a40',
          }}
        >
          {scanner.total_scanned} escaneados
        </span>
        <span
          className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{
            background: realPct >= 70 ? '#dcfce7' : realPct >= 40 ? '#fef3c7' : '#fee2e2',
            color: realPct >= 70 ? '#16a34a' : realPct >= 40 ? '#ca8a04' : '#dc2626',
            border: `1px solid ${realPct >= 70 ? '#16a34a40' : realPct >= 40 ? '#ca8a0440' : '#dc262640'}`,
          }}
          title={`${scanner.real_count} REAL · ${scanner.degraded_count} degradados`}
        >
          {realPct}% REAL
        </span>
        <span className="text-[9px] text-[#666666] ml-auto tabular-nums">
          con señales: <strong className="text-[#000000]">{scanner.with_signals}</strong>
        </span>
      </div>

      {/* ─── Per-class filter pills (compact, mobile-friendly) ─── */}
      <div className="flex gap-1 mb-2 flex-wrap">
        <button
          onClick={() => setFilterClass(null)}
          data-testid="scanner-filter-all"
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
            filterClass === null
              ? 'bg-[#7c3aed] text-[#ffffff]'
              : 'bg-[#f3f4f6] text-[#666666] hover:bg-[#e5e7eb]'
          }`}
        >
          Todas
        </button>
        {ASSET_CLASSES.map((cls) => {
          const breakdown = scanner.by_class[cls];
          const count = breakdown?.count ?? 0;
          if (count === 0) return null;
          const isActive = filterClass === cls;
          return (
            <button
              key={cls}
              onClick={() => setFilterClass(isActive ? null : cls)}
              data-testid={`scanner-filter-${cls.toLowerCase()}`}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                isActive
                  ? 'bg-[#7c3aed] text-[#ffffff]'
                  : 'bg-[#f3f4f6] text-[#666666] hover:bg-[#e5e7eb]'
              }`}
              title={`${cls}: ${count} oportunidades · top score ${breakdown?.top_score ?? 0}`}
            >
              {cls} ({count})
            </button>
          );
        })}
      </div>

      {/* ─── Dominant signals summary (compact row) ─── */}
      {scanner.dominant_signals.length > 0 && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <span className="text-[9px] font-bold text-[#999999] uppercase tracking-wider">Señales:</span>
          {scanner.dominant_signals.slice(0, 4).map((sig) => (
            <span
              key={sig.kind}
              className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{
                background: `${getSignalColor(sig.kind)}15`,
                color: getSignalColor(sig.kind),
                border: `1px solid ${getSignalColor(sig.kind)}40`,
              }}
            >
              {getSignalLabelShort(sig.kind)} ×{sig.count}
            </span>
          ))}
        </div>
      )}

      {/* ─── Empty state ─── */}
      {sortedOpportunities.length === 0 ? (
        <div
          data-testid="scanner-empty-state"
          className="bg-[#ffffff] border border-[#e5e7eb] rounded p-3 text-center"
        >
          <Crosshair className="w-4 h-4 mx-auto mb-1 text-[#999999]" />
          <div className="text-[11px] text-[#666666]">
            {scanner.total_scanned === 0
              ? 'Sin oportunidades — esperando datos del oráculo.'
              : 'Todas las oportunidades fueron descartadas. Click en "Restaurar" para volver a verlas.'}
          </div>
        </div>
      ) : (
        <div
          data-testid="scanner-opportunities-list"
          className="space-y-1.5"
        >
          {sortedOpportunities.map((opp, i) => {
            const isPinned = pinnedIds.includes(opp.asset_id);
            const freshnessColor = getFreshnessColor(opp.freshness);
            return (
              <div
                key={opp.asset_id}
                data-testid={`scanner-row-${opp.asset_id}`}
                data-scanner-rank={i + 1}
                data-scanner-score={opp.scanner_score}
                data-scanner-freshness={opp.freshness}
                data-scanner-pinned={isPinned ? 'true' : 'false'}
                className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2 hover:border-[#7c3aed]/40 transition-colors"
              >
                {/* Row 1: rank + name + score + actions */}
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-[11px] font-extrabold tabular-nums w-5 text-center"
                    style={{ color: i < 3 ? '#7c3aed' : '#999999' }}
                  >
                    #{i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[12px] font-bold text-[#000000] truncate">
                        {opp.name}
                      </span>
                      {opp.ticker && (
                        <span className="text-[9px] text-[#666666] tabular-nums">
                          {opp.ticker}
                        </span>
                      )}
                      {opp.in_active_allocation && (
                        <span
                          className="inline-flex items-center text-[8px] font-bold px-1 py-0.5 rounded"
                          style={{ background: '#16a34a15', color: '#16a34a', border: '1px solid #16a34a40' }}
                          title="Activo ya está en tu asignación actual"
                        >
                          EN PORTFOLIO
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-[#666666] truncate">
                      {opp.asset_class} · {opp.reason}
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <div
                      className="text-[13px] font-extrabold tabular-nums"
                      style={{ color: '#7c3aed' }}
                    >
                      {formatScore(opp.scanner_score)}
                    </div>
                    <div className="text-[8px] text-[#999999] uppercase tracking-wider">
                      score
                    </div>
                  </div>
                  {/* Pin + Dismiss actions */}
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      onClick={() => togglePin(opp.asset_id)}
                      data-testid={`scanner-pin-${opp.asset_id}`}
                      className={`p-0.5 rounded transition-colors ${
                        isPinned
                          ? 'bg-[#7c3aed] text-[#ffffff]'
                          : 'text-[#999999] hover:bg-[#f3f4f6] hover:text-[#7c3aed]'
                      }`}
                      title={isPinned ? 'Desfijar' : 'Fijar arriba'}
                    >
                      <Pin className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={() => toggleDismiss(opp.asset_id)}
                      data-testid={`scanner-dismiss-${opp.asset_id}`}
                      className="p-0.5 rounded text-[#999999] hover:bg-[#fee2e2] hover:text-[#dc2626] transition-colors"
                      title="Descartar"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>

                {/* Row 2: signals + freshness + expected return + drill-down */}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {/* Freshness pill */}
                  <span
                    className="inline-flex items-center text-[8px] font-bold px-1 py-0.5 rounded"
                    style={{
                      background: `${freshnessColor}15`,
                      color: freshnessColor,
                      border: `1px solid ${freshnessColor}40`,
                    }}
                  >
                    {opp.freshness}
                  </span>
                  {/* Signal pills */}
                  {opp.signals.slice(0, 3).map((sig, idx) => {
                    const Icon = getSignalIcon(sig.kind);
                    const color = getSignalColor(sig.kind);
                    return (
                      <span
                        key={`${sig.kind}-${idx}`}
                        className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1 py-0.5 rounded"
                        style={{
                          background: `${color}15`,
                          color,
                          border: `1px solid ${color}40`,
                        }}
                        title={sig.label}
                      >
                        <Icon className="w-2 h-2" />
                        {getSignalLabelShort(sig.kind)}
                      </span>
                    );
                  })}
                  {/* Expected return 30d */}
                  <span className="text-[9px] font-bold tabular-nums ml-auto" style={{
                    color: (opp.expected_return_30d ?? 0) >= 0 ? '#16a34a' : '#dc2626',
                  }}>
                    {formatPct(opp.expected_return_30d)} <span className="text-[#999999] font-normal">30d</span>
                  </span>
                  {/* Confidence (if available) */}
                  {opp.confidence != null && (
                    <span className="text-[8px] text-[#666666] tabular-nums">
                      conf {(opp.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                  {/* Drill-down arrow */}
                  {onSelectAsset && (
                    <button
                      onClick={() => onSelectAsset(opp.asset_id)}
                      data-testid={`scanner-drilldown-${opp.asset_id}`}
                      className="text-[#7c3aed] hover:bg-[#7c3aed]/10 p-0.5 rounded transition-colors"
                      title="Ver en holdings"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Footer: dismissed count + restore button ─── */}
      {dismissedIds.length > 0 && (
        <div className="mt-2 flex items-center justify-between text-[9px] text-[#666666]">
          <span>
            {dismissedIds.length} descartada{dismissedIds.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => {
              dismissedIds.forEach((id) => toggleDismiss(id));
            }}
            data-testid="scanner-restore-dismissed"
            className="text-[#7c3aed] hover:underline font-bold"
          >
            Restaurar
          </button>
        </div>
      )}

      {/* ─── Caveat ─── */}
      <div className="text-[9px] text-[#999999] mt-1.5 leading-snug">
        Scanner consume el ranking del oráculo (top10_by_oracle_score) y aplica señales
        adicionales (momentum / carry / inflación / FX / valor / liquidez). El score final
        combina el oracle_score base con bonus por señal (máx +15 pts). Las oportunidades
        marcadas EN PORTFOLIO ya están en tu asignación actual.
      </div>
    </div>
  );
}
