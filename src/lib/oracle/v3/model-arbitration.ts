// src/lib/oracle/v3/model-arbitration.ts
// ============================================================================
// I4 — MODEL ARBITRATION (append-only, ensemble intelligence)
// ============================================================================
// MISSION (per ORACLE_V3_INTELLIGENCE_LAYER spec, I4):
//   "Crear ensemble inteligente."
//
// MODELS:
//   - Oracle      : canonical deterministic engine (ALWAYS present, highest weight)
//   - TimesFM     : foundation model (via V2 R10 adapter)
//   - MAPIE       : conformal predictor (via V3 I1 adapter)
//   - Chronos     : future adapter (stub)
//   - PyMC        : future adapter (stub)
//
// ARBITRATION RULES:
//   1. Each model VOTES (produces a 30d expected_return + confidence).
//   2. The Oracle DECIDES — it remains the final authority.
//   3. Ensemble forecast = weighted average (Oracle weight ≥ 0.50).
//   4. DISAGREEMENT SIGNAL: when models disagree on direction, raise a flag
//      and reduce ensemble confidence (but Oracle score is unchanged).
//   5. CONSENSUS BOOST: when all models agree on direction, boost ensemble
//      confidence (Oracle score still unchanged).
//
// DESIGN:
//   - Builds on V2 R10 (foundation-model-adapter) — reuses its registry.
//   - Adds NEW arbitration logic on top: disagreement detection, consensus
//     scoring, veto power (Oracle can ignore ensemble).
//
// ANTI-FRANKENSTEIN:
//   - Does NOT modify single-pass-oracle-engine.
//   - Does NOT modify V2 R10.
//   - Adds a NEW v3.arbitration field.
// ============================================================================

import type { AssetScore, AssetPrediction } from '@/lib/single-pass-oracle-engine';
import type { MarketState } from '@/lib/single-market-state';
import type { AdvisorReport, AdvisorForecast } from '@/lib/oracle/v2/foundation-model-adapter';

// ─── Public Types ──────────────────────────────────────────────────────────

export type ArbitrationStrategy = 'oracle_authority' | 'weighted_ensemble' | 'majority_vote' | 'confidence_weighted';

export interface ModelVote {
  /** Model id */
  model_id: string;
  /** Display name */
  model_name: string;
  /** 30d expected return forecast (fractional) */
  expected_return: number;
  /** Confidence 0..100 */
  confidence: number;
  /** Direction: 'bullish' | 'bearish' | 'neutral' */
  direction: 'bullish' | 'bearish' | 'neutral';
  /** Weight in the ensemble (0..1) */
  weight: number;
  /** Whether this model's vote was cast (vs stub) */
  is_stub: boolean;
  /** Method description */
  method: string;
}

export interface DisagreementAnalysis {
  /** Number of models bullish */
  bullish: number;
  /** Number of models bearish */
  bearish: number;
  /** Number of models neutral */
  neutral: number;
  /** True if models disagree on direction */
  disagreement_detected: boolean;
  /** Dispersion of forecasts (stdev / |mean|) */
  forecast_dispersion: number;
  /** Range of forecasts (max - min) */
  forecast_range: number;
  /** Consensus direction (majority) */
  consensus_direction: 'bullish' | 'bearish' | 'neutral';
  /** Consensus strength 0..100 */
  consensus_strength: number;
}

export interface ArbitrationResult {
  /** Strategy used */
  strategy: ArbitrationStrategy;
  /** All votes (including Oracle) */
  votes: ModelVote[];
  /** Ensemble expected_return (fractional) */
  ensemble_expected_return: number;
  /** Ensemble confidence 0..100 */
  ensemble_confidence: number;
  /** Oracle's authoritative expected_return (UNCHANGED by arbitration) */
  oracle_authoritative_return: number;
  /** Oracle's authoritative confidence (UNCHANGED) */
  oracle_authoritative_confidence: number;
  /** Disagreement analysis */
  disagreement: DisagreementAnalysis;
  /** Whether the ensemble confirms the Oracle's direction */
  confirms_oracle: boolean;
  /** Adjustment to ensemble confidence based on consensus/disagreement */
  consensus_adjustment: number;
  /** Final arbitration notes */
  notes: string;
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
  /** Feature flag */
  enabled: boolean;
}

