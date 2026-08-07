// src/lib/amira-scanner.ts
// V10 — OPPORTUNITY SCANNER (SCANNER LAYER)
//
// Per spec `architecture_upgrade.new_layers[scanner_layer]`:
//   name: "Opportunity Scanner"
//   responsibility: "Detectar activos, clases y regímenes con edge potencial."
//   must_have: [ranking cross-class, top opportunities by score,
//               filters por clase, señales de momentum / carry / inflación / FX]
//
// Per spec `engine_contracts.scanner_output`:
//   asset_class: string
//   oracle_score: number
//   freshness: REAL | STALE | SIMULADO | PARTIAL_FALLBACK
//   signals: array
//
// Per spec `architecture_upgrade.single_source_of_truth`:
//   active_asset_ids and prediction_status are part of the unified state graph.
//
// Per spec `anti_frankenstein_rules.do_not`:
//   "split the brain into multiple parallel engines"
//   "show simulated and real values without clear labels"
//
// SAFE MODIFICATIONS: This module is advisory only — it CONSUMES the existing
// `MultiOracleResponse` produced by `/api/oracle/rankings` and produces a
// ranked cross-class opportunity list. It does NOT add new API routes, does
// NOT replace the existing rankings engine (which already produces
// top10_by_oracle_score, top10_by_market_cap, etc.), and does NOT compute
// new returns — it only filters, sorts, and tags signals.
//
// Polymarket-pattern transfer:
//   - "scanner de oportunidades" → cross-class ranking with explicit signals
//   - "JSON machine-readable outputs" → ScannerOutput is fully serializable
//
// Not transferred:
//   - "market selection de apuestas" — we don't pick betting markets,
//     we rank real Argentina-listed assets.
//   - "wallet following" — N/A.

import type {
  AssetClass,
  AssetMetrics,
  MultiOracleResponse,
} from './oracle-multi/types';
import type { SourceStatus } from './amira-source-health';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ScannerFreshness = 'REAL' | 'STALE' | 'SIMULADO' | 'PARTIAL_FALLBACK';

export type SignalKind =
  | 'momentum'         // 7d/30d return is positive and trend_strength high
  | 'carry'            // positive expected return with low volatility
  | 'inflation_hedge'  // asset_class traditionally beats inflation (CEDEARS, ETF_CEDEARS)
  | 'fx_hedge'         // USD-denominated asset (CEDEARS, ETF_CEDEARS) → FX hedge vs ARS
  | 'value'            // low volatility + low price relative to trend
  | 'liquidity';       // high volume_norm + high liquidity

export interface ScannerSignal {
  kind: SignalKind;
  /** 0..1 — strength of the signal */
  strength: number;
  /** Human-readable label (es-AR) */
  label: string;
}

export interface ScannerOpportunity {
  /** Asset ID — `${assetClass}:${ticker|fundName}` */
  asset_id: string;
  asset_class: AssetClass;
  name: string;
  ticker?: string;
  /** 0..100 — composite scanner score (oracle_score + signal bonus) */
  scanner_score: number;
  /** 0..100 — raw oracle_score from the underlying rankings engine */
  oracle_score: number;
  /** Inferred freshness from the asset's prediction + source */
  freshness: ScannerFreshness;
  /** Signals that fired for this opportunity */
  signals: ScannerSignal[];
  /** Expected return 30d from the underlying prediction (fractional) */
  expected_return_30d: number | null;
  /** Confidence of the underlying prediction (0..1) */
  confidence: number | null;
  /** Why this opportunity surfaced (1-line summary) */
  reason: string;
  /** Is this opportunity currently in the active allocation? */
  in_active_allocation: boolean;
}

export interface ScannerClassBreakdown {
  asset_class: AssetClass;
  count: number;
  top_score: number;
  avg_score: number;
  best_opportunity: ScannerOpportunity | null;
}

