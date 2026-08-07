// src/lib/oracle/v3/counterfactual-engine.ts
// ============================================================================
// I8 — COUNTERFACTUAL ENGINE (append-only)
// ============================================================================
// MISSION (per ORACLE_V3_INTELLIGENCE_LAYER spec, I8):
//   "Responder 'qué habría pasado si...'."
//
// CAPABILITIES:
//   - Modify a variable   : override one MarketStateInput field
//   - Recalculate score   : re-run single-pass-oracle-engine with the modified input
//   - Show sensitivity    : delta in score / delta in input (per variable)
//   - Rank critical vars  : sort variables by their impact on the score
//
// DESIGN:
//   - Uses the SAME canonical single-pass-oracle-engine as production.
//   - Each counterfactual is a pure function call (no side effects).
//   - Results include the full AssetScoreVector for deep inspection.
//
// ANTI-FRANKENSTEIN:
//   - Does NOT modify single-pass-oracle-engine.
//   - Does NOT modify V2 R8 scenario-engine (which uses pre-defined shocks).
//   - V3 I8 allows ARBITRARY variable overrides (user-driven what-ifs).
// ============================================================================

import { runSinglePass, type AssetScore, type AssetScoreVector } from '@/lib/single-pass-oracle-engine';
import type { MarketStateInput, MarketState } from '@/lib/single-market-state';

// ─── Public Types ──────────────────────────────────────────────────────────

export type CounterfactualVariable =
  | 'fx_mep'
  | 'inflation_monthly'
  | 'rates_tna'
  | 'reserves_usd'
  | 'fx_gap_pct'
  | 'market_breadth';

export interface CounterfactualPerturbation {
  variable: CounterfactualVariable;
  /** Original value */
  baseline: number;
  /** Counterfactual value */
  counterfactual: number;
  /** Absolute delta */
  delta: number;
  /** Relative delta (% change from baseline) */
  relative_delta: number;
}

export interface CounterfactualResult {
  data_class: 'SYNTHETIC';
  purpose: 'SCENARIO_OR_COUNTERFACTUAL';
  live_prediction: false;
  lifecycle_persist_as_real: false;
  learning_eligible: false;
  /** What was changed */
  perturbation: CounterfactualPerturbation;
  /** Resulting score */
  score: number;
  /** Resulting risk-adjusted score */
  score_adjusted: number;
  /** Resulting expected_return */
  expected_return: number;
  /** Resulting action */
  action: string;
  /** Resulting regime */
  regime: string;
  /** Delta vs baseline score */
  score_delta: number;
  /** Delta vs baseline score_adjusted */
  score_adjusted_delta: number;
  /** Delta vs baseline expected_return */
  expected_return_delta: number;
  /** Sensitivity = |score_adjusted_delta| / |input_delta| */
  sensitivity: number;
  /** Full AssetScoreVector for deep inspection */
  vector: AssetScoreVector;
}

export interface VariableSensitivityRanking {
  variable: CounterfactualVariable;
  /** Sensitivity magnitude (mean |score_adjusted_delta| across perturbations) */
  sensitivity: number;
  /** Direction of effect (positive = increasing variable raises score) */
  direction: 'positive' | 'negative' | 'mixed' | 'neutral';
  /** Number of perturbations evaluated */
  samples: number;
  /** Whether this variable flips the action when perturbed */
  flips_action: boolean;
}

export interface CounterfactualReport {
  status: 'READY' | 'PARTIAL';
  warnings: string[];
  data_class: 'SYNTHETIC';
  /** Baseline (unchanged) score */
  baseline: {
    score: number;
    score_adjusted: number;
    expected_return: number;
    action: string;
    regime: string;
  };
  /** All counterfactual results (one per perturbation) */
  counterfactuals: CounterfactualResult[];
  /** Variable sensitivity ranking (most critical first) */
  critical_variables: VariableSensitivityRanking[];
  /** Most critical variable (highest |sensitivity|) */
  most_critical_variable: VariableSensitivityRanking | null;
  /** Summary narrative */
  narrative: string;
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
  /** Feature flag */
  enabled: boolean;
}

