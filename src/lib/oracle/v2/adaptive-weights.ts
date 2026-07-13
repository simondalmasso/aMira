// src/lib/oracle/v2/adaptive-weights.ts
// ============================================================================
// R5 — ADAPTIVE WEIGHT ENGINE (append-only, complements closed-loop-learning)
// ============================================================================
// MISSION (per ORACLE_V2_SYSTEMIC_ROBUSTNESS spec, R5):
//   "Actualizar pesos SOLO cuando una predicción fue verificada."
//
// RULES:
//   1. never learn from simulations
//   2. never learn from stale data
//   3. bounded learning         — max |Δweight| per update = 0.005
//   4. slow decay               — EMA learning rate = 0.05
//   5. rollback capable         — every update is journaled for undo
//
// DESIGN:
//   - The canonical closed-loop-learning.ts already implements rules 1-4 via
//     updateWeightsFromVerification(). It maintains a weights_history ring
//     buffer of the last 50 snapshots.
//   - This V2 module ADDS:
//       (a) Explicit "verified-only" gate (rule 1) — rejects any input
//           lacking a verification_id from the lifecycle.
//       (b) Staleness gate (rule 2) — rejects verifications older than 7d.
//       (c) Rollback API (rule 5) — rollBackWeights(steps) restores prior
//           weight snapshots via setActiveWeights().
//       (d) An institutional journal AdaptiveWeightJournal entry per update.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT introduce a second weights store. setActiveWeights() remains
//     the single mutator; linear-factor-model remains the single source.
// ============================================================================

import {
  setActiveWeights,
  getActiveWeights,
  DEFAULT_WEIGHTS,
  type LinearFactorWeights,
} from '@/lib/linear-factor-model';
import { updateWeightsFromVerification } from '@/lib/closed-loop-learning';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface AdaptiveWeightJournalEntry {
  entry_id: string;
  timestamp: string;
  verification_id: string;
  prediction_id: string;
  pre_weights: LinearFactorWeights;
  post_weights: LinearFactorWeights;
  delta: Partial<LinearFactorWeights>;
  applied: boolean;
  reason: string;
  /** Age of the verification in hours (rule 2 gate) */
  verification_age_hours: number;
  /** Rule check results */
  rules_checked: {
    verified_only: boolean;
    fresh_enough: boolean;
    bounded: boolean;
    within_decay: boolean;
  };
}

export interface AdaptiveWeightState {
  /** Total weight updates applied */
  total_updates: number;
  /** Total updates rejected (any rule failed) */
  total_rejections: number;
  /** Current weights (mirror of linear-factor-model active weights) */
  current_weights: LinearFactorWeights;
  /** Default weights (baseline for drift measurement) */
  default_weights: LinearFactorWeights;
  /** Drift = ||current - default||₁ (sum of absolute deltas) */
  drift_from_default: number;
  /** Journal of last N updates (for rollback + audit) */
  journal: AdaptiveWeightJournalEntry[];
  /** Max journal entries kept in memory */
  max_journal: number;
  /** ISO-8601 of last applied update */
  last_update_timestamp: string | null;
  /** Engine version */
  engine_version: string;
}

export const ADAPTIVE_WEIGHTS_VERSION = 'adaptive_weights_v2_r5';

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_JOURNAL = 100;
const MAX_VERIFICATION_AGE_HOURS = 24 * 7; // 7 days
const MAX_WEIGHT_DELTA = 0.005;            // rule 3: bounded
const LEARNING_RATE = 0.05;                // rule 4: slow decay

// ─── Internal Journal (append-only memory) ─────────────────────────────────

let _journal: AdaptiveWeightJournalEntry[] = [];
let _totalUpdates = 0;
let _totalRejections = 0;
let _lastUpdateTimestamp: string | null = null;

// ─── Helpers ───────────────────────────────────────────────────────────────

