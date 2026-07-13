// src/lib/oracle/v2/explainer.ts
// ============================================================================
// R3 — DECISION EXPLAINABILITY (append-only)
// ============================================================================
// MISSION (per ORACLE_V2_SYSTEMIC_ROBUSTNESS spec, R3):
//   "Toda decisión debe poder explicarse."
//
// OUTPUT:
//   top_positive_factors : top 5 factors pushing the score UP
//   top_negative_factors : top 5 factors pushing the score DOWN
//   factor_weights       : the actual weights used at decision time
//   reasoning_summary    : human-readable paragraph
//
// DESIGN:
//   - Pure function, no side effects.
//   - Consumes the canonical AssetScore + NormalizedFeatures + MarketState.
//   - Does NOT modify the score. Does NOT introduce a new model.
//   - The 5 factor contributions come from ScoreBreakdown.contributions.
//   - The "decision" being explained is the AssetScore.action signal.
// ============================================================================

import type { NormalizedFeatures, MarketState } from '@/lib/single-market-state';
import type { AssetScore } from '@/lib/single-pass-oracle-engine';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface FactorExplanation {
  /** Factor key (e.g. "carry", "fx_momentum") */
  factor: string;
  /** Human-readable label in Spanish */
  label: string;
  /** Normalized feature value (-1..1) */
  feature_value: number;
  /** Weight applied (from ScoreBreakdown.weights) */
  weight: number;
  /** Contribution = feature_value * weight */
  contribution: number;
  /** Direction of contribution */
  direction: 'positive' | 'negative' | 'neutral';
  /** Why this factor matters in the current regime */
  rationale: string;
}

export interface DecisionExplanation {
  /** Decision being explained (e.g. "rebalance_signal") */
  decision: string;
  /** Top 5 factors pushing the score UP (sorted by |contribution| desc) */
  top_positive_factors: FactorExplanation[];
  /** Top 5 factors pushing the score DOWN (sorted by |contribution| desc) */
  top_negative_factors: FactorExplanation[];
  /** Weights used at decision time */
  factor_weights: Record<string, number>;
  /** Composite narrative */
  reasoning_summary: string;
  /** ISO-8601 timestamp */
  computed_at: string;
  /** Explainer version */
  explainer_version: string;
}

export const EXPLAINER_VERSION = 'explainer_v2_r3';

// ─── Factor Metadata (labels + rationales per regime) ──────────────────────

const FACTOR_LABELS: Record<string, string> = {
  carry: 'Carry real (TNA − inflación anualizada)',
  inflation_hedge: 'Cobertura inflacionaria',
  fx_momentum: 'Momentum cambiario (presión devaluación)',
  liquidity: 'Liquidez de mercado',
  risk_penalty: 'Penalización por riesgo',
};

const FACTOR_RATIONALES: Record<string, string> = {
  carry: 'Aporta retorno real cuando la tasa supera la inflación. Crucial para activos de renta fija.',
  inflation_hedge: 'Beneficia activos atados a inflación (CER, dólares) cuando la inflación acelera.',
  fx_momentum: 'Presión devaluación beneficia activos USD-perfectos (cedears, MEP).',
  liquidity: 'Mayor liquidez reduce el costo de transacción y mejora la ejecución.',
  risk_penalty: 'Reduce el score cuando el sentimiento es risk-off y la liquidez baja.',
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function directionOf(contribution: number): 'positive' | 'negative' | 'neutral' {
  if (contribution > 0.001) return 'positive';
  if (contribution < -0.001) return 'negative';
  return 'neutral';
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export function explainDecision(
  score: AssetScore,
  features: NormalizedFeatures,
  _state: MarketState,
): DecisionExplanation {
  const contributions = score.breakdown.contributions;
  const weights = score.breakdown.weights;

  // Build per-factor explanation objects
  const featureMap: Record<string, number> = {
    carry: features.carry,
    inflation_hedge: features.inflation_hedge,
    fx_momentum: features.fx_momentum,
    liquidity: features.liquidity,
    risk_penalty: features.risk_penalty,
  };

  const allFactors: FactorExplanation[] = Object.keys(contributions).map((factor) => {
    const contribution = contributions[factor as keyof typeof contributions];
    return {
      factor,
      label: FACTOR_LABELS[factor] ?? factor,
      feature_value: featureMap[factor] ?? 0,
      weight: weights[factor as keyof typeof weights],
      contribution,
      direction: directionOf(contribution),
      rationale: FACTOR_RATIONALES[factor] ?? '',
    };
  });

  // Split into positive and negative contributors
  const positive = allFactors
    .filter((f) => f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5);

  const negative = allFactors
    .filter((f) => f.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution) // most negative first
    .slice(0, 5);

  // Build narrative
  const topPosStr = positive.length > 0
    ? positive.map((f) => `${f.factor} (+${f.contribution.toFixed(4)})`).join(', ')
    : 'ninguno';
  const topNegStr = negative.length > 0
    ? negative.map((f) => `${f.factor} (${f.contribution.toFixed(4)})`).join(', ')
    : 'ninguno';

  const actionLabel: Record<string, string> = {
    rebalance_signal: 'REBALANCEAR (aumentar exposición)',
    hold_signal: 'MANTENER (posición actual)',
    reduce_risk_signal: 'REDUCIR RIESGO (desapalancar)',
  };

  const reasoning_summary =
    `Decisión: ${actionLabel[score.action] ?? score.action}. ` +
    `Score crudo: ${score.score.toFixed(1)}/100, ajustado por régimen ${score.regime.regime} ` +
    `a ${score.score_adjusted.toFixed(1)}/100. ` +
    `Predicción 30d: retorno esperado ${(score.prediction.expected_return * 100).toFixed(2)}% ` +
    `(confianza ${(score.prediction.confidence * 100).toFixed(0)}%, VaR95 ${(score.prediction.risk_var_95 * 100).toFixed(2)}%). ` +
    `Factores positivos principales: ${topPosStr}. ` +
    `Factores negativos principales: ${topNegStr}. ` +
    `Régimen subyacente: ${score.regime.description}.`;

  // Build factor_weights object
  const factor_weights: Record<string, number> = {};
  for (const key of Object.keys(weights)) {
    factor_weights[key] = weights[key as keyof typeof weights];
  }

  return {
    decision: score.action,
    top_positive_factors: positive,
    top_negative_factors: negative,
    factor_weights,
    reasoning_summary: reasoning_summary,
    computed_at: new Date().toISOString(),
    explainer_version: EXPLAINER_VERSION,
  };
}
