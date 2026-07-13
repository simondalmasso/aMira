// src/lib/oracle/v2/index.ts
// ============================================================================
// V2 ORCHESTRATOR — Single entry point for the V2 Systemic Robustness Layers
// ============================================================================
// MISSION:
//   Compose the V2 layers (R1-R10) into a single `V2SystemicReport` that
//   EXTENDS (does not replace) the canonical AssetScoreVector from
//   single-pass-oracle-engine.
//
// ARCHITECTURE (per ABSOLUTE_RULES):
//   - Append-only: the response from /api/oracle/single keeps its V1 shape
//     and gains a `v2` field with this V2SystemicReport.
//   - Backward compatible: existing consumers continue to work; they just
//     ignore the new `v2` field if they don't read it.
//   - Single Oracle: the orchestrator READS from runSinglePass (canonical)
//     and ENRICHES it. It does NOT introduce a second prediction model.
//   - No new global state: all V2 modules are stateless or use bounded
//     in-memory ring buffers (R4/R5/R6/R7/R9) which are clearly documented.
//
// EXECUTION FLOW:
//   1. Run canonical single-pass engine → AssetScoreVector (V1, unchanged)
//   2. For each asset in the vector:
//      a. computeConfidenceLayer        (R1)
//      b. detectRegimeV2                (R2)
//      c. explainDecision               (R3)
//      d. buildLineage + recordLineage  (R6)
//      e. recordDecision (audit)        (R9)
//   3. Compute system-wide layers:
//      a. computeForecastVerification   (R4)
//      b. getAdaptiveWeightState        (R5)
//      c. computeOracleHealth           (R7)
//      d. runScenarioSweep              (R8)
//      e. runAdvisors                   (R10) — async
//
// ANTI-FRANKENSTEIN:
//   - ONE orchestrator, ONE entry point, ONE V2 report.
//   - Does NOT duplicate any V1 pipeline.
// ============================================================================

import { runSinglePass, type AssetScoreVector, type AssetScore } from '@/lib/single-pass-oracle-engine';
import {
  buildMarketState,
  normalizeFeatures,
  type MarketState,
  type MarketStateInput,
  type NormalizedFeatures,
} from '@/lib/single-market-state';
import { MODEL_VERSION, getActiveWeights } from '@/lib/linear-factor-model';

import { computeConfidenceLayer, type ConfidenceLayer } from './confidence-engine';
import { detectRegimeV2, type RegimeV2Classification } from './regime-detector-v2';
import { explainDecision, type DecisionExplanation } from './explainer';
import { computeForecastVerification, type ForecastVerificationReport } from './forecast-verifier';
import { getAdaptiveWeightState, type AdaptiveWeightState } from './adaptive-weights';
import { buildLineage, recordLineage, type PredictionLineage } from './lineage';
import { computeOracleHealth, type OracleHealthReport } from './health-monitor';
import { runScenarioSweep, type ScenarioReport } from './scenario-engine';
import { recordDecision, type AuditEntry } from './audit-trail';
import { runAdvisors, type AdvisorReport } from './foundation-model-adapter';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface V2AssetEnrichment {
  asset: string;
  confidence: ConfidenceLayer;
  regime_v2: RegimeV2Classification;
  explanation: DecisionExplanation;
  lineage: PredictionLineage;
  audit: AuditEntry;
}

export interface V2SystemicReport {
  /** V2 layer version */
  version: string;
  /** ISO-8601 timestamp of the V2 enrichment */
  computed_at: string;
  /** Oracle engine version that produced the V1 vector */
  oracle_version: string;
  /** Linear factor model version */
  model_version: string;
  /** Per-asset V2 enrichments (keyed by asset id) */
  assets: V2AssetEnrichment[];
  /** R4 — Forecast verification report */
  verification: ForecastVerificationReport;
  /** R5 — Adaptive weight engine state */
  adaptive_weights: AdaptiveWeightState;
  /** R7 — Oracle health report */
  health: OracleHealthReport;
  /** R8 — Scenario sweep */
  scenarios: ScenarioReport;
  /** R10 — Foundation model advisor report */
  advisors: AdvisorReport;
  /** V1 vector (canonical, unchanged) — included for convenience */
  vector: AssetScoreVector;
}

