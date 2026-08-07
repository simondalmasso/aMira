// src/lib/oracle/v3/index.ts
// ============================================================================
// V3 ORCHESTRATOR — Single entry point for the V3 Intelligence Layers (I1-I10)
// ============================================================================
// MISSION:
//   Compose the V3 layers (I1-I10) into a single `V3IntelligenceReport` that
//   EXTENDS (does not replace) the V2 Systemic Robustness Layers.
//
// ARCHITECTURE (per ABSOLUTE_RULES):
//   - Append-only: the response from /api/oracle/single keeps its V1 + V2
//     shape and gains a `v3` field with this V3IntelligenceReport.
//   - Backward compatible: existing consumers continue to work; they just
//     ignore the new `v3` field if they don't read it.
//   - Single Oracle: the orchestrator READS from runV2SystemicEnrichment
//     (canonical V1+V2) and ENRICHES it. It does NOT introduce a new engine.
//   - Feature-flaggable: each V3 layer can be individually toggled off.
//
// EXECUTION FLOW:
//   1. Run V2 enrichment (V1 canonical + V2 R1-R10) → v1, v2 reports
//   2. For the primary asset (SAN):
//      a. I1 computeConformalConfidence     (over V2 R1)
//      b. I2 detectStructuralRegime         (over V2 R2)
//      c. I3 computeCalibration             (over V2 R4)
//      d. I4 arbitrateModels                (over V2 R10 advisors)
//      e. I5 computeEvidence                (over V2 R3 + R6)
//      f. I6 recallHistoricalMemory         (over V2 R6)
//      g. I7 diagnoseSelf                   (over V2 R6 + R7)
//      h. I8 runCounterfactuals             (over V1 single-pass)
//      i. I9 validateInstitutionally        (over V1 + V2)
//      j. I10 buildKnowledgeGraph           (over V1 + V2)
//   3. Compose the V3IntelligenceReport.
//
// ANTI-FRANKENSTEIN:
//   - ONE orchestrator, ONE entry point, ONE V3 report.
//   - Does NOT duplicate any V1 or V2 pipeline.
// ============================================================================

import type { AssetScoreVector, AssetScore, AssetPrediction } from '@/lib/single-pass-oracle-engine';
import {
  buildMarketState,
  normalizeFeatures,
  type MarketState,
  type MarketStateInput,
  type NormalizedFeatures,
} from '@/lib/single-market-state';
import { runV2SystemicEnrichment, type V2SystemicReport } from '@/lib/oracle/v2';

import { computeConformalConfidence, type ConformalConfidenceReport } from './conformal-confidence';
import { detectStructuralRegime, type StructuralRegimeReport } from './structural-regime-detector';
import { computeCalibration, type CalibrationReport } from './calibration-engine';
import { arbitrateModels, type ArbitrationResult } from './model-arbitration';
import { computeEvidence, type EvidenceReport } from './evidence-engine';
import { recallHistoricalMemory, type HistoricalMemoryReport } from './historical-memory';
import { diagnoseSelf, type SelfDiagnosisReport } from './self-diagnosis';
import { runCounterfactuals, type CounterfactualReport } from './counterfactual-engine';
import { validateInstitutionally, type InstitutionalValidationReport } from './institutional-validation';
import { buildKnowledgeGraph, type KnowledgeGraphReport } from './knowledge-graph';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface V3IntelligenceReport {
  /** V3 layer version */
  version: string;
  /** ISO-8601 timestamp of the V3 enrichment */
  computed_at: string;
  /** Oracle engine version (V1) */
  oracle_version: string;
  /** V2 layer version */
  v2_version: string;
  /** I1 — Conformal Confidence Engine */
  conformal: ConformalConfidenceReport;
  /** I2 — Structural Regime Detector */
  structural_regime: StructuralRegimeReport;
  /** I3 — Prediction Calibration Engine */
  calibration: CalibrationReport;
  /** I4 — Model Arbitration */
  arbitration: ArbitrationResult;
  /** I5 — Evidence Engine */
  evidence: EvidenceReport;
  /** I6 — Historical Memory */
  historical_memory: HistoricalMemoryReport;
  /** I7 — Self Diagnosis */
  self_diagnosis: SelfDiagnosisReport;
  /** I8 — Counterfactual Engine */
  counterfactual: CounterfactualReport;
  /** I9 — Institutional Validation */
  validation: InstitutionalValidationReport;
  /** I10 — Knowledge Graph */
  knowledge_graph: KnowledgeGraphReport;
  /** Composite institutional verdict */
  composite_verdict: 'TRUSTWORTHY' | 'TRUSTWORTHY_WITH_CAVEATS' | 'DEGRADED' | 'UNTRUSTWORTHY';
  /** Composite confidence (0..100) */
  composite_confidence: number;
  /** Composite narrative */
  narrative: string;
}

export const V3_ORCHESTRATOR_VERSION = 'v3_intelligence_orchestrator_i1_to_i10';

// ─── Helper: composite verdict ─────────────────────────────────────────────