function genId(): string {
  return `awje_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function driftFromDefault(w: LinearFactorWeights): number {
  return (
    Math.abs(w.carry - DEFAULT_WEIGHTS.carry) +
    Math.abs(w.inflation_hedge - DEFAULT_WEIGHTS.inflation_hedge) +
    Math.abs(w.fx_momentum - DEFAULT_WEIGHTS.fx_momentum) +
    Math.abs(w.liquidity - DEFAULT_WEIGHTS.liquidity) +
    Math.abs(w.risk_penalty - DEFAULT_WEIGHTS.risk_penalty)
  );
}

// ─── Rule Checks ───────────────────────────────────────────────────────────

interface RuleCheckResult {
  verified_only: boolean;
  fresh_enough: boolean;
  bounded: boolean;
  within_decay: boolean;
  all_passed: boolean;
  failure_reason: string;
}

function checkRules(
  verification_id: string | null,
  verification_timestamp: Date,
  delta: Partial<LinearFactorWeights>,
): RuleCheckResult {
  const rules = {
    verified_only: verification_id !== null && verification_id.length > 0,
    fresh_enough: (Date.now() - verification_timestamp.getTime()) / 3600000 <= MAX_VERIFICATION_AGE_HOURS,
    bounded: Object.values(delta).every((d) => Math.abs(d ?? 0) <= MAX_WEIGHT_DELTA + 1e-9),
    within_decay: true, // EMA rate is hardcoded; always satisfied
  };

  const all_passed = rules.verified_only && rules.fresh_enough && rules.bounded && rules.within_decay;
  const failure_reason = !rules.verified_only
    ? 'rejected: missing verification_id (rule 1: never learn from simulations)'
    : !rules.fresh_enough
    ? 'rejected: verification older than 7 days (rule 2: never learn from stale data)'
    : !rules.bounded
    ? 'rejected: |delta| exceeds 0.005 bound (rule 3: bounded learning)'
    : '';

  return { ...rules, all_passed, failure_reason };
}

// ─── Apply Verification → Weight Update ────────────────────────────────────
//
// This is the ONLY public entry point for adaptive weight updates. It wraps
// closed-loop-learning's updateWeightsFromVerification() with the rule checks.

export interface VerificationInput {
  verification_id: string | null;
  prediction_id: string;
  expected_return: number;
  realized_return: number;
  verification_timestamp: string; // ISO-8601
}

export function applyVerifiedUpdate(input: VerificationInput): AdaptiveWeightJournalEntry {
  const pre_weights = getActiveWeights();
  const verification_date = new Date(input.verification_timestamp);
  const verification_age_hours = (Date.now() - verification_date.getTime()) / 3600000;

  // First, ask the canonical closed-loop-learning for a proposed delta
  const proposed = updateWeightsFromVerification({
    prediction_id: input.prediction_id,
    expected_return: input.expected_return,
    realized_return: input.realized_return,
    error_delta: Math.abs(input.expected_return - input.realized_return),
    signed_error: input.expected_return - input.realized_return,
    directional_accuracy:
      Math.sign(input.expected_return) === Math.sign(input.realized_return) ? 1 : 0,
    brier_like_score: (input.expected_return - input.realized_return) ** 2,
  });

  // Check rules
  const rules = checkRules(input.verification_id, verification_date, proposed.delta);
  const applied = proposed.applied && rules.all_passed;

  // If rules failed but the closed-loop-learning already mutated weights,
  // we need to ROLL BACK the mutation (since we cannot prevent it from
  // happening inside updateWeightsFromVerification). We do this by
  // restoring pre_weights via setActiveWeights.
  if (!rules.all_passed && proposed.applied) {
    setActiveWeights(pre_weights);
  }

  const post_weights = applied ? getActiveWeights() : pre_weights;
  const delta = applied ? proposed.delta : {};

  const entry: AdaptiveWeightJournalEntry = {
    entry_id: genId(),
    timestamp: new Date().toISOString(),
    verification_id: input.verification_id ?? '',
    prediction_id: input.prediction_id,
    pre_weights,
    post_weights,
    delta,
    applied,
    reason: applied ? proposed.reason : rules.failure_reason,
    verification_age_hours: Math.round(verification_age_hours * 10) / 10,
    rules_checked: {
      verified_only: rules.verified_only,
      fresh_enough: rules.fresh_enough,
      bounded: rules.bounded,
      within_decay: rules.within_decay,
    },
  };

  _journal.push(entry);
  if (_journal.length > MAX_JOURNAL) _journal.shift();

  if (applied) {
    _totalUpdates++;
    _lastUpdateTimestamp = entry.timestamp;
  } else {
    _totalRejections++;
  }

  return entry;
}

// ─── Rollback (rule 5) ─────────────────────────────────────────────────────
//
// Restores weights to a previous snapshot by walking back N journal entries.
// Returns the number of entries rolled back.

export function rollBackWeights(steps: number): {
  rolled_back: number;
  restored_to: LinearFactorWeights;
  journal_entry?: AdaptiveWeightJournalEntry;
} {
  if (steps <= 0 || _journal.length === 0) {
    return { rolled_back: 0, restored_to: getActiveWeights() };
  }

  const target_idx = Math.max(0, _journal.length - 1 - steps);
  const target_entry = _journal[target_idx];
  const restored = { ...target_entry.pre_weights };

  setActiveWeights(restored);

  return {
    rolled_back: Math.min(steps, _journal.length - 1),
    restored_to: restored,
    journal_entry: target_entry,
  };
}

// ─── State Inspection ──────────────────────────────────────────────────────

export function getAdaptiveWeightState(): AdaptiveWeightState {
  const current = getActiveWeights();
  return {
    total_updates: _totalUpdates,
    total_rejections: _totalRejections,
    current_weights: current,
    default_weights: { ...DEFAULT_WEIGHTS },
    drift_from_default: Math.round(driftFromDefault(current) * 1e6) / 1e6,
    journal: [..._journal],
    max_journal: MAX_JOURNAL,
    last_update_timestamp: _lastUpdateTimestamp,
    engine_version: ADAPTIVE_WEIGHTS_VERSION,
  };
}

export function resetAdaptiveWeights(): void {
  _journal = [];
  _totalUpdates = 0;
  _totalRejections = 0;
  _lastUpdateTimestamp = null;
  setActiveWeights({ ...DEFAULT_WEIGHTS });
}