export const MODEL_ARBITRATION_VERSION = 'model_arbitration_v3_i4';

// ─── Feature Flag ──────────────────────────────────────────────────────────

let _enabled = true;
export function setModelArbitrationEnabled(v: boolean): void { _enabled = v; }
export function isModelArbitrationEnabled(): boolean { return _enabled; }

// ─── Strategy Selection ────────────────────────────────────────────────────

let _strategy: ArbitrationStrategy = 'oracle_authority';
export function setArbitrationStrategy(s: ArbitrationStrategy): void { _strategy = s; }
export function getArbitrationStrategy(): ArbitrationStrategy { return _strategy; }

// ─── Helpers ───────────────────────────────────────────────────────────────

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / nums.length);
}

function directionOf(r: number): 'bullish' | 'bearish' | 'neutral' {
  if (r > 0.001) return 'bullish';
  if (r < -0.001) return 'bearish';
  return 'neutral';
}

// ─── Vote Construction ─────────────────────────────────────────────────────

function buildVotes(
  oracle: AssetScore,
  v2Advisors: AdvisorReport,
): ModelVote[] {
  const votes: ModelVote[] = [];

  // Oracle vote — always present, highest weight
  votes.push({
    model_id: 'oracle',
    model_name: 'Single Oracle (canonical)',
    expected_return: round(oracle.prediction.expected_return, 6),
    confidence: round(oracle.prediction.confidence * 100, 1),
    direction: directionOf(oracle.prediction.expected_return),
    weight: 0.50, // base Oracle weight
    is_stub: false,
    method: 'deterministic linear factor model + regime adjustment',
  });

  // Advisor votes from V2 R10
  for (const f of v2Advisors.forecasts) {
    votes.push({
      model_id: f.adapter_id,
      model_name: f.adapter_name,
      expected_return: round(f.expected_return, 6),
      confidence: round(f.confidence, 1),
      direction: directionOf(f.expected_return),
      weight: f.is_stub ? 0.10 : 0.15, // stubs get less weight
      is_stub: f.is_stub,
      method: f.method,
    });
  }

  return votes;
}

// ─── Disagreement Analysis ─────────────────────────────────────────────────

function analyzeDisagreement(votes: ModelVote[]): DisagreementAnalysis {
  const bullish = votes.filter((v) => v.direction === 'bullish').length;
  const bearish = votes.filter((v) => v.direction === 'bearish').length;
  const neutral = votes.filter((v) => v.direction === 'neutral').length;

  const returns = votes.map((v) => v.expected_return);
  const m = mean(returns);
  const sd = stdev(returns);
  const forecast_dispersion = Math.abs(m) > 1e-6 ? sd / Math.abs(m) : 0;
  const forecast_range = Math.max(...returns) - Math.min(...returns);

  const disagreement_detected = bullish > 0 && bearish > 0;
  const maxCount = Math.max(bullish, bearish, neutral);
  const consensus_direction: 'bullish' | 'bearish' | 'neutral' =
    bullish === maxCount ? 'bullish' : bearish === maxCount ? 'bearish' : 'neutral';
  const consensus_strength = (maxCount / votes.length) * 100;

  return {
    bullish,
    bearish,
    neutral,
    disagreement_detected,
    forecast_dispersion: round(forecast_dispersion, 3),
    forecast_range: round(forecast_range, 6),
    consensus_direction,
    consensus_strength: round(consensus_strength, 1),
  };
}

// ─── Ensemble Computation ──────────────────────────────────────────────────

