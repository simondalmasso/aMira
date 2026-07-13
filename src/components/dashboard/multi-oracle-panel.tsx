// src/components/dashboard/multi-oracle-panel.tsx
// ORACLE_MULTI_ASSET_V4 — Unified dashboard panel for 6 asset classes:
// FCI, PLAZO_FIJO, ACCIONES, BONOS, CEDEARS, ETF_CEDEARS
// + TOP_OPPORTUNITIES (cross-class) + ORACLE_AI (predictions view)
//
// Widgets: search · top_gainers · top_losers · oracle_score_rank ·
//          predictions_7d · predictions_30d · predictions_90d ·
//          risk_heatmap · asset_compare · historical_chart
//
// Guards: never_invent_data, require_source_data, forbid_hallucinated_returns,
//         must_flag_predictions, must_flag_degraded_mode, must_preserve_last_valid_snapshot

'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Trophy, TrendingUp, TrendingDown, Sparkles, ShieldCheck,
  Database, AlertTriangle, RefreshCw, ChevronRight, Brain,
  Wallet, LineChart, Activity, Layers, DollarSign, Gauge, Flame,
} from 'lucide-react';
import type { MultiOracleResponse, AssetMetrics, AssetClass } from '@/lib/oracle-multi';
import { ASSET_CLASS_LABELS, ASSET_CLASS_ORDER } from '@/lib/oracle-multi';
import {
  buildPortfolio,
  buildPortfolioBreakdown,
  buildProfileCards,
  decisionEngineCore,
  formatUsd,
  formatPercent,
  type PortfolioResult,
  type PortfolioBreakdown,
  type DecisionEngineOutput,
  type ProfileCardsOutput,
  type PortfolioProfile,
  type StressMode,
  type Allocation,
  CONSTRAINTS,
} from '@/lib/oracle/portfolio-engine';
import { ProfileCardsCompact } from './portfolio-profiles';
import { ASSET_CLASS_FILTER_EVENT_MAP } from '@/lib/amira-event-bus';
// V9.2 — Single source of truth + render scope isolation.
import {
  usePortfolioViewModel,
  computeStaleMetadata,
  RENDER_SCOPES,
  type PortfolioViewModel,
} from '@/lib/amira-portfolio-view-model';
// V9.3 — Amira Vision Prediction Block (replaces V4.1 ProfitProjectionBlock).
// Per spec `1_restore_profit_blocks`: visible block, 30/60/90 selector,
// ON/OFF/PARTIAL status, never hidden behind tabs/accordions.
import { AmiraPredictionBlock, type PredictionHorizon } from './amira-prediction-block';
// V10 — Amira Scanner + Executor + Monitor blocks. Per spec
// `architecture_upgrade.new_layers` (scanner_layer, executor_layer, monitor_layer).
// Both consume the same viewModel (single source of truth).
import { AmiraScannerBlock } from './amira-scanner-block';
import { AmiraExecutorBlock } from './amira-executor-block';
// V10.1 — Prediction Lifecycle Tracker. Per spec `ui_changes.new_component`:
//   "PredictionLifecycleTracker". Per spec `pipeline_position`:
//   "after_calibration_before_executor" — mounted between PREDICTION_VIEW
//   and SCANNER_VIEW so the lifecycle trace is visible immediately after
//   the prediction block that produces it, and before the scanner that
//   consumes downstream state.
import { PredictionLifecycleTracker } from './prediction-lifecycle-tracker';
import { RenderScope } from './amira-render-scope';
// V9.3: Zustand store — used to persist predictionHorizon across section changes
// (per spec `5_store_changes`).
import { useHedgeFundStore } from '@/store/hedge-fund-store';

// ─── Badges ────────────────────────────────────────────────────────────────

// Map English risk labels (from engine) to Spanish uppercase display.
// Engine returns 'conservative' | 'balanced' | 'aggressive' — we show the
// Spanish equivalent so the user-visible text is consistently es-AR.
const RISK_LABEL_ES_UPPER: Record<string, string> = {
  conservative: 'CONSERVADOR',
  balanced: 'MODERADO',
  aggressive: 'AGRESIVO',
};

// ─── V9 Unified Source Health + Freshness + Regime Bar ─────────────────────
// Per spec `ui_fixes.visual_cleanup.add`:
//   - single global freshness indicator
//   - source health bar per dataset
//   - unified regime badge
// Replaces fragmented per-widget timestamps and removes the ambiguity of
// "STALE 83% REAL" labels without mathematical definition.

const REGIME_BADGE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  CRISIS:     { bg: '#dc2626', text: '#ffffff', label: 'CRISIS' },
  SIDEWAYS:   { bg: '#ca8a04', text: '#ffffff', label: 'LATERAL' },
  BULL:       { bg: '#16a34a', text: '#ffffff', label: 'ALCISTA' },
  CARRY:      { bg: '#0066cc', text: '#ffffff', label: 'CARRY' },
  TRANSITION: { bg: '#666666', text: '#ffffff', label: 'TRANSICIÓN' },
};

function UnifiedRegimeBadge({ regime }: { regime: string }) {
  const style = REGIME_BADGE_STYLE[regime] ?? REGIME_BADGE_STYLE.TRANSITION;
  return (
    <span
      data-testid="unified-regime-badge"
      data-regime={regime}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-[0.1em] whitespace-nowrap"
      style={{ background: style.bg, color: style.text }}
      title={`Régimen unificado: ${style.label}`}
    >
      <span className="w-1 h-1 rounded-full bg-current opacity-80 animate-pulse" />
      {style.label}
    </span>
  );
}

