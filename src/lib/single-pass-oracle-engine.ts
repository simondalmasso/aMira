// src/lib/single-pass-oracle-engine.ts
// oracle_santander_v1_bloomberg_minimal — THE SINGLE ENGINE
//
// Per spec `engine`:
//   name: "single_pass_oracle_engine"
//   type: "deterministic_scoring_engine"
//   input: "MarketState"
//   process:
//     1. feature_normalization
//     2. regime_detection
//     3. score_computation
//     4. risk_adjustment
//   output: "AssetScoreVector"
//
// Per spec `prediction_layer`:
//   type: "single_horizon_forecast"
//   horizons_days: [30]
//   output: { expected_return, confidence, risk_var_95 }
//
// Per spec `execution_layer`:
//   mode: "paper_only"
//   actions: [rebalance_signal, hold_signal, reduce_risk_signal]
//
// Per spec `anti_frankenstein_rules`:
//   - "one_engine_only"
//   - "no_parallel_prediction_models"
//
// This is the CANONICAL engine. Legacy modules (oracle-fci, oracle-multi,
// amira-prediction-engine, etc.) continue to exist for backward compatibility
// with existing /api/oracle/* contracts — but the new canonical UI block
// (SingleOraclePanel) reads ONLY from here.

import {
  buildMarketState,
  normalizeFeatures,
  type MarketState,
  type MarketStateInput,
} from './single-market-state';
import {
  computeScore,
  detectRegime,
  getActiveWeights,
  MODEL_VERSION,
  type ScoreBreakdown,
  type RegimeClassification,
  type MarketRegime,
} from './linear-factor-model';

// ─── Asset Universe (per spec santander_specific_logic.asset_universe: [SAN])
//
// We score a single asset: SAN (Banco Santander Argentina ADR).
// The engine is structured to extend to multiple assets later, but the v1
// contract is single-asset. AssetScoreVector is therefore length 1.

export const ASSET_UNIVERSE = ['SAN'] as const;
export type AssetId = (typeof ASSET_UNIVERSE)[number];

// ─── AssetScoreVector (per spec engine.output) ────────────────────────────

export interface AssetScore {
  asset: AssetId;
  score: number;            // 0..100 (canonical score per "one_score_per_asset" rule)
  breakdown: ScoreBreakdown;
  regime: RegimeClassification;
  /** Risk-adjusted score after regime-aware haircut */
  score_adjusted: number;
  /** Single-horizon forecast (30d) */
  prediction: AssetPrediction;
  /** Execution signal for paper-only mode */
  action: 'rebalance_signal' | 'hold_signal' | 'reduce_risk_signal';
}

export interface AssetScoreVector {
  timestamp: string;
  market_state: MarketState;
  scores: AssetScore[];
  model_version: string;
}

// ─── Prediction Layer (per spec prediction_layer) ─────────────────────────

export interface AssetPrediction {
  horizon_days: 30;
  expected_return: number;  // fractional (e.g. 0.012 = 1.2%)
  confidence: number;       // 0..1
  risk_var_95: number;      // 30d 95%-VaR as fractional loss (e.g. -0.08 = -8%)
}

// ─── Risk Adjustment (per spec engine.process[3]: risk_adjustment) ────────
//
// Regime-aware haircut:
//   TIGHTENING  → haircut 10% (financials under pressure)
//   EASING      → boost 5%   (financials benefit from falling rates)
//   STAGFLATION → haircut 15% (worst case for banks: high inflation + weak growth)
//   NEUTRAL     → no change

const REGIME_ADJUSTMENT: Record<MarketRegime, number> = {
  TIGHTENING: -0.10,
  EASING: +0.05,
  STAGFLATION: -0.15,
  NEUTRAL: 0.0,
};

// ─── Single Pass (per spec: ONE pass, ONE engine, ONE score per asset) ────
//
// `runSinglePass` is the only public entry point. It takes a MarketStateInput,
// builds the MarketState, runs all 4 process steps, and returns the
// AssetScoreVector. Deterministic — same input always yields same output.

export function runSinglePass(input: MarketStateInput): AssetScoreVector {
  // Step 1: build market state
  const marketState = buildMarketState(input);

  // Per-asset scoring loop (v1: single asset SAN)
  const scores: AssetScore[] = ASSET_UNIVERSE.map((asset) => {
    // Step 1: feature_normalization
    const features = normalizeFeatures(marketState);

    // Step 2: regime_detection
    const regime = detectRegime(features, marketState);

    // Step 3: score_computation
    const breakdown = computeScore(features, getActiveWeights());

    // Step 4: risk_adjustment
    const adjustment = REGIME_ADJUSTMENT[regime.regime];
    const score_adjusted = Math.max(0, Math.min(100, breakdown.score * (1 + adjustment)));

    // Prediction layer (30d horizon)
    // expected_return: linear blend of carry + fx_momentum, scaled to 30d
    const dailyCarry = features.carry / 365 * 30;
    const dailyFx = features.fx_momentum / 365 * 30;
    let expected_return = (dailyCarry * 0.6 + dailyFx * 0.4) * 0.5; // conservative scaling
    // Regime overlay
    if (regime.regime === 'EASING') expected_return += 0.005;
    if (regime.regime === 'STAGFLATION') expected_return -= 0.008;
    if (regime.regime === 'TIGHTENING') expected_return -= 0.004;

    // Confidence: function of data quality + regime confidence + score extremity
    const qualityBoost = marketState.quality === 'REAL' ? 0.15 : marketState.quality === 'PARTIAL_FALLBACK' ? 0.05 : 0;
    const extremityBoost = Math.abs(breakdown.raw) * 0.3;
    const confidence = Math.max(0.1, Math.min(0.9, 0.4 + qualityBoost + regime.confidence * 0.2 + extremityBoost));

    // 95% VaR (30d): base 6% vol, scaled by risk_penalty
    const baseVol = 0.06;
    const risk_var_95 = -(baseVol * (1 + features.risk_penalty * 2) * 1.65); // 1.65 = 95% one-sided

    const prediction: AssetPrediction = {
      horizon_days: 30,
      expected_return: Math.round(expected_return * 10000) / 10000,
      confidence: Math.round(confidence * 100) / 100,
      risk_var_95: Math.round(risk_var_95 * 10000) / 10000,
    };

    // Execution signal (paper_only mode)
    let action: 'rebalance_signal' | 'hold_signal' | 'reduce_risk_signal';
    if (score_adjusted >= 65 && prediction.expected_return > 0) {
      action = 'rebalance_signal';
    } else if (score_adjusted < 40 || prediction.expected_return < 0) {
      action = 'reduce_risk_signal';
    } else {
      action = 'hold_signal';
    }

    return {
      asset,
      score: Math.round(breakdown.score * 10) / 10,
      breakdown,
      regime,
      score_adjusted: Math.round(score_adjusted * 10) / 10,
      prediction,
      action,
    };
  });

  return {
    timestamp: marketState.timestamp,
    market_state: marketState,
    scores,
    model_version: MODEL_VERSION,
  };
}

// ─── Helpers for UI consumption ───────────────────────────────────────────

export function getSanScore(vector: AssetScoreVector): AssetScore | null {
  return vector.scores.find((s) => s.asset === 'SAN') ?? null;
}

export function formatScore(score: number): string {
  return score.toFixed(1);
}

export function formatReturn(r: number): string {
  const pct = r * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}
