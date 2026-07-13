// src/lib/oracle/v3/historical-memory.ts
// ============================================================================
// I6 — HISTORICAL MEMORY (append-only)
// ============================================================================
// MISSION (per ORACLE_V3_INTELLIGENCE_LAYER spec, I6):
//   "El Oracle debe recordar decisiones similares."
//
// CAPABILITIES:
//   - Nearest historical states    : k-NN search in feature space
//   - Similarity search            : cosine similarity on normalized feature vectors
//   - Outcome retrieval            : what actually happened after similar predictions
//   - Historical analogs           : top-K most similar past predictions
//   - Confidence from analogs      : how confident should we be given analog outcomes?
//
// DESIGN:
//   - Reads from V2 R6 lineage + V2 R4 verification buffer.
//   - Builds an in-memory index over historical state vectors.
//   - Computes confidence adjustment based on analog outcomes.
//   - I5 (Evidence Engine) is more granular (per-factor); I6 is coarser
//     (whole-state similarity).
//
// ANTI-FRANKENSTEIN:
//   - Does NOT duplicate V2 R6 lineage.
//   - Does NOT modify V2 R1 confidence.
// ============================================================================

import type { NormalizedFeatures, MarketState } from '@/lib/single-market-state';
import type { AssetScore } from '@/lib/single-pass-oracle-engine';
import { getLineageBuffer } from '@/lib/oracle/v2/lineage';
import { getVerificationBuffer } from '@/lib/oracle/v2/forecast-verifier';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface MemoryRecord {
  /** Lineage ID */
  lineage_id: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Predicted return at the time */
  predicted_return: number;
  /** Realized return (if verified, else null) */
  realized_return: number | null;
  /** Directional correctness (if verified) */
  was_correct: boolean | null;
  /** Regime at the time (V2 7-state, fallback to V1 4-state) */
  regime: string;
  /** Score at the time */
  score: number;
  /** Action taken */
  action: string;
  /** Confidence at the time (if recorded) */
  confidence: number | null;
}

export interface SimilaritySearchResult {
  /** The matched record */
  record: MemoryRecord;
  /** Similarity score 0..1 (higher = more similar) */
  similarity: number;
  /** Distance in feature space */
  distance: number;
  /** Per-dimension distance breakdown */
  dimension_distances: Record<string, number>;
}

export interface AnalogOutcomeStats {
  /** Number of analogs with verified outcomes */
  verified_count: number;
  /** Mean predicted return across analogs */
  mean_predicted: number;
  /** Mean realized return across analogs */
  mean_realized: number;
  /** Mean absolute error */
  mean_absolute_error: number;
  /** Directional accuracy */
  directional_accuracy: number;
  /** Outcome distribution */
  outcome_distribution: {
    positive: number;  // realized > 0
    negative: number;  // realized < 0
    neutral: number;   // realized ≈ 0
  };
}

export interface ConfidenceFromAnalogs {
  /** Confidence derived from analog outcomes (0..100) */
  analog_confidence: number;
  /** Adjustment to apply to the V2 heuristic confidence (signed) */
  adjustment: number;
  /** Reason for the adjustment */
  reason: string;
  /** Strength of evidence: STRONG / MODERATE / WEAK / INSUFFICIENT */
  strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT';
}

export interface HistoricalMemoryReport {
  /** Top-K most similar historical states */
  nearest_states: SimilaritySearchResult[];
  /** Number of states searched */
  memory_size: number;
  /** Outcome statistics across the nearest states */
  outcome_stats: AnalogOutcomeStats;
  /** Confidence derived from analogs */
  analog_confidence: ConfidenceFromAnalogs;
  /** Mean similarity of the top-K */
  mean_similarity: number;
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
  /** Feature flag */
  enabled: boolean;
}

export const HISTORICAL_MEMORY_VERSION = 'historical_memory_v3_i6';

// ─── Feature Flag ──────────────────────────────────────────────────────────

let _enabled = true;
export function setHistoricalMemoryEnabled(v: boolean): void { _enabled = v; }
export function isHistoricalMemoryEnabled(): boolean { return _enabled; }

// ─── Helpers ───────────────────────────────────────────────────────────────

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

// ─── Memory Index ──────────────────────────────────────────────────────────
//
// We maintain an in-memory index over historical lineage records. Each record
// is converted to a 7-dimensional feature vector:
//   [carry, inflation, fx_mep, liquidity, risk_sentiment, score, regime_id]
//
// All dimensions are normalized to [0,1] using the union of historical + current.

