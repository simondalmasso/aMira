// src/lib/oracle/v2/audit-trail.ts
// ============================================================================
// R9 — INSTITUTIONAL AUDIT TRAIL (append-only)
// ============================================================================
// MISSION (per ORACLE_V2_SYSTEMIC_ROBUSTNESS spec, R9):
//   "Toda decisión debe ser trazable."
//
// LOG FIELDS (per spec):
//   decision_id          — unique ID per decision
//   oracle_version       — single-pass-oracle-engine MODEL_VERSION
//   weights_version      — linear-factor-model MODEL_VERSION
//   market_snapshot      — compact MarketState snapshot
//   confidence           — V2 confidence_score (R1)
//   verification_status  — one of PENDING/VERIFIED/REJECTED/EXPIRED
//
// DESIGN:
//   - In-memory ring buffer (last 1000 decisions) for session-level audit.
//   - Each decision is journaled ONCE at the moment the engine emits an
//     AssetScoreVector. Updates to verification_status produce a NEW
//     journal entry referencing the original decision_id.
//   - Future persistence: a decisions_audit D1 table.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT introduce a parallel decision log. amira-prediction-lifecycle
//     remains the canonical event store for prediction/outcome/verification
//     events. This audit trail is a SUPERSET view that joins lineage (R6) +
//     confidence (R1) + verification (R4) for institutional reporting.
// ============================================================================

import type { MarketState } from '@/lib/single-market-state';
import type { AssetScore } from '@/lib/single-pass-oracle-engine';

// ─── Public Types ──────────────────────────────────────────────────────────

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

export interface AuditEntry {
  /** Unique decision ID */
  decision_id: string;
  /** ISO-8601 timestamp of the decision */
  timestamp: string;
  /** Oracle engine version (single-pass-oracle-engine) */
  oracle_version: string;
  /** Linear factor model version */
  weights_version: string;
  /** Asset being scored */
  asset: string;
  /** Compact MarketState snapshot (only the 6 core fields) */
  market_snapshot: {
    timestamp: string;
    fx_mep: number;
    inflation_monthly: number;
    rates_tna: number;
    reserves_delta: number;
    risk_sentiment: number;
    liquidity_index: number;
    quality: string;
    sources: string[];
  };
  /** Final score 0..100 */
  score: number;
  /** Risk-adjusted score */
  score_adjusted: number;
  /** Decision signal */
  decision: string;
  /** V2 confidence_score 0..100 (R1) — null if V2 layer not computed */
  confidence: number | null;
  /** Verification status (lifecycle-driven) */
  verification_status: VerificationStatus;
  /** Optional lineage_id (R6) */
  lineage_id?: string;
  /** Optional prediction_hash (R6) */
  prediction_hash?: string;
  /** Optional verification_id (when verified) */
  verification_id?: string;
  /** Optional notes */
  notes?: string;
}

export interface AuditTrailState {
  total_entries: number;
  pending: number;
  verified: number;
  rejected: number;
  expired: number;
  /** Mean confidence across all entries */
  mean_confidence: number | null;
  /** ISO-8601 of last entry */
  last_entry_timestamp: string | null;
  /** Buffer size limit */
  max_buffer: number;
  /** Trail version */
  trail_version: string;
}

export const AUDIT_TRAIL_VERSION = 'audit_trail_v2_r9';

// ─── Internal Buffer ───────────────────────────────────────────────────────

const MAX_AUDIT_ENTRIES = 1000;
let _auditBuffer: AuditEntry[] = [];
let _auditIdSequence = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────

function genDecisionId(): string {
  return `dec_${Date.now().toString(36)}_${(++_auditIdSequence).toString(36)}`;
}

// ─── Public API: Record a Decision ─────────────────────────────────────────

export interface RecordDecisionInput {
  oracle_version: string;
  weights_version: string;
  asset: string;
  market_state: MarketState;
  score: AssetScore;
  confidence?: number;
  lineage_id?: string;
  prediction_hash?: string;
  notes?: string;
}

export function recordDecision(input: RecordDecisionInput): AuditEntry {
  const entry: AuditEntry = {
    decision_id: genDecisionId(),
    timestamp: new Date().toISOString(),
    oracle_version: input.oracle_version,
    weights_version: input.weights_version,
    asset: input.asset,
    market_snapshot: {
      timestamp: input.market_state.timestamp,
      fx_mep: input.market_state.fx_mep,
      inflation_monthly: input.market_state.inflation_monthly,
      rates_tna: input.market_state.rates_tna,
      reserves_delta: input.market_state.reserves_delta,
      risk_sentiment: input.market_state.risk_sentiment,
      liquidity_index: input.market_state.liquidity_index,
      quality: input.market_state.quality,
      sources: [...input.market_state.sources],
    },
    score: input.score.score,
    score_adjusted: input.score.score_adjusted,
    decision: input.score.action,
    confidence: input.confidence ?? null,
    verification_status: 'PENDING',
    lineage_id: input.lineage_id,
    prediction_hash: input.prediction_hash,
    notes: input.notes,
  };

  _auditBuffer.push(entry);
  if (_auditBuffer.length > MAX_AUDIT_ENTRIES) _auditBuffer.shift();
  return entry;
}

// ─── Public API: Update Verification Status ────────────────────────────────

export function updateVerificationStatus(
  decision_id: string,
  status: VerificationStatus,
  verification_id?: string,
  notes?: string,
): AuditEntry | null {
  const entry = _auditBuffer.find((e) => e.decision_id === decision_id);
  if (!entry) return null;

  entry.verification_status = status;
  if (verification_id) entry.verification_id = verification_id;
  if (notes) entry.notes = notes;
  return entry;
}

// ─── Public API: Query the Audit Trail ─────────────────────────────────────

export function getAuditTrail(limit = 100): AuditEntry[] {
  return [..._auditBuffer].reverse().slice(0, limit);
}

export function getAuditEntry(decision_id: string): AuditEntry | null {
  return _auditBuffer.find((e) => e.decision_id === decision_id) ?? null;
}

export function getAuditTrailState(): AuditTrailState {
  const total = _auditBuffer.length;
  const pending = _auditBuffer.filter((e) => e.verification_status === 'PENDING').length;
  const verified = _auditBuffer.filter((e) => e.verification_status === 'VERIFIED').length;
  const rejected = _auditBuffer.filter((e) => e.verification_status === 'REJECTED').length;
  const expired = _auditBuffer.filter((e) => e.verification_status === 'EXPIRED').length;

  const confidences = _auditBuffer
    .map((e) => e.confidence)
    .filter((c): c is number => c !== null);
  const mean_confidence = confidences.length > 0
    ? confidences.reduce((s, v) => s + v, 0) / confidences.length
    : null;

  return {
    total_entries: total,
    pending,
    verified,
    rejected,
    expired,
    mean_confidence: mean_confidence !== null
      ? Math.round(mean_confidence * 10) / 10
      : null,
    last_entry_timestamp: total > 0 ? _auditBuffer[total - 1].timestamp : null,
    max_buffer: MAX_AUDIT_ENTRIES,
    trail_version: AUDIT_TRAIL_VERSION,
  };
}

export function clearAuditTrail(): void {
  _auditBuffer = [];
  _auditIdSequence = 0;
}
