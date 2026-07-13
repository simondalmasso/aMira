// src/lib/oracle/v2/confidence-engine.ts
// ============================================================================
// R1 — PREDICTION CONFIDENCE LAYER (append-only, backward compatible)
// ============================================================================
// MISSION (per ORACLE_V2_SYSTEMIC_ROBUSTNESS spec, R1):
//   "Cada predicción debe devolver confidence_score 0-100 además del score."
//
// COMPONENTS:
//   - confidence_score          : 0..100 (composite)
//   - prediction_dispersion     : 0..100 (higher = MORE dispersion → LESS conf)
//   - feature_agreement         : 0..100 (higher = MORE agreement → MORE conf)
//   - data_quality              : 0..100 (higher = better sources)
//   - freshness_factor          : 0..100 (higher = fresher data)
//   - uncertainty_band          : { p5, p50, p95, width } (fractional returns)
//
// DESIGN PRINCIPLES (per ABSOLUTE_RULES):
//   - Append-only: this module ADDS a ConfidenceLayer to existing predictions.
//     The legacy AssetPrediction.confidence (0..1) is NOT modified.
//   - Pure function: no side effects, no global state, deterministic.
//   - Self-explaining: every sub-metric has a documented formula and a
//     contributor breakdown so the UI can render WHY the confidence is X.
//   - Single source of truth: consumes MarketState + AssetScore from the
//     canonical single-pass-oracle-engine. Does NOT re-compute the score.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT introduce a parallel prediction model.
//   - Does NOT mutate any existing type or contract.
//   - Reads from the SINGLE canonical AssetScore (one engine, one score).
// ============================================================================

import type { MarketState, NormalizedFeatures } from '@/lib/single-market-state';
import type { AssetScore, AssetPrediction } from '@/lib/single-pass-oracle-engine';
import type { RegimeClassification } from '@/lib/linear-factor-model';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface UncertaintyBand {
  /** 5th percentile of 30d expected return distribution (fractional, e.g. -0.08) */
  p5: number;
  /** Median (= AssetPrediction.expected_return) */
  p50: number;
  /** 95th percentile (fractional, e.g. +0.12) */
  p95: number;
  /** p95 - p5 (width of 90% confidence interval, fractional) */
  width: number;
  /** Method used to derive the band */
  method: 'gaussian_vaR_derived' | 'monte_carlo' | 'analytical';
}

export interface ConfidenceContributor {
  /** Sub-metric name (e.g. "data_quality") */
  source: string;
  /** Weight in the composite (0..1, all weights sum to 1) */
  weight: number;
  /** Raw sub-score 0..100 */
  value: number;
  /** Weighted contribution to final confidence_score (= weight * value) */
  contribution: number;
  /** Human-readable explanation */
  explanation: string;
}

