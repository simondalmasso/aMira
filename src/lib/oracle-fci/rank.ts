// src/lib/oracle-fci/rank.ts
// Oracle Score calculation + per-category ranking

import { FundMetrics, FundCategory, NormalizedFund } from './types';
import { predictFund } from './predict';
import { VcpSeries } from './storage';

// Oracle score weights (per spec)
const WEIGHTS = {
  patrimonio: 0.25,
  momentum_7d: 0.15,
  momentum_30d: 0.20,
  tir_estimada: 0.20,
  stability: 0.10,
  liquidity: 0.10,
} as const;

/** Min-max normalize an array of numbers to [0, 100] */
function normalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 50);
  return values.map((v) => ((v - min) / (max - min)) * 100);
}

/** Compute momentum for a fund given its VCP series */
function computeMomentum(
  series: VcpSeries | undefined,
  currentVcp: number,
  daysBack: number,
): number | null {
  if (!series || series.series.length < 2) return null;
  const sorted = [...series.series].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;
  // Look back `daysBack` entries
  const lookback = Math.min(daysBack, sorted.length - 1);
  const pastVcp = sorted[sorted.length - 1 - lookback].vcp;
  if (pastVcp <= 0) return null;
  return ((currentVcp - pastVcp) / pastVcp) * 100; // %
}

/** Stability = 1 - volatility_score (0..1) */
function computeStability(series: VcpSeries | undefined): number | null {
  if (!series || series.series.length < 5) return null;
  const sorted = [...series.series].sort((a, b) => a.date.localeCompare(b.date));
  const returns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].vcp > 0) {
      returns.push((sorted[i].vcp - sorted[i - 1].vcp) / sorted[i - 1].vcp);
    }
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  // Stability: 1 - normalized_std (typical FCI std 0.001-0.02)
  return Math.max(0, Math.min(1, 1 - std / 0.03));
}

/** Liquidity — log-normalized patrimonio */
function computeLiquidity(patrimonio: number, allPatrimonios: number[]): number | null {
  if (patrimonio <= 0) return 0;
  const max = Math.max(...allPatrimonios, 1);
  return Math.log10(patrimonio + 1) / Math.log10(max + 1);
}

/**
 * Compute oracle_score + metrics for a list of funds.
 * Returns sorted (by oracle_score desc) array of FundMetrics.
 */
export function rankFunds(
  funds: NormalizedFund[],
  vcpSeries: Map<string, VcpSeries>,
): FundMetrics[] {
  if (funds.length === 0) return [];

  const patrimonios = funds.map((f) => f.patrimonio);

  // Step 1: compute raw metrics per fund
  const rawMetrics = funds.map((f) => {
    const series = vcpSeries.get(f.name);
    const m7 = computeMomentum(series, f.vcp, 7);
    const m30 = computeMomentum(series, f.vcp, 30);
    const stability = computeStability(series);
    const liquidity = computeLiquidity(f.patrimonio, patrimonios);
    // tir_estimada = monthly projected return — use 30d momentum if available
    const tir = m30;
    const prediction = predictFund(series);
    return {
      fund: f,
      m7,
      m30,
      stability,
      liquidity,
      tir,
      prediction,
    };
  });

  // Step 2: min-max normalize each metric across the population
  // For m7, m30, tir: higher is better (positive momentum = good)
  // For stability, liquidity: higher is better
  const m7Norm = normalize(rawMetrics.map((m) => m.m7 ?? 0));
  const m30Norm = normalize(rawMetrics.map((m) => m.m30 ?? 0));
  const tirNorm = normalize(rawMetrics.map((m) => m.tir ?? 0));
  const stabNorm = normalize(rawMetrics.map((m) => m.stability ?? 0));
  const liqNorm = normalize(rawMetrics.map((m) => m.liquidity ?? 0));
  const patNorm = normalize(rawMetrics.map((m) => m.fund.patrimonio));

  // Step 3: weighted oracle_score
  const scored: FundMetrics[] = rawMetrics.map((m, i) => {
    const score =
      patNorm[i] * WEIGHTS.patrimonio +
      m7Norm[i] * WEIGHTS.momentum_7d +
      m30Norm[i] * WEIGHTS.momentum_30d +
      tirNorm[i] * WEIGHTS.tir_estimada +
      stabNorm[i] * WEIGHTS.stability +
      liqNorm[i] * WEIGHTS.liquidity;

    return {
      name: m.fund.name,
      category: m.fund.category,
      categoryLabel: m.fund.categoryLabel,
      horizonte: m.fund.horizonte,
      currency: m.fund.currency,
      manager: m.fund.manager,
      date: m.fund.date,
      vcp: m.fund.vcp,
      ccp: m.fund.ccp,
      patrimonio: m.fund.patrimonio,
      tir_estimada: m.tir,
      momentum_7d: m.m7,
      momentum_30d: m.m30,
      stability: m.stability,
      liquidity: m.liquidity,
      oracle_score: Math.round(score * 10) / 10,
      rank_in_category: 0, // filled below
      prediction: m.prediction ?? undefined,
      source: 'ARGENTINADATOS_API',
      confidence: m.prediction ? m.prediction.confidence : 0.95, // raw data always 0.95
    };
  });

  // Step 4: rank within each category
  const byCategory = new Map<FundCategory, FundMetrics[]>();
  for (const f of scored) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category)!.push(f);
  }
  for (const [, list] of byCategory) {
    list.sort((a, b) => b.oracle_score - a.oracle_score);
    list.forEach((f, i) => {
      f.rank_in_category = i + 1;
    });
  }

  // Step 5: return all sorted by oracle_score desc
  return scored.sort((a, b) => b.oracle_score - a.oracle_score);
}
