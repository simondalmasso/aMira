// src/lib/linear-factor-model.ts
// oracle_santander_v1_bloomberg_minimal — SCORING MODEL (single, deterministic)
//
// Per spec `scoring_model`:
//   type: "linear_factor_model_v1"
//   formula: "score = w1*carry + w2*inflation_hedge + w3*fx_momentum + w4*liquidity + w5*risk_penalty"
//   weights:
//     carry:            0.25
//     inflation_hedge:  0.25
//     fx_momentum:      0.20
//     liquidity:        0.15
//     risk_penalty:    -0.15
//   output_range: "0_to_100"
//
// Per spec `anti_frankenstein_rules`:
//   - "one_score_per_asset"
//   - "no_parallel_prediction_models"

import type { NormalizedFeatures } from './single-market-state';

export interface LinearFactorWeights {
  carry: number;
  inflation_hedge: number;
  fx_momentum: number;
  liquidity: number;
  risk_penalty: number;
}

// Per spec — the canonical weights. These are the ONLY weights the
// single_pass_oracle_engine reads. Closed-loop learning adjusts these
// via slow-decay updates from verified outcomes only.
export const DEFAULT_WEIGHTS: LinearFactorWeights = {
  carry: 0.25,
  inflation_hedge: 0.25,
  fx_momentum: 0.20,
  liquidity: 0.15,
  risk_penalty: -0.15,
};

// Current active weights (in-memory module-level; can be updated by
// closed-loop learning). Per anti-Frankenstein rule: ONE weight set
// per asset class. We use a single global set for the SAN asset.
let _activeWeights: LinearFactorWeights = { ...DEFAULT_WEIGHTS };

export function getActiveWeights(): LinearFactorWeights {
  return { ..._activeWeights };
}

export function setActiveWeights(next: Partial<LinearFactorWeights>): void {
  _activeWeights = { ..._activeWeights, ...next };
}

export function resetWeights(): void {
  _activeWeights = { ...DEFAULT_WEIGHTS };
}

// ─── Score Computation (per spec engine.process[2]: score_computation) ────
//
// score = w1*carry + w2*inflation_hedge + w3*fx_momentum + w4*liquidity + w5*risk_penalty
// Output range: 0 to 100.
//
// The raw weighted sum is in [-1, 1] (since each feature is in [-1, 1] and
// the weights sum to ~0.85 absolute). We map [-1, 1] → [0, 100] via the
// affine transform: score = (raw + 1) * 50.

export interface ScoreBreakdown {
  raw: number;
  score: number;             // 0..100
  contributions: {           // per-factor contribution to raw score
    carry: number;
    inflation_hedge: number;
    fx_momentum: number;
    liquidity: number;
    risk_penalty: number;
  };
  weights: LinearFactorWeights;
  model_version: string;
}

export const MODEL_VERSION = 'linear_factor_model_v1';

export function computeScore(
  features: NormalizedFeatures,
  weights: LinearFactorWeights = _activeWeights
): ScoreBreakdown {
  const c_carry = weights.carry * features.carry;
  const c_inflation = weights.inflation_hedge * features.inflation_hedge;
  const c_fx = weights.fx_momentum * features.fx_momentum;
  const c_liquidity = weights.liquidity * features.liquidity;
  const c_risk = weights.risk_penalty * features.risk_penalty; // risk_penalty weight is negative

  const raw = c_carry + c_inflation + c_fx + c_liquidity + c_risk;
  const score = Math.max(0, Math.min(100, (raw + 1) * 50));

  return {
    raw,
    score,
    contributions: {
      carry: c_carry,
      inflation_hedge: c_inflation,
      fx_momentum: c_fx,
      liquidity: c_liquidity,
      risk_penalty: c_risk,
    },
    weights: { ...weights },
    model_version: MODEL_VERSION,
  };
}

// ─── Regime Detection (per spec engine.process[1]: regime_detection) ──────
// Simple, deterministic 4-regime classification based on (carry, risk_sentiment).
// This is the ONLY regime classifier the single-pass engine uses.

export type MarketRegime =
  | 'TIGHTENING'    // high real carry + risk-off (BCRA hiking, FX pressure)
  | 'EASING'        // low/negative real carry + risk-on (BCRA cutting, calm FX)
  | 'STAGFLATION'   // low real carry + risk-off (inflation high, growth weak)
  | 'NEUTRAL';      // moderate carry, neutral sentiment

export interface RegimeClassification {
  regime: MarketRegime;
  confidence: number; // 0..1
  description: string;
}

export function detectRegime(
  features: NormalizedFeatures,
  state: { risk_sentiment: number }
): RegimeClassification {
  const carryHigh = features.carry > 0.15;
  const carryLow = features.carry < -0.05;
  const riskOn = state.risk_sentiment > 0.2;
  const riskOff = state.risk_sentiment < -0.2;

  let regime: MarketRegime;
  let confidence: number;
  let description: string;

  if (carryHigh && riskOff) {
    regime = 'TIGHTENING';
    confidence = 0.75;
    description = 'BCRA tightening under FX pressure — high real carry, risk-off';
  } else if (carryLow && riskOn) {
    regime = 'EASING';
    confidence = 0.75;
    description = 'BCRA easing with calm FX — low real carry, risk-on';
  } else if (carryLow && riskOff) {
    regime = 'STAGFLATION';
    confidence = 0.70;
    description = 'Stagflation — negative real carry + risk-off';
  } else {
    regime = 'NEUTRAL';
    confidence = 0.55;
    description = 'Neutral regime — balanced carry and sentiment';
  }

  return { regime, confidence, description };
}
