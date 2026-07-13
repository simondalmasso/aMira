// src/lib/oracle/v3/evidence-engine.ts
// ============================================================================
// I5 — EVIDENCE ENGINE (append-only)
// ============================================================================
// MISSION (per ORACLE_V3_INTELLIGENCE_LAYER spec, I5):
//   "Cada recomendación debe mostrar evidencia cuantitativa."
//
// OUTPUT:
//   - Qué factores aportaron (positive contributors with weight + magnitude)
//   - Qué factores restaron (negative contributors)
//   - Qué evidencia histórica existe (analog predictions from lineage)
//   - Qué predicciones similares ocurrieron (k-nearest neighbors in feature space)
//   - Nivel de evidencia (composite 0..100)
//
// DESIGN:
//   - Builds on V2 R3 (explainer) — reuses its factor attribution.
//   - Adds historical evidence from V2 R6 lineage buffer.
//   - Computes a composite "evidence level" that combines:
//       (a) factor agreement strength
//       (b) historical analog support
//       (c) sample size of analogs
//       (d) outcome consistency of analogs
//
// ANTI-FRANKENSTEIN:
//   - Does NOT modify V2 R3.
//   - Reads from V2 R6 lineage (single source of truth).
// ============================================================================

import type { AssetScore } from '@/lib/single-pass-oracle-engine';
import type { NormalizedFeatures, MarketState } from '@/lib/single-market-state';
import type { DecisionExplanation } from '@/lib/oracle/v2/explainer';
import type { RegimeV2Classification } from '@/lib/oracle/v2/regime-detector-v2';
import { getLineageBuffer } from '@/lib/oracle/v2/lineage';
import { getVerificationBuffer } from '@/lib/oracle/v2/forecast-verifier';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface FactorEvidence {
  /** Factor key */
  factor: string;
  /** Direction of contribution */
  direction: 'positive' | 'negative' | 'neutral';
  /** Magnitude of contribution */
  magnitude: number;
  /** Historical success rate when this factor had the same direction (0..1) */
  historical_success_rate: number;
  /** Number of historical analogs evaluated */
  sample_size: number;
  /** Strength of evidence: 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT' */
  evidence_strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT';
  /** Human-readable summary */
  summary: string;
}

export interface HistoricalAnalog {
  /** Lineage ID of the analog */
  lineage_id: string;
  /** Timestamp of the analog prediction */
  timestamp: string;
  /** Similarity score (0..1, higher = more similar) */
  similarity: number;
  /** Predicted expected_return at the time */
  predicted_return: number;
  /** Realized return (if verified, else null) */
  realized_return: number | null;
  /** Whether the prediction was directionally correct */
  was_correct: boolean | null;
  /** Regime at the time */
  regime: string;
  /** Distance vector in feature space */
  distance: {
    carry: number;
    inflation: number;
    fx: number;
    liquidity: number;
    risk: number;
    total: number;
  };
}

export interface EvidenceReport {
  /** Factor-level evidence (positive + negative) */
  factor_evidence: {
    positive: FactorEvidence[];
    negative: FactorEvidence[];
  };
  /** Historical analogs (sorted by similarity desc) */
  historical_analogs: HistoricalAnalog[];
  /** Number of analogs found */
  analog_count: number;
  /** Outcome consistency: fraction of analogs that had the same direction as the prediction */
  outcome_consistency: number;
  /** Composite evidence level 0..100 (higher = stronger evidence base) */
  evidence_level: number;
  /** Evidence grade: 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT' */
  evidence_grade: 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT';
  /** Narrative summary */
  narrative: string;
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
  /** Feature flag */
  enabled: boolean;
}

export const EVIDENCE_ENGINE_VERSION = 'evidence_engine_v3_i5';

// ─── Feature Flag ──────────────────────────────────────────────────────────

let _enabled = true;
export function setEvidenceEngineEnabled(v: boolean): void { _enabled = v; }
export function isEvidenceEngineEnabled(): boolean { return _enabled; }

