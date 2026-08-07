// src/lib/oracle/v2/scenario-engine.ts
// ============================================================================
// R8 — SCENARIO ENGINE (append-only)
// ============================================================================
// MISSION (per ORACLE_V2_SYSTEMIC_ROBUSTNESS spec, R8):
//   "Evaluar la misma cartera bajo múltiples escenarios."
//
// SCENARIOS (6):
//   inflation_shock       — monthly inflation +5pp sudden jump
//   fx_shock              — FX MEP +20% sudden devaluation
//   rate_shock            — TNA +10pp sudden hike
//   reserves_shock        — reserves -$5B outflow
//   political_uncertainty — risk_sentiment shifts to -0.8
//   external_crisis       — global risk-off + liquidity drops to 0.2
//
// DESIGN:
//   - Pure function. Takes the canonical MarketStateInput, applies a shock
//     transform per scenario, re-runs the single-pass oracle engine, returns
//     a ScenarioResult per scenario.
//   - Does NOT mutate any global state. Each scenario is independent.
//   - The base case (no shock) is included for comparison.
//
// ANTI-FRANKENSTEIN:
//   - Uses the SAME single-pass-oracle-engine as production. Does NOT
//     introduce a parallel scoring model.
// ============================================================================

import { runSinglePass, type AssetScoreVector } from '@/lib/single-pass-oracle-engine';
import type { MarketStateInput } from '@/lib/single-market-state';

// ─── Public Types ──────────────────────────────────────────────────────────

export type ScenarioId =
  | 'base'
  | 'inflation_shock'
  | 'fx_shock'
  | 'rate_shock'
  | 'reserves_shock'
  | 'political_uncertainty'
  | 'external_crisis';

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  description: string;
  /** Severity 0..100 (higher = more adverse) */
  severity: number;
}

export interface ScenarioResult {
  data_class: 'SYNTHETIC';
  purpose: 'SCENARIO_OR_COUNTERFACTUAL';
  live_prediction: false;
  lifecycle_persist_as_real: false;
  learning_eligible: false;
  scenario: ScenarioDefinition;
  /** Score under this scenario */
  score: number;
  /** Risk-adjusted score under this scenario */
  score_adjusted: number;
  /** Expected 30d return under this scenario (fractional) */
  expected_return: number;
  /** Action signal under this scenario */
  action: string;
  /** Regime under this scenario */
  regime: string;
  /** Delta vs base case score (positive = scenario is better than base) */
  delta_vs_base: number;
  /** Full AssetScoreVector for this scenario (for deep inspection) */
  vector: AssetScoreVector;
}

export interface ScenarioReport {
  status: 'READY' | 'PARTIAL';
  warnings: string[];
  data_class: 'SYNTHETIC';
  base: ScenarioResult | null;
  scenarios: ScenarioResult[];
  /** Worst-case scenario (lowest score_adjusted) */
  worst_case: ScenarioResult | null;
  /** Best-case scenario (highest score_adjusted) */
  best_case: ScenarioResult | null;
  /** Range of score_adjusted across all scenarios */
  range: { min: number | null; max: number | null; spread: number | null };
  /** ISO-8601 */
  computed_at: string;
  /** Engine version */
  engine_version: string;
}

export const SCENARIO_ENGINE_VERSION = 'scenario_engine_v2_r8';

// ─── Scenario Definitions ──────────────────────────────────────────────────

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id: 'base',
    label: 'Base Case',
    description: 'Sin shock — estado actual del mercado',
    severity: 0,
  },
  {
    id: 'inflation_shock',
    label: 'Inflation Shock (+5pp m/m)',
    description: 'Salto inflacionario de 5 puntos porcentuales mensual',
    severity: 70,
  },
  {
    id: 'fx_shock',
    label: 'FX Shock (+20% MEP)',
    description: 'Devaluación sudden del 20% en el MEP',
    severity: 85,
  },
  {
    id: 'rate_shock',
    label: 'Rate Shock (+10pp TNA)',
    description: 'BCRA sube TNA 10 puntos porcentuales',
    severity: 60,
  },
  {
    id: 'reserves_shock',
    label: 'Reserves Shock (-$5B)',
    description: 'Salida de reservas de USD 5.000M',
    severity: 75,
  },
  {
    id: 'political_uncertainty',
    label: 'Political Uncertainty',
    description: 'Sentimiento de riesgo cae a -0.8 (risk-off fuerte)',
    severity: 65,
  },
  {
    id: 'external_crisis',
    label: 'External Crisis (Global Risk-Off)',
    description: 'Crisis externa: liquidez 0.2 + risk-off +0.5',
    severity: 90,
  },
];