function computeCompositeVerdict(
  validation: InstitutionalValidationReport,
  selfDiagnosis: SelfDiagnosisReport,
  calibration: CalibrationReport,
): { verdict: V3IntelligenceReport['composite_verdict']; confidence: number; narrative: string } {
  let confidence = 50;

  // Adjust confidence based on validation verdict
  if (validation.verdict === 'APPROVED') confidence += 15;
  else if (validation.verdict === 'APPROVED_WITH_WARNINGS') confidence += 0;
  else confidence -= 25;  // REJECTED

  // Adjust based on self-diagnosis
  if (selfDiagnosis.composite_status === 'healthy') confidence += 10;
  else if (selfDiagnosis.composite_status === 'watch') confidence += 0;
  else if (selfDiagnosis.composite_status === 'degraded') confidence -= 15;
  else confidence -= 30;  // critical

  // Adjust based on calibration diagnosis
  if (calibration.diagnosis === 'WELL_CALIBRATED') confidence += 10;
  else if (calibration.diagnosis === 'INSUFFICIENT_DATA') confidence += 0;
  else if (calibration.diagnosis === 'OVERCONFIDENT' || calibration.diagnosis === 'UNDERCONFIDENT') confidence -= 10;
  else if (calibration.diagnosis === 'BIASED') confidence -= 20;

  confidence = Math.max(0, Math.min(100, confidence));

  let verdict: V3IntelligenceReport['composite_verdict'];
  if (validation.verdict === 'REJECTED' || selfDiagnosis.composite_status === 'critical') {
    verdict = 'UNTRUSTWORTHY';
  } else if (validation.verdict === 'APPROVED_WITH_WARNINGS' || selfDiagnosis.composite_status === 'degraded' || calibration.diagnosis === 'BIASED') {
    verdict = 'DEGRADED';
  } else if (selfDiagnosis.composite_status === 'watch' || calibration.diagnosis === 'OVERCONFIDENT' || calibration.diagnosis === 'UNDERCONFIDENT') {
    verdict = 'TRUSTWORTHY_WITH_CAVEATS';
  } else {
    verdict = 'TRUSTWORTHY';
  }

  const narrative = `Verdict ${verdict} (confidence ${confidence.toFixed(0)}/100). ` +
    `Validation: ${validation.verdict} (${validation.pass_rate * 100 | 0}% checks pass). ` +
    `Self-diagnosis: ${selfDiagnosis.composite_status} (composite ${selfDiagnosis.composite_health.toFixed(0)}/100). ` +
    `Calibration: ${calibration.diagnosis} (ECE=${calibration.metrics.ece.toFixed(3)}, bias=${(calibration.metrics.bias * 100).toFixed(2)}%).`;

  return { verdict, confidence: Math.round(confidence * 10) / 10, narrative };
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export async function runV3IntelligenceEnrichment(
  input: MarketStateInput,
  v1Vector?: AssetScoreVector,
): Promise<{
  v1: AssetScoreVector;
  v2: V2SystemicReport;
  v3: V3IntelligenceReport | null;
}> {
  // 1. Run V1 + V2 enrichment (canonical pipeline)
  const { v1, v2 } = await runV2SystemicEnrichment(input, v1Vector);

  // Get the primary asset without assuming a non-empty score/enrichment array.
  const sanScore: AssetScore | null = v1.scores.find((score) => score.asset === 'SAN') ?? null;
  const v2Asset = v2.assets.find((asset) => asset.asset === 'SAN') ?? null;
  if (sanScore === null || v2Asset === null) {
    return { v1, v2, v3: null };
  }
  const prediction: AssetPrediction = sanScore.prediction;

  // Re-build MarketState + features (V2 modules consumed them; we need them here too)
  const market_state: MarketState = buildMarketState(input);
  const features: NormalizedFeatures = normalizeFeatures(market_state);

  const v2_confidence = v2Asset.confidence;
  const v2_regime = v2Asset.regime_v2;
  const v2_explanation = v2Asset.explanation;

  // 2. Run all V3 layers
  const conformal = computeConformalConfidence({
    score: sanScore,
    prediction,
    features,
    market_state,
    v2_confidence,
  });

  const structural_regime = detectStructuralRegime({
    features,
    market_state,
    v2_regime,
  });

  const calibration = computeCalibration({
    prediction,
    v2_confidence,
  });

  const arbitration = arbitrateModels({
    oracle_score: sanScore,
    prediction,
    v2_advisors: v2.advisors,
    market_state,
  });

  const evidence = computeEvidence({
    score: sanScore,
    features,
    market_state,
    explanation: v2_explanation,
    v2_regime,
  });

  const historical_memory = recallHistoricalMemory({
    score: sanScore,
    features,
    market_state,
  });

  const self_diagnosis = diagnoseSelf({
    score: sanScore,
    features,
    market_state,
    v2_health: v2.health,
  });

  const counterfactual = runCounterfactuals({
    baseline_input: input,
    baseline_score: sanScore,
  });

  const validation = validateInstitutionally({
    score: sanScore,
    prediction,
    features,
    market_state,
    v2_confidence,
    v2_regime,
    v2_explanation,
  });

  const knowledge_graph = buildKnowledgeGraph({
    score: sanScore,
    prediction,
    features,
    market_state,
    v2_confidence,
    v2_regime,
    v2_explanation,
  });

  // 3. Composite verdict
  const composite = computeCompositeVerdict(validation, self_diagnosis, calibration);

  const v3: V3IntelligenceReport = {
    version: V3_ORCHESTRATOR_VERSION,
    computed_at: new Date().toISOString(),
    oracle_version: v1.model_version,
    v2_version: v2.version,
    conformal,
    structural_regime,
    calibration,
    arbitration,
    evidence,
    historical_memory,
    self_diagnosis,
    counterfactual,
    validation,
    knowledge_graph,
    composite_verdict: composite.verdict,
    composite_confidence: composite.confidence,
    narrative: composite.narrative,
  };

  return { v1, v2, v3 };
}

// ─── Re-exports for convenience ────────────────────────────────────────────

export * from './conformal-confidence';
export * from './structural-regime-detector';
export * from './calibration-engine';
export * from './model-arbitration';
export * from './evidence-engine';
export * from './historical-memory';
export * from './self-diagnosis';
export * from './counterfactual-engine';
export * from './institutional-validation';
export * from './knowledge-graph';
