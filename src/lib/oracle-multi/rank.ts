// src/lib/oracle-multi/rank.ts
// V4 Oracle Score — weighted composite across all asset classes.
// Weights (per spec): momentum 0.25, volume 0.15, liquidity 0.15, volatility 0.10
//                      trend_strength 0.15, relative_performance 0.10, analyst_factor 0.10
// All sub-metrics normalized to [0,1] within the same asset class before weighting.

import {
  type AssetMetrics,
  type NormalizedAsset,
  type PricePoint,
  ORACLE_SCORE_WEIGHTS,
} from './types';
import { predictAsset } from './predict';

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Log-scale normalize a non-negative numeric column → [0,1] */
function logNormalizeColumn(values: number[]): (number | null)[] {
  const valid = values.filter((v) => v != null && v > 0 && isFinite(v));
  if (valid.length === 0) return values.map(() => null);
  const logVals = valid.map((v) => Math.log10(v + 1));
  const minLog = Math.min(...logVals);
  const maxLog = Math.max(...logVals);
  const range = maxLog - minLog || 1;
  return values.map((v) => (v == null || v <= 0 || !isFinite(v) ? null : clamp01((Math.log10(v + 1) - minLog) / range)));
}

/** Min-max normalize → [0,1] */
function minMaxNormalizeColumn(values: (number | null)[]): (number | null)[] {
  const valid = values.filter((v): v is number => v != null && isFinite(v));
  if (valid.length === 0) return values.map(() => null);
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  return values.map((v) => (v == null || !isFinite(v) ? null : clamp01((v - min) / range)));
}

/** Maximum |momentum| fraction allowed before clamping. ±1.0 = ±100% over the
 * lookback window.
 *
 * P3_2026_07_09_GEMINI — Outlier cap (defensive data sanitization):
 *   Gemini audit of the live dashboard detected Toronto Trust Special
 *   Opportunities Clase B showing "+1509.7% momentum (30d)" — a clear data
 *   ingestion error (likely an un-normalized fund consolidation/split from
 *   ArgentinaDatos). Without a cap, this single outlier became the max of
 *   the min-max normalization column, compressing every other asset to
 *   near-zero momentum score and corrupting the global oracle_score ranking.
 *
 *   The cap is a DATA SANITIZATION filter, NOT a scoring weight change:
 *     - Direction is preserved (positive stays positive, negative stays negative)
 *     - Magnitude is bounded so one bad asset cannot dominate the column
 *     - Real outliers (e.g., a stock moving +60% in 30d) still rank high
 *     - Data errors (+1509%) get clamped to the cap, no longer corrupting
 *       the normalization range
 *
 *   This is analogous to FASE_0.5_HARDEN_NULL_PRICE: both filter corrupt
 *   inputs BEFORE they enter the scoring pipeline, without touching the
 *   weights or model architecture (FREEZE CRITICAL_ENGINEERING_ONLY
 *   respected).
 *
 * Threshold rationale: ±100% in 7d or 30d is extreme for Argentine FCIs
 * (rarely >±10% monthly), rare but possible for ACCIONES/CEDEARs during
 * major news events, and clearly indicative of data errors above this
 * threshold. Symmetric to handle both positive and negative outliers.
 */
const MAX_MOMENTUM_FRACTIONAL = 1.0;

/** Compute momentum (fractional) from price series at lookback days.
 *
 * FASE_0.5_HARDEN_NULL_PRICE (2026-07-03):
 *   Filter out points with invalid `price` (null/NaN/<=0) BEFORE any numeric op.
 *   Without this, `(last - past) / past` with `past=0` returns Infinity, and
 *   with `past=NaN` returns NaN — both of which silently propagate through
 *   normalization and corrupt the oracle_score.
 *
 * P3_2026_07_09_GEMINI:
 *   Cap |momentum| at MAX_MOMENTUM_FRACTIONAL (±100%) before returning.
 */
function momentumFromSeries(series: PricePoint[] | undefined, lookback: number): number | null {
  if (!series || series.length < 2) return null;
  // FASE_0_LOCALECOMPARE_NULL_GUARD + FASE_0.5_HARDEN_NULL_PRICE — null-safe filter on date AND price
  const sorted = [...series]
    .filter(
      (p) =>
        p &&
        typeof p.date === 'string' &&
        p.date.length > 0 &&
        typeof p.price === 'number' &&
        isFinite(p.price) &&
        p.price > 0,
    )
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  if (sorted.length < 2) return null; // after filter, may be too short
  const last = sorted[sorted.length - 1];
  const lookbackIdx = Math.max(0, sorted.length - 1 - lookback);
  const past = sorted[lookbackIdx];
  if (past.price <= 0) return null; // belt-and-suspenders (filter already guarantees > 0)
  const raw = (last.price - past.price) / past.price;
  // P3_2026_07_09_GEMINI: clamp outliers to ±MAX_MOMENTUM_FRACTIONAL.
  return Math.max(-MAX_MOMENTUM_FRACTIONAL, Math.min(MAX_MOMENTUM_FRACTIONAL, raw));
}