export interface ConfidenceLayer {
  /** Composite confidence score 0..100 (higher = more confident) */
  confidence_score: number;
  /** 0..100 — higher = MORE dispersion in predictions → LESS confidence */
  prediction_dispersion: number;
  /** 0..100 — higher = MORE directional agreement among features → MORE conf */
  feature_agreement: number;
  /** 0..100 — higher = better data sources */
  data_quality: number;
  /** 0..100 — higher = fresher data */
  freshness_factor: number;
  /** 90% uncertainty band around expected_return */
  uncertainty_band: UncertaintyBand;
  /** Breakdown of how confidence_score was computed */
  contributors: ConfidenceContributor[];
  /** ISO-8601 timestamp */
  computed_at: string;
  /** Engine version that produced this layer */
  layer_version: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

export const CONFIDENCE_LAYER_VERSION = 'confidence_layer_v2_r1';

/** Composite weights (must sum to 1.0) */
const COMPOSITE_WEIGHTS = {
  dispersion: 0.25,    // inverted: less dispersion → more confidence
  agreement: 0.20,
  data_quality: 0.25,
  freshness: 0.15,
  band_tightness: 0.15, // inverted: tighter band → more confidence
} as const;

/** Freshness thresholds (seconds) */
const FRESH_FRESH_SEC = 60;        // ≤1 min → 100
const ACCEPTABLE_FRESH_SEC = 900;  // ≤15 min → linear down to 70
const STALE_FRESH_SEC = 3600;      // ≤1 h → linear down to 40
const VERY_STALE_FRESH_SEC = 86400;// ≤1 day → linear down to 0

// ─── Helpers ───────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((s, v) => s + (v - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

// ─── Sub-metric 1: Prediction Dispersion ───────────────────────────────────
//
// Measures MODEL UNCERTAINTY (not data uncertainty). A deterministic engine
// has no stochastic output, so we use analytical proxies for dispersion:
//
//   dispersion = w1 * (1 - regime_confidence) * 100
//              + w2 * (1 - score_extremity) * 100
//              + w3 * vaR_magnitude_score
//
// Where:
//   regime_confidence : 0..1 from RegimeClassification
//   score_extremity   : |score - 50| / 50 (1 = extreme, 0 = boundary)
//   vaR_magnitude     : |risk_var_95| / 0.20, capped at 1 (20% VaR = max)
//
// Interpretation:
//   - High dispersion → regime unclear, score near 50, or high VaR
//   - Low dispersion  → regime clear, score extreme, low VaR

function computePredictionDispersion(
  regime: RegimeClassification,
  score: number,
  prediction: AssetPrediction,
): { value: number; explanation: string } {
  const regimeUncertainty = (1 - regime.confidence) * 100;
  const scoreExtremity = Math.abs(score - 50) / 50; // 0..1
  const boundaryUncertainty = (1 - scoreExtremity) * 100;
  const vaRMagnitude = clamp(Math.abs(prediction.risk_var_95) / 0.20 * 100, 0, 100);

  const value = clamp(
    regimeUncertainty * 0.40 +
    boundaryUncertainty * 0.30 +
    vaRMagnitude * 0.30
  );

  return {
    value: Math.round(value * 10) / 10,
    explanation: `regime_uncertainty=${(regimeUncertainty).toFixed(1)} (conf=${regime.confidence.toFixed(2)}) · boundary_uncertainty=${boundaryUncertainty.toFixed(1)} (score=${score.toFixed(1)}) · var_magnitude=${vaRMagnitude.toFixed(1)} (|VaR|=${(Math.abs(prediction.risk_var_95) * 100).toFixed(2)}%)`,
  };
}

// ─── Sub-metric 2: Feature Agreement ───────────────────────────────────────
//
// Measures DIRECTIONAL AGREEMENT among the 5 normalized features.
// If most features point the same direction (all bullish or all bearish),
// the model has a clearer signal → higher confidence.
//
//   For each feature pair (i, j), agreement = 1 if sign(i) === sign(j) else 0
//   feature_agreement = (sum_of_agreements / total_pairs) * 100
//
// Special case: features with magnitude < 0.05 are treated as NEUTRAL and
// do not count against agreement (they don't disagree, they just don't care).

function computeFeatureAgreement(
  features: NormalizedFeatures,
): { value: number; explanation: string } {
  const entries: Array<[string, number]> = [
    ['carry', features.carry],
    ['inflation_hedge', features.inflation_hedge],
    ['fx_momentum', features.fx_momentum],
    ['liquidity', features.liquidity],
    ['risk_penalty', features.risk_penalty],
  ];

  // Filter near-zero (neutral) features
  const active = entries.filter(([, v]) => Math.abs(v) >= 0.05);
  if (active.length < 2) {
    return {
      value: 50,
      explanation: `only ${active.length} active features (others neutral) — defaulting to 50`,
    };
  }

  let agreements = 0;
  let pairs = 0;
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      pairs++;
      const si = Math.sign(active[i][1]);
      const sj = Math.sign(active[j][1]);
      // risk_penalty is negative-weighted: its "bullish" direction is when it's NEGATIVE
      const dirI = active[i][0] === 'risk_penalty' ? -si : si;
      const dirJ = active[j][0] === 'risk_penalty' ? -sj : sj;
      if (dirI === dirJ) agreements++;
    }
  }

  const value = clamp((agreements / pairs) * 100);
  return {
    value: Math.round(value * 10) / 10,
    explanation: `${agreements}/${pairs} active pairs agree directionally (${active.map(([k, v]) => `${k}=${v.toFixed(2)}`).join(', ')})`,
  };
}

