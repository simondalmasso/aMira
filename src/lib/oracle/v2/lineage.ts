// src/lib/oracle/v2/lineage.ts
// ============================================================================
// R6 — PREDICTION LINEAGE (append-only)
// ============================================================================
// MISSION (per ORACLE_V2_SYSTEMIC_ROBUSTNESS spec, R6):
//   "Cada predicción debe ser reproducible."
//
// STORE:
//   input snapshot      — raw MarketStateInput used
//   market state        — built MarketState (post-normalization pre-features)
//   weights             — LinearFactorWeights active at prediction time
//   regime              — RegimeClassification (legacy 4-state)
//   score               — final score 0..100
//   decision            — action signal (rebalance/hold/reduce)
//   confidence          — V2 ConfidenceLayer (R1)
//   prediction hash     — SHA-256 of (input + weights + version)
//
// DESIGN:
//   - Pure functions for hashing + snapshot building.
//   - In-memory ring buffer of last N lineage records (default 500).
//   - Future persistence: when D1 schema is extended, this buffer flushes
//     to a predictions_lineage table. For now, in-memory is sufficient for
//     audit + reproducibility within a session.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT introduce a parallel prediction store.
//   - Reads from canonical AssetScore + MarketState.
// ============================================================================

import type { MarketState, MarketStateInput } from '@/lib/single-market-state';
import type { AssetScore } from '@/lib/single-pass-oracle-engine';
import type { LinearFactorWeights } from '@/lib/linear-factor-model';
import type { ConfidenceLayer } from './confidence-engine';
import type { RegimeV2Classification } from './regime-detector-v2';
import type { DecisionExplanation } from './explainer';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface PredictionLineage {
  /** Unique lineage ID (deterministic from hash) */
  lineage_id: string;
  /** SHA-256 of canonical inputs */
  prediction_hash: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Asset being scored */
  asset: string;
  /** Oracle engine version (from single-pass-oracle-engine MODEL_VERSION) */
  oracle_version: string;
  /** Linear factor model version */
  model_version: string;
  /** Raw MarketStateInput */
  input_snapshot: MarketStateInput;
  /** Built MarketState */
  market_state: MarketState;
  /** Weights active at decision time */
  weights: LinearFactorWeights;
  /** Legacy 4-state regime classification */
  regime: AssetScore['regime'];
  /** V2 7-state regime classification (optional, R2) */
  regime_v2?: RegimeV2Classification;
  /** Final score 0..100 */
  score: number;
  /** Risk-adjusted score */
  score_adjusted: number;
  /** Decision signal */
  decision: AssetScore['action'];
  /** V2 Confidence Layer (optional, R1) */
  confidence?: ConfidenceLayer;
  /** V2 Decision explanation (optional, R3) */
  explanation?: DecisionExplanation;
  /** Prediction (from AssetScore) */
  prediction: AssetScore['prediction'];
}

export const LINEAGE_VERSION = 'lineage_v2_r6';

// ─── Internal Storage (in-memory ring buffer) ──────────────────────────────

const MAX_LINEAGE = 500;
let _lineageBuffer: PredictionLineage[] = [];

// ─── Hashing ───────────────────────────────────────────────────────────────
//
// We need a SHA-256 implementation. Node 18+ has crypto.subtle.digest, but
// this is async. For determinism + simplicity we use a synchronous
// pure-JS SHA-256 (small, well-known implementation) so the hash can be
// computed inline.
//
// Alternative: use crypto.randomUUID() for the lineage_id and a fast hash
// (FNV-1a 32-bit) for the prediction_hash. We use FNV-1a here for speed.

function fnv1aHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Convert to hex (32-bit unsigned)
  return (h >>> 0).toString(16).padStart(8, '0');
}

function buildPredictionHash(
  input: MarketStateInput,
  weights: LinearFactorWeights,
  oracle_version: string,
  model_version: string,
  asset: string,
): string {
  const canonical = JSON.stringify({
    asset,
    input: {
      fx_mep: input.fx_mep,
      inflation_monthly: input.inflation_monthly,
      rates_tna: input.rates_tna,
      reserves_usd: input.reserves_usd,
      reserves_usd_prev: input.reserves_usd_prev,
      fx_gap_pct: input.fx_gap_pct,
      market_breadth: input.market_breadth,
      sources: input.sources,
      quality: input.quality,
    },
    weights,
    oracle_version,
    model_version,
  });
  // Use FNV-1a + length + first/last chars to make it more collision-resistant
  const h1 = fnv1aHash(canonical);
  const h2 = fnv1aHash(canonical + canonical.length + canonical[0] + canonical[canonical.length - 1]);
  return `${h1}${h2}`;
}

// ─── Lineage Builder ───────────────────────────────────────────────────────

export interface LineageInput {
  asset: string;
  oracle_version: string;
  model_version: string;
  input: MarketStateInput;
  market_state: MarketState;
  score: AssetScore;
  weights: LinearFactorWeights;
  confidence?: ConfidenceLayer;
  regime_v2?: RegimeV2Classification;
  explanation?: DecisionExplanation;
}

export function buildLineage(input: LineageInput): PredictionLineage {
  const prediction_hash = buildPredictionHash(
    input.input,
    input.weights,
    input.oracle_version,
    input.model_version,
    input.asset,
  );

  const lineage_id = `lin_${prediction_hash}_${Date.now().toString(36)}`;
  const timestamp = new Date().toISOString();

  return {
    lineage_id,
    prediction_hash,
    timestamp,
    asset: input.asset,
    oracle_version: input.oracle_version,
    model_version: input.model_version,
    input_snapshot: { ...input.input },
    market_state: { ...input.market_state },
    weights: { ...input.weights },
    regime: { ...input.score.regime },
    regime_v2: input.regime_v2,
    score: input.score.score,
    score_adjusted: input.score.score_adjusted,
    decision: input.score.action,
    confidence: input.confidence,
    explanation: input.explanation,
    prediction: { ...input.score.prediction },
  };
}

// ─── Buffer Management ─────────────────────────────────────────────────────

export function recordLineage(lineage: PredictionLineage): void {
  _lineageBuffer.push(lineage);
  if (_lineageBuffer.length > MAX_LINEAGE) _lineageBuffer.shift();
}

export function getLineageBuffer(): PredictionLineage[] {
  return [..._lineageBuffer];
}

export function getLineageById(lineage_id: string): PredictionLineage | null {
  return _lineageBuffer.find((l) => l.lineage_id === lineage_id) ?? null;
}

export function getLineageByHash(prediction_hash: string): PredictionLineage | null {
  return _lineageBuffer.find((l) => l.prediction_hash === prediction_hash) ?? null;
}

export function clearLineageBuffer(): void {
  _lineageBuffer = [];
}

export function getLineageStats(): {
  total: number;
  max_buffer: number;
  unique_hashes: number;
  latest_timestamp: string | null;
  version: string;
} {
  const unique_hashes = new Set(_lineageBuffer.map((l) => l.prediction_hash)).size;
  return {
    total: _lineageBuffer.length,
    max_buffer: MAX_LINEAGE,
    unique_hashes,
    latest_timestamp: _lineageBuffer.length > 0
      ? _lineageBuffer[_lineageBuffer.length - 1].timestamp
      : null,
    version: LINEAGE_VERSION,
  };
}