// ─── Helpers ───────────────────────────────────────────────────────────────

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

// ─── Feature Vector Extraction ─────────────────────────────────────────────
//
// Builds a 5-dimensional feature vector from a lineage record. Used for
// k-nearest-neighbor search in historical memory.

function extractFeatureVector(lineage: {
  market_state: MarketState;
  weights: import('@/lib/linear-factor-model').LinearFactorWeights;
}): { carry: number; inflation: number; fx: number; liquidity: number; risk: number } {
  return {
    carry: lineage.market_state.rates_tna - lineage.market_state.inflation_monthly * 12,
    inflation: lineage.market_state.inflation_monthly,
    fx: lineage.market_state.fx_mep,
    liquidity: lineage.market_state.liquidity_index,
    risk: lineage.market_state.risk_sentiment,
  };
}

// ─── Historical Analog Search ──────────────────────────────────────────────
//
// Computes Euclidean distance in feature space between the current prediction
// and each historical lineage record. Returns the top K most similar records
// (with their outcomes if verified).

function findHistoricalAnalogs(
  features: NormalizedFeatures,
  market_state: MarketState,
  topK = 5,
): HistoricalAnalog[] {
  const lineage = getLineageBuffer();
  const verificationPairs = getVerificationBuffer();

  // Build the current feature vector (using same proxy extraction as health-monitor)
  const currentVector = {
    carry: market_state.rates_tna - market_state.inflation_monthly * 12,
    inflation: market_state.inflation_monthly,
    fx: market_state.fx_mep,
    liquidity: market_state.liquidity_index,
    risk: market_state.risk_sentiment,
  };

  // Normalize each dimension to [0,1] using min/max across the lineage + current
  const allRecords = lineage.map((l) => extractFeatureVector(l));
  allRecords.push(currentVector);

  const minMax = (key: keyof typeof currentVector) => {
    const values = allRecords.map((r) => r[key]);
    return { min: Math.min(...values), max: Math.max(...values) };
  };

  const ranges = {
    carry: minMax('carry'),
    inflation: minMax('inflation'),
    fx: minMax('fx'),
    liquidity: minMax('liquidity'),
    risk: minMax('risk'),
  };

  const normalize = (v: number, range: { min: number; max: number }) => {
    const span = range.max - range.min;
    return span > 1e-6 ? (v - range.min) / span : 0.5;
  };

  const currentNorm = {
    carry: normalize(currentVector.carry, ranges.carry),
    inflation: normalize(currentVector.inflation, ranges.inflation),
    fx: normalize(currentVector.fx, ranges.fx),
    liquidity: normalize(currentVector.liquidity, ranges.liquidity),
    risk: normalize(currentVector.risk, ranges.risk),
  };

  // Compute distances
  const analogs: HistoricalAnalog[] = lineage.map((l) => {
    const v = extractFeatureVector(l);
    const vNorm = {
      carry: normalize(v.carry, ranges.carry),
      inflation: normalize(v.inflation, ranges.inflation),
      fx: normalize(v.fx, ranges.fx),
      liquidity: normalize(v.liquidity, ranges.liquidity),
      risk: normalize(v.risk, ranges.risk),
    };

    const dist = {
      carry: Math.abs(vNorm.carry - currentNorm.carry),
      inflation: Math.abs(vNorm.inflation - currentNorm.inflation),
      fx: Math.abs(vNorm.fx - currentNorm.fx),
      liquidity: Math.abs(vNorm.liquidity - currentNorm.liquidity),
      risk: Math.abs(vNorm.risk - currentNorm.risk),
    };
    const total = Math.sqrt(
      dist.carry ** 2 + dist.inflation ** 2 + dist.fx ** 2 + dist.liquidity ** 2 + dist.risk ** 2,
    );

    // Similarity = 1 - normalized distance (max distance in 5D unit cube = sqrt(5))
    const similarity = Math.max(0, 1 - total / Math.sqrt(5));

    // Find verification outcome for this lineage (by prediction_id proxy)
    const realized = verificationPairs.find((p) =>
      p.timestamp === l.timestamp || Math.abs(p.expected_return - l.prediction.expected_return) < 1e-6,
    );

    const realized_return = realized?.realized_return ?? null;
    const was_correct = realized
      ? Math.sign(l.prediction.expected_return) === Math.sign(realized.realized_return)
      : null;

    return {
      lineage_id: l.lineage_id,
      timestamp: l.timestamp,
      similarity: round(similarity, 3),
      predicted_return: round(l.prediction.expected_return, 6),
      realized_return: realized_return !== null ? round(realized_return, 6) : null,
      was_correct,
      regime: l.regime_v2?.regime ?? l.regime.regime,
      distance: {
        carry: round(dist.carry, 3),
        inflation: round(dist.inflation, 3),
        fx: round(dist.fx, 3),
        liquidity: round(dist.liquidity, 3),
        risk: round(dist.risk, 3),
        total: round(total, 3),
      },
    };
  });

  // Sort by similarity desc, take top K
  return analogs.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}