export const V2_ORCHESTRATOR_VERSION = 'v2_systemic_orchestrator_r1_to_r10';

// ─── Internal: enrich a single AssetScore ──────────────────────────────────

function enrichAsset(
  score: AssetScore,
  market_state: MarketState,
  features: NormalizedFeatures,
  input: MarketStateInput,
): V2AssetEnrichment {
  // R1 — Confidence Layer
  const confidence = computeConfidenceLayer(score, features, market_state);

  // R2 — Regime V2 (7-state)
  const regime_v2 = detectRegimeV2(features, market_state);

  // R3 — Decision Explainability
  const explanation = explainDecision(score, features, market_state);

  // R6 — Prediction Lineage
  const lineage = buildLineage({
    asset: score.asset,
    oracle_version: V2_ORCHESTRATOR_VERSION,
    model_version: MODEL_VERSION,
    input,
    market_state,
    score,
    weights: score.breakdown.weights,
    confidence,
    regime_v2,
    explanation,
  });
  recordLineage(lineage);

  // R9 — Audit Trail
  const audit = recordDecision({
    oracle_version: V2_ORCHESTRATOR_VERSION,
    weights_version: MODEL_VERSION,
    asset: score.asset,
    market_state,
    score,
    confidence: confidence.confidence_score,
    lineage_id: lineage.lineage_id,
    prediction_hash: lineage.prediction_hash,
  });

  return {
    asset: score.asset,
    confidence,
    regime_v2,
    explanation,
    lineage,
    audit,
  };
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export async function runV2SystemicEnrichment(
  input: MarketStateInput,
  v1Vector?: AssetScoreVector,
): Promise<{ v1: AssetScoreVector; v2: V2SystemicReport }> {
  // 1. Run V1 canonical engine (or accept pre-computed vector)
  const v1 = v1Vector ?? runSinglePass(input);

  // 2. Build MarketState + features (re-derive for V2 modules — pure functions)
  const market_state = buildMarketState(input);
  const features = normalizeFeatures(market_state);

  // 3. Per-asset enrichment
  const assets: V2AssetEnrichment[] = v1.scores.map((score) =>
    enrichAsset(score, market_state, features, input),
  );

  // 4. System-wide layers
  const verification = computeForecastVerification();
  const adaptive_weights = getAdaptiveWeightState();
  const health = computeOracleHealth();

  // R8 — Scenario sweep (uses canonical engine internally)
  const scenarios = runScenarioSweep(input);

  // R10 — Foundation model advisors (async)
  const sanScore = v1.scores[0];
  const advisors = await runAdvisors({
    market_state,
    oracle_forecast: {
      expected_return: sanScore.prediction.expected_return,
      confidence: sanScore.prediction.confidence,
    },
  });

  const v2: V2SystemicReport = {
    version: V2_ORCHESTRATOR_VERSION,
    computed_at: new Date().toISOString(),
    oracle_version: V2_ORCHESTRATOR_VERSION,
    model_version: MODEL_VERSION,
    assets,
    verification,
    adaptive_weights,
    health,
    scenarios,
    advisors,
    vector: v1,
  };

  return { v1, v2 };
}

// ─── Re-exports for convenience ────────────────────────────────────────────

export * from './confidence-engine';
export * from './regime-detector-v2';
export * from './explainer';
export * from './forecast-verifier';
export * from './adaptive-weights';
export * from './lineage';
export * from './health-monitor';
export * from './scenario-engine';
export * from './audit-trail';
export * from './foundation-model-adapter';

// Active weights re-export (for V2 consumers who want the canonical source)
export { getActiveWeights, DEFAULT_WEIGHTS } from '@/lib/linear-factor-model';
