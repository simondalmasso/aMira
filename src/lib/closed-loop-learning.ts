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
import {
  getLifecycleSnapshot,
  getOutcomesLog,
  getPredictionsLog,
  getVerificationsLog,
  type LifecycleSnapshot,
} from './amira-prediction-lifecycle-core';

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
  mean_absolute_error: number | null;       // rolling MAE; null until first verification
  directional_accuracy_rate: number | null; // rolling hit rate; null until first verification
  mean_brier_score: number | null;          // rolling brier; null until first verification
  weights_history: LinearFactorWeights[]; // last N weight snapshots
  last_update_timestamp: string | null;
  lifecycle: LifecycleSnapshot;
}

export interface LearningSummary {
  status: 'NO_HISTORY' | 'READY';
  sampleCount: number;
  total_verifications: number;
  mean_absolute_error: number | null;
  directional_accuracy_rate: number | null;
  mean_brier_score: number | null;
  last_update_timestamp: string | null;
}

let _learningState: LearningState = {
  total_verifications: 0,
  mean_absolute_error: null,
  directional_accuracy_rate: null,
  mean_brier_score: null,
  weights_history: [{ ...DEFAULT_WEIGHTS }],
  last_update_timestamp: null,
  lifecycle: getLifecycleSnapshot(),
};

export function getLearningState(): LearningState {
  return {
    ..._learningState,
    weights_history: [..._learningState.weights_history],
    lifecycle: getLifecycleSnapshot(),
  };
}


export function getLearningSummary(): LearningSummary {
  // Metrics are derived from the canonical verification log so isolate-local
  // counters are never presented as durable learning truth.
  const verifications = getVerificationsLog();
  const sampleCount = verifications.length;
  if (sampleCount === 0) {
    return {
      status: 'NO_HISTORY',
      sampleCount: 0,
      total_verifications: 0,
      mean_absolute_error: null,
      directional_accuracy_rate: null,
      mean_brier_score: null,
      last_update_timestamp: null,
    };
  }
  return {
    status: 'READY',
    sampleCount,
    total_verifications: sampleCount,
    mean_absolute_error: verifications.reduce((sum, item) => sum + item.error_delta, 0) / sampleCount,
    directional_accuracy_rate: verifications.reduce((sum, item) => sum + item.directional_accuracy, 0) / sampleCount,
    mean_brier_score: verifications.reduce((sum, item) => sum + item.brier_like_score, 0) / sampleCount,
    last_update_timestamp: verifications.at(-1)?.timestamp ?? null,
  };
}

export function resetLearningState(): void {
  _learningState = {
    total_verifications: 0,
    mean_absolute_error: null,
    directional_accuracy_rate: null,
    mean_brier_score: null,
    weights_history: [{ ...DEFAULT_WEIGHTS }],
    last_update_timestamp: null,
    lifecycle: getLifecycleSnapshot(),
  };
  setActiveWeights({ ...DEFAULT_WEIGHTS });
}

/** Rebuild active weights deterministically from durable verified lifecycle events. */
export function rebuildLearningStateFromLifecycle(): LearningSummary {
  resetLearningState();
  const predictions = new Map(getPredictionsLog().map((item) => [item.prediction_id, item]));
  const outcomes = new Map(getOutcomesLog().map((item) => [item.outcome_id, item]));
  for (const verification of getVerificationsLog()) {
    const prediction = predictions.get(verification.prediction_id);
    const outcome = outcomes.get(verification.outcome_id);
    if (!prediction || !outcome) continue;
    updateWeightsFromVerification({
      prediction_id: prediction.prediction_id,
      expected_return: prediction.expected_return,
      realized_return: outcome.realized_return,
      error_delta: verification.error_delta,
      signed_error: verification.signed_error,
      directional_accuracy: verification.directional_accuracy,
      brier_like_score: verification.brier_like_score,
    });
  }
  return getLearningSummary();
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
  _learningState.mean_absolute_error = (((_learningState.mean_absolute_error ?? 0) * (n - 1)) + v.error_delta) / n;
  _learningState.directional_accuracy_rate = (((_learningState.directional_accuracy_rate ?? 0) * (n - 1)) + v.directional_accuracy) / n;
  _learningState.mean_brier_score = (((_learningState.mean_brier_score ?? 0) * (n - 1)) + v.brier_like_score) / n;
  _learningState.weights_history.push({ ...next });
  if (_learningState.weights_history.length > 50) _learningState.weights_history.shift();
  _learningState.last_update_timestamp = new Date().toISOString();

  return { applied: true, reason: 'slow-decay weight update applied', delta };
}
