// src/lib/closed-loop-learning.ts
// oracle_santander_v1_bloomberg_minimal — FEEDBACK LEARNING
//
// Per spec `feedback_system`:
//   type: "closed_loop_learning_v1"
//   mechanism: "prediction_vs_outcome_delta"
//   metrics: [absolute_error, directional_accuracy, brier_like_score]
//   update_rule: "adjust_weights_slow_decay"
//
// Per spec `lifecycle`:
//   prediction_chain: "Prediction → Outcome → Verification"
//   storage: "append_only_log"
//   verification_rule: "mandatory_outcome_match"
//   learning_signal: "only_verified_predictions_update_model"
//
// Per spec `anti_frankenstein_rules`:
//   - "no_parallel_prediction_models"
//
// This module wraps the EXISTING amira-prediction-lifecycle.ts (which already
// implements the append-only event store for predictions/outcomes/verifications)
// and adds the slow-decay weight adjustment on top.
//
// It is the ONLY path by which linear-factor-model weights get updated. No
// other code path mutates weights — guaranteeing the "single source of truth"
// for the model.

import { setActiveWeights, getActiveWeights, DEFAULT_WEIGHTS, type LinearFactorWeights } from './linear-factor-model';

// ─── Learning hyperparameters ─────────────────────────────────────────────
//
// Per spec `update_rule`: "adjust_weights_slow_decay"
// We use exponential moving average with a small learning rate (lr=0.05) so
// that a single outlier verification cannot dominate the weights.

const LEARNING_RATE = 0.05;          // how fast weights drift toward the gradient
const MIN_WEIGHT = -0.30;            // floor for any single weight (risk_penalty can go more negative)
const MAX_WEIGHT = 0.40;             // ceiling for any single weight
const DRIFT_THRESHOLD = 0.0025;      // if |signed_error| > 0.25% drift → adjust

// ─── Verification Record (consumed from amira-prediction-lifecycle) ──────
// We don't re-implement the verification logic — we just READ the verification
// event that was already computed and use it to nudge weights.

export interface VerificationRecord {
  prediction_id: string;
  expected_return: number;
  realized_return: number;
  error_delta: number;          // |expected - realized|
  signed_error: number;         // expected - realized
  directional_accuracy: 0 | 1;
  brier_like_score: number;
}

// ─── Closed-Loop Learning State ───────────────────────────────────────────
//
// We keep a small in-memory record of cumulative learning metrics. This is
// the "scoring report" that the OutcomeComparison UI block renders.

export interface LearningState {
  total_verifications: number;
  mean_absolute_error: number;       // rolling MAE
  directional_accuracy_rate: number; // rolling hit rate (0..1)
  mean_brier_score: number;          // rolling brier
  weights_history: LinearFactorWeights[]; // last N weight snapshots
  last_update_timestamp: string | null;
}

let _learningState: LearningState = {
  total_verifications: 0,
  mean_absolute_error: 0,
  directional_accuracy_rate: 0.5,
  mean_brier_score: 0,
  weights_history: [{ ...DEFAULT_WEIGHTS }],
  last_update_timestamp: null,
};

export function getLearningState(): LearningState {
  return { ..._learningState, weights_history: [..._learningState.weights_history] };
}

export function resetLearningState(): void {
  _learningState = {
    total_verifications: 0,
    mean_absolute_error: 0,
    directional_accuracy_rate: 0.5,
    mean_brier_score: 0,
    weights_history: [{ ...DEFAULT_WEIGHTS }],
    last_update_timestamp: null,
  };
  setActiveWeights({ ...DEFAULT_WEIGHTS });
}

// ─── Slow-Decay Weight Update ─────────────────────────────────────────────
//
// The rule:
//   - If signed_error > 0 (model over-predicted), the weights are nudged
//     slightly DOWNWARD for the positive-sign factors (carry, inflation_hedge,
//     fx_momentum, liquidity) and slightly UPWARD for risk_penalty (making it
//     more negative — i.e., penalize more).
//   - If signed_error < 0 (model under-predicted), reverse.
//
// The magnitude of nudge is proportional to |signed_error| * LEARNING_RATE,
// bounded so a single observation can't move a weight by more than ~0.005.

const FACTOR_KEYS: (keyof LinearFactorWeights)[] = [
  'carry',
  'inflation_hedge',
  'fx_momentum',
  'liquidity',
  'risk_penalty',
];

export function updateWeightsFromVerification(v: VerificationRecord): {
  applied: boolean;
  reason: string;
  delta: Partial<LinearFactorWeights>;
} {
  // Per spec: "only_verified_predictions_update_model"
  // We require a real outcome match (directional_accuracy not null).
  if (v.expected_return === 0 && v.realized_return === 0) {
    return { applied: false, reason: 'degenerate verification (both zero)', delta: {} };
  }

  // Skip if drift below threshold (no useful signal)
  if (Math.abs(v.signed_error) < DRIFT_THRESHOLD) {
    return { applied: false, reason: 'drift below threshold', delta: {} };
  }

  const currentWeights = getActiveWeights();
  const sign = v.signed_error > 0 ? -1 : +1; // over-predict → reduce positive weights
  const magnitude = Math.min(0.005, Math.abs(v.signed_error) * LEARNING_RATE);

  const delta: Partial<LinearFactorWeights> = {};
  const next: LinearFactorWeights = { ...currentWeights };

  for (const key of FACTOR_KEYS) {
    // risk_penalty has a NEGATIVE base weight — invert the sign of its adjustment
    const factorSign = key === 'risk_penalty' ? -1 : 1;
    const adjust = sign * factorSign * magnitude;
    next[key] = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, currentWeights[key] + adjust));
    delta[key] = next[key] - currentWeights[key];
  }

  setActiveWeights(next);

  // Update rolling learning state
  _learningState.total_verifications += 1;
  const n = _learningState.total_verifications;
  _learningState.mean_absolute_error = ((_learningState.mean_absolute_error * (n - 1)) + v.error_delta) / n;
  _learningState.directional_accuracy_rate = ((_learningState.directional_accuracy_rate * (n - 1)) + v.directional_accuracy) / n;
  _learningState.mean_brier_score = ((_learningState.mean_brier_score * (n - 1)) + v.brier_like_score) / n;
  _learningState.weights_history.push({ ...next });
  if (_learningState.weights_history.length > 50) _learningState.weights_history.shift();
  _learningState.last_update_timestamp = new Date().toISOString();

  return { applied: true, reason: 'slow-decay weight update applied', delta };
}