interface FeatureVector {
  carry: number;
  inflation: number;
  fx: number;
  liquidity: number;
  risk: number;
  score: number;
  // regime encoded as integer index 0..6
  regime_idx: number;
}

const REGIME_TO_IDX: Record<string, number> = {
  EASING: 0, TIGHTENING: 1, HIGH_INFLATION: 2, DISINFLATION: 3,
  CRISIS: 4, RECOVERY: 5, STRESS: 6,
  // Legacy 4-state fallback
  NEUTRAL: 5, STAGFLATION: 4,
};

function extractVector(lineage: {
  market_state: MarketState;
  score: number;
  regime: { regime: string };
  regime_v2?: { regime: string };
}): FeatureVector {
  return {
    carry: lineage.market_state.rates_tna - lineage.market_state.inflation_monthly * 12,
    inflation: lineage.market_state.inflation_monthly,
    fx: lineage.market_state.fx_mep,
    liquidity: lineage.market_state.liquidity_index,
    risk: lineage.market_state.risk_sentiment,
    score: lineage.score,
    regime_idx: REGIME_TO_IDX[lineage.regime_v2?.regime ?? lineage.regime.regime] ?? 0,
  };
}

// ─── Similarity Search (cosine + Euclidean hybrid) ─────────────────────────

function normalize(v: FeatureVector, ranges: Record<keyof FeatureVector, { min: number; max: number }>): Record<keyof FeatureVector, number> {
  const out = {} as Record<keyof FeatureVector, number>;
  for (const key of Object.keys(v) as Array<keyof FeatureVector>) {
    const r = ranges[key];
    const span = r.max - r.min;
    out[key] = span > 1e-6 ? (v[key] - r.min) / span : 0.5;
  }
  return out;
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  const keys = Object.keys(a);
  let dot = 0, magA = 0, magB = 0;
  for (const k of keys) {
    dot += a[k] * b[k];
    magA += a[k] * a[k];
    magB += b[k] * b[k];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 1e-9 ? dot / denom : 0;
}

function euclidean(a: Record<string, number>, b: Record<string, number>): number {
  const keys = Object.keys(a);
  let sum = 0;
  for (const k of keys) {
    sum += (a[k] - b[k]) ** 2;
  }
  return Math.sqrt(sum);
}

// ─── Memory Index Build + Search ───────────────────────────────────────────

function searchSimilar(
  currentVector: FeatureVector,
  topK = 5,
): SimilaritySearchResult[] {
  const lineage = getLineageBuffer();
  const verificationPairs = getVerificationBuffer();

  if (lineage.length === 0) return [];

  // Build all vectors (current + historical)
  const allVectors = lineage.map((l) => extractVector(l));
  allVectors.push(currentVector);

  // Compute ranges
  const keys = Object.keys(currentVector) as Array<keyof FeatureVector>;
  const ranges = {} as Record<keyof FeatureVector, { min: number; max: number }>;
  for (const k of keys) {
    const values = allVectors.map((v) => v[k]);
    ranges[k] = { min: Math.min(...values), max: Math.max(...values) };
  }

  const currentNorm = normalize(currentVector, ranges);

  // Compute similarity for each historical record
  const results: SimilaritySearchResult[] = lineage.map((l, idx) => {
    const v = allVectors[idx];
    const vNorm = normalize(v, ranges);
    const similarity = cosineSimilarity(currentNorm, vNorm);
    const distance = euclidean(currentNorm, vNorm);

    // Per-dimension distance
    const dimension_distances: Record<string, number> = {};
    for (const k of keys) {
      dimension_distances[k] = round(Math.abs(currentNorm[k] - vNorm[k]), 3);
    }

    // Find verification outcome
    const realized = verificationPairs.find((p) => p.timestamp === l.timestamp);
    const realized_return = realized?.realized_return ?? null;
    const was_correct = realized
      ? Math.sign(l.prediction.expected_return) === Math.sign(realized.realized_return)
      : null;

    const record: MemoryRecord = {
      lineage_id: l.lineage_id,
      timestamp: l.timestamp,
      predicted_return: round(l.prediction.expected_return, 6),
      realized_return: realized_return !== null ? round(realized_return, 6) : null,
      was_correct,
      regime: l.regime_v2?.regime ?? l.regime.regime,
      score: l.score,
      action: l.decision,
      confidence: l.confidence?.confidence_score ?? null,
    };

    return {
      record,
      similarity: round(similarity, 3),
      distance: round(distance, 3),
      dimension_distances,
    };
  });

  return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}

// ─── Outcome Statistics ────────────────────────────────────────────────────

function computeOutcomeStats(results: SimilaritySearchResult[]): AnalogOutcomeStats {
  const verified = results.filter((r) => r.record.realized_return !== null);

  if (verified.length === 0) {
    return {
      verified_count: 0,
      mean_predicted: 0,
      mean_realized: 0,
      mean_absolute_error: 0,
      directional_accuracy: 0,
      outcome_distribution: { positive: 0, negative: 0, neutral: 0 },
    };
  }

  const predicted = verified.map((r) => r.record.predicted_return);
  const realized = verified.map((r) => r.record.realized_return!);
  const errors = verified.map((r) => Math.abs(r.record.predicted_return - r.record.realized_return!));
  const correct = verified.filter((r) => r.record.was_correct === true).length;

  const positive = realized.filter((r) => r > 0.001).length;
  const negative = realized.filter((r) => r < -0.001).length;
  const neutral = realized.length - positive - negative;

  return {
    verified_count: verified.length,
    mean_predicted: round(mean(predicted), 6),
    mean_realized: round(mean(realized), 6),
    mean_absolute_error: round(mean(errors), 6),
    directional_accuracy: round(correct / verified.length, 3),
    outcome_distribution: {
      positive,
      negative,
      neutral,
    },
  };
}

// ─── Confidence from Analogs ───────────────────────────────────────────────
//
// Derives a confidence from the analog outcomes. If analogs were mostly
// correct, boost confidence. If they were mostly wrong, reduce confidence.

function computeAnalogConfidence(
  stats: AnalogOutcomeStats,
  meanSimilarity: number,
): ConfidenceFromAnalogs {
  if (stats.verified_count === 0) {
    return {
      analog_confidence: 50,
      adjustment: 0,
      reason: 'no verified analogs available',
      strength: 'INSUFFICIENT',
    };
  }

  // Base confidence = directional accuracy × 100
  const analog_confidence = stats.directional_accuracy * 100;

  // Adjustment relative to the V2 heuristic baseline (50)
  const adjustment = Math.max(-20, Math.min(20, (analog_confidence - 50) * 0.4 * meanSimilarity));

  let strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT';
  if (stats.verified_count >= 5 && meanSimilarity >= 0.8) strength = 'STRONG';
  else if (stats.verified_count >= 3 && meanSimilarity >= 0.6) strength = 'MODERATE';
  else if (stats.verified_count >= 1) strength = 'WEAK';
  else strength = 'INSUFFICIENT';

  const reason = `${stats.verified_count} verified analogs (mean similarity ${meanSimilarity.toFixed(2)}): directional accuracy ${(stats.directional_accuracy * 100).toFixed(0)}%. Adjustment ${adjustment >= 0 ? '+' : ''}${adjustment.toFixed(1)} pts.`;

  return {
    analog_confidence: round(analog_confidence, 1),
    adjustment: round(adjustment, 1),
    reason,
    strength,
  };
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export interface HistoricalMemoryInput {
  score: AssetScore;
  features: NormalizedFeatures;
  market_state: MarketState;
  topK?: number;
}

export function recallHistoricalMemory(input: HistoricalMemoryInput): HistoricalMemoryReport {
  const topK = input.topK ?? 5;

  // Build current feature vector
  const currentVector: FeatureVector = {
    carry: input.market_state.rates_tna - input.market_state.inflation_monthly * 12,
    inflation: input.market_state.inflation_monthly,
    fx: input.market_state.fx_mep,
    liquidity: input.market_state.liquidity_index,
    risk: input.market_state.risk_sentiment,
    score: input.score.score,
    regime_idx: REGIME_TO_IDX[input.score.regime.regime] ?? 0,
  };

  const nearest_states = searchSimilar(currentVector, topK);
  const outcome_stats = computeOutcomeStats(nearest_states);
  const mean_similarity = nearest_states.length > 0
    ? mean(nearest_states.map((r) => r.similarity))
    : 0;
  const analog_confidence = computeAnalogConfidence(outcome_stats, mean_similarity);

  return {
    nearest_states,
    memory_size: getLineageBuffer().length,
    outcome_stats,
    analog_confidence,
    mean_similarity: round(mean_similarity, 3),
    computed_at: new Date().toISOString(),
    engine_version: HISTORICAL_MEMORY_VERSION,
    enabled: _enabled,
  };
}