// ─── Sub-metric 3: Data Quality ────────────────────────────────────────────
//
// Maps MarketState.quality label to a numeric score, adjusted by # of sources.
//
//   REAL              → 90 (live data from BCRA/Bluelytics/INDEC)
//   PARTIAL_FALLBACK  → 60 (some sources missing, using proxies)
//   STALE             → 30 (data >24h old)
//   ERROR             → 10 (fetch failed, using hardcoded fallbacks)
//
// Bonus: +2 per source beyond 2 (capped at +10). This rewards redundancy.

function computeDataQuality(state: MarketState): { value: number; explanation: string } {
  const baseMap: Record<MarketState['quality'], number> = {
    REAL: 90,
    PARTIAL_FALLBACK: 60,
    STALE: 30,
    ERROR: 10,
  };
  const base = baseMap[state.quality];
  const sourceBonus = clamp((state.sources.length - 2) * 2, 0, 10);
  const value = clamp(base + sourceBonus);
  return {
    value: Math.round(value * 10) / 10,
    explanation: `quality=${state.quality} (base=${base}) · ${state.sources.length} sources (bonus=+${sourceBonus})`,
  };
}

// ─── Sub-metric 4: Freshness Factor ────────────────────────────────────────
//
// Maps the AVERAGE freshness_sec across all MarketState fields to 0..100.
// Uses a piecewise linear curve:
//   ≤60s        → 100
//   ≤15min      → linear 100 → 70
//   ≤1h         → linear 70 → 40
//   ≤1day       → linear 40 → 0
//   >1day       → 0

function computeFreshnessFactor(state: MarketState): { value: number; explanation: string } {
  const fields = Object.values(state.freshness_sec);
  const avgSec = mean(fields);

  let value: number;
  if (avgSec <= FRESH_FRESH_SEC) value = 100;
  else if (avgSec <= ACCEPTABLE_FRESH_SEC) {
    value = 100 - ((avgSec - FRESH_FRESH_SEC) / (ACCEPTABLE_FRESH_SEC - FRESH_FRESH_SEC)) * 30;
  } else if (avgSec <= STALE_FRESH_SEC) {
    value = 70 - ((avgSec - ACCEPTABLE_FRESH_SEC) / (STALE_FRESH_SEC - ACCEPTABLE_FRESH_SEC)) * 30;
  } else if (avgSec <= VERY_STALE_FRESH_SEC) {
    value = 40 - ((avgSec - STALE_FRESH_SEC) / (VERY_STALE_FRESH_SEC - STALE_FRESH_SEC)) * 40;
  } else {
    value = 0;
  }

  return {
    value: clamp(Math.round(value * 10) / 10),
    explanation: `avg_freshness=${avgSec.toFixed(0)}s across ${fields.length} fields (max=${Math.max(...fields).toFixed(0)}s, min=${Math.min(...fields).toFixed(0)}s)`,
  };
}

// ─── Sub-metric 5: Uncertainty Band ────────────────────────────────────────
//
// Derives a 90% confidence band around AssetPrediction.expected_return.
//
// Method: gaussian_vaR_derived
//   The engine already publishes risk_var_95 (30d 95%-VaR as fractional loss,
//   e.g. -0.08). By assuming a normal distribution of returns:
//     σ = -risk_var_95 / 1.65   (since VaR_95 = -1.65σ for the loss side)
//   The 90% confidence band (two-sided) is:
//     p5  = expected_return - 1.65σ  =  expected_return + risk_var_95
//     p50 = expected_return
//     p95 = expected_return + 1.65σ  =  expected_return - risk_var_95
//   width = p95 - p5 = -2 * risk_var_95
//
// Band tightness (used in composite, 0..100, higher = tighter = more confidence):
//   tightness = 100 - clamp(width / 0.30 * 100, 0, 100)
//   (a 30% width → 0 tightness; a 0% width → 100 tightness)