// ─── Shock Transforms ──────────────────────────────────────────────────────

function applyShock(input: MarketStateInput, scenario: ScenarioId): MarketStateInput {
  const next: MarketStateInput = { ...input };

  switch (scenario) {
    case 'base':
      // No changes
      break;

    case 'inflation_shock':
      // +5 percentage points monthly inflation
      next.inflation_monthly = (input.inflation_monthly ?? 0.04) + 0.05;
      break;

    case 'fx_shock':
      // +20% MEP devaluation, gap widens
      next.fx_mep = (input.fx_mep ?? 1200) * 1.20;
      next.fx_gap_pct = (input.fx_gap_pct ?? 4) + 15;
      break;

    case 'rate_shock':
      // +10pp TNA hike
      next.rates_tna = (input.rates_tna ?? 0.30) + 0.10;
      break;

    case 'reserves_shock':
      // -$5B reserves
      next.reserves_usd = (input.reserves_usd ?? 26000) - 5000;
      next.reserves_usd_prev = input.reserves_usd ?? 26000;
      break;

    case 'political_uncertainty':
      // Risk sentiment shifts heavily negative → widen FX gap
      next.fx_gap_pct = (input.fx_gap_pct ?? 4) + 8;
      next.market_breadth = 0.3; // weak breadth
      break;

    case 'external_crisis':
      // Global risk-off: liquidity drops, FX pressure up
      next.market_breadth = 0.2;
      next.fx_gap_pct = (input.fx_gap_pct ?? 4) + 10;
      next.quality = 'PARTIAL_FALLBACK'; // external crisis often coincides with data disruptions
      break;
  }

  return next;
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export function runScenarioSweep(baseInput: MarketStateInput): ScenarioReport {
  const results: ScenarioResult[] = [];
  const warnings: string[] = [];
  for (const def of SCENARIO_DEFINITIONS) {
    const shockedInput = applyShock(baseInput, def.id);
    const vector = runSinglePass(shockedInput);
    const sanScore = vector.scores.find((score) => score.asset === 'SAN') ?? null;
    if (sanScore === null) {
      warnings.push(`NO_PRIMARY_SCORE:${def.id}`);
      continue;
    }
    results.push({
      data_class: 'SYNTHETIC',
      purpose: 'SCENARIO_OR_COUNTERFACTUAL',
      live_prediction: false,
      lifecycle_persist_as_real: false,
      learning_eligible: false,
      scenario: def,
      score: sanScore.score,
      score_adjusted: sanScore.score_adjusted,
      expected_return: sanScore.prediction.expected_return,
      action: sanScore.action,
      regime: sanScore.regime.regime,
      delta_vs_base: 0,
      vector,
    });
  }

  const baseResult = results.find((result) => result.scenario.id === 'base') ?? null;
  if (baseResult !== null) {
    for (const result of results) {
      result.delta_vs_base = Math.round((result.score_adjusted - baseResult.score_adjusted) * 10) / 10;
    }
  } else {
    warnings.push('NO_BASE_SCORE');
  }

  const nonBase = results.filter((result) => result.scenario.id !== 'base');
  const sorted = [...nonBase].sort((a, b) => a.score_adjusted - b.score_adjusted);
  const worst_case = sorted.at(0) ?? null;
  const best_case = sorted.at(-1) ?? null;
  const allScores = results.map((result) => result.score_adjusted);
  const min = allScores.length > 0 ? Math.min(...allScores) : null;
  const max = allScores.length > 0 ? Math.max(...allScores) : null;

  return {
    status: warnings.length === 0 ? 'READY' : 'PARTIAL',
    warnings,
    data_class: 'SYNTHETIC',
    base: baseResult,
    scenarios: nonBase,
    worst_case,
    best_case,
    range: {
      min: min === null ? null : Math.round(min * 10) / 10,
      max: max === null ? null : Math.round(max * 10) / 10,
      spread: min === null || max === null ? null : Math.round((max - min) * 10) / 10,
    },
    computed_at: new Date().toISOString(),
    engine_version: SCENARIO_ENGINE_VERSION,
  };
}