// ─── Factor Evidence Construction ──────────────────────────────────────────
//
// For each factor in the V2 R3 explanation, compute historical success rate
// (when this factor had the same direction in the past, was the prediction correct?).

function buildFactorEvidence(
  explanation: DecisionExplanation,
  features: NormalizedFeatures,
): { positive: FactorEvidence[]; negative: FactorEvidence[] } {
  const lineage = getLineageBuffer();
  const verificationPairs = getVerificationBuffer();

  const allFactors = [
    ...explanation.top_positive_factors,
    ...explanation.top_negative_factors,
  ];

  const featureMap: Record<string, number> = {
    carry: features.carry,
    inflation_hedge: features.inflation_hedge,
    fx_momentum: features.fx_momentum,
    liquidity: features.liquidity,
    risk_penalty: features.risk_penalty,
  };

  const buildEvidence = (factor: string, contribution: number, direction: 'positive' | 'negative'): FactorEvidence => {
    const currentValue = featureMap[factor] ?? 0;
    const currentSign = Math.sign(currentValue);

    // Find historical lineage records where this factor had the same sign
    const analogs = lineage.filter((l) => {
      // Re-derive the factor value from the lineage market_state
      const state = l.market_state;
      let v: number;
      switch (factor) {
        case 'carry': v = state.rates_tna - state.inflation_monthly * 12; break;
        case 'inflation_hedge': v = state.inflation_monthly; break;
        case 'fx_momentum': v = -state.risk_sentiment; break;
        case 'liquidity': v = state.liquidity_index; break;
        case 'risk_penalty': v = -state.risk_sentiment; break;
        default: v = 0;
      }
      return Math.sign(v) === currentSign && Math.abs(v) > 0.01;
    });

    // Check verification outcomes for these analogs
    const verified = analogs
      .map((a) => verificationPairs.find((p) => p.timestamp === a.timestamp))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);

    const correctCount = verified.filter((p) => Math.sign(p.expected_return) === Math.sign(p.realized_return)).length;
    const success_rate = verified.length > 0 ? correctCount / verified.length : 0;
    const sample_size = verified.length;

    let evidence_strength: FactorEvidence['evidence_strength'];
    if (sample_size === 0) evidence_strength = 'INSUFFICIENT';
    else if (sample_size >= 10 && (success_rate >= 0.7 || success_rate <= 0.3)) evidence_strength = 'STRONG';
    else if (sample_size >= 5 && (success_rate >= 0.6 || success_rate <= 0.4)) evidence_strength = 'MODERATE';
    else evidence_strength = 'WEAK';

    const magnitude = Math.abs(contribution);
    const summary = `${factor}=${currentValue.toFixed(3)} (${direction}). ${sample_size} historical analogs with same sign: ${correctCount}/${sample_size} correct (${(success_rate * 100).toFixed(0)}% success rate).`;

    return {
      factor,
      direction,
      magnitude: round(magnitude, 6),
      historical_success_rate: round(success_rate, 3),
      sample_size,
      evidence_strength,
      summary,
    };
  };

  const positive: FactorEvidence[] = explanation.top_positive_factors.map((f) =>
    buildEvidence(f.factor, f.contribution, 'positive'),
  );

  const negative: FactorEvidence[] = explanation.top_negative_factors.map((f) =>
    buildEvidence(f.factor, f.contribution, 'negative'),
  );

  return { positive, negative };
}