function FreshnessIndicator({ score, label }: { score: number; label: string }) {
  // score: 0..1 (1 = fresh, 0 = stale)
  const pct = Math.max(0, Math.min(100, score * 100));
  const color = pct >= 70 ? '#16a34a' : pct >= 40 ? '#ca8a04' : '#dc2626';
  return (
    <div
      data-testid="freshness-indicator"
      data-score={pct.toFixed(0)}
      className="inline-flex items-center gap-1.5"
      title={`Freshness ${label}: ${pct.toFixed(0)}%`}
    >
      <span className="text-[9px] font-bold text-[#666666] uppercase tracking-[0.1em]">{label}</span>
      <div className="w-12 h-1.5 bg-[#eaeaea] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[9px] font-bold tabular-nums" style={{ color }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function SourceHealthPill({ sourceId, status }: { sourceId: string; status: string }) {
  const cfg: Record<string, { color: string; label: string }> = {
    healthy:       { color: '#16a34a', label: 'OK' },
    degraded:      { color: '#ca8a04', label: 'DEGR' },
    error:         { color: '#dc2626', label: 'ERR' },
    'circuit-open':{ color: '#7f1d1d', label: 'CB' },
  };
  const c = cfg[status] ?? cfg.healthy;
  return (
    <span
      data-testid={`source-health-pill-${sourceId.toLowerCase()}`}
      data-source={sourceId}
      data-status={status}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-[0.05em] whitespace-nowrap"
      style={{ background: `${c.color}15`, color: c.color, border: `1px solid ${c.color}40` }}
      title={`Fuente ${sourceId}: ${status}`}
    >
      <span className="w-1 h-1 rounded-full" style={{ background: c.color }} />
      {sourceId} · {c.label}
    </span>
  );
}

/**
 * V9 — Unified status bar shown above the asset tabs.
 * Combines: unified regime badge + single global freshness indicator +
 * source health pills for each dataset (BCRA, DolarAPI, INDEC, etc.).
 * Subscribes to the amira event bus for live updates.
 */
function UnifiedStatusBar({
  regime,
  freshnessScore,
  sources,
}: {
  regime: string;
  freshnessScore: number;
  sources: Array<{ id: string; status: string }>;
}) {
  return (
    <div
      data-testid="unified-status-bar"
      className="flex items-center justify-between gap-2 flex-wrap mb-3 p-2 bg-[#fafafa] border border-[#eaeaea] rounded"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <UnifiedRegimeBadge regime={regime} />
        <FreshnessIndicator score={freshnessScore} label="FRESHNESS" />
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[8px] font-bold text-[#999999] uppercase tracking-[0.1em] mr-1">Fuentes:</span>
        {sources.length === 0 ? (
          <span className="text-[9px] text-[#999999] italic">sin telemetría</span>
        ) : (
          sources.map((s) => <SourceHealthPill key={s.id} sourceId={s.id} status={s.status} />)
        )}
      </div>
    </div>
  );
}
function riskLabelEsUpper(label: string): string {
  return RISK_LABEL_ES_UPPER[label] ?? label.toUpperCase();
}

function MiniBadge({ label, color = 'green' }: { label: string; color?: 'green' | 'purple' | 'amber' | 'red' | 'blue' | 'gray' }) {
  const cfg = {
    green: 'bg-[#16a34a] text-[#ffffff]',
    purple: 'bg-[#7c3aed] text-[#ffffff]',
    amber: 'bg-[#ca8a04] text-[#ffffff]',
    red: 'bg-[#dc2626] text-[#ffffff]',
    blue: 'bg-[#0066cc] text-[#ffffff]',
    gray: 'bg-[#999999] text-[#ffffff]',
  } as const;
  return (
    <span className={`text-[8px] font-bold px-1 py-0.5 rounded tracking-[0.05em] ${cfg[color]}`}>
      {label}
    </span>
  );
}

// ─── Number formatters ─────────────────────────────────────────────────────

function formatARS(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return 'N/D';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPrice(n: number | null | undefined, currency: 'ARS' | 'USD' = 'ARS'): string {
  if (n === null || n === undefined || !isFinite(n)) return 'N/D';
  const prefix = currency === 'USD' ? 'US$' : '$';
  if (n > 0 && n < 1) return `${prefix}${n.toFixed(4)}`;
  return `${prefix}${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

function formatTNA(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return 'N/D';
  return `${(n * 100).toFixed(2)}%`;
}

function formatPct(n: number | null | undefined, withSign = true): string {
  if (n === null || n === undefined || !isFinite(n)) return 'N/D';
  const pct = n * 100; // input is fractional
  const sign = withSign && pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function formatProb(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return 'N/D';
  return `${(n * 100).toFixed(0)}%`;
}

// ─── Score Bar ─────────────────────────────────────────────────────────────

function ScoreBar({ score, color = '#0066cc' }: { score: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-[#e5e7eb] rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
      <span className="text-[10px] font-bold text-[#000000] tabular-nums w-7 text-right">{pct.toFixed(1)}</span>
    </div>
  );
}

// ─── Asset Row ─────────────────────────────────────────────────────────────

function AssetRow({ asset, rank, expanded, onToggle }: {
  asset: AssetMetrics;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isUSD = asset.currency === 'USD';
  const isPF = asset.asset_class === 'PLAZO_FIJO';
  const priceLabel = isPF ? 'TNA' : 'Precio';
  const priceValue = isPF ? formatTNA(asset.price) : formatPrice(asset.price, asset.currency);

  const pred = asset.prediction;
  const hasPred = pred != null && pred.expected_return_30d !== null;
  const highConviction = pred != null && pred.confidence > 0.85;

  return (
    <div className="border-b border-[#f0f0f0]">
      <button
        onClick={onToggle}
        className="w-full text-left py-2 px-2 hover:bg-[#f9fafb] flex items-center gap-2 transition-colors"
      >
        <span className="text-[10px] font-bold text-[#999999] w-5 tabular-nums">#{rank}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-[#000000] truncate max-w-[180px]" title={asset.name}>
              {asset.name}
            </span>
            {asset.ticker && (
              <span className="text-[9px] text-[#666666] font-mono">{asset.ticker}</span>
            )}
            <MiniBadge label={asset.asset_class.replace('_', ' ')} color="blue" />
            {isUSD && <MiniBadge label="USD" color="gray" />}
            {hasPred && <MiniBadge label="PRED" color="purple" />}
            {highConviction && <MiniBadge label="HIGH-CONV" color="green" />}
          </div>
          {asset.issuer && asset.issuer !== asset.name && (
            <span className="text-[9px] text-[#999999] block truncate">{asset.issuer}</span>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5 min-w-[80px]">
          <span className="text-[9px] text-[#666666]">{priceLabel}</span>
          <span className="text-[11px] font-bold text-[#000000] tabular-nums">{priceValue}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5 min-w-[80px]">
          <span className="text-[9px] text-[#666666]">Momentum 7d</span>
          <span className={`text-[11px] font-bold tabular-nums ${asset.momentum_7d == null ? 'text-[#999999]' : (asset.momentum_7d >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]')}`}>
            {formatPct(asset.momentum_7d)}
          </span>
        </div>
        <ScoreBar score={asset.oracle_score} color={asset.oracle_score >= 70 ? '#16a34a' : asset.oracle_score >= 50 ? '#ca8a04' : '#dc2626'} />
        <ChevronRight className={`w-3 h-3 text-[#999999] transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden bg-[#fafafa] px-3 py-2"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
              <Metric label="Score Oracle" value={asset.oracle_score.toFixed(2)} color="#0066cc" />
              <Metric label="Ranking Global" value={`#${asset.rank_global}`} />
              <Metric label="Ranking en Clase" value={`#${asset.rank_in_class}`} />
              <Metric label="Confianza Fuente" value={formatProb(asset.confidence)} />
              <Metric label="Momentum 7d" value={formatPct(asset.momentum_7d)} color={asset.momentum_7d == null ? undefined : (asset.momentum_7d >= 0 ? '#16a34a' : '#dc2626')} />
              <Metric label="Momentum 30d" value={formatPct(asset.momentum_30d)} color={asset.momentum_30d == null ? undefined : (asset.momentum_30d >= 0 ? '#16a34a' : '#dc2626')} />
              <Metric label="Volatilidad" value={asset.volatility == null ? 'N/D' : `${(asset.volatility * 100).toFixed(1)}%`} color={asset.volatility == null ? undefined : (asset.volatility < 0.3 ? '#16a34a' : asset.volatility < 0.6 ? '#ca8a04' : '#dc2626')} />
              <Metric label="Tendencia (R²)" value={asset.trend_strength == null ? 'N/D' : `${(asset.trend_strength * 100).toFixed(1)}%`} />
              <Metric label="Volumen Norm." value={asset.volume_norm == null ? 'N/D' : `${(asset.volume_norm * 100).toFixed(0)}%`} />
              <Metric label="Liquidez" value={asset.liquidity == null ? 'N/D' : `${(asset.liquidity * 100).toFixed(0)}%`} />
              <Metric label="Perf. Relativa" value={asset.relative_performance == null ? 'N/D' : `${(asset.relative_performance * 100).toFixed(0)}%`} />
              <Metric label="Cap. de Mercado" value={formatARS(asset.market_cap_ars)} />
              <Metric label="Volumen" value={asset.volume == null ? 'N/D' : asset.volume.toLocaleString('es-AR', { notation: 'compact' })} />
              <Metric label="Fecha" value={asset.date} />
              <Metric label="Fuente" value={asset.source.replace(/_/g, ' ')} />
              <Metric label="Factor Analista" value={`${(asset.analyst_factor * 100).toFixed(0)}%`} />
            </div>

            {/* Prediction panel */}
            {pred ? (
              <div className="mt-2 pt-2 border-t border-[#e5e7eb]">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Sparkles className="w-3 h-3 text-[#7c3aed]" />
                  <span className="text-[11px] font-bold text-[#7c3aed]">Predicción Ensemble (4 modelos)</span>
                  <MiniBadge label={`conf ${(pred.confidence * 100).toFixed(0)}%`} color={pred.confidence > 0.85 ? 'green' : 'purple'} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <Metric label="Retorno 7d" value={formatPct(pred.expected_return_7d)} color={pred.expected_return_7d == null ? undefined : (pred.expected_return_7d >= 0 ? '#16a34a' : '#dc2626')} />
                  <Metric label="Retorno 30d" value={formatPct(pred.expected_return_30d)} color={pred.expected_return_30d == null ? undefined : (pred.expected_return_30d >= 0 ? '#16a34a' : '#dc2626')} />
                  <Metric label="Retorno 90d" value={formatPct(pred.expected_return_90d)} color={pred.expected_return_90d == null ? undefined : (pred.expected_return_90d >= 0 ? '#16a34a' : '#dc2626')} />
                  <Metric label="Prob. Alcista" value={formatProb(pred.bull_probability)} color="#16a34a" />
                  <Metric label="Prob. Bajista" value={formatProb(pred.bear_probability)} color="#dc2626" />
                  <Metric label="Volatilidad" value={`${(pred.volatility_score * 100).toFixed(1)}%`} />
                </div>
                <div className="mt-1.5 text-[9px] text-[#999999]">
                  Modelos: {pred.models_used.join(' · ')}
                </div>
              </div>
            ) : (
              <div className="mt-2 pt-2 border-t border-[#e5e7eb]">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-[#ca8a04]" />
                  <span className="text-[10px] font-bold text-[#ca8a04]">
                    Predicción no disponible — se requiere historial ≥ 9 días (actual: {asset.date})
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#ffffff] rounded border border-[#f0f0f0] px-1.5 py-1">
      <div className="text-[8px] text-[#999999] uppercase tracking-wider font-semibold">{label}</div>
      <div className="text-[11px] font-bold tabular-nums" style={{ color: color ?? '#000000' }}>{value}</div>
    </div>
  );
}

// ─── Tab definitions ───────────────────────────────────────────────────────

type TabId = 'TOP_OPPORTUNITIES' | 'FCI' | 'PLAZO_FIJO' | 'ACCIONES' | 'BONOS' | 'CEDEARS' | 'ETF_CEDEARS' | 'ORACLE_AI';

const TABS: Array<{ id: TabId; label: string; icon: typeof Trophy }> = [
  { id: 'TOP_OPPORTUNITIES', label: 'Top Oportunidades', icon: Trophy },
  { id: 'FCI', label: 'FCI', icon: Layers },
  { id: 'PLAZO_FIJO', label: 'Plazo Fijo', icon: Wallet },
  { id: 'ACCIONES', label: 'Acciones', icon: TrendingUp },
  { id: 'BONOS', label: 'Bonos', icon: ShieldCheck },
  { id: 'CEDEARS', label: 'CEDEARs', icon: Activity },
  { id: 'ETF_CEDEARS', label: 'ETF CEDEARs', icon: LineChart },
  { id: 'ORACLE_AI', label: 'Oracle AI', icon: Brain },
];

// ─── Source status indicator ───────────────────────────────────────────────

function SourceStatus({ status }: { status: MultiOracleResponse['source_status'] }) {
  const cfg = {
    SUCCESS: { color: 'bg-[#16a34a]', label: 'SUCCESS' },
    PARTIAL_SUCCESS: { color: 'bg-[#ca8a04]', label: 'PARTIAL' },
    DEGRADED: { color: 'bg-[#ea580c]', label: 'DEGRADED' },
    ERROR: { color: 'bg-[#dc2626]', label: 'ERROR' },
  } as const;
  const c = cfg[status];
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full ${c.color} animate-pulse`} />
      <span className="text-[9px] font-bold text-[#666666]">{c.label}</span>
    </span>
  );
}

// ─── Risk Heatmap (volatility × momentum) ──────────────────────────────────

function RiskHeatmap({ assets }: { assets: AssetMetrics[] }) {
  const cells = useMemo(() => {
    if (assets.length === 0) return null;
    // Bin by volatility (5 buckets) × momentum_7d (5 buckets)
    const grid: AssetMetrics[][][] = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => []));
    for (const a of assets) {
      if (a.volatility == null || a.momentum_7d == null) continue;
      const volIdx = Math.min(4, Math.floor(a.volatility * 5));
      const momIdx = Math.min(4, Math.max(0, Math.floor((a.momentum_7d + 0.05) / 0.04)));
      grid[volIdx][momIdx].push(a);
    }
    return grid;
  }, [assets]);

  if (!cells) return <div className="text-[10px] text-[#999999] py-2">Sin datos suficientes para el heatmap.</div>;

  return (
    <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2">
      <div className="text-[10px] font-bold text-[#000000] mb-1">Heatmap de Riesgo — Volatilidad × Momentum 7d</div>
      <div className="grid grid-cols-6 gap-0.5 text-[9px]">
        <div></div>
        <div className="text-center text-[#999999]">-5%</div>
        <div className="text-center text-[#999999]">-1%</div>
        <div className="text-center text-[#999999]">+3%</div>
        <div className="text-center text-[#999999]">+7%</div>
        <div className="text-center text-[#999999]">+11%</div>
        {cells.map((row, volIdx) => (
          <div key={volIdx} className="contents">
            <div className="text-right text-[#999999] pr-1 self-center">{(volIdx * 20)}%</div>
            {row.map((cellAssets, momIdx) => {
              const count = cellAssets.length;
              const best = cellAssets.length > 0
                ? cellAssets.reduce((a, b) => (a.oracle_score > b.oracle_score ? a : b))
                : null;
              const intensity = Math.min(1, count / 5);
              const bg = count === 0 ? '#f9fafb'
                : momIdx < 2 ? `rgba(220, 38, 38, ${0.15 + intensity * 0.6})`
                : momIdx > 2 ? `rgba(22, 163, 74, ${0.15 + intensity * 0.6})`
                : `rgba(202, 138, 4, ${0.15 + intensity * 0.6})`;
              return (
                <div
                  key={momIdx}
                  className="aspect-square flex items-center justify-center rounded text-[8px] font-bold text-[#ffffff]"
                  style={{ background: bg }}
                  title={best ? `${best.name} (score ${best.oracle_score.toFixed(1)})` : ''}
                >
                  {count > 0 ? count : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="text-[8px] text-[#999999] mt-1">
        Eje Y: Volatilidad (0-100%) · Eje X: Momentum 7d · Color: rojo=perdedores, verde=ganadores
      </div>
    </div>
  );
}

// ─── Asset Compare ─────────────────────────────────────────────────────────

function AssetCompare({ assets }: { assets: AssetMetrics[] }) {
  const top5 = assets.slice(0, 5);
  if (top5.length === 0) return null;
  return (
    <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2">
      <div className="text-[10px] font-bold text-[#000000] mb-1">Comparativa Top 5 — Score Oracle</div>
      <div className="space-y-1">
        {top5.map((a, i) => (
          <div key={a.id} className="flex items-center gap-2">
            <span className="text-[9px] font-bold text-[#999999] w-3">#{i + 1}</span>
            <span className="text-[10px] font-bold text-[#000000] truncate flex-1" title={a.name}>{a.name}</span>
            <ScoreBar score={a.oracle_score} color={['#16a34a', '#0066cc', '#7c3aed', '#ca8a04', '#999999'][i]} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Predictions panel (ORACLE_AI tab) ─────────────────────────────────────

function PredictionsPanel({ assets }: { assets: AssetMetrics[] }) {
  const withPred = assets.filter((a) => a.prediction != null);
  const highConv = withPred.filter((a) => (a.prediction?.confidence ?? 0) > 0.85);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2 text-center">
          <div className="text-[9px] text-[#999999] uppercase font-bold">Activos con Predicción</div>
          <div className="text-[19px] font-bold text-[#7c3aed] tabular-nums">{withPred.length}</div>
        </div>
        <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2 text-center">
          <div className="text-[9px] text-[#999999] uppercase font-bold">Alta Convicción (&gt;85%)</div>
          <div className="text-[19px] font-bold text-[#16a34a] tabular-nums">{highConv.length}</div>
        </div>
        <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2 text-center">
          <div className="text-[9px] text-[#999999] uppercase font-bold">Confianza Promedio</div>
          <div className="text-[19px] font-bold text-[#0066cc] tabular-nums">
            {withPred.length > 0
              ? `${((withPred.reduce((s, a) => s + (a.prediction?.confidence ?? 0), 0) / withPred.length) * 100).toFixed(0)}%`
              : 'N/D'}
          </div>
        </div>
      </div>

      <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2">
        <div className="text-[10px] font-bold text-[#000000] mb-1 flex items-center gap-1.5">
          <Brain className="w-3 h-3 text-[#7c3aed]" />
          Predicciones Ensemble (Linear + EWMA + Momentum + Bayesian)
        </div>
        <div className="space-y-1">
          {withPred.length === 0 ? (
            <div className="text-[10px] text-[#999999] py-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-[#ca8a04]" />
              Sin predicciones — se requieren ≥9 días de historial (snapshot diario activo vía cron 20:00 ART)
            </div>
          ) : withPred
              .sort((a, b) => (b.prediction?.confidence ?? 0) - (a.prediction?.confidence ?? 0))
              .slice(0, 30)
              .map((a) => (
                <div key={a.id} className="flex items-center gap-2 py-1 border-b border-[#f0f0f0] last:border-0">
                  <span className="text-[10px] font-bold text-[#000000] truncate flex-1 min-w-0" title={a.name}>{a.name}</span>
                  <MiniBadge label={a.asset_class.replace('_', ' ')} color="blue" />
                  <span className="text-[10px] font-bold tabular-nums w-12 text-right" style={{ color: (a.prediction?.expected_return_30d ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>
                    {formatPct(a.prediction?.expected_return_30d)}
                  </span>
                  <span className="text-[9px] text-[#999999] w-12 text-right">conf {((a.prediction?.confidence ?? 0) * 100).toFixed(0)}%</span>
                  <span className="text-[9px] tabular-nums w-10 text-right text-[#16a34a]">↑{((a.prediction?.bull_probability ?? 0) * 100).toFixed(0)}%</span>
                  <span className="text-[9px] tabular-nums w-10 text-right text-[#dc2626]">↓{((a.prediction?.bear_probability ?? 0) * 100).toFixed(0)}%</span>
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Panel ────────────────────────────────────────────────────────────

export function MultiOraclePanel() {
  const [data, setData] = useState<MultiOracleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('TOP_OPPORTUNITIES');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<string | null>(null);

  // ─── V2: Dynamic Capital + Risk + Stress state (GLOBAL, top-level panel scope) ──
  // V2 spec: risk is on 0-1 scale (default 0.5, range [0,1], step 0.01)
  // Internally converted to 0-100 when calling buildPortfolio (non-breaking engine contract)
  const [capital, setCapital] = useState(2000);
  const [risk, setRisk] = useState(0.5);          // V2: 0-1 scale
  const [stressMode, setStressMode] = useState<StressMode>('SIDEWAYS');

  // ─── V4: Selected profile (drives risk slider via PROFILE_RISK_LEVELS) ──
  // V4_TOP_BLOCK_COMPACT_PORTFOLIO_PROFILES_FIX
  //   - selectedProfile is the user's last click in the compact profile cards
  //   - When the user clicks a card, we set BOTH selectedProfile AND risk to
  //     the profile's canonical risk level (CONSERVADOR=0.15, MODERADO=0.50,
  //     ARRIESGADO=0.85). This way the entire computation graph (allocations,
  //     total portfolio, stress projection, decision engine) updates in sync.
  //   - When the user moves the risk slider directly, selectedProfile is
  //     re-derived from the risk value inside buildProfileCards (no explicit
  //     setState needed — the cards' isSelected flag is computed from risk).
  const [selectedProfile, setSelectedProfile] = useState<PortfolioProfile>('MODERADO');

  const handleProfileSelect = useCallback((profile: PortfolioProfile, riskLevel: number) => {
    setSelectedProfile(profile);
    setRisk(riskLevel);
  }, []);

  // ─── V4.1: Disabled-asset toggles in holdings ──
  // V4.1_TOP_BLOCK_FIXES — Fix 2: per-row checkbox in the holdings table.
  // When the user unchecks an asset, it's added to disabledAssetIds and the
  // V4 portfolio computation graph (computedPortfolio / decision /
  // profileCards / breakdown) is re-run with that asset filtered out.
  const [disabledAssetIds, setDisabledAssetIds] = useState<Set<string>>(new Set());
  const handleToggleAsset = useCallback((assetId: string) => {
    setDisabledAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);
  const handleEnableAll = useCallback(() => setDisabledAssetIds(new Set()), []);
  const handleDisableAll = useCallback(() => {
    setDisabledAssetIds(new Set((data?.rankings.top10_by_oracle_score ?? []).map((a) => a.id)));
  }, [data]);

  // ─── V4.1: Profit projection horizon (30d / 60d / 90d) ──
  // V4.1_TOP_BLOCK_FIXES — Fix 3: GANANCIA $XXXX block with horizon selector.
  // V9.3: now uses the shared PredictionHorizon type from amira-prediction-block.
  // The horizon is persisted in the Zustand store so it survives section
  // changes (per spec `5_store_changes.persist_horizon`). We subscribe via
  // a stable selector so the panel only re-renders when the horizon changes.
  const profitHorizon = useHedgeFundStore((s) => s.predictionHorizon);
  const setPredictionHorizonStore = useHedgeFundStore((s) => s.setPredictionHorizon);
  const setProfitHorizon = useCallback((h: PredictionHorizon) => {
    setPredictionHorizonStore(h);
  }, [setPredictionHorizonStore]);

  const fetchData = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = q && q.trim().length >= 2
        ? `/api/oracle/rankings?topN=50&${new URLSearchParams({ q: q }).toString().replace(/^q=/, 'class=')}`
        : '/api/oracle/rankings?topN=50';
      // Use search endpoint if query is non-empty
      const finalUrl = q && q.trim().length >= 2
        ? `/api/oracle/search?q=${encodeURIComponent(q)}&limit=50`
        : '/api/oracle/rankings?topN=50';
      const res = await fetch(finalUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as MultiOracleResponse;
      setData(json);
      setLastFetch(new Date().toISOString());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== '') fetchData(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchData]);

  const visibleAssets = useMemo<AssetMetrics[]>(() => {
    if (!data) return [];
    // If search active, search response has results[] not by_class
    if (searchQuery && searchQuery.trim().length >= 2 && 'results' in (data as unknown as { results?: AssetMetrics[] })) {
      return (data as unknown as { results: Array<{ asset: AssetMetrics }> }).results.map((r) => r.asset);
    }
    if (activeTab === 'TOP_OPPORTUNITIES') {
      return data.rankings.top10_by_oracle_score;
    }
    if (activeTab === 'ORACLE_AI') {
      return Object.values(data.by_class).flat().filter((a) => a.prediction != null);
    }
    return data.by_class[activeTab as AssetClass] ?? [];
  }, [data, activeTab, searchQuery]);

  const classesCount = data?.metadata.classes_fetched.length ?? 0;
  const classesFailedCount = data?.metadata.classes_failed.length ?? 0;
  const historyDays = data?.metadata.history_days_available ?? 0;
  // V5: predActive is no longer used directly — the prediction status badge now
  // reads from decision.prediction_status (which factors in historyDays, ML
  // coverage, and assetsWithPredictions, with an explicit reason for OFF).
  // Kept for backward-compat with any external consumers; safe to leave as-is.
  const predActive = data?.metadata.prediction_engine_active ?? false;
  void predActive;
  const totalAssets = data?.total_assets ?? 0;

  // ─── V1: Computed portfolio (memoized — capital/risk/stress/oracleData inputs) ──
  // V4.1: oracleData is now filtered by disabledAssetIds so unchecked holdings
  // are excluded from the portfolio computation graph. This is the single
  // source of truth — computedPortfolio / breakdown / decision / profileCards
  // all consume this filtered list and stay in sync with the checkboxes.
  //
  // V5 (GLM_FIX_UI_ENGINE_CONNECTIVITY_V5): we now keep TWO views of the data:
  //   - allOracleAssets (filtered) — feeds the COMPUTATION graph (decision
  //     engine, profit projection, profile cards, totals). Disabled assets
  //     are excluded so the numbers reflect the active portfolio only.
  //   - holdingsRenderRows (unfiltered) — feeds the RENDERING of the holdings
  //     table. Disabled assets STAY VISIBLE (grayed out, ✓ toggle persists)
  //     so the user can re-enable them with a single click. The previous
  //     behavior (filtering then rendering) caused disabled assets to
  //     VANISH from the table — that bug is now fixed.
  const allOracleAssets = useMemo<AssetMetrics[]>(() => {
    if (!data) return [];
    // Flatten all classes (top 25 per class from API response)
    const flat = Object.values(data.by_class).flat();
    if (disabledAssetIds.size === 0) return flat;
    return flat.filter((a) => !disabledAssetIds.has(a.id));
  }, [data, disabledAssetIds]);

  // V5: stable render source for the holdings table — top 10 cross-class by
  // oracle_score from the FULL data (never filtered by disabledAssetIds).
  // Used by PortfolioSimulator to keep disabled rows visible at all times.
  const holdingsRenderRows = useMemo<AssetMetrics[]>(() => {
    if (!data) return [];
    return data.rankings.top10_by_oracle_score.slice(0, 10);
  }, [data]);

  const computedPortfolio = useMemo<PortfolioResult | null>(() => {
    if (!data || allOracleAssets.length === 0) return null;
    return buildPortfolio({
      capital,
      risk: risk * 100,           // V2: convert 0-1 → 0-100 for engine
      stressMode,
      oracleData: allOracleAssets,
      topNPerClass: 5,
    });
  }, [capital, risk, stressMode, allOracleAssets, data]);

  // V2: Computed breakdown at 3 canonical risk levels (conservative/moderate/aggressive)
  // for the HOLDINGS_TOTAL_FOOTER_ROW_V2 side-by-side breakdown display.
  const portfolioBreakdown = useMemo<PortfolioBreakdown | null>(() => {
    if (!data || allOracleAssets.length === 0) return null;
    return buildPortfolioBreakdown({
      capital,
      stressMode,
      oracleData: allOracleAssets,
      topNPerClass: 5,
      selectedRisk: risk,
    });
  }, [capital, risk, stressMode, allOracleAssets, data]);

  // V3: Decision Engine — single source of truth for the Decision Engine Panel.
  // Wraps buildPortfolio() and exposes allocation_vector + expected_return +
  // risk_exposure + scenario_projection as one memoized object.
  //
  // V5 (GLM_FIX_UI_ENGINE_CONNECTIVITY_V5): now also receives oracle metadata
  // (historyDays, assetsWithPredictions, totalAssets) so the engine can produce
  // an explicit prediction_status with reason, AND a profit_projection that
  // falls back to stress-shock-derived forecast when ML predictions are missing.
  const decision = useMemo<DecisionEngineOutput | null>(() => {
    if (!data || allOracleAssets.length === 0) return null;
    return decisionEngineCore({
      capital,
      risk,                        // V3: 0-1 scale (engine converts internally)
      stress: stressMode,
      assets: allOracleAssets,
      topNPerClass: 5,
      // V5: feed oracle metadata into the engine so it can compute
      // prediction_status.reason and profit_projection.source with full context.
      historyDays: data.metadata.history_days_available,
      assetsWithPredictions: data.predictions_summary.assets_with_predictions,
      totalAssetsInOracle: data.total_assets,
    });
  }, [capital, risk, stressMode, allOracleAssets, data]);

  // V4: Compact Profile Cards — computed for the V4 top block.
  // Builds 3 portfolios at canonical risk levels (CONSERVADOR=0.15,
  // MODERADO=0.50, ARRIESGADO=0.85) using the SAME buildPortfolio engine
  // as the rest of V4, so the cards stay consistent with Stress Projection
  // and Total Portfolio Value. Cards scale with `capital` (not hardcoded).
  const profileCards = useMemo<ProfileCardsOutput | null>(() => {
    if (!data || allOracleAssets.length === 0) return null;
    return buildProfileCards({
      capital,
      stressMode,
      oracleData: allOracleAssets,
      selectedRisk: risk,
      selectedProfile,
      topNPerClass: 5,
    });
  }, [capital, risk, stressMode, allOracleAssets, data, selectedProfile]);

  // V9.2: Compose the single source of truth view model.
  // Per spec `critical_fixes.1_single_source_of_truth`:
  //   rule: "solo un objeto puede emitir portfolio_value_usd"
  // The view model wraps (decision + portfolio + breakdown + capital/risk/stress)
  // into ONE memoized object. UI scopes consume `viewModel.portfolio_value_usd`
  // instead of recomputing from raw allocations.
  const viewModel = usePortfolioViewModel(
    decision,
    computedPortfolio,
    portfolioBreakdown,
    capital,
    risk,
    stressMode,
    // V9.3: pass oracle metadata so the unified prediction can compute
    // confidence + freshness from historyDays and source_status.
    // V10: pass oracleResponse + activeAssetIds so the scanner layer can
    // rank opportunities and tag those in the active allocation.
    // Per spec `architecture_upgrade.single_source_of_truth`: all five
    // pipeline layers (ingestion, scanner, brain, executor, monitor) consume
    // the SAME source-of-truth inputs.
    {
      historyDays: data?.metadata.history_days_available ?? 0,
      sourceStatus: data?.source_status,
      oracleResponse: data,
      activeAssetIds: useMemo(() => new Set(decision?.allocations.map(a => a.asset.id) ?? []), [decision]),
    },
  );

  // V9.2: STALE tag control — single metadata flag, NOT a UI duplication trigger.
  // Per spec `critical_fixes.3_stale_tag_control`:
  //   rule: "STALE no puede duplicar bloques, solo modificar badge"
  //   fix: "convert STALE into metadata flag not UI duplication trigger"
  const staleMeta = computeStaleMetadata(
    decision?.prediction_status.active ?? false,
    historyDays,
    data?.source_status,
  );

  return (
    <div className="bg-[#ffffff] border border-[#e5e7eb] rounded-lg p-3">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Database className="w-4 h-4 text-[#0066cc]" />
            <h3 className="text-[14px] font-extrabold text-[#000000]">Predicciones Amira vision</h3>
            <span
              data-testid="amira-advisory-badge"
              className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#ca8a04]/20 text-[#ca8a04] border border-[#ca8a0430] tracking-[0.08em]"
              title="Panel advisory — consume el view-model y el decision engine. No es el panel canónico (ver SingleOraclePanel)."
            >
              ADVISORY · VISUALIZACIÓN
            </span>
            {data && <SourceStatus status={data.source_status} />}
          </div>
          <p className="text-[10px] text-[#666666] mt-0.5">
            {totalAssets} activos · {classesCount} clases activas · {classesFailedCount} fallidas · {historyDays} días de historial ·
            <span
              data-testid="prediction-status-badge"
              data-pred-active={decision?.prediction_status.active ? 'true' : 'false'}
              className="ml-1 inline-flex items-center gap-0.5"
              title={decision?.prediction_status.reason ?? 'Esperando datos'}
            >
              {decision?.prediction_status
                ? (
                  <span className={`font-bold ${decision.prediction_status.active ? 'text-[#16a34a]' : 'text-[#ca8a04]'}`}>
                    {decision.prediction_status.reason}
                  </span>
                )
                : (
                  <span className="font-bold text-[#999999]">pred …</span>
                )}
            </span>
          </p>
        </div>
        <button
          onClick={() => fetchData(searchQuery)}
          disabled={loading}
          className="text-[10px] font-bold text-[#0066cc] hover:bg-[#f0f7ff] px-2 py-1 rounded flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Cargando...' : 'Actualizar'}
        </button>
      </div>

      {/* ─── V9 UNIFIED STATUS BAR ─────────────────────────────────────────
          Single global freshness indicator + source health pills + unified
          regime badge. Replaces fragmented per-widget timestamps and the
          ambiguous "STALE 83% REAL" labels. Per spec `ui_fixes.visual_cleanup.add`.
          Defaults: regime='TRANSITION' (until consensus engine hydrates),
          freshness=0.85 (advisory, real score computed when sources register),
          sources=[] (empty until recordSourceFetch() is called by ingestion).
          V9.2: STALE tag is now a metadata flag (staleMeta.badge_state) — it
          modifies the badge only, never triggers a duplicate render.
          V10: now consumes viewModel.source_health (single source of truth)
          instead of hardcoded BCRA/DolarAPI/INDEC pills. Per spec
          `architecture_upgrade.new_layers[ingestion_layer]`. */}
      <UnifiedStatusBar
        regime={decision?.stress ? (decision.stress === 'CRISIS' ? 'CRISIS' : decision.stress === 'BULL' ? 'BULL' : 'SIDEWAYS') : 'TRANSITION'}
        freshnessScore={viewModel.source_health.overall_freshness_score > 0
          ? viewModel.source_health.overall_freshness_score
          : (staleMeta.is_stale ? 0.35 : 0.85)}
        sources={viewModel.source_health.sources.length > 0
          ? viewModel.source_health.sources
              .filter((s) => s.source_id !== 'internal-fallback')
              .slice(0, 6)
              .map((s) => ({
                id: s.source_id,
                status: s.status === 'REAL' ? 'healthy'
                  : s.status === 'PARTIAL_FALLBACK' ? 'degraded'
                  : s.status === 'STALE' ? 'degraded'
                  : s.status === 'ERROR' ? 'error'
                  : 'healthy',
              }))
          : [
              // Fallback pills when source-health registry is empty (no fetches recorded yet).
              // Per spec `no_hallucination`: "si una señal no tiene datos, se etiqueta
              // como SIMULADO o STALE, nunca se inventa". These pills show "no telemetría"
              // via the existing empty-sources handling in UnifiedStatusBar.
            ]}
      />

      {/* ─── V3: STICKY TOP BAR (capital input + live total portfolio value) ───
          Sticky-top so capital input is ALWAYS visible without scroll.
          Drives the decision engine directly via props.
          V9.2: This is the SINGLE METRICS_VIEW scope — the only block that
          emits `portfolio_value_usd`. Per spec `1_single_source_of_truth.rule`:
          "solo un objeto puede emitir portfolio_value_usd". The value comes
          from viewModel.portfolio_value_usd (single source of truth). */}
      <RenderScope name={RENDER_SCOPES.METRICS_VIEW} testId="metrics-view-scope">
        <StickyTopBar
          capital={capital}
          onCapitalChange={setCapital}
          decision={decision}
          viewModel={viewModel}
        />
      </RenderScope>

      {/* ─── V4: COMPACT PROFILE CARDS (Régimen favorece + 3 selectable cards) ───
          V4_TOP_BLOCK_COMPACT_PORTFOLIO_PROFILES_FIX
          Lives in the SAME visual cluster as StickyTopBar (Capital a invertir /
          Total Portfolio Value / P&L / Stress Projection). Cards are compact
          (max-width 280px · min-height 112px), stacked on mobile, 3-up on
          desktop. Selecting a card drives the V4 risk slider, which in turn
          drives allocations, total portfolio, and stress projection.
          V9.2: STRATEGY_VIEW scope — narrativa + recomendaciones only. */}
      <RenderScope name={RENDER_SCOPES.STRATEGY_VIEW} testId="strategy-view-scope">
        {profileCards && (
          <ProfileCardsCompact
            cards={profileCards.cards}
            selectedProfile={profileCards.selectedProfile}
            recommendedProfile={profileCards.recommendedProfile}
            regimeLabel={profileCards.regimeLabel}
            onSelect={handleProfileSelect}
          />
        )}

        {/* ─── V3: DECISION ENGINE PANEL (risk slider + stress mode + score + exposure) ───
            Explicit decision engine layer on top of the portfolio system.
            Renders inputs (risk_slider_0_1, stress_mode) and outputs
            (allocation_vector, expected_return, risk_exposure, scenario_projection). */}
        <DecisionEnginePanel
          risk={risk}
          stressMode={stressMode}
          onRiskChange={setRisk}
          onStressChange={setStressMode}
          decision={decision}
        />
      </RenderScope>

      {/* ─── V9.3: AMIRA VISION PREDICTION BLOCK (Ganancia Proyectada) ───
          Per spec `1_restore_profit_blocks.placement`:
            "Debe vivir dentro del Oracle Multi-Asset / Predicciones Amira
             vision, debajo del bloque de capital y del motor de decisión,
             antes de holdings."
          Per spec `render_scope_rules.add`:
            "PREDICTION_VIEW para Ganancia Proyectada"
            "Debe compartir estado con METRICS_VIEW, no duplicarlo"
            "Prediction view puede leer portfolio_value_usd pero no puede redefinirlo"
          V9.3 REPLACES the V4.1 ProfitProjectionBlock which was wrapped in
          <SemanticDiffBlock> — the V9.2 SemanticDiffGuard had a bug that
          suppressed the entire block when its content didn't change between
          renders, causing the block to VANISH after hydration. The new
          AmiraPredictionBlock consumes viewModel.unified_prediction
          (single source of truth) and is wrapped in <RenderScope PREDICTION_VIEW>
          — never in <SemanticDiffBlock> (single-instance block, dedupe not
          needed). */}
      <RenderScope name={RENDER_SCOPES.PREDICTION_VIEW} testId="prediction-view-scope">
        <AmiraPredictionBlock
          viewModel={viewModel}
          horizon={profitHorizon}
          onHorizonChange={setProfitHorizon}
        />
      </RenderScope>

      {/* ─── V10.1: PREDICTION LIFECYCLE TRACKER BLOCK ──────────────────────
          Per spec `oracle_upgrade.V10.1-PREDICTION-LIFECYCLE`:
            core_addition.feature_name: "Prediction Lifecycle Chain"
            ui_changes.new_component: "PredictionLifecycleTracker"
            ui_changes.must_display: [prediction_state, pending_outcomes,
              verification_score, drift_indicator]
            ui_changes.remove: [isolated_prediction_blocks_without_trace]
            pipeline_position: "after_calibration_before_executor"
            compatibility_mode: "backward_safe"
          Placement: AFTER PREDICTION_VIEW (Ganancia Proyectada — produces the
          prediction that gets traced), BEFORE SCANNER_VIEW (which consumes
          downstream state). This matches the spec's pipeline_position
          "after_calibration_before_executor" — calibration happens inside
          composeAmiraPrediction() (V10), and the executor layer (AmiraExecutorBlock)
          is downstream of the scanner.

          Per spec `data_governance.anti_frankenstein_rule`:
            "no_metric_can_exist_without_lifecycle_link"
          Per spec `rules.rule_6`: "Toda UI debe mostrar estado lifecycle activo"
          Per spec `anti_frankenstein_rules.do`: "one render path per concept"
          — LIFECYCLE_VIEW is the ONLY lifecycle block in the tree. */}
      <RenderScope name={RENDER_SCOPES.LIFECYCLE_VIEW} testId="lifecycle-view-scope">
        <PredictionLifecycleTracker viewModel={viewModel} />
      </RenderScope>

      {/* ─── V10: AMIRA OPPORTUNITY SCANNER BLOCK ──────────────────────────
          Per spec `ui_changes.new_ui_hierarchy`:
            position 4: "scanner / top opportunities"
          Placement: AFTER capital+portfolio+profit (METRICS+PREDICTION) and
          AFTER decision brain (STRATEGY), BEFORE profile cards (STRATEGY).
          Per spec `architecture_upgrade.new_layers[scanner_layer]`:
            "Detectar activos, clases y regímenes con edge potencial."
          Per spec `anti_frankenstein_rules.do`: "one render path per concept"
          — SCANNER_VIEW is the ONLY scanner block in the tree. */}
      <RenderScope name={RENDER_SCOPES.SCANNER_VIEW} testId="scanner-view-scope">
        <AmiraScannerBlock
          viewModel={viewModel}
          onSelectAsset={(assetId) => {
            // V10: dispatch an AmiraVisionEvent so other components (e.g.,
            // the holdings table) can react to scanner drill-downs.
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('amira:scanner-drilldown', {
                detail: { assetId, timestamp: Date.now() },
              }));
            }
          }}
        />
      </RenderScope>

      {/* ─── Search ─── */}
      <div className="mb-3 relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#999999]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar en todas las clases (FCI, stocks, CEDEARs, bonos, PF...)"
          className="w-full pl-7 pr-3 py-1.5 text-[11px] border border-[#e5e7eb] rounded focus:outline-none focus:border-[#0066cc]"
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); fetchData(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999999] hover:text-[#000000] text-[11px]"
          >
            ✕
          </button>
        )}
      </div>

      {/* ─── Tabs (V8: filter-state-synced, pill-variant, subtle glow on active.
           V9: now also dispatches AmiraVisionEvent per spec event_mapping) ─── */}
      <div
        className="flex flex-wrap gap-1 mb-3"
        data-testid="asset-class-filter-bar"
        data-active-filter={activeTab}
        role="tablist"
        aria-label="Filtro por clase de activo"
      >
        {TABS.map((t) => {
          const isActive = activeTab === t.id;
          const Icon = t.icon;
          // V9: AmiraVisionEvent mapping per spec
          const visionEvent = ASSET_CLASS_FILTER_EVENT_MAP[t.id];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`asset-class-filter-${t.id.toLowerCase()}`}
              data-filter-id={t.id}
              data-active={isActive ? 'true' : 'false'}
              onClick={() => {
                setActiveTab(t.id);
                // V8 event bus: emit ASSET_FILTER_CHANGED for observability / cross-component sync
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('amira:asset-filter-changed', {
                    detail: { filter: t.id, label: t.label, timestamp: Date.now() },
                  }));
                  // V9: emit AmiraVisionEvent (filter_asset_class_*) per spec event_mapping
                  if (visionEvent) {
                    window.dispatchEvent(new CustomEvent(`amira:${visionEvent}`, {
                      detail: { filter: t.id, label: t.label, timestamp: Date.now() },
                    }));
                  }
                }
              }}
              className={`text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 transition-all border ${
                isActive
                  ? 'bg-[#0066cc] text-[#ffffff] border-[#0066cc] shadow-[0_0_0_2px_rgba(0,102,204,0.18)]'
                  : 'bg-[#ffffff] text-[#666666] border-[#eaeaea] hover:bg-[#f3f4f6] hover:border-[#d1d5db]'
              }`}
              title={`Filtrar por ${t.label}`}
            >
              <Icon className="w-3 h-3" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ─── Stats Bar ─── */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
          <StatCard label="Total Activos" value={String(totalAssets)} />
          <StatCard label="Snapshot" value={data.snapshot_date} />
          <StatCard label="Historial (días)" value={String(historyDays)} />
          <StatCard label="Predicciones" value={String(data.predictions_summary.assets_with_predictions)} />
          <StatCard label="Alta Convicción" value={String(data.predictions_summary.high_conviction_count)} />
          <StatCard label="Confianza Promedio" value={data.predictions_summary.avg_confidence == null ? 'N/D' : `${(data.predictions_summary.avg_confidence * 100).toFixed(0)}%`} />
        </div>
      )}

      {/* ─── V2: Portfolio Simulator (Holdings + Total Footer) ───
          Controls are now in <GlobalOracleControlBar> at top of panel.
          This block renders ONLY the allocations table + holdings total footer row.
          V4.1: now accepts disabledAssetIds + onToggleAsset for per-row
          enable/disable checkboxes (Fix 2).
          V5: now accepts holdingsRenderRows (UNFILTERED top-10 by oracle_score)
          so disabled assets STAY VISIBLE in the table (grayed out) instead of
          vanishing. portfolio.allocations (filtered) is still used for the
          totals/footer — only the rendering source changed.
          V9.2: REBALANCE_VIEW scope — acciones + estado only. NOTE: the
          per-row P&L is derived from portfolio.allocations (already computed
          by buildPortfolio), NOT a second portfolio_value_usd emission. */}
      {data && (
        <RenderScope name={RENDER_SCOPES.REBALANCE_VIEW} testId="rebalance-view-scope-holdings">
          {/* V9.3: REBALANCE_VIEW wraps the holdings table. ProfitProjectionBlock
              is no longer in this scope (moved to PREDICTION_VIEW). Per spec
              `2_render_scope_isolation`, multiple non-identical blocks may
              share a scope — they're deduped at the BLOCK level via semantic
              hash, not at the SCOPE level. */}
          <PortfolioSimulator
            portfolio={computedPortfolio}
            breakdown={portfolioBreakdown}
            disabledAssetIds={disabledAssetIds}
            onToggleAsset={handleToggleAsset}
            onEnableAll={handleEnableAll}
            onDisableAll={handleDisableAll}
            renderRows={holdingsRenderRows}
          />
        </RenderScope>
      )}

      {/* ─── V10: AMIRA PAPER EXECUTOR + MONITOR BLOCK ─────────────────────
          Per spec `ui_changes.new_ui_hierarchy`:
            position 7: "risk and sources footer"
          Placement: AFTER holdings (REBALANCE_VIEW), BEFORE the data footer.
          Combines the paper executor (NAV, P&L, fills, costs) + the monitor
          (alerts, guardrails, source health) in one consolidated risk cluster.
          Per spec `architecture_upgrade.new_layers[executor_layer, monitor_layer]`.
          Per spec `anti_frankenstein_rules.do`: "one render path per concept"
          — EXECUTOR_VIEW is the ONLY executor block in the tree. */}
      <RenderScope name={RENDER_SCOPES.EXECUTOR_VIEW} testId="executor-view-scope">
        <AmiraExecutorBlock viewModel={viewModel} />
      </RenderScope>

      {/* ─── Error ─── */}
      {error && (
        <div className="bg-[#fef2f2] border border-[#dc2626]/30 rounded p-2 mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[#dc2626]" />
          <span className="text-[11px] font-bold text-[#dc2626]">Error: {error}</span>
        </div>
      )}

      {/* ─── Degraded mode warning ─── */}
      {data?.source_status === 'DEGRADED' && (
        <div className="bg-[#fff7ed] border border-[#ea580c]/30 rounded p-2 mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[#ea580c]" />
          <span className="text-[11px] font-bold text-[#ea580c]">
            Modo degradado activo — algunas clases de activos no están disponibles. Último snapshot preservado.
          </span>
        </div>
      )}

      {/* ─── Content ─── */}
      {loading && !data ? (
        <div className="py-6 text-center text-[11px] text-[#999999]">
          <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin text-[#0066cc]" />
          Cargando datos de 6 fuentes en paralelo...
        </div>
      ) : activeTab === 'ORACLE_AI' ? (
        <PredictionsPanel assets={visibleAssets} />
      ) : activeTab === 'TOP_OPPORTUNITIES' ? (
        <div className="space-y-3">
          <AssetCompare assets={visibleAssets} />
          <RiskHeatmap assets={Object.values(data?.by_class ?? {}).flat()} />
          <div className="bg-[#ffffff] border border-[#e5e7eb] rounded">
            <div className="px-2 py-1.5 border-b border-[#f0f0f0] flex items-center gap-1.5">
              <Trophy className="w-3 h-3 text-[#ca8a04]" />
              <span className="text-[11px] font-bold text-[#000000]">Top 10 por Score Oracle (cross-class)</span>
            </div>
            {visibleAssets.map((a, i) => (
              <AssetRow
                key={a.id}
                asset={a}
                rank={i + 1}
                expanded={expandedId === a.id}
                onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* V4.1 Fix 1: prominent active-tab content header — makes tab
              switching visible. Shows the canonical class label + asset count
              so the user immediately sees that the tab changed. */}
          <div className="bg-gradient-to-r from-[#0066cc] to-[#7c3aed] text-[#ffffff] rounded-lg px-3 py-2 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5" />
              <span className="text-[12px] font-extrabold uppercase tracking-wider">
                Mostrando: {ASSET_CLASS_LABELS[activeTab as AssetClass]}
              </span>
            </div>
            <span className="text-[11px] font-bold bg-[#ffffff]/15 px-2 py-0.5 rounded-full tabular-nums">
              {visibleAssets.length} activos
            </span>
          </div>

          {/* V4.1 Fix 1: In-class widgets with FALLBACKS.
              The original widgets read `data.rankings.top_gainers_7d` and
              `data.rankings.top_losers_7d` which are populated by the rankings
              engine only when enough 7d momentum data exists. When those are
              empty (the common case in a fresh deployment), the widgets show
              "Sin datos" and the user perceives "no cambia nada" when
              switching tabs. We now compute in-class top-by-oracle-score and
              top-by-prediction_30d as FALLBACKS so the widgets always have
              content and tab switching is visually obvious. */}
          {(() => {
            const classAssets = data?.by_class[activeTab as AssetClass] ?? [];
            // Top by oracle score (fallback for top_gainers when rankings are empty)
            const topByScore = [...classAssets].sort((a, b) => b.oracle_score - a.oracle_score).slice(0, 5);
            // Top by prediction 30d (alternative signal — best expected return)
            const topByPred = classAssets
              .filter((a) => a.prediction?.expected_return_30d != null)
              .sort((a, b) => (b.prediction?.expected_return_30d ?? 0) - (a.prediction?.expected_return_30d ?? 0))
              .slice(0, 5);
            // Worst by prediction 30d (for losers)
            const worstByPred = classAssets
              .filter((a) => a.prediction?.expected_return_30d != null)
              .sort((a, b) => (a.prediction?.expected_return_30d ?? 0) - (b.prediction?.expected_return_30d ?? 0))
              .slice(0, 5);

            const gainersFromRankings = (data?.rankings.top_gainers_7d ?? []).filter((a) => a.asset_class === activeTab).slice(0, 5);
            const losersFromRankings = (data?.rankings.top_losers_7d ?? []).filter((a) => a.asset_class === activeTab).slice(0, 5);

            // Use rankings if populated, else fallback to in-class top-by-prediction
            const gainers = gainersFromRankings.length > 0 ? gainersFromRankings : topByPred;
            const losers = losersFromRankings.length > 0 ? losersFromRankings : worstByPred;

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <MiniRankList title={gainersFromRankings.length > 0 ? 'Top Ganadores 7d' : 'Top Retorno 30d (oracle)'} icon={TrendingUp} color="#16a34a" assets={gainers} />
                <MiniRankList title={losersFromRankings.length > 0 ? 'Top Perdedores 7d' : 'Peor Retorno 30d (oracle)'} icon={TrendingDown} color="#dc2626" assets={losers} />
                {topByScore.length > 0 && gainersFromRankings.length === 0 && (
                  <MiniRankList title="Top Score Oracle (in-class)" icon={Trophy} color="#0066cc" assets={topByScore} />
                )}
              </div>
            );
          })()}

          <div className="bg-[#ffffff] border border-[#e5e7eb] rounded">
            <div className="px-2 py-1.5 border-b border-[#f0f0f0] flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Trophy className="w-3 h-3 text-[#0066cc]" />
                <span className="text-[11px] font-bold text-[#000000]">{ASSET_CLASS_LABELS[activeTab as AssetClass]}</span>
              </div>
              <span className="text-[9px] text-[#999999]">{visibleAssets.length} activos</span>
            </div>
            {visibleAssets.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-[#999999]">
                Sin activos disponibles para esta clase. La fuente puede estar caída — verifique X-Oracle-Status.
              </div>
            ) : (
              visibleAssets.map((a, i) => (
                <AssetRow
                  key={a.id}
                  asset={a}
                  rank={i + 1}
                  expanded={expandedId === a.id}
                  onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* ─── Footer ───
          V9.2: DATA_FOOTER_VIEW scope — solo fuentes + freshness.
          Per spec `2_render_scope_isolation.scopes.DATA_FOOTER_VIEW`:
          "solo fuentes + freshness". This block must NOT show portfolio_value_usd
          or any other METRICS_VIEW data. */}
      {data && (
        <RenderScope name={RENDER_SCOPES.DATA_FOOTER_VIEW} testId="data-footer-view-scope">
          <div className="mt-3 pt-2 border-t border-[#e5e7eb] text-[9px] text-[#999999] space-y-0.5">
            <div>
              <strong>Fuentes:</strong> {data.evidence.slice(0, 6).join(' · ')}
            </div>
            <div>
              <strong>Guards:</strong> never_invent_data={String(data.metadata.guards.never_invent_data)} ·
              require_source_data={String(data.metadata.guards.require_source_data)} ·
              forbid_hallucinated_returns={String(data.metadata.guards.forbid_hallucinated_returns)} ·
              must_flag_predictions={String(data.metadata.guards.must_flag_predictions)} ·
              must_flag_degraded_mode={String(data.metadata.guards.must_flag_degraded_mode)} ·
              must_preserve_last_valid_snapshot={String(data.metadata.guards.must_preserve_last_valid_snapshot)}
            </div>
            <div>
              <strong>Pesos del score:</strong> momentum={data.metadata.score_weights.momentum} · volume={data.metadata.score_weights.volume} ·
              liquidity={data.metadata.score_weights.liquidity} · volatility={data.metadata.score_weights.volatility} ·
              trend={data.metadata.score_weights.trend_strength} · rel_perf={data.metadata.score_weights.relative_performance} ·
              analyst={data.metadata.score_weights.analyst_factor}
            </div>
            {data.errors.length > 0 && (
              <div className="text-[#dc2626]"><strong>Errores ({data.errors.length}):</strong> {data.errors.slice(0, 3).join(' · ')}{data.errors.length > 3 ? ' ...' : ''}</div>
            )}
            <div className="text-[#666666]">Última consulta: {lastFetch}</div>
          </div>
        </RenderScope>
      )}
    </div>
  );
}

// ─── V3: StickyTopBar (capital input + live total portfolio value) ─────────
// V3 spec: TOP_BAR with Global Capital + Currency Input. Must be sticky-top so
// the capital input is ALWAYS visible without scrolling. Drives the decision
// engine directly via the `capital` prop on the parent component.

function StickyTopBar({
  capital,
  onCapitalChange,
  decision,
  viewModel,
}: {
  capital: number;
  onCapitalChange: (v: number) => void;
  decision: DecisionEngineOutput | null;
  viewModel: PortfolioViewModel;
}) {
  // V9.2: Live total portfolio value now comes from viewModel (single source
  // of truth) — NOT recomputed here. Per spec `1_single_source_of_truth.forbidden`:
  //   "inline recalculation in UI layer"
  // The previous code read `decision?.total_portfolio_value ?? capital` —
  // semantically identical, but it was a SECOND derivation of the same
  // concept. Now we read from viewModel.portfolio_value_usd.value so the
  // audit can prove there is exactly ONE emitter of portfolio_value_usd.
  const totalPortfolioValue = viewModel.portfolio_value_usd.value;
  const totalPortfolioProvenance = viewModel.portfolio_value_usd.source;
  const totalPortfolioConfidence = viewModel.portfolio_value_usd.confidence;
  const stressedTotal = decision?.stress_projection.total_stressed_value ?? null;
  const profitAbs = decision?.stress_projection.profit_absolute ?? null;
  const profitPct = decision?.stress_projection.profit_percent ?? null;
  const profitColor = (profitAbs ?? 0) > 0 ? '#16a34a' : (profitAbs ?? 0) < 0 ? '#dc2626' : '#666666';

  return (
    <div
      data-testid="sticky-top-bar"
      className="sticky top-0 z-50 bg-[#0d1117] text-[#ffffff] border-b-4 border-[#0066cc] rounded-t-lg shadow-lg mb-3"
      style={{ position: 'sticky', top: 0, zIndex: 50 }}
    >
      {/* V7: mobile-first responsive layout.
          - mobile (<640px): single column, capital input full width, then portfolio value, then stress
          - desktop (>=640px): horizontal flex with capital input left, metrics right */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-3 items-stretch sm:items-center p-2 sm:p-3">
        {/* Capital input — V3.2 spec field: capital_input
            IMPOSSIBLE-TO-IGNORE white input on dark bar.
            Spec: bg #fff · text #000 · border #d1d5db · radius 12px · padding 12px 14px · font 16px · min-width 220px · placeholder "Ingresá capital"
            Backup `.capital-input` class in globals.css in case Tailwind gets overridden. */}
        <div className="flex flex-col gap-1 w-full sm:min-w-[220px] sm:flex-1 sm:max-w-[320px]">
          <label
            htmlFor="capital-input-field"
            className="text-[11px] uppercase font-extrabold tracking-wider text-[#0066cc] flex items-center gap-1"
          >
            <DollarSign className="w-3 h-3" /> Capital a invertir
          </label>
          <input
            id="capital-input-field"
            data-testid="capital-input"
            type="number"
            min={0}
            step={100}
            value={capital}
            placeholder="Ingresá capital"
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (isFinite(v) && v >= 0) onCapitalChange(v);
            }}
            className="capital-input w-full text-[17px] font-bold tabular-nums"
            style={{
              background: '#ffffff',
              color: '#000000',
              border: '1px solid #d1d5db',
              borderRadius: '12px',
              padding: '12px 14px',
              fontSize: '17px',
              width: '100%',
              minWidth: '0',
              outline: 'none',
              boxShadow: '0 0 0 2px rgba(0, 102, 204, 0.0)',
              transition: 'box-shadow 0.15s ease',
            }}
            onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0, 102, 204, 0.4)'; }}
            onBlur={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px rgba(0, 102, 204, 0.0)'; }}
          />
          <div className="flex gap-1 mt-1 flex-wrap">
            {[1000, 2000, 5000, 10000].map((preset) => (
              <button
                key={preset}
                onClick={() => onCapitalChange(preset)}
                className={`text-[10px] px-2 py-0.5 rounded-md font-bold transition-colors ${
                  capital === preset ? 'bg-[#0066cc] text-[#ffffff]' : 'bg-[#1f2937] text-[#9ca3af] hover:bg-[#374151]'
                }`}
              >
                ${preset >= 1000 ? `${preset / 1000}K` : preset}
              </button>
            ))}
          </div>
        </div>

        {/* Live total portfolio value — V3 spec: portfolio_total_display
            V3.2: displayed in its own prominent block, with data-testid for validation.
            V7: responsive — on mobile takes full width, on desktop right-aligned.
            V9.2: Value comes from viewModel.portfolio_value_usd (single source of
            truth). Provenance badge shows REAL | DERIVED | SIMULADO per data
            contract `required_schema.source`. Confidence shown as small percentage. */}
        <div
          data-testid="portfolio-total"
          data-portfolio-provenance={totalPortfolioProvenance}
          data-portfolio-confidence={totalPortfolioConfidence.toFixed(2)}
          className="w-full sm:w-auto sm:ml-auto flex flex-col gap-0.5 bg-[#1f2937] border border-[#374151] rounded-lg px-3 sm:px-4 py-2 sm:min-w-[180px]"
        >
          <div className="flex items-center gap-1.5">
            <div className="text-[9px] uppercase font-extrabold tracking-wider text-[#9ca3af]">Valor Total del Portfolio</div>
            <span
              className={`text-[8px] font-bold px-1 py-0.5 rounded tracking-[0.08em] ${
                totalPortfolioProvenance === 'REAL'
                  ? 'bg-[#16a34a]/20 text-[#4ade80]'
                  : totalPortfolioProvenance === 'DERIVED'
                    ? 'bg-[#0066cc]/20 text-[#60a5fa]'
                    : 'bg-[#ca8a04]/20 text-[#facc15]'
              }`}
              title={`Provenance: ${totalPortfolioProvenance} · Confidence: ${(totalPortfolioConfidence * 100).toFixed(0)}%`}
            >
              {totalPortfolioProvenance}
            </span>
          </div>
          <div
            className="text-[21px] font-extrabold tabular-nums text-[#ffffff]"
            style={{ fontSize: '21px', lineHeight: 1.1 }}
          >
            {formatUsd(totalPortfolioValue)}
          </div>
          <div className="text-[9px] text-[#9ca3af]">
            Valor total del portfolio · <span data-testid="portfolio-value-label">Valor derivado del portfolio</span>
          </div>
          {profitAbs != null && (
            <div className="text-[11px] font-bold tabular-nums mt-0.5" style={{ color: profitColor }}>
              <span data-testid="pnl-stress-label">P&L proyectado — escenario stress</span> ({decision?.stress ?? 'SIDEWAYS'}): {formatUsd(profitAbs)} ({formatPercent(profitPct ?? 0)})
            </div>
          )}
          <div className="text-[8px] text-[#9ca3af] mt-0.5" title="El P&L proyectado no es el P&L actual. Es una hipótesis bajo escenario de stress.">
            ⚠ El stress P&L no es el P&L actual.
          </div>
        </div>

        {stressedTotal != null && (
          <div
            data-testid="portfolio-stress"
            className="w-full sm:w-auto flex flex-col gap-0.5 bg-[#1f2937] border border-[#374151] rounded-lg px-3 sm:px-4 py-2 sm:min-w-[160px]"
          >
            <div className="text-[9px] uppercase font-extrabold tracking-wider text-[#9ca3af]">Proyección Stress</div>
            <div className="text-[15px] font-bold tabular-nums text-[#ffffff]">{formatUsd(stressedTotal)}</div>
            <div className="text-[9px] text-[#9ca3af]">Valor bajo escenario stress</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── V3: DecisionEnginePanel (allocation logic + risk slider + exposure) ────
// V3 spec: explicit decision engine layer. Renders inputs (risk_slider_0_1,
// stress_mode) and outputs (allocation_vector summary, expected_return,
// risk_exposure, scenario_projection).

function DecisionEnginePanel({
  risk,
  stressMode,
  onRiskChange,
  onStressChange,
  decision,
}: {
  risk: number;                      // V3: 0-1 scale
  stressMode: StressMode;
  onRiskChange: (v: number) => void;
  onStressChange: (v: StressMode) => void;
  decision: DecisionEngineOutput | null;
}) {
  const stressOptions: { mode: StressMode; label: string; icon: typeof Flame; color: string }[] = [
    { mode: 'CRISIS', label: 'Crisis', icon: Flame, color: '#dc2626' },
    { mode: 'SIDEWAYS', label: 'Sideways', icon: Activity, color: '#666666' },
    { mode: 'BULL', label: 'Bull', icon: TrendingUp, color: '#16a34a' },
  ];

  const riskLabelTxt = risk <= 0.33 ? 'CONSERVADOR' : risk <= 0.66 ? 'MODERADO' : 'AGRESIVO';
  const riskLabelColor = risk <= 0.33 ? '#16a34a' : risk <= 0.66 ? '#ca8a04' : '#dc2626';

  // Decision score gauge (0-100% for display)
  const decisionScorePct = decision ? Math.round(decision.decision_score * 100) : 0;
  const scoreColor = decisionScorePct >= 67 ? '#dc2626' : decisionScorePct >= 34 ? '#ca8a04' : '#16a34a';

  return (
    <div className="bg-gradient-to-br from-[#f0f7ff] via-[#faf5ff] to-[#fef3f2] border-2 border-[#0066cc]/40 rounded-lg p-2.5 mb-3">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <Brain className="w-3.5 h-3.5 text-[#7c3aed]" />
        <span className="text-[12px] font-extrabold text-[#000000] uppercase tracking-wider">Motor de Decisión V3</span>
        <span className="text-[9px] text-[#666666] ml-1">·</span>
        <span className="text-[9px] font-bold" style={{ color: riskLabelColor }}>{riskLabelTxt}</span>
        {decision && (
          <span className="ml-auto text-[9px] text-[#666666] tabular-nums flex items-center gap-1">
            <Gauge className="w-2.5 h-2.5" />
            Score: <span className="font-bold" style={{ color: scoreColor }}>{decisionScorePct}/100</span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {/* ─── INPUT: Risk Slider (0-1) ─── */}
        <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
          <label className="text-[8px] uppercase font-bold tracking-wider text-[#999999] flex items-center gap-1">
            <Gauge className="w-2.5 h-2.5" /> INPUT · Nivel de Riesgo: <span className="text-[#0066cc] tabular-nums font-bold">{risk.toFixed(2)}</span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={risk}
            onChange={(e) => onRiskChange(parseFloat(e.target.value))}
            className="w-full h-1.5 mt-1 accent-[#0066cc] cursor-pointer"
          />
          <div className="flex justify-between text-[8px] text-[#999999] mt-0.5 font-bold">
            <span>Conservador (0)</span>
            <span>Moderado (0.5)</span>
            <span>Agresivo (1)</span>
          </div>
        </div>

        {/* ─── INPUT: Stress Mode (segmented control) ─── */}
        <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
          <label className="text-[8px] uppercase font-bold tracking-wider text-[#999999] flex items-center gap-1">
            <Flame className="w-2.5 h-2.5" /> INPUT · Modo de Stress
          </label>
          <div className="flex gap-1 mt-1">
            {stressOptions.map((opt) => {
              const Icon = opt.icon;
              const isActive = stressMode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  onClick={() => onStressChange(opt.mode)}
                  className={`flex-1 text-[10px] font-bold py-1 px-1 rounded flex items-center justify-center gap-0.5 transition-colors ${
                    isActive ? 'text-[#ffffff]' : 'bg-[#f3f4f6] text-[#666666] hover:bg-[#e5e7eb]'
                  }`}
                  style={isActive ? { backgroundColor: opt.color } : {}}
                >
                  <Icon className="w-2.5 h-2.5" />
                  {opt.label}
                </button>
              );
            })}
          </div>
          {decision && (
            <div className="text-[8px] text-[#999999] mt-1 tabular-nums">
              Shocks: Acc {formatPercent(decision.scenario_shocks.ACCIONES)} · CEDEAR {formatPercent(decision.scenario_shocks.CEDEARS)} · FCI {formatPercent(decision.scenario_shocks.FCI)}
            </div>
          )}
        </div>

        {/* ─── OUTPUT: Decision Score + Exposure gauge ─── */}
        <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
          <label className="text-[8px] uppercase font-bold tracking-wider text-[#999999] flex items-center gap-1">
            <Activity className="w-2.5 h-2.5" /> OUTPUT · Score de Decisión y Exposición
          </label>
          {decision ? (
            <div className="grid grid-cols-2 gap-1 mt-1">
              <div className="text-center">
                <div className="text-[8px] text-[#999999] font-bold">SCORE</div>
                {/* SCORE: término técnico financiero, se mantiene */}
                <div className="text-[15px] font-extrabold tabular-nums" style={{ color: scoreColor }}>{decisionScorePct}</div>
                <div className="h-1 bg-[#f3f4f6] rounded mt-0.5 overflow-hidden">
                  <div className="h-full" style={{ width: `${decisionScorePct}%`, backgroundColor: scoreColor }} />
                </div>
              </div>
              <div className="text-center">
                <div className="text-[8px] text-[#999999] font-bold">EXPOSICIÓN</div>
                <div className="text-[13px] font-bold tabular-nums text-[#000000]">{(decision.exposure * 100).toFixed(0)}%</div>
                <div className="text-[8px] text-[#999999] mt-0.5 tabular-nums">
                  ratio: <span style={{ color: decision.exposure_ratio >= 1 ? '#16a34a' : '#dc2626' }}>{(decision.exposure_ratio * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-[9px] text-[#999999] mt-2 text-center py-1">Esperando datos del oracle…</div>
          )}
        </div>
      </div>

      {/* ─── OUTPUT: Expected return + scenario projection + allocation vector ─── */}
      {decision && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mt-2">
          <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
            <div className="text-[8px] uppercase font-bold tracking-wider text-[#999999]">Retorno Esperado · 7d</div>
            <div className="text-[12px] font-bold tabular-nums" style={{ color: (decision.expected_return.ret_7d ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>
              {decision.expected_return.ret_7d != null ? formatPercent(decision.expected_return.ret_7d) : 'N/D'}
            </div>
          </div>
          <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
            <div className="text-[8px] uppercase font-bold tracking-wider text-[#999999]">Retorno Esperado · 30d</div>
            <div className="text-[12px] font-bold tabular-nums" style={{ color: (decision.expected_return.ret_30d ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>
              {decision.expected_return.ret_30d != null ? formatPercent(decision.expected_return.ret_30d) : 'N/D'}
            </div>
          </div>
          <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
            <div className="text-[8px] uppercase font-bold tracking-wider text-[#999999]">Retorno Esperado · 90d</div>
            <div className="text-[12px] font-bold tabular-nums" style={{ color: (decision.expected_return.ret_90d ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>
              {decision.expected_return.ret_90d != null ? formatPercent(decision.expected_return.ret_90d) : 'N/D'}
            </div>
          </div>
          <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
            <div className="text-[8px] uppercase font-bold tracking-wider text-[#999999]">Efectivo Sin Asignar</div>
            <div className="text-[12px] font-bold tabular-nums text-[#000000]">{formatUsd(decision.unallocated_cash)}</div>
          </div>
        </div>
      )}

      {/* ─── OUTPUT: Allocation vector summary (weights by class) ─── */}
      {decision && (
        <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5 mt-2">
          <div className="text-[8px] uppercase font-bold tracking-wider text-[#999999] mb-1">Vector de Asignación (Σ pesos = 1)</div>
          <div className="grid grid-cols-6 gap-1">
            {(Object.keys(decision.weights_by_class) as AssetClass[]).map((cls) => {
              const w = decision.weights_by_class[cls] ?? 0;
              const pct = (w * 100).toFixed(1);
              const isFloored = (cls === 'FCI' && w >= CONSTRAINTS.FCI_MIN) || (cls === 'PLAZO_FIJO' && w >= CONSTRAINTS.PF_MIN);
              return (
                <div key={cls} className="text-center">
                  <div className="text-[8px] text-[#666666] font-bold">{ASSET_CLASS_LABELS[cls].slice(0, 8)}</div>
                  <div className={`text-[11px] font-bold tabular-nums ${isFloored ? 'text-[#16a34a]' : 'text-[#000000]'}`}>{pct}%</div>
                  <div className="h-1 bg-[#f3f4f6] rounded mt-0.5 overflow-hidden">
                    <div className="h-full bg-[#0066cc]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[8px] text-[#666666] mt-1">
            Restricciones: FCI ≥ {CONSTRAINTS.FCI_MIN * 100}% · PF ≥ {CONSTRAINTS.PF_MIN * 100}% · activo único máx {CONSTRAINTS.MAX_SINGLE_ASSET * 100}%
          </div>
        </div>
      )}
    </div>
  );
}

// ─── V2: PortfolioSimulator (Holdings table + breakdown footer only — controls moved out) ─
// V2 spec: capital/risk/stress are now controlled by <GlobalOracleControlBar> at top-level.
// This component renders ONLY the allocations table + holdings total footer row.
// V4.1: now accepts disabledAssetIds + onToggleAsset for per-row enable/disable
// checkboxes (Fix 2). Disabled rows are grayed out and excluded from the V4
// portfolio computation graph (the filtering happens in MultiOraclePanel's
// allOracleAssets memo, which feeds computedPortfolio / decision / breakdown).
//
// V5 (GLM_FIX_UI_ENGINE_CONNECTIVITY_V5): now accepts `renderRows` — the
// UNFILTERED top-10 cross-class assets by oracle_score. The table iterates
// over renderRows (NOT portfolio.allocations) so disabled assets STAY VISIBLE
// in the table. For each row we look up its allocation in portfolio.allocations
// by asset id; if not present, the asset is disabled and we show muted cells.
// This fixes the bug where unchecking the ✓ made the row vanish entirely.

function PortfolioSimulator({
  portfolio,
  breakdown,
  disabledAssetIds,
  onToggleAsset,
  onEnableAll,
  onDisableAll,
  renderRows,
}: {
  portfolio: PortfolioResult | null;
  breakdown: PortfolioBreakdown | null;
  disabledAssetIds: Set<string>;
  onToggleAsset: (assetId: string) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  renderRows: AssetMetrics[]; // V5: UNFILTERED top-10 for persistent rendering
}) {
  if (!portfolio) return null;

  const disabledCount = disabledAssetIds.size;
  const activeCount = portfolio.allocations.length;

  // V5: build a lookup of allocation by asset id so we can join renderRows
  // (full top-10) with portfolio.allocations (filtered, only active assets).
  // Disabled assets won't have an allocation entry — we render their cells
  // muted with "—" placeholders, but the ROW stays in the table.
  const allocationById = new Map<string, Allocation>();
  for (const a of portfolio.allocations) {
    allocationById.set(a.asset.id, a);
  }
  // V5: rows to render = renderRows (top-10 unfiltered). Fall back to
  // portfolio.allocations if renderRows is empty (defensive — shouldn't happen
  // in practice because data.rankings.top10_by_oracle_score is always populated
  // when data is loaded).
  const rowsToRender: AssetMetrics[] = renderRows.length > 0
    ? renderRows
    : portfolio.allocations.map((a) => a.asset);

  return (
    <div className="bg-[#f8fafc] border border-[#0066cc]/30 rounded-lg p-2.5 mb-3">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <Gauge className="w-3 h-3 text-[#0066cc]" />
        <span className="text-[11px] font-bold text-[#000000]">Simulador de Portfolio V2</span>
        <span className="text-[9px] text-[#666666] ml-1">·</span>
        <span className="text-[9px] text-[#666666]">Etiqueta de riesgo: <strong style={{ color: portfolio.risk_label === 'conservative' ? '#16a34a' : portfolio.risk_label === 'balanced' ? '#ca8a04' : '#dc2626' }}>{riskLabelEsUpper(portfolio.risk_label)}</strong></span>

        {/* V4.1 Fix 2: bulk enable/disable controls */}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[9px] text-[#666666] tabular-nums">
            Activos: <strong className="text-[#16a34a]">{activeCount}</strong> · Desactivados: <strong className="text-[#dc2626]">{disabledCount}</strong>
          </span>
          <button
            onClick={onEnableAll}
            disabled={disabledCount === 0}
            className="text-[9px] font-bold text-[#16a34a] hover:bg-[#f0fdf4] px-1.5 py-0.5 rounded border border-[#16a34a]/30 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Activar todos los activos"
          >
            ✓ Activar todos
          </button>
          <button
            onClick={onDisableAll}
            disabled={activeCount === 0}
            className="text-[9px] font-bold text-[#dc2626] hover:bg-[#fef2f2] px-1.5 py-0.5 rounded border border-[#dc2626]/30 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Desactivar todos los activos"
          >
            ✗ Desactivar todos
          </button>
        </div>
      </div>

      {/* Allocation weights by class */}
      <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5 mb-2">
        <div className="text-[9px] uppercase font-bold tracking-wider text-[#999999] mb-1">Asignaciones por Clase</div>
        <div className="grid grid-cols-6 gap-1">
          {(Object.keys(portfolio.weights_by_class) as AssetClass[]).map((cls) => {
            const w = portfolio.weights_by_class[cls] ?? 0;
            const pct = (w * 100).toFixed(1);
            const isFloored = (cls === 'FCI' && w >= CONSTRAINTS.FCI_MIN) || (cls === 'PLAZO_FIJO' && w >= CONSTRAINTS.PF_MIN);
            return (
              <div key={cls} className="text-center">
                <div className="text-[8px] text-[#666666] font-bold">{ASSET_CLASS_LABELS[cls].slice(0, 8)}</div>
                <div className={`text-[11px] font-bold tabular-nums ${isFloored ? 'text-[#16a34a]' : 'text-[#000000]'}`}>{pct}%</div>
                <div className="h-1 bg-[#f3f4f6] rounded mt-0.5 overflow-hidden">
                  <div className="h-full bg-[#0066cc]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-[8px] text-[#666666] mt-1">
          Restricciones: FCI ≥ {CONSTRAINTS.FCI_MIN * 100}% · PF ≥ {CONSTRAINTS.PF_MIN * 100}% · activo único máx {CONSTRAINTS.MAX_SINGLE_ASSET * 100}%
        </div>
      </div>

      {/* Holdings table — V5: renders renderRows (UNFILTERED top-10) so disabled
          assets STAY VISIBLE. Each row looks up its allocation in
          portfolio.allocations by asset id; if not found, the asset is
          disabled and we render muted cells with "—" placeholders.
          The ✓ toggle is ALWAYS visible — click re-enables the asset.
          Footer / totals still use portfolio.allocations (filtered). */}
      {rowsToRender.length > 0 ? (
        <div className="bg-[#ffffff] border border-[#e5e7eb] rounded mb-2">
          <div className="px-2 py-1.5 border-b border-[#f0f0f0] flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Wallet className="w-3 h-3 text-[#0066cc]" />
              <span className="text-[11px] font-bold text-[#000000]">
                Holdings ({rowsToRender.length} filas · {activeCount} activas · {disabledCount} desactivadas)
              </span>
            </div>
            <span className="text-[9px] text-[#999999]">Top 10 cross-class · ✓/✖ para activar/desactivar · filas desactivadas permanecen visibles</span>
          </div>
          {/* V2: Scroll container — wraps ONLY the table body; total footer row is rendered BELOW this wrapper so it remains always visible */}
          <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#f8fafc] text-[#666666] text-[8px] uppercase tracking-wider">
                  <th className="text-left px-1 py-1 font-bold w-6">Act</th>
                  <th className="text-left px-1 py-1 font-bold w-5">#</th>
                  <th className="text-left px-2 py-1 font-bold">Activo</th>
                  <th className="text-left px-2 py-1 font-bold">Clase</th>
                  <th className="text-right px-2 py-1 font-bold">Peso</th>
                  <th className="text-right px-2 py-1 font-bold">Invertido</th>
                  <th className="text-right px-2 py-1 font-bold">Precio USD</th>
                  <th className="text-right px-2 py-1 font-bold">Shock</th>
                  <th className="text-right px-2 py-1 font-bold">Valor Stress</th>
                  <th className="text-right px-2 py-1 font-bold">P&L Stress</th>
                </tr>
              </thead>
              <tbody>
                {rowsToRender.map((asset, i) => {
                  const isDisabled = disabledAssetIds.has(asset.id);
                  const a = allocationById.get(asset.id) ?? null;
                  // V5: when asset is disabled, we still render the row with
                  // muted styling and "—" placeholders. The ✓ toggle remains
                  // clickable to re-enable the asset.
                  const pnl = a ? a.stressed_value_usd - a.invested_usd : 0;
                  const pnlPct = a && a.invested_usd > 0 ? pnl / a.invested_usd : 0;
                  const pnlColor = pnl > 0 ? '#16a34a' : pnl < 0 ? '#dc2626' : '#666666';
                  return (
                    <tr
                      key={asset.id}
                      data-testid={`holding-row-${asset.id}`}
                      data-disabled={isDisabled ? 'true' : 'false'}
                      className={`border-b border-[#f5f5f5] transition-colors ${
                        isDisabled
                          ? 'bg-[#f5f5f5] opacity-60 hover:opacity-90'
                          : 'hover:bg-[#f8fafc]'
                      }`}
                    >
                      {/* V4.1 Fix 2 + V5: toggle checkbox (clickable square).
                          ALWAYS visible — disabled rows show × (red border),
                          enabled rows show ✓ (green filled). Click toggles. */}
                      <td className="px-1 py-1 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleAsset(asset.id);
                          }}
                          data-testid={`asset-toggle-${asset.id}`}
                          data-asset-id={asset.id}
                          data-enabled={isDisabled ? 'false' : 'true'}
                          aria-label={isDisabled ? 'Activar activo' : 'Desactivar activo'}
                          className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all hover:scale-110"
                          style={{
                            background: isDisabled ? '#ffffff' : '#16a34a',
                            borderColor: isDisabled ? '#dc2626' : '#16a34a',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          {isDisabled ? (
                            <span className="text-[11px] font-bold text-[#dc2626] leading-none">×</span>
                          ) : (
                            <span className="text-[11px] font-bold text-[#ffffff] leading-none">✓</span>
                          )}
                        </button>
                      </td>
                      <td className="px-1 py-1 text-[#999999] tabular-nums">{i + 1}</td>
                      <td className="px-2 py-1 font-bold text-[#000000] truncate max-w-[140px]" title={asset.name}>
                        {asset.ticker ?? asset.name.slice(0, 20)}
                      </td>
                      <td className="px-2 py-1 text-[#666666]">{ASSET_CLASS_LABELS[asset.asset_class].slice(0, 10)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-[#666666]">
                        {a ? `${(a.weight * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-bold text-[#666666]">
                        {a ? formatUsd(a.invested_usd) : '—'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-[#666666]">
                        {a ? formatUsd(a.current_price_usd) : '—'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums" style={{ color: a ? pnlColor : '#999999' }}>
                        {a ? formatPercent(a.shock) : '—'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-bold text-[#666666]">
                        {a ? formatUsd(a.stressed_value_usd) : '—'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-bold" style={{ color: a ? pnlColor : '#999999' }}>
                        {a ? formatPercent(pnlPct) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* V2: HoldingsTotalFooterRowV2 — OUTSIDE the scroll container so it remains visible at all times */}
          <HoldingsTotalFooterRowV2 portfolio={portfolio} breakdown={breakdown} />
        </div>
      ) : (
        <div className="bg-[#fef2f2] border border-[#dc2626]/30 rounded p-2 mb-2 text-[11px] text-[#dc2626]">
          Sin activos con precio válido para armar portfolio. Verifique que el oracle devolvió datos.
        </div>
      )}
    </div>
  );
}

// ─── V2: HoldingsTotalFooterRowV2 ──────────────────────────────────────────
// V2 spec: rendered OUTSIDE the scroll container so it remains always visible.
// Shows 4 fields (total_invested, total_market_value, profit_absolute, profit_percentage)
// broken down by conservative/moderate/aggressive risk modes side-by-side.

function HoldingsTotalFooterRowV2({
  portfolio,
  breakdown,
}: {
  portfolio: PortfolioResult;
  breakdown: PortfolioBreakdown | null;
}) {
  // Selected-row highlight (which of the 3 risk modes is currently active)
  const selected = breakdown?.selected_risk_label ?? portfolio.risk_label;
  const isSelected = (label: 'conservative' | 'balanced' | 'aggressive') => {
    if (label === 'conservative') return selected === 'conservative';
    if (label === 'aggressive') return selected === 'aggressive';
    return selected === 'balanced'; // moderate maps to balanced
  };

  // Helper to render one breakdown row
  const renderRow = (
    label: 'CONSERVADOR' | 'MODERADO' | 'AGRESIVO',
    p: PortfolioResult,
    color: string,
    isActive: boolean,
  ) => {
    const profitAbs = p.stressed_profit_absolute_usd;
    const profitPct = p.stressed_profit_percent;
    const profitColor = profitAbs > 0 ? '#16a34a' : profitAbs < 0 ? '#dc2626' : '#666666';
    return (
      <tr
        className={`border-t border-[#e5e7eb] ${isActive ? 'bg-[#0066cc]/8' : 'bg-[#f8fafc]'}`}
        style={isActive ? { boxShadow: 'inset 3px 0 0 #0066cc' } : {}}
      >
        <td className="px-2 py-1.5 text-[10px] font-extrabold uppercase tracking-wider" style={{ color }}>
          {label}{isActive ? ' ●' : ''}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-[#000000] font-bold">
          {formatUsd(p.total_invested_usd)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-[#000000] font-bold">
          {formatUsd(p.total_stressed_value_usd)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-[11px] font-bold" style={{ color: profitColor }}>
          {formatUsd(profitAbs)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-[11px] font-bold" style={{ color: profitColor }}>
          {formatPercent(profitPct)}
        </td>
      </tr>
    );
  };

  return (
    <div className="border-t-2 border-[#0066cc]/40 bg-[#ffffff]">
      {/* Header */}
      <div className="px-2 py-1 bg-[#0066cc]/5 flex items-center gap-1.5">
        <Wallet className="w-3 h-3 text-[#0066cc]" />
        <span className="text-[10px] font-extrabold text-[#000000] uppercase tracking-wider">
          Footer Total de Holdings V2 — Desglose por Modo de Riesgo
        </span>
        <span className="ml-auto text-[9px] text-[#666666]">
          profit_absolute = Σ(value_i − cost_i) · profit_% = (mkt_value / invested − 1) × 100
        </span>
      </div>
      {/* Breakdown table — 3 rows (conservative / moderate / aggressive) */}
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-[#666666] text-[8px] uppercase tracking-wider border-b border-[#e5e7eb]">
            <th className="text-left px-2 py-1 font-bold w-1/5">Modo de Riesgo</th>
            <th className="text-right px-2 py-1 font-bold w-1/5">Total Invertido</th>
            <th className="text-right px-2 py-1 font-bold w-1/5">Valor Total de Mercado</th>
            <th className="text-right px-2 py-1 font-bold w-1/5">Ganancia Absoluta</th>
            <th className="text-right px-2 py-1 font-bold w-1/5">Ganancia %</th>
          </tr>
        </thead>
        <tbody>
          {breakdown ? (
            <>
              {renderRow('CONSERVADOR', breakdown.conservative, '#16a34a', isSelected('conservative'))}
              {renderRow('MODERADO',     breakdown.moderate,     '#ca8a04', isSelected('balanced'))}
              {renderRow('AGRESIVO',   breakdown.aggressive,   '#dc2626', isSelected('aggressive'))}
            </>
          ) : (
            <>
              {renderRow('CONSERVADOR', portfolio, '#16a34a', portfolio.risk_label === 'conservative')}
              {renderRow('MODERADO',     portfolio, '#ca8a04', portfolio.risk_label === 'balanced')}
              {renderRow('AGRESIVO',   portfolio, '#dc2626', portfolio.risk_label === 'aggressive')}
            </>
          )}
        </tbody>
      </table>
      {/* Footer note — current selected portfolio summary
          V9.2: Removed the duplicate "Valor actual (sin stress): $X" line.
          Per spec `1_single_source_of_truth.rule`:
            "solo un objeto puede emitir portfolio_value_usd"
          And per spec `4_duplicate_block_elimination.target_blocks`:
            "portfolio_snapshot" — duplicate derivation must be suppressed.
          The single source of truth for portfolio value is now METRICS_VIEW
          (StickyTopBar). This footer only shows the selected risk mode + P&L
          delta (which is a DIFFERENT concept: the relative change, not the
          absolute portfolio_value_usd). */}
      <div className="px-2 py-1 bg-[#f8fafc] text-[9px] text-[#666666] flex items-center justify-between border-t border-[#e5e7eb]">
        <span>
          <strong>Modo seleccionado:</strong> <span className="font-bold" style={{ color: selected === 'conservative' ? '#16a34a' : selected === 'balanced' ? '#ca8a04' : '#dc2626' }}>{riskLabelEsUpper(selected)}</span>
        </span>
        <span className="tabular-nums" data-testid="footer-pnl-delta">
          <span data-testid="pnl-live-label">P&L actual (paper)</span> <strong style={{ color: portfolio.profit_absolute_usd >= 0 ? '#16a34a' : '#dc2626' }}>{formatUsd(portfolio.profit_absolute_usd)} ({formatPercent(portfolio.profit_percent)})</strong>
        </span>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-1.5">
      <div className="text-[8px] text-[#999999] uppercase font-bold tracking-wider">{label}</div>
      <div className="text-[11px] font-bold text-[#000000] tabular-nums">{value}</div>
    </div>
  );
}

function MiniRankList({ title, icon: Icon, color, assets }: {
  title: string;
  icon: typeof TrendingUp;
  color: string;
  assets: AssetMetrics[];
}) {
  return (
    <div className="bg-[#ffffff] border border-[#e5e7eb] rounded p-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3" style={{ color }} />
        <span className="text-[10px] font-bold text-[#000000]">{title}</span>
      </div>
      {assets.length === 0 ? (
        <div className="text-[9px] text-[#999999] py-1">Sin datos</div>
      ) : (
        <div className="space-y-0.5">
          {assets.map((a, i) => {
            // V4.1 Fix 1: prefer prediction.expected_return_30d when available,
            // fall back to momentum_7d, then to oracle_score — so the widgets
            // always show a meaningful number even when rankings are empty.
            const value = a.prediction?.expected_return_30d ?? a.momentum_7d ?? null;
            const valueLabel = value == null
              ? `${a.oracle_score.toFixed(1)}★`
              : formatPct(value);
            return (
              <div key={a.id} className="flex items-center gap-1 text-[10px]">
                <span className="text-[#999999] w-3">#{i + 1}</span>
                <span className="font-bold truncate flex-1" title={a.name}>{a.name}</span>
                <span className="tabular-nums font-bold" style={{ color }}>
                  {valueLabel}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