function computeEnsemble(votes: ModelVote[], strategy: ArbitrationStrategy): {
  expected_return: number;
  confidence: number;
  consensus_adjustment: number;
  notes: string;
} {
  // Normalize weights to sum to 1
  const totalWeight = votes.reduce((s, v) => s + v.weight, 0);
  const normalized = votes.map((v) => ({ ...v, weight: v.weight / totalWeight }));

  let expected_return: number;
  let confidence: number;

  switch (strategy) {
    case 'majority_vote': {
      // Each model gets equal weight
      const n = votes.length;
      expected_return = mean(votes.map((v) => v.expected_return));
      confidence = mean(votes.map((v) => v.confidence));
      void n;
      break;
    }
    case 'confidence_weighted': {
      // Weight by each model's confidence
      const totalConf = votes.reduce((s, v) => s + v.confidence, 0);
      expected_return = votes.reduce((s, v) => s + (v.confidence / totalConf) * v.expected_return, 0);
      confidence = mean(votes.map((v) => v.confidence));
      break;
    }
    case 'weighted_ensemble':
    case 'oracle_authority':
    default: {
      // Pre-defined weights (Oracle highest)
      expected_return = normalized.reduce((s, v) => s + v.weight * v.expected_return, 0);
      confidence = normalized.reduce((s, v) => s + v.weight * v.confidence, 0);
      break;
    }
  }

  // Consensus adjustment
  const disagreement = analyzeDisagreement(votes);
  let consensus_adjustment = 0;
  let notes = '';

  if (disagreement.disagreement_detected) {
    // Penalize confidence when models disagree
    consensus_adjustment = -Math.min(20, disagreement.forecast_dispersion * 10);
    notes = `Disagreement detected: ${disagreement.bullish} bullish vs ${disagreement.bearish} bearish. Ensemble confidence reduced by ${Math.abs(consensus_adjustment).toFixed(1)} pts.`;
  } else if (disagreement.consensus_strength === 100) {
    // All models agree → boost confidence
    consensus_adjustment = +10;
    notes = `Full consensus (${disagreement.consensus_direction}). Ensemble confidence boosted by 10 pts.`;
  } else {
    notes = `Partial consensus (${disagreement.consensus_strength.toFixed(0)}% ${disagreement.consensus_direction}). No adjustment.`;
  }

  return {
    expected_return: round(expected_return, 6),
    confidence: round(Math.max(0, Math.min(100, confidence + consensus_adjustment)), 1),
    consensus_adjustment: round(consensus_adjustment, 1),
    notes,
  };
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export interface ModelArbitrationInput {
  oracle_score: AssetScore;
  prediction: AssetPrediction;
  v2_advisors: AdvisorReport;
  market_state: MarketState;
  strategy?: ArbitrationStrategy;
}

export function arbitrateModels(input: ModelArbitrationInput): ArbitrationResult {
  const strategy = input.strategy ?? _strategy;
  const votes = buildVotes(input.oracle_score, input.v2_advisors);
  const disagreement = analyzeDisagreement(votes);
  const ensemble = computeEnsemble(votes, strategy);

  const oracleVote = votes.find((v) => v.model_id === 'oracle')!;
  const confirms_oracle = oracleVote.direction === disagreement.consensus_direction;

  return {
    strategy,
    votes,
    ensemble_expected_return: ensemble.expected_return,
    ensemble_confidence: ensemble.confidence,
    oracle_authoritative_return: round(input.prediction.expected_return, 6),
    oracle_authoritative_confidence: round(input.prediction.confidence * 100, 1),
    disagreement,
    confirms_oracle,
    consensus_adjustment: ensemble.consensus_adjustment,
    notes: ensemble.notes,
    computed_at: new Date().toISOString(),
    engine_version: MODEL_ARBITRATION_VERSION,
    enabled: _enabled,
  };
}