// ─── Composite Evidence Level ──────────────────────────────────────────────
//
// Combines:
//   (a) factor agreement: average historical_success_rate weighted by magnitude
//   (b) analog support: number of analogs × mean similarity
//   (c) outcome consistency: fraction of analogs that had the same direction

function computeEvidenceLevel(
  factorEvidence: { positive: FactorEvidence[]; negative: FactorEvidence[] },
  analogs: HistoricalAnalog[],
  prediction: AssetScore['prediction'],
): { level: number; grade: 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT'; consistency: number; narrative: string } {
  // (a) Factor agreement
  const allFactors = [...factorEvidence.positive, ...factorEvidence.negative].filter((f) => f.sample_size > 0);
  const totalMagnitude = allFactors.reduce((s, f) => s + f.magnitude, 0);
  const weightedSuccess = allFactors.reduce((s, f) => s + f.historical_success_rate * f.magnitude, 0);
  const factorScore = totalMagnitude > 0 ? (weightedSuccess / totalMagnitude) * 100 : 50;

  // (b) Analog support
  const analogSupport = analogs.length > 0
    ? Math.min(100, (analogs.length / 5) * 20 + mean(analogs.map((a) => a.similarity)) * 50)
    : 0;

  // (c) Outcome consistency
  const verified = analogs.filter((a) => a.was_correct !== null);
  const consistency = verified.length > 0
    ? verified.filter((a) => a.was_correct === true).length / verified.length
    : 0.5;

  const consistencyScore = consistency * 100;

  // Composite
  const level = (factorScore * 0.4 + analogSupport * 0.3 + consistencyScore * 0.3);

  let grade: 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT';
  if (analogs.length === 0) grade = 'INSUFFICIENT';
  else if (level >= 70) grade = 'STRONG';
  else if (level >= 50) grade = 'MODERATE';
  else grade = 'WEAK';

  const narrative = `Evidencia ${grade.toLowerCase()}: ${analogs.length} analogs históricos, consistencia ${(consistency * 100).toFixed(0)}%, factor score ${factorScore.toFixed(0)}/100. ` +
    `Predicted return ${(prediction.expected_return * 100).toFixed(2)}% con ${allFactors.length} factores con evidencia histórica.`;

  return {
    level: round(level, 1),
    grade,
    consistency: round(consistency, 3),
    narrative,
  };
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export interface EvidenceEngineInput {
  score: AssetScore;
  features: NormalizedFeatures;
  market_state: MarketState;
  explanation: DecisionExplanation;
  v2_regime: RegimeV2Classification;
}

export function computeEvidence(input: EvidenceEngineInput): EvidenceReport {
  const factorEvidence = buildFactorEvidence(input.explanation, input.features);
  const historical_analogs = findHistoricalAnalogs(input.features, input.market_state, 5);
  const composite = computeEvidenceLevel(factorEvidence, historical_analogs, input.score.prediction);

  return {
    factor_evidence: factorEvidence,
    historical_analogs,
    analog_count: historical_analogs.length,
    outcome_consistency: composite.consistency,
    evidence_level: composite.level,
    evidence_grade: composite.grade,
    narrative: composite.narrative,
    computed_at: new Date().toISOString(),
    engine_version: EVIDENCE_ENGINE_VERSION,
    enabled: _enabled,
  };
}