export const COUNTERFACTUAL_ENGINE_VERSION = 'counterfactual_engine_v3_i8';

// ─── Feature Flag ──────────────────────────────────────────────────────────

let _enabled = true;
export function setCounterfactualEnabled(v: boolean): void { _enabled = v; }
export function isCounterfactualEnabled(): boolean { return _enabled; }

// ─── Helpers ───────────────────────────────────────────────────────────────

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ─── Default Perturbation Grid ─────────────────────────────────────────────
//
// For each variable, define a set of perturbations to test. The perturbations
// are designed to be realistic "what-if" scenarios (not extreme shocks).

const DEFAULT_PERTURBATIONS: Record<CounterfactualVariable, number[]> = {
  fx_mep:           [0.95, 0.98, 1.02, 1.05, 1.10],     // ±5%, ±2%, +10%
  inflation_monthly:[1.5, 1.2, 0.8, 0.5],               // ±50%, ±20% relative
  rates_tna:        [1.5, 1.2, 0.8, 0.5],               // ±50%, ±20% relative
  reserves_usd:     [0.95, 0.98, 1.02, 1.05],           // ±5%, ±2%
  fx_gap_pct:       [1.5, 1.2, 0.8, 0.5],               // ±50%, ±20% relative
  market_breadth:   [0.3, 0.7, 0.9],                    // absolute values
};

function isMultiplicative(variable: CounterfactualVariable): boolean {
  return variable === 'fx_mep' || variable === 'reserves_usd';
}

// ─── Counterfactual Runner ─────────────────────────────────────────────────

function runCounterfactual(
  baselineInput: MarketStateInput,
  baselineScore: AssetScore,
  variable: CounterfactualVariable,
  factor: number,
): CounterfactualResult | null {
  const baseline = baselineInput[variable] ?? 0;
  let counterfactual: number;

  if (variable === 'market_breadth') {
    counterfactual = factor; // absolute value
  } else if (isMultiplicative(variable)) {
    counterfactual = baseline * factor;
  } else {
    counterfactual = baseline * factor;
  }

  const perturbedInput: MarketStateInput = { ...baselineInput, [variable]: counterfactual };
  const vector = runSinglePass(perturbedInput);
  const score = vector.scores.find((candidate) => candidate.asset === baselineScore.asset) ?? null;
  if (score === null) return null;

  const delta = counterfactual - baseline;
  const relative_delta = baseline !== 0 ? delta / baseline : 0;

  const score_delta = score.score - baselineScore.score;
  const score_adjusted_delta = score.score_adjusted - baselineScore.score_adjusted;
  const expected_return_delta = score.prediction.expected_return - baselineScore.prediction.expected_return;
  const input_delta_abs = Math.abs(delta);
  const sensitivity = input_delta_abs > 1e-9 ? Math.abs(score_adjusted_delta) / input_delta_abs : 0;

  return {
    data_class: 'SYNTHETIC',
    purpose: 'SCENARIO_OR_COUNTERFACTUAL',
    live_prediction: false,
    lifecycle_persist_as_real: false,
    learning_eligible: false,
    perturbation: {
      variable,
      baseline: round(baseline, 6),
      counterfactual: round(counterfactual, 6),
      delta: round(delta, 6),
      relative_delta: round(relative_delta, 4),
    },
    score: round(score.score, 2),
    score_adjusted: round(score.score_adjusted, 2),
    expected_return: round(score.prediction.expected_return, 6),
    action: score.action,
    regime: score.regime.regime,
    score_delta: round(score_delta, 2),
    score_adjusted_delta: round(score_adjusted_delta, 2),
    expected_return_delta: round(expected_return_delta, 6),
    sensitivity: round(sensitivity, 4),
    vector,
  };
}