function computeUncertaintyBand(prediction: AssetPrediction): {
  band: UncertaintyBand;
  tightness: number;
  explanation: string;
} {
  const sigma = -prediction.risk_var_95 / 1.65;
  const p5 = prediction.expected_return + prediction.risk_var_95;
  const p50 = prediction.expected_return;
  const p95 = prediction.expected_return - prediction.risk_var_95;
  const width = p95 - p5;

  const tightness = clamp(100 - (width / 0.30) * 100);

  return {
    band: {
      p5: Math.round(p5 * 10000) / 10000,
      p50: Math.round(p50 * 10000) / 10000,
      p95: Math.round(p95 * 10000) / 10000,
      width: Math.round(width * 10000) / 10000,
      method: 'gaussian_vaR_derived',
    },
    tightness: Math.round(tightness * 10) / 10,
    explanation: `σ=${(sigma * 100).toFixed(2)}% · band=[${(p5 * 100).toFixed(2)}%, ${(p95 * 100).toFixed(2)}%] · width=${(width * 100).toFixed(2)}%`,
  };
}

// ─── Composite Confidence Score ────────────────────────────────────────────
//
// confidence_score = w1 * (100 - dispersion)        // inverted
//                  + w2 * feature_agreement
//                  + w3 * data_quality
//                  + w4 * freshness_factor
//                  + w5 * band_tightness             // inverted width
//
// All sub-metrics are 0..100, weights sum to 1.0 → result is 0..100.

export function computeConfidenceLayer(
  score: AssetScore,
  features: NormalizedFeatures,
  state: MarketState,
): ConfidenceLayer {
  const dispersion = computePredictionDispersion(score.regime, score.score, score.prediction);
  const agreement = computeFeatureAgreement(features);
  const dataQuality = computeDataQuality(state);
  const freshness = computeFreshnessFactor(state);
  const band = computeUncertaintyBand(score.prediction);

  const dispersionInverted = 100 - dispersion.value;
  const bandTightness = band.tightness;

  const contributors: ConfidenceContributor[] = [
    {
      source: 'prediction_dispersion (inverted)',
      weight: COMPOSITE_WEIGHTS.dispersion,
      value: dispersionInverted,
      contribution: dispersionInverted * COMPOSITE_WEIGHTS.dispersion,
      explanation: dispersion.explanation,
    },
    {
      source: 'feature_agreement',
      weight: COMPOSITE_WEIGHTS.agreement,
      value: agreement.value,
      contribution: agreement.value * COMPOSITE_WEIGHTS.agreement,
      explanation: agreement.explanation,
    },
    {
      source: 'data_quality',
      weight: COMPOSITE_WEIGHTS.data_quality,
      value: dataQuality.value,
      contribution: dataQuality.value * COMPOSITE_WEIGHTS.data_quality,
      explanation: dataQuality.explanation,
    },
    {
      source: 'freshness_factor',
      weight: COMPOSITE_WEIGHTS.freshness,
      value: freshness.value,
      contribution: freshness.value * COMPOSITE_WEIGHTS.freshness,
      explanation: freshness.explanation,
    },
    {
      source: 'band_tightness (inverted width)',
      weight: COMPOSITE_WEIGHTS.band_tightness,
      value: bandTightness,
      contribution: bandTightness * COMPOSITE_WEIGHTS.band_tightness,
      explanation: band.explanation,
    },
  ];

  const confidence_score = clamp(
    contributors.reduce((sum, c) => sum + c.contribution, 0)
  );

  return {
    confidence_score: Math.round(confidence_score * 10) / 10,
    prediction_dispersion: dispersion.value,
    feature_agreement: agreement.value,
    data_quality: dataQuality.value,
    freshness_factor: freshness.value,
    uncertainty_band: band.band,
    contributors: contributors.map((c) => ({
      ...c,
      contribution: Math.round(c.contribution * 100) / 100,
      value: Math.round(c.value * 10) / 10,
    })),
    computed_at: new Date().toISOString(),
    layer_version: CONFIDENCE_LAYER_VERSION,
  };
}

// ─── UI Helpers ────────────────────────────────────────────────────────────

export function confidenceGrade(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'HIGH', color: '#16a34a' };
  if (score >= 60) return { label: 'MODERATE', color: '#0066cc' };
  if (score >= 40) return { label: 'LOW', color: '#ca8a04' };
  return { label: 'VERY_LOW', color: '#dc2626' };
}

export function formatBandPct(n: number, digits = 2): string {
  const pct = n * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(digits)}%`;
}