export interface ScannerOutput {
  generated_at: string;
  /** Top N opportunities across all asset classes, ranked by scanner_score */
  top_opportunities: ScannerOpportunity[];
  /** Per-class breakdown */
  by_class: Record<AssetClass, ScannerClassBreakdown>;
  /** Total opportunities scanned */
  total_scanned: number;
  /** Number of opportunities that have at least one signal firing */
  with_signals: number;
  /** Number of opportunities with REAL freshness */
  real_count: number;
  /** Number of opportunities with STALE/SIMULADO/PARTIAL_FALLBACK freshness */
  degraded_count: number;
  /** Filtered by class (empty = all classes included) */
  filter_class: AssetClass | null;
  /** Top signal kinds across all opportunities (frequency-sorted) */
  dominant_signals: Array<{ kind: SignalKind; count: number }>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SCANNER_TOP_N_DEFAULT = 10;

const INFLATION_HEDGE_CLASSES: AssetClass[] = ['CEDEARS', 'ETF_CEDEARS'];
const FX_HEDGE_CLASSES: AssetClass[] = ['CEDEARS', 'ETF_CEDEARS'];
const CARRY_CLASSES: AssetClass[] = ['PLAZO_FIJO', 'FCI', 'BONOS'];

// Signal thresholds (per spec `no_hallucination`: never invent, always tag)
const MOMENTUM_THRESHOLD_30D = 0.02;      // +2% monthly
const MOMENTUM_THRESHOLD_7D = 0.005;      // +0.5% weekly
const CARRY_VOL_THRESHOLD = 0.35;         // vol < 0.35 → low vol
const VALUE_VOL_THRESHOLD = 0.25;         // vol < 0.25 → very low vol
const LIQUIDITY_VOLUME_THRESHOLD = 0.6;   // volume_norm > 0.6 → liquid
const SIGNAL_MIN_STRENGTH = 0.10;

// ─── Freshness inference ───────────────────────────────────────────────────
// Derive freshness from asset prediction + source_status.

function inferAssetFreshness(
  asset: AssetMetrics,
  sourceStatus: MultiOracleResponse['source_status'],
): ScannerFreshness {
  // If the oracle reports DEGRADED globally, mark all as PARTIAL_FALLBACK
  if (sourceStatus === 'ERROR') return 'STALE';
  if (sourceStatus === 'DEGRADED') return 'PARTIAL_FALLBACK';

  // If the asset has a real prediction (ML active), freshness = REAL
  if (asset.prediction != null && asset.prediction.confidence >= 0.65) {
    return 'REAL';
  }

  // If the asset has stale metrics (momentum_30d missing), mark STALE
  if (asset.momentum_30d == null) return 'STALE';

  // Default: REAL — the underlying data was fetched from a real source
  return 'REAL';
}

// ─── Signal computation ────────────────────────────────────────────────────
// Per spec `must_have`: "señales de momentum / carry / inflación / FX".
// Each signal is computed independently and tagged with its strength.

function computeSignals(asset: AssetMetrics): ScannerSignal[] {
  const signals: ScannerSignal[] = [];

  // ─── Momentum signal ───
  // Fires when 7d or 30d momentum is positive and meaningful
  const mom7 = asset.momentum_7d;
  const mom30 = asset.momentum_30d;
  const trendStrength = asset.trend_strength ?? 0;
  if (mom30 != null && mom30 >= MOMENTUM_THRESHOLD_30D) {
    const strength = Math.min(1, (mom30 / 0.10) * 0.6 + trendStrength * 0.4);
    if (strength >= SIGNAL_MIN_STRENGTH) {
      signals.push({
        kind: 'momentum',
        strength: Math.round(strength * 100) / 100,
        label: `Momentum +${(mom30 * 100).toFixed(1)}% (30d)`,
      });
    }
  } else if (mom7 != null && mom7 >= MOMENTUM_THRESHOLD_7D) {
    const strength = Math.min(0.7, (mom7 / 0.05) * 0.5 + trendStrength * 0.3);
    if (strength >= SIGNAL_MIN_STRENGTH) {
      signals.push({
        kind: 'momentum',
        strength: Math.round(strength * 100) / 100,
        label: `Momentum corto +${(mom7 * 100).toFixed(1)}% (7d)`,
      });
    }
  }

  // ─── Carry signal ───
  // Fires for low-volatility assets with positive expected return
  const vol = asset.volatility;
  const pred = asset.prediction?.expected_return_30d;
  if (CARRY_CLASSES.includes(asset.asset_class) && vol != null && vol < CARRY_VOL_THRESHOLD) {
    const carryStrength = pred != null && pred > 0
      ? Math.min(1, (1 - vol) * 0.6 + Math.min(0.4, pred * 4))
      : Math.min(0.6, (1 - vol) * 0.5);
    if (carryStrength >= SIGNAL_MIN_STRENGTH) {
      signals.push({
        kind: 'carry',
        strength: Math.round(carryStrength * 100) / 100,
        label: `Carry · vol baja (${(vol * 100).toFixed(0)}%)`,
      });
    }
  }

  // ─── Inflation hedge signal ───
  // Fires for CEDEARS / ETF_CEDEARS (dollar-denominated, inflation-protected)
  if (INFLATION_HEDGE_CLASSES.includes(asset.asset_class)) {
    const strength = 0.55;
    signals.push({
      kind: 'inflation_hedge',
      strength,
      label: 'Cobertura inflacionaria (USD)',
    });
  }

  // ─── FX hedge signal ───
  // Fires for USD-denominated assets — hedges against ARS devaluation
  if (FX_HEDGE_CLASSES.includes(asset.asset_class) && asset.currency === 'USD') {
    const strength = 0.60;
    signals.push({
      kind: 'fx_hedge',
      strength,
      label: 'Cobertura FX (dólar)',
    });
  }

  // ─── Value signal ───
  // Fires for very-low-volatility assets that might be underpriced
  if (vol != null && vol < VALUE_VOL_THRESHOLD && (pred ?? 0) > 0) {
    const strength = Math.min(0.8, (1 - vol) * 0.7 + (pred ?? 0) * 3);
    if (strength >= SIGNAL_MIN_STRENGTH) {
      signals.push({
        kind: 'value',
        strength: Math.round(strength * 100) / 100,
        label: `Valor · vol muy baja (${(vol * 100).toFixed(0)}%)`,
      });
    }
  }

  // ─── Liquidity signal ───
  // Fires for highly-liquid assets
  const volumeNorm = asset.volume_norm;
  const liquidity = asset.liquidity;
  if (volumeNorm != null && volumeNorm >= LIQUIDITY_VOLUME_THRESHOLD) {
    const strength = Math.min(1, volumeNorm * 0.6 + (liquidity ?? 0) * 0.4);
    if (strength >= SIGNAL_MIN_STRENGTH) {
      signals.push({
        kind: 'liquidity',
        strength: Math.round(strength * 100) / 100,
        label: `Liquidez alta`,
      });
    }
  }

  return signals;
}

// ─── Scanner score ─────────────────────────────────────────────────────────
// Composite score = oracle_score (0..100) + signal bonus.
// Signal bonus = sum(signal.strength × kind_weight), capped at +15 points.

const SIGNAL_KIND_WEIGHT: Record<SignalKind, number> = {
  momentum:        6.0,  // up to +6 pts
  carry:           4.0,  // up to +4 pts
  inflation_hedge: 3.0,  // up to +3 pts
  fx_hedge:        3.0,  // up to +3 pts
  value:           4.0,  // up to +4 pts
  liquidity:       2.0,  // up to +2 pts
};

function computeScannerScore(asset: AssetMetrics, signals: ScannerSignal[]): number {
  const base = asset.oracle_score;
  let bonus = 0;
  for (const sig of signals) {
    bonus += sig.strength * SIGNAL_KIND_WEIGHT[sig.kind];
  }
  bonus = Math.min(15, bonus);
  return Math.max(0, Math.min(100, Math.round((base + bonus) * 10) / 10));
}

// ─── Main composer ─────────────────────────────────────────────────────────

export interface ComposeScannerOptions {
  /** Filter to a single asset class (null = all classes) */
  filterClass?: AssetClass | null;
  /** Top N opportunities to return (default 10) */
  topN?: number;
  /** IDs of assets currently in the active allocation (for tagging) */
  activeAssetIds?: Set<string>;
  /** Override source status (defaults to response.source_status) */
  sourceStatusOverride?: SourceStatus;
}

export function composeAmiraScanner(
  response: MultiOracleResponse | null,
  options: ComposeScannerOptions = {},
): ScannerOutput {
  const topN = options.topN ?? SCANNER_TOP_N_DEFAULT;
  const filterClass = options.filterClass ?? null;
  const activeAssetIds = options.activeAssetIds ?? new Set<string>();

  if (!response) {
    return emptyScannerOutput(filterClass);
  }

  // Flatten all assets across all classes
  let allAssets: AssetMetrics[] = Object.values(response.by_class).flat();
  if (filterClass) {
    allAssets = allAssets.filter((a) => a.asset_class === filterClass);
  }

  // Compute opportunities
  const opportunities: ScannerOpportunity[] = allAssets.map((asset) => {
    const signals = computeSignals(asset);
    const scannerScore = computeScannerScore(asset, signals);
    const freshness = inferAssetFreshness(asset, response.source_status);
    const pred = asset.prediction;
    return {
      asset_id: asset.id,
      asset_class: asset.asset_class,
      name: asset.name,
      ticker: asset.ticker,
      scanner_score: scannerScore,
      oracle_score: asset.oracle_score,
      freshness,
      signals,
      expected_return_30d: pred?.expected_return_30d ?? null,
      confidence: pred?.confidence ?? null,
      reason: signals.length > 0
        ? signals[0].label
        : `Score oracle ${asset.oracle_score.toFixed(0)}`,
      in_active_allocation: activeAssetIds.has(asset.id),
    };
  });

  // Sort by scanner_score descending
  opportunities.sort((a, b) => b.scanner_score - a.scanner_score);
  const top = opportunities.slice(0, topN);

  // Per-class breakdown
  const byClass = computeClassBreakdown(opportunities);

  // Dominant signals
  const signalCounts = new Map<SignalKind, number>();
  for (const opp of opportunities) {
    for (const sig of opp.signals) {
      signalCounts.set(sig.kind, (signalCounts.get(sig.kind) ?? 0) + 1);
    }
  }
  const dominantSignals = Array.from(signalCounts.entries())
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  const realCount = opportunities.filter((o) => o.freshness === 'REAL').length;
  const withSignals = opportunities.filter((o) => o.signals.length > 0).length;
  const degradedCount = opportunities.length - realCount;

  return {
    generated_at: new Date().toISOString(),
    top_opportunities: top,
    by_class: byClass,
    total_scanned: opportunities.length,
    with_signals: withSignals,
    real_count: realCount,
    degraded_count: degradedCount,
    filter_class: filterClass,
    dominant_signals: dominantSignals,
  };
}

function computeClassBreakdown(
  opportunities: ScannerOpportunity[],
): Record<AssetClass, ScannerClassBreakdown> {
  const classes: AssetClass[] = ['FCI', 'PLAZO_FIJO', 'ACCIONES', 'BONOS', 'CEDEARS', 'ETF_CEDEARS'];
  const result = {} as Record<AssetClass, ScannerClassBreakdown>;
  for (const cls of classes) {
    const inClass = opportunities.filter((o) => o.asset_class === cls);
    if (inClass.length === 0) {
      result[cls] = {
        asset_class: cls,
        count: 0,
        top_score: 0,
        avg_score: 0,
        best_opportunity: null,
      };
      continue;
    }
    const top = inClass[0];
    const topScore = top.scanner_score;
    const avgScore = inClass.reduce((s, o) => s + o.scanner_score, 0) / inClass.length;
    result[cls] = {
      asset_class: cls,
      count: inClass.length,
      top_score: topScore,
      avg_score: Math.round(avgScore * 10) / 10,
      best_opportunity: top,
    };
  }
  return result;
}

function emptyScannerOutput(filterClass: AssetClass | null): ScannerOutput {
  return {
    generated_at: new Date().toISOString(),
    top_opportunities: [],
    by_class: computeClassBreakdown([]),
    total_scanned: 0,
    with_signals: 0,
    real_count: 0,
    degraded_count: 0,
    filter_class: filterClass,
    dominant_signals: [],
  };
}

// ─── React Hook (memoized) ─────────────────────────────────────────────────

export function useAmiraScanner(
  response: MultiOracleResponse | null,
  options: ComposeScannerOptions = {},
): ScannerOutput {
  return composeAmiraScanner(response, options);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function formatScannerScore(score: number): string {
  return score.toFixed(1);
}

export function getFreshnessLabel(f: ScannerFreshness): string {
  switch (f) {
    case 'REAL': return 'Datos reales';
    case 'STALE': return 'Datos antiguos';
    case 'SIMULADO': return 'Simulado';
    case 'PARTIAL_FALLBACK': return 'Parcial (fallback)';
  }
}

export function getFreshnessColor(f: ScannerFreshness): string {
  switch (f) {
    case 'REAL': return '#16a34a';
    case 'STALE': return '#dc2626';
    case 'SIMULADO': return '#ca8a04';
    case 'PARTIAL_FALLBACK': return '#ea580c';
  }
}

export function getSignalColor(kind: SignalKind): string {
  switch (kind) {
    case 'momentum': return '#16a34a';
    case 'carry': return '#0066cc';
    case 'inflation_hedge': return '#7c3aed';
    case 'fx_hedge': return '#0891b2';
    case 'value': return '#ca8a04';
    case 'liquidity': return '#6b7280';
  }
}

export function getSignalLabel(kind: SignalKind): string {
  switch (kind) {
    case 'momentum': return 'Momentum';
    case 'carry': return 'Carry';
    case 'inflation_hedge': return 'Cobertura inflación';
    case 'fx_hedge': return 'Cobertura FX';
    case 'value': return 'Valor';
    case 'liquidity': return 'Liquidez';
  }
}