// ─── Critical Variable Ranking ─────────────────────────────────────────────

function rankCriticalVariables(
  results: CounterfactualResult[],
  baselineAction: string,
): VariableSensitivityRanking[] {
  const byVariable = new Map<CounterfactualVariable, CounterfactualResult[]>();

  for (const r of results) {
    const v = r.perturbation.variable;
    if (!byVariable.has(v)) byVariable.set(v, []);
    byVariable.get(v)!.push(r);
  }

  const rankings: VariableSensitivityRanking[] = [];
  for (const [variable, group] of byVariable.entries()) {
    const sensitivity = group.reduce((s, r) => s + r.sensitivity, 0) / group.length;

    // Direction: positive if most perturbations raise the score, negative if they lower it
    const positiveCount = group.filter((r) => r.score_adjusted_delta > 0).length;
    const negativeCount = group.filter((r) => r.score_adjusted_delta < 0).length;
    let direction: VariableSensitivityRanking['direction'];
    if (positiveCount > negativeCount + 1) direction = 'positive';
    else if (negativeCount > positiveCount + 1) direction = 'negative';
    else if (positiveCount === 0 && negativeCount === 0) direction = 'neutral';
    else direction = 'mixed';

    // Does this variable flip the action?
    const flips_action = group.some((r) => r.action !== baselineAction);

    rankings.push({
      variable,
      sensitivity: round(sensitivity, 4),
      direction,
      samples: group.length,
      flips_action,
    });
  }

  return rankings.sort((a, b) => b.sensitivity - a.sensitivity);
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export interface CounterfactualEngineInput {
  baseline_input: MarketStateInput;
  baseline_score: AssetScore;
  /** Optional: limit which variables to perturb (default: all) */
  variables?: CounterfactualVariable[];
  /** Optional: custom perturbations per variable (overrides defaults) */
  custom_perturbations?: Partial<Record<CounterfactualVariable, number[]>>;
}

export function runCounterfactuals(input: CounterfactualEngineInput): CounterfactualReport {
  const variables = input.variables ?? (
    Object.keys(DEFAULT_PERTURBATIONS) as CounterfactualVariable[]
  );

  const results: CounterfactualResult[] = [];
  const warnings: string[] = [];
  for (const v of variables) {
    const factors = input.custom_perturbations?.[v] ?? DEFAULT_PERTURBATIONS[v];
    for (const f of factors) {
      const result = runCounterfactual(input.baseline_input, input.baseline_score, v, f);
      if (result) results.push(result);
      else warnings.push(`NO_PRIMARY_SCORE:${v}:${f}`);
    }
  }

  const critical_variables = rankCriticalVariables(results, input.baseline_score.action);
  const most_critical = critical_variables[0] ?? null;

  const narrative = most_critical
    ? `Variable más crítica: ${most_critical.variable} (sensibilidad ${most_critical.sensitivity.toFixed(4)}, dirección ${most_critical.direction}${most_critical.flips_action ? ', flips action' : ''}). ` +
      `${results.length} counterfactuals evaluados sobre ${variables.length} variables. ` +
      `Baseline score_adjusted=${input.baseline_score.score_adjusted.toFixed(1)}, action=${input.baseline_score.action}.`
    : `Sin counterfactuals evaluados.`;

  return {
    status: warnings.length === 0 ? 'READY' : 'PARTIAL',
    warnings,
    data_class: 'SYNTHETIC',
    baseline: {
      score: round(input.baseline_score.score, 2),
      score_adjusted: round(input.baseline_score.score_adjusted, 2),
      expected_return: round(input.baseline_score.prediction.expected_return, 6),
      action: input.baseline_score.action,
      regime: input.baseline_score.regime.regime,
    },
    counterfactuals: results,
    critical_variables,
    most_critical_variable: most_critical,
    narrative,
    computed_at: new Date().toISOString(),
    engine_version: COUNTERFACTUAL_ENGINE_VERSION,
    enabled: _enabled,
  };
}