/** Volatility (stdev of daily returns) normalized to [0,1].
 *
 * FASE_0.5_HARDEN_NULL_PRICE (2026-07-03):
 *   Filter invalid-price points BEFORE computing returns. Without this, NaN
 *   inputs would yield NaN variance, NaN std, and a corrupted volatility score
 *   that propagates into the oracle_score weighting (W.volatility = 0.10).
 */
function volatilityFromSeries(series: PricePoint[] | undefined): number | null {
  if (!series || series.length < 3) return null;
  // FASE_0_LOCALECOMPARE_NULL_GUARD + FASE_0.5_HARDEN_NULL_PRICE — null-safe filter on date AND price
  const sorted = [...series]
    .filter(
      (p) =>
        p &&
        typeof p.date === 'string' &&
        p.date.length > 0 &&
        typeof p.price === 'number' &&
        isFinite(p.price) &&
        p.price > 0,
    )
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  if (sorted.length < 3) return null; // after filter, may be too short
  const returns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].price > 0) {
      returns.push((sorted[i].price - sorted[i - 1].price) / sorted[i - 1].price);
    }
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  return clamp01(std / 0.04); // 4% daily std = max
}

/** Trend strength = |R²| of linear regression over the series.
 *
 * FASE_0.5_HARDEN_NULL_PRICE (2026-07-03):
 *   Filter invalid-price points BEFORE regression. Without this, NaN y-values
 *   would yield NaN slope/intercept/r2, and `clamp01(NaN)` returns 0 — masking
 *   the data corruption as a legitimate "no trend" signal.
 */
function trendStrengthFromSeries(series: PricePoint[] | undefined): number | null {
  if (!series || series.length < 5) return null;
  // FASE_0_LOCALECOMPARE_NULL_GUARD + FASE_0.5_HARDEN_NULL_PRICE — null-safe filter on date AND price
  const sorted = [...series]
    .filter(
      (p) =>
        p &&
        typeof p.date === 'string' &&
        p.date.length > 0 &&
        typeof p.price === 'number' &&
        isFinite(p.price) &&
        p.price > 0,
    )
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  if (sorted.length < 5) return null; // after filter, may be too short
  const points = sorted.map((s, i) => ({ x: i, y: s.price }));
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return clamp01(Math.abs(r2));
}

// ─── Rank a group of assets (typically one asset class) ─────────────────────

export interface RankInput {
  assets: NormalizedAsset[];
  /** Price series per asset_id (from KV history) — optional */
  priceSeries?: Map<string, PricePoint[]>;
  /** Source confidence override (defaults to 0.85) */
  sourceConfidence?: number;
}

export interface RankResult {
  metrics: AssetMetrics[];
}

export function rankAssets(input: RankInput): RankResult {
  const { assets, priceSeries, sourceConfidence = 0.85 } = input;

  if (assets.length === 0) {
    return { metrics: [] };
  }

  // Pre-compute raw values per asset
  const raw = assets.map((a) => {
    const series = priceSeries?.get(a.id);
    return {
      asset: a,
      momentum7: momentumFromSeries(series, 7),
      momentum30: momentumFromSeries(series, 30),
      volatility: volatilityFromSeries(series),
      trendStrength: trendStrengthFromSeries(series),
      volume: a.volume ?? null,
      marketCap: a.market_cap_ars ?? null,
    };
  });

  // Normalize momentum (min-max)
  const m7Norm = minMaxNormalizeColumn(raw.map((r) => r.momentum7));
  const m30Norm = minMaxNormalizeColumn(raw.map((r) => r.momentum30));
  // Volatility: inverse — lower vol = higher score
  const volRaw = raw.map((r) => r.volatility);
  const volNorm = volRaw.map((v) => (v == null ? null : 1 - v));
  // Volume: log normalize (with fallback when all null → 0.5 neutral)
  const volLogNorm = logNormalizeColumn(raw.map((r) => r.volume ?? 0));
  // Liquidity: log normalize market_cap_ars (with fallback when all null → 0.5 neutral)
  const liqLogNorm = logNormalizeColumn(raw.map((r) => r.marketCap ?? 0));
  // Trend strength: already [0,1]
  const trendNorm = raw.map((r) => r.trendStrength);

  // Relative performance: momentum_30d normalized vs class mean (already done above)
  // We re-use m30Norm as relative_performance signal
  const relPerfNorm = m30Norm;

  // Class mean momentum_30d (for relative_performance interpretation)
  const m30Valid = raw.map((r) => r.momentum30).filter((v): v is number => v != null);
  const classMeanM30 = m30Valid.length > 0 ? m30Valid.reduce((a, b) => a + b, 0) / m30Valid.length : 0;

  // Build metric objects (oracle_score = 0 placeholder)
  const metrics: AssetMetrics[] = raw.map((r, i) => {
    const prediction = predictAsset(priceSeries?.get(r.asset.id));
    // analyst_factor — neutral 0.5 (no external analyst feed wired in V4)
    const analystFactor = 0.5;

    // FASE_0.5_HARDEN_NULL_PRICE: flag assets whose price series was too corrupted
    // to compute ANY of the 3 series-derived metrics. These assets are still
    // ranked (using 0.5 neutral fallbacks per existing algorithm — preserving
    // freeze), but the flag lets consumers filter them out or visually mark
    // them as low-confidence without changing the ranking algorithm itself.
    const dataQuality: 'sufficient' | 'insufficient' =
      r.momentum7 == null && r.momentum30 == null && r.volatility == null && r.trendStrength == null
        ? 'insufficient'
        : 'sufficient';

    return {
      id: r.asset.id,
      asset_class: r.asset.asset_class,
      name: r.asset.name,
      ticker: r.asset.ticker,
      sub_category: r.asset.sub_category,
      currency: r.asset.currency,
      issuer: r.asset.issuer,
      date: r.asset.date,
      source: r.asset.source,
      price: r.asset.price,
      volume: r.asset.volume,
      market_cap_ars: r.asset.market_cap_ars,
      momentum_7d: r.momentum7,
      momentum_30d: r.momentum30,
      volatility: r.volatility,
      volume_norm: volLogNorm[i],
      liquidity: liqLogNorm[i],
      trend_strength: trendNorm[i],
      relative_performance: relPerfNorm[i],
      analyst_factor: analystFactor,
      oracle_score: 0, // placeholder
      rank_in_class: 0,
      rank_global: 0,
      prediction: prediction ?? undefined,
      confidence: sourceConfidence,
      data_quality: dataQuality,
    };
  });

  // Compute oracle_score per asset using V4 weights.
  // All sub-metrics already normalized to [0,1]. Volatility is inverted (lower = better).
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    // Fallback: when an asset has null for a metric (e.g. FCI without volume), use 0.5 neutral
    const m7 = m7Norm[i] ?? 0.5;
    const m30 = m30Norm[i] ?? 0.5;
    const volScore = volNorm[i] ?? 0.5;
    const volLog = volLogNorm[i] ?? 0.5;
    const liqLog = liqLogNorm[i] ?? 0.5;
    const trend = trendNorm[i] ?? 0;
    const relPerf = relPerfNorm[i] ?? 0.5;
    const analyst = m.analyst_factor;

    // Momentum = blend of 7d (0.4) + 30d (0.6)
    const momentumCombined = 0.4 * m7 + 0.6 * m30;

    const W = ORACLE_SCORE_WEIGHTS;
    const score =
      (momentumCombined * W.momentum +
        volLog * W.volume +
        liqLog * W.liquidity +
        volScore * W.volatility +
        trend * W.trend_strength +
        relPerf * W.relative_performance +
        analyst * W.analyst_factor) * 100;

    m.oracle_score = Math.max(0, Math.min(100, score));
  }

  // Sort by oracle_score desc and assign rank_in_class
  const sorted = [...metrics].sort((a, b) => b.oracle_score - a.oracle_score);
  sorted.forEach((m, idx) => {
    m.rank_in_class = idx + 1;
  });

  return { metrics: sorted };
}

/** Assign rank_global across all classes (after merging). */
export function assignGlobalRanks(all: AssetMetrics[]): AssetMetrics[] {
  const sorted = [...all].sort((a, b) => b.oracle_score - a.oracle_score);
  sorted.forEach((m, idx) => {
    m.rank_global = idx + 1;
  });
  return sorted;
}
